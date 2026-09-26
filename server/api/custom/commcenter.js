'use strict';
// ============ Communication Center (مرکز ارتباطات) ============
// Unified, READ-ONLY view of ALL real company communications:
//   1) VoIP calls        (voip_calls)            — incoming/outgoing/missed, CDR-matched
//   2) Customer messages (customer_messages)     — SMS/WhatsApp/Telegram/Email outbox
//   3) Internal calls    (calls_log)             — in-app voice/video between staff
// Each source is only included when the user holds its own permission, with the
// same row scoping its native module uses. No data is duplicated or modified —
// this is a live aggregation over existing tables (no fake records, no new stores).
const { get } = require('../../db/db');
const { hasPerm, requirePerm, scopeWhere } = require('../../auth/auth');
const { parseId } = require('../../lib/util');

const CHANNELS = ['phone', 'sms', 'whatsapp', 'telegram', 'email', 'internal'];
const DIRECTIONS = ['incoming', 'outgoing', 'missed'];

function d() { return get(); }

function fetchVoip(user, q) {
  let scope;
  try { scope = requirePerm(user, 'voip_call', 'view'); } catch { return []; }
  const ddb = d();
  const where = ['1=1']; const args = [];
  if (scope !== 'all') {
    where.push(`(v.user_id = ? OR v.customer_id IN (SELECT id FROM customers WHERE salesperson_id = ?) OR v.lead_id IN (SELECT id FROM leads WHERE salesperson_id = ?))`);
    args.push(user.id, user.id, user.id);
  }
  const cid = parseId(q.customer_id); if (cid) { where.push('v.customer_id = ?'); args.push(cid); }
  const vid = parseId(q.user_id); if (vid) { where.push('v.user_id = ?'); args.push(vid); }
  if (q.direction) { where.push('v.direction = ?'); args.push(q.direction); }
  if (q.status) { where.push('v.status = ?'); args.push(q.status); }
  if (q.from) { where.push('COALESCE(started_at, created_at) >= ?'); args.push(q.from); }
  if (q.to) { where.push('COALESCE(started_at, created_at) <= ?'); args.push(q.to); }
  const rows = ddb.prepare(`
    SELECT v.*, c.name AS customer_name, ct.name AS contact_name, u.full_name AS user_name
    FROM voip_calls v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN customer_contacts ct ON ct.id = v.contact_id
    LEFT JOIN users u ON u.id = v.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(v.started_at, v.created_at) DESC LIMIT 500
  `).all(...args);
  return rows.map(v => ({
    source: 'voip_call', id: v.id,
    customer_id: v.customer_id, customer_name: v.customer_name, contact_name: v.contact_name,
    user_id: v.user_id, user_name: v.user_name,
    channel: 'phone', direction: v.direction, status: v.status,
    result: v.outcome_fa || v.outcome || v.status,
    subject: [v.caller, v.called].filter(Boolean).join(' ↔ ') || '—',
    body: v.notes || '',
    at: v.started_at || v.created_at,
    duration_sec: v.duration_sec,
    recording: v.recording_file || null,
    ref_type: v.customer_id ? 'customer' : (v.contact_id ? 'contact' : null),
    ref_id: v.customer_id || v.contact_id || null,
  }));
}

function fetchMessages(user, q) {
  if (!hasPerm(user, 'customer_message', 'view')) return [];
  const ddb = d();
  const where = ['1=1']; const args = [];
  const cmcid = parseId(q.customer_id); if (cmcid) { where.push('m.customer_id = ?'); args.push(cmcid); }
  const cmuid = parseId(q.user_id); if (cmuid) { where.push('m.user_id = ?'); args.push(cmuid); }
  if (q.channel && q.channel !== 'phone' && q.channel !== 'internal') { where.push('m.channel = ?'); args.push(q.channel); }
  if (q.direction && q.direction !== 'outgoing') return []; // messages are outbound only
  if (q.status) { where.push('m.status = ?'); args.push(q.status); }
  if (q.from) { where.push('m.created_at >= ?'); args.push(q.from); }
  if (q.to) { where.push('m.created_at <= ?'); args.push(q.to); }
  const rows = ddb.prepare(`
    SELECT m.*, c.name AS customer_name, u.full_name AS user_name
    FROM customer_messages m
    LEFT JOIN customers c ON c.id = m.customer_id
    LEFT JOIN users u ON u.id = m.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.id DESC LIMIT 500
  `).all(...args);
  return rows.map(m => ({
    source: 'customer_message', id: m.id,
    customer_id: m.customer_id, customer_name: m.customer_name, contact_name: null,
    user_id: m.user_id, user_name: m.user_name,
    channel: m.channel, direction: 'outgoing', status: m.status,
    result: m.status === 'sent' ? 'ارسال شد' : (m.status === 'failed' ? 'ناموفق' : 'در انتظار پیکربندی'),
    subject: m.subject || (m.doc_number ? m.doc_type + ' ' + m.doc_number : (m.event_type === 'manual' ? 'پیام' : m.event_type)),
    body: m.body || '',
    at: m.created_at,
    duration_sec: null,
    recording: null,
    ref_type: m.doc_id ? m.doc_type : 'customer',
    ref_id: m.doc_id || m.customer_id,
  }));
}

function fetchInternalCalls(user, q) {
  // in-app WebRTC calls: only the two parties may see a call
  const ddb = d();
  const where = ['(initiator_id = ? OR target_id = ?)']; const args = [user.id, user.id];
  if (q.user_id && Number(q.user_id) !== user.id) return []; // others' internal calls are not yours
  if (q.direction === 'incoming') { where.push('cl.target_id = ?'); args.push(user.id); }
  else if (q.direction === 'outgoing') { where.push('cl.initiator_id = ?'); args.push(user.id); }
  if (q.from) { where.push('started_at >= ?'); args.push(q.from); }
  if (q.to) { where.push('started_at <= ?'); args.push(q.to); }
  const rows = ddb.prepare(`
    SELECT cl.*, i.full_name AS initiator_name, t.full_name AS target_name
    FROM calls_log cl
    LEFT JOIN users i ON i.id = cl.initiator_id
    LEFT JOIN users t ON t.id = cl.target_id
    WHERE ${where.join(' AND ')}
    ORDER BY cl.id DESC LIMIT 500
  `).all(...args);
  return rows.map(c => ({
    source: 'internal_call', id: c.id,
    customer_id: null, customer_name: null, contact_name: null,
    user_id: c.initiator_id, user_name: c.initiator_name,
    channel: 'internal', direction: c.initiator_id === user.id ? 'outgoing' : 'incoming',
    status: c.status, result: c.status,
    subject: c.kind === 'video' ? 'تماس تصویری' : 'تماس صوتی',
    body: '',
    at: c.started_at,
    duration_sec: c.started_at && c.ended_at ? Math.max(0, Math.round((new Date(c.ended_at) - new Date(c.started_at)) / 1000)) : null,
    recording: null,
    ref_type: null, ref_id: null,
    other: c.initiator_id === user.id ? c.target_name : c.initiator_name,
  }));
}

function center(user, q) {
  if (!user) throw new (require('../../lib/http').HttpError)(401, 'UNAUTHORIZED', 'وارد نشده‌اید.');
  if (q.channel && !CHANNELS.includes(q.channel)) throw new (require('../../lib/http').HttpError)(422, 'VALIDATION', 'کانال نامعتبر است.');
  if (q.direction && !DIRECTIONS.includes(q.direction)) throw new (require('../../lib/http').HttpError)(422, 'VALIDATION', 'جهت نامعتبر است.');
  let rows = []
    .concat(fetchVoip(user, q))
    .concat(fetchMessages(user, q))
    .concat(fetchInternalCalls(user, q));
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const total = rows.length;
  const perPage = Math.min(parseInt(q.per_page) || 50, 200);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const items = rows.slice((page - 1) * perPage, page * perPage);
  const by = (key) => rows.reduce((acc, r) => { const k = String(r[key] || 'unknown'); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const summary = { total, by_channel: by('channel'), by_direction: by('direction'), by_status: by('status'), sources: { voip: rows.filter(r => r.source === 'voip_call').length, messages: rows.filter(r => r.source === 'customer_message').length, internal: rows.filter(r => r.source === 'internal_call').length } };
  return { items, total, page, pages: Math.ceil(total / perPage) || 1, summary, channels: CHANNELS, directions: DIRECTIONS };
}

module.exports = { center };
