'use strict';
const auth = require('../server/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return auth.send(res, 405, { error: 'Method not allowed.' });
    if (!auth.guard(req)) return auth.send(res, 403, { error: 'Blocked.' });
    if (!(await auth.limit(req))) return auth.send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });

    const b = auth.body(req);
    const name = String(b.name || '').trim().slice(0, 30);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!name || !password) return auth.send(res, 400, { error: 'Enter a name and the password.' });

    const v = await auth.verify(password);
    if (!v.ok) return auth.send(res, 401, { ok: false, error: 'Incorrect password.' });

    await auth.clearLimit(req);
    const expiresAt = auth.startSession(res, name, v.pv);
    auth.send(res, 200, { ok: true, name, passwordChanged: v.changed, expiresAt });
  } catch (e) { auth.fail(res, e); }
};