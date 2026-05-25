const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const {
  sendSMS,
  sendVerificationSMS,
  smsConfigured,
  verificationSmsConfigured,
  sendgridClient,
} = require('../services/notificationService');
const { COUNTRIES } = require('../config/countries');
const { TOKEN_PACKAGES } = require('../config/monetization');
const devAuthStore = require('../services/devAuthStore');
const { isUserActivated } = require('../utils/activationWindow');

const CODE_TTL_SECONDS = 300;
const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60;
const fallbackStore = new Map();

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const getStoreKey = (namespace, key) => `${namespace}:${String(key).toLowerCase()}`;

const setCode = async (namespace, key, value, ttlSeconds = CODE_TTL_SECONDS) => {
  const storeKey = getStoreKey(namespace, key);
  try {
    const redis = getRedis();
    await redis.setex(storeKey, ttlSeconds, value);
    return;
  } catch {
    fallbackStore.set(storeKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
};

const getCode = async (namespace, key) => {
  const storeKey = getStoreKey(namespace, key);
  try {
    const redis = getRedis();
    return await redis.get(storeKey);
  } catch {
    const entry = fallbackStore.get(storeKey);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      fallbackStore.delete(storeKey);
      return null;
    }
    return entry.value;
  }
};

const clearCode = async (namespace, key) => {
  const storeKey = getStoreKey(namespace, key);
  try {
    const redis = getRedis();
    await redis.del(storeKey);
    return;
  } catch {
    fallbackStore.delete(storeKey);
  }
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const normalizeLoginIdentifier = (value = '') => String(value).trim().toLowerCase();
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const getApiBaseUrl = () =>
  (process.env.API_BASE_URL || process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/+$/, '');
const getFrontendBaseUrl = () =>
  (process.env.FRONTEND_URL || process.env.FRONTEND_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

const validateImagePayload = (value) =>
  typeof value === 'string' && (value.startsWith('data:image/') || value.startsWith('http'));
const isDatabaseReady = () => mongoose.connection.readyState === 1;
const normalizeLang = (raw = '') => String(raw || 'en').split(',')[0].trim().split('-')[0].toLowerCase() || 'en';
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
};
const getSecurityContext = (req, payload = {}) => ({
  ipAddress: getClientIp(req),
  userAgent: String(req.headers['user-agent'] || ''),
  acceptLanguage: String(req.headers['accept-language'] || ''),
  browserLanguage: String(payload.browser_language || ''),
  userLanguage: normalizeLang(payload.user_language || payload.browser_language || req.headers['accept-language'] || 'en'),
  cfIpCountry: String(req.headers['cf-ipcountry'] || ''),
  timezone: String(payload.timezone || req.headers['x-timezone'] || ''),
  deviceFingerprint: String(payload.device_fingerprint || req.headers['x-device-fingerprint'] || ''),
});

exports.sendOTP = async (req, res) => {
  try {
    const { phone, country } = req.body;
    if (!phone || !country) {
      return res.status(400).json({ success: false, message: 'Phone and country required' });
    }
    if (!COUNTRIES[country]) {
      return res.status(400).json({ success: false, message: 'Unsupported country' });
    }

    const otp = generateOTP();
    await setCode('otp', phone, otp);

    if (process.env.NODE_ENV === 'development' || !verificationSmsConfigured()) {
      if (!verificationSmsConfigured()) {
        logger.warn(`Infobip 2FA provider not configured. Returning OTP directly for ${phone}.`);
      }
      logger.info(`[DEV MODE] OTP generated for ${phone}: ${otp}`);
      return res.json({
        success: true,
        message: verificationSmsConfigured()
          ? 'OTP generated successfully'
          : 'Infobip not configured. OTP generated directly.',
        otp,
      });
    }

    const { pinId } = await sendVerificationSMS(phone);
    if (!pinId) {
      throw new Error('Failed to receive pinId from Infobip');
    }

    await setCode('infobip_pin', phone, pinId);
    logger.info(`OTP request registered for ${phone}`);
    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    logger.error(`sendOTP error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

exports.sendEmailVerification = async (req, res) => {
  try {
    const { email, firstName } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }
    const normalizedEmail = normalizeEmail(email);

    const existing = isDatabaseReady()
      ? await User.findOne({ email: normalizedEmail })
      : devAuthStore.findByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await setCode('email_verify_token', token, normalizedEmail, EMAIL_VERIFY_TTL_SECONDS);
    await clearCode('email_verified', normalizedEmail);
    const verifyLink = `${getApiBaseUrl()}/api/auth/verify-email-link?token=${encodeURIComponent(token)}`;

    await sendgridClient.sendEmail({
      to: normalizedEmail,
      subject: 'Verify your CashFlawHubs email',
      html: `<p>Hello ${firstName || 'there'},</p><p>Click below to verify your CashFlawHubs email address:</p><p><a href="${verifyLink}">${verifyLink}</a></p><p>This link expires in 24 hours.</p>`,
    });

    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV MODE] Email verification link for ${normalizedEmail}: ${verifyLink}`);
      return res.json({ success: true, message: 'Verification link generated', verifyLink });
    }

    res.json({ success: true, message: 'Verification email sent. Open the link in your inbox.' });
  } catch (error) {
    logger.error(`sendEmailVerification error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to send verification email' });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and verification code required' });
    }

    const storedCode = await getCode('email_otp', email);
    if (!storedCode || storedCode !== code) {
      return res.status(400).json({ success: false, message: 'Invalid or expired email verification code' });
    }

    await clearCode('email_otp', email);
    await setCode('email_verified', email, 'true');

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    logger.error(`verifyEmail error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to verify email' });
  }
};

exports.verifyEmailLink = async (req, res) => {
  const redirectBase = getFrontendBaseUrl();
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.redirect(`${redirectBase}/register?step=3&emailVerified=0&reason=missing_token`);
    }

    const email = await getCode('email_verify_token', token);
    if (!email) {
      return res.redirect(`${redirectBase}/register?step=3&emailVerified=0&reason=invalid_or_expired`);
    }

    const normalizedEmail = normalizeEmail(email);
    await clearCode('email_verify_token', token);
    await setCode('email_verified', normalizedEmail, 'true');

    return res.redirect(`${redirectBase}/register?step=3&emailVerified=1&email=${encodeURIComponent(normalizedEmail)}`);
  } catch (error) {
    logger.error(`verifyEmailLink error: ${error.message}`);
    return res.redirect(`${redirectBase}/register?step=3&emailVerified=0&reason=server_error`);
  }
};

exports.verifyPhoneOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP required' });
    }

    const useInfobip = process.env.NODE_ENV !== 'development' && verificationSmsConfigured();
    if (!useInfobip) {
      const storedCode = await getCode('otp', phone);
      if (!storedCode || storedCode !== String(otp)) {
        return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
      }
      await clearCode('otp', phone);
      await setCode('phone_verified', phone, 'true');
      return res.json({ success: true, message: 'Phone verified successfully' });
    }

    const pinId = await getCode('infobip_pin', phone);
    if (!pinId) {
      return res.status(400).json({ success: false, message: 'OTP session expired or invalid phone' });
    }

    const apiUrl = (process.env.INFOBIP_BASE_URL || 'https://api.infobip.com').replace(/\/+$/, '');
    const response = await axios.post(
      `${apiUrl}/2fa/2/pin/${encodeURIComponent(pinId)}/verify`,
      { pin: otp },
      {
        headers: {
          Authorization: `App ${process.env.INFOBIP_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 15000,
      }
    );

    if (!response.data?.verified) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    await clearCode('infobip_pin', phone);
    await setCode('phone_verified', phone, 'true');
    return res.json({ success: true, message: 'Phone verified successfully' });
  } catch (error) {
    logger.error(`verifyPhoneOTP error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to verify phone OTP' });
  }
};

exports.register = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      country,
      password,
      referralCode,
      idNumber,
      dateOfBirth,
      idDocumentImage,
      faceVerificationImage,
      browser_language,
      user_language,
      timezone,
      device_fingerprint,
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !country || !password) {
      return res.status(400).json({ success: false, message: 'Missing required registration fields' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }
    if (!COUNTRIES[country]) {
      return res.status(400).json({ success: false, message: 'Unsupported country' });
    }
    if (!referralCode) {
      return res.status(400).json({ success: false, message: 'Referral code is required' });
    }
    const phoneVerified = await getCode('phone_verified', phone);
    if (phoneVerified !== 'true') {
      return res.status(400).json({ success: false, message: 'Phone OTP verification required' });
    }
    const emailVerified = await getCode('email_verified', normalizeEmail(email));
    if (emailVerified !== 'true') {
      return res.status(400).json({ success: false, message: 'Email verification required' });
    }
    let existingPhone;
    let existingEmail;
    let existingId = null;

    if (isDatabaseReady()) {
      const checks = [
        User.findOne({ phone }),
        User.findOne({ email: email.toLowerCase() }),
      ];

      if (idNumber) {
        checks.push(User.findOne({ idNumber }));
      }

      [existingPhone, existingEmail, existingId] = await Promise.all(checks);
    } else {
      existingPhone = devAuthStore.findByPhone(phone);
      existingEmail = devAuthStore.findByEmail(email);
      existingId = idNumber ? devAuthStore.findByIdNumber(idNumber) : null;
    }

    if (existingPhone) return res.status(409).json({ success: false, message: 'Phone number already registered' });
    if (existingEmail) return res.status(409).json({ success: false, message: 'Email already registered' });
    if (existingId) return res.status(409).json({ success: false, message: 'ID number already registered' });

    let referrer = null;
    referrer = isDatabaseReady()
      ? await User.findOne({ referralCode })
      : devAuthStore.findByReferralCode(referralCode);
    if (!referrer) {
      return res.status(400).json({ success: false, message: 'Invalid referral code' });
    }
    const securityContext = getSecurityContext(req, { browser_language, user_language, timezone, device_fingerprint });

    const fullName = `${firstName} ${lastName}`.trim();
    const identityVerificationStatus =
      validateImagePayload(idDocumentImage) && validateImagePayload(faceVerificationImage) ? 'submitted' : 'pending';

    if (!isDatabaseReady()) {
      const user = await devAuthStore.createUser({
        firstName,
        lastName,
        name: fullName,
        email,
        phone,
        country,
        passwordHash: password,
        idNumber: idNumber || undefined,
        idDocumentImage: validateImagePayload(idDocumentImage) ? idDocumentImage : null,
        faceVerificationImage: validateImagePayload(faceVerificationImage) ? faceVerificationImage : null,
        identityVerificationStatus,
        referredBy: referrer ? referrer.referralCode : null,
        emailVerified: true,
        phoneVerified: true,
        dateOfBirth: dateOfBirth || null,
        browserLanguage: securityContext.browserLanguage || normalizeLang(securityContext.acceptLanguage),
        userLanguage: securityContext.userLanguage,
        lastAcceptLanguage: securityContext.acceptLanguage,
        timezone: securityContext.timezone,
      });

      const token = signToken(user.id);
      logger.warn(`MongoDB unavailable. Registered ${user.userId} using local development auth storage.`);

      return res.status(201).json({
        success: true,
        message: 'Registration successful',
        token,
        user: {
          ...user,
          paymentProvider: COUNTRIES[user.country]?.paymentProvider || null,
          paymentRouting: COUNTRIES[user.country]?.paymentRouting || { deposits: [], withdrawals: [] },
          tokenPackages: TOKEN_PACKAGES,
        },
      });
    }

    const user = await User.create({
      firstName,
      lastName,
      name: fullName,
      email: email.toLowerCase(),
      phone,
      country,
      passwordHash: password,
      idNumber: idNumber || undefined,
      idDocumentImage: validateImagePayload(idDocumentImage) ? idDocumentImage : null,
      faceVerificationImage: validateImagePayload(faceVerificationImage) ? faceVerificationImage : null,
      identityVerificationStatus,
      referredBy: referrer ? referrer.referralCode : null,
      emailVerified: true,
      phoneVerified: true,
      dateOfBirth: dateOfBirth || null,
      browserLanguage: securityContext.browserLanguage || normalizeLang(securityContext.acceptLanguage),
      userLanguage: securityContext.userLanguage,
      lastAcceptLanguage: securityContext.acceptLanguage,
      timezone: securityContext.timezone,
      registrationContext: {
        ...securityContext,
        registeredAt: new Date(),
      },
      securityEvents: [{
        ...securityContext,
        eventType: 'registration',
      }],
    });
    await clearCode('phone_verified', phone);
    await clearCode('email_verified', email);

    await Wallet.create({ userId: user._id });

    const token = signToken(user._id);
    logger.info(`New user registered: ${user.userId} from ${country}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: user._id,
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        dateOfBirth: user.dateOfBirth,
        referralCode: user.referralCode,
        userLanguage: user.userLanguage,
        browserLanguage: user.browserLanguage,
        activationStatus: isUserActivated(user),
        activationStatusRaw: user.activationStatus,
        emailVerified: user.emailVerified,
        identityVerificationStatus: user.identityVerificationStatus,
        tokenBalance: user.tokenBalance,
        totalTokensPurchased: user.totalTokensPurchased,
        totalTokensSpent: user.totalTokensSpent,
        paymentProvider: COUNTRIES[user.country]?.paymentProvider || null,
        paymentRouting: COUNTRIES[user.country]?.paymentRouting || { deposits: [], withdrawals: [] },
        tokenPackages: TOKEN_PACKAGES,
        role: user.role,
        userAccessType: user.userAccessType || 'real',
        level: user.level,
        managedBy: user.managedBy || null,
      },
    });
  } catch (error) {
    logger.error(`register error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { identifier, phone, email, password, browser_language, user_language, timezone, device_fingerprint } = req.body;
    const rawIdentifier = identifier || email || phone;
    if (!rawIdentifier || !password) {
      return res.status(400).json({ success: false, message: 'Email or phone and password required' });
    }

    const trimmedIdentifier = String(rawIdentifier).trim();
    const query = isValidEmail(trimmedIdentifier)
      ? { email: normalizeLoginIdentifier(trimmedIdentifier) }
      : { phone: trimmedIdentifier };

    if (!isDatabaseReady()) {
      const user = isValidEmail(trimmedIdentifier)
        ? devAuthStore.findByEmail(trimmedIdentifier)
        : devAuthStore.findByPhone(trimmedIdentifier);
      if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

      if (!user.isActive || user.isBanned) {
        return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
      }

      if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
        return res.status(429).json({ success: false, message: 'Account temporarily locked. Try again later.' });
      }

      const isMatch = await devAuthStore.verifyPassword(user, password);
      if (!isMatch) {
        devAuthStore.updateUser(user.id, (currentUser) => {
          const failedLoginAttempts = (currentUser.failedLoginAttempts || 0) + 1;
          return {
            ...currentUser,
            failedLoginAttempts,
            lockUntil: failedLoginAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
          };
        });
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const refreshedUser = devAuthStore.updateUser(user.id, (currentUser) => ({
        ...currentUser,
        failedLoginAttempts: 0,
        lockUntil: null,
        lastActiveDate: new Date().toISOString(),
        streak: currentUser.streak ? currentUser.streak + 1 : 1,
      })) || user;

      const token = signToken(refreshedUser.id);
      return res.json({
        success: true,
        token,
        user: {
          ...refreshedUser,
          paymentProvider: COUNTRIES[refreshedUser.country]?.paymentProvider || null,
          paymentRouting: COUNTRIES[refreshedUser.country]?.paymentRouting || { deposits: [], withdrawals: [] },
          tokenPackages: TOKEN_PACKAGES,
        },
      });
    }

    const user = await User.findOne(query).select('+passwordHash');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (user.isBanned) return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });

    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(429).json({ success: false, message: 'Account temporarily locked. Try again later.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      }
      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.updateStreak();
    const securityContext = getSecurityContext(req, { browser_language, user_language, timezone, device_fingerprint });
    user.browserLanguage = securityContext.browserLanguage || user.browserLanguage;
    user.lastAcceptLanguage = securityContext.acceptLanguage;
    user.timezone = securityContext.timezone || user.timezone;
    if (!user.userLanguage || !String(user.userLanguage).trim()) {
      user.userLanguage = securityContext.userLanguage;
    }
    user.securityEvents = [...(user.securityEvents || []), {
      ...securityContext,
      eventType: 'login',
    }].slice(-30);
    await user.save();

    const token = signToken(user._id);
    const wallet = await Wallet.findOne({ userId: user._id });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        dateOfBirth: user.dateOfBirth,
        referralCode: user.referralCode,
        userLanguage: user.userLanguage,
        browserLanguage: user.browserLanguage,
        activationStatus: isUserActivated(user),
        activationStatusRaw: user.activationStatus,
        identityVerificationStatus: user.identityVerificationStatus,
        tokenBalance: user.tokenBalance,
        totalTokensPurchased: user.totalTokensPurchased,
        totalTokensSpent: user.totalTokensSpent,
        paymentProvider: COUNTRIES[user.country]?.paymentProvider || null,
        paymentRouting: COUNTRIES[user.country]?.paymentRouting || { deposits: [], withdrawals: [] },
        tokenPackages: TOKEN_PACKAGES,
        role: user.role,
        userAccessType: user.userAccessType || 'real',
        level: user.level,
        xpPoints: user.xpPoints,
        streak: user.streak,
        badges: user.badges,
        balanceUSD: wallet?.balanceUSD || 0,
        managedBy: user.managedBy || null,
      },
    });
  } catch (error) {
    logger.error(`login error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

exports.getMe = async (req, res) => {
  try {
    if (!isDatabaseReady()) {
      const user = devAuthStore.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      return res.json({
        success: true,
        user: {
          ...user,
          activationStatus: isUserActivated(user),
          activationStatusRaw: user.activationStatus,
        },
        wallet: { balanceUSD: user.balanceUSD || 0 },
      });
    }

    const user = await User.findById(req.user.id);
    const wallet = await Wallet.findOne({ userId: user._id });
    res.json({
      success: true,
      user: {
        ...user.toObject(),
        activationStatus: isUserActivated(user),
        activationStatusRaw: user.activationStatus,
      },
      wallet,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
