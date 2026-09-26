// Real E2E for the 7-item mission: Excel import (customer+contacts), geo structure,
// geo report, meeting edit, follow-up attempts, voice registration, RBAC.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const XLSX = require('xlsx');
const B = 'http://127.0.0.1:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; fails.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
const j = async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) });
const login = async (u, p) => (await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).access;
const H = (tok) => ({ Authorization: 'Bearer ' + tok });
const uploadFile = async (url, tok, buf, name) => {
  const fd = new FormData();
  fd.append('file', new File([buf], name, { type: 'application/octet-stream' }));
  const r = await fetch(B + url, { method: 'POST', headers: H(tok), body: fd });
  return j(r);
};
function xlsx(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

(async () => {
  const A = await login('admin', 'admin1234');
  const STAMP = String(Date.now()).slice(-6);
  const db = require('better-sqlite3')('/home/user/baspar-crm/data/baspar-crm.sqlite');

  // ================= 1) CUSTOMER EXCEL IMPORT =================
  console.log('== 1. customer Excel import ==');
  const custName = 'شرکت ورودی ' + STAMP;
  const rows = [
    ['نام', 'موبایل', 'تلفن', 'ایمیل', 'استان', 'شهر', 'شهرک صنعتی', 'نوع', 'وضعیت', 'صنعت'],
    [custName, '09' + STAMP + '345', '۲۳۸۹', 'imp' + STAMP + '@x.com', 'فارس', 'شیراز', 'شهرک نوین', 'company', 'active', 'فوم و اسفنج'],
    ['شرکت تست دو ' + STAMP, '0935' + STAMP.slice(0, 6), '', '', 'اصفهان', 'اصفهان', '', 'company', 'active', ''],
  ];
  let r = await uploadFile('/api/r/customer/import/parse', A, xlsx(rows), 'customers' + STAMP + '.xlsx');
  ok('C1 parse xlsx (format XLSX, 2 rows)', r.status === 200 && r.d.format === 'XLSX' && r.d.fileRowCount === 2, JSON.stringify(r.d).slice(0, 120));
  const tempId = r.d.tempId;
  // mapping: auto-suggested — force an explicit one by column position
  const header = r.d.header;
  const mapping = header.map((h, i) => ({ col: i, key: ({ 'نام': 'name', 'موبایل': 'mobile', 'تلفن': 'phone', 'ایمیل': 'email', 'استان': 'province', 'شهر': 'city', 'شهرک صنعتی': 'industrial_city', 'نوع': 'type', 'وضعیت': 'status', 'صنعت': 'industry' }[h]) || null }));
  r = await j(await fetch(B + '/api/r/customer/import/validate', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId, mapping }) }));
  ok('C2 validate: 2 valid, 0 dup, Persian digits handled', r.status === 200 && r.d.validCount === 2 && r.d.dupCount === 0 && r.d.errorCount === 0, JSON.stringify(r.d).slice(0, 160));
  r = await j(await fetch(B + '/api/r/customer/import/commit-mapped', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId, mapping, dupPolicy: 'skip' }) }));
  ok('C3 commit: 2 created (real DB rows)', r.status === 200 && r.d.ok === 2, JSON.stringify(r.d));
  const created = db.prepare('SELECT * FROM customers WHERE name LIKE ?').all('%' + STAMP + '%');
  ok('C4 rows persisted with geo + Latin-digit phones', created.length === 2 && /^09\d{9}$/.test(created[0].mobile || '') && created[0].province === 'فارس' && created[0].city === 'شیراز' && created[0].industrial_city === 'شهرک نوین', JSON.stringify(created.map(c => [c.name, c.mobile, c.province, c.city])));
  // re-import same mobiles → duplicates
  r = await uploadFile('/api/r/customer/import/parse', A, xlsx(rows), 'dup' + STAMP + '.xlsx');
  const t2 = r.d.tempId;
  r = await j(await fetch(B + '/api/r/customer/import/validate', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: t2, mapping }) }));
  ok('C5 duplicates detected on re-import (2 dup rows)', r.d.dupCount === 2 && r.d.dupRows.length === 2, JSON.stringify({ dup: r.d.dupCount, rows: r.d.dupRows }));
  // UPDATE policy: change phone of the first customer via file
  const upRows = [
    ['نام', 'موبایل', 'استان'],
    [custName, '0999' + STAMP.slice(0, 7), 'کرمان'],
  ];
  r = await uploadFile('/api/r/customer/import/parse', A, xlsx(upRows), 'up' + STAMP + '.xlsx');
  const t3 = r.d.tempId;
  const map3 = r.d.header.map((h, i) => ({ col: i, key: ({ 'نام': 'name', 'موبایل': 'mobile', 'استان': 'province' }[h]) || null }));
  r = await j(await fetch(B + '/api/r/customer/import/validate', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: t3, mapping: map3 }) }));
  ok('C6 validate for update: 1 dup', r.d.dupCount === 1, JSON.stringify({ dup: r.d.dupCount }));
  r = await j(await fetch(B + '/api/r/customer/import/commit-mapped', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: t3, mapping: map3, dupPolicy: 'update' }) }));
  ok('C7 update policy: 1 updated (no new row)', r.d.updated === 1 && r.d.ok === 0, JSON.stringify(r.d));
  const afterUp = db.prepare('SELECT * FROM customers WHERE name=?').get(custName);
  ok('C8 existing row refreshed (mobile+province), no overwrite of unmapped', afterUp.mobile === '0999' + STAMP.slice(0, 7) && afterUp.province === 'کرمان' && afterUp.city === 'شیراز', JSON.stringify({ m: afterUp.mobile, p: afterUp.province, c: afterUp.city }));
  // NEW policy: force-new duplicate
  r = await uploadFile('/api/r/customer/import/parse', A, xlsx(upRows), 'new' + STAMP + '.xlsx');
  const t4 = r.d.tempId;
  await j(await fetch(B + '/api/r/customer/import/validate', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: t4, mapping: map3 }) }));
  r = await j(await fetch(B + '/api/r/customer/import/commit-mapped', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: t4, mapping: map3, dupPolicy: 'new' }) }));
  ok('C9 new policy: forced new duplicate row', r.d.ok === 1, JSON.stringify(r.d));
  // error row (no name) → errorCount
  r = await uploadFile('/api/r/customer/import/parse', A, xlsx([['نام', 'موبایل'], ['', '09120000000']]), 'err' + STAMP + '.xlsx');
  const t5 = r.d.tempId;
  r = await j(await fetch(B + '/api/r/customer/import/validate', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: t5, mapping: r.d.header.map((h, i) => ({ col: i, key: h === 'نام' ? 'name' : h === 'موبایل' ? 'mobile' : null })) }) }));
  ok('C10 validation error reported (empty name)', r.d.errorCount === 1, JSON.stringify(r.d.errors));

  // ================= 2) CONTACTS IMPORT =================
  console.log('== 2. contacts Excel import ==');
  const cust1 = db.prepare('SELECT * FROM customers WHERE name=?').get(custName);
  const ctRows = [
    ['نام', 'سمت', 'موبایل', 'تلفن', 'ایمیل', 'استان', 'شهر', 'شهرک صنعتی', 'مخاطب اصلی'],
    ['امیر رضایی', 'مدیر خرید', '0912' + STAMP.slice(0, 7), '0711' + STAMP.slice(0, 7), 'amir' + STAMP + '@x.com', 'فارس', 'شیراز', 'شهرک نوین', 'بله'],
    ['لیلا محمدی', 'حسابدار', '0935' + STAMP.slice(0, 7), '', 'leila' + STAMP + '@x.com', '', '', '', ''],
  ];
  r = await uploadFile('/api/contacts/import/parse?customer_id=' + cust1.id, A, xlsx(ctRows), 'contacts' + STAMP + '.xlsx');
  ok('K1 contacts parse for target customer', r.status === 200 && r.d.fileRowCount === 2 && r.d.customer.id === cust1.id, JSON.stringify(r.d).slice(0, 140));
  const kt = r.d.tempId;
  const kmap = r.d.header.map((h, i) => ({ col: i, key: ({ 'نام': 'name', 'سمت': 'position', 'موبایل': 'mobile', 'تلفن': 'phone', 'ایمیل': 'email', 'استان': 'province', 'شهر': 'city', 'شهرک صنعتی': 'industrial_city', 'مخاطب اصلی': 'is_primary' }[h]) || null }));
  r = await j(await fetch(B + '/api/contacts/import/validate', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: kt, mapping: kmap }) }));
  ok('K2 contacts validate: 2 valid 0 dup', r.d.validCount === 2 && r.d.dupCount === 0, JSON.stringify(r.d).slice(0, 120));
  r = await j(await fetch(B + '/api/contacts/import/commit', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: kt, mapping: kmap, dupPolicy: 'skip' }) }));
  ok('K3 contacts committed (real rows)', r.d.ok === 2, JSON.stringify(r.d));
  const cts = db.prepare('SELECT * FROM customer_contacts WHERE customer_id=?').all(cust1.id);
  ok('K4 contact rows persisted with geo + primary flag', cts.length === 2 && cts.some(c => c.name === 'امیر رضایی' && c.province === 'فارس' && c.industrial_city === 'شهرک نوین' && c.is_primary === 1), JSON.stringify(cts.map(c => [c.name, c.province, c.is_primary])));
  // dup: re-import same contact with updated email → update policy
  const ctRows2 = [['نام', 'موبایل', 'ایمیل'], ['امیر رضایی', '0912' + STAMP.slice(0, 7), 'amir2' + STAMP + '@x.com']];
  r = await uploadFile('/api/contacts/import/parse?customer_id=' + cust1.id, A, xlsx(ctRows2), 'ctup' + STAMP + '.xlsx');
  const kt2 = r.d.tempId;
  const kmap2 = r.d.header.map((h, i) => ({ col: i, key: ({ 'نام': 'name', 'موبایل': 'mobile', 'ایمیل': 'email' }[h]) || null }));
  r = await j(await fetch(B + '/api/contacts/import/validate', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: kt2, mapping: kmap2 }) }));
  ok('K5 contact dup detected', r.d.dupCount === 1, JSON.stringify({ dup: r.d.dupCount }));
  r = await j(await fetch(B + '/api/contacts/import/commit', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ tempId: kt2, mapping: kmap2, dupPolicy: 'update' }) }));
  ok('K6 contact updated via import', r.d.updated === 1, JSON.stringify(r.d));
  ok('K7 contact email really changed in DB', db.prepare('SELECT email FROM customer_contacts WHERE customer_id=? AND name=?').get(cust1.id, 'امیر رضایی').email === 'amir2' + STAMP + '@x.com');

  // ================= 3) GEO STRUCTURE =================
  console.log('== 3. geo structure ==');
  db.prepare("DELETE FROM industrial_cities WHERE name IN ('شهرک صنعتی نوین شیراز', 'شهرک تست ساپورت')").run();
  r = await j(await fetch(B + '/api/industrial-cities?city=شیراز', { headers: H(A) }));
  ok('G1 list industrial cities (empty at first)', r.status === 200 && Array.isArray(r.d.items) && r.d.items.length === 0, JSON.stringify(r.d).slice(0, 80));
  r = await j(await fetch(B + '/api/industrial-cities', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'شهرک صنعتی نوین شیراز', province: 'فارس', city: 'شیراز' }) }));
  ok('G2 create industrial city (real DB)', r.status === 200 && r.d.id > 0, JSON.stringify(r.d));
  const icId = r.d.id;
  r = await j(await fetch(B + '/api/industrial-cities?city=شیراز', { headers: H(A) }));
  ok('G3 city-filtered list returns it', r.d.items.length === 1 && r.d.items[0].name === 'شهرک صنعتی نوین شیراز');
  r = await j(await fetch(B + '/api/industrial-cities', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'شهرک صنعتی نوین شیراز', province: 'فارس', city: 'شیراز' }) }));
  ok('G4 duplicate industrial city → 409', r.status === 409, r.status);
  // customer with geo via API (edit)
  const geoCustName = 'شرکت جغرافیایی ' + STAMP;
  r = await j(await fetch(B + '/api/r/customer', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: geoCustName, type: 'company', province: 'خراسان رضوی', city: 'مشهد', industrial_city: 'شهرک صنعتی وصال', mobile: '0914' + STAMP.slice(0, 7) }) }));
  ok('G5 customer created with geo fields', r.status === 200 && r.d.id > 0, JSON.stringify(r.d).slice(0, 80));
  const geoCustId = r.d.id;
  const geoRow = db.prepare('SELECT province, city, industrial_city FROM customers WHERE id=?').get(geoCustId);
  ok('G6 geo persisted', geoRow.province === 'خراسان رضوی' && geoRow.city === 'مشهد' && geoRow.industrial_city === 'شهرک صنعتی وصال', JSON.stringify(geoRow));
  // edit changes geo
  r = await j(await fetch(B + '/api/r/customer/' + geoCustId, { method: 'PUT', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ province: 'مازندران', city: 'ساری' }) }));
  const geoRow2 = db.prepare('SELECT province, city FROM customers WHERE id=?').get(geoCustId);
  ok('G7 geo editable (update persisted)', r.status === 200 && geoRow2.province === 'مازندران' && geoRow2.city === 'ساری', JSON.stringify(geoRow2));
  // contact geo via API
  r = await j(await fetch(B + '/api/customers/' + cust1.id + '/contacts', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'مخاطب جغرافیایی', mobile: '0913' + STAMP.slice(0, 7), province: 'فارس', city: 'مرودشت', industrial_city: 'شهرک مرودشت' }) }));
  ok('G8 contact created with geo via API', r.status === 200 && r.d.id > 0, JSON.stringify(r.d).slice(0, 60));
  const ctGeo = db.prepare('SELECT province, city, industrial_city FROM customer_contacts WHERE id=?').get(r.d.id);
  ok('G9 contact geo persisted', ctGeo.province === 'فارس' && ctGeo.city === 'مرودشت' && ctGeo.industrial_city === 'شهرک مرودشت', JSON.stringify(ctGeo));

  // ================= 4) GEO REPORT =================
  console.log('== 4. geography report ==');
  r = await j(await fetch(B + '/api/salesreports/customer_geography?province=' + encodeURIComponent('کرمان'), { headers: H(A) }));
  ok('R1 geography report runs (province filter)', r.status === 200 && Array.isArray(r.d.rows) && r.d.rows.length >= 1 && r.d.rows.every(x => x.province === 'کرمان'), JSON.stringify(r.d.rows).slice(0, 140));
  r = await j(await fetch(B + '/api/salesreports/customer_geography?city=شیراز', { headers: H(A) }));
  ok('R2 city filter (Shiraz)', r.d.rows.some(x => x.city === 'شیراز') && r.d.rows.every(x => x.city === 'شیراز'), JSON.stringify(r.d.rows.map(x => x.city)));
  r = await j(await fetch(B + '/api/salesreports/customer_geography?industrial_city=شهرک+نوین', { headers: H(A) }));
  ok('R3 industrial-city filter', r.d.rows.length >= 1 && r.d.rows.every(x => x.industrial_city === 'شهرک نوین'), JSON.stringify(r.d.rows.map(x => x.industrial_city)));
  r = await j(await fetch(B + '/api/salesreports/customer_geography?ctype=company&status=active', { headers: H(A) }));
  ok('R4 type+status filters', r.d.rows.every(x => x.type === 'شرکت' && x.status === 'active'), JSON.stringify(r.d.rows.map(x => [x.type, x.status])));
  const exp = await fetch(B + '/api/salesreports/customer_geography/export?format=xlsx&province=' + encodeURIComponent('کرمان'), { headers: H(A) });
  const expBuf = Buffer.from(await exp.arrayBuffer());
  ok('R5 Excel export is a real XLSX file', exp.status === 200 && expBuf.slice(0, 2).toString() === 'PK', 'bytes=' + expBuf.length);
  const expH = await fetch(B + '/api/salesreports/customer_geography/export?format=html&province=' + encodeURIComponent('کرمان'), { headers: H(A) });
  ok('R6 HTML/print export', expH.status === 200 && (await expH.text()).includes('شهرک'), '');
  ok('R7 summary geo facets present', r.d.summary && Array.isArray(r.d.summary.geo && r.d.summary.geo.industrial_cities), JSON.stringify(r.d.summary && r.d.summary.geo));

  // ================= 5) MEETING EDIT =================
  console.log('== 5. meeting create → edit → reload ==');
  r = await j(await fetch(B + '/api/meetings', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'جلسه تست ویرایش ' + STAMP, customer_id: geoCustId, start_at: '2026-09-20T10:00:00.000Z', location: 'تبریز', status: 'scheduled', meeting_type: 'customer', mode: 'inperson' }) }));
  ok('M1 meeting created', r.status === 201 && r.d.id > 0, JSON.stringify(r.d));
  const mId = r.d.id;
  r = await j(await fetch(B + '/api/meetings/' + mId, { method: 'PUT', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'جلسه ویرایش‌شده ' + STAMP, customer_id: geoCustId, start_at: '2026-09-21T12:30:00.000Z', location: 'تهران', status: 'done', meeting_type: 'customer', mode: 'online', online_url: 'https://meet.example.com/x' }) }));
  ok('M2 meeting updated via API', r.status === 200 && r.d.ok === true, JSON.stringify(r.d));
  r = await j(await fetch(B + '/api/r/meeting/' + mId, { headers: H(A) }));
  const mv = r.d.item;
  ok('M3 edit persisted (title/dates/location/status/online)', mv.title === 'جلسه ویرایش‌شده ' + STAMP && mv.location === 'تهران' && mv.status === 'done' && mv.mode === 'online' && mv.online_url === 'https://meet.example.com/x' && String(mv.start_at).startsWith('2026-09-21T12:30'), JSON.stringify({ t: mv.title, l: mv.location, s: mv.status, o: mv.online_url, st: mv.start_at }));
  r = await j(await fetch(B + '/api/meetings/' + mId, { method: 'PUT', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '', customer_id: geoCustId, start_at: '2026-09-21T12:30:00.000Z', status: 'done' }) }));
  ok('M4 validation: empty title rejected', r.status >= 400, r.status);

  // ================= 6) FOLLOW-UP ATTEMPTS =================
  console.log('== 6. multi follow-up attempts ==');
  r = await j(await fetch(B + '/api/r/followup', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_type: 'customer', entity_id: geoCustId, subject: 'پیگیری خرید تشک ' + STAMP, due_at: '2026-09-25T09:00:00.000Z', user_id: 3, status: 'pending' }) }));
  ok('F1 follow-up created (parent)', r.status === 200 && r.d.id > 0, JSON.stringify(r.d).slice(0, 80));
  const fId = r.d.id;
  const attempts = [
    { method: 'call', result: 'تماس شد — هنوز تصمیم نگرفته', acted_at: '2026-09-15T09:00:00.000Z', next_followup_at: '2026-09-18T09:00:00.000Z' },
    { method: 'meeting', result: 'جلسه شد — درخواست قیمت جدید', acted_at: '2026-09-18T10:00:00.000Z', note: 'قیمت تازه لازم دارد', next_followup_at: '2026-09-21T09:00:00.000Z' },
    { method: 'call', result: 'هنوز باز — پیگیری ادامه دارد', acted_at: '2026-09-21T09:30:00.000Z', next_followup_at: '2026-09-24T09:00:00.000Z' },
  ];
  for (const a of attempts) {
    r = await j(await fetch(B + '/api/followups/' + fId + '/attempts', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify(a) }));
    if (r.status !== 200) { ok('F2 add attempt', false, JSON.stringify(r.d)); break; }
  }
  ok('F2 three attempts added', true);
  r = await j(await fetch(B + '/api/followups/' + fId + '/attempts', { headers: H(A) }));
  ok('F3 full history returned (order kept, nothing deleted)', r.d.items.length === 3 && r.d.items[0].result.includes('تصمیم نگرفته') && r.d.items[2].result.includes('ادامه دارد'), JSON.stringify(r.d.items.map(x => x.result)));
  const par = db.prepare('SELECT status FROM followups WHERE id=?').get(fId);
  ok('F4 parent auto-moved to in_progress (stays open until final)', par.status === 'in_progress', par.status);
  // no delete endpoint exists (history is immutable)
  const delR = await fetch(B + '/api/followups/' + fId + '/attempts/1', { method: 'DELETE', headers: H(A) });
  ok('F5 no attempt-delete endpoint (immutable history)', delR.status === 404 || delR.status === 405, delR.status);
  // reminder visible in calendar
  r = await j(await fetch(B + '/api/calendar/events?from=2026-09-18T00:00:00.000Z&to=2026-09-22T00:00:00.000Z', { headers: H(A) }));
  const calEvents = (r.d.events || []).filter(e => String(e.id).startsWith('fa-'));
  ok('F6 attempt reminder appears in Calendar', calEvents.length >= 2 && calEvents.every(e => e.title.includes('پیگیری بعدی')), JSON.stringify(calEvents.map(e => [e.id, e.title, e.start])));
  // final status
  r = await j(await fetch(B + '/api/followups/' + fId + '/status', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }));
  ok('F7 final status set (completed)', r.status === 200 && db.prepare('SELECT status, done_at FROM followups WHERE id=?').get(fId).status === 'done', JSON.stringify(r.d));
  // customer-level report: followups of this customer with attempts
  r = await j(await fetch(B + '/api/r/followup?per_page=100', { headers: H(A) }));
  const cFu = (r.d.items || []).find(x => x.entity_type === 'customer' && Number(x.entity_id) === geoCustId);
  ok('F8 customer follow-up listable (history viewable per customer)', !!cFu, JSON.stringify(cFu && cFu.subject));

  // ================= 7) VOICE REGISTRATION =================
  console.log('== 7. voice customer registration ==');
  const transcript = 'سلام، نام من محمدرضا دهفولی هست، شماره تماس ۰۹۲۳۴۵۶۷۸۹۹ هست، شهرک صنعتی طبس، شهر طبس، استان خراسان جنوبی، در صنعت اسفنج فعالیت می‌کنم.';
  r = await j(await fetch(B + '/api/voice/parse', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: transcript }) }));
  ok('V1 parse: name extracted', r.d.name === 'محمدرضا دهفولی', JSON.stringify(r.d));
  ok('V2 parse: mobile (Persian digits → Latin)', r.d.mobile === '09234567899', 'mobile=' + r.d.mobile);
  ok('V3 parse: industry/city/industrial/province', r.d.industry === 'اسفنج' && r.d.city === 'طبس' && r.d.industrial_city === 'طبس' && r.d.province === 'خراسان جنوبی', JSON.stringify({ i: r.d.industry, c: r.d.city, ic: r.d.industrial_city, p: r.d.province }));
  // final save (exactly what the UI does)
  const voiceName = 'محمدرضا دهفولی' + STAMP;
  const indOpts = ['فوم و اسفنج', 'تولید تشک', 'بسته‌بندی', 'مبلمان', 'بهداشتی', 'صنایع شیمیایی', 'تأمین‌کننده', 'صادرات', 'سایر'];
  const mappedInd = indOpts.includes(r.d.industry) ? r.d.industry : (indOpts.find(o => o.includes(r.d.industry)) || null);
  r = await j(await fetch(B + '/api/r/customer', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: voiceName, type: 'person', mobile: r.d.mobile, industry: mappedInd, province: r.d.province, city: r.d.city, industrial_city: r.d.industrial_city, source: 'Voice Assistant', status: 'active', notes: 'گفتار: ' + transcript + ' — صنعت گفتاری: ' + r.d.industry }) }));
  ok('V4 real customer saved from voice flow', r.status === 200 && r.d.id > 0, JSON.stringify(r.d).slice(0, 80));
  const vRow = db.prepare('SELECT source, status, mobile, province, industry FROM customers WHERE id=?').get(r.d.id);
  ok('V5 source=Voice Assistant + geo + mobile + mapped industry persisted', vRow.source === 'Voice Assistant' && vRow.mobile === '09234567899' && vRow.province === 'خراسان جنوبی' && vRow.industry === 'فوم و اسفنج', JSON.stringify(vRow));
  // incomplete info → initial (lead) status, still creatable
  const t2p = 'من علی تاجر هستم.';
  r = await j(await fetch(B + '/api/voice/parse', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t2p }) }));
  ok('V6 incomplete transcript: complete=false', r.d.complete === false && r.d.name === 'علی تاجر', JSON.stringify({ name: r.d.name, complete: r.d.complete }));
  r = await j(await fetch(B + '/api/r/customer', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'علی تاجر' + STAMP, type: 'person', status: 'lead', source: 'Voice Assistant' }) }));
  ok('V7 incomplete → status=lead (initial, completable later)', r.status === 200 && db.prepare('SELECT status FROM customers WHERE id=?').get(r.d.id).status === 'lead', JSON.stringify(r.d));

  // ================= 8) RBAC / SECURITY =================
  console.log('== 8. RBAC ==');
  const LAB = await login('saeid.t', '12345678'); // lab: customer view only
  r = await uploadFile('/api/r/customer/import/parse', LAB, xlsx(rows), 'sec' + STAMP + '.xlsx');
  ok('S1 lab user cannot import customers (403)', r.status === 403, r.status);
  r = await j(await fetch(B + '/api/industrial-cities', { method: 'POST', headers: { ...H(LAB), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'شهرک غیرمجاز', province: 'قم', city: 'قم' }) }));
  ok('S2 lab user cannot create industrial city (403)', r.status === 403, r.status);
  const SUP = await login('maryam.h', '12345678'); // support: has industrial_city:create grant
  r = await j(await fetch(B + '/api/industrial-cities', { method: 'POST', headers: { ...H(SUP), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'شهرک تست ساپورت', province: 'قم', city: 'قم' }) }));
  ok('S3 granted role can create industrial city', r.status === 200 && r.d.id > 0, r.status);
  const supIc = r.d.id;
  // voice parse is available to any authenticated user (read-only analysis)
  r = await j(await fetch(B + '/api/voice/parse', { method: 'POST', headers: { ...H(LAB), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'نام من تست امنیتی هست' }) }));
  ok('S4 voice parse works for any logged-in user (analysis only)', r.status === 200 && r.d.name === 'تست امنیتی', r.status);
  // unauthenticated
  const an = await fetch(B + '/api/industrial-cities');
  ok('S5 unauthenticated → 401', an.status === 401, an.status);

  // ================= cleanup =================
  console.log('== cleanup ==');
  db.prepare("UPDATE wf_instances SET status='terminated', current_node_id=NULL WHERE module='customer' AND entity_id IN (SELECT id FROM customers WHERE name LIKE ?)").run('%' + STAMP + '%');
  db.prepare('DELETE FROM followup_attempts WHERE followup_id=?').run(fId);
  db.prepare('DELETE FROM followups WHERE id=?').run(fId);
  db.prepare('DELETE FROM meetings WHERE id=?').run(mId);
  db.prepare('DELETE FROM customer_contacts WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)').run('%' + STAMP + '%');
  db.prepare("DELETE FROM industrial_cities WHERE id=? OR name='شهرک تست ساپورت'").run(icId);
  db.prepare('DELETE FROM activities WHERE entity_id IN (SELECT id FROM customers WHERE name LIKE ?)').run('%' + STAMP + '%');
  db.prepare('DELETE FROM customers WHERE name LIKE ?').run('%' + STAMP + '%');
  const left = db.prepare('SELECT COUNT(*) c FROM customers WHERE name LIKE ?').get('%' + STAMP + '%').c;
  ok('cleanup complete', left === 0, 'left=' + left);
  db.close();

  console.log('');
  console.log('=====================================');
  console.log(`MISSION7 E2E: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
