'use strict';
// ============ Search & Export (Section 6) ============
// Server-side export for the lists that had no export: contacts, stock (products
// stock view), raw materials, loyalty (tiers + members), lab results, price lists.
// Rules:
//   - real DB data only (no mocks)
//   - respects the same search (q) / filters as the list page + "all records"
//   - dates rendered in JALALI (English digits for CSV/XLSX/JSON = Excel-safe;
//     Persian digits for printable HTML)
//   - permission enforced per entity (…:export); 403 without it
//   - formats: xlsx | csv | json | html (html = printable page → print to PDF)
const XLSX = require('xlsx');
const { get } = require('../../db/db');
const { requirePerm } = require('../../auth/auth');
const { nowIso, likeEscape, normalizeFa, faDigits, fmtDate, fmtDateLong } = require('../../lib/util');
const printMod = require('../../lib/print');

// Jalali date for exports, Excel-safe digits (e.g. 1405-06-17)
const jd = (iso, time = false) => (iso ? fmtDate(iso, { time, fa: false }) : '—');
const FORMATS = ['xlsx', 'csv', 'json', 'html'];

function searchClause(fields, q) {
  if (!q) return { where: '', args: [] };
  const term = '%' + likeEscape(normalizeFa(q).replace(/\s+/g, ' ')) + '%';
  return { where: ' WHERE (' + fields.map(f => f + ' LIKE ?').join(' OR ') + ')', args: fields.map(() => term) };
}
function sendExport(res, r) {
  if (r.disposition === 'inline') {
    res.writeHead(200, { 'Content-Type': r.mime, 'Content-Length': r.buf.length });
    res.end(r.buf);
  } else {
    res.writeHead(200, { 'Content-Type': r.mime, 'Content-Disposition': 'attachment; filename="' + r.fileName + '"', 'Content-Length': r.buf.length });
    res.end(r.buf);
  }
}
// sheets: [{ name, headers: [..], rows: [[..]] }]
function render(format, title, fileNameBase, sheets, opts = {}) {
  const withHeader = opts.header !== false;
  if (opts.auditUser) {
    try {
      require('../../core/audit').audit(opts.auditUser, opts.auditEntity || 'export', 0, 'export', null,
        { format, title, rows: sheets.reduce((a, x) => a + x.rows.length, 0), header: withHeader }, '');
    } catch { /* best-effort */ }
  }
  if (format === 'csv') {
    const s = sheets[0];
    const csv = '\uFEFF' + [s.headers, ...s.rows].map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    return { buf: Buffer.from(csv, 'utf8'), mime: 'text/csv; charset=utf-8', fileName: fileNameBase + '.csv' };
  }
  if (format === 'json') {
    const obj = { source: title, generated_at: nowIso(), note: 'تاریخ‌ها شمسی (رقم انگلیسی) — داده از دیتابیس واقعی', sheets: {} };
    for (const s of sheets) obj.sheets[s.name] = s.rows.map(r => Object.fromEntries(s.headers.map((h, i) => [h, r[i]])));
    return { buf: Buffer.from(JSON.stringify(obj, null, 2), 'utf8'), mime: 'application/json; charset=utf-8', fileName: fileNameBase + '.json' };
  }
  if (format === 'html') {
    const co = printMod.company();
    opts = { ...opts, printUser: opts.printUser || '' };
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tables = sheets.map(s =>
      '<table class="items"><thead><tr>' + s.headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      s.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>');
    const body = printMod.companyHeadHtml(co, withHeader) + '<h1>' + esc(title) + '</h1><div class="genline">تاریخ خروجی: ' + fmtDateLong(nowIso()) + ' — تعداد ردیف: ' + faDigits(sheets.reduce((a, s) => a + s.rows.length, 0)) + (opts.printUser ? ' — کاربر: ' + esc(opts.printUser) : '') + '</div>' + tables.join('<br class="page-break"/>');
    return { buf: Buffer.from(printMod.baseHtml(title, body, co, { printMeta: { at: fmtDateLong(nowIso(), false) + ' ' + new Date().toTimeString().slice(0, 5), user: opts.printUser || '' }, autoPrint: opts.autoPrint }), 'utf8'), mime: 'text/html; charset=utf-8', fileName: fileNameBase + '.html', disposition: 'inline' };
  }
  // xlsx (default) — real XLSX with report title + generated date (Jalali, Excel-safe digits)
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const aoa = withHeader
      ? [[title], ['تاریخ تولید: ' + fmtDateLong(nowIso()) + (opts.printUser ? ' — کاربر: ' + opts.printUser : ''), '', '', ''], s.headers, ...s.rows]
      : [s.headers, ...s.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = s.headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return { buf: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: fileNameBase + '.xlsx' };
}
function fmtOr(_user, _q, format) {
  const f = FORMATS.includes(format) ? format : 'xlsx';
  return f;
}

// ---------- 1) Contacts (مخاطبین) — permission: customer:export ----------
function exportContacts(user, q, format) {
  requirePerm(user, 'customer', 'export');
  const d = get();
  const s = searchClause(['cct.name', 'cct.mobile', 'cct.phone', 'cct.email', 'c.name', 'cct.position'], q);
  const rows = d.prepare(`SELECT cct.*, c.name AS customer_name FROM customer_contacts cct JOIN customers c ON c.id=cct.customer_id${s.where} ORDER BY cct.is_primary DESC, cct.id LIMIT 10000`).all(...s.args);
  const headers = ['نام مخاطب', 'مشتری', 'سمت', 'موبایل', 'تلفن', 'ایمیل', 'آدرس', 'اصلی', 'وضعیت'];
  const out = rows.map(r => [r.name, r.customer_name || '', r.position || '', r.mobile || '', r.phone || '', r.email || '', r.address || '', r.is_primary ? 'بله' : 'خیر', r.status === 'active' ? 'فعال' : 'غیرفعال']);
  return render(fmtOr(user, q, format), 'مخاطبین', 'contacts-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [{ name: 'مخاطبین', headers, rows: out }], { auditUser: user, auditEntity: 'customer' });
}

// ---------- 2) Stock / raw materials (موجودی کالا / مواد اولیه) — permission: product:export ----------
function exportStock(user, q, raw, format) {
  requirePerm(user, 'product', 'export');
  const d = get();
  const s = searchClause(['p.name', 'p.code', 'p.sku', 'pc.name'], q);
  const rawClause = raw ? 'AND p.is_raw_material=1' : '';
  const rows = d.prepare(`SELECT p.*, pc.name AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id WHERE p.archived_at IS NULL ${rawClause}${s.where ? ' AND (' + s.where.replace(/^ WHERE /, '') + ')' : ''} ORDER BY p.name LIMIT 10000`).all(...s.args);
  const headers = ['کد', 'نام کالا', 'دسته', 'واحد', 'موجودی', 'حد سفارش مجدد', 'حداکثر', 'قیمت تمام‌شده', 'ارزش موجودی', 'وضعیت'];
  const out = rows.map(p => {
    const low = p.reorder_point > 0 && p.stock_qty <= p.reorder_point;
    const over = p.max_stock > 0 && p.stock_qty > p.max_stock;
    return [p.code || '', p.name, p.category_name || '', p.unit || '', p.stock_qty, p.reorder_point || 0, p.max_stock || 0, p.price_cost || 0, Math.round((p.stock_qty || 0) * (p.price_cost || 0)), low ? 'کمبود' : over ? 'بیش از حد' : 'معمول'];
  });
  return render(fmtOr(user, q, format), raw ? 'مواد اولیه — موجودی' : 'موجودی کالا', (raw ? 'raw-materials-' : 'stock-') + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [{ name: 'موجودی', headers, rows: out }], { auditUser: user, auditEntity: 'product' });
}

// ---------- 3) Loyalty (باشگاه مشتریان): tiers + members — permission: loyalty_tier:export ----------
function exportLoyalty(user, q, format) {
  requirePerm(user, 'loyalty_tier', 'export');
  const d = get();
  const tiers = d.prepare('SELECT * FROM loyalty_tiers ORDER BY min_points').all();
  const members = d.prepare(`SELECT la.*, c.name AS customer_name, c.mobile AS customer_mobile, lt.name AS tier_name FROM loyalty_accounts la LEFT JOIN customers c ON c.id=la.customer_id LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id ORDER BY la.points_balance DESC LIMIT 10000`).all();
  let tiersOut = tiers, membersOut = members;
  if (q) {
    const nq = normalizeFa(q).trim();
    tiersOut = tiersOut.filter(t => String(t.name || '').includes(q) || String(t.name || '').includes(nq));
    membersOut = membersOut.filter(m => String(m.customer_name || '').includes(q) || String(m.customer_name || '').includes(nq) || String(m.tier_name || '').includes(nq));
  }
  const h1 = ['سطح', 'حداقل امتیاز', 'تخفیف ٪', 'رنگ'];
  const r1 = tiersOut.map(t => [t.name, t.min_points || 0, t.discount_pct || 0, t.color || '']);
  const h2 = ['مشتری', 'موبایل', 'سطح فعلی', 'امتیاز فعلی', 'امتیاز کل کسب‌شده'];
  const r2 = membersOut.map(m => [m.customer_name || ('#' + m.customer_id), m.customer_mobile || '', m.tier_name || '—', m.points_balance || 0, m.points_earned || 0]);
  return render(fmtOr(user, q, format), 'باشگاه مشتریان', 'loyalty-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [
    { name: 'سطوح', headers: h1, rows: r1 },
    { name: 'اعضا', headers: h2, rows: r2 },
  ], { auditUser: user, auditEntity: 'loyalty_tier' });
}

// ---------- 4) Lab results (نتایج آزمایش) — permission: lab_result:export ----------
function exportLabResults(user, q, status, format) {
  requirePerm(user, 'lab_result', 'export');
  const d = get();
  const s = searchClause(['lr.test_name', 'lr.method', 'lr.result_value', 'lr.spec_text', 'lr.analyst', 'lrq.number', 'c.name'], q);
  const stClause = status ? ' AND lr.status=?' : '';
  const rows = d.prepare(`SELECT lr.*, lrq.number AS request_number, lrq.sample_desc, c.name AS customer_name
    FROM lab_results lr
    LEFT JOIN lab_requests lrq ON lrq.id=lr.request_id
    LEFT JOIN customers c ON c.id=lrq.customer_id
    ${s.where} ${stClause} ORDER BY lr.id DESC LIMIT 10000`).all(...s.args, ...(status ? [status] : []));
  const headers = ['درخواست', 'مشتری', 'آزمون', 'روش', 'نتیجه', 'واحد', 'محدوده', 'وضعیت', 'آزمایشگر', 'تاریخ آزمون (شمسی)'];
  const statusFa = { pending: 'در انتظار', pass: 'مطابق', fail: 'نامطابق' };
  const out = rows.map(r => [r.request_number || '#' + r.request_id, r.customer_name || '', r.test_name, r.method || '', r.result_value || '', r.unit || '', r.spec_text || '', statusFa[r.status] || r.status || '', r.analyst || '', jd(r.test_date || r.created_at)]);
  return render(fmtOr(user, q, format), 'نتایج آزمایش', 'lab-results-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [{ name: 'نتایج آزمایش', headers, rows: out }], { auditUser: user, auditEntity: 'lab_result' });
}

// ---------- 5) Price lists (لیست قیمت‌ها) — permission: price_list:export ----------
function exportPriceLists(user, q, format) {
  requirePerm(user, 'price_list', 'export');
  const d = get();
  const s = searchClause(['pl.name', 'p.name', 'p.code', 'cu.name'], q);
  const rows = d.prepare(`SELECT pl.id AS list_id, pl.name AS list_name, pl.currency, pl.valid_from, pl.valid_until, pl.active AS pl_active, pl.is_default,
      pli.id AS item_id, p.name AS product_name, p.code AS product_code, pli.payment_stage, pli.price, cu.name AS customer_name
    FROM price_lists pl
    LEFT JOIN price_list_items pli ON pli.price_list_id=pl.id
    LEFT JOIN products p ON p.id=pli.product_id
    LEFT JOIN customers cu ON cu.id=pli.customer_id
    ${s.where} ORDER BY pl.id, pli.id LIMIT 10000`).all(...s.args);
  const stageFa = { cash: 'نقدی', '3_month': '۳ ماهه', '6_month': '۶ ماهه', custom: 'سایر' };
  const curFa = { IRR: 'ریال', IRT: 'تومان', USD: 'دولار' };
  const headers = ['لیست قیمت', 'ارز', 'اعتبار (شمسی)', 'وضعیت لیست', 'پیش‌فرض', 'کد کالا', 'نام کالا', 'مشتری اختصاصی', 'مرحله پرداخت', 'قیمت'];
  const out = rows.map(r => [r.list_name, curFa[r.currency] || r.currency, (r.valid_from ? jd(r.valid_from) : 'شروع: —') + ' تا ' + (r.valid_until ? jd(r.valid_until) : 'ادامه'), r.pl_active ? 'فعال' : 'غیرفعال', r.is_default ? 'بله' : 'خیر', r.product_code || '—', r.product_name || '—', r.customer_name || '—', stageFa[r.payment_stage] || r.payment_stage || '—', r.price !== null && r.price !== undefined ? r.price : '—']);
  return render(fmtOr(user, q, format), 'لیست قیمت‌ها', 'price-lists-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [{ name: 'لیست قیمت‌ها', headers, rows: out }], { auditUser: user, auditEntity: 'price_list' });
}

// ---------- 6) Stock movements (گردش موجودی) — permission: stock_transaction:export ----------
function exportMovements(user, q, format) {
  requirePerm(user, 'stock_transaction', 'export');
  const d = get();
  const typeFa = { in: 'ورود', out: 'خروج', transfer: 'انتقال', adjust: 'اصلاح', reservation: 'رزرو' };
  const s = searchClause(['p.name', 'p.code', 'st.note', 'u.full_name'], q);
  const rows = d.prepare(`SELECT st.*, p.name AS product_name, p.code AS product_code, u.full_name AS user_name
    FROM stock_transactions st
    LEFT JOIN products p ON p.id=st.product_id
    LEFT JOIN users u ON u.id=st.user_id
    ${s.where} ORDER BY st.id DESC LIMIT 10000`).all(...s.args);
  const headers = ['کالا', 'کد', 'نوع حرکت', 'مقدار', 'مستند', 'توضیح', 'کاربر', 'تاریخ (شمسی)'];
  const out = rows.map(r => [r.product_name || ('#' + r.product_id), r.product_code || '', typeFa[r.type] || r.type, r.qty, r.ref_type ? (r.ref_type + (r.ref_id ? ' #' + r.ref_id : '')) : '—', r.note || '', r.user_name || '', jd(r.created_at, true)]);
  return render(fmtOr(user, q, format), 'گردش موجودی', 'stock-movements-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [{ name: 'گردش موجودی', headers, rows: out }], { auditUser: user, auditEntity: 'stock_transaction' });
}

// ---------- 7) Lab requests (درخواست‌های آزمایش) — permission: lab_request:export ----------
function exportLabRequests(user, q, status, format) {
  requirePerm(user, 'lab_request', 'export');
  const d = get();
  const s = searchClause(['lq.number', 'lq.sample_desc', 'lq.sample_code', 'lq.test_type', 'lq.notes', 'c.name', 'o.number'], q);
  const stClause = status ? ' AND lq.status=?' : '';
  const rows = d.prepare(`SELECT lq.*, c.name AS customer_name, o.number AS order_number,
    (SELECT COUNT(*) FROM lab_results WHERE request_id=lq.id) AS result_count,
    (SELECT test_name FROM lab_results WHERE request_id=lq.id ORDER BY id DESC LIMIT 1) AS last_test
    FROM lab_requests lq
    LEFT JOIN customers c ON c.id=lq.customer_id
    LEFT JOIN orders o ON o.id=lq.order_id
    ${s.where}${stClause} ORDER BY lq.id DESC LIMIT 10000`).all(...s.args, ...(status ? [status] : []));
  const statusFa = { received: 'دریافت‌شده', in_progress: 'در حال آزمایش', done: 'انجام‌شده', reported: 'گزارش‌داده‌شده', cancelled: 'لغوشده' };
  const headers = ['شماره', 'مشتری', 'سفارش مبدا', 'نوع آزمون', 'اولویت', 'وضعیت', 'تاریخ دریافت (شمسی)', 'سررسید (شمسی)', 'تعداد نتیجه', 'آخرین آزمون'];
  const out = rows.map(r => [r.number, r.customer_name || '', r.order_number || '', r.test_type || '', r.priority || '', statusFa[r.status] || r.status, jd(r.received_at, true), r.due_date ? jd(r.due_date, true) : '—', r.result_count || 0, r.last_test || '—']);
  return render(fmtOr(user, q, format), 'درخواست‌های آزمایش', 'lab-requests-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [{ name: 'درخواست‌های آزمایش', headers, rows: out }], { auditUser: user, auditEntity: 'lab_request' });
}

// ---------- 8) Stock alerts (هشدارهای موجودی) — permission: stock_alert:export ----------
function exportAlerts(user, q, format) {
  requirePerm(user, 'stock_alert', 'export');
  const d = get();
  const levelFa = { reorder: 'کمبود / سفارش مجدد', max: 'بیش از حد' };
  const s = searchClause(['p.name', 'p.code', 'sa.message'], q);
  const rows = d.prepare(`SELECT sa.*, p.name AS product_name, p.code AS product_code
    FROM stock_alerts sa
    LEFT JOIN products p ON p.id=sa.product_id
    ${s.where} ORDER BY sa.id DESC LIMIT 10000`).all(...s.args);
  const headers = ['کالا', 'کد', 'سطح', 'پیام', 'وضعیت', 'تاریخ (شمسی)', 'برطرف‌شده در (شمسی)'];
  const out = rows.map(r => [r.product_name || ('#' + r.product_id), r.product_code || '', levelFa[r.level] || r.level, r.message || '', r.resolved_at ? 'برطرف شد' : 'فعال', jd(r.created_at, true), r.resolved_at ? jd(r.resolved_at, true) : '—']);
  return render(fmtOr(user, q, format), 'هشدارهای موجودی', 'stock-alerts-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), [{ name: 'هشدارهای موجودی', headers, rows: out }], { auditUser: user, auditEntity: 'stock_alert' });
}

module.exports = { FORMATS, render, exportContacts, exportStock, exportLoyalty, exportLabResults, exportLabRequests, exportPriceLists, exportMovements, exportAlerts, sendExport };
