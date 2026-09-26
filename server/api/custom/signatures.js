'use strict';
// ============ E-Signatures ============
// Each user keeps ONE personal e-signature image, tied 1:1 to their user_id.
//   - Self-service: a user uploads/draws/replaces/deletes ONLY their own
//     signature (enforced server-side; no user_id in the request body).
//   - Admin (user:edit): may VIEW any user's signature (read-only).
//   - USING a signature to sign/approve requires the `signature:approve`
//     permission (role-based, granted in Admin -> Roles) — checked by the
//     approval engine. A user can never reference another user's signature:
//     the signer's own row is the only one ever attached.
//   - Files: image types only (png/jpeg/webp), max 2MB, magic-byte verified.
//   - Access: no direct file-path exposure; download goes through
//     /api/signature/me (self) or /api/admin/users/:id/signature (admin).
const fs = require('fs');
const path = require('path');
const { get, DATA_DIR } = require('../../db/db');
const { hasPerm } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { HttpError } = require('../../lib/http');
const { nowIso, parseId } = require('../../lib/util');
function isSuperAdmin(user) {
  return !!get().prepare("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.name='super_admin'").get(user.id);
}
function requireAdmin(user) {
  if (!isSuperAdmin(user)) throw new HttpError(403, 'FORBIDDEN', 'فقط مدیر سیستم دسترسی دارد.');
}

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Map([
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ['image/jpeg', null], // sniff (FFD8FF)
  ['image/webp', Buffer.from('WEBP', 'ascii')],
]);
function sniffImage(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 2 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
function sigDir() {
  const dir = path.join(DATA_DIR, 'uploads', 'signatures');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function rowFor(user) {
  return get().prepare('SELECT * FROM user_signatures WHERE user_id=?').get(user.id);
}
// ---------- self-service ----------
function getMySignature(user) {
  const row = rowFor(user);
  if (!row) return { has_signature: false };
  return {
    has_signature: true,
    file_name: row.file_name,
    mime: row.mime,
    size: row.size,
    url: '/api/signature/me',
    updated_at: row.updated_at,
    can_sign: hasPerm(user, 'signature', 'approve').ok,
  };
}
function downloadMySignature(user, res) {
  const row = rowFor(user);
  if (!row || !fs.existsSync(row.file_path)) throw new HttpError(404, 'NOT_FOUND', 'امزای شما ثبت نشده است.');
  sendSignatureFile(res, row, user);
}
function sendSignatureFile(res, row, user) {
  const st = fs.statSync(row.file_path);
  // forced download + nosniff: a signature image is data, never rendered content
  res.writeHead(200, {
    'Content-Type': row.mime || 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': `attachment; filename="${row.file_name || 'signature.png'}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(row.file_path).pipe(res);
}
function uploadMySignature(user, file, res) {
  if (!file || !file.data) throw new HttpError(422, 'VALIDATION', 'فایل امضا لازم است.');
  if (file.data.length > MAX_SIZE) throw new HttpError(422, 'TOO_LARGE', 'حجم فایل امضا نباید بیشتر از ۲ مگابایت باشد.');
  const mime = sniffImage(file.data);
  if (!mime) throw new HttpError(422, 'BAD_TYPE', 'نوع فایل امضا نامعتبر است (فقط PNG/JPG/WEBP مجاز است).');
  const d = get();
  const old = rowFor(user);
  const name = `sig_u${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'}`;
  const dest = path.join(sigDir(), name);
  fs.writeFileSync(dest, file.data);
  const ts = nowIso();
  d.transaction(() => {
    if (old) {
      d.prepare('UPDATE user_signatures SET file_name=?, file_path=?, mime=?, size=?, updated_at=?, updated_by=? WHERE user_id=?')
        .run(name, dest, mime, file.data.length, ts, user.id, user.id);
      try { fs.unlinkSync(old.file_path); } catch { /* orphan file cleanup best-effort */ }
    } else {
      d.prepare('INSERT INTO user_signatures(user_id, file_name, file_path, mime, size, created_at, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?)')
        .run(user.id, name, dest, mime, file.data.length, ts, ts, user.id);
    }
  })();
  audit(user, 'signature', user.id, old ? 'update' : 'create', null, { mime, size: file.data.length });
  return getMySignature(user);
}
function deleteMySignature(user) {
  const d = get();
  const old = rowFor(user);
  if (!old) return { ok: true };
  d.prepare('DELETE FROM user_signatures WHERE user_id=?').run(user.id);
  try { fs.unlinkSync(old.file_path); } catch { /* best-effort */ }
  audit(user, 'signature', user.id, 'delete', null, null);
  return { ok: true };
}
// ---------- admin ----------
function getUserSignature(user, userId) {
  requireAdmin(user);
  const id = parseId(userId);
  const target = get().prepare('SELECT id, username, full_name, active FROM users WHERE id=?').get(id);
  if (!target) throw new HttpError(404, 'NOT_FOUND', 'کاربر پیدا نشد.');
  const row = get().prepare('SELECT * FROM user_signatures WHERE user_id=?').get(id);
  return {
    user: { id: target.id, username: target.username, full_name: target.full_name, active: !!target.active },
    has_signature: !!row,
    file_name: row && row.file_name,
    mime: row && row.mime,
    size: row && row.size,
    updated_at: row && row.updated_at,
    can_sign: row ? hasPerm({ id: target.id }, 'signature', 'approve').ok : false,
  };
}
function adminDownload(user, userId, res) {
  requireAdmin(user);
  const id = parseId(userId);
  const row = get().prepare('SELECT * FROM user_signatures WHERE user_id=?').get(id);
  if (!row || !fs.existsSync(row.file_path)) throw new HttpError(404, 'NOT_FOUND', 'امزای این کاربر ثبت نشده است.');
  audit(user, 'signature', id, 'view', null, null);
  sendSignatureFile(res, row, user);
}
function listSignatureStatus(user) {
  requireAdmin(user);
  const d = get();
  const rows = d.prepare(`
    SELECT u.id, u.username, u.full_name, u.active,
           (SELECT 1 FROM user_signatures s WHERE s.user_id = u.id) has_sig,
           (SELECT s.updated_at FROM user_signatures s WHERE s.user_id = u.id) sig_updated
    FROM users u WHERE u.archived_at IS NULL ORDER BY u.id`).all();
  const permMap = new Map();
  for (const u of rows) {
    const roles = d.prepare(`SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?`).all(u.id).map(x => x.name);
    let can = roles.includes('super_admin');
    if (!can) {
      const p = d.prepare(`SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
        JOIN user_roles ur ON ur.role_id=rp.role_id
        WHERE ur.user_id=? AND p.entity='signature' AND p.action='approve'`).get(u.id);
      can = !!p;
    }
    u.can_sign = can;
  }
  return { items: rows };
}
module.exports = { getMySignature, downloadMySignature, uploadMySignature, deleteMySignature, getUserSignature, adminDownload, listSignatureStatus, sniffImage, MAX_SIZE, ALLOWED };
