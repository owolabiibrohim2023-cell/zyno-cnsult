/* ZYNO-CONSULT admin: change password dialog.
   Opens from the top bar, the sidebar and the starting-password banner. */
(() => {
  'use strict';

  const App = window.AdminApp;
  const A = window.ZynoAuth;
  if (!App || !A) { console.warn('admin.js and js/auth.js must load before password.js'); return; }

  const { el, toast } = App;
  const MIN_LEN = 10;

  function passwordField(id, labelText, autocomplete) {
    const wrap = el('div', 'field');
    const label = el('label', null, labelText);
    label.htmlFor = id;

    const box = el('div', 'pw');
    const input = el('input');
    input.type = 'password';
    input.id = id;
    input.autocomplete = autocomplete;

    const toggle = el('button', 'pw__toggle', 'Show');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Show ' + labelText.toLowerCase());
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', (show ? 'Hide ' : 'Show ') + labelText.toLowerCase());
    });
    box.append(input, toggle);

    const err = el('p', 'field__err');
    err.id = id + '-err';
    err.hidden = true;
    input.setAttribute('aria-describedby', err.id);

    wrap.append(label, box, err);
    return { wrap, input, err };
  }

  function strength(p) {
    let s = 0;
    if (p.length >= MIN_LEN) s++;
    if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    if (!p.length) return { pct: 0, label: '', cls: '' };
    if (p.length < MIN_LEN) return { pct: 15, label: 'Too short', cls: 'meter--bad' };
    if (s <= 2) return { pct: 40, label: 'Fair', cls: 'meter--warn' };
    if (s === 3) return { pct: 70, label: 'Good', cls: 'meter--ok' };
    return { pct: 100, label: 'Strong', cls: 'meter--ok' };
  }

  function showErr(field, message) {
    field.err.hidden = !message;
    field.err.textContent = message || '';
    if (message) field.input.setAttribute('aria-invalid', 'true');
    else field.input.removeAttribute('aria-invalid');
  }

  function openDialog() {
    const dlg = el('dialog', 'dlg dlg--pw');
    dlg.setAttribute('aria-labelledby', 'pw-heading');

    const h = el('h2', null, 'Change password');
    h.id = 'pw-heading';
    const lead = el('p', 'lead', 'Choose a new password. You can change it again any time. It is saved in this browser only.');

    const form = el('form');
    form.noValidate = true;

    const fCur = passwordField('pw-cur', 'Current password', 'current-password');
    const fNew = passwordField('pw-new', 'New password', 'new-password');

    const meterBox = el('div', 'strength');
    const meter = el('div', 'meter');
    const bar = el('i');
    meter.appendChild(bar);
    const meterTxt = el('span', 'strength__txt', 'At least ' + MIN_LEN + ' characters. Mix letters, numbers and symbols for a stronger one.');
    meterBox.append(meter, meterTxt);

    const fConf = passwordField('pw-conf', 'Confirm new password', 'new-password');

    const status = el('p', 'field__err');
    status.hidden = true;
    status.setAttribute('role', 'alert');

    const actions = el('div', 'dlg__actions');
    const cancel = el('button', 'btn btn--ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => dlg.close());
    const save = el('button', 'btn', 'Change password');
    save.type = 'submit';
    actions.append(cancel, save);

    form.append(fCur.wrap, fNew.wrap, meterBox, fConf.wrap, status, actions);
    dlg.append(h, lead, form);

    fNew.input.addEventListener('input', () => {
      const s = strength(fNew.input.value);
      meter.className = 'meter ' + s.cls;
      bar.style.setProperty('--w', s.pct + '%');
      if (s.label) meterTxt.textContent = s.label;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.hidden = true;

      const cur = fCur.input.value;
      const next = fNew.input.value;
      const conf = fConf.input.value;

      let bad = null;
      const check = (field, message) => {
        showErr(field, message);
        if (message && !bad) bad = field;
      };
      check(fCur, cur ? '' : 'Enter your current password.');
      check(fNew, next.length < MIN_LEN ? 'Use at least ' + MIN_LEN + ' characters.' : (next === cur ? 'Choose a password different from the current one.' : ''));
      check(fConf, conf !== next ? 'The two passwords do not match.' : '');
      if (bad) { bad.input.focus(); return; }

      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        const res = await A.changePassword(cur, next);
        if (res.ok) {
          dlg.close();
          const banner = document.getElementById('pwBanner');
          if (banner) banner.hidden = true;
          toast('Password changed. Use the new one next time you sign in.');
          return;
        }
        if (res.locked) {
          status.hidden = false;
          status.textContent = 'Too many wrong attempts. Try again in a minute.';
        } else {
          showErr(fCur, 'That is not your current password.');
          fCur.input.value = '';
          fCur.input.focus();
        }
      } catch (err) {
        status.hidden = false;
        status.textContent = 'Could not change the password in this browser.';
      }
      save.disabled = false;
      save.textContent = 'Change password';
    });

    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('mousedown', (e) => {
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
    dlg.showModal();
    fCur.input.focus();
  }

  ['pwTop', 'pwSide', 'pwBannerBtn'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', openDialog);
  });
})();