/* Probe: play a five-player match the way the browser check does, and print
 * the cards that come up. */
'use strict';
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const stateFile = path.join(os.tmpdir(), 'phoenix-probe-' + Date.now() + '.json');
  fs.writeFileSync(stateFile, JSON.stringify({ multiplayerOpen: true, creationLocked: false }));

  const server = spawn(process.execPath, ['tests/helpers/plain-server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port),
      PHOENIX_OWNER_PASSWORD: 'unused-owner-password-0123456789abcdef',
      PHOENIX_MODE_ACCESS_CODE: 'unused-access-code-1234567890',
      PHOENIX_STATE_FILE: stateFile, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
      PHOENIX_BIND_HOST: '127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', d => process.stdout.write('ERR ' + d));
  await new Promise((res, rej) => {
    let out = '';
    const t = setTimeout(() => rej(Error('timeout')), 10000);
    server.stdout.on('data', d => { out += d; if (out.includes('PHOENIX multiplayer server:')) { clearTimeout(t); res(); } });
  });

  const states = new Map();
  const list = [];
  const mk = () => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'state') states.set(ws, m); });
    list.push(ws);
    return ws;
  };
  const open = ws => new Promise(r => ws.once('open', r));
  for (let i = 0; i < 5; i++) { const ws = mk(); await open(ws); }
  list[0].send(JSON.stringify({ type: 'create', code: '' }));
  await wait(300);
  const code = states.get(list[0]).code;
  for (let i = 1; i < 5; i++) { list[i].send(JSON.stringify({ type: 'join', code })); await wait(200); }
  list[0].send(JSON.stringify({ type: 'start', rounds: 20 }));
  await wait(500);

  const allies = ['phoenix', 'tilly', 'louie', 'simba', 'elsie'];
  const seen = new Set();
  const interactive = ['rps', 'betrayal', 'speed', 'dice', 'wheel', 'linkedfate', 'impostor', 'swapper', 'wheelofmisfortune',
    'musicalchairs', 'russianroulette', 'memorymayhem', 'mimic', 'support', 'joshuasurvey', 'trailer'];
  for (let turn = 0; turn < 400; turn++) {
    const s = states.get(list[0]);
    if (!s) break;
    if (s.over) { console.log('match over after', turn, 'steps'); break; }
    if (s.phase === 'turnDice' || s.phase === 'allyDice') {
      const ws = list[s.dice.next];
      if (ws) ws.send(JSON.stringify({ type: 'roll' }));
      await wait(80);
    } else if (s.phase === 'draft') {
      const ws = list[s.draftTurn];
      if (ws) ws.send(JSON.stringify({ type: 'chooseAlly', ally: allies.shift() || 'simba' }));
      await wait(80);
    } else if (s.phase === 'playing') {
      const actor = list.find(ws => { const st = states.get(ws); return st && st.acting; });
      if (!actor) { console.log('no acting peer'); break; }
      const own = states.get(actor);
      const legal = (own.moves || []).filter(m => !(own.mapleBlocked || []).includes(m.cardId));
      const move = legal.find(m => !seen.has(m.cardId) && m.cardId !== 'phoenix' && !interactive.includes(m.cardId))
        || legal.find(m => ['bonus', 'reveal', 'trick', 'hunter', 'ghost', 'stealturn', 'curse'].includes(m.cardId))
        || legal.find(m => !interactive.includes(m.cardId))
        || legal[0];
      if (!move) { console.log('no legal move'); break; }
      if (move.cardId !== 'bonus') seen.add(move.cardId);
      actor.send(JSON.stringify({ type: 'move', cardId: move.cardId, targetId: move.targetId || null }));
      await wait(90);
    } else break;
  }
  console.log('cards played:', Array.from(seen).sort().join(','));
  list.forEach(ws => ws.close());
  server.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
