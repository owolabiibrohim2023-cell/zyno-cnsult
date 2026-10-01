/* ZYNO-CONSULT admin: Products management page.
   Plugs into the dashboard shell (admin.js) through AdminApp.registerRoute. */
(() => {
  'use strict';

  const App = window.AdminApp;
  const Z = window.Zyno;
  if (!App || !Z) { console.warn('admin.js and js/store.js must load before products.js'); return; }

  const { el, toast } = App;

  const MAX_IMAGES = 4;
  const MAX_FILE = 5 * 1024 * 1024;   // 5 MB before compression
  const MAX_SIDE = 900;               // longest side after resizing, in pixels
  const QUALITY = 0.75;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const STATUSES = [['available', 'Available'], ['sold', 'Sold'], ['hidden', 'Hidden']];

  const PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'
  };

  const ui = { q: '', service: 'all', status: 'all', sort: 'newest', selected: new Set() };
  const refs = {};

  /* ---------- Small helpers ---------- */
  const data = () => App.state.data;
  const now = () => new Date().toISOString();
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const svcById = (id) => data().services.find((s) => s.id === id);
  const sortedServices = () => data().services.slice().sort((a, b) => a.order - b.order);
  const kb = (n) => (n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(2) + ' MB');

  function icon(name, cls) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls || 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const doc = new DOMParser().parseFromString('<svg xmlns="' + NS + '">' + PATHS[name] + '</svg>', 'image/svg+xml');
    Array.from(doc.documentElement.childNodes).forEach((n) => svg.appendChild(document.importNode(n, true)));
    return svg;
  }

  function button(label, cls, iconName, onClick) {
    const b = el('button', cls);
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName));
    if (label) b.append(label);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function mountDialog(dlg) {
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('mousedown', (e) => {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
    dlg.showModal();
    return dlg;
  }

  // Images pasted as paths are relative to the website root, but the admin lives in /admin/
  function previewSrc(src) {
    const s = String(src || '');
    if (/^(data:|https?:|\/)/i.test(s)) return s;
    return '../' + s.replace(/^\.\//, '');
  }

  function dataUrlBytes(src) {
    if (!/^data:/i.test(src)) return 0;
    const i = src.indexOf(',');
    return Math.max(0, Math.round((src.length - i - 1) * 3 / 4));
  }

  // Saves a change; if the browser refuses (storage full), the change is undone
  function commit(mutate, message) {
    const snapshot = JSON.stringify(App.state.data);
    mutate(App.state.data);
    if (!App.save()) {
      App.state.data = JSON.parse(snapshot);
      return false;
    }
    if (message) toast(message);
    return true;
  }

  function checkImagePath(v) {
    const s = v.trim();
    if (!s) return 'Enter an image path or web address.';
    if (/\s/.test(s)) return 'The address cannot contain spaces.';
    if (s.length > 500) return 'That address is too long.';
    if (/^data:/i.test(s)) return 'Upload the file instead of pasting image data.';
    const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme && !/^https?$/i.test(scheme[1])) return 'Only http:// or https:// addresses, or paths like images/house-1.jpg, are allowed.';
    if (s.indexOf('..') > -1) return 'Paths cannot contain "..".';
    if (!/^https?:\/\//i.test(s) && !/\.(jpe?g|png|webp|gif|avif)$/i.test(s)) return 'Use a path ending in .jpg, .png or .webp, for example images/house-1.jpg.';
    return '';
  }

  /* ---------- Image resizing and compressing (all in the browser) ---------- */
  const supportsWebp = (() => {
    try { return document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0; }
    catch (e) { return false; }
  })();

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not be read as an image.')); };
      img.src = url;
    });
  }

  async function compress(file) {
    const img = await readImage(file);
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('could not be read as an image.');
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const type = supportsWebp ? 'image/webp' : 'image/jpeg';
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);

    const out = canvas.toDataURL(type, QUALITY);
    if (!out || out.indexOf('data:image') !== 0) throw new Error('could not be compressed.');
    return out;
  }

  /* ---------- Stats + filters ---------- */
  function renderStats() {
    const list = data().products;
    const defs = [
      ['Total products', list.length, 'box', 'in all services'],
      ['Available', list.filter((p) => p.status === 'available').length, 'check', 'ready to order'],
      ['Sold', list.filter((p) => p.status === 'sold').length, 'tag', 'marked as sold'],
      ['Hidden', list.filter((p) => p.status === 'hidden').length, 'eyeoff', 'not on the website'],
      ['Featured', list.filter((p) => p.featured).length, 'star', 'highlighted']
    ];
    refs.stats.replaceChildren(...defs.map(([label, value, ic, sub]) => {
      const card = el('article', 'stat');
      const top = el('div', 'stat__top');
      const ico = el('span', 'stat__ico');
      ico.appendChild(App.svgIcon(ic));
      top.append(el('span', 'stat__label', label), ico);
      card.append(top, el('div', 'stat__num', String(value)), el('p', 'stat__sub', sub));
      return card;
    }));
  }

  function pruneSelection() {
    const ids = new Set(data().products.map((p) => p.id));
    Array.from(ui.selected).forEach((id) => { if (!ids.has(id)) ui.selected.delete(id); });
  }

  function refresh() {
    pruneSelection();
    renderStats();
    renderList();
  }

  function filtered() {
    const q = ui.q.trim().toLowerCase();
    const list = data().products.filter((p) =>
      (ui.service === 'all' || p.serviceId === ui.service) &&
      (ui.status === 'all' || p.status === ui.status) &&
      (!q || p.name.toLowerCase().includes(q)));

    const byPrice = (dir) => (a, b) => ((a.price === null) - (b.price === null)) || dir * (a.price - b.price);
    const sorters = {
      newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      'price-low': byPrice(1),
      'price-high': byPrice(-1)
    };
    return list.sort(sorters[ui.sort] || sorters.newest);
  }

  /* ---------- Quick actions ---------- */
  function setStatus(ids, status, message) {
    commit((d) => {
      d.products.forEach((p) => {
        if (ids.indexOf(p.id) > -1) { p.status = status; p.updatedAt = now(); }
      });
    }, message);
    refresh();
  }

  function toggleFeatured(p) {
    commit((d) => {
      const x = d.products.find((i) => i.id === p.id);
      x.featured = !x.featured;
      x.updatedAt = now();
    }, p.featured ? 'Removed from featured.' : 'Marked as featured.');
    refresh();
  }

  function duplicate(p) {
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = Z.id();
    copy.name = (p.name + ' (copy)').slice(0, 80);
    copy.status = 'hidden';
    copy.featured = false;
    delete copy.createdAt;
    delete copy.updatedAt;
    commit((d) => { Z.upsert(d, 'products', copy); }, 'Duplicated as hidden. Edit it, then set it to Available.');
    refresh();
  }

  function confirmDialog(title, text, label, onYes) {
    const dlg = el('dialog', 'dlg');
    dlg.setAttribute('aria-labelledby', 'cf-heading');
    const h = el('h2', null, title);
    h.id = 'cf-heading';
    const actions = el('div', 'dlg__actions');
    const cancel = button('Cancel', 'btn btn--ghost', null, () => dlg.close());
    const go = button(label, 'btn btn--danger-solid', 'trash', () => { onYes(); dlg.close(); });
    actions.append(cancel, go);
    dlg.append(h, el('p', null, text), actions);
    mountDialog(dlg);
    cancel.focus();
  }

  function askDelete(p) {
    confirmDialog('Delete \u201C' + p.name + '\u201D?', 'The product and its images are removed. This cannot be undone.', 'Delete product', () => {
      commit((d) => { Z.remove(d, 'products', p.id); }, 'Product deleted.');
      refresh();
    });
  }

  function askBulkDelete() {
    const ids = Array.from(ui.selected);
    if (!ids.length) return;
    confirmDialog('Delete ' + plural(ids.length, 'product', 'products') + '?', 'The selected products and their images are removed. This cannot be undone.', 'Delete', () => {
      commit((d) => { d.products = d.products.filter((p) => ids.indexOf(p.id) === -1); }, plural(ids.length, 'product', 'products') + ' deleted.');
      ui.selected.clear();
      refresh();
    });
  }

  /* ---------- List ---------- */
  function updateBulk() {
    const n = ui.selected.size;
    refs.bulk.hidden = n === 0;
    refs.bulkN.textContent = plural(n, 'product', 'products') + ' selected';
    if (refs.selAll) {
      const total = refs.visibleIds.length;
      const sel = refs.visibleIds.filter((id) => ui.selected.has(id)).length;
      refs.selAll.checked = total > 0 && sel === total;
      refs.selAll.indeterminate = sel > 0 && sel < total;
    }
  }

  function bulkApply(status, message) {
    const ids = Array.from(ui.selected);
    if (!ids.length) return;
    setStatus(ids, status, message);
    ui.selected.clear();
    refresh();
  }

  function cell(label, content) {
    const td = el('td');
    td.dataset.label = label;
    if (content instanceof Node) td.appendChild(content);
    else td.textContent = content;
    return td;
  }

  function thumb(p, svc) {
    const cover = p.images[0];
    const fallback = () => {
      const ph = el('span', 'prod__thumb');
      ph.appendChild(Z.iconSvg(svc ? svc.icon : 'globe'));
      return ph;
    };
    if (cover && App.safeSrc(cover)) {
      const img = document.createElement('img');
      img.className = 'prod__thumb';
      img.src = previewSrc(cover);
      img.alt = '';
      img.width = 46;
      img.height = 46;
      img.loading = 'lazy';
      img.addEventListener('error', () => img.replaceWith(fallback()));
      return img;
    }
    return fallback();
  }

  function row(p) {
    const svc = svcById(p.serviceId);
    const tr = el('tr');
    tr.dataset.id = p.id;
    if (ui.selected.has(p.id)) tr.classList.add('is-selected');

    // Select
    const tdSel = el('td', 'cell-sel');
    const chk = el('input', 'chk');
    chk.type = 'checkbox';
    chk.checked = ui.selected.has(p.id);
    chk.setAttribute('aria-label', 'Select ' + p.name);
    chk.addEventListener('change', () => {
      if (chk.checked) ui.selected.add(p.id); else ui.selected.delete(p.id);
      tr.classList.toggle('is-selected', chk.checked);
      updateBulk();
    });
    tdSel.appendChild(chk);

    // Product
    const tdProd = el('td', 'cell-prod');
    const box = el('div', 'prod');
    const text = el('div');
    text.append(el('div', 'prod__name', p.name), el('div', 'muted small', plural(p.images.length, 'image', 'images')));
    box.append(thumb(p, svc), text);
    tdProd.appendChild(box);

    // Price
    const price = el('div', 'pricecell');
    if (p.price !== null) {
      price.appendChild(el('strong', null, Z.money(p.price)));
      if (p.priceNote) price.appendChild(el('span', 'muted small', p.priceNote));
    } else {
      price.appendChild(el('strong', null, p.priceNote || '-'));
    }

    // Quick status
    const sel = el('select', 'qsel qsel--' + p.status);
    sel.setAttribute('aria-label', 'Status of ' + p.name);
    STATUSES.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; sel.appendChild(o); });
    sel.value = p.status;
    sel.addEventListener('change', () => setStatus([p.id], sel.value, 'Status updated.'));

    // Featured star
    const star = el('button', 'mbtn starbtn');
    star.type = 'button';
    star.setAttribute('aria-pressed', String(p.featured));
    star.setAttribute('aria-label', (p.featured ? 'Remove ' : 'Mark ') + p.name + (p.featured ? ' from featured' : ' as featured'));
    star.appendChild(icon('star'));
    star.addEventListener('click', () => toggleFeatured(p));

    // Actions
    const tdAct = el('td', 'cell-act');
    const act = el('div', 'actions');
    const edit = button('Edit', 'btn btn--ghost btn--sm', 'edit', () => openForm(p));
    const dup = button('', 'mbtn', 'copy', () => duplicate(p));
    const del = button('', 'mbtn', 'trash', () => askDelete(p));
    edit.setAttribute('aria-label', 'Edit ' + p.name);
    dup.setAttribute('aria-label', 'Duplicate ' + p.name);
    dup.title = 'Duplicate';
    del.setAttribute('aria-label', 'Delete ' + p.name);
    del.title = 'Delete';
    act.append(edit, dup, del);
    tdAct.appendChild(act);

    tr.append(tdSel, tdProd, cell('Service', svc ? svc.title : 'None'), cell('Price', price), cell('Status', sel), cell('Featured', star), cell('Updated', App.fmtDay(p.updatedAt)), tdAct);
    return tr;
  }

  function renderList() {
    const all = data().products;
    const list = filtered();
    const box = refs.list;
    box.replaceChildren();
    refs.selAll = null;
    refs.visibleIds = list.map((p) => p.id);

    const head = el('div', 'panel__head');
    const hasFilter = ui.q.trim() || ui.service !== 'all' || ui.status !== 'all';
    head.append(el('h2', null, 'All products'), el('span', 'muted small', hasFilter ? list.length + ' of ' + all.length : plural(all.length, 'product', 'products')));
    box.appendChild(head);

    // Bulk actions bar
    const bulk = el('div', 'bulk');
    bulk.hidden = true;
    bulk.setAttribute('role', 'region');
    bulk.setAttribute('aria-label', 'Bulk actions');
    const n = el('span', 'bulk__n');
    bulk.append(
      n,
      button('Hide', 'btn btn--ghost btn--sm', null, () => bulkApply('hidden', 'Selected products hidden.')),
      button('Mark sold', 'btn btn--ghost btn--sm', null, () => bulkApply('sold', 'Selected products marked as sold.')),
      button('Mark available', 'btn btn--ghost btn--sm', null, () => bulkApply('available', 'Selected products marked as available.')),
      button('Delete', 'btn btn--danger btn--sm', 'trash', askBulkDelete),
      button('Clear', 'btn btn--ghost btn--sm', null, () => { ui.selected.clear(); renderList(); })
    );
    refs.bulk = bulk;
    refs.bulkN = n;
    box.appendChild(bulk);

    if (!all.length) {
      const empty = el('div', 'panel__empty');
      empty.appendChild(el('p', null, 'You have no products yet.'));
      empty.appendChild(button('Add your first product', 'btn btn--sm', 'plus', () => openForm(null)));
      box.appendChild(empty);
      return;
    }
    if (!list.length) {
      const empty = el('div', 'panel__empty');
      empty.appendChild(el('p', null, 'No products match your search or filters.'));
      empty.appendChild(button('Clear filters', 'btn btn--ghost btn--sm', null, () => {
        ui.q = ''; ui.service = 'all'; ui.status = 'all';
        if (refs.q) refs.q.value = '';
        if (refs.fService) refs.fService.value = 'all';
        if (refs.fStatus) refs.fStatus.value = 'all';
        renderList();
      }));
      box.appendChild(empty);
      return;
    }

    const wrap = el('div', 'tscroll');
    const table = el('table', 'table');
    const thead = el('thead');
    const hr = el('tr');

    const thSel = el('th', 'cell-sel');
    const all1 = el('input', 'chk');
    all1.type = 'checkbox';
    all1.setAttribute('aria-label', 'Select all shown products');
    all1.addEventListener('change', () => {
      refs.visibleIds.forEach((id) => { if (all1.checked) ui.selected.add(id); else ui.selected.delete(id); });
      table.querySelectorAll('tbody tr').forEach((tr) => {
        const on = ui.selected.has(tr.dataset.id);
        tr.classList.toggle('is-selected', on);
        tr.querySelector('.chk').checked = on;
      });
      updateBulk();
    });
    thSel.appendChild(all1);
    refs.selAll = all1;
    hr.appendChild(thSel);
    ['Product', 'Service', 'Price', 'Status', 'Featured', 'Updated', ''].forEach((t) => hr.appendChild(el('th', null, t)));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el('tbody');
    list.forEach((p) => tbody.appendChild(row(p)));
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
    updateBulk();
  }

  /* ---------- Add / edit form ---------- */
  function makeField(id, labelText, control, hint) {
    const wrap = el('div', 'field');
    const label = el('label', null, labelText);
    label.htmlFor = id;
    control.id = id;
    const err = el('p', 'field__err');
    err.id = id + '-err';
    err.hidden = true;
    control.setAttribute('aria-describedby', id + '-err');
    wrap.append(label, control);
    let hintEl = null;
    if (hint) { hintEl = el('p', 'field__hint', hint); wrap.appendChild(hintEl); }
    wrap.appendChild(err);
    return { wrap, control, err, hintEl };
  }

  function textInput(max) {
    const i = el('input');
    i.type = 'text';
    if (max) i.maxLength = max;
    i.autocomplete = 'off';
    return i;
  }

  function selectOf(options, value) {
    const s = el('select');
    options.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; s.appendChild(o); });
    s.value = value;
    return s;
  }

  function openForm(existing) {
    const d = data();
    if (!d.services.length) {
      toast('Add a service first, then add products to it.', 'err', 6000);
      return;
    }
    const isEdit = Boolean(existing);

    const model = {
      name: existing ? existing.name : '',
      serviceId: existing ? existing.serviceId : (ui.service !== 'all' ? ui.service : sortedServices()[0].id),
      description: existing ? existing.description : '',
      price: existing && existing.price !== null ? String(existing.price) : '',
      priceNote: existing ? existing.priceNote : '',
      status: existing ? existing.status : 'available',
      featured: existing ? existing.featured : false,
      images: existing ? existing.images.map((src) => ({ src, kind: /^data:/i.test(src) ? 'upload' : 'url', saved: true })) : []
    };
    let attempted = false;

    const dlg = el('dialog', 'dlg dlg--wide');
    dlg.setAttribute('aria-labelledby', 'pf-heading');
    const form = el('form');
    form.noValidate = true;

    const head = el('div', 'dlg__head');
    const h = el('h2', null, isEdit ? 'Edit product' : 'Add product');
    h.id = 'pf-heading';
    const x = button('', 'mbtn', 'close', () => dlg.close());
    x.setAttribute('aria-label', 'Close');
    head.append(h, x);

    const body = el('div', 'dlg__body');

    /* name */
    const fName = makeField('pf-name', 'Product name', textInput(80));
    fName.control.value = model.name;

    /* service + status */
    const fService = makeField('pf-service', 'Service', selectOf(sortedServices().map((s) => [s.id, s.title + (s.visible === false ? ' (hidden)' : '')]), model.serviceId));
    const fStatus = makeField('pf-status', 'Status', selectOf(STATUSES, model.status), 'Hidden products do not show on the website.');
    const rowA = el('div', 'frow');
    rowA.append(fService.wrap, fStatus.wrap);

    /* description */
    const fDesc = makeField('pf-desc', 'Description (optional)', el('textarea'));
    fDesc.control.maxLength = 400;
    fDesc.control.value = model.description;

    /* price + note */
    const priceInput = el('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.step = 'any';
    priceInput.inputMode = 'decimal';
    priceInput.placeholder = 'For example 45000000';
    const fPrice = makeField('pf-price', 'Price in Naira (optional)', priceInput);
    fPrice.control.value = model.price;
    const fNote = makeField('pf-note', 'Price note (optional)', textInput(40), '');
    fNote.control.value = model.priceNote;
    const noteHint = () => {
      fNote.hintEl = fNote.hintEl || fNote.wrap.insertBefore(el('p', 'field__hint'), fNote.err);
      fNote.hintEl.textContent = String(model.price).trim() === ''
        ? 'Shown instead of a price, for example Price on request.'
        : 'Shown next to the price, for example Negotiable.';
    };
    noteHint();
    const rowB = el('div', 'frow');
    rowB.append(fPrice.wrap, fNote.wrap);

    /* featured */
    const featWrap = el('div', 'field');
    const featRow = el('div', 'switchrow');
    const feat = el('button', 'switch');
    feat.type = 'button';
    feat.setAttribute('role', 'switch');
    feat.setAttribute('aria-label', 'Feature this product on the website');
    const featText = el('span');
    const setFeat = () => {
      feat.setAttribute('aria-checked', String(model.featured));
      featText.textContent = model.featured ? 'Featured (shown first, with a badge)' : 'Not featured';
    };
    setFeat();
    feat.addEventListener('click', () => { model.featured = !model.featured; setFeat(); });
    featRow.append(feat, featText);
    featWrap.appendChild(featRow);

    /* images */
    const ims = el('fieldset', 'ip');
    ims.appendChild(el('legend', null, 'Images (up to ' + MAX_IMAGES + ')'));
    ims.appendChild(el('p', 'field__hint', 'The first image is the cover. Uploaded photos are shrunk to save browser storage. For many or large photos, upload them to your hosting and paste the path below instead.'));

    const drop = el('div', 'drop');
    drop.setAttribute('role', 'button');
    drop.tabIndex = 0;
    drop.setAttribute('aria-label', 'Choose photos to upload');
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.multiple = true;
    fileInput.tabIndex = -1;
    drop.append(icon('upload'), el('strong', null, 'Drag photos here or click to choose'), el('span', null, 'JPG, PNG or WebP, up to 5 MB each'), fileInput);

    const imgMsg = el('p', 'imgmsg');
    imgMsg.setAttribute('role', 'status');
    imgMsg.setAttribute('aria-live', 'polite');
    const grid = el('div', 'imgs');

    const urlRow = el('div', 'urlrow');
    const urlInput = el('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'Or paste a path or address, e.g. images/house-1.jpg';
    urlInput.setAttribute('aria-label', 'Image path or web address');
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    const urlBtn = button('Add image', 'btn btn--ghost', 'plus', addUrl);
    urlRow.append(urlInput, urlBtn);

    const storage = el('p', 'storage');
    ims.append(drop, imgMsg, grid, urlRow, storage);

    body.append(fName.wrap, rowA, fDesc.wrap, rowB, featWrap, ims);

    /* footer */
    const foot = el('div', 'dlg__foot');
    const cancel = button('Cancel', 'btn btn--ghost', null, () => dlg.close());
    const save = el('button', 'btn', isEdit ? 'Save changes' : 'Add product');
    save.type = 'submit';
    foot.append(cancel, save);

    form.append(head, body, foot);
    dlg.appendChild(form);

    /* ----- image handling ----- */
    function setMsg(text, isErr) {
      imgMsg.textContent = text || '';
      imgMsg.classList.toggle('is-err', Boolean(isErr));
    }

    function pendingChars() {
      return model.images.reduce((sum, im) => sum + (im.kind === 'upload' && !im.saved ? im.src.length : 0), 0);
    }

    function renderImages() {
      grid.replaceChildren();
      model.images.forEach((im, i) => {
        const item = el('div', 'imgs__item' + (i === 0 ? ' is-cover' : ''));
        if (App.safeSrc(im.src)) {
          const img = document.createElement('img');
          img.className = 'imgs__thumb';
          img.src = previewSrc(im.src);
          img.alt = 'Product image ' + (i + 1);
          img.addEventListener('error', () => img.replaceWith(el('div', 'imgs__bad', 'Cannot load this image')));
          item.appendChild(img);
        } else {
          item.appendChild(el('div', 'imgs__bad', 'Blocked address'));
        }
        if (i === 0) item.appendChild(el('span', 'imgs__badge', 'Cover'));
        item.appendChild(el('div', 'imgs__meta', im.kind === 'upload' ? 'Uploaded, ' + kb(dataUrlBytes(im.src)) : 'Path or address, no storage used: ' + im.src));

        const bar = el('div', 'imgs__bar');
        if (i > 0) {
          const cover = button('Make cover', null, null, () => {
            model.images.unshift(model.images.splice(i, 1)[0]);
            renderImages();
          });
          bar.appendChild(cover);
        }
        const rm = button('Remove', null, null, () => {
          model.images.splice(i, 1);
          setMsg('');
          renderImages();
        });
        rm.setAttribute('aria-label', 'Remove image ' + (i + 1));
        bar.appendChild(rm);
        item.appendChild(bar);
        grid.appendChild(item);
      });

      const full = model.images.length >= MAX_IMAGES;
      drop.setAttribute('aria-disabled', String(full));
      urlBtn.disabled = full;
      urlInput.disabled = full;

      const uploaded = model.images.filter((im) => im.kind === 'upload').reduce((s, im) => s + dataUrlBytes(im.src), 0);
      const u = Z.storageUsage();
      const after = Math.min(100, Math.round(((u.used + 2 * pendingChars()) / u.limit) * 100));
      storage.textContent = 'Uploaded images in this product: ' + kb(uploaded) + '. Browser storage after saving: about ' + after + '% full.';
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      const slots = MAX_IMAGES - model.images.length;
      if (slots <= 0) { setMsg('You can add up to ' + MAX_IMAGES + ' images. Remove one first.', true); return; }

      const take = files.slice(0, slots);
      const problems = [];
      if (files.length > slots) problems.push('Only ' + slots + ' more image' + (slots === 1 ? '' : 's') + ' fit, so the rest were skipped.');
      let added = 0;

      for (let i = 0; i < take.length; i++) {
        const file = take[i];
        setMsg('Processing ' + (i + 1) + ' of ' + take.length + '…');
        try {
          if (TYPES.indexOf(file.type) === -1) throw new Error('only JPG, PNG or WebP images are allowed.');
          if (file.size > MAX_FILE) throw new Error('this file is larger than 5 MB.');
          const src = await compress(file);
          const u = Z.storageUsage();
          if (u.used + 2 * (pendingChars() + src.length) > u.limit * 0.95) {
            throw new Error('browser storage is nearly full. Use an image path or web address instead.');
          }
          model.images.push({ src, kind: 'upload', saved: false });
          added++;
        } catch (err) {
          problems.push(file.name + ': ' + err.message);
        }
      }

      renderImages();
      if (problems.length) setMsg((added ? added + ' added. ' : '') + problems.join(' '), true);
      else setMsg(added + (added === 1 ? ' image added.' : ' images added.'));
    }

    function addUrl() {
      if (model.images.length >= MAX_IMAGES) { setMsg('You can add up to ' + MAX_IMAGES + ' images. Remove one first.', true); return; }
      const problem = checkImagePath(urlInput.value);
      if (problem) { setMsg(problem, true); urlInput.focus(); return; }
      let src = urlInput.value.trim();
      if (!/^https?:\/\//i.test(src)) src = src.replace(/^\.\//, '');
      if (model.images.some((im) => im.src === src)) { setMsg('That image is already added.', true); return; }
      model.images.push({ src, kind: 'url', saved: true });
      urlInput.value = '';
      setMsg('Image added.');
      renderImages();
    }

    drop.addEventListener('click', (e) => { if (e.target !== fileInput && drop.getAttribute('aria-disabled') !== 'true') fileInput.click(); });
    drop.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && drop.getAttribute('aria-disabled') !== 'true') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => { if (drop.getAttribute('aria-disabled') !== 'true') addFiles(e.dataTransfer.files); });
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
    renderImages();

    /* ----- field behaviour ----- */
    const map = { name: fName, service: fService, price: fPrice };

    function validate() {
      const e = {};
      if (model.name.trim().length < 2) e.name = 'Enter a product name (at least 2 characters).';
      if (!model.serviceId || !data().services.some((s) => s.id === model.serviceId)) e.service = 'Choose a service.';
      const p = String(model.price).trim();
      if (p !== '') {
        const n = Number(p);
        if (!isFinite(n) || n < 0) e.price = 'Enter a price of 0 or more, or leave it empty.';
        else if (n > 1e13) e.price = 'That price is too large.';
      }
      return e;
    }
    function showErrors(errs) {
      Object.keys(map).forEach((k) => {
        const f = map[k];
        const msg = errs[k];
        f.err.hidden = !msg;
        f.err.textContent = msg || '';
        if (msg) f.control.setAttribute('aria-invalid', 'true');
        else f.control.removeAttribute('aria-invalid');
      });
    }
    const live = () => { if (attempted) showErrors(validate()); };

    fName.control.addEventListener('input', () => { model.name = fName.control.value; live(); });
    fService.control.addEventListener('change', () => { model.serviceId = fService.control.value; live(); });
    fStatus.control.addEventListener('change', () => { model.status = fStatus.control.value; });
    fDesc.control.addEventListener('input', () => { model.description = fDesc.control.value; });
    fPrice.control.addEventListener('input', () => { model.price = fPrice.control.value; noteHint(); live(); });
    fNote.control.addEventListener('input', () => { model.priceNote = fNote.control.value; });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempted = true;
      const errs = validate();
      showErrors(errs);
      const first = ['name', 'service', 'price'].find((k) => errs[k]);
      if (first) { map[first].control.focus(); return; }

      const p = String(model.price).trim();
      const item = {
        id: existing ? existing.id : Z.id(),
        serviceId: model.serviceId,
        name: model.name.trim(),
        description: model.description.trim(),
        price: p === '' ? null : Number(p),
        priceNote: model.priceNote.trim(),
        status: model.status,
        featured: model.featured,
        images: model.images.map((im) => im.src)
      };

      const ok = commit((dd) => { Z.upsert(dd, 'products', item); }, isEdit ? 'Product updated.' : 'Product added.');
      if (ok) { dlg.close(); refresh(); }
      else setMsg('Could not save. Browser storage is full: remove an uploaded image or use image paths instead.', true);
    });

    mountDialog(dlg);
    fName.control.focus();
  }

  /* ---------- Page ---------- */
  function makeFilter(label, options, value, onChange) {
    const s = el('select', 'sel');
    s.setAttribute('aria-label', label);
    options.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; s.appendChild(o); });
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function renderPage(view, params) {
    view.replaceChildren();
    const page = el('div', 'prod-admin');

    refs.stats = el('div', 'stats stats--5');
    page.appendChild(refs.stats);

    const bar = el('div', 'toolbar');
    const search = el('label', 'search');
    search.appendChild(icon('search'));
    const q = el('input');
    q.type = 'search';
    q.placeholder = 'Search products by name';
    q.setAttribute('aria-label', 'Search products by name');
    q.value = ui.q;
    q.addEventListener('input', () => { ui.q = q.value; renderList(); });
    refs.q = q;
    search.appendChild(q);
    bar.append(search, button('Add product', 'btn', 'plus', () => openForm(null)));
    page.appendChild(bar);

    const filters = el('div', 'filters');
    if (ui.service !== 'all' && !svcById(ui.service)) ui.service = 'all';
    refs.fService = makeFilter('Filter by service', [['all', 'All services']].concat(sortedServices().map((s) => [s.id, s.title])), ui.service, (v) => { ui.service = v; renderList(); });
    refs.fStatus = makeFilter('Filter by status', [['all', 'All statuses']].concat(STATUSES), ui.status, (v) => { ui.status = v; renderList(); });
    const sort = makeFilter('Sort products', [['newest', 'Newest first'], ['name', 'Name A to Z'], ['price-low', 'Price: low to high'], ['price-high', 'Price: high to low']], ui.sort, (v) => { ui.sort = v; renderList(); });
    filters.append(refs.fService, refs.fStatus, sort);
    page.appendChild(filters);

    refs.list = el('section', 'panel');
    page.appendChild(refs.list);
    view.appendChild(page);

    refresh();

    // Links such as #products/new and #products/edit/<id> open the form directly
    if (params && params.length) {
      if (params[0] === 'new') openForm(null);
      else if (params[0] === 'edit' && params[1]) {
        const p = data().products.find((x) => x.id === params[1]);
        if (p) openForm(p); else toast('That product was not found.', 'err');
      }
      history.replaceState(null, '', location.pathname + location.search + '#products');
    }
  }

  App.registerRoute('products', renderPage);
})();