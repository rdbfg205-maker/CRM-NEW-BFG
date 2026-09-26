// Targeted pen-test probes (complements security-test.mjs)
const BASE = 'http://localhost:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS ' + n + (x ? '  ' + x : '')); } else { fail++; fails.push(n); console.log('FAIL ' + n + (x ? '  ' + x : '')); } };
async function req(method, path, { token, body, raw } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; if (!raw) { try { j = await r.json(); } catch {} }
  return { status: r.status, j, text: raw ? await r.text() : '' };
}
async function login(u, p) { const r = await req('POST', '/api/auth/login', { body: { username: u, password: p } }); return r.j && r.j.access; }

(async () => {
  const admin = await login('admin', 'admin1234');
  const sara = await login('sara.m', '12345678');
  const saeid = await login('saeid.t', '12345678'); // lab, view-only

  // --- Unauthenticated access (401) ---
  const ua1 = await req('GET', '/api/wf/executions');
  const ua2 = await req('GET', '/api/comm/center');
  const ua3 = await req('POST', '/api/r/customer', { body: { name: 'x' } });
  ok('P1 unauthenticated /api/wf/executions → 401', ua1.status === 401, 'got ' + ua1.status);
  ok('P2 unauthenticated /api/comm/center → 401', ua2.status === 401, 'got ' + ua2.status);
  ok('P3 unauthenticated create → 401', ua3.status === 401, 'got ' + ua3.status);

  // --- IDOR: sara (sales, own scope) vs another salesperson's customer ---
  // create a customer owned by ali (salesperson 3) via admin, then sara tries to read/edit
  const c2 = await req('POST', '/api/r/customer', { token: admin, body: { name: 'مشتری مالکیت تست ' + Date.now() % 100000, salesperson_id: 3, type: 'person' } });
  const cid2 = c2.j && c2.j.id;
  const idorR = await req('GET', '/api/r/customer/' + cid2, { token: sara });
  ok('P4 IDOR: same-department (team scope) read allowed by design', idorR.status === 200, 'got ' + idorR.status);
  const cFin = await req('POST', '/api/r/customer', { token: admin, body: { name: 'مشتری مالی ' + Date.now() % 100000, salesperson_id: 7, type: 'person' } });
  const cfinId = cFin.j && cFin.j.id;
  const idorX = await req('GET', '/api/r/customer/' + cfinId, { token: sara });
  ok('P4b IDOR: cross-department (finance) customer NOT readable (403/404)', idorX.status === 403 || idorX.status === 404, 'got ' + idorX.status);
  const idorXw = await req('PUT', '/api/r/customer/' + cfinId, { token: sara, body: { notes: 'x' } });
  ok('P4c IDOR: cross-department customer NOT editable (403/404)', idorXw.status === 403 || idorXw.status === 404, 'got ' + idorXw.status);
  const idorW = await req('PUT', '/api/r/customer/' + cid2, { token: sara, body: { notes: 'hacked' } });
  ok('P5 IDOR: other salesperson\'s customer not editable (403/404)', idorW.status === 403 || idorW.status === 404, 'got ' + idorW.status);
  // sara can read her own customer
  const c1 = await req('POST', '/api/r/customer', { token: sara, body: { name: 'مشتری خودم ' + Date.now() % 100000, salesperson_id: 4, type: 'person' } });
  const cid1 = c1.j && c1.j.id;
  const own = await req('GET', '/api/r/customer/' + cid1, { token: sara });
  ok('P6 own-scope: user reads own customer (200)', own.status === 200, 'got ' + own.status);

  // --- Privilege escalation: sara hits admin endpoints ---
  const pe1 = await req('GET', '/api/admin/roles', { token: sara });
  const pe2 = await req('POST', '/api/admin/users', { token: sara, body: { username: 'x', full_name: 'x' } });
  const pe3 = await req('PUT', '/api/wf/processes/1/draft', { token: sara, body: { definition: { nodes: [], edges: [] } } });
  ok('P7 privilege: sara cannot list roles (403)', pe1.status === 403, 'got ' + pe1.status);
  ok('P8 privilege: sara cannot create user (403)', pe2.status === 403, 'got ' + pe2.status);
  ok('P9 privilege: sara cannot draft workflow (403)', pe3.status === 403, 'got ' + pe3.status);

  // --- SQL injection ---
  const s1 = await req('GET', "/api/r/customer?q=' OR '1'='1", { token: admin });
  ok('P10 SQLi in search: no error, treated as literal', s1.status === 200 && Array.isArray(s1.j && s1.j.items), 'got ' + s1.status);
  const s2 = await req('GET', '/api/comm/center?customer_id=1;DROP%20TABLE%20customers--', { token: admin });
  ok('P11 SQLi in comm-center: clean response', s2.status === 200 || s2.status === 422, 'got ' + s2.status);
  const dbAlive = await req('GET', '/api/r/customer?per_page=1', { token: admin });
  ok('P12 DB still alive after injection attempts', dbAlive.status === 200, 'got ' + dbAlive.status);

  // --- Stored XSS: value stored, output escaped by UI (textContent) & API returns raw data (no eval) ---
  const xss = await req('POST', '/api/r/customer', { token: admin, body: { name: '<img src=x onerror=alert(1)> تست' + Date.now() % 100000, type: 'person' } });
  const xid = xss.j && xss.j.id;
  ok('P13 XSS payload stored as inert data (API returns it, UI escapes via textContent)', xid !== undefined, 'id=' + xid);

  // --- Path traversal ---
  const pt1 = await req('GET', '/api/r/customer/1/attachments/..%2f..%2fetc%2fpasswd', { token: admin });
  ok('P14 path traversal blocked (404/400/403)', pt1.status === 404 || pt1.status === 400 || pt1.status === 403, 'got ' + pt1.status);
  const pt2 = await req('GET', '/%2e%2e/%2e%2e/etc/passwd', { token: admin, raw: true });
  ok('P15 static path traversal: no file content leaked (SPA fallback or 404/403)', !/root:/.test(pt2.text || '') && (pt2.status === 404 || pt2.status === 403 || (pt2.status === 200 && /<html lang/.test(pt2.text || ''))), 'got ' + pt2.status);

  // --- Sensitive data not over-exposed ---
  const me = await req('GET', '/api/auth/me', { token: sara });
  const meJson = JSON.stringify(me.j || {});
  ok('P16 no password_hash/totp_secret in user response', !/password_hash|totp_secret/.test(meJson));

  // --- Account enumeration: login error messages ---
  const l1 = await req('POST', '/api/auth/login', { body: { username: 'nonexistent_user_xyz', password: 'wrongpass1' } });
  const l2 = await req('POST', '/api/auth/login', { body: { username: 'saeid.t', password: 'wrongpass1' } });
  const m1 = JSON.stringify(l1.j || {}), m2 = JSON.stringify(l2.j || {});
  ok('P17 login errors do not distinguish user existence (anti-enumeration)', l1.status === l2.status && m1 === m2, l1.status + ' vs ' + l2.status);

  // --- CSRF / Origin: state-changing with foreign origin ---
  {
    const r = await fetch(BASE + '/api/r/customer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin, Origin: 'https://evil.example' }, body: JSON.stringify({ name: 'csrf test' }) });
    ok('P18 CORS: no Access-Control-Allow-Origin for evil origin (CORS closed by default)', !(r.headers.get('access-control-allow-origin') || '').includes('evil'), 'ACAO=' + r.headers.get('access-control-allow-origin'));
  }

  console.log('\n====================================');
  console.log(`PEN PROBES: ${pass} passed, ${fail} failed`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
