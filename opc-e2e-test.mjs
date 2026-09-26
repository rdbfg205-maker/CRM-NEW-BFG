'use strict';
// ITEM 5 — Real OPC + interactive Flowchart E2E test (real DB, real users, real RBAC).
// Scenario: مشتری → ثبت پیش‌فاکتور → شرط (وضعیت) → تأیید مدیر فروش → سفارش → انبار → فاکتور → پرداخت → پایان
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const BASE = process.env.BASE || 'http://localhost:3050';
const DB = '/home/user/baspar-crm/data/baspar-crm.sqlite';
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; failures.push(name + ' :: ' + extra); console.log('  FAIL', name, '::', extra); } };
async function req(method, path, body, tok) {
  const h = { 'content-type': 'application/json' };
  if (tok) h.authorization = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; const t = await r.text(); try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const stamp = Date.now().toString(36);
const NUM = String(Date.now()).slice(-6); // numeric part for phone/tax codes
const sleep = (ms) => new Promise(s => setTimeout(s, ms));
// Login is rate-limited (10/min/IP by design). Other suites may exhaust the window — wait and retry.
async function loginUser(username, password) {
  for (let i = 0; i < 3; i++) {
    const r = await req('POST', '/api/auth/login', { username, password });
    if (r.status === 429) { console.log('    (rate limit — waiting 65s)'); await sleep(65000); continue; }
    return r;
  }
  return await req('POST', '/api/auth/login', { username, password });
}

(async () => {
  // ---------- login admin ----------
  let r = await loginUser('admin', 'admin1234');
  const A = r.data && r.data.access;
  ok('admin login', !!A);
  if (!A) process.exit(1);

  // ---------- roles ----------
  r = await req('GET', '/api/admin/roles', undefined, A);
  const roles = (r.data.roles || []).map(x => ({ id: x.id, name: x.name }));
  const roleByName = (n) => roles.find(x => x.name === n);
  const need = ['sales', 'sales_manager', 'warehouse_manager', 'finance', 'support'].map(roleByName);
  ok('needed roles exist', need.every(Boolean), need.map(x => x && x.name).join(','));

  // ---------- test users (known passwords, cleaned up at the end) ----------
  const T = {};
  const mkUser = async (username, role) => {
    let u = await req('POST', '/api/admin/users', { username, password: 'OpcTest-1234', full_name: 'کاربر تست OPC', role_ids: [role.id] }, A);
    if (u.status === 409) {
      const dw = new BDB(DB); const row = dw.prepare('SELECT id FROM users WHERE username=?').get(username);
      if (row) dw.prepare('UPDATE users SET archived_at=NULL WHERE id=?').run(row.id);
      dw.close();
      await req('PUT', '/api/admin/users/' + row.id, { password: 'OpcTest-1234' }, A);
    }
    const lg = await loginUser(username, 'OpcTest-1234');
    return { id: (lg.data && lg.data.user && lg.data.user.id) || null, tok: lg.data && lg.data.access };
  };
  for (const [k, role] of Object.entries({ sales: roleByName('sales'), sm: roleByName('sales_manager'), wh: roleByName('warehouse_manager'), fin: roleByName('finance'), sup: roleByName('support') })) {
    T[k] = await mkUser('opc_' + k + '_' + stamp, role);
  }
  ok('test users created+logged in', Object.values(T).every(u => u.tok), JSON.stringify(Object.values(T).map(u => !!u.tok)));

  // ---------- 1. RBAC: non-admin cannot list/design processes ----------
  r = await req('GET', '/api/wf/processes', undefined, T.sup.tok);
  ok('R1 non-admin GET /api/wf/processes → 403', r.status === 403, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes', { name: 'خرابکاری', module: 'customer' }, T.sup.tok);
  ok('R2 non-admin create process → 403', r.status === 403, 'status=' + r.status);
  r = await req('GET', '/api/wf/modules', undefined, T.sup.tok);
  ok('R3 any authenticated user can list modules (public module catalog)', r.status === 200, 'status=' + r.status);

  // ---------- 2. create process with real OPC definition ----------
  const def = {
    nodes: [
      { id: 'start', type: 'start', title: 'شروع', x: 40, y: 240 },
      { id: 'n_cust', type: 'task', title: 'ثبت / بررسی مشتری', module: 'customer', op: 'op', x: 260, y: 240, input_desc: 'درخواست ثبت از مشتری', output_desc: 'مشتری ثبت‌شده با شناسه', assignee_type: 'role', assignee: 'sales', notify: true },
      { id: 'n_quote', type: 'task', title: 'ثبت پیش‌فاکتور', module: 'quote', op: 'op', x: 480, y: 240, input_desc: 'مشتری + لیست قیمت', output_desc: 'پیش‌فاکتور پیش‌نویس', assignee_type: 'role', assignee: 'sales', notify: true },
      { id: 'n_cond', type: 'condition', title: 'مشتری فعال است؟', x: 700, y: 240, condition: { field: 'status', op: 'eq', value: 'active' } },
      { id: 'n_appr', type: 'approval', title: 'تأیید مدیر فروش', module: 'quote', op: 'inspection', x: 920, y: 140, input_desc: 'پیش‌فاکتور', output_desc: 'پیش‌فاکتور تأییدشده', assignee_type: 'role', assignee: 'sales_manager', notify: true },
      { id: 'n_order', type: 'task', title: 'تبدیل به سفارش', module: 'order', op: 'op', x: 1140, y: 140, input_desc: 'پیش‌فاکتور تأییدشده', output_desc: 'سفارش ثبت‌شده', assignee_type: 'role', assignee: 'sales', notify: true },
      { id: 'n_stock', type: 'task', title: 'آماده‌سازی انبار', module: 'purchase_order', op: 'storage', x: 1360, y: 140, input_desc: 'سفارش', output_desc: 'محصولات آماده ارسال', assignee_type: 'role', assignee: 'warehouse_manager', notify: true },
      { id: 'n_inv', type: 'task', title: 'صدور فاکتور', module: 'invoice', op: 'op', x: 1580, y: 140, input_desc: 'سفارش تحویل‌شده', output_desc: 'فاکتور رسمی', assignee_type: 'role', assignee: 'finance', notify: true },
      { id: 'n_pay', type: 'task', title: 'ثبت پرداخت', module: 'payment', op: 'op', x: 1800, y: 140, input_desc: 'فاکتور', output_desc: 'فاکتور تسویه‌شده', assignee_type: 'role', assignee: 'finance', notify: true },
      { id: 'end', type: 'end', title: 'پایان', x: 2020, y: 140 },
    ],
    edges: [
      { from: 'start', to: 'n_cust', label: '' },
      { from: 'n_cust', to: 'n_quote', label: '' },
      { from: 'n_quote', to: 'n_cond', label: '' },
      { from: 'n_cond', to: 'n_appr', label: 'true' },
      { from: 'n_cond', to: 'end', label: 'false' },
      { from: 'n_appr', to: 'n_order', label: 'approve' },
      { from: 'n_appr', to: 'end', label: 'reject' },
      { from: 'n_order', to: 'n_stock', label: '' },
      { from: 'n_stock', to: 'n_inv', label: '' },
      { from: 'n_inv', to: 'n_pay', label: '' },
      { from: 'n_pay', to: 'end', label: '' },
    ],
  };
  r = await req('POST', '/api/wf/processes', { name: 'فرآیند فروش (OPC تست ' + stamp + ')', module: 'customer', description: 'مشتری→پیش‌فاکتور→تأیید→سفارش→انبار→فاکتور→پرداخت', trigger_event: 'created' }, A);
  ok('P1 create process', r.status === 200 && r.data.id, JSON.stringify(r.data).slice(0, 80));
  const PID = r.data.id;

  // save the full OPC definition as a version (real DB save)
  r = await req('PUT', '/api/wf/processes/' + PID, { definition: def, change_note: 'ایستگاه‌های OPC کامل' }, A);
  ok('P2 save OPC definition (version 2)', r.status === 200 && r.data.version === 2, JSON.stringify(r.data).slice(0, 80));

  // verify real persistence in DB
  const dw = new BDB(DB, { readonly: true });
  const vrow = dw.prepare('SELECT definition FROM wf_versions WHERE process_id=? AND active=1').get(PID);
  dw.close();
  let parsed = null; try { parsed = JSON.parse(vrow ? vrow.definition : 'null'); } catch {}
  ok('P3 definition persisted in DB (wf_versions)', !!parsed && parsed.nodes.length === 10 && parsed.edges.length === 11, 'nodes=' + (parsed ? parsed.nodes.length : 0));
  const nStock = parsed && parsed.nodes.find(n => n.id === 'n_stock');
  ok('P4 station model persisted (module/op/input/output/assignee)', !!(nStock && nStock.module === 'purchase_order' && nStock.op === 'storage' && nStock.input_desc && nStock.output_desc && nStock.assignee === 'warehouse_manager'), JSON.stringify(nStock));

  // ---------- 3. definition validation (reject bad defs) ----------
  const bad1 = JSON.parse(JSON.stringify(def)); const appr = bad1.nodes.find(n => n.id === 'n_appr'); appr.assignee_type = 'none';
  r = await req('PUT', '/api/wf/processes/' + PID, { definition: bad1 }, A);
  ok('V1 approval node without assignee rejected → 422', r.status === 422, 'status=' + r.status);
  const bad2 = JSON.parse(JSON.stringify(def)); bad2.edges[2].label = '<img src=x onerror=alert(1)>';
  r = await req('PUT', '/api/wf/processes/' + PID, { definition: bad2 }, A);
  ok('V2 invalid (XSS) edge label rejected → 422', r.status === 422, 'status=' + r.status);
  const bad3 = JSON.parse(JSON.stringify(def)); bad3.nodes = bad3.nodes.filter(n => n.type !== 'end');
  r = await req('PUT', '/api/wf/processes/' + PID, { definition: bad3 }, A);
  ok('V3 definition without end node → 422', r.status === 422, 'status=' + r.status);
  const bad4 = JSON.parse(JSON.stringify(def)); bad4.edges = bad4.edges.filter(e => e.from !== 'n_pay' && e.from !== 'n_inv' && !(e.from === 'n_cond' && e.label === 'false') && !(e.from === 'n_appr' && e.label === 'reject'));
  r = await req('PUT', '/api/wf/processes/' + PID, { definition: bad4 }, A);
  ok('V4 unreachable end (no path start→end) → 422', r.status === 422, 'status=' + r.status);
  r = await req('PUT', '/api/wf/processes/' + PID, { definition: def, change_note: 'بازگشت به نسخهٔ صحیح' }, A);
  ok('V5 valid re-save OK', r.status === 200, 'status=' + r.status);

  // ---------- 4. real customer creation → auto-start instance (trigger 'created') ----------
  r = await req('POST', '/api/r/customer', { name: 'شرکت آبی ' + stamp, type: 'company', tax_code: '120' + NUM, phone: '0912' + NUM, city: 'اهواز', salesperson_id: 4 }, A);
  ok('C1 customer created', r.status === 200 && r.data.id, JSON.stringify(r.data).slice(0, 80));
  const CUST = r.data.id;
  await new Promise(s => setTimeout(s, 300));
  r = await req('GET', '/api/wf/entity/customer/' + CUST + '/instances', undefined, A);
  const mine1 = (r.data.items || []).filter(i => i.process_id === Number(PID));
  ok('C2 instance auto-started on customer creation (trigger=created)', r.status === 200 && mine1.length === 1 && ['running', 'waiting', 'pending'].includes(mine1[0].status), JSON.stringify(r.data).slice(0, 120));
  const INST = mine1[0] && mine1[0].id;
  ok('C3 instance current station = first task (ثبت / بررسی مشتری)', mine1[0] && mine1[0].current_node_title === 'ثبت / بررسی مشتری', 'cur=' + (mine1[0] && mine1[0].current_node_title));

  // ---------- 5. step execution with real RBAC ----------
  const activeStep = async (iid) => {
    const g = await req('GET', '/api/wf/instances/' + iid, undefined, A);
    if (!g.data || !g.data.instance) throw new Error('activeStep: no instance in response: ' + JSON.stringify(g).slice(0, 300));
    const s = (g.data.instance.steps || []).find(s => s.status === 'active' && !s.parent_id);
    return { inst: g.data.instance, step: s };
  };
  const complete = async (iid, sid, tok, result, note) => req('POST', `/api/wf/instances/${iid}/step/${sid}/complete`, { result: result || 'complete', note: note || '' }, tok);

  // 5a. unauthorized user (support) cannot complete a sales-assigned station
  let s = await activeStep(INST);
  ok('S1 first active step exists (ایستگاه فعلی)', !!s.step && s.step.node_id === 'n_cust', 'step=' + (s.step && s.step.node_id));
  r = await complete(INST, s.step.id, T.sup.tok, 'complete');
  ok('S2 non-assigned user (support) completes → 403 FORBIDDEN', r.status === 403, 'status=' + r.status);
  // instance must not have moved
  s = await activeStep(INST);
  ok('S3 instance did not advance after 403', s.step && s.step.node_id === 'n_cust', 'cur=' + (s.step && s.step.node_id));

  // 5b. sales user completes customer station → advances to quote station
  r = await complete(INST, s.step.id, T.sales.tok, 'complete', 'مشتری بررسی شد');
  ok('S4 sales completes station 1', r.status === 200 && r.data.ok, JSON.stringify(r.data).slice(0, 80));
  s = await activeStep(INST);
  ok('S5 advanced to «ثبت پیش‌فاکتور»', s.step && s.step.node_id === 'n_quote', 'cur=' + (s.step && s.step.node_id));

  // 5c. quote station → condition (customer active → true branch)
  r = await complete(INST, s.step.id, T.sales.tok, 'complete');
  ok('S6 sales completes station 2', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  s = await activeStep(INST);
  ok('S7 condition auto-routed to approval (true branch)', s.step && s.step.node_id === 'n_appr', 'cur=' + (s.step && s.step.node_id));

  // 5d. approval by someone who is NOT sales_manager → 403
  r = await complete(INST, s.step.id, T.fin.tok, 'approve');
  ok('S8 finance user cannot approve sales approval → 403', r.status === 403, 'status=' + r.status);
  // 5e. sales_manager approves → order station
  s = await activeStep(INST);
  r = await complete(INST, s.step.id, T.sm.tok, 'approve', 'تأیید شد');
  ok('S9 sales_manager approves', r.status === 200 && r.data.ok, JSON.stringify(r.data).slice(0, 80));
  s = await activeStep(INST);
  ok('S10 advanced to «تبدیل به سفارش»', s.step && s.step.node_id === 'n_order', 'cur=' + (s.step && s.step.node_id));

  // 5f. order → warehouse (storage op) → invoice → payment → end
  r = await complete(INST, s.step.id, T.sales.tok, 'complete');
  s = await activeStep(INST);
  ok('S11 advanced to «آماده‌سازی انبار» (storage op)', s.step && s.step.node_id === 'n_stock', 'cur=' + (s.step && s.step.node_id));
  r = await complete(INST, s.step.id, T.wh.tok, 'complete');
  s = await activeStep(INST);
  ok('S12 warehouse completes → «صدور فاکتور»', s.step && s.step.node_id === 'n_inv', 'cur=' + (s.step && s.step.node_id));
  r = await complete(INST, s.step.id, T.fin.tok, 'complete');
  s = await activeStep(INST);
  ok('S13 finance completes → «ثبت پرداخت»', s.step && s.step.node_id === 'n_pay', 'cur=' + (s.step && s.step.node_id));
  r = await complete(INST, s.step.id, T.fin.tok, 'complete', 'پرداخت دریافت شد');
  s = await activeStep(INST);
  ok('S14 payment done → instance COMPLETED', s.inst.status === 'completed', 'status=' + s.inst.status);

  // step history (process control trail)
  const g = await req('GET', '/api/wf/instances/' + INST, undefined, A);
  const hist = (g.data.instance.steps || []).filter(x => x.status === 'completed' || x.status === 'approved' || x.note);
  ok('S15 full step trail recorded (≥7 steps)', hist.length >= 7, 'trail=' + hist.length);

  // ---------- 6. reject branch: second customer, manager rejects at approval ----------
  r = await req('POST', '/api/r/customer', { name: 'شرکت سبز ' + stamp, type: 'company', tax_code: '121' + NUM, phone: '0913' + NUM, city: 'اهواز', salesperson_id: 4 }, A);
  ok('C4 second customer created (reject branch)', r.status === 200 && r.data.id, JSON.stringify(r.data).slice(0, 80));
  const CUST2 = r.data && r.data.id;
  await new Promise(s => setTimeout(s, 300));
  r = await req('GET', '/api/wf/entity/customer/' + CUST2 + '/instances', undefined, A);
  const mine2 = (r.data.items || []).filter(i => i.process_id === Number(PID));
  const INST2 = mine2[0] && mine2[0].id;
  ok('J1 second instance auto-started', !!INST2, 'items=' + ((r.data.items) || []).length);
  if (INST2) {
    let s2 = await activeStep(INST2);
    await complete(INST2, s2.step.id, T.sales.tok, 'complete');
    s2 = await activeStep(INST2);
    await complete(INST2, s2.step.id, T.sales.tok, 'complete');
    s2 = await activeStep(INST2);
    ok('J2 reached approval station', s2.step && s2.step.node_id === 'n_appr', 'cur=' + (s2.step && s2.step.node_id));
    if (s2.step) {
      r = await complete(INST2, s2.step.id, T.sm.tok, 'reject', 'حاشیهٔ سود مناسب نیست');
      s2 = await activeStep(INST2);
      ok('J3 reject → instance status=rejected (went to end)', s2.inst.status === 'rejected', 'status=' + s2.inst.status);
    }
  }

  // ---------- 7. bad entity guard ----------
  r = await req('POST', '/api/wf/entity/customer/99999999/start', {}, A);
  ok('E1 start instance on nonexistent entity → 404', r.status === 404, 'status=' + r.status);

  // ---------- 8. process enable/disable ----------
  r = await req('POST', '/api/wf/processes/' + PID + '/toggle', { active: false }, A);
  ok('D1 deactivate process', r.status === 200, 'status=' + r.status);
  r = await req('POST', '/api/r/customer', { name: 'شرکت کهربایی ' + stamp, type: 'company', tax_code: '122' + NUM, phone: '0914' + NUM }, A);
  const CUST3 = r.data && r.data.id;
  await new Promise(s => setTimeout(s, 200));
  r = await req('GET', '/api/wf/entity/customer/' + CUST3 + '/instances', undefined, A);
  const mine3 = (r.data.items || []).filter(i => i.process_id === Number(PID));
  ok('D2 no auto-start while process inactive (own process)', mine3.length === 0, 'items=' + r.data.items.length + ' own=' + mine3.length);
  await req('POST', '/api/wf/processes/' + PID + '/toggle', { active: true }, A);

  // ---------- cleanup (API-based; API keeps FKs consistent) ----------
  const delCust = async (id) => { if (id) await req('DELETE', '/api/r/customer/' + id + '?hard=1', undefined, A); };
  await delCust(CUST); await delCust(CUST2); await delCust(CUST3);
  // terminate any running instances so the process can be deleted
  const rl = await req('GET', '/api/wf/instances?module=customer', undefined, A);
  for (const i of ((rl.data && rl.data.items) || []).filter(x => x.process_id === Number(PID) && x.status === 'running')) await req('POST', '/api/wf/instances/' + i.id + '/terminate', {}, A);
  await req('DELETE', '/api/wf/processes/' + PID, undefined, A);
  for (const [k] of Object.entries(T)) {
    const dw3 = new BDB(DB, { readonly: true }); const row = dw3.prepare('SELECT id FROM users WHERE username=?').get('opc_' + k + '_' + stamp); dw3.close();
    if (row) await req('DELETE', '/api/admin/users/' + row.id + '?hard=1', undefined, A);
  }
  const left = new BDB(DB, { readonly: true });
  // delete protection: a process with execution history is archived (active=0), not hard-deleted
  const leftoverProcsActive = left.prepare('SELECT COUNT(*) c FROM wf_processes WHERE name LIKE ? AND active=1').get('فرآیند فروش (OPC تست %').c;
  const leftoverUsers = left.prepare('SELECT COUNT(*) c FROM users WHERE username LIKE ?').get('opc_%' + stamp).c;
  const leftoverCust = left.prepare('SELECT COUNT(*) c FROM customers WHERE name LIKE ?').get('%' + stamp + '%').c;
  left.close();
  ok('CL cleanup: test process removed or archived (deletion protection)', leftoverProcsActive === 0, 'active-left=' + leftoverProcsActive);
  ok('CL cleanup: test users removed', leftoverUsers === 0, 'left=' + leftoverUsers);
  ok('CL cleanup: test customers removed', leftoverCust === 0, 'left=' + leftoverCust);

  console.log('\n=====================================');
  console.log('OPC E2E: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('ALL OPC TESTS PASSED ✅');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
