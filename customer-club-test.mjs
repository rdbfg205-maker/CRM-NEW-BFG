// Section 9.1 — Customer Club (باشگاه مشتریان): real-HTTP end-to-end test suite (no mocks).
// Accounts, points, transactions, rules, tier automation, real sales integration,
// permissions + audit, search/filter/export. Cleans up its own data.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'CC' + String(Date.now()).slice(-5);
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
// req(method, path, a, b): for GET/DELETE, `a` is the token; for POST/PUT, `a` is body and `b` is token
async function req(method, path, a, b) {
  const isGet = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  const body = isGet ? undefined : a;
  const token = isGet ? a : b;
  const h = {};
  if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetchRetry(BASE + path, { method, headers: h, body: (body !== undefined && body !== null) ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  const t = buf.toString('utf8'); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t, buf, ct: r.headers.get('content-type') || '' };
}
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };

const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }
const M = (await req('POST', '/api/auth/login', { username: 'saeid.t', password: '12345678' })).data.access; // lab role: no loyalty perms
if (!M) { console.log('FATAL: saeid.t login failed'); process.exit(2); }

const G = {};
try {
  // ---------- controlled data (real API) ----------
  G.cust = (await req('POST', '/api/r/customer', { name: 'مشتری باشگاه ' + STAMP, type: 'company', mobile: '0912' + STAMP.slice(2) }, A)).data.id;
  G.cust2 = (await req('POST', '/api/r/customer', { name: 'مشتری دوم ' + STAMP, type: 'company' }, A)).data.id;
  ok('C01 data: customers created (Customer Master)', !!(G.cust && G.cust2), `c1=${G.cust} c2=${G.cust2}`);

  // ---------- accounts ----------
  let r = await req('POST', '/api/loyalty/accounts', { customer_id: G.cust }, A);
  G.accId = r.data.id;
  ok('C02 enroll customer in the club (real account row)', r.status === 200 && !!r.data.id && q1('SELECT COUNT(*) c FROM loyalty_accounts WHERE customer_id=?', G.cust).c === 1, 'acc=' + G.accId);
  r = await req('POST', '/api/loyalty/accounts', { customer_id: G.cust }, A);
  ok('C03 duplicate enrollment → 409', r.status === 409 && r.data.error?.code === 'DUPLICATE', `status=${r.status}`);
  r = await req('POST', '/api/loyalty/accounts', { customer_id: 999999 }, A);
  ok('C04 enroll unknown customer → 404', r.status === 404, `status=${r.status}`);

  // ---------- transactions (earn / redeem / adjust) ----------
  r = await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'earn', points: 120, note: 'خوش‌آمدگویی' }, A);
  G.tx1 = r.data.id;
  ok('C05 earn 120 → balance 120', r.status === 200 && r.data.balance === 120, JSON.stringify(r.data));
  r = await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'redeem', points: 30 }, A);
  G.tx2 = r.data.id;
  ok('C06 redeem 30 → balance 90 (earned stays 120)', r.status === 200 && r.data.balance === 90 && q1('SELECT points_earned FROM loyalty_accounts WHERE customer_id=?', G.cust).points_earned === 120, JSON.stringify(r.data));
  r = await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'redeem', points: 100000 }, A);
  ok('C07 over-redemption → 400 INSUFFICIENT_POINTS, balance untouched', r.status === 400 && r.data.error?.code === 'INSUFFICIENT_POINTS' && q1('SELECT points_balance FROM loyalty_accounts WHERE customer_id=?', G.cust).points_balance === 90, `status=${r.status}`);
  r = await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'adjust', points: -10, note: 'اصلاح' }, A);
  ok('C08 adjust -10 → balance 80', r.status === 200 && r.data.balance === 80, JSON.stringify(r.data));
  r = await req('POST', '/api/loyalty/transactions', { customer_id: 999999, type: 'earn', points: 5 }, A);
  ok('C09 transaction for non-member → 404', r.status === 404, `status=${r.status}`);
  r = await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'hack', points: 5 }, A);
  ok('C10 invalid transaction type → 422', r.status === 422, `status=${r.status}`);

  // ---------- tier automation (100+ earned → نقره‌ای, 500+ → طلایی) ----------
  await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'earn', points: 100, note: 'ارتقا' }, A); // earned 220
  let acc = q1('SELECT la.*, lt.name tier_name FROM loyalty_accounts la LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id WHERE customer_id=?', G.cust);
  ok('C11 tier auto-upgrade on points (220 earned → نقره‌ای)', acc.tier_name === 'نقره‌ای', 'tier=' + acc.tier_name);
  await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'earn', points: 400, note: 'طلایی' }, A); // earned 620
  acc = q1('SELECT lt.name tier_name, la.points_earned, la.points_balance FROM loyalty_accounts la LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id WHERE customer_id=?', G.cust);
  ok('C12 tier auto-upgrade to طلایی (620 earned)', acc.tier_name === 'طلایی' && acc.points_earned === 620, `tier=${acc.tier_name} earned=${acc.points_earned}`);

  // ---------- search / filter ----------
  r = await req('GET', '/api/loyalty/accounts?q=' + encodeURIComponent('باشگاه ' + STAMP), A);
  ok('C13 accounts search by customer name', r.status === 200 && r.data.items.length === 1 && r.data.items[0].customer_id === G.cust, `n=${r.data.items?.length}`);
  const goldTier = q1('SELECT id FROM loyalty_tiers WHERE name=?', 'طلایی').id;
  r = await req('GET', '/api/loyalty/accounts?f_tier_id=' + goldTier, A);
  ok('C14 accounts filter by tier (f_tier_id)', r.status === 200 && r.data.items.some(i => i.customer_id === G.cust) && r.data.items.every(i => i.tier_name === 'طلایی'), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/loyalty/transactions?f_customer_id=' + G.cust + '&f_type=redeem', A);
  ok('C15 transactions filter by customer + type (redeem stored as signed -30)', r.status === 200 && r.data.items.length === 1 && r.data.items[0].points === -30, JSON.stringify(r.data.items?.[0] || {}).slice(0, 120));
  r = await req('GET', '/api/loyalty/transactions?q=' + encodeURIComponent('خوش‌آمدگویی'), A);
  ok('C16 transactions search by note', r.status === 200 && r.data.items.length >= 1 && r.data.items.some(x => x.customer_id === G.cust), `n=${r.data.items?.length}`);

  // ---------- rules ----------
  r = await req('GET', '/api/loyalty/rules', A);
  ok('C17 rules: real earn rate + tier ladder', r.status === 200 && r.data.enabled === true && r.data.points_per_million === 1 && (r.data.tiers || []).length >= 3, JSON.stringify(r.data).slice(0, 120));
  r = await req('POST', '/api/loyalty/rules', { earn_rate: 2 }, A);
  ok('C18 rules update (earn_rate 2) persisted', r.status === 200 && r.data.earn_rate === 2 && JSON.parse(q1('SELECT value FROM settings WHERE key=?', 'loyalty_earn_rate').value) === '2', '');
  r = await req('POST', '/api/loyalty/rules', { earn_rate: 999 }, A);
  ok('C19 invalid rate → 422', r.status === 422, `status=${r.status}`);
  const rulesAudit = q1("SELECT COUNT(*) c FROM audit_logs WHERE entity='loyalty_account' AND action='rules_update'");
  ok('C20 rules change audited', rulesAudit.c >= 1, 'n=' + rulesAudit.c);

  // ---------- real sales integration: full payment earns points + auto-enroll ----------
  const prod = (await req('POST', '/api/r/product', { code: 'CC-' + STAMP.slice(2), name: 'کالای باشگاه ' + STAMP, unit: 'عدد' }, A)).data.id;
  G.prod = prod;
  const q1_ = (await req('POST', '/api/r/quote', { customer_id: G.cust2 }, A)).data.id;
  G.quote = q1_;
  await req('PUT', `/api/r/quote/${q1_}/items`, { items: [{ product_id: prod, name: 'ردیف باشگاه', qty: 1, price: 3000000 }] }, A);
  const o = (await req('POST', `/api/quotes/${q1_}/to-order`, {}, A)).data.order_id;
  G.order = o;
  const inv = (await req('POST', `/api/orders/${o}/to-invoice`, {}, A)).data.invoice_id;
  G.invoice = inv;
  const invTotal = q1('SELECT total FROM invoices WHERE id=?', inv).total;
  // rate=2 now: 3,450,000 * ... invoice total includes 9% tax: 3,270,000 → floor(3.27*2)=6 pts
  const pay = await req('POST', '/api/payments', { invoice_id: inv, customer_id: G.cust2, amount: invTotal, method: 'bank' }, A);
  const acc2 = q1('SELECT * FROM loyalty_accounts WHERE customer_id=?', G.cust2);
  const earnTx = q1(`SELECT * FROM loyalty_transactions WHERE customer_id=? AND ref_type='invoice' AND ref_id=?`, G.cust2, inv);
  const expectedPts = Math.floor(invTotal / 1000000 * 2);
  ok('C21 full payment auto-enrolls customer + earns points (rate x2, ref=invoice)', pay.status === 200 && !!acc2 && earnTx && earnTx.type === 'earn' && earnTx.points === expectedPts && acc2.points_earned === expectedPts, `total=${invTotal} expected=${expectedPts} got=${earnTx && earnTx.points}`);
  // restore default rate
  await req('POST', '/api/loyalty/rules', { earn_rate: 1 }, A);

  // ---------- export (XLSX / CSV / JSON / HTML-PDF) with search ----------
  let e = await req('GET', '/api/loyalty/accounts/export?format=json&q=' + encodeURIComponent('باشگاه ' + STAMP), A);
  ok('C22 accounts JSON export respects search', e.status === 200 && (e.data.rows || []).length === 1 && e.data.rows[0]['مشتری'] === 'مشتری باشگاه ' + STAMP, `rows=${(e.data?.rows || []).length}`);
  e = await req('GET', '/api/loyalty/accounts/export?format=xlsx', A);
  ok('C23 accounts XLSX export (PK magic + mime)', e.status === 200 && e.ct.includes('spreadsheetml') && e.text.charCodeAt(0) === 80 && e.text.charCodeAt(1) === 75, `ct=${e.ct}`);
  e = await req('GET', '/api/loyalty/accounts/export?format=csv', A);
  const csvTxt = e.buf.toString('utf8');
  ok('C24 accounts CSV export (BOM + header + data)', e.status === 200 && e.ct.includes('csv') && e.buf.slice(0, 3).toString('hex') === 'efbbbf' && csvTxt.includes('موجودی امتیاز') && csvTxt.includes('باشگاه ' + STAMP), 'len=' + csvTxt.length);
  e = await req('GET', '/api/loyalty/accounts/export?format=html', A);
  ok('C25 accounts HTML (printable PDF) export with company header', e.status === 200 && e.ct.includes('html') && e.text.includes('بسپار') && e.text.includes('باشگاه ' + STAMP), `ct=${e.ct}`);
  e = await req('GET', '/api/loyalty/transactions/export?format=json&q=' + encodeURIComponent('باشگاه ' + STAMP), A);
  ok('C26 transactions JSON export (Jalali date + search)', e.status === 200 && (e.data.rows || []).length >= 1 && /1405-\d\d-\d\d/.test(JSON.stringify(e.data.rows)), `rows=${(e.data?.rows || []).length}`);

  // ---------- audit ----------
  const audCreate = q1(`SELECT * FROM audit_logs WHERE entity='loyalty_account' AND action='create' AND new_value LIKE ?`, '%' + G.cust + '%');
  ok('C27 account enrollment audited', !!audCreate, audCreate ? 'id=' + audCreate.id : '');
  const audEarn = q1(`SELECT COUNT(*) c FROM audit_logs WHERE entity='loyalty_transaction' AND action IN ('earn','redeem','adjust')`);
  ok('C28 point transactions audited (≥5)', audEarn.c >= 5, 'n=' + audEarn.c);

  // ---------- permissions (backend) ----------
  r = await req('GET', '/api/loyalty/accounts', M);
  ok('C29 lab role (no loyalty perms) → 403 list accounts', r.status === 403, `status=${r.status}`);
  r = await req('POST', '/api/loyalty/accounts', { customer_id: G.cust2 }, M);
  ok('C30 lab role → 403 create account', r.status === 403, `status=${r.status}`);
  r = await req('POST', '/api/loyalty/transactions', { customer_id: G.cust, type: 'earn', points: 5 }, M);
  ok('C31 lab role → 403 create transaction', r.status === 403, `status=${r.status}`);
  r = await req('GET', '/api/loyalty/accounts/export?format=csv', M);
  ok('C32 lab role → 403 export', r.status === 403, `status=${r.status}`);
  r = await req('GET', '/api/loyalty/rules', M);
  ok('C33 lab role → 403 rules', r.status === 403, `status=${r.status}`);
} catch (err) {
  ok('suite completed without unexpected crash', false, (err.stack || String(err)).slice(0, 300));
}

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
    del('DELETE FROM loyalty_transactions WHERE customer_id IN (?,?)', G.cust || 0, G.cust2 || 0);
    del('DELETE FROM loyalty_accounts WHERE customer_id IN (?,?)', G.cust || 0, G.cust2 || 0);
    del('DELETE FROM payments WHERE invoice_id=?', G.invoice || 0);
    del('DELETE FROM invoice_items WHERE invoice_id=?', G.invoice || 0);
    del('DELETE FROM invoices WHERE id=?', G.invoice || 0);
    del('DELETE FROM order_items WHERE order_id=?', G.order || 0);
    del('DELETE FROM orders WHERE id=?', G.order || 0);
    del('DELETE FROM quote_items WHERE quote_id=?', G.quote || 0);
    del('DELETE FROM quotes WHERE id=?', G.quote || 0);
    del('DELETE FROM stock_transactions WHERE product_id=?', G.prod || 0);
    del('DELETE FROM products WHERE id=?', G.prod || 0);
    del('DELETE FROM customers WHERE id IN (?,?)', G.cust || 0, G.cust2 || 0);
  });
  tx(); d.close();
  console.log('cleanup done');
  console.log('\n========== CUSTOMER CLUB (SECTION 9.1) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 150) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
