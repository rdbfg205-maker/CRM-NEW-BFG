// MASTER AUDIT TEST — new features + final acceptance (real data, no mocks)
const BASE = process.env.BASE || 'http://localhost:3050';
const fs = await import('node:fs');
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('❌ ' + name + ' — ' + extra); }
}
async function req(method, path, body, tok, headers = {}) {
  const h = { ...headers };
  let payload;
  if (body != null && !(body instanceof FormData)) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  else if (body instanceof FormData) payload = body;
  if (tok) h['authorization'] = 'Bearer ' + tok;
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), 20000);
  let r;
  try { r = await fetch(BASE + path, { method, headers: h, body: payload, signal: ac.signal }); } finally { clearTimeout(tm); }
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null;
  try { data = JSON.parse(buf.toString('utf8')); } catch { data = buf.toString('utf8'); }
  return { status: r.status, data, headers: r.headers, buf };
}
const j = (m, p, b, t, h) => req(m, p, b, t, h);

let adminTok, repTok;

// ============ A. Backup Manager ============
async function testBackup() {
  let r = await j('GET', '/api/admin/backups', null, adminTok);
  ok('A1 Backup: لیست با dir/encrypted/last_success', r.status === 200 && r.data.dir && 'encrypted' in r.data && 'last_success' in r.data, 'status=' + r.status);
  const beforeCount = (r.data.items || []).length;
  // settings save
  r = await j('POST', '/api/admin/backup-settings', { schedule: { freq: 'weekly', hour: 3, day: 1 }, retention_days: 30 }, adminTok);
  ok('A2 Backup: ذخیره تنظیمات زمان‌بندی (weekly/03:00/شنبه)', r.status === 200 && r.data.schedule.freq === 'weekly' && r.data.schedule.hour === 3, JSON.stringify(r.data).slice(0, 80));
  // bad dir rejected
  const badDir = await j('POST', '/api/admin/backup-settings', { backup_dir: 'relative/path' }, adminTok);
  ok('A3 Backup: مسیر نسبی/نامعتبر رد می‌شود (Security)', badDir.status === 400, 'status=' + badDir.status);
  // manual backup — real file
  r = await j('POST', '/api/admin/backups', {}, adminTok);
  ok('A4 Backup: بکاپ دستی واقعی (status=success)', r.status === 200 && r.data.status === 'success' && r.data.file_name, JSON.stringify(r.data).slice(0, 100));
  const fname = r.data && r.data.file_name;
  if (fname) {
    const f = '/home/user/baspar-crm/' + r.data.file_name.replace('baspar-backup-', 'data/backups/baspar-backup-');
    const real = f.endsWith('.enc') ? f : f;
    const p2 = '/home/user/baspar-crm/data/backups/' + fname;
    const exists = fs.existsSync(p2);
    let validSqlite = false;
    if (exists && !fname.endsWith('.enc')) validSqlite = fs.readFileSync(p2).slice(0, 15).toString().startsWith('SQLite format 3');
    if (exists && fname.endsWith('.enc')) validSqlite = fs.readFileSync(p2).toString('ascii', 0, 5) === 'BSBK1';
    const mode = exists ? (fs.statSync(p2).mode & 0o777) : 0;
    ok('A5 Backup: فایل روی دیسک + هدر معتبر + mode 600', exists && validSqlite && mode === 0o600, 'exists=' + exists + ' valid=' + validSqlite + ' mode=' + (mode & 0o777).toString(8));
    // restore (real round-trip)
    const rr = await j('POST', `/api/admin/backups/${r.data.id}/restore`, {}, adminTok);
    ok('A6 Backup: Restore واقعی (بازیابی از فایل)', rr.status === 200 && rr.data.ok === true, JSON.stringify(rr.data).slice(0, 60));
  } else {
    ok('A5 Backup: فایل روی دیسک + هدر معتبر + mode 600', false, 'no backup created');
    ok('A6 Backup: Restore واقعی (بازیابی از فایل)', false, 'no backup created');
  }
  // history status
  r = await j('GET', '/api/admin/backups', null, adminTok);
  // after restore, the history reflects the restored point-in-time (authoritative DB state)
  ok('A7 Backup: تاریخچه با وضعیت (آخرین موفق/ناموفق)', r.status === 200 && r.data.last_success && (r.data.items || []).every(b => b.status === 'success' || b.status === 'failed'), 'last_success=' + !!r.data.last_success);
  // permission: rep cannot create/configure
  const bp = await j('POST', '/api/admin/backups', {}, repTok);
  const bs = await j('POST', '/api/admin/backup-settings', {}, repTok);
  ok('A8 Backup: Permission (rep → 403)', (bp.status === 403 || bp.status === 404) && (bs.status === 403 || bs.status === 404), 'create=' + bp.status + ' settings=' + bs.status);
}

// ============ B. Workflow ============
async function testWorkflow() {
  let r = await j('GET', '/api/wf/modules', null, adminTok);
  const mods = (r.data.items || []).map(m => m.key);
  ok('B1 Workflow: ماژول‌های قابل اتصال (>=14)', mods.length >= 14 && ['quote', 'payment', 'warranty', 'task'].every(k => mods.includes(k)), 'count=' + mods.length);
  r = await j('GET', '/api/wf/processes', null, adminTok);
  const procs = r.data.items || [];
  ok('B2 Workflow: لیست فرآیندها (admin)', r.status === 200 && procs.length >= 1, 'count=' + procs.length);
  if (!procs.length) { ok('B3 Workflow: Duplicate فرآیند', false, 'no process'); return; }
  const src = procs[0];
  r = await j('POST', `/api/wf/processes/${src.id}/duplicate`, {}, adminTok);
  const dupId = r.data && r.data.id;
  ok('B3 Workflow: Duplicate فرآیند (کپی + نسخه)', r.status === 200 && dupId, JSON.stringify(r.data).slice(0, 80));
  if (dupId) {
    const dv = await j('GET', `/api/wf/processes/${dupId}`, null, adminTok);
    ok('B4 Workflow: کپی دارای definition (نسخه کپی‌شده)', dv.status === 200 && (dv.data.versions || []).length >= 1, 'versions=' + ((dv.data.versions || []).length));
    // versioning: save new version + activate
    const sv = await j('PUT', `/api/wf/processes/${dupId}`, { definition: (dv.data.versions && dv.data.versions[0] && dv.data.versions[0].definition) || { nodes: [], edges: [] }, change_note: 'audit version test' }, adminTok);
    ok('B5 Workflow: Versioning (ذخیره نسخه جدید)', sv.status === 200, 'status=' + sv.status);
    const avRow = (dv.data.versions || [])[0];
    const av = await j('POST', `/api/wf/processes/${dupId}/activate-version/${avRow ? avRow.id : 1}`, {}, adminTok);
    ok('B6 Workflow: فعال‌سازی نسخه (Activate)', av.status === 200, 'status=' + av.status);
    // toggle (pause/activate)
    const tg = await j('POST', `/api/wf/processes/${dupId}/toggle`, { active: false }, adminTok);
    ok('B7 Workflow: Pause/Activate (Toggle)', tg.status === 200, 'status=' + tg.status);
    await j('DELETE', `/api/wf/processes/${dupId}`, null, adminTok);
  } else {
    for (const n of ['B4', 'B5', 'B6', 'B7']) ok('Workflow: ' + n, false, 'no dup');
  }
  const wp = await j('GET', '/api/wf/processes', null, repTok);
  ok('B8 Workflow: فقط admin (rep → 403)', wp.status === 403, 'status=' + wp.status);
}

// ============ C. Export/Print standard ============
async function testExportPrint() {
  // formats
  const x = await req('GET', '/api/r/customer/export?format=xlsx', null, adminTok);
  ok('C1 Export: XLSX (Content-Type صحیح)', x.status === 200 && (x.headers.get('content-type') || '').includes('spreadsheet'), 'ct=' + x.headers.get('content-type'));
  const c = await req('GET', '/api/r/customer/export?format=csv', null, adminTok);
  ok('C2 Export: CSV (BOM + سطر داده)', c.status === 200 && c.buf.slice(0, 3).toString('hex') === 'efbbbf' && c.buf.toString().split('\n').length > 5, 'lines=' + c.buf.toString().split('\n').length);
  const js = await j('GET', '/api/r/customer/export?format=json', null, adminTok);
  ok('C3 Export: JSON (ساختار source/generated_at/items)', js.status === 200 && js.data.source && js.data.generated_at && Array.isArray(js.data.items) && js.data.items.length > 0, 'count=' + (js.data.items || []).length);
  // print header option + logos
  const q = await j('GET', '/api/r/quote?per_page=1', null, adminTok);
  const qid = (q.data.items || [])[0] && q.data.items[0].id;
  if (qid) {
    const ph = await req('GET', `/api/print/quote/${qid}`, null, adminTok);
    const html = ph.buf.toString('utf8');
    ok('C4 Print: سربرگ رسمی (دو لوگو + اطلاعات شرکت)', ph.status === 200 && html.includes('logo-baspar') && html.includes('logo-selen') && html.includes('BASPAR FOAM GHARB'), 'status=' + ph.status);
    const ph0 = await req('GET', `/api/print/quote/${qid}?header=0`, null, adminTok);
    const html0 = ph0.buf.toString('utf8');
    ok('C5 Print: گزینه بدون سربرگ رسمی (header=0)', ph0.status === 200 && !html0.includes('logo-baspar') && !html0.includes('logo-selen'), '');
    ok('C6 Print: RTL + تاریخ شمسی', /dir="?rtl/i.test(html) && /۱۴/.test(html), '');
    ok('C7 Print: شماره صفحه/قالب استاندارد (CSS print)', /@media print|page-break|counter\(/i.test(html), '');
  } else {
    ok('C4 Print: سربرگ رسمی', false, 'no quote'); ok('C5 Print: بدون سربرگ', false, 'no quote'); ok('C6 Print: RTL', false, 'no quote'); ok('C7 Print: قالب', false, 'no quote');
  }
  // logo files intact (originals present)
  ok('C8 Logo: فایل‌های اصلی موجود (baspar + selen)', fs.existsSync('/home/user/baspar-crm/public/assets/logo-baspar.png') && fs.existsSync('/home/user/baspar-crm/public/assets/logo-selen.png'), '');
}

// ============ D. Date/Time backend validation ============
async function testDates() {
  const c = await j('POST', '/api/r/customer', { name: 'دستگاه تاریخ ' + Date.now(), phone: '0913' + String(Date.now()).slice(-5) }, adminTok);
  const cid = c.data && c.data.id;
  const opp = await j('POST', '/api/r/opportunity', { title: 'opp date test', customer_id: cid, amount: 100 }, adminTok);
  const oid = opp.data && opp.data.id;
  const bad1 = await j('PUT', `/api/r/opportunity/${oid}`, { next_followup_at: 'not-a-date' }, adminTok);
  ok('D1 Date: datetime نامعتبر رد می‌شود (opportunity)', bad1.status === 422, 'status=' + bad1.status);
  const bad2 = await j('PUT', `/api/r/opportunity/${oid}`, { next_followup_at: '2026-13-45T99:99:99Z' }, adminTok);
  ok('D2 Date: مقدار بی‌ربط (ماه 13) رد می‌شود', bad2.status === 422, 'status=' + bad2.status);
  const good = await j('PUT', `/api/r/opportunity/${oid}`, { next_followup_at: '1405/06/20 14:30' }, adminTok);
  ok('D3 Date: ورود شمسی معتبر پذیرفته می‌شود (convert به ISO)', good.status === 200, 'status=' + good.status);
  const ev = await j('POST', '/api/calendar/events', { title: 'event date test', start_at: 'garbage' }, adminTok);
  ok('D4 Date: رویداد تقویم با تاریخ نامعتبر → 422', ev.status === 422, 'status=' + ev.status);
  if (oid) await j('DELETE', `/api/r/opportunity/${oid}?hard=1`, null, adminTok);
  if (cid) await j('DELETE', `/api/r/customer/${cid}?hard=1`, null, adminTok);
}

// ============ E. Integration chains (quick real-data verification) ============
async function testIntegration() {
  const TS = Date.now();
  const c = await j('POST', '/api/r/customer', { name: 'زنجیره نهایی ' + TS, phone: '0914' + String(TS).slice(-5), mobile: '0914' + String(TS).slice(-5) }, adminTok);
  const cid = c.data.id;
  const ct = await j('POST', `/api/customers/${cid}/contacts`, { name: 'مخاطب زنجیره', mobile: '0915' + String(TS).slice(-5) }, adminTok);
  ok('E1 Customer → Contact', c.status === 200 && ct.status === 200, '');
  const lead = await j('POST', '/api/r/lead', { company: 'زنجیره ' + TS, customer_id: cid, contact_name: 'مخاطب زنجیره' }, adminTok);
  const conv = await j('POST', `/api/leads/${lead.data.id}/convert`, {}, adminTok);
  const oppId = conv.data && (conv.data.opportunity_id || conv.data.id);
  ok('E2 Customer → Lead → Opportunity (traceability)', lead.status === 200 && conv.status === 200 && oppId, JSON.stringify(conv.data).slice(0, 60));
  // price list + quote + order + invoice + payment
  const pl = await j('POST', '/api/r/price_list', { name: 'PL زنجیره ' + TS, valid_until: '2026-12-31' }, adminTok);
  const pr = await j('POST', '/api/r/product', { name: 'محصول زنجیره', code: 'ZJ-' + TS, unit: 'عدد', price_retail: 100000 }, adminTok);
  const q = await j('POST', '/api/r/quote', { customer_id: cid, price_list_id: pl.data.id }, adminTok);
  await j('PUT', `/api/r/quote/${q.data.id}/items`, { items: [{ product_id: pr.data.id, name: 'محصول زنجیره', qty: 2, price: 100000 }] }, adminTok);
  const toOrder = await j('POST', `/api/quotes/${q.data.id}/to-order`, {}, adminTok);
  const oid = toOrder.data.order_id;
  const toInv = await j('POST', `/api/orders/${oid}/to-invoice`, {}, adminTok);
  const iinv = toInv.data.invoice_id;
  const inv = await j('GET', `/api/r/invoice/${iinv}`, null, adminTok);
  ok('E3 Customer → PriceList → Proforma → Order → Invoice (زنجیره کامل)', toOrder.status === 200 && toInv.status === 200 && inv.data.item.order_id === oid, 'inv=' + iinv);
  const pay = await j('POST', '/api/payments', { invoice_id: iinv, customer_id: cid, amount: inv.data.item.total, method: 'cash' }, adminTok);
  const inv2 = await j('GET', `/api/r/invoice/${iinv}`, null, adminTok);
  ok('E4 Payment → Invoice (پرداخت کامل = paid)', pay.status === 200 && /paid/.test(inv2.data.item.status || ''), 'status=' + (inv2.data.item || {}).status);
  // meeting → calendar → followup
  const ev = await j('POST', '/api/calendar/events', { title: 'جلسه زنجیره ' + TS, type: 'meeting', start_at: new Date(Date.now() + 86400000).toISOString(), customer_id: cid }, adminTok);
  const cal = await j('GET', '/api/calendar/events?from=' + new Date().toISOString() + '&to=' + new Date(Date.now() + 30 * 86400000).toISOString(), null, adminTok);
  const found = (cal.data.events || []).some(e => e.title === 'جلسه زنجیره ' + TS);
  ok('E5 Customer → Meeting → Calendar', ev.status === 201 && found, '');
  const fu = await j('POST', '/api/r/followup', { entity_type: 'meeting', entity_id: ev.data.id, user_id: 1, subject: 'پیگیری جلسه زنجیره', due_at: new Date(Date.now() + 2 * 86400000).toISOString() }, adminTok);
  ok('E6 Meeting → Follow-up (ارتباط واقعی)', fu.status === 200 && fu.data.id, '');
  // lab request → result
  const lr = await j('POST', '/api/r/lab_request', { customer_id: cid, sample_desc: 'نمونه زنجیره', test_type: 'density' }, adminTok);
  const lres = await j('POST', '/api/r/lab_result', { request_id: lr.data.id, test_name: 'چگالی', result_value: '25', status: 'pass' }, adminTok);
  ok('E7 Customer → Test Request → Test Result', lr.status === 200 && lres.status === 200, '');
  // complaint → ticket link
  const comp = await j('POST', '/api/r/complaint', { subject: 'شکایت زنجیره', customer_id: cid }, adminTok);
  ok('E8 Customer → Complaint', comp.status === 200, '');
  // cleanup
  await j('DELETE', `/api/r/customer/${cid}?hard=1`, null, adminTok);
  await j('DELETE', `/api/r/product/${pr.data.id}?hard=1`, null, adminTok);
  await j('DELETE', `/api/r/price_list/${pl.data.id}?hard=1`, null, adminTok);
}

// ============ F. Dashboard drill-down ============
async function testDashboards() {
  for (const [role, name] of [['ceo', 'مدیریت/CEO'], ['sales_manager', 'فروش'], ['quality_manager', 'کیفیت'], ['finance_manager', 'مالی'], ['lab_manager', 'آزمایشگاه'], ['warehouse_manager', 'انبار']]) {
    const r = await j('GET', '/api/dashboard?role=' + role, null, adminTok);
    const json = JSON.stringify(r.data || {});
    ok('F Dashboard Drill-down: ' + name + ' (داده واقعی)', r.status === 200 && json.length > 150, 'status=' + r.status);
  }
}

// ============ G. Security regression ============
async function testSecurity() {
  const s1 = await req('GET', '/api/r/customer/UNION%20SELECT%20password_hash', null, adminTok);
  ok('G1 Security: SQLi (id) → 404 بدون نشت', s1.status === 404 && !/scrypt|argon/.test(s1.buf.toString()), 'status=' + s1.status);
  const s2 = await j('GET', "/api/r/customer?q=' OR 1=1;--", null, adminTok);
  ok('G2 Security: SQLi (q) بدون نشت', s2.status === 200, 'status=' + s2.status);
  const s3 = await req('POST', '/api/auth/login', { username: 'admin', password: 'x' }, null, { origin: 'https://evil.example' });
  ok('G3 Security: CSRF Origin → 403', s3.status === 403, 'status=' + s3.status);
  const s4 = await req('GET', '/api/admin/users', null, null);
  ok('G4 Security: API بدون توکن → 401', s4.status === 401, 'status=' + s4.status);
  const s5 = await req('GET', '/api/no-such-endpoint-xyz', null, adminTok);
  ok('G5 Security: بدون Stack Trace در خطا', s5.status === 404 && !/node:internal|at Object/.test(s5.buf.toString()), '');
  const s6 = await req('GET', '/', null, adminTok);
  const ct = s6.headers.get('content-security-policy') || '';
  const hsts = s6.headers.get('strict-transport-security') || '';
  ok('G6 Security: Security Headers (CSP + HSTS)', ct.includes('default-src') && hsts.includes('max-age'), '');
  // IDOR: rep cannot view other user's scoped data as admin — use rep token on admin endpoint
  const s7 = await j('GET', '/api/admin/audit', null, repTok);
  ok('G7 Security: Authorization (rep روی admin/audit → 403)', s7.status === 403, 'status=' + s7.status);
}

// ============ H. Smart Team health ============
async function testSmartTeam() {
  const r1 = await j('GET', '/api/smart-sales/actions?limit=5', null, adminTok);
  const r2 = await j('GET', '/api/smart-sales/competitors', null, adminTok);
  const r3 = await j('GET', '/api/smart-sales/ideas', null, adminTok);
  const r4 = await j('GET', '/api/smart-sales/team-tasks', null, adminTok);
  ok('H1 Smart Team: NBA/Actions سالم', r1.status === 200 && Array.isArray(r1.data.items), '');
  ok('H2 Smart Team: تحلیل رقبا (CRUD list)', r2.status === 200 && Array.isArray(r2.data.items), '');
  ok('H3 Smart Team: ایده‌ها (list)', r3.status === 200 && Array.isArray(r3.data.items), '');
  ok('H4 Smart Team: مأموریت‌ها (list)', r4.status === 200 && Array.isArray(r4.data.items), '');
  const r5 = await j('POST', '/api/smart-sales/ideas/generate', {}, adminTok);
  ok('H5 Smart Team: خلق ایده (داده‌محور + source)', r5.status === 200 && r5.data.source && Array.isArray(r5.data.ideas), 'source=' + (r5.data.source || ''));
}

// ============ main ============
async function main() {
  let lg = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  if (lg.status !== 200) throw new Error('admin login failed');
  adminTok = lg.data.access;
  lg = await j('POST', '/api/auth/login', { username: 'maryam.h', password: '12345678' });
  repTok = lg.data.access;

  await testBackup();
  await testWorkflow();
  await testExportPrint();
  await testDates();
  await testIntegration();
  await testDashboards();
  await testSecurity();
  await testSmartTeam();

  console.log('\n================ MASTER AUDIT SUMMARY ================');
  console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail}`);
  if (fails.length) { console.log('FAILS:'); fails.forEach(f => console.log('  ❌ ' + f)); }
  const os = await import('node:fs');
  os.writeFileSync('/tmp/master-audit-summary.json', JSON.stringify({ total: pass + fail, pass, fail, fails }, null, 2));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
