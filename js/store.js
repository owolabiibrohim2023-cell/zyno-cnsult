/* ZYNO-CONSULT: shared data layer (public site + admin).
   No backend. Data lives in localStorage (the admin's edits) and in an optional
   published file, data/site-data.json (what every visitor sees). */
(function (global) {
  'use strict';

  var KEY = 'zyno_data';
  var PUBLISHED_URL = 'data/site-data.json';
  var LIMIT_BYTES = 5 * 1024 * 1024;

  /* ---------- Icons (32x32 line icons) ---------- */
  var ICONS = {
    house: '<path d="M4 15 16 4l12 11"/><path d="M7 13v15h18V13"/><path d="M13 28v-8h6v8"/>',
    car: '<path d="M3 22v-5l3-6h13l5 5 5 1v5z"/><circle cx="9.5" cy="23" r="3"/><circle cx="22.5" cy="23" r="3"/>',
    container: '<rect x="3" y="9" width="26" height="16" rx="1"/><path d="M9 9v16M15 9v16M21 9v16"/>',
    drill: '<path d="M5 11c6-6 16-6 22 0"/><path d="M16 6v22"/><path d="M12 28h8"/>',
    globe: '<circle cx="16" cy="16" r="12"/><path d="M4 16h24"/><path d="M16 4c-5 5-5 19 0 24M16 4c5 5 5 19 0 24"/>',
    key: '<circle cx="10" cy="16" r="5"/><path d="M15 16h14M25 16v5M29 16v4"/>',
    truck: '<path d="M3 8h17v15H3z"/><path d="M20 13h6l3 4v6h-9z"/><circle cx="9" cy="24" r="3"/><circle cx="24" cy="24" r="3"/>',
    wrench: '<path d="M20 5a7 7 0 0 0-5.5 10L5 24.5 7.5 27l9.5-9.5A7 7 0 0 0 27 12l-4 4-4-1-1-4z"/>'
  };

  /* ---------- Small helpers ---------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nowIso() { return new Date().toISOString(); }
  function id() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function slugify(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function money(n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }

  function toTel(phone) {
    var p = String(phone || '').replace(/[^\d+]/g, '');
    return p.charAt(0) === '0' ? '+234' + p.slice(1) : p;
  }

  /* ---------- Built-in default data (also the fallback) ---------- */
  var T0 = '2026-01-01T00:00:00.000Z';
  function svc(sid, slug, title, short, desc, bullets, icon, order) {
    return { id: sid, slug: slug, title: title, shortDescription: short, description: desc, bullets: bullets, icon: icon, order: order, visible: true, createdAt: T0, updatedAt: T0 };
  }
  function prd(pid, serviceId, name, price, note, status, featured, created, image) {
    return {
      id: pid, serviceId: serviceId, name: name,
      description: 'Sample content. Replace this from the admin dashboard with a real item.',
      price: price, priceNote: note, images: image ? [image] : [], status: status, featured: featured, createdAt: created, updatedAt: created
    };
  }

  var DEFAULT_DATA = {
    services: [
      svc('svc-real-estate', 'real-estate', 'Real estate',
        'Buying, selling, construction and estate management.',
        'Buying and selling, construction, and estate broker and management services, along with related services.',
        ['Buying and selling of property', 'Construction', 'Estate broker and estate management', 'Related property services'], 'house', 1),
      svc('svc-car-deals', 'car-deals', 'Car deals',
        'Buy a car, sell yours, or swap it for another.',
        'Buy a car, sell yours, or swap it for another.',
        ['Buying cars', 'Selling cars', 'Swapping cars'], 'car', 2),
      svc('svc-import-export', 'import-export', 'Import and export',
        'We work as an importer and exporter.',
        'We work as an importer and exporter. Tell us what you want to bring in or send out.',
        ['Importing goods', 'Exporting goods', 'Guidance from your first message'], 'container', 3),
      svc('svc-mining-boreholes', 'mining-boreholes', 'Mining and boreholes',
        'Mining of natural resources and drilling of boreholes.',
        'Mining of natural resources and drilling of boreholes.',
        ['Mining of natural resources', 'Borehole drilling'], 'drill', 4)
    ],
    products: [
      prd('prd-re-1', 'svc-real-estate', 'Sample listing: 3-bedroom bungalow', 35000000, 'Negotiable', 'available', true, '2026-01-08T00:00:00.000Z', 'images/products/bungalow.svg'),
      prd('prd-re-2', 'svc-real-estate', 'Sample listing: Residential land', null, 'Price on request', 'available', false, '2026-01-07T00:00:00.000Z', 'images/products/residential-land.svg'),
      prd('prd-car-1', 'svc-car-deals', 'Sample car: SUV', 18500000, '', 'available', true, '2026-01-06T00:00:00.000Z', 'images/products/suv.svg'),
      prd('prd-car-2', 'svc-car-deals', 'Sample car: Sedan', 6200000, '', 'sold', false, '2026-01-05T00:00:00.000Z', 'images/products/sedan.svg'),
      prd('prd-ie-1', 'svc-import-export', 'Sample product: Imported goods', null, 'Price on request', 'available', false, '2026-01-04T00:00:00.000Z', 'images/products/import-cargo.svg'),
      prd('prd-ie-2', 'svc-import-export', 'Sample product: Export goods', null, 'Price on request', 'available', false, '2026-01-03T00:00:00.000Z', 'images/products/export-cargo.svg'),
      prd('prd-mb-1', 'svc-mining-boreholes', 'Sample package: Borehole drilling', null, 'Price on request', 'available', false, '2026-01-02T00:00:00.000Z', 'images/products/borehole-drilling.svg'),
      prd('prd-mb-2', 'svc-mining-boreholes', 'Sample package: Mining enquiry', null, 'Price on request', 'available', false, '2026-01-01T12:00:00.000Z', 'images/products/mining.svg')
    ],
    settings: {
      companyName: 'ZYNO-CONSULT GLOBAL CONCEPT LTD',
      rcNo: '8651327',
      whatsappNumber: '2348080091300',
      phones: ['+234 808 009 1300', '+234 806 629 9425'],
      email: 'zynoglobalconceptsltd@gmail.com',
      whatsappMessageTemplate: 'Hello ZYNO-CONSULT, I would like to order: {product} ({service}) - {price}. Link: {link}'
    },
    meta: { updatedAt: T0, publishedAt: null }
  };

  function defaultData() { return clone(DEFAULT_DATA); }

  /* ---------- Make any loaded data safe and complete ---------- */
  function normalize(raw) {
    var d = defaultData();
    if (!raw || typeof raw !== 'object') return d;

    var settings = Object.assign({}, d.settings, raw.settings || {});
    settings.whatsappNumber = String(settings.whatsappNumber || '').replace(/\D/g, '') || d.settings.whatsappNumber;
    settings.phones = Array.isArray(settings.phones) ? settings.phones.map(String).filter(Boolean) : d.settings.phones;
    settings.whatsappMessageTemplate = String(settings.whatsappMessageTemplate || d.settings.whatsappMessageTemplate);

    var services = (Array.isArray(raw.services) ? raw.services : d.services).map(function (s, i) {
      return {
        id: String(s.id || id()),
        slug: slugify(s.slug || s.title || 'service-' + (i + 1)) || 'service-' + (i + 1),
        title: String(s.title || 'Untitled service'),
        shortDescription: String(s.shortDescription || ''),
        description: String(s.description || ''),
        bullets: Array.isArray(s.bullets) ? s.bullets.map(String).filter(Boolean) : [],
        icon: ICONS[s.icon] ? s.icon : 'globe',
        order: Number(s.order) || i + 1,
        visible: s.visible !== false,
        createdAt: s.createdAt || nowIso(),
        updatedAt: s.updatedAt || nowIso()
      };
    });

    var products = (Array.isArray(raw.products) ? raw.products : d.products).map(function (p) {
      var hasPrice = !(p.price === null || p.price === undefined || p.price === '' || isNaN(Number(p.price)));
      return {
        id: String(p.id || id()),
        serviceId: String(p.serviceId || ''),
        name: String(p.name || 'Untitled product'),
        description: String(p.description || ''),
        price: hasPrice ? Number(p.price) : null,
        priceNote: String(p.priceNote || ''),
        images: Array.isArray(p.images) ? p.images.map(String).filter(Boolean) : [],
        status: ['available', 'sold', 'hidden'].indexOf(p.status) > -1 ? p.status : 'available',
        featured: !!p.featured,
        createdAt: p.createdAt || nowIso(),
        updatedAt: p.updatedAt || nowIso()
      };
    });

    return {
      services: services,
      products: products,
      settings: settings,
      meta: Object.assign({}, d.meta, raw.meta || {})
    };
  }

  /* ---------- Local copy (this browser only) ---------- */
  function getLocal() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }

  function saveData(data) {
    try {
      data.meta = data.meta || {};
      data.meta.updatedAt = nowIso();
      localStorage.setItem(KEY, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      var full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      return { ok: false, error: full ? 'Browser storage is full. Use smaller images or image paths instead.' : 'Could not save your changes in this browser.' };
    }
  }

  function clearLocal() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function storageUsage() {
    var bytes = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        bytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
    } catch (e) { /* ignore */ }
    return { used: bytes, limit: LIMIT_BYTES, pct: Math.min(100, Math.round((bytes / LIMIT_BYTES) * 100)) };
  }

  /* ---------- Loading order ---------- */
  function isNewer(a, b) {
    var x = new Date(a.meta.updatedAt).getTime();
    var y = new Date(b.meta.updatedAt).getTime();
    return !isNaN(x) && (isNaN(y) || x > y);
  }

  function load(url) {
    var local = getLocal();
   return fetch(url || PUBLISHED_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('No published file'); return r.json(); })
      .then(function (json) { return normalize(json); })
      .catch(function () { return null; })
      .then(function (published) {
        var base = published || defaultData();
        if (local && isNewer(local, base)) return { data: local, source: 'local', unpublished: true };
        if (published) return { data: published, source: 'published', unpublished: false };
        return { data: base, source: 'default', unpublished: false };
      });
  }

  /* ---------- Add / update / remove (used by the admin) ---------- */
  function upsert(data, collection, item) {
    var list = data[collection];
    var stamp = nowIso();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === item.id) {
        list[i] = Object.assign({}, list[i], item, { updatedAt: stamp });
        return list[i];
      }
    }
    var fresh = Object.assign({}, item, { id: item.id || id(), createdAt: stamp, updatedAt: stamp });
    list.push(fresh);
    return fresh;
  }

  function remove(data, collection, itemId) {
    data[collection] = data[collection].filter(function (x) { return x.id !== itemId; });
  }

  /* ---------- Icon element (built from trusted constants) ---------- */
  function iconSvg(name) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('aria-hidden', 'true');
    var doc = new DOMParser().parseFromString('<svg xmlns="' + NS + '">' + (ICONS[name] || ICONS.globe) + '</svg>', 'image/svg+xml');
    Array.prototype.forEach.call(doc.documentElement.childNodes, function (n) {
      svg.appendChild(document.importNode(n, true));
    });
    return svg;
  }

  global.Zyno = {
    KEY: KEY,
    ICONS: ICONS,
    iconNames: Object.keys(ICONS),
    defaultData: defaultData,
    normalize: normalize,
    getLocal: getLocal,
    saveData: saveData,
    clearLocal: clearLocal,
    storageUsage: storageUsage,
    load: load,
    upsert: upsert,
    remove: remove,
    id: id,
    slugify: slugify,
    money: money,
    toTel: toTel,
    iconSvg: iconSvg
  };
})(window);