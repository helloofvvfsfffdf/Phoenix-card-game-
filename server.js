
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
function snapshot(room,member){
 const s=room.state,players=room.members.map((m,i)=>({id:Rules.SEATS[i].id,name:m.name,ally:m.ally,connected:!!m.ws,points:s?s.players[i].points:0,handCount:s?s.hands[Rules.SEATS[i].id].length:0,hunter:s?!!s.players[i].hunter:false,eliminated:s?Rules.isOut(s.players[i],s):false}));
 const current=s?s.players[s.turnInRound]:null;
 const pending=s?Rules.pendingChoiceOptions(s):null;
 const mine=Rules.SEATS[member.seat].id;
 const acting=s&&!s.over&&((pending&&pending.chooserId===mine)||(!pending&&current.id===mine));
 const moves=acting?(pending?pending.options:Rules.legalMoves(s,s.turnInRound).map(m=>({cardId:m.cardId,targetId:m.targetId}))):[];
 return {type:'state',code:room.code,host:member.seat===0,seat:member.seat,started:!!s,players,round:s?s.round:0,rounds:s?s.rounds:0,over:s?!!s.over:false,winner:s&&s.over&&s.winnerSeat>=0?s.players[s.winnerSeat].id:null,current:current?current.id:null,hand:s?(s.hands[mine]||[]):[],deckCount:s?s.deck.length:0,discardCount:s?s.discard.length:0,acting:!!acting,pending:pending?{kind:pending.kind,chooserId:pending.chooserId,targetId:pending.targetId}:null,moves,log:room.log.slice(-35)};
}
function broadcast(room){room.members.forEach(m=>send(m.ws,snapshot(room,m)));}
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
  const room={code:code(),members:[],state:null,log:['Room created. Invite at least one friend to start.']};rooms.set(room.code,room);
  const m={seat:0,name:cleanName(data.name),ally:ally(data.ally),ws,room};room.members.push(m);ws.member=m;broadcast(room);return;
 }
 if(data.type==='join'){
  if(ws.member)return error(ws,'Already in a room.');
  const room=rooms.get(String(data.code||'').trim().toUpperCase());if(!room)return error(ws,'Room not found. Check the invite code.');
  if(room.state)return error(ws,'This match has already started.');
  if(room.members.length>=5)return error(ws,'Room is full.');
  const m={seat:room.members.length,name:cleanName(data.name),ally:ally(data.ally),ws,room};room.members.push(m);ws.member=m;room.log.push(m.name+' joined.');broadcast(room);return;
 }
 const m=ws.member;if(!m)return error(ws,'Create or join a room first.');const room=m.room;
 if(data.type==='start'){
  if(m.seat!==0)return error(ws,'Only the host can start.');
  if(room.state)return error(ws,'Match already started.');
  if(room.members.length<2||room.members.length>5||room.members.some(p=>!p.ws))return error(ws,'Between 2 and 5 connected players are required.');
  room.state=Rules.createGame({rounds:Math.min(20,Math.max(5,Number(data.rounds)||10)),fixedOrder:true,seed:crypto.randomBytes(4).readUInt32BE(0),playerCount:room.members.length});
  room.state.players.forEach((p,i)=>{if(room.members[i])p.name=room.members[i].name;});
  room.log.push('Match started with '+room.members.length+' players!');broadcast(room);return;
 }
 if(data.type==='move'){
  const s=room.state;if(!s||s.over)return error(ws,'No active match.');
  if(room.members.some(p=>!p.ws))return error(ws,'A player disconnected. The match is paused.');
  const id=Rules.SEATS[m.seat].id,pending=Rules.pendingChoiceOptions(s);
  if(pending ? pending.chooserId!==id : s.players[s.turnInRound].id!==id)return error(ws,'It is not your turn.');
  const cardId=String(data.cardId||'').slice(0,40),targetId=data.targetId===null?null:String(data.targetId||'').slice(0,40);
  const options=pending?pending.options:Rules.legalMoves(s,s.turnInRound);
  if(!options.some(o=>o.cardId===cardId&&(o.targetId||null)===(targetId||null)))return error(ws,'That move is not legal.');
  const result=pending?Rules.resolvePendingChoice(s,cardId,targetId):Rules.playCard(s,s.turnInRound,cardId,targetId);
  if(!result.ok)return error(ws,result.error||'Move rejected.');
  (result.events||[]).forEach(e=>room.log.push(e.text));if(room.log.length>150)room.log=room.log.slice(-150);
  broadcast(room);return;
 }
}
function ally(id){return ['phoenix','tilly','maple','louie','simba','elsie'].includes(id)?id:'phoenix';}
wss.on('connection',ws=>{
 ws.on('message',raw=>{try{handle(ws,JSON.parse(raw.toString()));}catch(e){error(ws,'Invalid request.');}});
 ws.on('close',()=>{const m=ws.member;if(!m)return;const room=m.room;m.ws=null;if(!room.state){room.members.splice(m.seat,1);room.members.forEach((p,i)=>p.seat=i);if(!room.members.length)rooms.delete(room.code);}else{room.log.push(m.name+' disconnected. Match paused.');}broadcast(room);});
});
httpServer.listen(PORT,'0.0.0.0',()=>console.log(`PHOENIX multiplayer server: http://localhost:${PORT}`));

