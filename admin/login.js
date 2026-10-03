/* ZYNO-CONSULT: admin login page (the password is checked by the server) */
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

  // Already signed in? Confirm with the server, then go straight in.
  if (A.getSession()) {
    A.ensureAdmin().then(() => { if (A.getSession()) location.replace('index.html'); });
  }

  function showAlert(type, text) {
    alertBox.hidden = false;
    alertBox.className = 'alert alert--' + type;
    alertBox.textContent = text;
  }
  function hideAlert() { alertBox.hidden = true; }
  function setBusy(busy, label) {
    btn.disabled = busy;
    btn.textContent = label || (busy ? 'Signing in\u2026' : 'Sign in');
  }

  if (new URLSearchParams(location.search).get('expired')) {
    showAlert('info', 'Your session ended. Please sign in again.');
  }

  // Cooldown after too many wrong passwords
  let lockTimer = null;
  function checkLock() {
    clearTimeout(lockTimer);
    const ms = A.lockRemaining();
    if (ms > 0) {
      const mins = Math.ceil(ms / 60000);
      showAlert('error', 'Too many attempts. Try again in ' + mins + (mins === 1 ? ' minute.' : ' minutes.'));
      setBusy(true, 'Locked');
      lockTimer = setTimeout(checkLock, 1000);
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
        setBusy(true, 'Welcome\u2026');
        location.replace('index.html');
        return;
      }
      pass.value = '';
      setBusy(false);
      if (res.locked) { checkLock(); return; }
      if (res.reason === 'server') { showAlert('error', res.message); return; }
      showAlert('error', 'Incorrect password.');
      pass.focus();
    } catch (err) {
      setBusy(false);
      showAlert('error', 'Could not reach the sign-in service. Check your connection and try again.');
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
    /* ---------- Forgot password (needs the recovery key) ---------- */
  const dlg = $('resetDlg');
  const rForm = $('resetForm');
  const rAlert = $('resetAlert');
  const rBtn = $('resetBtn');

  function rShow(text) { rAlert.hidden = !text; rAlert.className = 'alert alert--error'; rAlert.textContent = text || ''; }

  $('forgotBtn').addEventListener('click', () => {
    rForm.reset();
    rShow('');
    dlg.showModal();
    $('rkey').focus();
  });
  $('resetCancel').addEventListener('click', () => dlg.close());

  rForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('rkey').value.trim();
    const next = $('rnew').value;
    const conf = $('rconf').value;

    if (!key) { rShow('Enter the recovery key.'); $('rkey').focus(); return; }
    if (next.length < 8) { rShow('Use a new password of at least 8 characters.'); $('rnew').focus(); return; }
    if (next !== conf) { rShow('The two passwords do not match.'); $('rconf').focus(); return; }

    rShow('');
    rBtn.disabled = true;
    rBtn.textContent = 'Resetting\u2026';
    try {
      const res = await A.resetPassword(key, next);
      if (res.ok) {
        dlg.close();
        showAlert('info', 'Password reset. Sign in with your new password.');
        pass.focus();
      } else if (res.reason === 'key') {
        rShow('That recovery key is not correct.');
        $('rkey').focus();
      } else if (res.reason === 'locked') {
        rShow('Too many attempts. Try again in 15 minutes.');
      } else {
        rShow(res.message || 'Could not reset the password. Please try again.');
      }
    } catch (err) {
      rShow('Could not reach the server. Check your connection and try again.');
    }
    rBtn.disabled = false;
    rBtn.textContent = 'Reset password';
  });
})();