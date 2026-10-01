/* ZYNO-CONSULT: admin sign-in (frontend only).
   Any name can be typed; only the password is checked. The password is never
   stored as plain text: only a salted PBKDF2 hash is kept in this browser.
   This is a convenience lock, not real security. */
(function (global) {
  'use strict';

  /* ===== EDIT THIS LINE BEFORE GOING LIVE ===== */
  var DEFAULT_ADMIN_PASSWORD = 'CHANGE_ME';
  /* ============================================ */

  var ADMIN_KEY = 'zyno_admin';
  var SESSION_KEY = 'zyno_session';
  var FAIL_KEY = 'zyno_auth_fail';
  var SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours
  var MAX_FAILS = 5;
  var LOCK_MS = 60 * 1000;             // 1 minute cooldown after 5 wrong tries
  var ITERATIONS = 100000;

  function hasCrypto() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues);
  }

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function fromHex(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function newSalt() {
    var a = new Uint8Array(16);
    global.crypto.getRandomValues(a);
    return toHex(a);
  }

  function derive(password, saltHex, iterations) {
    var enc = new TextEncoder();
    return global.crypto.subtle
      .importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return global.crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iterations },
          key,
          256
        );
      })
      .then(toHex);
  }

  function same(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ---------- Stored admin record ---------- */
  function readAdmin() {
    try { return JSON.parse(localStorage.getItem(ADMIN_KEY)); } catch (e) { return null; }
  }
  function writeAdmin(rec) {
    try { localStorage.setItem(ADMIN_KEY, JSON.stringify(rec)); } catch (e) { /* ignore */ }
  }

  // Creates the record from DEFAULT_ADMIN_PASSWORD the first time it is needed
  function ensureAdmin() {
    if (!hasCrypto()) return Promise.reject(new Error('crypto-unavailable'));
    var rec = readAdmin();
    if (rec && rec.hash && rec.salt) return Promise.resolve(rec);
    var salt = newSalt();
    return derive(DEFAULT_ADMIN_PASSWORD, salt, ITERATIONS).then(function (hash) {
      var fresh = { salt: salt, hash: hash, iterations: ITERATIONS, passwordChanged: false };
      writeAdmin(fresh);
      return fresh;
    });
  }

  function getAdminInfo() {
    var rec = readAdmin();
    return rec ? { passwordChanged: !!rec.passwordChanged, username: String(rec.username || '') } : null;
  }

  /* ---------- Cooldown after repeated wrong passwords ---------- */
  function readFail() {
    try { return JSON.parse(localStorage.getItem(FAIL_KEY)) || { count: 0, until: 0 }; }
    catch (e) { return { count: 0, until: 0 }; }
  }
  function writeFail(f) {
    try { localStorage.setItem(FAIL_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ }
  }
  function lockRemaining() {
    return Math.max(0, (readFail().until || 0) - Date.now());
  }
  function clearFails() { writeFail({ count: 0, until: 0 }); }
  function recordFail() {
    var f = readFail();
    f.count = (f.count || 0) + 1;
    var locked = false;
    if (f.count >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.count = 0; locked = true; }
    writeFail(f);
    return locked;
  }

  /* ---------- Session (cleared when the tab closes) ---------- */
  function startSession(name) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username: name, expiresAt: Date.now() + SESSION_MS }));
    } catch (e) { /* ignore */ }
  }

  function getSession() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!s || !s.expiresAt || s.expiresAt <= Date.now()) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (e) { return null; }
  }

  function extendSession() {
    var s = getSession();
    if (s) startSession(s.username);
  }

  function endSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  function requireSession(loginUrl) {
    var s = getSession();
    if (!s) { global.location.replace(loginUrl || 'login.html'); return null; }
    return s;
  }

  /* ---------- Login: any name, correct password ---------- */
  function login(name, password) {
    var display = String(name || '').trim().slice(0, 30);
    if (!display) return Promise.resolve({ ok: false, reason: 'name' });

    var wait = lockRemaining();
    if (wait > 0) return Promise.resolve({ ok: false, locked: true, wait: wait });

    return ensureAdmin().then(function (rec) {
      if (rec.username && display.toLowerCase() !== String(rec.username).toLowerCase()) {
        return { ok: false, reason: 'username' };
      }
      return derive(String(password), rec.salt, rec.iterations || ITERATIONS).then(function (hash) {
        if (same(hash, rec.hash)) {
          clearFails();
          startSession(display);
          return { ok: true };
        }
        var locked = recordFail();
        return new Promise(function (resolve) {
          setTimeout(function () { resolve({ ok: false, reason: 'password', locked: locked, wait: locked ? LOCK_MS : 0 }); }, 500);
        });
      });
    });
  }

  /* ---------- Change password (needs the current one) ---------- */
  function changePassword(current, next) {
    var wait = lockRemaining();
    if (wait > 0) return Promise.resolve({ ok: false, locked: true, wait: wait });

    return ensureAdmin().then(function (rec) {
      return derive(String(current), rec.salt, rec.iterations || ITERATIONS).then(function (hash) {
        if (!same(hash, rec.hash)) {
          var locked = recordFail();
          return { ok: false, reason: 'wrong', locked: locked, wait: locked ? LOCK_MS : 0 };
        }
        clearFails();
        var salt = newSalt();
        return derive(String(next), salt, ITERATIONS).then(function (newHash) {
          writeAdmin(Object.assign({}, rec, { salt: salt, hash: newHash, iterations: ITERATIONS, passwordChanged: true }));
          return { ok: true };
        });
      });
    });
  }

  function verifyPassword(current) {
    var wait = lockRemaining();
    if (wait > 0) return Promise.resolve({ ok: false, locked: true, wait: wait });
    return ensureAdmin().then(function (rec) {
      return derive(String(current), rec.salt, rec.iterations || ITERATIONS).then(function (hash) {
        if (same(hash, rec.hash)) { clearFails(); return { ok: true }; }
        var locked = recordFail();
        return { ok: false, locked: locked, wait: locked ? LOCK_MS : 0 };
      });
    });
  }

  function changeUsername(current, next) {
    var name = String(next || '').trim().slice(0, 30);
    if (!name) return Promise.resolve({ ok: false, reason: 'username' });
    return verifyPassword(current).then(function (result) {
      if (!result.ok) return result;
      var rec = readAdmin() || {};
      rec.username = name;
      writeAdmin(rec);
      if (getSession()) startSession(name);
      return { ok: true, username: name };
    });
  }

  function resetAdminLogin() {
    if (!hasCrypto()) return Promise.reject(new Error('crypto-unavailable'));
    var salt = newSalt();
    return derive(DEFAULT_ADMIN_PASSWORD, salt, ITERATIONS).then(function (hash) {
      writeAdmin({ salt: salt, hash: hash, iterations: ITERATIONS, passwordChanged: false });
      clearFails();
      return { ok: true };
    });
  }

  global.ZynoAuth = {
    hasCrypto: hasCrypto,
    ensureAdmin: ensureAdmin,
    getAdminInfo: getAdminInfo,
    login: login,
    changePassword: changePassword,
    verifyPassword: verifyPassword,
    changeUsername: changeUsername,
    resetAdminLogin: resetAdminLogin,
    lockRemaining: lockRemaining,
    startSession: startSession,
    getSession: getSession,
    extendSession: extendSession,
    endSession: endSession,
    requireSession: requireSession
  };
})(window);