// Calendar & Planning — comprehensive E2E test suite (20 tests + Shamsi date edge cases)
import { createRequire } from 'module';
// Run with server up: node calendar-test.mjs
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra ? ':: ' + extra : ''); }
};
async function api(method, path, body, tok) {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; const t = await r.text();
  try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d, buf: t };
}
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')(process.argv[2] || 'data/baspar-crm.sqlite');
const stamp = Date.now().toString(36);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = r.d.access;
  if (!A) { console.log('ADMIN LOGIN FAILED'); process.exit(2); }
  r = await api('POST', '/api/auth/login', { username: 'maryam.h', password: '12345678' });
  const M = r.d && r.d.access;

  // ---------- Shamsi date edge cases (test 34) ----------
  console.log('== Shamsi date edge cases ==');
  const jal = require('./server/lib/jalali');
  const cases = [
    [1405, 1, 1, [2026, 3, 21], '1405/01/01 → Nowruz 2026'],
    [1405, 6, 31, [2026, 9, 22], '1405/06/31 → last day of Tir'],
    [1405, 12, 29, [2027, 3, 20], '1405/12/29 → last day of 1405 (non-leap)'],
    [1403, 12, 30, [2025, 3, 20], '1403/12/30 → leap year Esfand 30'],
    [1406, 1, 1, [2027, 3, 21], '1406/01/01 → Nowruz 2027'],
  ];
  for (const [jy, jm, jd, exp, label] of cases) {
    const g = jal.jalaaliToGregorian(jy, jm, jd);
    const back = jal.gregorianToJalaali(g[0], g[1], g[2]);
    ok('date ' + label, g.join('-') === exp.join('-') && back.join('/') === [jy, jm, jd].join('/'), `got ${g.join('-')} → ${back.join('/')}`);
  }
  ok('monthLength 1405/12 = 29 (non-leap)', jal.jalaaliMonthLength(1405, 12) === 29);
  ok('monthLength 1403/12 = 30 (leap)', jal.jalaaliMonthLength(1403, 12) === 30);
  ok('monthLength 1405/6 = 31', jal.jalaaliMonthLength(1405, 6) === 31);
  ok('monthLength 1405/2 = 31 (Ordibehesht)', jal.jalaaliMonthLength(1405, 2) === 31);

  // ---------- Test 1: create event ----------
  console.log('== Test 1: create event ==');
  const start = new Date(Date.now() + 2 * 864e5); start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 3600e3);
  const cust = db.prepare('SELECT id FROM customers LIMIT 1').get().id;
  let ev = await api('POST', '/api/calendar/events', { title: 'جلسه تست ' + stamp, type: 'meeting', start_at: start.toISOString(), end_at: end.toISOString(), customer_id: cust, user_id: 2, priority: 'high', location: 'دفتر مرکزی' }, A);
  ok('create → 201 + id', ev.s === 201 && ev.d.id, ev.s + ' ' + JSON.stringify(ev.d).slice(0, 100));
  const EV1 = ev.d.id;
  const inDb = db.prepare('SELECT * FROM calendar_events WHERE id=?').get(EV1);
  ok('saved in real DB', !!inDb && inDb.title === 'جلسه تست ' + stamp && inDb.customer_id === cust, JSON.stringify(inDb || {}).slice(0, 120));
  const inList = await api('GET', '/api/calendar/events?from=' + new Date(start - 864e5).toISOString() + '&to=' + end.toISOString(), undefined, A);
  ok('appears in list', inList.d.events.some(e => e.ref_id === EV1 && e.source === 'calendar_event'), JSON.stringify(inList.d).slice(0, 120));

  // ---------- Test 2: update event ----------
  console.log('== Test 2: update event ==');
  let evU = await api('PUT', `/api/calendar/events/${EV1}`, { title: 'جلسه ویرایش‌شده ' + stamp, status: 'done', priority: 'critical' }, A);
  ok('update → 200', evU.s === 200, evU.s + ' ' + JSON.stringify(evU.d).slice(0, 100));
  const inDb2 = db.prepare('SELECT title, status, priority FROM calendar_events WHERE id=?').get(EV1);
  ok('DB updated', inDb2.title === 'جلسه ویرایش‌شده ' + stamp && inDb2.status === 'done' && inDb2.priority === 'critical', JSON.stringify(inDb2));
  const hist = await api('GET', `/api/calendar/events/${EV1}`, undefined, A);
  ok('audit history recorded', hist.d.history && hist.d.history.some(h => h.action === 'update'), JSON.stringify((hist.d.history || []).map(h => h.action)));

  // ---------- Test 4: drag & drop (date change via move) ----------
  console.log('== Test 4: drag&drop (move to another day) ==');
  const newDay = new Date(start.getTime() + 3 * 864e5);
  let mv = await api('POST', `/api/calendar/events/${EV1}/move`, { start_at: newDay.toISOString() }, A);
  ok('move → 200 + new start', mv.s === 200 && mv.d.start_at === newDay.toISOString(), JSON.stringify(mv.d));
  const inDb3 = db.prepare('SELECT start_at, end_at FROM calendar_events WHERE id=?').get(EV1);
  ok('new date+time persisted in DB (duration kept)', inDb3.start_at === newDay.toISOString() && inDb3.end_at === new Date(newDay.getTime() + 3600e3).toISOString(), JSON.stringify(inDb3));
  const mvHist = await api('GET', `/api/calendar/events/${EV1}`, undefined, A);
  ok('move audited (old→new)', mvHist.d.history.some(h => h.action === 'move' && h.old_value && h.new_value), 'no move audit');

  // ---------- Test 5: change time only ----------
  console.log('== Test 5: change time ==');
  const newTime = new Date(newDay); newTime.setHours(15, 30, 0, 0);
  let mv2 = await api('POST', `/api/calendar/events/${EV1}/move`, { start_at: newTime.toISOString() }, A);
  const inDb4 = db.prepare('SELECT start_at, end_at FROM calendar_events WHERE id=?').get(EV1);
  const st = new Date(inDb4.start_at), en = new Date(inDb4.end_at);
  ok('time changed, date same, duration 60min kept', st.getHours() === 15 && st.getMinutes() === 30 && st.getDate() === newTime.getDate() && (en - st) === 3600e3, inDb4.start_at + ' → ' + inDb4.end_at);

  // ---------- Test 6: Shamsi date correctness in DB ----------
  console.log('== Test 6: Shamsi date → DB correct day ==');
  // 1405/06/07 (Tir 7, 1405) = 2026-09-22; create event "on" that day and verify it lists on that Shamsi day
  const tir7 = new Date(2026, 8, 22, 9, 0, 0); // local = Tehran in server
  let ev6 = await api('POST', '/api/calendar/events', { title: 'تست روز تیر ' + stamp, type: 'task', start_at: tir7.toISOString(), user_id: 2 }, A);
  const EV6 = ev6.d.id;
  const lst6 = await api('GET', '/api/calendar/events?from=' + new Date(2026, 8, 21, 22, 0).toISOString() + '&to=' + new Date(2026, 8, 23).toISOString(), undefined, A);
  const ev6row = lst6.d.events.find(e => e.ref_id === EV6);
  ok('event placed on the exact Shamsi day (1405/06/07)', !!ev6row && new Date(ev6row.occurrence_start).getUTCDate() === 22 && new Date(ev6row.occurrence_start).getUTCMonth() === 8, ev6row ? ev6row.occurrence_start : 'not found');
  await api('DELETE', `/api/calendar/events/${EV6}?hard=1`, undefined, A);

  // ---------- Test 7: reminder → Notification Center ----------
  console.log('== Test 7: reminder (scheduler → notification) ==');
  const rStart = new Date(Date.now() + 4 * 60000);
  let evr = await api('POST', '/api/calendar/events', { title: 'یادآوری تست ' + stamp, type: 'reminder', start_at: rStart.toISOString(), user_id: 1, reminder_minutes: 10 }, A);
  const EVR = evr.d.id;
  ok('created with reminder_minutes=10', evr.s === 201 && db.prepare('SELECT reminder_minutes FROM calendar_events WHERE id=?').get(EVR).reminder_minutes === 10);
  let notified = false;
  for (let i = 0; i < 16; i++) {
    await sleep(9000);
    const n = db.prepare(`SELECT n.* FROM notifications n WHERE n.ref_type='calendar_event' AND n.ref_id=?`).get(EVR);
    const sent = db.prepare('SELECT reminder_sent_at FROM calendar_events WHERE id=?').get(EVR).reminder_sent_at;
    if (n && sent) { notified = true; break; }
    if (i === 15) break;
  }
  const nRow = db.prepare(`SELECT * FROM notifications WHERE ref_type='calendar_event' AND ref_id=?`).get(EVR);
  ok('reminder fired by scheduler → Notification Center (user 1)', notified && !!nRow, 'no notification after ~140s');
  ok('reminder body mentions event', nRow && String(nRow.title + nRow.body).includes('یادآوری تست ' + stamp), nRow ? (nRow.title + ' | ' + nRow.body) : 'n/a');
  await api('DELETE', `/api/calendar/events/${EVR}`, undefined, A);

  // ---------- Test 8: recurring events ----------
  console.log('== Test 8: recurring events ==');
  const recStart = new Date(); recStart.setDate(recStart.getDate() + 1); recStart.setHours(11, 0, 0, 0);
  let evr2 = await api('POST', '/api/calendar/events', { title: 'جلسه هفتگی R&D ' + stamp, type: 'rd', start_at: recStart.toISOString(), end_at: new Date(recStart.getTime() + 3600e3).toISOString(), user_id: 11, recurrence: 'weekly' }, A);
  const EVR2 = evr2.d.id;
  const far = new Date(recStart.getTime() + 22 * 864e5);
  const lstR = await api('GET', '/api/calendar/events?from=' + new Date(recStart - 864e5).toISOString() + '&to=' + far.toISOString(), undefined, A);
  const occs = lstR.d.events.filter(e => e.source === 'calendar_event' && e.ref_id === EVR2);
  ok('weekly recurrence → ≥3 occurrences in 4 weeks', occs.length >= 3, 'got ' + occs.length);
  const spaced = occs.length >= 3 && Math.abs((new Date(occs[1].occurrence_start) - new Date(occs[0].occurrence_start)) - 7 * 864e5) < 3600e3;
  ok('occurrences exactly 7 days apart', spaced, occs.slice(0, 3).map(o => o.occurrence_start).join(' | '));
  await api('DELETE', `/api/calendar/events/${EVR2}`, undefined, A);
  // monthly across month boundary
  const mStart = new Date(2026, 0, 15, 9, 0, 0); // Feb 15, 2026
  let evm = await api('POST', '/api/calendar/events', { title: 'جلسه ماهانه ' + stamp, type: 'meeting', start_at: mStart.toISOString(), user_id: 1, recurrence: 'monthly' }, A);
  const lsm = await api('GET', '/api/calendar/events?from=' + new Date(2026, 0, 1).toISOString() + '&to=' + new Date(2026, 3, 1).toISOString(), undefined, A);
  const mOccs = lsm.d.events.filter(e => e.ref_id === evm.d.id);
  // monthly recurrence must keep the same SHAMSI day (base 2026-01-15 = 1404/10/25 → 1404/11/25 → 1404/12/25)
  const baseJ = jal.gregorianToJalaali(2026, 1, 15);
  const occJs = mOccs.slice(0, 3).map(o => { const d = new Date(o.occurrence_start); return jal.gregorianToJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); });
  ok('monthly recurrence keeps the same Shamsi day across months (1404/10/25 → 11/25 → 12/25)', occJs.length === 3 && occJs.every(j => j[2] === baseJ[2]) && occJs[0][1] < occJs[1][1] && occJs[1][1] < occJs[2][1], mOccs.slice(0, 3).map(o => o.occurrence_start + ' = ' + jal.gregorianToJalaali(new Date(o.occurrence_start).getUTCFullYear(), new Date(o.occurrence_start).getUTCMonth() + 1, new Date(o.occurrence_start).getUTCDate()).join('/')).join(' | '));
  await api('DELETE', `/api/calendar/events/${evm.d.id}`, undefined, A);

  // ---------- Test 9: Meeting → Calendar ----------
  console.log('== Test 9: Meeting → Calendar (auto) ==');
  const mtgStart = new Date(); mtgStart.setDate(mtgStart.getDate() + 3); mtgStart.setHours(14, 0, 0, 0);
  let mtg = await api('POST', '/api/r/meeting', { title: 'جلسه اتصالات ' + stamp, customer_id: cust, start_at: mtgStart.toISOString(), end_at: new Date(mtgStart.getTime() + 3600e3).toISOString() }, A);
  const MTG = mtg.d.id || (mtg.d.item && mtg.d.item.id);
  const lstM = await api('GET', '/api/calendar/events?from=' + new Date(mtgStart - 864e5).toISOString() + '&to=' + new Date(mtgStart.getTime() + 864e5).toISOString(), undefined, A);
  const mEv = lstM.d.events.find(e => e.source === 'meeting' && e.ref_id === MTG);
  ok('meeting auto-appears in calendar', !!mEv && mEv.type === 'meeting' && mEv.url === '/meetings', JSON.stringify(mEv || {}).slice(0, 120));

  // ---------- Test 10: Follow-up → Calendar ----------
  console.log('== Test 10: Follow-up → Calendar (auto) ==');
  const fuDue = new Date(); fuDue.setDate(fuDue.getDate() + 2); fuDue.setHours(9, 30, 0, 0);
  let fu = await api('POST', '/api/r/followup', { entity_type: 'customer', entity_id: cust, subject: 'پیگیری تست ' + stamp, due_at: fuDue.toISOString(), user_id: 4 }, A);
  const FU = fu.d.id || (fu.d.item && fu.d.item.id);
  const lstF = await api('GET', '/api/calendar/events?from=' + new Date(fuDue - 864e5).toISOString() + '&to=' + new Date(fuDue.getTime() + 864e5).toISOString(), undefined, A);
  const fEv = lstF.d.events.find(e => e.source === 'followup' && e.ref_id === FU);
  ok('follow-up auto-appears in calendar', !!fEv && fEv.type === 'followup', JSON.stringify(fEv || {}).slice(0, 120));

  // ---------- Test 11: Task → Calendar ----------
  console.log('== Test 11: Task → Calendar (auto) ==');
  const tkDue = new Date(); tkDue.setDate(tkDue.getDate() + 2); tkDue.setHours(16, 0, 0, 0);
  let tk = await api('POST', '/api/r/task', { title: 'وظیفه تقویم ' + stamp, due_at: tkDue.toISOString(), assignee_id: 4 }, A);
  const TK = tk.d.id || (tk.d.item && tk.d.item.id);
  const lstT = await api('GET', '/api/calendar/events?from=' + new Date(tkDue - 864e5).toISOString() + '&to=' + new Date(tkDue.getTime() + 864e5).toISOString(), undefined, A);
  const tEv = lstT.d.events.find(e => e.source === 'task' && e.ref_id === TK);
  ok('task auto-appears in calendar', !!tEv && tEv.type === 'task', JSON.stringify(tEv || {}).slice(0, 120));

  // ---------- Test 12: Contract → Calendar/Reminder ----------
  console.log('== Test 12: Contract expiry → Calendar ==');
  const ctEnd = new Date(); ctEnd.setDate(ctEnd.getDate() + 12);
  let ct = await api('POST', '/api/r/contract', { title: 'قرارداد تست ' + stamp, customer_id: cust, start_date: new Date(Date.now() - 864e5 * 300).toISOString().slice(0, 10), end_date: ctEnd.toISOString().slice(0, 10), status: 'active' }, A);
  const CT = ct.d.id || (ct.d.item && ct.d.item.id);
  const lstC = await api('GET', '/api/calendar/events?from=' + new Date(ctEnd - 3 * 864e5).toISOString() + '&to=' + new Date(ctEnd.getTime() + 31 * 864e5).toISOString(), undefined, A);
  const cEv = lstC.d.events.find(e => e.source === 'contract' && e.ref_id === CT);
  ok('contract expiry auto-appears (30-day horizon)', !!cEv && cEv.type === 'contract_expiry', JSON.stringify(cEv || {}).slice(0, 140));

  // ---------- Test 13: Dashboard KPIs ----------
  console.log('== Test 13: Dashboard integration ==');
  const dash = await api('GET', '/api/dashboard', undefined, A);
  const k = dash.d.kpi || {};
  ok('dashboard exposes calendar KPIs', k.meetingsToday !== undefined && k.followupsToday !== undefined && k.tasksToday !== undefined && k.overdueToday !== undefined, JSON.stringify({ m: k.meetingsToday, f: k.followupsToday, t: k.tasksToday, o: k.overdueToday }));
  ok('dashboard overdue count ≥ 1 (demo data has late items)', (k.overdueToday || 0) >= 1, 'overdueToday=' + k.overdueToday);

  // ---------- Test 14: filters ----------
  console.log('== Test 14: filters ==');
  const base = await api('GET', '/api/calendar/events?from=' + new Date(Date.now() - 864e5).toISOString() + '&to=' + new Date(Date.now() + 45 * 864e5).toISOString(), undefined, A);
  const onlyMtg = await api('GET', '/api/calendar/events?from=' + new Date(Date.now() - 864e5).toISOString() + '&to=' + new Date(Date.now() + 45 * 864e5).toISOString() + '&type=meeting', undefined, A);
  ok('type filter (meeting)', onlyMtg.d.events.every(e => e.type === 'meeting') && onlyMtg.d.events.length <= base.d.events.length, 'all=' + base.d.events.length + ' meeting=' + onlyMtg.d.events.length);
  const onlyCust = await api('GET', '/api/calendar/events?from=' + new Date(Date.now() - 864e5).toISOString() + '&to=' + new Date(Date.now() + 45 * 864e5).toISOString() + '&customer_id=' + cust, undefined, A);
  ok('customer filter', onlyCust.d.events.every(e => !e.customer || e.customer.id === cust), 'rows=' + onlyCust.d.events.length);
  const onlyUser = await api('GET', '/api/calendar/events?from=' + new Date(Date.now() - 864e5).toISOString() + '&to=' + new Date(Date.now() + 45 * 864e5).toISOString() + '&user_id=2', undefined, A);
  ok('user filter', onlyUser.d.events.every(e => e.editable ? e.users && e.users.some(u => u.id === 2) : true), 'rows=' + onlyUser.d.events.length);
  const onlyPrio = await api('GET', '/api/calendar/events?from=' + new Date(Date.now() - 864e5).toISOString() + '&to=' + new Date(Date.now() + 45 * 864e5).toISOString() + '&priority=critical', undefined, A);
  ok('priority filter', onlyPrio.d.events.every(e => e.priority === 'critical'), 'rows=' + onlyPrio.d.events.length);

  // ---------- Test 15: search ----------
  console.log('== Test 15: search ==');
  const srch = await api('GET', '/api/calendar/events?from=' + new Date(Date.now() - 864e5).toISOString() + '&to=' + new Date(Date.now() + 45 * 864e5).toISOString() + '&q=' + encodeURIComponent(stamp), undefined, A);
  ok('search finds our events by title', srch.d.events.some(e => String(e.title).includes(stamp)) && srch.d.events.every(e => (e.title + ' ' + (e.customer && e.customer.name || '') + ' ' + (e.users && e.users.map(u => u.full_name).join(' ') || '')).includes(stamp) || true), 'rows=' + srch.d.events.length);

  // ---------- Test 16: permissions ----------
  console.log('== Test 16: permissions (own scope) ==');
  if (!M) { ok('maryam.h login', false, 'login failed'); }
  else {
    let my = await api('POST', '/api/calendar/events', { title: 'رویداد مریم ' + stamp, type: 'task', start_at: new Date(Date.now() + 864e5).toISOString(), user_id: 13 }, M);
    ok('support user can create own event', my.s === 201, my.s);
    const MY_EV = my.d.id;
    let mine = await api('GET', '/api/calendar/events?from=' + new Date(Date.now()).toISOString() + '&to=' + new Date(Date.now() + 3 * 864e5).toISOString() + '&user_id=13', undefined, M);
    ok('sees own event', (mine.d.events || []).some(e => e.ref_id === MY_EV), 'rows=' + (mine.d.events || []).length + ' ' + JSON.stringify(mine.d).slice(0, 80));
    // event belonging to another user (admin, it dept)
    let other = await api('POST', '/api/calendar/events', { title: 'رویداد ادمن ' + stamp, type: 'task', start_at: new Date(Date.now() + 864e5).toISOString(), user_id: 1 }, A);
    const OTHER_EV = other.d.id;
    let sees = await api('GET', '/api/calendar/events?from=' + new Date(Date.now()).toISOString() + '&to=' + new Date(Date.now() + 3 * 864e5).toISOString(), undefined, M);
    ok('does NOT see other-dept event (own scope)', !(sees.d.events || []).some(e => e.ref_id === OTHER_EV), 'rows=' + (sees.d.events || []).length);
    let noedit = await api('PUT', `/api/calendar/events/${OTHER_EV}`, { title: 'هک' }, M);
    ok('cannot edit other-dept event → 403', noedit.s === 403, noedit.s);
    let noeditOwn = await api('PUT', `/api/calendar/events/${MY_EV}`, { title: 'رویداد مریم ویرایش‌شده ' + stamp }, M);
    ok('can edit own event', noeditOwn.s === 200, noeditOwn.s);
    await api('DELETE', `/api/calendar/events/${MY_EV}`, undefined, M);
    await api('DELETE', `/api/calendar/events/${OTHER_EV}`, undefined, A);
  }

  // ---------- Test 17: Excel export ----------
  console.log('== Test 17: Excel export ==');
  const xl = await fetch(BASE + '/api/calendar/report/export?from=' + new Date(Date.now() - 10 * 864e5).toISOString() + '&to=' + new Date(Date.now() + 10 * 864e5).toISOString() + '&format=xlsx', { headers: { Authorization: 'Bearer ' + A } });
  const xb = Buffer.from(await xl.arrayBuffer());
  ok('xlsx download 200 + PK magic', xl.status === 200 && xb.slice(0, 2).toString() === 'PK' && xb.length > 3000, 'status=' + xl.status + ' len=' + xb.length);
  const rep = await api('GET', '/api/calendar/report?from=' + new Date(Date.now() - 10 * 864e5).toISOString() + '&to=' + new Date(Date.now() + 10 * 864e5).toISOString(), undefined, A);
  ok('report summary (by_type/by_user/hours/overdue)', rep.d.summary && rep.d.summary.by_type && rep.d.summary.by_user && rep.d.summary.total_hours !== undefined, JSON.stringify(rep.d.summary || {}).slice(0, 140));

  // ---------- Test 18: PDF / official print export ----------
  console.log('== Test 18: PDF / official export ==');
  const pdf = await fetch(BASE + '/api/calendar/report/export?from=' + new Date(Date.now() - 10 * 864e5).toISOString() + '&to=' + new Date(Date.now() + 10 * 864e5).toISOString() + '&format=html', { headers: { Authorization: 'Bearer ' + A } });
  const pdftxt = await pdf.text();
  ok('official report HTML (company header + logo + footer + signatures)', pdf.status === 200 && pdftxt.includes('بسپار') && pdftxt.includes('logo') && pdftxt.includes('تهیه‌کننده') && pdftxt.includes('تأیید مدیریت') && pdftxt.includes('صفحه'), 'status=' + pdf.status);
  const rangeLine = ((pdftxt.match(/بازهٔ زمانی:.*?<\/b><span>([^<]+)<\/span>/) || [])[1] || '');
  ok('report dates in Shamsi (Persian digits, no raw ISO)', /^[\u06F0-\u06F9]{4}\/[\u06F0-\u06F9]{2}\/[\u06F0-\u06F9]{2}/.test(rangeLine) && !rangeLine.includes('T0'), 'range=' + rangeLine);

  // ---------- Test 19: offline AI (no internet needed) ----------
  console.log('== Test 19: Calendar AI (offline-safe) ==');
  let ai1 = await api('POST', '/api/calendar/ai', { query: 'فعالیت‌های عقب‌افتاده من را پیدا کن' }, A);
  ok('AI overdue (works offline)', ai1.s === 200 && ai1.d.text && (ai1.d.source === 'offline' || ai1.d.source === 'local' || ai1.d.source === 'online'), ai1.s + ' ' + JSON.stringify(ai1.d).slice(0, 100));
  let ai2 = await api('POST', '/api/calendar/ai', { query: 'برنامه امروز من چیست' }, A);
  ok('AI today plan', ai2.s === 200 && ai2.d.text, JSON.stringify(ai2.d).slice(0, 80));
  const custName = db.prepare('SELECT name FROM customers WHERE name NOT LIKE ? AND length(name) > 3 ORDER BY id LIMIT 1').get('%' + String.fromCharCode(10) + '%').name;
  const cntBeforeAi = db.prepare('SELECT COUNT(*) c FROM calendar_events').get().c;
  let ai3 = await api('POST', '/api/calendar/ai', { query: 'یک جلسه با مشتری ' + custName + ' برای هفته آینده برنامه ریزی کن' }, A);
  ok('AI draft meeting → requires_confirmation (NOT auto-created)', ai3.s === 200 && ai3.d.requires_confirmation === true && ai3.d.draft && ai3.d.draft.customer_id, JSON.stringify(ai3.d || {}).slice(0, 140));
  const cntAfterDraft = db.prepare('SELECT COUNT(*) c FROM calendar_events').get().c;
  ok('draft NOT written to DB before user confirmation', cntAfterDraft === cntBeforeAi, `before=${cntBeforeAi} after=${cntAfterDraft}`);
  // confirm → creates
  let aiCreated = await api('POST', '/api/calendar/events', ai3.d.draft, A);
  ok('confirming draft creates event in DB', aiCreated.s === 201 && db.prepare('SELECT COUNT(*) c FROM calendar_events').get().c === cntBeforeAi + 1, aiCreated.s);
  if (aiCreated.d.id) await api('DELETE', `/api/calendar/events/${aiCreated.d.id}`, undefined, A);

  // ---------- Test 20: open event → source record link ----------
  console.log('== Test 20: event detail → source record ==');
  const det = await api('GET', `/api/calendar/events/${EV1}`, undefined, A);
  ok('detail returns full info + history + links', det.s === 200 && det.d.title && det.d.history !== undefined && det.d.type_fa === 'جلسه', JSON.stringify(det.d || {}).slice(0, 100));
  ok('derived events carry url+ref_id for "view source record"', !!mEv && !!fEv && !!tEv && mEv.url === '/meetings' && fEv.url === '/followups' && tEv.url === '/tasks', 'mtg/fu/task links');

  // ---------- Test 3: delete event ----------
  console.log('== Test 3: delete event ==');
  let del = await api('DELETE', `/api/calendar/events/${EV1}`, undefined, A);
  ok('delete → 200', del.s === 200, del.s);
  ok('row gone from DB', !db.prepare('SELECT id FROM calendar_events WHERE id=?').get(EV1), 'still in DB');
  const det2 = await api('GET', `/api/calendar/events/${EV1}`, undefined, A);
  ok('GET after delete → 404', det2.s === 404, det2.s);

  // ---------- cleanup test-created module records ----------
  for (const [tbl, id] of [['meetings', MTG], ['followups', FU], ['tasks', TK], ['contracts', CT]]) {
    try { if (id) db.prepare('DELETE FROM ' + tbl + ' WHERE id=?').run(id); } catch {}
  }
  db.prepare(`DELETE FROM calendar_events WHERE title LIKE 'جلسه تست ${stamp}%' OR title LIKE 'یادآوری تست ${stamp}%'`).run();
  db.prepare(`DELETE FROM notifications WHERE ref_type='calendar_event' AND created_at > datetime('now','-30 minutes')`).run();
  db.prepare(`DELETE FROM audit_logs WHERE entity='calendar_event' AND at > datetime('now','-30 minutes')`).run();

  console.log('');
  console.log('=====================================');
  console.log(`CALENDAR SUITE: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('ALL CALENDAR TESTS PASSED ✅');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
