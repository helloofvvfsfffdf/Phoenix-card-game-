/* Effekseer has global initialization callbacks: coalesce concurrent users. */
(function(root){
  'use strict';var pending=null;
  root.PhoenixParticleRuntime={prepare:function(){
    if(!pending)pending=new Promise(function(resolve,reject){
      if(!root.effekseer){reject(new Error('Effekseer unavailable'));return;}
      root.effekseer.initRuntime('assets/victory/vendor/effekseer.wasm',resolve,function(){reject(new Error('Effekseer initialization failed'));});
    });
    return pending;
  }};
}(typeof globalThis!=='undefined'?globalThis:this));
