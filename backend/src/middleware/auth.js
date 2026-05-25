const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const devAuthStore = require('../services/devAuthStore');
const { isUserActivated } = require('../utils/activationWindow');

exports.protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = mongoose.connection.readyState === 1
      ? await User.findById(decoded.id)
      : devAuthStore.findById(decoded.id);
    if (!user || !user.isActive || user.isBanned) {
      return res.status(401).json({ success: false, message: 'User not found or suspended' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

exports.adminOnly = (req, res, next) => {
  if (!['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

exports.superadminOnly = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Superadmin access required' });
  }
  next();
};

exports.ledgerOnly = (req, res, next) => {
  if (req.user.role !== 'ledger') {
    return res.status(403).json({ success: false, message: 'Ledger access required' });
  }
  next();
};

exports.ledgerOrSuperadminOnly = (req, res, next) => {
  if (!['ledger', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Ledger or superadmin access required' });
  }
  next();
};

exports.staffOnly = (req, res, next) => {
  if (!['admin', 'superadmin', 'ledger'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Staff access required' });
  }
  next();
};

exports.requireActivation = (req, res, next) => {
  if (!isUserActivated(req.user)) {
    return res.status(403).json({ success: false, message: 'Account activation required' });
  }
  next();
};

exports.requireTestUserModuleAccess = (moduleLabel = 'this module') => (req, res, next) => {
  if (req.user.role !== 'user') return next();
  if (String(req.user.userAccessType || 'real') === 'test') return next();
  return res.status(403).json({
    success: false,
    code: 'MODULE_COMING_SOON',
    message: `${moduleLabel} is coming soon for real users.`,
    description: `We are onboarding ${moduleLabel.toLowerCase()} in phases. Your account will get access after rollout.`,
  });
};
