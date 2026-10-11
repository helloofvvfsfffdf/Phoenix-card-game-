/* Reuse the approved Settings fire preview as a silent welcome, not a card play.
 * No SFX/audio calls, match state, credentials or network traffic. */
(function(){
  'use strict';
  var scene=null,shown=false;
  function stop(){if(scene){scene.stop(false);scene=null;}}
  function start(){
    if(shown||document.hidden||!window.PhoenixFireScene)return;
    var menu=document.getElementById('phoenix-menu');
    if(menu&&menu.hidden){shown=true;return;}
    shown=true;var prefs={};try{prefs=JSON.parse(localStorage.getItem('phoenix.effects.v1')||'{}')||{};}catch(e){}
    if(prefs.visuals==='off')return;
    var reduced=prefs.visuals==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;
    scene=window.PhoenixFireScene.start({intro:true,reduced:reduced,onFinish:function(){scene=null;}});
  }
  document.addEventListener('visibilitychange',function(){if(document.hidden)stop();else start();});
  document.addEventListener('keydown',function(event){if(event.key==='Escape')stop();});
  // A keyboard-initiated menu action must never leave an intro over a match.
  document.addEventListener('click',function(event){if(event.target.closest&&event.target.closest('[id^="menu-"]'))stop();},true);
  addEventListener('pagehide',stop);
  window.PhoenixOpeningCinematic={stop:stop,active:function(){return !!scene;}};
  start();
  var menu=document.getElementById('phoenix-menu');
  if(menu&&window.MutationObserver){var observer=new MutationObserver(function(){if(menu.hidden)stop();});observer.observe(menu,{attributes:true,attributeFilter:['hidden']});addEventListener('pagehide',function(){observer.disconnect();});}
}());
