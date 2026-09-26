'use strict';
// ============ Bulk Edit (Section 4) ============
// Controlled multi-record editing:
//   - dedicated permission `bulk_edit:edit` (enforced server-side ONLY) + the
//     normal entity `edit` permission + per-row scope (IDOR-safe)
//   - explicit field ALLOWLIST (identity/system/financial/ownership fields blocked)
//   - per-record validation through the same engine as single-record update
//   - Preview (dry run) before Apply; No-op records are never updated/audited
//   - All-or-Nothing transaction: any hard error → full rollback, no partial writes
//   - Audit: one BULK_EDIT row per changed record (before/after + bulk_op_id)
//     + one BULK_EDIT_SUMMARY row; denied attempts logged via requirePerm
//     (permission_denied) — all in the immutable audit_logs table.
const { get, addActivity } = require('../../db/db');
const { requirePerm } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { R } = require('../resources');
const generic = require('../generic');
const { HttpError } = require('../../lib/http');
const { nowIso, parseId, toEnDigits } = require('../../lib/util');

const MAX_RECORDS = 500; // sane cap: one short transaction, no long locks

// Never bulk-editable, in any resource: identity/system, Section-3 price chain,
// stock & financial workflow fields, credentials.
const GLOBAL_BLOCKED = new Set([
  'id', 'number', 'code', 'sku',
  'created_by', 'created_at', 'updated_by', 'updated_at', 'version', 'archived_at',
  // Section 3 — Price Override chain (bulk edit must never bypass price_override)
  'price', 'base_price', 'override_status', 'override_reason', 'price_list_id',
  'discount_pct', 'tax_rate',
  // stock / order-quantity workflow fields
  'stock_qty', 'reserved_qty', 'reorder_point', 'max_stock', 'min_order',
  // credentials / auth
  'password_hash', 'totp_secret', 'totp_enabled', 'must_change_password',
]);
// Per-entity additional blocks: ownership/scope, lifecycle status, financial
// values, dates managed by pickers/workflows. (Only fields that survive the
// type filter — text/email/textarea/select/number — are affected.)
const ENTITY_BLOCKED = {
  customer: new Set(['status', 'credit_status', 'credit_limit', 'credit_used', 'payment_terms', 'payment_terms_note', 'salesperson_id', 'representative_id', 'churn_score']),
  product: new Set(['active', 'is_raw_material', 'price_retail', 'price_wholesale', 'price_export', 'price_cost']),
  lead: new Set(['status', 'score', 'estimated_value', 'customer_id', 'salesperson_id']),
  opportunity: new Set(['status', 'stage_id', 'probability', 'amount', 'customer_id', 'salesperson_id', 'quote_id', 'lost_reason']),
  quote: new Set(['status', 'valid_until', 'salesperson_id', 'customer_id', 'currency', 'shipping', 'subtotal', 'total']),
  order: new Set(['status', 'salesperson_id', 'customer_id', 'due_date', 'delivery_date', 'total']),
  invoice: new Set(['status', 'tax_system_status', 'customer_id', 'due_date', 'issue_date', 'subtotal', 'discount', 'tax', 'shipping', 'paid_amount', 'total', 'currency']),
  payment: new Set(['status', 'amount', 'paid_at', 'reference', 'check_info', 'customer_id', 'invoice_id', 'received_by']),
  complaint: new Set(['status', 'priority', 'assigned_to', 'sentiment_score', 'ai_category', 'ai_root_cause', 'sla_hours', 'due_at', 'resolved_at', 'csat', 'repeat_of', 'customer_id', 'product_id']),
  ticket: new Set(['status', 'priority', 'assigned_to', 'csat', 'sla_due_at', 'resolved_at', 'customer_id', 'related_complaint_id']),
  task: new Set(['status', 'priority', 'assignee_id', 'completed_at', 'related_type', 'related_id']),
  meeting: new Set(['status', 'organizer_id', 'customer_id', 'contact_id', 'participant_ids', 'reminder_minutes']),
  followup: new Set(['status', 'user_id', 'entity_type', 'entity_id', 'due_at', 'done_at']),
  campaign: new Set(['status', 'audience_filter', 'total', 'sent_count', 'delivered_count', 'opened_count', 'clicked_count', 'converted_count', 'error']),
  price_list: new Set(['active', 'is_default', 'currency', 'valid_from', 'valid_until']),
  supplier: new Set(['quality_rating', 'delivery_rating', 'price_rating']),
  stock_alert: new Set(['level', 'message', 'created_at', 'resolved_at', 'product_id']),
  lab_request: new Set(['status', 'priority', 'requestor', 'customer_id', 'order_id', 'product_id', 'received_at', 'due_at', 'analyst_id']),
  lab_result: new Set(['status', 'spec_text', 'test_date', 'request_id', 'analyst']),
  warranty: new Set(['status', 'customer_id', 'order_id', 'start_date', 'end_date']),
  contract: new Set(['status', 'value', 'customer_id', 'supplier_id', 'start_date', 'end_date', 'file']),
};

// Allowlist: plain business fields (text/email/textarea/select/number), not
// readonly, not in the blocked sets. Ref fields are excluded by design
// (ownership/assignment/scoping changes need the single-record form).
function bulkFieldsFor(resKey) {
  const r = R[resKey];
  if (!r || !Array.isArray(r.fields)) return [];
  const blocked = ENTITY_BLOCKED[r.entity] || new Set();
  return r.fields.filter(f =>
    f.key !== 'id' && !f.readonly &&
    ['text', 'email', 'textarea', 'select', 'number'].includes(f.type) &&
    !GLOBAL_BLOCKED.has(f.key) && !blocked.has(f.key)
  );
}

function normIds(rawIds) {
  if (!Array.isArray(rawIds)) throw new HttpError(422, 'VALIDATION', 'فهرست رکوردها معتبر نیست.');
  const seen = new Set();
  const out = [];
  for (const raw of rawIds) {
    const n = parseId(raw);
    if (n === null || n <= 0) throw new HttpError(422, 'VALIDATION', 'شناسهٔ رکورد نامعتبر است.');
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  if (!out.length) throw new HttpError(422, 'VALIDATION', 'رکوردی برای ویرایش انتخاب نشده است.');
  if (out.length > MAX_RECORDS) throw new HttpError(422, 'VALIDATION', `حداکثر ${MAX_RECORDS} رکورد در هر عملیات مجاز است.`);
  return out;
}

// Validate the single new value once (same engine as single-record update).
function validateValue(resKey, r, field, value) {
  const fieldDef = (r.fields || []).find(f => f.key === field);
  if (!fieldDef) throw new HttpError(422, 'VALIDATION', 'فیلد ارسال‌شده برای این ماژول وجود ندارد.');
  const allowed = bulkFieldsFor(resKey);
  if (!allowed.some(f => f.key === field)) {
    throw new HttpError(422, 'NOT_ALLOWED', 'این فیلد قابل ویرایش گروهی نیست (فیلدهای حساس/مالکیت/قیمتی محافظت‌شده‌اند).');
  }
  if (value === '' || value === null || value === undefined) {
    if (fieldDef.required) throw new HttpError(422, 'VALIDATION', `فیلد «${fieldDef.label}» الزامی است و نمی‌تواند خالی شود.`);
    return null; // clearing an optional field
  }
  // strict type gate for bulk: the generic engine silently coerces garbage text
  // to 0 for number fields — acceptable for single-record forms, NOT for bulk
  // (a typo would silently zero out many records). Reject non-numeric values.
  if (fieldDef.type === 'number') {
    const cleaned = toEnDigits(String(value)).replace(/[^\d.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.' || isNaN(Number(cleaned))) {
      throw new HttpError(422, 'VALIDATION', `فیلد «${fieldDef.label}» باید عدد باشد.`);
    }
  }
  const { errors, out } = generic.validate(r, { [field]: value }, true);
  if (errors.length) throw new HttpError(422, 'VALIDATION', errors.join(' '));
  return out[field];
}

// Per-record dry run: fetch (one query), scope-check each row (IDOR), compare.
// No writes. Throws on missing record / out-of-scope row / invalid value.
function planOperation(user, r, resKey, ids, field, newValue) {
  const d = get();
  const rows = d.prepare(`SELECT * FROM ${r.table} WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = new Map(rows.map(x => [x.id, x]));
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) throw new HttpError(404, 'NOT_FOUND', `برخی رکوردها پیدا نشدند: ${missing.join(', ')}`);
  const fieldDef = r.fields.find(f => f.key === field);
  const plan = [];
  for (const id of ids) {
    const row = byId.get(id);
    generic.assertRowScope(r, user, row, 'edit'); // entity:edit + row scope (IDOR)
    const before = row[field];
    const changed = JSON.stringify(before) !== JSON.stringify(newValue);
    plan.push({
      id,
      label: row.number || row.code || row.name || row.title || ('#' + id),
      before: before === null || before === undefined ? '' : before,
      after: newValue,
      changed,
    });
  }
  return { plan, fieldDef };
}

function bulkPreview(user, resKey, rawIds, field, value) {
  const r = R[resKey];
  if (!r || !r.table) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
  requirePerm(user, 'bulk_edit', 'edit');
  const ids = normIds(rawIds);
  const newValue = validateValue(resKey, r, field, value);
  const { plan, fieldDef } = planOperation(user, r, resKey, ids, field, newValue);
  return {
    ok: true,
    preview: true,
    resource: r.entity,
    field,
    field_label: fieldDef.label,
    new_value: newValue,
    total_selected: plan.length,
    will_change: plan.filter(p => p.changed).length,
    no_change: plan.filter(p => !p.changed).length,
    rows: plan,
  };
}

function bulkApply(user, ipAddr, resKey, rawIds, field, value) {
  const r = R[resKey];
  if (!r || !r.table) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
  requirePerm(user, 'bulk_edit', 'edit'); // dedicated permission → 403 + permission_denied audit
  const ids = normIds(rawIds);
  const newValue = validateValue(resKey, r, field, value);
  const { plan, fieldDef } = planOperation(user, r, resKey, ids, field, newValue);
  const toChange = plan.filter(p => p.changed);
  const opId = 'BULK-' + r.entity.toUpperCase() + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  if (!toChange.length) {
    // No-op: nothing to update → no writes and NO audit (per spec)
    return { ok: true, operation_id: opId, changed: 0, no_change: plan.length, total: ids.length, rows: [] };
  }
  const d = get();
  const cols = generic.allCols(r.table).map(c => c.name);
  let setSql = `${field}=?`;
  if (cols.includes('version')) setSql += ', version=version+1';
  if (cols.includes('updated_at')) setSql += ', updated_at=?';
  if (cols.includes('updated_by')) setSql += ', updated_by=?';
  const tx = d.transaction(() => {
    const upd = d.prepare(`UPDATE ${r.table} SET ${setSql} WHERE id=?`);
    for (const p of toChange) {
      const args = [newValue];
      if (cols.includes('updated_at')) args.push(nowIso());
      if (cols.includes('updated_by')) args.push(user.id);
      args.push(p.id);
      upd.run(...args);
      addActivity(r.entity, p.id, user.id, 'update', `ویرایش گروهی: ${fieldDef.label}`);
      audit(user, r.entity, p.id, 'BULK_EDIT',
        { [field]: p.before },
        { [field]: p.after, bulk_op_id: opId, operation_total: toChange.length, record: p.label },
        ipAddr || '');
    }
  });
  tx();
  audit(user, r.entity, 0, 'BULK_EDIT_SUMMARY',
    null,
    { bulk_op_id: opId, resource: r.entity, field, field_label: fieldDef.label, new_value: newValue, total_requested: ids.length, changed: toChange.length, no_change: plan.length - toChange.length, result: 'success' },
    ipAddr || '');
  return { ok: true, operation_id: opId, changed: toChange.length, no_change: plan.length - toChange.length, total: ids.length, rows: toChange };
}

// ============ Bulk Delete ============
// Controlled multi-record hard deletion:
//   - dedicated permission `bulk_delete:delete` (server-enforced, 403 + audit)
//     PLUS the normal entity `delete` permission PLUS per-row scope (IDOR-safe)
//   - All-or-Nothing: if ANY selected record has dependent child rows, NOTHING
//     is deleted and the exact blocked records + reasons are returned (409),
//     so FK/relationship integrity can never be broken by a bulk operation.
//   - Leaf records (no known dependents) are hard-deleted in one transaction,
//     each audited (BULK_DELETE) + one BULK_DELETE_SUMMARY row.
//   - No soft-delete pretence: rows are really removed from the database.

// Known hard/dependent child references per entity (column-name based; the
// schema does not declare most FKs, so we check the actual referencing rows).
const CHILD_TABLES = {
  customer: [
    ['customer_contacts', 'customer_id'], ['leads', 'customer_id'], ['opportunities', 'customer_id'],
    ['quotes', 'customer_id'], ['orders', 'customer_id'], ['invoices', 'customer_id'],
    ['payments', 'customer_id'], ['lab_requests', 'customer_id'], ['complaints', 'customer_id'],
    ['tickets', 'customer_id'], ['warranties', 'customer_id'], ['contracts', 'customer_id'],
    ['campaign_recipients', 'customer_id'], ['loyalty_accounts', 'customer_id'],
    ['loyalty_transactions', 'customer_id'], ['meetings', 'customer_id'],
    ['calendar_events', 'customer_id'], ['commissions', 'customer_id'],
    ['price_list_items', 'customer_id'], ['voip_calls', 'customer_id'], ['customer_messages', 'customer_id'],
  ],
  product: [
    ['quote_items', 'product_id'], ['order_items', 'product_id'], ['invoice_items', 'product_id'],
    ['opportunity_items', 'product_id'], ['po_items', 'product_id'],
    ['stock_transactions', 'product_id'], ['stock_alerts', 'product_id'],
    ['complaints', 'product_id'], ['price_list_items', 'product_id'],
  ],
  quote: [['orders', 'quote_id']],
  order: [['invoices', 'order_id'], ['warranties', 'order_id']],
  invoice: [['payments', 'invoice_id'], ['invoice_items', 'invoice_id'], ['commissions', 'invoice_id']],
  complaint: [['complaint_events', 'complaint_id'], ['tickets', 'related_complaint_id'], ['complaints', 'repeat_of']],
  campaign: [['campaign_recipients', 'campaign_id']],
  supplier: [['purchase_orders', 'supplier_id']],
  purchase_order: [['po_items', 'po_id']],
  lab_request: [['lab_results', 'request_id']],
  price_list: [['price_list_items', 'price_list_id']],
  tag: [['entity_tags', 'tag_id']],
};
function pickLabel(r, row) {
  const cols = generic.allCols(r.table).map(c => c.name);
  for (const c of ['number', 'name', 'title', 'subject', 'company', 'code']) {
    if (cols.includes(c) && row[c] !== null && row[c] !== undefined && row[c] !== '') return String(row[c]);
  }
  return '#' + row.id;
}
function dependentCounts(d, entity, id) {
  const out = [];
  for (const [table, col] of CHILD_TABLES[entity] || []) {
    try {
      const c = d.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${col}=?`).get(id).c;
      if (c > 0) out.push({ table, count: c });
    } catch { /* table may not exist */ }
  }
  return out;
}
function normDeleteIds(rawIds) {
  if (!Array.isArray(rawIds)) throw new HttpError(422, 'VALIDATION', 'فهرست شناسه‌ها لازم است.');
  const ids = rawIds.map(x => Number(x)).filter(x => Number.isInteger(x) && x > 0);
  const uniq = [...new Set(ids)];
  if (!uniq.length) throw new HttpError(422, 'VALIDATION', 'رکوردی انتخاب نشده است.');
  if (uniq.length > MAX_RECORDS) throw new HttpError(422, 'TOO_MANY', 'حداکثر ' + MAX_RECORDS + ' رکورد.');
  return uniq;
}
function bulkDeletePreview(user, resKey, rawIds) {
  const r = R[resKey];
  if (!r || !r.table) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
  requirePerm(user, 'bulk_delete', 'delete');
  const ids = normDeleteIds(rawIds);
  const d = get();
  const rows = [];
  for (const id of ids) {
    const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
    if (!row) { rows.push({ id, found: false, label: '#' + id, blocked: [], deps: [] }); continue; }
    generic.assertRowScope(r, user, row, 'delete');
    const deps = dependentCounts(d, r.entity, id);
    rows.push({ id, found: true, label: pickLabel(r, row), blocked: deps.length > 0, deps });
  }
  return { total: ids.length, deletable: rows.filter(x => x.found && !x.blocked).length, blocked: rows.filter(x => x.blocked).length, not_found: rows.filter(x => !x.found).length, rows };
}
function bulkDeleteApply(user, ipAddr, resKey, rawIds, confirm) {
  const r = R[resKey];
  if (!r || !r.table) throw new HttpError(404, 'NOT_FOUND', 'ماژول پیدا نشد.');
  requirePerm(user, 'bulk_delete', 'delete');
  if (confirm !== true) throw new HttpError(422, 'VALIDATION', 'تأیید نهایی (confirm) لازم است.');
  const ids = normDeleteIds(rawIds);
  const d = get();
  const plan = [];
  for (const id of ids) {
    const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'رکورد #' + id + ' پیدا نشد.');
    generic.assertRowScope(r, user, row, 'delete');
    const deps = dependentCounts(d, r.entity, id);
    plan.push({ id, label: pickLabel(r, row), deps });
  }
  const blocked = plan.filter(p => p.deps.length > 0);
  if (blocked.length) {
    // All-or-Nothing: nothing deleted; report exactly what is in the way.
    audit(user, r.entity, 0, 'BULK_DELETE_BLOCKED', null, { resource: r.entity, total: ids.length, blocked: blocked.length }, ipAddr || '');
    throw new HttpError(409, 'DEPENDENTS', 'برخی رکوردها به اطلاعات دیگر وابسته‌اند و نمی‌توانند حذف شوند.', {
      total: ids.length, deletable: plan.length - blocked.length, blocked,
    });
  }
  const opId = 'BULKDEL-' + r.entity.toUpperCase() + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const tx = d.transaction(() => {
    const del = d.prepare(`DELETE FROM ${r.table} WHERE id=?`);
    for (const p of plan) {
      del.run(p.id);
      addActivity(r.entity, p.id, user.id, 'delete', 'حذف گروهی');
      audit(user, r.entity, p.id, 'BULK_DELETE', { label: p.label }, { bulk_op_id: opId, operation_total: plan.length, record: p.label }, ipAddr || '');
    }
  });
  tx();
  audit(user, r.entity, 0, 'BULK_DELETE_SUMMARY', null,
    { bulk_op_id: opId, resource: r.entity, total: plan.length, deleted: plan.length, result: 'success' }, ipAddr || '');
  return { ok: true, operation_id: opId, deleted: plan.length, total: ids.length, rows: plan };
}

module.exports = { bulkPreview, bulkApply, bulkDeletePreview, bulkDeleteApply, bulkFieldsFor, GLOBAL_BLOCKED, ENTITY_BLOCKED, MAX_RECORDS, CHILD_TABLES };
