'use strict';
const { get } = require('../../db/db');
const { nowIso } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { requirePerm, hasPerm } = require('../../auth/auth');
const assistant = require('../../ai/assistant');
const engine = require('../../ai/engine');
const provider = require('../../ai/provider');
const { audit } = require('../../core/audit');

function listConversations(user) {
  const d = get();
  return { items: d.prepare('SELECT id, title, created_at FROM ai_conversations WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id) };
}
async function chat(user, data) {
  const d = get();
  const query = String(data.query || '').trim();
  if (!query) throw new HttpError(422, 'VALIDATION', 'متن سؤال خالی است.');
  let convId = data.conversation_id ? Number(data.conversation_id) : 0;
  if (!convId || !d.prepare('SELECT id FROM ai_conversations WHERE id=? AND user_id=?').get(convId, user.id)) {
    const title = query.slice(0, 60);
    const info = d.prepare('INSERT INTO ai_conversations(user_id, title, created_at) VALUES(?,?,?)').run(user.id, title, nowIso());
    convId = Number(info.lastInsertRowid);
  }
  d.prepare('INSERT INTO ai_messages(conversation_id, role, content, created_at) VALUES(?,?,?,?)').run(convId, 'user', query, nowIso());
  const history = d.prepare('SELECT role, content FROM ai_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 6').all(convId).reverse();
  const ctxMessages = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  let result;
  try {
    result = await assistant.answer(query, user, ctxMessages);
  } catch (e) {
    console.error('ai answer error', e);
    result = { text: 'خطایی در پردازش سؤال رخ داد. لطفاً دوباره تلاش کنید.', intent: 'error' };
  }
  d.prepare('INSERT INTO ai_messages(conversation_id, role, content, data, provider, created_at) VALUES(?,?,?,?,?,?)')
    .run(convId, 'assistant', result.text, result.data ? JSON.stringify(result.data) : null, result.provider || 'local', nowIso());
  // pass through engine/note so clients (and tests) can see WHICH engine answered (honesty)
  return { conversation_id: convId, text: result.text, intent: result.intent, data: result.data, engine: result.engine, note: result.note };
}
// ---------------- Knowledge base ----------------
function kbDocuments(user, q) {
  const d = get();
  const where = ["kind='kb'"], params = [];
  if (q.q) { where.push('(title LIKE ? OR text_content LIKE ?)'); const t = '%' + q.q + '%'; params.push(t, t); }
  const rows = d.prepare(`SELECT id, title, category, tags, LENGTH(text_content) len, created_at, (SELECT full_name FROM users WHERE id=documents.user_id) uploader FROM documents WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...params);
  return { items: rows };
}
function saveKbDoc(user, data) {
  const d = get();
  requirePerm(user, 'document', 'edit');
  if (!data.title) throw new HttpError(422, 'VALIDATION', 'عنوان الزامی است.');
  const text = String(data.text_content || '').slice(0, 500000);
  if (!text && !data.file_name) throw new HttpError(422, 'VALIDATION', 'متن سند یا فایل الزامی است.');
  const info = d.prepare('INSERT INTO documents(title, kind, category, text_content, tags, user_id, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(data.title, 'kb', data.category || '', text, data.tags || '', user.id, nowIso());
  const id = Number(info.lastInsertRowid);
  require('../../db/db').searchIndex('document', id, data.title, text.slice(0, 2000));
  audit(user, 'document', id, 'create', null, { title: data.title, kind: 'kb' });
  return { id };
}
function deleteKbDoc(user, id) {
  const d = get();
  requirePerm(user, 'document', 'delete');
  const doc = d.prepare('SELECT * FROM documents WHERE id=? AND kind=?').get(id, 'kb');
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'سند پیدا نشد.');
  d.prepare('DELETE FROM documents WHERE id=?').run(id);
  require('../../db/db').searchRemove('document', id);
  audit(user, 'document', id, 'delete', null, null);
  return { ok: true };
}
function ragSearch(user, query) {
  return engine.rag(query, 5);
}
// ---------------- Analytics endpoints ----------------
function leadScoring(user) {
  const d = get();
  requirePerm(user, 'lead', 'view');
  const rows = d.prepare(`SELECT l.id, l.number, l.company, l.contact_name, l.source, l.estimated_value, l.status, l.score,
    u.full_name salesperson_name, l.created_at FROM leads l LEFT JOIN users u ON u.id=l.salesperson_id
    WHERE l.archived_at IS NULL AND l.status IN ('new','contacted','qualified') ORDER BY l.score DESC LIMIT 100`).all();
  return { items: rows.map(r => ({ ...r, reasons: scoreReasons('lead', r.id) })) };
}
function rescoreLeads(user) {
  requirePerm(user, 'lead', 'edit');
  const n = engine.rescoreAllLeads();
  audit(user, 'ai', 0, 'rescore_leads', null, { count: n });
  return { ok: true, count: n };
}
function churnPrediction(user) {
  requirePerm(user, 'customer', 'view');
  const list = engine.churnList(30);
  return { items: list };
}
function salesForecast(user, granularity, horizon) {
  requirePerm(user, 'invoice', 'view');
  const f = engine.forecast(granularity || 'month', horizon || 3);
  return f;
}
function opportunityScoring(user) {
  const d = get();
  requirePerm(user, 'opportunity', 'view');
  const rows = d.prepare(`SELECT o.id, o.title, o.amount, o.probability, o.status, c.name customer_name, o.expected_close_at, st.name stage_name
    FROM opportunities o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN pipeline_stages st ON st.id=o.stage_id
    WHERE o.status='open' AND o.archived_at IS NULL ORDER BY o.probability DESC LIMIT 100`).all();
  return { items: rows };
}
function anomalyReport(user) {
  requirePerm(user, 'invoice', 'view');
  return { items: engine.anomalies() };
}
function executiveSummary(user) {
  requirePerm(user, 'invoice', 'view');
  return engine.executiveSummary();
}
function customerInsights(user, customerId) {
  requirePerm(user, 'customer', 'view');
  const d = get();
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  const churn = engine.churnScore(customerId);
  const recs = engine.recommendations(customerId);
  const clv = engine.clv(customerId);
  const sent = (() => {
    const texts = d.prepare(`SELECT subject, description FROM complaints WHERE customer_id=? LIMIT 10`).all(customerId).map(t => t.subject + ' ' + t.description);
    if (!texts.length) return null;
    return engine.sentiment(texts.join(' '));
  })();
  return { customer: { id: c.id, name: c.name }, churn, recommendations: recs, clv, sentiment: sent };
}
function scoreReasons(entityType, id) {
  const r = get().prepare('SELECT data FROM ai_scores WHERE entity_type=? AND entity_id=? ORDER BY id DESC LIMIT 1').get(entityType, id);
  if (!r) return [];
  try { return JSON.parse(r.data).reasons || []; } catch { return []; }
}
function aiConfigInfo() {
  const c = provider.getConfig();
  return { provider: c.provider, model: c.model || '', configured: provider.isConfigured(), hasKey: !!(c.apiKey) };
}
module.exports = {
  listConversations, chat, kbDocuments, saveKbDoc, deleteKbDoc, ragSearch,
  leadScoring, rescoreLeads, churnPrediction, salesForecast, opportunityScoring,
  anomalyReport, executiveSummary, customerInsights, aiConfigInfo,
};
