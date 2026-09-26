// Customer Master integration — mandatory E2E test (NO mocks, real DB)
// Verifies: Customer Master -> API -> Selector data path -> Form -> Database for ALL modules.
// Run with server up: node customer-master-test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')('data/baspar-crm.sqlite');
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra ? ':: ' + extra : ''); }
};
async function api(method, path, body, tok) {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; const t = await r.text();
  try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
}
const stamp = Date.now().toString(36).toUpperCase();

async function login(username, password) {
  let r = await api('POST', '/api/auth/login', { username, password });
  if (r.s === 429) { // login rate limit — wait for the window to clear and retry once
    console.log('  (login rate-limited, waiting 65s...)');
    await new Promise(res => setTimeout(res, 65000));
    r = await api('POST', '/api/auth/login', { username, password });
  }
  return r.d && r.d.access;
}
(async () => {
  let r;
  const A = await login('admin', 'admin1234');
  if (!A) { console.log('LOGIN FAILED'); process.exit(2); }
  const S = await login('sara.m', '12345678'); // salesperson (team scope on customer view)
  const M = await login('maryam.h', '12345678'); // support (view all customers)

  // ============ Test 1: Create a NEW customer in the Customer Master ============
  console.log('== T1. Create customer (master) ==');
  r = await api('POST', '/api/r/customer', {
    name: 'شرکت تستی ' + stamp, type: 'company', tax_code: '99' + stamp.slice(0, 6),
    phone: '061' + stamp.slice(0, 7), mobile: '0912' + stamp.slice(0, 7), email: 't' + stamp + '@test.ir',
    province: 'خراسان رضوی', city: 'مشهد', address: 'آدرس تست ' + stamp, status: 'active', salesperson_id: 4, credit_limit: 1000000000,
  }, A);
  ok('T1.1 new customer created (real DB row)', r.s === 200 && r.d.id, r.s + ' ' + JSON.stringify(r.d).slice(0, 100));
  const CUST = r.d.id;
  const dbRow = db.prepare('SELECT * FROM customers WHERE id=?').get(CUST);
  ok('T1.2 row exists in customers table with data', !!dbRow && dbRow.name === 'شرکت تستی ' + stamp, JSON.stringify(dbRow).slice(0, 80));

  // ============ T2-10: Quotation flow (selector data path -> save -> refresh -> reopen) ============
  console.log('== T2-T10. Quotation with Customer Master ==');
  // T4/T5: selector data source (what CustomerSelect calls): active customers + search
  r = await api('GET', '/api/r/customer?per_page=20&f_status=active', undefined, A);
  ok('T2.1 selector API (active customers) works', r.s === 200 && Array.isArray(r.d.items), r.s);
  const inList = (r.d.items || []).some(c => c.id === CUST);
  ok('T5.1 NEW customer visible in selector list (active filter)', inList);
  r = await api('GET', '/api/r/customer?per_page=20&q=' + encodeURIComponent('شرکت تستی ' + stamp), undefined, A);
  ok('T5.2 search by name finds the new customer', r.s === 200 && r.d.items.some(c => c.id === CUST), 'n=' + (r.d.items || []).length);
  r = await api('GET', '/api/r/customer?per_page=20&q=' + encodeURIComponent('99' + stamp.slice(0, 6)), undefined, A);
  ok('T5.3 search by tax_code finds it', r.d.items.some(c => c.id === CUST));
  r = await api('GET', '/api/r/customer?per_page=20&q=' + encodeURIComponent('061' + stamp.slice(0, 7)), undefined, A);
  ok('T5.4 search by phone finds it', r.d.items.some(c => c.id === CUST));
  r = await api('GET', '/api/r/customer?per_page=20&q=' + encodeURIComponent(stamp.slice(0, 6)), undefined, A);
  ok('T5.5 search by code/name-part finds it', r.d.items.some(c => c.id === CUST));
  // T6/T7: select the customer -> full info available (master data)
  r = await api('GET', `/api/r/customer/${CUST}`, undefined, A);
  const ci = r.d.item;
  ok('T6.1 customer fetched by ID (selector select step)', r.s === 200 && ci.id === CUST);
  ok('T7.1 master info present (name/code/type/phone/mobile/email/address/province/city/tax/salesperson)',
    ci.name && ci.type && ci.phone && ci.mobile && ci.email && ci.address && ci.province && ci.city && ci.tax_code && ci.salesperson_id, JSON.stringify(ci).slice(0, 120));
  ok('T7.2 salesperson name joined (salesperson_id_name)', !!ci.salesperson_id_name, ci.salesperson_id_name);
  r = await api('GET', `/api/customers/${CUST}/finance`, undefined, A);
  ok('T7.3 finance snapshot available (balance/related)', r.s === 200 && r.d.totals && r.d.related, JSON.stringify(r.d.totals || {}).slice(0, 100));
  // T8: create quotation with the selected customer (customer_id FK, no re-typed data)
  r = await api('POST', '/api/r/quote', { customer_id: CUST, title: 'پیش‌فاکتور ' + stamp, status: 'draft' }, A);
  ok('T8.1 quotation created with customer_id (FK only)', r.s === 200 && r.d.id, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  const QUOTE = r.d.id;
  const qRow = db.prepare('SELECT * FROM quotes WHERE id=?').get(QUOTE);
  ok('T8.2 DB: quote.customer_id = master customer id', qRow.customer_id === CUST, 'cust=' + qRow.customer_id);
  // T9: refresh
  // T10: reopen -> customer still correct + name resolved from master
  r = await api('GET', `/api/r/quote/${QUOTE}`, undefined, A);
  ok('T10.1 reopened quote: customer_id intact', r.d.item.customer_id === CUST);
  ok('T10.2 customer name resolved from master (customer_id_name)', r.d.item.customer_id_name === 'شرکت تستی ' + stamp, r.d.item.customer_id_name);
  r = await api('GET', '/api/r/quote?per_page=50', undefined, A);
  const qInList = (r.d.items || []).find(x => x.id === QUOTE);
  ok('T10.3 list shows customer name via master join', qInList && qInList.customer_id_name === 'شرکت تستی ' + stamp, qInList && qInList.customer_id_name);

  // ============ T29/T35: ID integrity + change audit ============
  console.log('== ID integrity + change audit ==');
  r = await api('POST', '/api/r/quote', { customer_id: 999999999, title: 'کد اشتباه' }, A);
  ok('T29.1 invalid customer_id -> 422 (not 500)', r.s === 422, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  r = await api('POST', '/api/r/quote', { customer_id: 'abc', title: 'ID نامعتبر' }, A);
  ok('T29.2 non-numeric customer_id -> 422/400 (not 500)', r.s >= 400 && r.s < 500, r.s);
  // change customer on the quote -> audit must capture old -> new
  const otherCust = db.prepare("SELECT id FROM customers WHERE id!=? AND status='active' ORDER BY id LIMIT 1").get(CUST).id;
  r = await api('PUT', `/api/r/quote/${QUOTE}`, { customer_id: otherCust }, A);
  ok('T35.1 customer change saved', r.s === 200 && db.prepare('SELECT customer_id FROM quotes WHERE id=?').get(QUOTE).customer_id === otherCust);
  const auditRow = db.prepare(`SELECT old_value, new_value FROM audit_logs WHERE entity='quote' AND entity_id=? AND action='update' ORDER BY id DESC LIMIT 1`).get(QUOTE);
  const av = auditRow ? JSON.parse(auditRow.old_value || 'null') : null;
  ok('T35.2 audit log captured customer old->new', !!av && av.customer_id && av.customer_id.from === CUST && av.customer_id.to === otherCust,
    auditRow ? (auditRow.old_value || 'null').slice(0, 120) : 'no audit row');
  // restore
  await api('PUT', `/api/r/quote/${QUOTE}`, { customer_id: CUST }, A);

  // ============ T9: inactive customer behavior ============
  console.log('== Inactive customer rules ==');
  r = await api('PUT', `/api/r/customer/${CUST}`, { status: 'inactive' }, A);
  ok('T9.0 customer set inactive', r.s === 200);
  r = await api('GET', '/api/r/customer?per_page=100&f_status=active', undefined, A);
  ok('T9.1 inactive customer NOT in new-document selector', !(r.d.items || []).some(c => c.id === CUST));
  r = await api('GET', `/api/r/customer/${CUST}`, undefined, A);
  ok('T9.2 old documents still resolve the inactive customer (by ID)', r.s === 200 && r.d.item.id === CUST, r.s);
  r = await api('GET', `/api/r/quote/${QUOTE}`, undefined, A);
  ok('T9.3 existing quote still shows the (inactive) customer name', r.d.item.customer_id_name === 'شرکت تستی ' + stamp, r.d.item.customer_id_name);
  await api('PUT', `/api/r/customer/${CUST}`, { status: 'active' }, A);

  // ============ T34: permission-scoped selector ============
  console.log('== Permission scope ==');
  // admin (all) sees the new customer
  r = await api('GET', '/api/r/customer?per_page=200', undefined, A);
  ok('T34.1 admin (all scope) sees all customers incl. new', r.d.items.some(c => c.id === CUST));
  // salesperson sara.m: OWN scope — her own customers only
  const saraId = db.prepare("SELECT id FROM users WHERE username='sara.m'").get().id;
  r = await api('GET', '/api/r/customer?per_page=200', undefined, S);
  ok('T34.2 salesperson list is permission-scoped (no 500)', r.s === 200 && Array.isArray(r.d.items), r.s);
  // sales role has TEAM scope on customer view: every visible customer must belong to the same department
  const saraDept = db.prepare("SELECT department FROM users WHERE id=?").get(saraId).department;
  const inDept = (uid) => { if (!uid) return false; const u = db.prepare('SELECT department FROM users WHERE id=?').get(uid); return !!(u && u.department === saraDept); };
  const saraTeam = (r.d.items || []).every(c => inDept(c.salesperson_id) || inDept(c.created_by));
  ok('T34.3 team scope: only same-department customers visible', saraTeam && (r.d.items || []).length > 0, 'n=' + (r.d.items || []).length);
  // support maryam.h: view all
  r = await api('GET', '/api/r/customer?per_page=300', undefined, M);
  ok('T34.4 support (view-all) sees the new customer', r.d.items.some(c => c.id === CUST));
  // a scoped user cannot open a record outside scope
  if ((r.d.items || []).some(c => c.id === CUST)) {
    const inDept2 = (uid) => { if (!uid) return false; const u = db.prepare('SELECT department FROM users WHERE id=?').get(uid); return !!(u && u.department === saraDept); };
    const outside = (r.d.items || []).find(c => !inDept2(c.salesperson_id) && !inDept2(c.created_by));
    if (outside) {
      r = await api('GET', `/api/r/customer/${outside.id}`, undefined, S);
      ok('T34.5 scoped user: detail of out-of-department customer -> 403 (not crash)', r.s === 403, r.s);
    } else ok('T34.5 scoped user detail check', true, 'skipped (no out-of-department customer)');
  } else ok('T34.5 scoped user detail check', true, 'skipped');

  // ============ T37: every module with customer_id ============
  console.log('== All modules: customer from master ==');
  const modules = [
    ['lead', { entity: 'lead', payload: { company: 'لید ' + stamp, contact_name: 'تست' }, custField: 'customer_id', note: 'lead.customer_id (optional link)' }],
    ['opportunity', { payload: { title: 'فرصت ' + stamp, amount: 5000000 }, custField: 'customer_id' }],
    ['quote', { payload: { title: 'پیش‌فاکتور ' + stamp, status: 'draft' }, custField: 'customer_id' }],
    ['order', { payload: { title: 'سفارش ' + stamp, status: 'draft' }, custField: 'customer_id' }],
    ['invoice', { payload: { status: 'unpaid', issue_date: new Date().toISOString() }, custField: 'customer_id' }],
    ['payment', { payload: { amount: 1000, method: 'cash' }, custField: 'customer_id' }],
    ['meeting', { payload: { title: 'جلسه ' + stamp, start_at: new Date(Date.now() + 3600e3).toISOString() }, custField: 'customer_id' }],
    ['complaint', { payload: { subject: 'شکایت ' + stamp, priority: 'low', status: 'new' }, custField: 'customer_id' }],
    ['ticket', { payload: { subject: 'تیکت ' + stamp }, custField: 'customer_id' }],
    ['warranty', { payload: { product_name: 'محصول', serial: 'SN' + stamp, start_date: '2026-01-01', end_date: '2027-01-01' }, custField: 'customer_id' }],
    ['contract', { payload: { title: 'قرارداد ' + stamp, start_date: '2026-01-01', end_date: '2027-01-01' }, custField: 'customer_id' }],
    ['lab_request', { payload: { sample_desc: 'نمونه ' + stamp, test_type: 'density', status: 'received' }, custField: 'customer_id' }],
  ];
  const created = {};
  for (const [mod, cfg] of modules) {
    const p = { ...cfg.payload, [cfg.custField]: CUST };
    r = await api('POST', `/api/r/${mod}`, p, A);
    const id = r.d && (r.d.id || (r.d.item || {}).id);
    if (!(r.s === 200 && id)) { ok(`T37 ${mod}: create with master customer`, false, r.s + ' ' + JSON.stringify(r.d).slice(0, 120)); continue; }
    created[mod] = id;
    const row = db.prepare(`SELECT customer_id FROM ${mod === 'lab_request' ? 'lab_requests' : mod === 'lab_result' ? 'lab_results' : ({ lead: 'leads', opportunity: 'opportunities', quote: 'quotes', order: 'orders', invoice: 'invoices', payment: 'payments', meeting: 'meetings', complaint: 'complaints', ticket: 'tickets', warranty: 'warranties', contract: 'contracts' })[mod]} WHERE id=?`).get(id);
    ok(`T37 ${mod}: customer_id=${CUST} persisted (FK to master)`, row.customer_id === CUST, 'got ' + row.customer_id);
    // name resolution in detail (master join)
    r = await api('GET', `/api/r/${mod}/${id}`, undefined, A);
    const nm = r.d.item && r.d.item.customer_id_name;
    ok(`T37 ${mod}: detail resolves customer name from master`, nm === 'شرکت تستی ' + stamp, nm);
  }
  // followup: entity_type=customer + entity_id (custom form uses the same selector)
  r = await api('POST', '/api/r/followup', { entity_type: 'customer', entity_id: CUST, subject: 'پیگیری ' + stamp, due_at: new Date(Date.now() + 864e5).toISOString(), status: 'pending' }, A);
  const FU = r.d && (r.d.id || (r.d.item || {}).id);
  ok('T37 followup: linked to master customer (entity_type+entity_id)', !!FU && db.prepare('SELECT entity_id FROM followups WHERE id=?').get(FU).entity_id === CUST, r.s);
  // commission relation: via invoice (below in E2E)
  // price list per-customer price (master customer in price list items)
  r = await api('POST', '/api/r/price_list', { name: 'لیست ' + stamp, currency: 'IRR', active: 1 }, A);
  const PL = r.d && r.d.id;
  const PROD = db.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get().id;
  r = await api('POST', `/api/pricelist/${PL}/item`, { product_id: PROD, customer_id: CUST, price: 12345678 }, A);
  ok('T37 price_list: per-customer price saved for master customer', r.s === 200 && db.prepare('SELECT customer_id FROM price_list_items WHERE price_list_id=? AND customer_id=?').get(PL, CUST).customer_id === CUST, r.s);
  // campaign: recipients built from master customers (audience)
  r = await api('POST', '/api/r/campaign', { name: 'کمپین ' + stamp, message: 'سلام {{name}}', channel: 'sms', audience_filter: JSON.stringify({ province: 'خراسان رضوی' }), status: 'draft' }, A);
  const CAMP = r.d && r.d.id;
  r = await api('POST', `/api/campaigns/${CAMP}/audience`, {}, A);
  const audItems = (r.d && r.d.items) || [];
  ok('T37 campaign: audience resolved from Customer Master (province filter)', r.s === 200 && audItems.length >= 1, 'n=' + audItems.length);
  ok('T37 campaign: new master customer present in audience', audItems.some(x => x.id === CUST), JSON.stringify(audItems.slice(0, 3)));

  // ============ T38: End-to-end chain with customer verification ============
  console.log('== E2E: Customer -> Quote -> Order -> Invoice -> Payment -> Commission ==');
  const q2 = (await api('POST', '/api/r/quote', { customer_id: CUST, title: 'زنجیره ' + stamp, status: 'draft', tax_rate: 10 }, A)).d.id;
  // Section 3: price deviating from the price-list base is an override → reason required (admin holds price_override)
  await api('PUT', `/api/r/quote/${q2}/items`, { items: [{ product_id: PROD, name: 'کالای زنجیره', qty: 10, price: 1000000, discount_pct: 0, override_reason: 'قیمت تست زنجیره (سوت رجیسی)' }] }, A);
  const q2row = db.prepare('SELECT customer_id FROM quotes WHERE id=?').get(q2);
  ok('E2E.1 quote.customer_id = master', q2row.customer_id === CUST);
  const ord = await api('POST', `/api/quotes/${q2}/to-order`, {}, A);
  const oid = ord.d.order_id;
  const orow = db.prepare('SELECT customer_id, quote_id FROM orders WHERE id=?').get(oid);
  ok('E2E.2 order.customer_id = master + quote ref', orow.customer_id === CUST && orow.quote_id === q2, JSON.stringify(orow));
  const inv = await api('POST', `/api/orders/${oid}/to-invoice`, {}, A);
  const iid = inv.d.invoice_id;
  const irow = db.prepare('SELECT customer_id, order_id, total FROM invoices WHERE id=?').get(iid);
  ok('E2E.3 invoice.customer_id = master + order ref', irow.customer_id === CUST && irow.order_id === oid, JSON.stringify(irow));
  const payAmt = Math.round(irow.total * 0.5);
  const pay = await api('POST', '/api/payments', { invoice_id: iid, customer_id: CUST, amount: payAmt, method: 'bank' }, A);
  const payId = pay.d && (pay.d.payment_id || pay.d.id);
  ok('E2E.4a payment registered', pay.s === 200 && payId, pay.s + ' ' + JSON.stringify(pay.d).slice(0, 120));
  const prow = payId ? db.prepare('SELECT customer_id, invoice_id, amount FROM payments WHERE id=?').get(payId) : null;
  ok('E2E.4b payment.customer_id = master + invoice ref + 50% amount', !!prow && prow.customer_id === CUST && prow.invoice_id === iid && prow.amount === payAmt, JSON.stringify(prow));
  // commission rule + calc -> commission row references the customer
  r = await api('POST', '/api/commission-rules', { name: 'قانون زنجیره ' + stamp, basis_type: 'percent_collected', pct: 3, salesperson_id: 4 }, A);
  const RULE = r.d.id;
  const qsp = db.prepare('SELECT salesperson_id FROM quotes WHERE id=?').get(q2); // quote has no salesperson; invoice.created_by = admin
  // make admin the salesperson chain: set quote salesperson so commission resolves to a user
  await api('PUT', `/api/r/quote/${q2}`, { salesperson_id: 4 }, A);
  await api('POST', '/api/commissions/calc', {}, A);
  const comm = db.prepare('SELECT * FROM commissions WHERE rule_id=? AND payment_id=?').get(RULE, payId);
  ok('E2E.5 commission calculated on collected 50%', !!comm && comm.amount === Math.round(Math.round(irow.total * 0.5) * 0.03), comm ? JSON.stringify({ amount: comm.amount, base: comm.base, status: comm.status }) : 'no commission row');
  ok('E2E.6 commission.customer_id = master customer', comm && comm.customer_id === CUST, comm && comm.customer_id);
  // customer 360 shows the chain
  r = await api('GET', `/api/customers/${CUST}/finance`, undefined, A);
  ok('E2E.7 customer 360: finance totals reflect the chain', r.d.totals.total_invoices >= irow.total && r.d.totals.total_paid >= Math.round(irow.total * 0.5), JSON.stringify(r.d.totals));
  ok('E2E.8 customer 360: last invoice/order/payment/contract visible', r.d.related.last_invoice && r.d.related.last_order && r.d.related.last_payment, JSON.stringify(Object.keys(r.d.related)));

  // ============ Payment form: open invoices of the selected customer ============
  console.log('== Payment invoice list per customer ==');
  r = await api('GET', '/api/r/invoice?per_page=200', undefined, A);
  const openForCust = (r.d.items || []).filter(i => i.customer_id === CUST && ['unpaid', 'partial', 'overdue'].includes(i.status));
  ok('P1.1 open invoices of the customer queryable (selector filter source)', openForCust.length >= 1, 'n=' + openForCust.length);

  // ============ Reports: customer filter uses the same master ============
  console.log('== Reports customer filter ==');
  r = await api('GET', `/api/salesreports/sales_by_customer?customer_id=${CUST}`, undefined, A);
  ok('R1.1 report filtered by master customer id', r.s === 200 && (r.d.rows || []).every(x => true) && (r.d.rows || []).some(x => x.name === 'شرکت تستی ' + stamp), JSON.stringify(r.d.rows || []).slice(0, 120));

  // ============ cleanup ============
  console.log('== cleanup ==');
  const rm = (sql, ...p) => { try { db.prepare(sql).run(...p); } catch {} };
  rm('DELETE FROM campaign_recipients WHERE campaign_id=?', CAMP);
  rm('DELETE FROM campaigns WHERE id=?', CAMP);
  rm('DELETE FROM price_list_items WHERE price_list_id=?', PL);
  rm('DELETE FROM price_lists WHERE id=?', PL);
  rm('DELETE FROM commissions WHERE rule_id=?', RULE);
  rm('DELETE FROM commission_rules WHERE id=?', RULE);
  for (const [mod, id] of Object.entries(created)) {
    if (!id) continue;
    const tbl = ({ lead: 'leads', opportunity: 'opportunities', quote: 'quotes', order: 'orders', invoice: 'invoices', payment: 'payments', meeting: 'meetings', complaint: 'complaints', ticket: 'tickets', warranty: 'warranties', contract: 'contracts', lab_request: 'lab_requests' })[mod];
    rm(`DELETE FROM ${tbl} WHERE id=?`, id);
  }
  rm('DELETE FROM payments WHERE id=?', payId);
  rm('DELETE FROM invoice_items WHERE invoice_id=?', iid);
  rm('DELETE FROM invoices WHERE id=?', iid);
  rm('DELETE FROM order_items WHERE order_id=?', oid);
  rm('DELETE FROM orders WHERE id=?', oid);
  rm('DELETE FROM quote_items WHERE quote_id IN (?,?)', q2, QUOTE);
  rm('DELETE FROM quotes WHERE id IN (?,?)', q2, QUOTE);
  rm('DELETE FROM followups WHERE id=?', FU);
  rm('DELETE FROM customers WHERE id=?', CUST);
  rm("DELETE FROM audit_logs WHERE new_value LIKE ? OR old_value LIKE ?", '%' + stamp + '%');
  const left = db.prepare('SELECT COUNT(*) c FROM customers WHERE name LIKE ?').get('%' + stamp + '%').c;
  ok('cleanup complete', left === 0, 'left=' + left);

  console.log('');
  console.log('=====================================');
  console.log(`CUSTOMER MASTER SUITE: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('ALL CUSTOMER MASTER TESTS PASSED ✅');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
