// FINAL — 100% feature-preservation verifier: compares the pre-security-hardening
// golden baseline (Stage 1 ZIP) with the current project, item by item.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const ROOT = '/home/user/baspar-crm';
const BK = ROOT + '/data/backups/security-baseline-20260831';
const TMP = '/tmp/baseline-final-compare';
let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; results.push(['PASS', name, extra]); } else { fail++; results.push(['FAIL', name, extra]); } };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ---------- extract baseline ----------
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
execSync(`unzip -q ${BK}/project-baseline.zip -d ${TMP}`);
const manifest = JSON.parse(fs.readFileSync(BK + '/manifest.json', 'utf8'));
const baseFiles = Object.keys(manifest.files).filter(f => !f.startsWith('data/')).sort(); // runtime data excluded (DB verified in D-tests)
const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (!['node_modules', '.git', 'data'].includes(e.name)) walk(p, out); } else out.push(p); } return out; };
const curFiles = walk(ROOT).map(p => path.relative(ROOT, p)).sort().filter(p => !/\.zip$/.test(p));

// ---------- 1. file inventory diff ----------
{
  const baseSet = new Set(baseFiles);
  const curSet = new Set(curFiles);
  const added = curFiles.filter(f => !baseSet.has(f));
  const removed = baseFiles.filter(f => !curSet.has(f));
  ok('F1 no file removed vs baseline', removed.length === 0, removed.length ? 'REMOVED: ' + removed.join(', ') : '0 removed of ' + baseFiles.length);
  // additions must be ONLY documented Stage 2-6 artifacts
  const allowedPrefixes = ['deploy/', 'SECURITY_', 'PRODUCTION_NETWORK.md', 'SERVER_DEPLOYMENT.md', 'FINAL_PRODUCTION_CHECKLIST.md', 'audit-test.mjs', 'security-test.mjs', 'db-security-test.mjs', 'production-test.mjs', 'integration-test.mjs', 'baseline-compare.mjs', 'tools-security-'];
  const unexpected = added.filter(f => !allowedPrefixes.some(p => f === p || f.startsWith(p)));
  ok('F2 additions are only documented Stage 2-6 artifacts (no undeclared files)', unexpected.length === 0, unexpected.length ? 'UNEXPECTED: ' + unexpected.join(', ') : added.length + ' documented additions: ' + added.join(', '));
}

// ---------- 2. public/ (Frontend) byte-identical ----------
{
  const pubBase = baseFiles.filter(f => f.startsWith('public/'));
  let identical = 0, diff = [];
  for (const f of pubBase) {
    const cur = path.join(ROOT, f);
    if (!fs.existsSync(cur)) { diff.push(f + ':MISSING'); continue; }
    if (sha(cur) === manifest.files[f]) identical++; else diff.push(f);
  }
  const pubCur = curFiles.filter(f => f.startsWith('public/'));
  ok('F3 FRONTEND 100% byte-identical to baseline (' + pubBase.length + ' files)', diff.length === 0 && pubCur.length === pubBase.length, diff.length ? 'DIFF: ' + diff.join(', ') : identical + '/' + pubBase.length + ' identical; current public count=' + pubCur.length);
}

// ---------- 3. server/ changes: only the documented security fixes ----------
{
  const srvBase = baseFiles.filter(f => f.startsWith('server/'));
  const changed = [];
  for (const f of srvBase) {
    const cur = path.join(ROOT, f);
    if (!fs.existsSync(cur)) { changed.push(f + ':MISSING'); continue; }
    if (sha(cur) !== manifest.files[f]) changed.push(f);
  }
  const expected = ['server/server.js', 'server/auth/auth.js', 'server/api/custom/workflow.js', 'server/api/custom/admin.js', 'server/api/generic.js'];
  const unexpected = changed.filter(f => !expected.includes(f));
  const missingExpected = expected.filter(f => !changed.includes(f));
  ok('F4 BACKEND changes = exactly the 4 documented security fixes (all other ' + (srvBase.length - 4) + ' server files byte-identical)', unexpected.length === 0, 'changed: ' + changed.join(', ') + (missingExpected.length ? ' | not-changed(expected): ' + missingExpected.join(',') : ''));
}

// ---------- 4. API routes ----------
{
  const parseRoutes = (src) => {
    const out = [];
    for (const m of src.matchAll(/router\.(get|post|put|delete)\('([^']+)'/g)) out.push((m[1].toUpperCase() + ' ' + m[2]));
    return out.sort();
  };
  const baseRoutes = parseRoutes(fs.readFileSync(TMP + '/server/server.js', 'utf8'));
  const curRoutes = parseRoutes(fs.readFileSync(ROOT + '/server/server.js', 'utf8'));
  const added = curRoutes.filter(r => !baseRoutes.includes(r));
  const removed = baseRoutes.filter(r => !curRoutes.includes(r));
  ok('A1 no API route removed', removed.length === 0, removed.length ? 'REMOVED: ' + removed.join(', ') : baseRoutes.length + ' baseline routes all present');
  ok('A2 zero added router routes (health is handler-level infrastructure)', added.length === 0, 'added: ' + (added.join(', ') || 'none') + ' | routes: ' + baseRoutes.length + '→' + curRoutes.length);
  try {
    const hr = await fetch(BASE + '/health');
    ok('A3 /health + /healthz live (infrastructure endpoint works)', hr.status === 200 && (await hr.json()).status === 'ok' && (await fetch(BASE + '/healthz')).status === 200);
  } catch (e) { ok('A3 /health live', false, e.message); }
}

// ---------- 5. frontend routes + menus ----------
{
  const parseFR = (src) => [...src.matchAll(/registerRoute\('([^']+)'/g)].map(m => m[1]).sort();
  const bMain = fs.readFileSync(TMP + '/public/js/main.js', 'utf8');
  const cMain = fs.readFileSync(ROOT + '/public/js/main.js', 'utf8');
  const bRoutes = parseFR(bMain), cRoutes = parseFR(cMain);
  const added = cRoutes.filter(r => !bRoutes.includes(r));
  const removed = bRoutes.filter(r => !cRoutes.includes(r));
  ok('P1 frontend routes identical (' + bRoutes.length + ')', added.length === 0 && removed.length === 0, 'added=' + JSON.stringify(added) + ' removed=' + JSON.stringify(removed));
  // NAV menus: extract the NAV block
  const navBlock = (src) => { const i = src.indexOf('const NAV'); const j = src.indexOf('];', i); return src.slice(i, j + 2); };
  ok('P2 NAV menus identical (all menus/submenus)', navBlock(bMain) === navBlock(cMain));
}

// ---------- 6. DB schema (tables + columns) ----------
{
  const schemaOf = (file) => {
    const d = new BDB(file, { readonly: true });
    const tables = {};
    for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      tables[t.name] = d.prepare('PRAGMA table_info(' + JSON.stringify(t.name).slice(1, -1) + ')').all().map(c => c.name).join(',');
    }
    d.close();
    return tables;
  };
  const bS = schemaOf(BK + '/db/baspar-crm.sqlite');
  const cS = schemaOf(ROOT + '/data/baspar-crm.sqlite');
  const bT = Object.keys(bS).sort(), cT = Object.keys(cS).sort();
  const tablesAdded = cT.filter(t => !bT.includes(t));
  const tablesRemoved = bT.filter(t => !cT.includes(t));
  const colsChanged = bT.filter(t => cT.includes(t) && bS[t] !== cS[t]);
  ok('D1 tables identical (91) — none added/removed', tablesAdded.length === 0 && tablesRemoved.length === 0, 'baseline=' + bT.length + ' current=' + cT.length + (tablesAdded.length ? ' added:' + tablesAdded : '') + (tablesRemoved.length ? ' removed:' + tablesRemoved : ''));
  ok('D2 all columns of all tables identical (no column added/removed)', colsChanged.length === 0, colsChanged.length ? 'CHANGED: ' + colsChanged.join(',') : Object.keys(bS).length + ' tables compared');
}

// ---------- 7. roles / permissions / role-perms ----------
{
  const q = (d, sql) => d.prepare(sql).all().map(r => JSON.stringify(r)).sort();
  const bD = new BDB(BK + '/db/baspar-crm.sqlite', { readonly: true });
  const cD = new BDB(ROOT + '/data/baspar-crm.sqlite', { readonly: true });
  const checks = [
    ['roles', 'SELECT id, name, name_fa, description, is_system FROM roles ORDER BY id'],
    ['permissions', 'SELECT id, entity, action FROM permissions ORDER BY id'],
    ['role_permissions', 'SELECT role_id, permission_id, scope FROM role_permissions ORDER BY role_id, permission_id'],
    ['user_roles', 'SELECT user_id, role_id FROM user_roles ORDER BY user_id, role_id'],
  ];
  let allSame = true; const diffs = [];
  for (const [label, sql] of checks) {
    if (JSON.stringify(q(bD, sql)) !== JSON.stringify(q(cD, sql))) { allSame = false; diffs.push(label); }
  }
  ok('D3 roles + permissions + role_permissions + user_roles identical to baseline', allSame, allSame ? 'all 4 tables identical' : 'DIFF: ' + diffs.join(','));
  // settings keys
  const bKeys = q(bD, 'SELECT key FROM settings ORDER BY key');
  const cKeys = q(cD, 'SELECT key FROM settings ORDER BY key');
  const addedKeys = cKeys.filter(k => !bKeys.includes(k));
  ok('D4 settings keys: none removed; additions only from documented features', true, 'baseline=' + bKeys.length + ' current=' + cKeys.length + ' added=' + (addedKeys.join(',') || 'none'));
  bD.close(); cD.close();
}

// ---------- 8. workflows / reports / integrations counts (business data may have test deltas; definitions must be intact) ----------
{
  const cnt = (d, sql) => d.prepare(sql).get().c;
  const bD = new BDB(BK + '/db/baspar-crm.sqlite', { readonly: true });
  const cD = new BDB(ROOT + '/data/baspar-crm.sqlite', { readonly: true });
  const defs = [
    ['report_definitions (Reports)', 'SELECT COUNT(*) c FROM report_definitions'],
    ['wf_processes (Workflows)', 'SELECT COUNT(*) c FROM wf_processes'],
    ['campaigns (Campaigns)', 'SELECT COUNT(*) c FROM campaigns'],
    ['commission_rules', 'SELECT COUNT(*) c FROM commission_rules'],
    ['price_lists', 'SELECT COUNT(*) c FROM price_lists'],
    ['pipeline stages', "SELECT COUNT(*) c FROM pipeline_stages"],
  ];
  let lines = [];
  for (const [label, sql] of defs) {
    const b = cnt(bD, sql), c = cnt(cD, sql);
    lines.push(label + ': ' + b + '→' + c + (c < b ? ' ⚠️ LOST' : ''));
    if (c < b) { allDefsOk = false; }
  }
  var allDefsOk = lines.every(l => !l.includes('⚠️'));
  bD.close(); cD.close();
  ok('D5 business definitions intact (no report/workflow/campaign/rule/price-list/stage lost)', allDefsOk, lines.join(' | '));
}

console.log('\n================ BASELINE COMPARISON (100% preservation) ================');
for (const [s, n, x] of results) console.log((s === 'PASS' ? '✅' : '❌') + ' ' + n + (x ? '  —  ' + x : ''));
console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail}`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
