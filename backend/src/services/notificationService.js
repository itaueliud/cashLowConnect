const logger = require('../utils/logger');
const axios = require('axios');

const smsConfigured = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);

const verificationSmsConfigured = () =>
  Boolean(
    process.env.INFOBIP_API_KEY &&
      process.env.INFOBIP_SENDER &&
      process.env.INFOBIP_APPLICATION_ID &&
      process.env.INFOBIP_MESSAGE_ID
  );

const sendVerificationSMS = async (phone) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV VERIFICATION SMS] To: ${phone}`);
      return {
        pinId: null,
      };
    }
    if (!verificationSmsConfigured()) {
      throw new Error('Infobip 2FA provider is not configured');
    }

    const apiUrl = (process.env.INFOBIP_BASE_URL || 'https://api.infobip.com').replace(/\/+$/, '');
    const response = await axios.post(
      `${apiUrl}/2fa/2/pin`,
      {
        applicationId: process.env.INFOBIP_APPLICATION_ID,
        messageId: process.env.INFOBIP_MESSAGE_ID,
        to: phone,
      },
      {
        headers: {
          Authorization: `App ${process.env.INFOBIP_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 15000,
      }
    );

    const pinId = response.data?.pinId;
    if (!pinId) {
      throw new Error('Missing pinId from Infobip response');
    }

    logger.info(`Verification OTP requested for ${phone}, pinId=${pinId}`);
    return { pinId };
  } catch (error) {
    logger.error(`Verification SMS send failed to ${phone}: ${error.message}`);
    throw error;
  }
};

// SMS via Twilio
const sendSMS = async (phone, message) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV SMS] To: ${phone} | Message: ${message}`);
      return;
    }
    if (!smsConfigured()) {
      throw new Error('SMS provider is not configured');
    }
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
    logger.info(`SMS sent to ${phone}`);
  } catch (error) {
    logger.error(`SMS send failed to ${phone}: ${error.message}`);
    throw error;
  }
};

// Email via Nodemailer
const sendEmail = async (to, subject, html) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV EMAIL] To: ${to} | Subject: ${subject}`);
      return;
    }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({ from: `CashFlawHubs <${process.env.SMTP_USER}>`, to, subject, html });
    logger.info(`Email sent to ${to}`);
  } catch (error) {
    logger.error(`Email send failed to ${to}: ${error.message}`);
  }
};

const sendgridClient = {
  sendEmail: async ({ to, subject, html }) => {
    const shouldBypassInDev =
      process.env.NODE_ENV === 'development' && String(process.env.SENDGRID_ENABLE_IN_DEV || '').toLowerCase() !== 'true';
    if (shouldBypassInDev) {
      logger.info(`[DEV SENDGRID] To: ${to} | Subject: ${subject}`);
      return;
    }
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    const fromName = process.env.SENDGRID_FROM_NAME || 'CashFlawHubs';

    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY is required');
    }
    if (!fromEmail) {
      throw new Error('SENDGRID_FROM_EMAIL is required');
    }

    await axios.post(
      'https://api.sendgrid.com/v3/mail/send',
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: fromName },
        subject,
        content: [{ type: 'text/html', value: html }],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
  },
};

// Activation notification
const sendActivationNotification = async ({ userId, referredBy }) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(userId);
    if (!user) return;

    await sendSMS(user.phone,
      `🎉 Welcome to CashFlawHubs! Your account is now active. Start earning from surveys, tasks, and remote jobs. Earn 200 KES per referral: ${process.env.FRONTEND_URL}/signup?ref=${user.referralCode}`
    );

    if (referredBy) {
      const referrer = await User.findOne({ referralCode: referredBy });
      if (referrer) {
        await sendSMS(referrer.phone,
      `💰 Great news! Your referral has activated their CashFlawHubs account. You've earned a reward! Check your wallet.`
        );
      }
    }
  } catch (error) {
    logger.error(`sendActivationNotification error: ${error.message}`);
  }
};

module.exports = {
  sendSMS,
  sendVerificationSMS,
  sendEmail,
  sendActivationNotification,
  smsConfigured,
  verificationSmsConfigured,
  sendgridClient,
};
