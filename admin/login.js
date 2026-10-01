/* ZYNO-CONSULT: admin login page */
(() => {
  'use strict';

  const A = window.ZynoAuth;
  if (!A) return;

  const $ = (id) => document.getElementById(id);
  const form = $('loginForm');
  const alertBox = $('loginAlert');
  const btn = $('loginBtn');
  const user = $('username');
  const pass = $('password');
  const toggle = $('pwToggle');

  // Already signed in
  if (A.getSession()) { location.replace('index.html'); return; }

  function showAlert(type, text) {
    alertBox.hidden = false;
    alertBox.className = 'alert alert--' + type;
    alertBox.textContent = text;
  }
  function hideAlert() { alertBox.hidden = true; }
  function setBusy(busy, label) {
    btn.disabled = busy;
    btn.textContent = label || (busy ? 'Signing in…' : 'Sign in');
  }

  // The browser only allows password hashing on https:// or http://localhost
  if (!A.hasCrypto()) {
    showAlert('error', 'This page must be opened from https:// or http://localhost so the browser can protect the password. Open it from your hosting or from a local server such as Live Server.');
    setBusy(true, 'Unavailable');
    user.disabled = true;
    pass.disabled = true;
    return;
  }

  if (new URLSearchParams(location.search).get('expired')) {
    showAlert('info', 'Your session ended. Please sign in again.');
  }

  A.ensureAdmin().catch(() => {});
  const accountInfo = A.getAdminInfo();
  if (accountInfo && accountInfo.username) {
    user.value = accountInfo.username;
    user.autocomplete = 'username';
    user.closest('.field').querySelector('.field__hint').textContent = 'Enter the username saved for this browser account.';
  }

  // Cooldown after too many wrong attempts
  let lockTimer = null;
  function checkLock() {
    clearTimeout(lockTimer);
    const ms = A.lockRemaining();
    if (ms > 0) {
      showAlert('error', 'Too many attempts. Try again in ' + Math.ceil(ms / 1000) + ' seconds.');
      setBusy(true, 'Locked');
      lockTimer = setTimeout(checkLock, 500);
    } else if (btn.textContent === 'Locked') {
      hideAlert();
      setBusy(false);
    }
  }
  checkLock();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (A.lockRemaining() > 0) { checkLock(); return; }

    if (!user.value.trim() || !pass.value) {
                showAlert('error', 'Enter a name and the password.');
      (user.value.trim() ? pass : user).focus();
      return;
    }

    hideAlert();
    setBusy(true);

    try {
      const res = await A.login(user.value, pass.value);
      if (res.ok) {
        setBusy(true, 'Welcome…');
        location.replace('index.html');
        return;
      }
      pass.value = '';
      setBusy(false);
      if (res.locked) { checkLock(); return; }
       showAlert('error', res.reason === 'username' ? 'That is not the saved username for this browser.' : 'Incorrect password.');
      pass.focus();
    } catch (err) {
      setBusy(false);
      showAlert('error', 'Could not sign in in this browser. Open the page over https:// or http://localhost.');
    }
  });

  toggle.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  user.focus();
})();