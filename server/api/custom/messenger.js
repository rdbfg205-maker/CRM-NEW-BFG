'use strict';
const fs = require('fs');
const path = require('path');
const { get, DATA_DIR } = require('../../db/db');
const { nowIso, uuid } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { audit } = require('../../core/audit');
const notify = require('../../core/notify');

function myConversations(user) {
  const d = get();
  const convs = d.prepare(`SELECT c.*, (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id=c.id) members,
    (SELECT body FROM messages m2 WHERE m2.conversation_id=c.id AND m2.deleted_at IS NULL ORDER BY m2.id DESC LIMIT 1) last_body,
    (SELECT created_at FROM messages m3 WHERE m3.conversation_id=c.id AND m3.deleted_at IS NULL ORDER BY m3.id DESC LIMIT 1) last_at,
    (SELECT sender_id FROM messages m4 WHERE m4.conversation_id=c.id AND m4.deleted_at IS NULL ORDER BY m4.id DESC LIMIT 1) last_sender
    FROM conversations c WHERE c.archived_at IS NULL AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id=?) ORDER BY COALESCE(last_at, c.created_at) DESC LIMIT 200`).all(user.id);
  const unread = d.prepare(`SELECT cm.conversation_id, COUNT(m.id) c FROM conversation_members cm JOIN messages m ON m.conversation_id=cm.conversation_id WHERE cm.user_id=? AND m.deleted_at IS NULL AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01T00:00:00') AND m.sender_id != ? GROUP BY cm.conversation_id`).all(user.id, user.id);
  const unreadMap = Object.fromEntries(unread.map(u => [u.conversation_id, u.c]));
  for (const c of convs) {
    const ids = JSON.parse(c.member_ids || '[]');
    c.members_list = d.prepare(`SELECT id, full_name, username, avatar FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND archived_at IS NULL`).all(...ids);
    c.unread = unreadMap[c.id] || 0;
  }
  return { items: convs };
}
function createConversation(user, data) {
  const d = get();
  const type = data.type === 'group' || data.type === 'channel' ? data.type : 'direct';
  let memberIds;
  if (type === 'direct') {
    const other = Number(data.other_user_id);
    const u = d.prepare('SELECT id, full_name FROM users WHERE id=? AND active=1 AND archived_at IS NULL').get(other);
    if (!u) throw new HttpError(404, 'NOT_FOUND', 'کاربر پیدا نشد.');
    const existing = d.prepare(`SELECT c.id FROM conversations c WHERE c.type='direct' AND c.archived_at IS NULL AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id=?) AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id=?)`).get(user.id, other);
    if (existing) return { id: existing.id };
    memberIds = [user.id, other];
    const title = u.full_name;
    const info = d.prepare('INSERT INTO conversations(type, title, member_ids, created_by, created_at) VALUES(?,?,?,?,?)').run('direct', title, JSON.stringify(memberIds), user.id, nowIso());
    const id = Number(info.lastInsertRowid);
    d.prepare('INSERT INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(id, user.id, nowIso());
    d.prepare('INSERT INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(id, other, nowIso());
    return { id };
  }
  const members = [user.id, ...(Array.isArray(data.member_ids) ? data.member_ids.map(Number).filter(Boolean) : [])];
  const info = d.prepare('INSERT INTO conversations(type, title, member_ids, created_by, created_at) VALUES(?,?,?,?,?)').run(type, data.title || 'گفتگو', JSON.stringify(members), user.id, nowIso());
  const id = Number(info.lastInsertRowid);
  for (const m of new Set(members)) d.prepare('INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(id, m, nowIso());
  for (const m of new Set(members)) if (m !== user.id) notify.notify(m, 'message', `شما به «${data.title || 'گروه'}» دعوت شدید`, user.full_name, 'conversation', id, user.id);
  return { id };
}
function addMembers(user, convId, memberIds) {
  const d = get();
  const conv = d.prepare('SELECT * FROM conversations WHERE id=?').get(convId);
  if (!conv) throw new HttpError(404, 'NOT_FOUND', 'گفتگو پیدا نشد.');
  const ids = JSON.parse(conv.member_ids || '[]');
  const added = [];
  for (const m of memberIds.map(Number).filter(Boolean)) {
    if (!ids.includes(m)) {
      ids.push(m);
      d.prepare('INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(convId, m, nowIso());
      const u = d.prepare('SELECT full_name FROM users WHERE id=?').get(m);
      if (u) notify.notify(m, 'message', `شما به «${conv.title}» دعوت شدید`, user.full_name, 'conversation', convId, user.id);
      added.push(m);
    }
  }
  if (added.length) d.prepare('UPDATE conversations SET member_ids=? WHERE id=?').run(JSON.stringify(ids), convId);
  return { ok: true, added };
}
function listMessages(user, convId, beforeId = null, limit = 50) {
  const d = get();
  const isMember = d.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, user.id);
  if (!isMember) throw new HttpError(403, 'FORBIDDEN', 'عضو این گفتگو نیستید.');
  const sql = beforeId
    ? 'SELECT m.*, u.full_name sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.deleted_at IS NULL AND m.id < ? ORDER BY m.id DESC LIMIT ?'
    : 'SELECT m.*, u.full_name sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT ?';
  const rows = beforeId ? d.prepare(sql).all(convId, Number(beforeId), limit) : d.prepare(sql).all(convId, limit);
  rows.reverse();
  d.prepare('UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?').run(nowIso(), convId, user.id);
  return { items: rows };
}
function sendRest(user, convId, body, refType, refId, filePath, mime) {
  const d = get();
  const isMember = d.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, user.id);
  if (!isMember) throw new HttpError(403, 'FORBIDDEN', 'عضو این گفتگو نیستید.');
  const info = d.prepare('INSERT INTO messages(conversation_id, sender_id, type, body, file_path, mime, ref_type, ref_id, created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(convId, user.id, filePath ? 'file' : 'text', String(body || '').slice(0, 5000), filePath || '', mime || '', refType || '', refId || 0, nowIso());
  const id = Number(info.lastInsertRowid);
  const hub = require('../../core/messenger').getHub();
  hub.sendToConv(convId, { type: 'message', message: { id, conversation_id: convId, sender_id: user.id, sender_name: user.full_name, body, file: filePath, mime, ref_type: refType || '', ref_id: refId || 0, created_at: nowIso() } }, user.id);
  return { id };
}
function uploadMessageFile(user, convId, file) {
  const dir = path.join(DATA_DIR, 'uploads', 'messages');
  fs.mkdirSync(dir, { recursive: true });
  const name = Date.now() + '_' + uuid() + path.extname(file.filename || '').toLowerCase().slice(0, 10);
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, file.data);
  return { path: dest, mime: file.mime, name: file.filename };
}
function searchMessages(user, q) {
  const d = get();
  const like = '%' + q + '%';
  const rows = d.prepare(`SELECT m.id, m.conversation_id, m.body, m.created_at, c.title conv_title, u.full_name sender_name
    FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN users u ON u.id=m.sender_id
    WHERE m.body LIKE ? AND m.deleted_at IS NULL AND m.id IN (SELECT conversation_id FROM conversation_members WHERE user_id=?)
    ORDER BY m.id DESC LIMIT 50`).all(like, user.id);
  return { items: rows };
}
module.exports = { myConversations, createConversation, addMembers, listMessages, sendRest, uploadMessageFile, searchMessages };
