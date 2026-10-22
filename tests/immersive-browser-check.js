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
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 300000);
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
    // The room and the people arrive after the page does.
    await evaluate(`new Promise((resolve, reject) => {
      let n = 0;
      const timer = setInterval(() => {
        const s = window.PhoenixImmersive.stateSnapshot();
        if (s.seats > 0 && s.mixamo.loading === false) { clearInterval(timer); resolve(true); }
        else if (n++ > 1800) { clearInterval(timer); reject(Error('the room and the people never arrived')); }
      }, 100);
    })`);
    await wait(600);

    // 1. The room is actually drawn.
    const brightness = await evaluate(BRIGHTNESS);
    assert(brightness > 6, 'the 3D page draws something (brightness ' + brightness + ')');

    // 2. The people are there, and the table is connected.
    const state = await evaluate('window.PhoenixImmersive.stateSnapshot()');
    assert.strictEqual(state.characters, 5, 'five people sit round the table');

    // 2b. The 3D table is on the same server as the 2D game: it connects,
    //     and the server publishes the list of open rooms to it.
    const net = await evaluate(`new Promise((resolve, reject) => {
      const p = window.PhoenixImmersive;
      let n = 0;
      const timer = setInterval(() => {
        const state = p.online.getState();
        if (p.online.isConnected()) { clearInterval(timer); resolve({ connected: true, state: !!state }); }
        else if (n++ > 120) { clearInterval(timer); reject(Error('the table never connected to the server')); }
      }, 100);
    })`);
    assert.strictEqual(net.connected, true, 'the 3D table connects to the game server');

    // 2c. A snapshot from the server fills the hand, the table and the
    //     cameras - exactly as it does in a real match.
    const SNAPSHOT = `(() => {
      const players = [
        { id: 'human', name: 'Ash', ally: 'phoenix', badges: [], connected: true, points: 30000, handCount: 7, hunter: false, eliminated: false, noEvilPermanent: false },
        { id: 'chatgpt', name: 'Brook', ally: null, badges: [], connected: true, points: 10000, handCount: 6, hunter: false, eliminated: false, noEvilPermanent: false },
        { id: 'claude', name: 'Cass', ally: null, badges: [], connected: true, points: 0, handCount: 6, hunter: false, eliminated: false, noEvilPermanent: false },
        { id: 'gemini', name: 'Dara', ally: null, badges: [], connected: true, points: -5000, handCount: 6, hunter: false, eliminated: false, noEvilPermanent: false },
        { id: 'copilot', name: 'Emery', ally: null, badges: [], connected: true, points: 0, handCount: 6, hunter: false, eliminated: false, noEvilPermanent: false }
      ];
      const snapshot = {
        type: 'state', phase: 'playing', started: true, seat: 0, code: 'TEST1',
        host: true, players: players, round: 1, rounds: 10, over: false, winner: null,
        current: 'human', hand: ['bonus', 'knife', 'steal', 'trick', 'wheel', 'hostage', 'support'],
        acting: true,
        moves: [
          { cardId: 'bonus', targetId: null },
          { cardId: 'steal', targetId: 'chatgpt' },
          { cardId: 'steal', targetId: 'claude' },
          { cardId: 'knife', targetId: 'gemini' },
          { cardId: 'trick', targetId: 'copilot' },
          { cardId: 'wheel', targetId: null },
          { cardId: 'hostage', targetId: 'chatgpt' },
          { cardId: 'support', targetId: 'chatgpt' }
        ],
        pending: null, pendingInteraction: null, lastInteractionResult: null,
        deckCount: 120, discardCount: 3, destroyedCount: 0, lastDiscard: null,
        bannedCards: [], dehydrated: null, hasTrap: false, hostage: null, hostageHand: null,
        trailer: null, watchingVideo: false, tedObscured: false, mapleBlocked: [],
        president: null, presidentChanged: false, presidentTurn: false, noEvilPermanent: false,
        effects: { stream: 'check', sequence: 0, events: [] }, log: [],
        publicAllies: {}, availableAllies: [], dice: null, draftTurn: null,
        resumeToken: 'check', paused: false, resumeUntil: null,
        visibility: 'public', mode: 'public'
      };
      window.__sent = [];
      const socket = window.ws;
      if (socket && !socket.__wrapped) {
        socket.__wrapped = true;
        const send = socket.send.bind(socket);
        socket.send = function (data) { window.__sent.push(data); return send(data); };
      }
      window.PhoenixImmersive.applyState(snapshot);
      window.__lastSnapshot = snapshot;
      const s = window.PhoenixImmersive.stateSnapshot();
      return {
        hand: s.hand, seats: s.seats, localSeat: s.localSeat,
        playersShown: document.querySelectorAll('#immersive-players .immersive-player').length,
        turn: (document.getElementById('immersive-turn') || {}).textContent,
        code: (document.getElementById('immersive-room-code') || {}).textContent
      };
    })()`;
    const filled = await evaluate(SNAPSHOT);
    assert.strictEqual(filled.hand, 7, 'the hand is the server\'s seven cards');
    assert.strictEqual(filled.playersShown, 5, 'and the table shows the five players');
    assert(/Ash/.test(filled.turn || ''), 'and says whose turn it is (' + filled.turn + ')');
    assert(/TEST1/.test(filled.code || ''), 'and the room code (' + filled.code + ')');

    // 3. A card can be picked, and it lifts out of the fan.
    const lifted = await evaluate(`(() => {
      const p = window.PhoenixImmersive;
      p.selectCard(0);
      const entry = p.fan.cards[0];
      const before = entry.holder.position.y;
      p.fan.layout(0);
      const result = { selected: p.stateSnapshot().selected, lifted: entry.holder.position.y - before };
      // Put it back down again, so the next test starts from a clean fan.
      p.selectCard(0);
      return result;
    })()`);
    assert.strictEqual(lifted.selected, 0, 'a card is selected');
    assert(lifted.lifted > 0.03, 'and the selected card lifts (' + lifted.lifted + ')');

    // 4. A card with no target is played straight away.
    const plain = await evaluate(`new Promise((resolve) => {
      const p = window.PhoenixImmersive;
      window.__sent = [];
      p.selectCard(0);
      p.playSelected();
      setTimeout(() => resolve({ sent: window.__sent, hand: p.stateSnapshot().hand }), 400);
    })`);
    const plainMove = (plain.sent || []).map((d) => JSON.parse(d)).find((m) => m.type === 'move');
    assert(plainMove, 'the move was sent to the server');
    assert.strictEqual(plainMove.cardId, 'bonus', 'and it was the right card');
    assert.strictEqual(plainMove.targetId, null, 'with no target');

    // 5. A card that needs a target asks who it is aimed at, and only sends
    //    once the player has chosen.
    const aimed = await evaluate(`new Promise((resolve) => {
      const p = window.PhoenixImmersive;
      window.__sent = [];
      p.applyState(window.__lastSnapshot);
      p.selectCard(2);
      p.playSelected();
      setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll('#immersive-targets .immersive-target'));
        const before = window.__sent.length;
        const target = buttons.find((b) => b.textContent.indexOf('Brook') !== -1);
        if (target) target.click();
        setTimeout(() => resolve({
          pickerOpen: !document.getElementById('immersive-targets').hidden,
          choices: buttons.map((b) => b.textContent),
          sentBefore: before,
          sent: window.__sent
        }), 300);
      }, 300);
    })`);
    assert.strictEqual(aimed.pickerOpen, false, 'the picker closes once a target is chosen');
    assert(aimed.choices.some((t) => /Brook/.test(t)), 'the picker offered the players the server allowed (' + aimed.choices.join(', ') + ')');
    const aimedMove = (aimed.sent || []).map((d) => JSON.parse(d)).find((m) => m.type === 'move');
    assert(aimedMove, 'the aimed move was sent');
    assert.strictEqual(aimedMove.cardId, 'steal', 'and it was the right card');
    assert.strictEqual(aimedMove.targetId, 'chatgpt', 'and it was aimed at the right player');

    // 5. The camera can look around, and cannot look anywhere silly.
    const look = await evaluate(`(() => {
      const p = window.PhoenixImmersive;
      p.look(99, 99);
      const wild = p.stateSnapshot();
      p.look(0.4, -0.2);
      return { wild, gentle: p.stateSnapshot() };
    })()`);
    assert(Math.abs(look.wild.yaw) <= 1.76, 'the camera cannot spin round');
    assert(Math.abs(look.wild.pitch) <= 0.63, 'nor look straight up or down');
    assert(Math.abs(look.gentle.yaw - 0.4) < 0.001, 'but it can be turned');

    // 6. The Mixamo characters are there, rigged, clothed and sitting.
    const snapshot = await evaluate('window.PhoenixImmersive.stateSnapshot()');
    const mixamo = snapshot.mixamo;
    assert.strictEqual(mixamo.loaded, true, 'the Mixamo characters loaded');
    assert.deepStrictEqual(mixamo.errors, [], 'without an error');
    assert.strictEqual(mixamo.count, 5, 'all five people are there');
    assert(mixamo.bones > 300, 'with a real skeleton (' + mixamo.bones + ' bones)');
    assert(mixamo.meshes >= 24, 'and their body, clothes and hair (' + mixamo.meshes + ' meshes)');
    assert(mixamo.sitting, 'and they are sitting in the chairs');
    assert.strictEqual(snapshot.seats, 5, 'the room has five seats');
    assert.strictEqual(snapshot.laptops, 5, 'and a laptop for each of them');

    // 6b. And they are ON the chairs: the hips are on the cushion, the head
    //     is above the table, and nothing has fallen through the floor.
    const tableTop = 1.012;
    snapshot.seatings.forEach(function (seating) {
      assert(seating, 'every seat has somebody in it');
      assert(Math.abs(seating.hips - seating.seatTop) < 0.01,
        'seat ' + seating.seat + ': the hips are on the cushion (' +
        seating.hips.toFixed(3) + ' vs ' + seating.seatTop.toFixed(3) + ')');
      assert(seating.head > tableTop,
        'seat ' + seating.seat + ': the head is above the table (' +
        seating.head.toFixed(3) + ')');
      assert(seating.toe > -0.01,
        'seat ' + seating.seat + ': nothing is through the floor (' +
        seating.toe.toFixed(3) + ')');
    });
    assert.strictEqual(snapshot.seatings[snapshot.localSeat].visible, false,
      'the player cannot see the inside of their own head');
    assert(snapshot.camera[1] > 1.0 && snapshot.camera[1] < 1.6,
      'and the camera is at a seated eye height (' + snapshot.camera[1].toFixed(3) + ')');

    // 6c. And they stay there: the seat is locked, so nothing drifts.
    const drift = await evaluate(`new Promise((resolve) => {
      const p = window.PhoenixImmersive;
      const before = p.stateSnapshot().seatings.map((s) => s && s.hips);
      setTimeout(() => resolve({ before, after: p.stateSnapshot().seatings.map((s) => s && s.hips) }), 1200);
    })`);
    drift.before.forEach(function (hips, index) {
      assert(Math.abs(hips - drift.after[index]) < 0.005,
        'seat ' + index + ' does not drift (' + hips.toFixed(4) + ' -> ' +
        drift.after[index].toFixed(4) + ')');
    });

    // 6d. The Mimic's video really plays on the laptop's screen: the player
    //      is put over the screen in the room, at the right shape.
    const mimic = await evaluate(`new Promise((resolve) => {
      const p = window.PhoenixImmersive;
      const events = [{ type: 'card', cardId: 'mimic', seat: 0, targetSeat: 0 }];
      const running = p.playShow('mimic', events, { reducedMotion: true });
      setTimeout(() => {
        const frame = document.querySelector('.immersive-screen-map');
        resolve({
          exists: !!frame,
          visible: frame ? frame.style.visibility : null,
          mapped: frame ? /^matrix3d\\(/.test(frame.style.transform) : false,
          player: !!document.getElementById('immersive-mimic-frame'),
          running: running
        });
      }, 2600);
    })`);
    assert.strictEqual(mimic.exists, true, 'the video is put on the laptop screen');
    assert.strictEqual(mimic.visible, 'visible', 'and the screen is turned towards the player');
    assert.strictEqual(mimic.mapped, true, 'and the player is fitted to the screen in the room');
    assert.strictEqual(mimic.player, true, 'with a video player in it');
    await evaluate('new Promise((resolve) => setTimeout(resolve, 6000))');
    const mimicGone = await evaluate('!document.querySelector(".immersive-screen-map")');
    assert.strictEqual(mimicGone, true, 'and it is put away when the video is over');

    // 6e. The end of the match: the player's own laptop shows the result,
    //      and the view is locked onto it.
    const over = await evaluate(`(() => {
      const p = window.PhoenixImmersive;
      const snapshot = JSON.parse(JSON.stringify(window.__lastSnapshot));
      snapshot.over = true;
      snapshot.winner = 'chatgpt';
      snapshot.players[0].points = 12000;
      snapshot.players[1].points = 40000;
      p.applyState(snapshot);
      const bank = p.state.laptops[0].laptop.bank;
      return {
        result: bank.result,
        context: bank.result ? { won: bank.result.won, winner: bank.result.winner,
          standings: bank.result.standings.length } : null
      };
    })()`);
    assert(over.result, 'the laptop shows the result of the match');
    assert.strictEqual(over.context.won, false, 'and knows whether the player won');
    assert.strictEqual(over.context.winner, 'Brook', 'and who did win');
    assert.strictEqual(over.context.standings, 5, 'with the table as it ended');

    // And the view cannot be turned away from it.
    const locked = await evaluate(`(async () => {
      const p = window.PhoenixImmersive;
      await new Promise((resolve) => setTimeout(resolve, 400));
      const before = p.stateSnapshot().yaw;
      p.look(1.4, 0.5);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = p.stateSnapshot().yaw;
      return { before: before, after: after };
    })()`);
    assert(Math.abs(locked.after - locked.before) < 0.02,
      'and the view stays locked on the result');

    // 7. Nothing threw on the way.
    const errors = await evaluate('window.immersiveErrors || []');
    assert.deepStrictEqual(errors, [], 'the page raised no errors');

    // 8. Pictures, so the result can be looked at.
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

    // The player's own phone, at the bottom left of the view.
    await evaluate('window.PhoenixImmersive.look(-0.28, -0.22)');
    await wait(500);
    shots.push(await screenshot('phoenix-immersive-phone.png'));
    await evaluate('window.PhoenixImmersive.look(0, -0.05)');

    // The poster on the back wall, and the cell in the corner.
    await evaluate('window.PhoenixImmersive.look(-0.07, 0.2)');
    await wait(500);
    shots.push(await screenshot('phoenix-immersive-poster.png'));
    await evaluate('window.PhoenixImmersive.look(1.25, 0.02)');
    await wait(500);
    shots.push(await screenshot('phoenix-immersive-cell.png'));

    // 9. The phone-sized layout still works.
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
