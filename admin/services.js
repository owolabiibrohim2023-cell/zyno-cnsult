/* ZYNO-CONSULT admin: Services management page.
   Plugs into the dashboard shell (admin.js) through AdminApp.registerRoute. */
(() => {
  'use strict';

  const App = window.AdminApp;
  const Z = window.Zyno;
  if (!App || !Z) { console.warn('admin.js and js/store.js must load before services.js'); return; }

  const { el, toast } = App;

  // Names the public page already uses as element ids; a service link name cannot be one of these
  const RESERVED = ['top', 'about', 'services', 'products', 'why-us', 'contact', 'footer', 'loader', 'servicesgrid', 'productsgrid', 'productfilters'];
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const MAX_BULLETS = 8;
  const ICON_LABELS = { house: 'House', car: 'Car', container: 'Container', drill: 'Drill', globe: 'Globe', key: 'Key', truck: 'Truck', wrench: 'Wrench' };

  const PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>'
  };

  const ui = { query: '' };
  const refs = {};

  /* ---------- Small helpers ---------- */
  const data = () => App.state.data;
  const now = () => new Date().toISOString();
  const sortedFrom = (d) => d.services.slice().sort((a, b) => (a.order - b.order) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const sorted = () => sortedFrom(data());
  const countProducts = (sid) => data().products.filter((p) => p.serviceId === sid).length;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

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
    // Close when the dark backdrop is clicked
    dlg.addEventListener('mousedown', (e) => {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
    dlg.showModal();
    return dlg;
  }

  /* ---------- Saving (with undo if the browser storage is full) ---------- */
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

  function reorder(d, id, position) {
    const item = d.services.find((s) => s.id === id);
    const others = sortedFrom(d).filter((s) => s.id !== id);
    const at = Math.max(0, Math.min(others.length, position - 1));
    others.splice(at, 0, item);
    others.forEach((s, i) => { s.order = i + 1; });
  }

  /* ---------- Stats + list ---------- */
  function renderStats() {
    const list = data().services;
    const visible = list.filter((s) => s.visible !== false).length;
    const defs = [
      ['Total services', list.length, 'layers', 'on this dashboard'],
      ['Visible services', visible, 'eye', 'shown on the website'],
      ['Hidden services', list.length - visible, 'eyeoff', 'not shown on the website']
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

  function refresh() {
    renderStats();
    renderList();
  }

  function renderList() {
    const all = sorted();
    const q = ui.query.trim().toLowerCase();
    const list = q ? all.filter((s) => [s.title, s.slug, s.shortDescription].join(' ').toLowerCase().includes(q)) : all;
    const box = refs.list;
    box.replaceChildren();

    const head = el('div', 'panel__head');
    head.append(el('h2', null, 'All services'), el('span', 'muted small', q ? list.length + ' of ' + all.length : plural(all.length, 'service', 'services')));
    box.appendChild(head);

    if (!all.length) {
      const empty = el('div', 'panel__empty');
      empty.appendChild(el('p', null, 'You have no services yet.'));
      empty.appendChild(button('Add your first service', 'btn btn--sm', 'plus', () => openForm(null)));
      box.appendChild(empty);
      return;
    }
    if (!list.length) {
      box.appendChild(el('p', 'panel__empty', 'No services match \u201C' + ui.query.trim() + '\u201D.'));
      return;
    }

    const table = el('table', 'table');
    const thead = el('thead');
    const hr = el('tr');
    ['Order', 'Service', 'Link name', 'Products', 'Visible', ''].forEach((h) => hr.appendChild(el('th', null, h)));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el('tbody');
    list.forEach((s) => tbody.appendChild(row(s, all)));
    table.appendChild(tbody);
    box.appendChild(table);
  }

  function cell(label, content) {
    const td = el('td');
    td.dataset.label = label;
    if (content instanceof Node) td.appendChild(content);
    else td.textContent = content;
    return td;
  }

  function row(s, all) {
    const tr = el('tr');
    const idx = all.findIndex((x) => x.id === s.id);
    const searching = ui.query.trim() !== '';

    // Order + arrows
    const ord = el('div', 'reorder');
    const up = button('', 'mbtn', 'up', () => move(s.id, -1));
    const down = button('', 'mbtn', 'down', () => move(s.id, 1));
    up.setAttribute('aria-label', 'Move ' + s.title + ' up');
    down.setAttribute('aria-label', 'Move ' + s.title + ' down');
    up.disabled = searching || idx === 0;
    down.disabled = searching || idx === all.length - 1;
    if (searching) { up.title = down.title = 'Clear the search to change the order'; }
    ord.append(up, el('span', 'reorder__num', String(s.order)), down);

    // Service
    const tdSvc = el('td', 'cell-prod');
    const box = el('div', 'prod');
    const ico = el('span', 'prod__thumb');
    ico.appendChild(Z.iconSvg(s.icon));
    const text = el('div');
    text.append(el('div', 'prod__name', s.title), el('div', 'muted small', s.shortDescription));
    box.append(ico, text);
    tdSvc.appendChild(box);

    // Link name
    const code = el('code', 'slug', '#' + s.slug);

    // Visible switch
    const sw = el('button', 'switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(s.visible !== false));
    sw.setAttribute('aria-label', 'Show ' + s.title + ' on the website');
    sw.addEventListener('click', () => toggleVisible(s.id, sw.getAttribute('aria-checked') !== 'true'));

    // Actions
    const act = el('td', 'cell-act');
    const wrap = el('div', 'actions');
    const edit = button('Edit', 'btn btn--ghost btn--sm', 'edit', () => openForm(s));
    const del = button('Delete', 'btn btn--danger btn--sm', 'trash', () => askDelete(s));
    edit.setAttribute('aria-label', 'Edit ' + s.title);
    del.setAttribute('aria-label', 'Delete ' + s.title);
    wrap.append(edit, del);
    act.appendChild(wrap);

    tr.append(cell('Order', ord), tdSvc, cell('Link name', code), cell('Products', String(countProducts(s.id))), cell('Visible', sw), act);
    return tr;
  }

  /* ---------- Quick actions ---------- */
  function move(id, dir) {
    commit((d) => {
      const list = sortedFrom(d);
      const i = list.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      list.forEach((x, k) => { x.order = k + 1; });
    }, 'Order updated.');
    refresh();
  }

  function toggleVisible(id, on) {
    commit((d) => {
      const s = d.services.find((x) => x.id === id);
      s.visible = on;
      s.updatedAt = now();
    }, on ? 'Service is now visible on the website.' : 'Service hidden. It and its products no longer show on the website.');
    refresh();
  }

  /* ---------- Add / edit form ---------- */
  function input(type, max) {
    const i = el('input');
    i.type = type;
    if (max) i.maxLength = max;
    return i;
  }

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
    if (hint) wrap.appendChild(el('p', 'field__hint', hint));
    wrap.appendChild(err);
    return { wrap, control, err };
  }

  function openForm(existing) {
    const isEdit = Boolean(existing);
    const maxOrder = data().services.length + (isEdit ? 0 : 1);

    const model = {
      title: existing ? existing.title : '',
      slug: existing ? existing.slug : '',
      shortDescription: existing ? existing.shortDescription : '',
      description: existing ? existing.description : '',
      bullets: existing && existing.bullets.length ? existing.bullets.slice() : [''],
      icon: existing ? existing.icon : 'globe',
      order: existing ? existing.order : maxOrder,
      visible: existing ? existing.visible !== false : true
    };
    let slugTouched = isEdit;   // when editing, the link name stays put unless you change it yourself
    let attempted = false;

    const dlg = el('dialog', 'dlg dlg--wide');
    dlg.setAttribute('aria-labelledby', 'sf-heading');
    const form = el('form');
    form.noValidate = true;

    /* header */
    const head = el('div', 'dlg__head');
    const h = el('h2', null, isEdit ? 'Edit service' : 'Add service');
    h.id = 'sf-heading';
    const x = button('', 'mbtn', 'close', () => dlg.close());
    x.setAttribute('aria-label', 'Close');
    head.append(h, x);

    const body = el('div', 'dlg__body');

    /* title + slug */
    const fTitle = makeField('sf-title', 'Title', input('text', 60));
    fTitle.control.value = model.title;
    fTitle.control.autocomplete = 'off';

    const fSlug = makeField('sf-slug', 'Link name', input('text', 50), isEdit ? 'Changing this changes the link to this service on the website.' : 'Used in the link to this service. Made from the title for you.');
    fSlug.control.value = model.slug;
    fSlug.control.autocomplete = 'off';
    fSlug.control.spellcheck = false;

    const row1 = el('div', 'frow');
    row1.append(fTitle.wrap, fSlug.wrap);

    /* short description */
    const fShort = makeField('sf-short', 'Short description', input('text', 140));
    fShort.control.value = model.shortDescription;
    const count = el('span', 'field__count');
    fShort.wrap.insertBefore(count, fShort.err);
    const updateCount = () => { count.textContent = fShort.control.value.length + '/140'; };
    updateCount();

    /* full description */
    const fDesc = makeField('sf-desc', 'Full description (optional)', el('textarea'));
    fDesc.control.maxLength = 600;
    fDesc.control.value = model.description;

    /* bullets */
    const bulWrap = el('div', 'field');
    bulWrap.appendChild(el('label', null, 'Bullet points (optional)'));
    const bulBox = el('div', 'bul');
    const bulErr = el('p', 'field__err');
    bulErr.hidden = true;
    bulWrap.append(bulBox, bulErr);

    function renderBullets(focusIndex) {
      bulBox.replaceChildren();
      model.bullets.forEach((text, i) => {
        const r = el('div', 'bul__row');
        const inp = input('text', 80);
        inp.value = text;
        inp.placeholder = 'For example: Buying and selling';
        inp.setAttribute('aria-label', 'Bullet point ' + (i + 1));
        inp.addEventListener('input', () => { model.bullets[i] = inp.value; });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (model.bullets.length < MAX_BULLETS) { model.bullets.splice(i + 1, 0, ''); renderBullets(i + 1); }
          }
        });

        const u = button('', 'mbtn', 'up', () => { swap(i, i - 1); });
        const dn = button('', 'mbtn', 'down', () => { swap(i, i + 1); });
        const rm = button('', 'mbtn', 'close', () => {
          model.bullets.splice(i, 1);
          if (!model.bullets.length) model.bullets.push('');
          renderBullets(Math.max(0, i - 1));
        });
        u.setAttribute('aria-label', 'Move bullet point up');
        dn.setAttribute('aria-label', 'Move bullet point down');
        rm.setAttribute('aria-label', 'Remove bullet point');
        u.disabled = i === 0;
        dn.disabled = i === model.bullets.length - 1;

        r.append(inp, u, dn, rm);
        bulBox.appendChild(r);
        if (focusIndex === i) setTimeout(() => inp.focus(), 0);
      });

      const add = button('Add bullet', 'btn btn--ghost btn--sm bul__add', 'plus', () => {
        model.bullets.push('');
        renderBullets(model.bullets.length - 1);
      });
      add.disabled = model.bullets.length >= MAX_BULLETS;
      bulBox.appendChild(add);
    }
    function swap(a, b) {
      if (b < 0 || b >= model.bullets.length) return;
      const t = model.bullets[a]; model.bullets[a] = model.bullets[b]; model.bullets[b] = t;
      renderBullets(b);
    }
    renderBullets();

    /* icon picker */
    const picker = el('fieldset', 'ip');
    picker.appendChild(el('legend', null, 'Icon'));
    const grid = el('div', 'ip__grid');
    Z.iconNames.forEach((name) => {
      const lab = el('label', 'ip__item');
      const r = el('input');
      r.type = 'radio';
      r.name = 'sf-icon';
      r.value = name;
      r.checked = model.icon === name;
      r.addEventListener('change', () => { model.icon = name; });
      const tile = el('span', 'ip__tile');
      tile.append(Z.iconSvg(name), el('span', null, ICON_LABELS[name] || name));
      lab.append(r, tile);
      grid.appendChild(lab);
    });
    picker.appendChild(grid);

    /* order + visible */
    const fOrder = makeField('sf-order', 'Order', input('number'), 'Position in the list. 1 is first.');
    fOrder.control.min = '1';
    fOrder.control.max = String(maxOrder);
    fOrder.control.step = '1';
    fOrder.control.inputMode = 'numeric';
    fOrder.control.value = model.order;

    const visWrap = el('div', 'field');
    visWrap.appendChild(el('label', null, 'Show on website'));
    const visRow = el('div', 'switchrow');
    const vis = el('button', 'switch');
    vis.type = 'button';
    vis.setAttribute('role', 'switch');
    vis.setAttribute('aria-label', 'Show this service on the website');
    const visText = el('span');
    const setVis = () => {
      vis.setAttribute('aria-checked', String(model.visible));
      visText.textContent = model.visible ? 'Visible' : 'Hidden';
    };
    setVis();
    vis.addEventListener('click', () => { model.visible = !model.visible; setVis(); });
    visRow.append(vis, visText);
    visWrap.append(visRow, el('p', 'field__hint', 'Hidden services and their products do not show on the website.'));

    const row2 = el('div', 'frow');
    row2.append(fOrder.wrap, visWrap);

    body.append(row1, fShort.wrap, fDesc.wrap, bulWrap, picker, row2);

    /* footer */
    const foot = el('div', 'dlg__foot');
    const cancel = button('Cancel', 'btn btn--ghost', null, () => dlg.close());
    const save = el('button', 'btn', isEdit ? 'Save changes' : 'Add service');
    save.type = 'submit';
    foot.append(cancel, save);

    form.append(head, body, foot);
    dlg.appendChild(form);

    /* ----- behaviour ----- */
    fTitle.control.addEventListener('input', () => {
      model.title = fTitle.control.value;
      if (!slugTouched) {
        model.slug = Z.slugify(model.title);
        fSlug.control.value = model.slug;
      }
      live();
    });
    fSlug.control.addEventListener('input', () => {
      slugTouched = true;
      model.slug = fSlug.control.value;
      live();
    });
    fSlug.control.addEventListener('blur', () => {
      model.slug = Z.slugify(fSlug.control.value);
      fSlug.control.value = model.slug;
      live();
    });
    fShort.control.addEventListener('input', () => { model.shortDescription = fShort.control.value; updateCount(); live(); });
    fDesc.control.addEventListener('input', () => { model.description = fDesc.control.value; });
    fOrder.control.addEventListener('input', () => { model.order = fOrder.control.value; live(); });

    function validate() {
      const d = data();
      const e = {};
      if (model.title.trim().length < 2) e.title = 'Enter a title (at least 2 characters).';

      const slug = model.slug;
      if (!slug) e.slug = 'Enter a link name, for example real-estate.';
      else if (!SLUG_RE.test(slug) || slug.length < 2) e.slug = 'Use at least 2 lowercase letters or numbers, with single hyphens only.';
      else if (RESERVED.indexOf(slug) > -1) e.slug = 'The website already uses this name. Choose another.';
      else if (d.services.some((s) => s.slug === slug && (!existing || s.id !== existing.id))) e.slug = 'Another service already uses this link name.';

      if (model.shortDescription.trim().length < 5) e.shortDescription = 'Write a short description (at least 5 characters).';

      const n = Number(model.order);
      if (model.order === '' || !Number.isInteger(n) || n < 1 || n > maxOrder) e.order = 'Enter a whole number from 1 to ' + maxOrder + '.';
      return e;
    }

    const fieldMap = { title: fTitle, slug: fSlug, shortDescription: fShort, order: fOrder };
    function showErrors(errs) {
      Object.keys(fieldMap).forEach((k) => {
        const f = fieldMap[k];
        const msg = errs[k];
        f.err.hidden = !msg;
        f.err.textContent = msg || '';
        if (msg) f.control.setAttribute('aria-invalid', 'true');
        else f.control.removeAttribute('aria-invalid');
      });
    }
    function live() { if (attempted) showErrors(validate()); }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempted = true;
      const errs = validate();
      showErrors(errs);
      const first = ['title', 'slug', 'shortDescription', 'order'].find((k) => errs[k]);
      if (first) { fieldMap[first].control.focus(); return; }

      const item = {
        id: existing ? existing.id : Z.id(),
        slug: model.slug,
        title: model.title.trim(),
        shortDescription: model.shortDescription.trim(),
        description: model.description.trim(),
        bullets: model.bullets.map((b) => b.trim()).filter(Boolean),
        icon: model.icon,
        visible: model.visible
      };
      const position = Number(model.order);

      const ok = commit((d) => {
        const saved = Z.upsert(d, 'services', isEdit ? item : Object.assign({}, item, { order: 9999 }));
        reorder(d, saved.id, position);
      }, isEdit ? 'Service updated.' : 'Service added.');

      if (ok) { dlg.close(); refresh(); }
    });

    mountDialog(dlg);
    fTitle.control.focus();
  }

  /* ---------- Delete ---------- */
  function askDelete(s) {
    const n = countProducts(s.id);
    const others = sorted().filter((x) => x.id !== s.id);

    const dlg = el('dialog', 'dlg');
    dlg.setAttribute('aria-labelledby', 'del-heading');
    const h = el('h2', null, 'Delete \u201C' + s.title + '\u201D?');
    h.id = 'del-heading';
    dlg.appendChild(h);

    let mode = 'none';
    let target = others.length ? others[0].id : '';

    if (n === 0) {
      dlg.appendChild(el('p', null, 'This removes the service from the website. It cannot be undone.'));
    } else {
      mode = others.length ? 'move' : 'delete';
      dlg.appendChild(el('p', 'lead', 'This service still has ' + plural(n, 'product', 'products') + '. Choose what happens to them.'));

      const opts = el('fieldset', 'opts');
      opts.appendChild(Object.assign(el('legend'), { className: 'small muted', textContent: 'Products in this service' }));

      const optMove = el('label', 'opt' + (others.length ? '' : ' is-off'));
      const rMove = el('input');
      rMove.type = 'radio'; rMove.name = 'del-mode'; rMove.value = 'move';
      rMove.checked = mode === 'move'; rMove.disabled = !others.length;
      const bodyMove = el('div');
      bodyMove.append(el('strong', null, 'Move them to another service'), el('span', 'd', others.length ? 'The products stay on the website under the service you pick.' : 'There is no other service to move them to.'));
      const sel = el('select');
      sel.setAttribute('aria-label', 'Move products to');
      others.forEach((o) => { const op = el('option', null, o.title); op.value = o.id; sel.appendChild(op); });
      sel.disabled = !others.length;
      sel.addEventListener('change', () => { target = sel.value; });
      sel.addEventListener('focus', () => { rMove.checked = true; mode = 'move'; });
      if (others.length) bodyMove.appendChild(sel);
      optMove.append(rMove, bodyMove);

      const optDel = el('label', 'opt');
      const rDel = el('input');
      rDel.type = 'radio'; rDel.name = 'del-mode'; rDel.value = 'delete';
      rDel.checked = mode === 'delete';
      const bodyDel = el('div');
      bodyDel.append(el('strong', null, 'Delete the ' + plural(n, 'product', 'products') + ' too'), el('span', 'd', 'The products and their images are removed. This cannot be undone.'));
      optDel.append(rDel, bodyDel);

      rMove.addEventListener('change', () => { mode = 'move'; });
      rDel.addEventListener('change', () => { mode = 'delete'; });
      opts.append(optMove, optDel);
      dlg.appendChild(opts);
    }

    const actions = el('div', 'dlg__actions');
    const cancel = button('Cancel', 'btn btn--ghost', null, () => dlg.close());
    const go = button('Delete service', 'btn btn--danger-solid', 'trash', () => {
      const ok = commit((d) => {
        if (mode === 'move' && target) {
          d.products.forEach((p) => { if (p.serviceId === s.id) { p.serviceId = target; p.updatedAt = now(); } });
        } else if (mode === 'delete') {
          d.products = d.products.filter((p) => p.serviceId !== s.id);
        }
        d.services = d.services.filter((x) => x.id !== s.id);
        sortedFrom(d).forEach((x, i) => { x.order = i + 1; });
      }, mode === 'move' ? 'Service deleted. Its products were moved.' : mode === 'delete' ? 'Service and its products deleted.' : 'Service deleted.');
      if (ok) { dlg.close(); refresh(); }
    });
    actions.append(cancel, go);
    dlg.appendChild(actions);

    mountDialog(dlg);
    cancel.focus();
  }

  /* ---------- Page ---------- */
  function renderPage(view, params) {
    view.replaceChildren();
    const page = el('div', 'svc-admin');

    refs.stats = el('div', 'stats stats--3');
    page.appendChild(refs.stats);

    const bar = el('div', 'toolbar');
    const search = el('label', 'search');
    search.appendChild(icon('search'));
    const q = el('input');
    q.type = 'search';
    q.placeholder = 'Search services';
    q.setAttribute('aria-label', 'Search services');
    q.value = ui.query;
    q.addEventListener('input', () => { ui.query = q.value; renderList(); });
    search.appendChild(q);
    bar.append(search, button('Add service', 'btn', 'plus', () => openForm(null)));
    page.appendChild(bar);

    refs.list = el('section', 'panel');
    page.appendChild(refs.list);
    view.appendChild(page);

    refresh();

    // Links such as #services/new and #services/edit/<id> open the form directly
    if (params && params.length) {
      if (params[0] === 'new') openForm(null);
      else if (params[0] === 'edit' && params[1]) {
        const s = data().services.find((x) => x.id === params[1]);
        if (s) openForm(s); else toast('That service was not found.', 'err');
      }
      history.replaceState(null, '', location.pathname + location.search + '#services');
    }
  }

  App.registerRoute('services', renderPage);
})();