/*
 * Phoenix - prompt.js
 * ---------------------------------------------------------------------------
 * Builds the prompt for the external AI whose turn it is.
 *
 * There is no secret information in this game - everyone can see everyone's
 * points - so the prompt is the whole table, not a private hand. What it does
 * guarantee is that the AI is told exactly what it may legally do, and exactly
 * how to answer, so a reply can be parsed without guessing.
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
  if (root) root.PhoenixPrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards, Rules) {
  'use strict';

  /** How many recent log entries to include as context. */
  var HISTORY_LIMIT = 12;

  function points(player) {
    return Rules.formatPoints(player.points) + ' pts';
  }

  /* --------------------------------------------------------------------- */
  /* Sections                                                              */
  /* --------------------------------------------------------------------- */

  function headerSection(state, me) {
    return [
      'You are playing PHOENIX as ' + me.name + '.',
      '',
      'PHOENIX is a five-player card game. The five players are: '
        + seatList(state, me) + '.',
      'Each round every player takes one turn in order and plays exactly one card.',
      'After ' + state.rounds + ' rounds the game ends and the highest score wins.',
      'You play exactly one card per turn.',
      '',
      'Round ' + state.round + ' of ' + state.rounds + '. It is your turn.'
    ].concat(trickNotice(state, me));
  }

  /**
   * Says plainly that one name on the table is a DISGUISE, because Trick is in
   * play.
   *
   * Without this an AI would be quietly reading the prompt as ground truth and
   * the card would only work on the human. The disguise itself is left in place -
   * that is the deception - but the rules are never lied about: the real player,
   * their score and their effects all follow the real seat.
   */
  function trickNotice(state, me) {
    var disguised = state.players.filter(function (p) { return Rules.isDisguised(state, p); });
    if (!disguised.length) return [];
    return [
      '',
      'TRICK IS IN PLAY: ' + disguised.map(function (p) {
        return 'the seat reading as ' + Rules.displayName(state, p) +
          ' is really ' + p.name;
      }).join('; ') + '.',
      'Aim at the name you can see - that is the seat the card goes to - but the ' +
      'rules, their score and their effects all follow the real player behind ' +
      'the disguise.'
    ];
  }

  /** "you (ChatGPT), Gemini, Copilot, Claude and the human player" */
  function seatList(state, me) {
    return state.players.map(function (p) {
      return p.id === me.id ? 'you (' + p.name + ')' : labelFor(state, p, me);
    }).join(', ');
  }

  function scoresSection(state, me) {
    var lines = ['', '=== CURRENT POINTS ==='];
    state.players.forEach(function (p) {
      lines.push(labelFor(state, p, me) + ': ' + points(p));
    });
    // Spell out the one name that differs from what a player is called on the
    // board, so "TARGET:" can never be ambiguous about who is meant.
    lines.push('');
    lines.push('(the human player is the person using this page; you, ' +
      me.name + ', are an external AI.)');
    return lines;
  }

  /**
   * How a player is named in the prompt.
   *
   * The human seat's display name is "You", which would be nonsense or actively
   * misleading inside a prompt written to somebody else - so from an AI's point of
   * view the human is always "the human player".
   *
   * Trick disguises a player under an alias, so this is the name the table reads,
   * not the real one: an AI has to be fooled by it too. Aliases are never player
   * names, so every name on the table still belongs to exactly one seat and a
   * reply naming one still has exactly one answer.
   */
  function labelFor(state, player, me) {
    if (player.id === me.id) return 'You';
    if (player.isHuman) return 'the human player';
    return Rules.displayName(state, player);
  }

  /** The active effects, written from the point of view of the AI being asked. */
  function effectsSection(state, me) {
    var lines = ['', '=== ACTIVE EFFECTS ==='];
    var any = false;

    state.players.forEach(function (p) {
      var isMe = p.id === me.id;
      var subject = labelFor(state, p, me);
      var them = isMe ? 'you' : (p.isHuman ? 'the human player' : 'them');

      if (p.hunter) {
        any = true;
        lines.push(
          subject + ' ' + (isMe ? 'have' : 'has') + ' a HUNTER effect: a Zombie aimed ' +
          'at ' + them + ' is reflected back at whoever threw it, and that thrower ' +
          'is eliminated instead. Knife and Steal Points still work normally on a Hunter.'
        );
      }
      if (p.ghost) {
        any = true;
        lines.push(
          subject + ' ' + (isMe ? 'are' : 'is') + ' a GHOST this round: no card can ' +
          'be aimed at ' + them + ' until the end of the round. ' +
          (isMe ? 'You' : 'They') + ' can still play normally, and every other ' +
          'player can still be targeted.'
        );
      }
      if (Rules.isOut(p, state)) {
        any = true;
        lines.push(
          subject + ' ' + (isMe ? 'are' : 'is') + ' ELIMINATED this round and ' +
          (isMe ? 'you skip your' : 'they skip their') + ' turn, returning in round ' +
          Rules.returnRound(p) + '. An eliminated player still keeps their points.'
        );
      }
    });

    if (!any) lines.push('None.');
    return lines;
  }

  /**
   * The rules of every card in the deck, stated in full. The prompt always
   * describes every card, even ones the AI cannot currently play, so it knows
   * the game rather than just the current situation.
   *
   * The deck cards come first. The legendary card is listed separately and last,
   * because it is never dealt and can only be in one player's hand.
   */
  function cardRulesSection() {
    var deck = Cards.deckCards();
    var lines = ['', '=== THE ' + deck.length + ' CARDS IN THE DECK (exact rules) ==='];
    deck.forEach(function (card, i) {
      lines.push((i + 1) + '. ' + card.name);
      lines.push('   Rule: ' + card.rule);
      lines.push('   Target: ' + card.targetNote);
    });

    Cards.CARDS.filter(function (card) { return card.legendary; }).forEach(function (card) {
      lines.push('');
      lines.push('=== THE LEGENDARY CARD (never dealt, never drawn) ===');
      lines.push(card.name);
      lines.push('   Rule: ' + card.rule);
      lines.push('   Target: ' + card.targetNote);
      lines.push('   This card cannot come out of the draw deck. It only ever appears');
      lines.push('   in a hand if the previous game was won outright by that player.');
    });

    lines.push('');
    lines.push('Important: you can never target yourself with any card.');
    lines.push('A GHOST cannot be targeted by any card this round.');
    lines.push('Judge counts Zombie, Knife, Steal Points, Trick and Alvin as "evil"');
    lines.push('cards.');
    lines.push('An elimination normally lasts 1 round. Judge banishes for 3 rounds.');
    return lines;
  }

  /**
 * The AI's own hand, then exactly what it may play from it.
 *
 * The hand comes first and is explicit, because with a deck in play an AI can
 * only name a card it is actually holding - everything in the deck list below is
 * background, the hand is what it gets to choose from this turn.
   */
  function handSection(state, me) {
    var hand = Rules.handOf(state, me.id);
    var lines = ['', '=== YOUR HAND ==='];
    if (!hand.length) {
      lines.push('You are holding no cards.');
    } else {
      hand.forEach(function (cardId, i) {
        lines.push((i + 1) + '. ' + Rules.formatCard(cardId));
      });
    }

    // The legendary card is held on the player, not in the deck, so it has to be
    // offered separately - and only to whoever actually earned it.
    if (me.hasPhoenix && !me.phoenixUsed) {
      var legendary = Cards.byId(Rules.PHOENIX_CARD_ID);
      lines.push((hand.length + 1) + '. ' +
        (legendary ? legendary.name : 'Phoenix') + '  [LEGENDARY - one use only]');
    }
    return lines;
  }

  /** Exactly what this AI may play right now, with its valid targets. */
  function legalMovesSection(state, seat) {
    var me = state.players[seat];
    var hand = Rules.handOf(state, me.id);
    var lines = ['', '=== CARDS YOU CAN PLAY RIGHT NOW ==='];

    if (!hand.length) {
      lines.push('You are holding no cards this turn.');
      return lines;
    }

    // One entry per card actually in hand, in hand order.
    hand.forEach(function (cardId) {
      var card = Cards.byId(cardId);
      if (!card) return;
      if (!card.needsTarget) {
        lines.push('- ' + card.name + '  (no target needed)');
        return;
      }
      var names = Rules.legalTargets(state, seat, card.id)
        .map(function (id) { return labelFor(state, Rules.playerById(state, id), me); });
      if (!names.length) {
        lines.push('- ' + card.name + '  (in your hand, but no legal target right now)');
        return;
      }
      lines.push('- ' + card.name + '  ->  TARGET must be one of: ' + names.join(', '));
    });

    lines.push('');
    lines.push('You may only PLAY a card that is in your hand above. Naming a card');
    lines.push('you are not holding is rejected, as is an illegal target.');

    // The legendary card is not in `hand`, so it is listed here by hand rather
    // than swept from the deck.
    if (me.hasPhoenix && !me.phoenixUsed) {
      var legendary = Cards.byId(Rules.PHOENIX_CARD_ID);
      lines.push('');
      lines.push('- ' + (legendary ? legendary.name : 'Phoenix') +
        '  (no target needed, LEGENDARY)');
      lines.push('  This ends the game: you take every other player\'s points, they are');
      lines.push('  all eliminated, and one random opponent has their hand destroyed.');
      lines.push('  It can only be used once. You will never hold it again.');
    }
    return lines;
  }

  function historySection(state, me, log) {
    var lines = ['', '=== RECENT PLAY ==='];
    if (!log || !log.length) {
      lines.push('Nothing has been played yet.');
      return lines;
    }
    log.slice(-HISTORY_LIMIT).forEach(function (entry) {
      lines.push('- ' + entry.text);
    });
    return lines;
  }

  /** The reply format, spelled out with examples. */
  function formatSection(state, me) {
    // Pick real examples from this turn: a card that needs no target, a card
    // that does, and a target that is actually legal for it.
    var plain = Cards.CARDS.filter(function (c) { return !c.needsTarget; })[0];
    var withTarget = null;
    var targetName = null;
    Cards.CARDS.forEach(function (card) {
      if (withTarget || !card.needsTarget) return;
      var ids = Rules.legalTargets(state, me.seat, card.id);
      if (!ids.length) return;
      withTarget = card;
      targetName = labelFor(state, Rules.playerById(state, ids[0]), me);
    });

    var lines = [
      '',
      '=== HOW TO ANSWER ===',
      'You may write as much commentary, reasoning or emotion as you like first.',
      'The game ignores all of it. To actually make your move, finish your',
      'reply with the line(s) below.',
      '',
      'A card that needs no target - one line only:'
    ];

    lines.push('PLAY: ' + (plain ? plain.name : '+10,000 Points'));

    if (withTarget) {
      lines.push('');
      lines.push('A card that needs a target - two lines:');
      lines.push('PLAY: ' + withTarget.name);
      lines.push('TARGET: ' + targetName);
    }

    lines.push('');
    lines.push('Rules for your reply:');
    lines.push('- Write "PLAY:" then the exact card name, one of: ' + cardList() + '.');
    if (withTarget) {
      lines.push('- If that card needs a target, add a second line "TARGET:" then the');
      lines.push('  exact player name, e.g. "TARGET: ' + targetName + '".');
    }
    lines.push('- Do not write a TARGET line for a card that needs no target.');
    lines.push('- Write each field on its own line, spelled exactly as listed above.');
    lines.push('- If you write more than one PLAY line, the last one is used.');
    lines.push('- Choose the move YOU think is best. The game will play exactly what');
    lines.push('  you choose, so do not pick a card you would not actually play.');
    lines.push('- Only cards in YOUR HAND are playable. If none of them suit you,');
    lines.push('  still play the least bad one - you must play a card each turn.');
    return lines;
  }

  /**
   * "Knife, Zombie, Steal Points, ..." - every card an AI could name, including
   * the legendary one, since holding it is the only way to play it and that is
   * covered by the hand section.
   */
  function cardList() {
    return Cards.CARDS.map(function (c) { return c.name; }).join(', ');
  }

  /* --------------------------------------------------------------------- */

  /**
   * Builds the full prompt for the AI sitting in `seat`.
   *
   * @param {Object} state
   * @param {number} seat
   * @param {Array=} log public log entries, for context
   * @returns {string}
   */
  function buildPrompt(state, seat, log) {
    var me = state.players[seat];
    var lines = [];
    lines = lines.concat(headerSection(state, me));
    lines = lines.concat(scoresSection(state, me));
    lines = lines.concat(effectsSection(state, me));
    lines = lines.concat(handSection(state, me));
    lines = lines.concat(cardRulesSection());
    lines = lines.concat(legalMovesSection(state, seat));
    lines = lines.concat(historySection(state, me, log));
    lines = lines.concat(formatSection(state, me));
    lines.push('');
    lines.push('Reply now with your move.');
    return lines.join('\n');
  }

  /**
   * The prompt for an AI that has to CHOOSE a card rather than play a turn of its
   * own: Steal a Turn makes the chooser pick a card for somebody else, and Alvin
   * makes them pick a card to destroy.
   *
   * Both cases the chooser is not the player on turn, so this is its own prompt
   * rather than a variant of the normal one - it has to make clear whose hand it
   * is looking at and what exactly is being asked of it.
   *
   * @returns {string}
   */
  function buildChoicePrompt(state, info, log) {
    var chooser = Rules.playerById(state, info.chooserId);
    var target = Rules.playerById(state, info.targetId);
    var lines = [
      'You are playing PHOENIX as ' + chooser.name + '.',
      '',
      'Round ' + state.round + ' of ' + state.rounds + '.',
      ''
    ];

    if (info.kind === 'move') {
      lines.push('STEAL A TURN: it is ' + target.name + "'s turn, but YOU choose "
        + 'which card they play. They draw and take the turn as normal - you are '
        + 'only choosing the card, and the card must be one they are holding that '
        + 'they could legally play right now.');
      lines.push('');
      lines.push('=== ' + target.name + "'S HAND (choose one of these) ===");
      info.options.forEach(function (option, i) {
        var card = Cards.byId(option.cardId);
        var target = option.targetId ? Rules.playerById(state, option.targetId) : null;
        lines.push((i + 1) + '. ' + (card ? card.name : option.cardId) +
          (target ? '  ->  TARGET must be: ' + target.name : '  (no target)'));
      });
      lines.push('');
      lines.push('=== HOW TO ANSWER ===');
      lines.push('Name the card they must play. If it needs a target, add a second line.');
      lines.push('');
      lines.push('PLAY: <card>');
      if (info.options.some(function (o) { return o.targetId; })) {
        lines.push('TARGET: <player>');
      }
    } else {
      lines.push('ALVIN: you played Alvin at ' + target.name + ', so you have seen their '
        + 'hand and you now choose ONE card to destroy. That card leaves the game '
        + 'for good - not in the discard pile, never drawn again. Every other card '
        + 'they are holding is untouched.');
      lines.push('');
      lines.push('=== ' + target.name + "'S HAND (choose ONE to destroy) ===");
      info.options.forEach(function (option, i) {
        var card = Cards.byId(option.cardId);
        lines.push((i + 1) + '. ' + (card ? card.name : option.cardId));
      });
      lines.push('');
      lines.push('=== HOW TO ANSWER ===');
      lines.push('Name the single card to destroy.');
      lines.push('');
      lines.push('PLAY: <card>');
    }

    lines.push('- Choose the card YOU think is right. The game does exactly what you');
    lines.push('  choose.');
    lines.push('- Write each field on its own line, spelled exactly as listed above.');
    if (log && log.length) {
      lines.push('');
      lines.push('=== RECENT PLAY ===');
      log.slice(-HISTORY_LIMIT).forEach(function (entry) {
        lines.push('- ' + entry.text);
      });
    }
    lines.push('');
    lines.push('Reply now with your choice.');
    return lines.join('\n');
  }

  /** The "what can I play" list, for the UI panel. */
  function legalMovesText(state, seat) {
    var me = state.players[seat];
    var hand = Rules.handOf(state, me.id);
    var lines = hand.map(function (cardId) {
      var card = Cards.byId(cardId);
      if (!card) return null;
      if (!card.needsTarget) return card.name + ' (no target)';
      var names = Rules.legalTargets(state, seat, card.id)
        .map(function (id) { return Rules.playerById(state, id).name; });
      return card.name + ' -> ' + (names.length ? names.join(' / ') : 'no legal target');
    }).filter(Boolean);

    // The legendary card lives on the player rather than in the deck.
    if (me.hasPhoenix && !me.phoenixUsed) {
      lines.push((Cards.byId(Rules.PHOENIX_CARD_ID) || { name: 'Phoenix' }).name +
        ' (no target, LEGENDARY)');
    }
    if (!lines.length) return ['You are holding no cards.'];
    return lines;
  }

  /** Deck and discard counts, for the UI. */
  function deckSummary(state) {
    return {
      draw: state.deck.length,
      discard: state.discard.length,
      reshuffles: state.reshuffles
    };
  }

  /** Small helper for the UI, e.g. turnTitle('ChatGPT') -> "ChatGPT's turn". */
  function turnTitle(playerName) {
    return playerName + "'s turn - waiting for their reply";
  }

  return {
    buildPrompt: buildPrompt,
    buildChoicePrompt: buildChoicePrompt,
    legalMovesText: legalMovesText,
    deckSummary: deckSummary,
    handSection: handSection,
    turnTitle: turnTitle,
    points: points
  };
});