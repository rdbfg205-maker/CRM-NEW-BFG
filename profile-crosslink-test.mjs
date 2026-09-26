// STAGE 7 — Profile personalization + Cross-module linking (planning/calendar ↔ customers ↔ proforma)
// Covers: PUT /api/me, avatar upload (magic-bytes + traversal-safe serving),
// meetings f_customer_id server filter, followups for customer, quote↔customer link.
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0, nt = 0;
const results = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; results.push(['PASS', name, extra]); console.log('✅ ' + name + (extra ? '  —  ' + extra : '')); } else { fail++; results.push(['FAIL', name, extra]); console.log('❌ ' + name + (extra ? '  —  ' + extra : '')); } };
const skip = (name, why) => { nt++; results.push(['NOT-TESTED', name, why]); };

async function req(method, path, body, tok, headers = {}) {
  const h = { ...headers };
  let payload;
  if (body != null) {
    if (body instanceof FormData) { payload = body; }
    else { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  if (tok) h['authorization'] = 'Bearer ' + tok;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  let r;
  try { r = await fetch(BASE + path, { method, headers: h, body: payload, signal: ac.signal }); }
  catch (e) { clearTimeout(timer); console.error('FETCH TIMEOUT/ERR ' + method + ' ' + path + ' :: ' + e.message); throw e; }
  clearTimeout(timer);
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers, text };
}
const j = (m, p, b, t, h) => req(m, p, b, t, h);

// 1x1 transparent PNG
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function main() {
  // ---------- login ----------
  const lg = await j('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  if (lg.status !== 200) throw new Error('LOGIN FAILED (rate limiter? wait 60s)');
  const tok = lg.data.access;
  const me0 = await j('GET', '/api/me', null, tok);
  const orig = { full_name: me0.data.user.full_name, email: me0.data.user.email, phone: me0.data.user.phone, avatar: me0.data.user.avatar };

  // ---------- A. Profile self-service ----------
  let r = await j('PUT', '/api/me', { full_name: 'تست پروفایل نهایی', email: 'verify@baspar-foam.ir', phone: '09120007777' }, tok);
  ok('P1 PUT /api/me → 200 ok', r.status === 200 && r.data.ok === true, JSON.stringify(r.data).slice(0, 120));
  const me1 = await j('GET', '/api/me', null, tok);
  ok('P2 /api/me reflects new name/email/phone',
    me1.data.user.full_name === 'تست پروفایل نهایی' && me1.data.user.email === 'verify@baspar-foam.ir' && me1.data.user.phone === '09120007777',
    JSON.stringify(me1.data.user).slice(0, 160));
  r = await j('PUT', '/api/me', { full_name: '   ' }, tok);
  ok('P3 empty name → 400', r.status === 400, 'status=' + r.status);
  r = await j('PUT', '/api/me', { email: 'not-an-email' }, tok);
  ok('P4 invalid email → 400', r.status === 400, 'status=' + r.status);
  r = await j('PUT', '/api/me', { phone: 'abc!!' }, tok);
  ok('P5 invalid phone → 400', r.status === 400, 'status=' + r.status);
  r = await j('PUT', '/api/me', { full_name: 'x' }, null);
  ok('P6 unauthenticated PUT /api/me → 401', r.status === 401, 'status=' + r.status);

  // ---------- avatar ----------
  const fd = new FormData();
  fd.append('file', new Blob([PNG_1x1], { type: 'image/png' }), 'profile.png');
  r = await j('POST', '/api/me/avatar', fd, tok);
  ok('P7 avatar PNG upload → 200 + url', r.status === 200 && /^\/api\/avatars\/av-\d+-[a-f0-9]{16}\.png$/.test(r.data.avatar || ''), JSON.stringify(r.data));
  const avUrl = r.data.avatar || '';
  const av = await fetch(BASE + avUrl);
  const avBuf = Buffer.from(await av.arrayBuffer());
  ok('P8 GET avatar → 200 image/png + nosniff', av.status === 200 && av.headers.get('content-type') === 'image/png' && av.headers.get('x-content-type-options') === 'nosniff', 'status=' + av.status + ' ct=' + av.headers.get('content-type'));
  ok('P9 avatar bytes round-trip', avBuf.equals(PNG_1x1), 'bytes=' + avBuf.length);
  const me2 = await j('GET', '/api/me', null, tok);
  ok('P10 /api/me.user.avatar = uploaded url', me2.data.user.avatar === avUrl, me2.data.user.avatar);

  const fdBad = new FormData();
  fdBad.append('file', new Blob([Buffer.from('#!/bin/sh\necho pwned\n<html><script>x</script>')], { type: 'image/png' }), 'evil.png');
  r = await j('POST', '/api/me/avatar', fdBad, tok);
  ok('P11 non-image (text as png) → 400 BAD_TYPE', r.status === 400 && (r.data.error || {}).code === 'BAD_TYPE', JSON.stringify(r.data).slice(0, 100));
  const fdSmall = new FormData();
  fdSmall.append('file', new Blob([Buffer.alloc(64, 0)], { type: 'image/png' }), 'zeros.png');
  r = await j('POST', '/api/me/avatar', fdSmall, tok);
  ok('P12 zero-filled fake png → 400 (magic bytes)', r.status === 400 && (r.data.error || {}).code === 'BAD_TYPE', 'status=' + r.status);
  r = await j('GET', '/api/avatars/..%2F..%2Fserver.js', null);
  ok('P13 avatar path traversal → 404', r.status === 404, 'status=' + r.status);
  r = await j('GET', '/api/avatars/av-1-' + 'a'.repeat(16) + '.png', null);
  ok('P14 nonexistent avatar → 404', r.status === 404, 'status=' + r.status);

  // remove avatar
  r = await j('DELETE', '/api/me/avatar', null, tok);
  ok('P16 DELETE /api/me/avatar → 200 + cleared', r.status === 200 && r.data.avatar === '', JSON.stringify(r.data));
  const me3 = await j('GET', '/api/me', null, tok);
  ok('P17 /api/me.avatar empty after delete', me3.data.user.avatar === '', 'avatar=' + JSON.stringify(me3.data.user.avatar));
  const av2 = await fetch(BASE + avUrl);
  ok('P18 avatar file removed from disk', av2.status === 404, 'status=' + av2.status);

  // audit trail
  const aud = await j('GET', '/api/admin/audit?per_page=100', null, tok);
  const audRows = (aud.data && (aud.data.items || aud.data.rows)) || [];
  ok('P15 audit has profile_update + avatar_update',
    audRows.some(x => x.action === 'profile_update') && audRows.some(x => x.action === 'avatar_update'),
    'actions=' + [...new Set(audRows.map(x => x.action))].filter(a => /profile|avatar/.test(a)).join(','));

  // ---------- B. Cross-module: planning/calendar ↔ customer ----------
  // idempotent pre-cleanup (artifacts of previously interrupted runs)
  {
    const qList = await j('GET', '/api/r/customer?per_page=100&q=' + encodeURIComponent('مشتری تست ارتباط-مدولها'), null, tok);
    for (const x of (qList.data.items || [])) { try { await j('DELETE', '/api/r/customer/' + x.id, null, tok); } catch {} }
    const mList = await j('GET', '/api/r/meeting?per_page=100&q=' + encodeURIComponent('جلسه تست ارتباط'), null, tok);
    for (const x of (mList.data.items || [])) { try { await j('DELETE', '/api/r/meeting/' + x.id, null, tok); } catch {} }
    const fList = await j('GET', '/api/r/followup?per_page=200', null, tok);
    for (const x of (fList.data.items || [])) { if (x.subject && x.subject.startsWith('پیگیری تست ارتباط')) { try { await j('DELETE', '/api/r/followup/' + x.id, null, tok); } catch {} } }
    const qList2 = await j('GET', '/api/r/quote?per_page=100&q=' + encodeURIComponent('QT-TEST-XLINK'), null, tok);
    for (const x of (qList2.data.items || [])) { try { await j('DELETE', '/api/r/quote/' + x.id, null, tok); } catch {} }
  }
  // test customer
  let c = await j('POST', '/api/r/customer', { name: 'مشتری تست ارتباط-مدولها', phone: '09121112223' }, tok);
  ok('X1 create test customer', c.status === 200 && c.data && c.data.id, 'id=' + (c.data || {}).id);
  const custId = c.data ? c.data.id : null;

  // meeting linked to customer
  const now = new Date(); now.setHours(now.getHours() + 1);
  const startIso = now.toISOString();
  let m = await j('POST', '/api/r/meeting', { title: 'جلسه تست ارتباط', customer_id: custId, start_at: startIso, location: 'تهران' }, tok);
  ok('X2 create meeting with customer_id', m.status === 200 && m.data && m.data.id, 'id=' + (m.data || {}).id);
  const mtgId = m.data ? m.data.id : null;

  r = await j('GET', `/api/r/meeting?per_page=100&f_customer_id=${custId}`, null, tok);
  ok('X3 meetings f_customer_id filter (server-side) returns the meeting',
    (r.data.items || []).some(x => x.id === mtgId), 'items=' + (r.data.items || []).length);
  r = await j('GET', '/api/r/meeting?per_page=100&f_customer_id=1', null, tok);
  ok('X4 other customer filter does NOT return it', !(r.data.items || []).some(x => x.id === mtgId), 'items=' + (r.data.items || []).length);

  // followup for the customer
  r = await j('POST', '/api/r/followup', { entity_type: 'customer', entity_id: custId, subject: 'پیگیری تست ارتباط', due_at: new Date(Date.now() + 86400000).toISOString() }, tok);
  ok('X5 create followup (entity=customer)', r.status === 200 && r.data && r.data.id, 'id=' + (r.data || {}).id);
  const fuId = r.data ? r.data.id : null;
  r = await j('GET', '/api/r/followup?per_page=200', null, tok);
  ok('X6 followup list contains customer followup (360 tab data path)',
    (r.data.items || []).some(x => x.id === fuId && x.entity_type === 'customer' && Number(x.entity_id) === custId), 'items=' + (r.data.items || []).length);

  // ---------- C. Proforma (quote) ↔ customer ----------
  r = await j('POST', '/api/r/quote', { number: 'QT-TEST-XLINK', customer_id: custId, issue_date: new Date().toISOString().slice(0, 10) }, tok).catch(() => null);
  let quoteId = r && r.data && r.data.id ? r.data.id : null;
  if (!quoteId) {
    // quotes may need items/total via sales API — try plain create with minimal fields
    r = await j('POST', '/api/r/quote', { customer_id: custId }, tok);
    quoteId = r && r.data && r.data.id ? r.data.id : null;
  }
  if (quoteId) {
    const q = await j('GET', '/api/r/quote/' + quoteId, null, tok);
    ok('X7 quote detail carries customer_id (مشتری button target)', q.data.item && q.data.item.customer_id === custId, 'customer_id=' + (q.data.item || {}).customer_id);
    const cc = await j('GET', '/api/r/customer/' + custId, null, tok);
    ok('X8 customer 360 target resolves', cc.status === 200 && cc.data.item && cc.data.item.id === custId, 'name=' + (cc.data.item || {}).name);
    // quote appears in customer 360 quotes tab (server filter)
    r = await j('GET', `/api/r/quote?per_page=50&f_customer_id=${custId}`, null, tok);
    ok('X9 customer 360 «پیش‌فاکتورها» tab data path (f_customer_id)', (r.data.items || []).some(x => x.id === quoteId), 'items=' + (r.data.items || []).length);
  } else {
    skip('X7-X9 quote↔customer', 'quote create requires sales flow (covered by sales-chain suite)');
  }

  // Smart Sales still linked to customers (module presence check)
  r = await j('GET', '/api/smart-sales/actions?limit=5', null, tok);
  ok('X10 Smart Sales actions API live (تیم هوشمند فروش)', r.status === 200 && Array.isArray(r.data.items), 'items=' + (r.data.items || []).length);

  // ---------- cleanup ----------
  try {
    if (fuId) await j('DELETE', '/api/r/followup/' + fuId, null, tok);
    if (mtgId) await j('DELETE', '/api/r/meeting/' + mtgId, null, tok);
    if (quoteId) await j('DELETE', '/api/r/quote/' + quoteId, null, tok);
    if (custId) await j('DELETE', '/api/r/customer/' + custId, null, tok);
    // restore admin profile
    const restore = { full_name: orig.full_name };
    if (orig.email) restore.email = orig.email;
    if (orig.phone) restore.phone = orig.phone;
    await j('PUT', '/api/me', restore, tok);
  } catch { /* best effort */ }

  console.log('\n================ PROFILE + CROSS-LINK SUITE ================');
  for (const [st, n, x] of results) console.log((st === 'PASS' ? '✅' : st === 'FAIL' ? '❌' : '⚪') + ' ' + n + (x ? '  —  ' + x : ''));
  console.log('=========================================');
  console.log(`TOTAL: ${pass + fail} | PASS: ${pass} | FAIL: ${fail} | NOT-TESTED: ${nt}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
