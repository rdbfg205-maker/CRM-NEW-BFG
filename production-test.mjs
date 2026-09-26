// STAGE 4 — Production mode test (server must run with NODE_ENV=production HOST=127.0.0.1)
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
async function req(method, path, body, tok, headers = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof Buffer)) h['content-type'] = 'application/json';
  if (tok) h['authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (body instanceof Buffer ? body : JSON.stringify(body)) });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers, text };
}

// the login rate limiter (10/min/IP — a security feature) needs a quiet window
// before this suite's login-heavy sections (repeated runs otherwise get 429)
console.log('waiting 62s for the login rate-limit window to clear…');
await new Promise(r => setTimeout(r, 62000));

// ---------- 1. bind: loopback only ----------
{
  const lines = execSync("ss -ltnp 2>/dev/null | grep ':3000 ' || true").toString().split('\n').filter(Boolean);
  const appLine = lines.find(l => /node.*pid=|users:\(\("node"/.test(l)) || lines[0] || '';
  const appOnly = /127\.0\.0\.1:3000/.test(appLine);
  // app socket must not be on 0.0.0.0/[::] (sandbox infra sockets on 169.254.* are excluded — they have no node process)
  const exposed = lines.filter(l => !/node/.test(l) && /169\.254\./.test(l)).length; // infra-only lines (informational)
  const badBind = lines.some(l => /node/.test(l) && !/127\.0\.0\.1:3000/.test(l));
  ok('N1 app socket bound to 127.0.0.1 only (no 0.0.0.0/[::] app listener)', appOnly && !badBind, appLine.trim() + (exposed ? ' | sandbox-infra sockets: ' + exposed : ''));
}

// ---------- 2. health check ----------
{
  const h = await fetch(BASE + '/health');
  const body = await h.text();
  const j = JSON.parse(body);
  ok('H1 /health → 200 {status:ok, db:true}', h.status === 200 && j.status === 'ok' && j.db === true, body.slice(0, 80));
  ok('H2 /healthz alias works', (await fetch(BASE + '/healthz')).status === 200);
  const leak = /baspar-crm\.sqlite|\/var\/|\/home\/|password|secret/i.test(body);
  ok('H3 /health leaks no sensitive data (paths/secrets)', !leak, body.slice(0, 80));
  ok('H4 /health no-cache', (h.headers.get('cache-control') || '').includes('no-store'));
}

// ---------- 3. TLS simulation: Secure cookies behind proxy ----------
{
  const r = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' }, null, { 'x-forwarded-proto': 'https' });
  const sc = r.headers.get('set-cookie') || '';
  ok('T1 behind TLS → Secure cookie', r.status === 200 && /Secure/i.test(sc), sc.slice(0, 90));
  const r2 = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const sc2 = r2.headers.get('set-cookie') || '';
  ok('T2 plain HTTP → no Secure flag (dev behavior intact)', r2.status === 200 && !/Secure/i.test(sc2));
}

// ---------- 4. security headers on every response class ----------
{
  const check = (r, label) => {
    const h = r.headers;
    const csp = h.get('content-security-policy') || '';
    const good = h.get('x-content-type-options') === 'nosniff'
      && !!h.get('strict-transport-security')
      && !!h.get('x-frame-options')
      && h.get('referrer-policy') === 'no-referrer'
      && csp.includes("default-src 'self'") && csp.includes("object-src 'none'");
    ok('X' + label + ' security headers on ' + label, good, (h.get('x-frame-options') || 'no-XFO'));
  };
  check(await fetch(BASE + '/'), '1 static');
  check(await req('GET', '/api/dashboard', undefined, await (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access), '2 api');
  check(await fetch(BASE + '/health'), '3 health');
}

// ---------- 5. login / session / logout in production ----------
{
  const l = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  ok('L1 login → 200 + access token', l.status === 200 && !!l.data.access);
  const A = l.data.access;
  const dash = await req('GET', '/api/dashboard', undefined, A);
  ok('L2 access token works on API (session valid)', dash.status === 200);
  const badTok = await req('GET', '/api/dashboard', undefined, 'garbage.token.here');
  ok('L3 forged/invalid token rejected 401', badTok.status === 401, 'status=' + badTok.status);
  const wrongPw = await req('POST', '/api/auth/login', { username: 'admin', password: 'nope-' + Date.now() });
  ok('L4 wrong password → 401 generic (no user enumeration)', wrongPw.status === 401 && /BAD_CREDENTIALS/.test(JSON.stringify(wrongPw.data)));
  const lo = await req('POST', '/api/auth/logout', undefined, A);
  ok('L5 logout → 200', lo.status === 200, 'status=' + lo.status);
}

// ---------- 6. database connection + CRUD in production ----------
{
  const l = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const A = l.data.access;
  const mk = await req('POST', '/api/r/customer', { name: 'ProdTest Customer', mobile: '0913' + String(Date.now() % 100000000).padStart(8, '0'), code: 'PROD-' + Date.now() }, A);
  ok('D1 CRUD create (prod)', mk.status === 200 && mk.data.id, 'id=' + (mk.data && mk.data.id));
  if (mk.data && mk.data.id) {
    const rd = await req('GET', '/api/r/customer/' + mk.data.id, undefined, A);
    ok('D2 CRUD read (prod)', rd.status === 200 && rd.data.item.id === mk.data.id);
    const dl = await req('DELETE', '/api/r/customer/' + mk.data.id + '?hard=1', undefined, A);
    ok('D3 CRUD delete (prod)', dl.status === 200);
  } else { ok('D2 CRUD read (prod)', false, 'skip'); ok('D3 CRUD delete (prod)', false, 'skip'); }
}

// ---------- 7. error handling (no stack traces in production) ----------
{
  const e1 = await fetch(BASE + '/api/r/customer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  const t1 = await e1.text();
  ok('E1 malformed JSON → 400 clean', e1.status === 400 && !/at Object|at Module|Stack|\.js:\d+/.test(t1), t1.slice(0, 60));
  const e2 = await req('GET', '/api/nonexistent-xyz', undefined, null);
  ok('E2 unknown /api → 404 clean JSON', e2.status === 404 && !/at Object|at Module/.test(e2.text));
  const e3 = await req('GET', '/api/admin/users');
  ok('E3 unauthenticated admin API → 401 clean', e3.status === 401 && !/at Object|at Module/.test(e3.text));
  ok('E4 no Server header version leak', !await (async () => { const r = await fetch(BASE + '/'); return /Node\.js\/\d/.test(r.headers.get('server') || ''); })());
}

// ---------- 8. CSRF / origin check in production ----------
{
  const evil = await req('POST', '/api/auth/login', { username: 'admin', password: 'x' }, null, { origin: 'https://evil.example' });
  ok('C1 cross-origin mutation → 403 in production', evil.status === 403 && evil.data.error.code === 'ORIGIN_MISMATCH', 'status=' + evil.status);
}

// ---------- 9. production env active ----------
{
  const r = await req('GET', '/api/admin/settings');
  ok('P1 server alive in production env (API responds)', r.status === 401 || r.status === 200);
  let envOk = false;
  try {
    // the real node process (exclude bash wrappers whose cmdline merely contains the string)
    const pid = execSync("pgrep -af 'server/server[.]js' | grep -v 'bash' | awk '{print $1}' | head -1").toString().trim();
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
    envOk = env.split('\0').includes('NODE_ENV=production') && env.split('\0').includes('HOST=127.0.0.1');
  } catch (e) { envOk = false; }
  ok('P2 process env: NODE_ENV=production + HOST=127.0.0.1', envOk);
}

console.log('\n================ STAGE 4 PRODUCTION TEST ================');
for (const [s, n, x] of results) console.log((s === 'PASS' ? '✅' : '❌') + ' ' + n + (x ? '  —  ' + x : ''));
console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
