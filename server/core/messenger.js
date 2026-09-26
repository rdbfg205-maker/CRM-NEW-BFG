'use strict';
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { get, getSetting } = require('../db/db');
const { nowIso } = require('../lib/util');
const notify = require('./notify');

// ---------- minimal RFC6455 ws server fallback (if 'ws' missing) ----------
function makeWsServer() {
  try { return new WebSocketServer({ noServer: true }); }
  catch (e) { console.error('ws unavailable', e.message); return null; }
}
class Hub {
  constructor() {
    this.wss = makeWsServer();
    this.clients = new Map(); // user_id -> Set<ws>
  }
  attach(server) {
    if (!this.wss) return;
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/ws') { socket.destroy(); return; }
      const token = url.searchParams.get('token');
      if (!token) { socket.destroy(); return; }
      const user = this.verify(token);
      if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        ws.userId = user.id;
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('message', (raw) => this.onMessage(user, ws, raw));
        ws.on('close', () => this.remove(user.id, ws));
        ws.on('error', () => this.remove(user.id, ws));
        this.add(user.id, ws);
        ws.send(JSON.stringify({ type: 'hello', user: { id: user.id, full_name: user.full_name } }));
      });
    });
    setInterval(() => {
      if (!this.wss) return;
      for (const ws of this.wss.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30000).unref();
  }
  verify(token) {
    try {
      const payload = jwtVerifyLocal(token, getSecret());
      if (!payload || payload.typ !== 'access') return null;
      const u = get().prepare('SELECT * FROM users WHERE id=? AND active=1 AND archived_at IS NULL').get(payload.uid);
      return u;
    } catch { return null; }
  }
  add(userId, ws) {
    if (!this.clients.has(userId)) this.clients.set(userId, new Set());
    this.clients.get(userId).add(ws);
  }
  remove(userId, ws) {
    const s = this.clients.get(userId);
    if (s) { s.delete(ws); if (!s.size) this.clients.delete(userId); }
  }
  sendToUser(userId, obj) {
    const s = this.clients.get(userId);
    if (!s) return false;
    const str = JSON.stringify(obj);
    for (const ws of s) { try { if (ws.readyState === 1) ws.send(str); } catch {} }
    return s.size > 0;
  }
  sendToConv(convId, obj, exceptUserId = null) {
    const rows = get().prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(convId);
    for (const r of rows) if (r.user_id !== exceptUserId) this.sendToUser(r.user_id, obj);
  }
  onMessage(user, ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const d = get();
    try {
      if (msg.type === 'typing') {
        this.sendToConv(msg.conv_id, { type: 'typing', user_id: user.id, name: user.full_name }, user.id);
        return;
      }
      if (msg.type === 'read') {
        d.prepare('UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?').run(nowIso(), msg.conv_id, user.id);
        this.sendToConv(msg.conv_id, { type: 'read', user_id: user.id }, user.id);
        return;
      }
      if (msg.type === 'call-signal') {
        // relay to target user
        this.sendToUser(msg.to, { type: 'call-signal', from: user.id, kind: msg.kind, sdp: msg.sdp, callId: msg.callId });
        return;
      }
      if (msg.type === 'message') {
        const conv = d.prepare('SELECT * FROM conversations WHERE id=? AND archived_at IS NULL').get(msg.conv_id);
        if (!conv) return;
        const isMember = d.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(msg.conv_id, user.id);
        if (!isMember) return;
        const info = d.prepare('INSERT INTO messages(conversation_id, sender_id, type, body, ref_type, ref_id, reply_to, created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(msg.conv_id, user.id, msg.file ? 'file' : 'text', String(msg.body || '').slice(0, 5000), msg.ref_type || '', msg.ref_id || 0, msg.reply_to || 0, nowIso());
        const mid = Number(info.lastInsertRowid);
        const out = { type: 'message', message: { id: mid, conversation_id: msg.conv_id, sender_id: user.id, sender_name: user.full_name, body: msg.body, file: msg.file, ref_type: msg.ref_type || '', ref_id: msg.ref_id || 0, reply_to: msg.reply_to || 0, created_at: nowIso() } };
        this.sendToConv(msg.conv_id, out, user.id);
        // mentions
        const names = String(msg.body || '').match(/@([\u0600-\u06FFa-zA-Z0-9_]+)/g) || [];
        for (const m of names) {
          const un = m.slice(1);
          const target = d.prepare('SELECT * FROM users WHERE username=? OR full_name=?').get(un, un);
          if (target && target.id !== user.id) notify.notify(target.id, 'mention', `از ${user.full_name} اشاره شده‌اید`, String(msg.body || '').slice(0, 120), 'conversation', msg.conv_id, user.id);
        }
        if (msg.ref_type) {
          const refUser = getRefOwner(msg.ref_type, msg.ref_id);
          if (refUser && refUser !== user.id) notify.notify(refUser, 'message', `پیام جدیدی به «${msg.ref_type} #${msg.ref_id}» متصل شد`, user.full_name, msg.ref_type, msg.ref_id);
        }
      }
    } catch (e) {
      console.error('ws message error', e.message);
    }
  }
}
function getRefOwner(type, id) {
  const d = get();
  const map = {
    customer: 'salesperson_id', lead: 'salesperson_id', opportunity: 'salesperson_id',
    order: 'salesperson_id', invoice: 'created_by', complaint: 'assigned_to', ticket: 'assigned_to', task: 'assignee_id',
  };
  const tableMap = { customer: 'customers', lead: 'leads', opportunity: 'opportunities', order: 'orders', invoice: 'invoices', complaint: 'complaints', ticket: 'tickets', task: 'tasks' };
  const col = map[type], table = tableMap[type];
  if (!col || !table || !id) return null;
  try { const r = d.prepare(`SELECT ${col} FROM ${table} WHERE id=?`).get(id); return r ? r[col] : null; } catch { return null; }
}
let _hub = null;
function getHub() {
  if (!_hub) _hub = new Hub();
  return _hub;
}
// local jwt verify to avoid circular import at module load
function jwtVerifyLocal(token, secret) {
  const [h, p, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (sig !== expect) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
function getSecret() {
  return process.env.JWT_SECRET || getSetting('jwt_secret') || '';
}
module.exports = { getHub };
