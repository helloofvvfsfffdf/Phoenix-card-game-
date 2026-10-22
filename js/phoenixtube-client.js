(() => {
  'use strict';
  const params = new URLSearchParams(location.search), token = params.get('token');
  const $ = id => document.getElementById(id);
  let state = null, timer = null, demo = !token;
  const api = async (path, options = {}) => {
    const response = await fetch('/api/phoenixtube/' + path + '?token=' + encodeURIComponent(token), { ...options, headers:{'Content-Type':'application/json', ...(options.headers || {})} });
    return response.json();
  };
  const text = (tag, value, cls) => { const node=document.createElement(tag); node.textContent=value; if(cls) node.className=cls; return node; };
  const random = max => { const bytes=new Uint32Array(1); crypto.getRandomValues(bytes); return bytes[0] % max; };
  function demoState() {
    const pool=[
      ['ad-rocket-toaster','The Rocket-Powered Toaster Review','PHOENIX Tech Desk','We test a toaster that insists it is ready for launch.','2.4M','98K',1],
      ['cooking-soup','Ridiculous Cooking: Soup for a Computer','Chef Buffering','A completely serious tutorial for feeding an imaginary laptop.','884K','41K',2],
      ['animal-news','Animal News at Nine: The Duck Has Questions','Feathered Broadcast','Breaking news from a studio where nobody can find the teleprompter.','5.1M','212K',3],
      ['gaming-onion','Gaming Onion Pro Max — First Look','Loading Screen Larry','Is this an onion, a console, or both?','731K','36K',4],
      ['phoenix-weather','Tomorrow’s Weather Is Mostly Geckos','PHOENIX Entertainment','A forecast presented with unnecessary confidence.','1.8M','77K',5],
      ['bread-maths','Bread Mathematics Explained','Professor Crumb','Pythagoras meets the bakery aisle.','642K','29K',6]
    ];
    const videos=pool.sort(()=>random(3)-1).slice(0,4).map(item=>({id:item[0],title:item[1],creator:item[2],description:item[3],views:item[4],likes:item[5],duration:120,source:'/assets/phoenixtube/clip-'+item[6]+'.mp4',digit:random(10),revealAt:random(91)+15}));
    return { ok:true, status:'open', videos, code:videos.map(video=>video.digit).join(''), startedAt:Date.now(), expiresAt:Date.now()+600000 };
  }
  function render() {
    $('videos').replaceChildren(...state.videos.map((video,index)=>{
      const card=document.createElement('article'); card.className='video-card';
      const videoEl=document.createElement('video'); videoEl.controls=true; videoEl.preload='metadata'; videoEl.src=video.source; videoEl.dataset.id=video.id;
      videoEl.addEventListener('timeupdate',()=>reveal(videoEl,card));
      card.append(text('h2',(index+1)+'. '+video.title),videoEl,text('p',video.description),text('div',video.creator+' · '+video.views+' views · '+video.likes+' likes','video-meta'),text('div','Digit: keep watching…','reveal'));
      return card;
    }));
  }
  async function reveal(videoEl,card) {
    if(videoEl.dataset.revealed || videoEl.currentTime<1) return;
    if(demo){ const video=state.videos.find(item=>item.id===videoEl.dataset.id); if(videoEl.currentTime>=video.revealAt){videoEl.dataset.revealed='1';card.querySelector('.reveal').textContent='Hidden digit spotted: '+video.digit;} return; }
    const response=await fetch('/api/phoenixtube/reveal?token='+encodeURIComponent(token)+'&video='+encodeURIComponent(videoEl.dataset.id)+'&at='+encodeURIComponent(videoEl.currentTime));
    const result=await response.json(); if(result.visible){videoEl.dataset.revealed='1';card.querySelector('.reveal').textContent='Hidden digit spotted: '+result.digit;}
  }
  function result(title, detail, buttonLabel) {
    $('challenge').hidden=true; $('welcome').hidden=true; const box=$('result'); box.hidden=false; box.replaceChildren(text('h2',title),text('p',detail)); const button=document.createElement('button'); button.className='demo-button'; button.textContent=buttonLabel; button.onclick=startDemo; box.append(button);
  }
  function updateTimer() {
    if(!state) return; const remaining=Math.max(0,state.expiresAt-Date.now()); $('timer').textContent=Math.floor(remaining/60000).toString().padStart(2,'0')+':'+Math.floor(remaining/1000%60).toString().padStart(2,'0');
    if(!remaining && timer){clearInterval(timer);timer=null;if(demo){state.status='failed';result("Time's Up!",'The ten-minute practice challenge ended.','TRY AGAIN');}else $('message').textContent='This challenge has expired.';}
  }
  function startDemo(){demo=true;state=demoState();$('welcome').hidden=true;$('result').hidden=true;$('challenge').hidden=false;$('feedback').textContent='';$('code').value='';render();updateTimer();if(timer)clearInterval(timer);timer=setInterval(updateTimer,1000);}
  async function loadMultiplayer(){state=await api('state');if(!state.ok){$('message').textContent=state.message;return;}if(state.status!=='open'){$('message').textContent='This PHOENIXTube challenge is no longer open.';return;}demo=false;$('welcome').hidden=true;$('challenge').hidden=false;render();updateTimer();timer=setInterval(updateTimer,1000);}
  $('try-demo').onclick=startDemo;
  $('code-form').onsubmit=async event=>{event.preventDefault();const answer=$('code').value;if(demo){if(Date.now()>=state.expiresAt){updateTimer();return;}if(!/^\d{4}$/.test(answer)||answer!==state.code){$('feedback').textContent='Incorrect code. Rewatch the videos and try again.';$('feedback').className='error';return;}state.status='complete';if(timer)clearInterval(timer);result('PHOENIXTube Challenge Complete!','Practice complete in '+Math.floor((Date.now()-state.startedAt)/1000)+' seconds. No PHOENIX points were changed.','PLAY AGAIN');return;}const response=await api('submit',{method:'POST',body:JSON.stringify({code:answer})});$('feedback').textContent=response.ok?'Correct code — +20,000 PHOENIX points awarded!':response.message;$('feedback').className=response.ok?'success':'error';if(response.ok){state.status='complete';if(timer)clearInterval(timer);}};
  $('return').onclick=()=>window.close();
  if(token) loadMultiplayer();
})();
