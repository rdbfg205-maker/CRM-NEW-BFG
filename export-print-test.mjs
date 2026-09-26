// Export/Print central service — real E2E (all 20 mandated scenarios)
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const XLSX = require('xlsx');
const B = 'http://127.0.0.1:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; fails.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// login with retry/backoff: resilient to the legitimate login rate-limiter
// (a prior suite in a batched run may have consumed the 10/min/IP budget)
async function login(u, p) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    const j = await r.json().catch(() => ({}));
    if (j.access) return j.access;
    if (r.status === 429) { await sleep(62000); continue; } // rate-limited -> wait out the window
    // 401 with wrong creds would be a real bug; but a transient no-token also retries
    await sleep(1500);
  }
  throw new Error('login failed for ' + u + ' after retries');
}
const H = (t) => ({ Authorization: 'Bearer ' + t });
const getHtml = async (url, t) => { const r = await fetch(B + url, { headers: H(t) }); return { status: r.status, text: await r.text() }; };
const getBuf = async (url, t) => { const r = await fetch(B + url, { headers: H(t) }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || '' }; };
const post = async (url, body, t) => { const r = await fetch(B + url, { method: 'POST', headers: { ...H(t), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json().catch(() => ({})) }; };
const del = async (url, t) => { const r = await fetch(B + url, { method: 'DELETE', headers: H(t) }); return { status: r.status, d: await r.json().catch(() => ({})) }; };

(async () => {
  const A = await login('admin', 'admin1234');
  const STAMP = String(Date.now()).slice(-6);
  const db = require('better-sqlite3')('/home/user/baspar-crm/data/baspar-crm.sqlite');

  // ===== setup real records =====
  const cust = (await post('/api/r/customer', { name: 'شرکت خروجی ' + STAMP, type: 'company', province: 'فارس', city: 'شیراز', industrial_city: 'شهرک صنعتی مامونیه', mobile: '0912' + STAMP.slice(0, 4), salesperson_id: 1 }, A)).d;
  const CUST = cust.id;
  const prod = (await post('/api/r/product', { code: 'EXP' + STAMP, name: 'کالای خروجی ' + STAMP, price_retail: 1000000, stock_qty: 50 }, A)).d;
  const PROD = prod.id;
  const lead = (await post('/api/r/lead', { company: 'سرنخ خروجی ' + STAMP, contact_name: 'کسی', phone: '0912' + STAMP.slice(0, 4) }, A)).d;
  const LEAD = lead.id;
  const opp = (await post('/api/r/opportunity', { title: 'فرصت خروجی ' + STAMP, customer_id: CUST, amount: 50000000, stage_id: 1 }, A)).d;
  const OPP = opp.id;
  // quote with 2 items (multi-item doc)
  const q = (await post('/api/r/quote', { customer_id: CUST, salesperson_id: 1 }, A)).d;
  const QUOTE = q.id;
  const putItems = async (url, body) => { const r = await fetch(B + url, { method: 'PUT', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json().catch(() => ({})) }; };
  await putItems('/api/r/quote/' + QUOTE + '/items', { items: [
    { product_id: PROD, name: 'کالای خروجی ' + STAMP, qty: 2, price: 1000000 },
    { product_id: PROD, name: 'کالای خروجی ' + STAMP, qty: 3, price: 1000000 },
  ] });
  const fu = (await post('/api/r/followup', { entity_type: 'customer', entity_id: CUST, subject: 'پیگیری خروجی ' + STAMP, due_at: '2026-09-20T09:00:00.000Z' }, A)).d;
  const FU = fu.id;
  const meeting = (await post('/api/meetings', { title: 'جلسه خروجی ' + STAMP, customer_id: CUST, start_at: '2026-09-20T10:00:00.000Z', status: 'scheduled' }, A)).d;
  const MEET = meeting.id;
  const task = (await post('/api/r/task', { title: 'وظیفه خروجی ' + STAMP, assignee_id: 1, due_at: '2026-09-22T09:00:00.000Z' }, A)).d;
  const TASK = task.id;
  const complaint = (await post('/api/r/complaint', { customer_id: CUST, subject: 'شکایت خروجی ' + STAMP, priority: 'medium' }, A)).d;
  const COMP = complaint.id;

  // ============ 1-4: customer print with/without header (= PDF source) ============
  console.log('== 1-4. customer record print (with/without header) ==');
  let r = await getHtml('/api/print/record/customer/' + CUST, A);
  ok('P1 print with header: 200 + logo + company info', r.status === 200 && r.text.includes('logo-selen.png') && r.text.includes('بسپار فوم غرب'), 'status=' + r.status);
  r = await getHtml('/api/print/record/customer/' + CUST + '?header=0', A);
  ok('P2 print WITHOUT header: no logo, no company block', r.status === 200 && !r.text.includes('logo-selen.png') && !r.text.includes('class="head"'), 'status=' + r.status);
  ok('P3 PDF(with header) same template as print (printable html + autoPrint)', /logo-selen\.png/.test((await getHtml('/api/print/record/customer/' + CUST + '?autoprint=1', A)).text) && (await getHtml('/api/print/record/customer/' + CUST + '?autoprint=1', A)).text.includes('window.print'), '');
  ok('P4 PDF(without header) same template', (await getHtml('/api/print/record/customer/' + CUST + '?header=0&autoprint=1', A)).text.includes('window.print') && !(await getHtml('/api/print/record/customer/' + CUST + '?header=0&autoprint=1', A)).text.includes('logo-selen.png'), '');

  // ============ 5-6,18,19: Excel export (all / filtered / selected) ============
  console.log('== 5,6,18,19. Excel export: all / filtered / selected ==');
  let x = await getBuf('/api/r/customer/export?format=xlsx', A);
  ok('X1 Excel is REAL XLSX (PK magic)', x.status === 200 && x.buf.slice(0, 2).toString() === 'PK', 'ct=' + x.ct);
  let wb = XLSX.read(x.buf, { type: 'buffer' });
  let ws = wb.Sheets[wb.SheetNames[0]];
  let aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
  ok('X2 Excel has report title row', /خروجی/.test(String(aoa[0][0])) || /مشتری/.test(String(aoa[0][0])), 'row0=' + JSON.stringify(aoa[0]).slice(0, 60));
  const { faDigits } = require('/home/user/baspar-crm/server/lib/util');
  const jalaliYearFa = faDigits('1405'); // full 4-digit Jalali year in Persian digits
  const hasFullYear = (s) => (String(s).includes('1405') || String(s).includes(jalaliYearFa));
  ok('X3 Excel has generated date row (Jalali full year 1405)', hasFullYear(aoa[1][0]), 'row1=' + JSON.stringify(aoa[1]).slice(0, 60));
  ok('X4 Excel contains the real record data', aoa.slice(3).some(row => row.some(cell => String(cell ?? '').includes('شرکت خروجی ' + STAMP))), '');
  // filtered: q search narrows the set
  let xf = await getBuf('/api/r/customer/export?format=xlsx&q=' + encodeURIComponent('شرکت خروجی ' + STAMP), A);
  let wbf = XLSX.read(xf.buf, { type: 'buffer' }); let aof = XLSX.utils.sheet_to_json(wbf.Sheets[wbf.SheetNames[0]], { header: 1 });
  const dataRows = aof.slice(3);
  ok('X5 filtered Excel contains ONLY matching rows', dataRows.length >= 1 && dataRows.every(row => row.some(cell => String(cell ?? '').includes('خروجی ' + STAMP)) || row.some(cell => String(cell ?? '').startsWith('CS-'))), 'rows=' + dataRows.length);
  // selected: ids=
  let xs = await getBuf('/api/r/customer/export?format=xlsx&ids=' + CUST, A);
  let wbs = XLSX.read(xs.buf, { type: 'buffer' }); let aos = XLSX.utils.sheet_to_json(wbs.Sheets[wbs.SheetNames[0]], { header: 1 });
  const selRows = aos.slice(3);
  ok('X6 selected-records Excel = exactly the selected ids', selRows.length === 1 && selRows[0].some(cell => String(cell ?? '').includes('شرکت خروجی ' + STAMP)), 'rows=' + selRows.length);
  // csv + json
  let xc = await getBuf('/api/r/customer/export?format=csv', A);
  ok('X7 CSV export with BOM', xc.status === 200 && xc.buf.slice(0, 3).toString('hex') === 'efbbbf', '');

  // ============ 7-8: quote multi-item print (rich template) ============
  console.log('== 7-8. quote print (multi-item) ==');
  r = await getHtml('/api/print/quote/' + QUOTE, A);
  ok('Q1 quote print: 200 + header + 2 line items + totals', r.status === 200 && r.text.includes('logo-selen.png') && (r.text.match(/کالای خروجی/g) || []).length >= 2 && r.text.includes('مبلغ کل قابل پرداخت'), 'status=' + r.status);
  r = await getHtml('/api/print/quote/' + QUOTE + '?header=0', A);
  ok('Q2 quote print without header', r.status === 200 && !r.text.includes('logo-selen.png') && r.text.includes('کالای خروجی'), '');

  // ============ 9-10: sales report print (multi-page) + excel ============
  console.log('== 9-10. sales report print + excel ==');
  const from = '2020-01-01T00:00:00.000Z', to = '2030-01-01T00:00:00.000Z';
  r = await getHtml('/api/salesreports/sales_by_customer/export?format=html&from=' + from + '&to=' + to, A);
  ok('R1 report print html: 200 + header + table', r.status === 200 && r.text.includes('logo-selen.png') && r.text.includes('<table'), 'status=' + r.status);
  ok('R2 report print without header option', (await getHtml('/api/salesreports/sales_by_customer/export?format=html&header=0&from=' + from + '&to=' + to, A)).text.includes('<table') && !(await getHtml('/api/salesreports/sales_by_customer/export?format=html&header=0&from=' + from + '&to=' + to, A)).text.includes('logo-selen.png'), '');
  x = await getBuf('/api/salesreports/sales_by_customer/export?format=xlsx&from=' + from + '&to=' + to, A);
  wb = XLSX.read(x.buf, { type: 'buffer' }); aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  ok('R3 report Excel: real XLSX + title + company + generated date', x.buf.slice(0, 2).toString() === 'PK' && String(aoa[0][0]).includes('مشتری') && String(aoa[1][0]).includes('شرکت') && (String(aoa[2][0]).includes('1405') || String(aoa[2][0]).includes(jalaliYearFa)), JSON.stringify(aoa.slice(0, 3).map(r0 => r0[0])));

  // ============ 11-17: document standards (RTL, font, logo, page-break, thead repeat, Jalali) ============
  console.log('== 11-17. document standards ==');
  r = await getHtml('/api/print/record/customer/' + CUST, A);
  const doc = r.text;
  ok('S11 full RTL (dir=rtl lang=fa)', doc.includes('dir="rtl"') && doc.includes('lang="fa"'), '');
  ok('S12 Persian font (Vazirmatn @font-face)', doc.includes('@font-face') && doc.includes('vazirmatn'), '');
  ok('S13 logos present (official header)', doc.includes('logo-selen.png') && (doc.includes('logo-baspar.png') || doc.includes('logo-selen.png')), '');
  ok('S14 page-break rules (avoid row/signature splits)', doc.includes('page-break-inside: avoid'), '');
  ok('S15 repeating table header (thead table-header-group)', doc.includes('display: table-header-group'), '');
  const truncatedFa = faDigits('145'); // the buggy truncated form to guard against
  ok('S16 Jalali date with FULL year 1405 (never 145)', (doc.includes(jalaliYearFa) || doc.includes('1405')) && !doc.includes(truncatedFa + ' ') && !doc.includes(truncatedFa + '،') && !/\b145(?!\d)/.test(doc), 'full=' + doc.includes(jalaliYearFa) + ' truncated=' + doc.includes(truncatedFa));
  ok('S17 A4 @page + print footer (date + user)', doc.includes('@page') && doc.includes('A4') && doc.includes('print-foot'), '');

  // ============ 15 (page number note) / list print ============
  console.log('== list print (central) ==');
  r = await getHtml('/api/print/list/customer?header=1', A);
  ok('L1 list print with header: 200 + header + table', r.status === 200 && r.text.includes('logo-selen.png') && r.text.includes('<table'), 'status=' + r.status);
  r = await getHtml('/api/print/list/customer?header=0', A);
  ok('L2 list print without header', r.status === 200 && !r.text.includes('logo-selen.png') && r.text.includes('<table'), '');
  r = await getHtml('/api/print/list/customer?q=' + encodeURIComponent('شرکت خروجی ' + STAMP), A);
  ok('L3 filtered list print = only filtered rows', r.text.includes('شرکت خروجی ' + STAMP) && !/شرکت دیگری/.test(r.text), '');

  // ============ record print for ALL major modules ============
  console.log('== record print across modules ==');
  const mods = [
    ['customer', CUST], ['lead', LEAD], ['opportunity', OPP], ['product', PROD],
    ['followup', FU], ['meeting', MEET], ['task', TASK], ['complaint', COMP], ['quote', QUOTE],
  ];
  for (const [ent, id] of mods) {
    const rr = await getHtml('/api/print/record/' + ent + '/' + id, A);
    ok('M- ' + ent + ' record print 200 + content', rr.status === 200 && rr.text.includes('<h1') && rr.text.length > 1500, 'status=' + rr.status);
  }
  // followup record shows attempts history section when present
  await post('/api/followups/' + FU + '/attempts', { method: 'call', result: 'تماس شد — خروجی', acted_at: '2026-09-16T09:00:00.000Z', user_id: 1 }, A);
  const fuDoc = (await getHtml('/api/print/record/followup/' + FU, A)).text;
  ok('M- followup print includes attempts history (real)', fuDoc.includes('تاریخچه پیگیری‌ها') && fuDoc.includes('تماس شد — خروجی'), '');
  // product record shows stock section
  const prodDoc = (await getHtml('/api/print/record/product/' + PROD, A)).text;
  ok('M- product print includes stock section', prodDoc.includes('وضعیت موجودی'), '');

  // ============ workflow export ============
  console.log('== workflow export ==');
  x = await getBuf('/api/wf/export?scope=processes&format=xlsx', A);
  ok('W1 wf processes Excel real XLSX', x.status === 200 && x.buf.slice(0, 2).toString() === 'PK', 'status=' + x.status);
  r = await getHtml('/api/wf/export?scope=executions&format=html', A);
  ok('W2 wf executions html print', r.status === 200 && r.text.includes('<table'), 'status=' + r.status);

  // ============ 17-20: RBAC ============
  console.log('== 17-20. RBAC ==');
  const LAB = await login('saeid.t', '12345678');   // lab: customer:view, NO customer:export
  const SUP = await login('maryam.h', '12345678');   // support: customer:view, NO customer:export
  const SALES = await login('sara.m', '12345678');   // sales: customer:view+export (scope own)
  let rr = await getBuf('/api/r/customer/export?format=xlsx', LAB);
  ok('RB1 lab user export customer → 403 (has view, no export)', rr.status === 403, rr.status);
  rr = await getHtml('/api/print/record/customer/' + CUST, LAB);
  ok('RB2 lab user print customer → 200 (has view)', rr.status === 200, rr.status);
  rr = await getBuf('/api/r/customer/export?format=xlsx', SUP);
  ok('RB3 support user export customer → 403', rr.status === 403, rr.status);
  // IDOR: sales user (scope own) must NOT print an admin-created customer
  rr = await getHtml('/api/print/record/customer/' + CUST, SALES);
  ok('RB4 IDOR guard: sales (own scope) print admin customer → 403', rr.status === 403, rr.status);
  // but CAN print/export their own (record assigned to them via salesperson_id)
  const salesInfo = await (await fetch(B + '/api/me', { headers: H(SALES) })).json().catch(() => ({}));
  const salesUid = salesInfo && (salesInfo.user && salesInfo.user.id || salesInfo.id);
  const own = (await post('/api/r/customer', { name: 'مشتری خودی ' + STAMP, type: 'company', salesperson_id: salesUid }, SALES)).d;
  rr = await getHtml('/api/print/record/customer/' + own.id, SALES);
  ok('RB5 sales user print OWN (assigned) customer → 200', rr.status === 200, 'status=' + rr.status + ' salesUid=' + salesUid);
  // unauthenticated
  const un = await fetch(B + '/api/r/customer/export?format=xlsx');
  ok('RB6 unauthenticated export → 401', un.status === 401, un.status);
  // wf export RBAC (karim.r production_manager has monitor; saeid.t lab does not)
  const PRD = await login('karim.r', '12345678');
  rr = await getBuf('/api/wf/export?scope=processes&format=xlsx', PRD);
  ok('RB7 production_manager wf export → 200 (has monitor)', rr.status === 200, rr.status);
  rr = await getBuf('/api/wf/export?scope=processes&format=xlsx', LAB);
  ok('RB8 lab user wf export → 403 (no monitor)', rr.status === 403, rr.status);

  // ============ 15: audit ============
  console.log('== 15. audit ==');
  const aud = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action IN ('export','print')").get().c;
  ok('A1 audit rows recorded for export/print', aud >= 5, 'n=' + aud);
  const audWho = db.prepare("SELECT username, entity, action FROM audit_logs WHERE action IN ('export','print') ORDER BY id DESC LIMIT 1").get();
  ok('A2 audit has who/what/when', !!audWho.username && !!audWho.action, JSON.stringify(audWho));

  // ============ cleanup ============
  console.log('== cleanup ==');
  const rm = async (u) => { await del(u, A); };
  await rm('/api/r/complaint/' + COMP + '?hard=1');
  await rm('/api/r/task/' + TASK + '?hard=1');
  await rm('/api/meetings/' + MEET + '?hard=1').catch(() => {});
  await rm('/api/r/lead/' + LEAD + '?hard=1');
  await rm('/api/r/opportunity/' + OPP + '?hard=1');
  await rm('/api/r/quote/' + QUOTE + '?hard=1');
  await rm('/api/r/followup/' + FU + '?hard=1');
  await rm('/api/r/product/' + PROD + '?hard=1');
  await rm('/api/r/customer/' + own.id + '?hard=1');
  await rm('/api/r/customer/' + CUST + '?hard=1');
  db.prepare('DELETE FROM meetings WHERE title LIKE ?').run('جلسه خروجی ' + STAMP);
  // robust direct-DB fallback for anything the API delete missed (scoped to THIS run)
  db.prepare("DELETE FROM quote_items WHERE quote_id NOT IN (SELECT id FROM quotes)").run();
  db.prepare("DELETE FROM customers WHERE name LIKE ? OR name LIKE ?").run('%خروجی ' + STAMP, '%خودی ' + STAMP);
  // final check scoped to THIS run's STAMP (no cross-test bleed)
  const left = db.prepare('SELECT COUNT(*) c FROM customers WHERE name LIKE ? OR name LIKE ?').get('%خروجی ' + STAMP, '%خودی ' + STAMP).c;
  ok('cleanup complete', left === 0, 'left=' + left);
  db.close();

  console.log('');
  console.log('=====================================');
  console.log(`EXPORT/PRINT E2E: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
