// ==UserScript==
// @name         MESA Events → ESN Activities
// @namespace    https://esnmesa.org/events-platform
// @version      3.0
// @description  Comms only: fills "Register your physical activity" on activities.esn.org from MESA Events and links the saved activity back.
// @match        https://activities.esn.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      __MESA_HOST__
// ==/UserScript==
/*
 * Ported from the description bot (esn-event-description-bot,
 * tools/esn-activities/mesa-esn.user.js); the bot's web app is replaced by
 * the MESA Events API and a personal access token.
 *
 * Flow (from MESA Events – the Comms page or an event's Hand-in tab):
 *   1. Comms clicks "Open ESN form" → this form opens with #mesa=<event id>
 *   2. the script loads the event's ESN form data and fills the form (never submits)
 *   3. Comms checks the form and clicks Save
 *   4. on the saved activity page the script offers "Link to MESA Events" →
 *      the platform stores the link, marks the event uploaded and tells the
 *      event's Chat space
 * Installed from the "ESN Activities" page of MESA Events, which fills in
 * BASE and (when the token was just created) TOKEN. Without a token the
 * box asks for one and keeps it in Tampermonkey's storage.
 */
(function () {
  'use strict';
  const BASE = '__MESA_BASE_URL__';
  const EMBEDDED_TOKEN = '__MESA_TOKEN__';
  const FORM_PATH = '/add/physical-activity';
  const PENDING = 'mesaPending';
  const TOKEN_KEY = 'mesaToken';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; // page world: jQuery, CKEditor
  const doc = W.document;
  const P = 'field_ct_act_';

  const token = () => GM_getValue(TOKEN_KEY, '') || (/^mesa_esn_/.test(EMBEDDED_TOKEN) ? EMBEDDED_TOKEN : '');

  // ---------------------------------------------------------------- MESA Events API
  const api = (method, path, body) => new Promise((resolve, reject) => {
    if (!token()) { reject(Object.assign(new Error('no personal access token yet'), { status: 401 })); return; }
    GM_xmlhttpRequest({
      method,
      url: `${BASE}${path}`,
      data: body ? JSON.stringify(body) : undefined,
      headers: Object.assign({ Authorization: `Bearer ${token()}` }, body ? { 'Content-Type': 'application/json' } : {}),
      anonymous: true, // no cookies – the token is the only credential
      onload: r => {
        let res = null;
        try { res = JSON.parse(r.responseText); } catch { /* below */ }
        if (res && res.ok) resolve(res);
        else reject(Object.assign(new Error(res && res.error ? res.error : `unexpected answer from MESA Events (HTTP ${r.status})`), { status: r.status }));
      },
      onerror: () => reject(new Error('MESA Events could not be reached')),
    });
  });

  // ---------------------------------------------------------------- box
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const banner = (html, buttons) => {
    const old = doc.getElementById('mesa-banner');
    if (old) old.remove();
    const box = doc.createElement('div');
    box.id = 'mesa-banner';
    box.style.cssText = 'position:fixed;z-index:99999;right:16px;bottom:16px;max-width:440px;background:#fff;color:#222;' +
      'border:2px solid #2e3192;border-radius:8px;padding:12px 14px;font:14px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)';
    box.innerHTML = `<div style="font-weight:bold;margin-bottom:4px">MESA Events → ESN</div>${html}`;
    const row = doc.createElement('div');
    row.style.marginTop = '8px';
    (buttons || [['Close', () => box.remove()]]).forEach(([label, fn, primary]) => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.style.cssText = `margin-right:8px;padding:4px 10px;cursor:pointer;${primary ? 'background:#2e3192;color:#fff;border:0;border-radius:4px' : ''}`;
      b.addEventListener('click', fn);
      row.appendChild(b);
    });
    box.appendChild(row);
    doc.body.appendChild(box);
    return box;
  };
  const close = () => { const b = doc.getElementById('mesa-banner'); if (b) b.remove(); };

  /** Asks for a personal access token (MESA Events → Comms → ESN Activities), then retries. */
  function askToken(message, retry) {
    banner(`<span style="color:#b71c1c">${esc(message)}</span><br>Create a personal access token on the <b>ESN Activities</b> page of MESA Events and paste it here.`, [
      ['Paste token', () => {
        const t = (W.prompt('Personal access token (mesa_esn_…):') || '').trim();
        if (!/^mesa_esn_[A-Za-z0-9_-]{43}$/.test(t)) { askToken('That is not a MESA Events token.', retry); return; }
        GM_setValue(TOKEN_KEY, t);
        retry();
      }, true],
      ['Close', close],
    ]);
  }

  // ---------------------------------------------------------------- form filling (never submits)
  async function fill(data) {
    const byName = n => doc.querySelector(`[name="${n}"]`);
    const filled = [];
    const problems = [];
    const mark = (el, ok) => {
      const box = el && (el.closest('.js-form-item, fieldset') || el);
      if (box) box.style.outline = ok ? '2px solid #2e7d32' : '3px solid #d32f2f';
    };
    const setValue = (el, value, label) => {
      if (!el) { problems.push(`${label}: field not found`); return; }
      const proto = el.tagName === 'SELECT' ? W.HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value == null ? '' : String(value));
      el.dispatchEvent(new W.Event('input', { bubbles: true }));
      el.dispatchEvent(new W.Event('change', { bubbles: true }));
      const ok = value !== '' && value != null;
      mark(el, ok);
      (ok ? filled : problems).push(ok ? label : `${label}: missing`);
    };
    const check = (el, on) => { if (el && el.checked !== on) el.click(); };
    const radio = (name, value, label) => {
      const el = doc.querySelector(`input[type=radio][name="${name}"][value="${value}"]`);
      if (!el) { problems.push(`${label}: option not found`); return; }
      check(el, true);
      mark(el, true);
      filled.push(label);
    };
    const boxes = (field, ids, label) => {
      const all = [...doc.querySelectorAll(`input[type=checkbox][name^="${P}${field}["]`)];
      all.forEach(el => check(el, ids.indexOf(el.name.match(/\[(\d+)\]/)[1]) >= 0));
      if (all.length) mark(all[0], ids.length > 0);
      (ids.length ? filled : problems).push(ids.length ? label : `${label}: missing`);
    };
    const rich = (field, html, label) => {
      const ta = byName(`${P}${field}[0][value]`);
      if (!ta) { problems.push(`${label}: field not found`); return; }
      const wrap = ta.closest('.js-form-item') || ta.parentElement;
      const editable = wrap.querySelector('.ck-editor__editable');
      const isHtml = /^\s*</.test(html || '');
      if (editable && editable.ckeditorInstance) {
        editable.ckeditorInstance.setData(isHtml ? html : (html ? `<p>${esc(html)}</p>` : ''));
      } else {
        const text = isHtml ? html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') : (html || '');
        Object.getOwnPropertyDescriptor(W.HTMLTextAreaElement.prototype, 'value').set.call(ta, text);
        ta.dispatchEvent(new W.Event('input', { bubbles: true }));
        ta.dispatchEvent(new W.Event('change', { bubbles: true }));
      }
      mark(ta, !!html);
      (html ? filled : problems).push(html ? label : `${label}: missing`);
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const waitFor = async (test, ms) => {
      for (let t = 0; t < ms; t += 200) { if (test()) return true; await sleep(200); }
      return false;
    };

    // organisers + general
    setValue(byName('title[0][value]'), data.title, 'Title');
    setValue(byName(`${P}organiser`), '160', 'Organiser');
    radio(`${P}has_external_organ`, '0', 'External organisation: No');
    radio(`${P}organisation_is`, '613', 'Main organiser');
    setValue(byName(`${P}dates[0][value][date]`), data.start, 'Start date');
    setValue(byName(`${P}dates[0][end_value][date]`), data.end, 'End date');
    if (data.link) setValue(byName(`${P}link_registrat[0][uri]`), data.link, 'Link');
    boxes('objectives', data.objectives, 'Objectives');
    boxes('types', data.types, 'Type of activity');
    rich('goal_activity', data.goal, 'Goal of the activity');
    rich('description', data.description, 'Description');
    boxes('target_audience', data.audience, 'Target audience');

    // participants + funding
    setValue(byName(`${P}num_local_part[0][value]`), data.local, 'Local participants');
    setValue(byName(`${P}num_int_stud[0][value]`), data.intl, 'International students');
    setValue(byName(`${P}num_coordinators[0][value]`), data.coord, 'Coordinators');
    boxes('how_event_financed', data.funding, 'Funding');
    if (data.fee) {
      setValue(byName(`${P}participation_fee[0][value]`), data.fee, 'Participation fee');
      const cur = byName(`${P}part_fee_currency`);
      if (cur) {
        const eur = [...cur.options].find(o => /^EUR$|euro/i.test(o.value) || /euro/i.test(o.text));
        if (eur) setValue(cur, eur.value, 'Fee currency');
      }
    }

    // accessibility + results + sustainability
    (data.access || []).forEach((v, i) => radio(`${P}accessible-row-${i}`, String(v), `Accessibility rating ${i + 1}`));
    radio(`${P}has_ppl_access_need`, data.accessNeeds ? '1' : '0', 'People with accessibility needs');
    if (data.accessNeeds) {
      await sleep(300);
      const n = (String(data.accessNote).match(/\d+/) || [])[0];
      if (n) setValue(byName(`${P}num_ppl_access_need[0][value]`), n, 'How many (accessibility)');
      rich('actions_meet_access', data.accessNote, 'Accessibility measures');
    }
    radio(`${P}res_object_reach`, data.reached ? '1' : '0', 'Objectives reached');
    rich('res_pos_aspect', data.positive, 'Positive aspects');
    if (data.improve) {
      rich('res_neg_aspect', data.improve, 'Negative aspects');
      rich('res_room_improve', data.improve, 'Room for improvement');
    }
    (data.sustain || []).forEach((v, i) => radio(`${P}environ_sust-row-${i}`, String(v), `Sustainability rating ${i + 1}`));

    // address last: changing the country reloads the address fields (AJAX)
    const countryName = `${P}location[0][address][country_code]`;
    const country = byName(countryName);
    if (country && country.value !== data.country) {
      if (W.jQuery) W.jQuery(country).val(data.country).trigger('change');
      else setValue(country, data.country, 'Country');
      await waitFor(() => {
        const c = byName(countryName);
        return c && c.value === data.country && !doc.querySelector('.ajax-progress') &&
          byName(`${P}location[0][address][postal_code]`);
      }, 10000);
      await sleep(300);
    }
    filled.push('Country');
    setValue(byName(`${P}location[0][address][address_line1]`), data.street, 'Street address');
    setValue(byName(`${P}location[0][address][postal_code]`), data.postal, 'Postal code');
    setValue(byName(`${P}location[0][address][locality]`), data.city, 'City');
    return { filled, todo: problems.concat((data.missing || []).map(m => `From MESA Events: ${m}`)) };
  }

  // ---------------------------------------------------------------- 1+2: open the form for an event
  async function startUpload(eventId) {
    banner('Loading the event from MESA Events …', []);
    try {
      const { data } = await api('GET', `/api/esn/events/${encodeURIComponent(eventId)}`);
      const res = await fill(data);
      GM_setValue(PENDING, JSON.stringify({ event: eventId, title: data.title, at: Date.now() }));
      banner(`Filled ${res.filled.length} fields for <b>${esc(data.title)}</b>.` +
        (res.todo.length ? `<div style="color:#b71c1c;margin-top:6px">Please complete (red outline):<br>• ${res.todo.map(esc).join('<br>• ')}</div>` : '') +
        '<div style="margin-top:6px">Optional: header image (1920×460) and gallery. Check everything, then click <b>Save</b>. ' +
        'Afterwards this box offers to link the activity to MESA Events.</div>');
    } catch (e) {
      if (e.status === 401) askToken(e.message, () => startUpload(eventId));
      else banner(`<span style="color:#b71c1c">Could not load the event: ${esc(e.message)}</span>`);
    }
  }

  // ---------------------------------------------------------------- 4: after Save – link back
  function offerLink(pending) {
    const url = `${location.origin}${location.pathname}`;
    banner(`Is this the activity you just saved for <b>${esc(pending.title)}</b>?<br>` +
      `<span style="color:#555;font-size:12px">${esc(url)}</span>`, [
      ['Link to MESA Events', async () => {
        banner('Linking …', []);
        try {
          await api('POST', `/api/esn/events/${encodeURIComponent(pending.event)}/linked`, { url });
          GM_setValue(PENDING, '');
          banner(`✓ Linked: <b>${esc(pending.title)}</b>. The event is marked uploaded in MESA Events and its Chat space was told.`);
        } catch (e) {
          if (e.status === 401) { askToken(e.message, () => offerLink(pending)); return; }
          banner(`<span style="color:#b71c1c">Not linked: ${esc(e.message)}</span>`, [
            ['Try again', () => offerLink(pending), true], ['Close', close]]);
        }
      }, true],
      ['Not this page', close],
      ['Cancel upload', () => { GM_setValue(PENDING, ''); close(); }],
    ]);
  }

  const m = location.hash.match(/mesa=([^&]+)/);
  if (location.pathname.indexOf(FORM_PATH) === 0) {
    if (m) startUpload(decodeURIComponent(m[1]));
    return;
  }
  let pending = null;
  try { pending = JSON.parse(GM_getValue(PENDING, '') || 'null'); } catch { pending = null; }
  // saved activities: /activity/<name>-<number> (Drupal may also show /node/<number>)
  if (pending && Date.now() - pending.at < 3 * 3600e3 && /^\/(activity\/[a-z0-9-]+|node\/\d+)\/?$/i.test(location.pathname)) offerLink(pending);
})();
