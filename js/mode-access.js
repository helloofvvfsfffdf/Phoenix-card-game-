(function(){'use strict';
let pending=null;const unlocked=new Set();const $=id=>document.getElementById(id);
function request(mode){if(!['single','test'].includes(mode))return;if(unlocked.has(mode)){document.dispatchEvent(new CustomEvent('phoenix-mode-unlocked',{detail:{mode}}));return;}pending=mode;$('mode-access-overlay').hidden=false;$('mode-access-feedback').textContent='';$('mode-access-input').value='';$('mode-access-input').focus();}
function cancel(){pending=null;$('mode-access-overlay').hidden=true;$('mode-access-input').value='';}
document.addEventListener('DOMContentLoaded',()=>{
 $('mode-access-cancel').onclick=cancel;
 $('mode-access-form').onsubmit=async event=>{event.preventDefault();if(!pending)return;const code=$('mode-access-input').value;const btn=$('mode-access-form').querySelector('button[type=submit]');btn.disabled=true;$('mode-access-feedback').textContent='Checking code…';try{const r=await fetch('/api/mode-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),cache:'no-store'});const result=await r.json();if(!r.ok||!result.ok){$('mode-access-feedback').textContent=result.message||'Access denied.';return;}const mode=pending;unlocked.add(mode);cancel();document.dispatchEvent(new CustomEvent('phoenix-mode-unlocked',{detail:{mode}}));}catch(e){$('mode-access-feedback').textContent='Cannot contact server. Open PHOENIX at http://localhost:3000.';}finally{btn.disabled=false;}};
});
window.PhoenixModeAccess={request,isUnlocked:mode=>unlocked.has(mode)};
})();
