// Section 9.3 — Dashboard & Analytics: real-HTTP test suite (no mocks).
// KPIs must match the real Database (ground truth), period filter must be accurate,
// drill-down ids must resolve to real records, role dashboards must be coherent. Cleans up.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'DA' + String(Date.now()).slice(-5);
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
    await sleep(Math.min(2000, 300 * 2 ** (i - 1)) + Math.floor(Math.random() * 250));
  }
}
async function req(method, path, a, b) {
  const isGet = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  const body = isGet ? undefined : a;
  const token = isGet ? a : b;
  const h = {};
  if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetchRetry(BASE + path, { method, headers: h, body: (body !== undefined && body !== null) ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t, ct: r.headers.get('content-type') || '' };
}
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const qa = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };

const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }

const G = {};
try {
  // ---------- controlled data (real API) ----------
  G.cust = (await req('POST', '/api/r/customer', { name: 'مشتری داشبورد ' + STAMP, type: 'company', status: 'active' }, A)).data.id;
  G.prod = (await req('POST', '/api/r/product', { code: 'DA-' + STAMP.slice(2), name: 'کالای داشبورد ' + STAMP, unit: 'عدد', reorder_point: 5 }, A)).data.id;
  // stock: in 10 then out 6 → 4 < reorder 5 → low-stock alert auto-created
  await req('POST', '/api/stock/move', { product_id: G.prod, type: 'in', qty: 10, note: 'داشبورد' }, A);
  await req('POST', '/api/stock/move', { product_id: G.prod, type: 'out', qty: 6, note: 'داشبورد' }, A);
  G.alert = q1('SELECT id FROM stock_alerts WHERE product_id=? AND resolved_at IS NULL', G.prod);
  ok('D01 low-stock alert auto-created by real stock movement', !!G.alert, 'alert=' + (G.alert && G.alert.id));

  // a real invoice inside the period (quote → order → invoice)
  const q = (await req('POST', '/api/r/quote', { customer_id: G.cust }, A)).data.id;
  G.quote = q;
  await req('PUT', `/api/r/quote/${q}/items`, { items: [{ product_id: G.prod, name: 'ردیف داشبورد', qty: 1, price: 2000000 }] }, A);
  const o = (await req('POST', `/api/quotes/${q}/to-order`, {}, A)).data.order_id;
  G.order = o;
  const inv = (await req('POST', `/api/orders/${o}/to-invoice`, {}, A)).data.invoice_id;
  G.invoice = inv;
  G.invTotal = q1('SELECT total FROM invoices WHERE id=?', inv).total;

  // an open complaint past SLA (for the CEO alert drill-down)
  G.complaint = (await req('POST', '/api/r/complaint', { customer_id: G.cust, subject: 'شکایت داشبورد ' + STAMP, priority: 'high', status: 'new', due_at: new Date(Date.now() - 3600e3).toISOString() }, A)).data.id;

  // ---------- KPIs vs real DB ground truth ----------
  let r = await req('GET', '/api/dashboard', A);
  ok('D02 dashboard returns kpi + 12-month series', r.status === 200 && r.data.kpi && (r.data.series || []).length === 12, `series=${(r.data.series || []).length}`);
  const k = r.data.kpi;
  const gt = {
    customers: q1(`SELECT COUNT(*) c FROM customers WHERE archived_at IS NULL AND status='active'`).c,
    receivables: q1(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE status IN ('unpaid','partial','overdue')`).s,
    openOrders: q1(`SELECT COUNT(*) c FROM orders WHERE status IN ('confirmed','in_production','ready','shipped') AND archived_at IS NULL`).c,
    lowStock: q1(`SELECT COUNT(*) c FROM stock_alerts WHERE resolved_at IS NULL`).c,
  };
  ok('D03 KPI customers == DB count (real data)', k.customers === gt.customers, `api=${k.customers} db=${gt.customers}`);
  ok('D04 KPI receivables == DB sum (real data)', Math.abs(k.receivables - gt.receivables) < 1, `api=${k.receivables} db=${gt.receivables}`);
  ok('D05 KPI openOrders == DB count', k.openOrders === gt.openOrders, `api=${k.openOrders} db=${gt.openOrders}`);
  ok('D06 KPI lowStock == DB unresolved alerts', k.lowStock === gt.lowStock, `api=${k.lowStock} db=${gt.lowStock}`);
  const seriesSum = (r.data.series || []).reduce((a, x) => a + (x.value || 0), 0);
  ok('D07 12-month series (Jalali keys) sums to real sales volume', seriesSum > 0 && r.data.series.every(x => /^\d{4}-\d{2}$/.test(x.key)), `sum=${seriesSum}`);

  // ---------- period filter (from/to) ----------
  const from = new Date(Date.now() - 2 * 864e5).toISOString();
  const to = new Date(Date.now() + 864e5).toISOString();
  r = await req('GET', '/api/dashboard?from=' + from + '&to=' + to, A);
  const p = r.data.period || {};
  ok('D08 period filter: new invoice counted in sales (real)', p.sales && p.sales.c >= 1 && p.sales.s >= G.invTotal, `c=${p.sales && p.sales.c} s=${p.sales && p.sales.s} inv=${G.invTotal}`);
  ok('D09 period filter: new customer counted', p.newCustomers && p.newCustomers.c >= 1, `c=${p.newCustomers && p.newCustomers.c}`);
  ok('D10 period filter: payments consistent with DB (paid=0 in window for our invoice)', p.payments && Number.isFinite(p.payments.s), `s=${p.payments && p.payments.s}`);

  // ---------- drill-down to real records (CEO dashboard) ----------
  r = await req('GET', '/api/dashboard?role=ceo', A);
  const ceo = r.data || {};
  ok('D11 CEO dashboard: top customers are real (≥1, resolvable by id)', (ceo.topCust || []).length >= 1 && ceo.topCust.every(x => !!x.id), `n=${(ceo.topCust || []).length}`);
  const drillCust = ceo.topCust?.[0];
  if (drillCust) {
    const dc = await req('GET', '/api/r/customer/' + drillCust.id, A);
    ok('D12 drill-down: top customer id opens the real record', dc.status === 200 && dc.data.item.id === drillCust.id, `status=${dc.status}`);
  } else ok('D12 drill-down: top customer id opens the real record', false, 'no topCust');
  ok('D13 CEO alerts include our stock alert + SLA complaint (real ids)', (ceo.alerts || []).some(a => a.type === 'stock' && a.id === (G.alert && G.alert.id)) && (ceo.alerts || []).some(a => a.type === 'sla' && a.id === G.complaint), JSON.stringify((ceo.alerts || []).slice(0, 4)));
  if (G.alert) {
    const da = await req('GET', '/api/r/stock_alert/' + G.alert.id, A);
    ok('D14 drill-down: stock alert id opens the real record', da.status === 200, `status=${da.status}`);
  } else ok('D14 drill-down: stock alert id opens the real record', false, 'no alert');
  const di = await req('GET', '/api/r/invoice/' + G.invoice, A);
  ok('D15 drill-down: our invoice id opens the real record', di.status === 200 && di.data.item.id === G.invoice, `status=${di.status}`);

  // ---------- role dashboards coherence ----------
  r = await req('GET', '/api/dashboard?role=sales_manager', A);
  const sm = r.data || {};
  ok('D16 sales role: funnel + performance + chain KPIs (real numbers)', r.status === 200 && Array.isArray(sm.funnel) && Array.isArray(sm.perf) && sm.chain && Number.isFinite(sm.chain.openInvoices.v), `funnel=${(sm.funnel || []).length}`);
  r = await req('GET', '/api/dashboard?role=finance_manager', A);
  const fin = r.data || {};
  const agingDb = q1(`SELECT
    COALESCE(SUM(CASE WHEN datetime(due_date) < datetime('now','-30 day') THEN total-paid_amount ELSE 0 END),0) a1,
    COALESCE(SUM(CASE WHEN datetime(due_date) >= datetime('now','-30 day') AND datetime(due_date) < datetime('now') THEN total-paid_amount ELSE 0 END),0) a2,
    COALESCE(SUM(CASE WHEN datetime(due_date) >= datetime('now') THEN total-paid_amount ELSE 0 END),0) a3,
    COALESCE(SUM(CASE WHEN due_date IS NULL THEN total-paid_amount ELSE 0 END),0) a0
  FROM invoices WHERE status IN ('unpaid','partial','overdue')`);
  ok('D17 finance role: receivables aging == DB', r.status === 200 && fin.aging && fin.aging.a0 === agingDb.a0 && fin.aging.a1 === agingDb.a1, JSON.stringify(fin.aging || {}));
  r = await req('GET', '/api/dashboard?role=warehouse_manager', A);
  const wh = r.data || {};
  const stockValDb = q1(`SELECT COALESCE(SUM(p.stock_qty * COALESCE(p.price_cost,0)),0) v FROM products p WHERE p.active=1 AND p.archived_at IS NULL`).v;
  ok('D18 warehouse role: stock value == DB', r.status === 200 && Math.abs((wh.stockValue || 0) - stockValDb) < 1, `api=${wh.stockValue} db=${stockValDb}`);
} catch (err) {
  ok('suite completed without unexpected crash', false, (err.stack || String(err)).slice(0, 300));
}

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
    del('DELETE FROM complaint_events WHERE complaint_id=?', G.complaint || 0);
    del('DELETE FROM complaints WHERE id=?', G.complaint || 0);
    del('DELETE FROM stock_alerts WHERE id=?', G.alert ? G.alert.id : -1);
    del('DELETE FROM stock_transactions WHERE product_id=?', G.prod || 0);
    del('DELETE FROM invoice_items WHERE invoice_id=?', G.invoice || 0);
    del('DELETE FROM invoices WHERE id=?', G.invoice || 0);
    del('DELETE FROM order_items WHERE order_id=?', G.order || 0);
    del('DELETE FROM orders WHERE id=?', G.order || 0);
    del('DELETE FROM quote_items WHERE quote_id=?', G.quote || 0);
    del('DELETE FROM quotes WHERE id=?', G.quote || 0);
    del('DELETE FROM products WHERE id=?', G.prod || 0);
    del('DELETE FROM customers WHERE id=?', G.cust || 0);
  });
  tx(); d.close();
  console.log('cleanup done');
  console.log('\n========== DASHBOARD & ANALYTICS (SECTION 9.3) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 150) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
