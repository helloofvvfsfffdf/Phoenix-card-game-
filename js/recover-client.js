'use strict';
/* PHOENIX — recovery-key client (replaces old email-based recovery). */
function init() {
  const overlay = document.getElementById('recovery-key-overlay');
  const openBtn = document.getElementById('account-forgot');
  const closeBtn = document.getElementById('recovery-key-cancel') || document.getElementById('recovery-key-reset-cancel');
  const generateForm = document.getElementById('recovery-key-generate-form');
  const resetForm = document.getElementById('recovery-key-reset-form');
  const feedback = document.getElementById('recovery-key-feedback');

  if (!overlay || !openBtn) {
    console.warn('[PHOENIX recover-key] overlay elements not found; recovery not initialized.');
    return;
  }

  function show() { overlay.hidden = false; document.body.style.overflow = 'hidden'; generateForm.hidden = false; resetForm.hidden = false; if (feedback) feedback.textContent = ''; }
  function hide() { overlay.hidden = true; document.body.style.overflow = ''; }

  openBtn.addEventListener('click', () => show());
  if (closeBtn) closeBtn.addEventListener('click', () => hide());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });

  // Generate new key (signed-in only; server validates session + password)
  if (generateForm) {
    generateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = document.getElementById('recovery-key-current-password').value.trim();
      if (!pw) { if (feedback) feedback.textContent = 'Enter your current password.'; return; }
      try {
        const res = await fetch('/api/account/recovery-key/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify({ password: pw })
        });
        const data = await res.json();
        if (feedback) feedback.textContent = data.message || (data.ok ? 'New key generated. Save it securely.' : 'Failed.');
        if (data.ok && data.key) {
          generateForm.hidden = true;
          // Show the generated key briefly (only in this response)
          const note = document.createElement('p');
          note.textContent = 'YOUR KEY: ' + data.key;
          note.style.fontWeight = 'bold'; note.style.color = '#ffcc00';
          generateForm.parentNode.insertBefore(note, generateForm.nextSibling);
          setTimeout(() => { if (note.parentNode) note.parentNode.removeChild(note); }, 15000);
        }
      } catch (err) {
        if (feedback) feedback.textContent = 'Something went wrong. Please try again.';
      }
    });
  }

  // Reset password with recovery key (public; server verifies key + updates atomically)
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('recovery-key-username').value.trim();
      const key = document.getElementById('recovery-key-input').value.trim();
      const newPass = document.getElementById('recovery-key-new-password').value;
      if (!username) { if (feedback) feedback.textContent = 'Enter your username.'; return; }
      if (!key) { if (feedback) feedback.textContent = 'Enter your recovery key.'; return; }
      if (newPass.length < 8) { if (feedback) feedback.textContent = 'Password must be 8+ characters.'; return; }
      try {
        const res = await fetch('/api/account/recovery-key/reset', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify({ username, key, newPassword: newPass })
        });
        const data = await res.json();
        if (feedback) feedback.textContent = data.message || (data.ok ? 'Password reset successfully. New recovery key generated.' : 'Reset failed.');
        if (data.ok && data.new_key) {
          const note = document.createElement('p');
          note.textContent = 'NEW KEY: ' + data.new_key;
          note.style.fontWeight = 'bold'; note.style.color = '#ffcc00';
          resetForm.parentNode.insertBefore(note, resetForm.nextSibling);
          setTimeout(() => { if (note.parentNode) note.parentNode.removeChild(note); }, 15000);
        }
      } catch (err) {
        if (feedback) feedback.textContent = 'Something went wrong. Please try again.';
      }
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
