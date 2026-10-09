/*
 * Phoenix - cards.js
 * ---------------------------------------------------------------------------
 * The cards, and nothing else. Pure data: no rules, no state, no DOM.
 *
 * This file is the single source of truth for card text. The UI, the AI and
 * the test suite all read the names and blurbs from here, so a rule tweak only
 * has to be made once.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * needsTarget  - true when the card asks for a player to be chosen.
   * targetNote   - what "choose a target" means for this card.
   * blurb        - the short line printed on the card face.
   * rule         - the full sentence used in the hand panel and the log.
   * art          - optional inline SVG shown in place of the glyph on the card
   *                face. Only Alvin has one, because a single character cannot
   *                really be "a ginger cat".
   * forcedChoice - 'move' or 'burn': when this card resolves it hands control
   *                back to the player who played it, to pick a card. See
   *                Rules.PENDING_CHOICE_KINDS.
   */
  /**
   * The cards played most in Phoenix are considered "evil" - see EVIL_CARDS.
   * Judge counts them; nothing else cares.
   *
   * Trick and Alvin are on this list because they work by deceiving or
   * dismantling the table rather than moving points, which is the same kind of
   * move as Knife and Zombie rather than a scoring swing.
   */
  var EVIL_CARDS = ['zombie', 'knife', 'steal', 'trick', 'alvin'];

  var CARDS = [
    {
      id: 'bonus',
      name: '+10,000 Points',
      short: '+10k',
      glyph: '\u2726',
      tone: 'gold',
      needsTarget: false,
      blurb: 'Add 10,000 points to yourself.',
      rule: 'Add 10,000 points to your own score.',
      targetNote: 'No target.'
    },
    {
      id: 'knife',
      name: 'Knife',
      short: 'Knife',
      glyph: '\u{1F5E1}',
      tone: 'steel',
      needsTarget: true,
      blurb: 'Eliminate an opponent for 1 round.',
      rule: 'Choose an opponent. They are eliminated for 1 round.',
      targetNote: 'Pick one opponent. They skip their next turn, then return.',
      reflected: false
    },
    {
      id: 'hunter',
      name: 'Hunter',
      short: 'Hunter',
      glyph: '\u{1F3F9}',
      tone: 'green',
      needsTarget: false,
      blurb: 'Zombies aimed at you come back at the thrower.',
      rule: 'You gain a Hunter effect.',
      targetNote: 'No target.',
      reflected: false
    },
    {
      id: 'zombie',
      name: 'Zombie',
      short: 'Zombie',
      glyph: '\u{1F9DF}',
      tone: 'toxic',
      needsTarget: true,
      blurb: 'Eliminate a player for 1 round and reset them to 0.',
      rule: 'Choose a player. They are eliminated for 1 round and their points reset to 0.',
      targetNote: 'Pick one player. A Hunter reflects this back at you instead.',
      reflected: true
    },
    {
      id: 'steal',
      name: 'Steal Points',
      short: 'Steal',
      glyph: '\u{1FAF4}',
      tone: 'violet',
      needsTarget: true,
      blurb: 'Take everything a player has.',
      rule: 'Choose a player and take all of their points.',
      targetNote: 'Pick one player. Their score drops to 0 and you gain all of it.',
      reflected: false
    },
    {
      id: 'judge',
      name: 'Judge',
      short: 'Judge',
      glyph: '\u2696',
      tone: 'judge',
      needsTarget: false,
      blurb: '50% chance to banish the most evil player for 3 rounds.',
      rule: 'When played, there is a 50% chance it activates. If it fails, nothing happens. If it activates, find the player who has played the most evil cards - Zombie, Knife, Steal Points, Trick and Alvin count, Judge does not - and eliminate that player for 3 rounds.',
      targetNote: 'No target: Judge picks the player.',
      reflected: false
    },
    {
      id: 'reveal',
      name: 'Reveal Deck',
      short: 'Reveal',
      glyph: '\u{1F441}',
      tone: 'reveal',
      needsTarget: true,
      blurb: "See one opponent's hand.",
      rule: "Choose an opponent and reveal their current hand to you.",
      targetNote: 'Pick one opponent. You see their hand; nothing is removed or changed.',
      reflected: false,
      informational: true
    },
    {
      id: 'skipall',
      name: 'Skip Everyone',
      short: 'Skip All',
      glyph: '\u21BA',
      tone: 'skip',
      needsTarget: false,
      blurb: 'Skip every other player and take another turn.',
      rule: 'Every other player is skipped. You immediately get another turn. Nobody is eliminated and no cards are removed.',
      targetNote: 'No target: it skips everyone.',
      reflected: false
    },
    {
      id: 'phoenix',
      name: 'Phoenix',
      short: 'Phoenix',
      glyph: '\u27B6',
      tone: 'phoenix',
      needsTarget: false,
      legendary: true,
      inDeck: false,
      oncePerGame: true,
      blurb: 'Legendary. Win a whole game to earn it.',
      rule: 'The legendary card. It never appears in the draw deck and cannot be drawn: the only way to hold it is to win an entire game, which awards it to you for your next game. When played you take EVERY other player\'s points, eliminate all of them, and one random opponent has their hand cleared and must draw again. Phoenix can only be used once.',
      targetNote: 'No target: Phoenix takes everything.',
      reflected: false
    },
    {
      id: 'trick',
      name: 'Trick',
      short: 'Trick',
      glyph: '\u{1F483}',
      tone: 'trick',
      needsTarget: true,
      blurb: 'Disguise who they are until the round ends.',
      rule: "Choose an opponent and disguise them: until the end of this round everybody at the table reads them as somebody else entirely - a Smuggler, a Courier, a Gambler, the Stray or the Newcomer. They are still really themselves: their score, effects, cards and eliminations are all unchanged, every rule and Judge still work on the real player, and their real name comes back at the end of the round. An evil card, so Judge counts it.",
      targetNote: 'Pick one opponent. They are seen as somebody else until the round ends.',
      reflected: false,
      informational: false
    },
    {
      id: 'stealturn',
      name: 'Steal a Turn',
      short: 'Steal Tn',
      glyph: '\u{1F501}',
      tone: 'stealturn',
      needsTarget: true,
      blurb: "You pick the card they play on their next turn.",
      rule: "Choose an opponent. On their next turn you choose which card from their hand they have to play. They still take that turn normally - they draw their card and it is still their turn - but the choice of card is yours. It must be a card they are holding and could legally play at that moment. Once you have made that choice the effect is used up.",
      targetNote: 'Pick one opponent. You choose the card they play on their next turn.',
      reflected: false,
      forcedChoice: 'move'
    },
    {
      id: 'curse',
      name: 'Curse',
      short: 'Curse',
      glyph: '\u{1F47B}',
      tone: 'curse',
      needsTarget: true,
      blurb: 'One card in their hand is cursed. They will not know which.',
      rule: "Choose an opponent. One card in their hand at random is cursed, and they are not told which one. When they play the cursed card it resolves normally, and then they are eliminated for 1 round. If they never play that card, nothing happens. The curse is removed once it triggers.",
      targetNote: 'Pick one opponent. One card in their hand is cursed, secretly.',
      reflected: false
    },
    {
      id: 'ghost',
      name: 'Ghost',
      short: 'Ghost',
      glyph: '\u{1F47B}',
      tone: 'ghost',
      needsTarget: false,
      blurb: 'Nothing can be aimed at you until the round ends.',
      rule: 'You cannot be chosen as the target of any card for the rest of this round. Every other player can still target each other normally. It removes none of your existing effects, and it wears off at the end of the round.',
      targetNote: 'No target: you become untargetable.',
      reflected: false
    },
    {
      id: 'alvin',
      name: 'Alvin',
      short: 'Alvin',
      glyph: '\u{1F408}',
      tone: 'alvin',
      needsTarget: true,
      blurb: 'See their hand, then burn one card forever.',
      rule: 'A tribute to a ginger cat. Choose an opponent and see their hand, then choose ONE card from it to destroy. That card leaves the game for good - it is not put in the discard pile, it can never be shuffled back into a deck, and it will never be seen again. Everything else they are holding is untouched. An evil card, so Judge counts it.',
      targetNote: 'Pick one opponent. You see their hand and destroy one card from it.',
      reflected: false,
      forcedChoice: 'burn',
      // A single glyph cannot really be "a ginger cat", so Alvin gets drawn
      // artwork: a ginger tabby face, in the same warm palette as the card face.
      art: '<svg viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A ginger cat">' +
        '<defs>' +
        '<linearGradient id="phxFur" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#ffb264"/><stop offset="1" stop-color="#e2762a"/>' +
        '</linearGradient>' +
        '<linearGradient id="phxMuzzle" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#fff6e8"/><stop offset="1" stop-color="#ffe3bd"/>' +
        '</linearGradient>' +
        '</defs>' +
        // Ears, drawn first so the head overlaps their base.
        '<path d="M9 22 L6 5 L23 13 Z" fill="#e2762a"/>' +
        '<path d="M55 22 L58 5 L41 13 Z" fill="#e2762a"/>' +
        '<path d="M12.5 20 L11 10 L21 15 Z" fill="#ffc9a3"/>' +
        '<path d="M51.5 20 L53 10 L43 15 Z" fill="#ffc9a3"/>' +
        // Head.
        '<ellipse cx="32" cy="31" rx="23" ry="20" fill="url(#phxFur)"/>' +
        // Tabby stripes.
        '<path d="M32 12 L32 20" stroke="#c9641f" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M24 14 L26.5 21" stroke="#c9641f" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M40 14 L37.5 21" stroke="#c9641f" stroke-width="3" stroke-linecap="round"/>' +
        // Muzzle.
        '<ellipse cx="32" cy="39" rx="13" ry="9" fill="url(#phxMuzzle)"/>' +
        // Eyes.
        '<ellipse cx="23.5" cy="29" rx="4.2" ry="4.8" fill="#2b1a12"/>' +
        '<ellipse cx="40.5" cy="29" rx="4.2" ry="4.8" fill="#2b1a12"/>' +
        '<circle cx="25" cy="27.2" r="1.5" fill="#fff"/>' +
        '<circle cx="42" cy="27.2" r="1.5" fill="#fff"/>' +
        // Nose and mouth.
        '<path d="M29 35 L35 35 L32 38.5 Z" fill="#e0674f"/>' +
        '<path d="M32 38.5 L32 41 M32 41 Q28.5 43.5 26 41 M32 41 Q35.5 43.5 38 41" ' +
        'stroke="#8a4a2a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
        // Whiskers.
        '<g stroke="#fff1de" stroke-width="1.4" stroke-linecap="round" opacity=".95">' +
        '<path d="M20 37 L7 34"/><path d="M20 40 L7 41"/>' +
        '<path d="M44 37 L57 34"/><path d="M44 40 L57 41"/>' +
        '</g>' +
        '</svg>'
    }
  ];

  var BY_ID = {};
  var SHORT_INDEX = {};
  CARDS.forEach(function (card) {
    BY_ID[card.id] = card;
    SHORT_INDEX[card.short.toLowerCase()] = card.id;
  });

  return {
    CARDS: CARDS,
    EVIL_CARDS: EVIL_CARDS,

    /** Returns a card object, or null when the id is unknown. */
    byId: function (id) {
      return (id && BY_ID[id]) || null;
    },

    /** Every card id, including the legendary one. */
    ids: function () {
      return CARDS.map(function (card) { return card.id; });
    },

    /**
     * Cards that can appear in the draw deck.
     *
     * Phoenix is deliberately excluded. It is never dealt, never drawn, and
     * never shuffled back in from the discard: CARDS is the full catalogue, this
     * is the set the deck is built from.
     */
    deckCards: function () {
      return CARDS.filter(function (card) { return card.inDeck !== false; });
    },

    deckIds: function () {
      return CARDS.filter(function (card) {
        return card.inDeck !== false;
      }).map(function (card) { return card.id; });
    },

    /** Zombie, Knife and Steal Points are the ones Judge counts. */
    isEvil: function (cardId) {
      return EVIL_CARDS.indexOf(cardId) !== -1;
    },

    /** The id of the single legendary card, for code that needs to name it. */
    legendaryId: function () {
      var legendary = CARDS.filter(function (card) { return card.legendary; });
      return legendary.length ? legendary[0].id : null;
    },

    /** Accepts an id, the short name or the display name, case-insensitively. */
    resolve: function (nameOrId) {
      if (!nameOrId) return null;
      var key = String(nameOrId).trim().toLowerCase();
      if (BY_ID[key]) return BY_ID[key];
      for (var i = 0; i < CARDS.length; i++) {
        if (CARDS[i].name.toLowerCase() === key) return CARDS[i];
      }
      return SHORT_INDEX[key] ? BY_ID[SHORT_INDEX[key]] : null;
    }
  };
});