/* Phoenix-only filmed-fire stage. Presentation only: no game state, rules,
 * player names, hands, network messages or move dispatchers are read here. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixFireScene = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var DURATION = 4400, IMPACT = 1250, current = null, media = null;
  function plan(width, height, reduced) {
    width = Math.max(1, Number(width) || 1); height = Math.max(1, Number(height) || 1);
    var scale = Math.min(1, 960 / Math.max(width, height), Math.sqrt(750000 / (width * height)));
    return { width: Math.round(width * scale), height: Math.round(height * scale), fps: 24,
      embers: reduced ? 0 : width < 600 ? 36 : 80, duration: reduced ? 1800 : DURATION, impact: reduced ? 0 : IMPACT };
  }
  function timeline(ms) {
    return { phase: ms < IMPACT ? 'summoning' : ms < 3350 ? 'impact' : 'return',
      energy: Math.min(1, Math.max(0, ms / 900)) * Math.min(1, Math.max(0, (DURATION-ms)/1000)),
      rise: Math.min(1, Math.max(0, (ms-250)/1600)) };
  }
  function prepare(full) {
    if (!root.document) return;
    if (!media) {
      var image = function (src) { var i = root.document.createElement('img'); i.src = src; return i; };
      media = { hero: image('assets/phoenix/phoenix-hero.svg'), poster: image('assets/phoenix/fire-poster.jpg'), video: null };
    }
    if (full && !media.video && !(root.navigator && root.navigator.connection && root.navigator.connection.saveData)) {
      var video = root.document.createElement('video'); video.muted = true; video.defaultMuted = true;
      video.playsInline = true; video.preload = 'auto'; video.src = 'assets/phoenix/fire-surge.mp4';
      video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
      media.video = video; // One decoder, reused; video has no audio track.
    }
  }
  function release() {
    if (current) current.stop(false);
    if (media && media.video) { media.video.pause(); media.video.removeAttribute('src'); if (media.video.load) media.video.load(); }
    media = null;
  }
  function start(options) {
    options = options || {};
    if (!root.document || root.document.hidden) return null;
    if (current) current.stop(false);
    prepare(!options.reduced);
    var document = root.document, config = plan(root.innerWidth, root.innerHeight, options.reduced);
    var stage = document.createElement('section'); stage.className = 'phoenix-takeover' + (options.reduced ? ' phoenix-static' : '') + (options.preview ? ' phoenix-preview' : '');
    stage.setAttribute('role', 'region'); stage.setAttribute('aria-label', 'Phoenix card cinematic'); stage.dataset.phase = options.reduced ? 'impact' : 'summoning';
    var canvas = document.createElement('canvas'); canvas.width = config.width; canvas.height = config.height;
    canvas.setAttribute('aria-hidden', 'true'); canvas.className = 'phoenix-fire-canvas'; stage.appendChild(canvas);
    var fallback = document.createElement('div'); fallback.className = 'phoenix-static-art'; fallback.setAttribute('aria-hidden', 'true');
    var bird = document.createElement('img'); bird.src = 'assets/phoenix/phoenix-hero.svg'; bird.alt = ''; fallback.appendChild(bird); stage.appendChild(fallback);
    var title = document.createElement('div'); title.className = 'phoenix-scene-title';
    var eyebrow = document.createElement('p'); eyebrow.textContent = 'THE LEGENDARY CARD';
    var heading = document.createElement('h2'); heading.textContent = 'PHOENIX';
    var caption = document.createElement('p'); caption.className = 'phoenix-scene-caption'; caption.textContent = options.preview ? 'CINEMATIC PREVIEW · NO GAMEPLAY CHANGES' : 'THE TABLE FALLS. THE PHOENIX RISES.';
    title.appendChild(eyebrow); title.appendChild(heading); title.appendChild(caption); stage.appendChild(title);
    var status = document.createElement('p'); status.className = 'phoenix-scene-status'; status.setAttribute('role','status'); status.textContent = 'Phoenix rises.'; stage.appendChild(status);
    var skip = document.createElement('button'); skip.type = 'button'; skip.className = 'phoenix-scene-skip'; skip.textContent = 'Return to game'; stage.appendChild(skip);
    document.body.appendChild(stage);
    var ctx = canvas.getContext ? canvas.getContext('2d', {alpha:true}) : null;
    var mask = document.createElement('canvas'); mask.width = 700; mask.height = 630;
    var maskCtx = mask.getContext ? mask.getContext('2d', {alpha:true}) : null;
    var stopped = false, frame = null, phaseTimer = null, timer = null;
    var now = root.performance && root.performance.now ? function () { return root.performance.now(); } : Date.now;
    var began = now(), previous = -1000;
    var request = root.requestAnimationFrame ? function (fn) { return root.requestAnimationFrame(fn); } : function (fn) { return setTimeout(function(){fn(now());},42); };
    var cancel = root.cancelAnimationFrame || clearTimeout;
    var particles = Array.from({length:config.embers},function (_,i) {
      return { x: ((i*73)%101)/100, y: ((i*29)%97)/100, speed: .11+(i%7)*.018, size: 1+(i%4)*.7, drift: (i%11-5)*.015 };
    });
    function stop(notify) {
      if (stopped) return;
      stopped = true; if (frame !== null) cancel(frame); clearTimeout(timer); clearTimeout(phaseTimer);
      var focused = document.activeElement === skip;
      if (media && media.video) media.video.pause(); stage.remove();
      canvas.width=canvas.height=mask.width=mask.height=1; particles.length=0;
      if (current === controller) current = null;
      if (focused && options.restoreFocus && options.restoreFocus.focus) options.restoreFocus.focus();
      if (notify !== false && options.onFinish) options.onFinish();
    }
    var controller = { stop: stop, node: stage, config: config }; current = controller;
    skip.addEventListener('click',function(){stop(true);});
    if (!options.reduced && ctx) {
      fallback.hidden = true;
      if (media.video && media.video.play) {
        try { media.video.currentTime=0; var play=media.video.play(); if(play&&play.catch)play.catch(function(){stage.dataset.media='poster-fallback';}); }
        catch(e) { stage.dataset.media='poster-fallback'; }
      }
      function cover(image,w,h) {
        var iw=image.videoWidth||image.naturalWidth||960, ih=image.videoHeight||image.naturalHeight||540;
        var s=Math.max(w/iw,h/ih);ctx.drawImage(image,(w-iw*s)/2,(h-ih*s)/2,iw*s,ih*s);
      }
      function draw(at) {
        if(stopped)return;
        frame=request(draw); if(at-previous<1000/config.fps)return;previous=at;
        var elapsed=at-began, state=timeline(elapsed), w=canvas.width,h=canvas.height;
        stage.dataset.phase=state.phase;
        var video=media && media.video;
        var texture=video && video.readyState>=2 ? video : media && media.poster;
        stage.dataset.media=video && !video.paused && texture===video ? 'filmed-fire' : 'poster-fallback';
        ctx.clearRect(0,0,w,h);
        var glow=ctx.createRadialGradient(w*.5,h*.44,0,w*.5,h*.44,Math.max(w,h)*.7);
        glow.addColorStop(0,'rgba(238,100,24,'+(.32*state.energy)+')');glow.addColorStop(.55,'rgba(95,24,13,'+(.3*state.energy)+')');glow.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
        if(texture && (texture.readyState>=2 || texture.complete && texture.naturalWidth)) {
          ctx.save();ctx.globalAlpha=.84*state.energy;ctx.globalCompositeOperation='screen';cover(texture,w,h);ctx.restore();
          // Photographed moving fire clipped to the huge bird's feather silhouette,
          // then combined with the original gold/red engraved feather artwork.
          var hero=media.hero;
          if(hero.complete && hero.naturalWidth && maskCtx) {
            maskCtx.clearRect(0,0,700,630);maskCtx.globalCompositeOperation='source-over';maskCtx.drawImage(hero,0,0,700,630);
            maskCtx.globalCompositeOperation='source-in';maskCtx.drawImage(texture,0,0,700,630);maskCtx.globalCompositeOperation='source-over';
            var size=Math.min(w*1.38,h*1.62)*(.7+state.rise*.4), bh=size*.9, x=(w-size)/2,y=h*.37-bh*.42-(state.rise*20);
            ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=.72*state.energy;
            ctx.drawImage(hero,x,y,size,bh);ctx.globalAlpha=.95*state.energy;ctx.drawImage(mask,x,y,size,bh);ctx.restore();
          }
        }
        ctx.save();ctx.globalCompositeOperation='screen';
        particles.forEach(function(p,i){
          var seconds=elapsed/1000, py=h*(1-((p.y+seconds*p.speed)%1)),px=w*p.x+Math.sin(seconds+i)*w*p.drift;
          ctx.globalAlpha=state.energy*(.3+(i%5)*.09);ctx.fillStyle=i%3===0?'#ffe3a0':'#fa8933';
          ctx.beginPath();ctx.ellipse(px,py,p.size,p.size*(i%3===0?2.8:1.3),.3,0,Math.PI*2);ctx.fill();
          if(i%7===0){ctx.strokeStyle='#ffd17c';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-8,py+25);ctx.stroke();}
        });ctx.restore();
      }
      frame=request(draw);
    } else { canvas.hidden=true; stage.dataset.media=options.reduced?'static-reduced':'static-fallback'; }
    phaseTimer=setTimeout(function(){if(!stopped){stage.dataset.phase='impact';status.textContent=options.preview?'Phoenix cinematic preview. No game state changed.':'Phoenix unleashed. The confirmed result is on the table.';}},config.impact);
    timer=setTimeout(function(){stop(true);},config.duration);
    return controller;
  }
  return { DURATION:DURATION, IMPACT:IMPACT, plan:plan, timeline:timeline, prepare:prepare, start:start, release:release };
}));
