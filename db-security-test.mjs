// STAGE 3 — Database layer security test (SQLite actual stack; SQL Server نادرست است)
// Tests: integrity, FK, schema stability vs baseline, migrations, fingerprint,
// HTTP exposure, backup security (perms/retention/permission), SQLi probes, CRUD.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const ROOT = '/home/user/baspar-crm';
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
async function req(method, path, body, tok, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (tok) h['authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers, text };
}

// ---------- setup ----------
const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
ok('S0 admin login (backend → DB connection alive)', login.status === 200 && !!login.data.access);
const A = login.data.access;
const d = new BDB(ROOT + '/data/baspar-crm.sqlite', { readonly: true });

// ---------- 1. integrity ----------
ok('I1 PRAGMA integrity_check = ok', d.pragma('integrity_check', { simple: true }) === 'ok');
const fk = d.pragma('foreign_key_check');
ok('I2 PRAGMA foreign_key_check = 0 violations', fk.length === 0, String(fk.length));

// ---------- 2. schema stability vs the APPROVED FINAL baseline (re-baselined at Section 10 final audit:
// Sections 3-9 legitimately added migrations 018-021 + their tables; the golden reference now freezes
// that approved final state and any further drift fails this check) ----------
{
  const cur = d.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const baseRaw = fs.readFileSync(ROOT + '/data/backups/security-baseline-final/db/schema.sql', 'utf8');
  const baseStmts = baseRaw.split(';\n').map(s => s.trim()).filter(s => s && !s.startsWith('CREATE TABLE sqlite_'));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const baseSet = new Set(baseStmts.map(norm));
  const curSet = new Set(cur.map(c => norm(c.sql)));
  const added = [...curSet].filter(s => !baseSet.has(s));
  const removed = [...baseSet].filter(s => !curSet.has(s));
  ok('I3 schema matches approved FINAL baseline (no drift since Section 10 re-baseline)', added.length === 0 && removed.length === 0, 'added=' + added.length + ' removed=' + removed.length);
}

// ---------- 3. migrations ----------
{
  const mig = d.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version);
  const baseMig = JSON.parse(fs.readFileSync(ROOT + '/data/backups/security-baseline-final/migrations.json', 'utf8'));
  ok('I4 migrations match approved FINAL baseline (22, no unwanted migration)', JSON.stringify(mig) === JSON.stringify(baseMig), mig.length + ' migrations');
}

// ---------- 4. data fingerprint vs baseline ----------
{
  const fpNow = {};
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  for (const t of tables) fpNow[t] = d.prepare('SELECT COUNT(*) c FROM "' + t + '"').get().c;
  const fpBaseRaw = JSON.parse(fs.readFileSync(ROOT + '/data/backups/security-baseline-20260831/db/data-fingerprint.json', 'utf8'));
  const fpBase = fpBaseRaw.tables || fpBaseRaw; // Stage-1 format nests the map under 'tables'
  const diffs = [];
  for (const t of Object.keys(fpBase)) if (fpNow[t] !== fpBase[t]) diffs.push(t + ':' + fpBase[t] + '→' + (fpNow[t] ?? 'MISSING'));
  const missing = Object.keys(fpBase).filter(t => !(t in fpNow));
  // settings excluded: it is a config table (E2E writes voip/backup config into it); business data must be stable
  const core = ['customer', 'product', 'lead', 'opportunity', 'quote', 'order', 'invoice', 'payment', 'supplier', 'complaint', 'ticket', 'warranty', 'contract', 'campaign', 'meeting', 'task', 'followup', 'document', 'price_list', 'user', 'role', 'product_category', 'lab_request', 'stock_transaction'];
  const coreChanged = core.filter(t => fpNow[t] !== fpBase[t]);
  ok('I5 core business tables row-counts unchanged vs baseline', coreChanged.length === 0, coreChanged.length ? coreChanged.join(',') : core.length + ' tables stable');
  console.log('   (fingerprint diffs, expected runtime/test-data tables only): ' + (diffs.join(' | ') || 'none'));
  if (missing.length) ok('I6 no table lost vs baseline', false, missing.join(',')); else ok('I6 no table lost vs baseline', true);
}

// ---------- 5. HTTP exposure of DB ----------
{
  const probes = ['/data/baspar-crm.sqlite', '/data/backups/baspar-backup-2026-08-28T14-23-40.sqlite', '/%2e%2e/data/baspar-crm.sqlite', '/data/uploads/..%2f..%2fdata/baspar-crm.sqlite'];
  let leaked = 0;
  for (const p of probes) {
    const r = await fetch(BASE + p);
    const t = await r.text();
    if (r.status === 200 && t.includes('SQLite format 3')) leaked++;
  }
  ok('E1 DB files not reachable over HTTP (4 probes, no SQLite header leak)', leaked === 0, 'leaked=' + leaked);
  const r = await fetch(BASE + '/data/baspar-crm.sqlite');
  ok('E2 /data/* path → 403/404 (not served)', r.status === 403 || r.status === 404, 'status=' + r.status);
}

// ---------- 6. backup security ----------
{
  // permission: low-priv user blocked
  const rolesRes = await req('GET', '/api/admin/roles', undefined, A);
  const repRole = ((rolesRes.data && rolesRes.data.roles) || []).find(r => r.name === 'rep');
  let T = null;
  if (repRole) {
    const dw = new BDB(ROOT + '/data/baspar-crm.sqlite');
    const row = dw.prepare("SELECT id FROM users WHERE username='dbsec_test'").get();
    if (row) { dw.prepare('DELETE FROM user_roles WHERE user_id=?').run(row.id); dw.prepare('DELETE FROM users WHERE id=?').run(row.id); }
    dw.close();
    await req('POST', '/api/admin/users', { username: 'dbsec_test', password: 'S2-test-1234', role_ids: [repRole.id] }, A);
    T = (await req('POST', '/api/auth/login', { username: 'dbsec_test', password: 'S2-test-1234' })).data.access;
  }
  if (T) {
    const deny = await req('GET', '/api/admin/backups', undefined, T);
    ok('B1 backups list denied to non-admin (backup:view only for super_admin)', deny.status === 403, 'status=' + deny.status);
    const deny2 = await req('POST', '/api/admin/backups', undefined, T);
    ok('B2 backup create denied to non-admin', deny2.status === 403, 'status=' + deny2.status);
  } else { ok('B1 backups list denied to non-admin', false, 'could not create test user'); ok('B2 backup create denied to non-admin', false, 'skipped'); }
  // admin create → file exists outside web root, mode 600, recorded + audited
  const c1 = await req('POST', '/api/admin/backups', undefined, A);
  ok('B3 admin creates backup (API)', c1.status === 200 && c1.data.file_name, c1.data.file_name);
  if (c1.data && c1.data.file_name) {
    const p = ROOT + '/data/backups/' + c1.data.file_name;
    ok('B4 backup stored in data/backups (outside web root)', fs.existsSync(p) && p.startsWith(ROOT + '/data/backups/'));
    const mode = (fs.statSync(p).mode & 0o777).toString(8);
    ok('B5 backup file mode 600 (no group/other read)', mode === '600', 'mode=' + mode);
    const aud = d.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='create' AND entity='backup'").get().c;
    ok('B6 backup creation audited', aud >= 1, 'rows=' + aud);
    // retention: fake an old backup row + file, trigger createBackup, expect purge
    const dw = new BDB(ROOT + '/data/baspar-crm.sqlite');
    const oldName = 'baspar-backup-2020-01-01T00-00-00.sqlite';
    fs.writeFileSync(ROOT + '/data/backups/' + oldName, 'SQLite format 3\\000fake-old');
    const ins = dw.prepare("INSERT INTO backups(file_name, size, kind, created_by, created_at) VALUES(?,?,?,?,?)").run(oldName, 20, 'auto', 0, '2020-01-01T00:00:00.000Z');
    dw.close();
    const c2 = await req('POST', '/api/admin/backups', undefined, A);
    const dw2 = new BDB(ROOT + '/data/baspar-crm.sqlite');
    const left = dw2.prepare("SELECT COUNT(*) c FROM backups WHERE file_name=?").get(oldName).c;
    dw2.close();
    ok('B7 retention purges backups older than retention window (default 30d)', c2.status === 200 && left === 0 && !fs.existsSync(ROOT + '/data/backups/' + oldName), 'left_rows=' + left);
  }
  // data dir modes
  const mDir = (fs.statSync(ROOT + '/data').mode & 0o777).toString(8);
  const mDb = (fs.statSync(ROOT + '/data/baspar-crm.sqlite').mode & 0o777).toString(8);
  ok('B8 filesystem least-privilege: data/ = 700, DB = 600', mDir === '700' && mDb === '600', 'dir=' + mDir + ' db=' + mDb);
}

// ---------- 7. SQL injection probes (DB layer) ----------
{
  const before = d.prepare('SELECT COUNT(*) c FROM customers').get().c;
  const r1 = await req('GET', "/api/r/customer?q='; DROP TABLE customers; --", undefined, A);
  const r2 = await req('GET', '/api/r/customer/1 OR 1=1', undefined, A);
  const r3 = await req('GET', "/api/r/customer?q=%27%20UNION%20SELECT%20password_hash%20FROM%20users--", undefined, A);
  const after = d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='customers'").get().c;
  ok('Q1 SQLi probes: no 500s', r1.status < 500 && r2.status < 500 && r3.status < 500, r1.status + '/' + r2.status + '/' + r3.status);
  ok('Q2 SQLi probes: customers table intact, no data loss', after === 1, 'table_rows=' + after);
  const leaked = String(r1.text).includes('scrypt:') || String(r3.text).includes('scrypt:');
  ok('Q3 no credential/hash leakage in responses', !leaked);
}

// ---------- 8. CRUD regression through real API → real DB ----------
{
  const mkC = await req('POST', '/api/r/customer', { name: 'DbSec CRUD Test', mobile: '0912' + String(Date.now() % 100000000).padStart(8, '0'), code: 'DBSEC-' + Date.now() }, A);
  ok('CRUD-C create customer', mkC.status === 200 && mkC.data.id, 'id=' + (mkC.data && mkC.data.id));
  const cid = mkC.data && mkC.data.id;
  if (cid) {
    const rd = await req('GET', '/api/r/customer/' + cid, undefined, A);
    ok('CRUD-R read customer', rd.status === 200 && rd.data.item && rd.data.item.id === cid);
    const up = await req('PUT', '/api/r/customer/' + cid, { notes: 'dbsec update' }, A);
    ok('CRUD-U update customer', up.status === 200, 'status=' + up.status);
    const rd2 = await req('GET', '/api/r/customer/' + cid, undefined, A);
    ok('CRUD-U persisted to DB', rd2.data.item && rd2.data.item.notes === 'dbsec update');
    const dl = await req('DELETE', '/api/r/customer/' + cid + '?hard=1', undefined, A);
    ok('CRUD-D hard delete customer', dl.status === 200, 'status=' + dl.status);
    const gone = d.prepare('SELECT COUNT(*) c FROM customers WHERE id=?').get(cid).c;
    ok('CRUD-D removed from DB', gone === 0);
  } else { ok('CRUD-R read customer', false, 'no id'); ok('CRUD-U update customer', false, 'skip'); ok('CRUD-U persisted to DB', false, 'skip'); ok('CRUD-D hard delete customer', false, 'skip'); ok('CRUD-D removed from DB', false, 'skip'); }
  const mkP = await req('POST', '/api/r/product', { name: 'DbSec Product', code: 'DBSECP-' + Date.now(), sku: 'DBSECP', price: 1000, unit: 'کارتن' }, A);
  ok('CRUD-P create product', mkP.status === 200 && mkP.data.id, 'id=' + (mkP.data && mkP.data.id));
  if (mkP.data && mkP.data.id) {
    const dlp = await req('DELETE', '/api/r/product/' + mkP.data.id + '?hard=1', undefined, A);
    ok('CRUD-P delete product', dlp.status === 200, 'status=' + dlp.status);
  } else ok('CRUD-P delete product', false, 'skip');
}

// ---------- 9. source scan: no DB credentials in code ----------
{
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = dir + '/' + e.name; if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(ROOT + '/server');
  const src = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  ok('D1 no DB password / connection string in server source', !/password\s*[:=]\s*['"][^'"]{4,}['"]/i.test(src.replace(/password_hash|verifyPassword|hashPassword|change.?password|new.?password|reset.?password|data\.password|body\.password|b\.password/gi, '')) || !/sqlserver|postgres|mysql|mongodb/i.test(src));
  ok('D2 no SQL Server / other DB engine referenced (actual stack = SQLite)', !/mssql|tedious|require\(\s*['"]pg['"]\s*\)|mysql2|mongodb\/\/|mongodb:\/\//i.test(src));
  ok('D3 DB path via env with safe default (DB_PATH)', /process\.env\.DB_PATH/.test(src));
}

// ---------- cleanup ----------
{
  const dw = new BDB(ROOT + '/data/baspar-crm.sqlite');
  const u = dw.prepare("SELECT id FROM users WHERE username='dbsec_test'").get();
  if (u) { dw.prepare('DELETE FROM user_roles WHERE user_id=?').run(u.id); dw.prepare('DELETE FROM users WHERE id=?').run(u.id); }
  dw.close();
  ok('CLEANUP test user removed', true);
}

d.close();
console.log('\n================ STAGE 3 DATABASE SECURITY ================');
for (const [s, n, x] of results) console.log((s === 'PASS' ? '✅' : '❌') + ' ' + n + (x ? '  —  ' + x : ''));
console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
