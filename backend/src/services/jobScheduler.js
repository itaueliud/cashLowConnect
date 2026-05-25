const cron = require('node-cron');
const logger = require('../utils/logger');

const startJobScheduler = () => {
  // Sync remote jobs every 6 hours.
  cron.schedule('0 */6 * * *', async () => {
    logger.info('CRON: Syncing remote jobs...');
    try {
      const { syncJobs } = require('../controllers/jobController');
      await syncJobs();
    } catch (err) {
      logger.error(`CRON job sync failed: ${err.message}`);
    }
  });

  // Create daily challenges at midnight EAT (21:00 UTC).
  cron.schedule('0 21 * * *', async () => {
    logger.info('CRON: Creating daily challenges...');
    try {
      await createDailyChallenges();
    } catch (err) {
      logger.error(`CRON daily challenges failed: ${err.message}`);
    }
  });

  // Update exchange rates every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const { refreshExchangeRates } = require('./exchangeService');
      await refreshExchangeRates();
    } catch (err) {
      logger.error(`CRON exchange rates failed: ${err.message}`);
    }
  });

  // Friday bulk payout at 06:00 EAT (03:00 UTC).
  cron.schedule('0 3 * * 5', async () => {
    logger.info('CRON: Friday bulk payout running...');
    try {
      const { processFridayBulkPayout } = require('../controllers/paymentController');
      await processFridayBulkPayout();
    } catch (err) {
      logger.error(`CRON Friday payout failed: ${err.message}`);
    }
  });

  // Daily cleanup.
  cron.schedule('0 2 * * *', async () => {
    logger.info('CRON: Daily cleanup...');
    try {
      await dailyCleanup();
    } catch (err) {
      logger.error(`CRON cleanup failed: ${err.message}`);
    }
  });

  logger.info('Job scheduler started (jobs, challenges, exchange rates, Friday payout, cleanup)');
};

const createDailyChallenges = async () => {
  const { Challenge } = require('../models/Challenge');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const templates = [
    {
      title: 'Survey Starter',
      description: 'Complete 2 surveys today',
      type: 'survey',
      targetCount: 2,
      rewardUSD: 0.50,
      xpReward: 50,
    },
    {
      title: 'Task Master',
      description: 'Complete 3 microtasks today',
      type: 'task',
      targetCount: 3,
      rewardUSD: 0.30,
      xpReward: 40,
    },
    {
      title: 'Referral Champion',
      description: 'Refer 1 friend today',
      type: 'referral',
      targetCount: 1,
      rewardUSD: 0.20,
      xpReward: 100,
    },
    {
      title: 'Daily Login',
      description: 'Log in and complete any activity',
      type: 'login',
      targetCount: 1,
      rewardUSD: 0.05,
      xpReward: 10,
    },
  ];

  // Only create if none exist for today
  const existing = await Challenge.findOne({
    isDaily: true,
    expiresAt: { $gte: new Date() },
  });

  if (!existing) {
    await Challenge.insertMany(
      templates.map(t => ({ ...t, isActive: true, isDaily: true, expiresAt: tomorrow }))
    );
    logger.info('Daily challenges created');
  }
};

const dailyCleanup = async () => {
  const Job = require('../models/Job');
  const JobApplication = require('../models/JobApplication');
  const now = new Date();

  const expiredJobs = await Job.find({
    source: 'internal',
    expiresAt: { $lte: now },
  }).select('_id');

  if (expiredJobs.length > 0) {
    const jobIds = expiredJobs.map((job) => job._id);
    const [deletedApplications, deletedJobs] = await Promise.all([
      JobApplication.deleteMany({ jobId: { $in: jobIds } }),
      Job.deleteMany({ _id: { $in: jobIds } }),
    ]);

    logger.info(
      `Daily cleanup removed ${deletedJobs.deletedCount} expired internal jobs and ${deletedApplications.deletedCount} related applications`
    );
  }

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const oldJobs = await Job.find({ publishedAt: { $lt: oneYearAgo } }).select('_id');
  if (oldJobs.length > 0) {
    const oldJobIds = oldJobs.map((job) => job._id);
    const [deletedOldApplications, deletedOldJobs] = await Promise.all([
      JobApplication.deleteMany({ jobId: { $in: oldJobIds } }),
      Job.deleteMany({ _id: { $in: oldJobIds } }),
    ]);
    logger.info(
      `Daily cleanup removed ${deletedOldJobs.deletedCount} jobs older than 1 year and ${deletedOldApplications.deletedCount} related applications`
    );
  }

  logger.info('Daily cleanup complete');
};

module.exports = { startJobScheduler };
