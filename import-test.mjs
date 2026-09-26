// Multi-format import E2E: XLS / XLSX / CSV / JSON / XML / TXT with mapping,
// validation, duplicate detection, error reporting and commit to the REAL DB.
// Each section uses its own unique phone numbers (so duplicates are deterministic).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra ? ':: ' + extra : ''); }
};
async function api(method, path, body, tok, isForm = false) {
  const h = {};
  if (!isForm) h['Content-Type'] = 'application/json';
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: isForm ? body : (body === undefined ? undefined : JSON.stringify(body)) });
  let d = null; const t = await r.text();
  try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
}
const db = require('better-sqlite3')('data/baspar-crm.sqlite');
const XLSX = require('xlsx');
const RUN = Date.now().toString().slice(-5);
const HEAD = ['name', 'phone', 'mobile', 'city', 'province', 'type'];
const created = [];

function rowsFor(p1, p2, dupPhone, tag) {
  // row 3 = INVALID (bad province select value), row 4 = DUPLICATE (existing phone)
  return [
    { name: 'شرکت تستی یک ' + tag + RUN, phone: p1, mobile: '', city: 'کرج', province: 'البرز', type: 'company' },
    { name: 'شرکت تستی دو ' + tag + RUN, phone: p2, mobile: '0915' + tag + RUN, city: 'تهران', province: 'تهران', type: 'person' },
    { name: 'شرکت تستی سه ' + tag + RUN, phone: '0916' + RUN, mobile: '', city: 'سایپا', province: 'XXX-نامعتبر', type: 'company' },
    { name: 'مشتری تکراری ' + tag + RUN, phone: dupPhone, mobile: '', city: 'سایپا', province: 'مرکزی', type: 'company' },
  ];
}
function bufFor(fmt, rows) {
  if (fmt === 'csv') return Buffer.from('\uFEFF' + [HEAD.join(','), ...rows.map(r => HEAD.map(h => '"' + r[h] + '"').join(','))].join('\n'), 'utf8');
  if (fmt === 'json') return Buffer.from(JSON.stringify(rows), 'utf8');
  if (fmt === 'xml') {
    const recs = rows.map(r => '<record>' + HEAD.map(h => '<' + h + '>' + r[h] + '</' + h + '>').join('') + '</record>').join('');
    return Buffer.from('<?xml version="1.0" encoding="UTF-8"?><customers>' + recs + '</customers>', 'utf8');
  }
  if (fmt === 'txt') return Buffer.from([HEAD.join('\t'), ...rows.map(r => HEAD.map(h => r[h]).join('\t'))].join('\n'), 'utf8');
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows.map(r => HEAD.map(h => r[h]))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: fmt });
}
async function parseFile(A, fmt, fileName, rows) {
  const fd = new FormData();
  fd.append('file', new Blob([bufFor(fmt, rows)], { type: 'application/octet-stream' }), fileName);
  return api('POST', '/api/r/customer/import/parse', fd, A, true);
}
const mapFrom = (parsed) => (parsed.header || []).map((h, i) => ({ col: i, key: HEAD.includes(h) ? h : null }));
async function validateCommit(A, parsed, mapping) {
  const v = await api('POST', '/api/r/customer/import/validate', { tempId: parsed.tempId, mapping }, A);
  const c = await api('POST', '/api/r/customer/import/commit-mapped', { tempId: parsed.tempId, mapping }, A);
  return { v, c };
}

(async () => {
  // safety: remove garbage from any prior failed runs (very short names, recent)
  {
    const NL = String.fromCharCode(10);
    db.prepare('DELETE FROM customers WHERE name LIKE ? AND created_at > datetime(?,?)').run('%' + NL + '%', 'now', '-3 day');
    db.prepare('DELETE FROM customers WHERE length(name) <= 3 AND created_at > datetime(?,?)').run('now', '-3 day');
    db.prepare('DELETE FROM customers WHERE name LIKE ? OR phone LIKE ?').run('%' + RUN + '%', '09%' + RUN);
  }

  const r0 = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = r0.d.access;
  if (!A) { console.log('LOGIN FAILED'); process.exit(2); }

  // existing customer used as the "duplicate" target in every section
  const dupPhone = '0914' + RUN;
  const dupCust = db.prepare(`INSERT INTO customers (name, phone, mobile, type, status, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`)
    .run('مشتری تکراری ' + RUN, dupPhone, null, 'company', 'active', new Date().toISOString(), new Date().toISOString());
  const dupId = Number(dupCust.lastInsertRowid);

  console.log('== 1. All six formats parse correctly ==');
  const parsed = {};
  for (const fmt of ['xlsx', 'xls', 'csv', 'json', 'xml', 'txt']) {
    const r = await parseFile(A, fmt, 'test.' + fmt, rowsFor('0981' + RUN, '0982' + RUN, dupPhone, fmt));
    parsed[fmt] = r;
    ok(fmt + ': parse OK (header 6 + 4 rows + suggested mapping)',
      r.s === 200 && r.d.tempId && (r.d.header || []).length === 6 && r.d.rowCount === 4 && (r.d.suggested || []).length >= 3,
      JSON.stringify(r.d).slice(0, 140));
    const sug = (r.d.suggested || []);
    ok(fmt + ': auto-suggestion detects name & phone columns', sug.some(x => x.key === 'name') && sug.some(x => x.key === 'phone'), JSON.stringify(sug).slice(0, 140));
  }

  console.log('== 2. Mapping + validation + duplicates + errors (CSV, fresh numbers) ==');
  const P1a = '0931' + RUN, P2a = '0932' + RUN;
  const P = (await parseFile(A, 'csv', 's2.csv', rowsFor(P1a, P2a, dupPhone, 'cs'))).d;
  const mapping = mapFrom(P);
  let r = await api('POST', '/api/r/customer/import/validate', { tempId: P.tempId, mapping }, A);
  ok('validate: 3 valid (incl. 1 duplicate), 1 error (invalid province)', r.s === 200 && r.d.validCount === 3 && r.d.errorCount === 1 && r.d.dupCount === 1, JSON.stringify({ v: r.d.validCount, e: r.d.errorCount, d: r.d.dupCount }).slice(0, 120));
  ok('validate: error reported with row number + message', (r.d.errors || []).length === 1 && r.d.errors[0].row === 4 && r.d.errors[0].errors.join(' ').includes('استان'), JSON.stringify(r.d.errors).slice(0, 160));
  ok('validate: preview returns mapped fields', (r.d.preview || []).length === 3 && r.d.preview.some(p => p.phone === P1a) && r.d.preview.some(p => p.phone === P2a), JSON.stringify(r.d.preview).slice(0, 160));

  console.log('== 3. Commit to REAL DB (CSV) ==');
  r = await api('POST', '/api/r/customer/import/commit-mapped', { tempId: P.tempId, mapping }, A);
  ok('commit: 2 ok, 1 dup, 0 fail', r.s === 200 && r.d.ok === 2 && r.d.dup === 1 && r.d.fail === 0, JSON.stringify(r.d));
  const c1 = db.prepare('SELECT * FROM customers WHERE phone=?').get(P1a);
  const c2 = db.prepare('SELECT * FROM customers WHERE phone=?').get(P2a);
  ok('DB: customer 1 created with mapped values', !!c1 && c1.name.includes('شرکت تستی یک') && c1.city === 'کرج' && c1.province === 'البرز' && c1.type === 'company', JSON.stringify(c1 || {}).slice(0, 160));
  ok('DB: customer 2 created (person + mobile)', !!c2 && c2.type === 'person' && c2.mobile === '0915cs' + RUN, JSON.stringify(c2 || {}).slice(0, 140));
  if (c1) created.push(c1.id);
  if (c2) created.push(c2.id);
  r = await api('POST', '/api/r/customer/import/commit-mapped', { tempId: P.tempId, mapping }, A);
  ok('commit: tempId single-use (expired after commit)', r.s === 400 && r.d.error && r.d.error.code === 'IMPORT_EXPIRED', JSON.stringify(r.d).slice(0, 120));

  console.log('== 4. XLSX full flow with user REMAPPED columns (fresh numbers) ==');
  {
    const P1x = '0941' + RUN, P2x = '0942' + RUN;
    const PX = (await parseFile(A, 'xlsx', 's4.xlsx', rowsFor(P1x, P2x, dupPhone, 'xl'))).d;
    const phI = PX.header.indexOf('phone'), moI = PX.header.indexOf('mobile');
    const mapX = mapFrom(PX);
    const tmp = mapX[phI].key; mapX[phI].key = mapX[moI].key; mapX[moI].key = tmp; // swap phone<->mobile
    const { v, c } = await validateCommit(A, PX, mapX);
    ok('xlsx validate: swapped mapping accepted (3 valid, 1 error, 0 dup after swap)', v.s === 200 && v.d.validCount === 3 && v.d.errorCount === 1 && v.d.dupCount === 0, JSON.stringify(v.d).slice(0, 140));
    ok('xlsx commit: 3 ok (all committed under remapped columns), 0 fail', c.s === 200 && c.d.ok === 3 && c.d.dup === 0 && c.d.fail === 0, JSON.stringify(c.d));
    const x1 = db.prepare('SELECT * FROM customers WHERE mobile=?').get(P1x);
    ok('xlsx DB: remapped phone stored into mobile column', !!x1 && x1.name.includes('شرکت تستی یک'), JSON.stringify(x1 || {}).slice(0, 140));
    // collect ALL customers created in this section (columns were swapped, so locate by name tag)
    for (const row of db.prepare(`SELECT id FROM customers WHERE name LIKE ?`).all('%xl' + RUN)) created.push(row.id);
  }

  console.log('== 5. JSON / XML / TXT / XLS commit flows (fresh numbers each) ==');
  for (const [i, fmt] of ['json', 'xml', 'txt', 'xls'].entries()) {
    const p1 = '095' + i + '1' + RUN, p2 = '095' + i + '2' + RUN;
    const PF = (await parseFile(A, fmt, 's5.' + fmt, rowsFor(p1, p2, dupPhone, fmt))).d;
    const map = mapFrom(PF);
    const { v, c } = await validateCommit(A, PF, map);
    ok(fmt + ' validate: 3 valid, 1 error, 1 dup', v.s === 200 && v.d.validCount === 3 && v.d.errorCount === 1 && v.d.dupCount === 1, JSON.stringify(v.d).slice(0, 140));
    ok(fmt + ' commit: 2 ok, 1 dup, 0 fail', c.s === 200 && c.d.ok === 2 && c.d.dup === 1 && c.d.fail === 0, JSON.stringify(c.d));
    for (const ph of [p1, p2]) { const cc = db.prepare('SELECT * FROM customers WHERE phone=?').get(ph); if (cc) created.push(cc.id); }
  }

  console.log('== 6. Unsupported format rejected ==');
  {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('fake')], { type: 'application/octet-stream' }), 'file.doc');
    const rr = await api('POST', '/api/r/customer/import/parse', fd, A, true);
    ok('unsupported .doc → 400 IMPORT_FORMAT', rr.s === 400 && rr.d.error && rr.d.error.code === 'IMPORT_FORMAT', JSON.stringify(rr.d).slice(0, 120));
  }

  console.log('== 7. Legacy import endpoint still works (backwards compatible) ==');
  {
    const L1 = '0961' + RUN, L2 = '0962' + RUN;
    const csv = [HEAD.join(','), ...rowsFor(L1, L2, dupPhone, 'lg').map(r => HEAD.map(h => '"' + r[h] + '"').join(','))].join('\n');
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('\uFEFF' + csv, 'utf8')], { type: 'text/csv' }), 'legacy.csv');
    const rr = await api('POST', '/api/r/customer/import', fd, A, true);
    ok('legacy /import preview works (3 valid incl. dup, 1 error)', rr.s === 200 && rr.d.validCount === 3 && rr.d.errorCount === 1, JSON.stringify(rr.d).slice(0, 140));
    const rr2 = await api('POST', '/api/r/customer/import/commit', { tempId: rr.d.tempId }, A);
    ok('legacy commit works (2 ok, 1 dup)', rr2.s === 200 && rr2.d.ok === 2 && rr2.d.duplicates === 1, JSON.stringify(rr2.d || rr2));
    for (const ph of [L1, L2]) { const cc = db.prepare('SELECT * FROM customers WHERE phone=?').get(ph); if (cc) created.push(cc.id); }
  }

  console.log('== 8. Cleanup ==');
  for (const id of [...new Set(created)]) db.prepare('DELETE FROM customers WHERE id=?').run(id);
  db.prepare('DELETE FROM customers WHERE id=?').run(dupId);
  const left = db.prepare('SELECT COUNT(*) c FROM customers WHERE name LIKE ? OR phone LIKE ?').get('%' + RUN, '09%' + RUN).c;
  ok('cleanup: no test customers left', left === 0, 'left=' + left);

  console.log('\n=====================================\nIMPORT SUITE: ' + pass + ' passed, ' + fail + ' failed');
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('ALL IMPORT TESTS PASSED ✅');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
