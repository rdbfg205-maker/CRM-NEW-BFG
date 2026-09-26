'use strict';
// ============ Central Export/Print Service (frontend) ============
// One standard component for ALL modules:
//   - quick menu: 🖨 چاپ (with/without header) · 📊 Excel
//   - "تنظیمات خروجی" modal: type (چاپ/PDF | Excel) × template (سربرگ رسمی | بدون سربرگ)
//     × scope (رکورد فعلی | رکوردهای انتخاب‌شده | همهٔ فیلترشده) → generate
// All URLs point at the central backend service (/api/print/*, /api/r/:res/export).
import { el, openModal } from './ui.js';
import { faDigits } from './core.js';

function buildUrl(base, params = {}) {
  const u = new URL(base, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}
function currentFilterParams() {
  // collect the active list filters (q + f_*) from the current URL hash
  const q = new URLSearchParams((location.hash || '').split('?')[1] || '');
  const out = {};
  for (const [k, v] of q.entries()) if (k === 'q' || k.startsWith('f_')) out[k] = v;
  return out;
}
// resolve the active filters: explicit (from the view's own state) win, else URL hash
function resolveFilters(getFilters) {
  if (typeof getFilters === 'function') {
    const f = getFilters() || {};
    const out = {};
    if (f.q) out.q = f.q;
    for (const [k, v] of Object.entries(f.filters || {})) out['f_' + k] = v;
    return out;
  }
  return currentFilterParams();
}
// open the standard "تنظیمات خروجی" modal
export function openExportSettings(opts = {}) {
  const { entity, recordId = null, selectedIds = [], title = 'خروجی', hasRecord = false } = opts;
  const filters = resolveFilters(opts.getFilters);
  const hasFilters = Object.keys(filters).length > 0;
  const hasSelected = selectedIds.length > 0;
  const typeSel = el('select', {},
    el('option', { value: 'print' }, '🖨 چاپ / PDF (از طریق Print Preview)'),
    el('option', { value: 'excel' }, '📊 Excel (XLSX واقعی)'));
  const headerSel = el('select', {},
    el('option', { value: '1' }, 'با سربرگ رسمی شرکت'),
    el('option', { value: '0' }, 'بدون سربرگ رسمی'));
  const scopeSel = el('select', {});
  if (hasRecord && recordId) scopeSel.append(el('option', { value: 'record' }, 'رکورد فعلی'));
  if (hasSelected) scopeSel.append(el('option', { value: 'selected' }, 'رکوردهای انتخاب‌شده (' + faDigits(selectedIds.length) + ')'));
  scopeSel.append(el('option', { value: hasFilters ? 'filtered' : 'all' }, hasFilters ? 'همهٔ رکوردهای فیلترشده' : 'همهٔ رکوردها'));
  function syncHeader() { if (headerSel.parentElement) headerSel.parentElement.style.display = typeSel.value === 'print' ? '' : 'none'; }
  typeSel.addEventListener('change', syncHeader);
  const ov = openModal('تنظیمات خروجی' + (title ? ' — ' + title : ''), el('div', { class: 'form-grid' },
    el('div', { class: 'field' }, el('label', {}, 'نوع خروجی'), typeSel),
    el('div', { class: 'field', id: 'exp-header-field' }, el('label', {}, 'قالب'), headerSel),
    el('div', { class: 'field' }, el('label', {}, 'محدوده'), scopeSel)), {
    footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: () => {
        const type = typeSel.value, scope = scopeSel.value, header = headerSel.value;
        const url = buildUrl(urlFor(type, scope, header));
        window.open(url, '_blank', 'noopener');
        ov.close();
      } }, 'تولید خروجی'),
    ],
  });
  function urlFor(type, scope, header) {
    if (type === 'excel') {
      const p = { ...filters, format: 'xlsx' };
      if (scope === 'record' && recordId) p.ids = String(recordId);
      else if (scope === 'selected' && hasSelected) p.ids = selectedIds.join(',');
      return buildUrl('/api/r/' + entity + '/export', p);
    }
    // print / pdf
    if (scope === 'record' && recordId) return buildUrl('/api/print/record/' + entity + '/' + recordId, { header, autoprint: '1' });
    const p = { ...filters, header, autoprint: '1' };
    return buildUrl('/api/print/list/' + entity, p);
  }
  syncHeader(); // normalize initial state now that the modal is in the DOM
  return ov;
}
// unified "خروجی" button for list views (quick actions + full settings)
export function exportCenterBtn(entity, { title = '', getSelected = null, getFilters = null } = {}) {
  const wrap = el('div', { style: 'position:relative; display:inline-block' });
  const btn = el('button', { class: 'btn', title: 'چاپ / PDF / Excel — با سربرگ رسمی یا بدون سربرگ' }, '⬇ خروجی ▾');
  const menu = el('div', { style: 'display:none; position:absolute; top:100%; inset-inline-end:0; z-index:60; background:var(--bg,#fff); border:1px solid var(--border); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.15); min-width:240px; padding:4px; text-align:right' });
  const item = (label, fn, hint) => {
    const b = el('button', { class: 'btn sm', style: 'display:block; width:100%; text-align:right' }, label);
    if (hint) b.append(el('span', { class: 'muted small', style: 'float:left' }, hint));
    b.addEventListener('click', () => { menu.style.display = 'none'; fn(); });
    menu.append(b);
    return b;
  };
  const filters = () => resolveFilters(getFilters);
  item('🖨 چاپ — با سربرگ رسمی', () => window.open(buildUrl('/api/print/list/' + entity, { ...filters(), header: '1', autoprint: '1' }), '_blank', 'noopener'));
  item('🖨 چاپ — بدون سربرگ', () => window.open(buildUrl('/api/print/list/' + entity, { ...filters(), header: '0', autoprint: '1' }), '_blank', 'noopener'));
  item('📊 Excel — دادهٔ فیلترشده', () => { window.open(buildUrl('/api/r/' + entity + '/export', { ...filters(), format: 'xlsx' }), '_blank', 'noopener'); });
  item('⚙ تنظیمات خروجی…', () => {
    const sel = getSelected ? getSelected() : [];
    openExportSettings({ entity, selectedIds: sel, title, getFilters });
  });
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
  document.addEventListener('click', () => { menu.style.display = 'none'; });
  wrap.append(btn, menu);
  return wrap;
}
// unified print/export button for a RECORD detail
export function recordExportBtn(entity, record, { title = '' } = {}) {
  const wrap = el('div', { style: 'position:relative; display:inline-block' });
  const btn = el('button', { class: 'btn sm', title: 'چاپ / PDF / Excel برای این رکورد' }, '🖨 خروجی ▾');
  const menu = el('div', { style: 'display:none; position:absolute; top:100%; inset-inline-end:0; z-index:60; background:var(--bg,#fff); border:1px solid var(--border); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.15); min-width:220px; padding:4px; text-align:right' });
  const item = (label, fn) => {
    const b = el('button', { class: 'btn sm', style: 'display:block; width:100%; text-align:right' }, label);
    b.addEventListener('click', () => { menu.style.display = 'none'; fn(); });
    menu.append(b);
    return b;
  };
  const id = record && (record.id);
  if (id) {
    item('🖨 چاپ / PDF — با سربرگ رسمی', () => window.open(buildUrl('/api/print/record/' + entity + '/' + id, { header: '1', autoprint: '1' }), '_blank', 'noopener'));
    item('🖨 چاپ / PDF — بدون سربرگ', () => window.open(buildUrl('/api/print/record/' + entity + '/' + id, { header: '0', autoprint: '1' }), '_blank', 'noopener'));
    item('📊 Excel — این رکورد', () => window.open(buildUrl('/api/r/' + entity + '/export', { ids: String(id), format: 'xlsx' }), '_blank', 'noopener'));
  }
  item('⚙ تنظیمات خروجی…', () => openExportSettings({ entity, recordId: id, hasRecord: true, title: title || (record && (record.number || record.name || record.title) || '') }));
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
  document.addEventListener('click', () => { menu.style.display = 'none'; });
  wrap.append(btn, menu);
  return wrap;
}
