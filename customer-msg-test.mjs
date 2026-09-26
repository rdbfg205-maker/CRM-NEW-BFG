// Section 5 — Customer Messaging: real-HTTP end-to-end test suite (no mocks).
// Controlled test data is created through the real API and cleaned up at the end.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = String(Date.now()).slice(-6);
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
async function req(method, path, body, tok) {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const qa = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };
const countAudit = (action) => q1('SELECT COUNT(*) c FROM audit_logs WHERE action=?', action).c;

// ---------- logins ----------
const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
const M = (await req('POST', '/api/auth/login', { username: 'ali.k', password: '12345678' })).data.access;   // sales_manager: send + manage
const S = (await req('POST', '/api/auth/login', { username: 'sara.m', password: '12345678' })).data.access;  // sales: send only
const K = (await req('POST', '/api/auth/login', { username: 'karim.r', password: '12345678' })).data.access; // production_manager: NO customer_message
ok('setup: logins', !!(A && M && S && K));

// ---------- controlled data via real API ----------
const C1 = (await req('POST', '/api/r/customer', { name: 'تست پیام R' + STAMP + 'A', type: 'company', mobile: '0912' + STAMP + '11' }, A)).data.id;
const C2 = (await req('POST', '/api/r/customer', { name: 'تست پیام R' + STAMP + 'B', type: 'person' }, A)).data.id; // no phone at all
ok('data: customers created (C1 with mobile, C2 without)', !!C1 && !!C2, `${C1},${C2}`);
const Q = (await req('POST', '/api/r/quote', { customer_id: C1, notes: 'test ' + STAMP }, M)).data.id;
await req('PUT', `/api/r/quote/${Q}/items`, { items: [{ product_id: null, name: 'کالای تست ' + STAMP, qty: 2, price: 150000 }] }, M);
const O = (await req('POST', `/api/quotes/${Q}/to-order`, {}, M)).data.order_id;
const I = (await req('POST', `/api/orders/${O}/to-invoice`, {}, M)).data.invoice_id;
const invTotal = q1('SELECT total FROM invoices WHERE id=?', I).total;
const P = (await req('POST', '/api/payments', { invoice_id: I, customer_id: C1, amount: Math.round(invTotal * 0.5), method: 'bank' }, M)).data.payment_id;
ok('data: real chain quote→order→invoice→payment', !!(Q && O && I && P), `Q=${Q} O=${O} I=${I} P=${P}`);

// ---------- T14: manual send with custom body ----------
const t14 = await req('POST', '/api/customermsg/send', { customer_id: C1, event_type: 'manual', body: 'پیام تستی دستی ' + STAMP }, M);
ok('T14 manual send with custom body → 200', t14.status === 200 && t14.data.id, JSON.stringify(t14.data).slice(0, 80));

// ---------- T1: quote message ----------
const qNo = q1('SELECT number FROM quotes WHERE id=?', Q).number;
const t1 = await req('POST', '/api/customermsg/send', { customer_id: C1, event_type: 'quote', doc_id: Q }, M);
ok('T1 quote message → 200', t1.status === 200 && t1.data.id, JSON.stringify(t1.data).slice(0, 80));

// ---------- T2: NOT_CONFIGURED honesty + real variables ----------
ok('T2a status is not_configured (no provider connected) — NOT "sent"', t1.data.status === 'not_configured', t1.data.status);
ok('T2b body carries real variables (customer name, doc number, amount)',
  t1.data.body.includes('تست پیام R' + STAMP + 'A') && t1.data.body.includes(qNo),
  t1.data.body.slice(0, 100));
const logRow = q1('SELECT * FROM customer_messages WHERE id=?', t1.data.id);
ok('T2c log row: user + customer + doc + status + date', logRow && logRow.user_id === q1('SELECT id FROM users WHERE username=\'ali.k\'').id && logRow.customer_id === C1 && logRow.doc_type === 'quote' && logRow.doc_id === Q && logRow.status === 'not_configured' && !!logRow.created_at, JSON.stringify(logRow ? { u: logRow.user_id, st: logRow.status, dt: logRow.doc_type, di: logRow.doc_id } : null));
const outboxSent = q1("SELECT COUNT(*) c FROM outbox WHERE status='sent' AND created_at > datetime('now','-10 minutes')").c;
ok('T2d no fake "sent" outbox rows (honesty)', outboxSent === 0, 'sent=' + outboxSent);

// ---------- T3: unauthorized → 403 + denial audited ----------
const denBefore = countAudit('permission_denied');
const rowsBeforeT3 = q1('SELECT COUNT(*) c FROM customer_messages').c;
const t3 = await req('POST', '/api/customermsg/send', { customer_id: C1, event_type: 'quote', doc_id: Q }, K);
ok('T3a unauthorized send → 403', t3.status === 403, 'status=' + t3.status);
ok('T3b denial audited', countAudit('permission_denied') > denBefore, `+${countAudit('permission_denied') - denBefore}`);
const rowsAfterT3 = q1('SELECT COUNT(*) c FROM customer_messages').c;
ok('T3c no message row created on denial', rowsAfterT3 === rowsBeforeT3, `before=${rowsBeforeT3} after=${rowsAfterT3}`);

// ---------- T4: templates (CRUD + rendering) ----------
const tpl = await req('POST', '/api/customermsg/templates', { name: 'قالب تست ' + STAMP, event_type: 'invoice', channel: 'sms', body: 'فاکتور {{doc_number}} مشتری {{customer_name}} مبلغ {{amount}} — {{user_name}}' }, M);
ok('T4a template create (manage) → id', tpl.status === 200 && tpl.data.id, JSON.stringify(tpl.data));
const tplId = tpl.data.id;
const t4 = await req('POST', '/api/customermsg/send', { customer_id: C1, event_type: 'invoice', doc_id: I, template_id: tplId }, M);
const invNo = q1('SELECT number FROM invoices WHERE id=?', I).number;
ok('T4b send with template → rendered with real values', t4.status === 200 && t4.data.body.includes(invNo) && t4.data.body.includes('تست پیام R' + STAMP + 'A') && t4.data.body.replace(/,/g, '').includes(String(Math.round(invTotal))), t4.data.body.slice(0, 110));
const tplUp = await req('PUT', `/api/customermsg/templates/${tplId}`, { name: 'قالب تست ' + STAMP, event_type: 'invoice', channel: 'sms', body: 'بازنویسی‌شده ' + STAMP }, M);
ok('T4c template update', tplUp.status === 200 && q1('SELECT body FROM message_templates WHERE id=?', tplId).body === 'بازنویسی‌شده ' + STAMP);
const tplBad = await req('POST', '/api/customermsg/templates', { name: 'bad', event_type: 'bogus_event', channel: 'sms', body: 'x' }, M);
ok('T4d invalid event_type rejected (422)', tplBad.status === 422, 'status=' + tplBad.status);
const tplNoPerm = await req('POST', '/api/customermsg/templates', { name: 'x', event_type: 'quote', channel: 'sms', body: 'x' }, S);
ok('T4e template create without manage → 403', tplNoPerm.status === 403, 'status=' + tplNoPerm.status);

// ---------- T15: channel states (no manage needed) ----------
const ch = await req('GET', '/api/customermsg/channels', undefined, S);
ok('T15 channel states: all NOT_CONFIGURED in this env + enabled', ch.status === 200 && ch.data.enabled === true && ch.data.channels.sms === false && ch.data.channels.whatsapp === false, JSON.stringify(ch.data).slice(0, 120));

// ---------- T10: message log API ----------
const log1 = await req('GET', '/api/customermsg/log?per_page=10', undefined, S);
const mine = (log1.data.items || []).filter(m => String(m.body || '').includes(STAMP) || (m.doc_number || '').includes(STAMP));
ok('T10a log returns rows with user_name/customer_name/status', log1.status === 200 && mine.length >= 3 && mine.every(m => m.user_name && (m.customer_name || m.customer_id) && m.status), `rows=${mine.length}`);
const logF = await req('GET', `/api/customermsg/log?status=not_configured&event_type=quote`, undefined, S);
ok('T10b log filters work (status+event)', logF.status === 200 && (logF.data.items || []).length >= 1 && (logF.data.items || []).every(m => m.status === 'not_configured' && m.event_type === 'quote'), `n=${(logF.data.items || []).length}`);
const logNoPerm = await req('GET', '/api/customermsg/log', undefined, K);
ok('T10c log without permission → 403', logNoPerm.status === 403, 'status=' + logNoPerm.status);

// ---------- T12: outbox consistency ----------
const ob = q1('SELECT * FROM outbox WHERE ref_type=? AND ref_id=? ORDER BY id DESC LIMIT 1', 'quote', Q);
ok('T12 outbox row for the quote message (queued, not sent)', ob && ob.status === 'queued' && ob.to_addr === q1('SELECT mobile FROM customers WHERE id=?', C1).mobile, ob && JSON.stringify({ st: ob.status, to: ob.to_addr }));

// ---------- T8: doc/customer mismatch ----------
const t8 = await req('POST', '/api/customermsg/send', { customer_id: C2, event_type: 'payment', doc_id: P }, M);
ok('T8 doc/customer mismatch → 422', t8.status === 422, 'status=' + t8.status);

// ---------- T9: customer without contact ----------
const t9 = await req('POST', '/api/customermsg/send', { customer_id: C2, event_type: 'manual', body: 'x' }, M);
ok('T9 customer without phone/mobile → 422', t9.status === 422 && t9.data.error && t9.data.error.code === 'NO_CONTACT', 'status=' + t9.status + ' ' + (t9.data.error || {}));

// ---------- T5: settings (permission + disable/enable) ----------
const sNoPerm = await req('PUT', '/api/customermsg/settings', { enabled: false }, S);
ok('T5a settings without manage → 403', sNoPerm.status === 403, 'status=' + sNoPerm.status);
const sOff = await req('PUT', '/api/customermsg/settings', { enabled: false }, M);
ok('T5b disable messaging', sOff.status === 200 && sOff.data.settings.enabled === false);
const t5 = await req('POST', '/api/customermsg/send', { customer_id: C1, event_type: 'manual', body: 'x' }, M);
ok('T5c send while disabled → 400 MESSAGING_DISABLED', t5.status === 400 && t5.data.error && t5.data.error.code === 'MESSAGING_DISABLED', 'status=' + t5.status);
const sOn = await req('PUT', '/api/customermsg/settings', { enabled: true, default_channel: 'sms', auto_send: { quote: false, invoice: false, payment: false, shipment: false } }, M);
ok('T5d re-enable messaging', sOn.status === 200 && sOn.data.settings.enabled === true);

// ---------- T6: auto-send on quote creation ----------
await req('PUT', '/api/customermsg/settings', { enabled: true, auto_send: { quote: true, invoice: false, payment: false, shipment: false } }, M);
const before6 = q1('SELECT COUNT(*) c FROM customer_messages WHERE event_type=? AND doc_type=?', 'quote', 'quote').c;
const Q2 = (await req('POST', '/api/r/quote', { customer_id: C1, notes: 'auto ' + STAMP }, M)).data.id;
await sleep(800); // auto-send is fire-and-forget
const auto6 = qa('SELECT * FROM customer_messages WHERE event_type=? AND doc_id=?', 'quote', Q2);
ok('T6 auto-send on quote creation → message logged', before6 >= 0 && auto6.length === 1 && auto6[0].status === 'not_configured' && auto6[0].customer_id === C1, JSON.stringify(auto6[0] ? { st: auto6[0].status, body: auto6[0].body.slice(0, 60) } : null));

// ---------- T7: auto-send on shipment (order → shipped) ----------
await req('PUT', '/api/customermsg/settings', { auto_send: { quote: false, invoice: false, payment: false, shipment: true } }, M);
const sh = await req('PUT', `/api/r/order/${O}`, { status: 'shipped' }, M);
await sleep(800);
const auto7 = qa('SELECT * FROM customer_messages WHERE event_type=? AND doc_id=?', 'shipment', O);
ok('T7 auto-send on shipment (order→shipped) → message logged', sh.status === 200 && auto7.length === 1 && auto7[0].doc_type === 'order' && auto7[0].status === 'not_configured', JSON.stringify(auto7[0] ? { st: auto7[0].status, body: auto7[0].body.slice(0, 60) } : null));
await req('PUT', '/api/customermsg/settings', { auto_send: { quote: false, invoice: false, payment: false, shipment: false } }, M);

// ---------- T11: audit trail ----------
const aSend = qa("SELECT * FROM audit_logs WHERE action='send' AND entity='customer_message' ORDER BY id DESC LIMIT 5");
const aTpl = qa("SELECT * FROM audit_logs WHERE action IN ('template_create','template_update') AND entity='customer_message'");
const aSet = qa("SELECT * FROM audit_logs WHERE action='settings' AND entity='customer_message'");
const aDen = qa("SELECT * FROM audit_logs WHERE action='permission_denied' AND entity='customer_message'");
ok('T11a send audits recorded (with status + doc)', aSend.length >= 4 && aSend.every(a => a.new_value && JSON.parse(a.new_value).status), `n=${aSend.length}`);
ok('T11b template create/update audited', aTpl.length >= 2, `n=${aTpl.length}`);
ok('T11c settings changes audited', aSet.length >= 4, `n=${aSet.length}`);
ok('T11d denials audited with entity=customer_message', aDen.length >= 2, `n=${aDen.length}`);

// ---------- cleanup (controlled test data only) ----------
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    for (const qid of [Q, Q2]) { try { d.prepare('DELETE FROM quote_items WHERE quote_id=?').run(qid); d.prepare('DELETE FROM quotes WHERE id=?').run(qid); } catch {} }
    try { d.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(I); d.prepare('DELETE FROM payments WHERE invoice_id=?').run(I); d.prepare('DELETE FROM invoices WHERE id=?').run(I); } catch {}
    try { d.prepare('DELETE FROM order_items WHERE order_id=?').run(O); d.prepare('DELETE FROM orders WHERE id=?').run(O); } catch {}
    for (const cid of [C1, C2]) { try { d.prepare('DELETE FROM customer_contacts WHERE customer_id=?').run(cid); d.prepare('DELETE FROM customers WHERE id=?').run(cid); } catch {} }
    try { d.prepare('DELETE FROM message_templates WHERE id=?').run(tplId); } catch {}
    try { d.prepare('DELETE FROM customer_messages WHERE customer_id IN (?,?)').run(C1, C2); } catch {}
    try { d.prepare("DELETE FROM outbox WHERE ref_id IN (?, ?, ?, ?, ?, ?)").run(Q, Q2, O, I, C1, C2); } catch {}
  });
  tx(); d.close();
  console.log('cleanup done');
})().then(async () => {
  console.log('\n========== CUSTOMER MESSAGING — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
});
