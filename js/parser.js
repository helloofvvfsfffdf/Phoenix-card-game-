/*
 * Phoenix - parser.js
 * ---------------------------------------------------------------------------
 * Turns a reply from an external AI chat into a Phoenix move.
 *
 * Design goals
 *  - Let the AI talk: it may write as much commentary, reasoning or emotion as
 *    it likes before the answer. When the reply contains a clearly marked
 *    "PLAY:" line, ONLY that line is used for the game action, so a card named
 *    in passing ("I was tempted by Zombie...") can never be played by mistake.
 *  - Be forgiving about formatting: case, markdown, bullets, bold, quotes,
 *    smart quotes and trailing punctuation are all stripped.
 *  - Still produce a precise, human readable error when nothing matches.
 *  - Never guess. An unparseable reply is an error the player can retry, never
 *    a fallback move chosen by the program.
 *
 * Pure logic - no DOM, no game state. Usable in the browser and in Node tests.
 */
(function (root, factory) {
  'use strict';
  var deps;
  if (typeof require === 'function') {
    deps = [require('./cards.js'), require('./rules.js')];
  } else {
    deps = [root.PhoenixCards, root.PhoenixRules];
  }
  var api = factory(deps[0], deps[1]);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards, Rules) {
  'use strict';

  /** Shown whenever a reply cannot be turned into a move. */
  var FORMAT_HINT =
    'Reply with two lines, for example:\n' +
    'PLAY: Zombie\n' +
    'TARGET: Gemini\n' +
    'Or, for a card with no target, just one line:\n' +
    'PLAY: Hunter';

  /* ===================================================================== */
  /* Text normalisation                                                   */
  /* ===================================================================== */

  /**
   * Strips markdown noise, quotes, bullets and smart punctuation while
   * PRESERVING line breaks, because the PLAY/TARGET lines are line-based.
   */
  function normalize(raw) {
    var s = raw === null || raw === undefined ? '' : String(raw);

    // Smart quotes and dashes -> plain ASCII.
    s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
    s = s.replace(/[\u201C\u201D]/g, '"');
    s = s.replace(/[\u2013\u2014]/g, '-');
    s = s.replace(/\u00A0/g, ' ');

    // Block code fences.
    s = s.replace(/```[a-zA-Z0-9]*\n?/g, '\n');

    // Leading list markers and heading hashes.
    s = s.replace(/^\s*(?:[-*\u2022\u2023\u25E6]|\d+[.)]|#{1,6})\s+/gm, '');
    s = s.replace(/^\s*>\s?/gm, '');

    // Bold / italic / inline code wrappers.
    s = s.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '');

    // Surrounding quotes on a value.
    s = s.replace(/^[\s"']+|[\s"']+$/gm, function (m) {
      return m.replace(/[^\s]/g, '');
    });

    // Collapse runs of spaces, tidy the edges of each line.
    s = s.replace(/[ \t]+/g, ' ');
    s = s.split('\n').map(function (line) { return line.trim(); }).join('\n');

    return s.trim();
  }

  /* ===================================================================== */
  /* Field extraction                                                     */
  /* ===================================================================== */

  var FIELD_WORDS = ['play', 'card', 'move', 'action'];
  var TARGET_WORDS = ['target', 'aim', 'at', 'choose', 'targeting'];

  function isFieldStart(line, words) {
    var lower = line.toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (lower.indexOf(w + ':') === 0) return w.length + 1;
      // Tolerate "**PLAY:**" leftovers and a leading dash.
      if (lower.replace(/^[-*\s]+/, '').indexOf(w + ':') === 0) return w.length + 1;
    }
    return -1;
  }

  /**
   * Pulls the value of a labelled field out of the text.
   *
   * The LAST occurrence wins, so an AI that changes its mind mid-reply gets its
   * final decision rather than the one it first considered.
   *
   * @returns {string|null} the raw value, or null when the field is absent
   */
  function field(text, words) {
    var lines = text.split('\n');
    var value = null;
    lines.forEach(function (line) {
      var at = isFieldStart(line, words);
      if (at === -1) return;
      value = line.slice(at).trim();
    });
    return value;
  }

  /* ===================================================================== */
  /* Card and player resolution                                           */
  /* ===================================================================== */

  /** Card names as the AI is expected to write them, plus the exact spellings. */
  function cardNames() {
    return Cards.CARDS.map(function (c) { return c.name; });
  }

  /**
   * The player names an AI may write in a TARGET line.
   *
   * Under Trick these are the DISPLAYED names, because that is what the prompt
   * showed and what the AI is answering. Trick swaps identities rather than
   * copying one onto a second seat, so the displayed names stay unique and a
   * reply naming one still has exactly one answer - resolving to whichever real
   * player is currently sitting behind that name.
   */
  function playerNames(state) {
    if (!state) return Rules.SEATS.map(function (s) { return s.name; });
    return state.players.map(function (p) { return Rules.displayName(state, p); });
  }

  /**
   * How to list the players in an error message. The human is called "the human
   * player" rather than "You", for the same reason the prompt does it: these
   * messages are shown to somebody deciding what to paste, not to the AI.
   */
  function targetableNames(state) {
    var seats = state ? state.players : Rules.SEATS;
    return seats.map(function (p) {
      if (p.isHuman) return 'the human player';
      return state ? Rules.displayName(state, p) : p.name;
    });
  }

  /**
   * Matches a written value against the known names, ignoring case, spacing and
   * punctuation. Returns the canonical name, or null.
   */
  function matchName(value, names) {
    if (!value) return null;
    var cleaned = String(value)
      .toLowerCase()
      .replace(/[.,!?;:"'`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return null;

    var hit = null;
    names.forEach(function (name) {
      var key = name.toLowerCase().replace(/\s+/g, ' ').trim();
      if (key === cleaned) hit = name;
      // "+10000 points" vs "+10,000 Points": compare with separators removed.
      if (hit) return;
      var squashed = key.replace(/[,\s]/g, '');
      if (squashed === cleaned.replace(/[,\s]/g, '')) hit = name;
    });
    return hit;
  }

  function matchCard(value) {
    var names = cardNames();
    var direct = matchName(value, names);
    if (direct) return direct;
    // Tolerate a short alias such as "+10k", "steal" or "zombie".
    var card = Cards.resolve(value);
    return card ? card.name : null;
  }

  /**
   * Extra ways to name a player, beyond the names on the board. The prompt
   * deliberately calls the human "the human player" - writing "You" inside a
   * prompt addressed to an AI would be actively misleading - so the alias is
   * accepted here to keep prompt and parser in step.
   */
  var PLAYER_ALIASES = {
    'the human player': 'human',
    'the human': 'human',
    'human player': 'human',
    'me': 'human'
  };

  /**
   * Player name (or alias) -> player id. Falls back to the fixed seat list when
   * no live state is supplied, so the parser can be exercised on its own.
   */
  function matchPlayer(value, state) {
    if (!value) return null;
    var cleaned = String(value)
      .toLowerCase()
      .replace(/[.,!?;:"'`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    var seats = state ? state.players : Rules.SEATS;
    var found = null;

    if (PLAYER_ALIASES[cleaned]) {
      var alias = PLAYER_ALIASES[cleaned];
      seats.forEach(function (p) { if (p.id === alias) found = p.id; });
      if (found) return found;
    }

    var name = matchName(value, playerNames(state));
    if (!name) return null;
    // Match on the DISPLAYED name, so under Trick "TARGET: Gemini" aims at
    // whichever seat is currently reading as Gemini.
    seats.forEach(function (p) {
      var shown = state ? Rules.displayName(state, p) : p.name;
      if (shown === name) found = p.id;
    });
    return found;
  }

  /* ===================================================================== */
  /* Parsing                                                              */
  /* ===================================================================== */

  /**
   * Parses an AI reply into { card, targetId, raw } WITHOUT touching game
   * state. `state` is only used to resolve player names, and may be null.
   *
   * @returns {{ok: true, card: string, targetName: (string|null), raw: string}
   *          | {ok: false, error: string, hint: string}}
   */
  function parseMove(raw, state) {
    var text = normalize(raw);
    if (!text) {
      return { ok: false, error: 'No reply was pasted.', hint: FORMAT_HINT };
    }

    // A reply that is only the prompt echoed back has no decision in it.
    if (looksLikeEchoedPrompt(text)) {
      return {
        ok: false,
        error: 'That looks like the prompt pasted back rather than a decision. ' +
          'The game needs your chosen move.',
        hint: FORMAT_HINT
      };
    }

    var rawCard = field(text, FIELD_WORDS);
    var cardName = rawCard ? matchCard(rawCard) : null;

    if (!rawCard) {
      return {
        ok: false,
        error: 'No PLAY line found. The game needs a line starting with "PLAY:".',
        hint: FORMAT_HINT
      };
    }

    if (!cardName) {
      return {
        ok: false,
        error: '"' + rawCard + '" is not a card in this game.',
        hint: 'Valid cards: ' + cardNames().join(', ') + '.'
      };
    }

    var rawTarget = field(text, TARGET_WORDS);
    var targetId = rawTarget ? matchPlayer(rawTarget, state) : null;

    if (rawTarget && !targetId) {
      return {
        ok: false,
        error: '"' + rawTarget + '" is not a player at this table.',
        hint: 'Valid targets: ' + targetableNames(state).join(', ') + '.'
      };
    }

    return {
      ok: true,
      card: cardName,          // canonical display name, e.g. "Zombie"
      targetId: targetId,      // player id, e.g. "gemini"
      targetName: nameOf(targetId, state),
      raw: rawCard
    };
  }

  /** Player id -> display name, falling back to the fixed seat list. */
  function nameOf(id, state) {
    if (!id) return null;
    var name = null;
    if (state) {
      state.players.forEach(function (p) { if (p.id === id) name = p.name; });
    }
    if (!name) {
      Rules.SEATS.forEach(function (s) { if (s.id === id) name = s.name; });
    }
    return name;
  }

  /** The section headers the prompt uses, used to spot a pasted-back prompt. */
  var PROMPT_HEADERS = [
    'you are playing phoenix as',
    '=== current points ===',
    '=== active effects ===',
    '=== the five cards',
    '=== cards you can play right now ===',
    '=== recent play ===',
    '=== how to answer ==='
  ];

  /**
   * True when the reply is a copy of the prompt rather than a decision.
   *
   * Counting the prompt's own section headers is the reliable signal here. The
   * prompt contains "PLAY:" in its format examples, so simply looking for that
   * word would treat the whole prompt as a valid move; instead, a genuine reply
   * reproduces at most one of these headers, while a paste-back reproduces all
   * of them.
   */
  function looksLikeEchoedPrompt(text) {
    var lower = text.toLowerCase();
    var found = PROMPT_HEADERS.filter(function (h) {
      return lower.indexOf(h) !== -1;
    });
    return found.length >= 3;
  }

  /**
   * Parses AND validates against the live game, resolving the target name to a
   * player id and refusing illegal moves. This is what the relay uses.
   *
   * @returns {{ok: true, cardId: string, targetId: (string|null), card: string,
   *           targetName: (string|null)}
   *          | {ok: false, error: string, hint: string}}
   */
  function parseAndValidate(raw, state, seat) {
    var parsed = parseMove(raw, state);
    if (!parsed.ok) return parsed;

    // `parseMove` returns a canonical display name, so resolve by name here.
    var card = Cards.resolve(parsed.card);
    var targetId = null;

    if (card.needsTarget) {
      if (!parsed.targetName) {
        return {
          ok: false,
          error: card.name + ' needs a target. Add a line reading "TARGET: <player name>".',
          hint: FORMAT_HINT
        };
      }
      // `targetId` is already a player id, resolved by matchPlayer. Validity is
      // checked with isLegalTarget, which is the same rule set the prompt
      // advertises and the target picker enforces.
      var targetId = parsed.targetId;
      var target = null;
      state.players.forEach(function (p) { if (p.id === targetId) target = p; });

      if (!target) {
        return {
          ok: false,
          error: (parsed.targetName || 'That player') + ' is not a player at this table.',
          hint: 'Valid players: ' + playerNames(state).join(', ') + '.'
        };
      }
      if (target.seat === seat) {
        return {
          ok: false,
          error: 'You cannot target yourself.',
          hint: legalTargetHint(state, seat, card)
        };
      }
      if (!Rules.isLegalTarget(state, seat, card, target)) {
        return {
          ok: false,
          error: describeIllegalTarget(state, seat, card, target),
          hint: legalTargetHint(state, seat, card)
        };
      }
    } else if (parsed.targetId) {
      return {
        ok: false,
        error: card.name + ' takes no target, but the reply named '
          + parsed.targetName + '.',
        hint: 'Reply with just "PLAY: ' + card.name + '".'
      };
    }

    return {
      ok: true,
      cardId: card.id,
      targetId: targetId,
      card: card.name,
      targetName: parsed.targetName
    };
  }

  /** A precise reason why a named target is not allowed. */
  function describeIllegalTarget(state, seat, card, target) {
    if (target.seat === seat) return 'You cannot target yourself.';
    if (card.reflected && target.hunter) {
      return target.name + ' has a Hunter effect. A Zombie aimed at them is reflected '
        + 'back at you, so it is not a legal target.';
    }
    if (Rules.isOut(target, state)) {
      return target.name + ' is already eliminated this round, so they are not a legal target.';
    }
    return target.name + ' is not a legal target for ' + card.name + '.';
  }

  function legalTargetHint(state, seat, card) {
    var ids = Rules.legalTargets(state, seat, card.id);
    if (!ids.length) return 'No legal targets for ' + card.name + ' right now.';
    var names = ids.map(function (id) {
      var player = null;
      state.players.forEach(function (p) { if (p.id === id) player = p; });
      return player && player.isHuman ? 'the human player' : player.name;
    });
    return 'Legal targets for ' + card.name + ': ' + names.join(', ') + '.';
  }

  /* ===================================================================== */

  return {
    FORMAT_HINT: FORMAT_HINT,
    normalize: normalize,
    field: field,
    matchCard: matchCard,
    matchPlayer: matchPlayer,
    parseMove: parseMove,
    parseAndValidate: parseAndValidate
  };
});