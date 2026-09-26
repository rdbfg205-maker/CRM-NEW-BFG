'use strict';
// ============ Workflow Management API (Visual Workflow Engine) ============
// Design/CRUD + engine control. EXECUTION is delegated to the canonical engine
// in server/core/workflow-engine.js (single engine — no parallel implementation).
const { get, getSetting } = require('../../db/db');
const { nowIso } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { audit } = require('../../core/audit');
const { hasPerm } = require('../../auth/auth');
const eng = require('../../core/workflow-engine');

function d() { return get(); }
function isSuper(user) { return !!d().prepare("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.name='super_admin'").get(user.id); }
function canManage(user) { return isSuper(user) || hasPerm(user, 'workflow', 'edit').ok; }
function requireAdmin(user) { if (!canManage(user)) throw new HttpError(403, 'FORBIDDEN', 'شما مجوز طراحی فرآیندها را ندارید.'); }
function requirePermWf(user, action) {
  if (isSuper(user)) return;
  if (!hasPerm(user, 'workflow', action).ok) throw new HttpError(403, 'FORBIDDEN', 'شما مجوز ' + action + ' برای فرآیندها را ندارید.');
}

const MODULES = [
  { key: 'complaint', fa: 'شکایات', table: 'complaints', titleCol: 'subject' },
  { key: 'lab_request', fa: 'درخواست آزمایش', table: 'lab_requests', titleCol: 'number' },
  { key: 'customer', fa: 'مشتریان', table: 'customers', titleCol: 'name' },
  { key: 'order', fa: 'سفارش‌ها', table: 'orders', titleCol: 'number' },
  { key: 'invoice', fa: 'فاکتورها', table: 'invoices', titleCol: 'number' },
  { key: 'lead', fa: 'سرنخ‌ها', table: 'leads', titleCol: 'company' },
  { key: 'opportunity', fa: 'فرصت‌های فروش', table: 'opportunities', titleCol: 'title' },
  { key: 'contract', fa: 'قراردادها', table: 'contracts', titleCol: 'title' },
  { key: 'ticket', fa: 'تیکت‌ها', table: 'tickets', titleCol: 'subject' },
  { key: 'quote', fa: 'پیش‌فاکتورها', table: 'quotes', titleCol: 'number' },
  { key: 'payment', fa: 'پرداخت‌ها', table: 'payments', titleCol: 'number' },
  { key: 'warranty', fa: 'گارانتی', table: 'warranties', titleCol: 'serial' },
  { key: 'task', fa: 'وظایف', table: 'tasks', titleCol: 'title' },
  { key: 'product', fa: 'محصولات', table: 'products', titleCol: 'name' },
  { key: 'purchase_order', fa: 'سفارش خرید / انبار', table: 'purchase_orders', titleCol: 'number' },
  { key: 'followup', fa: 'پیگیری‌ها', table: 'followups', titleCol: 'subject' },
  { key: 'meeting', fa: 'جلسات', table: 'meetings', titleCol: 'title' },
  { key: 'campaign', fa: 'کمپین‌ها', table: 'campaigns', titleCol: 'title' },
];
function listModules() { return { items: MODULES }; }
function modFa(key) { const m = MODULES.find(m => m.key === key); return m ? m.fa : key; }
function safeParse(s) { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : { nodes: [], edges: [] }; } catch { return { nodes: [], edges: [] }; } }
function entityTitle(module, entityId) {
  const m = MODULES.find(m => m.key === module);
  if (!m || !entityId) return null;
  try { return d().prepare(`SELECT ${m.titleCol} t FROM ${m.table} WHERE id=?`).get(entityId)?.t || null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Engine meta (canvas single source of truth)
// ---------------------------------------------------------------------------
function engineMeta(user) {
  return {
    nodeTypes: Object.entries(eng.NODE_META).map(([k, v]) => ({ type: k, fa: v.fa, color: v.color, ic: v.ic, auto: v.auto, step: v.step })),
    edgeLabels: eng.EDGE_LABELS,
    conditionOps: eng.CONDITION_OPS,
    triggers: eng.TRIGGERS,
    assigneeTypes: eng.ASSIGNEE_TYPES,
    channels: eng.CHANNELS,
    actions: Object.entries(eng.ACTIONS).map(([k, v]) => ({ key: k, fa: v.fa, params: v.params })),
    modules: MODULES,
  };
}

// ---------------------------------------------------------------------------
// Validation (publish gate) — engine's structural validation
// ---------------------------------------------------------------------------
function validateDefinition(user, processId, def) {
  const r = eng.validateDef(def);
  return r;
}

// ---------------------------------------------------------------------------
// Process CRUD (design)
// ---------------------------------------------------------------------------
function listProcesses(user) {
  requirePermWf(user, 'view');
  const d = get();
  const procs = d.prepare('SELECT * FROM wf_processes ORDER BY id').all();
  for (const p of procs) {
    p.module_fa = modFa(p.module);
    p.running = d.prepare("SELECT COUNT(*) c FROM wf_instances WHERE process_id=? AND status IN ('running','waiting','pending')").get(p.id).c;
    p.version_count = d.prepare('SELECT COUNT(*) c FROM wf_versions WHERE process_id=?').get(p.id).c;
    p.total_executions = d.prepare('SELECT COUNT(*) c FROM wf_instances WHERE process_id=?').get(p.id).c;
    p.has_draft = !!(p.draft_definition && p.draft_definition.trim());
  }
  return { items: procs };
}
function getProcess(user, id) {
  requirePermWf(user, 'view');
  const d = get();
  const p = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  p.module_fa = modFa(p.module);
  const versions = d.prepare('SELECT * FROM wf_versions WHERE process_id=? ORDER BY version DESC').all(id).map(v => ({ ...v, definition: safeParse(v.definition) }));
  const running = d.prepare("SELECT COUNT(*) c FROM wf_instances WHERE process_id=? AND status IN ('running','waiting','pending')").get(id).c;
  p.has_draft = !!(p.draft_definition && p.draft_definition.trim());
  p.draft = p.has_draft ? safeParse(p.draft_definition) : null;
  return { process: { ...p, running }, versions };
}
function createProcess(user, body) {
  requireAdmin(user);
  const d = get();
  // default scaffold: start→end (valid minimal flow)
  const def = body.definition || {
    nodes: [{ id: 'start', type: 'start', title: 'شروع', x: 60, y: 200 }, { id: 'end', type: 'end', title: 'پایان', x: 560, y: 200 }],
    edges: [{ from: 'start', to: 'end', label: '' }],
  };
  eng.validateDef(def); // must be structurally valid from day one
  const key = body.key || ('proc_' + Date.now());
  if (d.prepare('SELECT id FROM wf_processes WHERE key=?').get(key)) throw new HttpError(409, 'EXISTS', 'کلید فرآیند تکراری است.');
  const r = d.prepare('INSERT INTO wf_processes(key, name, module, description, trigger_event, trigger_value, active, current_version, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,1,1,?,?,?)')
    .run(key, body.name || 'فرآیند جدید', body.module || 'customer', body.description || '', body.trigger_event || 'created', body.trigger_value || '', user.id, nowIso(), nowIso());
  const pid = Number(r.lastInsertRowid);
  d.prepare('INSERT INTO wf_versions(process_id, version, definition, change_note, active, created_by, created_at) VALUES(?,?,?,?,1,?,?)')
    .run(pid, 1, JSON.stringify(def), body.change_note || 'نسخهٔ اول', user.id, nowIso());
  audit(user, 'workflow', pid, 'create', null, { module: body.module });
  return { id: pid };
}
function saveVersion(user, processId, body) {
  requireAdmin(user);
  const d = get();
  const p = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const def = body.definition;
  const v = eng.validateDef(def);
  if (!v.ok) throw new HttpError(422, 'BAD_DEF', v.errors.join(' | '));
  const note = (typeof body.change_note === 'string' ? body.change_note : '').slice(0, 300) || 'به‌روزرسانی';
  const maxV = d.prepare('SELECT COALESCE(MAX(version),0) m FROM wf_versions WHERE process_id=?').get(processId).m;
  d.transaction(() => {
    d.prepare('UPDATE wf_versions SET active=0 WHERE process_id=? AND active=1').run(processId);
    d.prepare('INSERT INTO wf_versions(process_id, version, definition, change_note, active, created_by, created_at) VALUES(?,?,?,?,1,?,?)')
      .run(processId, maxV + 1, JSON.stringify(def), note, user.id, nowIso());
    d.prepare('UPDATE wf_processes SET current_version=?, updated_by=?, updated_at=?, draft_definition=\'\' WHERE id=?').run(maxV + 1, user.id, nowIso(), processId);
  })();
  if (body.name !== undefined) d.prepare('UPDATE wf_processes SET name=?, description=?, module=?, trigger_event=?, trigger_value=? WHERE id=?')
    .run(body.name || p.name, body.description ?? p.description, body.module || p.module, body.trigger_event || p.trigger_event, body.trigger_value || p.trigger_value, processId);
  audit(user, 'workflow', processId, 'publish', { version: maxV }, { version: maxV + 1, note });
  return { ok: true, version: maxV + 1 };
}
// Draft: separate from the published version — editing a draft NEVER affects
// running executions (they keep their version snapshot).
function saveDraft(user, processId, def) {
  requireAdmin(user);
  const d = get();
  const p = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  if (!def || !Array.isArray(def.nodes)) throw new HttpError(422, 'BAD_DEF', 'تعریف نامعتبر است.');
  d.prepare('UPDATE wf_processes SET draft_definition=?, updated_by=?, updated_at=? WHERE id=?').run(JSON.stringify(def), user.id, nowIso(), processId);
  audit(user, 'workflow', processId, 'save_draft', null, { nodes: def.nodes.length });
  return { ok: true };
}
function getDraft(user, processId) {
  requirePermWf(user, 'view');
  const p = d().prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  return { draft: p.draft_definition ? safeParse(p.draft_definition) : null, has_draft: !!(p.draft_definition && p.draft_definition.trim()) };
}
function validateProcess(user, processId) {
  requirePermWf(user, 'view');
  const p = d().prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const def = (p.draft_definition && p.draft_definition.trim()) ? safeParse(p.draft_definition) : null;
  if (def) return validateDefinition(user, processId, def);
  const v = d().prepare('SELECT definition FROM wf_versions WHERE process_id=? AND active=1 ORDER BY version DESC LIMIT 1').get(processId);
  return validateDefinition(user, processId, v ? safeParse(v.definition) : { nodes: [] });
}
function restoreVersion(user, processId, versionId) {
  requirePermWf(user, 'restore');
  const d = get();
  const p = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const v = d.prepare('SELECT * FROM wf_versions WHERE id=? AND process_id=?').get(versionId, processId);
  if (!v) throw new HttpError(404, 'NOT_FOUND', 'نسخه پیدا نشد.');
  const def = safeParse(v.definition);
  const check = eng.validateDef(def);
  if (!check.ok) throw new HttpError(422, 'BAD_DEF', 'نسخهٔ انتخاب‌شده معتبر نیست: ' + check.errors.join(' | '));
  const maxV = d.prepare('SELECT COALESCE(MAX(version),0) m FROM wf_versions WHERE process_id=?').get(processId).m;
  d.transaction(() => {
    d.prepare('UPDATE wf_versions SET active=0 WHERE process_id=? AND active=1').run(processId);
    d.prepare('INSERT INTO wf_versions(process_id, version, definition, change_note, active, created_by, created_at) VALUES(?,?,?,?,1,?,?)')
      .run(processId, maxV + 1, JSON.stringify(def), 'بازیابی از نسخهٔ ' + v.version, user.id, nowIso());
    d.prepare('UPDATE wf_processes SET current_version=?, updated_by=?, updated_at=? WHERE id=?').run(maxV + 1, user.id, nowIso(), processId);
  })();
  audit(user, 'workflow', processId, 'restore', { from: v.version }, { to: maxV + 1 });
  return { ok: true, version: maxV + 1 };
}
function activateVersion(user, processId, versionId) {
  return restoreVersion(user, processId, versionId); // backward-compatible alias
}
// Delete protection: a workflow with execution history is NOT hard-deleted —
// it is deactivated (Deactivate/Archive) instead.
function deleteProcess(user, id) {
  requirePermWf(user, 'delete');
  const d = get();
  const p = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const hist = d.prepare('SELECT COUNT(*) c FROM wf_instances WHERE process_id=?').get(id).c;
  if (hist > 0) {
    d.prepare('UPDATE wf_processes SET active=0, updated_by=?, updated_at=? WHERE id=?').run(user.id, nowIso(), id);
    audit(user, 'workflow', id, 'archive', null, { executions: hist, reason: 'delete protection — deactivated instead' });
    return { ok: true, archived: true, message: 'این فرآیند تاریخچهٔ اجرا دارد؛ به‌جای حذف، غیرفعال (Archive) شد.' };
  }
  d.prepare('DELETE FROM wf_versions WHERE process_id=?').run(id);
  d.prepare('DELETE FROM wf_processes WHERE id=?').run(id);
  audit(user, 'workflow', id, 'delete', null, null);
  return { ok: true };
}
function toggleProcess(user, id, active) {
  requirePermWf(user, active ? 'activate' : 'deactivate');
  const d = get();
  d.prepare('UPDATE wf_processes SET active=?, updated_by=?, updated_at=? WHERE id=?').run(active ? 1 : 0, user.id, nowIso(), id);
  audit(user, 'workflow', id, active ? 'activate' : 'deactivate', null, null);
  return { ok: true };
}
function duplicateProcess(user, id) {
  requireAdmin(user);
  const d = get();
  const p = d.prepare('SELECT * FROM wf_processes WHERE id=?').get(Number(id));
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const info = d.prepare('INSERT INTO wf_processes(key, name, module, description, trigger_event, trigger_value, active, current_version, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(p.key + '_copy_' + Date.now().toString(36), p.name + ' (کپی)', p.module, p.description + ' — کپی از «' + p.name + '»', p.trigger_event, p.trigger_value, 0, 1, user.id, nowIso(), user.id, nowIso());
  const newId = Number(info.lastInsertRowid);
  const ver = d.prepare('SELECT * FROM wf_versions WHERE process_id=? ORDER BY version DESC LIMIT 1').get(p.id);
  if (ver) d.prepare('INSERT INTO wf_versions(process_id, version, definition, change_note, active, created_by, created_at) VALUES(?,?,?,?,1,?,?)')
    .run(newId, 1, ver.definition, 'کپی از نسخهٔ ' + ver.version, user.id, nowIso());
  audit(user, 'workflow', newId, 'process_duplicate', { source: p.id }, { id: newId }, '');
  return { id: newId, name: p.name + ' (کپی)' };
}

// ---------------------------------------------------------------------------
// Executions (Monitor)
// ---------------------------------------------------------------------------
function executionAsRow(i) {
  const d = get();
  const def = eng.getProcessDef(i.process_id);
  const cur = def ? (def.def.nodes || []).find(n => n.id === i.current_node_id) : null;
  const activeStep = d.prepare("SELECT s.*, u.full_name assignee_name FROM wf_steps s LEFT JOIN users u ON u.id=s.assignee_id WHERE s.instance_id=? AND s.status='active' ORDER BY s.id LIMIT 1").get(i.id);
  return {
    ...i,
    module_fa: modFa(i.module),
    title: entityTitle(i.module, i.entity_id) || i.title,
    current_node_title: cur ? cur.title : (i.status === 'waiting' ? 'در انتظار' : (i.completed_at ? '—' : '—')),
    current_responsible: activeStep ? (activeStep.assignee_name || (activeStep.department ? 'واحد: ' + activeStep.department : '—')) : null,
    active_step_id: activeStep ? activeStep.id : null,
    duration_sec: i.started_at ? Math.max(0, Math.round(((i.completed_at ? new Date(i.completed_at) : new Date()).getTime() - new Date(i.started_at).getTime()) / 1000)) : 0,
  };
}
function listExecutions(user, q) {
  requirePermWf(user, 'monitor');
  const d = get();
  const where = [], params = [];
  if (q.process) { where.push('i.process_id=?'); params.push(Number(q.process)); }
  if (q.status) { where.push('i.status=?'); params.push(String(q.status)); }
  if (q.test !== undefined) { where.push('i.test_mode=?'); params.push(q.test === '1' || q.test === 'true' ? 1 : 0); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const rows = d.prepare(`SELECT i.* FROM wf_instances i ${whereSql} ORDER BY i.id DESC LIMIT 300`).all(...params);
  return { items: rows.map(executionAsRow) };
}
function getExecution(user, id) {
  requirePermWf(user, 'monitor');
  const i = d().prepare('SELECT * FROM wf_instances WHERE id=?').get(id);
  if (!i) throw new HttpError(404, 'NOT_FOUND', 'اجرا پیدا نشد.');
  const full = eng.getInstance(id);
  return { instance: executionAsRow(full), steps: full.steps, logs: full.logs, definition: full.definition };
}
function getExecutionLogs(user, id) {
  requirePermWf(user, 'monitor');
  const i = d().prepare('SELECT * FROM wf_instances WHERE id=?').get(id);
  if (!i) throw new HttpError(404, 'NOT_FOUND', 'اجرا پیدا نشد.');
  return { items: d().prepare('SELECT * FROM wf_logs WHERE execution_id=? ORDER BY id ASC LIMIT 500').all(id) };
}
function retryExecution(user, id) {
  requirePermWf(user, 'execute');
  const d = get();
  const i = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(id);
  if (!i) throw new HttpError(404, 'NOT_FOUND', 'اجرا پیدا نشد.');
  if (!['failed', 'terminated'].includes(i.status)) throw new HttpError(400, 'BAD_STATE', 'فقط اجراهای ناموفق قابل Retry هستند.');
  const def = eng.getProcessDef(i.process_id);
  if (!def) throw new HttpError(400, 'BAD_STATE', 'فرآیند فعال نیست.');
  const node = (def.def.nodes || []).find(n => n.id === i.current_node_id) || (def.def.nodes || []).find(n => n.type === 'start' || n.type === 'trigger');
  d.prepare('UPDATE wf_instances SET status=\'running\', error=\'\', error_at=NULL, attempts=attempts+1, updated_at=? WHERE id=?').run(nowIso(), id);
  if (node) d.prepare('UPDATE wf_instances SET current_node_id=? WHERE id=?').run(node.id, id);
  eng.log(id, 'warn', 'تلاش مجدد (Retry) توسط کاربر', { by: user.username }, node ? node.id : '');
  audit(user, 'workflow', id, 'retry', null, null);
  eng.advance(id).catch(e => eng.log(id, 'error', 'Retry با خطا: ' + e.message));
  return { ok: true };
}
function cancelExecution(user, id) {
  requirePermWf(user, 'execute');
  const d = get();
  const i = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(id);
  if (!i) throw new HttpError(404, 'NOT_FOUND', 'اجرا پیدا نشد.');
  if (!['running', 'waiting', 'pending'].includes(i.status)) throw new HttpError(400, 'BAD_STATE', 'این اجرا در حال اجرا نیست.');
  eng.cancelExecution(user, id, 'لغوشده توسط ' + (user.full_name || user.username));
  return { ok: true };
}
// My tasks — active steps where I am the responsible user (role/department match)
function myTasks(user) {
  const d = get();
  const rows = d.prepare(`SELECT s.* FROM wf_steps s WHERE s.status='active' AND s.parent_id IS NULL AND (
        s.assignee_id=? OR s.assignee_id IS NULL
      ) AND s.instance_id IN (SELECT id FROM wf_instances WHERE status IN ('running','waiting')) ORDER BY s.id DESC LIMIT 100`).all(user.id);
  const items = [];
  for (const s of rows) {
    const i = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(s.instance_id);
    if (!i) continue;
    const def = eng.getProcessDef(i.process_id);
    const node = def ? (def.def.nodes || []).find(n => n.id === s.node_id) : null;
    if (!node) continue;
    if (!eng.canCompleteStep(user, s, node, i)) continue;
    items.push({
      step_id: s.id, execution_id: i.id, node_id: s.node_id,
      node_title: s.node_title, node_type: node.type,
      process_name: def ? def.proc.name : '', module_fa: modFa(i.module),
      record_title: entityTitle(i.module, i.entity_id) || i.title,
      needs_signature: node.type === 'signature',
      started_at: s.started_at,
    });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Step completion (RBAC + signature) — delegates to the engine
// ---------------------------------------------------------------------------
async function completeStep(user, instanceId, stepId, body) {
  return eng.completeStep(user, instanceId, stepId, body);
}
function terminateInstance(user, instanceId) {
  const d = get();
  const i = d.prepare('SELECT * FROM wf_instances WHERE id=?').get(instanceId);
  if (!i) throw new HttpError(404, 'NOT_FOUND', 'اجرا پیدا نشد.');
  requirePermWf(user, 'execute');
  eng.cancelExecution(user, instanceId, 'پایان زودهنگم توسط ' + (user.full_name || user.username));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Manual start + per-entity views (backward-compatible)
// ---------------------------------------------------------------------------
async function startInstance(user, processId, module, entityId) {
  requirePermWf(user, 'execute');
  const mod = MODULES.find(m => m.key === module);
  if (!mod) throw new HttpError(400, 'BAD_MODULE', 'ماژول نامعتبر است.');
  if (!Number.isInteger(Number(entityId))) throw new HttpError(400, 'BAD_ENTITY', 'شناسهٔ رکورد ماژول نامعتبر است.');
  const p = d().prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const row = d().prepare(`SELECT * FROM ${mod.table} WHERE id=?`).get(Number(entityId));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رکورد ماژول پیدا نشد.');
  const title = entityTitle(module, entityId) || (mod.fa + ' #' + entityId);
  const inst = await eng.startExecution({ processId, module, entityId: Number(entityId), actor: user, title });
  return { ok: true, instance: inst ? inst.id : null, status: inst ? inst.status : 'error', execution_no: inst ? inst.execution_no : null };
}
async function startForEntity(user, module, entityId) {
  const d = get();
  const mod = MODULES.find(m => m.key === module);
  if (!mod) return { started: 0 };
  if (!Number.isInteger(Number(entityId))) throw new HttpError(400, 'BAD_ENTITY', 'شناسهٔ رکورد ماژول نامعتبر است.');
  if (!d.prepare(`SELECT 1 FROM ${mod.table} WHERE id=?`).get(Number(entityId))) throw new HttpError(404, 'NOT_FOUND', 'رکورد ماژول پیدا نشد.');
  const procs = d.prepare("SELECT * FROM wf_processes WHERE module=? AND active=1 AND trigger_event='created'").all(module);
  let started = 0;
  for (const p of procs) {
    const title = entityTitle(module, entityId) || (mod.fa + ' #' + entityId);
    try {
      const inst = await eng.startExecution({ processId: p.id, module, entityId: Number(entityId), actor: user, title });
      if (inst && !inst.completed_at) started++;
    } catch (e) { console.error('[wf-start]', e.message); }
  }
  return { started };
}
function listInstances(user, q) {
  return listExecutions(user, q);
}
function getInstance(user, id) {
  return getExecution(user, id);
}
function instanceForEntity(user, module, entityId) {
  requirePermWf(user, 'view');
  const d = get();
  const mod = MODULES.find(m => m.key === module);
  if (!mod) return { items: [] };
  const insts = d.prepare('SELECT * FROM wf_instances WHERE module=? AND entity_id=? ORDER BY id DESC LIMIT 50').all(module, Number(entityId));
  return { items: insts.map(executionAsRow) };
}
function processModuleById(id) { const p = d().prepare('SELECT * FROM wf_processes WHERE id=?').get(id); return p ? p.module : null; }
function scoreForWorkflow(user) {
  const d = get();
  const running = [];
  const insts = d.prepare("SELECT * FROM wf_instances WHERE status IN ('running','waiting','pending')").all();
  for (const i of insts) {
    const def = eng.getProcessDef(i.process_id);
    if (!def) continue;
    const activeSteps = d.prepare("SELECT s.*, u.full_name assignee_name FROM wf_steps s LEFT JOIN users u ON u.id=s.assignee_id WHERE s.instance_id=? AND s.status='active' AND s.parent_id IS NULL").all(i.id);
    for (const s of activeSteps) {
      const node = (def.def.nodes || []).find(n => n.id === s.node_id) || {};
      running.push({
        instance_id: i.id, process: def.proc.name, process_id: i.process_id, module: i.module,
        entity_id: i.entity_id, node: s.node_title || node.title, node_type: node.type,
        assignee: s.assignee_name || (s.department ? 'واحد: ' + s.department : null),
        since: s.started_at, hours: Math.round((Date.now() - new Date(s.started_at).getTime()) / 3600000),
      });
    }
  }
  return { running };
}
// Test Workflow — run against a REAL record in Test Mode: steps/conditions run,
// variables resolve, but real side-effect actions (create/update/send) are NOT
// executed unless live=true is explicitly confirmed.
async function testProcess(user, processId, entityId, live) {
  requirePermWf(user, 'test');
  const p = d().prepare('SELECT * FROM wf_processes WHERE id=?').get(processId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'فرآیند پیدا نشد.');
  const def = (p.draft_definition && p.draft_definition.trim()) ? safeParse(p.draft_definition) : null;
  const v = def ? eng.validateDef(def) : null;
  if (def && v && !v.ok) return { ok: false, errors: v.errors };
  const inst = await eng.startExecution({ processId, module: p.module, entityId: Number(entityId), actor: user, testMode: !live, title: 'تست فرآیند — ' + (entityTitle(p.module, entityId) || entityId) });
  if (!inst) return { ok: false, errors: ['فرآیند فعال/منتشر نشده نیست — ابتدا Publish کنید.'] };
  await new Promise(r => setTimeout(r, 1500)); // let async actions settle
  const full = eng.getInstance(inst.id);
  const trace = (full.logs || []).map(l => ({ level: l.level, message: l.message, at: l.created_at, node: l.node_id }));
  return {
    ok: true, execution_id: inst.id, execution_no: inst.execution_no, status: inst.status,
    current_node: full.current_node_title, trace,
    steps: (full.steps || []).map(s => ({ id: s.id, node: s.node_title, status: s.status, assignee: s.assignee_id || null, result: s.result || '', signed: !!s.signature_path })),
    mode: live ? 'live' : 'test (بدون عملیات واقعی)',
  };
}
// Expose test-mode skip for actions: monkey-free approach — the engine reads
// instance.test_mode; actions honor it via the wrapper below.
// (Actions that mutate real data check `instance.test_mode` at the top of run().)
module.exports = {
  MODULES, modFa, listModules, engineMeta, validateDefinition,
  listProcesses, getProcess, createProcess, saveVersion, saveDraft, getDraft, validateProcess,
  restoreVersion, activateVersion, deleteProcess, toggleProcess, duplicateProcess,
  listInstances, listExecutions, getInstance, getExecution, getExecutionLogs,
  retryExecution, cancelExecution, myTasks,
  startInstance, terminateInstance, instanceForEntity, startForEntity, processModuleById,
  completeStep, scoreForWorkflow, testProcess,
  eng, isSuper, canManage, requireAdmin,
};
