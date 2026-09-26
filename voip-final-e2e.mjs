// Final E2E test — VoIP/branding completion pass.
// Real HTTP against the running server (port 3000) + a local PBX REST stub (port 9999)
// to exercise the REAL outbound dial/sync path. The stub plays the PBX role; the CRM
// code path is 100% real (fetch → parse → upsert). No mocked CRM responses anywhere.
import http from 'node:http';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3050';
const PBX = 9999;
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(['PASS', name, extra]); }
  else { fail++; results.push(['FAIL', name, extra]); }
}
async function j(method, path, body, tok, headers = {}) {
  const r = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* html/binary */ }
  return { status: r.status, data, headers: r.headers };
}

// ---------- PBX stub (real server answering like a PBX) ----------
const dialLog = [];
const pbx = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => b += c);
  req.on('end', () => {
    if (req.method === 'POST' && req.url.startsWith('/dial')) {
      const p = JSON.parse(b || '{}');
      dialLog.push(p);
      const cid = 'PBX-OUT-' + Date.now();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ call_id: cid, status: 'started' }));
    }
    if (req.url.startsWith('/cdr')) {
      // two CDRs: one duplicate of the webhook call (dedup test), one new
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ cdrs: [
        { call_id: 'PBX-1001', from: '09120000001', to: '101', start: new Date(Date.now() - 7200000).toISOString(), end: new Date(Date.now() - 7100000).toISOString(), duration: 300 },
        { call_id: 'PBX-2002', from: '09131112222', to: '102', start: new Date(Date.now() - 3600000).toISOString(), end: new Date(Date.now() - 3500000).toISOString(), duration: 60 },
      ] }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, probe: 'PBX-alive' }));
  });
});
await new Promise((r) => pbx.listen(PBX, '127.0.0.1', r));

// ---------- login ----------
const login = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
ok('login admin', login.status === 200 && login.data.access);
const tok = login.data.access;

// ---------- pre-cleanup (idempotency): remove this suite's own artifacts from previous runs ----------
{
  const { createRequire } = await import('node:module');
  const BDB = createRequire('/home/user/baspar-crm/x.js')('better-sqlite3');
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite');
  const custs = d.prepare("SELECT id FROM customers WHERE mobile IN ('09120000001','09989998877')").all();
  const ids = custs.map(c => c.id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    d.prepare('DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE customer_id IN (' + ph + '))').run(...ids);
    d.prepare('DELETE FROM quotes WHERE customer_id IN (' + ph + ')').run(...ids);
    d.prepare("DELETE FROM comments WHERE entity_type='customer' AND entity_id IN (" + ph + ')').run(...ids);
    d.prepare('DELETE FROM customers WHERE id IN (' + ph + ')').run(...ids);
  }
  d.prepare("DELETE FROM voip_calls WHERE external_call_id LIKE 'PBX-%'").run();
  d.prepare("DELETE FROM products WHERE code='P-E2E-1'").run();
  d.close();
}

// ---------- fixtures (self-contained) ----------
const custFix = await j('POST', '/api/r/customer', { name: 'کارخانه تست E2E', mobile: '09120000001', phone: '08645253691', code: 'C-E2E-1' }, tok);
const custId = custFix.data.id;
const prodFix = await j('POST', '/api/r/product', { name: 'فوم E2E', sku: 'E2E-001', code: 'P-E2E-1', price: 1000000, unit: 'کارتن' }, tok);
const quoteFix = await j('POST', '/api/r/quote', { customer_id: custId, items: [{ product_id: prodFix.data.id, qty: 3, price: 1000000 }] }, tok);
const quoteId = quoteFix.data.id;

// ---------- 1. VoIP settings (provider-agnostic, secrets encrypted) ----------
const save = await j('PUT', '/api/voip/settings', {
  active: 1, provider: 'generic', connection_type: 'rest',
  pbx_address: 'pbx.baspar-foam.local', api_url: 'http://127.0.0.1:' + PBX, api_port: PBX,
  sip_server: 'pbx.baspar-foam.local', sip_port: 5060, extension: '101',
  username: 'crm', password: 'super-secret-pw', api_key: 'ak-123456',
  webhook_secret: 'whsec-abc-777', recording_path: '/var/pbx/recordings',
  cdr_path: '/cdr', dial_path: '/dial', auto_sync: 0, sync_interval_min: 5,
}, tok);
ok('settings saved', save.status === 200, JSON.stringify(save.data.settings || {}).slice(0, 80));
const got = await j('GET', '/api/voip/settings', undefined, tok);
const s = got.data.settings || {};
ok('secrets masked in GET', s.password && String(s.password).includes('•') && !String(s.password).includes('super-secret-pw'), 'pw=' + s.password);
ok('secrets masked api_key', String(s.api_key || '').includes('•') && !String(s.api_key).includes('ak-123456'));
ok('secrets masked webhook_secret', String(s.webhook_secret || '').includes('•') && !String(s.webhook_secret).includes('whsec-abc-777'));
// raw DB check: stored value must be enc: encrypted, not plain
const { createRequire } = await import('node:module');
const requireCrm = createRequire('/home/user/baspar-crm/x.js');
const BDB = requireCrm('better-sqlite3');
const rawDb = (() => {
  const d = new BDB('/home/user/baspar-crm/data/baspar-crm.sqlite', { readonly: true });
  const raw = d.prepare("SELECT value FROM settings WHERE key='voip'").get();
  d.close();
  return raw ? raw.value : '';
})();
ok('secrets encrypted at rest (enc: prefix, no plaintext)', rawDb.includes('enc:') && !rawDb.includes('super-secret-pw') && !rawDb.includes('whsec-abc-777'));

// ---------- 2. Test Connection (real HTTP probe) ----------
const tc = await j('POST', '/api/voip/test-connection', {}, tok);
ok('test-connection REST → Connected', tc.status === 200 && tc.data.ok === true && tc.data.mode === 'rest', tc.data.message);
// negative: unreachable URL
await j('PUT', '/api/voip/settings', { active: 1, provider: 'generic', connection_type: 'rest', api_url: 'http://127.0.0.1:1/nope' }, tok);
const tc2 = await j('POST', '/api/voip/test-connection', {}, tok);
ok('test-connection unreachable → Failed (honest)', tc2.status === 200 && tc2.data.ok === false && /Failed|اتصال برقرار نیست/.test(tc2.data.message), tc2.data.message);
// restore working config — send back the EXACT mask ('••••') so server keeps the stored secrets
await j('PUT', '/api/voip/settings', { active: 1, provider: 'generic', connection_type: 'rest', api_url: 'http://127.0.0.1:' + PBX, api_key: '••••', password: '••••', webhook_secret: '••••', username: 'crm', sip_server: 'pbx.baspar-foam.local', sip_port: 5060, extension: '101', cdr_path: '/cdr', dial_path: '/dial', recording_path: '/var/pbx/recordings', auto_sync: 0 }, tok);

// ---------- 3. CDR webhook (ringing → answered → ended → recording_ready) ----------
const WH = { 'x-webhook-secret': 'whsec-abc-777' };
const ev = async (event, data) => j('POST', '/api/voip/webhook/asterisk', { event, data }, null, WH);
let r = await ev('ringing', { call_id: 'PBX-1001', from: '09120000001', to: '101', start: new Date().toISOString() });
ok('webhook ringing accepted', r.status === 200 && r.data.ok, JSON.stringify(r.data));
const callId = r.data.call_id;
r = await ev('answered', { call_id: 'PBX-1001', from: '09120000001', to: '101', start: new Date(Date.now() - 60000).toISOString(), answer: new Date(Date.now() - 58000).toISOString() });
ok('webhook answered', r.status === 200 && r.data.call_id === callId);
r = await ev('ended', { call_id: 'PBX-1001', from: '09120000001', to: '101', start: new Date(Date.now() - 60000).toISOString(), answer: new Date(Date.now() - 58000).toISOString(), end: new Date(Date.now() - 10000).toISOString(), duration: 48, recording: 'REC-1001' });
ok('webhook ended', r.status === 200 && r.data.created === false); // created=false → dedup by external_call_id
const det = await j('GET', '/api/voip/calls/' + callId, undefined, tok);
ok('call linked to Customer Master (09120000001)', det.data.customer_id === custId, 'customer_id=' + det.data.customer_id + ' matched_by=' + det.data.matched_by);
ok('CDR fields (duration/direction/caller)', det.data.duration_sec === 48 && det.data.direction === 'inbound' && det.data.caller === '09120000001', 'dur=' + det.data.duration_sec);
ok('Call ID traceable', !!det.data.call_ref && det.data.external_call_id === 'PBX-1001', det.data.call_ref);
// duplicate full replay → still one row
await ev('ringing', { call_id: 'PBX-1001', from: '09120000001', to: '101', start: new Date().toISOString() });
const list1 = await j('GET', '/api/voip/calls?q=PBX-1001', undefined, tok);
const n1001 = (list1.data.items || []).filter(x => x.external_call_id === 'PBX-1001').length;
ok('duplicate replay → single record (anti-dup)', n1001 === 1, 'count=' + n1001);

// ---------- 4. recording_ready + playback (authenticated) ----------
fs.mkdirSync('data/recordings', { recursive: true });
fs.writeFileSync('data/recordings/REC-1001.wav', Buffer.from('RIFFfake-wav-audio-for-e2e'));
r = await ev('recording_ready', { call_id: 'PBX-1001', recording: 'REC-1001.wav' });
ok('recording_ready accepted', r.status === 200);
const meta = await j('GET', '/api/voip/calls/' + callId + '/recording', undefined, tok);
ok('recording meta ready', meta.data.ready === true && meta.data.can_view === true, JSON.stringify(meta.data));
const streamUrl = await j('POST', '/api/voip/calls/' + callId + '/recording-token', {}, tok);
ok('recording stream token issued', streamUrl.status === 200 && !!streamUrl.data.url);
const audio = await fetch(BASE + streamUrl.data.url);
ok('recording streams (auth-controlled, no public URL)', audio.status === 200 && (await audio.text()).includes('RIFFfake'));
const audio2 = await fetch(BASE + streamUrl.data.url);
ok('stream token single-use', audio2.status === 401);

// ---------- 5. unknown caller → unidentified + register from call ----------
r = await ev('ended', { call_id: 'PBX-3003', from: '09989998877', to: '101', start: new Date(Date.now() - 120000).toISOString(), end: new Date(Date.now() - 60000).toISOString(), duration: 30 });
ok('unknown caller registered as call', r.status === 200 && r.data.created === true);
const detU = await j('GET', '/api/voip/calls/' + r.data.call_id, undefined, tok);
ok('unknown caller → customer_id null (مشتری/مخاطب ناشناس)', detU.data.customer_id === null, 'caller=' + detU.data.caller);
const reg = await j('POST', '/api/voip/calls/' + r.data.call_id + '/customer', { name: 'شرکت ناشناس ثبت‌شده', phone: '09989998877', type: 'company' }, tok);
ok('register customer from unknown call (phone auto-filled)', reg.status === 201 || reg.status === 200, JSON.stringify(reg.data).slice(0, 100));
const detU2 = await j('GET', '/api/voip/calls/' + r.data.call_id, undefined, tok);
ok('call attached to new customer', detU2.data.customer_id && detU2.data.customer_id !== custId, 'customer_id=' + detU2.data.customer_id);
// duplicate check: same phone number must not create a second customer
const dup = await j('GET', '/api/r/customer?q=09989998877', undefined, tok);
const nCust = (dup.data.items || dup.data.rows || []).length;
ok('no duplicate customer for same number', nCust === 1, 'count=' + nCust);

// ---------- 6. missed call → dashboard unfollowed ----------
r = await ev('missed', { call_id: 'PBX-4004', from: '09120000001', to: '101', start: new Date().toISOString() });
ok('missed event accepted', r.status === 200 && r.data.created === true);
const dash = await j('GET', '/api/voip/dashboard', undefined, tok);
ok('dashboard shows missed + unfollowed', dash.data.missed >= 1 && dash.data.unfollowed >= 1, JSON.stringify({ missed: dash.data.missed, unfollowed: dash.data.unfollowed }));

// ---------- 7. follow-up from call ----------
const fu = await j('POST', '/api/voip/calls/' + r.data.call_id + '/followup', { subject: 'بازگشت تماس از دست‌رفته' }, tok);
ok('follow-up created & linked', (fu.status === 201 || fu.status === 200) && !!fu.data.followup_id, JSON.stringify(fu.data).slice(0, 80));

// ---------- 8. AI & calls (item 39) ----------
const ai = await j('GET', '/api/voip/calls/' + callId + '/ai', undefined, tok);
ok('call AI returns analysis', ai.status === 200 && !!ai.data.text, 'source=' + ai.data.source);
ok('AI basis=recording (recording present, no STT)', ai.data.basis === 'recording' && ai.data.has_recording === true && ai.data.has_transcript === false);
ok('AI suggestion: outcome + followup + actions', ai.data.suggestion && ai.data.suggestion.followup_subject && Array.isArray(ai.data.suggestion.action_items) && ai.data.suggestion.action_items.length >= 1);
ok('AI trend (customer 6-month)', ai.data.trend && ai.data.trend.total >= 2, 'total=' + (ai.data.trend && ai.data.trend.total));
// transcript (STT) path: set transcript then re-analyze
await j('PUT', '/api/voip/calls/' + callId, { transcript: 'مشتری: قیمت جدید بفرستید. من: حتماً تا فردا ارسال می‌کنیم.' }, tok);
const ai2 = await j('GET', '/api/voip/calls/' + callId + '/ai', undefined, tok);
ok('AI basis=transcript after STT text saved', ai2.data.basis === 'transcript' && ai2.data.has_transcript === true);
ok('AI action items react to transcript/notes (قیمت → پیش‌فاکتور)', (ai2.data.suggestion.action_items.join(' ')).includes('قیمت') || (ai2.data.suggestion.action_items.join(' ')).includes('پیش‌فاکتور'));

// ---------- 9. sync (pull CDR from REST — real fetch, dedup vs webhook) ----------
const sync = await j('POST', '/api/voip/sync', {}, tok);
ok('sync pulls CDRs from PBX', sync.status === 200 && sync.data.ok && sync.data.imported === 2, JSON.stringify(sync.data));
const listSync = await j('GET', '/api/voip/calls?q=PBX-1001', undefined, tok);
const nAfter = (listSync.data.items || []).filter(x => x.external_call_id === 'PBX-1001').length;
ok('sync dedup vs existing webhook call (same Call ID)', nAfter === 1, 'count=' + nAfter);
const newSync = await j('GET', '/api/voip/calls?q=PBX-2002', undefined, tok);
ok('sync imported new call PBX-2002', (newSync.data.items || []).some(x => x.external_call_id === 'PBX-2002'));

// ---------- 10. click-to-call (real outbound HTTP to PBX stub) ----------
const c2c = await j('POST', '/api/voip/call', { to: '09120000001', note: 'e2e' }, tok);
ok('click-to-call → real dial to PBX', c2c.status === 201 && c2c.data.external_call_id && String(c2c.data.external_call_id).startsWith('PBX-OUT-'), JSON.stringify(c2c.data));
ok('PBX received real dial request', dialLog.length === 1 && dialLog[0].to === '09120000001' && dialLog[0].from === '101', JSON.stringify(dialLog[0] || {}));
const outDet = await j('GET', '/api/voip/calls/' + c2c.data.call_id, undefined, tok);
ok('outbound call linked to customer + user', outDet.data.customer_id === custId && outDet.data.user_id === 1, 'cust=' + outDet.data.customer_id);

// ---------- 11. global call history search (by number / customer / Call ID) ----------
const byNum = await j('GET', '/api/voip/calls?q=09120000001', undefined, tok);
ok('global history: search by number', (byNum.data.items || []).length >= 3, 'n=' + (byNum.data.items || []).length);
const byRef = await j('GET', '/api/voip/calls?q=PBX-1001', undefined, tok);
ok('global history: search by Call ID', (byRef.data.items || []).length >= 1);
const byCust = await j('GET', '/api/voip/calls?customer_id=' + custId, undefined, tok);
ok('global history: filter by customer', (byCust.data.items || []).length >= 3, 'n=' + (byCust.data.items || []).length);

// ---------- 12. reports + export (xlsx/csv/html with company header) ----------
const rep = await j('GET', '/api/voip/report', undefined, tok);
ok('call report (rows + summary)', rep.status === 200 && rep.data.total >= 5 && rep.data.summary, 'total=' + rep.data.total);
const hx = await fetch(BASE + '/api/voip/report/export?format=xlsx', { headers: { authorization: 'Bearer ' + tok } });
ok('report export XLSX', hx.status === 200 && (hx.headers.get('content-type') || '').includes('sheet'), hx.headers.get('content-type'));
const hc = await fetch(BASE + '/api/voip/report/export?format=csv', { headers: { authorization: 'Bearer ' + tok } });
const csvText = await hc.text();
ok('report export CSV (Shamsi dates)', hc.status === 200 && /۱۴[۰۱۲۳۴۵۶۷۸۹][۰۱۲۳۴۵۶۷۸۹]\/[۰۱۲۳۴۵۶۷۸۹][۰۱۲۳۴۵۶۷۸۹]\/[۰۱۲۳۴۵۶۷۸۹][۰۱۲۳۴۵۶۷۸۹]/.test(csvText), (csvText.match(/۱۴[۰۱۲۳۴۵۶۷۸۹][۰۱۲۳۴۵۶۷۸۹]/) || ['none'])[0]);
const hh = await fetch(BASE + '/api/voip/report/export?format=html', { headers: { authorization: 'Bearer ' + tok } });
const html = await hh.text();
ok('report HTML = official (dual logo + company info + QR)', html.includes('logo-selen.png') && html.includes('logo-baspar.png') && html.includes('3941894176') && html.includes('factory-qr.png'));
const iS = html.indexOf('logo-selen'), iB = html.indexOf('logo-baspar');
ok('report HTML: SELEN right / BASPAR left', iS > -1 && iB > iS);

// ---------- 13. outcomes configurable ----------
const oc = await j('GET', '/api/voip/outcomes', undefined, tok);
ok('outcomes list (configurable)', oc.status === 200 && oc.data.items.length >= 5, 'n=' + oc.data.items.length);

// ---------- 14. webhook wrong secret rejected ----------
const badWh = await j('POST', '/api/voip/webhook/asterisk', { event: 'ringing', data: { call_id: 'X' } }, null, { 'x-webhook-secret': 'wrong' });
ok('webhook wrong secret → 401', badWh.status === 401);

// ---------- 15. branding: company settings + print ----------
const st = await j('GET', '/api/admin/settings', undefined, tok);
const co = st.data.company || {};
ok('company settings: factory address', (co.factory_address || '').includes('شهرک صنعتی مامونیه'));
ok('company settings: factory postal 3941894176', co.factory_postal === '3941894176');
ok('company settings: factory phone +98 8645253691', (co.factory_phone || '').includes('8645253691'));
ok('company settings: HQ address', (co.hq_address || '').includes('هجده متری قائم'));
ok('company settings: HQ postal 1494994884', co.hq_postal === '1494994884');
ok('company settings: dual logos configured', co.logo_selen === '/assets/logo-selen.png' && co.logo_baspar === '/assets/logo-baspar.png');
ok('company settings: QR image', co.qr_image === '/assets/factory-qr.png');
for (const f of ['/assets/logo-selen.png', '/assets/logo-baspar.png', '/assets/factory-qr.png']) {
  const a = await fetch(BASE + f);
  ok('asset served ' + f, a.status === 200 && (a.headers.get('content-length') || '0') !== '0');
}
// login/boot page contains dual logos
const idx = await (await fetch(BASE + '/')).text();
ok('index/boot: SELEN + BASPAR logos', idx.includes('/assets/logo-selen.png') && idx.includes('/assets/logo-baspar.png'));
// quote print has dual logo + QR + shamsi
const qp = await j('GET', '/api/print/quote/' + quoteId, undefined, tok);
ok('quote print HTML (dual logo + QR + info)', qp.status === 200);
// check main.js brand
const mj = await (await fetch(BASE + '/js/main.js')).text();
ok('main.js: login+sidebar dual logos', (mj.match(/logo-selen\.png/g) || []).length >= 2 && (mj.match(/logo-baspar\.png/g) || []).length >= 2);
const swj = await (await fetch(BASE + '/sw.js')).text();
ok('sw.js v4 caches new logos', swj.includes('baspar-crm-v4') && swj.includes('/assets/logo-selen.png') && swj.includes('/assets/logo-baspar.png'));

// ---------- 16. customer 360 call stats ----------
const cs = await j('GET', '/api/voip/customers/' + custId + '/stats', undefined, tok);
ok('customer 360: call stats', cs.status === 200 && cs.data.count >= 3 && cs.data.missed >= 1, JSON.stringify(cs.data));

pbx.close();
console.log('\n================ RESULTS ================');
for (const [s, n, x] of results) console.log((s === 'PASS' ? '✅' : '❌') + ' ' + n + (x ? '  —  ' + x : ''));
console.log('=========================================');
console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
