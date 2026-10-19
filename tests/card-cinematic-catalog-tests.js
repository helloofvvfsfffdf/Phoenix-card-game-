'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),Cards=require('../js/cards'),Catalog=require('../js/card-cinematic-catalog');
module.exports=function(test,equal,deepEqual,assert){
  const manifest=require('../assets/card-cinematics/manifest.json'),root=path.resolve(__dirname,'..');
  // Cards whose COMPILED particle binary is still to be built.
  //
  // Every card in the catalogue is expected to ship a compiled .efk, and the
  // manifest and the catalogue must agree exactly - that is the guarantee that
  // no card is quietly missing its artwork. A card in this list is the one
  // documented exception: it IS in the catalogue, with an editable project and
  // a preview, but its binary has not been compiled because the Effekseer CLI
  // was not available on the machine that added it. Until it is compiled the
  // card uses the emblem treatment instead of the particle artwork.
  //
  // The list lives in the manifest, so the build script and this test can
  // never disagree about which cards are still waiting.
  //
  // To finish it: run scripts/build-card-cinematics.js on a machine with
  // Effekseer 1.80.7 - the manifest is rewritten and the card leaves the list.
  const AWAITING_COMPILATION=Array.isArray(manifest.awaitingCompilation)?manifest.awaitingCompilation:[];
  test('the preview covers exactly every real PHOENIX card, including the earned legendary card',function(){const liveIds=Cards.ids().filter(id=>{const c=Cards.byId(id);return !c||c.inLiveGame!==false;});liveIds.forEach(id=>assert(Object.prototype.hasOwnProperty.call(Catalog,id),id+' missing from catalog'));const catalogIds=Cards.ids().filter(id=>Object.prototype.hasOwnProperty.call(Catalog,id));const manifestIds=manifest.effects.map(e=>e.id).sort();const awaiting=AWAITING_COMPILATION.slice().sort();deepEqual(catalogIds.filter(id=>awaiting.indexOf(id)===-1).sort(),manifestIds);liveIds.forEach(id=>{if(awaiting.indexOf(id)!==-1)return;assert(manifest.effects.some(e=>e.id===id),id+' missing compiled binary');});});
  test('each card has its own bounded original Effekseer binary and editable project',function(){
    const catalogIds=Cards.ids().filter(id=>Object.prototype.hasOwnProperty.call(Catalog,id));
    const awaiting=AWAITING_COMPILATION;
    const compiled=manifest.effects.map(e=>e.id);
    equal(new Set(manifest.effects.map(e=>e.sha256)).size,compiled.length);
    manifest.effects.forEach(e=>{assert(e.maxParticles>0&&e.maxParticles<=512);assert(Catalog[e.id].duration<=5.4);const binary=fs.readFileSync(path.join(root,e.url));equal(binary.length,e.bytes);equal(crypto.createHash('sha256').update(binary).digest('hex'),e.sha256);assert(fs.existsSync(path.join(root,'assets/card-cinematics/source',e.id+'.efkproj')));});
    // A card awaiting compilation still has to be in the catalogue, with an
    // editable project on disk and an entry in the preview - only the COMPILED
    // binary is missing, and only because the Effekseer CLI was not available to
    // build it. Run scripts/build-card-cinematics.js on a machine with the CLI
    // to finish it.
    awaiting.forEach(id=>{assert(Object.prototype.hasOwnProperty.call(Catalog,id),id+' missing from catalog');assert(fs.existsSync(path.join(root,'assets/card-cinematics/source',id+'.efkproj')),id+' has no editable project');assert(compiled.indexOf(id)===-1,id+' must not be listed as compiled until it is');});
  });
  test('all original particle textures are bundled, hashed PNGs',function(){manifest.textures.forEach(e=>{const data=fs.readFileSync(path.join(root,e.url));equal(data.readUInt32BE(0),0x89504e47);equal(crypto.createHash('sha256').update(data).digest('hex'),e.sha256);});});
  test('the isolated gallery includes no sound, game controller, auth or multiplayer scripts',function(){const html=fs.readFileSync(path.join(root,'card-effects.html'),'utf8');assert(!/sound-design|effects-client|online-client|music\.js|game\.js|rules\.js|opening-cinematic/.test(html));const js=fs.readFileSync(path.join(root,'js/card-effects-gallery.js'),'utf8');assert(!/new Audio|AudioContext|WebSocket|\.playCard\(|\.resolvePendingChoice\(/.test(js));});
  test('card preview variants represent failure, reflection, hidden information and mandatory choices',function(){assert(Catalog.judge.variants.includes('Failed'));assert(Catalog.judge.variants.includes('No evil cards'));assert(Catalog.zombie.variants.includes('Reflected'));assert(Catalog.alvin.variants.includes('Reveal & choose'));assert(Catalog.alvin.variants.includes('Destroy chosen card'));assert(Catalog.curse.variants.includes('Trigger after play'));assert(Catalog.curse.caption.includes('SECRET'));assert(Catalog.knife.caption.includes('POINTS UNTOUCHED'));});
  test('website intro reuses the approved fire stage without invoking audio or a victory',function(){const source=fs.readFileSync(path.join(root,'js/opening-cinematic.js'),'utf8');assert(source.includes('PhoenixFireScene.start'));assert(source.includes('intro:true'));assert(source.includes("prefs.visuals==='off'"));assert(!/sound\(|AudioContext|PhoenixVictoryScene|WebSocket/.test(source));});
};
