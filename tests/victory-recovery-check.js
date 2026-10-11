'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../js/victory-scene'),'utf8');
function harness(){
  let now=0,serial=0,loads=[],canvases=[],contexts=[],released=0;
  const timers=new Map(),root={Promise,Date:{now:()=>now},setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  root.document={createElement:()=>{const events={},gl={getExtension:()=>null};const canvas={events,removed:false,getContext:()=>gl,addEventListener:(name,fn)=>events[name]=fn,remove:()=>{canvas.removed=true;}};canvases.push(canvas);return canvas;}};
  root.PhoenixParticleRuntime={prepare:()=>Promise.resolve()};
  root.effekseer={createContext:()=>{const context={init:()=>{},stopAll:()=>{},releaseEffect:()=>{},loadEffect:(url,scale,done,fail)=>{const effect={url};loads.push({done,fail,effect});return effect;}};contexts.push(context);return context;},releaseContext:()=>released++};
  vm.runInNewContext(source,root);
  return {api:root.PhoenixVictoryScene,loads,canvases,contexts,timers,flush:async()=>{for(let i=0;i<8;i++)await Promise.resolve();},succeed:()=>{loads.splice(0).forEach(l=>l.done());},released:()=>released,advance:ms=>now+=ms};
}
async function main(){
  const h=harness(),failed=h.api.prepare();await h.flush();h.loads[0].fail('temporary texture fetch failure','texture.png');h.loads[1].done();await assert.rejects(failed,/temporary texture/);await h.flush();
  assert(h.api.diagnostics().preparationError);assert.strictEqual(h.released(),1);assert.strictEqual(h.api.prepare(),failed,'cooldown coalesces failed prewarm, no snapshot retry storm');
  const recovered=h.api.prepare(true);assert.notStrictEqual(recovered,failed);h.loads.length=0;await h.flush();h.succeed();assert((await recovered).ready);assert.strictEqual(h.api.diagnostics().preparationError,null);
  h.canvases[1].events.webglcontextlost({preventDefault:()=>{}});assert.strictEqual(h.api.diagnostics().ready,false);const recreated=h.api.prepare();await h.flush();h.succeed();assert((await recreated).ready);assert.strictEqual(h.contexts.length,3);assert.strictEqual(h.released(),2);h.api.release();assert.strictEqual(h.released(),3);
  console.log('PASS failed prewarm cooldown, forced victory retry, lost-context recreation and resource disposal.');
  const t=harness(),timeout=t.api.prepare();await t.flush();const callback=[...t.timers.values()][0];callback();await assert.rejects(timeout,/timed out/);assert.strictEqual(t.api.diagnostics().ready,false);t.succeed();await t.flush();assert.strictEqual(t.api.diagnostics().ready,false,'late loads cannot resurrect a timed-out renderer');assert.strictEqual(t.released(),1);t.advance(5001);const retried=t.api.prepare();await t.flush();t.succeed();assert((await retried).ready);t.api.release();assert.strictEqual(t.timers.size,0);
  console.log('PASS timed-out loads cannot resurrect stale contexts; later prewarm recovers cleanly.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
