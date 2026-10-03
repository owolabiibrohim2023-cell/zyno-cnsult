/* ZYNO-CONSULT admin: automatic publish.
   Every change is saved to GitHub a few seconds later by the Vercel function.
   Nothing to enter in the browser. */
(() => {
  'use strict';

  const App = window.AdminApp;
  const Z = window.Zyno;
  const A = window.ZynoAuth;
  if (!App || !Z || !A) { console.warn('admin.js, js/store.js and js/auth.js must load before publish.js'); return; }

  const { el, toast } = App;

  const AUTO_KEY = 'zyno_auto';
  const AUTO_DELAY = 4000;          // wait 4 seconds after the last change, so quick edits go out together

  let busy = false;
  let queued = false;
  let blocked = false;              // set when you cancel a conflict, until you press Publish yourself
  let timer = null;

  const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; } };

  /* ---------- Talking to the server ---------- */
  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Zyno': '1' },
      body: JSON.stringify(body)
    });
    let json = {};
    try { json = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 401) {
      A.endSession();
      location.replace('login.html?expired=1');
      const gone = new Error('Signed out.');
      gone.cancelled = true;
      throw gone;
    }
    return { status: res.status, ok: res.ok, json };
  }

  function apiError(r) {
    return new Error((r.json && r.json.error) || 'Publishing failed (error ' + r.status + '). Is the Vercel setup finished?');
  }

  /* ---------- Status pill ---------- */
  const pill = document.getElementById('pubState');
  function pillText(text, busyLook) {
    if (!pill) return;
    pill.classList.toggle('is-busy', Boolean(busyLook));
    if (busyLook) pill.classList.remove('is-warn');
    pill.querySelector('span').textContent = text;
  }
  function restorePill() {
    if (pill) pill.classList.remove('is-busy');
    App.updateIndicator();
  }

  function isUnpublished() {
    if (!Z.getLocal()) return false;
    const m = App.state.data.meta || {};
    return !m.publishedAt || new Date(m.updatedAt) > new Date(m.publishedAt);
  }

  /* ---------- Conflict dialog ---------- */
  function askConflict() {
    return new Promise((resolve) => {
      const dlg = el('dialog', 'dlg');
      dlg.setAttribute('aria-labelledby', 'cf-h');
      const h = el('h2', null, 'The live site was updated elsewhere');
      h.id = 'cf-h';
      let answer = 'cancel';
      const mk = (label, cls, value) => {
        const b = el('button', cls, label);
        b.type = 'button';
        b.addEventListener('click', () => { answer = value; dlg.close(); });
        return b;
      };
      const actions = el('div', 'dlg__actions');
      actions.append(
        mk('Cancel', 'btn btn--ghost', 'cancel'),
        mk('Load the latest', 'btn btn--ghost', 'reload'),
        mk('Publish anyway', 'btn btn--danger-solid', 'force')
      );
      dlg.append(
        h,
        el('p', null, 'Newer content was published from another browser or device. Load the latest to start from it (your unpublished changes here are discarded), or publish anyway to replace it with what is in this browser.'),
        actions
      );
      dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  /* ---------- The publish ---------- */
  async function publishNow(opts) {
    const auto = Boolean(opts && opts.auto);
    clearTimeout(timer);
    timer = null;

    if (busy) { queued = true; return; }
    if (!isUnpublished() && App.state.source !== 'default') {
      if (!auto) toast('Nothing new to publish. The live site already matches this dashboard.');
      restorePill();
      return;
    }

    busy = true;
    try {
      pillText('Publishing\u2026', true);
      const snapUpdated = App.state.data.meta.updatedAt;
      const snap = JSON.parse(JSON.stringify(App.state.data));

      // 1. New photos go up one at a time (keeps each request small)
      const jobs = [];
      const files = [];
      snap.products.forEach((p) => p.images.forEach((src, i) => { if (/^data:/i.test(src)) jobs.push({ pid: p.id, i, src }); }));
      let n = 0;
      for (const job of jobs) {
        n++;
        pillText('Uploading photo ' + n + ' of ' + jobs.length + '\u2026', true);
        const r = await post('/api/upload-image', { dataUrl: job.src });
        if (!r.ok) throw apiError(r);
        job.path = r.json.path;
        files.push({ path: r.json.path, sha: r.json.sha });
        snap.products.find((p) => p.id === job.pid).images[job.i] = job.path;
      }

      // 2. One commit with the content and the photos
      pillText('Publishing\u2026', true);
      const payload = { data: snap, files, base: snap.meta.publishId || null, force: Boolean(opts && opts.force) };
      let r = await post('/api/publish', payload);

      if (r.status === 409 && r.json.conflict) {
        const choice = await askConflict();
        if (choice === 'reload') { Z.clearLocal(); location.reload(); return; }
        if (choice !== 'force') {
          blocked = true;
          const stop = new Error('Publishing was cancelled.');
          stop.cancelled = true;
          throw stop;
        }
        pillText('Publishing\u2026', true);
        r = await post('/api/publish', Object.assign({}, payload, { force: true }));
      }
      if (!r.ok) throw apiError(r);

      // 3. Keep this browser in step, without losing anything edited while publishing
      const cur = App.state.data;
      jobs.forEach((job) => {
        const p = cur.products.find((x) => x.id === job.pid);
        if (!p) return;
        const k = p.images.indexOf(job.src);
        if (k > -1) p.images[k] = job.path;
      });
      const untouched = cur.meta.updatedAt === snapUpdated;
      cur.meta = Object.assign({}, cur.meta, {
        publishId: r.json.publishId,
        publishedAt: untouched ? r.json.publishedAt : snapUpdated
      });
      if (untouched) cur.meta.updatedAt = r.json.publishedAt;
      try { localStorage.setItem(Z.KEY, JSON.stringify(cur)); } catch (e) { /* ignore */ }
      App.state.source = 'published';

      restorePill();
      toast('Published. Your website updates in about a minute.');
    } catch (e) {
      restorePill();
      if (!e.cancelled) {
        toast(e instanceof TypeError ? 'Could not reach the server. Check your connection, then press Publish.' : e.message + ' Press Publish to try again.', 'err', 9000);
      }
    } finally {
      busy = false;
      if (queued) { queued = false; if (isUnpublished()) scheduleAuto(); }
    }
  }

  function scheduleAuto() {
    if (!autoOn() || blocked) return;
    if (busy) { queued = true; return; }
    clearTimeout(timer);
    pillText('Publishing in a moment\u2026', false);
    if (pill) pill.classList.add('is-warn');
    timer = setTimeout(() => { timer = null; publishNow({ auto: true }); }, AUTO_DELAY);
  }

  /* ---------- Wiring ---------- */
  App.publishHandler = () => { blocked = false; return publishNow({ auto: false }); };
  App.afterSave = scheduleAuto;

  const sw = document.getElementById('autoPub');
  if (sw) {
    sw.setAttribute('aria-checked', String(autoOn()));
    sw.addEventListener('click', () => {
      const on = !autoOn();
      try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
      sw.setAttribute('aria-checked', String(on));
      if (on) {
        blocked = false;
        toast('Auto-publish is on. Changes go live a few seconds after you save.');
        if (isUnpublished()) scheduleAuto();
      } else {
        clearTimeout(timer);
        timer = null;
        restorePill();
        toast('Auto-publish is off. Press Publish when you are ready.');
      }
    });
  }

  // Do not close the tab while a publish is running or about to start
  window.addEventListener('beforeunload', (e) => {
    if (busy || timer) { e.preventDefault(); e.returnValue = ''; }
  });
})();