/* ZYNO-CONSULT admin dashboard: shell, session, stats, publish.
   Later steps plug their pages in with AdminApp.registerRoute('services', fn) etc. */
(() => {
  'use strict';

  const Z = window.Zyno;
  const A = window.ZynoAuth;
  if (!Z || !A) {
    document.body.textContent = 'Missing js/store.js or js/auth.js';
    return;
  }

  // Not signed in: go to the login page
  const session = A.requireSession('login.html');
  if (!session) return;

  const PUBLISHED_URL = '../data/site-data.json';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { data: null, source: 'default' };
  const routes = {};
  const titles = { overview: 'Overview', services: 'Services', products: 'Products', settings: 'Settings' };

  /* ---------- Small helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const ICONS = {
    layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.5 7.7C3.8 9.4 2 12 2 12s4 6 10 6a9 9 0 0 0 3.4-.7"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'
  };

  function svgIcon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const doc = new DOMParser().parseFromString('<svg xmlns="' + NS + '">' + (ICONS[name] || '') + '</svg>', 'image/svg+xml');
    Array.from(doc.documentElement.childNodes).forEach((n) => svg.appendChild(document.importNode(n, true)));
    return svg;
  }

  function safeSrc(v) {
    const s = String(v || '').trim();
    if (!s || /^(javascript|vbscript):/i.test(s)) return false;
    if (/^data:/i.test(s)) return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s);
    return true;
  }

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? 'Unknown' : d.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const fmtDay = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-NG', { dateStyle: 'medium' });
  };
  const fmtBytes = (n) => (n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(2) + ' MB');
  const priceText = (p) => (p.price !== null ? Z.money(p.price) : p.priceNote || '-');

  /* ---------- Toasts ---------- */
  function toast(message, type = 'ok', ms = 4200) {
    const box = $('#toasts');
    const t = el('div', 'toast toast--' + type);
    t.setAttribute('role', type === 'err' ? 'alert' : 'status');
    t.appendChild(el('span', null, message));
    const x = el('button', 'toast__x', '\u00D7');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', () => t.remove());
    t.appendChild(x);
    box.appendChild(t);
    setTimeout(() => {
      t.classList.add('is-out');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  /* ---------- Saving + publishing ---------- */
  function isUnpublished() {
    if (!Z.getLocal()) return false;              // nothing edited in this browser yet
    const m = state.data.meta || {};
    if (!m.publishedAt) return true;
    return new Date(m.updatedAt) > new Date(m.publishedAt);
  }

  function updateIndicator() {
    const pill = $('#pubState');
    const warn = isUnpublished();
    pill.classList.toggle('is-warn', warn);
    pill.querySelector('span').textContent = warn ? 'Unpublished changes' : 'Up to date';
    pill.title = warn ? 'Your changes are saved in this browser. Publish to show them to visitors.' : 'Visitors see the same content as this dashboard.';
  }

  // Later steps call this after every change
  function save() {
    const res = Z.saveData(state.data);
    if (!res.ok) { toast(res.error, 'err', 7000); return false; }
    updateIndicator();
    return true;
  }

  function publish() {
    const out = JSON.parse(JSON.stringify(state.data));
    const stamp = new Date().toISOString();
    out.meta = Object.assign({}, out.meta, { updatedAt: stamp, publishedAt: stamp });

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const large = blob.size > 2 * 1024 * 1024;
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = 'site-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    state.data = out;
    try { localStorage.setItem(Z.KEY, JSON.stringify(out)); } catch (e) {
      toast('The file was downloaded, but the published timestamp could not be saved in this browser.', 'err', 7000);
    }
    updateIndicator();
    if (parseHash().name === 'overview') render();
    toast(large
      ? 'site-data.json downloaded. It is over 2 MB; move uploaded images to paths or URLs. Upload it to data/site-data.json.'
      : 'site-data.json downloaded. Upload it to your hosting, replacing data/site-data.json, then refresh the site.', large ? 'err' : 'ok', 10000);
    return blob.size;
  }

  /* ---------- Router ---------- */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
    return { name: parts[0] || 'overview', params: parts.slice(1) };
  }

  function render(focus) {
    if (!state.data) return;
    let { name, params } = parseHash();
    if (!routes[name]) { name = 'overview'; params = []; }

    $$('[data-route]').forEach((a) => {
      if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#pageTitle').textContent = titles[name] || name;
    document.title = (titles[name] || name) + ' | ZYNO-CONSULT Admin';

    const view = $('#view');
    view.replaceChildren();
    routes[name](view, params);
    closeDrawer();
    if (focus) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
  }

  function registerRoute(name, fn) {
    routes[name] = fn;
    if (state.data && parseHash().name === name) render();
  }

  window.addEventListener('hashchange', () => render(true));

  /* ---------- Overview page ---------- */
  function computeStats(d) {
    const p = d.products;
    return {
      services: d.services.length,
      visibleServices: d.services.filter((s) => s.visible !== false).length,
      products: p.length,
      available: p.filter((x) => x.status === 'available').length,
      sold: p.filter((x) => x.status === 'sold').length,
      hidden: p.filter((x) => x.status === 'hidden').length,
      featured: p.filter((x) => x.featured).length
    };
  }

  function statCard(def) {
    const c = el('article', 'stat');
    const top = el('div', 'stat__top');
    const ic = el('span', 'stat__ico');
    ic.appendChild(svgIcon(def.icon));
    top.append(el('span', 'stat__label', def.label), ic);
    const num = el('div', 'stat__num', '0');
    num.dataset.count = def.value;
    c.append(top, num, el('p', 'stat__sub', def.sub));
    return c;
  }

  function storageCard() {
    const u = Z.storageUsage();
    const c = el('article', 'stat');
    const top = el('div', 'stat__top');
    const ic = el('span', 'stat__ico');
    ic.appendChild(svgIcon('db'));
    top.append(el('span', 'stat__label', 'Storage used'), ic);

    const meter = el('div', 'meter' + (u.pct >= 90 ? ' meter--bad' : u.pct >= 70 ? ' meter--warn' : ''));
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.setAttribute('aria-valuenow', String(u.pct));
    meter.setAttribute('aria-label', 'Browser storage used');
    const bar = el('i');
    meter.appendChild(bar);
    requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--w', Math.max(u.pct, 1) + '%')));
    if (reduceMotion) bar.style.setProperty('--w', Math.max(u.pct, 1) + '%');

    c.append(top, el('div', 'stat__num', fmtBytes(u.used)), meter, el('p', 'stat__sub', 'of ' + fmtBytes(u.limit) + ' (' + u.pct + '%)'));
    return c;
  }

  function infoMini(label, value) {
    const c = el('article', 'mini mini--info');
    const body = el('div', 'mini__body');
    body.append(el('span', 'mini__label', label), el('strong', null, value));
    c.appendChild(body);
    return c;
  }

  function servicesRow(d) {
    const row = el('div', 'minis');
    d.services.slice().sort((a, b) => a.order - b.order).forEach((s) => {
      const n = d.products.filter((p) => p.serviceId === s.id).length;
      const c = el('article', 'mini');
      const ic = el('span', 'mini__ico');
      ic.appendChild(Z.iconSvg(s.icon));
      const body = el('div', 'mini__body');
      const num = el('strong', 'mini__num', '0');
      num.dataset.count = n;
      body.append(el('span', 'mini__name', s.title), num, el('span', 'mini__label', n === 1 ? 'product' : 'products'));
      c.append(ic, body);
      if (s.visible === false) c.appendChild(el('span', 'badge badge--hidden', 'Hidden'));
      row.appendChild(c);
    });

    const m = d.meta || {};
    row.appendChild(infoMini('Last saved', Z.getLocal() ? fmtDate(m.updatedAt) : 'No changes yet'));
    row.appendChild(infoMini('Last published', m.publishedAt ? fmtDate(m.publishedAt) : 'Not published yet'));
    return row;
  }

  function recentPanel(d) {
    const panel = el('section', 'panel');
    const head = el('div', 'panel__head');
    const all = el('a', null, 'View all products');
    all.href = '#products';
    head.append(el('h2', null, 'Recently added products'), all);
    panel.appendChild(head);

    const list = d.products.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    if (!list.length) {
      panel.appendChild(el('p', 'panel__empty', 'No products yet. Add your first one from the Products page.'));
      return panel;
    }

    const table = el('table', 'table');
    const thead = el('thead');
    const hr = el('tr');
    ['Product', 'Service', 'Price', 'Status', 'Added', ''].forEach((h) => hr.appendChild(el('th', null, h)));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el('tbody');
    list.forEach((p) => {
      const svc = d.services.find((s) => s.id === p.serviceId);
      const tr = el('tr');

      const tdProd = el('td', 'cell-prod');
      const box = el('div', 'prod');
      if (p.images[0] && safeSrc(p.images[0])) {
        const img = document.createElement('img');
        img.className = 'prod__thumb';
        img.src = /^(data:|https?:|\/)/i.test(p.images[0]) ? p.images[0] : '../' + p.images[0];
        img.alt = '';
        img.width = 46;
        img.height = 46;
        img.loading = 'lazy';
        box.appendChild(img);
      } else {
        const ph = el('span', 'prod__thumb');
        ph.appendChild(Z.iconSvg(svc ? svc.icon : 'globe'));
        box.appendChild(ph);
      }
      box.appendChild(el('span', 'prod__name', p.name));
      tdProd.appendChild(box);

      const cell = (label, content) => {
        const td = el('td');
        td.dataset.label = label;
        if (content instanceof Node) td.appendChild(content);
        else td.textContent = content;
        return td;
      };

      const tdAct = el('td', 'cell-act');
      const edit = el('a', 'btn btn--ghost btn--sm', 'Edit');
      edit.href = '#products/edit/' + encodeURIComponent(p.id);
      tdAct.appendChild(edit);

      tr.append(
        tdProd,
        cell('Service', svc ? svc.title : 'None'),
        cell('Price', priceText(p)),
        cell('Status', el('span', 'badge badge--' + p.status, p.status.charAt(0).toUpperCase() + p.status.slice(1))),
        cell('Added', fmtDay(p.createdAt)),
        tdAct
      );
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.appendChild(table);
    return panel;
  }

  function countUp(root) {
    $$('[data-count]', root).forEach((n) => {
      const target = Number(n.dataset.count) || 0;
      if (reduceMotion || target === 0) { n.textContent = target.toLocaleString('en-NG'); return; }
      const t0 = performance.now();
      const dur = 800;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        n.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString('en-NG');
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function renderOverview(view) {
    const d = state.data;
    const st = computeStats(d);
    const wrap = el('div', 'overview');

    const grid = el('div', 'stats');
    [
      { label: 'Total services', value: st.services, icon: 'layers', sub: (st.services - st.visibleServices) + ' hidden' },
      { label: 'Visible services', value: st.visibleServices, icon: 'eye', sub: 'shown on the website' },
      { label: 'Total products', value: st.products, icon: 'box', sub: 'across all services' },
      { label: 'Available products', value: st.available, icon: 'check', sub: 'ready to order' },
      { label: 'Sold products', value: st.sold, icon: 'tag', sub: 'marked as sold' },
      { label: 'Hidden products', value: st.hidden, icon: 'eyeoff', sub: 'not shown on the site' },
      { label: 'Featured products', value: st.featured, icon: 'star', sub: 'highlighted on the site' }
    ].forEach((c) => grid.appendChild(statCard(c)));
    grid.appendChild(storageCard());
    wrap.appendChild(grid);

    wrap.appendChild(el('h2', 'sec-title', 'Products by service'));
    wrap.appendChild(servicesRow(d));
    wrap.appendChild(recentPanel(d));

    view.appendChild(wrap);
    countUp(wrap);
  }

  function placeholder(title, text) {
    return (view) => {
      const c = el('section', 'panel panel--pad');
      c.append(el('h2', 'sec-title', title), el('p', 'muted', text));
      const back = el('a', 'btn btn--ghost btn--sm', 'Back to overview');
      back.href = '#overview';
      c.appendChild(back);
      view.appendChild(c);
    };
  }

  routes.overview = renderOverview;
  routes.services = placeholder('Services management', 'This page is added in the next step.');
  routes.products = placeholder('Products management', 'This page is added in a later step.');
  routes.settings = placeholder('Settings', 'Loading settings…');

  /* ---------- Mobile drawer ---------- */
  const burger = $('#burger');
  function closeDrawer() {
    document.body.classList.remove('nav-open');
    burger.setAttribute('aria-expanded', 'false');
  }
  burger.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  window.matchMedia('(min-width: 901px)').addEventListener('change', closeDrawer);

  /* ---------- Log out + session timer ---------- */
  function logout() {
    A.endSession();
    location.replace('login.html');
  }
  $('#logoutSide').addEventListener('click', logout);
  $('#logoutTop').addEventListener('click', logout);
  $('#publishBtn').addEventListener('click', publish);

  const dlg = $('#sessionDialog');
  let dismissed = false;
  const mmss = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  function tick() {
    const s = A.getSession();
    if (!s) { location.replace('login.html?expired=1'); return; }
    const left = s.expiresAt - Date.now();
    if (left <= (dismissed ? 60 : 300) * 1000) {
      $('#sessionLeft').textContent = mmss(left);
      if (!dlg.open && typeof dlg.showModal === 'function') dlg.showModal();
    }
  }
  setInterval(tick, 1000);

  $('#sessionStay').addEventListener('click', () => { A.extendSession(); dismissed = false; dlg.close(); });
  $('#sessionOut').addEventListener('click', logout);
  dlg.addEventListener('cancel', () => { dismissed = true; });

  /* ---------- Start ---------- */
  $('#userName').textContent = session.username;
  $('#userAv').textContent = session.username.charAt(0).toUpperCase();

  A.ensureAdmin().then(() => {
    const info = A.getAdminInfo();
    $('#pwBanner').hidden = !(info && !info.passwordChanged);
  }).catch(() => {});

  // Skeleton cards while the data loads
  const sk = el('div', 'stats');
  for (let i = 0; i < 8; i++) sk.appendChild(el('div', 'stat skel'));
  $('#view').appendChild(sk);

  Z.load(PUBLISHED_URL).then((res) => {
    state.data = res.data;
    state.source = res.source;
    updateIndicator();
    render();
  });

  window.AdminApp = { state, routes, registerRoute, render, toast, save, publish, updateIndicator, el, $, $$, svgIcon, safeSrc, fmtDate, fmtDay, priceText, countUp };
})();