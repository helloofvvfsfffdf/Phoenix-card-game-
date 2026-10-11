'use strict';
var fs=require('fs'),path=require('path'),vm=require('vm'),Rules=require('../js/rules'),Maple=require('../js/maple');
function setup(card){
  var s=Rules.createGame({seed:42,fixedOrder:true,rotateStart:false,rounds:8});
  s.players.forEach(function(p,i){p.enabled=i<3;});s.turnInRound=0;
  s.hands[s.players[0].id]=[card];s.hands[s.players[1].id]=['knife','zombie'];s.hands[s.players[2].id]=['bonus'];
  var result=Rules.playCard(s,0,card,s.players[1].id);if(!result.ok)throw Error(result.error);
  var room={phase:'playing',state:s,code:'TEST',members:s.players.slice(0,3).map(function(p,i){return {seat:i,name:['Alice','Bob','Riley'][i],ally:['phoenix','ted','elsie'][i],ws:{}};}),mapleUntil:{0:99},log:[]};
  var source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  var begin=source.indexOf('function dueChoice(s)'),end=source.indexOf('// Skip turns when no legal moves are available.');
  var context={Rules:Rules,Maple:Maple,ALLIES:['phoenix','ted','elsie'],effectJournal:function(){return {stream:'test',sequence:0,events:[]};}};
  vm.runInNewContext(source.slice(begin,end),context);
  return {room:room,snapshot:context.snapshot,pending:context.dueChoice(s)};
}
module.exports=function(test,equal,deepEqual,assert){
  test('Maple cannot block an Alvin destruction choice or deadlock a newly restricted chooser',function(){
    var x=setup('alvin'),s=x.room.state;equal(x.pending.kind,'burn');
    var snap=x.snapshot(x.room,x.room.members[0]);assert(snap.acting);deepEqual(snap.mapleBlocked,[]);
    assert(snap.moves.some(function(m){return m.cardId==='knife';}));assert(snap.moves.some(function(m){return m.cardId==='zombie';}));
    var count=s.destroyed.length;var result=Rules.resolvePendingChoice(s,'knife',null);assert(result.ok);equal(s.destroyed.length,count+1);equal(s.destroyed[s.destroyed.length-1],'knife');
    assert(!Rules.isOut(s.players[1],s),'destroying the card does not play its attack');
  });
  test('stolen-turn options use Bob’s restriction, not unrelated restrictions on Alice the chooser',function(){
    var x=setup('stealturn');equal(x.pending.kind,'move');
    var snap=x.snapshot(x.room,x.room.members[0]);assert(snap.acting);deepEqual(snap.mapleBlocked,[]);assert(snap.moves.some(function(m){return m.cardId==='knife';}));
    equal(x.snapshot(x.room,x.room.members[1]).acting,false,'Bob must wait for the authorized chooser');
    x.room.mapleUntil={1:99};var restricted=x.snapshot(x.room,x.room.members[0]);assert(restricted.mapleBlocked.includes('knife'));assert(restricted.moves.every(function(m){return Maple.isNice(m.cardId);}));
    assert(Maple.blockedForAction(x.room,0,x.pending).includes('knife'));
  });
  test('actual client shows Alice’s required choice instead of incorrectly advertising Bob’s ordinary turn',function(){
    var b=require('./match-audio-tests').online();
    b.receive('playing',false,{players:[{id:'human',name:'Alice',points:0,handCount:1},{id:'guest',name:'Bob',points:0,handCount:2}],current:'guest',seat:1,acting:false,pending:{kind:'move',chooserId:'human',targetId:'guest'}});
    assert(b.nodes['online-phase'].textContent.includes('Alice is choosing Bob'));
    assert(b.nodes['online-actions'].children.some(function(n){return n.textContent.includes('Waiting for Alice');}));
    b.receive('playing',false,{players:[{id:'human',name:'Alice',points:0,handCount:1},{id:'guest',name:'Bob',points:0,handCount:2}],current:'guest',seat:0,acting:true,pending:{kind:'burn',chooserId:'human',targetId:'guest'},moves:[{cardId:'knife',targetId:null}],mapleBlocked:[]});
    assert(b.nodes['online-phase'].textContent.includes('Alice must choose a card for Alvin'));
    assert(b.nodes['online-actions'].children.some(function(n){return n.textContent.includes('Choose a card to destroy');}));
  });
};
