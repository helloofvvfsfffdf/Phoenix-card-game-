'use strict';
/* PHOENIX — Mock mode tests (batch 1). */
const assert = require('assert');
const dispatcher = require('../js/game-modes/dispatcher');

function run() {
  let p = 0, f = 0;
  function check(n, c, d) { if (c) { console.log('PASS ' + n); p++; } else { console.log('FAIL ' + n + (d ? ': ' + d : '')); f++; } }
  const names = dispatcher.listModes();
  check('all 5 modes listed', names.length === 5, String(names.length));
  check('total-chaos exists', names.includes('total-chaos'));
  check('king-of-phoenix exists', names.includes('king-of-phoenix'));
  check('sudden-death exists', names.includes('sudden-death'));
  check('card-roulette exists', names.includes('card-roulette'));
  check('democracy exists', names.includes('democracy'));
  const tc = dispatcher.getMode('total-chaos');
  check('total-chaos module loaded', !!tc);
  const ev = tc.triggerEvent({ players: [{}, {}] });
  check('total-chaos event generated', !!ev && ev.event);
  check('total-chaos onRoundComplete at round 3', !!tc.onRoundComplete({ players: [{}, {}] }, 3));
  const k = dispatcher.getMode('king-of-phoenix');
  check('king-of-phoenix module loaded', !!k);
  const s = dispatcher.getMode('sudden-death');
  check('sudden-death module loaded', !!s);
  console.log('=== Mode Batch Mock: ' + p + ' passed, ' + f + ' failed ===');
  if (f > 0) process.exitCode = 1;
}
run();
