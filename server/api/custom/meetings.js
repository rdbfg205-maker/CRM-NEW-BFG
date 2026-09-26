'use strict';
// ============ Meetings module — composition + customer linkage + task/follow-up generation ============
// Reuses the generic CRUD engine (R.meeting), the activities/notifications/audit core, and the
// existing Task & Follow-up modules. Does NOT duplicate data or create parallel stores.
const { get, addActivity } = require('../../db/db');
const { requirePerm } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { notify } = require('../../core/notify');
const { HttpError } = require('../../lib/http');
const { parseId } = require('../../lib/util');
const { R } = require('../resources');
const generic = require('../generic');

function d() { return get(); }

function usersByIds(ids) {
  const list = String(ids || '').split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (!list.length) return [];
  return d().prepare('SELECT id, full_name, department FROM users WHERE id IN (' + list.map(() => '?').join(',') + ')').all(...list);
}
function contactOf(id) {
  if (!id) return null;
  return d().prepare('SELECT id, name, position, phone, mobile, email, customer_id FROM customer_contacts WHERE id=?').get(id) || null;
}

// ---------- composed detail (one round-trip) ----------
function detail(user, id) {
  requirePerm(user, 'meeting', 'view');
  const n = parseId(id);
  const m = d().prepare('SELECT * FROM meetings WHERE id=?').get(n);
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'جلسه پیدا نشد.');
  generic.assertRowScope(R.meeting, user, m, 'view');
  const organizer = m.organizer_id ? (d().prepare('SELECT id, full_name, department FROM users WHERE id=?').get(m.organizer_id) || null) : null;
  return {
    meeting: m,
    attendees: usersByIds(m.participant_ids),
    organizer,
    contact: contactOf(m.contact_id),
    customer: m.customer_id ? (d().prepare('SELECT id, name, phone, mobile, city FROM customers WHERE id=?').get(m.customer_id) || null) : null,
    attachments: generic.getAttachments('meeting', n),
    tasks: d().prepare("SELECT * FROM tasks WHERE related_type='meeting' AND related_id=? ORDER BY id").all(n),
    followups: d().prepare("SELECT * FROM followups WHERE entity_type='meeting' AND entity_id=? ORDER BY id").all(n),
    activities: generic.getActivities('meeting', n),
  };
}

// ---------- save (create/update) with customer timeline + notifications ----------
function save(user, id, data) {
  requirePerm(user, 'meeting', id ? 'edit' : 'create');
  let meetingId;
  const isEdit = !!id;
  if (isEdit) { meetingId = parseId(id); generic.update(R.meeting, user, meetingId, data); }
  else { meetingId = generic.create(R.meeting, user, data); }
  const m = d().prepare('SELECT * FROM meetings WHERE id=?').get(meetingId);
  // customer timeline (item 2/14): the meeting shows in the linked customer's Activity Timeline
  if (m && m.customer_id) {
    const verb = isEdit ? 'جلسه ویرایش شد' : 'جلسه ثبت شد';
    addActivity('customer', m.customer_id, user.id, 'meeting', `${verb}: «${m.title}»`, { meeting_id: meetingId });
  }
  // notifications on create (item 9): organizer + internal members + customer's salesperson
  if (m && !isEdit) {
    const set = new Set([m.organizer_id, ...String(m.participant_ids || '').split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite), m.created_by].filter(Boolean).map(Number));
    for (const uid of set) if (uid !== user.id) notify(uid, 'meeting', 'جلسه جدید ثبت شد', `«${m.title}»`, 'meeting', meetingId, user.id);
    if (m.customer_id) {
      const cu = d().prepare('SELECT salesperson_id FROM customers WHERE id=?').get(m.customer_id);
      if (cu && cu.salesperson_id && cu.salesperson_id !== user.id) notify(cu.salesperson_id, 'meeting', 'جلسه با مشتری شما', `جلسه «${m.title}» برای مشتری شما ثبت شد.`, 'meeting', meetingId, user.id);
    }
  }
  return { id: meetingId, ok: true };
}

// ---------- meeting decision/action item (Section 13) → real Task linked to the meeting ----------
// Fields: description (title/description), responsible (assignee_id), follower
// (follower_id), deadline (due_at), priority, status, notes, result.
function addTask(user, meetingId, b) {
  const n = parseId(meetingId);
  const m = d().prepare('SELECT * FROM meetings WHERE id=?').get(n);
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'جلسه پیدا نشد.');
  generic.assertRowScope(R.meeting, user, m, 'edit');
  requirePerm(user, 'task', 'create');
  const title = String(b.title || '').trim();
  if (!title) throw new HttpError(422, 'VALIDATION', 'شرح تصمیم/اقدام الزامی است.');
  const data = {
    title,
    description: String(b.description || '').trim() || null,
    assignee_id: b.assignee_id ? Number(b.assignee_id) : null,
    follower_id: b.follower_id ? Number(b.follower_id) : null,
    result: b.result !== undefined ? String(b.result || '').trim() || null : null,
    related_type: 'meeting',
    related_id: n,
    priority: ['low', 'medium', 'high', 'critical'].includes(b.priority) ? b.priority : 'medium',
    status: ['open', 'in_progress', 'done', 'cancelled'].includes(b.status) ? b.status : 'open',
    due_at: b.due_at || null,
    notes: String(b.notes || '').trim() || null,
  };
  // follower_id / result are post-migration columns — apply directly after create
  // (the generic engine only binds declared resource fields; this keeps the
  // migration additive and backward compatible with older definitions).
  let tid;
  try {
    tid = generic.create(R.task, user, data, { skipDupCheck: true });
  } finally { /* row created inside; columns patched below */ }
  if (data.follower_id || data.result !== null) {
    d().prepare('UPDATE tasks SET follower_id=?, result=? WHERE id=?').run(data.follower_id, data.result, tid);
  }
  addActivity('meeting', n, user.id, 'task_created', 'ایجاد اقدام/تصمیم از جلسه: ' + title, { task_id: tid, assignee_id: data.assignee_id, follower_id: data.follower_id });
  if (m.customer_id) addActivity('customer', m.customer_id, user.id, 'meeting_task', `اقدام از جلسه «${m.title}»: ${title}`, { meeting_id: n, task_id: tid });
  // Section 14: the responsible person gets a REAL notification with meeting
  // title, description, deadline and a direct link to the action (task).
  if (data.assignee_id && data.assignee_id !== user.id) {
    notify(data.assignee_id, 'task', 'اقدام جدید جلسه — منتظر شما',
      `جلسه «${m.title}» — «${title}»${data.due_at ? ' — مهلت: ' + data.due_at.slice(0, 10) : ''}`, 'task', tid, user.id);
  }
  if (data.follower_id && data.follower_id !== user.id && data.follower_id !== data.assignee_id) {
    notify(data.follower_id, 'task', 'پیگیری اقدام جلسه به عهدهٔ شما',
      `جلسه «${m.title}» — «${title}»${data.assignee_id ? '' : ''}${data.due_at ? ' — مهلت: ' + data.due_at.slice(0, 10) : ''}`, 'task', tid, user.id);
  }
  audit(user, 'task', tid, 'create_from_meeting', null, { meeting_id: n, follower_id: data.follower_id });
  return { id: tid };
}

// ---------- create a Follow-up from the meeting (item 7), linked to meeting + customer ----------
function addFollowup(user, meetingId, b) {
  const n = parseId(meetingId);
  const m = d().prepare('SELECT * FROM meetings WHERE id=?').get(n);
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'جلسه پیدا نشد.');
  generic.assertRowScope(R.meeting, user, m, 'edit');
  requirePerm(user, 'followup', 'create');
  const subject = String(b.subject || '').trim() || ('پیگیری از جلسه: ' + m.title);
  const due = b.due_at || null;
  if (!due) throw new HttpError(422, 'VALIDATION', 'زمان پیگیری الزامی است.');
  const fid = generic.create(R.followup, user, {
    entity_type: 'meeting', entity_id: n,
    user_id: b.user_id ? Number(b.user_id) : user.id,
    subject, note: String(b.note || '').trim() || null, due_at: due, status: 'pending',
  }, { skipDupCheck: true });
  // if the meeting is customer-linked, mirror a follow-up on the customer (customer 360 timeline)
  if (m.customer_id) {
    try {
      const cfid = generic.create(R.followup, user, {
        entity_type: 'customer', entity_id: m.customer_id, user_id: b.user_id ? Number(b.user_id) : user.id,
        subject: subject + ' (از جلسه)', note: 'پیگیری جلسه: ' + m.title, due_at: due, status: 'pending',
      }, { skipDupCheck: true });
      addActivity('customer', m.customer_id, user.id, 'meeting_followup', `پیگیری از جلسه «${m.title}»: ${subject}`, { meeting_id: n, followup_id: cfid });
    } catch { /* customer mirror is non-fatal */ }
  }
  addActivity('meeting', n, user.id, 'followup_created', 'ایجاد پیگیری از جلسه: ' + subject, { followup_id: fid });
  const resp = b.user_id ? Number(b.user_id) : user.id;
  if (resp) notify(resp, 'followup', 'پیگیری جدید (از جلسه)', `${subject} — از جلسه ${m.title}`, 'followup', fid, user.id);
  audit(user, 'followup', fid, 'create_from_meeting', null, { meeting_id: n });
  return { id: fid };
}

module.exports = { detail, save, addTask, addFollowup };
