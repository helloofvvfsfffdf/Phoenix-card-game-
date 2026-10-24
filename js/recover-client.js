/* PHOENIX — client-side password recovery.
 * Wire the overlay forms to /api/account/recover/* server endpoints.
 * Keeps all interaction inside the game interface (no external redirects).
 */
'use strict';

function init() {
  const overlay = document.getElementById('recover-overlay');
  const openBtn = document.getElementById('account-forgot');
  const closeBtn = document.getElementById('recover-close');
  const emailForm = document.getElementById('recover-email-form');
  const codeForm = document.getElementById('recover-code-form');
  const resetForm = document.getElementById('recover-reset-form');

  if (!overlay || !openBtn || !emailForm) {
    console.warn('[PHOENIX recover] overlay elements not found; recovery not initialized.');
    return;
  }

  function show() { overlay.hidden = false; document.body.style.overflow = 'hidden'; emailForm.hidden = false; codeForm.hidden = true; resetForm.hidden = true; document.getElementById('recover-email').value = ''; document.getElementById('recover-feedback').textContent = ''; document.getElementById('recover-email').focus(); }
  function hide() { overlay.hidden = true; document.body.style.overflow = ''; }

  const backBtn = document.getElementById('recover-back');
  const backToCodeBtn = document.getElementById('recover-back-to-code');
  if (backBtn) backBtn.addEventListener('click', () => { emailForm.hidden = false; codeForm.hidden = true; resetForm.hidden = true; document.getElementById('recover-email').focus(); });
  if (backToCodeBtn) backToCodeBtn.addEventListener('click', () => { resetForm.hidden = true; codeForm.hidden = false; document.getElementById('recover-code').focus(); });

  openBtn.addEventListener('click', () => { show(); });
  closeBtn.addEventListener('click', () => { hide(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });

  // Email submit: request the reset code.
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('recover-email').value.trim();
    const feedback = document.getElementById('recover-feedback');
    feedback.textContent = '';
    if (!email || email.indexOf('@') < 1) {
      feedback.textContent = 'Enter a valid email address.';
      return;
    }
    try {
      const res = await fetch('/api/account/recover/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ email })
      });
      const data = await res.json();
      // Always generic message (prevents enumeration).
      feedback.textContent = data.message || 'If that account exists, a six-digit code has been sent.';
      if (data.ok) {
        emailForm.hidden = true;
        codeForm.hidden = false;
        document.getElementById('recover-code').focus();
      }
    } catch (err) {
      feedback.textContent = 'Something went wrong. Please try again.';
    }
  });

  // Code submit: verify the six-digit code.
  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('recover-email').value.trim();
    const code = document.getElementById('recover-code').value.trim();
    const feedback = document.getElementById('recover-feedback');
    feedback.textContent = '';
    if (!/^\d{6}$/.test(code)) {
      feedback.textContent = 'Enter the six-digit code from the recovery email.';
      return;
    }
    try {
      const res = await fetch('/api/account/recover/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ email, code })
      });
      const data = await res.json();
      if (data.ok) {
        codeForm.hidden = true;
        resetForm.hidden = false;
        document.getElementById('recover-new-password').value = '';
        document.getElementById('recover-confirm-password').value = '';
        document.getElementById('recover-new-password').focus();
      } else {
        feedback.textContent = data.message || 'That code is not correct or has expired. Request a new one.';
      }
    } catch (err) {
      feedback.textContent = 'Something went wrong. Please try again.';
    }
  });

  // Reset submit: set new password.
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('recover-email').value.trim();
    const code = document.getElementById('recover-code').value.trim();
    const newPass = document.getElementById('recover-new-password').value;
    const confirmPass = document.getElementById('recover-confirm-password').value;
    const feedback = document.getElementById('recover-feedback');
    feedback.textContent = '';
    if (newPass.length < 8) { feedback.textContent = 'Password must be at least 8 characters.'; return; }
    if (newPass !== confirmPass) { feedback.textContent = 'Passwords do not match.'; return; }
    try {
      const res = await fetch('/api/account/recover/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ email, code, newPassword: newPass })
      });
      const data = await res.json();
      if (data.ok) {
        feedback.textContent = 'Password reset. You will be returned to sign in.';
        setTimeout(() => { hide(); document.getElementById('account-form').reset(); }, 1500);
      } else {
        feedback.textContent = data.message || 'Reset failed. Please request a new code.';
      }
    } catch (err) {
      feedback.textContent = 'Something went wrong. Please try again.';
    }
  });
}

// Initialize once the overlay exists (before or after DOMContentLoaded).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
