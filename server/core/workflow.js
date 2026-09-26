'use strict';
const { get } = require('../db/db');
const { nowIso } = require('../lib/util');
const { notify, notifyRoles, notifyDepartment } = require('./notify');

// Map a real CRM event to a visual-workflow trigger (module + trigger_event)
function eventToTrigger(event, entityType) {
  if (event === 'payment_created') return { module: 'payment', trigger: 'created' };
  if (event === 'opportunity_stage_changed') return { module: 'opportunity', trigger: 'stage_changed' };
  if (event === 'opportunity_won') return { module: 'opportunity', trigger: 'won' };
  if (event === 'invoice_overdue' || event === 'complaint_sla_breach') return { module: entityType, trigger: 'overdue' };
  const m = String(event).match(/^(.+?)_(created|updated|deleted|approved|rejected|status_changed|overdue|won)$/);
  if (m) return { module: m[1], trigger: m[2] };
  return null;
}
function recordTitle(record) {
  if (!record) return '';
  return record.name || record.number || record.subject || record.title || ('#' + (record.id || ''));
}
// Event bus: dispatch(event, entityType, entityId, record)
// Runs (1) the legacy rule engine (workflow_rules) and (2) the Visual Workflow
// Engine (wf_processes) — both from the SAME real CRM event.
function dispatch(event, entityType, entityId, record) {
  try {
    const rules = get().prepare('SELECT * FROM workflow_rules WHERE active=1 AND event=?').all(event);
    for (const rule of rules) {
      let conds = {}, actions = [];
      try { conds = JSON.parse(rule.conditions || '{}'); } catch {}
      try { actions = JSON.parse(rule.actions || '[]'); } catch {}
      // simple condition match: field equals / gt / gte / lt
      let ok = true;
      for (const k of Object.keys(conds)) {
        const v = record ? record[k] : undefined;
        if (conds[k].__eq !== undefined && v !== conds[k].__eq) ok = false;
        if (conds[k].__gt !== undefined && !(v > conds[k].__gt)) ok = false;
        if (conds[k].__gte !== undefined && !(v >= conds[k].__gte)) ok = false;
        if (conds[k].__lt !== undefined && !(v < conds[k].__lt)) ok = false;
        if (conds[k].__lt !== undefined && v === undefined) ok = false;
      }
      if (!ok) continue;
      const results = [];
      for (const a of actions) {
        const r = runAction(a, record, userIdOf(record), entityType, entityId);
        if (r) results.push(r);
      }
      get().prepare('INSERT INTO workflow_runs(rule_id, event, entity_type, entity_id, result, created_at) VALUES(?,?,?,?,?,?)')
        .run(rule.id, event, entityType, entityId, JSON.stringify(results), nowIso());
    }
  } catch (e) {
    console.error('[workflow]', e.message);
  }
  // (2) Visual Workflow Engine — published wf_processes matching this real event
  try {
    const map = eventToTrigger(event, entityType);
    if (map) {
      const wfEngine = require('./workflow-engine');
      const procs = get().prepare('SELECT * FROM wf_processes WHERE module=? AND trigger_event=? AND active=1').all(map.module, map.trigger);
      const actorId = record ? (record.created_by || record.updated_by || record.salesperson_id || record.assignee_id || record.user_id || record.organizer_id) || null : null;
      const actor = actorId ? get().prepare('SELECT * FROM users WHERE id=? AND active=1').get(Number(actorId)) : null;
      for (const p of procs) {
        try {
          wfEngine.startExecution({ processId: p.id, module: map.module, entityId: Number(entityId), actor, title: recordTitle(record) })
            .catch(e => console.error('[wf-engine]', e.message));
        } catch (e) { console.error('[wf-engine]', e.message); }
      }
      // named wait nodes listening for this event
      if (map.trigger !== 'created') { try { wfEngine.emitWaitEvent(event, record); } catch {} }
    }
  } catch (e) {
    console.error('[wf-engine]', e.message);
  }
}
function userIdOf(record) { return record ? (record.created_by || record.assigned_to || record.assignee_id || record.salesperson_id || null) : null; }
// resolve the assignee: explicit user_id wins; role → active user of that role (prefer
// the record's salesperson if they hold the role, else first active user); fallback actorId.
function resolveUser(a, actorId, d) {
  if (a && a.user_id) return Number(a.user_id);
  if (a && a.role) {
    const cand = d.prepare('SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name=? AND u.active=1 ORDER BY u.id').all(a.role).map(x => x.id);
    if (cand.length) {
      if (actorId && cand.includes(Number(actorId))) return Number(actorId);
      return cand[0];
    }
  }
  return actorId || 0;
}
function entityTypeOf(record) {
  if (!record) return null;
  if (record.customer_id !== undefined && record.id !== undefined) return 'customer';
  return null;
}
function offsetDue(dueDays, dueAt) {
  if (dueDays) { const t = new Date(Date.now() + Number(dueDays) * 86400000); return t.toISOString(); }
  if (dueAt) return dueAt;
  return null;
}
function runAction(a, record, actorId, entityType, entityId) {
  const d = get();
  try {
    switch (a.type) {
      case 'notify': {
        const uids = (a.user_ids || []).concat(
          (a.roles || []).map(r => (d.prepare('SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name=? AND u.active=1').get(r) || {}).id).filter(Boolean)
        );
        for (const uid of new Set(uids)) notify(uid, 'workflow', a.title || 'اعلان سیستم', a.body || '', a.ref_type || '', a.ref_id || null);
        return { notified: [...new Set(uids)] };
      }
      case 'notify_roles': {
        notifyRoles(a.roles || [], 'workflow', a.title || 'اعلان سیستم', a.body || '', a.ref_type || '', a.ref_id || null);
        return { roles: a.roles };
      }
      case 'notify_department': {
        notifyDepartment(a.department, 'workflow', a.title || 'اعلان سیستم', a.body || '', a.ref_type || '', a.ref_id || null);
        return { department: a.department };
      }
      case 'create_followup': {
        const who = resolveUser(a, actorId, d) || 0;
        const et = a.entity_type || (entityTypeOf(record) || entityType || 'other');
        const eid = a.entity_id || entityId || (record && record.customer_id) || 0;
        const due = offsetDue(a.due_days, a.due_at);
        d.prepare('INSERT INTO followups(entity_type, entity_id, user_id, subject, note, due_at, status) VALUES(?,?,?,?,?,?,?)')
          .run(et, eid, who, a.subject || 'پیگیری خودکار', a.note || '', due, 'pending');
        return { followup: true, entity_type: et, entity_id: eid };
      }
      case 'create_task': {
        const who = resolveUser(a, actorId, d) || 0;
        const rt = a.related_type || (entityTypeOf(record) || entityType || '');
        const rid = a.related_id || entityId || (record && record.customer_id) || 0;
        d.prepare('INSERT INTO tasks(title, description, assignee_id, related_type, related_id, priority, status, due_at, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(a.title || 'وظیفه خودکار', a.description || '', who, rt, rid, a.priority || 'medium', 'open', offsetDue(a.due_days, a.due_at) || null, actorId || 0, nowIso(), actorId || 0, nowIso());
        return { task: true, assignee: who, related: rt + ':' + rid };
      }
      case 'log':
        return { logged: a.message };
      default:
        return null;
    }
  } catch (e) {
    return { error: e.message };
  }
}
module.exports = { dispatch };
