'use strict';
// Industrial cities registry (real DB records, user-maintained) +
// follow-up attempts (multi-follow history on one follow-up).
const { get } = require('../../db/db');
const { nowIso, toEnDigits } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { requirePerm } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { notify } = require('../../core/notify');

// ---------------- industrial cities ----------------
function listIndustrialCities(user, q) {
  requirePerm(user, 'industrial_city', 'view');
  const d = get();
  const where = ['1=1'], params = [];
  if (q.city) { where.push('city = ?'); params.push(String(q.city)); }
  if (q.province) { where.push('province = ?'); params.push(String(q.province)); }
  if (q.q) { where.push('name LIKE ?'); params.push('%' + String(q.q).replace(/[%_]/g, '') + '%'); }
  const items = d.prepare(`SELECT ic.*, u.full_name creator_name FROM industrial_cities ic LEFT JOIN users u ON u.id = ic.created_by WHERE ${where.join(' AND ')} ORDER BY city, name LIMIT 1000`).all(...params);
  return { items };
}
function createIndustrialCity(user, b) {
  requirePerm(user, 'industrial_city', 'create');
  const name = String(b.name || '').trim();
  const province = String(b.province || '').trim();
  const city = String(b.city || '').trim();
  if (name.length < 2) throw new HttpError(422, 'VALIDATION', 'نام شهرک الزامی است.');
  if (!province) throw new HttpError(422, 'VALIDATION', 'استان الزامی است.');
  if (!city) throw new HttpError(422, 'VALIDATION', 'شهر الزامی است.');
  const d = get();
  const exists = d.prepare('SELECT id FROM industrial_cities WHERE name=? AND city=?').get(name, city);
  if (exists) throw new HttpError(409, 'DUPLICATE', 'این شهرک صنعتی برای این شهر از قبل ثبت شده است.');
  const info = d.prepare('INSERT INTO industrial_cities(name, province, city, created_by, created_at) VALUES(?,?,?,?,?)')
    .run(name, province, city, user.id, nowIso());
  audit(user, 'industrial_city', Number(info.lastInsertRowid), 'create', null, { name, province, city }, '');
  return { id: Number(info.lastInsertRowid), ok: true };
}
function deleteIndustrialCity(user, id) {
  requirePerm(user, 'industrial_city', 'edit');
  const d = get();
  const row = d.prepare('SELECT * FROM industrial_cities WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'شهرک پیدا نشد.');
  const used = d.prepare('SELECT COUNT(*) c FROM customers WHERE industrial_city=?').get(row.name).c
    + d.prepare('SELECT COUNT(*) c FROM customer_contacts WHERE industrial_city=?').get(row.name).c;
  if (used > 0) throw new HttpError(409, 'IN_USE', 'این شهرک روی ' + used + ' رکورد استفاده شده و نمی‌توان حذفش کرد.');
  d.prepare('DELETE FROM industrial_cities WHERE id=?').run(id);
  audit(user, 'industrial_city', id, 'delete', { name: row.name, city: row.city }, null, '');
  return { ok: true };
}

// ---------------- follow-up attempts (item: multi follow-up) ----------------
const ATTEMPT_METHODS = ['call', 'meeting', 'email', 'message', 'visit', 'other'];
function listAttempts(user, followupId) {
  const d = get();
  const fu = d.prepare('SELECT * FROM followups WHERE id=?').get(followupId);
  if (!fu) throw new HttpError(404, 'NOT_FOUND', 'پیگیری پیدا نشد.');
  requirePerm(user, 'followup', 'view');
  // row scope: owner or all
  const items = d.prepare(`SELECT fa.*, u.full_name user_name FROM followup_attempts fa LEFT JOIN users u ON u.id = fa.user_id WHERE fa.followup_id=? ORDER BY fa.id ASC`).all(followupId);
  return { items, followup: fu };
}
function addAttempt(user, followupId, b) {
  const d = get();
  const fu = d.prepare('SELECT * FROM followups WHERE id=?').get(followupId);
  if (!fu) throw new HttpError(404, 'NOT_FOUND', 'پیگیری پیدا نشد.');
  requirePerm(user, 'followup', 'edit');
  const method = ATTEMPT_METHODS.includes(b.method) ? b.method : 'call';
  const result = String(b.result || '').trim().slice(0, 300);
  if (!result) throw new HttpError(422, 'VALIDATION', 'نتیجهٔ پیگیری الزامی است.');
  const actedAt = b.acted_at ? new Date(b.acted_at).toISOString() : nowIso();
  const note = String(b.note || '').trim().slice(0, 1000);
  let nextAt = null;
  if (b.next_followup_at) {
    const t = new Date(b.next_followup_at);
    if (isNaN(t.getTime())) throw new HttpError(422, 'VALIDATION', 'زمان پیگیری بعدی نامعتبر است.');
    nextAt = t.toISOString();
  }
  const info = d.prepare('INSERT INTO followup_attempts(followup_id, acted_at, method, result, note, user_id, next_followup_at, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(followupId, actedAt, method, result, note, user.id, nextAt, nowIso());
  const attemptId = Number(info.lastInsertRowid);
  // Parent follow-up: an attempt keeps it OPEN (or in progress) until the user
  // sets a final status — history is never deleted.
  const fresh = d.prepare('SELECT * FROM followups WHERE id=?').get(followupId);
  if (fresh.status === 'pending') {
    d.prepare("UPDATE followups SET status='in_progress' WHERE id=?").run(followupId);
  }
  // push the attempt date/next reminder to the parent due list (visible in Calendar)
  if (nextAt) {
    d.prepare('UPDATE followups SET due_at=? WHERE id=? AND (status IN (\'pending\',\'in_progress\'))').run(nextAt > (fresh.due_at || '') ? nextAt : (fresh.due_at || nextAt), followupId);
  }
  audit(user, 'followup', followupId, 'add_attempt', null, { attempt: attemptId, method, result, next_followup_at: nextAt }, '');
  addActivity('followup', followupId, user.id, 'attempt', 'پیگیری جدید: ' + result, { method, next_followup_at: nextAt });
  // reminder notification for the next follow-up (real notification, once per attempt)
  if (nextAt) {
    const target = fu.user_id || user.id;
    try { notify(target, 'followup', 'یادآوری پیگیری بعدی', `«${fu.subject || 'پیگیری'}» — پیگیری بعدی: ${new Date(nextAt).toLocaleString('fa-IR')}`, 'followup', followupId); } catch { }
  }
  return { id: attemptId, ok: true };
}
function setFollowupStatus(user, followupId, status) {
  const d = get();
  const fu = d.prepare('SELECT * FROM followups WHERE id=?').get(followupId);
  if (!fu) throw new HttpError(404, 'NOT_FOUND', 'پیگیری پیدا نشد.');
  requirePerm(user, 'followup', 'edit');
  const allowed = ['pending', 'in_progress', 'done', 'no_result', 'missed', 'cancelled'];
  if (!allowed.includes(status)) throw new HttpError(422, 'VALIDATION', 'وضعیت نامعتبر است.');
  const doneAt = ['done', 'no_result', 'cancelled'].includes(status) ? nowIso() : null;
  d.prepare('UPDATE followups SET status=?, done_at=COALESCE(?, done_at) WHERE id=?').run(status, doneAt, followupId);
  audit(user, 'followup', followupId, 'status', { from: fu.status }, { to: status }, '');
  addActivity('followup', followupId, user.id, 'status', 'وضعیت: ' + status);
  return { ok: true, status };
}
function addActivity(entityType, entityId, userId, kind, summary, extra) {
  try {
    get().prepare('INSERT INTO activities(entity_type, entity_id, user_id, kind, summary, data, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(entityType, entityId, userId, kind, summary, JSON.stringify(extra || {}), nowIso());
  } catch { /* activities table optional */ }
}

module.exports = {
  listIndustrialCities, createIndustrialCity, deleteIndustrialCity,
  listAttempts, addAttempt, setFollowupStatus, ATTEMPT_METHODS,
};
