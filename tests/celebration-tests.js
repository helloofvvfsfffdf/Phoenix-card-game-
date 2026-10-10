'use strict';
var E = require('../js/effects');
var effectsBrowser = require('./effects-tests').browser;
var musicBrowser = require('./music-player-tests').browser;
function snapshot(over, winner, sequence, stream, seat) {
  return { type: 'state', started: true, phase: 'playing', over: over, winner: winner,
    seat: seat === undefined ? 0 : seat, players: [{id:'human'},{id:'guest'}],
    effects: {stream:stream || 'match-a',sequence:sequence || 0,events:[]} };
}
function runtime(reduced) {
  var b=musicBrowser({track:'epic',volume:.25}), mock=effectsBrowser(reduced);
  b.attempts[0].resolve();
  b.context.PhoenixEffects=E; b.context.AudioContext=mock.context.AudioContext;
  b.context.matchMedia=mock.context.matchMedia; b.context.innerWidth=375; b.context.innerHeight=812;
  b.loadScript('effects-client.js'); b.fx=b.context.PhoenixCinematics; b.fx.unlock();
  return b;
}
function overlay(b) { return b.document.body.children.find(function (n) { return !n.removed && (n.className || '').indexOf('match-celebration')===0; }); }
module.exports = function(test,equal,deepEqual,assert) {
  test('preview selector contains every implemented card/ally and fanfare, but no dormant abilities',function(){
    var options=E.previews(), b=effectsBrowser();
    equal(b.nodes['settings-effects-choice'].children.length,options.length);
    ['victory','defeat','draw','bonus','alvin-burn','block-ted','ally-maple'].forEach(function(k){assert(options.some(function(p){return p.key===k;}));});
    ['ally-tilly','ally-louie','ally-simba','ally-elsie'].forEach(function(k){assert(!options.some(function(p){return p.key===k;}));});
    equal(E.publicEvent('victory',0),null,'no synthetic victory enters the server effect channel');
    equal(b.api.diagnostics().audio,'uninitialised');
  });
  E.previews().forEach(function(p){
    test('preview '+p.key+' plays only its intended recipe without a game or preference changes',function(){
      var b=effectsBrowser(), before=b.api.prefs();
      equal(b.api.preview(p.key),true); equal(b.soundCalls[0].key,p.key);
      equal(b.api.diagnostics().voices,1); equal(b.api.diagnostics().visuals,0);
      deepEqual(b.api.prefs(),before); b.api.stopPreview(); equal(b.api.diagnostics().voices,0); equal(b.timers.size,0);
    });
  });
  test('rapid previews replace rather than stack; invalid and muted previews cannot allocate voices',function(){
    var b=effectsBrowser(); b.api.preview('victory'); b.api.preview('knife'); equal(b.api.diagnostics().voices,1);
    equal(b.api.preview('secret-hand'),false); equal(b.api.preview('ally-tilly'),false);
    b.api.update({sound:false}); b.api.preview('victory'); equal(b.api.diagnostics().voices,0);
    assert(b.nodes['settings-preview-status'].textContent.indexOf('muted')>=0);
    b.api.update({sound:true,volume:0}); b.api.preview('knife'); equal(b.api.diagnostics().voices,0);
  });
  test('cancelled pending audio unlock cannot start an old preview later',function(){
    var b=effectsBrowser(), pending=[];
    b.context.AudioContext.prototype.resume=function(){
      this.state='suspended'; var ctx=this, callbacks=[];
      pending.push(function(){ctx.state='running';callbacks.forEach(function(fn){fn();});});
      return {then:function(fn){callbacks.push(fn);}};
    };
    b.api.preview('victory'); b.api.preview('knife'); b.api.stopPreview();
    pending.forEach(function(resolve){resolve();}); equal(b.api.diagnostics().voices,0);
  });
  test('idle fanfare warmup caches without playing and is cancelled on page exit',function(){
    var b=effectsBrowser(), idle, cancelled=false, renders=0;
    var render=b.context.PhoenixEffects.renderSound;
    b.context.PhoenixEffects.renderSound=function(){renders++;return render.apply(null,arguments);};
    b.context.requestIdleCallback=function(fn){idle=fn;return 17;};
    b.context.cancelIdleCallback=function(id){equal(id,17);cancelled=true;};
    b.api.unlock();equal(b.api.diagnostics().voices,0);idle();equal(renders,1);
    b.api.preview('victory');equal(renders,1,'fanfare uses warmed PCM');b.api.stopPreview();b.close();
    var second=effectsBrowser();second.context.requestIdleCallback=function(){return 17;};
    second.context.cancelIdleCallback=function(){cancelled=true;};cancelled=false;second.api.unlock();second.close();assert(cancelled);
  });
  test('system motion change and page exit clean active celebration without rearming it',function(){
    var b=effectsBrowser();b.api.unlock();b.api.match(snapshot(false,null,1));b.api.match(snapshot(true,'human',2));
    assert(b.api.diagnostics().celebration);b.media.matches=true;b.media.change();
    equal(b.api.diagnostics().celebration,null);equal(b.api.diagnostics().voices,0);
    b.api.match(snapshot(true,'human',3));equal(b.api.diagnostics().celebration,null);b.close();equal(b.timers.size,0);
  });
  test('reward uses a bounded coin cascade; special actions have layered auras',function(){
    var b=runtime(); b.fx.show(E.publicEvent('bonus',0));
    var n=b.document.body.children.find(function(c){return c.dataset.effect==='bonus';}); equal(n.dataset.level,'1');
    equal(n.children.filter(function(c){return c.className==='cinematic-mote';}).length,12);
    b.fx.show(E.publicEvent('knife',0,1)); var special=b.document.body.children.find(function(c){return c.dataset.effect==='knife';});equal(special.dataset.level,'2');
    assert(special.children.some(function(c){return c.className==='cinematic-ribbon';}));
    b.advance(1600); equal(b.fx.diagnostics().visuals,0); equal(b.fx.diagnostics().voices,0);
  });
  test('only active-to-finished server snapshots celebrate; repeats/stale/reconnects cannot repeat',function(){
    var cursor=E.endCursor();equal(cursor.consume(snapshot(false,null,1)),null);
    equal(cursor.consume(snapshot(true,'human',2)),'victory');
    equal(cursor.consume(snapshot(true,'human',2)),null);equal(cursor.consume(snapshot(false,null,1)),null);
    equal(cursor.consume(snapshot(true,'human',3)),null);cursor.reset();equal(cursor.consume(snapshot(true,'human',3)),null);
    equal(E.endCursor().consume(snapshot(true,'human',3)),null,'completed first snapshot is a baseline');
    equal(cursor.consume(snapshot(false,null,1,'new-match')),null);equal(cursor.consume(snapshot(true,'guest',2,'new-match')),'defeat');
  });
  test('winner comes from confirmed player IDs and own seat, never score guessing',function(){
    equal(E.matchResult(snapshot(true,'human',1)), 'victory');equal(E.matchResult(snapshot(true,'human',1,'match',1)), 'defeat');
    equal(E.matchResult(snapshot(true,null,1)), 'draw');equal(E.matchResult(snapshot(true,'unknown',1)),null);
    equal(E.matchResult(snapshot(false,'human',1)),null);equal(E.matchResult(Object.assign(snapshot(true,'human',1),{seat:8})),null);
    equal(E.matchResult(Object.assign(snapshot(true,'human',1),{type:'effect'})),null);
  });
  test('five-second win stage has fireworks/particles, skip, no focus theft and complete cleanup',function(){
    var b=runtime();b.document.activeElement=b.nodes['settings-back'];
    b.fx.match(snapshot(false,null,1)); b.fx.match(snapshot(true,'human',2));
    var n=overlay(b);assert(n);equal(b.document.activeElement,b.nodes['settings-back']);
    var scene=n.children[0];assert(scene.children.some(function(c){return c.className==='celebration-burst';}));
    equal(scene.children.length,39,'bounded mobile decorations');equal(b.fx.diagnostics().voices,1);
    b.advance(4999);assert(overlay(b));b.advance(1);equal(overlay(b),undefined);equal(b.fx.diagnostics().voices,0);equal(b.timers.size,0);
  });
  test('skip stops fanfare and clears animation/timers without changing music preferences',function(){
    var b=runtime();b.fx.match(snapshot(false,null,1));b.fx.match(snapshot(true,'human',2));
    overlay(b).children[2].listeners.click();equal(overlay(b),undefined);equal(b.fx.diagnostics().voices,0);equal(b.timers.size,0);
    deepEqual(b.api.prefs(),{track:'epic',volume:.25});b.fx.match(snapshot(true,'human',3));equal(overlay(b),undefined);
  });
  test('losers get only a subdued defeat coda, not winner fireworks',function(){
    var b=runtime();b.fx.match(snapshot(false,null,1));b.fx.match(snapshot(true,'guest',2));
    var n=overlay(b);assert(n.className.indexOf('celebration-defeat')>=0);equal(n.children[0].children.length,0);
    b.advance(2400);equal(overlay(b),undefined);equal(b.fx.diagnostics().voices,0);
  });
  test('reduced motion and disabled visuals respect SFX independently',function(){
    var b=runtime(true);b.fx.match(snapshot(false,null,1));b.fx.match(snapshot(true,'human',2));
    var n=overlay(b);assert(n.className.indexOf('celebration-reduced')>=0);equal(n.children[0].children.length,0);equal(b.fx.diagnostics().voices,1);
    b.fx.skipCelebration();b.fx.update({visuals:'off'});b.fx.match(snapshot(false,null,1,'second'));b.fx.match(snapshot(true,'human',2,'second'));
    equal(overlay(b),undefined);equal(b.fx.diagnostics().voices,1);b.fx.cleanup();equal(b.timers.size,0);
  });
  test('hidden finish and disconnect cleanup do not replay terminal celebration',function(){
    var b=runtime();b.fx.match(snapshot(false,null,1));b.document.hidden=true;b.fx.match(snapshot(true,'human',2));
    equal(b.fx.diagnostics().voices,0);b.document.hidden=false;b.fx.match(snapshot(true,'human',3));equal(overlay(b),undefined);
    b.fx.resetNetwork();b.fx.match(snapshot(true,'human',3));equal(overlay(b),undefined);
  });
  test('real multiplayer handler celebrates winner once and preserves immediate match-end music',function(){
    var b=require('./match-audio-tests').online(), mock=effectsBrowser();
    b.context.PhoenixEffects=E;b.context.AudioContext=mock.context.AudioContext;b.context.matchMedia=mock.context.matchMedia;
    b.context.innerWidth=900;b.context.innerHeight=800;b.loadScript('effects-client.js');
    var fx=b.context.PhoenixCinematics;fx.unlock();b.receive('playing',false,{effects:{stream:'actual',sequence:1,events:[]}});b.advance(450);
    b.receive('playing',true,{winner:'human',effects:{stream:'actual',sequence:2,events:[]}});
    assert(fx.diagnostics().celebration.indexOf('victory')>=0);equal(b.attempts.length,2);b.attempts[1].resolve();equal(b.audio.paused,false);
    b.receive('playing',true,{winner:'human',effects:{stream:'actual',sequence:2,events:[]}});equal(fx.diagnostics().voices,1);
    b.context.PhoenixOnline.leave();equal(fx.diagnostics().celebration,null);equal(fx.diagnostics().voices,0);
  });
};
