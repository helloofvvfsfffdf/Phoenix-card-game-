
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const Rules = require('./js/rules.js');
const Maple = require('./js/maple.js');
const Effects = require('./js/effects.js');
const Gallery = require('./js/gallery.js');
const Auth = require('./js/auth.js');
const Badges = require('./js/badges.js');
const Announcements = require('./js/announcements.js');
const Wins = require('./js/wins.js');
const EmailVerification = require('./js/email-verification.js');
const Moderation = require('./js/moderation.js');

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
const serverState = { multiplayerOpen: true, creationLocked: false };

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
 * closes any started room that has had no live connection for the grace period;
 * a room with even one live player is never touched.
 */
const ABANDON_GRACE_MS = 10 * 60 * 1000;
const abandonedCleanup = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of [...rooms]) {
    if (room.phase === 'lobby') continue;
    const live = room.members.some(
      m => m.ws && m.ws.readyState === WebSocket.OPEN
    );
    if (live) continue;
    if (now - (room.createdAt || now) < ABANDON_GRACE_MS) continue;
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
  const [card] = from.splice(
    crypto.randomInt(from.length),
    1
  );

  s.hands[Rules.SEATS[owner.seat].id].push(card);
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

function applyLinkedFate(room) {
  const s = room.state;
  if (!s || s.over || !s.linkedFate) return;
  // Decrement rounds and remove expired links.
  s.linkedFate = s.linkedFate.filter(function (link) {
    link.roundsLeft--;
    return link.roundsLeft > 0;
  });
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
      : false
  }));

  const current = s ? s.players[s.turnInRound] : null;
  const pending = s ? dueChoice(s) : null;
  const mine = Rules.SEATS[member.seat].id;

  const acting = !!(
    s &&
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
  rooms.delete(room.code);
  for (const member of members) {
    member.room = null;
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

    room.requestedRounds = Math.min(
      20,
      Math.max(5, Number(data.rounds) || 10)
    );

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

    const beforePoints = s.players.map(p => p.points);

    const result = pending
      ? Rules.resolvePendingChoice(
          s,
          cardId,
          targetId
        )
      : Rules.playCard(
          s,
          s.turnInRound,
          cardId,
          targetId
        );

    if (!result.ok) {
      return error(
        ws,
        result.error || 'Move rejected.'
      );
    }

    // Linked Fate: share 50% of any point gain with the linked partner.
    // The bonus must not itself trigger another Linked Fate bonus, so we
    // compare before/after points and apply the bonus directly without
    // re-running the resolution path.
    if (s.linkedFate && s.linkedFate.length) {
      var gains = s.players.map((p, i) => p.points - beforePoints[i]);
      s.linkedFate.forEach(function (link) {
        var aIdx = s.players.findIndex(p => p.id === link.a);
        var bIdx = s.players.findIndex(p => p.id === link.b);
        if (aIdx === -1 || bIdx === -1) return;
        if (gains[aIdx] > 0) {
          var bonus = Math.floor(gains[aIdx] * 0.5);
          s.players[bIdx].points += bonus;
        }
        if (gains[bIdx] > 0) {
          var bonus2 = Math.floor(gains[bIdx] * 0.5);
          s.players[aIdx].points += bonus2;
        }
      });
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

httpServer.listen(
  PORT,
  '0.0.0.0',
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
