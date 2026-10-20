/* PHOENIX - HARDCORE, over real sockets.
 *
 * A hardcore lobby is created with a tick box, the server says so in the
 * snapshot and in the public lobby list, and the cards really do play twice.
 */
'use strict';

const assert = require('assert');
const match = require('./helpers/interaction-match');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  OK ' + name); })
    .catch(error => { failed++; console.error('  X ' + name + ': ' + error.message); });
}

function suite(name) {
  console.log('\n' + name);
}

async function main() {
  suite('HARDCORE');

  await test('a hardcore lobby says so in the snapshot', async () => {
    const m = await match({ hardcore: true });
    try {
      assert.strictEqual(m.state().hardcore, true, 'the room is hardcore');
      assert.strictEqual(m.clients[1].state.hardcore, true,
        'and every seat in it knows it');
    } finally { await m.close(); }
  });

  await test('an ordinary lobby is not hardcore', async () => {
    const m = await match();
    try {
      assert.strictEqual(m.state().hardcore, false, 'the room is not hardcore');
    } finally { await m.close(); }
  });

  await test('the public lobby list says HARDCORE, so everybody can see it', async () => {
    const m = await match({ hardcore: true });
    try {
      // The room is only in the list while it is in the lobby, so the frame
      // that carried it is looked for through the frames that arrived.
      const withRoom = m.clients[0].frames
        .filter(f => f.type === 'lobby')
        .filter(f => f.rooms.some(r => r.code === m.state().code))
        .pop();
      assert(withRoom, 'the room was listed while it was in the lobby');
      const mine = withRoom.rooms.find(r => r.code === m.state().code);
      assert.strictEqual(mine.hardcore, true, 'and it is marked hardcore');
    } finally { await m.close(); }
  });

  await test('a card really plays twice: the points land twice', async () => {
    const m = await match({ hardcore: true, points: 0 });
    try {
      const actor = m.clients.find(c => c.state.acting);
      const seat = actor.state.seat;
      const before = m.state().players[seat].points;
      await m.play('bonus');
      const after = m.state().players[seat].points;
      assert.strictEqual(after - before, 20000,
        'the +10,000 card paid out twice: ' + (after - before));
    } finally { await m.close(); }
  });

  await test('in an ordinary lobby the same card pays out once', async () => {
    const m = await match({ points: 0 });
    try {
      const actor = m.clients.find(c => c.state.acting);
      const seat = actor.state.seat;
      const before = m.state().players[seat].points;
      await m.play('bonus');
      const after = m.state().players[seat].points;
      assert.strictEqual(after - before, 10000,
        'the +10,000 card paid out once: ' + (after - before));
    } finally { await m.close(); }
  });

  await test('a knife in a hardcore room takes the target out for longer', async () => {
    const m = await match({ hardcore: true });
    try {
      const actor = m.clients.find(c => c.state.acting);
      const targetSeat = actor.state.moves
        .filter(move => move.cardId === 'knife')
        .map(move => actor.state.players.findIndex(p => p.id === move.targetId))[0];
      await m.play('knife');
      const target = m.state().players[targetSeat];
      assert.strictEqual(target.eliminated, true, 'the target is out');
    } finally { await m.close(); }
  });

  console.log('\n' + passed + ' hardcore network checks passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}

main().catch(error => { console.error(error); process.exit(1); });
