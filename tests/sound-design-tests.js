'use strict';
var E = require('../js/effects');
var browser = require('./effects-tests').browser;
module.exports = function (test, equal, deepEqual, assert) {
  Object.keys(E.DEFINITIONS).forEach(function (key) {
    test(key + ' renders finite, bounded, non-silent material audio at desktop and mobile rates', function () {
      [8000, 44100, 48000].forEach(function (rate) {
        var recipe = E.soundRecipe(key), pcm = E.renderSound(recipe, rate, 173);
        var peak = 0, energy = 0, dc = 0;
        pcm.forEach(function (x) { assert(Number.isFinite(x)); peak = Math.max(peak,Math.abs(x)); energy += x*x; dc += x; });
        assert(peak <= .781 && peak > .03, 'audible peaks without clipping');
        assert(Math.sqrt(energy/pcm.length) > .008, 'material is not effectively silent');
        assert(Math.abs(dc/pcm.length) < .03, 'no sustained DC');
        assert(pcm.length <= Math.ceil(rate*1.3), 'short bounded tails');
        equal(pcm[0], 0, 'soft onset');
        equal(pcm[pcm.length-1], 0, 'tail has ended');
      });
    });
  });
  test('render is deterministic, changes no recipe and returns independent PCM', function () {
    var recipe = E.soundRecipe('phoenix'), before = JSON.stringify(recipe);
    var a = E.renderSound(recipe,8000,17), b = E.renderSound(recipe,8000,17);
    deepEqual(Array.from(a),Array.from(b)); equal(JSON.stringify(recipe),before);
    a[30]=99; assert(b[30]!==99);
    var c = E.renderSound(recipe,8000,18); assert(c.some(function (x,i) { return x!==b[i]; }));
  });
  test('inert outcomes stay quieter and have no fire, attack or successful verdict', function () {
    var active=E.renderSound(E.soundRecipe('judge'),8000,173), inert=E.renderSound(E.soundRecipe('judge',true),8000,173);
    function peak(pcm) { return pcm.reduce(function (p,x) { return Math.max(p,Math.abs(x)); },0); }
    assert(peak(inert)<peak(active)*.5);
    deepEqual(E.soundRecipe('judge',true).layers.map(function (l) { return l.kind; }),['wood','cloth']);
  });
  test('repeated sounds reuse PCM; three sources max, mute and page exit stop them', function () {
    var b=browser(); b.api.unlock();
    b.api.show(E.publicEvent('knife',0,1));
    var first=b.contexts[0].nodes.find(function (n) { return n.buffer; });
    b.api.show(E.publicEvent('knife',0,1));
    var sources=b.contexts[0].nodes.filter(function (n) { return n.buffer; });
    equal(sources.length,2); equal(first.buffer,sources[1].buffer,'cache reused');
    ['phoenix','zombie','ally-ted'].forEach(function (key) { b.api.show(E.publicEvent(key,0,1)); });
    equal(b.api.diagnostics().voices,3); equal(first.stopped,true); equal(first.disconnected,true);
    b.api.update({sound:false}); equal(b.api.diagnostics().voices,0);
    b.close(); equal(b.api.diagnostics().audio,'uninitialised');
  });
};
