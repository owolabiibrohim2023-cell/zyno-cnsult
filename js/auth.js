/* ZYNO-CONSULT: admin sign-in. The password is checked by the server (Vercel),
   so nothing secret lives in the browser. This file only talks to /api and
   remembers a short "signed in" hint so the pages can decide quickly. */
(function (global) {
  'use strict';

  var HINT = 'zyno_session_hint';
  var SEEN = 'zyno_admin_seen';
  var LOCK = 'zyno_login_lock';
  var SESSION_MS = 2 * 60 * 60 * 1000;

  function call(method, url, body, keepalive) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: Boolean(keepalive),
      headers: Object.assign({ 'X-Zyno': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        return { status: res.status, ok: res.ok, json: json };
      });
    });
  }

  /* ---------- The hint ---------- */
  function readHint() {
    try {
      var h = JSON.parse(localStorage.getItem(HINT));
      if (!h || !h.expiresAt || h.expiresAt <= Date.now()) { localStorage.removeItem(HINT); return null; }
      return h;
    } catch (e) { return null; }
  }
  function writeHint(name, expiresAt, changed) {
    try {
      localStorage.setItem(HINT, JSON.stringify({ username: name, expiresAt: expiresAt, passwordChanged: Boolean(changed) }));
      localStorage.setItem(SEEN, '1');
    } catch (e) { /* ignore */ }
  }
  function clearHint() { try { localStorage.removeItem(HINT); } catch (e) { /* ignore */ } }

  /* ---------- Cooldown shown after the server says "too many attempts" ---------- */
  function lockRemaining() {
    try { return Math.max(0, (Number(localStorage.getItem(LOCK)) || 0) - Date.now()); } catch (e) { return 0; }
  }
  function setLock(ms) { try { localStorage.setItem(LOCK, String(Date.now() + ms)); } catch (e) { /* ignore */ } }
  function clearLock() { try { localStorage.removeItem(LOCK); } catch (e) { /* ignore */ } }

  /* ---------- Public functions (same names the dashboard already uses) ---------- */
  function hasCrypto() { return true; }

  // Asks the server whether the sign-in is still valid and refreshes the hint
  function ensureAdmin() {
    return call('GET', '/api/session').then(function (r) {
      if (r.status === 200 && r.json.ok) writeHint(r.json.name, r.json.expiresAt, r.json.passwordChanged);
      else if (r.status === 401) clearHint();
    }).catch(function () { /* offline: keep what we have */ });
  }

  function getAdminInfo() {
    var h = readHint();
    return h ? { passwordChanged: Boolean(h.passwordChanged) } : null;
  }

  function login(name, password) {
    var display = String(name || '').trim().slice(0, 30);
    if (!display) return Promise.resolve({ ok: false, reason: 'name' });
    var wait = lockRemaining();
    if (wait > 0) return Promise.resolve({ ok: false, locked: true, wait: wait });

    return call('POST', '/api/login', { name: display, password: String(password) }).then(function (r) {
      if (r.status === 200 && r.json.ok) {
        clearLock();
        writeHint(r.json.name, r.json.expiresAt || Date.now() + SESSION_MS, r.json.passwordChanged);
        return { ok: true };
      }
      if (r.status === 429) { setLock(15 * 60 * 1000); return { ok: false, locked: true, wait: 15 * 60 * 1000 }; }
      if (r.status === 401) return { ok: false, reason: 'password' };
      return { ok: false, reason: 'server', message: r.json.error || 'The sign-in service is not available. Open the live site, or run "vercel dev" locally.' };
    });
  }

  function changePassword(current, next) {
    return call('POST', '/api/change-password', { current: String(current), next: String(next) }).then(function (r) {
      if (r.status === 200 && r.json.ok) {
        var h = readHint();
        writeHint(h ? h.username : 'Admin', r.json.expiresAt || Date.now() + SESSION_MS, true);
        return { ok: true };
      }
      if (r.status === 429) return { ok: false, locked: true, wait: 15 * 60 * 1000 };
      if (r.status === 401 && r.json.reason === 'wrong') return { ok: false, reason: 'wrong' };
      if (r.status === 401) { clearHint(); global.location.replace('login.html?expired=1'); return { ok: false, reason: 'expired' }; }
      return { ok: false, reason: 'server', message: r.json.error };
    });
  }

  function getSession() { return readHint(); }

  function extendSession() {
    var h = readHint();
    if (!h) return;
    writeHint(h.username, Date.now() + SESSION_MS, h.passwordChanged);   // optimistic, then confirmed by the server
    call('POST', '/api/session').then(function (r) {
      if (r.status === 200 && r.json.ok) writeHint(r.json.name, r.json.expiresAt, r.json.passwordChanged);
    }).catch(function () { /* ignore */ });
  }

  function endSession() {
    clearHint();
    call('POST', '/api/logout', { bye: 1 }, true).catch(function () { /* ignore */ });
  }

  function requireSession(loginUrl) {
    var s = readHint();
    if (!s) { global.location.replace(loginUrl || 'login.html'); return null; }
    return s;
  }
  function resetPassword(key, next) {
    return call('POST', '/api/reset-password', { key: String(key), next: String(next) }).then(function (r) {
      if (r.status === 200 && r.json.ok) return { ok: true };
      if (r.status === 429) return { ok: false, reason: 'locked' };
      if (r.status === 401) return { ok: false, reason: 'key' };
      return { ok: false, reason: 'server', message: r.json.error };
    });
  }
  global.ZynoAuth = {
    hasCrypto: hasCrypto,
    ensureAdmin: ensureAdmin,
    getAdminInfo: getAdminInfo,
    login: login,
    changePassword: changePassword,
    resetPassword: resetPassword,
    lockRemaining: lockRemaining,
    getSession: getSession,
    extendSession: extendSession,
    endSession: endSession,
    requireSession: requireSession
  
  };
})(window);