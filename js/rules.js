/*
 * Phoenix - rules.js
 * ---------------------------------------------------------------------------
 * The rule engine: game state, the five cards, eliminations, scoring and the
 * turn order. Pure logic - no DOM, no timers - so the whole game can be driven
 * headlessly from the Node test suite.
 *
 * Round and elimination model
 * ---------------------------
 * Every round each of the five players takes exactly one turn, in seat order.
 * A player is "eliminated for 1 round" by being out for the rest of the
 * current round, plus their next turn if that turn has not happened yet:
 *
 *   - struck before their turn this round  -> they skip the rest of this round
 *                                             and play again next round;
 *   - struck on or after their turn this round -> they skip all of next round
 *                                             and play again the round after.
 *
 * Either way a player always misses exactly one turn, which is what "back
 * after 1 round" has to mean in a five-seat rotation. `outUntilRound` is the
 * last round spent eliminated, so they play again from `outUntilRound + 1`.
 */
(function (root, factory) {
  'use strict';
  var Cards = (typeof require === 'function') ? require('./cards.js') : root.PhoenixCards;
  var api = factory(Cards);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards) {
  'use strict';

  /* --------------------------------------------------------------------- */
  /* The table                                                             */
  /* --------------------------------------------------------------------- */

  /** Fixed seat order. The human always acts first, then the four AIs. */
  var SEATS = [
    { id: 'human', name: 'You', isHuman: true },
    { id: 'chatgpt', name: 'ChatGPT', isHuman: false },
    { id: 'claude', name: 'Claude', isHuman: false },
    { id: 'gemini', name: 'Gemini', isHuman: false },
    { id: 'copilot', name: 'Copilot', isHuman: false }
  ];

  var SEAT_COUNT = SEATS.length;
  var DEFAULT_ROUNDS = 10;
  var MAX_ROUNDS = 100;
  var BONUS_POINTS = 10000;

  /* --------------------------------------------------------------------- */
  /* The deck                                                              */
  /* --------------------------------------------------------------------- */

  /**
   * How many of each card go in the deck. There are still only five card
   * TYPES - this is how many copies of each the table starts with.
   *
   * Tuned so a five-player, 10-round game deals 25 and then draws about 50
   * more, so the discard is reshuffled once or twice and everybody gets to see
   * every card type. Change these numbers to rebalance the game - they are the
   * only thing that decides how aggressive the table is.
   */
  var DECK_COMPOSITION = {
    bonus: 10,      // +10,000 Points - the engine of the game, so the commonest
    knife: 8,       // cheap removal
    hunter: 6,      // permanent protection, so rarer
    zombie: 8,      // removal AND a reset, so plenty
    steal: 8,       // the swing card
    judge: 5,       // a coin-flip with a heavy punish, so middling
    reveal: 5,      // information, no drawback
    skipall: 4,     // strong, but it costs you a card and gives the table another round
    trick: 5,       // denial and confusion rather than points
    stealturn: 4,   // hands control of another turn, so scarce
    curse: 5,       // a delayed punish that may never land
    ghost: 4,       // a round of safety, from a card that does nothing else
    alvin: 3        // the best card in the game, so the rarest by far
    // Phoenix is NOT here. It can never be dealt, drawn or reshuffled - see
    // Cards.deckCards() and the phoenixAwarded flag below.
  };

  /** The legendary card. Never in the deck; earned by winning a whole game. */
  var PHOENIX_CARD_ID = Cards.legendaryId();

  /** Cards dealt to every player before the first turn. */
  var HAND_SIZE = 5;

  function deckSize() {
    return Cards.deckIds().reduce(function (n, id) {
      return n + (DECK_COMPOSITION[id] || 0);
    }, 0);
  }

  /* --------------------------------------------------------------------- */
  /* The legendary card, carried between games                               */
  /* --------------------------------------------------------------------- */

  /**
   * Which player has earned the Phoenix card for their next game.
   *
   * This lives outside any single game on purpose, exactly like the AI
   * switches: winning a game has to mean something that survives it. `null`
   * means nobody is holding it.
   */
  var phoenixHolderId = null;

  function phoenixHolder() {
    return phoenixHolderId;
  }

  /**
   * Gives the Phoenix card to `playerId` for their next game, or takes it away
   * with null. Refuses a second card, so nobody can ever hold two.
   *
   * @returns {{ok: boolean, error?: string}}
   */
  function setPhoenixHolder(playerId) {
    if (playerId === null || playerId === undefined) {
      phoenixHolderId = null;
      return { ok: true };
    }
    if (phoenixHolderId === playerId) return { ok: true };
    if (phoenixHolderId !== null) {
      return {
        ok: false,
        error: 'The Phoenix card is already held by ' + playerName(phoenixHolderId) + '.'
      };
    }
    if (playerId === 'human') {
      phoenixHolderId = 'human';
      return { ok: true };
    }
    if (!Object.prototype.hasOwnProperty.call(enabledById, playerId)) {
      return { ok: false, error: 'Unknown player: ' + playerId };
    }
    phoenixHolderId = playerId;
    return { ok: true };
  }

  function playerName(playerId) {
    var name = null;
    SEATS.forEach(function (seat) {
      if (seat.id === playerId) name = seat.name;
    });
    return name || String(playerId);
  }

  /* --------------------------------------------------------------------- */
  /* Who is playing                                                       */
  /* --------------------------------------------------------------------- */

  /**
   * Whether each AI is currently in play. The Human is always in.
   *
   * These live outside any single game on purpose: the switches persist, so
   * turning Copilot off once keeps it off for the rest of the session. Flip a
   * value here to change the default that `New Game` starts from.
   */
  var enabledById = {
    chatgpt: true,
    claude: true,
    gemini: true,
    copilot: true
  };

  var MIN_AI_SEATS = 1;   // otherwise there is nobody to relay to

  function isPlayerEnabled(playerId) {
    if (playerId === 'human') return true;
    return !!enabledById[playerId];
  }

  /** Every player currently taking part, in roster order. */
  function activePlayers() {
    return SEATS.filter(function (s) { return isPlayerEnabled(s.id); });
  }

  /** How many AIs are in play right now. */
  function activeAiCount() {
    return activePlayers().filter(function (s) { return !s.isHuman; }).length;
  }

  /**
   * Turns a player on or off.
   *
   * Refuses changes that would leave an unplayable table: the Human is always
   * in, and at least MIN_AI_SEATS AI must remain, otherwise there is no AI to
   * copy a prompt into.
   *
   * @returns {{ok: boolean, error?: string}}
   */
  function setPlayerEnabled(playerId, isEnabled) {
    if (playerId === 'human') {
      return { ok: false, error: 'You are always in the game.' };
    }
    if (!Object.prototype.hasOwnProperty.call(enabledById, playerId)) {
      return { ok: false, error: 'Unknown player: ' + playerId };
    }

    var wanted = !!isEnabled;
    if (enabledById[playerId] === wanted) return { ok: true };

    // Check the result before committing, so a refusal leaves the table as it
    // was rather than half-changed.
    if (!wanted && activeAiCount() - 1 < MIN_AI_SEATS) {
      return {
        ok: false,
        error: 'Keep at least one AI player switched on - otherwise there is nobody to copy a prompt into.'
      };
    }

    enabledById[playerId] = wanted;
    return { ok: true };
  }

  /** The seat roster as the UI needs it: every player plus their switch state. */
  function roster() {
    return SEATS.map(function (s) {
      return {
        id: s.id,
        name: s.name,
        isHuman: !!s.isHuman,
        enabled: isPlayerEnabled(s.id)
      };
    });
  }

  /* --------------------------------------------------------------------- */
  /* Seeded random                                                         */
  /* --------------------------------------------------------------------- */

  var DEFAULT_SEED = 20260606;
  var seedState = DEFAULT_SEED >>> 0;

  /** Fixes the seed so a game (and therefore the AI) is reproducible. */
  function setSeed(value) {
    seedState = (typeof value === 'number' && isFinite(value))
      ? ((value >>> 0) || 1)
      : DEFAULT_SEED;
    return seedState;
  }

  /** A card id as its display name, e.g. "zombie" -> "Zombie". */
  function formatCard(cardId) {
    var card = Cards.byId(cardId);
    return card ? card.name : String(cardId);
  }

  /** Fisher-Yates, in place, using the seeded stream so deals replay. */
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = randomInt(i + 1);
      var swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  /** mulberry32 - small, fast and good enough for tie-breaking. */
  function random() {
    seedState = (seedState + 0x6D2B79F5) >>> 0;
    var t = seedState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randomInt(max) {
    return Math.floor(random() * max);
  }

  /**
   * A reproducible 0..1 value for one specific decision, derived from the seed
   * plus what is being decided.
   *
   * The AIs do NOT share the sequential `random()` stream for this, and the
   * reason is worth recording: a single stream is consumed in turn order, so
   * seat 0 always draws the first numbers of the sequence and seat 4 always
   * draws the last, and any unevenness in the stream shows up as an unfair seat
   * advantage. Deriving each decision from (seed, round, turn, seat) makes a
   * player's randomness depend on what they are deciding rather than on how
   * many decisions came before them in the round.
   */
  function decisionRandom(seed, round, turnIndex, seat) {
    var h = (seed >>> 0) ^ 0x9E3779B9;
    h = Math.imul(h ^ (round >>> 0), 0x85EBCA6B);
    h = Math.imul(h ^ (turnIndex >>> 0), 0xC2B2AE35);
    h = Math.imul(h ^ (seat >>> 0), 0x27D4EB2F);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545F491);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  /* --------------------------------------------------------------------- */
  /* Formatting                                                            */
  /* --------------------------------------------------------------------- */

  /** 1234567 -> "1,234,567" */
  function formatPoints(value) {
    var n = Math.round(Number(value) || 0);
    var sign = n < 0 ? '-' : '';
    var digits = String(Math.abs(n));
    var out = '';
    while (digits.length > 3) {
      out = ',' + digits.slice(-3) + out;
      digits = digits.slice(0, -3);
    }
    return sign + digits + out;
  }

  /* --------------------------------------------------------------------- */
  /* State                                                                 */
  /* --------------------------------------------------------------------- */

  function normalizeRounds(value) {
    var n = Math.floor(Number(value));
    if (!isFinite(n) || n < 1) return DEFAULT_ROUNDS;
    if (n > MAX_ROUNDS) return MAX_ROUNDS;
    return n;
  }

  /**
   * A fresh game: five players, zero points, round 1, seat 0 to act.
   * `options.seed` fixes the AI randomness, `options.rounds` sets the length.
   *
   * Everyone is dealt HAND_SIZE cards from a shuffled deck (see
   * DECK_COMPOSITION), and every turn begins by drawing one, so a player plays
   * a card and refills.
   *
   * Seating is shuffled with the same seed, because the player who acts LAST in
   * a round sees the fullest board and can always answer whatever the other four
   * just did. Left in a fixed order that seat would win almost every game, so
   * the starting order changes from game to game. Pass `fixedOrder: true` to
   * keep the listed order instead (the tests use that to address seats by
   * number).
   *
   * A player takes part only while they are "enabled". Disabled players keep
   * their seat but are passed over on every turn and cannot be targeted, so a
   * game against three AIs behaves exactly like a four-player game without the
   * fourth seat having to be removed from the board. The Human is always
   * enabled; see setPlayerEnabled.
   */
  function createGame(options) {
    options = options || {};
    setSeed(options.seed);

    var players = SEATS.map(function (seat, index) {
      return {
        id: seat.id,
        name: seat.name,
        seat: index,
        isHuman: !!seat.isHuman,
        enabled: true,
        points: 0,
        hunter: false,
        outUntilRound: -1,   // -1 = never eliminated
        turnsPlayed: 0,
        turnsSkipped: 0,
        cardsPlayed: [],

        // Reveal Deck: hands this player has been shown, and who showed them.
        revealed: [],
        shownToMe: [],

        // Trick: the identity everybody else SEES for this player until the end
        // of the round. It is presentation only - `id`, `name`, `seat`, points,
        // effects and eliminations are untouched, which is what keeps Judge's
        // evil-card counting and every other rule honest. Null means no disguise.
        alias: null,

        // Ghost: untargetable until the end of the round.
        ghost: false,

        // Curse: card ids in this hand that are cursed, which the player is
        // never told about. Playing one resolves normally and then eliminates.
        cursed: [],

        // The legendary card. It is held here rather than in `hands`, so it
        // never enters the draw/discard cycle, and `phoenixUsed` makes sure it
        // can only be spent once.
        hasPhoenix: false,
        phoenixUsed: false
      };
    });

    // The board's toggles persist between games, so a new game starts from
    // whatever the player currently has switched on.
    players.forEach(function (player) {
      player.enabled = isPlayerEnabled(player.id);
      // A Phoenix won in an earlier game is carried into this one, and is never
      // copied in from a deck.
      player.hasPhoenix = phoenixHolderId === player.id;
      player.phoenixUsed = false;
    });

    if (!options.fixedOrder) {
      for (var i = players.length - 1; i > 0; i--) {
        var j = randomInt(i + 1);
        var swap = players[i];
        players[i] = players[j];
        players[j] = swap;
      }
      players.forEach(function (player, index) { player.seat = index; });
    }

    // Rotating who opens each round matters more than the seating: whoever
    // closes a round has already seen everything the other four did and can
    // always answer it. Rotating the opening seat means every player gets to be
    // last sometimes instead of one player being last every single round.
    //
    // Set `rotateStart: false` to always open on the seat holding the lowest
    // number (turn order then runs seat 0, 1, 2, 3, 4 every round).
    var rotateStart = options.rotateStart !== false;

    // The rotation has to start at a random offset as well as advance. Rounds
    // rotate on their own, but with any fixed starting seat the seat that
    // closes the FINAL round is the same seat every single game, and that seat
    // wins nearly all of them.
    var firstRoundStart = options.roundStartSeat;
    if (firstRoundStart === undefined || firstRoundStart === null) {
      // `fixedOrder` only fixes the seat NUMBERING so tests can address seats.
      // The opening seat is a separate question and is randomised whenever the
      // rotation is on - pass `roundStartSeat: 0` to force the table to open on
      // a particular seat.
      firstRoundStart = rotateStart ? randomInt(SEAT_COUNT) : 0;
    }
    if (firstRoundStart < 0 || firstRoundStart >= SEAT_COUNT) {
      firstRoundStart = 0;
    }

    var state = {
      rounds: normalizeRounds(options.rounds),
      seed: seedState,
      round: 1,
      turnInRound: firstRoundStart,
      seatsPlayed: 0,
      roundStartSeat: firstRoundStart,
      rotateStart: rotateStart,
      turnIndex: 0,
      over: false,
      winnerSeat: -1,
      standings: [],
      players: players,

      // Deck. `deck` is the draw pile (index 0 is the top), `discard` is what
      // has been played, and `hands` holds each player's cards as card ids.
      deck: [],
      discard: [],
      hands: {},
      reshuffles: 0,

      // Seats that owe a one-turn skip from Skip Everyone. Consumed as the
      // table reaches them, so it never depends on turn direction.
      skipRemaining: [],

      // Steal a Turn and Alvin both hand control back to the player who played
      // them, to pick a card. When one is pending the game stops and waits:
      //   { kind: 'move', chooserId, targetId }  - pick which card `targetId`
      //                                            must play on their turn
      //   { kind: 'burn', chooserId, targetId }  - pick which card of
      //                                            `targetId`'s hand to destroy
      // Null when nothing is pending.
      pendingChoice: null,

      // Cards destroyed by Alvin, which are gone from the game for good. They
      // are counted here rather than anywhere else precisely so that card
      // conservation can still be checked: every card is either in the deck, the
      // discard, a hand, or destroyed.
      destroyed: [],

      // True once the legendary card has been played this game.
      phoenixFired: false
    };

    players.forEach(function (player) {
      state.hands[player.id] = [];
    });

    deal(state);

    // A round can open on a seat that is switched off, and there would be
    // nobody to advance the turn past it - nobody can play a card there. So the
    // opening seat moves to the first player actually in play.
    var probe = 0;
    while (!players[state.turnInRound].enabled && probe++ <= SEAT_COUNT) {
      state.seatsPlayed++;
      state.turnInRound = (state.roundStartSeat + state.seatsPlayed) % SEAT_COUNT;
    }

    // The opening player of the game is mid-turn, so they get their opening
    // draw here; everyone else is dealt their card by advanceTurn.
    drawForTurn(state, players[state.turnInRound], []);

    return state;
  }

  function currentPlayer(state) {
    return state.players[state.turnInRound];
  }

  function playerById(state, id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  /** True while this player is out and cannot act. */
  function isOut(player, state) {
    return !!player && player.outUntilRound >= 0 && state.round <= player.outUntilRound;
  }

  /**
   * True when this player is switched off and so is not taking part at all.
   * A disabled player is passed over on every turn and cannot be targeted.
   */
  function isDisabled(player) {
    return !!player && !player.isHuman && !player.enabled;
  }

  /** True for everyone except the player taking the turn. */
  function opponents(state, seat) {
    return state.players.filter(function (p) { return p.seat !== seat; });
  }

  /**
   * True when `player` is in the game and not sitting out, so they could be
   * handed a turn right now.
   */
  function canAct(state, player) {
    return !!player && !isDisabled(player) && !isOut(player, state);
  }

  /**
   * True when `player` has at least one card they could legally play right now.
   *
   * This is asked AFTER the turn's draw, so the hand it looks at is the hand the
   * player will actually have to play from. There is deliberately no allowance
   * for an empty hand here: by the time this runs the draw has happened, so an
   * empty hand genuinely means there is nothing to do.
   */
  function canActWithAnything(state, player) {
    return legalMoves(state, player.seat).length > 0;
  }

  /**
   * Everyone a card may actually be aimed at: the other players who are in play
   * and not currently sitting out.
   */
  function targetable(state, seat) {
    var card = null;
    return opponents(state, seat).filter(function (p) {
      return p.enabled && !(card && card.reflected && p.hunter);
    });
  }

  /** Highest scoring player; ties go to the lowest seat for determinism. */
  function leader(state) {
    var best = null;
    state.players.forEach(function (p) {
      if (!best || p.points > best.points) best = p;
    });
    return best;
  }

  /* --------------------------------------------------------------------- */
  /* Elimination                                                           */
  /* --------------------------------------------------------------------- */

  /**
   * Marks `player` out for a number of their own turns.
   *
   * `outUntilRound` is the last round they spend eliminated:
   *   - struck before their turn this round -> out for the rest of this round
   *     and back in the next;
   *   - struck on or after their turn this round -> out for the rest of this
   *     round plus all of the next, and back the round after that. (This also
   *     covers a reflected Zombie, where the thrower eliminates themselves.)
   *
   * `rounds` defaults to 1, which is what every original card wants: exactly one
   * turn skipped. Judge passes 3 for its banishment, which extends the same
   * window by two more rounds.
   *
   * Re-striking a player who is already out does nothing, so a card can never
   * extend an elimination - and a longer banishment cannot lengthen a longer one
   * that is already running.
   */
  function eliminate(state, player, rounds) {
    var span = Math.max(1, Math.floor(Number(rounds) || 1));
    if (isOut(player, state)) return player.outUntilRound;
    player.outUntilRound = alreadyActedThisRound(state, player)
      ? state.round + span
      : state.round + span - 1;
    return player.outUntilRound;
  }

  /**
   * True when this player's turn in the current round has already gone by.
   * With a rotating opening seat, "has this player played yet" cannot be read
   * off the seat number alone - it depends on where the round started.
   */
  function alreadyActedThisRound(state, player) {
    var start = state.roundStartSeat || 0;
    var played = typeof state.seatsPlayed === 'number' ? state.seatsPlayed : 0;
    // How far into this round's rotation this seat sits. `played` counts the
    // seats that have already been dealt with, and the player on turn counts as
    // having acted - which is why a reflected Zombie (where the thrower
    // eliminates themselves) comes out right.
    var offset = (player.seat - start + SEAT_COUNT) % SEAT_COUNT;
    return offset <= played;
  }

  /** The round a player is playing again in (-1 when they are not out). */
  function returnRound(player) {
    if (!player || player.outUntilRound < 0) return -1;
    return player.outUntilRound + 1;
  }

  /** Clears the elimination badge once the player has come back. */
  function clearIfReturned(state, player) {
    if (player.outUntilRound >= 0 && state.round > player.outUntilRound) {
      player.outUntilRound = -1;
    }
  }

  /**
   * Wears off everything that lasts "the rest of this round": Trick's disguise
   * and Ghost's untargetability.
   *
   * Called at the round boundary, so both end with the round rather than at
   * some arbitrary point during the next one. Neither touches anything else
   * about the player - a disguised player keeps their points and their Hunter,
   * and a Ghost loses no effects when it ends, it only stops being untargetable.
   */
  function clearIfRoundEnded(state, player) {
    clearIfReturned(state, player);
    if (player.alias) {
      player.alias = null;
    }
    if (player.ghost) {
      player.ghost = false;
    }
  }

  /**
   * The name this player is SEEN as: their disguise while Trick is on them,
   * otherwise their real name.
   *
   * This is presentation only. Everything that decides a rule - turn order,
   * targeting, elimination, Judge's evil counts, scoring - works from the real
   * player object and never from this.
   */
  function displayName(state, player) {
    if (!player) return '';
    if (player.alias) return player.alias;
    return player.name;
  }

  /** True while this player is wearing a Trick disguise. */
  function isDisguised(state, player) {
    return !!(player && player.alias);
  }

  /* --------------------------------------------------------------------- */
  /* Legality                                                              */
  /* --------------------------------------------------------------------- */

  /**
   * Card/target validity on its own - ignores whose turn it is. Useful for
   * drawing the target picker and for testing resolutions directly.
   *
   * A card can never be aimed at a player who is switched off or currently
   * eliminated, so `isLegalTarget` is the check that everything else goes
   * through.
   */
  function isPlayable(state, seat, cardId, targetId) {
    var card = Cards.byId(cardId);
    var actor = state.players[seat];
    if (!card || !actor) return false;

    // You can only play a card you are actually holding.
    if (!holdsCard(state, actor.id, cardId)) return false;

    var hasTarget = targetId !== null && targetId !== undefined && targetId !== '';
    if (!card.needsTarget) {
      // A card that needs nobody may not be handed a target.
      return !hasTarget;
    }
    if (!hasTarget) return false;
    var target = playerById(state, targetId);
    if (!target || target.seat === seat) return false;
    return isLegalTarget(state, seat, card, target);
  }

  /** isPlayable plus "it is this player's turn and they are not eliminated". */
  function isLegalAction(state, seat, cardId, targetId) {
    if (state.over) return false;
    if (seat !== state.turnInRound) return false;
    if (isDisabled(state.players[seat])) return false;
    if (isOut(state.players[seat], state)) return false;
    return isPlayable(state, seat, cardId, targetId);
  }

  /**
   * Whether `card` may legally be aimed at `target` by the player in `seat`.
   * This is the full check, and it is what `legalTargets` and the AI relay both
   * use: on top of "not yourself" it excludes players who are already sitting
   * out, excludes a Ghost (untargetable for the rest of the round), and excludes
   * a Hunter for the one card that would reflect - Zombie.
   */
  function isLegalTarget(state, seat, card, target) {
    if (!target || target.seat === seat) return false;
    if (!target.enabled) return false;              // not in play at all
    if (isOut(target, state)) return false;        // sitting out this round
    // Ghost makes a player untargetable by EVERY card, including ones cast
    // after it, which is the whole point of it.
    if (target.ghost) return false;
    if (card.reflected && target.hunter) return false;
    return true;
  }

  /** Every target id a card may legally be pointed at. */
  function legalTargets(state, seat, cardId) {
    var card = Cards.byId(cardId);
    if (!card || !card.needsTarget) return [];
    return opponents(state, seat)
      .filter(function (p) { return isLegalTarget(state, seat, card, p); })
      .map(function (p) { return p.id; });
  }

  /**
   * A warning the UI shows before a move commits. Zombie aimed at a Hunter is
   * still legal - the rule reacts to it - but it turns on the thrower.
   */
  function targetWarning(state, seat, cardId, targetId) {
    var card = Cards.byId(cardId);
    if (!card || !card.needsTarget) return '';
    var target = playerById(state, targetId);
    if (!target || target.seat === seat) return '';
    if (card.reflected && target.hunter) {
      return target.name + ' has a Hunter effect - this Zombie comes back at you '
        + 'and you are eliminated for 1 round.';
    }
    if (isOut(target, state)) {
      return target.name + ' is already eliminated this round - this card does nothing useful.';
    }
    return '';
  }

  /* --------------------------------------------------------------------- */
  /* Card resolutions                                                      */
  /* --------------------------------------------------------------------- */

  function pointsLine(player) {
    return formatPoints(player.points) + ' pts';
  }

  /** "You" -> "Your", "ChatGPT" -> "ChatGPT's". */
  function possessive(player) {
    return player.isHuman ? 'Your' : player.name + "'s";
  }

  function eliminatedLine(target) {
    return target.name + ' is eliminated for 1 round and returns in round '
      + returnRound(target) + '.';
  }

  function resolveBonus(state, actor) {
    actor.points += BONUS_POINTS;
    return actor.name + ' played +10,000 Points and gains ' + formatPoints(BONUS_POINTS)
      + '. Now on ' + pointsLine(actor) + '.';
  }

  function resolveKnife(state, actor, target) {
    eliminate(state, target);
    return 'Knife - ' + eliminatedLine(target) + ' ' + pointsLine(target) + ' untouched.';
  }

  function resolveHunter(state, actor) {
    if (actor.hunter) {
      return actor.name + ' already holds a Hunter effect - nothing changes.';
    }
    actor.hunter = true;
    return actor.name + ' gains a Hunter effect. A Zombie thrown at them now '
      + 'eliminates the thrower instead.';
  }

  function resolveZombie(state, actor, target) {
    if (target.hunter) {
      // The one extra rule the Hunter card grants - nothing else changes.
      eliminate(state, actor);
      return 'Zombie reflected! ' + possessive(target) + ' Hunter effect sends it back: '
        + actor.name + ' is eliminated for 1 round and returns in round '
        + returnRound(actor) + '. ' + target.name + ' keeps ' + pointsLine(target) + '.';
    }
    var before = target.points;
    eliminate(state, target);
    target.points = 0;
    return 'Zombie - ' + target.name + ' is eliminated for 1 round, their '
      + formatPoints(before) + ' points reset to 0, and they return in round '
      + returnRound(target) + '.';
  }

  function resolveSteal(state, actor, target) {
    var amount = target.points;
    target.points = 0;
    actor.points += amount;
    return actor.name + ' steals all of ' + target.name + "'s points ("
      + formatPoints(amount) + '). ' + actor.name + ' is now on ' + pointsLine(actor) + '.';
  }

  /**
   * Judge: a coin flip, and on a success the most evil player is banished for
   * three rounds.
   *
   * The flip uses the same seeded stream as the deal, so a game replays
   * identically.
   */
  function resolveJudge(state, actor) {
    var roll = random();
    var pct = Math.round(roll * 100) + '%';
    if (roll >= 0.5) {
      return 'Judge is inert - it failed to activate (' + pct + ' roll).';
    }
    var worst = mostEvil(state);
    if (!worst.player || worst.count === 0) {
      return 'Judge activates (' + pct + ' roll), but nobody has played an evil ' +
        'card yet, so nobody is banished.';
    }
    var tieNote = worst.tied.length > 1
      ? ' (' + worst.tied.map(function (p) { return p.name; }).join(' and ') +
        ' tied on ' + worst.count + ' - lowest seat wins, as ties break everywhere else)'
      : '';
    eliminate(state, worst.player, 3);
    return 'Judge activates (' + pct + ' roll). ' + worst.player.name +
      ' leads on evil cards with ' + worst.count + tieNote +
      ', and is banished for 3 rounds - back in round ' + returnRound(worst.player) + '.';
  }

  /**
   * Reveal Deck: shows the target's hand to the player who played it. Purely
   * information - nothing is removed, and the hand is only marked as known to
   * that one player.
   */
  function resolveReveal(state, actor, target) {
    // Idempotent, so revealing twice is not a duplicate entry.
    if (actor.shownToMe.indexOf(target.id) === -1) actor.shownToMe.push(target.id);
    if (target.revealed.indexOf(actor.id) === -1) target.revealed.push(actor.id);

    var hand = handOf(state, target.id);
    var names = hand.map(function (id) { return formatCard(id); });
    return 'Reveal Deck - ' + actor.name + ' sees ' + target.name + "'s hand (" +
      (names.length ? names.join(', ') : 'empty') + '). Nothing is removed or changed.';
  }

  /**
   * Skip Everyone: everyone else loses this turn and the player keeps theirs.
   *
   * The skip is recorded on `state.skipRemaining` rather than by reordering
   * seats, so it cannot depend on which direction the table is going - and the
   * actor keeps the turn because playCard checks `keepTurn`.
   */
  function resolveSkipAll(state, actor) {
    var victims = opponents(state, actor.seat).filter(function (p) { return p.enabled; });
    state.skipRemaining = victims.map(function (p) { return p.seat; });
    return 'Skip Everyone - ' + victims.map(function (p) { return p.name; }).join(', ') +
      ' lose this turn, and ' + actor.name + ' plays again immediately.';
  }

  /* --------------------------------------------------------------------- */
  /* Trick - the presented identity                                       */
  /* --------------------------------------------------------------------- */

  /**
   * The disguises Trick can hand out.
   *
   * These are deliberately NOT player names. With five players and five names all
   * on the table at once, showing somebody as a name that somebody else is
   * already using would put two seats on the same identity, and a reply of
   * "TARGET: Gemini" would have no single answer. Aliases keep every name on the
   * table unique to exactly one seat, which is what lets the relay keep naming
   * targets by name.
   */
  var TRICK_ALIASES = [
    'the Smuggler',
    'the Courier',
    'the Gambler',
    'the Stray',
    'the Newcomer'
  ];

  /**
   * Trick: for the rest of this round the table reads the target as somebody
   * else entirely.
   *
   * Only `player.alias` changes. The real player keeps their id, name, seat,
   * points, Hunter, eliminations and card history, so Judge's evil counting, turn
   * order, targeting and scoring are all unaffected - the table simply reads the
   * wrong name. `clearIfRoundEnded` takes it off at the round boundary.
   */
  function resolveTrick(state, actor, target) {
    // Never two seats showing the same disguise, so a name stays unambiguous.
    var taken = state.players.filter(function (p) { return p.alias; })
      .map(function (p) { return p.alias; });
    var free = TRICK_ALIASES.filter(function (alias) {
      return taken.indexOf(alias) === -1;
    });
    var chosen = free.length ? free[randomInt(free.length)] : TRICK_ALIASES[0];

    target.alias = chosen;
    return 'Trick - until the end of this round everybody at the table reads '
      + target.name + ' as ' + chosen + '. They are still really ' + target.name +
      ': their score, effects, cards and eliminations are all unchanged, every ' +
      + 'rule and Judge still work on the real player, and their real name comes ' +
      'back at the end of the round.';
  }

  /* --------------------------------------------------------------------- */
  /* Curse - a hidden mark on one card                                   */
  /* --------------------------------------------------------------------- */

  /**
   * Curse: marks one random card in the target's hand.
   *
   * The card is chosen here and stored on `target.cursed`. Nothing anywhere
   * reports which card it is - not the prompt, not the log, not the UI - because
   * the whole point is that the target does not know. The trigger lives in
   * playCard, so the card resolves normally first and the elimination happens
   * afterwards.
   *
   * An empty hand cannot be cursed, which is the only way this card does
   * nothing.
   */
  function resolveCurse(state, actor, target) {
    var hand = handOf(state, target.id);
    if (!hand.length) {
      return 'Curse - ' + target.name + ' is holding no cards, so there is '
        + 'nothing to curse. Nothing happens.';
    }
    var cardId = hand[randomInt(hand.length)];
    target.cursed.push(cardId);
    // Deliberately does not name the card.
    return 'Curse - one card in ' + target.name + "'s hand is now cursed, and "
      + target.name + ' is not told which. If they play it, it resolves normally '
      + 'and then they are eliminated for 1 round. If they never play it, nothing '
      + 'happens.';
  }

  /**
   * True when `player` is about to play a cursed card.
   *
   * Exported for the UI and the tests so the rule lives in exactly one place.
   */
  function isCursed(state, player, cardId) {
    return !!(player && player.cursed && player.cursed.indexOf(cardId) !== -1);
  }

  /**
   * Called after a card has fully resolved: if it was cursed, the curse is spent
   * and the player is eliminated for a single round.
   *
   * Order matters and is fixed by the card: the card resolves normally FIRST,
   * and only then does the elimination land. So this runs after the resolver and
   * after the card has gone to the discard.
   *
   * @returns {string|null} the log line, or null when nothing was cursed.
   */
  function triggerCurse(state, player, cardId) {
    var at = player.cursed.indexOf(cardId);
    if (at === -1) return null;
    player.cursed.splice(at, 1);
    eliminate(state, player);
    return 'The curse triggers - ' + formatCard(cardId) + ' resolves as it '
      + 'normally would, and then ' + player.name + ' is eliminated for 1 round. '
      + 'They return in round ' + returnRound(player) + '. The curse is spent.';
  }

  /* --------------------------------------------------------------------- */
  /* Ghost - untargetable for the round                                   */
  /* --------------------------------------------------------------------- */

  /**
   * Ghost: nothing can be aimed at this player until the end of the round.
   *
   * It is purely a block on being a target - it removes nothing, and it does not
   * stop this player from playing their own cards. `isLegalTarget` is where it
   * takes effect, so it applies to every card cast after it, and
   * `clearIfRoundEnded` is where it comes off.
   */
  function resolveGhost(state, actor) {
    actor.ghost = true;
    return 'Ghost - ' + actor.name + ' cannot be targeted by any card for the '
      + 'rest of this round. Nothing else about them changes, and it wears off '
      + 'at the end of the round.';
  }

  /* --------------------------------------------------------------------- */
  /* Steal a Turn and Alvin - handing the choice back                     */
  /* --------------------------------------------------------------------- */

  /** The two kinds of pending choice, and what the chooser is picking from. */
  var PENDING_CHOICE_KINDS = { MOVE: 'move', BURN: 'burn' };

  /**
   * Steal a Turn: the target's next turn is still theirs to take, but the actor
   * chooses the card.
   *
   * Nothing is resolved here beyond recording the intent. The choice happens
   * when the turn actually arrives - see `advanceTurn` - so that the card has to
   * be one they could legally play at that moment, with whatever they have drawn
   * by then.
   */
  function resolveStealTurn(state, actor, target) {
    state.pendingChoice = {
      kind: PENDING_CHOICE_KINDS.MOVE,
      chooserId: actor.id,
      targetId: target.id
    };
    return 'Steal a Turn - on their next turn, ' + target.name + ' still plays, '
      + 'but ' + actor.name + ' chooses which card they play from the cards they '
      + 'are holding at that moment. It must be a card they could legally play. '
      + 'Once that choice is made the effect is used up.';
  }

  /**
   * Alvin: shows the target's hand to the actor, who then destroys ONE card.
   *
   * Two parts, and they are deliberately separate. The reveal happens now, the
   * way Reveal Deck does, so the actor can see what they are choosing between.
   * The destruction is a forced choice, because "the player then chooses ONE
   * card" is a decision, not an automatic effect - and it has to be made from
   * the hand as it stands now.
   */
  function resolveAlvin(state, actor, target) {
    if (actor.shownToMe.indexOf(target.id) === -1) actor.shownToMe.push(target.id);
    if (target.revealed.indexOf(actor.id) === -1) target.revealed.push(actor.id);

    var hand = handOf(state, target.id);
    if (!hand.length) {
      // Nothing to burn, so no forced choice is queued and the card is simply
      // spent. This is the only way Alvin fails.
      return 'Alvin - ' + actor.name + ' sees ' + target.name + "'s hand, and it "
        + 'is empty, so there is nothing to destroy. Only that one card would '
        + 'have been destroyed anyway.';
    }

    state.pendingChoice = {
      kind: PENDING_CHOICE_KINDS.BURN,
      chooserId: actor.id,
      targetId: target.id
    };
    return 'Alvin - ' + actor.name + ' sees ' + target.name + "'s hand ("
      + hand.map(function (id) { return formatCard(id); }).join(', ')
      + ') and now chooses ONE card to destroy forever. Every other card they '
      + 'are holding is untouched.';
  }

  /**
   * Takes one card out of the game for good, for Alvin.
   *
   * This is deliberately NOT the discard path: a discarded card comes back the
   * next time the deck is rebuilt, which would quietly undo Alvin. The card goes
   * to `state.destroyed` and is never seen again, so card conservation has to
   * count that pile too.
   *
   * Any curse on the destroyed card is dropped with it - the card can never be
   * played now, so a curse on it could never trigger either.
   *
   * @returns {string|null} the log line, or null when the card was not there.
   */
  function destroyCard(state, playerId, cardId) {
    var hand = handOf(state, playerId);
    var at = hand.indexOf(cardId);
    if (at === -1) return null;
    hand.splice(at, 1);
    state.destroyed.push(cardId);

    var owner = playerById(state, playerId);
    if (owner) {
      var curseAt = owner.cursed.indexOf(cardId);
      if (curseAt !== -1) owner.cursed.splice(curseAt, 1);
    }
    return formatCard(cardId);
  }

  /**
   * True when this card may currently be destroyed by Alvin: it has to be a
   * card in the named player's hand, and Alvin destroys one card rather than
   * the whole hand.
   */
  function burnableCards(state, playerId) {
    return handOf(state, playerId).slice();
  }

  /**
   * The forced choice that is waiting, with everything a caller needs to offer
   * the chooser their options.
   *
   * For Steal a Turn the options are the target's legal moves. For Alvin they
   * are the cards in the target's hand, because any card can be burned.
   */
  function pendingChoiceOptions(state) {
    var pending = state.pendingChoice;
    if (!pending) return null;

    var target = playerById(state, pending.targetId);
    var chooser = playerById(state, pending.chooserId);
    if (!target || !chooser) return null;

    var options;
    if (pending.kind === PENDING_CHOICE_KINDS.MOVE) {
      options = legalMoves(state, target.seat).map(function (move) {
        return { cardId: move.cardId, targetId: move.targetId };
      });
    } else {
      options = burnableCards(state, target.id).map(function (cardId) {
        return { cardId: cardId, targetId: null };
      });
    }

    return {
      kind: pending.kind,
      chooserId: chooser.id,
      chooserName: chooser.name,
      targetId: target.id,
      targetName: target.name,
      options: options
    };
  }

  /**
   * Phoenix: take every point, eliminate everyone, and wipe one random
   * opponent's hand. The legendary card is spent here - `moveCardToDiscard`
   * has already burned it, so it never reaches the discard pile.
   */
  function resolvePhoenix(state, actor, events) {
    var taken = 0;
    opponents(state, actor.seat).forEach(function (p) {
      if (!p.enabled) return;
      taken += p.points;
      p.points = 0;
    });
    actor.points += taken;
    events.push({
      type: 'phoenix',
      seat: actor.seat,
      text: 'Phoenix ignites. ' + actor.name + ' takes every point on the table (' +
        formatPoints(taken) + '), rising to ' + formatPoints(actor.points) + ' pts.'
    });

    // Banish everyone else for the rest of the game. The current round is enough
    // to matter, and they cannot outlast it, but a three-round banishment reads
    // the same at the table and matches Judge's scale.
    var banished = [];
    opponents(state, actor.seat).forEach(function (p) {
      if (!p.enabled) return;
      eliminate(state, p, 3);
      banished.push(p.name);
    });
    events.push({
      type: 'phoenix',
      seat: actor.seat,
      text: 'Phoenix burns out the table: ' + banished.join(', ') + ' are eliminated.'
    });

    var cleared = clearAndRedrawVictim(state, actor.seat);
    for (var i = 0; i < cleared.events.length; i++) events.push(cleared.events[i]);

    state.phoenixFired = true;
    return 'Phoenix is spent. It cannot be used again.';
  }

  var RESOLVERS = {
    bonus: resolveBonus,
    knife: resolveKnife,
    hunter: resolveHunter,
    zombie: resolveZombie,
    steal: resolveSteal,
    judge: resolveJudge,
    reveal: resolveReveal,
    skipall: resolveSkipAll,
    trick: resolveTrick,
    curse: resolveCurse,
    ghost: resolveGhost,
    stealturn: resolveStealTurn,
    alvin: resolveAlvin
    // phoenix is resolved in playCard, because it needs to add events and set
    // the keep-turn / skip flags.
  };

  /* --------------------------------------------------------------------- */
  /* Playing a card                                                        */
  /* --------------------------------------------------------------------- */

  /**
   * Plays a card for the player whose turn it is, then advances the turn.
   * Returns { ok, error?, events }. `events` are the log lines the UI prints;
   * they carry text so the log can never drift from the engine.
   */
  function playCard(state, seat, cardId, targetId) {
    if (state.over) {
      return { ok: false, error: 'The game is already over.', events: [] };
    }
    if (seat !== state.turnInRound) {
      return { ok: false, error: 'It is not that player\'s turn.', events: [] };
    }
    // While a forced choice is outstanding, this seat may not simply play a card
    // of its own choosing. Two cases:
    //   - an Alvin burn is pending for this seat, so they still owe the burn;
    //   - a Steal a Turn is DUE on this turn and this seat is its target, so
    //     somebody else is choosing the card.
    // A Steal a Turn that is not due yet is none of this seat's business, and
    // they carry on playing normally. `resolvePendingChoice` clears the choice
    // before it calls playCard, so the forced play itself is not blocked.
    if (state.pendingChoice) {
      if (state.pendingChoice.kind === PENDING_CHOICE_KINDS.BURN &&
        state.pendingChoice.chooserId === state.players[seat].id) {
        return {
          ok: false,
          error: state.players[seat].name + ' must finish choosing which card Alvin destroys.',
          events: []
        };
      }
      if (isStealTurnDue(state, state.players[seat])) {
        var chooser = playerById(state, state.pendingChoice.chooserId);
        return {
          ok: false,
          error: (chooser ? chooser.name : 'Somebody') + ' has to choose which card ' +
            state.players[seat].name + ' plays this turn.',
          events: []
        };
      }
    }
    var actor = state.players[seat];
    if (isDisabled(actor)) {
      return { ok: false, error: actor.name + ' is switched off.', events: [] };
    }
    if (isOut(actor, state)) {
      return { ok: false, error: actor.name + ' is eliminated this round.', events: [] };
    }
    var card = Cards.byId(cardId);
    if (!card) {
      return { ok: false, error: 'Unknown card: ' + cardId, events: [] };
    }
    if (!holdsCard(state, actor.id, cardId)) {
      // The legendary card is checked first, because once it has been spent it is
      // genuinely no longer held - and "you do not hold it" would hide the only
      // interesting fact, which is that it is gone for good and not coming back.
      if (cardId === PHOENIX_CARD_ID && actor.phoenixUsed) {
        return {
          ok: false,
          error: actor.name + ' has already used the Phoenix card. It is gone for good.',
          events: []
        };
      }
      return {
        ok: false,
        error: actor.name + ' does not hold ' + card.name + '.',
        events: []
      };
    }
    if (!isPlayable(state, seat, cardId, targetId)) {
      // Ordered so the most useful message wins: a missing target is a different
      // problem from an illegal one.
      var hasTarget = targetId !== null && targetId !== undefined && targetId !== '';
      var message;
      if (!card.needsTarget) {
        message = card.name + ' takes no target.';
      } else if (!hasTarget) {
        message = card.name + ' needs a target player.';
      } else if (playerById(state, targetId) === actor) {
        message = 'You cannot target yourself.';
      } else {
        message = card.name + ' cannot be aimed at that player.';
      }
      return { ok: false, error: message, events: [] };
    }

    // The card leaves the hand before it resolves, so anything that checks the
    // hand during resolution sees the true state.
    moveCardToDiscard(state, actor, card.id);

    var target = card.needsTarget ? playerById(state, targetId) : null;
    var events = [{
      type: 'card',
      cardId: card.id,
      seat: seat,
      targetSeat: target ? target.seat : -1,
      text: actor.name + ' plays ' + card.name + '.'
    }];

    // Cards that keep the turn, or that report extra events, set these.
    var keepTurn = false;

    if (card.id === PHOENIX_CARD_ID) {
      events.push({ type: 'result', cardId: card.id, text: resolvePhoenix(state, actor, events) });
    } else {
      var text = RESOLVERS[card.id](state, actor, target);
      if (card.id === 'skipall') keepTurn = true;
      events.push({ type: 'result', cardId: card.id, text: text });
    }

    actor.turnsPlayed++;
    actor.cardsPlayed.push(card.id);

    // Curse lands AFTER the card has fully resolved, which is the order the card
    // specifies: it resolves normally, and only then is the player eliminated.
    // `card.id` is used rather than the hand contents because the card has
    // already been moved out of the hand.
    var curseLine = triggerCurse(state, actor, card.id);
    if (curseLine) {
      events.push({ type: 'curse', cardId: card.id, seat: seat, text: curseLine });
    }

    // Alvin resolves into a choice the player still has to make, so the turn
    // stops here: no advance, and no extra draw either. Advancing now and
    // settling the choice later would hand the turn on twice - once here and
    // again when the burn is resolved - which skips a seat each time and can
    // leave the table pointed at somebody who is not playing.
    var waitingToBurn = state.pendingChoice &&
      state.pendingChoice.kind === PENDING_CHOICE_KINDS.BURN &&
      state.pendingChoice.chooserId === actor.id;

    if (waitingToBurn) {
      events.push(forcedChoiceEvent(state));
    } else {
      // Both branches push onto a FRESH array. keepTheTurn takes `events`
      // directly, so re-adding its result to `events` would grow the array while
      // iterating it.
      var advanced = [];
      // Keep the turn only if the player can still act with it. Two things can
      // stop that: the card they just played may have been the cursed one, so
      // Curse has now eliminated them; or they may have nothing left they are
      // able to play, since Skip Everyone is usually held alongside cards that
      // all need a target. A turn must never be left resting on somebody who
      // cannot act.
      if (keepTurn && canAct(state, actor) && canActWithAnything(state, actor)) {
        keepTheTurn(state, advanced);
        // The bonus draw can itself strand them: an empty hand that draws an
        // aimed card, with nobody left to aim it at. Check again afterwards and
        // hand the turn on if so.
        if (!canActWithAnything(state, actor)) {
          advanced = advanceTurn(state);
        }
      } else {
        advanced = advanceTurn(state);
      }
      for (var i = 0; i < advanced.length; i++) events.push(advanced[i]);
    }

    if (state.over) {
      events.push({ type: 'over', text: winnerLine(state) });
    }

    return { ok: true, events: events, nextSeat: state.over ? -1 : state.turnInRound };
  }

  /* --------------------------------------------------------------------- */
  /* Forced choices - Steal a Turn and Alvin                               */
  /* --------------------------------------------------------------------- */

  /**
   * True when `player` is the target of a pending Steal a Turn and it is their
   * turn right now.
   *
   * The effect only fires when the turn genuinely arrives. If the target is
   * eliminated or switched off before then, `clearStaleChoice` drops it when the
   * turn passes them, so it cannot wedge the game.
   */
  function isStealTurnDue(state, player) {
    var pending = state.pendingChoice;
    return !!(pending && pending.kind === PENDING_CHOICE_KINDS.MOVE &&
      pending.targetId === player.id);
  }

  /** The log line announcing that a choice is being waited on. */
  function forcedChoiceEvent(state) {
    var info = pendingChoiceOptions(state);
    if (!info) {
      return { type: 'choice', text: 'A choice is pending.' };
    }
    if (info.kind === PENDING_CHOICE_KINDS.MOVE) {
      return {
        type: 'choice',
        seat: state.turnInRound,
        text: info.chooserName + ' must choose which card ' + info.targetName
          + ' plays this turn, from the ' + info.options.length + ' card'
          + (info.options.length === 1 ? '' : 's') + ' they can legally play.'
      };
    }
    return {
      type: 'choice',
      seat: state.turnInRound,
      text: info.chooserName + ' must choose which one of ' + info.targetName
        + "'s " + info.options.length + ' cards to destroy.'
    };
  }

  /**
   * Drops a pending choice that can no longer happen.
   *
   * A Steal a Turn whose target never gets a turn - eliminated, or switched off -
   * would otherwise sit in state forever. Called as the turn passes a seat, so
   * the effect is dropped at the point it would have fired.
   */
  function clearStaleChoice(state, player) {
    var pending = state.pendingChoice;
    if (!pending || pending.kind !== PENDING_CHOICE_KINDS.MOVE) return false;
    if (pending.targetId !== player.id) return false;
    state.pendingChoice = null;
    return true;
  }

  /**
   * Completes a pending forced choice.
   *
   * 'move' plays the chosen card for the target, on their own turn, through the
   * normal path so every rule still applies - the chooser cannot pick something
   * illegal, because the options they were offered came from `legalMoves`.
   *
   * 'burn' destroys the chosen card and hands the turn straight on, since the
   * chooser played Alvin and has now finished with it.
   *
   * @returns {{ok: boolean, error?: string, events: Array}}
   */
  function resolvePendingChoice(state, cardId, targetId) {
    var pending = state.pendingChoice;
    if (!pending) {
      return { ok: false, error: 'There is no choice waiting.', events: [] };
    }
    var info = pendingChoiceOptions(state);
    if (!info) {
      state.pendingChoice = null;
      return { ok: false, error: 'That choice is no longer possible.', events: [] };
    }

    // A Steal a Turn is only settled on the target's own turn. Without this the
    // call would fall through to playCard for whoever happens to be on turn, so
    // a stray early call would play the forced card for the wrong player.
    if (pending.kind === PENDING_CHOICE_KINDS.MOVE) {
      var targetSeat = playerById(state, pending.targetId).seat;
      if (state.turnInRound !== targetSeat) {
        return {
          ok: false,
          error: 'It is not ' + info.targetName + "'s turn yet.",
          events: []
        };
      }
    }

    var allowed = info.options.filter(function (option) {
      return option.cardId === cardId &&
        (option.targetId || null) === (targetId || null);
    });
    if (!allowed.length) {
      return {
        ok: false,
        error: pending.kind === PENDING_CHOICE_KINDS.MOVE
          ? (info.targetName + ' cannot play that right now.')
          : (info.targetName + ' is not holding ' + formatCard(cardId) + '.'),
        events: []
      };
    }

    if (pending.kind === PENDING_CHOICE_KINDS.MOVE) {
      // Consumed before the play, so the play cannot re-enter this branch.
      state.pendingChoice = null;
      var played = playCard(state, state.turnInRound, cardId, targetId);
      if (!played.ok) {
        // Put it back so the chooser is not left with nothing to do.
        state.pendingChoice = pending;
        return played;
      }
      return played;
    }

    // Alvin: destroy exactly one card, then the turn moves on.
    var target = playerById(state, pending.targetId);
    var chooser = playerById(state, pending.chooserId);
    var destroyed = destroyCard(state, pending.targetId, cardId);
    state.pendingChoice = null;

    var events = [{
      type: 'alvin',
      seat: chooser ? chooser.seat : -1,
      targetSeat: target ? target.seat : -1,
      text: 'Alvin - ' + (chooser ? chooser.name : 'Alvin') + ' destroys '
        + formatCard(cardId) + ' from ' + (target ? target.name : 'them')
        + "'s hand. It is gone from the game for good: not in the discard pile, "
        + 'and it can never be drawn again. Everything else they hold is untouched.'
    }];
    if (!destroyed) {
      events[0].text = 'Alvin - ' + formatCard(cardId) + ' was already gone.';
    }

    var advanced = advanceTurn(state);
    for (var i = 0; i < advanced.length; i++) events.push(advanced[i]);
    if (state.over) events.push({ type: 'over', text: winnerLine(state) });

    return { ok: true, events: events, nextSeat: state.over ? -1 : state.turnInRound };
  }

  /* --------------------------------------------------------------------- */
  /* Turn order                                                            */
  /* --------------------------------------------------------------------- */

  /**
   * Hands the turn past the seat on turn and on to the next round if that was
   * the last seat. A round ends when every seat has had its turn, counted
   * rather than detected from the seat number - with a rotating opening seat
   * the seat number never simply reaches five.
   */
  function movePastCurrentSeat(state, events) {
    state.seatsPlayed++;
    state.turnIndex++;

    if (state.seatsPlayed < SEAT_COUNT) {
      state.turnInRound = (state.roundStartSeat + state.seatsPlayed) % SEAT_COUNT;
      return;
    }

    state.round++;
    if (state.round > state.rounds) {
      finish(state);
      return;
    }
    state.seatsPlayed = 0;
    if (state.rotateStart) {
      state.roundStartSeat = (state.roundStartSeat + 1) % SEAT_COUNT;
    }
    state.turnInRound = state.roundStartSeat;

    // Everybody whose elimination ended with the previous round is back in play
    // as of this one, so drop their badge now rather than on their next turn.
    // This is also where the round-scoped Trick disguises and Ghosts come off.
    state.players.forEach(function (player) {
      clearIfRoundEnded(state, player);
    });
    events.push({
      type: 'round',
      round: state.round,
      text: 'Round ' + state.round + ' of ' + state.rounds
    });
  }

  /**
   * Moves to the next player who can actually act, logging round changes and
   * every skipped turn. Returns the events it produced.
   */
  function advanceTurn(state) {
    var events = [];
    var guard = 0;

    state.players.forEach(function (player) {
      clearIfReturned(state, player);
    });

    // Called straight after the player on turn has acted, so give up their slot
    // first and only then work out who plays next.
    movePastCurrentSeat(state, events);

    while (true) {
      if (guard++ > SEAT_COUNT * (MAX_ROUNDS + 2)) break; // unreachable safety net

      var next = state.players[state.turnInRound];

      // A seat caught by Skip Everyone loses this turn and is forgotten. This
      // is a one-turn skip, not an elimination, so it never touches their
      // outUntilRound.
      if (state.skipRemaining && state.skipRemaining.length) {
        var skipIndex = state.skipRemaining.indexOf(next.seat);
        if (skipIndex !== -1) {
          state.skipRemaining.splice(skipIndex, 1);
          next.turnsSkipped++;
          events.push({
            type: 'skip',
            seat: next.seat,
            text: next.name + ' is skipped and loses this turn.'
          });
          movePastCurrentSeat(state, events);
          if (state.over) break;
          continue;
        }
      }

      if (isDisabled(next)) {
        // A switched-off player is not sitting out for a round - they are not
        // in the game, so no skip event and no `turnsSkipped` bump either.
        movePastCurrentSeat(state, events);
        if (state.over) break;
        continue;
      }
      if (isOut(next, state)) {
        next.turnsSkipped++;
        events.push({
          type: 'skip',
          seat: next.seat,
          text: next.name + ' is eliminated and sits out this turn.'
        });
        // A Steal a Turn aimed at somebody who is not playing this turn can never
        // happen, so it is dropped here rather than left to wedge the game.
        if (clearStaleChoice(state, next)) {
          events.push({
            type: 'choice',
            seat: next.seat,
            text: 'Steal a Turn lapses - its target is not taking a turn.'
          });
        }
        movePastCurrentSeat(state, events);
        if (state.over) break;
        continue;
      }

      // This seat can act, so give them their card for the turn. The draw comes
      // FIRST and the "can they play anything" check comes after it, deliberately:
      // an empty hand can be checked before the draw only by guessing what is
      // about to be dealt, and a guess is wrong exactly when it matters - an empty
      // hand that draws an aimed card while everybody else is unavailable is left
      // holding a card they cannot legally play and has no way to pass.
      drawForTurn(state, next, events);

      // Being in the game and not eliminated is not the same as having a legal
      // move: every card they hold may need a target while every other player is
      // eliminated, switched off or a Ghost. There is no pass in this game, so the
      // turn goes on rather than wedging the game. They keep the card they drew -
      // it really was dealt to them at the start of their turn.
      if (!canActWithAnything(state, next)) {
        next.turnsSkipped++;
        events.push({
          type: 'skip',
          seat: next.seat,
          text: next.name + ' has no card they can legally play this turn, so the turn moves on.'
        });
        movePastCurrentSeat(state, events);
        if (state.over) break;
        continue;
      }

      // Steal a Turn bites here, not when it was cast: the turn has arrived and
      // this seat has drawn, so the chooser now picks from what they are actually
      // holding. The turn stops until that choice is made - it is still their
      // turn, and it will be played for them once the chooser decides.
      if (isStealTurnDue(state, next)) {
        events.push(forcedChoiceEvent(state));
        break;
      }
      break;
    }

    return events;
  }

  /**
   * Hands the turn straight back to the player who just acted, for Skip
   * Everyone.
   *
   * The seats that were skipped are recorded in `state.skipRemaining` and
   * consumed by advanceTurn when the table reaches them, so this does not
   * depend on the rotation direction at all - the turn simply stays put and the
   * skips are applied later, wherever those seats happen to fall.
   *
   * The player still draws, because a turn is "draw, then play".
   */
  function keepTheTurn(state, events) {
    var player = state.players[state.turnInRound];

    // `turnIndex` is incremented by movePastCurrentSeat, which this path skips,
    // so there is nothing to undo here - the index counts actions taken, and
    // this player has taken one.
    drawForTurn(state, player, events);
    events.push({
      type: 'turn',
      seat: player.seat,
      text: player.name + ' takes another turn.'
    });
    return events;
  }

  /**
   * Deals the opening card of a turn to `player`.
   *
   * Kept separate from advanceTurn so the very first player of the game also
   * gets one: a turn is always "draw, then play", whoever opens the round.
   */
  function drawForTurn(state, player, events) {
    var before = state.reshuffles;
    var drawn = drawCard(state, player);
    if (!drawn) return;
    var card = Cards.byId(drawn);
    // The human's name is "You", so the verb has to agree with the subject.
    events.push({
      type: 'draw',
      seat: player.seat,
      cardId: drawn,
      text: player.name + (player.isHuman ? ' draw ' : ' draws ') + (card ? card.name : drawn) + '.'
    });
    if (state.reshuffles > before) {
      events.push({
        type: 'reshuffle',
        text: 'The deck ran out - the discard pile is reshuffled into a new deck.'
      });
    }
  }

  /** Ends the game and freezes the standings. */
  function finish(state) {
    state.over = true;
    state.standings = standings(state);
    state.winnerSeat = state.standings.length ? state.standings[0].seat : -1;
    state.tied = state.standings.length > 1 &&
      state.standings[0].points === state.standings[1].points;

    // Winning a whole game awards the legendary card for the next one. A tie is
    // not a win, so nobody gets it. Only one player can hold it, so the award
    // is not made if somebody is already carrying one.
    if (!state.tied && state.winnerSeat >= 0) {
      var winner = state.players[state.winnerSeat];
      var awarded = setPhoenixHolder(winner.id);
      if (awarded.ok) {
        state.phoenixAwarded = winner.id;
      } else {
        state.phoenixAwarded = null;
      }
    } else {
      state.phoenixAwarded = null;
    }
    return state;
  }

  /**
   * Players ordered by score, highest first, seat order breaking ties.
   * Only players actually in play are ranked - a switched-off seat keeps its
   * points on the board but is not in the results, because it played no part.
   */
  function standings(state) {
    return state.players
      .filter(function (p) { return p.enabled; })
      .slice()
      .sort(function (a, b) {
        if (b.points !== a.points) return b.points - a.points;
        return a.seat - b.seat;
      });
  }

  function winnerLine(state) {
    var board = standings(state);
    if (!board.length) return 'Game over.';
    if (state.tied) {
      var tied = board.filter(function (p) { return p.points === board[0].points; });
      return 'Game over after ' + state.rounds + ' rounds - tied on '
        + formatPoints(board[0].points) + ' pts: ' + tied.map(function (p) { return p.name; }).join(', ') + '.';
    }
    return 'Game over after ' + state.rounds + ' rounds - ' + board[0].name
      + ' wins with ' + formatPoints(board[0].points) + ' pts.';
  }

  /* --------------------------------------------------------------------- */
  /* Deck and hands                                                         */
  /* --------------------------------------------------------------------- */

  /**
   * Builds the deck from DECK_COMPOSITION, shuffles it, and deals every
   * player in play HAND_SIZE cards.
   *
   * Switched-off players are not dealt in - they keep their seat on the board
   * but hold no cards and take no turns.
   */
  function deal(state) {
    var deck = [];
    // deckCards() excludes the legendary card, so Phoenix can never be dealt
    // however the counts are edited above.
    Cards.deckCards().forEach(function (card) {
      var count = DECK_COMPOSITION[card.id] || 0;
      for (var i = 0; i < count; i++) deck.push(card.id);
    });
    shuffle(deck);

    state.deck = deck;
    state.discard = [];

    state.players.forEach(function (player) {
      state.hands[player.id] = [];
    });
    state.players.forEach(function (player) {
      if (!player.enabled) return;
      for (var n = 0; n < HAND_SIZE; n++) drawCard(state, player);
    });
    return state;
  }

  /**
   * Deals the top card of the deck to `player`, reshuffling the discard into a
   * fresh deck first if the draw pile has run out.
   *
   * @returns {string|null} the card id dealt, or null if there is nothing to
   *          give (which can only happen if every card is already in hands).
   */
  function drawCard(state, player) {
    if (!state.deck.length) {
      if (!state.discard.length) return null;
      state.deck = shuffle(state.discard);
      state.discard = [];
      state.reshuffles++;
    }
    var cardId = state.deck.shift();
    state.hands[player.id].push(cardId);
    return cardId;
  }

  /** A player's hand as card ids. Never null - an empty array means no cards. */
  function handOf(state, playerId) {
    if (!state.hands[playerId]) state.hands[playerId] = [];
    return state.hands[playerId];
  }

  /** How many cards a player is holding. */
  function handSize(state, playerId) {
    return handOf(state, playerId).length;
  }

  /**
   * True when the player actually holds this card.
   *
   * The legendary card is held on the player rather than in `hands`, so it is
   * checked here too - that way every caller (engine, prompt, parser, UI) gets
   * the same answer without knowing about the split.
   */
  function holdsCard(state, playerId, cardId) {
    if (cardId === PHOENIX_CARD_ID) {
      var holder = null;
      state.players.forEach(function (p) { if (p.id === playerId) holder = p; });
      return !!(holder && holder.hasPhoenix && !holder.phoenixUsed);
    }
    return handOf(state, playerId).indexOf(cardId) !== -1;
  }

  /**
   * Every legal move for a player right now, as an array of
   * {cardId, targetId} pairs - one per card in hand, and one per legal target
   * for the cards that need one.
   *
   * This is the shared definition of "what could be played": the human's target
   * picker, the AI prompt and the AI relay all read it, so they cannot disagree.
   */
  function legalMoves(state, seat) {
    var me = state.players[seat];
    var moves = [];
    handOf(state, me.id).forEach(function (cardId) {
      movesForCard(state, seat, cardId, moves);
    });
    // The legendary card is held on the player rather than in the deck, so it is
    // offered here too - otherwise the one player entitled to play it could
    // never legally choose it.
    if (me.hasPhoenix && !me.phoenixUsed) {
      movesForCard(state, seat, PHOENIX_CARD_ID, moves);
    }
    return moves;
  }

  /** Appends every legal way to play `cardId` for this seat onto `moves`. */
  function movesForCard(state, seat, cardId, moves) {
    var card = Cards.byId(cardId);
    if (!card) return;
    if (!card.needsTarget) {
      if (isPlayable(state, seat, cardId, null)) {
        moves.push({ cardId: cardId, targetId: null, card: card, target: null });
      }
      return;
    }
    legalTargets(state, seat, cardId).forEach(function (targetId) {
      moves.push({
        cardId: cardId,
        targetId: targetId,
        card: card,
        target: playerById(state, targetId)
      });
    });
  }

  /**
   * Takes a card out of the actor's possession and puts it on the discard pile.
   * The caller is responsible for having checked legality already.
   *
   * The legendary card is the exception: it is spent, not discarded, so it never
   * reaches the discard pile and can never be reshuffled back into play.
   */
  function moveCardToDiscard(state, player, cardId) {
    if (cardId === PHOENIX_CARD_ID) {
      player.hasPhoenix = false;
      player.phoenixUsed = true;
      // Spending it consumes it for good. The holder lives outside the game so
      // that a win survives into the next one, and it has to be handed back here
      // or the next game would deal the card to the same player all over again.
      if (phoenixHolderId === player.id) phoenixHolderId = null;
      return;
    }
    var hand = handOf(state, player.id);
    var index = hand.indexOf(cardId);
    if (index !== -1) hand.splice(index, 1);
    state.discard.push(cardId);
  }

  /* --------------------------------------------------------------------- */
  /* The legendary card                                                     */
  /* --------------------------------------------------------------------- */

  /**
   * The opponents a Phoenix may be aimed at: everyone else who is actually in
   * play. Exported so the UI can show the hand it is about to destroy.
   */
  function phoenixVictims(state, seat) {
    return opponents(state, seat).filter(function (p) { return p.enabled; });
  }

  /**
   * Empties one random opponent's hand and makes them draw the same number of
   * cards, using the game's existing draw path - so a reshuffle mid-clear
   * behaves exactly like a normal turn.
   *
   * @returns {{events: Array, victim: (Object|null)}}
   */
  function clearAndRedrawVictim(state, seat) {
    var events = [];
    var pool = phoenixVictims(state, seat);
    if (!pool.length) return { events: events, victim: null };

    var victim = pool[randomInt(pool.length)];
    var lost = handOf(state, victim.id).slice();
    state.hands[victim.id] = [];

    events.push({
      type: 'phoenix',
      seat: seat,
      victimSeat: victim.seat,
      text: 'Phoenix burns through ' + victim.name + "'s hand - " +
        (lost.length ? lost.length + ' card' + (lost.length === 1 ? '' : 's') + ' lost'
          : 'they had no cards') + '.'
    });

    // Draw the same number back through the normal path.
    var redrawn = 0;
    for (var i = 0; i < lost.length; i++) {
      var before = state.reshuffles;
      var drawn = drawCard(state, victim);
      if (state.reshuffles > before) {
        events.push({
          type: 'reshuffle',
          text: 'The deck ran out - the discard pile is reshuffled into a new deck.'
        });
      }
      if (!drawn) break;
      redrawn++;
    }

    // The cards that were burned through go to the discard, ALWAYS.
    //
    // Phoenix clears a hand, it does not destroy cards - only Alvin does that -
    // so these have to rejoin the pool. Dropping them instead quietly deleted
    // them from the game, which is invisible in play but breaks card
    // conservation: every wiped card has to be accounted for somewhere.
    for (var j = 0; j < lost.length; j++) {
      state.discard.push(lost[j]);
    }

    if (redrawn < lost.length) {
      events.push({
        type: 'phoenix',
        seat: seat,
        victimSeat: victim.seat,
        text: 'The deck could only replace ' + redrawn + ' of those ' + lost.length
          + ' cards. The rest went to the discard pile, where they can be drawn again.'
      });
    }

    if (lost.length) {
      events.push({
        type: 'draw',
        seat: victim.seat,
        text: victim.name + ' draws ' + redrawn + ' replacement card'
          + (redrawn === 1 ? '' : 's') + '.'
      });
    }
    return { events: events, victim: victim };
  }

  /* --------------------------------------------------------------------- */
  /* Judge - the most evil player                                          */
  /* --------------------------------------------------------------------- */

  /**
   * How many evil cards each player has played this game. Zombie, Knife and
   * Steal Points count; Judge and everything else does not.
   */
  function evilCounts(state) {
    var counts = {};
    state.players.forEach(function (p) {
      var n = 0;
      p.cardsPlayed.forEach(function (id) {
        if (Cards.isEvil(id)) n++;
      });
      counts[p.id] = n;
    });
    return counts;
  }

  /**
   * The player Judge banishes: the highest evil-card count.
   *
   * Ties are broken exactly the way every other tie in this game is broken -
   * `standings` sorts by score and then by seat number, lowest seat first - so
   * Judge picks the lowest-numbered seat among those tied on the top count. No
   * new mechanic is invented for it.
   *
   * @returns {{player: (Object|null), count: number, tied: Array<Object>}}
   */
  function mostEvil(state) {
    var counts = evilCounts(state);
    var best = 0;
    var tied = [];
    // Seat order, so the first seat with the top count wins - matching the
    // standings tie-break.
    for (var seat = 0; seat < SEAT_COUNT; seat++) {
      var player = state.players[seat];
      if (!player.enabled) continue;
      var n = counts[player.id];
      if (n > best) {
        best = n;
        tied = [player];
      } else if (n === best && best > 0) {
        tied.push(player);
      }
    }
    return { player: tied.length ? tied[0] : null, count: best, tied: tied };
  }

  /* --------------------------------------------------------------------- */

  return {
    SEATS: SEATS,
    SEAT_COUNT: SEAT_COUNT,
    DEFAULT_ROUNDS: DEFAULT_ROUNDS,
    MAX_ROUNDS: MAX_ROUNDS,
    BONUS_POINTS: BONUS_POINTS,
    DECK_COMPOSITION: DECK_COMPOSITION,
    HAND_SIZE: HAND_SIZE,

    createGame: createGame,
    deal: deal,
    drawCard: drawCard,
    handOf: handOf,
    handSize: handSize,
    holdsCard: holdsCard,
    legalMoves: legalMoves,
    deckSize: deckSize,
    formatCard: formatCard,
    currentPlayer: currentPlayer,
    playerById: playerById,
    opponents: opponents,
    targetable: targetable,
    leader: leader,
    isOut: isOut,
    isDisabled: isDisabled,
    eliminate: eliminate,
    returnRound: returnRound,

    setPlayerEnabled: setPlayerEnabled,
    isPlayerEnabled: isPlayerEnabled,
    activePlayers: activePlayers,
    activeAiCount: activeAiCount,
    roster: roster,
    MIN_AI_SEATS: MIN_AI_SEATS,

    // The legendary card
    PHOENIX_CARD_ID: PHOENIX_CARD_ID,
    phoenixHolder: phoenixHolder,
    setPhoenixHolder: setPhoenixHolder,
    phoenixVictims: phoenixVictims,
    clearAndRedrawVictim: clearAndRedrawVictim,

    // Judge
    evilCounts: evilCounts,
    mostEvil: mostEvil,

    // Trick, Curse, Ghost
    displayName: displayName,
    isDisguised: isDisguised,
    isCursed: isCursed,
    triggerCurse: triggerCurse,

    // Steal a Turn and Alvin
    PENDING_CHOICE_KINDS: PENDING_CHOICE_KINDS,
    pendingChoiceOptions: pendingChoiceOptions,
    resolvePendingChoice: resolvePendingChoice,
    isStealTurnDue: isStealTurnDue,
    clearStaleChoice: clearStaleChoice,
    destroyCard: destroyCard,
    burnableCards: burnableCards,

    isPlayable: isPlayable,
    canActWithAnything: canActWithAnything,
    isLegalAction: isLegalAction,
    isLegalTarget: isLegalTarget,
    legalTargets: legalTargets,
    targetWarning: targetWarning,
    playCard: playCard,
    advanceTurn: advanceTurn,
    finish: finish,
    standings: standings,
    winnerLine: winnerLine,
    formatPoints: formatPoints,

    setSeed: setSeed,
    random: random,
    randomInt: randomInt,
    decisionRandom: decisionRandom
  };
});