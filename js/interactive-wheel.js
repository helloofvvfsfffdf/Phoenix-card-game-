/* PHOENIX — Wheel of Fortune interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay wheel-overlay';
    overlay.id = 'wheel-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Wheel of Fortune">' +
      '  <h2>Wheel of Fortune</h2>' +
      '  <div class="wheel-graphic" aria-label="Spinning wheel with nine segments">' +
      '    <div class="wheel-segment s1"></div><div class="wheel-segment s2"></div>' +
      '    <div class="wheel-segment s3"></div><div class="wheel-segment s4"></div>' +
      '    <div class="wheel-segment s5"></div><div class="wheel-segment s6"></div>' +
      '    <div class="wheel-segment s7"></div><div class="wheel-segment s8"></div>' +
      '    <div class="wheel-segment s9"></div>' +
      '  </div>' +
      '  <button type="button" id="wheel-spin" class="primary">Spin the Wheel</button>' +
      '  <p id="wheel-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    document.getElementById('wheel-spin').onclick = () => submit();
  }
  function submit() {
    document.getElementById('wheel-spin').disabled = true;
    document.getElementById('wheel-feedback').textContent = 'Spinning…';
    if (window.ws && window.ws.readyState === 1) {
      window.ws.send(JSON.stringify({ type: 'interact', decision: 'spin' }));
    }
  }
  function onState(msg) {
    if (msg.pendingInteraction && msg.pendingInteraction.type === 'wheel') {
      document.getElementById('wheel-feedback').textContent = 'The wheel is turning…';
      return;
    }
    if (msg.events && msg.events.some(e => e.type === 'result' && e.cardId === 'wheel')) {
      const text = msg.events.find(e => e.type === 'result' && e.cardId === 'wheel').text;
      document.getElementById('wheel-feedback').textContent = text || 'Wheel result.';
      setTimeout(() => { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }, 6000);
    }
  }
  window.PhoenixWheelInteractive = { build: build, close: () => { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }, onState: onState };
})();
