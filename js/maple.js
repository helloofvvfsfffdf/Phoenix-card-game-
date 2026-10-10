/*
 * Phoenix - maple.js
 * ---------------------------------------------------------------------------
 * Maple's Sweet Tooth. Pure logic, no state of its own, no DOM.
 *
 * WHY A SEPARATE FILE
 * -------------------
 * Maple is the one Ally nobody can own. She is deliberately absent from
 * server.js's ALLIES list - the draftable Ally ids - so she never enters a
 * match as somebody's choice, and her ability has to work without an owner. That
 * makes her different in kind from Phoenix and Ted, whose apply* functions start
 * by looking for whoever drafted them.
 *
 * It also means her rules were untestable while they lived inside server.js:
 * that file creates an HTTP server on require and refuses to start without
 * PHOENIX_OWNER_PASSWORD, so nothing could assert anything about her. Her rules
 * live here instead, required by the server and by the test suite, exactly the
 * way cards.js and parser.js are shared.
 *
 * WHAT SHE DOES, per js/allies.js
 * -------------------------------
 * "Independent: 40% chance each round to force a random player to use only nice
 * cards for 3 rounds."
 *
 * Independent   - not owned, never drafted, rolls once every round regardless of
 *                  who is playing or what anybody holds.
 * 40% each round - one roll per round, skipped if somebody is already restricted.
 * a random player - not the caster (she has no caster), just anybody in the room.
 * nice cards only - the NOT_NICE list below is off the menu for the whole window.
 * 3 rounds      - the round it fires in, plus the next two.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixMaple = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * The cards Maple takes off the menu, as CARD ids.
   *
   * Aggressive and dishonest, in the same spirit as the sibling PHOENIX build's
   * NOT_NICE list, which is the same six cards under the same ids. Everything not
   * listed stays playable, so a restricted player is never left with nothing: the
   * eight remaining cards (bonus, hunter, judge, reveal, skipall, stealturn,
   * curse, ghost) are always available to them.
   *
   * Legendary Phoenix is included. It ends the match outright and is about as far
   * from nice as a card gets.
   */
  var NOT_NICE = ['zombie', 'knife', 'steal', 'trick', 'alvin', 'phoenix'];

  /** How long Sweet Tooth lasts, counted from the round it fires in. */
  var ROUNDS = 3;

  /** Chance of firing on any given round, as a percentage for crypto.randomInt. */
  var CHANCE_PERCENT = 40;

  /** True if this card may be played while Maple is restricting somebody. */
  function isNice(cardId) {
    return NOT_NICE.indexOf(cardId) === -1;
  }

  /**
   * The last round a restriction started in round `round` still covers.
   *
   * Firing in round 3 restricts rounds 3, 4 and 5, so the answer is round + 2 -
   * the same arithmetic applyTed uses for its fog.
   */
  function untilRound(round) {
    return round + ROUNDS - 1;
  }

  /** True while `seat` is under Sweet Tooth in `room`. */
  function isRestricted(room, seat) {
    if (!room || !room.mapleUntil) return false;
    var until = room.mapleUntil[seat];
    return typeof until === 'number' && until >= room.state.round;
  }

  /** The card ids `seat` may not play right now, in catalogue order. */
  function blocked(room, seat) {
    return isRestricted(room, seat) ? NOT_NICE.slice() : [];
  }

  /**
   * Rolls Sweet Tooth for this round.
   *
   * One victim at a time, matching applyTed: if somebody is still restricted the
   * roll is skipped rather than stacking a second restriction on top. Mutates
   * room.mapleUntil and appends to the room log, and returns the victim's seat or
   * null. Callers pass no rng - it uses crypto, the same source as every other
   * server-side roll.
   */
  function apply(room, Rules, rng, log) {
    var s = room.state;
    if (!s || s.over) return null;

    room.mapleUntil = room.mapleUntil || {};

    var alreadyOn = Object.keys(room.mapleUntil).some(function (seat) {
      return room.mapleUntil[seat] >= s.round;
    });
    if (alreadyOn) return null;

    var roll = rng ? rng() : Math.random();
    if (roll * 100 >= CHANCE_PERCENT) return null;

    var targets = room.members.filter(function (m) {
      return !Rules.isOut(s.players[m.seat], s);
    });
    if (!targets.length) return null;

    // Sample the victim properly. Written as one expression this is easy to get
    // wrong: `Math.floor(rng ? rng() : Math.random() * n)` puts the multiplication
    // inside the else branch ONLY, so a seeded roll of 0.9 floors to 0 and always
    // picks the first target. Roll first, scale afterwards.
    var pick = rng ? rng() : Math.random();
    var at = Math.floor(pick * targets.length) % targets.length;
    var victim = targets[at];

    room.mapleUntil = {};
    room.mapleUntil[victim.seat] = untilRound(s.round);

    // The log is written by the CALLER's addLog, not by calling a method on the room.
  // server.js's room is a plain object - {code, members, state, phase, log} - with
  // no addLog of its own; the module-level addLog(room, text) function is how that
  // server writes to it. Calling room.addLog here would throw a TypeError the first
  // time Sweet Tooth fired, in the middle of a live match, taking the round-boundary
  // handler down with it.
  if (typeof log === 'function') {
    log(
      room,
      '🍁 Maple used Sweet Tooth on ' + victim.name +
      '! They may only play nice cards for ' + ROUNDS + ' rounds.'
    );
  }

    return victim.seat;
  }

  return {
    NOT_NICE: NOT_NICE,
    ROUNDS: ROUNDS,
    CHANCE_PERCENT: CHANCE_PERCENT,
    isNice: isNice,
    untilRound: untilRound,
    isRestricted: isRestricted,
    blocked: blocked,
    apply: apply
  };
}));