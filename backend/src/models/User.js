const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const normalizeIdentityNumber = (value = '') => String(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    unique: true,
    default: function () {
      return this.idNumber ? `B${normalizeIdentityNumber(this.idNumber)}` : `USR-${uuidv4().slice(0, 8).toUpperCase()}`;
    },
  },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  name: { type: String, required: true, trim: true },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  passwordHash: { type: String, required: true, select: false },
  idNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
  },
  idDocumentImage: { type: String, default: null },
  faceVerificationImage: { type: String, default: null },
  identityVerificationStatus: {
    type: String,
    enum: ['pending', 'submitted', 'verified', 'rejected'],
    default: 'pending',
  },
  tokenBalance: { type: Number, default: 10, min: 0 },
  totalTokensPurchased: { type: Number, default: 0, min: 0 },
  totalTokensSpent: { type: Number, default: 0, min: 0 },
  country: {
    type: String,
    required: true,
    enum: ['KE', 'UG', 'TZ', 'ET', 'GH', 'NG'],
  },
  referralCode: {
    type: String,
    unique: true,
    default: () => `REF-${uuidv4().slice(0, 8).toUpperCase()}`,
  },
  referredBy: { type: String, default: null }, // referralCode of referrer
  activationStatus: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  dateOfBirth: { type: Date, default: null },
  userLanguage: { type: String, default: 'en' },
  browserLanguage: { type: String, default: 'en' },
  lastAcceptLanguage: { type: String, default: '' },
  timezone: { type: String, default: '' },
  registrationContext: {
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    acceptLanguage: { type: String, default: '' },
    browserLanguage: { type: String, default: '' },
    cfIpCountry: { type: String, default: '' },
    timezone: { type: String, default: '' },
    deviceFingerprint: { type: String, default: '' },
    registeredAt: { type: Date, default: null },
  },
  pending_email: {
    type: String,
    lowercase: true,
    trim: true,
    default: null,
  },
  email_change_token: { type: String, default: null, index: true },
  email_change_expires_at: { type: Date, default: null },
  securityEvents: [{
    eventType: { type: String, default: 'login' },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    acceptLanguage: { type: String, default: '' },
    browserLanguage: { type: String, default: '' },
    userLanguage: { type: String, default: '' },
    cfIpCountry: { type: String, default: '' },
    timezone: { type: String, default: '' },
    deviceFingerprint: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  }],

  // Gamification
  level: { type: Number, default: 1 },
  xpPoints: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastActiveDate: { type: Date, default: null },
  badges: [{ type: String }],

  // Stats
  totalEarned: { type: Number, default: 0 }, // in USD
  surveysCompleted: { type: Number, default: 0 },
  tasksCompleted: { type: Number, default: 0 },
  totalReferrals: { type: Number, default: 0 },

  // Security
  isActive: { type: Boolean, default: true },
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: null },
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },

  role: { type: String, enum: ['user', 'admin', 'superadmin', 'ledger'], default: 'user' },
  userAccessType: { type: String, enum: ['real', 'test'], default: 'real' },

  managedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  managedAt: { type: Date, default: null },

  // Profile
  avatar: { type: String, default: null },
  bio: { type: String, default: null },
}, {
  timestamps: true,
});

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

userSchema.pre('validate', function (next) {
  if ((!this.name || !this.name.trim()) && (this.firstName || this.lastName)) {
    this.name = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }

  if (this.idNumber) {
    this.idNumber = normalizeIdentityNumber(this.idNumber);
    this.userId = `B${this.idNumber}`;
  }

  next();
});

userSchema.pre('save', async function (next) {
  if (!this.isNew) return next();
  const User = this.constructor;
  let attempts = 0;
  while (attempts < 5) {
    const [refExists, userIdExists] = await Promise.all([
      User.exists({ referralCode: this.referralCode }),
      User.exists({ userId: this.userId }),
    ]);
    if (!refExists && !userIdExists) return next();
    if (refExists) this.referralCode = `REF-${uuidv4().slice(0, 8).toUpperCase()}`;
    if (userIdExists && !this.idNumber) this.userId = `USR-${uuidv4().slice(0, 8).toUpperCase()}`;
    attempts += 1;
  }
  return next(new Error('Unable to generate unique user identifiers'));
});

// Compare password
userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

// Update streak
userSchema.methods.updateStreak = function () {
  const today = new Date().toDateString();
  const lastActive = this.lastActiveDate ? new Date(this.lastActiveDate).toDateString() : null;
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  if (lastActive === today) return;
  if (lastActive === yesterday) {
    this.streak += 1;
  } else {
    this.streak = 1;
  }
  this.lastActiveDate = new Date();
};

// Level up based on XP
userSchema.methods.checkLevelUp = function () {
  const levels = [0, 100, 300, 600, 1000, 1500, 2200, 3000];
  for (let i = levels.length - 1; i >= 0; i--) {
    if (this.xpPoints >= levels[i]) {
      this.level = i + 1;
      break;
    }
  }
};

userSchema.methods.creditTokens = function (amount) {
  this.tokenBalance += amount;
  this.totalTokensPurchased += amount;
};

userSchema.methods.consumeTokens = function (amount) {
  if (this.tokenBalance < amount) {
    throw new Error('Insufficient tokens');
  }
  this.tokenBalance -= amount;
  this.totalTokensSpent += amount;
};

userSchema.index({ country: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);
