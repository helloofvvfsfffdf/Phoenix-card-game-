/* LOCAL TEST PAGE ONLY: drives the real loaded game UI, no mocked snapshots,
 * result injection, server endpoints or direct gameplay ws.send calls. */
(function () {
  'use strict';
  const results = [];
  const clients = [];
  const output = document.getElementById('results');
  const cards = ['rps', 'betrayal', 'dice', 'speed', 'wheel', 'linkedfate', 'swapper', 'impostor'];
  let activeCard = '';
  let running = false;
  function render() { output.textContent = results.map(r => (r.passed ? 'PASS ' : 'FAIL ') + '[' + r.card + '] ' + r.name + (r.error ? ': ' + r.error : '')).join('\n'); }
  function check(name, condition, error) {
    results.push({ card: activeCard, name, passed: !!condition, ...(condition ? {} : { error: error || 'assertion failed' }) });
    render();
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function wait(predicate, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      const timer = setInterval(() => {
        try {
          if (predicate()) { clearInterval(timer); resolve(); }
          else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Browser state condition timed out')); }
        } catch (error) { clearInterval(timer); reject(error); }
      }, 10);
    });
  }
  function state() { return clients[0].state; }
  function byId(id) { return clients.find(c => c.state.players[c.state.seat].id === id); }
  function node(client, selector) { return client.frame.contentDocument.querySelector(selector); }
  function buttons(client, selector) { return [...client.frame.contentDocument.querySelectorAll(selector)]; }
  async function click(client, button) {
    assert(button && !button.disabled && !button.hidden, 'required UI button is missing, hidden or disabled');
    const revisions = clients.map(c => c.revision);
    const errors = client.errors.length;
    button.click();
    await wait(() => {
      if (client.errors.length > errors) throw new Error('UI decision rejected: ' + client.errors.at(-1));
      return clients.every((c, i) => c.revision > revisions[i]);
    });
  }
  async function setup(playerCount = 5) {
    clients.splice(0);
    document.getElementById('players').replaceChildren();
    for (let i = 0; i < playerCount; i++) {
      const frame = document.createElement('iframe');
      frame.title = 'Test player ' + (i + 1);
      frame.src = '/?other-card-browser=' + activeCard + '-' + i;
      // A newly requested fixture is intentionally a new room. Clear only this
      // fixture tab key BEFORE loading; normal refresh still exercises resume.
      try { sessionStorage.removeItem('phoenix-online-resume:' + new URL(frame.src).pathname + new URL(frame.src).search); } catch (_) {}
      document.getElementById('players').appendChild(frame);
      // Do not wait forever for decorative media/network requests to finish.
      await wait(() => frame.contentDocument.readyState !== 'loading' && frame.contentWindow.PhoenixOnline, 20000);
      const w = frame.contentWindow;
      assert(w.PhoenixOnline && w.PhoenixOnline.getState, 'real online client did not load');
      // Do not enter before the asynchronous account probe finishes: its initial
      // state assumes accounts are enabled and would leave a login modal on top
      // of the practice room even though this fixture has no account backend.
      await wait(() => w.PhoenixAccount && w.PhoenixAccount.refresh, 10000);
      await w.PhoenixAccount.refresh();
      assert(w.PhoenixAccount.available() === false, 'This page requires the isolated, account-free local fixture');
      if (w.PhoenixOpeningCinematic) w.PhoenixOpeningCinematic.stop();
      w.PhoenixOnline.leave(); // New fixture room, not a saved seat from an earlier run.
      const client = { frame, state: null, revision: 0, errors: [], browserErrors: [], frames: [] };
      clients.push(client);
      w.addEventListener('error', e => client.browserErrors.push(e.message));
      w.addEventListener('unhandledrejection', e => client.browserErrors.push(String(e.reason)));
      w.PhoenixOnline.enter();
      assert(!w.document.getElementById('account-overlay') || w.document.getElementById('account-overlay').hidden,
        'Sign-in overlay must not block the local practice game');
      if (i === 0) w.PhoenixOnline.join('create');
      else w.PhoenixOnline.join({ type: 'join', code: state().code });
      assert(w.ws, 'real WebSocket was not created');
      w.ws.addEventListener('message', event => {
        const msg = JSON.parse(event.data);
        client.frames.push(msg);
        if (msg.type === 'state') { client.state = msg; client.revision++; }
        if (msg.type === 'error') client.errors.push(msg.message);
      });
      await wait(() => clients.every(c => c.state && c.state.players.length === i + 1));
    }
    viewportFit('seat lobby');
    await click(clients[0], buttons(clients[0], '#online-actions button').find(b => b.textContent === 'START MATCH'));
    let guard = 0;
    while (['turnDice', 'allyDice'].includes(state().phase)) {
      assert(++guard < 150, 'startup dice did not terminate');
      const client = clients.find(c => c.state.seat === state().dice.next);
      await click(client, node(client, '#online-actions button'));
    }
    while (state().phase === 'draft') {
      const client = clients.find(c => c.state.seat === state().draftTurn);
      await click(client, node(client, '#online-actions .online-draft-choice'));
    }
    assert(state().phase === 'playing' && state().players.length === playerCount, 'requested match did not start');
    viewportFit('match table');
  }
  async function play(card) {
    const actor = clients.find(c => c.state.acting);
    const name = actor.frame.contentWindow.PhoenixCards.byId(card).name;
    const move = actor.state.moves.find(m => m.cardId === card);
    assert(move, card + ' is not offered in the fixture');
    const before = state();
    const revisions = clients.map(c => c.revision);
    const cardButton = buttons(actor, '#online-actions button').find(b => b.textContent.includes(name));
    assert(cardButton, 'actual card button missing: ' + name);
    cardButton.click();
    if (move.targetId) {
      const targetButton = node(actor, '#online-actions .online-primary');
      assert(targetButton, 'target picker missing'); targetButton.click();
    }
    await wait(() => clients.every((c, i) => c.revision > revisions[i]));
    if (card === 'stealturn') {
      assert(state().pending?.kind === 'move', 'stolen turn did not reach the target');
      return { actor, before };
    }
    assert(state().pendingInteraction && state().pendingInteraction.type === card, 'card did not enter its interaction');
    return { actor: byId(state().pendingInteraction.actorId), before, pi: state().pendingInteraction };
  }
  function spectatorsCannotDecide(pi, selector) {
    const spectators = clients.filter(c => !pi.participants.includes(c.state.players[c.state.seat].id));
    check('spectators have no active decision controls', spectators.every(c => buttons(c, selector).every(button => button.hidden || button.disabled || !button.getClientRects().length)));
  }
  function ended(played) {
    check('interaction completes and the turn advances for all five players', clients.every(c => !c.state.pendingInteraction && c.state.current !== played.before.current));
    check('no browser exceptions or rejected UI decisions', clients.every(c => !c.browserErrors.length && !c.errors.length), clients.flatMap(c => c.browserErrors.concat(c.errors)).join('; '));
    check('all hand snapshots remain duplicate-free', clients.every(c => c.frames.filter(f => f.type === 'state').every(f => new Set(f.hand).size === f.hand.length)));
  }
  async function inCardResult(selector) {
    function visible() { return clients.some(c => {
      const result = node(c, selector);
      const text = result && result.textContent.trim();
      const isResult = selector === '#dice-feedback' ? /rolled.*(win|tie)/i.test(text || '')
        : selector === '#impostor-feedback' ? /impostor.*(caught|escaped|complete)/i.test(text || '') : !!text;
      return result && !result.hidden && result.getClientRects().length && isResult;
    }); }
    // Allow the existing dice animation to finish, if one was actually started.
    await wait(visible, 1800).catch(() => {});
    check('in-card result/reveal remains visible after resolution', visible(), 'overlay closed without showing its result/reveal');
    viewportFit('result of ' + activeCard);
  }
  /* Phone-width layout gate.

     Runs on every client for a real overlay state: the frame document, the
     overlay shell and every visible control must fit the viewport horizontally,
     and each control must hold a 44px touch target. The assertions are
     viewport-agnostic, so the same flow proves the layout inside the 380px
     desktop fixture frame and inside a mobile-emulated phone frame. */
  function viewportFit(tag) {
    for (const [index, c] of clients.entries()) {
      const win = c.frame.contentWindow;
      const doc = win.document;
      const player = ' (player ' + (index + 1) + ')';
      const scrollWidth = doc.documentElement.scrollWidth;
      check('frame does not scroll sideways — ' + tag + player, scrollWidth <= win.innerWidth + 1,
        'document scrollWidth ' + scrollWidth + ' exceeds viewport ' + win.innerWidth);
      const shell = doc.querySelector('.interactive-shell');
      if (!shell || !shell.getClientRects().length) continue;
      const rect = shell.getBoundingClientRect();
      check('overlay shell fits the frame — ' + tag + player,
        rect.left >= -1 && rect.right <= win.innerWidth + 1 && shell.scrollWidth <= shell.clientWidth + 1,
        'shell spans ' + Math.round(rect.left) + '–' + Math.round(rect.right) + ' of ' + win.innerWidth +
          ', shell scrollWidth ' + shell.scrollWidth + '/' + shell.clientWidth);
      const controls = [...shell.querySelectorAll('button, input, select')].filter(el => el.getClientRects().length);
      const outside = controls.filter(el => {
        const r = el.getBoundingClientRect();
        return r.left < -2 || r.right > win.innerWidth + 2;
      });
      check('every overlay control stays inside the frame — ' + tag + player, outside.length === 0,
        outside.map(el => (el.id || el.textContent.trim().slice(0, 24) || el.tagName) + ' spans ' +
          Math.round(el.getBoundingClientRect().left) + '–' + Math.round(el.getBoundingClientRect().right) +
          ' of ' + win.innerWidth).join('; '));
      const small = controls.filter(el => el.getBoundingClientRect().height < 43.5);
      check('every overlay control holds a 44px touch target — ' + tag + player, small.length === 0,
        small.map(el => (el.id || el.textContent.trim().slice(0, 24) || el.tagName) + ' is ' +
          Math.round(el.getBoundingClientRect().height) + 'px tall').join('; '));
    }
  }
  async function runCard(card) {
    await setup();
    if (new URLSearchParams(location.search).has('forced')) await play('stealturn');
    const played = await play(card);
    const pi = played.pi;
    const ids = pi.participants;
    viewportFit('opened ' + card);
    const controls = {
      rps: '.rps-btn', betrayal: '.betrayal-btn', dice: '#dice-roll-btn', speed: '#speed-ready-btn',
      linkedfate: '#linkedfate-ack', swapper: '#swapper-ack', wheel: '#wheel-spin', impostor: '#impostor-submit-clue'
    };
    if (card !== 'wheel' && card !== 'impostor') spectatorsCannotDecide(pi, controls[card]);
    if (card === 'rps' || card === 'betrayal') {
      if (card === 'rps') {
        for (const id of ids) await click(byId(id), node(byId(id), '#rps-rock'));
        check('tied RPS stays on the same turn without eliminating anyone',
          state().pendingInteraction?.type === 'rps' && state().current === played.before.current && state().players.every(p => !p.eliminated));
        check('both tied players can choose again', ids.every(id => !node(byId(id), '#rps-paper').disabled));
      }
      const selectors = card === 'rps' ? ['#rps-rock', '#rps-scissors'] : ['#betrayal-share', '#betrayal-share'];
      for (let i = 0; i < ids.length; i++) await click(byId(ids[i]), node(byId(ids[i]), selectors[i]));
      ended(played);
      if (card === 'betrayal') check('Share/Share pays both opponents exactly 10,000', ids.every(id => state().players.find(p => p.id === id).points === 10000));
      await inCardResult(card === 'rps' ? '#rps-result' : '#betrayal-result');
    } else if (card === 'dice') {
      if (new URLSearchParams(location.search).has('diceTie')) {
        for (const id of ids) await click(byId(id), node(byId(id), '#dice-roll-btn'));
        check('tied dice keep the interaction active without a prize', state().pendingInteraction?.type === 'dice' && state().players.every(p => p.points === 0));
        check('tied dice unlock both Roll buttons', ids.every(id => !node(byId(id), '#dice-roll-btn').disabled));
      }
      await click(byId(ids[0]), node(byId(ids[0]), '#dice-roll-btn'));
      check('Roll stays locked after the server acknowledges the first roll', node(byId(ids[0]), '#dice-roll-btn').disabled, 'server snapshot re-enabled a submitted roll');
      await click(byId(ids[1]), node(byId(ids[1]), '#dice-roll-btn'));
      // A natural tie (1 in 6) makes the server re-roll: the interaction stays
      // active with no prize and both Roll buttons unlock for the retry.
      let diceRetries = 0;
      while (state().pendingInteraction?.type === 'dice') {
        assert(++diceRetries < 5, 'dice tie re-rolls did not resolve');
        check('a natural tie re-rolls with no prize paid',
          state().players.every(p => p.points === 0) && ids.every(id => !node(byId(id), '#dice-roll-btn').disabled),
          'tied dice did not unlock both Roll buttons');
        await click(byId(ids[0]), node(byId(ids[0]), '#dice-roll-btn'));
        await click(byId(ids[1]), node(byId(ids[1]), '#dice-roll-btn'));
      }
      ended(played);
      check('one roller receives the 20,000-point prize', state().players.reduce((sum, p) => sum + p.points, 0) === 20000);
      await inCardResult('#dice-feedback');
    } else if (card === 'speed') {
      for (const id of ids) await click(byId(id), node(byId(id), '#speed-ready-btn'));
      // The GO moment is server-owned: the private countdown is 4–6 seconds.
      await wait(() => state().pendingInteraction?.type === 'speed' && state().pendingInteraction.phase === 'react', 15000);
      check('the GO control only becomes pressable after the server ends its private countdown',
        ids.every(id => !node(byId(id), '#speed-go-btn').hidden && node(byId(id), '#speed-go-btn').textContent === 'GO!'),
        'GO button did not reach its react state in every participant frame');
      viewportFit('speed GO');
      for (const id of ids) await click(byId(id), node(byId(id), '#speed-go-btn'));
      ended(played);
      check('clean reactions from both players award exactly the 15,000-point prize',
        state().players.reduce((sum, p) => sum + p.points, 0) === 15000);
      await inCardResult('#speed-feedback');
    } else if (card === 'wheel') {
      check('only the caster has an active Spin button', clients.filter(c => c !== played.actor).every(c => node(c, '#wheel-spin').hidden || node(c, '#wheel-spin').disabled));
      await click(played.actor, node(played.actor, '#wheel-spin'));
      check('caster spin finishes without nonexistent acknowledgment controls', clients.every(c => !c.state.pendingInteraction), 'interaction is still ' + state().pendingInteraction?.phase);
      check('a confirmed outcome reaches the browser', clients.every(c => c.frames.some(f => f.lastInteractionResult?.type === 'wheel' && f.lastInteractionResult.roundData.outcome)));
    } else if (card === 'linkedfate' || card === 'swapper') {
      for (const id of ids) await click(byId(id), node(byId(id), controls[card]));
      ended(played);
      viewportFit(card + ' result');
      if (card === 'swapper') {
        const before = Object.fromEntries(played.before.players.map(p => [p.id, p.ally]));
        check('actual drafted allies are exchanged', state().players.find(p => p.id === pi.actorId).ally === before[pi.targetId] && state().players.find(p => p.id === pi.targetId).ally === before[pi.actorId]);
      } else {
        clients.forEach(c => {
          const dismiss = buttons(c, '.interactive-overlay button').find(b => b.textContent === 'Continue');
          if (dismiss) dismiss.click();
        });
        for (let guard = 0; state().current !== pi.targetId && guard < 5; guard++) {
          const next = clients.find(c => c.state.acting);
          await click(next, buttons(next, '#online-actions button').find(b => b.textContent.includes('+10,000 Points')));
        }
        const actor = clients.find(c => c.state.acting);
        const bonus = buttons(actor, '#online-actions button').find(b => b.textContent.includes('+10,000 Points'));
        assert(state().current === pi.targetId, 'linked partner must get a turn');
        await click(actor, bonus);
        check('a normal point gain shares 50% with the linked partner', state().players.find(p => p.id === pi.actorId).points === 5000 && state().players.find(p => p.id === pi.targetId).points === 10000);
      }
    } else if (card === 'impostor') {
      const words = clients.map(c => c.state.pendingInteraction.roundData.myWord);
      check('each player sees only their own word on screen', clients.every(c => node(c, '#impostor-words').textContent === 'Your word: ' + c.state.pendingInteraction.roundData.myWord));
      const counts = {}; words.forEach(word => { counts[word] = (counts[word] || 0) + 1; });
      const impostor = clients.find(c => counts[c.state.pendingInteraction.roundData.myWord] === 1);
      assert(impostor, 'fixture word assignment has no minority');
      const impostorId = impostor.state.players[impostor.state.seat].id;
      const draftClient = byId(ids.at(-1));
      node(draftClient, '#impostor-clue-input').value = 'UNSENT DRAFT';
      node(byId(ids[0]), '#impostor-clue-input').value = 'clue-' + ids[0];
      await click(byId(ids[0]), node(byId(ids[0]), '#impostor-submit-clue'));
      check('another player submitting does not erase an unfinished clue', node(draftClient, '#impostor-clue-input').value === 'UNSENT DRAFT');
      check('submitted clue stays locked after acknowledgment', node(byId(ids[0]), '#impostor-submit-clue').disabled);
      for (const id of ids.slice(1)) {
        node(byId(id), '#impostor-clue-input').value = 'clue-' + id;
        await click(byId(id), node(byId(id), '#impostor-submit-clue'));
      }
      check('all public clues are displayed during voting', clients.every(c => ids.every(id => node(c, '#impostor-clues').textContent.includes('clue-' + id))));
      viewportFit('impostor ballots');
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const target = id === impostorId ? ids.find(other => other !== id) : impostorId;
        const voter = byId(id);
        await click(voter, buttons(voter, '.impostor-vote-btn').find(b => b.dataset.vote === target));
        if (i === 0) check('a submitted vote stays locked after acknowledgment', buttons(voter, '.impostor-vote-btn').every(b => b.disabled));
      }
      ended(played);
      check('catching the impostor pays only the four others 10,000', state().players.every(p => p.points === (p.id === impostorId ? 0 : 10000)));
      await inCardResult('#impostor-feedback');
    }
  }
  async function run(selectedCards) {
    if (running) return;
    assert(location.hostname === '127.0.0.1' || location.hostname === 'localhost', 'Run only against a local disposable fixture');
    running = true;
    results.splice(0);
    document.getElementById('run').disabled = true;
    window.otherCardBrowserStatus = { running: true, results };
    try {
      for (const card of Array.isArray(selectedCards) ? selectedCards.filter(card => cards.includes(card)) : cards) {
        activeCard = card;
        output.textContent += '\nStarting ' + card + '…';
        try { await runCard(card); }
        catch (error) { check('browser flow completes', false, error.message); }
        finally {
          for (const client of clients) {
            try { client.frame.contentWindow.PhoenixOnline.leave(); } catch (_) { /* test cleanup */ }
          }
        }
      }
    } finally {
      running = false;
      window.otherCardBrowserStatus = { running: false, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
      render();
      document.getElementById('run').disabled = false;
    }
    return window.otherCardBrowserStatus;
  }
  window.runOtherCardBrowserChecks = run;
  window.createManualCardTestMatch = async function (playerCount) {
    assert(location.hostname === '127.0.0.1' || location.hostname === 'localhost', 'Local fixtures only');
    assert(Number.isInteger(playerCount) && playerCount >= 2 && playerCount <= 5, 'Choose 2–5 players');
    assert(!running, 'A room is already being prepared');
    running = true;
    try {
      clients.forEach(client => { try { client.frame.contentWindow.PhoenixOnline.leave(); } catch (_) {} });
      activeCard = 'manual';
      await setup(playerCount);
      return { code: state().code, players: playerCount };
    } finally { running = false; }
  };
  if (document.getElementById('run')) document.getElementById('run').onclick = run;
})();
