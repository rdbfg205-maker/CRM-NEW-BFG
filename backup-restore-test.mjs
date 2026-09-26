// Section 10 — Backup/RESTORE test on a REAL test copy (separate server instance, copied DB).
// Flow: copy DB → start test server (port 3999) → backup (API) → mutate data → restore (API)
// → verify data rolled back + integrity_check + foreign_key_check on the restored file.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const B = require('better-sqlite3');
const ROOT = '/home/user/baspar-crm';
const TEST = '/tmp/restore-test';
const PORT = 3999;
const BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(method, path, body, tok) {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t };
}
let srv = null;
(async () => {
  // 1. prepare the test copy
  fs.rmSync(TEST, { recursive: true, force: true });
  fs.mkdirSync(TEST, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data/baspar-crm.sqlite'), path.join(TEST, 'baspar-crm.sqlite'));
  fs.cpSync(path.join(ROOT, 'data/backups'), path.join(TEST, 'backups'), { recursive: true });
  ok('B0 test copy prepared (DB + backups dir)', fs.existsSync(path.join(TEST, 'baspar-crm.sqlite')) && fs.existsSync(path.join(TEST, 'backups')));

  // 2. start the test server instance
  srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: TEST, DB_PATH: path.join(TEST, 'baspar-crm.sqlite'), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d; });
  srv.stderr.on('data', d => { srvOut += d; });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(500);
    try { const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(1000) }); up = r.ok; } catch {}
  }
  ok('B1 test server instance up on port ' + PORT, up, srvOut.slice(-160).replace(/\n/g, ' | '));
  if (!up) { console.log('ABORT — server did not start:\n' + srvOut.slice(-800)); cleanup(); return; }

  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = login.data.access;
  ok('B2 admin login on test instance', !!A, 'status=' + login.status);

  // 3. create a REAL backup via API
  const bk = await api('POST', '/api/admin/backups', {}, A);
  ok('B3 backup created via API (test instance)', bk.status === 200 && bk.data.file_name, JSON.stringify(bk.data).slice(0, 120));
  const bkFile = path.join(TEST, 'backups', bk.data.file_name);
  ok('B4 backup file exists on disk (test backups dir)', fs.existsSync(bkFile));

  // 4. mutate the test data (add a customer that will NOT survive the restore)
  const mk = await api('POST', '/api/r/customer', { name: 'Restore Probe Customer ' + Date.now(), type: 'company' }, A);
  const probeId = mk.data && mk.data.id;
  ok('B5 mutation applied on test copy (customer created)', !!probeId, 'id=' + probeId);

  // 5. restore via API (the backup from step 3 — taken BEFORE the mutation)
  const rs = await api('POST', '/api/admin/backups/' + bk.data.id + '/restore', {}, A);
  ok('B6 restore API succeeded', rs.status === 200 && rs.data && (rs.data.ok || rs.data.status === 'restored' || rs.data.id), JSON.stringify(rs.data).slice(0, 160));
  await sleep(1500); // allow reopen

  // 6. verify: probe customer is GONE (rolled back), DB healthy
  const chk = await api('GET', '/api/r/customer?q=' + encodeURIComponent('Restore Probe Customer'), undefined, A);
  const stillThere = chk.data && Array.isArray(chk.data.items) && chk.data.items.some(c => c.id === probeId);
  ok('B7 restore rolled back the mutation (probe customer gone)', chk.status === 200 && !stillThere, 'status=' + chk.status + ' found=' + stillThere);
  const d2 = B(path.join(TEST, 'baspar-crm.sqlite'), { readonly: true });
  const integ = d2.pragma('integrity_check', { simple: true });
  const fk = d2.pragma('foreign_key_check');
  d2.close();
  ok('B8 restored DB integrity_check = ok', integ === 'ok', integ);
  ok('B9 restored DB foreign_key_check = 0', fk.length === 0, 'violations=' + fk.length);

  cleanup();
  console.log(`\nBACKUP/RESTORE TOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); cleanup(); process.exit(1); });
function cleanup() {
  try { if (srv) srv.kill('SIGKILL'); } catch {}
  try { fs.rmSync(TEST, { recursive: true, force: true }); } catch {}
}
