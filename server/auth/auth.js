'use strict';
const { get, getSetting, setSetting } = require('../db/db');
const { jwtSign, jwtVerify, hashPassword, verifyPassword, totpSecret, totpVerify, randomToken, sha256 } = require('../lib/crypto');
const { nowIso } = require('../lib/util');
const { HttpError, rateLimit } = require('../lib/http');
const { audit } = require('../core/audit');

const ACCESS_TTL = 2 * 3600;
const REFRESH_TTL_DAYS = 30;

function issueTokens(res, user, ua = '', secure = false) {
  const access = jwtSign({ uid: user.id, username: user.username, typ: 'access' }, ACCESS_TTL);
  const refresh = randomToken(32);
  get().prepare('INSERT INTO refresh_tokens(user_id, token_hash, user_agent, created_at, expires_at) VALUES(?,?,?,?,?)')
    .run(user.id, sha256(refresh), ua, nowIso(), new Date(Date.now() + REFRESH_TTL_DAYS * 864e5).toISOString());
  const cookies = res.getHeader('Set-Cookie');
  const prev = Array.isArray(cookies) ? cookies : (cookies ? [cookies] : []);
  res.setHeader('Set-Cookie', [
    ...prev,
    cookieStr('bfc_access', access, 2 * 3600, true, secure),
    cookieStr('bfc_refresh', refresh, REFRESH_TTL_DAYS * 86400, true, secure),
  ]);
  return { access, refresh };
}
function cookieStr(name, value, maxAge, httpOnly = false, secure = false) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}`;
}
// behind a TLS-terminating proxy (x-forwarded-proto) the Secure flag is required
function isTls(req) {
  return String((req && req.headers && req.headers['x-forwarded-proto']) || '').toLowerCase().startsWith('https');
}
function clearCookies(res) {
  res.setHeader('Set-Cookie', [cookieStr('bfc_access', '', 0), cookieStr('bfc_refresh', '', 0)]);
}
function userFromToken(req) {
  const h = req.headers.authorization || '';
  let token = null;
  if (h.startsWith('Bearer ')) token = h.slice(7);
  if (!token) {
    const c = req.headers.cookie || '';
    const m = c.match(/bfc_access=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return null;
  const payload = jwtVerify(token);
  if (!payload || payload.typ !== 'access') return null;
  const u = get().prepare('SELECT * FROM users WHERE id=? AND active=1 AND archived_at IS NULL').get(payload.uid);
  return u || null;
}
function requireUser(req, res) {
  const u = userFromToken(req);
  if (!u) throw new HttpError(401, 'UNAUTHORIZED', 'نشست شما به پایان رسه است. لطفاً دوباره وارد شوید.');
  return u;
}
// refresh
function refreshSession(req, res) {
  const c = req.headers.cookie || '';
  const m = c.match(/bfc_refresh=([^;]+)/);
  if (!m) throw new HttpError(401, 'UNAUTHORIZED', 'نشست نامعتبر است.');
  const token = decodeURIComponent(m[1]);
  const row = get().prepare('SELECT * FROM refresh_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at > ?').get(sha256(token), nowIso());
  if (!row) throw new HttpError(401, 'UNAUTHORIZED', 'نشست نامعتبر است.');
  const user = get().prepare('SELECT * FROM users WHERE id=? AND active=1 AND archived_at IS NULL').get(row.user_id);
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'کاربر پیدا نشد.');
  // rotation
  get().prepare('UPDATE refresh_tokens SET revoked_at=? WHERE id=?').run(nowIso(), row.id);
  const t = issueTokens(res, user, req.headers['user-agent'] || '', isTls(req));
  return { user, access: t.access };
}
async function login(req, res) {
  const ip = req.socket.remoteAddress || '';
  if (!rateLimit('login:' + ip, 10, 60000)) throw new HttpError(429, 'RATE_LIMIT', 'تعداد تلاش‌های زیاد است. لطفاً بعد از یک دقیقه تلاش کنید.');
  const body = req._body || {};
  const loginId = String(body.username || body.email || '').trim();
  const password = String(body.password || '');
  if (!loginId || !password) throw new HttpError(400, 'VALIDATION', 'نام کاربری و رمز عبور الزامی است.');
  const user = get().prepare('SELECT * FROM users WHERE (username=? OR email=?) AND active=1 AND archived_at IS NULL').get(loginId, loginId);
  if (!user || !verifyPassword(password, user.password_hash)) {
    // audit: failed login (never log the password — only username + IP)
    try { audit(null, 'auth', 0, 'login_failed', null, { username: loginId, ip }); } catch { /* audit must never break login */ }
    throw new HttpError(401, 'BAD_CREDENTIALS', 'نام کاربری یا رمز عبور اشتباه است.');
  }
  if (user.totp_enabled && user.totp_secret) {
    const code = String(body.totp || '');
    if (!code) {
      const temp = jwtSign({ uid: user.id, typ: 'totp-pending', exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000) }, 300);
      return { totp_required: true, temp_token: temp };
    }
    if (!totpVerify(user.totp_secret, code)) {
      try { audit(null, 'auth', 0, 'login_failed', null, { username: loginId, ip, reason: 'totp' }); } catch {}
      throw new HttpError(401, 'TOTP_INVALID', 'کد تأیید دوعاملی اشتباه است.');
    }
  }
  get().prepare('UPDATE users SET last_login_at=? WHERE id=?').run(nowIso(), user.id);
  try { audit(user, 'auth', user.id, 'login', null, { ip }); } catch {}
  const t = issueTokens(res, user, req.headers['user-agent'] || '', isTls(req));
  return { user: publicUser(user), access: t.access };
}
function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, phone: u.phone || '', full_name: u.full_name, department: u.department, avatar: u.avatar, totp_enabled: !!u.totp_enabled, must_change_password: !!u.must_change_password };
}
// ---------- permissions ----------
const PERM_ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve', 'archive', 'restore', 'import'];
let permCache = null;
let permCacheAt = 0;
function loadPermMap() {
  if (permCache && Date.now() - permCacheAt < 30000) return permCache;
  const d = get();
  const perms = d.prepare('SELECT p.* FROM permissions p').all();
  const rp = d.prepare('SELECT rp.role_id, p.entity, p.action, rp.scope FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id').all();
  const ur = d.prepare('SELECT ur.user_id, ur.role_id FROM user_roles ur').all();
  const users = d.prepare('SELECT id, username FROM users').all();
  const map = {}; // userId -> { 'entity:action': scope, 'entity:*': 'all' }
  for (const u of users) { map[u.id] = {}; }
  const byRole = {};
  for (const r of rp) { (byRole[r.role_id] = byRole[r.role_id] || []).push(r); }
  for (const urRow of ur) {
    const m = map[urRow.user_id];
    if (!m) continue; // defensive: skip orphaned user_roles rows (user hard-removed out-of-band) — never crash the whole perm check
    for (const r of byRole[urRow.role_id] || []) {
      const cur = m[r.entity + ':' + r.action];
      const order = { all: 4, department: 3, team: 2, own: 1 };
      if (!cur || (order[r.scope] || 0) > (order[cur] || 0)) m[r.entity + ':' + r.action] = r.scope;
    }
  }
  // super admin: everything
  const sa = d.prepare("SELECT r.id FROM roles r WHERE r.name='super_admin'").get();
  if (sa) {
    for (const urRow of ur) if (urRow.role_id === sa.id) {
      for (const p of perms) map[urRow.user_id][p.entity + ':' + p.action] = 'all';
      map[urRow.user_id]['*:*'] = 'all';
    }
  }
  permCache = map; permCacheAt = Date.now();
  return map;
}
function hasPerm(user, entity, action) {
  const map = loadPermMap()[user.id] || {};
  if (map['*:*']) return { ok: true, scope: map['*:*'] };
  const v = map[entity + ':' + action];
  if (!v) return { ok: false, scope: 'none' };
  return { ok: true, scope: v };
}
function requirePerm(user, entity, action) {
  const r = hasPerm(user, entity, action);
  if (!r.ok) {
    // audit: authorization denial (defense log — never breaks the request flow)
    try { audit(user, entity, 0, 'permission_denied', null, { action }); } catch {}
    throw new HttpError(403, 'FORBIDDEN', 'شما مجوز انجام این عملیات را ندارید.');
  }
  return r.scope;
}
function scopeWhere(entity, user, scope, field) {
  // returns {where: string, params: array} for row-level scoping
  if (scope === 'all' || !field) return { where: '', params: [] };
  const f = field;
  if (scope === 'own') return { where: `(${f} = ? OR ${f} = 0)`, params: [user.id] };
  if (scope === 'team') return { where: `EXISTS(SELECT 1 FROM users u2 WHERE u2.id = ${f} AND (u2.department = ? AND u2.department != ''))`, params: [user.department] };
  if (scope === 'department') return { where: `EXISTS(SELECT 1 FROM users u2 WHERE u2.id = ${f} AND u2.department = ?)`, params: [user.department] };
  return { where: '', params: [] };
}
module.exports = {
  ACCESS_TTL, issueTokens, cookieStr, clearCookies, userFromToken, requireUser, refreshSession,
  login, publicUser, PERM_ACTIONS, loadPermMap, hasPerm, requirePerm, scopeWhere, hashPassword,
  verifyPassword, totpSecret, totpVerify, randomToken, sha256, nowIso,
};
