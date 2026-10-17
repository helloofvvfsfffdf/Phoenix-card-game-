/* PHOENIX — Interactive minigame overlays (Stage 3)
 *
 * These appear when room.pendingInteraction is set. They send `interact` messages
 * to the server, which validates, resolves, and broadcasts results.
 *
 * Each card's overlay is a standalone component, loaded only when needed,
 * with no impact on existing cards, allies, or menus.
 */
(function () {
  'use strict';
  var overlay = null;

  function show(cardId) {
    // Hide any existing interactive overlay.
    if (overlay) overlay.hidden = true;

    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay';
    overlay.id = 'interactive-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true">' +
      '  <h2>' + (cardId === 'dice' ? 'Dice Challenge' :
                    cardId === 'rps' ? 'Rock Paper Scissors' :
                    cardId === 'betrayal' ? 'Betrayal' :
                    cardId === 'speed' ? 'Speed Challenge' :
                    cardId === 'wheel' ? 'Wheel of Fortune' :
                    cardId === 'linkedfate' ? 'Linked Fate' :
                    cardId === 'impostor' ? 'Impostor' :
                    cardId === 'swapper' ? 'Ally Swapper' : 'Interactive') + '</h2>' +
      '  <p id="interactive-instruction">Make your choice.</p>' +
      '  <div id="interactive-controls"></div>' +
      '  <p id="interactive-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
  }

  function hide() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
  }

  function send(decision) {
    if (window.ws && window.ws.readyState === 1) {
      window.ws.send(JSON.stringify({
        type: 'interact',
        decision: decision
      }));
    }
  }

  // Public hook for online-client to open/close.
  window.PhoenixInteractive = {
    open: function (cardId) { show(cardId); },
    close: function () { hide(); },
    send: send
  };
})();
