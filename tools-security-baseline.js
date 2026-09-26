// STAGE 1 — Security Baseline snapshot (read-only; changes nothing in the project)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = '/home/user/baspar-crm';
const STAMP = '20260831';
const BK = path.join(ROOT, 'data', 'backups', 'security-baseline-' + STAMP);
fs.mkdirSync(path.join(BK, 'db'), { recursive: true });

function sha256(f) {
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'backups']);
const EXCLUDE_FILES = new Set(['baspar-foam-crm-final.zip']);
const all = walk(ROOT).filter(p => {
  const rel = path.relative(ROOT, p).split(path.sep);
  if (rel.some(seg => EXCLUDE_DIRS.has(seg))) return false;
  if (rel[0] === 'data' && (rel[1] === 'backups' || rel[1] === 'uploads')) return false;
  if (EXCLUDE_FILES.has(path.basename(p))) return false;
  return true;
});

// ---------- 1. project backup (zip) ----------
const zipPath = path.join(BK, 'project-baseline.zip');
execSync(`cd ${ROOT} && zip -rq ${JSON.stringify(zipPath)} . -x "node_modules/*" -x ".git/*" -x "data/backups/*" -x "data/uploads/*" -x "baspar-foam-crm-final.zip"`, { stdio: 'pipe' });
console.log('project zip:', fs.statSync(zipPath).size, 'bytes');

// ---------- 2. database backup ----------
const dbSrc = path.join(ROOT, 'data', 'baspar-crm.sqlite');
const dbDst = path.join(BK, 'db', 'baspar-crm.sqlite');
fs.copyFileSync(dbSrc, dbDst);
const D = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const d = new D(dbDst, { readonly: true });
const integrity = d.pragma('integrity_check', { simple: true });
const fk = d.pragma('foreign_key_check');
const tables = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);
const fingerprint = {};
for (const t of tables) fingerprint[t] = d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
const schema = d.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name`).all().map(r => r.sql);
d.close();
fs.writeFileSync(path.join(BK, 'db', 'schema.sql'), schema.join(';\n') + ';\n', 'utf8');
fs.writeFileSync(path.join(BK, 'db', 'data-fingerprint.json'), JSON.stringify({ integrity, fk_violations: fk.length, tables: fingerprint, table_count: tables.length }, null, 2), 'utf8');
console.log('db backup:', fs.statSync(dbDst).size, 'bytes | integrity:', integrity, '| tables:', tables.length, '| FK violations:', fk.length);

// ---------- 3. file manifest (sha256) ----------
const manifest = {};
for (const f of all) manifest[path.relative(ROOT, f)] = sha256(f);
fs.writeFileSync(path.join(BK, 'manifest.json'), JSON.stringify({ stamp: STAMP, file_count: all.length, files: manifest }, null, 1), 'utf8');
console.log('manifest files:', all.length);

// ---------- 4. environment / stack ----------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const resolved = {};
for (const [k, v] of Object.entries(lock.packages || {})) {
  if (k && v.version) resolved[k.replace(/^\/home\/user\/baspar-crm\//, '').replace(/\/$/, '')] = v.version;
}
const envSpec = [
  { name: 'PORT', purpose: 'پورت HTTP سرور', default: '3000' },
  { name: 'TZ', purpose: 'منطقهٔ زمانی (تولید شماره/لوگ/تاریخ)', default: 'Asia/Tehran' },
  { name: 'DB_PATH', purpose: 'مسیر دیتابیس SQLite', default: 'data/baspar-crm.sqlite' },
  { name: 'DATA_DIR', purpose: 'ریشهٔ دیتا (آپلود/ضبط/بکاپ)', default: 'data' },
  { name: 'JWT_SECRET', purpose: 'کلید امضای توکن JWT', default: 'اگر خالی باشد: از کلید ذخیره‌شده در settings (enc_key) استفاده می‌شود' },
  { name: 'SEED_DEMO', purpose: 'فعال/غیرفعال کردن Seed دیتای دمو هنگام نصب اولیه', default: 'فعال' },
];
const envOut = {
  runtime: {
    stack: 'Node.js + Express (custom) + better-sqlite3 (SQLite) + Vanilla JS ESM frontend (بدون فریمورک)',
    NOTE: 'استک واقعی پروژه Node.js/SQLite است — این پروژه Python و SQL Server ندارد. مراحل بعدی Hardening باید دقیقاً بر همین استک اعمال شوند.',
    node: process.version,
    npm: (execSync('npm --version', { cwd: ROOT, encoding: 'utf8' }).match(/\d+\.\d+\.\d+/) || ['?'])[0],
    platform: process.platform,
    arch: process.arch,
  },
  env_vars: envSpec,
  ports: {
    app_http: 3000,
    note: 'فقط پورت ۳۰۰۰ (HTTP) باز است. دیتابیس فایل SQLite روی دیسک است (پورت شبکه ندارد) — inherent به استک. پورت ۸۸۸۸ متعلق به زیرساخت سنبوکس است، نه برنامه.',
  },
  services: [
    'HTTP server (node server/server.js) — پورت 3000، bind 0.0.0.0',
    'Scheduler داخلی (server/core/scheduler.js) — تیک ۶۰ ثانیه‌ای (پیگیری/جلسات/سینک VoIP)',
    'WebSocket hub داخلی (server/core/messenger.js) — روی همان پورت HTTP',
  ],
  dependencies: {
    production: pkg.dependencies || {},
    dev: pkg.devDependencies || {},
    resolved_versions: resolved,
  },
};
fs.writeFileSync(path.join(BK, 'environment.json'), JSON.stringify(envOut, null, 2), 'utf8');
console.log('environment.json written');

// ---------- 5. API endpoints ----------
const srv = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const routes = [...srv.matchAll(/router\.(get|post|put|delete)\('([^']+)'/g)].map(m => (m[1].toUpperCase() + ' ' + m[2]));
const mounts = [...srv.matchAll(/router\.use\('([^']+)'/g)].map(m => m[1]);
fs.writeFileSync(path.join(BK, 'api-endpoints.txt'), mounts.map(m => 'MOUNT ' + m).concat(routes.sort()).join('\n') + '\n', 'utf8');
console.log('api endpoints:', routes.length, '+ mounts:', mounts.length);

// ---------- 6. sensitive files identification (names only — NO secret content) ----------
const sensitive = [
  { file: 'data/baspar-crm.sqlite', reason: 'دیتابیس: کاربران، هش رمزها، رازهای رمزنگاری‌شده (voip/ai/sms… در settings با prefix enc:)' },
  { file: 'server/lib/crypto.js', reason: 'کد رمزنگاری (AES-256-GCM) — کلید واقعی در DB (settings.enc_key)، نه در سورس' },
  { file: 'server/auth/auth.js', reason: 'احراز هویت JWT + بررسی Permission' },
  { file: 'settings key: enc_key (داخل DB)', reason: 'کلید رمزنگاری رازها — فقط در دیتابیس' },
  { file: 'settings key: voip (داخل DB)', reason: 'اعتبارنامه‌های VoIP رمزنگاری‌شده (password/api_key/webhook_secret با enc:)' },
  { file: 'settings key: ai_settings (داخل DB)', reason: 'API Key های AI (اگر تنظیم شوند) — masked در API' },
  { file: 'data/uploads/، data/recordings/', reason: 'فایل‌های آپلودشده/ضبط — پشت احراز هویت سرو می‌شوند (خارج از public/)' },
  { file: 'data/backups/', reason: 'بکاپ‌ها — خارج از مسیر وب' },
];
fs.writeFileSync(path.join(BK, 'sensitive-files.json'), JSON.stringify({ NOTE: 'فقط نام فایل‌ها/کلیدها ثبت شده — هیچ مقدار Secret در این گزارش نمایش داده یا ذخیره نشده است.', items: sensitive }, null, 2), 'utf8');
console.log('sensitive-files.json written (names only)');

console.log('STAGE1-BACKUP-DONE');
