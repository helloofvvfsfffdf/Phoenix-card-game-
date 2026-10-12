
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
 *   gallery_create  owner password required, same secret and same IP lockout as
 *                   creating a room. Returns the invitation code.
 *   gallery_join    invitation code only. Never the password.
 *   gallery_close   the creating connection only. Revokes the code at once.
 *
 * @returns {boolean} true if the message was a gallery message and is handled
 */
function handleGallery(ws, data) {
  if (!String(data.type || '').startsWith('gallery_')) {
    return false;
  }

  if (data.type === 'gallery_create') {
    // The SAME owner secret, compared the SAME way, with the SAME per-IP failure
    // tracking. Reusing it is the point: one password, one lockout, no second
    // thing to get wrong.
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

    // One session per connection. Creating again replaces the old code rather than
    // leaving a second one lying around that only the owner knows is dead.
    Gallery.closeOwnedBy(galleries, ws);

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
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.efk': 'application/octet-stream',
  '.efkefc': 'application/octet-stream'
};

const httpServer = http.createServer((req, res) => {
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
      }
    }
  }

function broadcast(room) {
  skipUnplayableTurns(room);

  room.members.forEach(m => {
    send(m.ws, snapshot(room, m));
  });
}

function error(ws, message) {
  send(ws, {
    type: 'error',
    message
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

function handle(ws, data) {
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

  if (data.type === 'create') {
    if (ws.member) {
      return error(ws, 'Already in a room.');
    }

    if (!serverState.multiplayerOpen) {
      return error(
        ws,
        'Multiplayer is currently closed by the owner. Try again later.'
      );
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
      name: cleanName(data.name),
      visibility,
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
      name: cleanName(data.name),
      ally: null,
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
      name: cleanName(data.name),
      ally: null,
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

    recordEvents(room, result.events);

    if (
      s.round !== room.lastPhoenixRound &&
      !s.over
    ) {
      room.lastPhoenixRound = s.round;
      applyPhoenix(room);
        applyTed(room);
        applyMaple(room);
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

wss.on('connection', ws => {
  send(ws, lobbySnapshot());
  ws.on('message', raw => {
    try {
      handle(
        ws,
        JSON.parse(raw.toString())
      );
    } catch (e) {
      error(ws, 'Invalid request.');
    }
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
  }
);
