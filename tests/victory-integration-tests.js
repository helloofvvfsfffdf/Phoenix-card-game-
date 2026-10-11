'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),Scene=require('../js/victory-scene'),E=require('../js/effects');
function runtime() {
  var b=require('./music-player-tests').browser({track:'off',volume:.25}),calls=[];
  b.context.PhoenixEffects=E;b.context.matchMedia=function(){return {matches:true,addEventListener:function(){}};};
  b.context.gsap={set:function(){},ticker:{add:function(){},remove:function(){}},timeline:function(options){
    var labels={},steps=[],ids=[],time=0,end=0,killed=false;
    function at(position){return typeof position==='string'?labels[position]:position||0;}
    var t={addLabel:function(name,p){labels[name]=p;return t;},
      call:function(fn,args,p){steps.push({fn:fn,at:at(p)});return t;},
      to:function(target,props,p){calls.push({target:target,props:props,at:at(p)});end=Math.max(end,at(p)+(props.duration||0));return t;},
      fromTo:function(target,from,to,p){calls.push({target:target,from:from,props:to,at:at(p)});end=Math.max(end,at(p)+(to.duration||0));return t;},
      time:function(){return time;},kill:function(){killed=true;ids.forEach(b.context.clearTimeout);},
      play:function(){steps.forEach(function(s){ids.push(b.context.setTimeout(function(){if(!killed){time=s.at;s.fn();}},s.at*1000));});ids.push(b.context.setTimeout(function(){if(!killed){time=end;options.onComplete();}},end*1000));return t;}};
    return t;
  }};
  b.loadScript('victory-scene.js');b.loadScript('effects-client.js');b.fx=b.context.PhoenixCinematics;b.fx.update({sound:false});b.calls=calls;
  b.document.getElementById('online-screen').hidden=false;
  return b;
}
function snapshot(over,winner,stream){return {type:'state',started:true,phase:'playing',over:over,seat:0,winner:winner,players:[{id:'human',name:'Joshua',ally:'ted'},{id:'guest',name:'Alex',ally:'elsie'}],effects:{stream:stream||'win',sequence:over?2:1,events:[]}};}
function overlay(b){return b.document.body.children.find(function(n){return !n.removed&&(n.className||'').indexOf('phoenix-winning-screen')>=0;});}
function child(n,cls){if(n.className===cls)return n;for(var c of n.children||[]){var result=child(c,cls);if(result)return result;}return null;}
module.exports=function(test,equal,deepEqual,assert){
  test('approved orb/fireworks launch timing, positions, scales and 9.7s duration are unchanged',function(){
    equal(Scene.DURATION,9.7);deepEqual(Scene.LAUNCHES,[
      {name:'Boss Death',time:0,x:0,y:0,scale:2.8},{name:'Simple Turbulence Fireworks',time:3.15,x:0,y:3,scale:1.6},
      {name:'Simple Turbulence Fireworks',time:4.28,x:-11,y:3,scale:1.3},{name:'Simple Turbulence Fireworks',time:4.82,x:11,y:5,scale:1.4},
      {name:'Simple Turbulence Fireworks',time:5.58,x:-6,y:8,scale:1.2},{name:'Simple Turbulence Fireworks',time:6.2,x:7,y:9,scale:1.3}]);
  });
  test('every runtime, exact effect and required texture is bundled with matching approval hashes',function(){
    var root=path.join(__dirname,'../assets/victory'),manifest=require('../assets/victory/manifest.json'),bytes=0;
    equal(manifest.effekseer,'1.80.7');equal(manifest.gsap,'3.15.0');equal(manifest.files.length,10);
    manifest.files.forEach(function(f){assert(f.file.indexOf('\\')<0);var b=fs.readFileSync(path.join(root,f.file));equal(b.length,f.bytes);equal(crypto.createHash('sha256').update(b).digest('hex'),f.sha256);bytes+=b.length;});
    equal(bytes,1663862);
    equal(manifest.files.find(function(f){return /boss_death\.efk$/.test(f.file);}).sha256,'e609e2a55c420057279e03de143bb7f7782264aff33da1e533f37e98d2148313');
    equal(manifest.files.find(function(f){return /Fireworks\.efkefc$/.test(f.file);}).sha256,'355e506e0fe440da81a4373436608517d1cb2c16dc24c4b28b2f22ad422ae64a');
  });
  test('winner identity whitelists only animal ally IDs and drops private fields',function(){
    deepEqual(Scene.identity({name:'<img onerror=secret>',ally:'ted',hand:['secret']}),{name:'<img onerror=secret>',ally:'ted'});
    equal(Scene.identity({name:'Winner',ally:'../../private'}).ally,null);equal(Scene.identity(null).name,'The champion');
  });
  test('confirmed online winner and ally reach scoped scene once; repeat/reconnect cannot replay',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'human'));var n=overlay(b);assert(n);
    equal(child(n,'pv-winner').textContent,'JOSHUA & TED');equal(b.context.PhoenixVictoryScene.diagnostics().winner.ally,'ted');
    b.advance(3150);equal(b.context.PhoenixVictoryScene.diagnostics().phase,'celebration');
    b.fx.match(snapshot(true,'human'));equal(overlay(b),n);b.fx.resetNetwork();equal(overlay(b),undefined);b.fx.match(snapshot(true,'human'));equal(overlay(b),undefined);equal(b.timers.size,0);
  });
  test('reduced-motion scene retains approved GSAP winner timings and cleans up at 9.7s',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'human'));b.advance(0);
    equal(b.context.PhoenixVictoryScene.diagnostics().phase,'opening');equal(b.context.PhoenixVictoryScene.diagnostics().sequence.length,0);
    var winner=b.calls.find(function(c){return c.target.className==='pv-winner';});equal(winner.at,4.48);equal(winner.props.duration,.85);equal(winner.from.y,0);
    b.advance(9699);assert(overlay(b));b.advance(1);equal(overlay(b),undefined);equal(b.fx.diagnostics().celebration,null);equal(b.timers.size,0);
  });
  test('new winner scene Skip clears GSAP callbacks and restores focus without replay',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'human'));var n=overlay(b),skip=child(n,'pv-skip');
    skip.focus();skip.listeners.click();equal(overlay(b),undefined);equal(b.document.activeElement,b.nodes['online-settings']);equal(b.timers.size,0);b.advance(10000);equal(overlay(b),undefined);
  });
  test('opponents retain subdued defeat and never receive the winning orb/fireworks scene',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'guest'));equal(overlay(b),undefined);assert(b.fx.diagnostics().celebration.indexOf('defeat')>=0);b.advance(2400);equal(b.timers.size,0);
  });
  test('disabled visuals, hidden finish and initial finished snapshot allocate no winner scene',function(){
    var b=runtime();b.fx.update({visuals:'off'});b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'human'));equal(overlay(b),undefined);
    b.fx.update({visuals:'full'});b.document.hidden=true;b.fx.match(snapshot(false,null,'hidden'));b.fx.match(snapshot(true,'human','hidden'));equal(overlay(b),undefined);
    b.document.hidden=false;b.fx.match(snapshot(true,'human','new-completed'));equal(overlay(b),undefined);
  });
  test('local active-to-finished game displays actual winner/ally once and ties do not celebrate',function(){
    var b=runtime();b.document.getElementById('phoenix-game').hidden=false;var state={over:false,tied:false,winnerSeat:-1,players:[{id:'human',name:'Local winner',isHuman:true}]};
    b.fx.localMatch(state,'phoenix');state.over=true;state.winnerSeat=0;b.fx.localMatch(state,'ted');assert(overlay(b));equal(child(overlay(b),'pv-winner').textContent,'LOCAL WINNER & TED');
    b.fx.cleanup();b.fx.localMatch(state,'ted');equal(overlay(b),undefined);
    var tied={over:false,tied:true,winnerSeat:0,players:state.players};b.fx.localMatch(tied,'ted');tied.over=true;b.fx.localMatch(tied,'ted');equal(overlay(b),undefined);
  });
  test('page exit and preference changes dispose winning scene without late announcements',function(){
    var b=runtime();b.fx.match(snapshot(false,null));b.fx.match(snapshot(true,'human'));b.fx.update({visuals:'off'});b.advance(10000);equal(overlay(b),undefined);equal(b.timers.size,0);
    b.fx.update({visuals:'reduced'});b.fx.match(snapshot(false,null,'exit'));b.fx.match(snapshot(true,'human','exit'));b.windowListeners.pagehide();b.advance(10000);equal(overlay(b),undefined);equal(b.timers.size,0);
  });
};
