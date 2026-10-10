
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const Rules = require('./js/rules.js');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const OWNER_PASSWORD = process.env.PHOENIX_OWNER_PASSWORD || '';
const MODE_ACCESS_CODE = process.env.PHOENIX_MODE_ACCESS_CODE || '';
if (MODE_ACCESS_CODE.length < 12 || MODE_ACCESS_CODE.length > 256) {
  console.error('Set PHOENIX_MODE_ACCESS_CODE to a private access code of 12-256 characters.');
  process.exit(1);
}
if (!OWNER_PASSWORD || OWNER_PASSWORD.length < 24) {
  console.error('Set PHOENIX_OWNER_PASSWORD to a private password of at least 24 characters before starting the server.');
  process.exit(1);
}
const authFailures = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_MS = 30 * 60 * 1000;
const AUTH_MAX_FAILURES = 3;
const MAX_ROOMS = 30;
function clientIp(ws) { return ws._socket?.remoteAddress || 'unknown'; }
function authRecord(ip, now) {
  let record = authFailures.get(ip);
  if (!record) record = {failures:[], lockedUntil:0};
  record.failures = record.failures.filter(t => now - t < AUTH_WINDOW_MS);
  if (record.lockedUntil && record.lockedUntil <= now) {
    record.lockedUntil = 0;
    record.failures = [];
  }
  authFailures.set(ip, record);
  return record;
}
const authCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of authFailures) {
    if (record.lockedUntil <= now && record.failures.every(t => now-t >= AUTH_WINDOW_MS)) authFailures.delete(ip);
  }
}, 60 * 60 * 1000);
authCleanup.unref();
function validOwnerPassword(input) {
  if (typeof input !== 'string' || input.length > 256) return false;
  const supplied = crypto.createHash('sha256').update(input).digest();
  const expected = crypto.createHash('sha256').update(OWNER_PASSWORD).digest();
  return crypto.timingSafeEqual(supplied, expected);
}
const rooms = new Map();
const ALLIES = ['phoenix','tilly','louie','simba','elsie','ted'];
const rollDie = () => crypto.randomInt(1, 7);
const chance = percent => crypto.randomInt(100) < percent;
function addLog(room, text) { room.log.push(text); if (room.log.length > 150) room.log.splice(0, room.log.length - 150); }
function beginRollStage(room, phase) {
  room.phase = phase;
  room.dice = {queue: [room.members.map((_,i)=>i)], order: [], group: [], rolls: {}, next: 0};
  nextDiceGroup(room);
}
function nextDiceGroup(room) {
  const d = room.dice;
  while (d.queue.length && d.queue[0].length === 1) d.order.push(d.queue.shift()[0]);
  if (!d.queue.length) {
    if (room.phase === 'turnDice') {
      room.turnOrder = d.order.slice();
      addLog(room, 'Turn order: ' + d.order.map(i => room.members[i].name).join(' → '));
      beginRollStage(room, 'allyDice');
    } else {
      room.allyOrder = d.order.slice();
      room.draftIndex = 0;
      room.phase = 'draft';
      addLog(room, 'Ally draft order: ' + d.order.map(i => room.members[i].name).join(' → '));
    }
    return;
  }
  d.group = d.queue.shift(); d.next = 0; d.rolls = {};
  addLog(room, 'Dice: ' + d.group.map(i=>room.members[i].name).join(', ') + ' roll now.');
}
function diceRoll(room, member) {
  const d = room.dice, idx = room.members.indexOf(member);
  if (d.group[d.next] !== idx) return false;
  const value = rollDie(); d.rolls[idx] = value;
  addLog(room, member.name + ' rolled ' + value + '.');
  d.next++;
  if (d.next === d.group.length) {
    const buckets = new Map();
    for (const i of d.group) {const n=d.rolls[i]; if(!buckets.has(n)) buckets.set(n,[]); buckets.get(n).push(i);}
    const ordered = [...buckets.entries()].sort((a,b)=>b[0]-a[0]).map(e=>e[1]);
    d.queue.unshift(...ordered);
    for (const group of ordered) if (group.length > 1) addLog(room, 'Tie! ' + group.map(i=>room.members[i].name).join(' and ') + ' must reroll.');
    nextDiceGroup(room);
  }
  return true;
}
function applyPhoenix(room) {
  const s = room.state;
  const owner = room.members.find(m=>m.ally==='phoenix');
  if (!owner || !s || s.over) return;
  const actor = s.players[owner.seat];
  if (!actor.enabled || Rules.isOut(actor,s)) return;
  const victims = room.members.filter(m=>m!==owner && s.hands[Rules.SEATS[m.seat].id].length && !Rules.isOut(s.players[m.seat],s));
  if (!victims.length) { addLog(room, 'Phoenix found no opponent with cards to steal.'); return; }
  const target = victims[crypto.randomInt(victims.length)];
  const defence = {tilly:40,louie:80,simba:60,elsie:100,ted:60}[target.ally] || 0;
  if (chance(defence)) {addLog(room, target.ally==='ted' ? '🐶 Ted howled and scared Phoenix away from ' + target.name + '!' : target.name + "'s " + target.ally.toUpperCase() + ' blocked Phoenix’s theft!');return;}
  const from = s.hands[Rules.SEATS[target.seat].id];
  const [card] = from.splice(crypto.randomInt(from.length),1);
  s.hands[Rules.SEATS[owner.seat].id].push(card);
  addLog(room, 'Phoenix stole a random card from ' + target.name + '!');
}
function applyTed(room) {
  const s = room.state, owner = room.members.find(m => m.ally === 'ted');
  if (!owner || !s || s.over) return;

  // Only one opponent can be affected at a time. Do not reroll or
  // extend the effect while any opponent is still hidden.
  room.tedHiddenUntil = room.tedHiddenUntil || {};
  const activeVictim = Object.entries(room.tedHiddenUntil)
    .some(([, untilRound]) => untilRound >= s.round);
  if (activeVictim || !chance(50)) return;

  const targets = room.members.filter(m => m !== owner && !Rules.isOut(s.players[m.seat], s));
  if (!targets.length) return;
  const victim = targets[crypto.randomInt(targets.length)];
  // Active in this round and the following two rounds.
  room.tedHiddenUntil = { [victim.seat]: s.round + 2 };
  addLog(room, '🐶 Ted used Slobbery Surprise on ' + victim.name + '! Their cards are hidden for 3 rounds.');
}

function startGame(room) {
  const oldMembers = room.members.slice();
  room.members = room.turnOrder.map(i=>oldMembers[i]);
  room.members.forEach((m,i)=>{m.seat=i;});
  const s = Rules.createGame({rounds:room.requestedRounds,fixedOrder:true,rotateStart:false,roundStartSeat:0,seed:crypto.randomBytes(4).readUInt32BE(0)});
  s.players.forEach((p,i)=>{p.enabled=i<room.members.length;if(room.members[i])p.name=room.members[i].name;});
  room.state=s;room.phase='playing';room.lastPhoenixRound=1;room.tedHiddenUntil={};
  addLog(room, 'Match started! Turn order: '+room.members.map(m=>m.name).join(' → '));
  applyPhoenix(room);
  applyTed(room);
}

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');
console.log(`[PHOENIX diagnostic] Server started: instance=${INSTANCE_ID}, pid=${process.pid}`);
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.json':'application/json'};
const httpServer = http.createServer((req,res)=>{
  let pathname;
  try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);} catch {res.writeHead(400).end();return;}
  const file=path.resolve(ROOT,'.'+(pathname==='/'?'/index.html':pathname));
  if (!file.startsWith(ROOT+path.sep) || file===__filename || file.includes(path.sep+'node_modules'+path.sep) || !Object.hasOwn(mime,path.extname(file))) {res.writeHead(404).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)],'X-Content-Type-Options':'nosniff'});res.end(data);});
});
const wss=new WebSocketServer({server:httpServer,maxPayload:8192});
const send=(ws,obj)=>{if(ws && ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));};
const cleanName=(name)=>String(name||'Player').replace(/[<>\r\n]/g,'').trim().slice(0,22)||'Player';
function code(){let c;do{c=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(c));return c;}
// Steal a Turn is chosen only when its target actually takes their next turn.
// Alvin's destruction choice, however, happens immediately.
function dueChoice(s) {
 const pending=Rules.pendingChoiceOptions(s);
 if(!pending)return null;
 if(pending.kind==='move' && s.players[s.turnInRound].id!==pending.targetId)return null;
 return pending;
}
function snapshot(room,member){
 const s=room.state,players=room.members.map((m,i)=>({id:Rules.SEATS[i].id,name:m.name,ally:m.ally,connected:!!m.ws,points:s?s.players[i].points:0,handCount:s?s.hands[Rules.SEATS[i].id].length:0,hunter:s?!!s.players[i].hunter:false,eliminated:s?Rules.isOut(s.players[i],s):false}));
 const current=s?s.players[s.turnInRound]:null;
 const pending=s?dueChoice(s):null;
 const mine=Rules.SEATS[member.seat].id;
 const acting=s&&!s.over&&((pending&&pending.chooserId===mine)||(!pending&&current.id===mine));
 const moves=acting?(pending?pending.options:Rules.legalMoves(s,s.turnInRound).map(m=>({cardId:m.cardId,targetId:m.targetId}))):[];
 return {type:'state',phase:room.phase||'lobby',dice:room.dice?{next:room.dice.group[room.dice.next],rolls:room.dice.rolls,order:room.dice.order}:null,draftTurn:room.phase==='draft'?room.allyOrder[room.draftIndex]:null,availableAllies:ALLIES.filter(a=>(a!=='ted'||room.members.length>=3)&&!room.members.some(m=>m.ally===a)),code:room.code,host:member.seat===0,seat:member.seat,started:!!s,players,round:s?s.round:0,rounds:s?s.rounds:0,over:s?!!s.over:false,winner:s&&s.over&&s.winnerSeat>=0?s.players[s.winnerSeat].id:null,current:current?current.id:null,hand:s?(s.hands[mine]||[]):[],deckCount:s?s.deck.length:0,discardCount:s?s.discard.length:0,lastDiscard:s&&s.discard.length?s.discard[s.discard.length-1]:null,acting:!!acting,pending:pending?{kind:pending.kind,chooserId:pending.chooserId,targetId:pending.targetId}:null,moves,tedObscured:!!(s&&room.tedHiddenUntil&&room.tedHiddenUntil[member.seat]>=s.round),log:room.log.slice(-35)};
}
// A turn can become unplayable at match start or after an ally effect.
// The rules engine already skips unplayable seats during advanceTurn; invoke
// that same path when a turn is stranded before a player can make a move.
function skipUnplayableTurns(room) {
  const s = room.state;
  if (!s || s.over || room.phase !== 'playing') return;
  let guard = 0;
  while (!s.over && guard++ < 150) {
    const pending = dueChoice(s);
    if (pending && pending.kind === 'burn') break;
    const current = s.players[s.turnInRound];
    if (Rules.legalMoves(s, s.turnInRound).length) break;
    // If a stolen turn has no legal moves, its choice cannot be made.
    // Drop the pending choice before skipping the target's turn.
    if (pending && pending.kind === 'move') {
      s.pendingChoice = null;
      addLog(room, 'Steal a Turn expired because ' + current.name + ' has no legal moves.');
    }
    current.turnsSkipped++;
    addLog(room, current.name + ' has no legal moves and automatically skips their turn.');
    const events = Rules.advanceTurn(s);
    for (const event of events) if (event.text) addLog(room, event.text);
    if (s.round !== room.lastPhoenixRound && !s.over) {
      room.lastPhoenixRound = s.round;
      applyPhoenix(room);
      applyTed(room);
    }
  }
}
function broadcast(room){skipUnplayableTurns(room);room.members.forEach(m=>send(m.ws,snapshot(room,m)));}
function error(ws,msg){send(ws,{type:'error',message:msg});}
function handle(ws,data){
 if(!data||typeof data!=='object')return;
 if(data.type==='create'){
  if(ws.member)return error(ws,'Already in a room.');
  const now=Date.now(), ip=clientIp(ws), auth=authRecord(ip,now);
  if(auth.lockedUntil>now)return error(ws,'Too many incorrect attempts. Try again later.');
  if(!validOwnerPassword(data.ownerPassword)){
   auth.failures.push(now);
   if(auth.failures.length>=AUTH_MAX_FAILURES) auth.lockedUntil=now+AUTH_LOCK_MS;
   return error(ws,'Incorrect owner password or too many attempts.');
  }
  auth.failures=[];
  if(rooms.size>=MAX_ROOMS)return error(ws,'The server has reached its room limit. Try later.');
  const room={code:code(),members:[],state:null,phase:'lobby',log:['Room created. Invite at least one friend to start.']};rooms.set(room.code,room);
  const m={seat:0,name:cleanName(data.name),ally:null,ws,room};room.members.push(m);ws.member=m;broadcast(room);return;
 }
 if(data.type==='join'){
  if(ws.member)return error(ws,'Already in a room.');
  const requestedCode=String(data.code||'').trim().toUpperCase();
   const room=rooms.get(requestedCode);
   console.log(`[PHOENIX diagnostic] JOIN instance=${INSTANCE_ID} room=${requestedCode} found=${!!room} totalRooms=${rooms.size} knownRooms=${[...rooms.keys()].join(',')}`);
   if(!room)return error(ws,'Room not found. Check the invite code.');
  if(room.phase!=='lobby')return error(ws,'This match has already started.');
  if(room.members.length>=5)return error(ws,'Room is full.');
  const m={seat:room.members.length,name:cleanName(data.name),ally:null,ws,room};room.members.push(m);ws.member=m;room.log.push(m.name+' joined.');broadcast(room);return;
 }
 const m=ws.member;if(!m)return error(ws,'Create or join a room first.');const room=m.room;
 if(data.type==='start'){
  if(m.seat!==0)return error(ws,'Only the host can start.');
  if(room.phase!=='lobby')return error(ws,'Match already started.');
  if(room.members.length<2||room.members.length>5||room.members.some(p=>!p.ws))return error(ws,'Between 2 and 5 connected players are required.');
  room.requestedRounds=Math.min(20,Math.max(5,Number(data.rounds)||10));
  beginRollStage(room,'turnDice');broadcast(room);return;
 }
 if(data.type==='roll'){
  if(!['turnDice','allyDice'].includes(room.phase))return error(ws,'Not rolling dice now.');
  if(!diceRoll(room,m))return error(ws,'Wait for your turn to roll.');
  broadcast(room);return;
 }
 if(data.type==='chooseAlly'){
  if(room.phase!=='draft')return error(ws,'Not choosing allies now.');
  if(room.members[room.allyOrder[room.draftIndex]]!==m)return error(ws,'Not your turn to choose an ally.');
  if(data.ally==='ted'&&room.members.length<3)return error(ws,'Ted requires at least 3 players. 4 or more players are recommended.');
  if(!ALLIES.includes(data.ally)||room.members.some(p=>p.ally===data.ally))return error(ws,'That ally is not available.');
  m.ally=data.ally;addLog(room,m.name+' chose '+data.ally.toUpperCase()+'.');
  room.draftIndex++;
  if(room.draftIndex===room.members.length)startGame(room);
  broadcast(room);return;
 }
 if(data.type==='move'){
  const s=room.state;if(!s||s.over)return error(ws,'No active match.');
  if(room.members.some(p=>!p.ws))return error(ws,'A player disconnected. The match is paused.');
  const id=Rules.SEATS[m.seat].id,pending=dueChoice(s);
  if(pending ? pending.chooserId!==id : s.players[s.turnInRound].id!==id)return error(ws,'It is not your turn.');
  const cardId=String(data.cardId||'').slice(0,40),targetId=data.targetId===null?null:String(data.targetId||'').slice(0,40);
  const options=pending?pending.options:Rules.legalMoves(s,s.turnInRound);
  if(!options.some(o=>o.cardId===cardId&&(o.targetId||null)===(targetId||null)))return error(ws,'That move is not legal.');
  const result=pending?Rules.resolvePendingChoice(s,cardId,targetId):Rules.playCard(s,s.turnInRound,cardId,targetId);
  if(!result.ok)return error(ws,result.error||'Move rejected.');
  (result.events||[]).forEach(e=>addLog(room,e.text));if(s.round!==room.lastPhoenixRound && !s.over){room.lastPhoenixRound=s.round;applyPhoenix(room);applyTed(room);}
  broadcast(room);return;
 }
}
function ally(id){return ['phoenix','tilly','maple','louie','simba','elsie','ted'].includes(id)?id:'phoenix';}
wss.on('connection',ws=>{
 ws.on('message',raw=>{try{handle(ws,JSON.parse(raw.toString()));}catch(e){error(ws,'Invalid request.');}});
 ws.on('close',()=>{const m=ws.member;if(!m)return;const room=m.room;m.ws=null;if(room.phase==='lobby'){room.members.splice(m.seat,1);room.members.forEach((p,i)=>p.seat=i);if(!room.members.length){rooms.delete(room.code);console.log(`[PHOENIX diagnostic] DELETE instance=${INSTANCE_ID} room=${room.code} reason=host-disconnected`);}}else{room.log.push(m.name+' disconnected. Match paused.');}broadcast(room);});
});
httpServer.listen(PORT,'0.0.0.0',()=>console.log(`PHOENIX multiplayer server: http://localhost:${PORT} instance=${INSTANCE_ID}`));
