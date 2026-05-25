const express = require('express');
const router = express.Router();
const { protect, adminOnly, staffOnly, ledgerOrSuperadminOnly } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { COUNTRIES } = require('../config/countries');
const { HYBRID_PAYMENT_STACK, PROVIDER_STATUS } = require('../config/paymentStack');
const Wallet = require('../models/Wallet');
const mongoose = require('mongoose');
const { getRedis, isRedisReady } = require('../config/redis');
const logger = require('../utils/logger');

const truthy = (value) => Boolean(value && String(value).trim());
const getLedgerSplitPercent = () => {
  const percent = Number(process.env.LEDGER_SUPERADMIN_SHARE || 60);
  if (Number.isNaN(percent)) return 60;
  return Math.min(Math.max(percent, 51), 100);
};

const getAdminSharePercent = () => 100 - getLedgerSplitPercent();
const normalizeSearch = (value = '') => String(value).trim();
const canManageTarget = (actor, target) => {
  if (!actor || !target) return false;
  if (actor.role === 'superadmin') return true;
  if (actor.role !== 'admin') return false;
  if (target.role !== 'user') return false;
  if (!target.managedBy) return true;
  return target.managedBy.toString() === actor.id.toString();
};

const getLedgerBaseQuery = (range = '30d') => {
  const now = new Date();
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const from = new Date(now);
  from.setDate(from.getDate() - days);

  return {
    createdAt: { $gte: from, $lte: now },
    status: 'successful',
    type: { $in: ['activation', 'job_posting', 'token_purchase'] },
  };
};

const aggregateLedger = async (range) => {
  const ledgerQuery = getLedgerBaseQuery(range);
  const [summary] = await Transaction.aggregate([
    { $match: ledgerQuery },
    {
      $group: {
        _id: null,
        totalUSD: { $sum: '$amountUSD' },
        totalLocal: { $sum: '$amountLocal' },
        count: { $sum: 1 },
      },
    },
  ]);

  const transactions = await Transaction.find(ledgerQuery)
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('userId', 'name email phone role country userId');

  const totalUSD = summary?.totalUSD || 0;
  const superadminSharePercent = getLedgerSplitPercent();
  const adminSharePercent = getAdminSharePercent();

  return {
    range,
    totalUSD,
    totalLocal: summary?.totalLocal || 0,
    count: summary?.count || 0,
    superadminSharePercent,
    adminSharePercent,
    superadminShareUSD: Number((totalUSD * superadminSharePercent / 100).toFixed(4)),
    adminShareUSD: Number((totalUSD * adminSharePercent / 100).toFixed(4)),
    transactions,
  };
};

const providerConfigs = {
  daraja: {
    label: 'Safaricom Daraja',
    environment: String(process.env.DARAJA_ENV || process.env.MPESA_ENV || 'sandbox').toLowerCase(),
    required: [
      ['consumerKey', process.env.DARAJA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY],
      ['consumerSecret', process.env.DARAJA_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET],
      ['shortcode', process.env.DARAJA_SHORTCODE || process.env.MPESA_SHORTCODE],
      ['passkey', process.env.DARAJA_PASSKEY || process.env.MPESA_PASSKEY],
    ],
    recommended: [
      ['securityCredential', process.env.DARAJA_SECURITY_CREDENTIAL || process.env.MPESA_SECURITY_CREDENTIAL],
      ['initiatorName', process.env.DARAJA_INITIATOR_NAME || process.env.MPESA_INITIATOR_NAME],
      ['till', process.env.DARAJA_TILL || process.env.MPESA_TILL],
    ],
  },
  jenga: {
    label: 'Jenga API',
    environment: 'configured',
    required: [
      ['apiKey', process.env.JENGA_API_KEY],
      ['apiSecret', process.env.JENGA_API_SECRET],
      ['merchantCode', process.env.JENGA_MERCHANT_CODE],
      ['collectionUrl', process.env.JENGA_COLLECTION_URL],
      ['mobileWithdrawalUrl', process.env.JENGA_MOBILE_WITHDRAWAL_URL],
    ],
    recommended: [
      ['sourceAccountNumber', process.env.JENGA_SOURCE_ACCOUNT_NUMBER],
      ['sourceAccountName', process.env.JENGA_SOURCE_ACCOUNT_NAME],
    ],
  },
  paystack: {
    label: 'Paystack',
    environment: process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live') ? 'live' : 'test',
    required: [
      ['secretKey', process.env.PAYSTACK_SECRET_KEY],
      ['publicKey', process.env.PAYSTACK_PUBLIC_KEY],
    ],
    recommended: [],
  },
  mtn_momo: {
    label: 'MTN MoMo',
    environment: process.env.MTN_MOMO_TARGET_ENVIRONMENT || 'sandbox',
    required: [
      ['subscriptionKey', process.env.MTN_MOMO_SUBSCRIPTION_KEY],
      ['apiUser', process.env.MTN_MOMO_API_USER],
      ['apiKey', process.env.MTN_MOMO_API_KEY],
      ['baseUrl', process.env.MTN_MOMO_BASE_URL],
    ],
    recommended: [],
  },
  telebirr: {
    label: 'Telebirr',
    environment: process.env.TELEBIRR_BASE_URL ? 'configured' : 'missing',
    required: [
      ['appId', process.env.TELEBIRR_APP_ID],
      ['appKey', process.env.TELEBIRR_APP_KEY],
      ['merchantId', process.env.TELEBIRR_MERCHANT_ID],
      ['baseUrl', process.env.TELEBIRR_BASE_URL],
    ],
    recommended: [
      ['notifyUrl', process.env.TELEBIRR_NOTIFY_URL],
    ],
  },
  tanzania_wallet: {
    label: 'Tanzania Wallet',
    environment: process.env.TANZANIA_WALLET_PROVIDER || 'configured',
    required: [
      ['depositUrl', process.env.TANZANIA_WALLET_DEPOSIT_URL],
      ['withdrawalUrl', process.env.TANZANIA_WALLET_WITHDRAWAL_URL],
      ['apiKey', process.env.TANZANIA_WALLET_API_KEY],
      ['apiSecret', process.env.TANZANIA_WALLET_API_SECRET],
    ],
    recommended: [
      ['provider', process.env.TANZANIA_WALLET_PROVIDER],
    ],
  },
};

router.get('/stats', protect, adminOnly, async (req, res) => {
  const [totalUsers, activeUsers, totalTransactions] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ activationStatus: true }),
    Transaction.countDocuments({ status: 'successful' }),
  ]);
  res.json({ success: true, stats: { totalUsers, activeUsers, totalTransactions } });
});

router.get('/users', protect, staffOnly, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  const { page = 1, limit = 50, search = '', role = '', banned = '' } = req.query;
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const query = {};

  if (req.user.role === 'admin') {
    query.role = 'user';
    query.$or = [{ managedBy: req.user.id }, { managedBy: null }];
  } else if (role && ['user', 'admin', 'superadmin'].includes(String(role))) {
    query.role = role;
  }

  if (String(banned) === 'true') query.isBanned = true;
  if (String(banned) === 'false') query.isBanned = false;

  const term = normalizeSearch(search);
  if (term) {
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { name: { $regex: term, $options: 'i' } },
          { email: { $regex: term, $options: 'i' } },
          { phone: { $regex: term, $options: 'i' } },
          { userId: { $regex: term, $options: 'i' } },
        ],
      },
    ];
  }

  const users = await User.find(query).sort({ createdAt: -1 }).skip((page-1)*safeLimit).limit(safeLimit);
  res.json({ success: true, users });
});

router.put('/users/:id/ban', protect, staffOnly, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  if (!canManageTarget(req.user, targetUser)) {
    return res.status(403).json({ success: false, message: 'Not allowed to manage this account' });
  }
  if (req.user.role === 'admin' && targetUser.role === 'user') {
    targetUser.managedBy = req.user.id;
    targetUser.managedAt = new Date();
    await targetUser.save();
  }
  const user = await User.findByIdAndUpdate(req.params.id, { isBanned: true, banReason: req.body.reason }, { new: true });
  res.json({ success: true, user });
});

router.put('/users/:id/unban', protect, staffOnly, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  if (!canManageTarget(req.user, targetUser)) {
    return res.status(403).json({ success: false, message: 'Not allowed to manage this account' });
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isBanned: false, banReason: null, failedLoginAttempts: 0, lockUntil: null },
    { new: true }
  );
  res.json({ success: true, user });
});

router.put('/users/:id/assign', protect, adminOnly, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  const { adminId } = req.body;
  const targetAdmin = await User.findById(adminId);
  if (!targetAdmin || !['admin', 'superadmin'].includes(targetAdmin.role)) {
    return res.status(400).json({ success: false, message: 'Valid admin required' });
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { managedBy: targetAdmin._id, managedAt: new Date() },
    { new: true }
  );

  res.json({ success: true, user });
});

router.get('/admins', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const visibleRoles = req.user.role === 'ledger'
    ? ['admin', 'superadmin']
    : ['admin'];
  const admins = await User.find({ role: { $in: visibleRoles } })
    .sort({ createdAt: -1 })
    .select('name email phone role country isBanned isActive lastActiveDate userId createdAt');
  res.json({ success: true, admins });
});

router.post('/admins', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const { name, email, phone, country, password, role = 'admin' } = req.body;

  if (!name || !email || !phone || !country || !password) {
    return res.status(400).json({ success: false, message: 'Missing required admin fields' });
  }

  const allowedRoles = req.user.role === 'ledger' ? ['admin', 'superadmin'] : ['admin'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { phone }] });
  if (existing) {
    return res.status(409).json({ success: false, message: 'Admin already exists with this email or phone' });
  }

  const admin = await User.create({
    name,
    email: email.toLowerCase(),
    phone,
    country,
    passwordHash: password,
    role,
    activationStatus: true,
    emailVerified: true,
    phoneVerified: true,
    isActive: true,
  });

  res.status(201).json({ success: true, admin });
});

router.put('/admins/:id/ban', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target || !['admin', 'superadmin'].includes(target.role)) {
    return res.status(404).json({ success: false, message: 'Admin account not found' });
  }
  if (req.user.role === 'superadmin' && target.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Superadmin can only manage admin accounts' });
  }
  if (target._id.toString() === req.user.id.toString()) {
    return res.status(400).json({ success: false, message: 'You cannot block your own account' });
  }
  const admin = await User.findByIdAndUpdate(
    target._id,
    { isBanned: true, banReason: req.body.reason || 'Blocked by superadmin' },
    { new: true }
  ).select('name email phone role country isBanned isActive userId');
  res.json({ success: true, admin });
});

router.put('/admins/:id/unban', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target || !['admin', 'superadmin'].includes(target.role)) {
    return res.status(404).json({ success: false, message: 'Admin account not found' });
  }
  if (req.user.role === 'superadmin' && target.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Superadmin can only manage admin accounts' });
  }
  const admin = await User.findByIdAndUpdate(
    target._id,
    { isBanned: false, banReason: null, failedLoginAttempts: 0, lockUntil: null },
    { new: true }
  ).select('name email phone role country isBanned isActive userId');
  res.json({ success: true, admin });
});

router.put('/users/:id/reset-password', protect, staffOnly, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  const { newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
  }
  const target = await User.findById(req.params.id).select('+passwordHash');
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  if (!canManageTarget(req.user, target)) {
    return res.status(403).json({ success: false, message: 'Not allowed to manage this account' });
  }
  target.passwordHash = String(newPassword);
  target.failedLoginAttempts = 0;
  target.lockUntil = null;
  await target.save();
  res.json({ success: true, message: 'Password updated successfully' });
});

router.put('/users/:id/access-type', protect, staffOnly, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }

  const accessType = String(req.body?.userAccessType || '').trim().toLowerCase();
  if (!['real', 'test'].includes(accessType)) {
    return res.status(400).json({ success: false, message: 'userAccessType must be real or test' });
  }

  const target = await User.findById(req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  if (!canManageTarget(req.user, target)) {
    return res.status(403).json({ success: false, message: 'Not allowed to manage this account' });
  }

  target.userAccessType = accessType;
  if (req.user.role === 'admin' && target.role === 'user') {
    target.managedBy = req.user.id;
    target.managedAt = new Date();
  }
  await target.save();

  res.json({ success: true, user: target, message: `User marked as ${accessType} user` });
});

router.put('/admins/:id/reset-password', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
  }
  const target = await User.findById(req.params.id).select('+passwordHash');
  if (!target || !['admin', 'superadmin'].includes(target.role)) {
    return res.status(404).json({ success: false, message: 'Admin account not found' });
  }
  if (req.user.role === 'superadmin' && target.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Superadmin can only manage admin accounts' });
  }
  target.passwordHash = String(newPassword);
  target.failedLoginAttempts = 0;
  target.lockUntil = null;
  await target.save();
  res.json({ success: true, message: 'Admin password updated successfully' });
});

router.get('/ledger', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const { range = '30d' } = req.query;
  const ledger = await aggregateLedger(range);
  res.json({ success: true, ledger, policy: { superadminSharePercent: ledger.superadminSharePercent, adminSharePercent: ledger.adminSharePercent } });
});

router.post('/ledger/payouts/preview', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const { range = '30d' } = req.body;
  const ledger = await aggregateLedger(range);
  res.json({ success: true, preview: ledger });
});

router.post('/ledger/payouts/execute', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { range = '30d' } = req.body;
    const superadminId = req.user._id;

    // Get ledger totals
    const ledger = await aggregateLedger(range);
    const { totalUSD, superadminSharePercent, adminSharePercent } = ledger;

    if (totalUSD <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'No earnings to distribute' });
    }

    // Calculate shares
    const superadminShare = Number((totalUSD * superadminSharePercent / 100).toFixed(4));
    const adminTotalShare = Number((totalUSD * adminSharePercent / 100).toFixed(4));

    // Get all admins (excluding superadmin)
    const admins = await User.find({ role: 'admin' }, '_id userId', { session });
    const adminCount = Math.max(admins.length, 1);
    const sharePerAdmin = Number((adminTotalShare / adminCount).toFixed(4));

    // Credit superadmin wallet
    await Wallet.findOneAndUpdate(
      { userId: superadminId },
      { $inc: { balanceUSD: superadminShare, earnedUSD: superadminShare } },
      { session, new: true }
    );

    // Log superadmin transaction
    await Transaction.create(
      [{
        userId: superadminId,
        type: 'payout',
        status: 'successful',
        provider: 'internal_payout',
        amountUSD: superadminShare,
        amountLocal: 0,
        localCurrency: 'USD',
        description: `Payout (Superadmin) for ${range}`,
        payoutStatus: 'executed',
        payoutExecutedAt: new Date(),
        payoutExecutedBy: superadminId,
        metadata: {
          range,
          role: 'superadmin',
          sharePercent: superadminSharePercent,
        },
      }],
      { session }
    );

    // Credit admin wallets
    const adminPayouts = [];
    for (const admin of admins) {
      await Wallet.findOneAndUpdate(
        { userId: admin._id },
        { $inc: { balanceUSD: sharePerAdmin, earnedUSD: sharePerAdmin } },
        { session, new: true }
      );

      const transaction = await Transaction.create(
        [{
          userId: admin._id,
          type: 'payout',
          status: 'successful',
          provider: 'internal_payout',
          amountUSD: sharePerAdmin,
          amountLocal: 0,
          localCurrency: 'USD',
          description: `Payout (Admin) for ${range}`,
          payoutStatus: 'executed',
          payoutExecutedAt: new Date(),
          payoutExecutedBy: superadminId,
          metadata: {
            range,
            role: 'admin',
            sharePercent: adminSharePercent,
          },
        }],
        { session }
      );

      adminPayouts.push({
        adminId: admin._id,
        adminUserId: admin.userId,
        amount: sharePerAdmin,
        transactionId: transaction[0]._id,
      });
    }

    await session.commitTransaction();

    logger.info(`Payout executed: Superadmin $${superadminShare}, ${admins.length} admins $${sharePerAdmin} each`, {
      superadminId: superadminId.toString(),
      range,
    });

    res.json({
      success: true,
      message: 'Payout executed successfully',
      report: {
        totalDistributed: totalUSD,
        superadmin: {
          userId: superadminId,
          share: superadminSharePercent,
          amount: superadminShare,
        },
        admins: adminPayouts.map(p => ({
          userId: p.adminUserId,
          share: adminSharePercent,
          amount: p.amount,
        })),
        executedAt: new Date(),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('Payout execution failed', { error: error.message, userId: req.user._id.toString() });
    res.status(500).json({ success: false, message: 'Payout execution failed', error: error.message });
  } finally {
    await session.endSession();
  }
});

router.get('/tasks', protect, adminOnly, async (req, res) => {
  const tasks = await require('../models/Challenge').Challenge.find().sort({ createdAt: -1 });
  res.json({ success: true, tasks });
});

router.get('/provider-health', protect, adminOnly, async (req, res) => {
  const providers = Object.entries(providerConfigs).map(([key, config]) => {
    const required = config.required.map(([name, value]) => ({ name, configured: truthy(value) }));
    const recommended = config.recommended.map(([name, value]) => ({ name, configured: truthy(value) }));
    const missingRequired = required.filter((item) => !item.configured).map((item) => item.name);

    return {
      key,
      label: config.label,
      environment: config.environment,
      documentationStatus: PROVIDER_STATUS[key] || 'internal',
      status: missingRequired.length === 0 ? (recommended.every((item) => item.configured) ? 'healthy' : 'partial') : 'missing_config',
      missingRequired,
      missingRecommended: recommended.filter((item) => !item.configured).map((item) => item.name),
      required,
      recommended,
      usage: {
        depositCountries: Object.entries(COUNTRIES)
          .filter(([, country]) => country.paymentRouting?.deposits?.some((strategy) => strategy.includes(key)))
          .map(([code]) => code),
        withdrawalCountries: Object.entries(COUNTRIES)
          .filter(([, country]) => country.paymentRouting?.withdrawals?.some((strategy) => strategy.includes(key)))
          .map(([code]) => code),
      },
    };
  });

  const transactionCounts = await Transaction.aggregate([
    {
      $group: {
        _id: '$provider',
        total: { $sum: 1 },
        successful: { $sum: { $cond: [{ $eq: ['$status', 'successful'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      },
    },
  ]);

  const thresholdConfig = {
    invalidSignaturePerDay: Number(process.env.OFFERWALL_ALERT_INVALID_SIGNATURES_PER_DAY || 3),
    duplicatePerDay: Number(process.env.OFFERWALL_ALERT_DUPLICATES_PER_DAY || 10),
    invalidAmountPerDay: Number(process.env.OFFERWALL_ALERT_INVALID_AMOUNTS_PER_DAY || 3),
    failedPerDay: Number(process.env.OFFERWALL_ALERT_FAILED_PER_DAY || 8),
    suspiciousEventsPerDay: Number(process.env.OFFERWALL_ALERT_SUSPICIOUS_PER_DAY || 12),
  };

  const evaluateOfferwallRisk = (metrics) => {
    const reasons = [];
    const warningReasons = [];

    if (metrics.invalidSignature >= thresholdConfig.invalidSignaturePerDay) {
      reasons.push('invalid signatures above threshold');
    }
    if (metrics.duplicate >= thresholdConfig.duplicatePerDay) {
      reasons.push('duplicates above threshold');
    }
    if (metrics.invalidAmount >= thresholdConfig.invalidAmountPerDay) {
      reasons.push('invalid amounts above threshold');
    }
    if (metrics.failed >= thresholdConfig.failedPerDay) {
      reasons.push('callback failures above threshold');
    }
    if (metrics.suspiciousEvents >= thresholdConfig.suspiciousEventsPerDay) {
      reasons.push('suspicious event volume above threshold');
    }

    if (metrics.failed > 0) warningReasons.push('has callback failures');
    if (metrics.suspiciousEvents > 0) warningReasons.push('has suspicious callback events');

    if (reasons.length > 0) {
      return { riskLevel: 'critical', reasons };
    }
    if (warningReasons.length > 0) {
      return { riskLevel: 'warning', reasons: warningReasons };
    }

    return { riskLevel: 'clean', reasons: [] };
  };

  const offerwallPerformance = [];
  const metricsDay = new Date().toISOString().slice(0, 10);
  if (isRedisReady()) {
    try {
      const redis = getRedis();
      for (const providerKey of ['adgate', 'ayetstudios']) {
        const metricKeys = {
          processed: `metrics:offerwall:${providerKey}:${metricsDay}:processed`,
          credited: `metrics:offerwall:${providerKey}:${metricsDay}:credited`,
          duplicate: `metrics:offerwall:${providerKey}:${metricsDay}:duplicate`,
          invalidSignature: `metrics:offerwall:${providerKey}:${metricsDay}:invalid_signature`,
          invalidAmount: `metrics:offerwall:${providerKey}:${metricsDay}:invalid_amount`,
          failed: `metrics:offerwall:${providerKey}:${metricsDay}:failed`,
        };

        const [processed, credited, duplicate, invalidSignature, invalidAmount, failed] = await Promise.all([
          redis.get(metricKeys.processed),
          redis.get(metricKeys.credited),
          redis.get(metricKeys.duplicate),
          redis.get(metricKeys.invalidSignature),
          redis.get(metricKeys.invalidAmount),
          redis.get(metricKeys.failed),
        ]);

        const parsed = {
          processed: Number(processed || 0),
          credited: Number(credited || 0),
          duplicate: Number(duplicate || 0),
          invalidSignature: Number(invalidSignature || 0),
          invalidAmount: Number(invalidAmount || 0),
          failed: Number(failed || 0),
        };

        const suspiciousEvents = parsed.duplicate + parsed.invalidSignature + parsed.invalidAmount;
        const risk = evaluateOfferwallRisk({
          ...parsed,
          suspiciousEvents,
        });

        offerwallPerformance.push({
          provider: providerKey,
          day: metricsDay,
          ...parsed,
          suspiciousEvents,
          riskLevel: risk.riskLevel,
          triggerReasons: risk.reasons,
        });
      }
    } catch (error) {
      logger.warn(`Unable to load offerwall performance metrics: ${error.message}`);
    }
  }

  const adRewardSummary = await Transaction.aggregate([
    {
      $match: {
        type: 'offer',
        'metadata.provider': { $in: ['adgate', 'ayetstudios'] },
      },
    },
    {
      $group: {
        _id: '$metadata.provider',
        totalRewardsUSD: { $sum: '$amountUSD' },
        count: { $sum: 1 },
        latestRewardAt: { $max: '$createdAt' },
      },
    },
    { $sort: { totalRewardsUSD: -1 } },
  ]);

  res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    stack: HYBRID_PAYMENT_STACK,
    providers,
    transactionCounts,
    adsMetrics: {
      day: metricsDay,
      thresholds: thresholdConfig,
      offerwallPerformance,
      adRewardSummary,
      source: isRedisReady() ? 'redis+mongodb' : 'mongodb',
    },
  });
});

router.get('/users/:id/ledger', protect, staffOnly, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (req.user.role === 'admin' && user.managedBy?.toString() !== req.user.id.toString() && user.role === 'user') {
    await User.findByIdAndUpdate(user._id, { managedBy: req.user.id, managedAt: new Date() });
  }

  const wallet = await Wallet.findOne({ userId: user._id });
  const transactions = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100);

  res.json({
    success: true,
    user,
    wallet,
    transactions,
    managedBy: user.managedBy,
    managedAt: user.managedAt,
  });
});

router.post('/execute-payout', protect, ledgerOrSuperadminOnly, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { range = '30d' } = req.body;

    // Get ledger data
    const ledger = await aggregateLedger(range);
    
    if (ledger.totalUSD === 0 || ledger.count === 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        success: false, 
        message: 'No pending transactions to execute' 
      });
    }

    // Get superadmin wallet
    const superadminWallet = await Wallet.findOne({ userId: req.user._id }).session(session);
    if (!superadminWallet) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Superadmin wallet not found' });
    }

    // Calculate split
    const superadminSharePercent = getLedgerSplitPercent();
    const adminSharePercent = getAdminSharePercent();
    const superadminAmount = Number((ledger.totalUSD * superadminSharePercent / 100).toFixed(4));
    const adminAmount = Number((ledger.totalUSD * adminSharePercent / 100).toFixed(4));

    // Update superadmin wallet
    superadminWallet.balanceUSD += superadminAmount;
    superadminWallet.totalEarned += superadminAmount;
    await superadminWallet.save({ session });

    // Get all managed admins
    const admins = await User.find({
      role: 'admin',
      _id: { $ne: req.user._id }
    }).session(session);

    // Split admin amount equally among all admins
    const adminCount = admins.length || 1;
    const amountPerAdmin = Number((adminAmount / adminCount).toFixed(4));

    // Update admin wallets
    if (admins.length > 0) {
      for (const admin of admins) {
        const adminWallet = await Wallet.findOne({ userId: admin._id }).session(session);
        if (adminWallet) {
          adminWallet.balanceUSD += amountPerAdmin;
          adminWallet.totalEarned += amountPerAdmin;
          await adminWallet.save({ session });
        }
      }
    }

    // Mark all included transactions as paid out
    const transactionIds = ledger.transactions.map(tx => tx._id);
    await Transaction.updateMany(
      { _id: { $in: transactionIds } },
      { 
        $set: { 
          payoutStatus: 'executed',
          payoutExecutedAt: new Date(),
          payoutExecutedBy: req.user._id
        } 
      },
      { session }
    );

    await session.commitTransaction();

    // Log payout execution
    logger.info(`Payout executed: ${ledger.count} transactions, $${ledger.totalUSD.toFixed(2)} total`, {
      superadminAmount,
      adminAmount,
      adminCount,
      amountPerAdmin,
      userId: req.user._id
    });

    res.json({
      success: true,
      message: 'Payout executed successfully',
      execution: {
        totalTransactions: ledger.count,
        totalAmount: ledger.totalUSD,
        superadminAmount,
        superadminSharePercent,
        adminAmount,
        adminSharePercent,
        adminsCount: admins.length,
        amountPerAdmin,
        executedAt: new Date(),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('Payout execution failed:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to execute payout: ' + error.message 
    });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
