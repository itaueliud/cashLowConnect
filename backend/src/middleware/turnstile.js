const axios = require('axios');
const logger = require('../utils/logger');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const hasTurnstileSecret = () => Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SECRET_KEY.trim());
const isBypassEnabled = () => String(process.env.TURNSTILE_BYPASS_LOCALHOST || 'true').toLowerCase() === 'true';

const isLocalRequest = (req) => {
  const hostHeader = String(req.headers.host || '').toLowerCase();
  const host = hostHeader.split(':')[0];
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').toLowerCase();
  const ip = String(req.ip || '').toLowerCase();

  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    ip.includes('127.0.0.1') ||
    ip.includes('::1') ||
    forwardedFor.includes('127.0.0.1') ||
    forwardedFor.includes('::1')
  );
};

const getTurnstileToken = (req) =>
  req.body?.turnstileToken ||
  req.body?.cfTurnstileResponse ||
  req.body?.['cf-turnstile-response'] ||
  req.headers['cf-turnstile-response'];

const isStaffPortalLogin = (req) => {
  if (req.path !== '/login') return false;
  const portal = String(req.body?.portal || '').trim().toLowerCase();
  return ['admin', 'superadmin', 'ledger'].includes(portal);
};

const verifyTurnstile = async (req, res, next) => {
  if (isStaffPortalLogin(req)) {
    return next();
  }

  const allowLocalBypass = isBypassEnabled() && isLocalRequest(req);

  if (!hasTurnstileSecret()) {
    if (process.env.NODE_ENV === 'production' && !allowLocalBypass) {
      logger.error('TURNSTILE_SECRET_KEY is not configured');
      return res.status(500).json({ success: false, message: 'Security verification is not configured' });
    }

    if (allowLocalBypass) {
      logger.warn(`Turnstile bypassed for localhost request ${req.method} ${req.originalUrl} because TURNSTILE_SECRET_KEY is not configured`);
    }

    return next();
  }

  const token = getTurnstileToken(req);
  if (!token) {
    if (allowLocalBypass) {
      logger.warn(`Turnstile bypassed for localhost request ${req.method} ${req.originalUrl} due to missing token`);
      return next();
    }
    return res.status(400).json({ success: false, message: 'Complete the security check and try again' });
  }

  try {
    const params = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
    });

    if (req.ip) {
      params.append('remoteip', req.ip);
    }

    const { data } = await axios.post(TURNSTILE_VERIFY_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
    });

    if (!data?.success) {
      if (allowLocalBypass) {
        logger.warn(`Turnstile verification failed but bypassed for localhost request ${req.method} ${req.originalUrl}: ${JSON.stringify(data?.['error-codes'] || [])}`);
        return next();
      }
      logger.warn(`Turnstile verification failed for ${req.method} ${req.originalUrl}: ${JSON.stringify(data?.['error-codes'] || [])}`);
      return res.status(403).json({ success: false, message: 'Security verification failed' });
    }

    return next();
  } catch (error) {
    if (allowLocalBypass) {
      logger.warn(`Turnstile verification error but bypassed for localhost request ${req.method} ${req.originalUrl}: ${error.message}`);
      return next();
    }
    logger.error(`Turnstile verification error for ${req.method} ${req.originalUrl}: ${error.message}`);
    return res.status(502).json({ success: false, message: 'Security verification service unavailable' });
  }
};

module.exports = { verifyTurnstile };
