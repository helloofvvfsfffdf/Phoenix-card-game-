'use strict';
/* PHOENIX — recovery-key client (separate flows: settings generate / forgot reset). */
function init() {
  const forgotOverlay = document.getElementById('recovery-key-overlay');
  const forgotOpenBtn = document.getElementById('account-forgot');
  const forgotGenerateForm = document.getElementById('recovery-key-generate-form');
  const forgotResetForm = document.getElementById('recovery-key-reset-form');
  const forgotFeedback = document.getElementById('recovery-key-feedback');

  const settingsBtn = document.getElementById('settings-recover-key-btn');
  const settingsOverlay = document.getElementById('recovery-key-settings-overlay');
  const settingsForm = document.getElementById('recovery-key-settings-form-overlay');
  const settingsFeedback = document.getElementById('recovery-key-settings-feedback');
  const settingsCancel = document.getElementById('recovery-key-settings-cancel');

  if (forgotOverlay && forgotOpenBtn) {
    function forgotShow() {
      forgotOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      if (forgotGenerateForm) forgotGenerateForm.hidden = true;
      if (forgotResetForm) forgotResetForm.hidden = false;
      if (forgotFeedback) { forgotFeedback.textContent = 'You must have saved your recovery key previously. Generate it from Account Settings before you forget your password.'; }
    }
    function forgotHide() { forgotOverlay.hidden = true; document.body.style.overflow = ''; if (forgotFeedback) forgotFeedback.textContent = ''; }
    forgotOpenBtn.addEventListener('click', forgotShow);
    forgotOverlay.addEventListener('click', (e) => { if (e.target === forgotOverlay) forgotHide(); });
    const forgotClose = document.getElementById('recovery-key-cancel') || document.getElementById('recovery-key-reset-cancel');
    if (forgotClose) forgotClose.addEventListener('click', forgotHide);

    if (forgotResetForm) {
      forgotResetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = (document.getElementById('recovery-key-username') || {}).value || '';
        const key = (document.getElementById('recovery-key-input') || {}).value || '';
        const newPass = (document.getElementById('recovery-key-new-password') || {}).value || '';
        if (forgotFeedback) forgotFeedback.textContent = '';
        if (!username.trim()) { if (forgotFeedback) forgotFeedback.textContent = 'Enter your username.'; return; }
        if (!key.trim()) { if (forgotFeedback) forgotFeedback.textContent = 'Enter your recovery key.'; return; }
        if (newPass.length < 8) { if (forgotFeedback) forgotFeedback.textContent = 'Password must be 8+ characters.'; return; }
        try {
          const res = await fetch('/api/account/recovery-key/reset', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin', body: JSON.stringify({ username: username.trim(), key: key.trim(), newPassword: newPass })
          });
          const data = await res.json();
          if (forgotFeedback) forgotFeedback.textContent = data.message || (data.ok ? 'Password reset. A new recovery key was generated — save it now.' : 'Reset failed.');
          if (data.ok && data.new_key) {
            const note = document.createElement('p');
            note.textContent = 'NEW KEY: ' + data.new_key;
            note.style.fontWeight = 'bold'; note.style.color = '#ffcc00';
            forgotResetForm.parentNode.insertBefore(note, forgotResetForm.nextSibling);
            setTimeout(() => { if (note.parentNode) note.parentNode.removeChild(note); }, 15000);
          }
        } catch (err) {
          if (forgotFeedback) forgotFeedback.textContent = 'Something went wrong. Please try again.';
        }
      });
    }
  }

  // Settings generate flow
  if (settingsBtn && settingsOverlay && settingsForm) {
    settingsBtn.addEventListener('click', () => {
      settingsOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      if (settingsFeedback) settingsFeedback.textContent = '';
      const pwInput = document.getElementById('recovery-key-current-password');
      if (pwInput) pwInput.value = '';
    });
    settingsCancel.addEventListener('click', () => {
      settingsOverlay.hidden = true;
      document.body.style.overflow = '';
      if (settingsFeedback) settingsFeedback.textContent = '';
    });
    settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) { settingsOverlay.hidden = true; document.body.style.overflow = ''; } });

    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = (document.getElementById('recovery-key-current-password') || {}).value || '';
      if (!pw) { if (settingsFeedback) settingsFeedback.textContent = 'Enter your current password.'; return; }
      try {
        const res = await fetch('/api/account/recovery-key/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify({ password: pw })
        });
        const data = await res.json();
        if (settingsFeedback) settingsFeedback.textContent = data.message || (data.ok ? 'New key generated. Save it securely — shown only this time.' : 'Failed.');
        if (data.ok && data.key) {
          const note = document.createElement('p');
          note.textContent = 'YOUR KEY: ' + data.key;
          note.style.fontWeight = 'bold'; note.style.color = '#ffcc00';
          settingsForm.parentNode.insertBefore(note, settingsForm.nextSibling);
          setTimeout(() => { if (note.parentNode) note.parentNode.removeChild(note); }, 15000);
        }
      } catch (err) {
        if (settingsFeedback) settingsFeedback.textContent = 'Something went wrong. Please try again.';
      }
    });
  }
}

  // Fallback: bind cancel buttons explicitly by ID in case earlier selectors missed
  ['recovery-key-cancel', 'recovery-key-reset-cancel'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => {
      const overlay = document.getElementById('recovery-key-overlay');
      if (overlay) { overlay.hidden = true; document.body.style.overflow = ''; }
    });
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
