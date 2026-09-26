'use strict';
// ============================================================================
// Workflow Visual Engine — the CRM's canonical workflow execution engine.
// Database-backed, event-driven, REAL CRM operations (no mocks, no fakes).
//
// Node types (canvas):
//   start/trigger, action, assignment, condition, approval, signature,
//   notification, message, email, delay, schedule, wait, parallel, merge,
//   create_record, update_record, task (legacy step node), end
//
// Execution model:
//   - A process (wf_processes) + its published version (wf_versions active=1)
//     defines the graph. A real CRM EVENT (e.g. customer_created) or a manual
//     start creates an EXECUTION (wf_instances row, execution_no WF-YYYY-NNNNNN).
//   - advance() walks the graph through auto-nodes (condition/action/delay/...)
//     and pauses at step-nodes (approval/signature/task) — creating a
//     wf_steps row + notification for the real responsible user.
//   - Delays/schedules pause via wf_schedules; the 60s scheduler resumes them.
//   - Every transition is logged in wf_logs (monitor + audit trail).
//   - Actions execute REAL CRM services as the execution's actor. Permissions
//     are enforced by the underlying services — a workflow can never do what
//     its actor is not allowed to do.
//   - Server restart: resumeInterrupted() continues executions left 'running'
//     on an auto-node.
// ============================================================================
const { get, getSetting } = require('../db/db');
const { nowIso, toEnDigits } = require('../lib/util');
const { notify, notifyRoles, notifyDepartment, notifyAll } = require('./notify');
const { audit } = require('./audit');
const { HttpError } = require('../lib/http');

const db = () => get();
const safeParse = (s, dft) => { try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : (dft !== undefined ? dft : null); } catch { return dft !== undefined ? dft : null; } };
const findNode = (def, id) => (def.nodes || []).find(n => n.id === id) || null;
const outEdges = (def, id, label) => (def.edges || []).filter(e => e.from === id && (label === undefined ? true : (e.label || '') === label));
const forwardEdge = (def, id) => outEdges(def, id, '')[0] || outEdges(def, id).find(e => !e.label) || outEdges(def, id)[0] || null;

// ---------------------------------------------------------------------------
// Registries — single source of truth for the canvas meta + engine behavior
// ---------------------------------------------------------------------------
const NODE_META = {
  start:         { fa: 'شروع / Trigger',        color: '#2a9d8f', ic: '▶',  auto: true,  step: false },
  trigger:       { fa: 'شروع / Trigger',        color: '#2a9d8f', ic: '▶',  auto: true,  step: false },
  action:        { fa: 'Action (عملیات)',       color: '#2a9d8f', ic: '✓',  auto: true,  step: false },
  assignment:    { fa: 'Assignment (اختصاص)',   color: '#3b82f6', ic: '⇄',  auto: true,  step: false },
  condition:     { fa: 'Condition (شرط)',        color: '#7c5cd6', ic: '◆',  auto: true,  step: false },
  approval:      { fa: 'Approval (تأیید)',       color: '#c9a227', ic: '★',  auto: false, step: true },
  signature:     { fa: 'Signature (امضا)',       color: '#b45309', ic: '✍',  auto: false, step: true },
  task:          { fa: 'Task / ایستگاه کاری',   color: '#0ea5e9', ic: '☑',  auto: false, step: true },
  notification:  { fa: 'Notification (اعلان)',  color: '#10b981', ic: '🔔', auto: true,  step: false },
  message:       { fa: 'Message (پیام)',         color: '#059669', ic: '✉',  auto: true,  step: false },
  email:         { fa: 'Email (ایمیل)',          color: '#0284c7', ic: '@',  auto: true,  step: false },
  delay:         { fa: 'Delay (تأخیر)',          color: '#f59e0b', ic: '⏱',  auto: true,  step: false },
  schedule:      { fa: 'Schedule (زمان‌بندی)',   color: '#d97706', ic: '📅', auto: true,  step: false },
  wait:          { fa: 'Wait (انتظار رویداد)',  color: '#64748b', ic: '…',  auto: true,  step: false },
  parallel:      { fa: 'Parallel (موازی)',       color: '#c9620a', ic: '⫽',  auto: true,  step: false },
  merge:         { fa: 'Merge (ادغام)',          color: '#a16207', ic: '⊕',  auto: true,  step: false },
  create_record: { fa: 'Create Record',          color: '#16a34a', ic: '+',  auto: true,  step: false },
  update_record: { fa: 'Update Record',          color: '#65a30d', ic: '±',  auto: true,  step: false },
  end:           { fa: 'End (پایان)',            color: '#c0392b', ic: '■',  auto: true,  step: false },
};
const NODE_TYPES = Object.keys(NODE_META);
const EDGE_LABELS = ['', 'true', 'false', 'approve', 'reject', 'return', 'loop', 'branch'];
const CONDITION_OPS = [
  ['eq', '=', 'مساوی'], ['neq', '!=', 'نامساوی'],
  ['gt', '>', 'بزرگ‌تر'], ['lt', '<', 'کوچک‌تر'], ['gte', '>=', 'بزرگ‌تر یا مساوی'], ['lte', '<=', 'کوچک‌تر یا مساوی'],
  ['contains', 'contains', 'شامل شود'], ['not_contains', 'not_contains', 'شامل نشود'],
  ['is_empty', 'is_empty', 'خالی'], ['is_not_empty', 'is_not_empty', 'خالی نباشد'],
  ['in', 'in', 'در لیست'], ['not_in', 'not_in', 'در لیست نباشد'],
];
const TRIGGERS = [
  ['created', 'ایجاد رکورد (Created)'], ['updated', 'به‌روزرسانی رکورد (Updated)'], ['deleted', 'حذف رکورد (Deleted)'],
  ['stage_changed', 'تغییر مرحله Opportunity/Pipeline'], ['status_changed', 'تغییر وضعیت'],
  ['approved', 'تأیید شد (زنجیرهٔ تأیید)'], ['rejected', 'رد شد (زنجیرهٔ تأیید)'],
  ['overdue', 'سررسید گذشته (Invoice Overdue)'], ['won', 'Opportunity بسته شد (Won)'],
  ['manual', 'دستی (از Monitor)'],
];
const ASSIGNEE_TYPES = [
  ['user', 'کاربر مشخص'], ['role', 'نقش'], ['department', 'واحد / بخش'], ['dynamic', 'Dynamic (از دادهٔ رکورد)'],
];
const CHANNELS = ['sms', 'whatsapp', 'telegram', 'email'];

// ---------------------------------------------------------------------------
// Variables — ctx roots: { [module]: entityRow, wf: {...}, user: {...}, data }
// ---------------------------------------------------------------------------
function ctxRoots(instance) {
  const ctx = safeParse(instance.context, {}) || {};
  ctx.wf = {
    execution_id: instance.id, execution_no: instance.execution_no || '', process_id: instance.process_id,
    version: instance.version, module: instance.module, entity_id: instance.entity_id,
    title: instance.title, status: instance.status, started_at: instance.started_at,
  };
  ctx.data = safeParse(instance.data, {}) || {};
  return ctx;
}
function rootValue(ctx, rootName) {
  if (rootName === 'wf') return ctx.wf || {};
  if (rootName === 'user') return ctx.user || {};
  if (rootName === 'data') return ctx.data || {};
  return ctx[rootName] || {};
}
const FIELD_RE = /^[a-z_][a-z0-9_]*\.[a-z0-9_.]+$/i;
function fieldOf(ctx, field) {
  if (!field) return undefined;
  const f = String(field).trim();
  const dot = f.indexOf('.');
  if (dot > 0) {
    const obj = rootValue(ctx, f.slice(0, dot));
    if (!obj) return undefined;
    return obj[f.slice(dot + 1)];
  }
  const mod = ctx.wf && ctx.wf.module;
  if (ctx[mod] && ctx[mod][f] !== undefined) return ctx[mod][f];
  if (ctx.data && ctx.data[f] !== undefined) return ctx.data[f];
  if (ctx.wf && ctx.wf[f] !== undefined) return ctx.wf[f];
  if (ctx.user && ctx.user[f] !== undefined) return ctx.user[f];
  return undefined;
}
function resolveValue(v, ctx) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'string') return v;
  if (v.includes('{{')) {
    return v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, f) => {
      const val = fieldOf(ctx, f);
      return val === undefined || val === null ? '' : String(val);
    });
  }
  if (FIELD_RE.test(v)) {
    const val = fieldOf(ctx, v);
    if (val !== undefined) return val;
  }
  return v;
}
function resolveValues(obj, ctx) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return resolveValue(obj, ctx);
  if (Array.isArray(obj)) return obj.map(x => resolveValues(x, ctx));
  if (typeof obj === 'object') { const o = {}; for (const k of Object.keys(obj)) o[k] = resolveValues(obj[k], ctx); return o; }
  return obj;
}
// refresh the entity snapshot from the DB — conditions/actions read REAL data
// Load the related customer row into ctx.customer for non-customer modules
// (invoice/order/quote/complaint/lab_request all carry customer_id) — so
// {{customer.name}} / {{customer.phone}} resolve everywhere.
function loadRelatedCustomer(d, module, row) {
  if (!row) return null;
  if (module === 'customer') return row;
  const cid = row.customer_id;
  if (!cid) return null;
  try { return d.prepare('SELECT * FROM customers WHERE id=?').get(Number(cid)) || null; } catch { return null; }
}
function refreshContext(instId) {
  const d = db();
  const inst = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
  if (!inst) return null;
  const { R } = require('../api/resources');
  const spec = R[inst.module];
  const ctx = safeParse(inst.context, {}) || {};
  let row = null;
  try { if (spec) row = d.prepare(`SELECT * FROM ${spec.table} WHERE id=?`).get(inst.entity_id) || null; } catch {}
  if (row) { ctx[inst.module] = row; const c = loadRelatedCustomer(d, inst.module, row); if (c) ctx.customer = c; }
  if (inst.started_by) { const u = d.prepare('SELECT id, username, full_name, department FROM users WHERE id=?').get(inst.started_by); if (u) ctx.user = u; }
  d.prepare('UPDATE wf_instances SET context=? WHERE id=?').run(JSON.stringify(ctx), instId);
  return ctx;
}

// ---------------------------------------------------------------------------
// Condition engine — groups with AND / OR / NOT
// group = { logic:'AND'|'OR', not?:bool, conditions:[leaf|group] }
// legacy single condition { field, op, value } = one-leaf AND group
// ---------------------------------------------------------------------------
function evalLeaf(leaf, ctx) {
  const v = fieldOf(ctx, leaf.field);
  const target = resolveValue(leaf.value, ctx);
  switch (leaf.op) {
    case 'neq': return String(v ?? '') !== String(target ?? '');
    case 'gt': return Number(v) > Number(target);
    case 'gte': return Number(v) >= Number(target);
    case 'lt': return Number(v) < Number(target);
    case 'lte': return Number(v) <= Number(target);
    case 'contains': return String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
    case 'not_contains': return !String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
    case 'is_empty': return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
    case 'is_not_empty': return !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
    case 'in': return String(target ?? '').split(',').map(x => x.trim()).filter(Boolean).includes(String(v ?? ''));
    case 'not_in': return !String(target ?? '').split(',').map(x => x.trim()).filter(Boolean).includes(String(v ?? ''));
    case 'eq':
    default: return String(v ?? '') === String(target ?? '');
  }
}
function normGroup(c) {
  if (!c) return { logic: 'AND', conditions: [] };
  if (c.conditions) return { logic: c.logic === 'OR' ? 'OR' : 'AND', not: !!c.not, conditions: Array.isArray(c.conditions) ? c.conditions : [] };
  return { logic: 'AND', conditions: [c] };
}
function evalGroup(c, ctx) {
  if (!c) return true;
  if (!c.conditions) return evalLeaf(c, ctx); // leaf (legacy single condition or {field,op,value})
  const g = normGroup(c);
  let r;
  if (g.logic === 'OR') r = g.conditions.length ? g.conditions.some(x => evalGroup(x, ctx)) : true;
  else r = g.conditions.length ? g.conditions.every(x => evalGroup(x, ctx)) : true;
  return g.not ? !r : r;
}

// ---------------------------------------------------------------------------
// Assignees (user / role / department / dynamic) + step RBAC
// ---------------------------------------------------------------------------
function isSuper(uid) {
  return !!db().prepare("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.name='super_admin'").get(uid);
}
function userRoles(uid) {
  return db().prepare("SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?").all(uid).map(x => x.name);
}
function resolveAssignee(node, ctx) {
  const d = db();
  const t = node.assignee_type || 'none';
  const raw = resolveValue(node.assignee || '', ctx);
  if (t === 'user' && raw) return { user_id: Number(toEnDigits(raw)) || null, kind: 'user', label: 'کاربر', role: null, department: '' };
  if (t === 'role' && raw) {
    const uid = d.prepare('SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name=? AND u.active=1 ORDER BY u.id LIMIT 1').get(String(raw));
    return { user_id: uid ? uid.id : null, kind: 'role', label: 'نقش: ' + raw, role: String(raw), department: '' };
  }
  if (t === 'department' && raw) return { user_id: null, kind: 'department', label: 'واحد: ' + raw, role: null, department: String(raw) };
  if (t === 'dynamic' && raw) {
    const val = resolveValue(raw, ctx);
    return { user_id: Number(toEnDigits(val)) || null, kind: 'dynamic', label: 'Dynamic: ' + raw, role: null, department: '' };
  }
  return { user_id: null, kind: 'none', label: '—', role: null, department: '' };
}
function canCompleteStep(user, step, node, instance) {
  if (isSuper(user.id)) return true;
  if (step.assignee_id && Number(step.assignee_id) === Number(user.id)) return true;
  const ctx = ctxRoots(instance);
  const a = resolveAssignee(node, ctx);
  if (a.kind === 'role' && a.role && userRoles(user.id).includes(a.role)) return true;
  if (a.kind === 'department' && a.department && user.department && String(user.department) === String(a.department)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Execution log + execution numbers
// ---------------------------------------------------------------------------
function log(instId, level, message, data, nodeId, stepId) {
  try {
    db().prepare('INSERT INTO wf_logs(execution_id, node_id, step_id, level, message, data, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(instId, nodeId || '', stepId || null, level, String(message).slice(0, 500), JSON.stringify(data || {}), nowIso());
  } catch (e) { console.error('[wf-log]', e.message); }
}
function nextExecutionNo() {
  const year = new Date().getFullYear();
  const r = db().prepare('SELECT COUNT(*) c FROM wf_instances WHERE execution_no LIKE ?').get('WF-' + year + '-%');
  return 'WF-' + year + '-' + String(r.c + 1).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Actions — REAL CRM operations executed as the execution's actor
// ---------------------------------------------------------------------------
const ACTIONS = {
  'record.create': {
    fa: 'ایجاد رکورد (Create Record)',
    params: [{ key: 'module', type: 'module', required: true }, { key: 'values', type: 'kv', required: true }],
    run(ctx, node, actor, instance) {
      const { R } = require('../api/resources');
      const generic = require('../api/generic');
      const m = resolveValue(node.params.module, ctx);
      const spec = R[m]; if (!spec) throw new Error('ماژول نامعتبر: ' + m);
      const values = resolveValues(node.params.values || {}, ctx);
      const id = generic.create(spec, actor, values);
      ctx.created_id = id;
      return { ok: true, result: { created: m, id } };
    },
  },
  'record.update': {
    fa: 'به‌روزرسانی رکورد (Update Record)',
    params: [{ key: 'module', type: 'module', required: true }, { key: 'id', type: 'text', required: false }, { key: 'values', type: 'kv', required: true }],
    run(ctx, node, actor, instance) {
      const generic = require('../api/generic');
      const { R } = require('../api/resources');
      const m = resolveValue(node.params.module, ctx);
      const spec = R[m]; if (!spec) throw new Error('ماژول نامعتبر: ' + m);
      let id = resolveValue(node.params.id || '', ctx);
      if (!id || String(id) === '') id = instance.entity_id;
      id = Number(toEnDigits(id));
      generic.update(spec, actor, id, resolveValues(node.params.values || {}, ctx));
      return { ok: true, result: { updated: m, id } };
    },
  },
  'record.set_status': {
    fa: 'تغییر وضعیت رکورد (Change Status)',
    params: [{ key: 'module', type: 'module', required: true }, { key: 'status', type: 'text', required: true }],
    run(ctx, node, actor, instance) {
      const generic = require('../api/generic');
      const { R } = require('../api/resources');
      const m = node.params.module ? resolveValue(node.params.module, ctx) : instance.module;
      const spec = R[m]; if (!spec) throw new Error('ماژول نامعتبر: ' + m);
      generic.update(spec, actor, instance.entity_id, { status: resolveValue(node.params.status, ctx) });
      return { ok: true, result: { status: String(node.params.status), id: instance.entity_id } };
    },
  },
  'record.assign': {
    fa: 'اختصاص مسئول (Assign User/Role)',
    params: [{ key: 'field', type: 'text', required: true }, { key: 'user', type: 'text', required: true }],
    run(ctx, node, actor, instance) {
      const generic = require('../api/generic');
      const { R } = require('../api/resources');
      const m = node.params.module ? resolveValue(node.params.module, ctx) : instance.module;
      const spec = R[m]; if (!spec) throw new Error('ماژول نامعتبر: ' + m);
      const field = String(node.params.field || '').slice(0, 60);
      if (!/^[a-z_][a-z0-9_]*$/i.test(field)) throw new Error('فیلد نامعتبر: ' + field);
      const d = db();
      const raw = String(resolveValue(node.params.user, ctx) || '').trim();
      let uid = Number(toEnDigits(raw));
      let via = 'id';
      if (!uid) {
        // role name → first active user holding that role (dynamic assignment from DB)
        const role = d.prepare('SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name=? AND u.active=1 ORDER BY u.id LIMIT 1').get(raw);
        if (role) { uid = role.id; via = 'role:' + raw; }
      }
      if (!uid) throw new Error('کاربر مقصد یافت نشد: ' + raw);
      generic.update(spec, actor, instance.entity_id, { [field]: uid });
      return { ok: true, result: { field, user: uid, via } };
    },
  },
  'record.add_note': {
    fa: 'افزودن یادداشت (Add Note)',
    params: [{ key: 'text', type: 'text', required: true }],
    run(ctx, node, actor, instance) {
      const generic = require('../api/generic');
      const { R } = require('../api/resources');
      const m = node.params.module ? resolveValue(node.params.module, ctx) : instance.module;
      const spec = R[m]; if (!spec) throw new Error('ماژول نامعتبر: ' + m);
      generic.addComment(spec, actor, instance.entity_id, resolveValue(node.params.text, ctx) || 'یادداشت Workflow');
      return { ok: true };
    },
  },
  'record.add_tag': {
    fa: 'افزودن برچسب (Add Tag)',
    params: [{ key: 'tags', type: 'text', required: true }],
    run(ctx, node, actor, instance) {
      const generic = require('../api/generic');
      const { R } = require('../api/resources');
      const m = node.params.module ? resolveValue(node.params.module, ctx) : instance.module;
      const spec = R[m]; if (!spec) throw new Error('ماژول نامعتبر: ' + m);
      const tags = String(resolveValue(node.params.tags, ctx)).split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
      generic.setTags(spec, actor, instance.entity_id, tags);
      return { ok: true, result: { tags } };
    },
  },
  'followup.create': {
    fa: 'ایجاد پیگیری (Create Follow-up)',
    params: [{ key: 'subject', type: 'text', required: true }, { key: 'due_days', type: 'number', required: false }, { key: 'assign', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const p = node.params || {};
      const due = p.due_days ? new Date(Date.now() + Number(p.due_days) * 864e5).toISOString() : null;
      const who = p.assign ? (Number(toEnDigits(resolveValue(p.assign, ctx))) || actor.id) : actor.id;
      const info = db().prepare('INSERT INTO followups(entity_type, entity_id, user_id, subject, note, due_at, status) VALUES(?,?,?,?,?,?,?)')
        .run(instance.module, instance.entity_id, who || null, resolveValue(p.subject, ctx) || 'پیگیری خودکار', resolveValue(p.note || '', ctx), due, 'pending');
      const id = Number(info.lastInsertRowid);
      if (who) { try { notify(who, 'workflow_step', 'پیگیری جدید', 'یک پیگیری به شما اختصاص یافت: ' + p.subject, 'followup', id, actor.id); } catch {} }
      return { ok: true, result: { followup_id: id, assignee: who } };
    },
  },
  'task.create': {
    fa: 'ایجاد وظیفه (Create Task)',
    params: [{ key: 'title', type: 'text', required: true }, { key: 'description', type: 'text', required: false }, { key: 'assign', type: 'text', required: false }, { key: 'due_days', type: 'number', required: false }, { key: 'priority', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const p = node.params || {};
      const who = p.assign ? (Number(toEnDigits(resolveValue(p.assign, ctx))) || actor.id) : actor.id;
      const ts = nowIso();
      const info = db().prepare('INSERT INTO tasks(title, description, assignee_id, related_type, related_id, priority, status, due_at, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(resolveValue(p.title, ctx) || 'وظیفه خودکار', resolveValue(p.description || '', ctx), who || null, instance.module, instance.entity_id, p.priority || 'medium', 'open', p.due_days ? new Date(Date.now() + Number(p.due_days) * 864e5).toISOString() : null, actor.id, ts, actor.id, ts);
      const id = Number(info.lastInsertRowid);
      if (who) { try { notify(who, 'task', 'وظیفه جدید', p.title, 'task', id, actor.id); } catch {} }
      return { ok: true, result: { task_id: id, assignee: who } };
    },
  },
  'meeting.create': {
    fa: 'ایجاد جلسه (Create Meeting)',
    params: [{ key: 'title', type: 'text', required: true }, { key: 'start_at', type: 'text', required: true }, { key: 'participants', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const p = node.params || {};
      const ts = new Date();
      const start = resolveValue(p.start_at, ctx);
      const info = db().prepare('INSERT INTO meetings(title, customer_id, participant_ids, start_at, end_at, status, created_by, created_at, organizer_id, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(resolveValue(p.title, ctx), instance.module === 'customer' ? instance.entity_id : ((ctx[instance.module] || {}).customer_id) || 0, resolveValue(p.participants || '', ctx), start, new Date(new Date(start).getTime() + 36e5).toISOString(), 'scheduled', actor.id, ts.toISOString(), actor.id, ts.toISOString());
      return { ok: true, result: { meeting_id: Number(info.lastInsertRowid) } };
    },
  },
  'notification': {
    fa: 'اعلان داخلی (Notification)',
    params: [{ key: 'recipients', type: 'recipients', required: true }, { key: 'title', type: 'text', required: true }, { key: 'body', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const rec = node.params.recipients || {};
      const title = resolveValue(node.params.title, ctx) || 'اعلان';
      const body = resolveValue(node.params.body || '', ctx);
      let n = 0;
      (rec.users || []).forEach(u => { const uid = Number(toEnDigits(resolveValue(u, ctx))); if (uid) { notify(uid, 'workflow', title, body, instance.module, instance.entity_id); n++; } });
      (rec.roles || []).forEach(r => { if (r) { notifyRoles([String(r)], 'workflow', title, body, instance.module, instance.entity_id); n++; } });
      (rec.departments || []).forEach(dep => { if (dep) { notifyDepartment(String(dep), 'workflow', title, body, instance.module, instance.entity_id); n++; } });
      if (rec.all) { try { notifyAll('workflow', title, body, instance.module, instance.entity_id); } catch {} n++; }
      return { ok: true, result: { notified: n } };
    },
  },
  'message': {
    fa: 'ارسال پیام (SMS/WhatsApp/Telegram) — از Platform واقعی',
    params: [{ key: 'channel', type: 'channel', required: true }, { key: 'recipient', type: 'text', required: true }, { key: 'template', type: 'text', required: true }],
    async run(ctx, node, actor, instance) {
      const { sendViaProvider } = require('../api/custom/campaigns');
      const p = node.params || {};
      const channel = String(p.channel || 'sms');
      let to = resolveValue(p.recipient, ctx);
      if (!to) to = fieldOf(ctx, p.recipient);
      to = String(to || '').trim();
      if (!to) throw new Error('گیرندهٔ پیام مشخص نیست');
      const body = resolveValue(p.template || '', ctx);
      const cfg = getSetting(channel);
      const configured = cfg && cfg.active && cfg.settings;
      if (!configured) return { ok: true, not_configured: true, result: { channel, status: 'not_configured', reason: 'پرووایدر کانال ' + channel + ' تنظیم نشده — ارسال واقعی انجام نشد' } };
      await sendViaProvider(channel, cfg, to, body);
      return { ok: true, result: { channel, status: 'sent', to } };
    },
  },
  'email': {
    fa: 'ارسال ایمیل (Email) — از Integration واقعی',
    params: [{ key: 'to', type: 'text', required: true }, { key: 'subject', type: 'text', required: true }, { key: 'body', type: 'text', required: true }],
    async run(ctx, node, actor, instance) {
      const { sendViaProvider } = require('../api/custom/campaigns');
      const p = node.params || {};
      let to = resolveValue(p.to, ctx);
      if (!to) to = fieldOf(ctx, p.to);
      to = String(to || '').trim();
      if (!to) throw new Error('گیرندهٔ ایمیل مشخص نیست');
      const cfg = getSetting('email');
      const configured = cfg && cfg.active && cfg.settings;
      if (!configured) return { ok: true, not_configured: true, result: { channel: 'email', status: 'not_configured', reason: 'ایمیل تنظیم نشده — ارسال واقعی انجام نشد' } };
      await sendViaProvider('email', cfg, to, resolveValue(p.body, ctx), resolveValue(p.subject, ctx));
      return { ok: true, result: { channel: 'email', status: 'sent', to } };
    },
  },
  'quote.create': {
    fa: 'ایجاد پیش‌فاکتور (Create Proforma)',
    params: [{ key: 'customer_id', type: 'text', required: false }, { key: 'tax_rate', type: 'number', required: false }, { key: 'items', type: 'kv', required: false }],
    run(ctx, node, actor, instance) {
      const generic = require('../api/generic');
      const { R } = require('../api/resources');
      const p = node.params || {};
      let cust = p.customer_id ? Number(toEnDigits(resolveValue(p.customer_id, ctx))) : (instance.module === 'customer' ? instance.entity_id : ((ctx[instance.module] || {}).customer_id) || null);
      if (!cust) throw new Error('مشتری پیش‌فاکتور مشخص نیست');
      const quote = {
        customer_id: cust,
        salesperson_id: ((ctx.customer || {}).salesperson_id) || actor.id,
        status: 'draft',
        tax_rate: p.tax_rate !== undefined ? Number(p.tax_rate) : 9,
        valid_until: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      };
      const qid = generic.create(R.quote, actor, quote);
      if (p.items && Array.isArray(p.items)) {
        for (const it of p.items) {
          const product = Number(toEnDigits(resolveValue(it.product_id, ctx)));
          const row = db().prepare('SELECT * FROM products WHERE id=?').get(product);
          if (!row) continue;
          const qty = Number(it.qty) || 1;
          const price = it.price !== undefined && it.price !== '' ? Number(resolveValue(it.price, ctx)) : (row.price_retail || 0);
          db().prepare('INSERT INTO quote_items(quote_id, product_id, name, qty, price, discount_pct, line_total) VALUES(?,?,?,?,?,?,?)')
            .run(qid, product, row.name, qty, price, it.discount_pct || 0, qty * price * (1 - (it.discount_pct || 0) / 100));
        }
        try { require('../api/custom/sales').recalcDoc('quote', qid); } catch { /* best-effort */ }
      }
      ctx.quote_id = qid;
      return { ok: true, result: { quote_id: qid, customer_id: cust } };
    },
  },
  'order.create': {
    fa: 'تبدیل به سفارش (Create Order)',
    params: [{ key: 'quote_id', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const sales = require('../api/custom/sales');
      let qid = node.params.quote_id ? Number(toEnDigits(resolveValue(node.params.quote_id, ctx))) : (ctx.quote_id || null);
      if (!qid) qid = db().prepare('SELECT id FROM quotes WHERE customer_id=? AND status IN (\'approved\',\'confirmed\') ORDER BY id DESC LIMIT 1').get(instance.entity_id)?.id || null;
      if (!qid) throw new Error('پیش‌فاکتور مبدا یافت نشد');
      const r = sales.quoteToOrder(actor, qid);
      ctx.order_id = r.order_id;
      return { ok: true, result: { order_id: r.order_id } };
    },
  },
  'invoice.create': {
    fa: 'صدور فاکتور (Create Invoice)',
    params: [{ key: 'order_id', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const sales = require('../api/custom/sales');
      let oid = node.params.order_id ? Number(toEnDigits(resolveValue(node.params.order_id, ctx))) : (ctx.order_id || null);
      if (!oid) throw new Error('سفارش مبدا یافت نشد');
      const r = sales.orderToInvoice(actor, oid);
      ctx.invoice_id = r.invoice_id;
      return { ok: true, result: { invoice_id: r.invoice_id } };
    },
  },
  'payment.register': {
    fa: 'ثبت پرداخت (Register Payment)',
    params: [{ key: 'invoice_id', type: 'text', required: false }, { key: 'amount', type: 'number', required: true }, { key: 'method', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const sales = require('../api/custom/sales');
      let inv = node.params.invoice_id ? Number(toEnDigits(resolveValue(node.params.invoice_id, ctx))) : (ctx.invoice_id || null);
      if (!inv) throw new Error('فاکتور هدف یافت نشد');
      const r = sales.addPayment(actor, { invoice_id: inv, amount: Number(resolveValue(node.params.amount, ctx)), method: node.params.method || 'bank' });
      return { ok: true, result: { payment_id: r.payment_id } };
    },
  },
  'stock.move': {
    fa: 'حرکت موجودی (Reserve/Change Inventory)',
    params: [{ key: 'product_id', type: 'text', required: true }, { key: 'qty', type: 'number', required: true }, { key: 'direction', type: 'text', required: false }, { key: 'note', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const sales = require('../api/custom/sales');
      const p = node.params || {};
      const pid = Number(toEnDigits(resolveValue(p.product_id, ctx)));
      const dir = p.direction === 'in' ? 'in' : 'out';
      const qty = dir === 'in' ? Math.abs(Number(resolveValue(p.qty, ctx))) : -Math.abs(Number(resolveValue(p.qty, ctx)));
      const out = sales.stockMove(actor, pid, qty, resolveValue(p.note || 'عملیات Workflow', ctx));
      return { ok: true, result: { product_id: pid, direction: dir, qty: out } };
    },
  },
  'workflow.start': {
    fa: 'اجرای Workflow دیگر (Run Another Workflow)',
    params: [{ key: 'process_key', type: 'text', required: true }],
    run(ctx, node, actor, instance) {
      const p = db().prepare('SELECT * FROM wf_processes WHERE key=? AND active=1').get(String(resolveValue(node.params.process_key, ctx) || ''));
      if (!p) throw new Error('فرآیند هدف یافت نشد: ' + node.params.process_key);
      const inst = startExecution({ processId: p.id, module: instance.module, entityId: instance.entity_id, actor, dedupe: false });
      return { ok: true, result: { started: p.name, execution: inst ? inst.id : null } };
    },
  },
  'workflow.stop': {
    fa: 'توقف Workflow (Stop Workflow)',
    params: [{ key: 'execution', type: 'text', required: false }],
    run(ctx, node, actor, instance) {
      const target = (node.params.execution === 'current') ? instance.id : (Number(resolveValue(node.params.execution, ctx)) || 0);
      if (target) cancelExecution(actor, target, 'توقف توسط Workflow');
      return { ok: true, result: { stopped: target } };
    },
  },
};
const ACTION_KEYS = Object.keys(ACTIONS);
function typeToAction(t) {
  return { create_record: 'record.create', update_record: 'record.update', assignment: 'record.assign', notification: 'notification', message: 'message', email: 'email' }[t] || 'record.add_note';
}

// ---------------------------------------------------------------------------
// Definition validation (publish gate): missing end, unreachable nodes,
// infinite loops, incomplete nodes/edges
// ---------------------------------------------------------------------------
function nodeDelayMs(n) {
  const p = n.params || {};
  if (p.due_at) {
    let s = String(p.due_at);
    if (s.includes('{{')) s = s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, '0');
    const t = new Date(s).getTime();
    if (!isNaN(t) && t > Date.now()) return t - Date.now();
    return 0;
  }
  const ms = Number(p.delay_ms);
  if (ms > 0 && ms < 90 * 864e5) return ms;
  const v = Number(p.delay_value) || 0;
  const mult = { minute: 60e3, hour: 36e5, day: 864e5, week: 7 * 864e5 }[p.delay_unit] || 864e5;
  return v > 0 ? v * mult : 0;
}
function validateDef(def) {
  const errors = [];
  if (!def || !Array.isArray(def.nodes) || !def.nodes.length) return { ok: false, errors: ['فرآیند حداقل باید یک گره داشته باشد.'] };
  const ids = new Set(def.nodes.map(n => n.id));
  if (ids.size !== def.nodes.length) errors.push('شمارهٔ گره‌ها باید منحصربه‌فرد باشد.');
  if (!def.nodes.some(n => n.type === 'start' || n.type === 'trigger')) errors.push('یک گرهٔ «شروع/Trigger» لازم است.');
  if (!def.nodes.some(n => n.type === 'end')) errors.push('یک گرهٔ «پایان» لازم است.');
  for (const n of def.nodes) {
    const meta = NODE_META[n.type];
    if (!meta) { errors.push('نوع گره «' + (n.title || n.id) + '» نامعتبر است: ' + n.type); continue; }
    if (!n.title || String(n.title).length > 200) errors.push('عنوان گره «' + (n.title || n.id) + '» نامعتبر است.');
    if (n.type === 'condition' && !n.condition) errors.push('گرهٔ شرط «' + n.title + '» شرطی تعریف ندارد.');
    if ((n.type === 'approval' || n.type === 'signature') && (!n.assignee_type || n.assignee_type === 'none' || n.assignee_type === 'dynamic')) {
      if (n.assignee_type !== 'dynamic' || !n.assignee) errors.push('گرهٔ «' + n.title + '» مسئول معتبر ندارد.');
    }
    if (n.type === 'action' && !ACTIONS[n.action]) errors.push('Action گره «' + n.title + '» نامعتبر است: ' + (n.action || '—'));
    if (n.type === 'message' && !(n.params && n.params.channel)) errors.push('گرهٔ پیام «' + n.title + '» کانال ندارد.');
    if (n.type === 'email' && !(n.params && n.params.to)) errors.push('گرهٔ ایمیل «' + n.title + '» گیرنده ندارد.');
    if (n.type === 'delay' && !nodeDelayMs(n)) errors.push('گرهٔ تأخیر «' + n.title + '» مدت معتبر ندارد.');
    if (n.type === 'create_record' && !(n.params && n.params.module)) errors.push('گرهٔ Create Record «' + n.title + '» ماژول ندارد.');
    if (n.type === 'update_record' && !(n.params && n.params.module)) errors.push('گرهٔ Update Record «' + n.title + '» ماژول ندارد.');
  }
  for (const e of (def.edges || [])) {
    if (!ids.has(e.from) || !ids.has(e.to)) { errors.push('اتصال با مبدأ/مقصد نامعتبر: ' + e.from + ' → ' + e.to); continue; }
    if (e.from === e.to) errors.push('اتصال حلقه‌ای روی یک گره («' + e.from + '») مجاز نیست.');
    if (e.label !== undefined && !EDGE_LABELS.includes(e.label)) errors.push('برچسب اتصال نامعتبر: ' + e.label);
  }
  const adj = {};
  for (const e of (def.edges || [])) (adj[e.from] = adj[e.from] || []).push(e.to);
  const starts = def.nodes.filter(n => n.type === 'start' || n.type === 'trigger');
  const reach = new Set(); const stack = starts.map(s => s.id);
  while (stack.length) { const n = stack.pop(); if (reach.has(n)) continue; reach.add(n); for (const m of (adj[n] || [])) stack.push(m); }
  for (const end of def.nodes.filter(n => n.type === 'end')) if (!reach.has(end.id)) errors.push('مسیری از شروع به «پایان» (' + end.id + ') وجود ندارد.');
  for (const n of def.nodes) if (!reach.has(n.id)) errors.push('گرهٔ «' + (n.title || n.id) + '» قابل دسترس نیست (Unreachable Node).');
  const cycle = detectCycle(def);
  if (cycle) errors.push('حلقهٔ بی‌پایان (Infinite Loop) شناسایی شد: ' + cycle);
  return { ok: !errors.length, errors };
}
function detectCycle(def) {
  const adj = {};
  for (const e of (def.edges || [])) {
    if (e.label === 'return' || e.label === 'loop') continue; // intentional back-edges
    (adj[e.from] = adj[e.from] || []).push(e.to);
  }
  const color = {};
  const stack = [];
  let found = null;
  function dfs(u) {
    color[u] = 1; stack.push(u);
    for (const v of (adj[u] || [])) {
      if (color[v] === 1) { if (!found) found = stack.slice(stack.indexOf(v)).join(' → ') + ' → ' + v; }
      else if (!color[v]) dfs(v);
    }
    stack.pop(); color[u] = 2;
  }
  for (const n of (def.nodes || [])) if (!color[n.id]) dfs(n.id);
  return found;
}

// ---------------------------------------------------------------------------
// Execution lifecycle
// ---------------------------------------------------------------------------
function getProcessDef(processId) {
  const d = db();
  const proc = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!proc || !proc.active) return null;
  const ver = d.prepare('SELECT * FROM wf_versions WHERE process_id=? AND active=1 ORDER BY version DESC LIMIT 1').get(processId);
  if (!ver) return null;
  return { proc, ver, def: safeParse(ver.definition, { nodes: [], edges: [] }) };
}
async function startExecution({ processId, module, entityId, actor, title, data, testMode, dedupe = true }) {
  const d = db();
  const ld = getProcessDef(processId);
  if (!ld) return null;
  if (dedupe) {
    const existing = d.prepare("SELECT * FROM wf_instances WHERE process_id=? AND module=? AND entity_id=? AND status IN ('running','waiting','pending')").get(processId, module, entityId);
    if (existing) return existing;
  }
  const startNode = (ld.def.nodes || []).find(n => n.type === 'start' || n.type === 'trigger') || (ld.def.nodes || [])[0];
  const ctx = {};
  const { R } = require('../api/resources');
  const spec = R[module];
  let row = null;
  try { if (spec) row = d.prepare(`SELECT * FROM ${spec.table} WHERE id=?`).get(entityId); } catch {}
  if (row) { ctx[module] = row; const c = loadRelatedCustomer(d, module, row); if (c) ctx.customer = c; }
  if (actor) { const u = d.prepare('SELECT id, username, full_name, department FROM users WHERE id=?').get(actor.id); if (u) ctx.user = u; }
  const ts = nowIso();
  const execNo = testMode ? 'TEST-' + Date.now() : nextExecutionNo();
  const info = d.prepare('INSERT INTO wf_instances(process_id, version_id, version, module, entity_id, title, status, current_node_id, data, context, started_by, started_at, updated_at, execution_no, test_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(processId, ld.ver.id, ld.ver.version, module, entityId,
      title || (ld.proc.name + ' — ' + (row ? (row.name || row.number || row.subject || ('#' + entityId)) : ('#' + entityId))),
      'running', startNode ? startNode.id : null, JSON.stringify(data || {}), JSON.stringify(ctx), actor ? actor.id : 0, ts, ts, execNo, testMode ? 1 : 0);
  const instId = Number(info.lastInsertRowid);
  log(instId, 'info', 'اجرا شروع شد (Execution started)', { execution_no: execNo, version: ld.ver.version }, startNode ? startNode.id : '');
  try { await advance(instId); } catch (e) { failExecution(instId, e.message); }
  return d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
}
function failExecution(instId, message, nodeId) {
  const d = db();
  d.prepare('UPDATE wf_instances SET status=\'failed\', error=?, error_at=?, updated_at=? WHERE id=?').run(String(message).slice(0, 500), nowIso(), nowIso(), instId);
  log(instId, 'error', 'اجرا با خطا متوقف شد: ' + message, {}, nodeId || '');
  const inst = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
  if (inst && inst.started_by) { try { notify(inst.started_by, 'workflow_error', 'خطا در فرآیند', inst.title + ': ' + message, 'wf_instance', instId, inst.started_by); } catch {} }
}
function cancelExecution(actor, instId, reason) {
  const d = db();
  const inst = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
  if (!inst) return false;
  d.prepare('UPDATE wf_instances SET status=\'cancelled\', current_node_id=NULL, completed_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), instId);
  d.prepare('UPDATE wf_steps SET status=\'returned\', completed_at=? WHERE instance_id=? AND status=\'active\'').run(nowIso(), instId);
  d.prepare('UPDATE wf_schedules SET processed_at=? WHERE execution_id=? AND processed_at IS NULL').run(nowIso(), instId);
  log(instId, 'info', 'اجرا لغو شد: ' + (reason || ''), {}, '');
  if (actor) { try { audit(actor, 'workflow', instId, 'cancel', null, { reason: reason || '' }); } catch {} }
  return true;
}
function setWaiting(instId, nodeId, waitUntil, kind, payload) {
  const d = db();
  d.prepare('UPDATE wf_instances SET status=\'waiting\', current_node_id=?, updated_at=? WHERE id=?').run(nodeId, nowIso(), instId);
  d.prepare('INSERT INTO wf_schedules(execution_id, node_id, due_at, kind, payload, created_at) VALUES(?,?,?,?,?,?)')
    .run(instId, nodeId, waitUntil || null, kind, JSON.stringify(payload || {}), nowIso());
  log(instId, 'info', 'در انتظار: ' + (kind || 'delay') + (waitUntil ? ' تا ' + waitUntil : ' (رویداد)'), {}, nodeId);
}
function resumeFromSchedule(scheduleId) {
  const d = db();
  const s = d.prepare('SELECT * FROM wf_schedules WHERE id=? AND processed_at IS NULL').get(scheduleId);
  if (!s) return false;
  d.prepare('UPDATE wf_schedules SET processed_at=? WHERE id=?').run(nowIso(), scheduleId);
  const inst = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(s.execution_id);
  if (!inst || !['waiting', 'running'].includes(inst.status)) return false;
  log(inst.id, 'info', 'ادامه پس از انتظار (' + (s.kind || 'delay') + ')', {}, s.node_id);
  const ld = getProcessDef(inst.process_id);
  if (!ld) return false;
  const next = forwardEdge(ld.def, s.node_id);
  if (!next) { d.prepare('UPDATE wf_instances SET status=\'completed\', completed_at=?, current_node_id=NULL, updated_at=? WHERE id=?').run(nowIso(), nowIso(), inst.id); return true; }
  d.prepare('UPDATE wf_instances SET status=\'running\', current_node_id=?, updated_at=? WHERE id=?').run(next.to, nowIso(), inst.id);
  advance(inst.id).catch(e => failExecution(inst.id, e.message));
  return true;
}
// due schedules → resume (called by the 60s scheduler)
function processDueSchedules() {
  const d = db();
  const rows = d.prepare('SELECT id FROM wf_schedules WHERE processed_at IS NULL AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at LIMIT 50').all(nowIso());
  for (const r of rows) { try { resumeFromSchedule(r.id); } catch (e) { console.error('[wf-sched]', e.message); } }
  return rows.length;
}
// resume a 'wait_event' node when a named event fires
function emitWaitEvent(eventName, payload) {
  const d = db();
  const rows = d.prepare("SELECT id FROM wf_schedules WHERE processed_at IS NULL AND kind='wait_event' AND due_at IS NULL").all();
  for (const r of rows) {
    const s = d.prepare('SELECT * FROM wf_schedules WHERE id=?').get(r.id);
    const p = safeParse(s.payload, {});
    if (p.event && String(p.event) !== String(eventName)) continue;
    try { resumeFromSchedule(s.id); } catch (e) { console.error('[wf-wait]', e.message); }
  }
}
// server restart: continue executions left running on an auto-node
function resumeInterrupted() {
  const d = db();
  const rows = d.prepare("SELECT id, process_id, current_node_id FROM wf_instances WHERE status='running' AND current_node_id IS NOT NULL").all();
  for (const r of rows) {
    const ld = getProcessDef(r.process_id);
    if (!ld) continue;
    const node = findNode(ld.def, r.current_node_id);
    if (!node) continue;
    const meta = NODE_META[node.type];
    if (!meta || !meta.step) { log(r.id, 'info', 'ادامهٔ اجرای ازسرگرفته‌شده پس از ری‌استارت', {}, node.id); advance(r.id).catch(e => failExecution(r.id, e.message)); }
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// advance — walk the graph through auto-nodes; pause at step/wait nodes
// ---------------------------------------------------------------------------
async function advance(instId) {
  const d = db();
  let inst = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
  if (!inst) return;
  if (!['running', 'waiting'].includes(inst.status)) return;
  const ld = getProcessDef(inst.process_id);
  if (!ld) { d.prepare('UPDATE wf_instances SET status=\'terminated\', updated_at=? WHERE id=?').run(nowIso(), instId); return; }
  const def = ld.def;
  let curId = inst.current_node_id;
  let guard = 0;
  while (guard++ < 200) {
    inst = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
    if (!inst || !['running', 'waiting'].includes(inst.status)) return;
    const node = findNode(def, curId);
    if (!node) { d.prepare('UPDATE wf_instances SET status=\'terminated\', updated_at=? WHERE id=?').run(nowIso(), instId); log(instId, 'error', 'گرهٔ جاری پیدا نشد', {}, curId); return; }
    const stepCount = d.prepare('SELECT COUNT(*) c FROM wf_steps WHERE instance_id=?').get(instId).c;
    if (stepCount >= 300) { d.prepare('UPDATE wf_instances SET status=\'terminated\', updated_at=? WHERE id=?').run(nowIso(), instId); log(instId, 'error', 'حداکثر تعداد مراحل — Loop protection — متوقف شد', {}, node.id); return; }
    const meta = NODE_META[node.type];
    if (!meta) { d.prepare('UPDATE wf_instances SET status=\'terminated\', updated_at=? WHERE id=?').run(nowIso(), instId); log(instId, 'error', 'نوع گره نامعتبر: ' + node.type, {}, node.id); return; }

    switch (node.type) {
      case 'start':
      case 'trigger': {
        const e = forwardEdge(def, node.id);
        if (!e) { finish(inst, 'completed', node.id, 'پایان'); return; }
        d.prepare('UPDATE wf_instances SET current_node_id=?, status=\'running\', updated_at=? WHERE id=?').run(e.to, nowIso(), instId);
        curId = e.to; continue;
      }
      case 'end': {
        const ctx = ctxRoots(inst);
        const rejected = !!(ctx.data && ctx.data.__wf_rejected);
        finish(inst, rejected ? 'rejected' : 'completed', node.id, rejected ? 'پایان فرآیند (با رد)' : 'پایان فرآیند');
        return;
      }
      case 'condition': {
        refreshContext(instId);
        const fresh = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
        const ctx = ctxRoots(fresh);
        const truthy = evalGroup(node.condition, ctx);
        const edge = outEdges(def, node.id, truthy ? 'true' : 'false')[0] || forwardEdge(def, node.id);
        log(instId, truthy ? 'success' : 'info', 'شرط: ' + (truthy ? 'بله' : 'خیر') + ' → ' + (edge ? ((findNode(def, edge.to) || {}).title || edge.to) : '—'), { condition: node.condition }, node.id);
        if (!edge) { d.prepare('UPDATE wf_instances SET status=\'terminated\', updated_at=? WHERE id=?').run(nowIso(), instId); log(instId, 'error', 'گرهٔ شرط مسیری خروجی ندارد', {}, node.id); return; }
        d.prepare('UPDATE wf_instances SET current_node_id=?, status=\'running\', updated_at=? WHERE id=?').run(edge.to, nowIso(), instId);
        curId = edge.to; continue;
      }
      case 'action':
      case 'create_record':
      case 'update_record':
      case 'assignment':
      case 'notification':
      case 'message':
      case 'email': {
        await runAutoNode(inst, node);
        return; // runAutoNode advances itself (or stops on error)
      }
      case 'delay':
      case 'schedule': {
        const ms = nodeDelayMs(node);
        setWaiting(instId, node.id, new Date(Date.now() + ms).toISOString(), node.type, { title: node.title });
        return;
      }
      case 'wait': {
        setWaiting(instId, node.id, null, 'wait_event', { event: node.params && node.params.event ? String(node.params.event) : '' });
        return;
      }
      case 'parallel': {
        const branches = outEdges(def, node.id, 'branch');
        if (!branches.length) {
          const e = forwardEdge(def, node.id);
          if (e) { d.prepare('UPDATE wf_instances SET current_node_id=?, status=\'running\', updated_at=? WHERE id=?').run(e.to, nowIso(), instId); curId = e.to; continue; }
          finish(inst, 'completed', node.id, 'پایان'); return;
        }
        const parentId = createStep(inst, node, null, branches.length);
        for (const b of branches) {
          const bn = findNode(def, b.to);
          if (bn && NODE_META[bn.type] && NODE_META[bn.type].step) createStep(inst, bn, parentId, 0);
        }
        d.prepare('UPDATE wf_instances SET status=\'waiting\', current_node_id=?, updated_at=? WHERE id=?').run(node.id, nowIso(), instId);
        log(instId, 'info', 'شروع اجرای موازی (' + branches.length + ' شاخه)', {}, node.id);
        return;
      }
      case 'merge': {
        const pending = d.prepare("SELECT COUNT(*) c FROM wf_steps WHERE instance_id=? AND status='active'").get(instId).c;
        if (pending > 0) { d.prepare('UPDATE wf_instances SET status=\'waiting\', updated_at=? WHERE id=?').run(nowIso(), instId); log(instId, 'info', 'در انتظار تکمیل شاخه‌ها (Merge)', {}, node.id); return; }
        const e = forwardEdge(def, node.id);
        if (!e) { finish(inst, 'completed', node.id, 'پایان'); return; }
        d.prepare('UPDATE wf_instances SET current_node_id=?, status=\'running\', updated_at=? WHERE id=?').run(e.to, nowIso(), instId);
        log(instId, 'info', 'ادغام مسیرها (Merge)', {}, node.id);
        curId = e.to; continue;
      }
      case 'approval':
      case 'signature':
      case 'task': {
        const existing = d.prepare("SELECT id FROM wf_steps WHERE instance_id=? AND node_id=? AND status='active' AND parent_id IS NULL").get(instId, node.id);
        if (existing) return;
        createStep(inst, node);
        d.prepare('UPDATE wf_instances SET status=\'waiting\', current_node_id=?, updated_at=? WHERE id=?').run(node.id, nowIso(), instId);
        log(instId, 'info', (node.type === 'approval' ? 'در انتظار تأیید' : node.type === 'signature' ? 'در انتظار امضا' : 'در انتظار تکمیل مرحله') + ': ' + node.title, { node: node.id }, node.id);
        return;
      }
      default: {
        d.prepare('UPDATE wf_instances SET status=\'terminated\', updated_at=? WHERE id=?').run(nowIso(), instId);
        log(instId, 'error', 'نوع گره نامعتبر: ' + node.type, {}, node.id);
        return;
      }
    }
  }
  d.prepare('UPDATE wf_instances SET status=\'terminated\', updated_at=? WHERE id=?').run(nowIso(), instId);
  log(instId, 'error', 'حداکثر حد چرخهٔ اجرا (guard) — متوقف شد', {});
}
function finish(inst, status, nodeId, note) {
  const d = db();
  d.prepare('UPDATE wf_instances SET status=?, current_node_id=NULL, completed_at=?, updated_at=? WHERE id=?').run(status, nowIso(), nowIso(), inst.id);
  d.prepare('INSERT INTO wf_steps(instance_id, node_id, node_title, status, note, completed_at, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(inst.id, nodeId, note || status, 'completed', note || '', nowIso(), nowIso());
  log(inst.id, status === 'completed' ? 'success' : 'warn', note || status, {}, nodeId);
  if (inst.started_by) { try { notify(inst.started_by, 'workflow', 'فرآیند ' + (status === 'completed' ? 'به پایان رسید' : status === 'rejected' ? 'با رد به پایان رسید' : status), inst.title, 'wf_instance', inst.id, inst.started_by); } catch {} }
}
async function runAutoNode(inst, node) {
  const d = db();
  const instId = inst.id;
  const actor = inst.started_by ? d.prepare('SELECT * FROM users WHERE id=?').get(inst.started_by) : null;
  if (!actor) { failExecution(instId, 'کاربر مجری اجرا پیدا نشد', node.id); return; }
  refreshContext(instId);
  const fresh = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
  const ctx = ctxRoots(fresh);
  const actionKey = node.type === 'action' ? (node.action || 'record.add_note') : typeToAction(node.type);
  const action = ACTIONS[actionKey];
  // TEST MODE: conditions/steps run and variables resolve, but real side-effect
  // actions are NOT executed (no fake results — the log says exactly that).
  if (fresh.test_mode) {
    log(instId, 'success', 'Test Mode — عملیات واقعی انجام نشد (dry run): ' + (action ? action.fa : actionKey), { node: node.id, action: actionKey, params: node.params || null }, node.id);
    const ld0 = getProcessDef(inst.process_id);
    if (ld0) {
      const e0 = forwardEdge(ld0.def, node.id);
      if (e0) { d.prepare('UPDATE wf_instances SET current_node_id=?, status=\'running\', updated_at=? WHERE id=?').run(e0.to, nowIso(), instId); await advance(instId); return; }
    }
    finish(d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId), 'completed', node.id, 'پایان (تست)');
    return;
  }
  log(instId, 'info', 'اجرای عملیات: ' + (action ? action.fa : actionKey), { node: node.id, action: actionKey }, node.id);
  let out = null, err = null;
  if (!action) err = new Error('Action نامعتبر: ' + actionKey);
  else { try { out = await action.run(ctx, node, actor, fresh); } catch (e) { err = e; } }
  if (err) {
    const onErr = node.on_error || 'stop';
    let retried = false;
    if (onErr === 'retry') {
      retried = true;
      log(instId, 'warn', 'تلاش مجدد (Retry) بعد از خطا: ' + err.message, {}, node.id);
      try { out = await action.run(ctxRoots(d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId)), node, actor, fresh); err = null; } catch (e2) { err = e2; }
    }
    if (err) {
      log(instId, 'error', 'خطا عملیات' + (retried ? ' (پس از تلاش مجدد)' : '') + ': ' + err.message, {}, node.id);
      if (onErr !== 'continue') { failExecution(instId, err.message, node.id); return; }
      d.prepare('UPDATE wf_instances SET status=\'running\', updated_at=? WHERE id=?').run(nowIso(), instId);
    }
  } else if (out && out.not_configured) {
    log(instId, 'warn', 'Not Configured — ارسال واقعی انجام نشد (فیک نیست): ' + ((out.result && out.result.reason) || ''), out.result, node.id);
  } else {
    log(instId, 'success', 'عملیات با موفقیت انجام شد', out && out.result, node.id);
  }
  // persist context changes (e.g. created quote_id/order_id) so later nodes see them
  if (!err) { try { d.prepare('UPDATE wf_instances SET context=? WHERE id=?').run(JSON.stringify(ctx), instId); } catch {} }
  const ld = getProcessDef(inst.process_id);
  if (!ld) return;
  const e = forwardEdge(ld.def, node.id);
  if (!e) { finish(d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId), 'completed', node.id, 'پایان (بدون مسیر بعد)'); return; }
  d.prepare('UPDATE wf_instances SET current_node_id=?, status=\'running\', updated_at=? WHERE id=?').run(e.to, nowIso(), instId);
  await advance(instId);
}

// ---------------------------------------------------------------------------
// Steps — approvals / signatures / tasks (waiting nodes)
// ---------------------------------------------------------------------------
function createStep(instance, node, parentId, remaining) {
  const d = db();
  const ctx = ctxRoots(instance);
  const a = resolveAssignee(node, ctx);
  const assigneeId = a.user_id || null;
  const dept = a.kind === 'department' ? a.department : '';
  const r = d.prepare('INSERT INTO wf_steps(instance_id, node_id, parent_id, node_title, assignee_id, department, status, remaining, started_at, created_at) VALUES (?,?,?,?,?,?,' + " 'active' " + ',?,?,?)')
    .run(instance.id, node.id, parentId, node.title || node.type, assigneeId, dept, remaining || 0, nowIso(), nowIso());
  const stepId = Number(r.lastInsertRowid);
  const verb = node.type === 'approval' ? 'تأیید' : node.type === 'signature' ? 'امضا' : 'تکمیل';
  if (node.notify !== false) {
    const instTitle = instance.title || ('فرآیند ' + (instance.module || ''));
    const msg = 'مرحلهٔ «' + node.title + '» در فرآیند «' + instTitle + '» — ' + verb + (a.label !== '—' ? ' (' + a.label + ')' : '') + ' در انتظار شماست.';
    try {
      if ((a.kind === 'user' || a.kind === 'dynamic') && assigneeId) notify(assigneeId, 'workflow_step', verb + ' جدید فرآیند', msg, 'wf_instance', instance.id, instance.started_by || 0);
      else if (a.kind === 'role' && a.role) notifyRoles([a.role], 'workflow_step', verb + ' جدید فرآیند', msg, 'wf_instance', instance.id, [], instance.started_by || 0);
      else if (a.kind === 'department' && dept) notifyDepartment(dept, 'workflow_step', verb + ' جدید فرآیند', msg, 'wf_instance', instance.id, instance.started_by || 0);
      else if (instance.started_by) notify(instance.started_by, 'workflow_step', 'مرحلهٔ جدید فرآیند (مسئول مشخص نیست)', msg, 'wf_instance', instance.id, instance.started_by);
    } catch { /* best-effort */ }
  }
  return stepId;
}
async function completeStep(user, instId, stepId, body) {
  const d = db();
  body = body || {};
  const inst = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
  if (!inst) throw new HttpError(404, 'NOT_FOUND', 'اجرا پیدا نشد.');
  if (!['running', 'waiting'].includes(inst.status)) return { ok: false, error: 'فرآیند در حال اجرا نیست' };
  const step = d.prepare('SELECT * FROM wf_steps WHERE id=? AND instance_id=?').get(stepId, instId);
  if (!step) throw new HttpError(404, 'NOT_FOUND', 'مرحله پیدا نشد.');
  if (step.status !== 'active') return { ok: false, error: 'این مرحله در حال اجرا نیست' };
  const ld = getProcessDef(inst.process_id);
  if (!ld) return { ok: false, error: 'تعریف فرآیند پیدا نشد' };
  const def = ld.def;
  const node = findNode(def, step.node_id);
  if (!node) return { ok: false, error: 'گرهٔ مرحله پیدا نشد' };
  if (!canCompleteStep(user, step, node, inst)) {
    try { audit(user, 'workflow', instId, 'permission_denied', null, { step: step.id, node: node.id }); } catch {}
    throw new HttpError(403, 'FORBIDDEN', 'شما مسئول این مرحله نیستید.');
  }
  const result = String(body.result || 'complete').slice(0, 30);
  const note = String(body.note || '').slice(0, 500);
  const formData = body.form_data && typeof body.form_data === 'object' ? body.form_data : {};
  let sigPath = '', sigMime = '';
  if ((node.type === 'signature' || body.signature) && !inst.test_mode) {
    if (result === 'reject') {
      if (!note.trim()) throw new HttpError(422, 'VALIDATION', 'دلیل رد الزامی است.');
    } else {
      const approvals = require('../api/custom/approvals');
      const cap = approvals.captureSignature(user, body.signature); // ALWAYS the user's own signature
      sigPath = cap.file_path; sigMime = cap.mime;
    }
  }
  if (node.type === 'approval' && result === 'reject' && !note.trim()) throw new HttpError(422, 'VALIDATION', 'دلیل رد الزامی است.');
  let stepStatus = 'completed';
  if (result === 'reject') stepStatus = 'rejected';
  else if (result === 'return') stepStatus = 'returned';
  const ts = nowIso();
  const data = safeParse(inst.data, {}) || {};
  Object.assign(data, formData);
  if (result === 'reject' && node.type === 'approval') data.__wf_rejected = true;
  d.transaction(() => {
    d.prepare('UPDATE wf_steps SET status=?, result=?, note=?, form_data=?, signature_path=?, signature_mime=?, completed_at=? WHERE id=?')
      .run(stepStatus, result, note, JSON.stringify(formData), sigPath, sigMime, ts, stepId);
    d.prepare('UPDATE wf_instances SET data=?, status=\'running\', updated_at=? WHERE id=?').run(JSON.stringify(data), ts, instId);
  })();
  log(instId, result === 'reject' ? 'warn' : 'success',
    (node.type === 'approval' ? 'تأیید' : node.type === 'signature' ? 'امضا' : 'تکمیل') + ' مرحلهٔ «' + (node.title || node.id) + '» توسط ' + (user.full_name || user.username) + (note ? ' — ' + note : ''),
    { result, signed: !!sigPath }, node.id, stepId);
  try { audit(user, 'workflow', instId, (result === 'reject' ? 'reject_step' : 'complete_step'), { node: node.id, step: stepId }, { note, result }); } catch {}
  if (step.parent_id) {
    const parent = d.prepare('SELECT * FROM wf_steps WHERE id=?').get(step.parent_id);
    if (parent && parent.status === 'active') {
      const remaining = Math.max(0, (parent.remaining || 1) - 1);
      d.prepare('UPDATE wf_steps SET remaining=? WHERE id=?').run(remaining, parent.id);
      if (remaining === 0) {
        d.prepare('UPDATE wf_steps SET status=\'completed\', completed_at=? WHERE id=?').run(ts, parent.id);
        d.prepare('UPDATE wf_instances SET current_node_id=?, status=\'running\', updated_at=? WHERE id=?').run(parent.node_id, ts, instId);
        log(instId, 'success', 'تمام شاخه‌های موازی تکمیل شد', {}, parent.node_id);
        await advance(instId);
      }
      return { ok: true, status: remaining === 0 ? 'advanced' : 'waiting_branch' };
    }
    return { ok: true, status: 'waiting_branch' };
  }
  let nextEdge = null;
  if (node.type === 'approval') {
    if (result === 'approve' || result === 'complete') nextEdge = outEdges(def, step.node_id, 'approve')[0] || forwardEdge(def, step.node_id);
    else if (result === 'reject') nextEdge = outEdges(def, step.node_id, 'reject')[0] || null;
    else if (result === 'return') nextEdge = outEdges(def, step.node_id, 'return')[0] || outEdges(def, step.node_id, 'loop')[0] || null;
  } else {
    if (result === 'return') nextEdge = outEdges(def, step.node_id, 'return')[0] || outEdges(def, step.node_id, 'loop')[0] || null;
    else nextEdge = forwardEdge(def, step.node_id);
  }
  if (!nextEdge) {
    const otherActive = d.prepare('SELECT COUNT(*) c FROM wf_steps WHERE instance_id=? AND id!=? AND status=\'active\'').get(instId, stepId).c;
    if (otherActive > 0) return { ok: true, status: 'waiting_branch' };
    const finalStatus = (result === 'reject' && node.type === 'approval') ? 'rejected' : 'completed';
    finish(d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId), finalStatus, node.id, result === 'reject' ? 'پایان فرآیند (با رد)' : 'پایان فرآیند');
    return { ok: true, status: finalStatus };
  }
  d.prepare('UPDATE wf_instances SET current_node_id=?, updated_at=? WHERE id=?').run(nextEdge.to, nowIso(), instId);
  await advance(instId);
  const now = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instId);
  return { ok: true, status: now.status, next: nextEdge.to };
}
function terminate(instId, user, reason) {
  return cancelExecution(user, instId, reason || 'پایان زودهنگم توسط کاربر');
}
function getInstance(instId) {
  const d = db();
  const i = d.prepare('SELECT i.*, p.name process_name, p.module module_key, p.key process_key FROM wf_instances i JOIN wf_processes p ON p.id=i.process_id WHERE i.id=?').get(instId);
  if (!i) return null;
  i.steps = d.prepare('SELECT s.*, u.full_name assignee_name FROM wf_steps s LEFT JOIN users u ON u.id=s.assignee_id WHERE s.instance_id=? ORDER BY s.id').all(instId);
  i.logs = d.prepare('SELECT * FROM wf_logs WHERE execution_id=? ORDER BY id ASC LIMIT 300').all(instId);
  const ld = getProcessDef(i.process_id);
  i.definition = ld ? ld.def : { nodes: [], edges: [] };
  i.current_node = findNode(i.definition, i.current_node_id) || null;
  i.current_node_title = i.current_node ? i.current_node.title : '';
  const active = i.steps.find(s => s.status === 'active');
  i.current_responsible = active ? (active.assignee_name || (active.department ? 'واحد: ' + active.department : '—')) : null;
  i.duration_sec = i.started_at ? Math.max(0, Math.round(((i.completed_at ? new Date(i.completed_at) : new Date()).getTime() - new Date(i.started_at).getTime()) / 1000)) : 0;
  return i;
}
module.exports = {
  NODE_META, NODE_TYPES, EDGE_LABELS, CONDITION_OPS, TRIGGERS, ASSIGNEE_TYPES, CHANNELS, ACTIONS, ACTION_KEYS,
  validateDef, detectCycle, startExecution, advance, completeStep, terminate, cancelExecution, getInstance,
  getProcessDef, processDueSchedules, resumeFromSchedule, resumeInterrupted, emitWaitEvent,
  resolveValue, evalGroup, evalLeaf, canCompleteStep, refreshContext, nextExecutionNo, log, isSuper, userRoles,
};
