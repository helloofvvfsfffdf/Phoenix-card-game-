(() => {
  'use strict';
  const token = new URLSearchParams(location.search).get('token');
  const $ = id => document.getElementById(id);
  let state, timer;
  const api = async (path, options = {}) => {
    const response = await fetch('/api/phoenixtube/' + path + '?token=' + encodeURIComponent(token), { ...options, headers:{'Content-Type':'application/json', ...(options.headers || {})} });
    return response.json();
  };
  const text = (tag, value, cls) => { const node=document.createElement(tag); node.textContent=value; if(cls) node.className=cls; return node; };
  function render() {
    $('videos').replaceChildren(...state.videos.map((video, index) => {
      const card=document.createElement('article'); card.className='video-card';
      const videoEl=document.createElement('video'); videoEl.controls=true; videoEl.preload='metadata'; videoEl.src=video.source; videoEl.dataset.id=video.id;
      videoEl.addEventListener('timeupdate', () => reveal(videoEl, card));
      card.append(text('h2', (index + 1) + '. ' + video.title), videoEl,
        text('p', video.description), text('div', video.creator + ' · ' + video.views + ' views · ' + video.likes + ' likes', 'video-meta'),
        text('div', 'Digit: keep watching…', 'reveal'));
      return card;
    }));
  }
  async function reveal(videoEl, card) {
    if (videoEl.dataset.revealed || videoEl.currentTime < 1) return;
    const response = await fetch('/api/phoenixtube/reveal?token=' + encodeURIComponent(token) + '&video=' + encodeURIComponent(videoEl.dataset.id) + '&at=' + encodeURIComponent(videoEl.currentTime));
    const result = await response.json();
    if (result.visible) { videoEl.dataset.revealed='1'; card.querySelector('.reveal').textContent='Hidden digit spotted: ' + result.digit; }
  }
  function updateTimer() {
    if (!state) return;
    const remaining=Math.max(0, state.expiresAt-Date.now());
    $('timer').textContent=Math.floor(remaining/60000).toString().padStart(2,'0')+':'+Math.floor(remaining/1000%60).toString().padStart(2,'0');
    if (!remaining && timer) { clearInterval(timer); $('message').textContent='This challenge has expired.'; }
  }
  async function load() {
    if (!token) { $('message').textContent='No PHOENIXTube challenge token was supplied.'; return; }
    state=await api('state');
    if (!state.ok) { $('message').textContent=state.message; return; }
    if (state.status !== 'open') { $('message').textContent='This PHOENIXTube challenge is no longer open.'; return; }
    render(); updateTimer(); timer=setInterval(updateTimer,1000);
  }
  $('code-form').onsubmit=async event => { event.preventDefault(); const result=await api('submit',{method:'POST',body:JSON.stringify({code:$('code').value})}); $('feedback').textContent=result.ok?'Correct code — +20,000 PHOENIX points awarded!':result.message; $('feedback').className=result.ok?'success':'error'; if(result.ok){state.status='complete'; if(timer)clearInterval(timer);} };
  $('return').onclick=()=>window.close();
  load();
})();
