'use strict';
import { api, t, fmtNum, fmtMoney, fmtDate, statusFa, faDigits } from './core.js';
import { el, clear, toast, openModal, confirmDialog, tabs, emptyState, skeletonRows, fileInput } from './ui.js';
import { customerSelect } from './customer-select.js';
import { productSelect } from './product-select.js';
import { bindDatePick } from './datepick.js';
import { helpBtn } from './views/help.js';
import { exportCenterBtn, recordExportBtn } from './export-center.js';
import { wireGeoCascade } from './geo.js';

const ICONS = {
  eye: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  copy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  arch: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>',
  plus: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  dl: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
};
export function iconBtn(ic, title, onclick, cls = '') {
  return el('button', { class: 'icon-btn ' + cls, title, html: ICONS[ic] || '', onclick });
}

// ---------- field rendering helpers ----------
export function fieldControl(f, value, meta, onChange) {
  let n;
  if (f.type === 'select') {
    n = el('select', {});
    n.append(el('option', { value: '' }, '—'));
    const opts = (meta.options && meta.options[f.options]) || (typeof f.options === 'string' ? meta.options[f.options] : f.options) || [];
    for (const o of opts) {
      const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : o;
      n.append(el('option', { value: v, selected: String(v) === String(value || '') }, l));
    }
  } else if (f.type === 'ref' && f.ref === 'customer') {
    n = customerSelect({ value, onChange: (id) => onChange && onChange(id ? String(id) : '') });
  } else if (f.type === 'ref' && (f.ref === 'product' || f.ref === 'products')) {
    n = productSelect({ value, onChange: (id) => onChange && onChange(id ? String(id) : '') });
  } else if (f.type === 'ref') {
    n = el('select', {});
    n.append(el('option', { value: '' }, '—'));
    loadRefOptions(n, f.ref, value);
  } else if (f.type === 'textarea') {
    n = el('textarea', { value: value || '' });
  } else if (f.type === 'date' || f.type === 'datetime') {
    // Jalali date (+time for datetime) via picker — no free-text date entry
    n = el('input', { placeholder: f.type === 'date' ? 'انتخاب تاریخ از تقویم…' : 'انتخاب تاریخ و ساعت از تقویم…', style: 'cursor:pointer' });
    n._dp = bindDatePick(n, { withTime: f.type === 'datetime' });
    if (value) n._dp.set(value);
  } else if (f.type === 'json') {
    n = el('textarea', { value: value ? JSON.stringify(value, null, 2) : '', placeholder: '{}', style: 'direction:ltr; text-align:left; font-family:monospace; font-size:12px' });
  } else if (f.type === 'bool') {
    n = el('select', {});
    n.append(el('option', { value: '1', selected: value ? '' : null }, 'بله'));
    n.append(el('option', { value: '0', selected: !value ? '' : null }, 'خیر'));
  } else {
    n = el('input', { type: f.type === 'number' || f.type === 'money' ? 'text' : 'text', value: value ?? '', placeholder: f.label });
    if (f.type === 'number' || f.type === 'money') n.dir = 'ltr';
  }
  if (onChange) n.addEventListener('change', () => onChange(n.value));
  return n;
}
function jalaliStr(iso) {
  const d = new Date(iso);
  const j = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0');
}
function jalaliDateTimeStr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const j = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
export function parseJalaaliInput(v) {
  // accepts شmsi: 1405/06/05 [14:30] | ISO: 2026-08-27[T12:00:00]
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const year = Number(m[1]);
    if (year >= 1200 && year < 2000) {
      const g = jalaliLib().toGregorian(year, Number(m[2]), Number(m[3]));
      const d = new Date(g.gy, g.gm - 1, g.gd, Number(m[4] || 12), Number(m[5] || 0), Number(m[6] || 0));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + 'T12:00:00'); return isNaN(d.getTime()) ? null : d.toISOString(); }
  return null;
}
// refs in the registry may use the table name (customers) while the route key is singular (customer).
// Resolve once against the meta registry so every selector reads from the SAME master data.
let _keyByRef = null;
export async function resolveResourceKey(ref) {
  if (ref === 'users') return 'users';
  if (!_keyByRef) {
    const meta = await window.__meta();
    _keyByRef = new Map();
    for (const [k, r] of Object.entries(meta.resources || {})) {
      _keyByRef.set(k, k);
      if (r.table) _keyByRef.set(r.table, k);
    }
  }
  return _keyByRef.get(ref) || null;
}
export async function loadRefOptions(sel, ref, value) {
  try {
    let items;
    if (ref === 'users') {
      try { items = (await api.get('/api/admin/users?per_page=200')).items; }
      catch { items = []; }
      if (!items.length) items = (await api.get('/api/r/user?per_page=200').catch(() => ({ items: [] }))).items;
    } else {
      const key = await resolveResourceKey(ref);
      if (!key) throw new Error('unknown ref resource: ' + ref);
      items = (await api.get(`/api/r/${key}?per_page=200`)).items;
    }
    for (const it of items) {
      const label = it.full_name || it.name || it.title || it.number || String(it.id);
      sel.append(el('option', { value: it.id, selected: Number(it.id) === Number(value) ? '' : null }, label));
    }
  } catch (e) {
    console.error('loadRefOptions failed for ref ' + ref + ':', e.message);
    sel.append(el('option', { value: '' }, '— خطا در بارگذاری فهرست —'));
  }
}
export function cellRender(f, row) {
  const v = row[f.key];
  if (v === null || v === undefined || v === '') return el('span', { class: 'muted' }, '—');
  if (f.type === 'money') return el('span', { class: 'money' }, fmtMoney(v));
  if (f.type === 'number') return el('span', { class: 'num' }, fmtNum(v));
  if (f.type === 'date' || f.type === 'datetime') return el('span', {}, fmtDate(v, { time: f.type === 'datetime' }));
  if (f.type === 'bool') return v ? 'بله' : 'خیر';
  if (f.key === 'status' || f.key === 'priority' || f.key === 'type' || f.key === 'source' || f.key === 'method' || f.key === 'category' || f.key === 'credit_status' || f.key === 'tax_system_status') {
    const fa = statusFa(v);
    const cls = /paid|active|won|pass|resolved|done|delivered|confirmed|accepted/.test(String(v)) ? 'green' : /overdue|lost|critical|failed|expired|blocked|rejected|fail/.test(String(v)) ? 'red' : /partial|waiting|in_progress|scheduled|pending|high|sent|shipped|sent/.test(String(v)) ? 'orange' : '';
    return el('span', { class: 'badge ' + cls }, fa);
  }
  if (f.type === 'ref') {
    const nm = row[f.key + '_name'];
    return nm ? el('span', {}, nm) : el('span', { class: 'muted' }, '—');
  }
  const s = String(v);
  return s.length > 42 ? el('span', { title: s }, s.slice(0, 42) + '…') : s;
}
async function fillPaymentInvoices(invCtrl, custId) {
  invCtrl.innerHTML = '';
  invCtrl.append(el('option', { value: '' }, '—'));
  try {
    const { items } = await api.get('/api/r/invoice?per_page=200');
    const list = (items || []).filter(i => (!custId || Number(i.customer_id) === custId) && ['unpaid', 'partial', 'overdue'].includes(i.status));
    for (const it of list) invCtrl.append(el('option', { value: it.id }, it.number + ' — ' + fmtMoney(it.total)));
  } catch (e) { console.error('fillPaymentInvoices:', e.message); }
}
// ---------- main view ----------
export class ResourceView {
  constructor({ res, title, quickAction = null, extraActions = [], detailActions = null, listQuery = {}, showArchived = false, extraColumns = [], hideColumns = [], emptyAction = null }) {
    this.res = res; // resource key
    this.title = title;
    this.quickAction = quickAction;
    this.extraActions = extraActions;
    this.detailActions = detailActions;
    this.listQuery = listQuery;
    this.showArchived = showArchived;
    this.extraColumns = extraColumns;
    this.hideColumns = hideColumns;
    this.emptyAction = emptyAction;
    this.page = 1;
    this.sort = null;
    this.filters = {};
    this.q = '';
    // initial filters from hash query (dashboard drill-down links: #/invoices?f_status=unpaid)
    const qi = (location.hash || '').indexOf('?');
    if (qi >= 0) {
      for (const [k, v] of new URLSearchParams((location.hash || '').slice(qi + 1))) {
        if (k.startsWith('f_') && v) this.filters[k.slice(2)] = v;
        else if (k === 'q' && v) this.q = v;
      }
    }
    this.spec = null;
    this.meta = null;
    this._selected = new Set(); // bulk-edit selection (persists across pages while view is alive)
    this.root = el('div');
    window.__lastView = this;
    this.mount();
  }
  // ---------- bulk edit (Section 4) ----------
  bulkEnabled() {
    const m = window.__me();
    const hasPerm = m && m.permissions && m.permissions.bulk_edit && !!m.permissions.bulk_edit.edit;
    const hasFields = !!(this.spec && this.spec.bulkFields && this.spec.bulkFields.length);
    return !!(hasPerm && hasFields);
  }
  bulkDeleteEnabled() {
    const m = window.__me();
    return !!(m && m.permissions && m.permissions.bulk_delete && !!m.permissions.bulk_delete.delete);
  }
  bulkEditBtn() {
    if (!this.bulkEnabled() && !this.bulkDeleteEnabled()) return null;
    const btn = el('button', { class: 'btn', title: 'ویرایش گروهی رکوردهای انتخاب‌شده', onclick: () => this.openBulkEdit() },
      '✎ ', el('b', {}, 'ویرایش گروهی'));
    this._bulkCount = el('span', { class: 'badge', style: 'display:none; margin-inline-start:6px' }, '۰');
    btn.append(this._bulkCount);
    return btn;
  }
  bulkDeleteBtn() {
    if (!this.bulkDeleteEnabled()) return null;
    return el('button', { class: 'btn danger', title: 'حذف گروهی رکوردهای انتخاب‌شده (با تأییدیه)', onclick: () => this.openBulkDelete() },
      '🗑 ', el('b', {}, 'حذف گروهی'));
  }
  syncSelectionUI() {
    if (!this._bulkCount) return;
    const n = this._selected.size;
    this._bulkCount.textContent = faDigits(n);
    this._bulkCount.style.display = n ? '' : 'none';
  }
  async mount() {
    this.root.append(el('div', { class: 'skel', style: 'height:420px; margin:20px' }));
    const meta = await window.__meta();
    this.meta = meta;
    this.spec = meta.resources[this.res];
    if (!this.spec) { this.root.append(emptyState('ماژول پیدا نشد')); return; }
    this.renderShell();
    this.load();
    // "سند جدید از صفحهٔ مشتری": open the form with the customer preselected
    const qi = (location.hash || '').indexOf('?');
    if (qi >= 0) {
      const q = new URLSearchParams((location.hash || '').slice(qi + 1));
      const nc = q.get('new_customer');
      if (nc && Number.isFinite(Number(nc))) {
        const hasCust = (this.spec.fields || []).some(f => f.key === 'customer_id' && f.type === 'ref' && f.ref === 'customer');
        if (hasCust) {
          q.delete('new_customer');
          const rest = q.toString();
          const path = (location.hash || '#/').slice(1).split('?')[0];
          try { history.replaceState(null, '', location.pathname + location.search + '#' + path + (rest ? '?' + rest : '')); } catch {}
          this.openForm(null, { customer_id: Number(nc) });
        }
      }
    }
  }
  renderShell() {
    clear(this.root);
    const head = el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, this.title), el('div', { class: 'sub' }, this.spec.nameEn || '')),
      el('div', { class: 'actions' },
        helpBtn(this.res),
        ...this.extraActions,
        this.quickAction ? el('button', { class: 'btn gold', onclick: () => this.openForm() }, '＋ ', this.quickAction || (t('new') + ' ' + this.spec.singularFa)) : null,
        exportCenterBtn(this.res, { title: this.title, getSelected: () => [...this._selected], getFilters: () => ({ q: this.q, filters: this.filters }) }),
        this.importBtn(),
        this.bulkEditBtn(),
        this.bulkDeleteBtn(),
      ),
    );
    this.toolbar = el('div', { class: 'card' },
      el('div', { class: 'toolbar' },
        el('div', { class: 'search grow' }, el('input', { placeholder: t('search'), value: this.q, oninput: (e) => { clearTimeout(this._t); this._t = setTimeout(() => { this.q = e.target.value; this.page = 1; this.load(); }, 350); } })),
        ...this.filterControls(),
        this.showArchived ? el('label', { class: 'small muted', style: 'display:flex; gap:6px; align-items:center' }, el('input', { type: 'checkbox', style: 'width:auto' }), 'نمایش آرشیو') : null,
      ),
      el('div', { class: 'tbl-wrap' }, this.tableBody = el('div')),
      this.pager = el('div', { class: 'pager' }),
    );
    this.root.append(head, this.toolbar);
  }
  importBtn() {
    return el('button', { class: 'btn', onclick: () => this.importFlow() }, '↑ ', t('import'));
  }
  filterControls() {
    const out = [];
    for (const f of this.spec.fields.filter(f => f.filter)) {
      if (f.type !== 'select') continue;
      const sel = el('select', { class: 'f' });
      sel.append(el('option', { value: '' }, f.label));
      const opts = this.meta.options[f.options] || [];
      for (const o of opts) sel.append(el('option', { value: typeof o === 'object' ? o.v : o }, typeof o === 'object' ? o.l : o));
      sel.addEventListener('change', () => { if (sel.value) this.filters[f.key] = sel.value; else delete this.filters[f.key]; this.page = 1; this.load(); });
      out.push(sel);
    }
    return out;
  }
  get columns() {
    const base = this.spec.fields.filter(f => f.list && !this.hideColumns.includes(f.key));
    const cols = base.slice(0, 7).map(f => ({ key: f.key, label: f.label, f }));
    for (const c of this.extraColumns) cols.push(c);
    return cols;
  }
  async load() {
    this.tableBody.append(skeletonRows(6));
    try {
      const p = new URLSearchParams({ per_page: '20', page: String(this.page), ...this.listQuery });
      if (this.q) p.set('q', this.q);
      for (const [k, v] of Object.entries(this.filters)) p.set('f_' + k, v);
      if (this.showArchived && this._showArch) p.set('q_archived', '1');
      if (this.sort) p.set('sort', this.sort);
      const data = await api.get(`/api/r/${this.res}?${p}`);
      clear(this.tableBody);
      if (!data.items.length) {
        this.tableBody.append(el('div', {}, emptyState(this.title + 'ی ثبت نشده است', this.emptyAction || (this.quickAction ? el('button', { class: 'btn gold', onclick: () => this.openForm() }, '＋ ثبت اولین ' + this.spec.singularFa) : null))));
        this.pager.innerHTML = '';
        return;
      }
      const cols = this.columns;
      const bulkOn = this.bulkEnabled() || this.bulkDeleteEnabled();
      let headCb = null;
      if (bulkOn) {
        headCb = el('input', { type: 'checkbox', style: 'width:auto', title: 'انتخاب همهٔ این صفحه', onchange: (e) => {
          const on = e.target.checked;
          for (const it of data.items) { if (on) this._selected.add(it.id); else this._selected.delete(it.id); }
          this.load();
        } });
      }
      const headRow = el('tr', {},
        bulkOn ? el('th', { style: 'width:36px' }, headCb) : null,
        ...cols.map(c => el('th', { onclick: () => { this.sort = c.key + (this.sort === c.key + ':asc' ? ':desc' : ':asc'); this.load(); } }, c.label + (this.sort === c.key + ':asc' ? ' ▲' : this.sort === c.key + ':desc' ? ' ▼' : ''))),
        el('th', {}, ''));
      const bodyRows = data.items.map(it => {
        let rowCb = null;
        if (bulkOn) {
          rowCb = el('input', { type: 'checkbox', style: 'width:auto', checked: this._selected.has(it.id) || null, title: 'انتخاب برای ویرایش گروهی', onchange: (e) => { e.stopPropagation(); if (e.target.checked) this._selected.add(it.id); else this._selected.delete(it.id); this.syncSelectionUI(); } });
        }
        return el('tr', { style: 'cursor:pointer', onclick: () => this.openDetail(it.id) },
          bulkOn ? el('td', { style: 'width:36px' }, rowCb) : null,
          ...cols.map(c => el('td', {}, c.render ? c.render(it) : cellRender(c.f || { key: c.key }, it))),
          el('td', { class: 'row-act' },
            iconBtn('eye', t('view'), (e) => { e.stopPropagation(); this.openDetail(it.id); }),
            this.can('edit') ? iconBtn('edit', t('edit'), (e) => { e.stopPropagation(); this.openForm(it.id); }) : null,
            this.can('create') ? iconBtn('copy', t('duplicate'), (e) => { e.stopPropagation(); this.duplicate(it.id); }) : null,
            this.can('delete') && it.archived_at !== undefined ? iconBtn('arch', it.archived_at ? t('restore') : t('archive'), (e) => { e.stopPropagation(); this.archive(it.id, it.archived_at); }) : null,
            this.can('delete') ? iconBtn('trash', t('delete'), (e) => { e.stopPropagation(); this.remove(it.id); }, 'danger') : null));
      });
      const table = el('table', { class: 'tbl' }, el('thead', {}, headRow), el('tbody', {}, bodyRows));
      this.tableBody.append(table);
      const pg = el('div', { class: 'pager' });
      this.pager.replaceWith(pg); this.pager = pg;
      const pages = data.pages || 1;
      pg.append(el('span', { class: 'info' }, `مجموع ${faDigits(data.total)} رکورد`), el('span', { class: 'grow' }));
      const mk = (label, page, dis, act = false) => el('button', { class: 'pg-btn' + (act ? ' active' : ''), disabled: dis ? '' : null, onclick: () => { this.page = page; this.load(); } }, label);
      pg.append(mk('قبلی', this.page - 1, this.page <= 1),
        ...Array.from({ length: Math.min(7, pages) }, (_, i) => {
          let pp = i + 1;
          if (pages > 7) { if (this.page <= 4) pp = i + 1; else if (this.page >= pages - 3) pp = pages - 6 + i; else pp = this.page - 3 + i; }
          return mk(faDigits(pp), pp, false, pp === this.page);
        }),
        mk('بعدی', this.page + 1, this.page >= pages));
      this.syncSelectionUI();
    } catch (e) {
      clear(this.tableBody).append(el('div', { class: 'alert danger' }, e.message));
    }
  }
  // ---------- bulk edit modal (Section 4) ----------
  openBulkEdit() {
    if (!this.bulkEnabled()) return;
    if (this._selected.size < 1) return toast('ابتدا رکوردی را تیک بزنید (انتخاب برای ویرایش گروهی).', 'err');
    const ids = [...this._selected];
    const fields = this.spec.bulkFields || [];
    const fieldSel = el('select', {});
    fieldSel.append(el('option', { value: '' }, '— انتخاب فیلد —'));
    for (const f of fields) fieldSel.append(el('option', { value: f.key }, f.label));
    const valueWrap = el('div', {});
    let valueCtrl = null;
    const rebuildValueCtrl = () => {
      clear(valueWrap);
      valueCtrl = null;
      const f = fields.find(x => x.key === fieldSel.value);
      if (!f) return;
      if (f.type === 'select') {
        valueCtrl = el('select', {});
        valueCtrl.append(el('option', { value: '' }, '— (خالی / پاک کردن) —'));
        const opts = (this.meta && this.meta.options && this.meta.options[f.options]) || (Array.isArray(f.options) ? f.options : []);
        for (const o of opts) { const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : o; valueCtrl.append(el('option', { value: v }, l)); }
      } else if (f.type === 'textarea') {
        valueCtrl = el('textarea', { placeholder: f.label, style: 'width:100%' });
      } else {
        valueCtrl = el('input', { type: 'text', placeholder: f.label, style: 'width:100%', dir: f.type === 'number' ? 'ltr' : 'auto' });
      }
      valueWrap.append(valueCtrl);
    };
    const previewBox = el('div');
    let lastPreview = null;
    const fmtV = (v) => (v === null || v === undefined || v === '') ? '—' : String(v);
    const renderPreview = (pv) => {
      clear(previewBox);
      previewBox.append(el('div', { class: 'alert info small mb-10' },
        `انتخاب‌شده: ${faDigits(pv.total_selected)} رکورد — تغییر خواهد کرد: ${faDigits(pv.will_change)} — بدون تغییر: ${faDigits(pv.no_change)}`));
      const tbl = el('table', { class: 'tbl' });
      tbl.append(el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'رکورد'), el('th', {}, 'مقدار فعلی'), el('th', {}, 'مقدار جدید'), el('th', {}, 'وضعیت'))));
      const rows = pv.rows.map((r, i) => el('tr', {},
        el('td', { class: 'num small' }, faDigits(i + 1)),
        el('td', { class: 'small', style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, r.label),
        el('td', { class: 'small', style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, fmtV(r.before)),
        el('td', { class: 'small', style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, fmtV(r.after)),
        el('td', {}, r.changed ? el('span', { class: 'badge orange' }, 'تغییر می‌کند') : el('span', { class: 'badge' }, 'بدون تغییر'))));
      tbl.append(el('tbody', {}, rows));
      previewBox.append(el('div', { class: 'tbl-wrap', style: 'max-height:280px; overflow:auto' }, tbl));
    };
    const doPreview = async () => {
      if (!fieldSel.value) return toast('ابتدا فیلد موردنظر را انتخاب کنید.', 'err');
      previewBox.innerHTML = '<div class="skel" style="height:80px"></div>';
      try {
        lastPreview = await api.post(`/api/r/${this.res}/bulk/preview`, { ids, field: fieldSel.value, value: valueCtrl ? valueCtrl.value : '' });
        renderPreview(lastPreview);
      } catch (e) { lastPreview = null; clear(previewBox).append(el('div', { class: 'alert danger' }, e.message)); }
    };
    fieldSel.addEventListener('change', () => { rebuildValueCtrl(); lastPreview = null; clear(previewBox); });
    rebuildValueCtrl();
    const ov = openModal('ویرایش گروهی (Bulk Edit)', el('div', {},
      el('div', { class: 'alert info small mb-10' }, `رکوردهای انتخاب‌شده: ${faDigits(ids.length)} — ویرایش گروهی فقط روی همین رکوردها اعمال می‌شود (فیلترها نقش ندارند).`),
      el('div', { class: 'field' }, el('label', {}, 'فیلد موردنظر'), fieldSel),
      el('div', { class: 'field' }, el('label', {}, 'مقدار جدید'), valueWrap),
      el('div', { class: 'flex', style: 'gap:8px; margin:10px 0; align-items:center' },
        el('button', { class: 'btn', onclick: doPreview }, '👁 پیش‌نمایش'),
        el('span', { class: 'muted small' }, 'ابتدا پیش‌نمایش بگیرید، سپس اعمال نهایی را تأیید کنید.')),
      previewBox), {
      large: true,
      footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, 'لغو'),
        el('button', { class: 'btn primary', onclick: async (e) => {
          if (!lastPreview) { doPreview(); return; }
          if (!lastPreview.will_change) return toast('هیچ رکوردی نیاز به تغییر ندارد (همه «بدون تغییر» هستند).', 'err');
          if (!(await confirmDialog('تأیید نهایی', `«${lastPreview.field_label}» برای ${faDigits(lastPreview.will_change)} رکورد به مقدار جدید تغییر خواهد کرد (بقیه بدون تغییر). این عمل برگشت‌پذیر نیست. ادامه می‌دهید؟`, 'اعمال'))) return;
          e.target.disabled = true;
          try {
            const r = await api.post(`/api/r/${this.res}/bulk/apply`, { ids, field: fieldSel.value, value: valueCtrl ? valueCtrl.value : '' });
            toast(`ویرایش گروهی انجام شد: ${faDigits(r.changed)} رکورد تغییر کرد، ${faDigits(r.no_change)} بدون تغییر. شناسهٔ عملیات: ${r.operation_id}`, 'ok');
            ov.close();
            this._selected.clear(); this.syncSelectionUI();
            this.load();
          } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
        } }, '✓ اعمال نهایی'),
      ],
    });
  }
  // ---------- bulk delete (permission bulk_delete:delete; all-or-nothing; FK-safe) ----------
  openBulkDelete() {
    if (!this.bulkDeleteEnabled()) return toast('شما مجوز حذف گروهی ندارید.', 'err');
    if (this._selected.size < 1) return toast('ابتدا رکوردهای موردنظر را تیک بزنید.', 'err');
    const ids = [...this._selected];
    const box = el('div', { class: 'skel', style: 'height:80px' });
    const ov = openModal('حذف گروهی', box, { large: true, footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn danger', id: 'bd-apply', style: 'display:none' }, '🗑 حذف نهایی'),
    ] });
    const applyBtn = ov.modal.querySelector('#bd-apply');
    let preview = null;
    api.post(`/api/r/${this.res}/bulk/delete-preview`, { ids }).then((pv) => {
      preview = pv;
      clear(box);
      box.append(el('div', { class: 'alert ' + (pv.blocked ? 'danger' : 'warn') + ' mb-10' },
        el('b', {}, faDigits(pv.total) + ' رکورد انتخاب شده است.')));
      if (pv.not_found) box.append(el('div', { class: 'alert warn small' }, faDigits(pv.not_found) + ' رکورد پیدا نشد (احتمالاً قبلاً حذف شده‌اند).'));
      if (pv.blocked) {
        box.append(el('div', { class: 'alert danger small', style: 'line-height:2' },
          el('b', {}, '⛔ ' + faDigits(pv.blocked) + ' رکورد به اطلاعات مهم دیگر وابسته‌اند و نمی‌توانند حذف شوند:')));
        for (const r of pv.rows.filter(x => x.blocked)) {
          const depTxt = (r.deps || []).map(x => x.count + ' در «' + x.table + '»').join('، ');
          box.append(el('div', { class: 'small muted', style: 'padding-inline-start:16px' }, '• ' + r.label + ' — وابستگی: ' + depTxt));
        }
        box.append(el('div', { class: 'muted small mt-10' }, 'برای حفظ یکپارچگی داده‌ها، هیچ رکوردی حذف نمی‌شود. ابتدا وابستگی‌ها را مدیریت کنید.'));
        return;
      }
      // all deletable — show a clear confirmation list
      box.append(el('div', { class: 'alert warn small', style: 'line-height:2' },
        el('b', {}, '⚠ این ' + faDigits(pv.deletable) + ' رکورد به‌صورت دائمی از دیتابیس حذف می‌شوند:')));
      const list = el('div', { class: 'small', style: 'max-height:220px; overflow:auto; padding:8px; border:1px solid var(--border); border-radius:8px' });
      for (const r of pv.rows.filter(x => x.found)) list.append(el('div', {}, '• ' + r.label));
      box.append(list);
      applyBtn.style.display = '';
    }).catch(e => { clear(box).append(el('div', { class: 'alert danger' }, e.message)); });
    applyBtn.addEventListener('click', async () => {
      if (!preview) return;
      if (!(await confirmDialog('تأیید نهایی حذف گروهی',
        'این ' + faDigits(preview.deletable) + ' رکورد «' + (this.spec.singularFa || this.res) + '» به‌طور دائمی و برگشت‌ناپذیر حذف می‌شوند. مطمئن هستید؟', 'بله، حذف شود', true))) return;
      applyBtn.disabled = true;
      try {
        const r = await api.post(`/api/r/${this.res}/bulk/delete`, { ids, confirm: true });
        toast('حذف گروهی انجام شد: ' + faDigits(r.deleted) + ' رکورد حذف شد. عملیات: ' + r.operation_id, 'ok');
        ov.close();
        this._selected.clear(); this.syncSelectionUI();
        this.load();
      } catch (err) {
        applyBtn.disabled = false;
        // 409 DEPENDENTS: re-run preview to show what's now in the way
        if (err.status === 409) {
          try {
            const pv = await api.post(`/api/r/${this.res}/bulk/delete-preview`, { ids });
            clear(box);
            box.append(el('div', { class: 'alert danger', style: 'line-height:2' },
              el('b', {}, '⛔ امکان حذف وجود ندارد — ' + (pv.blocked || 0) + ' رکورد وابسته به اطلاعات دیگر هستند:')));
            for (const r of (pv.rows || []).filter(x => x.blocked)) {
              const depTxt = (r.deps || []).map(x => x.count + ' در «' + x.table + '»').join('، ');
              box.append(el('div', { class: 'small muted', style: 'padding-inline-start:16px' }, '• ' + r.label + ' — ' + depTxt));
            }
          } catch { toast(err.message, 'err'); }
        } else toast(err.message, 'err');
      }
    });
  }
  can(action) {
    const m = window.__me();
    const p = m && m.permissions && m.permissions[this.res];
    return p ? !!p[action] : true;
  }
  async duplicate(id) {
    try { await api.post(`/api/r/${this.res}/${id}/duplicate`); toast('کپی ایجاد شد', 'ok'); this.load(); } catch (e) { toast(e.message, 'err'); }
  }
  async archive(id, archived) {
    try { await api.post(`/api/r/${this.res}/${id}/archive`); toast(archived ? 'بازیابی شد' : 'آرشیو شد', 'ok'); this.load(); } catch (e) { toast(e.message, 'err'); }
  }
  async remove(id) {
    if (!(await confirmDialog('حذف رکورد', 'این رکورد به‌طور کامل حذف می‌شود. این عمل برگشت‌پذیر نیست. آیا مطمئن هستید؟', 'حذف', true))) return;
    try { await api.del(`/api/r/${this.res}/${id}?hard=1`); toast('حذف شد', 'ok'); this.load(); } catch (e) { toast(e.message, 'err'); }
  }
  // ---------- form ----------
  openForm(id = null, preset = null) {
    const body = el('div', { class: 'form-grid' });
    const data = {};
    const fields = this.spec.fields.filter(f => !f.readonly && f.key !== 'id');
    const ctrlMap = {};
    // payment: invoice list follows the selected customer (open invoices of that customer)
    const onCustChange = (this.res === 'payment') ? (cid) => {
      const invCtrl = ctrlMap.invoice_id;
      if (invCtrl && invCtrl.tagName === 'SELECT') fillPaymentInvoices(invCtrl, cid ? Number(cid) : null);
    } : undefined;
    for (const f of fields) {
      const wrap = el('div', { class: 'field', style: (f.type === 'textarea' || f.type === 'json') ? 'grid-column: 1 / -1' : '' });
      wrap.append(el('label', {}, f.label, f.required ? el('span', { class: 'req', style: 'margin-inline-start:2px' }, '*') : ''));
      const initVal = (preset && preset[f.key] != null) ? preset[f.key] : null;
      const c = fieldControl(f, initVal, this.meta, f.key === 'customer_id' ? onCustChange : undefined);
      ctrlMap[f.key] = c;
      c.addEventListener('change', () => { data[f.key] = c.value; });
      wrap.append(c);
      body.append(wrap);
    }
    if (this.res === 'payment' && ctrlMap.invoice_id && ctrlMap.invoice_id.tagName === 'SELECT') {
      fillPaymentInvoices(ctrlMap.invoice_id, ctrlMap.customer_id && ctrlMap.customer_id.value ? Number(ctrlMap.customer_id.value) : null);
    }
    // complaint bank: scope the defect-type suggestions to the selected product family
    if (this.res === 'complaint' && ctrlMap.defect_family && ctrlMap.defect_type) {
      const dl = document.createElement('datalist');
      dl.id = 'dl-defect-types-' + Date.now();
      ctrlMap.defect_type.setAttribute('list', dl.id);
      const fillDl = (family) => api.get('/api/complaints/defect-types' + (family ? '?family=' + encodeURIComponent(family) : ''))
        .then(r => { dl.innerHTML = ''; (r.items || []).forEach(x => { const o = document.createElement('option'); o.value = x.defect_fa; dl.appendChild(o); }); })
        .catch(() => { /* keep previous list */ });
      fillDl(ctrlMap.defect_family.value);
      ctrlMap.defect_family.addEventListener('change', () => { ctrlMap.defect_type.value = ''; fillDl(ctrlMap.defect_family.value); });
      body.append(dl);
    }
    // geo cascade: province → city → industrial city (customers / contacts forms)
    if (ctrlMap.province && (ctrlMap.city || ctrlMap.industrial_city)) {
      const canInd = !!(window.__me().permissions && window.__me().permissions.industrial_city && window.__me().permissions.industrial_city.create);
      wireGeoCascade({
        provinceSel: ctrlMap.province,
        cityIn: ctrlMap.city,
        indCityIn: ctrlMap.industrial_city,
        indWrap: ctrlMap.industrial_city ? ctrlMap.industrial_city.parentElement : null,
        attachTo: body,
      }, { canCreate: canInd });
    }
    const ov = openModal(id ? t('edit') + ': ' + this.spec.singularFa : 'ثبت ' + this.spec.singularFa, body, {
      large: true,
      footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          const payload = {};
          for (const f of fields) {
            const v = ctrlMap[f.key].value;
            if (v === '' || v === null || v === undefined) {
              if (f.required && f.type === 'ref' && f.ref === 'customer') { toast('ابتدا مشتری را انتخاب کنید', 'err'); e.target.disabled = false; return; }
              if (!f.required) continue;
            }
            if (f.type === 'number' || f.type === 'money') payload[f.key] = Number(String(v).replace(/[^\d.-]/g, '')) || 0;
            else if (f.type === 'bool') payload[f.key] = v === '1' || v === true;
            else if (f.type === 'date' || f.type === 'datetime') {
              const ctl = ctrlMap[f.key];
              const parsed = (ctl && ctl._dp) ? ctl._dp.get() : parseJalaaliInput(v);
              if (f.required && !parsed) { toast(f.label + ' را از تقویم انتخاب کنید', 'err'); e.target.disabled = false; return; }
              payload[f.key] = parsed;
            } else if (f.type === 'json') {
              if (v) { try { payload[f.key] = JSON.parse(v); } catch { toast(f.label + ' باید JSON معتبر باشد', 'err'); e.target.disabled = false; return; } }
            } else payload[f.key] = v;
          }
          try {
            if (id) await api.put(`/api/r/${this.res}/${id}`, payload);
            else {
              try { await api.post(`/api/r/${this.res}`, payload); }
              catch (e2) {
                if (e2.code === 'DUPLICATE') {
                  const dups = e2.data && e2.data.duplicates;
                  const dupMsg = (dups || []).length ? dups.map(x => el('div', {}, '#' + x.id + ' — مطابق بر اساس ' + x.label)) : 'رکورد مشابهی وجود دارد. ادامه می‌دهید؟';
                  if (await confirmDialog('رکورد مشابه یافت شد', dupMsg, 'همچنین ثبت', false)) await api.post(`/api/r/${this.res}`, { ...payload, _force: 1 });
                  else { e.target.disabled = false; return; }
                } else throw e2;
              }
            }
            toast('ذخیره شد', 'ok');
            ov.close(); this.load();
            if (this._afterSave) this._afterSave(id);
          } catch (e2) { toast(e2.message, 'err'); }
          e.target.disabled = false;
        } }, t('save')),
      ],
    });
    if (id) {
      api.get(`/api/r/${this.res}/${id}`).then(({ item }) => {
        for (const f of fields) {
          const c = ctrlMap[f.key];
          const v = item[f.key];
          if (f.type === 'date') { if (c._dp) c._dp.set(v || ''); else c.value = v ? jalaliStr(v) : ''; }
          else if (f.type === 'datetime') { if (c._dp) c._dp.set(v || ''); else c.value = v ? jalaliDateTimeStr(v) : ''; }
          else if (f.type === 'json') c.value = v ? JSON.stringify(v, null, 2) : '';
          else if (f.type === 'ref' && f.ref === 'customer') { if (v && c.customerSelect) c.customerSelect.setValue(Number(v)); }
          else if (f.type === 'ref' && (f.ref === 'product' || f.ref === 'products')) { if (v && c.productSelect) c.productSelect.setValue(Number(v)); }
          else if (f.type === 'ref') { if (v) { if (c.options) { if (![...c.options].some(o => String(o.value) === String(v))) c.append(el('option', { value: v, selected: '' }, item[f.key + '_name'] || '#' + v)); else [...c.options].find(o => String(o.value) === String(v)).selected = true; } } }
          else if (f.type === 'bool') c.value = v ? '1' : '0';
          else c.value = v ?? '';
        }
      }).catch(() => {});
    }
  }
  // ---------- detail drawer (modal) ----------
  openDetail(id) {
    const box = el('div');
    const ov = openModal(this.spec.singularFa, box, { large: true });
    box.append(el('div', { class: 'skel', style: 'height:200px' }));
    const SIGN_RES = { contract: 1, order: 1, invoice: 1, warranty: 1 };
    api.get(`/api/r/${this.res}/${id}`).then(({ item }) => {
      clear(box);
      // central record export/print (same for every module — real document)
      box.append(el('div', { class: 'flex between', style: 'margin-bottom:10px; align-items:center' },
        el('span', { class: 'muted small' }, this.spec.nameFa + ' — خروجی/چاپ'),
        recordExportBtn(this.res, item, { title: item.number || item.name || item.title || ('#' + id) })));
      box.append(this.detailActions ? this.detailActions(item, ov) : null);
      if (SIGN_RES[this.res]) {
        const bar = el('div', { class: 'flex between', style: 'margin-bottom:12px' });
        const left = el('div', { class: 'flex', style: 'gap:10px; align-items:center' });
        left.append(el('b', { class: 'small' }, '✍ امضا:'));
        const sigImgWrap = el('span');
        left.append(sigImgWrap);
        const sigBtn = el('button', { class: 'btn sm gold', onclick: () => signatureModal(this.res, id, this.spec.singularFa + ' ' + (item.number || item.title || ''), () => this.openDetail(id)) }, 'ثبت/بازنویسی امضا');
        left.append(sigBtn);
        bar.append(left, el('span', { class: 'muted small' }, 'امضا در اسناد چاپی این رکورد درج می‌شود'));
        api.get('/api/r/' + this.res + '/' + id + '/attachments').then(({ items }) => {
          const sig = (items || []).filter(a => String(a.file_name || '').startsWith('signature'));
          if (sig.length) {
            const img = el('img', { src: '/api/attachments/' + sig[sig.length - 1].id + '/download', alt: 'امضا', style: 'height:44px; border:1px dashed var(--border-2); border-radius:6px; padding:2px 6px' });
            sigImgWrap.append(img);
          } else sigImgWrap.append(el('span', { class: 'badge' }, 'ثبت نشده'));
        }).catch(() => sigImgWrap.append(el('span', { class: 'badge' }, 'ثبت نشده')));
        box.append(bar);
      }
      const infoGrid = el('dl', { class: 'kv' });
      for (const f of this.spec.fields) {
        if (f.type === 'textarea' || f.type === 'json') continue;
        const v = item[f.key];
        let cell;
        if (f.type === 'money') cell = el('span', { class: 'money' }, fmtMoney(v));
        else if (f.type === 'number') cell = el('span', { class: 'num' }, fmtNum(v));
        else if (f.type === 'date' || f.type === 'datetime') cell = fmtDate(v, { time: f.type === 'datetime' });
        else if (f.type === 'ref') cell = item[f.key + '_name'] || (v ? '#' + v : '—');
        else if (f.type === 'bool') cell = v ? 'بله' : 'خیر';
        else cell = v === null || v === undefined || v === '' ? '—' : String(v);
        if (cell === '—') continue;
        infoGrid.append(el('dt', {}, f.label), el('dd', {}, cell));
      }
      const headCard = el('div', { class: 'card mb-16' }, el('div', { class: 'card-b' }, infoGrid,
        (item.notes) ? el('div', { class: 'mt-10 small muted' }, item.notes) : null));
      box.append(headCard);
      const tabItems = ['فعالیت‌ها', 'نظرات', 'پیوست‌ها', 'برچسب‌ها'];
      if (window.__me().permissions && window.__me().permissions.audit_log) tabItems.push('ممیزی');
      const content = el('div');
      const sel = (i) => {
        clear(content);
        content.append(el('div', { class: 'skel', style: 'height:120px' }));
        const load = async () => {
          clear(content);
          try {
            if (tabItems[i] === 'فعالیت‌ها') {
              const r = await api.get(`/api/r/${this.res}/${id}/activities`);
              if (!r.items.length) return content.append(emptyState('فعالیتی ثبت نشده است'));
              content.append(el('div', { class: 'timeline' }, r.items.map(a => el('div', { class: 'tl-item' }, el('div', { class: 'tl-t' }, a.summary), el('div', { class: 'tl-d' }, (a.full_name ? a.full_name + ' — ' : '') + fmtDate(a.created_at, { time: true }))))));
            } else if (tabItems[i] === 'نظرات') {
              const r = await api.get(`/api/r/${this.res}/${id}/comments`);
              const input = el('input', { placeholder: 'نظر خود را بنویسید…' });
              const btn = el('button', { class: 'btn primary sm', onclick: async () => {
                if (!input.value.trim()) return;
                try { await api.post(`/api/r/${this.res}/${id}/comments`, { body: input.value }); input.value = ''; load(); } catch (e) { toast(e.message, 'err'); }
              } }, t('send'));
              content.append(el('div', { class: 'flex mb-10' }, input, btn));
              if (!r.items.length) content.append(el('div', { class: 'small muted' }, 'نظری ثبت نشده است.'));
              content.append(...r.items.map(c => el('div', { class: 'card mb-10' }, el('div', { class: 'card-b small' }, el('b', {}, c.full_name), ' — ', el('span', { class: 'muted' }, fmtDate(c.created_at, { time: true })), el('div', { class: 'mt-10' }, c.body)))));
            } else if (tabItems[i] === 'پیوست‌ها') {
              const r = await api.get(`/api/r/${this.res}/${id}/attachments`);
              const fi = fileInput();
              const up = el('button', { class: 'btn sm', onclick: async () => {
                if (!fi.files.length) return;
                const fd = new FormData();
                fd.append('file', fi.files[0]);
                fd.append('entity_type', this.res);
                fd.append('entity_id', String(id));
                try { await api.upload('/api/attachments', fd); load(); toast('فایل پیوست شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
              } }, '↑ آپلود فایل');
              content.append(el('div', { class: 'flex mb-10' }, fi, up));
              if (!r.items.length) content.append(el('div', { class: 'small muted' }, 'پیوستی ثبت نشده است.'));
              content.append(...r.items.map(a => el('div', { class: 'flex between mb-10 small' }, el('span', {}, '📎 ' + a.file_name, el('span', { class: 'muted' }, ' (' + (a.size / 1024).toFixed(0) + ' KB)')), el('a', { class: 'btn sm', href: `/api/attachments/${a.id}/download` }, 'دانلود'))));
            } else if (tabItems[i] === 'برچسب‌ها') {
              const all = await api.get('/api/r/tag?per_page=100');
              const mine = await api.get(`/api/r/${this.res}/${id}/tags`);
              const mineIds = new Set(mine.items.map(x => x.id));
              const boxes = el('div', { class: 'flex wrap mb-10' });
              const boxes2 = el('div', { class: 'flex wrap' });
              for (const tg of all.items) {
                boxes.append(el('label', { style: 'margin:0' }, el('input', { type: 'checkbox', style: 'width:auto; margin-inline-end:6px', checked: mineIds.has(tg.id), onchange: (e) => { const c = e.target; if (c.checked) boxes2.append(el('span', { class: 'chip mb-10', 'data-t': String(tg.id) }, tg.name, ' ✕')); else [...boxes2.children].find(x => x.dataset.t === String(tg.id))?.remove(); } })));
              }
              const save = el('button', { class: 'btn primary sm mt-10', onclick: async () => {
                const ids = [...boxes2.children].map(x => Number(x.dataset.t));
                try { await api.put(`/api/r/${this.res}/${id}/tags`, { tag_ids: ids }); toast('برچسب‌ها ذخیره شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
              } }, t('save'));
              content.append(el('div', { class: 'small muted mb-10' }, 'برچسب‌های موجود:'), boxes, el('div', { class: 'small muted mt-10 mb-10' }, 'انتخاب شما:'), boxes2, save);
            } else if (tabItems[i] === 'ممیزی') {
              const r = await api.get(`/api/r/${this.res}/${id}/audit`);
              if (!r.items.length) return content.append(emptyState('رکوردی در ممیزی ثبت نشده است'));
              content.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'کاربر'), el('th', {}, 'عملیات'), el('th', {}, 'تاریخ'))), el('tbody', {}, r.items.map(a => el('tr', {}, el('td', {}, a.username), el('td', {}, a.action), el('td', {}, fmtDate(a.at, { time: true }))))))));
            }
          } catch (e) { clear(content).append(el('div', { class: 'alert danger' }, e.message)); }
        };
        load();
      };
      box.append(tabs(tabItems, 0, sel), content);
    }).catch((e) => { clear(box).append(el('div', { class: 'alert danger' }, e.message)); ov.close(); });
  }
  // ---------- import ----------
  async importFlow() {
    const ov = openModal('ورود داده (Excel / CSV / JSON / XML / TXT)', el('div', {}, el('div', { class: 'skel', style: 'height:100px' })), {
      large: true,
      footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('close')),
        el('button', { class: 'btn primary', id: 'imp-next' }, 'بعدی'),
      ],
    });
    const body = ov.body;
    const self = this;
    const footBtn = ov.modal.querySelector('#imp-next');
    let step = 1;
    let parsed = null;   // { tempId, format, header, rowCount, suggested, samples, fields }
    let mapping = [];    // [{ col, key|null }]
    let validated = null;
    let dupPolicy = 'skip';

    function renderStep1() {
      clear(body);
      body.append(el('div', { class: 'alert info mb-10' }, 'فرمت‌های پشتیبانی‌شده: XLS، XLSX، CSV، JSON، XML و TXT. سطر اول فایل باید عنوان ستون‌ها باشد. پس از آپلود می‌توانید نگاشت ستون‌ها به فیلدهای CRM را تنظیم کنید.'));
      const input = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.json,.xml,.txt' });
      const hint = el('div', { class: 'muted small', style: 'margin-top:8px' }, '');
      input.addEventListener('change', () => { hint.textContent = input.files.length ? 'فایل انتخاب‌شده: ' + input.files[0].name + ' (' + faDigits(Math.round(input.files[0].size / 1024)) + ' KB)' : ''; });
      body.append(input, hint);
      renderStep1._input = input;
    }
    async function doUpload() {
      const input = body.querySelector('input[type=file]');
      if (!input || !input.files.length) return toast('ابتدا یک فایل انتخاب کنید', 'err');
      footBtn.disabled = true;
      const fd = new FormData();
      fd.append('file', input.files[0]);
      try {
        parsed = await api.upload(`/api/r/${self.res}/import/parse`, fd);
        mapping = (parsed.suggested || []).map(x => ({ col: x.col, key: x.key }));
        (parsed.header || []).forEach((h, i) => { if (!mapping.some(m => m.col === i)) mapping.push({ col: i, key: null }); });
        step = 2; render();
      } catch (e) { toast(e.message, 'err'); footBtn.disabled = false; }
    }
    function renderStep2() {
      clear(body);
      const sheetNote = (parsed.sheets && parsed.sheets.length > 1) ? ' — از ' + faDigits(parsed.sheets.length) + ' شیت خوانده شد: ' + parsed.sheets.map(s => s.name + ' (' + faDigits(s.dataRows) + ')').join('، ') : '';
      body.append(el('div', { class: 'alert info mb-10' }, 'فرمت فایل: ' + parsed.format + ' — تعداد کل رکوردهای فایل (همهٔ شیت‌ها): ' + faDigits(parsed.fileRowCount || parsed.rowCount) + sheetNote + '. برای هر ستون، فیلد مقصد در CRM را انتخاب کنید (ستون‌های بدون فیلد نادیده گرفته می‌شوند). فیلدهای ستاره‌دار الزامی‌اند.'));
      const table = el('table', { class: 'tbl' });
      const thead = el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'ستون فایل'), el('th', {}, 'نمونه مقدار'), el('th', {}, '→ فیلد CRM')));
      const tbody = el('tbody');
      mapping.forEach((m, i) => {
        const sel = el('select', {}, el('option', { value: '' }, '— نادیده بگیر —'));
        (parsed.fields || []).forEach(f => sel.append(el('option', { value: f.key }, f.label + (f.required ? ' *' : ''))));
        sel.value = m.key || '';
        sel.addEventListener('change', () => {
          mapping.forEach(o => { if (o !== m && o.key === sel.value) o.key = null; });
          m.key = sel.value || null;
        });
        let sample = '';
        for (const r of (parsed.samples || [])) { const v = r[m.col]; if (v !== '' && v !== null && v !== undefined) { sample = String(v).slice(0, 40); break; } }
        tbody.append(el('tr', {},
          el('td', { class: 'num' }, faDigits(i + 1)),
          el('td', {}, parsed.header[m.col] || ('ستون ' + faDigits(i + 1))),
          el('td', { class: 'muted small', style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, sample || '—'),
          el('td', {}, sel)));
      });
      table.append(thead, tbody);
      body.append(el('div', { class: 'tbl-wrap', style: 'max-height:340px; overflow:auto' }, table));
    }
    async function doValidate() {
      footBtn.disabled = true;
      body.append(el('div', { class: 'skel', style: 'height:80px; margin-top:12px' }));
      try {
        validated = await api.post(`/api/r/${self.res}/import/validate`, { tempId: parsed.tempId, mapping });
        step = 3; render();
      } catch (e) { toast(e.message, 'err'); footBtn.disabled = false; }
    }
    function renderStep3() {
      clear(body);
      const v = validated || { validCount: 0, dupCount: 0, errorCount: 0, errors: [], preview: [] };
      body.append(el('div', { class: 'alert ' + (v.errorCount ? 'warn' : 'info') },
        'ردیف‌های معتبر: ' + faDigits(v.validCount) + ' — تکراری (از قبل موجود): ' + faDigits(v.dupCount || 0) + ' — دارای خطا: ' + faDigits(v.errorCount)));
      // duplicate handling policy (explicit, no silent overwrite)
      if (v.dupCount > 0) {
        const polBox = el('div', { class: 'card mb-10', style: 'padding:12px' });
        polBox.append(el('b', { class: 'small' }, 'نحوهٔ مدیریت ' + faDigits(v.dupCount) + ' رکورد تکراری:'));
        const polSel = el('select', {},
          el('option', { value: 'skip' }, 'رد تکراری‌ها (فقط رکوردهای جدید ثبت شوند — بدون تغییر داده فعلی)'),
          el('option', { value: 'update' }, 'به‌روزرسانی رکورد موجود (فقط ستون‌های نگاشت‌شده تغییر می‌کنند)'),
          el('option', { value: 'new' }, 'ثبت به‌عنوان رکورد جدید (تکراری جدید ساخته شود)'));
        polSel.value = dupPolicy;
        polSel.addEventListener('change', () => { dupPolicy = polSel.value; });
        polBox.append(polSel);
        if (v.dupRows && v.dupRows.length) {
          const dt = el('table', { class: 'tbl small' });
          dt.append(el('thead', {}, el('tr', {}, el('th', {}, 'ردیف فایل'), el('th', {}, 'رکورد موجود'), el('th', {}, 'فیلد تکراری'), el('th', {}, 'نام/عنوان'))));
          dt.append(el('tbody', {}, v.dupRows.slice(0, 20).map(d => el('tr', {},
            el('td', { class: 'num' }, faDigits(d.row)),
            el('td', {}, '#' + d.id),
            el('td', {}, d.field),
            el('td', {}, d.name || '—')))));
          polBox.append(el('div', { class: 'tbl-wrap', style: 'max-height:140px; overflow:auto; margin-top:8px' }, dt));
          if (v.dupRows.length > 20) polBox.append(el('div', { class: 'muted small' }, '… و ' + faDigits(v.dupRows.length - 20) + ' ردیف دیگر'));
        }
        body.append(polBox);
      }
      if (parsed && (parsed.fileRowCount || parsed.rowCount)) {
        const fileN = v.fileRowCount || parsed.fileRowCount || parsed.rowCount;
        const sum = (v.validCount || 0) + (v.dupCount || 0) + (v.errorCount || 0);
        body.append(el('div', { class: 'alert ' + (sum === fileN ? 'info' : 'warn') + ' small mb-10' },
          'سازگاری شمارش — رکوردهای فایل: ' + faDigits(fileN) + ' = معتبر ' + faDigits(v.validCount || 0) + ' + تکراری ' + faDigits(v.dupCount || 0) + ' + خطادار ' + faDigits(v.errorCount || 0) + (sum === fileN ? ' ✔' : ' ⚠ (اختلاف: ' + faDigits(fileN - sum) + ')')));
      }
      if (v.errors && v.errors.length) body.append(el('div', { class: 'alert danger small', style: 'max-height:130px; overflow:auto' },
        el('b', {}, 'خطاهای شناسایی‌شده (' + faDigits(v.errors.length) + ' ردیف):'),
        v.errors.slice(0, 25).map(e => el('div', {}, 'ردیف ' + faDigits(e.row) + ': ' + e.errors.join('، '))),
        v.errors.length > 25 ? el('div', { class: 'muted' }, '… و ' + faDigits(v.errors.length - 25) + ' ردیف دیگر') : null));
      if (v.preview && v.preview.length) {
        const keys = Object.keys(v.preview[0]);
        const table = el('table', { class: 'tbl' });
        const headRow = el('tr', {}, keys.map(k => el('th', {}, ((parsed.fields || []).find(f => f.key === k) || {}).label || k)));
        table.append(el('thead', {}, headRow));
        const bodyRows = v.preview.map(row => {
          const cells = keys.map(k => {
            const val = (row[k] === null || row[k] === undefined) ? '' : String(row[k]).slice(0, 40);
            return el('td', { class: 'small' }, val);
          });
          return el('tr', {}, cells);
        });
        table.append(el('tbody', {}, bodyRows));
        body.append(el('div', { class: 'tbl-wrap', style: 'max-height:230px; overflow:auto; margin-top:10px' }, table));
      }
      if (!v.validCount) body.append(el('div', { class: 'alert danger' }, 'هیچ ردیف معتبری وجود ندارد — با این تنظیمات رکوردی ثبت نخواهد شد.'));
    }
    function render() {
      footBtn.textContent = step === 1 ? 'آپلود فایل و ادامه' : step === 2 ? 'اعتبارسنجی و پیش‌نمایش' : '✓ تأیید و ثبت نهایی';
      footBtn.disabled = false;
      if (step === 1) renderStep1();
      else if (step === 2) renderStep2();
      else renderStep3();
    }
    footBtn.addEventListener('click', () => {
      if (step === 1) doUpload();
      else if (step === 2) doValidate();
      else {
        if (!validated || !validated.validCount) return toast('ردیف معتبری برای ثبت وجود ندارد', 'err');
        const fileN = validated.fileRowCount || parsed.fileRowCount || parsed.rowCount;
        const dupNote = validated.dupCount > 0 ? (dupPolicy === 'skip' ? ' — ' + faDigits(validated.dupCount) + ' ردیف تکراری رد می‌شوند' : dupPolicy === 'update' ? ' — ' + faDigits(validated.dupCount) + ' رکورد موجود با ستون‌های نگاشت‌شده بروزرسانی می‌شوند' : ' — برای ' + faDigits(validated.dupCount) + ' تکراری، رکورد جدید ساخته می‌شود') : '';
        confirmDialog('ثبت نهایی داده‌ها', (fileN ? 'از ' + faDigits(fileN) + ' رکورد فایل، ' : '') + faDigits(validated.validCount) + ' ردیف در دیتابیس ثبت خواهد شد' + dupNote + '. ادامه می‌دهید؟', 'ثبت').then((yes) => {
          if (!yes) return;
          footBtn.disabled = true;
          api.post(`/api/r/${self.res}/import/commit-mapped`, { tempId: parsed.tempId, mapping, dupPolicy }).then((r2) => {
            const dbNote = (r2.before !== undefined) ? ' — دیتابیس: ' + faDigits(r2.before) + ' ← ' + faDigits(r2.after) : '';
            toast('ثبت شد: ' + faDigits(r2.ok) + ' جدید' + (r2.updated ? ' — بروزرسانی: ' + faDigits(r2.updated) : '') + (r2.unchanged ? ' — بدون تغییر: ' + faDigits(r2.unchanged) : '') + (fileN ? ' از ' + faDigits(fileN) + ' رکورد فایل' : '') + ' — تکراری/رد: ' + faDigits(r2.dup) + ' — خطا: ' + faDigits(r2.fail) + dbNote, 'ok');
            ov.close(); self.load();
          }).catch((e) => { toast(e.message, 'err'); footBtn.disabled = false; });
        });
      }
    });
    render();
  }
}
