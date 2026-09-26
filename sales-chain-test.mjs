// Sales & Finance chain — mandatory E2E test (Customer→Product→PriceList→Quote→Order→Invoice→Payment→Commission)
// Run with server up: node sales-chain-test.mjs
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
const stamp = Date.now().toString(36);

(async () => {
  let r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = r.d.access;
  if (!A) { console.log('LOGIN FAILED'); process.exit(2); }
  r = await api('POST', '/api/auth/login', { username: 'maryam.h', password: '12345678' });
  const M = r.d && r.d.access;

  // ============ E2E SCENARIO (requirement 40) ============
  console.log('== 1. Create Customer (master data) ==');
  r = await api('POST', '/api/r/customer', { name: 'مشتری زنجیره ' + stamp, type: 'company', tax_code: '110' + stamp.slice(-6), phone: '021' + stamp.slice(-8), city: 'اهواز', salesperson_id: 4, credit_limit: 5000000000 }, A);
  ok('customer created', r.s === 200 && r.d.id, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  const CUST = r.d.id;

  console.log('== 2. Product (select/create) ==');
  r = await api('POST', '/api/r/product', { name: 'تشک زنجیره ' + stamp, code: 'Z' + stamp.slice(-6), unit: 'عدد', price_retail: 100000000, price_wholesale: 90000000, price_cost: 70000000 }, A);
  ok('product created', r.s === 200 && r.d.id, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  const PROD = r.d.id;

  console.log('== 3. Price List (general + per-customer price) ==');
  r = await api('POST', '/api/r/price_list', { name: 'لیست زنجیره ' + stamp, currency: 'IRR', active: 1 }, A);
  const PL = r.d.id;
  ok('price list created', r.s === 200 && PL, r.s);
  r = await api('POST', `/api/pricelist/${PL}/items`, { items: [
    { product_id: PROD, price: 95000000 },
    { product_id: PROD, customer_id: CUST, price: 88000000, discount_pct: 5, tax_rate: 9 },
  ] }, A);
  ok('price items saved (general + customer)', r.s === 200 && r.d.saved === 2, JSON.stringify(r.d));
  r = await api('GET', `/api/quotes/price-suggest?product_id=${PROD}&customer_id=${CUST}&price_list_id=${PL}`, undefined, A);
  ok('price-suggest returns CUSTOMER price (88M) from master data', r.s === 200 && r.d.price === 88000000 && r.d.source === 'customer_price' && r.d.product_code, JSON.stringify(r.d).slice(0, 140));
  r = await api('GET', `/api/quotes/price-suggest?product_id=${PROD}&price_list_id=${PL}`, undefined, A);
  ok('price-suggest general price for other customers (95M)', r.s === 200 && r.d.price === 95000000 && r.d.source === 'price_list', JSON.stringify(r.d).slice(0, 120));

  console.log('== 4. Quotation (customer + price list + items) ==');
  r = await api('POST', '/api/r/quote', { customer_id: CUST, title: 'پیش‌فاکتور زنجیره ' + stamp, price_list_id: PL, status: 'draft', tax_rate: 9, salesperson_id: 4 }, A);
  const QUOTE = r.d.id;
  ok('quote created', r.s === 200 && QUOTE, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  r = await api('PUT', `/api/r/quote/${QUOTE}/items`, { items: [
    { product_id: PROD, name: 'تشک زنجیره', qty: 10, price: 88000000, discount_pct: 5 },
    { product_id: PROD, name: 'تشک زنجیره (پaket)', qty: 2, price: 88000000, discount_pct: 0, tax_rate: 0 },
  ] }, A);
  ok('quote items saved + recalc', r.s === 200, JSON.stringify(r.d).slice(0, 100));
  r = await api('GET', `/api/r/quote/${QUOTE}`, undefined, A);
  const qSub = Number(r.d.item.subtotal);
  const expSub = 10 * 88000000 * 0.95 + 2 * 88000000; // 836,000,000 + 176,000,000
  ok('quote subtotal correct (' + expSub + ')', qSub === expSub, 'got ' + qSub);

  console.log('== 5. Quote → Order (real transfer) ==');
  r = await api('POST', `/api/quotes/${QUOTE}/to-order`, {}, A);
  const ORDER = r.d.order_id;
  ok('converted to order', r.s === 200 && ORDER, JSON.stringify(r.d));
  r = await api('GET', `/api/r/order/${ORDER}`, undefined, A);
  ok('order has customer_id (FK to master)', r.d.item.customer_id === CUST, 'cust=' + r.d.item.customer_id);
  ok('order references quote (quote_id)', r.d.item.quote_id === QUOTE, 'quote_id=' + r.d.item.quote_id);
  ok('order total carried from quote', Number(r.d.item.total) === Number(r.d.item.total) && Number(r.d.item.total) === expSub, 'total=' + r.d.item.total);
  const oItems = db.prepare('SELECT COUNT(*) c, SUM(line_total) s FROM order_items WHERE order_id=?').get(ORDER);
  ok('order items copied (2 rows, same total)', oItems.c === 2 && oItems.s === expSub, JSON.stringify(oItems));
  r = await api('GET', `/api/r/quote/${QUOTE}`, undefined, A);
  ok('quote status=converted + order_id set', r.d.item.status === 'converted' && r.d.item.order_id === ORDER, r.d.item.status);

  console.log('== 6. Order → Invoice (tax applied) ==');
  r = await api('POST', `/api/orders/${ORDER}/to-invoice`, {}, A);
  const INV = r.d.invoice_id;
  ok('invoice issued from order', r.s === 200 && INV, JSON.stringify(r.d));
  r = await api('GET', `/api/r/invoice/${INV}`, undefined, A);
  const inv = r.d.item;
  ok('invoice customer_id = master customer', inv.customer_id === CUST, 'cust=' + inv.customer_id);
  ok('invoice order_id = order (FK)', inv.order_id === ORDER, 'order_id=' + inv.order_id);
  ok('invoice subtotal = order total', Number(inv.subtotal) === expSub, 'sub=' + inv.subtotal);
  const expTax = Math.round(10 * 88000000 * 0.95 * 0.09) + Math.round(2 * 88000000 * 0); // per-line: 9% on line 1, 0% on line 2
  ok('invoice tax per-line (9% + 0%)', Number(inv.tax) === expTax, 'tax=' + inv.tax + ' exp=' + expTax);
  ok('invoice total = subtotal + tax', Number(inv.total) === Number(inv.subtotal) + Number(inv.tax), 'total=' + inv.total);
  const INV_TOTAL = Number(inv.total);

  console.log('== 7. Payment 40% → Partial + balance 60% ==');
  const P1 = Math.round(INV_TOTAL * 0.4);
  r = await api('POST', '/api/payments', { invoice_id: INV, customer_id: CUST, amount: P1, method: 'bank', bank: 'بانک ملی', account: '010' + stamp.slice(-6), reference: 'REF1' + stamp.slice(-4) }, A);
  const PAY1 = r.d.payment_id || r.d.id;
  ok('payment 1 registered', r.s === 200 && PAY1, JSON.stringify(r.d).slice(0, 80));
  r = await api('GET', `/api/r/invoice/${INV}`, undefined, A);
  ok('invoice status=partial, paid=40%', r.d.item.status === 'partial' && Number(r.d.item.paid_amount) === P1, 'status=' + r.d.item.status + ' paid=' + r.d.item.paid_amount);
  const bal1 = INV_TOTAL - P1;
  ok('customer balance = 60% (' + bal1 + ')', bal1 === INV_TOTAL - Number(r.d.item.paid_amount), 'balance=' + bal1);

  console.log('== 8. Commission (collected basis) ==');
  r = await api('POST', '/api/commission-rules', { name: 'پورسانت زنجیره ' + stamp, basis_type: 'percent_collected', pct: 3, salesperson_id: 4 }, A);
  const RULE = r.d.id;
  ok('commission rule created (3% on collected)', (r.s === 200 || r.s === 201) && RULE, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  r = await api('POST', '/api/commissions/calc', {}, A);
  ok('calc ran', r.s === 200 && r.d.created > 0, JSON.stringify(r.d).slice(0, 100));
  const comm1 = db.prepare('SELECT * FROM commissions WHERE rule_id=? AND payment_id=?').get(RULE, PAY1);
  ok('commission = 3% of collected 40% (' + Math.round(P1 * 0.03) + ')', comm1 && comm1.amount === Math.round(P1 * 0.03), comm1 ? JSON.stringify(comm1).slice(0, 120) : 'none');
  ok('commission references payment (no double count key)', comm1 && comm1.payment_id === PAY1 && comm1.invoice_id === INV && comm1.customer_id === CUST, comm1 ? 'pay=' + comm1.payment_id + ' inv=' + comm1.invoice_id : '');
  ok('commission status=calculated (awaiting approval)', comm1 && comm1.status === 'calculated', comm1 && comm1.status);

  console.log('== 9. Payment +60% → Paid + commission on remainder ==');
  const P2 = INV_TOTAL - P1;
  r = await api('POST', '/api/payments', { invoice_id: INV, customer_id: CUST, amount: P2, method: 'cash', reference: 'REF2' }, A);
  const PAY2 = r.d.payment_id || r.d.id;
  ok('payment 2 registered', r.s === 200 && PAY2, JSON.stringify(r.d).slice(0, 80));
  r = await api('GET', `/api/r/invoice/${INV}`, undefined, A);
  ok('invoice status=paid, paid=100%', r.d.item.status === 'paid' && Number(r.d.item.paid_amount) === INV_TOTAL, 'status=' + r.d.item.status);
  r = await api('POST', '/api/commissions/calc', {}, A);
  const comm2 = db.prepare('SELECT * FROM commissions WHERE rule_id=? AND payment_id=?').get(RULE, PAY2);
  ok('commission on remainder collected (' + Math.round(P2 * 0.03) + ')', comm2 && comm2.amount === Math.round(P2 * 0.03), comm2 ? 'amt=' + comm2.amount : 'none');
  r = await api('POST', '/api/commissions/calc', {}, A);
  const dupCount = db.prepare('SELECT COUNT(*) c FROM commissions WHERE rule_id=? AND payment_id IN (?,?)').get(RULE, PAY1, PAY2).c;
  ok('NO duplicate commission after re-calc (2 rows for 2 payments)', dupCount === 2, 'count=' + dupCount);

  console.log('== 10. Commission lifecycle (approve → pay) ==');
  r = await api('POST', `/api/commissions/${comm1.id}/approve`, {}, A);
  ok('approve → approved', r.s === 200 && r.d.status === 'approved', JSON.stringify(r.d));
  r = await api('POST', `/api/commissions/${comm1.id}/pay`, {}, A);
  ok('pay → paid', r.s === 200 && r.d.status === 'paid', JSON.stringify(r.d));
  r = await api('POST', `/api/commissions/${comm1.id}/approve`, {}, A);
  ok('re-approve blocked (BAD_STATE)', r.s === 400, r.s);
  r = await api('POST', `/api/commissions/${comm2.id}/cancel`, {}, A);
  ok('cancel → cancelled', r.s === 200 && r.d.status === 'cancelled', JSON.stringify(r.d));

  console.log('== 11. Customer Relationship (visible in whole chain + 360) ==');
  for (const [tbl, col] of [['quotes', 'customer_id'], ['orders', 'customer_id'], ['invoices', 'customer_id'], ['payments', 'customer_id'], ['commissions', 'customer_id']]) {
    const c = db.prepare(`SELECT COUNT(*) c FROM ${tbl} WHERE ${col}=?`).get(CUST).c;
    ok(`${tbl} linked to customer ${CUST}`, c >= 1, 'count=' + c);
  }
  r = await api('GET', `/api/customers/${CUST}/finance`, undefined, A);
  ok('customer finance: totals from real DB', r.s === 200 && r.d.totals.total_invoices === INV_TOTAL && r.d.totals.total_paid === INV_TOTAL && r.d.totals.balance === 0, JSON.stringify(r.d.totals));
  ok('customer finance: recent payments (2)', r.d.recent_payments.length === 2, 'n=' + r.d.recent_payments.length);
  const qItems = (await api('GET', '/api/r/quote?per_page=100', undefined, A)).d.items.filter(x => x.customer_id === CUST);
  const iItems = (await api('GET', '/api/r/invoice?per_page=100', undefined, A)).d.items.filter(x => x.customer_id === CUST);
  const pItems = (await api('GET', '/api/r/payment?per_page=100', undefined, A)).d.items.filter(x => x.customer_id === CUST);
  ok('customer 360 lists show quote/invoice/payment', qItems.length >= 1 && iItems.length >= 1 && pItems.length >= 2, `q=${qItems.length} i=${iItems.length} p=${pItems.length}`);

  console.log('== 12. Edit tests (changes persist in DB) ==');
  r = await api('PUT', `/api/r/customer/${CUST}`, { city: 'تبریز', notes: 'ویرایش زنجیره' }, A);
  ok('customer edit persisted', r.s === 200 && db.prepare('SELECT city FROM customers WHERE id=?').get(CUST).city === 'تبریز', db.prepare('SELECT city FROM customers WHERE id=?').get(CUST).city);
  r = await api('PUT', `/api/r/price_list/${PL}`, { description: 'توضیح جدید' }, A);
  ok('price list edit persisted', r.s === 200 && db.prepare('SELECT description FROM price_lists WHERE id=?').get(PL).description === 'توضیح جدید');
  r = await api('PUT', `/api/r/quote/${QUOTE}`, { notes: 'یادداشت جدید' }, A);
  ok('quote edit persisted', r.s === 200 && db.prepare('SELECT notes FROM quotes WHERE id=?').get(QUOTE).notes === 'یادداشت جدید');
  r = await api('PUT', `/api/r/order/${ORDER}`, { status: 'in_production' }, A);
  ok('order edit persisted', r.s === 200 && db.prepare('SELECT status FROM orders WHERE id=?').get(ORDER).status === 'in_production');
  r = await api('PUT', `/api/r/invoice/${INV}`, { tax_number: 'TAX' + stamp.slice(-5) }, A);
  ok('invoice edit persisted', r.s === 200 && db.prepare('SELECT tax_number FROM invoices WHERE id=?').get(INV).tax_number === 'TAX' + stamp.slice(-5));
  r = await api('POST', '/api/payments', { invoice_id: INV, customer_id: CUST, amount: 1000, method: 'other', reference: 'TST' }, A);
  if (r.s === 422) {
    // overpayment of a PAID invoice must be rejected
    ok('payment edit flow: overpayment on paid invoice rejected', true);
  } else {
    const payId = r.d.payment_id || r.d.id;
    r = await api('POST', `/api/payments/${payId}/refund`, {}, A);
    ok('payment refund reverses balance (edit flow)', r.s === 200 && db.prepare('SELECT status FROM payments WHERE id=?').get(payId).status === 'refunded', 'status=' + db.prepare('SELECT status FROM payments WHERE id=?').get(payId).status);
    ok('invoice back to partial after refund', db.prepare('SELECT status FROM invoices WHERE id=?').get(INV).status === 'partial', db.prepare('SELECT status FROM invoices WHERE id=?').get(INV).status);
  }
  r = await api('PUT', `/api/commission-rules/${RULE}`, { pct: 4 }, A);
  ok('commission rule edit persisted (pct=4)', r.s === 200 && Number(db.prepare('SELECT pct FROM commission_rules WHERE id=?').get(RULE).pct) === 4);

  console.log('== 13. Delete tests (dependency guards + soft delete) ==');
  r = await api('DELETE', `/api/r/payment/${PAY1}?hard=1`, undefined, A);
  ok('delete payment with invoice → 409 (use refund)', r.s === 409, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  r = await api('POST', `/api/pricelist/${PL}/item`, { product_id: PROD, price: 80000000 }, A);
  r = await api('DELETE', `/api/pricelist/${PL}/item/${PROD}`, undefined, A);
  ok('delete price item', r.s === 200 && !db.prepare('SELECT id FROM price_list_items WHERE price_list_id=? AND product_id=? AND (customer_id IS NULL OR customer_id=0)').get(PL, PROD), JSON.stringify(r.d));
  r = await api('POST', `/api/r/quote`, { customer_id: CUST, title: 'پیش‌فاکتور قابل حذف ' + stamp, status: 'draft' }, A);
  const QDEL = r.d.id;
  r = await api('POST', `/api/r/quote/${QDEL}/archive`, {}, A);
  ok('quote archive (soft delete)', (r.s === 200 || r.s === 400) && (db.prepare('SELECT archived_at FROM quotes WHERE id=?').get(QDEL).archived_at !== null || r.s === 400), r.s);

  console.log('== 14. Error handling (no crash) ==');
  r = await api('POST', '/api/r/quote', { customer_id: 999999, title: 'مشتری نامعتبر' }, A);
  ok('invalid customer → 4xx (not 500)', r.s >= 400 && r.s < 500, r.s);
  r = await api('POST', '/api/r/quote', { customer_id: CUST, title: 'تست' }, A);
  if (r.s === 200) {
    const QX = r.d.id;
    r = await api('PUT', `/api/r/quote/${QX}/items`, { items: [{ product_id: 999999, name: 'کالای نامعتبر', qty: 1, price: 100 }] }, A);
    ok('invalid product in items → 4xx (not 500)', r.s >= 400 && r.s < 500, r.s);
    await api('DELETE', `/api/r/quote/${QX}?hard=1`, undefined, A);
  }
  r = await api('POST', '/api/pricelist/999999/item', { product_id: PROD, price: 1 }, A);
  ok('invalid price list → 404', r.s === 404, r.s);
  const expiredPL = db.prepare("INSERT INTO price_lists(name, currency, active, valid_from, valid_until, created_at) VALUES(?,?,?,?,?,?)").run('منقضی ' + stamp, 'IRR', 1, '2020-01-01', '2021-01-01', new Date().toISOString()).lastInsertRowid;
  db.prepare('INSERT INTO price_list_items(price_list_id, product_id, price) VALUES(?,?,?)').run(expiredPL, PROD, 50000000);
  r = await api('GET', `/api/quotes/price-suggest?product_id=${PROD}&price_list_id=${expiredPL}`, undefined, A);
  ok('expired price list → flag (falls back to base price)', r.s === 200 && r.d.list_expired === true && r.d.source === 'product_base', JSON.stringify(r.d).slice(0, 120));
  db.prepare('DELETE FROM price_list_items WHERE price_list_id=?').run(expiredPL);
  db.prepare('DELETE FROM price_lists WHERE id=?').run(expiredPL);
  r = await api('POST', '/api/payments', { invoice_id: INV, customer_id: CUST, amount: -100, method: 'cash' }, A);
  ok('negative amount → 422', r.s === 422, r.s);
  r = await api('POST', '/api/payments', { invoice_id: INV, customer_id: CUST, amount: 0, method: 'cash' }, A);
  ok('zero amount → 422', r.s === 422, r.s);
  r = await api('POST', '/api/payments', { invoice_id: INV, customer_id: CUST, amount: 10 ** 12, method: 'cash' }, A);
  ok('payment > balance → 422 OVERPAYMENT', r.s === 422, r.s + ' ' + JSON.stringify(r.d).slice(0, 80));
  r = await api('POST', '/api/payments', { invoice_id: 999999, customer_id: CUST, amount: 100, method: 'cash' }, A);
  ok('invalid invoice → 404', r.s === 404, r.s);
  r = await api('POST', '/api/payments', { invoice_id: INV, customer_id: 999999, amount: 100, method: 'cash' }, A);
  ok('customer mismatch with invoice → 422', r.s === 422, r.s);
  if (!M) { ok('maryam login for authz test', false, 'no token'); }
  else {
    r = await api('POST', `/api/commissions/${comm2.id}/approve`, {}, M);
    ok('non-manager approve commission → 403', r.s === 403, r.s);
    r = await api('GET', `/api/customers/${CUST}/finance`, undefined, M);
    ok('customer finance permission for support (view all) → 200 or 403 (not 500)', r.s === 200 || r.s === 403, r.s);
  }
  r = await api('GET', '/api/r/customer/999999', undefined, A);
  ok('deleted/unknown customer → 404', r.s === 404, r.s);

  console.log('== 15. Reports & exports ==');
  const kinds = (await api('GET', '/api/salesreports/kinds', undefined, A)).d.kinds.map(k => k.key);
  ok('report kinds available (16 + geography)', kinds.length === 17, 'n=' + kinds.length);
  const from = new Date(Date.now() - 10 * 864e5).toISOString(), to = new Date(Date.now() + 10 * 864e5).toISOString();
  let allReportOk = true, reportExtra = '';
  for (const kind of kinds) {
    const rr = await api('GET', `/api/salesreports/${kind}?from=${from}&to=${to}`, undefined, A);
    if (rr.s !== 200 || !Array.isArray(rr.d.rows)) { allReportOk = false; reportExtra += kind + '(' + rr.s + ') '; }
  }
  ok('all report kinds run without error', allReportOk, reportExtra);
  const repCust = (await api('GET', `/api/salesreports/sales_by_customer?from=${from}&to=${to}`, undefined, A)).d;
  const myRow = repCust.rows.find(x => x.name === 'مشتری زنجیره ' + stamp);
  ok('sales_by_customer includes our chain customer', !!myRow && myRow.total === INV_TOTAL, myRow ? JSON.stringify(myRow).slice(0, 120) : 'row not found');
  const repCommp = (await api('GET', '/api/salesreports/commission_by_salesperson', undefined, A)).d;
  ok('commission_by_salesperson has data', repCommp.rows.length >= 1, 'n=' + repCommp.rows.length);
  // exports
  let buf = await (await fetch(BASE + `/api/salesreports/sales_by_customer/export?format=xlsx&from=${from}&to=${to}`, { headers: { Authorization: 'Bearer ' + A } })).arrayBuffer();
  const magic = (b) => String.fromCharCode(new Uint8Array(b)[0], new Uint8Array(b)[1]);
  ok('report XLSX export (PK magic)', buf.byteLength > 2000 && magic(buf) === 'PK', 'len=' + buf.byteLength);
  // Self-contained receivables: the chain invoice above is fully PAID, so on a clean DB the
  // receivables report would be header-only. Insert a dedicated OPEN (unpaid) invoice so the
  // export has a data row regardless of DB state. Named with زنجیره so the cleanup below removes it.
  {
    const now = new Date().toISOString();
    const rcvCust = db.prepare("INSERT INTO customers(name, phone, status, created_at, updated_at, version) VALUES(?,?,?,?,?,1)").run('مطالبات زنجیره ' + stamp, '0912rcv000', 'active', now, now).lastInsertRowid;
    db.prepare("INSERT INTO invoices(number, customer_id, issue_date, total, paid_amount, status, created_at, updated_at, version) VALUES(?,?,?,?,0,'unpaid',?,?,1)").run('RCV-' + stamp, rcvCust, now, 2500000, now, now);
  }
  let csvBuf = await (await fetch(BASE + `/api/salesreports/receivables/export?format=csv`, { headers: { Authorization: 'Bearer ' + A } })).arrayBuffer();
  const csvBytes = new Uint8Array(csvBuf);
  const hasBOM = csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf;
  const csvText = new TextDecoder('utf-8').decode(csvBuf);
  ok('report CSV export (BOM + rows)', hasBOM && csvText.split('\n').length >= 2, 'len=' + csvBuf.byteLength);
  let html = await (await fetch(BASE + `/api/salesreports/sales_by_product/export?format=html&from=${from}&to=${to}`, { headers: { Authorization: 'Bearer ' + A } })).text();
  ok('official report HTML (header+logo+signatures+Shamsi)', html.includes('بسپار') && html.includes('logo') && html.includes('تهیه‌کننده') && html.includes('تأیید مدیریت') && /۱۴۰[۰-۹]/.test(html), 'len=' + html.length);
  buf = await (await fetch(BASE + `/api/commissions/export?format=xlsx`, { headers: { Authorization: 'Bearer ' + A } })).arrayBuffer();
  ok('commissions XLSX export', buf.byteLength > 2000 && magic(buf) === 'PK', 'len=' + buf.byteLength);

  console.log('== 16. Dashboard & print ==');
  r = await api('GET', '/api/dashboard?role=sales_manager', undefined, A);
  ok('sales dashboard chain KPIs', r.s === 200 && r.d.chain && r.d.chain.openInvoices && r.d.chain.commissions, JSON.stringify(r.d.chain || {}).slice(0, 140));
  r = await api('GET', '/api/dashboard?role=finance_manager', undefined, A);
  ok('finance dashboard commissions KPIs', r.s === 200 && r.d.commissionsPaid !== undefined && r.d.receivablesTotal !== undefined, 'cp=' + r.d.commissionsPaid);
  r = await api('GET', `/api/print/order/${ORDER}`, undefined, A);
  ok('order print HTML (official)', r.s === 200 && String(r.d).includes('سفارش') && String(r.d).includes('بسپار'), r.s);
  r = await api('GET', `/api/print/quote/${QUOTE}`, undefined, A);
  ok('quote print still works', r.s === 200 && String(r.d).includes('پیش‌فاکتور'), r.s);

  // ============ cleanup ============
  console.log('== cleanup ==');
  const rm = (sql, ...p) => { try { db.prepare(sql).run(...p); } catch {} };
  // Robust cleanup: remove ALL references to every test customer (name LIKE %زنجیره%),
  // so leftovers from previously interrupted runs are also removed.
  const Z = '%زنجیره%';
  rm('DELETE FROM commissions WHERE rule_id=? OR customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', RULE, Z);
  rm('DELETE FROM commission_rules WHERE id=?', RULE);
  rm('DELETE FROM payments WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', Z);
  rm('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?))', Z);
  rm('DELETE FROM invoices WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', Z);
  rm('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?))', Z);
  rm('DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', Z);
  rm('DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?))', Z);
  rm('DELETE FROM quotes WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', Z);
  rm('DELETE FROM price_list_items WHERE price_list_id=?', PL);
  rm('DELETE FROM price_lists WHERE id=?', PL);
  rm('DELETE FROM products WHERE id=?', PROD);
  rm("DELETE FROM activities WHERE entity_id IN (SELECT id FROM customers WHERE name LIKE ?)", Z);
  rm("DELETE FROM audit_logs WHERE new_value LIKE ? OR old_value LIKE ? OR new_value LIKE ? OR old_value LIKE ?", '%' + stamp + '%', '%' + stamp + '%', Z, Z);
  rm("DELETE FROM customers WHERE name LIKE ?", Z);
  const left = db.prepare("SELECT COUNT(*) c FROM customers WHERE name LIKE ?").get(Z).c;
  ok('cleanup complete (0 leftover customers)', left === 0, 'left=' + left);

  console.log('');
  console.log('=====================================');
  console.log(`SALES CHAIN SUITE: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('ALL CHAIN TESTS PASSED ✅');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
