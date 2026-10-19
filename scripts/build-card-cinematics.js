/* Original PHOENIX particle authoring. Run with Effekseer 1.80.7's CLI.
 * Generates editable projects, original textures and deployment binaries.
 * Does not read/write game state or any approved victory assets. */
'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),cp=require('child_process'),crypto=require('crypto');
const out=path.resolve(__dirname,'../assets/card-cinematics');
const editor=process.env.EFFEKSEER_EXE||'C:/Users/Joshua Hopkins/Downloads/Effekseer1.80.7Win/Effekseer1.80.7Win/Tool/bin/Effekseer.exe';
fs.mkdirSync(path.join(out,'textures'),{recursive:true});fs.mkdirSync(path.join(out,'source'),{recursive:true});
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(t,b){const a=Buffer.from(t),s=Buffer.alloc(4),e=Buffer.alloc(4);s.writeUInt32BE(b.length);e.writeUInt32BE(crc(Buffer.concat([a,b])));return Buffer.concat([s,a,b,e]);}
const clamp=v=>Math.max(0,Math.min(1,v));
function texture(name,fn){const n=128,raw=Buffer.alloc(n*(n*4+1));for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*(n*4+1)+1+x*4;raw[i]=raw[i+1]=raw[i+2]=255;raw[i+3]=Math.round(clamp(fn((x+.5)/n*2-1,(y+.5)/n*2-1))*255);}const h=Buffer.alloc(13);h.writeUInt32BE(n,0);h.writeUInt32BE(n,4);h[8]=8;h[9]=6;fs.writeFileSync(path.join(out,'textures',name+'.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
texture('ember',(x,y)=>Math.exp(-(x*x+y*y)*15)*clamp((1-Math.hypot(x,y))*4));
texture('star',(x,y)=>Math.max(Math.exp(-(x*x+y*y)*45),Math.exp(-Math.abs(x)*42-Math.abs(y)*4),Math.exp(-Math.abs(y)*42-Math.abs(x)*4))*clamp((1-Math.hypot(x,y))*5));
texture('ring',(x,y)=>Math.exp(-Math.pow((Math.hypot(x,y)-.72)*65,2))*.85+Math.exp(-Math.pow((Math.hypot(x,y)-.72)*12,2))*.12);
texture('smoke',(x,y)=>Math.exp(-(x*x+y*y)*4)*(.48+.16*Math.sin(x*13+y*7)+.12*Math.cos(y*19-x*9))*clamp((1-Math.hypot(x,y))*4));
texture('slash',(x,y)=>Math.exp(-Math.pow(y*27,2))*clamp((1-Math.abs(x))*5));
texture('feather',(x,y)=>clamp((1-Math.abs(y))*5)*Math.max(Math.exp(-Math.pow((x-.18*Math.sin(y*2))*8,2))*.85,Math.exp(-Math.abs(x)*70))*(.65+.35*Math.cos(y*60+x*30)));
texture('coin',(x,y)=>{const r=Math.hypot(x,y);return Math.max(Math.exp(-Math.pow((r-.7)*40,2)),Math.exp(-Math.pow((r-.53)*55,2))*.55,Math.abs(x)<.04&&Math.abs(y)<.4?.8:0);});
texture('rune',(x,y)=>{const r=Math.hypot(x,y),a=Math.atan2(y,x);return Math.max(Math.exp(-Math.pow((r-.7)*55,2)),Math.exp(-Math.pow((r-.48)*65,2))*.6,r>.51&&r<.86?Math.pow(Math.max(0,Math.cos(a*12)),35):0);});
const palettes={bonus:'#ffd475',knife:'#b9eaff',hunter:'#8be2aa',zombie:'#a1ef63',steal:'#bd9cff',judge:'#ffe6a0',reveal:'#75dcff',skipall:'#ffb579',phoenix:'#ff873d',trick:'#ff9ad9',stealturn:'#7fa8ff',curse:'#c08cff',ghost:'#b1f2f1',alvin:'#ffba7c',dice:'#ffd700',rps:'#ff6b6b',betrayal:'#9b59b6',speed:'#00d4ff',wheel:'#ff9500',linkedfate:'#00ff88',impostor:'#8e44ad',swapper:'#ff4081'};
const rgb=h=>h.slice(1).match(/../g).map(x=>parseInt(x,16));
function range(tag,v){return `<${tag}><Center>${v}</Center><Max>${v}</Max><Min>${v}</Min></${tag}>`;}
function xyz(tag,x=0,y=0,z=0){return `<${tag}>${range('X',x)}${range('Y',y)}${range('Z',z)}</${tag}>`;}
let nodes=[];
function sprite(tex,x,y,sx,sy,delay=0,life=65,vx=0,vy=0,rotation=0,spin=0,color,alpha=210,grow=0){const [r,g,b]=rgb(color);nodes.push(`<Node><Name>${tex} ${nodes.length}</Name><CommonValues><MaxGeneration><Value>1</Value></MaxGeneration>${range('Life',life)}${range('GenerationTimeOffset',delay)}</CommonValues><LocationValues><Type>1</Type><PVA>${xyz('Location',x,y)}${xyz('Velocity',vx,vy)}</PVA></LocationValues><RotationValues><Type>1</Type><PVA>${xyz('Rotation',0,0,rotation)}${xyz('Velocity',0,0,spin)}</PVA></RotationValues><ScalingValues><Type>1</Type><PVA>${xyz('Scale',sx,sy,1)}${xyz('Velocity',grow,grow,0)}</PVA></ScalingValues><RendererCommonValues><ColorTexture>textures/${tex}.png</ColorTexture><AlphaBlend>2</AlphaBlend><FadeInType>1</FadeInType><FadeIn><Frame>8</Frame></FadeIn><FadeOutType>1</FadeOutType><FadeOut><Frame>${Math.min(30,life*.55)}</Frame></FadeOut></RendererCommonValues><DrawingValues><Sprite><Billboard>2</Billboard><ColorAll_Fixed><R>${r}</R><G>${g}</G><B>${b}</B><A>${alpha}</A></ColorAll_Fixed></Sprite></DrawingValues><Children /></Node>`);}
let seed=17;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function dust(color,n=55,radius=5,delay=30,up=.025,tex='ember'){for(let i=0;i<n;i++){const a=random()*Math.PI*2,r=Math.sqrt(random())*radius;sprite(tex,Math.cos(a)*r,Math.sin(a)*r,.12+random()*.28,.12+random()*.28,delay+random()*45,45+random()*65,Math.cos(a)*.015,up,random()*180,0,color,160);}}
function ring(color,x=0,y=0,size=10,delay=25){sprite('ring',x,y,size,size,delay,75,0,0,0,.35,color,140,.065);}
function trace(color,points,delay=28,tex='ember',size=.32){points.forEach((p,i)=>sprite(tex,p[0],p[1],size,size,delay+i*.65,55,0,.008,0,0,color,210));}
function arc(color,cx,cy,rx,ry,start,end,n=48,delay=20){trace(color,Array.from({length:n},(_,i)=>{const a=start+(end-start)*i/(n-1);return [cx+rx*Math.cos(a),cy+ry*Math.sin(a)];}),delay);}
function streak(color,x,y,len,angle,delay){sprite('slash',x,y,len,.45,delay,34,0,0,angle,0,color,240);}
const builders={
 bonus(c){ring(c,0,0,9,20);for(let i=0;i<18;i++){const a=i*2.4;sprite('coin',Math.sin(a)*5,-3+random()*3,.65,.9,i*3+15,90,Math.sin(a)*-.035,.055,0,1,c);}dust(c,65,6,20,.04,'star');},
 knife(c){streak(c,-1,1,15,-32,18);streak('#ffffff',0,0,11,-32,24);for(let i=0;i<28;i++)sprite('slash',random()*5,random()*4-2,.55,.1,25+i*.35,40,.04+random()*.06,-.015,-32,0,c);ring(c,3,-1,3,26);},
 hunter(c){arc(c,0,0,4,5,-Math.PI*.15,Math.PI*1.15,60,15);arc(c,0,0,3.3,4.3,-Math.PI*.15,Math.PI*1.15,50,22);trace(c,[[-3,-2],[-2,-3],[-1,-3.8],[0,-4.4],[1,-3.8],[2,-3],[3,-2]],45,'star',.4);dust(c,45,5,24,.035,'feather');},
 zombie(c){for(let i=0;i<26;i++)sprite('smoke',random()*9-4.5,-3+random()*2,2+random()*2,3+random()*2,10+i*2,110,0,.045,random()*180,.15,c,90);ring(c,0,-2,8,30);arc(c,0,0,3,4,0,Math.PI*2,60,25);dust(c,50,5,25,.01);},
 steal(c){for(let j=0;j<3;j++){const pts=Array.from({length:38},(_,i)=>{const t=i/37;return [7-14*t,(j-1)*.65+Math.sin(t*Math.PI)*3];});trace(c,pts,14+j*4,'star',.25);}for(let i=0;i<20;i++)sprite('coin',6+random(),-1+random()*2,.5,.7,15+i*2,65,-.16,.02,0,2,c);ring(c,-6,0,3,65);},
 judge(c){sprite('rune',0,0,12,12,12,130,0,0,0,.15,c,180);streak(c,0,1,17,90,58);ring(c,0,0,5,65);dust(c,75,6,55,-.025,'star');},
 reveal(c){arc(c,0,-1,5,3,0,Math.PI,52,15);arc(c,0,1,5,3,Math.PI,Math.PI*2,52,15);sprite('rune',0,0,4,4,25,100,0,0,0,-.7,c,180);streak(c,0,0,13,90,45);dust(c,45,6,30,.025,'star');},
 skipall(c){arc(c,0,0,5,3,0,Math.PI*1.8,70,10);for(let i=0;i<3;i++){const a=i*Math.PI*2/3;streak(c,Math.cos(a)*5,Math.sin(a)*3,3,a*180/Math.PI+65,35+i*10);}sprite('rune',0,0,7,7,40,90,0,0,0,-1.8,c,100);dust(c,45,6,20,.015);},
 phoenix(c){for(let side of [-1,1]){for(let row=0;row<3;row++){arc(c,side*1.5,-1,side*(3.5+row*.9),3+row*.65,0,Math.PI*.83,52,15+row*7);for(let i=0;i<12;i++)sprite('feather',side*(1+i*.48),2.6-Math.pow(i/5,2),.6,2,28+i*2,115,side*.025,.018,side*(-35-i*3),side*.2,c,220);}}sprite('rune',0,0,8,8,12,150,0,0,0,.55,c,130);ring(c,0,0,7,60);dust(c,100,8,40,.06);},
 trick(c){for(let side of [-1,1]){arc(c,side*2,0,2.3,3.2,0,Math.PI*2,44,12);arc('#a39bff',side*2,.2,1,.7,0,Math.PI*2,25,30);}for(let i=0;i<24;i++)sprite('smoke',random()*10-5,random()*5-2.5,2,2,35+i,80,.035,0,0,.4,c,65);dust(c,50,5,25,.02,'star');},
 stealturn(c){sprite('rune',0,0,10,10,10,135,0,0,0,-1.1,c,160);streak(c,0,1,5,90,20);streak(c,1.2,0,3,0,20);arc(c,0,0,5.7,5.7,Math.PI*.15,Math.PI*1.8,65,40);dust(c,40,6,35,.01,'star');},
 curse(c){sprite('rune',0,0,9,9,12,130,0,0,0,-.45,c,160);for(let i=0;i<3;i++)arc(c,0,0,2+i,3+i,0,Math.PI*2,32,25+i*7);for(let i=0;i<20;i++)sprite('smoke',random()*7-3.5,random()*6-3,2,3,25+i,100,0,.02,random()*180,.3,c,80);dust(c,45,5,35,.02);},
 ghost(c){for(let i=0;i<30;i++)sprite('feather',random()*8-4,random()*5-2.5,.55,2,12+i*1.6,105,.008,.04,random()*40-20,.2,c,110);arc(c,0,0,3.8,5,0,Math.PI*2,70,20);for(let i=0;i<15;i++)sprite('smoke',random()*6-3,-3,2.5,3,25+i*2,100,0,.05,0,0,c,55);},
 alvin(c){for(let x of [-2,-.7,.7,2])sprite('ember',x,x===-2||x===2?1.3:2.3,1.3,1.6,10,80,0,0,0,0,c);sprite('ember',0,-.1,3,2.5,12,85,0,0,0,0,c);for(let i=0;i<3;i++)streak(c,-1+i,0,7,65,48+i*3);dust(c,75,4,50,.045);ring(c,0,0,5,45);},
 dice(c){for(const side of [-1,1]){const cx=side*3.2;for(let i=0;i<6;i++){const a=i*Math.PI/3+side*.4;sprite('coin',cx+Math.cos(a)*1.1,Math.sin(a)*1.1,.75,.75,10+i*3+side+2,95,side*.012,.03,random()*180,.35,c);}ring(c,cx,0,2.6,26+side*4);}for(let i=0;i<16;i++)sprite('star',random()*11-5.5,-4+random()*1.4,.35,.35,30+i*2,55,0,.05,0,1.2,c,190);dust(c,50,5.5,35,.035,'star');},
 rps(c){const marks=[[-3.6,0],[0,2.6],[3.6,0]];for(let i=0;i<3;i++){const [mx,my]=marks[i];sprite('rune',mx,my,2.6,2.6,8+i*7,105,0,0,0,(i-1)*.5,c,170);for(let j=0;j<7;j++){const a=j*Math.PI*2/7+i;streak(c,mx+Math.cos(a)*1.6,my+Math.sin(a)*1.6,2.2,a*180/Math.PI,22+i*5+j*.5);}}ring(c,0,.8,4.2,40);dust(c,55,5.5,30,.03,'star');},
 betrayal(c){for(const side of [-1,1]){sprite('rune',side*3.4,0,3,3.4,10,120,0,0,0,side*.35,c,165);arc(c,side*3.4,0,3.6,4,side>0?-Math.PI*.6:Math.PI*.4,side>0?Math.PI*.6:Math.PI*1.6,44,18);}for(let i=0;i<24;i++)sprite('smoke',(random()-.5)*1.5,-4.5+random()*9,1.4,2.2,16+i*1.6,95,0,.015,random()*180,.25,c,70);streak('#ffffff',0,0,15,90,34);dust(c,45,5.5,45,.02);},
 speed(c){streak(c,0,0,24,90,8);streak('#ffffff',0,0,15,90,14);for(let i=0;i<26;i++){const side=i%2?-1:1,spread=2+random()*7;streak(c,side*spread,(random()-.5)*9,2.5+random()*3.5,0,18+i*1.1);}for(let i=0;i<18;i++)sprite('star',(random()-.5)*13,(random()-.5)*9,.3+.3*random(),.3+.3*random(),24+i*1.5,60,0,.02,0,1.5,c,200);dust(c,60,6,28,.05,'star');},
 wheel(c){for(let i=0;i<9;i++){const a0=i*Math.PI*2/9+.06,a1=(i+1)*Math.PI*2/9-.06;arc(c,0,0,6.2,6.2,a0,a1,10,10+i*1.8);const am=(a0+a1)/2;sprite('coin',Math.cos(am)*4.4,Math.sin(am)*4.4,.55,.55,16+i*2.6,85,0,0,0,0,c);}sprite('rune',0,0,3,3,6,130,0,0,0,-.25,c,175);streak(c,Math.cos(-Math.PI/2)*3.1,Math.sin(-Math.PI/2)*3.1,5.6,-90+22,72);ring(c,0,0,7,30);dust(c,60,6,45,.03,'star');},
 linkedfate(c){const ends=[-4.4,4.4];for(const ex of ends){sprite('rune',ex,0,2.6,2.6,8,125,0,0,0,.4,c,170);ring(c,ex,0,2.1,20);}for(let i=0;i<8;i++){const t=i/7,x=ends[0]+(ends[1]-ends[0])*t,y=Math.sin(t*Math.PI)*1.7;sprite('coin',x,y,.6,.6,18+i*3,90,0,.008,0,1,c);if(i<7){const t2=(i+.5)/7,x2=ends[0]+(ends[1]-ends[0])*t2,y2=Math.sin(t2*Math.PI)*1.7;streak(c,x2,y2,1.7,Math.atan2(Math.sin((i+1)/7*Math.PI)*1.7-y,((ends[1]-ends[0])/7))*180/Math.PI,20+i*3);}}trace(c,Array.from({length:30},(_,i)=>{const t=i/29;return [ends[0]+(ends[1]-ends[0])*t,Math.sin(t*Math.PI)*1.7];}),44,'star',.26);dust(c,50,5.5,40,.025,'star');},
 impostor(c){for(let i=0;i<5;i++){const x=-4.6+i*2.3;if(i===2){for(let j=0;j<9;j++)sprite('smoke',x+(random()-.5)*1.4,(random()-.5)*2,1.5,1.9,14+j*2.2,95,0,.02,random()*180,.2,c,60);sprite('rune',x,0,1.7,2,26,100,0,0,0,-.3,c,90);}else{sprite('star',x,0,.85,.85,10+i*3.4,75,0,0,0,0,c,185);ring(c,x,0,1.4,18+i*2);}}streak('#ffffff',0,0,14,90,78);dust(c,45,5.5,50,.015);dust(c,40,5.5,60,.015,'star');},
 swapper(c){for(const side of [-1,1]){const pts=Array.from({length:30},(_,i)=>{const t=i/29;return [side*(4.6-9.2*t),Math.sin(t*Math.PI)*2.4*(side>0?1:-1)];});trace(c,pts,14,'star',.3);sprite('rune',side*4.6,0,2.5,2.9,8,95,0,0,0,side*.4,c,160);sprite('rune',-side*4.6,0,2.5,2.9,34,90,0,0,0,-side*.4,c,120);}ring(c,0,1.2,3,38);ring(c,0,-1.2,3,44);dust(c,55,5.5,26,.035,'star');}
};
const manifest={runtime:'Effekseer 1.80.7',authoring:'Original PHOENIX procedural sprite compositions; no sample effect binaries',effects:[]};
for(const [id,build] of Object.entries(builders)){nodes=[];seed=17+id.length;build(palettes[id]);const source=`<?xml version="1.0" encoding="utf-8"?><EffekseerProject><Root><Name>PHOENIX ${id}</Name><Children>${nodes.join('')}</Children></Root><ToolVersion>1.43</ToolVersion><Version>3</Version><StartFrame>0</StartFrame><EndFrame>300</EndFrame><IsLoop>False</IsLoop></EffekseerProject>`;
 // Resource references are relative to the binary. Author next to textures,
 // export, then retain the editable project under source/ with adjusted paths.
 const input=path.join(out,id+'.efkproj'),binary=path.join(out,id+'.efk');
 // Proven shipped binaries are never recompiled; only missing ones are built.
 if(fs.existsSync(binary)&&process.env.FORCE_REBUILD!=='1'){console.log(id+': existing binary kept ('+fs.statSync(binary).size+' bytes)');}
 else{fs.writeFileSync(input,source);
 const result=cp.spawnSync(editor,['-cui','-in',input,'-e',binary],{cwd:path.dirname(editor),timeout:30000,encoding:'utf8'});
 if(result.error||result.status!==0||!fs.existsSync(binary))throw Error(id+': '+(result.error||result.stderr||result.stdout));
 fs.unlinkSync(input);}
 fs.writeFileSync(path.join(out,'source',id+'.efkproj'),source.replaceAll('textures/','../textures/'));
 const data=fs.readFileSync(binary);manifest.effects.push({id,url:'assets/card-cinematics/'+id+'.efk',nodes:nodes.length,maxParticles:nodes.length,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});console.log(id+': '+nodes.length+' bounded particles, '+data.length+' bytes');
}
manifest.textures=fs.readdirSync(path.join(out,'textures')).map(name=>{const data=fs.readFileSync(path.join(out,'textures',name));return {url:'assets/card-cinematics/textures/'+name,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};});
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
