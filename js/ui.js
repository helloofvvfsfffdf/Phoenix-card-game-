/*
 * Phoenix - ui.js
 * ---------------------------------------------------------------------------
 * The only file in the project that touches the DOM. It reads the game state,
 * paints it, and turns clicks into moves.
 *
 * Two kinds of input reach the engine, and they use different paths:
 *
 *   the human  - click a card in the hand, then a target if it needs one
 *   an AI      - the relay panel: Copy Prompt, paste the reply, Submit AI Move
 *
 * Nothing here ever plays a card for an AI. When it is an AI's turn the panel
 * simply appears and waits; the only way its turn advances is
 * `game.submitAiMove(text)` with text the player copied from a real AI chat.
 */
(function () {
  'use strict';

  var Cards = window.PhoenixCards;
  var Rules = window.PhoenixRules;
  var Parser = window.PhoenixParser;
  var Prompt = window.PhoenixPrompt;
  var GameApi = window.PhoenixGame;

  var game = null;
  var chosenCard = null;   // a card waiting for its target
  var chosenChoice = null; // a forced-choice card waiting for its target
  var hoverTarget = null;  // the target button the pointer is on
  var toastTimer = null;

  /**
   * The hand fan: how far each card tilts and drops per step away from the
   * middle of the hand. The hand is not a fixed size - a player can be holding
   * six cards - so the fan is computed per card rather than per position.
   */
  var FAN_STEP = 1.6;   // degrees per card from the middle
  var FAN_DROP = 1.6;   // pixels per card from the middle

  /* --------------------------------------------------------------------- */
  /* Tiny DOM helpers                                                       */
  /* --------------------------------------------------------------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* --------------------------------------------------------------------- */
  /* Game lifecycle                                                         */
  /* --------------------------------------------------------------------- */

  function newGame(options) {
    var rounds = Number(($('rounds-select') || {}).value) || Rules.DEFAULT_ROUNDS;
    game = GameApi.create({ rounds: rounds, seed: (options || {}).seed });
    chosenCard = null;
    hoverTarget = null;
    $('win-screen').hidden = true;
    setRelayError('');
    $('ai-response').value = '';
    // createGame reads the switches, but applySeating is the one place that
    // reconciles state and logs it, so the board and the log always agree.
    game.applySeating();
    render();
  }

  /**
   * Shows a transient message. The AI relay is the focus of the prototype, so
   * messages dock top-right rather than covering the relay controls.
   */
  function toast(message, kind) {
    var node = $('toast');
    node.textContent = message;
    node.className = 'toast is-corner' + (kind ? ' is-' + kind : '');
    node.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 3200);
  }

  /* --------------------------------------------------------------------- */
  /* The human's move                                                       */
  /* --------------------------------------------------------------------- */

  function chooseCard(cardId) {
    if (!game.isHumanTurn()) return;
    var card = Cards.byId(cardId);
    if (!card) return;

    if (!card.needsTarget) {
      chosenCard = null;
      submit(cardId, null);
      return;
    }
    chosenCard = (chosenCard === cardId) ? null : cardId;
    render();
  }

  function chooseTarget(targetId) {
    if (!chosenCard) return;
    var cardId = chosenCard;
    chosenCard = null;
    submit(cardId, targetId);
  }

  function cancelTarget() {
    chosenCard = null;
    render();
  }

  function submit(cardId, targetId) {
    var result = game.playHuman(cardId, targetId);
    if (!result.ok) {
      // Keep the picker open so the mistake can be corrected in place.
      chosenCard = Cards.byId(cardId).needsTarget ? cardId : null;
      render();
      return;
    }
    chosenCard = null;
    render();
  }

  /* --------------------------------------------------------------------- */
  /* The AI relay                                                          */
  /* --------------------------------------------------------------------- */

  function setRelayError(message, hint) {
    var box = $('ai-error');
    if (!message) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.textContent = message + (hint ? '\n\n' + hint : '');
  }

  function onCopyPrompt() {
    var text = $('prompt-preview').textContent;
    if (!text) return;
    copyText(text);
  }

  /**
   * Clipboard access is unavailable or permission-denied in a lot of contexts
   * (including file:// pages), so fall back to selecting the text in a temporary
   * textarea the player can copy with Ctrl/Cmd+C.
   */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('Prompt copied. Paste it into ' + game.status().player.name + '.', 'ok');
      }, function () {
        legacyCopy(text);
      });
      return;
    }
    legacyCopy(text);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    toast(ok
      ? 'Prompt copied. Paste it into ' + game.status().player.name + '.'
      : 'Could not copy automatically - the prompt is selected, press Ctrl+C.',
      ok ? 'ok' : 'error');
  }

  function onSubmitAiMove() {
    var state = game.state;
    if (!state || state.over) return;

    // A forced choice is answered through the same box and the same PLAY: format,
    // but it goes to a different place: the chooser is not the player on turn, so
    // it must not be refused just because the turn belongs to somebody else.
    if (game.isAiChoosing()) {
      var pending = game.pendingChoice();
      var text0 = $('ai-response').value;
      if (!text0 || !text0.trim()) {
        setRelayError('Paste ' + pending.chooserName + '\'s choice first.',
          'Expected something like:\nPLAY: ' +
          (pending.options[0]
            ? Rules.formatCard(pending.options[0].cardId)
            : 'Zombie'));
        return;
      }
      var choice = game.submitForcedChoice(text0);
      if (!choice.ok) {
        setRelayError(pending.chooserName + ': ' + choice.error, choice.hint);
        toast(choice.error, 'error');
        return;
      }
      setRelayError('');
      $('ai-response').value = '';
      render();
      toast(pending.chooserName + ' made their choice.', 'ok');
      return;
    }

    var seat = state.turnInRound;
    var player = state.players[seat];

    if (player.isHuman) {
      toast('It is your turn, not an AI\'s. Play a card from your hand.', 'error');
      return;
    }

    var text = $('ai-response').value;
    if (!text || !text.trim()) {
      setRelayError('Paste ' + player.name + '\'s reply first.',
        'Expected something like:\nPLAY: Zombie\nTARGET: Gemini');
      return;
    }

    var result = game.submitAiMove(text);

    if (!result.ok) {
      // The turn does NOT advance. The AI can try again, and nothing is played
      // on its behalf.
      setRelayError(player.name + ': ' + result.error, result.hint);
      toast(result.error, 'error');
      return;
    }

    setRelayError('');
    $('ai-response').value = '';
    render();
    var next = game.status();
    toast(player.name + ' played ' + result.card +
      (result.targetName ? ' on ' + result.targetName : '') + '.', 'ok');
    if (!state.over && next.player) {
      toast('Next: ' + next.player.name + '.', 'ok');
    }
  }

  /* --------------------------------------------------------------------- */
  /* Rendering                                                              */
  /* --------------------------------------------------------------------- */

  function render() {
    renderStatus();
    renderBoard();
    renderSeatSwitches();
    renderHand();
    renderReveals();
    renderTargetPicker();
    renderHumanChoice();
    renderRelay();
    renderLog();
    renderWin();
  }

  /**
   * One on/off switch per AI. Switching a player applies to the game in
   * progress as well as the next one - a player who is switched off mid-turn
   * hands the turn straight on, and the relay panel closes if it was them.
   */
  function renderSeatSwitches() {
    var box = $('seat-switches');
    var roster = game.roster();

    clear(box);
    roster.forEach(function (entry) {
      if (entry.isHuman) return;

      var wrap = make('div', 'seat-switch');
      if (!entry.enabled) wrap.classList.add('is-off');

      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = entry.enabled;
      input.id = 'switch-' + entry.id;
      input.addEventListener('change', function () {
        var result = game.setPlayerEnabled(entry.id, input.checked);
        if (!result.ok) {
          toast(result.error, 'error');
          input.checked = entry.enabled;   // put the switch back
          return;
        }
        game.applySeating();
        render();
        toast(entry.name + (input.checked ? ' is in for the rest of this game.' : ' is switched off.'), 'ok');
      });

      var label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.appendChild(make('span', 'seat-switch-name', entry.name));

      wrap.appendChild(input);
      wrap.appendChild(label);
      box.appendChild(wrap);
    });

    var on = roster.filter(function (r) { return !r.isHuman && r.enabled; }).length;
    $('seats-note').textContent = on + ' of 4 AI players in play.';
  }

  /**
   * The AI relay panel. It is the centre of the prototype, so it is shown
   * whenever an AI holds the turn and it says exactly who is being waited on.
   */
  function renderRelay() {
    var panel = $('ai-panel');
    var state = game.state;

    // A forced choice takes priority over an ordinary turn. When one is
    // outstanding the player ON TURN is not the one who has to decide - Steal a
    // Turn hands the decision to whoever cast it, and Alvin hands it straight
    // back - so the panel follows the CHOOSER, not the turn.
    var choice = state && !state.over && game.isAiChoosing() && game.isChoiceDue()
      ? game.pendingChoice()
      : null;
    var waiting = !!(state && !state.over && (choice || game.isAwaitingAi()));
    var chooserName = choice ? choice.chooserName
      : state.players[state.turnInRound].name;

    panel.hidden = !waiting;
    if (!waiting) return;

    $('ai-waiting').textContent = chooserName;
    $('ai-title').textContent = choice
      ? (choice.kind === Rules.PENDING_CHOICE_KINDS.BURN
        ? 'Choose a card to destroy'
        : 'Choose a card for ' + choice.targetName)
      : Prompt.turnTitle(chooserName);
    $('ai-help').textContent = choice
      ? ('Copy the prompt below into ' + chooserName + '. It has to pick a card ' +
        'for ' + choice.targetName + ', and the game will do exactly what it ' +
        'chooses. The reply uses the same "PLAY:" format as a normal turn.')
      : ('Copy the prompt below into ' + chooserName + ', let it decide, then paste ' +
        'its reply under the prompt. The game plays exactly what that AI chooses.');

    $('prompt-preview').textContent = choice
      ? game.choicePromptForCurrent()
      : game.promptForCurrent();
    $('legal-moves').textContent = choice
      ? choiceHint(choice)
      : game.legalMovesForCurrent().join('\n');
  }

  /** The options list for a forced choice, in the same plain-text style. */
  function choiceHint(choice) {
    return choice.options.map(function (option) {
      return Rules.formatCard(option.cardId) +
        (option.targetId
          ? ' -> ' + Rules.displayName(game.state, Rules.playerById(game.state, option.targetId))
          : '');
    }).join('\n');
  }

  /**
   * The human's forced choice - Steal a Turn or Alvin - is not a turn, so it gets
   * its own panel rather than borrowing the hand: the player on turn may well be
   * somebody else entirely.
   */
  function renderHumanChoice() {
    var panel = $('choice-panel');
    if (!panel) return;
    // Only offered once it can actually be answered. A Steal a Turn is not due
    // until the table reaches its target, and until then the target has not
    // drawn - so the options would not be the options.
    var pending = game.isHumanChoosing() && game.isChoiceDue()
      ? game.pendingChoice()
      : null;

    panel.hidden = !pending;
    if (!pending) return;

    var burning = pending.kind === Rules.PENDING_CHOICE_KINDS.BURN;
    $('choice-title').textContent = burning
      ? 'Choose one card of ' + pending.targetName + "'s hand to destroy"
      : 'Choose the card ' + pending.targetName + ' plays this turn';
    $('choice-help').textContent = burning
      ? ('That card leaves the game for good - not in the discard pile, never ' +
        'drawn again. Every other card they are holding is untouched.')
      : (pending.targetName + ' still takes this turn and still draws normally; ' +
        'you are only choosing which card they play, and it has to be one they ' +
        'could legally play right now.');

    var grid = $('choice-grid');
    clear(grid);
    $('choice-targets').hidden = true;
    chosenChoice = null;

    game.choiceOptions().forEach(function (option) {
      var button = make('button', 'choice-option');
      button.type = 'button';
      var card = Cards.byId(option.cardId);
      if (card) button.setAttribute('data-tone', card.tone);
      button.appendChild(make('span', 'choice-option-name', option.name));

      // What the note says depends on WHY the card is on offer. An Alvin burn
      // destroys a card rather than playing it, so a card that would normally
      // need a target needs nothing extra here - and saying otherwise used to
      // send the click into a target step that could never be completed.
      var note;
      if (burning) {
        note = 'destroyed for good';
      } else if (option.targetName) {
        note = 'aimed at ' + option.targetName;
      } else {
        note = 'no target needed';
      }
      button.appendChild(make('span', 'choice-option-note', note));

      button.addEventListener('click', function () {
        // A forced Steal a Turn card may itself be aimed, so ask for the target
        // as a second step rather than guessing one. Alvin never does: it
        // destroys a card, so every option is complete on its own.
        if (!burning && card && card.needsTarget && !option.targetId) {
          chosenChoice = card;
          renderChoiceTargets(card);
          return;
        }
        settleChoice(option.cardId, option.targetId);
      });
      grid.appendChild(button);
    });
  }

  /** Finishes a human forced choice and reports any refusal in place. */
  function settleChoice(cardId, targetId) {
    chosenChoice = null;
    var result = game.playForcedChoice(cardId, targetId);
    if (!result.ok) {
      setChoiceError(result.error);
      render();
      return;
    }
    setChoiceError('');
    render();
  }

  function setChoiceError(message) {
    var node = $('choice-error');
    if (node) node.textContent = message || '';
  }

  /**
   * The second step for a forced card that has to be aimed: Steal a Turn can
   * hand somebody a card that needs a target, and the legal targets for it have
   * to be picked before it can be played for them.
   */
  function renderChoiceTargets(card) {
    var row = $('choice-targets');
    var options = game.choiceOptions().filter(function (o) {
      return o.cardId === card.id && o.targetId;
    });
    clear(row);
    row.hidden = options.length === 0;
    if (!options.length) return;
    row.appendChild(make('p', 'choice-targets-title', 'Aim ' + card.name + ' at:'));
    options.forEach(function (option) {
      var button = make('button', 'choice-target');
      button.type = 'button';
      button.textContent = option.targetName;
      button.addEventListener('click', function () {
        settleChoice(option.cardId, option.targetId);
      });
      row.appendChild(button);
    });
  }

  function renderStatus() {
    var status = game.status();
    var state = game.state;

    $('round-label').textContent = state.over
      ? state.rounds + ' rounds done'
      : Math.min(state.round, state.rounds) + ' / ' + state.rounds;

    if (state.over) {
      $('turn-label').textContent = 'Game over';
      return;
    }

    // A forced choice overrides the turn label: the person who has to act is the
    // chooser, not whoever the turn happens to be sitting with. Until a Steal a
    // Turn is due it reads as a wait, not as a decision.
    var pending = game.pendingChoice();
    if (pending) {
      if (!game.isChoiceDue()) {
        $('turn-label').textContent = 'Waiting for ' + pending.targetName +
          "'s turn - then " +
          (pending.chooserId === 'human' ? 'you' : pending.chooserName) +
          ' choose their card';
      } else {
        $('turn-label').textContent = (pending.chooserId === 'human' ? 'You' : pending.chooserName) +
          ' must choose a card' +
          (pending.kind === Rules.PENDING_CHOICE_KINDS.BURN
            ? ' to destroy'
            : ' for ' + pending.targetName);
      }
      return;
    }

    var player = status.player;
    var suffix;
    if (player.isHuman) {
      suffix = Rules.isOut(player, state) ? ' (eliminated)' : ' - your turn';
    } else {
      suffix = ' - waiting for its reply';
    }
    $('turn-label').textContent = player.name + suffix;
  }

  function renderBoard() {
    var board = $('board');
    var state = game.state;
    var ranks = {};
    Rules.standings(state).forEach(function (p, index) { ranks[p.id] = index + 1; });
    var leader = Rules.leader(state);

    clear(board);
    state.players.forEach(function (player) {
      var out = Rules.isOut(player, state);
      var disabled = Rules.isDisabled(player);
      var seat = make('div', 'seat');
      seat.classList.add('is-' + player.id);
      if (player.isHuman) seat.classList.add('is-human');
      if (player.seat === state.turnInRound && !state.over && !disabled) {
        seat.classList.add('is-turn');
      }
      if (out) seat.classList.add('is-out');
      if (disabled) seat.classList.add('is-disabled');

      // Trick hides a player under an alias. The seat card shows the alias,
      // because that is what the card is about, with the real name underneath so
      // the trick is readable rather than merely confusing. The human's own seat
      // keeps "You", because that is how the page refers to them everywhere.
      var shown = Rules.displayName(state, player);
      var disguised = Rules.isDisguised(state, player);

      var top = make('div', 'seat-top');
      top.appendChild(make('span', 'seat-name',
        player.isHuman ? player.name : shown));
      if (disguised) {
        top.appendChild(make('span', 'seat-name-alias', 'really ' + player.name));
      }
      if (player.enabled) {
        top.appendChild(make('span', 'seat-rank', '#' + ranks[player.id]));
      } else {
        top.appendChild(make('span', 'seat-rank', '\u2014'));
      }
      seat.appendChild(top);

      // The opponents are external AIs driven by the player, not code in this
      // project, so the seat describes where their reply comes from.
      var role = player.isHuman
        ? 'Human player'
        : 'External AI - paste its replies in';
      seat.appendChild(make('p', 'seat-role', role));
      seat.appendChild(make('p', 'seat-points', Rules.formatPoints(player.points)));

      var badges = make('div', 'seat-badges');
      if (disabled) {
        badges.appendChild(make('span', 'badge badge-off', 'Switched off'));
      } else {
        if (!state.over && player.seat === state.turnInRound) {
          badges.appendChild(make('span', 'badge badge-turn', 'Playing'));
        }
        if (player.hunter) {
          badges.appendChild(make('span', 'badge badge-hunter', 'Hunter'));
        }
        if (player.ghost) {
          badges.appendChild(make('span', 'badge badge-ghost', 'Ghost'));
        }
        if (disguised) {
          badges.appendChild(make('span', 'badge badge-trick',
            'Disguised as ' + shown));
        }
        // The player is told they are cursed but never which card, which is the
        // whole point of Curse - so the badge is deliberately card-less.
        if (player.cursed && player.cursed.length) {
          badges.appendChild(make('span', 'badge badge-curse',
            'Cursed (' + player.cursed.length + ' card'
              + (player.cursed.length === 1 ? '' : 's') + ')'));
        }
        if (game.hasPhoenix(player.id)) {
          badges.appendChild(make('span', 'badge badge-phoenix', 'Holds Phoenix'));
        }
        // A hand somebody else has seen, courtesy of Reveal Deck. Shown to
        // everyone because the reveal is on the public log, but the hand itself
        // is only opened up for the player who paid for it - see the seats below.
        if (player.revealed && player.revealed.length) {
          badges.appendChild(make('span', 'badge badge-reveal',
            'Hand revealed to ' + player.revealed.length
              + (player.revealed.length === 1 ? ' player' : ' players')));
        }
        if (out) {
          badges.appendChild(make('span', 'badge badge-out',
            'Out until round ' + Rules.returnRound(player)));
        }
        if (!state.over && leader.seat === player.seat && !out) {
          badges.appendChild(make('span', 'badge badge-lead', 'Leading'));
        }
      }
      if (player.enabled) {
        // The opponents' cards are hidden, but the count is public - same as a
        // real hand held face down.
        badges.appendChild(make('span', 'badge',
          game.handCount(player.id) + (game.handCount(player.id) === 1 ? ' card' : ' cards')));
      }
      seat.appendChild(badges);

      board.appendChild(seat);
    });
  }

  /**
   * Deck and discard counters above the hand.
   *
   * Destroyed cards have their own count, because Alvin takes them out of the
   * game entirely. Without a counter the two piles quietly stop adding up to the
   * deck, which looks like a bug even though it is the card working.
   */
  function renderPiles() {
    var info = game.deckInfo();
    $('pile-draw').querySelector('.pile-count').textContent = info.draw;
    $('pile-discard').querySelector('.pile-count').textContent = info.discard;
    var destroyed = $('pile-destroyed');
    if (destroyed) {
      var count = game.state ? game.state.destroyed.length : 0;
      destroyed.querySelector('.pile-count').textContent = count;
      destroyed.hidden = count === 0;
    }
  }

  function renderHand() {
    var hand = $('hand');
    var note = $('hand-note');
    var state = game.state;
    renderPiles();
    var you = state.players[game.humanSeat()];   // the seating is shuffled each game
    var active = game.isHumanTurn();

    clear(hand);

    // With a deck in play the hand is what you are holding - not the whole
    // five-card set - and a turn draws a card before you choose. Duplicates
    // (two of the same card from a reshuffle) each get their own face, like
    // real cards in a hand.
    var myCards = game.myHand();
    var holding = myCards.length > 0;

    myCards.forEach(function (card, index) {
      var button = make('button', 'card');
      button.type = 'button';
      button.setAttribute('data-tone', card.tone);
      button.setAttribute('data-card', card.id);
      button.title = card.rule + ' ' + card.targetNote;
      button.setAttribute('aria-label',
        card.name + '. ' + card.rule + ' ' + card.targetNote);
      button.setAttribute('aria-pressed', chosenCard === card.id ? 'true' : 'false');
      if (chosenCard === card.id) button.classList.add('is-chosen');
      button.disabled = !active;

      // The fan is measured out from the middle of the hand, so it works for
      // any number of cards rather than a fixed five.
      var fromCentre = index - (myCards.length - 1) / 2;
      button.style.setProperty('--fan', (fromCentre * FAN_STEP) + 'deg');
      button.style.setProperty('--drop',
        (Math.abs(fromCentre) * FAN_DROP) + 'px');

      // Corner index, in the style of a playing card.
      var corner = make('span', 'card-corner');
      corner.appendChild(make('span', 'card-corner-glyph', card.glyph));
      corner.appendChild(make('span', 'card-corner-tag', card.short));
      button.appendChild(corner);

      // Artwork panel holding the symbol. A card that brings its own artwork -
      // Alvin's ginger cat - draws that instead of the glyph, because a single
      // character cannot really be a ginger cat.
      var art = make('span', 'card-art');
      if (card.art) {
        // The markup is a static string from cards.js, not anything typed in.
        art.innerHTML = card.art;
        var drawn = art.querySelector('svg');
        if (drawn) {
          drawn.setAttribute('class', 'card-art-art');
          drawn.setAttribute('focusable', 'false');
        }
      } else {
        art.appendChild(make('span', 'card-glyph', card.glyph));
      }
      button.appendChild(art);

      button.appendChild(make('span', 'card-name', card.name));
      button.appendChild(make('span', 'card-blurb', card.blurb));
      button.appendChild(make('span', 'card-tag',
        card.legendary ? 'Legendary - one use'
          : (card.needsTarget ? 'Needs a target' : 'No target')));

      button.addEventListener('click', function () { chooseCard(card.id); });
      hand.appendChild(button);
    });

    if (state.over) {
      note.textContent = 'The game is over.';
      note.classList.remove('is-alert');
      return;
    }
    // While a forced choice is outstanding the hand is not playable, whoever it
    // belongs to, so say so rather than showing a dead turn.
    var pending = game.pendingChoice();
    if (pending) {
      if (!game.isChoiceDue()) {
        note.textContent = 'Steal a Turn is waiting for ' + pending.targetName +
          "'s turn - you choose their card once it is their turn.";
      } else if (pending.chooserId === 'human') {
        note.textContent = 'Not your turn to play - you have to choose a card first. See the panel above.';
      } else {
        note.textContent = 'Waiting for ' + pending.chooserName +
          ' to choose the card ' + pending.targetName + ' plays.';
      }
      note.classList.add('is-alert');
      return;
    }
    if (Rules.isOut(you, state)) {
      note.textContent = 'You are eliminated this round and are back in round '
        + Rules.returnRound(you) + '.';
      note.classList.add('is-alert');
      return;
    }
    if (chosenCard) {
      var chosen = Cards.byId(chosenCard);
      note.textContent = 'Pick who ' + chosen.name + ' is aimed at.';
      note.classList.add('is-alert');
      return;
    }
    if (active) {
      note.textContent = holding
        ? 'Your turn - play a card from your hand. You draw one at the start of every turn.'
        : 'Your turn - you are holding no cards, so you must draw one.';
      note.classList.add(!holding);
      return;
    }
    if (game.isAwaitingAi()) {
      note.textContent = 'Waiting for ' + game.status().player.name
        + ' - paste its reply in the AI panel above.';
    } else {
      note.textContent = 'Passing the other players - their turn is coming up.';
    }
    note.classList.remove('is-alert');
  }

  /**
   * Reveal Deck is information, not an effect: it changes nothing on the table,
   * so the only place it can show up is a panel listing the hands this player has
   * been shown. It is built from the engine's own reveal list, so it can never
   * show a hand nobody paid to see.
   */
  function renderReveals() {
    var panel = $('reveals');
    var list = $('reveals-list');
    if (!game.state) {
      panel.hidden = true;
      return;
    }
    var you = game.state.players[game.humanSeat()];
    var seen = you.shownToMe || [];

    clear(list);
    if (!seen.length) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    seen.forEach(function (id) {
      var player = Rules.playerById(game.state, id);
      if (!player) return;
      var hand = Rules.handOf(game.state, id);
      var row = make('div', 'reveal-row');
      row.appendChild(make('span', 'reveal-name', player.name));
      var faces = make('span', 'reveal-cards');
      if (!hand.length) {
        faces.appendChild(make('span', 'reveal-empty', 'holding nothing'));
      } else {
        hand.forEach(function (cardId) {
          var card = Cards.byId(cardId);
          faces.appendChild(make('span', 'reveal-card',
            (card ? card.name : cardId)));
        });
      }
      row.appendChild(faces);
      list.appendChild(row);
    });
  }

  function renderTargetPicker() {
    var panel = $('target-panel');
    if (!chosenCard || !game.isHumanTurn()) {
      panel.hidden = true;
      hoverTarget = null;
      return;
    }
    var state = game.state;
    var you = game.humanSeat();
    var card = Cards.byId(chosenCard);
    panel.hidden = false;
    $('target-title').textContent = card.name + ' - choose a player';

    var grid = $('target-grid');
    clear(grid);

    // With a deck in play you can only aim a card you are holding.
    if (!Rules.holdsCard(state, state.players[you].id, card.id)) {
      grid.appendChild(make('p', 'target-empty', 'You are not holding ' + card.name + '.'));
      updateTargetWarning();
      return;
    }

    // Rules.legalTargets is the single source of truth for who may be aimed at,
    // so the picker can never offer something the engine would then refuse.
    var legal = Rules.legalTargets(state, you, card.id);
    var listed = 0;

    legal.forEach(function (id) {
      var target = Rules.playerById(state, id);
      if (!target) return;
      listed++;

      var button = make('button', 'target');
      button.type = 'button';
      if (target.hunter) button.classList.add('is-hunter');

      // The displayed identity, not the real one: Trick's whole job is that the
      // table cannot tell the difference, and the picker is part of the table.
      button.appendChild(make('span', 'target-name', Rules.displayName(state, target)));
      button.appendChild(make('span', 'target-points', Rules.formatPoints(target.points)));
      button.appendChild(make('span', 'target-meta',
        target.hunter ? 'Hunter - unaffected by ' + card.name : 'Playing now'));

      button.addEventListener('click', function () { chooseTarget(target.id); });
      button.addEventListener('mouseenter', function () { hoverTarget = target.id; updateTargetWarning(); });
      button.addEventListener('focus', function () { hoverTarget = target.id; updateTargetWarning(); });
      button.addEventListener('mouseleave', function () { hoverTarget = null; updateTargetWarning(); });
      button.addEventListener('blur', function () { hoverTarget = null; updateTargetWarning(); });
      grid.appendChild(button);
    });

    if (!listed) {
      grid.appendChild(make('p', 'target-empty',
        'Nobody can be targeted with ' + card.name + ' right now.'));
    }

    updateTargetWarning();
  }

  /**
   * Explains the target list: which seats are excluded and why, using the
   * engine's own rules so the message can never disagree with them.
   */
  function updateTargetWarning() {
    var node = $('target-warning');
    if (!chosenCard) {
      node.hidden = true;
      node.textContent = '';
      node.className = 'target-warning';
      return;
    }
    var state = game.state;
    var you = game.humanSeat();
    var card = Cards.byId(chosenCard);
    var legal = Rules.legalTargets(state, you, card.id);
    var excluded = [];

    Rules.opponents(state, you).forEach(function (target) {
      if (legal.indexOf(target.id) !== -1) return;
      // Displayed names, so the "who is excluded" list matches the buttons above
      // it. Ghost is called out explicitly because it is a new way to be
      // unavailable, and the player should be able to see why.
      var shown = Rules.displayName(state, target);
      if (Rules.isDisabled(target)) {
        excluded.push(shown + ' (switched off)');
      } else if (Rules.isOut(target, state)) {
        excluded.push(shown + ' (eliminated this round)');
      } else if (target.ghost) {
        excluded.push(shown + ' (Ghost - untargetable until the end of the round)');
      } else if (card.reflected && target.hunter) {
        excluded.push(shown + ' (Hunter - a Zombie aimed at them is reflected back)');
      }
    });

    node.hidden = false;
    node.className = 'target-warning';
    if (excluded.length) {
      node.textContent = 'Not available: ' + excluded.join(', ') + '.';
    } else {
      node.className = 'target-warning is-hint';
      node.textContent = card.targetNote;
    }
  }

  function renderLog() {
    var list = $('log');
    clear(list);
    game.log.forEach(function (entry) {
      var item = make('li', 'log-' + entry.type, entry.text);
      list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
  }

  function renderWin() {
    var screen = $('win-screen');
    if (!game.state.over) {
      screen.hidden = true;
      return;
    }
    screen.hidden = false;
    var status = game.status();
    var winner = status.winner;
    $('win-title').textContent = winner && winner.isHuman ? 'You win' : 'Game over';

    var sub = status.tied
      ? 'A tie after ' + game.state.rounds + ' rounds on '
        + Rules.formatPoints(status.standings[0].points) + ' points.'
      : (winner.name + (winner.isHuman ? ' win' : ' wins') + ' with '
        + Rules.formatPoints(winner.points)
        + ' points after ' + game.state.rounds + ' rounds.');

    // Winning a whole game awards the legendary card for the next one. It is
    // never dealt, so this is the only way it enters play, and it says so here.
    var awarded = game.state.phoenixAwarded;
    if (awarded) {
      var holder = Rules.playerById(game.state, awarded);
      sub += ' ' + (holder.name + (holder.isHuman ? ' earn' : ' earns')
        + ' the Phoenix card for the next game.');
    }
    $('win-sub').textContent = sub;

    var table = $('win-summary');
    clear(table);
    status.standings.forEach(function (player) {
      var row = make('li');
      if (player.seat === game.state.winnerSeat) row.classList.add('is-winner');
      row.appendChild(make('span', 'win-name', player.name));
      row.appendChild(make('span', 'win-points', Rules.formatPoints(player.points)));
      table.appendChild(row);
    });
  }

  /* --------------------------------------------------------------------- */
  /* Wiring                                                                 */
  /* --------------------------------------------------------------------- */

  function init() {
    $('btn-new').addEventListener('click', function () { newGame(); });
    $('btn-play-again').addEventListener('click', function () { newGame(); });
    $('btn-cancel-target').addEventListener('click', cancelTarget);
    $('btn-copy-prompt').addEventListener('click', onCopyPrompt);
    $('btn-submit-ai').addEventListener('click', onSubmitAiMove);
    // Ctrl/Cmd + Enter submits, matching the AI UNO relay.
    $('ai-response').addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        onSubmitAiMove();
      }
    });
    newGame();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Console helpers while playing.
  window.phoenix = {
    get game() { return game; },
    rules: Rules,
    cards: Cards,
    parser: Parser,
    prompt: Prompt,
    newGame: newGame,
    render: render,
    play: function (cardId, targetId) {
      var result = game.playHuman(cardId, targetId);
      render();
      return result;
    },
    // The relay, callable from the console:
    //   phoenix.copy()      -> the prompt string for whoever is on turn
    //   phoenix.submit(t)  -> feed a pasted reply back in
    copy: function () {
      return game.isAwaitingChoice() ? game.choicePromptForCurrent() : game.promptForCurrent();
    },
    submit: function (text) {
      // A forced choice and an ordinary turn are answered with the same "PLAY:"
      // format, so this routes to whichever one is actually waiting.
      var result = game.isAwaitingChoice() && game.isAiChoosing()
        ? game.submitForcedChoice(text)
        : game.submitAiMove(text);
      render();
      return result;
    },
    // Forced choices (Steal a Turn, Alvin), for trying them out from the console:
    //   phoenix.choices()            -> what the chooser is being offered
    //   phoenix.choose()             -> settle it by clicking, human path
    //   phoenix.chooseFirst()        -> take the first option
    choices: function () { return game.choiceOptions(); },
    choose: function (cardId, targetId) {
      var result = game.playForcedChoice(cardId, targetId);
      render();
      return result;
    },
    chooseFirst: function () {
      var options = game.choiceOptions();
      if (!options.length) return { ok: false, error: 'There is no choice waiting.' };
      return this.choose(options[0].cardId, options[0].targetId);
    }
  };
})();