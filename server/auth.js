'use strict';

const crypto = require('crypto');
const redis = require('./redis');

const KEY = 'zyno:admin';
const COOKIE = 'zyno_sid';
const SESSION_SECONDS = 2 * 60 * 60;

/* ---------- Basics ---------- */
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    const e = new Error('SESSION_SECRET is missing or too short. Add 32 or more random characters in Vercel.');
    e.status = 500;
    throw e;
  }
  return s;
}

const sign = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

function safeEq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function send(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(obj);
}

function fail(res, err) {
  console.error(err);
  send(res, err.status || 500, { error: err.message || 'Server error', conflict: !!err.conflict });
}

function body(req) {
  try {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body || {};
  } catch (e) {
    const err = new Error('The request was not valid.');
    err.status = 400;
    throw err;
  }
}

function ip(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Only our own pages may send changes
function guard(req) {
  if (req.headers['x-zyno'] !== '1') return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return false; } catch (e) { return false; }
  }
  return true;
}

/* ---------- Password ---------- */
async function getAdmin() {
  const raw = await redis.cmd(['GET', KEY]);
  return raw ? JSON.parse(raw) : null;
}

// Checks the password against the saved one, or the starting ADMIN_PASSWORD until one has been saved
async function verify(password) {
  const rec = await getAdmin();
  if (rec) {
    const hash = crypto.scryptSync(password, rec.salt, 64).toString('hex');
    return { ok: safeEq(hash, rec.hash), pv: rec.version, changed: true };
  }
  const start = process.env.ADMIN_PASSWORD || '';
  return { ok: Boolean(start) && safeEq(password, start), pv: 0, changed: false };
}

async function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const version = Date.now();
  await redis.cmd(['SET', KEY, JSON.stringify({ salt, hash, version })]);
  return version;
}

/* ---------- Attempt limit (8 tries per 15 minutes per address) ---------- */
async function limit(req, max) {
  const k = 'zyno:rl:' + ip(req);
  const n = await redis.cmd(['INCR', k]);
  if (n === 1) await redis.cmd(['EXPIRE', k, '900']);
  return n <= (max || 8);
}
async function clearLimit(req) {
  await redis.cmd(['DEL', 'zyno:rl:' + ip(req)]);
}

/* ---------- Session cookie ---------- */
function cookie(req, name) {
  const part = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.indexOf(name + '=') === 0);
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}

function startSession(res, name, pv) {
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ n: name, e: expiresAt, v: pv })).toString('base64url');
  const token = payload + '.' + sign(payload);
  res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + SESSION_SECONDS);
  return expiresAt;
}

function clearSession(res) {
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
}

async function readSession(req) {
  const token = cookie(req, COOKIE);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !safeEq(parts[1], sign(parts[0]))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch (e) { return null; }
  if (!p || !p.e || p.e <= Date.now()) return null;

  // A password change signs out every older session
  const rec = await getAdmin();
  if (p.v !== (rec ? rec.version : 0)) return null;
  return { name: String(p.n || '').slice(0, 30), passwordChanged: Boolean(rec), expiresAt: p.e, pv: p.v };
}

async function requireSession(req, res) {
  const s = await readSession(req);
  if (!s) { send(res, 401, { ok: false, error: 'Please sign in again.' }); return null; }
  return s;
}

module.exports = { send, fail, body, ip, guard, verify, setPassword, limit, clearLimit, startSession, clearSession, readSession, requireSession };