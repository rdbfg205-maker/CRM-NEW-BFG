'use strict';
const { get, getSetting } = require('../db/db');
const { nowIso, nowTehran } = require('../lib/util');
const { notify, notifyRoles, notifyDepartment } = require('./notify');
const { dispatch } = require('./workflow');

let timer = null;
function faMinLabel(n, unit) {
  const fa = String(Math.round(n)).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  return fa + ' ' + unit;
}
function start() {
  if (timer) return;
  timer = setInterval(tick, 60000);
  timer.unref();
  setTimeout(tick, 8000);
  // resume workflow executions left 'running' on an auto-node after a restart
  setImmediate(() => { try { require('./workflow-engine').resumeInterrupted(); } catch (e) { console.error('[wf-resume]', e.message); } });
  console.log('[scheduler] started (60s tick)');
}
function tick() {
  try {
    // VoIP auto-sync (only active when REST provider + auto_sync configured; never throws)
    setImmediate(() => { try { require('../api/custom/voip').maybeSync().catch(e => console.error('[voip] auto sync: ' + e.message)); } catch {} });
    const d = get();
    const now = nowIso();
    // ---- tasks: reminders & overdue ----
    const tasks = d.prepare(`SELECT * FROM tasks WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < datetime('now','+2 day')`).all();
    for (const t of tasks) {
      if (!t.reminder_sent && t.due_at < new Date(Date.now() + 864e5).toISOString()) {
        d.prepare('UPDATE tasks SET reminder_sent=1 WHERE id=?').run(t.id);
        if (t.assignee_id) notify(t.assignee_id, 'task', 'یادآوری وظیفه', `«${t.title}» — مهلت: ${t.due_at.slice(0, 10)}`, 'task', t.id);
      }
      if (t.due_at < now) {
        if (t.assignee_id && !d.prepare('SELECT 1 FROM notifications WHERE user_id=? AND ref_type=? AND ref_id=? AND type=?').get(t.assignee_id, 'task', t.id, 'task_overdue')) {
          notify(t.assignee_id, 'task_overdue', 'وظیفه سررسید گذشته', `«${t.title}» از مهلت مقرر عبور کرده است.`, 'task', t.id);
        }
      }
    }
    // ---- calendar event reminders ----
    const cals = d.prepare(`SELECT * FROM calendar_events WHERE archived_at IS NULL AND status='scheduled' AND reminder_minutes IS NOT NULL AND reminder_sent_at IS NULL`).all();
    for (const ce of cals) {
      const startT = new Date(ce.start_at).getTime();
      const fireAt = startT - ce.reminder_minutes * 60000;
      if (Date.now() >= fireAt && Date.now() < startT + 60 * 60000) {
        d.prepare('UPDATE calendar_events SET reminder_sent_at=? WHERE id=?').run(now, ce.id);
        const mins = ce.reminder_minutes >= 1440 ? faMinLabel(ce.reminder_minutes / 1440, 'روز') : faMinLabel(ce.reminder_minutes, 'دقیقه');
        const dt = new Date(ce.start_at);
        const when = `${dt.getDate()}/${dt.getMonth() + 1} ساعت ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        const msg = `🔔 ${ce.title} — ${mins} دیگر (${when})`;
        if (ce.user_id) notify(ce.user_id, 'calendar_event', 'یادآوری تقویم', msg, 'calendar_event', ce.id);
        for (const pid of String(ce.participant_ids || '').split(',').map(x => x.trim()).filter(Boolean)) {
          if (Number(pid) !== ce.user_id) notify(Number(pid), 'calendar_event', 'یادآوری جلسهٔ مشترک', msg, 'calendar_event', ce.id);
        }
        // Section 9: notify the customer's salesperson too (same pattern as the meetings module)
        if (ce.customer_id) {
          const sp = d.prepare('SELECT salesperson_id FROM customers WHERE id=?').get(ce.customer_id);
          if (sp && sp.salesperson_id && sp.salesperson_id !== ce.user_id) notify(sp.salesperson_id, 'meeting', 'یادآوری جلسه با مشتری', msg, 'meeting', ce.id);
        }
      }
    }
    // ---- meetings reminders (rich Meetings module) ----
    const mtgs = d.prepare(`SELECT * FROM meetings WHERE status='scheduled' AND reminder_minutes IS NOT NULL AND reminder_sent_at IS NULL`).all();
    for (const mt of mtgs) {
      const startT = new Date(mt.start_at).getTime();
      const fireAt = startT - mt.reminder_minutes * 60000;
      if (Date.now() >= fireAt && Date.now() < startT + 60 * 60000) {
        d.prepare('UPDATE meetings SET reminder_sent_at=? WHERE id=?').run(now, mt.id);
        const mins = mt.reminder_minutes >= 1440 ? faMinLabel(mt.reminder_minutes / 1440, 'روز') : faMinLabel(mt.reminder_minutes, 'دقیقه');
        const dt = new Date(mt.start_at);
        const when = `${dt.getDate()}/${dt.getMonth() + 1} ساعت ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        const msg = `🔔 ${mt.title} — ${mins} دیگر (${when})`;
        const ids = new Set([mt.organizer_id, mt.created_by, ...String(mt.participant_ids || '').split(',').map(x => parseInt(x.trim(), 10))].filter(Boolean));
        for (const uid of ids) notify(uid, 'meeting', 'یادآوری جلسه', msg, 'meeting', mt.id);
        if (mt.customer_id) {
          const sp = d.prepare('SELECT salesperson_id FROM customers WHERE id=?').get(mt.customer_id);
          if (sp && sp.salesperson_id) notify(sp.salesperson_id, 'meeting', 'یادآوری جلسه با مشتری', msg, 'meeting', mt.id);
        }
      }
    }
    // ---- followups due ----
    const fus = d.prepare(`SELECT * FROM followups WHERE status='pending' AND due_at <= ?`).all(new Date(Date.now() + 3600e3).toISOString());
    for (const f of fus) {
      d.prepare("UPDATE followups SET status='missed' WHERE id=?").run(f.id);
      if (f.user_id) notify(f.user_id, 'followup', 'پیگیری سررسید گذشته', `${f.subject || 'پیگیری'} (${f.entity_type} #${f.entity_id})`, 'followup', f.id);
    }
    // ---- follow-up attempt reminders (next follow-up dates, notify once) ----
    const fas = d.prepare(`SELECT fa.*, fu.user_id fu_user_id, fu.subject fu_subject, fu.entity_type fu_entity_type, fu.entity_id fu_entity_id
      FROM followup_attempts fa JOIN followups fu ON fu.id = fa.followup_id
      WHERE fa.next_followup_at IS NOT NULL AND fa.next_followup_at <= ? AND fa.reminded_at IS NULL
        AND fu.status IN ('pending','in_progress')`).all(new Date(Date.now() + 3600e3).toISOString());
    for (const a of fas) {
      d.prepare('UPDATE followup_attempts SET reminded_at=? WHERE id=?').run(now, a.id);
      const target = a.user_id || a.fu_user_id;
      if (target) notify(target, 'followup', 'یادآوری پیگیری بعدی', `${a.fu_subject || 'پیگیری'} (${a.fu_entity_type} #${a.fu_entity_id}) — پیگیری بعدی سررسید شده است`, 'followup', a.followup_id);
    }
    // ---- complaint SLA escalation ----
    const comps = d.prepare(`SELECT * FROM complaints WHERE status IN ('new','in_progress','waiting') AND due_at IS NOT NULL AND due_at < ?`).all(now);
    for (const c of comps) {
      const escalated = d.prepare('SELECT 1 FROM complaint_events WHERE complaint_id=? AND note LIKE ?').get(c.id, '%escalation%');
      if (!escalated) {
        const newPriority = c.priority === 'low' || c.priority === 'medium' ? 'high' : 'critical';
        d.prepare('UPDATE complaints SET priority=? WHERE id=?').run(newPriority, c.id);
        d.prepare('INSERT INTO complaint_events(complaint_id, from_status, to_status, note, user_id, created_at) VALUES(?,?,?,?,0,?)').run(c.id, null, null, 'escalation: عبور از SLA و افزایش اولویت', now);
        notifyRoles(['quality_manager', 'ceo', 'super_admin'], 'sla', 'هشدار SLA شکایت', `شکایت ${c.number} از زمان مجاز عبور کرده و اولویت آن به ${newPriority} ارتقا یافت.`, 'complaint', c.id);
        if (c.assigned_to) notify(c.assigned_to, 'sla', 'شکایت شما از SLA عبور کرد', c.subject, 'complaint', c.id);
        dispatch('complaint_sla_breach', 'complaint', c.id, c);
      }
    }
    // ---- ticket SLA ----
    const tickets = d.prepare(`SELECT * FROM tickets WHERE status IN ('open','in_progress') AND sla_due_at IS NOT NULL AND sla_due_at < ?`).all(now);
    for (const t of tickets) {
      if (!d.prepare('SELECT 1 FROM activities WHERE entity_type=? AND entity_id=? AND type=?').get('ticket', t.id, 'sla_breach')) {
        d.prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,0,?,?,?)').run('ticket', t.id, 'sla_breach', 'عبور از SLA', now);
        if (t.assigned_to) notify(t.assigned_to, 'sla', 'تیکت از SLA عبور کرد', t.subject, 'ticket', t.id);
        notifyRoles(['support_manager', 'ceo', 'super_admin'], 'sla', 'هشدار SLA تیکت', t.subject, 'ticket', t.id);
      }
    }
    // ---- stock low ----
    const low = d.prepare(`SELECT * FROM products WHERE active=1 AND archived_at IS NULL AND reorder_point>0 AND stock_qty<=reorder_point`).all();
    for (const p of low) {
      const exists = d.prepare('SELECT id FROM stock_alerts WHERE product_id=? AND resolved_at IS NULL').get(p.id);
      if (!exists) {
        const info = d.prepare('INSERT INTO stock_alerts(product_id, level, message, created_at) VALUES(?,?,?,?)')
          .run(p.id, 'reorder', `موجودی «${p.name}» به ${p.stock_qty} ${p.unit} رسید (حد سفارش مجدد: ${p.reorder_point}).`, now);
        notifyRoles(['warehouse_manager', 'ceo', 'super_admin'], 'stock', 'هشدار موجودی کم', `کالای «${p.name}» به حد سفارش مجدد رسیده است.`, 'stock_alert', info.lastInsertRowid);
        dispatch('stock_low', 'stock_alert', Number(info.lastInsertRowid), { product_name: p.name, qty: p.stock_qty });
      }
    }
    // ---- invoice overdue ----
    const invs = d.prepare(`SELECT * FROM invoices WHERE status IN ('unpaid','partial') AND due_date IS NOT NULL AND due_date < ?`).all(now);
    for (const i of invs) {
      d.prepare("UPDATE invoices SET status='overdue' WHERE id=?").run(i.id);
      const cust = d.prepare('SELECT * FROM customers WHERE id=?').get(i.customer_id);
      if (cust && cust.salesperson_id) notify(cust.salesperson_id, 'payment', 'فاکتور سررسیدگذشته', `فاکتور ${i.number} — ${cust.name} — ${i.total} ریال`, 'invoice', i.id);
      if (!d.prepare("SELECT 1 FROM notifications WHERE user_id IS NOT NULL AND ref_type='invoice' AND ref_id=? AND type='invoice_overdue'").get(i.id)) {
        notifyRoles(['finance_manager', 'ceo', 'super_admin'], 'invoice_overdue', 'فاکتور سررسیدگذشته', `فاکتور ${i.number} (${i.total} ریال) سررسید گذشته است.`, 'invoice', i.id);
      }
      dispatch('invoice_overdue', 'invoice', i.id, i);
    }
    // ---- quote expiry ----
    const quotes = d.prepare(`SELECT * FROM quotes WHERE status IN ('draft','sent') AND valid_until IS NOT NULL AND valid_until < ?`).all(now);
    for (const q of quotes) {
      d.prepare("UPDATE quotes SET status='expired' WHERE id=?").run(q.id);
      if (q.salesperson_id) notify(q.salesperson_id, 'quote', 'پیش‌فاکتور منقضی شد', `پیش‌فاکتور ${q.number} اعتبار خود را از دست داده است.`, 'quote', q.id);
    }
    // ---- warranty expiry (30 days ahead) ----
    const war = d.prepare(`SELECT * FROM warranties WHERE status='active' AND end_date IS NOT NULL AND end_date < datetime('now','+30 day')`).all();
    for (const w of war) {
      if (w.customer_id && !d.prepare("SELECT 1 FROM notifications WHERE user_id=? AND ref_type='warranty' AND ref_id=?").get(1, w.id)) {
        const sp = d.prepare('SELECT salesperson_id FROM customers WHERE id=?').get(w.customer_id);
        if (sp && sp.salesperson_id) notify(sp.salesperson_id, 'warranty', 'گارانتی در آستانه انقضا', `گارانتی «${w.product_name || ''}» مشتری #${w.customer_id} تا ۳۰ روز دیگر منقضی می‌شود؛ فرصت تمدید.`, 'warranty', w.id);
      }
    }
    // ---- campaigns scheduled ----
    const camps = d.prepare(`SELECT * FROM campaigns WHERE status='scheduled' AND schedule_at IS NOT NULL AND schedule_at <= ?`).all(now);
    for (const camp of camps) {
      require('../api/custom/campaigns').sendCampaign({ id: camp.id }, camp.id);
    }
    // ---- AI periodic refresh (every 6h) ----
    const last = getSetting('ai_last_refresh', '');
    if (!last || Date.now() - new Date(last).getTime() > 6 * 3600e3) {
      setSettingSafe('ai_last_refresh', now);
      try {
        const engine = require('../ai/engine');
        const custs = d.prepare(`SELECT id FROM customers WHERE archived_at IS NULL AND status='active' LIMIT 500`).all();
        for (const c of custs.slice(0, 200)) engine.churnScore(c.id);
        engine.rescoreAllLeads();
      } catch (e) { console.error('ai refresh', e.message); }
    }
    // ---- auto reports ----
    const n = nowTehran();
    const todayKey = now.slice(0, 10);
    const lastDaily = getSetting('report_last_daily', '');
    if (lastDaily !== todayKey && n.jd >= 1) {
      setSettingSafe('report_last_daily', todayKey);
      const reports = require('../api/custom/reports');
      const from = new Date(Date.now() - 864e5).toISOString();
      reports.autoReport('daily', from, now, null);
      notifyRoles(['ceo', 'super_admin'], 'report', 'گزارش روزانه تولید شد', 'گزارش روزانه فروش و عملیات آماده است.', 'report_instance', 0);
    }
    // ---- scheduled backup (configurable: daily/weekly/monthly + hour/day) ----
    try {
      const sched = getSetting('backup_schedule', { freq: 'daily', hour: 2, day: 1, day_of_month: 1 }) || { freq: 'daily', hour: 2, day: 1, day_of_month: 1 };
      const lastBk = getSetting('backup_last_auto', '');
      const hourNow = nowTehran().iso.slice(11, 13);
      let due = false;
      if (sched.freq === 'weekly') {
        // day: 1=شنبه..7=جمعه (Tehran); lastBk stores ISO date of last run
        const lastD = lastBk ? new Date(lastBk + 'T00:00:00Z') : null;
        const todayKey = nowTehran().iso.slice(0, 10);
        const irDay = nowTehran().dow === 6 ? 7 : nowTehran().dow + 2; // 1=شنبه .. 7=جمعه
        due = irDay === Number(sched.day || 1) && hourNow >= String(Number(sched.hour || 2)).padStart(2, '0') && (!lastD || lastD.toISOString().slice(0, 10) !== todayKey);
      } else if (sched.freq === 'monthly') {
        const todayKey = nowTehran().iso.slice(0, 10);
        due = nowTehran().jd === Number(sched.day_of_month || 1) && hourNow >= String(Number(sched.hour || 2)).padStart(2, '0') && lastBk !== todayKey;
      } else {
        due = hourNow >= String(Number(sched.hour || 2)).padStart(2, '0') && lastBk !== now.slice(0, 10);
      }
      if (due) {
        setSettingSafe('backup_last_auto', now.slice(0, 10));
        try { require('../api/custom/admin').createBackup(null); } catch (e) { console.error('backup', e.message); }
      }
    } catch (e) { console.error('backup schedule:', e.message); }
    // ---- refresh token cleanup ----
    d.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at IS NOT NULL').all ? d.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now) : null;
    // ---- workflow engine: resume due Delay/Schedule nodes ----
    setImmediate(() => { try { require('./workflow-engine').processDueSchedules(); } catch (e) { console.error('[wf-schedule]', e.message); } });
    // ---- sync stale import cache ----
  } catch (e) {
    console.error('[scheduler] tick error:', e.stack);
  }
}
function setSettingSafe(k, v) {
  try { require('../db/db').setSetting(k, v); } catch {}
}
module.exports = { start };
