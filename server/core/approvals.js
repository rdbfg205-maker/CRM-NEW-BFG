'use strict';
const { get } = require('../db/db');
const { nowIso } = require('../lib/util');
const { notify } = require('./notify');
const { HttpError } = require('../lib/http');

function create(type, entityType, entityId, title, reason, data, user) {
  const d = get();
  const r = d.prepare('INSERT INTO approval_requests(type, entity_type, entity_id, title, reason, data, requested_by, requested_at, status) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(type, entityType || '', entityId || 0, title, reason || '', data ? JSON.stringify(data) : null, user.id, nowIso(), 'pending');
  // notify users who can approve
  const approvers = d.prepare(`SELECT u.id, u.username FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    WHERE r.name IN ('ceo','sales_manager','finance_manager','super_admin') AND u.active=1 AND u.archived_at IS NULL`).all();
  for (const a of approvers) if (a.id !== user.id) notify(a.id, 'approval', 'درخواست تأیید جدید', `${user.full_name} درخواست «${title}» را برای تأیید ارسال کرده است.`, 'approval', r.lastInsertRowid, user.id);
  return r.lastInsertRowid;
}
function decide(id, approve, user, note = '') {
  const d = get();
  const row = d.prepare('SELECT * FROM approval_requests WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'درخواست تأیید پیدا نشد.');
  if (row.status !== 'pending') throw new HttpError(400, 'BAD_STATE', 'این درخواست قبلاً تصمیم‌گیری شده است.');
  // permission: role must be able to approve
  const can = d.prepare(`SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND r.name IN ('ceo','sales_manager','finance_manager','super_admin')`).get(user.id);
  if (!can) throw new HttpError(403, 'FORBIDDEN', 'شما مجوز تأیید این درخواست را ندارید.');
  d.prepare('UPDATE approval_requests SET status=?, decided_by=?, decided_at=?, note=? WHERE id=?')
    .run(approve ? 'approved' : 'rejected', user.id, nowIso(), note, id);
  notify(row.requested_by, 'approval', approve ? 'درخواست شما تأیید شد' : 'درخواست شما رد شد', `«${row.title}» توسط ${user.full_name} ${approve ? 'تأیید' : 'رد'} شد. ${note}`, 'approval', id);
  return { ok: true };
}
module.exports = { create, decide };
