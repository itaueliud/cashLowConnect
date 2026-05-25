const { Challenge, ChallengeCompletion } = require('../models/Challenge');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

const DAILY_CHALLENGE_TEMPLATES = [
  {
    title: 'Survey Starter',
    description: 'Complete 2 surveys today',
    type: 'survey',
    targetCount: 2,
    rewardUSD: 0.5,
    xpReward: 50,
  },
  {
    title: 'Task Master',
    description: 'Complete 3 microtasks today',
    type: 'task',
    targetCount: 3,
    rewardUSD: 0.3,
    xpReward: 40,
  },
  {
    title: 'Referral Champion',
    description: 'Refer 1 friend today',
    type: 'referral',
    targetCount: 1,
    rewardUSD: 0.2,
    xpReward: 100,
  },
  {
    title: 'Daily Login',
    description: 'Log in today',
    type: 'login',
    targetCount: 1,
    rewardUSD: 0.05,
    xpReward: 10,
  },
];

const ensureDailyChallenges = async () => {
  const now = new Date();
  const existing = await Challenge.find({
    isDaily: true,
    isActive: true,
    expiresAt: { $gt: now },
  });

  if (existing.length >= DAILY_CHALLENGE_TEMPLATES.length) return;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const existingTitles = new Set(existing.map((item) => item.title));
  const missingTemplates = DAILY_CHALLENGE_TEMPLATES.filter((template) => !existingTitles.has(template.title));
  if (missingTemplates.length === 0) return;

  await Challenge.insertMany(
    missingTemplates.map((template) => ({
      ...template,
      isActive: true,
      isDaily: true,
      expiresAt: tomorrow,
    }))
  );
};

// @GET /api/challenges/daily
exports.getDailyChallenges = async (req, res) => {
  try {
    await ensureDailyChallenges();

    const now = new Date();
    const challenges = await Challenge.find({
      isActive: true,
      isDaily: true,
      expiresAt: { $gt: now },
    }).sort({ createdAt: 1 });

    // Get user's progress for each challenge
    const completions = await ChallengeCompletion.find({
      userId: req.user.id,
      challengeId: { $in: challenges.map(c => c._id) },
    });

    const completionMap = {};
    completions.forEach(c => { completionMap[c.challengeId.toString()] = c; });

    const result = challenges.map(c => ({
      ...c.toObject(),
      progress: completionMap[c._id.toString()]?.progress || 0,
      completed: completionMap[c._id.toString()]?.completed || false,
      rewardClaimed: completionMap[c._id.toString()]?.rewardClaimed || false,
    }));

    res.json({ success: true, challenges: result });
  } catch (error) {
    logger.error(`getDailyChallenges error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @POST /api/challenges/:id/claim
exports.claimChallengeReward = async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    if (!challenge || !challenge.isActive || challenge.expiresAt <= new Date()) {
      return res.status(404).json({ success: false, message: 'Challenge not found or expired' });
    }

    const completion = await ChallengeCompletion.findOne({
      userId: req.user.id,
      challengeId: req.params.id,
      completed: true,
      rewardClaimed: false,
    });

    if (!completion) {
      return res.status(400).json({ success: false, message: 'Challenge not completed or reward already claimed' });
    }

    // Credit wallet
    const wallet = await Wallet.findOne({ userId: req.user.id });
    await wallet.credit(challenge.rewardUSD, 'challenge');

    // Log transaction
    await Transaction.create({
      userId: req.user.id,
      type: 'challenge',
      amountLocal: challenge.rewardUSD,
      amountUSD: challenge.rewardUSD,
      currency: 'USD',
      country: req.user.country,
      provider: 'internal',
      direction: 'credit',
      status: 'successful',
      processedAt: new Date(),
    });

    // Award XP
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { xpPoints: challenge.xpReward },
    });

    completion.rewardClaimed = true;
    await completion.save();

    res.json({
      success: true,
      message: `Claimed $${challenge.rewardUSD} + ${challenge.xpReward} XP!`,
      rewardUSD: challenge.rewardUSD,
    });
  } catch (error) {
    logger.error(`claimChallengeReward error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Internal: update challenge progress when user completes a task/survey
exports.updateChallengeProgress = async (userId, activityType) => {
  try {
    await ensureDailyChallenges();

    const query = {
      isActive: true,
      isDaily: true,
      expiresAt: { $gt: new Date() },
      $or: [{ type: activityType }, { type: 'mixed' }],
    };

    if (activityType === 'login') {
      query.$or.push({ type: 'login' });
    }

    const challenges = await Challenge.find({
      ...query,
    });

    for (const challenge of challenges) {
      let completion = await ChallengeCompletion.findOne({ userId, challengeId: challenge._id });
      if (!completion) {
        completion = await ChallengeCompletion.create({
          userId,
          challengeId: challenge._id,
          progress: 0,
          completed: false,
          rewardClaimed: false,
        });
      }

      if (completion.completed) {
        continue;
      }

      completion.progress += 1;

      if (completion.progress >= challenge.targetCount) {
        completion.completed = true;
        completion.completedAt = new Date();
      }

      await completion.save();
    }
  } catch (error) {
    logger.error(`updateChallengeProgress error: ${error.message}`);
  }
};
