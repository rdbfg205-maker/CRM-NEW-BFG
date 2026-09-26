// Section 9.2 — Laboratory (آزمایشگاه): real-HTTP end-to-end test suite (no mocks).
// Request/result lifecycle, attachments, order link, report generation,
// search/filter, export (XLSX/CSV/JSON/HTML-PDF, Jalali), permissions + audit. Cleans up.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'LB' + String(Date.now()).slice(-5);
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
  const buf = Buffer.from(await r.arrayBuffer());
  const t = buf.toString('utf8'); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t, buf, ct: r.headers.get('content-type') || '' };
}
async function uploadMultipart(token, fields, fileName, fileBuf, mime) {
  const boundary = '----lbtest' + Date.now().toString(36);
  let body = '';
  for (const [k, v] of Object.entries(fields)) body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`;
  const head = Buffer.from(body, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const r = await fetch(BASE + '/api/attachments', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: 'Bearer ' + token },
    body: Buffer.concat([head, fileBuf, tail]),
  });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };

const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }
const M = (await req('POST', '/api/auth/login', { username: 'saeid.t', password: '12345678' })).data.access; // lab role
const S = (await req('POST', '/api/auth/login', { username: 'sara.m', password: '12345678' })).data.access; // sales role: no lab perms (may be null)
if (!M) { console.log('FATAL: saeid.t login failed'); process.exit(2); }

const G = {};
try {
  // ---------- controlled data (real API) ----------
  G.cust = (await req('POST', '/api/r/customer', { name: 'مشتری نمونه ' + STAMP, type: 'company' }, A)).data.id;
  const prod = (await req('POST', '/api/r/product', { code: 'LB-' + STAMP.slice(2), name: 'کالای آزمایش ' + STAMP, unit: 'عدد' }, A)).data.id;
  G.prod = prod;
  const o = (await req('POST', '/api/r/order', { customer_id: G.cust, status: 'confirmed' }, A)).data.id;
  await req('PUT', `/api/r/order/${o}/items`, { items: [{ product_id: prod, name: 'ردیف آزمایش', qty: 1, price: 1000 }] }, A);
  G.order = o;
  const oNum = q1('SELECT number FROM orders WHERE id=?', o).number;

  // ---------- request lifecycle ----------
  let r = await req('POST', '/api/r/lab_request', { customer_id: G.cust, order_id: o, test_type: 'density', priority: 'high', status: 'received' }, A);
  G.lr = r.data.id;
  const lrRow = q1('SELECT * FROM lab_requests WHERE id=?', G.lr);
  ok('L01 lab request created with Customer + Order link', !!G.lr && lrRow.customer_id === G.cust && lrRow.order_id === o && /^LR-/.test(lrRow.number), `id=${G.lr} num=${lrRow.number}`);
  ok('L02 request number auto-assigned (LR-…)', /^LR-\d{6}-\d{4}$/.test(lrRow.number), lrRow.number);

  r = await req('POST', '/api/r/lab_result', { request_id: G.lr, test_name: 'آزمون چگالی ' + STAMP, method: 'ASTM D1621', result_value: '30', unit: 'kg/m3', spec_text: '28±2', status: 'pass', test_date: '2026-09-07' }, A);
  G.res = r.data.id;
  ok('L03 lab result linked to request', !!G.res && q1('SELECT request_id FROM lab_results WHERE id=?', G.res).request_id === G.lr, 'res=' + G.res);

  // second request for search/filter coverage
  r = await req('POST', '/api/r/lab_request', { customer_id: G.cust, test_type: 'tensile', priority: 'low', status: 'in_progress' }, A);
  G.lr2 = r.data.id;

  // ---------- search / filter ----------
  r = await req('GET', '/api/r/lab_request?q=' + encodeURIComponent(lrRow.number), A);
  ok('L04 search request by number', r.status === 200 && r.data.items.some(i => i.id === G.lr), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/lab_request?q=' + encodeURIComponent('مشتری نمونه ' + STAMP), A);
  ok('L05 search request by customer name (join search)', r.status === 200 && r.data.items.some(i => i.id === G.lr), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/lab_request?f_status=in_progress&q=' + encodeURIComponent(STAMP), A);
  ok('L06 filter f_status + search coherent', r.status === 200 && r.data.items.some(i => i.id === G.lr2) && !r.data.items.some(i => i.id === G.lr && i.status !== 'in_progress'), `n=${r.data.items?.length}`);
  r = await req('GET', '/api/r/lab_result?q=' + encodeURIComponent(STAMP), A);
  ok('L07 search result by stamp', r.status === 200 && r.data.items.some(i => i.id === G.res), `n=${r.data.items?.length}`);

  // ---------- attachments (پیوست) ----------
  const tmpFile = path.join(os.tmpdir(), 'lb-spec-' + STAMP + '.txt');
  fs.writeFileSync(tmpFile, 'محدوده مرجع ASTM\n' + STAMP);
  const up = await uploadMultipart(A, { entity_type: 'lab_request', entity_id: G.lr }, 'spec.txt', fs.readFileSync(tmpFile), 'text/plain');
  ok('L08 attachment uploaded to lab request (multipart)', up.status === 200 && Array.isArray(up.data.ids) && up.data.ids.length === 1, JSON.stringify(up.data).slice(0, 100));
  fs.unlinkSync(tmpFile);
  const atts = await req('GET', '/api/r/lab_request/' + G.lr + '/attachments', A);
  ok('L09 attachment listed on the request', atts.status === 200 && (atts.data.items || []).some(a => a.entity_type === 'lab_request' && a.file_name === 'spec.txt'), `n=${(atts.data.items || []).length}`);
  if (atts.data.items?.length) {
    const dl = await req('GET', '/api/attachments/' + atts.data.items[0].id + '/download', A);
    ok('L10 attachment download returns the file content', dl.status === 200 && dl.buf.toString('utf8').includes(STAMP), 'len=' + dl.buf.length);
  } else ok('L10 attachment download returns the file content', false, 'no attachment');

  // ---------- report generation (ارجاع/گزارش) ----------
  // move request to done, then generate report
  await req('PUT', '/api/r/lab_request/' + G.lr, { status: 'done' }, A);
  r = await req('POST', '/api/lab/' + G.lr + '/report', {}, A);
  ok('L11 report generation → status reported + print URL', r.status === 200 && r.data.printUrl === '/api/print/lab/' + G.lr, JSON.stringify(r.data).slice(0, 100));
  const print = await req('GET', '/api/print/lab/' + G.lr, A);
  ok('L12 printed report HTML includes result + Jalali date', print.status === 200 && print.ct.includes('html') && print.text.includes('آزمون چگالی ' + STAMP) && /۱۴۵|1405/.test(print.text), `len=${print.text.length}`);

  // ---------- exports ----------
  let e = await req('GET', '/api/lab/requests/export?format=json&q=' + encodeURIComponent(STAMP), A);
  const rqRows = e.data?.sheets?.['درخواست‌های آزمایش'] || [];
  ok('E1 requests JSON export (search + order link + Jalali)', e.status === 200 && rqRows.length >= 2 && rqRows.some(x => x['شماره'] === lrRow.number && x['سفارش مبدا'] === oNum && /1405-/.test(x['تاریخ دریافت (شمسی)'])), `rows=${rqRows.length}`);
  e = await req('GET', '/api/lab/requests/export?format=xlsx&q=' + encodeURIComponent(STAMP), A);
  ok('E2 requests XLSX export (PK)', e.status === 200 && e.buf.slice(0, 2).toString() === 'PK', `ct=${e.ct}`);
  e = await req('GET', '/api/lab/requests/export?format=csv', A);
  ok('E3 requests CSV export (BOM + header)', e.status === 200 && e.buf.slice(0, 3).toString('hex') === 'efbbbf' && e.buf.toString('utf8').includes('نوع آزمون'), '');
  e = await req('GET', '/api/lab/requests/export?format=html&q=' + encodeURIComponent(STAMP), A);
  ok('E4 requests HTML (printable PDF) export with company + data', e.status === 200 && e.ct.includes('html') && e.text.includes('بسپار') && e.text.includes(lrRow.number), `ct=${e.ct}`);
  e = await req('GET', '/api/lab/results/export?format=json&q=' + encodeURIComponent(STAMP), A);
  const resRows = e.data?.sheets?.['نتایج آزمایش'] || [];
  ok('E5 results JSON export (Jalali test date)', e.status === 200 && resRows.length === 1 && /1405-/.test(String(resRows[0]['تاریخ آزمون (شمسی)'])), JSON.stringify(resRows[0] || {}).slice(0, 140));

  // ---------- permissions (backend) ----------
  r = await req('GET', '/api/r/lab_request?per_page=5', M);
  ok('P1 lab role CAN list lab requests (lab_request:view)', r.status === 200, `status=${r.status}`);
  r = await req('POST', '/api/r/lab_request', { customer_id: G.cust, test_type: 'density', status: 'received' }, M);
  const labReqByM = r.data.id;
  G.lr3 = labReqByM;
  ok('P2 lab role CAN create lab request', r.status === 200 && !!labReqByM, `status=${r.status}`);
  r = await req('GET', '/api/r/lab_result?per_page=5', M);
  ok('P3 lab role CAN list lab results (lab_result:view)', r.status === 200, `status=${r.status}`);
  r = await req('GET', '/api/r/product?per_page=5', M);
  ok('P4 lab role CANNOT list products (no product:view) → 403', r.status === 403, `status=${r.status}`);
  if (S) {
    r = await req('GET', '/api/r/lab_request?per_page=5', S);
    ok('P5 sales role (no lab perms) CANNOT list lab requests → 403', r.status === 403, `status=${r.status}`);
    r = await req('GET', '/api/lab/requests/export?format=csv', S);
    ok('P6 sales role CANNOT export lab requests → 403', r.status === 403, `status=${r.status}`);
  } else {
    ok('P5 sales role (no lab perms) CANNOT list lab requests → 403', false, 'sara.m login unavailable — NOT TESTED');
    ok('P6 sales role CANNOT export lab requests → 403', false, 'sara.m login unavailable — NOT TESTED');
  }

  // ---------- audit ----------
  const audReq = q1(`SELECT COUNT(*) c FROM audit_logs WHERE entity='lab_request' AND action='create' AND new_value LIKE ?`, '%' + G.lr + '%');
  ok('U1 lab request creation audited', audReq.c >= 1, 'n=' + audReq.c);
  const audRes = q1(`SELECT COUNT(*) c FROM audit_logs WHERE entity='lab_result' AND action='create' AND new_value LIKE ?`, '%' + G.res + '%');
  ok('U2 lab result creation audited', audRes.c >= 1, 'n=' + audRes.c);
} catch (err) {
  ok('suite completed without unexpected crash', false, (err.stack || String(err)).slice(0, 300));
}

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
    del(`DELETE FROM attachments WHERE entity_type='lab_request' AND entity_id IN (${[G.lr, G.lr2, G.lr3].filter(Boolean).join(',') || '0'})`);
    del('DELETE FROM lab_results WHERE request_id IN (' + [G.lr, G.lr2, G.lr3].filter(Boolean).join(',') + ')');
    del('DELETE FROM lab_requests WHERE id IN (' + [G.lr, G.lr2, G.lr3].filter(Boolean).join(',') + ')');
    del('DELETE FROM order_items WHERE order_id=?', G.order || 0);
    del('DELETE FROM orders WHERE id=?', G.order || 0);
    del('DELETE FROM stock_transactions WHERE product_id=?', G.prod || 0);
    del('DELETE FROM products WHERE id=?', G.prod || 0);
    del('DELETE FROM customers WHERE id=?', G.cust || 0);
  });
  tx(); d.close();
  console.log('cleanup done');
  console.log('\n========== LABORATORY (SECTION 9.2) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 150) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
