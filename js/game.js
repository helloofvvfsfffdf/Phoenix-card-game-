/*
 * Phoenix - game.js
 * ---------------------------------------------------------------------------
 * Controller layer: owns the game state and the public log, and provides the
 * two ways a move gets in.
 *
 * The human path is a click: playHuman(cardId, targetId).
 *
 * The AI path is a RELAY, and this is the important part of the design. There
 * is no code anywhere in this project that chooses a card for ChatGPT, Claude,
 * Gemini or Copilot. When it is one of their turns the game stops and waits:
 *
 *   1. promptForCurrent()   - builds a full description of the AI's situation
 *   2. (the human pastes it into a real AI chat and copies the reply back)
 *   3. submitAiMove(text)   - parses, validates, then executes that exact move
 *
 * A rejected reply leaves the turn untouched so another one can be pasted. The
 * move is then executed through Rules.playCard - the identical code path the
 * human's click goes through - so no AI is treated differently.
 *
 * No DOM and no timers here either, so a whole game can be driven headlessly
 * from Node in `playUntilHumanOrOver()`.
 */
(function (root, factory) {
  'use strict';
  var deps;
  if (typeof require === 'function') {
    deps = [
      require('./cards.js'),
      require('./rules.js'),
      require('./parser.js'),
      require('./prompt.js')
    ];
  } else {
    deps = [root.PhoenixCards, root.PhoenixRules, root.PhoenixParser, root.PhoenixPrompt];
  }
  var api = factory(deps[0], deps[1], deps[2], deps[3]);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards, Rules, Parser, Prompt) {
  'use strict';

  function Game(options) {
    this.options = options || {};
    this.state = null;
    this.seed = null;
    this.order = null;
    this.log = [];
    this.lastError = null;
  }

  /* --------------------------------------------------------------------- */
  /* Lifecycle                                                            */
  /* --------------------------------------------------------------------- */

  /** Deals a new game. A random seed is used unless one is supplied. */
  Game.prototype.start = function (options) {
    options = options || this.options || {};
    var seed = options.seed;
    if (seed === undefined || seed === null || seed === '') {
      seed = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
    }
    this.seed = seed >>> 0;
    this.state = Rules.createGame({
      rounds: options.rounds,
      seed: this.seed,
      fixedOrder: !!options.fixedOrder,
      rotateStart: options.rotateStart,
      roundStartSeat: options.roundStartSeat
    });
    this.order = this.state.players.map(function (p) { return p.name; }).join(' -> ');
    this.log = [];
    this.lastError = null;
    this.push('start', 'New game: ' + Rules.SEAT_COUNT + ' players, '
      + this.state.rounds + ' rounds. Turn order: ' + this.order + '. Seed '
      + this.seed + '.');
    return this.state;
  };

  /** The seat the human is playing in this game (it is shuffled per game). */
  Game.prototype.humanSeat = function () {
    if (!this.state) return -1;
    for (var i = 0; i < this.state.players.length; i++) {
      if (this.state.players[i].isHuman) return i;
    }
    return -1;
  };

  Game.prototype.push = function (type, text) {
    this.log.push({
      type: type,
      text: text,
      round: this.state ? this.state.round : 0,
      turn: this.state ? this.state.turnIndex : 0,
      seat: this.state ? this.state.turnInRound : -1
    });
  };

  /** Copies engine events into the log, preserving their order. */
  Game.prototype.record = function (events) {
    if (!events) return;
    for (var i = 0; i < events.length; i++) {
      this.push(events[i].type, events[i].text);
    }
  };

  /* --------------------------------------------------------------------- */
  /* Status                                                               */
  /* --------------------------------------------------------------------- */

  Game.prototype.isHumanTurn = function () {
    if (!this.state || this.state.over) return false;
    return this.state.players[this.state.turnInRound].isHuman;
  };

  Game.prototype.currentSeat = function () {
    return this.state ? this.state.turnInRound : -1;
  };

  /** Everything the UI needs in one read. */
  Game.prototype.status = function () {
    var s = this.state;
    if (!s) return null;
    var seat = s.turnInRound;
    return {
      round: s.round,
      rounds: s.rounds,
      seat: seat,
      player: s.players[seat],
      isHumanTurn: s.players[seat].isHuman,
      awaitingAi: !s.over && !s.players[seat].isHuman,
      over: s.over,
      tied: !!s.tied,
      winner: s.over && s.winnerSeat >= 0 ? s.players[s.winnerSeat] : null,
      standings: Rules.standings(s),
      eliminated: s.players.filter(function (p) { return Rules.isOut(p, s); })
    };
  };

  /* --------------------------------------------------------------------- */
  /* Moves                                                                */
  /* --------------------------------------------------------------------- */

  /** The human's move. Only legal on the human's own turn. */
  Game.prototype.playHuman = function (cardId, targetId) {
    var s = this.state;
    if (!s || s.over) return this.fail('The game is over.');
    var seat = s.turnInRound;
    if (!s.players[seat].isHuman) return this.fail('It is not your turn.');

    // While a forced choice is outstanding the human may not be the one who gets
    // to act. Two cases matter, and only two:
    //   - Alvin is outstanding and the human cast it, so they still owe the burn;
    //   - a Steal a Turn is due on THIS turn and the human is its target, so
    //     somebody else is choosing the card.
    // A Steal a Turn aimed at somebody else is none of the human's business: they
    // keep playing their own turn exactly as normal.
    var pending = Rules.pendingChoiceOptions(s);
    if (pending) {
      if (pending.kind === Rules.PENDING_CHOICE_KINDS.BURN) {
        return this.fail(pending.chooserName +
          ' still has to choose which card Alvin destroys.');
      }
      if (pending.targetId === s.players[seat].id) {
        return this.fail(pending.chooserName +
          ' has to choose which card you play this turn.');
      }
    }

    var card = Cards.byId(cardId);
    if (!card) return this.fail('Unknown card.');

    // A switched-off player is not a legal target. Report it as such rather
    // than letting the generic "not a legal target" message through.
    var target = card.needsTarget ? Rules.playerById(s, targetId) : null;
    if (target && Rules.isDisabled(target)) {
      return this.fail(target.name + ' is switched off and cannot be targeted.');
    }

    // You can only play what you are holding.
    if (!Rules.holdsCard(s, s.players[seat].id, card.id)) {
      // The legendary card is the one thing that can be "not held" because it
      // has already been spent, and that is worth saying plainly rather than
      // letting it read like a missing card from the deck.
      if (card.id === Rules.PHOENIX_CARD_ID && s.players[seat].phoenixUsed) {
        return this.fail('The Phoenix card has already been used. It is gone for good.');
      }
      return this.fail('You are not holding ' + card.name + '.');
    }

    var result = Rules.playCard(s, seat, card.id, targetId);
    if (!result.ok) return this.fail(result.error);

    this.lastError = null;
    this.record(result.events);
    return { ok: true, events: result.events };
  };

  /* --------------------------------------------------------------------- */
  /* The AI relay                                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Is the game stopped and waiting for an external AI's reply?
   *
   * There is deliberately no code path that plays a card for an AI. When it is
   * an AI's turn the state simply sits there until `submitAiMove` is called.
   */
  Game.prototype.isAwaitingAi = function () {
    if (!this.state || this.state.over) return false;
    if (this.state.pendingChoice) return false;
    var player = this.state.players[this.state.turnInRound];
    return !player.isHuman && player.enabled;
  };

  /* --------------------------------------------------------------------- */
  /* Forced choices - Steal a Turn and Alvin                               */
  /* --------------------------------------------------------------------- */

  /**
   * Is the game stopped waiting for somebody to CHOOSE a card, rather than to
   * play a turn of their own?
   *
   * This is a different kind of wait from `isAwaitingAi`. The player on turn is
   * not the one who has to decide: Steal a Turn hands the choice to whoever cast
   * it, and Alvin does the same the moment it is played. So the chooser and the
   * player on turn can be two different people - and either of them can be the
   * human.
   */
  Game.prototype.pendingChoice = function () {
    if (!this.state || this.state.over) return null;
    if (!this.state.pendingChoice) return null;
    return Rules.pendingChoiceOptions(this.state);
  };

  /** True while a forced choice is outstanding. */
  Game.prototype.isAwaitingChoice = function () {
    return !!this.pendingChoice();
  };

  /**
   * Is the forced choice actually answerable yet?
   *
   * An Alvin burn always is - its chooser has not finished their turn. A Steal a
   * Turn only becomes answerable when the table reaches its target, because until
   * then the target has not drawn and the cards they can legally play are still
   * changing. Offering the options early would mean offering the wrong ones.
   */
  Game.prototype.isChoiceDue = function () {
    if (!this.state || !this.state.pendingChoice) return false;
    var pending = this.state.pendingChoice;
    if (pending.kind === Rules.PENDING_CHOICE_KINDS.BURN) return true;
    return this.state.players[this.state.turnInRound].id === pending.targetId;
  };

  /** Is the forced choice waiting on the human to make it? */
  Game.prototype.isHumanChoosing = function () {
    var pending = this.pendingChoice();
    return !!(pending && pending.chooserId === 'human');
  };

  /** Is the forced choice waiting on an external AI to make it? */
  Game.prototype.isAiChoosing = function () {
    var pending = this.pendingChoice();
    return !!(pending && pending.chooserId !== 'human');
  };

  /** The prompt for whichever AI has to make the forced choice. */
  Game.prototype.choicePromptForCurrent = function () {
    var pending = this.pendingChoice();
    if (!pending) return '';
    return Prompt.buildChoicePrompt(this.state, pending, this.log);
  };

  /**
   * Settles a forced choice.
   *
   * Deliberately reuses the same parser and the same "PLAY:/TARGET:" format as a
   * normal AI move, so there is one way to answer the game rather than two. For
   * Steal a Turn the chosen card is played for the player on turn; for Alvin the
   * chosen card is destroyed and the turn moves on.
   *
   * @returns {{ok: boolean, error?: string, hint?: string}}
   */
  Game.prototype.submitForcedChoice = function (text) {
    var pending = this.pendingChoice();
    if (!pending) {
      return { ok: false, error: 'There is no choice waiting.', hint: '' };
    }

    // An Alvin burn picks a card to destroy, not a card to aim, so it is parsed
    // as a card name only. Running it through the full validator would demand a
    // TARGET line for any aimed card in the hand, which is the wrong question.
    var parsed = pending.kind === Rules.PENDING_CHOICE_KINDS.BURN
      ? Parser.parseMove(text, this.state)
      : Parser.parseAndValidate(text, this.state, this.state.turnInRound);

    if (!parsed.ok) {
      this.lastError = parsed.error;
      return { ok: false, error: parsed.error, hint: parsed.hint || '' };
    }

    // parseMove reports the card as its canonical display name; parseAndValidate
    // reports the id. Normalise, because the two entry points differ.
    var chosenId = pending.kind === Rules.PENDING_CHOICE_KINDS.BURN
      ? (Cards.byId(parsed.card) || Cards.resolve(parsed.card) || {}).id
      : parsed.cardId;

    var result = Rules.resolvePendingChoice(this.state, chosenId,
      pending.kind === Rules.PENDING_CHOICE_KINDS.BURN ? null : parsed.targetId);
    if (!result.ok) {
      this.lastError = result.error;
      return { ok: false, error: result.error, hint: hintForChoice(this.state, pending) };
    }

    this.lastError = null;
    this.record(result.events);
    return { ok: true, events: result.events };
  };

  /**
   * The choices on offer, for the human's picker. Same list the AI is shown, so
   * the two can never offer different things.
   */
  Game.prototype.choiceOptions = function () {
    var pending = this.pendingChoice();
    if (!pending) return [];
    return pending.options.map(function (option) {
      return {
        cardId: option.cardId,
        targetId: option.targetId,
        name: Rules.formatCard(option.cardId),
        targetName: option.targetId ?
          Rules.displayName(this.state, Rules.playerById(this.state, option.targetId)) : null
      };
    }, this);
  };

  /** Settles a forced choice the human made by clicking, for the UI. */
  Game.prototype.playForcedChoice = function (cardId, targetId) {
    var pending = this.pendingChoice();
    if (!pending) {
      return { ok: false, error: 'There is no choice waiting.' };
    }
    var result = Rules.resolvePendingChoice(this.state, cardId, targetId);
    if (!result.ok) {
      this.lastError = result.error;
      return { ok: false, error: result.error };
    }
    this.lastError = null;
    this.record(result.events);
    return { ok: true, events: result.events };
  };

  /** "Pick one of these cards." - the error hint for a refused choice. */
  function hintForChoice(state, pending) {
    var names = pending.options.map(function (option) {
      return Rules.formatCard(option.cardId);
    });
    return 'Choose one of: ' + (names.length ? names.join(', ') : 'nothing') + '.';
  }

  /* --------------------------------------------------------------------- */
  /* Switching players on and off                                          */
  /* --------------------------------------------------------------------- */

  /**
   * Turns an AI on or off for the next game, without disturbing the game in
   * progress - the same rule as the AI UNO board, so a mid-game turn is never
   * interrupted.
   *
   * @returns {{ok: boolean, error?: string}}
   */
  Game.prototype.setPlayerEnabled = function (playerId, enabled) {
    return Rules.setPlayerEnabled(playerId, enabled);
  };

  /** The roster plus each player's current switch state, for the UI. */
  Game.prototype.roster = function () {
    return Rules.roster();
  };

  /** Deck and discard counts, for the UI. */
  Game.prototype.deckInfo = function () {
    return {
      draw: this.state ? this.state.deck.length : 0,
      discard: this.state ? this.state.discard.length : 0,
      reshuffles: this.state ? this.state.reshuffles : 0,
      total: Rules.deckSize()
    };
  };

  /**
   * The human's hand as cards, for the hand panel.
   *
   * The legendary card is held on the player rather than in the deck, so it is
   * appended here when it is theirs to spend - otherwise it would be invisible in
   * the one place the player can actually play it from.
   */
  Game.prototype.myHand = function () {
    if (!this.state) return [];
    var seat = this.humanSeat();
    var me = this.state.players[seat];
    var cards = Rules.handOf(this.state, me.id).map(function (cardId) {
      return Cards.byId(cardId);
    }).filter(Boolean);
    if (me.hasPhoenix && !me.phoenixUsed) {
      cards.push(Cards.byId(Rules.PHOENIX_CARD_ID));
    }
    return cards.filter(Boolean);
  };

  /** How many cards a player is holding, for the seat cards. */
  Game.prototype.handCount = function (playerId) {
    return this.state ? Rules.handSize(this.state, playerId) : 0;
  };

  /** True when this player is carrying the legendary card, for the seat cards. */
  Game.prototype.hasPhoenix = function (playerId) {
    if (!this.state) return false;
    var player = Rules.playerById(this.state, playerId);
    return !!(player && player.hasPhoenix && !player.phoenixUsed);
  };

  /**
   * Applies the current switches to the game in progress.
   *
   * The switches themselves are applied to the NEXT game (see
   * setPlayerEnabled), so this only has to deal with the game you are looking
   * at right now:
   *
   *   - switching a player OFF  takes them out of this game immediately
   *   - switching a player ON   brings them back with their current score
   *
   * A player switched off mid-turn is passed over by `advanceTurn`, so a relay
   * panel that was open for them closes itself.
   */
  Game.prototype.applySeating = function () {
    var s = this.state;
    if (!s) return { ok: true };

    var changed = [];
    s.players.forEach(function (player) {
      var wanted = Rules.isPlayerEnabled(player.id);
      if (player.enabled !== wanted) changed.push({ player: player, enabled: wanted });
    });

    if (!changed.length) return { ok: true };

    // A player leaving mid-turn hands the turn straight on.
    var onTurn = s.players[s.turnInRound];
    changed.forEach(function (entry) {
      entry.player.enabled = entry.enabled;
      if (!entry.enabled) {
        // Out of the game, so any pending elimination is meaningless.
        entry.player.outUntilRound = -1;
      }
      this.push('seat',
        entry.player.name + (entry.enabled
          ? ' is now in the game (takes effect this game).'
          : ' is switched off (takes effect this game).'));
    }, this);

    if (onTurn && !onTurn.enabled && !s.over) {
      this.push('seat', onTurn.name + ' was on turn, so the turn passes on.');
      this.record(Rules.advanceTurn(s));
    }

    // If that finished the game, the standings need freezing again.
    if (s.over && !s.standings.length) Rules.finish(s);

    return { ok: true };
  };

  /** The prompt to copy into the AI whose turn it is. */
  Game.prototype.promptForCurrent = function () {
    if (!this.isAwaitingAi()) return '';
    return Prompt.buildPrompt(this.state, this.state.turnInRound, this.log);
  };

  /** Card -> legal targets for the AI whose turn it is, for the UI panel. */
  Game.prototype.legalMovesForCurrent = function () {
    if (!this.isAwaitingAi()) return [];
    return Prompt.legalMovesText(this.state, this.state.turnInRound);
  };

  /**
   * The relay entry point: takes a reply pasted from an external AI, parses it,
   * validates it against the live game, and only then executes it.
   *
   * On any failure the turn does NOT advance and nothing is played, so a bad
   * reply can simply be replaced. There is no fallback move.
   *
   * @returns {{ok: true, card: string, targetName: (string|null), events: Array}
   *          | {ok: false, error: string, hint: string}}
   */
  Game.prototype.submitAiMove = function (text) {
    var s = this.state;
    if (!s || s.over) return this.fail('The game is over.');
    var seat = s.turnInRound;
    var player = s.players[seat];
    if (player.isHuman) return this.fail('It is your turn, not an AI\'s.');

    var parsed = Parser.parseAndValidate(text, s, seat);
    if (!parsed.ok) {
      this.lastError = parsed.error;
      return { ok: false, error: parsed.error, hint: parsed.hint || '' };
    }

    // The parser validates card and target; this is the deck check, because an
    // AI can only play a card it is actually holding.
    if (!Rules.holdsCard(s, player.id, parsed.cardId)) {
      // Already-spent Phoenix is its own message: it is not a card the AI was
      // dealt, it is a card it burned, and the reply is being refused for that.
      if (parsed.cardId === Rules.PHOENIX_CARD_ID && player.phoenixUsed) {
        this.lastError = player.name + ' has already used the Phoenix card.';
        return {
          ok: false,
          error: this.lastError,
          hint: 'Phoenix can only be used once and it is never dealt.'
        };
      }
      var held = Rules.handOf(s, player.id)
        .map(function (id) { return Rules.formatCard(id); });
      this.lastError = player.name + ' does not hold ' + parsed.card + '.';
      return {
        ok: false,
        error: this.lastError,
        hint: player.name + ' is holding: ' + (held.length ? held.join(', ') : 'nothing') + '.'
      };
    }

    var result = Rules.playCard(s, seat, parsed.cardId, parsed.targetId);
    if (!result.ok) {
      this.lastError = result.error;
      return { ok: false, error: result.error, hint: '' };
    }

    this.lastError = null;
    this.push('relay', player.name + ' (external AI) chose ' + parsed.card
      + (parsed.targetName ? ' \u2192 ' + parsed.targetName : '') + '.');
    this.record(result.events);
    return {
      ok: true,
      card: parsed.card,
      cardId: parsed.cardId,
      targetId: parsed.targetId,
      targetName: parsed.targetName,
      events: result.events
    };
  };

  Game.prototype.fail = function (message) {
    this.lastError = message;
    return { ok: false, error: message, hint: '' };
  };

  /* --------------------------------------------------------------------- */
  /* Headless play                                                        */
  /* --------------------------------------------------------------------- */

  /**
   * Drives an entire game headlessly by feeding every AI turn a scripted
   * reply. The tests use this to prove the relay path works end to end; the UI
   * never does, because the replies come from real chats.
   *
   * @param {(prompt: string, state: Object, seat: number) => string} [answerFor]
   *        returns the text an external AI would have replied with. The default
   *        plays the first legal move the prompt actually offers.
   * @param {number} [maxSteps]
   */
  Game.prototype.playUntilHumanOrOver = function (answerFor, maxSteps) {
    var respond = typeof answerFor === 'function' ? answerFor : defaultAnswer;
    var limit = maxSteps || (this.state.rounds * Rules.SEAT_COUNT * 3 + Rules.SEAT_COUNT + 5);
    var steps = 0;
    var failures = [];

    while (!this.state.over && !this.isHumanTurn() && steps < limit) {
      var prompt = this.promptForCurrent();
      var reply = respond(prompt, this.state, this.state.turnInRound);
      var result = this.submitAiMove(reply);
      if (!result.ok) {
        // A bad reply must never advance the turn, so bail rather than spin.
        failures.push({ seat: this.state.turnInRound, error: result.error, reply: reply });
        break;
      }
      steps++;
    }

    return { steps: steps, over: this.state.over, seat: this.currentSeat(), failures: failures };
  };

  /**
   * A stand-in "external AI" for headless play only: it plays the first legal
   * move the prompt actually offers, so it is deck-aware - it can only name
   * cards the player is holding.
   *
   * It exists so the test suite can drive whole games through the real relay
   * code path. It is never used by the game as played, where every AI reply is
   * typed in by the player.
   */
  function defaultAnswer(prompt, state, seat) {
    var moves = Rules.legalMoves(state, seat);
    if (!moves.length) return 'PLAY: ' + Cards.CARDS[0].name;
    var pick = moves[0];
    return 'PLAY: ' + pick.card.name
      + (pick.target ? '\nTARGET: ' + pick.target.name : '');
  }

  return {
    Game: Game,
    create: function (options) {
      var game = new Game(options);
      game.start(options);
      return game;
    }
  };
});