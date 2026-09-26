'use strict';
// ============ Central Product Selector (Product Master) ============
// Single component used by ALL forms that select a product. Reads ONLY from the
// Product Master via GET /api/r/product (server-side search, permission-scoped).
// Per product rule: NO inline creation here — products are managed in the Products
// module only. States: loading / empty / error / selected.
import { api, faDigits } from './core.js';
import { el, clear } from './ui.js';

function toEnDigits(s) { return String(s || '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))); }

export function productSelect(opts = {}) {
  const { value = null, onChange = null, placeholder = 'جستجوی محصول (نام / کد / دسته)…' } = opts;
  const root = el('div', { class: 'prod-sel', style: 'position:relative; width:100%' });
  const infoBox = el('div', { class: 'prod-sel-info', style: 'display:none' });
  const picker = el('div', { class: 'prod-sel-picker' });
  const input = el('input', { class: 'input', style: 'width:100%', placeholder });
  const results = el('div', { class: 'prod-sel-results', style: 'display:none; position:absolute; top:100%; right:0; left:0; z-index:50; max-height:280px; overflow:auto' });
  picker.append(input, results);
  root.append(picker, infoBox);

  let currentId = value ? Number(value) : null;
  let selected = null;
  let timer = null;
  let reqSeq = 0;

  async function doSearch(q) {
    const seq = ++reqSeq;
    results.innerHTML = '';
    results.style.display = 'block';
    results.append(el('div', { class: 'muted small', style: 'padding:10px; text-align:center' }, 'در حال بارگذاری محصولات…'));
    let items = [];
    try {
      const r = await api.get('/api/r/product?per_page=20&q=' + encodeURIComponent(toEnDigits(q || '')));
      if (seq !== reqSeq) return;
      items = r.items || [];
    } catch (e) {
      if (seq !== reqSeq) return;
      results.innerHTML = '';
      results.append(el('div', { class: 'small', style: 'padding:10px; color:#c0392b' }, 'خطا در بارگذاری محصولات.'));
      return;
    }
    results.innerHTML = '';
    if (!items.length) {
      results.append(el('div', { class: 'muted small', style: 'padding:10px; text-align:center' }, 'محصولی یافت نشد.'));
      return;
    }
    for (const it of items) {
      const row = el('div', { class: 'prod-sel-row', style: 'padding:7px 12px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; gap:8px' });
      row.append(el('div', {},
        el('b', { class: 'small' }, it.name || '—'),
        el('div', { class: 'muted small' }, [it.code ? 'کد: ' + it.code : null, it.unit ? it.unit : null].filter(Boolean).join(' • '))));
      row.append(el('span', { class: 'muted small', style: 'white-space:nowrap' }, it.category_name || ''));
      row.addEventListener('mousedown', (e) => { e.preventDefault(); select(it.id, it); });
      results.append(row);
    }
    results.style.display = 'block';
  }

  async function select(id, item) {
    currentId = Number(id);
    selected = item || null;
    results.style.display = 'none';
    results.innerHTML = '';
    if (!selected) {
      try { const r = await api.get('/api/r/product/' + id); selected = r.item; }
      catch { selected = { id, name: '#' + id }; }
    }
    renderSelected(selected);
    if (onChange) onChange(currentId, selected);
  }

  function renderSelected(p) {
    picker.style.display = 'none';
    infoBox.style.display = 'block';
    infoBox.innerHTML = '';
    infoBox.append(el('div', { class: 'flex between', style: 'align-items:center; gap:8px' },
      el('div', {},
        el('b', {}, p.name || '—'),
        el('div', { class: 'muted small' }, [p.code ? 'کد: ' + p.code : null, p.unit ? 'واحد: ' + p.unit : null, p.price_retail ? 'قیمت: ' + faDigits(p.price_retail) : null].filter(Boolean).join(' • '))),
      el('div', { class: 'flex', style: 'gap:6px' },
        el('a', { class: 'btn sm', href: '#/products/' + p.id, title: 'مشاهده محصول' }, 'مشاهده'),
        el('button', { class: 'btn sm', onclick: () => { currentId = null; selected = null; infoBox.style.display = 'none'; picker.style = ''; input.value = ''; if (onChange) onChange(null, null); } }, '× حذف'))));
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => doSearch(toEnDigits(input.value.trim())), 300); });
  input.addEventListener('focus', () => { input.placeholder = placeholder; doSearch(''); });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) results.style.display = 'none'; });

  if (currentId) select(currentId);
  else { input.value = ''; input.placeholder = 'محصول — برای جستجو کلیک کنید…'; }

  const clearSel = () => { currentId = null; selected = null; infoBox.style.display = 'none'; picker.style = ''; input.value = ''; };
  root.productSelect = {
    get value() { return currentId; },
    set value(v) { if (v) select(v); else { clearSel(); if (onChange) onChange(null, null); } },
    setValue: (v) => { if (v) select(v); },
    getValue: () => currentId,
  };
  Object.defineProperty(root, 'value', {
    get: () => currentId,
    set: (v) => { if (v) select(v); else { clearSel(); if (onChange) onChange(null, null); } },
    configurable: true,
  });
  return root;
}
