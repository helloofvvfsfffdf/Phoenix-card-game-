'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),Showcase=require('../js/match-showcase');
function packet(roll,stream){return {code:'ROOM',effects:{stream:stream||'match'},dice:{lastRoll:roll}};}
module.exports=function(test,equal,deepEqual,assert){
  test('dice animation lands on server-confirmed value and discards unrelated fields',function(){const cursor=Showcase.diceCursor();equal(cursor.consume(packet(null)),null);deepEqual(cursor.consume(packet({id:1,seat:2,value:6,phase:'turnDice',hand:['secret'],name:'private'})),{id:1,seat:2,value:6,phase:'turnDice'});});
  test('dice baseline, repeated packets, stale rolls and reconnect do not replay',function(){const c=Showcase.diceCursor(),roll={id:4,seat:0,value:3,phase:'allyDice'};equal(c.consume(packet(roll)),null);equal(c.consume(packet(roll)),null);equal(c.consume(packet({...roll,id:3})),null);assert(c.consume(packet({...roll,id:5})));c.reset();equal(c.consume(packet({...roll,id:5})),null);equal(c.consume(packet({...roll,id:6},'other-match')),null);});
  test('tie rerolls with the same number remain distinct confirmed animations',function(){const c=Showcase.diceCursor();c.consume(packet(null));assert(c.consume(packet({id:1,seat:0,value:6,phase:'turnDice'})));assert(c.consume(packet({id:2,seat:0,value:6,phase:'turnDice'})));});
  test('invalid die values, seats, phases and IDs never animate',function(){for(const roll of [{id:1,seat:0,value:7,phase:'turnDice'},{id:1,seat:0,value:0,phase:'turnDice'},{id:1,seat:5,value:1,phase:'turnDice'},{id:1,seat:0,value:1,phase:'playing'},{id:1.5,seat:0,value:1,phase:'turnDice'}]){const c=Showcase.diceCursor();c.consume(packet(null));equal(c.consume(packet(roll)),null);}});
  test('all six physical die faces have correct pips and face-specific landing rotations',function(){for(let n=1;n<=6;n++){equal(Showcase.pips[n].length,n);assert(Showcase.pips[n].every(i=>i>=0&&i<9));equal(new Set(Showcase.pips[n]).size,n);assert(Showcase.rotations[n]);}deepEqual(Showcase.rotations[2],{x:0,y:-90});deepEqual(Showcase.rotations[6],{x:0,y:180});});
  test('the real server retains final dice values through phase changes and tie resets',function(){const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),begin=source.indexOf('function beginRollStage('),end=source.indexOf('function applyPhoenix(',begin);let values=[6,1];const context={rollDie:()=>values.shift(),addLog:function(){}};vm.runInNewContext(source.slice(begin,end),context);const room={members:[{name:'Alice'},{name:'Bob'}]};context.beginRollStage(room,'turnDice');assert(context.diceRoll(room,room.members[0]));assert(context.diceRoll(room,room.members[1]));equal(room.phase,'allyDice');equal(Object.keys(room.dice.rolls).length,0);equal(room.lastDiceRoll.value,1);equal(room.lastDiceRoll.phase,'turnDice');equal(room.lastDiceRoll.id,2);
    values=[6,6];const tie={members:room.members};context.beginRollStage(tie,'turnDice');context.diceRoll(tie,tie.members[0]);context.diceRoll(tie,tie.members[1]);equal(Object.keys(tie.dice.rolls).length,0);equal(tie.lastDiceRoll.value,6);equal(tie.lastDiceRoll.id,2);deepEqual(Object.keys(tie.lastDiceRoll).sort(),['id','phase','seat','value']);});
  test('match seats use ally text and actual catalog descriptions, not portrait images',function(){const b=require('./match-audio-tests').online();b.loadScript('allies.js');b.receive('playing',false,{players:[{id:'human',name:'Player 1',ally:'phoenix',points:20000,handCount:2}],current:'human',acting:false});const seat=b.nodes['online-seats'].children[0],meta=seat.children.find(n=>n.className==='online-seat-meta');assert(!seat.children.some(n=>n.className==='online-portrait'));assert(meta.children.some(n=>n.textContent==='Ally: Phoenix'));const ally=b.context.PhoenixAllies.roster.find(a=>a.id==='phoenix');assert(meta.children.some(n=>n.textContent===ally.desc));assert(meta.children.some(n=>n.textContent===ally.title));});
  test('ally drafting still presents pictures and descriptions for every selectable ally',function(){const b=require('./match-audio-tests').online();b.loadScript('allies.js');b.receive('draft',false,{draftTurn:0,availableAllies:['phoenix','tilly']});const grid=b.nodes['online-actions'].children.find(n=>n.className==='online-draft-grid');equal(grid.children.length,2);grid.children.forEach(n=>{assert(n.children.some(c=>c.className==='online-portrait'));assert(n.children.some(c=>c.className==='online-draft-desc'&&c.textContent.length>0));});});
  test('showcase rendering contains no sound, RNG, move sender or hidden hand inspection',function(){const source=fs.readFileSync(path.join(__dirname,'../js/match-showcase.js'),'utf8');assert(!/Math\.random|randomInt|new Audio|AudioContext|WebSocket|\.send\(|cursedCard|shownToMe/.test(source));assert(source.includes(".card[data-card]"));assert(source.includes('stopDie();killTransitions()'));});
  test('PUBLIC online play drafts random emoji + animal names and never a portrait or real name',function(){
    const b=require('./match-audio-tests').online();b.loadScript('allies.js');
    const map={phoenix:{name:'Falcon',emoji:'\u{1F98A}'},tilly:{name:'Otter',emoji:'\u{1F9A6}'},maple:{name:'Wren',emoji:'\u{1F985}'}};
    b.receive('draft',false,{draftTurn:0,availableAllies:['phoenix','tilly'],publicAllies:map});
    const grid=b.nodes['online-actions'].children.find(n=>n.className==='online-draft-grid');
    equal(grid.children.length,2);
    grid.children.forEach(n=>{
      assert(!n.children.some(c=>c.className==='online-portrait'),'no portrait image in a public draft');
      assert(n.children.some(c=>c.className==='online-portrait online-ally-emoji'),'an emoji tile is shown');
      assert(n.children.some(c=>c.className==='online-draft-desc'&&c.textContent.length>0),'the ability text is kept');
      assert(!n.children.some(c=>/Phoenix|Tilly|\bTed\b|Louie|Simba|Elsie|Maple/.test(c.textContent||'')),'no catalogue ally name in a public tile');
    });
    assert(grid.children.some(n=>n.children.some(c=>c.textContent==='Falcon')),'the public name is shown');
    assert(grid.children.some(n=>n.children.some(c=>c.textContent==='Otter')),'the public name is shown');
  });
  test('PUBLIC online seats show the randomised public name and never the catalogue names',function(){
    const b=require('./match-audio-tests').online();b.loadScript('allies.js');
    b.receive('playing',false,{players:[{id:'human',name:'Player 1',ally:'elsie',points:20000,handCount:2}],current:'human',acting:false,
      publicAllies:{elsie:{name:'Cobra',emoji:'\u{1F40D}'},phoenix:{name:'Falcon',emoji:'\u{1F98A}'},tilly:{name:'Otter',emoji:'\u{1F9A6}'},louie:{name:'Jaguar',emoji:'\u{1F406}'},simba:{name:'Viper',emoji:'\u{1F40D}'},maple:{name:'Wren',emoji:'\u{1F985}'},ted:{name:'Raven',emoji:'\u{1F99C}'}}});
    const seat=b.nodes['online-seats'].children[0],meta=seat.children.find(n=>n.className==='online-seat-meta');
    assert(meta.children.some(c=>c.textContent==='Ally: Cobra'),'the public name is shown in the seat');
    assert(!meta.children.some(c=>/Phoenix|Tilly|Louie|Simba|Elsie|Maple|\bTed\b/.test(c.textContent||'')),'no catalogue name in the public seat');
  });
  test('match seats render each player\'s verified badges and nothing for anyone else',function(){
    const b=require('./match-audio-tests').online();
    b.loadScript('allies.js');
    b.loadScript('badge-client.js');
    b.receive('playing',false,{players:[
      {id:'human',name:'Owner',ally:'phoenix',points:20000,handCount:2,connected:true,
       badges:[{key:'phoenix',name:'THE PHOENIX',rarity:'divine'}]},
      {id:'p2',name:'Alice',ally:'tilly',points:0,handCount:5,connected:true,badges:[]}
    ],current:'human',acting:false});
    const meta=index=>b.nodes['online-seats'].children[index].children.find(n=>n.className==='online-seat-meta');
    const group=meta(0).children.find(n=>n.className==='badge-chips');
    assert(group,'the seat that holds a badge carries one');
    assert(!meta(1).children.some(n=>n.className==='badge-chips'),'a seat with no badges shows none at all');
    equal(group.children.length,1,'one chip per badge actually held');
    const chip=group.children[0];
    equal(chip.className,'badge-chip badge--divine','the top tier keeps its own styling');
    equal(chip.getAttribute('data-rarity'),'divine');
    equal(chip.children.find(n=>n.className==='badge-chip-name').textContent,'THE PHOENIX','the catalogue name, never typed text');
    equal(chip.children.find(n=>n.className==='badge-chip-rarity').textContent,'DIVINE');
    equal(chip.children.find(n=>n.className==='badge-chip-mark').textContent,'\uD83D\uDC51','the crown');
  });
  test('a badge with a picture shows it in the seat, and one without gets no empty frame',function(){
    const b=require('./match-audio-tests').online();
    b.loadScript('allies.js');
    b.loadScript('badge-client.js');
    b.receive('playing',false,{players:[
      {id:'human',name:'Alice',ally:'phoenix',points:0,handCount:2,connected:true,
       badges:[{key:'champion',name:'MATCH WINNER',rarity:'common',icon:'assets/phoenix-badge.jpg'}]},
      {id:'p2',name:'Bob',ally:'tilly',points:0,handCount:2,connected:true,
       badges:[{key:'played-with-owner',name:'PLAYED WITH OWNER',rarity:'legendary'}]}
    ],current:'human',acting:false});
    const chip=i=>b.nodes['online-seats'].children[i]
      .children.find(n=>n.className==='online-seat-meta')
      .children.find(n=>n.className==='badge-chips').children[0];
    const pic=chip(0).children.find(n=>n.className==='badge-chip-icon');
    assert(pic,'the badge carries the picture the catalogue named');
    equal(pic.src,'assets/phoenix-badge.jpg','a plain file inside assets/, exactly as the server sent it');
    equal(pic.alt,'','the name sits beside it, so a screen reader is not told it twice');
    assert(!chip(1).children.some(n=>n.className==='badge-chip-icon'),
      'a badge with no picture of its own gets no empty frame');
  });
  test('a malformed badge list from a snapshot degrades to no badges instead of breaking the seat',function(){
    const b=require('./match-audio-tests').online();
    b.loadScript('allies.js');
    b.loadScript('badge-client.js');
    b.receive('playing',false,{players:[
      {id:'human',name:'Player',ally:'phoenix',points:0,handCount:2,connected:true,badges:'not-an-array'},
      {id:'p2',name:'Alice',ally:'tilly',points:0,handCount:5,connected:true,badges:[null,'x',{rarity:'divine'}]}
    ],current:'human',acting:false});
    const meta=index=>b.nodes['online-seats'].children[index].children.find(n=>n.className==='online-seat-meta');
    assert(!meta(0).children.some(n=>n.className==='badge-chips'),'a non-array is simply not shown');
    const partial=meta(1).children.find(n=>n.className==='badge-chips');
    assert(partial,'unusable entries are skipped, usable ones still render');
    assert(partial.children.every(n=>typeof n.className==='string'&&n.className.indexOf('badge-chip')===0),'only chips reach the seat');
  });
  /* ---- the owner-only AWARD panel ----------------------------------------
   * `test()` is synchronous, so the badge screen is driven by a thenable that
   * resolves inline - the same chain shape fetch gives it, minus the waiting.
   */
  function awardHarness(box) {
    const b = require('./match-audio-tests').online();
    b.loadScript('badge-client.js');
    // load() refuses to fetch at all when no account module is present.
    b.context.PhoenixAccount = { available: function () { return true; } };
    const resolve = function (value) {
      if (value && typeof value.then === 'function' && value.__sync) return value;
      return {
        __sync: true,
        then: function (fn) { return resolve(fn(value)); },
        catch: function () { return resolve(value); }
      };
    };
    b.context.fetch = function () {
      return resolve({ json: function () { return resolve(box.payload); } });
    };
    b.reload = function () { b.context.PhoenixBadges.reload(); return b; };
    return b;
  }

  const AWARDABLE = [{ key: 'played-with-owner', name: 'PLAYED WITH OWNER',
    rarity: 'legendary', description: 'Played a match with the owner of PHOENIX.' }];
  const OWNER_VIEW = { ok: true, available: true, isOwner: true, maxFeatured: 3,
    catalogue: AWARDABLE, owned: [], featured: [null, null, null], awardable: AWARDABLE };
  const PLAYER_VIEW = Object.assign({}, OWNER_VIEW, { isOwner: false, awardable: [] });

  test('the award panel opens for a server-confirmed owner and for nobody else', function () {
    const box = { payload: OWNER_VIEW };
    const b = awardHarness(box);

    // The first load is what materialises the panel, so it is read back after.
    b.reload();
    const panel = b.nodes['badge-award-panel'];
    equal(panel.hidden, false, 'the owner is offered the panel');

    // Its wording comes from the CATALOGUE row the server sent, never from
    // anything a user could have typed.
    const note = b.nodes['badge-award-note'];
    equal(note.children[0].textContent, 'PLAYED WITH OWNER');
    assert(note.children.some(function (n) {
      return /Played a match with the owner/.test(n.textContent || '');
    }), 'the server description is shown');

    box.payload = PLAYER_VIEW;
    b.reload();
    equal(panel.hidden, true, 'a player is never offered it');

    // Belt and braces: even a response that listed a badge by mistake stays
    // shut, because the ROLE is what opens this panel, not the badge list.
    box.payload = Object.assign({}, PLAYER_VIEW, { awardable: AWARDABLE });
    b.reload();
    equal(panel.hidden, true, 'isOwner alone decides, not the badge list');
  });

  test('the collection shows a badge picture only when the catalogue gave the badge one', function () {
    var CHAMPION = { key: 'champion', name: 'MATCH WINNER', rarity: 'common',
      description: 'Won a match of PHOENIX.', icon: 'assets/phoenix-badge.jpg' };
    var PLAYED = { key: 'played-with-owner', name: 'PLAYED WITH OWNER', rarity: 'legendary',
      description: 'Played a match with the owner of PHOENIX.' };

    var box = { payload: Object.assign({}, PLAYER_VIEW, {
      catalogue: [CHAMPION, PLAYED], owned: [CHAMPION, PLAYED]
    }) };
    var b = awardHarness(box);
    b.reload();

    var grid = b.nodes['badge-collection'];
    equal(grid.children.length, 2, 'both owned badges are shown');

    var pic = grid.children[0].children.find(function (n) {
      return n.className === 'badge-tile-icon';
    });
    assert(pic, 'the win badge shows its picture');
    equal(pic.src, 'assets/phoenix-badge.jpg', 'the path the server named, verbatim');
    equal(pic.alt, '', 'the badge name is printed right underneath it');
    assert(!grid.children[1].children.some(function (n) {
      return n.className === 'badge-tile-icon';
    }), 'a badge with no picture of its own keeps its plain tile');
  });
};
