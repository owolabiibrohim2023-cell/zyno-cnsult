/* ZYNO-CONSULT admin: one-click publish to GitHub.
   Saves site-data.json and any new product photos in ONE commit on your repository.
   Vercel sees the commit and redeploys the site by itself. */
(() => {
  'use strict';

  const App = window.AdminApp;
  const Z = window.Zyno;
  if (!App || !Z) { console.warn('admin.js and js/store.js must load before publish.js'); return; }

  const { el, toast } = App;

  const CFG_KEY = 'zyno_gh';          // saved in THIS browser only, never published
  const API = 'https://api.github.com';
  const DATA_FILE = 'data/site-data.json';
  const IMG_DIR = 'images/products';
  const PREFIX = 'zy-';               // photos made by this dashboard start with this, so only they are ever cleaned up

  let busy = false;

  /* ---------- Saved settings ---------- */
  function readCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY));
      return c && c.owner && c.repo && c.branch && c.token ? c : null;
    } catch (e) { return null; }
  }
  function writeCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }
  function clearCfg() { try { localStorage.removeItem(CFG_KEY); } catch (e) { /* ignore */ } }

  const cleanRoot = (v) => String(v || '').trim().replace(/^\.?\/+|\/+$/g, '');
  const inRepo = (cfg, p) => (cfg.root ? cfg.root + '/' : '') + p;
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  /* ---------- GitHub API ---------- */
  async function api(cfg, method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: Object.assign({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + cfg.token,
        'X-GitHub-Api-Version': '2022-11-28'
      }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((json && json.message) || 'GitHub error ' + res.status);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function friendly(e) {
    if (e instanceof TypeError) return 'Could not reach GitHub. Check your internet connection and try again.';
    if (e.status === 401) return 'GitHub rejected the token. It may be wrong or expired. Make a new one in Publish settings.';
    if (e.status === 403) return /rate limit/i.test(e.message)
      ? 'GitHub says too many requests were made. Wait a few minutes and try again.'
      : 'The token does not have permission. It needs Contents: Read and write on this repository.';
    if (e.status === 404) return 'Repository or branch not found, or the token cannot see this repository. Check the username, repository name, branch and the token\u2019s repository access.';
    if (e.status === 409 || e.status === 422) return 'The repository changed while publishing. Please try again.';
    return e.message || 'Something went wrong while publishing.';
  }

  function decodeBase64(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- Dialog helpers ---------- */
  function mount(dlg, closable) {
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    if (closable) {
      dlg.addEventListener('mousedown', (e) => {
        const r = dlg.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) dlg.close();
      });
    }
    dlg.showModal();
    return dlg;
  }

  function btn(label, cls, onClick) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function askOverwrite() {
    return new Promise((resolve) => {
      const dlg = el('dialog', 'dlg');
      dlg.setAttribute('aria-labelledby', 'ow-h');
      const h = el('h2', null, 'The live site was updated elsewhere');
      h.id = 'ow-h';
      const actions = el('div', 'dlg__actions');
      let answer = false;
      const no = btn('Cancel', 'btn btn--ghost', () => dlg.close());
      const yes = btn('Publish anyway', 'btn btn--danger-solid', () => { answer = true; dlg.close(); });
      actions.append(no, yes);
      dlg.append(h, el('p', null, 'Newer content was published from another browser or device. Publishing now replaces it with what is in this browser.'), actions);
      dlg.addEventListener('close', () => resolve(answer));
      mount(dlg, false);
      no.focus();
    });
  }

  /* ---------- Progress dialog ---------- */
  function progressDialog() {
    const dlg = el('dialog', 'dlg dlg--pw');
    dlg.setAttribute('aria-labelledby', 'pb-h');
    const h = el('h2', null, 'Publishing\u2026');
    h.id = 'pb-h';
    const list = el('ol', 'steps');
    const defs = [['check', 'Checking GitHub'], ['photos', 'Uploading photos'], ['save', 'Saving your content'], ['commit', 'Publishing to the website']];
    const items = {};
    defs.forEach(([k, label]) => {
      const li = el('li', 'steps__item is-pending');
      const txt = el('span', null, label);
      li.append(el('span', 'steps__dot'), txt);
      list.appendChild(li);
      items[k] = { li, txt, label };
    });
    const msg = el('p', 'steps__msg');
    msg.setAttribute('role', 'status');
    const actions = el('div', 'dlg__actions');
    actions.hidden = true;
    dlg.append(h, list, msg, actions);

    let running = true;
    let current = null;
    dlg.addEventListener('cancel', (e) => { if (running) e.preventDefault(); });
    mount(dlg, false);

    const api2 = {
      step(key, state, text) {
        const it = items[key];
        it.li.className = 'steps__item is-' + state;
        it.txt.textContent = text || it.label;
        if (state === 'active') current = key;
      },
      note(text) { msg.className = 'steps__msg'; msg.textContent = text || ''; },
      success(text, siteUrl) {
        running = false;
        h.textContent = 'Published';
        msg.className = 'steps__msg';
        msg.textContent = text;
        const live = el('a', 'btn btn--ghost', 'Open live site');
        live.href = siteUrl; live.target = '_blank'; live.rel = 'noopener';
        actions.replaceChildren(live, btn('Done', 'btn', () => dlg.close()));
        actions.hidden = false;
      },
      fail(text) {
        running = false;
        h.textContent = 'Could not publish';
        if (current) items[current].li.className = 'steps__item is-error';
        msg.className = 'steps__msg is-err';
        msg.textContent = text;
        actions.replaceChildren(
          btn('Publish settings', 'btn btn--ghost', () => { dlg.close(); openSettings({}); }),
          btn('Close', 'btn', () => dlg.close())
        );
        actions.hidden = false;
      }
    };
    return api2;
  }

  /* ---------- The publish itself ---------- */
  function isUnpublished() {
    const local = Z.getLocal();
    if (!local) return false;
    const m = App.state.data.meta || {};
    return !m.publishedAt || new Date(m.updatedAt) > new Date(m.publishedAt);
  }

  async function run(cfg, pd) {
    const base = '/repos/' + cfg.owner + '/' + cfg.repo;
    const branchPath = encPath(cfg.branch);
    const dataPath = inRepo(cfg, DATA_FILE);

    // 1. Where does the branch point right now?
    pd.step('check', 'active');
    const ref = await api(cfg, 'GET', base + '/git/ref/heads/' + branchPath);
    const headSha = ref.object.sha;
    const head = await api(cfg, 'GET', base + '/git/commits/' + headSha);
    const treeSha = head.tree.sha;

    // Has someone else published since this browser last did?
    let remote = null;
    try {
      const f = await api(cfg, 'GET', base + '/contents/' + encPath(dataPath) + '?ref=' + encodeURIComponent(cfg.branch));
      if (f && f.encoding === 'base64' && f.content) remote = JSON.parse(decodeBase64(f.content));
    } catch (e) {
      if (e.status && e.status !== 404) throw e;
    }
    const remotePub = remote && remote.meta && remote.meta.publishedAt;
    const localPub = App.state.data.meta && App.state.data.meta.publishedAt;
    if (remotePub && (!localPub || new Date(remotePub) > new Date(localPub))) {
      if (!(await askOverwrite())) { const err = new Error('Publishing was cancelled.'); err.cancelled = true; throw err; }
    }
    pd.step('check', 'done');

    // 2. Upload new photos (anything still stored inside the browser)
    const out = JSON.parse(JSON.stringify(App.state.data));
    const entries = [];
    const jobs = [];
    out.products.forEach((p) => p.images.forEach((src, i) => { if (/^data:/i.test(src)) jobs.push({ p, i, src }); }));

    if (!jobs.length) {
      pd.step('photos', 'done', 'No new photos');
    } else {
      pd.step('photos', 'active', 'Uploading photos (0 of ' + jobs.length + ')');
      let n = 0;
      for (const job of jobs) {
        const m = job.src.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
        if (!m) throw new Error('One of the images is not valid. Remove it in Products and add it again.');
        const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
        const name = PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + ext;
        const blob = await api(cfg, 'POST', base + '/git/blobs', { content: m[2], encoding: 'base64' });
        entries.push({ path: inRepo(cfg, IMG_DIR + '/' + name), mode: '100644', type: 'blob', sha: blob.sha });
        job.p.images[job.i] = IMG_DIR + '/' + name;
        n++;
        pd.step('photos', 'active', 'Uploading photos (' + n + ' of ' + jobs.length + ')');
      }
      pd.step('photos', 'done', 'Uploaded ' + jobs.length + (jobs.length === 1 ? ' photo' : ' photos'));
    }

    // 3. The content file
    pd.step('save', 'active');
    const stamp = new Date().toISOString();
    out.meta = Object.assign({}, out.meta, { updatedAt: stamp, publishedAt: stamp });
    const jsonBlob = await api(cfg, 'POST', base + '/git/blobs', { content: JSON.stringify(out, null, 2), encoding: 'utf-8' });
    entries.push({ path: dataPath, mode: '100644', type: 'blob', sha: jsonBlob.sha });

    // Tidy up: remove photos this dashboard made earlier that no product uses any more
    try {
      const tree = await api(cfg, 'GET', base + '/git/trees/' + treeSha + '?recursive=1');
      if (!tree.truncated) {
        const keep = new Set(out.products.reduce((all, p) => all.concat(p.images), []));
        const dir = inRepo(cfg, IMG_DIR) + '/';
        tree.tree.forEach((t) => {
          if (t.type !== 'blob' || t.path.indexOf(dir) !== 0) return;
          const file = t.path.slice(dir.length);
          if (file.indexOf('/') === -1 && file.indexOf(PREFIX) === 0 && !keep.has(IMG_DIR + '/' + file)) {
            entries.push({ path: t.path, mode: '100644', type: 'blob', sha: null });
          }
        });
      }
    } catch (e) { /* cleanup is optional */ }
    pd.step('save', 'done');

    // 4. One commit on the branch. Vercel redeploys when it sees it.
    pd.step('commit', 'active');
    const newTree = await api(cfg, 'POST', base + '/git/trees', { base_tree: treeSha, tree: entries });
    const commit = await api(cfg, 'POST', base + '/git/commits', {
      message: 'Update website content from the admin dashboard',
      tree: newTree.sha,
      parents: [headSha]
    });
    await api(cfg, 'PATCH', base + '/git/refs/heads/' + branchPath, { sha: commit.sha, force: false });
    pd.step('commit', 'done');

    return out;
  }

  async function publishNow() {
    if (busy) return;
    const cfg = readCfg();
    if (!cfg) { openSettings({ thenPublish: true }); return; }

    if (!isUnpublished() && App.state.source !== 'default') {
      toast('Nothing new to publish. The live site already matches this dashboard.');
      return;
    }

    busy = true;
    const pd = progressDialog();
    try {
      const out = await run(cfg, pd);

      // Keep this browser in step: photos are now files, so the browser copy gets much smaller
      App.state.data = out;
      try { localStorage.setItem(Z.KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
      App.updateIndicator();
      App.render();

      pd.success('Saved to GitHub. Vercel is updating the website now, which usually takes about a minute. Product photos may take a moment to appear in this dashboard.', '../index.html');
    } catch (e) {
      if (e.cancelled) {
        const dlg = document.querySelector('dialog[aria-labelledby="pb-h"]');
        if (dlg) { dlg.dispatchEvent(new Event('close')); dlg.remove(); }
        toast('Publishing cancelled.');
      } else {
        pd.fail(friendly(e));
      }
    } finally {
      busy = false;
    }
  }

  /* ---------- Settings dialog ---------- */
  async function testConnection(cfg) {
    const repo = await api(cfg, 'GET', '/repos/' + cfg.owner + '/' + cfg.repo);
    if (repo.permissions && repo.permissions.push === false) {
      const err = new Error('This token can only read the repository. It needs Contents: Read and write.');
      err.status = 0;
      throw err;
    }
    await api(cfg, 'GET', '/repos/' + cfg.owner + '/' + cfg.repo + '/branches/' + encPath(cfg.branch));
    return repo.full_name;
  }

  function field(id, label, value, hint, placeholder) {
    const wrap = el('div', 'field');
    const lab = el('label', null, label);
    lab.htmlFor = id;
    const input = el('input');
    input.type = 'text';
    input.id = id;
    input.value = value || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.autocapitalize = 'none';
    if (placeholder) input.placeholder = placeholder;
    wrap.append(lab, input);
    if (hint) wrap.appendChild(el('p', 'field__hint', hint));
    return { wrap, input };
  }

  function openSettings(opts) {
    const cur = readCfg() || {};
    const dlg = el('dialog', 'dlg dlg--wide');
    dlg.setAttribute('aria-labelledby', 'ps-h');
    const form = el('form');
    form.noValidate = true;

    const head = el('div', 'dlg__head');
    const h = el('h2', null, 'Publish settings');
    h.id = 'ps-h';
    const x = btn('\u00D7', 'mbtn', () => dlg.close());
    x.setAttribute('aria-label', 'Close');
    head.append(h, x);

    const body = el('div', 'dlg__body');
    body.appendChild(el('p', 'lead', 'Connect the dashboard to your GitHub repository once. After that, Publish saves your changes there and Vercel updates the website by itself.'));

    const fOwner = field('ps-owner', 'GitHub username', cur.owner, '', 'your-username');
    const fRepo = field('ps-repo', 'Repository name', cur.repo, '', 'zyno-consult-website');
    const row1 = el('div', 'frow');
    row1.append(fOwner.wrap, fRepo.wrap);

    const fBranch = field('ps-branch', 'Branch', cur.branch || 'main', 'The branch Vercel deploys. Usually main.');
    const fRoot = field('ps-root', 'Site folder (optional)', cur.root, 'Leave empty if index.html is at the top of the repository.');
    const row2 = el('div', 'frow');
    row2.append(fBranch.wrap, fRoot.wrap);

    // token
    const tWrap = el('div', 'field');
    const tLabel = el('label', null, 'GitHub token');
    tLabel.htmlFor = 'ps-token';
    const box = el('div', 'pw');
    const token = el('input');
    token.type = 'password';
    token.id = 'ps-token';
    token.autocomplete = 'off';
    token.spellcheck = false;
    token.placeholder = cur.token ? 'Saved. Leave empty to keep it.' : 'github_pat_\u2026';
    const tog = btn('Show', 'pw__toggle', () => {
      const show = token.type === 'password';
      token.type = show ? 'text' : 'password';
      tog.textContent = show ? 'Hide' : 'Show';
    });
    tog.setAttribute('aria-label', 'Show or hide the token');
    box.append(token, tog);
    tWrap.append(tLabel, box, el('p', 'field__hint', 'Saved in this browser only. It is never added to the website or the repository.'));

    const how = el('details', 'how');
    how.appendChild(el('summary', null, 'How to create the token'));
    const steps = el('ol');
    [
      'On GitHub open your profile picture, then Settings, then Developer settings.',
      'Choose Personal access tokens, then Fine-grained tokens, then Generate new token.',
      'Give it a name and an expiry date (for example 1 year).',
      'Under Repository access choose Only select repositories and pick this website\u2019s repository.',
      'Under Permissions, Repository permissions, set Contents to Read and write.',
      'Generate the token, copy it, and paste it above. GitHub shows it only once.'
    ].forEach((t) => steps.appendChild(el('li', null, t)));
    how.appendChild(steps);

    const status = el('p', 'ghmsg');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    body.append(row1, row2, tWrap, how, status);

    const foot = el('div', 'dlg__foot');
    const dl = btn('Download file instead', 'btn btn--ghost push', () => { dlg.close(); App.publish(); });
    const remove = cur.token ? btn('Remove token', 'btn btn--danger', () => {
      clearCfg();
      toast('Token removed from this browser.');
      dlg.close();
    }) : null;
    const test = btn('Test connection', 'btn btn--ghost', async () => {
      const r = collect();
      if (r.error) { say(r.error, true); return; }
      test.disabled = true;
      say('Testing\u2026');
      try {
        const name = await testConnection(r.cfg);
        say('Connected to ' + name + '. Publishing is ready.');
      } catch (e) {
        say(friendly(e), true);
      }
      test.disabled = false;
    });
    const save = el('button', 'btn', opts && opts.thenPublish ? 'Save and publish' : 'Save');
    save.type = 'submit';
    if (remove) foot.append(dl, remove, test, save);
    else foot.append(dl, test, save);

    form.append(head, body, foot);
    dlg.appendChild(form);

    function say(text, isErr) {
      status.textContent = text || '';
      status.classList.toggle('is-err', Boolean(isErr));
    }

    function collect() {
      let owner = fOwner.input.value.trim();
      let repo = fRepo.input.value.trim().replace(/\.git$/i, '');
      if (owner.indexOf('/') > -1 && !repo) { const p = owner.split('/'); owner = p[0]; repo = p[1]; }
      const branch = fBranch.input.value.trim() || 'main';
      const root = cleanRoot(fRoot.input.value);
      const tok = token.value.trim() || cur.token || '';

      if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) return { error: 'Enter your GitHub username (letters, numbers and hyphens).' };
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) return { error: 'Enter the repository name, for example zyno-consult-website.' };
      if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch) || branch.indexOf('..') > -1) return { error: 'That branch name is not valid.' };
      if (root && (!/^[A-Za-z0-9._\/-]+$/.test(root) || root.indexOf('..') > -1)) return { error: 'The site folder can only use letters, numbers, dots, hyphens and slashes.' };
      if (!tok) return { error: 'Paste your GitHub token.' };
      if (/\s/.test(tok)) return { error: 'The token cannot contain spaces.' };
      return { cfg: { owner, repo, branch, root, token: tok } };
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = collect();
      if (r.error) { say(r.error, true); return; }
      save.disabled = true;
      say('Checking\u2026');
      try {
        await testConnection(r.cfg);
      } catch (err) {
        say(friendly(err) + ' Fix it and try again.', true);
        save.disabled = false;
        return;
      }
      writeCfg(r.cfg);
      dlg.close();
      if (opts && opts.thenPublish) publishNow();
      else toast('Publish settings saved.');
    });

    mount(dlg, true);
    (cur.owner ? token : fOwner.input).focus();
  }

  /* ---------- Hook into the dashboard ---------- */
  App.publishHandler = publishNow;
  const side = document.getElementById('pubSettings');
  if (side) side.addEventListener('click', () => openSettings({}));
})();