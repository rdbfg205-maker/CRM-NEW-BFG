// Section 8 — Inventory & Warehouse (موجودی کالا و انبار): real-HTTP end-to-end test suite (no mocks).
// Controlled data through the real API; ground truth from SQLite; cleans up at the end.
// Covers: 1) ورود  2) خروج  3) انتقال  4) Search  5) Filter/Sort  6) حداقل/حداکثر + هشدار کمبود
//         7) Duplicate Check + Permission  8) Permission/Row Scope  9) Export  10) Audit Log
//         + integration with Product Master / Purchase (PO receive) / Sales (invoice stock-out)
//         + DB integrity (integrity_check / foreign_key_check / stock conservation)
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'S8' + String(Date.now()).slice(-5);
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function fetchRetry(url, opts, tries = 6) {
  for (let i = 1; ; i++) {
    const r = await fetch(url, opts);
    if ((r.status !== 429 && r.status < 500) || i >= tries) return r;
    const ra = parseInt(r.headers.get('retry-after') || '', 10);
    await sleep(Number.isFinite(ra) && ra >= 0 ? ra * 1000 : Math.min(2000, 300 * 2 ** (i - 1)) + Math.floor(Math.random() * 250));
  }
}
// req(method, path, a, b): for GET/DELETE, `a` is the token; for POST/PUT, `a` is body and `b` is token
async function req(method, path, a, b) {
  const isGet = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  const body = isGet ? undefined : a;
  const token = isGet ? a : b;
  const h = {};
  if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetchRetry(BASE + path, { method, headers: h, body: (body !== undefined && body !== null) ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t, headers: r.headers };
}
const exportGet = async (path, tok) => {
  const h = {}; if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetchRetry(BASE + path, { headers: h });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null; try { data = JSON.parse(buf.toString('utf8')); } catch { /* binary/html */ }
  return { status: r.status, buf, data, ct: r.headers.get('content-type') || '', text: buf.toString('utf8') };
};
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const qa = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };
const stock = (id) => q1('SELECT stock_qty FROM products WHERE id=?', id).stock_qty;

// ---------- logins ----------
const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }
const M = (await req('POST', '/api/auth/login', { username: 'saeid.t', password: '12345678' })).data.access; // lab role: no product/stock/PO perms
if (!M) { console.log('FATAL: saeid.t login failed'); process.exit(2); }

// ---------- controlled test data (real API) ----------
const G = {};
try {
  G.cat = (await req('POST', '/api/r/product_categories', { name: 'دسته S8 ' + STAMP }, A)).data.id;
  ok('data: product category created', !!G.cat, 'id=' + G.cat);
  const c1 = (await req('POST', '/api/r/customer', { name: 'مشتری S8 ' + STAMP, type: 'company' }, A)).data.id;
  G.cust = c1;
  const p1 = (await req('POST', '/api/r/product', { code: 'S8P1-' + STAMP.slice(2), name: 'کالای انبار S8P1 ' + STAMP, unit: 'عدد', category_id: G.cat, reorder_point: 30, max_stock: 150 }, A)).data.id;
  G.p1 = p1; G.p1Code = 'S8P1-' + STAMP.slice(2); G.p1Name = 'کالای انبار S8P1 ' + STAMP;
  const p2 = (await req('POST', '/api/r/product', { code: 'S8P2-' + STAMP.slice(2), name: 'ماده اولیه S8P2 ' + STAMP, unit: 'کیلوگرم', is_raw_material: 1 }, A)).data.id;
  G.p2 = p2; G.p2Code = 'S8P2-' + STAMP.slice(2);
  const p3 = (await req('POST', '/api/r/product', { code: 'S8P3-' + STAMP.slice(2), name: 'کالای بدون انبار S8P3 ' + STAMP, unit: 'عدد' }, A)).data.id;
  G.p3 = p3;
  ok('data: 3 products created (tracked / raw / untracked)', !!(p1 && p2 && p3), `p1=${p1} p2=${p2} p3=${p3}`);
  ok('data: products start at stock 0', stock(p1) === 0 && stock(p2) === 0 && stock(p3) === 0, `p1=${stock(p1)} p2=${stock(p2)} p3=${stock(p3)}`);
  const sup = (await req('POST', '/api/r/supplier', { name: 'تامین S8 ' + STAMP }, A)).data.id;
  G.sup = sup;
  const po1 = (await req('POST', '/api/r/purchase_order', { supplier_id: sup, status: 'sent' }, A)).data.id;
  G.po1 = po1;
  await req('PUT', `/api/r/purchase_order/${po1}/items`, { items: [
    { product_id: p1, name: 'ردیف PO1 A', qty: 10, price: 1000 },
    { product_id: p2, name: 'ردیف PO1 B', qty: 4, price: 500 },
  ] }, A);
  const po2 = (await req('POST', '/api/r/purchase_order', { supplier_id: sup, status: 'sent' }, A)).data.id;
  G.po2 = po2;
  await req('PUT', `/api/r/purchase_order/${po2}/items`, { items: [{ product_id: p1, name: 'ردیف PO2', qty: 5, price: 1000 }] }, A);
  G.po2Item = qa('SELECT id FROM po_items WHERE po_id=?', po2)[0].id;
  ok('data: supplier + 2 POs with items created', !!(sup && po1 && po2), `po1=${po1} po2=${po2}`);

  // ============ 7) Duplicate Check + product permission ============
  let r = await req('POST', '/api/r/product', { code: G.p1Code, name: 'کالای تکراری ' + STAMP, unit: 'عدد' }, A);
  ok('D1 duplicate product code → 409 DUPLICATE', r.status === 409 && r.data.error?.code === 'DUPLICATE', `status=${r.status}`);
  r = await req('POST', '/api/r/product', { name: 'کالای بی‌کد ' + STAMP, unit: 'عدد' }, M);
  ok('D2 product create without product:create (lab role) → 403', r.status === 403, `status=${r.status}`);
  r = await req('GET', '/api/r/product?per_page=1', M);
  ok('D3 product list without product:view (lab role) → 403', r.status === 403, `status=${r.status}`);

  // ============ 1) ورود کالا (stock in) ============
  r = await req('POST', '/api/stock/move', { product_id: p1, type: 'in', qty: 100, note: 'ورود انبار S8' }, A);
  ok('I1 stock in 100 → new_stock=100', r.status === 200 && r.data.new_stock === 100, JSON.stringify(r.data).slice(0, 100));
  const txIn = qa('SELECT * FROM stock_transactions WHERE product_id=? AND type=?', p1, 'in');
  ok('I2 movement row recorded (type=in, qty=100, user)', txIn.length === 1 && txIn[0].qty === 100 && txIn[0].user_id === 1, JSON.stringify(txIn[0] || {}).slice(0, 120));

  // ============ 2) خروج کالا (stock out) ============
  r = await req('POST', '/api/stock/move', { product_id: p1, type: 'out', qty: 40, note: 'خروج فروش S8' }, A);
  ok('O1 stock out 40 → new_stock=60', r.status === 200 && r.data.new_stock === 60, JSON.stringify(r.data).slice(0, 100));
  r = await req('POST', '/api/stock/move', { product_id: p1, type: 'out', qty: 999 }, A);
  ok('O2 stock out beyond on-hand → 400 STOCK_INSUFFICIENT', r.status === 400 && r.data.error?.code === 'STOCK_INSUFFICIENT', `status=${r.status}`);
  ok('O3 insufficient out did NOT change stock (60)', stock(p1) === 60 && q1('SELECT COUNT(*) c FROM stock_transactions WHERE product_id=?', p1).c === 2, `stock=${stock(p1)}`);

  // ============ 3) انتقال کالا (transfer) ============
  r = await req('POST', '/api/stock/move', { product_id: p1, type: 'transfer', qty: 25, note: 'انتقال بین انبارها S8' }, A);
  ok('X1 transfer 25 → recorded, total stock unchanged (60)', r.status === 200 && r.data.new_stock === 60 && stock(p1) === 60, JSON.stringify(r.data).slice(0, 100));
  const txTr = qa('SELECT * FROM stock_transactions WHERE product_id=? AND type=?', p1, 'transfer');
  ok('X2 transfer row recorded (type=transfer, qty=25)', txTr.length === 1 && txTr[0].qty === 25, JSON.stringify(txTr[0] || {}).slice(0, 120));

  // ============ 6) حداقل/حداکثر + هشدار کمبود (auto alerts) ============
  r = await req('POST', '/api/stock/move', { product_id: p1, type: 'out', qty: 35 }, A); // 60 → 25 ≤ reorder 30
  ok('A1 stock below reorder point (25 ≤ 30) → new_stock=25', r.status === 200 && r.data.new_stock === 25, JSON.stringify(r.data).slice(0, 80));
  let al = qa('SELECT * FROM stock_alerts WHERE product_id=? AND level=? AND resolved_at IS NULL', p1, 'reorder');
  ok('A2 low-stock alert auto-created (reorder, unresolved, product in message)', al.length === 1 && (al[0].message || '').includes(G.p1Name), JSON.stringify(al[0] || {}).slice(0, 140));
  r = await req('POST', '/api/stock/move', { product_id: p1, type: 'in', qty: 150 }, A); // 25 → 175 > max 150
  ok('A3 stock above max (175 > 150) → new_stock=175', r.status === 200 && r.data.new_stock === 175, JSON.stringify(r.data).slice(0, 80));
  al = qa('SELECT * FROM stock_alerts WHERE product_id=? AND level=? AND resolved_at IS NULL', p1, 'max');
  ok('A4 over-max alert auto-created (max, unresolved)', al.length === 1 && (al[0].message || '').includes(G.p1Name), JSON.stringify(al[0] || {}).slice(0, 140));
  G.alertReorder = qa('SELECT id FROM stock_alerts WHERE product_id=? AND level=?', p1, 'reorder')[0].id;
  G.alertMax = qa('SELECT id FROM stock_alerts WHERE product_id=? AND level=?', p1, 'max')[0].id;

  // ============ 4) Search (نام / کد / دسته) ============
  r = await req('GET', '/api/r/product?q=' + encodeURIComponent(G.p1Code), A);
  ok('S1 product search by CODE finds the product', r.status === 200 && r.data.items.length === 1 && r.data.items[0].id === p1, `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/product?q=' + encodeURIComponent(G.p1Name), A);
  ok('S2 product search by NAME finds the product', r.status === 200 && r.data.items.some(i => i.id === p1), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/product?q=' + encodeURIComponent('دسته S8 ' + STAMP), A);
  ok('S3 product search by CATEGORY name finds the product', r.status === 200 && r.data.items.some(i => i.id === p1) && !r.data.items.some(i => i.id === p2), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/stock_transaction?q=' + encodeURIComponent(G.p1Name), A);
  ok('S4 movements search by product name (server-side)', r.status === 200 && r.data.items.length >= 3 && r.data.items.every(i => i.product_id === p1), `n=${r.data.items?.length}`);

  // ============ 5) Filter + Sort ============
  r = await req('GET', '/api/r/product?per_page=300&f_category_id=' + G.cat, A);
  ok('F1 category filter (f_category_id) → only the categorized product', r.status === 200 && r.data.items.some(i => i.id === p1) && !r.data.items.some(i => i.id === p2), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/product?per_page=300&f_is_raw_material=1', A);
  ok('F2 raw-material filter → raw product yes, tracked product no', r.status === 200 && r.data.items.some(i => i.id === p2) && !r.data.items.some(i => i.id === p1), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/product?per_page=500&sort=code:asc', A);
  const order = (r.data.items || []).map(i => i.code);
  ok('F3 sort by code asc → P1 < P2 < P3 order', r.status === 200 && order.indexOf('S8P1-' + STAMP.slice(2)) >= 0 && order.indexOf('S8P1-' + STAMP.slice(2)) < order.indexOf('S8P2-' + STAMP.slice(2)) && order.indexOf('S8P2-' + STAMP.slice(2)) < order.indexOf('S8P3-' + STAMP.slice(2)), JSON.stringify(order.filter(c => String(c).startsWith('S8P'))));
  r = await req('GET', '/api/r/stock_transaction?f_type=in&q=' + encodeURIComponent(G.p1Name), A);
  ok('F4 movements type filter (f_type=in) → only inbound rows (100 + 150)', r.status === 200 && r.data.items.length === 2 && r.data.items.every(i => i.type === 'in') && r.data.items.some(i => i.qty === 100) && r.data.items.some(i => i.qty === 150), `n=${r.data.items?.length}`);

  // ============ Purchase integration: PO receive → stock in ============
  r = await req('POST', `/api/purchase_orders/${po1}/receive`, {}, A);
  ok('P1 PO receive (full) → status=received', r.status === 200 && r.data.status === 'received', JSON.stringify(r.data).slice(0, 100));
  ok('P2 PO receive added stock (P1 +10 → 185, P2 +4 → 4)', stock(p1) === 185 && stock(p2) === 4, `p1=${stock(p1)} p2=${stock(p2)}`);
  const poTx = qa('SELECT * FROM stock_transactions WHERE ref_type=? AND ref_id=?', 'purchase_order', po1);
  ok('P3 PO receive movements recorded with ref (2 rows, type=in)', poTx.length === 2 && poTx.every(t => t.type === 'in') && poTx.some(t => t.qty === 10) && poTx.some(t => t.qty === 4), JSON.stringify(poTx.map(t => t.qty)));
  r = await req('POST', `/api/purchase_orders/${po1}/receive`, {}, A);
  ok('P4 second receive on received PO → 400 BAD_STATE', r.status === 400 && r.data.error?.code === 'BAD_STATE', `status=${r.status}`);
  r = await req('POST', `/api/purchase_orders/${po2}/receive`, { qty: { [G.po2Item]: 2 } }, A);
  ok('P5 partial receive (2 of 5) → status=partial, P1 +2 → 187', r.status === 200 && r.data.status === 'partial' && stock(p1) === 187, `stock=${stock(p1)}`);
  r = await req('POST', `/api/purchase_orders/${po2}/receive`, {}, A);
  ok('P6 receive remainder (3) → status=received, P1 +3 → 190', r.status === 200 && r.data.status === 'received' && stock(p1) === 190, `stock=${stock(p1)}`);

  // ============ Sales integration: invoice → stock out ============
  const qId = (await req('POST', '/api/r/quote', { customer_id: c1 }, A)).data.id;
  G.quote = qId;
  await req('PUT', `/api/r/quote/${qId}/items`, { items: [
    { product_id: p1, name: 'ردیف فروش A', qty: 2, price: 1000 },
    { product_id: p3, name: 'ردیف فروش U', qty: 3, price: 2000 },
  ] }, A);
  const o1 = (await req('POST', `/api/quotes/${qId}/to-order`, {}, A)).data.order_id;
  G.order = o1;
  const inv = (await req('POST', `/api/orders/${o1}/to-invoice`, {}, A)).data.invoice_id;
  G.invoice = inv;
  ok('V1 invoice created from order (real sales flow)', !!inv, 'invoice=' + inv);
  ok('V2 tracked item stock-out on invoice (P1 190 → 188)', stock(p1) === 188, `stock=${stock(p1)}`);
  const invTx = qa('SELECT * FROM stock_transactions WHERE ref_type=? AND ref_id=?', 'invoice', inv);
  ok('V3 stock-out movement with invoice ref (type=out, qty=-2)', invTx.length === 1 && invTx[0].type === 'out' && invTx[0].qty === -2, JSON.stringify(invTx[0] || {}).slice(0, 100));
  ok('V4 untracked item NOT touched (P3 stays 0, no movement)', stock(p3) === 0 && q1('SELECT COUNT(*) c FROM stock_transactions WHERE product_id=?', p3).c === 0, `stock=${stock(p3)}`);

  // ============ resolve alerts ============
  r = await req('PUT', `/api/r/stock_alert/${G.alertReorder}`, { resolved_at: new Date().toISOString() }, A);
  const r2 = await req('PUT', `/api/r/stock_alert/${G.alertMax}`, { resolved_at: new Date().toISOString() }, A);
  const al2 = qa('SELECT * FROM stock_alerts WHERE product_id=?', p1);
  ok('A5 both alerts resolvable → resolved_at set', r.status === 200 && r2.status === 200 && al2.length === 2 && al2.every(a => a.resolved_at), JSON.stringify(al2.map(a => !!a.resolved_at)));

  // ============ 10) Audit Log ============
  const auditMoves = qa(`SELECT * FROM audit_logs WHERE entity='stock_transaction' AND old_value LIKE ? ORDER BY id`, '%' + G.p1Name + '%');
  ok('U1 audit rows exist for in/out/transfer moves (≥3)', auditMoves.length >= 3, `n=${auditMoves.length}`);
  const audIn = auditMoves.find(x => JSON.parse(x.old_value || '{}').type === 'in');
  const audOut = auditMoves.find(x => JSON.parse(x.old_value || '{}').type === 'out');
  ok('U2 audit payload carries before/after stock + qty', !!audIn && audIn.new_value.includes('after_stock') && !!audOut && audOut.old_value.includes('before_stock'), (audIn?.old_value || '').slice(0, 120));
  const audRecv = qa("SELECT * FROM audit_logs WHERE entity='purchase_order' AND action='receive' AND entity_id IN (?,?)", po1, po2);
  ok('U3 PO receive audited (3 receive actions: 1 full + 2 partial, with status)', audRecv.length === 3 && audRecv.every(x => (x.new_value || '').includes('status')), `n=${audRecv.length}`);
  // product edit → adjust movement + audit
  const beforeAdj = stock(p1);
  r = await req('PUT', `/api/r/product/${p1}`, { stock_qty: beforeAdj - 10 }, A);
  const adjTx = qa('SELECT * FROM stock_transactions WHERE product_id=? AND type=? ORDER BY id DESC', p1, 'adjust');
  const audAdj = qa("SELECT * FROM audit_logs WHERE entity='stock_transaction' AND action='adjust' ORDER BY id DESC");
  ok('U4 product stock edit → adjust movement + audit (diff=-10)', r.status === 200 && stock(p1) === beforeAdj - 10 && adjTx.length >= 1 && adjTx[0].qty === -10 && audAdj.length >= 1, `stock=${stock(p1)}`);

  // ============ 9) Export (XLSX / CSV / JSON / HTML-PDF) with filters ============
  let e = await exportGet('/api/stock/movements/export?format=json&q=' + encodeURIComponent(G.p1Name), A);
  const mvRows = e.data?.sheets?.['گردش موجودی'] || [];
  ok('E1 movements JSON export: only searched product rows, Jalali date', e.status === 200 && mvRows.length >= 8 && mvRows.every(x => x['کالا'] === G.p1Name) && /1405-\d\d-\d\d/.test(String(mvRows[0]['تاریخ (شمسی)'])), `rows=${mvRows.length} date=${mvRows[0] ? mvRows[0]['تاریخ (شمسی)'] : '—'}`);
  e = await exportGet('/api/stock/movements/export?format=json&q=' + encodeURIComponent('ناموجود' + STAMP), A);
  ok('E2 movements JSON export respects non-matching search → 0 rows', e.status === 200 && (e.data?.sheets?.['گردش موجودی'] || []).length === 0, 'rows=' + (e.data?.sheets?.['گردش موجودی'] || []).length);
  e = await exportGet('/api/stock/movements/export?format=xlsx&q=' + encodeURIComponent(G.p1Name), A);
  ok('E3 movements XLSX export (PK magic + xlsx mime)', e.status === 200 && e.ct.includes('spreadsheetml') && e.buf.slice(0, 2).toString() === 'PK', `ct=${e.ct}`);
  e = await exportGet('/api/stock/movements/export?format=csv&q=' + encodeURIComponent(G.p1Name), A);
  const mvCsv = e.buf.toString('utf8');
  ok('E4 movements CSV export (BOM + header + data + Jalali)', e.status === 200 && mvCsv.startsWith('\uFEFF') && mvCsv.includes('نوع حرکت') && mvCsv.includes(G.p1Name) && /1405-/.test(mvCsv), 'len=' + mvCsv.length);
  e = await exportGet('/api/stock/movements/export?format=html&q=' + encodeURIComponent(G.p1Name), A);
  ok('E5 movements HTML (printable PDF) export (200 + html + data)', e.status === 200 && e.ct.includes('html') && e.text.includes(G.p1Name) && /1405-/.test(e.text), `ct=${e.ct}`);
  e = await exportGet('/api/stock/alerts/export?format=json', A);
  const alRows = e.data?.sheets?.['هشدارهای موجودی'] || [];
  const p1Alerts = alRows.filter(x => x['کالا'] === G.p1Name);
  ok('E6 alerts JSON export includes our alerts with Jalali dates', e.status === 200 && p1Alerts.length >= 2 && p1Alerts.some(x => x['سطح'] === 'کمبود / سفارش مجدد') && p1Alerts.some(x => x['سطح'] === 'بیش از حد') && /1405-/.test(String(alRows[0]['تاریخ (شمسی)'])), `p1=${p1Alerts.length} rows=${alRows.length}`);
  e = await exportGet('/api/stock/alerts/export?format=xlsx', A);
  ok('E7 alerts XLSX export (PK magic)', e.status === 200 && e.buf.slice(0, 2).toString() === 'PK', '');
  e = await exportGet('/api/stock/alerts/export?format=csv', A);
  ok('E8 alerts CSV export (BOM + header)', e.status === 200 && e.buf.toString('utf8').startsWith('\uFEFF') && e.buf.toString('utf8').includes('هشدار'), '');
  e = await exportGet('/api/stock/export?format=json&q=' + encodeURIComponent(G.p1Code), A);
  ok('E9 stock (current) export still works with search (regression S6)', e.status === 200 && (e.data?.sheets?.['موجودی'] || []).some(x => x['کد'] === G.p1Code), '');

  // ============ 8) Permission on all warehouse endpoints (lab role) ============
  r = await req('POST', '/api/stock/move', { product_id: p1, type: 'in', qty: 1 }, M);
  ok('R1 stock move without stock_transaction:create → 403', r.status === 403, `status=${r.status}`);
  e = await exportGet('/api/stock/export?format=csv', M);
  ok('R2 stock export without product:export → 403', e.status === 403, `status=${e.status}`);
  e = await exportGet('/api/stock/movements/export?format=csv', M);
  ok('R3 movements export without stock_transaction:export → 403', e.status === 403, `status=${e.status}`);
  e = await exportGet('/api/stock/alerts/export?format=csv', M);
  ok('R4 alerts export without stock_alert:export → 403', e.status === 403, `status=${e.status}`);
  r = await req('POST', `/api/purchase_orders/${po1}/receive`, {}, M);
  ok('R5 PO receive without purchase_order:edit → 403', r.status === 403, `status=${r.status}`);
  r = await req('PUT', `/api/r/stock_alert/${G.alertReorder}`, { note: 'x' }, M);
  ok('R6 alert edit without stock_alert:edit → 403', r.status === 403, `status=${r.status}`);

  // ============ 10b) DB integrity ============
  const integ = q1('PRAGMA integrity_check').integrity_check || q1("SELECT 'ok' AS integrity_check");
  ok('B1 PRAGMA integrity_check = ok', (q1('PRAGMA integrity_check').integrity_check || '') === 'ok', '');
  const fk = qa('PRAGMA foreign_key_check');
  ok('B2 PRAGMA foreign_key_check → no violations', fk.length === 0, JSON.stringify(fk).slice(0, 100));
  // stock conservation for P2 (no transfer/adjust): on-hand = Σ movements
  const p2sum = q1('SELECT COALESCE(SUM(qty),0) s FROM stock_transactions WHERE product_id=?', p2).s;
  ok('B3 stock conservation: P2 on-hand (4) = Σ movements (4)', stock(p2) === p2sum && stock(p2) === 4, `stock=${stock(p2)} sum=${p2sum}`);
} catch (err) {
  ok('suite completed without unexpected crash', false, (err.stack || String(err)).slice(0, 300));
}

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const ids = [G.p1, G.p2, G.p3].filter(Boolean).join(',') || '0';
  const tx = d.transaction(() => {
    const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
    del('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE order_id=?)', G.order || 0);
    del('DELETE FROM invoices WHERE order_id=?', G.order || 0);
    del('DELETE FROM orders WHERE id=?', G.order || 0);
    del('DELETE FROM order_items WHERE order_id=?', G.order || 0);
    del('DELETE FROM quote_items WHERE quote_id=?', G.quote || 0);
    del('DELETE FROM quotes WHERE id=?', G.quote || 0);
    del('DELETE FROM stock_transactions WHERE product_id IN (' + ids + ')');
    del('DELETE FROM stock_alerts WHERE product_id IN (' + ids + ')');
    del('DELETE FROM po_items WHERE po_id IN (?,?)', G.po1 || 0, G.po2 || 0);
    del('DELETE FROM purchase_orders WHERE id IN (?,?)', G.po1 || 0, G.po2 || 0);
    del('DELETE FROM suppliers WHERE id=?', G.sup || 0);
    del('DELETE FROM products WHERE id IN (' + ids + ')');
    del('DELETE FROM product_categories WHERE id=?', G.cat || 0);
    del('DELETE FROM customers WHERE id=?', G.cust || 0);
  });
  tx(); d.close();
  console.log('cleanup done');
  console.log('\n========== INVENTORY & WAREHOUSE (SECTION 8) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 160) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
