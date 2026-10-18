/* Standalone dramatic v2 review harness (proposal only - never loaded by the game).
 * Left stage reproduces today's approved timeline verbatim; right stage runs the
 * redesigned dramatic system driven by one per-card beat map:
 *   Vanish  - card bursts into shards + shockwave ring + flash frame
 *   Punch   - burst screen-shake
 *   Aurora  - themed bloom, rotating rays, rising embers, deepening vignette
 *   Caption - dark hold beat, then snap-in at the particle peak
 *   Curtain - hero pose hold, caption wipe, bloom collapse, ends at approved duration
 * The Phoenix card is forced to the approved timeline on both sides at any setting.
 * No match state, no audio, no network; one Effekseer context per stage. */
(function(root){
  'use strict';
  var CATALOG=root.PhoenixCardCinematicCatalog,ART=root.PhoenixCardCinematicArt,CARDS=root.PhoenixCards;
  var IDS=['bonus','knife','hunter','zombie','steal','judge','reveal','skipall','phoenix','trick','stealturn','curse','ghost','alvin'];
  var PHOENIX='phoenix';
  /* item 5 reference: proposed per-card caption cue (s), used to compute the v2 beat */
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
    var mount=section.querySelector('.cd-mount');
    var hero=mount.querySelector('.cd-hero'),heroWrap=mount.querySelector('.cd-hero-wrap');
    var halo=mount.querySelector('.cd-halo'),card=mount.querySelector('.cd-card'),message=mount.querySelector('.cd-message');
    var canvas=mount.querySelector('canvas');
    var gl=canvas.getContext('webgl2',{alpha:true,antialias:false,preserveDrawingBuffer:true})||canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true});
    var context=(gl&&root.effekseer)?root.effekseer.createContext():null;if(context)context.init(gl,{instanceMaxCount:512});
    var effects=new Map(),loads=new Map(),tl=null,handle=null,last=0,acc=0;
    function make(parent,n){var out=[];for(var i=0;i<n;i++){var el=document.createElement('i');parent.appendChild(el);out.push(el);}return out;}
    var embers=make(mount.querySelector('.cd-ember'),12),shards=make(mount.querySelector('.cd-shards'),10);
    var api={section:section,mount:mount,hero:hero,heroWrap:heroWrap,halo:halo,card:card,message:message,canvas:canvas,gl:gl,context:context,effects:effects,embers:embers,shards:shards,
      dom:mount.querySelector('.cd-dom'),aurora:mount.querySelector('.cd-aurora'),rays:mount.querySelector('.cd-rays'),shock:mount.querySelector('.cd-shock'),shockEcho:mount.querySelector('.cd-shock-echo'),
      flash:mount.querySelector('.cd-flash'),vignette:mount.querySelector('.cd-vignette'),tint:mount.querySelector('.cd-tint')};
    const HAS_EFK = {
  bonus:true, knife:true, hunter:true, zombie:true, steal:true, judge:true, reveal:true,
  skipall:true, trick:true, stealturn:true, curse:true, ghost:true, alvin:true, phoenix:true
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
    st.card.querySelector('.cd-card-icon').innerHTML=ART.icon(id);
    st.card.querySelector('.cd-card-name').textContent=CARDS.byId(id).name;
    st.message.querySelector('strong').textContent=CARDS.byId(id).name;
    st.message.querySelector('small').textContent=caption(id);
    st.stop();
    st.section.classList.toggle('cd-reduced',reduced);
    gsap.set(st.hero,{opacity:0,x:0,y:0,scale:1,rotation:0,rotationY:0});
    gsap.set(st.heroWrap,{scale:1});
    gsap.set(st.message,{opacity:0,scale:1,letterSpacing:'0.02em',clipPath:'inset(0 0% 0 0%)'});
    gsap.set(st.halo,{opacity:0,scale:1});
    gsap.set(st.card,{x:0,y:0,scale:1,rotation:0,opacity:1});
    gsap.set([st.flash,st.vignette,st.tint],{opacity:0});
    gsap.set(st.aurora,{opacity:0,scale:1});
    gsap.set(st.rays,{opacity:0,rotation:0});
    gsap.set(st.shock,{opacity:0,scale:.25});
    gsap.set(st.shockEcho,{opacity:0,scale:.25});
    st.embers.forEach(function(e){gsap.set(e,{opacity:0,x:0,y:0});});
    st.shards.forEach(function(e){gsap.set(e,{opacity:0,x:0,y:0,scale:1,rotation:0});});
    gsap.set(st.dom,{x:0,y:0});
    if(reduced){gsap.set(st.card,{opacity:0});gsap.set(st.hero,{opacity:0});gsap.set(st.message,{opacity:1});st.tl=gsap.timeline().to(st.message,{opacity:1,duration:1.1},0);}
    else{st.tl=buildTimeline(st,id,effect,improved);}
  }
  function buildTimeline(st,id,effect,improved){
    var def=CATALOG[id],gsap=root.gsap,duration=def.duration,hero=st.hero;
    var box=st.mount.getBoundingClientRect(),sx=0,sy=box.height*.55;
    var tl=gsap.timeline({paused:true,onComplete:function(){if(improved===false&&root.__cdOnDone)root.__cdOnDone();}});
    tl.fromTo(st.card,{x:sx,y:sy,scale:.45,rotation:-12,opacity:0},{x:0,y:0,scale:1,rotation:0,opacity:1,duration:.65,ease:'power3.out'},0)
      .call(function(){if(effect&&st.context&&!st.context.__ciLost){st.handle=st.context.play(effect,0,0,0);}},null,.55);
    if(!improved){
      /* approved timeline, verbatim */
      tl.to(st.card,{y:-20,scale:.65,opacity:0,duration:.55},.7).to(hero,{opacity:.9,duration:.55},.75).to(st.halo,{opacity:1,duration:.8},.55).to(st.message,{opacity:1,duration:.6},1);
      heroMove(tl,id,hero);
      tl.to([hero,st.halo,st.message],{opacity:0,duration:.6},duration-.6);
    }else{
      /* ---- dramatic v2 system (beat map) ---- */
      var d=duration,burst=.55,heroT=.7,heroDone=heroT+.5;
      var capAt=Math.min(Math.max(1.15,(CAPTION_AT[id]||1)-.1),d-1.5);
      var exitT=d-.9,wipeT=exitT+.1,poseT=exitT+.15;
      if(CONCEPTS.vanish){
        /* card snaps, flash frame, double shockwave, then bursts into ten shards */
        tl.to(st.card,{scale:1.14,duration:.05,ease:'power1.out'},.5)
          .to(st.card,{scale:.1,opacity:0,duration:.1,ease:'power3.in'},burst+.02);
        tl.fromTo(st.flash,{opacity:0},{opacity:1,duration:.07,ease:'none'},burst)
          .to(st.flash,{opacity:0,duration:.11,ease:'power2.out'},burst+.07);
        tl.fromTo(st.shock,{scale:.25,opacity:1},{scale:6.5,opacity:0,duration:.5,ease:'power2.out'},burst);
        tl.fromTo(st.shockEcho,{scale:.25,opacity:.85},{scale:3.8,opacity:0,duration:.6,ease:'power3.out'},burst+.12);
        var ang=[-90,-54,-18,18,54,90,126,162,198,234];
        st.shards.forEach(function(el,i){
          var a=ang[i]*Math.PI/180,dist=150+((i%5)*26),X=Math.cos(a)*dist,Y=Math.sin(a)*dist*.62,rot=(i%2?1:-1)*(160+((i*53)%80));
          tl.set(el,{opacity:1,x:0,y:0,scale:1,rotation:0},burst+.02)
            .to(el,{x:X,y:Y,rotation:rot,opacity:0,duration:.55+i*.03,ease:'power4.out'},burst+.02);
        });
      }else{
        tl.to(st.card,{y:-20,scale:.65,opacity:0,duration:.55},.7);
      }
      if(CONCEPTS.punch){
        var S=st.dom;
        tl.fromTo(S,{x:0,y:0},{x:-11,y:8,duration:.045,ease:'power1.in'},burst)
          .to(S,{x:9,y:-9,duration:.055},burst+.045)
          .to(S,{x:-7,y:5,duration:.055},burst+.10)
          .to(S,{x:0,y:0,duration:.08,ease:'power2.out'},burst+.155)
          .to(S,{x:-4,y:3,duration:.05,ease:'power1.in'},1.2)
          .to(S,{x:3,y:-2,duration:.05},1.25)
          .to(S,{x:0,y:0,duration:.05},1.30);
      }
      tl.to(st.halo,{opacity:1,duration:.8},.55);
      if(CONCEPTS.vanish){
        /* hero emerges through the burst point, then performs its approved move */
        tl.fromTo(st.heroWrap,{scale:.08},{scale:1,duration:.48,ease:'power3.out'},heroT)
          .to(hero,{opacity:1,duration:.45,ease:'power2.out'},heroT);
      }else{
        tl.to(hero,{opacity:.9,duration:.55},.75);
      }
      heroMove(tl,id,hero);
      if(CONCEPTS.aurora){
        var aur=st.aurora;
        tl.to(aur,{opacity:1,scale:1,duration:.6,ease:'power2.in'},burst)
          .to(aur,{scale:1.12,duration:.42,ease:'sine.inOut'},heroDone+.0)
          .to(aur,{scale:.9,duration:.45,ease:'sine.inOut'},heroDone+.42);
        tl.fromTo(st.rays,{opacity:0,rotation:0},{opacity:.68,rotation:200,duration:Math.max(.4,d-burst-.3),ease:'none'},burst);
        st.embers.forEach(function(el,i){
          tl.fromTo(el,{y:14,x:(i%2?1:-1)*(5+i),opacity:0},{y:-105-((i%3)*18),x:(i%2?1:-1)*(16+i*4),opacity:1,duration:Math.max(.5,d-burst-.3),ease:'power1.out'},burst+.08+i*.05)
            .to(el,{opacity:0,duration:.5},Math.max(1.2,d-1.3));
        });
        tl.to(st.vignette,{opacity:.82,duration:.18},burst)
          .to(st.vignette,{opacity:.3,duration:.5},exitT);
      }
      if(CONCEPTS.caption){
        /* dark hold beat between the flash and the caption's snap-in */
        tl.fromTo(st.tint,{opacity:0},{opacity:.5,duration:.12},burst+.12)
          .to(st.tint,{opacity:0,duration:.16},Math.max(1.1,capAt-.05));
        tl.fromTo(st.message,{scale:1.16,letterSpacing:'0.24em',opacity:0},{scale:1,letterSpacing:'0.03em',opacity:1,duration:.26,ease:'power3.out'},capAt)
          .to(st.message,{scale:1.05,duration:.45,ease:'sine.inOut'},capAt+.34)
          .to(st.message,{scale:1,duration:.45,ease:'sine.inOut'},capAt+.79);
      }else{
        tl.to(st.message,{opacity:1,duration:.6},1);
      }
      if(CONCEPTS.curtain){
        /* hero pose hold, caption wipe, bloom collapse, final dim - ends at duration */
        tl.to(hero,{scale:1.22,duration:.12,ease:'power2.out'},poseT)
          .to(hero,{scale:1.1,duration:.1},poseT+.12)
          .to(hero,{opacity:0,duration:.24,ease:'power2.in'},d-.28);
        tl.to(st.aurora,{scale:.55,opacity:0,duration:.34,ease:'power3.in'},exitT+.12);
        tl.to(st.rays,{opacity:0,duration:.25},wipeT);
        tl.to(st.halo,{opacity:0,duration:.3},exitT+.2);
        tl.to(st.message,{clipPath:'inset(0 100% 0 0%)',opacity:0,duration:.28,ease:'power2.in'},wipeT);
        tl.fromTo(st.tint,{opacity:0},{opacity:.68,duration:.45,ease:'power1.in'},d-.6)
          .to(st.tint,{opacity:0,duration:.18},d-.2);
      }else{
        tl.to([hero,st.halo,st.message],{opacity:0,duration:.6},d-.6);
      }
    }
    tl.play(0);
    return tl;
  }

  var stageA,stageB,current=IDS[0],serial=0,reduced=false,touring=false,tourTimer=null,ready=false,paused=false,duration=5.4,lastSig='';
  var CONCEPTS={vanish:true,aurora:true,caption:true,curtain:true,punch:true};
  function readConcepts(){['vanish','aurora','caption','curtain','punch'].forEach(function(k){CONCEPTS[k]=$('cd-c-'+k).checked;});}
  function $(id){return document.getElementById(id);}
  function note(id){
    var el=$('cd-note');
    if(id===PHOENIX){el.textContent='Phoenix is unchanged: the approved animation runs identically on both sides, at any concept setting (verified).';return;}
    var on=[];
    if(CONCEPTS.vanish)on.push('Vanish burst (shards + shockwave + flash)');
    if(CONCEPTS.punch)on.push('burst shake');
    if(CONCEPTS.aurora)on.push('Aurora lighting (bloom + rays + embers + vignette)');
    if(CONCEPTS.caption)on.push('on-the-beat caption at '+Math.min(Math.max(1.15,(CAPTION_AT[id]||1)-.1),CATALOG[id].duration-1.5).toFixed(2)+'s');
    if(CONCEPTS.curtain)on.push('Curtain exit (hero pose + wipe + bloom collapse)');
    el.textContent=on.length?('Right side runs the dramatic system: '+on.join('; ')+'. Untick any concept to fall back to today\u2019s approved behaviour for that piece.'):'All dramatic concepts are unticked: the right side should match the left exactly.';
  }
  function play(id){
    if(!ready||!id)return;
    var ticket=++serial;current=id;readConcepts();
    var loaded=Promise.all([stageA.load(id).catch(function(){return null;}),stageB.load(id).catch(function(){return null;})]);
    loaded.then(function(res){
      if(ticket!==serial)return;
      var improved=id!==PHOENIX;
      prepareStage(stageA,id,res[0],reduced,false);
      prepareStage(stageB,id,res[1],reduced,improved);
      note(id);
      duration=reduced?1.1:CATALOG[id].duration;
      var sc=$('cd-scrub');sc.max=String(duration);sc.value='0';$('cd-time').textContent='0.00s / '+duration.toFixed(2)+'s';
      paused=false;lastSig='';updatePauseBtn();
      if(touring){clearTimeout(tourTimer);tourTimer=setTimeout(function(){if(touring)nextCard();},(reduced?1.5:CATALOG[id].duration+.8)*1000);}
    });
  }
  function nextCard(){var i=IDS.indexOf(current),n=IDS[(i+1)%IDS.length];$('cd-card').value=n;play(n);}
  function stopTour(){touring=false;clearTimeout(tourTimer);$('cd-tour').setAttribute('aria-pressed','false');$('cd-tour').textContent='Play all 14';}
  function nowTime(){return stageA&&stageA.tl?stageA.tl.time():0;}
  function seekBoth(t){
    t=Math.max(0,Math.min(duration||1,t));
    [stageA,stageB].forEach(function(s){if(s.tl){s.tl.pause();s.tl.time(t);}});
    paused=true;updatePauseBtn();var sc=$('cd-scrub');sc.value=String(t);$('cd-time').textContent=t.toFixed(2)+'s / '+(duration||0).toFixed(2)+'s';
  }
  function pauseBoth(){[stageA,stageB].forEach(function(s){if(s.tl)s.tl.pause();});paused=true;updatePauseBtn();}
  function resumeBoth(){[stageA,stageB].forEach(function(s){if(s.tl)s.tl.play();});paused=false;updatePauseBtn();}
  function updatePauseBtn(){var b=$('cd-pause');if(b)b.textContent=paused?'\u25B6':'\u275A\u275A';}
  function metricsOf(st){
    function read(sel){var el=st.mount.querySelector(sel),cs=getComputedStyle(el),m=cs.transform.match(/matrix\(([^)]+)\)/),v=m?m[1].split(',').map(parseFloat):[1,0,0,1,0,0];return {op:+cs.opacity,sc:Math.sqrt(v[0]*v[0]+v[1]*v[1]),rot:Math.atan2(v[1],v[0])*180/Math.PI,x:v[4],y:v[5]};}
    return {Card:read('.cd-card'),Hero:read('.cd-hero'),Halo:read('.cd-halo'),Caption:read('.cd-message')};
  }
  function fmtMetric(m){return 'op '+m.op.toFixed(2)+' · scale '+m.sc.toFixed(2)+' · rot '+Math.round(m.rot)+'\u00b0 · pos '+Math.round(m.x)+','+Math.round(m.y);}
  function differs(a,b){return Math.abs(a.op-b.op)>.015||Math.abs(a.sc-b.sc)>.015||Math.abs(a.rot-b.rot)>.5||Math.abs(a.x-b.x)>1||Math.abs(a.y-b.y)>1;}
  function renderDelta(){
    if(!ready)return;
    var a=metricsOf(stageA),b=metricsOf(stageB),spot=$('cd-spot').checked,keys=['Card','Hero','Halo','Caption'],sel={Card:'.cd-card',Hero:'.cd-hero',Halo:'.cd-halo',Caption:'.cd-message'},sig='',rows='';
    keys.forEach(function(k){
      var d=differs(a[k],b[k]),mark=!!(d&&spot);
      [stageA,stageB].forEach(function(s){s.mount.querySelector(sel[k]).classList.toggle('ci-diff',mark);});
      sig+=k+':'+(d?'1':'0')+a[k].op.toFixed(2)+b[k].op.toFixed(2)+a[k].sc.toFixed(2)+b[k].sc.toFixed(2)+Math.round(a[k].rot)+Math.round(b[k].rot)+Math.round(a[k].x)+Math.round(a[k].y)+Math.round(b[k].x)+Math.round(b[k].y)+';';
      rows+='<tr class="'+(mark?'cd-row-diff':'')+'"><td>'+k+'</td><td>'+fmtMetric(a[k])+'</td><td>'+fmtMetric(b[k])+'</td><td>'+(d?'changed':'same')+'</td></tr>';
    });
    if(sig===lastSig)return;lastSig=sig;
    $('cd-delta').innerHTML='<table><thead><tr><th>Part</th><th>Original (left)</th><th>Dramatic (right)</th><th>&#916;</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  function readout(){
    if(!ready)return;
    var t=nowTime(),d=duration||0;
    $('cd-time').textContent=t.toFixed(2)+'s / '+d.toFixed(2)+'s';
    if(!paused&&!touring)$('cd-scrub').value=String(Math.min(t,d));
    renderDelta();
  }
  function init(){
    var select=$('cd-card');
    IDS.forEach(function(id){var o=document.createElement('option');o.value=id;o.textContent=CARDS.byId(id).name;select.appendChild(o);});
    select.value=current;
    readConcepts();
    function boot(){
      stageA=Stage($('cd-original'));stageB=Stage($('cd-dramatic'));
      if(!stageA.context||!root.gsap){
        $('cd-note').textContent='DOM storyboard only: WebGL/GSAP (or the Effekseer wasm) is unavailable here, so the particle layer is skipped.';
      }
      if(root.gsap)root.gsap.ticker.add(function(){stageA.render();stageB.render();readout();});
      root.__cdOnDone=function(){if(touring)return;};
      select.addEventListener('change',function(){stopTour();play(select.value);});
      $('cd-play').addEventListener('click',function(){stopTour();play(current);});
      $('cd-reduced').addEventListener('change',function(){reduced=$('cd-reduced').checked;stopTour();play(current);});
      ['vanish','aurora','caption','curtain','punch'].forEach(function(k){$('cd-c-'+k).addEventListener('change',function(){stopTour();play(current);});});
      $('cd-tour').addEventListener('click',function(){if(touring){stopTour();return;}touring=true;this.setAttribute('aria-pressed','true');this.textContent='Stop tour';play(current);});
      $('cd-scrub').addEventListener('input',function(){stopTour();seekBoth(+this.value);});
      $('cd-back').addEventListener('click',function(){stopTour();seekBoth(nowTime()-1/30);});
      $('cd-fwd').addEventListener('click',function(){stopTour();seekBoth(nowTime()+1/30);});
      $('cd-pause').addEventListener('click',function(){stopTour();if(paused)resumeBoth();else pauseBoth();});
      $('cd-spot').addEventListener('change',function(){lastSig='';renderDelta();});
      /* review hook: lets an inspector freeze both timelines at the same instant */
      root.PhoenixCardCinematicDramatic={play:function(id){stopTour();play(id);},seek:seekBoth,concepts:CONCEPTS,stages:[stageA,stageB]};
      ready=true;
      play(current);
    }
    var runtime=root.PhoenixParticleRuntime&&root.PhoenixParticleRuntime.prepare;
    if(runtime){try{runtime.call(root.PhoenixParticleRuntime).then(boot,boot);}catch(e){boot();}}
    else{boot();}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);