/* Showcase-style live UI. Cosmetic only: never chooses a roll, card or move. */
(function(root,factory){var api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PhoenixMatchShowcase=api;}(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  var PIPS={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  var ROTATIONS={1:{x:0,y:0},2:{x:0,y:-90},3:{x:-90,y:0},4:{x:90,y:0},5:{x:0,y:90},6:{x:0,y:180}};
  function diceCursor(){var stream=null,id=0;return {reset:function(){stream=null;id=0;},consume:function(s){
    if(!s)return null;var key=s.effects&&s.effects.stream||s.code,roll=s.dice&&s.dice.lastRoll;
    if(!key)return null;if(key!==stream){stream=key;id=roll&&Number.isInteger(roll.id)?roll.id:0;return null;}
    if(!roll||!Number.isInteger(roll.id)||roll.id<=id)return null;id=roll.id;
    if(!Number.isInteger(roll.seat)||roll.seat<0||roll.seat>4||!Number.isInteger(roll.value)||roll.value<1||roll.value>6||['turnDice','allyDice'].indexOf(roll.phase)<0)return null;
    return {id:roll.id,seat:roll.seat,value:roll.value,phase:roll.phase};
  }};}
  var api={diceCursor:diceCursor,pips:PIPS,rotations:ROTATIONS};if(!root.document)return api;
  var cursor=diceCursor(),die=null,transitions=[],localScores={},localGame=null;
  var stats={rolls:[],phaseEntrances:0,handDeals:0,scoreChanges:0};
  var media=root.matchMedia?root.matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
  function motion(){var prefs=root.PhoenixCinematics?root.PhoenixCinematics.prefs():{visuals:'full'};return root.PhoenixEffects?root.PhoenixEffects.motion(prefs,media.matches):media.matches?'reduced':prefs.visuals;}
  function killTransitions(){transitions.forEach(function(r){if(r.tween)r.tween.kill();if(r.finish)r.finish();});transitions=[];}
  function stopDie(){if(!die)return;if(die.timeline)die.timeline.kill();clearTimeout(die.timer);die.node.remove();die=null;}
  function reset(){cursor.reset();stopDie();killTransitions();localScores={};localGame=null;}
  function animate(target,from,to){if(!root.gsap||motion()!=='full'||document.hidden)return;transitions.push({tween:root.gsap.fromTo(target,from,to),finish:function(){root.gsap.set(target,{clearProps:'opacity,transform,boxShadow,color'});}});}
  function score(node,before,after){if(!node||!Number.isFinite(before)||!Number.isFinite(after)||before===after)return;stats.scoreChanges++;node.setAttribute('aria-label',after.toLocaleString()+' points');
    if(motion()!=='full'||!root.gsap||document.hidden)return;
    var value={points:before},finish=function(){node.textContent=after.toLocaleString();};
    transitions.push({finish:finish,tween:root.gsap.to(value,{points:after,duration:.65,ease:'power2.out',onUpdate:function(){node.textContent=Math.round(value.points).toLocaleString();},onComplete:finish})});
    animate(node,{color:'#f1d7ff',scale:1.08},{color:'#eadcc9',scale:1,duration:.7,ease:'power2.out'});
  }
  function decorate(scope){var host=document.getElementById(scope);if(!host||!root.PhoenixCardCinematicArt)return;
    host.querySelectorAll('.card[data-card]').forEach(function(node){var id=node.dataset.card,def=root.PhoenixCardCinematicCatalog&&root.PhoenixCardCinematicCatalog[id],art=node.querySelector('.card-art');if(!def||!art)return;
      art.innerHTML=root.PhoenixCardCinematicArt.icon(id);art.setAttribute('aria-hidden','true');node.style.setProperty('--accent',def.color);
    });host.dataset.motion=motion();
  }
  function roll(event,name){stopDie();var mode=motion();if(mode==='off'||document.hidden)return;
    var node=document.createElement('section');node.className='showcase-dice'+(mode==='reduced'?' showcase-dice-reduced':'');node.dataset.roll=String(event.id);node.dataset.value=String(event.value);node.setAttribute('role','status');node.setAttribute('aria-live','polite');
    function make(tag,cls,text,parent){var n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;(parent||node).appendChild(n);return n;}
    make('p','showcase-dice-eyebrow',event.phase==='turnDice'?'TURN ORDER · CONFIRMED ROLL':'ALLY DRAFT ORDER · CONFIRMED ROLL');
    var stage=make('div','showcase-dice-stage'),cube=make('div','showcase-die',undefined,stage);cube.setAttribute('aria-hidden','true');
    for(var value=1;value<=6;value++){var face=make('div','showcase-die-face'+(value===event.value?' is-result':''),undefined,cube);face.dataset.face=String(value);PIPS[value].forEach(function(pos){var pip=make('i','showcase-die-pip',undefined,face);pip.style.gridColumn=String(pos%3+1);pip.style.gridRow=String(Math.floor(pos/3)+1);});}
    var label=make('p','showcase-dice-result',mode==='reduced'?name+' rolled '+event.value:name+' · dice rolling');
    make('p','showcase-dice-note','Highest roll goes first. Ties are rerolled.');document.body.appendChild(node);
    stats.rolls.push({id:event.id,seat:event.seat,value:event.value,phase:event.phase});if(stats.rolls.length>64)stats.rolls.shift();
    die={node:node,timeline:null,timer:null};var current=die;
    if(mode==='reduced'||!root.gsap){node.classList.add('showcase-dice-reduced');label.textContent=name+' rolled '+event.value;node.dataset.landed='true';die.timer=setTimeout(stopDie,1200);return;}
    var rotation=ROTATIONS[event.value];root.gsap.set(cube,{rotationX:-160,rotationY:-200,rotationZ:-25,y:-12,scale:.65});
    die.timeline=root.gsap.timeline({onComplete:function(){if(die===current)stopDie();}});
    die.timeline.fromTo(node,{opacity:0,y:-12},{opacity:1,y:0,duration:.2},0).to(cube,{rotationX:720+rotation.x,rotationY:720+rotation.y,rotationZ:360,y:0,scale:1,duration:1.05,ease:'power3.out'},0)
      .call(function(){label.textContent=name+' rolled '+event.value;node.dataset.landed='true';},null,1.05)
      .to(cube,{scale:1.06,duration:.12,repeat:1,yoyo:true},1.05).to(node,{opacity:0,duration:.25},1.8);
  }
  function observe(previous,next){killTransitions();decorate('online-screen');var rollEvent=cursor.consume(next);
    // Older running servers have no lastRoll record. Animate only values still
    // present in their snapshot, never guess a cleared tie/final roll.
    if(!rollEvent&&previous&&next.dice&&!next.dice.lastRoll&&previous.phase===next.phase&&['turnDice','allyDice'].indexOf(next.phase)>=0){
      Object.keys(next.dice.rolls||{}).some(function(index){var value=next.dice.rolls[index];if(value&&(!previous.dice||previous.dice.rolls[index]!==value)){rollEvent={id:0,phase:next.phase,seat:Number(index),value:value};return true;}return false;});
    }
    if(rollEvent){var player=(previous&&previous.players||next.players||[])[rollEvent.seat];roll(rollEvent,player?player.name:'Player '+(rollEvent.seat+1));}
    var host=document.getElementById('online-screen');if(host)host.dataset.phase=next.phase;
    if(next.over){stopDie();return;} // Winner presentation owns the final frame.
    if(!previous||previous.phase!==next.phase){stats.phaseEntrances++;animate('#online-actions > h3, #online-actions > p, #online-seats .online-seat, .online-draft-choice',{opacity:.4,y:12},{opacity:1,y:0,duration:.45,stagger:.035,ease:'power2.out'});}
    (next.players||[]).forEach(function(p){var old=previous&&(previous.players||[]).find(function(q){return q.id===p.id;});var node=host&&Array.from(host.querySelectorAll('.online-score')).find(function(n){return n.dataset.player===p.id;});if(old)score(node,old.points,p.points);});
    if(next.started&&(!previous||!previous.started||JSON.stringify(previous.hand)!==JSON.stringify(next.hand)||previous.tedObscured!==next.tedObscured)){
      stats.handDeals++;animate('#online-hand .card',{opacity:.45,y:18,rotation:-3},{opacity:1,y:0,rotation:0,duration:.45,stagger:.045,ease:'power3.out'});
    }
    if(previous&&previous.lastDiscard!==next.lastDiscard)animate('.phoenix-pile:last-child .card',{opacity:.5,rotationY:45,scale:.92},{opacity:1,rotationY:0,scale:1,duration:.4,ease:'power2.out'});
    var oldActor=previous&&(previous.pending?previous.pending.chooserId:previous.current),newActor=next.pending?next.pending.chooserId:next.current;
    if(oldActor!==newActor)animate('#online-seats .online-current',{boxShadow:'0 0 36px #c5a0ff77'},{boxShadow:'0 0 24px #ad77ec26',duration:.8});
  }
  function local(game){if(!game||!game.state)return;killTransitions();decorate('phoenix-game');if(localGame!==game.state){localGame=game.state;localScores={};animate('#phoenix-game .seat',{opacity:.4,y:12},{opacity:1,y:0,duration:.45,stagger:.04});}
    var host=document.getElementById('phoenix-game');game.state.players.forEach(function(p){var seat=host&&host.querySelector('[data-effect-seat="'+p.seat+'"]'),node=seat&&seat.querySelector('.seat-points');if(localScores[p.id]!==undefined)score(node,localScores[p.id],p.points);localScores[p.id]=p.points;});
  }
  function preferenceChanged(){stopDie();killTransitions();['online-screen','phoenix-game'].forEach(function(id){var node=document.getElementById(id);if(node)node.dataset.motion=motion();});}
  api.observe=observe;api.local=local;api.decorate=decorate;api.reset=reset;api.preferenceChanged=preferenceChanged;api.diagnostics=function(){return {activeRoll:die?Number(die.node.dataset.value):null,landed:die?die.node.dataset.landed==='true':false,time:die&&die.timeline?die.timeline.time():0,rolls:stats.rolls.slice(),phaseEntrances:stats.phaseEntrances,handDeals:stats.handDeals,scoreChanges:stats.scoreChanges,motion:motion()};};
  document.addEventListener('visibilitychange',function(){if(document.hidden){stopDie();killTransitions();}});root.addEventListener('pagehide',reset);if(media.addEventListener)media.addEventListener('change',preferenceChanged);
  return api;
}));
