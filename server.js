
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const Rules = require('./js/rules.js');
const Cards = require('./js/cards.js');
const Maple = require('./js/maple.js');
const Effects = require('./js/effects.js');
const Gallery = require('./js/gallery.js');
const Auth = require('./js/auth.js');
const Badges = require('./js/badges.js');
const Achievements = require('./js/achievements.js');
const Announcements = require('./js/announcements.js');
const Wins = require('./js/wins.js');
const EmailVerification = require('./js/email-verification.js');
const Moderation = require('./js/moderation.js');
const interactionView = require('./js/interaction-view.js');
const SpeedInteraction = require('./js/speed-interaction.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const OWNER_PASSWORD = process.env.PHOENIX_OWNER_PASSWORD || '';
const MODE_ACCESS_CODE = process.env.PHOENIX_MODE_ACCESS_CODE || '';

if (MODE_ACCESS_CODE.length < 12 || MODE_ACCESS_CODE.length > 256) {
  console.error('Set PHOENIX_MODE_ACCESS_CODE to a private access code of 12-256 characters.');
  process.exit(1);
}

if (!OWNER_PASSWORD || OWNER_PASSWORD.length < 24) {
  console.error('Set PHOENIX_OWNER_PASSWORD to a private password of at least 24 characters before starting the server.');
  process.exit(1);
}

const authFailures = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_MS = 30 * 60 * 1000;
const AUTH_MAX_FAILURES = 3;

// Room creation is now open to every visitor (the owner password no longer
// unlocks it), so it gets its own per-IP budget and a hard ceiling. Both can be
// overridden for testing; production keeps the defaults.
const MAX_ROOMS = Number(process.env.PHOENIX_MAX_ROOMS) || 5;
const MAX_CREATES_PER_IP = Number(process.env.PHOENIX_CREATE_LIMIT) || 8;
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const creationTimes = new Map();

function clientIp(ws) {
  return ws._socket?.remoteAddress || 'unknown';
}

function authRecord(ip, now) {
  let record = authFailures.get(ip);
  if (!record) record = { failures: [], lockedUntil: 0 };

  record.failures = record.failures.filter(
    t => now - t < AUTH_WINDOW_MS
  );

  if (record.lockedUntil && record.lockedUntil <= now) {
    record.lockedUntil = 0;
    record.failures = [];
  }

  authFailures.set(ip, record);
  return record;
}

const authCleanup = setInterval(() => {
  const now = Date.now();

  for (const [ip, record] of authFailures) {
    if (
      record.lockedUntil <= now &&
      record.failures.every(t => now - t >= AUTH_WINDOW_MS)
    ) {
      authFailures.delete(ip);
    }
  }
}, 60 * 60 * 1000);

authCleanup.unref();

/**
 * Owner-controlled server switches, kept durable across process restarts so a
 * manual close or a creation lock survives a restart (a fresh Render deploy
 * wipes the throwaway filesystem, which is fine - it resets to the safe
 * defaults).
 *
 *   multiplayerOpen - false after the owner shuts down all games. New creates
 *                     and joins are refused until the owner reopens.
 *   creationLocked  - true after the owner locks creation. Nobody can create a
 *                     new lobby; existing lobbies keep running and players can
 *                     still join them.
 *
 * The file is gitignored. Its path can be pointed elsewhere with
 * PHOENIX_STATE_FILE so test servers stay isolated from each other.
 */
const STATE_FILE = process.env.PHOENIX_STATE_FILE || path.join(ROOT, '.phoenix-server-state.json');
// A fresh/replaced instance must not silently reopen during maintenance.
const serverState = { multiplayerOpen: false, creationLocked: false };

function loadServerState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (typeof parsed.multiplayerOpen === 'boolean') serverState.multiplayerOpen = parsed.multiplayerOpen;
    if (typeof parsed.creationLocked === 'boolean') serverState.creationLocked = parsed.creationLocked;
    console.log(`[PHOENIX diagnostic] State loaded: open=${serverState.multiplayerOpen} locked=${serverState.creationLocked}`);
  } catch (e) {
    /* No state file yet (or unreadable): defaults are safe. */
  }
}

function saveServerState() {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serverState, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.log(`[PHOENIX diagnostic] Could not persist server state: ${e.message}`);
  }
}

function adminStateMessage(ws) {
  return {
    type: 'admin_state',
    admin: !!ws.admin,
    multiplayerOpen: serverState.multiplayerOpen,
    creationLocked: serverState.creationLocked
  };
}

const creationCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, stamps] of creationTimes) {
    if (!stamps.some(t => now - t < CREATE_WINDOW_MS)) creationTimes.delete(ip);
  }
}, 60 * 60 * 1000);
creationCleanup.unref();

/**
 * Abandoned-match cleanup.
 *
 * Lobby-phase rooms are already removed the moment their last connection drops
 * (see the close handler). A STARTED match is different: its members stay in the
 * room after disconnecting so a player who returns can rejoin the same table, so
 * a room where every connection is gone could otherwise linger forever. This
 * closes rooms that remain paused for the reconnect grace period, including
 * partial tables. Connected players must not wait forever for an abandoned seat.
 */
const ABANDON_GRACE_MS = 10 * 60 * 1000;
const abandonedCleanup = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of [...rooms]) {
    if (room.phase === 'lobby') continue;
    if (room.pausedAt && now - room.pausedAt >= ABANDON_GRACE_MS) {
      closeRoom(room, 'This match closed because not every player reconnected within 10 minutes. No unfinished-match win was awarded.');
      continue;
    }
    const live = room.members.some(
      m => m.ws && m.ws.readyState === WebSocket.OPEN
    );
    if (live) { room.abandonedAt = null; continue; }
    if (!room.abandonedAt) room.abandonedAt = now;
    if (now - room.abandonedAt < ABANDON_GRACE_MS) continue;
    room.log.push('Closing abandoned match.');
    closeRoom(
      room,
      'This match was closed because every player disconnected.'
    );
  }
}, 60 * 1000);
abandonedCleanup.unref();

loadServerState();

/**
 * Multiplayer Testing is gated by the same private access code the server was
 * started with (PHOENIX_MODE_ACCESS_CODE). Single Player is deliberately left
 * alone: its menu button keeps its current behaviour and is not part of this
 * gate, so nothing here accepts or rejects a single-player mode.
 *
 * The code is never logged, and the comparison goes through SHA-256 digests
 * and timingSafeEqual exactly like the owner password. A small per-IP budget
 * keeps brute-forcing finite without sharing the owner-password limiter.
 */
const ACCESS_CODE_WINDOW_MS = 15 * 60 * 1000;
const ACCESS_CODE_MAX_FAILURES = 10;
const accessCodeFails = new Map();

function accessCodeRecord(ip, now) {
  let record = accessCodeFails.get(ip);
  if (!record) record = { failures: [] };
  record.failures = record.failures.filter(t => now - t < ACCESS_CODE_WINDOW_MS);
  accessCodeFails.set(ip, record);
  return record;
}

function validAccessCode(input) {
  if (typeof input !== 'string' || input.length > 256) {
    return false;
  }
  const supplied = crypto
    .createHash('sha256')
    .update(input)
    .digest();
  const expected = crypto
    .createHash('sha256')
    .update(MODE_ACCESS_CODE)
    .digest();
  return crypto.timingSafeEqual(supplied, expected);
}

const accessCodeCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of accessCodeFails) {
    if (record.failures.every(t => now - t >= ACCESS_CODE_WINDOW_MS)) {
      accessCodeFails.delete(ip);
    }
  }
}, 60 * 60 * 1000);

accessCodeCleanup.unref();

/*
 * Account security: how long one enforcement verdict stands before the server
 * re-reads it from the database.
 *
 * Every gameplay action is checked, but a database round trip on each card
 * played would be absurd - and a ban issued mid-match does not depend on this
 * timer at all, because issuing one sweeps every live connection immediately.
 * The timer is only the backstop for a ban written by something other than
 * this process.
 */
const GATE_TTL_MS = 15 * 1000;

/* Moderation and verification endpoints get their own per-IP budget so that
 * hammering them cannot be used to exhaust the sign-in budget, and vice versa.
 * Deliberately generous - the owner is one person, not a crowd. */
const MODERATION_WINDOW_MS = 15 * 60 * 1000;
const MODERATION_MAX_CALLS = 120;
const moderationCalls = new Map();

function moderationRecord(ip, now) {
  let record = moderationCalls.get(ip);
  if (!record) record = { calls: [] };
  record.calls = record.calls.filter(t => now - t < MODERATION_WINDOW_MS);
  moderationCalls.set(ip, record);
  return record;
}

const moderationCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of moderationCalls) {
    if (record.calls.every(t => now - t >= MODERATION_WINDOW_MS)) {
      moderationCalls.delete(ip);
    }
  }
}, 60 * 60 * 1000);

moderationCleanup.unref();

function validOwnerPassword(input) {
  if (typeof input !== 'string' || input.length > 256) {
    return false;
  }

  const supplied = crypto
    .createHash('sha256')
    .update(input)
    .digest();

  const expected = crypto
    .createHash('sha256')
    .update(OWNER_PASSWORD)
    .digest();

  return crypto.timingSafeEqual(supplied, expected);
}

const rooms = new Map();

/**
 * Public lobby browser contents: ONLY public lobbies, and only the few fields
 * a visitor needs to decide whether to join. Private lobbies and their invite
 * codes never appear here, so the public list cannot leak them.
 */
function lobbySnapshot() {
  return {
    type: 'lobby',
    rooms: [...rooms.values()]
      .filter(r => r.visibility === 'public' && r.phase === 'lobby')
      .map(r => ({
        code: r.code,
        host: (r.members[0] && r.members[0].name) || '',
        players: r.members.length,
        max: 5,
        rounds: r.requestedRounds || 10,
        phase: r.phase || 'lobby'
      }))
  };
}

function broadcastLobby() {
  const payload = JSON.stringify(lobbySnapshot());
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}


/**
 * Open PHOENIX Gallery sessions, keyed by invitation code.
 *
 * Kept separate from `rooms` on purpose. A room holds a live match - hands,
 * scores, the deck - and a gallery session must never be able to reach one, so
 * they are two maps that do not know about each other. A code typed into the
 * wrong box simply misses, and neither side can tell the other it exists.
 *
 * A session is a code and two timestamps. Nothing else: no catalogue (that is
 * already public page script), no player, no room.
 */
const galleries = new Map();

/**
 * Failed gallery-code attempts, keyed by IP.
 *
 * Separate from `authFailures` on purpose - see the gallery_join branch for why
 * a code guess and a password guess want different budgets and different
 * lockouts. Records are tiny (a few timestamps) and only exist for IPs that have
 * actually mistyped something.
 */
const galleryFails = new Map();

/**
 * A gallery invitation code: six characters from the CSPRNG.
 *
 * crypto.randomBytes(3) is 24 bits drawn from the operating system's entropy
 * pool - the same generator the room codes use - and never Math.random. Guests
 * type these by hand, so the alphabet is uppercase hex and nothing else.
 */
function galleryCode() {
  let c;

  do {
    c = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (galleries.has(c));

  return c;
}

/**
 * PHOENIX Gallery over the WebSocket.
 *
 * Three messages, and nothing here ever sends game state:
 *   gallery_create  verified OWNER ROLE only. No password is typed and no
 *                   username is consulted - the session's accounts.role decides.
 *                   Returns the invitation code.
 *   gallery_join    invitation code only.
 *   gallery_close   the creating connection only. Revokes the code at once.
 *
 * @returns {boolean} true if the message was a gallery message and is handled
 */
function handleGallery(ws, data) {
  if (!String(data.type || '').startsWith('gallery_')) {
    return false;
  }

  if (data.type === 'gallery_create') {
    // WHO may create a gallery is decided here, from the verified account
    // role on this connection - never from a typed password and never from a
    // username. Only the real owner passes; everyone else is refused outright.
    if (Auth.isConfigured()) {
      if (!ws.account || ws.account.role !== 'owner') {
        return error(
          ws,
          'Only the owner of PHOENIX can open a gallery.'
        ), true;
      }
    } else {
      // No account system on this server (local development / headless runs):
      // there is no owner account to read, so fall back to the owner password.
      // This path is unreachable in production, where accounts are configured,
      // and it still demands the correct secret rather than opening up.
      const now = Date.now();
      const ip = clientIp(ws);
      const auth = authRecord(ip, now);

      if (auth.lockedUntil > now) {
        return error(ws, 'Too many incorrect attempts. Try again later.'), true;
      }

      if (!validOwnerPassword(data.ownerPassword)) {
        auth.failures.push(now);

        if (auth.failures.length >= AUTH_MAX_FAILURES) {
          auth.lockedUntil = now + AUTH_LOCK_MS;
        }

        return error(
          ws,
          'Incorrect owner password or too many attempts.'
        ), true;
      }

      auth.failures = [];
    }

    // One session per connection. Creating again replaces the old code rather than
    // leaving a second one lying around that only the owner knows is dead.
    Gallery.closeOwnedBy(galleries, ws);

    const now = Date.now();
    const code = Gallery.create(galleries, ws, now, galleryCode);

    if (!code) {
      return error(ws, 'The server has reached its gallery limit. Try later.'), true;
    }

    ws.gallery = { code: code, owner: true };

    return send(ws, {
      type: 'gallery_open',
      code: code,
      expiresIn: Gallery.remainingMs(galleries.get(code), now),
      ttl: Gallery.TTL_MS
    }), true;
  }

  if (data.type === 'gallery_join') {
    const now = Date.now();
    const ip = clientIp(ws);

    // Rate limiting, BEFORE the code is even looked at.
    //
    // This is deliberately separate from the owner-password limiter in
    // authRecord, which is left exactly as it was: that one guards a secret that
    // must never be guessed, this one guards a 24-bit code that people mistype.
    // They have different budgets (three long failures versus five short ones),
    // different lockouts, and neither touches the other.
    //
    // Keyed by IP so a guest cannot simply reconnect and start again.
    const held = Gallery.rateLocked(galleryFails, ip, now);

    if (held.locked) {
      const seconds = Math.ceil(held.retryIn / 1000);
      return error(
        ws,
        `Too many wrong codes. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
      ), true;
    }

    // Validated here, on the server. Anything the page decides for itself is a
    // suggestion, and this is the only check that matters.
    const session = Gallery.join(galleries, data.code, now);

    // One message for "no such code", "closed" and "expired": a guest must not be
    // able to learn which codes exist by watching the replies differ.
    if (!session) {
      const state = Gallery.rateFailure(galleryFails, ip, now);

      // Once the allowance runs out, say so plainly. Telling a held-off visitor
      // only "invalid" would be both untrue and confusing; it leaks nothing about
      // codes, because the lockout is about THEM and not about any code.
      if (state.locked) {
        const seconds = Math.ceil(state.retryIn / 1000);
        return error(
          ws,
          `Too many wrong codes. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
        ), true;
      }

      return error(ws, 'That gallery code is not valid, or has expired.'), true;
    }

    // A hit ends the run of failures, so one fumbled paste costs a visitor
    // nothing: the limiter counts a streak, not a lifetime total.
    Gallery.rateSuccess(galleryFails, ip);

    // Deliberately NOT ws.member. A guest is not in a room, so every gameplay
    // branch below refuses them on its own - read-only by construction.
    ws.gallery = { code: session.code, owner: false };

    return send(ws, {
      type: 'gallery_open',
      code: session.code,
      expiresIn: Gallery.remainingMs(session, Date.now()),
      ttl: Gallery.TTL_MS
    }), true;
  }

  if (data.type === 'gallery_close') {
    const code = ws.gallery && ws.gallery.code;

    if (!code || !ws.gallery.owner) {
      return error(ws, 'Only the owner can close a gallery.'), true;
    }

    Gallery.close(galleries, code, ws, Date.now());
    ws.gallery = null;

    return send(ws, { type: 'gallery_closed', code: code }), true;
  }

  return true;
}

const ALLIES = [
  'phoenix',
  'tilly',
  'louie',
  'simba',
  'elsie',
  'ted'
];

/**
 * Public online identities.
 *
 * The online multiplayer is the PUBLIC version: it must never show the private
 * animal portraits or the catalogue names (Phoenix, Tilly, ...). Instead, every
 * room gets its own randomly generated identity map at creation time - one
 * animal name and one emoji per ally (the six draftable ones plus Maple) - and
 * that map is broadcast with every state, so every player in the room reads the
 * same creatures and the names change from match to match. `room.publicAllies`
 * is the only copy a public screen may draw from.
 *
 * The owner modes (single-player, Multiplayer Testing, gallery) never receive
 * publicAllies and keep the real catalogue untouched.
 */
const PUBLIC_ALLY_NAMES = [
  'Falcon', 'Harrier', 'Wolf', 'Jaguar', 'Viper', 'Otter', 'Raven',
  'Bison', 'Lynx', 'Husky', 'Panther', 'Ferret', 'Skua', 'Cobra'
];
const PUBLIC_ALLY_EMOJI = [
  '🦊', '🦉', '🐺', '🐆', '🐍', '🦦', '🦅',
  '🐢', '🐻', '🐕', '🐯', '🦜', '🐸', '🦋'
];

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One fresh, room-private identity per ally: unique names and unique emojis. */
function publicAllies() {
  const ids = ALLIES.concat('maple');
  const names = shuffled(PUBLIC_ALLY_NAMES).slice(0, ids.length);
  const emojis = shuffled(PUBLIC_ALLY_EMOJI).slice(0, ids.length);
  const map = {};
  ids.forEach((id, i) => {
    map[id] = { name: names[i], emoji: emojis[i] };
  });
  return map;
}

/** The public name a room shows in shared text for one ally id. */
function allyShown(room, id) {
  const pub = room && room.publicAllies && room.publicAllies[id];
  return pub ? pub.name : String(id).toUpperCase();
}

const rollDie = () => crypto.randomInt(1, 7);
const chance = percent => crypto.randomInt(100) < percent;

function addLog(room, message, privateSeat, privateText) {
  room.log.push(privateText ? { publicText: message, privateSeat, privateText } : message);

  if (room.log.length > 150) {
    room.log.splice(0, room.log.length - 150);
  }
}

function effectJournal(room) {
  if (!room.effects) room.effects = { stream: crypto.randomBytes(16).toString('hex'), sequence: 0, events: [] };
  return room.effects;
}

function emitEffect(room, key, actor, target) {
  Effects.append(effectJournal(room), Effects.publicEvent(key, actor, target));
}

function recordEvents(room, events) {
  Effects.fromRules(events).forEach(event => Effects.append(effectJournal(room), event));
  (events || []).forEach(event => {
    const text = Effects.publicLog(event);
    if (!text) return;
    if (text !== event.text) {
      const played = (events || []).find(e => e.type === 'card');
      const privateSeat = event.type === 'result' && played ? played.seat : event.seat;
      addLog(room, text, privateSeat, event.text);
    } else addLog(room, text);
  });
}

function beginRollStage(room, phase) {
  room.phase = phase;

  room.dice = {
    queue: [room.members.map((_, i) => i)],
    order: [],
    group: [],
    rolls: {},
    next: 0
  };

  nextDiceGroup(room);
}

function nextDiceGroup(room) {
  const d = room.dice;

  while (d.queue.length && d.queue[0].length === 1) {
    d.order.push(d.queue.shift()[0]);
  }

  if (!d.queue.length) {
    if (room.phase === 'turnDice') {
      room.turnOrder = d.order.slice();

      addLog(
        room,
        'Turn order: ' +
        d.order.map(i => room.members[i].name).join(' → ')
      );

      beginRollStage(room, 'allyDice');
    } else {
      room.allyOrder = d.order.slice();
      room.draftIndex = 0;
      room.phase = 'draft';

      addLog(
        room,
        'Ally draft order: ' +
        d.order.map(i => room.members[i].name).join(' → ')
      );
    }

    return;
  }

  d.group = d.queue.shift();
  d.next = 0;
  d.rolls = {};

  addLog(
    room,
    'Dice: ' +
    d.group.map(i => room.members[i].name).join(', ') +
    ' roll now.'
  );
}

function diceRoll(room, member) {
  const d = room.dice;
  const idx = room.members.indexOf(member);

  if (d.group[d.next] !== idx) return false;

  const value = rollDie();
  // Public presentation record survives tie-group resets and phase changes.
  // It never drives dice ordering; d.rolls remains the sole rules input.
  room.diceSerial = (room.diceSerial || 0) + 1;
  room.lastDiceRoll = { id: room.diceSerial, phase: room.phase, seat: idx, value };
  d.rolls[idx] = value;
  d.next++;

  addLog(room, member.name + ' rolled ' + value + '.');

  if (d.next === d.group.length) {
    const buckets = new Map();

    for (const i of d.group) {
      const n = d.rolls[i];

      if (!buckets.has(n)) {
        buckets.set(n, []);
      }

      buckets.get(n).push(i);
    }

    const ordered = [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(entry => entry[1]);

    d.queue.unshift(...ordered);

    for (const group of ordered) {
      if (group.length > 1) {
        addLog(
          room,
          'Tie! ' +
          group.map(i => room.members[i].name).join(' and ') +
          ' must reroll.'
        );
      }
    }

    nextDiceGroup(room);
  }

  return true;
}

function applyPhoenix(room) {
  const s = room.state;
  const owner = room.members.find(m => m.ally === 'phoenix');

  if (!owner || !s || s.over) return;

  const actor = s.players[owner.seat];

  if (!actor.enabled || Rules.isOut(actor, s)) return;

  const victims = room.members.filter(m =>
    m !== owner &&
    s.hands[Rules.SEATS[m.seat].id].length &&
    !Rules.isOut(s.players[m.seat], s)
  );

  if (!victims.length) {
    addLog(room, allyShown(room, 'phoenix') + ' found no opponent with cards to steal.');
    return;
  }

  const target = victims[crypto.randomInt(victims.length)];

  const defence = {
    tilly: 40,
    louie: 80,
    simba: 60,
    elsie: 100,
    ted: 60
  }[target.ally] || 0;

  if (chance(defence)) {
    emitEffect(room, 'block-' + target.ally, target.seat, target.seat);
    addLog(
      room,
      target.ally === 'ted'
        ? '🐶 ' + allyShown(room, 'ted') + ' howled and scared ' +
          allyShown(room, 'phoenix') + ' away from ' +
          target.name + '!'
        : target.name + "'s " +
          allyShown(room, target.ally) +
          ' blocked ' + allyShown(room, 'phoenix') + '’s theft!'
    );

    return;
  }

  const from = s.hands[Rules.SEATS[target.seat].id];
  const recipientId = Rules.SEATS[owner.seat].id;
  const candidates = from.filter(cardId => !Rules.holdsCard(s, recipientId, cardId));
  if (!candidates.length) {
    addLog(room, allyShown(room, 'phoenix') + ' could not steal a different card from ' + target.name + '.');
    return;
  }
  const card = candidates[crypto.randomInt(candidates.length)];
  if (!Rules.transferCard(s, Rules.SEATS[target.seat].id, recipientId, card)) return;
  emitEffect(room, 'ally-phoenix', owner.seat, target.seat);

  addLog(
    room,
    allyShown(room, 'phoenix') + ' stole a random card from ' + target.name + '!'
  );
}

function applyTed(room) {
  const s = room.state;
  const owner = room.members.find(m => m.ally === 'ted');

  if (!owner || !s || s.over) return;

  room.tedHiddenUntil = room.tedHiddenUntil || {};

  const activeVictim = Object.entries(room.tedHiddenUntil)
    .some(([, untilRound]) => untilRound >= s.round);

  if (activeVictim || !chance(50)) return;

  const targets = room.members.filter(m =>
    m !== owner &&
    !Rules.isOut(s.players[m.seat], s)
  );

  if (!targets.length) return;

  const victim = targets[crypto.randomInt(targets.length)];

  room.tedHiddenUntil = {
    [victim.seat]: s.round + 2
  };
  emitEffect(room, 'ally-ted', owner.seat, victim.seat);

  addLog(
    room,
    '🐶 Ted used Slobbery Surprise on ' +
    victim.name +
    '! Their cards are hidden for 3 rounds.'
  );
}

/**
 * Maple's Sweet Tooth.
 *
 * The only Ally with no owner: she is deliberately not in ALLIES, so nobody can
 * draft her, and - unlike applyPhoenix and applyTed, which both begin by looking
 * for whoever holds the Ally - she has nobody to look for. She simply rolls once
 * a round. That is what "Independent" means, and it is why her rules live in
 * js/maple.js rather than inline here: while they sat in this file they had no
 * way to be tested at all, because requiring this file starts a server.
 */
function applyMaple(room) {
  const victim = Maple.apply(room, Rules, null, (message, privateSeat, privateText) => {
    // The public multiplayer never says "Maple": the log uses this room's
    // random public name so the private catalogue name is not revealed.
    const publicName = allyShown(room, 'maple');
    const text = typeof message === 'string'
      ? message.replace('Maple', publicName)
      : message;
    addLog(room, text, privateSeat, privateText);
  });
  if (victim !== null) emitEffect(room, 'ally-maple', -1, victim);
}

function resolveRpsInteraction(room, pi) {
  const s = room.state;
  const pick1 = pi.decisions[pi.participants[0]];
  const pick2 = pi.decisions[pi.participants[1]];

  let winner, loser;
  if (pick1 === pick2) {
    return { retry: true, events: [{ type: 'result', cardId: 'rps', text: 'Rock Paper Scissors — tie! Choose again.' }] };
  }
  if ((pick1 === 'rock' && pick2 === 'scissors') ||
      (pick1 === 'paper' && pick2 === 'rock') ||
      (pick1 === 'scissors' && pick2 === 'paper')) {
    winner = pi.participants[0];
    loser = pi.participants[1];
  } else {
    winner = pi.participants[1];
    loser = pi.participants[0];
  }

  pi.roundData.choices = { [pi.participants[0]]: pick1, [pi.participants[1]]: pick2 };

  const loserPlayer = s.players.find(p => p.id === loser);
  if (loserPlayer) {
    Rules.eliminate(s, loserPlayer, 1);
  }

  const events = [{
    type: 'result', cardId: 'rps',
    text: 'Rock Paper Scissors - ' + s.players.find(p => p.id === pi.participants[0]).name +
      ' chose ' + pick1 + ', ' + s.players.find(p => p.id === pi.participants[1]).name +
      ' chose ' + pick2 + '. ' + s.players.find(p => p.id === winner).name + ' wins. ' +
      s.players.find(p => p.id === loser).name + ' is eliminated for 1 round.'
  }];

  return { events, advanceTurn: true };
}

function resolveBetrayalInteraction(room, pi) {
  const s = room.state;
  const [p1Id, p2Id] = pi.participants;
  const p1 = s.players.find(p => p.id === p1Id);
  const p2 = s.players.find(p => p.id === p2Id);
  const c1 = pi.decisions[p1Id];
  const c2 = pi.decisions[p2Id];
  pi.roundData.choices = { [p1Id]: c1, [p2Id]: c2 };

  let text;
  if (c1 === 'share' && c2 === 'share') {
    p1.points += 10000;
    p2.points += 10000;
    text = 'Betrayal - ' + p1.name + ' and ' + p2.name + ' both chose Share. Both gain 10,000.';
  } else if (c1 === 'steal' && c2 === 'share') {
    p1.points += 20000;
    text = 'Betrayal - ' + p1.name + ' chose Steal, ' + p2.name + ' chose Share. ' + p1.name + ' gains 20,000.';
  } else if (c1 === 'share' && c2 === 'steal') {
    p2.points += 20000;
    text = 'Betrayal - ' + p1.name + ' chose Share, ' + p2.name + ' chose Steal. ' + p2.name + ' gains 20,000.';
  } else {
    text = 'Betrayal - both chose Steal. Nobody gains anything.';
  }

  const events = [{ type: 'result', cardId: 'betrayal', text }];
  return { events, advanceTurn: true };
}

function resolveSpeedInteraction(room, pi) {
  return SpeedInteraction.resolve(room.state, pi);
}

function resolveDiceInteraction(room, pi) {
  const s = room.state;
  const [p1Id, p2Id] = pi.participants;
  const p1 = s.players.find(p => p.id === p1Id);
  const p2 = s.players.find(p => p.id === p2Id);

  // Generate rolls for both players
  const roll1 = 1 + Math.floor(Math.random() * 6);
  const roll2 = 1 + Math.floor(Math.random() * 6);

  // Store rolls for client display
  pi.roundData.rolls = { [p1Id]: roll1, [p2Id]: roll2 };

  let winner;
  if (roll1 > roll2) winner = p1;
  else if (roll2 > roll1) winner = p2;
  else {
    return { retry: true, events: [{ type: 'result', cardId: 'dice', text: 'Dice Challenge — both rolled ' + roll1 + '. Roll again!' }] };
  }

  winner.points += 20000;

  const events = [{
    type: 'result', cardId: 'dice',
    text: 'Dice Challenge - ' + p1.name + ' rolled ' + roll1 + ', ' +
      p2.name + ' rolled ' + roll2 + '. ' + winner.name + ' wins 20,000.'
  }];
  return { events, advanceTurn: true };
}

function resolveWheelInteraction(room, pi) {
  const s = room.state;
  const outcomes = [
    'reshuffle', 'reset_self', 'reset_others', 'eliminate_self_3',
    'reverse', 'gain_10k', 'lose_20k', 'others_gain_20k', 'no_evil_permanent'
  ];
  const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
  const actor = s.players.find(p => p.id === pi.actorId);

  let text;
  switch (outcome) {
    case 'reshuffle':
      s.deck = s.deck.concat(s.discard);
      s.discard = [];
      for (let i = s.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [s.deck[i], s.deck[j]] = [s.deck[j], s.deck[i]];
      }
      s.reshuffles++;
      text = 'Wheel of Fortune - ' + actor.name + ' spins... All decks reshuffled!';
      break;
    case 'reset_self':
      actor.points = 0;
      text = 'Wheel of Fortune - ' + actor.name + ' spins... Their points reset to 0!';
      break;
    case 'reset_others':
      s.players.forEach(function (p) { if (p.id !== actor.id) p.points = 0; });
      text = 'Wheel of Fortune - ' + actor.name + ' spins... All other players reset to 0!';
      break;
    case 'eliminate_self_3':
      Rules.eliminate(s, actor, 3);
      text = 'Wheel of Fortune - ' + actor.name + ' spins... Eliminated for 3 rounds!';
      break;
    case 'reverse':
      s.turnDirection = (s.turnDirection || 1) * -1;
      text = 'Wheel of Fortune - ' + actor.name + ' spins... Play direction reversed!';
      break;
    case 'gain_10k':
      actor.points += 10000;
      text = 'Wheel of Fortune - ' + actor.name + ' spins... Gains 10,000 points!';
      break;
    case 'lose_20k':
      actor.points = Math.max(0, actor.points - 20000);
      text = 'Wheel of Fortune - ' + actor.name + ' spins... Loses 20,000 points!';
      break;
    case 'others_gain_20k':
      s.players.forEach(function (p) { if (p.id !== actor.id) p.points += 20000; });
      text = 'Wheel of Fortune - ' + actor.name + ' spins... All others gain 20,000!';
      break;
    case 'no_evil_permanent':
      actor.noEvilPermanent = true;
      text = 'Wheel of Fortune - ' + actor.name + ' spins... Can no longer play Evil cards!';
      break;
  }

  pi.roundData.outcome = outcome;

  const events = [{ type: 'result', cardId: 'wheel', outcome, text }];
  return { events, advanceTurn: true };
}

function resolveLinkedFateInteraction(room, pi) {
  const s = room.state;
  const [p1Id, p2Id] = pi.participants;
  const p1 = s.players.find(p => p.id === p1Id);
  const p2 = s.players.find(p => p.id === p2Id);

  if (!s.linkedFate) s.linkedFate = [];
  s.linkedFate.push({ a: p1Id, b: p2Id, roundsLeft: 2 });

  const events = [{
    type: 'result', cardId: 'linkedfate',
    text: 'Linked Fate - ' + p1.name + ' and ' + p2.name +
      ' are now linked for 2 rounds. Gains are shared at 50%.'
  }];
  return { events, advanceTurn: true };
}

function resolveImpostorInteraction(room, pi) {
  const s = room.state;
  if (pi.timedOut && (pi.phase !== 'vote' || !Object.keys(pi.roundData.votes || {}).length)) {
    return { events: [{ type: 'result', cardId: 'impostor', text: 'Impostor round incomplete: time expired before a ballot could be counted. No points awarded.' }], advanceTurn: true };
  }
  const players = s.players.filter(p => pi.participants.includes(p.id));
  const impostorId = pi.roundData.impostorId;
  const wordPair = pi.roundData.wordPair;
  const votes = pi.roundData.votes || {};

  // Count votes
  const voteCounts = {};
  Object.values(votes).forEach(votedId => {
    voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
  });

  // Find most voted player
  let mostVotedId = null;
  let maxVotes = 0;
  Object.entries(voteCounts).forEach(([id, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      mostVotedId = id;
    }
  });

  // Tie goes to random among tied
  const tiedIds = Object.entries(voteCounts).filter(([, count]) => count === maxVotes).map(([id]) => id);
  if (tiedIds.length > 1) {
    mostVotedId = tiedIds[Math.floor(Math.random() * tiedIds.length)];
  }

  const impostor = s.players.find(p => p.id === impostorId);
  const votedOut = s.players.find(p => p.id === mostVotedId);

  let text;
  if (mostVotedId === impostorId) {
    // Impostor was caught
    players.forEach(p => { if (p.id !== impostorId) p.points += 10000; });
    text = 'Impostor - ' + impostor.name + ' was the impostor and was caught! All others gain 10,000.';
  } else {
    // Wrong person voted out (or tie)
    if (votedOut) {
      impostor.points += 30000;
      text = 'Impostor - ' + impostor.name + ' was the impostor and escaped! ' + impostor.name + ' gains 30,000.';
    } else {
      // No votes (shouldn't happen with timeout fallback)
      impostor.points += 30000;
      text = 'Impostor - ' + impostor.name + ' was the impostor and escaped! ' + impostor.name + ' gains 30,000.';
    }
  }

  // Clear impostor data
  players.forEach(p => { delete p.impostorWord; delete p.isImpostor; });

  const events = [{ type: 'result', cardId: 'impostor', text }];
  return { events, advanceTurn: true };
}

function resolveWheelOfMisfortuneInteraction(room, pi) {
  const s = room.state;
  const actor = s.players.find(p => p.id === pi.actorId);

  // Weighted outcome selection
  const outcomes = [
    { key: 'loan', weight: 20 },
    { key: 'puppets', weight: 15 },
    { key: 'invisible', weight: 15 },
    { key: 'restart', weight: 10 },
    { key: 'apocalypse', weight: 12 },
    { key: 'nothing', weight: 25 },
    { key: 'hell', weight: 2 },
    { key: 'victory', weight: 1 }
  ];

  // Secure weighted random selection
  const totalWeight = outcomes.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * totalWeight;
  let outcome = outcomes[0].key;
  for (const o of outcomes) {
    roll -= o.weight;
    if (roll <= 0) { outcome = o.key; break; }
  }

  let text;
  const events = [];

  switch (outcome) {
    case 'loan': {
      const opponents = s.players.filter(p => p.id !== actor.id && p.enabled && !Rules.isOut(p, s));
      if (opponents.length > 0) {
        const target = opponents[Math.floor(Math.random() * opponents.length)];
        target.points -= 40000;
        text = 'Wheel of Misfortune - ' + actor.name + ' spins... ' + target.name +
          ' has been charged 40,000 points for a loan they never requested! LOAN APPROVED!';
      } else {
        text = 'Wheel of Misfortune - ' + actor.name + ' spins... No opponents to charge!';
      }
      break;
    }
    case 'puppets': {
      const opponents = s.players.filter(p => p.id !== actor.id && p.enabled && !Rules.isOut(p, s));
      if (opponents.length > 0) {
        const target = opponents[Math.floor(Math.random() * opponents.length)];
        if (!s.imprisoned) s.imprisoned = {};
        s.imprisoned[target.id] = { imprisoner: actor.id, imprisonerSeat: actor.seat };
        text = 'Wheel of Misfortune - ' + actor.name + ' spins... ' + target.name +
          ' is now imprisoned! They cannot play or take turns until ' + actor.name + "'s score reaches 0 or below.";
      } else {
        text = 'Wheel of Misfortune - ' + actor.name + ' spins... No one to imprison!';
      }
      break;
    }
    case 'invisible': {
      if (!s.protected) s.protected = {};
      s.protected[actor.id] = { roundsLeft: 5 };
      text = 'Wheel of Misfortune - ' + actor.name + ' spins... They become untargetable for 5 rounds! Now you see me, now you don\'t!';
      break;
    }
    case 'restart': {
      // Reset match state
      s.players.forEach(p => { p.points = 0; p.turnsPlayed = 0; p.cardsPlayed = []; p.eliminated = false; p.turnsSkipped = 0; });
      s.round = 1;
      s.turnInRound = 0;
      s.turnDirection = 1;
      s.over = false;
      s.tied = false;
      s.winnerSeat = -1;
      s.pendingChoice = null;
      s.pendingInteraction = null;
      s.linkedFate = [];
      s.imprisoned = {};
      s.protected = {};
      // Redistribute hands
      const deckSize = Rules.deckSize ? Rules.deckSize() : 0;
      // Re-deal: clear hands and reshuffle
      s.hands = {};
      s.deck = [];
      s.discard = [];
      s.destroyed = [];
      // Rebuild deck from composition
      if (typeof Rules.createGame === 'function') {
        const newGame = Rules.createGame({ rounds: s.rounds, seed: crypto.randomBytes(4).readUInt32BE(0) });
        s.deck = newGame.deck;
        s.hands = newGame.hands;
        s.rounds = newGame.rounds;
      }
      text = 'Wheel of Misfortune - ' + actor.name + ' spins... The match restarts! Everyone gets a fresh start!';
      break;
    }
    case 'apocalypse': {
      s.players.forEach(p => {
        if (!s.hands[p.id]) s.hands[p.id] = [];
        s.hands[p.id].push('phoenix');
      });
      text = 'Wheel of Misfortune - ' + actor.name + ' spins... PHOENIX APOCALYPSE! Everyone receives a Phoenix card!';
      break;
    }
    case 'nothing': {
      text = 'Wheel of Misfortune - ' + actor.name + ' spins... Congratulations! You have successfully wasted everyone\'s time.';
      break;
    }
    case 'hell': {
      actor.points = -100000;
      text = 'Wheel of Misfortune - ' + actor.name + ' spins... Welcome to Hell! Score set to -100,000!';
      break;
    }
    case 'victory': {
      s.over = true;
      s.winnerSeat = s.players.indexOf(actor);
      s.winner = actor.id;
      text = 'Wheel of Misfortune - ' + actor.name + ' spins... INSTANT VICTORY! ' + actor.name + ' wins the match!';
      break;
    }
  }

  pi.roundData.outcome = outcome;
  pi.roundData.wheelType = 'misfortune';

  const resultEvents = [{ type: 'result', cardId: 'wheelofmisfortune', outcome, text }];
  return { events: resultEvents, advanceTurn: outcome !== 'victory' };
}

function resolveSwapperInteraction(room, pi) {
  const s = room.state;
  const [p1Id, p2Id] = pi.participants;
  const p1 = s.players.find(p => p.id === p1Id);
  const p2 = s.players.find(p => p.id === p2Id);

  const m1 = room.members.find(m => m.seat === p1.seat);
  const m2 = room.members.find(m => m.seat === p2.seat);
  const ally1 = m1.ally;
  const ally2 = m2.ally;
  m1.ally = ally2;
  m2.ally = ally1;
  p1.ally = ally2;
  p2.ally = ally1;

  pi.roundData.swapped = { [p1Id]: ally2, [p2Id]: ally1 };

  const events = [{
    type: 'result', cardId: 'swapper',
    text: 'Ally Swapper - ' + p1.name + ' and ' + p2.name +
      ' swapped allies. ' + p1.name + ' now has ' + (ally2 || 'none') +
      ', ' + p2.name + ' now has ' + (ally1 || 'none') + '.'
  }];
  return { events, advanceTurn: true };
}

/**
 * Resolves the room's pending interaction and moves the game on
  const p2 = s.players.find(p => p.id === p2Id);

  const m1 = room.members.find(m => m.seat === p1.seat);
  const m2 = room.members.find(m => m.seat === p2.seat);
  const ally1 = m1.ally;
  const ally2 = m2.ally;
  m1.ally = ally2;
  m2.ally = ally1;
  p1.ally = ally2;
  p2.ally = ally1;

  pi.roundData.swapped = { [p1Id]: ally2, [p2Id]: ally1 };

  const events = [{
    type: 'result', cardId: 'swapper',
    text: 'Ally Swapper - ' + p1.name + ' and ' + p2.name +
      ' swapped allies. ' + p1.name + ' now has ' + (ally2 || 'none') +
      ', ' + p2.name + ' now has ' + (ally1 || 'none') + '.'
  }];
  return { events, advanceTurn: true };
}

/**
 * Resolves the room's pending interaction and moves the game on: records the
 * result, advances the turn, runs the per-round ally effects and broadcasts.
 * Shared by the normal `interact` path and the safety timeout below, so a
 * player who never responds can never leave the match permanently frozen.
 */
function finishInteraction(room) {
  const pi = room.pendingInteraction;
  if (!pi) return;
  const s = room.state;
  const beforePoints = s.players.map(p => p.points);

  let result;
  try {
    if (pi.type === 'rps') result = resolveRpsInteraction(room, pi);
    else if (pi.type === 'betrayal') result = resolveBetrayalInteraction(room, pi);
    else if (pi.type === 'speed') result = resolveSpeedInteraction(room, pi);
    else if (pi.type === 'dice') result = resolveDiceInteraction(room, pi);
    else if (pi.type === 'wheel') result = resolveWheelInteraction(room, pi);
    else if (pi.type === 'linkedfate') result = resolveLinkedFateInteraction(room, pi);
    else if (pi.type === 'impostor') result = resolveImpostorInteraction(room, pi);
    else if (pi.type === 'swapper') result = resolveSwapperInteraction(room, pi);
    else if (pi.type === 'wheelofmisfortune') result = resolveWheelOfMisfortuneInteraction(room, pi);
  } catch (e) {
    console.error('[PHOENIX ws] interaction resolution failed -> ' + Auth.describeError(e));
    result = {
      events: [{ type: 'result', cardId: pi.type, text: 'The interaction was resolved by the server.' }],
      advanceTurn: true
    };
  }

  if (result && result.retry && !pi.timedOut) {
    pi.decisions = {};
    pi.submittedAt = {};
    pi.roundData = { retry: (pi.roundData.retry || 0) + 1, message: result.events[0].text };
    recordEvents(room, result.events);
    broadcast(room);
    return;
  }
  if (result && result.retry) {
    result.events[0].text += ' Time expired; no prize or elimination.';
    result.advanceTurn = true;
  }
  shareLinkedGains(s, beforePoints);
  const actor = s.players.find(p => p.id === pi.actorId);
  actor.turnsPlayed++;
  actor.cardsPlayed.push(pi.type);
  const curseLine = Rules.triggerCurse(s, actor, pi.type);
  if (curseLine) result.events.push({ type: 'curse', cardId: pi.type, seat: actor.seat, text: curseLine });
  // Only resolved, public presentation data survives. Never retain private words or ballots.
  room.lastInteractionResult = {
    type: pi.type, participants: pi.participants.slice(), actorId: pi.actorId,
    createdAt: pi.createdAt, phase: 'result',
    roundData: pi.type === 'impostor'
      ? { revealedImpostorId: pi.roundData.impostorId, revealedWords: pi.roundData.wordPair }
      : { ...pi.roundData },
    events: result ? result.events : []
  };
  room.pendingInteraction = null;
  if (room.interactionTimer) {
    clearTimeout(room.interactionTimer);
    room.interactionTimer = null;
  }
  if (pi.countdownTimer) clearTimeout(pi.countdownTimer);

  if (result && result.events) recordEvents(room, result.events);

  // Achievement tracking: check for badge unlocks based on verified game events.
  if (pi && result) {
    const interactionGrants = Achievements.checkInteractionAchievements(room, pi, result);
    const progressUpdates = Achievements.checkProgressAchievements(room, pi, result);

    // Grant single-match badges immediately
    for (const grant of interactionGrants) {
      const member = room.members.find(m => Rules.SEATS[m.seat].id === pi.actorId);
      if (member && member.account && member.ws) {
        Achievements.grantBadge(member.account, grant.badgeKey, member.ws).catch(err => {
          console.error('[PHOENIX achievements] grant failed -> ' + Auth.describeError(err));
        });
      }
    }

    // Update multi-match progress and grant when complete
    for (const update of progressUpdates) {
      if (update.account) {
        Achievements.updateProgress(update.account.id, update.badgeKey, update.increment).then(progress => {
          if (progress.completed) {
            const member = room.members.find(m => m.account && m.account.id === update.account.id);
            const ws = member ? member.ws : null;
            Achievements.grantBadge(update.account, update.badgeKey, ws).catch(err => {
              console.error('[PHOENIX achievements] grant failed -> ' + Auth.describeError(err));
            });
          }
        }).catch(err => {
          console.error('[PHOENIX achievements] progress update failed -> ' + Auth.describeError(err));
        });
      }
    }
  }

  if (result && result.advanceTurn && s && !s.over) {
    recordEvents(room, Rules.advanceTurn(s));
  }

  if (s && s.round !== room.lastPhoenixRound && !s.over) {
    room.lastPhoenixRound = s.round;
    applyPhoenix(room);
    applyTed(room);
    applyMaple(room);
    applyLinkedFate(room);
  }

  broadcast(room);
}

function applyLinkedFate(room) {
  const s = room.state;
  if (!s || s.over || !s.linkedFate) return;
  // Decrement rounds and remove expired links.
  s.linkedFate = s.linkedFate.filter(function (link) {
    link.roundsLeft--;
    return link.roundsLeft > 0;
  });
  // Expire protection after 5 rounds
  if (s.protected) {
    for (const playerId of Object.keys(s.protected)) {
      s.protected[playerId].roundsLeft--;
      if (s.protected[playerId].roundsLeft <= 0) {
        delete s.protected[playerId];
      }
    }
  }
  // Release imprisonment if spinner's score <= 0
  if (s.imprisoned) {
    for (const imprisonedId of Object.keys(s.imprisoned)) {
      const imp = s.imprisoned[imprisonedId];
      const spinner = s.players.find(p => p.id === imp.imprisoner);
      if (!spinner || spinner.points <= 0) {
        delete s.imprisoned[imprisonedId];
      }
    }
  }
}

function shareLinkedGains(s, beforePoints) {
  const gains = s.players.map((p, i) => Math.max(0, p.points - beforePoints[i]));
  for (const link of s.linkedFate || []) {
    const a = s.players.findIndex(p => p.id === link.a);
    const b = s.players.findIndex(p => p.id === link.b);
    if (a < 0 || b < 0) continue;
    const bonusA = Math.floor(gains[b] / 2);
    const bonusB = Math.floor(gains[a] / 2);
    s.players[b].points += bonusB;
    s.players[a].points += bonusA;
    // Track for Partners in Crime achievement
    if (bonusB >= 10000) {
      // Player b received >= 10000 bonus
      if (s.linkedFateBonus) s.linkedFateBonus[b] = (s.linkedFateBonus[b] || 0) + bonusB;
      else s.linkedFateBonus = { [b]: bonusB };
    }
    if (bonusA >= 10000) {
      if (s.linkedFateBonus) s.linkedFateBonus[a] = (s.linkedFateBonus[a] || 0) + bonusA;
      else s.linkedFateBonus = { [a]: bonusA };
    }
  }
}

function scheduleInteractionTimeout(room, pi, durationMs) {
  if (room.interactionTimer) clearTimeout(room.interactionTimer);
  pi.deadlineAt = Date.now() + durationMs;
  room.interactionTimer = setTimeout(() => {
    if (room.pendingInteraction !== pi || room.members.some(m => !m.ws)) return;
    if (pi.type === 'impostor' && pi.phase === 'clues') {
      pi.decisions.clues = pi.decisions.clues || {};
      for (const id of pi.participants) {
        if (!pi.decisions.clues[id]) pi.decisions.clues[id] = 'clue:(no clue submitted)';
      }
      beginImpostorVoting(room, pi);
      broadcast(room);
      return;
    }
    pi.timedOut = true;
    for (const id of pi.participants) {
      if (pi.decisions[id] !== undefined) continue;
      pi.decisions[id] = pi.type === 'rps' ? ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)]
        : pi.type === 'betrayal' ? (Math.random() < 0.5 ? 'share' : 'steal')
        : pi.type === 'speed' ? 'timeout' : pi.type === 'dice' ? 'roll'
        : pi.type === 'wheel' ? 'spin' : pi.type === 'impostor' ? 'clue:...' : 'ack';
    }
    finishInteraction(room);
  }, durationMs);
}

function beginImpostorVoting(room, pi) {
  pi.roundData.clues = { ...pi.decisions.clues };
  pi.phase = 'vote';
  scheduleInteractionTimeout(room, pi, 60000);
}

function pauseRoom(room) {
  if (room.pausedAt) return;
  room.pausedAt = Date.now();
  const pi = room.pendingInteraction;
  if (pi) {
    pi.remainingMs = Math.max(1, (pi.deadlineAt || pi.createdAt + pi.timeoutMs) - Date.now());
    if (pi.countdownTimer) clearTimeout(pi.countdownTimer);
    pi.countdownTimer = null;
    // A fresh GO is necessary: the old round's in-flight reactions are unfair
    // after a network interruption. Other cards keep their submitted decisions.
    if (pi.type === 'speed') {
      pi.phase = 'ready';
      pi.decisions = {};
      pi.reactions = {};
      pi.roundData = {};
      delete pi.goTime;
      pi.remainingMs = pi.timeoutMs;
    }
  }
  if (room.interactionTimer) clearTimeout(room.interactionTimer);
  room.interactionTimer = null;
}

function resumeRoom(room) {
  if (!room.pausedAt || room.members.some(m => !m.ws)) return;
  room.pausedAt = null;
  room.abandonedAt = null;
  if (room.pendingInteraction) {
    const pi = room.pendingInteraction;
    scheduleInteractionTimeout(room, pi, pi.remainingMs || pi.timeoutMs);
    delete pi.remainingMs;
  }
  addLog(room, 'All players reconnected. Match resumed.');
}

function startGame(room) {
  const oldMembers = room.members.slice();

  room.members = room.turnOrder.map(i => oldMembers[i]);

  room.members.forEach((m, i) => {
    m.seat = i;
  });

  const s = Rules.createGame({
    rounds: room.requestedRounds,
    fixedOrder: true,
    rotateStart: false,
    roundStartSeat: 0,
    seed: crypto.randomBytes(4).readUInt32BE(0)
  });

  s.players.forEach((p, i) => {
    p.enabled = i < room.members.length;

    if (room.members[i]) {
      p.name = room.members[i].name;
    }
  });

  room.state = s;
  room.phase = 'playing';
  room.lastPhoenixRound = 1;
  room.tedHiddenUntil = {};

  // A fresh id for a fresh match. Wins are counted against THIS, so the same
  // match finishing twice still counts once, and a rematch between the same
  // people is a different match that can be won again.
  room.matchId = crypto.randomUUID();
  room.winRecorded = false;

  addLog(
    room,
    'Match started! Turn order: ' +
    room.members.map(m => m.name).join(' → ')
  );

  applyPhoenix(room);
  applyTed(room);
  applyMaple(room);
}

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');

console.log(
  `[PHOENIX diagnostic] Server started: instance=${INSTANCE_ID}, pid=${process.pid}`
);

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.efk': 'application/octet-stream',
  '.efkefc': 'application/octet-stream'
};

const httpServer = http.createServer(async (req, res) => {
  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname
    );
  } catch {
    res.writeHead(400).end();
    return;
  }

  // Access-code check for the creator-only Multiplayer Testing entry. This is
  // the only JSON API route; everything else below is static file serving.
  if (req.method === 'POST' && pathname === '/api/mode-access') {
    let body = '';
    req.on('data', chunk => {
      if (body.length < 4096) body += chunk;
    });
    req.on('end', () => {
      let code = null;
      try { code = JSON.parse(body || '{}').code; } catch (e) { /* not JSON */ }
      const now = Date.now();
      const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '') || 'unknown';
      const record = accessCodeRecord(ip, now);
      const respond = payload => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(JSON.stringify(payload));
      };
      if (record.failures.length >= ACCESS_CODE_MAX_FAILURES) {
        respond({ ok: false, message: 'Too many attempts. Try again later.' });
        return;
      }
      if (validAccessCode(code)) {
        accessCodeFails.delete(ip);
        respond({ ok: true });
        return;
      }
      record.failures.push(now);
      respond({ ok: false, message: 'That code is not recognised.' });
    });
    return;
  }

  // ---- Phase 1: account auth (server-side, Supabase Postgres) -------------
  const sendJson = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(obj));
  };
  const readJsonBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { if (body.length < 8192) body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); } });
  });
  const reqIp = ((req.socket.remoteAddress || '').replace(/^::ffff:/, '') || 'unknown');

  // Account routes exist only when Supabase is configured. Without it they
  // answer 503 rather than pretending to work (or silently letting anyone in).
  if (
    req.method === 'POST' &&
    (pathname === '/api/register' || pathname === '/api/login' ||
     pathname === '/api/claim-owner' || pathname === '/api/logout')
  ) {
    if (!Auth.isConfigured()) {
      sendJson({ ok: false, message: 'Accounts are not available on this server.' }, 503);
      return;
    }
  }

  if (
    req.method === 'POST' &&
    (pathname === '/api/register' || pathname === '/api/login' || pathname === '/api/claim-owner')
  ) {
    // Brute-force protection: the same sliding-window per-IP counter the
    // access code already uses. Login, register and owner-claim all count as
    // one bucket, so hammering any of them locks all of them.
    const now = Date.now();
    const record = accessCodeRecord(reqIp, now);
    if (record.failures.length >= ACCESS_CODE_MAX_FAILURES) {
      sendJson({ ok: false, message: 'Too many attempts. Try again later.' }, 429);
      return;
    }

    // A database problem is not the player's fault: never count it against
    // their attempts, or a Supabase outage would lock every IP out.
    function noteFailure(result) {
      if (!(result && result.code && String(result.code).indexOf('DB-') === 0)) {
        record.failures.push(now);
      }
    }

    // The auth calls talk to the network. If one THROWS, an unhandled rejection
    // in this async handler takes the whole Node process down on Node 18+.
    try {
      if (pathname === '/api/register') {
        const { username, password, email } = await readJsonBody();
        const result = await Auth.register(username, password, email);

        // Registration attempts are recorded from the address the SERVER saw,
        // so one person opening account after account is visible across
        // deploys. A database failure is not counted against the player.
        const from = Moderation.trustedIp(req);
        if (!(result && result.code && String(result.code).indexOf('DB-') === 0)) {
          await Moderation.noteSignup(from, username, Boolean(result && result.ok));
        }

        if (!result.ok) {
          noteFailure(result);
          sendJson({ ok: false, message: result.message, code: result.code || null }, 400);
          return;
        }
        accessCodeFails.delete(reqIp);
        res.setHeader('Set-Cookie', [
          Auth.sessionCookie(result.token, Auth.SESSION_TTL_SEC, Auth.isSecure(req))
        ]);

        // Mail a six-digit code straight away so a brand-new player never has
        // to press a second button to get going. A failure here does NOT undo
        // the account: they land on the verification screen with a resend
        // button, which is exactly where they would be anyway.
        let verification = { required: false, emailSent: false, message: null };
        if (result.email) {
          const sent = await EmailVerification.sendCode(result.account, result.email, from);
          verification = {
            required: true,
            emailSent: Boolean(sent.ok),
            message: sent.ok
              ? 'We sent a six-digit code to ' + result.email + '.'
              : (sent.message || 'The verification email could not be sent. You can ask for another code.'),
            resendAfter: sent.resendAfter || null,
            expiresInSeconds: sent.expiresInSeconds || null
          };
        }

        sendJson({ ok: true, account: result.account, verification });
        return;
      }

      if (pathname === '/api/login') {
        const { username, password } = await readJsonBody();
        const result = await Auth.login(username, password);
        if (!result.ok) {
          noteFailure(result);
          sendJson({ ok: false, message: result.message, code: result.code || null }, 401);
          return;
        }
        accessCodeFails.delete(reqIp);

        // Is this account under a restriction? Checked on the SERVER, from the
        // account id, the address the server saw and the device token in the
        // cookie - never from anything in the request body. The response says
        // only what the player may know: no address, no other account.
        const from = Moderation.trustedIp(req);
        let ban = null;
        try {
          ban = await Moderation.restrictionFor({
            accountId: result.account.id,
            ip: from,
            deviceId: Moderation.deviceIdFrom(req)
          });
        } catch (err) {
          console.error('[PHOENIX moderation] login check failed -> ' + Auth.describeError(err));
        }

        const verification = await EmailVerification.status(result.account).catch(() => null);

        res.setHeader('Set-Cookie', [
          Auth.sessionCookie(result.token, Auth.SESSION_TTL_SEC, Auth.isSecure(req))
        ]);
        sendJson({
          ok: true,
          account: result.account,
          verification: verification
            ? { required: Boolean(verification.required),
                verified: Boolean(verification.verified),
                email: verification.email || null,
                awaitingCode: Boolean(verification.awaitingCode),
                resendInSeconds: verification.resendInSeconds || 0,
                expiresInSeconds: verification.expiresInSeconds || 0,
                attemptsLeft: verification.attemptsLeft || null }
            : { required: false, verified: false },
          ban: ban ? Moderation.publicView(ban, result.account.id) : null
        });
        return;
      }

      // /api/claim-owner
      const claimant = await Auth.getSessionAccount(req);
      if (!claimant) {
        sendJson({ ok: false, message: 'You must be signed in.' }, 401);
        return;
      }
      const { setupKey } = await readJsonBody();
      const claimResult = await Auth.claimOwner(claimant.id, setupKey);
      if (!claimResult.ok) {
        noteFailure(claimResult);
        sendJson({ ok: false, message: claimResult.message, code: claimResult.code || null }, 400);
        return;
      }
      accessCodeFails.delete(reqIp);
      sendJson({ ok: true, account: { ...claimant, role: 'owner' } });
      return;
    } catch (err) {
      // Route every unexpected error through auth.js's redacting formatter so
      // a stray URL, token or hash can never land in the Render log.
      console.error('[PHOENIX auth] unhandled error in ' + pathname + ' -> ' +
        Auth.describeError(err));
      sendJson({ ok: false, message: 'Something went wrong on the server. Please try again.',
                 code: 'SERVER-ERROR' }, 500);
      return;
    }
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    try {
      await Auth.destroySession(req);
    } catch (err) {
      console.error('[PHOENIX auth] logout failed -> ' + Auth.describeError(err));
    }
    res.setHeader('Set-Cookie', Auth.clearSessionCookie(Auth.isSecure(req)));
    return sendJson({ ok: true });
  }

  // ---- Account security: verified email + moderation ------------------------
  // Everything below sits behind the httpOnly session cookie. A browser can ask
  // for any of it, but every operation re-reads the role from the database and
  // answers identically for a stranger whatever they send.
  if (pathname.indexOf('/api/account/email') === 0 ||
      pathname.indexOf('/api/moderation') === 0) {
    if (!Auth.isConfigured()) {
      return sendJson({ ok: false, available: false,
                        message: 'Accounts are not available on this server.' }, 503);
    }

    const spend = () => {
      const record = moderationRecord(reqIp, Date.now());
      if (record.calls.length >= MODERATION_MAX_CALLS) return false;
      record.calls.push(Date.now());
      return true;
    };

    try {
      const account = await Auth.getSessionAccount(req);

      /* ---------------- email verification ---------------- */
      if (pathname === '/api/account/email/status') {
        if (!account) return sendJson({ ok: false, authenticated: false }, 401);
        const status = await EmailVerification.status(account);
        return sendJson({
          ok: true,
          available: status.available !== false,
          required: Boolean(status.required),
          verified: Boolean(status.verified),
          email: status.email || null,
          awaitingCode: Boolean(status.awaitingCode),
          resendInSeconds: status.resendInSeconds || 0,
          expiresInSeconds: status.expiresInSeconds || 0,
          attemptsLeft: status.attemptsLeft === undefined ? null : status.attemptsLeft,
          notice: EmailVerification.REQUIRED_NOTICE
        });
      }

      if (req.method === 'POST' && pathname === '/api/account/email/request') {
        if (!account) return sendJson({ ok: false, authenticated: false }, 401);
        if (!spend()) return sendJson({ ok: false, message: 'Too many requests. Try again later.' }, 429);
        const body = await readJsonBody();
        const result = await EmailVerification.sendCode(
          account, body.email, Moderation.trustedIp(req));
        return sendJson(result, result.ok ? 200
          : (result.status || (result.available === false ? 503 : 400)));
      }

      if (req.method === 'POST' && pathname === '/api/account/email/verify') {
        if (!account) return sendJson({ ok: false, authenticated: false }, 401);
        if (!spend()) return sendJson({ ok: false, message: 'Too many requests. Try again later.' }, 429);
        const body = await readJsonBody();
        const result = await EmailVerification.verifyCode(account, body.code);

        if (result.ok && !result.alreadyVerified) {
          // Announce it on every live connection for this account, so a player
          // who verifies in one tab is let into the game everywhere at once.
          await Moderation.record('email.verified', account, 'address proven', account.username);
          announceEmailVerified(account);
        }
        return sendJson(result, result.ok ? 200 : (result.status || 400));
      }

      /* ---------------- moderation (owner only) ---------------- */
      if (pathname.indexOf('/api/moderation') === 0) {
        if (!spend()) {
          return sendJson({ ok: false, message: 'Too many requests. Try again later.' }, 429);
        }
        if (req.method === 'GET' && pathname === '/api/moderation/accounts') {
          const query = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
          const result = await Moderation.searchAccounts(account, query);
          if (!result.ok && result.status === 403) {
            await Moderation.record('access.denied', account, 'search accounts');
          }
          return sendJson(result, result.ok ? 200 : (result.status || 400));
        }

        if (req.method === 'GET' && pathname === '/api/moderation/restrictions') {
          const status = new URL(req.url, 'http://localhost').searchParams.get('status') || 'active';
          const result = await Moderation.list(account, status);
          if (!result.ok && result.status === 403) {
            await Moderation.record('access.denied', account, 'list restrictions');
          }
          return sendJson(result, result.ok ? 200 : (result.status || 400));
        }

        if (req.method === 'GET' && pathname === '/api/moderation/log') {
          const limit = new URL(req.url, 'http://localhost').searchParams.get('limit');
          const result = await Moderation.auditLog(account, limit);
          if (!result.ok && result.status === 403) {
            await Moderation.record('access.denied', account, 'read audit log');
          }
          return sendJson(result, result.ok ? 200 : (result.status || 400));
        }

        if (req.method === 'POST' && pathname === '/api/moderation/restrictions') {
          const body = await readJsonBody();
          const result = await Moderation.create(account, body);
          if (!result.ok && result.status === 403) {
            await Moderation.record('access.denied', account, 'issue a restriction');
          }
          if (result.ok) await applyRestrictionsToLiveConnections();
          return sendJson(result, result.ok ? 200 : (result.status || 400));
        }

        if (req.method === 'POST' && pathname === '/api/moderation/restrictions/revoke') {
          const body = await readJsonBody();
          const result = await Moderation.revoke(account, body.id);
          if (!result.ok && result.status === 403) {
            await Moderation.record('access.denied', account, 'lift a restriction');
          }
          if (result.ok) await applyRestrictionsToLiveConnections();
          return sendJson(result, result.ok ? 200 : (result.status || 400));
        }

        return sendJson({ ok: false, message: 'Not found.' }, 404);
      }

      return sendJson({ ok: false, message: 'Not found.' }, 404);
    } catch (err) {
      console.error('[PHOENIX security] ' + pathname + ' failed -> ' + Auth.describeError(err));
      return sendJson({ ok: false, message: 'Something went wrong on the server. Please try again.',
                        code: 'SERVER-ERROR' }, 500);
    }
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    if (!Auth.isConfigured()) {
      // No account system here: tell the client it needs no sign-in screen.
      sendJson({ ok: false, authenticated: false, available: false }, 200);
      return;
    }
    let account = null;
    try {
      account = await Auth.getSessionAccount(req);
    } catch (err) {
      console.error('[PHOENIX auth] /api/me failed -> ' + Auth.describeError(err));
    }

    // Device token. The page never sees it (HttpOnly) and the browser never
    // sends it in a body - the server reads it straight off the connection.
    const cookies = [];
    let deviceId = Moderation.deviceIdFrom(req);
    if (!deviceId) {
      deviceId = Moderation.newDeviceId();
      cookies.push(Moderation.deviceCookie(deviceId, Auth.isSecure(req)));
    }

    if (!account) {
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      return sendJson({ ok: false, authenticated: false, available: true }, 401);
    }

    // Record where this account is actually playing from, using only what the
    // server derived from the connection. Best effort: a failure here is logged
    // and never stops the page loading.
    await Moderation.observe(account, Moderation.trustedIp(req), deviceId);

    const status = await EmailVerification.status(account).catch(() => null);
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    return sendJson({
      ok: true, authenticated: true, available: true, account,
      verification: status
        ? { required: Boolean(status.required), verified: Boolean(status.verified),
            email: status.email || null, awaitingCode: Boolean(status.awaitingCode),
            resendInSeconds: status.resendInSeconds || 0,
            expiresInSeconds: status.expiresInSeconds || 0,
            attemptsLeft: status.attemptsLeft === undefined ? null : status.attemptsLeft,
            notice: EmailVerification.REQUIRED_NOTICE }
        : { required: false, verified: false }
    });
  }

  // ---- Phase 2: badges ------------------------------------------------------
  // Every rule here is evaluated on the server from accounts.role. The browser
  // never sends a role, and never receives anything but catalogue rows.
  if (pathname === '/api/badges' || pathname.indexOf('/api/badges/') === 0) {
    if (!Auth.isConfigured()) {
      sendJson({ ok: false, available: false, message: 'Badges are not available on this server.' }, 503);
      return;
    }

    try {
      // Public, read-only profile lookup: GET /api/badges/profile?username=x
      if (req.method === 'GET' && pathname === '/api/badges/profile') {
        const query = new URL(req.url, 'http://localhost').searchParams;
        const result = await Badges.getProfile(query.get('username') || '');
        return sendJson(result, result.ok ? 200 : (result.available === false ? 503 : 404));
      }

      // Everything below needs a live session.
      const account = await Auth.getSessionAccount(req);
      if (!account) return sendJson({ ok: false, authenticated: false, available: true }, 401);

      if (req.method === 'GET' && pathname === '/api/badges') {
        const result = await Badges.getMine(account);
        return sendJson(result, result.ok ? 200 : 503);
      }

      if (req.method === 'POST' && pathname === '/api/badges/feature') {
        const body = await readJsonBody();
        const result = await Badges.setFeatured(account, body.slots);
        return sendJson(result, result.ok ? 200 : (result.available === false ? 503 : 400));
      }

      // OWNER ONLY. The role check lives inside Badges.awardBadge and runs
      // before it reads anything, so this endpoint answers the same way for a
      // non-owner whatever username or badge key they send. The badge key must
      // also be on the server's allowlist - THE PHOENIX is not, and cannot be
      // added by anything in this request.
      if (req.method === 'POST' && pathname === '/api/badges/award') {
        const body = await readJsonBody();
        const result = await Badges.awardBadge(account, body.username, body.badgeKey);
        return sendJson(result,
          result.ok ? 200
                    : (result.status || (result.available === false ? 503 : 400)));
      }

      return sendJson({ ok: false, message: 'Not found.' }, 404);
    } catch (err) {
      console.error('[PHOENIX badges] ' + pathname + ' failed -> ' + Auth.describeError(err));
      return sendJson({ ok: false, message: 'Something went wrong on the server. Please try again.',
                        code: 'SERVER-ERROR' }, 500);
    }
  }

  // ---- Announcements ---------------------------------------------------------
  // READING is public: the newest post belongs on the main menu for every
  // visitor, signed in or not. WRITING and TAKING ONE DOWN are owner-only -
  // checked here against accounts.role, and for posting again by the Postgres
  // announcement_author_only trigger, so a bug in this file still cannot let
  // anyone but the owner post.
  if (pathname === '/api/announcements') {
    if (!Announcements.isAvailable()) {
      sendJson({ ok: false, available: false,
                 message: 'Announcements are not available on this server.' }, 503);
      return;
    }

    try {
      if (req.method === 'GET') {
        const result = await Announcements.list();
        return sendJson(result, result.ok ? 200 : 503);
      }

      if (req.method === 'POST') {
        // The session comes from the httpOnly cookie, exactly as it does for
        // badges. The browser never sends a role, and an owner account is
        // never asked for a separate owner password on this route.
        const account = await Auth.getSessionAccount(req);
        if (!account) {
          return sendJson({ ok: false, message: 'Sign in first.' }, 401);
        }
        const body = await readJsonBody();
        const result = await Announcements.create(account, body.body);
        return sendJson(result,
          result.ok ? 200
                    : (result.status || (result.available === false ? 503 : 400)));
      }

      if (req.method === 'DELETE') {
        // Same session, same role check, no separate owner password: an owner
        // account is recognised from the httpOnly cookie exactly as it is when
        // posting. Which post goes is named by one id in the query string, so
        // the request needs no body and nothing is ever taken from the page.
        const account = await Auth.getSessionAccount(req);
        if (!account) {
          return sendJson({ ok: false, message: 'Sign in first.' }, 401);
        }
        const id = new URL(req.url, 'http://localhost').searchParams.get('id');
        const result = await Announcements.remove(account, id);
        return sendJson(result,
          result.ok ? 200
                    : (result.status || (result.available === false ? 503 : 400)));
      }

      return sendJson({ ok: false, message: 'Not found.' }, 404);
    } catch (err) {
      console.error('[PHOENIX announcements] ' + pathname + ' failed -> ' + Auth.describeError(err));
      return sendJson({ ok: false, message: 'Something went wrong on the server. Please try again.',
                        code: 'SERVER-ERROR' }, 500);
    }
  }

  // ---- Leaderboard -----------------------------------------------------------
  // Public and read-only: who won how much is the whole point of a leaderboard,
  // so it needs no session and answers the same signed in or not. What leaves
  // the server is a rank, a username and a number - never an account row, never
  // a role, and never the owner, who js/wins.js keeps off the board in three
  // separate places.
  if (pathname === '/api/leaderboard') {
    if (!Wins.isAvailable()) {
      sendJson({ ok: false, available: false,
                 message: 'The leaderboard is not available on this server.' }, 503);
      return;
    }

    try {
      if (req.method !== 'GET') {
        return sendJson({ ok: false, message: 'Not found.' }, 404);
      }
      const result = await Wins.leaderboard();
      return sendJson(result, result.ok ? 200 : 503);
    } catch (err) {
      console.error('[PHOENIX wins] ' + pathname + ' failed -> ' + Auth.describeError(err));
      return sendJson({ ok: false, message: 'Something went wrong on the server. Please try again.',
                        code: 'SERVER-ERROR' }, 500);
    }
  }

  const file = path.resolve(
    ROOT,
    '.' + (pathname === '/' ? '/index.html' : pathname)
  );

  if (
    !file.startsWith(ROOT + path.sep) ||
    file === __filename ||
    file.includes(path.sep + 'node_modules' + path.sep) ||
    !Object.hasOwn(mime, path.extname(file))
  ) {
    res.writeHead(404).end();
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)],
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(data);
  });
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 8192
});

const send = (ws, obj) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
};

const cleanName = name =>
  String(name || 'Player')
    .replace(/[<>\r\n]/g, '')
    .trim()
    .slice(0, 22) || 'Player';

/**
 * A player's lobby name is their ACCOUNT name.
 *
 * Derived here, on the server, from the signed-in session. The browser no
 * longer offers a name field, so nobody can join a lobby wearing somebody
 * else's name - the value comes from the same row that owns the session
 * cookie, not from anything the client typed.
 *
 * When the server has no account system at all (local development and the
 * headless test harnesses), there is no session to read, so the legacy
 * supplied name is still honoured. That fallback is unreachable in
 * production: there, an unauthenticated socket is refused long before this.
 */
const playerName = (ws, data) =>
  cleanName(ws.account && ws.account.username ? ws.account.username : data && data.name);

/**
 * The badge projection this connection may show in a match.
 *
 * Copied onto the MEMBER rather than read off the socket, because a member's
 * `ws` is cleared when they disconnect while their seat - and the badge that
 * belongs on it - must survive in the snapshot.
 *
 * The value is entirely server-computed at connect time; a client cannot send
 * it, so there is no path for a player to equip a badge they do not hold.
 *
 * Called once, when the member is created.
 */
const memberBadges = ws =>
  (Array.isArray(ws && ws.badges) ? ws.badges : []);

/**
 * The account this connection proved itself to be, copied onto the MEMBER.
 *
 * Same reasoning as memberBadges: a member's `ws` is cleared when they
 * disconnect while their seat must survive in the snapshot, so anything the
 * seat needs to remember is copied across when the member is created.
 *
 * Only the id and the role are kept - never the username, which the match
 * already carries as `name`, and never anything that could be edited later.
 * A client cannot send this: it comes from the httpOnly session the socket
 * authenticated with, so a player cannot claim someone else's wins.
 */
const memberAccount = ws =>
  (ws && ws.account
    ? { id: ws.account.id, role: ws.account.role }
    : null);

function code() {
  let c;

  do {
    c = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(c));

  return c;
}

function dueChoice(s) {
  const pending = Rules.pendingChoiceOptions(s);

  if (!pending) return null;

  if (
    pending.kind === 'move' &&
    s.players[s.turnInRound].id !== pending.targetId
  ) {
    return null;
  }

  return pending;
}

// Multiplayer state sent to each player.
function snapshot(room, member) {
  const s = room.state;
  if (!member.resumeToken) member.resumeToken = crypto.randomBytes(32).toString('hex');
  const paused = room.phase !== 'lobby' && room.members.some(m => !m.ws);

  const players = room.members.map((m, i) => ({
    id: Rules.SEATS[i].id,
    name: m.name,
    ally: m.ally,
    // Catalogue-supplied name/rarity only (see Badges.featuredBadges). This is
    // the ONE place badges enter a match snapshot.
    badges: Array.isArray(m.badges) ? m.badges : [],
    connected: !!m.ws,
    points: s ? s.players[i].points : 0,
    handCount: s
      ? s.hands[Rules.SEATS[i].id].length
      : 0,
    hunter: s ? !!s.players[i].hunter : false,
    eliminated: s
      ? Rules.isOut(s.players[i], s)
      : false,
    noEvilPermanent: s ? !!s.players[i].noEvilPermanent : false
  }));

  const current = s ? s.players[s.turnInRound] : null;
  const pending = s ? dueChoice(s) : null;
  const pendingInteraction = interactionView(room.pendingInteraction, Rules.SEATS[member.seat].id);
  const mine = Rules.SEATS[member.seat].id;

  const acting = !!(
    s &&
    !paused &&
    !s.over &&
    (
      (pending && pending.chooserId === mine) ||
      (!pending && current && current.id === mine)
    )
  );

  const moves = acting
    ? (
        pending
          ? Maple.playableMoves(room,member.seat,pending.options,pending)
          : Maple.playableMoves(
            room,
            member.seat,
            Rules.legalMoves(s, s.turnInRound)
          ).map(m => ({
            cardId: m.cardId,
            targetId: m.targetId
          }))
      )
    : [];

  return {
    type: 'state',
    phase: room.phase || 'lobby',
    paused,
    resumeUntil: paused && room.pausedAt ? room.pausedAt + ABANDON_GRACE_MS : null,
    resumeToken: member.resumeToken,
    // This room's randomised public identities, identical for every player in
    // the room. The PUBLIC screens must render ally names/emojis ONLY from here.
    publicAllies: room.publicAllies,

    dice: room.dice
      ? {
          next: room.dice.group[room.dice.next],
          rolls: room.dice.rolls,
          order: room.dice.order,
          lastRoll: room.lastDiceRoll || null
        }
      : null,

    draftTurn: room.phase === 'draft'
      ? room.allyOrder[room.draftIndex]
      : null,

    availableAllies: ALLIES.filter(a =>
      (a !== 'ted' || room.members.length >= 3) &&
      !room.members.some(m => m.ally === a)
    ),

    code: room.code,
    visibility: room.visibility || 'private',
    mode: room.mode || 'public',
    host: room.members[0] === member,
    seat: member.seat,
    started: !!s,
    players,

    round: s ? s.round : 0,
    rounds: s ? s.rounds : 0,
    over: s ? !!s.over : false,

    winner: s && s.over && s.winnerSeat >= 0
      ? s.players[s.winnerSeat].id
      : null,

    current: current ? current.id : null,

    hand: s ? (s.hands[mine] || []) : [],

    deckCount: s ? s.deck.length : 0,
    discardCount: s ? s.discard.length : 0,
    destroyedCount: s && s.destroyed ? s.destroyed.length : 0,

    // The actual top card of the discard pile.
    lastDiscard: s && s.discard.length
      ? s.discard[s.discard.length - 1]
      : null,

    acting,
    pending: pending
      ? {
          kind: pending.kind,
          chooserId: pending.chooserId,
          targetId: pending.targetId
        }
      : null,

    pendingInteraction: pendingInteraction,
    lastInteractionResult: room.lastInteractionResult || null,

    moves,

    tedObscured: !!(
      s &&
      room.tedHiddenUntil &&
      room.tedHiddenUntil[member.seat] >= s.round
    ),

    // Which cards Maple has taken off THIS player's menu. The server still
    // refuses them whatever a client sends; this is so the board can say why
    // instead of a card silently going missing.
    mapleBlocked: Maple.blockedForAction(room,member.seat,acting ? pending : null),

    // Whether THIS player is banned from Evil cards. The ban is enforced by the
    // engine (Rules.legalMoves refuses an evil card for a banned player), and
    // this flag is what lets the client grey those cards out and say why.
    noEvilPermanent: !!(s && s.players[member.seat] && s.players[member.seat].noEvilPermanent),

    effects: effectJournal(room),

    log: room.log.slice(-35).map(entry => {
      if (typeof entry === 'string') return entry;
      const obscured = s && room.tedHiddenUntil && room.tedHiddenUntil[member.seat] >= s.round;
      return entry.privateSeat === member.seat && !obscured ? entry.privateText : entry.publicText;
    })
  };
}

// Skip turns when no legal moves are available.
function skipUnplayableTurns(room) {
  const s = room.state;

  if (!s || s.over || room.phase !== 'playing') {
    return;
  }

  let guard = 0;

  while (!s.over && guard++ < 150) {
    const pending = dueChoice(s);

    if (pending && pending.kind === 'burn') {
      break;
    }

    const current = s.players[s.turnInRound];

    // Imprisoned players skip their turn
    if (s.imprisoned && s.imprisoned[current.id]) {
      current.turnsSkipped++;
      const events = Rules.advanceTurn(s);
      recordEvents(room, events);
      if (s.round !== room.lastPhoenixRound && !s.over) {
        room.lastPhoenixRound = s.round;
        applyPhoenix(room);
        applyTed(room);
        applyMaple(room);
        applyLinkedFate(room);
      }
      continue;
    }

    // Maple's Sweet Tooth counts here. The engine's legalMoves knows nothing about
  // it, so without this a restricted player holding only aggressive cards looks
  // to the engine like they can play - so they are never skipped, so the server
  // tells them it is their turn, so the client offers nothing they may play, and
  // the match stops. Filtered through Maple here AND in the snapshot below, so the
  // skip logic and the board cannot disagree.
  if (
  Maple.playableMoves(room, s.turnInRound, Rules.legalMoves(s, s.turnInRound))
  .length
  ) {
      break;
    }

    if (pending && pending.kind === 'move') {
      s.pendingChoice = null;

      addLog(
        room,
        'Steal a Turn expired because ' +
        current.name +
        ' has no legal moves.'
      );
    }

    current.turnsSkipped++;

    addLog(
      room,
      current.name +
      ' has no legal moves and automatically skips their turn.'
    );

    const events = Rules.advanceTurn(s);

    recordEvents(room, events);

    if (s.round !== room.lastPhoenixRound && !s.over) {
      room.lastPhoenixRound = s.round;
      applyPhoenix(room);
        applyTed(room);
        applyMaple(room);
        applyLinkedFate(room);
      }
    }
  }

/**
 * Count the result of a finished match, once.
 *
 * Called from broadcast(), which every snapshot leaves through, so a match can
 * only ever be counted from here - and `matchId` is minted when the match
 * starts, so reporting the same finish twice is a no-op at the database
 * rather than a second win.
 *
 * Fire-and-forget on purpose. The ledger is not part of the game state, so a
 * slow or missing database must never delay or spoil the end of someone's
 * match, and this is written AFTER skipUnplayableTurns(), which is the last
 * place the game can finish.
 */
function recordMatchWin(room) {
  const s = room.state;

  if (!s || !s.over || !room.matchId || room.winRecorded) return;
  room.winRecorded = true;

  // A tie is not a win for whoever happens to sit in the top seat.
  if (s.tied || s.winnerSeat < 0 || !room.members[s.winnerSeat]) return;

  // The account is the one this socket proved itself to be at connect time.
  // Wins.recordWin() keeps players only, so the owner's result is dropped
  // before anything is written.
  const winner = room.members[s.winnerSeat];

  Wins.recordWin(room.matchId, winner.account).catch(err => {
    console.error('[PHOENIX wins] could not count a finished match -> ' +
      Auth.describeError(err));
  });
}

function broadcast(room) {
  skipUnplayableTurns(room);
  recordMatchWin(room);

  room.members.forEach(m => {
    send(m.ws, snapshot(room, m));
  });
}

function error(ws, message, code) {
  send(ws, {
    type: 'error',
    message,
    // An optional machine-readable reason. The gate uses it so the page can do
    // more than echo a sentence - it can open the screen that fixes the
    // problem. Callers that pass nothing stay a plain message.
    code: code || undefined
  });
}

function closeRoom(room, reason) {
  const members = room.members.slice();
  if (room.interactionTimer) clearTimeout(room.interactionTimer);
  if (room.pendingInteraction && room.pendingInteraction.countdownTimer) clearTimeout(room.pendingInteraction.countdownTimer);
  room.interactionTimer = null;
  room.pendingInteraction = null;
  rooms.delete(room.code);
  for (const member of members) {
    member.room = null;
    if (!member.ws) continue;
    member.ws.member = null;
    if (member.ws.readyState === WebSocket.OPEN) {
      send(member.ws, { type: 'roomClosed', message: reason });
      member.ws.close();
    }
  }
  console.log(`[PHOENIX diagnostic] DELETE instance=${INSTANCE_ID} room=${room.code} reason=closed`);
  broadcastLobby();
}

/**
 * Take a connection out of its room, whether it asked to leave or dropped.
 *
 * This is the SINGLE place a room loses a member, because the two ways it can
 * happen must agree. A lobby loses the seat outright, and the room is deleted
 * the moment it is empty, so a lobby can never be left behind in the public
 * browser. A STARTED match keeps the seat (its socket cleared) so the player can
 * come back inside the abandon grace window - the match pauses rather than
 * collapsing for everyone still connected.
 *
 * `reason` only labels the diagnostic line; the behaviour is the same either way.
 */
function leaveRoom(ws, reason) {
  const m = ws.member;

  if (!m) return;

  const room = m.room;
  if (m.ws !== ws) { ws.member = null; return; }

  m.ws = null;
  ws.member = null;

  if (room.phase === 'lobby') {
    room.members.splice(m.seat, 1);

    room.members.forEach((p, i) => {
      p.seat = i;
    });

    if (!room.members.length) {
      rooms.delete(room.code);

      console.log(
        `[PHOENIX diagnostic] DELETE instance=${INSTANCE_ID} room=${room.code} reason=${reason}`
      );
    }
  } else {
    pauseRoom(room);
    if (room.members.every(member => !member.ws)) room.abandonedAt = Date.now();
    room.log.push(m.name + ' disconnected. Match paused.');
  }

  broadcastLobby();
  broadcast(room);
}

function handleAdmin(ws, data) {
  if (data.type === 'admin_auth') {
    // A signed-in OWNER account is already authorised by its server-side
    // session, so it opens the dashboard with NO separate owner password.
    if (ws.admin && ws.account && ws.account.role === 'owner') {
      send(ws, adminStateMessage(ws));
      return;
    }
    const now = Date.now();
    const ip = clientIp(ws);
    const auth = authRecord(ip, now);
    if (auth.lockedUntil > now) {
      return error(ws, 'Too many incorrect attempts. Try again later.');
    }
    if (!validOwnerPassword(data.password)) {
      auth.failures.push(now);
      if (auth.failures.length >= AUTH_MAX_FAILURES) {
        auth.lockedUntil = now + AUTH_LOCK_MS;
      }
      return error(ws, 'Incorrect owner password.');
    }
    auth.failures = [];
    ws.admin = true;
    send(ws, adminStateMessage(ws));
    return;
  }

  if (!ws.admin) {
    return error(ws, 'Administrator access required.');
  }

  if (data.type === 'admin_rooms') {
    send(ws, {
      type: 'admin_rooms',
      rooms: [...rooms.values()].map(r => ({
        code: r.code,
        visibility: r.visibility,
        mode: r.mode || 'public',
        host: r.members[0] ? r.members[0].name : '',
        players: r.members.map(p => p.name),
        count: r.members.length,
        max: 5,
        phase: r.phase || 'lobby',
        rounds: r.requestedRounds || 10
      })),
      multiplayerOpen: serverState.multiplayerOpen,
      creationLocked: serverState.creationLocked
    });
    return;
  }

  if (data.type === 'admin_shutdown_room') {
    const target = rooms.get(String(data.code || '').trim().toUpperCase());
    if (!target) return error(ws, 'Room not found.');
    closeRoom(target, 'This lobby was shut down by the owner.');
    send(ws, adminStateMessage(ws));
    return;
  }

  if (data.type === 'admin_shutdown_all') {
    serverState.multiplayerOpen = false;
    saveServerState();
    const all = [...rooms.values()];
    for (const r of all) closeRoom(r, 'PHOENIX multiplayer was closed by the owner.');
    send(ws, adminStateMessage(ws));
    return;
  }

  if (data.type === 'admin_reopen') {
    serverState.multiplayerOpen = true;
    saveServerState();
    send(ws, adminStateMessage(ws));
    broadcastLobby();
    return;
  }

  if (data.type === 'admin_lock_creation') {
    serverState.creationLocked = true;
    saveServerState();
    send(ws, adminStateMessage(ws));
    return;
  }

  if (data.type === 'admin_unlock_creation') {
    serverState.creationLocked = false;
    saveServerState();
    send(ws, adminStateMessage(ws));
    return;
  }
  return error(ws, 'Unknown admin command.');
}

/* ------------------------------------------------------------------ */
/* Account security: the server-side gameplay gate                      */
/* ------------------------------------------------------------------ */

/** Every connection this process is holding. */
function liveSockets() {
  return Array.from(wss.clients || []);
}

/**
 * Re-resolve restrictions for every live connection.
 *
 * Called the instant a restriction is issued or lifted, which is what makes a
 * mid-match ban take effect immediately rather than at the next reload: the
 * player is taken out of their room, told why, and their socket is closed.
 * Every later message they manage to send is refused too, because the gate
 * below reads ws.ban, which is now set.
 *
 * Lifting a restriction pushes `banned-cleared`, so somebody watching the
 * restriction screen is let straight back in without reloading anything.
 */
async function applyRestrictionsToLiveConnections() {
  for (const sock of liveSockets()) {
    if (!sock.account && !sock.deviceId) continue;

    let ban = null;
    try {
      ban = await Moderation.restrictionFor({
        accountId: sock.account ? sock.account.id : null,
        ip: sock.ip || null,
        deviceId: sock.deviceId || null
      });
    } catch (err) {
      console.error('[PHOENIX moderation] live sweep failed -> ' + Auth.describeError(err));
      continue;
    }

    const wasBanned = Boolean(sock.ban);
    sock.ban = ban || null;
    sock.gateCheckedAt = Date.now();

    if (ban && !wasBanned) {
      send(sock, { type: 'banned', ban: Moderation.publicView(ban, sock.account && sock.account.id) });
      if (sock.member) leaveRoom(sock, 'banned');
      const killer = setTimeout(() => {
        try { sock.close(); } catch (e) { /* already gone */ }
      }, 250);
      if (killer && typeof killer.unref === 'function') killer.unref();
    } else if (!ban && wasBanned) {
      send(sock, { type: 'banned-cleared' });
    }
  }
}

/** Tell every socket this account holds that its email is now proven. */
function announceEmailVerified(account) {
  if (!account) return;
  for (const sock of liveSockets()) {
    if (!sock.account || sock.account.id !== account.id) continue;
    sock.emailVerified = true;
    send(sock, {
      type: 'account',
      account: sock.account,
      verification: { required: false, verified: true }
    });
  }
}

/**
 * The one gate every gameplay action passes through.
 *
 * Returns null when play may continue, or why it may not. Order matters: a
 * restriction is reported before an unverified email, because somebody under a
 * restriction should see that and not an unrelated prompt.
 *
 * Both checks are cached on the socket for GATE_TTL_MS rather than re-read on
 * every card played. That is safe here - and ONLY safe here - because issuing
 * or lifting a restriction sweeps every connection immediately, so a live ban
 * never waits for a timer.
 *
 * Failure to READ a restriction degrades to "no restriction found" with a
 * logged error. Enforcement fails open, not closed: a database hiccup must
 * never lock out somebody who has done nothing wrong. That trade-off is
 * stated plainly in the delivery report.
 */
async function gameplayRefusal(ws) {
  if (!Auth.isConfigured()) return null;
  if (!ws.account) return { kind: 'signin', message: 'Please sign in to play.' };

  const now = Date.now();
  if (!ws.gateCheckedAt || now - ws.gateCheckedAt > GATE_TTL_MS) {
    ws.gateCheckedAt = now;
    try {
      ws.ban = await Moderation.restrictionFor({
        accountId: ws.account.id,
        role: ws.account.role,
        ip: ws.ip || null,
        deviceId: ws.deviceId || null
      }) || null;
    } catch (err) {
      console.error('[PHOENIX moderation] gate check failed -> ' + Auth.describeError(err));
    }
    try {
      const status = await EmailVerification.status(ws.account);
      // `required: false` covers every case where verification simply does not
      // apply: no Supabase, the migration not run yet, or already proven.
      ws.emailVerified = Boolean(status.verified) || status.required === false;
    } catch (err) {
      console.error('[PHOENIX email] gate check failed -> ' + Auth.describeError(err));
    }
  }

  if (ws.ban) {
    return { kind: 'ban', ban: Moderation.publicView(ws.ban, ws.account.id) };
  }
  if (!ws.emailVerified) {
    return { kind: 'email', message: EmailVerification.REQUIRED_NOTICE };
  }
  return null;
}

async function handle(ws, data) {
  if (!data || typeof data !== 'object') {
    return;
  }

  // Gallery sessions, BEFORE anything else and before `ws.member` is consulted.
  //
  // They deliberately do not touch ws.member: a gallery visitor is not in a room,
  // so every gameplay branch below keeps refusing them on its own. Read-only is
  // therefore structural, not a list of things a guest is not allowed to do.
  if (handleGallery(ws, data)) {
    return;
  }

  // Owner administration, before `ws.member` is consulted: an admin must be able
  // to authenticate and inspect the whole server without ever creating a room.
  if (String(data.type).startsWith('admin_')) {
    return handleAdmin(ws, data);
  }

  // ---- Account security gate ------------------------------------------------
  // Everything below this line is GAMEPLAY: opening a room, joining one,
  // starting a match, picking an ally, playing a card. Every one of them is
  // refused server-side for a restricted account, for an unverified email, and
  // for anybody who is not signed in - no matter what the page says, and
  // whether or not the request came from this site's own JavaScript. Editing
  // the frontend, clearing storage or driving the socket by hand all arrive
  // here and are all answered the same way.
  const refusal = await gameplayRefusal(ws);
  if (refusal) {
    if (refusal.kind === 'ban') {
      return send(ws, { type: 'banned', ban: refusal.ban });
    }
    // Tagged so the page can open the verification screen itself. Telling a
    // player to add an email and then making them hunt for the box is a trap;
    // they tried to play, so show them the thing that unblocks play.
    if (refusal.kind === 'email') {
      return error(ws, refusal.message, 'email-required');
    }
    return error(ws, refusal.message);
  }

  if (data.type === 'create') {
    if (Auth.isConfigured() && !ws.account) {
      return error(ws, 'Please sign in to play.');
    }
    if (ws.member) {
      return error(ws, 'Already in a room.');
    }

    if (!serverState.multiplayerOpen) {
      return error(
        ws,
        'Multiplayer is currently closed by the owner. Try again later.'
      );
    }

    // OWNER & FRIENDS. A create that carries an owner password is the original
    // private game: only someone who knows the password can open the room, it is
    // never listed, and it deliberately receives NO `publicAllies`, so the real
    // ally names, portraits and abilities stay exactly as the catalogue has them
    // on every screen. A public create (no password) keeps its randomised
    // animal identities and never touches the real ones.
    //
    // A signed-in OWNER needs no password at all. Their authority comes from
    // accounts.role - verified on the server, from the session cookie, on every
    // single request. Nothing about this check reads a username.
    const isOwner = !!(ws.account && ws.account.role === 'owner');

    const ownerRequested =
      isOwner ||
      (typeof data.ownerPassword === 'string' && data.ownerPassword.length > 0);

    if (ownerRequested) {
      // Only the password path is rate-limited and lockout-protected: an
      // owner's session has already passed sign-in.
      if (!isOwner) {
        const now = Date.now();
        const ip = clientIp(ws);
        const auth = authRecord(ip, now);

        if (auth.lockedUntil > now) {
          return error(
            ws,
            'Too many incorrect attempts. Try again later.'
          );
        }

        if (!validOwnerPassword(data.ownerPassword)) {
          auth.failures.push(now);

          if (auth.failures.length >= AUTH_MAX_FAILURES) {
            auth.lockedUntil = now + AUTH_LOCK_MS;
          }

          return error(
            ws,
            'Incorrect owner password or too many attempts.'
          );
        }

        auth.failures = [];
      }

      if (serverState.creationLocked) {
        return error(
          ws,
          'Lobby creation is locked by the owner. Join an existing lobby instead.'
        );
      }

      if (rooms.size >= MAX_ROOMS) {
        return error(
          ws,
          'The server has reached its room limit. Try later.'
        );
      }

      const ownerRoom = {
        code: code(),
        name: playerName(ws, data),
        visibility: 'private',
        mode: 'owner',
        createdAt: Date.now(),
        members: [],
        state: null,
        phase: 'lobby',
        requestedRounds: 10,
        log: ['Private room created. Invite at least one friend to start.']
      };

      rooms.set(ownerRoom.code, ownerRoom);

      const ownerMember = {
        seat: 0,
        name: playerName(ws, data),
        ally: null,
        badges: memberBadges(ws),
        account: memberAccount(ws),
        ws,
        room: ownerRoom
      };

      ownerRoom.members.push(ownerMember);
      ws.member = ownerMember;

      // Deliberately NOT broadcastLobby(): an owner room is private and must
      // never appear in the public lobby browser.
      broadcast(ownerRoom);
      return;
    }

    if (serverState.creationLocked) {
      return error(
        ws,
        'Lobby creation is locked by the owner. Join an existing lobby instead.'
      );
    }

    // Creation is open to every visitor, so it gets a per-IP budget instead of
    // the owner password. This stops one address from filling the room table.
    const now = Date.now();
    const ip = clientIp(ws);
    let stamps = creationTimes.get(ip) || [];
    stamps = stamps.filter(t => now - t < CREATE_WINDOW_MS);
    if (stamps.length >= MAX_CREATES_PER_IP) {
      return error(
        ws,
        'You have created too many lobbies recently. Try again later.'
      );
    }
    stamps.push(now);
    creationTimes.set(ip, stamps);

    if (rooms.size >= MAX_ROOMS) {
      return error(
        ws,
        'The server has reached its room limit. Try later.'
      );
    }

    // Optional custom invite code: blank (or missing) means a PUBLIC lobby -
    // listed in the shared lobby browser, joinable by anyone - and non-blank
    // means a PRIVATE lobby that only players with that exact code can find.
    const requestedCode = typeof data.code === 'string'
      ? data.code.trim().toUpperCase()
      : '';

    let visibility = 'public';
    let roomCode = code();

    if (requestedCode) {
      if (!/^[A-Z0-9]{3,6}$/.test(requestedCode)) {
        return error(ws, 'Invite codes must be 3-6 letters or numbers.');
      }
      if (rooms.has(requestedCode)) {
        return error(ws, 'That invite code is already in use. Try another.');
      }
      visibility = 'private';
      roomCode = requestedCode;
    }

    const room = {
      code: roomCode,
      name: playerName(ws, data),
      visibility,
      mode: 'public',
      publicAllies: publicAllies(),
      createdAt: Date.now(),
      members: [],
      state: null,
      phase: 'lobby',
      requestedRounds: 10,
      log: [
        visibility === 'public'
          ? 'Public lobby created. Anyone on the site can join.'
          : 'Private lobby created. Share the invite code with friends.'
      ]
    };

    rooms.set(room.code, room);

    const m = {
      seat: 0,
      name: playerName(ws, data),
      ally: null,
      badges: memberBadges(ws),
      account: memberAccount(ws),
      ws,
      room
    };

    room.members.push(m);
    ws.member = m;

    broadcastLobby();
    broadcast(room);
    return;
  }

  if (data.type === 'resume') {
    if (ws.member) return error(ws, 'Already in a room.', 'resume-invalid');
    if (!serverState.multiplayerOpen) return error(ws, 'Multiplayer is closed for maintenance.', 'resume-unavailable');
    const token = typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token) ? data.token : '';
    const room = rooms.get(String(data.code || '').trim().toUpperCase());
    if (room && room.pausedAt && Date.now() - room.pausedAt >= ABANDON_GRACE_MS) {
      closeRoom(room, 'The 10-minute reconnect window expired. No unfinished-match win was awarded.');
      return error(ws, 'The saved match reconnect window expired.', 'resume-invalid');
    }
    const member = token && room && room.phase !== 'lobby' && room.members.find(m =>
      m.resumeToken && crypto.timingSafeEqual(Buffer.from(m.resumeToken), Buffer.from(token)));
    if (!member || (Auth.isConfigured() && (!member.account || !ws.account || member.account.id !== ws.account.id))) {
      return error(ws, 'This saved seat is no longer available. Start or join a new room.', 'resume-invalid');
    }
    if (member.ws && member.ws.readyState === WebSocket.OPEN) return error(ws, 'That seat is still connected. Retrying shortly…', 'resume-busy');
    if (member.ws) member.ws.member = null;
    member.ws = ws;
    ws.member = member;
    member.resumeToken = crypto.randomBytes(32).toString('hex');
    addLog(room, member.name + ' reconnected.');
    resumeRoom(room);
    broadcast(room);
    broadcastLobby();
    return;
  }

  if (data.type === 'join') {
    if (Auth.isConfigured() && !ws.account) {
      return error(ws, 'Please sign in to play.');
    }
    if (ws.member) {
      return error(ws, 'Already in a room.');
    }

    if (!serverState.multiplayerOpen) {
      return error(ws, 'Multiplayer is currently closed by the owner. Try again later.');
    }

    const requestedCode = String(data.code || '')
      .trim()
      .toUpperCase();

    const room = rooms.get(requestedCode);

    console.log(
      `[PHOENIX diagnostic] JOIN instance=${INSTANCE_ID} room=${requestedCode} found=${!!room} totalRooms=${rooms.size} knownRooms=${[...rooms.keys()].join(',')}`
    );

    if (!room) {
      return error(
        ws,
        'Room not found. Check the invite code.'
      );
    }

    if (room.phase !== 'lobby') {
      return error(
        ws,
        'This match has already started.'
      );
    }

    if (room.members.length >= 5) {
      return error(ws, 'Room is full.');
    }

    const m = {
      seat: room.members.length,
      name: playerName(ws, data),
      ally: null,
      badges: memberBadges(ws),
      account: memberAccount(ws),
      ws,
      room
    };

    room.members.push(m);
    ws.member = m;

    room.log.push(m.name + ' joined.');

    broadcastLobby();
    broadcast(room);
    return;
  }

  // An EXPLICIT leave, sent by the browser just before it closes the socket.
  //
  // We do not rely on the close event alone: a host's proxy can sit on the
  // client's close frame for many seconds, and in that window a lobby the player
  // has already walked away from stays listed for everyone else. A data message
  // is delivered at once, so the room is removed the instant the player leaves.
  // The close handler below stays as the backstop for a dropped connection.
  if (data.type === 'leave') {
    leaveRoom(ws, 'left');
    return;
  }

  const m = ws.member;

  if (!m) {
    return error(ws, 'Create or join a room first.');
  }

  const room = m.room;

  if (data.type === 'ping') {
    send(ws, snapshot(room, m));
    return;
  }
  if (room.phase !== 'lobby' && room.members.some(member => !member.ws)) {
    return error(ws, 'A player disconnected. The match is paused.');
  }

  if (data.type === 'start') {
    if (Auth.isConfigured() && !ws.account) {
      return error(ws, 'Please sign in to play.');
    }
    if (m.seat !== 0) {
      return error(ws, 'Only the host can start.');
    }

    if (room.phase !== 'lobby') {
      return error(ws, 'Match already started.');
    }

    if (
      room.members.length < 2 ||
      room.members.length > 5 ||
      room.members.some(p => !p.ws)
    ) {
      return error(
        ws,
        'Between 2 and 5 connected players are required.'
      );
    }

    room.requestedRounds = Math.min(100, Math.max(5, Number(data.rounds) || 10));

    beginRollStage(room, 'turnDice');
    broadcast(room);
    // A started match is no longer a joinable lobby, so refresh the public
    // browser: this room must disappear from "Open public lobbies" the moment
    // the dice start, instead of sitting there with a JOIN button that only
    // ever answers "This match has already started."
    broadcastLobby();
    return;
  }

  if (data.type === 'kick') {
    if (room.phase !== 'lobby') {
      return error(ws, 'Kicking is only available in the lobby.');
    }
    const seat = Number(data.seat);
    const target = Number.isInteger(seat) && seat >= 0 ? room.members[seat] : null;
    if (!target || !target.ws) {
      return error(ws, 'No player at that seat.');
    }
    const isHost = m === room.members[0];
    const isAdmin = !!ws.admin;
    if (!isHost && !isAdmin) {
      return error(ws, 'Only the host or the owner can kick players.');
    }
    if (!isAdmin && target === room.members[0]) {
      return error(ws, 'The host cannot kick themselves.');
    }
    const name = target.name;
    room.members.splice(target.seat, 1);
    room.members.forEach((p, i) => { p.seat = i; });
    target.room = null;
    target.ws.member = null;
    const who = isAdmin ? 'the owner' : 'the host';
    if (target.ws.readyState === WebSocket.OPEN) {
      send(target.ws, { type: 'kicked', message: 'You were removed from the lobby by ' + who + '.' });
      target.ws.close();
    }
    room.log.push(name + ' was removed from the lobby.');
    broadcast(room);
    broadcastLobby();
    return;
  }

  if (data.type === 'close_room') {
    if (room.phase !== 'lobby') {
      return error(ws, 'Closing is only available in the lobby.');
    }
    const isAdmin = !!ws.admin;
    const isHost = m === room.members[0];
    if (!isHost && !isAdmin) {
      return error(ws, 'Only the host can close this lobby.');
    }
    closeRoom(room, 'The lobby was closed by ' + (isAdmin ? 'the owner' : 'the host') + '.');
    return;
  }

  if (data.type === 'roll') {
    if (Auth.isConfigured() && !ws.account) {
      return error(ws, 'Please sign in to play.');
    }
    if (!['turnDice', 'allyDice'].includes(room.phase)) {
      return error(ws, 'Not rolling dice now.');
    }

    if (!diceRoll(room, m)) {
      return error(ws, 'Wait for your turn to roll.');
    }

    broadcast(room);
    return;
  }

  if (data.type === 'chooseAlly') {
    if (Auth.isConfigured() && !ws.account) {
      return error(ws, 'Please sign in to play.');
    }
    if (room.phase !== 'draft') {
      return error(ws, 'Not choosing allies now.');
    }

    if (
      room.members[room.allyOrder[room.draftIndex]] !== m
    ) {
      return error(
        ws,
        'Not your turn to choose an ally.'
      );
    }

    if (
      data.ally === 'ted' &&
      room.members.length < 3
    ) {
      return error(
        ws,
        'Ted requires at least 3 players. 4 or more players are recommended.'
      );
    }

    if (
      !ALLIES.includes(data.ally) ||
      room.members.some(p => p.ally === data.ally)
    ) {
      return error(
        ws,
        'That ally is not available.'
      );
    }

    m.ally = data.ally;

    addLog(
      room,
      m.name + ' chose ' + allyShown(room, data.ally) + '.'
    );

    room.draftIndex++;

    if (room.draftIndex === room.members.length) {
      startGame(room);
    }

    broadcast(room);
    return;
  }

  if (data.type === 'interact') {
    if (Auth.isConfigured() && !ws.account) {
      return error(ws, 'Please sign in to play.');
    }
    const s = room.state;
    if (!s || s.over) {
      return error(ws, 'No active match.');
    }
    if (room.members.some(p => !p.ws)) {
      return error(ws, 'A player disconnected. The match is paused.');
    }

    const pi = room.pendingInteraction;
    if (!pi) {
      return error(ws, 'No interaction pending.');
    }

    const seat = m.seat;
    const playerId = Rules.SEATS[seat].id;

    // Only participants may submit.
    if (!pi.participants.includes(playerId)) {
      return error(ws, 'You are not part of this interaction.');
    }

    if (pi.type === 'speed') {
      const outcome = SpeedInteraction.submit(pi, playerId, String(data.decision || ''), Date.now(), ws.roundTripMs);
      if (outcome.error) return error(ws, outcome.error);
      if (data.decision === 'ready' && ws.measureLatency) ws.measureLatency();
      if (outcome.countdownMs) {
        pi.countdownTimer = setTimeout(() => {
          if (room.pendingInteraction !== pi) return;
          pi.phase = 'react';
          pi.goTime = Date.now();
          broadcast(room);
        }, outcome.countdownMs);
      }
      if (outcome.done) finishInteraction(room);
      else broadcast(room);
      return;
    }

    // Already submitted for this phase?
    const phaseKey = pi.phase || 'main';
    if (!pi.decisions[phaseKey]) pi.decisions[phaseKey] = {};
    if (pi.decisions[phaseKey][playerId] !== undefined) {
      return error(ws, 'You have already submitted for this phase.');
    }

    // Validate the decision based on interaction type and phase.
    const decision = String(data.decision || '').trim();
    if (decision.length > 40) return error(ws, 'Decision is too long.');

    if (pi.type === 'rps' && !['rock', 'paper', 'scissors'].includes(decision)) {
      return error(ws, 'Choose rock, paper or scissors.');
    }
    if (pi.type === 'betrayal' && !['share', 'steal'].includes(decision)) {
      return error(ws, 'Choose share or steal.');
    }
    if (pi.type === 'dice' && decision !== 'roll') {
      return error(ws, 'Invalid decision.');
    }
    if ((pi.type === 'wheel' || pi.type === 'wheelofmisfortune') && decision !== 'spin') {
      return error(ws, 'Invalid decision.');
    }
    if (pi.type === 'linkedfate' && decision !== 'ack') {
      return error(ws, 'Invalid decision.');
    }
    if (pi.type === 'swapper' && decision !== 'ack') {
      return error(ws, 'Invalid decision.');
    }
    if (pi.type === 'impostor') {
      // Clues and votes handled separately
      if (phaseKey !== 'vote' && (!decision.startsWith('clue:') || !decision.substring(5).trim())) {
        return error(ws, 'Invalid clue.');
      }
      if (phaseKey === 'vote' && (!decision.startsWith('vote:') || !pi.participants.includes(decision.substring(5)) || decision.substring(5) === playerId)) {
        return error(ws, 'Invalid vote.');
      }
    }

    if (pi.type === 'wheel' && playerId !== pi.actorId) return error(ws, 'Only the caster can spin.');

    // Store in phase-based structure
    pi.decisions[phaseKey][playerId] = decision;
    // Also store in flat structure for all interactive cards (resolve functions read from flat)
    if (!pi.decisions.main) pi.decisions.main = {};
    pi.decisions.main[playerId] = decision;
    // Also store at top level for resolver compatibility (resolvers read pi.decisions[playerId])
    pi.decisions[playerId] = decision;
    pi.submittedAt[playerId] = Date.now();
    if (pi.type === 'impostor' && phaseKey === 'vote') pi.roundData.votes[playerId] = decision.substring(5);

    if (pi.type === 'dice') {
      // Simple: both roll, then resolve
      const allRolled = pi.participants.every(p => pi.decisions.main && pi.decisions.main[p] === 'roll');
      if (!allRolled) {
        send(ws, { type: 'interact-ack', interaction: pi.type });
        broadcast(room);
        return;
      }
      finishInteraction(room);
      return;
    }

    if (pi.type === 'wheel') {
      finishInteraction(room);
      return;
    }

    if (pi.type === 'linkedfate' || pi.type === 'swapper') {
      // Both acknowledge, then resolve
      const allAcked = pi.participants.every(p => pi.decisions.main && pi.decisions.main[p] === 'ack');
      if (!allAcked) {
        send(ws, { type: 'interact-ack', interaction: pi.type });
        broadcast(room);
        return;
      }
      finishInteraction(room);
      return;
    }

    if (pi.type === 'impostor') {
      // Multi-phase: clues -> votes -> resolve
      // Handle initial phase (waiting/main) as clues phase
      if (phaseKey === 'waiting' || phaseKey === 'main' || phaseKey === 'clues') {
        const cluesKey = phaseKey === 'waiting' || phaseKey === 'main' ? 'main' : 'clues';
        const allClued = pi.participants.every(p => pi.decisions[cluesKey] && pi.decisions[cluesKey][p]);
        if (!allClued) {
          send(ws, { type: 'interact-ack', interaction: pi.type, phase: 'clues' });
          broadcast(room);
          return;
        }
        // Voting gets its own complete deadline, independent of clue timing.
        pi.decisions.clues = pi.decisions[cluesKey];
        beginImpostorVoting(room, pi);
        broadcast(room);
        return;
      } else if (phaseKey === 'vote') {
        const allVoted = pi.participants.every(p => pi.decisions.vote && pi.decisions.vote[p]);
        if (!allVoted) {
          send(ws, { type: 'interact-ack', interaction: pi.type, phase: 'vote' });
          broadcast(room);
          return;
        }
        // Store votes in roundData
        if (!pi.roundData.votes) pi.roundData.votes = {};
        pi.participants.forEach(p => {
          const vote = pi.decisions.vote[p];
          if (vote && vote.startsWith('vote:')) {
            pi.roundData.votes[p] = vote.substring(5);
          }
        });
        finishInteraction(room);
        return;
      }
    }

    // Default: check if all participants have submitted for main phase
    const allSubmitted = pi.participants.every(p => pi.decisions.main && pi.decisions.main[p] !== undefined);
    if (!allSubmitted) {
      send(ws, { type: 'interact-ack', interaction: pi.type });
      broadcast(room);
      return;
    }

    // All decisions are in - resolve, advance and broadcast.
    finishInteraction(room);
    return;
  }

  if (data.type === 'move') {
    if (Auth.isConfigured() && !ws.account) {
      return error(ws, 'Please sign in to play.');
    }
    const s = room.state;

    if (!s || s.over) {
      return error(ws, 'No active match.');
    }

    if (room.members.some(p => !p.ws)) {
      return error(
        ws,
        'A player disconnected. The match is paused.'
      );
    }

    const id = Rules.SEATS[m.seat].id;
    const pending = dueChoice(s);
    const actor = s.players.find(p => p.id === id);

    if (room.pendingInteraction) {
      return error(ws, 'An interaction is in progress. Submit your decision first.');
    }

    if (
      pending
        ? pending.chooserId !== id
        : s.players[s.turnInRound].id !== id
    ) {
      return error(ws, 'It is not your turn.');
    }

    const cardId = String(data.cardId || '').slice(0, 40);

    const targetId = data.targetId === null
      ? null
      : String(data.targetId || '').slice(0, 40);

    const options = pending
      ? pending.options
      : Rules.legalMoves(s, s.turnInRound);

    if (
      !options.some(o =>
        o.cardId === cardId &&
        (o.targetId || null) === (targetId || null)
      )
    ) {
      return error(ws, 'That move is not legal.');
    }

    // Maple's Sweet Tooth is enforced HERE, on the server, not merely by leaving
    // the card out of the snapshot's moves. Hiding it client-side would be a
    // suggestion: anyone with a devtools console could send the move anyway, and a
    // restriction the player can walk around is not a restriction. This is the
    // same reason the move is checked against `options` above.
    const mapleBlocked = Maple.blockedForAction(room,m.seat,pending);
    if (mapleBlocked.length && mapleBlocked.indexOf(cardId) !== -1) {
      // This rejection is private feedback, not a public claim of a card play.
      send(ws, { type: 'effect', effect: Effects.publicEvent('maple-restriction', m.seat, m.seat) });
      return error(
        ws,
        allyShown(room, 'maple') + ' will not let you play that - nice cards only for ' +
          Maple.ROUNDS +
          ' rounds.'
      );
    }

    // Interactive cards: create a pending interaction instead of resolving immediately.
    const interactiveCards = ['rps', 'betrayal', 'speed', 'dice', 'wheel', 'linkedfate', 'impostor', 'swapper', 'wheelofmisfortune'];
    if (interactiveCards.includes(cardId) && (!pending || pending.kind === Rules.PENDING_CHOICE_KINDS.MOVE)) {
      // A stolen turn changes who chooses the card, not who owns/plays it.
      const actor = s.players[s.turnInRound];
      const id = actor.id;
      // Validate participants.
      if (cardId === 'rps' && (!targetId || targetId === id)) {
        return error(ws, 'Choose a valid opponent.');
      }
      if (cardId === 'betrayal') {
        const others = s.players.filter(p => Rules.isLegalTarget(s, actor.seat, Cards.byId(cardId), p));
        if (others.length < 2) {
          return error(ws, 'Betrayal needs two eligible opponents.');
        }
      }
      if (cardId === 'speed' && (!targetId || targetId === id)) {
        return error(ws, 'Choose a valid opponent.');
      }
      if (cardId === 'dice' && (!targetId || targetId === id)) {
        return error(ws, 'Choose a valid opponent.');
      }
      if (cardId === 'linkedfate' && (!targetId || targetId === id)) {
        return error(ws, 'Choose a valid opponent.');
      }
      if (cardId === 'swapper' && (!targetId || targetId === id)) {
        return error(ws, 'Choose a valid opponent.');
      }
      if (cardId === 'impostor') {
        // Impostor needs at least 4 players total (actor + 3 others)
        const eligible = s.players.filter(p => p.enabled && !Rules.isOut(p, s));
        if (eligible.length < 4) {
          return error(ws, 'Impostor needs at least 4 players total.');
        }
      }
      if (cardId === 'wheel') {
        // Wheel needs no target - it affects everyone
      }

      // Move card to discard.
      if (pending) s.pendingChoice = null;
      Rules.moveCardToDiscard(s, actor, cardId);

      room.pendingInteraction = {
        type: cardId,
        actorSeat: actor.seat,
        actorId: id,
        targetId: targetId || null,
        participants: null,
        decisions: {},
        submittedAt: {},
        createdAt: Date.now(),
        timeoutMs: (cardId === 'impostor' || cardId === 'wheel' || cardId === 'wheelofmisfortune') ? 60000 : 30000,
        // Card-specific state
        phase: cardId === 'speed' ? 'ready' : cardId === 'impostor' ? 'clues' : 'waiting',
        roundData: {}     // For storing rolls, spins, etc.
      };

      // Set up participants based on card type.
      if (cardId === 'rps' || cardId === 'speed' || cardId === 'dice' || cardId === 'linkedfate' || cardId === 'swapper') {
        room.pendingInteraction.participants = [id, targetId];
      } else if (cardId === 'wheel' || cardId === 'wheelofmisfortune') {
        // Wheel affects all players, no target needed
        const eligible = s.players.filter(p => p.enabled && !Rules.isOut(p, s));
        room.pendingInteraction.participants = eligible.map(p => p.id);
      } else if (cardId === 'betrayal') {
        const others = s.players.filter(p => Rules.isLegalTarget(s, actor.seat, Cards.byId(cardId), p));
        others.sort((a, b) => (b.id === targetId ? 1 : 0) - (a.id === targetId ? 1 : 0));
        room.pendingInteraction.participants = [others[0].id, others[1].id];
        room.pendingInteraction.targetIds = [others[0].id, others[1].id];
      } else if (cardId === 'impostor') {
        const eligible = s.players.filter(p => p.enabled && !Rules.isOut(p, s));
        room.pendingInteraction.participants = eligible.map(p => p.id);

        // Assign words immediately and store in roundData for client display
        const impostorIdx = Math.floor(Math.random() * eligible.length);
        const impostor = eligible[impostorIdx];
        const words = [
          { main: 'Coffee', impostor: 'Tea' },
          { main: 'Cat', impostor: 'Dog' },
          { main: 'Pizza', impostor: 'Burger' },
          { main: 'Summer', impostor: 'Winter' },
          { main: 'Ocean', impostor: 'Mountain' },
          { main: 'Book', impostor: 'Movie' },
          { main: 'Apple', impostor: 'Orange' },
          { main: 'Car', impostor: 'Bike' }
        ];
        const wordPair = words[Math.floor(Math.random() * words.length)];

        // Store words for each player in roundData
        const playerWords = {};
        eligible.forEach(p => {
          playerWords[p.id] = (p.id === impostor.id) ? wordPair.impostor : wordPair.main;
        });

        room.pendingInteraction.roundData.impostorId = impostor.id;
        room.pendingInteraction.roundData.wordPair = wordPair;
        room.pendingInteraction.roundData.playerWords = playerWords;
        room.pendingInteraction.roundData.clues = {};
        room.pendingInteraction.roundData.votes = {};
      }

      // Safety net: if a participant never responds, auto-resolve after timeout.
      scheduleInteractionTimeout(room, room.pendingInteraction, room.pendingInteraction.timeoutMs);

      recordEvents(room, [{
        type: 'card',
        cardId: cardId,
        seat: actor.seat,
        targetSeat: targetId ? s.players.findIndex(p => p.id === targetId) : -1,
        text: actor.name + ' plays ' + Cards.byId(cardId).name + '.'
      }]);

      // Don't advance turn yet - wait for interaction to resolve.
      broadcast(room);
      return;
    }

    const beforePoints = s.players.map(p => p.points);

    const result = pending
      ? Rules.resolvePendingChoice(
          s,
          cardId,
          targetId,
          () => shareLinkedGains(s, beforePoints)
        )
      : Rules.playCard(
          s,
          s.turnInRound,
          cardId,
          targetId,
          () => shareLinkedGains(s, beforePoints)
        );

    if (!result.ok) {
      return error(
        ws,
        result.error || 'Move rejected.'
      );
    }

    recordEvents(room, result.events);

    if (
      s.round !== room.lastPhoenixRound &&
      !s.over
    ) {
      room.lastPhoenixRound = s.round;
      applyPhoenix(room);
        applyTed(room);
        applyMaple(room);
        applyLinkedFate(room);
      }

    broadcast(room);
    return;
  }
}

function ally(id) {
  return [
    'phoenix',
    'tilly',
    'maple',
    'louie',
    'simba',
    'elsie',
    'ted'
  ].includes(id)
    ? id
    : 'phoenix';
}

wss.on('connection', (ws, request) => {
  ws.lastPongAt = Date.now();
  let latencyProbe = null;
  const roundTrips = [];
  ws.roundTripMs = 0;
  ws.measureLatency = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    latencyProbe = { nonce: crypto.randomBytes(8), sentAt: Date.now() };
    ws.ping(latencyProbe.nonce);
  };
  ws.on('pong', data => {
    ws.lastPongAt = Date.now();
    if (!latencyProbe || !data.equals(latencyProbe.nonce)) return;
    roundTrips.push(Math.max(0, Date.now() - latencyProbe.sentAt));
    if (roundTrips.length > 5) roundTrips.shift();
    ws.roundTripMs = Math.min(...roundTrips);
    latencyProbe = null;
  });
  ws.measureLatency();
  send(ws, lobbySnapshot());

  // Resolving the session needs a round trip to the database, but the browser
  // can send its first message before that finishes. Attaching the message
  // handler only AFTER the await used to drop those early messages on the
  // floor (no listener, no error). Instead: buffer them, then play them back
  // in order once the session is known - so nothing is lost and nothing is
  // processed before we know who is asking.
  const pending = [];
  let ready = false;

  function dispatch(raw) {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (e) {
      error(ws, 'Invalid request.');
      return;
    }
    // handle() is async (the security gate reads the database). A rejected
    // promise here would be an unhandled rejection, which takes a Node 18+
    // process down - so it is caught, logged and answered like any other bad
    // message rather than allowed to kill the server.
    Promise.resolve()
      .then(() => handle(ws, data))
      .catch(err => {
        console.error('[PHOENIX ws] unhandled error in "' + String(data && data.type) +
          '" -> ' + Auth.describeError(err));
        error(ws, 'Something went wrong. Please try again.');
      });
  }

  ws.on('message', raw => {
    if (ready) dispatch(raw);
    else pending.push(raw);
  });

  Auth.getSessionAccount(request)
    .catch(() => null)
    .then(async account => {
      ws.account = account;
      // A permanent OWNER account grants owner controls automatically after
      // login - no separate owner password prompt is ever shown to the owner.
      ws.admin = !!(account && account.role === 'owner');
      // Tell the client who it is signed in as. This is NOT admin_state: the
      // dashboard is only revealed when the client actually asks for it, so
      // merely connecting as the owner never pops it over the lobby.
      if (account) {
        send(ws, { type: 'account', account });
      }

      // Featured badges for this connection, resolved ONCE here rather than on
      // every snapshot. Everything buffered below waits for this, so `badges`
      // is always set before a create or join can be handled. It cannot throw
      // - featuredBadges degrades to an empty list - so play is never blocked
      // by a badge lookup.
      ws.badges = [];
      if (account) {
        try {
          ws.badges = await Badges.featuredBadges(account);
        } catch (err) {
          console.error('[PHOENIX badges] connection lookup failed -> ' +
            Auth.describeError(err));
        }
      }

      // Where is this connection coming from, and which browser token did it
      // present? Both are derived from the connection itself - the socket and
      // its cookies - so nothing in a replayed message can claim otherwise.
      ws.ip = Moderation.trustedIp(request);
      ws.deviceId = Moderation.deviceIdFrom(request);
      ws.gateCheckedAt = Date.now();
      ws.emailVerified = Boolean(account && account.emailVerified);
      // Initialise the SAME migration-aware decision used by subsequent gate
      // refreshes. A legacy account has no verified-email column; treating that
      // absence as "unverified" blocked valid sockets for the cache TTL even
      // though registration and HTTP correctly recognised the legacy schema.
      if (account) {
        try {
          const status = await EmailVerification.status(account);
          ws.emailVerified = Boolean(status.verified) || status.required === false;
        } catch (err) {
          console.error('[PHOENIX email] connection check failed -> ' + Auth.describeError(err));
        }
      }
      ws.ban = null;

      // Record the sighting HERE, not only on /api/me. A player can open a
      // socket without ever calling /api/me, so an owner banning by network
      // would otherwise find no address on file and silently issue only the
      // account half of the restriction. Awaited on purpose: the address has
      // to be on record before anything reads it.
      if (account) {
        await Moderation.observe(account, ws.ip, ws.deviceId);
      }

      // Restriction check, BEFORE a single buffered message is replayed: a
      // banned player's create/join arrives below and is refused by the gate,
      // and they are told why on this connection too - so clearing cookies,
      // signing out or using another browser changes nothing.
      if (account) {
        try {
          ws.ban = await Moderation.restrictionFor({
            accountId: account.id,
            role: account.role,
            ip: ws.ip,
            deviceId: ws.deviceId
          }) || null;
        } catch (err) {
          console.error('[PHOENIX moderation] handshake check failed -> ' +
            Auth.describeError(err));
          ws.ban = null;
        }
        if (ws.ban) {
          send(ws, { type: 'banned', ban: Moderation.publicView(ws.ban, account.id) });
        }
      }

      ready = true;
      for (const raw of pending) dispatch(raw);
      pending.length = 0;
    });

  ws.on('close', () => {
    // A gallery dies with the connection that opened it, BEFORE the room check
    // below - a gallery visitor is never in a room, so `!m` would have returned
    // first and left the code live for the rest of its TTL.
    //
    // A gallery is a hole in the front door. One whose owner has walked away
    // should not stay open because somebody wrote the code down.
    if (ws.gallery && ws.gallery.owner) {
      Gallery.close(galleries, ws.gallery.code, ws, Date.now());
    }

    ws.gallery = null;

    leaveRoom(ws, 'host-disconnected');
  });
});

// Detect silent network loss too, not just an orderly browser close frame.
const connectionHeartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (Date.now() - ws.lastPongAt > 15000) ws.terminate();
    else if (ws.measureLatency) ws.measureLatency();
  }
}, 5000);
connectionHeartbeat.unref();

httpServer.listen(
  PORT,
  process.env.PHOENIX_BIND_HOST || '0.0.0.0',
  () => {
    console.log(
      `PHOENIX multiplayer server: http://localhost:${PORT} instance=${INSTANCE_ID}`
    );
    // Read-only Supabase health check. Deliberately AFTER listen() so a slow
    // database can never delay or break startup; the verdict lands in the log.
    Auth.probe().catch(err => {
      console.error('[PHOENIX auth] probe failed -> ' + Auth.describeError(err));
    });
  }
);
