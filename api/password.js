'use strict';
const crypto = require('crypto');
const auth = require('../server/auth');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return auth.send(res, 405, { error: 'Method not allowed.' });
    if (!auth.guard(req)) return auth.send(res, 403, { error: 'Blocked.' });
    if (!(await auth.limit(req, 5))) return auth.send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });

    const key = process.env.RECOVERY_KEY || '';
    if (key.length < 12) return auth.send(res, 500, { error: 'Password recovery is not set up yet. Ask your web developer.' });

    const b = auth.body(req);
    const given = typeof b.key === 'string' ? b.key : '';
    const next = typeof b.next === 'string' ? b.next : '';

    if (next.length < 8 || next.length > 200) {
      return auth.send(res, 400, { reason: 'weak', error: 'Use a new password of 8 to 200 characters.' });
    }
    if (!crypto.timingSafeEqual(digest(given), digest(key))) {
      return auth.send(res, 401, { ok: false, reason: 'key', error: 'That recovery key is not correct.' });
    }

    await auth.clearLimit(req);
    await auth.setPassword(next);          // also signs out every device that was logged in
    auth.send(res, 200, { ok: true });
  } catch (e) { auth.fail(res, e); }
};