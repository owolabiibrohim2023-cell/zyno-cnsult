'use strict';
const auth = require('../server/auth');
const github = require('../server/github');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return auth.send(res, 405, { error: 'Method not allowed.' });
    if (!auth.guard(req)) return auth.send(res, 403, { error: 'Blocked.' });
    if (!(await auth.requireSession(req, res))) return;

    const b = auth.body(req);
    const dataUrl = typeof b.dataUrl === 'string' ? b.dataUrl : '';
    if (!dataUrl || dataUrl.length > 2500000) return auth.send(res, 400, { error: 'This image is too large. Remove it and add a smaller one.' });

    const out = await github.uploadPhoto(dataUrl);
    auth.send(res, 200, { ok: true, path: out.path, sha: out.sha });
  } catch (e) { auth.fail(res, e); }
};