const express = require('express');
const router = express.Router();
const { protect, requireActivation, requireTestUserModuleAccess } = require('../middleware/auth');
const { completionRateLimit, deviceFingerprint } = require('../middleware/antiFraud');
const { Task, TaskCompletion } = require('../models/Task');
const TaskUnlock = require('../models/TaskUnlock');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { getRedis, isRedisReady } = require('../config/redis');
const { updateChallengeProgress } = require('../controllers/challengeController');
const { spendTokens } = require('../services/tokenService');
const { getCategoryProviders } = require('../config/categoryProviders');
const logger = require('../utils/logger');

const INTERNAL_TASK_TEMPLATES = [
  {
    externalId: 'premium-1',
    source: 'internal',
    title: 'Premium Data Review',
    description: 'Review a short data set and answer quality questions.',
    category: 'analysis',
    rewardUSD: 0.75,
    estimatedMinutes: 10,
    externalUrl: null,
    isPremium: true,
    tokenCost: 5,
  },
  {
    externalId: 'premium-2',
    source: 'internal',
    title: 'High Value App Test',
    description: 'Test a demo app flow and submit feedback.',
    category: 'testing',
    rewardUSD: 1.25,
    estimatedMinutes: 15,
    externalUrl: null,
    isPremium: true,
    tokenCost: 8,
  },
  {
    externalId: 'internal-onboarding-quiz',
    source: 'internal',
    title: 'Onboarding Quality Quiz',
    description: 'Complete a short quality quiz to unlock better task recommendations.',
    category: 'quality',
    rewardUSD: 0.2,
    estimatedMinutes: 5,
    externalUrl: null,
    isPremium: false,
    tokenCost: 0,
  },
];

const TASK_PROVIDER_SESSION_TTL_SECONDS = 60 * 60 * 12;

const ensureBaselineTasks = async () => {
  for (const template of INTERNAL_TASK_TEMPLATES) {
    await Task.updateOne(
      { externalId: template.externalId },
      { $setOnInsert: template },
      { upsert: true }
    );
  }
};

const mapProvider = (provider) => ({
  key: provider.key,
  name: provider.name,
  description: provider.description,
  integrationType: provider.integrationType,
  access: provider.access,
  badge: provider.badge,
  url: provider.externalUrl || null,
  live: Boolean(provider.externalUrl) && provider.access !== 'planned',
});

const getMicrotaskProviders = () => {
  const category = getCategoryProviders('microtasks');
  const providers = (category?.providers || []).map(mapProvider);

  return {
    category: {
      key: 'microtasks',
      title: category?.title || 'Microtasks',
      description: category?.description || 'Partner-powered microtask opportunities.',
    },
    providers,
  };
};

// @GET /api/tasks
router.get('/', protect, requireActivation, requireTestUserModuleAccess('Microtasks'), async (req, res) => {
  try {
    await ensureBaselineTasks();
    const tasks = await Task.find({ isActive: true, source: 'internal' }).sort({ rewardUSD: -1 }).limit(50);
    const unlocked = await TaskUnlock.find({ userId: req.user.id, taskId: { $in: tasks.map((task) => task._id) } });
    const unlockMap = new Set(unlocked.map((item) => item.taskId.toString()));
    const result = tasks.map((task) => ({
      ...task.toObject(),
      unlocked: unlockMap.has(task._id.toString()),
      completionMode: 'internal_auto',
    }));
    const providersPayload = getMicrotaskProviders();

    res.json({
      success: true,
      tasks: result,
      providers: providersPayload.providers,
      providersCategory: providersPayload.category,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @GET /api/tasks/providers
router.get('/providers', protect, requireActivation, requireTestUserModuleAccess('Microtasks'), async (req, res) => {
  try {
    const payload = getMicrotaskProviders();
    res.json({
      success: true,
      ...payload,
      liveProviders: payload.providers.filter((provider) => provider.live),
      plannedProviders: payload.providers.filter((provider) => !provider.live),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @GET /api/tasks/providers/:providerKey/launch
router.get('/providers/:providerKey/launch', protect, requireActivation, requireTestUserModuleAccess('Microtasks'), async (req, res) => {
  try {
    const { providerKey } = req.params;
    const { providers } = getMicrotaskProviders();
    const provider = providers.find((entry) => entry.key === providerKey);

    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    if (!provider.url) {
      return res.status(503).json({ success: false, message: 'Provider launch URL is not configured yet' });
    }

    const sessionId = `TASKP-${providerKey}-${Date.now()}-${req.user.id}`;
    if (isRedisReady()) {
      try {
        await getRedis().setex(
          `task:provider:session:${sessionId}`,
          TASK_PROVIDER_SESSION_TTL_SECONDS,
          JSON.stringify({
            providerKey,
            userId: req.user.id.toString(),
            createdAt: new Date().toISOString(),
          })
        );
      } catch (error) {
        logger.warn(`Task provider session store failed: ${error.message}`);
      }
    }

    res.json({
      success: true,
      sessionId,
      provider,
      launchUrl: provider.url,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/tasks/:id/unlock
router.post('/:id/unlock', protect, requireActivation, requireTestUserModuleAccess('Microtasks'), deviceFingerprint, async (req, res) => {
  try {
    await ensureBaselineTasks();

    const task = await Task.findById(req.params.id);
    if (!task || !task.isActive) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (!task.isPremium) {
      return res.status(400).json({ success: false, message: 'This task does not require token unlock' });
    }

    const existingUnlock = await TaskUnlock.findOne({ userId: req.user.id, taskId: task._id });
    if (existingUnlock) {
      return res.status(409).json({ success: false, message: 'Task already unlocked' });
    }

    const tokenCost = Math.max(Number(task.tokenCost || 0), 0);
    if (tokenCost > 0) {
      await spendTokens({
        userId: req.user.id,
        tokenAmount: tokenCost,
        action: 'premium_task_unlock',
        metadata: { taskId: task._id.toString(), taskTitle: task.title },
      });
    }

    const unlock = await TaskUnlock.create({
      userId: req.user.id,
      taskId: task._id,
      tokenCost,
    });

    return res.status(201).json({
      success: true,
      message: tokenCost > 0 ? `Unlocked using ${tokenCost} tokens` : 'Task unlocked',
      unlock,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// @POST /api/tasks/:id/complete
router.post('/:id/complete', protect, requireActivation, requireTestUserModuleAccess('Microtasks'), deviceFingerprint, completionRateLimit, async (req, res) => {
  try {
    await ensureBaselineTasks();

    if (!isRedisReady()) {
      return res.status(503).json({ success: false, message: 'Task completion service is temporarily unavailable' });
    }

    const redis = getRedis();
    const dupKey = `task:completion:${req.user.id}:${req.params.id}`;
    if (await redis.get(dupKey)) {
      return res.status(409).json({ success: false, message: 'Task already submitted' });
    }

    const task = await Task.findById(req.params.id);
    if (!task || !task.isActive) return res.status(404).json({ success: false, message: 'Task not found' });

    if (task.source !== 'internal') {
      return res.status(400).json({
        success: false,
        message: 'This provider task must be completed on the partner platform and cannot be self-credited here.',
      });
    }

    if (task.isPremium) {
      const unlock = await TaskUnlock.findOne({ userId: req.user.id, taskId: task._id });
      if (!unlock) {
        return res.status(403).json({ success: false, message: 'Unlock this premium task with tokens first' });
      }
    }

    // Create completion record
    await TaskCompletion.create({
      taskId: task._id,
      userId: req.user.id,
      status: 'approved', // Auto-approve for external tasks
      rewardPaid: true,
    });

    // Credit wallet
    let wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      wallet = await Wallet.create({ userId: req.user.id });
    }
    await wallet.credit(task.rewardUSD, 'task');

    // Log transaction
    await Transaction.create({
      userId: req.user.id,
      type: 'task',
      amountLocal: task.rewardUSD,
      amountUSD: task.rewardUSD,
      currency: 'USD',
      country: req.user.country,
      provider: 'internal',
      direction: 'credit',
      status: 'successful',
      processedAt: new Date(),
      metadata: { taskId: task._id, source: task.source },
    });

    // XP reward
    await User.findByIdAndUpdate(req.user.id, { $inc: { xpPoints: 15, tasksCompleted: 1 } });
    await updateChallengeProgress(req.user.id, 'task');

    // Dedup for 7 days
    await redis.setex(dupKey, 86400 * 7, '1');

    logger.info(`Task completed: ${task.title} by user ${req.user.id} — $${task.rewardUSD}`);
    res.json({ success: true, message: `Earned $${task.rewardUSD}!`, rewardUSD: task.rewardUSD });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Task already completed' });
    logger.error(`Task completion error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// @GET /api/tasks/history
router.get('/history', protect, requireActivation, requireTestUserModuleAccess('Microtasks'), async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    const skip = (pageNumber - 1) * pageSize;

    const query = {
      userId: req.user.id,
      type: 'task',
    };

    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
      Transaction.countDocuments(query),
    ]);

    res.json({
      success: true,
      transactions,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
