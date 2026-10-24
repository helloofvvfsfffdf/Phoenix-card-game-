'use strict';
/* PHOENIX — minimal configurable email sender.
 *
 * Checks, in order:
 *   1. process.env.EMAIL_PROVIDER === 'sendgrid' + SENDGRID_API_KEY
 *   2. process.env.EMAIL_PROVIDER === 'resend' + RESEND_API_KEY
 *   3. Fallback: logs the message to the server console for private
 *      development (no external service required). A clear line is
 *      printed so nothing is mistaken for a real delivery.
 *
 * Never exposes private account data or codes in logs; never throws
 * in a way that crashes a player-facing endpoint.
 */
const https = require('https');

const FROM_ADDRESS = process.env.EMAIL_FROM || 'noreply@phoenix-card-game-1.onrender.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'PHOENIX';

function isConfigured() {
  return !!(
    process.env.EMAIL_PROVIDER &&
    ((process.env.EMAIL_PROVIDER === 'sendgrid' && process.env.SENDGRID_API_KEY) ||
     (process.env.EMAIL_PROVIDER === 'resend' && process.env.RESEND_API_KEY))
  );
}

function describeConfig() {
  if (!process.env.EMAIL_PROVIDER) return 'none-set (fallback: console-only for private builds)';
  if (process.env.EMAIL_PROVIDER === 'sendgrid') return 'sendgrid';
  if (process.env.EMAIL_PROVIDER === 'resend') return 'resend';
  return String(process.env.EMAIL_PROVIDER);
}

/** Send with the configured provider, or log for private testing. */
async function send(toAddress, subject, plainBody) {
  const provider = process.env.EMAIL_PROVIDER || 'console';

  if (provider === 'console' || !isConfigured()) {
    console.log('[PHOENIX email] NO EXTERNAL PROVIDER CONFIGURED. ' +
      'Private test mode: the email content below is logged but NOT delivered. ' +
      'Configure EMAIL_PROVIDER (sendgrid/resend) + the matching key for real delivery.');
    console.log('[PHOENIX email] TO: ' + toAddress);
    console.log('[PHOENIX email] SUBJECT: ' + subject);
    console.log('[PHOENIX email] BODY: ' + plainBody);
    console.log('[PHOENIX email] Configured provider: ' + describeConfig());
    // Return a safe synthetic result so the caller can continue.
    return { delivered: false, mode: 'console-log', provider: 'none' };
  }

  // SendGrid path (minimal v3 mail/send).
  if (provider === 'sendgrid' && process.env.SENDGRID_API_KEY) {
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
          resolve({ delivered: res.statusCode === 202, status: res.statusCode, raw: raw.slice(0, 200) });
        });
      });
      req.on('error', (e) => {
        console.error('[PHOENIX email] SendGrid send failed: ' + e.message);
        resolve({ delivered: false, error: e.message });
      });
      req.write(payload);
      req.end();
    });
  }

  // Resend path.
  if (provider === 'resend' && process.env.RESEND_API_KEY) {
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
        res.on('end', () => resolve({ delivered: res.statusCode === 200 || res.statusCode === 201, status: res.statusCode, raw: raw.slice(0, 200) }));
      });
      req.on('error', (e) => {
        console.error('[PHOENIX email] Resend send failed: ' + e.message);
        resolve({ delivered: false, error: e.message });
      });
      req.write(payload);
      req.end();
    });
  }

  // Unknown provider: fall back safely.
  console.log('[PHOENIX email] UNKNOWN PROVIDER: ' + provider);
  return { delivered: false, mode: 'unknown-provider', provider };
}

module.exports = { send, isConfigured, describeConfig, FROM_ADDRESS, FROM_NAME };
