/* PHOENIX - the immersive (3D) prototype, checked in a real browser.
 *
 * Headless Edge, driven over the DevTools protocol, exactly like the other
 * browser checks in this folder. It proves the prototype actually renders:
 * the room is drawn, the characters are there, the hand is held, a card can
 * be picked, and a card can be played.
 *
 * It writes a few pictures to the temp folder so the result can be looked
 * at, and it fails loudly if the 3D page ever stops drawing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const temp = path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'Temp', 'opencode');
const profile = fs.mkdtempSync(path.join(temp, 'phoenix-immersive-'));
const edge = spawn(process.env.BROWSER_EXE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--window-size=1280,860', '--user-data-dir=' + profile, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });

let socket;
let session;
let targetID;
let serial = 0;
const pending = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function call(method, params = {}, target = session) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function screenshot(name) {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const file = path.join(temp, name);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

/**
 * How much of the picture is not black.
 *
 * The pixels are read straight out of the WebGL context, immediately after a
 * render - a WebGL canvas is cleared the moment it is presented, so reading
 * it later would always say "black".
 */
const BRIGHTNESS = `(() => {
  const p = window.PhoenixImmersive;
  if (!p) return -1;
  const { renderer, scene, camera } = p.view;
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    total += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  }
  return total / (pixels.length / 4);
})()`;

async function main() {
  const shots = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(Error('Edge startup timeout')), 20000);
      edge.once('error', reject);
      edge.stderr.on('data', (data) => {
        text += data;
        const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error ? entry.reject(Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    });

    const target = await call('Target.createTarget', { url: 'about:blank' }, null);
    targetID = target.targetId;
    session = (await call('Target.attachToTarget', { targetId: targetID, flatten: true }, null)).sessionId;
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', {
      source: "window.immersiveErrors=[];addEventListener('error',e=>immersiveErrors.push(e.message));addEventListener('unhandledrejection',e=>immersiveErrors.push(String(e.reason)));"
    });

    const base = process.env.PHOENIX_IMMERSIVE_URL || 'http://localhost:3000';
    await call('Page.navigate', { url: base + '/immersive.html' });
    await evaluate(`new Promise((resolve, reject) => {
      let n = 0;
      const timer = setInterval(() => {
        if (window.PhoenixImmersive) { clearInterval(timer); resolve(true); }
        else if (n++ > 240) { clearInterval(timer); reject(Error('the prototype never started')); }
      }, 50);
    })`);
    await wait(1200);

    // 1. The room is actually drawn.
    const brightness = await evaluate(BRIGHTNESS);
    assert(brightness > 6, 'the 3D page draws something (brightness ' + brightness + ')');

    // 2. The people are there, and the hand is held.
    const state = await evaluate('window.PhoenixImmersive.state()');
    assert.strictEqual(state.characters, 5, 'five characters sit round the table');
    assert.strictEqual(state.hand, 7, 'and the player holds seven cards');

    // 3. A card can be picked, and it lifts out of the fan.
    const lifted = await evaluate(`(() => {
      const p = window.PhoenixImmersive;
      p.selectCard(2);
      const entry = p.fan.cards[2];
      const before = entry.holder.position.y;
      p.fan.layout(0);
      return { selected: p.state().selected, lifted: entry.holder.position.y - before };
    })()`);
    assert.strictEqual(lifted.selected, 2, 'a card is selected');
    assert(lifted.lifted > 0.03, 'and the selected card lifts (' + lifted.lifted + ')');

    // 4. A card can be played, and it leaves the hand.
    const played = await evaluate(`new Promise((resolve) => {
      const p = window.PhoenixImmersive;
      const before = p.state().hand;
      p.playSelected();
      setTimeout(() => resolve({ before, after: p.state().hand, played: p.state().played }), 900);
    })`);
    assert.strictEqual(played.before - played.after, 1, 'the card leaves the hand');
    assert.strictEqual(played.played, 1, 'and it lands on the table');

    // 5. The camera can look around, and cannot look anywhere silly.
    const look = await evaluate(`(() => {
      const p = window.PhoenixImmersive;
      p.look(99, 99);
      const wild = p.state();
      p.look(0.4, -0.2);
      return { wild, gentle: p.state() };
    })()`);
    assert(Math.abs(look.wild.yaw) <= 1.76, 'the camera cannot spin round');
    assert(Math.abs(look.wild.pitch) <= 0.63, 'nor look straight up or down');
    assert(Math.abs(look.gentle.yaw - 0.4) < 0.001, 'but it can be turned');

    // 6. Nothing threw on the way.
    const errors = await evaluate('window.immersiveErrors || []');
    assert.deepStrictEqual(errors, [], 'the page raised no errors');

    // 7. Pictures, so the result can be looked at.
    shots.push(await screenshot('phoenix-immersive-table.png'));
    await evaluate('window.PhoenixImmersive.look(-0.75, -0.12)');
    await wait(500);
    shots.push(await screenshot('phoenix-immersive-left.png'));
    await evaluate('window.PhoenixImmersive.look(0.8, -0.1)');
    await wait(500);
    shots.push(await screenshot('phoenix-immersive-right.png'));
    await evaluate('window.PhoenixImmersive.look(0, -0.05)');
    await evaluate("window.PhoenixImmersive.selectCard(0)");
    await wait(400);
    shots.push(await screenshot('phoenix-immersive-selected.png'));

    // 8. The phone-sized layout still works.
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await wait(700);
    const mobile = await evaluate(BRIGHTNESS);
    assert(mobile > 6, 'the table draws on a phone too (brightness ' + mobile + ')');
    const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
    assert.strictEqual(overflow, false, 'and the page does not scroll sideways');
    shots.push(await screenshot('phoenix-immersive-mobile.png'));
    await call('Emulation.clearDeviceMetricsOverride');

    console.log('PASS the immersive prototype renders the room, the characters, the hand, and picks and plays a card.');
    shots.forEach((file) => console.log('  ' + file));
  } catch (error) {
    console.error('X ' + error.message);
    process.exitCode = 1;
  } finally {
    try { socket && socket.close(); } catch (error) { /* closing anyway */ }
    try { edge.kill(); } catch (error) { /* closing anyway */ }
  }
}

main();
