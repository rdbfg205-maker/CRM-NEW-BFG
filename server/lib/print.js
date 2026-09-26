'use strict';
const bwip = require('bwip-js');
const fs = require('fs');
const path = require('path');
const { get, getSetting } = require('../db/db');
const { fmtDate, fmtDateLong, fmtNum, fmtMoney, faDigits, nowIso } = require('./util');
const { esc } = require('./util');
const ASSETS_DIR = path.join(__dirname, '..', '..', 'public', 'assets');
function assetExists(name) { try { return fs.existsSync(path.join(ASSETS_DIR, name)); } catch { return false; } }

function company() {
  return getSetting('company', {
    name: 'شرکت دانش‌بنیان بسپار فوم غرب', nameEn: 'BASPAR FOAM GHARB', logo: '/assets/logo-selen.png',
    logo_selen: '/assets/logo-selen.png', logo_baspar: '/assets/logo-baspar.png',
    factory_address: 'استان مرکزی، شهرستان زرندیه، شهرک صنعتی مامونیه، بلوار صنعت، خیابان چهارم، پلاک 4176، واحد B306',
    factory_postal: '3941894176', factory_phone: '+98 8645253691',
    hq_address: 'شهرک راه آهن، خیابان هجده متری قائم، خیابان قائم دوازدهم، پلاک 97',
    hq_postal: '1494994884',
    address: '', phone: '', email: '', website: '', tax_code: '',
  });
}
// ---------- standard company header (single source for ALL official outputs) ----------
// Shows: company name (fa/en) + factory address + factory postal + factory phone +
// HQ address + HQ postal + email/website, plus the factory QR code when configured.
// Item scope: only company-info display. LTR spans keep digits/codes from reordering in RTL.
function companyInfoLines(co) {
  const L = [];
  L.push(`<b>${esc(co.name)}</b>`);
  if (co.nameEn) L.push(`<span dir="ltr" style="display:inline-block; font-size:10px; color:#8a8f98; letter-spacing:.4px">${esc(co.nameEn)}</span>`);
  const factoryAddr = co.factory_address || co.address;
  if (factoryAddr) L.push(`کارخانه: ${esc(factoryAddr)}`);
  if (co.factory_postal || co.postal_code) L.push(`کد پستی کارخانه: <span dir="ltr">${esc(co.factory_postal || co.postal_code)}</span>`);
  if (co.factory_phone || co.phone) L.push(`تلفن کارخانه: <span dir="ltr">${esc(co.factory_phone || co.phone)}</span>`);
  if (co.hq_address) L.push(`دفتر مرکزی: ${esc(co.hq_address)}`);
  if (co.hq_postal) L.push(`کد پستی دفتر مرکزی: <span dir="ltr">${esc(co.hq_postal)}</span>`);
  if (co.email) L.push(`ایمیل: <span dir="ltr">${esc(co.email)}</span>${co.website ? ' &nbsp; وب‌سایت: <span dir="ltr">' + esc(co.website) + '</span>' : ''}`);
  return L.join('<br>');
}
function companyHeadHtml(co, withHeader = true) {
  if (!withHeader) return '';
  // dual-logo official header: SELEN (right, in RTL) + BASPAR FOAM GHARB (left, when the asset file is present)
  const selen = co.logo_selen || '/assets/logo-selen.png';
  const baspar = co.logo_baspar || '/assets/logo-baspar.png';
  const logos = [`<img src="${esc(selen)}" alt="SELEN" class="logo-selen">`]
    .concat(assetExists('logo-baspar.png') ? [`<img src="${esc(baspar)}" alt="BASPAR FOAM GHARB" class="logo-baspar">`] : [])
    .join('');
  const qr = co.qr_image ? `<div class="qr" title="موقعیت کارخانه"><img src="${esc(co.qr_image)}" alt="QR کارخانه"></div>` : '';
  return `<div class="head"><div class="head-logos">${logos}</div><div class="info">${companyInfoLines(co)}</div>${qr}</div>`;
}
// NOTE: this bwip-js version exposes async toBuffer() and sync toSVG().
// We emit inline SVG so QR/barcodes survive print & PDF without base64 image round-trips.
function qrSvg(text, scale = 4) {
  try { return bwip.toSVG({ bcid: 'qrcode', text, scale, padding: 4, includetext: false }); }
  catch { return ''; }
}
function code128Svg(text, scale = 2) {
  try { return bwip.toSVG({ bcid: 'code128', text, scale, height: 40, padding: 8, includetext: true }); }
  catch { return ''; }
}
function baseHtml(title, body, co, opts = {}) {
  // UTF-8 BOM: guarantees correct encoding when the HTML is saved/opened outside the
  // browser (Word/Excel/plain file) — prevents Windows-1252/Latin-1 mis-decoding of Persian text
  const landscape = !!opts.landscape;
  const printMeta = opts.printMeta || null; // { at, user }
  const autoPrint = opts.autoPrint ? '<script>setTimeout(function(){ try{ window.print(); }catch(e){} }, 350);</script>' : '';
  return '\uFEFF' + `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @font-face { font-family: 'Vazirmatn'; src: url('/fonts/vazirmatn-var.woff2') format('woff2'); }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm 10mm 16mm 10mm; }
  body { font-family: 'Vazirmatn', Tahoma, sans-serif; margin: 0; padding: 24px; color: #1c1e22; background: #fff; }
  .doc { max-width: ${landscape ? 1050 : 900}px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; border-bottom: 3px solid #c9a227; padding-bottom: 16px; margin-bottom: 24px; page-break-after: avoid; }
  .head .head-logos { display: flex; gap: 12px; align-items: center; flex: 0 0 auto; }
  .head .head-logos img { height: 74px; width: auto; max-width: 150px; object-fit: contain; }
  .head .qr { flex: 0 0 auto; }
  .head .qr img { width: 76px; height: 76px; border: 1px solid #ddd; border-radius: 6px; padding: 3px; background: #fff; }
  .head .info { text-align: left; font-size: 11px; color: #555; line-height: 1.9; min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .head .info b { font-size: 14px; color: #1c1e22; }
  h1 { font-size: 20px; margin: 0 0 4px; page-break-after: avoid; }
  h2 { font-size: 15px; margin: 22px 0 8px; border-inline-start: 4px solid #c9a227; padding-inline-start: 8px; page-break-after: avoid; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 13px; margin-bottom: 20px; }
  .meta div { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dashed #ddd; padding: 6px 2px; page-break-inside: avoid; }
  .meta b { color: #555; font-weight: 500; flex: 0 0 auto; }
  .meta span { overflow-wrap: anywhere; text-align: left; }
  table.items { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 18px; }
  table.items th { background: #171a20; color: #fff; padding: 9px 8px; font-weight: 500; }
  table.items td { border-bottom: 1px solid #e5e2da; padding: 8px; text-align: center; overflow-wrap: anywhere; }
  table.items td.l { text-align: right; }
  table.items thead { display: table-header-group; }
  table.items tr { page-break-inside: avoid; }
  .totals { display: flex; justify-content: flex-start; margin-left: auto; margin-right: 0; width: 320px; font-size: 13px; page-break-inside: avoid; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
  .totals .grand { background: #171a20; color: #fff; font-weight: 700; padding: 9px 12px; border-radius: 8px; margin-top: 6px; }
  .footer { margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; color: #555; page-break-inside: avoid; }
  .sign { text-align: center; min-height: 60px; }
  .sign .line { border-top: 1px solid #999; width: 170px; margin-top: 44px; }
  .note { font-size: 11.5px; color: #666; margin-top: 18px; line-height: 1.9; }
  .badge { display: inline-block; background: #c9a22722; color: #8a6d14; border: 1px solid #c9a227; border-radius: 6px; padding: 2px 10px; font-size: 11px; }
  .genline { font-size: 11.5px; color: #777; margin-bottom: 14px; }
  /* fixed print footer: repeats on every printed page (real print info) */
  .print-foot { display: none; }
  @media print {
    body { padding: 0; }
    .print-foot { display: block; position: fixed; bottom: 0; left: 0; right: 0; border-top: 1px solid #ddd; padding: 6px 12px; font-size: 10px; color: #777; display: flex; justify-content: space-between; background: #fff; }
  }
</style></head><body>
${printMeta ? `<div class="print-foot"><span>${esc(title)}</span><span>چاپ‌شده: ${esc(printMeta.at)}${printMeta.user ? ' — توسط ' + esc(printMeta.user) : ''}</span></div>` : ''}
<div class="doc">${body}
</div>${autoPrint}</body></html>`;
}
function itemsTable(items) {
  const rows = items.map((it, i) => `<tr>
    <td>${faDigits(i + 1)}</td><td class="l">${esc(it.name)}</td>
    <td>${fmtNum(it.qty)}</td><td>${fmtNum(it.price)}</td>
    <td>${it.discount_pct ? faDigits(it.discount_pct) + '٪' : '—'}</td>
    <td>${fmtNum(it.line_total)}</td></tr>`).join('');
  return `<table class="items"><thead><tr><th>ردیف</th><th>شرح کالا / خدمت</th><th>تعداد</th><th>قیمت واحد (ریال)</th><th>تخفیف</th><th>جمع (ریال)</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function quoteHtml(id, opts = {}) {
  const d = get();
  const q = d.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) return null;
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(q.customer_id);
  const items = d.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id').all(id);
  const co = company();
  const body = `
  ${companyHeadHtml(co, !(opts && opts.header === false))}
  <h1>پیش‌فاکتور فروش <span class="badge">${esc(q.number)}</span></h1>
  <div class="meta">
    <div><b>تاریخ صدور:</b><span>${fmtDateLong(q.created_at)}</span></div>
    <div><b>اعتبار تا:</b><span>${q.valid_until ? fmtDateLong(q.valid_until) : '—'}</span></div>
    <div><b>مشتری:</b><span>${esc(c ? c.name : '')}</span></div>
    <div><b>آدرس:</b><span>${esc((c ? c.address : '') || '—')}</span></div>
    <div><b>کارشناس فروش:</b><span>${esc(q.salesperson_name || '—')}</span></div>
    <div><b>کد ملی / ثبت:</b><span>${esc(c ? c.tax_code : '—')}</span></div>
  </div>
  ${itemsTable(items)}
  <div class="totals">
    <div><b>جمع خالص:</b><span>${fmtNum(q.subtotal)} ریال</span></div>
    <div><b>تخفیف:</b><span>− ${fmtNum(q.subtotal * (q.discount_pct || 0) / 100)} ریال</span></div>
    <div><b>مالیات (${faDigits(q.tax_rate || 0)}٪):</b><span>${fmtNum((q.subtotal - q.subtotal * (q.discount_pct || 0) / 100) * (q.tax_rate || 0) / 100)} ریال</span></div>
    <div><b>حمل:</b><span>${fmtNum(q.shipping)} ریال</span></div>
    <div class="grand"><b>مبلغ کل قابل پرداخت</b><span>${fmtNum(q.total)} ریال</span></div>
  </div>
  ${q.notes ? `<div class="note"><b>توضیحات:</b> ${esc(q.notes)}</div>` : ''}
  <div class="footer"><div class="sign"><div class="line"></div>تأیید واحد فروش</div>
  <div style="text-align:center">${qrSvg(q.number) || ''}<div style="margin-top:4px">${esc(q.number)}</div></div>
  <div class="sign"><div class="line"></div>مهر و امضای مشتری</div></div>`;
  return baseHtml('پیش‌فاکتور ' + q.number, body, co, { landscape: !!(opts && opts.landscape), printMeta: opts && opts.printMeta, autoPrint: opts && opts.autoPrint });
}
function invoiceHtml(id, opts = {}) {
  const d = get();
  const inv = d.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!inv) return null;
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(inv.customer_id);
  const items = d.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(id);
  const co = company();
  const statusFa = { unpaid: 'پرداخت‌نشده', partial: 'پرداخت جزئی', paid: 'پرداخت‌شده', overdue: 'سررسید گذشته', cancelled: 'لغوشده' }[inv.status] || inv.status;
  const body = `
  ${companyHeadHtml(co, !(opts && opts.header === false))}
  <h1>فاکتور فروش <span class="badge">${esc(inv.number)}</span> <span class="badge" style="background:#171a2011;color:#333;border-color:#999">${esc(statusFa)}</span></h1>
  <div class="meta">
    <div><b>تاریخ صدور:</b><span>${fmtDateLong(inv.issue_date)}</span></div>
    <div><b>سررسید:</b><span>${inv.due_date ? fmtDateLong(inv.due_date) : '—'}</span></div>
    <div><b>مشتری:</b><span>${esc(c ? c.name : '')}</span></div>
    <div><b>آدرس:</b><span>${esc((c ? c.address : '') || '—')}</span></div>
    <div><b>شماره ثبت مالیاتی:</b><span>${esc(inv.tax_number || '—')}</span></div>
    <div><b>وضعیت سامانه مودیان:</b><span>${{ unsent: 'ارسال‌نشده', sent: 'ارسال‌شده', confirmed: 'تأییدشده', rejected: 'ردشده' }[inv.tax_system_status] || '—'}</span></div>
  </div>
  ${itemsTable(items)}
  <div class="totals">
    <div><b>جمع خالص:</b><span>${fmtNum(inv.subtotal)} ریال</span></div>
    <div><b>تخفیف:</b><span>− ${fmtNum(inv.discount)} ریال</span></div>
    <div><b>مالیات:</b><span>${fmtNum(inv.tax)} ریال</span></div>
    <div><b>حمل:</b><span>${fmtNum(inv.shipping)} ریال</span></div>
    <div class="grand"><b>مبلغ کل</b><span>${fmtNum(inv.total)} ریال</span></div>
  </div>
  <div class="note"><b>پرداخت‌شده:</b> ${fmtNum(inv.paid_amount)} ریال &nbsp;|&nbsp; <b>باقیمانده:</b> ${fmtNum(Math.max(0, inv.total - inv.paid_amount))} ریال</div>
  ${inv.notes ? `<div class="note"><b>توضیحات:</b> ${esc(inv.notes)}</div>` : ''}
  <div class="footer"><div class="sign"><div class="line"></div>تأیید واحد مالی</div>
  <div style="text-align:center">${qrSvg(inv.number) || ''}<div style="margin-top:4px">${esc(inv.number)}</div></div>
  <div class="sign"><div class="line"></div>مهر و امضا</div></div>`;
  return baseHtml('فاکتور ' + inv.number, body, co, { landscape: !!(opts && opts.landscape), printMeta: opts && opts.printMeta, autoPrint: opts && opts.autoPrint });
}
function labHtml(id, opts = {}) {
  const d = get();
  const r = d.prepare('SELECT * FROM lab_requests WHERE id=?').get(id);
  if (!r) return null;
  const c = r.customer_id ? d.prepare('SELECT * FROM customers WHERE id=?').get(r.customer_id) : null;
  const results = d.prepare('SELECT * FROM lab_results WHERE request_id=? ORDER BY id').all(id);
  const co = company();
  const rows = results.map((x, i) => `<tr><td>${faDigits(i + 1)}</td><td class="l">${esc(x.test_name)}</td><td>${esc(x.method || '—')}</td><td>${esc(x.result_value || '—')} ${esc(x.unit || '')}</td><td>${esc(x.spec_text || '—')}</td><td>${{ pass: 'مطابق', fail: 'نامطابق', pending: 'در انتظار' }[x.status] || '—'}</td></tr>`).join('');
  const overall = results.length && results.every(x => x.status === 'pass') ? 'مطابق' : results.some(x => x.status === 'fail') ? 'نامطابق' : 'در انتظار تکمیل';
  const body = `
  ${companyHeadHtml(co, !(opts && opts.header === false))}
  <h1>گزارش نتایج آزمایش <span class="badge">${esc(r.number)}</span> <span class="badge" style="background:#171a2011;border-color:#999">${esc(overall)}</span></h1>
  <div class="meta">
    <div><b>مشتری:</b><span>${esc(c ? c.name : '—')}</span></div>
    <div><b>نمونه:</b><span>${esc(r.sample_desc || '—')}</span></div>
    <div><b>کد نمونه:</b><span>${esc(r.sample_code || '—')}</span></div>
    <div><b>نوع آزمون:</b><span>${esc(r.test_type || '—')}</span></div>
    <div><b>تاریخ دریافت:</b><span>${fmtDateLong(r.received_at)}</span></div>
    <div><b>تاریخ گزارش:</b><span>${fmtDateLong(r.report_generated_at || r.updated_at)}</span></div>
  </div>
  <table class="items"><thead><tr><th>ردیف</th><th>آزمون</th><th>روش</th><th>نتیجه</th><th>محدوده مجاز</th><th>نتیجه نهایی</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="note">شرایط نگهداری نمونه: ${esc(r.notes || '—')}<br>این گزارش صرفاً مربوط به نمونه‌ای است که به آزمایشگاه تحویل شده است.</div>
  <div class="footer"><div class="sign"><div class="line"></div>مسئول آزمایشگاه</div>
  <div style="text-align:center">${qrSvg(r.number) || ''}<div style="margin-top:4px">${esc(r.number)}</div></div>
  <div class="sign"><div class="line"></div>مدیر کیفیت</div></div>`;
  return baseHtml('گزارش آزمایش ' + r.number, body, co, { landscape: !!(opts && opts.landscape), printMeta: opts && opts.printMeta, autoPrint: opts && opts.autoPrint });
}
function contractHtml(id, opts = {}) {
  const d = get();
  const c = d.prepare('SELECT * FROM contracts WHERE id=?').get(id);
  if (!c) return null;
  const cust = c.customer_id ? d.prepare('SELECT * FROM customers WHERE id=?').get(c.customer_id) : null;
  const co = company();
  const body = `
  ${companyHeadHtml(co, !(opts && opts.header === false))}
  <h1>قرارداد ${esc(c.type === 'sales' ? 'فروش' : c.type === 'service' ? 'خدمات' : 'مخصوص')} <span class="badge">${esc(c.number)}</span></h1>
  <div class="meta">
    <div><b>عنوان:</b><span>${esc(c.title)}</span></div>
    <div><b>طرف قرارداد:</b><span>${esc(cust ? cust.name : '—')}</span></div>
    <div><b>تاریخ شروع:</b><span>${c.start_date ? fmtDateLong(c.start_date) : '—'}</span></div>
    <div><b>تاریخ پایان:</b><span>${c.end_date ? fmtDateLong(c.end_date) : '—'}</span></div>
    <div><b>مبلغ قرارداد:</b><span>${fmtNum(c.value)} ریال</span></div>
    <div><b>وضعیت:</b><span>${esc(c.status)}</span></div>
  </div>
  <div class="note">${esc(c.notes || '')}</div>
  <div class="footer"><div class="sign"><div class="line"></div>طرف اول: ${esc(co.name)}</div><div class="sign"><div class="line"></div>طرف دوم: ${esc(cust ? cust.name : '')}</div></div>`;
  return baseHtml('قرارداد ' + c.number, body, co, { landscape: !!(opts && opts.landscape), printMeta: opts && opts.printMeta, autoPrint: opts && opts.autoPrint });
}
function orderHtml(id, opts = {}) {
  const d = get();
  const o = d.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o) return null;
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(o.customer_id);
  const q = o.quote_id ? d.prepare('SELECT number FROM quotes WHERE id=?').get(o.quote_id) : null;
  const items = d.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id);
  const co = company();
  const statusFa = { draft: 'پیش‌نویس', confirmed: 'تأییدشده', in_production: 'در حال تولید', ready: 'آماده ارسال', shipped: 'ارسال‌شده', delivered: 'تحویل‌شده', cancelled: 'لغوشده', returned: 'بازگشتی' }[o.status] || o.status;
  const rows = items.map((it, i) => `<tr><td>${faDigits(i + 1)}</td><td class="l">${esc(it.name)}</td><td>${fmtNum(it.qty)}</td><td>${fmtNum(it.price)}</td><td>${it.discount_pct ? faDigits(it.discount_pct) + '٪' : '—'}</td><td>${fmtNum(it.line_total)}</td></tr>`).join('');
  const body = `
  ${companyHeadHtml(co, !(opts && opts.header === false))}
  <h1>سفارش خرید / فروش <span class="badge">${esc(o.number)}</span> <span class="badge" style="background:#171a2011;color:#333;border-color:#999">${esc(statusFa)}</span></h1>
  <div class="meta">
    <div><b>تاریخ سفارش:</b><span>${fmtDateLong(o.order_date)}</span></div>
    <div><b>تاریخ تحویل:</b><span>${o.due_date ? fmtDateLong(o.due_date) : '—'}</span></div>
    <div><b>مشتری:</b><span>${esc(c ? c.name : '')}</span></div>
    <div><b>پیش‌فاکتور مبدأ:</b><span>${q ? esc(q.number) : '—'}</span></div>
    <div><b>آدرس تحویل:</b><span>${esc(o.delivery_address || '—')}</span></div>
    <div><b>مسئول فروش:</b><span>${esc(d.prepare('SELECT full_name FROM users WHERE id=?').get(o.salesperson_id)?.full_name || '—')}</span></div>
  </div>
  <table class="items"><thead><tr><th>ردیف</th><th>شرح کالا / خدمت</th><th>تعداد</th><th>قیمت واحد (ریال)</th><th>تخفیف</th><th>جمع (ریال)</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div class="grand"><b>مبلغ کل سفارش</b><span>${fmtNum(o.total)} ریال</span></div></div>
  ${o.notes ? `<div class="note"><b>توضیحات:</b> ${esc(o.notes)}</div>` : ''}
  <div class="footer"><div class="sign"><div class="line"></div>تأیید واحد فروش</div>
  <div style="text-align:center">${code128Svg(o.number) || ''}<div style="margin-top:4px">${esc(o.number)}</div></div>
  <div class="sign"><div class="line"></div>مهر و امضای مشتری</div></div>`;
  return baseHtml('سفارش ' + o.number, body, co, { landscape: !!(opts && opts.landscape), printMeta: opts && opts.printMeta, autoPrint: opts && opts.autoPrint });
}
// ================= Central document service (registry + generic templates) =================
// Rich, hand-crafted templates for the classic documents; everything else falls back
// to the data-driven generic record template (built from the resource registry).
const { R } = require('../api/resources');

// generic value rendering per field type (Jalali dates, Persian numerals, ref names)
function fieldValueHtml(f, it) {
  let v = it[f.key];
  if (f.type === 'ref') { v = it[f.key + '_name'] || (v ? '#' + v : null); return v ? esc(String(v)) : ''; }
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'date') return fmtDate(v);
  if (f.type === 'datetime') return fmtDate(v, { time: true });
  if (f.type === 'money') return fmtNum(v) + ' ریال';
  if (f.type === 'number') return fmtNum(v);
  if (f.type === 'bool') return v ? 'بله' : 'خیر';
  if (f.type === 'select' && Array.isArray(f.options)) {
    const o = f.options.find(o => (typeof o === 'object' ? o.v : o) === v);
    if (o) return esc(typeof o === 'object' ? o.l : o);
  }
  if (f.type === 'textarea' || String(v).includes('\n')) return esc(String(v)).replace(/\n/g, '<br>');
  return esc(String(v));
}
// per-entity related tables for the generic record document (all real DB data)
const RELATED = {
  customer: (d, it) => {
    const cts = d.prepare('SELECT * FROM customer_contacts WHERE customer_id=? ORDER BY is_primary DESC, id').all(it.id);
    if (!cts.length) return '';
    return `<h2>مخاطبین</h2><table class="items"><thead><tr><th>نام</th><th>سمت</th><th>موبایل</th><th>تلفن</th><th>ایمیل</th><th>اصلی</th></tr></thead><tbody>` +
      cts.map(c => `<tr><td class="l">${esc(c.name)}</td><td class="l">${esc(c.position || '—')}</td><td>${esc(c.mobile || '—')}</td><td>${esc(c.phone || '—')}</td><td>${esc(c.email || '—')}</td><td>${c.is_primary ? 'بله' : 'خیر'}</td></tr>`).join('') + '</tbody></table>';
  },
  followup: (d, it) => {
    const ats = d.prepare('SELECT fa.*, u.full_name user_name FROM followup_attempts fa LEFT JOIN users u ON u.id=fa.user_id WHERE fa.followup_id=? ORDER BY fa.id').all(it.id);
    if (!ats.length) return '';
    const mFa = { call: 'تماس تلفنی', meeting: 'جلسه', email: 'ایمیل', message: 'پیام', visit: 'بازدید حضوری', other: 'سایر' };
    return `<h2>تاریخچه پیگیری‌ها (${ats.length})</h2><table class="items"><thead><tr><th>تاریخ</th><th>نحوه</th><th>نتیجه</th><th>توضیحات</th><th>کاربر</th><th>پیگیری بعدی</th></tr></thead><tbody>` +
      ats.map(a => `<tr><td>${fmtDate(a.acted_at, { time: true })}</td><td>${mFa[a.method] || a.method}</td><td class="l">${esc(a.result || '—')}</td><td class="l">${esc(a.note || '—')}</td><td>${esc(a.user_name || '—')}</td><td>${a.next_followup_at ? fmtDate(a.next_followup_at, { time: true }) : '—'}</td></tr>`).join('') + '</tbody></table>';
  },
  meeting: (d, it) => {
    const pids = String(it.participant_ids || '').split(',').map(x => Number(x.trim())).filter(Boolean);
    if (!pids.length) return '';
    const us = d.prepare('SELECT full_name FROM users WHERE id IN (' + pids.map(() => '?').join(',') + ')').all(...pids);
    return `<h2>اعضای داخلی شرکت</h2><div style="font-size:13px">${us.map(u => esc(u.full_name)).join('، ')}</div>`;
  },
  opportunity: (d, it) => {
    const items = d.prepare('SELECT * FROM opportunity_items WHERE opportunity_id=? ORDER BY id').all(it.id);
    if (!items.length) return '';
    return `<h2>اقلام فرصت فروش</h2><table class="items"><thead><tr><th>ردیف</th><th>شرح</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody>` +
      items.map((x, i) => `<tr><td>${faDigits(i + 1)}</td><td class="l">${esc(x.name)}</td><td>${fmtNum(x.qty)}</td><td>${fmtNum(x.price)}</td><td>${fmtNum(x.qty * x.price)}</td></tr>`).join('') + '</tbody></table>';
  },
  payment: (d, it) => {
    const inv = it.invoice_id ? d.prepare('SELECT number, customer_id, total FROM invoices WHERE id=?').get(it.invoice_id) : null;
    if (!inv) return '';
    const c = d.prepare('SELECT name FROM customers WHERE id=?').get(inv.customer_id);
    return `<h2>فاکتور مرتبط</h2><div class="meta"><div><b>شماره فاکتور:</b><span>${esc(inv.number)}</span></div><div><b>مشتری:</b><span>${esc(c ? c.name : '—')}</span></div><div><b>مبلغ فاکتور:</b><span>${fmtNum(inv.total)} ریال</span></div><div><b>وضعیت پرداخت این تراکنش:</b><span>${esc(it.status || '—')}</span></div></div>`;
  },
  complaint: (d, it) => {
    const evs = d.prepare('SELECT * FROM complaint_events WHERE complaint_id=? ORDER BY id').all(it.id);
    if (!evs.length) return '';
    return `<h2>رویدادها</h2><table class="items"><thead><tr><th>تاریخ</th><th>رویداد</th><th>توضیح</th></tr></thead><tbody>` +
      evs.map(e => `<tr><td>${fmtDate(e.created_at, { time: true })}</td><td class="l">${esc(e.note || e.type || '—')}</td><td class="l">${esc(e.description || '—')}</td></tr>`).join('') + '</tbody></table>';
  },
  product: (d, it) => {
    const low = it.reorder_point > 0 && it.stock_qty <= it.reorder_point;
    const over = it.max_stock > 0 && it.stock_qty > it.max_stock;
    return `<h2>وضعیت موجودی</h2><div class="meta"><div><b>موجودی فعلی:</b><span>${fmtNum(it.stock_qty)} ${esc(it.unit || '')}</span></div><div><b>حد سفارش مجدد:</b><span>${fmtNum(it.reorder_point || 0)}</span></div><div><b>حداکثر:</b><span>${fmtNum(it.max_stock || 0)}</span></div><div><b>وضعیت:</b><span>${low ? '⚠ کمبود' : over ? '⚠ بیش از حد' : 'معمول'}</span></div></div>`;
  },
  contract: null, // rich template exists
  warranty: (d, it) => {
    const c = it.customer_id ? d.prepare('SELECT name FROM customers WHERE id=?').get(it.customer_id) : null;
    if (!c) return '';
    return `<h2>مشتری</h2><div style="font-size:13px">${esc(c.name)}</div>`;
  },
  quote: null, order: null, invoice: null, lab_request: null, // rich templates
};
function recordHtml(entity, id, opts = {}) {
  const spec = R[entity];
  if (!spec) return null;
  const d = get();
  let it = null;
  try { it = d.prepare(`SELECT * FROM ${spec.table} WHERE id=?`).get(id); } catch { it = null; }
  if (!it) return null;
  const co = company();
  const titleFa = (spec.nameFa || entity).replace(/ها$/, '') + (it.number ? ' — ' + it.number : ' — ' + (it.name || it.title || '#' + id));
  const head = companyHeadHtml(co, !(opts && opts.header === false));
  const fields = spec.fields.filter(f => !['id', 'custom_fields'].includes(f.key) && f.key !== 'archived_at');
  const cells = [];
  for (const f of fields) {
    const v = fieldValueHtml(f, it);
    if (!v) continue;
    cells.push(`<div><b>${esc(f.label)}:</b><span>${v}</span></div>`);
  }
  let related = '';
  if (RELATED[entity]) { try { related = RELATED[entity](d, it) || ''; } catch { related = ''; } }
  const body = `${head}
  <h1>${esc(titleFa)}</h1>
  <div class="genline">تاریخ تولید: ${fmtDateLong(nowIso())}${opts.printUser ? ' — کاربر: ' + esc(opts.printUser) : ''}</div>
  ${cells.length ? `<div class="meta">${cells.join('')}</div>` : ''}
  ${related}
  <div class="footer"><div class="sign"><div class="line"></div>امضا و تأیید</div><div style="text-align:center">${qrSvg(it.number || String(it.id)) || ''}<div style="margin-top:4px">${esc(it.number || '#' + it.id)}</div></div><div class="sign"><div class="line"></div>بازرس / مسئول واحد</div></div>`;
  return baseHtml(titleFa, body, co, { landscape: !!opts.landscape, printMeta: opts.printMeta, autoPrint: opts.autoPrint });
}
function listDocHtml(entity, rows, opts = {}) {
  const spec = R[entity] || null;
  const co = company();
  const title = opts.title || (spec ? spec.nameFa : entity);
  const fields = spec ? spec.fields.filter(f => f.list && !['id'].includes(f.key)) : [];
  const headers = (opts.headers && opts.headers.length ? opts.headers : fields.map(f => f.label));
  const head = companyHeadHtml(co, !(opts.header === false));
  const rowsHtml = rows.map((r, i) => {
    let cells;
    if (opts.renderRow) cells = opts.renderRow(r);
    else if (spec) cells = fields.map(f => ' ' + fieldValueHtml(f, r));
    else cells = headers.map((_, hi) => ' ' + esc(String(r[hi] ?? '')));
    return '<tr><td>' + faDigits(i + 1) + '</td>' + cells.join('') + '</tr>';
  }).join('');
  const body = `${head}
  <h1>${esc(title)}</h1>
  <div class="genline">تاریخ تولید: ${fmtDateLong(nowIso())} — تعداد ردیف: ${faDigits(rows.length)}${opts.printUser ? ' — کاربر: ' + esc(opts.printUser) : ''}</div>
  <table class="items"><thead><tr><th>ردیف</th>${headers.map(h => '<th>' + esc(h) + '</th>').join('')}</tr></thead><tbody>${rowsHtml || '<tr><td colspan="99">— رکوردی یافت نشد —</td></tr>'}</tbody></table>
  <div class="footer"><div class="sign"><div class="line"></div>تهیه‌کننده گزارش</div><div style="text-align:center">${qrSvg(title + '-' + nowIso().slice(0, 10)) || ''}</div><div class="sign"><div class="line"></div>تأیید مدیریت</div></div>`;
  return baseHtml(title, body, co, { landscape: !!opts.landscape, printMeta: opts.printMeta, autoPrint: opts.autoPrint });
}
// central dispatcher: rich template if present, otherwise the generic record document
function getDocHtml(entity, id, opts = {}) {
  const rich = { quote: quoteHtml, invoice: invoiceHtml, order: orderHtml, lab_request: labHtml, contract: contractHtml };
  if (rich[entity]) {
    const html = rich[entity](id, opts);
    if (html) return html;
  }
  return recordHtml(entity, id, opts);
}
module.exports = { baseHtml, quoteHtml, invoiceHtml, orderHtml, labHtml, contractHtml, company, companyHeadHtml, companyInfoLines, recordHtml, listDocHtml, getDocHtml, fieldValueHtml };
