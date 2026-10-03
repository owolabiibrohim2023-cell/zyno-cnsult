'use strict';
const auth = require('../server/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return auth.send(res, 405, { error: 'Method not allowed.' });
    if (!auth.guard(req)) return auth.send(res, 403, { error: 'Blocked.' });

    const s = await auth.requireSession(req, res);
    if (!s) return;
    if (!(await auth.limit(req))) return auth.send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });

    const b = auth.body(req);
    const current = typeof b.current === 'string' ? b.current : '';
    const next = typeof b.next === 'string' ? b.next : '';
    if (next.length < 8 || next.length > 200) return auth.send(res, 400, { reason: 'weak', error: 'Use a new password of 8 to 200 characters.' });
    if (next === current) return auth.send(res, 400, { reason: 'weak', error: 'Choose a password different from the current one.' });

    const v = await auth.verify(current);
    if (!v.ok) return auth.send(res, 401, { ok: false, reason: 'wrong', error: 'That is not your current password.' });

    await auth.clearLimit(req);
    const version = await auth.setPassword(next);
    const expiresAt = auth.startSession(res, s.name, version);   // this browser stays signed in; all others are signed out
    auth.send(res, 200, { ok: true, expiresAt });
  } catch (e) { auth.fail(res, e); }
};