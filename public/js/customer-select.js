'use strict';
// ============ Reusable Customer Selector (Customer Master) ============
// Single component used by ALL forms that select a customer.
// Reads ONLY from the Customer Master via GET /api/r/customer (server-side search,
// permission-scoped). States: loading / empty / error / selected.
// New documents get ACTIVE customers only; preset values (old documents) always
// display even if the customer became inactive afterwards.
import { api, faDigits, statusFa } from './core.js';
import { el, clear } from './ui.js';

function toEnDigits(s) { return String(s || '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))); }

// fetch a customer by id (any status — for displaying old documents)
async function fetchCustomer(id) {
  const r = await api.get('/api/r/customer/' + id);
  return r.item;
}

export function customerSelect(opts = {}) {
  const { value = null, onChange = null, placeholder = 'جستجوی مشتری (نام / کد / تلفن)…' } = opts;
  const root = el('div', { class: 'cust-sel', style: 'position:relative; width:100%' });
  const infoBox = el('div', { class: 'cust-sel-info', style: 'display:none' });
  const picker = el('div', { class: 'cust-sel-picker' });
  const input = el('input', { class: 'input', style: 'width:100%', placeholder });
  const results = el('div', { class: 'cust-sel-results', style: 'display:none; position:absolute; top:100%; right:0; left:0; z-index:50; max-height:280px; overflow:auto' });
  picker.append(input, results);
  root.append(picker, infoBox);

  let currentId = value ? Number(value) : null;
  let timer = null;
  let reqSeq = 0;

  function setLoading() {
    results.style.display = 'block';
    results.append(el('div', { class: 'cust-sel-state', style: 'padding:12px; text-align:center' },
      el('span', { class: 'muted small' }, 'در حال بارگذاری مشتریان…')));
  }
  function setEmpty() {
    results.style.display = 'block';
    results.append(el('div', { class: 'cust-sel-state', style: 'padding:12px; text-align:center' },
      el('span', { class: 'muted small' }, 'هیچ مشتری فعالی ثبت نشده است.')));
  }
  function setError(e) {
    console.error('customer selector: fetch failed:', e);
    results.style.display = 'block';
    results.append(el('div', { class: 'cust-sel-state', style: 'padding:12px; text-align:center' },
      el('span', { class: 'small', style: 'color:#c0392b' }, 'دریافت فهرست مشتریان با خطا مواجه شد.')));
  }
  function hideResults() { results.style.display = 'none'; results.innerHTML = ''; }

  async function doSearch(q) {
    const seq = ++reqSeq;
    setLoading();
    let items;
    try {
      const params = new URLSearchParams({ per_page: '20', f_status: 'active' });
      if (q) params.set('q', q);
      const r = await api.get('/api/r/customer?' + params.toString());
      if (seq !== reqSeq) return; // stale
      items = r.items || [];
    } catch (e) { if (seq === reqSeq) return setError(e); return; }
    hideResults();
    // inline "new customer" action (create without leaving the form)
    const newRow = el('div', { class: 'cust-sel-row', style: 'padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; gap:8px; background:var(--surface-2)' });
    newRow.append(el('div', {},
      el('b', { class: 'small' }, '＋ ایجاد مشتری جدید'),
      el('div', { class: 'muted small' }, 'بدون خروج از این فرم')));
    newRow.addEventListener('mousedown', (e) => { e.preventDefault(); newCustomerForm(); });
    results.append(newRow);
    if (!items.length) {
      // distinguish: no customers at all vs no match for the query
      if (!q) return setEmpty();
      results.style.display = 'block';
      results.append(el('div', { class: 'cust-sel-state', style: 'padding:12px; text-align:center' },
        el('span', { class: 'muted small' }, 'مشتری فعالی با این مشخصات پیدا نشد.')));
      return;
    }
    for (const it of items) {
      const row = el('div', { class: 'cust-sel-row', style: 'padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; gap:8px' });
      row.append(el('div', {},
        el('b', { class: 'small' }, it.name || '—'),
        el('div', { class: 'muted small' }, [it.number, it.phone || it.mobile].filter(Boolean).join(' • '))));
      row.append(el('span', { class: 'muted small', style: 'white-space:nowrap' }, it.city || ''));
      row.addEventListener('mousedown', (e) => { e.preventDefault(); select(it.id); });
      results.append(row);
    }
    results.style.display = 'block';
  }

  function renderSelected(c) {
    picker.style.display = 'none';
    infoBox.style.display = 'block';
    infoBox.innerHTML = '';
    const badges = [];
    if (c.status && c.status !== 'active') badges.push(el('span', { class: 'badge red small' }, 'غیرفعال'));
    infoBox.append(el('div', { class: 'flex between', style: 'align-items:center; gap:8px' },
      el('div', {},
        el('b', {}, c.name || '—'),
        el('div', { class: 'muted small' }, [c.number ? 'کد: ' + c.number : null, c.type ? statusFa(c.type) : null].filter(Boolean).join(' • ')),
        badges.length ? el('div', { class: 'flex', style: 'gap:4px; margin-top:4px' }, ...badges) : null),
      el('div', { class: 'flex', style: 'gap:6px' },
        el('a', { class: 'btn sm', href: '#/customers/' + c.id, title: 'مشاهده مشتری' }, 'مشاهده'),
        el('button', { class: 'btn sm', onclick: () => { currentId = null; infoBox.style.display = 'none'; picker.style.display = ''; input.value = ''; onChange && onChange(null); } }, '× حذف'))));
  function notifyChange() { if (onChange) onChange(currentId, currentId ? { id: currentId } : null); }
    const grid = el('div', { class: 'grid g-2', style: 'margin-top:8px; font-size:12px' });
    const kv = (l, v) => { if (v) grid.append(el('div', { class: 'flex', style: 'gap:4px' }, el('span', { class: 'muted' }, l + ':'), el('span', {}, v))); };
    kv('تلفن', c.phone); kv('موبایل', c.mobile); kv('ایمیل', c.email);
    kv('استان', c.province); kv('شهر', c.city);
    kv('آدرس', c.address); kv('شناسه ملی/ثبت', c.tax_code);
    if (c.salesperson_id_name) kv('مسئول فروش', c.salesperson_id_name);
    if (grid.children.length) infoBox.append(grid);
    // related snapshot (balance / last invoice / last order / last follow-up / contract) — only when it helps the UX
    const relBox = el('div', { class: 'cust-sel-rel', style: 'margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); display:none' });
    infoBox.append(relBox);
    api.get('/api/customers/' + c.id + '/finance').then(f => {
      const rel = f.related || {};
      const items = [];
      if (f.totals && f.totals.balance) items.push(['مانده حساب', faDigits(Math.round(f.totals.balance).toLocaleString('en-US')) + ' ریال']);
      if (rel.last_invoice) items.push(['آخرین فاکتور', rel.last_invoice.number + ' — ' + faDigits(Math.round(rel.last_invoice.total).toLocaleString('en-US'))]);
      if (rel.last_order) items.push(['آخرین سفارش', rel.last_order.number]);
      if (rel.last_followup) items.push(['آخرین پیگیری', rel.last_followup.subject || '—']);
      if (rel.last_payment) items.push(['آخرین پرداخت', (rel.last_payment.invoice_number || '—') + ' — ' + faDigits(Math.round(rel.last_payment.amount).toLocaleString('en-US'))]);
      if (rel.active_contract) items.push(['وضعیت قرارداد', (rel.active_contract.number || rel.active_contract.title || '') + ' (' + rel.active_contract.status + ')']);
      if (!items.length) return;
      relBox.innerHTML = '';
      relBox.append(el('div', { class: 'grid g-2', style: 'font-size:11.5px' }, ...items.map(([l, v]) =>
        el('div', { class: 'flex', style: 'gap:4px' }, el('span', { class: 'muted' }, l + ':'), el('span', {}, v)))));
      relBox.style.display = '';
    }).catch(e => console.error('customer selector: finance snapshot failed:', e.message));
  }

  async function select(id) {
    currentId = Number(id);
    hideResults();
    try {
      const c = await fetchCustomer(currentId);
      renderSelected(c);
      if (onChange) onChange(currentId, c);
    } catch (e) {
      console.error('customer selector: fetch by id failed:', e);
      currentId = null;
      picker.style.display = '';
      input.value = '';
      if (onChange) onChange(null);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = toEnDigits(input.value.trim());
    timer = setTimeout(() => doSearch(q), 300); // debounce
  });
  input.addEventListener('focus', () => { input.placeholder = placeholder; doSearch(''); });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) hideResults(); });

  // initial value (e.g. preselected from Customer Detail → "سند جدید")
  // STANDARD: no customer list is rendered until the user clicks/focuses the field —
  // the picker shows only a hint; search results load on demand (lazy, per_page=20).
  if (currentId) select(currentId);
  else { input.value = ''; input.placeholder = 'مشتری — برای جستجو کلیک کنید…'; }

  // compact "new customer" form inside the dropdown (create without leaving the form)
  function newCustomerForm() {
    clear(results);
    const nm = el('input', { class: 'input', placeholder: 'نام مشتری *', style: 'width:100%; margin-bottom:6px' });
    const ph = el('input', { class: 'input', placeholder: 'تلفن (اختیاری)', dir: 'ltr', style: 'width:100%; margin-bottom:6px' });
    const ct = el('input', { class: 'input', placeholder: 'شهر (اختیاری)', style: 'width:100%' });
    const saveBtn = el('button', { class: 'btn primary sm', style: 'width:100%; margin-top:6px' }, 'ذخیره و انتخاب');
    saveBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!nm.value.trim()) { nm.style.borderColor = 'var(--danger)'; return; }
      saveBtn.disabled = true;
      api.post('/api/r/customer', { name: nm.value.trim(), phone: ph.value.trim(), city: ct.value.trim() })
        .then(r => select(r.id || (r.item && r.item.id)))
        .catch(e2 => { saveBtn.disabled = false; toast('ایجاد مشتری: ' + (e2.message || 'خطا'), 'err'); })
        .finally(() => { if (saveBtn.disabled) { saveBtn.disabled = false; doSearch(toEnDigits(input.value.trim())); } });
    });
    const backBtn = el('button', { class: 'btn sm', style: 'width:100%; margin-top:6px' }, '← بازگشت به جستجو');
    backBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); doSearch(toEnDigits(input.value.trim())); });
    results.append(el('div', { class: 'muted small', style: 'padding:8px 12px 4px; font-weight:600' }, 'مشتری جدید (ذخیره مستقیم در Customer Master)'), nm, ph, ct, saveBtn, backBtn);
  }

  // API for the form
  const clearSel = () => { currentId = null; infoBox.style.display = 'none'; picker.style.display = ''; input.value = ''; };
  root.customerSelect = {
    get value() { return currentId; },
    set value(v) { if (v) select(v); else { clearSel(); if (onChange) onChange(null); } },
    setValue: (v) => { if (v) select(v); },
    getValue: () => currentId,
    refresh: () => { if (currentId) select(currentId); else doSearch(toEnDigits(input.value.trim())); },
  };
  // the generic form reads ctrlMap[key].value — mirror it on the node itself
  Object.defineProperty(root, 'value', {
    get: () => currentId,
    set: (v) => { if (v) select(v); else { clearSel(); if (onChange) onChange(null); } },
    configurable: true,
  });
  return root;
}
