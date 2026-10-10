/* Build only the Phoenix experiment's media. Requires local ffmpeg, no runtime
 * dependency. Public CC0 sources; downloaded originals stay in approved temp.
 * Source pages/licensing evidence: assets/phoenix/LICENSES.md.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', 'assets', 'phoenix');
const temp = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'phoenix-fire-sources');
const sources = {
  'flame.mov': 'https://archive.org/download/fire-footage-300-fps/' + encodeURIComponent("Jolon's Fire Stock Footage/Individual Explosions/L-R Fire Explosion00001.mov"),
  'fire.mp3': 'https://cdn.freesound.org/previews/508/508110_6657854-hq.mp3'
};
function ffmpeg(args) { execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y',...args], {stdio:'inherit'}); }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function main() {
  fs.mkdirSync(root,{recursive:true}); fs.mkdirSync(temp,{recursive:true});
  for(const [name,url] of Object.entries(sources)) {
    const file=path.join(temp,name);
    if(!fs.existsSync(file)) { const response=await fetch(url); if(!response.ok)throw Error('Download '+response.status); fs.writeFileSync(file,Buffer.from(await response.arrayBuffer())); }
  }
  const footage=path.join(temp,'flame.mov'), fire=path.join(temp,'fire.mp3');
  ffmpeg(['-i',footage,'-an','-vf','scale=960:540,fps=24','-c:v','libx264','-preset','slow','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,'fire-surge.mp4')]);
  ffmpeg(['-ss','1.25','-i',footage,'-frames:v','1','-vf','scale=960:540','-q:v','3',path.join(root,'fire-poster.jpg')]);
  // Original pressure/noise layer: no melody and no sampled third-party impact.
  const rate=44100, length=Math.ceil(rate*4.4), pressure=Buffer.alloc(length*4);
  let seed=173, low=0, phase=0;
  for(let i=0;i<length;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const t=i/rate, n=seed/2147483648-1; low+=.035*(n-low);
    const hit=Math.max(0,t-1.15), env=t>1.15?Math.min(1,hit/.08)*Math.exp(-hit*3.8):0;
    phase+=(72-35*Math.min(1,hit/.8))/rate;
    const swell=Math.pow(Math.sin(Math.PI*Math.min(1,t/4.4)),1.2);
    pressure.writeFloatLE((low*.65*swell+Math.sin(phase*Math.PI*2)*.19*env),i*4);
  }
  const rawPressure=path.join(temp,'pressure.f32'), mixed=path.join(temp,'mixed.f32'), staged=path.join(temp,'staged.f32');
  fs.writeFileSync(rawPressure,pressure);
  const filter='[0:a]asplit=3[a][b][c];'+
    '[a]atrim=start=5:end=9.4,asetpts=PTS-STARTPTS,highpass=f=60,lowpass=f=6500,volume=1.1,afade=t=in:d=0.4,afade=t=out:st=3.4:d=1[a1];'+
    '[b]atrim=start=11:end=18,asetpts=PTS-STARTPTS,asetrate=29400,aresample=44100,atrim=duration=4.4,lowpass=f=850,volume=1.9,afade=t=in:d=1.1,afade=t=out:st=3.1:d=1.3[b1];'+
    '[c]atrim=start=18:end=22.4,asetpts=PTS-STARTPTS,areverse,highpass=f=250,lowpass=f=3500,volume=0.7,afade=t=in:d=1.1,afade=t=out:st=1.3:d=1.8[c1];'+
    '[a1][b1][c1][1:a]amix=inputs=4:normalize=0,atrim=duration=4.4,afade=t=out:st=3.9:d=0.5,aecho=0.8:0.85:75|160:0.10|0.06[out]';
  ffmpeg(['-i',fire,'-f','f32le','-ar',String(rate),'-ac','1','-i',rawPressure,'-filter_complex',filter,'-map','[out]','-ar',String(rate),'-ac','1','-f','f32le',mixed]);
  const pcm=fs.readFileSync(mixed); let peak=0, energy=0;
  for(let i=0;i<pcm.length;i+=4){const x=pcm.readFloatLE(i);peak=Math.max(peak,Math.abs(x));energy+=x*x;}
  const rms=Math.sqrt(energy/(pcm.length/4)), gain=Math.min(.68/peak,.13/rms);
  for(let i=0;i<pcm.length;i+=4)pcm.writeFloatLE(pcm.readFloatLE(i)*gain,i);
  fs.writeFileSync(staged,pcm);
  ffmpeg(['-f','f32le','-ar',String(rate),'-ac','1','-i',staged,'-c:a','libmp3lame','-b:a','160k',path.join(root,'fire-roar.mp3')]);
  const manifest={sources:Object.entries(sources).map(([name,url])=>({name,url,sha256:hash(path.join(temp,name))})),
    derivatives:['fire-surge.mp4','fire-poster.jpg','fire-roar.mp3'].map(name=>({name,bytes:fs.statSync(path.join(root,name)).size,sha256:hash(path.join(root,name))})),
    mix:{sampleRate:rate,stagedPeak:peak*gain,stagedRms:rms*gain}};
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
