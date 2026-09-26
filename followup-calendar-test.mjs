// Section 9.4 — Follow-up / Tasks / Calendar: real-HTTP test suite (no mocks).
// Real creation + linkage to Customer, calendar aggregation, REAL scheduler
// reminders/notifications (waits for a scheduler tick), overdue followup → missed,
// Jalali dates in API payloads (ISO, Jalali-rendered in UI), activities + audit. Cleans up.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'FC' + String(Date.now()).slice(-5);
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function fetchRetry(url, opts, tries = 6) {
  for (let i = 1; ; i++) {
    const r = await fetch(url, opts);
    if ((r.status !== 429 && r.status < 500) || i >= tries) return r;
    await sleep(Math.min(2000, 300 * 2 ** (i - 1)) + Math.floor(Math.random() * 250));
  }
}
async function req(method, path, a, b) {
  const isGet = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  const body = isGet ? undefined : a;
  const token = isGet ? a : b;
  const h = {};
  if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetchRetry(BASE + path, { method, headers: h, body: (body !== undefined && body !== null) ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t };
}
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const qa = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };

const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }

const G = {};
try {
  // ---------- controlled data (real API) ----------
  G.cust = (await req('POST', '/api/r/customer', { name: 'مشتری پیگیری ' + STAMP, type: 'company', salesperson_id: 4 }, A)).data.id;
  ok('F01 customer with salesperson created (link base)', !!G.cust, 'cust=' + G.cust);

  // followup (future due)
  let r = await req('POST', '/api/r/followup', { entity_type: 'customer', entity_id: G.cust, user_id: 1, subject: 'پیگیری F9 ' + STAMP, note: 'تماس تلفنی', due_at: new Date(Date.now() + 3600e3).toISOString() }, A);
  G.fu = r.data.id;
  ok('F02 followup created, linked to customer', !!G.fu && q1('SELECT entity_type, entity_id FROM followups WHERE id=?', G.fu).entity_type === 'customer', 'fu=' + G.fu);
  const fuAct = q1(`SELECT COUNT(*) c FROM activities WHERE entity_type='followup' AND entity_id=?`, G.fu);
  ok('F03 followup creation logged in CRM activities', fuAct.c >= 1, 'n=' + fuAct.c);

  // task (due in 1h → scheduler reminder should fire on next tick)
  r = await req('POST', '/api/r/task', { title: 'وظیفه F9 ' + STAMP, assignee_id: 1, priority: 'high', status: 'open', due_at: new Date(Date.now() + 3600e3).toISOString() }, A);
  G.task = r.data.id;
  ok('F04 task created with due date + assignee', !!G.task && q1('SELECT assignee_id, due_at FROM tasks WHERE id=?', G.task).assignee_id === 1, 'task=' + G.task);

  // calendar event (starts in 30min, reminder 60min → fires on next tick)
  r = await req('POST', '/api/calendar/events', { title: 'جلسه F9 ' + STAMP, type: 'meeting', start_at: new Date(Date.now() + 1800e3).toISOString(), user_id: 1, customer_id: G.cust, reminder_minutes: 60 }, A);
  G.cal = r.data.id;
  ok('F05 calendar event created with customer link + reminder', !!G.cal && r.status === 201, 'cal=' + G.cal);
  const calAud = q1(`SELECT COUNT(*) c FROM audit_logs WHERE entity='calendar_event' AND action='create' AND entity_id=?`, G.cal);
  ok('F06 calendar event creation audited', calAud.c >= 1, 'n=' + calAud.c);

  // overdue followup (due in the past → scheduler marks missed on next tick)
  r = await req('POST', '/api/r/followup', { entity_type: 'customer', entity_id: G.cust, user_id: 1, subject: 'پیگیری معوق F9 ' + STAMP, due_at: new Date(Date.now() - 3600e3).toISOString() }, A);
  G.fuLate = r.data.id;
  ok('F07 overdue followup created (due in the past)', !!G.fuLate, 'fu=' + G.fuLate);

  // future followup, untouched (must stay pending after the tick)
  r = await req('POST', '/api/r/followup', { entity_type: 'customer', entity_id: G.cust, user_id: 1, subject: 'پیگیری آتی F9 ' + STAMP, due_at: new Date(Date.now() + 7200e3).toISOString() }, A);
  G.fuFuture = r.data.id;

  // calendar aggregation: followup + task + event all visible in /api/calendar/events
  r = await req('GET', '/api/calendar/events?q=' + encodeURIComponent('F9 ' + STAMP) + '&per_page=100', A);
  const evs = r.data.items || r.data.events || [];
  ok('F08 calendar aggregates followup + task + event (search "F9 STAMP")', r.status === 200 && evs.length >= 3 && evs.some(e => String(e.id || '').includes(String(G.fu))) && evs.some(e => String(e.id || '').includes(String(G.cal))), `n=${evs.length}`);
  const calEv = evs.find(e => String(e.id || '') === 'cal-' + G.cal);
  ok('F09 calendar event carries real customer (Jalali-renderable ISO date)', !!calEv && !!calEv.customer && calEv.customer.id === G.cust && /^\d{4}-\d{2}-\d{2}T/.test(calEv.start_at), JSON.stringify(calEv && { id: calEv.id, cust: calEv.customer && calEv.customer.id, start: calEv.start_at }));

  // followup completion
  r = await req('PUT', '/api/r/followup/' + G.fu, { status: 'done' }, A);
  const fuRow = q1('SELECT status, done_at FROM followups WHERE id=?', G.fu);
  ok('F10 followup completion sets status + done_at', r.status === 200 && fuRow.status === 'done' && !!fuRow.done_at, JSON.stringify(fuRow));

  // ---------- REAL scheduler tick (60s interval + initial 8s) ----------
  console.log('… waiting for a real scheduler tick (up to ~75s) …');
  await sleep(75000);

  const taskRow = q1('SELECT reminder_sent FROM tasks WHERE id=?', G.task);
  const taskNotif = q1(`SELECT COUNT(*) c FROM notifications WHERE user_id=1 AND ref_type='task' AND ref_id=?`, G.task);
  ok('F11 task reminder fired by REAL scheduler (flag + notification)', taskRow.reminder_sent === 1 && taskNotif.c >= 1, `flag=${taskRow.reminder_sent} notif=${taskNotif.c}`);

  const lateRow = q1('SELECT status FROM followups WHERE id=?', G.fuLate);
  const lateNotif = q1(`SELECT COUNT(*) c FROM notifications WHERE user_id=1 AND ref_type='followup' AND ref_id=?`, G.fuLate);
  ok('F12 overdue followup auto-marked missed + notification (real scheduler)', lateRow.status === 'missed' && lateNotif.c >= 1, `status=${lateRow.status} notif=${lateNotif.c}`);

  const calRow = q1('SELECT reminder_sent_at FROM calendar_events WHERE id=?', G.cal);
  const orgNotif = q1(`SELECT COUNT(*) c FROM notifications WHERE user_id=1 AND ref_type='calendar_event' AND ref_id=?`, G.cal);
  const spNotif = q1(`SELECT COUNT(*) c FROM notifications WHERE user_id=4 AND ref_type='meeting' AND ref_id=?`, G.cal);
  ok('F13 meeting reminder fired: flag + organizer + customer-salesperson notified', !!calRow.reminder_sent_at && orgNotif.c >= 1 && spNotif.c >= 1, `flag=${!!calRow.reminder_sent_at} org=${orgNotif.c} sp=${spNotif.c}`);

  // future-due followup must still be pending (not missed)
  const fuRow3 = q1('SELECT status FROM followups WHERE id=?', G.fuFuture);
  ok('F14 non-overdue followup still pending (scheduler precision)', fuRow3.status === 'pending', 'status=' + fuRow3.status);
} catch (err) {
  ok('suite completed without unexpected crash', false, (err.stack || String(err)).slice(0, 300));
}

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
    del(`DELETE FROM notifications WHERE (ref_type='followup' AND ref_id IN (${[G.fu, G.fuLate, G.fuFuture].filter(Boolean).join(',') || '0'})) OR (ref_type='task' AND ref_id=?) OR (ref_type='calendar_event' AND ref_id=?) OR (ref_type='meeting' AND ref_id=?)`, G.task || 0, G.cal || 0, G.cal || 0);
    del('DELETE FROM followups WHERE id IN (?,?,?)', G.fu || 0, G.fuLate || 0, G.fuFuture || 0);
    del('DELETE FROM tasks WHERE id=?', G.task || 0);
    del('DELETE FROM calendar_events WHERE id=?', G.cal || 0);
    del('DELETE FROM customers WHERE id=?', G.cust || 0);
  });
  tx(); d.close();
  console.log('cleanup done');
  console.log('\n========== FOLLOW-UP / TASKS / CALENDAR (SECTION 9.4) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 150) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
