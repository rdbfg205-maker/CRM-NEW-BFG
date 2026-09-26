'use strict';
import { api, t, fmtDate, fmtMoney, fmtNum, faDigits, toEnDigits, statusFa, jalaliLib } from '../core.js';
import { el, clear, toast, openModal } from '../ui.js';
import { helpBtn } from './help.js';


// ============ Sales & Finance specialized reports (chain) ============
async function salesFinanceReports(c) {
  const wrap = el('div', { class: 'card mb-16' },
    el('div', { class: 'card-h' }, el('h3', {}, 'گزارش‌های تخصصی فروش و مالی'), el('span', { class: 'muted small' }, 'زنجیره: مشتری ← قیمت ← پیش‌فاکتور ← سفارش ← فاکتور ← پرداخت ← پورسانت')));
  c.append(wrap);
  const box = el('div', { class: 'card-b' });
  wrap.append(box);
  const kinds = (await api.get('/api/salesreports/kinds').catch(() => ({ kinds: [] }))).kinds;
  const kindSel = el('select', {}, kinds.map(k => el('option', { value: k.key }, k.title)));
  const fromIn = el('input', { type: 'text', placeholder: 'از (شمسی): ۱۴۰/۱/۱' });
  const toIn = el('input', { type: 'text', placeholder: 'تا (شمسی): ۱۴۵/۱۲/۲۹' });
  const custSel = el('select', {}, el('option', { value: '' }, 'همه مشتریان'));
  const spSel = el('select', {}, el('option', { value: '' }, 'همه فروشندگان'));
  const statusSel = el('select', {}, el('option', { value: '' }, 'همه وضعیت‌ها'), ...[['unpaid', 'پرداخت‌نشده'], ['partial', 'پرداخت جزئی'], ['paid', 'پرداخت‌شده'], ['overdue', 'سررسیدگذشته']].map(([v, l]) => el('option', { value: v }, l)));
  // geography report filters (province / city / industrial city / type / status / salesperson / date)
  const { PROVINCES } = await import('../geo.js');
  const geoProv = el('select', {}, el('option', { value: '' }, 'همه استان‌ها'));
  (Array.isArray(PROVINCES) ? PROVINCES : []).forEach(p => geoProv.append(el('option', { value: p }, p)));
  const geoCity = el('input', { placeholder: 'شهر (اختیاری)', style: 'width:130px' });
  const geoInd = el('input', { placeholder: 'شهرک صنعتی (اختیاری)', style: 'width:140px' });
  const geoType = el('select', {}, el('option', { value: '' }, 'همه انواع'), el('option', { value: 'company' }, 'شرکت'), el('option', { value: 'person' }, 'شخصی'));
  const geoStatus = el('select', {}, el('option', { value: '' }, 'همه وضعیت‌ها'), ...[['active', 'فعال'], ['lead', 'اولیه'], ['inactive', 'غیرفعال'], ['blocked', 'ممنوع']].map(([v, l]) => el('option', { value: v }, l)));
  const geoBox = el('div', { class: 'flex wrap', style: 'gap:8px; align-items:flex-end; margin-top:8px; display:none' },
    el('div', { class: 'field' }, el('label', {}, 'استان'), geoProv),
    el('div', { class: 'field' }, el('label', {}, 'شهر'), geoCity),
    el('div', { class: 'field' }, el('label', {}, 'شهرک صنعتی'), geoInd),
    el('div', { class: 'field' }, el('label', {}, 'نوع مشتری'), geoType),
    el('div', { class: 'field' }, el('label', {}, 'وضعیت مشتری'), geoStatus));
  const isGeo = () => kindSel.value === 'customer_geography';
  kindSel.addEventListener('change', () => { geoBox.style.display = isGeo() ? '' : 'none'; custSel.parentElement.style.display = isGeo() ? 'none' : ''; });
  if (isGeo()) geoBox.style.display = '';
  api.get('/api/r/customer?per_page=300').then(r => { for (const cu of r.items) custSel.append(el('option', { value: cu.id }, cu.name)); }).catch(() => {});
  api.get('/api/admin/users?per_page=200').then(r => { for (const u of (r.items || [])) spSel.append(el('option', { value: u.id }, u.full_name)); }).catch(() => {});
  const resultBox = el('div', { style: 'margin-top:12px' });
  const parseJ = (v) => { if (!v.trim()) return null; const m = v.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (!m) return null; const g = jalaliLib().toGregorian(+m[1], +m[2], +m[3]); return new Date(g.gy, g.gm - 1, g.gd, 12).toISOString(); };
  function buildParams() {
    const u = new URLSearchParams();
    const f = parseJ(fromIn.value), t = parseJ(toIn.value);
    if (fromIn.value.trim() && !f) throw new Error('تاریخ از نامعتبر است (فرمت: ۱۴۰/۱/۱)');
    if (toIn.value.trim() && !t) throw new Error('تاریخ تا نامعتبر است (فرمت: ۱۴۰/۱/۱)');
    if (f) u.set('from', f);
    if (t) u.set('to', t);
    if (custSel.value) u.set('customer_id', custSel.value);
    if (spSel.value) u.set('salesperson_id', spSel.value);
    if (statusSel.value) u.set('status', statusSel.value);
    if (isGeo()) {
      if (geoProv.value) u.set('province', geoProv.value);
      if (geoCity.value.trim()) u.set('city', geoCity.value.trim());
      if (geoInd.value.trim()) u.set('industrial_city', geoInd.value.trim());
      if (geoType.value) u.set('ctype', geoType.value);
      if (geoStatus.value) u.set('status', geoStatus.value);
    }
    return u;
  }
  const runBtn = el('button', { class: 'btn primary sm' }, '⚙ اجرا');
  box.append(el('div', { class: 'flex wrap', style: 'gap:8px; align-items:flex-end' },
    el('div', { class: 'field' }, el('label', {}, 'نوع گزارش'), kindSel),
    el('div', { class: 'field' }, el('label', {}, 'از'), fromIn),
    el('div', { class: 'field' }, el('label', {}, 'تا'), toIn),
    el('div', { class: 'field' }, el('label', {}, 'مشتری'), custSel),
    el('div', { class: 'field' }, el('label', {}, 'فروشنده'), spSel),
    el('div', { class: 'field' }, el('label', {}, 'وضعیت'), statusSel),
    runBtn,
    el('a', { class: 'btn sm', id: 'sr-xlsx' }, '⬇ Excel'),
    el('a', { class: 'btn sm', id: 'sr-csv' }, '⬇ CSV'),
    el('a', { class: 'btn sm', id: 'sr-pdf', target: '_blank', rel: 'noopener' }, '🖨 PDF / چاپ رسمی')));
  box.append(geoBox);
  runBtn.addEventListener('click', async () => {
    let u;
    try { u = buildParams(); } catch (e) { return toast(e.message, 'err'); }
    clear(resultBox);
    resultBox.append(el('div', { class: 'skel', style: 'height:140px' }));
    try {
      const r = await api.get('/api/salesreports/' + kindSel.value + '?' + u.toString());
      clear(resultBox);
      const sum = r.summary || {};
      const sumHtml = el('div', { class: 'flex wrap', style: 'gap:10px; margin-bottom:10px' });
      if (sum.sum_total) sumHtml.append(el('div', { class: 'badge gold' }, 'مجموع مبلغ: ' + fmtMoney(sum.sum_total)));
      if (sum.sum_balance) sumHtml.append(el('div', { class: 'badge orange' }, 'مجموع مانده: ' + fmtMoney(sum.sum_balance)));
      if (sum.sum_amount) sumHtml.append(el('div', { class: 'badge gold' }, 'مجموع پورسانت: ' + fmtMoney(sum.sum_amount)));
      sumHtml.append(el('div', { class: 'badge' }, faDigits(sum.total_rows || 0) + ' ردیف'));
      resultBox.append(sumHtml);
      if (!r.rows.length) return resultBox.append(el('div', { class: 'muted small', style: 'padding:10px' }, 'ردیفی یافت نشد.'));
      const headFa = { customer: 'مشتری', product: 'محصول', salesperson: 'فروشنده', region: 'منطقه', month: 'ماه', year: 'سال', number: 'شماره', invoices: 'تعداد فاکتور', total: 'مبلغ', paid: 'پرداختی', balance: 'مانده', qty: 'تعداد', issue_date: 'تاریخ صدور', due_date: 'سررسید', status: 'وضعیت', payments: 'تعداد', date: 'تاریخ', invoice: 'فاکتور', amount: 'مبلغ', method: 'روش', open_invoices: 'فاکتور باز', credit_limit: 'سقف اعتبار', commissions: 'تعداد', base: 'مبنای محاسبه', period: 'دوره', province: 'استان', city: 'شهر', industrial_city: 'شهرک صنعتی', name: 'مشتری/عنوان', type: 'نوع', contacts: 'مخاطبین', created_at: 'تاریخ ثبت' };
      resultBox.append(el('div', { class: 'tbl-wrap', style: 'max-height:380px; overflow:auto' }, el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, r.columns.map(col => el('th', {}, headFa[col] || col)))),
        el('tbody', {}, r.rows.map(row => el('tr', {}, r.columns.map(col => {
          const v = row[col];
          if (col.endsWith('_date') || col === 'date' || col === 'created_at') return el('td', {}, fmtDate(v));
          if (typeof v === 'number') return el('td', { class: 'num' }, fmtMoney(['total', 'paid', 'balance', 'amount', 'base', 'credit_limit'].includes(col) ? v : v));
          if (col === 'status') return el('td', {}, el('span', { class: 'badge' }, statusFa(v) || v));
          return el('td', {}, v === null || v === undefined || v === '' ? '—' : String(v));
        })))))));
      const exp = (fmt) => '/api/salesreports/' + kindSel.value + '/export?format=' + fmt + '&' + u.toString();
      box.querySelector('#sr-xlsx').href = exp('xlsx');
      box.querySelector('#sr-csv').href = exp('csv');
      box.querySelector('#sr-pdf').href = exp('html');
    } catch (e) { clear(resultBox).append(el('div', { class: 'alert danger' }, e.message)); }
  });
}

// ============ Report Builder (Section 7) — all modules + combined chains ============
const DRILL_ROUTE = {
  customer: '/customers', invoice: '/invoices', order: '/orders', quote: '/quotes',
  payment: '/payments', lead: '/leads', opportunity: '/opportunities', product: '/products',
  price_list: '/pricelists', stock_transaction: '/stock/movements', stock_alert: '/stock/alerts',
  lab_request: '/lab/requests', lab_result: '/lab/results', complaint: '/complaints',
  ticket: '/tickets', warranty: '/warranties', contract: '/contracts', campaign: '/campaigns',
  loyalty_tier: '/loyalty', meeting: '/meetings', task: '/tasks', followup: '/followups',
  document: '/documents', user: '/admin/users', voip_call: '/calls', commission: '/commission',
};
const AGG_FA = { count: 'تعداد', sum: 'جمع', avg: 'میانگین', min: 'حداقل', max: 'حداکثر' };
const OP_FA = { eq: 'بسیار', neq: 'نباشد', contains: 'حاوی', not_contains: 'بدون', gt: 'بزرگتر از', gte: 'بزرگتر/برابر', lt: 'کوچکتر از', lte: 'کوچکتر/برابر', between: 'بین', is_null: 'خالی', is_not_null: 'غیرخالی' };

function downloadBlob(buf, fileName, mime) {
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName || 'report';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function exportDef(definition, format) {
  const r = await fetch('/api/advreports/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('bfc_token') || '') },
    body: JSON.stringify({ definition, format }),
  });
  if (!r.ok) { let m = 'خطای خروجی'; try { m = (await r.json()).error?.message || m; } catch {} throw new Error(m); }
  const cd = r.headers.get('content-disposition') || '';
  const fn = decodeURIComponent((cd.match(/filename="?([^";]+)"?/) || [])[1] || ('report.' + format));
  if (format === 'pdf') {
    const url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'text/html' }));
    window.open(url, '_blank');
    return;
  }
  downloadBlob(await r.arrayBuffer(), fn, r.headers.get('content-type') || 'application/octet-stream');
}

export async function reportBuilder(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'سازنده گزارش'), el('div', { class: 'sub' }, 'گزارش از همه ماژول‌های CRM با دادهٔ واقعی — جستجو، فیلتر، گروه‌بندی و محاسبات، Drill-down به رکورد، خروجی XLSX/CSV/JSON/PDF')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('reports')));
  c.append(_ph);
  // ============ Sales & Finance specialized reports ============
  await salesFinanceReports(c);

  const card = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'سازندهٔ گزارش'), el('span', { class: 'muted small' }, 'انتخاب ماژول، ستون‌ها، جستجو، فیلتر، مرتب‌سازی و گروه‌بندی')));
  c.append(card);
  const body = el('div', { class: 'card-b' });
  card.append(body);

  let SOURCES = {};
  const srcSel = el('select', {});
  const qIn = el('input', { placeholder: 'جستجو در ستون‌های انتخاب‌شده…', style: 'width:230px' });
  const colsBox = el('div', { class: 'flex wrap', style: 'gap:8px' });
  const groupSel = el('select', {});
  groupSel.append(el('option', { value: '' }, 'بدون گروه‌بندی'));
  const aggSel = el('select', {});
  for (const [k, v] of Object.entries(AGG_FA)) aggSel.append(el('option', { value: k }, v));
  const sortSel = el('select', {});
  const dirSel = el('select', {}, el('option', { value: 'desc' }, 'کاهشی'), el('option', { value: 'asc' }, 'فزاینده'));
  const fOpSel = el('select', {}, el('option', { value: 'AND' }, 'و (AND)'), el('option', { value: 'OR' }, 'یا (OR)'));
  const filtersBox = el('div', { style: 'display:flex; flex-direction:column; gap:6px; width:100%' });
  const nameIn = el('input', { placeholder: 'نام گزارش برای ذخیره به‌عنوان قالب' });
  const runBtn = el('button', { class: 'btn gold' }, '⚙ اجرا');
  const saveBtn = el('button', { class: 'btn' }, '💾 ذخیره قالب');

  function curCols() { return Object.keys(SOURCES[srcSel.value]?.cols || {}); }
  async function fillCols() {
    clear(colsBox); clear(groupSel); clear(sortSel);
    groupSel.append(el('option', { value: '' }, 'بدون گروه‌بندی'));
    const def = SOURCES[srcSel.value];
    if (!def) return;
    for (const [ck, meta] of Object.entries(def.cols)) {
      const chip = el('label', { class: 'badge', style: 'cursor:pointer; display:inline-flex; gap:6px' },
        el('input', { type: 'checkbox', value: ck, checked: '' }),
        meta.fa + (meta.agg ? ' Σ' : '') + (meta.date ? ' 🗓' : ''));
      colsBox.append(chip);
      groupSel.append(el('option', { value: ck }, meta.fa));
      sortSel.append(el('option', { value: ck }, meta.fa));
    }
  }
  function addFilterRow() {
    const row = el('div', { class: 'flex wrap', style: 'gap:6px; align-items:center' });
    const fSel = el('select', {}, curCols().map(ck => el('option', { value: ck }, SOURCES[srcSel.value]?.cols[ck]?.fa || ck)));
    const opSel = el('select', {}, Object.entries(OP_FA).map(([k, v]) => el('option', { value: k }, v)));
    const vIn = el('input', { placeholder: 'مقدار', style: 'width:150px' });
    const v2In = el('input', { placeholder: 'تا', style: 'width:110px', display: 'none' });
    const rm = el('button', { class: 'btn sm', type: 'button' }, '✕');
    rm.addEventListener('click', () => row.remove());
    opSel.addEventListener('change', () => { v2In.style.display = opSel.value === 'between' ? '' : 'none'; vIn.style.display = (opSel.value === 'is_null' || opSel.value === 'is_not_null') ? 'none' : ''; });
    row.append(fSel, opSel, vIn, v2In, rm);
    filtersBox.append(row);
  }
  const addFBtn = el('button', { class: 'btn sm' }, '＋ فیلتر');
  addFBtn.addEventListener('click', addFilterRow);
  function buildDefinition() {
    const cols = [...colsBox.querySelectorAll('input[type=checkbox]')].filter(x => x.checked).map(x => x.value);
    const conditions = [...filtersBox.children].map(row => {
      const [fSel, opSel, vIn, v2In] = row.querySelectorAll('select,input');
      if (!fSel || !opSel || !vIn || !fSel.value) return null;
      const cond = { field: fSel.value, op: opSel.value };
      if (opSel.value !== 'is_null' && opSel.value !== 'is_not_null' && vIn && vIn.value.trim() !== '') {
        cond.value = (opSel.value === 'gt' || opSel.value === 'gte' || opSel.value === 'lt' || opSel.value === 'lte') ? Number(toEnDigits(String(vIn.value))) : vIn.value.trim();
        if (opSel.value === 'between' && v2In && v2In.value.trim() !== '') cond.value2 = v2In.value.trim();
      }
      return cond;
    }).filter(Boolean);
    return {
      source: srcSel.value, columns: cols,
      q: qIn.value.trim() || undefined,
      filters: { op: fOpSel.value, conditions },
      group_by: groupSel.value, group_agg: aggSel.value,
      sort: sortSel.value, sort_dir: dirSel.value,
    };
  }

  const resultBox = el('div', { class: 'card-b muted small' }, 'گزارش را اجرا کنید. روی ردیف‌ها کلیک کنید تا رکورد اصلی باز شود (Drill-down).');
  const resultCard = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'نتیجه')), resultBox);
  c.append(resultCard);

  async function run(def) {
    clear(resultBox);
    resultBox.append(el('div', { class: 'skel', style: 'height:140px' }));
    let r;
    try { r = await api.post('/api/advreports/run', def); } catch (e) { clear(resultBox); resultBox.append(el('div', { class: 'alert danger' }, e.message)); return null; }
    renderResult(r, def);
    return r;
  }
  function renderResult(r, def) {
    clear(resultBox);
    const meta = SOURCES[def.source]?.cols || {};
    const badges = el('div', { class: 'flex wrap', style: 'gap:8px; margin-bottom:10px' });
    badges.append(el('div', { class: 'badge' }, (r.rows?.length || 0) + ' ردیف'));
    if (r.aggMode && r.grandTotal) badges.append(el('div', { class: 'badge gold' }, 'جمع کل: ' + AGG_FA[r.group_agg || 'count'] + ' = ' + fmtNum(Number(r.grandTotal.agg) || 0) + ' از ' + fmtNum(r.grandTotal.count) + ' رکورد'));
    resultBox.append(badges);
    if (!r.rows?.length) return resultBox.append(el('div', { class: 'muted', style: 'padding:10px' }, 'ردیفی یافت نشد.'));
    const head = el('tr', {}, r.headers.map(h => el('th', {}, h)));
    const tb = el('tbody', {});
    const metricCols = r.columns.filter(c2 => c2 !== r.group_by);
    r.rows.forEach(row => {
      const tr = el('tr', {});
      r.headers.forEach((h, idx) => {
        let colKey, v;
        if (r.aggMode) {
          if (idx === 0) { colKey = r.group_by; v = row._group; }
          else if (idx === 1) { colKey = metricCols[0] || null; v = row._agg; }
          else { colKey = metricCols[idx - 2]; v = row[colKey]; }
        } else { colKey = r.columns[idx]; v = row[colKey]; }
        let td;
        if (v === null || v === undefined || v === '') td = el('td', {}, '—');
        else if (meta[colKey]?.date && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) td = el('td', {}, fmtDate(v, { time: v.length > 10 }));
        else if (typeof v === 'number') td = el('td', { class: 'num' }, fmtNum(v));
        else td = el('td', {}, String(v).slice(0, 60));
        tr.append(td);
      });
      if (row._drill && DRILL_ROUTE[row._drill.entity]) {
        tr.style.cursor = 'pointer';
        tr.title = 'باز کردن رکورد اصلی (Drill-down)';
        tr.addEventListener('click', () => { location.hash = '#' + DRILL_ROUTE[row._drill.entity] + '/' + row._drill.id; });
        const first = tr.querySelector('td'); if (first) first.style.fontWeight = '600';
      }
      tb.append(tr);
    });
    resultBox.append(el('div', { class: 'tbl-wrap', style: 'max-height:420px; overflow:auto' }, el('table', { class: 'tbl' }, el('thead', {}, head), tb)));
  }

  const actions = el('div', { class: 'flex wrap', style: 'gap:8px; margin-top:12px' });
  runBtn.addEventListener('click', () => run(buildDefinition()));
  const exportDefNow = (format) => {
    const def = buildDefinition();
    if (!def.columns.length) return toast('حداقل یک ستون انتخاب کنید', 'err');
    exportDef(def, format).then(() => toast('خروجی ' + format.toUpperCase() + ' آماده شد', 'ok')).catch(e => toast(e.message, 'err'));
  };
  const bXLSX = el('button', { class: 'btn sm' }, '⬇ XLSX');
  const bCSV = el('button', { class: 'btn sm' }, '⬇ CSV');
  const bJSON = el('button', { class: 'btn sm' }, '⬇ JSON');
  const bPDF = el('button', { class: 'btn sm' }, '🖨 PDF / چاپ');
  actions.append(el('span', { class: 'muted small' }, 'خروجی:'), bXLSX, bCSV, bJSON, bPDF);
  bXLSX.addEventListener('click', () => exportDefNow('xlsx'));
  bCSV.addEventListener('click', () => exportDefNow('csv'));
  bJSON.addEventListener('click', () => exportDefNow('json'));
  bPDF.addEventListener('click', () => exportDefNow('pdf'));
  body.append(
    el('div', { class: 'flex wrap', style: 'gap:10px; margin-bottom:10px' },
      el('div', { class: 'field' }, el('label', {}, 'ماژول / منبع'), srcSel),
      el('div', { class: 'field' }, el('label', {}, 'جستجو'), qIn),
      runBtn),
    el('div', { style: 'margin:10px 0' }, el('label', { class: 'muted small' }, 'ستون‌ها (Σ = قابل محاسبه، 🗓 = تاریخ شمسی)'), colsBox),
    el('div', { class: 'flex wrap', style: 'gap:10px; margin-bottom:10px' },
      el('div', { class: 'field' }, el('label', {}, 'گروه‌بندی'), groupSel),
      el('div', { class: 'field' }, el('label', {}, 'عملیات محاسبه'), aggSel),
      el('div', { class: 'field' }, el('label', {}, 'مرتب‌سازی بر اساس'), sortSel),
      el('div', { class: 'field' }, el('label', {}, 'جهت'), dirSel)),
    el('div', { style: 'margin:10px 0' },
      el('div', { class: 'flex', style: 'gap:6px; margin-bottom:6px' }, el('label', { class: 'muted small' }, 'فیلترها:'), fOpSel, addFBtn),
      filtersBox),
    el('div', { class: 'flex wrap', style: 'gap:8px; margin-top:12px' }, nameIn, saveBtn),
    actions);

  // ============ saved templates ============
  const tBody = el('div', { class: 'card-b muted small' }, 'در حال بارگذاری…');
  c.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'قالب‌های ذخیره‌شده')), tBody));
  async function loadTemplates() {
    try {
      const { items } = await api.get('/api/advreports/templates');
      clear(tBody);
      if (!items.length) return tBody.append(el('span', { class: 'muted small' }, 'قالبی ذخیره نشده است.'));
      for (const it of items) {
        const row = el('div', { class: 'flex between', style: 'padding:9px 0; border-top:1px solid var(--border)' });
        row.append(el('span', {}, (it.favorite ? '★ ' : '') + it.name, el('span', { class: 'muted small' }, ' — ' + (SOURCES[it.source]?.nameFa || it.source))));
        const acts = el('span', { class: 'flex' });
        const fillAndRun = async () => {
          srcSel.value = it.source; fillCols();
          for (const cb of colsBox.querySelectorAll('input[type=checkbox]')) cb.checked = (it.columns || []).includes(cb.value);
          groupSel.value = it.group_by || ''; aggSel.value = it.group_agg || 'count';
          sortSel.value = it.sort || ''; dirSel.value = it.sort_dir || 'desc';
          clear(filtersBox);
          const conds = it.filters?.conditions || [];
          conds.forEach(() => addFilterRow());
          [...filtersBox.children].forEach((rowEl, i) => {
            const [fSel, opSel, vIn, v2In] = rowEl.querySelectorAll('select,input');
            const cd = conds[i]; if (!cd || !fSel || !opSel || !vIn) return;
            fSel.value = cd.field; opSel.value = cd.op;
            if (cd.value !== undefined && cd.value !== null) vIn.value = cd.value;
            if (v2In && cd.value2 !== undefined && cd.value2 !== null) v2In.value = cd.value2;
            opSel.dispatchEvent(new Event('change'));
          });
          await run({ source: it.source, columns: it.columns, filters: it.filters, group_by: it.group_by || '', group_agg: it.group_agg || 'count', sort: it.sort || '', sort_dir: it.sort_dir || 'desc' });
        };
        acts.append(el('button', { class: 'btn sm' }, '⚙ اجرا'));
        acts.querySelector('button').addEventListener('click', fillAndRun);
        const bX = el('a', { class: 'btn sm', href: 'javascript:void(0)' }, '⬇ Excel');
        bX.addEventListener('click', () => exportDef({ name: it.name, source: it.source, columns: it.columns, filters: it.filters, group_by: it.group_by, group_agg: it.group_agg, sort: it.sort, sort_dir: it.sort_dir }, 'xlsx').catch(e => toast(e.message, 'err')));
        const bP = el('a', { class: 'btn sm', href: 'javascript:void(0)' }, '🖨 PDF');
        bP.addEventListener('click', () => exportDef({ name: it.name, source: it.source, columns: it.columns, filters: it.filters, group_by: it.group_by, group_agg: it.group_agg, sort: it.sort, sort_dir: it.sort_dir }, 'pdf').catch(e => toast(e.message, 'err')));
        const bF = el('button', { class: 'btn sm' }, it.favorite ? '★' : '☆');
        bF.addEventListener('click', async () => { try { await api.post('/api/advreports/templates/' + it.id + '/favorite', {}); loadTemplates(); } catch (e) { toast(e.message, 'err'); } });
        const bD = el('button', { class: 'btn sm' }, '🗑');
        bD.addEventListener('click', async () => { if (!confirm('قالب حذف شود؟')) return; try { await api.del('/api/advreports/templates/' + it.id); loadTemplates(); } catch (e) { toast(e.message, 'err'); } });
        acts.append(bX, bP, bF, bD);
        row.append(acts);
        tBody.append(row);
      }
    } catch (e) { clear(tBody); tBody.textContent = e.message; }
  }
  saveBtn.addEventListener('click', async () => {
    const def = buildDefinition();
    if (!def.columns.length) return toast('حداقل یک ستون انتخاب کنید', 'err');
    const name = nameIn.value.trim() || (SOURCES[def.source]?.nameFa || def.source) + ' — گزارش';
    try {
      await api.post('/api/advreports/templates', { name, ...def, q: undefined });
      nameIn.value = '';
      toast('قالب ذخیره شد', 'ok');
      loadTemplates();
    } catch (e) { toast(e.message, 'err'); }
  });

  // load sources & init
  try {
    const r = await api.get('/api/advreports/sources');
    SOURCES = r.sources || {};
  } catch (e) { toast(e.message, 'err'); }
  const singles = Object.entries(SOURCES).filter(([, s]) => s.kind !== 'chain');
  const chains = Object.entries(SOURCES).filter(([, s]) => s.kind === 'chain');
  srcSel.append(el('optgroup', { label: 'گزارش‌های ماژولی (همه واحدها CRM)' }, singles.map(([k, v]) => el('option', { value: k }, v.nameFa))));
  srcSel.append(el('optgroup', { label: 'گزارش‌های ترکیبی بین ماژول‌ها' }, chains.map(([k, v]) => el('option', { value: k }, v.nameFa))));
  srcSel.value = 'customer_chain';
  srcSel.addEventListener('change', () => { fillCols(); clear(filtersBox); addFilterRow(); });
  await fillCols();
  addFilterRow();
  loadTemplates();
}
export async function autoReports(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'گزارش‌های خودکار مدیریتی'), el('div', { class: 'sub' }, 'گزارش روزانه/هفتگی/ماهانه با تحلیل AI به فارسی')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('reports')));
  c.append(_ph);
  const box = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(box);
  try {
    const { items } = await api.get('/api/reports/instances');
    clear(box);
    if (!items.length) { box.append(el('div', { class: 'card-b muted small' }, 'هنوز گزارشی تولید نشده است. گزارش‌ها به‌صورت خودکار (روز/هفته/ماه) ساخته می‌شوند.')); return; }
    const KIND = { daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه', manual: 'دستی' };
    for (const it of items) {
      const card = el('div', { style: 'border-top:1px solid var(--border)' });
      const h = el('div', { class: 'flex between', style: 'padding:12px 16px' });
      h.append(el('b', {}, (KIND[it.kind] || it.kind) + ' — ' + (it.period_start ? fmtDate(it.period_start) : '')));
      h.append(el('span', { class: 'muted small' }, fmtDate(it.created_at, { time: true })));
      card.append(h);
      if (it.ai_analysis) card.append(el('div', { class: 'alert gold small', style: 'margin:0 16px 12px' }, '🤖 ' + it.ai_analysis));
      const d = it.data || {};
      if (d.sales) {
        const kv = el('dl', { class: 'kv', style: 'padding:0 16px 14px' });
        kv.append(el('dt', {}, 'فروش دوره'), el('dd', {}, fmtMoney(d.sales.total)), el('dt', {}, 'تعداد فاکتور'), el('dd', {}, faDigits(d.sales.c)));
        if (d.payments) kv.append(el('dt', {}, 'وصول'), el('dd', {}, fmtMoney(d.payments.s)));
        if (d.customersNew !== undefined) kv.append(el('dt', {}, 'مشتری جدید'), el('dd', {}, faDigits(d.customersNew)));
        if (d.complaintsNew !== undefined) kv.append(el('dt', {}, 'شکایت جدید'), el('dd', {}, faDigits(d.complaintsNew)));
        if (d.receivables) kv.append(el('dt', {}, 'مطالبات باز فعلی'), el('dd', {}, fmtMoney(d.receivables)));
        card.append(kv);
      }
      box.append(card);
    }
  } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
}
