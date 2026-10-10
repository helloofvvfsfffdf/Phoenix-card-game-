(function () {
  'use strict';
  // Ally selection display. Gameplay abilities are handled separately by the game/server.
  var roster = [
    {id:'phoenix',name:'PHOENIX',title:'Sneaky Snatcher',desc:'Once per round, attempts to steal a random card from an opponent. Defenders may block her.',color:'#ffc642'},
    {id:'tilly',name:'TILLY',title:'Trouble Maker',desc:'50% chance each round to eliminate an opponent for one round. Protective Paws: 40% chance to block Phoenix.',color:'#b97aff'},
    {id:'ted',name:'TED',title:'Slobbery Surprise',desc:'50% chance each round to disguise an opponent’s cards for 3 rounds. Protective Howl: 60% chance to stop Phoenix stealing from Ted’s owner.',color:'#8fc9ff'},
    {id:'louie',name:'LOUIE',title:'Puppet Master',desc:'40% chance to choose a card on an opponent’s next turn. Quick Reflexes: 80% chance to block Phoenix.',color:'#47aaff'},
    {id:'simba',name:'SIMBA',title:'Card Sabotage',desc:'Blocks one random card in a chosen opponent’s hand for one round. Sharp Claws: 60% chance to block Phoenix.',color:'#ff9e43'},
    {id:'elsie',name:'ELSIE',title:'Untouchable',desc:'Blocks Phoenix 100%, Louie 70%, and Maple 20% of the time. Cannot block Tilly or Simba.',color:'#ff80b4'}
  ];
  var maple = {id:'maple',name:'MAPLE',title:'Sweet Tooth',desc:'Independent: 40% chance each round to force a random player to use only nice cards for 3 rounds.',color:'#42d6a0',src:'assets/allies/maple.jpg'};
  roster.forEach(function (a) { a.src = 'assets/allies/' + a.id + '.jpg'; });
  var current = 'phoenix', mode = 'multi';
  function $(id) { return document.getElementById(id); }
  function selected() { return roster.find(function (a) { return a.id === current; }) || roster[0]; }
  function render() {
    var root = $('ally-grid');
    if (!root) return;
    root.replaceChildren();
    roster.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ally-card' + (a.id === current ? ' selected' : '');
      b.style.setProperty('--ally-color', a.color);
      b.setAttribute('aria-pressed', String(a.id === current));
      var img = document.createElement('img');
      img.src = a.src;
      img.alt = a.name + ' portrait';
      b.appendChild(img);
      var content = document.createElement('div');
      content.className = 'ally-card-info';
      var name = document.createElement('strong'); name.textContent = a.name;
      var title = document.createElement('em'); title.textContent = a.title;
      var desc = document.createElement('small'); desc.textContent = a.desc;
      content.append(name, title, desc);
      b.appendChild(content);
      b.onclick = function () { current = a.id; render(); };
      root.appendChild(b);
    });
    $('ally-selection').textContent = 'SELECTED: ' + selected().name + ' — ' + selected().title;
    $('ally-confirm').disabled = false;
  }
  function open(m) { mode = m; $('phoenix-menu').hidden = true; $('ally-picker').hidden = false; $('ally-feedback').textContent = ''; render(); }
  function close() { $('ally-picker').hidden = true; $('phoenix-menu').hidden = false; }
  function random() { return roster[Math.floor(Math.random() * roster.length)]; }
  document.addEventListener('DOMContentLoaded', function () {
    $('ally-back').onclick = close;
    $('ally-confirm').onclick = function () {
      try { sessionStorage.setItem('phoenix-ally', current); } catch (e) {}
      close();
      document.dispatchEvent(new CustomEvent('phoenix-ally-confirmed', {detail:{mode:mode,ally:selected()}}));
    };
    try { var saved = sessionStorage.getItem('phoenix-ally'); if (roster.some(function (a) { return a.id === saved; })) current = saved; } catch (e) {}
  });
  window.PhoenixAllies = {open:open, selected:selected, random:random, roster:roster, maple:maple};
})();
