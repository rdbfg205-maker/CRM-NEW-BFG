// Section 4 — Bulk Edit + Permission + Audit: real-HTTP end-to-end test suite (no mocks).
// Controlled test data (customers/products/role/user) is created via the real API and
// cleaned up at the end. Scenarios A–L per the section-4 spec.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = String(Date.now()).slice(-6);
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
async function req(method, path, body, tok, retry = 0) {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 429 && retry < 5) { await new Promise(s => setTimeout(s, 3000 * (retry + 1))); return req(method, path, body, tok, retry + 1); }
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const login = async (u, p) => (await req('POST', '/api/auth/login', { username: u, password: p })).data.access;
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const qa = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };

// ---------- logins ----------
const A = await login('admin', 'admin1234');
const M = await login('ali.k', '12345678');       // sales_manager → has bulk_edit:edit
const S = await login('sara.m', '12345678');      // sales → NO bulk_edit:edit
ok('setup: logins (admin/sales_manager/sales)', !!A && !!M && !!S);

// ---------- controlled test data ----------
let mkSeq = 0;
const mkCust = async (city, sp) => { mkSeq++; const uniq = 'R' + mkSeq + '-' + Math.floor(Math.random() * 900 + 100); return (await req('POST', '/api/r/customer', { name: 'تست BulkEdit ' + STAMP + ' ' + uniq + ' ' + city, type: 'company', city, salesperson_id: sp }, A)).data.id; };
const C1 = await mkCust('الف', 3), C2 = await mkCust('ب', 3), C3 = await mkCust('ج', 3);
ok('data: 3 customers created', !!C1 && !!C2 && !!C3, `${C1},${C2},${C3}`);
const PROD = (await req('POST', '/api/r/product', { code: 'BULK' + STAMP, name: 'کالای تست BulkEdit ' + STAMP, unit: 'عدد', weight_kg: 1 }, A)).data.id;
ok('data: test product created', !!PROD, 'id=' + PROD);

// limited-scope user: bulk_edit + customer view/edit (scope own) — for IDOR test
const role = (await req('POST', '/api/admin/roles', { name: 'bulktest_' + STAMP, name_fa: 'نقش تست BulkEdit', description: 'test' }, A)).data;
const roleSave = await req('PUT', '/api/admin/roles/' + role.id, { permissions: [
  { entity: 'customer', action: 'view', scope: 'own' },
  { entity: 'customer', action: 'edit', scope: 'own' },
  { entity: 'bulk_edit', action: 'edit', scope: 'all' },
]}, A);
ok('data: limited role created (bulk_edit + customer:edit own)', roleSave.status === 200, JSON.stringify(roleSave.data).slice(0, 60));
const tu = await req('POST', '/api/admin/users', { username: 'bulktest_' + STAMP, full_name: 'کاربر تست BulkEdit', password: 'TestBulk1234', role_ids: [role.id] }, A);
const T = await login('bulktest_' + STAMP, 'TestBulk1234');
const TU_ID = tu.data.id;
ok('data: limited user created + login', !!T && !!TU_ID, 'user=' + TU_ID);
// the system's permission map has a 30s cache (pre-existing architecture, same as section 3):
// wait for it to expire so the freshly granted role is visible to the backend.
console.log('waiting 31s for permission-cache expiry…');
await new Promise(res2 => setTimeout(res2, 31000));
const C_OWN = await mkCust('من', TU_ID);     // in the test user's scope
const C_OTHER = await mkCust('دیگری', 3);    // ali.k's customer → OUTSIDE the test user's scope

// ---------- Test A: authorized bulk edit succeeds ----------
const before1 = q1('SELECT city FROM customers WHERE id=?', C1).city;
const rA = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1, C2, C3], field: 'city', value: 'شهر جدید ' + STAMP }, M);
ok('A1: apply returns 200 with counts', rA.status === 200 && rA.data.changed === 3 && rA.data.total === 3, JSON.stringify(rA.data).slice(0, 120));
ok('A2: all 3 records updated in DB', [C1, C2, C3].every(id => q1('SELECT city FROM customers WHERE id=?', id).city === 'شهر جدید ' + STAMP));
const opA = rA.data.operation_id;
ok('A3: operation_id issued (BULK-…)', typeof opA === 'string' && opA.startsWith('BULK-'), opA);

// ---------- Test B: unauthorized user → 403 + denial audited ----------
const denBefore = q1("SELECT COUNT(*) c FROM audit_logs WHERE action='permission_denied' AND entity='bulk_edit' AND user_id=(SELECT id FROM users WHERE username='sara.m')").c;
const rB = await req('POST', '/api/r/customer/bulk/apply', { ids: [C_OWN], field: 'city', value: 'هاک ' + STAMP }, S);
ok('B1: direct API without permission → 403', rB.status === 403, 'status=' + rB.status);
const rBp = await req('POST', '/api/r/customer/bulk/preview', { ids: [C_OWN], field: 'city', value: 'x' }, S);
ok('B2: preview also 403 (no value leak without permission)', rBp.status === 403, 'status=' + rBp.status);
const denAfter = q1("SELECT COUNT(*) c FROM audit_logs WHERE action='permission_denied' AND entity='bulk_edit' AND user_id=(SELECT id FROM users WHERE username='sara.m')").c;
ok('B3: denial attempts audited (permission_denied ×2)', denAfter === denBefore + 2, `before=${denBefore} after=${denAfter}`);

// ---------- Test C: mass assignment rejected ----------
const rC0 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1], field: 'created_by', value: '1' }, M);
ok('C1a: non-registry field created_by rejected', rC0.status === 422, 'status=' + rC0.status);
const rC1 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1], field: 'status', value: 'blocked' }, M);
ok('C1: blocked field status rejected (NOT_ALLOWED)', rC1.status === 422 && rC1.data.error && rC1.data.error.code === 'NOT_ALLOWED', 'status=' + rC1.status);
const rC2 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1], field: 'password_hash', value: 'x' }, M);
ok('C2: field password_hash rejected', rC2.status === 422, 'status=' + rC2.status);
const rC3 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1], field: 'credit_limit', value: '5' }, M);
ok('C3: financial field credit_limit rejected', rC3.status === 422, 'status=' + rC3.status);
ok('C4: mass-assignment did not touch the record', q1('SELECT city FROM customers WHERE id=?', C1).city === 'شهر جدید ' + STAMP);

// ---------- Test D: IDOR — out-of-scope record → 403, no update, no leak ----------
const rD1 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C_OWN, C_OTHER], field: 'city', value: 'IDOR ' + STAMP }, T);
ok('D1: mixed in/out-of-scope selection → 403 (whole op rejected)', rD1.status === 403, 'status=' + rD1.status);
ok('D2: in-scope record NOT partially updated (all-or-nothing)', q1('SELECT city FROM customers WHERE id=?', C_OWN).city === 'من');
ok('D3: out-of-scope record untouched', q1('SELECT city FROM customers WHERE id=?', C_OTHER).city === 'دیگری');
const rD2 = await req('POST', '/api/r/customer/bulk/preview', { ids: [C_OTHER], field: 'city', value: 'x' }, T);
const leak = JSON.stringify(rD2.data || {});
ok('D4: preview of out-of-scope row → 403 and leaks no values', rD2.status === 403 && !leak.includes('دیگری'), leak.slice(0, 100));
const rD3 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C_OWN], field: 'city', value: 'شهر من ' + STAMP }, T);
ok('D5: in-scope row works for the limited user', rD3.status === 200 && q1('SELECT city FROM customers WHERE id=?', C_OWN).city === 'شهر من ' + STAMP, 'status=' + rD3.status);

// ---------- Test E: unknown field rejected ----------
const rE = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1], field: 'foo_bar', value: 'x' }, M);
ok('E1: unknown field → 422', rE.status === 422, 'status=' + rE.status + ' ' + (rE.data.error && rE.data.error.message));
const rE2 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1], field: 'salesperson_id', value: '5' }, M);
ok('E2: ownership ref field (salesperson_id) rejected', rE2.status === 422, 'status=' + rE2.status);

// ---------- Test F: invalid values rejected ----------
const rF1 = await req('POST', '/api/r/product/bulk/apply', { ids: [PROD], field: 'weight_kg', value: 'abc' }, M);
ok('F1: number field with non-numeric → 422', rF1.status === 422, 'status=' + rF1.status);
const rF2 = await req('POST', '/api/r/product/bulk/apply', { ids: [PROD], field: 'unit', value: 'bogus-unit' }, M);
ok('F2: select field with non-enum value → 422', rF2.status === 422, 'status=' + rF2.status);
const rF3 = await req('POST', '/api/r/product/bulk/apply', { ids: [PROD], field: 'weight_kg', value: '12.5' }, M);
ok('F3: valid number accepted', rF3.status === 200 && q1('SELECT weight_kg FROM products WHERE id=?', PROD).weight_kg === 12.5, 'status=' + rF3.status);

// ---------- Test G: no-op → no update, no audit ----------
const gBefore = q1("SELECT COUNT(*) c FROM audit_logs WHERE action IN ('BULK_EDIT','BULK_EDIT_SUMMARY')").c;
const rGp = await req('POST', '/api/r/customer/bulk/preview', { ids: [C1, C2], field: 'city', value: 'شهر جدید ' + STAMP }, M);
ok('G1: preview marks equal values as no-change', rGp.status === 200 && rGp.data.will_change === 0 && rGp.data.no_change === 2, JSON.stringify(rGp.data).slice(0, 100));
const rG = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1, C2], field: 'city', value: 'شهر جدید ' + STAMP }, M);
const gAfter = q1("SELECT COUNT(*) c FROM audit_logs WHERE action IN ('BULK_EDIT','BULK_EDIT_SUMMARY')").c;
ok('G2: no-op apply → changed=0 and ZERO audit rows', rG.status === 200 && rG.data.changed === 0 && gAfter === gBefore, `changed=${rG.data.changed} auditDelta=${gAfter - gBefore}`);

// ---------- Test H: transaction all-or-nothing (missing record) ----------
const rH = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1, 999999999], field: 'city', value: 'H ' + STAMP }, M);
ok('H1: one missing record → whole op rejected (404)', rH.status === 404, 'status=' + rH.status);
ok('H2: valid record NOT partially updated (rollback)', q1('SELECT city FROM customers WHERE id=?', C1).city === 'شهر جدید ' + STAMP);
const rH2 = await req('POST', '/api/r/customer/bulk/apply', { ids: [C1, C2], field: 'city', value: 'H2 ' + STAMP }, M);
const hAudits = qa('SELECT entity_id, new_value FROM audit_logs WHERE action=\'BULK_EDIT\' AND new_value LIKE ?', '%' + (rH2.data.operation_id || '∅') + '%');
ok('H3: successful 2-record op updated both + audited both', rH2.status === 200 && rH2.data.changed === 2 && hAudits.length === 2, 'audits=' + hAudits.length);

// ---------- Test I: audit before/after exact ----------
const iRow = qa('SELECT entity_id, old_value, new_value, user_id, ip, at FROM audit_logs WHERE action=\'BULK_EDIT\' AND new_value LIKE ? ORDER BY id DESC LIMIT 1', '%' + (rH2.data.operation_id || '∅') + '%')[0];
let oldV = {}, newV = {};
try { oldV = JSON.parse(iRow ? iRow.old_value : '{}'); newV = JSON.parse(iRow ? iRow.new_value : '{}'); } catch {}
ok('I1: per-record audit has before/after for the field', iRow && oldV.city === 'شهر جدید ' + STAMP && newV.city === 'H2 ' + STAMP, JSON.stringify({ oldV, newV }));
ok('I2: audit carries user_id + timestamp + ip', iRow && iRow.user_id === (q1('SELECT id FROM users WHERE username=\'ali.k\'').id) && !!iRow.at && !!iRow.ip, iRow && JSON.stringify({ u: iRow.user_id, at: iRow.at, ip: iRow.ip }));
const sumRow = qa("SELECT new_value FROM audit_logs WHERE action='BULK_EDIT_SUMMARY' AND new_value LIKE ? LIMIT 1", '%' + (rH2.data.operation_id || '∅') + '%')[0];
let sumV = {}; try { sumV = JSON.parse(sumRow ? sumRow.new_value : '{}'); } catch {}
ok('I3: summary audit has totals + result', sumV.changed === 2 && sumV.total_requested === 2 && sumV.result === 'success', JSON.stringify(sumV).slice(0, 120));

// ---------- Test J: all audits of an operation share the operation id ----------
const jRows = qa("SELECT entity_id, new_value FROM audit_logs WHERE new_value LIKE ? AND action IN ('BULK_EDIT','BULK_EDIT_SUMMARY')", '%' + (rH2.data.operation_id || '∅') + '%');
ok('J1: per-record + summary rows all carry the same bulk_op_id', jRows.length === 3 && jRows.every(x => JSON.parse(x.new_value).bulk_op_id === rH2.data.operation_id), 'rows=' + jRows.length + ' op=' + rH2.data.operation_id);

// ---------- Test K: price override bypass attempts rejected ----------
const qid = (await req('POST', '/api/r/quote', { customer_id: C1, status: 'draft' }, A)).data.id;
for (const [label, res, field] of [
  ['K1 quote.price', 'quote', 'price'],
  ['K2 quote.discount_pct', 'quote', 'discount_pct'],
  ['K3 quote.price_list_id', 'quote', 'price_list_id'],
  ['K4 product.price_retail', 'product', 'price_retail'],
  ['K5 customer.status', 'customer', 'status'],
]) {
  const rk = await req('POST', `/api/r/${res}/bulk/apply`, { ids: [res === 'product' ? PROD : (res === 'quote' ? qid : C1)], field, value: '999999' }, M);
  ok(label + ' → rejected (protected)', rk.status === 422, 'status=' + rk.status + ' ' + (rk.data.error && rk.data.error.message || '').slice(0, 60));
}
const qRow = q1('SELECT * FROM quotes WHERE id=?', qid);
ok('K6: quote untouched by bypass attempts', qRow && (qRow.discount_pct || 0) === 0);

// ---------- Test L: Section 3 (Price Override) regression ----------
try {
  const out = execSync('node price-override-test.mjs', { cwd: '/home/user/baspar-crm', encoding: 'utf8', timeout: 300000 });
  const m = out.match(/TOTAL:\s*(\d+) PASS \/ (\d+) FAIL/);
  ok('L1: price-override-test still 65/0', m && m[1] === '65' && m[2] === '0', m ? m[0] : out.slice(-120));
} catch (e) {
  ok('L1: price-override-test still 65/0', false, (e.stdout ? e.stdout.slice(-200) : e.message).slice(-200));
}

// ---------- cleanup (controlled test data only) ----------
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    for (const id of [C1, C2, C3, C_OWN, C_OTHER, qid]) { try { d.prepare('DELETE FROM quote_items WHERE quote_id=?').run(id); d.prepare('DELETE FROM quotes WHERE id=?').run(id); } catch {} }
    for (const id of [C1, C2, C3, C_OWN, C_OTHER]) { try { d.prepare('DELETE FROM customer_contacts WHERE customer_id=?').run(id); d.prepare('DELETE FROM customers WHERE id=?').run(id); } catch {} }
    try { d.prepare('DELETE FROM price_list_items WHERE product_id=?').run(PROD); d.prepare('DELETE FROM products WHERE id=?').run(PROD); } catch {}
    try { d.prepare('DELETE FROM user_roles WHERE user_id=?').run(TU_ID); d.prepare('DELETE FROM users WHERE id=?').run(TU_ID); d.prepare('DELETE FROM roles WHERE id=?').run(role.id); } catch {}
  });
  tx(); d.close();
  console.log('cleanup done');
})().then(async () => {
  console.log('\n========== BULK EDIT — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
});
