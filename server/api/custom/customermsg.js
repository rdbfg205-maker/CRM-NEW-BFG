'use strict';
// ============ Customer Messaging (Section 5) ============
// Send customer messages (SMS/WhatsApp/Telegram/Email) after quote/invoice/
// payment/shipment events or manually, using configurable templates with
// real variables (customer name, document number, amount, date, sender).
//
// Honesty rule: if the real provider is not configured, the message is LOGGED
// with status 'not_configured' — the system never pretends it sent.
// Reuses the existing provider machinery (campaigns.sendViaProvider) and the
// existing `settings` channel configs (sms/whatsapp/telegram/email).
const { get, getSetting, setSetting, addActivity } = require('../../db/db');
const { requirePerm } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { HttpError } = require('../../lib/http');
const { nowIso, parseId, faDigits, fmtNum } = require('../../lib/util');
const { gregorianToJalaali } = require('../../lib/jalali');
const { sendViaProvider } = require('./campaigns');

const EVENTS = ['quote', 'invoice', 'payment', 'shipment', 'manual'];
const CHANNELS = ['sms', 'whatsapp', 'telegram', 'email'];
const STATUSES = ['sent', 'failed', 'not_configured', 'queued', 'pending'];

// ---------- settings (dedicated permission, audited) ----------
function defaultSettings() {
  return { enabled: true, default_channel: 'sms', auto_send: { quote: false, invoice: false, payment: false, shipment: false } };
}
function getMessagingSettings() {
  const s = getSetting('customer_messaging') || {};
  return { ...defaultSettings(), ...s, auto_send: { ...defaultSettings().auto_send, ...(s.auto_send || {}) } };
}
function getMessagingSettingsApi(user) {
  requirePerm(user, 'customer_message', 'manage');
  return { settings: getMessagingSettings(), channels: channelStates() };
}
function channelStates() {
  const out = {};
  for (const ch of CHANNELS) {
    const cfg = getSetting(ch);
    out[ch] = !!(cfg && cfg.active && cfg.settings && Object.keys(cfg.settings).length > 0);
  }
  return out;
}
// sender-facing state (no manage permission needed; exposes booleans only)
function getChannelStatesApi(user) {
  requirePerm(user, 'customer_message', 'view');
  const st = getMessagingSettings();
  return { enabled: st.enabled, default_channel: st.default_channel, channels: channelStates() };
}
function setMessagingSettingsApi(user, data) {
  requirePerm(user, 'customer_message', 'manage');
  const cur = getMessagingSettings();
  const next = { ...cur, auto_send: { ...cur.auto_send } };
  if (data.enabled !== undefined) next.enabled = !!data.enabled;
  if (data.default_channel !== undefined) {
    if (!CHANNELS.includes(data.default_channel)) throw new HttpError(422, 'VALIDATION', 'کانال پیش‌فرض نامعتبر است.');
    next.default_channel = data.default_channel;
  }
  if (data.auto_send && typeof data.auto_send === 'object') {
    for (const ev of ['quote', 'invoice', 'payment', 'shipment']) {
      if (data.auto_send[ev] !== undefined) next.auto_send[ev] = !!data.auto_send[ev];
    }
  }
  setSetting('customer_messaging', next);
  audit(user, 'customer_message', 0, 'settings', null, next, '');
  return { ok: true, settings: next };
}

// ---------- templates ----------
function listTemplates(user) {
  requirePerm(user, 'customer_message', 'manage');
  const rows = get().prepare(`SELECT t.*, u.full_name AS creator_name FROM message_templates t LEFT JOIN users u ON u.id=t.created_by ORDER BY t.event_type, t.channel, t.id DESC`).all();
  return { items: rows };
}
function saveTemplate(user, id, data) {
  requirePerm(user, 'customer_message', 'manage');
  const d = get();
  const name = String(data.name || '').trim();
  if (!name) throw new HttpError(422, 'VALIDATION', 'نام قالب الزامی است.');
  const body = String(data.body || '').trim();
  if (!body) throw new HttpError(422, 'VALIDATION', 'متن قالب الزامی است.');
  if (body.length > 2000) throw new HttpError(422, 'VALIDATION', 'متن قالب بیش از حد مجاز است.');
  const event_type = EVENTS.includes(data.event_type) ? data.event_type : null;
  if (!event_type) throw new HttpError(422, 'VALIDATION', 'نوع رویداد نامعتبر است.');
  const channel = CHANNELS.includes(data.channel) ? data.channel : null;
  if (!channel) throw new HttpError(422, 'VALIDATION', 'کانال نامعتبر است.');
  const subject = data.subject === undefined ? null : (data.subject === null || data.subject === '' ? null : String(data.subject).slice(0, 200));
  const active = data.active === undefined ? 1 : (data.active ? 1 : 0);
  if (id) {
    const ex = d.prepare('SELECT * FROM message_templates WHERE id=?').get(parseId(id));
    if (!ex) throw new HttpError(404, 'NOT_FOUND', 'قالب پیدا نشد.');
    d.prepare('UPDATE message_templates SET name=?, event_type=?, channel=?, subject=?, body=?, active=?, updated_by=?, updated_at=? WHERE id=?')
      .run(name, event_type, channel, subject, body, active, user.id, nowIso(), ex.id);
    audit(user, 'customer_message', ex.id, 'template_update', { name: ex.name, body: ex.body }, { name, body }, '');
    return { id: ex.id };
  }
  const info = d.prepare('INSERT INTO message_templates(name, event_type, channel, subject, body, active, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(name, event_type, channel, subject, body, active, user.id, nowIso(), user.id, nowIso());
  const nid = Number(info.lastInsertRowid);
  audit(user, 'customer_message', nid, 'template_create', null, { name, event_type, channel }, '');
  return { id: nid };
}
function deleteTemplate(user, id) {
  requirePerm(user, 'customer_message', 'manage');
  const d = get();
  const ex = d.prepare('SELECT * FROM message_templates WHERE id=?').get(parseId(id));
  if (!ex) throw new HttpError(404, 'NOT_FOUND', 'قالب پیدا نشد.');
  d.prepare('DELETE FROM message_templates WHERE id=?').run(ex.id);
  audit(user, 'customer_message', ex.id, 'template_delete', { name: ex.name, body: ex.body }, null, '');
  return { ok: true };
}

// ---------- variable rendering (real data only) ----------
function nowJalaaliStr() {
  const n = new Date();
  const [jy, jm, jd] = gregorianToJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}
function buildVars(user, event_type, doc, customer) {
  const amount = Number(doc && (event_type === 'payment' ? doc.amount : doc.total)) || 0;
  return {
    customer_name: customer ? (customer.name || '') : '',
    name: customer ? (customer.name || '') : '', // legacy alias (campaigns-style)
    doc_number: (doc && (doc.number || doc.number)) || '',
    amount: amount ? fmtNum(amount, false) : '0',
    date: nowJalaaliStr(),
    user_name: user ? (user.full_name || user.username || '') : '',
  };
}
function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}
function defaultBody(event_type) {
  switch (event_type) {
    case 'quote': return 'سلام {{customer_name}}، پیش‌فاکتور {{doc_number}} به مبلغ {{amount}} ریال برای شما ثبت شد. تاریخ: {{date}} — {با احترام، {{user_name}}}';
    case 'invoice': return 'سلام {{customer_name}}، فاکتور {{doc_number}} به مبلغ {{amount}} ریال صادر شد. تاریخ: {{date}} — {با احترام، {{user_name}}}';
    case 'payment': return 'سلام {{customer_name}}، پرداخت {{doc_number}} به مبلغ {{amount}} ریال ثبت شد. تاریخ: {{date}} — {با احترام، {{user_name}}}';
    case 'shipment': return 'سلام {{customer_name}}، سفارش {{doc_number}} به مبلغ {{amount}} ریال ارسال شد. تاریخ: {{date}} — {با احترام، {{user_name}}}';
    default: return '';
  }
}

// ---------- document loading + validation (real DB data) ----------
function loadDoc(d, event_type, docId, customerId) {
  if (event_type === 'manual') return { doc: null };
  let doc = null;
  if (event_type === 'quote') doc = d.prepare('SELECT id, number, total, customer_id FROM quotes WHERE id=?').get(docId);
  else if (event_type === 'invoice') doc = d.prepare('SELECT id, number, total, customer_id FROM invoices WHERE id=?').get(docId);
  else if (event_type === 'payment') doc = d.prepare('SELECT id, number, amount, customer_id FROM payments WHERE id=?').get(docId);
  else if (event_type === 'shipment') doc = d.prepare('SELECT id, number, total, customer_id FROM orders WHERE id=?').get(docId);
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'سند موردنظر پیدا نشد.');
  if (doc.customer_id !== customerId) throw new HttpError(422, 'VALIDATION', 'این سند متعلق به مشتری انتخاب‌شده نیست.');
  return { doc };
}

// ---------- send (manual) ----------
async function sendCustomerMessage(user, ipAddr, payload) {
  requirePerm(user, 'customer_message', 'send');
  const st = getMessagingSettings();
  if (!st.enabled) throw new HttpError(400, 'MESSAGING_DISABLED', 'پیام‌رسانی مشتریان در تنظیمات غیرفعال است.');
  const d = get();
  const customerId = Number(payload.customer_id);
  if (!customerId || !d.prepare('SELECT id FROM customers WHERE id=?').get(customerId)) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  const customer = d.prepare('SELECT id, name, mobile, phone FROM customers WHERE id=?').get(customerId);
  const contact = customer.mobile || customer.phone;
  if (!contact) throw new HttpError(422, 'NO_CONTACT', 'برای این مشتری شماره تماس معتبر ثبت نشده است.');
  const event_type = EVENTS.includes(payload.event_type) ? payload.event_type : 'manual';
  const channel = CHANNELS.includes(payload.channel) ? payload.channel : st.default_channel;
  const { doc } = loadDoc(d, event_type, Number(payload.doc_id) || 0, customerId);
  // template resolution: explicit id → first active for (event, channel) → default body
  let templateId = null; let subject = payload.subject || null; let body = '';
  if (payload.template_id) {
    const tpl = d.prepare('SELECT * FROM message_templates WHERE id=? AND active=1').get(parseId(payload.template_id));
    if (!tpl) throw new HttpError(404, 'NOT_FOUND', 'قالب پیدا نشد.');
    templateId = tpl.id; subject = subject || tpl.subject; body = tpl.body;
  } else if (payload.body !== undefined && String(payload.body).trim()) {
    body = String(payload.body).trim();
  } else {
    const tpl = d.prepare('SELECT * FROM message_templates WHERE event_type=? AND channel=? AND active=1 ORDER BY id DESC LIMIT 1').get(event_type, channel);
    if (tpl) { templateId = tpl.id; subject = subject || tpl.subject; body = tpl.body; }
    else body = defaultBody(event_type);
  }
  if (!body || !String(body).trim()) throw new HttpError(422, 'VALIDATION', 'متن پیام خالی است (قالب یا متن دستی وارد کنید).');
  if (body.length > 2000) throw new HttpError(422, 'VALIDATION', 'متن پیام بیش از حد مجاز است.');
  const vars = buildVars(user, event_type, doc, customer);
  const rendered = renderTemplate(body, vars);
  const renderedSubject = subject ? renderTemplate(subject, vars) : '';
  // provider state — honesty: no configuration ⇒ not_configured, no external call
  const cfg = getSetting(channel);
  const configured = !!(cfg && cfg.active && cfg.settings && Object.keys(cfg.settings).length > 0);
  let status = 'not_configured'; let error = 'سرویس پیام‌رسانی «' + channel + '» پیکربندی نشده است. از Admin ← تنظیمات → یکپارچه‌سازی‌ها پنل را تنظیم کنید.';
  if (configured) {
    try {
      await sendViaProvider(channel, cfg, String(contact), rendered, renderedSubject || undefined);
      status = 'sent'; error = '';
    } catch (e) {
      status = 'failed'; error = String(e && e.message || e).slice(0, 300);
    }
  }
  const now = nowIso();
  const info = d.prepare(`INSERT INTO customer_messages(customer_id, user_id, event_type, doc_type, doc_id, doc_number, channel, template_id, to_addr, subject, body, status, error, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(customerId, user.id, event_type, doc ? (event_type === 'shipment' ? 'order' : event_type) : null, doc ? doc.id : null, doc ? doc.number : null, channel, templateId, String(contact), renderedSubject || null, rendered, status, error, now, now);
  const msgId = Number(info.lastInsertRowid);
  // also into the existing outbox (delivery tracking via panel webhooks stays consistent)
  d.prepare('INSERT INTO outbox(provider, channel, to_addr, subject, body, ref_type, ref_id, status, error, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(cfg && cfg.key ? cfg.key : channel, channel, String(contact), renderedSubject || '', rendered, doc ? (event_type === 'shipment' ? 'order' : event_type) : 'customer', doc ? doc.id : customerId, status === 'sent' ? 'sent' : (status === 'failed' ? 'failed' : 'queued'), error, now, now);
  addActivity(doc ? (event_type === 'shipment' ? 'order' : event_type) : 'customer', doc ? doc.id : customerId, user.id, 'customer_message', `پیام ${channel} به مشتری: ${status === 'sent' ? 'ارسال شد' : status === 'failed' ? 'ناموفق' : 'در انتظار پیکربندی سرویس'}`);
  audit(user, 'customer_message', msgId, 'send', null,
    { customer_id: customerId, customer: customer.name, event_type, doc_type: doc ? (event_type === 'shipment' ? 'order' : event_type) : null, doc_id: doc ? doc.id : null, doc_number: doc ? doc.number : null, channel, template_id: templateId, status, to_addr: String(contact) },
    ipAddr || '');
  return { ok: true, id: msgId, status, error: status === 'sent' ? '' : error, to_addr: String(contact), body: rendered };
}

// ---------- auto-send on events (fire-and-forget; never breaks the main flow) ----------
function autoSendForEvent(event_type, docId, actorUser) {
  try {
    const st = getMessagingSettings();
    if (!st.enabled || !st.auto_send[event_type]) return;
    const d = get();
    let doc = null;
    if (event_type === 'quote') doc = d.prepare('SELECT id, number, total, customer_id FROM quotes WHERE id=?').get(docId);
    else if (event_type === 'invoice') doc = d.prepare('SELECT id, number, total, customer_id FROM invoices WHERE id=?').get(docId);
    else if (event_type === 'payment') doc = d.prepare('SELECT id, number, amount, customer_id FROM payments WHERE id=?').get(docId);
    else if (event_type === 'shipment') doc = d.prepare('SELECT id, number, total, customer_id FROM orders WHERE id=?').get(docId);
    if (!doc) return;
    const sysUser = actorUser && actorUser.id ? actorUser : { id: 0, username: 'system', full_name: 'سیستم' };
    const run = async () => {
      try { await sendCustomerMessage(sysUser, '', { customer_id: doc.customer_id, event_type, doc_id: doc.id, channel: st.default_channel }); }
      catch (e) { console.error('customermsg auto-send', event_type, e.message); }
    };
    Promise.resolve().then(run);
  } catch (e) { console.error('customermsg auto-send guard', e.message); }
}

// ---------- message log ----------
function listMessages(user, q) {
  requirePerm(user, 'customer_message', 'view');
  const d = get();
  const where = ['1=1']; const params = [];
  if (q.status && STATUSES.includes(q.status)) { where.push('m.status=?'); params.push(q.status); }
  if (q.event_type && EVENTS.includes(q.event_type)) { where.push('m.event_type=?'); params.push(q.event_type); }
  if (q.channel && CHANNELS.includes(q.channel)) { where.push('m.channel=?'); params.push(q.channel); }
  if (q.customer_id) { where.push('m.customer_id=?'); params.push(Number(q.customer_id)); }
  const perPage = Math.min(parseInt(q.per_page) || 50, 200);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const total = d.prepare(`SELECT COUNT(*) c FROM customer_messages m WHERE ${where.join(' AND ')}`).get(...params).c;
  const items = d.prepare(`SELECT m.*, c.name AS customer_name, u.full_name AS user_name FROM customer_messages m LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN users u ON u.id=m.user_id WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...params, perPage, (page - 1) * perPage);
  return { items, total, page, pages: Math.ceil(total / perPage) || 1 };
}

module.exports = {
  EVENTS, CHANNELS, STATUSES,
  sendCustomerMessage, autoSendForEvent,
  listMessages, listTemplates, saveTemplate, deleteTemplate,
  getMessagingSettingsApi, setMessagingSettingsApi, getMessagingSettings, channelStates, getChannelStatesApi,
};
