'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { get, DB_PATH, DATA_DIR, getSetting, setSetting, getUserSetting, setUserSetting } = require('../../db/db');
const { hashPassword, totpSecret, totpVerify, randomToken, sha256, encSecret, decSecret } = require('../../lib/crypto');
const { requirePerm, PERM_ACTIONS, publicUser } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { HttpError } = require('../../lib/http');
const { nowIso, fmtDateLong } = require('../../lib/util');
const { notify, notifyAll } = require('../../core/notify');

// ---------------- Users ----------------
function listUsers(user, q) {
  requirePerm(user, 'user', 'view');
  const d = get();
  const where = ['u.archived_at IS NULL'], params = [];
  if (q.q) { where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)'); const t = '%' + q.q + '%'; params.push(t, t, t); }
  const rows = d.prepare(`SELECT u.*, (SELECT GROUP_CONCAT(r.name) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id) role_names FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT 200`).all(...params);
  return { items: rows.map(r => ({ ...r, password_hash: undefined, totp_secret: undefined })) };
}
function createUser(user, data) {
  requirePerm(user, 'user', 'create');
  const d = get();
  if (d.prepare('SELECT id FROM users WHERE username=?').get(data.username)) throw new HttpError(409, 'EXISTS', 'این نام کاربری قبلاً ثبت شده است.');
  const pw = data.password || randomToken(4);
  const info = d.prepare('INSERT INTO users(username, email, phone, password_hash, full_name, department, active, must_change_password, created_by, created_at, updated_by, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)')
    .run(data.username, data.email || '', data.phone || '', hashPassword(pw), data.full_name || data.username, data.department || '', 1, 1, user.id, nowIso(), user.id, nowIso());
  const id = Number(info.lastInsertRowid);
  const roleIds = Array.isArray(data.role_ids) ? data.role_ids : [];
  for (const rid of roleIds) {
    const n = parseInt(rid, 10);
    if (Number.isFinite(n) && d.prepare('SELECT id FROM roles WHERE id=?').get(n)) d.prepare('INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES(?,?)').run(id, n);
  }
  audit(user, 'user', id, 'create', null, { username: data.username, roles: roleIds });
  notify(id, 'account', 'حساب کاربری شما ساخته شد', `رمز عبور اولیه: ${pw}. پس از ورود، آن را تغییر دهید.`, 'user', id);
  return { id, temp_password: pw };
}
function updateUser(user, id, data) {
  requirePerm(user, 'user', 'edit');
  const d = get();
  const before = d.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'کاربر پیدا نشد.');
  const keys = [];
  const vals = [];
  const allowed = ['email', 'phone', 'full_name', 'department', 'active', 'must_change_password', 'avatar'];
  for (const k of allowed) if (data[k] !== undefined) { keys.push(k + '=?'); vals.push(k === 'active' ? (data[k] ? 1 : 0) : data[k]); }
  if (data.password) { keys.push('password_hash=?', 'must_change_password=?'); vals.push(hashPassword(data.password), 0); }
  if (data.totp_enable === true) {
    const sec = before.totp_secret || totpSecret();
    keys.push('totp_secret=?', 'totp_enabled=?'); vals.push(sec, 0);
  }
  if (data.totp_disable === true) { keys.push('totp_enabled=?'); vals.push(0); }
  if (keys.length) {
    d.prepare(`UPDATE users SET ${keys.join(',')}, updated_at=?, updated_by=? WHERE id=?`).run(...vals, nowIso(), user.id, id);
    audit(user, 'user', id, 'update', null, Object.keys(data).filter(k => k !== 'password'));
  }
  if (Array.isArray(data.role_ids)) {
    d.prepare('DELETE FROM user_roles WHERE user_id=?').run(id);
    for (const rid of data.role_ids) {
      const n = parseInt(rid, 10);
      if (Number.isFinite(n) && d.prepare('SELECT id FROM roles WHERE id=?').get(n)) d.prepare('INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES(?,?)').run(id, n);
    }
    audit(user, 'user', id, 'roles', null, data.role_ids);
  }
  return { ok: true };
}
function removeUser(user, id, hard) {
  requirePerm(user, 'user', 'delete');
  const d = get();
  if (id === user.id) throw new HttpError(400, 'SELF', 'نمی‌توانید حساب خود را حذف کنید.');
  if (hard) {
    d.prepare('DELETE FROM user_roles WHERE user_id=?').run(id);
    d.prepare('DELETE FROM users WHERE id=?').run(id);
    audit(user, 'user', id, 'delete_hard', null, null);
  } else {
    d.prepare('UPDATE users SET archived_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), id);
    audit(user, 'user', id, 'archive', null, null);
  }
  return { ok: true };
}
// ---------------- Roles & Permissions ----------------
function listRoles(user) {
  requirePerm(user, 'role', 'view');
  const d = get();
  const roles = d.prepare('SELECT * FROM roles ORDER BY id').all();
  const rp = d.prepare('SELECT rp.role_id, p.id, p.entity, p.action, rp.scope FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id').all();
  const ur = d.prepare('SELECT user_id, role_id FROM user_roles').all();
  for (const r of roles) {
    r.permissions = rp.filter(x => x.role_id === r.id).map(x => ({ entity: x.entity, action: x.action, scope: x.scope }));
    r.user_count = ur.filter(x => x.role_id === r.id).length;
  }
  const perms = d.prepare('SELECT DISTINCT entity, action FROM permissions ORDER BY entity, action').all();
  return { roles, entities: [...new Set(perms.map(p => p.entity))], actions: PERM_ACTIONS };
}
function saveRole(user, roleId, data) {
  requirePerm(user, 'role', 'edit');
  const d = get();
  const role = d.prepare('SELECT * FROM roles WHERE id=?').get(roleId);
  if (!role) throw new HttpError(404, 'NOT_FOUND', 'نقش پیدا نشد.');
  if (role.is_system && data.name && data.name !== role.name) throw new HttpError(400, 'SYSTEM', 'نام نقش سیستمی قابل تغییر نیست.');
  if (data.name_fa !== undefined) d.prepare('UPDATE roles SET name_fa=?, description=? WHERE id=?').run(data.name_fa, data.description || '', roleId);
  if (Array.isArray(data.permissions)) {
    d.prepare('DELETE FROM role_permissions WHERE role_id=?').run(roleId);
    const ins = d.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope) VALUES(?,?,?)');
    for (const p of data.permissions) {
      const row = d.prepare('SELECT id FROM permissions WHERE entity=? AND action=?').get(p.entity, p.action);
      if (row) ins.run(roleId, row.id, ['own', 'team', 'department', 'all'].includes(p.scope) ? p.scope : 'all');
    }
    audit(user, 'role', roleId, 'permissions', null, { count: data.permissions.length });
  }
  return { ok: true };
}
function createRole(user, data) {
  requirePerm(user, 'role', 'create');
  const d = get();
  if (!data.name || !data.name_fa) throw new HttpError(422, 'VALIDATION', 'نام نقش الزامی است.');
  if (d.prepare('SELECT id FROM roles WHERE name=?').get(data.name)) throw new HttpError(409, 'EXISTS', 'این نقش وجود دارد.');
  const info = d.prepare('INSERT INTO roles(name, name_fa, description, created_at) VALUES(?,?,?,?)').run(data.name, data.name_fa, data.description || '', nowIso());
  const rid = Number(info.lastInsertRowid);
  if (Array.isArray(data.permissions)) {
    const ins = d.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope) VALUES(?,?,?)');
    for (const p of data.permissions) {
      const row = d.prepare('SELECT id FROM permissions WHERE entity=? AND action=?').get(p.entity, p.action);
      if (row) ins.run(rid, row.id, ['own', 'team', 'department', 'all'].includes(p.scope) ? p.scope : 'all');
    }
  }
  audit(user, 'role', rid, 'create', null, data);
  return { id: rid };
}
function removeRole(user, id) {
  requirePerm(user, 'role', 'delete');
  const d = get();
  const r = d.prepare('SELECT * FROM roles WHERE id=?').get(id);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'نقش پیدا نشد.');
  if (r.is_system) throw new HttpError(400, 'SYSTEM', 'نقش سیستمی قابل حذف نیست.');
  d.prepare('DELETE FROM role_permissions WHERE role_id=?').run(id);
  d.prepare('DELETE FROM user_roles WHERE role_id=?').run(id);
  d.prepare('DELETE FROM roles WHERE id=?').run(id);
  audit(user, 'role', id, 'delete', null, null);
  return { ok: true };
}
// ---------------- Settings ----------------
function getSettings(user) {
  requirePerm(user, 'settings', 'view');
  const out = {};
  for (const k of Object.keys(getAllSettings())) out[k] = getAllSettings()[k];
  return out;
}
function getAllSettings() {
  const keys = ['company', 'tax_rate', 'currency', 'numerals', 'sla_complaints', 'loyalty_earn_rate', 'ai_provider', 'sms', 'email', 'whatsapp', 'telegram', 'payment_gateway', 'accounting', 'tax_system', 'custom_fields', 'demo_data'];
  const out = {};
  for (const k of keys) out[k] = getSetting(k, k === 'company' ? {} : null);
  return out;
}
function saveSettings(user, data) {
  requirePerm(user, 'settings', 'edit');
  const protectedKeys = ['ai_provider', 'sms', 'email', 'whatsapp', 'telegram', 'payment_gateway', 'accounting', 'tax_system'];
  for (const k of Object.keys(data)) {
    if (k === 'ai_provider') {
      const v = { ...data[k] };
      if (v.apiKey) v.apiKey = encSecret(v.apiKey);
      setSetting('ai_provider', v);
    } else if (protectedKeys.includes(k) && typeof data[k] === 'object' && data[k] && data[k].settings) {
      const v = { ...data[k], settings: { ...data[k].settings } };
      for (const sk of ['apiKey', 'api_key', 'token', 'password', 'secret']) if (v.settings[sk]) v.settings[sk] = encSecret(v.settings[sk]);
      setSetting(k, v);
    } else {
      setSetting(k, data[k]);
    }
  }
  audit(user, 'settings', 0, 'update', null, Object.keys(data));
  return { ok: true };
}
// ---------------- Audit log ----------------
function listAudit(user, q) {
  requirePerm(user, 'audit_log', 'view');
  const d = get();
  const where = [], params = [];
  if (q.entity) { where.push('entity=?'); params.push(q.entity); }
  if (q.user) { where.push('username=?'); params.push(q.user); }
  if (q.q) { where.push('(action LIKE ? OR old_value LIKE ? OR new_value LIKE ?)'); const t = '%' + q.q + '%'; params.push(t, t, t); }
  const total = d.prepare(`SELECT COUNT(*) c FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params).c;
  const rows = d.prepare(`SELECT * FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...params);
  return { items: rows, total };
}
// ---------------- Backup / Restore ----------------
// ---- Backup Manager: location, encryption (AES-256-GCM), status ----
const BSBK_MAGIC = 'BSBK1';
function backupKey() {
  // encryption key: env BACKUP_KEY (hex, 32/64 chars) — never stored in DB, never logged
  const k = String(process.env.BACKUP_KEY || '');
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, 'hex');
  if (/^[0-9a-f]{32}$/i.test(k)) {
    // 16-byte key → derive 32-byte key via SHA-256
    return require('crypto').createHash('sha256').update(k, 'hex').digest();
  }
  return null;
}
function backupDir() {
  const custom = String(getSetting('backup_dir', '') || '').trim();
  if (!custom) return path.join(DATA_DIR, 'backups');
  const base = path.resolve(custom);
  // must be an absolute path, no parent traversal beyond its own root
  if (!base || base.includes('..')) throw new HttpError(400, 'BAD_DIR', 'مسیر بکاپ معتبر نیست.');
  return base;
}
function encryptBackup(buf, dest) {
  const key = backupKey();
  if (!key) return { encrypted: false };
  const crypto = require('crypto');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  const tag = c.getAuthTag();
  fs.writeFileSync(dest, Buffer.concat([Buffer.from(BSBK_MAGIC + '|' + iv.toString('hex') + '|' + tag.toString('hex') + '|', 'ascii'), enc]));
  try { fs.chmodSync(dest, 0o600); } catch {}
  return { encrypted: true };
}
function decryptBackup(file) {
  const raw = fs.readFileSync(file);
  if (raw.toString('ascii', 0, 5) !== BSBK_MAGIC) return { encrypted: false, data: raw };
  const key = backupKey();
  if (!key) throw new HttpError(400, 'NO_KEY', 'فایل بکاپ رمزنگاری‌شده است اما BACKUP_KEY تنظیم نشده است.');
  const crypto = require('crypto');
  const parts = raw.toString('ascii', 0, 1000).split('|');
  const iv = Buffer.from(parts[1], 'hex'), tag = Buffer.from(parts[2], 'hex');
  const headLen = 5 + 1 + iv.length * 2 + 1 + tag.length * 2 + 1;
  const enc = raw.slice(headLen);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return { encrypted: true, data: Buffer.concat([d.update(enc), d.final()]) };
}
function listBackups(user) {
  requirePerm(user, 'backup', 'view');
  const d = get();
  const items = d.prepare('SELECT * FROM backups ORDER BY id DESC').all();
  let lastSuccess = null, lastFailed = null;
  for (const b of items) {
    if (!lastSuccess && b.status === 'success') lastSuccess = b;
    if (!lastFailed && b.status === 'failed') lastFailed = b;
    if (lastSuccess && lastFailed) break;
  }
  return { items, last_success: lastSuccess, last_failed: lastFailed, dir: backupDir(), encrypted: backupKey() !== null };
}
function saveBackupSettings(user, b) {
  requirePerm(user, 'backup', 'edit');
  const sched = b.schedule || {};
  const freq = ['daily', 'weekly', 'monthly'].includes(sched.freq) ? sched.freq : 'daily';
  const hour = Math.min(23, Math.max(0, Number(sched.hour) || 2));
  const day = Math.min(7, Math.max(1, Number(sched.day) || 1));
  const dom = Math.min(28, Math.max(1, Number(sched.day_of_month) || 1));
  setSetting('backup_schedule', { freq, hour, day, day_of_month: dom });
  if (b.retention_days !== undefined) setSetting('backup_retention_days', Math.min(365, Math.max(1, Number(b.retention_days) || 30)));
  if (b.backup_dir !== undefined) {
    const dir = String(b.backup_dir || '').trim();
    if (dir) {
      if (!path.isAbsolute(dir)) throw new HttpError(400, 'BAD_DIR', 'مسیر بکاپ باید مطلق باشد (مثلاً /var/backups/baspar-crm).');
      fs.mkdirSync(dir, { recursive: true });
      try { fs.accessSync(dir, fs.constants.W_OK); } catch { throw new HttpError(400, 'BAD_DIR', 'به مسیر بکاپ دسترسی نوشتن نیست.'); }
      setSetting('backup_dir', dir);
    } else setSetting('backup_dir', '');
  }
  audit(user, 'backup', 0, 'settings_update', null, { freq, hour, day, day_of_month: dom, retention_days: Number(b.retention_days) || 30, backup_dir: b.backup_dir ? String(b.backup_dir) : '(default)' }, '');
  return { ok: true, schedule: { freq, hour, day, day_of_month: dom }, retention_days: Number(b.retention_days) || 30, backup_dir: String(getSetting('backup_dir', '') || '') || '(default)' };
}
function createBackup(user) {
  if (user) requirePerm(user, 'backup', 'edit');
  const d = get();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `baspar-backup-${stamp}`;
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, base + '.sqlite');
  try {
    // checkpoint WAL then consistent file copy (safe on a quiesced snapshot window)
    const Database = require('better-sqlite3');
    const src = new Database(DB_PATH, { readonly: true });
    try { src.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    src.close();
    fs.copyFileSync(DB_PATH, dest);
    // Stage 3 — backups contain the full DB (secrets included): restrictive file mode
    try { fs.chmodSync(dest, 0o600); } catch {}
    let fileName = base + '.sqlite';
    if (backupKey()) {
      const buf = fs.readFileSync(dest);
      fs.unlinkSync(dest);
      encryptBackup(buf, path.join(dir, base + '.sqlite.enc'));
      fileName = base + '.sqlite.enc';
    }
    const size = fs.statSync(path.join(dir, fileName)).size;
    const info = d.prepare('INSERT INTO backups(file_name, size, kind, created_by, created_at, status, error) VALUES(?,?,?,?,?,?,?)')
      .run(fileName, size, user && user.id ? 'manual' : 'auto', user ? user.id : 0, nowIso(), 'success', '');
    audit(user || { id: 0, username: 'system' }, 'backup', info.lastInsertRowid, 'create', null, { file: fileName, encrypted: !!backupKey() }, '');
    // retention (default 30 days, configurable)
    try {
      const days = Number(getSetting('backup_retention_days', 30)) || 30;
      const cutoff = new Date(Date.now() - days * 864e5).toISOString();
      const stale = d.prepare("SELECT id, file_name, created_at FROM backups WHERE created_at < ? AND status = 'success'").all(cutoff);
      for (const st of stale) {
        const sp = path.join(dir, st.file_name);
        if (fs.existsSync(sp)) { try { fs.unlinkSync(sp); } catch {} }
        d.prepare('DELETE FROM backups WHERE id=?').run(st.id);
        audit(user || { id: 0, username: 'system' }, 'backup', st.id, 'retention_purge', null, { file: st.file_name, retention_days: days }, '');
      }
    } catch (e) { console.error('backup retention:', e.message); }
    return { id: Number(info.lastInsertRowid), file_name: fileName, size, status: 'success', encrypted: !!backupKey() };
  } catch (e) {
    // record failure in history
    let fid = 0;
    try { fid = Number(d.prepare('INSERT INTO backups(file_name, size, kind, created_by, created_at, status, error) VALUES(?,?,?,?,?,?,?)')
      .run(base + ' (failed)', 0, user && user.id ? 'manual' : 'auto', user ? user.id : 0, nowIso(), 'failed', String(e.message).slice(0, 300))).lastInsertRowid; } catch {}
    try { audit(user || { id: 0, username: 'system' }, 'backup', fid, 'create_failed', null, { error: String(e.message).slice(0, 200) }, ''); } catch {}
    if (user) throw new HttpError(500, 'BACKUP_FAILED', 'بکاپ با خطا مواجه شد.');
    console.error('backup failed:', e.message);
    return { id: fid, ok: false, status: 'failed', error: e.message };
  }
}
function downloadBackup(user, id) {
  requirePerm(user, 'backup', 'view');
  const d = get();
  const b = d.prepare('SELECT * FROM backups WHERE id=?').get(id);
  if (!b) throw new HttpError(404, 'NOT_FOUND', 'بکاپ پیدا نشد.');
  // Stage 3 — defense-in-depth: only server-generated backup names, resolved inside the backups dir
  const dir = backupDir();
  const base = path.basename(b.file_name || '');
  if (!/^baspar-backup-[\d\-T ]+\.sqlite(\.enc)?$/.test(base)) throw new HttpError(404, 'NOT_FOUND', 'فایل بکاپ معتبر نیست.');
  const p = path.resolve(dir, base);
  if (!p.startsWith(path.resolve(dir) + path.sep)) throw new HttpError(404, 'NOT_FOUND', 'فایل بکاپ معتبر نیست.');
  if (!fs.existsSync(p)) throw new HttpError(404, 'NOT_FOUND', 'فایل بکاپ وجود ندارد.');
  // if encrypted and key available, decrypt to a temp file (served as plain sqlite)
  if (base.endsWith('.enc') && backupKey()) {
    const dec = decryptBackup(p);
    if (dec.encrypted) {
      const tmp = path.join(os.tmpdir(), 'bsbk-restore-' + process.pid + '-' + Date.now() + '.sqlite');
      fs.writeFileSync(tmp, dec.data);
      try { fs.chmodSync(tmp, 0o600); } catch {}
      return { path: tmp, name: base.replace('.enc', '') };
    }
  }
  return { path: p, name: base };
}
// item 9: integrity + schema/version compatibility check on a backup file BEFORE touching the live DB
function validateBackupFile(sourcePath) {
  const Database = require('better-sqlite3');
  let db;
  try { db = new Database(sourcePath, { readonly: true, fileMustExist: true }); }
  catch (e) { throw new HttpError(400, 'BAD_FILE', 'فایل بکاپ معتبر نیست یا قابل باز شدن نیست.'); }
  let migrations = 0, hasUsers = false;
  try {
    migrations = db.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c;
    hasUsers = !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
  } catch (e) {
    try { db.close(); } catch {}
    throw new HttpError(400, 'SCHEMA_MISMATCH', 'ساختار بکاپ با نسخهٔ فعلی سازگار نیست (جدول‌های اصلی یافت نشد). Restore انجام نشد.');
  }
  try { db.close(); } catch {}
  if (!hasUsers) throw new HttpError(400, 'SCHEMA_MISMATCH', 'بکاپ معتبر نیست: جدول users یافت نشد. Restore انجام نشد.');
  return { migrations, ok: true };
}
function restoreBackup(user, id) {
  requirePerm(user, 'backup', 'edit');
  const d = get();
  const b = d.prepare('SELECT * FROM backups WHERE id=?').get(id);
  if (!b) throw new HttpError(404, 'NOT_FOUND', 'بکاپ پیدا نشد.');
  const p = path.join(backupDir(), b.file_name);
  // item 13: no path traversal — only server-generated backup names inside the backups dir
  const base = path.basename(b.file_name || '');
  if (!/^baspar-backup-[\d\-T ]+\.sqlite(\.enc)?$/.test(base)) throw new HttpError(400, 'BAD_FILE', 'فایل بکاپ معتبر نیست.');
  if (!fs.existsSync(p)) throw new HttpError(404, 'NOT_FOUND', 'فایل بکاپ وجود ندارد.');
  let sourcePath = p;
  if (String(b.file_name).endsWith('.enc')) {
    const dec = decryptBackup(p);
    if (dec.encrypted) {
      const tmp = path.join(os.tmpdir(), 'bsbk-restore-' + process.pid + '-' + Date.now() + '.sqlite');
      fs.writeFileSync(tmp, dec.data);
      try { fs.chmodSync(tmp, 0o600); } catch {}
      sourcePath = tmp;
    }
  }
  if (!fs.readFileSync(sourcePath, { flag: 'r' }).slice(0, 15).toString().startsWith('SQLite format 3')) { try { if (sourcePath !== p) fs.unlinkSync(sourcePath); } catch {} throw new HttpError(400, 'BAD_FILE', 'فایل بکاپ معتبر نیست.'); }
  // item 9: validate integrity + schema compatibility BEFORE replacing the live DB
  validateBackupFile(sourcePath);
  const recoveryId = 'RC-' + Date.now().toString(36).toUpperCase() + '-' + randomToken(4).toUpperCase();
  // item 11: pre-recovery backup of the CURRENT database (rollback safety), recorded in history
  let preBackup = null;
  try {
    preBackup = createBackup(user);
    if (preBackup && preBackup.id) { try { get().prepare("UPDATE backups SET kind='pre_recovery' WHERE id=?").run(preBackup.id); } catch {} }
  } catch (e) { console.error('pre-recovery backup failed:', e.message); }
  // replace the database file SAFELY: checkpoint → detach & close the live handle FIRST
  // (never unlink a WAL out from under an open connection) → copy → unlink stale wal/shm → reopen
  const dbmod = require('../../db/db');
  try { d.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  const oldDb = dbmod.detach();
  try { if (oldDb) oldDb.close(); } catch {}
  fs.copyFileSync(sourcePath, DB_PATH);
  for (const suffix of ['-wal', '-shm']) try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  try { if (sourcePath !== p) fs.unlinkSync(sourcePath); } catch {}
  try { dbmod.open(); } catch (e) { console.error('db reopen after restore:', e.message); }
  for (const suffix of ['-wal', '-shm']) try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  const d2 = get();
  // item 15: record the recovery itself in the backup history
  try { d2.prepare('INSERT INTO backups(file_name, size, kind, created_by, created_at, status, error) VALUES(?,?,?,?,?,?,?)').run('RECOVERY → ' + base, 0, 'recovery', user.id, nowIso(), 'success', 'recovery_id=' + recoveryId); } catch {}
  // item 14: detailed audit (user, date, backup name/date, source, result, recovery id, pre-recovery backup)
  audit({ id: user.id, username: user.username }, 'backup', b.id, 'restore_success', null, { file: base, backup_date: b.created_at, source: 'restore', result: 'success', recovery_id: recoveryId, pre_recovery_backup: preBackup ? preBackup.file_name : null });
  notifyAll('system', 'بازیابی بکاپ انجام شد', `سیستم توسط ${user.full_name} از بکاپ «${base}» بازیابی شد (Recovery ${recoveryId}). لطفاً دوباره وارد شوید.`, 'backup', b.id);
  return { ok: true, restart_required: true, recovery_id: recoveryId, pre_recovery_backup: preBackup ? preBackup.file_name : null };
}
// ---------------- Custom fields ----------------
function getCustomFields(entity) {
  const all = getSetting('custom_fields', {});
  return all[entity] || [];
}
function saveCustomFields(user, entity, fields) {
  requirePerm(user, 'settings', 'edit');
  const all = getSetting('custom_fields', {}) || {};
  all[entity] = (fields || []).map(f => ({ key: String(f.key || '').replace(/[^a-z0-9_]/gi, '_'), label: f.label || f.key, type: ['text', 'number', 'date', 'select'].includes(f.type) ? f.type : 'text', options: f.options }));
  setSetting('custom_fields', all);
  audit(user, 'settings', 0, 'custom_fields', null, { entity, fields: all[entity] });
  return { ok: true, fields: all[entity] };
}
module.exports = {
  listUsers, createUser, updateUser, removeUser,
  listRoles, saveRole, createRole, removeRole,
  getSettings, saveSettings, getAllSettings, listAudit,
  listBackups, createBackup, downloadBackup, restoreBackup,
  getCustomFields, saveCustomFields,
 saveBackupSettings, encryptBackup, decryptBackup, backupKey, backupDir};
