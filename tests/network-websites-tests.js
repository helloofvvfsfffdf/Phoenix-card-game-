'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),D=require('../js/network-data');
const routes=['definitely-not-nvidia.html','phoenix-news.html','definitely-not-microsoft.html','foogle-weather.html','definitely-not-wikipedia.html','definitely-not-reddit.html','definitely-not-apple.html','phoenix-technologies.html','definitely-not-steam.html'];
function test(name,fn){try{fn();console.log('PASS',name);}catch(e){console.error('FAIL',name,e.message);process.exitCode=1;}}
test('all nine fictional website routes exist',()=>routes.forEach(route=>assert(fs.existsSync(path.join(__dirname,'..',route)),route)));
test('catalogues contain the requested fictional products and games',()=>{assert(D.gpus.length===5);assert(D.games.length>=6);assert(D.articles.length>=5);assert(D.posts.length>=5);});
test('network data has nine distinct site identities',()=>{assert.strictEqual(Object.keys(D.sites).length,9);assert.strictEqual(new Set(Object.values(D.sites).map(s=>s.theme)).size,9);});
test('all page shells load the shared interactive engine and parody footer',()=>routes.forEach(route=>{const html=fs.readFileSync(path.join(__dirname,'..',route),'utf8');assert(html.includes('network-client.js'));assert(html.toLowerCase().includes('fictional'));}));
