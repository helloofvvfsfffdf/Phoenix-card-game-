/*
 * Phoenix - gallery.js
 * ---------------------------------------------------------------------------
 * PHOENIX Gallery: private, read-only sessions for browsing the catalogue.
 *
 * WHAT THIS FILE IS, AND WHY IT IS NOT IN server.js
 * --------------------------------------------------
 * This is the whole of the gallery's access control: creating a session, joining
 * one with an invitation code, closing it, and expiring it. Nothing else.
 *
 * It is its own file for the same reason js/maple.js is. Requiring server.js
 * starts an HTTP server and refuses to boot without PHOENIX_OWNER_PASSWORD, so
 * rules that live there cannot be asserted by anything. Everything here is pure:
 * you hand it a session store, a clock and a code generator, and it answers.
 *
 * WHAT A GALLERY SESSION CONTAINS
 * -------------------------------
 * Almost nothing, deliberately. A session is a code and two timestamps. It holds
 * no catalogue, no game state, no hands and no room reference, and this module
 * cannot see any - the allies and cards are already served to every visitor as
 * ordinary page scripts.
 *
 * That is the whole privacy story, and it is structural rather than a promise:
 * the gallery introduces no new data egress at all. There is nothing private in
 * it to leak, because the content it shows was never private in the first place.
 *
 * ACCESS RULES
 * ------------
 * create  owner password required. Checked by server.js against the SAME secret
 *         and the SAME per-IP lockout used to create multiplayer rooms.
 * join    invitation code only. Never the password.
 * close   the connection that created the session, and nothing else.
 * ttl     every session expires. An expired code cannot be joined, ever.
 *
 * Guests are read-only by construction rather than by checking: a gallery session
 * is not a room membership, so `ws.member` stays null and every gameplay branch in
 * server.js already refuses them.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixGallery = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** How long a gallery session lasts. Two hours: long enough to share, not forever. */
  var TTL_MS = 2 * 60 * 60 * 1000;

  /** Ceiling on simultaneous sessions, matching the room limit. */
  var MAX_SESSIONS = 10;

  /** Normalises an invitation code the way a person types it. */
  function normalise(input) {
    return typeof input === 'string' ? input.trim().toUpperCase() : '';
  }

  /**
   * Creates a session and returns its code.
   *
   * `newCode` is passed in rather than called here, so the server supplies the
   * cryptographically secure generator and the tests supply a predictable one.
   * Collisions are resolved by asking again.
   *
   * @param store Map of code -> session
   * @param ownerId identifies the creating connection, for close()
   * @param now milliseconds
   * @param newCode () => string
   * @returns {?string} the code, or null if the ceiling is reached
   */
  function create(store, ownerId, now, newCode) {
    sweep(store, now);

    if (store.size >= MAX_SESSIONS) return null;

    var code;
    var attempts = 0;
    do {
      code = normalise(newCode());
      attempts++;
      // A generator that keeps colliding is a bug, not bad luck; bail rather than
      // spin forever.
      if (attempts > 10) return null;
    } while (store.has(code));

    store.set(code, {
      code: code,
      ownerId: ownerId,
      createdAt: now,
      expiresAt: now + TTL_MS
    });

    return code;
  }

  /**
   * Resolves an invitation code to its live session, or null.
   *
   * null covers every refusal a caller should report the same way: no such code,
   * already closed, or expired. There is deliberately no way to tell those apart
   * from outside, so a code cannot be probed for existence.
   */
  function join(store, code, now) {
    var key = normalise(code);
    if (!key) return null;

    var session = store.get(key);
    if (!session) return null;

    if (now >= session.expiresAt) {
      store.delete(key);
      return null;
    }

    return session;
  }

  /**
   * Revokes a session immediately.
   *
   * Only the connection that created it may close it, so a guest who guesses or
   * is told a code still cannot shut somebody else's gallery.
   *
   * @returns {boolean} true if this call closed it
   */
  function close(store, code, ownerId, now) {
    var key = normalise(code);
    var session = store.get(key);
    if (!session) return false;
    if (ownerId !== undefined && session.ownerId !== ownerId) return false;

    store.delete(key);
    return true;
  }

  /**
   * Closes every session owned by a connection.
   *
   * Called when the owner's socket drops. A gallery is a hole in the front door,
   * and one whose owner has walked away should not stay open for the rest of its
   * TTL on the strength of a code somebody may have written down.
   */
  function closeOwnedBy(store, ownerId) {
    var closed = [];
    store.forEach(function (session, code) {
      if (session.ownerId === ownerId) closed.push(code);
    });
    closed.forEach(function (code) { store.delete(code); });
    return closed;
  }

  /** Drops expired sessions. Cheap, so it runs on every create and every join. */
  function sweep(store, now) {
    var dropped = [];
    store.forEach(function (session, code) {
      if (now >= session.expiresAt) dropped.push(code);
    });
    dropped.forEach(function (code) { store.delete(code); });
    return dropped;
  }

  /** Milliseconds until a session expires, floored at zero. */
  function remainingMs(session, now) {
    if (!session) return 0;
    return Math.max(0, session.expiresAt - now);
  }

  /* --------------------------------------------------------------------- */
  /* Rate limiting on invitation codes                                       */
  /* --------------------------------------------------------------------- */

  /**
   * How many wrong codes one visitor may try.
   *
   * Five is deliberate. Nobody types a six-character code correctly first time
   * more than a couple of times, so five absorbs a fumbled paste or two typos
   * without anybody noticing; a guesser working through the keyspace would need
   * hundreds. It is deliberately not the owner-password allowance - guessing a
   * code is far cheaper than guessing a password, so it gets far less rope.
   */
  var CODE_MAX_FAILURES = 5;

  /** Wrong codes older than this are forgotten, so nobody is punished forever. */
  var CODE_WINDOW_MS = 5 * 60 * 1000;

  /**
   * How long a visitor is held off after using up their allowance.
   *
   * Short on purpose. A locked-out IP is often an innocent one - a house sharing
   * one address behind NAT, or a phone dropping off wifi and coming back - so
   * this is long enough to break a guessing run and short enough that somebody
   * who was genuinely invited is never locked out of it.
   */
  var CODE_LOCK_MS = 60 * 1000;

  /**
   * Is this visitor currently held off from trying codes?
   *
   * @returns {{locked: boolean, retryIn: number}} retryIn in ms, 0 when not locked
   */
  function rateLocked(fails, key, now) {
    var record = fails.get(key);
    if (!record) return { locked: false, retryIn: 0 };

    if (record.lockedUntil && record.lockedUntil > now) {
      return { locked: true, retryIn: record.lockedUntil - now };
    }

    return { locked: false, retryIn: 0 };
  }

  /**
   * Records one wrong code, and locks the visitor off once they run out.
   *
   * @returns {{locked: boolean, retryIn: number}} the state AFTER this failure
   */
  function rateFailure(fails, key, now) {
    var record = fails.get(key) || { failures: [], lockedUntil: 0 };

    // Forget anything old first, or a visitor would be locked out by mistakes
    // they made an hour ago and have long since recovered from.
    record.failures = record.failures.filter(function (at) {
      return now - at < CODE_WINDOW_MS;
    });

    record.failures.push(now);

    if (record.failures.length >= CODE_MAX_FAILURES) {
      record.lockedUntil = now + CODE_LOCK_MS;
    }

    fails.set(key, record);

    return rateLocked(fails, key, now);
  }

  /**
   * Clears a visitor's record after a success, so one fumble costs nothing.
   *
   * This is what keeps the limiter away from legitimate visitors: it measures a
   * run of failures, not a lifetime total, and the run ends the moment somebody
   * types the code they were actually given.
   */
  function rateSuccess(fails, key) {
    fails.delete(key);
  }

  return {
    TTL_MS: TTL_MS,
    MAX_SESSIONS: MAX_SESSIONS,
    CODE_MAX_FAILURES: CODE_MAX_FAILURES,
    CODE_WINDOW_MS: CODE_WINDOW_MS,
    CODE_LOCK_MS: CODE_LOCK_MS,
    normalise: normalise,
    create: create,
    join: join,
    close: close,
    closeOwnedBy: closeOwnedBy,
    rateLocked: rateLocked,
    rateFailure: rateFailure,
    rateSuccess: rateSuccess,
    sweep: sweep,
    remainingMs: remainingMs
  };
}));