/* Isolated, silent fictional demonstrations. No rules/network/audio imports. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),cards=PhoenixCards.CARDS,catalog=PhoenixCardCinematicCatalog;
  const shapes={
    bonus:'<circle cx="50" cy="50" r="32"/><circle cx="50" cy="50" r="25"/><path d="M50 28v44M63 36H44a8 8 0 0 0 0 16h12a8 8 0 0 1 0 16H37"/>',
    knife:'<path d="M67 12L38 52l10 10 37-36-18-14ZM41 58L22 80l-5-5 20-23M28 52l28 22M24 73l8 7"/>',
    hunter:'<path d="M24 19q48 31 0 62M24 19v62M18 50h64l-12-9M82 50l-12 9M42 29l8-12 8 12M50 17v15"/>',
    zombie:'<path d="M24 51a28 28 0 1 1 52 0l-8 10v18H32V61Z"/><path d="M34 73h32M42 65v14M50 65v14M58 65v14M46 57l4-8 4 8"/><circle cx="38" cy="42" r="7"/><circle cx="62" cy="42" r="7"/>',
    steal:'<path d="M17 51h65M30 38L17 51l13 13M56 20q26 0 26 22M41 80q-24 0-24-20"/><circle cx="54" cy="51" r="16"/><path d="M54 41v20"/>',
    judge:'<path d="M50 16v62M26 82h48M23 29h54M29 29L16 54h26ZM71 29L58 54h26Z"/><circle cx="50" cy="20" r="5"/><path d="M16 54q13 13 26 0M58 54q13 13 26 0"/>',
    reveal:'<path d="M9 50q41-51 82 0Q50 101 9 50Z"/><circle cx="50" cy="50" r="17"/><circle cx="50" cy="50" r="6"/><path d="M50 12v10M50 78v10"/>',
    skipall:'<path d="M20 36a33 33 0 1 1 0 29M20 36V18M20 36h18M36 39l17 12-17 12ZM58 39v24M68 39v24"/>',
    phoenix:'<path d="M50 76L40 54 15 44 5 16l29 15L46 46 50 29 54 46l12-15 29-15-10 28-25 10ZM50 76l-13 14 13-6 13 6ZM50 29l-5-10 12 2-7 8"/><path d="M13 26l26 19M20 38l22 12M87 26L61 45M80 38L58 50M50 49v27"/>',
    trick:'<path d="M13 22l34 8v35q-17 23-34-4ZM53 30l34-8v39q-17 27-34 4Z"/><path d="M21 39l15 4M64 43l15-4M22 54q8 12 16 0M63 59q8-12 16 0"/>',
    stealturn:'<circle cx="50" cy="50" r="31"/><path d="M50 28v23l18 10M50 14v8M50 78v8M14 50h8M78 50h8M21 18h19M21 18v19M21 18q-15 18-12 35"/>',
    curse:'<path d="M50 10L84 30v40L50 90 16 70V30ZM50 23L73 64H27ZM50 40v16M50 64v2M16 30l68 40M84 30L16 70"/>',
    ghost:'<path d="M25 79V43a25 25 0 0 1 50 0v36L62 70 50 83 38 70Z"/><path d="M37 42v9M63 42v9M44 60q6 4 12 0M15 32l-5-7M85 32l5-7"/>',
    alvin:'<ellipse cx="50" cy="64" rx="23" ry="18"/><ellipse cx="23" cy="40" rx="9" ry="12" transform="rotate(-25 23 40)"/><ellipse cx="41" cy="27" rx="9" ry="12"/><ellipse cx="61" cy="27" rx="9" ry="12"/><ellipse cx="79" cy="40" rx="9" ry="12" transform="rotate(25 79 40)"/>',
    dice:'<rect x="20" y="20" width="60" height="60" rx="8"/><circle cx="35" cy="35" r="5"/><circle cx="65" cy="65" r="5"/><circle cx="35" cy="65" r="5"/><circle cx="65" cy="35" r="5"/><circle cx="50" cy="50" r="5"/>',
    rps:'<path d="M30 20v60M70 20v60M20 40h20M60 60h20"/><circle cx="30" cy="15" r="8"/><circle cx="70" cy="85" r="8"/>',
    betrayal:'<path d="M20 30q30 20 0 40M80 30q-30 20 0 40"/><circle cx="35" cy="50" r="8"/><circle cx="65" cy="50" r="8"/>',
    speed:'<path d="M20 50h60M70 35l15 15-15 15"/><circle cx="25" cy="50" r="10"/>',
    wheel:'<circle cx="50" cy="50" r="40"/><path d="M50 10v80M10 50h80M22 22l56 56M22 78l56-56"/><circle cx="50" cy="50" r="8"/>',
    linkedfate:'<path d="M25 30q25 20 0 40M75 30q-25 20 0 40"/><path d="M40 50h20"/><circle cx="30" cy="50" r="12"/><circle cx="70" cy="50" r="12"/>',
    impostor:'<path d="M30 20q20 30 0 60M70 20q-20 30 0 60"/><circle cx="50" cy="50" r="15"/><path d="M40 45h20M45 55h10"/>',
    swapper:'<path d="M25 40q25-20 50 0M25 60q25 20 50 0"/><path d="M40 30l-15 10 15 10M60 70l15-10-15-10"/>',
    joshuasurvey:'<path d="M26 18h48v64H26Z"/><path d="M34 30h32M34 42h32M34 54h22"/><path d="M60 62l14 14-6 6-14-14Z"/>',
    trailer:'<rect x="14" y="30" width="72" height="44" rx="6"/><path d="M14 44h72M26 62l10-10 10 8 12-12 8 8"/><circle cx="78" cy="30" r="8"/>',
    wheelofmisfortune:'<circle cx="50" cy="50" r="40"/><path d="M50 10v80M10 50h80"/><path d="M50 50L50 10A40 40 0 0 1 90 50Z" fill="currentColor" opacity="0.3"/>',
    musicalchairs:'<path d="M20 70h60M28 70V40h44v30"/><path d="M18 40h48l-8-14H26Z"/><path d="M44 26V14M38 14h12"/>',
    russianroulette:'<circle cx="50" cy="52" r="26"/><circle cx="50" cy="52" r="8"/><path d="M50 26V16M50 16l-10 6M50 16l10 6M36 34l-8-8M64 34l8-8"/><path d="M64 68l14 14"/>',
    memorymayhem:'<circle cx="36" cy="42" r="12"/><circle cx="64" cy="42" r="12"/><path d="M48 42h4"/><path d="M30 66q20 18 40 0"/><path d="M40 74h20"/>',
    bankrobbery:'<rect x="16" y="44" width="68" height="40" rx="5"/><circle cx="50" cy="62" r="12"/><path d="M50 50v24M38 62h24"/><path d="M30 44V32a20 20 0 0 1 40 0v12"/>',
    pointswap:'<path d="M22 38h40l-12-12"/><path d="M78 62H38l12 12"/><path d="M22 38v10M78 62V52"/>',
    hostage:'<circle cx="50" cy="34" r="14"/><path d="M36 50h28v34H36Z"/><path d="M28 30h44"/><path d="M44 50v-8M56 50v-8"/>',
    president:'<path d="M50 18l8 12h-16Z"/><path d="M24 84l8-34 18 14 18-14 8 34Z"/><path d="M36 30l6-10 8 12 8-12 6 10"/>',
    mimic:'<path d="M20 62c0-20 14-34 30-34s30 14 30 34"/><path d="M34 60h.01M50 60h.01M66 60h.01"/><path d="M38 74q12 10 24 0"/><path d="M64 34l14-12"/>',
    dehydrated:'<path d="M50 14c-14 20-22 30-22 42a22 22 0 0 0 44 0c0-12-8-22-22-42Z"/><path d="M40 58a10 10 0 0 0 10 10"/>',
    nothing:'<circle cx="50" cy="50" r="28"/><path d="M40 44h.01M60 44h.01"/><path d="M40 62q10-6 20 0"/>',
    reverseofdoom:'<circle cx="50" cy="50" r="26"/><path d="M50 24v26l16 10"/><path d="M50 14l8 8M50 14l-8 8M50 86l8-8M50 86l-8-8"/>',
    support:'<path d="M30 24h40a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H42l-14 12V36a6 6 0 0 1 2-12Z"/><path d="M40 42h20M40 52h14"/>'
  };
  function icon(id){return '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+shapes[id]+'</svg>';}
  let current=cards[0],timeline=null,context=null,gl=null,manifest=null,serial=0,ready=false,paused=false,touring=false,tourTimer=null,lastTime=0,frames=0,frameMs=0,ticking=false,released=false,handles=[],cache=new Map(),loads=new Map();
  const canvas=$('particles'),media=matchMedia('(prefers-reduced-motion: reduce)');$('reduced').checked=media.matches;
  const diagnostics={plays:0,errors:[],launches:0,peakHandles:0,finished:0};
  function reduced(){return $('reduced').checked;}
  function report(error){const message=String(error.message||error);diagnostics.errors.push(message);$('error').textContent='Particle renderer unavailable. The card’s visual explanation still works. '+message;}
  function halt(){clearTimeout(tourTimer);if(timeline)timeline.kill();timeline=null;if(ticking){gsap.ticker.remove(render);ticking=false;}if(context)context.stopAll();handles=[];paused=false;$('pause').textContent='Pause';}
  function clearCanvas(){if(gl&&!gl.isContextLost()){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);}}
  function purge(){for(const [id,effect] of cache){if(cache.size<=2)break;if(id!==current.id){context.releaseEffect(effect);cache.delete(id);}}}
  // Cards that have actual .efk binaries in assets/card-cinematics/
 // All 22 catalog cards now ship compiled originals.
 // Wheel of Misfortune is listed and previewed, but its binary is not compiled
 // yet (see manifest.awaitingCompilation), so it shows the emblem treatment.
 // The OWNER-ONLY cards appear in the GALLERY and nowhere else. They have
 // their own metadata here rather than in the cinematic catalogue, because
 // the cinematics are the public showcase and these two must never be in it.
 const OWNER_CARDS = {
  joshuasurvey: { color: '#ffd16b', title: 'Ten questions, the owner decides',
    motif: 'A sheet of questions, a pencil, and a very large stamp.',
    duration: 4.6, variants: ['A question is drawn', 'Everybody answers', 'The owner judges'],
    caption: 'AN ACCEPTED ANSWER EARNS 50,000 POINTS · THE OWNER DECIDES' },
  trailer: { color: '#ff4081', title: 'Did you like the trailer?',
    motif: 'A projector whirs up in the dark and a big score lands.',
    duration: 4.8, variants: ['Choose an opponent', 'The trailer plays'],
    caption: 'NO SKIP · NO FAST FORWARD · THE TRAILER PLAYS OVER THEIR GAME' }
 };

 // The gallery's own metadata, with the owner-only cards folded in.
 function meta(id) {
  return catalog[id] || OWNER_CARDS[id] || { color: '#888', title: id, motif: '', duration: 3, variants: [], caption: '' };
 }
const HAS_EFK = {
  bonus:true, knife:true, hunter:true, zombie:true, steal:true, judge:true, reveal:true,
  skipall:true, trick:true, stealturn:true, curse:true, ghost:true, alvin:true, phoenix:true,
  dice:true, rps:true, betrayal:true, speed:true, wheel:true, linkedfate:true, impostor:true, swapper:true,
  // The expansion. Every one of these has a compiled binary of its own.
  musicalchairs:true, russianroulette:true, memorymayhem:true, bankrobbery:true,
  pointswap:true, hostage:true, president:true, mimic:true, dehydrated:true,
  nothing:true, reverseofdoom:true, support:true, wheelofmisfortune:true
};

function load(id){
  if(!HAS_EFK[id]) return Promise.resolve(null);
  if(cache.has(id))return Promise.resolve(cache.get(id));
  if(loads.has(id))return loads.get(id);
  let effect;const p=new Promise((resolve,reject)=>{
    effect=context.loadEffect('assets/card-cinematics/'+id+'.efk',1,()=>{
      loads.delete(id);if(released){context.releaseEffect(effect);resolve(null);return;}
      cache.set(id,effect);purge();resolve(effect);
    },(reason,url)=>{
      loads.delete(id);if(effect)context.releaseEffect(effect);reject(Error(url+': '+reason));
    });
  });loads.set(id,p);return p;
}
  function spawn(effect){if(!context||!effect||reduced()||!ready)return;const handle=context.play(effect,0,0,0);if(handle){handles.push(handle);diagnostics.launches++;diagnostics.peakHandles=Math.max(diagnostics.peakHandles,handles.length);}}
  function render(){if(!context||!ready||!timeline||paused||document.hidden)return;try{const t=timeline.time(),dt=Math.max(0,Math.min(.05,t-lastTime));lastTime=t;frameMs+=dt;const fps=$('quality').value==='low'?24:30;if(frameMs<1/fps)return;context.update(Math.min(frameMs,.1)*60);frameMs=0;const r=$('stage').getBoundingClientRect(),limit=$('quality').value==='high'?1440:$('quality').value==='low'?800:1120,ratio=Math.min(devicePixelRatio||1,$('quality').value==='high'?1.5:1.25,limit/Math.max(r.width,r.height)),w=Math.max(1,Math.round(r.width*ratio)),h=Math.max(1,Math.round(r.height*ratio));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);clearCanvas();const distance=Math.max(30,22/(.728*w/h)),focusY=(innerWidth<=720?-.16:-.08)*.728*distance;context.setProjectionPerspective(40,w/h,.1,200);context.setCameraLookAt(0,focusY,distance,0,focusY,0,0,1,0);context.draw();frames++;}catch(error){ready=false;report(error);if(ticking){gsap.ticker.remove(render);ticking=false;}}}
  function text(id,value){$(id).textContent=value;}
  function stateAt(t,id,value){timeline.call(()=>text(id,value),null,t);}
  function seatPulse(which,t){timeline.fromTo(which,{borderColor:'#ffffff18'},{borderColor:catalog[current.id].color,duration:.25,repeat:1,yoyo:true},t);}
  function handAt(t,privateFaces){timeline.to($('hand'),{autoAlpha:1,duration:.3},t);timeline.fromTo('.hand-card',{y:25,rotationY:privateFaces?90:0},{y:0,rotationY:0,stagger:.08,duration:.45},t);if(privateFaces)timeline.call(()=>{document.querySelectorAll('.hand-card').forEach(n=>{n.style.background='#222a38';n.firstChild.style.display='block';});},null,t+.2);}
  function choreograph(id,v){const actor=document.querySelector('.actor'),target=document.querySelector('.target'),hero=$('hero');
    const out=(who,t,rounds)=>{timeline.to(who,{opacity:.28,duration:.65},t);stateAt(t,who===actor?'actor-status':'target-status','OUT · '+rounds+' ROUND'+(rounds>1?'S':''));};
    switch(id){
      case 'bonus':timeline.fromTo(hero,{y:20,scale:.6},{y:0,scale:1,duration:1,ease:'power3.out'},.7);stateAt(1.35,'actor-score','30,000');seatPulse(actor,1.35);break;
      case 'knife':timeline.fromTo(hero,{x:-100,y:-55,rotation:-35},{x:90,y:45,rotation:15,duration:.32,ease:'power4.in'},.8);timeline.to(hero,{opacity:0,duration:.2},1.15);out(target,1.15,1);timeline.fromTo(target,{x:0},{x:4,repeat:3,yoyo:true,duration:.055},1.12);break;
      case 'hunter':timeline.fromTo(hero,{scale:.5,rotation:-25},{scale:1,rotation:0,duration:.9,ease:'power3.out'},.7);stateAt(1.3,'actor-status',v===1?'HUNTER ALREADY HELD':'HUNTER HELD');seatPulse(actor,1.3);break;
      case 'zombie':if(v===1){timeline.to(hero,{x:85,duration:.5,ease:'power2.in'},.85).to(hero,{x:-85,rotation:180,duration:.65,ease:'power2.inOut'},1.35);stateAt(1.35,'target-status','HUNTER · REFLECTED');out(actor,2,1);}else{timeline.fromTo(hero,{y:25,scale:.8},{y:0,scale:1.1,duration:1.1},.7);out(target,1.7,1);stateAt(1.7,'target-score','0');}break;
      case 'steal':timeline.fromTo(hero,{x:90},{x:-90,rotation:-15,duration:1.4,ease:'power2.inOut'},.8);stateAt(1.8,'actor-score',v===1?'20,000':'50,000');stateAt(1.8,'target-score','0');seatPulse(actor,1.8);break;
      case 'judge':timeline.fromTo(hero,{y:-35,scale:.7},{y:0,scale:1,duration:.7},.7);if(v===0){timeline.to(hero,{y:25,scale:1.15,duration:.17,ease:'power4.in'},1.6);out(target,1.8,3);}else{timeline.to(hero,{opacity:.25,scale:.85,duration:.7},1.4);stateAt(1.4,'target-status',v===1?'NO VERDICT':'NO EVIL CARDS');}break;
      case 'reveal':timeline.to(hero,{y:-65,scale:.55,duration:.6},1.1);handAt(1.15,true);stateAt(1.6,'target-status','HAND UNCHANGED');break;
      case 'skipall':timeline.to(hero,{rotation:360,duration:1.5,ease:'power2.inOut'},.7);timeline.to([target,'.other-seat'],{opacity:.35,duration:.5},1.1);stateAt(1.1,'target-status','TURN SKIPPED');stateAt(2,'actor-status','YOUR TURN AGAIN');seatPulse(actor,2);break;
      case 'phoenix':timeline.fromTo(hero,{scale:.3,y:40},{scale:1.65,y:-5,duration:1.5,ease:'power3.out'},.7);timeline.to([target,'.other-seat'],{opacity:.15,scale:.94,duration:.85},1.9);stateAt(2,'actor-score','110,000');stateAt(2,'target-score','0');stateAt(2,'target-status','ELIMINATED');handAt(2.1,false);timeline.to('.hand-card',{y:25,opacity:0,stagger:.08,duration:.4},2.4);timeline.call(()=>{document.querySelectorAll('.hand-card').forEach(n=>n.firstChild.style.display='none');},null,3.05);timeline.to('.hand-card',{y:0,opacity:1,stagger:.1,duration:.35},3.1);stateAt(3.1,'target-status','ONE HAND CLEARED & REDRAWN');break;
      case 'trick':timeline.fromTo(hero,{rotationY:90},{rotationY:0,duration:1.1,ease:'power3.out'},.7);stateAt(1.6,'target-status','THE SMUGGLER · DISGUISE');seatPulse(target,1.6);break;
      case 'stealturn':timeline.to(hero,{rotation:-180,duration:1.3,ease:'power2.inOut'},.7);stateAt(1.5,'target-status','NEXT TURN: YOUR CHOICE');if(v===1){timeline.to(hero,{y:-65,scale:.5,duration:.5},1.3);handAt(1.35,true);timeline.to('.hand-card:nth-child(2)',{y:-15,borderColor:catalog[id].color,duration:.4},1.9);stateAt(1.9,'target-status','THEIR TURN · YOU CHOOSE');}break;
      case 'curse':timeline.to(hero,{rotation:45,scale:.85,duration:1.4},.7);if(v===2){stateAt(1.2,'target-status','EMPTY HAND · NO CURSE');break;}handAt(1.1,false);if(v===1){stateAt(1.1,'target-status','CARD RESOLVES NORMALLY FIRST');timeline.to('.hand-card:nth-child(2)',{y:-20,opacity:0,duration:.4},1.3);out(target,2,1);stateAt(2,'scene-caption','THEN: PLAYER OUT FOR 1 ROUND · CURSE SPENT');}else stateAt(1.7,'target-status','HAND CURSED · WHICH CARD IS SECRET');break;
      case 'ghost':timeline.to(actor,{opacity:.48,duration:1.1},.8);timeline.fromTo(hero,{y:25,opacity:.2},{y:0,opacity:.75,duration:1.2},.7);stateAt(1.5,'actor-status','UNTARGETABLE · THIS ROUND');break;
      case 'alvin':timeline.to(hero,{y:-70,scale:.55,duration:.5},1.1);if(v===2){stateAt(1.2,'target-status','EMPTY HAND · NOTHING DESTROYED');break;}handAt(1.2,true);if(v===1){timeline.to('.hand-card:nth-child(2)',{borderColor:catalog[id].color,y:-15,duration:.3},1.65).to('.hand-card:nth-child(2)',{scale:.6,opacity:0,y:-35,duration:.75},2);stateAt(2.4,'target-status','ONE CARD DESTROYED FOREVER');}else stateAt(1.7,'target-status','ACTOR MUST CHOOSE ONE CARD');break;
    }
  }
  function outcome(id,v){const special={hunter:['HUNTER HELD · REFLECTS ZOMBIE ONLY','ALREADY HELD · NOTHING CHANGES'],zombie:['TARGET OUT FOR 1 ROUND · TARGET POINTS → 0','HUNTER REFLECTS · ACTOR OUT · BOTH SCORES UNCHANGED'],judge:['ACTIVATED · MOST EVIL PLAYER OUT FOR 3 ROUNDS','FAILED TO ACTIVATE · NOTHING HAPPENS','ACTIVATED · NO EVIL CARDS · NOBODY BANISHED'],steal:['ALL TARGET POINTS → YOU · NO ELIMINATION','TARGET HAS 0 POINTS · NOTHING TO TRANSFER'],curse:['ONE RANDOM CARD CURSED · ITS IDENTITY STAYS SECRET','CURSED CARD RESOLVES FIRST · THEN ELIMINATION','EMPTY HAND · NOTHING TO CURSE'],alvin:['PRIVATE HAND REVEAL · WAIT FOR ACTOR’S CHOICE','ONE CHOSEN CARD DESTROYED · THE OTHERS REMAIN','EMPTY HAND · NOTHING TO DESTROY'],stealturn:['THEIR NEXT TURN · YOUR LEGAL CARD CHOICE','TARGET DRAWS & TAKES TURN · ACTOR CHOOSES LEGAL CARD']};return special[id]?special[id][v]:catalog[id].caption;}
  function staticOutcome(id,v){
    switch(id){
      case 'bonus':text('actor-score','30,000');break;
      case 'knife':text('target-status','OUT · 1 ROUND');break;
      case 'hunter':text('actor-status',v?'HUNTER ALREADY HELD':'HUNTER HELD');break;
      case 'zombie':if(v){text('actor-status','OUT · 1 ROUND');text('target-status','HUNTER · REFLECTED');}else{text('target-status','OUT · 1 ROUND');text('target-score','0');}break;
      case 'steal':text('actor-score',v?'20,000':'50,000');text('target-score','0');break;
      case 'judge':text('target-status',v===0?'OUT · 3 ROUNDS':v===1?'NO VERDICT':'NO EVIL CARDS');break;
      case 'reveal':text('target-status','HAND UNCHANGED');break;
      case 'skipall':text('actor-status','YOUR TURN AGAIN');text('target-status','TURN SKIPPED');break;
      case 'phoenix':text('actor-score','110,000');text('target-score','0');text('target-status','ELIMINATED · ONE HAND REDRAWN');break;
      case 'trick':text('target-status','THE SMUGGLER · DISGUISE');break;
      case 'stealturn':text('target-status',v?'THEIR TURN · YOU CHOOSE':'NEXT TURN: YOUR CHOICE');break;
      case 'curse':text('target-status',v===2?'EMPTY HAND · NO CURSE':v===1?'OUT · 1 ROUND · CURSE SPENT':'WHICH CARD IS SECRET');break;
      case 'ghost':text('actor-status','UNTARGETABLE · THIS ROUND');break;
      case 'alvin':text('target-status',v===2?'EMPTY HAND':v===1?'ONE CARD DESTROYED FOREVER':'ACTOR MUST CHOOSE ONE CARD');break;
    }
  }
  function build(effect){const def=catalog[current.id],v=$('variant').selectedIndex,low=reduced();lastTime=0;frameMs=0;diagnostics.plays++;
    text('actor-score','20,000');text('target-score',current.id==='steal'&&v===1?'0':'30,000');text('actor-status','READY');text('target-status','READY');text('scene-title',current.name);text('scene-caption',outcome(current.id,v));text('scene-kicker','THE CARD IS PLAYED');
    $('hand').replaceChildren();['Bonus','Hunter','Ghost'].forEach(name=>{const n=document.createElement('div');n.className='hand-card';const span=document.createElement('span');span.textContent=name;n.appendChild(span);$('hand').appendChild(n);});
    gsap.set(['.table-seat','.other-seat'],{opacity:1,scale:1,x:0,borderColor:'#ffffff18'});gsap.set($('played-card'),{opacity:1,scale:1,x:0,y:0,rotation:0,rotationY:0});gsap.set($('hero'),{opacity:0,scale:1,x:0,y:0,rotation:0,rotationY:0});gsap.set($('hand'),{autoAlpha:0});gsap.set('.announcement',{opacity:0,y:low?0:12});gsap.set('.stage-glow',{opacity:0});gsap.set($('progress'),{scaleX:0});
    timeline=gsap.timeline({paused:true,onComplete:()=>{if(ticking){gsap.ticker.remove(render);ticking=false;}if(context)context.stopAll();clearCanvas();diagnostics.finished++;text('renderer-status',low?'Reduced motion · complete':'Study complete · renderer idle');if(touring)tourTimer=setTimeout(()=>select(cards[(cards.indexOf(current)+1)%cards.length].id,true),900);}});
    if(low){timeline.call(()=>staticOutcome(current.id,v),null,0).set($('played-card'),{opacity:0},0).set($('hero'),{opacity:.7},0).set('.announcement',{opacity:1,y:0},0).to($('progress'),{scaleX:1,duration:2.2,ease:'none'},0);}
    else{timeline.fromTo($('played-card'),{y:80,rotation:-12,scale:.75,opacity:0},{y:0,rotation:0,scale:1,opacity:1,duration:.65,ease:'power3.out'},0).to($('played-card'),{y:-20,scale:.65,opacity:0,duration:.55,ease:'power2.in'},.7).to($('hero'),{opacity:.9,duration:.55},.75).to('.stage-glow',{opacity:1,duration:.8},.55).to('.announcement',{opacity:1,y:0,duration:.6},1).call(()=>spawn(effect),null,.55);choreograph(current.id,v);
      // Stop before destructive sublayers for non-destructive outcomes.
      if((current.id==='judge'&&v>0)||(current.id==='alvin'&&v!==1)||(current.id==='curse'&&v===2))timeline.call(()=>{if(context)context.stopAll();},null,1.25);
      timeline.to([$('hero'),$('hand')],{opacity:0,duration:.6},def.duration-.7).to('.stage-glow',{opacity:.15,duration:.6},def.duration-.65).to($('progress'),{scaleX:1,duration:def.duration,ease:'none'},0);
    }
    if(!low&&ready){gsap.ticker.add(render);ticking=true;}text('renderer-status',low?'Reduced motion · no particles':ready?'Playing · capped 30 fps · no sound':'Playing static fallback · no sound');timeline.play(0);if(document.hidden){timeline.pause();paused=true;$('pause').textContent='Resume';}
  }
  async function play(){const ticket=++serial;halt();clearCanvas();$('replay').disabled=true;text('renderer-status','Loading this card’s particles…');try{const effect=ready&&!reduced()?await load(current.id):null;if(ticket!==serial||released)return;build(effect);}catch(error){if(ticket===serial){report(error);build(null);}}finally{if(ticket===serial)$('replay').disabled=false;}}
  function select(id,fromTour){if(!fromTour){touring=false;$('tour').setAttribute('aria-pressed','false');$('tour').textContent='Play all '+cards.length;}current=PhoenixCards.byId(id);const def=meta(id);document.documentElement.style.setProperty('--accent',def.color);text('study-number','STUDY '+String(cards.indexOf(current)+1).padStart(2,'0')+' / '+cards.length);text('study-title',def.title);text('stage-card-name',current.name.toUpperCase());text('card-name',current.name);text('card-rule',current.rule);text('motif',def.motif);$('hero').innerHTML=$('card-emblem').innerHTML=icon(id);$('variant').replaceChildren();def.variants.forEach(name=>{const o=document.createElement('option');o.textContent=name;$('variant').appendChild(o);});const budget=manifest&&manifest.effects.find(e=>e.id===id);text('budget',def.duration+'s composition · '+(budget?budget.maxParticles+' particles maximum · ':'')+'one active effect · bounded resolution');document.querySelectorAll('#card-list button').forEach(b=>{b.classList.toggle('active',b.dataset.card===id);b.setAttribute('aria-pressed',String(b.dataset.card===id));});history.replaceState(null,'','#'+id);return play();}
  function pause(){if(!timeline)return;paused=!paused;paused?timeline.pause():timeline.resume();if(!paused)lastTime=timeline.time();$('pause').textContent=paused?'Resume':'Pause';}
  cards.forEach((card,i)=>{const b=document.createElement('button');b.type='button';b.dataset.card=card.id;b.style.setProperty('--card-color',meta(card.id).color);b.innerHTML='<span class="catalog-index">'+String(i+1).padStart(2,'0')+'</span><span class="catalog-icon" aria-hidden="true">'+icon(card.id)+'</span><span class="catalog-name"></span>';b.lastChild.textContent=card.name;
if(card.ownerOnly){const tag=document.createElement('span');tag.className='catalog-owner';tag.textContent='OWNER EXCLUSIVE';b.appendChild(tag);}b.addEventListener('click',()=>select(card.id,false));$('card-list').appendChild(b);});
  $('replay').onclick=play;$('pause').onclick=pause;$('variant').onchange=play;$('reduced').onchange=play;$('quality').onchange=play;$('tour').onclick=()=>{touring=!touring;$('tour').setAttribute('aria-pressed',String(touring));$('tour').textContent=touring?'Stop tour':'Play all '+cards.length;play();};
  let autoPaused=false;document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(tourTimer);if(timeline&&!paused&&timeline.progress()<1){pause();autoPaused=true;}}else if(autoPaused){autoPaused=false;if(paused)pause();}else if(touring&&timeline&&timeline.progress()===1)tourTimer=setTimeout(()=>select(cards[(cards.indexOf(current)+1)%cards.length].id,true),900);});
  media.addEventListener('change',()=>{$('reduced').checked=media.matches;play();});document.addEventListener('keydown',e=>{if(e.key==='Escape'){touring=false;halt();clearCanvas();text('renderer-status','Stopped · renderer idle');$('tour').textContent='Play all '+cards.length;$('tour').setAttribute('aria-pressed','false');}});
  async function release(){released=true;serial++;halt();await Promise.allSettled(Array.from(loads.values()));if(context){for(const effect of cache.values())context.releaseEffect(effect);cache.clear();effekseer.releaseContext(context);context=null;}canvas.width=canvas.height=1;}
  addEventListener('pagehide',release);
  window.PhoenixCardGallery={select:id=>select(id,false),replay:play,pause,release,inspect:()=>{let bright=0,hash=0;if(gl&&!gl.isContextLost()){const b=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,b);for(let i=0;i<b.length;i+=4){if(b[i]+b[i+1]+b[i+2]>50&&b[i+3]>10)bright++;hash=(Math.imul(hash,31)+b[i]+3*b[i+1]+7*b[i+2])>>>0;}}return {card:current.id,variant:$('variant').selectedIndex,ready,paused,time:timeline?timeline.time():0,frames,bright,hash,width:canvas.width,height:canvas.height,cache:cache.size,loading:loads.size,ticking,touring,reduced:reduced(),...diagnostics};}};
  async function main(){try{manifest=await (await fetch('assets/card-cinematics/manifest.json')).json();if(released)return;await new Promise((resolve,reject)=>effekseer.initRuntime('assets/victory/vendor/effekseer.wasm',resolve,()=>reject(Error('Effekseer runtime failed'))));if(released)return;gl=canvas.getContext('webgl2',{alpha:true,antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:true})||canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL is not available');context=effekseer.createContext();context.init(gl,{instanceMaxCount:1024});ready=true;canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;report(Error('Graphics context lost. Reload to restore particles.'));play();});}catch(error){report(error);}if(!released)select(PhoenixCards.byId(location.hash.slice(1))?location.hash.slice(1):'bonus',false);}
  main();
}());
