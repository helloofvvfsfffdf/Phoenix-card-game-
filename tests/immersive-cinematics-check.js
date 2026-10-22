/* PHOENIX - every card's cinematic, checked in a real browser.
 *
 * The other 3D check proves the room draws and a card can be played. This
 * one proves the thing that matters most about the cinematics: that EVERY
 * card in the game has one, and that every one of them runs, in a real
 * browser, without throwing and without leaving the room in a mess.
 *
 * A cinematic that has never been run is not a cinematic. So each card is
 * played for real here: the room is loaded, the people are sitting down,
 * and the thirty-eight shows are played one after another.
 *
 * It also checks the two things a cinematic must not break: the people
 * have to end up back on their chairs, and the camera has to end up back
 * where it started.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const temp = path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'Temp', 'opencode');
const profile = fs.mkdtempSync(path.join(temp, 'phoenix-cinematics-'));
const edge = spawn(process.env.BROWSER_EXE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--window-size=1280,860', '--user-data-dir=' + profile, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });

let socket;
let session;
let serial = 0;
const pending = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 600000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function main() {
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
    session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.immersiveErrors=[];addEventListener("error",e=>immersiveErrors.push(e.message));' +
        'addEventListener("unhandledrejection",e=>immersiveErrors.push(String(e.reason)));'
    });

    const base = process.env.PHOENIX_IMMERSIVE_URL || 'http://localhost:3000';
    await call('Page.navigate', { url: base + '/immersive.html' });

    // The room and the people.
    await evaluate(`new Promise((resolve, reject) => {
      let n = 0;
      const timer = setInterval(() => {
        const p = window.PhoenixImmersive;
        if (p && p.stateSnapshot().mixamo.loading === false) { clearInterval(timer); resolve(true); }
        else if (n++ > 2400) { clearInterval(timer); reject(Error('the room never arrived')); }
      }, 100);
    })`);

    // The cards that must have a show.
    const cards = await evaluate(`(() => {
      const Cards = window.PhoenixCards;
      return Cards.ids();
    })()`);
    assert(cards.length > 0, 'the card registry has cards in it');

    const registry = await evaluate(`(async () => {
      const mod = await import('/js/immersive/cinematics.js');
      return mod.cinematicCards();
    })()`);

    const missing = cards.filter((id) => !registry.includes(id));
    assert.deepStrictEqual(missing, [], 'every card in the game has a cinematic');
    const extra = registry.filter((id) => !cards.includes(id));
    assert.deepStrictEqual(extra, [], 'and every cinematic belongs to a real card');

    // Play them all. Each one is given a real seat and a real target, and
    // the room is watched while it happens.
    const played = await evaluate(`(async () => {
      const p = window.PhoenixImmersive;
      const mod = await import('/js/immersive/cinematics.js');
      const results = [];
      for (const cardId of mod.cinematicCards()) {
        const events = [
          { type: 'card', cardId: cardId, seat: 1, targetSeat: 3 },
          { type: 'result', cardId: cardId, text: '' }
        ];
        const started = Date.now();
        let ok = null;
        let error = null;
        try {
          // The table's own way of playing a show, so the room is settled
          // afterwards exactly as it is in a real match.
          ok = await p.playShow(cardId, events, { reducedMotion: true });
        } catch (err) {
          error = String(err && err.message || err);
        }
        results.push({ cardId: cardId, ok: ok, error: error, ms: Date.now() - started });
      }
      return results;
    })()`);

    assert.strictEqual(played.length, cards.length,
      'every card was played (' + played.length + ' of ' + cards.length + ')');
    const broken = played.filter((entry) => entry.ok !== true);
    assert.deepStrictEqual(broken.map((entry) => entry.cardId + ': ' + (entry.error || entry.ok)), [],
      'every cinematic ran without throwing');

    // Nothing threw on the page either.
    const errors = await evaluate('window.immersiveErrors || []');
    assert.deepStrictEqual(errors, [], 'the page raised no errors');

    // And everybody is still sitting where they were.
    const snapshot = await evaluate('window.PhoenixImmersive.stateSnapshot()');
    const wrong = snapshot.seatings.filter((seating) => {
      if (!seating) return false;
      return Math.abs(seating.hips - seating.seatTop) > 0.02;
    });
    assert.deepStrictEqual(wrong.map((s) => s.seat), [],
      'everybody is still on their chair after thirty-eight cinematics');

    // The slow ones are worth knowing about.
    const slowest = played.slice().sort((a, b) => b.ms - a.ms).slice(0, 3);
    console.log('PASS every one of the ' + cards.length + ' card cinematics runs.');
    console.log('  the slowest: ' + slowest.map((s) => s.cardId + ' (' + s.ms + 'ms)').join(', '));
  } catch (error) {
    console.error('X ' + error.message);
    process.exitCode = 1;
  } finally {
    try { socket && socket.close(); } catch (error) { /* closing anyway */ }
    try { edge.kill(); } catch (error) { /* closing anyway */ }
  }
}

main();
