// Section 3 — Price Override + Audit: real-HTTP end-to-end test suite (no mocks).
// Controlled dataset (2 customers, 2 products, 1 price list, 2 quotes) is created
// through the normal authenticated API, then scenarios A–H + security tests run.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
async function req(method, path, body, tok, headers = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof Buffer)) h['content-type'] = 'application/json';
  if (tok) h['authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (body instanceof Buffer ? body : JSON.stringify(body)) });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1s = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const q1a = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };
const countAudit = (action, entityId) => q1s('SELECT COUNT(*) c FROM audit_logs WHERE action=? AND entity_id=?', action, entityId).c;
const SUF = String(Date.now()).slice(-6);
const RUN_START = new Date(Date.now() - 60000).toISOString(); // denials are audited with entity_id=0 → match by user+time
const denialsSince = (userId) => q1s('SELECT COUNT(*) c FROM audit_logs WHERE action=? AND user_id=? AND at>=?', 'permission_denied', userId, RUN_START).c;

// ---------- logins ----------
const lA = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
const lM = await req('POST', '/api/auth/login', { username: 'ali.k', password: '12345678' });
const lS = await req('POST', '/api/auth/login', { username: 'sara.m', password: '12345678' });
ok('setup: admin login', lA.status === 200 && lA.data.access);
ok('setup: ali.k (sales_manager) login', lM.status === 200 && lM.data.access);
ok('setup: sara.m (sales) login', lS.status === 200 && lS.data.access);
const A = lA.data.access, M = lM.data.access, S = lS.data.access;

// ---------- permission preconditions ----------
const meM = (await req('GET', '/api/me', undefined, M)).data;
const meS = (await req('GET', '/api/me', undefined, S)).data;
ok('precondition: sales_manager has price_override:edit', !!(meM.permissions && meM.permissions.price_override && meM.permissions.price_override.edit));
ok('precondition: sales does NOT have price_override:edit', !(meS.permissions && meS.permissions.price_override && meS.permissions.price_override.edit));

// ---------- controlled dataset (real records via API) ----------
const custA = (await req('POST', '/api/r/customer', { name: 'شرکت تست Override A-' + SUF, phone: '0912' + SUF + '11', type: 'company' }, A)).data;
const custB = (await req('POST', '/api/r/customer', { name: 'شرکت تست Override B-' + SUF, phone: '0912' + SUF + '22', type: 'company' }, A)).data;
ok('dataset: customer A created', !!custA.id, 'id=' + custA.id);
ok('dataset: customer B created', !!custB.id, 'id=' + custB.id);
const prodA = (await req('POST', '/api/r/product', { code: 'OVR-A' + SUF, name: 'اسفنج تست Override A-' + SUF, unit: 'عدد', price_retail: 100000, price_wholesale: 100000 }, A)).data;
const prodB = (await req('POST', '/api/r/product', { code: 'OVR-B' + SUF, name: 'اسفنج تست Override B-' + SUF, unit: 'عدد', price_retail: 200000, price_wholesale: 200000 }, A)).data;
ok('dataset: product A created', !!prodA.id, 'id=' + prodA.id);
ok('dataset: product B created', !!prodB.id, 'id=' + prodB.id);
const pl = (await req('POST', '/api/r/price_list', { name: 'لیست قیمت تست Override-' + SUF, active: 1, is_default: 0 }, A)).data;
ok('dataset: price list created', !!pl.id, 'id=' + pl.id);
const plSave = await req('POST', `/api/pricelist/${pl.id}/items`, { items: [
  { product_id: prodA.id, price: 100000, payment_stage: 'cash' },
  { product_id: prodA.id, price: 115000, payment_stage: '3_month' },
  { product_id: prodA.id, price: 130000, payment_stage: '6_month' },
  { product_id: prodB.id, price: 200000, payment_stage: 'cash' },
]}, A);
ok('dataset: price list items saved (A: cash/3mo/6mo, B: cash)', plSave.status === 200 && plSave.data.saved === 4, JSON.stringify(plSave.data));
const quote1 = (await req('POST', '/api/r/quote', { customer_id: custA.id, price_list_id: pl.id, salesperson_id: 4, status: 'draft' }, A)).data;
const quote2 = (await req('POST', '/api/r/quote', { customer_id: custB.id, price_list_id: pl.id, salesperson_id: 3, status: 'draft' }, A)).data;
ok('dataset: quote 1 created (salesperson=sara.m → in her scope, tests isolate price_override)', !!quote1.id, 'id=' + quote1.id);
ok('dataset: quote 2 created (salesperson=ali.k → outside sara.m scope)', !!quote2.id, 'id=' + quote2.id);

// ---------- Test A: authorized override 100000 → 95000 ----------
const tA = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { product_id: prodA.id, name: 'ردیف A', qty: 2, price: 95000, override_reason: 'تخفیف رقابتی' },
  { product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
ok('A1: authorized save accepted (ali.k)', tA.status === 200, JSON.stringify(tA.data));
let items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
let lineA = items.find(i => i.product_id === prodA.id);
let lineB = items.find(i => i.product_id === prodB.id);
ok('A2: line A final price = 95000', lineA && lineA.price === 95000, lineA && String(lineA.price));
ok('A3: line A base_price = 100000 (from price list)', lineA && lineA.base_price === 100000, lineA && String(lineA.base_price));
ok('A4: line A override_status = 1 + reason stored', lineA && lineA.override_status === 1 && lineA.override_reason === 'تخفیف رقابتی', lineA && lineA.override_reason);
ok('A5: line B at base → no override', lineB && lineB.price === 200000 && lineB.base_price === 200000 && lineB.override_status === 0);
const q1doc = (await req('GET', `/api/r/quote/${quote1.id}`, undefined, M)).data.item;
ok('A6: quote totals from FINAL price (2×95000 + 200000 = 390000)', q1doc.subtotal === 390000, 'subtotal=' + q1doc.subtotal);

// ---------- Test B: empty reason → rejected, not stored ----------
const tB = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 90000, override_reason: '' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
ok('B1: override with empty reason → 422', tB.status === 422, 'status=' + tB.status + ' ' + (tB.data.error && tB.data.error.message));
ok('B2: clear Persian error message', /دلیل/.test((tB.data.error && tB.data.error.message) || ''), (tB.data.error && tB.data.error.message) || '');
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('B3: line still 95000 (override not stored)', lineA.price === 95000 && lineA.override_status === 1, 'price=' + lineA.price);
ok('B4: no new PRICE_OVERRIDE audit from rejected save', countAudit('PRICE_OVERRIDE', quote1.id) === 1, 'count=' + countAudit('PRICE_OVERRIDE', quote1.id));

// ---------- Test C: user without permission → 403 ----------
const denBeforeC = denialsSince(4);
const tC = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 90000, override_reason: 'تلاش بدون مجوز' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, S);
ok('C1: sara.m override attempt → 403', tC.status === 403, 'status=' + tC.status);
ok('C2: denial audited (permission_denied, price_override:edit)', denialsSince(4) > denBeforeC, `before=${denBeforeC} after=${denialsSince(4)}`);
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('C3: state unchanged after denied attempt', lineA.price === 95000, 'price=' + lineA.price);

// ---------- Test D: one audit for the real change 100000 → 95000 ----------
const auditsD = q1a("SELECT * FROM audit_logs WHERE action='PRICE_OVERRIDE' AND entity_id=? ORDER BY id", quote1.id);
ok('D1: exactly 1 PRICE_OVERRIDE audit for the change', auditsD.length === 1, 'count=' + auditsD.length);
let nv = {}; try { nv = JSON.parse(auditsD[0] && auditsD[0].new_value || '{}'); } catch {}
let ov = {}; try { ov = JSON.parse(auditsD[0] && auditsD[0].old_value || '{}'); } catch {}
ok('D2: audit has old/new/base/difference', ov.price === 100000 && nv.price === 95000 && nv.base_price === 100000 && nv.difference === -5000, JSON.stringify({ ov, nv }));
ok('D3: audit has user + timestamp + document + product + reason', auditsD[0].user_id === meM.user.id && auditsD[0].username === 'ali.k' && auditsD[0].user_name === undefined && !!auditsD[0].at && nv.user_name === (meM.user.full_name || '') && nv.document_type === 'quote' && nv.document_id === quote1.id && nv.product_id === prodA.id && nv.product_code === 'OVR-A' + SUF && nv.reason === 'تخفیف رقابتی', JSON.stringify(auditsD[0] ? { u: auditsD[0].user_id, at: auditsD[0].at, ip: auditsD[0].ip, nv } : null));
ok('D4: audit has IP captured', !!auditsD[0].ip, 'ip=' + auditsD[0].ip);

// ---------- Test G: Proforma → Order → Invoice chain keeps 95000 ----------
const toOrder = await req('POST', `/api/quotes/${quote1.id}/to-order`, {}, M);
ok('G1: quote → order conversion', toOrder.status === 200 && toOrder.data.order_id, JSON.stringify(toOrder.data));
const oid = toOrder.data.order_id;
const oitems = q1a('SELECT * FROM order_items WHERE order_id=?', oid);
ok('G2: order line A price = 95000 (final, not base)', oitems.some(i => i.product_id === prodA.id && i.price === 95000), JSON.stringify(oitems.map(i => [i.product_id, i.price])));
const toInv = await req('POST', `/api/orders/${oid}/to-invoice`, {}, M);
ok('G3: order → invoice conversion', toInv.status === 200 && toInv.data.invoice_id, JSON.stringify(toInv.data));
const inv = q1s('SELECT * FROM invoices WHERE id=?', toInv.data.invoice_id);
const iitems = q1a('SELECT * FROM invoice_items WHERE invoice_id=?', inv.id);
ok('G4: invoice line A price = 95000', iitems.some(i => i.product_id === prodA.id && i.price === 95000), JSON.stringify(iitems.map(i => [i.product_id, i.price])));
ok('G5: invoice subtotal = 390000 (final-price based)', inv.subtotal === 390000, 'subtotal=' + inv.subtotal);

// ---------- Test E: second change 95000 → 90000 → new audit, old kept ----------
const tE = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 90000, override_reason: 'اصلاح قیمت پس از مذاکره' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
ok('E1: second override accepted', tE.status === 200, JSON.stringify(tE.data));
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('E2: line now 90000, base still 100000', lineA.price === 90000 && lineA.base_price === 100000, 'price=' + lineA.price);
const auditsE = q1a("SELECT * FROM audit_logs WHERE action='PRICE_OVERRIDE' AND entity_id=? ORDER BY id", quote1.id);
ok('E3: 2 PRICE_OVERRIDE audits (new added, old kept)', auditsE.length === 2, 'count=' + auditsE.length);
ok('E4: first audit intact (100000→95000)', auditsE.length === 2 && JSON.parse(auditsE[0].new_value).price === 95000, auditsE[0] && auditsE[0].new_value);
ok('E5: second audit (95000→90000)', auditsE.length === 2 && JSON.parse(auditsE[1].old_value).price === 95000 && JSON.parse(auditsE[1].new_value).price === 90000, auditsE[1] && auditsE[1].new_value);
const oitems2 = q1a('SELECT * FROM order_items WHERE order_id=?', oid);
ok('E6: order snapshot unaffected (still 95000 after later quote edit)', oitems2.some(i => i.product_id === prodA.id && i.price === 95000), JSON.stringify(oitems2.map(i => [i.product_id, i.price])));
// no-op re-save → no extra audit
const tE2 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 90000, override_reason: 'اصلاح قیمت پس از مذاکره' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
ok('E7: no-op re-save accepted without new audit', tE2.status === 200 && countAudit('PRICE_OVERRIDE', quote1.id) === 2, 'count=' + countAudit('PRICE_OVERRIDE', quote1.id));

// ---------- Test F: Price List unchanged ----------
const pliA = q1s("SELECT * FROM price_list_items WHERE price_list_id=? AND product_id=? AND COALESCE(customer_id,0)=0 AND payment_stage='cash'", pl.id, prodA.id);
ok('F1: price list product A cash still 100000', pliA && pliA.price === 100000, 'price=' + (pliA && pliA.price));
const pliA3 = q1s("SELECT * FROM price_list_items WHERE price_list_id=? AND product_id=? AND COALESCE(customer_id,0)=0 AND payment_stage='3_month'", pl.id, prodA.id);
ok('F2: price list 3_month stage still 115000', pliA3 && pliA3.price === 115000, 'price=' + (pliA3 && pliA3.price));

// ---------- Test H: direct API tampering by unauthorized user ----------
const h1 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 50000, override_reason: 'حمله مستقیم' },
]}, S);
ok('H1: tampered unit price (50000) → 403', h1.status === 403, 'status=' + h1.status);
const h2 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, override_price: 50000, price: 100000, override_reason: 'حمله مستقیم' },
]}, S);
ok('H2: injected override_price → 403', h2.status === 403, 'status=' + h2.status);
const h2b = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: 999999, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 50000, override_reason: 'id جعلی' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, S);
ok('H2b: forged line id + tampered price (unauthorized) → 403 (server-side product match)', h2b.status === 403, 'status=' + h2b.status);
// forged flag + no price ⇒ backend resolves final = base ⇒ a REAL change
// (restore 90000→100000) — unauthorized user must be blocked even though the
// client never sent a price (stale/missing line id must not help either)
const h3 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, override: true, unit_price: 1, override_reason: 'فلگ جعلی' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, S);
const h3b = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: 999999, product_id: prodA.id, name: 'ردیف A', qty: 2, override: true, unit_price: 1, override_reason: 'فلگ جعلی' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, S);
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('H3: forged override flag (no price, unauthorized) → 403', h3.status === 403, 'status=' + h3.status);
ok('H3b: same forged flag with forged line id (unauthorized) → 403', h3b.status === 403, 'status=' + h3b.status);
ok('H3c: state unchanged (line still 90000, no new audit)', lineA.price === 90000 && countAudit('PRICE_OVERRIDE', quote1.id) === 2 && countAudit('PRICE_RESTORE', quote1.id) === 0, 'price=' + lineA.price + ' audits=' + countAudit('PRICE_OVERRIDE', quote1.id));
const h3c = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, override: true, unit_price: 1, override_reason: '' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
ok('H3d: even an authorized user cannot restore without a reason (422)', h3c.status === 422, 'status=' + h3c.status);
const h4 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 100000, override: true, override_reason: 'دلیل جعلی با فلگ' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
const auditsH = q1a("SELECT * FROM audit_logs WHERE action IN ('PRICE_OVERRIDE','PRICE_RESTORE') AND entity_id=? ORDER BY id DESC", quote1.id);
ok('H4: authorized user: price=base with forged flag → stored as NON-override, flag ignored', h4.status === 200 && lineA.price === 100000 && lineA.override_status === 0 && lineA.override_reason === null, JSON.stringify({ price: lineA.price, status: lineA.override_status }));
ok('H5: restoring to base price IS audited (PRICE_RESTORE)', auditsH[0] && auditsH[0].action === 'PRICE_RESTORE', auditsH[0] && auditsH[0].action);

// ---------- security extras ----------
const s1 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 94000, override_reason: "'); DROP TABLE quote_items;--" },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
const tableAlive = q1s("SELECT name FROM sqlite_master WHERE type='table' AND name='quote_items'");
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('S1: SQLi in reason rejected as text (table intact, stored verbatim)', s1.status === 200 && !!tableAlive && lineA.override_reason === "'); DROP TABLE quote_items;--", 'reason=' + lineA.override_reason);
const s2 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 93000, override_reason: '<img src=x onerror=alert(1)>' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('S2: XSS payload stored as inert text (UI renders via textContent)', s2.status === 200 && lineA.override_reason === '<img src=x onerror=alert(1)>', 'reason=' + lineA.override_reason);
const s3 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 92000, override_reason: 'mass assignment', total: 999999, status: 'cancelled', created_by: 999, archived_at: '2000-01-01T00:00:00Z' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
]}, M);
const q1after = (await req('GET', `/api/r/quote/${quote1.id}`, undefined, M)).data.item;
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('S3: mass-assignment fields ignored (quote untouched, only price applied)', s3.status === 200 && q1after.status === 'converted' && q1after.created_by === 1 && lineA.price === 92000, 'status=' + q1after.status);
const s4 = await req('PUT', `/api/r/quote/${quote2.id}/items`, { items: [
  { product_id: prodA.id, name: 'ردیف A', qty: 1, price: 100000 },
]}, S);
ok('S4: IDOR — sara.m cannot edit quote outside her scope (salesperson=ali.k)', s4.status === 403, 'status=' + s4.status);
const s5 = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 2, price: 92000, override_reason: 'mass assignment' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
  { id: 999999, product_id: null, name: 'ردیف آزاد', qty: 1, price: 12345 },
]}, M);
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
const freeLine = items.find(i => i.name === 'ردیف آزاد');
ok('S5: unknown line id treated as new line (no crash, no phantom match)', s5.status === 200 && !!freeLine && freeLine.price === 12345, JSON.stringify(freeLine && { price: freeLine.price }));
const s6a = await req('GET', '/api/r/audit_log', undefined, A);
const s6b = await req('PUT', '/api/r/audit_log/1', { action: 'hacked' }, A);
ok('S6: no CRUD surface for audit_logs (GET module 404, PUT 404)', s6a.status === 404 && s6b.status === 404, 'GET=' + s6a.status + ' PUT=' + s6b.status);

// ---------- payment stage via price-suggest ----------
const sug6 = (await req('GET', `/api/quotes/price-suggest?product_id=${prodA.id}&customer_id=${custA.id}&price_list_id=${pl.id}&payment_stage=6_month`, undefined, M)).data;
ok('stage: 6_month base = 130000', sug6.price === 130000 && sug6.stage === '6_month', JSON.stringify(sug6));
const sug3 = (await req('GET', `/api/quotes/price-suggest?product_id=${prodA.id}&customer_id=${custA.id}&price_list_id=${pl.id}&payment_stage=3_month`, undefined, M)).data;
ok('stage: 3_month base = 115000', sug3.price === 115000, JSON.stringify(sug3));
const sugCash = (await req('GET', `/api/quotes/price-suggest?product_id=${prodA.id}&customer_id=${custA.id}&price_list_id=${pl.id}`, undefined, M)).data;
ok('stage: default (no stage param) = cash 100000', sugCash.price === 100000, JSON.stringify(sugCash));
// stage-aware line save on quote2 (ali.k is salesperson → in scope for himself)
const tStage = await req('PUT', `/api/r/quote/${quote2.id}/items`, { items: [
  { product_id: prodA.id, name: 'ردیف A 3ماهه', qty: 1, payment_stage: '3_month', price: 115000 },
]}, M);
const items2 = (await req('GET', `/api/r/quote/${quote2.id}/items`, undefined, M)).data.items;
const l2 = items2.find(i => i.product_id === prodA.id);
ok('stage: line saved at 3_month base without override', tStage.status === 200 && l2 && l2.base_price === 115000 && l2.price === 115000 && l2.override_status === 0 && l2.payment_stage === '3_month', JSON.stringify(l2 && { base: l2.base_price, price: l2.price, st: l2.payment_stage }));
// unauthorized user may still re-save an UNCHANGED override line (e.g. edit qty only)
const tKeep = await req('PUT', `/api/r/quote/${quote1.id}/items`, { items: [
  { id: lineA.id, product_id: prodA.id, name: 'ردیف A', qty: 3, price: 92000, override_reason: 'mass assignment' },
  { id: lineB.id, product_id: prodB.id, name: 'ردیف B', qty: 1, price: 200000 },
  { id: freeLine.id, product_id: null, name: 'ردیف آزاد', qty: 1, price: 12345 },
]}, S);
items = (await req('GET', `/api/r/quote/${quote1.id}/items`, undefined, M)).data.items;
lineA = items.find(i => i.product_id === prodA.id);
ok('keep: unprivileged user re-saving an unchanged override line (qty edit) allowed, override preserved', tKeep.status === 200 && lineA.price === 92000 && lineA.qty === 3 && lineA.override_status === 1, 'status=' + tKeep.status + ' price=' + lineA.price + ' qty=' + lineA.qty);

// ---------- final audit trail sanity ----------
const trail = (await req('GET', `/api/r/quote/${quote1.id}/audit`, undefined, A)).data.items;
ok('trail: quote audit tab contains PRICE_OVERRIDE entries with user+time', trail.some(x => x.action === 'PRICE_OVERRIDE' && x.username === 'ali.k' && x.at), trail.filter(x => x.action === 'PRICE_OVERRIDE').length + ' override rows');

// ---------- summary ----------
console.log('\n========== PRICE OVERRIDE + AUDIT — RESULTS ==========');
for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + extra + ']' : ''}`);
console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
console.log(`Dataset: customers=${custA.id},${custB.id} products=${prodA.id},${prodB.id} price_list=${pl.id} quotes=${quote1.id},${quote2.id} order=${oid} invoice=${toInv.data.invoice_id}`);
process.exit(fail ? 1 : 0);
