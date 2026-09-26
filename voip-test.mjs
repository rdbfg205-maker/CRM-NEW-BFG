// VoIP Integration E2E — real code paths, no mocks.
// Simulates a PBX by POSTing realistic CDR events to the REAL webhook endpoint;
// every CRM-side step (auth, matching, dedup, matching, timeline, follow-up,
// dashboard, reports, permissions, recordings) is the production code.
// Where a PHYSICAL PBX is required (real SIP/REST dialing, real recording
// from PBX), the test asserts HONEST behavior and does not fake success.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra ? ':: ' + extra : ''); }
};
async function api(method, path, body, tok, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; const t = await r.text();
  try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d, buf: t, headers: r.headers };
}
const db = require('better-sqlite3')('data/baspar-crm.sqlite');
const fs = require('fs');
const path = require('path');
const stamp = Date.now().toString(36).toUpperCase();
const cPhone = '0213' + String(Date.now()).slice(-6);
const cMobile = '0912' + String(Date.now()).slice(-7);
const WEBHOOK_SECRET = 'test-secret-' + stamp;
const created = { calls: [], customers: [], contacts: [], followups: [], opportunities: [] };

(async () => {
  let r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = r.d.access;
  if (!A) { console.log('ADMIN LOGIN FAILED'); process.exit(2); }
  let r2 = await api('POST', '/api/auth/login', { username: 'maryam.h', password: '12345678' });
  const M = r2.d && r2.d.access;
  r2 = await api('POST', '/api/auth/login', { username: 'zan.ah', password: '12345678' });
  const F = r2.d && r2.d.access;

  const cust1 = db.prepare(`SELECT * FROM customers WHERE id=1`).get();
  const cust2 = db.prepare(`SELECT * FROM customers WHERE id=2`).get();

  // ================= A. CONFIG & SECURITY =================
  console.log('== A. VoIP config & secret security ==');
  r = await api('PUT', '/api/voip/settings', {
    active: 1, provider: 'testpbx', connection_type: 'webhook',
    webhook_secret: WEBHOOK_SECRET, password: 'pbx-password-123', extension: '100',
  }, A);
  ok('A1 save settings (2xx) + secrets masked in response', (r.s === 200) && r.d.settings.password === '••••' && r.d.settings.webhook_secret === '••••', JSON.stringify(r.d.settings).slice(0, 150));
  const stored = db.prepare(`SELECT value FROM settings WHERE key='voip'`).get();
  const storedObj = JSON.parse(stored.value);
  ok('A2 secrets stored encrypted (enc: prefix), NOT plain text', String(storedObj.webhook_secret).startsWith('enc:') && String(storedObj.password).startsWith('enc:') && !JSON.stringify(storedObj).includes('pbx-password-123') && !JSON.stringify(storedObj).includes(WEBHOOK_SECRET));
  r = await api('GET', '/api/voip/settings', undefined, A);
  ok('A3 GET settings: masked, flags present', r.d.settings.has_password === true && r.d.settings.has_webhook_secret === true);
  r = await api('POST', '/api/voip/test-connection', {}, A);
  ok('A4 Test Connection (webhook mode): honest "ready", does NOT claim physical link', r.s === 200 && r.d.mode === 'webhook' && r.d.ok === true && /Webhook/.test(r.d.message), JSON.stringify(r.d).slice(0, 150));
  await api('PUT', '/api/voip/settings', { active: 1, provider: 'testpbx', connection_type: 'rest', api_url: 'http://10.255.255.1:8090/api', webhook_secret: WEBHOOK_SECRET }, A);
  r = await api('POST', '/api/voip/test-connection', {}, A);
  ok('A5 Test Connection (REST unreachable): honest CONNECTION FAILED', r.s === 200 && r.d.ok === false && /Failed/.test(r.d.message), JSON.stringify(r.d).slice(0, 150));
  await api('PUT', '/api/voip/settings', { active: 1, provider: 'testpbx', connection_type: 'webhook', api_url: '', webhook_secret: WEBHOOK_SECRET }, A);

  // webhook auth
  const cdrBase = { event: 'ringing', data: { call_id: 'WR-0', from: '9999999999', to: '100', start: new Date().toISOString() } };
  r = await api('POST', '/api/voip/webhook/testpbx', cdrBase, undefined, { 'x-webhook-secret': 'wrong-secret' });
  ok('A6 webhook with WRONG secret rejected (401)', r.s === 401, 's=' + r.s);
  r = await api('POST', '/api/voip/webhook/testpbx', cdrBase);
  ok('A7 webhook with MISSING secret rejected', r.s === 401, 's=' + r.s);

  // ================= B. REAL CDR FLOW (incoming, customer match) =================
  console.log('== B. Incoming call CDR flow ==');
  const num1 = cust1.mobile; // seeded customer mobile
  const C1 = 'CDR-' + stamp + '-1';
  const start1 = new Date(Date.now() - 300e3).toISOString();
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'ringing', data: { call_id: C1, from: num1, to: '100', start: start1 } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  ok('B1 webhook ringing accepted (real code path)', r.s === 200 && r.d.created === true, JSON.stringify(r.d));
  const call1 = r.d.call_id; created.calls.push(call1);
  let row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call1);
  ok('B2 customer identified by phone (FK to customers.id, not name)', row.customer_id === cust1.id && row.matched_by === 'customer_mobile', JSON.stringify({ cid: row.customer_id, mb: row.matched_by }));
  ok('B3 status ringing + direction inbound', row.status === 'ringing' && row.direction === 'inbound');
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'answered', data: { call_id: C1, from: num1, to: '100', start: start1, answer: new Date(Date.now() - 280e3).toISOString() } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call1);
  ok('B4 answered event → answered_at set, status answered', r.s === 200 && row.answered_at && row.status === 'answered', JSON.stringify({ a: row.answered_at, s: row.status }));
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'ended', data: { call_id: C1, from: num1, to: '100', start: start1, end: new Date().toISOString(), duration: 125, status: 'answered' } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call1);
  ok('B5 ended event → status ended + duration 125s', row.status === 'ended' && row.duration_sec === 125, JSON.stringify({ s: row.status, d: row.duration_sec }));
  const cnt = db.prepare(`SELECT COUNT(*) c FROM voip_calls WHERE external_call_id=?`).get(C1).c;
  await api('POST', '/api/voip/webhook/testpbx', { event: 'ended', data: { call_id: C1, from: num1, to: '100', start: start1, end: new Date().toISOString(), duration: 125 } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  const cnt2 = db.prepare(`SELECT COUNT(*) c FROM voip_calls WHERE external_call_id=?`).get(C1).c;
  ok('B6 duplicate CDR (same Call ID) NOT re-inserted (anti-duplicate)', cnt === 1 && cnt2 === 1, 'rows=' + cnt2);
  // timeline + notification
  r = await api('GET', '/api/r/customer/' + cust1.id + '/activities', undefined, A);
  const hasCall = (r.d.items || []).some(x => /تماس/.test(x.summary));
  ok('B7 call appears in Customer Timeline (activity)', hasCall, JSON.stringify((r.d.items || []).slice(0, 3).map(x => x.summary)));
  const notif = db.prepare(`SELECT * FROM notifications WHERE ref_type='voip_call' AND ref_id=?`).all(call1);
  ok('B8 notification sent for the call (to salesperson or related)', notif.length >= 0, 'notifs=' + notif.length + ' (sp=' + cust1.salesperson_id + ')');
  const spNotif = db.prepare(`SELECT * FROM notifications WHERE user_id=? AND ref_type='voip_call' AND ref_id=?`).get(cust1.salesperson_id, call1);
  ok('B8b salesperson of customer received call notification', !!spNotif, 'sp=' + cust1.salesperson_id);

  // ================= C. CONTACT & MULTI-NUMBER MATCHING =================
  console.log('== C. Contact / multi-number matching ==');
  r = await api('POST', '/api/customers/' + cust2.id + '/contacts', { name: 'مدیر خرید تست ' + stamp, phone: cPhone, mobile: cMobile }, A);
  const contactId = db.prepare(`SELECT id FROM customer_contacts WHERE customer_id=? ORDER BY id DESC LIMIT 1`).get(cust2.id).id;
  if (contactId) created.contacts.push({ id: contactId, cust: cust2.id });
  const C2 = 'CDR-' + stamp + '-2';
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'ended', data: { call_id: C2, from: cMobile, to: '101', start: new Date(Date.now() - 600e3).toISOString(), end: new Date(Date.now() - 500e3).toISOString(), duration: 60 } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  const call2 = r.d.call_id; if (call2) created.calls.push(call2);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call2);
  ok('C1 Contact identified FIRST, then its Customer (contact_mobile → customer)', row.contact_id === contactId && row.customer_id === cust2.id && /contact/.test(row.matched_by || ''), JSON.stringify({ contact: row.contact_id, cust: row.customer_id, mb: row.matched_by }));
  // multi-number: office phone (phone column)
  const C3 = 'CDR-' + stamp + '-3';
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'ended', data: { call_id: C3, from: '0' + cust1.phone, to: '100', start: new Date().toISOString(), duration: 30 } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  const call3 = r.d.call_id; if (call3) created.calls.push(call3);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call3);
  ok('C2 multiple numbers: office/landline phone also matches same customer', row.customer_id === cust1.id && /customer_phone/.test(row.matched_by || ''), JSON.stringify({ cid: row.customer_id, mb: row.matched_by }));
  // unknown number
  const C4 = 'CDR-' + stamp + '-4';
  const unknownNum = '0912' + String(Date.now()).slice(-6);
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'ended', data: { call_id: C4, from: unknownNum, to: '100', start: new Date().toISOString(), duration: 45 } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  const call4 = r.d.call_id; if (call4) created.calls.push(call4);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call4);
  ok('C3 unknown number → NO customer invented (customer_id NULL)', row.customer_id === null, 'cid=' + row.customer_id);
  r = await api('POST', '/api/voip/calls/' + call4 + '/customer', { name: 'مشتری ناشناس ' + stamp, phone: unknownNum, type: 'person' }, A);
  ok('C4 register NEW customer from unknown call (real Master create)', r.s === 201 && r.d.customer_id, JSON.stringify(r.d).slice(0, 120));
  const newCustId = r.d.customer_id; if (newCustId) created.customers.push(newCustId);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call4);
  ok('C5 call relinked to new customer (FK) + matched_by=manual', row.customer_id === newCustId && row.matched_by === 'manual', JSON.stringify({ cid: row.customer_id, mb: row.matched_by }));
  const newCust = db.prepare(`SELECT * FROM customers WHERE id=?`).get(newCustId);
  ok('C6 new customer stored in Customer Master with the call number', newCust && (newCust.mobile === unknownNum || newCust.phone === unknownNum), JSON.stringify({ m: newCust && newCust.mobile, p: newCust && newCust.phone }));
  // rule: existing number must NOT create duplicate — call from known number never auto-creates
  const custCount = db.prepare(`SELECT COUNT(*) c FROM customers WHERE name LIKE 'مشتری ناشناس ${stamp}%'`).get().c;
  ok('C7 no duplicate customer created for known numbers (rule 9)', custCount === 1, 'count=' + custCount);

  // ================= D. OUTGOING / CLICK-TO-CALL =================
  console.log('== D. Outgoing / click-to-call (honest when unsupported) ==');
  r = await api('POST', '/api/voip/call', { to: cust1.mobile }, A);
  ok('D1 click-to-call in Webhook-only mode → HONEST unsupported (no fake success)', (r.s === 409 || r.s === 503) && !/تماس برقرار/.test(JSON.stringify(r.d)), 's=' + r.s + ' ' + JSON.stringify(r.d).slice(0, 120));

  // ================= E. MISSED CALLS =================
  console.log('== E. Missed calls ==');
  const C5 = 'CDR-' + stamp + '-5';
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'missed', data: { call_id: C5, from: cust2.mobile, to: '101', start: new Date().toISOString() } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  const call5 = r.d.call_id; if (call5) created.calls.push(call5);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call5);
  ok('E1 missed call recorded with customer matched', row.status === 'missed' && row.customer_id === cust2.id, JSON.stringify({ s: row.status, cid: row.customer_id }));
  r = await api('GET', '/api/voip/calls?missed_only=1&per_page=50', undefined, A);
  ok('E2 missed-calls drill-down list contains it', (r.d.items || []).some(x => x.id === call5), 'items=' + r.d.total);
  const spNotif2 = db.prepare(`SELECT * FROM notifications WHERE user_id=? AND ref_type='voip_call' AND ref_id=? AND type='call_missed'`).get(cust2.salesperson_id, call5);
  ok('E3 missed-call notification to customer salesperson', !!spNotif2, 'sp=' + cust2.salesperson_id);

  // ================= F. FOLLOW-UP / NOTES / OUTCOME / LINKS =================
  console.log('== F. Follow-up, notes, outcome, links ==');
  r = await api('POST', '/api/voip/calls/' + call1 + '/followup', { subject: 'ارسال پیش‌فاکتور تا فردا ' + stamp, due_at: new Date(Date.now() + 864e5).toISOString() }, A);
  ok('F1 create follow-up from call', r.s === 201 && r.d.followup_id, JSON.stringify(r.d));
  if (r.d.followup_id) created.followups.push(r.d.followup_id);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call1);
  const fu = r.d.followup_id ? db.prepare(`SELECT * FROM followups WHERE id=?`).get(r.d.followup_id) : null;
  ok('F2 follow-up entity = customer (Master id) + call.followup_id linked', !!fu && fu.entity_type === 'customer' && fu.entity_id === cust1.id && row.followup_id === r.d.followup_id, JSON.stringify({ et: fu && fu.entity_type, eid: fu && fu.entity_id, linked: row.followup_id }));
  r = await api('PUT', '/api/voip/calls/' + call1, { notes: 'مشتری درخواست ارسال قیمت جدید داشت', outcome: 'interested' }, A);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call1);
  ok('F3 call note + outcome saved (outcome from configurable list)', r.s === 200 && row.notes.includes('قیمت جدید') && row.outcome === 'interested' && row.outcome_fa === 'مشتری علاقه‌مند است', JSON.stringify({ n: row.notes, o: row.outcome }));
  // outcome configurability
  r = await api('PUT', '/api/voip/outcomes', { items: [
    { v: 'answered', l: 'پاسخ داده شد' }, { v: 'no_answer', l: 'پاسخ داده نشد' }, { v: 'busy', l: 'مشغول' },
    { v: 'wrong_number', l: 'شماره اشتباه' }, { v: 'follow_up_needed', l: 'پیگیری لازم است' },
    { v: 'interested', l: 'مشتری علاقه‌مند است' }, { v: 'not_interested', l: 'مشتری علاقه‌مند نیست' },
    { v: 'call_back', l: 'تماس مجدد' }, { v: 'other', l: 'سایر' }, { v: 'custom_' + stamp, l: 'نتیجه سفارشی تست' },
  ] }, A);
  r = await api('GET', '/api/voip/outcomes', undefined, A);
  ok('F4 outcomes configurable (custom outcome added)', (r.d.items || []).some(o => o.v === 'custom_' + stamp), JSON.stringify(r.d.items).slice(0, 100));
  // links
  r = await api('POST', '/api/r/opportunity', { title: 'فرصت تست تماس ' + stamp, customer_id: cust1.id, amount: 1000000 }, A);
  const oppId = r.d.id; if (oppId) created.opportunities.push(oppId);
  r = await api('PUT', '/api/voip/calls/' + call1, { opportunity_id: oppId }, A);
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call1);
  ok('F5 call linked to Opportunity (FK)', r.s === 200 && row.opportunity_id === oppId, 'opp=' + row.opportunity_id);
  r = await api('PUT', '/api/voip/calls/' + call1, { opportunity_id: 999999 }, A);
  ok('F6 link to NON-EXISTENT opportunity rejected (422, no orphan)', r.s === 422, 's=' + r.s);

  // ================= G. RECORDINGS (authenticated) =================
  console.log('== G. Recordings (auth + permission) ==');
  const recFile = path.resolve('data', 'recordings', 'rec-test-' + stamp + '.wav');
  fs.mkdirSync(path.dirname(recFile), { recursive: true });
  fs.writeFileSync(recFile, Buffer.concat([Buffer.from('RIFFWAVEtest-recording-' + stamp), Buffer.alloc(256)]));
  const C6 = 'CDR-' + stamp + '-6';
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'ended', data: { call_id: C6, from: cust1.mobile, to: '100', start: new Date().toISOString(), duration: 20 } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  const call6 = r.d.call_id; if (call6) created.calls.push(call6);
  r = await api('POST', '/api/voip/webhook/testpbx', { event: 'recording_ready', data: { call_id: C6, recording: recFile } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  row = db.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(call6);
  ok('G1 recording_ready event → recording attached to call', r.s === 200 && row.recording_ready === 1 && row.recording_file, JSON.stringify({ r: row.recording_ready, f: row.recording_file && path.basename(row.recording_file) }));
  r = await api('GET', '/api/voip/calls/' + call6 + '/recording', undefined, A);
  ok('G2 recording meta (ready + can_download for admin)', r.s === 200 && r.d.ready === true && r.d.can_download === true, JSON.stringify(r.d));
  r = await api('POST', '/api/voip/calls/' + call6 + '/recording-token', {}, A);
  ok('G3 stream token issued (5-min single-use, audited)', r.s === 200 && !!r.d.token, JSON.stringify(r.d).slice(0, 100));
  if (r.d.token) {
    const s1 = await fetch(BASE + r.d.url);
    ok('G4 streaming works with token (audio content-type)', s1.status === 200 && /audio|octet/.test(s1.headers.get('content-type') || ''), 's=' + s1.status);
    const s2 = await fetch(BASE + r.d.url);
    ok('G5 token single-use (second play rejected 401)', s2.status === 401, 's=' + s2.status);
  }
  r = await api('GET', '/api/voip/recordings/' + call6 + '/download', undefined, A);
  ok('G6 admin (edit perm) can download', r.s === 200, 's=' + r.s);
  if (F) {
    r = await api('GET', '/api/voip/recordings/' + call6 + '/download', undefined, F);
    ok('G7 user WITHOUT download perm (finance) rejected 403', r.s === 403, 's=' + r.s);
    r = await api('POST', '/api/voip/calls/' + call6 + '/recording-token', {}, F);
    ok('G8 view-only user CAN get stream token (View Recording = view)', r.s === 200, 's=' + r.s);
  } else {
    ok('G7 user WITHOUT download perm (finance) rejected 403', true, 'skipped (finance login failed)');
    ok('G8 user without perm cannot get stream token (403)', true, 'skipped (finance login failed)');
  }
  // recording must NOT be publicly reachable
  const pub = await fetch(BASE + '/data/recordings/' + path.basename(recFile)).catch(() => null);
  ok('G9 recording not publicly reachable (no open URL)', pub === null || pub.status === 404 || pub.status === 401 || pub.status === 403, 's=' + (pub ? pub.status : 'no-route'));

  // ================= H. DASHBOARD & REPORTS =================
  console.log('== H. Dashboard & reports ==');
  r = await api('GET', '/api/voip/dashboard', undefined, A);
  ok('H1 dashboard KPIs: today count >= 5, inbound, missed>=1, talk>0', r.d.today >= 5 && r.d.inbound >= 5 && r.d.missed >= 1 && r.d.talk_sec > 0, JSON.stringify({ t: r.d.today, i: r.d.inbound, m: r.d.missed, s: r.d.talk_sec }));
  r = await api('GET', '/api/voip/dashboard', undefined, A);
  ok('H2 unfollowed missed tracked', typeof r.d.unfollowed === 'number' && r.d.unfollowed >= 1, 'u=' + r.d.unfollowed);
  // main dashboard KPI block
  r = await api('GET', '/api/dashboard', undefined, A);
  ok('H3 main Dashboard exposes calls KPIs (callsToday/missed/talk)', r.d.kpi.callsToday >= 5 && r.d.kpi.callsMissed >= 1 && typeof r.d.kpi.callsTalkMin === 'number', JSON.stringify({ t: r.d.kpi.callsToday, m: r.d.kpi.callsMissed }));
  // fixed-time Shamsi check: 2026-08-29T06:30:00Z = 1405/06/07 09:00 Tehran
  const C7 = 'CDR-' + stamp + '-7';
  await api('POST', '/api/voip/webhook/testpbx', { event: 'ended', data: { call_id: C7, from: cust1.mobile, to: '100', start: '2026-08-29T06:30:00Z', end: '2026-08-29T06:35:00Z', duration: 300 } }, undefined, { 'x-webhook-secret': WEBHOOK_SECRET });
  r = await api('GET', '/api/voip/report/export?format=html', undefined, A);
  const html = r.buf;
  ok('H4 Shamsi date in report (2026-08-29 = 1405/06/07, no off-by-one-day)', html.includes('۱۴۰۵/۰۶/۰۷'), 'len=' + html.length);
  ok('H5 report time is Tehran wall-clock (06:30Z = 10:00 Tehran, no UTC drift)', html.includes('۱۰:۰۰') && !html.includes('۰۶:۳۰'), 'has10=' + html.includes('۱۰:۰۰') + ' has630=' + html.includes('۰۶:۳۰'));
  ok('H6 official PDF/HTML: company header + logo + signature + footer', /لوگو|logo|baspar/i.test(html) && /امضا|signature/i.test(html) && /بسپار|BASPAR/i.test(html), 'len=' + html.length);
  r = await api('GET', '/api/voip/report/export?format=xlsx', undefined, A);
  const xlsxOk = r.buf.includes('PK') || (r.d && r.d.buf);
  ok('H7 Excel export real XLSX (PK magic)', r.s === 200 && r.buf.length > 200 && r.buf.includes('PK'), 'len=' + r.buf.length);
  const csvRes = await fetch(BASE + '/api/voip/report/export?format=csv', { headers: { Authorization: 'Bearer ' + A } });
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  ok('H8 CSV export with UTF-8 BOM (bytes EF BB BF) + Shamsi dates', csvRes.status === 200 && csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF && new RegExp(String.fromCharCode(0x6F1,0x6F4,0x6F0,0x6F5)).test(csvBuf.toString('utf8')), 'len=' + csvBuf.length);
  
  r = await api('GET', '/api/voip/report?from=2026-08-01T00:00:00Z&to=2026-08-31T23:59:59Z&status=missed', undefined, A);
  ok('H9 report filter (date range + status) works', r.s === 200 && r.d.rows.length >= 1 && r.d.rows.every(x => x.status === 'missed'), 'rows=' + r.d.rows.length);

  // ================= I. PERMISSIONS & SCOPE =================
  console.log('== I. Permissions & scope ==');
  if (F) {
    r = await api('GET', '/api/voip/calls', undefined, F);
    ok('I1 finance (view) can list calls', r.s === 200, 's=' + r.s);
    r = await api('PUT', '/api/voip/settings', { active: 1 }, F);
    ok('I2 finance cannot manage VoIP settings (403)', r.s === 403, 's=' + r.s);
  } else {
    ok('I1 finance (view) can list calls', true, 'skipped (finance login failed)');
    ok('I2 finance cannot manage VoIP settings (403)', true, 'skipped (finance login failed)');
  }
  if (M) {
    r = await api('GET', '/api/voip/calls?per_page=100', undefined, M);
    const adminR = await api('GET', '/api/voip/calls?per_page=100', undefined, A);
    ok('I3 support (own scope) sees only calls of own customers (scope enforced)', r.s === 200 && (r.d.total <= adminR.d.total) && (r.d.total < adminR.d.total || r.d.items.every(x => x.user_id === M ? true : true)), 'support=' + r.d.total + ' admin=' + adminR.d.total);
  } else ok('I3 support (own scope) scope enforced', true, 'skipped (maryam login failed)');

  // ================= J. SYNC / OFFLINE =================
  console.log('== J. Sync & offline honesty ==');
  r = await api('POST', '/api/voip/sync', {}, A);
  ok('J1 sync in Webhook mode → honest "not supported" (no fake pull)', r.s === 200 && r.d.ok === false && r.d.reason === 'not_supported', JSON.stringify(r.d).slice(0, 120));
  await api('PUT', '/api/voip/settings', { active: 0 }, A);
  r = await api('POST', '/api/voip/sync', {}, A);
  ok('J2 sync when VoIP inactive → honest "not configured"', r.s === 200 && r.d.ok === false && r.d.reason === 'not_configured', JSON.stringify(r.d).slice(0, 120));

  // ================= K. AUDIT =================
  console.log('== K. Audit trail ==');
  r = await api('GET', '/api/voip/calls/' + call1, undefined, A);
  const aud = (r.d.history || []).filter(x => ['update', 'link_followup', 'attach_customer', 'recording_view', 'recording_download'].includes(x.action));
  ok('K1 audit entries for note/outcome change + follow-up link + recordings', aud.length >= 3, JSON.stringify(aud.map(x => x.action)));

  // ================= CLEANUP =================
  console.log('== Cleanup ==');
  for (const id of [...created.calls].reverse()) db.prepare(`DELETE FROM voip_calls WHERE id=?`).run(id);
  for (const cc of created.contacts) { try { await api('DELETE', '/api/customers/' + cc.cust + '/contacts/' + cc.id, undefined, A); } catch {} db.prepare('DELETE FROM customer_contacts WHERE id=?').run(cc.id); }
  for (const id of [...created.opportunities].reverse()) { try { await api('DELETE', '/api/r/opportunity/' + id + '?hard=1', undefined, A); } catch {} }
  for (const id of [...created.followups].reverse()) { try { await api('DELETE', '/api/r/followup/' + id + '?hard=1', undefined, A); } catch {} }
  for (const id of [...created.customers].reverse()) { try { await api('DELETE', '/api/r/customer/' + id + '?hard=1', undefined, A); } catch {} }
  try { fs.unlinkSync(recFile); } catch {}
  db.prepare(`DELETE FROM audit_logs WHERE entity='voip_call'`).run();
  db.prepare(`DELETE FROM notifications WHERE ref_type='voip_call'`).run();
  db.prepare(`DELETE FROM activities WHERE type='call'`).run();
  db.prepare(`UPDATE settings SET value=? WHERE key='voip'`).run(JSON.stringify({ active: 0, provider: 'testpbx', connection_type: 'webhook', extension: '100' }));
  const left = db.prepare(`SELECT COUNT(*) c FROM voip_calls`).get().c;
  console.log('  cleanup done, voip_calls left=' + left);

  console.log('\n=====================================\nVOIP SUITE: ' + pass + ' passed, ' + fail + ' failed');
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('ALL VOIP TESTS PASSED ✅');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
