/* Opt-in Windows Edge/Chrome CDP smoke check. No new dependency or autoplay bypass.
 * Start a local PHOENIX server first. PHOENIX_BROWSER_URL selects that server;
 * optional PHOENIX_BROWSER_OWNER_PASSWORD enables a real three-player match.
 * BROWSER_EXE overrides the installed Edge path. Never uses a personal profile.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const base = process.env.PHOENIX_BROWSER_URL || 'http://localhost:3141';
const temp = path.join(process.env.LOCALAPPDATA || os.tmpdir(), process.env.LOCALAPPDATA ? 'Temp/opencode' : 'opencode');
fs.mkdirSync(temp, { recursive: true });
const profile = fs.mkdtempSync(path.join(temp, 'phoenix-cinematic-profile-'));
const browser = spawn(process.env.BROWSER_EXE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--window-size=1280,900', '--user-data-dir=' + profile, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
let socket, serial = 0, session, pending = new Map();
function call(method, params = {}, target = session) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 90000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function navigate(url) {
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', handler); reject(new Error('Page load timeout')); }, 20000);
    function handler(raw) {
      const m = JSON.parse(raw);
      if (m.method === 'Page.loadEventFired' && m.sessionId === session) { clearTimeout(timer); socket.off('message',handler); resolve(); }
    }
    socket.on('message',handler);
  });
  await call('Page.navigate',{url}); await loaded;
}
async function main() {
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Headless browser startup timeout')), 20000);
      browser.once('error', reject);
      browser.stderr.on('data', bytes => {
        output += bytes;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.on('message', raw => {
      const m = JSON.parse(raw); const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
    session = (await call('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
    await call('Runtime.enable'); await call('Page.enable');
    // Origin-local defaults are muted before loading any game code.
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('phoenix.music.v1',JSON.stringify({track:'off',volume:.25}));localStorage.setItem('phoenix.effects.v1',JSON.stringify({sound:false,volume:.35,visuals:'full'}));`});
    await navigate(base + '/');
    const visible = await evaluate(`!document.hidden`); assert(visible, 'native headless document must be visible');
    await evaluate(`(() => {
      window.smokeErrors=[];addEventListener('error',e=>smokeErrors.push(e.message));addEventListener('unhandledrejection',e=>smokeErrors.push(String(e.reason)));
      const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(dest,...args){if(dest instanceof AudioDestinationNode){const mute=this.context.createGain();mute.gain.value=0;connect.call(this,mute);return connect.call(mute,dest);}return connect.call(this,dest,...args);};
      const create=AudioContext.prototype.createBufferSource;window.smokeSources=[];AudioContext.prototype.createBufferSource=function(){const s=create.call(this);smokeSources.push(s);return s;};
      document.getElementById('phoenix-music').muted=true;PhoenixMusicSettings.open();PhoenixCinematics.update({sound:true});
      return true;
    })()`);
    // A genuine CDP input gesture enables audio; no autoplay-policy override.
    const rect = await evaluate(`(()=>{const b=document.getElementById('settings-effects-preview');b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await call('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...rect });
    await call('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...rect });
    const previews = await evaluate(`(async()=>{
      await new Promise(r=>setTimeout(r,150));PhoenixCinematics.stopPreview();
      const results=[];const choice=document.getElementById('settings-effects-choice');
      for(const p of choice.options){choice.value=p.value;choice.dispatchEvent(new Event('change'));const before=smokeSources.length;document.getElementById('settings-effects-preview').click();await new Promise(r=>setTimeout(r,30));
        const s=smokeSources[smokeSources.length-1];let peak=0;for(const x of s.buffer.getChannelData(0))peak=Math.max(peak,Math.abs(x));results.push({key:p.value,sources:smokeSources.length-before,peak,duration:s.buffer.duration});document.getElementById('settings-effects-stop').click();}
      PhoenixCinematics.update({sound:false});PhoenixCinematics.preview('victory');const muted=PhoenixCinematics.diagnostics().voices===0;
      PhoenixCinematics.update({sound:true,volume:0});PhoenixCinematics.preview('knife');const zero=PhoenixCinematics.diagnostics().voices===0;
      PhoenixCinematics.update({volume:.35});PhoenixCinematics.stopPreview();PhoenixMusicSettings.leave();
      return {results,muted,zero,errors:smokeErrors};
    })()`);
    assert(previews.muted && previews.zero); assert.strictEqual(previews.results.length,29);
    previews.results.forEach(r => { assert.strictEqual(r.sources,1); assert(r.peak > 0 && r.peak <= .781); });
    console.log('PASS: 29 native Web Audio previews, controls, mute/zero volume and bounded PCM');
    if (process.env.PHOENIX_BROWSER_OWNER_PASSWORD) {
      const multiplayer = await evaluate(`(async()=>{
        window.smokePeers=[];window.smokeStates=new Map();const Native=WebSocket;
        function track(ws){smokePeers.push(ws);ws.addEventListener('message',e=>{const s=JSON.parse(e.data);if(s.type==='state')smokeStates.set(ws,s);});return ws;}
        window.WebSocket=class extends Native{constructor(...args){super(...args);track(this);window.smokeHost=this;}};
        const next=ws=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.removeEventListener('message',handler);reject(new Error('snapshot timeout'));},5000);function handler(e){const s=JSON.parse(e.data);if(!['state','error'].includes(s.type))return;clearTimeout(timer);ws.removeEventListener('message',handler);s.type==='error'?reject(new Error(s.message)):resolve(s);}ws.addEventListener('message',handler);});
        const action=async(ws,data)=>{const waits=smokePeers.map(next);ws.send(JSON.stringify(data));return Promise.all(waits);};
        window.smokeAction=action;window.smokeTrack=track;window.smokeNative=Native;window.smokeNext=next;
        const a=document.getElementById('phoenix-music');PhoenixMusicPlayer.select('epic');await a.play();PhoenixOnline.enter();
        document.getElementById('online-name').value='Browser Host';document.getElementById('online-owner-password').value=${JSON.stringify(process.env.PHOENIX_BROWSER_OWNER_PASSWORD)};
        document.getElementById('online-create').click();await next(smokeHost);
        for(const name of ['Browser Guest','Browser Third']){const ws=track(new Native('ws://'+location.host));await new Promise(r=>ws.addEventListener('open',r,{once:true}));await action(ws,{type:'join',name,code:smokeStates.get(smokeHost).code});}
        await action(smokeHost,{type:'start',rounds:5});let guard=0;
        while(['turnDice','allyDice'].includes(smokeStates.get(smokeHost).phase)){if(guard++>150)throw new Error('dice');await action(smokePeers[smokeStates.get(smokeHost).dice.next],{type:'roll'});}
        const allies=['ted','phoenix','elsie'];while(smokeStates.get(smokeHost).phase==='draft')await action(smokePeers[smokeStates.get(smokeHost).draftTurn],{type:'chooseAlly',ally:allies.shift()});
        await new Promise(r=>setTimeout(r,500));const matchPaused=a.paused;let moves=0;
        while(!smokeStates.get(smokeHost).over&&moves++<150){const ws=smokePeers.find(w=>smokeStates.get(w).acting),s=smokeStates.get(ws),m=s.moves.find(m=>m.cardId!=='phoenix'&&!(s.mapleBlocked||[]).includes(m.cardId))||s.moves.find(m=>!(s.mapleBlocked||[]).includes(m.cardId));await action(ws,{type:'move',cardId:m.cardId,targetId:m.targetId});}
        const final=smokeStates.get(smokeHost),result=PhoenixEffects.matchResult(final),stage=PhoenixCinematics.diagnostics().celebration;window.smokeWinner=final.winner;
        await new Promise(r=>setTimeout(r,5500));const cleaned=PhoenixCinematics.diagnostics();
        // Repeated authoritative state uses the actual message handler again.
        smokeHost.onmessage({data:JSON.stringify(final)});const duplicate=PhoenixCinematics.diagnostics().celebration;
        const musicResumed=!a.paused;PhoenixOnline.leave();smokePeers.forEach(ws=>ws.close());
        return {moves,over:final.over,result,stage,matchPaused,musicResumed,cleaned,duplicate};
      })()`);
      assert(multiplayer.over && multiplayer.matchPaused && multiplayer.musicResumed);
      assert(multiplayer.stage.includes(multiplayer.result));assert.strictEqual(multiplayer.duplicate,null);
      assert.strictEqual(multiplayer.cleaned.voices,0);console.log('PASS: real three-player match, confirmed '+multiplayer.result+', cleanup, deduplication and music lifecycle');
    }
    if (process.env.PHOENIX_FIRE_CHECK) {
      await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      const fire = await evaluate(`(async()=>{
        await new Promise(r=>setTimeout(r,200));PhoenixMusicSettings.open();document.getElementById('settings-phoenix-cinematic').click();
        await new Promise(r=>setTimeout(r,1500));const n=document.querySelector('.phoenix-takeover'),canvas=n.querySelector('canvas');
        return {phase:n.dataset.phase,media:n.dataset.media,width:canvas.width,height:canvas.height,audio:PhoenixCinematics.diagnostics().phoenixAudio,mutedVideo:true,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert(fire.phase==='impact' && fire.media==='filmed-fire' && fire.audio==='recorded-mix' && !fire.overflow);
      const shot=await call('Page.captureScreenshot',{format:'png'}), screenshot=path.join(temp,'phoenix-fire-desktop.png');fs.writeFileSync(screenshot,Buffer.from(shot.data,'base64'));
      await evaluate(`new Promise(r=>setTimeout(()=>r(true),3100))`);
      assert.strictEqual(await evaluate(`PhoenixCinematics.diagnostics().phoenix`),null);
      await evaluate(`PhoenixCinematics.stopPreview();PhoenixMusicSettings.leave();true`);
      await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
      const mobile=await evaluate(`(async()=>{PhoenixMusicSettings.open();document.getElementById('settings-phoenix-cinematic').click();await new Promise(r=>setTimeout(r,1450));const n=document.querySelector('.phoenix-takeover'),c=n.querySelector('canvas');const result={pixels:c.width*c.height,media:n.dataset.media,overflow:document.documentElement.scrollWidth>innerWidth};n.querySelector('button').click();result.stopped=PhoenixCinematics.diagnostics().phoenix===null;PhoenixMusicSettings.leave();return result;})()`);
      assert(mobile.pixels<=750000 && mobile.media==='filmed-fire' && !mobile.overflow && mobile.stopped);
      await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      const reduced=await evaluate(`(async()=>{await new Promise(r=>setTimeout(r,100));PhoenixMusicSettings.open();document.getElementById('settings-phoenix-cinematic').click();await new Promise(r=>setTimeout(r,200));const n=document.querySelector('.phoenix-takeover');const result={static:n.className.includes('phoenix-static'),canvasHidden:n.querySelector('canvas').hidden};PhoenixCinematics.stopPreview();PhoenixMusicSettings.leave();return result;})()`);
      assert(reduced.static && reduced.canvasHidden);await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      console.log('PASS: Phoenix filmed-fire takeover, decoded recorded mix, desktop/mobile and reduced motion');console.log('Phoenix screenshot: '+screenshot);
      if(process.env.PHOENIX_BROWSER_OWNER_PASSWORD && await evaluate(`!!smokeWinner`)) {
        const legendary=await evaluate(`(async()=>{
          await new Promise(r=>setTimeout(r,200));window.smokePeers=[];window.smokeStates=new Map();PhoenixOnline.enter();
          document.getElementById('online-name').value='Phoenix Test Host';document.getElementById('online-owner-password').value=${JSON.stringify(process.env.PHOENIX_BROWSER_OWNER_PASSWORD)};document.getElementById('online-create').click();await smokeNext(smokeHost);
          for(const name of ['Phoenix Observer','Phoenix Third']){const ws=smokeTrack(new smokeNative('ws://'+location.host));await new Promise(r=>ws.addEventListener('open',r,{once:true}));await smokeAction(ws,{type:'join',name,code:smokeStates.get(smokeHost).code});}
          await smokeAction(smokeHost,{type:'start',rounds:10});let guard=0;while(['turnDice','allyDice'].includes(smokeStates.get(smokeHost).phase)){if(guard++>150)throw Error('dice');await smokeAction(smokePeers[smokeStates.get(smokeHost).dice.next],{type:'roll'});}
          const allies=['ted','phoenix','elsie'];while(smokeStates.get(smokeHost).phase==='draft')await smokeAction(smokePeers[smokeStates.get(smokeHost).draftTurn],{type:'chooseAlly',ally:allies.shift()});
          const initial=smokePeers.map(ws=>({seat:smokeStates.get(ws).seat,moves:smokeStates.get(ws).moves}));let fired=false,actorIsBrowser=false,totalBefore=0,totalAfter=0;guard=0;
          while(!smokeStates.get(smokeHost).over&&guard++<200){const ws=smokePeers.find(w=>smokeStates.get(w).acting),s=smokeStates.get(ws);const allowed=s.moves.filter(m=>!(s.mapleBlocked||[]).includes(m.cardId));
            const m=allowed.find(m=>m.cardId==='phoenix')||allowed.find(m=>['bonus','hunter','ghost','reveal','trick'].includes(m.cardId))||allowed[0];if(!m)throw Error('no legal move');
            if(m.cardId==='phoenix'){totalBefore=s.players.reduce((a,p)=>a+p.points,0);actorIsBrowser=ws===smokeHost;await smokeAction(ws,{type:'move',cardId:m.cardId,targetId:m.targetId});fired=true;totalAfter=smokeStates.get(ws).players[smokeStates.get(ws).seat].points;break;}
            await smokeAction(ws,{type:'move',cardId:m.cardId,targetId:m.targetId});}
          if(!fired)throw Error('earned Phoenix never became legally available: '+JSON.stringify({previousWinner:smokeWinner,initial}));
          const observed=smokePeers.map(ws=>smokeStates.get(ws).effects.events.filter(e=>e.key==='phoenix').length);
          const state=smokeStates.get(smokeHost);await new Promise(r=>setTimeout(r,1500));const stage=PhoenixCinematics.diagnostics().phoenix;await new Promise(r=>setTimeout(r,3100));
          smokeHost.onmessage({data:JSON.stringify(state)});const duplicate=PhoenixCinematics.diagnostics().phoenix;
          PhoenixOnline.leave();smokePeers.forEach(ws=>ws.close());return {fired,actorIsBrowser,totalBefore,totalAfter,observed,stage,duplicate};
        })()`);
        assert(legendary.fired && legendary.observed.every(n=>n===1) && legendary.totalBefore===legendary.totalAfter && legendary.stage==='impact' && legendary.duplicate===null);
        console.log('PASS: genuinely earned Phoenix played through real server; three recipients, exact point transfer, no repeat; browser was '+(legendary.actorIsBrowser?'actor':'opponent'));
      }
      await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    }
    // Isolated authoritative-shaped fixture exercises the spectacular winner
    // stage independently of who won the random live match; does not mutate it.
    const fixture = `window.smokeSnapshot=(over,stream='visual-fixture')=>({type:'state',started:true,phase:'playing',over,seat:0,winner:over?'human':null,players:[{id:'human'},{id:'guest'}],effects:{stream,sequence:over?2:1,events:[]}});PhoenixCinematics.match(smokeSnapshot(false));PhoenixCinematics.match(smokeSnapshot(true));true`;
    await evaluate(fixture);
    await evaluate(`new Promise(r=>setTimeout(()=>r(true),1100))`);
    const shot = await call('Page.captureScreenshot', { format:'png' });
    const screenshot = path.join(temp, 'phoenix-victory-desktop.png');fs.writeFileSync(screenshot,Buffer.from(shot.data,'base64'));
    const stage = await evaluate(`(()=>{const n=document.querySelector('.match-celebration');return {beams:n.querySelectorAll('.celebration-beam').length,bursts:n.querySelectorAll('.celebration-burst').length,particles:n.querySelectorAll('.celebration-particle').length,overflow:document.documentElement.scrollWidth>innerWidth,skip:!!n.querySelector('button')};})()`);
    assert(stage.beams===6 && stage.bursts===3 && stage.particles===56 && !stage.overflow && stage.skip);
    await evaluate(`PhoenixCinematics.skipCelebration();true`);
    await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    const mobile = await evaluate(`(()=>{PhoenixCinematics.match(smokeSnapshot(false,'mobile-fixture'));PhoenixCinematics.match(smokeSnapshot(true,'mobile-fixture'));const n=document.querySelector('.match-celebration');const title=n.querySelector('h2').getBoundingClientRect();const result={overflow:document.documentElement.scrollWidth>innerWidth,particles:n.querySelectorAll('.celebration-particle').length,titleFits:title.left>=0&&title.right<=innerWidth};PhoenixCinematics.skipCelebration();PhoenixMusicSettings.open();result.choices=document.getElementById('settings-effects-choice').options.length;result.settingsOverflow=document.documentElement.scrollWidth>innerWidth;PhoenixMusicSettings.leave();return result;})()`);
    assert(!mobile.overflow && !mobile.settingsOverflow && mobile.titleFits && mobile.particles===32);
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const reduced = await evaluate(`(async()=>{await new Promise(r=>setTimeout(r,100));PhoenixCinematics.match(smokeSnapshot(false,'reduced-fixture'));PhoenixCinematics.match(smokeSnapshot(true,'reduced-fixture'));const n=document.querySelector('.match-celebration');const result={className:n.className,particles:n.querySelectorAll('.celebration-particle').length,titleAnimation:getComputedStyle(n.querySelector('h2')).animationName};PhoenixCinematics.skipCelebration();return result;})()`);
    assert(reduced.className.includes('reduced') && reduced.particles===0 && reduced.titleAnimation==='none');
    assert.deepStrictEqual(await evaluate('smokeErrors'),[]);
    console.log('PASS: desktop/mobile winner stage, skip, native reduced-motion and no browser errors');
    console.log('Screenshot: '+screenshot);
  } finally {
    if(socket && socket.readyState===WebSocket.OPEN){try{await call('Browser.close',{},null);}catch(e){}socket.close();}
    if(browser.exitCode===null) browser.kill();
    if(browser.exitCode===null) await new Promise(resolve=>{const timer=setTimeout(resolve,3000);browser.once('exit',()=>{clearTimeout(timer);resolve();});});
    pending.forEach(p=>clearTimeout(p.timer));
    try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){console.log('Temporary browser profile retained: '+profile);}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
