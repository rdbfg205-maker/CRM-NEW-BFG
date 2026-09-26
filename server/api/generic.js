'use strict';
const XLSX = require('xlsx');
const { get, nextNumber, addActivity, searchIndex, searchRemove } = require('../db/db');
const jalaliLib = require('../lib/jalali-vendor.js');
const { requirePerm, scopeWhere, PERM_ACTIONS } = require('../auth/auth');
const { audit } = require('../core/audit');
const { dispatch } = require('../core/workflow');
const { HttpError } = require('../lib/http');
const { R, resolveOptions } = require('./resources');
const { nowIso, normalizeFa, nameSimilarity, likeEscape, parseId, toEnDigits, fmtDate } = require('../lib/util');

function res_(key) { return R[key]; }
function colList(r) { return Object.keys(r.table ? allCols(r.table) : {}); }
const colCache = {};
// never leak credential-looking columns that are not declared resource fields
// (e.g. customers.portal_password_hash) — expose a safe boolean instead
function sanitizeRow(row, r) {
  if (!row) return row;
  const known = new Set(r.fields.map(f => f.key));
  for (const k of Object.keys(row)) {
    if (!known.has(k) && /password_hash|password|secret|_token\b/i.test(k)) {
      if (k === 'portal_password_hash') row.portal_has_password = !!row[k];
      delete row[k];
    }
  }
  return row;
}
function allCols(table) {
  if (colCache[table]) return colCache[table];
  const info = get().prepare(`PRAGMA table_info(${table})`).all();
  colCache[table] = info;
  return info;
}
// refs in the registry use resource keys (customer); SQL needs the table name (customers)
let _refTableCache = null;
function refTable(refKey) {
  if (!refKey) return refKey;
  if (!_refTableCache) {
    _refTableCache = {};
    const { R } = require('./resources');
    for (const [k, v] of Object.entries(R)) if (v.table) _refTableCache[k] = v.table;
  }
  return _refTableCache[refKey] || refKey; // fallback: legacy table-name refs (e.g. users)
}
function pickNameCol(table) {
  const cols = allCols(table).map(c => c.name);
  for (const c of ['full_name', 'name', 'title', 'subject', 'number', 'code']) if (cols.includes(c)) return c;
  return 'id';
}
// ---------- date/time normalization (server-side gate for picker values) ----------
// Accepts ISO (from the Jalali picker) or a Jalali/English-digit string; returns strict
// ISO or null. Range-guarded (1990–2100) to reject garbage.
function normalizeDateTimeInput(v, type) {
  if (v === undefined || v === null || v === '') return null;
  let s = String(v).trim();
  if (!s) return null;
  // picker output is ISO (…Z / .sssZ) — normalize before matching
  s = s.replace(/\.\d{1,6}Z?$/i, '').replace(/Z$/i, '');
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const mo = Number(m[2]), da = Number(m[3]), hh = Number(m[4] || 0), mi = Number(m[5] || 0), ss = Number(m[6] || 0);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  if (hh > 23 || mi > 59 || ss > 59) return null;
  let year = Number(m[1]);
  let d = null;
  if (year >= 1200 && year < 2000) {
    // Canonical Jalali month lengths (vendor monthLength is unreliable at Mehr/Esfand boundary):
    // months 1-6: 31 · 7-11: 30 · Esfand: leap ? 30 : 29
    const maxDay = mo <= 6 ? 31 : (mo === 12 ? (jalaliLib.isLeapJalaaliYear(year) ? 30 : 29) : 30);
    if (da > maxDay) return null;
    const g = jalaliLib.toGregorian(year, mo, da);
    if (!g || g.gy < 1990 || g.gy > 2100) return null;
    // build from Gregorian components in UTC so the wall-clock date is
    // preserved regardless of the server's local timezone
    d = new Date(Date.UTC(g.gy, g.gm - 1, g.gd, hh, mi, ss));
  } else if (year >= 1900 && year < 2200) {
    d = new Date(Date.UTC(year, mo - 1, da, hh, mi, ss));
    // Gregorian rollover check (rejects 2026-13-45, 2026-02-30, …)
    if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== mo || d.getUTCDate() !== da) return null;
  }
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1990 || y > 2100) return null;
  if (type === 'date') {
    // date-only: format the calendar date directly from components (timezone-independent;
    // toISOString() would shift it a day on servers east of UTC, e.g. Asia/Tehran)
    return y + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  return d.toISOString();
}
// ---------- validation ----------
function validate(r, data, isEdit = false) {
  const errors = [];
  const out = {};
  for (const f of r.fields) {
    if (f.type === 'json') {
      if (data[f.key] !== undefined) {
        if (typeof data[f.key] === 'string') {
          try { data[f.key] = JSON.parse(data[f.key]); } catch { errors.push(f.label + ' باید JSON معتبر باشد.'); data[f.key] = null; }
        }
        out[f.key] = data[f.key];
      }
      continue;
    }
    const v = data[f.key];
    if (v === undefined) {
      if (f.required && !isEdit) errors.push(f.label + ' الزامی است.');
      continue;
    }
    if (v === null || v === '') {
      if (f.required) { errors.push(f.label + (v === '' ? ' نمی‌تواند خالی باشد.' : ' الزامی است.')); }
      out[f.key] = f.type === 'number' || f.type === 'money' ? null : (f.type === 'bool' ? 0 : v);
      continue;
    }
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(toEnDigits(String(v)).replace(/[^\d.-]/g, ''));
      if (isNaN(n)) { errors.push(f.label + ' باید عدد باشد.'); continue; }
      out[f.key] = n;
    } else if (f.type === 'bool') {
      out[f.key] = v ? 1 : 0;
    } else if (f.type === 'select') {
      const opts = resolveOptions(f.options);
      if (opts.length && !opts.some(o => (typeof o === 'object' ? o.v : o) === v)) { errors.push(f.label + ': مقدار نامعتبر است.'); continue; }
      out[f.key] = v;
    } else if (f.type === 'ref') {
      const n = parseId(v);
      if (n === null) {
        // non-empty but not a valid ID (string mismatch / garbage) — reject, don't null it
        errors.push(f.label + ': مقدار شناسه نامعتبر است.');
        continue;
      }
      // 0 is this codebase's "no reference" sentinel (e.g. addPayment stores
      // invoice_id=0 for a standalone receipt, and queries filter on `invoice_id>0`).
      // SQLite rowids start at 1, so 0 can never be a real row — treating it as a
      // lookup miss made «کپی» (duplicate) and edit fail with a bogus 422 on any
      // record carrying an unset optional reference.
      if (n === 0) {
        if (f.required) { errors.push(f.label + ' الزامی است.'); continue; }
        out[f.key] = null;
        continue;
      }
      const exists = get().prepare(`SELECT id FROM ${refTable(f.ref)} WHERE id=?`).get(n);
      if (!exists) { errors.push(f.label + ': مورد انتخاب‌شده پیدا نشد.'); continue; }
      out[f.key] = n;
    } else if (f.type === 'email') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) { errors.push(f.label + ' نامعتبر است.'); continue; }
      out[f.key] = String(v).trim();
    } else if (f.type === 'date' || f.type === 'datetime') {
      // server-side date gate: only real calendar values (Jalali picker output = ISO;
      // ISO accepted too) — manual/garbage text is rejected, never stored
      const iso = normalizeDateTimeInput(v, f.type);
      if (iso === null) { errors.push(f.label + ' نامعتبر است (فقط از تقویم انتخاب کنید).'); continue; }
      out[f.key] = iso;
    } else {
      const s = String(v).trim();
      if (s.length > 2000) { errors.push(f.label + ' بیش از حد مجاز است.'); continue; }
      out[f.key] = s;
    }
  }
  return { errors, out };
}
// ---------- duplicate detection ----------
function findDuplicates(r, data, excludeId = null) {
  if (!r.dupFields) return [];
  const d = get();
  const dups = [];
  for (const f of r.dupFields) {
    const v = data[f];
    if (v === null || v === undefined || v === '') continue;
    const keyCol = f === 'name' ? 'name' : (r.table === 'leads' && f === 'company' ? 'company' : f);
    const col = allCols(r.table).find(c => c.name === keyCol);
    if (!col) continue;
    let rows;
    if (f === 'name') {
      rows = d.prepare(`SELECT id, name FROM ${r.table} WHERE archived_at IS NULL AND id != ? ORDER BY id DESC LIMIT 50`).get ? [] : [];
      // name similarity
      const cand = d.prepare(`SELECT id, name FROM ${r.table} WHERE archived_at IS NULL AND id != ? LIMIT 500`).all(excludeId || 0);
      rows = cand.filter(c => nameSimilarity(c.name, v) >= 0.75).slice(0, 3).map(c => ({ id: c.id, name: c.name }));
    } else {
      rows = d.prepare(`SELECT id FROM ${r.table} WHERE archived_at IS NULL AND ${keyCol} = ? AND id != ? LIMIT 3`).all(String(v).trim(), excludeId || 0);
    }
    for (const row of rows) {
      if (!dups.some(x => x.id === row.id)) dups.push({ id: row.id, field: f, label: r.fields.find(x => x.key === f)?.label || f });
    }
  }
  // dedupe
  const seen = new Set();
  return dups.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
// ---------- scoping ----------
function scopeClause(r, user) {
  const p = requirePerm(user, r.entity, 'view');
  const field = r.scopeField && allCols(r.table).some(c => c.name === r.scopeField) ? r.scopeField : (r.scopeFallback || null);
  const sc = scopeWhere(r.entity, user, p, field);
  return sc;
}
// Row-level authorization (IDOR protection): the row must fall inside the
// user's scope for the action being performed. Same semantics as list/show.
function assertRowScope(r, user, row, action) {
  const scope = requirePerm(user, r.entity, action);
  if (scope === 'all') return scope;
  const field = r.scopeField && allCols(r.table).some(c => c.name === r.scopeField) ? r.scopeField : (r.scopeFallback || null);
  const sc = scopeWhere(r.entity, user, scope, field);
  if (sc.where) {
    const d = get();
    const ok = d.prepare(`SELECT 1 FROM ${r.table} WHERE id=? AND ${sc.where}`).get(row.id, ...sc.params);
    if (!ok) throw new HttpError(403, 'FORBIDDEN', 'دسترسی به این رکورد ندارید.');
  }
  return scope;
}
// shared WHERE builder for list + export (search, f_* filters, scope, archive)
function buildWhere(r, user, q) {
  const where = ['1=1'];
  const params = [];
  const hasArch = allCols(r.table).some(c => c.name === 'archived_at');
  if (hasArch) where.push('archived_at IS NULL');
  const sc = scopeClause(r, user);
  if (sc.where) { where.push(sc.where); params.push(...sc.params); }
  // search (server-side, over searchFields; LIKE metacharacters escaped)
  if (q.q) {
    const term = '%' + likeEscape(normalizeFa(q.q).replace(/\s+/g, ' ')) + '%';
    const cols = allCols(r.table).map(c => c.name);
    // Keep only targets that can really be searched: a real column of this table, or a
    // correlated subquery written into the registry (starts with '('). Blindly falling
    // back to 'name' used to 500 on tables that have no name column (payments, tasks,
    // followups, warranties, purchase_orders) — the list/export search box broke there.
    const targets = (r.searchFields || ['name']).filter(f => f.startsWith('(') || cols.includes(f));
    if (targets.length) {
      where.push(`(${targets.map(f => `${f} LIKE ?`).join(' OR ')})`);
      for (let i = 0; i < targets.length; i++) params.push(term);
    }
  }
  // filters
  for (const f of r.fields) {
    if (!f.filter) continue;
    const fv = q['f_' + f.key];
    if (fv === undefined || fv === '' || fv === null) continue;
    if (f.type === 'ref') {
      const n = parseId(fv);
      if (n !== null) { where.push(`${f.key} = ?`); params.push(n); }
    } else if (f.type === 'number' || f.type === 'money') {
      if (typeof fv === 'object' && fv.__gte !== undefined) { where.push(`${f.key} >= ?`); params.push(Number(toEnDigits(String(fv.__gte)))); }
      else { where.push(`${f.key} = ?`); params.push(Number(toEnDigits(String(fv)))); }
    } else if (f.type === 'date' || f.type === 'datetime') {
      if (typeof fv === 'object' && fv.__from) { where.push(`${f.key} >= ?`); params.push(fv.__from); }
      if (typeof fv === 'object' && fv.__to) { where.push(`${f.key} <= ?`); params.push(fv.__to); }
    } else {
      where.push(`${f.key} = ?`); params.push(String(fv));
    }
  }
  if (q.q_archived === '1' && hasArch) {
    where.pop(); where.push('archived_at IS NOT NULL');
  }
  return { where, params };
}
// sanitize + resolve ref names for a set of rows (shared by list/export/show)
function attachItemData(r, items) {
  const d = get();
  for (const it of items) sanitizeRow(it, r); // never leak credential columns
  const refKeys = r.fields.filter(f => f.type === 'ref').map(f => f.key);
  const refData = {};
  for (const k of refKeys) {
    const f = r.fields.find(x => x.key === k);
    const ids = [...new Set(items.map(i => i[k]).filter(Boolean))];
    if (ids.length) {
      const nameCol = pickNameCol(refTable(f.ref));
      const rows = d.prepare(`SELECT id, ${nameCol} AS name FROM ${refTable(f.ref)} WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
      refData[k] = Object.fromEntries(rows.map(x => [x.id, x.name]));
    }
  }
  const userMap = loadUsers();
  for (const it of items) {
    for (const k of refKeys) {
      if (it[k] && refData[k][it[k]] !== undefined) it[k + '_name'] = refData[k][it[k]];
      if (k === 'salesperson_id' || k === 'assigned_to' || k === 'created_by' || k === 'assignee_id' || k === 'representative_id' || k === 'analyst_id' || k === 'received_by') {
        if (it[k] && userMap[it[k]]) it[k + '_name'] = userMap[it[k]];
      }
    }
  }
  return items;
}
// ---------- LIST ----------
function list(r, user, q) {
  const d = get();
  const { where, params } = buildWhere(r, user, q);
  // sort
  let sort = 'id DESC';
  if (q.sort) {
    const [k, dir] = String(q.sort).split(':');
    if (allCols(r.table).some(c => c.name === k)) sort = k + (dir === 'asc' ? ' ASC' : ' DESC');
  }
  const perPage = Math.min(parseInt(q.per_page) || 50, 500);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const total = d.prepare(`SELECT COUNT(*) c FROM ${r.table} WHERE ${where.join(' AND ')}`).get(...params).c;
  const items = d.prepare(`SELECT * FROM ${r.table} WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...params, perPage, (page - 1) * perPage);
  attachItemData(r, items);
  return { items, total, page, pages: Math.ceil(total / perPage) || 1, per_page: perPage };
}
let _userMap = null, _userMapAt = 0;
function loadUsers() {
  if (_userMap && Date.now() - _userMapAt < 30000) return _userMap;
  _userMap = Object.fromEntries(get().prepare('SELECT id, full_name FROM users').all().map(x => [x.id, x.full_name]));
  _userMapAt = Date.now();
  return _userMap;
}
// ---------- SHOW ----------
function show(r, user, id) {
  requirePerm(user, r.entity, 'view');
  const d = get();
  const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
  const sc = scopeClause(r, user);
  if (sc.where) {
    const ok = d.prepare(`SELECT 1 FROM ${r.table} WHERE id=? AND ${sc.where}`).get(id, ...sc.params);
    if (!ok) throw new HttpError(403, 'FORBIDDEN', 'دسترسی به این رکورد ندارید.');
  }
  for (const f of r.fields) {
    if (f.type === 'ref' && row[f.key]) {
      const nameCol = pickNameCol(refTable(f.ref));
      const refRow = d.prepare(`SELECT id, ${nameCol} AS name FROM ${refTable(f.ref)} WHERE id=?`).get(row[f.key]);
      if (refRow) row[f.key + '_name'] = refRow.name;
    }
    if (f.type === 'json' && typeof row[f.key] === 'string') {
      try { row[f.key] = JSON.parse(row[f.key]); } catch { /* keep */ }
    }
  }
  const userMap = loadUsers();
  for (const k of ['created_by', 'updated_by', 'salesperson_id', 'assigned_to', 'assignee_id', 'analyst_id', 'representative_id', 'received_by', 'customer_id']) {
    if (row[k] && userMap[row[k]]) row[k + '_name'] = userMap[row[k]];
  }
  if (r.table === 'customers' || r.table === 'leads' || r.table === 'opportunities') {
    row.tags = d.prepare('SELECT t.id, t.name, t.color FROM tags t JOIN entity_tags et ON et.tag_id=t.id WHERE et.entity_type=? AND et.entity_id=?').all(r.entity, id);
  }
  return sanitizeRow(row, r);
}
// ---------- CREATE ----------
function create(r, user, data, opts = {}) {
  requirePerm(user, r.entity, 'create');
  if (!opts.skipDupCheck) {
    const dups = findDuplicates(r, data);
    if (dups.length) throw new HttpError(409, 'DUPLICATE', 'رکوردهای مشابه یافت شد.', { duplicates: dups });
  }
  const { errors, out } = validate(r, data);
  if (errors.length) throw new HttpError(422, 'VALIDATION', errors.join(' '), { errors });
  const d = get();
  if (r.numberPrefix) out.number = nextNumber(r.numberPrefix, r.table);
  // server-side defaults for NOT NULL business columns (keeps raw-API creates from 500ing)
  if (r.entity === 'lab_request' && !out.received_at) out.received_at = nowIso();
  if (r.entity === 'followup' && !out.user_id) out.user_id = user.id;
  // generic: registry-declared defaultNow date fields (order_date, issue_date, paid_at, …)
  for (const f of (r.fields || [])) {
    if (f.defaultNow && (f.type === 'date' || f.type === 'datetime') && !out[f.key]) out[f.key] = nowIso();
  }
  const cols0 = allCols(r.table).map(c => c.name);
  if (cols0.includes('created_by')) out.created_by = user.id;
  if (cols0.includes('created_at')) out.created_at = nowIso();
  if (cols0.includes('updated_by')) out.updated_by = user.id;
  if (cols0.includes('updated_at')) out.updated_at = nowIso();
  if (cols0.includes('version')) out.version = 1;
  const cols = allCols(r.table).map(c => c.name);
  const keys = Object.keys(out).filter(k => cols.includes(k));
  if (!keys.length) throw new HttpError(422, 'VALIDATION', 'فیلدی برای ذخیره وجود ندارد.');
  const vals = keys.map(k => bindVal(out[k]));
  const info = d.prepare(`INSERT INTO ${r.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals);
  const id = Number(info.lastInsertRowid);
  afterCreate(r, user, id, out);
  return id;
}
function afterCreate(r, user, id, out) {
  const d = get();
  addActivity(r.entity, id, user.id, 'create', `ساخته شد: ${out.name || out.title || out.number || ''}`);
  audit(user, r.entity, id, 'create', null, out);
  // search index
  const title = out.name || out.title || out.number || out.subject || '';
  const body = [out.description, out.notes, out.company, out.contact_name, out.address].filter(Boolean).join(' ');
  // search indexing is auxiliary — it must never break the create itself
  try { searchIndex(r.entity, id, title, body); } catch (e) { console.error('[searchIndex]', e.message); }
  // workflow + notifications
  dispatch(r.entity + '_created', r.entity, id, out);
  if (r.entity === 'complaint') {
    const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
    if (row && !row.due_at) {
      const slaMap = require('../db/db').getSetting('sla_complaints', {}) || {};
      const hours = Number(slaMap[row.priority]) || Number(row.sla_hours) || 48;
      d.prepare('UPDATE complaints SET due_at=?, sla_hours=? WHERE id=?').run(new Date(Date.now() + hours * 3600e3).toISOString(), hours, id);
      row.due_at = new Date(Date.now() + hours * 3600e3).toISOString();
    }
    row && dispatch('complaint_created', 'complaint', id, row);
    if (row && row.assigned_to) require('../core/notify').notify(row.assigned_to, 'complaint', 'شکایت جدید به شما واگذار شد', row.subject, 'complaint', id, user.id);
    // AI classification (async-safe: local engine is fast)
    try {
      const eng = require('../ai/engine');
      eng.analyzeComplaint(id);
    } catch (e) { console.error('complaint ai', e.message); }
  }
  if (r.entity === 'lead') {
    try {
      const eng = require('../ai/engine');
      eng.scoreLead(id);
    } catch (e) { console.error('lead ai', e.message); }
  }
  // Section 5: auto customer message on quote creation (if enabled in settings)
  if (r.entity === 'quote') {
    try { require('../api/custom/customermsg').autoSendForEvent('quote', id, user); } catch (e) { console.error('customermsg quote', e.message); }
  }
  // Approval chains: instantiate the active chain for this document type
  // (no-op when no chain is configured/active — generic for any doc type).
  try { require('../api/custom/approvals').startChainForDoc(r.entity, id, user); } catch (e) { console.error('approval chain start', e.message); }
  // Real event notifications (Section 2): document/task/follow-up creation notifies
  // the actually responsible person + role — best effort, never breaks the create.
  try { require('./notifications').onCreate(d, user, r, id, out); } catch (e) { console.error('onCreate notify', e.message); }
}
// ---------- UPDATE ----------
function update(r, user, id, data, opts = {}) {
  requirePerm(user, r.entity, 'edit');
  const d = get();
  const before = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
  assertRowScope(r, user, before, 'edit');
  const { errors, out } = validate(r, data, true);
  if (errors.length) throw new HttpError(422, 'VALIDATION', errors.join(' '), { errors });
  const cols = allCols(r.table).map(c => c.name);
  const keys = Object.keys(out).filter(k => cols.includes(k) && k !== 'id' && k !== 'created_at' && k !== 'version' && k !== 'number');
  const changes = {};
  for (const k of keys) {
    const nv = out[k], ov = before[k];
    if (JSON.stringify(nv) !== JSON.stringify(ov)) changes[k] = { from: ov, to: nv };
  }
  if (!keys.length) throw new HttpError(422, 'VALIDATION', 'تغییری برای ذخیره وجود ندارد.');
  const hasVer = cols.includes('version'), hasUA = cols.includes('updated_at'), hasUB = cols.includes('updated_by');
  let setSql = keys.map(k => k + '=?').join(',');
  const runArgs = keys.map(k => bindVal(out[k]));
  if (hasVer) setSql += ', version=version+1';
  if (hasUA) { setSql += ', updated_at=?'; runArgs.push(nowIso()); }
  if (hasUB) { setSql += ', updated_by=?'; runArgs.push(user.id); }
  d.prepare(`UPDATE ${r.table} SET ${setSql} WHERE id=?`).run(...runArgs, id);
  addActivity(r.entity, id, user.id, 'update', 'ویرایش شد: ' + keys.join(', '));
  audit(user, r.entity, id, 'update', changes, null, '');
  // special hooks
  if (r.entity === 'complaint') {
    if (changes.status && changes.status.to === 'resolved') {
      d.prepare('UPDATE complaints SET resolved_at=? WHERE id=?').run(nowIso(), id);
      const row = d.prepare('SELECT * FROM complaints WHERE id=?').get(id);
      if (row && row.customer_id) require('../core/notify').notifyRoles(['ceo', 'quality_manager', 'super_admin'], 'complaint', 'شکایت حل شد', row.subject, 'complaint', id);
    }
    if (changes.due_at === undefined && changes.status && changes.status.to === 'in_progress') {
      // nothing
    }
  }
  if (r.entity === 'price_list' && changes.is_default && changes.is_default.to) {
    d.prepare('UPDATE price_lists SET is_default=0 WHERE id!=?').run(id);
  }
  if (r.entity === 'product' && changes.stock_qty) {
    const row = d.prepare('SELECT * FROM products WHERE id=?').get(id);
    const diff = Number(row.stock_qty) - Number(changes.stock_qty.from ?? 0);
    if (diff !== 0) {
      // Section 8 fix: the UPDATE above already applied the new stock_qty — record the
      // movement with stockDelta=0 so the delta is not applied a second time.
      const txId = recordStockTx(id, 'adjust', diff, 'اصلاح دستی موجودی', user.id, '', 0, 0);
      audit(user, 'stock_transaction', txId, 'adjust', { product: row.name, before_stock: changes.stock_qty.from ?? 0 }, { after_stock: row.stock_qty, diff });
    }
  }
  if (r.entity === 'task' && changes.status && changes.status.to === 'done') {
    d.prepare('UPDATE tasks SET completed_at=? WHERE id=?').run(nowIso(), id);
  }
  if (r.entity === 'followup' && changes.status && changes.status.to === 'done') {
    // Section 9: record the real completion time (mirror of the task hook)
    d.prepare('UPDATE followups SET done_at=COALESCE(done_at,?) WHERE id=?').run(nowIso(), id);
  }
  // quote document-level fields (discount/tax/shipping) changed → recalc totals so
  // total always reflects the saved fields (line saves already recalc in sales.recalcDoc)
  if (r.entity === 'quote' && (changes.discount_pct !== undefined || changes.tax_rate !== undefined || changes.shipping !== undefined)) {
    try { require('./custom/sales').recalcDoc('quote_items', id, null); } catch (e) { console.error('quote recalc', e.message); }
  }
  // Section 5: auto customer message on shipment (order → shipped), if enabled in settings
  if (r.entity === 'order' && changes.status && changes.status.from !== 'shipped' && changes.status.to === 'shipped') {
    try { require('../api/custom/customermsg').autoSendForEvent('shipment', id, user); } catch (e) { console.error('customermsg shipment', e.message); }
  }
  // rule engine: opportunity entered a new pipeline stage (قانون افزودن کار)
  if (r.entity === 'opportunity' && changes.stage_id && Number(changes.stage_id.from) !== Number(changes.stage_id.to)) {
    const row = d.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
    const stage = d.prepare('SELECT id, name FROM pipeline_stages WHERE id=?').get(row.stage_id) || {};
    dispatch('opportunity_stage_changed', 'opportunity', id, {
      ...row, stage_id: row.stage_id, stage_name: stage.name || '',
      customer_id: row.customer_id, salesperson_id: row.salesperson_id, title: row.title,
    });
  }
  // real-event feed for the Workflow Visual Engine ({entity}_updated)
  try {
    const rowAfter = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
    if (rowAfter) dispatch(r.entity + '_updated', r.entity, id, { ...rowAfter, _changed: keys });
  } catch { /* event feed is best-effort */ }
  return true;
}
// Section 8: optional stockDelta decouples the recorded quantity (e.g. a transfer
// amount) from the effect on total stock (a transfer between internal locations
// does not change the single stock column). Returns the new transaction id.
function recordStockTx(productId, type, qty, note = '', userId = 0, refType = '', refId = 0, stockDelta) {
  const d = get();
  const info = d.prepare('INSERT INTO stock_transactions(product_id, type, qty, note, ref_type, ref_id, user_id, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(productId, type, qty, note, refType, refId, userId, nowIso());
  const txId = Number(info.lastInsertRowid);
  const delta = stockDelta === undefined ? qty : stockDelta;
  if (delta !== 0) d.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE id=?').run(delta, productId);
  const row = d.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (row && row.reorder_point > 0 && row.stock_qty <= row.reorder_point && row.active) {
    const existing = d.prepare('SELECT id FROM stock_alerts WHERE product_id=? AND resolved_at IS NULL').get(productId);
    if (!existing) {
      const info2 = d.prepare('INSERT INTO stock_alerts(product_id, level, message, created_at) VALUES(?,?,?,?)')
        .run(productId, 'reorder', `موجودی «${row.name}» به ${row.stock_qty} ${row.unit} رسید (حد سفارش مجدد: ${row.reorder_point}). سفارش خرید در نظر بگیرید.`, nowIso());
      require('../core/notify').notifyRoles(['warehouse_manager', 'ceo', 'super_admin'], 'stock', 'هشدار موجودی کم', `کالای «${row.name}» به حد سفارش مجدد رسیده است.`, 'stock_alert', info2.lastInsertRowid);
      dispatch('stock_low', 'stock_alert', Number(info2.lastInsertRowid), { product_name: row.name, qty: row.stock_qty });
    }
  }
  if (row && row.max_stock > 0 && row.stock_qty > row.max_stock) {
    const existing = d.prepare("SELECT id FROM stock_alerts WHERE product_id=? AND level='max' AND resolved_at IS NULL").get(productId);
    if (!existing) {
      const info2 = d.prepare('INSERT INTO stock_alerts(product_id, level, message, created_at) VALUES(?,?,?,?)')
        .run(productId, 'max', `موجودی «${row.name}» از حد مجاز (${row.max_stock}) عبور کرده است.`, nowIso());
      require('../core/notify').notifyRoles(['warehouse_manager', 'super_admin'], 'stock', 'هشدار بیش‌موجودی', `کالای «${row.name}» بیش از حد مجاز موجودی دارد.`, 'stock_alert', info2.lastInsertRowid);
    }
  }
  // Section 8: negative stock is always a warning (shipped more than on hand)
  if (row && row.stock_qty < 0) {
    const existing = d.prepare('SELECT id FROM stock_alerts WHERE product_id=? AND resolved_at IS NULL').get(productId);
    if (!existing) {
      const info2 = d.prepare('INSERT INTO stock_alerts(product_id, level, message, created_at) VALUES(?,?,?,?)')
        .run(productId, 'reorder', `هشدار: موجودی «${row.name}» منفی شده است (${row.stock_qty} ${row.unit}) — خروجی بیشتر از موجودی ثبت شده.`, nowIso());
      require('../core/notify').notifyRoles(['warehouse_manager', 'ceo', 'super_admin'], 'stock', 'هشدار موجودی منفی', `کالای «${row.name}» موجودی منفی دارد.`, 'stock_alert', info2.lastInsertRowid);
    }
  }
  return txId;
}
// ---------- DELETE / ARCHIVE / RESTORE / DUPLICATE ----------
function remove(r, user, id, hard = false) {
  const d = get();
  const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
  requirePerm(user, r.entity, 'delete');
  assertRowScope(r, user, row, 'delete');
  if (hard) {
    // cascade: price list items
    if (r.entity === 'price_list') d.prepare('DELETE FROM price_list_items WHERE price_list_id=?').run(id);
    // cascade: bound workflow instances — a hard-deleted record must not leave
    // orphaned/running process instances (module key == entity key for wf modules)
    try {
      // any ACTIVE state (running/waiting/pending) — a hard-deleted record must
      // not leave orphaned flows, including ones paused on a delay/schedule node
      d.prepare(`UPDATE wf_instances SET status='terminated', current_node_id=NULL, completed_at=?, updated_at=? WHERE module=? AND entity_id=? AND status IN ('running','waiting','pending')`).run(nowIso(), nowIso(), r.entity, id);
      d.prepare(`UPDATE wf_steps SET status='returned', completed_at=? WHERE instance_id IN (SELECT id FROM wf_instances WHERE module=? AND entity_id=?) AND status='active'`).run(nowIso(), r.entity, id);
      d.prepare(`UPDATE wf_schedules SET processed_at=? WHERE execution_id IN (SELECT id FROM wf_instances WHERE module=? AND entity_id=?) AND processed_at IS NULL`).run(nowIso(), r.entity, id);
    } catch { /* wf tables may be absent in very old DBs */ }
    d.prepare(`DELETE FROM ${r.table} WHERE id=?`).run(id);
    searchRemove(r.entity, id);
    audit(user, r.entity, id, 'delete_hard', row, null);
  } else {
    requirePerm(user, r.entity, 'delete');
    // Archive = soft delete. Only meaningful when the table actually has an archive
    // column; otherwise fall through with a clear error instead of a 500 SQLITE_ERROR
    // (25 of the 32 registry tables have no archived_at/updated_* columns).
    const cols = allCols(r.table).map(c => c.name);
    if (!cols.includes('archived_at')) throw new HttpError(400, 'NOT_SUPPORTED', 'آرشیو برای این ماژول پشتیبانی نمی‌شود. از حذف کامل (?hard=1) استفاده کنید.');
    const set = ['archived_at=?'];
    const args = [nowIso()];
    if (cols.includes('updated_at')) { set.push('updated_at=?'); args.push(nowIso()); }
    if (cols.includes('updated_by')) { set.push('updated_by=?'); args.push(user.id); }
    d.prepare(`UPDATE ${r.table} SET ${set.join(',')} WHERE id=?`).run(...args, id);
    searchRemove(r.entity, id);
    audit(user, r.entity, id, 'archive', null, null);
  }
  addActivity(r.entity, id, user.id, 'delete', hard ? 'حذف کامل' : 'آرشیو شد');
  // real-event feed for the Workflow Visual Engine ({entity}_deleted)
  try { dispatch(r.entity + '_deleted', r.entity, id, { ...(row || {}), _archived: !hard }); } catch { /* best-effort */ }
  return true;
}
// SQL bind helper: json fields are stored as TEXT — objects must be stringified
function bindVal(v) {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
function archiveToggle(r, user, id) {
  const d = get();
  const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
  if (!allCols(r.table).some(c => c.name === 'archived_at')) throw new HttpError(400, 'NOT_SUPPORTED', 'آرشیو برای این ماژول پشتیبانی نمی‌شود.');
  if (row.archived_at) {
    requirePerm(user, r.entity, 'restore');
    assertRowScope(r, user, row, 'restore');
    d.prepare(`UPDATE ${r.table} SET archived_at=NULL, updated_at=? WHERE id=?`).run(nowIso(), id);
    audit(user, r.entity, id, 'restore', null, null);
    addActivity(r.entity, id, user.id, 'restore', 'از آرشیو بازیابی شد');
  } else {
    requirePerm(user, r.entity, 'delete');
    assertRowScope(r, user, row, 'delete');
    d.prepare(`UPDATE ${r.table} SET archived_at=?, updated_at=? WHERE id=?`).run(nowIso(), nowIso(), id);
    searchRemove(r.entity, id);
    audit(user, r.entity, id, 'archive', null, null);
    addActivity(r.entity, id, user.id, 'archive', 'آرشیو شد');
  }
  return true;
}
function duplicate(r, user, id) {
  requirePerm(user, r.entity, 'create');
  const d = get();
  const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
  assertRowScope(r, user, row, 'edit');
  const data = { ...row };
  delete data.id; delete data.created_at; delete data.created_by; delete data.updated_at; delete data.updated_by;
  delete data.version; delete data.archived_at;
  if (data.number) delete data.number;
  // strip only synthesized ref-name fields (<refIdKey>_name) — never real columns like test_name
  for (const k of Object.keys(data)) if (k.endsWith('_id_name')) delete data[k];
  const nameField = data.name !== undefined ? 'name' : (data.title !== undefined ? 'title' : null);
  if (nameField) data[nameField] = (data[nameField] || '') + ' (کپی)';
  // avoid UNIQUE-constraint collisions on the copy (e.g. products.code) — never touch formatted values like email/phone
  const uCols = uniqueColsOf(r.table);
  for (const k of Object.keys(data)) {
    if (k !== nameField && uCols.has(k) && data[k] !== undefined && data[k] !== null && data[k] !== '') data[k] = String(data[k]) + ' (کپی)';
  }
  return create(r, user, data, { skipDupCheck: true });
}
// columns covered by UNIQUE indexes on a table
function uniqueColsOf(table) {
  const d = get();
  const set = new Set();
  try {
    for (const ix of d.prepare(`PRAGMA index_list(${table})`).all()) {
      if (!ix.unique) continue;
      for (const ci of d.prepare(`PRAGMA index_info('${ix.name}')`).all()) if (ci.name) set.add(ci.name);
    }
  } catch { /* non-fatal */ }
  return set;
}
// ---------- comments / tags / attachments / activities ----------
function getComments(entity, entityId) {
  const rows = get().prepare('SELECT c.*, u.full_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.entity_type=? AND c.entity_id=? ORDER BY c.id DESC').all(entity, entityId);
  return rows;
}
function addComment(entity, entityId, user, body) {
  if (!String(body || '').trim()) throw new HttpError(400, 'VALIDATION', 'متن نظر خالی است.');
  const d = get();
  const r = d.prepare('INSERT INTO comments(entity_type, entity_id, user_id, body, created_at) VALUES(?,?,?,?,?)').run(entity, entityId, user.id, String(body).trim(), nowIso());
  addActivity(entity, entityId, user.id, 'comment', 'نظر جدید ثبت شد');
  return Number(r.lastInsertRowid);
}
function getTags(entity, entityId) {
  return get().prepare('SELECT t.* FROM tags t JOIN entity_tags et ON et.tag_id=t.id WHERE et.entity_type=? AND et.entity_id=?').all(entity, entityId);
}
function setTags(entity, entityId, user, tagIds) {
  const d = get();
  d.prepare('DELETE FROM entity_tags WHERE entity_type=? AND entity_id=?').run(entity, entityId);
  const ins = d.prepare('INSERT OR IGNORE INTO entity_tags(entity_type, entity_id, tag_id) VALUES(?,?,?)');
  for (const t of (tagIds || [])) {
    const n = parseId(t);
    if (n !== null && d.prepare('SELECT id FROM tags WHERE id=?').get(n)) ins.run(entity, entityId, n);
  }
  addActivity(entity, entityId, user.id, 'tags', 'برچسب‌ها به‌روزرسانی شد');
  return true;
}
function getAttachments(entity, entityId) {
  return get().prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY id DESC').all(entity, entityId);
}
function getActivities(entity, entityId, limit = 100) {
  return get().prepare('SELECT a.*, u.full_name FROM activities a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity_type=? AND a.entity_id=? ORDER BY a.id DESC LIMIT ?').all(entity, entityId, limit);
}
function getAuditTrail(entity, entityId, limit = 100) {
  return get().prepare('SELECT * FROM audit_logs WHERE entity=? AND entity_id=? ORDER BY id DESC LIMIT ?').all(entity, entityId, limit);
}
// ---------- EXPORT / IMPORT ----------
// Central export for ANY resource:
//   scope: q.ids (selected rows) | q.q + f_* (filtered) | all visible rows
//   formats: xlsx (real XLSX with report title + generated date) | csv | json | html (printable → print/PDF)
//   header: with/without the official company header (html) / title rows (xlsx)
function exportResource(r, user, q, format) {
  requirePerm(user, r.entity, 'export');
  const d = get();
  const { where, params } = buildWhere(r, user, q);
  // scope: selected records (explicit ids) — always inside the user's scope
  let ids = null;
  if (q.ids) {
    ids = String(q.ids).split(',').map(x => Number(String(x).trim())).filter(n => Number.isInteger(n) && n > 0);
    if (ids.length) { where.push('id IN (' + ids.map(() => '?').join(',') + ')'); params.push(...ids); }
  }
  const limit = ids ? ids.length : 10000;
  const items = attachItemData(r, d.prepare(`SELECT * FROM ${r.table} WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...params, limit));
  const headerOn = q.header !== '0';
  const scope = ids && ids.length ? 'selected' : (q.q || Object.keys(q).some(k => k.startsWith('f_'))) ? 'filtered' : 'all';
  const scopeLabel = scope === 'selected' ? ' — رکوردهای انتخاب‌شده' : (scope === 'filtered' ? ' — فیلترشده' : '');
  const title = r.nameFa + scopeLabel;
  const headers = r.fields.filter(f => (f.list || ['number', 'total', 'subtotal', 'paid_amount', 'status'].includes(f.key)) && !['id', 'custom_fields', 'archived_at'].includes(f.key));
  const head = headers.map(f => f.label);
  const rows = items.map(it => headers.map(f => {
    let v = f.type === 'ref' ? (it[f.key + '_name'] || (it[f.key] ? '#' + it[f.key] : '')) : it[f.key];
    if ((f.type === 'date' || f.type === 'datetime') && v) v = fmtDate(v, { time: f.type === 'datetime' });
    if (f.type === 'bool') v = v ? 'بله' : 'خیر';
    if (f.type === 'select' && Array.isArray(f.options) && v !== null && v !== undefined && v !== '') {
      const o = f.options.find(o => (typeof o === 'object' ? o.v : o) === v);
      if (o) v = typeof o === 'object' ? o.l : o;
    }
    return v === null || v === undefined ? '' : v;
  }));
  const stamp = nowIso().slice(0, 10).replace(/-/g, '');
  const auditExport = () => { try { audit(user, r.entity, 0, 'export', null, { format, scope, rows: items.length, header: headerOn }, ''); } catch { /* best-effort */ } };
  if (format === 'html') {
    const printMod = require('../lib/print');
    const html = printMod.listDocHtml(r.entity, items, {
      title, header: headerOn ? true : false,
      printUser: user ? user.full_name : '',
      printMeta: { at: fmtDate(nowIso(), { time: true, fa: false }) + ' ' + new Date().toTimeString().slice(0, 5), user: user ? user.full_name : '' },
      autoPrint: q.autoprint === '1',
    });
    auditExport();
    return { type: 'html', mime: 'text/html; charset=utf-8', data: Buffer.from(html, 'utf8'), fileName: r.nameFa + '.html', inline: true };
  }
  if (format === 'csv') {
    let csv = '\uFEFF' + [head, ...rows].map(row => row.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    auditExport();
    return { type: 'csv', data: csv, fileName: r.nameFa + '-' + stamp + '.csv' };
  }
  if (format === 'json') {
    const objs = items.map(it => { const o = {}; for (const h of r.fields) o[h.key] = it[h.key] ?? null; return o; });
    auditExport();
    return { type: 'json', data: JSON.stringify({ source: r.nameFa, scope, generated_at: nowIso(), count: objs.length, items: objs }, null, 2), fileName: r.nameFa + '-' + stamp + '.json' };
  }
  // xlsx via the central renderer (title + generated date + real XLSX)
  const { render } = require('./custom/exporter');
  const out = render('xlsx', title, r.nameFa.toLowerCase().replace(/\s+/g, '-') + '-' + stamp, [{ name: r.nameFa.slice(0, 30), headers: head, rows }], { header: headerOn, printUser: user ? user.full_name : '' });
  auditExport();
  return { type: 'xlsx', mime: out.mime, data: out.buf, fileName: out.fileName };
}
function importPreview(r, user, buffer, fileName) {
  requirePerm(user, r.entity, 'import');
  let rows, wbHeader = null, fileRows = 0;
  try {
    if (fileName.toLowerCase().endsWith('.csv')) {
      const text = Buffer.from(buffer).toString('utf8').replace(/^\uFEFF/, '');
      rows = parseCsv(text);
    } else {
      const t = parseWorkbookAllSheets(buffer);
      if (!t.header) throw new HttpError(400, 'IMPORT_EMPTY', 'فایل خالی است.');
      wbHeader = t.header; rows = t.rows; fileRows = t.rows.length;
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'IMPORT_FORMAT', 'فرمت فایل قابل خواندن نیست. لطفاً Excel (xlsx) یا CSV بفرستید.');
  }
  if (!rows.length) throw new HttpError(400, 'IMPORT_EMPTY', 'فایل خالی است.');
  const header = wbHeader || rows[0].map(h => String(h || '').trim());
  const dataRows = (wbHeader ? rows : rows.slice(1)).filter(x => x.some(c => c !== '' && c !== null && c !== undefined));
  fileRows = fileRows || dataRows.length;
  // map columns to fields by label
  const normLabel = (x) => String(x || '').replace(/\(.*?\)/g, ' ').split('/').map(x => x.trim()).filter(Boolean)[0] || String(x || '').trim();
  const ALIAS = { 'نام': 'name', 'نام و عنوان': 'name', 'عنوان': 'title', 'تلفن': 'phone', 'موبایل': 'mobile', 'ایمیل': 'email', 'email': 'email', 'استان': 'province', 'شهر': 'city', 'آدرس': 'address', 'صنعت': 'industry', 'اعتبار': 'credit_limit', 'سقف اعتبار': 'credit_limit', 'قیمت': 'price_retail', 'قیمت فروش': 'price_retail', 'موجودی': 'stock_qty', 'وضعیت': 'status', 'توضیحات': 'notes', 'تاریخ': 'created_at', 'کد': 'code', 'دسته': 'category_id', 'مسئول': 'salesperson_id', 'منبع': 'source', 'مبلغ': 'amount', 'مبلغ کل': 'total', 'قیمت واحد': 'price', 'تعداد': 'qty', 'تاریخ صدور': 'issue_date', 'سررسید': 'due_date', 'تاریخ ثبت': 'order_date', 'تاریخ تحویل': 'due_date', 'نوع': 'type', 'تاریخ': 'created_at', 'نفر': 'full_name', 'شماره': 'number', 'نام شرکت': 'name', 'شماره تماس': 'phone' };
  const mapping = [];
  const used = new Set();
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    const hn = normLabel(h);
    let f = r.fields.find(f => f.label === h || f.labelEn === h || f.key === h);
    if (!f) f = r.fields.find(f => normLabel(f.label) === hn || (f.labelEn && normLabel(f.labelEn) === hn) || f.key === hn);
    if (!f && ALIAS[hn]) f = r.fields.find(f => f.key === ALIAS[hn]);
    if (!f && hn.length >= 2) f = r.fields.find(f => !used.has(f.key) && (String(f.label).includes(hn) || hn.includes(normLabel(f.label)) && normLabel(f.label).length >= 2));
    if (f && !used.has(f.key)) { mapping.push({ col: i, key: f.key }); used.add(f.key); }
  }
  const valid = [], errors = [];
  for (let ri = 0; ri < dataRows.length; ri++) {
    const row = dataRows[ri];
    const data = {};
    for (const m of mapping) data[m.key] = row[m.col];
    const { errors: verrs, out } = validate(r, data);
    if (verrs.length) errors.push({ row: ri + 2, errors: verrs });
    else valid.push({ row: ri + 2, data: out });
  }
  const tempId = 'imp_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
  importCache.set(tempId, { resource: r.entity, valid, fileRows, at: Date.now() });
  setTimeout(() => importCache.delete(tempId), 15 * 60000);
  return {
    mapping: mapping.map(m => ({ col: m.col, header: header[m.col], key: m.key })),
    validCount: valid.length, errorCount: errors.length,
    fileRowCount: fileRows, checkedCount: dataRows.length,
    errors: errors.slice(0, 500),
    preview: valid.slice(0, 20).map(v => v.data), tempId,
  };
}
// batch import: EXACT duplicates only (same dupField value as an existing DB row or an
// earlier row of the same file). Fuzzy name similarity is intentionally NOT applied to
// bulk imports — 400 similar products are not 399 duplicates.
function batchExactDupIndexes(r, rows) {
  const d = get();
  const dupIdx = new Set();
  const seenInBatch = new Map(); // field -> Set(values)
  const fields = (r.dupFields || []).filter(f => allCols(r.table).some(c => c.name === f));
  for (let i = 0; i < rows.length; i++) {
    let isDup = false;
    for (const f of fields) {
      const v = rows[i][f];
      if (v === null || v === undefined || v === '') continue;
      const sv = String(v).trim();
      const inDb = d.prepare(`SELECT 1 FROM ${r.table} WHERE archived_at IS NULL AND ${f}=? LIMIT 1`).get(sv);
      if (inDb) { isDup = true; break; }
      const seen = seenInBatch.get(f) || new Set();
      if (seen.has(sv)) { isDup = true; break; }
      seen.add(sv);
      seenInBatch.set(f, seen);
    }
    if (isDup) dupIdx.add(i);
  }
  return dupIdx;
}
function importCommit(r, user, tempId) {
  const cached = importCache.get(tempId);
  if (!cached || cached.resource !== r.entity) throw new HttpError(400, 'IMPORT_EXPIRED', 'جلسه import منقضی شده است. لطفاً دوباره فایل را آپلود کنید.');
  let ok = 0, dup = 0, fail = 0;
  const d = get();
  const before = d.prepare(`SELECT COUNT(*) c FROM ${r.table}`).get().c;
  const dupIdx = batchExactDupIndexes(r, cached.valid.map(v => v.data));
  const tx = d.transaction(() => {
    for (let i = 0; i < cached.valid.length; i++) {
      if (dupIdx.has(i)) { dup++; continue; }
      try {
        create(r, user, cached.valid[i].data, { skipDupCheck: true });
        ok++;
      } catch (e) {
        if (e.code === 'DUPLICATE') dup++;
        else { fail++; if (fail <= 10) e._first = e.message; }
      }
    }
  });
  tx();
  const after = d.prepare(`SELECT COUNT(*) c FROM ${r.table}`).get().c;
  importCache.delete(tempId);
  audit(user, r.entity, 0, 'import', null, { ok, dup, fail, fileRows: cached.fileRows || cached.valid.length, before, after });
  return { ok, duplicates: dup, failed: fail, fileRowCount: cached.fileRows || cached.valid.length, before, after };
}
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
// ============ Multi-format import (XLS/XLSX/CSV/JSON/XML/TXT) ============
// Parse a file into { format, header, rows } — rows are arrays aligned to header.
function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
function detectDelimiter(text) {
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const candidates = ['\t', ';', ',', '|'];
  let best = ',', bestN = 0;
  for (const d of candidates) {
    const n = firstLine.split(d).length - 1;
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}
function parseJsonTable(text) {
  let v;
  try { v = JSON.parse(String(text).trim()); }
  catch { throw new HttpError(400, 'IMPORT_FORMAT', 'فایل JSON معتبر نیست.'); }
  if (v && !Array.isArray(v)) { for (const k of ['items', 'rows', 'records', 'data']) if (Array.isArray(v[k])) { v = v[k]; break; } }
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'IMPORT_EMPTY', 'فایل JSON خالی است.');
  if (v.every(x => Array.isArray(x))) return { header: v[0].map(h => String(h == null ? '' : h)), rows: v.slice(1) };
  const header = [];
  const seen = new Set();
  for (const o of v) if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); header.push(k); }
  if (!header.length) throw new HttpError(400, 'IMPORT_FORMAT', 'JSON باید آرایه‌ای از اشیاء با کلیدهای فیلد باشد.');
  const rows = v.map(o => header.map(h => (o && o[h] !== undefined && o[h] !== null) ? o[h] : ''));
  return { header, rows };
}
function parseXmlTable(text) {
  const xml = String(text).replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  let recTag = null;
  const recMatch = xml.match(/<(record|row|item|entry|data)[^>]*>/i);
  if (recMatch) recTag = recMatch[1].toLowerCase();
  if (!recTag) {
    const counts = {};
    const anyRe = /<(\w+)[^>]*>[\s\S]*?<\/\1>/g;
    for (const m of xml.matchAll(anyRe)) { const t = m[1].toLowerCase(); counts[t] = (counts[t] || 0) + 1; }
    const rep = Object.entries(counts).filter(([t, c]) => c >= 1 && !['root', 'rows', 'records', 'items', 'data'].includes(t));
    if (!rep.length) throw new HttpError(400, 'IMPORT_FORMAT', 'ساختار XML قابل تشخیص نیست (نیاز به رکوردهای تکراری با تگ‌های فیلد).');
    rep.sort((a, b) => b[1] - a[1]);
    recTag = rep[0][0];
  }
  const recRe = new RegExp('<' + recTag + '[^>]*>([\\s\\S]*?)</' + recTag + '>', 'gi');
  const fieldRe = new RegExp('<(\\w+)[^>]*>([\\s\\S]*?)<\\/\\1>', 'g');
  const header = [];
  const seen = new Set();
  const recs = [];
  let m;
  while ((m = recRe.exec(xml))) {
    const rec = {};
    for (const f of m[1].matchAll(fieldRe)) {
      const tag = f[1];
      if (!seen.has(tag)) { seen.add(tag); header.push(tag); }
      rec[tag] = f[2].trim();
    }
    recs.push(rec);
  }
  if (!recs.length) throw new HttpError(400, 'IMPORT_FORMAT', 'رکوردی در XML پیدا نشد.');
  const rows = recs.map(r => header.map(h => r[h] !== undefined ? r[h] : ''));
  return { header, rows };
}
function fileExt(fileName) { const parts = String(fileName || '').split('.'); return parts.length > 1 ? '.' + parts.pop().toLowerCase() : ''; }
// Read an XLSX/XLS workbook: FIRST non-empty sheet defines the header; ALL non-empty
// sheets contribute data rows (so a 400-row file split across sheets imports all 400).
// Returns { header, rows, sheets: [{name, dataRows, hasHeader}] , fileRowCount }
function parseWorkbookAllSheets(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetInfo = [];
  let header = null;
  const rows = [];
  const norm = (c) => String(c == null ? '' : c).trim();
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) || [];
    const nonEmpty = aoa.filter(x => Array.isArray(x) && x.some(c => c !== '' && c !== null && c !== undefined));
    if (!nonEmpty.length) continue;
    let dataRows = nonEmpty;
    let hasHeader = false;
    if (header === null) {
      // first non-empty sheet: treat its first row as the master header
      header = nonEmpty[0].map(norm);
      dataRows = nonEmpty.slice(1);
      hasHeader = true;
    } else {
      // later sheets: if their first row mostly matches the master header, drop it
      const first = nonEmpty[0].map(norm);
      const filled = first.filter(Boolean);
      const overlap = filled.filter(v => header.includes(v)).length;
      if (filled.length && overlap / filled.length >= 0.5) { dataRows = nonEmpty.slice(1); hasHeader = true; }
    }
    // normalize row width to the master header width
    const w = header.length;
    const mapped = dataRows.map(r => {
      const out = [];
      for (let i = 0; i < w; i++) out.push(r[i] === undefined || r[i] === null ? '' : r[i]);
      return out;
    }).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
    rows.push(...mapped);
    sheetInfo.push({ name: sn, dataRows: mapped.length, hasHeader });
  }
  if (header === null) return { header: null, rows: [], sheets: [], fileRowCount: 0 };
  return { header, rows, sheets: sheetInfo, fileRowCount: rows.length };
}
function parseFileToTable(buffer, fileName) {
  const ext = fileExt(fileName);
  let header = null, rows, sheets = null;
  if (ext === '.csv') {
    const text = Buffer.from(buffer).toString('utf8').replace(/^\uFEFF/, '');
    rows = parseCsv(text);
  } else if (ext === '.xlsx' || ext === '.xls') {
    const t = parseWorkbookAllSheets(buffer);
    if (!t.header) throw new HttpError(400, 'IMPORT_EMPTY', 'فایل خالی است.');
    header = t.header; rows = t.rows; sheets = t.sheets;
  } else if (ext === '.json') {
    const t = parseJsonTable(buffer);
    header = t.header; rows = t.rows;
  } else if (ext === '.xml') {
    const t = parseXmlTable(buffer);
    header = t.header; rows = t.rows;
  } else if (ext === '.txt') {
    const text = Buffer.from(buffer).toString('utf8').replace(/^\uFEFF/, '');
    const d = detectDelimiter(text);
    rows = d === ',' ? parseCsv(text) : parseDelimited(text, d);
  } else {
    throw new HttpError(400, 'IMPORT_FORMAT', 'فرمت فایل پشتیبانی نمی‌شود. فرمت‌های مجاز: XLS, XLSX, CSV, JSON, XML, TXT.');
  }
  if (!rows || !rows.length) throw new HttpError(400, 'IMPORT_EMPTY', 'فایل خالی است.');
  // JSON/XML parsers return data rows only (no header row); CSV/XLS/TXT have a header row.
  // For XLSX/XLS the workbook helper already returns data rows only (header consumed).
  const hasHeaderRow = !(ext === '.json' || ext === '.xml') && !sheets;
  if (!header) {
    if (!hasHeaderRow) throw new HttpError(400, 'IMPORT_FORMAT', 'هدر فایل قابل تشخیص نیست.');
    header = rows[0].map(h => String(h == null ? '' : h).trim());
  }
  const dataRows = (hasHeaderRow ? rows.slice(1) : rows).filter(x => x.some(c => c !== '' && c !== null && c !== undefined));
  return { format: ext.replace('.', '').toUpperCase() || 'TABLE', header, rows: dataRows, sheets: sheets || null };
}
// Suggest column→field mapping (same heuristics as the original import, now reusable)
function suggestMapping(r, header) {
  const normLabel = (x) => String(x || '').replace(/\(.*?\)/g, ' ').split('/').map(x => x.trim()).filter(Boolean)[0] || String(x || '').trim();
  const ALIAS = { 'نام': 'name', 'نام و عنوان': 'name', 'عنوان': 'title', 'تلفن': 'phone', 'موبایل': 'mobile', 'ایمیل': 'email', 'email': 'email', 'استان': 'province', 'شهر': 'city', 'آدرس': 'address', 'صنعت': 'industry', 'اعتبار': 'credit_limit', 'سقف اعتبار': 'credit_limit', 'قیمت': 'price_retail', 'قیمت فروش': 'price_retail', 'موجودی': 'stock_qty', 'وضعیت': 'status', 'توضیحات': 'notes', 'تاریخ': 'created_at', 'کد': 'code', 'دسته': 'category_id', 'مسئول': 'salesperson_id', 'منبع': 'source', 'مبلغ': 'amount', 'مبلغ کل': 'total', 'قیمت واحد': 'price', 'تعداد': 'qty', 'تاریخ صدور': 'issue_date', 'سررسید': 'due_date', 'تاریخ ثبت': 'order_date', 'تاریخ تحویل': 'due_date', 'نوع': 'type', 'نفر': 'full_name', 'شماره': 'number', 'نام شرکت': 'name', 'شماره تماس': 'phone' };
  const mapping = [];
  const used = new Set();
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    const hn = normLabel(h);
    let f = r.fields.find(f => f.label === h || f.labelEn === h || f.key === h);
    if (!f) f = r.fields.find(f => normLabel(f.label) === hn || (f.labelEn && normLabel(f.labelEn) === hn) || f.key === hn);
    if (!f && ALIAS[hn]) f = r.fields.find(f => f.key === ALIAS[hn]);
    if (!f && hn.length >= 2) f = r.fields.find(f => !used.has(f.key) && (String(f.label).includes(hn) || (hn.includes(normLabel(f.label)) && normLabel(f.label).length >= 2)));
    if (f && !used.has(f.key)) { mapping.push({ col: i, key: f.key }); used.add(f.key); }
  }
  return mapping;
}
// Step 1: parse file (no DB writes)
function importParse(r, user, buffer, fileName) {
  requirePerm(user, r.entity, 'import');
  const t = parseFileToTable(buffer, fileName);
  const suggested = suggestMapping(r, t.header);
  const tempId = 'imp_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
  importCache.set(tempId, { resource: r.entity, header: t.header, rows: t.rows, valid: null, at: Date.now() });
  setTimeout(() => importCache.delete(tempId), 15 * 60000);
  return {
    tempId, format: t.format, header: t.header, rowCount: t.rows.length,
    fileRowCount: t.rows.length,
    sheets: t.sheets || null,
    suggested,
    samples: t.rows.slice(0, 3),
    fields: r.fields.filter(f => !f.readonly && f.key !== 'id' && f.type !== 'json').map(f => ({ key: f.key, label: f.label, required: !!f.required, type: f.type })),
  };
}
// Step 2: validate rows with an explicit mapping [{col, key|null}]
function importValidate(r, user, tempId, mapping) {
  requirePerm(user, r.entity, 'import');
  const cached = importCache.get(tempId);
  if (!cached || cached.resource !== r.entity) throw new HttpError(400, 'IMPORT_EXPIRED', 'جلسه import منقضی شده است. لطفاً دوباره فایل را بارگذاری کنید.');
  const valid = [], errors = [];
  let dupCount = 0;
  const dupRows = [];
  const d = get();
  const cols = allCols(r.table).map(c => c.name);
  for (let ri = 0; ri < cached.rows.length; ri++) {
    const row = cached.rows[ri];
    const data = {};
    for (const m of (mapping || [])) {
      if (!m || !m.key || !cols.includes(m.key)) continue;
      const v = row[m.col];
      if (v === undefined || v === null || v === '') continue;
      // Persian/Arabic digits → Latin (phones, amounts, dates, codes)
      data[m.key] = typeof v === 'number' ? v : toEnDigits(String(v).trim());
    }
    const { errors: verrs, out } = validate(r, data);
    if (verrs.length) { errors.push({ row: ri + 2, errors: verrs }); continue; }
    valid.push({ row: ri + 2, data: out });
    if (r.dupFields) {
      for (const f of r.dupFields) {
        const val = out[f];
        if (val === null || val === undefined || val === '') continue;
        const ex = d.prepare('SELECT id FROM ' + r.table + ' WHERE archived_at IS NULL AND ' + f + '=? LIMIT 1').get(String(val));
        if (ex) { dupCount++; dupRows.push({ row: ri + 2, id: ex.id, field: f }); break; }
      }
    }
  }
  importCache.set(tempId, { ...cached, valid, at: Date.now() });
  setTimeout(() => importCache.delete(tempId), 15 * 60000);
  return {
    validCount: valid.length, dupCount, errorCount: errors.length, dupRows: dupRows.slice(0, 500),
    fileRowCount: cached.rows.length,
    checkedCount: cached.rows.length,
    reconciliation: { file: cached.rows.length, valid: valid.length, duplicate: dupCount, error: errors.length },
    errors: errors.slice(0, 500),
    preview: valid.slice(0, 10).map(v => v.data),
  };
}
// Step 3: commit valid rows into the real DB
// dupPolicy: 'skip' (default, never touch existing) | 'update' (refresh the
// existing record with the MAPPED columns only — never other fields) | 'new'
// (create a NEW record even when a duplicate exists — user-confirmed).
function findExistingRec(r, data) {
  if (!r.dupFields) return null;
  const d = get();
  for (const f of r.dupFields) {
    const val = data[f];
    if (val === null || val === undefined || val === '') continue;
    const ex = d.prepare('SELECT id FROM ' + r.table + ' WHERE archived_at IS NULL AND ' + f + '=? LIMIT 1').get(String(val));
    if (ex) return { id: ex.id, field: f };
  }
  return null;
}
function importCommitMapped(r, user, tempId, mapping, dupPolicy) {
  requirePerm(user, r.entity, 'import');
  const policy = ['skip', 'update', 'new'].includes(dupPolicy) ? dupPolicy : 'skip';
  const cached = importCache.get(tempId);
  if (!cached || cached.resource !== r.entity) throw new HttpError(400, 'IMPORT_EXPIRED', 'جلسه import منقضی شده است. لطفاً دوباره فایل را بارگذاری کنید.');
  if (!Array.isArray(cached.valid) || !cached.valid.length) throw new HttpError(400, 'NOTHING_TO_COMMIT', 'رکورد معتبری برای ثبت وجود ندارد. ابتدا اعتبارسنجی کنید.');
  let ok = 0, dup = 0, updated = 0, unchanged = 0, fail = 0;
  const d = get();
  const before = d.prepare(`SELECT COUNT(*) c FROM ${r.table}`).get().c;
  const seenInBatch = new Map(); // field -> Set(values) for intra-file duplicates
  const tx = d.transaction(() => {
    for (let i = 0; i < cached.valid.length; i++) {
      const data = cached.valid[i].data;
      const existing = findExistingRec(r, data);
      if (existing) {
        if (policy === 'skip') { dup++; continue; }
        if (policy === 'update') {
          try {
            const exRow = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(existing.id);
            const cols = allCols(r.table).map(c => c.name);
            const willChange = Object.keys(data).some(k => cols.includes(k) && JSON.stringify(data[k]) !== JSON.stringify(exRow[k]));
            if (!willChange) { unchanged++; continue; }
            update(r, user, existing.id, data); updated++;
          } catch (e) { if (e.code === 'DUPLICATE' || (e.code === 'VALIDATION' && /تغییری/.test(e.message))) unchanged++; else fail++; }
          continue;
        }
        // policy 'new' → fall through: create a NEW record (user-confirmed)
      }
      // intra-file duplicate (same dup-field value twice in this file)
      let intra = false;
      for (const f of (r.dupFields || [])) {
        const val = data[f];
        if (val === null || val === undefined || val === '') continue;
        const seen = seenInBatch.get(f) || new Set();
        if (seen.has(String(val))) { intra = true; break; }
      }
      if (intra) { if (policy === 'new') { /* allow, user chose force-new */ } else { dup++; continue; } }
      for (const f of (r.dupFields || [])) {
        const val = data[f];
        if (val === null || val === undefined || val === '') continue;
        const seen = seenInBatch.get(f) || new Set();
        seen.add(String(val)); seenInBatch.set(f, seen);
      }
      try { create(r, user, data, { skipDupCheck: true }); ok++; }
      catch (e) { if (e.code === 'DUPLICATE') dup++; else { fail++; } }
    }
  });
  tx();
  const after = d.prepare(`SELECT COUNT(*) c FROM ${r.table}`).get().c;
  importCache.delete(tempId);
  audit(user, r.entity, 0, 'import', null, { ok, dup, updated, unchanged, fail, fileRows: cached.rows.length, before, after, via: 'wizard', dupPolicy: policy }, '');
  return { ok, dup, updated, unchanged, fail, fileRowCount: cached.rows.length, before, after, dupPolicy: policy };
}
const importCache = new Map();
module.exports = {
  list, show, create, update, remove, archiveToggle, duplicate, assertRowScope,
  getComments, addComment, getTags, setTags, getAttachments, getActivities, getAuditTrail,
  exportResource, importPreview, importCommit, recordStockTx, allCols, validate, importParse, importValidate, importCommitMapped, parseFileToTable,
};
