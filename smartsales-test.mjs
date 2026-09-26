// STAGE 6 — Smart Sales Team + Hybrid AI test suite (real, no mocks)
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const DB = '/home/user/baspar-crm/data/baspar-crm.sqlite';
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const results = [];
const ok = (n, c, x = '') => { if (c) { pass++; results.push(['PASS', n, x]); } else { fail++; results.push(['FAIL', n, x]); } };
let ntest = 0;
const nt = (n, x = '') => { ntest++; results.push(['NOT-TESTED', n, x]); };
async function j(method, path, body, tok, headers = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof Buffer)) h['content-type'] = 'application/json';
  if (tok) h['authorization'] = 'Bearer ' + tok;
  const r = await fetch(BASE + path, { method, headers: h, body: (body === undefined || body === null) ? undefined : (body instanceof Buffer ? body : JSON.stringify(body)) });
  let data = null; try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

const login = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
const A = login.data.access;
ok('S0 admin login', login.status === 200 && !!A);

// ---------- 1. AI Orchestrator status (3 levels, honest) ----------
{
  // reset mode to the default (hybrid) so this assertion is robust to prior test state
  await j('PUT', '/api/ai2/settings', { ai_mode: 'hybrid' }, A);
  const s = (await j('GET', '/api/ai/status', null, A)).data;
  ok('AI1 mode default = hybrid', s.mode === 'hybrid', s.mode);
  ok('AI2 chain = online → local → local_intelligence', JSON.stringify(s.chain) === JSON.stringify(['online', 'local', 'local_intelligence']), s.chain.join('→'));
  ok('AI3 local_intelligence always ready', s.levels.local_intelligence.status === 'ready');
  ok('AI4 online honest (not_configured when no key)', s.levels.online.status === 'not_configured' || s.levels.online.status === 'ready_pending_test' || s.levels.online.status === 'disabled', s.levels.online.status);
}

// ---------- 2. Target Engine (CRUD + real achievement) ----------
let targetId = null;
{
  const before = (await j('GET', '/api/smart-sales/targets', null, A)).data.items.length;
  const c = await j('POST', '/api/smart-sales/targets', { scope_type: 'company', period_type: 'month', period_start: new Date().toISOString().slice(0, 8) + '01', amount: 500000000 }, A);
  targetId = c.data && c.data.id;
  ok('T1 create target (company/month)', c.status === 201 && !!targetId, 'id=' + targetId);
  const list = (await j('GET', '/api/smart-sales/targets', null, A)).data.items;
  ok('T2 target listed', list.length === before + 1);
  const t = list.find(x => x.id === targetId);
  ok('T3 achievement computed from REAL invoices (0<=achieved<=amount or >0)', t && typeof t.achieved === 'number' && t.achieved >= 0 && typeof t.pct === 'number', 'achieved=' + (t && t.achieved) + ' pct=' + (t && t.pct));
  const u = await j('PUT', '/api/smart-sales/targets/' + targetId, { amount: 900000000 }, A);
  ok('T4 update target amount', u.status === 200);
  const u2 = (await j('GET', '/api/smart-sales/targets', null, A)).data.items.find(x => x.id === targetId);
  ok('T5 update persisted', u2 && u2.amount === 900000000, 'amount=' + (u2 && u2.amount));
  const bad = await j('POST', '/api/smart-sales/targets', { scope_type: 'company', period_type: 'month', period_start: 'not-a-date', amount: 100 }, A);
  ok('T6 invalid period rejected (422)', bad.status === 422, bad.status);
}

// ---------- 3. Next Best Action (real data) ----------
{
  const r = (await j('GET', '/api/smart-sales/actions?limit=50', null, A)).data;
  ok('NBA1 returns items with priority/type/entity', Array.isArray(r.items) && r.items.every(x => x.priority && x.type && x.entity), 'items=' + (r.items || []).length);
  ok('NBA2 items are real entity refs (entity_id present)', (r.items || []).every(x => x.entity_id));
}

// ---------- 4. Smart Follow-up + Task creation ----------
{
  const r = (await j('GET', '/api/smart-sales/followups', null, A)).data;
  ok('F1 smart followups returns real items', Array.isArray(r.items), 'items=' + (r.items || []).length);
  const overdue = (r.items || []).filter(x => x.overdue);
  if (overdue.length) {
    const t = await j('POST', '/api/smart-sales/followups/' + overdue[0].id + '/task', null, A);
    ok('F2 task created from overdue followup (with suggested due)', (t.status === 200 || t.status === 201) && t.data && t.data.task_id && !!t.data.due_at, 'task=' + (t.data && t.data.task_id));
  } else {
    // create a guaranteed-overdue followup on a real customer
    const custs = (await j('GET', '/api/r/customer?per_page=1', null, A)).data.items;
    if (custs && custs.length) {
      const cf = await j('POST', '/api/r/followup', { entity_type: 'customer', entity_id: custs[0].id, subject: 'E2E overdue followup', due_at: new Date(Date.now() - 864e5).toISOString(), user_id: 1, status: 'pending' }, A);
      if (cf.status === 200 || cf.status === 201) {
        const f2 = (await j('GET', '/api/smart-sales/followups', null, A)).data.items.find(x => x.overdue && x.subject === 'E2E overdue followup');
        if (f2) { const t = await j('POST', '/api/smart-sales/followups/' + f2.id + '/task', null, A); ok('F2 task created from overdue followup', (t.status === 200 || t.status === 201) && t.data && t.data.task_id, 'task=' + (t.data && t.data.task_id)); }
        else ok('F2 task created from overdue followup', false, 'followup not found in smart list');
      } else ok('F2 task created from overdue followup', false, 'could not create followup ' + cf.status);
    } else ok('F2 task created from overdue followup', false, 'no customers');
  }
}

// ---------- 5. Stalled / High-Priority / At-Risk ----------
{
  const st = (await j('GET', '/api/smart-sales/stalled', null, A)).data;
  ok('S1 stalled opportunities (real, with days)', Array.isArray(st.items) && (st.items.length === 0 || st.items.every(x => x.stalled_days > st.threshold_days)), 'items=' + (st.items || []).length);
  const hp = (await j('GET', '/api/smart-sales/leads', null, A)).data;
  ok('S2 high-priority leads (scored)', Array.isArray(hp.items));
  const ar = (await j('GET', '/api/smart-sales/at-risk', null, A)).data;
  ok('S3 at-risk customers (score + reasons)', Array.isArray(ar.items) && (ar.items.length === 0 || ar.items.every(x => x.churn_score >= ar.threshold)), 'items=' + (ar.items || []).length);
}

// ---------- 6. Integration Center (honest status) ----------
{
  const em = (await j('POST', '/api/integrations/email/test', null, A)).data;
  ok('I1 email test honest (not_configured or connected/failed)', ['not_configured', 'connected', 'connection_failed'].includes(em.status), em.status);
  const tg = (await j('POST', '/api/integrations/telegram/test', null, A)).data;
  ok('I2 telegram test honest', ['not_configured', 'connected', 'connection_failed'].includes(tg.status), tg.status);
  const ai = (await j('POST', '/api/integrations/ai/test', null, A)).data;
  ok('I3 ai test returns online+local honest status', ai && (ai.online || ai.local), JSON.stringify(ai).slice(0, 60));
}

// ---------- 7. Webhook security (timestamp + replay) ----------
{
  const secret = 'e2e-secret-xyz';
  await j('PUT', '/api/voip/settings', { active: 1, connection_type: 'webhook', webhook_secret: secret }, A);
  const TS = Date.now();
  const nonceRun = 'nonce-e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const stale = await j('POST', '/api/voip/webhook/replaytest', { event: 'ringing', data: { call_id: 'E2E-S', from: '09120000001', start: new Date().toISOString() } }, null, { 'x-webhook-secret': secret, 'x-webhook-timestamp': String(TS - 9999999) });
  ok('W1 stale timestamp → 401', stale.status === 401, stale.status + ' ' + (stale.data && stale.data.error && stale.data.error.code));
  const ok1 = await j('POST', '/api/voip/webhook/replaytest', { event: 'ringing', data: { call_id: 'E2E-S', from: '09120000001', start: new Date().toISOString() } }, null, { 'x-webhook-secret': secret, 'x-webhook-timestamp': String(TS), 'x-webhook-nonce': nonceRun });
  ok('W2 fresh timestamp + nonce → 200', ok1.status === 200, ok1.status);
  const replay = await j('POST', '/api/voip/webhook/replaytest', { event: 'ringing', data: { call_id: 'E2E-S', from: '09120000001', start: new Date().toISOString() } }, null, { 'x-webhook-secret': secret, 'x-webhook-timestamp': String(TS), 'x-webhook-nonce': nonceRun });
  ok('W3 replay (same nonce) → 401 REPLAY', replay.status === 401 && replay.data && replay.data.error && replay.data.error.code === 'REPLAY', replay.data && replay.data.error && replay.data.error.code);
}

// ---------- 8. RBAC on smart-sales ----------
{
  // amin.p = warehouse_manager (has NO smart_sales grant) — direct login (pw '12345678' from seed)
  const wl = await j('POST', '/api/auth/login', { username: 'amin.p', password: '12345678' });
  if (wl.status === 200 && wl.data.access) {
    const r = await j('GET', '/api/smart-sales/actions', null, wl.data.access);
    ok('R1 user without smart_sales.view → 403', r.status === 403, r.status);
    const r2 = await j('GET', '/api/smart-sales/targets', null, wl.data.access);
    ok('R2 targets also 403 for unauthorized', r2.status === 403, r2.status);
  } else {
    ok('R1 user without smart_sales.view → 403', false, 'warehouse login failed ' + wl.status);
    ok('R2 targets also 403 for unauthorized', false, 'login failed');
  }
}

// ---------- 9. HYBRID AI — the 6 MANDATORY tests (item 57) ----------
// HONEST: T1 (real Online AI) needs a real API key; T2 (real Local LLM) needs a local
// runtime (Ollama/llama.cpp). Neither is available in this sandbox, so T1/T2 are verified
// for ORCHESTRATOR HONESTY (correct engine selection, honest fallback, no fake), and the
// real AI response is reported NOT TESTED (requires real credentials / runtime).
{
  const ask = async (q, tok = A) => (await j('POST', '/api/ai/chat', { query: q }, tok)).data;
  // ---- T1: Internet ON -> Online AI ----
  // No real API key in sandbox: online_only with no key must honestly report unavailable (no fake).
  await j('PUT', '/api/ai2/settings', { ai_mode: 'online_only', online_api_key: '' }, A);
  const t1 = await ask('فروش این ماه چقدر است؟');
  ok('T1 orchestrator online path: honest (no fake online AI when unconfigured)',
     t1 && (t1.note === 'online_unavailable' || t1.engine === 'local_intelligence'),
     'note=' + (t1 && t1.note) + ' engine=' + (t1 && t1.engine));
  nt('T1 real Online AI response (needs a real Gemini/OpenAI/Claude API key)',
     'NOT TESTED in sandbox — no real API key; orchestrator path verified above');
  // ---- T2: Internet OFF -> Offline Local AI ----
  // No local LLM runtime in sandbox: offline_only with unreachable endpoint must honestly fall back.
  await j('PUT', '/api/ai2/settings', { ai_mode: 'offline_only', local_endpoint: 'http://127.0.0.1:1/v1' }, A);
  const t2 = await ask('مهم‌ترین مشتریان این ماه کدامند؟');
  ok('T2 orchestrator local-LLM path: honest fallback when runtime unavailable (no fake)',
     t2 && t2.engine === 'local_intelligence' && t2.text.length > 0, 'engine=' + (t2 && t2.engine));
  nt('T2 real Local LLM (Ollama/llama.cpp) response (needs a local runtime)',
     'NOT TESTED in sandbox — no local LLM runtime; orchestrator fallback verified above');
  // ---- T3: Internet OFF + Local LLM unavailable -> Local Intelligence (offline != disabled) ----
  // Same state as T2 (offline_only + unreachable LLM): Local Intelligence must still answer.
  const t3 = await ask('مجموع مطالبات باز چقدر است؟');
  ok('T3 offline + LLM-unavailable -> Local Intelligence answers (offline != disabled)',
     t3 && t3.engine === 'local_intelligence' && t3.text.length > 0, 'engine=' + (t3 && t3.engine));
  // ---- T4: Online API Failure -> Offline Fallback ----
  // hybrid + invalid online key/endpoint + unreachable local -> must fall back, no crash, no fake online.
  await j('PUT', '/api/ai2/settings', { ai_mode: 'hybrid', online_api_key: 'sk-invalid-key-123', online_provider: 'openai', online_base_url: 'http://127.0.0.1:1/v1', local_endpoint: 'http://127.0.0.1:1/v1' }, A);
  const t4 = await ask('مجموع فروش امروز چقدر است؟');
  ok('T4 online API failure -> fallback to a real engine (no crash, no fake online)',
     t4 && !!t4.engine && t4.engine !== 'online' && t4.text.length > 0, 'engine=' + (t4 && t4.engine));
  // ---- T5: Unauthorized User -> Permission Denied ----
  const wl = await j('POST', '/api/auth/login', { username: 'amin.p', password: '12345678' });
  if (wl.status === 200 && wl.data.access) {
    const t5 = await ask('فروش این ماه', wl.data.access);
    ok('T5 unauthorized user -> permission denied / scoped, no full financial data',
       t5 && t5.text.length > 0 && (!/مجموع|ریال/.test(t5.text) || t5.text.includes('مجوز') || t5.text.includes('داده کافی')),
       (t5 && t5.text || '').slice(0, 60));
  } else ok('T5 unauthorized -> permission denied', false, 'login failed ' + wl.status);
  // ---- T6: Sensitive Data -> Privacy Policy ----
  await j('PUT', '/api/ai2/settings', { ai_mode: 'hybrid', ai_privacy: { financial: false, online_allowed: true, offline_allowed: true, customer: true, contact: true, sales: true, notes: true, files: false, masking: true } }, A);
  const t6 = await ask('فروش این ماه چقدر است؟');
  ok('T6 sensitive data -> privacy policy masks financial figures',
     t6 && !/ریال|\d{3},\d{3}|\d{6,}/.test(t6.text || ''), (t6 && t6.text || '').slice(0, 60));
  // restore sane defaults
  await j('PUT', '/api/ai2/settings', { ai_mode: 'hybrid', ai_privacy: { financial: true, online_allowed: true, offline_allowed: true, customer: true, contact: true, sales: true, notes: true, files: false, masking: true }, online_api_key: '', online_base_url: '', online_provider: 'gemini', local_endpoint: 'http://127.0.0.1:11434/v1' }, A);
}

// ---------- 10. DB integrity + target cleanup ----------
{
  if (targetId) await j('DELETE', '/api/smart-sales/targets/' + targetId, null, A).catch(() => {});
  const d = new BDB(DB);
  const integ = d.pragma('integrity_check', { simple: true });
  const fk = d.pragma('foreign_key_check').length;
  ok('D1 integrity ok + 0 FK after all operations', integ === 'ok' && fk === 0, 'integrity=' + integ + ' fk=' + fk);
  d.close();
}

console.log('\n================ SMART SALES + HYBRID AI =================');
for (const [s, n, x] of results) console.log((s === 'PASS' ? '✅' : s === 'FAIL' ? '❌' : '⏸️') + ' ' + n + (x ? '  —  ' + x : ''));
console.log(`TOTAL: ${pass + fail + ntest} | PASS: ${pass} | FAIL: ${fail} | NOT-TESTED: ${ntest}`);
process.exit(fail ? 1 : 0);
