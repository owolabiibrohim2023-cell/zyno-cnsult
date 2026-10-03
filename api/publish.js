'use strict';
const auth = require('../server/auth');
const github = require('../server/github');

const bad = (message) => { const e = new Error(message); e.status = 400; return e; };

function validate(d) {
  if (!d || typeof d !== 'object') throw bad('The content is missing.');
  if (!Array.isArray(d.services) || !Array.isArray(d.products) || !d.settings || typeof d.settings !== 'object') {
    throw bad('The content is not in the expected format.');
  }
  if (d.services.length > 100 || d.products.length > 1000) throw bad('There is too much content.');
  d.products.forEach((p) => (p.images || []).forEach((src) => {
    if (typeof src !== 'string' || /^data:/i.test(src) || /^(javascript|vbscript):/i.test(src)) {
      throw bad('A product image is not valid. Remove it and add it again.');
    }
  }));
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return auth.send(res, 405, { error: 'Method not allowed.' });
    if (!auth.guard(req)) return auth.send(res, 403, { error: 'Blocked.' });
    if (!(await auth.requireSession(req, res))) return;

    const b = auth.body(req);
    validate(b.data);

    // Only photo files that this dashboard made, and only ones a product still uses
    const used = new Set();
    b.data.products.forEach((p) => (p.images || []).forEach((s) => used.add(s)));
    const files = (Array.isArray(b.files) ? b.files : [])
      .slice(0, 60)
      .filter((f) => f && /^images\/products\/zy-[a-z0-9]+\.(jpg|png|webp|gif)$/.test(f.path) && /^[a-f0-9]{40}$/.test(f.sha) && used.has(f.path));

    const result = await github.publishSite(b.data, files, b.base || null, Boolean(b.force));
    auth.send(res, 200, { ok: true, publishId: result.publishId, publishedAt: result.publishedAt });
  } catch (e) { auth.fail(res, e); }
};