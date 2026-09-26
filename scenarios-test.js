'use strict';
// Integration scenarios (Test 1–14 from the final spec) — real end-to-end flows on the live DB
const base = process.env.BASE || 'http://localhost:3050';
const STAMP = Date.now().toString().slice(-6);
let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); } }
async function req(method, path, body, tok, _r = 0) {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 429 && _r < 4) { await new Promise(s => setTimeout(s, 1500 + _r * 1500)); return req(method, path, body, tok, _r + 1); }
  const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}
(async () => {
  const login = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data;
  const T = login.access;
  const created = { customer: null, contact: null, lead: null, convId: null, opp: null, product: null, plist: null, quote: null, order: null, invoice: null, labReq: null, complaint: null, ticket: null, followup: null, meeting: null, doc: null, report: null };

  console.log('— Test 1: Customer CRUD —');
  let r = await req('POST', '/api/r/customer', { name: 'مشتری سناریویی ' + STAMP, type: 'company', phone: '0912' + STAMP, city: 'شهرکرد' }, T);
  created.customer = r.data.id; ok('create customer', r.status === 200 && created.customer, JSON.stringify(r.data).slice(0, 100));
  r = await req('GET', '/api/r/customer/' + created.customer, undefined, T); ok('view customer', r.status === 200 && r.data.item.name.includes(STAMP));
  r = await req('PUT', '/api/r/customer/' + created.customer, { notes: 'یادداشت سناریو' }, T); ok('edit customer', r.status === 200);
  r = await req('GET', '/api/r/customer?per_page=1&q=' + STAMP, undefined, T); ok('search customer', r.status === 200 && r.data.items.some(x => x.id === created.customer));

  console.log('— Test 2: Contact create → open detail —');
  r = await req('POST', `/api/customers/${created.customer}/contacts`, { name: 'مخاطب سناریو', position: 'مدیر', phone: '022' + STAMP, is_primary: 1 }, T);
  created.contact = r.data && (r.data.id || (Array.isArray(r.data.items) ? null : null));
  // the POST returns {ok} — fetch list to get the id
  const cl = await req(`GET`, `/api/customers/${created.customer}/contacts`, undefined, T);
  created.contact = cl.data.items[0].id;
  ok('create contact', r.status === 200 && created.contact, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', `/api/customers/${created.customer}/contacts/${created.contact}`, undefined, T);
  ok('open contact detail (was «رکوردی پیدا نشد»)', r.status === 200 && r.data.item.name === 'مخاطب سناریو', JSON.stringify(r.data).slice(0, 80));
  r = await req('PUT', `/api/customers/${created.customer}/contacts/${created.contact}`, { position: 'مدیر فنی' }, T);
  ok('edit contact', r.status === 200 && r.data.item.position === 'مدیر فنی');

  console.log('— Test 3: Lead → convert to customer —');
  r = await req('POST', '/api/r/lead', { company: 'لید سناریویی ' + STAMP, contact_name: 'تماس سناریو', source: 'website', estimated_value: 50000000 }, T);
  created.lead = r.data.id; ok('create lead', r.status === 200 && created.lead, JSON.stringify(r.data).slice(0, 80));
  r = await req('POST', `/api/leads/${created.lead}/convert`, { create_opportunity: 1 }, T);
  ok('convert lead', r.status === 200, JSON.stringify(r.data).slice(0, 100));
  const convCust = r.data.customer_id;
  if (convCust) created.customer_conv = convCust;

  console.log('— Test 4: Opportunity → move stage in pipeline —');
  const stages = (await req('GET', '/api/r/pipeline_stages?per_page=100', undefined, T)).data.items;
  const pipe1 = stages.filter(s => s.pipeline_id === 1);
  const s0 = pipe1[0], s1 = pipe1[1];
  r = await req('POST', '/api/r/opportunity', { title: 'فرصت سناریویی ' + STAMP, customer_id: created.customer, amount: 100000000, probability: 40, pipeline_id: 1, stage_id: s0.id }, T);
  created.opp = r.data.id; ok('create opportunity', r.status === 200 && created.opp, JSON.stringify(r.data).slice(0, 80));
  r = await req('POST', '/api/pipeline/move', { opportunity_id: created.opp, stage_id: s1.id }, T);
  const oppNow = (await req('GET', '/api/r/opportunity/' + created.opp, undefined, T)).data.item;
  ok('move opportunity to stage 2 (persisted)', r.status === 200 && oppNow.stage_id === s1.id, 'stage_id=' + oppNow.stage_id);

  console.log('— Test 5: Product → use in price list —');
  r = await req('POST', '/api/r/product', { code: 'SCN' + STAMP, name: 'کالای سناریویی ' + STAMP, unit: 'عدد', price_retail: 1000000, price_wholesale: 900000, price_cost: 700000 }, T);
  created.product = r.data.id; ok('create product', r.status === 200 && created.product, JSON.stringify(r.data).slice(0, 80));
  // legacy env had a fixed demo price list id=2 (removed with demo data) — create our own
  r = await req('POST', '/api/r/price_list', { name: 'لیست سناریویی ۵-' + STAMP, currency: 'IRR', active: 1 }, T);
  const pl5 = r.data.id; if (pl5) created.price_lists = (created.price_lists || []).concat(pl5);
  r = await req('POST', `/api/pricelist/${pl5}/item`, { product_id: created.product, price: 850000 }, T);
  ok('set product price in price list (عمده‌فروشان)', r.status === 200, JSON.stringify(r.data).slice(0, 60));
  const pli = (await req('GET', `/api/pricelist/${pl5}/items`, undefined, T)).data.items.find(x => x.product_id === created.product);
  ok('price list item stored in DB', !!pli && pli.price === 850000);

  console.log('— Test 6: Price list → quotation —');
  r = await req('POST', '/api/r/price_list', { name: 'لیست سناریویی ' + STAMP, currency: 'IRR', is_default: 0, active: 1 }, T);
  created.plist = r.data.id; ok('create price list', r.status === 200 && created.plist, JSON.stringify(r.data).slice(0, 80));
  r = await req('POST', '/api/pricelist/' + created.plist + '/items', { items: [{ product_id: created.product, price: 820000 }] }, T);
  ok('add item to new price list', r.status === 200 && r.data.saved === 1);
  r = await req('POST', '/api/r/quote', { customer_id: created.customer, price_list_id: created.plist, valid_until: '2026-09-30' }, T);
  created.quote = r.data.id; ok('create quote with price list', r.status === 200 && created.quote, JSON.stringify(r.data).slice(0, 80));
  r = await req('PUT', `/api/r/quote/${created.quote}/items`, { items: [{ product_id: created.product, name: 'کالای سناریویی ' + STAMP, qty: 2, price: 820000, discount_pct: 0 }] }, T);
  ok('add quote lines', r.status === 200);
  const q = (await req('GET', '/api/r/quote/' + created.quote, undefined, T)).data.item;
  ok('quote total calculated (2×820000=1640000)', Number(q.subtotal) === 1640000 && Number(q.total) === 1640000, 'subtotal=' + q.subtotal + ' total=' + q.total);

  console.log('— Test 7: Quotation → Order —');
  r = await req('POST', `/api/quotes/${created.quote}/to-order`, {}, T);
  created.order = r.data && (r.data.order_id || r.data.id); ok('convert quote→order', r.status === 200 && created.order, JSON.stringify(r.data).slice(0, 80));
  const o = (await req('GET', '/api/r/order/' + created.order, undefined, T)).data.item;
  const oItems = (await req('GET', `/api/r/order/${created.order}/items`, undefined, T)).data.items;
  ok('order has copied lines & total', oItems.length === 1 && Number(o.total) === 1640000, 'lines=' + oItems.length + ' total=' + o.total);

  console.log('— Test 8: Order → Invoice —');
  r = await req('POST', `/api/orders/${created.order}/to-invoice`, {}, T);
  created.invoice = r.data && (r.data.invoice_id || r.data.id); ok('convert order→invoice', r.status === 200 && created.invoice, JSON.stringify(r.data).slice(0, 80));
  const inv = (await req('GET', '/api/r/invoice/' + created.invoice, undefined, T)).data.item;
  ok('invoice created with tax', Number(inv.subtotal) === 1640000 && Number(inv.total) === Math.round(1640000 * 1.09), 'total=' + inv.total + ' (tax ' + inv.tax + ')');

  console.log('— Test 9: Invoice → Payment (balance auto-update) —');
  r = await req('POST', '/api/payments', { invoice_id: created.invoice, customer_id: created.customer, amount: Number(inv.total), method: 'bank', reference: 'REF' + STAMP }, T);
  ok('register full payment', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  const inv2 = (await req('GET', '/api/r/invoice/' + created.invoice, undefined, T)).data.item;
  ok('invoice balance auto-updated → paid', Number(inv2.paid_amount) === Number(inv2.total) && inv2.status === 'paid', 'paid=' + inv2.paid_amount + ' status=' + inv2.status);
  const printR = await fetch(base + `/api/print/invoice/${created.invoice}`, { headers: { Authorization: 'Bearer ' + T } });
  ok('print/PDF invoice renders', printR.status === 200 && (await printR.text()).includes('<'));

  console.log('— Test 10: Test Request → Test Result —');
  r = await req('POST', '/api/r/lab_request', { customer_id: created.customer, product_id: created.product, test_type: 'density', priority: 'medium', status: 'received', requestor: 'سناریو' }, T);
  created.labReq = r.data.id; ok('create lab request', r.status === 200 && created.labReq, JSON.stringify(r.data).slice(0, 100));
  r = await req('PUT', `/api/r/lab_request/${created.labReq}`, { status: 'done' }, T); ok('mark request done', r.status === 200);
  r = await req('POST', '/api/r/lab_result', { request_id: created.labReq, test_name: 'چگالی', result_value: '28', unit: 'kg/m3', spec_text: '28±2', status: 'pass' }, T);
  created.labResult = r.data.id; ok('register lab result (pass)', r.status === 200 && created.labResult, JSON.stringify(r.data).slice(0, 100));
  r = await req('POST', `/api/lab/${created.labReq}/report`, {}, T); ok('lab report generated', r.status === 200, JSON.stringify(r.data).slice(0, 80));

  console.log('— Test 11: Complaint → Ticket → Follow-up —');
  r = await req('POST', '/api/r/complaint', { customer_id: created.customer, subject: 'شکایت سناریویی ' + STAMP, description: 'تست یکپارچگی', category: 'quality', priority: 'high' }, T);
  created.complaint = r.data.id; ok('create complaint', r.status === 200 && created.complaint, JSON.stringify(r.data).slice(0, 80));
  r = await req('POST', '/api/r/ticket', { customer_id: created.customer, subject: 'تیکت پیگیر سناریو', priority: 'medium', status: 'open' }, T);
  created.ticket = r.data.id; ok('create ticket', r.status === 200 && created.ticket, JSON.stringify(r.data).slice(0, 80));
  r = await req('POST', '/api/r/followup', { entity_type: 'customer', entity_id: created.customer, subject: 'پیگیری سناریو', note: 'تماس تلفنی', due_at: new Date(Date.now() + 864e5).toISOString() }, T);
  created.followup = r.data.id; ok('create follow-up', r.status === 200 && created.followup, JSON.stringify(r.data).slice(0, 80));
  const cal = (await req('GET', '/api/calendar?from=' + new Date(Date.now()).toISOString() + '&to=' + new Date(Date.now() + 2 * 864e5).toISOString(), undefined, T)).data.events || [];
  ok('follow-up shows on calendar', cal.some(ev => ev.type === 'followup' && ev.ref_id === created.followup), 'events=' + cal.length);

  console.log('— Test 12: Meeting → Calendar —');
  const startIso = new Date(Date.now() + 864e5).toISOString();
  r = await req('POST', '/api/r/meeting', { title: 'جلسه سناریویی ' + STAMP, customer_id: created.customer, start_at: startIso, end_at: new Date(Date.now() + 864e5 + 36e5).toISOString() }, T);
  created.meeting = r.data.id; ok('create meeting', r.status === 200 && created.meeting, JSON.stringify(r.data).slice(0, 80));
  const cal2 = (await req('GET', '/api/calendar?from=' + new Date(Date.now()).toISOString() + '&to=' + new Date(Date.now() + 3 * 864e5).toISOString(), undefined, T)).data.events || [];
  ok('meeting appears in calendar', cal2.some(ev => ev.type === 'meeting' && ev.ref_id === created.meeting), 'events=' + cal2.length);

  console.log('— Test 13: Document upload → list → download —');
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('entity_type', 'customer'); fd.append('entity_id', String(created.customer));
  fd.append('file', new Blob([png1x1], { type: 'image/png' }), 'scn-' + STAMP + '.png');
  let up = { status: 0, data: null };
  try {
    const ur = await fetch(base + '/api/attachments', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: fd });
    up = { status: ur.status, data: await ur.json().catch(() => null) };
  } catch (e) { up = { status: 0, data: String(e) }; }
  const attId = up.data && up.data.ids && up.data.ids[0];
  ok('upload document', up.status === 200 && attId, JSON.stringify(up.data).slice(0, 80));
  if (attId) {
    const dl = await fetch(base + `/api/attachments/${attId}/download`, { headers: { Authorization: 'Bearer ' + T } });
    ok('download document', dl.status === 200 && (dl.headers.get('content-type') || '').includes('png'));
  } else ok('download document', false, 'no attachment id');

  console.log('— Test 14: Report builder → save → export —');
  r = await req('POST', '/api/reports/run', { source: 'sales', columns: ['number', 'customer', 'total', 'status'], group_by: 'status' }, T);
  ok('run grouped report', r.status === 200 && Array.isArray(r.data.rows) && r.data.rows.length > 0, JSON.stringify(r.data).slice(0, 80));
  r = await req('POST', '/api/reports/definitions', { name: 'گزارش سناریویی ' + STAMP, source: 'sales', columns: ['number', 'customer', 'total', 'status'], group_by: 'status' }, T);
  created.report = r.data.id; ok('save report definition', r.status === 200 && created.report, JSON.stringify(r.data).slice(0, 80));
  const exp = await fetch(base + `/api/reports/definitions/${created.report}/export?format=csv`, { headers: { Authorization: 'Bearer ' + T } });
  const expTxt = await exp.text();
  ok('export saved report (CSV)', exp.status === 200 && expTxt.includes(','), exp.status + ' ' + expTxt.slice(0, 60));

  // ---------- cleanup ----------
  const db = require('/home/user/baspar-crm/node_modules/better-sqlite3')('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = db.transaction(() => {
    const del = (t, col, id) => { if (id) db.prepare(`DELETE FROM ${t} WHERE ${col}=?`).run(id); };
    db.prepare('DELETE FROM attachments WHERE id=?').run(attId || 0);
    db.prepare(`DELETE FROM documents WHERE title LIKE '%${STAMP}%'`).run();
    del('meetings', 'id', created.meeting);
    del('followups', 'id', created.followup);
    del('tickets', 'id', created.ticket);
    del('complaints', 'id', created.complaint);
    db.prepare('DELETE FROM lab_results WHERE request_id=?').run(created.labReq || 0);
    del('lab_requests', 'id', created.labReq);
    db.prepare('DELETE FROM payments WHERE invoice_id=?').run(created.invoice || 0);
    db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(created.invoice || 0);
    del('invoices', 'id', created.invoice);
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(created.order || 0);
    del('orders', 'id', created.order);
    db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(created.quote || 0);
    del('quotes', 'id', created.quote);
    db.prepare('DELETE FROM price_list_items WHERE price_list_id=?').run(created.plist || 0);
    del('price_lists', 'id', created.plist);
    for (const plId of (created.price_lists || [])) { db.prepare('DELETE FROM price_list_items WHERE price_list_id=?').run(plId); del('price_lists', 'id', plId); }
    db.prepare('DELETE FROM price_list_items WHERE product_id=?').run(created.product || 0);
    del('opportunity_items', 'opportunity_id', created.opp || 0);
    del('opportunities', 'id', created.opp);
    del('leads', 'id', created.lead);
    db.prepare('DELETE FROM customer_contacts WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)').run('%' + STAMP + '%');
    db.prepare('DELETE FROM customers WHERE name LIKE ?').run('%' + STAMP + '%');
    db.prepare('DELETE FROM products WHERE code LIKE ?').run('SCN' + STAMP);
    db.prepare('DELETE FROM report_definitions WHERE name LIKE ?').run('%' + STAMP + '%');
    db.prepare(`DELETE FROM report_instances WHERE created_at > datetime('now','-1 hour')`).run();
    db.prepare(`DELETE FROM activities WHERE created_at > datetime('now','-1 hour')`).run();
    db.prepare(`DELETE FROM audit_logs WHERE at > datetime('now','-1 hour')`).run();
    // remove FTS entries for the deleted scenario entities only (keep seed index intact)
    const myPairs = [
      ['customer', created.customer], ['lead', created.lead], ['opportunity', created.opp],
      ['product', created.product], ['quote', created.quote], ['order', created.order],
      ['invoice', created.invoice], ['lab_request', created.labReq], ['complaint', created.complaint],
      ['ticket', created.ticket], ['followup', created.followup], ['meeting', created.meeting],
    ];
    const delMap = db.prepare('SELECT fts_rowid FROM search_map WHERE kind=? AND id=?');
    const delIdx = db.prepare('DELETE FROM search_index WHERE rowid=?');
    const delMp = db.prepare('DELETE FROM search_map WHERE fts_rowid=?');
    for (const [k, id] of myPairs) {
      if (!id) continue;
      for (const row of delMap.all(k, id)) { delIdx.run(row.fts_rowid); delMp.run(row.fts_rowid); }
    }
    db.prepare(`DELETE FROM notifications WHERE created_at > datetime('now','-1 hour')`).run();
  });
  tx();
  console.log('  (scenario cleanup done)');

  console.log('=====================================');
  console.log(`SCENARIOS: ${pass} passed, ${fail} failed`);
  if (failures.length) failures.forEach(f => console.log('  - ' + f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
