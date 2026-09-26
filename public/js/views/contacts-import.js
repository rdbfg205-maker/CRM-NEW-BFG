'use strict';
// Import contacts (Excel/CSV) for ONE customer — parse → mapping → validate
// (dups + explicit policy) → commit. Real DB writes via /api/contacts/import/*.
import { api, t, faDigits } from '../core.js';
import { el, clear, toast, openModal, confirmDialog } from '../ui.js';
import { customerSelect } from '../customer-select.js';

export function contactsImportButton(onDone) {
  const b = el('button', { class: 'btn', title: 'Import مخاطبین یک مشتری از فایل Excel/CSV با نگاشت ستون و مدیریت تکراری' }, '⬆ Import از Excel');
  b.addEventListener('click', () => contactsImportWizard(onDone));
  return b;
}

function contactsImportWizard(onDone) {
  const ov = openModal('Import مخاطبین از Excel/CSV', el('div', {}, el('div', { class: 'skel', style: 'height:100px' })), {
    large: true,
    footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('close')),
      el('button', { class: 'btn primary', id: 'ci-next' }, 'بعدی'),
    ],
  });
  const body = ov.body;
  const footBtn = ov.modal.querySelector('#ci-next');
  let step = 1, parsed = null, mapping = [], validated = null, dupPolicy = 'skip';
  const custCtl = customerSelect({ placeholder: 'مشتری مقصد را انتخاب کنید *' });

  function renderStep1() {
    clear(body);
    body.append(el('div', { class: 'alert info mb-10' }, 'فرمت‌های پشتیبانی‌شده: XLS، XLSX، CSV و… — سطر اول فایل عنوان ستون‌ها باشد. مخاطبین به یک مشتری مشخص اضافه می‌شوند.'));
    body.append(el('div', { class: 'field' }, el('label', {}, 'مشتری مقصد *'), custCtl));
    const input = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.json,.xml,.txt' });
    body.append(el('div', { class: 'field' }, el('label', {}, 'فایل'), input));
    renderStep1._input = input;
  }
  async function doUpload() {
    const input = body.querySelector('input[type=file]');
    if (!custCtl.value) return toast('مشتری مقصد را انتخاب کنید', 'err');
    if (!input || !input.files.length) return toast('فایل را انتخاب کنید', 'err');
    footBtn.disabled = true;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      parsed = await api.upload('/api/contacts/import/parse?customer_id=' + custCtl.value, fd);
      mapping = (parsed.suggested || []).map(x => ({ col: x.col, key: x.key }));
      (parsed.header || []).forEach((h, i) => { if (!mapping.some(m => m.col === i)) mapping.push({ col: i, key: null }); });
      step = 2; render();
    } catch (e) { toast(e.message, 'err'); footBtn.disabled = false; }
  }
  function renderStep2() {
    clear(body);
    body.append(el('div', { class: 'alert info mb-10' },
      'مشتری مقصد: <b>' + (parsed.customer && parsed.customer.name || '—') + '</b> — فرمت: ' + parsed.format + ' — تعداد رکوردهای فایل: ' + faDigits(parsed.fileRowCount) +
      '. برای هر ستون، فیلد مقصد را انتخاب کنید (ستون بدون فیلد نادیده گرفته می‌شود).'));
    const table = el('table', { class: 'tbl' });
    table.append(el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'ستون فایل'), el('th', {}, 'نمونه'), el('th', {}, '→ فیلد CRM'))));
    const tbody = el('tbody');
    mapping.forEach((m, i) => {
      const sel = el('select', {}, el('option', { value: '' }, '— نادیده بگیر —'));
      (parsed.fields || []).forEach(f => sel.append(el('option', { value: f.key }, f.label)));
      sel.value = m.key || '';
      sel.addEventListener('change', () => { mapping.forEach(o => { if (o !== m && o.key === sel.value) o.key = null; }); m.key = sel.value || null; });
      let sample = '';
      for (const r of (parsed.samples || [])) { const v = r[m.col]; if (v !== '' && v !== null && v !== undefined) { sample = String(v).slice(0, 40); break; } }
      tbody.append(el('tr', {}, el('td', { class: 'num' }, faDigits(i + 1)), el('td', {}, parsed.header[m.col] || ('ستون ' + faDigits(i + 1))), el('td', { class: 'muted small' }, sample || '—'), el('td', {}, sel)));
    });
    table.append(tbody);
    body.append(el('div', { class: 'tbl-wrap', style: 'max-height:340px; overflow:auto' }, table));
  }
  async function doValidate() {
    footBtn.disabled = true;
    try {
      validated = await api.post('/api/contacts/import/validate', { tempId: parsed.tempId, mapping });
      step = 3; render();
    } catch (e) { toast(e.message, 'err'); footBtn.disabled = false; }
  }
  function renderStep3() {
    clear(body);
    const v = validated || { validCount: 0, dupCount: 0, errorCount: 0, errors: [], preview: [], dupRows: [] };
    body.append(el('div', { class: 'alert ' + (v.errorCount ? 'warn' : 'info') },
      'معتبر: ' + faDigits(v.validCount) + ' — تکراری برای این مشتری: ' + faDigits(v.dupCount || 0) + ' — خطادار: ' + faDigits(v.errorCount || 0)));
    if (v.dupCount > 0) {
      const polBox = el('div', { class: 'card mb-10', style: 'padding:12px' });
      polBox.append(el('b', { class: 'small' }, 'نحوهٔ مدیریت رکوردهای تکراری:'));
      const polSel = el('select', {},
        el('option', { value: 'skip' }, 'رد تکراری‌ها (بدون تغییر داده فعلی)'),
        el('option', { value: 'update' }, 'به‌روزرسانی مخاطب موجود (فقط ستون‌های نگاشت‌شده)'),
        el('option', { value: 'new' }, 'ثبت به‌عنوان مخاطب جدید (تکراری جدید)'));
      polSel.value = dupPolicy;
      polSel.addEventListener('change', () => { dupPolicy = polSel.value; });
      polBox.append(polSel);
      if (v.dupRows && v.dupRows.length) {
        const dt = el('table', { class: 'tbl small' });
        dt.append(el('thead', {}, el('tr', {}, el('th', {}, 'ردیف فایل'), el('th', {}, 'مخاطب موجود'), el('th', {}, 'فیلد تکراری'))));
        dt.append(el('tbody', {}, v.dupRows.slice(0, 20).map(d => el('tr', {}, el('td', { class: 'num' }, faDigits(d.row)), el('td', {}, d.name || ('#' + d.id)), el('td', {}, d.field)))));
        polBox.append(el('div', { class: 'tbl-wrap', style: 'max-height:130px; overflow:auto; margin-top:8px' }, dt));
      }
      body.append(polBox);
    }
    if (v.errors && v.errors.length) body.append(el('div', { class: 'alert danger small', style: 'max-height:120px; overflow:auto' },
      el('b', {}, 'خطاها:'), ...v.errors.slice(0, 25).map(e => el('div', {}, 'ردیف ' + faDigits(e.row) + ': ' + e.errors.join('، ')))));
    if (v.preview && v.preview.length) {
      const keys = Object.keys(v.preview[0]);
      const table = el('table', { class: 'tbl small' });
      table.append(el('thead', {}, el('tr', {}, keys.map(k => el('th', {}, k)))));
      table.append(el('tbody', {}, v.preview.map(row => el('tr', {}, keys.map(k => el('td', {}, row[k] === null || row[k] === undefined ? '' : String(row[k]).slice(0, 40)))))));
      body.append(el('div', { class: 'tbl-wrap', style: 'max-height:200px; overflow:auto; margin-top:10px' }, table));
    }
  }
  function render() {
    footBtn.textContent = step === 1 ? 'آپلود فایل و ادامه' : step === 2 ? 'اعتبارسنجی و پیش‌نمایش' : '✓ تأیید و ثبت نهایی';
    footBtn.disabled = false;
    if (step === 1) renderStep1(); else if (step === 2) renderStep2(); else renderStep3();
  }
  footBtn.addEventListener('click', () => {
    if (step === 1) doUpload();
    else if (step === 2) doValidate();
    else {
      if (!validated || !validated.validCount) return toast('ردیف معتبری برای ثبت وجود ندارد', 'err');
      const dupNote = validated.dupCount > 0 ? (dupPolicy === 'skip' ? ' — ' + faDigits(validated.dupCount) + ' تکراری رد می‌شوند' : dupPolicy === 'update' ? ' — ' + faDigits(validated.dupCount) + ' مخاطب موجود بروزرسانی می‌شوند' : ' — برای ' + faDigits(validated.dupCount) + ' تکراری، مخاطب جدید ساخته می‌شود') : '';
      confirmDialog('ثبت نهایی', faDigits(validated.validCount) + ' مخاطب برای «' + (parsed.customer && parsed.customer.name || '') + '» ثبت خواهد شد' + dupNote + '. ادامه می‌دهید؟', 'ثبت').then((yes) => {
        if (!yes) return;
        footBtn.disabled = true;
        api.post('/api/contacts/import/commit', { tempId: parsed.tempId, mapping, dupPolicy }).then((r2) => {
          toast('ثبت شد: ' + faDigits(r2.ok) + ' جدید' + (r2.updated ? ' — بروزرسانی: ' + faDigits(r2.updated) : '') + (r2.unchanged ? ' — بدون تغییر: ' + faDigits(r2.unchanged) : '') + ' — رد: ' + faDigits(r2.dup) + ' — خطا: ' + faDigits(r2.fail), 'ok');
          ov.close();
          if (onDone) onDone();
        }).catch((e) => { toast(e.message, 'err'); footBtn.disabled = false; });
      });
    }
  });
  render();
  return ov;
}
