// Section 9.5 — AI MODULE: real-HTTP test suite (no mocks, no fabricated AI).
// Honest online/offline capability, real-data deterministic analysis, per-record
// permission + row scope, API-key safety (masked, never in logs), rate limiting, ai_logs.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');

const BASE = process.env.BASE || 'http://localhost:3050';
const STAMP = 'AI' + String(Date.now()).slice(-5);
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function fetchRetry(url, opts, tries = 6) {
  for (let i = 1; ; i++) {
    const r = await fetch(url, opts);
    if ((r.status !== 429 && r.status < 500) || i >= tries) return r;
    await sleep(Math.min(2000, 300 * 2 ** (i - 1)) + Math.floor(Math.random() * 250));
  }
}
async function req(method, path, a, b, noRetry429 = false) {
  const isGet = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  const body = isGet ? undefined : a;
  const token = isGet ? a : b;
  const h = {};
  if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = noRetry429 ? await fetch(BASE + path, { method, headers: h, body: (body !== undefined && body !== null) ? JSON.stringify(body) : undefined })
    : await fetchRetry(BASE + path, { method, headers: h, body: (body !== undefined && body !== null) ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t };
}
const db = () => new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
const q1 = (sql, ...p) => { const d = db(); try { return d.prepare(sql).get(...p); } finally { d.close(); } };

const A = (await req('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).data.access;
if (!A) { console.log('FATAL: admin login failed'); process.exit(2); }
const M = (await req('POST', '/api/auth/login', { username: 'saeid.t', password: '12345678' })).data.access; // lab: customer:view, no invoice:view
const R = (await req('POST', '/api/auth/login', { username: 'sara.m', password: '12345678' })).data.access; // sales team scope
if (!M || !R) { console.log('FATAL: test user login failed'); process.exit(2); }

const G = {};
try {
  // ---------- controlled data (real API) ----------
  G.cust = (await req('POST', '/api/r/customer', { name: 'مشتری هوشمند ' + STAMP, type: 'company', salesperson_id: 4 }, A)).data.id; // sara.m (sales team)
  G.custOther = (await req('POST', '/api/r/customer', { name: 'مشتری آزمایشگاه ' + STAMP, type: 'company', salesperson_id: 11 }, A)).data.id; // saeid.t (lab dept)
  ok('A01 two customers created with different salesperson scopes', !!(G.cust && G.custOther), `c1=${G.cust} c2=${G.custOther}`);

  // ---------- honest capability status ----------
  let r = await req('GET', '/api/ai/status', A);
  const st = r.data || {};
  ok('A02 /api/ai/status reports honest chain (mode + levels)', r.status === 200 && !!st.mode && !!st.levels && Array.isArray(st.chain), JSON.stringify(st.chain || st.levels).slice(0, 140));
  const onlineLevel = st.levels?.online || {};
  ok('A03 online level honest: no API key → not_configured (no fake online)', onlineLevel.configured === false && onlineLevel.status === 'not_configured', JSON.stringify(onlineLevel).slice(0, 140));

  // ---------- real-data deterministic analysis (never fabricated) ----------
  r = await req('GET', '/api/ai/summary', A);
  const summary = typeof r.data === 'string' ? r.data : (r.data?.text || JSON.stringify(r.data || ''));
  ok('A04 executive summary returns real-data analysis (numbers present)', r.status === 200 && summary.length > 30 && /[\d۰-۹]/.test(summary), summary.slice(0, 120));
  const summaryNoFakeOnline = !/مدل آنلاین|online model/i.test(summary) || true; // informational
  r = await req('GET', '/api/ai/customer/' + G.cust, A);
  const insights = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
  ok('A05 customer insights reference the REAL customer (name present)', r.status === 200 && insights.includes('مشتری هوشمند ' + STAMP), insights.slice(0, 140));
  r = await req('GET', '/api/ai2/module/customer/' + G.cust, A);
  ok('A06 per-record analysis (module API) real values, source labeled builtin', r.status === 200 && (r.data.source === 'builtin' || r.data.source === 'local') && JSON.stringify(r.data.text || '').length > 20, `source=${r.data?.source}`);

  // ---------- permission + row scope (backend) ----------
  r = await req('GET', '/api/ai2/module/invoice/1', M);
  ok('A07 lab role CANNOT analyze invoices (no invoice:view) → 403', r.status === 403, `status=${r.status}`);
  r = await req('GET', '/api/ai/summary', M);
  ok('A08 lab role CANNOT get sales summary (no invoice:view) → 403', r.status === 403, `status=${r.status}`);
  r = await req('GET', '/api/ai2/module/customer/' + G.cust, R);
  ok('A09 sales user CAN analyze own-team customer (row scope: same department)', r.status === 200, `status=${r.status}`);
  r = await req('GET', '/api/ai2/module/customer/' + G.custOther, R);
  ok('A10 sales user CANNOT analyze other-department customer (row scope) → 403', r.status === 403, `status=${r.status}`);

  // ---------- API key safety: masked in API, never in logs ----------
  const FAKE_KEY = 'sk-test-' + STAMP + '1234567890';
  r = await req('PUT', '/api/ai2/settings', { online_api_key: FAKE_KEY }, A);
  ok('A11 API key can be set (settings:edit)', r.status === 200, `status=${r.status}`);
  r = await req('GET', '/api/ai2/settings', A);
  const cfg = r.data || {};
  ok('A12 key is MASKED in config response (no raw key)', r.status === 200 && (cfg.online_api_key_masked || '').includes('•') && !JSON.stringify(cfg).includes(FAKE_KEY), `masked=${cfg.online_api_key_masked}`);
  // one AI call with the (fake) key → online attempt fails → failover; key must not appear in ai_logs
  await req('GET', '/api/ai2/module/customer/' + G.cust, A);
  const logLeak = q1(`SELECT COUNT(*) c FROM ai_logs WHERE error LIKE ? OR model LIKE ?`, '%' + FAKE_KEY + '%', '%' + FAKE_KEY + '%');
  ok('A13 fake key never appears in ai_logs', logLeak.c === 0, 'leaks=' + logLeak.c);
  await req('PUT', '/api/ai2/settings', { online_api_key: '' }, A);
  ok('A14 key restored (cleared) after the test', (await req('GET', '/api/ai2/settings', A)).data.online_api_key_masked === '', '');

  // ---------- ai_logs: real request logging ----------
  const logs = q1(`SELECT COUNT(*) c FROM ai_logs WHERE module IN ('reporting','general','customer','invoice','lead','opportunity','lab_request','voip','workflow','calendar','general') AND created_at > datetime('now','-1 hour')`);
  ok('A15 ai_logs records the AI requests made in this test', logs.c >= 3, 'n=' + logs.c);
  const srcLogged = q1(`SELECT DISTINCT source FROM ai_logs WHERE created_at > datetime('now','-1 hour') ORDER BY id DESC LIMIT 5`);
  ok('A16 ai_logs records the source (builtin/local/online — no fake)', !!srcLogged && ['builtin', 'local', 'online', 'none', 'local_llm'].includes(srcLogged.source), 'source=' + (srcLogged && srcLogged.source));

  // ---------- rate limit (real, per-user) ----------
  await req('PUT', '/api/ai2/settings', { ai_rate_limit: { max: 3, window_ms: 60000 } }, A);
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const rr = await req('GET', '/api/ai2/module/customer/' + G.cust, M, true); // no 429-retry for this probe
    codes.push(rr.status);
    if (rr.status === 429) break;
  }
  ok('A17 per-user AI rate limit enforced (429 AI_RATE_LIMITED after max)', codes.includes(429) && codes[0] === 200, JSON.stringify(codes));
  const limited429 = await req('GET', '/api/ai2/module/customer/' + G.cust, M, true);
  ok('A18 429 body carries AI_RATE_LIMITED code', limited429.status === 429 && limited429.data?.error?.code === 'AI_RATE_LIMITED', JSON.stringify(limited429.data || {}).slice(0, 120));
  await req('PUT', '/api/ai2/settings', { ai_rate_limit: { max: 60, window_ms: 300000 } }, A);
  ok('A19 rate limit restored to default', (await req('GET', '/api/ai2/settings', A)).data.ai_rate_limit?.max === 60, '');
} catch (err) {
  ok('suite completed without unexpected crash', false, (err.stack || String(err)).slice(0, 300));
}

// ================= cleanup =================
(async () => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const tx = d.transaction(() => {
    const del = (sql, ...p) => { try { d.prepare(sql).run(...p); } catch (e) { console.log('cleanup skip:', e.message); } };
    del('DELETE FROM customers WHERE id IN (?,?)', G.cust || 0, G.custOther || 0);
  });
  tx(); d.close();
  console.log('cleanup done');
  console.log('\n========== AI MODULE (SECTION 9.5) — RESULTS ==========');
  for (const [st, name, extra] of results) console.log(`${st}  ${name}${extra ? '  [' + String(extra).slice(0, 150) + ']' : ''}`);
  console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('cleanup fatal', e); process.exit(1); });
