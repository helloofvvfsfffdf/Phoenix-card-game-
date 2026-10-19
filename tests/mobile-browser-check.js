/* Opt-in mobile/touch validation for PHOENIX at a real phone viewport.

 * Loads the disposable local fixture (interactive-local-server.js all), emulates
 * a 375×812 phone with touch enabled, runs the eight-card browser flows — which
 * include the viewport-fit gates (no sideways scrolling, controls inside the
 * frame, 44px touch targets) — then proves real touch input end-to-end by
 * playing a Speed Challenge through Input.dispatchTouchEvent taps on the real
 * controls. Finishes on the actual website menu at phone size. No credentials,
 * no production endpoints, no database access.
 *
 * Usage:
 *   node tests/interactive-local-server.js all 4320          (start the fixture)
 *   PHOENIX_BROWSER_URL=http://127.0.0.1:4320 node tests/mobile-browser-check.js
 *   ... --desktop re-runs the same layout gates at a desktop viewport.
 * The browser-based checks are not part of `npm test`; they need a local Edge.
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'),
  { spawn } = require('child_process'), WebSocket = require('ws');
const temp = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode');
const profile = fs.mkdtempSync(path.join(temp, 'phoenix-mobile-check-'));
const MOBILE = !process.argv.includes('--desktop');
const base = String(process.env.PHOENIX_BROWSER_URL || 'http://127.0.0.1:4320').replace(/\/+$/, '');
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
  'Mobile checks run only against a local disposable fixture, never a shared or production server.');

const VIEWPORT = MOBILE
  ? { width: 375, height: 812, deviceScaleFactor: 3, mobile: true }
  : { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false };

const edge = spawn(process.env.BROWSER_EXE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--window-size=' + VIEWPORT.width + ',' + VIEWPORT.height, '--user-data-dir=' + profile, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });

let socket, session, serial = 0;
const pending = new Map();
const wait = ms => new Promise(r => setTimeout(r, ms));
function call(method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression, timeoutMs = 30000) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function screenshot(name) {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  const file = path.join(temp, name);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}
async function waitUntil(expression, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await evaluate(expression);
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting for ' + label);
    await wait(100);
  }
}

/* The harness mounts one real game page per player in an iframe. CDP touch
 * input uses top-viewport CSS pixels, so scroll both the frame and the control
 * into view and sum the two rects. */
function frameExpr(frameIndex, body) {
  return `(()=>{
    const f=[...document.querySelectorAll('#players iframe')][${frameIndex}];
    if(!f||!f.contentWindow||!f.contentDocument) return null;
    const win=f.contentWindow, doc=f.contentDocument;
    ${body}
  })()`;
}
function controlRectExpr(frameIndex, finder) {
  return frameExpr(frameIndex, `
    const el=${finder};
    if(!el) return { missing:true };
    el.scrollIntoView({block:'center',inline:'center'});
    f.scrollIntoView({block:'center'});
    const fr=f.getBoundingClientRect(), r=el.getBoundingClientRect();
    return { x: fr.left + r.left + Math.max(r.width,1)/2, y: fr.top + r.top + Math.max(r.height,1)/2,
             width: Math.round(r.width), height: Math.round(r.height), hidden: !!el.hidden, disabled: !!el.disabled };
  `);
}
/* Poll until the control exists, is visible and enabled, then report where it is. */
async function readyRect(frameIndex, finder, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let rect;
  for (;;) {
    rect = await evaluate(controlRectExpr(frameIndex, finder));
    if (rect && !rect.missing && !rect.hidden && !rect.disabled) return rect;
    if (Date.now() > deadline) break;
    await wait(120);
  }
  assert(rect, label + ' was not found in frame ' + (frameIndex + 1));
  assert(!rect.missing, label + ' was not found in frame ' + (frameIndex + 1));
  assert(!rect.hidden, label + ' is hidden in frame ' + (frameIndex + 1));
  assert(!rect.disabled, label + ' is disabled in frame ' + (frameIndex + 1));
  return rect;
}
async function tapAt(x, y) {
  await call('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1, tangentialPressure: 0, tiltX: 0, tiltY: 0 }]
  });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapRect(rect, label, evidence) {
  assert(rect.x >= 0 && rect.x < VIEWPORT.width && rect.y >= 0 && rect.y < VIEWPORT.height,
    label + ' is outside the viewport at ' + Math.round(rect.x) + ',' + Math.round(rect.y));
  assert(rect.height >= 44 && rect.width >= 40,
    label + ' is ' + rect.width + '×' + rect.height + ', below the touch-target minimum');
  if (evidence) evidence.push({ control: label, x: Math.round(rect.x), y: Math.round(rect.y), size: rect.width + '×' + rect.height });
  await tapAt(rect.x, rect.y);
}
async function tapSelector(frameIndex, finder, label, evidence) {
  const rect = await readyRect(frameIndex, finder, label);
  await tapRect(rect, label, evidence);
  return rect;
}
function frameState(frameIndex) {
  return evaluate(frameExpr(frameIndex,
    'const s=win.PhoenixOnline&&win.PhoenixOnline.getState&&win.PhoenixOnline.getState(); return s||null;'));
}
function frameLayout(frameIndex) {
  return evaluate(frameExpr(frameIndex, `
    const out={ innerWidth: win.innerWidth, scrollWidth: doc.documentElement.scrollWidth, controls: [] };
    const shell=doc.querySelector('.interactive-shell');
    if(shell && shell.getClientRects().length){
      const r=shell.getBoundingClientRect();
      out.shell={ left: Math.round(r.left), right: Math.round(r.right), scrollWidth: shell.scrollWidth, clientWidth: shell.clientWidth };
      out.controls=[...shell.querySelectorAll('button, input, select')].filter(el=>el.getClientRects().length).map(el=>{
        const b=el.getBoundingClientRect();
        return { id: el.id || el.textContent.trim().slice(0,20) || el.tagName, width: Math.round(b.width), height: Math.round(b.height),
                 left: Math.round(b.left), right: Math.round(b.right) };
      });
    }
    return out;
  `));
}
function assertFrameFits(layout, label) {
  assert(layout, label + ': frame is not mounted');
  assert(layout.scrollWidth <= layout.innerWidth + 1,
    label + ': frame scrolls sideways (scrollWidth ' + layout.scrollWidth + ' > viewport ' + layout.innerWidth + ')');
  assert(layout.shell, label + ': overlay shell did not render');
  assert(layout.shell.left >= -1 && layout.shell.right <= layout.innerWidth + 1 && layout.shell.scrollWidth <= layout.shell.clientWidth + 1,
    label + ': overlay shell overflows (spans ' + layout.shell.left + '–' + layout.shell.right + ' of ' + layout.innerWidth +
      ', scrollWidth ' + layout.shell.scrollWidth + '/' + layout.shell.clientWidth + ')');
  for (const c of layout.controls) {
    assert(c.left >= -2 && c.right <= layout.innerWidth + 2,
      label + ': control "' + c.id + '" spans ' + c.left + '–' + c.right + ' of ' + layout.innerWidth);
    assert(c.height >= 44,
      label + ': control "' + c.id + '" is ' + c.height + 'px tall, below the 44px touch target');
  }
}

/* ---- 1+2: the harness page at the target viewport, then the eight real flows ---- */
async function runHarness(evidence) {
  await call('Page.navigate', { url: base + '/tests/other-cards-browser-check.html' });
  await waitUntil('!!window.runOtherCardBrowserChecks', 'the harness page to load', 30000);
  const outer = await evaluate(`(()=>{
    const de=document.documentElement, run=document.getElementById('run'), r=run.getBoundingClientRect();
    // Real frames only exist once a run starts; probe the same CSS rule first.
    const probe=document.createElement('iframe'); probe.style.height='1px';
    document.body.appendChild(probe); const frameWidth=probe.clientWidth; probe.remove();
    return { innerWidth, innerHeight, scrollWidth: de.scrollWidth, runWidth: Math.round(r.width), runHeight: Math.round(r.height), frameWidth };
  })()`);
  assert(outer.scrollWidth <= outer.innerWidth + 1,
    'the harness page scrolls sideways at this viewport (scrollWidth ' + outer.scrollWidth + ' > ' + outer.innerWidth + ')');
  assert(outer.runHeight >= 44, 'the harness run button is ' + outer.runHeight + 'px tall, below the 44px touch target');
  assert(outer.frameWidth > 250, 'game frames should render wider than 250px, got ' + outer.frameWidth);
  if (MOBILE) assert(outer.frameWidth <= 375, 'game frames must be phone-width at 375px, got ' + outer.frameWidth);
  else assert(outer.frameWidth === 380, 'game frames should stay the 380px fixture size on desktop, got ' + outer.frameWidth);
  evidence.harnessPage = outer;
  evidence.screenshots.push(await screenshot(MOBILE ? 'phoenix-mobile-harness.png' : 'phoenix-desktop-harness.png'));

  console.log('Running the eight-card browser flows at ' + outer.frameWidth + 'px frame width…');
  const status = await evaluate('runOtherCardBrowserChecks()', 900000);
  const failures = (status.results || []).filter(r => !r.passed);
  evidence.cards = { passed: status.passed, failed: status.failed, total: (status.results || []).length, failures: failures.slice(0, 10) };
  assert.strictEqual(status.failed, 0,
    'run failed: ' + failures.slice(0, 5).map(f => '[' + f.card + '] ' + f.name + ': ' + (f.error || '')).join(' | '));
  const seen = new Set((status.results || []).map(r => r.card));
  assert.strictEqual(seen.size, 8, 'expected all eight interactive cards to run, got: ' + [...seen].join(', '));
  // The frames that actually carried the flows must match the probed size.
  const realFrameWidth = await evaluate(`(()=>{const f=document.querySelector('iframe');return f?f.clientWidth:0;})()`);
  evidence.cards.frameWidth = realFrameWidth;
  assert(Math.abs(realFrameWidth - outer.frameWidth) <= 2,
    'the real game frames (' + realFrameWidth + 'px) did not match the probed size (' + outer.frameWidth + 'px)');
  evidence.pageErrorsAfterFlows = await evaluate('window.__pageErrors || []');
  assert.deepStrictEqual(evidence.pageErrorsAfterFlows, [], 'uncaught page errors during the card flows');
  console.log('PASS eight real card flows with the viewport-fit gates: ' + status.passed + '/' + status.passed + ' checks');
}

/* ---- 3: real touch input plays a full Speed Challenge (mobile only) ---- */
async function runTouchSpeed(evidence) {
  console.log('Playing a Speed Challenge through real touch taps…');
  await evaluate('createManualCardTestMatch(2)', 120000);
  await waitUntil("(()=>{const s=[...document.querySelectorAll('#players iframe')][0];return s&&s.contentWindow.PhoenixOnline.getState().phase==='playing';})()",
    'the manual two-player match to reach the playing phase');
  const frames = [0, 1];
  let actorFrame = null;
  for (const i of frames) {
    const s = await frameState(i);
    if (s && s.acting) actorFrame = i;
  }
  assert(actorFrame !== null, 'no frame holds the turn in the manual match');
  const speedName = await evaluate(frameExpr(actorFrame, "return win.PhoenixCards.byId('speed').name;"));
  const speedMove = await evaluate(frameExpr(actorFrame,
    "return (win.PhoenixOnline.getState().moves||[]).find(m=>m.cardId==='speed')||null;"));
  assert(speedMove, 'the fixture did not offer the Speed card to the acting player');

  // Tap the real Speed card button, exactly like the harness play() flow does.
  const cardRect = await readyRect(actorFrame, `
    [...doc.querySelectorAll('#online-actions button')].find(b=>b.textContent.includes(${JSON.stringify(speedName)}))`,
    'the Speed card button (' + speedName + ')');
  await tapRect(cardRect, 'Speed card button (' + speedName + ')', evidence.taps);
  if (speedMove.targetId) {
    await waitUntil(frameExpr(actorFrame, "return !!doc.querySelector('#online-actions .online-primary');"),
      'the target picker after tapping the Speed card');
    await tapSelector(actorFrame, "doc.querySelector('#online-actions .online-primary')",
      'target picker confirm button', evidence.taps);
  }
  await waitUntil("(()=>{const s=[...document.querySelectorAll('#players iframe')][0].contentWindow.PhoenixOnline.getState();return s.pendingInteraction&&s.pendingInteraction.type==='speed';})()",
    'the Speed interaction to open after the touch taps', 20000);
  await waitUntil("(()=>{const f=[...document.querySelectorAll('#players iframe')][0];const s=f.contentDocument.querySelector('.interactive-shell');return !!s&&s.getClientRects().length>0;})()",
    'the Speed overlay to render');
  for (const i of frames) assertFrameFits(await frameLayout(i), 'speed overlay in frame ' + (i + 1));
  evidence.speedOverlay = await frameLayout(0);
  evidence.screenshots.push(await screenshot('phoenix-mobile-speed-overlay.png'));

  // Both players tap Ready; the server acknowledges each one individually.
  await tapSelector(0, "doc.getElementById('speed-ready-btn')", 'Speed Ready button (player 1)', evidence.taps);
  await waitUntil("(()=>{const pi=[...document.querySelectorAll('#players iframe')][0].contentWindow.PhoenixOnline.getState().pendingInteraction;return pi&&pi.phase==='ready'&&(pi.submitted||[]).length>=1;})()",
    'player 1 Ready to register with the server', 15000);
  await tapSelector(1, "doc.getElementById('speed-ready-btn')", 'Speed Ready button (player 2)', evidence.taps);
  await waitUntil("(()=>{const pi=[...document.querySelectorAll('#players iframe')][0].contentWindow.PhoenixOnline.getState().pendingInteraction;return pi&&(pi.phase==='countdown'||pi.phase==='react');})()",
    'player 2 Ready to register with the server', 15000);
  // The GO moment is server-owned: the private countdown is 4–6 seconds.
  await waitUntil("(()=>{const pi=[...document.querySelectorAll('#players iframe')][0].contentWindow.PhoenixOnline.getState().pendingInteraction;return pi&&pi.phase==='react';})()",
    'the server GO after the private countdown', 20000);
  await waitUntil(`(()=>{const fr=[...document.querySelectorAll('#players iframe')];
    return fr.every(f=>{const b=f.contentDocument.getElementById('speed-go-btn');return !!b&&!b.hidden&&b.textContent==='GO!';});})()`,
    'both GO controls to show GO');
  for (const i of frames) assertFrameFits(await frameLayout(i), 'speed GO state in frame ' + (i + 1));
  const goState = await frameLayout(0);
  evidence.speedGo = goState.controls.find(c => c.id === 'speed-go-btn') || null;
  evidence.screenshots.push(await screenshot('phoenix-mobile-speed-go.png'));

  // Both players tap GO with real touch. Waiting for the server's react phase
  // first means neither tap can be a false start; the server measures times.
  await tapSelector(0, "doc.getElementById('speed-go-btn')", 'Speed GO button (player 1)', evidence.taps);
  await tapSelector(1, "doc.getElementById('speed-go-btn')", 'Speed GO button (player 2)', evidence.taps);
  await waitUntil("(()=>{const s=[...document.querySelectorAll('#players iframe')][0].contentWindow.PhoenixOnline.getState();return !s.pendingInteraction&&s.players.some(p=>p.points===15000);})()",
    'the Speed interaction to resolve with a 15,000-point winner', 25000);
  const finalState = await frameState(0);
  const total = finalState.players.reduce((sum, p) => sum + p.points, 0);
  assert.strictEqual(total, 15000, 'clean touch reactions must award exactly 15,000 points, got ' + total);
  const resultText = await waitUntil(frameExpr(0,
    "const fb=doc.getElementById('speed-feedback'); return fb&&fb.textContent.trim().includes('15,000')?fb.textContent.trim():false;"),
    'the Speed result text in the overlay', 8000);
  evidence.reactionResult = resultText;
  console.log('PASS real touch input played a full Speed Challenge: ' + resultText);
}

/* ---- 4: the actual website menu at the target viewport ---- */
async function checkMenu(evidence) {
  await call('Page.navigate', { url: base + '/' });
  await waitUntil('!!window.PhoenixOpeningCinematic', 'the website to load', 30000);
  const activated = await (async () => {
    const deadline = Date.now() + 8000;
    for (;;) {
      if (await evaluate('PhoenixOpeningCinematic.active()')) return true;
      if (Date.now() > deadline) return false;
      await wait(150);
    }
  })();
  if (activated) {
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
    await waitUntil('!PhoenixOpeningCinematic.active()', 'the opening cinematic to skip', 8000);
  }
  await wait(400);
  const menu = await evaluate(`(()=>{
    const de=document.documentElement;
    const buttons=[...document.querySelectorAll('.menu-actions button')].map(b=>{const r=b.getBoundingClientRect();
      return { label: (b.textContent||'').trim().slice(0,24), width: Math.round(r.width), height: Math.round(r.height),
               left: Math.round(r.left), right: Math.round(r.right) };});
    return { innerWidth, scrollWidth: de.scrollWidth, buttons };
  })()`);
  assert(menu.scrollWidth <= menu.innerWidth + 1,
    'the website menu scrolls sideways at this viewport (scrollWidth ' + menu.scrollWidth + ' > ' + menu.innerWidth + ')');
  assert(menu.buttons.filter(b => b.width > 0).length >= 3, 'expected the menu actions to render, got ' + menu.buttons.length);
  for (const b of menu.buttons.filter(b => b.width > 0)) {
    assert(b.height >= 44, 'menu button "' + b.label + '" is ' + b.height + 'px tall, below the 44px touch target');
    assert(b.left >= -1 && b.right <= menu.innerWidth + 1, 'menu button "' + b.label + '" spans ' + b.left + '–' + b.right + ' of ' + menu.innerWidth);
  }
  assert.deepStrictEqual(await evaluate('window.__pageErrors || []'), [], 'uncaught page errors on the website menu');
  evidence.menu = menu;
  evidence.screenshots.push(await screenshot(MOBILE ? 'phoenix-mobile-menu.png' : 'phoenix-desktop-menu.png'));
}

async function main() { try {
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(Error('Edge startup timeout')), 20000);
    edge.once('error', reject);
    edge.stderr.on('data', b => {
      text += b;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((r, j) => { socket.once('open', r); socket.once('error', j); });
  socket.on('message', raw => {
    const m = JSON.parse(raw), p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer);
    m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
  });
  const target = await call('Target.createTarget', { url: 'about:blank' });
  session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: "window.__pageErrors=[];addEventListener('error',e=>__pageErrors.push(e.message));addEventListener('unhandledrejection',e=>__pageErrors.push(String(e.reason)));" +
      "try{localStorage.setItem('phoenix.music.v1',JSON.stringify({track:'off',volume:.25}));localStorage.setItem('phoenix.effects.v1',JSON.stringify({sound:false,volume:.35,visuals:'full'}));}catch(_){}"
  });
  if (MOBILE) {
    await call('Emulation.setDeviceMetricsOverride', VIEWPORT);
    await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  const evidence = { mode: MOBILE ? 'mobile-375x812-touch' : 'desktop', baseUrl: base, viewport: VIEWPORT, taps: [], screenshots: [] };
  await runHarness(evidence);
  if (MOBILE) await runTouchSpeed(evidence);
  await checkMenu(evidence);

  const file = path.join(temp, MOBILE ? 'phoenix-mobile-check.json' : 'phoenix-desktop-check.json');
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log('PASS ' + evidence.mode + ': ' + evidence.cards.passed + ' harness layout/game checks' +
    (MOBILE ? ', real touch Speed Challenge' : '') + ', and the website menu at ' + VIEWPORT.width + '×' + VIEWPORT.height +
    '. Evidence: ' + file);
} finally {
  for (const p of pending.values()) clearTimeout(p.timer);
  if (socket) {
    try { await call('Browser.close', {}, 5000); } catch (e) { /* browser may already be gone */ }
    try { socket.close(); } catch (e) { /* already closed */ }
  }
  edge.kill();
}
}
main().catch(e => { console.error(e); process.exitCode = 1; });
