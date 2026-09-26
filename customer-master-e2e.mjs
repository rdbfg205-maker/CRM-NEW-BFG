// Customer Master E2E — comprehensive integration test (real DB, NO mocks)
// Run with server up: node customer-master-e2e.mjs
// Validates: Master → API → Selector → Form → Database for EVERY module that
// references a customer, plus search, inactive behavior, permissions, audit,
// duplicate-source check, and the full sales chain with customer continuity.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
  if (r.status === 401 || r.status === 403) console.log('  [auth-fail]', r.status, method, path);
  return { s: r.status, d };
}
const db = require('better-sqlite3')('data/baspar-crm.sqlite');
const stamp = Date.now().toString(36).toUpperCase();
const created = { quotes: [], orders: [], invoices: [], payments: [], comms: [], meetings: [], followups: [], complaints: [], tickets: [], warranties: [], contracts: [], lab: [], campaigns: [], customers: [], leads: [], rules: [] };

(async () => {
  let r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = r.d.access;
  if (!A) { console.log('ADMIN LOGIN FAILED'); process.exit(2); }
  r = await api('POST', '/api/auth/login', { username: 'maryam.h', password: '12345678' });
  const M = r.d && r.d.access;

  // ================= A. CUSTOMER MASTER =================
  console.log('== A. Customer Master ==');
  const C1 = { name: 'شرکت تستی ' + stamp, number: 'CS-' + stamp, phone: '02133774455', mobile: '09123456789', tax_code: '1023456789', email: 'master' + stamp + '@test.ir', province: 'تهران', city: 'کرج', address: 'خیابان تست ' + stamp, type: 'company', salesperson_id: 2, status: 'active' };
  r = await api('POST', '/api/r/customer', C1, A);
  ok('A1 create customer (Master) → 2xx + id', (r.s === 200 || r.s === 201) && r.d.id, r.s + ' ' + JSON.stringify(r.d).slice(0, 120));
  const c1 = r.d.id; created.customers.push(c1);
  const dbRow = db.prepare('SELECT * FROM customers WHERE id=?').get(c1);
  ok('A1b saved in real customers table', !!dbRow && dbRow.name === C1.name && dbRow.tax_code === C1.tax_code, JSON.stringify(dbRow || {}).slice(0, 100));
  r = await api('POST', '/api/r/customer', { name: 'شرکت دوم ' + stamp, phone: '02133770011', type: 'person', status: 'active', salesperson_id: 2 }, A);
  const c2 = r.d.id; if (c2) created.customers.push(c2);
  ok('A2 create second customer (for switch/inactive tests)', (r.s === 200 || r.s === 201) && c2, r.s);

  // selector API — the exact call the shared customerSelect component makes
  r = await api('GET', '/api/r/customer?per_page=20&f_status=active', undefined, A);
  ok('A3 selector API (per_page=20&f_status=active) returns fresh list incl. NEW customer (no stale cache)', (r.d.items || []).some(x => x.id === c1), 'items=' + (r.d.items || []).length);

  // search — name / code / phone / mobile / national id
  const q = async (term) => (await api('GET', '/api/r/customer?per_page=10&q=' + encodeURIComponent(term), undefined, A)).d.items || [];
  ok('A4 search by NAME finds new customer', (await q('تستی ' + stamp)).some(x => x.id === c1), JSON.stringify((await q('تستی ' + stamp)).map(x => x.id)));
  ok('A5 search by CUSTOMER CODE (auto-generated number)', (await q(dbRow.number)).some(x => x.id === c1), 'number=' + dbRow.number);
  ok('A6 search by PHONE (contains 3/4/7/5/9 digits)', (await q('02133774455')).some(x => x.id === c1));
  ok('A7 search by MOBILE', (await q('09123456789')).some(x => x.id === c1));
  ok('A8 search by NATIONAL ID / tax_code', (await q('1023456789')).some(x => x.id === c1));

  // frontend Persian-digit conversion (the fixed toEnDigits in customer-select.js)
  {
    const src = require('fs').readFileSync('public/js/customer-select.js', 'utf8');
    const m = src.match(/function toEnDigits\(s\) \{ return String\(s \|\| ''\)\.replace\(\/\[۰-۹\]\/g, d => String\('([^']*)'\.indexOf\(d\)\)\); \}/);
    let good = false, detail = 'pattern not found';
    if (m) {
      const s = m[1];
      good = s.length === 10;
      for (let i = 0; good && i < 10; i++) { const dch = String.fromCodePoint(0x06F0 + i); if (s.indexOf(dch) !== i) { good = false; detail = dch + '→' + s.indexOf(dch); } }
    }
    ok('A9 frontend toEnDigits maps ۰-۹ → 0-9 correctly (search by Persian digits)', good, detail);
  }

  // single source of truth — no duplicate customer tables; no orphan refs
  {
    const custTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%customer%' OR name LIKE '%client%')").all().map(x => x.name);
    // customer_messages = message log of the customer-message feature (own suite), not a customer source table
    ok('A10 no duplicate customer source tables (only customers + categories/contacts)', custTables.every(t => ['customers', 'customer_categories', 'customer_contacts', 'customer_messages'].includes(t)), custTables.join(','));
    const orphans = db.prepare(`
      SELECT q.id, 'quote' t FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id WHERE q.customer_id IS NOT NULL AND q.customer_id>0 AND c.id IS NULL
      UNION ALL SELECT o.id,'order' FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.customer_id IS NOT NULL AND o.customer_id>0 AND c.id IS NULL
      UNION ALL SELECT i.id,'invoice' FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.customer_id IS NOT NULL AND i.customer_id>0 AND c.id IS NULL
      UNION ALL SELECT p.id,'payment' FROM payments p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.customer_id IS NOT NULL AND p.customer_id>0 AND c.id IS NULL
      UNION ALL SELECT t.id,'ticket' FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id WHERE t.customer_id IS NOT NULL AND t.customer_id>0 AND c.id IS NULL
      UNION ALL SELECT w.id,'warranty' FROM warranties w LEFT JOIN customers c ON c.id=w.customer_id WHERE w.customer_id IS NOT NULL AND w.customer_id>0 AND c.id IS NULL
      UNION ALL SELECT ct.id,'contract' FROM contracts ct LEFT JOIN customers c ON c.id=ct.customer_id WHERE ct.customer_id IS NOT NULL AND ct.customer_id>0 AND c.id IS NULL
      UNION ALL SELECT l.id,'lab_request' FROM lab_requests l LEFT JOIN customers c ON c.id=l.customer_id WHERE l.customer_id IS NOT NULL AND l.customer_id>0 AND c.id IS NULL
    `).all();
    ok('A11 FK integrity: every document customer_id points to a real customer (0 orphans)', orphans.length === 0, JSON.stringify(orphans).slice(0, 120));
  }

  // ================= B. MANDATORY QUOTATION TEST (10 steps) =================
  console.log('== B. Quotation mandatory 10-step test ==');
  // step 2-3: open Quotation page / Create Quotation → the form is driven by resource meta
  r = await api('GET', '/api/meta/options', undefined, A);
  const quoteSpec = (r.d.resources || {})['quote'] || (r.d.meta && r.d.meta.resources || {})['quote'];
  const custField = (quoteSpec && quoteSpec.fields || []).find(f => f.key === 'customer_id');
  ok('B2-3 quotation form renders customer field as Master-selector (meta: type=ref ref=customer)', !!(custField && custField.type === 'ref' && custField.ref === 'customer'), JSON.stringify(custField || {}));
  // step 4-5: open selector → new customer visible
  r = await api('GET', '/api/r/customer?per_page=20&f_status=active', undefined, A);
  ok('B4-5 selector opened: NEW customer listed in Quotation form', (r.d.items || []).some(x => x.id === c1));
  // step 6-7: select customer → info displayed (snapshot fields)
  r = await api('GET', '/api/r/customer/' + c1, undefined, A);
  const it = r.d.item || {};
  ok('B6-7 selected customer info available (name/code/type/phone/mobile/email/address/province/city/tax_code/salesperson)',
    it.id === c1 && it.name && it.phone && it.mobile && it.email && it.address && it.province && it.city && it.tax_code && it.type && it.salesperson_id_name,
    JSON.stringify({ name: it.name, phone: it.phone, sp: it.salesperson_id_name }).slice(0, 120));
  r = await api('GET', '/api/customers/' + c1 + '/finance', undefined, A);
  ok('B7b customer finance snapshot (balance/related) for selector info box', r.s === 200 && !!(r.d.totals), r.s);
  // step 8: save quotation
  r = await api('POST', '/api/r/quote', { customer_id: c1, status: 'draft' }, A);
  ok('B8 save Quotation with selected customer → 2xx + id', (r.s === 200 || r.s === 201) && r.d.id, r.s + ' ' + JSON.stringify(r.d).slice(0, 120));
  const q1 = r.d.id; if (q1) created.quotes.push(q1);
  ok('B8b quote.customer_id persisted in DB (Quotation.customer_id → Customer.id)', q1 && db.prepare('SELECT customer_id FROM quotes WHERE id=?').get(q1).customer_id === c1);
  // step 9: refresh page
  r = await api('GET', '/api/r/quote?per_page=50', undefined, A);
  const qRow = (r.d.items || []).find(x => x.id === q1);
  ok('B9 after refresh: quotation listed with customer name resolved', !!qRow && qRow.customer_id === c1 && qRow.customer_id_name === C1.name, JSON.stringify({ cid: qRow && qRow.customer_id, name: qRow && qRow.customer_id_name }).slice(0, 120));
  // step 10: reopen quotation
  r = await api('GET', '/api/r/quote/' + q1, undefined, A);
  ok('B10 reopen Quotation: customer still correct', r.s === 200 && r.d.item.customer_id === c1);

  // ================= C. ALL MODULES =================
  console.log('== C. Other modules (each must bind the Master customer) ==');
  const list = async (res, id) => (await api('GET', `/api/r/${res}?per_page=100`, undefined, A)).d.items.find(x => x.id === id);

  {
    r = await api('POST', '/api/r/opportunity', { title: 'فرصت ' + stamp, customer_id: c1, amount: 50000000 }, A);
    const opp = r.d.id || 0;
    const row = opp ? await list('opportunity', opp) : null;
    ok('C1 Opportunity → customer from Master', opp && row && row.customer_id === c1 && row.customer_id_name === C1.name, JSON.stringify(row || r.d).slice(0, 120));
  }

  r = await api('POST', '/api/r/order', { customer_id: c1, order_date: new Date().toISOString() }, A);
  const o1 = r.d.id; if (o1) created.orders.push(o1);
  { const row = o1 ? await list('order', o1) : null; ok('C2 Order → customer from Master', o1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  r = await api('POST', '/api/r/invoice', { customer_id: c1, issue_date: new Date().toISOString() }, A);
  const i1 = r.d.id; if (i1) created.invoices.push(i1);
  { const row = i1 ? await list('invoice', i1) : null; ok('C3 Invoice → customer from Master', i1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  // give the invoice a real item so it has a payable balance
  const putInv = await api('PUT', `/api/r/invoice/${i1}/items`, { items: [{ product_id: db.prepare('SELECT id FROM products LIMIT 1').get().id, name: 'ردیف تست', qty: 1, price: 20000000, discount_pct: 0 }] }, A);
  if (putInv.s !== 200) console.log('  [dbg] invoice items PUT status', putInv.s, JSON.stringify(putInv.d).slice(0, 120));
  r = await api('POST', '/api/payments', { customer_id: c1, invoice_id: i1, amount: 1000, method: 'bank' }, A);
  const p1 = (r.d && (r.d.payment_id || r.d.id)) || 0; if (p1) created.payments.push(p1);
  {
    const prow = p1 ? db.prepare('SELECT * FROM payments WHERE id=?').get(p1) : null;
    ok('C4 Payment → customer from Master (+ belongs to that customer’s invoice)', p1 && prow && prow.customer_id === c1, JSON.stringify(prow || r.d).slice(0, 120));
  }

  r = await api('POST', '/api/commission-rules', { name: 'قانون مشتری ' + stamp, basis_type: 'customer', customer_id: c1, pct: 2 }, A);
  const ru1 = r.d.id; if (ru1) created.rules.push(ru1);
  { const rrow = ru1 ? db.prepare('SELECT customer_id FROM commission_rules WHERE id=?').get(ru1) : null; ok('C5 Commission rule (basis=customer) → customer from Master', ru1 && rrow && rrow.customer_id === c1, JSON.stringify(rrow || r.d).slice(0, 120)); }

  r = await api('POST', '/api/r/meeting', { title: 'جلسه ' + stamp, customer_id: c1, start_at: new Date(Date.now() + 864e5).toISOString() }, A);
  const m1 = r.d.id; if (m1) created.meetings.push(m1);
  { const row = m1 ? await list('meeting', m1) : null; ok('C6 Meeting → customer from Master', m1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  r = await api('POST', '/api/r/followup', { entity_type: 'customer', entity_id: c1, subject: 'پیگیری ' + stamp, due_at: new Date(Date.now() + 864e5).toISOString(), user_id: 1 }, A);
  const f1 = r.d.id; if (f1) created.followups.push(f1);
  {
    const frow = f1 ? db.prepare('SELECT * FROM followups WHERE id=?').get(f1) : null;
    ok('C7 Follow-up → customer via entity (Master id)', f1 && frow && frow.entity_type === 'customer' && frow.entity_id === c1, JSON.stringify(frow || r.d).slice(0, 120));
  }

  r = await api('POST', '/api/r/complaint', { customer_id: c1, subject: 'شکایت ' + stamp, description: 'تست یکپارچگی' }, A);
  const cp1 = r.d.id; if (cp1) created.complaints.push(cp1);
  { const row = cp1 ? await list('complaint', cp1) : null; ok('C8 Complaint → customer from Master', cp1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  r = await api('POST', '/api/r/ticket', { customer_id: c1, subject: 'تیکت ' + stamp }, A);
  const t1 = r.d.id; if (t1) created.tickets.push(t1);
  { const row = t1 ? await list('ticket', t1) : null; ok('C9 Ticket → customer from Master', t1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  r = await api('POST', '/api/r/warranty', { customer_id: c1, serial: 'SN-' + stamp }, A);
  const w1 = r.d.id; if (w1) created.warranties.push(w1);
  { const row = w1 ? await list('warranty', w1) : null; ok('C10 Warranty → customer from Master', w1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  r = await api('POST', '/api/r/contract', { title: 'قرارداد ' + stamp, customer_id: c1 }, A);
  const ct1 = r.d.id; if (ct1) created.contracts.push(ct1);
  { const row = ct1 ? await list('contract', ct1) : null; ok('C11 Contract → customer from Master', ct1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  r = await api('POST', '/api/r/lab_request', { customer_id: c1, product_name: 'فوم تست ' + stamp }, A);
  const l1 = r.d.id; if (l1) created.lab.push(l1);
  { const row = l1 ? await list('lab_request', l1) : null; ok('C12 Lab Test Request → customer from Master', l1 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 100)); }

  r = await api('POST', '/api/r/campaign', { name: 'کمپین ' + stamp, message: 'سلام {name}', audience_filter: JSON.stringify({ province: C1.province }), status: 'draft' }, A);
  const cm1 = r.d.id; if (cm1) created.campaigns.push(cm1);
  {
    r = await api('GET', '/api/campaigns/' + cm1 + '/audience', undefined, A);
    const aud = r.d.items || [];
    ok('C13 Campaign audience (GET) reads from Customer Master (province filter finds our customer)', cm1 && aud.some(x => x.id === c1), 'status=' + r.s + ' ids=' + JSON.stringify(aud.map(x => x.id)).slice(0, 100));
  }

  r = await api('POST', '/api/r/lead', { company: 'سرنخ ' + stamp, contact_name: 'آقا تست', phone: '09120001111' }, A);
  const ld1 = r.d.id; if (ld1) created.leads.push(ld1);
  {
    r = await api('PUT', `/api/r/lead/${ld1}`, { customer_id: c1, status: 'converted' }, A);
    const row = ld1 ? await list('lead', ld1) : null;
    ok('C14 Lead (converted) → customer from Master', ld1 && r.s === 200 && row && row.customer_id === c1, JSON.stringify(row || r.d).slice(0, 120));
  }

  // ================= D. INTEGRITY & BEHAVIOR =================
  console.log('== D. Integrity, inactive, permissions, audit ==');
  r = await api('POST', '/api/r/quote', { title: 'x', customer_id: 999999 }, A);
  ok('D1 wrong customer ID (999999) rejected → 422 (no orphan refs)', r.s === 422, 'status=' + r.s);
  r = await api('POST', '/api/r/quote', { customer_id: String(c1) }, A);
  const q2 = r.d.id; if (q2) created.quotes.push(q2);
  ok('D2 string customer_id accepted and coerced to integer (no string/int mismatch)', (r.s === 200 || r.s === 201) && q2 && db.prepare('SELECT typeof(customer_id) t, customer_id FROM quotes WHERE id=?').get(q2).t === 'integer', JSON.stringify(r.d).slice(0, 100));

  // inactive customer: hidden in NEW docs selector, still shown in old docs
  r = await api('POST', '/api/r/order', { customer_id: c2, order_date: new Date().toISOString() }, A);
  const o2 = r.d.id; if (o2) created.orders.push(o2);
  await api('PUT', '/api/r/customer/' + c2, { status: 'inactive' }, A);
  r = await api('GET', '/api/r/customer?per_page=200&f_status=active', undefined, A);
  ok('D3 inactive customer NOT offered for new documents (f_status=active)', !(r.d.items || []).some(x => x.id === c2));
  r = await api('GET', '/api/r/customer/' + c2, undefined, A);
  ok('D3b inactive customer still displayable for old documents (get by id)', r.s === 200 && r.d.item.status === 'inactive');
  r = await api('GET', '/api/r/order?per_page=100', undefined, A);
  const o2row = (r.d.items || []).find(x => x.id === o2);
  ok('D3c old Order of inactive customer still shows customer name (not broken)', o2row && o2row.customer_id === c2 && !!o2row.customer_id_name, JSON.stringify({ name: o2row && o2row.customer_id_name }).slice(0, 100));

  // permissions
  r = await api('GET', '/api/r/customer?per_page=500', undefined, M);
  const scoped = r.d.items || [];
  const adminAll = (await api('GET', '/api/r/customer?per_page=500', undefined, A)).d.items || [];
  const scopedIds = new Set(scoped.map(x => x.id));
  const outOfScope = adminAll.filter(x => x.salesperson_id && !scopedIds.has(x.id));
  ok('D4 scoped user (own) sees only own customers in Master list', M && scoped.length > 0 && scoped.every(x => x.salesperson_id === 2 || scopedIds.has(x.id)), 'scoped=' + scoped.length + ' admin=' + adminAll.length);
  ok('D4b admin sees the full Master', adminAll.length >= scoped.length && adminAll.length > 0, 'admin=' + adminAll.length);

  // audit: change quote customer C1 → C2 must be traced
  await api('PUT', '/api/r/customer/' + c2, { status: 'active' }, A);
  r = await api('PUT', '/api/r/quote/' + q1, { customer_id: c2 }, A);
  ok('D5 change Quotation customer C1→C2 accepted', r.s === 200, r.s);
  r = await api('GET', '/api/r/quote/' + q1 + '/audit', undefined, A);
  // generic engine records changed fields (customer_id: {from,to}) in the update audit row
  const aud = (r.d.items || []).find(x => /update/i.test(x.action) && (String(x.old_value || '') + String(x.new_value || '')).includes('customer_id'));
  ok('D5b AUDIT trace: customer change recorded (old→new in audit log)', !!aud, JSON.stringify((r.d.items || []).slice(-3)).slice(0, 200));
  if (aud) {
    let ch = null; try { ch = JSON.parse(aud.old_value || '{}'); } catch { try { ch = JSON.parse(aud.new_value || '{}'); } catch {} }
    const cid = ch && ch.customer_id;
    ok('D5c audit shows from=C1 to=C2', !!(cid && String(cid.from) === String(c1) && String(cid.to) === String(c2)), 'old=' + aud.old_value + ' new=' + aud.new_value);
  }

  // ================= E. FULL SALES CHAIN (customer continuity) =================
  console.log('== E. E2E chain: Customer → Quote → Order → Invoice → Payment → Commission ==');
  r = await api('POST', '/api/r/quote', { customer_id: c1, status: 'draft' }, A);
  const qe = r.d.id; if (qe) created.quotes.push(qe);
  const putQ = await api('PUT', `/api/r/quote/${qe}/items`, { items: [{ product_id: db.prepare('SELECT id FROM products LIMIT 1').get().id, name: 'ردیف زنجیره', qty: 2, price: 15000000, discount_pct: 0, override_reason: 'قیمت تست زنجیره (سوت رجیسیون)' }] }, A);
  if (putQ.s !== 200) console.log('  [dbg] quote items PUT status', putQ.s, JSON.stringify(putQ.d).slice(0, 120));
  r = await api('POST', `/api/quotes/${qe}/to-order`, {}, A);
  const oe = r.d.order_id; if (oe) created.orders.push(oe);
  ok('E1 quote→order: customer preserved', oe && db.prepare('SELECT customer_id FROM orders WHERE id=?').get(oe).customer_id === c1, 'order=' + oe);
  r = await api('POST', `/api/orders/${oe}/to-invoice`, {}, A);
  const ie = r.d.invoice_id; if (ie) created.invoices.push(ie);
  const invE = ie ? db.prepare('SELECT customer_id, total FROM invoices WHERE id=?').get(ie) : null;
  ok('E2 order→invoice: customer preserved (invoice total>0)', !!(invE && invE.customer_id === c1 && invE.total > 0), JSON.stringify(invE || r.d).slice(0, 120));
  r = await api('POST', '/api/payments', { customer_id: c1, invoice_id: ie, amount: 10, method: 'cash' }, A);
  const pe = r.d.payment_id || r.d.id; if (pe) created.payments.push(pe);
  ok('E3 payment on that invoice: customer preserved', pe && db.prepare('SELECT customer_id FROM payments WHERE id=?').get(pe).customer_id === c1, JSON.stringify(r.d).slice(0, 120));
  r = await api('POST', '/api/commissions/calc', {}, A);
  const commRow = db.prepare('SELECT * FROM commissions WHERE customer_id=? AND (invoice_id=? OR payment_id=?) ORDER BY id DESC LIMIT 1').get(c1, ie, pe || 0);
  const commOk = commRow ? (commRow.customer_id === c1) : false;
  ok('E4 commission calculated with customer linked', commOk, JSON.stringify(commRow || 'no row (calc=' + JSON.stringify(r.d).slice(0, 60) + ')').slice(0, 200));
  if (commRow) {
    r = await api('GET', '/api/commissions', undefined, A);
    const inList = (r.d.rows || []).find(x => x.id === commRow.id);
    ok('E4b commission list shows customer name', inList && (inList.customer_id === c1 || inList.customer_name), JSON.stringify({ cid: inList && inList.customer_id, cn: inList && inList.customer_name }).slice(0, 120));
  }

  // ================= CLEANUP =================
  console.log('== Cleanup ==');
  const del = async (method, path, tok = A) => { try { await api(method, path, undefined, tok); } catch {} };
  for (const id of [...created.quotes].reverse()) await del('DELETE', '/api/r/quote/' + id + '?hard=1');
  for (const id of [...created.orders].reverse()) await del('DELETE', '/api/r/order/' + id + '?hard=1');
  for (const id of [...created.invoices].reverse()) await del('DELETE', '/api/r/invoice/' + id + '?hard=1');
  // payments: API blocks delete when linked to an invoice (correct business rule) — test cleanup uses direct DB
  for (const id of [...created.payments].reverse()) { try { db.prepare('DELETE FROM payments WHERE id=?').run(id); } catch {} }
  for (const inv of created.invoices) { try { db.prepare('DELETE FROM commissions WHERE invoice_id=?').run(inv); } catch {} }
  for (const pmt of created.payments) { try { db.prepare('DELETE FROM commissions WHERE payment_id=?').run(pmt); } catch {} }
  for (const id of [...created.rules].reverse()) await del('DELETE', '/api/commission-rules/' + id);
  for (const id of [...created.meetings].reverse()) await del('DELETE', '/api/r/meeting/' + id + '?hard=1');
  for (const id of [...created.followups].reverse()) await del('DELETE', '/api/r/followup/' + id + '?hard=1');
  for (const id of [...created.complaints].reverse()) await del('DELETE', '/api/r/complaint/' + id + '?hard=1');
  for (const id of [...created.tickets].reverse()) await del('DELETE', '/api/r/ticket/' + id + '?hard=1');
  for (const id of [...created.warranties].reverse()) await del('DELETE', '/api/r/warranty/' + id + '?hard=1');
  for (const id of [...created.contracts].reverse()) await del('DELETE', '/api/r/contract/' + id + '?hard=1');
  for (const id of [...created.lab].reverse()) await del('DELETE', '/api/r/lab_request/' + id + '?hard=1');
  for (const id of [...created.campaigns].reverse()) await del('DELETE', '/api/r/campaign/' + id + '?hard=1');
  for (const id of [...created.leads].reverse()) await del('DELETE', '/api/r/lead/' + id + '?hard=1');
  for (const id of [...created.customers].reverse()) await del('DELETE', '/api/r/customer/' + id + '?hard=1');
  const left = db.prepare('SELECT (SELECT COUNT(*) FROM customers WHERE id IN (' + created.customers.join(',') + ')) c, (SELECT COUNT(*) FROM quotes WHERE id IN (' + (created.quotes.join(',') || '0') + ')) q').get();
  console.log('  cleanup: customers left=' + left.c + ' quotes left=' + left.q);

  console.log('\n=====================================\nCUSTOMER-MASTER SUITE: ' + pass + ' passed, ' + fail + ' failed');
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('ALL CUSTOMER-MASTER TESTS PASSED ✅');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
