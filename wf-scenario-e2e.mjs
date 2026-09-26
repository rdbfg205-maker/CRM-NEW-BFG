'use strict';
// Main company scenario — REAL end-to-end: Customer → (real) Proforma → 3× approval+signature
// (real users, own signatures) → real Order → warehouse task (real user) → real Invoice → finance notification.
// Verifies real DB results, blocking approvals, RBAC 403s, delete-protection, test-mode dry-run.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const BASE = process.env.BASE || 'http://127.0.0.1:3050';
const DB = '/home/user/baspar-crm/data/baspar-crm.sqlite';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; failures.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
// tiny valid PNG (1x1) for signature registration
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
async function req(method, path, body, tok) {
  const h = {};
  if (body !== undefined && !(body instanceof Buffer)) h['content-type'] = 'application/json';
  if (tok) h.authorization = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (body instanceof Buffer ? body : JSON.stringify(body)) });
  let d = null; const t = await r.text(); try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
async function login(username, password) {
  for (let i = 0; i < 4; i++) {
    const r = await req('POST', '/api/auth/login', { username, password });
    if (r.data && r.data.access) return r.data.access;
    if (r.status === 429) { await sleep(65000); continue; }
    return null;
  }
  return null;
}
async function activeStep(instId, tok) {
  const r = await req('GET', '/api/wf/executions/' + instId, undefined, tok);
  const s = (r.data.steps || []).find(s => s.status === 'active' && !s.parent_id);
  return { inst: r.data.instance, step: s };
}
const waitNode = async (instId, tok, nodeTitle, timeoutMs = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { inst, step } = await activeStep(instId, tok);
    if (step && step.node_title === nodeTitle) return { inst, step };
    if (inst.status === 'completed' || inst.status === 'rejected' || inst.status === 'failed' || inst.status === 'terminated') return { inst, step: null };
    await sleep(700);
  }
  return { inst: (await activeStep(instId, tok)).inst, step: null };
};
(async () => {
  const A = await login('admin', 'admin1234');
  ok('T0 admin login', !!A);
  if (!A) process.exit(1);
  const ALI = await login('ali.k', '12345678');
  const MOH = await login('mohammad.f', '12345678');
  const REZA = await login('reza.m', '12345678');
  const SARA = await login('sara.m', '12345678');
  ok('T0 demo users login (ali.k/mohammad.f/reza.m/sara.m)', !!(ALI && MOH && REZA && SARA));

  // register real signatures for the 3 signers
  const d0 = new BDB(DB);
  const signerIds = d0.prepare("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.username IN ('ali.k','mohammad.f','reza.m')").all().map(x => x.id);
  d0.close();
  // (signatures registered via API as each user)
  const sigs = {};
  for (const [u, tok] of [['ali.k', ALI], ['mohammad.f', MOH], ['reza.m', REZA]]) {
    const boundary = '----wfe' + Date.now() + Math.random().toString(36).slice(2, 6);
    const parts = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sig.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from(PNG_B64, 'base64'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    const r = await fetch(BASE + '/api/signature/me', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=' + boundary, authorization: 'Bearer ' + tok }, body: Buffer.concat(parts) });
    const j = await r.json();
    sigs[u] = { status: r.status, has: j.has_signature };
  }
  ok('T1 real signatures registered for 3 signers', Object.values(sigs).every(s => s.status === 200 && s.has), JSON.stringify(sigs));

  // find the sales-chain template
  const procs = await req('GET', '/api/wf/processes', undefined, A);
  const tpl = (procs.data.items || []).find(p => p.key === 'tpl_sales_chain');
  ok('T2 sales-chain template exists & active', !!tpl && tpl.active === 1, JSON.stringify(tpl && { key: tpl.key, active: tpl.active }));

  // create a REAL customer → triggers the workflow
  const stamp = Date.now().toString().slice(-6);
  const cr = await req('POST', '/api/r/customer', { name: 'شرکت سناریو ' + stamp, type: 'company', tax_code: '130' + stamp, phone: '0611' + stamp, mobile: '0911' + stamp, city: 'اهواز', salesperson_id: 4 }, A);
  ok('T3 real customer created', cr.status === 200 && cr.data.id, JSON.stringify(cr.data).slice(0, 80));
  const CUST = cr.data.id;
  await sleep(2500);
  const execs = await req('GET', '/api/wf/executions?process=' + tpl.id, undefined, A);
  const ex = (execs.data.items || []).find(i => i.entity_id === CUST);
  ok('T4 execution auto-started on real event (customer.created)', !!ex && ['waiting', 'running'].includes(ex.status), JSON.stringify(ex && { status: ex.status, node: ex.current_node_title }));
  const INST = ex ? ex.id : 0;
  if (!INST) { console.log('cannot continue without execution'); process.exit(1); }

  // real quote created by the engine (auto node)
  const d1 = new BDB(DB, { readonly: true });
  const qRow = d1.prepare('SELECT * FROM quotes WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(CUST);
  d1.close();
  ok('T5 engine created a REAL proforma for the customer', !!qRow && !!qRow.number, JSON.stringify(qRow && { id: qRow.id, number: qRow.number, status: qRow.status }));

  // blocking: now at sales-manager approval
  let w = await waitNode(INST, A, 'تأیید مدیر فروش');
  ok('T6 execution blocked at «تأیید مدیر فروش» (waiting)', !!w.step, JSON.stringify(w.inst && { status: w.inst.status, node: w.inst.current_node_title }));

  // RBAC: sara (sales, NOT sales_manager) cannot approve
  let rb = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'approve' }, SARA);
  ok('T7 non-assignee (sales) approve → 403', rb.status === 403, 'status=' + rb.status);
  // execution still blocked
  w = await waitNode(INST, A, 'تأیید مدیر فروش');
  ok('T8 still blocked after 403 (blocking approval works)', !!w.step);

  // ali.k (sales_manager) approves
  rb = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'approve', note: 'تأیید شد' }, ALI);
  ok('T9 sales_manager approved', rb.status === 200 && rb.data.ok, JSON.stringify(rb.data).slice(0, 80));

  // signature step: mohammad.f must NOT be able to sign ali.k's step
  w = await waitNode(INST, A, 'امضای مدیر فروش');
  ok('T10 advanced to «امضای مدیر فروش»', !!w.step);
  let sg = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'complete' }, MOH);
  ok('T11 another user cannot sign this step → 403', sg.status === 403, 'status=' + sg.status);
  sg = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'complete', note: 'امضا' }, ALI);
  ok('T12 sales_manager signed with OWN signature', sg.status === 200 && sg.data.ok, JSON.stringify(sg.data).slice(0, 80));

  // finance approval + signature
  w = await waitNode(INST, A, 'تأیید مدیر مالی');
  ok('T13 blocked at «تأیید مدیر مالی»', !!w.step);
  sg = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'approve', note: 'تأیید مالی' }, MOH);
  ok('T14 finance_manager approved', sg.status === 200, JSON.stringify(sg.data).slice(0, 60));
  w = await waitNode(INST, A, 'امضای مدیر مالی');
  sg = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'complete' }, MOH);
  ok('T15 finance_manager signed', sg.status === 200, JSON.stringify(sg.data).slice(0, 60));

  // CEO approval + signature
  w = await waitNode(INST, A, 'تأیید مدیرعامل');
  ok('T16 blocked at «تأیید مدیرعامل»', !!w.step);
  sg = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'approve' }, REZA);
  ok('T17 ceo approved', sg.status === 200, JSON.stringify(sg.data).slice(0, 60));
  w = await waitNode(INST, A, 'امضای مدیرعامل');
  sg = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'complete' }, REZA);
  ok('T18 ceo signed', sg.status === 200, JSON.stringify(sg.data).slice(0, 60));

  // order auto-created (real), then warehouse task (amin.p), then invoice (real)
  await sleep(1000);
  const d2 = new BDB(DB, { readonly: true });
  const oRow = d2.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(CUST);
  d2.close();
  ok('T19 engine created a REAL order from the proforma', !!oRow && !!oRow.number, JSON.stringify(oRow && { id: oRow.id, number: oRow.number, total: oRow.total }));
  w = await waitNode(INST, A, 'آماده‌سازی انبار', 20000);
  ok('T20 blocked at «آماده‌سازی انبار» (warehouse task)', !!w.step, JSON.stringify(w.inst && w.inst.current_node_title));
  // amin.p (warehouse_manager) completes
  const AMIN = await login('amin.p', '12345678');
  sg = await req('POST', `/api/wf/instances/${INST}/step/${w.step.id}/complete`, { result: 'complete', note: 'انبار آماده' }, AMIN);
  ok('T21 warehouse_manager completed', sg.status === 200, JSON.stringify(sg.data).slice(0, 60));
  await sleep(1000);
  const d3 = new BDB(DB, { readonly: true });
  const iRow = d3.prepare('SELECT * FROM invoices WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(CUST);
  const iSteps = d3.prepare("SELECT status FROM wf_instances WHERE id=?").get(INST);
  d3.close();
  ok('T22 engine issued a REAL invoice', !!iRow && !!iRow.number, JSON.stringify(iRow && { id: iRow.id, number: iRow.number, total: iRow.total }));

  // final: completed
  await sleep(1500);
  const fin = await req('GET', '/api/wf/executions/' + INST, undefined, A);
  ok('T23 execution COMPLETED', fin.data.instance.status === 'completed', JSON.stringify(fin.data.instance && { status: fin.data.instance.status }));
  const steps = fin.data.steps || [];
  const sigSteps = steps.filter(s => s.signature_path);
  ok('T24 three signature steps recorded with signature files', sigSteps.length === 3, 'signed=' + sigSteps.length);
  const d4 = new BDB(DB, { readonly: true });
  const sigOk = sigSteps.every(s => s.signature_path && require('fs').existsSync(s.signature_path));
  const logs = d4.prepare('SELECT COUNT(*) c FROM wf_logs WHERE execution_id=?').get(INST).c;
  const audits = d4.prepare("SELECT COUNT(*) c FROM audit_logs WHERE entity_id=? AND entity='workflow'").get(INST).c;
  d4.close();
  ok('T25 signature files exist on disk (real captures)', sigOk, JSON.stringify(sigSteps.map(s => s.signature_path)));
  ok('T26 execution logs recorded (wf_logs)', logs >= 10, 'logs=' + logs);
  ok('T27 audit trail recorded (audit_logs)', audits >= 6, 'audits=' + audits);

  // my-tasks for a pending scenario: use complaint template via a real complaint
  const cpl = await req('POST', '/api/r/complaint', { customer_id: CUST, subject: 'شکایت سناریو ' + stamp, priority: 'high' }, A);
  ok('T28 real complaint created', cpl.status === 200 && cpl.data.id, JSON.stringify(cpl.data).slice(0, 60));
  await sleep(2000);
  const QM = await login('negar.s', '12345678'); // sales — not quality manager
  const qmUser = await login('negar.s', '12345678');
  // quality manager user:
  const dq = new BDB(DB, { readonly: true });
  const qmRow = dq.prepare("SELECT u.username FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='quality_manager' AND u.active=1 LIMIT 1").get();
  dq.close();
  const QM_TOK = qmRow ? await login(qmRow.username, '12345678') : null;
  ok('T29 quality_manager user found', !!QM_TOK, JSON.stringify(qmRow));
  const mt = await req('GET', '/api/wf/my-tasks', undefined, QM_TOK);
  ok('T30 my-tasks shows the complaint analysis step for quality_manager', (mt.data.items || []).some(t => t.node_title === 'تحلیل کیفیت'), JSON.stringify((mt.data.items || []).map(t => t.node_title)));

  // deactivation: no new executions
  const procList = await req('GET', '/api/wf/processes', undefined, A);
  const tplId = (procList.data.items || []).find(p => p.key === 'tpl_sales_chain').id;
  await req('POST', '/api/wf/processes/' + tplId + '/toggle', { active: false }, A);
  const cr2 = await req('POST', '/api/r/customer', { name: 'شرکت غیرفعال ' + stamp, type: 'company', tax_code: '131' + stamp, phone: '0612' + stamp }, A);
  await sleep(1500);
  const ex2 = await req('GET', '/api/wf/executions?process=' + tplId, undefined, A);
  const none2 = !(ex2.data.items || []).find(i => i.entity_id === cr2.data.id);
  ok('T31 deactivated workflow does NOT trigger on new records', none2, 'found=' + JSON.stringify((ex2.data.items || []).map(i => i.entity_id)));
  await req('POST', '/api/wf/processes/' + tplId + '/toggle', { active: true }, A);

  // test-mode dry run: no real quote for the test customer
  const tst = await req('POST', '/api/wf/processes/' + tplId + '/test', { entity_id: cr2.data.id, live: false }, A);
  const d5 = new BDB(DB, { readonly: true });
  const qForTestCust = d5.prepare('SELECT COUNT(*) c FROM quotes WHERE customer_id=?').get(cr2.data.id).c;
  d5.close();
  ok('T32 Test Mode ran (trace present)', tst.status === 200 && tst.data.ok && (tst.data.trace || []).length > 0, JSON.stringify(tst.data && { status: tst.data.status, trace: (tst.data.trace || []).length }));
  ok('T33 Test Mode created NO real quote (dry-run, no fake data)', qForTestCust === 0, 'quotes=' + qForTestCust);

  // delete protection: template has execution history → archive, not delete
  const del = await req('DELETE', '/api/wf/processes/' + tplId, undefined, A);
  ok('T34 delete protection → archived instead of deleted', del.status === 200 && del.data.archived === true, JSON.stringify(del.data));
  await req('POST', '/api/wf/processes/' + tplId + '/toggle', { active: true }, A); // re-activate

  // cleanup scenario data
  await req('DELETE', '/api/r/customer/' + CUST + '?hard=1', undefined, A);
  await req('DELETE', '/api/r/customer/' + cr2.data.id + '?hard=1', undefined, A);

  console.log('\n=====================================');
  console.log('MAIN SCENARIO E2E: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('ALL SCENARIO TESTS PASSED ✅');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
