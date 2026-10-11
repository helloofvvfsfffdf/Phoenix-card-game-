/* Native Edge + isolated real server. Earn Phoenix by completing matches;
 * never inject scores/hands, fake result packets or force a winning player. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto'),net=require('net'),{spawn}=require('child_process'),WebSocket=require('ws');
const temp=path.join(process.env.LOCALAPPDATA,'Temp','opencode'),profile=fs.mkdtempSync(path.join(temp,'phoenix-card-game-'));
let edge,server,socket,session,serial=0;const pending=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={},target=session){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},180000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function shot(name){const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(temp,name),Buffer.from(r.data,'base64'));}
async function main(){try{
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const password=crypto.randomBytes(24).toString('hex');
  server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),PHOENIX_OWNER_PASSWORD:password,PHOENIX_MODE_ACCESS_CODE:crypto.randomBytes(16).toString('hex')},stdio:['ignore','pipe','pipe']});
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
    const next=ws=>new Promise((r,j)=>{const t=setTimeout(()=>j(Error('snapshot timeout')),8000);function h(e){const s=JSON.parse(e.data);if(!['state','error'].includes(s.type))return;clearTimeout(t);ws.removeEventListener('message',h);s.type==='error'?j(Error(s.message)):r(s);}ws.addEventListener('message',h);});
    const action=async(ws,data)=>{const waits=gamePeers.map(next);ws.send(JSON.stringify(data));await Promise.all(waits);};
    let games=0,moves=0;
    for(;games<10&&seen.size<14;games++){
      gamePeers=[];gameStates=new Map();PhoenixOnline.enter();document.getElementById('online-name').value='Cinematic tester';document.getElementById('online-owner-password').value=${JSON.stringify(password)};document.getElementById('online-create').click();await next(gameHost);
      for(const name of ['Alex','Bob','Riley','Morgan']){const ws=track(new Native('ws://'+location.host));await new Promise(r=>ws.addEventListener('open',r,{once:true}));await action(ws,{type:'join',name,code:gameStates.get(gameHost).code});}
      await action(gameHost,{type:'start',rounds:20});let guard=0;
      while(['turnDice','allyDice'].includes(gameStates.get(gameHost).phase)){if(guard++>250)throw Error('dice stalled');await action(gamePeers[gameStates.get(gameHost).dice.next],{type:'roll'});}
      const allies=['phoenix','tilly','louie','simba','elsie'];while(gameStates.get(gameHost).phase==='draft')await action(gamePeers[gameStates.get(gameHost).draftTurn],{type:'chooseAlly',ally:allies.shift()});
      await PhoenixCardScene.prepare();await PhoenixVictoryScene.prepare();
      while(!gameStates.get(gameHost).over&&guard++<500){
        const ws=gamePeers.find(w=>gameStates.get(w).acting),s=gameStates.get(ws);if(!s)throw Error('no actor');
        const legal=s.moves.filter(m=>!(s.mapleBlocked||[]).includes(m.cardId));
        const move=legal.find(m=>!seen.has(m.cardId)&&m.cardId!=='phoenix')||legal.find(m=>m.cardId==='phoenix'&&!seen.has('phoenix'))||legal.find(m=>['bonus','reveal','trick','hunter','ghost','stealturn','curse'].includes(m.cardId))||legal[0];if(!move)throw Error('legal choice unavailable');
        const before=gameStates.get(gameHost).effects.sequence;await action(ws,{type:'move',cardId:move.cardId,targetId:move.targetId});moves++;
        const packet=gameStates.get(gameHost).effects,events=packet.events.filter(e=>e.id>before);
        for(const e of events){if(!PhoenixCards.byId(e.key)||seen.has(e.key))continue;
          await wait(1050);const d=PhoenixCardScene.diagnostics(),node=document.querySelector('.pc-scene'),c=(node&&node.querySelector('canvas'))||document.querySelector('.pc-canvas-holder canvas');let bright=0;
          if(c){const gl=c.getContext('webgl2')||c.getContext('webgl'),b=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,b);for(let i=0;i<b.length;i+=4)if(b[i]+b[i+1]+b[i+2]>50&&b[i+3]>10)bright++;}
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
    return {seen:Array.from(seen),samples,games,moves,errors:gameErrors,renderer:PhoenixCardScene.diagnostics(),voices:PhoenixCinematics.diagnostics().voices};
  })()`);
  assert.deepStrictEqual(result.seen.sort(),require('../js/cards').ids().sort(),'all real cards including legitimately earned Phoenix must visibly render');assert.deepStrictEqual(result.errors,[]);assert.strictEqual(result.voices,0);assert.strictEqual(result.renderer.error,null);assert.strictEqual(new Set(result.samples.filter(x=>x.bright>0&&x.active===x.key).map(x=>x.key)).size,14,'all fourteen actual-game particle framebuffers');assert(result.samples.every(x=>x.cache<=3));fs.writeFileSync(path.join(temp,'phoenix-card-game-validation.json'),JSON.stringify(result,null,2));console.log('PASS all 14 cards in '+result.games+' complete real five-player matches / '+result.moves+' authorized moves, earned Phoenix, live particles, input pass-through, privacy boundary and leave cleanup.');
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
