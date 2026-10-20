/* PHOENIX - the rules.
 *
 * How the game is won, and what every card in the game does. The owner-only
 * cards are not here, and neither are the allies' real names: this is the
 * page anybody may read.
 */
'use strict';

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var Cards = window.PhoenixCards;
  if (!Cards) return;

  function ruleCards() {
    // Every card a public lobby can deal, and no owner-only card.
    return Cards.CARDS.filter(function (card) {
      return !card.ownerOnly && card.inDeck !== false && card.id !== 'phoenix';
    });
  }

  function text(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function build() {
    var win = $('rules-win');
    if (win) {
      win.replaceChildren();
      win.appendChild(text('p', 'rules-win-line', 'The game is won on POINTS.'));
      win.appendChild(text('p', 'rules-win-line', 'Every round, the points you have are the points you keep. At the end of the match, whoever has the most points wins the match - and the second place, third place and so on are ranked by points too.'));
      win.appendChild(text('p', 'rules-win-line', 'There is no elimination that ends a match early: a player who is out for a round simply sits that round out and comes back. A player who is out for good stays out, but the match still runs to the end, and the points still count.'));
      win.appendChild(text('p', 'rules-win-line', 'A tie is a tie: everybody tied shares the placing, and the table log says so.'));
    }

    var list = $('rules-cards');
    if (!list) return;
    list.replaceChildren();
    ruleCards().forEach(function (card) {
      var row = document.createElement('article');
      row.className = 'rules-card';
      var head = document.createElement('div');
      head.className = 'rules-card-head';
      head.appendChild(text('h3', 'rules-card-name', card.name));
      if (card.kind && card.kind !== 'neutral') {
        head.appendChild(text('span', 'rules-card-kind', card.kind.toUpperCase()));
      }
      row.appendChild(head);
      if (card.secret) {
        // A SECRET card is listed, so the deck is honest, but what it does is
        // not written down here. Finding out is the game.
        row.appendChild(text('p', 'rules-card-secret', 'Its effect is a secret.'));
        list.appendChild(row);
        return;
      }
      row.appendChild(text('p', 'rules-card-blurb', card.blurb || ''));
      row.appendChild(text('p', 'rules-card-rule', card.rule || ''));
      if (card.targetNote) {
        row.appendChild(text('p', 'rules-card-target', 'Target: ' + card.targetNote));
      }
      list.appendChild(row);
    });

    var count = $('rules-count');
    if (count) {
      count.textContent = ruleCards().length + ' cards are in the deck.';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
