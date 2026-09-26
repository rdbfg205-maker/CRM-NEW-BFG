// Item 43 — Real Sales Scenario E2E through the Workflow Visual Engine:
// Customer → (event) → Proforma → SalesMgr Approval+Signature → FinanceMgr Approval+Signature
// → CEO Approval+Signature → Order → Warehouse Task → Invoice → Finance Notification → Completed.
// Every step is a REAL record in the DB; every signature is a real file; no mock/fake.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const B = 'http://127.0.0.1:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; fails.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
const sleep = (ms) => new Promise(r => setTimeout(ms ? r(ms) : setImmediate(r)));
const req = async (m, p, b, tok) => {
  const h = {};
  if (b) h['content-type'] = 'application/json';
  if (tok) h.authorization = 'Bearer ' + tok;
  const r = await fetch(B + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
  let d = null; const t = await r.text(); try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, d };
};
// tiny valid 1x1 PNG (real signature image data)
const SIG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const stamp = String(Date.now()).slice(-6);
  const MARK = 'سناریو فروش ' + stamp;
  // resilient login: retry with backoff on the legitimate login rate-limiter
  const lg = async (u, p) => {
    for (let a = 0; a < 4; a++) {
      const r = await req('POST', '/api/auth/login', { username: u, password: p });
      if (r.d && r.d.access) return r.d.access;
      await sleep(62000); // wait out the 60s login rate-limit window
    }
    throw new Error('login failed for ' + u + ' after retries');
  };
  const A = await lg('admin', 'admin1234');
  const SALES = await lg('ali.k', '12345678');      // sales_manager
  const FIN = await lg('mohammad.f', '12345678');   // finance_manager
  const CEO = await lg('reza.m', '12345678');       // ceo
  const WH = await lg('amin.p', '12345678');        // warehouse_manager
  ok('logins (admin + 4 approvers)', !!(A && SALES && FIN && CEO && WH));

  const db = require('better-sqlite3')('/home/user/baspar-crm/data/baspar-crm.sqlite');

  // ===== 1) real customer creation fires the real trigger =====
  const cc = await req('POST', '/api/r/customer', { name: MARK, type: 'company', phone: '021' + stamp.slice(-7), mobile: '0912' + stamp.slice(-4) }, A);
  const CUST = cc.d && cc.d.id;
  ok('S1 real customer created (event source)', !!CUST, JSON.stringify(cc.d).slice(0, 80));

  // poll for the instance (event bus → engine, async)
  let inst = null;
  for (let i = 0; i < 30 && !inst; i++) {
    await sleep(400);
    const r = await req('GET', '/api/wf/entity/customer/' + CUST + '/instances', undefined, A);
    const items = (r.d && r.d.items) || [];
    inst = items.find(x => x.status === 'running' || x.status === 'waiting' || x.status === 'pending' || x.status === 'completed');
  }
  ok('S2 workflow instance auto-started by customer_created event', !!inst, 'inst=' + (inst && inst.id));
  ok('S3 execution ID format WF-YYYY-NNNNNN', inst && /^WF-\d{4}-\d{6}$/.test(inst.execution_no || ''), 'execNo=' + (inst && inst.execution_no));
  const INST = inst.id;

  // ===== 2) auto actions ran (followup + welcome message + proforma) =====
  const fu = db.prepare('SELECT * FROM followups WHERE entity_type=? AND entity_id=?').all('customer', CUST);
  ok('S4 real follow-up created by workflow (welcome)', fu.length >= 1 && /خوش‌آمد|خوش آمد/.test(fu[0].subject || ''), 'n=' + fu.length + ' subj=' + (fu[0] && fu[0].subject));
  const qu = db.prepare('SELECT * FROM quotes WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(CUST);
  ok('S5 real proforma (quote) created by workflow', !!qu, qu && ('q=' + qu.id + ' status=' + qu.status));

  // message node: provider not configured → must be logged as not_configured (no fake send)
  const msgLog = db.prepare("SELECT * FROM wf_logs WHERE execution_id=? AND level='warn'").all(INST).find(l => /not_configured|Not Configured|تنظیم نشده/i.test(l.message));
  ok('S6 welcome message node: honest Not-Configured (no fake send)', !!msgLog, msgLog && msgLog.message);

  // ===== 3) blocking approval: stuck at Sales Manager, Finance/CEO NOT active =====
  const atNode = async (nodeId, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const row = db.prepare('SELECT * FROM wf_instances WHERE id=?').get(INST);
      if (row.current_node_id === nodeId) return row;
      if (!['running', 'waiting'].includes(row.status)) return row;
      await sleep(300);
    }
    return db.prepare('SELECT * FROM wf_instances WHERE id=?').get(INST);
  };
  let row = await atNode('n_appr1');
  ok('S7 blocked at Sales Manager approval (n_appr1)', row.current_node_id === 'n_appr1', 'cur=' + row.current_node_id + ' status=' + row.status);
  let activeSteps = db.prepare("SELECT * FROM wf_steps WHERE instance_id=? AND status='active'").all(INST);
  ok('S8 only sales-mgr step active (finance/CEO NOT active yet — blocking)', activeSteps.length === 1 && activeSteps[0].node_id === 'n_appr1', JSON.stringify(activeSteps.map(s => s.node_id)));

  // wrong-role user must be rejected (item 10/32)
  const apprStep1 = activeSteps[0];
  const badTry = await req('POST', `/api/wf/instances/${INST}/step/${apprStep1.id}/complete`, { result: 'approve', note: 'حرفه‌ای' }, FIN);
  ok('S9 finance manager CANNOT approve sales step (403)', badTry.status === 403, badTry.status);

  // ===== 4) Sales Manager: approval + signature =====
  const myTask = async (tok) => {
    const r = await req('GET', '/api/wf/my-tasks', undefined, tok);
    return ((r.d && r.d.items) || []).find(t => t.execution_id === INST);
  };
  let t = await myTask(SALES);
  ok('S10 sales manager sees the approval in my-tasks', !!t && t.node_id === 'n_appr1', t && ('node=' + t.node_id));
  let r = await req('POST', `/api/wf/instances/${INST}/step/${t.step_id}/complete`, { result: 'approve', note: 'تأیید مدیر فروش — مبلغ منطقی است' }, SALES);
  ok('S11 sales approval done (real step)', r.status === 200 && r.d.ok, JSON.stringify(r.d).slice(0, 80));

  row = await atNode('n_sig1');
  t = await myTask(SALES);
  ok('S12 signature step active for sales manager', !!t && t.node_id === 'n_sig1' && t.needs_signature === true, t && ('node=' + t.node_id));
  r = await req('POST', `/api/wf/instances/${INST}/step/${t.step_id}/complete`, { result: 'approve', signature: SIG_PNG, note: 'امضای دیجیتال' }, SALES);
  ok('S13 sales signature captured (real file)', r.status === 200 && r.d.ok, JSON.stringify(r.d).slice(0, 100));
  const sig1 = db.prepare("SELECT * FROM wf_steps WHERE instance_id=? AND node_id='n_sig1'").get(INST);
  ok('S14 sales signature file exists on disk', !!(sig1 && sig1.signature_path) && require('fs').existsSync(sig1.signature_path), sig1 && sig1.signature_path);

  // ===== 5) Finance Manager: approval + signature =====
  row = await atNode('n_appr2');
  ok('S15 finance approval active after sales approval (sequential)', row.current_node_id === 'n_appr2', 'cur=' + row.current_node_id);
  t = await myTask(FIN);
  r = await req('POST', `/api/wf/instances/${INST}/step/${t.step_id}/complete`, { result: 'approve', note: 'تأیید مدیر مالی' }, FIN);
  ok('S16 finance approval done', r.status === 200 && r.d.ok);
  row = await atNode('n_sig2');
  t = await myTask(FIN);
  r = await req('POST', `/api/wf/instances/${INST}/step/${t.step_id}/complete`, { result: 'approve', signature: SIG_PNG }, FIN);
  ok('S17 finance signature captured', r.status === 200 && r.d.ok);
  const sig2 = db.prepare("SELECT * FROM wf_steps WHERE instance_id=? AND node_id='n_sig2'").get(INST);
  ok('S18 finance signature file exists', !!(sig2 && sig2.signature_path) && require('fs').existsSync(sig2.signature_path));

  // ===== 6) CEO: approval + signature =====
  row = await atNode('n_appr3');
  ok('S19 CEO approval active', row.current_node_id === 'n_appr3', 'cur=' + row.current_node_id);
  t = await myTask(CEO);
  r = await req('POST', `/api/wf/instances/${INST}/step/${t.step_id}/complete`, { result: 'approve', note: 'تأیید مدیرعامل' }, CEO);
  ok('S20 CEO approval done', r.status === 200 && r.d.ok);
  row = await atNode('n_sig3');
  t = await myTask(CEO);
  r = await req('POST', `/api/wf/instances/${INST}/step/${t.step_id}/complete`, { result: 'approve', signature: SIG_PNG }, CEO);
  ok('S21 CEO signature captured', r.status === 200 && r.d.ok);
  const sig3 = db.prepare("SELECT * FROM wf_steps WHERE instance_id=? AND node_id='n_sig3'").get(INST);
  ok('S22 CEO signature file exists', !!(sig3 && sig3.signature_path) && require('fs').existsSync(sig3.signature_path));

  // ===== 7) Order → Warehouse task → Invoice → Finance → Completed =====
  const ord = db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(CUST);
  ok('S23 real order created after signatures', !!ord, ord && ('od=' + ord.id + ' quote=' + ord.quote_id));
  ok('S24 quote marked converted', qu && db.prepare('SELECT status FROM quotes WHERE id=?').get(qu.id).status === 'converted');

  row = await atNode('n_wh');
  ok('S25 warehouse task step active', row.current_node_id === 'n_wh' && row.status === 'waiting', 'cur=' + row.current_node_id);
  t = await myTask(WH);
  ok('S26 warehouse manager sees the task', !!t && t.node_id === 'n_wh', t && ('node=' + t.node_id));
  r = await req('POST', `/api/wf/instances/${INST}/step/${t.step_id}/complete`, { result: 'complete', note: 'کالا آماده شد' }, WH);
  ok('S27 warehouse task completed', r.status === 200 && r.d.ok);

  // wait for completion (invoice + notification are auto nodes)
  let done = null;
  for (let i = 0; i < 50; i++) {
    row = db.prepare('SELECT * FROM wf_instances WHERE id=?').get(INST);
    if (!['running', 'waiting'].includes(row.status)) { done = row; break; }
    await sleep(300);
  }
  ok('S28 execution COMPLETED', done && done.status === 'completed', done && ('status=' + done.status + ' err=' + done.error));
  const inv = db.prepare('SELECT * FROM invoices WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(CUST);
  ok('S29 real invoice created at the end', !!inv, inv && ('inv=' + inv.id + ' order=' + inv.order_id));
  const finLog = db.prepare("SELECT * FROM wf_logs WHERE execution_id=? AND level='success'").all(INST).find(l => /اعلان|Notification|مالی/i.test(l.message));
  ok('S30 finance notification logged', !!finLog, finLog && finLog.message);

  // ===== 8) audit trail for the whole execution =====
  const audit = db.prepare("SELECT * FROM audit_logs WHERE entity='workflow' AND entity_id=?").all(INST);
  ok('S31 audit log entries for the execution (steps/approvals/signatures)', audit.length >= 6, 'n=' + audit.length);
  const steps = db.prepare("SELECT node_id, status, result, completed_at FROM wf_steps WHERE instance_id=? ORDER BY id").all(INST);
  ok('S32 every step has independent status + timestamps', steps.length >= 7 && steps.every(s => s.status && s.completed_at !== null || ['active'].includes(s.status)), JSON.stringify(steps.map(s => s.node_id + ':' + s.status)));

  // ===== cleanup (name-marker based, same pattern as sales-chain-test) =====
  const Z = '%سناریو فروش%';
  const rm = (sql, ...p) => { try { db.prepare(sql).run(...p); } catch {} };
  rm("UPDATE wf_instances SET status='terminated', current_node_id=NULL WHERE id=?", INST);
  rm('DELETE FROM wf_steps WHERE instance_id=?', INST);
  rm('DELETE FROM wf_schedules WHERE execution_id=?', INST);
  rm('DELETE FROM wf_logs WHERE execution_id=?', INST);
  rm('DELETE FROM followups WHERE entity_id=?', CUST);
  rm('DELETE FROM tasks WHERE related_id=? AND related_type=?', CUST, 'customer');
  rm('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?))', Z);
  rm('DELETE FROM invoices WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', Z);
  rm('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?))', Z);
  rm('DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', Z);
  rm('DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?))', Z);
  rm('DELETE FROM quotes WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ?)', Z);
  rm('DELETE FROM activities WHERE entity_id=?', CUST);
  rm('DELETE FROM customers WHERE name LIKE ?', Z);
  const left = db.prepare('SELECT COUNT(*) c FROM customers WHERE name LIKE ?').get(Z).c;
  ok('S33 cleanup complete (no leftovers)', left === 0, 'left=' + left);
  db.close();

  console.log('');
  console.log('=====================================');
  console.log(`SALES SCENARIO WF E2E: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
