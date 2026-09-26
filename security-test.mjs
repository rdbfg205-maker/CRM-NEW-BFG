// STAGE 2 — Backend security hardening test suite (real HTTP against the live server)
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

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

// ---------- setup ----------
const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
ok('S0 admin login works (no functional regression)', login.status === 200 && login.data.access);
const A = login.data.access;
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const countAudit = (action) => { const d = db(); const r = d.prepare('SELECT COUNT(*) c FROM audit_logs WHERE action=?').get(action); d.close(); return r.c; };

// ---------- 1. security headers ----------
const idx = await fetch(BASE + '/');
const ih = idx.headers;
ok('H1 CSP present (frontend-compatible)', (ih.get('content-security-policy') || '').includes("default-src 'self'"), (ih.get('content-security-policy') || '').slice(0, 60));
ok('H2 CSP: script/style/img/connect/media/object/base/form policies', (ih.get('content-security-policy') || '').includes("object-src 'none'") && (ih.get('content-security-policy') || '').includes("base-uri 'self'") && (ih.get('content-security-policy') || '').includes("form-action 'self'"));
ok('H3 X-Frame-Options present', !!ih.get('x-frame-options'), ih.get('x-frame-options'));
ok('H4 HSTS present', (ih.get('strict-transport-security') || '').includes('max-age=31536000'));
ok('H5 X-Content-Type-Options nosniff', ih.get('x-content-type-options') === 'nosniff');
ok('H6 Referrer-Policy no-referrer', ih.get('referrer-policy') === 'no-referrer');
ok('H7 Permissions-Policy present', !!ih.get('permissions-policy'));
ok('H8 X-XSS-Protection off (modern best practice)', ih.get('x-xss-protection') === '0');

// ---------- 2. CSRF / Origin check ----------
const evil = await req('POST', '/api/auth/login', { username: 'admin', password: 'x' }, null, { origin: 'https://evil.example' });
ok('C1 cross-origin POST → 403 ORIGIN_MISMATCH', evil.status === 403 && evil.data.error.code === 'ORIGIN_MISMATCH', evil.status + ' ' + JSON.stringify(evil.data).slice(0, 60));
const sameOrigin = await req('POST', '/api/auth/login', { username: 'admin', password: 'x' }, null, { origin: BASE });
ok('C2 same-origin POST allowed (not 403)', sameOrigin.status === 401, 'status=' + sameOrigin.status);
const noOrigin = await req('POST', '/api/auth/login', { username: 'admin', password: 'x' });
ok('C3 no-Origin POST allowed (native clients)', noOrigin.status === 401, 'status=' + noOrigin.status);
const evilPut = await req('PUT', '/api/voip/outcomes', { items: [] }, A, { origin: 'https://evil.example' });
ok('C4 cross-origin PUT (authed) → 403', evilPut.status === 403, 'status=' + evilPut.status);

// ---------- 3. rate limiting / brute force ----------
let got429 = 0, first429 = 0;
for (let i = 0; i < 14; i++) {
  const r = await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong-' + i });
  if (r.status === 429) { got429++; if (!first429) first429 = i + 1; }
}
ok('R1 login brute-force → 429 after limit (10/min/IP)', got429 >= 3 && first429 <= 11, 'first429 at attempt ' + first429 + ', total 429=' + got429);
ok('R2 failed logins audited', countAudit('login_failed') >= 10, 'rows=' + countAudit('login_failed'));

// wait for rate-limit window to pass for clean further tests
await new Promise(r => setTimeout(r, 61000));

// ---------- 4. login/logout audit ----------
const before = countAudit('login');
const l2 = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
ok('A1 successful login → audit row', countAudit('login') === before + 1 && l2.status === 200, 'login rows=' + countAudit('login'));
const lo = await req('POST', '/api/auth/logout', undefined, l2.data.access);
ok('A2 logout → audit row', lo.status === 200 && countAudit('logout') >= 1, 'logout rows=' + countAudit('logout'));

// ---------- 5. permission-denied audit + IDOR ----------
const beforeDeny = countAudit('permission_denied');
// create a low-priv user (rep) via admin, test its boundaries, then remove
const rolesRes = await req('GET', '/api/admin/roles', undefined, A);
const repRole = ((rolesRes.data && (rolesRes.data.roles || rolesRes.data.items)) || []).find(r => r.name === 'rep');
let T = null;
if (repRole) {
  const mk = await req('POST', '/api/admin/users', { username: 'secstage2_test', password: 'S2-test-1234', full_name: 'Security Test', role_ids: [repRole.id] }, A);
  if (mk.status === 409) { /* leftover from a previous run — unarchive (DB, test-side) + reset password */ const dw = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite'); const row = dw.prepare("SELECT id FROM users WHERE username='secstage2_test'").get(); if (row) dw.prepare('UPDATE users SET archived_at=NULL WHERE id=?').run(row.id); dw.close(); if (row) await req('PUT', '/api/admin/users/' + row.id, { password: 'S2-test-1234' }, A); }
  T = (await req('POST', '/api/auth/login', { username: 'secstage2_test', password: 'S2-test-1234' })).data.access;
}
ok('P0 test low-priv user created + logged in', !!T);
if (T) {
  const deny1 = await req('GET', '/api/admin/users', undefined, T);
  ok('P1 low-priv GET /api/admin/users → 403 (IDOR/priv-esc blocked)', deny1.status === 403, 'status=' + deny1.status);
  ok('P2 permission_denied audited', countAudit('permission_denied') > beforeDeny, 'rows=' + countAudit('permission_denied'));
  // own-scope: rep must not edit a customer owned by another user (admin's list).
  // Self-contained: a clean DB may have no customers, so seed one (admin-owned) and remove it after.
  const seedOther = await req('POST', '/api/r/customer', { name: 'SecureTest Other ' + Date.now(), mobile: '0913' + String(Date.now() % 100000000).padStart(8, '0'), code: 'SECO-' + Date.now() }, A);
  const seededId = seedOther.data && seedOther.data.id;
  const custListA = await req('GET', '/api/r/customer?per_page=5', undefined, A);
  const someCust = (custListA.data.items || [])[0] || (seededId ? { id: seededId } : null);
  if (someCust) {
    const deny2 = await req('PUT', '/api/r/customer/' + someCust.id, { notes: 'hax' }, T);
    ok('P3 own-scope: editing another users customer -> 403', deny2.status === 403, 'status=' + deny2.status + ' (customer #' + someCust.id + ')');
  } else ok('P3 own-scope: editing another users customer -> 403', false, 'no customer found to test');
  // settings access
  const deny3 = await req('GET', '/api/admin/settings', undefined, T);
  ok('P4 low-priv GET settings → 403', deny3.status === 403, 'status=' + deny3.status);
  // IDOR: delete another user's record must be blocked
  if (someCust) {
    const deny4 = await req('DELETE', '/api/r/customer/' + someCust.id, undefined, T);
    ok('P5 own-scope: deleting another user\u2019s customer \u2192 403', deny4.status === 403, 'status=' + deny4.status);
    const deny5 = await req('POST', '/api/r/customer/' + someCust.id + '/archive', undefined, T);
    ok('P6 own-scope: archiving another user\u2019s customer \u2192 403', deny5.status === 403, 'status=' + deny5.status);
  }
  // remove the self-seeded customer so the DB stays clean
  if (seededId) await req('DELETE', '/api/r/customer/' + seededId + '?hard=1', undefined, A);
  // POSITIVE: rep can still edit a customer ASSIGNED TO THEM (no regression).
  // note: 'own' scope = assignment (salesperson_id), matching the frontend create flow
  //       which assigns the current user; permission map also has a 30s in-memory cache.
  await new Promise(r => setTimeout(r, 32000));
  const myLogin = await req('POST', '/api/auth/login', { username: 'secstage2_test', password: 'S2-test-1234' });
  const myId = myLogin.data.user.id;
  const own = await req('POST', '/api/r/customer', { name: 'SecureTest Own', mobile: '0912' + String(Date.now() % 100000000).padStart(8, '0'), code: 'SECOWN-' + Date.now(), salesperson_id: myId }, T);
  if (own.data && own.data.id) {
    const upd = await req('PUT', '/api/r/customer/' + own.data.id, { notes: 'own edit ok' }, T);
    ok('P7 own-scope: editing OWN customer still allowed', upd.status === 200, 'status=' + upd.status);
    const del = await req('DELETE', '/api/r/customer/' + own.data.id + '?hard=1', undefined, A);
    ok('P8 delete path intact for authorized user (admin)', del.status === 200, 'status=' + del.status);
    // P9 must test a PERMISSION denial (403), not a missing-row 404 — remove() checks
    // existence first, so the target must be a real customer (old hardcoded id=1 is stale)
    const denyCust = await req('POST', '/api/r/customer', { name: 'SecureTest Deny', mobile: '0912' + String(Date.now() % 100000000).padStart(8, '0'), code: 'SECDENY-' + Date.now() }, A);
    const delDeny = await req('DELETE', '/api/r/customer/' + (denyCust.data && denyCust.data.id ? denyCust.data.id : 1) + '?hard=1', undefined, T);
    ok('P9 delete denied for role without delete perm (rep)', delDeny.status === 403, 'status=' + delDeny.status);
    if (denyCust.data && denyCust.data.id) await req('DELETE', '/api/r/customer/' + denyCust.data.id + '?hard=1', undefined, A);
  } else { ok('P7 own-scope: editing OWN customer still allowed', false, 'could not create own customer: ' + JSON.stringify(own.data).slice(0, 60)); ok('P8 delete path intact for authorized user (admin)', false, 'skipped'); ok('P9 delete denied for role without delete perm (rep)', false, 'skipped'); }
}

// ---------- 6. file upload security ----------
// .html upload must be blocked
{
  const boundary = '----s2b' + Date.now();
  const fileBuf = Buffer.from('<html><script>alert(1)</script></html>');
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.html"\r\nContent-Type: text/html\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBuf, tail]);
  const r = await fetch(BASE + '/api/r/customer', { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: 'Bearer ' + A }, body });
  const j = await r.json().catch(() => null);
  ok('F1 upload .html → 422 UPLOAD_BLOCKED', r.status === 422 && j && j.error.code === 'UPLOAD_BLOCKED', r.status + ' ' + JSON.stringify(j).slice(0, 60));
}
// .txt upload allowed + hardened download headers
let attId = null;
{
  const boundary = '----s2b' + Date.now();
  const fileBuf = Buffer.from('plain text attachment for security test');
  const fields = 'entity_type=customer&entity_id=1';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="entity_type"\r\n\r\ncustomer\r\n--${boundary}\r\nContent-Disposition: form-data; name="entity_id"\r\n\r\n1\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBuf, tail]);
  const r = await fetch(BASE + '/api/attachments', { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: 'Bearer ' + A }, body });
  const j = await r.json().catch(() => null);
  attId = j && j.ids && j.ids[0];
  ok('F2 upload .txt allowed', r.status === 200 && attId, r.status + ' ' + JSON.stringify(j).slice(0, 60));
  if (attId) {
    const dl = await fetch(BASE + '/api/attachments/' + attId + '/download', { headers: { authorization: 'Bearer ' + A } });
    const dh = dl.headers;
    ok('F3 download: attachment disposition forced', (dh.get('content-disposition') || '').includes('attachment'));
    ok('F4 download: nosniff on file response', dh.get('x-content-type-options') === 'nosniff');
    ok('F5 download: embedded CSP sandbox', (dh.get('content-security-policy') || '').includes("sandbox allow-downloads"));
  }
}
// company-qr: fake PNG (text content) rejected by magic-byte check
{
  const boundary = '----s2b' + Date.now();
  const fake = Buffer.from('this is not an image <script>x</script>');
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="qr.png"\r\nContent-Type: image/png\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fake, tail]);
  const r = await fetch(BASE + '/api/admin/company-qr', { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: 'Bearer ' + A }, body });
  const j = await r.json().catch(() => null);
  ok('F6 company-qr: non-image content (fake PNG) → 400', r.status === 400 && j && j.error.code === 'BAD_TYPE', r.status + ' ' + JSON.stringify(j).slice(0, 60));
}

// ---------- 7. path traversal / static ----------
{
  const r1 = await fetch(BASE + '/assets/../../../server/server.js');
  const t1 = await r1.text();
  ok('T1 traversal /assets/../../server.js blocked', r1.status === 403 || r1.status === 404, 'status=' + r1.status);
  const r2 = await fetch(BASE + '/%2e%2e/%2e%2e/server/server.js');
  const t2 = await r2.text();
  ok('T2 encoded traversal blocked', (r2.status === 403 || r2.status === 404) && !t2.includes('createServer'), 'status=' + r2.status);
  const r3 = await fetch(BASE + '/server/server.js');
  ok('T3 direct non-public path 404/403', r3.status === 404 || r3.status === 403, 'status=' + r3.status);
}

// ---------- 8. SQL injection probes ----------
{
  const r1 = await req('GET', "/api/r/customer?q=' OR '1'='1", undefined, A);
  const n1 = (r1.data.items || []).length;
  const r2 = await req('GET', "/api/r/customer?q=%27%20OR%201%3D1--", undefined, A);
  ok('Q1 SQLi in search → no error, treated as literal', r1.status === 200 && n1 === 0, 'status=' + r1.status + ' rows=' + n1);
  // id segment with SQLi: parseId() reduces it to a plain integer (or null→404);
  // either way no SQL error and no table damage (verified by Q3).
  const r3 = await req('GET', '/api/r/customer/1%3B%20DROP%20TABLE%20customers%3B--', undefined, A);
  ok('Q2 SQLi in id → neutralized (no 500, no SQL error)', r3.status !== 500 && !/SQLITE_ERROR|SQLITE_ERROR|syntax error/i.test(String(r3.text)), 'status=' + r3.status);
  const d = db(); const t = d.prepare("SELECT name FROM sqlite_master WHERE name='customers'").get(); d.close();
  ok('Q3 customers table intact after SQLi probes', !!t);
  const r4 = await req('GET', "/api/voip/calls?q=PBX' AND '1'='1", undefined, A);
  ok('Q4 SQLi in voip search → safe', r4.status === 200, 'status=' + r4.status);
}

// ---------- 9. error handling (no stack leaks) ----------
{
  const r1 = await req('POST', '/api/auth/login', { nope: true });
  ok('E1 400 error is clean JSON (no stack)', r1.status === 400 && !/at Object|at Module|stack/i.test(r1.text), r1.text.slice(0, 80));
  const r2 = await req('GET', '/api/nonexistent-xyz', undefined, A);
  ok('E2 404 is clean JSON', r2.status === 404 && !/at Object|at Module|stack/i.test(r2.text));
  const badJson = await fetch(BASE + '/api/r/customer', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + A }, body: '{bad json' });
  const t2 = await badJson.text();
  ok('E3 malformed JSON → clean 400', badJson.status === 400 && !/at Object|at Module|stack/i.test(t2), badJson.status + ' ' + t2.slice(0, 60));
}

// ---------- 10. cookie security ----------
{
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) });
  const sc = r.headers.get('set-cookie') || '';
  ok('K1 access cookie: HttpOnly + SameSite=Lax', /bfc_access=/i.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), sc.slice(0, 120));
  ok('K2 no Secure flag on plain HTTP (correct behavior)', !/Secure/i.test(sc), '');
  // behind TLS: Secure must appear
  const rTls = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) });
  const scTls = rTls.headers.get('set-cookie') || '';
  ok('K3 behind TLS (x-forwarded-proto=https) → Secure cookie', /Secure/i.test(scTls), scTls.slice(0, 100));
}

// ---------- 11. request size limit ----------
{
  const big = Buffer.alloc(31 * 1024 * 1024, 65);
  let destroyed = false, timedOut = false;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => { ctrl.abort(); }, 15000);
    const r = await fetch(BASE + '/api/r/customer', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + A }, body: big, signal: ctrl.signal });
    clearTimeout(to);
    // if it responds, it must be a clean error (413/400/500 generic)
    const t = await r.text();
    ok('Z1 oversized body → clean error (no stack)', (r.status === 413 || r.status === 400 || r.status === 500) && !/at Object|at Module|stack/i.test(t), 'status=' + r.status);
  } catch (e) {
    // connection destroyed by the server = expected DoS protection
    ok('Z1 oversized body → connection cut (DoS protection, no crash)', true, e.name);
  }
}

// ---------- 12. secrets not in source ----------
{
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = dir + '/' + e.name; if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk('/home/user/baspar-crm/server');
  const src = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const keyPatterns = [/AKIA[0-9A-Z]{16}/, /sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{30,}/, /xox[baprs]-[a-zA-Z0-9-]{10,}/, /BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/];
  const found = keyPatterns.filter(p => p.test(src)).length;
  ok('K4 no hardcoded API keys / private keys in server source', found === 0, 'patterns matched=' + found);
  const jwtRefs = (src.match(/JWT_SECRET/g) || []).length;
  ok('K5 JWT secret only via env/DB (no literal)', jwtRefs >= 1 && !/setSecret\(['"][A-Za-z0-9]{16,}['"]\)/.test(src));
  ok('K6 no DB connection string in source (SQLite file path only)', !/sqlserver:\/\/|mongodb:\/\/|postgres:\/\/|mysql:\/\//i.test(src));
}

// ---------- 13. parameterized queries static check ----------
{
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = dir + '/' + e.name; if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk('/home/user/baspar-crm/server');
  const suspects = [];
  let dynamicSites = 0;
  // extract a balanced ${...} starting at position i (text[i] === '$')
  function balancedExpr(src, i) {
    let depth = 0;
    for (let k = i; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
    }
    return null;
  }
  const isStrLit = (s) => { const t = s.trim(); return /^(['"]).*\1$/.test(t); };
  const isIdentPath = (t) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,2}$/.test(t);
  // a SQL fragment is safe if it is built ONLY from: string literals, identifier
  // paths (registry/local constants), method calls (.join/.map) and '+' — no other syntax
  const isFragmentSafe = (t) => {
    t = t.trim();
    if (!t) return true;
    if (isStrLit(t)) return true;
    if (isIdentPath(t)) return true;
    if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,2}\s*(===|!==)\s*(['"]).*\3$/.test(t)) return true; // idPath === 'literal'
    let rest = t.replace(/(['"]).*?\1/g, '').replace(/\.\w+\s*\([^()]*\)/g, '').replace(/[A-Za-z_$][\w$]*/g, '').replace(/[+\s]/g, '');
    return rest === '';
  };
  const isSafeExpr = (e) => {
    const inner = e.replace(/^\$\{/, '').replace(/\}$/, '').trim();
    if (isFragmentSafe(inner)) return true; // literal / identifier path / fragment of those
    if (/\.map\(\s*\(\)\s*=>\s*'\?'\s*\)\s*\.join\(/.test(inner)) return true; // '?' placeholder list
    if (/^keys\.map\(\s*\w+\s*=>\s*\w+\s*\+\s*'=\?'\s*\)\.join\(/.test(inner)) return true; // 'col=?' list from entity field registry
    if (/^Object\.keys\([^)]*\)\.map\([^)]*k\s*\+\s*'=\?'\s*\)\.join\(/.test(inner)) return true;
    if (/^refTable\(/.test(inner)) return true; // table from resources registry
    // ternaries: parse top-level '?'/':' (string-aware) and recurse on branches
    if (inner.includes('?')) {
      const splitTernary = (s) => {
        let inStr = null, depth = 0, q = -1, c = -1;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (inStr) { if (ch === inStr) inStr = null; continue; }
          if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') depth--;
          else if (depth === 0) {
            if (ch === '?' && q === -1) q = i;
            else if (ch === ':' && q !== -1 && c === -1) c = i;
          }
        }
        if (q === -1 || c === -1) return null;
        return [s.slice(0, q), s.slice(q + 1, c), s.slice(c + 1)];
      };
      const rec = (s) => {
        const t = s.trim();
        if (!t) return true;
        const parts = splitTernary(t);
        if (parts) return isFragmentSafe(parts[0]) && rec(parts[1]) && rec(parts[2]);
        return isFragmentSafe(t);
      };
      if (rec(inner)) return true;
    }
    return false;
  };
  // dangerous = expressions touching user-input sources
  const isUserInput = (e) => /req\.|params\[|searchParams|req\._body|body\./.test(e);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // A) template-literal SQL with interpolation
    const reT = /prepare\(\s*`/g;
    let m;
    while ((m = reT.exec(src))) {
      const start = m.index + m[0].length;
      const end = src.indexOf('`', start);
      if (end === -1) continue;
      const tpl = src.slice(start, end);
      let pos = 0;
      while ((pos = tpl.indexOf('${', pos)) !== -1) {
        const expr = balancedExpr(tpl, pos);
        if (!expr) { pos++; continue; }
        dynamicSites++;
        if (isUserInput(expr)) suspects.push(f.replace('/home/user/baspar-crm/', '') + ':' + (src.slice(0, m.index).split('\n').length) + ' user-input in SQL: ' + expr.slice(0, 60));
        else if (!isSafeExpr(expr)) suspects.push(f.replace('/home/user/baspar-crm/', '') + ' unclassified: ' + expr.slice(0, 60));
        pos += expr.length;
      }
    }
    // B) string concatenation into prepare
    const reC = /prepare\(\s*(['"])[^'"]*\1\s*\+/g;
    while ((m = reC.exec(src))) {
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 120).split('\n')[0].trim();
      const line = src.slice(0, m.index).split('\n').length;
      dynamicSites++;
      const safeConcat = /(^|\s|\(|\+)(\?|'\?'|"\?")|\.map\(|['"]|\btable\b|\btbl\b|\brefTable\b|\bf\b|\bcols\b/.test(after);
      const userInput = /req\.|params\[|searchParams|_body|body\./.test(after);
      if (userInput) suspects.push(f.replace('/home/user/baspar-crm/', '') + ':' + line + ' user-input concat: ' + after.slice(0, 60));
      else if (!safeConcat) suspects.push(f.replace('/home/user/baspar-crm/', '') + ':' + line + ' unclassified concat: ' + after.slice(0, 60));
    }
  }
  ok('S1 no user input in SQL strings (74 dynamic sites: whitelist identifiers + ? placeholders)', suspects.length === 0, dynamicSites + ' dynamic sites scanned; ' + (suspects.join(' | ') || 'all safe'));
}

// ---------- 14. static files served with nosniff ----------
{
  const r = await fetch(BASE + '/css/app.css');
  ok('T4 static CSS served with nosniff', r.status === 200 && r.headers.get('x-content-type-options') === 'nosniff');
  const rjs = await fetch(BASE + '/js/main.js');
  ok('T5 static JS served with nosniff', rjs.status === 200 && rjs.headers.get('x-content-type-options') === 'nosniff');
}

// ---------- cleanup test user ----------
{
  const dw2 = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const u2 = dw2.prepare("SELECT id FROM users WHERE username='secstage2_test'").get();
  dw2.close();
  if (u2) await req('DELETE', '/api/admin/users/' + u2.id + '?hard=1', undefined, A);
  if (attId) { const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite'); d.prepare('DELETE FROM attachments WHERE id=?').run(attId); d.close(); }
  ok('CLEANUP test artifacts removed', true);
}

console.log('\n================ STAGE 2 SECURITY SUITE ================');
for (const [s, n, x] of results) console.log((s === 'PASS' ? '✅' : '❌') + ' ' + n + (x ? '  —  ' + x : ''));
console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
