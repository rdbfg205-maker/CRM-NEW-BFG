'use strict';
process.env.TZ = process.env.TZ || 'Asia/Tehran';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { get, open, getSetting, setSetting, getUserSetting, setUserSetting, addActivity, DATA_DIR, DB_PATH } = require('./db/db');
const { createRouter, parseBody, HttpError, sendJson, sendError, serveStatic, rateLimit } = require('./lib/http');
const {
  requireUser, userFromToken, refreshSession, login, publicUser, PERM_ACTIONS, hasPerm, loadPermMap,
  hashPassword, verifyPassword, totpSecret, totpVerify, randomToken, sha256, nowIso,
} = require('./auth/auth');
const { R, resolveOptions } = require('./api/resources');
const generic = require('./api/generic');
const { audit } = require('./core/audit');
const { notify } = require('./core/notify');
const { dispatch } = require('./core/workflow');
const approvals = require('./core/approvals');
const scheduler = require('./core/scheduler');
const { getHub } = require('./core/messenger');
const dash = require('./api/custom/dashboard');
const sales = require('./api/custom/sales');
const bulk = require('./api/custom/bulk');
const pricing = require('./core/pricing');
const reports = require('./api/custom/reports');
const admin = require('./api/custom/admin');
const messenger = require('./api/custom/messenger');
const ai = require('./api/custom/ai');
const smartsales = require('./api/custom/smartsales');
const campaigns = require('./api/custom/campaigns');
const exporter = require('./api/custom/exporter');
const loyalty = require('./api/custom/loyalty');
const customermsg = require('./api/custom/customermsg');
const commcenter = require('./api/custom/commcenter');
const signatures = require('./api/custom/signatures');
const approvalChains = require('./api/custom/approvals');
const portal = require('./api/custom/portal');
const voip = require('./api/custom/voip');
const printMod = require('./lib/print');
const wf = require('./api/custom/workflow');
const advreports = require('./api/custom/advreports');
const aigw = require('./api/custom/aigw');
const aireport = require('./api/custom/aireport');
const calmod = require('./api/custom/calendar');
const meetings = require('./api/custom/meetings');
const geography = require('./api/custom/geography');
const contactsImport = require('./api/custom/contacts-import');
const voiceExtract = require('./ai/voice-extract');
const { nowIso: ts, fmtDate, faDigits, toEnDigits, parseId, normalizeFa, nameSimilarity, likeEscape, sum } = require('./lib/util');

// ---------- env & secrets ----------
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();
open();
const { setSecret, setEncKey } = require('./lib/crypto');
if (!getSetting('jwt_secret')) setSetting('jwt_secret', randomToken(32));
if (!getSetting('enc_key')) setSetting('enc_key', randomToken(32));
// Secrets management: environment variables are the authoritative source; the
// DB-stored value is the backward-compatible fallback (existing installs keep
// working untouched; production deployments can move the secret to the env).
setSecret(process.env.JWT_SECRET || getSetting('jwt_secret'));
setEncKey(getSetting('enc_key'));
// first-run seed
try { require('./db/seed'); } catch (e) { console.error('seed failed:', e.message); }

const PORT = parseInt(process.env.PORT || '3050', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const router = createRouter();

// ============ HELPERS ============
function authed(req, res) {
  const user = requireUser(req, res);
  if (req) req.user = user;
  return user;
}
function ip(req) { return req.socket.remoteAddress || ''; }
function withBody(fn) {
  return async (req, res) => {
    try {
      req._body = await parseBody(req);
      const user = req._authUser || requireUser(req, res);
      req.user = user;
      const out = await fn(req, res, user);
      if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
    } catch (e) { sendError(res, e); }
  };
}
// ============ AUTH ============
router.post('/api/auth/login', async (req, res) => {
  try {
    const parsed = await parseBody(req);
    req._body = parsed.json || {};
    const out = await login(req, res);
    sendJson(res, 200, out);
  } catch (e) { sendError(res, e); }
});
function attachAuth(req) {
  const u = userFromToken(req);
  if (u) { req.user = u; }
  return u;
}
router.post('/api/auth/refresh', async (req, res) => {
  try {
    const r = refreshSession(req, res);
    sendJson(res, 200, { user: publicUser(r.user), access: r.access });
  } catch (e) { sendError(res, e); }
});
router.post('/api/auth/logout', async (req, res) => {
  try {
    const c = req.headers.cookie || '';
    const m = c.match(/bfc_refresh=([^;]+)/);
    if (m) get().prepare('UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=?').run(ts(), sha256(decodeURIComponent(m[1])));
    // audit: logout (best-effort user identification from the Bearer token)
    try {
      const u = userFromToken(req);
      audit(u, 'auth', u ? u.id : 0, 'logout', null, { ip: req.socket.remoteAddress || '' });
    } catch { /* audit must never break logout */ }
    require('./auth/auth').clearCookies(res);
    sendJson(res, 200, { ok: true });
  } catch (e) { sendError(res, e); }
});
router.post('/api/auth/totp/setup', withBody((req, res, user) => {
  const sec = user.totp_secret || totpSecret();
  if (!user.totp_secret) get().prepare('UPDATE users SET totp_secret=? WHERE id=?').run(sec, user.id);
  const uri = `otpauth://totp/BasparCRM:${user.username}?secret=${sec}&issuer=BasparFoamCRM`;
  return { secret: sec, uri };
}));
router.post('/api/auth/totp/enable', withBody((req, res, user) => {
  const body = req._body.json || {};
  if (!user.totp_secret) throw new HttpError(400, 'NO_SECRET', 'ابتدا رمز TOTP را با setup دریافت کنید.');
  if (!totpVerify(user.totp_secret, body.code)) throw new HttpError(400, 'TOTP_INVALID', 'کد تأیید اشتباه است.');
  get().prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(user.id);
  audit(user, 'user', user.id, 'totp_enable', null, null);
  return { ok: true };
}));
router.post('/api/auth/totp/disable', withBody((req, res, user) => {
  get().prepare('UPDATE users SET totp_enabled=0 WHERE id=?').run(user.id);
  audit(user, 'user', user.id, 'totp_disable', null, null);
  return { ok: true };
}));
router.post('/api/auth/forgot', async (req, res) => {
  try {
    const { json } = await parseBody(req);
    const id = String(json.email || json.username || '').trim();
    if (!id) throw new HttpError(400, 'VALIDATION', 'ایمیل الزامی است.');
    const d = get();
    const user = d.prepare('SELECT * FROM users WHERE email=? OR username=?').get(id, id);
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'کاربری با این مشخصات پیدا نشد.');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    d.prepare('INSERT INTO password_resets(user_id, token_hash, code, expires_at) VALUES(?,?,?,?)')
      .run(user.id, sha256(id + code), code, new Date(Date.now() + 3600e3).toISOString());
    const emailCfg = getSetting('email');
    let sent = false;
    if (emailCfg && emailCfg.active && emailCfg.settings) {
      try {
        const { decSecret } = require('./lib/crypto');
        const key = decSecret(emailCfg.settings.apiKey || emailCfg.settings.token || '');
        const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 12000);
        await fetch((emailCfg.settings.baseUrl || '').replace(/\/$/, '') + '/v1/emails', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ to: [user.email], subject: 'بازیابی رمز عبور — BasparCRM', text: `کد بازیابی شما: ${code}` }), signal: ctrl.signal,
        });
        sent = true;
      } catch {}
    }
    if (!sent) {
      // email not configured: expose the code to admins (audit + admin notification) — documented behavior
      for (const u of d.prepare(`SELECT u.id, u.full_name FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name IN ('super_admin','ceo') AND u.active=1`).all()) {
        notify(u.id, 'security', 'کد بازیابی رمز (ایمیل پیکربندی نشده)', `کاربر ${user.username}: کد ${code} — پس از تنظیم سرویس ایمیل، کد به‌صورت خودکار ارسال می‌شود.`, 'user', user.id);
      }
      audit({ id: 0, username: 'system' }, 'user', user.id, 'password_reset_code', null, { code: code });
    }
    sendJson(res, 200, { ok: true, sent, message: sent ? 'کد بازیابی ارسال شد.' : 'کد بازیابی ثبت شد؛ چون سرویس ایمیل پیکربندی نشده، مدیر سیستم کد را از مرکز اعلان‌ها دریافت کند.' });
  } catch (e) { sendError(res, e); }
});
router.post('/api/auth/reset', async (req, res) => {
  try {
    const { json } = await parseBody(req);
    const id = String(json.email || json.username || '').trim();
    const code = toEnDigits(String(json.code || ''));
    const pw = String(json.password || '');
    if (!id || !code || pw.length < 6) throw new HttpError(400, 'VALIDATION', 'کد بازیابی و رمز جدید (حداقل ۶ کاراکتر) الزامی است.');
    const d = get();
    const user = d.prepare('SELECT * FROM users WHERE email=? OR username=?').get(id, id);
    const row = user ? d.prepare('SELECT * FROM password_resets WHERE user_id=? AND code=? AND used_at IS NULL AND expires_at>?').get(user.id, code, ts()) : null;
    if (!row) throw new HttpError(400, 'BAD_CODE', 'کد بازیابی نامعتبر یا منقضی است.');
    d.prepare('UPDATE password_resets SET used_at=? WHERE id=?').run(ts(), row.id);
    d.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(pw), user.id);
    audit(user, 'user', user.id, 'password_reset', null, null);
    sendJson(res, 200, { ok: true });
  } catch (e) { sendError(res, e); }
});
router.post('/api/auth/password', withBody((req, res, user) => {
  const body = req._body.json || {};
  if (!verifyPassword(String(body.current || ''), user.password_hash)) throw new HttpError(400, 'BAD_PASSWORD', 'رمز فعلی اشتباه است.');
  if (String(body.new || '').length < 6) throw new HttpError(400, 'VALIDATION', 'رمز جدید باید حداقل ۶ کاراکتر باشد.');
  get().prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(body.new), user.id);
  audit(user, 'user', user.id, 'password_change', null, null);
  return { ok: true };
}));
// ============ ME / PERMISSIONS / SETTINGS ============
router.get('/api/me', (req, res) => {
  try {
    const user = requireUser(req, res);
    const d = get();
    const roles = d.prepare(`SELECT r.id, r.name, r.name_fa FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?`).all(user.id);
    const perms = {};
    const map = (loadPermMap()[user.id] || {});
    for (const k of Object.keys(map)) {
      const [e, a] = k.split(':');
      if (e === '*' || a === '*') continue;
      if (!perms[e]) perms[e] = {};
      perms[e][a] = map[k];
    }
    sendJson(res, 200, { user: publicUser(user), roles, permissions: perms, settings: userSettings(user.id) });
  } catch (e) { sendError(res, e); }
});
// ============ SELF-SERVICE PROFILE (personalization — own record only) ============
router.put('/api/me', withBody((req, res, user) => {
  const b = req._body.json || {};
  const full_name = b.full_name === undefined ? user.full_name : String(b.full_name).trim();
  if (!full_name) throw new HttpError(400, 'VALIDATION', 'نام و نام خانوادگی نمی‌تواند خالی باشد.');
  if (full_name.length > 120) throw new HttpError(400, 'VALIDATION', 'نام طولانی است.');
  const email = b.email === undefined ? user.email : String(b.email).trim();
  const phone = b.phone === undefined ? user.phone : String(b.phone).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'VALIDATION', 'ایمیل نامعتبر است.');
  if (phone && !/^[0-9+\-\s]{6,20}$/.test(phone)) throw new HttpError(400, 'VALIDATION', 'شماره تماس نامعتبر است.');
  const d = get();
  const old = d.prepare('SELECT full_name, email, phone FROM users WHERE id=?').get(user.id);
  d.prepare('UPDATE users SET full_name=?, email=?, phone=?, updated_at=? WHERE id=?').run(full_name, email || null, phone || null, ts(), user.id);
  if (old.full_name !== full_name || (old.email || '') !== (email || '') || (old.phone || '') !== (phone || '')) {
    audit(user, 'user', user.id, 'profile_update', old, { full_name, email: email || null, phone: phone || null }, '');
  }
  const fresh = d.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  return { ok: true, user: publicUser(fresh) };
}));
router.post('/api/me/avatar', withBody((req, res, user) => {
  const files = req._body.files || [];
  if (!files.length) throw new HttpError(400, 'NO_FILE', 'فایلی دریافت نشد.');
  const f = files[0];
  const b = f.data;
  if (!b || b.length < 10) throw new HttpError(400, 'BAD_TYPE', 'تصوییری معتبر دریافت نشد.');
  if (b.length > 2 * 1024 * 1024) throw new HttpError(400, 'TOO_LARGE', 'حجم تصویر باید کمتر از ۲ مگابایت باشد.');
  // image magic bytes only (MIME header is client-controlled)
  const isPng = b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
  const isJpg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
  const isWebp = b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpg && !isWebp) throw new HttpError(400, 'BAD_TYPE', 'محتوای فایل تصویر معتبر نیست (فقط PNG/JPEG/WebP).');
  const ext = isPng ? 'png' : isJpg ? 'jpg' : 'webp';
  const dir = path.join(DATA_DIR, 'uploads', 'avatars');
  fs.mkdirSync(dir, { recursive: true });
  const name = 'av-' + user.id + '-' + randomToken(8) + '.' + ext;
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, b);
  try { fs.chmodSync(dest, 0o600); } catch { /* ignore on odd fs */ }
  // remove previous avatar file if it lives in the avatars dir
  const d = get();
  const cur = d.prepare('SELECT avatar FROM users WHERE id=?').get(user.id).avatar || '';
  if (cur.startsWith('/api/avatars/av-' + user.id + '-')) {
    try { const oldFile = path.join(dir, path.basename(cur)); if (fs.existsSync(oldFile) && oldFile !== dest) fs.unlinkSync(oldFile); } catch { /* ignore */ }
  }
  d.prepare('UPDATE users SET avatar=?, updated_at=? WHERE id=?').run('/api/avatars/' + name, ts(), user.id);
  audit(user, 'user', user.id, 'avatar_update', null, { file: name }, '');
  return { ok: true, avatar: '/api/avatars/' + name };
}));
router.delete('/api/me/avatar', (req, res) => {
  try {
    const user = requireUser(req, res);
    const d = get();
    const cur = d.prepare('SELECT avatar FROM users WHERE id=?').get(user.id).avatar || '';
    if (cur.startsWith('/api/avatars/av-' + user.id + '-')) {
      try { fs.unlinkSync(path.join(DATA_DIR, 'uploads', 'avatars', path.basename(cur))); } catch { /* ignore */ }
    }
    d.prepare('UPDATE users SET avatar=?, updated_at=? WHERE id=?').run('', ts(), user.id);
    if (cur) audit(user, 'user', user.id, 'avatar_remove', { file: cur }, null, '');
    sendJson(res, 200, { ok: true, avatar: '' });
  } catch (e) { sendError(res, e); }
});
router.get('/api/avatars/:name', (req, res) => {
  try {
    const name = String(req.params.name || '');
    if (!/^av-\d+-[a-f0-9]{16}\.(png|jpg|jpeg|webp)$/.test(name)) throw new HttpError(404, 'NOT_FOUND', 'پیدا نشد.');
    const file = path.join(DATA_DIR, 'uploads', 'avatars', name);
    const full = path.resolve(file);
    if (!full.startsWith(path.resolve(path.join(DATA_DIR, 'uploads', 'avatars')) + path.sep) || !fs.existsSync(full)) throw new HttpError(404, 'NOT_FOUND', 'پیدا نشد.');
    const st = fs.statSync(full);
    const ctype = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(name).toLowerCase()];
    res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store' });
    fs.createReadStream(full).pipe(res);
  } catch (e) { sendError(res, e); }
});
const BRAND_COLORS = ['#c9a227', '#2f6fb2', '#1e8e63', '#7c5cd6', '#c0392b', '#2a9d8f', '#c77d1f', '#6d727b'];
function userSettings(uid) {
  return {
    theme: getUserSetting(uid, 'theme', 'light'),
    digits: getUserSetting(uid, 'digits', 'fa'),
    currency: getUserSetting(uid, 'currency', 'ریال'),
    language: getUserSetting(uid, 'language', 'fa'),
    dashboard: getUserSetting(uid, 'dashboard', null),
    sidebar_collapsed: getUserSetting(uid, 'sidebar_collapsed', 0),
    brand_color: getUserSetting(uid, 'brand_color', ''),
    ui_scale: getUserSetting(uid, 'ui_scale', 100),
  };
}
router.put('/api/settings', withBody((req, res, user) => {
  const body = req._body.json || {};
  for (const k of Object.keys(body)) {
    if (['theme', 'digits', 'currency', 'language', 'dashboard', 'sidebar_collapsed', 'brand_color', 'ui_scale'].includes(k)) {
      if (k === 'brand_color') {
        if (body[k] && !BRAND_COLORS.includes(String(body[k]))) continue;
      }
      if (k === 'ui_scale') {
        const n = Number(body[k]);
        if (![90, 100, 110, 120].includes(n)) continue;
        body[k] = n;
      }
      setUserSetting(user.id, k, body[k]);
    }
  }
  return userSettings(user.id);
}));
// ============ NOTIFICATIONS ============
router.get('/api/notifications', (req, res) => {
  try {
    const user = requireUser(req, res);
    const d = get();
    const rows = d.prepare('SELECT n.*, u.full_name AS creator_name FROM notifications n LEFT JOIN users u ON u.id=n.created_by WHERE n.user_id=? ORDER BY n.id DESC LIMIT 100').all(user.id);
    const unread = d.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(user.id).c;
    sendJson(res, 200, { items: rows, unread });
  } catch (e) { sendError(res, e); }
});
router.post('/api/notifications/read', withBody((req, res, user) => {
  const body = req._body.json || {};
  const d = get();
  if (body.all) d.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(ts(), user.id);
  else for (const id of body.ids || []) d.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND id=?').run(ts(), user.id, Number(id));
  return { ok: true };
}));
// ============ GLOBAL SEARCH ============
router.get('/api/search', (req, res) => {
  try {
    const user = requireUser(req, res);
    const q = String(req.url.split('?')[1] ? new URL(req.url, 'http://x').searchParams.get('q') || '' : '');
    if (!q.trim()) return sendJson(res, 200, { results: [] });
    const d = get();
    const results = [];
    let fts = [];
    try {
      const safe = normalizeFa(q).replace(/["']/g, ' ').trim();
      if (safe) fts = d.prepare(`SELECT m.kind, m.id, s.title FROM search_index s JOIN search_map m ON m.fts_rowid=s.rowid WHERE search_index MATCH ? ORDER BY rank LIMIT 12`).all(safe);
    } catch {}
    const seen = new Set();
    for (const r of fts) {
      if (seen.has(r.kind + ':' + r.id)) continue;
      seen.add(r.kind + ':' + r.id);
      results.push({ kind: r.kind, id: r.id, title: r.title });
      if (results.length >= 12) break;
    }
    if (results.length < 12) {
      const like = '%' + normalizeFa(q) + '%';
      const tables = [
        ['customer', 'customers', 'name'], ['lead', 'leads', 'company'], ['product', 'products', 'name'],
        ['order', 'orders', 'number'], ['invoice', 'invoices', 'number'], ['quote', 'quotes', 'number'],
        ['supplier', 'suppliers', 'name'], ['complaint', 'complaints', 'subject'], ['ticket', 'tickets', 'subject'],
        ['document', 'documents', 'title'], ['task', 'tasks', 'title'],
      ];
      for (const [kind, table, col] of tables) {
        if (results.length >= 12) break;
        const hasArch = d.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'archived_at');
        const arch = hasArch ? ' AND archived_at IS NULL' : '';
        const rows = d.prepare(`SELECT id, ${col} title FROM ${table} WHERE ${col} LIKE ?${arch} LIMIT 3`).all(like).concat(
          table === 'invoices' || table === 'orders' || table === 'quotes' ? d.prepare(`SELECT id, number title FROM ${table} WHERE number LIKE ? LIMIT 3`).all(like) : []
        );
        for (const r of rows) {
          if (!seen.has(kind + ':' + r.id)) { seen.add(kind + ':' + r.id); results.push({ kind, id: r.id, title: r.title }); if (results.length >= 12) break; }
        }
      }
    }
    sendJson(res, 200, { results });
  } catch (e) { sendError(res, e); }
});
// user alias resource (for dropdowns)
router.get('/api/r/user', (req, res) => {
  try {
    const user = requireUser(req, res);
    const d = get();
    const q = new URL(req.url, 'http://x').searchParams;
    const perPage = Math.min(parseInt(q.get('per_page')) || 200, 500);
    const items = d.prepare('SELECT id, full_name AS name, username, department, active FROM users WHERE active=1 AND archived_at IS NULL ORDER BY full_name LIMIT ?').all(perPage);
    sendJson(res, 200, { items, total: items.length, page: 1, pages: 1, per_page: perPage });
  } catch (e) { sendError(res, e); }
});
// ============ GENERIC CRUD ============
// Central guard: an unknown resource key must answer 404 "ماژول پیدا نشد". Several
// sub-resource routes (comments/tags/activities/attachments/items/import/bulk) read
// r.table / r.entity / r.lines straight away, so an unrecognised key used to throw an
// unhandled TypeError and surface as an opaque HTTP 500. Callers that already do their
// own `if (!r)` check keep working — the throw simply happens first with the same result.
function reg(key) {
  const r = R[key];
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
  return r;
}
router.get('/api/r/:res', (req, res) => {
  try {
    const user = requireUser(req, res);
    const u = new URL(req.url, 'http://x');
    const key = u.searchParams.get('resource') || req.params.res;
    const r = reg(key); if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
    const q = Object.fromEntries(u.searchParams.entries());
    sendJson(res, 200, generic.list(r, user, q));
  } catch (e) { sendError(res, e); }
});
router.get('/api/r/:res/export', (req, res) => {
  try {
    const user = requireUser(req, res);
    const r = reg(req.params.res);
    const u = new URL(req.url, 'http://x');
    const q = Object.fromEntries(u.searchParams.entries());
    const out = generic.exportResource(r, user, q, u.searchParams.get('format') || 'xlsx');
    if (out.inline) {
      res.writeHead(200, { 'Content-Type': out.mime || 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    } else {
      res.writeHead(200, { 'Content-Type': out.mime || (out.type === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.fileName)}`, 'Cache-Control': 'no-store' });
    }
    res.end(out.data);
  } catch (e) { sendError(res, e); }
});
router.get('/api/r/:res/:id', (req, res) => {
  try {
    const user = requireUser(req, res);
    const r = reg(req.params.res); if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
    sendJson(res, 200, { item: generic.show(r, user, parseId(req.params.id)) });
  } catch (e) { sendError(res, e); }
});
router.post('/api/r/:res', withBody(async (req, res, user) => {
  const r = reg(req.params.res); if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
  const data = req._body.json || {};
  // payments must go through the reconciliation engine (invoice balance, credit, loyalty)
  if (req.params.res === 'payment') { const rr = sales.addPayment(user, data); return { id: rr.payment_id, ok: true }; }
  if (req._body.files && req._body.files.length) await attachFiles(r, user, 0, req._body.files);
  const id = generic.create(r, user, data, { skipDupCheck: data._force === 1 });
  // Auto-start bound workflow instances (processes with trigger_event='created').
  // Workflow failures must never break the record creation itself.
  try { if (wf.MODULES.some(m => m.key === r.entity)) wf.startForEntity(user, r.entity, id); } catch {}
  return { id };
}));
router.put('/api/r/:res/:id', withBody(async (req, res, user) => {
  const r = reg(req.params.res); if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
  const data = req._body.json || {};
  const id = parseId(req.params.id);
  if (req._body.files && req._body.files.length) await attachFiles(r, user, id, req._body.files);
  generic.update(r, user, id, data);
  return { ok: true };
}));
router.post('/api/r/:res/:id/archive', (req, res) => { try { const user = requireUser(req, res); const r = reg(req.params.res); sendJson(res, 200, { ok: generic.archiveToggle(r, user, parseId(req.params.id)) }); } catch (e) { sendError(res, e); } });
router.post('/api/r/:res/:id/duplicate', (req, res) => { try { const user = requireUser(req, res); const r = reg(req.params.res); sendJson(res, 200, { id: generic.duplicate(r, user, parseId(req.params.id)) }); } catch (e) { sendError(res, e); } });
// ============ BULK EDIT (Section 4) — dedicated permission, allowlist, preview, atomic ============
router.post('/api/r/:res/bulk/preview', withBody((req, res, user) => {
  try {
    const b = req._body.json || {};
    sendJson(res, 200, bulk.bulkPreview(user, req.params.res, b.ids, b.field, b.value));
  } catch (e) { sendError(res, e); }
}));
router.post('/api/r/:res/bulk/apply', withBody((req, res, user) => {
  try {
    const b = req._body.json || {};
    sendJson(res, 200, bulk.bulkApply(user, ip(req), req.params.res, b.ids, b.field, b.value));
  } catch (e) { sendError(res, e); }
}));
// Bulk Delete (permission bulk_delete:delete; all-or-nothing; FK-safe)
router.post('/api/r/:res/bulk/delete-preview', withBody((req, res, user) => {
  try {
    const b = req._body.json || {};
    sendJson(res, 200, bulk.bulkDeletePreview(user, req.params.res, b.ids));
  } catch (e) { sendError(res, e); }
}));
router.post('/api/r/:res/bulk/delete', withBody((req, res, user) => {
  try {
    const b = req._body.json || {};
    sendJson(res, 200, bulk.bulkDeleteApply(user, ip(req), req.params.res, b.ids, b.confirm === true));
  } catch (e) { sendError(res, e); }
}));
// ============ E-SIGNATURES ============
router.get('/api/signature/me', (req, res) => {
  try { const user = requireUser(req, res); sendJson(res, 200, signatures.getMySignature(user)); } catch (e) { sendError(res, e); }
});
router.post('/api/signature/me', withBody((req, res, user) => {
  try {
    const files = req._body.files || [];
    sendJson(res, 200, signatures.uploadMySignature(user, files[0]));
  } catch (e) { sendError(res, e); }
}));
router.delete('/api/signature/me', (req, res) => {
  try { const user = requireUser(req, res); sendJson(res, 200, signatures.deleteMySignature(user)); } catch (e) { sendError(res, e); }
});
router.get('/api/signature/me/download', (req, res) => {
  try { const user = requireUser(req, res); signatures.downloadMySignature(user, res); } catch (e) { sendError(res, e); }
});
router.get('/api/admin/signatures', (req, res) => {
  try { const user = requireUser(req, res); sendJson(res, 200, signatures.listSignatureStatus(user)); } catch (e) { sendError(res, e); }
});
router.get('/api/admin/users/:id/signature', (req, res) => {
  try { const user = requireUser(req, res); sendJson(res, 200, signatures.getUserSignature(user, req.params.id)); } catch (e) { sendError(res, e); }
});
router.get('/api/admin/users/:id/signature/download', (req, res) => {
  try { const user = requireUser(req, res); signatures.adminDownload(user, req.params.id, res); } catch (e) { sendError(res, e); }
});
// ============ APPROVAL CHAINS (signature-based approvals) ============
router.get('/api/approval-chains', (req, res) => {
  try { const user = requireUser(req, res); sendJson(res, 200, approvalChains.listChains(user)); } catch (e) { sendError(res, e); }
});
router.put('/api/approval-chains/:docType', withBody((req, res, user) => {
  try {
    const b = req._body.json || {};
    sendJson(res, 200, approvalChains.saveChain(user, req.params.docType, b));
  } catch (e) { sendError(res, e); }
}));
router.get('/api/approvals/:docType/:docId', (req, res) => {
  try { const user = requireUser(req, res); sendJson(res, 200, approvalChains.getDocApprovals(user, req.params.docType, req.params.docId)); } catch (e) { sendError(res, e); }
});
router.post('/api/approvals/:docType/:docId/approve', withBody((req, res, user) => {
  try {
    const b = req._body.json || {};
    sendJson(res, 200, approvalChains.approveStage(user, req.params.docType, req.params.docId, b));
  } catch (e) { sendError(res, e); }
}));
router.post('/api/approvals/:docType/:docId/reject', withBody((req, res, user) => {
  try {
    const b = req._body.json || {};
    sendJson(res, 200, approvalChains.rejectStage(user, req.params.docType, req.params.docId, b));
  } catch (e) { sendError(res, e); }
}));
router.get('/api/approvals/:docType/:docId/signature/:approvalId', (req, res) => {
  try {
    const user = requireUser(req, res);
    const a = approvalChains.getApprovalSignatureRow(user, req.params.docType, req.params.docId, req.params.approvalId);
    const st = fs.statSync(a.signature_path);
    res.writeHead(200, {
      'Content-Type': a.signature_mime || 'image/png',
      'Content-Length': st.size,
      'Content-Disposition': 'inline; filename="signature-' + a.id + '"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
    fs.createReadStream(a.signature_path).pipe(res);
  } catch (e) { sendError(res, e); }
});
router.delete('/api/r/:res/:id', (req, res) => { try {
  const user = requireUser(req, res); const r = reg(req.params.res); const u = new URL(req.url, 'http://x'); const hard = u.searchParams.get('hard') === '1';
  // financial integrity: a payment linked to an invoice must be refunded, not deleted
  if (req.params.res === 'payment') {
    const p = get().prepare('SELECT id, invoice_id, status FROM payments WHERE id=?').get(parseId(req.params.id));
    if (p && p.invoice_id && p.status !== 'refunded') throw new HttpError(409, 'FINANCIAL_LOCK', 'این پرداخت به فاکتور متصل است. به‌جای حذف، از «برگشت پرداخت» استفاده کنید.');
  }
  generic.remove(r, user, parseId(req.params.id), hard); sendJson(res, 200, { ok: true });
} catch (e) { sendError(res, e); } });
// row-scope guard for sub-resource routes (comments/tags): the parent row
// must exist and be inside the caller's scope (IDOR protection)
function scopedRowAs(user, r, idStr, action) {
  const id = parseId(idStr);
  if (!id) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
  const row = get().prepare(`SELECT id FROM ${r.table} WHERE id=?`).get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
  generic.assertRowScope(r, user, row, action);
  return id;
}
router.get('/api/r/:res/:id/comments', (req, res) => { try { const user = requireUser(req, res); const r = reg(req.params.res); const id = scopedRowAs(user, r, req.params.id, 'view'); sendJson(res, 200, { items: generic.getComments(r.entity, id) }); } catch (e) { sendError(res, e); } });
router.post('/api/r/:res/:id/comments', withBody((req, res, user) => {
  const r = reg(req.params.res); const body = req._body.json || {};
  const id = scopedRowAs(user, r, req.params.id, 'view');
  return { id: generic.addComment(r.entity, id, user, body.body) };
}));
router.get('/api/r/:res/:id/tags', (req, res) => { try { const user = requireUser(req, res); const r = reg(req.params.res); const id = scopedRowAs(user, r, req.params.id, 'view'); sendJson(res, 200, { items: generic.getTags(r.entity, id) }); } catch (e) { sendError(res, e); } });
router.put('/api/r/:res/:id/tags', withBody((req, res, user) => {
  const r = reg(req.params.res); const body = req._body.json || {};
  const id = scopedRowAs(user, r, req.params.id, 'edit');
  generic.setTags(r.entity, id, user, body.tag_ids || []);
  return { ok: true };
}));
router.get('/api/r/:res/:id/activities', (req, res) => { try { const user = requireUser(req, res); const r = reg(req.params.res); const id = scopedRowAs(user, r, req.params.id, 'view'); sendJson(res, 200, { items: generic.getActivities(r.entity, id) }); } catch (e) { sendError(res, e); } });
router.get('/api/r/:res/:id/audit', (req, res) => { try { const user = requireUser(req, res); const r = reg(req.params.res); requirePermFor(user, 'audit_log', 'view'); sendJson(res, 200, { items: generic.getAuditTrail(r.entity, parseId(req.params.id)) }); } catch (e) { sendError(res, e); } });
router.get('/api/r/:res/:id/attachments', (req, res) => { try { const user = requireUser(req, res); const r = reg(req.params.res); const id = scopedRowAs(user, r, req.params.id, 'view'); sendJson(res, 200, { items: generic.getAttachments(r.entity, id) }); } catch (e) { sendError(res, e); } });
// lines (items) for docs
router.get('/api/r/:res/:id/items', (req, res) => {
  try {
    const user = requireUser(req, res);
    const r = reg(req.params.res);
    if (!r.lines) throw new HttpError(404, 'NOT_FOUND', 'این ماژول ردیف ندارد.');
    scopedRowAs(user, r, req.params.id, 'view');
    const d = get();
    const items = d.prepare(`SELECT * FROM ${r.lines.table} WHERE ${r.lines.refKey}=? ORDER BY id`).all(parseId(req.params.id));
    const prods = {};
    const ids = [...new Set(items.map(i => i.product_id).filter(Boolean))];
    if (ids.length) for (const p of d.prepare(`SELECT id, name FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)) prods[p.id] = p.name;
    for (const it of items) if (it.product_id && prods[it.product_id]) it.product_name = prods[it.product_id];
    sendJson(res, 200, { items });
  } catch (e) { sendError(res, e); }
});
router.put('/api/r/:res/:id/items', withBody((req, res, user) => {
  const r = reg(req.params.res);
  if (!r.lines) throw new HttpError(404, 'NOT_FOUND', 'این ماژول ردیف ندارد.');
  const body = req._body.json || {};
  const id = scopedRowAs(user, r, req.params.id, 'edit');
  // Proforma lines: server-side price enforcement (base from Price List,
  // override only with `price_override` permission + reason, audited).
  if (r.entity === 'quote') {
    return pricing.saveQuoteItems(user, ip(req), id, Array.isArray(body.items) ? body.items : []);
  }
  const d = get();
  const items = Array.isArray(body.items) ? body.items : [];
  const tx = d.transaction(() => {
    d.prepare(`DELETE FROM ${r.lines.table} WHERE ${r.lines.refKey}=?`).run(id);
    const cols = [r.lines.refKey, ...r.lines.fields.map(f => f.key)];
    const ins = d.prepare(`INSERT INTO ${r.lines.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    for (const it of items) {
      if (!it.name) continue;
      const pid = parseId(it.product_id);
      if (pid && !d.prepare('SELECT id FROM products WHERE id=?').get(pid)) throw new HttpError(422, 'VALIDATION', 'کالای انتخاب‌شده معتبر نیست.');
      const vals = r.lines.fields.map(f => {
        let v = it[f.key];
        // nullable line fields: empty = null (e.g. tax_rate: null = use document rate)
        if (f.key === 'tax_rate' && (v === undefined || v === null || v === '')) return null;
        if (f.type === 'number' || f.type === 'money') v = Number(toEnDigits(String(v || '0'))) || 0;
        if (f.type === 'ref') v = parseId(v) || null;
        return v ?? null;
      });
      ins.run(id, ...vals);
    }
  });
  tx();
  if (r.lines.recalc) sales.recalcDoc(r.lines.table, id, r.entity === 'invoice');
  addActivity(r.entity, id, user.id, 'items', 'ردیف‌ها به‌روزرسانی شد');
  audit(user, r.entity, id, 'items_update', null, { count: items.length });
  return { ok: true };
}));
// import
router.post('/api/r/:res/import', withBody(async (req, res, user) => {
  const r = reg(req.params.res);
  const files = req._body.files || [];
  if (!files.length) throw new HttpError(400, 'NO_FILE', 'فایلی دریافت نشد.');
  const preview = generic.importPreview(r, user, files[0].data, files[0].filename);
  return preview;
}));
router.post('/api/r/:res/import/commit', withBody((req, res, user) => {
  const r = reg(req.params.res);
  const body = req._body.json || {};
  return generic.importCommit(r, user, body.tempId);
}));
// ---- multi-format import wizard (XLS/XLSX/CSV/JSON/XML/TXT): parse → mapping → validate → commit ----
router.post('/api/r/:res/import/parse', withBody((req, res, user) => {
  try {
    const r = reg(req.params.res);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
    const files = req._body.files || [];
    if (!files.length) throw new HttpError(400, 'NO_FILE', 'فایلی دریافت نشد.');
    sendJson(res, 200, generic.importParse(r, user, files[0].data, files[0].filename));
  } catch (e) { sendError(res, e); }
}));
router.post('/api/r/:res/import/validate', withBody((req, res, user) => {
  try {
    const r = reg(req.params.res);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
    const b = req._body.json || {};
    sendJson(res, 200, generic.importValidate(r, user, b.tempId, b.mapping));
  } catch (e) { sendError(res, e); }
}));
router.post('/api/r/:res/import/commit-mapped', withBody((req, res, user) => {
  try {
    const r = reg(req.params.res);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
    const b = req._body.json || {};
    sendJson(res, 200, generic.importCommitMapped(r, user, b.tempId, b.mapping, b.dupPolicy));
  } catch (e) { sendError(res, e); }
}));
// Returns the resolved scope ('all' | 'department' | 'team' | 'own'). Existing callers
// ignore the return value; callers that need row scoping use it.
function requirePermFor(user, entity, action) { return require('./auth/auth').requirePerm(user, entity, action); }
function loyaltySend(res, out) {
  if (out.type === 'html') { res.writeHead(200, { 'Content-Type': out.mime, 'Content-Length': out.data.length }); return res.end(out.data); }
  res.writeHead(200, { 'Content-Type': out.mime, 'Content-Disposition': 'attachment; filename="' + out.fileName + '"', 'Content-Length': out.data.length });
  res.end(out.data);
}
// Stage 2 — file upload abuse prevention: block extensions that a browser could
// interpret as executable/scriptable content (stored-XSS / drive-by vectors).
// Files live under data/uploads (outside the web root) and are served only with
// an authenticated API route that forces attachment download + nosniff.
const BLOCKED_UPLOAD_EXT = new Set([
  '.html', '.htm', '.shtml', '.xhtml',
  '.js', '.mjs', '.cjs', '.jsx', '.ts',
  '.svg', '.xml', '.xsl', '.xslt',
  '.exe', '.msi', '.dll', '.so', '.dylib', '.bin', '.scr', '.com', '.pif', '.lnk',
  '.sh', '.bash', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.wsf', '.wsh', '.hta',
  '.jar', '.war', '.py', '.php', '.phtml', '.asp', '.aspx', '.jsp', '.cgi', '.pl', '.rb',
  '.htaccess', '.ini',
]);
// entityOverride lets standalone upload endpoints (POST /api/attachments) reuse this
// single guarded code path instead of duplicating the write logic without the blocklist.
async function attachFiles(r, user, entityId, files, entityOverride) {
  const d = get();
  const ids = [];
  const entityType = entityOverride || (r && r.entity) || null;
  for (const f of files) {
    const ext = path.extname(f.filename || '').toLowerCase();
    if (BLOCKED_UPLOAD_EXT.has(ext)) {
      console.error('[security] upload blocked: ext=' + ext + ' file=' + (f.filename || '') + ' user=' + (user && user.username));
      throw new HttpError(422, 'UPLOAD_BLOCKED', 'نوع این فایل مجاز نیست.');
    }
    const dir = path.join(DATA_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext.slice(0, 12);
    const dest = path.join(dir, name);
    fs.writeFileSync(dest, f.data);
    if (entityId) {
      const info = d.prepare('INSERT INTO attachments(entity_type, entity_id, user_id, file_name, file_path, mime, size, created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(entityType, entityId, user.id, f.filename, dest, f.mime, f.data.length, ts());
      ids.push(Number(info.lastInsertRowid));
    }
  }
  return ids;
}
// ============ DASHBOARD ============
router.get('/api/dashboard', (req, res) => {
  try {
    const user = requireUser(req, res);
    const u = new URL(req.url, 'http://x');
    const role = u.searchParams.get('role');
    let data;
    if (role) {
      data = dash.roleData(role);
      if (role === 'ceo' || role === 'super_admin') data.summary = ai.executiveSummary(user);
    } else {
      const roles = get().prepare(`SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?`).all(user.id).map(x => x.name);
      const first = ['ceo', 'sales_manager', 'quality_manager', 'warehouse_manager', 'lab_manager', 'finance_manager'].find(x => roles.includes(x)) || 'sales';
      data = dash.roleData(first);
      if (roles.includes('ceo') || roles.includes('super_admin')) data.summary = ai.executiveSummary(user);
    }
    data.myTasks = get().prepare(`SELECT * FROM tasks WHERE assignee_id=? AND status IN ('open','in_progress') ORDER BY due_at IS NULL, due_at LIMIT 10`).all(user.id);
    data.followups = get().prepare(`SELECT * FROM followups WHERE user_id=? AND status='pending' ORDER BY due_at LIMIT 10`).all(user.id);
    // Section 9: optional period filter for KPI analytics (real DB only)
    const pf = u.searchParams.get('from'), pt = u.searchParams.get('to');
    if (pf && pt) data.period = dash.periodKpi(pf, pt);
    sendJson(res, 200, data);
  } catch (e) { sendError(res, e); }
});
// ============ SALES FLOW ============
router.get('/api/pipeline/:id/board', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.board(parseId(req.params.id), user)); } catch (e) { sendError(res, e); } });
router.post('/api/pipeline/move', withBody((req, res, user) => {
  const b = req._body.json || {};
  return sales.moveOpp(user, parseId(b.opportunity_id), parseId(b.stage_id));
}));
// ============ PRICE LIST ITEMS ============
function priceListGuard(user, lid) {
  requirePermFor(user, 'price_list', 'edit');
  const d = get();
  const pl = d.prepare('SELECT * FROM price_lists WHERE id=?').get(lid);
  if (!pl) throw new HttpError(404, 'NOT_FOUND', 'لیست قیمت پیدا نشد.');
  return { d, pl };
}
router.get('/api/pricelist/:id/items', (req, res) => { try {
  const user = requireUser(req, res);
  const d = get(); const lid = parseId(req.params.id);
  if (!d.prepare('SELECT id FROM price_lists WHERE id=?').get(lid)) throw new HttpError(404, 'NOT_FOUND', 'لیست قیمت پیدا نشد.');
  const items = d.prepare(`SELECT pli.*, p.name AS product_name, p.unit AS unit, p.code AS product_code, cu.name AS customer_name FROM price_list_items pli LEFT JOIN products p ON p.id = pli.product_id LEFT JOIN customers cu ON cu.id = pli.customer_id WHERE pli.price_list_id = ? ORDER BY cu.name, p.name`).all(lid);
  sendJson(res, 200, { items });
} catch (e) { sendError(res, e); } });
function upsertPriceItem(d, lid, b) {
  const pid = Number(b.product_id); const pr = Number(b.price);
  if (!pid || isNaN(pr) || pr <= 0) throw new HttpError(422, 'VALIDATION', 'قیمت معتبر نیست.');
  if (!d.prepare('SELECT id FROM products WHERE id=?').get(pid)) throw new HttpError(404, 'NOT_FOUND', 'کالا پیدا نشد.');
  const custId = b.customer_id ? Number(b.customer_id) : null;
  if (custId && !d.prepare('SELECT id FROM customers WHERE id=?').get(custId)) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  const disc = Number(b.discount_pct) || 0;
  if (disc < 0 || disc > 100) throw new HttpError(422, 'VALIDATION', 'درصد تخفیف نامعتبر است.');
  const tax = Number(b.tax_rate) || 0;
  if (tax < 0 || tax > 100) throw new HttpError(422, 'VALIDATION', 'درصد مالیات نامعتبر است.');
  const mq = b.min_qty ? Number(b.min_qty) : 0;
  const xq = b.max_qty ? Number(b.max_qty) : null;
  // Item 5: payment stage (cash / 3_month / 6_month / custom) - each stage an independent price
  const stage = ['cash', '3_month', '6_month', 'custom'].includes(b.payment_stage) ? b.payment_stage : 'cash';
  const ex = custId
    ? d.prepare('SELECT id FROM price_list_items WHERE price_list_id=? AND product_id=? AND customer_id=? AND payment_stage=?').get(lid, pid, custId, stage)
    : d.prepare('SELECT id FROM price_list_items WHERE price_list_id=? AND product_id=? AND (customer_id IS NULL OR customer_id=0) AND payment_stage=?').get(lid, pid, stage);
  if (ex) d.prepare('UPDATE price_list_items SET price=?, min_qty=?, max_qty=?, discount_pct=?, tax_rate=?, valid_from=?, valid_until=?, payment_stage=? WHERE id=?')
    .run(pr, mq, xq, disc, tax, b.valid_from || null, b.valid_until || null, stage, ex.id);
  else d.prepare('INSERT INTO price_list_items(price_list_id, product_id, customer_id, price, min_qty, max_qty, discount_pct, tax_rate, valid_from, valid_until, payment_stage) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(lid, pid, custId, pr, mq, xq, disc, tax, b.valid_from || null, b.valid_until || null, stage);
}
router.post('/api/pricelist/:id/item', withBody((req, res, user) => { try {
  const b = req._body.json || {}; const { d } = priceListGuard(user, parseId(req.params.id));
  upsertPriceItem(d, parseId(req.params.id), b);
  sendJson(res, 200, { ok: true });
} catch (e) { sendError(res, e); } }));
router.post('/api/pricelist/:id/items', withBody((req, res, user) => { try {
  const b = req._body.json || {}; const lid = parseId(req.params.id); const { d } = priceListGuard(user, lid);
  const list = Array.isArray(b.items) ? b.items : [];
  let n = 0;
  d.transaction(() => { for (const it of list) { if (it && it.product_id) { upsertPriceItem(d, lid, it); n++; } } })();
  sendJson(res, 200, { ok: true, saved: n });
} catch (e) { sendError(res, e); } }));
router.delete('/api/pricelist/:id/item/:productId', (req, res) => { try {
  const user = requireUser(req, res); const lid = parseId(req.params.id);
  requirePermFor(user, 'price_list', 'edit');
  get().prepare('DELETE FROM price_list_items WHERE price_list_id=? AND product_id=?').run(lid, parseId(req.params.productId));
  sendJson(res, 200, { ok: true });
} catch (e) { sendError(res, e); } });
router.post('/api/pricelist/:id/duplicate', (req, res) => { try {
  const user = requireUser(req, res); requirePermFor(user, 'price_list', 'create');
  const d = get(); const lid = parseId(req.params.id);
  const pl = d.prepare('SELECT * FROM price_lists WHERE id=?').get(lid);
  if (!pl) throw new HttpError(404, 'NOT_FOUND', 'لیست قیمت پیدا نشد.');
  const name = (req._body && req._body.json && req._body.json.name) || (pl.name + ' (کپی)');
  const info = d.prepare('INSERT INTO price_lists(name, currency, active, valid_from, valid_until, created_at) VALUES(?,?,?,?,?,?)')
    .run(name, pl.currency, pl.active, pl.valid_from || null, pl.valid_until || null, ts());
  const nid = Number(info.lastInsertRowid);
  d.prepare('INSERT INTO price_list_items(price_list_id, product_id, customer_id, price, min_qty, max_qty, discount_pct, tax_rate, valid_from, valid_until) SELECT ?, product_id, customer_id, price, min_qty, max_qty, discount_pct, tax_rate, valid_from, valid_until FROM price_list_items WHERE price_list_id=?').run(nid, lid);
  audit(user, 'price_list', nid, 'duplicate', null, { from: lid });
  sendJson(res, 200, { id: nid });
} catch (e) { sendError(res, e); } });
router.post('/api/quotes/:id/to-order', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.quoteToOrder(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/orders/:id/to-invoice', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.orderToInvoice(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/payments', withBody((req, res, user) => { const b = req._body.json || {}; return sales.addPayment(user, b); }));
router.post('/api/payments/:id/refund', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.refundPayment(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
// price suggestion (per-customer price resolution)
router.get('/api/quotes/price-suggest', (req, res) => { try {
  const user = requireUser(req, res);
  const u = new URL(req.url, 'http://x');
  const q = { product_id: u.searchParams.get('product_id'), customer_id: u.searchParams.get('customer_id'), price_list_id: u.searchParams.get('price_list_id'), payment_stage: u.searchParams.get('payment_stage') };
  if (!q.product_id) throw new HttpError(422, 'VALIDATION', 'product_id الزامی است.');
  sendJson(res, 200, sales.suggestPrice(user, q));
} catch (e) { sendError(res, e); } });
// customer 360 finance
router.get('/api/customers/:id/finance', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.customerFinance(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
// commission lifecycle
router.post('/api/commissions/:id/approve', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.approveCommission(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/commissions/:id/pay', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.payCommission(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/commissions/:id/cancel', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.cancelCommission(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
// sales & finance reports
router.get('/api/salesreports/kinds', (req, res) => { try { requireUser(req, res); sendJson(res, 200, { kinds: Object.entries(sales.SALES_REPORTS).map(([k, v]) => ({ key: k, title: v.title, cols: v.cols })) }); } catch (e) { sendError(res, e); } });
router.get('/api/salesreports/:kind', (req, res) => { try {
  const user = requireUser(req, res);
  const u = new URL(req.url, 'http://x');
  const q = {}; for (const [k, v] of u.searchParams.entries()) q[k] = v;
  sendJson(res, 200, sales.salesReport(user, req.params.kind, q));
} catch (e) { sendError(res, e); } });
router.get('/api/salesreports/:kind/export', (req, res) => { try {
  const user = requireUser(req, res);
  const u = new URL(req.url, 'http://x');
  const q = {}; for (const [k, v] of u.searchParams.entries()) q[k] = v;
  const out = sales.salesReportExport(user, req.params.kind, q, u.searchParams.get('format') || 'xlsx');
  const isHtml = out.type === 'html';
  res.writeHead(200, { 'Content-Type': out.type === 'csv' ? 'text/csv; charset=utf-8' : out.type === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/html; charset=utf-8', 'Content-Disposition': isHtml ? 'inline; filename="' + encodeURIComponent(out.fileName) + '"' : `attachment; filename="${encodeURIComponent(out.fileName)}"`, 'Cache-Control': 'no-store' });
  res.end(out.data);
} catch (e) { sendError(res, e); } });
router.get('/api/commissions', (req, res) => {
  try {
    const user = requireUser(req, res);
    // Broken access control: this endpoint only called requireUser(), so ANY authenticated
    // user (lab, support, rep, marketing, …) could read every salesperson's commission rows
    // and all commission rules. Its siblings already gate on `commission` — export uses
    // 'export', the writes use 'edit'. Gate the read on 'view' and honour the configured
    // row scope (the `finance` role is scoped 'own'), same semantics as the generic CRUD.
    const scope = requirePermFor(user, 'commission', 'view');
    const d = get();
    const rules = d.prepare('SELECT * FROM commission_rules ORDER BY id').all();
    let sql = 'SELECT c.*, u.full_name FROM commissions c JOIN users u ON u.id=c.user_id';
    const params = [];
    if (scope !== 'all') { sql += ' WHERE c.user_id = ?'; params.push(user.id); }
    sql += ' ORDER BY c.period DESC, c.user_id';
    const rows = d.prepare(sql).all(...params);
    sendJson(res, 200, { rules, rows });
  } catch (e) { sendError(res, e); }
});
router.post('/api/commission-rules', withBody((req, res, user) => {
  requirePermFor(user, 'commission', 'edit');
  const b = req._body.json || {};
  const d = get();
  if (!b.name || !Number(b.pct)) throw new HttpError(422, 'VALIDATION', 'نام و درصد قانون الزامی است.');
  const basisType = ['percent_sales', 'percent_collected', 'product', 'customer', 'tier', 'margin'].includes(b.basis_type) ? b.basis_type : 'percent_sales';
  if (basisType === 'product' && !b.product_id) throw new HttpError(422, 'VALIDATION', 'قانون «بر اساس محصول» باید محصول داشته باشد.');
  if (basisType === 'customer' && !b.customer_id) throw new HttpError(422, 'VALIDATION', 'قانون «بر اساس مشتری» باید مشتری داشته باشد.');
  const info = d.prepare('INSERT INTO commission_rules(name, basis, basis_type, pct, product_id, customer_id, salesperson_id, min_amount, max_amount, monthly_target, target_bonus_pct, valid_from, valid_until, active, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.basis || (basisType === 'margin' ? 'margin' : 'amount'), basisType, Number(b.pct), b.product_id || null, b.customer_id || null, b.salesperson_id || null, Number(b.min_amount) || 0, b.max_amount ? Number(b.max_amount) : null, b.monthly_target || 0, b.target_bonus_pct || 0, b.valid_from || null, b.valid_until || null, b.active === 0 ? 0 : 1, ts());
  audit(user, 'commission_rule', info.lastInsertRowid, 'create', null, b);
  return { id: Number(info.lastInsertRowid) };
}));
router.put('/api/commission-rules/:id', withBody((req, res, user) => {
  requirePermFor(user, 'commission', 'edit');
  const b = req._body.json || {};
  const d = get();
  const rid = parseId(req.params.id);
  const old = d.prepare('SELECT * FROM commission_rules WHERE id=?').get(rid);
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'قانون پیدا نشد.');
  const name = b.name !== undefined ? b.name : old.name;
  if (!name) throw new HttpError(422, 'VALIDATION', 'نام قانون الزامی است.');
  const basisType = b.basis_type !== undefined && ['percent_sales', 'percent_collected', 'product', 'customer', 'tier', 'margin'].includes(b.basis_type) ? b.basis_type : (old.basis_type || 'percent_sales');
  const num = (v, def) => v !== undefined && v !== null && v !== '' ? Number(v) || 0 : def;
  const nll = (v, def) => v !== undefined ? (v ? Number(v) : null) : def;
  d.prepare('UPDATE commission_rules SET name=?, basis=?, basis_type=?, pct=?, product_id=?, customer_id=?, salesperson_id=?, min_amount=?, max_amount=?, monthly_target=?, target_bonus_pct=?, valid_from=?, valid_until=?, active=? WHERE id=?')
    .run(name, b.basis !== undefined ? b.basis : (old.basis || 'amount'), basisType, num(b.pct, old.pct || 0), b.product_id !== undefined ? (b.product_id || null) : old.product_id, b.customer_id !== undefined ? (b.customer_id || null) : old.customer_id, b.salesperson_id !== undefined ? (b.salesperson_id || null) : old.salesperson_id, num(b.min_amount, old.min_amount || 0), nll(b.max_amount, old.max_amount), num(b.monthly_target, old.monthly_target || 0), num(b.target_bonus_pct, old.target_bonus_pct || 0), b.valid_from !== undefined ? (b.valid_from || null) : old.valid_from, b.valid_until !== undefined ? (b.valid_until || null) : old.valid_until, b.active === 0 ? 0 : (old.active === 0 ? 0 : 1), rid);
  audit(user, 'commission_rule', rid, 'update', old, { ...b, name });
  return { ok: true };
}));
router.delete('/api/commission-rules/:id', (req, res) => { try { const user = requireUser(req, res); requirePermFor(user, 'commission', 'edit'); get().prepare('DELETE FROM commission_rules WHERE id=?').run(parseId(req.params.id)); sendJson(res, 200, { ok: true }); } catch (e) { sendError(res, e); } });
router.post('/api/commissions/calc', withBody((req, res, user) => { const b = req._body.json || {}; return sales.calcCommissions(user, b.period); }));
router.get('/api/commissions/export', (req, res) => { try {
  const user = requireUser(req, res);
  requirePermFor(user, 'commission', 'export');
  const d = get();
  const u = new URL(req.url, 'http://x');
  const period = u.searchParams.get('period') || '';
  const status = u.searchParams.get('status') || '';
  const fmt = u.searchParams.get('format') || 'xlsx';
  let csql = 'SELECT c.*, u.full_name, i.number invoice_number, p.number payment_number, cu.name customer_name, r.name rule_name FROM commissions c JOIN users u ON u.id=c.user_id LEFT JOIN invoices i ON i.id=c.invoice_id LEFT JOIN payments p ON p.id=c.payment_id LEFT JOIN customers cu ON cu.id=c.customer_id LEFT JOIN commission_rules r ON r.id=c.rule_id WHERE 1=1';
  const cparams = [];
  if (period) { csql += ' AND c.period=?'; cparams.push(period); }
  if (status) { csql += ' AND c.status=?'; cparams.push(status); }
  csql += ' ORDER BY c.id DESC';
  const rows = d.prepare(csql).all(...cparams);
  const BASIS_FA = { percent_sales: 'درصدی از فروش', percent_collected: 'درصدی از وصول', product: 'بر اساس محصول', customer: 'بر اساس مشتری', tier: 'پلکانی', margin: 'حاشیه سود' };
  const ST_FA = { calculated: 'در انتظار تأیید', approved: 'تأییدشده', paid: 'پرداخت‌شده', cancelled: 'لغوشده', pending: 'در انتظار' };
  const head = ['کارشناس', 'دوره', 'قانون', 'مبنای محاسبه', 'رکورد مرجع', 'مشتری', 'مبلغ مبنای محاسبه', 'درصد', 'پورسانت', 'وضعیت'];
  const dataRows = rows.map(r => [r.full_name, r.period, r.rule_name || '—', BASIS_FA[r.basis] || r.basis || '—', r.invoice_number ? 'فاکتور ' + r.invoice_number : (r.payment_number ? 'پرداخت ' + r.payment_number : '—'), r.customer_name || '—', r.base, (r.rate !== null ? r.rate + '٪' : '—'), r.amount, ST_FA[r.status] || r.status]);
  const { fmtDateLong, jalExport } = require('./lib/util');
  const co = printMod.company();
  const dateFa = fmtDateLong(ts());
  if (fmt === 'csv') {
    const csv = '\uFEFF' + [head, ...dataRows].map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="commissions.csv"' });
    return res.end(csv);
  }
  if (fmt === 'html') {
    const body = `${printMod.companyHeadHtml(co)}<h1>گزارش پورسانت فروش</h1><div class="meta"><div><b>دوره:</b><span>${period || 'همه'}</span></div><div><b>تاریخ تهیه:</b><span>${dateFa}</span></div><div><b>تهیه‌کننده:</b><span>${user.full_name}</span></div></div><table class="items"><thead><tr>${head.map(h => '<th>' + h + '</th>').join('')}</tr></thead><tbody>${dataRows.map(r => '<tr>' + r.map(x => '<td>' + (typeof x === 'number' ? x.toLocaleString('fa-IR') : x) + '</td>').join('') + '</tr>').join('')}</tbody></table><div class="footer"><div class="sign"><div class="line"></div>تهیه‌کننده</div><div class="sign"><div class="line"></div>تأیید مدیریت</div></div>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(printMod.baseHtml('گزارش پورسانت', body, co));
  }
  const XLSX = require('xlsx');
  const aoa = [['گزارش پورسانت فروش'], ['شرکت: ' + co.name], ['تهیه‌شده: ' + dateFa], [], head, ...dataRows, [], ['جمع', rows.reduce((a, r) => a + r.amount, 0)]];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = head.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'پورسانت');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="commissions.xlsx"' });
  res.end(buf);
} catch (e) { sendError(res, e); } });
router.post('/api/stock/move', withBody((req, res, user) => { const b = req._body.json || {}; return sales.stockMove(user, b); }));
router.post('/api/lab/:id/report', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, sales.generateLabReport(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/calendar', (req, res) => {
  try {
    const user = requireUser(req, res);
    const u = new URL(req.url, 'http://x');
    sendJson(res, 200, sales.calendarEvents(user, u.searchParams.get('from'), u.searchParams.get('to')));
  } catch (e) { sendError(res, e); }
});
// ============ Calendar & Planning (first-class) ============
const calQ = (req) => { const u = new URL(req.url, 'http://x'); const q = {}; for (const [k, v] of u.searchParams.entries()) q[k] = v; return q; };
router.get('/api/calendar/events', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.listEvents(user, calQ(req))); } catch (e) { sendError(res, e); } });
router.post('/api/calendar/events', withBody((req, res, user) => { try { sendJson(res, 201, calmod.createEvent(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.get('/api/calendar/events/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.getEvent(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.put('/api/calendar/events/:id', withBody((req, res, user) => { try { sendJson(res, 200, calmod.updateEvent(user, parseId(req.params.id), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.delete('/api/calendar/events/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.deleteEvent(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/calendar/events/:id/move', withBody((req, res, user) => { try { sendJson(res, 200, calmod.moveEvent(user, parseId(req.params.id), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/calendar/events/:id/done', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, calmod.markEvent(user, parseId(req.params.id), b.done !== false)); } catch (e) { sendError(res, e); } }));
// ============ Meetings (rich module: composed detail + task/follow-up generation + save w/ customer linkage) ============
router.get('/api/r/meeting/:id/full', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, meetings.detail(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/meetings', withBody((req, res, user) => { try { sendJson(res, 201, meetings.save(user, null, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.put('/api/meetings/:id', withBody((req, res, user) => { try { sendJson(res, 200, meetings.save(user, parseId(req.params.id), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/r/meeting/:id/tasks', withBody((req, res, user) => { try { sendJson(res, 201, meetings.addTask(user, parseId(req.params.id), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/r/meeting/:id/followups', withBody((req, res, user) => { try { sendJson(res, 201, meetings.addFollowup(user, parseId(req.params.id), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.get('/api/calendar/today', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.todayPlan(user)); } catch (e) { sendError(res, e); } });
router.get('/api/calendar/upcoming', (req, res) => { try { const user = requireUser(req, res); const q = calQ(req); sendJson(res, 200, calmod.upcoming(user, q.range || 'this_week')); } catch (e) { sendError(res, e); } });
router.get('/api/calendar/overdue', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.overdueFor(user)); } catch (e) { sendError(res, e); } });
router.get('/api/calendar/holidays', (req, res) => { try { const user = requireUser(req, res); const q = calQ(req); if (q.raw === '1' || q.raw === 'true') { sendJson(res, 200, calmod.rawHolidays(user)); return; } sendJson(res, 200, { holidays: calmod.holidaysFor(user, q.from || new Date().toISOString(), q.to || new Date(Date.now() + 366 * 864e5).toISOString()) }); } catch (e) { sendError(res, e); } });
router.put('/api/calendar/holidays', withBody((req, res, user) => { try { sendJson(res, 200, calmod.saveHolidays(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.get('/api/calendar/teams', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.teams(user)); } catch (e) { sendError(res, e); } });
router.get('/api/calendar/colors', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.colorSettings(user)); } catch (e) { sendError(res, e); } });
router.put('/api/calendar/colors', withBody((req, res, user) => { try { sendJson(res, 200, calmod.saveColorSettings(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/calendar/ai', withBody(async (req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, await calmod.calendarAi(user, b.query || '')); } catch (e) { sendError(res, e); } }));
router.get('/api/calendar/report', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, calmod.report(user, calQ(req))); } catch (e) { sendError(res, e); } });
router.get('/api/calendar/report/export', (req, res) => { try {
    const user = requireUser(req, res);
    const q = calQ(req);
    const out = calmod.reportExport(user, q, q.format || 'xlsx');
    res.writeHead(200, { 'Content-Type': out.type === 'csv' ? 'text/csv; charset=utf-8' : out.type === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : out.type === 'json' ? 'application/json' : 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${encodeURIComponent(out.fileName)}"`, 'Cache-Control': 'no-store' });
    res.end(out.data);
  } catch (e) { sendError(res, e); } });
// lead conversion
router.post('/api/leads/:id/convert', withBody((req, res, user) => {
  const b = req._body.json || {};
  const d = get();
  const lead = d.prepare('SELECT * FROM leads WHERE id=?').get(parseId(req.params.id));
  if (!lead) throw new HttpError(404, 'NOT_FOUND', 'سرنخ پیدا نشد.');
  if (lead.customer_id) {
    if (lead.status === 'converted') return { customer_id: lead.customer_id, opportunity_id: null, already: true };
    // customer already linked (Master Data) — still create the opportunity for traceability
    const d1 = get();
    const pipes = d1.prepare('SELECT id FROM pipelines WHERE is_default=1 LIMIT 1').all();
    const pipe1 = pipes[0] || d1.prepare('SELECT id FROM pipelines LIMIT 1').get();
    const stage1 = pipe1 ? d1.prepare('SELECT id FROM pipeline_stages WHERE pipeline_id=? ORDER BY position LIMIT 1').get(pipe1.id) : null;
    let oppId1 = null;
    if (pipe1 && stage1) {
      oppId1 = generic.create(R.opportunity, user, { title: (lead.product_interest || 'فرصت از سرنخ') + ' — ' + (lead.company || lead.contact_name || ''), customer_id: lead.customer_id, amount: lead.estimated_value, probability: lead.probability, pipeline_id: pipe1.id, stage_id: stage1.id, salesperson_id: lead.salesperson_id, notes: 'تبدیل‌شده از سرنخ ' + (lead.number || '') }, { skipDupCheck: true });
    }
    d1.prepare("UPDATE leads SET status='converted' WHERE id=? AND status!='converted'").run(lead.id);
    addActivity('customer', lead.customer_id, user.id, 'convert', `فرصت از سرنخ ${lead.number || ''} ایجاد شد`);
    audit(user, 'lead', lead.id, 'convert', null, { customer: lead.customer_id, opportunity: oppId1 }, '');
    return { customer_id: lead.customer_id, opportunity_id: oppId1, already: true };
  }
  const custData = { type: b.type || 'company', name: b.name || lead.company || lead.contact_name || 'مشتری جدید', phone: lead.phone, mobile: lead.mobile || lead.phone, email: lead.email, address: b.address || '', industry: b.industry || '', category_id: b.category_id || null };
  // Customer Master rule: never create a duplicate — use dup-check, attach to existing on conflict
  let custId;
  try {
    custId = generic.create(R.customer, user, custData);
  } catch (e) {
    if (e.code === 'DUPLICATE' && e.data && Array.isArray(e.data.duplicates) && e.data.duplicates.length) {
      custId = e.data.duplicates[0].id;
    } else throw e;
  }
  const d2 = get();
  d2.prepare("UPDATE leads SET status='converted', customer_id=? WHERE id=?").run(custId, lead.id);
  let oppId = null;
  const pipelines = d2.prepare('SELECT id FROM pipelines WHERE is_default=1 LIMIT 1').all();
  const pipe = pipelines[0] || d2.prepare('SELECT id FROM pipelines LIMIT 1').get();
  const stage = pipe ? d2.prepare('SELECT id FROM pipeline_stages WHERE pipeline_id=? ORDER BY position LIMIT 1').get(pipe.id) : null;
  if (pipe && stage) {
    oppId = generic.create(R.opportunity, user, { title: (lead.product_interest || 'فرصت از سرنخ') + ' — ' + (lead.company || lead.contact_name || ''), customer_id: custId, amount: lead.estimated_value, probability: lead.probability, pipeline_id: pipe.id, stage_id: stage.id, salesperson_id: lead.salesperson_id, notes: 'تبدیل‌شده از سرنخ ' + (lead.number || '') }, { skipDupCheck: true });
  }
  addActivity('customer', custId, user.id, 'convert', `از سرنخ ${lead.number || ''} ایجاد شد`);
  audit(user, 'lead', lead.id, 'convert', null, { customer: custId, opportunity: oppId });
  return { customer_id: custId, opportunity_id: oppId };
}));
// customer contacts
// global contacts list (searchable across all customers — for the Contacts module)
router.get('/api/contacts', (req, res) => {
  try {
    const user = requireUser(req, res);
    requirePermFor(user, 'customer', 'view');
    const u = new URL(req.url, 'http://x');
    const q = u.searchParams.get('q') || '';
    const perPage = Math.min(parseInt(u.searchParams.get('per_page') || '50', 10) || 50, 200);
    const page = Math.max(parseInt(u.searchParams.get('page') || '1', 10) || 1, 1);
    const d = get();
    const term = '%' + likeEscape(normalizeFa(q).replace(/\s+/g, ' ')) + '%';
    const where = q ? 'WHERE (cct.name LIKE ? OR cct.mobile LIKE ? OR cct.phone LIKE ? OR cct.email LIKE ? OR c.name LIKE ?)' : '';
    const args = q ? [term, term, term, term, term] : [];
    const total = d.prepare(`SELECT COUNT(*) n FROM customer_contacts cct JOIN customers c ON c.id=cct.customer_id ${where}`).get(...args).n;
    const items = d.prepare(`SELECT cct.*, c.name AS customer_name FROM customer_contacts cct JOIN customers c ON c.id=cct.customer_id ${where} ORDER BY cct.is_primary DESC, cct.id LIMIT ? OFFSET ?`).all(...args, perPage, (page - 1) * perPage);
    sendJson(res, 200, { items, total, page, per_page: perPage });
  } catch (e) { sendError(res, e); }
});
router.get('/api/customers/:id/contacts', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, { items: get().prepare('SELECT * FROM customer_contacts WHERE customer_id=? ORDER BY is_primary DESC, id').all(parseId(req.params.id)) }); } catch (e) { sendError(res, e); } });
router.post('/api/customers/:id/contacts', withBody((req, res, user) => {
  const b = req._body.json || {};
  requirePermFor(user, 'customer', 'edit');
  const d = get();
  const cust = d.prepare('SELECT id, name FROM customers WHERE id=? AND archived_at IS NULL').get(parseId(req.params.id));
  if (!cust) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  if (!String(b.name || '').trim()) throw new HttpError(422, 'VALIDATION', 'نام مخاطب الزامی است.');
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email))) throw new HttpError(422, 'VALIDATION', 'ایمیل نامعتبر است.');
  // duplicate detection: same customer + same mobile/phone/email
  const mob = String(b.mobile || '').replace(/\D/g, ''), ph = String(b.phone || '').replace(/\D/g, ''), em = String(b.email || '').trim().toLowerCase();
  const dups = d.prepare('SELECT id, name, mobile, phone, email FROM customer_contacts WHERE customer_id=?').all(cust.id)
    .filter(c => (mob && mob.length >= 6 && String(c.mobile || '').replace(/\D/g, '') === mob) || (ph && ph.length >= 6 && String(c.phone || '').replace(/\D/g, '') === ph) || (em && String(c.email || '').trim().toLowerCase() === em));
  if (dups.length && !b._force) throw new HttpError(409, 'DUPLICATE', 'مخاطب مشابهی برای این مشتری وجود دارد.', { duplicates: dups });
  const info = d.prepare('INSERT INTO customer_contacts(customer_id, name, position, phone, mobile, email, province, city, industrial_city, address, notes, status, is_primary, source, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(cust.id, String(b.name).trim(), String(b.position || ''), String(b.phone || ''), String(b.mobile || ''), String(b.email || ''), String(b.province || ''), String(b.city || ''), String(b.industrial_city || ''), String(b.address || ''), String(b.notes || ''), String(b.status || 'active'), b.is_primary ? 1 : 0, b.source ? String(b.source).slice(0, 60) : null, ts());
  audit(user, 'customer', cust.id, 'contact_create', null, { contact_id: Number(info.lastInsertRowid), name: String(b.name).trim() }, '');
  return { id: Number(info.lastInsertRowid) };
}));
router.get('/api/customers/:id/contacts/:cid', (req, res) => { try {
  const user = requireUser(req, res);
  const row = get().prepare('SELECT * FROM customer_contacts WHERE id=? AND customer_id=?').get(parseId(req.params.cid), parseId(req.params.id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'مخاطب پیدا نشد.');
  sendJson(res, 200, { item: row });
} catch (e) { sendError(res, e); } });
router.put('/api/customers/:id/contacts/:cid', withBody((req, res, user) => { try {
  requirePermFor(user, 'customer', 'edit');
  const d = get(); const b = req._body.json || {};
  const row = d.prepare('SELECT * FROM customer_contacts WHERE id=? AND customer_id=?').get(parseId(req.params.cid), parseId(req.params.id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'مخاطب پیدا نشد.');
  d.prepare('UPDATE customer_contacts SET name=?, position=?, phone=?, mobile=?, email=?, province=?, city=?, industrial_city=?, address=?, notes=?, status=?, is_primary=?, updated_at=? WHERE id=?').run(
    b.name !== undefined ? String(b.name || '').trim() : row.name,
    b.position !== undefined ? String(b.position || '') : row.position,
    b.phone !== undefined ? String(b.phone || '') : row.phone,
    b.mobile !== undefined ? String(b.mobile || '') : row.mobile,
    b.email !== undefined ? String(b.email || '') : row.email,
    b.province !== undefined ? String(b.province || '') : (row.province || ''),
    b.city !== undefined ? String(b.city || '') : (row.city || ''),
    b.industrial_city !== undefined ? String(b.industrial_city || '') : (row.industrial_city || ''),
    b.address !== undefined ? String(b.address || '') : (row.address || ''),
    b.notes !== undefined ? String(b.notes || '') : (row.notes || ''),
    b.status !== undefined ? String(b.status || 'active') : (row.status || 'active'),
    b.is_primary !== undefined ? (b.is_primary ? 1 : 0) : row.is_primary,
    ts(),
    row.id);
  if (b.is_primary) d.prepare('UPDATE customer_contacts SET is_primary=0 WHERE customer_id=? AND id!=?').run(row.customer_id, row.id);
  audit(user, 'customer', row.customer_id, 'contact_update', null, { contact_id: row.id });
  sendJson(res, 200, { ok: true, item: d.prepare('SELECT * FROM customer_contacts WHERE id=?').get(row.id) });
} catch (e) { sendError(res, e); } }));
router.delete('/api/customers/:id/contacts/:cid', (req, res) => { try { const user = requireUser(req, res); requirePermFor(user, 'customer', 'edit'); get().prepare('DELETE FROM customer_contacts WHERE id=? AND customer_id=?').run(parseId(req.params.cid), parseId(req.params.id)); sendJson(res, 200, { ok: true }); } catch (e) { sendError(res, e); } });

// ================= geographic registry + follow-up attempts + voice + contacts import =================
router.get('/api/industrial-cities', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, geography.listIndustrialCities(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.post('/api/industrial-cities', withBody((req, res, user) => { try { sendJson(res, 200, geography.createIndustrialCity(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.delete('/api/industrial-cities/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, geography.deleteIndustrialCity(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });

router.get('/api/followups/:id/attempts', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, geography.listAttempts(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/followups/:id/attempts', withBody((req, res, user) => { try { sendJson(res, 200, geography.addAttempt(user, parseId(req.params.id), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/followups/:id/status', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, geography.setFollowupStatus(user, parseId(req.params.id), b.status)); } catch (e) { sendError(res, e); } }));

// Voice → structured customer fields (server-side text analysis of the transcript;
// the STT itself runs in the browser via Web Speech API — no fake, no silent failure)
router.post('/api/voice/parse', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, voiceExtract.extractCustomerFields(b.text || '')); } catch (e) { sendError(res, e); } }));

// Contacts import (target = one customer)
router.post('/api/contacts/import/parse', withBody(async (req, res, user) => { try {
  const b = req._body.json || {};
  const q = new URL(req.url, 'http://x').searchParams.get('customer_id');
  const custId = (b.customer_id || q) ? parseId(b.customer_id || q) : 0;
  if (!custId) { throw new HttpError(422, 'VALIDATION', 'مشتری مقصد را مشخص کنید.'); }
  const file = (req._body.files || [])[0];
  if (!file) throw new HttpError(422, 'VALIDATION', 'فایل انتخاب نشده است.');
  sendJson(res, 200, contactsImport.parse(user, custId, file.data, file.filename));
} catch (e) { sendError(res, e); } }));
router.post('/api/contacts/import/validate', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, contactsImport.validate(user, b.tempId, b.mapping)); } catch (e) { sendError(res, e); } }));
router.post('/api/contacts/import/commit', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, contactsImport.commit(user, b.tempId, b.mapping, b.dupPolicy)); } catch (e) { sendError(res, e); } }));
// mobile sales visit
router.post('/api/customers/:id/visit', withBody((req, res, user) => {
  const b = req._body.json || {};
  const custId = parseId(req.params.id);
  const d = get();
  const gps = b.gps ? ` (${Number(b.gps.lat).toFixed(5)}, ${Number(b.gps.lng).toFixed(5)})` : '';
  const summary = `بازدید حضوری از مشتری${gps}${b.photo ? ' + عکس' : ''}${b.signature ? ' + امضا' : ''}`;
  addActivity('customer', custId, user.id, 'visit', summary, b);
  audit(user, 'customer', custId, 'visit', null, { gps: b.gps });
  if (b.note) generic.addComment('customer', custId, user, 'یادداشت بازدید: ' + b.note);
  if (b.followup_date) d.prepare('INSERT INTO followups(entity_type, entity_id, user_id, subject, note, due_at, status) VALUES(?,?,?,?,?,?,?)')
    .run('customer', custId, user.id, 'پیگیری پس از بازدید', b.note || '', new Date(b.followup_date).toISOString(), 'pending');
  return { ok: true };
}));
// ============ REPORTS ============
router.get('/api/reports/sources', (req, res) => { try { requireUser(req, res); const out = {}; for (const [k, v] of Object.entries(reports.SOURCES)) out[k] = { nameFa: v.nameFa, cols: Object.fromEntries(Object.entries(v.cols).map(([ck, cv]) => [ck, cv.fa])) }; sendJson(res, 200, out); } catch (e) { sendError(res, e); } });
router.post('/api/reports/run', withBody((req, res, user) => { requireUser(req, res); const b = req._body.json || {}; return reports.runReport(b); }));
router.get('/api/reports/definitions', (req, res) => { try { const user = requireUser(req, res); const rows = get().prepare('SELECT * FROM report_definitions ORDER BY id DESC').all().map(r => ({ ...r, columns: JSON.parse(r.columns || '[]'), filters: JSON.parse(r.filters || '{}') })); sendJson(res, 200, { items: rows }); } catch (e) { sendError(res, e); } });
router.post('/api/reports/definitions', withBody((req, res, user) => {
  const b = req._body.json || {};
  if (!b.name || !b.source) throw new HttpError(422, 'VALIDATION', 'نام و منبع گزارش الزامی است.');
  const info = get().prepare('INSERT INTO report_definitions(name, source, columns, filters, group_by, sort, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(b.name, b.source, JSON.stringify(b.columns || []), JSON.stringify(b.filters || {}), b.group_by || '', b.sort || '', user.id, ts());
  return { id: Number(info.lastInsertRowid) };
}));
router.delete('/api/reports/definitions/:id', (req, res) => { try { const user = requireUser(req, res); get().prepare('DELETE FROM report_definitions WHERE id=?').run(parseId(req.params.id)); sendJson(res, 200, { ok: true }); } catch (e) { sendError(res, e); } });
router.get('/api/reports/definitions/:id/export', (req, res) => {
  try {
    const user = requireUser(req, res);
    const def = get().prepare('SELECT * FROM report_definitions WHERE id=?').get(parseId(req.params.id));
    if (!def) throw new HttpError(404, 'NOT_FOUND', 'گزارش پیدا نشد.');
    const u = new URL(req.url, 'http://x');
    const out = reports.exportReport({ source: def.source, columns: JSON.parse(def.columns || '[]'), filters: JSON.parse(def.filters || '{}'), group_by: def.group_by, sort: def.sort }, u.searchParams.get('format') || 'xlsx');
    res.writeHead(200, { 'Content-Type': out.type === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${encodeURIComponent(out.fileName)}"`, 'Cache-Control': 'no-store' });
    res.end(out.data);
  } catch (e) { sendError(res, e); }
});
router.get('/api/reports/instances', (req, res) => {
  try {
    const user = requireUser(req, res);
    const rows = get().prepare('SELECT * FROM report_instances ORDER BY id DESC LIMIT 60').all().map(r => ({ ...r, data: JSON.parse(r.data || '{}') }));
    sendJson(res, 200, { items: rows });
  } catch (e) { sendError(res, e); }
});
// ============ AI ============
router.get('/api/ai/conversations', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.listConversations(user)); } catch (e) { sendError(res, e); } });
router.post('/api/ai/chat', withBody(async (req, res, user) => { const b = req._body.json || {}; sendJson(res, 200, await ai.chat(user, b)); }));
router.get('/api/ai/kb', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, ai.kbDocuments(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.post('/api/ai/kb', withBody((req, res, user) => { const b = req._body.json || {}; let text = b.text_content; if (req._body.files && req._body.files.length) { const f = req._body.files[0]; const ext = path.extname(f.filename || '').toLowerCase(); if (['.txt', '.md', '.csv'].includes(ext)) text = f.data.toString('utf8'); else text = `[فایل: ${f.filename}]` + (text || ''); } return ai.saveKbDoc(user, { ...b, text_content: text }); }));
router.delete('/api/ai/kb/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.deleteKbDoc(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/ai/rag', (req, res) => { try { const user = requireUser(req, res); const q = new URL(req.url, 'http://x').searchParams.get('q') || ''; sendJson(res, 200, ai.ragSearch(user, q)); } catch (e) { sendError(res, e); } });
router.get('/api/ai/leads', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.leadScoring(user)); } catch (e) { sendError(res, e); } });
router.post('/api/ai/leads/rescore', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.rescoreLeads(user)); } catch (e) { sendError(res, e); } });
router.get('/api/ai/churn', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.churnPrediction(user)); } catch (e) { sendError(res, e); } });
router.get('/api/ai/forecast', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, ai.salesForecast(user, u.searchParams.get('granularity'), parseInt(u.searchParams.get('horizon') || '3', 10))); } catch (e) { sendError(res, e); } });
router.get('/api/ai/opportunities', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.opportunityScoring(user)); } catch (e) { sendError(res, e); } });
router.get('/api/ai/anomalies', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.anomalyReport(user)); } catch (e) { sendError(res, e); } });
router.get('/api/ai/summary', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.executiveSummary(user)); } catch (e) { sendError(res, e); } });
router.get('/api/ai/customer/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, ai.customerInsights(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/ai/config', (req, res) => { try { requireUser(req, res); sendJson(res, 200, ai.aiConfigInfo()); } catch (e) { sendError(res, e); } });
// ============ Smart Sales Team (تیم هوشمند فروش) — Local Intelligence + Target Engine ============
router.get('/api/ai/status', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.aiStatus(user)); } catch (e) { sendError(res, e); } });
router.get('/api/smart-sales/actions', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.nextBestActions(user, Math.min(parseInt(req.url.split('limit=')[1] || '30', 10) || 30, 50))); } catch (e) { sendError(res, e); } });
router.get('/api/smart-sales/followups', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.smartFollowups(user)); } catch (e) { sendError(res, e); } });
router.post('/api/smart-sales/followups/:id/task', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.taskFromFollowup(user, req.params.id)); } catch (e) { sendError(res, e); } });
router.get('/api/smart-sales/stalled', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.stalledOpportunities(user)); } catch (e) { sendError(res, e); } });
router.get('/api/smart-sales/leads', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.highPriorityLeads(user)); } catch (e) { sendError(res, e); } });
router.get('/api/smart-sales/at-risk', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.atRiskCustomers(user)); } catch (e) { sendError(res, e); } });
router.post('/api/smart-sales/rescore', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.rescore(user)); } catch (e) { sendError(res, e); } });
router.get('/api/smart-sales/targets', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, smartsales.targets(user, { scope_type: u.searchParams.get('scope_type'), period_type: u.searchParams.get('period_type') })); } catch (e) { sendError(res, e); } });
router.post('/api/smart-sales/targets', withBody((req, res, user) => { try { sendJson(res, 201, smartsales.createTarget(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.put('/api/smart-sales/targets/:id', withBody((req, res, user) => { try { sendJson(res, 200, smartsales.updateTarget(user, req.params.id, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.delete('/api/smart-sales/targets/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.deleteTarget(user, req.params.id)); } catch (e) { sendError(res, e); } });
// ---- Smart Team: competitor analysis / idea generation / team tasks ----
router.get('/api/smart-sales/competitors', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.competitors(user)); } catch (e) { sendError(res, e); } });
router.post('/api/smart-sales/competitors', withBody((req, res, user) => { try { sendJson(res, 201, smartsales.createCompetitor(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.put('/api/smart-sales/competitors/:id', withBody((req, res, user) => { try { sendJson(res, 200, smartsales.updateCompetitor(user, req.params.id, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.delete('/api/smart-sales/competitors/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.deleteCompetitor(user, req.params.id)); } catch (e) { sendError(res, e); } });
router.get('/api/smart-sales/ideas', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, smartsales.ideas(user, { status: u.searchParams.get('status') })); } catch (e) { sendError(res, e); } });
router.post('/api/smart-sales/ideas', withBody((req, res, user) => { try { sendJson(res, 201, smartsales.createIdea(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/smart-sales/ideas/generate', (req, res) => { try { const user = requireUser(req, res); smartsales.generateIdeas(user).then(r => sendJson(res, 200, r)).catch(e => sendError(res, e)); } catch (e) { sendError(res, e); } });
router.put('/api/smart-sales/ideas/:id', withBody((req, res, user) => { try { sendJson(res, 200, smartsales.updateIdea(user, req.params.id, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/smart-sales/ideas/:id/status', withBody((req, res, user) => { try { sendJson(res, 200, smartsales.setIdeaStatus(user, req.params.id, (req._body.json || {}).status)); } catch (e) { sendError(res, e); } }));
router.post('/api/smart-sales/ideas/:id/task', withBody((req, res, user) => { try { sendJson(res, 200, smartsales.ideaToTask(user, req.params.id, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.get('/api/smart-sales/team-tasks', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, smartsales.teamTasks(user)); } catch (e) { sendError(res, e); } });
router.post('/api/smart-sales/team-tasks', withBody((req, res, user) => { try { sendJson(res, 201, smartsales.createTeamTask(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/smart-sales/team-tasks/:id/status', withBody((req, res, user) => { try { sendJson(res, 200, smartsales.setTeamTaskStatus(user, req.params.id, (req._body.json || {}).status)); } catch (e) { sendError(res, e); } }));
// ============ MESSANGER ============
router.get('/api/messages/conversations', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, messenger.myConversations(user)); } catch (e) { sendError(res, e); } });
router.post('/api/messages/conversations', withBody((req, res, user) => { const b = req._body.json || {}; return messenger.createConversation(user, b); }));
router.post('/api/messages/conversations/:id/members', withBody((req, res, user) => { const b = req._body.json || {}; return messenger.addMembers(user, parseId(req.params.id), b.member_ids || []); }));
router.get('/api/messages/conversations/:id', (req, res) => {
  try {
    const user = requireUser(req, res);
    const u = new URL(req.url, 'http://x');
    sendJson(res, 200, messenger.listMessages(user, parseId(req.params.id), u.searchParams.get('before')));
  } catch (e) { sendError(res, e); }
});
router.post('/api/messages/conversations/:id/read', (req, res) => {
  try {
    const user = requireUser(req, res);
    const d = get();
    d.prepare('UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?').run(ts(), parseId(req.params.id), user.id);
    sendJson(res, 200, { ok: true });
  } catch (e) { sendError(res, e); }
});
router.post('/api/messages/conversations/:id', withBody(async (req, res, user) => {
  const b = req._body.json || {};
  const convId = parseId(req.params.id);
  let filePath = null, mime = null;
  if (req._body.files && req._body.files.length) {
    const f = messenger.uploadMessageFile(user, convId, req._body.files[0]);
    filePath = path.relative(PUBLIC_DIR, f.path);
    mime = f.mime;
  }
  return messenger.sendRest(user, convId, b.body, b.ref_type, b.ref_id, filePath, mime);
}));
router.get('/api/messages/search', (req, res) => { try { const user = requireUser(req, res); const q = new URL(req.url, 'http://x').searchParams.get('q') || ''; sendJson(res, 200, messenger.searchMessages(user, q)); } catch (e) { sendError(res, e); } });
// calls (WebRTC signaling via REST fallback)
router.post('/api/calls', withBody((req, res, user) => {
  const b = req._body.json || {};
  const target = get().prepare('SELECT id, full_name FROM users WHERE id=? AND active=1').get(Number(b.target_id));
  if (!target) throw new HttpError(404, 'NOT_FOUND', 'کاربر هدف پیدا نشد.');
  const info = get().prepare('INSERT INTO calls_log(initiator_id, target_id, kind, status, started_at) VALUES(?,?,?,?,?)').run(user.id, target.id, b.kind || 'voice', 'ringing', ts());
  getHub().sendToUser(target.id, { type: 'call', from: user.id, from_name: user.full_name, kind: b.kind || 'voice', callId: info.lastInsertRowid });
  return { callId: Number(info.lastInsertRowid), target };
}));
router.post('/api/calls/:id/answer', withBody((req, res, user) => {
  const c = get().prepare('SELECT * FROM calls_log WHERE id=?').get(parseId(req.params.id));
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'تماس پیدا نشد.');
  get().prepare("UPDATE calls_log SET status='active' WHERE id=?").run(c.id);
  getHub().sendToUser(c.initiator_id, { type: 'call-answered', callId: c.id });
  return { ok: true };
}));
router.post('/api/calls/:id/end', (req, res) => {
  try { const user = requireUser(req, res); const c = get().prepare('SELECT * FROM calls_log WHERE id=?').get(parseId(req.params.id)); if (c) { get().prepare("UPDATE calls_log SET status='ended', ended_at=? WHERE id=?").run(ts(), c.id); getHub().sendToUser(c.target_id === user.id ? c.initiator_id : c.target_id, { type: 'call-ended', callId: c.id }); } sendJson(res, 200, { ok: true }); } catch (e) { sendError(res, e); }
});
router.post('/api/calls/:id/signal', withBody((req, res, user) => {
  try {
    const c = get().prepare('SELECT * FROM calls_log WHERE id=?').get(parseId(req.params.id));
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'تماس پیدا نشد.');
    if (c.initiator_id !== user.id && c.target_id !== user.id) throw new HttpError(403, 'FORBIDDEN', 'در این تماس شرکت ندارید.');
    const other = c.initiator_id === user.id ? c.target_id : c.initiator_id;
    getHub().sendToUser(other, { type: 'call-signal', callId: c.id, from: user.id, candidate: (req._body.json || {}).candidate || null });
    return { ok: true };
  } catch (e) { sendError(res, e); }
}));
// ============ CAMPAIGNS ============
router.post('/api/campaigns/:id/send', withBody(async (req, res, user) => { sendJson(res, 200, await campaigns.sendCampaign(user, parseId(req.params.id))); }));
// audience preview is a read — expose via GET as well (POST kept for backwards compatibility)
function campaignAudienceHandler(req, res) { try { const user = requireUser(req, res); const c = get().prepare('SELECT * FROM campaigns WHERE id=?').get(parseId(req.params.id)); if (!c) throw new HttpError(404, 'NOT_FOUND', 'کمپین پیدا نشد.'); sendJson(res, 200, { items: campaigns.audience(c).slice(0, 100) }); } catch (e) { sendError(res, e); } }
router.get('/api/campaigns/:id/audience', campaignAudienceHandler);
router.post('/api/campaigns/:id/audience', campaignAudienceHandler);
// ============ VOIP / IP-PBX & CALLS ============
router.get('/api/voip/settings', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, { settings: voip.maskedCfg(), outcomes: voip.outcomes() }); } catch (e) { sendError(res, e); } });
router.put('/api/voip/settings', withBody((req, res, user) => { try { sendJson(res, 200, { settings: voip.saveSettings(user, req._body.json || {}) }); } catch (e) { sendError(res, e); } }));
router.post('/api/voip/test-connection', withBody(async (req, res, user) => { try { sendJson(res, 200, await voip.testConnection(user)); } catch (e) { sendError(res, e); } }));
router.post('/api/voip/sync', withBody(async (req, res, user) => { try { sendJson(res, 200, await voip.sync(user)); } catch (e) { sendError(res, e); } }));
router.get('/api/voip/calls', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, voip.listCalls(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.get('/api/voip/calls/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, voip.callDetail(user, req.params.id)); } catch (e) { sendError(res, e); } });
router.put('/api/voip/calls/:id', withBody((req, res, user) => { try { sendJson(res, 200, voip.updateCall(user, req.params.id, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/voip/calls/:id/followup', withBody((req, res, user) => { try { sendJson(res, 201, voip.createFollowupFromCall(user, req.params.id, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/voip/calls/:id/customer', withBody((req, res, user) => { try { sendJson(res, 201, voip.attachCustomerFromCall(user, req.params.id, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.post('/api/voip/call', withBody(async (req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 201, await voip.clickToCall(user, b.to, b.note)); } catch (e) { sendError(res, e); } }));
router.get('/api/voip/dashboard', (req, res) => { try { requireUser(req, res); sendJson(res, 200, voip.dashboard()); } catch (e) { sendError(res, e); } });
router.get('/api/voip/calls/:id/ai', async (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, await voip.callAi(user, req.params.id)); } catch (e) { sendError(res, e); } });
router.get('/api/voip/customers/:id/stats', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, voip.customerCallStats(user, req.params.id)); } catch (e) { sendError(res, e); } });
router.get('/api/voip/report', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, voip.report(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.get('/api/voip/report/export', (req, res) => {
  try {
    const user = requireUser(req, res);
    const u = new URL(req.url, 'http://x');
    const out = voip.exportReport(user, Object.fromEntries(u.searchParams.entries()), u.searchParams.get('format') || 'xlsx');
    const ctype = out.type === 'csv' ? 'text/csv; charset=utf-8' : out.type === 'html' ? 'text/html; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.writeHead(200, { 'Content-Type': ctype, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.fileName)}`, 'Cache-Control': 'no-store' });
    res.end(out.data);
  } catch (e) { sendError(res, e); }
});
router.get('/api/voip/outcomes', (req, res) => { try { requireUser(req, res); sendJson(res, 200, { items: voip.outcomes() }); } catch (e) { sendError(res, e); } });
router.put('/api/voip/outcomes', withBody((req, res, user) => { try { sendJson(res, 200, voip.saveOutcomes(user, (req._body.json || {}).items)); } catch (e) { sendError(res, e); } }));
// CDR webhook from the PBX (authenticated by shared secret, not user session)
// ---- Webhook security (item 35): Timestamp Validation + Replay Protection ----
// Enforced when the provider sends the headers (lenient for providers that don't).
// Nonce store: in-memory TTL set (single-process; safe for this deployment shape).
const webhookNonces = new Map(); // nonce -> expiry
(function pruneNonces() {
  setInterval(() => { const now = Date.now(); for (const [k, v] of webhookNonces) if (v < now) webhookNonces.delete(k); }, 60000).unref();
})();
function webhookReplayCheck(req, res) {
  const tsRaw = req.headers['x-webhook-timestamp'];
  if (tsRaw) {
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * (ts < 1e12 ? 1000 : 1)) > 5 * 60000) {
      console.error('[security] webhook timestamp stale/replay rejected: ts=' + tsRaw);
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'TIMESTAMP_STALE', message: 'Timestamp نامعتبر یا منقضی است.' } }));
      return false;
    }
  }
  const nonce = req.headers['x-webhook-nonce'];
  if (nonce) {
    const key = String(nonce);
    if (webhookNonces.has(key)) {
      console.error('[security] webhook replay rejected: nonce=' + key.slice(0, 12));
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'REPLAY', message: 'درخواست تکراری (replay) است.' } }));
      return false;
    }
    webhookNonces.set(key, Date.now() + 10 * 60000);
  }
  return true;
}
router.post('/api/voip/webhook/:provider', async (req, res) => {
  try {
    if (!webhookReplayCheck(req, res)) return;
    const { json } = await parseBody(req);
    const u = new URL(req.url, 'http://x');
    const secret = req.headers['x-webhook-secret'] || u.searchParams.get('secret') || '';
    const out = voip.webhook(req.params.provider, json || {}, String(secret));
    sendJson(res, 200, out);
  } catch (e) { sendError(res, e); }
});
router.get('/api/voip/calls/:id/recording', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, voip.recordingMeta(user, req.params.id)); } catch (e) { sendError(res, e); } });
router.post('/api/voip/calls/:id/recording-token', withBody(async (req, res, user) => { try { sendJson(res, 200, await voip.recordingStreamToken(user, req.params.id)); } catch (e) { sendError(res, e); } }));
router.get('/api/voip/recordings/stream', (req, res) => {
  try {
    const tok = new URL(req.url, 'http://x').searchParams.get('tok') || '';
    const r = voip.streamRecording(tok);
    const ctype = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.opus': 'audio/opus' }[path.extname(r.name).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': fs.statSync(r.file).size, 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(r.file));
  } catch (e) { sendError(res, e); }
});
router.get('/api/voip/recordings/:id/download', (req, res) => {
  try {
    const user = requireUser(req, res);
    const r = voip.downloadRecording(user, req.params.id);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(r.file).size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`, 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(r.file));
  } catch (e) { sendError(res, e); }
});
// ============ APPROVALS ============
router.get('/api/approvals', (req, res) => {
  try {
    const user = requireUser(req, res);
    const rows = get().prepare(`SELECT a.*, u.full_name requester, d.full_name decider FROM approval_requests a LEFT JOIN users u ON u.id=a.requested_by LEFT JOIN users d ON d.id=a.decided_by ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END, a.id DESC LIMIT 200`).all();
    sendJson(res, 200, { items: rows });
  } catch (e) { sendError(res, e); }
});
router.post('/api/approvals', withBody((req, res, user) => { const b = req._body.json || {}; return { id: approvals.create(b.type || 'other', b.entity_type, b.entity_id, b.title, b.reason, b.data, user) }; }));
router.post('/api/approvals/:id/decision', withBody((req, res, user) => { const b = req._body.json || {}; return approvals.decide(parseId(req.params.id), !!b.approve, user, b.note || ''); }));
// ============ OUTBOX / WEBHOOKS ============
router.get('/api/outbox', (req, res) => { try { requireUser(req, res); sendJson(res, 200, { items: get().prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 200').all() }); } catch (e) { sendError(res, e); } });
router.post('/api/webhook/:provider', async (req, res) => {
  try {
    const { json } = await parseBody(req);
    get().prepare('INSERT INTO webhooks_log(provider, path, payload, status_code, created_at) VALUES(?,?,?,?,?)').run(req.params.provider, req.url, JSON.stringify(json).slice(0, 5000), 200, ts());
    const out = campaigns.handleCallback(req.params.provider, json || {});
    sendJson(res, 200, out);
  } catch (e) { sendError(res, e); }
});
// ============ CUSTOMER MESSAGING (Section 5) ============
router.get('/api/customermsg/settings', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, customermsg.getMessagingSettingsApi(user)); } catch (e) { sendError(res, e); } });
router.put('/api/customermsg/settings', withBody((req, res, user) => { const b = req._body.json || {}; return customermsg.setMessagingSettingsApi(user, b); }));
router.get('/api/customermsg/templates', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, customermsg.listTemplates(user)); } catch (e) { sendError(res, e); } });
router.post('/api/customermsg/templates', withBody((req, res, user) => { const b = req._body.json || {}; return customermsg.saveTemplate(user, null, b); }));
router.put('/api/customermsg/templates/:id', withBody((req, res, user) => { const b = req._body.json || {}; return customermsg.saveTemplate(user, req.params.id, b); }));
router.delete('/api/customermsg/templates/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, customermsg.deleteTemplate(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/customermsg/send', withBody(async (req, res, user) => { const b = req._body.json || {}; try { sendJson(res, 200, await customermsg.sendCustomerMessage(user, ip(req), b)); } catch (e) { sendError(res, e); } }));

// ============ CUSTOMER SELF-SERVICE PORTAL (restricted access — own data only) ============
// portal login is unauthenticated by design (customer credentials) — no requireUser
router.post('/api/portal/login', async (req, res) => {
  try {
    const parsed = await parseBody(req);
    sendJson(res, 200, portal.login(ip(req), (parsed && parsed.json) || {}));
  } catch (e) { sendError(res, e); }
});
// body wrapper for portal WRITE routes — authenticates with the CUSTOMER token, not staff
function withPortalBody(fn) {
  return async (req, res) => {
    try {
      req._body = await parseBody(req);
      const cust = portal.requirePortal(req);
      const out = await fn(req, res, cust);
      if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
    } catch (e) { sendError(res, e); }
  };
}
router.get('/api/portal/me', (req, res) => { try { sendJson(res, 200, portal.me(portal.requirePortal(req))); } catch (e) { sendError(res, e); } });
router.put('/api/portal/password', withPortalBody((req, res, cust) => { const b = req._body.json || {}; return portal.changePassword(cust, b); }));
router.post('/api/portal/orders', withPortalBody((req, res, cust) => { const b = req._body.json || {}; return portal.createOrder(cust, b); }));
router.get('/api/portal/orders', (req, res) => { try { sendJson(res, 200, portal.listOrders(portal.requirePortal(req))); } catch (e) { sendError(res, e); } });
router.get('/api/portal/orders/:id', (req, res) => { try { sendJson(res, 200, portal.orderDetail(portal.requirePortal(req), req.params.id)); } catch (e) { sendError(res, e); } });
router.post('/api/portal/complaints', withPortalBody((req, res, cust) => { const b = req._body.json || {}; return portal.createComplaint(cust, b); }));
router.get('/api/portal/complaints', (req, res) => { try { sendJson(res, 200, portal.listComplaints(portal.requirePortal(req))); } catch (e) { sendError(res, e); } });
router.post('/api/portal/messages', withPortalBody((req, res, cust) => { const b = req._body.json || {}; return portal.sendMessage(cust, b); }));
router.get('/api/portal/messages', (req, res) => { try { sendJson(res, 200, portal.listMessages(portal.requirePortal(req))); } catch (e) { sendError(res, e); } });
router.get('/api/portal/products', (req, res) => { try { sendJson(res, 200, portal.listProducts(portal.requirePortal(req))); } catch (e) { sendError(res, e); } });
router.get('/api/portal/defect-types', (req, res) => { try { const u = new URL(req.url, 'http://x'); sendJson(res, 200, portal.defectTypes(portal.requirePortal(req), u.searchParams.get('family'))); } catch (e) { sendError(res, e); } });
// staff: manage a customer's portal credentials (password is hashed, never returned)
router.post('/api/r/customer/:id/portal-credentials', withBody((req, res, user) => {
  try {
    const { hashPassword } = require('./lib/crypto');
    const d = require('./db/db').get();
    const id = parseId(req.params.id);
    const cust = d.prepare('SELECT * FROM customers WHERE id=? AND archived_at IS NULL').get(id);
    if (!cust) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
    require('./auth/auth').requirePerm(user, 'customer', 'edit');
    const b = req._body.json || {};
    const username = String(b.username || cust.portal_username || '').trim().replace(/\s+/g, '');
    if (username && !/^[a-zA-Z0-9_.@-]{3,40}$/.test(username)) throw new HttpError(422, 'VALIDATION', 'نام کاربری باید ۳ تا ۴۰ کاراکتر انگلیسی/عدد باشد (بدون فاصله).');
    if (b.enabled && !username) throw new HttpError(422, 'VALIDATION', 'برای فعال‌سازی پورتال، نام کاربری الزامی است.');
    if (username) {
      const clash = d.prepare('SELECT id FROM customers WHERE portal_username=? AND id!=? AND archived_at IS NULL').get(username, id);
      if (clash) throw new HttpError(409, 'DUPLICATE', 'این نام کاربری پورتال قبلاً استفاده شده است.');
    }
    let pwSet = false;
    if (b.password) {
      const pw = String(b.password);
      if (pw.length < 8) throw new HttpError(422, 'VALIDATION', 'رمز عبور حداقل ۸ کاراکتر باشد.');
      d.prepare('UPDATE customers SET portal_password_hash=? WHERE id=?').run(hashPassword(pw), id);
      pwSet = true;
    }
    d.prepare('UPDATE customers SET portal_username=?, portal_enabled=? WHERE id=?').run(username, b.enabled ? 1 : 0, id);
    audit(user, 'customer', id, 'portal_credentials', { enabled: cust.portal_enabled }, { enabled: b.enabled ? 1 : 0, username, password_set: pwSet }, '');
    addActivity('customer', id, user.id, 'portal_credentials', 'اعتبارسنجی پورتال مشتری به‌روزرسانی شد');
    sendJson(res, 200, { ok: true, username, enabled: !!b.enabled, password_set: pwSet });
  } catch (e) { sendError(res, e); }
}));
// complaint defect bank (structured defect dictionary) for UI selects
router.get('/api/complaints/defect-types', (req, res) => {
  try {
    const user = requireUser(req, res);
    require('./auth/auth').requirePerm(user, 'complaint', 'view');
    const u = new URL(req.url, 'http://x');
    const fam = u.searchParams.get('family') || '';
    const d = require('./db/db').get();
    const items = fam
      ? d.prepare('SELECT defect_key, defect_fa, family, family_fa FROM complaint_defect_types WHERE family=? ORDER BY id').all(fam)
      : d.prepare('SELECT defect_key, defect_fa, family, family_fa FROM complaint_defect_types ORDER BY family, id').all();
    sendJson(res, 200, { items });
  } catch (e) { sendError(res, e); }
});
router.get('/api/customermsg/log', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, customermsg.listMessages(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.get('/api/customermsg/channels', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, customermsg.getChannelStatesApi(user)); } catch (e) { sendError(res, e); } });
// ============ COMMUNICATION CENTER — unified real communications (VoIP + messages + internal calls) ============
router.get('/api/comm/center', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, commcenter.center(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
// ============ SEARCH & EXPORT (Section 6) — server-side export for lists that had no export ============
// All endpoints: requireUser + entity `export` permission; respect the same search (q) /
// filters as the list page; dates rendered in Jalali; data strictly from the real DB.
router.get('/api/contacts/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportContacts(user, u.searchParams.get('q') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
router.get('/api/stock/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportStock(user, u.searchParams.get('q') || '', u.searchParams.get('raw') === '1', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
// Section 8: warehouse lists export (movements + alerts) — xlsx/csv/json/html (printable PDF)
router.get('/api/stock/movements/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportMovements(user, u.searchParams.get('q') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
router.get('/api/stock/alerts/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportAlerts(user, u.searchParams.get('q') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
// Section 8: purchase order receive → stock in (transactional, audited)
router.post('/api/purchase_orders/:id/receive', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, sales.poReceive(user, parseId(req.params.id), b)); } catch (e) { sendError(res, e); } }));
router.get('/api/loyalty/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportLoyalty(user, u.searchParams.get('q') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
// Section 9 — Customer Club: accounts, transactions, rules, export
router.get('/api/loyalty/accounts', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, loyalty.listAccounts(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.get('/api/loyalty/accounts/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); loyaltySend(res, loyalty.exportAccounts(user, u.searchParams.get('q') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
router.post('/api/loyalty/accounts', withBody((req, res, user) => { try { sendJson(res, 200, loyalty.createAccount(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.get('/api/loyalty/accounts/:customerId', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, loyalty.getAccount(user, parseId(req.params.customerId))); } catch (e) { sendError(res, e); } });
router.put('/api/loyalty/accounts/:customerId', withBody((req, res, user) => { try { sendJson(res, 200, loyalty.updateAccount(user, parseId(req.params.customerId), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.delete('/api/loyalty/accounts/:customerId', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, loyalty.deleteAccount(user, parseId(req.params.customerId))); } catch (e) { sendError(res, e); } });
router.get('/api/loyalty/transactions', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, loyalty.listTransactions(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.post('/api/loyalty/transactions', withBody((req, res, user) => { try { sendJson(res, 200, loyalty.addTransaction(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.delete('/api/loyalty/transactions/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, loyalty.deleteTransaction(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/loyalty/rules', (req, res) => { try { const user = requireUser(req, res); requirePermFor(user, 'loyalty_account', 'view'); sendJson(res, 200, loyalty.rulesInfo()); } catch (e) { sendError(res, e); } });
router.post('/api/loyalty/rules', withBody((req, res, user) => { try { const b = req._body.json || {}; requirePermFor(user, 'settings', 'edit'); sendJson(res, 200, loyalty.setEarnRate(user, b.earn_rate)); } catch (e) { sendError(res, e); } }));
router.get('/api/loyalty/transactions/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); loyaltySend(res, loyalty.exportTransactions(user, u.searchParams.get('q') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
router.get('/api/lab/results/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportLabResults(user, u.searchParams.get('q') || '', u.searchParams.get('status') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
router.get('/api/lab/requests/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportLabRequests(user, u.searchParams.get('q') || '', u.searchParams.get('status') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
router.get('/api/pricelist/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); exporter.sendExport(res, exporter.exportPriceLists(user, u.searchParams.get('q') || '', u.searchParams.get('format') || 'xlsx')); } catch (e) { sendError(res, e); } });
// ============ ADMIN ============
router.get('/api/admin/users', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, admin.listUsers(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.post('/api/admin/users', withBody((req, res, user) => { const b = req._body.json || {}; return admin.createUser(user, b); }));
router.put('/api/admin/users/:id', withBody((req, res, user) => { const b = req._body.json || {}; return admin.updateUser(user, parseId(req.params.id), b); }));
router.delete('/api/admin/users/:id', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, admin.removeUser(user, parseId(req.params.id), u.searchParams.get('hard') === '1')); } catch (e) { sendError(res, e); } });
router.get('/api/admin/roles', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, admin.listRoles(user)); } catch (e) { sendError(res, e); } });
router.post('/api/admin/roles', withBody((req, res, user) => { const b = req._body.json || {}; return admin.createRole(user, b); }));
router.put('/api/admin/roles/:id', withBody((req, res, user) => { const b = req._body.json || {}; return admin.saveRole(user, parseId(req.params.id), b); }));
router.delete('/api/admin/roles/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, admin.removeRole(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/admin/settings', (req, res) => { try { const user = requireUser(req, res); const s = admin.getSettings(user); sendJson(res, 200, s); } catch (e) { sendError(res, e); } });
router.put('/api/admin/settings', withBody((req, res, user) => { const b = req._body.json || {}; return admin.saveSettings(user, b); }));
// factory QR code (static asset so print headers can render it without auth)
router.post('/api/admin/company-qr', withBody((req, res, user) => {
  requirePermFor(user, 'settings', 'edit');
  const files = req._body.files || [];
  if (!files.length) throw new HttpError(400, 'NO_FILE', 'فایلی دریافت نشد.');
  const f = files[0];
  if (!/^image\/(png|jpe?g|webp)$/i.test(f.mime || '')) throw new HttpError(400, 'BAD_TYPE', 'فقط تصویر PNG/JPEG/WebP مجاز است.');
  if (f.data.length > 3 * 1024 * 1024) throw new HttpError(400, 'TOO_LARGE', 'حجم فایل باید کمتر از 3 مگابایت باشد.');
  // Stage 2 — MIME header is client-controlled; verify real image magic bytes
  // before writing into the web root (public/).
  const b = f.data;
  const isPng = b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
  const isJpg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
  const isWebp = b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpg && !isWebp) throw new HttpError(400, 'BAD_TYPE', 'محتوای فایل تصویر معتبر نیست.');
  const dest = path.join(__dirname, '..', 'public', 'assets', 'company-qr.png');
  fs.writeFileSync(dest, f.data);
  const co = getSetting('company', {}) || {};
  setSetting('company', { ...co, qr_image: '/assets/company-qr.png' });
  audit(user, 'settings', 0, 'company_qr_update', null, { file: 'company-qr.png' }, '');
  sendJson(res, 200, { ok: true, qr_image: '/assets/company-qr.png' });
}));
router.get('/api/admin/audit', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, admin.listAudit(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.get('/api/admin/backups', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, admin.listBackups(user)); } catch (e) { sendError(res, e); } });
router.post('/api/admin/backups', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, admin.createBackup(user)); } catch (e) { sendError(res, e); } });
router.post('/api/admin/search/reindex', (req, res) => { try { const user = requireUser(req, res); requirePermFor(user, 'settings', 'edit'); const n = require('./db/db').searchRebuild(); sendJson(res, 200, { ok: true, indexed: n }); } catch (e) { sendError(res, e); } });
router.get('/api/admin/backups/:id/download', (req, res) => {
  try {
    const user = requireUser(req, res);
    const b = admin.downloadBackup(user, parseId(req.params.id));
    const st = fs.statSync(b.path);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${b.name}"` });
    fs.createReadStream(b.path).pipe(res);
  } catch (e) { sendError(res, e); }
});
router.post('/api/admin/backups/:id/restore', (req, res) => { try { const user = requireUser(req, res); const out = admin.restoreBackup(user, parseId(req.params.id)); sendJson(res, 200, out); } catch (e) { sendError(res, e); } });
router.post('/api/admin/backup-settings', withBody((req, res, user) => { try { sendJson(res, 200, admin.saveBackupSettings(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.get('/api/admin/custom-fields/:entity', (req, res) => { try { requireUser(req, res); sendJson(res, 200, { fields: admin.getCustomFields(req.params.entity) }); } catch (e) { sendError(res, e); } });
router.put('/api/admin/custom-fields/:entity', withBody((req, res, user) => { const b = req._body.json || {}; return admin.saveCustomFields(user, req.params.entity, b.fields || []); }));
// ============ ATTACHMENTS ============
router.post('/api/attachments', withBody(async (req, res, user) => {
  const b = req._body.json || {};
  if (!b.entity_type || !b.entity_id) throw new HttpError(422, 'VALIDATION', 'entity_type و entity_id الزامی است.');
  const files = req._body.files || [];
  // Route through the shared guarded uploader so BLOCKED_UPLOAD_EXT is enforced here too.
  const ids = await attachFiles(null, user, Number(b.entity_id), files, String(b.entity_type));
  if (ids.length) addActivity(b.entity_type, Number(b.entity_id), user.id, 'attachment', `${ids.length} فایل پیوست شد`);
  return { ids };
}));
router.get('/api/attachments/:id/download', (req, res) => {
  try {
    const user = requireUser(req, res);
    const a = get().prepare('SELECT * FROM attachments WHERE id=?').get(parseId(req.params.id));
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'فایل پیدا نشد.');
    // IDOR protection: the attachment's parent record must be inside the caller's scope.
    // Orphaned files (parent hard-deleted) keep the legacy accessible behavior.
    const r = a.entity_type ? Object.values(R).find(x => x && x.entity === a.entity_type) : null;
    if (r && a.entity_id) {
      try { scopedRowAs(user, r, String(a.entity_id), 'view'); }
      catch (e) { if (!(e && e.status === 404)) throw e; }
    }
    if (!fs.existsSync(a.file_path)) throw new HttpError(404, 'NOT_FOUND', 'فایل روی دیسک وجود ندارد.');
    // Stage 2 — uploaded files never render as active content: forced download,
    // nosniff, and an embedded CSP sandbox on the file response itself.
    const st = fs.statSync(a.file_path);
    res.writeHead(200, {
      'Content-Type': a.mime || 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(a.file_name)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox allow-downloads",
    });
    fs.createReadStream(a.file_path).pipe(res);
  } catch (e) { sendError(res, e); }
});
// ============ SYNC (offline) ============
router.post('/api/sync/batch', withBody((req, res, user) => {
  const b = req._body.json || {};
  const changes = Array.isArray(b.changes) ? b.changes : [];
  const results = [];
  const d = get();
  for (const ch of changes.slice(0, 200)) {
    const key = ch.entity;
    const r = R[key];
    const result = { entity: ch.entity, id: ch.id, op: ch.op, ok: false };
    try {
      if (!r) throw new Error('unknown entity');
      if (ch.op === 'create') {
        const id = generic.create(r, user, ch.data || {}, { skipDupCheck: true });
        result.id = id; result.ok = true;
      } else if (ch.op === 'update' && ch.id) {
        generic.update(r, user, parseId(ch.id), ch.data || {});
        result.id = parseId(ch.id); result.ok = true;
      }
      d.prepare('INSERT INTO sync_log(user_id, entity_type, entity_id, op, result, created_at) VALUES(?,?,?,?,?,?)').run(user.id, ch.entity, result.id || 0, ch.op, JSON.stringify(result), ts());
    } catch (e) {
      result.error = e.code === 'DUPLICATE' ? 'duplicate' : e.message;
      d.prepare('INSERT INTO sync_log(user_id, entity_type, entity_id, op, result, created_at) VALUES(?,?,?,?,?,?)').run(user.id, ch.entity, ch.id || 0, ch.op, JSON.stringify(result), ts());
    }
    results.push(result);
  }
  return { ok: true, results };
}));
router.get('/api/sync/log', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, { items: get().prepare('SELECT * FROM sync_log WHERE user_id=? ORDER BY id DESC LIMIT 100').all(user.id) }); } catch (e) { sendError(res, e); } });
// ============ PRINT / DOCUMENT (central service) ============
// All document prints go through one central service: rich templates for the
// classic documents, the data-driven generic record document for everything else.
// RBAC: the user needs at least entity:view for the printed record.
function printOptsFromUrl(u, user) {
  const { fmtDate, nowIso } = require('./lib/util');
  return {
    header: u.searchParams.get('header') !== '0',
    landscape: u.searchParams.get('landscape') === '1',
    printUser: user ? user.full_name : '',
    printMeta: { at: fmtDate(nowIso(), { time: true, fa: false }) + ' ' + new Date().toTimeString().slice(0, 5), user: user ? user.full_name : '' },
    autoPrint: u.searchParams.get('autoprint') === '1',
  };
}
function printRoute(entityKey, titleFa) {
  return (req, res) => {
    try {
      const user = requireUser(req, res);
      const r = reg(entityKey);
      if (!r) throw new HttpError(404, 'NOT_FOUND', titleFa + ' پیدا نشد.');
      requirePermFor(user, entityKey, 'view');
      const id = parseId(req.params.id);
      // row-level scope (IDOR guard): the record must be inside the user's scope
      const row = get().prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
      if (row) generic.assertRowScope(r, user, row, 'view');
      const u = new URL(req.url, 'http://x');
      const pOpts = printOptsFromUrl(u, user);
      const html = printMod.getDocHtml(entityKey, id, pOpts);
      if (!html) throw new HttpError(404, 'NOT_FOUND', titleFa + ' پیدا نشد.');
      try { require('./core/audit').audit(user, entityKey, parseId(req.params.id), 'print', null, { header: pOpts.header !== false, format: 'print' }, ''); } catch { }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (e) { sendError(res, e); }
  };
}
router.get('/api/print/quote/:id', printRoute('quote', 'پیش‌فاکتور'));
router.get('/api/print/invoice/:id', printRoute('invoice', 'فاکتور'));
router.get('/api/print/order/:id', printRoute('order', 'سفارش'));
router.get('/api/print/lab/:id', printRoute('lab_request', 'درخواست آزمایش'));
router.get('/api/print/contract/:id', printRoute('contract', 'قرارداد'));
// central record print for ANY module (generic professional record document)
router.get('/api/print/record/:entity/:id', (req, res) => {
  try {
    const user = requireUser(req, res);
    const r = reg(req.params.entity);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
    requirePermFor(user, r.entity, 'view');
    const id = parseId(req.params.id);
    // row-level scope (IDOR guard): the record must be inside the user's scope
    const row = get().prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
    if (row) generic.assertRowScope(r, user, row, 'view');
    const u = new URL(req.url, 'http://x');
    const pOpts = printOptsFromUrl(u, user);
    const html = printMod.getDocHtml(r.entity, id, pOpts);
    if (!html) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
    try { require('./core/audit').audit(user, r.entity, parseId(req.params.id), 'print', null, { header: pOpts.header !== false, format: 'print', central: 1 }, ''); } catch { }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (e) { sendError(res, e); }
});
// central list print for ANY module (same filters as the list page → real filtered output)
router.get('/api/print/list/:entity', (req, res) => {
  try {
    const user = requireUser(req, res);
    const r = reg(req.params.entity);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
    requirePermFor(user, r.entity, 'view');
    const u = new URL(req.url, 'http://x');
    const q = Object.fromEntries(u.searchParams.entries());
    const out = generic.exportResource(r, user, q, 'html');
    res.writeHead(200, { 'Content-Type': out.mime || 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(out.data);
  } catch (e) { sendError(res, e); }
});
// ============ MISC ============
router.get('/api/meta/options', (req, res) => {
  try {
    requireUser(req, res);
    const { OPT } = require('./api/resources');
    const resources = {};
    for (const [k, v] of Object.entries(R)) {
      resources[k] = {
        key: k, table: v.table || null,
        nameFa: v.nameFa, nameEn: v.nameEn, singularFa: v.singularFa,
        fields: (v.fields || []).map(f => ({ key: f.key, label: f.label, type: f.type, options: typeof f.options === 'string' ? f.options : (f.options || []), required: f.required, list: f.list, filter: f.filter, readonly: f.readonly, default: f.default, ref: f.ref, defaultNow: f.defaultNow })),
        detailTabs: v.detailTabs || [],
        dupFields: v.dupFields || null,
        bulkFields: bulk.bulkFieldsFor(k).map(f => ({ key: f.key, label: f.label, type: f.type, options: typeof f.options === 'string' ? f.options : (f.options || []), required: f.required })),
        lines: v.lines ? { refKey: v.lines.refKey, fields: v.lines.fields.map(f => ({ key: f.key, label: f.label, type: f.type, options: typeof f.options === 'string' ? f.options : (f.options || []), required: f.required, default: f.default, ref: f.ref })) } : null,
      };
    }
    sendJson(res, 200, { options: OPT, resources });
  } catch (e) { sendError(res, e); }
});
router.get('/api/health', (req, res) => sendJson(res, 200, { ok: true, time: ts(), db: 'ok' }));
router.post('/api/admin/demo-data/delete', (req, res) => {
  try {
    const user = requireUser(req, res);
    requirePermFor(user, 'settings', 'edit');
    const d = get();
    const tables = ['complaint_events','lab_results','stock_alerts','stock_transactions','loyalty_transactions','campaign_recipients','po_items','opportunity_items','quote_items','order_items','invoice_items','comments','attachments','activities','audit_logs','entity_tags','search_map','search_index','payments','warranties','contracts','tickets','complaints','lab_requests','purchase_orders','suppliers','followups','tasks','meetings','campaigns','opportunity_items','quotes','orders','invoices','leads','opportunities','pipeline_stages','pipelines','price_list_items','price_lists','customer_contacts','products','documents','commissions','ai_messages','ai_conversations','wf_steps','wf_instances','wf_versions','wf_processes','report_templates','ai_logs'];
    const tx = d.transaction(() => {
      for (const t of tables) { try { d.prepare(`DELETE FROM ${t}`).run(); } catch {} }
      d.prepare('DELETE FROM customers').run();
      d.prepare('UPDATE loyalty_accounts SET points_balance=0, points_earned=0 WHERE 1').run();
    });
    tx();
    require('./db/db').setSetting('demo_data', false);
    audit(user, 'settings', 0, 'demo_data_deleted', null, null);
    sendJson(res, 200, { ok: true });
  } catch (e) { sendError(res, e); }
});
router.get('/api/docs', (req, res) => {
  try {
    const user = requireUser(req, res);
    const routes = [];
    const doc = { name: 'BASPAR FOAM SMART CRM API', version: '1.0.0', base: '/api', auth: 'Bearer JWT یا Cookie', modules: [] };
    for (const [k, v] of Object.entries(R)) doc.modules.push({ entity: v.entity, resource: k, endpoints: [`GET /api/r/${k}?q=&f_&sort=&page=&per_page=`, 'GET /api/r/' + k + '/:id', 'POST /api/r/' + k, 'PUT /api/r/' + k + '/:id', 'DELETE /api/r/' + k + '/:id?hard=', 'POST /api/r/' + k + '/:id/archive|duplicate', 'GET /api/r/' + k + '/:id/comments|tags|activities|audit|attachments|items', 'PUT /api/r/' + k + '/:id/tags|items', 'GET /api/r/' + k + '/export?format=xlsx|csv', 'POST /api/r/' + k + '/import|import/commit'] });
    doc.custom = [
      'POST /api/auth/login|refresh|logout|totp/*|forgot|reset|password', 'GET /api/me', 'GET/PUT /api/settings',
      'GET /api/notifications', 'POST /api/notifications/read', 'GET /api/search?q=', 'GET /api/dashboard?role=',
      'GET /api/pipeline/:id/board', 'POST /api/pipeline/move', 'POST /api/quotes/:id/to-order', 'POST /api/orders/:id/to-invoice',
      'GET /api/quotes/price-suggest?product_id=&customer_id=&price_list_id=&payment_stage=', 'GET /api/customers/:id/finance',
      'POST /api/payments', 'POST /api/payments/:id/refund', 'GET/POST /api/commissions', 'POST /api/commissions/:id/approve|pay|cancel',
      'GET /api/salesreports/kinds', 'GET /api/salesreports/:kind?from=&to=&customer_id=&salesperson_id=&status=', 'GET /api/salesreports/:kind/export?format=xlsx|csv|html',
      'GET /api/pricelist/:id/items', 'POST /api/pricelist/:id/item|items|duplicate', 'DELETE /api/pricelist/:id/item/:productId',
      'POST /api/commission-rules', 'PUT /api/commission-rules/:id', 'POST /api/stock/move', 'POST /api/lab/:id/report', 'GET /api/calendar',
      'POST /api/leads/:id/convert', 'GET/POST /api/customers/:id/contacts|visit',
      'GET /api/reports/sources|definitions|instances', 'POST /api/reports/run|definitions', 'GET /api/reports/definitions/:id/export',
      'POST /api/ai/chat', 'GET /api/ai/conversations|kb|rag|leads|churn|forecast|opportunities|anomalies|summary|customer/:id|config',
      'GET/POST /api/messages/conversations', 'GET/POST /api/messages/conversations/:id', 'POST /api/calls', 'POST /api/approvals',
      'POST /api/campaigns/:id/send|audience', 'POST /api/webhook/:provider', 'GET /api/outbox',
      'POST /api/customermsg/send', 'GET /api/customermsg/log', 'GET/PUT /api/customermsg/settings', 'GET/POST/PUT/DELETE /api/customermsg/templates[/:id]',
      'GET/POST/PUT /api/admin/users|roles|settings|backups|audit|custom-fields/:entity',
      'POST /api/attachments', 'GET /api/attachments/:id/download', 'POST /api/sync/batch', 'GET /api/sync/log',
      'GET /api/print/quote|invoice|order|lab|contract/:id', 'GET /api/meta/options', 'GET /api/health',
    ];
    sendJson(res, 200, doc);
  } catch (e) { sendError(res, e); }
});
// ============ WORKFLOW MANAGEMENT ============
router.get('/api/wf/modules', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.listModules()); } catch (e) { sendError(res, e); } });
router.get('/api/wf/engine/meta', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.engineMeta(user)); } catch (e) { sendError(res, e); } });
router.get('/api/wf/processes', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.listProcesses(user)); } catch (e) { sendError(res, e); } });
router.get('/api/wf/processes/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.getProcess(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/processes', withBody((req, res, user) => { try { sendJson(res, 200, wf.createProcess(user, req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.put('/api/wf/processes/:id', withBody(async (req, res, user) => { try { sendJson(res, 200, await wf.saveVersion(user, parseId(req.params.id), req._body.json || {})); } catch (e) { sendError(res, e); } }));
router.delete('/api/wf/processes/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.deleteProcess(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/processes/:id/duplicate', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.duplicateProcess(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/processes/:id/activate-version/:vid', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.activateVersion(user, parseId(req.params.id), parseId(req.params.vid))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/processes/:id/restore/:vid', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.restoreVersion(user, parseId(req.params.id), parseId(req.params.vid))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/processes/:id/validate', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.validateProcess(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.put('/api/wf/processes/:id/draft', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, wf.saveDraft(user, parseId(req.params.id), b.definition)); } catch (e) { sendError(res, e); } }));
router.get('/api/wf/processes/:id/draft', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.getDraft(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/processes/:id/publish', withBody(async (req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, await wf.saveVersion(user, parseId(req.params.id), b)); } catch (e) { sendError(res, e); } }));
router.post('/api/wf/processes/:id/test', withBody(async (req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, await wf.testProcess(user, parseId(req.params.id), b.entity_id, b.live === true)); } catch (e) { sendError(res, e); } }));
router.post('/api/wf/processes/:id/toggle', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, wf.toggleProcess(user, parseId(req.params.id), !!b.active)); } catch (e) { sendError(res, e); } }));
router.get('/api/wf/instances', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, wf.listInstances(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.get('/api/wf/executions', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); sendJson(res, 200, wf.listExecutions(user, Object.fromEntries(u.searchParams.entries()))); } catch (e) { sendError(res, e); } });
router.get('/api/wf/instances/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.getInstance(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/wf/executions/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.getExecution(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/wf/executions/:id/logs', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.getExecutionLogs(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/executions/:id/retry', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.retryExecution(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/executions/:id/cancel', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.cancelExecution(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/wf/my-tasks', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.myTasks(user)); } catch (e) { sendError(res, e); } });
router.post('/api/wf/instances/:id/step/:stepId/complete', withBody(async (req, res, user) => { try { const b = req._body.json || {}; const r = await wf.completeStep(user, parseId(req.params.id), parseId(req.params.stepId), b); sendJson(res, 200, r); } catch (e) { sendError(res, e); } }));
router.post('/api/wf/instances/:id/terminate', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.terminateInstance(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/wf/score', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.scoreForWorkflow(user)); } catch (e) { sendError(res, e); } });
router.get('/api/wf/entity/:module/:id/instances', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.instanceForEntity(user, req.params.module, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
// read-only export for the Workflow module (processes or executions) — central renderer, RBAC: workflow:monitor
router.get('/api/wf/export', (req, res) => {
  try {
    const user = requireUser(req, res);
    require('./auth/auth').requirePerm(user, 'workflow', 'monitor');
    const u = new URL(req.url, 'http://x');
    const scope = u.searchParams.get('scope') === 'executions' ? 'executions' : 'processes';
    const format = ['xlsx', 'csv', 'json', 'html'].includes(u.searchParams.get('format')) ? u.searchParams.get('format') : 'xlsx';
    const headerOn = u.searchParams.get('header') !== '0';
    const d = get();
    let title, sheetName, headers, rows;
    if (scope === 'executions') {
      const rowsDb = d.prepare(`SELECT i.*, p.name AS process_name FROM wf_instances i JOIN wf_processes p ON p.id=i.process_id ORDER BY i.id DESC LIMIT 10000`).all();
      const statusFa = { pending: 'در انتظار', running: 'در حال اجرا', waiting: 'در انتظار', completed: 'تکمیل‌شده', rejected: 'ردشده', terminated: 'متوقف‌شده', failed: 'ناموفق', cancelled: 'لغوشده' };
      headers = ['شناسه', 'شماره اجرا', 'فرآیند', 'ماژول', 'رکورد', 'عنوان', 'وضعیت', 'گره فعلی', 'تاریخ شروع (شمسی)'];
      rows = rowsDb.map(i => [i.id, i.execution_no || '—', i.process_name || '', i.module || '', i.entity_id || '', i.title || '', statusFa[i.status] || i.status || '', i.current_node_id || '—', i.started_at ? require('./lib/util').fmtDate(i.started_at, { time: true }) : '—']);
      title = 'اجراهای Workflow'; sheetName = 'اجراها';
    } else {
      const rowsDb = d.prepare(`SELECT p.*, (SELECT COUNT(*) FROM wf_instances i WHERE i.process_id=p.id) AS runs FROM wf_processes p ORDER BY p.id`).all();
      headers = ['شناسه', 'نام فرآیند', 'ماژول', 'رویداد فعال‌ساز', 'وضعیت', 'نسخه فعلی', 'تعداد اجرا'];
      rows = rowsDb.map(p => [p.id, p.name, p.module || '', p.trigger_event || '', p.active ? 'فعال' : 'غیرفعال', p.current_version || '', p.runs || 0]);
      title = 'فرآیندهای Workflow'; sheetName = 'فرآیندها';
    }
    const { render } = require('./api/custom/exporter');
    const { fmtDateLong, nowIso } = require('./lib/util');
    const out = render(format, title, 'workflow-' + scope + '-' + nowIso().slice(0, 10).replace(/-/g, ''), [{ name: sheetName, headers, rows }], { header: headerOn, printUser: user.full_name });
    try { require('./core/audit').audit(user, 'workflow', 0, 'export', null, { format, scope, rows: rows.length, header: headerOn }, ''); } catch { }
    if (out.disposition === 'inline') { res.writeHead(200, { 'Content-Type': out.mime, 'Cache-Control': 'no-store' }); res.end(out.buf); }
    else { res.writeHead(200, { 'Content-Type': out.mime, 'Content-Disposition': 'attachment; filename="' + out.fileName + '"', 'Cache-Control': 'no-store' }); res.end(out.buf); }
  } catch (e) { sendError(res, e); }
});
router.post('/api/wf/entity/:module/:id/start', withBody(async (req, res, user) => { try { sendJson(res, 200, await wf.startForEntity(user, req.params.module, parseId(req.params.id))); } catch (e) { sendError(res, e); } }));
router.post('/api/wf/processes/:id/start-entity', withBody(async (req, res, user) => { try { const b = req._body.json || {}; const m = wf.processModuleById(parseId(req.params.id)) || 'complaint'; sendJson(res, 200, await wf.startInstance(user, parseId(req.params.id), m, b.entity_id)); } catch (e) { sendError(res, e); } }));
router.get('/api/wf/designer/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, wf.getProcess(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/wf/ai/process/:id', withBody(async (req, res, user) => { try { sendJson(res, 200, await aigw.analyzeProcess(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } }));
router.get('/api/advreports/sources', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, advreports.listSources(user)); } catch (e) { sendError(res, e); } });
router.post('/api/advreports/run', withBody(async (req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, advreports.runReport(user, b)); } catch (e) { sendError(res, e); } }));
router.get('/api/advreports/templates', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, advreports.listTemplates(user)); } catch (e) { sendError(res, e); } });
router.post('/api/advreports/templates', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, advreports.saveTemplate(user, b)); } catch (e) { sendError(res, e); } }));
router.get('/api/advreports/templates/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, advreports.getTemplate(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.delete('/api/advreports/templates/:id', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, advreports.deleteTemplate(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/advreports/templates/:id/favorite', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, advreports.toggleFavorite(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.post('/api/advreports/templates/:id/run', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, advreports.runTemplate(user, parseId(req.params.id))); } catch (e) { sendError(res, e); } });
router.get('/api/advreports/templates/:id/export', (req, res) => { try { const user = requireUser(req, res); const u = new URL(req.url, 'http://x'); const fmt = u.searchParams.get('format') || 'xlsx'; const out = advreports.exportTemplate(user, parseId(req.params.id), fmt, {}); const CT = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', doc: 'application/msword' }; res.writeHead(200, { 'Content-Type': CT[out.type] || 'application/octet-stream', 'Content-Disposition': (out.type === 'html' ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(out.fileName) + '"' }); res.end(out.data); } catch (e) { sendError(res, e); } });
router.post('/api/advreports/export', withBody(async (req, res, user) => { try { const b = req._body.json || {}; const out = advreports.exportReport(user, b.definition || b, b.format || 'xlsx', b.template || {}); const CT = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', doc: 'application/msword' }; res.writeHead(200, { 'Content-Type': CT[out.type] || 'application/octet-stream', 'Content-Disposition': (out.type === 'html' ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(out.fileName) + '"' }); res.end(out.data); } catch (e) { sendError(res, e); } }));
router.post('/api/advreports/preview', withBody(async (req, res, user) => { try { const b = req._body.json || {}; const out = advreports.exportReport(user, b.definition || b, 'html', b.template || {}); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(out.data); } catch (e) { sendError(res, e); } }));
router.post('/api/advreports/assistant', withBody(async (req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, await aireport.reportAssistant(user, b.query || '')); } catch (e) { sendError(res, e); } }));
// ============ AI GATEWAY (unified) ============
router.get('/api/ai2/settings', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, aigw.settings()); } catch (e) { sendError(res, e); } });
router.put('/api/ai2/settings', withBody((req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, aigw.saveSettings(user, b)); } catch (e) { sendError(res, e); } }));
router.post('/api/ai2/test', withBody(async (req, res, user) => { try { sendJson(res, 200, await aigw.testConnection(user)); } catch (e) { sendError(res, e); } }));
// ============ Integration Center: REAL connection tests (honest status — never fake) ============
router.post('/api/integrations/:key/test', async (req, res) => {
  try {
    const user = requireUser(req, res);
    requirePermFor(user, 'settings', 'view');
    const key = String(req.params.key);
    if (key === 'ai') { const r = await aigw.testConnection(user); sendJson(res, 200, r); return; }
    if (key === 'voip') { const r = await voip.testConnection(user); sendJson(res, 200, { status: r.ok ? 'connected' : 'connection_failed', detail: r.message, mode: r.mode }); return; }
    const cfg = getSetting(key, null);
    const st = (cfg && cfg.settings) || {};
    const base = String(st.baseUrl || '').replace(/\/+$/, '');
    if (!cfg || !cfg.active || !base) { sendJson(res, 200, { status: 'not_configured' }); return; }
    let method = 'POST', pathPart = '';
    if (key === 'telegram') { method = 'GET'; pathPart = '/bot' + encodeURIComponent(String(st.token || '')) + '/getMe'; }
    const url = base + pathPart;
    let host = ''; try { host = new URL(base).host; } catch { host = '(نامعتبر)'; }
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (st.apiKey && key !== 'telegram') headers['Authorization'] = 'Bearer ' + String(st.apiKey);
      const r2 = await fetch(url, { method, headers, body: method === 'POST' ? '{}' : undefined, signal: ctrl.signal, redirect: 'manual' });
      const ok = r2.status < 500;
      const out = { status: ok ? 'connected' : 'connection_failed', http_status: r2.status, host };
      if (key === 'telegram') { try { const j = await r2.json(); out.api_ok = !!j.ok; out.username = j.result && j.result.username; } catch { out.api_ok = false; } }
      audit(user, 'integration', 0, 'test_' + key, null, { status: out.status, http_status: r2.status });
      sendJson(res, 200, out);
    } catch (e) {
      const out = { status: 'connection_failed', host, error: String(e.message || e).slice(0, 120) };
      audit(user, 'integration', 0, 'test_' + key, null, { status: out.status });
      sendJson(res, 200, out);
    } finally { clearTimeout(to); }
  } catch (e) { sendError(res, e); }
});
router.get('/api/ai2/logs', (req, res) => { try { const user = requireUser(req, res); sendJson(res, 200, aigw.listLogs(user)); } catch (e) { sendError(res, e); } });
router.get('/api/ai2/modules', (req, res) => { try { requireUser(req, res); sendJson(res, 200, { modules: ['customer', 'complaint', 'order', 'invoice', 'lead', 'opportunity', 'lab_request', 'workflow', 'calendar'] }); } catch (e) { sendError(res, e); } });
router.get('/api/ai2/module/:module/:id', withBody(async (req, res, user) => { try { sendJson(res, 200, await aigw.analyze(user, req.params.module, parseId(req.params.id))); } catch (e) { sendError(res, e); } }));
router.post('/api/ai2/report', withBody(async (req, res, user) => { try { const b = req._body.json || {}; sendJson(res, 200, await aireport.reportAssistant(user, b.query || '')); } catch (e) { sendError(res, e); } }));
// ============ SERVER ============
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return sendError(res, new HttpError(400, 'BAD_URL', 'آدرس نامعتبر است.')); }
  const p = url.pathname;
  // security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
  // ---- Stage 2 security hardening (backend-only; zero functional change) ----
  // Clickjacking: X-Frame-Options (env overridable; default DENY for production).
  // The Arena sandbox viewer embeds the app in a cross-origin iframe, so sandbox
  // deployments may set X_FRAME_OPTIONS=ALLOWALL — production keeps the DENY default.
  const framePolicy = (process.env.X_FRAME_OPTIONS || 'DENY').toUpperCase();
  if (framePolicy === 'DENY' || framePolicy === 'SAMEORIGIN' || framePolicy === 'ALLOWALL') {
    res.setHeader('X-Frame-Options', framePolicy);
  }
  // HSTS (browser-ignored on plain HTTP; active once behind TLS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-XSS-Protection', '0');
  // CSP — crafted to match the frozen frontend (it uses an inline boot script +
  // inline styles); frame-ancestors mirrors X-Frame-Options.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (framePolicy === 'DENY') csp.push("frame-ancestors 'none'");
  else if (framePolicy === 'SAMEORIGIN') csp.push("frame-ancestors 'self'");
  res.setHeader('Content-Security-Policy', csp.join('; '));
  // CSRF defense-in-depth: browsers always send Origin on cross-origin mutations;
  // an Origin that does not match Host can never be legitimate for this app (same-origin SPA).
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') {
    const origin = req.headers['origin'];
    if (origin) {
      let oHost = '';
      try { oHost = new URL(origin).host.toLowerCase(); } catch { /* opaque origin (file://) → treat as mismatch */ oHost = '__opaque__'; }
      const hHost = String(req.headers['host'] || '').toLowerCase();
      if (oHost && oHost !== hHost) {
        console.error('[security] origin mismatch blocked: ' + req.method + ' ' + p + ' origin=' + origin + ' host=' + hHost);
        return sendError(res, new HttpError(403, 'ORIGIN_MISMATCH', 'درخواست از مبدأ مجاز ارسال نشده است.'));
      }
    }
  }
  // ---- production health check (public by design: no auth, no sensitive data) ----
  if (req.method === 'GET' && (p === '/health' || p === '/healthz')) {
    let dbOk = false;
    try { get().prepare('SELECT 1').get(); dbOk = true; } catch { dbOk = false; }
    const payload = { status: dbOk ? 'ok' : 'degraded', db: dbOk, uptime_sec: Math.round(process.uptime()), time: new Date().toISOString() };
    res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(payload));
  }
  if (p.startsWith('/api/')) {
    if (!rateLimit((req.socket.remoteAddress || '') + ':' + p, 300, 60000)) {
      return sendError(res, new HttpError(429, 'RATE_LIMIT', 'درخواست‌های زیادی ارسال کردید.'));
    }
    const m = router.match(req.method, p);
    if (m) {
      if (typeof m.handler !== 'function') { console.error('BAD ROUTE', req.method, p, Object.keys(m)); res.writeHead(500); return res.end(); }
      req.params = m.params;
      try { await m.handler(req, res); } catch (e) { sendError(res, e); }
      return;
    }
    return sendError(res, new HttpError(404, 'NOT_FOUND', 'مسیر API پیدا نشد.'), false);
  }
  // static
  let file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
  file = path.normalize(file);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!path.extname(p)) file = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 — فایل پیدا نشد.'); }
  }
  serveStatic(req, res, file);
});
// websocket
getHub().attach(server);
// Wire the notification core to the live WS hub: every notify() is pushed
// to the user's open sessions in real time (bell count + live toast).
require('./core/notify').setWsHub(getHub());
// Production: set HOST=127.0.0.1 to keep the app off the public interface
// (reverse proxy on 80/443 forwards to it). Default 0.0.0.0 = dev/sandbox.
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = (process.env.NODE_ENV || '') === 'production';
// Stage 3 hardening, re-applied idempotently at every start (FS snapshots/tools
// may reset modes): data dir 700, DB file 600 — the DB holds all secrets/credentials.
try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* read-only fs in some envs */ }
try { fs.chmodSync(DB_PATH, 0o600); } catch { /* file may not exist yet on first run */ }
server.listen(PORT, HOST, () => {
  console.log(`\n  ◈ BASPAR FOAM SMART CRM ${IS_PROD ? '(PRODUCTION)' : '(development)'}`);
  console.log(`  → http://${HOST}:${PORT}${IS_PROD ? '' : '\n  ⚠ production: set NODE_ENV=production و HOST=127.0.0.1 پشت Reverse Proxy'}\n`);
  scheduler.start();
});
process.on('uncaughtException', (e) => console.error('[uncaught]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
