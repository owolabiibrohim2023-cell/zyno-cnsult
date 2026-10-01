/* ZYNO-CONSULT: builds the public Services grid, Products grid, filters,
   navigation links and WhatsApp order buttons from the data in store.js. */
(() => {
  'use strict';

  const Z = window.Zyno;
  if (!Z) { console.warn('js/store.js is missing'); return; }

  const DEFAULTS = Z.defaultData().settings;
  const state = { data: null, filter: 'all' };
  const DEFAULT_PRODUCT_IMAGES = {
    'prd-re-1': 'images/products/bungalow.svg',
    'prd-re-2': 'images/products/residential-land.svg',
    'prd-car-1': 'images/products/suv.svg',
    'prd-car-2': 'images/products/sedan.svg',
    'prd-ie-1': 'images/products/import-cargo.svg',
    'prd-ie-2': 'images/products/export-cargo.svg',
    'prd-mb-1': 'images/products/borehole-drilling.svg',
    'prd-mb-2': 'images/products/mining.svg'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------- Data helpers ---------- */
  const services = () => state.data.services.filter((s) => s.visible !== false).sort((a, b) => a.order - b.order);
  const serviceById = (sid) => state.data.services.find((s) => s.id === sid);
  const visibleIds = () => new Set(services().map((s) => s.id));

  function products() {
    const ok = visibleIds();
    return state.data.products
      .filter((p) => p.status !== 'hidden' && ok.has(p.serviceId))
      .sort((a, b) =>
        (a.status === 'sold') - (b.status === 'sold') ||
        (b.featured ? 1 : 0) - (a.featured ? 1 : 0) ||
        new Date(b.createdAt) - new Date(a.createdAt));
  }

  const countFor = (sid) => products().filter((p) => p.serviceId === sid).length;

  function priceText(p) {
    if (p.price !== null) return Z.money(p.price) + (p.priceNote ? ' (' + p.priceNote + ')' : '');
    return p.priceNote || 'Price on request';
  }

  const waUrl = (text) => 'https://wa.me/' + state.data.settings.whatsappNumber + '?text=' + encodeURIComponent(text);

  function orderMessage(p, svc) {
    const link = location.href.split('#')[0] + '#products';
    return state.data.settings.whatsappMessageTemplate
      .replace(/\{product\}/g, () => p.name)
      .replace(/\{service\}/g, () => (svc ? svc.title : 'General'))
      .replace(/\{price\}/g, () => priceText(p))
      .replace(/\{link\}/g, () => link);
  }

  function safeSrc(v) {
    const s = String(v).trim();
    if (/^(javascript|vbscript):/i.test(s)) return false;
    if (/^data:/i.test(s)) return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s);
    return true;
  }

  /* ---------- Skeletons and empty states ---------- */
  const skeletons = (box, n, cls) => box.replaceChildren(...Array.from({ length: n }, () => el('div', 'skel ' + cls)));

  function emptyState(message, actionLabel, onClick, href) {
    const box = el('div', 'empty');
    box.appendChild(el('p', null, message));
    if (href) {
      const a = el('a', 'btn btn--wa', actionLabel);
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      box.appendChild(a);
    } else if (onClick) {
      const b = el('button', 'btn btn--ghost', actionLabel);
      b.type = 'button';
      b.addEventListener('click', onClick);
      box.appendChild(b);
    }
    return box;
  }

  /* ---------- Services grid ---------- */
  function serviceCard(s, i) {
    const card = el('article', 'scard');
    card.id = s.slug;
    card.style.setProperty('--i', i);

    const ico = el('div', 'scard__icon');
    ico.appendChild(Z.iconSvg(s.icon));
    card.append(ico, el('h3', null, s.title), el('p', 'scard__text', s.shortDescription));

    if (s.bullets.length) {
      const ul = el('ul', 'scard__list');
      s.bullets.forEach((b) => ul.appendChild(el('li', null, b)));
      card.appendChild(ul);
    }

    const foot = el('div', 'scard__foot');
    const n = countFor(s.id);
    if (n > 0) {
      const btn = el('button', 'btn btn--ghost', 'View products (' + n + ')');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        state.filter = s.id;
        renderFilters();
        renderProducts();
        $('#products').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      foot.appendChild(btn);
    } else {
      const a = el('a', 'btn btn--wa', 'Enquire on WhatsApp');
      a.href = waUrl('Hello ZYNO-CONSULT, I would like to enquire about ' + s.title + '.');
      a.target = '_blank'; a.rel = 'noopener';
      foot.appendChild(a);
    }
    card.appendChild(foot);
    return card;
  }

  function renderServices() {
    const box = $('#servicesGrid');
    if (!box) return;
    const list = services();
    if (!list.length) {
      box.replaceChildren(emptyState('Our services are being updated. Message us and we will help you directly.', 'Chat on WhatsApp', null, waUrl('Hello ZYNO-CONSULT, I would like to make an enquiry.')));
      return;
    }
    box.replaceChildren(...list.map(serviceCard));
  }

  /* ---------- Filters ---------- */
  function renderFilters() {
    const box = $('#productFilters');
    if (!box) return;
    if (state.filter !== 'all' && !visibleIds().has(state.filter)) state.filter = 'all';

    const add = (fid, label, n) => {
      const b = el('button', 'chip-btn');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.filter === fid));
      b.append(label, el('small', null, String(n)));
      b.addEventListener('click', () => {
        state.filter = fid;
        renderFilters();
        renderProducts();
      });
      box.appendChild(b);
    };

    box.replaceChildren();
    add('all', 'All', products().length);
    services().forEach((s) => add(s.id, s.title, countFor(s.id)));
  }

  /* ---------- Products grid ---------- */
  function placeholder(svc) {
    const ph = el('div', 'pcard__ph');
    ph.appendChild(Z.iconSvg(svc ? svc.icon : 'globe'));
    return ph;
  }

  function productCard(p, i) {
    const svc = serviceById(p.serviceId);
    const card = el('article', 'pcard');
    card.style.setProperty('--i', Math.min(i, 8));

    const media = el('div', 'pcard__media');
    const cover = p.images[0] || DEFAULT_PRODUCT_IMAGES[p.id];
    if (cover && safeSrc(cover)) {
      const img = document.createElement('img');
      img.src = cover;
      img.alt = p.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 800;
      img.height = 600;
      img.addEventListener('error', () => media.replaceChildren(placeholder(svc), tags()));
      media.appendChild(img);
    } else {
      media.appendChild(placeholder(svc));
    }

    function tags() {
      const t = el('div', 'pcard__tags');
      if (p.status === 'sold') t.appendChild(el('span', 'ptag ptag--sold', 'Sold'));
      else if (p.featured) t.appendChild(el('span', 'ptag ptag--feat', 'Featured'));
      return t;
    }
    media.appendChild(tags());

    const body = el('div', 'pcard__body');
    body.append(el('span', 'pcard__service', svc ? svc.title : 'General'), el('h3', 'pcard__name', p.name));
    if (p.description) body.appendChild(el('p', 'pcard__desc', p.description));

    const price = el('p', 'pcard__price');
    if (p.price !== null) {
      price.textContent = Z.money(p.price);
      if (p.priceNote) price.appendChild(el('small', null, ' ' + p.priceNote));
    } else {
      price.textContent = p.priceNote || 'Price on request';
    }
    body.appendChild(price);

    if (p.status === 'sold') {
      const b = el('button', 'btn', 'Sold');
      b.type = 'button';
      b.disabled = true;
      const more = el('a', 'pcard__sold-link', 'Ask about similar');
      more.href = waUrl('Hello ZYNO-CONSULT, I saw that ' + p.name + ' is sold. Do you have something similar?');
      more.target = '_blank'; more.rel = 'noopener';
      body.append(b, more);
    } else {
      const a = el('a', 'btn btn--wa', 'Order on WhatsApp');
      a.href = waUrl(orderMessage(p, svc));
      a.target = '_blank'; a.rel = 'noopener';
      body.appendChild(a);
    }

    card.append(media, body);
    return card;
  }

  function renderProducts() {
    const box = $('#productsGrid');
    if (!box) return;
    const all = products();
    const list = state.filter === 'all' ? all : all.filter((p) => p.serviceId === state.filter);

    if (!all.length) {
      box.replaceChildren(emptyState('No products are listed yet. Message us to ask what is available.', 'Ask on WhatsApp', null, waUrl('Hello ZYNO-CONSULT, what do you currently have available?')));
    } else if (!list.length) {
      box.replaceChildren(emptyState('Nothing in this category right now.', 'Show all products', () => { state.filter = 'all'; renderFilters(); renderProducts(); }));
    } else {
      box.replaceChildren(...list.map(productCard));
    }
  }

  /* ---------- Links that depend on the services ---------- */
  function renderLinks() {
    const list = services();
    if (!list.length) return;

    const linkItem = (s) => {
      const li = el('li');
      const a = el('a', null, s.title);
      a.href = '#' + s.slug;
      li.appendChild(a);
      return li;
    };
    ['#navServices', '#footerServices'].forEach((sel) => {
      const ul = $(sel);
      if (ul) ul.replaceChildren(...list.map(linkItem));
    });

    const hero = $('#heroServices');
    if (hero) {
      hero.replaceChildren(...list.slice(0, 4).map((s) => {
        const li = el('li');
        const a = el('a');
        a.href = '#' + s.slug;
        a.append(Z.iconSvg(s.icon), el('strong', null, s.title), el('span', null, s.shortDescription));
        li.appendChild(a);
        return li;
      }));
    }
  }

  /* ---------- Settings: phones, email, RC number, WhatsApp number ---------- */
  function applySettings(s) {
    const pairs = [];
    const add = (from, to) => { if (from && to && from !== to) pairs.push([from, to]); };
    add(DEFAULTS.companyName, s.companyName);
    add(DEFAULTS.rcNo, s.rcNo);
    add(DEFAULTS.phones[0], s.phones[0]);
    add(DEFAULTS.phones[1], s.phones[1]);
    add(DEFAULTS.email, s.email);
    add(DEFAULTS.rcNo, s.rcNo);
    const waChanged = s.whatsappNumber !== DEFAULTS.whatsappNumber;
    if (!pairs.length && !waChanged) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      let t = n.nodeValue;
      pairs.forEach(([a, b]) => { t = t.split(a).join(b); });
      if (t !== n.nodeValue) n.nodeValue = t;
    });
    const brandName = $('.brand__text strong');
    if (brandName) brandName.textContent = s.companyName;
    const footerLogo = $('.zy-footer__logo-text');
    if (footerLogo && footerLogo.firstChild && footerLogo.firstChild.nodeType === Node.TEXT_NODE) footerLogo.firstChild.nodeValue = s.companyName;

    const displayPhone = (phone) => String(phone || '').trim();
    const telPhone = (phone) => 'tel:' + Z.toTel(phone);
    const topbar = $('#topbarContact');
    if (topbar) {
      const emailItem = topbar.querySelector('.topbar__mail');
      topbar.replaceChildren();
      s.phones.forEach((phone) => {
        const li = el('li');
        const a = el('a', null, displayPhone(phone));
        a.href = telPhone(phone);
        li.appendChild(a);
        topbar.appendChild(li);
      });
      if (emailItem) {
        const emailLink = emailItem.querySelector('a');
        if (emailLink) { emailLink.href = 'mailto:' + s.email; emailLink.textContent = s.email; }
        topbar.appendChild(emailItem);
      }
    }
    const topRc = $('#topbarRc');
    if (topRc) topRc.textContent = 'RC No: ' + s.rcNo;

    const methodBox = $('#contactMethods');
    if (methodBox) {
      const whatsapp = methodBox.querySelector('a[href*="wa.me"]');
      const phoneTemplate = methodBox.querySelector('a[href^="tel:"]');
      const email = methodBox.querySelector('a[href^="mailto:"]');
      methodBox.replaceChildren();
      if (whatsapp) {
        whatsapp.href = 'https://wa.me/' + s.whatsappNumber;
        const strong = whatsapp.querySelector('strong');
        if (strong) strong.textContent = '+' + s.whatsappNumber;
        methodBox.appendChild(whatsapp);
      }
      s.phones.forEach((phone, i) => {
        if (!phoneTemplate) return;
        const item = phoneTemplate.cloneNode(true);
        item.href = telPhone(phone);
        const small = item.querySelector('small');
        const strong = item.querySelector('strong');
        if (small) small.textContent = i ? 'PHONE ' + (i + 1) : 'PHONE';
        if (strong) strong.textContent = displayPhone(phone);
        methodBox.appendChild(item);
      });
      if (email) {
        email.href = 'mailto:' + s.email;
        const strong = email.querySelector('strong');
        if (strong) strong.textContent = s.email;
        methodBox.appendChild(email);
      }
    }

    const footerContact = $('#footerContact');
    if (footerContact) {
      const heading = footerContact.querySelector('h3');
      footerContact.replaceChildren();
      if (heading) footerContact.appendChild(heading);
      s.phones.forEach((phone, i) => {
        const a = el('a', 'zy-footer__contact-item');
        a.href = telPhone(phone);
        a.append(el('span', 'zy-footer__contact-icon', '\u2706'));
        const text = el('span');
        text.append(el('small', null, i ? 'Alternative line' : 'Call us'), document.createTextNode(displayPhone(phone)));
        a.appendChild(text);
        footerContact.appendChild(a);
      });
      const mail = el('a', 'zy-footer__contact-item');
      mail.href = 'mailto:' + s.email;
      mail.append(el('span', 'zy-footer__contact-icon', '\u2709'));
      const mailText = el('span');
      mailText.append(el('small', null, 'Email'), document.createTextNode(s.email));
      mail.appendChild(mailText);
      footerContact.appendChild(mail);
    }

    const whatsappLinks = document.querySelectorAll('a[href*="wa.me/"]');
    whatsappLinks.forEach((a) => {
      const href = a.getAttribute('href') || '';
      a.setAttribute('href', href.replace(/https:\/\/wa\.me\/[^/?#]+/i, 'https://wa.me/' + s.whatsappNumber));
    });

    const telMap = {
      'tel:+2348080091300': s.phones[0] && 'tel:' + Z.toTel(s.phones[0]),
      'tel:+2348066299425': s.phones[1] && 'tel:' + Z.toTel(s.phones[1])
    };
    document.querySelectorAll('a[href]').forEach((a) => {
      const h = a.getAttribute('href');
      if (telMap[h]) a.setAttribute('href', telMap[h]);
      else if (h === 'mailto:' + DEFAULTS.email && s.email) a.setAttribute('href', 'mailto:' + s.email);
      else if (waChanged && h.indexOf('wa.me/' + DEFAULTS.whatsappNumber) > -1) {
        a.setAttribute('href', h.replace('wa.me/' + DEFAULTS.whatsappNumber, 'wa.me/' + s.whatsappNumber));
      }
    });
  }

  /* ---------- Banner shown only when this browser has unpublished edits ---------- */
  function previewBanner() {
    const b = el('div', 'preview-banner');
    b.setAttribute('role', 'status');
    b.appendChild(el('span', null, 'Previewing unpublished changes'));
    const d = el('button', null, 'Discard');
    d.type = 'button';
    d.addEventListener('click', () => { Z.clearLocal(); location.reload(); });
    b.appendChild(d);
    document.body.appendChild(b);
  }

  /* ---------- Start ---------- */
  const servicesBox = $('#servicesGrid');
  const productsBox = $('#productsGrid');
  if (servicesBox) skeletons(servicesBox, 4, 'skel--s');
  if (productsBox) skeletons(productsBox, 4, '');

  Z.load().then((res) => {
    state.data = res.data;
    try { applySettings(state.data.settings); } catch (e) { /* keep static text */ }
    try {
      renderLinks();
      renderServices();
      renderFilters();
      renderProducts();
    } catch (e) {
      console.error(e);
      const msg = emptyState('Something went wrong loading this section. Please refresh the page.', 'Refresh', () => location.reload());
      if (servicesBox) servicesBox.replaceChildren(msg.cloneNode(true));
      if (productsBox) productsBox.replaceChildren(msg);
    }
    if (res.unpublished) previewBanner();
  });
})();