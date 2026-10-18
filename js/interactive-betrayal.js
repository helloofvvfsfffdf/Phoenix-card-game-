/* PHOENIX — Betrayal interactive minigame */
(function () {
  'use strict';
  var overlay = null;

  function build() {
    if (overlay && document.body.contains(overlay)) {
      overlay.hidden = false;
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay betrayal-overlay';
    overlay.id = 'betrayal-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Betrayal">' +
      '  <h2>Betrayal</h2>' +
      '  <p>Both opponents secretly choose Share or Steal.</p>' +
      '  <div class="betrayal-choices">' +
      '    <button id="betrayal-share" type="button" class="betrayal-btn share-btn">✦ Share</button>' +
      '    <button id="betrayal-steal" type="button" class="betrayal-btn steal-btn">☠ Steal</button>' +
      '  </div>' +
      '  <div class="betrayal-reveal" id="betrayal-reveal" hidden>' +
      '    <div class="betrayal-both"></div>' +
      '    <p id="betrayal-result"></p>' +
      '  </div>' +
      '  <p id="betrayal-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    document.getElementById('betrayal-share').onclick = () => submit('share');
    document.getElementById('betrayal-steal').onclick = () => submit('steal');
  }

  function submit(decision) {
    var shareBtn = document.getElementById('betrayal-share');
    var stealBtn = document.getElementById('betrayal-steal');
    shareBtn.disabled = true;
    stealBtn.disabled = true;

    if (window.gsap) {
      var btn = document.getElementById('betrayal-' + decision);
      if (btn) {
        window.gsap.to(btn, {scale: 1.1, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out'});
      }
    }

    document.getElementById('betrayal-feedback').textContent = 'Choice locked. Waiting for both opponents.';
    if (window.ws && window.ws.readyState === 1) window.ws.send(JSON.stringify({ type: 'interact', decision: decision }));
  }

  function revealBoth(choice1, choice2, result) {
    var reveal = document.getElementById('betrayal-reveal');
    if (!reveal) return;
    reveal.hidden = false;

    var emoji = {share: '✦', steal: '☠'};
    reveal.querySelector('.betrayal-both').innerHTML =
      '<span class="betrayal-pill betrayal-actor">' + (emoji[choice1] || '?') + ' ' + choice1 + '</span>' +
      '<span class="betrayal-pill betrayal-target">' + (emoji[choice2] || '?') + ' ' + choice2 + '</span>';

    document.getElementById('betrayal-result').textContent = result || 'Betrayal resolved.';

    if (window.gsap) {
      var both = reveal.querySelector('.betrayal-both');
      window.gsap.from(both.children, {opacity: 0, y: 20, duration: 0.4, stagger: 0.1, ease: 'power2.out'});
    }

    setTimeout(() => { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }, 6000);
  }

  function onState(msg) {
    if (msg.pendingInteraction && msg.pendingInteraction.type === 'betrayal') { return; }
    if (msg.events && msg.events.some(e => e.type === 'result' && e.cardId === 'betrayal')) {
      const text = msg.events.find(e => e.type === 'result' && e.cardId === 'betrayal').text;
      revealBoth('share', 'steal', text); // We don't know their actual choices from text alone
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
  }

  window.PhoenixBetrayalInteractive = { build: build, close: close, onState: onState };
})();