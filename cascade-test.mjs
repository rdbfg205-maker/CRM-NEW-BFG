// Verify: hard-delete of a record terminates its bound workflow instances
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const B = 'http://127.0.0.1:3050';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, '::', x); } };
const req = async (m, p, b, tok) => {
  const h = {};
  if (b) h['content-type'] = 'application/json';
  if (tok) h.authorization = 'Bearer ' + tok;
  const r = await fetch(B + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
  let d = null; const t = await r.text(); try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
};
(async () => {
  const NUM = String(Date.now()).slice(-5);
  const lg = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = lg.data && lg.data.access;
  ok('login', !!A, JSON.stringify(lg.data).slice(0, 80));

  const cc = await req('POST', '/api/r/customer', { name: 'شرکت کسکد ' + NUM, type: 'company', tax_code: '883' + NUM, phone: '0911' + NUM }, A);
  const cid = cc.data && cc.data.id;
  ok('customer created', !!cid, JSON.stringify(cc.data).slice(0, 80));

  const cp = await req('POST', '/api/r/complaint', { customer_id: cid, subject: 'شکایت کسکد ' + NUM }, A);
  const cpid = cp.data && cp.data.id;
  ok('complaint created (auto-starts SLA process)', !!cpid, JSON.stringify(cp.data).slice(0, 100));
  await new Promise(s => setTimeout(s, 500));

  let inst = await req('GET', '/api/wf/entity/complaint/' + cpid + '/instances', undefined, A);
  // two published processes (SLA + Quality) both trigger on complaint/created;
  // instances may already be paused (waiting) on a delay node — accept any active state
  let active = (inst.data.items || []).filter(i => ['running', 'waiting', 'pending'].includes(i.status));
  ok('active instance exists after complaint create', active.length >= 1, 'active=' + active.length);

  const del = await req('DELETE', '/api/r/complaint/' + cpid + '?hard=1', undefined, A);
  ok('complaint hard-deleted', del.status === 200, 'status=' + del.status);

  const D = require('better-sqlite3');
  const d = new D('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
  const st = d.prepare('SELECT status, current_node_id FROM wf_instances WHERE module=? AND entity_id=?').all('complaint', cpid);
  d.close();
  ok('instance terminated after entity delete (no orphan running flows)', st.length > 0 && st.every(s => s.status === 'terminated' && s.current_node_id === null), JSON.stringify(st));

  const dc = await req('DELETE', '/api/r/customer/' + cid + '?hard=1', undefined, A);
  ok('customer cleanup', dc.status === 200, 'status=' + dc.status);

  console.log('CASCADE: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
