/* Local-only presentation around the real game controls. No gameplay decisions. */
(function () {
  'use strict';
  const create = document.getElementById('create');
  const tabs = document.getElementById('player-tabs');
  let frames = [], selected = -1, timer;
  function state(frame) { return frame.contentWindow.PhoenixOnline.getState(); }
  function needsInput(s) {
    if (!s) return false;
    const pi = s.pendingInteraction;
    if (!pi) return s.acting;
    const id = s.players[s.seat].id;
    return pi.participants.includes(id) && !(pi.submitted || []).includes(id) && (pi.type !== 'wheel' || pi.actorId === id);
  }
  function select(index) {
    selected = index;
    frames.forEach((frame, i) => frame.classList.toggle('selected-player', i === index));
    [...tabs.children].forEach((button, i) => button.setAttribute('aria-selected', String(i === index)));
    frames[index].contentWindow.scrollTo(0, 0);
  }
  function update() {
    const waiting = [];
    frames.forEach((frame, index) => {
      const s = state(frame), ready = needsInput(s);
      const button = tabs.children[index];
      button.textContent = 'Player ' + (index + 1) + (ready ? (s.pendingInteraction ? ' · CHOOSE' : ' · PLAY A CARD') : ' · watching');
      button.classList.toggle('needs-input', ready);
      if (ready) waiting.push(index + 1);
    });
    const s = frames[selected] && state(frames[selected]);
    document.getElementById('turn-help').textContent = !s ? '' : s.over ? 'Match complete.' : waiting.length
      ? (waiting.includes(selected + 1) ? 'You control Player ' + (selected + 1) + ': ' + (s.pendingInteraction ? 'answer the card prompt below.' : 'click a card below, then choose a target if asked.')
        : 'Switch to ' + waiting.map(i => 'Player ' + i).join(' or ') + ' above to continue.')
      : 'Waiting for the server. Speed players: wait for GO before reacting.';
  }
  create.onclick = async function () {
    create.disabled = true;
    clearInterval(timer);
    tabs.replaceChildren();
    document.getElementById('turn-help').textContent = '';
    document.getElementById('results').textContent = 'Preparing players, opening dice and ally draft…';
    try {
      const room = await createManualCardTestMatch(Number(document.getElementById('count').value));
      frames = [...document.querySelectorAll('#players iframe')];
      frames.forEach((frame, i) => {
        const d = frame.contentDocument;
        // Put the actual controls first instead of beneath the room roster/log.
        const actions = d.getElementById('online-actions');
        d.getElementById('online-room').prepend(actions.parentElement);
        const style = d.createElement('style');
        style.textContent = '.online-shell{max-width:none!important;padding:12px!important}.online-top{display:none!important}.online-card-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(155px,1fr))!important;gap:12px!important}';
        d.head.appendChild(style);
        const button = document.createElement('button');
        button.type = 'button';
        button.onclick = () => { select(i); update(); };
        tabs.appendChild(button);
      });
      const actor = frames.findIndex(frame => state(frame).acting);
      select(actor < 0 ? 0 : actor);
      update();
      timer = setInterval(update, 250);
      document.getElementById('results').textContent = 'Room ' + room.code + ' · practice only · click the green-labelled player tabs when input is needed.';
    } catch (error) {
      document.getElementById('results').textContent = 'Could not prepare the room: ' + error.message;
    } finally { create.disabled = false; }
  };
  document.getElementById('stop').onclick = () => location.reload();
})();
