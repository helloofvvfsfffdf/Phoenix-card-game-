/* The approved Effekseer/GSAP victory study, adapted only for game lifecycle,
 * bundled paths and confirmed winner identity. Never a source of game rules. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixVictoryScene = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var DURATION = 9.7;
  // Same effects, positions, instance scales and timing as victory study 01.
  var LAUNCHES = [
    {name:'Boss Death',time:0,x:0,y:0,scale:2.8},
    {name:'Simple Turbulence Fireworks',time:3.15,x:0,y:3,scale:1.6},
    {name:'Simple Turbulence Fireworks',time:4.28,x:-11,y:3,scale:1.3},
    {name:'Simple Turbulence Fireworks',time:4.82,x:11,y:5,scale:1.4},
    {name:'Simple Turbulence Fireworks',time:5.58,x:-6,y:8,scale:1.2},
    {name:'Simple Turbulence Fireworks',time:6.2,x:7,y:9,scale:1.3}
  ];
  var renderer = null, preparation = null, active = null, generation = 0;
  var preparationError = null, retryAfter = 0;
  var last = {phase:'idle',sequence:[],frames:0,error:null};
  function identity(value) {
    value = value || {};
    return {name:typeof value.name === 'string' ? value.name.slice(0,100) : 'The champion',
      ally:['phoenix','tilly','ted','louie','simba','elsie'].indexOf(value.ally) >= 0 ? value.ally : null};
  }
  function dispose(instance) {
    if (!instance || instance.disposed) return;
    instance.disposed=true;
    instance.context.stopAll();
    Object.keys(instance.assets).forEach(function(key){instance.context.releaseEffect(instance.assets[key]);});
    root.effekseer.releaseContext(instance.context);
    var lose=instance.gl.getExtension('WEBGL_lose_context');if(lose)lose.loseContext();
    instance.canvas.remove();
  }
  function prepare(forceRetry) {
    // A rejected prewarm or a lost context is not a reusable renderer. Retry
    // once on victory, or after a cooldown during play; never retry per frame.
    if (preparation && ((preparationError && (forceRetry || Date.now() >= retryAfter)) ||
      (renderer && renderer.settled && !renderer.ready))) {
      generation++;
      if (renderer) {renderer.cancelled=true;if(renderer.settled)dispose(renderer);renderer=null;}
      preparation=null;preparationError=null;
    }
    if (preparation) return preparation;
    var epoch = generation;
    preparation = new Promise(function (resolve,reject) {
      if (!root.effekseer || !root.document) { reject(new Error('Effekseer unavailable')); return; }
      var finished=false,instance=null;
      var timeout = setTimeout(function () { failed('Victory media loading timed out'); },10000);
      function failed(error) {
        if(finished)return;finished=true;clearTimeout(timeout);
        if(instance){instance.cancelled=true;if(instance.settled)dispose(instance);if(renderer===instance)renderer=null;}
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      function initialized() {
        if(finished)return;
        if (epoch !== generation) { failed('Victory preparation cancelled'); return; }
        try {
          var canvas = root.document.createElement('canvas');
          var gl = canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:true}) ||
            canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:true});
          if (!gl) throw new Error('WebGL unavailable');
          var context = root.effekseer.createContext(); context.init(gl);
          instance = {canvas:canvas,gl:gl,context:context,assets:{},ready:false,settled:false,cancelled:false}; renderer = instance;
          canvas.addEventListener('webglcontextlost',function (event) {
            event.preventDefault(); instance.ready=false;
            if (!instance.cancelled && active) active.fallback('Graphics context lost');
          });
          function load(url) { return new Promise(function (done,fail) {
            var effect = context.loadEffect(url,1,function () { instance.assets[url]=effect; done(effect); },function (reason,file) { fail(new Error(file+': '+reason)); });
          }); }
          Promise.allSettled([load('assets/victory/effects/boss-death/boss_death.efk'),
            load('assets/victory/effects/fireworks/Simple_Turbulence_Fireworks.efkefc')]).then(function (effects) {
            instance.settled=true;
            if (finished || instance.cancelled || epoch !== generation) {dispose(instance);failed('Victory preparation cancelled');return;}
            var failure=effects.find(function(effect){return effect.status==='rejected';});
            if(failure){failed(failure.reason);return;}
            instance.effects = {'Boss Death':effects[0].value,'Simple Turbulence Fireworks':effects[1].value};
            instance.ready=true;finished=true;clearTimeout(timeout);resolve(instance);
          },failed);
        } catch (error) { failed(error); }
      }
      if(root.PhoenixParticleRuntime)root.PhoenixParticleRuntime.prepare().then(initialized,failed);
      else root.effekseer.initRuntime('assets/victory/vendor/effekseer.wasm',initialized,function () { failed('Effekseer runtime initialization failed'); });
    });
    preparation.then(function(){if(epoch===generation)preparationError=null;},function(error){
      if(epoch===generation){preparationError=String(error.message || error);retryAfter=Date.now()+5000;}
    });
    return preparation;
  }
  function release() {
    if (active) active.stop(false,'page-exit');
    generation++;
    if (renderer) {
      // Resource callbacks can reload native data: defer native destruction
      // until both pending loads settle rather than freeing under a callback.
      renderer.cancelled=true;
      if(renderer.settled)dispose(renderer);
      renderer.canvas.remove();renderer=null;
    }
    preparation=null;preparationError=null;retryAfter=0;
  }
  function start(options) {
    options=options || {};
    if (!root.document || root.document.hidden) return null;
    if (active) active.stop(false,'replaced');
    var document=root.document, winner=identity(options.winner), reduced=!!options.reduced;
    var node=document.createElement('section');
    node.className='match-celebration celebration-victory phoenix-winning-screen'+(reduced?' celebration-reduced':'');
    node.setAttribute('role','region'); node.setAttribute('aria-label','Victory celebration');
    var elements={};
    function make(tag,name,text,parent) {
      var element=document.createElement(tag); element.className='pv-'+name;
      if (text !== undefined) element.textContent=text;
      (parent || node).appendChild(element); elements[name]=element; return element;
    }
    make('div','backdrop');var mount=make('div','canvas-mount');make('div','halo');make('div','rays');make('div','vignette');
    var header=make('header','header');make('span','brand','PHOENIX',header);
    var opening=make('div','opening');make('span','opening-line',undefined,opening);make('p','opening-text','THE FINAL MOMENT',opening);make('span','opening-line',undefined,opening);
    var announcement=make('div','announcement');
    make('div','crest','✦',announcement).setAttribute('aria-hidden','true');
    make('p','eyebrow','ONE FLAME. ONE CHAMPION.',announcement);
    var title=make('h2','victory',undefined,announcement), letters=[];
    'VICTORY'.split('').forEach(function (letter) { letters.push(make('span','letter',letter,title)); });
    make('div','rule',undefined,announcement);
    make('p','winner',winner.name.toUpperCase()+(winner.ally?' & '+winner.ally.toUpperCase():''),announcement);
    make('p','tagline','THE TABLE FALLS. THE PHOENIX RISES.',announcement);
    var finish=make('div','finish',undefined,announcement);
    make('span','crowned','THE WINNER HAS BEEN CROWNED',finish);
    var results=make('button','results','Return to results',finish);results.type='button';
    var status=make('p','live-status','Preparing victory celebration.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    var footer=make('footer','footer'), phaseLabel=make('span','phase','THE FINAL MOMENT',footer);
    var skip=make('button','skip','Skip celebration',footer);skip.type='button';
    var progress=make('div','progress');make('div','progress-fill',undefined,progress);
    document.body.appendChild(node);
    var timeline=null,timer=null,watchdog=null,stopped=false,lastTime=0,ticking=false,paused=false;
    var remaining=DURATION*1000,timerStarted=0;
    var shownAt=Date.now(),pausedAt=null,pauseDuration=0;
    last={phase:'loading',sequence:[],frames:0,error:null,winner:winner};
    function phase(name,label) { last.phase=name; node.dataset.phase=name;phaseLabel.textContent=label; }
    function stop(notify,reason) {
      if (stopped) return;stopped=true;clearTimeout(timer);clearTimeout(watchdog);
      last.stopReason=reason || 'dismissed';last.stoppedAt=reason==='fallback-complete'?DURATION:timeline?timeline.time():lastTime;
      last.endPhase=last.phase;last.hiddenAtStop=!!document.hidden;
      last.visibleSeconds=Math.max(0,(Date.now()-shownAt-pauseDuration-(pausedAt!==null?Date.now()-pausedAt:0))/1000);
      if(root.console && root.console.info)root.console.info('[PHOENIX victory ended]',{reason:last.stopReason,time:last.stoppedAt,visibleSeconds:last.visibleSeconds,phase:last.endPhase,frames:last.frames,hidden:last.hiddenAtStop,error:last.error});
      if (timeline) timeline.kill();if (ticking) root.gsap.ticker.remove(render);
      if (renderer) { renderer.context.stopAll(); renderer.canvas.remove(); }
      var focused=document.activeElement===skip || document.activeElement===results;
      node.remove();if (active===controller) active=null;last.phase='idle';
      if (focused && options.restoreFocus && options.restoreFocus.focus) options.restoreFocus.focus();
      if (notify!==false && options.onFinish) options.onFinish();
    }
    function scheduleEnd() {
      clearTimeout(timer);if(paused)return;
      timerStarted=Date.now();timer=setTimeout(function(){stop(true,'fallback-complete');},remaining);
    }
    function pause() {
      if(stopped || paused)return;paused=true;pausedAt=Date.now();
      if(timeline)timeline.pause();
      if(ticking){root.gsap.ticker.remove(render);ticking=false;}
      if(timer!==null){remaining=Math.max(0,remaining-(Date.now()-timerStarted));clearTimeout(timer);timer=null;}
    }
    function resume() {
      if(stopped || !paused)return;paused=false;pauseDuration+=Date.now()-pausedAt;pausedAt=null;
      if(timeline){lastTime=timeline.time();if(lastTime===0)beginOpening();if(!reduced){root.gsap.ticker.add(render);ticking=true;}timeline.resume();}
      else if(last.phase==='fallback')scheduleEnd();
    }
    function fallback(error) {
      if (stopped) return;
      last.error=String(error);if (timeline) timeline.kill();timeline=null;if (ticking) {root.gsap.ticker.remove(render);ticking=false;}
      if (renderer) {renderer.context.stopAll();renderer.canvas.remove();}
      node.classList.add('pv-fallback');phase('fallback','VICTORY');status.textContent=winner.name+' wins'+(winner.ally?' with '+winner.ally.toUpperCase():'')+'.';
      clearTimeout(watchdog);remaining=DURATION*1000;scheduleEnd();
    }
    var controller={node:node,skip:skip,stop:stop,fallback:fallback,pause:pause,resume:resume,time:function(){return timeline?timeline.time():0;},paused:function(){return paused;}};active=controller;
    skip.addEventListener('click',function(){stop(true,'skip');});results.addEventListener('click',function(){stop(true,'results');});
    function spawn(launch) {
      if (reduced) return;
      var handle=renderer.context.play(renderer.effects[launch.name],launch.x,launch.y,0);
      if (handle) handle.setScale(launch.scale,launch.scale,launch.scale);
      last.sequence.push({effect:launch.name,at:Number(timeline.time().toFixed(3))});
    }
    function beginOpening() {
      if(last.phase!=='loading')return;
      phase('opening','THE FINAL MOMENT');status.textContent='The final moment.';spawn(LAUNCHES[0]);
    }
    function render() {
      if (stopped || !renderer || !renderer.ready) return;
      try {
      var canvas=renderer.canvas,gl=renderer.gl,context=renderer.context;
      var r=node.getBoundingClientRect(),ratio=Math.min(root.devicePixelRatio||1,1.25),s=Math.min(ratio,1440/Math.max(r.width,r.height));
      var w=Math.max(1,Math.round(r.width*s)),h=Math.max(1,Math.round(r.height*s));
      if (canvas.width!==w || canvas.height!==h) {canvas.width=w;canvas.height=h;}
      var time=timeline.time(),dt=Math.min(.08,Math.max(0,time-lastTime));lastTime=time;if(dt>0)context.update(dt*60);
      gl.viewport(0,0,w,h);gl.clearColor(.018,.022,.034,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      context.setProjectionPerspective(40,w/h,.1,1000);context.setCameraLookAt(0,4,55,0,3,0,0,1,0);context.draw();last.frames++;
      } catch(error) {fallback(error.message);}
    }
    function build() {
      if (stopped) return;
      clearTimeout(watchdog);
      if (!root.gsap) {fallback('GSAP unavailable');return;}
      var gsap=root.gsap;
      if (!reduced) {renderer.context.stopAll();renderer.canvas.className='pv-effects';renderer.canvas.setAttribute('aria-hidden','true');mount.appendChild(renderer.canvas);}
      gsap.set([elements.crest,elements.eyebrow,elements.winner,elements.tagline,opening],{opacity:0});
      gsap.set(letters,{opacity:0,y:reduced?0:36,rotateX:reduced?0:-55,scale:reduced?1:.91});
      gsap.set(elements.rule,{scaleX:0});gsap.set(finish,{autoAlpha:0,y:reduced?0:12});gsap.set(elements['progress-fill'],{scaleX:0});gsap.set(elements.halo,{opacity:0,scale:1});gsap.set(elements.rays,{opacity:0,rotation:0});
      timeline=gsap.timeline({paused:true,onComplete:function(){stop(true,'complete');}});
      timeline.addLabel('opening',0).call(beginOpening,null,0);
      timeline.to(opening,{opacity:1,duration:.45,ease:'power2.out'},.12).to(opening,{opacity:0,duration:.45},1.35);
      timeline.to(elements.halo,{opacity:.6,duration:.22,ease:'power1.out'},.32).to(elements.halo,{opacity:.16,duration:1.3,ease:'power2.out'},.6);
      timeline.addLabel('celebration',3.15).call(function(){if(!reduced)renderer.context.stopAll();phase('celebration','VICTORY');status.textContent=winner.name+' wins'+(winner.ally?' with '+winner.ally.toUpperCase():'')+'.';spawn(LAUNCHES[1]);},null,'celebration');
      timeline.to(elements.halo,{opacity:.9,duration:1.7,ease:'power2.out'},'celebration');
      timeline.to(elements.rays,{opacity:reduced?0:.75,duration:2,ease:'power2.out'},'celebration').to(elements.rays,{rotation:reduced?0:12,duration:6.55,ease:'none'},'celebration');
      timeline.fromTo(elements.crest,{opacity:0,scale:reduced?1:.5,rotation:reduced?0:-65},{opacity:1,scale:1,rotation:0,duration:.95,ease:'power3.out'},3.28);
      timeline.fromTo(elements.eyebrow,{opacity:0,y:reduced?0:8},{opacity:1,y:0,duration:.7},3.42);
      timeline.to(letters,{opacity:1,y:0,rotateX:0,scale:1,duration:1.1,stagger:reduced?0:.065,ease:'power3.out'},3.58);
      timeline.to(elements.rule,{scaleX:1,duration:.85,ease:'power2.out'},4.2);
      timeline.fromTo(elements.winner,{opacity:0,y:reduced?0:14},{opacity:1,y:0,duration:.85,ease:'power2.out'},4.48);
      timeline.fromTo(elements.tagline,{opacity:0,y:reduced?0:9},{opacity:1,y:0,duration:.9},4.8);
      LAUNCHES.slice(2).forEach(function(launch){timeline.call(function(){spawn(launch);},null,launch.time);});
      timeline.call(function(){phase('winner','THE CHAMPION');},null,6.8);
      timeline.to(finish,{autoAlpha:1,y:0,duration:.8,ease:'power2.out'},7.0);
      timeline.to(elements.halo,{opacity:.42,duration:1.4},7.7);
      timeline.to(elements['progress-fill'],{scaleX:1,duration:DURATION,ease:'none'},0);
      // The root ticker may still be on a pre-render/pre-shader timestamp.
      // Sync that clock while this timeline is paused, before anchoring time 0;
      // otherwise a cold first tick can jump the opening by hundreds of ms.
      if(!reduced && gsap.ticker.tick)gsap.ticker.tick();
      if (!reduced && !paused) {gsap.ticker.add(render);ticking=true;}
      // Launch the time-zero effect before playback, not on a potentially
      // delayed first animation frame. The timeline callback is idempotent.
      if(!paused){beginOpening();timeline.play(0);}
    }
    watchdog=setTimeout(function(){fallback('Victory initialization timed out');},10500);
    if (reduced) {try{build();}catch(error){fallback(error.message);}}
    else prepare(true).then(function(instance){
      if(stopped)return;
      if(!instance.ready){fallback('Graphics context unavailable');return;}
      try{build();}catch(error){fallback(error.message);}
    },function(error){fallback(error.message);});
    return controller;
  }
  function diagnostics() {
    return {phase:last.phase,sequence:last.sequence.slice(),frames:last.frames,error:last.error,winner:last.winner,
      active:!!active,ready:!!(renderer&&renderer.ready),time:active?active.time():0,paused:active?active.paused():false,
       stopReason:last.stopReason||null,stoppedAt:last.stoppedAt,visibleSeconds:last.visibleSeconds,endPhase:last.endPhase,hiddenAtStop:last.hiddenAtStop,
       preparationError:preparationError};
  }
  return {DURATION:DURATION,LAUNCHES:LAUNCHES,identity:identity,prepare:prepare,start:start,release:release,diagnostics:diagnostics};
}));
