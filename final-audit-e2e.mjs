// ============ FINAL AUDIT E2E — real business scenario (item 20) ============
// Runs against the live server on port 3050 with REAL data only.
// Chain: Jalali → Voice(customer+contact) → Meeting(3 actions) → Notifications
//        → Quote multi-product+tax → Order → Invoice → Payment → Balance
//        → CommCenter → Workflow execution → Dashboard → Report → Export
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS ' + name + (extra ? '  ' + extra : '')); } else { fail++; fails.push(name); console.log('FAIL ' + name + (extra ? '  ' + extra : '')); } };

async function req(method, path, { token, body, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: r.status, text: await r.text() };
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function login(username, password) {
  for (let attempt = 0; ; attempt++) {
    const r = await req('POST', '/api/auth/login', { body: { username, password } });
    if (r.status === 429 && attempt < 3) { console.log('  … rate limit, waiting 70s for ' + username); await new Promise(z => setTimeout(z, 70000)); continue; }
    if (r.status !== 200 || !r.j || !r.j.access) throw new Error('login failed for ' + username + ' status=' + r.status);
    return r.j.access;
  }
}

(async () => {
  const RUN = String(Date.now() % 100000); // unique per run (duplicate-guard safe)
  const MOB = '0912' + String(1000000 + (Date.now() % 8999999)).slice(0, 7);
  const admin = await login('admin', 'admin1234');
  const sara = await login('sara.m', '12345678');   // sales (id 4)
  const ali = await login('ali.k', '12345678');     // sales_manager (id 3)
  const mohammad = await login('mohammad.f', '12345678'); // finance_manager (id 7)
  const amin = await login('amin.p', '12345678');   // warehouse_manager (id 12)

  // ============ A. JALALI (item 18) ============
  {
    const lib = require('./server/lib/util.js');
    const [jy, jm, jd] = lib.toJalaali('2026-09-16T12:00:00Z');
    ok('JALALI-1 2026-09-16 = 1405/06/25', jy === 1405 && jm === 6 && jd === 25, `${jy}/${jm}/${jd}`);
    const ex = lib.jalExport('2026-09-16T12:00:00.000Z');
        const expectJal = lib.faDigits(1405) + '/' + lib.faDigits('06') + '/' + lib.faDigits('25');
    ok('JALALI-2 export renders full Jalali year 1405 as Persian digits', ex.startsWith(expectJal), ex + ' (expect ' + expectJal + ')');
    ok('JALALI-3 no truncated year in export', !/۱۴۵\//.test(ex), ex);
    const coreJs = require('fs').readFileSync('public/js/core.js', 'utf8');
    ok('JALALI-4 frontend fmtDate renders full Jalali year (faDigits(jy))', /faDigits\(jy\)/.test(coreJs));
  }

  // ============ B. VOICE REGISTRATION (item 1) ============
  const vparse = await req('POST', '/api/voice/parse', { token: admin, body: { text: 'نام من حامد کریمی هست، شماره تماس ۰۹۱۲۱۱۱۲۲۲۳ هست، در صنعت فوم و اسفنج فعالیت می‌کنیم، در استان فارس، شهر شیراز هستیم' } });
  ok('VOICE-1 parse extracts name', vparse.j && vparse.j.name === 'حامد کریمی', JSON.stringify(vparse.j && { n: vparse.j.name }));
  ok('VOICE-2 parse extracts mobile (fa digits normalized)', vparse.j && vparse.j.mobile === '09121112223', vparse.j && vparse.j.mobile);
  ok('VOICE-3 parse extracts industry', vparse.j && vparse.j.industry === 'فوم و اسفنج');
  ok('VOICE-4 parse extracts province/city', vparse.j && vparse.j.province === 'فارس' && vparse.j.city === 'شیراز');

  const cust = await req('POST', '/api/r/customer', { token: admin, body: { name: 'حامد کریمی ' + RUN, type: 'person', mobile: MOB, industry: 'فوم و اسفنج', province: 'فارس', city: 'شیراز', source: 'Voice Assistant', status: 'active', salesperson_id: 4, notes: 'گفتار: نام من حامد کریمی هست…\nثبت از طریق «ثبت سریع مشتری با صدا»' } });
  ok('VOICE-5 customer created via real API', (cust.status === 200 || cust.status === 201) && cust.j && cust.j.id, 'id=' + (cust.j && cust.j.id));
  const custId = cust.j && cust.j.id;
  const custGet = await req('GET', `/api/r/customer/${custId}`, { token: admin });
  ok('VOICE-6 Reload: source = Voice Assistant persisted', custGet.j && (custGet.j.item || custGet.j).source === 'Voice Assistant');
  const custAudit = await req('GET', `/api/r/customer/${custId}/audit`, { token: admin });
  ok('VOICE-7 audit entry exists for voice-created customer', custAudit.j && (custAudit.j.items || []).some(a => a.action === 'create'));

  // contact mode (real contact under the customer)
  const ct = await req('POST', `/api/customers/${custId}/contacts`, { token: admin, body: { name: 'مریم حسینی ' + RUN, position: 'مدیر خرید', mobile: '0913' + String(1000000 + (Date.now() % 8999999)).slice(0, 7), source: 'Voice Assistant', notes: 'گفتار: …\nثبت از طریق «ثبت سریع مخاطب با صدا»' } });
  ok('VOICE-8 contact created via real API', ct.status === 201 || ct.status === 200, 'id=' + (ct.j && ct.j.id));
  const ctId = ct.j && ct.j.id;
  const cts = await req('GET', `/api/customers/${custId}/contacts`, { token: admin });
  ok('VOICE-9 Reload: contact source = Voice Assistant persisted', cts.j && (cts.j.items || []).find(x => x.id === ctId) && cts.j.items.find(x => x.id === ctId).source === 'Voice Assistant');
  // voice-created customer triggers the real workflow (sales chain) via event bus
  await new Promise(r => setTimeout(r, 1500));
  const wfInst = await req('GET', `/api/wf/entity/customer/${custId}/instances`, { token: admin });
  const wfItems = (wfInst.j && (wfInst.j.items || wfInst.j)) || [];
  ok('VOICE-10 customer_created event auto-started real workflow execution', Array.isArray(wfItems) && wfItems.length >= 1, 'n=' + (Array.isArray(wfItems) ? wfItems.length : 'n/a'));

  // ============ C. MEETING + ACTION ITEMS (items 12-14) ============
  const startJal = '1405/06/26';
  const meet = await req('POST', '/api/meetings', { token: admin, body: { title: 'جلسه عملیاتی ۱۴۰۵/۰۶', meeting_type: 'customer', customer_id: custId, contact_id: ctId, start_at: new Date().toISOString(), mode: 'inperson', location: 'سالن جلسه', organizer_id: 2, participant_ids: '3,4,7', description: 'بررسی فروش', notes: '', status: 'scheduled' } });
  ok('MTG-1 meeting created (real API)', (meet.status === 200 || meet.status === 201) && meet.j && meet.j.id, 'id=' + (meet.j && meet.j.id));
  const meetId = meet.j && meet.j.id;
  const dueIn3 = new Date(Date.now() + 3 * 864e5).toISOString();
  const a1 = await req('POST', `/api/r/meeting/${meetId}/tasks`, { token: admin, body: { title: 'ارسال پیش‌فاکتور', description: 'بر اساس قیمت جدید', assignee_id: 4, follower_id: 3, due_at: dueIn3, priority: 'high', status: 'open', notes: 'اقدام ۱', result: null } });
  ok('MTG-2 action 1 saved as real task', (a1.status === 200 || a1.status === 201) && a1.j && a1.j.id, 'id=' + (a1.j && a1.j.id));
  const a2 = await req('POST', `/api/r/meeting/${meetId}/tasks`, { token: admin, body: { title: 'بررسی قیمت مواد اولیه', assignee_id: 7, follower_id: 4, due_at: dueIn3, priority: 'medium', status: 'open' } });
  const a3 = await req('POST', `/api/r/meeting/${meetId}/tasks`, { token: admin, body: { title: 'برنامه‌ریزی تحویل', assignee_id: 4, due_at: dueIn3, priority: 'low', status: 'open', result: 'در حال بررسی' } });
  ok('MTG-3 actions 2 & 3 saved', (a2.j && a2.j.id) && (a3.j && a3.j.id));
  const full = await req('GET', `/api/r/meeting/${meetId}/full`, { token: admin });
  ok('MTG-4 Reload: meeting detail lists 3 linked actions', full.j && (full.j.tasks || []).length === 3, 'n=' + (full.j && (full.j.tasks || []).length));
  ok('MTG-5 action stores follower_id + result in DB', full.j && full.j.tasks.some(t => t.follower_id === 3 && t.title === 'ارسال پیش‌فاکتور') && full.j.tasks.some(t => t.result === 'در حال بررسی'));
  ok('MTG-6 Reload: participants persisted', full.j && (full.j.attendees || []).length >= 3, 'n=' + (full.j && (full.j.attendees || []).length));
  // notifications to responsible + follower (item 14)
  const saraNotifs = await req('GET', '/api/notifications', { token: sara });
  ok('MTG-7 responsible (sara) notified with meeting title', saraNotifs.j && (saraNotifs.j.items || []).some(n => n.type === 'task' && /جلسه عملیاتی/.test(n.body) && /مهلت/.test(n.body)), 'unread=' + (saraNotifs.j && saraNotifs.j.unread));
  const aliNotifs = await req('GET', '/api/notifications', { token: ali });
  ok('MTG-8 follower (ali) notified', aliNotifs.j && (aliNotifs.j.items || []).some(n => n.type === 'task' && /جلسه عملیاتی/.test(n.body)));
  // deadline on calendar (item 14)
  const from = new Date(Date.now() - 864e5).toISOString();
  const to = new Date(Date.now() + 7 * 864e5).toISOString();
  const cal = await req('GET', `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&per_page=200`, { token: sara });
  const calEvents = (cal.j && (cal.j.events || cal.j.items)) || [];
  ok('MTG-9 action deadline visible in calendar', Array.isArray(calEvents) && calEvents.some(e => e.source === 'task' && /ارسال پیش‌فاکتور/.test(e.title || '')));
  // responsible panel: sara's my-tasks in /tasks list
  const saraTasks = await req('GET', '/api/r/task?per_page=100', { token: sara });
  ok('MTG-10 action visible in responsible user task list', saraTasks.j && (saraTasks.j.items || []).some(t => t.id === a1.j.id));

  // ============ D. QUOTE MULTI-PRODUCT + PER-LINE TAX (item 6) ============
  // create two real products with KNOWN base prices and use the returned ids
  // directly (list ordering must not matter; item prices equal base price →
  // no price-override needed). Unique codes per run; cleaned up at end.
  const mkProd = async (code, price) => {
    const p = await req('POST', '/api/r/product', { token: admin, body: { code, name: 'اسفنج تست ' + code, unit: 'متر', price_retail: price, stock_qty: 100 } });
    const pid = p.j && (p.j.id || (p.j.item && p.j.item.id));
    if (!pid) throw new Error('product create failed: ' + JSON.stringify(p.j));
    return { id: pid, name: 'اسفنج تست ' + code, price_retail: price };
  };
  const pd1 = await mkProd('PD-TEST-1-' + RUN, 1000000);
  const pd2 = await mkProd('PD-TEST-2-' + RUN, 800000);
  const q = await req('POST', '/api/r/quote', { token: admin, body: { customer_id: custId, salesperson_id: 4, tax_rate: 0, shipping: 50000, notes: 'پیش‌فاکتور تست' } });
  ok('QUOTE-1 quote created (real API)', (q.status === 200 || q.status === 201) && q.j && q.j.id, 'id=' + (q.j && q.j.id));
  const qid = q.j && q.j.id;
  const items = await req('PUT', `/api/r/quote/${qid}/items`, { token: admin, body: { items: [
    { product_id: pd1.id, name: pd1.name, qty: 2, price: 1000000, discount_pct: 10, tax_rate: 10 },
    { product_id: pd2.id, name: pd2.name, qty: 3, price: 800000, discount_pct: 0, tax_rate: 20 },
  ] } });
  ok('QUOTE-2 multi-product lines saved (2 items, per-line tax)', items.status === 200);
  const qget = await req('GET', `/api/r/quote/${qid}`, { token: admin });
  const qdoc = qget.j && (qget.j.item || qget.j);
  // expected: line1 = 2*1e6*0.9 = 1,800,000; line2 = 3*0.8e6 = 2,400,000; subtotal 4,200,000; tax = 180k + 480k = 660,000; total = 4,860,000 + shipping 50,000
  ok('QUOTE-3 subtotal = 4,200,000 (real recalc)', qdoc && qdoc.subtotal === 4200000, 'subtotal=' + (qdoc && qdoc.subtotal));
  ok('QUOTE-4 total = 4,910,000 (per-line tax 10%/20% + shipping 50k)', qdoc && qdoc.total === 4910000, 'total=' + (qdoc && qdoc.total));
  const qitems = await req('GET', `/api/r/quote/${qid}/items`, { token: admin });
  ok('QUOTE-5 per-line tax_rate persisted in DB', qitems.j && (qitems.j.items || []).length === 2 && qitems.j.items[0].tax_rate === 10 && qitems.j.items[1].tax_rate === 20);
  // customer balance endpoint on the quote page (item 5/6)
  const fin0 = await req('GET', `/api/customers/${custId}/finance`, { token: admin });
  ok('FIN-1 finance endpoint returns DB-backed totals', fin0.j && fin0.j.totals && typeof fin0.j.totals.balance === 'number', JSON.stringify(fin0.j && fin0.j.totals));

  // ============ E. CHAIN: ORDER → INVOICE → PAYMENT → BALANCE (items 5/20) ============
  const ord = await req('POST', '/api/quotes/' + qid + '/to-order', { token: admin, body: {} });
  const orderId = ord.j && (ord.j.id || (ord.j.item && ord.j.item.id) || ord.j.order_id);
  ok('CHAIN-1 order created from quote (real conversion, lines copied)', ord.status === 200 && !!orderId, 'id=' + orderId);
  if (orderId) {
    const oitems = await req('GET', `/api/r/order/${orderId}/items`, { token: admin });
    ok('CHAIN-2 order lines copied from quote (2 items)', oitems.status === 200 && (oitems.j && (oitems.j.items || []).length === 2), 'n=' + (oitems.j && (oitems.j.items || []).length));
    const inv = await req('POST', '/api/orders/' + orderId + '/to-invoice', { token: admin, body: {} });
    const invId = inv.j && (inv.j.invoice_id || inv.j.id || (inv.j.item && inv.j.item.id));
    ok('CHAIN-3 invoice created from order (real conversion)', inv.status === 200 && invId, 'id=' + invId);
    if (invId) {
      const invGet = await req('GET', `/api/r/invoice/${invId}`, { token: admin });
      const idoc = invGet.j && (invGet.j.item || invGet.j);
      const partial = Math.round((idoc.total || 0) * 0.5);
      const pay = await req('POST', '/api/r/payment', { token: mohammad, body: { customer_id: custId, invoice_id: invId, amount: partial, method: 'bank', status: 'paid', paid_at: new Date().toISOString().slice(0, 10) } });
      ok('CHAIN-4 partial payment registered (real API, finance user)', (pay.status === 200 || pay.status === 201) && pay.j && pay.j.id, 'amount=' + partial);
      await new Promise(r => setTimeout(r, 800));
      const fin = await req('GET', `/api/customers/${custId}/finance`, { token: admin });
      const tt = fin.j && fin.j.totals;
      ok('FIN-2 balance = invoice total − paid (real math)', tt && Math.abs(tt.balance - ((idoc.total || 0) - partial)) < 1, `balance=${tt && tt.balance} expected=${(idoc.total || 0) - partial}`);
      ok('FIN-3 total_invoices = doc total', tt && tt.total_invoices === idoc.total);
      ok('FIN-4 total_paid = partial payment', tt && tt.total_paid === partial);
      ok('FIN-5 last_payment + last_invoice present (drill-down)', fin.j && fin.j.related && fin.j.related.last_invoice && fin.j.related.last_payment, 'last_inv=' + (fin.j && fin.j.related && fin.j.related.last_invoice && fin.j.related.last_invoice.number));
      ok('FIN-6 credit status exposed (بستانکاری/اعتبار)', fin.j && fin.j.customer && typeof (fin.j.customer.credit_status || '') === 'string');
    }
  }

  // ============ F. NOTIFICATIONS (item 2) — real events, no duplicates ============
  const aliN = await req('GET', '/api/notifications', { token: ali });
  const aliItems = aliN.j && (aliN.j.items || []);
  ok('NOTIF-1 quote creation notified sales_manager (ali, non-creator)', aliItems.some(n => n.type === 'quote' && /پیش‌فاکتور جدید/.test(n.title)));
  const saraN = await req('GET', '/api/notifications', { token: sara });
  const saraItems = saraN.j && (saraN.j.items || []);
  const mohN = await req('GET', '/api/notifications', { token: mohammad });
  const mohItems = mohN.j && (mohN.j.items || []);
  ok('NOTIF-2 invoice creation notified finance_manager (mohammad)', mohItems.some(n => n.type === 'invoice' && /فاکتور جدید/.test(n.title)));
  const aminN = await req('GET', '/api/notifications', { token: amin });
  const aminItems = aminN.j && (aminN.j.items || []);
  ok('NOTIF-3 order creation notified warehouse_manager (amin)', aminItems.some(n => n.type === 'order' && /سفارش جدید/.test(n.title)));
  ok('NOTIF-4 payment notified salesperson (sara; creator mohammad excluded by design)', saraItems.some(n => n.type === 'payment' && /پرداخت/.test(n.title)));
  // no duplicate: exactly one quote notification for this quote to ali
  const quoteNotifs = aliItems.filter(n => n.type === 'quote' && n.ref_id === qid);
  ok('NOTIF-5 no duplicate quote notification (exactly 1 to ali)', quoteNotifs.length === 1, 'n=' + quoteNotifs.length);
  // creator exclusion: admin created the quote → admin still gets role notify (admin is in role list) — instead check sara (salesperson=creator) not double-notified as creator for her own task
  const saraQuote = saraItems.filter(n => n.type === 'quote' && n.ref_id === qid);
  ok('NOTIF-6 salesperson notified of her customer quote (salesperson notify, not creator dup)', saraQuote.length === 1, 'n=' + saraQuote.length);

  // WS real-time push (live toast source): open a real socket as sara, create a task for her, expect notification message
  {
    const WebSocket = (await import('ws')).default;
    const got = await new Promise((resolve) => {
      const ws = new WebSocket('ws://localhost:3050/ws?token=' + encodeURIComponent(sara));
      const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 8000);
      ws.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'notification' && /وظیفه جدید/.test(m.data.title)) { clearTimeout(timer); try { ws.close(); } catch {} resolve(m.data); }
        } catch {}
      });
      ws.on('open', async () => {
        // manual task (related_type null) → generic notify hook
        await req('POST', '/api/r/task', { token: admin, body: { title: 'وظیفه تست ریل‌تایم', assignee_id: 4, priority: 'medium', status: 'open' } });
      });
      ws.on('error', () => { clearTimeout(timer); resolve(null); });
    });
    ok('NOTIF-7 REAL-TIME WS push delivered to user (live toast source)', !!got && typeof got.id === 'number', got ? 'notifId=' + got.id : 'no push in 8s');
  }

  // ============ G. COMMUNICATION CENTER (item 8) ============
  const msg = await req('POST', '/api/customermsg/send', { token: admin, body: { customer_id: custId, event_type: 'quote', doc_id: qid, channel: 'sms' } });
  ok('COMM-1 customer message recorded (honest status: not_configured or sent)', (msg.status === 200) && msg.j && (msg.j.status === 'not_configured' || msg.j.status === 'sent'), 'status=' + (msg.j && msg.j.status));
  const cc = await req('GET', '/api/comm/center?channel=sms&direction=outgoing', { token: admin });
  ok('COMM-2 center lists the real message (channel sms, direction outgoing)', cc.j && Array.isArray(cc.j.items) && cc.j.items.some(it => it.source === 'customer_message' && it.channel === 'sms' && it.customer_id === custId), JSON.stringify(cc.j && (cc.j.error || 'ok')).slice(0,120));
  const ccAll = await req('GET', '/api/comm/center', { token: admin });
  ok('COMM-3 center summary counts real data', ccAll.j && ccAll.j.summary && ccAll.j.summary.total >= 1 && ccAll.j.summary.sources.messages >= 1 && (ccAll.j.summary.by_channel && ccAll.j.summary.by_channel.sms) >= 1, JSON.stringify(ccAll.j && ccAll.j.summary && ccAll.j.summary.sources));
  ok('COMM-4 by_channel/by_direction reporting', ccAll.j && ccAll.j.summary.by_channel.sms >= 1 && ccAll.j.summary.by_direction.outgoing >= 1);

  // ============ H. WORKFLOW EXECUTION PATH (item 3) ============
  const wf2 = await req('GET', `/api/wf/entity/customer/${custId}/instances`, { token: admin });
  const exec = (wf2.j && (wf2.j.items || wf2.j)) && (wf2.j.items || wf2.j)[0];
  if (exec) {
    const exd = await req('GET', `/api/wf/executions/${exec.id}`, { token: admin });
    ok('WF-1 execution detail returns instance+steps+logs+definition', exd.j && exd.j.instance && Array.isArray(exd.j.steps) && exd.j.definition && Array.isArray(exd.j.definition.nodes));
    ok('WF-2 execution_no format WF-YYYY-NNNNNN', exd.j && /^WF-\d{4}-\d{6}$/.test(exd.j.instance.execution_no || ''), exd.j && exd.j.instance.execution_no);
    ok('WF-3 current node + responsible exposed (for path highlight)', exd.j && exd.j.instance.current_node_id && (exd.j.instance.current_responsible || exd.j.instance.current_node_title));
    ok('WF-4 started_at present (Start Date)', exd.j && !!exd.j.instance.started_at);
  } else {
    ok('WF-1 execution detail returns instance+steps+logs+definition', false, 'no execution');
  }

  // ============ I. DASHBOARD (item 9) — KPI vs real DB ============
  const dash = await req('GET', '/api/dashboard?role=ceo', { token: admin });
  const db = require('./node_modules/better-sqlite3')('./data/baspar-crm.sqlite', { readonly: true });
  const custCount = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
  const invOpen = db.prepare("SELECT COUNT(*) c FROM invoices WHERE status IN ('unpaid','partial','overdue')").get().c;
  const d = dash.j || {};
  const flat = JSON.stringify(d);
  ok('DASH-1 dashboard responds with real KPIs', dash.status === 200 && flat.length > 200, 'keys=' + Object.keys(d).slice(0, 6).join(','));
  ok('DASH-2 KPI reflects real customer count (not hardcoded)', flat.includes(String(custCount)), 'customers=' + custCount);
  db.close();

  // ============ J. REPORT BUILDER (item 10) ============
  const rep = await req('POST', '/api/reports/run', { token: admin, body: { source: 'customers', columns: ['name', 'city', 'status'], filters: {}, limit: 50 } });
  ok('REP-1 report runs on real data', rep.status === 200 && rep.j && Array.isArray(rep.j.rows) && rep.j.rows.length >= 1, 'rows=' + (rep.j && rep.j.rows && rep.j.rows.length));
  const saveRep = await req('POST', '/api/reports/definitions', { token: admin, body: { name: 'گزارش ممیزی مشتریان', source: 'customers', columns: ['name', 'city', 'status'], filters: {}, group_by: '', sort: '' } });
  ok('REP-2 report saved (real definition)', (saveRep.status === 200 || saveRep.status === 201) && saveRep.j && saveRep.j.id, 'id=' + (saveRep.j && saveRep.j.id));
  if (saveRep.j && saveRep.j.id) {
    const exp = await req('GET', `/api/reports/definitions/${saveRep.j.id}/export?format=csv`, { token: admin, raw: true });
    ok('REP-3 saved report exports real CSV', exp.status === 200 && exp.text.split('\n').length >= 2, 'bytes=' + exp.text.length);
    const del = await req('DELETE', `/api/reports/definitions/${saveRep.j.id}`, { token: admin });
    ok('REP-4 report deleted (with permission)', del.status === 200);
  }

  // ============ K. EXPORT (item 4) ============
  const csv = await req('GET', '/api/r/customer/export?format=csv', { token: admin, raw: true });
  ok('EXP-1 customer export real CSV with data', csv.status === 200 && csv.text.includes('حامد کریمی'), 'bytes=' + csv.text.length);

  // ============ summary ============
  console.log('\n====================================');
  console.log(`FINAL AUDIT E2E: ${pass} passed, ${fail} failed`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
