'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../phoenixtube.html'),'utf8');
const client=fs.readFileSync(path.join(__dirname,'../js/phoenixtube-client.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../css/phoenixtube.css'),'utf8');
const challenge=fs.readFileSync(path.join(__dirname,'../js/phoenix-tube-challenge.js'),'utf8');
function test(name,fn){try{fn();console.log('PASS',name);}catch(error){console.error('FAIL',name,error.message);process.exitCode=1;}}
test('direct visits have a welcome screen and Try Demo control',()=>{assert(html.includes('id="welcome"'));assert(html.includes('id="try-demo"'));assert(client.includes('if(token) loadMultiplayer();'));assert(client.includes("demo=true;state=demoState()"));});
test('demo is isolated from multiplayer completion and points',()=>{assert(client.includes("if(demo){"));assert(client.includes('No PHOENIX points were changed.'));assert(client.includes("api('submit'"));assert(client.includes('demo=false;$('));});
test('demo selects four clips, random digits, stable reveal times and ten minutes',()=>{assert(client.includes('slice(0,4)'));assert(client.includes('digit:random(10)'));assert(client.includes('revealAt:random(91)+15'));assert(client.includes('expiresAt:Date.now()+600000'));assert(client.includes("duration:120"));});
test('demo result and retry controls exist',()=>{assert(client.includes('PHOENIXTube Challenge Complete!'));assert(client.includes("Time's Up!"));assert(client.includes("'PLAY AGAIN'"));assert(client.includes("'TRY AGAIN'"));});
test('all temporary demo videos remain exactly 120 seconds',()=>{const files=fs.readdirSync(path.join(__dirname,'../assets/phoenixtube')).filter(file=>file.endsWith('.mp4'));assert.strictEqual(files.length,6);files.forEach(file=>{const stat=fs.statSync(path.join(__dirname,'../assets/phoenixtube',file));assert(stat.size>1000,file);});assert(css.includes('.demo-button'));assert(challenge.includes('duration:120'));});
