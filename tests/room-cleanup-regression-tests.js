/* Regression for the crash actually observed after the browser fixtures left.
 * Executes the real closeRoom function with its idle-disconnected member shape.
 * No server port, database or production state is used. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('function closeRoom(room, reason)');
const end = source.indexOf('\n/**', start);
assert(start >= 0 && end > start, 'actual closeRoom source is found');
const room = { code: 'TEST', phase: 'playing', members: [{ seat: 0, ws: null }] };
const rooms = new Map([[room.code, room]]);
const context = {
  rooms, WebSocket: { OPEN: 1 }, INSTANCE_ID: 'test',
  clearTimeout() {},
  send() {}, broadcastLobby() {}, console: { log() {} }
};
vm.runInNewContext(source.slice(start, end), context);
try {
  assert.doesNotThrow(() => context.closeRoom(room, 'Idle room expired'), 'closing a room with a disconnected member must not crash the server');
  assert(!rooms.has(room.code));
  console.log('PASS idle cleanup tolerates a disconnected member');
  let closed = 0;
  let sent = 0;
  const timers = [];
  context.clearTimeout = id => timers.push(id);
  context.send = () => { sent++; };
  const live = { readyState: 1, close() { closed++; } };
  const mixed = { code: 'MIXED', interactionTimer: 17, pendingInteraction: { countdownTimer: 18 }, members: [{ ws: null }, { ws: live }] };
  context.closeRoom(mixed, 'Closed');
  assert.strictEqual(closed, 1);
  assert.strictEqual(sent, 1);
  assert.deepStrictEqual(timers, [17, 18]);
  assert.strictEqual(mixed.pendingInteraction, null);
  assert.strictEqual(live.member, null);
  console.log('PASS mixed connected/disconnected cleanup clears interaction timers');
  let cleanup;
  const now = 2000000;
  const expired = [];
  const fixtures = new Map([
    ['old-live', { code: 'old-live', phase: 'playing', createdAt: 1, members: [{ ws: live }], log: [] }],
    ['fresh-pause', { code: 'fresh-pause', phase: 'playing', pausedAt: now - 1000, members: [{ ws: null }, { ws: live }], log: [] }],
    ['expired-partial', { code: 'expired-partial', phase: 'playing', pausedAt: now - 600000, members: [{ ws: null }, { ws: live }], log: [] }],
    ['fresh-abandoned', { code: 'fresh-abandoned', phase: 'playing', createdAt: 1, abandonedAt: now - 1000, members: [{ ws: null }], log: [] }],
    ['expired-abandoned', { code: 'expired-abandoned', phase: 'playing', abandonedAt: now - 600000, members: [{ ws: null }], log: [] }]
  ]);
  const cleanupStart = source.indexOf('const ABANDON_GRACE_MS =');
  const cleanupEnd = source.indexOf('abandonedCleanup.unref();', cleanupStart) + 'abandonedCleanup.unref();'.length;
  assert(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  vm.runInNewContext(source.slice(cleanupStart, cleanupEnd), {
    rooms: fixtures, Date: { now: () => now }, WebSocket: { OPEN: 1 },
    setInterval(callback) { cleanup = callback; return { unref() {} }; },
    closeRoom(room) { expired.push(room.code); fixtures.delete(room.code); }
  });
  cleanup();
  assert.deepStrictEqual(expired.sort(), ['expired-abandoned', 'expired-partial']);
  assert.strictEqual(fixtures.get('fresh-abandoned').abandonedAt, now - 1000);
  console.log('PASS real cleanup callback preserves fresh reconnect windows and expires partial/all-gone tables (modelled clock, not a ten-minute soak)');
} catch (error) {
  console.error('FAIL idle cleanup tolerates a disconnected member: ' + error.message);
  process.exitCode = 1;
}
