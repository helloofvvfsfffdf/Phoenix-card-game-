'use strict';
/* PHOENIX — recovery-key system (replaces email-based password recovery).
 *
 * Uses HMAC-SHA256 with RECOVERY_KEY_SECRET (server-side env only).
 * Stores only the hash in public.recovery_keys. Plaintext key is shown
 * once to the user and never persisted, never logged, never exposed.
 */
const crypto = require('crypto');

const SECRET = String(process.env.RECOVERY_KEY_SECRET || '').trim();
const KEY_LENGTH = 24;          // uppercase letters
const GROUP_SIZE = 4;
const GROUP_COUNT = KEY_LENGTH / GROUP_SIZE; // 6 groups
const FORMAT_RE = /^([A-Z]{4}-){5}[A-Z]{4}$/;

function assertSecret() {
  if (!SECRET || SECRET.length < 16) {
    throw new Error('RECOVERY_KEY_SECRET must be set to at least 16 characters');
  }
}

/* ------------------------------------------------------------------ */
/* Secure random 24-letter uppercase key                                 */
/* ------------------------------------------------------------------ */
function generateRawKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(KEY_LENGTH);
  let out = '';
  for (let i = 0; i < KEY_LENGTH; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  // Reject any result that has non-A-Z characters (shouldn't happen,
  // but enforce strictly for security).
  if (!/^[A-Z]{24}$/.test(out)) {
    return generateRawKey();
  }
  return out;
}

function formatKey(raw) {
  const r = normalizeKey(raw);
  if (r.length !== KEY_LENGTH) throw new Error('Invalid key length');
  const groups = [];
  for (let i = 0; i < GROUP_COUNT; i++) {
    groups.push(r.slice(i * GROUP_SIZE, i * GROUP_SIZE + GROUP_SIZE));
  }
  return groups.join('-');
}

function normalizeKey(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/[^A-Z]/gi, '')
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/* HMAC-SHA-256 hash (constant-time compare)                             */
/* ------------------------------------------------------------------ */
function hashKey(key) {
  assertSecret();
  return crypto.createHmac('sha256', SECRET).update(normalizeKey(key)).digest('hex');
}

function verifyKey(key, hash) {
  assertSecret();
  const computed = hashKey(key);
  if (!hash || computed.length !== hash.length) return false;
  try {
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(String(hash), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Safe diagnostics — NEVER log keys or hashes                          */
/* ------------------------------------------------------------------ */
function logRecover(action, safeContext) {
  const ctx = safeContext || {};
  // Never include key/hash/account id that could expose identity.
  console.log('[PHOENIX recover-key] action=' + String(action) +
    ' | attempts=' + (ctx.attempts === undefined ? 'n/a' : String(ctx.attempts)) +
    ' | rate=' + (ctx.rate ? 'limited' : 'ok'));
}

/* ------------------------------------------------------------------ */
/* Rate limits                                                           */
/* ------------------------------------------------------------------ */
const MAX_ATTEMPTS = 5;

function isRateLimited(attempts) {
  return Number(attempts || 0) >= MAX_ATTEMPTS;
}

function buildRateResponse(attempts, retryInSeconds) {
  return {
    ok: false,
    code: 'COOLDOWN',
    message: 'Too many recovery attempts. Try again later.',
    attempts: Number(attempts || 0),
    retryInSeconds: retryInSeconds || 60
  };
}

module.exports = {
  generateRawKey,
  formatKey,
  normalizeKey,
  hashKey,
  verifyKey,
  FORMAT_RE,
  isRateLimited,
  buildRateResponse,
  logRecover,
  KEY_LENGTH,
  GROUP_SIZE,
  GROUP_COUNT,
  MAX_ATTEMPTS,
  SECRET // exported only for mock tests; never exposed in responses
};
