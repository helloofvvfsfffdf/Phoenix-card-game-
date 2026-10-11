/* Opt-in native Edge test of complete wins through the actual game/controller
 * and real WebSocket server. No forced winner, injected score or synthetic win.
 * Start an isolated local server; set PHOENIX_BROWSER_OWNER_PASSWORD.
 * PHOENIX_BROWSER_URL defaults to localhost:3141. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),{spawn}=require('child_process'),WebSocket=require('ws');
const temp=path.join(process.env.LOCALAPPDATA,'Temp','opencode'),profile=fs.mkdtempSync(path.join(temp,'phoenix-win-game-'));
const base=process.env.PHOENIX_BROWSER_URL||'http://localhost:3141';
const edge=spawn(process.env.BROWSER_EXE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--window-size=1280,900','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket,session,serial=0,pending=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={},target=session){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},90000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function screenshot(name){const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(temp,name),Buffer.from(r.data,'base64'));}
const inspect=`(()=>{const n=document.querySelector('.phoenix-winning-screen'),d=PhoenixVictoryScene.diagnostics();if(!n)return {present:false,d};const c=n.querySelector('canvas');let visible=0,hash=0;if(c){const gl=c.getContext('webgl2')||c.getContext('webgl'),b=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,b);for(let i=0;i<b.length;i+=4){if(b[i]+b[i+1]+b[i+2]>40)visible++;hash=(Math.imul(hash,31)+b[i]+b[i+1]*3+b[i+2]*7)>>>0;}}return {present:true,d,visible,hash,winner:n.querySelector('.pv-winner').textContent,opacity:getComputedStyle(n.querySelector('.pv-winner')).opacity,overflow:document.documentElement.scrollWidth>innerWidth};})()`;
async function awaitScene(){await evaluate(`new Promise((resolve,reject)=>{let tries=0;const t=setInterval(()=>{if(PhoenixVictoryScene.diagnostics().phase==='opening'){clearInterval(t);resolve(true);}else if(tries++>200){clearInterval(t);reject(Error('winning sequence did not start'));}},50);})`);}
async function verifySequence(label,expected){
  await awaitScene();await wait(650);const opening=await evaluate(inspect);assert(opening.present&&opening.visible>0);assert.strictEqual(opening.d.sequence[0].effect,'Boss Death');await screenshot('phoenix-integrated-'+label+'-opening.png');
  await wait(5100);const fireworks=await evaluate(inspect);assert(fireworks.present&&fireworks.visible>0&&!fireworks.overflow);assert(Number(fireworks.opacity)>.99);
  assert.strictEqual(fireworks.winner,expected.name.toUpperCase()+(expected.ally?' & '+expected.ally.toUpperCase():''));await screenshot('phoenix-integrated-'+label+'-victory.png');
  await wait(500);const moving=await evaluate(inspect);assert.notStrictEqual(fireworks.hash,moving.hash);await wait(3700);
  const end=await evaluate(inspect);assert.strictEqual(end.present,false);assert.strictEqual(end.d.sequence.length,6);assert.deepStrictEqual(end.d.sequence.map(s=>s.effect),['Boss Death',...Array(5).fill('Simple Turbulence Fireworks')]);
  end.d.sequence.forEach((s,i)=>assert(Math.abs(s.at-[0,3.15,4.28,4.82,5.58,6.2][i])<.12));assert.strictEqual(end.d.error,null);
  console.log('PASS: complete actual '+label+' win, exact effects/timing, '+fireworks.winner+', moving framebuffer and cleanup');
}
async function main(){try{
  if(!process.env.PHOENIX_BROWSER_OWNER_PASSWORD)throw Error('Set the temporary test-server owner credential documented above.');
  const endpoint=await new Promise((resolve,reject)=>{let text='';const t=setTimeout(()=>reject(Error('Edge timeout')),20000);edge.once('error',reject);edge.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});});
  socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});socket.on('message',raw=>{const m=JSON.parse(raw),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);});
  const target=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await call('Runtime.enable');await call('Page.enable');await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('phoenix.music.v1',JSON.stringify({track:'off',volume:.25}));localStorage.setItem('phoenix.effects.v1',JSON.stringify({sound:false,volume:.35,visuals:'full'}));window.gameErrors=[];addEventListener('error',e=>gameErrors.push(e.message));addEventListener('unhandledrejection',e=>gameErrors.push(String(e.reason)));`});
  await call('Page.navigate',{url:base+'/'});
  await evaluate(`new Promise((resolve,reject)=>{let tries=0;const t=setInterval(()=>{if(window.phoenix&&window.PhoenixOnline){clearInterval(t);resolve(true);}else if(tries++>200){clearInterval(t);reject(Error('game not ready'));}},50);})`);
  const online=await evaluate(`(async()=>{
    const Native=WebSocket;window.winPeers=[];window.winStates=new Map();function track(ws){winPeers.push(ws);ws.addEventListener('message',e=>{const s=JSON.parse(e.data);if(s.type==='state')winStates.set(ws,s);});return ws;}
    window.WebSocket=class extends Native{constructor(...args){super(...args);track(this);window.winHost=this;}};
    const next=ws=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('snapshot timeout')),6000);function handler(e){const s=JSON.parse(e.data);if(!['state','error'].includes(s.type))return;clearTimeout(timer);ws.removeEventListener('message',handler);s.type==='error'?reject(Error(s.message)):resolve(s);}ws.addEventListener('message',handler);});
    const action=async(ws,data)=>{const waits=winPeers.map(next);ws.send(JSON.stringify(data));return Promise.all(waits);};
    window.winMatch=async()=>{
    for(let attempt=0;attempt<7;attempt++){
      winPeers=[];winStates=new Map();PhoenixOnline.enter();document.getElementById('online-name').value='Joshua';document.getElementById('online-owner-password').value=${JSON.stringify(process.env.PHOENIX_BROWSER_OWNER_PASSWORD)};document.getElementById('online-create').click();await next(winHost);
      for(const name of ['Alex','Riley']){const ws=track(new Native('ws://'+location.host));await new Promise(r=>ws.addEventListener('open',r,{once:true}));await action(ws,{type:'join',name,code:winStates.get(winHost).code});}
      await action(winHost,{type:'start',rounds:5});let guard=0;while(['turnDice','allyDice'].includes(winStates.get(winHost).phase)){if(guard++>150)throw Error('dice did not finish');await action(winPeers[winStates.get(winHost).dice.next],{type:'roll'});}
      const allies=['ted','phoenix','elsie'];while(winStates.get(winHost).phase==='draft')await action(winPeers[winStates.get(winHost).draftTurn],{type:'chooseAlly',ally:allies.shift()});
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches){const began=Date.now();while(!PhoenixVictoryScene.diagnostics().ready&&Date.now()-began<12000)await new Promise(r=>setTimeout(r,50));}
      guard=0;while(!winStates.get(winHost).over&&guard++<200){const ws=winPeers.find(w=>winStates.get(w).acting),s=winStates.get(ws);const legal=s.moves.filter(m=>m.cardId!=='phoenix'&&!(s.mapleBlocked||[]).includes(m.cardId));const m=(ws===winHost?legal.find(m=>m.cardId==='bonus'):legal.find(m=>['hunter','ghost','reveal','trick'].includes(m.cardId)))||legal[0]||s.moves[0];if(!m)throw Error('No legal server move');await action(ws,{type:'move',cardId:m.cardId,targetId:m.targetId});}
      const final=winStates.get(winHost);if(!final.over)throw Error('real match did not finish');
      if(PhoenixEffects.matchResult(final)==='victory'){window.winFinal=final;return {name:final.players.find(p=>p.id===final.winner).name,ally:final.players.find(p=>p.id===final.winner).ally,moves:guard,observers:winPeers.map(ws=>PhoenixEffects.matchResult(winStates.get(ws))),attempts:attempt+1};}
      await new Promise(r=>setTimeout(r,2500));PhoenixOnline.leave();winPeers.forEach(ws=>ws.close());
    }throw Error('No browser-player win in seven real matches');};return winMatch();
  })()`);
  assert.strictEqual(online.observers.filter(k=>k==='victory').length,1);assert.strictEqual(online.observers.filter(k=>k==='defeat').length,2);await verifySequence('online-desktop',online);
  assert.strictEqual(await evaluate(`winHost.onmessage({data:JSON.stringify(winFinal)});PhoenixCinematics.diagnostics().celebration`),null,'repeated actual snapshot cannot replay');
  await evaluate(`PhoenixOnline.leave();winPeers.forEach(ws=>ws.close());true`);assert.strictEqual(await evaluate(`PhoenixCinematics.diagnostics().voices`),0);
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  const mobile=await evaluate(`winMatch()`);await verifySequence('online-mobile',mobile);
  await evaluate(`PhoenixOnline.leave();winPeers.forEach(ws=>ws.close());true`);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await evaluate(`winMatch()`);await wait(5700);
  const staticWin=await evaluate(inspect);assert(staticWin.present&&staticWin.visible===0&&Number(staticWin.opacity)>.99);assert.strictEqual(staticWin.d.sequence.length,0);await evaluate(`document.querySelector('.pv-skip').click();true`);assert.strictEqual(await evaluate(`PhoenixCinematics.diagnostics().celebration`),null);
  await evaluate(`PhoenixOnline.leave();winPeers.forEach(ws=>ws.close());true`);console.log('PASS: actual reduced-motion win, '+reduced.name+' & '+reduced.ally+', Skip, no particles');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const interrupted=await evaluate(`winMatch()`);await awaitScene();await wait(300);
  await evaluate(`(()=>{const c=document.querySelector('.phoenix-winning-screen canvas'),gl=c.getContext('webgl2')||c.getContext('webgl');gl.getExtension('WEBGL_lose_context').loseContext();return true;})()`);await wait(200);
  const lost=await evaluate(inspect);assert(lost.present&&lost.d.phase==='fallback'&&lost.visible===0);assert.strictEqual(lost.winner,interrupted.name.toUpperCase()+' & '+interrupted.ally.toUpperCase());
  await evaluate(`PhoenixOnline.leave();winPeers.forEach(ws=>ws.close());true`);assert.strictEqual(await evaluate(`PhoenixCinematics.diagnostics().celebration`),null);
  console.log('PASS: graphics context loss retains correct winner/ally, static fallback and disconnect cleanup');
  assert.deepStrictEqual(await evaluate('gameErrors'),[]);console.log('PASS: actual three-player server win, correct name/drafted ally, opponent defeat results, repeated snapshot suppression, leave cleanup and no JS errors');
}finally{for(const p of pending.values())clearTimeout(p.timer);if(socket){try{await call('Browser.close',{},null);}catch(e){}socket.close();}edge.kill();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
