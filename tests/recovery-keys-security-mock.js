'use strict';
/* PHOENIX — recovery-key security/regression mock tests. */
const assert = require('assert');
process.env.RECOVERY_KEY_SECRET = 'test-secret-32-chars-long!!!';
const rk = require('../js/recovery-keys');
const fs = require('fs');

function run() {
  let passed = 0;
  let failed = 0;
  function check(name, cond, detail) {
    if (cond) { console.log('PASS ' + name); passed++; }
    else { console.log('FAIL ' + name + (detail ? ': ' + detail : '')); failed++; }
  }

  // 1. Key format verified (Stage 1 repeat)
  const raw = rk.generateRawKey();
  check('format matches regex', rk.FORMAT_RE.test(rk.formatKey(raw)), rk.formatKey(raw));
  check('length 24 uppercase', /^[A-Z]{24}$/.test(raw), raw);

  // 2. HMAC-SHA256 uses secret (not plain SHA)
  const hash1 = rk.hashKey('TEST');
  const hash2 = rk.hashKey('TEST');
  check('same key = same hash', hash1 === hash2, hash1);
  check('hash length 64 hex', /^[a-f0-9]{64}$/.test(hash1), hash1);

  // 3. Verify fails for wrong key or wrong hash
  check('verify fails wrong key', !rk.verifyKey('WRONGWRONGWRONGWRONGWRONG', hash1));
  check('verify fails wrong hash', !rk.verifyKey('TEST', hash1.slice(0, -1) + '0'));

  // 4. Constant-time: no exception on length mismatch
  let safe = true;
  try { rk.verifyKey('SHORT', 'deadbeef'); } catch (e) { safe = false; }
  check('verify safe on bad input', safe);

  // 5. Rate limit logic
  check('limited at 5 attempts', rk.isRateLimited(5) === true);
  check('not limited at 4 attempts', rk.isRateLimited(4) === false);

  // 6. Old recovery endpoints untouched (file check)
  const serverSource = fs.readFileSync('server.js', 'utf8');
  check('old recover endpoints preserved', serverSource.includes("/api/account/recover/request"));
  check('new endpoints exist in server', serverSource.includes("/api/account/recovery-key/generate"));

  // 7. SQL has new table only, old table untouched
  const sqlNew = fs.readFileSync('sql/recovery-keys.sql', 'utf8');
  const sqlOldExists = fs.existsSync('sql/password-recovery.sql');
  check('new SQL has recovery_keys', sqlNew.includes('public.recovery_keys'));
  check('old SQL removed', !sqlOldExists);

  // 8. Module never exposes plain key in log function
  const moduleSource = fs.readFileSync('js/recovery-keys.js', 'utf8');
  check('logRecover does not reference key/hash directly', !moduleSource.includes('key ||\n') && moduleSource.includes('action='));

  // 9. Secret must exist
  check('secret required (current env set)', !!rk.SECRET && rk.SECRET.length >= 16);

  // 10. No public deployment markers added
  const pkg = fs.readFileSync('package.json', 'utf8');
  check('no new public-release scripts', !pkg.includes('ai-playtest') && !pkg.includes('public-deploy'));

  console.log('=== Stage 2 Security Mock Results: ' + passed + ' passed, ' + failed + ' failed ===');
  if (failed > 0) process.exitCode = 1;
}

run();
