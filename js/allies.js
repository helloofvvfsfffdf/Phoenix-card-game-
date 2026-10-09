(function(){'use strict';
var roster=[
{id:'phoenix',name:'PHOENIX',title:'The Legendary Inferno',desc:'Small gecko. Enormous reputation.',color:'#ffc642'},
{id:'tilly',name:'TILLY',title:'The Chaos Queen',desc:'Steals shoes, steals food, and now steals victories.',color:'#b97aff'},
{id:'maple',name:'MAPLE',title:'The Fearless Shadow',desc:'Absolutely fearless. Probably thinks she owns the table.',color:'#42d6a0'},
{id:'louie',name:'LOUIE',title:'The Midnight Trickster',desc:'Master of mischief. Doors are merely suggestions.',color:'#47aaff'},
{id:'simba',name:'SIMBA',title:'The Ginger Phantom',desc:'Silent hunter. Will clean himself immediately after defeating you.',color:'#ff9e43'},
{id:'elsie',name:'ELSIE',title:'The Ancient Empress',desc:'Years of wisdom. Zero patience for foolish opponents.',color:'#ff80b4'}];
roster.forEach(function(a){a.src='assets/allies/'+a.id+'.jpg'});
var current='phoenix',mode='multi';
function $(id){return document.getElementById(id)}
function selected(){return roster.find(function(a){return a.id===current})}
function render(){var root=$('ally-grid');root.replaceChildren();roster.forEach(function(a){var b=document.createElement('button');b.type='button';b.className='ally-card'+(a.id===current?' selected':'');b.style.setProperty('--ally-color',a.color);b.setAttribute('aria-pressed',String(a.id===current));var img=document.createElement('img');img.src=a.src;img.alt=a.name+' portrait';b.appendChild(img);var content=document.createElement('div');content.className='ally-card-info';var name=document.createElement('strong');name.textContent=a.name;var title=document.createElement('em');title.textContent=a.title;var desc=document.createElement('small');desc.textContent=a.desc;content.append(name,title,desc);b.appendChild(content);b.onclick=function(){current=a.id;render()};root.appendChild(b)});$('ally-selection').textContent='SELECTED: '+selected().name+' — '+selected().title;$('ally-confirm').disabled=false}
function open(m){mode=m;$('phoenix-menu').hidden=true;$('ally-picker').hidden=false;$('ally-feedback').textContent='';render()}
function close(){$('ally-picker').hidden=true;$('phoenix-menu').hidden=false}
function random(){return roster[Math.floor(Math.random()*roster.length)]}
document.addEventListener('DOMContentLoaded',function(){$('ally-back').onclick=close;$('ally-confirm').onclick=function(){try{sessionStorage.setItem('phoenix-ally',current)}catch(e){}close();document.dispatchEvent(new CustomEvent('phoenix-ally-confirmed',{detail:{mode:mode,ally:selected()}}))};try{var saved=sessionStorage.getItem('phoenix-ally');if(roster.some(function(a){return a.id===saved}))current=saved}catch(e){}});
window.PhoenixAllies={open:open,selected:selected,random:random,roster:roster};
})();