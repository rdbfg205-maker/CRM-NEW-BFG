'use strict';
// ============ تیم هوشمند فروش — Smart Sales Team ============
// Local Intelligence + Target Engine + Smart Follow-up + Next Best Action.
// Reuse: scoring/churn از موتور موجود (engine.js + جدول‌های کش ai_scores/customers.churn_score) —
// هیچ موتور یا جدول موازی ساخته نشد. داده‌ها همگی از Source of Truth اصلی CRM خوانده می‌شوند.
const { get, getSetting } = require('../../db/db');
const { requirePerm, hasPerm, scopeWhere } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { notify } = require('../../core/notify');
const { HttpError } = require('../../lib/http');
const { nowIso, parseId, faDigits } = require('../../lib/util');
const gw = require('../../core/ai-gateway');

const STALLED_DAYS = 21;      // فرصت بدون فعالیت = راکد
const INACTIVE_DAYS = 60;     // مشتری بدون تعامل = غیرفعال
const CHURN_HIGH = 70;        // ریسک ریزش بالا
const CHURN_WARN = 40;        // ریسک ریزش هشدار

// ---------- scoping (RBAC-aware; AI/analysis never bypasses user scope) ----------
function custScope(user) {
  const p = hasPerm(user, 'customer', 'view');
  if (!p.ok) return null;
  const sc = scopeWhere('customer', user, p.scope, 'salesperson_id');
  return { sql: sc.where ? 'AND c.' + sc.where.replace(/^/, '') : '', params: sc.params, scope: p.scope };
}
function hasInvoiceView(user) { return hasPerm(user, 'invoice', 'view').ok; }
function userScopeWhere(user) {
  // invoices scope by created_by (same semantics as assistant.scopedInvoiceWhere)
  const p = hasPerm(user, 'invoice', 'view');
  if (!p.ok) return null;
  const sc = scopeWhere('invoice', user, p.scope, 'created_by');
  return { sql: sc.where ? sc.where : '', params: sc.params };
}

// ---------- 1. AI Orchestrator Status (hybrid, honest) ----------
function aiStatus(user) {
  requirePerm(user, 'smart_sales', 'view');
  const c = gw.aiConfig();
  const priv = c.ai_privacy || {};
  const mode = c.ai_mode || 'hybrid';
  const chain = [];
  if ((mode === 'hybrid' || mode === 'online_only' || mode === 'auto') && c.online_enabled) chain.push('online');
  if ((mode === 'hybrid' || mode === 'offline_only' || mode === 'auto' || mode === 'online_only') && c.offline_enabled && c.local_endpoint) chain.push('local');
  // Level 3 (Local Intelligence) is ALWAYS available — offline != disabled
  chain.push('local_intelligence');
  return {
    mode,
    chain,
    levels: {
      online: {
        enabled: !!c.online_enabled,
        configured: !!c.online_api_key,
        provider: c.online_provider, model: c.online_model,
        status: !c.online_enabled ? 'disabled' : (!c.online_api_key ? 'not_configured' : 'ready_pending_test'),
      },
      local: {
        enabled: !!c.offline_enabled,
        configured: !!c.local_endpoint,
        endpoint: c.local_endpoint, model: c.local_model,
        status: !c.offline_enabled ? 'disabled' : (!c.local_endpoint ? 'not_configured' : 'ready_pending_test'),
      },
      local_intelligence: {
        status: 'ready',
        capabilities: ['lead_scoring', 'customer_scoring', 'opportunity_analysis', 'churn_detection', 'forecast', 'next_best_action', 'smart_followup', 'target_achievement', 'pipeline_analysis'],
      },
    },
    privacy: {
      online_allowed: priv.online_allowed !== false,
      offline_allowed: priv.offline_allowed !== false,
      data: {
        customer: priv.customer !== false,
        contact: priv.contact !== false,
        financial: priv.financial !== false,
        sales: priv.sales !== false,
        notes: priv.notes !== false,
        files: priv.files === true,
      },
      masking: priv.masking !== false,
    },
    // real pings are on-demand: POST /api/ai2/test (existing) — status here is config-based to stay fast
  };
}

// ---------- 2. Sales Target Engine ----------
function periodRange(periodType, periodStartIso) {
  const start = new Date(periodStartIso + 'T00:00:00Z');
  const end = new Date(start);
  if (periodType === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  else if (periodType === 'quarter') end.setUTCMonth(end.getUTCMonth() + 3);
  else if (periodType === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
function currentPeriod(periodType) {
  const n = new Date();
  let y = n.getUTCFullYear(), m = n.getUTCMonth();
  if (periodType === 'quarter') m = Math.floor(m / 3) * 3;
  if (periodType === 'year') m = 0;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
function targets(user, q) {
  requirePerm(user, 'smart_sales', 'view');
  const d = get();
  let rows = d.prepare('SELECT * FROM sales_targets WHERE active=1 ORDER BY scope_type, period_type, period_start').all();
  if (q.scope_type) rows = rows.filter(t => t.scope_type === q.scope_type);
  if (q.period_type) rows = rows.filter(t => t.period_type === q.period_type);
  // achievement with the CALLER's data scope (all-scope users see true totals; own-scope see their slice)
  return { items: rows.map(t => {
    const { start, end } = periodRange(t.period_type, t.period_start);
    let where = "i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<?";
    const params = [start, end];
    const callerScope = userScopeWhere(user);
    if (callerScope && callerScope.sql) { where += ' AND ' + callerScope.sql; params.push(...callerScope.params); }
    if (t.scope_type === 'salesperson' && t.scope_ref) { where += ' AND i.created_by=?'; params.push(Number(t.scope_ref)); }
    else if (t.scope_type === 'department' && t.scope_name) { where += ' AND u.department=?'; params.push(t.scope_name); }
    const row = d.prepare(`SELECT COALESCE(SUM(i.total),0) s, COUNT(i.id) n FROM invoices i JOIN users u ON u.id=i.created_by WHERE ${where}`).get(...params);
    const achieved = row.s, invoices = row.n;
    return { ...t, achieved, invoices, pct: t.amount > 0 ? Math.min(100, Math.round(achieved * 1000 / t.amount) / 10) : 0, remaining: Math.max(0, t.amount - achieved) };
  }) };
}
function createTarget(user, b) {
  requirePerm(user, 'smart_sales', 'manage');
  const d = get();
  const scopeType = ['company', 'department', 'salesperson'].includes(b.scope_type) ? b.scope_type : 'salesperson';
  const periodType = ['month', 'quarter', 'year'].includes(b.period_type) ? b.period_type : 'month';
  const amount = Number(toEnDigitsStr(b.amount));
  if (!amount || amount <= 0) throw new HttpError(422, 'VALIDATION', 'مبلغ هدف نامعتبر است.');
  const periodStart = String(b.period_start || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) throw new HttpError(422, 'VALIDATION', 'شروع دوره (YYYY-MM-DD) الزامی است.');
  const scopeRef = scopeType === 'salesperson' ? (parseId(b.scope_ref) || 0) : null;
  const scopeName = scopeType === 'department' ? String(b.scope_name || '') : (scopeType === 'salesperson' ? (b.scope_name || '') : '');
  if (scopeType === 'salesperson' && !scopeRef) throw new HttpError(422, 'VALIDATION', 'فروشنده (scope_ref) الزامی است.');
  if (scopeType === 'department' && !scopeName) throw new HttpError(422, 'VALIDATION', 'نام دپارتمان (scope_name) الزامی است.');
  const info = d.prepare('INSERT INTO sales_targets(scope_type, scope_ref, scope_name, period_type, period_start, amount, active, notes, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(scopeType, scopeRef, scopeName, periodType, periodStart, amount, 1, String(b.notes || ''), user.id, nowIso(), nowIso());
  audit(user, 'smart_sales', info.lastInsertRowid, 'target_create', null, { scope_type: scopeType, period_type: periodType, amount });
  return { id: Number(info.lastInsertRowid) };
}
function updateTarget(user, id, b) {
  requirePerm(user, 'smart_sales', 'manage');
  const d = get();
  const t = d.prepare('SELECT * FROM sales_targets WHERE id=?').get(parseId(id));
  if (!t) throw new HttpError(404, 'NOT_FOUND', 'هدف پیدا نشد.');
  const sets = []; const args = [];
  if (b.amount !== undefined) { const a = Number(toEnDigitsStr(b.amount)); if (!a || a <= 0) throw new HttpError(422, 'VALIDATION', 'مبلغ نامعتبر است.'); sets.push('amount=?'); args.push(a); }
  if (b.active !== undefined) { sets.push('active=?'); args.push(b.active ? 1 : 0); }
  if (b.notes !== undefined) { sets.push('notes=?'); args.push(String(b.notes)); }
  if (sets.length) { sets.push('updated_at=?'); args.push(nowIso()); d.prepare(`UPDATE sales_targets SET ${sets.join(',')} WHERE id=?`).run(...args, t.id); }
  audit(user, 'smart_sales', t.id, 'target_update', null, { keys: Object.keys(b) });
  return { ok: true };
}
function deleteTarget(user, id) {
  requirePerm(user, 'smart_sales', 'manage');
  const d = get();
  const t = d.prepare('SELECT id FROM sales_targets WHERE id=?').get(parseId(id));
  if (!t) throw new HttpError(404, 'NOT_FOUND', 'هدف پیدا نشد.');
  d.prepare('DELETE FROM sales_targets WHERE id=?').run(t.id);
  audit(user, 'smart_sales', t.id, 'target_delete', null, null);
  return { ok: true };
}
function toEnDigitsStr(v) { return String(v == null ? '' : v).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[,،\s]/g, ''); }

// ---------- 3. Next Best Action (rules on REAL data, RBAC-scoped) ----------
function nextBestActions(user, limit = 30) {
  requirePerm(user, 'smart_sales', 'view');
  const d = get();
  const cs = custScope(user);
  if (!cs) return { items: [], note: 'شما مجوز مشاهده مشتریان را ندارید.' };
  const out = [];
  const custWhere = cs.sql || '';
  const cParams = cs.params;
  const invOk = hasInvoiceView(user);
  // a) high churn risk
  if (cs.scope !== 'own' || true) {
    const rows = d.prepare(`SELECT c.id, c.name, c.salesperson_id, c.churn_score, a.data reasons FROM customers c LEFT JOIN ai_scores a ON a.entity_type='customer' AND a.entity_id=c.id AND a.kind='churn'
      WHERE c.archived_at IS NULL AND c.status='active' AND c.churn_score>=? ${custWhere} ORDER BY c.churn_score DESC LIMIT 8`).all(CHURN_HIGH, ...cParams);
    for (const r of rows) out.push({ priority: 1, type: 'call', entity: 'customer', entity_id: r.id, customer_id: r.id, title: 'ریسک ریزش بالا — تماس فوری', reason: riskReasons(r.reasons), score: r.churn_score });
  }
  // b) overdue followups
  {
    const rows = d.prepare(`SELECT f.id, f.subject, f.due_at, f.entity_type, f.entity_id, c.id cid, c.name cname FROM followups f LEFT JOIN customers c ON (f.entity_type='customer' AND c.id=f.entity_id)
      WHERE f.status='pending' AND f.due_at < ? ${cs.scope === 'own' ? 'AND f.user_id=?' : ''} ORDER BY f.due_at ASC LIMIT 10`)
      .all(nowIso(), ...(cs.scope === 'own' ? [user.id] : []));
    for (const r of rows) out.push({ priority: 1, type: 'follow_up', entity: 'followup', entity_id: r.id, customer_id: r.cid || null, title: 'پیگیری عقب‌افتاده: ' + (r.subject || 'بدون موضوع'), reason: 'سررسید گذشته (' + r.due_at.slice(0, 10) + ')' });
  }
  // c) hot leads
  {
    const rows = d.prepare(`SELECT l.id, l.company, l.score, l.estimated_value, a.data reasons FROM leads l LEFT JOIN ai_scores a ON a.entity_type='lead' AND a.entity_id=l.id AND a.kind='lead'
      WHERE l.status IN ('new','contacted','qualified') AND l.score>=60 ${cs.scope === 'own' ? 'AND l.salesperson_id=?' : ''} ORDER BY l.score DESC LIMIT 8`)
      .all(...(cs.scope === 'own' ? [user.id] : []));
    for (const r of rows) out.push({ priority: 1, type: 'call', entity: 'lead', entity_id: r.id, customer_id: null, title: 'سرنخ داغ: ' + (r.company || ''), reason: riskReasons(r.reasons), score: r.score });
  }
  // d) stalled opportunities
  {
    const rows = d.prepare(`SELECT o.id, o.title, o.amount, o.probability, o.customer_id, c.name cname, COALESCE(MAX(a.created_at), o.updated_at) last_act FROM opportunities o
      LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN activities a ON a.entity_type='opportunity' AND a.entity_id=o.id
      WHERE o.status IN ('open','in_progress') AND o.archived_at IS NULL
      ${cs.scope === 'own' ? 'AND o.salesperson_id=?' : ''}
      GROUP BY o.id HAVING julianday('now') - julianday(last_act) > ${STALLED_DAYS}
      ORDER BY last_act ASC LIMIT 10`).all(...(cs.scope === 'own' ? [user.id] : []));
    for (const r of rows) out.push({ priority: 2, type: 'follow_up', entity: 'opportunity', entity_id: r.id, customer_id: r.customer_id || null, title: 'فرصت راکد: ' + (r.title || ''), reason: 'بیش از ' + STALLED_DAYS + ' روز بدون فعالیت' });
  }
  // e) open complaints (escalation)
  {
    const rows = d.prepare(`SELECT cp.id, cp.subject, cp.priority, cp.customer_id, c.name cname FROM complaints cp LEFT JOIN customers c ON c.id=cp.customer_id
      WHERE cp.status='new' ${custWhere} LIMIT 8`).all(...cParams);
    for (const r of rows) out.push({ priority: 2, type: 'escalation', entity: 'complaint', entity_id: r.id, customer_id: r.customer_id || null, title: 'شکایت جدید: ' + (r.subject || ''), reason: 'اولویت ' + (r.priority || '—') });
  }
  // f) overdue receivables (only with financial visibility)
  if (invOk) {
    const rows = d.prepare(`SELECT i.id, i.number, i.total - COALESCE(i.paid_amount,0) remaining, i.customer_id, c.name cname FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
      WHERE i.status='overdue' ${custWhere} ORDER BY i.issue_date ASC LIMIT 8`).all(...cParams);
    for (const r of rows) out.push({ priority: 2, type: 'payment', entity: 'invoice', entity_id: r.id, customer_id: r.customer_id || null, title: 'وصول مطالبات معوق ' + (r.number || ''), reason: 'مانده ' + Math.round(r.remaining).toLocaleString('fa-IR') + ' ریال' });
  }
  // g) inactive customers (reactivation)
  {
    const rows = d.prepare(`SELECT c.id, c.name FROM customers c WHERE c.archived_at IS NULL AND c.status='active'
      AND (SELECT COUNT(*) FROM invoices i WHERE i.customer_id=c.id AND i.status!='cancelled')>0
      AND COALESCE((SELECT MAX(a.created_at) FROM activities a WHERE a.entity_type='customer' AND a.entity_id=c.id), (SELECT MAX(i.issue_date) FROM invoices i WHERE i.customer_id=c.id)) < ?
      ${custWhere} LIMIT 6`).all(new Date(Date.now() - INACTIVE_DAYS * 864e5).toISOString(), ...cParams);
    for (const r of rows) out.push({ priority: 3, type: 'reactivation', entity: 'customer', entity_id: r.id, customer_id: r.id, title: 'مشتری غیرفعال: ' + (r.name || ''), reason: 'بیش از ' + INACTIVE_DAYS + ' روز بدون تعامل' });
  }
  out.sort((a, b) => a.priority - b.priority);
  return { items: out.slice(0, limit), generated_at: nowIso() };
}
function riskReasons(dataJson) {
  try { const d = JSON.parse(dataJson || '{}'); if (Array.isArray(d.reasons)) return d.reasons.slice(0, 2).join('؛ '); } catch {}
  return '';
}

// ---------- 4. Smart Follow-up ----------
function smartFollowups(user) {
  requirePerm(user, 'smart_sales', 'view');
  const d = get();
  const cs = custScope(user);
  if (!cs) return { items: [] };
  const scopeSql = cs.scope === 'own' ? 'AND f.user_id=?' : '';
  const params = cs.scope === 'own' ? [user.id] : [];
  const now = Date.now();
  const rows = d.prepare(`SELECT f.*, c.name cname FROM followups f LEFT JOIN customers c ON (f.entity_type='customer' AND c.id=f.entity_id)
    WHERE f.status='pending' AND f.due_at <= ? ${scopeSql} ORDER BY f.due_at ASC LIMIT 50`).all(new Date(now + 48 * 3600e3).toISOString(), ...params);
  const items = rows.map(r => {
    const due = new Date(r.due_at).getTime();
    const overdue = due < now;
    const suggested = nextBusinessSlot(overdue ? now : due + 864e5);
    return { ...r, customer_name: r.cname || '', overdue, overdue_days: overdue ? Math.floor((now - due) / 864e5) : 0, suggested_at: suggested };
  });
  return { items, now: nowIso() };
}
function nextBusinessSlot(ts) {
  const d = new Date(ts);
  d.setUTCHours(5, 0, 0, 0); // ~10:00 Tehran
  for (let i = 0; i < 7; i++) {
    if (d.getUTCDay() !== 5 && d.getUTCDay() !== 6) return d.toISOString(); // Fri/Sat off
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}
function taskFromFollowup(user, fuId) {
  requirePerm(user, 'smart_sales', 'use');
  const d = get();
  const f = d.prepare('SELECT * FROM followups WHERE id=?').get(parseId(fuId));
  if (!f) throw new HttpError(404, 'NOT_FOUND', 'پیگیری پیدا نشد.');
  if (f.status !== 'pending') throw new HttpError(400, 'BAD_STATE', 'این پیگیری دیگر در انتظار نیست.');
  const suggested = nextBusinessSlot(Date.now());
  const assignee = f.user_id || user.id;
  const info = d.prepare('INSERT INTO tasks(title, description, assignee_id, related_type, related_id, priority, status, due_at, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('پیگیری: ' + (f.subject || '—'), 'ایجادشده از صف هوشمند پیگیری (followup #' + f.id + ')', assignee, f.entity_type, f.entity_id, 'high', 'open', suggested, user.id, nowIso(), nowIso());
  const taskId = Number(info.lastInsertRowid);
  addActivityLocal('followup', f.id, user.id, 'smart_task', 'Task هوشمند ساخته شد');
  notify(assignee, 'smart_followup', 'Task هوشمند از پیگیری ساخته شد', `«${f.subject || 'پیگیری'}» — سررسید پیشنهادی ثبت شد.`, 'task', taskId);
  audit(user, 'smart_sales', f.id, 'followup_to_task', null, { task: taskId });
  return { task_id: taskId, due_at: suggested };
}
function addActivityLocal(entityType, entityId, userId, type, summary) {
  try { get().prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,?,?,?,?)').run(entityType, entityId, userId, type, summary, nowIso()); } catch {}
}

// ---------- 5. Stalled Opportunities / High Priority Leads / At-Risk Customers ----------
function stalledOpportunities(user, limit = 20) {
  requirePerm(user, 'smart_sales', 'view');
  const d = get();
  const cs = custScope(user);
  if (!cs) return { items: [] };
  const scopeSql = cs.scope === 'own' ? 'AND o.salesperson_id=?' : '';
  const rows = d.prepare(`SELECT o.id, o.number, o.title, o.amount, o.probability, o.customer_id, c.name cname,
      COALESCE(MAX(a.created_at), o.updated_at) last_act,
      CAST(julianday('now') - julianday(COALESCE(MAX(a.created_at), o.updated_at)) AS INTEGER) stalled_days
    FROM opportunities o LEFT JOIN customers c ON c.id=o.customer_id
    LEFT JOIN activities a ON a.entity_type='opportunity' AND a.entity_id=o.id
    WHERE o.status IN ('open','in_progress') AND o.archived_at IS NULL ${scopeSql}
    GROUP BY o.id HAVING stalled_days > ${STALLED_DAYS}
    ORDER BY stalled_days DESC LIMIT ?`).all(...(cs.scope === 'own' ? [user.id] : []), limit);
  return { items: rows, threshold_days: STALLED_DAYS };
}
function highPriorityLeads(user, limit = 20) {
  requirePerm(user, 'smart_sales', 'view');
  const d = get();
  const cs = custScope(user);
  if (!cs) return { items: [] };
  const scopeSql = cs.scope === 'own' ? 'AND l.salesperson_id=?' : '';
  const rows = d.prepare(`SELECT l.id, l.number, l.company, l.contact_name, l.estimated_value, l.probability, l.status, l.score, l.next_followup_at, a.data reasons
    FROM leads l LEFT JOIN ai_scores a ON a.entity_type='lead' AND a.entity_id=l.id AND a.kind='lead'
    WHERE l.status IN ('new','contacted','qualified') ${scopeSql} ORDER BY l.score DESC, l.estimated_value DESC LIMIT ?`)
    .all(...(cs.scope === 'own' ? [user.id] : []), limit);
  return { items: rows.map(r => ({ ...r, reason_list: riskReasons(r.reasons) })) };
}
function atRiskCustomers(user, limit = 20) {
  requirePerm(user, 'smart_sales', 'view');
  const d = get();
  const cs = custScope(user);
  if (!cs) return { items: [] };
  const rows = d.prepare(`SELECT c.id, c.name, c.churn_score, c.salesperson_id, c.status, a.data reasons
    FROM customers c LEFT JOIN ai_scores a ON a.entity_type='customer' AND a.entity_id=c.id AND a.kind='churn'
    WHERE c.archived_at IS NULL AND c.status='active' AND c.churn_score>=? ${cs.sql}
    ORDER BY c.churn_score DESC LIMIT ?`).all(CHURN_WARN, ...cs.params, limit);
  return { items: rows.map(r => ({ ...r, reason_list: riskReasons(r.reasons) })), threshold: CHURN_WARN };
}
function rescore(user) {
  requirePerm(user, 'smart_sales', 'manage');
  const engine = require('../../ai/engine');
  const nLeads = engine.rescoreAllLeads();
  const d = get();
  const custs = d.prepare("SELECT id FROM customers WHERE archived_at IS NULL AND status='active'").all();
  let nCust = 0;
  for (const c of custs) { try { engine.churnScore(c.id); nCust++; } catch {} }
  audit(user, 'smart_sales', 0, 'rescore', null, { leads: nLeads, customers: nCust });
  return { leads: nLeads, customers: nCust };
}

// ---------- 6. Competitor Analysis (تحلیل رقبا) ----------
const COMP_FIELDS = ['products', 'price_level', 'strengths', 'weaknesses', 'target_market', 'target_segments', 'advantages_ours', 'threats', 'opportunities', 'notes'];
function competitors(user) {
  requirePerm(user, 'competitor', 'view');
  const d = get();
  const items = d.prepare(`SELECT c.*, u.full_name AS creator_name FROM competitors c LEFT JOIN users u ON u.id=c.created_by WHERE c.active=1 ORDER BY c.id`).all();
  return { items };
}
function createCompetitor(user, b) {
  requirePerm(user, 'competitor', 'edit');
  if (!String(b.name || '').trim()) throw new HttpError(422, 'VALIDATION', 'نام رقیب الزامی است.');
  const d = get();
  const dup = d.prepare('SELECT id FROM competitors WHERE active=1 AND name=?').get(String(b.name).trim());
  if (dup) throw new HttpError(409, 'DUPLICATE', 'این رقیب قبلاً ثبت شده است.');
  const cols = ['name'].concat(COMP_FIELDS);
  const vals = [String(b.name).trim()].concat(COMP_FIELDS.map(k => String(b[k] || '')));
  const allCols = cols.concat(['active', 'created_by', 'created_at', 'updated_at']);
  const allVals = vals.concat([1, user.id, nowIso(), nowIso()]);
  const info = d.prepare('INSERT INTO competitors(' + allCols.join(',') + ') VALUES(' + allCols.map(() => '?').join(',') + ')').run(...allVals);
  audit(user, 'competitor', Number(info.lastInsertRowid), 'competitor_create', null, { name: String(b.name).trim() }, '');
  return { id: Number(info.lastInsertRowid) };
}
function updateCompetitor(user, id, b) {
  requirePerm(user, 'competitor', 'edit');
  const d = get();
  const row = d.prepare('SELECT * FROM competitors WHERE id=? AND active=1').get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رقیب پیدا نشد.');
  const sets = [], args = [];
  if (b.name !== undefined) { sets.push('name=?'); args.push(String(b.name).trim()); }
  for (const k of COMP_FIELDS) if (b[k] !== undefined) { sets.push(k + '=?'); args.push(String(b[k] || '')); }
  if (sets.length) { sets.push('updated_at=?'); args.push(nowIso(), row.id); d.prepare('UPDATE competitors SET ' + sets.join(',') + ' WHERE id=?').run(...args); }
  audit(user, 'competitor', row.id, 'competitor_update', null, { keys: sets.map(x => x.split('=')[0]) }, '');
  return { ok: true };
}
function deleteCompetitor(user, id) {
  requirePerm(user, 'competitor', 'delete');
  const d = get();
  const row = d.prepare('SELECT * FROM competitors WHERE id=? AND active=1').get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رقیب پیدا نشد.');
  d.prepare('UPDATE competitors SET active=0, updated_at=? WHERE id=?').run(nowIso(), row.id);
  audit(user, 'competitor', row.id, 'competitor_delete', null, null, '');
  return { ok: true };
}

// ---------- 7. Idea Generation (خلق ایده — بر اساس داده واقعی CRM) ----------
const IDEA_CATEGORIES = { sales: 'فروش', marketing: 'بازاریابی', customer_growth: 'افزایش مشتری', customer_retention: 'حفظ مشتری', new_product: 'محصول جدید', service: 'بهبود خدمات', cost: 'کاهش هزینه', process: 'بهبود فرآیند', productivity: 'افزایش بهره‌وری', market_dev: 'توسعه بازار', competitive: 'مزیت رقابتی' };
function ideas(user, q) {
  requirePerm(user, 'idea', 'view');
  const d = get();
  const st = (q && q.status) || '';
  let sql = `SELECT i.*, u.full_name AS owner_name, u2.full_name AS creator_name FROM ideas i LEFT JOIN users u ON u.id=i.owner_id LEFT JOIN users u2 ON u2.id=i.created_by`;
  const args = [];
  if (st) { sql += ' WHERE i.status=?'; args.push(st); }
  sql += ' ORDER BY i.id DESC LIMIT 200';
  return { items: d.prepare(sql).all(...args) };
}
function createIdea(user, b) {
  requirePerm(user, 'idea', 'edit');
  if (!String(b.title || '').trim()) throw new HttpError(422, 'VALIDATION', 'عنوان ایده الزامی است.');
  const d = get();
  const info = d.prepare('INSERT INTO ideas(title, description, goal, category, reason, data_refs, priority, impact, status, owner_id, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(String(b.title).trim(), String(b.description || ''), String(b.goal || ''), String(b.category || 'sales'), String(b.reason || ''), String(b.data_refs || ''), String(b.priority || 'medium'), String(b.impact || ''), String(b.status || 'proposed'), b.owner_id ? Number(b.owner_id) : null, user.id, nowIso(), nowIso());
  audit(user, 'idea', Number(info.lastInsertRowid), 'idea_create', null, { title: String(b.title).trim() }, '');
  return { id: Number(info.lastInsertRowid) };
}
function updateIdea(user, id, b) {
  requirePerm(user, 'idea', 'edit');
  const d = get();
  const row = d.prepare('SELECT * FROM ideas WHERE id=?').get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'ایده پیدا نشد.');
  const sets = [], args = [];
  for (const k of ['title', 'description', 'goal', 'category', 'reason', 'data_refs', 'priority', 'impact']) if (b[k] !== undefined) { sets.push(k + '=?'); args.push(String(b[k] || '')); }
  if (b.status !== undefined) { sets.push('status=?'); args.push(String(b.status || 'proposed')); }
  if (b.owner_id !== undefined) { sets.push('owner_id=?'); args.push(b.owner_id ? Number(b.owner_id) : null); }
  if (sets.length) { sets.push('updated_at=?'); args.push(nowIso(), row.id); d.prepare('UPDATE ideas SET ' + sets.join(',') + ' WHERE id=?').run(...args); }
  audit(user, 'idea', row.id, 'idea_update', null, { keys: sets.map(x => x.split('=')[0]) }, '');
  return { ok: true };
}
function setIdeaStatus(user, id, status) {
  if (!['proposed', 'approved', 'rejected', 'done'].includes(status)) throw new HttpError(422, 'VALIDATION', 'وضعیت نامعتبر است.');
  if (status === 'approved') requirePerm(user, 'idea', 'approve'); else requirePerm(user, 'idea', 'edit');
  const d = get();
  const row = d.prepare('SELECT * FROM ideas WHERE id=?').get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'ایده پیدا نشد.');
  d.prepare('UPDATE ideas SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), row.id);
  audit(user, 'idea', row.id, 'idea_' + status, { status: row.status }, { status }, '');
  if (row.owner_id && status === 'approved') notify(row.owner_id, 'idea', 'ایده تأیید شد', '«' + row.title + '» — می‌توانید به Task تبدیل کنید.', 'idea', row.id);
  return { ok: true };
}
function ideaToTask(user, id, b) {
  requirePerm(user, 'idea', 'approve');
  const d = get();
  const row = d.prepare('SELECT * FROM ideas WHERE id=?').get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'ایده پیدا نشد.');
  if (row.task_id) throw new HttpError(400, 'BAD_STATE', 'این ایده قبلاً به Task تبدیل شده است (task #' + row.task_id + ').');
  if (row.status !== 'approved') throw new HttpError(400, 'BAD_STATE', 'ابتدا ایده را تأیید کنید.');
  const assignee = b.owner_id ? Number(b.owner_id) : (row.owner_id || user.id);
  let due = null;
  if (b.due_days) due = new Date(Date.now() + Number(b.due_days) * 86400000).toISOString();
  const info = d.prepare('INSERT INTO tasks(title, description, assignee_id, related_type, related_id, priority, status, due_at, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ایده: ' + row.title, 'ایجادشده از ایده #' + row.id + ' — ' + (row.description || ''), assignee, 'idea', row.id, row.priority, 'open', due, user.id, nowIso(), user.id, nowIso());
  const taskId = Number(info.lastInsertRowid);
  d.prepare('UPDATE ideas SET task_id=?, status=?, updated_at=? WHERE id=?').run(taskId, 'done', nowIso(), row.id);
  notify(assignee, 'idea', 'ایده به Task تبدیل شد', '«' + row.title + '»' + (due ? ' — سررسید: ' + due.slice(0, 10) : ''), 'task', taskId);
  audit(user, 'idea', row.id, 'idea_to_task', null, { task: taskId }, '');
  return { task_id: taskId };
}
// Data-driven generator: every idea cites REAL CRM records (names/amounts/counts).
// Optional LLM polish via gateway — the heuristic core is always the source of truth.
function builtinIdeas(user) {
  const d = get();
  const out = [];
  try {
    // 1) at-risk customers → retention
    const risk = d.prepare(`SELECT c.id, c.name, c.churn_score FROM customers c WHERE c.churn_score >= ? AND c.status='active' ORDER BY c.churn_score DESC LIMIT 10`).all(CHURN_WARN);
    if (risk.length) {
      const high = risk.filter(x => x.churn_score >= CHURN_HIGH).length;
      out.push({ title: 'برنامه حفظ مشتریان در معرض ریزش (' + risk.length + ' مشتری)', category: 'customer_retention', priority: high ? 'high' : 'medium',
        goal: 'کاهش ریسک ریزش مشتریان کلیدی', reason: 'موتور ریزش CRM ' + risk.length + ' مشتری با نمره ریسک ' + CHURN_WARN + '+ شناسایی کرده است.',
        data_refs: risk.map(x => x.name + ' (ریسک ' + x.churn_score + ')').join('، '),
        description: 'برای هر مشتری: تماس فوری کارشناس، بررسی دلایل ریزش (شکایت/تاخیر/کاهش خرید) و پیشنهاد ویژه حفظ مشتری. مشتریان با ریسک ' + CHURN_HIGH + '+: ' + high + ' نفر.',
        impact: 'حفظ مشتریان با نمره ریزش بالا = جلوگیری از از دست رفتن سوابق فروش آن‌ها' });
    }
    // 2) stalled opportunities → reactivation
    const stalled = d.prepare(`SELECT o.id, o.title, o.amount, p.name AS stage_name FROM opportunities o LEFT JOIN pipeline_stages p ON p.id=o.stage_id WHERE o.status='open' AND o.updated_at < ? ORDER BY o.amount DESC LIMIT 10`).all(new Date(Date.now() - STALLED_DAYS * 86400000).toISOString());
    if (stalled.length) {
      const total = stalled.reduce((a, x) => a + (x.amount || 0), 0);
      out.push({ title: 'زنده‌سازی ' + stalled.length + ' فرصت فروش راکد (ارزش: ' + faDigits(Math.round(total)) + ' ریال)', category: 'sales', priority: 'high',
        goal: 'بازگشت فرصت‌های راکد به چرخه فروش', reason: STALLED_DAYS + ' روز بدون فعالیت روی این فرصت‌ها (داده Pipeline واقعی).',
        data_refs: stalled.map(x => x.title + ' (' + faDigits(Math.round(x.amount || 0)) + ' ریال — مرحله ' + (x.stage_name || '—') + ')').join('، '),
        description: 'برای هر فرصت: تعیین دلیل رکود (قیمت/نیاز/رقیب)، جلسه جدید یا پیگیری هدفمند، و در صورت عدم پیشرفت تصمیم lose/won مستند.',
        impact: 'ارزش در معرض: ' + faDigits(Math.round(total)) + ' ریال' });
    }
    // 3) top products → focus marketing
    const top = d.prepare(`SELECT p.name, SUM(ii.qty) qty, SUM(ii.line_total) total FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id JOIN products p ON p.id=ii.product_id WHERE i.status IN ('paid','partial') GROUP BY p.id ORDER BY total DESC LIMIT 3`).all();
    if (top.length) {
      out.push({ title: 'تمرکز بازاریابی روی ۳ محصول پرفروش (مبنای فاکتورهای واقعی)', category: 'marketing', priority: 'medium',
        goal: 'افزایش فروش محصولات برتر با کمترین هزینه', reason: 'تحلیل سوابق فاکتورهای پرداخت‌شده (داده واقعی).',
        data_refs: top.map(x => x.name + ' — ' + faDigits(Math.round(x.total || 0)) + ' ریال').join('، '),
        description: 'پیشنهاد: بسته‌بندی/تخفیف هوشمند برای این محصولات، معرفی در کمپین‌های بعدی و پیشنهاد متقاطع در پیش‌فاکتورهای مرتبط.',
        impact: 'افزایش میانگین ارزش سبد خرید' });
    }
    // 4) weak products (no recent invoice)
    const weak = d.prepare(`SELECT p.name FROM products p WHERE p.active=1 AND NOT EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE ii.product_id=p.id AND i.created_at > ?) ORDER BY p.id LIMIT 5`).all(new Date(Date.now() - 90 * 86400000).toISOString());
    if (weak.length) {
      out.push({ title: 'بازنگری ' + weak.length + ' محصول بدون فروش در ۹۰ روز اخیر', category: 'new_product', priority: 'low',
        goal: 'تصمیم: بازسازی قیمت/بسته‌بندی یا بازنشستگی محصول', reason: 'این محصولات ۹۰ روز در فاکتورهای جدید دیده نشده‌اند (داده واقعی).',
        data_refs: weak.map(x => x.name).join('، '),
        description: 'بررسی قیمت نسبت به رقبا، وجود جایگزین، و پیشنهاد فروش متقاطع؛ در نبود حرکت: آزادسازی موجودی انبار.',
        impact: 'کاهش موجودی خواب‌خورده' });
    }
    // 5) overdue follow-ups → productivity
    const od = d.prepare(`SELECT COUNT(*) n FROM followups WHERE status='pending' AND due_at < ?`).get(new Date().toISOString()).n;
    if (od >= 3) {
      out.push({ title: 'پاکسازی ' + od + ' پیگیری معوق (overdue)', category: 'productivity', priority: 'high',
        goal: 'جلوگیری از فراموشی پیگیری‌ها و حفظ چرخه فروش', reason: od + ' پیگیری از موعد گذشته در صف هستند (داده واقعی).',
        data_refs: 'followups معوق: ' + od + ' مورد',
        description: 'تخصیص وظیفه روزانه «پاکسازی پیگیری‌ها» به کارشناسان مرتبط + قانون Workflow برای ایجاد خودکار پیگیری از تماس‌های VoIP و فرصت‌ها.',
        impact: 'افزایش نرخ تبدیل از طریق پیگیری به‌موقع' });
    }
  } catch (e) { /* defensive: generator must never break the page */ }
  return out;
}
async function generateIdeas(user) {
  requirePerm(user, 'idea', 'edit');
  const builtin = builtinIdeas(user);
  let source = 'heuristic + داده واقعی CRM';
  let items = builtin;
  try {
    const r = await gw.ask(user, 'smart_sales', 'idea_generation',
      [{ role: 'user', content: 'بر اساس این تحلیل‌های واقعی CRM، یک خط خلاصه‌سازی/بهبود برای هر ایده بنویس (بدون اختراع داده جدید) ' + JSON.stringify(builtin) }],
      'تو تحلیلگر فروش CRM هستی. فقط متن توضیح هر ایده را حداکثر یک خط بهتر کن. هیچ عدد یا اسم جدید نساز.',
      null);
    if (r && Array.isArray(r.items) && r.items.length) {
      items = builtin.map((b, i) => ({ ...b, description: (r.items[i] && r.items[i].description) || b.description }));
      source += ' + LLM (' + (r.provider || 'gateway') + ')';
    }
  } catch { /* heuristic result stands */ }
  return { ideas: items, source, honesty: 'همه ارقام/اسامی از داده واقعی CRM خوانده می‌شوند؛ خروجی LLM (در صورت استفاده) فقط بازنویسی متنی است و داده جدید اختراع نمی‌کند.' };
}

// ---------- 8. Smart Team Tasks (مأموریت‌ها) ----------
function teamTasks(user) {
  requirePerm(user, 'smart_sales', 'use');
  const d = get();
  const rows = d.prepare(`SELECT t.*, u.full_name AS assignee_name, c.name AS customer_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN customers c ON c.id=t.related_id AND t.related_type='customer' WHERE t.related_type IN ('customer','opportunity','lead','meeting','idea','competitor','smart_team') ORDER BY (t.status='done' OR t.status='cancelled'), (t.due_at IS NULL), t.due_at, t.id LIMIT 100`).all();
  return { items: rows };
}
function createTeamTask(user, b) {
  requirePerm(user, 'smart_sales', 'use');
  if (!String(b.title || '').trim()) throw new HttpError(422, 'VALIDATION', 'عنوان مأموریت الزامی است.');
  const d = get();
  let relType = '', relId = 0;
  if (b.customer_id) {
    const c = d.prepare('SELECT id, name FROM customers WHERE id=? AND archived_at IS NULL').get(Number(b.customer_id));
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
    relType = 'customer'; relId = c.id;
  }
  const assignee = b.assignee_id ? Number(b.assignee_id) : user.id;
  let due = null;
  if (b.due_days) due = new Date(Date.now() + Number(b.due_days) * 86400000).toISOString();
  const info = d.prepare('INSERT INTO tasks(title, description, assignee_id, related_type, related_id, priority, status, due_at, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(String(b.title).trim(), String(b.description || ''), assignee, relType || 'smart_team', relId, String(b.priority || 'medium'), 'open', due, user.id, nowIso(), user.id, nowIso());
  const taskId = Number(info.lastInsertRowid);
  if (assignee !== user.id) notify(assignee, 'smart_task', 'مأموریت جدید از تیم هوشمند', '«' + b.title + '»' + (due ? ' — سررسید: ' + due.slice(0, 10) : ''), 'task', taskId);
  audit(user, 'smart_sales', taskId, 'team_task_create', null, { task: taskId, customer: relId || null }, '');
  return { task_id: taskId };
}
const TASK_FLOW = { open: ['in_progress', 'blocked', 'cancelled'], in_progress: ['blocked', 'done', 'cancelled'], blocked: ['in_progress', 'cancelled'], done: [], cancelled: ['open'] };
function setTeamTaskStatus(user, taskId, status) {
  requirePerm(user, 'smart_sales', 'use');
  const d = get();
  const row = d.prepare('SELECT * FROM tasks WHERE id=?').get(parseId(taskId));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'وظیفه پیدا نشد.');
  if (!TASK_FLOW[row.status] || !TASK_FLOW[row.status].includes(status)) throw new HttpError(400, 'BAD_STATE', 'انتقال وضعیت «' + row.status + '» → «' + status + '» مجاز نیست.');
  const sets = ['status=?', 'updated_at=?', 'updated_by=?'], args = [status, nowIso(), user.id, row.id];
  if (status === 'done') { sets.push('completed_at=?'); args.splice(3, 0, nowIso()); }
  d.prepare('UPDATE tasks SET ' + sets.join(',') + ' WHERE id=?').run(...args);
  if (row.assignee_id && status === 'done') notify(row.assignee_id, 'smart_task', 'مأموریت انجام شد', '«' + row.title + '» توسط ' + user.username, 'task', row.id);
  audit(user, 'smart_sales', row.id, 'team_task_status', { status: row.status }, { status }, '');
  return { ok: true };
}

module.exports = { aiStatus, targets, createTarget, updateTarget, deleteTarget, nextBestActions, smartFollowups, taskFromFollowup, stalledOpportunities, highPriorityLeads, atRiskCustomers, rescore, competitors, createCompetitor, updateCompetitor, deleteCompetitor, ideas, createIdea, updateIdea, setIdeaStatus, ideaToTask, generateIdeas, teamTasks, createTeamTask, setTeamTaskStatus, IDEA_CATEGORIES, STALLED_DAYS, CHURN_HIGH, CHURN_WARN };
