'use strict';
// ============ Calendar & Planning — first-class events + module integration ============
const { get, getSetting, setSetting, getUserSetting, setUserSetting } = require('../../db/db');
const { nowIso, nowTehran, faDigits, fmtNum, toJalaali, jalaliToIso, jalExport, likeEscape } = require('../../lib/util');
const { gregorianToJalaali, jalaaliToGregorian, jalaaliMonthLength } = require('../../lib/jalali');
const { HttpError } = require('../../lib/http');
const { requirePerm, hasPerm, scopeWhere } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { notify } = require('../../core/notify');
const aigw = require('../../core/ai-gateway');

const EVENT_TYPES = {
  meeting: { fa: 'جلسه', color: '#7c5cd6' },
  call: { fa: 'تماس', color: '#3b82f6' },
  followup: { fa: 'پیگیری', color: '#2a9d8f' },
  task: { fa: 'وظیفه', color: '#c9622a' },
  reminder: { fa: 'یادآوری', color: '#8b5cf6' },
  sales: { fa: 'فعالیت فروش', color: '#c9a227' },
  rd: { fa: 'فعالیت R&D', color: '#0ea5e9' },
  qc: { fa: 'فعالیت QC', color: '#ef4444' },
  lab: { fa: 'فعالیت آزمایشگاه', color: '#14b8a6' },
  project: { fa: 'فعالیت پروژه', color: '#f59e0b' },
  approval: { fa: 'تأیید / مورده', color: '#6366f1' },
  deadline: { fa: 'مهلت (Deadline)', color: '#dc2626' },
  contract_expiry: { fa: 'انقضای قرارداد', color: '#b91c1c' },
  other: { fa: 'سایر', color: '#6b7280' },
};
const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES);
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUS = ['scheduled', 'done', 'cancelled'];
const REMINDER_OPTS = [5, 10, 15, 30, 60, 1440]; // minutes; 1440 = 1 day
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];
const DEFAULT_HOLIDAYS = [
  { jm: 1, jd: 1, name: 'نوروز (روز اول)' },
  { jm: 1, jd: 2, name: 'نوروز (روز دوم)' },
  { jm: 1, jd: 3, name: 'نوروز (روز سوم)' },
  { jm: 1, jd: 13, name: 'سیزده‌بدر' },
  { jm: 1, jd: 19, name: 'تولد امام رضا (ع)' },
  { jm: 2, jd: 1, name: 'تولد ولای فقیه' },
  { jm: 2, jd: 23, name: 'روز ائمه' },
  { jm: 3, jd: 22, name: 'پیروزی انقلاب' },
  { jm: 3, jd: 24, name: 'شهادت امام خمینی (ره)' },
];

// ---------- helpers ----------
function d() { return get(); }
function userByIds(ids) {
  if (!ids || !String(ids).trim()) return [];
  const list = String(ids).split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (!list.length) return [];
  return d().prepare('SELECT id, full_name, department FROM users WHERE id IN (' + list.map(() => '?').join(',') + ') AND active=1').all(...list);
}
function customerOf(id) {
  if (!id) return null;
  const c = d().prepare('SELECT id, name FROM customers WHERE id=?').get(id);
  return c ? { id: c.id, name: c.name } : null;
}
function scopeFilter(user, allScope = false) {
  if (allScope) return 'all';
  const r = hasPerm(user, 'calendar_event', 'view');
  if (!r.ok) throw new HttpError(403, 'FORBIDDEN', 'شما مجوز مشاهده تقویم را ندارید.');
  return r.scope;
}
// WHERE clause for row scoping on a calendar_events row (own → user_id or created_by)
function calScopeWhere(user, scope) {
  if (scope === 'all') return { sql: '', params: [] };
  if (scope === 'own') return { sql: '(user_id = ? OR created_by = ?)', params: [user.id, user.id] };
  const dept = user.department || '';
  const sql = `(user_id = ? OR created_by = ? OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = calendar_events.user_id AND u2.department = ? AND u2.department != ''))`;
  return { sql, params: [user.id, user.id, dept] };
}
function isoOrThrow(v, field) {
  if (!v) throw new HttpError(422, 'VALIDATION', field + ' الزامی است.');
  const t = new Date(v);
  if (isNaN(t.getTime())) throw new HttpError(422, 'VALIDATION', field + ' نامعتبر است.');
  return t.toISOString();
}
function clampShamsi(jy, jm, jd) {
  const ml = jalaaliMonthLength(jy, jm);
  if (jd > ml) return null; // invalid (e.g. Esfand 30 in non-leap year)
  return { jy, jm, jd };
}
// expand a recurring base event into occurrences inside [from, to]
function expandRecurrence(ev, fromIso, toIso, out, limit) {
  if (out.length >= limit) return;
  if (ev.recurrence === 'none' || !ev.recurrence) { out.push({ ...ev, occurrence_start: ev.start_at, occurrence_end: ev.end_at, is_occurrence: 0 }); return; }
  let rule = {};
  try { rule = JSON.parse(ev.recurrence_rule || '{}'); } catch {}
  const interval = Math.max(1, Number(rule.interval) || 1);
  const unit = rule.unit || ev.recurrence;
  const base = new Date(ev.start_at);
  const endLimit = ev.recurrence_end_at ? new Date(ev.recurrence_end_at) : null;
  const rangeEnd = new Date(toIso);
  // step in Gregorian days, but month/year recurrence needs Shamsi-aware stepping
  if (unit === 'month' || unit === 'monthly') {
    let [jy, jm] = gregorianToJalaali(base.getFullYear(), base.getMonth() + 1, base.getDate());
    let guard = 0;
    for (;;) {
      if (guard++ > 500) break;
      const ml = jalaaliMonthLength(jy, jm);
      const jd = Math.min(ev._base_jd || 1, ml);
      const g = require('../../lib/jalali').jalaaliToGregorian(jy, jm, jd);
      const t = new Date(g[0], g[1] - 1, g[2], base.getHours(), base.getMinutes());
      if (t > rangeEnd || (endLimit && t > endLimit)) break;
      if (t >= new Date(fromIso)) out.push({ ...ev, occurrence_start: t.toISOString(), occurrence_end: ev.end_at ? new Date(new Date(ev.end_at).getTime() + (t - base)).toISOString() : null, is_occurrence: 1, occurrence_id: 'rec-' + ev.id + '-' + t.toISOString() });
      jm += interval; while (jm > 12) { jm -= 12; jy++; }
      if (out.length >= limit) return;
    }
    return;
  }
  if (unit === 'year' || unit === 'yearly') {
    const [jy0, jm0, jd0] = gregorianToJalaali(base.getFullYear(), base.getMonth() + 1, base.getDate());
    for (let k = 0; k < 50; k++) {
      const jy = jy0 + k * interval;
      let jd = jd0;
      const ml = jalaaliMonthLength(jy, jm0);
      if (jd > ml) jd = ml; // leap Esfand 30 → 29
      const g = require('../../lib/jalali').jalaaliToGregorian(jy, jm0, jd);
      const t = new Date(g[0], g[1] - 1, g[2], base.getHours(), base.getMinutes());
      if (t > rangeEnd || (endLimit && t > endLimit)) break;
      if (t >= new Date(fromIso)) out.push({ ...ev, occurrence_start: t.toISOString(), occurrence_end: ev.end_at ? new Date(new Date(ev.end_at).getTime() + (t - base)).toISOString() : null, is_occurrence: 1, occurrence_id: 'rec-' + ev.id + '-' + t.toISOString() });
      if (out.length >= limit) return;
    }
    return;
  }
  // daily / weekly / custom (in days)
  const stepDays = unit === 'week' || unit === 'weekly' ? 7 * interval : interval;
  const endAt = ev.end_at ? new Date(ev.end_at) : null;
  const span = endAt ? endAt - base : 0;
  for (let k = 0; k < 400; k++) {
    const t = new Date(base.getTime() + k * stepDays * 864e5);
    if (t > rangeEnd || (endLimit && t > endLimit)) break;
    if (t >= new Date(fromIso)) {
      out.push({ ...ev, occurrence_start: t.toISOString(), occurrence_end: endAt ? new Date(t.getTime() + span).toISOString() : null, is_occurrence: 1, occurrence_id: 'rec-' + ev.id + '-' + t.toISOString() });
    }
    if (out.length >= limit) return;
    if (k * stepDays * 864e5 > 366 * 8 * 864e5) break; // safety
  }
}

// ---------- list (aggregated + filtered + paged) ----------
function listEvents(user, q, opts = {}) {
  const scope = scopeFilter(user, !!opts.allScope);
  const from = q.from ? new Date(q.from).toISOString() : new Date(Date.now() - 2 * 864e5).toISOString();
  const to = q.to ? new Date(q.to).toISOString() : new Date(Date.now() + 30 * 864e5).toISOString();
  const perPage = Math.min(Number(q.per_page) || 500, 1000);
  const page = Math.max(1, Number(q.page) || 1);
  const type = q.type && EVENT_TYPES[q.type] ? q.type : null;
  const status = q.status && STATUS.includes(q.status) ? q.status : null;
  const prio = q.priority && PRIORITIES.includes(q.priority) ? q.priority : null;
  const userId = q.user_id ? Number(q.user_id) : null;
  const dept = q.department || null;
  const customerId = q.customer_id ? Number(q.customer_id) : null;
  const search = q.q ? String(q.q).trim() : null;

  const events = [];
  // 1) first-class calendar events (with recurrence expansion)
  const sw = calScopeWhere(user, scope);
  let sql = 'SELECT e.* FROM calendar_events e WHERE e.archived_at IS NULL AND e.start_at <= ? AND (e.end_at IS NULL OR e.end_at >= ?)';
  const params = [to, from];
  if (sw.sql) { sql += ' AND ' + sw.sql; params.push(...sw.params); }
  if (type) { sql += ' AND e.type = ?'; params.push(type); }
  if (status) { sql += ' AND e.status = ?'; params.push(status); }
  if (prio) { sql += ' AND e.priority = ?'; params.push(prio); }
  if (userId) { sql += ' AND e.user_id = ?'; params.push(userId); }
  if (dept) { sql += ' AND EXISTS (SELECT 1 FROM users u2 WHERE u2.id = e.user_id AND u2.department = ?)'; params.push(dept); }
  if (customerId) { sql += ' AND e.customer_id = ?'; params.push(customerId); }
  if (search) { sql += ' AND (e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ?)'; const p = '%' + likeEscape(search) + '%'; params.push(p, p, p); }
  for (const row of d().prepare(sql).all(...params)) {
    row._base_jd = 0;
    // base Shamsi day for month/year recurrence anchoring
    const g = new Date(row.start_at);
    row._base_jd = gregorianToJalaali(g.getFullYear(), g.getMonth() + 1, g.getDate())[2];
    expandRecurrence(row, from, to, events, 500);
  }
  for (const ev of events) {
    const numId = Number(String(ev.id).replace('cal-', ''));
    ev.source = 'calendar_event';
    ev.id = 'cal-' + ev.id;
    ev.ref_type = ev.ref_type || 'calendar_event';
    ev.ref_id = ev.ref_id || numId;
    ev.color = ev.color || (EVENT_TYPES[ev.type] && EVENT_TYPES[ev.type].color) || '#666';
    ev.customer = customerOf(ev.customer_id);
    ev.users = userByIds([ev.user_id].filter(Boolean).concat((ev.participant_ids || '').split(',').map(x => x.trim()).filter(Boolean)));
    ev.editable = true;
  }
  // 2) derived module events (read-only, link to source record)
  addDerived(events, user, scope, { from, to, type, status, prio, userId, dept, customerId, search });
  // search on derived
  if (search) {
    const s = likeEscape(search);
    for (const ev of events) {
      const hay = [ev.title, ev.customer && ev.customer.name, ev.users && ev.users.map(u => u.full_name).join(' ')].filter(Boolean).join(' ');
      if (!hay.toLowerCase().includes(s.toLowerCase())) ev._drop = true;
    }
  }
  let all = events.filter(e => !e._drop);
  if (scope === 'own') {
    // First-class calendar events: only the user's own (editable ones carry users[]).
    // Derived module events (tasks/meetings/followups, editable=false) were ALREADY
    // individually scoped in addDerived (assignee/creator/owner === user or same
    // department) — they must NOT be dropped here, otherwise an 'own'-scoped user
    // (e.g. sales) would never see their own task deadlines/meetings in the calendar.
    all = all.filter(e => e.editable ? (e.users && e.users.some(u => u.id === user.id)) : true);
  }
  all.sort((a, b) => String(a.occurrence_start || a.start).localeCompare(String(b.occurrence_start || b.start)));
  const total = all.length;
  const slice = all.slice((page - 1) * perPage, page * perPage);
  const holidays = q.holidays === '1' || q.holidays === 'true' ? holidaysFor(user, from, to) : [];
  return { events: slice, holidays, total, page, per_page: perPage, types: Object.fromEntries(EVENT_TYPE_KEYS.map(k => [k, EVENT_TYPES[k].fa])), types_colors: Object.fromEntries(EVENT_TYPE_KEYS.map(k => [k, EVENT_TYPES[k].color])) };
}
function addDerived(events, user, scope, f) {
  const ddb = d();
  const sameDept = (uid, dept) => { if (!dept) return false; const u = ddb.prepare('SELECT department FROM users WHERE id=?').get(uid); return !!(u && u.department && u.department === dept); };
  const push = (ev) => { if (f.type && ev.type !== f.type) return; if (f.prio && ev.priority !== f.prio) return; if (f.status && ev.status && ev.status !== f.status) return; events.push(ev); };
  // meetings
  for (const m of ddb.prepare(`SELECT m.*, cu.name customer_name, u.full_name user_name FROM meetings m LEFT JOIN customers cu ON cu.id=m.customer_id LEFT JOIN users u ON u.id=m.created_by WHERE m.start_at>=? AND m.start_at<=? AND m.status!='cancelled'`).all(f.from, f.to)) {
    if (scope !== 'all' && m.created_by !== user.id && !sameDept(m.created_by, user.department)) continue;
    if (f.userId && m.created_by !== f.userId) continue;
    if (f.customerId && m.customer_id !== f.customerId) continue;
    push({ id: 'mtg-' + m.id, source: 'meeting', type: 'meeting', title: m.title, start: m.start_at, end: m.end_at, occurrence_start: m.start_at, status: m.status, priority: 'medium', ref_type: 'meeting', ref_id: m.id, customer: m.customer_name ? { id: m.customer_id, name: m.customer_name } : null, users: m.user_name ? [{ id: m.created_by, full_name: m.user_name }] : [], location: m.location, color: EVENT_TYPES.meeting.color, editable: false, url: '/meetings' });
  }
  // tasks
  // done tasks remain visible on the calendar (strikethrough in the UI) — history
  // is never removed, only the status is reflected.
  for (const t of ddb.prepare(`SELECT t.*, cu.name customer_name, u.full_name user_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN customers cu ON cu.id=t.related_id WHERE t.due_at IS NOT NULL AND t.due_at>=? AND t.due_at<=? AND t.status IN ('open','in_progress','done')`).all(f.from, f.to)) {
    const uid = t.assignee_id || t.created_by;
    if (scope !== 'all' && uid !== user.id && !sameDept(uid, user.department)) continue;
    if (f.userId && uid !== f.userId) continue;
    if (f.priority && t.priority !== f.priority) continue;
    if (f.customerId && !(t.related_type === 'customer' && t.related_id === f.customerId)) continue;
    push({ id: 'task-' + t.id, source: 'task', type: 'task', title: t.title, start: t.due_at, end: null, occurrence_start: t.due_at, status: t.status, priority: t.priority, ref_type: 'task', ref_id: t.id, customer: t.related_type === 'customer' && t.customer_name ? { id: t.related_id, name: t.customer_name } : null, users: t.user_name ? [{ id: uid, full_name: t.user_name }] : [], color: EVENT_TYPES.task.color, editable: false, url: '/tasks' });
  }
  // followups
  // pending/done/missed followups all remain visible (the UI strikethroughs
  // done/missed) — a completed/missed record must NOT disappear from the calendar.
  for (const fu of ddb.prepare(`SELECT fu.*, cu.name customer_name, u.full_name user_name FROM followups fu LEFT JOIN customers cu ON cu.id=fu.entity_id LEFT JOIN users u ON u.id=fu.user_id WHERE fu.due_at>=? AND fu.due_at<=? AND fu.status IN ('pending','in_progress','done','no_result','missed','cancelled')`).all(f.from, f.to)) {
    if (scope !== 'all' && fu.user_id !== user.id && !sameDept(fu.user_id, user.department)) continue;
    if (f.userId && fu.user_id !== f.userId) continue;
    if (f.customerId && !(fu.entity_type === 'customer' && fu.entity_id === f.customerId)) continue;
    push({ id: 'fu-' + fu.id, source: 'followup', type: 'followup', title: fu.subject || ('پیگیری ' + (fu.entity_type || '')), start: fu.due_at, end: null, occurrence_start: fu.due_at, status: fu.status, priority: 'medium', ref_type: 'followup', ref_id: fu.id, customer: fu.entity_type === 'customer' && fu.customer_name ? { id: fu.entity_id, name: fu.customer_name } : null, users: fu.user_name ? [{ id: fu.user_id, full_name: fu.user_name }] : [], color: EVENT_TYPES.followup.color, editable: false, url: '/followups' });
  }
  // follow-up attempt reminders (next follow-up dates inside the visible range)
  for (const a of ddb.prepare(`SELECT fa.*, fu.subject fu_subject, fu.entity_type fu_entity_type, fu.entity_id fu_entity_id, cu.name customer_name, u.full_name user_name FROM followup_attempts fa JOIN followups fu ON fu.id=fa.followup_id LEFT JOIN customers cu ON cu.id=fu.entity_id LEFT JOIN users u ON u.id=fa.user_id WHERE fa.next_followup_at>=? AND fa.next_followup_at<=?`).all(f.from, f.to)) {
    if (f.customerId && !(a.fu_entity_type === 'customer' && a.fu_entity_id === f.customerId)) continue;
    push({ id: 'fa-' + a.id, source: 'followup', type: 'followup', title: (a.fu_subject || 'پیگیری') + ' — پیگیری بعدی', start: a.next_followup_at, end: null, occurrence_start: a.next_followup_at, status: 'pending', priority: 'high', ref_type: 'followup', ref_id: a.followup_id, customer: a.fu_entity_type === 'customer' && a.customer_name ? { id: a.fu_entity_id, name: a.customer_name } : null, users: a.user_name ? [{ id: a.user_id, full_name: a.user_name }] : [], color: EVENT_TYPES.followup.color, editable: false, url: '/followups' });
  }
  // opportunity close
  for (const o of ddb.prepare(`SELECT o.*, cu.name customer_name FROM opportunities o LEFT JOIN customers cu ON cu.id=o.customer_id WHERE o.expected_close_at IS NOT NULL AND o.expected_close_at>=? AND o.expected_close_at<=? AND o.status='open'`).all(f.from, f.to)) {
    if (f.customerId && o.customer_id !== f.customerId) continue;
    push({ id: 'opp-' + o.id, source: 'opportunity', type: 'sales', title: 'بسته شدن: ' + o.title, start: o.expected_close_at, end: null, occurrence_start: o.expected_close_at, status: 'open', priority: 'medium', ref_type: 'opportunity', ref_id: o.id, customer: o.customer_name ? { id: o.customer_id, name: o.customer_name } : null, color: EVENT_TYPES.sales.color, editable: false, url: '/opportunities' });
  }
  // invoice due (payment deadline)
  for (const i of ddb.prepare(`SELECT i.*, cu.name customer_name FROM invoices i LEFT JOIN customers cu ON cu.id=i.customer_id WHERE i.due_date IS NOT NULL AND i.due_date>=? AND i.due_date<=? AND i.status IN ('unpaid','partial','overdue')`).all(f.from, f.to)) {
    if (f.customerId && i.customer_id !== f.customerId) continue;
    push({ id: 'inv-' + i.id, source: 'invoice', type: 'deadline', title: 'سررسید فاکتور ' + i.number, start: i.due_date, end: null, occurrence_start: i.due_date, status: i.status, priority: i.status === 'overdue' ? 'critical' : 'high', ref_type: 'invoice', ref_id: i.id, customer: i.customer_name ? { id: i.customer_id, name: i.customer_name } : null, color: EVENT_TYPES.deadline.color, editable: false, url: '/invoices' });
  }
  // contract expiry (30-day horizon)
  const horizon = new Date(new Date(f.to).getTime() + 30 * 864e5).toISOString();
  for (const ct of ddb.prepare(`SELECT ct.*, cu.name customer_name FROM contracts ct LEFT JOIN customers cu ON cu.id=ct.customer_id WHERE ct.end_date IS NOT NULL AND ct.end_date>=date(?, 'start of day') AND ct.end_date<=? AND ct.status IN ('active','draft')`).all(f.from, horizon)) {
    if (f.customerId && ct.customer_id !== f.customerId) continue;
    const days = Math.ceil((new Date(ct.end_date) - new Date(f.from)) / 864e5);
    push({ id: 'ct-' + ct.id, source: 'contract', type: 'contract_expiry', title: 'پایان قرارداد: ' + ct.title, start: ct.end_date, end: null, occurrence_start: ct.end_date, status: ct.status, priority: days <= 7 ? 'critical' : days <= 30 ? 'high' : 'medium', ref_type: 'contract', ref_id: ct.id, customer: ct.customer_name ? { id: ct.customer_id, name: ct.customer_name } : null, color: EVENT_TYPES.contract_expiry.color, editable: false, url: '/contracts', note: days + ' روز تا انقضا' });
  }
  // lab due
  for (const l of ddb.prepare(`SELECT l.*, cu.name customer_name FROM lab_requests l LEFT JOIN customers cu ON cu.id=l.customer_id WHERE l.due_at IS NOT NULL AND l.due_at>=? AND l.due_at<=? AND l.status IN ('received','in_progress')`).all(f.from, f.to)) {
    if (f.customerId && l.customer_id !== f.customerId) continue;
    push({ id: 'lab-' + l.id, source: 'lab_request', type: 'lab', title: 'سررسید آزمایش ' + l.number, start: l.due_at, end: null, occurrence_start: l.due_at, status: l.status, priority: l.priority || 'medium', ref_type: 'lab_request', ref_id: l.id, customer: l.customer_name ? { id: l.customer_id, name: l.customer_name } : null, color: EVENT_TYPES.lab.color, editable: false, url: '/lab/requests' });
  }
  // complaint SLA / ticket SLA
  for (const cp of ddb.prepare(`SELECT cp.*, cu.name customer_name FROM complaints cp LEFT JOIN customers cu ON cu.id=cp.customer_id WHERE cp.due_at IS NOT NULL AND cp.due_at>=? AND cp.due_at<=? AND cp.status IN ('new','in_progress','waiting')`).all(f.from, f.to)) {
    if (f.customerId && cp.customer_id !== f.customerId) continue;
    push({ id: 'cmp-' + cp.id, source: 'complaint', type: 'qc', title: 'SLA شکایت ' + cp.number, start: cp.due_at, end: null, occurrence_start: cp.due_at, status: cp.status, priority: cp.priority, ref_type: 'complaint', ref_id: cp.id, customer: cp.customer_name ? { id: cp.customer_id, name: cp.customer_name } : null, color: EVENT_TYPES.qc.color, editable: false, url: '/complaints' });
  }
  for (const tk of ddb.prepare(`SELECT tk.*, cu.name customer_name FROM tickets tk LEFT JOIN customers cu ON cu.id=tk.customer_id WHERE tk.sla_due_at IS NOT NULL AND tk.sla_due_at>=? AND tk.sla_due_at<=? AND tk.status IN ('open','in_progress')`).all(f.from, f.to)) {
    if (f.customerId && tk.customer_id !== f.customerId) continue;
    push({ id: 'tkt-' + tk.id, source: 'ticket', type: 'qc', title: 'SLA تیکت ' + tk.number, start: tk.sla_due_at, end: null, occurrence_start: tk.sla_due_at, status: tk.status, priority: tk.priority, ref_type: 'ticket', ref_id: tk.id, customer: tk.customer_name ? { id: tk.customer_id, name: tk.customer_name } : null, color: EVENT_TYPES.qc.color, editable: false, url: '/tickets' });
  }
}

// ---------- single event ----------
function getEvent(user, id) {
  scopeFilter(user);
  const n = Number(id);
  if (!Number.isFinite(n)) throw new HttpError(404, 'NOT_FOUND', 'رویداد پیدا نشد.');
  const row = d().prepare('SELECT * FROM calendar_events WHERE id=? AND archived_at IS NULL').get(n);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رویداد پیدا نشد.');
  const scope = scopeFilter(user);
  if (scope !== 'all' && row.user_id !== user.id && row.created_by !== user.id) {
    const u = d().prepare('SELECT department FROM users WHERE id=?').get(row.user_id || 0);
    if (!u || !u.department || u.department !== user.department) throw new HttpError(403, 'FORBIDDEN', 'دسترسی ندارید.');
  }
  const history = d().prepare("SELECT a.*, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity='calendar_event' AND a.entity_id=? ORDER BY a.id DESC LIMIT 30").all(n);
  const files = d().prepare('SELECT id, file_name, mime, size, created_at FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY id DESC').all('calendar_event', n);
  const users = userByIds([row.user_id].filter(Boolean).concat((row.participant_ids || '').split(',').map(x => x.trim()).filter(Boolean)));
  return { ...row, user_name: (users.find(u => u.id === row.user_id) || {}).full_name || null, participants: users.filter(u => u.id !== row.user_id), customer: customerOf(row.customer_id), color: row.color || (EVENT_TYPES[row.type] && EVENT_TYPES[row.type].color), history, files, type_fa: EVENT_TYPES[row.type] ? EVENT_TYPES[row.type].fa : row.type };
}

// ---------- create / update / delete / move ----------
const LINK_FIELDS = { customer_id: 'customers', contact_id: null, lead_id: 'leads', opportunity_id: 'opportunities', task_id: 'tasks', contract_id: 'contracts', complaint_id: 'complaints', ticket_id: 'tickets', warranty_id: 'warranties', project_id: null };
function validateEventBody(b, partial = false) {
  const out = {};
  if (!partial || b.title !== undefined) {
    if (!b.title || !String(b.title).trim()) throw new HttpError(422, 'VALIDATION', 'عنوان الزامی است.');
    out.title = String(b.title).trim().slice(0, 200);
  }
  if (!partial || b.type !== undefined) {
    if (!EVENT_TYPES[b.type]) throw new HttpError(422, 'VALIDATION', 'نوع رویداد نامعتبر است.');
    out.type = b.type;
  }
  if (!partial || b.start_at !== undefined) {
    out.start_at = isoOrThrow(b.start_at, 'تاریخ شروع');
  }
  if (b.end_at !== undefined) out.end_at = b.end_at ? isoOrThrow(b.end_at, 'تاریخ پایان') : null;
  if (b.all_day !== undefined) out.all_day = b.all_day ? 1 : 0;
  if (b.user_id !== undefined) out.user_id = b.user_id ? Number(b.user_id) : null;
  if (b.participant_ids !== undefined) out.participant_ids = b.participant_ids ? String(b.participant_ids) : null;
  for (const [k, tbl] of Object.entries(LINK_FIELDS)) {
    if (b[k] !== undefined) {
      const v = b[k] ? Number(b[k]) : null;
      if (v && tbl) {
        const ok = d().prepare('SELECT id FROM ' + tbl + ' WHERE id=?').get(v);
        if (!ok) throw new HttpError(422, 'VALIDATION', 'رکورد مرتبط پیدا نشد (' + k + ')');
      }
      out[k] = v;
    }
  }
  if (b.ref_type !== undefined) out.ref_type = b.ref_type || null;
  if (b.ref_id !== undefined) out.ref_id = b.ref_id ? Number(b.ref_id) : null;
  if (b.description !== undefined) out.description = b.description || null;
  if (b.location !== undefined) out.location = b.location || null;
  if (b.online_url !== undefined) out.online_url = b.online_url || null;
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) throw new HttpError(422, 'VALIDATION', 'اولویت نامعتبر است.');
    out.priority = b.priority;
  }
  if (b.status !== undefined) {
    if (!STATUS.includes(b.status)) throw new HttpError(422, 'VALIDATION', 'وضعیت نامعتبر است.');
    out.status = b.status;
  }
  if (b.reminder_minutes !== undefined) {
    const v = b.reminder_minutes;
    if (v === null || v === '' || v === 0) out.reminder_minutes = null;
    else { const n = Number(v); if (!Number.isFinite(n) || n < 1 || n > 1440 * 14) throw new HttpError(422, 'VALIDATION', 'یادآوری نامعتبر است.'); out.reminder_minutes = n; }
  }
  if (b.recurrence !== undefined) {
    if (!RECURRENCES.includes(b.recurrence)) throw new HttpError(422, 'VALIDATION', 'تکرار نامعتبر است.');
    out.recurrence = b.recurrence;
  }
  if (b.recurrence_rule !== undefined) out.recurrence_rule = b.recurrence_rule ? (typeof b.recurrence_rule === 'string' ? b.recurrence_rule : JSON.stringify(b.recurrence_rule)) : null;
  if (b.recurrence_end_at !== undefined) out.recurrence_end_at = b.recurrence_end_at ? isoOrThrow(b.recurrence_end_at, 'پایان تکرار') : null;
  if (b.color !== undefined) out.color = b.color || null;
  return out;
}
function createEvent(user, body) {
  requirePerm(user, 'calendar_event', 'create');
  const b = validateEventBody(body || {});
  b.start_at = b.start_at || nowIso();
  if (!b.start_at) throw new HttpError(422, 'VALIDATION', 'تاریخ شروع الزامی است.');
  b.user_id = b.user_id || user.id;
  b.priority = b.priority || 'medium';
  b.status = b.status || 'scheduled';
  b.recurrence = b.recurrence || 'none';
  b.created_by = user.id; b.created_at = nowIso(); b.version = 1;
  const keys = Object.keys(b);
  const info = d().prepare(`INSERT INTO calendar_events(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => b[k]));
  const id = Number(info.lastInsertRowid);
  audit(user, 'calendar_event', id, 'create', null, { title: b.title, start_at: b.start_at, end_at: b.end_at || null, type: b.type });
  d().prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,?,?,?,?)').run('calendar_event', id, user.id, 'create', 'ایجاد رویداد تقویم: ' + b.title, nowIso());
  const rec = d().prepare('SELECT * FROM calendar_events WHERE id=?').get(id);
  notifyParticipants(rec, user, 'تقویم: رویداد جدید', `«${b.title}» — ${new Date(b.start_at).toDateString()}`, id);
  return { id, item: getEvent(user, id) };
}
function updateEvent(user, id, body) {
  const n = Number(id);
  const row = d().prepare('SELECT * FROM calendar_events WHERE id=? AND archived_at IS NULL').get(n);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رویداد پیدا نشد.');
  const scope = hasPerm(user, 'calendar_event', 'edit');
  if (!scope.ok || (scope.scope !== 'all' && row.user_id !== user.id && row.created_by !== user.id)) {
    const u = d().prepare('SELECT department FROM users WHERE id=?').get(row.user_id || 0);
    if (!(scope.ok && scope.scope !== 'own' && u && u.department === user.department)) throw new HttpError(403, 'FORBIDDEN', 'شما مجوز ویرایش این رویداد را ندارید.');
  }
  const b = validateEventBody(body || {}, true);
  if (!Object.keys(b).length) return { ok: true };
  const old = { start_at: row.start_at, end_at: row.end_at, title: row.title, status: row.status, user_id: row.user_id, priority: row.priority, reminder_minutes: row.reminder_minutes, location: row.location, customer_id: row.customer_id };
  if (b.reminder_minutes !== undefined) b.reminder_sent_at = null; // re-arm reminder
  const keys = Object.keys(b);
  d().prepare(`UPDATE calendar_events SET ${keys.map(k => k + '=?').join(',')}, updated_by=?, updated_at=?, version=version+1 WHERE id=?`).run(...keys.map(k => b[k]), user.id, nowIso(), n);
  const changed = {};
  for (const k of Object.keys(old)) if (b[k] !== undefined && String(b[k] ?? '') !== String(old[k] ?? '')) changed[k] = { old: old[k] ?? null, new: b[k] ?? null };
  audit(user, 'calendar_event', n, 'update', old, { ...changed, title: b.title !== undefined ? b.title : row.title });
  d().prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,?,?,?,?)').run('calendar_event', n, user.id, 'update', 'ویرایش رویداد تقویم' + (changed.start_at ? ' (تاریخ: ' + (changed.start_at.old || '—') + ' → ' + changed.start_at.new + ')' : ''), nowIso());
  const rec = d().prepare('SELECT * FROM calendar_events WHERE id=?').get(n);
  if (b.start_at !== undefined || b.user_id !== undefined) notifyParticipants(rec, user, 'تقویم: رویداد ویرایش شد', `«${rec.title}» — ${new Date(rec.start_at).toDateString()}`, n);
  return { ok: true, item: getEvent(user, n) };
}
function deleteEvent(user, id) {
  const n = Number(id);
  const row = d().prepare('SELECT * FROM calendar_events WHERE id=? AND archived_at IS NULL').get(n);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رویداد پیدا نشد.');
  const scope = hasPerm(user, 'calendar_event', 'delete');
  if (!scope.ok) {
    const u = d().prepare('SELECT department FROM users WHERE id=?').get(row.user_id || 0);
    if (!(row.user_id === user.id || row.created_by === user.id || (u && u.department === user.department && scope.scope === 'team'))) throw new HttpError(403, 'FORBIDDEN', 'شما مجوز حذف این رویداد را ندارید.');
  }
  const old = { title: row.title, start_at: row.start_at, end_at: row.end_at, type: row.type };
  d().prepare('DELETE FROM calendar_events WHERE id=?').run(n);
  d().prepare('DELETE FROM attachments WHERE entity_type=? AND entity_id=?').run('calendar_event', n);
  audit(user, 'calendar_event', n, 'delete', old, null);
  d().prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,?,?,?,?)').run('calendar_event', n, user.id, 'delete', 'حذف رویداد تقویم: ' + row.title, nowIso());
  return { ok: true };
}
// drag & drop: shift an event (or its whole series) to a new start
function moveEvent(user, id, body) {
  const n = Number(id);
  const row = d().prepare('SELECT * FROM calendar_events WHERE id=? AND archived_at IS NULL').get(n);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رویداد پیدا نشد.');
  const newStart = isoOrThrow(body && (body.start_at || body.date), 'تاریخ جدید');
  let newEnd = null;
  if (body && body.end_at) newEnd = isoOrThrow(body.end_at, 'پایان جدید');
  else if (row.end_at) {
    const span = new Date(row.end_at) - new Date(row.start_at);
    newEnd = new Date(new Date(newStart).getTime() + span).toISOString();
  }
  // if the event was dragged as a recurrence occurrence → shift the whole series by the delta
  const oldStart = new Date(row.start_at);
  const target = new Date(newStart);
  let appliedStart = newStart, appliedEnd = newEnd;
  let seriesShifted = false;
  if (row.recurrence !== 'none' && row.recurrence && newStart !== row.start_at) {
    const delta = Math.round((target.getTime() - oldStart.getTime()) / 864e5) * 864e5 + ((target.getTime() - oldStart.getTime()) % 864e5);
    appliedStart = new Date(oldStart.getTime() + (target - oldStart)).toISOString();
    seriesShifted = Math.abs(target - oldStart) > 0;
  }
  const upd = { start_at: appliedStart, updated_by: user.id, updated_at: nowIso(), version: row.version + 1 };
  if (newEnd !== null) upd.end_at = appliedEnd;
  const keys = Object.keys(upd);
  d().prepare(`UPDATE calendar_events SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`).run(...keys.map(k => upd[k]), n);
  audit(user, 'calendar_event', n, 'move', { start_at: row.start_at, end_at: row.end_at }, { start_at: appliedStart, end_at: upd.end_at !== undefined ? upd.end_at : row.end_at, series_shifted: seriesShifted });
  d().prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,?,?,?,?)').run('calendar_event', n, user.id, 'move', 'جابه‌جایی رویداد در تقویم: ' + row.title, nowIso());
  return { ok: true, start_at: appliedStart, end_at: upd.end_at !== undefined ? upd.end_at : row.end_at, series_shifted: seriesShifted };
}
function markEvent(user, id, done) {
  const n = Number(id);
  const row = d().prepare('SELECT * FROM calendar_events WHERE id=? AND archived_at IS NULL').get(n);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'رویداد پیدا نشد.');
  const status = done ? 'done' : 'scheduled';
  requirePerm(user, 'calendar_event', 'edit');
  d().prepare('UPDATE calendar_events SET status=?, updated_by=?, updated_at=? WHERE id=?').run(status, user.id, nowIso(), n);
  audit(user, 'calendar_event', n, 'status', { status: row.status }, { status });
  return { ok: true, status };
}
function notifyParticipants(rec, user, title, bodyText, id) {
  const ids = [rec.user_id, ...(rec.participant_ids || '').split(',').map(x => x.trim()).filter(Boolean)].filter(x => x && Number(x) !== user.id);
  for (const uid of [...new Set(ids.map(Number))]) {
    notify(uid, 'calendar_event', title, bodyText, 'calendar_event', id, user.id);
  }
}

// ---------- today / upcoming / overdue ----------
function dayRangeJalaali(jy, jm, jd, hour = 0) {
  const g = require('../../lib/jalali').jalaaliToGregorian(jy, jm, jd);
  const s = new Date(g[0], g[1] - 1, g[2], hour, 0, 0);
  const e = new Date(g[0], g[1] - 1, g[2], 23, 59, 59);
  return { from: s.toISOString(), to: e.toISOString() };
}
function jRange(isoFrom, isoTo) {
  const a = new Date(isoFrom), b = new Date(isoTo);
  return { from: isoFrom, to: isoTo, fromJ: gregorianToJalaali(a.getFullYear(), a.getMonth() + 1, a.getDate()), toJ: gregorianToJalaali(b.getFullYear(), b.getMonth() + 1, b.getDate()) };
}
function todayPlan(user, opts = {}) {
  const t = nowTehran();
  const g = require('../../lib/jalali').jalaaliToGregorian(t.jy, t.jm, t.jd);
  const localToday = new Date(g[0], g[1] - 1, g[2]);
  const from = new Date(localToday.getTime() - localToday.getTimezoneOffset() * 60000).toISOString();
  const to = new Date(localToday.getTime() + 864e5 - localToday.getTimezoneOffset() * 60000).toISOString();
  const all = listEvents(user, { from, to, per_page: 500 }, opts);
  const now = Date.now();
  const overdue = overdueFor(user, opts);
  const grouped = { meetings: [], followups: [], tasks: [], deadlines: [], reminders: [], others: [], upcoming_reminders: [] };
  for (const ev of all.events) {
    const item = { id: ev.id, type: ev.type, type_fa: EVENT_TYPES[ev.type] ? EVENT_TYPES[ev.type].fa : ev.type, title: ev.title, start: ev.occurrence_start || ev.start, end: ev.end, customer: ev.customer, status: ev.status, url: ev.url, ref_type: ev.ref_type, ref_id: ev.ref_id, source: ev.source };
    const st = new Date(item.start).getTime();
    if (ev.source === 'calendar_event' && ev.reminder_minutes) grouped.upcoming_reminders.push({ ...item, in_minutes: Math.max(0, Math.round((st - now) / 60000)) });
    switch (ev.type) {
      case 'meeting': grouped.meetings.push(item); break;
      case 'followup': grouped.followups.push(item); break;
      case 'task': grouped.tasks.push(item); break;
      case 'deadline': case 'contract_expiry': grouped.deadlines.push(item); break;
      case 'reminder': grouped.reminders.push(item); break;
      default: grouped.others.push(item);
    }
  }
  for (const grp of Object.values(grouped)) grp.sort((a, b) => a.start < b.start ? -1 : 1);
  return { date: { jy: t.jy, jm: t.jm, jd: t.jd }, counts: { total: all.events.length, meetings: grouped.meetings.length, followups: grouped.followups.length, tasks: grouped.tasks.length, deadlines: grouped.deadlines.length, overdue: overdue.items.length }, grouped, overdue: overdue.items.slice(0, 20) };
}
function upcoming(user, range) {
  const t = nowTehran();
  const jr = require('../../lib/jalali');
  let jf, jt;
  const [jy0, jm0, jd0] = [t.jy, t.jm, t.jd];
  const addDays = (jy, jm, jd, n) => {
    const g = jr.jalaaliToGregorian(jy, jm, jd);
    const dt = new Date(g[0], g[1] - 1, g[2]);
    dt.setDate(dt.getDate() + n);
    return gregorianToJalaali(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  };
  const wd = (jf) => { const g = jr.jalaaliToGregorian(jf[0], jf[1], jf[2]); return (new Date(g[0], g[1] - 1, g[2]).getDay() + 1) % 7; }; // 0=Sat
  if (range === 'today') { jf = [jy0, jm0, jd0]; jt = [jy0, jm0, jd0]; }
  else if (range === 'tomorrow') { jf = addDays(jy0, jm0, jd0, 1); jt = addDays(jy0, jm0, jd0, 1); }
  else if (range === 'next_week') { const s = addDays(jy0, jm0, jd0, 7 - wd([jy0, jm0, jd0])); jf = s; jt = addDays(s[0], s[1], s[2], 6); }
  else { // this_week (default)
    const s = addDays(jy0, jm0, jd0, -wd([jy0, jm0, jd0])); jf = s; jt = addDays(s[0], s[1], s[2], 6);
  }
  const r1 = dayRangeJalaali(jf[0], jf[1], jf[2]);
  const r2 = dayRangeJalaali(jt[0], jt[1], jt[2]);
  const all = listEvents(user, { from: r1.from, to: r2.to, per_page: 500 });
  const byDay = {};
  for (const ev of all.events) {
    const j = gregorianToJalaali(new Date(ev.occurrence_start || ev.start).getFullYear(), new Date(ev.occurrence_start || ev.start).getMonth() + 1, new Date(ev.occurrence_start || ev.start).getDate());
    const key = j[0] + '-' + String(j[1]).padStart(2, '0') + '-' + String(j[2]).padStart(2, '0');
    (byDay[key] = byDay[key] || []).push({ id: ev.id, type: ev.type, type_fa: EVENT_TYPES[ev.type] ? EVENT_TYPES[ev.type].fa : ev.type, title: ev.title, start: ev.occurrence_start || ev.start, customer: ev.customer, status: ev.status, url: ev.url, ref_type: ev.ref_type, ref_id: ev.ref_id, source: ev.source });
  }
  return { range, from_j: jf, to_j: jt, days: byDay };
}
function overdueFor(user, opts = {}) {
  const now = nowIso();
  const items = [];
  const ddb = d();
  const scope = scopeFilter(user, !!opts.allScope);
  const sameDept = (uid, dept) => { if (!dept) return false; const u = ddb.prepare('SELECT department FROM users WHERE id=?').get(uid); return !!(u && u.department === dept); };
  for (const t of ddb.prepare(`SELECT * FROM tasks WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < ?`).all(now)) {
    const uid = t.assignee_id || t.created_by;
    if (scope !== 'all' && uid !== user.id && !sameDept(uid, user.department)) continue;
    items.push({ id: 'task-' + t.id, source: 'task', type: 'task', title: t.title, due: t.due_at, days_late: Math.max(1, Math.ceil((Date.now() - new Date(t.due_at)) / 864e5)), ref_type: 'task', ref_id: t.id, url: '/tasks' });
  }
  for (const fu of ddb.prepare(`SELECT * FROM followups WHERE status='pending' AND due_at < ?`).all(now)) {
    if (scope !== 'all' && fu.user_id !== user.id && !sameDept(fu.user_id, user.department)) continue;
    items.push({ id: 'fu-' + fu.id, source: 'followup', type: 'followup', title: fu.subject || 'پیگیری', due: fu.due_at, days_late: Math.max(1, Math.ceil((Date.now() - new Date(fu.due_at)) / 864e5)), ref_type: 'followup', ref_id: fu.id, url: '/followups' });
  }
  for (const ev of ddb.prepare(`SELECT * FROM calendar_events WHERE status='scheduled' AND start_at < ? AND archived_at IS NULL`).all(now)) {
    if (scope !== 'all' && ev.user_id !== user.id && ev.created_by !== user.id && !sameDept(ev.user_id, user.department)) continue;
    items.push({ id: 'cal-' + ev.id, source: 'calendar_event', type: ev.type, title: ev.title, due: ev.start_at, days_late: Math.max(1, Math.ceil((Date.now() - new Date(ev.start_at)) / 864e5)), ref_type: 'calendar_event', ref_id: ev.id, url: '/calendar' });
  }
  for (const cp of ddb.prepare(`SELECT * FROM complaints WHERE status IN ('new','in_progress','waiting') AND due_at IS NOT NULL AND due_at < ?`).all(now)) {
    items.push({ id: 'cmp-' + cp.id, source: 'complaint', type: 'qc', title: 'SLA شکایت ' + cp.number, due: cp.due_at, days_late: Math.max(1, Math.ceil((Date.now() - new Date(cp.due_at)) / 864e5)), ref_type: 'complaint', ref_id: cp.id, url: '/complaints' });
  }
  for (const tk of ddb.prepare(`SELECT * FROM tickets WHERE status IN ('open','in_progress') AND sla_due_at IS NOT NULL AND sla_due_at < ?`).all(now)) {
    items.push({ id: 'tkt-' + tk.id, source: 'ticket', type: 'qc', title: 'SLA تیکت ' + tk.number, due: tk.sla_due_at, days_late: Math.max(1, Math.ceil((Date.now() - new Date(tk.sla_due_at)) / 864e5)), ref_type: 'ticket', ref_id: tk.id, url: '/tickets' });
  }
  items.sort((a, b) => a.due < b.due ? -1 : 1);
  return { items, total: items.length };
}

// ---------- holidays (Shamsi, configurable) ----------
function holidaysFor(user, fromIso, toIso) {
  const list = getSetting('holidays', null) || DEFAULT_HOLIDAYS;
  const out = [];
  const a = new Date(fromIso), b = new Date(toIso);
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const [jy, jm, jd] = gregorianToJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const hits = list.filter(h => (!h.jy || h.jy === jy) && h.jm === jm && h.jd === jd);
    if (hits.length) {
      // idempotent display: each holiday name appears at most once per day (guards against any stale duplicate rows)
      const seen = new Set(); const names = [];
      for (const h of hits) { const nm = String(h.name || '').trim(); if (nm && !seen.has(nm)) { seen.add(nm); names.push(nm); } }
      out.push({ iso: d.toISOString(), jy, jm, jd, names, official: hits.some(h => !h.custom) });
    }
  }
  return out;
}
function saveHolidays(user, body) {
  requirePerm(user, 'settings', 'edit');
  const list = Array.isArray(body.holidays) ? body.holidays : null;
  if (!list) throw new HttpError(422, 'VALIDATION', 'لیست تعطیلات نامعتبر است.');
  // validate + idempotent dedupe: one (jy|annual, jm, jd, name) entry only — duplicates can never be stored
  const seen = new Set();
  const out = [];
  for (const h of list) {
    if (!h || typeof h !== 'object') continue;
    const name = String(h.name || '').trim();
    const jm = Number(h.jm), jd = Number(h.jd);
    const jy = h.jy ? Number(h.jy) : null;
    if (!name || jm < 1 || jm > 12 || jd < 1 || jd > 31 || (jy && (jy < 1300 || jy > 1500))) continue;
    const key = (jy || 0) + '/' + jm + '/' + jd + '/' + name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ jm, jd, name, ...(jy ? { jy } : {}), ...(h.custom ? { custom: true } : {}) });
  }
  setSetting('holidays', out);
  return { ok: true, holidays: getSetting('holidays') };
}
function rawHolidays(user) {
  requirePerm(user, 'settings', 'edit');
  const list = getSetting('holidays', null) || DEFAULT_HOLIDAYS;
  // idempotent read: never surface duplicate (jy|annual, jm, jd, name) entries, even from stale data
  const seen = new Set(); const out = [];
  for (const h of list) {
    const name = String(h.name || '').trim();
    if (!name) continue;
    const key = (h.jy ? Number(h.jy) : 0) + '/' + Number(h.jm) + '/' + Number(h.jd) + '/' + name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ jm: Number(h.jm), jd: Number(h.jd), name, ...(h.jy ? { jy: Number(h.jy) } : {}), ...(h.custom ? { custom: true } : {}) });
  }
  return { holidays: out };
}

// ---------- team calendars ----------
function teams(user) {
  const ddb = d();
  const users = ddb.prepare("SELECT id, full_name, department, active FROM users WHERE active=1 AND archived_at IS NULL ORDER BY full_name").all();
  const depts = [...new Set(users.map(u => u.department).filter(Boolean))].sort();
  return { users: users.map(u => ({ id: u.id, full_name: u.full_name, department: u.department })), departments: depts, me: { id: user.id, full_name: user.full_name, department: user.department } };
}

// ---------- colors settings (per user) ----------
function colorSettings(user) {
  const colors = getUserSetting(user.id, 'calendar_colors', null);
  if (colors) return { colors };
  setUserSetting(user.id, 'calendar_colors', Object.fromEntries(EVENT_TYPE_KEYS.map(k => [k, EVENT_TYPES[k].color])));
  return { colors: getUserSetting(user.id, 'calendar_colors') };
}
function saveColorSettings(user, body) {
  const colors = (body && body.colors) || {};
  const out = Object.fromEntries(EVENT_TYPE_KEYS.map(k => [k, typeof colors[k] === 'string' ? colors[k] : EVENT_TYPES[k].color]));
  setUserSetting(user.id, 'calendar_colors', out);
  return { ok: true, colors: out };
}

// ---------- calendar AI (online + offline, confirmation before create) ----------
async function calendarAi(user, query) {
  const q = String(query || '').trim();
  if (!q) throw new HttpError(422, 'VALIDATION', 'پیام خالی است.');
  scopeFilter(user);
  const t = nowTehran();
  const jr = require('../../lib/jalali');
  const plan = todayPlan(user);
  const overdue = overdueFor(user);
  const next7 = listEvents(user, { from: plan.date ? new Date().toISOString() : new Date().toISOString(), to: new Date(Date.now() + 7 * 864e5).toISOString(), per_page: 200 });
  const context = {
    user: user.full_name,
    today: { jy: t.jy, jm: t.jm, jd: t.jd },
    today_events: plan.grouped, today_count: plan.counts.total,
    overdue_count: overdue.total, overdue_items: overdue.items.slice(0, 15),
    next_7_days: next7.events.map(e => ({ title: e.title, type: e.type, start: e.occurrence_start || e.start, customer: e.customer && e.customer.name })).slice(0, 40),
  };
  // ---- offline intent detection (always works, no internet needed) ----
  const offline = offlineCalendarIntent(user, q, context);
  if (offline && !q.includes('آنلاین')) {
    if (offline.draft) {
      return { text: offline.text, source: 'offline', intent: 'create_meeting', requires_confirmation: true, draft: offline.draft };
    }
    return { text: offline.text, source: 'offline', intent: offline.intent, data: offline.data || null };
  }
  // ---- online / local LLM with calendar context ----
  const system = 'تو دستیار تقویم CRM فارسی‌زبان هستی. فقط از دادهٔ تقویمِ کاربر استفاده کن. اگر کاربر خواست رویداد بسازد، JSON پیشنهادی با requires_confirmation بده (بدون ثبت). پاسخ کوتاه و کاربردی بده.';
  const res = await aigw.ask(user, 'calendar', 'chat', [{ role: 'user', content: q }], system, null);
  if (res && res.text) return { text: res.text, source: res.source, intent: 'assistant', context: { today_count: context.today_count, overdue_count: context.overdue_count } };
  // fallback to offline answer
  const off = offlineCalendarIntent(user, q, context);
  if (off) return { text: off.text, source: 'offline', intent: off.intent, data: off.data || null, requires_confirmation: !!off.draft, draft: off.draft || null };
  throw new HttpError(422, 'NO_ANSWER', 'نمی‌توانم این سؤال را درباره تقویم پاسخ دهم. مثال: «برنامهٔ فردای من چیست؟» یا «فعالیت‌های عقب‌افتاده را نشان بده.»');
}
function offlineCalendarIntent(user, q, ctx) {
  const norm = q.replace(/[يی]/g, 'ی');
  const fmtEv = (e) => `• [${e.type_fa || e.type}] ${e.title} — ${faDigits(new Date(e.start).getHours()).padStart(2, '۰')}:${faDigits(new Date(e.start).getMinutes()).padStart(2, '۰')}${e.customer ? ' — ' + e.customer.name : ''}`;
  if (/(عقب.?افتاده|تا.?خر|سررسید.?گذش|overdue)/.test(norm)) {
    const items = ctx.overdue_items.map(x => `• ${x.title} — ${x.days_late} روز تأخیر (${x.source})`).join('\n') || '—';
    return { intent: 'overdue', text: `فعالیت‌های عقب‌افتاده شما (${faDigits(ctx.overdue_count)} مورد):\n${items}`, data: ctx.overdue_items };
  }
  if (/(فردا|روز.?بعد).*(جلسه|برنامه|کار|فعالیت)|برای فردا/.test(norm) || (norm.includes('فردا') && /(چه|نماید|نشان)/.test(norm))) {
    const tom = upcomingEvents(user, 1);
    const lines = tom.map(fmtEv).join('\n') || 'برنامه‌ای برای فردا ندارید.';
    return { intent: 'tomorrow', text: `برنامهٔ فردای شما (${faDigits(tom.length)} مورد):\n${lines}`, data: tom };
  }
  // "schedule a meeting with customer X for next week" — checked before generic week intents
  const mMeet = norm.match(/(جلسه|برنامه.?ریزی|برنامه.?ریز)(.+?)(با|و)\s*(.+?)(?:\s+(?:برای|در)\s+(.+))?$/);
  if (mMeet) {
    const custName = (mMeet[4] || '').replace(/مشتری[:\s]*/g, '').trim();
    if (custName && custName.length > 1) {
      const c = d().prepare('SELECT id, name FROM customers WHERE name LIKE ? LIMIT 1').get('%' + likeEscape(custName) + '%');
      if (c) {
        const whenM = (mMeet[5] || norm).match(/(هفته.?آینده|هفته.?بعد|فردا|امروز|پس.?فردا)/);
        const offsetDays = whenM ? (/فردا/.test(whenM[1]) ? 1 : /امروز/.test(whenM[1]) ? 0 : /پس.?فردا/.test(whenM[1]) ? 2 : 7) : 7;
        const start = new Date(Date.now() + offsetDays * 864e5);
        start.setHours(10, 0, 0, 0);
        const draft = {
          title: 'جلسه با ' + c.name, type: 'meeting', customer_id: c.id,
          start_at: start.toISOString(), end_at: new Date(start.getTime() + 3600e3).toISOString(),
          priority: 'medium', status: 'scheduled', user_id: user.id,
          description: 'برنامه‌ریزی‌شده توسط AI تقویم',
        };
        const g = new Date(start);
        const [jy, jm, jd] = gregorianToJalaali(g.getFullYear(), g.getMonth() + 1, g.getDate());
        return { intent: 'create_meeting', text: `پیشنهاد من: «جلسه با ${c.name}» — ${faDigits(jy)}/${faDigits(String(jm).padStart(2, '0'))}/${faDigits(String(jd).padStart(2, '0'))} ساعت ${offsetDays === 0 ? 'امروز' : faDigits(String(start.getHours()).padStart(2, '0'))}:${faDigits(String(start.getMinutes()).padStart(2, '0'))}. تأیید می‌کنید تا در تقویم ثبت شود؟`, draft, requires_confirmation: true };
      }
    }
  }
  if (/(هفته.?آینده|هفته.?بعد)/.test(norm)) {
    const wk = upcomingEvents(user, 7, 14);
    const lines = wk.map(fmtEv).join('\n') || 'برنامه‌ای برای هفتهٔ آینده ندارید.';
    const meetings = wk.filter(e => e.type === 'meeting');
    const head = meetings.length ? `در هفتهٔ آینده ${faDigits(meetings.length)} جلسه دارید.` : 'در هفتهٔ آینده جلسه‌ای ندارید.';
    return { intent: 'next_week', text: head + '\n' + lines, data: wk };
  }
  if (/(امروز|این.?روز).*(جلسه|برنامه|کار|فعالیت)|برنامه.?امروز/.test(norm)) {
    const flat = Object.values(ctx.today_events).flat();
    const lines = flat.map(fmtEv).join('\n') || 'برنامه‌ای برای امروز ندارید.';
    return { intent: 'today', text: `برنامهٔ امروز (${faDigits(flat.length)} مورد):\n${lines}`, data: flat };
  }
  if (/(جلسه|برنامه|فعالیت|مهمان|کار)/.test(norm) && /(بررسی|نشان|بگو|چند|تعداد|لیست|چیز)/.test(norm)) {
    const flat = Object.values(ctx.today_events).flat();
    const lines = ctx.next_7_days.slice(0, 15).map(e => `• ${e.type} — ${e.title}${e.customer ? ' (' + e.customer + ')' : ''}`).join('\n') || '—';
    return { intent: 'review', text: `در ۷ روز آینده ${faDigits(ctx.next_7_days.length)} فعالیت دارید (امروز: ${faDigits(ctx.today_count)}, عقب‌افتاده: ${faDigits(ctx.overdue_count)}):\n${lines}`, data: null };
  }
  return null;
}
function upcomingEvents(user, fromDays, toDays) {
  const all = listEvents(user, { from: new Date(Date.now() + fromDays * 864e5).toISOString(), to: new Date(Date.now() + toDays * 864e5).toISOString(), per_page: 200 });
  return all.events;
}

// ---------- reports ----------
function report(user, q) {
  requirePerm(user, 'calendar_event', 'export');
  const scope = scopeFilter(user);
  const now = nowIso();
  const from = q.from ? new Date(q.from).toISOString() : new Date(Date.now() - 30 * 864e5).toISOString();
  const to = q.to ? new Date(q.to).toISOString() : now;
  const type = q.type && EVENT_TYPES[q.type] ? q.type : null;
  const status = q.status || null;
  const userId = q.user_id ? Number(q.user_id) : null;
  const customerId = q.customer_id ? Number(q.customer_id) : null;
  const ddb = d();
  const rows = [];
  const sw = calScopeWhere(user, scope);
  let sql = `SELECT e.*, u.full_name user_name, u.department dept, cu.name customer_name FROM calendar_events e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN customers cu ON cu.id=e.customer_id WHERE e.archived_at IS NULL AND e.start_at>=? AND e.start_at<=?`;
  const params = [from, to];
  if (sw.sql) { sql += ' AND ' + sw.sql; params.push(...sw.params); }
  if (type) { sql += ' AND e.type=?'; params.push(type); }
  if (status) { sql += ' AND e.status=?'; params.push(status); }
  if (userId) { sql += ' AND e.user_id=?'; params.push(userId); }
  if (customerId) { sql += ' AND e.customer_id=?'; params.push(customerId); }
  for (const r of ddb.prepare(sql + ' ORDER BY e.start_at').all(...params)) {
    rows.push({ source: 'calendar_event', id: r.id, title: r.title, type: r.type, type_fa: EVENT_TYPES[r.type] ? EVENT_TYPES[r.type].fa : r.type, start: r.start_at, end: r.end_at, user: r.user_name, department: r.dept, customer: r.customer_name, location: r.location, status: r.status, priority: r.priority, hours: r.end_at ? Math.max(0.25, (new Date(r.end_at) - new Date(r.start_at)) / 3600e3) : 1 });
  }
  // derived (module) rows within range
  const derived = [];
  for (const m of ddb.prepare(`SELECT m.*, u.full_name user_name, cu.name customer_name FROM meetings m LEFT JOIN users u ON u.id=m.created_by LEFT JOIN customers cu ON cu.id=m.customer_id WHERE m.start_at>=? AND m.start_at<=? AND m.status!='cancelled'`).all(from, to)) derived.push({ source: 'meeting', id: m.id, title: m.title, type: 'meeting', type_fa: 'جلسه', start: m.start_at, end: m.end_at, user: m.user_name, department: null, customer: m.customer_name, location: m.location, status: m.status, priority: 'medium', hours: m.end_at ? Math.max(0.25, (new Date(m.end_at) - new Date(m.start_at)) / 3600e3) : 1 });
  for (const t of ddb.prepare(`SELECT t.*, u.full_name user_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.due_at IS NOT NULL AND t.due_at>=? AND t.due_at<=?`).all(from, to)) derived.push({ source: 'task', id: t.id, title: t.title, type: 'task', type_fa: 'وظیفه', start: t.due_at, end: null, user: t.user_name, department: null, customer: null, location: null, status: t.status, priority: t.priority, hours: 1 });
  for (const fu of ddb.prepare(`SELECT fu.*, u.full_name user_name FROM followups fu LEFT JOIN users u ON u.id=fu.user_id WHERE fu.due_at>=? AND fu.due_at<=?`).all(from, to)) derived.push({ source: 'followup', id: fu.id, title: fu.subject || 'پیگیری', type: 'followup', type_fa: 'پیگیری', start: fu.due_at, end: null, user: fu.user_name, department: null, customer: null, location: null, status: fu.status, priority: 'medium', hours: 1 });
  if (!type && !customerId) rows.push(...derived);
  const all = rows;
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  const by = (f) => { const m = {}; for (const r of all) { const k = f(r) || '—'; m[k] = (m[k] || 0) + 1; } return m; };
  const summary = {
    total: all.length,
    done: all.filter(r => ['done', 'paid', 'converted', 'resolved', 'closed'].includes(r.status)).length,
    pending: all.filter(r => !['done', 'cancelled', 'rejected', 'closed'].includes(r.status)).length,
    overdue: all.filter(r => new Date(r.start) < new Date(now) && !['done', 'cancelled'].includes(r.status)).length,
    total_hours: Math.round(sum(all, r => r.hours) * 10) / 10,
    by_type: by(r => r.type_fa),
    by_status: by(r => r.status),
    by_user: by(r => r.user),
    by_department: by(r => r.department),
    by_customer: by(r => r.customer),
  };
  const perPage = Math.min(Number(q.per_page) || 500, 1000);
  const page = Math.max(1, Number(q.page) || 1);
  return { from, to, rows: all.slice((page - 1) * perPage, page * perPage), total: all.length, page, per_page: perPage, summary, range_fa: { from: jalExport(from), to: jalExport(to) } };
}
function reportExport(user, q, format) {
  const rep = report(user, q);
  const co = require('../../lib/print').company();
  const headers = ['نوع', 'عنوان', 'تاریخ', 'ساعت', 'پایان', 'مسئول', 'واحد', 'مشتری', 'مکان', 'وضعیت', 'اولویت', 'ساعت'];
  const prioFa = { low: 'کم', medium: 'متوسط', high: 'زیاد', critical: 'بحرانی' };
  const statusFa = { scheduled: 'برنامه‌ریزی‌شده', done: 'انجام‌شده', cancelled: 'لغوشده', open: 'باز', pending: 'در انتظار', in_progress: 'در حال انجام' };
  const rows = rep.rows.map(r => {
    const d = new Date(r.start);
    return [r.type_fa, r.title, jalExport(r.start), faDigits(String(d.getHours()).padStart(2, '0')) + ':' + faDigits(String(d.getMinutes()).padStart(2, '0')), r.end ? jalExport(r.end) : '—', r.user || '—', r.department || '—', r.customer || '—', r.location || '—', statusFa[r.status] || r.status, prioFa[r.priority] || r.priority, r.hours];
  });
  const title = 'گزارش تقویم و برنامه‌ریزی';
  const dateFa = require('../../lib/util').fmtDateLong(nowIso());
  if (format === 'csv') {
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    return { type: 'csv', data: csv, fileName: title + '.csv' };
  }
  if (format === 'json') return { type: 'json', data: JSON.stringify({ report: { title, date: dateFa, from: rep.range_fa.from, to: rep.range_fa.to, summary: rep.summary, columns: headers, rows }, company: co.name }, null, 2), fileName: title + '.json' };
  if (format === 'xlsx') {
    const XLSX = require('xlsx');
    const aoa = [[title], ['شرکت: ' + co.name], ['بازه: ' + rep.range_fa.from + ' تا ' + rep.range_fa.to], ['تهیه‌شده: ' + dateFa + ' توسط ' + user.full_name], [], headers, ...rows, [], ['خلاصه'], ['مجموع فعالیت‌ها', rep.summary.total], ['انجام‌شده', rep.summary.done], ['در انتظار', rep.summary.pending], ['عقب‌افتاده', rep.summary.overdue], ['مجموع ساعت', rep.summary.total_hours]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'گزارش تقویم');
    return { type: 'xlsx', data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), fileName: title + '.xlsx' };
  }
  if (format === 'html' || format === 'pdf') {
    const esc = require('../../lib/util').esc;
    const rowsHtml = rep.rows.map(r => {
      const d = new Date(r.start);
      return `<tr><td>${esc(r.type_fa)}</td><td class="l">${esc(r.title)}</td><td>${jalExport(r.start)}</td><td>${faDigits(String(d.getHours()).padStart(2, '0'))}:${faDigits(String(d.getMinutes()).padStart(2, '0'))}</td><td>${esc(r.user || '—')}</td><td>${esc(r.department || '—')}</td><td class="l">${esc(r.customer || '—')}</td><td>${statusFa[r.status] || esc(r.status)}</td></tr>`;
    }).join('');
    const s = rep.summary;
    const body = `
  ${require('../../lib/print').companyHeadHtml(co)}
  <h1>${esc(title)}</h1>
  <div class="meta">
    <div><b>بازهٔ زمانی:</b><span>${esc(rep.range_fa.from)} تا ${esc(rep.range_fa.to)}</span></div>
    <div><b>تاریخ تهیه:</b><span>${esc(dateFa)}</span></div>
    <div><b>تهیه‌کننده:</b><span>${esc(user.full_name)}</span></div>
    <div><b>شمارهٔ گزارش:</b><span>CAL-${String(Date.now()).slice(-8)}</span></div>
  </div>
  <div class="meta">
    <div><b>مجموع فعالیت‌ها:</b><span>${faDigits(s.total)}</span></div>
    <div><b>انجام‌شده:</b><span>${faDigits(s.done)}</span></div>
    <div><b>در انتظار:</b><span>${faDigits(s.pending)}</span></div>
    <div><b>عقب‌افتاده:</b><span>${faDigits(s.overdue)}</span></div>
    <div><b>مجموع ساعت:</b><span>${faDigits(s.total_hours)}</span></div>
  </div>
  <table class="items"><thead><tr><th>نوع</th><th>عنوان</th><th>تاریخ</th><th>ساعت</th><th>مسئول</th><th>واحد</th><th>مشتری</th><th>وضعیت</th></tr></thead><tbody>${rowsHtml}</tbody></table>
  <div class="note">فعالیت‌های ماژول‌های دیگر (جلسات، وظایف، پیگیری‌ها) در این بازه نیز در نظر گرفته شده است.</div>
  <div class="footer"><div class="sign"><div class="line"></div>تهیه‌کننده</div>
  <div style="text-align:center"><div style="margin-top:4px">صفحه ۱ از ۱</div></div>
  <div class="sign"><div class="line"></div>تأیید مدیریت</div></div>`;
    return { type: format === 'pdf' ? 'html' : 'html', data: require('../../lib/print').baseHtml(title, body, co), fileName: title + '.html' };
  }
  throw new HttpError(400, 'BAD_FORMAT', 'فرمت نامعتبر است.');
}

module.exports = { rawHolidays,
  EVENT_TYPES, REMINDER_OPTS, RECURRENCES,
  listEvents, getEvent, createEvent, updateEvent, deleteEvent, moveEvent, markEvent,
  todayPlan, upcoming, overdueFor,
  holidaysFor, saveHolidays,
  teams, colorSettings, saveColorSettings,
  calendarAi,
  report, reportExport,
};
