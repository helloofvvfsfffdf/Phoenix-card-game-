/* Native Edge + isolated real server. Earn Phoenix by completing matches;
 * never inject scores/hands, fake result packets or force a winning player. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto'),net=require('net'),{spawn}=require('child_process'),WebSocket=require('ws');
const temp=path.join(process.env.LOCALAPPDATA,'Temp','opencode'),profile=fs.mkdtempSync(path.join(temp,'phoenix-card-game-'));
let edge,server,socket,session,serial=0;const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={},target=session){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},600000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function shot(name){const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(temp,name),Buffer.from(r.data,'base64'));}
async function main(){try{
  const port=12345;const password='unused-owner-password-0123456789abcdef';
  const stateFile='C:/temp/phoenix-card-game-state.json';fs.writeFileSync(stateFile,JSON.stringify({multiplayerOpen:true,creationLocked:false}));const accessCode='unused-access-code-1234567890';server=spawn(process.execPath,['tests/helpers/plain-server.js'],{cwd:path.join(__dirname,'..'),env:{PORT:String(port),PHOENIX_OWNER_PASSWORD:password,PHOENIX_MODE_ACCESS_CODE:accessCode,PHOENIX_STATE_FILE:stateFile,PHOENIX_BIND_HOST:'127.0.0.1',PHOENIX_MAX_ROOMS:'60',PHOENIX_CREATE_LIMIT:'500'},stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>{let text='';text+=b;if(text.includes('PHOENIX multiplayer server:')){}});server.stderr.on('data',b=>{process.stderr.write('[server] '+b);});
  await new Promise((resolve,reject)=>{let text='';const t=setTimeout(()=>reject(Error('Server startup timeout')),10000);server.once('error',reject);server.stdout.on('data',b=>{text+=b;if(text.includes('PHOENIX multiplayer server:')){clearTimeout(t);resolve();}});});
  edge=spawn(process.env.BROWSER_EXE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--window-size=1360,960','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let text='';const t=setTimeout(()=>reject(Error('Edge startup timeout')),20000);edge.once('error',reject);edge.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});});socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});socket.on('message',raw=>{const m=JSON.parse(raw),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);});
  const tab=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:tab.targetId,flatten:true},null)).sessionId;await call('Runtime.enable');await call('Page.enable');await call('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('phoenix.music.v1',JSON.stringify({track:'off',volume:.25}));localStorage.setItem('phoenix.effects.v1',JSON.stringify({sound:false,volume:.35,visuals:'full'}));window.gameErrors=[];addEventListener('error',e=>gameErrors.push(e.message));addEventListener('unhandledrejection',e=>gameErrors.push(String(e.reason)));"});await call('Page.navigate',{url:'http://localhost:'+port+'/'});
  await evaluate("new Promise((r,j)=>{let n=0;const t=setInterval(()=>{if(window.PhoenixOnline&&window.PhoenixCinematics&&window.PhoenixCardScene&&typeof document.getElementById('online-create').onclick==='function'){clearInterval(t);r(true);}else if(n++>200){clearInterval(t);j(Error('game not ready'));}},50);})");
  const result=await evaluate(`(async()=>{
    const Native=WebSocket;window.gamePeers=[];window.gameStates=new Map();const seen=new Set(),samples=[];
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    function track(ws){gamePeers.push(ws);ws.addEventListener('message',e=>{const s=JSON.parse(e.data);if(s.type==='state')gameStates.set(ws,s);});return ws;}
    window.WebSocket=class extends Native{constructor(...args){super(...args);track(this);window.gameHost=this;}};
    const next=ws=>new Promise((r,j)=>{const t=setTimeout(()=>j(Error('snapshot timeout')),8000);function h(e){const s=JSON.parse(e.data);if(!['state','error'].includes(s.type))return;clearTimeout(t);ws.removeEventListener('message',h);r(s);}ws.addEventListener('message',h);});
    const action=async(ws,data)=>{const mine=next(ws);const others=gamePeers.filter(p=>p!==ws).map(p=>Promise.race([next(p).catch(()=>null),wait(500)]));ws.send(JSON.stringify(data));const result=await mine;if(result&&result.type==='error')throw Error(result.message);await Promise.all(others);};
    // WHO PLAYS THIS TURN. The current player is the one whose own seat holds
    // the turn, and a hostage's turn is played by their criminal.
    const peerForNow=id=>gamePeers.find(w=>{const st=gameStates.get(w);return st&&st.players&&st.seat!==undefined&&st.players[st.seat].id===id;});
    const peerFor=async id=>{for(let i=0;i<80;i++){const peer=peerForNow(id);if(peer)return peer;await wait(50);}return null;};
    // The table has to agree before the check can tell whose turn it is:
    // the server broadcasts more than once for a single move.
    const settled=async()=>{for(let i=0;i<120;i++){const currents=gamePeers.map(w=>{const st=gameStates.get(w);return st&&st.current;});const choosers=gamePeers.map(w=>{const st=gameStates.get(w);return st&&st.pending&&st.pending.chooserId;});if(currents.length&&currents.every(c=>c===currents[0])&&choosers.every(c=>c===choosers[0]))return true;await wait(25);}return false;};
    const actorFor=async()=>{for(let i=0;i<240;i++){
      const host=gameStates.get(gameHost);
      const current=host&&host.current;
      // The client whose own snapshot says it is their move.
      const acting=gamePeers.find(w=>{const st=gameStates.get(w);return st&&st.acting;});
      if(acting){const st=gameStates.get(acting);
        // A HOSTAGE'S TURN is played by their criminal.
        if(current&&st.hostage&&st.hostage.hostageId===current){const criminal=peerForNow(st.hostage.criminalId);if(criminal){const cstate=gameStates.get(criminal);if(cstate&&cstate.moves&&cstate.moves.length)return {ws:criminal,state:cstate};}}
        if(st.moves&&st.moves.length)return {ws:acting,state:st};}
      await wait(25);}
      return null;};
    const diagnostics=[];const playedCards=new Set();let games=0,moves=0;
    for(;games<12&&seen.size<21;games++){
      gamePeers=[];gameStates=new Map();PhoenixOnline.enter();document.getElementById('online-create').click();await next(gameHost);
      for(const name of ['Alex','Bob','Riley','Morgan']){const ws=track(new Native('ws://'+location.host));await new Promise(r=>ws.addEventListener('open',r,{once:true}));await action(ws,{type:'join',name,code:gameStates.get(gameHost).code});}
      await action(gameHost,{type:'start',rounds:20});let guard=0;
      while(['turnDice','allyDice'].includes(gameStates.get(gameHost).phase)){if(guard++>250)throw Error('dice stalled');await action(gamePeers[gameStates.get(gameHost).dice.next],{type:'roll'});}
      const allies=['phoenix','tilly','louie','simba','elsie'];while(gameStates.get(gameHost).phase==='draft')await action(gamePeers[gameStates.get(gameHost).draftTurn],{type:'chooseAlly',ally:allies.shift()});
      await PhoenixCardScene.prepare();await PhoenixVictoryScene.prepare();
      while(!gameStates.get(gameHost).over&&guard++<500){
        const interactiveCards=['rps','betrayal','speed','dice','wheel','linkedfate','impostor','swapper','wheelofmisfortune','musicalchairs','russianroulette','memorymayhem','mimic','support','joshuasurvey','trailer'];
        let played=null,lastError=null,before=0;
        for(let attempt=0;attempt<4&&!played;attempt++){
          const actor=await actorFor();if(!actor){const dbg=gamePeers.map(w=>{const st=gameStates.get(w);return st?(st.seat+':'+((st.players||[])[st.seat]||{}).id+':'+st.current+':'+st.acting+':'+((st.moves||[]).length)+':'+JSON.stringify(st.hostage&&st.hostage.hostageId)+':'+JSON.stringify(st.pending&&st.pending.chooserId)):'none';});throw Error('no actor; host='+JSON.stringify({phase:(gameStates.get(gameHost)||{}).phase,current:(gameStates.get(gameHost)||{}).current,pending:(gameStates.get(gameHost)||{}).pending,hostage:(gameStates.get(gameHost)||{}).hostage,over:(gameStates.get(gameHost)||{}).over})+' peers='+dbg.join(' | '));}const ws=actor.ws;const s=actor.state;if(!s)throw Error('no actor state');
          const legal=s.moves.filter(m=>!(s.mapleBlocked||[]).includes(m.cardId));
          const move=legal.find(m=>!seen.has(m.cardId)&&m.cardId!=='phoenix'&&!interactiveCards.includes(m.cardId))||legal.find(m=>m.cardId==='phoenix'&&!seen.has('phoenix'))||legal.find(m=>['bonus','reveal','trick','hunter','ghost','stealturn','curse'].includes(m.cardId))||legal.find(m=>!interactiveCards.includes(m.cardId))||legal[0];if(!move)throw Error('legal choice unavailable');
          const sequenceBefore=(gameStates.get(gameHost).effects||{}).sequence||0;
          before=sequenceBefore;
          try{await action(ws,{type:'move',cardId:move.cardId,targetId:move.targetId});played=move;playedCards.add(move.cardId);
            for(let i=0;i<120;i++){if(((gameStates.get(gameHost).effects||{}).sequence||0)>sequenceBefore)break;await wait(25);}}
          catch(e){lastError=e;const h=gameStates.get(gameHost)||{};const a=gameStates.get(ws)||{};diagnostics.push('refused: '+e.message+' | actorSeat='+a.seat+' actorId='+((a.players||[])[a.seat]||{}).id+' acting='+a.acting+' | current='+h.current+' pending='+JSON.stringify(h.pending&&h.pending.chooserId)+' hostage='+JSON.stringify(h.hostage));await wait(400);await settled();}
        }
        if(!played)throw Error('the move was refused: '+(lastError&&lastError.message)+' | '+diagnostics.join(' || '));
        await settled();moves++;
        const packet=gameStates.get(gameHost).effects,events=packet.events.filter(e=>e.id>before);
        for(const e of events){if(!PhoenixCards.byId(e.key)||seen.has(e.key)||e.key==='wheelofmisfortune')continue;
          await wait(1050);
          // The secret Fake System Shutdown may be on screen. It is a joke, and
          // it can be put away - but only by putting it away, so that is what
          // the check does before it looks at the interface underneath.
          if(window.PhoenixFakeShutdown&&window.PhoenixFakeShutdown.isRunning()){window.__shutdowns=(window.__shutdowns||0)+1;window.PhoenixFakeShutdown.dismiss();await wait(150);if(window.PhoenixFakeShutdown.isRunning())throw Error('the fake shutdown would not go away');}
          const d=PhoenixCardScene.diagnostics(),node=document.querySelector('.pc-scene'),c=(node&&node.querySelector('canvas'))||document.querySelector('.pc-canvas-holder canvas');let bright=0;
          if(c){const gl=c.getContext('webgl2')||c.getContext('webgl'),b=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,b);for(let i=0;i<b.length;i+=4)if(b[i]+b[i+1]+b[i+2]>50&&b[i+3]>10)bright++;}
          const accountOverlay=document.getElementById('account-overlay');if(accountOverlay)accountOverlay.hidden=true;
          const button=document.getElementById('online-settings'),r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          if(node&&getComputedStyle(node).pointerEvents!=='none')throw Error('cinematic blocks input');if(hit&&!button.contains(hit)&&hit!==button)throw Error('Settings blocked by overlay');
          if(!d.history.some(x=>x.key===e.key))throw Error('confirmed card did not reach renderer: '+e.key);
          samples.push({key:e.key,outcome:e.outcome,bright,active:d.key,cache:d.cache});
          // A final ordinary play may be preempted by the result celebration.
          // Count a card only after its actual match particles are observed.
          if(bright>0&&d.key===e.key)seen.add(e.key);
          if(e.key==='phoenix'&&!document.querySelector('.pc-scene'))throw Error('Phoenix lost before victory');
        }
      }
      if(!gameStates.get(gameHost).over)throw Error('match stalled');
      if(PhoenixCinematics.diagnostics().phoenix)await wait(5700);
      PhoenixOnline.leave();gamePeers.forEach(ws=>ws.close());if(PhoenixCardScene.diagnostics().active)throw Error('leave leaked card cinematic');
    }
    return {seen:Array.from(seen),played:Array.from(playedCards),samples,games,moves,errors:gameErrors,renderer:PhoenixCardScene.diagnostics(),voices:PhoenixCinematics.diagnostics().voices};
  })()`);
  const helper=require('./helpers/plain-server');const interactiveIds=helper.INTERACTIVE_IDS||[];const baseIds=require('../js/cards').deckIds().filter(id=>!interactiveIds.includes(id)).concat(['phoenix']).sort();
  fs.writeFileSync(path.join(temp,'phoenix-card-game-validation.json'),JSON.stringify(result,null,2));
  assert.deepStrictEqual(result.seen.sort(), baseIds, 'base deck + earned phoenix on plain-server (interactive cinematics covered by other-cards-browser-check)');assert.deepStrictEqual(result.errors,[]);assert.strictEqual(result.voices,0);assert.strictEqual(result.renderer.error,null);assert.strictEqual(new Set(result.samples.filter(x=>x.bright>0&&x.active===x.key).map(x=>x.key)).size,baseIds.length,'every card in the deck renders its own particle framebuffer');assert(result.samples.every(x=>x.cache<=3));fs.writeFileSync(path.join(temp,'phoenix-card-game-validation.json'),JSON.stringify(result,null,2));console.log('PASS all '+baseIds.length+' cards in '+result.games+' complete real five-player matches / '+result.moves+' authorized moves, earned Phoenix, live particles, input pass-through, privacy boundary and leave cleanup.');
  await evaluate("PhoenixCinematics.show(PhoenixEffects.publicEvent('bonus',0),'online-screen');true");await wait(1300);await shot('phoenix-integrated-card-game.png');
  await evaluate("PhoenixCinematics.update({visuals:'reduced'});PhoenixCinematics.show(PhoenixEffects.publicEvent('curse',0,1),'online-screen');true");await wait(200);assert.strictEqual(await evaluate("document.querySelector('.pc-scene').classList.contains('pc-reduced')"),true);assert.strictEqual(await evaluate("!!(document.querySelector('.pc-canvas-holder')&&!document.querySelector('.pc-canvas-holder').hidden)"),false);await evaluate("PhoenixCinematics.update({visuals:'off'});true");assert.strictEqual(await evaluate('PhoenixCardScene.diagnostics().active'),false);
  await evaluate("PhoenixCinematics.update({visuals:'full'});PhoenixCinematics.show(PhoenixEffects.publicEvent('ghost',0),'online-screen');true");await wait(300);const other=await call('Target.createTarget',{url:'about:blank'},null);await call('Target.activateTarget',{targetId:other.targetId},null);await wait(200);assert.strictEqual(await evaluate('PhoenixCardScene.diagnostics().active'),false);await call('Target.activateTarget',{targetId:tab.targetId},null);await call('Target.closeTarget',{targetId:other.targetId},null);
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});await evaluate("PhoenixCinematics.show(PhoenixEffects.publicEvent('phoenix',0),'online-screen');true");await wait(1400);assert.strictEqual(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);await shot('phoenix-integrated-card-game-mobile.png');await evaluate("PhoenixCinematics.cleanup();true");assert.strictEqual(await evaluate('PhoenixCardScene.diagnostics().active'),false);
  await call('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});await evaluate("PhoenixCinematics.show(PhoenixEffects.publicEvent('phoenix',0),'online-screen');true");await wait(900);
  const resizeBefore=await evaluate("(()=>{const c=document.querySelector('.pc-canvas-holder canvas'),h=document.querySelector('.pc-canvas-holder');return {w:c.width,h:c.height,hidden:h.hidden};})()");
  await call('Emulation.setDeviceMetricsOverride',{width:560,height:600,deviceScaleFactor:1,mobile:false});await wait(600);
  const resizeAfter=await evaluate("(()=>{const c=document.querySelector('.pc-canvas-holder canvas'),h=document.querySelector('.pc-canvas-holder'),gl=c.getContext('webgl2')||c.getContext('webgl'),b=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,b);let bright=0;for(let i=0;i<b.length;i+=4)if(b[i]+b[i+1]+b[i+2]>50&&b[i+3]>10)bright++;return {w:c.width,h:c.height,bright,hidden:h.hidden,active:PhoenixCardScene.diagnostics().active};})()");
  assert.notStrictEqual(resizeBefore.w+'x'+resizeBefore.h,resizeAfter.w+'x'+resizeAfter.h,'live resize must re-size the particle buffer');assert.strictEqual(resizeBefore.hidden,false);assert.strictEqual(resizeAfter.hidden,false);assert(resizeAfter.bright>0,'particles must keep rendering after a live resize');assert.strictEqual(resizeAfter.active,true);await evaluate("PhoenixCinematics.cleanup();true");assert.strictEqual(await evaluate('PhoenixCardScene.diagnostics().active'),false);console.log('PASS live resize keeps the particle canvas sized, visible and rendering.');
  await evaluate("PhoenixCinematics.show(PhoenixEffects.publicEvent('bonus',0),'online-screen');true");await wait(700);await evaluate("document.querySelector('.pc-canvas-holder canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();true");await wait(200);assert.strictEqual(await evaluate("document.querySelector('.pc-scene').classList.contains('pc-reduced')"),true);await evaluate("PhoenixCinematics.cleanup();document.getElementById('menu-cinematics').click();true");await wait(700);assert((await evaluate('location.pathname')).includes('card-effects.html'));console.log('PASS reduced/off, hidden tab cleanup, mobile layout, context-loss fallback and actual main-menu gallery navigation.');
}finally{for(const p of pending.values())clearTimeout(p.timer);if(socket){try{await call('Browser.close',{},null);}catch(e){}socket.close();}if(edge)edge.kill();if(server)server.kill();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
