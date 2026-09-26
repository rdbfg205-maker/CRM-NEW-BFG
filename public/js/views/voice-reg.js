'use strict';
// 🎙 Voice Registration — real UI + real DB record. Works for CUSTOMER and CONTACT.
// STT runs in the browser via Web Speech API (fa-IR). If the browser does NOT
// support it, we say so clearly and fall back to typed transcript — never fake.
// Customer mode  → POST /api/r/customer          (Source = Voice Assistant)
// Contact mode   → POST /api/customers/:id/contacts (Source = Voice Assistant)
import { api, t, faDigits } from '../core.js';
import { el, clear, toast, openModal } from '../ui.js';
import { PROVINCES, wireGeoCascade } from '../geo.js';
import { customerSelect } from '../customer-select.js';
import { bindDatePick } from '../datepick.js';

const SR = () => (window.SpeechRecognition || window.webkitSpeechRecognition || null);

export function voiceRegisterButton(opts = {}) {
  // Caller wires its own click handler (e.g. to refresh the list after save).
  const label = opts && opts.mode === 'contact' ? '🎙 ثبت سریع مخاطب با صدا' : '🎙 ثبت سریع مشتری با صدا';
  return el('button', { class: 'btn', title: 'ثبت سریع با صحبت کردن — گفتار به متن (fa-IR) و سپس ثبت واقعی در CRM' }, label);
}

export function openVoiceRegister(onSaved, opts = {}) {
  const mode = opts.mode === 'contact' ? 'contact' : 'customer';
  const support = !!SR();
  const title = mode === 'contact' ? '🎙 ثبت سریع مخاطب با صدا' : '🎙 ثبت سریع مشتری با صدا';
  const ov = openModal(title, null, { large: true, footer: [] });
  const body = el('div', {});
  ov.body.append(body);

  // ---------- stage 1: capture ----------
  const transcript = el('textarea', { placeholder: 'متن گفتار اینجا نمایش داده می‌شود…', style: 'min-height:90px' });
  let rec = null, recording = false;
  const recBtn = el('button', { class: 'btn primary' }, '🎙 شروع ضبط');
  const parseBtn = el('button', { class: 'btn' }, '۲) استخراج اطلاعات');
  parseBtn.disabled = true;

  if (!support) {
    body.append(el('div', { class: 'alert warn small' },
      'مرورگر شما Web Speech API را پشتیبانی نمی‌کند — امکان ضبط صوتی وجود ندارد. می‌توانید متن گفتار را در کادر زیر تایپ کنید تا اطلاعات همان‌گونه استخراج و ثبت واقعی شود. (برای ضبط صوتی از Chrome/Edge استفاده کنید.)'));
    transcript.placeholder = 'متن گفتار را اینجا تایپ کنید…';
  } else {
    body.append(el('div', { class: 'alert info small' },
      '۱) روی «شروع ضبط» بزنید و صحبت کنید، مثلاً: «نام من محمدرضا دهفولی هست، شماره تماس ۰۹۱۲…، سمت من مدیر خرید است، در صنعت اسفنج فعالیت می‌کنیم». ۲) پس از توقف، «استخراج اطلاعات» را بزنید.'));
    recBtn.addEventListener('click', () => {
      if (recording) { rec && rec.stop(); return; }
      try {
        const C = SR();
        rec = new C();
        rec.lang = 'fa-IR';
        rec.continuous = true;
        rec.interimResults = true;
        let finalText = '';
        rec.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += r[0].transcript + ' ';
            else interim += r[0].transcript;
          }
          transcript.value = (finalText + interim).trim();
          if (transcript.value.trim()) parseBtn.disabled = false;
        };
        rec.onerror = (e) => { toast('خطای شناسایی گفتار: ' + (e.error || 'ناشناخته') + ' — دوباره تلاش کنید یا متن را تایپ کنید.', 'err'); };
        rec.onend = () => { recording = false; recBtn.textContent = '🎙 شروع ضبط'; };
        rec.start();
        recording = true;
        recBtn.textContent = '⏹ توقف ضبط';
      } catch (e) {
        toast('شروع شناسایی گفتار ممکن نشد: ' + (e.message || e) + ' — متن را تایپ کنید.', 'err');
      }
    });
  }
  transcript.addEventListener('input', () => { parseBtn.disabled = !transcript.value.trim(); });

  body.append(
    el('div', { class: 'mb-10' }, transcript),
    el('div', { class: 'flex', style: 'gap:8px' }, recBtn, parseBtn,
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel'))));

  // ---------- stage 2: extracted (editable) fields ----------
  const f = {};
  const grid = el('div', { class: 'form-grid' });
  const mkInput = (k) => { const i = el('input', { dir: k === 'mobile' || k === 'phone' || k === 'email' ? 'ltr' : 'auto' }); f[k] = i; return i; };
  const LBL = { name: 'نام / عنوان *', company: 'شرکت', mobile: 'موبایل', phone: 'تلفن', position: 'سمت', industry: 'صنعت', province: 'استان', city: 'شهر', industrial_city: 'شهرک صنعتی', notes: 'توضیحات', email: 'ایمیل' };

  if (mode === 'contact') {
    // parent customer (real master data) — required for a contact
    const custCtl = customerSelect({ value: opts.presetCustomer || null });
    if (opts.presetCustomer) { try { custCtl.customerSelect && custCtl.customerSelect.setValue(Number(opts.presetCustomer)); } catch {} }
    f.customer = custCtl;
    grid.append(el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'مشتری (Master Data) *'), custCtl));
    ['name', 'position', 'mobile', 'phone', 'email'].forEach(k => grid.append(el('div', { class: 'field' }, el('label', {}, LBL[k] || k), mkInput(k))));
  } else {
    ['name', 'company', 'mobile', 'phone', 'position', 'industry'].forEach(k => grid.append(el('div', { class: 'field' }, el('label', {}, LBL[k] || k), mkInput(k))));
    f.province = el('select', {}, el('option', { value: '' }, '— انتخاب استان —'), PROVINCES.map(p => el('option', { value: p }, p)));
    grid.append(el('div', { class: 'field' }, el('label', {}, 'استان'), f.province));
    ['city', 'industrial_city'].forEach(k => grid.append(el('div', { class: 'field' }, el('label', {}, LBL[k] || k), mkInput(k))));
  }
  f.notes = el('textarea', { placeholder: 'توضیحات (متن کامل گفتار)' });
  grid.append(el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, LBL.notes), f.notes));
  f.status = el('select', {}, el('option', { value: 'active' }, 'فعال (اطلاعات کامل)'), el('option', { value: 'lead' }, 'اولیه — در انتظار تکمیل'));
  if (mode === 'customer') grid.append(el('div', { class: 'field' }, el('label', {}, 'وضعیت ثبت'), f.status));

  const fieldsBox = el('div', { class: 'card', style: 'margin-top:14px; display:none' }, grid);
  const saveBtn = el('button', { class: 'btn primary' }, '✓ ثبت نهایی در CRM');
  const warnBox = el('div', { class: 'alert warn small', style: 'display:none; margin-top:10px' });
  fieldsBox.append(el('div', { style: 'padding:0 16px 14px; display:flex; gap:8px; align-items:center' }, saveBtn, warnBox));
  body.append(fieldsBox);

  const geo = { provinceSel: f.province, cityIn: f.city, indCityIn: f.industrial_city, indWrap: f.industrial_city ? f.industrial_city.parentElement : null, attachTo: grid };
  let geoWired = false;
  function ensureGeo() {
    if (geoWired || mode !== 'customer') return; geoWired = true;
    const canInd = !!(window.__me().permissions && window.__me().permissions.industrial_city && window.__me().permissions.industrial_city.create);
    wireGeoCascade(geo, { canCreate: canInd });
  }

  parseBtn.addEventListener('click', async () => {
    const text = transcript.value.trim();
    if (!text) return toast('متنی برای استخراج وجود ندارد', 'err');
    parseBtn.disabled = true;
    try {
      const r = await api.post('/api/voice/parse', { text });
      // fill only the fields this mode has
      const map = { name: 'name', company: 'company', mobile: 'mobile', phone: 'phone', position: 'position', industry: 'industry', province: 'province', city: 'city', industrial_city: 'industrial_city', email: 'email' };
      for (const k of Object.keys(map)) if (f[k]) f[k].value = r[map[k]] || '';
      f.notes.value = r.notes || text;
      if (mode === 'customer') {
        f.status.value = r.complete ? 'active' : 'lead';
        const missing = [!r.name && !r.company ? 'نام/شرکت' : null, !r.mobile && !r.phone ? 'شماره تماس' : null].filter(Boolean);
        if (missing.length) { warnBox.style.display = ''; warnBox.textContent = 'اطلاعات ناقص: ' + missing.join('، ') + ' — رکورد با وضعیت «اولیه (در انتظار تکمیل)» ثبت می‌شود و بعداً قابل تکمیل است.'; }
        else warnBox.style.display = 'none';
      }
      fieldsBox.style.display = '';
      ensureGeo();
      toast('اطلاعات استخراج شد — قبل از ثبت، مقادیر را بررسی و در صورت نیاز اصلاح کنید.', 'ok');
    } catch (e) { toast(e.message, 'err'); parseBtn.disabled = !transcript.value.trim(); }
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      let id;
      if (mode === 'contact') {
        const custId = f.customer.value;
        if (!custId) return toast('مشتری را انتخاب کنید (مخاطب بدون مشتری ثبت نمی‌شود)', 'err');
        const name = f.name.value.trim();
        if (!name) return toast('نام مخاطب الزامی است (هیچ اطلاعات قابل‌ثبتی استخراج نشده)', 'err');
        const payload = {
          name, position: f.position.value.trim(),
          phone: f.phone.value.trim(), mobile: f.mobile.value.trim(), email: f.email.value.trim(),
          notes: (f.notes.value ? 'گفتار: ' + f.notes.value + '\n' : '') + 'ثبت از طریق «ثبت سریع مخاطب با صدا»',
          source: 'Voice Assistant', status: 'active',
        };
        const r = await api.post('/api/customers/' + custId + '/contacts', payload);
        id = r.id || (r.item && r.item.id);
        toast('مخاطب واقعاً ثبت شد (Source: Voice Assistant)', 'ok');
      } else {
        const name = f.name.value.trim() || f.company.value.trim();
        if (!name) return toast('نام یا شرکت الزامی است (هیچ اطلاعات قابل‌ثبتی استخراج نشده)', 'err');
        const IND_OPTS = ['فوم و اسفنج', 'تولید تشک', 'بسته‌بندی', 'مبلمان', 'بهداشتی', 'صنایع شیمیایی', 'تأمین‌کننده', 'صادرات', 'سایر'];
        const rawInd = f.industry.value.trim();
        let industry = null;
        if (rawInd) {
          industry = IND_OPTS.includes(rawInd) ? rawInd : (IND_OPTS.find(o => o.includes(rawInd)) || IND_OPTS.find(o => rawInd.includes(o.split(' و ')[0])) || null);
        }
        const payload = {
          name,
          type: f.company.value.trim() ? 'company' : 'person',
          mobile: f.mobile.value.trim() || null,
          phone: f.phone.value.trim() || null,
          industry,
          province: f.province.value || null,
          city: f.city.value.trim() || null,
          industrial_city: f.industrial_city.value.trim() || null,
          source: 'Voice Assistant',
          status: f.status.value,
          notes: (f.notes.value ? 'گفتار: ' + f.notes.value + '\n' : '') + 'ثبت از طریق «ثبت سریع مشتری با صدا»',
        };
        if (f.position.value.trim()) payload.notes = payload.notes + ' — سمت: ' + f.position.value.trim();
        if (rawInd && industry && industry !== rawInd) payload.notes = payload.notes + ' — صنعت گفتاری: ' + rawInd;
        if (rawInd && !industry) payload.notes = payload.notes + ' — صنعت (خارج از فهرست): ' + rawInd;
        const r = await api.post('/api/r/customer', payload);
        id = r.id || (r.item && r.item.id);
        toast('مشتری واقعاً ثبت شد' + (payload.status === 'lead' ? ' (اولیه — قابل تکمیل بعداً)' : ''), 'ok');
      }
      ov.close();
      if (onSaved) onSaved(id);
    } catch (e) {
      toast('ثبت نشد: ' + e.message, 'err');
      saveBtn.disabled = false;
    }
  });
  return ov;
}
