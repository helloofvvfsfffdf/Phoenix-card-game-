'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto');
var Scene=require('../js/phoenix-scene'),Sound=require('../js/sound-design'),E=require('../js/effects'),Rules=require('../js/rules');
function runtime(reduced, existing) {
  var b=existing || require('./music-player-tests').browser({track:'off',volume:.25});
  var audio=require('./effects-tests').browser(reduced);
  b.context.PhoenixEffects=E;b.context.AudioContext=audio.context.AudioContext;b.context.matchMedia=audio.context.matchMedia;
  b.context.innerWidth=375;b.context.innerHeight=812;
  var create=b.document.createElement;
  function canvasContext(){return {clearRect:function(){},drawImage:function(){},fillRect:function(){},beginPath:function(){},ellipse:function(){},fill:function(){},stroke:function(){},moveTo:function(){},lineTo:function(){},save:function(){},restore:function(){},createRadialGradient:function(){return {addColorStop:function(){}};}};}
  b.document.createElement=function(tag){var n=create(tag);if(tag==='canvas')n.getContext=canvasContext;
    if(tag==='video'){n.pause=function(){n.paused=true;};n.play=function(){n.paused=false;return {catch:function(){}};};n.load=function(){};}
    return n;};
  b.loadScript('phoenix-scene.js');b.loadScript('effects-client.js');b.fx=b.context.PhoenixCinematics;b.fx.unlock();return b;
}
function stage(b){return b.document.body.children.find(function(n){return !n.removed&&(n.className||'').indexOf('phoenix-takeover')===0;});}
module.exports=function(test,equal,deepEqual,assert){
  test('all non-Phoenix sounds, ally recipes and victory/defeat remain byte-for-byte unchanged',function(){
    var h=crypto.createHash('sha256');Object.keys(E.DEFINITIONS).filter(function(k){return k!=='phoenix';}).concat(['victory','defeat','draw']).forEach(function(k){h.update(k);h.update(JSON.stringify(Sound.recipe(k)));h.update(JSON.stringify(Sound.recipe(k,true)));});
    equal(h.digest('hex'),'3cde16096c7dccd51dcbc9d0ed4ea0e3bd8b1f334adb17e5c5d3b9f054dec991','baseline 79bf62b recipes');
  });
  test('Phoenix media sizes/hashes match the documented derivatives and mobile budget',function(){
    var root=path.join(__dirname,'../assets/phoenix'),manifest=require('../assets/phoenix/manifest.json'),total=0;
    manifest.derivatives.forEach(function(f){var bytes=fs.readFileSync(path.join(root,f.name));equal(bytes.length,f.bytes);equal(crypto.createHash('sha256').update(bytes).digest('hex'),f.sha256);total+=bytes.length;});
    assert(total<700000);assert(manifest.mix.stagedPeak<=.68);assert(manifest.mix.stagedRms<=.14);
    assert(fs.readFileSync(path.join(root,'LICENSES.md'),'utf8').indexOf('CC0')>=0);
  });
  test('full Phoenix stage is capped to 24fps, bounded pixels/particles and a 4.4-second lifetime',function(){
    [[375,812],[1280,900],[3840,2160],[812,375]].forEach(function(size){var p=Scene.plan(size[0],size[1],false);assert(p.width*p.height<=750000);equal(p.fps,24);assert(p.embers<=80);equal(p.duration,4400);});
    equal(Scene.plan(375,812,true).embers,0);equal(Scene.plan(375,812,true).duration,1800);
    equal(Scene.timeline(100).phase,'summoning');equal(Scene.timeline(1250).phase,'impact');equal(Scene.timeline(3350).phase,'return');equal(Scene.timeline(4400).energy,0);
  });
  test('actual local engine Phoenix outcome starts one takeover without altering resolved rules',function(){
    var s=Rules.createGame({seed:42,fixedOrder:true,rotateStart:false,rounds:8}),actor=s.players[s.turnInRound];actor.hasPhoenix=true;
    s.players.forEach(function(p,i){p.points=i*10000;});var result=Rules.playCard(s,actor.seat,'phoenix',null);assert(result.ok);
    var before=JSON.stringify(s),b=runtime();b.fx.rules(result.events);equal(JSON.stringify(s),before);
    assert(stage(b));equal(b.fx.diagnostics().phoenix,'summoning');equal(b.fx.diagnostics().voices,1);
    b.advance(1250);equal(b.fx.diagnostics().phoenix,'impact');b.advance(3149);assert(stage(b));b.advance(1);equal(stage(b),undefined);equal(b.fx.diagnostics().voices,0);equal(b.timers.size,0);
  });
  test('authoritative journal shows Phoenix to every observer exactly once, no secret fields',function(){
    var observers=[runtime(),runtime(),runtime()],j={stream:'public-fire',sequence:0,events:[]};
    observers.forEach(function(b){b.fx.consume(j);});E.append(j,Object.assign(E.publicEvent('phoenix',0),{hand:['secret'],name:'secret'}));
    observers.forEach(function(b){b.fx.consume(j);assert(stage(b));b.fx.consume(j);equal(b.fx.diagnostics().voices,1);b.fx.cleanup();equal(b.timers.size,0);b.fx.resetNetwork();b.fx.consume(j);equal(stage(b),undefined);});
    deepEqual(Object.keys(j.events[0]).sort(),['actor','id','key','outcome','target']);
  });
  test('Phoenix wins event-batch priority even when more than eight later presentation events exist',function(){
    var b=runtime(),j={stream:'busy',sequence:0,events:[]};b.fx.consume(j);E.append(j,E.publicEvent('phoenix',0));
    for(var i=0;i<10;i++)E.append(j,E.publicEvent('bonus',1));b.fx.consume(j);assert(stage(b));equal(b.fx.diagnostics().voices,1);
    b.fx.cleanup();b.fx.consume(j);equal(stage(b),undefined);
  });
  test('Phoenix card does not replace the Phoenix ally theft animation',function(){
    var b=runtime();b.fx.show(E.publicEvent('ally-phoenix',0,1));equal(stage(b),undefined);equal(b.fx.diagnostics().visuals,1);b.fx.cleanup();
  });
  test('standalone cinematic preview creates no game and stops via Stop, Skip or Escape',function(){
    var b=runtime();b.nodes['settings-phoenix-cinematic'].listeners.click();assert(stage(b));
    assert(stage(b).className.indexOf('preview')>=0);equal(b.context.phoenix,undefined);
    b.fx.stopPreview();equal(stage(b),undefined);equal(b.timers.size,0);
    b.nodes['settings-phoenix-cinematic'].listeners.click();stage(b).children[4].listeners.click();equal(stage(b),undefined);equal(b.fx.diagnostics().voices,0);
    b.nodes['settings-phoenix-cinematic'].listeners.click();b.dispatch('keydown',null,{key:'Escape',preventDefault:function(){}});equal(stage(b),undefined);
  });
  test('reduced Phoenix is static, short and has independent saved SFX preferences',function(){
    var b=runtime(true);b.fx.update({sound:false});b.fx.show(E.publicEvent('phoenix',0));
    assert(stage(b).className.indexOf('static')>=0);equal(stage(b).dataset.media,'static-reduced');equal(b.fx.diagnostics().voices,0);
    b.advance(1800);equal(stage(b),undefined);deepEqual(b.api.prefs(),{track:'off',volume:.25});
    b.fx.update({visuals:'off',sound:true});b.fx.show(E.publicEvent('phoenix',0));equal(stage(b),undefined);equal(b.fx.diagnostics().voices,1);b.fx.cleanup();
  });
  test('match-end celebration waits for Phoenix impact sequence without changing saved music',function(){
    var b=runtime(),base={type:'state',started:true,phase:'playing',over:false,winner:null,seat:0,players:[{id:'human'}],effects:{stream:'ending',sequence:0,events:[]}};
    b.fx.match(base);b.fx.show(E.publicEvent('phoenix',0));b.fx.match(Object.assign({},base,{over:true,winner:'human',effects:{stream:'ending',sequence:1,events:[]}}));
    equal(b.fx.diagnostics().celebration,null);assert(stage(b));b.advance(4400);equal(stage(b),undefined);assert(b.fx.diagnostics().celebration.indexOf('victory')>=0);b.advance(5000);equal(b.timers.size,0);
  });
  test('real online handler restores music immediately while a finishing Phoenix queues victory',function(){
    var b=runtime(false,require('./match-audio-tests').online());
    b.receive('playing',false,{effects:{stream:'last-legendary',sequence:0,events:[]}});b.advance(450);
    b.receive('playing',true,{winner:'human',effects:{stream:'last-legendary',sequence:1,events:[{id:1,key:'phoenix',actor:0,target:-1,outcome:'active'}]}});
    assert(stage(b));equal(b.fx.diagnostics().celebration,null);equal(b.attempts.length,2);b.attempts[1].resolve();equal(b.audio.paused,false);
    b.advance(4400);assert(b.fx.diagnostics().celebration.indexOf('victory')>=0);equal(b.audio.paused,false);b.context.PhoenixOnline.leave();equal(b.timers.size,0);
  });
  test('disconnect and page exit cancel Phoenix and any queued victory without late replay',function(){
    var b=runtime();b.fx.match({type:'state',started:true,phase:'playing',over:false,seat:0,players:[{id:'human'}],effects:{stream:'exit',sequence:0,events:[]}});
    b.fx.show(E.publicEvent('phoenix',0));b.fx.match({type:'state',started:true,phase:'playing',over:true,winner:'human',seat:0,players:[{id:'human'}],effects:{stream:'exit',sequence:1,events:[]}});
    b.fx.resetNetwork();b.advance(10000);equal(stage(b),undefined);equal(b.fx.diagnostics().celebration,null);equal(b.timers.size,0);
    b.fx.show(E.publicEvent('phoenix',0));b.windowListeners.pagehide();b.advance(10000);equal(b.fx.diagnostics().voices,0);equal(b.timers.size,0);
  });
};
