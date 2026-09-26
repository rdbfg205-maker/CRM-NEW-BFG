// Section 10 — WORKFLOW/PROCESS audit test (real, no mocks).
// Verifies: (1) editing a process definition (new version) ACTUALLY affects a running
// instance (it continues with the new step), (2) process changes are admin-only
// (permission), (3) changes are audited in audit_logs. Cleans up.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'WF' + String(Date.now()).slice(-5);
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function req(method, path, a, b) {
  const isGet = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  const body = isGet ? undefined : a;
  const token = isGet ? a : b;
  const h = {};
  if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers: h, body: (body !== undefined && body !== null) ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t };
}
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };

const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }
const M = (await req('POST', '/api/auth/login', { username: 'saeid.t', password: '12345678' })).data.access; // low-priv (lab)
if (!M) { console.log('FATAL: saeid.t login failed'); process.exit(2); }

const G = { proc: null, inst: null, complaint: null };
try {
  // ---------- process v1: start → task A → end ----------
  const defV1 = {
    nodes: [
      { id: 'start', type: 'start', title: 'شروع', x: 40, y: 120 },
      { id: 'A', type: 'task', title: 'مرحله A — بررسی اولیه', x: 240, y: 120, assignee_type: 'none' },
      { id: 'end', type: 'end', title: 'پایان', x: 460, y: 120 },
    ],
    edges: [{ from: 'start', to: 'A' }, { from: 'A', to: 'end' }],
  };
  // trigger_event 'manual' so complaint creation does not auto-start THIS process
  // (an existing active complaint-SLA process may still auto-start — cleaned up below)
  let r = await req('POST', '/api/wf/processes', { name: 'فرآیند تست S10 ' + STAMP, module: 'complaint', definition: defV1, trigger_event: 'manual', change_note: 'v1' }, A);
  G.proc = r.data && r.data.id;
  ok('W1 admin creates process v1 (task A)', r.status === 200 && !!G.proc, 'proc=' + G.proc);

  // complaint entity + start instance
  const cust = (await req('POST', '/api/r/customer', { name: 'مشتری WF ' + STAMP, type: 'company' }, A)).data.id;
  G.cust = cust;
  const comp = (await req('POST', '/api/r/complaint', { customer_id: cust, subject: 'شکایت WF ' + STAMP, priority: 'high', status: 'new' }, A)).data.id;
  G.complaint = comp;
  r = await req('POST', `/api/wf/processes/${G.proc}/start-entity`, { entity_id: comp }, A);
  G.inst = r.data && r.data.instance;
  ok('W2 instance started on real complaint entity', r.status === 200 && !!G.inst, 'inst=' + G.inst + ' ' + (r.data && r.data.status));
  let inst = (await req('GET', '/api/wf/instances/' + G.inst, A)).data.instance;
  ok('W3 active step is v1 step A', inst.status === 'running' && (inst.steps || []).some(s => s.node_id === 'A' && s.status === 'active'), JSON.stringify((inst.steps || []).map(s => s.node_id + ':' + s.status)));

  // ---------- permission: low-priv user cannot change the process ----------
  r = await req('PUT', `/api/wf/processes/${G.proc}`, { definition: defV1, change_note: 'hacked' }, M);
  ok('W4 non-admin (lab role) CANNOT save a process version → 403', r.status === 403, 'status=' + r.status);

  // ---------- process v2: start → A → B → end (a NEW step inserted) ----------
  const defV2 = {
    nodes: [
      { id: 'start', type: 'start', title: 'شروع', x: 40, y: 120 },
      { id: 'A', type: 'task', title: 'مرحله A — بررسی اولیه', x: 220, y: 120, assignee_type: 'none' },
      { id: 'B', type: 'task', title: 'مرحله B — مرحله جدید', x: 420, y: 120, assignee_type: 'none' },
      { id: 'end', type: 'end', title: 'پایان', x: 600, y: 120 },
    ],
    edges: [{ from: 'start', to: 'A' }, { from: 'A', to: 'B' }, { from: 'B', to: 'end' }],
  };
  r = await req('PUT', `/api/wf/processes/${G.proc}`, { definition: defV2, change_note: 'افزودن مرحله B' }, A);
  ok('W5 admin saves version 2 (new step B)', r.status === 200 && r.data.version === 2, JSON.stringify(r.data));

  // ---------- the RUNNING instance must now follow the new definition ----------
  const stepA = (await req('GET', '/api/wf/instances/' + G.inst, A)).data.instance.steps.find(s => s.node_id === 'A' && s.status === 'active');
  ok('W6 step A still active before completion', !!stepA, 'step=' + (stepA && stepA.id));
  r = await req('POST', `/api/wf/instances/${G.inst}/step/${stepA.id}/complete`, { result: 'complete', note: 'A complete' }, A);
  ok('W7 completing step A advances instance USING the NEW definition', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  inst = (await req('GET', '/api/wf/instances/' + G.inst, A)).data.instance;
  ok('W8 running instance now has the NEW step B active (change affected the process)', inst.status === 'running' && (inst.steps || []).some(s => s.node_id === 'B' && s.status === 'active'), JSON.stringify((inst.steps || []).map(s => s.node_id + ':' + s.status)));

  // ---------- terminate + audit ----------
  r = await req('POST', `/api/wf/instances/${G.inst}/terminate`, {}, A);
  ok('W9 admin terminates the instance', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  const audP = (action) => q1("SELECT COUNT(*) c FROM audit_logs WHERE entity='workflow' AND entity_id=? AND action=?", G.proc, action).c;
  const audI = (action) => q1("SELECT COUNT(*) c FROM audit_logs WHERE entity='workflow' AND entity_id=? AND action=?", G.inst, action).c;
  ok('W10 process create + save_version + terminate are AUDITED', (audP('create') || 0) >= 1 && (audP('save_version') || 0) >= 1 && (audI('terminate') || 0) >= 1, `create=${audP('create')} save=${audP('save_version')} term=${audI('terminate')}`);

  // invalid definition must be rejected (validation)
  r = await req('PUT', `/api/wf/processes/${G.proc}`, { definition: { nodes: [{ id: 'start', type: 'start' }], edges: [] }, change_note: 'bad' }, A);
  ok('W11 invalid definition (no end node) rejected → 422', r.status === 422, 'status=' + r.status);
} catch (err) {
  ok('suite completed without unexpected crash', false, (err.stack || String(err)).slice(0, 300));
}

(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
  // clean up ANY instances (incl. the pre-existing complaint-SLA process auto-started for our complaint)
  if (G.complaint) {
    del("DELETE FROM wf_steps WHERE instance_id IN (SELECT id FROM wf_instances WHERE entity_id=?)", G.complaint);
    del("DELETE FROM wf_instances WHERE entity_id=?", G.complaint);
  }
  if (G.proc) {
    del("DELETE FROM wf_steps WHERE instance_id IN (SELECT id FROM wf_instances WHERE process_id=?)", G.proc);
    del("DELETE FROM wf_instances WHERE process_id=?", G.proc);
    del("DELETE FROM wf_versions WHERE process_id=?", G.proc);
    del("DELETE FROM wf_processes WHERE id=?", G.proc);
  }
  if (G.complaint) del('DELETE FROM complaints WHERE id=?', G.complaint);
  if (G.cust) del('DELETE FROM customers WHERE id=?', G.cust);
  d.close();
  console.log('cleanup done');
  console.log('\n========== WORKFLOW AUDIT (SECTION 10) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 140) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
