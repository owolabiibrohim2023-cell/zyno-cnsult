/* ZYNO-CONSULT admin: account, business settings, publishing and recovery tools. */
(() => {
  'use strict';

  const App = window.AdminApp;
  const Z = window.Zyno;
  const A = window.ZynoAuth;
  if (!App || !Z || !A) { console.warn('admin.js, js/store.js and js/auth.js must load before settings.js'); return; }

  const { el, toast } = App;
  const $ = (selector, root = document) => root.querySelector(selector);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^\+[1-9]\d{7,14}$/;
  const REQUIRED_TOKENS = ['{product}', '{service}', '{price}', '{link}'];

  function field(id, labelText, type, value, hint) {
    const wrap = el('div', 'field settings-field');
    const label = el('label', null, labelText);
    label.htmlFor = id;
    const input = type === 'textarea' ? el('textarea') : el('input');
    input.id = id;
    if (type !== 'textarea') input.type = type;
    input.value = value || '';
    const error = el('p', 'field__err');
    error.id = id + '-error';
    error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    wrap.append(label, input);
    if (hint) wrap.appendChild(el('p', 'field__hint', hint));
    wrap.appendChild(error);
    return { wrap, input, error };
  }

  function showError(f, message) {
    f.error.hidden = !message;
    f.error.textContent = message || '';
    if (message) f.input.setAttribute('aria-invalid', 'true');
    else f.input.removeAttribute('aria-invalid');
  }

  function card(title, subtitle) {
    const section = el('section', 'panel panel--pad settings-card');
    section.append(el('h2', 'settings-card__title', title));
    if (subtitle) section.appendChild(el('p', 'muted settings-card__lead', subtitle));
    return section;
  }

  function actionButton(label, cls, action) {
    const b = el('button', cls || 'btn');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', action);
    return b;
  }

  function saveSettings(next, successMessage) {
    const snapshot = JSON.stringify(App.state.data);
    App.state.data.settings = Object.assign({}, App.state.data.settings, next);
    if (!App.save()) {
      App.state.data = Z.normalize(JSON.parse(snapshot));
      return false;
    }
    toast(successMessage || 'Business details saved.');
    if (typeof window.renderPublicPreview === 'function') window.renderPublicPreview();
    return true;
  }

  function downloadJson(filename, markPublished) {
    const output = JSON.parse(JSON.stringify(App.state.data));
    const stamp = new Date().toISOString();
    if (markPublished) output.meta = Object.assign({}, output.meta, { updatedAt: stamp, publishedAt: stamp });
    const json = JSON.stringify(output, null, 2);
    const bytes = new Blob([json], { type: 'application/json' }).size;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = el('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    if (markPublished) {
      App.state.data = output;
      try { localStorage.setItem(Z.KEY, JSON.stringify(output)); } catch (err) {
        App.state.data.meta.publishedAt = null;
        toast('Downloaded, but this browser could not save the published timestamp. ' + (err.message || ''), 'err', 7000);
        App.updateIndicator();
        return bytes;
      }
      App.updateIndicator();
      if (location.hash.replace(/^#\/?/, '').split('/')[0] === 'overview') App.render();
    }
    return bytes;
  }

  function validateDataFile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The file must contain a JSON object.';
    if (!Array.isArray(value.services) || !Array.isArray(value.products) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings) || !value.meta || typeof value.meta !== 'object' || Array.isArray(value.meta)) {
      return 'This is not a valid site backup: services, products, settings and meta are required.';
    }
    if (value.services.some((s) => !s || typeof s !== 'object' || !s.id || !s.title || !s.slug)) return 'One or more services are missing an id, title or slug.';
    if (value.products.some((p) => !p || typeof p !== 'object' || !p.id || !p.name || !p.serviceId)) return 'One or more products are missing an id, name or service.';
    if (typeof value.settings.companyName !== 'string' || typeof value.settings.whatsappNumber !== 'string' || !Array.isArray(value.settings.phones)) return 'The backup is missing required business settings.';
    return '';
  }

  function confirmDialog(title, text, confirmLabel, onConfirm, danger) {
    const dlg = el('dialog', 'dlg');
    dlg.setAttribute('aria-labelledby', 'settings-confirm-heading');
    const heading = el('h2', null, title);
    heading.id = 'settings-confirm-heading';
    const body = el('p', null, text);
    const actions = el('div', 'dlg__actions');
    const cancel = actionButton('Cancel', 'btn btn--ghost', () => dlg.close());
    const yes = actionButton(confirmLabel, danger ? 'btn btn--danger-solid' : 'btn', () => { dlg.close(); onConfirm(); });
    actions.append(cancel, yes);
    dlg.append(heading, body, actions);
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove(), { once: true });
    dlg.showModal();
    cancel.focus();
  }

  function doubleConfirm(title, warning, phrase, action) {
    confirmDialog(title, warning + ' This cannot be undone.', 'Continue', () => {
      const dlg = el('dialog', 'dlg');
      dlg.setAttribute('aria-labelledby', 'danger-confirm-heading');
      const heading = el('h2', null, 'Confirm this action');
      heading.id = 'danger-confirm-heading';
      const text = el('p', null, 'Type ' + phrase + ' exactly to continue.');
      const input = el('input', 'danger-confirm-input');
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Type ' + phrase + ' to confirm');
      const error = el('p', 'field__err');
      error.hidden = true;
      const actions = el('div', 'dlg__actions');
      const cancel = actionButton('Cancel', 'btn btn--ghost', () => dlg.close());
      const yes = actionButton('Confirm', 'btn btn--danger-solid', () => {
        if (input.value.trim() !== phrase) { error.hidden = false; error.textContent = 'The confirmation text does not match.'; input.focus(); return; }
        dlg.close();
        action();
      });
      actions.append(cancel, yes);
      dlg.append(heading, text, input, error, actions);
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => dlg.remove(), { once: true });
      dlg.showModal();
      input.focus();
    }, true);
  }

  function renderAccount(page) {
    const info = A.getAdminInfo() || {};
    const account = card('Account', 'Update the dashboard sign-in details. Your password is saved in this browser only.');
    const userForm = el('form', 'settings-form');
    userForm.noValidate = true;
    const username = field('settings-username', 'Username', 'text', info.username || (A.getSession() || {}).username || '', 'Used next time you sign in.');
    const userCurrent = field('settings-user-current', 'Current password', 'password', '');
    const userSave = el('button', 'btn', 'Change username');
    userSave.type = 'submit';
    userForm.append(username.wrap, userCurrent.wrap, userSave);
    userForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      showError(username, ''); showError(userCurrent, '');
      if (!username.input.value.trim()) { showError(username, 'Enter a username.'); username.input.focus(); return; }
      if (!userCurrent.input.value) { showError(userCurrent, 'Enter your current password.'); userCurrent.input.focus(); return; }
      userSave.disabled = true;
      try {
        const result = await A.changeUsername(userCurrent.input.value, username.input.value);
        if (result.ok) {
          $('#userName').textContent = result.username;
          $('#userAv').textContent = result.username.charAt(0).toUpperCase();
          toast('Username changed. Use it at your next sign in.');
          App.render();
        } else showError(userCurrent, result.locked ? 'Too many incorrect attempts. Try again shortly.' : result.reason === 'storage' ? 'Browser storage is full. Free space and try again.' : 'That is not your current password.');
      } catch (err) { showError(userCurrent, 'Could not update the username in this browser.'); }
      userSave.disabled = false;
    });

    const passForm = el('form', 'settings-form');
    passForm.noValidate = true;
    const cur = field('settings-current-password', 'Current password', 'password', '');
    const next = field('settings-new-password', 'New password', 'password', '');
    next.input.minLength = 10;
    const strength = el('div', 'strength settings-strength');
    const meter = el('div', 'meter');
    const bar = el('i');
    meter.appendChild(bar);
    const strengthText = el('span', 'strength__txt', 'Use at least 10 characters.');
    strength.append(meter, strengthText);
    const confirm = field('settings-confirm-password', 'Confirm new password', 'password', '');
    const passSave = el('button', 'btn', 'Change password');
    passSave.type = 'submit';
    passForm.append(cur.wrap, next.wrap, strength, confirm.wrap, passSave);
    next.input.addEventListener('input', () => {
      const value = next.input.value;
      let score = 0;
      if (value.length >= 10) score++;
      if (value.length >= 14) score++;
      if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
      if (/\d/.test(value)) score++;
      if (/[^A-Za-z0-9]/.test(value)) score++;
      const pct = value.length < 10 ? (value ? 15 : 0) : [40, 55, 70, 85, 100][Math.max(0, score - 1)];
      const label = !value ? 'Use at least 10 characters.' : value.length < 10 ? 'Too short' : score < 3 ? 'Fair' : score < 5 ? 'Good' : 'Strong';
      meter.className = 'meter ' + (value.length < 10 ? 'meter--bad' : score < 3 ? 'meter--warn' : 'meter--ok');
      bar.style.setProperty('--w', pct + '%');
      strengthText.textContent = label;
    });
    passForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      [cur, next, confirm].forEach((f) => showError(f, ''));
      let invalid = null;
      const check = (f, message) => { showError(f, message); if (message && !invalid) invalid = f; };
      check(cur, cur.input.value ? '' : 'Enter your current password.');
      check(next, next.input.value.length < 10 ? 'Use at least 10 characters.' : next.input.value === cur.input.value ? 'Choose a password different from the current one.' : '');
      check(confirm, confirm.input.value !== next.input.value ? 'The two passwords do not match.' : '');
      if (invalid) { invalid.input.focus(); return; }
      passSave.disabled = true;
      try {
        const result = await A.changePassword(cur.input.value, next.input.value);
        if (result.ok) {
          toast('Password changed and saved in this browser.');
          const banner = $('#pwBanner');
          if (banner) banner.hidden = true;
          App.render();
        } else showError(cur, result.locked ? 'Too many incorrect attempts. Try again shortly.' : result.reason === 'storage' ? 'Browser storage is full. Free space and try again.' : 'That is not your current password.');
      } catch (err) { showError(cur, 'Could not change the password in this browser.'); }
      passSave.disabled = false;
    });
    account.append(userForm, el('hr', 'settings-divider'), passForm);
    page.appendChild(account);
  }

  function renderBusiness(page) {
    const s = App.state.data.settings;
    const business = card('Business details', 'These details are used in the website header, contact sections, footer and order links.');
    const form = el('form', 'settings-form');
    form.noValidate = true;
    const company = field('business-company', 'Company name', 'text', s.companyName);
    const rc = field('business-rc', 'RC number', 'text', s.rcNo);
    const whats = field('business-whatsapp', 'WhatsApp number', 'text', s.whatsappNumber, 'Digits only, country code first; for example 2348080091300.');
    whats.input.inputMode = 'numeric';
    whats.input.addEventListener('input', () => { whats.input.value = whats.input.value.replace(/\D/g, ''); });
    const email = field('business-email', 'Email address', 'email', s.email);
    const template = field('business-template', 'WhatsApp message template', 'textarea', s.whatsappMessageTemplate, 'Include all four placeholders: {product}, {service}, {price}, and {link}.');
    template.input.rows = 4;
    const phoneList = el('div', 'settings-phones');
    let phones = (s.phones || []).slice();
    const renderPhones = () => {
      phoneList.replaceChildren();
      if (!phones.length) phoneList.appendChild(el('p', 'field__hint', 'Add at least one international phone number.'));
      phones.forEach((number, index) => {
        const row = el('div', 'settings-phone-row');
        const f = field('business-phone-' + index, 'Phone ' + (index + 1), 'tel', number, 'International format, such as +2348080091300.');
        f.input.value = number;
        f.input.addEventListener('input', () => { phones[index] = f.input.value; });
        const remove = actionButton('Remove', 'btn btn--danger btn--sm', () => { phones.splice(index, 1); renderPhones(); });
        row.append(f.wrap, remove);
        phoneList.appendChild(row);
      });
    };
    renderPhones();
    const addPhone = actionButton('Add phone number', 'btn btn--ghost btn--sm', () => { phones.push(''); renderPhones(); $('#business-phone-' + (phones.length - 1)).focus(); });
    const preview = el('div', 'settings-preview');
    const previewTitle = el('strong', null, 'Live WhatsApp preview');
    const previewText = el('p', null, '');
    const updatePreview = () => {
      previewText.textContent = template.input.value
        .replace(/\{product\}/g, 'Example product')
        .replace(/\{service\}/g, 'Example service')
        .replace(/\{price\}/g, '₦12,000')
        .replace(/\{link\}/g, location.origin + location.pathname.replace(/admin\/.*$/, ''));
    };
    template.input.addEventListener('input', updatePreview);
    updatePreview();
    preview.append(previewTitle, previewText);
    const save = el('button', 'btn', 'Save business details');
    save.type = 'submit';
    const errorFields = [company, rc, whats, email, template];
    form.append(company.wrap, rc.wrap, whats.wrap, phoneList, addPhone, email.wrap, template.wrap, preview, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      errorFields.forEach((f) => showError(f, ''));
      let invalid = null;
      const check = (f, message) => { showError(f, message); if (message && !invalid) invalid = f; };
      check(company, company.input.value.trim() ? '' : 'Enter the company name.');
      check(rc, rc.input.value.trim() ? '' : 'Enter the registration number.');
      const digits = whats.input.value.replace(/\D/g, '');
      check(whats, /^\d{8,15}$/.test(digits) && digits[0] !== '0' ? '' : 'Enter 8–15 digits with the international country code, without a leading 0.');
      phones.forEach((phone, index) => {
        const f = $('#business-phone-' + index, form);
        const wrapper = f && f.closest('.field');
        if (!wrapper) return;
        const message = PHONE_RE.test(phone.replace(/[\s()-]/g, '')) ? '' : 'Use international format, for example +2348080091300.';
        const err = $('.field__err', wrapper);
        err.hidden = !message; err.textContent = message;
        if (message) { f.setAttribute('aria-invalid', 'true'); if (!invalid) invalid = { input: f }; }
        else f.removeAttribute('aria-invalid');
      });
      if (!phones.length) {
        const firstPhoneHint = phoneList.querySelector('.field__hint');
        if (firstPhoneHint) { firstPhoneHint.textContent = 'Add at least one valid international phone number.'; firstPhoneHint.setAttribute('aria-invalid', 'true'); }
        if (!invalid) invalid = { input: addPhone };
      }
      check(email, EMAIL_RE.test(email.input.value.trim()) ? '' : 'Enter a valid email address.');
      const missing = REQUIRED_TOKENS.filter((token) => !template.input.value.includes(token));
      check(template, template.input.value.trim() && !missing.length ? '' : 'Include every placeholder: ' + missing.join(', '));
      if (invalid) { invalid.input.focus(); return; }
      save.disabled = true;
      const saved = saveSettings({
        companyName: company.input.value.trim(), rcNo: rc.input.value.trim(), whatsappNumber: digits,
        phones: phones.map((p) => p.replace(/[\s()-]/g, '')), email: email.input.value.trim(),
        whatsappMessageTemplate: template.input.value.trim()
      });
      if (saved) save.disabled = false;
      else save.disabled = false;
    });
    business.appendChild(form);
    page.appendChild(business);
  }

  function renderPublish(page) {
    const publish = card('Publish', 'Your edits are saved in this browser. Visitors only see changes after you publish the downloaded file to your website.');
    const button = actionButton('Publish and download site-data.json', 'btn', () => {
      const bytes = downloadJson('site-data.json', true);
      $('#publish-size-warning').hidden = bytes <= 2 * 1024 * 1024;
      toast(bytes > 2 * 1024 * 1024 ? 'Publish file downloaded. It is over 2 MB; move uploaded images to image paths or URLs before uploading.' : 'Publish file downloaded. Upload it to your hosting to update the live site.', bytes > 2 * 1024 * 1024 ? 'err' : 'ok', 9000);
    });
    const warning = el('p', 'alert alert--error settings-warning', 'This file is over 2 MB. Move uploaded images to image paths or URLs to keep site data small.');
    warning.id = 'publish-size-warning';
    warning.hidden = true;
    const steps = el('ol', 'settings-steps');
    ['Download the file.', 'Upload it to your hosting, replacing data/site-data.json.', 'Refresh the site.'].forEach((step) => steps.appendChild(el('li', null, step)));
    publish.append(button, warning, steps);
    page.appendChild(publish);
  }

  function renderBackup(page) {
    const backup = card('Backup and restore', 'Download a copy before restoring or discarding any local changes.');
    const buttons = el('div', 'settings-actions');
    buttons.appendChild(actionButton('Download backup', 'btn btn--ghost', () => {
      const bytes = downloadJson('site-data-backup.json', false);
      toast(bytes > 2 * 1024 * 1024 ? 'Backup downloaded. It is over 2 MB because it includes uploaded images.' : 'Backup downloaded.');
    }));
    const fileInput = el('input', 'settings-file');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.setAttribute('aria-label', 'Choose a site backup file');
    const restoreButton = actionButton('Restore from file', 'btn btn--ghost', () => fileInput.click());
    buttons.append(restoreButton, fileInput);
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const error = validateDataFile(parsed);
        if (error) { toast(error, 'err', 7000); return; }
        confirmDialog('Restore this backup?', 'This replaces all services, products and business settings currently saved in this browser.', 'Restore backup', () => {
          const previous = JSON.stringify(App.state.data);
          App.state.data = Z.normalize(parsed);
          if (!App.save()) { App.state.data = Z.normalize(JSON.parse(previous)); return; }
          toast('Backup restored.');
          App.render();
        }, true);
      } catch (err) { toast('Could not read that backup. Choose a valid JSON file.', 'err', 7000); }
    });
    buttons.appendChild(actionButton('Reload published version', 'btn btn--ghost', () => {
      confirmDialog('Reload published version?', 'This discards all local edits in this browser and loads data/site-data.json from your hosting.', 'Reload published version', async () => {
        try {
          const response = await fetch('../data/site-data.json', { cache: 'no-store' });
          if (!response.ok) throw new Error('The published file could not be found.');
          const raw = await response.json();
          const error = validateDataFile(raw);
          if (error) throw new Error(error);
          const normalized = Z.normalize(raw);
          Z.clearLocal();
          App.state.data = normalized;
          App.state.source = 'published';
          App.updateIndicator();
          toast('Published version loaded. Local changes were discarded.');
          App.render();
        } catch (err) { toast(err.message || 'Could not load the published version.', 'err', 7000); }
      }, true);
    }));
    backup.appendChild(buttons);
    page.appendChild(backup);
  }

  function renderDanger(page) {
    const danger = card('Danger zone', 'These actions affect only this browser. Make a backup first if you may need these changes later.');
    danger.classList.add('settings-card--danger');
    const reset = actionButton('Reset the admin login to the default', 'btn btn--danger', () => {
      doubleConfirm('Reset admin login?', 'This resets the password to the default configured by your site and removes any saved username.', 'RESET LOGIN', async () => {
        try {
          await A.resetAdminLogin();
          const banner = $('#pwBanner');
          if (banner) banner.hidden = false;
          toast('Admin login reset. The default password is active again.');
          App.render();
        } catch (err) { toast('Could not reset the admin login in this browser.', 'err'); }
      });
    });
    const clear = actionButton('Clear all local data', 'btn btn--danger-solid', () => {
      doubleConfirm('Clear all local data?', 'This removes locally saved services, products, settings and admin login from this browser.', 'CLEAR DATA', () => {
        Z.clearLocal();
        ['zyno_admin', 'zyno_auth_fail', 'zyno_session'].forEach((key) => { try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch (err) { /* ignore */ } });
        toast('Local data cleared. Returning to sign in.');
        setTimeout(() => location.replace('login.html'), 500);
      });
    });
    danger.append(el('p', 'settings-danger-copy', 'Each action requires two separate confirmations.'), reset, clear);
    page.appendChild(danger);
  }

  function renderSettings(view) {
    const page = el('div', 'settings-page');
    renderAccount(page);
    renderBusiness(page);
    renderPublish(page);
    renderBackup(page);
    renderDanger(page);
    view.replaceChildren(page);
  }

  App.registerRoute('settings', renderSettings);
})();
