'use strict';
const { get } = require('../db/db');
const { parse } = require('./nlu');
const engine = require('./engine');
const provider = require('./provider');
const { fmtNum, faDigits, fmtMoney, fmtDateLong, jalaliPeriodRange, normalizeFa, nameSimilarity } = require('../lib/util');

// AI permissions: the assistant only sees what the user's role allows
function scopedInvoiceWhere(user) {
  const { hasPerm, scopeWhere } = require('../auth/auth');
  const p = hasPerm(user, 'invoice', 'view');
  if (!p.ok) return null;
  const sc = scopeWhere('invoice', user, p.scope, 'created_by');
  return { sql: sc.where ? 'AND ' + sc.where : '', params: sc.params };
}
function fmtP(p) {
  return { today: 'امروز', week: 'این هفته', month: 'این ماه', year: 'این سال', last_month: 'ماه قبل', yesterday: 'دیروز' }[p] || p;
}

// Item 35 — AI Quick Customer Registration (real + event-based, NO mock).
// The customer is created through the STANDARD generic API path (validate + dedup
// + number + audit + search index + dispatch('customer_created')). The Visual
// Workflow Engine picks it up from the Event Bus exactly like a manual creation.
function registerCustomerAction(user, intent) {
  const d = get();
  const { requirePerm } = require('../auth/auth');
  try { requirePerm(user, 'customer', 'create'); }
  catch (e) {
    return { text: 'شما مجوز ثبت مشتری را ندارید (RBAC). از مدیر سیستم بخواهید دسترسی «مشتریان → ساخت» را فعال کند.', intent: 'register_customer', engine: 'local_intelligence', data: null, note: 'no_permission' };
  }
  const name = String(intent.slots.name || '').trim();
  if (name.length < 2) {
    return { text: 'نام مشتری را بفرمایید تا ثبت کنم. مثال: «ثبت مشتری شرکت الف، موبایل 09121234567، شهر شیراز».', intent: 'register_customer', engine: 'local_intelligence', data: null, note: 'needs_name' };
  }
  const payload = { name, type: intent.slots.type || 'company' };
  if (intent.slots.mobile) payload.mobile = intent.slots.mobile;
  if (intent.slots.phone) payload.phone = intent.slots.phone;
  if (intent.slots.email) payload.email = intent.slots.email;
  if (intent.slots.city) payload.city = intent.slots.city;
  if (intent.slots.tax_code) payload.tax_code = intent.slots.tax_code;
  payload.notes = 'ثبت سریع از طریق دستیار هوشمند AI (رویداد: customer_created)';
  let id = 0, dup = false, valErr = '';
  try {
    id = require('../api/generic').create(require('../api/resources').R.customer, user, payload);
  } catch (e) {
    if (e && e.code === 'DUPLICATE') dup = true;
    else if (e && e.code === 'VALIDATION') valErr = e.message;
    else throw e;
  }
  if (dup) {
    return { text: 'مشتری مشابه قبلاً ثبت شده است (بررسی تکراری بر اساس نام/تلفن/ایمیل). ثبت تکراری انجام نشد و داده‌ای تغییر نکرد.', intent: 'register_customer', engine: 'local_intelligence', data: { duplicate: true }, note: 'duplicate' };
  }
  if (valErr) {
    return { text: 'ثبت انجام نشد: ' + valErr, intent: 'register_customer', engine: 'local_intelligence', data: null, note: 'validation' };
  }
  const row = d.prepare('SELECT * FROM customers WHERE id=?').get(id);
  // Honest report: which workflow REALLY started for this record (not assumed)
  const insts = d.prepare(`SELECT i.execution_no, i.status, p.name FROM wf_instances i JOIN wf_processes p ON p.id=i.process_id WHERE i.entity_id=? AND i.module='customer' ORDER BY i.id DESC LIMIT 5`).all(id);
  const wfText = insts.length
    ? ' رویداد «customer_created» از Event Bus ارسال شد و ' + insts.length + ' فرآیند واقعی فعال شد: ' + insts.map(x => '«' + x.name + '» (' + x.execution_no + ')').join('، ') + '.'
    : ' رویداد «customer_created» ارسال شد، ولی فعلاً هیچ Workflow فعالی برای این رویداد تعریف نشده است.';
  return {
    text: '✅ مشتری «' + row.name + '» با کد ' + row.number + ' در CRM ثبت شد (دادهٔ واقعی، نه نمونه).' + wfText,
    intent: 'register_customer',
    engine: 'local_intelligence',
    data: { customer: id, number: row.number, workflows: insts.map(x => ({ name: x.name, execution_no: x.execution_no, status: x.status })) },
  };
}

async function answer(query, user) {
  const intent = parse(query);
  const d = get();
  // ---- Hybrid AI: 3-level chain with mode + privacy policy (never fake) ----
  const gw = require('../core/ai-gateway');
  gw.aiRateLimit(user);
  // Real action intents are deterministic and RBAC-checked — NEVER delegated to
  // an LLM (item 35: event-based; item 32: RBAC on every action).
  if (intent.name === 'register_customer') return registerCustomerAction(user, intent);
  const { aiConfig } = gw;
  const cfg = aiConfig();
  const mode = cfg.ai_mode || 'hybrid';           // auto | online_only | offline_only | hybrid
  const priv = cfg.ai_privacy || {};
  const context = buildContext(query, user, priv);
  const sysPrompt = 'تو دستیار هوشمند CRM شرکت بسپار فوم غرب هستی. فقط بر اساس داده‌های زیر به سوال کاربر به فارسی، دقیق و مختصر پاسخ بده. اعداد را با جداکننده هزارگان بنویس. اگر داده کافی نیست صریحاً بگو «داده کافی نیست» و حدس نزن. داده‌های واقعی:\n' + context;
  // Level 1 — Online AI (unified ai_settings via ai-gateway — same source as /api/ai/status)
  const tryOnline = (mode === 'online_only' || mode === 'hybrid' || mode === 'auto') && cfg.online_enabled && !!cfg.online_api_key && priv.online_allowed !== false;
  if (tryOnline) {
    try {
      const ai = await gw.callOnline(cfg, [{ role: 'user', content: query }], sysPrompt, cfg.online_timeout_ms);
      if (ai && ai.text) return { text: ai.text, intent: intent.name, provider: ai.provider, engine: 'online', data: null };
    } catch (e) { console.error('online provider fallback:', e.message); }
  }
  if (mode === 'online_only') {
    return { text: 'دستیار آنلاین در دسترس نیست (کلید/اتصال تنظیم نشده یا خطا). پاسخ از موتور هوش محلی CRM ادامه می‌یابد.', intent: intent.name, provider: 'local_intelligence', engine: 'local_intelligence', data: null, note: 'online_unavailable' };
  }
  // Level 2 — Offline Local LLM (Ollama / llama.cpp / LM-compatible)
  const tryLocal = (mode === 'offline_only' || mode === 'hybrid' || mode === 'auto') && cfg.offline_enabled && priv.offline_allowed !== false && !!cfg.local_endpoint;
  if (tryLocal) {
    try {
      const lr = await gw.callLocal(cfg, [{ role: 'user', content: query }], sysPrompt, cfg.local_timeout_ms);
      if (lr && lr.text) return { text: lr.text, intent: intent.name, provider: 'local', engine: 'local_llm', data: null };
    } catch (e) { console.error('local llm fallback:', e.message); }
  }
  // Level 3 — Local Intelligence (rules + analytics) — ALWAYS available; offline != disabled
  // AI Privacy policy (item 21): financial/sales intents are masked when privacy.financial = false
  if (priv && priv.financial === false && ['sales', 'top_customers', 'opportunities', 'receivables', 'salesperson_perf', 'advice', 'forecast', 'repurchase', 'new_customers', 'order_status'].includes(intent.name)) {
    return { text: 'دریافت این داده بر اساس سیاست حریم خصوصی (AI Privacy) مسک شده است. برای مشاهده، دسترسی «داده مالی / فروش» را در تنظیمات AI فعال کنید.', intent: intent.name, engine: 'local_intelligence', data: null, note: 'privacy_masked' };
  }
  // ---- local engine ----
  const _local = (function () {
  switch (intent.name) {
    case 'sales': {
      const sw = scopedInvoiceWhere(user);
      if (!sw) return { text: 'شما مجوز مشاهده فاکتورها را ندارید.', intent: intent.name };
      const p = intent.slots.period || 'month';
      const { from, to } = jalaliPeriodRange(p);
      const t = engine.salesTotals(from, to, sw.sql, sw.params);
      const prev = p === 'month' ? 'last_month' : 'week';
      const pf = jalaliPeriodRange(prev);
      const pt = engine.salesTotals(pf.from, pf.to, sw.sql, sw.params);
      const delta = pt.total > 0 ? Math.round(((t.total - pt.total) / pt.total) * 1000) / 10 : null;
      let text = `فروش ${fmtP(p)}: ${fmtMoney(t.total)} در ${faDigits(t.count)} فاکتور است.`;
      if (delta !== null && delta !== undefined) text += ` نسبت به ${fmtP(prev)} ${delta >= 0 ? 'افزایش' : 'کاهش'} ${faDigits(Math.abs(delta))}٪.`;
      return { text, intent: intent.name, data: { cur: t, prev: pt } };
    }
    case 'top_customers': {
      const sw = scopedInvoiceWhere(user);
      if (!sw) return { text: 'شما مجوز مشاهده فاکتورها را ندارید.', intent: intent.name };
      const p = intent.slots.period || 'month';
      const { from, to } = jalaliPeriodRange(p);
      const rows = d.prepare(`SELECT c.id, c.name, COALESCE(SUM(i.total),0) s, COUNT(DISTINCT i.id) n FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? ${sw.sql} GROUP BY c.id ORDER BY s DESC LIMIT 5`).all(from, to, ...sw.params);
      if (!rows.length) return { text: `مشتری با خریدی در بازه ${fmtP(p)} پیدا نشد.`, intent: intent.name };
      const text = `مهم‌ترین مشتریان ${fmtP(p)}:\n` + rows.map((r, i) => `${faDigits(i + 1)}). ${r.name} — ${fmtMoney(r.s)} (${faDigits(r.n)} فاکتور)`).join('\n');
      return { text, intent: intent.name, data: rows.map(r => ({ id: r.id, name: r.name })) };
    }
    case 'churn_risk': {
      const list = engine.churnList(8).filter(c => c.score >= 40);
      if (!list.length) return { text: 'در حال حاضر مشتری با ریسک ریزش بالا شناسایی نشده است.', intent: intent.name };
      const text = `مشتریان در معرض ریزش:\n` + list.map(c => `• ${c.name} — ریسک ${faDigits(c.score)}/۱۰ (${(c.reasons || []).slice(0, 2).join('؛ ')})`).join('\n') + '\nپیشنهاد: تماس فعال و بررسی نیازها.';
      return { text, intent: intent.name, data: list.map(c => ({ id: c.id, name: c.name, score: c.score })) };
    }
    case 'opportunities': {
      const rows = d.prepare(`SELECT o.id, o.title, c.name, o.amount, o.probability, o.expected_close_at, u.full_name FROM opportunities o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.salesperson_id WHERE o.status='open' AND o.archived_at IS NULL ORDER BY (o.probability * o.amount) DESC LIMIT 8`).all();
      if (!rows.length) return { text: 'فرصت فروش بازی ثبت نشده است.', intent: intent.name };
      const text = `مهم‌ترین فرصت‌های باز:\n` + rows.map(r => `• ${r.title} (${r.name || '—'}) — ${fmtMoney(r.amount)}، احتمال ${faDigits(r.probability)}٪${r.expected_close_at ? '، سررسید ' + fmtDateLong(r.expected_close_at) : ''}`).join('\n');
      return { text, intent: intent.name, data: rows.map(r => ({ id: r.id, title: r.title })) };
    }
    case 'order_status': {
      let cust = null;
      if (intent.slots.company) {
        const cands = d.prepare('SELECT id, name FROM customers WHERE archived_at IS NULL LIMIT 1000').all();
        const scored = cands.map(c => ({ c, s: nameSimilarity(c.name, intent.slots.company) })).sort((a, b) => b.s - a.s);
        if (scored[0] && scored[0].s >= 0.35) cust = scored[0].c;
      }
      if (!cust) return { text: 'نام مشتری را مشخص کنید تا وضعیت سفارش‌های او را نشان دهم. مثال: «وضعیت سفارش شرکت الف است؟»', intent: intent.name };
      const rows = d.prepare(`SELECT id, number, status, total, order_date, due_date FROM orders WHERE customer_id=? AND archived_at IS NULL ORDER BY id DESC LIMIT 5`).all(cust.id);
      if (!rows.length) return { text: `برای «${cust.name}» سفارشی ثبت نشده است.`, intent: intent.name };
      const FA = { draft: 'پیش‌نویس', confirmed: 'تأییدشده', in_production: 'در حال تولید', ready: 'آماده ارسال', shipped: 'ارسال‌شده', delivered: 'تحویل‌شده', cancelled: 'لغوشده', returned: 'بازگشتی' };
      const text = `آخرین سفارش‌های ${cust.name}:\n` + rows.map(r => `• ${r.number} — ${FA[r.status] || r.status}، ${fmtMoney(r.total)}، تاریخ ${fmtDateLong(r.order_date)}`).join('\n');
      return { text, intent: intent.name, data: { customer: cust.id } };
    }
    case 'stock':
    case 'stock_low': {
      const rows = d.prepare(`SELECT p.id, p.name, p.stock_qty, p.unit, p.reorder_point FROM products p WHERE p.active=1 AND p.reorder_point>0 AND p.stock_qty <= p.reorder_point AND p.archived_at IS NULL ORDER BY (p.stock_qty / p.reorder_point) LIMIT 10`).all();
      if (!rows.length) return { text: 'هیچ کالایی در وضعیت کمبود نیست. موجودی انبار پایداری دارد.', intent: intent.name };
      const text = `کالاهای کم‌موجود:\n` + rows.map(r => `• ${r.name} — موجودی ${faDigits(r.stock_qty)} ${r.unit} (حد سفارش: ${faDigits(r.reorder_point)})`).join('\n') + '\nپیشنهاد: ثبت سفارش خرید.';
      return { text, intent: intent.name, data: rows.map(r => ({ id: r.id })) };
    }
    case 'complaints': {
      const rows = d.prepare(`SELECT c.id, c.number, c.subject, c.priority, c.status, cu.name, c.due_at FROM complaints c LEFT JOIN customers cu ON cu.id=c.customer_id WHERE c.status IN ('new','in_progress','waiting') ORDER BY CASE c.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 8`).all();
      const parts = [];
      if (rows.length) parts.push(`شکایات باز:\n` + rows.map(r => `• ${r.number} — ${r.subject} (${r.name || '—'})، اولویت ${r.priority}، وضعیت ${r.status}`).join('\n'));
      else parts.push('شکایت بازی وجود ندارد.');
      // complaint bank analytics (90 days) — patterns, recurring products/defects, causes, trend
      const famFa = { foam_sponge: 'فوم و اسفنج', polyurethane: 'مواد اولیه پلی‌یورتان', foam_mattress: 'تشک تمام‌فوم', bed_related: 'تشک و محصولات مرتبط با تخت', other: 'سایر' };
      const byFamily = d.prepare(`SELECT defect_family, COUNT(*) c FROM complaints WHERE defect_family != '' AND created_at >= datetime('now','-90 day') GROUP BY defect_family ORDER BY c DESC`).all();
      const topTypes = d.prepare(`SELECT defect_type, COUNT(*) c FROM complaints WHERE defect_type != '' AND created_at >= datetime('now','-90 day') GROUP BY defect_type ORDER BY c DESC LIMIT 5`).all();
      const topProducts = d.prepare(`SELECT p.name, COUNT(*) c FROM complaints cp LEFT JOIN products p ON p.id=cp.product_id WHERE cp.product_id IS NOT NULL AND cp.created_at >= datetime('now','-90 day') GROUP BY cp.product_id ORDER BY c DESC LIMIT 5`).all();
      const topCauses = d.prepare(`SELECT probable_cause, COUNT(*) c FROM complaints WHERE probable_cause != '' AND created_at >= datetime('now','-90 day') GROUP BY probable_cause ORDER BY c DESC LIMIT 3`).all();
      const repeats = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE repeat_of IS NOT NULL AND created_at >= datetime('now','-90 day')`).get().c;
      const trend = d.prepare(`SELECT substr(created_at,1,7) m, COUNT(*) c FROM complaints WHERE created_at >= datetime('now','-6 month') GROUP BY m ORDER BY m`).all();
      if (byFamily.length) parts.push('توزیع بر اساس خانواده محصول (۹۰ روز): ' + byFamily.map(x => (famFa[x.defect_family] || x.defect_family) + ' (' + faDigits(x.c) + ')').join('، '));
      if (topTypes.length) parts.push('عیوب پرتکرار: ' + topTypes.map(x => x.defect_type + ' (' + faDigits(x.c) + ' مورد)').join('، '));
      if (topProducts.length) parts.push('محصولات پرتکرار: ' + topProducts.map(x => x.name + ' (' + faDigits(x.c) + ')').join('، '));
      if (topCauses.length) parts.push('علل احتمالی پرتکرار: ' + topCauses.map(x => x.probable_cause + ' (' + faDigits(x.c) + ')').join('، '));
      if (repeats) parts.push(faDigits(repeats) + ' شکایت تکراری در ۹۰ روز اخیر — پیشنهاد اقدام پیشگیرانه برای علل ریشه‌ای آن‌ها.');
      if (trend.length >= 2) {
        const last3 = trend.slice(-3).reduce((a, b) => a + b.c, 0);
        const prev3 = trend.slice(0, -3).reduce((a, b) => a + b.c, 0) || 0;
        parts.push('روند: ' + (prev3 > last3 ? 'کاهش' : 'افزایش') + ' شکایات در ۳ ماه اخیر نسبت به قبل (' + faDigits(last3) + ' در مقابل ' + faDigits(prev3) + ').');
      }
      return { text: parts.join('\n'), intent: intent.name, data: { rows: rows.map(r => ({ id: r.id })), byFamily, topTypes, topProducts, topCauses, repeats, trend } };
    }
    case 'receivables': {
      const rows = d.prepare(`SELECT c.id, c.name, COALESCE(SUM(i.total - i.paid_amount),0) s, COUNT(DISTINCT i.id) n, MIN(i.due_date) dd FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','overdue') GROUP BY c.id HAVING s > 0 ORDER BY s DESC LIMIT 8`).all();
      if (!rows.length) return { text: 'مطالبات باز وجود ندارد؛ همه فاکتورها وصول شده‌اند.', intent: intent.name };
      const total = rows.reduce((a, r) => a + r.s, 0);
      const text = `مطالبات باز: ${fmtMoney(total)}\n` + rows.map(r => `• ${r.name} — ${fmtMoney(r.s)} (${faDigits(r.n)} فاکتور${r.dd ? '، اولین سررسید ' + fmtDateLong(r.dd) : ''})`).join('\n');
      return { text, intent: intent.name, data: { total } };
    }
    case 'forecast': {
      const f = engine.forecast('month', 3);
      if (!f.ok) return { text: f.message, intent: intent.name };
      const text = `پیش‌بینی فروش ۳ ماه آینده (روند ${f.trend}):\n` + f.prediction.map(p => `• ${engine.keyFa(p.key, 'month')}: ${fmtMoney(p.value)} (بازه ${fmtMoney(p.lo)} تا ${fmtMoney(p.hi)})`).join('\n');
      return { text, intent: intent.name, data: f };
    }
    case 'repurchase': {
      const rows = d.prepare(`SELECT c.id, c.name, MAX(i.issue_date) last, COUNT(DISTINCT i.issue_date) n FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status!='cancelled' GROUP BY c.id HAVING n>=2 ORDER BY last DESC LIMIT 30`).all();
      const out = [];
      for (const r of rows) {
        const all = d.prepare(`SELECT issue_date FROM invoices WHERE customer_id=? AND status!='cancelled' ORDER BY issue_date DESC`).all(r.id).map(x => new Date(x.issue_date).getTime());
        const spans = [];
        for (let i = 0; i < all.length - 1; i++) spans.push((all[i] - all[i + 1]) / 864e5);
        const avgSpan = spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0;
        const since = (Date.now() - all[0]) / 864e5;
        if (avgSpan > 10 && since >= avgSpan * 0.9) out.push({ id: r.id, name: r.name, since: Math.round(since), avgSpan: Math.round(avgSpan) });
      }
      out.sort((a, b) => (b.since / b.avgSpan) - (a.since / a.avgSpan));
      if (!out.length) return { text: 'مشتری‌ای با احتمال خرید مجدد بالا در حال حاضر شناسایی نشد.', intent: intent.name };
      const text = `مشتریان با احتمال خرید مجدد بالا:\n` + out.slice(0, 5).map(r => `• ${r.name} — آخرین خرید ${faDigits(r.since)} روز پیش (میانگین فاصله ${faDigits(r.avgSpan)} روز)`).join('\n');
      return { text, intent: intent.name, data: out.map(r => ({ id: r.id })) };
    }
    case 'new_customers': {
      const rows = d.prepare('SELECT id, name, created_at FROM customers WHERE archived_at IS NULL ORDER BY id DESC LIMIT 5').all();
      const text = rows.length ? `آخرین مشتریان ثبت‌شده:\n` + rows.map(r => `• ${r.name} — ${fmtDateLong(r.created_at)}`).join('\n') : 'مشتری ثبت‌شده‌ای وجود ندارد.';
      return { text, intent: intent.name };
    }
    case 'salesperson_perf': {
      const { from, to } = jalaliPeriodRange('month');
      const rows = d.prepare(`SELECT u.full_name, COALESCE(SUM(i.total),0) s, COUNT(DISTINCT i.id) n FROM invoices i JOIN users u ON u.id=i.created_by WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? GROUP BY u.id ORDER BY s DESC LIMIT 8`).all(from, to);
      if (!rows.length) return { text: 'داده عملکردی این ماه ثبت نشده است.', intent: intent.name };
      const text = `عملکرد فروش این ماه:\n` + rows.map((r, i) => `${faDigits(i + 1)}). ${r.full_name} — ${fmtMoney(r.s)} (${faDigits(r.n)} فاکتور)`).join('\n');
      return { text, intent: intent.name };
    }
    case 'anomalies': {
      const list = engine.anomalies();
      if (!list.length) return { text: 'رفتار غیرعادی خاصی شناسایی نشده است.', intent: intent.name };
      const text = `هشدارهای هوشمند:\n` + list.slice(0, 8).map(a => `• ${a.customer || ''} — ${a.type}: ${a.detail}`).join('\n');
      return { text, intent: intent.name, data: list };
    }
    case 'advice': {
      const sum = engine.salesSummary('month');
      const text = `بر اساس داده‌های این ماه:\n• فروش ${fmtMoney(sum.curTotal)} ریال با تغییر ${faDigits(sum.delta)}٪ نسبت به ماه قبل.\n` +
        (sum.declines.length ? `• ${sum.declines.map(x => x.name).join('، ')} کاهش خرید دارند؛ پیگیری توصیه می‌شود.\n` : '') +
        `• ${(() => { const c = d.prepare(`SELECT COUNT(*) c FROM opportunities WHERE status='open' AND probability>=70`).get().c; return c ? `${faDigits(c)} فرصت با احتمال بالا باز است؛ روی آن‌ها تمرکز کنید.` : 'فرصت با احتمال بالا ندارید؛ روی سرنخ‌های جدید تمرکز کنید.'; })()}\n• پیشنهاد: بازنگری pipeline، فعال‌سازی مشتریان در معرض ریزش و تسریع تولید سفارش‌های در صف.`;
      return { text, intent: intent.name };
    }
    default: {
      // RAG over knowledge base
      const r = engine.rag(query);
      if (r.ok) return { text: 'پاسخ از پایگاه دانش شرکت:\n\n' + r.answer + '\n\nمنابع: ' + r.sources.map(s => s.title).join('، '), intent: 'knowledge', data: { sources: r.sources } };
      return {
        text: 'سؤال شما را دقیق متوجه نشدم. می‌توانید از مثال‌های زیر استفاده کنید:\n• فروش این ماه چقدر بوده؟\n• بهترین مشتریان این ماه چه کسانی هستند؟\n• کدام مشتری‌ها در خطر ریزش هستند؟\n• فرصت‌های فروش مهم را نشان بده.\n• وضعیت سفارش شرکت X چیست؟\n• موجودی انبار چه وضعیتی دارد؟\n• پیش‌بینی فروش ۳ ماه آینده\n• مطالبات باز چقدر است؟',
        intent: 'help',
      };
    }
  }
  return _local;
  })();
  return { ..._local, engine: 'local_intelligence' };
}
function buildContext(query, user, priv = {}) {
  const d = get();
  const parts = [];
  const { from, to } = jalaliPeriodRange('month');
  // Item 23 — AI must respect the user's RBAC scope: scope financial data by the
  // user's own invoice scope so a scoped user's online context only contains their data.
  const sw = scopedInvoiceWhere(user);
  if (!sw) {
    parts.push('مجوز مشاهده فاکتور برای این کاربر فعال نیست؛ داده مالی ارائه نده.');
    return parts.join('\n');
  }
  // AI Privacy policy: financial data only if allowed (item 21)
  if (priv.financial !== false) parts.push('فروش این ماه (بر اساس دسترسی کاربر): ' + JSON.stringify(engine.salesTotals(from, to, sw.sql, sw.params)));
  if (priv.customer !== false) parts.push('مشتریان فعال: ' + d.prepare(`SELECT COUNT(*) c FROM customers WHERE archived_at IS NULL AND status='active'`).get().c);
  if (priv.sales !== false) parts.push('فرصت‌های باز: ' + JSON.stringify(d.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) v FROM opportunities WHERE status='open'`).get()));
  parts.push('شکایات باز: ' + d.prepare(`SELECT COUNT(*) c FROM complaints WHERE status IN ('new','in_progress','waiting')`).get().c);
  if (priv.financial !== false && priv.customer !== false) {
    const top = d.prepare(`SELECT c.name, SUM(i.total) s FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.issue_date>=? ${sw.sql} GROUP BY c.id ORDER BY s DESC LIMIT 5`).all(from, ...sw.params);
    parts.push('مشتریان برتر این ماه (بر اساس دسترسی کاربر): ' + JSON.stringify(top));
  }
  return parts.join('\n');
}
// ---------- Copilot ----------
function copilot(kind, ctx) {
  const fa = (n) => fmtNum(n);
  switch (kind) {
    case 'email_quote':
      return {
        subject: `پیش‌فاکتور ${ctx.number || ''} — شرکت بسپار فوم غرب`,
        text: `جناب آقای/سرکار خانم ${ctx.customer_name || 'مدیر محترم'}\nبا سلام و احترام\n\nپیش‌فاکتور شماره ${ctx.number || '—'} به مبلغ ${fa(ctx.total)} ریال مربوط به ${ctx.items_text || 'محصولات اعلام‌شده'} برای محضر شما ارسال می‌گردد. این پیش‌فاکتور تا تاریخ ${ctx.valid_until ? fmtDateLong(ctx.valid_until) : '—'} معتبر است.\n\nشرایط پرداخت: ${ctx.terms || 'طبق توافقات'}\nدر صورت موافقت، با ارسال تأییدیه نسبت به ثبت سفارش و تولید اقدام خواهیم نمود.\n\nبا تشکر\n واحد فروش — شرکت دانش‌بنیان بسپار فوم غرب`,
      };
    case 'email_followup':
      return {
        subject: `پیگیری فرصت فروش ${ctx.title || ''}`,
        text: `جناب آقای/سرکار خانم ${ctx.contact || 'مدیر محترم'}\nبا سلام\n\nپیرو مذاکرات قبلی در خصوص ${ctx.title || 'موضوع'}، مقرر است نسبت به نهایی‌سازی جزئیات همکاری اقدام فرمایید. در صورت نیاز به هرگونه اطلاعات تکمیلی یا نمونه محصول، همکاران ما در آماده‌ی پاسخ‌گویی هستند.\n\nپیشاپیش از همکاری شما سپاسگزاریم.\nواحد فروش — بسپار فوم غرب`,
      };
    case 'sms':
      return { text: `سرکار/جناب ${ctx.customer_name || ''}؛ پیش‌فاکتور ${ctx.number || ''} بسپار فوم غرب به مبلغ ${fa(ctx.total)} ریال صادر شد. لطفاً برای تأیید پاسخ دهید. با تشکر 🌙` };
    case 'complaint_response':
      return {
        subject: `پاسخ شکایت شما — ${ctx.number || ''}`,
        text: `مشتری گرامی ${ctx.customer_name || ''}\nبا سلام و پوزش بابت نگرانی شما\n\nشکایت شما با شماره ${ctx.number || '—'} با موضوع «${ctx.subject || ''}» دریافت و در دست بررسی قرار گرفت. واحد ${ctx.department || 'مربوطه'} حداکثر تا ${ctx.due ? fmtDateLong(ctx.due) : 'سررسید تعیین‌شده'} نتیجه بررسی را به شما اطلاع خواهد داد.\n\nارادتمند شما\n واحد پشتیبانی — شرکت دانش‌بنیان بسپار فوم غرب`,
      };
    case 'meeting_summary':
      return {
        text: `خلاصه جلسه «${ctx.title || ''}» — ${ctx.date ? fmtDateLong(ctx.date) : ''}\nحاضرین: ${ctx.participants || '—'}\nموضوع: ${ctx.customer_name || 'جلسه داخلی'}\nنتیجه و مصوبات:\n${ctx.notes || '- '}\nاقدامات بعدی: ${ctx.next_actions || 'ثبت پیگیری در CRM'}`,
      };
    case 'customer_summary':
      return { text: `پروفایل مشتری «${ctx.name || ''}»\n• دسته: ${ctx.category || '—'}، وضعیت: ${ctx.status || '—'}\n• ارزش کل خرید: ${fa(ctx.total_spent)} ریال (${ctx.invoice_count} فاکتور)\n• ریسک ریزش (AI): ${fa(ctx.churn_score)}/۱۰\n• CLV تخمینی: ${fa(ctx.clv)} ریال\n${(ctx.churn_reasons || []).length ? '• دلایل ریزش: ' + ctx.churn_reasons.join('؛ ') : ''}\nپیشنهاد: ${ctx.rec || 'پیگیری دوره‌ای'}` };
    case 'sales_summary':
      return { text: `خلاصه فروش ${ctx.periodLabel || 'این ماه'}\n• مجموع فروش: ${fa(ctx.total)} ریال در ${fa(ctx.count)} فاکتور\n• تغییر نسبت به دوره قبل: ${fa(ctx.delta)}٪\n• مشتریان برتر: ${ctx.top || '—'}\n${ctx.note || ''}` };
    default:
      return { text: '' };
  }
}
module.exports = { answer, copilot, buildContext };
