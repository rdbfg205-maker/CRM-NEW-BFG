'use strict';
// FINAL CHECK — full-module smoke test for Baspar CRM
const base = process.env.BASE || 'http://localhost:3050';
const db = require('/home/user/baspar-crm/node_modules/better-sqlite3')('/home/user/baspar-crm/data/baspar-crm.sqlite');
const { R, OPT } = require('/home/user/baspar-crm/server/api/resources');
const STAMP = Date.now().toString().slice(-6);
let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
async function req(method, path, body, tok, _retries = 0) {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 429 && _retries < 10) {
    await new Promise(res => setTimeout(res, 2000 + _retries * 2000));
    return req(method, path, body, tok, _retries + 1);
  }
  let data = null;
  const txt = await r.text();
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}
function firstId(table) { try { return db.prepare(`SELECT id FROM ${table} ORDER BY id LIMIT 1`).get().id; } catch { return 1; } }
// Build a create payload from the registry field definitions
function makePayload(r, entity) {
  const p = {};
  for (const f of (r.fields || [])) {
    if (f.readonly || f.key === 'number' || f.key === 'stock_qty' || f.key === 'paid_amount' || f.key === 'score' || f.key === 'churn_score' || f.key === 'custom_fields') continue;
    switch (f.type) {
      case 'text': p[f.key] = f.key === 'email' ? `t${STAMP}@test.ir` : (f.key === 'phone' || f.key === 'mobile' ? '0912' + STAMP : (f.key === 'name' || f.key === 'company' || f.key === 'title' ? `تست ${STAMP}` : `ت${STAMP}`)); break;
      case 'textarea': p[f.key] = 'توضیح تست ' + STAMP; break;
      case 'number': p[f.key] = 1; break;
      case 'money': p[f.key] = 1000; break;
      case 'select': { const opts = typeof f.options === 'string' ? (OPT[f.options] || []) : (f.options || []); p[f.key] = f.default !== undefined ? f.default : (opts[0] ? opts[0].v : ''); break; }
      case 'ref': p[f.key] = firstId(f.ref); break;
      case 'bool': p[f.key] = 1; break;
      case 'date': p[f.key] = new Date().toISOString().slice(0, 10); break;
      case 'datetime': p[f.key] = new Date().toISOString(); break;
      case 'json': p[f.key] = '{}'; break;
      case 'email': p[f.key] = `t${STAMP}@test.ir`; break;
      default: p[f.key] = 'ت' + STAMP;
    }
  }
  return p;
}

(async () => {
  console.log('== 1. health & auth ==');
  let r = await req('GET', '/api/health');
  ok('GET /api/health', r.status === 200, JSON.stringify(r.data));
  r = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const TOK = r.data && (r.data.access || r.data.token);
  ok('login admin', r.status === 200 && !!TOK, JSON.stringify(r.data).slice(0, 120));
  r = await req('GET', '/api/me', undefined, TOK);
  ok('GET /api/me', r.status === 200 && r.data.user.username === 'admin', r.status);

  console.log('== 2. meta / dashboard / notifications / calendar / search ==');
  r = await req('GET', '/api/meta/options', undefined, TOK);
  ok('GET /api/meta/options', r.status === 200 && r.data.options && r.data.resources, r.status);
  r = await req('GET', '/api/dashboard', undefined, TOK);
  ok('GET /api/dashboard', r.status === 200 && r.data.kpi, JSON.stringify(r.data).slice(0, 100));
  r = await req('GET', '/api/notifications', undefined, TOK);
  ok('GET /api/notifications', r.status === 200 && Array.isArray(r.data.items), r.status);
  r = await req('GET', '/api/calendar', undefined, TOK);
  ok('GET /api/calendar', r.status === 200, r.status);
  r = await req('GET', '/api/search?q=تشک', undefined, TOK);
  ok('GET /api/search', r.status === 200, r.status);
  r = await req('PUT', '/api/settings', { theme: 'light' }, TOK);
  ok('PUT /api/settings (user pref)', r.status === 200, r.status);
  r = await req('GET', '/api/outbox', undefined, TOK);
  ok('GET /api/outbox', r.status === 200, r.status);

  console.log('== 3. every resource: list + schema ==');
  const keys = Object.keys(R);
  let listOk = 0;
  for (const k of keys) {
    r = await req('GET', `/api/r/${k}?per_page=1`, undefined, TOK);
    if (r.status === 200 && Array.isArray(r.data.items)) listOk++;
    else ok(`GET /api/r/${k}`, false, `status ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  }
  ok(`all ${keys.length} resource lists return 200+items`, listOk === keys.length, `${listOk}/${keys.length}`);
  r = await req('GET', '/api/r/user?per_page=1', undefined, TOK);
  ok('GET /api/r/user (users)', r.status === 200 && Array.isArray(r.data.items), r.status);

  console.log('== 4. CRUD cycle on every resource (create→show→update→dup→archive→delete) ==');
  const createdForCleanup = [];
  for (const k of keys) {
    const rreg = R[k];
    if (rreg.readonly || !rreg.table) continue;
    const payload = makePayload(rreg, k);
    // entity-specific required fields
    if (k === 'customer') { payload.name = `مشتری تست ${STAMP}`; payload.type = 'company'; }
    if (k === 'lead') { payload.company = `شرکت تست ${STAMP}`; payload.contact_name = `تماس تست ${STAMP}`; }
    if (k === 'opportunity') { payload.title = `فرصت تست ${STAMP}`; }
    if (k === 'ticket') { payload.subject = `تیکت تست ${STAMP}`; }
    if (k === 'complaint') { payload.subject = `شکایت تست ${STAMP}`; payload.priority = 'medium'; }
    if (k === 'meeting') { payload.title = `جلسه تست ${STAMP}`; payload.start_at = new Date(Date.now() + 3600e3).toISOString(); }
    if (k === 'task') { payload.title = `وظیفه تست ${STAMP}`; payload.status = 'open'; }
    if (k === 'document') { payload.title = `سند تست ${STAMP}`; }
    if (k === 'contract') { payload.title = `قرارداد تست ${STAMP}`; }
    if (k === 'campaign') { payload.name = `کمپین تست ${STAMP}`; payload.message = 'متن تست'; }
    if (k === 'warranty') { payload.serial = `SN${STAMP}`; }
    if (k === 'supplier') { payload.name = `تامین‌کننده تست ${STAMP}`; }
    if (k === 'purchase_order') { payload.note = 'تست'; }
    if (k === 'pipeline') { payload.name = `Pipeline تست ${STAMP}`; }
    if (k === 'pipeline_stages') { payload.name = `مرحله تست ${STAMP}`; }
    if (k === 'price_list') { payload.name = `لیست قیمت تست ${STAMP}`; }
    if (k === 'loyalty_tier') { payload.name = `سطح تست ${STAMP}`; }
    if (k === 'report_definition') { payload.name = `گزارش تست ${STAMP}`; }
    if (k === 'workflow_rule') { const evs = OPT.workflowEvents || []; payload.name = `قانون تست ${STAMP}`; payload.event = evs[0] ? evs[0].v : evs[0]; payload.active = 0; }
    if (k === 'tag') { payload.name = `تگ تست ${STAMP}`; }
    if (k === 'customer_categories') { payload.name = `دسته تست ${STAMP}`; }
    if (k === 'product_categories') { payload.name = `دسته محصول تست ${STAMP}`; }
    if (k === 'product') { payload.name = `محصول تست ${STAMP}`; payload.code = `T${STAMP}`; }
    if (k === 'quote') { payload.title = `پیش‌فاکتور تست ${STAMP}`; }
    if (k === 'order') { payload.title = `سفارش تست ${STAMP}`; }
    if (k === 'invoice') { payload.title = `فاکتور تست ${STAMP}`; }
    if (k === 'payment') {
      // must be a consistent customer/invoice pair (reconciliation guard)
      payload.amount = 1;
      const inv0 = db.prepare(`SELECT id, customer_id FROM invoices WHERE status IN ('unpaid','partial','overdue') AND total-paid_amount>0 LIMIT 1`).get();
      if (inv0) { payload.invoice_id = inv0.id; payload.customer_id = inv0.customer_id; }
      else { delete payload.invoice_id; } // customer-only payment (allowed)
    }
    if (k === 'stock_transaction') { payload.qty = 1; }
    if (k === 'lab_request') { payload.number = `LR${STAMP}`; }
    if (k === 'lab_result') { payload.request_id = firstId('lab_requests'); }
    let cr = await req('POST', `/api/r/${k}`, payload, TOK);
    const id = cr.data && (cr.data.id || (cr.data.item && cr.data.item.id));
    if (!(cr.status === 200 || cr.status === 201) || !id) {
      ok(`CRUD ${k}`, false, `create failed ${cr.status} ${JSON.stringify(cr.data).slice(0, 160)}`);
      continue;
    }
    createdForCleanup.push({ k, id });
    let allGood = true; let why = '';
    // show
    r = await req('GET', `/api/r/${k}/${id}`, undefined, TOK);
    if (r.status !== 200) { allGood = false; why = 'show ' + r.status; }
    // update (change a safe field)
    const updField = (rreg.fields || []).find(f => !f.readonly && ['text', 'textarea', 'number'].includes(f.type) && !f.required && f.key !== 'name');
    if (updField) {
      const updVal = updField.type === 'number' ? 2 : 'ویرایش تست ' + STAMP;
      r = await req('PUT', `/api/r/${k}/${id}`, { [updField.key]: updVal }, TOK);
      if (r.status !== 200) { allGood = false; why = why + ' update ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 80); }
    }
    // duplicate
    r = await req('POST', `/api/r/${k}/${id}/duplicate`, {}, TOK);
    const dupId = r.data && r.data.id;
    if (r.status !== 200 || !dupId) { allGood = false; why = why + ' dup ' + r.status; }
    else if (dupId !== id) {
      if (k === 'payment') db.prepare('DELETE FROM payments WHERE id=?').run(dupId); // guarded table: clean test artifact directly
      else await req('DELETE', `/api/r/${k}/${dupId}?hard=1`, undefined, TOK);
    }
    // archive toggle (only tables with an archived_at column support it; others must return a clean 400)
    r = await req('POST', `/api/r/${k}/${id}/archive`, {}, TOK);
    const archivable = db.prepare(`PRAGMA table_info(${rreg.table})`).all().some(c => c.name === 'archived_at');
    if (archivable ? r.status !== 200 : r.status !== 400) { allGood = false; why = why + ' archive ' + r.status; }
    if (k === 'payment' && payload.invoice_id) {
      // financial integrity: a payment linked to an invoice must be refunded, not deleted
      r = await req('DELETE', `/api/r/${k}/${id}?hard=1`, undefined, TOK);
      if (r.status !== 409) { allGood = false; why = why + ' delete-guard ' + r.status; }
      db.prepare('DELETE FROM payments WHERE id=?').run(id); // test artifact cleanup (not a user action)
      ok(`CRUD ${k}`, allGood, why || `id=${id} (delete correctly guarded 409)`);
      continue;
    }
    // hard delete
    r = await req('DELETE', `/api/r/${k}/${id}?hard=1`, undefined, TOK);
    if (r.status !== 200) { allGood = false; why = why + ' delete ' + r.status; }
    else { const gone = db.prepare(`SELECT COUNT(*) c FROM ${rreg.table} WHERE id=?`).get(id).c === 0; if (!gone) { allGood = false; why = why + ' not-hard-deleted'; } }
    ok(`CRUD ${k}`, allGood, why || `id=${id}`);
  }
  // cleanup side effects from complaint/lead creates
  db.prepare(`DELETE FROM followups WHERE subject LIKE 'پیگیری خودکار%' AND due_at > datetime('now','-10 minutes')`).run();
  const stuck = db.prepare(`SELECT id FROM wf_instances WHERE status='running'`).all();
  for (const s of stuck) db.prepare(`UPDATE wf_instances SET status='terminated', completed_at=? WHERE id=?`).run(new Date().toISOString(), s.id);
  db.prepare(`DELETE FROM wf_steps WHERE instance_id IN (SELECT id FROM wf_instances WHERE status='terminated' AND started_at > datetime('now','-10 minutes'))`).run();
  db.prepare(`DELETE FROM wf_instances WHERE started_at > datetime('now','-10 minutes')`).run();
  db.prepare(`DELETE FROM notifications WHERE ref_type IN ('complaint','lead') AND created_at > datetime('now','-10 minutes')`).run();
  console.log('  (side-effect cleanup done)');

  console.log('== 5. sales pipeline: quote → order → invoice → payment ==');
  const custId = firstId('customers');
  const prodId = firstId('products');
  r = await req('POST', '/api/r/quote', { customer_id: custId, title: `QT تست ${STAMP}`, notes: 'تست لوله فروش' }, TOK);
  const qid = r.data.id; ok('create quote', !!qid, JSON.stringify(r.data).slice(0, 100));
  r = await req('PUT', `/api/r/quote/${qid}/items`, { items: [{ product_id: prodId, name: 'اقلام', qty: 2, price: 5000, discount_pct: 0, override_reason: 'قیمت تست زنجیره (سوت رجیسیون)' }] }, TOK);
  ok('quote items + recalc', r.status === 200, JSON.stringify(r.data).slice(0, 120));
  r = await req('GET', `/api/r/quote/${qid}`, undefined, TOK);
  const qTotal = r.data.item && (r.data.item.total || r.data.item.subtotal);
  ok('quote total recalculated (2x5000=10000)', Number(qTotal) === 10000, 'total=' + qTotal);
  r = await req('POST', `/api/quotes/${qid}/to-order`, {}, TOK);
  const oid = r.data && (r.data.order_id || r.data.id);
  ok('quote→order convert', r.status === 200 && !!oid, JSON.stringify(r.data).slice(0, 120));
  r = await req('GET', `/api/r/order/${oid}`, undefined, TOK);
  const oTotal = r.data.item && r.data.item.total;
  ok('order has lines+total', r.status === 200 && Number(oTotal) === 10000, 'total=' + oTotal);
  r = await req('POST', `/api/orders/${oid}/to-invoice`, {}, TOK);
  const iid = r.data && (r.data.invoice_id || r.data.id);
  ok('order→invoice convert', r.status === 200 && !!iid, JSON.stringify(r.data).slice(0, 120));
  // invoice applies the system tax_rate (seeded 9%): subtotal=order total, total=subtotal+tax
  r = await req('GET', `/api/r/invoice/${iid}`, undefined, TOK);
  const inv = r.data.item || {};
  const iSub = Number(inv.subtotal), iTax = Number(inv.tax || 0), iTotal = Number(inv.total);
  ok('invoice subtotal = order total, total = subtotal + tax', r.status === 200 && iSub === 10000 && iTotal === Math.round(iSub + iTax), `subtotal=${iSub} tax=${iTax} total=${iTotal}`);
  r = await req('POST', '/api/payments', { invoice_id: iid, customer_id: custId, amount: iTotal, method: 'bank', paid_at: new Date().toISOString().slice(0, 10), reference: 'REF' + STAMP }, TOK);
  const payId = r.data && (r.data.id || r.data.payment_id);
  ok('create payment (with reconciliation)', r.status === 200 && !!payId, JSON.stringify(r.data).slice(0, 100));
  r = await req('GET', `/api/r/invoice/${iid}`, undefined, TOK);
  const paid = r.data.item && Number(r.data.item.paid_amount);
  ok('invoice paid_amount updated, status paid', r.data.item && paid === iTotal && r.data.item.status === 'paid', 'paid=' + paid + ' status=' + (r.data.item && r.data.item.status));
  r = await req('GET', `/api/print/invoice/${iid}`, undefined, TOK);
  ok('print invoice HTML', r.status === 200 && String(r.data).includes('<'), r.status);
  // cleanup sales test
  if (payId) db.prepare('DELETE FROM payments WHERE id=?').run(payId);
  db.prepare('UPDATE invoices SET paid_amount=0 WHERE id=?').run(iid);
  db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(iid);
  db.prepare('DELETE FROM order_items WHERE order_id=?').run(oid);
  db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(qid);
  db.prepare('DELETE FROM invoices WHERE id=?').run(iid);
  db.prepare('DELETE FROM orders WHERE id=?').run(oid);
  db.prepare('DELETE FROM quotes WHERE id=?').run(qid);
  db.prepare(`DELETE FROM payments WHERE id=?`).run(payId || 0);
  db.prepare(`DELETE FROM activities WHERE entity_type IN ('quote','order','invoice','payment') AND entity_id IN (?,?,?,?) AND created_at > datetime('now','-10 minutes')`).run(qid, oid, iid, payId || 0);
  db.prepare(`DELETE FROM audit_logs WHERE entity IN ('quote','order','invoice','payment') AND at > datetime('now','-10 minutes')`).run();
  console.log('  (sales test cleanup done)');

  console.log('== 6. lead conversion ==');
  r = await req('POST', '/api/r/lead', { company: `لید تبدیل ${STAMP}`, contact_name: 'تماس', status: 'new' }, TOK);
  const lid = r.data && r.data.id;
  ok('create lead', !!lid, JSON.stringify(r.data).slice(0, 100));
  r = await req('POST', `/api/leads/${lid}/convert`, { create_opportunity: 1 }, TOK);
  ok('convert lead', r.status === 200, JSON.stringify(r.data).slice(0, 150));
  const convIds = (r.data && [r.data.customer_id, r.data.opportunity_id].filter(Boolean)) || [];
  if (lid) db.prepare('DELETE FROM leads WHERE id=?').run(lid);
  for (const cid of convIds) {
    try { db.prepare('DELETE FROM opportunities WHERE id=?').run(cid); } catch {}
    try { db.prepare('DELETE FROM customers WHERE id=? AND name LIKE ?').run(cid, 'لید تبدیل%'); } catch {}
  }
  db.prepare(`DELETE FROM followups WHERE subject LIKE 'پیگیری خودکار%' AND due_at > datetime('now','-10 minutes')`).run();

  console.log('== 7. AI modules ==');
  r = await req('GET', '/api/ai/config', undefined, TOK); ok('GET /api/ai/config', r.status === 200, r.status);
  r = await req('GET', '/api/ai/conversations', undefined, TOK); ok('GET /api/ai/conversations', r.status === 200, r.status);
  r = await req('GET', '/api/ai/kb', undefined, TOK); ok('GET /api/ai/kb', r.status === 200, r.status);
  r = await req('GET', '/api/ai/summary', undefined, TOK); ok('GET /api/ai/summary', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/ai/forecast', undefined, TOK); ok('GET /api/ai/forecast', r.status === 200, r.status);
  r = await req('GET', '/api/ai/churn', undefined, TOK); ok('GET /api/ai/churn', r.status === 200, r.status);
  r = await req('GET', '/api/ai/leads', undefined, TOK); ok('GET /api/ai/leads', r.status === 200, r.status);
  r = await req('GET', '/api/ai/opportunities', undefined, TOK); ok('GET /api/ai/opportunities', r.status === 200, r.status);
  r = await req('GET', '/api/ai/anomalies', undefined, TOK); ok('GET /api/ai/anomalies', r.status === 200, r.status);
  const cust22 = firstId('customers');
  r = await req('GET', `/api/ai/customer/${cust22}`, undefined, TOK); ok('GET /api/ai/customer/:id', r.status === 200, r.status);
  r = await req('GET', `/api/ai/rag?q=تشک`, undefined, TOK); ok('GET /api/ai/rag', r.status === 200, r.status);
  r = await req('POST', '/api/ai/chat', { query: 'سلام، وضعیت موجودی چطور است؟' }, TOK);
  ok('POST /api/ai/chat (assistant)', r.status === 200 && (r.data.text || r.data.reply), JSON.stringify(r.data).slice(0, 100));
  r = await req('GET', '/api/ai2/modules', undefined, TOK); ok('GET /api/ai2/modules', r.status === 200, r.status);
  r = await req('GET', '/api/ai2/logs?per_page=5', undefined, TOK); ok('GET /api/ai2/logs', r.status === 200, r.status);
  r = await req('GET', '/api/ai2/settings', undefined, TOK); ok('GET /api/ai2/settings', r.status === 200, r.status);
  r = await req('GET', `/api/ai2/module/complaint/${firstId('complaints')}`, undefined, TOK); ok('GET /api/ai2/module/complaint/:id', r.status === 200, r.status);
  r = await req('POST', '/api/ai2/report', { query: 'تعداد شکایات به تفکیک وضعیت' }, TOK); ok('POST /api/ai2/report', r.status === 200 && r.data.text, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/advreports/sources', undefined, TOK); ok('GET /api/advreports/sources', r.status === 200, r.status);
  r = await req('GET', '/api/advreports/templates', undefined, TOK); ok('GET /api/advreports/templates', r.status === 200, r.status);
  r = await req('POST', '/api/advreports/run', { source: 'customers', measure: 'count', group_by: 'status' }, TOK); ok('POST /api/advreports/run', r.status === 200, JSON.stringify(r.data).slice(0, 80));

  console.log('== 8. reports ==');
  r = await req('GET', '/api/reports/sources', undefined, TOK); ok('GET /api/reports/sources', r.status === 200, r.status);
  r = await req('GET', '/api/reports/definitions', undefined, TOK); ok('GET /api/reports/definitions', r.status === 200, r.status);
  r = await req('GET', '/api/reports/instances', undefined, TOK); ok('GET /api/reports/instances', r.status === 200, r.status);
  r = await req('GET', '/api/reports/sources', undefined, TOK);
  const srcObj = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
  const srcName = Object.keys(srcObj).length ? Object.keys(srcObj)[0] : 'sales';
  r = await req('POST', '/api/reports/run', { source: srcName, group_by: 'status', limit: 10 }, TOK);
  ok('POST /api/reports/run (source=' + srcName + ')', r.status === 200 && r.data.rows !== undefined, JSON.stringify(r.data).slice(0, 100));

  console.log('== 9. messenger ==');
  const u2 = db.prepare("SELECT id FROM users WHERE username!='admin' LIMIT 1").get().id;
  r = await req('POST', '/api/messages/conversations', { other_user_id: u2 }, TOK);
  const convId = r.data && (r.data.id || (r.data.conversation && r.data.conversation.id));
  ok('create conversation', r.status === 200 && !!convId, JSON.stringify(r.data).slice(0, 120));
  if (convId) {
    r = await req('POST', `/api/messages/conversations/${convId}`, { body: 'پیام تست', type: 'text' }, TOK);
    ok('send message', r.status === 200, JSON.stringify(r.data).slice(0, 100));
    r = await req('GET', `/api/messages/conversations/${convId}`, undefined, TOK);
    const msgs = r.data.messages || r.data.items;
    ok('get conversation + messages', r.status === 200 && Array.isArray(msgs) && msgs.length >= 1, JSON.stringify(r.data).slice(0, 100));
    r = await req('POST', `/api/messages/conversations/${convId}/read`, {}, TOK);
    ok('mark read', r.status === 200, r.status);
    db.prepare('DELETE FROM messages WHERE conversation_id=?').run(convId);
    db.prepare('DELETE FROM conversations WHERE id=?').run(convId);
  }
  r = await req('GET', '/api/messages/conversations', undefined, TOK); ok('list conversations', r.status === 200, r.status);
  r = await req('GET', `/api/messages/search?q=تست`, undefined, TOK); ok('search messages', r.status === 200, r.status);

  console.log('== 10. sales/commissions/pipeline/campaigns ==');
  r = await req('POST', '/api/commissions/calc', { month: new Date().toISOString().slice(0, 7) }, TOK); ok('POST /api/commissions/calc', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/commissions?per_page=5', undefined, TOK); ok('GET /api/commissions (rules+items)', r.status === 200 && Array.isArray(r.data.rules), r.status);
  const pid = firstId('pipelines');
  r = await req('GET', `/api/pipeline/${pid}/board`, undefined, TOK); ok('GET pipeline board', r.status === 200, r.status);
  const cid = firstId('campaigns');
  r = await req('POST', `/api/campaigns/${cid}/audience`, {}, TOK); ok('POST campaigns audience', r.status === 200, r.status);
  r = await req('POST', '/api/calls', { target_id: u2, kind: 'voice' }, TOK);
  const callId = r.data && r.data.callId;
  ok('POST /api/calls (start WebRTC call)', r.status === 200 && !!callId, JSON.stringify(r.data).slice(0, 80));
  if (callId) {
    r = await req('POST', `/api/calls/${callId}/signal`, { to: u2, candidate: { candidate: 'test' } }, TOK);
    ok('POST /api/calls/:id/signal (ICE candidate)', r.status === 200, r.status);
    r = await req('POST', `/api/calls/${callId}/end`, {}, TOK);
    ok('POST /api/calls/:id/end', r.status === 200, r.status);
  }
  r = await req('GET', '/api/approvals', undefined, TOK); ok('GET /api/approvals', r.status === 200, r.status);

  console.log('== 11. lab / stock / service ==');
  const lrId = firstId('lab_requests');
  const lrOrigStatus = db.prepare('SELECT status FROM lab_requests WHERE id=?').get(lrId).status;
  r = await req('PUT', `/api/r/lab_request/${lrId}`, { status: 'done' }, TOK);
  r = await req('POST', `/api/lab/${lrId}/report`, {}, TOK); ok('POST /api/lab/:id/report', r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 60));
  await req('PUT', `/api/r/lab_request/${lrId}`, { status: lrOrigStatus }, TOK); // restore seed state
  r = await req('GET', '/api/stock/move?product_id=' + prodId, undefined, TOK);
  if (r.status === 404 || r.status === 405) { r = await req('GET', '/api/r/stock_transaction?per_page=5', undefined, TOK); }
  ok('stock movement view', r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/r/stock_alert?per_page=5', undefined, TOK); ok('GET stock alerts', r.status === 200, r.status);
  r = await req('GET', `/api/customers/${custId}/contacts`, undefined, TOK); ok('GET customer contacts', r.status === 200, r.status);
  r = await req('POST', `/api/customers/${custId}/visit`, { subject: `بازدید تست ${STAMP}` }, TOK); ok('POST customer visit', r.status === 200, JSON.stringify(r.data).slice(0, 80));

  console.log('== 12. admin ==');
  r = await req('GET', '/api/admin/users?per_page=5', undefined, TOK); ok('GET admin/users', r.status === 200 && Array.isArray(r.data.items), r.status);
  r = await req('GET', '/api/admin/roles', undefined, TOK); ok('GET admin/roles', r.status === 200, r.status);
  r = await req('GET', '/api/admin/settings', undefined, TOK); ok('GET admin/settings', r.status === 200, r.status);
  r = await req('GET', '/api/admin/audit?per_page=5', undefined, TOK); ok('GET admin/audit', r.status === 200, r.status);
  r = await req('GET', '/api/admin/backups', undefined, TOK); ok('GET admin/backups', r.status === 200, r.status);
  r = await req('GET', '/api/admin/custom-fields/customer', undefined, TOK); ok('GET admin/custom-fields', r.status === 200, r.status);

  console.log('== 13. workflow (visual builder) ==');
  r = await req('GET', '/api/wf/modules', undefined, TOK); ok('wf modules', r.status === 200 && r.data.items.length >= 9, r.status + ' count=' + (r.data.items || []).length); // 14 after Master Audit module extensions
  r = await req('GET', '/api/wf/processes', undefined, TOK); ok('wf processes', r.status === 200, r.status);
  const procId = firstId('wf_processes');
  r = await req('GET', `/api/wf/processes/${procId}`, undefined, TOK); ok('wf process detail', r.status === 200, r.status);
  r = await req('GET', `/api/wf/designer/${procId}`, undefined, TOK); ok('wf designer', r.status === 200, r.status);
  r = await req('GET', '/api/wf/instances', undefined, TOK); ok('wf instances', r.status === 200, r.status);
  r = await req('GET', '/api/wf/score', undefined, TOK); ok('wf score', r.status === 200, r.status);
  r = await req('POST', '/api/wf/ai/process/' + procId, {}, TOK); ok('POST wf/ai/process (AI analyze)', r.status === 200, JSON.stringify(r.data).slice(0, 100));

  console.log('== 14. permission check (non-admin blocked from admin routes) ==');
  r = await req('POST', '/api/auth/login', { username: 'maryam.h', password: '12345678' });
  if (r.status === 200 && r.data.access) {
    const T2 = r.data.access;
    const rr = await req('GET', '/api/admin/users', undefined, T2);
    ok('non-admin blocked from /api/admin/users', rr.status === 403 || rr.status === 401, rr.status);
    const rr2 = await req('POST', '/api/r/customer', { name: 'نباید ساخته شود' }, T2);
    // support has own-scoped create on customer? check it's not 500
    ok('non-admin customer create handled', rr2.status !== 500, rr2.status + ' ' + JSON.stringify(rr2.data).slice(0, 80));
    if (rr2.data && rr2.data.id) db.prepare('DELETE FROM customers WHERE id=?').run(rr2.data.id);
  } else {
    const sup = db.prepare("SELECT id FROM users WHERE username LIKE 'support%' LIMIT 1").get();
    ok('non-admin user exists for perm test', !!sup, 'no support user');
  }

  console.log('');
  console.log('=====================================');
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  else console.log('ALL CHECKS PASSED ✅');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
