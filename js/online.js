(function(){'use strict';
const $=id=>document.getElementById(id);
let socket=null,state=null;
const names={phoenix:'The Legendary Inferno',tilly:'The Chaos Queen',maple:'The Fearless Shadow',louie:'The Midnight Trickster',simba:'The Ginger Phantom',elsie:'The Ancient Empress'};
const card=id=>window.PhoenixCards.byId(id);
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function feedback(t){$('online-feedback').textContent=t;}
function connect(callback){
 if(socket&&socket.readyState===1){callback();return;}
 const proto=location.protocol==='https:'?'wss:':'ws:';
 socket=new WebSocket(proto+'//'+location.host);
 socket.onopen=callback;
 socket.onerror=()=>feedback('Connection failed. Start the PHOENIX server first.');
 socket.onclose=()=>{feedback('Disconnected from server. Reload to reconnect.');$('online-actions').replaceChildren();};
 socket.onmessage=e=>{let msg;try{msg=JSON.parse(e.data);}catch{return;}if(msg.type==='error'){feedback(msg.message);return;}if(msg.type==='state'){state=msg;render();}};
}
function send(obj){if(socket&&socket.readyState===1)socket.send(JSON.stringify(obj));}
function enter(){
 $('phoenix-menu').hidden=true;$('ally-picker').hidden=true;$('online-screen').hidden=false;
 $('online-setup').hidden=false;$('online-room').hidden=true;
 $('online-name').value=sessionStorage.getItem('phoenix-player-name')||'';
 feedback('Create a private room or join using a friend’s invite code.');
}
function leave(){if(socket)socket.close();socket=null;state=null;$('online-screen').hidden=true;$('phoenix-menu').hidden=false;}
function join(type){const name=$('online-name').value.trim();if(!name){feedback('Enter your player name.');return;}sessionStorage.setItem('phoenix-player-name',name);const selected=window.PhoenixAllies.selected();const ownerPassword=type==='create' ? $('online-owner-password').value : undefined;if(type==='create'&&!ownerPassword){feedback('Enter your owner password to create a room.');return;}connect(()=>{send({type,name,ally:selected.id,code:$('online-code-input').value.trim(),...(type==='create'?{ownerPassword}:{})});if(type==='create')$('online-owner-password').value='';});}
function render(){const s=state;if(!s)return;
 $('online-setup').hidden=true;$('online-room').hidden=false;
 $('online-room-code').textContent=s.code;
 $('online-phase').textContent=s.started?(s.over?'Match finished':`Round ${s.round} / ${s.rounds} · ${s.current===s.players[s.seat].id?'YOUR TURN':(s.players.find(p=>p.id===s.current)||{}).name+' is playing'}`):`${s.players.length} / 5 players · Waiting in lobby`;
 const seats=$('online-seats');seats.replaceChildren();s.players.forEach((p,i)=>{
  const seat=el('div','online-seat'+(s.current===p.id?' online-current':''));
  const pic=el('img','online-portrait');pic.src='assets/allies/'+p.ally+'.jpg';pic.alt=p.ally;seat.append(pic);
  const meta=el('div','online-seat-meta');meta.append(el('strong','',p.name+(i===s.seat?' (you)':'')),el('small','',p.ally.toUpperCase()+' · '+names[p.ally]));
  meta.append(el('span','',s.started?p.points.toLocaleString()+' points · '+p.handCount+' cards':p.connected?'Connected':'Disconnected'));
  seat.append(meta);seats.append(seat);
 });
 const actions=$('online-actions');actions.replaceChildren();
 // PHOENIX multiplayer: allow 2 to 5 players.                 
 if(!s.started){if(s.host){const b=el('button','online-primary','START MATCH');b.disabled=s.players.length!==5;b.onclick=()=>send({type:'start',rounds:Number($('online-rounds').value)});actions.append(b);}else actions.append(el('p','','Waiting for host to start when all five players have joined.'));}
 else if(s.over){actions.append(el('h3','','Match complete!'));const winner=s.players.find(p=>p.id===s.winner);actions.append(el('p','',winner?'Winner: '+winner.name:'Game over'));}
 else if(!s.acting){actions.append(el('p','','Waiting for your turn. Other players’ hands are private.'));}
 else {
  actions.append(el('h3','',s.pending?'Choose a card for the forced decision':'Your turn — choose a card'));
  if(!s.moves.length)actions.append(el('p','','No legal moves available.'));
  s.moves.forEach(move=>{const c=card(move.cardId);if(!c)return;const target=s.players.find(p=>p.id===move.targetId);const b=el('button','online-move',c.glyph+' '+c.name+(target?' → '+target.name:''));b.onclick=()=>send({type:'move',cardId:move.cardId,targetId:move.targetId||null});actions.append(b);});
 }
 const hand=$('online-hand');hand.replaceChildren();if(s.started){hand.append(el('h3','','Your private hand'));s.hand.forEach(id=>{const c=card(id);hand.append(el('span','online-card',c?c.glyph+' '+c.name:id));});}
 const log=$('online-log');log.replaceChildren();s.log.slice(-18).forEach(t=>log.append(el('li','',t)));
}
document.addEventListener('DOMContentLoaded',()=>{
 $('online-back').onclick=leave;$('online-create').onclick=()=>join('create');$('online-join').onclick=()=>join('join');$('online-copy').onclick=()=>{if(state)navigator.clipboard.writeText(state.code).then(()=>feedback('Invite code copied!')).catch(()=>feedback('Invite code: '+state.code));};
 document.addEventListener('phoenix-ally-confirmed',e=>{if(e.detail.mode==='multi')enter();});
});
})();
