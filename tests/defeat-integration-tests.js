'use strict';
/* Integration contract for the approved catastrophic-defeat screen.
 *
 * The animation itself was approved as the standalone defeat-preview and is not
 * re-tested here. These tests guard the integration: the exact approved timing,
 * effects and assets are unchanged, the confirmed opponent is the only identity
 * shown, and the scene is allocated once, only for a genuinely defeated local
 * player, then cleaned up. The winning scene must keep working untouched. */
var fs=require('fs'),path=require('path'),Scene=require('../js/defeat-scene'),Victory=require('../js/victory-scene'),E=require('../js/effects');
function runtime(reduced) {
  var b=require('./music-player-tests').browser({track:'off',volume:.25}),calls=[];
  b.context.PhoenixEffects=E;b.context.matchMedia=function(){return {matches:reduced===false?false:true,addEventListener:function(){}};};
  b.context.gsap={set:function(){},ticker:{add:function(){},remove:function(){}},timeline:function(options){
    var labels={},steps=[],ids=[],time=0,end=0,killed=false,paused=true,began=0;
    function cancel(){ids.forEach(b.context.clearTimeout);ids=[];}
    function schedule(){paused=false;began=b.context.Date.now()-time*1000;steps.forEach(function(s){if(!s.done)ids.push(b.context.setTimeout(function(){if(!killed&&!paused){s.done=true;s.fn();}},Math.max(0,s.at-time)*1000));});ids.push(b.context.setTimeout(function(){if(!killed&&!paused)options.onComplete();},Math.max(0,end-time)*1000));}
    function at(position){return typeof position==='string'?labels[position]:position||0;}
    var t={addLabel:function(name,p){labels[name]=p;return t;},
      call:function(fn,args,p){steps.push({fn:fn,at:at(p)});return t;},
      to:function(target,props,p){calls.push({target:target,props:props,at:at(p)});end=Math.max(end,at(p)+(props.duration||0));return t;},
      fromTo:function(target,from,to,p){calls.push({target:target,from:from,props:to,at:at(p)});end=Math.max(end,at(p)+(to.duration||0));return t;},
      time:function(){return paused?time:(b.context.Date.now()-began)/1000;},kill:function(){killed=true;cancel();},
      pause:function(){time=t.time();paused=true;cancel();return t;},resume:function(){schedule();return t;},play:function(){schedule();return t;}};
    return t;
  }};
  b.loadScript('victory-scene.js');b.loadScript('defeat-scene.js');b.loadScript('effects-client.js');
  b.fx=b.context.PhoenixCinematics;b.fx.update({sound:false});b.calls=calls;
  b.document.getElementById('online-screen').hidden=false;b.document.getElementById('phoenix-game').hidden=true;
  return b;
}
function snapshot(over,winner,stream){return {type:'state',started:true,phase:'playing',over:over,seat:0,winner:winner,players:[{id:'human',name:'Joshua',ally:'ted'},{id:'guest',name:'Alex',ally:'elsie'}],effects:{stream:stream||'win',sequence:over?2:1,events:[]}};}
function child(n,cls){if(!n)return null;if(n.className===cls)return n;for(var c of n.children||[]){var result=child(c,cls);if(result)return result;}return null;}
function overlay(b,match){return b.document.body.children.find(function(n){return !n.removed&&(n.className||'').indexOf(match)>=0;});}
function defeatOverlay(b){return overlay(b,'phoenix-defeat-screen');}
function victoryOverlay(b){return overlay(b,'phoenix-winning-screen');}
module.exports=function(test,equal,deepEqual,assert){
  test('approved catastrophic-defeat launches, positions, scales and 7.8s duration are unchanged',function(){
    equal(Scene.DURATION,7.8);deepEqual(Scene.LAUNCHES,[
      {name:'blast',time:1.15,x:0,y:4,scale:3.6,color:[155,65,170,255]},
      {name:'smoke',time:1.15,x:-7,y:1,scale:3,color:[95,70,115,205]},
      {name:'smoke',time:1.15,x:7,y:1,scale:3,color:[95,70,115,205]},
      {name:'embers',time:2.2,x:0,y:5,scale:2.4,color:[255,145,95,220],rotation:[0,0,Math.PI]}]);
  });
  test('every defeat effect is bundled and references the exact approved preview sources',function(){
    deepEqual(Scene.ASSETS,{blast:'assets/victory/effects/boss-death/boss_death.efk',smoke:'assets/card-cinematics/ghost.efk',embers:'assets/card-cinematics/alvin.efk'});
    Object.keys(Scene.ASSETS).forEach(function(key){
      var file=path.join(__dirname,'..',Scene.ASSETS[key]);
      assert(fs.existsSync(file),key+' is bundled at '+Scene.ASSETS[key]);
      assert(fs.statSync(file).size>0,key+' is a real effect binary');
    });
    var preview=fs.readFileSync(path.join(__dirname,'../js/defeat-preview.js'),'utf8');
    assert(preview.indexOf("blast:'assets/victory/effects/boss-death/boss_death.efk'")>=0,'preview uses the same blast');
    assert(preview.indexOf("smoke:'assets/card-cinematics/ghost.efk'")>=0,'preview uses the same smoke');
    assert(preview.indexOf("embers:'assets/card-cinematics/alvin.efk'")>=0,'preview uses the same embers');
  });
  test('defeat identity exposes only the confirmed winner name and drops private fields',function(){
    deepEqual(Scene.identity({name:'<img onerror=secret>',ally:'ted',hand:['secret']}),{name:'<img onerror=secret>'});
    equal(Scene.identity(null).name,'The winner');equal(Scene.identity({}).name,'The winner');
    equal(Scene.identity({name:'x'.repeat(400)}).name.length,100,'over-long names are truncated');
  });
  test('only a defeated local player is routed to the defeat scene; a confirmed win still wins',function(){
    equal(E.matchResult(snapshot(true,'guest')),'defeat');
    equal(E.matchResult(snapshot(true,'human')),'victory');
    var b=runtime();
    b.fx.match(snapshot(false,null));
    b.fx.match(snapshot(true,'guest'));
    assert(defeatOverlay(b),'the defeated seat got the defeat scene');
    equal(victoryOverlay(b),undefined,'and never the winning scene');
    equal(child(defeatOverlay(b),'pd-winner-name').textContent,'Alex');
    equal(b.context.PhoenixDefeatScene.diagnostics().winner.name,'Alex');
    b.fx.resetNetwork();equal(defeatOverlay(b),undefined);
    b.fx.match(snapshot(true,'guest'));equal(defeatOverlay(b),undefined,'a reconnect baseline cannot replay the scene');
    b.fx.match(snapshot(false,null,'fresh'));b.fx.match(snapshot(true,'human','fresh'));
    assert(victoryOverlay(b),'the winner still receives the victory scene');
    equal(defeatOverlay(b),undefined);
  });
  test('a repeated finished snapshot and a replaced celebration cannot stack defeat scenes',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));var first=defeatOverlay(b);
    b.fx.match(snapshot(true,'guest'));equal(defeatOverlay(b),first,'the same scene is reused, not stacked');
    equal(b.document.body.children.filter(function(n){return (n.className||'').indexOf('phoenix-defeat-screen')>=0&&!n.removed;}).length,1);
  });
  test('a defeated local human is shown the defeat scene with the opponent name; a human win keeps victory',function(){
    var b=runtime();b.document.getElementById('phoenix-game').hidden=false;
    var state={over:false,tied:false,winnerSeat:-1,players:[{id:'human',name:'You',isHuman:true},{id:'chatgpt',name:'ChatGPT'}]};
    b.fx.localMatch(state);state.over=true;state.winnerSeat=1;b.fx.localMatch(state,'ted');
    assert(defeatOverlay(b),'a local human loss uses the defeat scene');
    equal(child(defeatOverlay(b),'pd-winner-name').textContent,'ChatGPT');
    b.fx.cleanup();
    var win={over:false,tied:false,winnerSeat:-1,players:[{id:'human',name:'You',isHuman:true},{id:'chatgpt',name:'ChatGPT'}]};
    b.fx.localMatch(win);win.over=true;win.winnerSeat=0;b.fx.localMatch(win,'ted');
    assert(victoryOverlay(b),'a local human win still uses the victory scene');
    equal(defeatOverlay(b),undefined);
  });
  test('reduced motion holds the static approved result, allocates no particles and cleans up at 7.8s',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));
    var d=b.context.PhoenixDefeatScene.diagnostics();
    equal(d.phase,'complete');equal(d.sequence.length,0,'no effect was launched under reduced motion');
    equal(d.ready,false);equal(d.active,true);equal(b.calls.length,0,'no GSAP motion was choreographed');
    assert(defeatOverlay(b));
    b.advance(7799);assert(defeatOverlay(b),'the static result is held, not cut short');
    b.advance(1);equal(defeatOverlay(b),undefined);
    equal(b.fx.diagnostics().celebration,null);
    equal(b.context.PhoenixDefeatScene.diagnostics().stopReason,'reduced-complete');
    equal(b.timers.size,0);
  });
  test('reduced-motion text is revealed immediately and remains readable',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));var n=defeatOverlay(b);
    assert(child(n,'pd-defeat-eyebrow'));
    assert(n.children.length>0);
    ['pd-defeat-eyebrow','pd-defeat-title','pd-defeat-rule','pd-defeat-caption','pd-defeat-winner','pd-defeat-note'].forEach(function(cls){
      assert(child(n,cls),cls+' is present');
    });
    equal(child(n,'pd-winner-name').textContent,'Alex');
    equal(child(n,'pd-skip').textContent,'Skip');
  });
  test('disabled visuals allocate no defeat scene and keep the confirmed result off screen',function(){
    var b=runtime();b.fx.update({visuals:'off'});b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));
    equal(defeatOverlay(b),undefined);equal(victoryOverlay(b),undefined);
  });
  test('a defeat confirmed in a hidden tab allocates nothing and never replays on return',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.document.hidden=true;b.fx.match(snapshot(true,'guest'));
    equal(defeatOverlay(b),undefined);
    b.document.hidden=false;b.dispatch('visibilitychange');equal(defeatOverlay(b),undefined);
  });
  test('Skip dismisses the scene, clears every timer and restores the existing control',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));var n=defeatOverlay(b),skip=child(n,'pd-skip');
    skip.focus();equal(b.document.activeElement,skip);
    skip.listeners.click();equal(defeatOverlay(b),undefined);equal(b.timers.size,0);
    equal(b.document.activeElement,b.nodes['online-settings']);
    b.advance(10000);equal(defeatOverlay(b),undefined);
    equal(b.context.PhoenixDefeatScene.diagnostics().stopReason,'skip');
  });
  test('hiding the tab during a reduced-motion defeat pauses and resumes without replay',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));var n=defeatOverlay(b);
    b.advance(1000);b.document.hidden=true;b.dispatch('visibilitychange');
    equal(b.context.PhoenixDefeatScene.diagnostics().paused,true);b.advance(60000);assert(defeatOverlay(b));
    b.document.hidden=false;b.dispatch('visibilitychange');
    equal(b.context.PhoenixDefeatScene.diagnostics().paused,false);b.advance(6799);assert(defeatOverlay(b),'the held result resumes for its remaining time');
    b.advance(1);equal(defeatOverlay(b),undefined);equal(b.timers.size,0);
  });
  test('changing motion preference mid-defeat disposes the scene without a late announcement',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));assert(defeatOverlay(b));
    b.fx.update({visuals:'off'});b.advance(10000);equal(defeatOverlay(b),undefined);equal(b.timers.size,0);
  });
  test('page exit disposes the defeat renderer and leaves no pending timer',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));assert(defeatOverlay(b));
    b.windowListeners.pagehide();b.advance(10000);equal(defeatOverlay(b),undefined);equal(b.timers.size,0);
  });
  test('when graphics never initialise, defeat falls back to a readable static result within the watchdog',function(){
    var b=runtime(false);b.fx.update({visuals:'full'});
    b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));var n=defeatOverlay(b);assert(n);
    b.advance(10500);
    var d=b.context.PhoenixDefeatScene.diagnostics();
    equal(d.phase,'complete');assert(d.error,'the failure is recorded and reported');
    equal(child(n,'pd-winner-name').textContent,'Alex','the confirmed opponent name survives the fallback');
    b.advance(Scene.DURATION*1000);equal(defeatOverlay(b),undefined);equal(b.timers.size,0);
  });
  test('the Settings defeat test uses the actual scene silently and does not change result baselines',function(){
    var b=runtime();assert(b.fx.testDefeat());var n=defeatOverlay(b);assert(n);
    equal(child(n,'pd-winner-name').textContent,'Defeat preview');
    equal(b.fx.diagnostics().voices,0);
    b.fx.stopPreview();equal(defeatOverlay(b),undefined);equal(b.timers.size,0);
    b.fx.match(snapshot(false,null,'after-preview'));b.fx.match(snapshot(true,'guest','after-preview'));
    assert(defeatOverlay(b));equal(child(defeatOverlay(b),'pd-winner-name').textContent,'Alex');
    b.fx.cleanup();b.fx.update({visuals:'off'});equal(b.fx.testDefeat(),false);equal(defeatOverlay(b),undefined);
  });
  test('the victory scene is unchanged and the defeat scene never replaces it',function(){
    equal(Victory.DURATION,9.7);
    equal(typeof Scene.start,'function');equal(typeof Scene.prepare,'function');equal(typeof Scene.release,'function');
    var b=runtime();equal(typeof b.fx.testVictory,'function');equal(typeof b.fx.testDefeat,'function');
    assert(b.fx.testVictory());assert(victoryOverlay(b));equal(defeatOverlay(b),undefined);b.fx.stopPreview();
    equal(victoryOverlay(b),undefined);equal(b.timers.size,0);
  });
  test('the game page loads the scoped defeat stylesheet and script alongside the victory scene',function(){
    var html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    assert(html.indexOf('css/defeat-scene.css')>=0,'the defeat stylesheet is linked');
    assert(html.indexOf('js/defeat-scene.js')>=0,'the defeat scene script is loaded');
    assert(html.indexOf('css/victory-scene.css')>=0&&html.indexOf('js/victory-scene.js')>=0,'victory is still present');
    assert(html.indexOf('id="settings-defeat-test"')>=0,'a local preview control exists');
  });
  test('the scoped defeat stylesheet keeps the approved composition responsive and reduces motion',function(){
    var css=fs.readFileSync(path.join(__dirname,'../css/defeat-scene.css'),'utf8');
    assert(/@media\s*\(max-width:600px\)/.test(css),'a mobile layout is defined');
    assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css),'a reduced-motion rule is defined');
    assert(/\.phoenix-defeat-screen\s+\{[^}]*position:fixed/.test(css),'the scene is a scoped full-screen overlay');
    assert(css.indexOf('.phoenix-defeat-screen .pd-defeat-title')>=0,'the title is scoped, not the raw preview class');
    assert(css.indexOf('.defeat-stage')<0,'the preview class is never reused unscoped');
  });
};
