/* Approved card artwork/binaries in real matches. Only whitelisted public
 * events enter here; never hands, scores, rules, audio or input locks. */
(function(root){
  'use strict';
  var renderer=null,preparation=null,active=null,epoch=0,followups=[];
  var stats={plays:0,frames:0,history:[],error:null,launches:0};
  /* dramatic v2: per-card caption cue (item 5 baseline) - phoenix never uses this */
  var CAPTION_AT={bonus:1.6,knife:1,hunter:1.3,zombie:1.3,steal:1.7,judge:1.5,reveal:1.5,skipall:1,trick:1.6,stealturn:1.4,curse:1.1,ghost:1.4,alvin:1.3};
  function cardId(key){return key==='alvin-burn'?'alvin':key==='curse-trigger'?'curse':key==='hunter-block'?'hunter':key;}
  function supports(key){return !!(root.PhoenixCardCinematicCatalog&&root.PhoenixCardCinematicCatalog[cardId(key)]);}
  function dispose(r){if(!r||r.disposed)return;r.disposed=true;r.context.stopAll();r.effects.forEach(function(e){r.context.releaseEffect(e);});r.effects.clear();root.effekseer.releaseContext(r.context);if(r.holder)r.holder.remove();else r.canvas.remove();}
  function prepare(){
    if(preparation)return preparation;var version=epoch;
    preparation=root.PhoenixParticleRuntime.prepare().then(function(){
      if(version!==epoch)throw Error('Card renderer cancelled');
      var canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,antialias:false,preserveDrawingBuffer:true})||canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true});
      if(!gl)throw Error('WebGL unavailable');var context=root.effekseer.createContext();context.init(gl,{instanceMaxCount:512});
      var holder=document.createElement('div');holder.className='pc-canvas-holder';holder.hidden=true;holder.setAttribute('aria-hidden','true');holder.appendChild(canvas);document.body.appendChild(holder);
      renderer={canvas:canvas,holder:holder,gl:gl,context:context,effects:new Map(),loads:new Map(),lost:false};var r=renderer;
      canvas.setAttribute('aria-hidden','true');canvas.addEventListener('webglcontextlost',function(event){event.preventDefault();r.lost=true;stats.error='Graphics context lost';holder.hidden=true;if(active)active.staticFallback();});
      return r;
    });return preparation;
  }
  function load(r,id){
    if(r.effects.has(id))return Promise.resolve(r.effects.get(id));if(r.loads.has(id))return r.loads.get(id);
    var effect;var promise=new Promise(function(resolve,reject){effect=r.context.loadEffect('assets/card-cinematics/'+id+'.efk',1,function(){r.loads.delete(id);r.effects.set(id,effect);prune(r,active?cardId(active.node.dataset.effect):id);resolve(effect);},function(reason,url){r.loads.delete(id);if(effect)r.context.releaseEffect(effect);reject(Error(url+': '+reason));});});
    r.loads.set(id,promise);return promise;
  }
  function prune(r,id){r.effects.forEach(function(effect,key){if(r.effects.size>3&&key!==id){r.context.releaseEffect(effect);r.effects.delete(key);}});}
  function stop(){followups=[];if(active)active.stop(false);}
  function caption(event,id){
    if(event.outcome==='inert')return 'No change · confirmed result';
    if(event.key==='alvin-burn')return 'One chosen card destroyed forever · all other cards remain';
    if(event.key==='curse-trigger')return 'Card resolved first · curse now eliminates its player for 1 round';
    if(event.key==='hunter-block'||(id==='zombie'&&event.actor===event.target))return 'Hunter reflects Zombie · thrower eliminated · scores unchanged';
    if(id==='alvin')return 'Private hand inspection · actor must choose one card';
    if(id==='judge')return 'Judge activated · most evil player banished for 3 rounds';
    return root.PhoenixCardCinematicCatalog[id].caption.replace(/\bYOU\b/g,'ACTOR').replace(/\bYOUR\b/g,'ACTOR’S');
  }
  function start(event,options){
    options=options||{};event=root.PhoenixEffects.publicEvent(event&&event.key,event&&event.actor,event&&event.target,event&&event.outcome);
    if(!event||!supports(event.key)||document.hidden||options.motion==='off')return null;
    if(event.key==='curse-trigger'&&active){followups.push({event:event,options:options});if(followups.length>2)followups.shift();return active;}
    if(active){followups=[];active.stop(false);}var id=cardId(event.key),def=root.PhoenixCardCinematicCatalog[id],card=root.PhoenixCards.byId(id),reduced=options.motion==='reduced';
    var node=document.createElement('section');node.className='pc-scene'+(reduced?' pc-reduced':'');node.dataset.effect=event.key;node.setAttribute('aria-hidden','true');node.style.setProperty('--pc-color',def.color);
    function make(name,parent){var el=document.createElement('div');el.className='pc-'+name;(parent||node).appendChild(el);return el;}
    /* The dramatic system (vanish/aurora/caption/curtain/punch) only runs for non-Phoenix
       cards in full motion. Phoenix and reduced-motion fall back to the approved DOM/timeline. */
    var dramatic=id!=='phoenix'&&!reduced;
    var mount=make('mount'),halo=make('halo',mount),hero=null,heroWrap=null,played=null,dom=null,aurora=null,rays=null,members=[],shock=null,shockEcho=null,shards=[],flash=null,vignette=null,tint=null;
    if(dramatic){
      var backdrop=make('backdrop',mount);aurora=make('aurora',backdrop);rays=make('rays',backdrop);var emberBox=make('ember',backdrop);
      for(var em=0;em<12;em++){var mote=document.createElement('i');emberBox.appendChild(mote);members.push(mote);}
      dom=make('dom',mount);heroWrap=make('hero-wrap',dom);hero=make('hero',heroWrap);played=make('card',dom);
      shock=make('shock',dom);shockEcho=make('shock-echo',dom);var shardsBox=make('shards',dom);
      for(var sh=0;sh<10;sh++){var piece=document.createElement('i');shardsBox.appendChild(piece);shards.push(piece);}
      flash=make('flash',mount);vignette=make('vignette',mount);tint=make('tint',mount);
    }else{hero=make('hero',mount);played=make('card',mount);}
    hero.innerHTML=root.PhoenixCardCinematicArt.icon(id);var brand=make('card-brand',played);brand.textContent='PHOENIX';var emblem=make('card-icon',played);emblem.innerHTML=root.PhoenixCardCinematicArt.icon(id);var name=make('card-name',played);name.textContent=card.name;
    var message=make('message'),title=document.createElement('strong'),line=document.createElement('small');title.textContent=event.key==='alvin-burn'?'Alvin · one card destroyed':event.key==='curse-trigger'?'Curse triggered':event.key==='hunter-block'?'Hunter reflection':card.name;line.textContent=caption(event,id);message.appendChild(title);message.appendChild(line);document.body.appendChild(node);
    var timeline=null,timer=null,ticker=false,lastTime=0,accumulator=0,ended=false,fallback=false,handle=null,token=epoch,metrics=null,nativeDone=false,sawAlive=false,launched=false;
    stats.plays++;stats.history.push({key:event.key,actor:event.actor,target:event.target,outcome:event.outcome});if(stats.history.length>64)stats.history.shift();
    function end(notify){if(ended)return;ended=true;clearTimeout(timer);root.removeEventListener('resize',onResize);if(timeline)timeline.kill();if(ticker){root.gsap.ticker.remove(render);ticker=false;}if(handle&&handle.stop)handle.stop();if(renderer){if(renderer.holder)renderer.holder.hidden=true;if(!renderer.lost){renderer.gl.clearColor(0,0,0,0);renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT);}}node.remove();if(active===controller)active=null;if(notify!==false&&options.onFinish)options.onFinish();if(notify!==false&&followups.length){var next=followups.shift();start(next.event,next.options);}}
    function staticFallback(){if(ended||fallback)return;fallback=true;if(timeline)timeline.kill();if(ticker){root.gsap.ticker.remove(render);ticker=false;}if(handle&&handle.stop)handle.stop();if(renderer&&renderer.holder)renderer.holder.hidden=true;node.classList.add('pc-reduced');message.style.opacity='1';clearTimeout(timer);timer=setTimeout(function(){end(true);},1100);}
    function measure(){var b=mount.getBoundingClientRect();metrics={w:b.width||1,h:b.height||1};}
    function onResize(){if(!ended)measure();}
    function render(){if(ended||nativeDone||document.hidden||!renderer||renderer.lost||!timeline)return;try{var time=timeline.time(),dt=Math.max(0,Math.min(.06,time-lastTime));lastTime=time;accumulator+=dt;if(accumulator<1/30)return;var r=renderer,ratio=Math.min(root.devicePixelRatio||1,1.25,960/Math.max(metrics.w,metrics.h)),w=Math.max(1,Math.round(metrics.w*ratio)),h=Math.max(1,Math.round(metrics.h*ratio));if(r.canvas.width!==w||r.canvas.height!==h){r.canvas.width=w;r.canvas.height=h;}r.context.update(Math.min(accumulator,.1)*60);accumulator=0;r.gl.viewport(0,0,w,h);r.gl.clearColor(0,0,0,0);r.gl.clear(r.gl.COLOR_BUFFER_BIT|r.gl.DEPTH_BUFFER_BIT);r.context.setProjectionPerspective(40,w/h,.1,200);r.context.setCameraLookAt(0,0,Math.max(30,22/(.728*w/h)),0,0,0,0,1,0);r.context.draw();stats.frames++;if(launched){var alive=!!(handle&&handle.exists);if(alive)sawAlive=true;if(sawAlive&&!alive){nativeDone=true;if(ticker){root.gsap.ticker.remove(render);ticker=false;}}}}catch(error){stats.error=String(error);staticFallback();}}
    function build(effect){if(ended||fallback||token!==epoch)return;clearTimeout(timer);if(!root.gsap){staticFallback();return;}
      if(renderer&&!reduced&&!renderer.lost){renderer.holder.hidden=false;prune(renderer,id);}
      var gsap=root.gsap,duration=reduced?1.1:def.duration,source=options.source||{x:innerWidth/2,y:innerHeight*.65},box=mount.getBoundingClientRect(),sx=source.x-(box.left+box.width/2),sy=source.y-(box.top+box.height/2);
      metrics={w:box.width||1,h:box.height||1};root.addEventListener('resize',onResize);
      gsap.set(hero,{opacity:0,x:0,y:0,scale:1,rotation:0,rotationY:0});gsap.set(message,{opacity:0,scale:1,letterSpacing:'0.02em',clipPath:'inset(0 0% 0 0%)'});gsap.set(halo,{opacity:0,scale:1});gsap.set(played,{x:0,y:0,scale:1,rotation:0,opacity:1});
      if(dramatic){gsap.set(heroWrap,{scale:1});gsap.set(dom,{x:0,y:0});gsap.set(aurora,{opacity:0,scale:1});gsap.set(rays,{opacity:0,rotation:0});gsap.set([flash,vignette,tint],{opacity:0});gsap.set([shock,shockEcho],{opacity:0,scale:.25});members.forEach(function(el){gsap.set(el,{opacity:0,x:0,y:0});});shards.forEach(function(el){gsap.set(el,{opacity:0,x:0,y:0,scale:1,rotation:0});});}
      timeline=gsap.timeline({paused:true,onComplete:function(){end(true);}});
      if(reduced){gsap.set(played,{opacity:0});gsap.set(message,{opacity:1});timeline.to(message,{opacity:1,duration:duration},0);}
      else{
        timeline.fromTo(played,{x:sx,y:sy,scale:.45,rotation:-12,opacity:0},{x:0,y:0,scale:1,rotation:0,opacity:1,duration:.65,ease:'power3.out'},0);
        if(dramatic){
          /* ---- dramatic v2 (vanish · punch · aurora · caption · curtain) ---- */
          var burst=.55,heroT=.7,heroDone=1.2,capAt=Math.min(Math.max(1.15,(CAPTION_AT[id]||1)-.1),duration-1.5),exitT=duration-.9,wipeT=exitT+.1,poseT=exitT+.15;
          /* vanish: card snaps, flash frame, double shockwave, ten shards */
          timeline.to(played,{scale:1.14,duration:.05,ease:'power1.out'},.5).to(played,{scale:.1,opacity:0,duration:.1,ease:'power3.in'},.57);
          timeline.fromTo(flash,{opacity:0},{opacity:1,duration:.07,ease:'none'},burst).to(flash,{opacity:0,duration:.11,ease:'power2.out'},burst+.07);
          timeline.fromTo(shock,{scale:.25,opacity:1},{scale:6.5,opacity:0,duration:.5,ease:'power2.out'},burst);
          timeline.fromTo(shockEcho,{scale:.25,opacity:.85},{scale:3.8,opacity:0,duration:.6,ease:'power3.out'},burst+.12);
          var ang=[-90,-54,-18,18,54,90,126,162,198,234];
          shards.forEach(function(el,i){var a=ang[i]*Math.PI/180,dist=150+((i%5)*26),X=Math.cos(a)*dist,Y=Math.sin(a)*dist*.62,rot=(i%2?1:-1)*(160+((i*53)%80));timeline.set(el,{opacity:1,x:0,y:0,scale:1,rotation:0},.57).to(el,{x:X,y:Y,rotation:rot,opacity:0,duration:.55+i*.03,ease:'power4.out'},.57);});
          /* punch: burst shake + landing thump */
          timeline.fromTo(dom,{x:0,y:0},{x:-11,y:8,duration:.045,ease:'power1.in'},burst).to(dom,{x:9,y:-9,duration:.055},burst+.045).to(dom,{x:-7,y:5,duration:.055},burst+.10).to(dom,{x:0,y:0,duration:.08,ease:'power2.out'},burst+.155).to(dom,{x:-4,y:3,duration:.05,ease:'power1.in'},1.2).to(dom,{x:3,y:-2,duration:.05},1.25).to(dom,{x:0,y:0,duration:.05},1.30);
          timeline.to(halo,{opacity:1,duration:.8},burst);
          /* hero emerges through the burst point, then performs its approved move below */
          timeline.fromTo(heroWrap,{scale:.08},{scale:1,duration:.48,ease:'power3.out'},heroT).to(hero,{opacity:1,duration:.45,ease:'power2.out'},heroT);
        }else{
          /* approved timeline, verbatim (Phoenix and any reduced fallback cards) */
          timeline.to(played,{y:-20,scale:.65,opacity:0,duration:.55},.7).to(hero,{opacity:.9,duration:.55},.75).to(halo,{opacity:1,duration:.8},.55).to(message,{opacity:1,duration:.6},1);
        }
        timeline.call(function(){if(effect&&renderer&&!renderer.lost){handle=renderer.context.play(effect,0,0,0);stats.launches++;launched=true;}},null,.55);
        if(event.outcome==='inert'||(id==='alvin'&&event.key!=='alvin-burn'))timeline.call(function(){if(handle&&handle.stop)handle.stop();},null,1.25);
        switch(id){
          case 'bonus':timeline.fromTo(hero,{y:20,scale:.6},{y:0,scale:1,duration:1,ease:'power3.out'},.7);break;
          case 'knife':timeline.fromTo(hero,{x:-100,y:-55,rotation:-35},{x:90,y:45,rotation:15,duration:.32,ease:'power4.in'},.8).to(hero,{opacity:0,duration:.2},1.15);break;
          case 'hunter':timeline.fromTo(hero,{scale:.5,rotation:-25},{scale:1,rotation:0,duration:.9,ease:'power3.out'},.7);break;
          case 'zombie':if(event.actor===event.target)timeline.to(hero,{x:85,duration:.5},.85).to(hero,{x:-85,rotation:180,duration:.65},1.35);else timeline.fromTo(hero,{y:25,scale:.8},{y:0,scale:1.1,duration:1.1},.7);break;
          case 'steal':timeline.fromTo(hero,{x:90},{x:-90,rotation:-15,duration:1.4,ease:'power2.inOut'},.8);break;
          case 'judge':timeline.fromTo(hero,{y:-35,scale:.7},{y:0,scale:1,duration:.7},.7);if(event.outcome!=='inert')timeline.to(hero,{y:25,scale:1.15,duration:.17,ease:'power4.in'},1.6);break;
          case 'reveal':case 'alvin':timeline.to(hero,{y:-35,scale:.75,duration:.6},1.1);break;
          case 'skipall':timeline.to(hero,{rotation:360,duration:1.5,ease:'power2.inOut'},.7);break;
          case 'phoenix':timeline.fromTo(hero,{scale:.3,y:40},{scale:1.65,y:-5,duration:1.5,ease:'power3.out'},.7);break;
          case 'trick':timeline.fromTo(hero,{rotationY:90},{rotationY:0,duration:1.1,ease:'power3.out'},.7);break;
          case 'stealturn':timeline.to(hero,{rotation:-180,duration:1.3,ease:'power2.inOut'},.7);break;
          case 'curse':timeline.to(hero,{rotation:45,scale:.85,duration:1.4},.7);break;
          case 'ghost':timeline.fromTo(hero,{y:25,opacity:.2},{y:0,opacity:.75,duration:1.2},.7);break;
        }
        if(dramatic){
          /* aurora: bloom, rays, embers, vignette */
          timeline.to(aurora,{opacity:1,scale:1,duration:.6,ease:'power2.in'},burst).to(aurora,{scale:1.12,duration:.42,ease:'sine.inOut'},heroDone).to(aurora,{scale:.9,duration:.45,ease:'sine.inOut'},heroDone+.42);
          timeline.fromTo(rays,{opacity:0,rotation:0},{opacity:.68,rotation:200,duration:Math.max(.4,duration-burst-.3),ease:'none'},burst);
          members.forEach(function(el,i){timeline.fromTo(el,{y:14,x:(i%2?1:-1)*(5+i),opacity:0},{y:-105-((i%3)*18),x:(i%2?1:-1)*(16+i*4),opacity:1,duration:Math.max(.5,duration-burst-.3),ease:'power1.out'},burst+.08+i*.05).to(el,{opacity:0,duration:.5},Math.max(1.2,duration-1.3));});
          timeline.to(vignette,{opacity:.82,duration:.18},burst).to(vignette,{opacity:.3,duration:.5},exitT);
          /* caption: dark hold beat, then snap-in at the particle peak */
          timeline.fromTo(tint,{opacity:0},{opacity:.5,duration:.12},burst+.12).to(tint,{opacity:0,duration:.16},Math.max(1.1,capAt-.05));
          timeline.fromTo(message,{scale:1.16,letterSpacing:'0.24em',opacity:0},{scale:1,letterSpacing:'0.03em',opacity:1,duration:.26,ease:'power3.out'},capAt).to(message,{scale:1.05,duration:.45,ease:'sine.inOut'},capAt+.34).to(message,{scale:1,duration:.45,ease:'sine.inOut'},capAt+.79);
          /* curtain: hero pose, caption wipe, bloom collapse, final dim - ends at duration */
          timeline.to(hero,{scale:1.22,duration:.12,ease:'power2.out'},poseT).to(hero,{scale:1.1,duration:.1},poseT+.12).to(hero,{opacity:0,duration:.24,ease:'power2.in'},duration-.28);
          timeline.to(aurora,{scale:.55,opacity:0,duration:.34,ease:'power3.in'},exitT+.12);
          timeline.to(rays,{opacity:0,duration:.25},wipeT);timeline.to(halo,{opacity:0,duration:.3},exitT+.2);
          timeline.to(message,{clipPath:'inset(0 100% 0 0%)',opacity:0,duration:.28,ease:'power2.in'},wipeT);
          timeline.fromTo(tint,{opacity:0},{opacity:.68,duration:.45,ease:'power1.in'},duration-.6).to(tint,{opacity:0,duration:.18},duration-.2);
        }else{
          timeline.to([hero,halo,message],{opacity:0,duration:.6},duration-.6);
        }
        gsap.ticker.add(render);ticker=true;
      }
      timeline.play(0);
    }
    var controller={node:node,stop:end,staticFallback:staticFallback};active=controller;
    timer=setTimeout(staticFallback,5000);
    if(reduced)build(null);else prepare().then(function(r){if(ended)return;if(r.lost){staticFallback();return;}return load(r,id).then(function(effect){if(!ended)build(effect);});}).catch(function(error){if(!ended){stats.error=String(error);staticFallback();}});
    return controller;
  }
  function release(){stop();epoch++;var r=renderer;renderer=null;preparation=null;if(r)Promise.allSettled(Array.from(r.loads.values())).then(function(){dispose(r);});}
  root.PhoenixCardScene={supports:supports,prepare:prepare,start:start,stop:stop,release:release,diagnostics:function(){return {active:!!active,key:active?active.node.dataset.effect:null,ready:!!renderer&&!renderer.lost,cache:renderer?renderer.effects.size:0,loading:renderer?renderer.loads.size:0,history:stats.history.slice(),plays:stats.plays,frames:stats.frames,launches:stats.launches,error:stats.error};}};
  document.addEventListener('visibilitychange',function(){if(document.hidden)stop();});root.addEventListener('pagehide',release);
  document.addEventListener('keydown',function(event){if(event.key==='Escape')stop();});
}(typeof globalThis!=='undefined'?globalThis:this));
