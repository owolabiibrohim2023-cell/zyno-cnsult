'use strict';
const auth = require('../server/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return auth.send(res, 405, { error: 'Method not allowed.' });
  auth.clearSession(res);
  auth.send(res, 200, { ok: true });
};