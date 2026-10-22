'use strict';

const assert = require('assert');
const Tube = require('../js/phoenix-tube-challenge.js');

function test(name, fn) { try { fn(); console.log('PASS', name); } catch (error) { console.error('FAIL', name, error.message); process.exitCode = 1; } }

test('creates four ordered two-minute videos with private four-digit answer', () => {
  const challenge = Tube.create();
  assert.strictEqual(challenge.videos.length, 4);
  assert.strictEqual(challenge.code.length, 4);
  challenge.videos.forEach(video => {
    assert.strictEqual(video.duration, 120);
    assert.ok(video.revealAt >= 15 && video.revealAt <= 105);
    assert.ok(video.source.endsWith('.mp4'));
  });
  const publicData = Tube.publicState(challenge);
  assert.strictEqual(publicData.videos.length, 4);
  assert.ok(!('code' in publicData));
  assert.ok(!('digit' in publicData.videos[0]));
  assert.ok(!('revealAt' in publicData.videos[0]));
});

test('validates in video order and supports repeated digits and leading zeroes', () => {
  const challenge = Tube.create();
  challenge.videos.forEach((video, index) => { video.digit = index === 0 || index === 1 ? 0 : 7; });
  challenge.code = '0077';
  assert.strictEqual(Tube.submit(challenge, '0077').ok, true);
  assert.strictEqual(challenge.status, 'complete');
});

test('rejects incorrect attempts without closing the challenge', () => {
  const challenge = Tube.create();
  assert.strictEqual(Tube.submit(challenge, '9999').ok, false);
  assert.strictEqual(challenge.status, 'open');
});

test('rejects expired and malformed submissions', () => {
  const challenge = Tube.create();
  challenge.expiresAt = Date.now() - 1;
  assert.strictEqual(Tube.submit(challenge, '0000').ok, false);
  const fresh = Tube.create();
  assert.strictEqual(Tube.submit(fresh, '12').ok, false);
});
