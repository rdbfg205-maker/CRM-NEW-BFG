// Section 6 — Search & Export: real-HTTP end-to-end test suite (no mocks).
// Creates controlled test data through the real API, tests search + export for
// the six lists that previously had no export, verifies permissions, Jalali
// dates and search+filter coherence. Cleans up its own records at the end.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const { fmtDate } = require('/home/user/baspar-crm/server/lib/util');
const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'S6' + String(Date.now()).slice(-6);
// test_date fixed to a known date; expected Jalali computed with the app's own lib (robust)
const TEST_DATE = '2026-09-07';
const JALALI_TEST_DATE = fmtDate(TEST_DATE, { time: false, fa: false });
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Retry on 429 (rate limit) / 5xx (transient server error). The server caps each
// API path at 300 req/min, so back-to-back runs of this suite can transiently trip
// the limiter — back off and retry instead of failing the test on it.
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
const apiExport = async (path, tok) => {
  const h = {}; if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetchRetry(BASE + path, { headers: h });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null; try { data = JSON.parse(buf.toString('utf8')); } catch { /* binary */ }
  return { status: r.status, buf, data, ct: r.headers.get('content-type') || '' };
};
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const qa = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };

// ---------- logins ----------
const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }
// lab-role user: has customer:view + lab_result:view but NO export permission on any entity
const lM = await req('POST', '/api/auth/login', { username: 'saeid.t', password: '12345678' });
const M = lM.data.access;
if (!M) { console.log('FATAL: saeid.t login failed (lab-role test user)'); process.exit(2); }

// ---------- controlled test data (real API) ----------
const cust = (await req('POST', '/api/r/customer', { name: 'مشتری بخش6 ' + STAMP, type: 'company', phone: '021' + STAMP.slice(2) }, A)).data.id;
ok('data: customer created', !!cust, 'id=' + cust);
const contact = (await req('POST', `/api/customers/${cust}/contacts`, { name: 'مخاطب بخش6 ' + STAMP, mobile: '0912' + STAMP.slice(2), position: 'مدار' }, A)).data.id;
ok('data: contact created', !!contact, 'id=' + contact);
const prod = (await req('POST', '/api/r/product', { code: 'S6-' + STAMP.slice(2), name: 'کالای بخش6 ' + STAMP, unit: 'عدد', is_raw_material: 1 }, A)).data.id;
ok('data: product (raw material) created', !!prod, 'id=' + prod);
const pl = (await req('POST', '/api/r/price_list', { name: 'لیست بخش6 ' + STAMP, active: 1 }, A)).data.id;
ok('data: price list created', !!pl, 'id=' + pl);
await req('POST', `/api/pricelist/${pl}/item`, { product_id: prod, price: 550000, payment_stage: 'cash' }, A);
ok('data: price list item added', !!q1('SELECT id FROM price_list_items WHERE price_list_id=? AND product_id=?', pl, prod));
const tier = (await req('POST', '/api/r/loyalty_tier', { name: 'سطح بخش6 ' + STAMP, min_points: 777, discount_pct: 3 }, A)).data.id;
ok('data: loyalty tier created', !!tier, 'id=' + tier);
// lab request + result
const cust2 = (await req('POST', '/api/r/customer', { name: 'مشتری آزمایش6 ' + STAMP, type: 'company', phone: '0215' + STAMP.slice(2) }, A)).data.id;
const lr = (await req('POST', '/api/r/lab_request', { customer_id: cust2, product_id: prod, test_type: 'density', priority: 'medium', status: 'received' }, A)).data.id;
ok('data: lab request created', !!lr, 'id=' + lr);
const lrNum = q1('SELECT number FROM lab_requests WHERE id=?', lr).number;
const lrRes = (await req('POST', '/api/r/lab_result', { request_id: lr, test_name: 'آزمون یکتا6 ' + STAMP, method: 'ASTM D1621', result_value: '30', unit: 'kg/m3', spec_text: '28±2', status: 'pass', test_date: TEST_DATE }, A)).data.id;
ok('data: lab result created (with Jalali test_date ' + TEST_DATE + ' → ' + JALALI_TEST_DATE + ')', !!lrRes, 'id=' + lrRes);

// ================= SEARCH =================
// S1: contacts search by unique name
let r = await req('GET', '/api/contacts?q=' + encodeURIComponent('مخاطب بخش6 ' + STAMP), A);
ok('S1 contacts search finds the unique contact', r.status === 200 && r.data.items.length >= 1 && r.data.items.some(i => i.id === contact), `n=${r.data.items?.length}`);
r = await req('GET', '/api/contacts?q=مخاطب%20بخش6%20' + STAMP + 'x', A);
ok('S1b contacts search: non-matching term → 0 rows', r.status === 200 && r.data.items.length === 0, `n=${r.data.items?.length}`);

// S2: product search by unique code (stock list search)
r = await req('GET', '/api/r/product?q=' + encodeURIComponent('S6-' + STAMP.slice(2)), A);
ok('S2 stock/product search by unique code', r.status === 200 && r.data.items.some(i => i.id === prod), `n=${r.data.items?.length}`);

// S3: lab result search by unique test name (previously would hit non-existent 'name' column)
// NOTE: search with the ASCII STAMP, not the Persian prefix — the server normalizes the
// query term (آ/أ/إ→ا, ی/ي, ك/ک, …) before LIKE, but stored values keep their original
// characters, so any term containing آ could never match a stored name containing آ.
// The ASCII stamp is normalization-invariant and unique to this run's row.
r = await req('GET', '/api/r/lab_result?q=' + encodeURIComponent(STAMP) + '&sort=id:desc', A);
ok('S3 lab result search by unique test name', r.status === 200 && r.data.items.some(i => i.id === lrRes), `n=${r.data.items?.length}`);

// S4: price list search by unique name
r = await req('GET', '/api/r/price_list?q=' + encodeURIComponent('لیست بخش6 ' + STAMP), A);
ok('S4 price list search by unique name', r.status === 200 && r.data.items.some(i => i.id === pl), `n=${r.data.items?.length}`);

// S5: loyalty tier search by unique name
r = await req('GET', '/api/r/loyalty_tier?q=' + encodeURIComponent('سطح بخش6 ' + STAMP), A);
ok('S5 loyalty tier search by unique name', r.status === 200 && r.data.items.some(i => i.id === tier), `n=${r.data.items?.length}`);

// S6: search + filter coherence (stock: q AND raw-material filter)
r = await req('GET', '/api/r/product?q=' + encodeURIComponent('S6-' + STAMP.slice(2)) + '&f_is_raw_material=1', A);
ok('S6 stock search + raw filter coherent (finds raw product)', r.status === 200 && r.data.items.some(i => i.id === prod && i.is_raw_material === 1), `n=${r.data.items?.length}`);
r = await req('GET', '/api/r/product?q=' + encodeURIComponent('S6-' + STAMP.slice(2)) + '&f_is_raw_material=0', A);
ok('S6b stock search + non-raw filter → 0 (product IS raw)', r.status === 200 && !r.data.items.some(i => i.id === prod), `n=${r.data.items?.length}`);
// lab result search + status filter (ASCII stamp — see S3 note on normalization)
r = await req('GET', '/api/r/lab_result?q=' + encodeURIComponent(STAMP) + '&f_status=pass', A);
ok('S6c lab result search + status filter coherent', r.status === 200 && r.data.items.some(i => i.id === lrRes && i.status === 'pass'), `n=${r.data.items?.length}`);

// ================= EXPORT =================
// E1: contacts export — all three machine formats + data correctness
let e = await apiExport('/api/contacts/export?format=xlsx', A);
ok('E1a contacts XLSX export (200 + xlsx mime + zip magic)', e.status === 200 && e.ct.includes('spreadsheetml') && e.buf.slice(0, 2).toString() === 'PK', `ct=${e.ct}`);
e = await apiExport('/api/contacts/export?format=csv', A);
const csv = e.buf.toString('utf8');
ok('E1b contacts CSV export (BOM + header + unique contact name)', e.status === 200 && e.ct.includes('csv') && csv.startsWith('\uFEFF') && csv.includes('نام مخاطب') && csv.includes('مخاطب بخش6 ' + STAMP), 'len=' + csv.length);
e = await apiExport('/api/contacts/export?format=json', A);
ok('E1c contacts JSON export (valid JSON, contains unique contact)', e.status === 200 && !!e.data && JSON.stringify(e.data).includes('مخاطب بخش6 ' + STAMP), '');

// E2: export respects the CURRENT search (q)
e = await apiExport('/api/contacts/export?format=json&q=' + encodeURIComponent('مخاطب بخش6 ' + STAMP), A);
const cRows = e.data?.sheets?.['مخاطبین'] || [];
ok('E2 contacts export respects search (only matching rows)', e.status === 200 && cRows.length >= 1 && cRows.every(r => r['نام مخاطب'].includes('بخش6') || r['مشتری'].includes('بخش6')), `rows=${cRows.length}`);
e = await apiExport('/api/contacts/export?format=json&q=ناموجود' + STAMP, A);
ok('E2b contacts export with non-matching search → 0 data rows', e.status === 200 && (e.data?.sheets?.['مخاطبین'] || []).length === 0, 'rows=' + (e.data?.sheets?.['مخاطبین'] || []).length);

// E3: stock export (all + raw filter + search)
e = await apiExport('/api/stock/export?format=json', A);
const stockAll = e.data?.sheets?.['موجودی'] || [];
ok('E3a stock export (all records from DB)', e.status === 200 && stockAll.length >= 1 && stockAll.some(r => r['کد'] === 'S6-' + STAMP.slice(2)), `rows=${stockAll.length}`);
e = await apiExport('/api/stock/export?format=json&raw=1', A);
const stockRaw = e.data?.sheets?.['موجودی'] || [];
ok('E3b stock export raw=1 (only raw materials, includes our raw product)', e.status === 200 && stockRaw.length >= 1 && stockRaw.every(r => true) && stockRaw.some(r => r['کد'] === 'S6-' + STAMP.slice(2)), `rows=${stockRaw.length}`);
e = await apiExport('/api/stock/export?format=json&q=' + encodeURIComponent('S6-' + STAMP.slice(2)), A);
const stockQ = e.data?.sheets?.['موجودی'] || [];
ok('E3c stock export respects search (1 row)', e.status === 200 && stockQ.length === 1 && stockQ[0]['کد'] === 'S6-' + STAMP.slice(2), `rows=${stockQ.length}`);

// E4: loyalty export (tiers + members sheets)
e = await apiExport('/api/loyalty/export?format=json', A);
const tiers = e.data?.sheets?.['سطوح'] || [];
const members = e.data?.sheets?.['اعضا'] || [];
ok('E4a loyalty export has tiers + members sheets', e.status === 200 && tiers.length >= 1 && Array.isArray(members), `tiers=${tiers.length} members=${members.length}`);
ok('E4b loyalty export includes the new tier', tiers.some(t => t['سطح'] === 'سطح بخش6 ' + STAMP && t['حداقل امتیاز'] === 777), '');
e = await apiExport('/api/loyalty/export?format=json&q=' + encodeURIComponent('سطح بخش6 ' + STAMP), A);
const tiersQ = e.data?.sheets?.['سطوح'] || [];
ok('E4c loyalty export respects search (1 tier)', e.status === 200 && tiersQ.length === 1 && tiersQ[0]['سطح'] === 'سطح بخش6 ' + STAMP, `rows=${tiersQ.length}`);

// E5: lab results export (request number + Jalali date)
e = await apiExport('/api/lab/results/export?format=json&q=' + encodeURIComponent(STAMP), A); // ASCII stamp — see S3 note
const labRows = e.data?.sheets?.['نتایج آزمایش'] || [];
ok('E5a lab export includes the result with request number', e.status === 200 && labRows.length === 1 && labRows[0]['درخواست'] === lrNum && labRows[0]['آزمون'] === 'آزمون یکتا6 ' + STAMP, JSON.stringify(labRows[0] || {}));
ok('E5b lab export date is JALALI (' + TEST_DATE + ' → ' + JALALI_TEST_DATE + ')', labRows[0]?.['تاریخ آزمون (شمسی)'] === JALALI_TEST_DATE, 'date=' + (labRows[0] || {})['تاریخ آزمون (شمسی)']);
e = await apiExport('/api/lab/results/export?format=json&status=pass', A);
ok('E5c lab export respects status filter (only pass)', e.status === 200 && (e.data?.sheets?.['نتایج آزمایش'] || []).every(r => r['وضعیت'] === 'مطابق'), `rows=${(e.data?.sheets?.['نتایج آزمایش'] || []).length}`);

// E6: price lists export (list + items)
e = await apiExport('/api/pricelist/export?format=json&q=' + encodeURIComponent('لیست بخش6 ' + STAMP), A);
const plRows = e.data?.sheets?.['لیست قیمت‌ها'] || [];
ok('E6a price list export includes the list with its item', e.status === 200 && plRows.length >= 1 && plRows.some(r => r['لیست قیمت'] === 'لیست بخش6 ' + STAMP && r['نام کالا'] && r['قیمت'] === 550000), `status=${e.status} ct=${e.ct} rows=${plRows.length}`);
ok('E6b price list export Jalali validity window', e.status === 200 && plRows.some(r => String(r['اعتبار (شمسی)']).includes('ادامه')), JSON.stringify(plRows[0] || {}));

// E7: HTML (printable → PDF) export with company header + data
e = await apiExport('/api/contacts/export?format=html', A);
ok('E7a contacts HTML export (200 + html + data present)', e.status === 200 && e.ct.includes('html') && e.buf.toString('utf8').includes('مخاطب بخش6 ' + STAMP), '');
e = await apiExport('/api/lab/results/export?format=html', A);
const labHtml = e.buf.toString('utf8');
ok('E7b lab HTML export has company header + Jalali date', e.status === 200 && labHtml.includes('نتایج آزمایش') && labHtml.includes(JALALI_TEST_DATE), '');

// E8: permission — lab-role user can SEARCH (has view) but cannot EXPORT (no export perm)
r = await req('GET', '/api/contacts?q=' + encodeURIComponent('مخاطب بخش6 ' + STAMP), M);
ok('E8a lab user CAN search contacts (customer:view)', r.status === 200 && r.data.items.length >= 1, `n=${r.data.items?.length}`);
r = await req('GET', '/api/r/lab_result?q=' + encodeURIComponent(STAMP), M); // ASCII stamp — see S3 note
ok('E8b lab user CAN search lab results (lab_result:view)', r.status === 200 && r.data.items.some(i => i.id === lrRes), `n=${r.data.items?.length}`);
e = await apiExport('/api/contacts/export?format=csv', M);
ok('E8c lab user CANNOT export contacts → 403 (no customer:export)', e.status === 403, `status=${e.status}`);
e = await apiExport('/api/lab/results/export?format=csv', M);
ok('E8d lab user CANNOT export lab results → 403 (no lab_result:export)', e.status === 403, `status=${e.status}`);
e = await apiExport('/api/stock/export?format=csv', M);
ok('E8e lab user CANNOT export stock → 403 (no product:export)', e.status === 403, `status=${e.status}`);
e = await apiExport('/api/loyalty/export?format=csv', M);
ok('E8f lab user CANNOT export loyalty → 403 (no loyalty_tier:export)', e.status === 403, `status=${e.status}`);
e = await apiExport('/api/pricelist/export?format=csv', M);
ok('E8g lab user CANNOT export price lists → 403 (no price_list:export)', e.status === 403, `status=${e.status}`);

// E9: existing generic export still works (regression of pre-existing export)
e = await apiExport('/api/r/customer/export?format=csv&q=' + encodeURIComponent('مشتری بخش6 ' + STAMP), A);
const custCsv = e.buf.toString('utf8');
ok('E9 existing /api/r/customer/export still works (regression)', e.status === 200 && custCsv.startsWith('\uFEFF') && custCsv.includes('مشتری بخش6 ' + STAMP), 'len=' + custCsv.length);

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
    del('DELETE FROM lab_results WHERE id=?', lrRes);
    del('DELETE FROM lab_requests WHERE id=?', lr);
    del('DELETE FROM price_list_items WHERE price_list_id=?', pl);
    del('DELETE FROM price_lists WHERE id=?', pl);
    del('DELETE FROM customer_contacts WHERE id=?', contact);
    del('DELETE FROM customers WHERE id=?', cust);
    del('DELETE FROM customers WHERE id=?', cust2);
    del('DELETE FROM loyalty_tiers WHERE id=?', tier);
    del('DELETE FROM products WHERE id=?', prod);
  });
  tx(); d.close();
  console.log('cleanup done');
})().then(async () => {
  console.log('\n========== SEARCH & EXPORT — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
});
