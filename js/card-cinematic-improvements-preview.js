/* Side-by-side review harness for proposed card-cinematic refinements (items 5-8).
 * Standalone: never loaded by the game, no match state, no audio, no network.
 * Left stage reproduces today's approved timeline verbatim; right stage applies
 * the proposed caption cue, card->hero handoff, staggered exit and halo drift.
 * The Phoenix card is forced to the approved timeline on both sides. */
(function(root){
  'use strict';
  var CATALOG=root.PhoenixCardCinematicCatalog,ART=root.PhoenixCardCinematicArt,CARDS=root.PhoenixCards;
  var IDS=['bonus','knife','hunter','zombie','steal','judge','reveal','skipall','phoenix','trick','stealturn','curse','ghost','alvin'];
  var PHOENIX='phoenix';
  /* item 5 - proposed per-card caption cue, in seconds */
  var CAPTION_AT={bonus:1.6,knife:1,hunter:1.3,zombie:1.3,steal:1.7,judge:1.5,reveal:1.5,skipall:1,trick:1.6,stealturn:1.4,curse:1.1,ghost:1.4,alvin:1.3};
  function caption(id){
    if(id==='alvin')return 'Private hand inspection · actor must choose one card';
    if(id==='judge')return 'Judge activated · most evil player banished for 3 rounds';
    return CATALOG[id].caption.replace(/\bYOU\b/g,'ACTOR').replace(/\bYOUR\b/g,'ACTOR\u2019S');
  }
  function heroMove(tl,id,hero){
    switch(id){
      case 'bonus':tl.fromTo(hero,{y:20,scale:.6},{y:0,scale:1,duration:1,ease:'power3.out'},.7);break;
      case 'knife':tl.fromTo(hero,{x:-100,y:-55,rotation:-35},{x:90,y:45,rotation:15,duration:.32,ease:'power4.in'},.8).to(hero,{opacity:0,duration:.2},1.15);break;
      case 'hunter':tl.fromTo(hero,{scale:.5,rotation:-25},{scale:1,rotation:0,duration:.9,ease:'power3.out'},.7);break;
      case 'zombie':tl.fromTo(hero,{y:25,scale:.8},{y:0,scale:1.1,duration:1.1},.7);break;
      case 'steal':tl.fromTo(hero,{x:90},{x:-90,rotation:-15,duration:1.4,ease:'power2.inOut'},.8);break;
      case 'judge':tl.fromTo(hero,{y:-35,scale:.7},{y:0,scale:1,duration:.7},.7).to(hero,{y:25,scale:1.15,duration:.17,ease:'power4.in'},1.6);break;
      case 'reveal':case 'alvin':tl.to(hero,{y:-35,scale:.75,duration:.6},1.1);break;
      case 'skipall':tl.to(hero,{rotation:360,duration:1.5,ease:'power2.inOut'},.7);break;
      case 'phoenix':tl.fromTo(hero,{scale:.3,y:40},{scale:1.65,y:-5,duration:1.5,ease:'power3.out'},.7);break;
      case 'trick':tl.fromTo(hero,{rotationY:90},{rotationY:0,duration:1.1,ease:'power3.out'},.7);break;
      case 'stealturn':tl.to(hero,{rotation:-180,duration:1.3,ease:'power2.inOut'},.7);break;
      case 'curse':tl.to(hero,{rotation:45,scale:.85,duration:1.4},.7);break;
      case 'ghost':tl.fromTo(hero,{y:25,opacity:.2},{y:0,opacity:.75,duration:1.2},.7);break;
    }
  }
  function Stage(section){
    var mount=section.querySelector('.ci-mount');
    var halo=mount.querySelector('.ci-halo'),hero=mount.querySelector('.ci-hero'),card=mount.querySelector('.ci-card'),message=mount.querySelector('.ci-message');
    var canvas=mount.querySelector('canvas');
    var gl=canvas.getContext('webgl2',{alpha:true,antialias:false,preserveDrawingBuffer:true})||canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true});
    var context=(gl&&root.effekseer)?root.effekseer.createContext():null;if(context)context.init(gl,{instanceMaxCount:512});
    var effects=new Map(),loads=new Map(),tl=null,handle=null,last=0,acc=0;
    var api={section:section,mount:mount,halo:halo,hero:hero,card:card,message:message,canvas:canvas,gl:gl,context:context,effects:effects};
    const HAS_EFK = {
  bonus:true, knife:true, hunter:true, zombie:true, steal:true, judge:true, reveal:true,
  skipall:true, trick:true, stealturn:true, curse:true, ghost:true, alvin:true, phoenix:true,
  dice:true, rps:true, betrayal:true, speed:true, wheel:true, linkedfate:true, impostor:true, swapper:true
};

api.load = function(id){
  if(!HAS_EFK[id]) return Promise.reject(Error('No .efk binary for ' + id));
  if(effects.has(id))return Promise.resolve(effects.get(id));if(loads.has(id))return loads.get(id);
  if(!context)return Promise.reject(Error('no webgl'));
  var effect,p=new Promise(function(resolve,reject){effect=context.loadEffect('assets/card-cinematics/'+id+'.efk',1,function(){loads.delete(id);effects.set(id,effect);resolve(effect);},function(reason,url){loads.delete(id);if(effect)context.releaseEffect(effect);reject(Error(url+': '+reason));});});
  loads.set(id,p);return p;
};
    api.stop=function(){if(tl){tl.kill();tl=null;}if(handle&&handle.stop)handle.stop();handle=null;if(context)context.stopAll();last=0;acc=0;};
    api.render=function(){
      if(!context||!gl||!tl)return;
      try{
        var t=tl.time(),dt=Math.max(0,Math.min(.06,t-last));last=t;acc+=dt;if(acc<1/30)return;
        var box=mount.getBoundingClientRect(),ratio=Math.min(root.devicePixelRatio||1,1.25,960/Math.max(box.width,box.height));
        var w=Math.max(1,Math.round(box.width*ratio)),h=Math.max(1,Math.round(box.height*ratio));
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
        context.update(Math.min(acc,.1)*60);acc=0;
        gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        context.setProjectionPerspective(40,w/h,.1,200);
        context.setCameraLookAt(0,0,Math.max(30,22/(.728*w/h)),0,0,0,0,1,0);
        context.draw();
      }catch(e){}
    };
    return api;
  }
  function prepareStage(st,id,effect,reduced,improved){
    var def=CATALOG[id],gsap=root.gsap;
    st.section.style.setProperty('--ci-color',def.color);
    st.hero.innerHTML=ART.icon(id);
    st.card.querySelector('.ci-card-icon').innerHTML=ART.icon(id);
    st.card.querySelector('.ci-card-name').textContent=CARDS.byId(id).name;
    st.message.querySelector('strong').textContent=CARDS.byId(id).name;
    st.message.querySelector('small').textContent=caption(id);
    st.stop();
    st.section.classList.toggle('ci-reduced',reduced);
    gsap.set(st.hero,{opacity:0,x:0,y:0,scale:1,rotation:0,rotationY:0});
    gsap.set(st.message,{opacity:0});
    gsap.set(st.halo,{opacity:0,scale:1});
    gsap.set(st.card,{x:0,y:0,scale:1,rotation:0,opacity:1});
    if(reduced){gsap.set(st.card,{opacity:0});gsap.set(st.hero,{opacity:0});gsap.set(st.message,{opacity:1});st.tl=gsap.timeline().to(st.message,{opacity:1,duration:1.1},0);}
    else{st.tl=buildTimeline(st,id,effect,improved);}
  }
  function buildTimeline(st,id,effect,improved){
    var def=CATALOG[id],gsap=root.gsap,duration=def.duration,hero=st.hero;
    var box=st.mount.getBoundingClientRect(),sx=0,sy=box.height*.55;
    var tl=gsap.timeline({paused:true,onComplete:function(){if(improved===false&&root.__ciOnDone)root.__ciOnDone();}});
    tl.fromTo(st.card,{x:sx,y:sy,scale:.45,rotation:-12,opacity:0},{x:0,y:0,scale:1,rotation:0,opacity:1,duration:.65,ease:'power3.out'},0)
      .call(function(){if(effect&&st.context&&!st.context.__ciLost){st.handle=st.context.play(effect,0,0,0);}},null,.55);
    if(improved){
      var sh=STR.handoff,sc0=STR.caption,sr=STR.halo,se=STR.exit;
      if(sh>0){
        /* item 6 - the played card collapses into the hero position and the hero
         * grows out of the card's size instead of the card drifting upward.
         * 1.0x = proposal (card to y:0, scale .5; hero from scale .5);
         * <1 blends toward the approved float-up, >1 amplifies. */
        tl.to(st.card,{y:-20*(1-Math.min(sh,1)),scale:Math.max(.2,.65-.15*sh),opacity:0,duration:Math.max(.3,.55-.1*sh),ease:'power2.in'},.7)
          .fromTo(hero,{scale:Math.max(.2,1-.5*sh),opacity:0},{scale:1,opacity:.9,duration:.5,ease:'power2.out'},.7);
      }else{
        tl.to(st.card,{y:-20,scale:.65,opacity:0,duration:.55},.7).to(hero,{opacity:.9,duration:.55},.75);
      }
      tl.to(st.halo,{opacity:1,duration:.8},.55);
      if(sr>0)tl.to(st.halo,{scale:1+.06*sr,duration:(duration-.55)/2,ease:'sine.inOut',repeat:1,yoyo:true},.55);
      var capAt=1;if(sc0>0)capAt=Math.min(1+((CAPTION_AT[id]||1)-1)*sc0,Math.max(1,duration-1.2));
      tl.to(st.message,{opacity:1,duration:.6},capAt);
      heroMove(tl,id,hero);
      if(se>0){
        /* item 7 - layered exit, still ending at the approved duration;
         * 1.0x = hero by duration-.35, halo by duration-.1, caption last. */
        tl.to(hero,{opacity:0,duration:.6,ease:'power2.in'},duration-.6-.35*se)
          .to(st.halo,{opacity:0,duration:.7},duration-.7-.1*se)
          .to(st.message,{opacity:0,duration:.55},duration-.55);
      }else{
        tl.to([hero,st.halo,st.message],{opacity:0,duration:.6},duration-.6);
      }
    }else{
      tl.to(st.card,{y:-20,scale:.65,opacity:0,duration:.55},.7).to(hero,{opacity:.9,duration:.55},.75).to(st.halo,{opacity:1,duration:.8},.55).to(st.message,{opacity:1,duration:.6},1);
      heroMove(tl,id,hero);
      tl.to([hero,st.halo,st.message],{opacity:0,duration:.6},duration-.6);
    }
    tl.play(0);
    return tl;
  }

  var stageA,stageB,current=IDS[0],serial=0,reduced=false,touring=false,tourTimer=null,ready=false,paused=false,duration=5.4,lastSig='';
  var STR={caption:1,handoff:1,exit:1,halo:1};
  function readStrength(){
    ['handoff','caption','halo','exit'].forEach(function(k){
      var el=$('ci-s-'+k),v=el?parseFloat(el.value):1;STR[k]=isFinite(v)?Math.max(0,v):1;
      var lbl=$('ci-v-'+k);if(lbl)lbl.textContent=STR[k].toFixed(1)+'\u00d7';
    });
  }
  function $(id){return document.getElementById(id);}
  function note(id){
    var el=$('ci-note');
    if(id===PHOENIX){el.textContent='Phoenix is unchanged: the approved animation runs identically on both sides, by request.';return;}
    var on=[];
    if(STR.handoff>0)on.push('6 handoff \u00d7'+STR.handoff.toFixed(1));
    if(STR.caption>0)on.push('5 caption cue \u00d7'+STR.caption.toFixed(1)+' (at '+Math.min(1+((CAPTION_AT[id]||1)-1)*STR.caption,Math.max(1,CATALOG[id].duration-1.2)).toFixed(1)+'s)');
    if(STR.exit>0)on.push('7 exit stagger \u00d7'+STR.exit.toFixed(1));
    if(STR.halo>0)on.push('8 halo drift \u00d7'+STR.halo.toFixed(1));
    el.textContent=on.length?('Improved side applies: '+on.join(', ')+'. Any 0.0\u00d7 item falls back to the approved behaviour.'):'All refinements at 0.0\u00d7: both sides should now match exactly.';
  }
  function play(id){
    if(!ready||!id)return;
    var ticket=++serial;current=id;readStrength();
    var loaded=Promise.all([stageA.load(id).catch(function(){return null;}),stageB.load(id).catch(function(){return null;})]);
    loaded.then(function(res){
      if(ticket!==serial)return;
      var improved=id!==PHOENIX;
      prepareStage(stageA,id,res[0],reduced,false);
      prepareStage(stageB,id,res[1],reduced,improved);
      note(id);
      duration=reduced?1.1:CATALOG[id].duration;
      var sc=$('ci-scrub');sc.max=String(duration);sc.value='0';$('ci-time').textContent='0.00s / '+duration.toFixed(2)+'s';
      paused=false;lastSig='';updatePauseBtn();
      if(touring){clearTimeout(tourTimer);tourTimer=setTimeout(function(){if(touring)nextCard();},(reduced?1.5:CATALOG[id].duration+.5)*1000);}
    });
  }
  function nextCard(){var i=IDS.indexOf(current),n=IDS[(i+1)%IDS.length];$('ci-card').value=n;play(n);}
  function stopTour(){touring=false;clearTimeout(tourTimer);$('ci-tour').setAttribute('aria-pressed','false');$('ci-tour').textContent='Play all 14';}
  function nowTime(){return stageA&&stageA.tl?stageA.tl.time():0;}
  function seekBoth(t){
    t=Math.max(0,Math.min(duration||1,t));
    [stageA,stageB].forEach(function(s){if(s.tl){s.tl.pause();s.tl.time(t);}});
    paused=true;updatePauseBtn();var sc=$('ci-scrub');sc.value=String(t);$('ci-time').textContent=t.toFixed(2)+'s / '+(duration||0).toFixed(2)+'s';
  }
  function pauseBoth(){[stageA,stageB].forEach(function(s){if(s.tl)s.tl.pause();});paused=true;updatePauseBtn();}
  function resumeBoth(){[stageA,stageB].forEach(function(s){if(s.tl)s.tl.play();});paused=false;updatePauseBtn();}
  function updatePauseBtn(){var b=$('ci-pause');if(b)b.textContent=paused?'\u25B6':'\u275A\u275A';}
  function metricsOf(st){
    function read(sel){var el=st.mount.querySelector(sel),cs=getComputedStyle(el),m=cs.transform.match(/matrix\(([^)]+)\)/),v=m?m[1].split(',').map(parseFloat):[1,0,0,1,0,0];return {op:+cs.opacity,sc:Math.sqrt(v[0]*v[0]+v[1]*v[1]),rot:Math.atan2(v[1],v[0])*180/Math.PI,x:v[4],y:v[5]};}
    return {Card:read('.ci-card'),Hero:read('.ci-hero'),Halo:read('.ci-halo'),Caption:read('.ci-message')};
  }
  function fmtMetric(m){return 'op '+m.op.toFixed(2)+' · scale '+m.sc.toFixed(2)+' · rot '+Math.round(m.rot)+'\u00b0 · pos '+Math.round(m.x)+','+Math.round(m.y);}
  function differs(a,b){return Math.abs(a.op-b.op)>.015||Math.abs(a.sc-b.sc)>.015||Math.abs(a.rot-b.rot)>.5||Math.abs(a.x-b.x)>1||Math.abs(a.y-b.y)>1;}
  function renderDelta(){
    if(!ready)return;
    var a=metricsOf(stageA),b=metricsOf(stageB),spot=$('ci-spot').checked,keys=['Card','Hero','Halo','Caption'],sel={Card:'.ci-card',Hero:'.ci-hero',Halo:'.ci-halo',Caption:'.ci-message'},sig='',rows='';
    keys.forEach(function(k){
      var d=differs(a[k],b[k]),mark=!!(d&&spot);
      [stageA,stageB].forEach(function(s){s.mount.querySelector(sel[k]).classList.toggle('ci-diff',mark);});
      sig+=k+':'+(d?'1':'0')+a[k].op.toFixed(2)+b[k].op.toFixed(2)+a[k].sc.toFixed(2)+b[k].sc.toFixed(2)+Math.round(a[k].rot)+Math.round(b[k].rot)+Math.round(a[k].x)+Math.round(a[k].y)+Math.round(b[k].x)+Math.round(b[k].y)+';';
      rows+='<tr class="'+(mark?'ci-row-diff':'')+'"><td>'+k+'</td><td>'+fmtMetric(a[k])+'</td><td>'+fmtMetric(b[k])+'</td><td>'+(d?'changed':'same')+'</td></tr>';
    });
    if(sig===lastSig)return;lastSig=sig;
    $('ci-delta').innerHTML='<table><thead><tr><th>Part</th><th>Original (left)</th><th>Improved (right)</th><th>&#916;</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function readout(){
    if(!ready)return;
    var t=nowTime(),d=duration||0;
    $('ci-time').textContent=t.toFixed(2)+'s / '+d.toFixed(2)+'s';
    if(!paused&&!touring)$('ci-scrub').value=String(Math.min(t,d));
    renderDelta();
  }

  function init(){
    var select=$('ci-card');
    IDS.forEach(function(id){var o=document.createElement('option');o.value=id;o.textContent=CARDS.byId(id).name;select.appendChild(o);});
    select.value=current;
    readStrength();
    function boot(){
      stageA=Stage($('ci-original'));stageB=Stage($('ci-improved'));
      if(!stageA.context||!root.gsap){
        $('ci-note').textContent='DOM storyboard only: WebGL/GSAP (or the Effekseer wasm) is unavailable here, so the particle layer is skipped.';
      }
      if(root.gsap)root.gsap.ticker.add(function(){stageA.render();stageB.render();readout();});
      root.__ciOnDone=function(){if(touring)return;};
      select.addEventListener('change',function(){stopTour();play(select.value);});
      $('ci-play').addEventListener('click',function(){stopTour();play(current);});
      $('ci-reduced').addEventListener('change',function(){reduced=$('ci-reduced').checked;stopTour();play(current);});
      ['handoff','caption','halo','exit'].forEach(function(k){$('ci-s-'+k).addEventListener('input',function(){readStrength();stopTour();play(current);});});
      $('ci-tour').addEventListener('click',function(){if(touring){stopTour();return;}touring=true;this.setAttribute('aria-pressed','true');this.textContent='Stop tour';play(current);});
      $('ci-scrub').addEventListener('input',function(){stopTour();seekBoth(+this.value);});
      $('ci-back').addEventListener('click',function(){stopTour();seekBoth(nowTime()-1/30);});
      $('ci-fwd').addEventListener('click',function(){stopTour();seekBoth(nowTime()+1/30);});
      $('ci-pause').addEventListener('click',function(){stopTour();if(paused)resumeBoth();else pauseBoth();});
      $('ci-spot').addEventListener('change',function(){lastSig='';renderDelta();});
      /* review hook: lets an inspector freeze both timelines at the same instant */
      root.PhoenixCardCinematicPreview={play:function(id){stopTour();play(id);},seek:seekBoth,str:STR,readStrength:readStrength,stages:[stageA,stageB]};
      ready=true;
      play(current);
    }
    var runtime=root.PhoenixParticleRuntime&&root.PhoenixParticleRuntime.prepare;
    if(runtime){try{runtime.call(root.PhoenixParticleRuntime).then(boot,boot);}catch(e){boot();}}
    else{boot();}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
