/* The approved Effekseer/GSAP catastrophic defeat study, adapted only for game
 * lifecycle, bundled paths and confirmed winner identity. It is the exact
 * animation approved in defeat-preview.html - same effects, positions, instance
 * scales, easings, stagger and timing - presented once for a defeated local
 * player. Never a source of game rules and never presented to the winner. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixDefeatScene = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var DURATION = 7.8;
  // Same effects, positions, instance scales and timing as the approved study.
  var LAUNCHES = [
    {name:'blast',time:1.15,x:0,y:4,scale:3.6,color:[155,65,170,255]},
    {name:'smoke',time:1.15,x:-7,y:1,scale:3,color:[95,70,115,205]},
    {name:'smoke',time:1.15,x:7,y:1,scale:3,color:[95,70,115,205]},
    {name:'embers',time:2.2,x:0,y:5,scale:2.4,color:[255,145,95,220],rotation:[0,0,Math.PI]}
  ];
  var ASSETS = {
    blast:'assets/victory/effects/boss-death/boss_death.efk',
    smoke:'assets/card-cinematics/ghost.efk',
    embers:'assets/card-cinematics/alvin.efk'
  };
  var renderer = null, preparation = null, active = null, generation = 0;
  var preparationError = null, retryAfter = 0;
  var last = {phase:'idle',sequence:[],frames:0,error:null};
  function identity(value) {
    value = value || {};
    return {name:typeof value.name === 'string' ? value.name.slice(0,100) : 'The winner'};
  }
  function dispose(instance) {
    if (!instance || instance.disposed) return;
    instance.disposed = true;
    instance.context.stopAll();
    Object.keys(instance.assets).forEach(function (key) { instance.context.releaseEffect(instance.assets[key]); });
    root.effekseer.releaseContext(instance.context);
    var lose = instance.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    instance.canvas.remove();
  }
  function prepare(forceRetry) {
    // A rejected prewarm or a lost context is not a reusable renderer. Retry
    // once on defeat, or after a cooldown during play; never retry per frame.
    if (preparation && ((preparationError && (forceRetry || Date.now() >= retryAfter)) ||
      (renderer && renderer.settled && !renderer.ready))) {
      generation++;
      if (renderer) { renderer.cancelled = true; if (renderer.settled) dispose(renderer); renderer = null; }
      preparation = null; preparationError = null;
    }
    if (preparation) return preparation;
    var epoch = generation;
    preparation = new Promise(function (resolve, reject) {
      if (!root.effekseer || !root.document) { reject(new Error('Effekseer unavailable')); return; }
      var finished = false, instance = null;
      var timeout = setTimeout(function () { failed('Defeat media loading timed out'); }, 10000);
      function failed(error) {
        if (finished) return; finished = true; clearTimeout(timeout);
        if (instance) { instance.cancelled = true; if (instance.settled) dispose(instance); if (renderer === instance) renderer = null; }
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      function initialized() {
        if (finished) return;
        if (epoch !== generation) { failed('Defeat preparation cancelled'); return; }
        try {
          var canvas = root.document.createElement('canvas');
          var gl = canvas.getContext('webgl2', {alpha:true,antialias:false,preserveDrawingBuffer:true}) ||
            canvas.getContext('webgl', {alpha:true,antialias:false,preserveDrawingBuffer:true});
          if (!gl) throw new Error('WebGL unavailable');
          var context = root.effekseer.createContext(); context.init(gl, {instanceMaxCount:1024});
          instance = {canvas:canvas,gl:gl,context:context,assets:{},effects:{},ready:false,settled:false,cancelled:false}; renderer = instance;
          canvas.addEventListener('webglcontextlost', function (event) {
            event.preventDefault(); instance.ready = false;
            if (!instance.cancelled && active) active.fallback('Graphics context lost');
          });
          function load(key) { return new Promise(function (done, fail) {
            var effect = context.loadEffect(ASSETS[key],1,function () { instance.assets[key]=effect; done(effect); },function (reason,url) { fail(new Error(url+': '+reason)); });
          }); }
          Promise.allSettled(Object.keys(ASSETS).map(load)).then(function (effects) {
            instance.settled = true;
            if (finished || instance.cancelled || epoch !== generation) {dispose(instance);failed('Defeat preparation cancelled');return;}
            var failure = effects.find(function (effect) { return effect.status === 'rejected'; });
            if (failure) { failed(failure.reason); return; }
            instance.effects.blast = effects[0].value;
            instance.effects.smoke = effects[1].value;
            instance.effects.embers = effects[2].value;
            instance.ready = true; finished = true; clearTimeout(timeout); resolve(instance);
          }, failed);
        } catch (error) { failed(error); }
      }
      if (root.PhoenixParticleRuntime) root.PhoenixParticleRuntime.prepare().then(initialized, failed);
      else root.effekseer.initRuntime('assets/victory/vendor/effekseer.wasm',initialized,function () { failed('Effekseer runtime initialization failed'); });
    });
    preparation.then(function () { if (epoch === generation) preparationError = null; }, function (error) {
      if (epoch === generation) { preparationError = String(error.message || error); retryAfter = Date.now() + 5000; }
    });
    return preparation;
  }
  function release() {
    if (active) active.stop(false,'page-exit');
    generation++;
    if (renderer) {
      // Resource callbacks can reload native data: defer native destruction
      // until both pending loads settle rather than freeing under a callback.
      renderer.cancelled = true;
      if (renderer.settled) dispose(renderer);
      renderer.canvas.remove(); renderer = null;
    }
    preparation = null; preparationError = null; retryAfter = 0;
  }
  function start(options) {
    options = options || {};
    if (!root.document || root.document.hidden) return null;
    if (active) active.stop(false,'replaced');
    var document = root.document, winner = identity(options.winner), reduced = !!options.reduced;
    var node = document.createElement('section');
    node.className = 'match-celebration celebration-defeat phoenix-defeat-screen' + (reduced ? ' celebration-reduced' : '');
    node.setAttribute('role','region'); node.setAttribute('aria-label','Defeat');
    var elements = {};
    function make(tag,name,text,parent) {
      var element = document.createElement(tag); element.className = 'pd-'+name;
      if (text !== undefined) element.textContent = text;
      (parent || node).appendChild(element); elements[name] = element; return element;
    }
    make('div','table-grid');make('div','ember-glow');var mount=make('div','canvas-mount');
    make('div','impact-well');make('div','shockwave shock-one');make('div','shockwave shock-two');
    make('div','impact-cut');make('div','impact-vignette');make('div','light-scar scar-left');
    make('div','light-scar scar-right');var ash=make('div','ash-field');
    var topline=make('div','stage-topline',undefined);make('span','topline-left','THE TABLE HAS SPOKEN',topline);make('span','topline-right','PHOENIX / MATCH COMPLETE',topline);
    var composition = make('div','defeat-composition');
    var crest = make('div','fallen-crest',undefined,composition); crest.setAttribute('aria-hidden','true');
    crest.innerHTML = '<svg viewBox="0 0 240 150" fill="none" aria-hidden="true"><defs><linearGradient id="pd-feather" x1="120" y1="20" x2="120" y2="138" gradientUnits="userSpaceOnUse"><stop stop-color="#e0c7ff"/><stop offset="1" stop-color="#795987" stop-opacity=".15"/></linearGradient></defs><g class="pd-crest-left" stroke="url(#pd-feather)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M112 64 39 18 57 68 105 91 65 87 94 113 116 107"/><path d="m105 76-52-43 13 33 43 25M100 104l-23-11 22 19"/><path d="m51 53-23-19 18 43 40 17" opacity=".45"/></g><g class="pd-crest-right" stroke="url(#pd-feather)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m128 64 73-46-18 50-48 23 40-4-29 26-22-6"/><path d="m135 76 52-43-13 33-43 25m9 13 23-11-22 19"/><path d="m189 53 23-19-18 43-40 17" opacity=".45"/></g><path class="pd-last-ember" d="m120 54 8 18-8 14-8-14 8-18Z" fill="#d8b3ec"/><path d="m120 96-4 18 4 14 4-14-4-18Z" fill="#8c669e" opacity=".55"/></svg>';
    make('p','defeat-eyebrow','THE FINAL IMPACT',composition);
    var title = make('h2','defeat-title',undefined,composition); title.setAttribute('aria-label','Defeat'); var letters = [];
    'DEFEAT'.split('').forEach(function (letter) { letters.push(make('span','defeat-letter',letter,title)); });
    make('div','defeat-rule',undefined,composition);
    make('p','defeat-caption','The table falls. You rise again.',composition);
    var winnerLine = make('div','defeat-winner',undefined,composition);make('span','winner-label','WON BY',winnerLine);make('strong','winner-name',winner.name,winnerLine);
    make('p','defeat-note','THE FLAME ISN\u2019T FINISHED.',composition);
    var footer = make('footer','stage-footer');make('span','footer-left','FINAL IMPACT',footer);make('span','footer-right','WON BY THE NAME SHOWN ABOVE',footer);
    var skip = make('button','skip','Skip',undefined); skip.type='button';
    var status = make('p','live-status','Preparing defeat sequence.'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    document.body.appendChild(node);
    var shards = [], field = ash;
    for (var i = 0; i < 42; i++) { var shard = document.createElement('i'); shard.className='pd-ash-feather'+(i%3===0?' is-ember':''); field.appendChild(shard); shards.push(shard); }
    var timeline = null, timer = null, watchdog = null, stopped = false, lastTime = 0, ticking = false, paused = false;
    var remaining = DURATION*1000, timerStarted = 0, endReason = 'fallback-complete';
    var shownAt = Date.now(), pausedAt = null, pauseDuration = 0;
    var TARGETS = '.pd-fallen-crest,.pd-defeat-eyebrow,.pd-defeat-title span,.pd-defeat-rule,.pd-defeat-caption,.pd-defeat-winner,.pd-defeat-note';
    last = {phase:'loading',sequence:[],frames:0,error:null,winner:winner};
    function phase(name) { last.phase = name; node.dataset.phase = name; }
    function clearCanvas() { if (renderer && !renderer.gl.isContextLost()) { renderer.gl.clearColor(0,0,0,0); renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT|renderer.gl.DEPTH_BUFFER_BIT); } }
    function idle() { if (ticking) { root.gsap.ticker.remove(render); ticking=false; } if (renderer && !renderer.cancelled) renderer.context.stopAll(); clearCanvas(); }
    function settle() {
      if (!root.gsap) return;
      root.gsap.set(TARGETS,{clearProps:'all'});
      root.gsap.set('.pd-crest-left,.pd-crest-right,.pd-last-ember,.pd-ember-glow',{clearProps:'all'});
      root.gsap.set(node,{clearProps:'transform'});
      root.gsap.set('.pd-impact-well,.pd-shockwave,.pd-impact-cut,.pd-light-scar',{opacity:0});
      root.gsap.set('.pd-impact-vignette',{opacity:.35});
      root.gsap.set(shards,{opacity:0});
    }
    function stop(notify,reason) {
      if (stopped) return; stopped=true; clearTimeout(timer); clearTimeout(watchdog);
      last.stopReason = reason || 'dismissed';
      last.stoppedAt = reason === 'fallback-complete' ? DURATION : timeline ? timeline.time() : lastTime;
      last.endPhase = last.phase; last.hiddenAtStop = !!document.hidden;
      last.visibleSeconds = Math.max(0,(Date.now()-shownAt-pauseDuration-(pausedAt!==null?Date.now()-pausedAt:0))/1000);
      if (root.console && root.console.info) root.console.info('[PHOENIX defeat ended]',{reason:last.stopReason,time:last.stoppedAt,visibleSeconds:last.visibleSeconds,phase:last.endPhase,frames:last.frames,hidden:last.hiddenAtStop,error:last.error});
      if (timeline) timeline.kill(); if (ticking) root.gsap.ticker.remove(render);
      settle();
      if (renderer) { renderer.context.stopAll(); renderer.canvas.remove(); }
      var focused = document.activeElement === skip;
      node.remove(); if (active === controller) active = null; last.phase = 'idle';
      if (focused && options.restoreFocus && options.restoreFocus.focus) options.restoreFocus.focus();
      if (notify !== false && options.onFinish) options.onFinish();
    }
    function scheduleEnd(reason) { if (reason) endReason = reason; clearTimeout(timer); if (paused) return; timerStarted = Date.now(); timer = setTimeout(function () { stop(true,endReason); },remaining); }
    function pause() {
      if (stopped || paused) return; paused=true; pausedAt=Date.now();
      if (timeline) timeline.pause();
      if (ticking) { root.gsap.ticker.remove(render); ticking=false; }
      if (timer !== null) { remaining = Math.max(0,remaining-(Date.now()-timerStarted)); clearTimeout(timer); timer=null; }
    }
    function resume() {
      if (stopped || !paused) return; paused=false; pauseDuration += Date.now()-pausedAt; pausedAt=null;
      if (timeline) { lastTime = timeline.time(); if (!reduced) { root.gsap.ticker.add(render); ticking=true; } timeline.resume(); }
      else if (last.phase === 'fallback' || last.phase === 'complete') scheduleEnd();
    }
    function fallback(error) {
      if (stopped) return;
      last.error = String(error); if (timeline) timeline.kill(); timeline=null; if (ticking) { root.gsap.ticker.remove(render); ticking=false; }
      if (renderer) { renderer.context.stopAll(); renderer.canvas.remove(); }
      settle();
      node.classList.add('pd-fallback'); phase('complete'); status.textContent = winner.name+' wins. The flame will rise again.';
      clearTimeout(watchdog); remaining = DURATION*1000; endReason = 'fallback-complete'; scheduleEnd();
    }
    var controller = {node:node,skip:skip,stop:stop,fallback:fallback,pause:pause,resume:resume,time:function(){return timeline?timeline.time():0;},paused:function(){return paused;}}; active=controller;
    skip.addEventListener('click',function(){stop(true,'skip');});
    function spawn(launch) {
      if (reduced || !renderer || !renderer.ready) return;
      var handle = renderer.context.play(renderer.effects[launch.name],launch.x,launch.y,0);
      if (handle) {
        handle.setScale(launch.scale,launch.scale,launch.scale);
        handle.setAllColor(launch.color[0],launch.color[1],launch.color[2],launch.color[3]);
        if (launch.rotation) handle.setRotation(launch.rotation[0],launch.rotation[1],launch.rotation[2]);
      }
      last.sequence.push({effect:launch.name,at:Number((timeline?timeline.time():0).toFixed(3))});
    }
    function render() {
      if (stopped || !renderer || !renderer.ready) return;
      try {
        var canvas = renderer.canvas, gl = renderer.gl, context = renderer.context;
        var box = node.getBoundingClientRect(), limit = root.innerWidth < 600 ? 800 : 1120;
        var ratio = Math.min(root.devicePixelRatio||1,1.25,limit/Math.max(box.width,box.height));
        var w = Math.max(1,Math.round(box.width*ratio)), h = Math.max(1,Math.round(box.height*ratio));
        if (canvas.width!==w || canvas.height!==h) { canvas.width=w; canvas.height=h; }
        var time = timeline.time(), dt = Math.min(.08,Math.max(0,time-lastTime)); lastTime=time;
        if (dt>0) context.update(dt*60);
        gl.viewport(0,0,w,h); clearCanvas();
        context.setProjectionPerspective(40,w/h,.1,200);
        var distance = Math.max(40,30/(.728*w/h));
        context.setCameraLookAt(0,-2,distance,0,-2,0,0,1,0); context.draw(); last.frames++;
      } catch (error) { fallback(error.message); }
    }
    function build() {
      if (stopped) return;
      clearTimeout(watchdog);
      if (!root.gsap) { fallback('GSAP unavailable'); return; }
      var gsap = root.gsap;
      settle(); lastTime=0; last.sequence=[];
      if (!reduced) { renderer.context.stopAll(); renderer.canvas.className='pd-effects'; renderer.canvas.setAttribute('aria-hidden','true'); mount.appendChild(renderer.canvas); }
      phase('anticipation');
      gsap.set(TARGETS,{opacity:0});
      gsap.set('.pd-fallen-crest',{opacity:.7,scale:1,y:-12});
      gsap.set('.pd-last-ember',{opacity:1});
      gsap.set('.pd-impact-vignette',{opacity:.7});
      timeline = gsap.timeline({paused:true,onComplete:function(){stop(true,'complete');}});
      timeline.addLabel('impact',1.15).addLabel('defeat',2.2).addLabel('aftermath',3.5);
      timeline.to('.pd-fallen-crest',{scale:1.18,y:-18,duration:1.15,ease:'power2.in'},0)
        .to('.pd-last-ember',{opacity:.22,duration:1.1},0).to('.pd-ember-glow',{opacity:.12,duration:1.05},0)
        .call(function(){phase('impact');spawn(LAUNCHES[0]);spawn(LAUNCHES[1]);spawn(LAUNCHES[2]);status.textContent='The table falls.';},null,'impact')
        .fromTo('.pd-impact-well',{opacity:0,scale:.12},{opacity:.82,scale:1.35,duration:.45,ease:'expo.out'},'impact')
        .to('.pd-impact-well',{opacity:.15,scale:1.65,duration:2.8},1.6)
        .fromTo('.pd-shock-one',{opacity:.8,scale:.12},{opacity:0,scale:7,duration:.85,ease:'power3.out'},'impact')
        .fromTo('.pd-shock-two',{opacity:.6,scale:.1},{opacity:0,scale:6,duration:1.1,ease:'power3.out'},1.29)
        .fromTo('.pd-impact-cut',{opacity:0,scaleX:.1},{opacity:.85,scaleX:1,duration:.13,ease:'expo.out'},'impact').to('.pd-impact-cut',{opacity:0,duration:.7},1.3)
        .to('.pd-crest-left',{x:-45,y:65,rotation:-38,opacity:0,duration:.75,ease:'power2.in'},'impact')
        .to('.pd-crest-right',{x:45,y:65,rotation:38,opacity:0,duration:.75,ease:'power2.in'},'impact').to('.pd-last-ember',{opacity:0,scale:0,duration:.35},'impact')
        .to('.pd-fallen-crest',{opacity:0,duration:.35},1.8)
        .call(function(){phase('defeat');spawn(LAUNCHES[3]);status.textContent=winner.name+' wins with the table falling.';},null,'defeat')
        .fromTo('.pd-defeat-eyebrow',{opacity:0,y:-6},{opacity:1,y:0,duration:.65},1.95)
        .fromTo('.pd-defeat-title span',{opacity:0,y:-45,rotationX:65,scale:1.5},{opacity:1,y:0,rotationX:0,scale:1,duration:.9,stagger:.065,ease:'expo.out'},'defeat')
        .fromTo('.pd-defeat-rule',{opacity:0,scaleX:.05},{opacity:1,scaleX:1,duration:.75,ease:'power3.out'},2.6)
        .fromTo('.pd-defeat-caption',{opacity:0,y:12},{opacity:1,y:0,duration:.8},2.9)
        .fromTo('.pd-defeat-winner',{opacity:0,y:14},{opacity:1,y:0,duration:.8},3.3)
        .fromTo('.pd-defeat-note',{opacity:0},{opacity:1,duration:.9},3.7)
        .to('.pd-impact-vignette',{opacity:.35,duration:2},3)
        .call(function(){phase('aftermath');},null,'aftermath')
        .to('.pd-ember-glow',{opacity:.35,duration:2},4).to('.pd-ember-glow',{opacity:.15,duration:1},6.8)
        .to('.pd-fallen-crest',{opacity:.32,scale:.8,y:0,duration:1.5},5.9);
      // Camera-like kick is confined to the scene surface; controls never shake.
      if (!reduced) {
        [{x:-10,y:5,r:-.35},{x:9,y:-4,r:.3},{x:-7,y:3,r:-.22},{x:5,y:-2,r:.16},{x:-3,y:1,r:-.1},{x:0,y:0,r:0}].forEach(function (k,index) {
          timeline.to(node,{x:k.x,y:k.y,rotation:k.r,duration:.065,ease:'none'},1.15+index*.065);
        });
        shards.forEach(function (shard,index) {
          var side = index%2===0?-1:1, span=Math.min(node.clientWidth*.4,450), x=side*(35+(index*37%100)/100*span), y=-90+(index*19%100);
          timeline.fromTo(shard,{x:x*.2,y:y-80,rotation:side*18,opacity:0},{x:x,y:y+100,rotation:side*(90+index*4),opacity:index%3===0?.9:.45,duration:1.3+(index%5)*.15,ease:'power2.out'},1.15+(index%7)*.055)
            .to(shard,{y:y+node.clientHeight*.7,opacity:0,duration:3.4,ease:'power1.in'},2.3+(index%4)*.2);
        });
      }
      timeline.to({},{duration:.01},DURATION-.01);
      if (!reduced && gsap.ticker.tick) gsap.ticker.tick();
      if (!reduced && !paused) { gsap.ticker.add(render); ticking=true; }
      status.textContent = 'Defeat · Effekseer impact, smoke and embers · silent.';
      if (!paused) timeline.play(0);
    }
    // Reduced motion holds the approved static result: no particles, no shake,
    // no letter motion. The outcome is still complete and dismissible.
    function showStatic() {
      if (stopped) return;
      clearTimeout(watchdog);
      if (!root.gsap) { fallback('GSAP unavailable'); return; }
      settle();
      root.gsap.set(TARGETS,{opacity:1,clearProps:'transform'});
      root.gsap.set('.pd-fallen-crest',{opacity:.32,scale:.8,y:0});
      root.gsap.set('.pd-impact-vignette',{opacity:.35});
      root.gsap.set('.pd-impact-well,.pd-shockwave,.pd-impact-cut,.pd-light-scar,.pd-ember-glow',{opacity:0});
      root.gsap.set(shards,{opacity:0});
      phase('complete');
      status.textContent = winner.name+' wins. Defeat · reduced motion · result held.';
      endReason = 'reduced-complete'; scheduleEnd();
    }
    watchdog = setTimeout(function () { fallback('Defeat initialization timed out'); },10500);
    if (reduced) { try { showStatic(); } catch (error) { fallback(error.message); } }
    else prepare(true).then(function (instance) {
      if (stopped) return;
      if (!instance.ready) { fallback('Graphics context unavailable'); return; }
      try { build(); } catch (error) { fallback(error.message); }
    }, function (error) { fallback(error.message); });
    return controller;
  }
  function diagnostics() {
    return {phase:last.phase,sequence:last.sequence.slice(),frames:last.frames,error:last.error,winner:last.winner,
      active:!!active,ready:!!(renderer&&renderer.ready),time:active?active.time():0,paused:active?active.paused():false,
      stopReason:last.stopReason||null,stoppedAt:last.stoppedAt,visibleSeconds:last.visibleSeconds,endPhase:last.endPhase,hiddenAtStop:last.hiddenAtStop,
      preparationError:preparationError};
  }
  return {DURATION:DURATION,LAUNCHES:LAUNCHES,ASSETS:ASSETS,identity:identity,prepare:prepare,start:start,release:release,diagnostics:diagnostics};
}));
