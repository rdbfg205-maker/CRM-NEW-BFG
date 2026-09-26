'use strict';
const { get } = require('../db/db');
const { nowIso } = require('../lib/util');
let wsHub = null;
function setWsHub(h) { wsHub = h; }
function notify(userId, type, title, body = '', refType = '', refId = null, actorId = 0) {
  if (!userId) return;
  const d = get();
  const info = d.prepare('INSERT INTO notifications(user_id, type, title, body, ref_type, ref_id, created_at, created_by) VALUES(?,?,?,?,?,?,?,?)')
    .run(userId, type, title, body, refType, refId || 0, nowIso(), Number(actorId) || 0);
  // real-time push: the row id lets the client mark it read from the live toast
  if (wsHub) wsHub.sendToUser(userId, { type: 'notification', data: { id: Number(info.lastInsertRowid), type, title, body, ref_type: refType, ref_id: refId, creator_id: Number(actorId) || 0 } });
}
function notifyRoles(roleNames, type, title, body = '', refType = '', refId = null, exclude = [], actorId = 0) {
  const d = get();
  const ex = new Set((exclude || []).map(Number));
  const users = d.prepare(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name IN (${roleNames.map(() => '?').join(',')}) AND u.active=1 AND u.archived_at IS NULL`).all(...roleNames);
  for (const u of users) if (!ex.has(u.id)) notify(u.id, type, title, body, refType, refId, actorId);
}
function notifyAll(type, title, body = '', refType = '', refId = null, actorId = 0) {
  const users = get().prepare('SELECT id FROM users WHERE active=1 AND archived_at IS NULL').all();
  for (const u of users) notify(u.id, type, title, body, refType, refId, actorId);
}
function notifyDepartment(dept, type, title, body = '', refType = '', refId = null, actorId = 0) {
  if (!dept) return;
  const users = get().prepare('SELECT id FROM users WHERE active=1 AND department=? AND archived_at IS NULL').all(dept);
  for (const u of users) notify(u.id, type, title, body, refType, refId, actorId);
}
module.exports = { notify, notifyRoles, notifyAll, notifyDepartment, setWsHub };
