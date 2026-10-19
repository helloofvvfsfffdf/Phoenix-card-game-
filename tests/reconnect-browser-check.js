/* Load on the isolated other-cards-browser-check.html page. Real client UI,
 * real socket close/reconnect; no injected snapshots or gameplay messages. */
(function () {
  'use strict';
  window.runReconnectBrowserChecks = async function () {
    const results = [];
    function check(name, value) { results.push({ name, passed: !!value }); if (!value) throw new Error(name); }
    async function wait(predicate) {
      const end = Date.now() + 12000;
      while (!predicate()) {
        if (Date.now() > end) throw new Error('Browser reconnect condition timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    try {
      await window.createManualCardTestMatch(4);
      const frames = [...document.querySelectorAll('iframe')];
      const states = () => frames.map(f => f.contentWindow.PhoenixOnline.getState());
      const original = states();
      const w = frames[0].contentWindow, oldSocket = w.ws;
      oldSocket.close();
      await wait(() => states()[1].paused);
      check('remaining players see the pause', frames[1].contentDocument.getElementById('online-phase').textContent.includes('PAUSED'));
      check('paused clients have no card actions', !frames[1].contentDocument.querySelector('#online-actions button'));
      await wait(() => w.ws && w.ws !== oldSocket && states().every(s => s && !s.paused));
      check('automatic reconnect restores the original room and seat', states().every((s, i) => s.code === original[i].code && s.seat === original[i].seat));
      check('automatic reconnect preserves hands and scores', states().every((s, i) => JSON.stringify(s.hand) === JSON.stringify(original[i].hand) && JSON.stringify(s.players.map(p => p.points)) === JSON.stringify(original[i].players.map(p => p.points))));
      const actor = frames.find(f => f.contentWindow.PhoenixOnline.getState().acting);
      const cardName = actor.contentWindow.PhoenixCards.byId('impostor').name;
      [...actor.contentDocument.querySelectorAll('#online-actions button')].find(b => b.textContent.includes(cardName)).click();
      await wait(() => states().every(s => s.pendingInteraction?.type === 'impostor'));
      const first = frames[0];
      first.contentDocument.getElementById('impostor-clue-input').value = 'original clue';
      first.contentDocument.getElementById('impostor-submit-clue').click();
      await wait(() => states()[0].pendingInteraction.submitted.length === 1);
      const word = states()[0].pendingInteraction.roundData.myWord;
      const previousDocument = first.contentDocument;
      first.contentWindow.location.reload();
      await wait(() => first.contentDocument !== previousDocument && first.contentWindow.PhoenixOnline && first.contentWindow.PhoenixAccount);
      await wait(() => states().every(s => s?.pendingInteraction?.type === 'impostor' && !s.paused));
      check('automatic refresh recovery preserves the private word', states()[0].pendingInteraction.roundData.myWord === word);
      check('a restored submitted clue stays locked', first.contentDocument.getElementById('impostor-clue-input').disabled && first.contentDocument.getElementById('impostor-submit-clue').disabled);
      check('clue deadline is visible', first.contentDocument.getElementById('impostor-timer').textContent.includes('remaining'));
      for (const frame of frames.slice(1)) {
        frame.contentDocument.getElementById('impostor-clue-input').value = 'another clue';
        frame.contentDocument.getElementById('impostor-submit-clue').click();
      }
      await wait(() => states().every(s => s.pendingInteraction?.phase === 'vote'));
      check('voting gets a fresh phase deadline', states()[0].pendingInteraction.deadlineAt > Date.now() + 55000);
      check('original clue remains public after refresh', first.contentDocument.getElementById('impostor-clues').textContent.includes('original clue'));
      for (const frame of frames) frame.contentDocument.querySelector('.impostor-vote-btn').click();
      await wait(() => states().every(s => !s.pendingInteraction));
      check('real UI ballots complete the resumed round', true);
    } catch (error) { results.push({ name: 'browser flow completes', passed: false, error: error.message }); }
    finally {
      for (const frame of document.querySelectorAll('iframe')) {
        try { frame.contentWindow.PhoenixOnline.leave(); } catch (_) {}
      }
      document.getElementById('players').replaceChildren();
    }
    window.reconnectBrowserReport = { passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
    document.getElementById('results').textContent = JSON.stringify(window.reconnectBrowserReport, null, 2);
    return window.reconnectBrowserReport;
  };
})();
