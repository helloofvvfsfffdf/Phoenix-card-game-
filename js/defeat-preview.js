/* Approval-only cinematic. No rules, sockets, live results or audio imports. */
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id);},stage=$('defeat-stage'),canvas=$('defeat-particles');
  var media=matchMedia('(prefers-reduced-motion: reduce)'),status=$('preview-status'),reduced=$('reduced');
  var DURATION=7.8,timeline=null,renderer=null,preparation=null,ticking=false,paused=false,serial=0,released=false;
  var lastTime=0,accumulator=0,watchdog=null,loadTimer=null;
  var stats={plays:0,completed:0,frames:0,launches:[],error:null,phase:'idle',reason:null};
  var ASSETS={blast:'assets/victory/effects/boss-death/boss_death.efk',smoke:'assets/card-cinematics/ghost.efk',embers:'assets/card-cinematics/alvin.efk'};
  var TARGETS='.fallen-crest,.defeat-eyebrow,#defeat-title span,.defeat-rule,.defeat-caption,.defeat-winner,.defeat-note';
  reduced.checked=media.matches;
  var shards=[],field=document.querySelector('.ash-field');
  for(var i=0;i<42;i++){var shard=document.createElement('i');shard.className='ash-feather'+(i%3===0?' is-ember':'');field.appendChild(shard);shards.push(shard);}
  function mode(){return reduced.checked||media.matches;}
  function phase(value){stats.phase=value;stage.dataset.phase=value;}
  function clearCanvas(){if(renderer&&!renderer.gl.isContextLost()){renderer.gl.clearColor(0,0,0,0);renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT|renderer.gl.DEPTH_BUFFER_BIT);}}
  function idle(){clearTimeout(watchdog);watchdog=null;if(ticking){gsap.ticker.remove(render);ticking=false;}if(renderer&&!renderer.lost)renderer.context.stopAll();clearCanvas();}
  function settle(){
    if(window.gsap){gsap.set(TARGETS,{clearProps:'all'});gsap.set('.crest-left,.crest-right,.last-ember,.ember-glow',{clearProps:'all'});gsap.set(stage,{clearProps:'transform'});gsap.set('.impact-well,.shockwave,.impact-cut,.light-scar',{opacity:0});gsap.set('.impact-vignette',{opacity:.35});gsap.set(shards,{opacity:0});}
  }
  function end(reason){if(timeline)timeline.kill();timeline=null;paused=false;idle();settle();phase('complete');stats.reason=reason;stats.completed++;$('replay').disabled=false;status.textContent=(stats.error?'Static fallback · '+stats.error+' · ':mode()?'Reduced motion · ':'')+'Complete · renderer idle · result held for approval.';}
  function halt(){serial++;if(timeline)timeline.kill();timeline=null;paused=false;idle();$('replay').disabled=false;}
  function dispose(r){if(!r||r.disposed)return;r.disposed=true;r.context.stopAll();Object.keys(r.effects).forEach(function(key){r.context.releaseEffect(r.effects[key]);});effekseer.releaseContext(r.context);}
  function prepare(){
    if(renderer&&renderer.lost){var old=renderer;renderer=null;preparation=null;dispose(old);}
    if(preparation)return preparation;
    var r=null,cancelled=false;
    preparation=new Promise(function(resolve,reject){
      function fail(error){if(cancelled)return;cancelled=true;clearTimeout(loadTimer);loadTimer=null;if(r){r.cancelled=true;if(r.settled)dispose(r);if(renderer===r)renderer=null;}preparation=null;reject(error instanceof Error?error:Error(String(error)));}
      loadTimer=setTimeout(function(){fail('Particle loading timed out');},10000);
      if(!window.PhoenixParticleRuntime){fail('Effekseer unavailable');return;}
      PhoenixParticleRuntime.prepare().then(function(){
        if(cancelled||released)return;
        try{
          var gl=canvas.getContext('webgl2',{alpha:true,antialias:false,preserveDrawingBuffer:true})||canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true});
          if(!gl)throw Error('WebGL unavailable');var context=effekseer.createContext();context.init(gl,{instanceMaxCount:1024});
          r={gl:gl,context:context,effects:{},settled:false,cancelled:false,lost:false};renderer=r;
          function load(key){return new Promise(function(done,failed){var effect=context.loadEffect(ASSETS[key],1,function(){r.effects[key]=effect;done(effect);},function(reason,url){failed(Error(url+': '+reason));});});}
          Promise.allSettled(Object.keys(ASSETS).map(load)).then(function(results){
            r.settled=true;if(cancelled||released||r.cancelled){dispose(r);return;}
            var failure=results.find(function(result){return result.status==='rejected';});if(failure){fail(failure.reason);return;}
            clearTimeout(loadTimer);loadTimer=null;resolve(r);
          });
        }catch(error){fail(error);}
      },fail);
    });return preparation;
  }
  function spawn(key,x,y,scale,color,rotation){
    if(!renderer||renderer.lost||mode())return;
    var handle=renderer.context.play(renderer.effects[key],x,y,0);
    if(!handle)return;
    handle.setScale(scale,scale,scale);handle.setAllColor(color[0],color[1],color[2],color[3]);if(rotation)handle.setRotation(rotation[0],rotation[1],rotation[2]);
    stats.launches.push({effect:key,at:Number(timeline.time().toFixed(3))});
  }
  function render(){
    if(!timeline||paused||document.hidden||!renderer||renderer.lost)return;
    try{
      var time=timeline.time(),dt=Math.min(.08,Math.max(0,time-lastTime));lastTime=time;accumulator+=dt;if(accumulator<1/30)return;
      var r=renderer,box=stage.getBoundingClientRect(),limit=innerWidth<600?800:1120,ratio=Math.min(devicePixelRatio||1,1.25,limit/Math.max(box.width,box.height));
      var w=Math.max(1,Math.round(box.width*ratio)),h=Math.max(1,Math.round(box.height*ratio));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      r.context.update(Math.min(accumulator,.1)*60);accumulator=0;r.gl.viewport(0,0,w,h);clearCanvas();
      r.context.setProjectionPerspective(40,w/h,.1,200);var distance=Math.max(40,30/(.728*w/h));r.context.setCameraLookAt(0,-2,distance,0,-2,0,0,1,0);r.context.draw();stats.frames++;
    }catch(error){stats.error=String(error.message||error);end('graphics-fallback');}
  }
  function build(){
    settle();lastTime=0;accumulator=0;stats.plays++;stats.reason=null;stats.launches=[];phase('anticipation');
    gsap.set(TARGETS,{opacity:0});gsap.set('.fallen-crest',{opacity:.7,scale:1,y:-12});gsap.set('.last-ember',{opacity:1});gsap.set('.impact-vignette',{opacity:.7});
    timeline=gsap.timeline({paused:true,onComplete:function(){end('complete');}});
    timeline.addLabel('impact',1.15).addLabel('defeat',2.2).addLabel('aftermath',3.5);
    timeline.to('.fallen-crest',{scale:1.18,y:-18,duration:1.15,ease:'power2.in'},0)
      .to('.last-ember',{opacity:.22,duration:1.1},0).to('.ember-glow',{opacity:.12,duration:1.05},0)
      .call(function(){phase('impact');spawn('blast',0,4,3.6,[155,65,170,255]);spawn('smoke',-7,1,3,[95,70,115,205]);spawn('smoke',7,1,3,[95,70,115,205]);},null,'impact')
      .fromTo('.impact-well',{opacity:0,scale:.12},{opacity:.82,scale:1.35,duration:.45,ease:'expo.out'},'impact')
      .to('.impact-well',{opacity:.15,scale:1.65,duration:2.8},1.6)
      .fromTo('.shock-one',{opacity:.8,scale:.12},{opacity:0,scale:7,duration:.85,ease:'power3.out'},'impact')
      .fromTo('.shock-two',{opacity:.6,scale:.1},{opacity:0,scale:6,duration:1.1,ease:'power3.out'},1.29)
      .fromTo('.impact-cut',{opacity:0,scaleX:.1},{opacity:.85,scaleX:1,duration:.13,ease:'expo.out'},'impact').to('.impact-cut',{opacity:0,duration:.7},1.3)
      .to('.crest-left',{x:-45,y:65,rotation:-38,opacity:0,duration:.75,ease:'power2.in'},'impact')
      .to('.crest-right',{x:45,y:65,rotation:38,opacity:0,duration:.75,ease:'power2.in'},'impact').to('.last-ember',{opacity:0,scale:0,duration:.35},'impact')
      .to('.fallen-crest',{opacity:0,duration:.35},1.8)
      .call(function(){phase('defeat');spawn('embers',0,5,2.4,[255,145,95,220],[0,0,Math.PI]);},null,'defeat')
      .fromTo('.defeat-eyebrow',{opacity:0,y:-6},{opacity:1,y:0,duration:.65},1.95)
      .fromTo('#defeat-title span',{opacity:0,y:-45,rotationX:65,scale:1.5},{opacity:1,y:0,rotationX:0,scale:1,duration:.9,stagger:.065,ease:'expo.out'},'defeat')
      .fromTo('.defeat-rule',{opacity:0,scaleX:.05},{opacity:1,scaleX:1,duration:.75,ease:'power3.out'},2.6)
      .fromTo('.defeat-caption',{opacity:0,y:12},{opacity:1,y:0,duration:.8},2.9)
      .fromTo('.defeat-winner',{opacity:0,y:14},{opacity:1,y:0,duration:.8},3.3)
      .fromTo('.defeat-note',{opacity:0},{opacity:1,duration:.9},3.7)
      .to('.impact-vignette',{opacity:.35,duration:2},3)
      .call(function(){phase('aftermath');},null,'aftermath')
      .to('.ember-glow',{opacity:.35,duration:2},4).to('.ember-glow',{opacity:.15,duration:1},6.8)
      .to('.fallen-crest',{opacity:.32,scale:.8,y:0,duration:1.5},5.9);
    // Camera-like kick is confined to the preview surface; controls never shake.
    [{x:-10,y:5,r:-.35},{x:9,y:-4,r:.3},{x:-7,y:3,r:-.22},{x:5,y:-2,r:.16},{x:-3,y:1,r:-.1},{x:0,y:0,r:0}].forEach(function(k,index){timeline.to(stage,{x:k.x,y:k.y,rotation:k.r,duration:.065,ease:'none'},1.15+index*.065);});
    shards.forEach(function(shard,index){var side=index%2===0?-1:1,span=Math.min(stage.clientWidth*.4,450),x=side*(35+(index*37%100)/100*span),y=-90+(index*19%100);
      timeline.fromTo(shard,{x:x*.2,y:y-80,rotation:side*18,opacity:0},{x:x,y:y+100,rotation:side*(90+index*4),opacity:index%3===0?.9:.45,duration:1.3+(index%5)*.15,ease:'power2.out'},1.15+(index%7)*.055)
        .to(shard,{y:y+stage.clientHeight*.7,opacity:0,duration:3.4,ease:'power1.in'},2.3+(index%4)*.2);
    });
    timeline.to({}, {duration:.01},DURATION-.01);
    if(renderer&&!renderer.lost){gsap.ticker.add(render);ticking=true;}
    status.textContent='Playing · Effekseer impact, smoke and embers · GSAP choreography · silent.';
    $('replay').disabled=false;
    if(document.hidden){paused=true;}else{if(gsap.ticker.tick)gsap.ticker.tick();timeline.play(0);armWatchdog();}
  }
  function armWatchdog(){clearTimeout(watchdog);watchdog=setTimeout(function(){if(timeline&&!paused){stats.error='Animation completion watchdog';end('watchdog');}},Math.max(1000,(DURATION-(timeline?timeline.time():0)+3)*1000));}
  async function play(){
    halt();var ticket=serial;stats.error=null;stats.reason=null;settle();
    if(!window.gsap){phase('complete');status.textContent='Static result · GSAP unavailable.';return;}
    if(mode()){stats.launches=[];phase('complete');stats.reason='reduced';status.textContent='Reduced motion · no explosion, particles, shake or flashing · winner remains visible.';return;}
    phase('loading');$('replay').disabled=true;status.textContent='Preparing three bundled Effekseer effects · silent.';
    try{await prepare();if(ticket!==serial||released)return;build();}
    catch(error){if(ticket!==serial||released)return;stats.error=String(error.message||error);end('loading-fallback');}
  }
  function release(){halt();released=true;clearTimeout(loadTimer);if(renderer){renderer.cancelled=true;if(renderer.settled)dispose(renderer);renderer=null;}preparation=null;canvas.width=canvas.height=1;}
  canvas.addEventListener('webglcontextlost',function(event){event.preventDefault();if(renderer)renderer.lost=true;stats.error='Graphics context lost';end('context-loss');});
  document.addEventListener('visibilitychange',function(){if(!timeline)return;if(document.hidden){paused=true;timeline.pause();clearTimeout(watchdog);if(ticking){gsap.ticker.remove(render);ticking=false;}}else{paused=false;lastTime=timeline.time();accumulator=0;if(renderer&&!renderer.lost){gsap.ticker.add(render);ticking=true;}timeline.resume();armWatchdog();}});
  $('replay').addEventListener('click',play);$('skip').addEventListener('click',function(){halt();settle();phase('complete');stats.reason='skip';status.textContent='Skipped · renderer idle · result shown.';});
  reduced.addEventListener('change',play);if(media.addEventListener)media.addEventListener('change',play);
  $('sample-winner').addEventListener('input',function(event){$('winner-name').textContent=event.target.value.trim()||'Player 1';});
  addEventListener('keydown',function(event){if(event.key==='Escape')$('skip').click();});addEventListener('pagehide',release);
  window.PhoenixDefeatPreview={play:play,diagnostics:function(){return {phase:stats.phase,time:timeline?timeline.time():0,duration:DURATION,frames:stats.frames,launches:stats.launches.slice(),error:stats.error,reason:stats.reason,completed:stats.completed,active:!!timeline,ticking:ticking,paused:paused,ready:!!renderer&&!renderer.lost,buffer:[canvas.width,canvas.height],effects:renderer?Object.keys(renderer.effects):[],particleInstanceCap:1024,domShards:shards.length,reduced:mode()};}};
  play();
}());
