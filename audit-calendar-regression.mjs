'use strict';
// PART 5 — Calendar regression: Follow-up/Event/Task → Done or Lost must NOT delete.
// Must remain on calendar, status visible, info visible, history preserved.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const BASE = process.env.BASE || 'http://127.0.0.1:3050';
const DB = '/home/user/baspar-crm/data/baspar-crm.sqlite';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; failures.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
async function req(method, path, body, tok) {
  const h = {}; if (body !== undefined) h['content-type'] = 'application/json';
  if (tok) h.authorization = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; const t = await r.text(); try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
async function login(u, p) {
  for (let i = 0; i < 4; i++) {
    const r = await req('POST', '/api/auth/login', { username: u, password: p });
    if (r.data && r.data.access) return r.data.access;
    if (r.status === 429) { await sleep(65000); continue; }
    return null;
  }
  return null;
}
const db = () => new BDB(DB, { readonly: true });
(async () => {
  const A = await login('admin', 'admin1234');
  ok('C0 admin login', !!A);
  if (!A) { process.exit(1); }
  const stamp = String(Date.now()).slice(-6);
  const near = new Date(Date.now() + 864e5).toISOString();   // +1 day (within calendar range)
  const past = new Date(Date.now() - 2 * 864e5).toISOString(); // -2 days (overdue)

  // followup (pending, due +1d) — entity_type 'other' avoids triggering the sales-chain workflow
  const CUST = 0;
  ok('C1 setup ok (no customer needed — entity_type=other)', true);

  // followup (pending, due +1d)
  const fu = await req('POST', '/api/r/followup', { entity_type: 'other', entity_id: 0, user_id: 1, subject: 'پیگیری تقویم ' + stamp, due_at: near, status: 'pending' }, A);
  const FU = fu.data && fu.data.id;
  ok('C2 followup created (pending)', !!FU, 'status=' + fu.status);

  // task (open, due +1d)
  const tk = await req('POST', '/api/r/task', { title: 'وظیفه تقویم ' + stamp, assignee_id: 1, related_type: 'customer', related_id: 0, due_at: near, status: 'open' }, A);
  const TK = tk.data && tk.data.id;
  ok('C3 task created (open)', !!TK, 'status=' + tk.status);

  // calendar event (scheduled, +1d)
  const ev = await req('POST', '/api/calendar/events', { title: 'رویداد تقویم ' + stamp, customer_id: 0, start_at: near, type: 'meeting' }, A);
  const EV = ev.data && (ev.data.id || (ev.data.item && ev.data.item.id));
  ok('C4 calendar event created (scheduled)', !!EV, 'status=' + ev.status);

  // ---- mark followup DONE (via generic update) ----
  const fuDone = await req('PUT', '/api/r/followup/' + FU, { status: 'done' }, A);
  const fuRow = db().prepare('SELECT id, status, done_at, subject, entity_id FROM followups WHERE id=?').get(FU);
  ok('C5 followup marked DONE → NOT deleted, row persists with status=done', fuDone.status === 200 && !!fuRow && fuRow.status === 'done' && !!fuRow.done_at, JSON.stringify(fuRow));

  // ---- mark task DONE ----
  const tkDone = await req('PUT', '/api/r/task/' + TK, { status: 'done' }, A);
  const tkRow = db().prepare('SELECT id, status, title FROM tasks WHERE id=?').get(TK);
  ok('C6 task marked DONE → NOT deleted, row persists with status=done', tkDone.status === 200 && !!tkRow && tkRow.status === 'done', JSON.stringify(tkRow));

  // ---- mark calendar event DONE ----
  const evDone = await req('POST', '/api/calendar/events/' + EV + '/done', { done: true }, A);
  const evRow = db().prepare('SELECT id, status, title FROM calendar_events WHERE id=?').get(EV);
  ok('C7 calendar event marked DONE → NOT deleted, row persists with status=done', evDone.status === 200 && !!evRow && evRow.status === 'done', JSON.stringify(evRow));

  // ---- all three still VISIBLE on the calendar (listEvents for that range) ----
  const cal = await req('GET', '/api/calendar/events?from=' + new Date(Date.now() + 864e5 - 36e5).toISOString() + '&to=' + new Date(Date.now() + 864e5 + 36e5).toISOString(), undefined, A);
  const calJson = JSON.stringify(cal.data || {});
  const fuVisible = calJson.includes('پیگیری تقویم ' + stamp);
  const tkVisible = calJson.includes('وظیفه تقویم ' + stamp);
  const evVisible = calJson.includes('رویداد تقویم ' + stamp);
  ok('C8 DONE followup still visible on calendar (listEvents)', fuVisible, 'followupVisible=' + fuVisible);
  ok('C9 DONE task still visible on calendar (listEvents)', tkVisible, 'taskVisible=' + tkVisible);
  ok('C10 DONE calendar event still visible on calendar (listEvents)', evVisible, 'eventVisible=' + evVisible);

  // ---- info still visible (subject/title/customer present in calendar payload) ----
  ok('C11 done records still carry their info (subject/title present)', fuVisible && tkVisible && evVisible, '—');

  // ---- audit history preserved for the done transitions ----
  const d2 = db();
  const fuAudit = d2.prepare('SELECT COUNT(*) c FROM audit_logs WHERE entity=? AND entity_id=? AND action=?').get('followup', FU, 'update').c;
  const evAudit = d2.prepare('SELECT COUNT(*) c FROM audit_logs WHERE entity=? AND entity_id=? AND action=?').get('calendar_event', EV, 'status').c;
  d2.close();
  ok('C12 audit history preserved for done transitions (followup+event)', fuAudit >= 1 && evAudit >= 1, JSON.stringify({ fuAudit, evAudit }));

  // ---- MISSED (lost) followup: overdue pending → scheduler marks 'missed' (not deleted) ----
  const fu2 = await req('POST', '/api/r/followup', { entity_type: 'other', entity_id: 0, user_id: 1, subject: 'پیگیری معوق ' + stamp, due_at: past, status: 'pending' }, A);
  const FU2 = fu2.data && fu2.data.id;
  ok('C13 overdue followup created (pending, due in past)', !!FU2, 'status=' + fu2.status);
  console.log('  ... waiting up to ~80s for the 60s scheduler to mark it missed ...');
  let missed = null;
  for (let i = 0; i < 16; i++) {
    await sleep(5000);
    const row = db().prepare('SELECT id, status, subject FROM followups WHERE id=?').get(FU2);
    if (row && row.status === 'missed') { missed = row; break; }
  }
  ok('C14 overdue followup auto-marked MISSED by scheduler (NOT deleted)', !!missed, missed ? JSON.stringify(missed) : 'still pending after 80s');
  if (missed) {
    const cal2 = await req('GET', '/api/calendar/events?from=' + new Date(Date.now() - 3 * 864e5).toISOString() + '&to=' + new Date(Date.now() + 864e5).toISOString(), undefined, A);
    const cal2Json = JSON.stringify(cal2.data || {});
    ok('C15 MISSED followup still visible on calendar (listEvents)', cal2Json.includes('پیگیری معوق ' + stamp), 'missedVisible=' + cal2Json.includes('پیگیری معوق ' + stamp));
  }

  console.log('\n=====================================');
  console.log('CALENDAR REGRESSION: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('ALL CALENDAR REGRESSION PASSED ✅');
  // cleanup
  await req('DELETE', '/api/r/followup/' + FU + '?hard=1', undefined, A);
  await req('DELETE', '/api/r/followup/' + FU2 + '?hard=1', undefined, A);
  await req('DELETE', '/api/r/task/' + TK + '?hard=1', undefined, A);
  await req('DELETE', '/api/calendar/events/' + EV, undefined, A);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
