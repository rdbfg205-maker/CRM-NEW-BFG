'use strict';
// PART 3 — Security test (real API requests): 11 checks.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const BASE = process.env.BASE || 'http://127.0.0.1:3050';
const DB = '/home/user/baspar-crm/data/baspar-crm.sqlite';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; failures.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
async function req(method, path, body, tok) {
  const h = {}; if (body !== undefined) h['content-type'] = 'application/json';
  if (tok) h.authorization = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; const t = await r.text(); try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
async function login(u, p) {
  for (let i = 0; i < 4; i++) {
    const r = await req('POST', '/api/auth/login', { username: u, password: p });
    if (r.data && r.data.access) return r.data.access;
    if (r.status === 429) { await sleep(65000); continue; }
    return null;
  }
  return null;
}
const db = () => new BDB(DB, { readonly: true });
const SIG_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAIAAABLMHmGAAAAK0lEQVR4nGNgYPj/n4mBgaEdAwMDAwMDS47wP0sOB4OJgYGBgYHlP9N/pv9MDAxFGAZGAoYMDAwMDAwMDAwMDDkAAGqUB9Dzkm0pAAAAAElFTkSuQmCC';
const stamp = String(Date.now()).slice(-6);
(async () => {
  const ADMIN = await login('admin', 'admin1234');
  const SALES = await login('sara.m', '12345678');      // no workflow perms, no bulk_delete
  const SMGR = await login('ali.k', '12345678');         // workflow view/monitor/test/audit + bulk_delete (no edit/delete/publish/execute)
  const SUP = await login('maryam.h', '12345678');       // support (no workflow step roles in sales chain)
  ok('S0 all test users logged in (admin/sales/manager/support)', !!(ADMIN && SALES && SMGR && SUP), JSON.stringify({ ADMIN: !!ADMIN, SALES: !!SALES, SMGR: !!SMGR, SUP: !!SUP }));
  if (!ADMIN) { process.exit(1); }

  // create a throwaway process (admin) for publish/delete/edit tests
  const cp = await req('POST', '/api/wf/processes', { name: 'Proc SecTest ' + stamp, module: 'complaint', trigger_event: 'created' }, ADMIN);
  const PP = cp.data && cp.data.id;
  ok('S0b admin created a throwaway process', !!PP, 'status=' + cp.status);
  if (!PP) { process.exit(1); }

  // ================= S1. User WITHOUT permission (sales) =================
  let r = await req('GET', '/api/wf/processes', undefined, SALES);
  ok('S1a no-perm: list processes → 403', r.status === 403, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes', { name: 'X' + stamp, module: 'complaint' }, SALES);
  ok('S1b no-perm: create process → 403', r.status === 403, 'status=' + r.status);
  r = await req('PUT', '/api/wf/processes/' + PP + '/draft', { definition: { nodes: [], edges: [] } }, SALES);
  ok('S1c no-perm: edit(draft) process → 403', r.status === 403, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes/' + PP + '/publish', { definition: { nodes: [{ id: 's', type: 'start', title: 's' }, { id: 'e', type: 'end', title: 'e' }], edges: [{ from: 's', to: 'e' }] } }, SALES);
  ok('S1d no-perm: publish process → 403', r.status === 403, 'status=' + r.status);
  r = await req('DELETE', '/api/wf/processes/' + PP, undefined, SALES);
  ok('S1e no-perm: delete process → 403', r.status === 403, 'status=' + r.status);

  // ================= S2. User with LIMITED permission (sales_manager) =================
  r = await req('GET', '/api/wf/processes', undefined, SMGR);
  ok('S2a limited-perm: list processes → 200 (has view)', r.status === 200, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes', { name: 'Y' + stamp, module: 'complaint' }, SMGR);
  ok('S2b limited-perm: create process → 403 (no create)', r.status === 403, 'status=' + r.status);
  r = await req('PUT', '/api/wf/processes/' + PP + '/draft', { definition: { nodes: [], edges: [] } }, SMGR);
  ok('S2c limited-perm: edit(draft) → 403 (no edit)', r.status === 403, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes/' + PP + '/publish', { definition: { nodes: [{ id: 's', type: 'start', title: 's' }, { id: 'e', type: 'end', title: 'e' }], edges: [{ from: 's', to: 'e' }] } }, SMGR);
  ok('S2d limited-perm: publish → 403 (no publish)', r.status === 403, 'status=' + r.status);
  r = await req('DELETE', '/api/wf/processes/' + PP, undefined, SMGR);
  ok('S2e limited-perm: delete → 403 (no delete)', r.status === 403, 'status=' + r.status);

  // ================= S3. Admin (super_admin) =================
  r = await req('POST', '/api/wf/processes', { name: 'Proc SecTest2 ' + stamp, module: 'complaint', trigger_event: 'created' }, ADMIN);
  const PP2 = r.data && r.data.id;
  ok('S3a admin: create second process → 200', r.status === 200 && !!PP2, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes/' + PP2 + '/publish', { definition: { nodes: [{ id: 's', type: 'start', title: 's' }, { id: 'e', type: 'end', title: 'e' }], edges: [{ from: 's', to: 'e' }] } }, ADMIN);
  ok('S3b admin: publish → 200', r.status === 200, 'status=' + r.status);
  r = await req('DELETE', '/api/wf/processes/' + PP2, undefined, ADMIN);
  ok('S3c admin: delete (no history) → 200', r.status === 200, 'status=' + r.status);

  // ================= S7. Execute without permission =================
  r = await req('POST', '/api/wf/processes/' + PP + '/start-entity', { entity_id: 1 }, SALES);
  ok('S7a no-perm: execute(start-entity) → 403', r.status === 403, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes/' + PP + '/start-entity', { entity_id: 1 }, SMGR);
  ok('S7b limited-perm: execute → 403 (no execute)', r.status === 403, 'status=' + r.status);

  // ================= S8/S9. Delete/Publish without permission (reconfirm on PP) =================
  r = await req('DELETE', '/api/wf/processes/' + PP, undefined, SALES);
  ok('S8 no-perm delete → 403', r.status === 403, 'status=' + r.status);
  r = await req('POST', '/api/wf/processes/' + PP + '/publish', { definition: { nodes: [{ id: 's', type: 'start', title: 's' }, { id: 'e', type: 'end', title: 'e' }], edges: [{ from: 's', to: 'e' }] } }, SMGR);
  ok('S9 limited-perm publish → 403', r.status === 403, 'status=' + r.status);

  // ================= S5. ID tampering (IDOR) on workflow steps =================
  // Create a customer → triggers sales-chain workflow → creates an approval step (sales_manager)
  const cust = await req('POST', '/api/r/customer', { name: 'مشتری امنیتی ' + stamp, type: 'company', tax_code: '999' + stamp, phone: '063' + stamp }, ADMIN);
  const CUST = cust.data && cust.data.id;
  await sleep(2500);
  const instRow = db().prepare("SELECT id FROM wf_instances WHERE module='customer' AND entity_id=? AND status IN ('running','waiting') ORDER BY id DESC LIMIT 1").get(CUST);
  const INST = instRow && instRow.id;
  ok('S5a sales-chain execution created for customer', !!INST, 'inst=' + INST);
  let step = null;
  if (INST) {
    const d1 = db();
    step = d1.prepare("SELECT id, node_id, node_title FROM wf_steps WHERE instance_id=? AND status='active' AND parent_id IS NULL ORDER BY id DESC LIMIT 1").get(INST);
    d1.close();
  }
  ok('S5b an active workflow step exists (approval)', !!step && step.node_id === 'n_appr1', 'step=' + JSON.stringify(step));
  if (step) {
    r = await req('POST', '/api/wf/instances/' + INST + '/step/' + step.id + '/complete', { result: 'approve', note: 'IDOR attempt' }, SALES);
    ok('S5c IDOR: sales (wrong role) completes sales_manager step → 403', r.status === 403, 'status=' + r.status);
    r = await req('POST', '/api/wf/instances/' + INST + '/step/' + step.id + '/complete', { result: 'approve', note: 'IDOR attempt' }, SUP);
    ok('S5d IDOR: support (no role) completes step → 403', r.status === 403, 'status=' + r.status);
  }

  // ================= S6. Using ANOTHER user's signature =================
  // advance to the signature step (sales_manager signs)
  if (INST && step) {
    // sales_manager approves → advances to n_sig1
    r = await req('POST', '/api/wf/instances/' + INST + '/step/' + step.id + '/complete', { result: 'approve', note: 'ok' }, SMGR);
    ok('S6a sales_manager approves → advances to signature step', r.status === 200 && r.data.ok, 'status=' + r.status);
    await sleep(1500);
    const d2 = db();
    const sigStep = d2.prepare("SELECT id, node_id FROM wf_steps WHERE instance_id=? AND status='active' AND parent_id IS NULL ORDER BY id DESC LIMIT 1").get(INST);
    d2.close();
    ok('S6b signature step (n_sig1) active', !!sigStep && sigStep.node_id === 'n_sig1', 'step=' + JSON.stringify(sigStep));
    if (sigStep) {
      // support user tries to sign → 403 (cannot use/sign another role's signature step)
      r = await req('POST', '/api/wf/instances/' + INST + '/step/' + sigStep.id + '/complete', { result: 'complete', signature: SIG_DATAURL }, SUP);
      ok('S6c support cannot sign sales_manager signature step → 403', r.status === 403, 'status=' + r.status);
      // sales_manager signs with OWN signature (dataURL) → saved under own user id
      r = await req('POST', '/api/wf/instances/' + INST + '/step/' + sigStep.id + '/complete', { result: 'complete', signature: SIG_DATAURL }, SMGR);
      ok('S6d sales_manager signs with own signature → 200', r.status === 200 && r.data.ok, 'status=' + r.status);
      const d3 = db();
      const signed = d3.prepare('SELECT signature_path FROM wf_steps WHERE id=? AND signature_path != \'\'').get(sigStep.id);
      d3.close();
      // sales_manager = ali.k = user id 3. signature file must be appr_u3_... (own), NOT another user's
      const ownSig = !!(signed && signed.signature_path && /appr_u3_/.test(signed.signature_path));
      ok('S6e signature DB-backed + belongs to the signing user (own, not another user\'s)', ownSig, JSON.stringify(signed));
    }
  }

  // ================= S10. Bulk Delete without permission =================
  // ================= S10. Bulk Delete without permission (use a product: no child deps) =================
  const bp = await req('POST', '/api/r/product', { code: 'BKLDL' + stamp, name: 'کالای بولدل ' + stamp, unit: 'عدد', price_retail: 1000000 }, ADMIN);
  const BPID = bp.data && bp.data.id;
  ok('S10-prem product created for bulk-delete test', !!BPID, 'status=' + bp.status);
  if (BPID) {
    r = await req('POST', '/api/r/product/bulk/delete', { ids: [BPID], confirm: true }, SALES);
    ok('S10a no-perm (sales, no bulk_delete) bulk delete -> 403', r.status === 403, 'status=' + r.status);
    r = await req('POST', '/api/r/product/bulk/delete', { ids: [BPID], confirm: true }, SMGR);
    ok('S10b sales_manager (no product:delete) bulk delete -> 403 (resource scope)', r.status === 403, 'status=' + r.status);
    const r3 = await req('POST', '/api/r/product/bulk/delete', { ids: [BPID], confirm: true }, ADMIN);
    ok('S10c admin (super_admin, has both) bulk delete -> 200', r3.status === 200, 'status=' + r3.status + ' ' + JSON.stringify(r3.data).slice(0, 60));
  }


  // ================= S11. Direct access to private files =================
  // DB file via web → 403/404
  let rr = await fetch(BASE + '/data/baspar-crm.sqlite');
  ok('S11a direct /data/baspar-crm.sqlite → 403/404', rr.status === 403 || rr.status === 404, 'status=' + rr.status);
  rr = await fetch(BASE + '/%2e%2e/data/baspar-crm.sqlite');
  ok('S11b path traversal /%2e%2e/data/... → 403/404', rr.status === 403 || rr.status === 404, 'status=' + rr.status);
  // another user's signature via admin endpoint as non-admin → 403
  r = await req('GET', '/api/admin/users/3/signature', undefined, SALES);
  ok('S11c non-admin reads another user\'s signature → 403', r.status === 403, 'status=' + r.status);
  r = await req('GET', '/api/admin/users/3/signature', undefined, ADMIN);
  ok('S11d admin reads a user\'s signature → 200', r.status === 200, 'status=' + r.status);

  // cleanup
  await req('DELETE', '/api/wf/processes/' + PP, undefined, ADMIN);
  if (INST) { await req('POST', '/api/wf/instances/' + INST + '/terminate', undefined, ADMIN); }
  await req('DELETE', '/api/r/customer/' + CUST + '?hard=1', undefined, ADMIN);

  console.log('\n=====================================');
  console.log('SECURITY TEST: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('ALL SECURITY CHECKS PASSED ✅');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
