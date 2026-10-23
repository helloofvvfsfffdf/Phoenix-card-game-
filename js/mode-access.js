(function(){'use strict';
let pending=null;const unlocked=new Set();const $=id=>document.getElementById(id);
// Multiplayer Testing ('test') is the one mode behind the access-code gate.
// Single Player is the creator's own LOCAL match - no server takes part, the
// menu button is already hidden for everyone but the owner, and the deck it
// deals is decided by Rules.deal - so a request for 'single' unlocks straight
// away and the code is never asked for.
function request(mode){if(mode==='single'){document.dispatchEvent(new CustomEvent('phoenix-mode-unlocked',{detail:{mode:'single'}}));return;}if(mode!=='test')return;if(unlocked.has(mode)){document.dispatchEvent(new CustomEvent('phoenix-mode-unlocked',{detail:{mode}}));return;}pending=mode;$('mode-access-overlay').hidden=false;$('mode-access-feedback').textContent='';$('mode-access-input').value='';$('mode-access-input').focus();}
function cancel(){pending=null;$('mode-access-overlay').hidden=true;$('mode-access-input').value='';}
document.addEventListener('DOMContentLoaded',()=>{
 $('mode-access-cancel').onclick=cancel;
 $('mode-access-form').onsubmit=async event=>{event.preventDefault();if(!pending)return;const code=$('mode-access-input').value;const btn=$('mode-access-form').querySelector('button[type=submit]');btn.disabled=true;$('mode-access-feedback').textContent='Checking code…';try{const r=await fetch('/api/mode-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),cache:'no-store'});const result=await r.json();if(!r.ok||!result.ok){$('mode-access-feedback').textContent=result.message||'Access denied.';return;}const mode=pending;unlocked.add(mode);cancel();document.dispatchEvent(new CustomEvent('phoenix-mode-unlocked',{detail:{mode}}));}catch(e){$('mode-access-feedback').textContent='Cannot contact server. Open PHOENIX at http://localhost:3000.';}finally{btn.disabled=false;}};
});
window.PhoenixModeAccess={request,isUnlocked:mode=>unlocked.has(mode)};
})();
