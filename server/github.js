'use strict';

const crypto = require('crypto');

const DATA_FILE = 'data/site-data.json';
const IMG_DIR = 'images/products';
const PREFIX = 'zy-';

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

function config() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) {
    const e = new Error('GitHub is not set up on the server. Add GITHUB_OWNER, GITHUB_REPO and GITHUB_TOKEN in Vercel.');
    e.status = 500;
    throw e;
  }
  return {
    owner, repo, token,
    branch: process.env.GITHUB_BRANCH || 'main',
    root: String(process.env.SITE_ROOT || '').replace(/^\.?\/+|\/+$/g, '')
  };
}

const inRepo = (c, p) => (c.root ? c.root + '/' : '') + p;

function friendly(status, message) {
  if (status === 401) return 'GitHub rejected the server token. It may have expired: make a new one and update GITHUB_TOKEN in Vercel.';
  if (status === 403) return 'GitHub refused the request. The token needs Contents: Read and write on this repository (or GitHub is rate limiting).';
  if (status === 404) return 'GitHub could not find the repository or branch. Check GITHUB_OWNER, GITHUB_REPO and GITHUB_BRANCH in Vercel.';
  if (status === 409 || status === 422) return 'The repository changed while publishing. Please try again.';
  return message || 'GitHub error ' + status;
}

async function gh(c, method, path, body) {
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: Object.assign({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + c.token,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'zyno-admin'
    }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    const err = new Error(friendly(res.status, json && json.message));
    err.ghStatus = res.status;
    err.status = 502;
    throw err;
  }
  return json;
}

/* ---------- One photo -> a git blob (not yet in the repository) ---------- */
async function uploadPhoto(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) { const e = new Error('That is not a valid image.'); e.status = 400; throw e; }
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const c = config();
  const blob = await gh(c, 'POST', '/repos/' + c.owner + '/' + c.repo + '/git/blobs', { content: m[2], encoding: 'base64' });
  const name = PREFIX + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + '.' + ext;
  return { path: IMG_DIR + '/' + name, sha: blob.sha };
}

/* ---------- The whole publish: one commit ---------- */
async function publishSite(site, files, baseId, force) {
  const c = config();
  const base = '/repos/' + c.owner + '/' + c.repo;
  const bp = enc(c.branch);
  const dataPath = inRepo(c, DATA_FILE);

  const ref = await gh(c, 'GET', base + '/git/ref/heads/' + bp);
  const headSha = ref.object.sha;
  const head = await gh(c, 'GET', base + '/git/commits/' + headSha);
  const treeSha = head.tree.sha;

  // Has someone published from another browser since this one last did?
  let remote = null;
  try {
    const f = await gh(c, 'GET', base + '/contents/' + enc(dataPath) + '?ref=' + encodeURIComponent(c.branch));
    if (f && f.encoding === 'base64' && f.content) remote = JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
  } catch (e) {
    if (e.ghStatus !== 404 && !(e instanceof SyntaxError)) throw e;
  }
  const remoteId = remote && remote.meta && remote.meta.publishId;
  if (!force && remoteId && remoteId !== baseId) {
    const err = new Error('The live site was updated from another browser or device.');
    err.status = 409;
    err.conflict = true;
    throw err;
  }

  const stamp = new Date().toISOString();
  const publishId = crypto.randomBytes(8).toString('hex');
  const out = Object.assign({}, site, {
    meta: Object.assign({}, site.meta, { updatedAt: stamp, publishedAt: stamp, publishId })
  });

  const jsonBlob = await gh(c, 'POST', base + '/git/blobs', { content: JSON.stringify(out, null, 2), encoding: 'utf-8' });
  const entries = [{ path: dataPath, mode: '100644', type: 'blob', sha: jsonBlob.sha }];
  files.forEach((f) => entries.push({ path: inRepo(c, f.path), mode: '100644', type: 'blob', sha: f.sha }));

  // Remove photos made by this dashboard that no product uses any more
  try {
    const tree = await gh(c, 'GET', base + '/git/trees/' + treeSha + '?recursive=1');
    if (!tree.truncated) {
      const keep = new Set();
      out.products.forEach((p) => (p.images || []).forEach((s) => keep.add(s)));
      const dir = inRepo(c, IMG_DIR) + '/';
      tree.tree.forEach((t) => {
        if (t.type !== 'blob' || t.path.indexOf(dir) !== 0) return;
        const file = t.path.slice(dir.length);
        if (file.indexOf('/') === -1 && file.indexOf(PREFIX) === 0 && !keep.has(IMG_DIR + '/' + file)) {
          entries.push({ path: t.path, mode: '100644', type: 'blob', sha: null });
        }
      });
    }
  } catch (e) { /* cleanup is optional */ }

  const newTree = await gh(c, 'POST', base + '/git/trees', { base_tree: treeSha, tree: entries });
  const commit = await gh(c, 'POST', base + '/git/commits', {
    message: 'Update website content from the admin dashboard',
    tree: newTree.sha,
    parents: [headSha]
  });
  await gh(c, 'PATCH', base + '/git/refs/heads/' + bp, { sha: commit.sha, force: false });

  return { publishId, publishedAt: stamp, commit: commit.sha };
}

module.exports = { uploadPhoto, publishSite };