'use strict';
// End-to-end test for the visual workflow builder (/api/wf/*)
const API = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra ? ':: ' + extra : ''); } }
async function req(method, path, body) {
  const h = { 'Content-Type': 'application/json' };
  if (TOK) h['Authorization'] = 'Bearer ' + TOK;
  const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; const t = await r.text(); try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
let TOK = null;
(async () => {
  // login
  let r = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  TOK = r.data && r.data.access;
  ok('login', !!TOK, JSON.stringify(r.data).slice(0, 100));
  if (!TOK) { console.log('cannot continue without token'); process.exit(1); }

  console.log('== 1. modules ==');
  r = await req('GET', '/api/wf/modules');
  ok('GET /api/wf/modules', r.status === 200 && Array.isArray(r.data.items) && r.data.items.length > 0, JSON.stringify(r.data).slice(0, 80));

  console.log('== 2. process list ==');
  r = await req('GET', '/api/wf/processes');
  ok('GET /api/wf/processes', r.status === 200 && Array.isArray(r.data.items) && r.data.items.length >= 1, JSON.stringify(r.data).slice(0, 100));
  const proc = r.data.items[0];

  console.log('== 3. process detail ==');
  r = await req('GET', '/api/wf/processes/' + proc.id);
  ok('GET /api/wf/processes/:id', r.status === 200 && r.data.process && Array.isArray(r.data.versions), JSON.stringify(r.data).slice(0, 100));
  ok('detail has definition', !!(r.data.versions && r.data.versions.length && Array.isArray(r.data.versions[0].definition.nodes)), 'versions=' + (r.data.versions||[]).length);

  console.log('== 4. designer ==');
  r = await req('GET', '/api/wf/designer/' + proc.id);
  ok('GET /api/wf/designer/:id', r.status === 200 && r.data.process, r.status);

  console.log('== 5. start an instance (complaint SLA process) ==');
  // self-contained: create a real customer + complaint (the suite may run on a clean DB)
  const cstamp = String(Date.now()).slice(-5);
  let cust = await req('GET', '/api/r/customer?per_page=1');
  let custId = cust.data && cust.data.items && cust.data.items[0] && cust.data.items[0].id;
  let createdCust = false;
  if (!custId) {
    const cc = await req('POST', '/api/r/customer', { name: 'مشتری تست WF ' + cstamp, type: 'company', tax_code: '990' + cstamp, phone: '0920' + cstamp });
    custId = cc.data && cc.data.id; createdCust = !!custId;
  }
  ok('have a customer for the complaint', !!custId, JSON.stringify(cust.data).slice(0, 60));
  const cp = await req('POST', '/api/r/complaint', { customer_id: custId, subject: 'شکایت تست WF ' + cstamp, priority: 'medium' });
  const entityId = cp.data && cp.data.id;
  ok('created a complaint entity', !!entityId, JSON.stringify(cp.data).slice(0, 80));
  // find the complaint SLA process and start an execution explicitly on it
  const procs2 = await req('GET', '/api/wf/processes');
  const slaProc = (procs2.data.items || []).find(p => p.module === 'complaint');
  ok('complaint process exists', !!slaProc, JSON.stringify(slaProc && slaProc.name));
  r = await req('POST', `/api/wf/processes/${slaProc.id}/start-entity`, { entity_id: entityId });
  ok('POST start instance (explicit process)', r.status === 200 && r.data.ok, JSON.stringify(r.data).slice(0, 100));
  const instId = r.data.instance;

  console.log('== 6. list instances ==');
  r = await req('GET', '/api/wf/instances');
  ok('GET /api/wf/instances', r.status === 200 && Array.isArray(r.data.items) && r.data.items.length >= 1, JSON.stringify(r.data).slice(0, 100));
  const inst = (r.data.items || []).find(i => i.id === instId);
  ok('instance is active (running/waiting)', inst && ['running', 'waiting', 'pending'].includes(inst.status), inst && inst.status);

  console.log('== 7. instance detail ==');
  r = await req('GET', '/api/wf/executions/' + instId);
  ok('GET /api/wf/executions/:id', r.status === 200 && r.data.instance, r.status);
  ok('instance has steps', r.data.instance && Array.isArray(r.data.steps), 'steps=' + (r.data.steps || []).length);
  const activeStep = (r.data.steps || []).find(s => s.status === 'active' && !s.parent_id);
  ok('has an active step', !!activeStep, JSON.stringify((r.data.steps||[]).map(s=>s.status)));

  console.log('== 8. complete the active step ==');
  if (activeStep) {
    r = await req('POST', `/api/wf/instances/${instId}/step/${activeStep.id}/complete`, { result: 'complete' });
    ok('POST complete step', r.status === 200 && r.data.ok, JSON.stringify(r.data).slice(0, 100));
    r = await req('GET', '/api/wf/executions/' + instId);
    ok('instance advanced (condition evaluated / next step)', r.data.instance && ['running', 'waiting', 'pending', 'completed'].includes(r.data.instance.status), r.data.instance && r.data.instance.status);
  }

  console.log('== 9. score ==');
  r = await req('GET', '/api/wf/score');
  ok('GET /api/wf/score', r.status === 200 && Array.isArray(r.data.running), r.status);

  console.log('== 10. instanceForEntity ==');
  r = await req('GET', `/api/wf/entity/complaint/${entityId}/instances`);
  ok('GET /api/wf/entity/:module/:id/instances', r.status === 200 && Array.isArray(r.data.items), r.status);

  console.log('== 11. cancel/terminate ==');
  r = await req('POST', `/api/wf/instances/${instId}/terminate`);
  ok('POST terminate', r.status === 200 && r.data.ok, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/wf/executions/' + instId);
  ok('instance terminated (cancelled in engine vocabulary)', r.data.instance && ['terminated', 'cancelled'].includes(r.data.instance.status), r.data.instance && r.data.instance.status);

  console.log('== 12. scoreForWorkflow after terminate ==');
  r = await req('GET', '/api/wf/score');
  ok('score after terminate', r.status === 200 && Array.isArray(r.data.running), r.status);

  // cleanup of self-created records
  if (entityId) await req('DELETE', '/api/r/complaint/' + entityId + '?hard=1');
  if (createdCust && custId) await req('DELETE', '/api/r/customer/' + custId + '?hard=1');

  console.log('');
  console.log('=====================================');
  console.log(`WORKFLOW E2E: ${pass} passed, ${fail} failed`);
  if (failures.length) failures.forEach(f => console.log('  -', f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
