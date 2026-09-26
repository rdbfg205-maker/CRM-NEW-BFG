'use strict';
// AI Gateway routes: per-module analysis, workflow AI, settings, test, logs.
const { get, getSetting, setSetting, DATA_DIR } = require('../../db/db');
const { nowIso, fmtNum, faDigits, fmtDateLong } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { requirePerm, requireUser } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const gw = require('../../core/ai-gateway');
const aireport = require('./aireport');

function isAdmin(user) {
  return !!get().prepare("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.name='super_admin'").get(user.id);
}
function buildContext(module, entityId) {
  const d = get();
  const id = Number(entityId);
  switch (module) {
    case 'customer': {
      const c = d.prepare('SELECT * FROM customers WHERE id=?').get(id);
      if (!c) return null;
      const inv = d.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM invoices WHERE customer_id=? AND status!='cancelled'").get(id);
      const comp = d.prepare("SELECT COUNT(*) c FROM complaints WHERE customer_id=? AND status IN ('new','in_progress','waiting')").get(id);
      const opp = d.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM opportunities WHERE customer_id=? AND status='open'").get(id);
      const last = d.prepare("SELECT issue_date, total FROM invoices WHERE customer_id=? AND status!='cancelled' ORDER BY issue_date DESC LIMIT 1").get(id);
      return { name: c.name, type: c.type, city: c.city, status: c.status, total_spent: inv.s, invoice_count: inv.c, open_complaints: comp.c, open_opportunities: opp.c, open_opportunities_value: opp.s, last_purchase: last ? last.issue_date : null, churn_score: c.churn_score };
    }
    case 'complaint': {
      const c = d.prepare('SELECT * FROM complaints WHERE id=?').get(id);
      if (!c) return null;
      return { number: c.number, subject: c.subject, description: c.description, category: c.category, priority: c.priority, status: c.status };
    }
    case 'order': { const c = d.prepare('SELECT * FROM orders WHERE id=?').get(id); if (!c) return null; return { number: c.number, status: c.status, total: c.total, order_date: c.order_date, due_date: c.due_date }; }
    case 'invoice': { const c = d.prepare('SELECT * FROM invoices WHERE id=?').get(id); if (!c) return null; return { number: c.number, status: c.status, total: c.total, paid_amount: c.paid_amount, due_date: c.due_date }; }
    case 'lead': { const c = d.prepare('SELECT * FROM leads WHERE id=?').get(id); if (!c) return null; return { company: c.company, source: c.source, estimated_value: c.estimated_value, status: c.status, score: c.score }; }
    case 'opportunity': { const c = d.prepare('SELECT * FROM opportunities WHERE id=?').get(id); if (!c) return null; return { title: c.title, amount: c.amount, probability: c.probability, status: c.status }; }
    case 'lab_request': { const c = d.prepare('SELECT * FROM lab_requests WHERE id=?').get(id); if (!c) return null; return { number: c.number, test_type: c.test_type, status: c.status, priority: c.priority }; }
    default: return null;
  }
}
function fmtVal(v) { if (typeof v === 'number') return fmtNum(v); if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDateLong(v); return String(v); }
const SYS = 'تو تحلیلگر داده در CRM شرکت دانش‌بنیان بسپار فوم غرب هستی. فقط بر اساس دادهٔ واقعی ارائه‌شده پاسخ بده. اگر داده کافی نیست صریحاً بگو «اطلاعات کافی برای ارائه نتیجه قابل اعتماد وجود ندارد». پاسخ به فارسی، کوتاه و ساختاریافته باشد.';
const FIELD_FA = { name: 'نام', type: 'نوع', city: 'شهر', status: 'وضعیت', total_spent: 'مجموع خرید', invoice_count: 'تعداد فاکتور', open_complaints: 'شکایات باز', open_opportunities: 'فرصت‌های باز', open_opportunities_value: 'ارزش فرصت‌های باز', last_purchase: 'آخرین خرید', churn_score: 'ریسک ریزش', number: 'شماره', subject: 'موضوع', description: 'شرح', category: 'دسته', priority: 'اولویت', total: 'مجموع', paid_amount: 'پرداخت‌شده', due_date: 'سررسید', order_date: 'تاریخ سفارش', company: 'شرکت', source: 'منبع', estimated_value: 'ارزش تخمینی', score: 'امتیاز', title: 'عنوان', probability: 'احتمال', test_type: 'نوع آزمون' };
// Section 9: AI analysis must respect the entity's view permission (no bypassing row access)
const MODULE_ENTITY = {
  customer: 'customer', complaint: 'complaint', order: 'order', invoice: 'invoice',
  lead: 'lead', opportunity: 'opportunity', lab_request: 'lab_request',
};
function assertEntityRowAccess(user, module, entityId) {
  const entity = MODULE_ENTITY[module];
  if (!entity) return;
  const { R } = require('../resources');
  const r = R[entity];
  if (!r) return;
  const { scopeWhere } = require('../../auth/auth');
  const scope = requirePerm(user, entity, 'view'); // throws 403 without entity:view
  if (scope === 'all') return;
  const field = r.scopeField || r.scopeFallback || null;
  if (!field) return;
  const sc = scopeWhere(entity, user, scope, field);
  if (!sc.where) return;
  const row = get().prepare(`SELECT 1 AS x FROM ${r.table} WHERE id=? AND ${sc.where}`).get(Number(entityId), ...sc.params);
  if (!row) throw new HttpError(403, 'FORBIDDEN', 'دسترسی به این رکورد ندارید.');
}
async function analyze(user, module, entityId) {
  assertEntityRowAccess(user, module, entityId);
  if (!gw.moduleEnabled(module)) return { text: 'هوش مصنوعی برای این ماژول غیرفعال است.', source: 'disabled' };
  const context = buildContext(module, entityId);
  const builtin = () => {
    if (!context) return 'اطلاعات کافی برای ارائه نتیجه قابل اعتماد وجود ندارد.';
    const lines = [];
    for (const [k, v] of Object.entries(context)) { if (v === null || v === undefined || v === '') continue; lines.push('• ' + (FIELD_FA[k] || k) + ': ' + fmtVal(v)); }
    if (!lines.length) return 'اطلاعات کافی برای ارائه نتیجه قابل اعتماد وجود ندارد.';
    const modFa = ({ customer: 'مشتری', complaint: 'شکایت', order: 'سفارش', invoice: 'فاکتور', lead: 'سرنخ', opportunity: 'فرصت فروش', lab_request: 'درخواست آزمایش' }[module] || module);
    return 'تحلیل «' + modFa + '» بر اساس دادهٔ واقعی سیستم:\n' + lines.join('\n');
  };
  const messages = [{ role: 'user', content: 'دادهٔ واقعی یک رکورد:\n' + JSON.stringify(context, null, 2) + '\nوضعیت را تحلیل کن و اقدام پیشنهادی بده.' }];
  return await gw.ask(user, module, 'analyze', messages, SYS, builtin);
}
async function analyzeProcess(user, processId) {
  if (!gw.moduleEnabled('workflow')) return { text: 'هوش مصنوعی برای فرآیندها غیرفعال است.', source: 'disabled' };
  const d = get();
  const p = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const insts = d.prepare("SELECT * FROM wf_instances WHERE process_id=? AND status='running'").all(processId);
  const steps = d.prepare("SELECT s.*, u.full_name assignee_name FROM wf_steps s LEFT JOIN users u ON u.id=s.assignee_id WHERE s.instance_id IN (SELECT id FROM wf_instances WHERE process_id=?) AND s.status='active'").all(processId);
  const context = { process: { name: p.name, module: p.module }, running_instances: insts.length, active_steps: steps.map(s => ({ node: s.node_title, assignee: s.assignee_name || null, since: s.started_at, hours: Math.round((Date.now() - new Date(s.started_at).getTime()) / 3600000) })) };
  const builtin = () => {
    const stepsFa = steps.length ? steps.map(s => '«' + s.node_title + '»' + (s.assignee_name ? ' (مسئول: ' + s.assignee_name + ')' : ' (بدون مسئول)') + ' — در انتظار از ' + faDigits(Math.round((Date.now() - new Date(s.started_at).getTime()) / 3600000)) + ' ساعت').join('، ') : 'هیچ مرحلهٔ فعالی در انتظار نیست';
    return 'تحلیل فرآیند «' + p.name + '» بر اساس دادهٔ واقعی:\n• فرآیندهای در حال اجرا: ' + faDigits(insts.length) + '\n• گلوگاه‌های فعال: ' + stepsFa + '\nپیشنهاد: گلوگاه‌های بالا را به‌روزرسانی یا مسئول آن‌ها را تعیین کنید.';
  };
  const messages = [{ role: 'user', content: 'تحلیل فرآیند و شناسایی گلوگاه و پیشنهاد بهبود:\n' + JSON.stringify(context, null, 2) }];
  return await gw.ask(user, 'workflow', 'analyze_process', messages, SYS, builtin);
}
function settings() { return gw.configForUi(); }
function saveSettings(user, patch) {
  requirePerm(user, 'settings', 'edit');
  const cur = gw.configForUi();
  if (patch.online_api_key && String(patch.online_api_key).startsWith('•')) patch.online_api_key = cur.online_api_key;
  const next = gw.saveConfigForUi(user, patch);
  audit(user, 'settings', 0, 'ai_settings_update', null, { keys: Object.keys(patch) });
  return gw.configForUi();
}
async function testConnection(user) {
  const c = gw.aiConfig();
  const out = { online: null, local: null };
  if (c.online_enabled && c.online_api_key) {
    try { const r = await gw.callOnline(c, [{ role: 'user', content: 'ping' }], 'ping', c.online_timeout_ms); out.online = { ok: true, model: r.model, sample: (r.text || '').slice(0, 80) }; }
    catch (e) { out.online = { ok: false, error: e.message }; }
  } else out.online = { ok: false, error: 'غیرفعال یا بدون کلید' };
  if (c.offline_enabled && c.local_endpoint) {
    try { const r = await gw.callLocal(c, [{ role: 'user', content: 'ping' }], 'ping', c.local_timeout_ms); out.local = { ok: true, model: r.model, sample: (r.text || '').slice(0, 80) }; }
    catch (e) { out.local = { ok: false, error: e.message }; }
  } else out.local = { ok: false, error: 'غیرفعال یا بدون endpoint' };
  return out;
}
function listLogs(user) {
  if (!isAdmin(user)) requirePerm(user, 'ai_log', 'view');
  const items = d().prepare('SELECT a.*, u.full_name FROM ai_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300').all();
  return { items: items.map(i => ({ ...i, duration_ms: i.duration_ms, tokens: i.tokens })) };
}
function d() { return get(); }
module.exports = { analyze, analyzeProcess, settings, saveSettings, testConnection, listLogs, aireport };
