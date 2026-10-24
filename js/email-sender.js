'use strict';
/* PHOENIX — minimal configurable email sender.
 *
 * Providers (checked in order, first configured wins):
 *   1. EMAIL_PROVIDER=gmail + GMAIL_USER + GMAIL_APP_PASSWORD
 *   2. EMAIL_PROVIDER=sendgrid + SENDGRID_API_KEY
 *   3. EMAIL_PROVIDER=resend + RESEND_API_KEY
 *
 * Gmail: uses Nodemailer with Gmail SMTP (App Password required — not
 * the normal account password). Never logs codes/hashes in production.
 *
 * Never exposes private account data or codes in logs; never throws
 * in a way that crashes a player-facing endpoint.
 */
const https = require('https');

const FROM_ADDRESS = process.env.EMAIL_FROM || 'noreply@phoenix-card-game-1.onrender.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'PHOENIX';

/** Production: suppress plaintext code/body logging. */
function isProduction() {
  return (process.env.NODE_ENV === 'production' || !!process.env.RENDER || !!process.env.PHOENIX_PRODUCTION);
}

function isConfigured() {
  const provider = process.env.EMAIL_PROVIDER || '';
  if (provider === 'gmail') {
    return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  }
  if (provider === 'sendgrid') {
    return !!process.env.SENDGRID_API_KEY;
  }
  if (provider === 'resend') {
    return !!process.env.RESEND_API_KEY;
  }
  return false;
}

function describeConfig() {
  const p = process.env.EMAIL_PROVIDER || 'none';
  if (p === 'gmail') return 'gmail';
  if (p === 'sendgrid') return 'sendgrid';
  if (p === 'resend') return 'resend';
  return p + ' (not fully configured)';
}

function safeLog(action, context) {
  if (isProduction() && context && context.logBody === false) {
    // In production, never log email body content that may contain codes.
    return;
  }
  const domain = context && context.email ? String(context.email).split('@')[1] || 'unknown' : 'none';
  console.log('[PHOENIX email] action=' + String(action) +
    ' | domain=' + domain +
    ' | provider=' + describeConfig() +
    (context && context.dbError ? ' | dbError=' + context.dbError : ''));
}

/* ------------------------------------------------------------------ */
/* Gmail SMTP transport                                                  */
/* ------------------------------------------------------------------ */

function sendGmail(toAddress, subject, plainBody) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      },
      tls: { rejectUnauthorized: true }
    });
    return transporter.sendMail({
      from: FROM_NAME + ' <' + FROM_ADDRESS + '>',
      to: toAddress,
      subject: subject,
      text: plainBody
    }).then(info => {
      safeLog('gmail-delivered', { email: toAddress, logBody: false });
      return { delivered: true, mode: 'gmail', provider: 'gmail', messageId: info.messageId || null };
    }).catch(err => {
      console.error('[PHOENIX email] Gmail SMTP failed: ' + err.message);
      safeLog('gmail-failed', { email: toAddress, dbError: 'SMTP-' + (err.code || 'ERROR'), logBody: false });
      return { delivered: false, mode: 'gmail-failed', provider: 'gmail', error: err.message };
    });
  } catch (e) {
    console.error('[PHOENIX email] Gmail transport load failed: ' + e.message);
    return Promise.resolve({ delivered: false, mode: 'gmail-load-failed', provider: 'gmail', error: e.message });
  }
}

/* ------------------------------------------------------------------ */
/* SendGrid transport                                                   */
/* ------------------------------------------------------------------ */

function sendSendGrid(toAddress, subject, plainBody) {
  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: toAddress }] }],
    from: { email: FROM_ADDRESS, name: FROM_NAME },
    subject,
    content: [{ type: 'text/plain', value: plainBody }]
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let raw = '';
      res.on('data', (b) => raw += b);
      res.on('end', () => {
        const delivered = res.statusCode === 202;
        safeLog('sendgrid-' + (delivered ? 'delivered' : 'failed'), { email: toAddress, dbError: delivered ? 'none' : String(res.statusCode), logBody: false });
        resolve({ delivered, status: res.statusCode, raw: raw.slice(0, 200), provider: 'sendgrid' });
      });
    });
    req.on('error', (e) => {
      console.error('[PHOENIX email] SendGrid send failed: ' + e.message);
      safeLog('sendgrid-error', { email: toAddress, dbError: 'NETWORK', logBody: false });
      resolve({ delivered: false, error: e.message, provider: 'sendgrid' });
    });
    req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Resend transport                                                     */
/* ------------------------------------------------------------------ */

function sendResend(toAddress, subject, plainBody) {
  const payload = JSON.stringify({
    from: FROM_NAME + ' <' + FROM_ADDRESS + '>',
    to: [toAddress],
    subject,
    text: plainBody
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let raw = '';
      res.on('data', (b) => raw += b);
      res.on('end', () => {
        const delivered = res.statusCode === 200 || res.statusCode === 201;
        safeLog('resend-' + (delivered ? 'delivered' : 'failed'), { email: toAddress, dbError: delivered ? 'none' : String(res.statusCode), logBody: false });
        resolve({ delivered, status: res.statusCode, raw: raw.slice(0, 200), provider: 'resend' });
      });
    });
    req.on('error', (e) => {
      console.error('[PHOENIX email] Resend send failed: ' + e.message);
      safeLog('resend-error', { email: toAddress, dbError: 'NETWORK', logBody: false });
      resolve({ delivered: false, error: e.message, provider: 'resend' });
    });
    req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Main send dispatcher                                                 */
/* ------------------------------------------------------------------ */

async function send(toAddress, subject, plainBody) {
  const provider = process.env.EMAIL_PROVIDER || 'console';

  if (provider === 'gmail' && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return sendGmail(toAddress, subject, plainBody);
  }

  if (provider === 'sendgrid' && process.env.SENDGRID_API_KEY) {
    return sendSendGrid(toAddress, subject, plainBody);
  }

  if (provider === 'resend' && process.env.RESEND_API_KEY) {
    return sendResend(toAddress, subject, plainBody);
  }

  // Production mode: never fall back to console logging of email bodies.
  if (isProduction()) {
    safeLog('production-no-provider', { email: toAddress.split('@')[1] || 'none', dbError: 'NO-PROVIDER', rate: false, provider: provider, logBody: false });
    return { delivered: false, mode: 'production-no-provider', provider, error: 'No email provider configured in production.' };
  }

  // Private/test mode only: log safely without exposing the code content.
  const bodyHasCode = plainBody && /\b\d{6}\b/.test(plainBody);
  safeLog('test-mode-log', { email: toAddress.split('@')[1] || 'none', dbError: 'none', rate: false, provider: 'console', logBody: false });

  // Show only the first line (subject + brief note) in production-mode logs,
  // never the full body, to avoid logging the 6-digit code even in private mode.
  if (!isProduction() && bodyHasCode) {
    // Private test only: safe, brief indication for local verification.
    console.log('[PHOENIX email] PRIVATE TEST MODE — email NOT delivered. ' +
      'Provider: ' + describeConfig() +
      ' | To verify delivery, set EMAIL_PROVIDER + matching API/App-Password key.');
    console.log('[PHOENIX email] Subject: ' + subject);
    // Intentionally NEVER log the body that contains the 6-digit code.
  }

  return { delivered: false, mode: 'console-only', provider: 'none', note: 'Private build — configure EMAIL_PROVIDER for real delivery.' };
}

module.exports = { send, isConfigured, describeConfig, FROM_ADDRESS, FROM_NAME, isProduction };
