'use strict';
// ============ VoIP / IP-PBX Integration Layer (provider-agnostic) ============
// Real integration surface: REST/SIP/webhook CDR ingestion, call matching to
// Customer Master (customer/contact/lead by phone numbers), call records with
// FK links, recordings behind authentication, reports, dashboard KPIs.
// No mock data anywhere: if a provider is not configured/reachable the API
// reports honest failure — it never fakes a connection.

const { get, getSetting, setSetting, addActivity } = require('../../db/db');
const { requirePerm, scopeWhere } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { notify } = require('../../core/notify');
const { getHub } = require('../../core/messenger');
const { encSecret, decSecret, randomToken } = require('../../lib/crypto');
const { nowIso, toEnDigits, parseId, faDigits, fmtDateLong } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { baseHtml, company, companyHeadHtml } = require('../../lib/print');
const XLSX = require('xlsx');
const generic = require('../generic');
const { R } = require('../resources');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');

const REC_DIR = path.join(__dirname, '..', '..', '..', 'data', 'recordings');
const DEFAULT_OUTCOMES = [
  ['answered', 'پاسخ داده شد'], ['no_answer', 'پاسخ داده نشد'], ['busy', 'مشغول'],
  ['wrong_number', 'شماره اشتباه'], ['follow_up_needed', 'پیگیری لازم است'],
  ['interested', 'مشتری علاقه‌مند است'], ['not_interested', 'مشتری علاقه‌مند نیست'],
  ['call_back', 'تماس مجدد'], ['other', 'سایر'],
];
const SENSITIVE = ['password', 'api_key', 'webhook_secret', 'sip_password'];

// ---------- config ----------
function getCfg() { return getSetting('voip', null); }
function activeCfg() { const c = getCfg(); return c && c.active ? c : null; }
function maskedCfg() {
  const c = getCfg() || { active: 0, connection_type: 'webhook', settings: {} };
  const out = { ...c };
  for (const k of SENSITIVE) {
    if (out[k]) out[k] = '••••' ;
    if (out.settings && out.settings[k]) out.settings[k] = '••••';
  }
  out.has_password = !!(c.password || (c.settings && c.settings.password));
  out.has_api_key = !!(c.api_key || (c.settings && c.settings.api_key));
  out.has_webhook_secret = !!(c.webhook_secret || (c.settings && c.settings.webhook_secret));
  return out;
}
function saveSettings(user, b) {
  requirePerm(user, 'voip_setting', 'edit');
  const cur = getCfg() || {};
  const next = { ...cur, ...(b || {}) };
  // keep existing encrypted secrets when the UI sends back the mask
  for (const k of SENSITIVE) {
    const v = next[k];
    if (v === undefined) delete next[k];
    else if (typeof v === 'string' && (v === '' || v === '••••')) next[k] = cur[k] || '';
    else if (typeof v === 'string' && v && !String(v).startsWith('enc:')) next[k] = encSecret(v);
  }
  setSetting('voip', next);
  audit(user, 'voip_setting', 0, 'update', null, { provider: next.provider, connection_type: next.connection_type, active: next.active ? 1 : 0 }, '');
  return maskedCfg();
}

// ---------- provider helpers ----------
function authHeaders(cfg) {
  const h = { 'Content-Type': 'application/json' };
  const key = decSecret(cfg.api_key || '');
  if (key) { h['Authorization'] = 'Bearer ' + key; if (cfg.auth_header) h[cfg.auth_header] = key; }
  const pw = decSecret(cfg.password || '');
  if (cfg.username && pw && cfg.connection_type === 'rest' && cfg.basic_auth) h['Authorization'] = 'Basic ' + Buffer.from(cfg.username + ':' + pw).toString('base64');
  return h;
}
// minimal SIP OPTIONS probe over UDP (no external deps) — real network check
function probeSip(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const sock = dgram.createSocket('udp4');
    const finish = (ok, detail) => { if (done) return; done = true; try { sock.close(); } catch {} resolve({ ok, detail }); };
    sock.on('message', (msg) => finish(true, String(msg).split('\r\n').slice(0, 3).join(' | ')));
    sock.on('error', (e) => finish(false, e.message));
    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => finish(false, 'timeout'));
    const cid = 'baspar-' + Date.now() + '@crm';
    const pkt = [
      'OPTIONS sip:baspar-crm@' + host + ' SIP/2.0',
      'Via: SIP/2.0/UDP baspar-crm', 'Max-Forwards: 70',
      'From: <sip:probe@baspar-crm>;tag=1', 'To: <sip:' + host + '@' + host + '>',
      'Call-ID: ' + cid, 'CSeq: 1 OPTIONS', 'User-Agent: baspar-foam-crm', 'Content-Length: 0', '', '',
    ].join('\r\n');
    try { sock.send(Buffer.from(pkt), port, host, () => {}); } catch (e) { finish(false, e.message); }
  });
}
async function testConnection(user) {
  requirePerm(user, 'voip_setting', 'view');
  const cfg = getCfg();
  if (!cfg || !cfg.active) return { ok: false, mode: 'none', message: 'VoIP فعال نشده است — ابتدا پیکربندی و فعال‌سازی کنید.' };
  const t0 = Date.now();
  if (cfg.connection_type === 'rest' && cfg.api_url) {
    try {
      const res = await fetch(cfg.api_url, { method: 'GET', headers: authHeaders(cfg), signal: AbortSignal.timeout(8000), redirect: 'manual' });
      const ok = res.status < 500;
      console.log('[voip] connection test: ' + cfg.api_url + ' → HTTP ' + res.status + ' (' + (Date.now() - t0) + 'ms)');
      return { ok, mode: 'rest', http_status: res.status, ms: Date.now() - t0, message: ok ? 'اتصال برقرار است (HTTP ' + res.status + ')' : 'PBX خطا پاسخ داد (HTTP ' + res.status + ')' };
    } catch (e) {
      console.error('[voip] connection test failed: ' + e.message);
      return { ok: false, mode: 'rest', ms: Date.now() - t0, message: 'Connection Failed — اتصال برقرار نیست: ' + e.message };
    }
  }
  if (cfg.connection_type === 'sip' && cfg.sip_server) {
    try {
      const r = await probeSip(cfg.sip_server, Number(cfg.sip_port) || 5060, 3000);
      if (r.ok) console.log('[voip] SIP probe OK: ' + r.detail);
      else console.error('[voip] SIP probe failed: ' + r.detail);
      return { ok: r.ok, mode: 'sip', message: r.ok ? 'اتصال برقرار است — SIP پاسخ داد' : 'Connection Failed — پاسخی از SIP دریافت نشد (' + r.detail + ')' };
    } catch (e) {
      console.error('[voip] SIP probe error: ' + e.message);
      return { ok: false, mode: 'sip', message: 'Connection Failed: ' + e.message };
    }
  }
  // webhook-only: the CRM is a receiver; there is nothing to probe outbound.
  return { ok: true, mode: 'webhook', message: 'Webhook فعال است — CRM آمادهٔ دریافت رویدادهای تماس (ringing/answered/ended/missed/recording_ready) است. اتصال خروجی برای این روش قابل پrobe نیست.' };
}

// ---------- phone matching against Customer Master ----------
function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length > 10) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}
function normMap(rows, cols) {
  const m = new Map();
  for (const r of rows) for (const c of cols) {
    const n = normPhone(r[c]);
    if (n && !m.has(n)) m.set(n, { row: r, col: c });
  }
  return m;
}
// returns { customer_id, contact_id, lead_id, matched_by } — never invents a customer
function matchNumbers(d, number) {
  const n = normPhone(number);
  if (!n) return null;
  const contacts = d.prepare(`SELECT id, customer_id, name, phone, mobile FROM customer_contacts`).all();
  const custs = d.prepare(`SELECT id, name, number, phone, mobile, phone2, salesperson_id, status FROM customers WHERE archived_at IS NULL`).all();
  const leads = d.prepare(`SELECT id, company, phone FROM leads WHERE archived_at IS NULL`).all();
  const cm = normMap(contacts, ['phone', 'mobile']);
  if (cm.has(n)) { const c = cm.get(n); return { customer_id: c.row.customer_id || null, contact_id: c.row.id, lead_id: null, matched_by: 'contact_' + c.col }; }
  const kum = normMap(custs, ['mobile', 'phone', 'phone2']);
  if (kum.has(n)) { const c = kum.get(n); return { customer_id: c.row.id, contact_id: null, lead_id: null, matched_by: 'customer_' + c.col, salesperson_id: c.row.salesperson_id }; }
  const lm = normMap(leads, ['phone']);
  if (lm.has(n)) { const l = lm.get(n); return { customer_id: null, contact_id: null, lead_id: l.row.id, matched_by: 'lead_phone' }; }
  return null;
}
function customerSummary(d, id) {
  return d.prepare(`SELECT c.id, c.name, c.number, c.phone, c.mobile, c.status, u.full_name salesperson_name FROM customers c LEFT JOIN users u ON u.id=c.salesperson_id WHERE c.id=?`).get(id);
}

// ---------- CDR normalization (accepts common PBX payload shapes) ----------
function toIso(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const s = String(v).trim();
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function extractCdr(p) {
  const g = (...ks) => { for (const k of ks) if (p && p[k] !== undefined && p[k] !== null && p[k] !== '') return p[k]; return undefined; };
  const dirRaw = String(g('direction', 'dir', 'type', 'call_direction') || 'inbound').toLowerCase();
  return {
    external_call_id: String(g('call_id', 'external_call_id', 'uuid', 'cid', 'call_uuid', 'uniqueid') || ''),
    direction: (dirRaw === 'in' || dirRaw === 'inbound' || dirRaw === 'incoming') ? 'inbound' : 'outbound',
    caller: String(g('from', 'src', 'caller', 'from_num', 'callerid', 'callerid_number', 'src_number') || ''),
    called: String(g('to', 'dst', 'callee', 'to_num', 'dst_number', 'calleeid') || ''),
    extension: String(g('extension', 'ext', 'agent_ext', 'exten') || ''),
    start: toIso(g('start', 'startTime', 'start_time', 'started_at', 'calldate', 'q850_call_setup_time')),
    answer: toIso(g('answer', 'answerTime', 'answer_time', 'answered_at', 'answerdate')),
    end: toIso(g('end', 'endTime', 'end_time', 'ended_at', 'release_time', 'stop_time')),
    duration: Number(toEnDigits(String(g('duration', 'dur', 'seconds', 'billsec', 'talk_time') || '0'))) || 0,
    status: g('status', 'state', 'disposition', 'call_status', 'result'),
    recording: g('recording', 'recordingFile', 'recording_file', 'recording_url', 'recording_id', 'recordingid'),
    agent: g('agent', 'agent_id', 'user_id', 'agent_number'),
  };
}
function finalStatus(cdr) {
  const s = String(cdr.status || '').toLowerCase();
  if (s.includes('busy')) return 'busy';
  if (s.includes('no answer') || s.includes('noanswer') || s.includes('unanswered')) return 'no_answer';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('missed')) return 'missed';
  return 'ended';
}
// upsert a call from a CDR (dedup by provider+external_call_id; safe for late sync)
function upsertFromCdr(actor, provider, cdr, eventType) {
  const d = get();
  const ext = cdr.external_call_id;
  // dedup: PBX Call IDs (UUID/uniqueid) are globally unique — lookup across provider
  // labels (webhook URL slug and config provider may legitimately differ)
  let row = ext ? d.prepare(`SELECT * FROM voip_calls WHERE external_call_id=? ORDER BY id LIMIT 1`).get(ext) : null;
  // delayed-duplicate guard: same caller+start within 2 min (any provider)
  if (!row && cdr.start) {
    row = d.prepare(`SELECT * FROM voip_calls WHERE caller=? AND started_at IS NOT NULL AND started_at >= datetime(?) AND started_at <= datetime(?) ORDER BY id LIMIT 1`)
      .get(cdr.caller, new Date(new Date(cdr.start).getTime() - 120000).toISOString(), new Date(new Date(cdr.start).getTime() + 120000).toISOString());
  }
  const isNew = !row;
  if (!row) {
    const ref = 'VC-' + String(d.prepare(`SELECT COUNT(*) c FROM voip_calls`).get().c + 1).padStart(5, '0');
    const info = d.prepare(`INSERT INTO voip_calls(external_call_id, call_ref, provider, direction, status, caller, called, extension, started_at, raw, created_at, synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ext || null, ref, provider, cdr.direction, eventType === 'ringing' ? 'ringing' : 'ringing', cdr.caller, cdr.called, cdr.extension, cdr.start || nowIso(), JSON.stringify(cdr).slice(0, 4000), nowIso(), nowIso());
    row = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(Number(info.lastInsertRowid));
  } else {
    // update in place (late events / corrections) — keep first created_at
    const sets = []; const args = [];
    if (cdr.caller && !row.caller) { sets.push('caller=?'); args.push(cdr.caller); }
    if (cdr.called && !row.called) { sets.push('called=?'); args.push(cdr.called); }
    if (cdr.extension && !row.extension) { sets.push('extension=?'); args.push(cdr.extension); }
    if (cdr.start && !row.started_at) { sets.push('started_at=?'); args.push(cdr.start); }
    sets.push('synced_at=?'); args.push(nowIso());
    if (sets.length) { d.prepare(`UPDATE voip_calls SET ${sets.join(',')} WHERE id=?`).run(...args, row.id); row = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(row.id); }
  }
  applyEvent(d, row, cdr, eventType, isNew);
  return { id: row.id, created: isNew };
}
function applyEvent(d, row, cdr, eventType, isNew) {
  let dirty = {};
  const TERMINAL = new Set(['missed', 'no_answer', 'busy', 'cancelled', 'ended']);
  const statusMap = { ringing: 'ringing', answered: 'answered', missed: 'missed' };
  if (statusMap[eventType]) {
    // forward-only transitions (late/duplicate ringing must not downgrade a terminal call)
    const tgt = statusMap[eventType];
    if (!TERMINAL.has(row.status) && row.status !== tgt) dirty.status = tgt;
    if (eventType === 'answered' && cdr.answer && !row.answered_at) dirty.answered_at = cdr.answer;
  } else if (eventType === 'ended' || (!statusMap[eventType] && cdr.end)) {
    if (cdr.answer && !row.answered_at) dirty.answered_at = cdr.answer;
    if (cdr.end) dirty.ended_at = cdr.end;
    if (cdr.duration) dirty.duration_sec = cdr.duration;
    if (!TERMINAL.has(row.status)) {
      const fs = finalStatus(cdr);
      dirty.status = row.answered_at || dirty.answered_at || cdr.answer ? fs : (['missed', 'no_answer', 'busy', 'cancelled'].includes(fs) ? fs : 'no_answer');
    }
  } else if (eventType === 'recording_ready') {
    if (cdr.recording) {
      dirty.recording_id = String(cdr.recording);
      dirty.recording_ready = 1;
      // link the file: absolute path (PBX box) → copy under data/recordings;
      // relative name → resolve inside data/recordings (traversal-safe basename)
      const p = String(cdr.recording);
      let src = null;
      if (p.startsWith('/')) { if (fs.existsSync(p)) src = p; }
      else { const cand = path.join(REC_DIR, path.basename(p)); if (fs.existsSync(cand)) src = cand; }
      if (src) {
        try {
          fs.mkdirSync(REC_DIR, { recursive: true });
          const dest = path.join(REC_DIR, path.basename(src));
          if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
          dirty.recording_file = dest;
        } catch (e) { console.error('[voip] recording move failed: ' + e.message); }
      }
    }
  }
  if (Object.keys(dirty).length) {
    d.prepare(`UPDATE voip_calls SET ${Object.keys(dirty).map(k => k + '=?').join(',')} WHERE id=?`).run(...Object.values(dirty), row.id);
  }
  const cur = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(row.id);

  // matching on first arrival / when still unmatched
  if (!cur.customer_id && !cur.lead_id) {
    const m = matchNumbers(d, cur.caller || cur.called);
    if (m && (m.customer_id || m.lead_id || m.contact_id)) {
      d.prepare(`UPDATE voip_calls SET customer_id=?, contact_id=?, lead_id=?, matched_by=? WHERE id=?`)
        .run(m.customer_id || null, m.contact_id || null, m.lead_id || null, m.matched_by, cur.id);
      cur.customer_id = m.customer_id || null; cur.contact_id = m.contact_id || null; cur.lead_id = m.lead_id || null; cur.matched_by = m.matched_by;
      if (m.salesperson_id) { cur._salesperson = m.salesperson_id; }
    }
  }
  // agent user (outbound or webhook-provided)
  if (cur.direction === 'outbound' && cur.user_id) { /* kept from click-to-call */ }

  const dirFa = cur.direction === 'inbound' ? 'ورودی' : 'خروجی';
  // timeline + notifications on terminal events
  if (eventType === 'ended' || eventType === 'missed' || (isNew && ['answered', 'ringing'].includes(cur.status))) {
    if (cur.customer_id) {
      const cs = customerSummary(d, cur.customer_id);
      const title = cur.status === 'missed' ? '🔴 تماس از دست‌رفته' : '☎️ تماس ' + dirFa;
      const body = `${cs ? cs.name : ''} — ${cur.caller || cur.called || ''}${cur.duration_sec ? ' — ' + Math.floor(cur.duration_sec / 60) + ' دقیقه' : ''}`;
      addActivity('customer', cur.customer_id, cur.user_id || 0, 'call', title, { call_id: cur.id, direction: cur.direction, status: cur.status, number: cur.caller || cur.called, duration: cur.duration_sec });
      const sp = cur._salesperson || (cs && cs.salesperson_id);
      if (sp) notify(sp, cur.status === 'missed' ? 'call_missed' : 'call_in', cur.status === 'missed' ? '🔴 تماس از دست رفت' : '☎️ تماس ' + dirFa, body, 'voip_call', cur.id);
      // real-time push if online
      try { if (sp) getHub().sendToUser(sp, { type: 'voip_call', call: { id: cur.id, direction: cur.direction, status: cur.status, customer: cs && cs.name, number: cur.caller || cur.called } }); } catch {}
    }
    if (cur.lead_id) addActivity('lead', cur.lead_id, cur.user_id || 0, 'call', title, { call_id: cur.id, direction: cur.direction, status: cur.status });
  }
  return cur;
}
// webhook entry (no user auth — shared secret)
function webhook(provider, payload, secret) {
  const cfg = getCfg();
  const expected = decSecret((cfg && cfg.webhook_secret) || '');
  if (!expected) throw new HttpError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook VoIP فعال نیست — ابتدا Webhook Secret را در تنظیمات VoIP تعریف کنید.');
  if (secret !== expected) throw new HttpError(401, 'UNAUTHORIZED', 'Webhook secret نامعتبر است.');
  const event = String((payload && payload.event) || (payload && payload.type) || '');
  const data = (payload && (payload.data || payload.cdr || payload)) || payload || {};
  const cdr = extractCdr(data);
  const evt = ['ringing', 'answered', 'ended', 'missed', 'recording_ready'].includes(event) ? event : (cdr.end || data.end ? 'ended' : (event === 'in' || data.start ? 'ringing' : 'ended'));
  const { id, created } = upsertFromCdr(null, provider, cdr, evt);
  return { ok: true, call_id: id, created, event: evt };
}

// ---------- list / detail / update ----------
// scope for calls: 'own' = my agent calls + calls matched to MY customers/leads
// (incoming CDRs often have no agent yet, so a plain user_id scope would hide them)
function callsScopeWhere(user, scope) {
  if (scope === 'all') return { where: '', params: [] };
  // unqualified columns: the query may alias the table (AS v) — both forms work
  return {
    where: `(user_id = ? OR customer_id IN (SELECT id FROM customers WHERE salesperson_id = ?) OR lead_id IN (SELECT id FROM leads WHERE salesperson_id = ?))`,
    params: [user.id, user.id, user.id],
  };
}
function callVisibleTo(user, scope, row) {
  if (scope === 'all') return true;
  if (row.user_id && Number(row.user_id) === user.id) return true;
  if (row.customer_id) { const c = customerSummary(get(), row.customer_id); if (c && Number(c.salesperson_id) === user.id) return true; }
  if (row.lead_id) { const l = get().prepare(`SELECT salesperson_id FROM leads WHERE id=?`).get(row.lead_id); if (l && Number(l.salesperson_id) === user.id) return true; }
  return false;
}
function listCalls(user, q) {
  const p = requirePerm(user, 'voip_call', 'view');
  const d = get();
  const where = ['1=1']; const args = [];
  const sc = callsScopeWhere(user, p);
  if (sc.where) { where.push(sc.where); args.push(...sc.params); }
  if (q.from) { where.push('COALESCE(started_at, created_at) >= ?'); args.push(q.from); }
  if (q.to) { where.push('COALESCE(started_at, created_at) <= ?'); args.push(q.to); }
  if (q.customer_id) { where.push('customer_id = ?'); args.push(parseId(q.customer_id)); }
  if (q.contact_id) { where.push('contact_id = ?'); args.push(parseId(q.contact_id)); }
  if (q.user_id) { where.push('user_id = ?'); args.push(parseId(q.user_id)); }
  if (q.direction) { where.push('direction = ?'); args.push(q.direction); }
  if (q.status) { where.push('status = ?'); args.push(q.status); }
  if (q.outcome) { where.push('outcome = ?'); args.push(q.outcome); }
  if (q.extension) { where.push('(extension = ? OR agent_extension = ?)'); args.push(q.extension, q.extension); }
  if (q.min_duration) { where.push('duration_sec >= ?'); args.push(Number(q.min_duration) || 0); }
  if (q.missed_only === '1') { where.push("status = 'missed'"); }
  if (q.q) {
    // global search: number / customer (name|code) / user / internal Call ID / external PBX Call ID / extension
    const term = '%' + String(q.q).replace(/[\\%_]/g, m => '\\' + m) + '%';
    where.push(`(caller LIKE ? OR called LIKE ? OR call_ref LIKE ? OR external_call_id LIKE ? OR extension LIKE ?
      OR EXISTS(SELECT 1 FROM customers c2 WHERE c2.id=customer_id AND (c2.name LIKE ? OR c2.number LIKE ?))
      OR EXISTS(SELECT 1 FROM customer_contacts x2 WHERE x2.id=contact_id AND (x2.name LIKE ? OR x2.mobile LIKE ? OR x2.phone LIKE ?))
      OR EXISTS(SELECT 1 FROM users u2 WHERE u2.id=user_id AND (u2.full_name LIKE ? OR u2.username LIKE ?)))`);
    args.push(term, term, term, term, term, term, term, term, term, term, term, term);
  }
  const perPage = Math.min(parseInt(q.per_page) || 50, 200);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const total = d.prepare(`SELECT COUNT(*) c FROM voip_calls WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = d.prepare(`SELECT v.* FROM voip_calls v WHERE ${where.join(' AND ')} ORDER BY COALESCE(started_at, created_at) DESC LIMIT ? OFFSET ?`).all(...args, perPage, (page - 1) * perPage);
  decorate(d, rows);
  return { items: rows, total, page, pages: Math.ceil(total / perPage) || 1 };
}
function decorate(d, rows) {
  const cids = [...new Set(rows.map(r => r.customer_id).filter(Boolean))];
  const xids = [...new Set(rows.map(r => r.contact_id).filter(Boolean))];
  const uids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const lds = [...new Set(rows.map(r => r.lead_id).filter(Boolean))];
  const cMap = cids.length ? Object.fromEntries(d.prepare(`SELECT id, name, number FROM customers WHERE id IN (${cids.map(() => '?').join(',')})`).all(...cids).map(x => [x.id, x])) : {};
  const xMap = xids.length ? Object.fromEntries(d.prepare(`SELECT id, name, customer_id FROM customer_contacts WHERE id IN (${xids.map(() => '?').join(',')})`).all(...xids).map(x => [x.id, x])) : {};
  const uMap = uids.length ? Object.fromEntries(d.prepare(`SELECT id, full_name FROM users WHERE id IN (${uids.map(() => '?').join(',')})`).all(...uids).map(x => [x.id, x.full_name])) : {};
  const lMap = lds.length ? Object.fromEntries(d.prepare(`SELECT id, company FROM leads WHERE id IN (${lds.map(() => '?').join(',')})`).all(...lds).map(x => [x.id, x.company])) : {};
  for (const r of rows) {
    r.customer_name = cMap[r.customer_id] ? cMap[r.customer_id].name : null;
    r.customer_number = cMap[r.customer_id] ? cMap[r.customer_id].number : null;
    r.contact_name = xMap[r.contact_id] ? xMap[r.contact_id].name : null;
    r.user_name = uMap[r.user_id] || null;
    r.lead_name = lMap[r.lead_id] || null;
  }
}
function callDetail(user, id) {
  const p = requirePerm(user, 'voip_call', 'view');
  const d = get();
  const row = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'تماس پیدا نشد.');
  if (!callVisibleTo(user, p, row)) throw new HttpError(403, 'FORBIDDEN', 'دسترسی به این تماس ندارید.');
  decorate(d, [row]);
  if (row.customer_id) { const cs = customerSummary(d, row.customer_id); row.customer_summary = cs; }
  row.history = d.prepare(`SELECT a.*, u.full_name username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity='voip_call' AND a.entity_id=? ORDER BY a.id DESC LIMIT 20`).all(row.id);
  return row;
}
function updateCall(user, id, b) {
  const p = requirePerm(user, 'voip_call', 'edit');
  const d = get();
  const row = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'تماس پیدا نشد.');
  if (p === 'own' && row.user_id && Number(row.user_id) !== user.id) throw new HttpError(403, 'FORBIDDEN', 'فقط می‌توانید تماس‌های خود را ویرایش کنید.');
  const allowed = ['notes', 'outcome', 'outcome_fa', 'opportunity_id', 'ticket_id', 'complaint_id', 'contract_id', 'followup_id', 'user_id', 'extension', 'status', 'transcript'];
  const changes = {};
  const sets = []; const args = [];
  for (const k of allowed) {
    if (b[k] === undefined) continue;
    const v = k.endsWith('_id') ? (b[k] === null || b[k] === '' ? null : parseId(b[k])) : (b[k] === '' ? null : b[k]);
    if (k === 'opportunity_id' && v) checkRefExists(d, 'opportunities', v, 'فرصت فروش');
    if (k === 'ticket_id' && v) checkRefExists(d, 'tickets', v, 'تیکت');
    if (k === 'complaint_id' && v) checkRefExists(d, 'complaints', v, 'شکایت');
    if (k === 'contract_id' && v) checkRefExists(d, 'contracts', v, 'قرارداد');
    if (k === 'followup_id' && v) checkRefExists(d, 'followups', v, 'پیگیری');
    if (k === 'user_id' && v) checkRefExists(d, 'users', v, 'کاربر');
    if (k === 'outcome') {
      const list = outcomes();
      const o = list.find(x => x.v === b.outcome);
      if (b.outcome && !o) throw new HttpError(422, 'VALIDATION', 'نتیعهٔ انتخاب‌شده معتبر نیست.');
      if (o) b.outcome_fa = o.l;
    }
    if (JSON.stringify(v) !== JSON.stringify(row[k])) { changes[k] = { from: row[k], to: v }; sets.push(k + '=?'); args.push(v); }
  }
  if (!sets.length) return { ok: true, changed: false };
  d.prepare(`UPDATE voip_calls SET ${sets.join(',')} WHERE id=?`).run(...args, row.id);
  audit(user, 'voip_call', row.id, 'update', changes, null, '');
  return { ok: true, changed: true };
}
function checkRefExists(d, table, id, label) {
  if (!d.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id)) throw new HttpError(422, 'VALIDATION', label + ' با این شناسه پیدا نشد.');
}
// create a Follow-up from a call (entity = customer/lead the call was matched to)
function createFollowupFromCall(user, id, b) {
  requirePerm(user, 'voip_call', 'edit');
  const d = get();
  const row = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'تماس پیدا نشد.');
  const subject = String(b.subject || '').trim() || ('پیگیری تماس ' + (row.call_ref || '#' + row.id) + ' — ' + (row.caller || row.called || ''));
  const entityId = row.customer_id || row.lead_id || row.ticket_id || 0;
  const entityType = row.customer_id ? 'customer' : row.lead_id ? 'lead' : row.ticket_id ? 'ticket' : 'other';
  const fbody = {
    entity_type: entityType, entity_id: entityId, subject,
    user_id: b.user_id ? Number(b.user_id) : (row.user_id || user.id),
    due_at: b.due_at || new Date(Date.now() + 864e5).toISOString(),
    note: b.note || ('از تماس ' + (row.call_ref || row.id) + ': ' + (row.notes || '')),
    status: 'pending',
  };
  const fid = generic.create(R.followup, user, fbody);
  d.prepare(`UPDATE voip_calls SET followup_id=? WHERE id=?`).run(fid, row.id);
  audit(user, 'voip_call', row.id, 'link_followup', null, { followup_id: fid }, '');
  addActivity('followup', fid, user.id, 'create', 'ایجاد شد از تماس ' + (row.call_ref || row.id));
  notify(fbody.user_id, 'followup_created', 'پیگیری جدید از تماس', subject, 'followup', fid);
  return { followup_id: fid };
}
// register a NEW customer from an unknown call (uses the real Customer Master create path + dup check)
function attachCustomerFromCall(user, id, b) {
  const d = get();
  const row = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(parseId(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'تماس پیدا نشد.');
  const phone = (b.phone || row.caller || row.called || '');
  const body = {
    name: String(b.name || '').trim(),
    number: b.number || null,
    phone: String(phone).includes('09') ? null : (b.phone && !String(b.phone).startsWith('09') ? b.phone : null),
    mobile: String(phone).startsWith('09') ? phone : (b.mobile || null),
    address: b.address || null, city: b.city || null, province: b.province || null,
    type: b.type || 'company', status: 'active', notes: b.notes || 'ثبت‌شده از تماس ' + (row.call_ref || row.id),
  };
  if (!body.name) throw new HttpError(422, 'VALIDATION', 'نام مشتری الزامی است.');
  const cid = generic.create(R.customer, user, body);
  d.prepare(`UPDATE voip_calls SET customer_id=?, matched_by='manual' WHERE id=?`).run(cid, row.id);
  audit(user, 'voip_call', row.id, 'attach_customer', { customer_id: row.customer_id }, { customer_id: cid }, 'ثبت مشتری جدید از تماس');
  const cs = customerSummary(d, cid);
  addActivity('customer', cid, user.id, 'call', '☎️ اولین تماس (از تماس ناشناس ثبت شد)', { call_id: row.id, number: row.caller || row.called });
  return { customer_id: cid, name: cs && cs.name };
}

// ---------- click-to-call (only when provider truly supports it) ----------
async function clickToCall(user, to, note) {
  const cfg = activeCfg();
  if (!cfg) throw new HttpError(503, 'VOIP_NOT_CONFIGURED', 'VoIP فعال نیست — ابتدا در Settings ← Integrations ← VoIP پیکربندی و فعال کنید.');
  const n = normPhone(to);
  if (!n) throw new HttpError(422, 'VALIDATION', 'شمارهٔ معتبر وارد کنید.');
  // dial number: keep the form the PBX trunk expects (local 0-prefixed / international 0098),
  // while normalized `n` is used for Customer Master matching
  const raw = String(to || '').replace(/\D/g, '');
  let dial = raw;
  if (/^9\d{9}$/.test(raw)) dial = '0' + raw; // bare 9xxxxxxxxx → local 09xxxxxxxxx
  if (!dial) throw new HttpError(422, 'VALIDATION', 'شمارهٔ معتبر وارد کنید.');
  const d = get();
  // match caller to Customer Master so the outbound call is linked too
  const match = matchNumbers(d, n);
  const ext = String(cfg.extension || user.phone || '');
  if (cfg.connection_type === 'rest' && cfg.api_url) {
    const url = cfg.api_url.replace(/\/$/, '') + (cfg.dial_path || '/dial');
    const res = await fetch(url, { method: 'POST', headers: authHeaders(cfg), body: JSON.stringify({ from: ext, to: dial, note: note || '' }), signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, 'PROVIDER_ERROR', 'PBX خطا پاسخ داد (HTTP ' + res.status + '): ' + JSON.stringify(body).slice(0, 200));
    const external = String(body.call_id || body.callId || body.uuid || body.uniqueid || '');
    const info = d.prepare(`INSERT INTO voip_calls(external_call_id, call_ref, provider, direction, status, called, extension, agent_extension, user_id, customer_id, contact_id, lead_id, matched_by, started_at, raw, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(external || null, 'VC-' + String(d.prepare('SELECT COUNT(*) c FROM voip_calls').get().c + 1).padStart(5, '0'), cfg.provider || 'rest', 'outbound', 'ringing', dial, ext, ext, user.id,
        (match && match.customer_id) || null, (match && match.contact_id) || null, (match && match.lead_id) || null, match ? match.matched_by : null, nowIso(), JSON.stringify(body).slice(0, 2000), nowIso());
    const cid = Number(info.lastInsertRowid);
    addActivity('user', user.id, user.id, 'call', '☎️ تماس خروجی به ' + n, { call_id: cid });
    return { call_id: cid, external_call_id: external || null, status: 'ringing', provider: cfg.provider || 'rest' };
  }
  if (cfg.connection_type === 'sip') {
    throw new HttpError(409, 'NOT_SUPPORTED_BY_MODE', 'در حالت SIP مستقیم، Click-to-Call از سمت وب انجام نمی‌شود — با Extension خود (دریافتی از تنظیمات) زنگ بزنید. تماس در CDR به‌صورت خودکار ثبت می‌شود.');
  }
  throw new HttpError(409, 'NOT_SUPPORTED_BY_MODE', 'این روش اتصال (Webhook-only) قابلیت Click-to-Call فعال ندارد.');
}

// ---------- sync (pull CDRs from REST provider; dedup by external call id) ----------
async function sync(user) {
  if (user) requirePerm(user, 'voip_setting', 'view'); // null user = system auto-sync
  const cfg = activeCfg();
  if (!cfg) return { ok: false, reason: 'not_configured', message: 'VoIP فعال نیست — سینک در دسترس نیست.' };
  if (cfg.connection_type !== 'rest' || !cfg.api_url) return { ok: false, reason: 'not_supported', message: 'سینک فقط برای اتصال REST با URL معتبر انجام می‌شود (در حالت Webhook، تماس‌ها خودکار دریافت می‌شوند).' };
  const since = cfg.last_sync_at || new Date(Date.now() - 3600e3).toISOString();
  const url = cfg.api_url.replace(/\/$/, '') + (cfg.cdr_path || '/cdr') + '?since=' + encodeURIComponent(since);
  const res = await fetch(url, { headers: authHeaders(cfg), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new HttpError(502, 'PROVIDER_ERROR', 'PBX پاسخ نداد (HTTP ' + res.status + ')');
  const body = await res.json().catch(() => ({}));
  const cdrs = Array.isArray(body) ? body : (body.cdrs || body.calls || body.items || body.data || []);
  let n = 0;
  for (const c of cdrs) { try { upsertFromCdr(user, cfg.provider || 'rest', extractCdr(c), 'ended'); n++; } catch (e) { console.error('[voip] sync item failed: ' + e.message); } }
  const cur = getCfg() || {};
  setSetting('voip', { ...cur, last_sync_at: nowIso() });
  audit(user, 'voip_setting', 0, 'sync', null, { imported: n, since }, '');
  return { ok: true, imported: n, since };
}
// scheduler hook — runs only when REST+auto_sync enabled; never crashes the tick
async function maybeSync() {
  const cfg = getCfg();
  if (!cfg || !cfg.active || cfg.connection_type !== 'rest' || !cfg.api_url || !cfg.auto_sync) return;
  const last = new Date(cfg.last_sync_at || 0).getTime();
  const everyMin = Number(cfg.sync_interval_min) || 5;
  if (Date.now() - last < everyMin * 60000) return;
  try { await sync(null); } catch (e) { console.error('[voip] auto sync: ' + e.message); }
}

// ---------- dashboard KPIs ----------
function dashboard() {
  const d = get();
  const today = new Date(); const t0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).toISOString();
  const t1 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)).toISOString();
  const q = (s, ...a) => d.prepare(s).get(...a);
  const todayCalls = q(`SELECT COUNT(*) c FROM voip_calls WHERE COALESCE(started_at, created_at) >= ? AND COALESCE(started_at, created_at) < ?`, t0, t1);
  const inT = q(`SELECT COUNT(*) c FROM voip_calls WHERE direction='inbound' AND COALESCE(started_at, created_at) >= ? AND COALESCE(started_at, created_at) < ?`, t0, t1);
  const outT = q(`SELECT COUNT(*) c FROM voip_calls WHERE direction='outbound' AND COALESCE(started_at, created_at) >= ? AND COALESCE(started_at, created_at) < ?`, t0, t1);
  const missedT = q(`SELECT COUNT(*) c FROM voip_calls WHERE status='missed' AND COALESCE(started_at, created_at) >= ? AND COALESCE(started_at, created_at) < ?`, t0, t1);
  const talkT = q(`SELECT COALESCE(SUM(duration_sec),0) s FROM voip_calls WHERE COALESCE(started_at, created_at) >= ? AND COALESCE(started_at, created_at) < ?`, t0, t1);
  const byUser = d.prepare(`SELECT u.full_name, u.id, COUNT(*) c, COALESCE(SUM(v.duration_sec),0) s FROM voip_calls v LEFT JOIN users u ON u.id=v.user_id WHERE v.user_id IS NOT NULL AND COALESCE(v.started_at, v.created_at) >= ? GROUP BY v.user_id ORDER BY c DESC LIMIT 5`).all(t0);
  const unfollowed = q(`SELECT COUNT(*) c FROM voip_calls WHERE status='missed' AND followup_id IS NULL`);
  const series = d.prepare(`SELECT substr(COALESCE(started_at, created_at),1,10) day, COUNT(*) c FROM voip_calls WHERE COALESCE(started_at, created_at) >= datetime('now','-7 day') GROUP BY day ORDER BY day`).all();
  return {
    today: todayCalls.c, inbound: inT.c, outbound: outT.c, missed: missedT.c, talk_sec: talkT.s,
    by_user: byUser, unfollowed: unfollowed.c, series,
    total: q(`SELECT COUNT(*) c FROM voip_calls`).c,
  };
}

// ---------- report + exports ----------
function report(user, q) {
  const p = requirePerm(user, 'voip_call', 'view');
  const list = listCalls(user, q);
  const rows = list.items.map(r => ({
    id: r.id, call_ref: r.call_ref,
    date: r.started_at || r.created_at,
    direction: r.direction, direction_fa: r.direction === 'inbound' ? 'ورودی' : 'خروجی',
    status: r.status, status_fa: { ringing: 'در حال زنگ', answered: 'پاسخ داده شد', missed: 'از دست‌رفته', no_answer: 'پاسخ نداد', busy: 'مشغول', cancelled: 'لغو', ended: 'پایان' }[r.status] || r.status,
    outcome_fa: r.outcome_fa || r.outcome || '',
    caller: r.caller || '', called: r.called || '', extension: r.extension || r.agent_extension || '',
    user: r.user_name || '', customer: r.customer_name || '', customer_number: r.customer_number || '', contact: r.contact_name || '',
    duration_sec: r.duration_sec || 0,
    opportunity: r.opportunity_id || '', followup: r.followup_id || '',
  }));
  const summary = {
    total: list.total,
    by_direction: { inbound: 0, outbound: 0 }, by_status: {},
    talk_sec: rows.reduce((s, r) => s + r.duration_sec, 0),
    by_user: {},
  };
  for (const r of rows) {
    summary.by_direction[r.direction] = (summary.by_direction[r.direction] || 0) + 1;
    summary.by_status[r.status] = (summary.by_status[r.status] || 0) + 1;
    if (r.user) summary.by_user[r.user] = (summary.by_user[r.user] || 0) + 1;
  }
  return { rows, summary, total: list.total, pages: list.pages, page: list.page };
}
function exportReport(user, q, format) {
  requirePerm(user, 'voip_call', 'export');
  const rep = report(user, q);
  const headers = ['شناسه', 'تاریخ', 'نوع', 'وضعیت', 'نتیجه', 'شماره زنگ‌زنان', 'شماره زنگ‌خورده', 'اکستنشن', 'کاربر', 'مشتری', 'کد مشتری', 'مخاطب', 'مدت (ثانیه)', 'فرصت', 'پیگیری'];
  const rows = rep.rows.map(r => [r.call_ref, r.date, r.direction_fa, r.status_fa, r.outcome_fa, r.caller, r.called, r.extension, r.user, r.customer, r.customer_number, r.contact, r.duration_sec, r.opportunity, r.followup]);
  const title = 'گزارش تماس‌ها (VoIP)';
  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map(row => row.map(c => shamsiCell(c)))]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Calls');
    return { type: 'xlsx', fileName: 'voip-calls-report.xlsx', data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) };
  }
  const shamsiRows = rows.map(r => r.map(c => shamsiCell(c)));
  if (format === 'csv') {
    const csv = [headers, ...shamsiRows].map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
    return { type: 'csv', fileName: 'voip-calls-report.csv', data: Buffer.from('\uFEFF' + csv, 'utf8') };
  }
  // html — official PDF/print: company header + logo + meta + table + signature/footer, Shamsi dates
  const co = company();
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tbl = `<table class="items"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${shamsiRows.map(r => `<tr>${r.map(c => `<td>${esc(c) === '' ? '—' : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const sum = rep.summary;
  const author = user ? (user.full_name || user.username || '') : '';
  const body = `
  ${companyHeadHtml(co)}
  <h1>${esc(title)} <span class="badge">${faDigits(sum.total)} تماس</span></h1>
  <div class="meta">
    <div><b>بازه گزارش:</b><span>${q.from ? shamsiDate(q.from) : 'آغاز'} تا ${q.to ? shamsiDate(q.to) : 'اکنون'}</span></div>
    <div><b>تاریخ تهیه:</b><span>${shamsiDate(nowIso())}</span></div>
    <div><b>تماس ورودی:</b><span>${faDigits(sum.by_direction.inbound || 0)}</span></div>
    <div><b>تماس خروجی:</b><span>${faDigits(sum.by_direction.outbound || 0)}</span></div>
    <div><b>کل مدت مکالمه:</b><span>${faDigits(Math.round((sum.talk_sec || 0) / 60))} دقیقه</span></div>
    <div><b>تهیه‌کننده:</b><span>${esc(author)}</span></div>
  </div>
  ${tbl}
  <div class="note"><b>یادداشت:</b> این گزارش توسط سیستم VoIP / IP-PBX CRM بسپار فوم تهیه شده است. شماره‌ها بر اساس Customer Master شناسایی شده‌اند.</div>
  <div class="footer"><div class="sign"><div class="line"></div>امضای تهیه‌کننده گزارش</div>
  <div style="text-align:center"><div class="badge">VoIP Report</div></div>
  <div class="sign"><div class="line"></div>امضا و تأیید مدیرعامل</div></div>`;
  return { type: 'html', fileName: 'voip-calls-report.html', data: baseHtml(title, body) };
}
function shamsiDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '');
  const [jy, jm, jd] = require('../../lib/util').toJalaali(iso) || [0, 0, 0];
  return faDigits(jy) + '/' + faDigits(String(jm).padStart(2, '0')) + '/' + faDigits(String(jd).padStart(2, '0'));
}
function shamsiCell(c) {
  if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(c)) {
    const d = new Date(c);
    if (isNaN(d.getTime())) return c;
    // local (Tehran) wall-clock time — no off-by-one-day / timezone drift
    return shamsiDate(c) + ' ' + faDigits(String(d.getHours()).padStart(2, '0')) + ':' + faDigits(String(d.getMinutes()).padStart(2, '0'));
  }
  return c;
}

// ---------- outcomes (configurable) ----------
function outcomes() {
  let list = getSetting('call_outcomes', null);
  if (!list || !Array.isArray(list) || !list.length) list = DEFAULT_OUTCOMES.map(([v, l]) => ({ v, l }));
  return list;
}
function saveOutcomes(user, list) {
  requirePerm(user, 'voip_setting', 'edit');
  if (!Array.isArray(list) || !list.length || list.length > 20) throw new HttpError(422, 'VALIDATION', 'فهرست نتیجه‌ها معتبر نیست.');
  const clean = list.map(x => ({ v: String(x.v || '').trim(), l: String(x.l || '').trim() })).filter(x => x.v && x.l);
  if (!clean.length) throw new HttpError(422, 'VALIDATION', 'حداقل یک نتیجه ثبت کنید.');
  setSetting('call_outcomes', clean);
  return { ok: true, items: clean };
}

// ---------- per-customer call stats (Customer 360) ----------
function customerCallStats(user, customerId) {
  const p = requirePerm(user, 'voip_call', 'view');
  const d = get();
  const cid = parseId(customerId);
  if (!cid) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  if (p !== 'all') {
    const cs = customerSummary(d, cid);
    if (!cs || (!cs.salesperson_id || Number(cs.salesperson_id) !== user.id)) throw new HttpError(403, 'FORBIDDEN', 'دسترسی ندارید.');
  }
  const r = d.prepare(`SELECT COUNT(*) c, COALESCE(SUM(duration_sec),0) s, MAX(COALESCE(started_at, created_at)) last, SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) missed FROM voip_calls WHERE customer_id=?`).get(cid);
  return { count: r.c, talk_sec: r.s, last: r.last, missed: r.missed };
}

// ---------- AI & Calls (item 39) — real-data analysis, never fabricated ----------
// basis: 'transcript' (STT text present) > 'recording' (recording exists, no STT yet) > 'metadata'
function callAiTrend(d, customerId) {
  const rows = d.prepare(`SELECT strftime('%Y-%m', COALESCE(started_at, created_at)) ym, COUNT(*) total,
    SUM(CASE WHEN status IN ('answered','ended') THEN 1 ELSE 0 END) answered,
    SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) missed,
    COALESCE(SUM(duration_sec),0) talk
    FROM voip_calls WHERE customer_id=? AND COALESCE(started_at, created_at) >= datetime('now','-6 month')
    GROUP BY ym ORDER BY ym`).all(customerId);
  const toJalaali = require('../../lib/util').toJalaali;
  const months = rows.map(r => {
    let label = r.ym;
    try { const [jy, jm] = toJalaali(r.ym + '-01T12:00:00Z'); if (jy) label = faDigits(jy) + '/' + faDigits(String(jm).padStart(2, '0')); } catch {}
    return { month: label, total: r.total, answered: r.answered || 0, missed: r.missed || 0, talk_sec: r.talk };
  });
  const totalAll = months.reduce((a, m) => a + m.total, 0);
  const answeredAll = months.reduce((a, m) => a + m.answered, 0);
  const talkAll = months.reduce((a, m) => a + (m.talk_sec || 0), 0);
  return { months, total: totalAll, answer_rate: totalAll ? Math.round(answeredAll * 1000 / totalAll) / 10 : null, avg_duration_sec: totalAll ? Math.round(talkAll / totalAll) : 0 };
}
function buildCallSuggestion(row, cs) {
  // analyze real call content: manual notes + STT transcript (when present)
  const text = String(row.notes || '') + ' ' + String(row.transcript || '');
  const action_items = [];
  if (row.status === 'missed') action_items.push('بازگشت تماس از دست‌رفته به شماره ' + (row.caller || row.called || 'مخاطب'));
  else if (['no_answer', 'busy', 'cancelled'].includes(row.status)) action_items.push('تلاش مجدد برقراری تماس در ساعت مناسب‌تر');
  if (/قیمت|نرخ|هزینه|پیش‌فاکتور/.test(text)) action_items.push('ارسال قیمت / پیش‌فاکتور جدید');
  if (/نمونه/.test(text)) action_items.push('ارسال نمونهٔ محصول');
  if (/تحویل|ارسال|حمل|کارت/.test(text)) action_items.push('بررسی وضعیت ارسال / تحویل');
  if (/شکایت|مشکل|خرابی/.test(text)) action_items.push('ثبت و پیگیری شکایت');
  if (/قرارداد/.test(text)) action_items.push('پیگیری قرارداد');
  if (/فاکتور|پرداخت|حساب/.test(text)) action_items.push('پیگیری فاکتور / پرداخت');
  if (!action_items.length) action_items.push(row.status === 'answered' || row.status === 'ended' ? 'ثبت پیگیری برای تثبیت ارتباط' : 'دوباره تلاش برای برقراری تماس');
  // outcome suggestion — only from the configured outcome list
  let outcome = null;
  if (/شکایت|مشکل|خرابی/.test(text)) outcome = 'follow_up_needed';
  else if (/علاقه|نمونه|قیمت|پیش‌فاکتور|خرید|سفارش/.test(text)) outcome = 'interested';
  else if (/علاقه‌مند نیست|نیازی ندارد|لغو/.test(text)) outcome = 'not_interested';
  else if (row.status === 'missed' || ['no_answer', 'busy', 'cancelled'].includes(row.status)) outcome = 'call_back';
  else if (row.status === 'answered' || row.status === 'ended') outcome = 'follow_up_needed';
  const list = outcomes().map(o => o.v);
  if (outcome && !list.includes(outcome)) outcome = null;
  const who = cs && cs.name ? cs.name + ' — ' : '';
  const due = new Date(Date.now() + (row.status === 'missed' ? 1 : 3) * 86400000).toISOString();
  return {
    outcome,
    followup_subject: who + (row.status === 'missed' ? 'بازگشت تماس از دست‌رفته' : 'پیگیری تماس ' + (row.call_ref || '#' + row.id)),
    followup_due: due,
    action_items,
  };
}
function builtinCallAi(ctx, suggestion, trend) {
  const c = ctx.call;
  const dirFa = c.direction === 'inbound' ? 'ورودی' : 'خروجی';
  const L = [];
  L.push('خلاصهٔ تماس (بر اساس دادهٔ واقعی سیستم):');
  L.push('• تماس ' + dirFa + ' با وضعیت «' + (STATUS_FA[c.status] || c.status) + '»' + (c.duration_sec ? ' — مدت ' + faDigits(Math.floor(c.duration_sec / 60)) + ' دقیقه' : ''));
  L.push('• شماره: ' + (c.caller || c.called || '—') + (c.extension ? ' — اکستنشن ' + c.extension : ''));
  L.push('• مشتری: ' + (ctx.customer ? (ctx.customer.name + (ctx.customer.code ? ' (' + ctx.customer.code + ')' : '')) : 'ناشناس'));
  if (c.notes) L.push('• یادداشت: ' + c.notes);
  if (c.outcome) L.push('• نتیجهٔ ثبت‌شده: ' + c.outcome);
  if (ctx.basis === 'transcript') L.push('• تحلیل بر اساس متن کامل مکالمه (STT).');
  else if (ctx.basis === 'recording') L.push('• ضبط مکالمه موجود است اما متن مکالمه (STT) ثبت نشده — تحلیل بر اساس متادیتا و یادداشت‌هاست.');
  else L.push('• برای این تماس ضبطی ثبت نشده — تحلیل بر اساس متادیتا و یادداشت‌هاست.');
  L.push('');
  L.push('آیتم‌های اقدام پیشنهادی:');
  suggestion.action_items.forEach((a, i) => L.push((i + 1) + ') ' + a));
  L.push('');
  L.push('پیشنهاد پیگیری: «' + suggestion.followup_subject + '» — مهلت پیشنهادی: ' + fmtDateLong(suggestion.followup_due));
  if (suggestion.outcome) { const o = outcomes().find(x => x.v === suggestion.outcome); if (o) L.push('پیشنهاد نتیجه تماس: ' + o.l); }
  if (trend && trend.total) {
    L.push('');
    L.push('روند تماس‌های مشتری (۶ ماه اخیر): ' + faDigits(trend.total) + ' تماس — نرخ برقراری ' + faDigits(trend.answer_rate) + '٪ — میانگین مدت ' + faDigits(trend.avg_duration_sec) + ' ثانیه');
  }
  if (!ctx.customer) L.push('مشتری شناسایی نشده است — با دکمهٔ «ثبت مشتری جدید از این تماس» در Customer Master ثبت کنید.');
  return L.join('\n');
}
const STATUS_FA = { ringing: 'در حال زنگ', answered: 'برقرار شد', missed: 'از دست رفته', no_answer: 'پاسخ داده نشد', busy: 'مشغول', cancelled: 'لغو شده', ended: 'پایان یافته' };
async function callAi(user, id) {
  const p = requirePerm(user, 'voip_call', 'view');
  const row = callDetail(user, id);
  const d = get();
  const cs = row.customer_id ? customerSummary(d, row.customer_id) : null;
  const has_recording = !!row.recording_ready;
  const transcript = row.transcript || null;
  const basis = transcript ? 'transcript' : has_recording ? 'recording' : 'metadata';
  const suggestion = buildCallSuggestion(row, cs);
  const trend = row.customer_id && p !== 'own' ? callAiTrend(d, row.customer_id) : (row.customer_id ? callAiTrend(d, row.customer_id) : null);
  const ctx = {
    basis,
    call: { call_ref: row.call_ref, direction: row.direction, status: row.status, outcome: row.outcome_fa || row.outcome || null, duration_sec: row.duration_sec, caller: row.caller, called: row.called, extension: row.extension, notes: row.notes || null, has_recording, has_transcript: !!transcript },
    customer: cs ? { name: cs.name, code: cs.code, status: cs.status } : null,
    recent_calls: row.customer_id ? d.prepare(`SELECT direction, status, outcome_fa, notes, duration_sec, COALESCE(started_at, created_at) at FROM voip_calls WHERE customer_id=? AND id<>? ORDER BY COALESCE(started_at, created_at) DESC LIMIT 10`).all(row.customer_id, row.id) : [],
    transcript: transcript ? String(transcript).slice(0, 6000) : null,
    trend,
  };
  const gw = require('../../core/ai-gateway');
  if (!gw.moduleEnabled('voip')) return { text: 'هوش مصنوعی برای ماژول تماس غیرفعال است.', source: 'disabled', basis, has_recording, has_transcript: !!transcript, suggestion, trend };
  const SYS = 'تو تحلیلگر تماس در CRM شرکت دانش‌بنیان بسپار فوم غرب هستی. فقط بر اساس دادهٔ واقعی ارائه‌شده: ۱) خلاصهٔ تماس ۲) آیتم‌های اقدام ۳) پیشنهاد پیگیری (موضوع و زمان) ۴) پیشنهاد نتیجهٔ تماس ۵) روند تماس‌های مشتری را به فارسی و ساختاریافته بنویس. اگر متن مکالمه (transcript) در داده نیست صریحاً بنویس تحلیل بر اساس متادیتا و یادداشت‌هاست. هرگز دادهٔ فرضی نساز.';
  const out = await gw.ask(user, 'voip', 'call_ai',
    [{ role: 'user', content: 'دادهٔ واقعی یک تماس VoIP:\n' + JSON.stringify(ctx, null, 2) + '\nتحلیل کن.' }],
    SYS, () => builtinCallAi(ctx, suggestion, trend));
  return { ...out, basis, has_recording, has_transcript: !!transcript, suggestion, trend };
}

// ---------- recordings (authenticated) ----------
const streamTokens = new Map(); // tok -> {callId, exp}
function recordingMeta(user, id) {
  const p = requirePerm(user, 'voip_call', 'view');
  const row = callDetail(user, id);
  return {
    call_id: row.id, ready: !!row.recording_ready,
    recording_id: row.recording_id || null, has_file: !!row.recording_file,
    duration: row.duration_sec || 0,
    can_view: !!row.recording_ready,
    can_download: !!p && !!row.recording_ready,
  };
}
async function recordingStreamToken(user, id) {
  const p = requirePerm(user, 'voip_call', 'view');
  const row = callDetail(user, id);
  if (!row.recording_ready || !row.recording_file || !fs.existsSync(row.recording_file)) throw new HttpError(404, 'NO_RECORDING', 'فایل ضبط برای این تماس موجود نیست.');
  const tok = randomToken(24);
  streamTokens.set(tok, { callId: row.id, exp: Date.now() + 5 * 60000 });
  audit(user, 'voip_call', row.id, 'recording_view', null, { file: path.basename(row.recording_file) }, '');
  return { token: tok, url: '/api/voip/recordings/stream?tok=' + encodeURIComponent(tok) };
}
function streamRecording(tok) {
  const t = streamTokens.get(tok);
  if (!t || t.exp < Date.now()) throw new HttpError(401, 'TOKEN_INVALID', 'لینک پخش معتبر نیست یا منقضی شده است.');
  const d = get();
  const row = d.prepare(`SELECT * FROM voip_calls WHERE id=?`).get(t.callId);
  if (!row || !row.recording_file) throw new HttpError(404, 'NO_RECORDING', 'فایل موجود نیست.');
  const fp = path.join(REC_DIR, path.basename(row.recording_file)); // basename = traversal guard
  if (!fp.startsWith(REC_DIR) || !fs.existsSync(fp)) throw new HttpError(404, 'NO_RECORDING', 'فایل موجود نیست.');
  streamTokens.delete(tok); // single use
  return { file: fp, name: path.basename(fp) };
}
function downloadRecording(user, id) {
  requirePerm(user, 'voip_call', 'edit'); // Download Recording = edit scope (stricter)
  const row = callDetail(user, id);
  if (!row.recording_ready || !row.recording_file) throw new HttpError(404, 'NO_RECORDING', 'فایل ضبط برای این تماس موجود نیست.');
  const fp = path.join(REC_DIR, path.basename(row.recording_file));
  if (!fp.startsWith(REC_DIR) || !fs.existsSync(fp)) throw new HttpError(404, 'NO_RECORDING', 'فایل موجود نیست.');
  audit(user, 'voip_call', row.id, 'recording_download', null, { file: path.basename(fp) }, '');
  return { file: fp, name: path.basename(fp) };
}

module.exports = {
  getCfg, maskedCfg, saveSettings, testConnection, webhook,
  listCalls, callDetail, updateCall, createFollowupFromCall, attachCustomerFromCall, customerCallStats,
  clickToCall, sync, maybeSync, dashboard, report, exportReport, callAi,
  outcomes, saveOutcomes, recordingMeta, recordingStreamToken, streamRecording, downloadRecording,
  normPhone,
};
