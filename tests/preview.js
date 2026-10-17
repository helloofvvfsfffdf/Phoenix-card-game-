'use strict';
/*
 * tests/preview.js — a click-through demo server.
 *
 * Boots the REAL server.js against the fake database the security suite uses,
 * seeds an owner, a few players and a spread of restrictions, then prints a
 * URL you can open. Nothing here is part of the game; it exists so the email
 * verification screen, the ban screen and Ban Management can be looked at in a
 * browser rather than only described in a test log.
 *
 * Run:  node tests/preview.js
 */

const path = require('path');
const bcrypt = require('bcryptjs');
const { startFakeSupabase, startServer, stopServer } = require('./security-tests.js');

const OWNER_PASSWORD = 'preview-owner-password-1234';

function find(state, username) {
  return state.accounts.find(a => a.username === username);
}

async function main() {
  const fake = await startFakeSupabase();
  const state = fake.state;

  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const id = () => require('crypto').randomUUID();
  const hash = pw => bcrypt.hashSync(pw, 10);

  /* ---------------- accounts ---------------- */

  const owner = {
    id: id(), username: 'phoenixowner', role: 'owner',
    // The same password as every other seeded account, so the instructions
    // printed at startup are true for the owner too. OWNER_PASSWORD below is
    // the separate, legacy OWNER & FRIENDS room password.
    password_hash: hash('password-1234'),
    email: 'owner@phoenix.example', email_verified_at: iso(now),
    created_at: iso(now - 90 * 864e5)
  };
  state.accounts.push(owner);

  // A player who verified, one who has not, and one made BEFORE this feature
  // existed (no email at all) - the three states the screens have to handle.
  state.accounts.push({
    id: id(), username: 'vera', role: 'player', password_hash: hash('password-1234'),
    email: 'vera@example.com', email_verified_at: iso(now),
    created_at: iso(now - 40 * 864e5)
  });
  state.accounts.push({
    id: id(), username: 'newplayer', role: 'player', password_hash: hash('password-1234'),
    email: 'newplayer@example.com', email_verified_at: null,
    created_at: iso(now - 2 * 864e5)
  });
  const veteran = {
    id: id(), username: 'veteran', role: 'player', password_hash: hash('password-1234'),
    email: null, email_verified_at: null, created_at: iso(now - 300 * 864e5)
  };
  state.accounts.push(veteran);
  state.accounts.push({
    id: id(), username: 'hank', role: 'player', password_hash: hash('password-1234'),
    email: 'hank@example.com', email_verified_at: iso(now),
    created_at: iso(now - 20 * 864e5)
  });
  state.accounts.push({
    id: id(), username: 'iris', role: 'player', password_hash: hash('password-1234'),
    email: 'iris@example.com', email_verified_at: iso(now),
    created_at: iso(now - 15 * 864e5)
  });

  /* ---------------- restrictions to look at ---------------- */

  const hank = find(state, 'hank');
  const iris = find(state, 'iris');

  state.moderation_bans.push({
    id: id(), kind: 'account', account_id: hank.id, account_name: 'hank',
    ip: null, ip_key: null, device_id: null,
    reason: 'Repeated cheating', duration: null, expires_at: null,
    created_at: iso(now - 3 * 864e5), created_by: owner.id, created_by_name: 'phoenixowner',
    revoked_at: null, revoked_by: null, revoked_by_name: null
  });

  // A temporary one, already part-way through.
  state.moderation_bans.push({
    id: id(), kind: 'account', account_id: iris.id, account_name: 'iris',
    ip: null, ip_key: null, device_id: null,
    reason: 'Unsportsmanlike conduct', duration: 604800,
    expires_at: iso(now + 4 * 864e5),
    created_at: iso(now - 3 * 864e5), created_by: owner.id, created_by_name: 'phoenixowner',
    revoked_at: null, revoked_by: null, revoked_by_name: null
  });

  // One that was lifted, so the REVOKED filter has something to show.
  state.moderation_bans.push({
    id: id(), kind: 'ip', account_id: null, account_name: 'vera',
    ip: '203.0.113.9', ip_key: '203.0.113.9', device_id: null,
    reason: 'Shared address during an incident', duration: 86400,
    expires_at: iso(now + 864e5),
    created_at: iso(now - 6 * 864e5), created_by: owner.id, created_by_name: 'phoenixowner',
    revoked_at: iso(now - 5 * 864e5), revoked_by: owner.id, revoked_by_name: 'phoenixowner'
  });

  // The audit trail, so the log panel is not empty on first look.
  state.moderation_log.push(
    { id: id(), at: iso(now - 6 * 864e5), action: 'restriction.issued',
      actor_id: owner.id, actor_name: 'phoenixowner', subject_name: 'vera',
      ban_id: null, detail: 'ip | until ' + iso(now + 864e5) },
    { id: id(), at: iso(now - 5 * 864e5), action: 'restriction.lifted',
      actor_id: owner.id, actor_name: 'phoenixowner', subject_name: 'vera',
      ban_id: null, detail: 'ip' },
    { id: id(), at: iso(now - 3 * 864e5), action: 'restriction.issued',
      actor_id: owner.id, actor_name: 'phoenixowner', subject_name: 'hank',
      ban_id: null, detail: 'account | permanent' },
    { id: id(), at: iso(now - 3 * 864e5), action: 'restriction.issued',
      actor_id: owner.id, actor_name: 'phoenixowner', subject_name: 'iris',
      ban_id: null, detail: 'account | until ' + iso(now + 4 * 864e5) },
    { id: id(), at: iso(now - 40 * 864e5), action: 'email.verified',
      actor_id: find(state, 'vera').id, actor_name: 'vera', subject_name: 'vera',
      ban_id: null, detail: 'address proven' }
  );

  /* ---------------- announcements, so the menu is not bare ---------------- */

  state.announcements = state.announcements || [];
  state.announcements.push({
    id: id(), body: 'Welcome to PHOENIX. Every account now needs a verified email.',
    created_at: iso(now - 3600e3)
  });

  /* ---------------- the real server ---------------- */

  const bundle = await startServer(fake.url, {
    PHOENIX_OWNER_PASSWORD: OWNER_PASSWORD
  });

  const url = 'http://localhost:' + bundle.port;
  const line = s => console.log(s);
  line('');
  line('  ─────────────────────────────────────────────────────────────');
  line('  PHOENIX preview is up:  ' + url);
  line('  ─────────────────────────────────────────────────────────────');
  line('');
  line('  Sign in as any of these (password for all: password-1234)');
  line('');
  line('    phoenixowner   the OWNER. Open SERVER to see Ban Management,');
  line('                   plus the verification and ban screens.');
  line('    vera           verified. Plays straight away.');
  line('    newplayer      has an address but has NOT verified it, so the');
  line('                   mandatory update screen appears.');
  line('    veteran        made before this feature existed - no email at');
  line('                   all. Sees the same mandatory screen.');
  line('    hank           PERMANENTLY banned. Shows the ban screen.');
  line('    iris           temporarily banned. Shows the expiry date.');
  line('');
  line('  Owner dashboard: sign in as phoenixowner, then press SERVER.');
  line('  Search "vera" or "hank" to see an account and its restrictions.');
  line('');
  line('  This server uses a FAKE database in memory. Nothing you type');
  line('  here is stored, and it stops when you press Ctrl+C.');
  line('');
  line('  Press Ctrl+C to stop.');
  line('');

  const bye = async () => {
    line('\nStopping preview…');
    await stopServer(bundle);
    await fake.close();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
