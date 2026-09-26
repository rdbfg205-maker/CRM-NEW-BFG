// Section 7 — Report Builder: real-HTTP end-to-end test suite (no mocks).
// Builds controlled data through the real API, then verifies:
//   R0  all CRM modules + combined chains exposed as sources
//   R1  module report: search (q) + filter + sort + drill-down
//   R2  aggregation: group by + count/sum/avg vs DB ground truth
//   R3  combined report: customer → order → invoice → payment
//   R4  combined report: order → invoice
//   R5  reports from other units (lab, price lists, suppliers/PO, quotes, tasks, meetings)
//   R6  drill-down opens the REAL record (GET by _drill.id)
//   R7  exports XLSX/CSV/JSON/PDF respect filters; Jalali dates in exports
//   R8  permissions: no report:view → 403; scoped user sees only own rows; entity perm 403
// Cleans up its own records at the end.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const XLSX = require('xlsx');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'R7' + String(Date.now()).slice(-6);
const U1 = STAMP + 'A', U2 = STAMP + 'B', U3 = STAMP + 'C', U4 = STAMP + 'D';
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
const advRun = async (def, tok) => req('POST', '/api/advreports/run', def, tok);
const advExport = async (def, format, tok) => {
  const h = { 'Content-Type': 'application/json' }; if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetchRetry(BASE + '/api/advreports/export', { method: 'POST', headers: h, body: JSON.stringify({ definition: def, format }) });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null; try { data = JSON.parse(buf.toString('utf8')); } catch { /* binary/html */ }
  return { status: r.status, buf, data, ct: r.headers.get('content-type') || '', text: buf.toString('utf8') };
};
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const qa = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };

// ---------- logins ----------
const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }
const M = (await req('POST', '/api/auth/login', { username: 'saeid.t', password: '12345678' })).data.access;
if (!M) { console.log('FATAL: saeid.t login failed'); process.exit(2); }

// ---------- controlled test data (real API) ----------
const G = {};
let tmpId = null, roleId = null;
try {
  const prod = (await req('POST', '/api/r/product', { code: 'R7-' + STAMP.slice(2), name: 'کالای گزارش7 ' + STAMP, unit: 'عدد' }, A)).data.id;
  G.prod = prod;
  const c1 = (await req('POST', '/api/r/customer', { name: 'گزارش7 مشتری ' + U1, type: 'company', phone: '0219' + STAMP.slice(2), status: 'active' }, A)).data.id;
  const c2 = (await req('POST', '/api/r/customer', { name: 'گزارش7 مشتری ' + U2, type: 'company', phone: '0215' + STAMP.slice(2), status: 'active' }, A)).data.id;
  G.c1 = c1; G.c2 = c2;
  G.c1Name = 'گزارش7 مشتری ' + U1; G.c2Name = 'گزارش7 مشتری ' + U2;

  const line = { name: 'ردیف R7 ' + STAMP, qty: 10, price: 1000000 };
  const o1 = (await req('POST', '/api/r/order', { customer_id: c1, status: 'confirmed' }, A)).data.id;
  await req('PUT', `/api/r/order/${o1}/items`, { items: [line] }, A);
  G.o1 = o1;
  const o1r = (await req('GET', `/api/r/order/${o1}`, A)).data.item;
  G.o1Total = o1r.total;

  const i1 = (await req('POST', '/api/r/invoice', { customer_id: c1, order_id: o1 }, A)).data.id;
  await req('PUT', `/api/r/invoice/${i1}/items`, { items: [line] }, A);
  G.i1 = i1;
  let i1r = (await req('GET', `/api/r/invoice/${i1}`, A)).data.item;
  G.i1Total = i1r.total;
  const pa1 = Math.round(i1r.total * 0.4), pa2 = Math.round(i1r.total * 0.1);
  await req('POST', '/api/r/payment', { invoice_id: i1, customer_id: c1, amount: pa1, method: 'bank', status: 'paid' }, A);
  await req('POST', '/api/r/payment', { invoice_id: i1, customer_id: c1, amount: pa2, method: 'cash', status: 'paid' }, A);
  i1r = (await req('GET', `/api/r/invoice/${i1}`, A)).data.item;
  G.i1Paid = i1r.paid_amount; G.i1Status = i1r.status; G.i1Number = i1r.number;
  G.paidSum = pa1 + pa2;

  const i2 = (await req('POST', '/api/r/invoice', { customer_id: c1 }, A)).data.id;
  await req('PUT', `/api/r/invoice/${i2}/items`, { items: [{ name: 'ردیف2 R7 ' + STAMP, qty: 2, price: 1000000 }] }, A);
  G.i2 = i2;
  const i2r = (await req('GET', `/api/r/invoice/${i2}`, A)).data.item;
  G.i2Total = i2r.total; G.i2Status = i2r.status; G.i2Number = i2r.number;

  const o2 = (await req('POST', '/api/r/order', { customer_id: c2, status: 'confirmed' }, A)).data.id;
  await req('PUT', `/api/r/order/${o2}/items`, { items: [{ name: 'ردیف O2 ' + STAMP, qty: 3, price: 500000 }] }, A);
  G.o2 = o2;
  G.o2Total = (await req('GET', `/api/r/order/${o2}`, A)).data.item.total;

  // lab (request + two results; separate tokens so each search is unique)
  const lr = (await req('POST', '/api/r/lab_request', { customer_id: c2, product_id: prod, test_type: 'density', priority: 'medium', status: 'received' }, A)).data.id;
  G.lr = lr;
  G.T1 = STAMP + 'L1'; G.T2 = STAMP + 'L2';
  G.lrName = 'آزمون R7 ' + G.T1;
  const lrRes = (await req('POST', '/api/r/lab_result', { request_id: lr, test_name: G.lrName, method: 'ASTM D1621', result_value: '30', unit: 'kg/m3', spec_text: '28±2', status: 'pass', test_date: '2026-09-07' }, A)).data.id;
  G.lrRes = lrRes;
  // second result stored with Persian kaf (ک) — searched with Arabic kaf (ك) to prove normalization
  G.lrName2 = 'کنترل R7 ' + G.T2;
  const lrRes2 = (await req('POST', '/api/r/lab_result', { request_id: lr, test_name: G.lrName2, method: 'ASTM D4950', result_value: '7.9', unit: 'g/cm3', spec_text: '7.8-8.1', status: 'pass', test_date: '2026-09-07' }, A)).data.id;
  G.lrRes2 = lrRes2;

  // price list + item
  const pl = (await req('POST', '/api/r/price_list', { name: 'لیست R7 ' + STAMP, active: 1 }, A)).data.id;
  G.pl = pl; G.plName = 'لیست R7 ' + STAMP;
  await req('POST', `/api/pricelist/${pl}/item`, { product_id: prod, price: 550000, payment_stage: 'cash' }, A);

  // supplier + purchase order (plain alef: stored value is not normalized, so test data avoids أ/إ/آ)
  const sup = (await req('POST', '/api/r/supplier', { name: 'تامین R7 ' + STAMP, phone: '0217' + STAMP.slice(2) }, A)).data.id;
  G.sup = sup; G.supName = 'تامین R7 ' + STAMP;
  const po = (await req('POST', '/api/r/purchase_order', { supplier_id: sup, status: 'sent' }, A)).data.id;
  G.po = po;
  G.poTotal = (await req('GET', `/api/r/purchase_order/${po}`, A)).data.item.total || 0;

  // quote
  const q1 = (await req('POST', '/api/r/quote', { customer_id: c1 }, A)).data.id;
  G.quote = q1;

  // task + meeting
  const task = (await req('POST', '/api/r/task', { title: 'وظیفه R7 ' + STAMP, assignee_id: 1, status: 'open' }, A)).data.id;
  G.task = task;
  const mt = (await req('POST', '/api/r/meeting', { title: 'جلسه R7 ' + STAMP, start_at: new Date().toISOString() }, A)).data.id;
  G.meeting = mt;

  // ================= R0: sources =================
  const srcs = (await req('GET', '/api/advreports/sources', A)).data.sources || {};
  const need = ['customers', 'sales', 'orders', 'quotes', 'payments', 'suppliers', 'purchase_orders', 'inventory', 'stock', 'lab_requests', 'lab_results', 'price_lists', 'complaints', 'tickets', 'warranties', 'contracts', 'campaigns', 'loyalty_members', 'loyalty_tiers', 'leads', 'opportunities', 'tasks', 'meetings', 'customer_contacts', 'voip_calls', 'commissions', 'employees', 'customer_chain', 'invoice_chain', 'order_chain'];
  const missing = need.filter(k => !srcs[k]);
  ok('R0a sources cover all CRM modules (' + Object.keys(srcs).length + ' sources)', missing.length === 0, 'missing=' + missing.join(','));
  ok('R0b combined chain sources exist', ['customer_chain', 'invoice_chain', 'order_chain'].every(k => srcs[k] && srcs[k].kind === 'chain'), '');

  // ================= R1: module report (customers) — q + filter + sort + drill =================
  let r = await advRun({ source: 'customers', columns: ['name', 'total_spent', 'created_at'], q: U1 }, A);
  ok('R1a customers search by unique token finds exactly 1 row', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].name === G.c1Name, `n=${r.data?.rows?.length}`);
  ok('R1b row carries drill-down ref to the real customer', r.data?.rows?.[0]?._drill?.entity === 'customer' && r.data.rows[0]._drill.id === c1, JSON.stringify(r.data?.rows?.[0]?._drill));
  r = await advRun({ source: 'customers', columns: ['name', 'status'], q: U1, filters: { op: 'AND', conditions: [{ field: 'status', op: 'eq', value: 'active' }] }, sort: 'name', sort_dir: 'asc' }, A);
  ok('R1c search + status filter coherent', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].status === 'active', `n=${r.data?.rows?.length}`);
  r = await advRun({ source: 'customers', columns: ['name'], q: U1, filters: { op: 'AND', conditions: [{ field: 'status', op: 'eq', value: 'inactive' }] } }, A);
  ok('R1d search + non-matching filter → 0 rows', r.status === 200 && r.data.rows.length === 0, `n=${r.data?.rows?.length}`);
  r = await advRun({ source: 'customers', columns: ['name'], q: 'ناموجود' + STAMP }, A);
  ok('R1e non-matching search → 0 rows', r.status === 200 && r.data.rows.length === 0, `n=${r.data?.rows?.length}`);

  // ================= R2: aggregation (invoice_chain) — count/sum/avg vs DB truth =================
  const invs = qa('SELECT number, status, total, paid_amount FROM invoices WHERE customer_id=? ORDER BY id', c1);
  const truthSum = invs.reduce((s, x) => s + (x.total || 0), 0);
  r = await advRun({ source: 'invoice_chain', columns: ['status', 'total'], group_by: 'status', group_agg: 'count', filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } }, A);
  const countMap = {};
  for (const row of r.data?.rows || []) countMap[row._group] = row._agg;
  const truthCount = {};
  for (const x of invs) truthCount[x.status] = (truthCount[x.status] || 0) + 1;
  const sameMap = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  ok('R2a group by status (count) matches DB', r.status === 200 && sameMap(countMap, truthCount), `got=${JSON.stringify(countMap)} want=${JSON.stringify(truthCount)}`);
  r = await advRun({ source: 'invoice_chain', columns: ['status', 'total'], group_by: 'status', group_agg: 'sum', filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } }, A);
  ok('R2b grand total sum(total) matches DB', r.status === 200 && Math.abs((r.data.grandTotal?.agg || 0) - truthSum) < 0.01 && (r.data.grandTotal?.count || 0) === invs.length, `got=${r.data?.grandTotal} want=${truthSum}`);
  r = await advRun({ source: 'invoice_chain', columns: ['status', 'total'], group_by: 'status', group_agg: 'avg', filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } }, A);
  // per-group expectation straight from the DB
  const byStatus = {};
  for (const x of invs) (byStatus[x.status] = byStatus[x.status] || []).push(x.total || 0);
  const g0 = r.data?.rows?.[0] || {};
  const expAvg0 = byStatus[g0._group] ? byStatus[g0._group].reduce((a, b) => a + b, 0) / byStatus[g0._group].length : NaN;
  ok('R2c group agg avg(total) = per-group mean from DB', r.status === 200 && r.data.rows.length >= 1 && Math.abs((g0.total || 0) - expAvg0) < 0.01, `row=${JSON.stringify(g0)} want=${expAvg0}`);

  // ================= R3: combined customer → order → invoice → payment =================
  r = await advRun({ source: 'customer_chain', columns: ['name', 'orders_count', 'orders_total', 'invoices_count', 'invoices_total', 'paid_total', 'balance'], filters: { op: 'AND', conditions: [{ field: 'name', op: 'eq', value: G.c1Name }] } }, A);
  const cc = r.data?.rows?.[0] || {};
  const expInvTotal = G.i1Total + G.i2Total;
  ok('R3a chain: 1 customer row found', r.status === 200 && r.data.rows.length === 1 && cc.name === G.c1Name, `n=${r.data?.rows?.length}`);
  ok('R3b chain: order count/total correct', cc.orders_count === 1 && Math.abs((cc.orders_total || 0) - G.o1Total) < 0.01, JSON.stringify(cc).slice(0, 160));
  ok('R3c chain: invoice count/total correct (2 invoices)', cc.invoices_count === 2 && Math.abs((cc.invoices_total || 0) - expInvTotal) < 0.01, `got=${cc.invoices_count}/${cc.invoices_total} want=2/${expInvTotal}`);
  ok('R3d chain: paid total = sum of payments', Math.abs((cc.paid_total || 0) - G.i1Paid) < 0.01 && Math.abs(G.i1Paid - G.paidSum) < 0.01, `got=${cc.paid_total} want=${G.i1Paid}`);
  ok('R3e chain: balance = invoices - paid', Math.abs((cc.balance || 0) - (expInvTotal - G.i1Paid)) < 0.01, `got=${cc.balance} want=${expInvTotal - G.i1Paid}`);
  r = await advRun({ source: 'customer_chain', columns: ['name', 'orders_count', 'invoices_count', 'balance'], filters: { op: 'AND', conditions: [{ field: 'name', op: 'eq', value: G.c2Name }] } }, A);
  const cc2 = r.data?.rows?.[0] || {};
  ok('R3f chain: second customer (order only, no invoices) coherent', r.status === 200 && cc2.orders_count === 1 && cc2.invoices_count === 0 && (cc2.balance || 0) === 0, JSON.stringify(cc2).slice(0, 120));

  // ================= R4: combined order → invoice =================
  r = await advRun({ source: 'order_chain', columns: ['number', 'customer', 'total', 'invoiced', 'remaining', 'invoiced_count'], filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } }, A);
  const oc = r.data?.rows?.[0] || {};
  ok('R4a order_chain: invoiced = invoice total, remaining = order - invoiced', r.status === 200 && r.data.rows.length === 1 && Math.abs((oc.invoiced || 0) - G.i1Total) < 0.01 && Math.abs((oc.remaining || 0) - (G.o1Total - G.i1Total)) < 0.01 && oc.invoiced_count === 1, JSON.stringify(oc).slice(0, 160));

  // ================= R5: other units =================
  r = await advRun({ source: 'lab_results', columns: ['request_number', 'customer', 'test_name', 'status', 'test_date'], q: G.T1 }, A);
  ok('R5a lab results report finds the unique result', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].test_name === G.lrName, `n=${r.data?.rows?.length}`);
  // stored name uses Persian kaf (ک); search with Arabic kaf (ك) — normalizeFa maps ك→ک
  r = await advRun({ source: 'lab_results', columns: ['test_name', 'test_date'], q: 'ك' + 'نترل R7 ' + G.T2 }, A);
  ok('R5b lab search normalized (Arabic ك finds stored Persian ک)', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].test_name === G.lrName2, `n=${r.data?.rows?.length}`);
  r = await advRun({ source: 'price_lists', columns: ['name', 'items_count', 'min_price', 'max_price'], q: G.plName }, A);
  ok('R5c price lists report (items_count=1, min=max=550000)', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].items_count === 1 && r.data.rows[0].min_price === 550000 && r.data.rows[0].max_price === 550000, JSON.stringify(r.data?.rows?.[0]));
  r = await advRun({ source: 'suppliers', columns: ['name', 'po_count', 'po_total'], q: G.supName }, A);
  ok('R5d suppliers report (po_count=1, po_total=DB value)', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].po_count === 1 && Math.abs((r.data.rows[0].po_total || 0) - G.poTotal) < 0.01, JSON.stringify(r.data?.rows?.[0]));
  r = await advRun({ source: 'purchase_orders', columns: ['number', 'supplier', 'total'], filters: { op: 'AND', conditions: [{ field: 'supplier', op: 'eq', value: G.supName }] } }, A);
  ok('R5e purchase orders by supplier filter', r.status === 200 && r.data.rows.length === 1, `n=${r.data?.rows?.length}`);
  r = await advRun({ source: 'quotes', columns: ['number', 'customer', 'total'], filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } }, A);
  // NOTE (documented test correction): the active sales-chain workflow template
  // auto-creates an initial proforma on customer_created, so the customer may
  // legitimately have >1 quote. Verify: >=1 row, ALL rows belong to this
  // customer, and the test's own quote (q1) is present.
  const q1Number = (await req('GET', '/api/r/quote/' + G.quote, A)).data?.item?.number || (await req('GET', '/api/r/quote/' + G.quote, A)).data?.number;
  ok('R5f quotes report for customer (all rows this customer + own quote present)',
    r.status === 200 && r.data.rows.length >= 1 && r.data.rows.every(x => x.customer === G.c1Name) && r.data.rows.some(x => x.number === q1Number),
    `n=${r.data?.rows?.length} ownQuote=${q1Number} rows=${JSON.stringify((r.data?.rows || []).map(x => x.number))}`);
  r = await advRun({ source: 'tasks', columns: ['title', 'assignee', 'status'], q: 'وظیفه R7 ' + STAMP }, A);
  ok('R5g tasks report finds the unique task (drill to task)', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0]._drill?.entity === 'task', JSON.stringify(r.data?.rows?.[0]?._drill));
  r = await advRun({ source: 'meetings', columns: ['title', 'start_at', 'status'], q: 'جلسه R7 ' + STAMP }, A);
  ok('R5h meetings report finds the unique meeting', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].start_at, `n=${r.data?.rows?.length}`);
  r = await advRun({ source: 'employees', columns: ['full_name', 'invoices', 'sales'] }, A);
  ok('R5i employees report runs (aggregate subqueries)', r.status === 200 && r.data.rows.length >= 1, `n=${r.data?.rows?.length}`);

  // ================= R6: drill-down → real record =================
  let drill = (await advRun({ source: 'invoice_chain', columns: ['number', 'customer', 'total', 'issue_date'], filters: { op: 'AND', conditions: [{ field: 'number', op: 'eq', value: G.i1Number }] } }, A)).data?.rows?.[0]?._drill;
  ok('R6a invoice row drill ref present', drill && drill.entity === 'invoice' && drill.id === G.i1, JSON.stringify(drill));
  if (drill) {
    const real = await req('GET', `/api/r/invoice/${drill.id}`, A);
    ok('R6b drill-down opens the REAL invoice record', real.status === 200 && real.data.item.number === G.i1Number, `status=${real.status} number=${real.data?.item?.number}`);
  } else ok('R6b drill-down opens the REAL invoice record', false, 'no drill ref');
  const cDrill = (await advRun({ source: 'customer_chain', columns: ['name'], filters: { op: 'AND', conditions: [{ field: 'name', op: 'eq', value: G.c1Name }] } }, A)).data?.rows?.[0]?._drill;
  const cReal = cDrill ? await req('GET', `/api/r/customer/${cDrill.id}`, A) : { status: 0 };
  ok('R6c drill-down opens the REAL customer record', cReal.status === 200 && cReal.data.item.name === G.c1Name, `status=${cReal.status}`);

  // ================= R7: exports (filters respected, Jalali dates) =================
  const expDef = { source: 'invoice_chain', columns: ['number', 'customer', 'issue_date', 'total', 'paid_amount', 'balance', 'payments_count'], filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } };
  let e = await advExport(expDef, 'xlsx', A);
  ok('R7a XLSX export (200 + xlsx mime + zip magic)', e.status === 200 && e.ct.includes('spreadsheetml') && e.buf.slice(0, 2).toString() === 'PK', `status=${e.status} ct=${e.ct}`);
  if (e.buf.slice(0, 2).toString() === 'PK') {
    try {
      const wb = XLSX.read(e.buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const hi = aoa.findIndex(x => x.some(c => String(c).includes('شماره فاکتور')));
      const flat = aoa.map(x => x.join('|'));
      ok('R7b XLSX content: headers + filtered data + Jalali date', hi >= 0 && aoa.length > hi + 2 && flat.some(l => l.includes(G.c1Name)) && flat.slice(hi + 1).some(l => /۱۴۰/.test(l)), `headerRow=${hi} rows=${aoa.length}`);
      ok('R7c XLSX respects filter (no other customer)', !flat.some(l => l.includes(G.c2Name)), '');
    } catch (err) { ok('R7b XLSX content parseable', false, err.message); }
  } else ok('R7b XLSX content parseable', false, 'not xlsx');
  e = await advExport(expDef, 'csv', A);
  const csv = e.buf.toString('utf8');
  ok('R7d CSV export (BOM + headers + filtered rows + Jalali date)', e.status === 200 && e.ct.includes('csv') && csv.startsWith('\uFEFF') && csv.includes('شماره فاکتور') && csv.includes(G.c1Name) && /۱۴۰/.test(csv) && !csv.includes(G.c2Name), 'len=' + csv.length);
  e = await advExport(expDef, 'json', A);
  const jRows = e.data?.report?.rows || [];
  const jCols = e.data?.report?.columns || [];
  ok('R7e JSON export: only filtered customer rows', e.status === 200 && jRows.length === 2 && jRows.every(rw => rw.includes(G.c1Name)), `rows=${jRows.length}`);
  const di = jCols.indexOf('تاریخ صدور');
  ok('R7f JSON export dates are JALALI (fa digits)', di >= 0 && jRows.every(rw => /۱۴۰/.test(String(rw[di]))), `date=${di >= 0 ? jRows[0]?.[di] : '—'}`);
  e = await advExport(expDef, 'pdf', A);
  ok('R7g PDF export (printable html + company + data + Jalali)', e.status === 200 && e.ct.includes('html') && e.text.includes('بسپار') && e.text.includes(G.c1Name) && /۱۴۰/.test(e.text) && !e.text.includes(G.c2Name), `status=${e.status}`);
  // grouped export includes grand total row
  const gDef = { source: 'invoice_chain', columns: ['status', 'total'], group_by: 'status', group_agg: 'sum', filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } };
  e = await advExport(gDef, 'json', A);
  const gRows = e.data?.report?.rows || [];
  ok('R7h grouped JSON export has grand total row with correct sum', gRows.length >= 2 && gRows.some(rw => rw[0] === 'جمع کل' && Math.abs(Number(rw[1]) - truthSum) < 0.01), JSON.stringify(gRows).slice(0, 140));
  // legacy section-1..6 report endpoints still work (regression)
  r = await req('GET', '/api/reports/sources', A);
  ok('R7i legacy /api/reports/sources still works (regression)', r.status === 200 && r.data && Object.keys(r.data).length >= 8, `n=${Object.keys(r.data || {}).length}`);

  // ================= R8: permissions =================
  let rp = await req('POST', '/api/advreports/run', { source: 'lab_results', columns: ['test_name'] }, M);
  ok('R8a user without report_definition:view → 403 (run)', rp.status === 403, `status=${rp.status}`);
  rp = await req('GET', '/api/advreports/sources', M);
  ok('R8b user without report_definition:view → 403 (sources)', rp.status === 403, `status=${rp.status}`);
  rp = await advExport({ source: 'lab_results', columns: ['test_name'] }, 'xlsx', M);
  ok('R8c user without report_definition:view → 403 (export)', rp.status === 403, `status=${rp.status}`);

  // scoped temporary user: own-scope customer/order/invoice + report perms
  const roleName = 'rb7_role_' + STAMP.slice(2);
  let cr = await req('POST', '/api/admin/roles', { name: roleName, name_fa: 'نقش تست بخش7', permissions: [
    { entity: 'customer', action: 'view', scope: 'own' },
    { entity: 'customer', action: 'create', scope: 'own' },
    { entity: 'order', action: 'view', scope: 'own' },
    { entity: 'invoice', action: 'view', scope: 'own' },
    { entity: 'report_definition', action: 'view', scope: 'all' },
    { entity: 'report_definition', action: 'export', scope: 'all' },
  ] }, A);
  roleId = cr.data?.id;
  ok('R8d temp scoped role created via admin API', !!roleId, `status=${cr.status}`);
  const uName = 'rb7u_' + STAMP.slice(2);
  let ur = await req('POST', '/api/admin/users', { username: uName, password: 'Rb7-' + STAMP, full_name: 'تست بخش7', department: 'sales', role_ids: [roleId] }, A);
  tmpId = ur.data?.id;
  ok('R8e temp scoped user created via admin API', !!tmpId, `status=${ur.status}`);
  await req('PUT', `/api/admin/users/${tmpId}`, { password: 'Rb7-' + STAMP }, A); // clear must_change_password
  await sleep(32000); // permission map cache (30s)

  const TMP = (await req('POST', '/api/auth/login', { username: uName, password: 'Rb7-' + STAMP })).data.access;
  ok('R8f scoped user can log in', !!TMP, '');
  if (TMP) {
    const c3b = (await req('POST', '/api/r/customer', { name: 'گزارش7 مشتری خودی ' + U3, type: 'company', salesperson_id: tmpId }, TMP)).data.id;
    const c4 = (await req('POST', '/api/r/customer', { name: 'گزارش7 مشتری ادمین ' + U4, type: 'company', salesperson_id: 1 }, A)).data.id;
    G.c3 = c3b; G.c4 = c4;
    G.c3Name = 'گزارش7 مشتری خودی ' + U3; G.c4Name = 'گزارش7 مشتری ادمین ' + U4;
    let rs = await advRun({ source: 'customers', columns: ['name'], q: U3 }, TMP);
    ok('R8g scoped user sees OWN customer in report', rs.status === 200 && rs.data.rows.length === 1 && rs.data.rows[0].name === G.c3Name, `n=${rs.data?.rows?.length}`);
    rs = await advRun({ source: 'customers', columns: ['name'], q: U4 }, TMP);
    ok('R8h scoped user does NOT see other-scope customers', rs.status === 200 && rs.data.rows.length === 0, `n=${rs.data?.rows?.length}`);
    rs = await advRun({ source: 'customers', columns: ['name'], q: U1 }, TMP);
    ok('R8i scoped user does NOT see admin customers', rs.status === 200 && rs.data.rows.length === 0, `n=${rs.data?.rows?.length}`);
    rs = await advRun({ source: 'invoice_chain', columns: ['number', 'customer', 'total'], filters: { op: 'AND', conditions: [{ field: 'customer', op: 'eq', value: G.c1Name }] } }, TMP);
    ok('R8j scoped user invoice report excludes others\' invoices', rs.status === 200 && rs.data.rows.length === 0, `n=${rs.data?.rows?.length}`);
    rs = await advRun({ source: 'suppliers', columns: ['name'] }, TMP);
    ok('R8k source without entity:view (supplier) → 403', rs.status === 403, `status=${rs.status}`);
    rs = await advExport({ source: 'customers', columns: ['name'], q: U3 }, 'csv', TMP);
    ok('R8l scoped export works and is scoped', rs.status === 200 && rs.text.includes(G.c3Name) && !rs.text.includes(G.c4Name) && !rs.text.includes(G.c1Name), `status=${rs.status}`);
  }
} catch (e) {
  ok('suite completed without unexpected crash', false, e.stack || String(e));
}

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
  try {
    del(`DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'}))`);
    del(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'}))`);
    del(`DELETE FROM invoices WHERE customer_id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'})`);
    del(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'}))`);
    del(`DELETE FROM orders WHERE customer_id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'})`);
    del(`DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE customer_id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'}))`);
    del(`DELETE FROM quotes WHERE customer_id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'})`);
    del(`DELETE FROM po_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE supplier_id=?)`, G.sup || 0);
    del(`DELETE FROM purchase_orders WHERE supplier_id=?`, G.sup || 0);
    del(`DELETE FROM lab_results WHERE request_id=?`, G.lr || 0);
    del(`DELETE FROM lab_requests WHERE id=?`, G.lr || 0);
    del(`DELETE FROM price_list_items WHERE price_list_id=?`, G.pl || 0);
    del(`DELETE FROM price_lists WHERE id=?`, G.pl || 0);
    del(`DELETE FROM suppliers WHERE id=?`, G.sup || 0);
    del(`DELETE FROM tasks WHERE id=?`, G.task || 0);
    del(`DELETE FROM meetings WHERE id=?`, G.meeting || 0);
    del(`DELETE FROM products WHERE id=?`, G.prod || 0);
    del(`DELETE FROM customers WHERE id IN (${[G.c1, G.c2, G.c3, G.c4].filter(Boolean).join(',') || '0'})`);
  } finally { d.close(); }
  // temp role/user via API (verifiable) + DB fallback
  const du = (await req('DELETE', '/api/admin/users/' + tmpId + '?hard=1', A)).status;
  const dr = (await req('DELETE', '/api/admin/roles/' + roleId, A)).status;
  const d2 = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  try {
    d2.prepare('DELETE FROM user_roles WHERE user_id=?').run(tmpId || 0);
    d2.prepare('DELETE FROM users WHERE id=?').run(tmpId || 0);
    d2.prepare('DELETE FROM role_permissions WHERE role_id=?').run(roleId || 0);
    d2.prepare('DELETE FROM roles WHERE id=?').run(roleId || 0);
  } catch { }
  d2.close();
  console.log('cleanup done (user delete=' + du + ', role delete=' + dr + ')');
  console.log('\n========== REPORT BUILDER (SECTION 7) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 160) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
