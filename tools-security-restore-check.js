// STAGE 1 — Restore verification: proves the backup is fully restorable
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = '/home/user/baspar-crm';
const BK = path.join(ROOT, 'data', 'backups', 'security-baseline-20260831');
const TMP = '/tmp/baseline-restore-' + Date.now();
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
function sha256(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }

// 1) extract zip
execSync(`unzip -q ${JSON.stringify(BK + '/project-baseline.zip')} -d ${JSON.stringify(TMP)}`);
const restored = fs.existsSync(path.join(TMP, 'server', 'server.js')) && fs.existsSync(path.join(TMP, 'public', 'index.html')) && fs.existsSync(path.join(TMP, 'package.json'));
ok('zip extracts to full project structure', restored);

// 2) verify every file hash against manifest
const manifest = JSON.parse(fs.readFileSync(path.join(BK, 'manifest.json'), 'utf8'));
let verified = 0, mismatched = 0, missing = 0;
for (const [rel, hash] of Object.entries(manifest.files)) {
  const f = path.join(TMP, rel);
  if (!fs.existsSync(f)) { missing++; continue; }
  if (sha256(f) !== hash) mismatched++;
  verified++;
}
ok('all manifest files restored with identical SHA-256', missing === 0 && mismatched === 0, `verified=${verified} missing=${missing} mismatched=${mismatched} of ${manifest.file_count}`);

// 3) database restore test — open the DB COPY from the backup (never the live DB)
const D = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const dbCopy = path.join(TMP, 'data', 'baspar-crm.sqlite');
ok('DB file present in restored project', fs.existsSync(dbCopy));
const d = new D(dbCopy, { readonly: true });
const integrity = d.pragma('integrity_check', { simple: true });
const fk = d.pragma('foreign_key_check');
const fpLive = JSON.parse(fs.readFileSync(path.join(BK, 'db', 'data-fingerprint.json'), 'utf8'));
const fpNow = {};
for (const t of Object.keys(fpLive.tables)) fpNow[t] = d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
const fpMatch = JSON.stringify(fpNow) === JSON.stringify(fpLive.tables);
ok('restored DB integrity_check = ok', integrity === 'ok', integrity);
ok('restored DB 0 FK violations', fk.length === 0, String(fk.length));
ok('restored DB data fingerprint identical (91 tables)', fpMatch && Object.keys(fpLive.tables).length === 91, Object.keys(fpLive.tables).length + ' tables');
// live DB copy vs backup copy must be byte-identical
const byteSame = sha256(path.join(ROOT, 'data', 'baspar-crm.sqlite')) === sha256(dbCopy);
ok('backup DB byte-identical to live DB at freeze time', byteSame);
d.close();

// 4) the standalone db/ copy in the backup must also open cleanly
const d2 = new D(path.join(BK, 'db', 'baspar-crm.sqlite'), { readonly: true });
ok('standalone db/ backup copy opens, integrity ok', d2.pragma('integrity_check', { simple: true }) === 'ok');
d2.close();

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n================ RESTORE VERIFICATION ================');
for (const [s, n, x] of results) console.log((s === 'PASS' ? '✅' : '❌') + ' ' + n + (x ? '  —  ' + x : ''));
console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
