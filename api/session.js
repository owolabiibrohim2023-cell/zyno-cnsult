'use strict';
const auth = require('../server/auth');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const s = await auth.readSession(req);
      if (!s) return auth.send(res, 401, { ok: false });
      return auth.send(res, 200, { ok: true, name: s.name, passwordChanged: s.passwordChanged, expiresAt: s.expiresAt });
    }
    if (req.method === 'POST') {            // "Stay signed in": renews the session
      if (!auth.guard(req)) return auth.send(res, 403, { error: 'Blocked.' });
      const s = await auth.readSession(req);
      if (!s) return auth.send(res, 401, { ok: false });
      const expiresAt = auth.startSession(res, s.name, s.pv);
      return auth.send(res, 200, { ok: true, name: s.name, passwordChanged: s.passwordChanged, expiresAt });
    }
    auth.send(res, 405, { error: 'Method not allowed.' });
  } catch (e) { auth.fail(res, e); }
};