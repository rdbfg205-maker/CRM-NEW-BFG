'use strict';
const { get, getSetting } = require('../db/db');
const { nowIso, nowTehran, fmtNum, faDigits, jalaliPeriodRange, sum, avg, normalizeFa, nameSimilarity, MONTHS_FA } = require('../lib/util');

// ================= SENTIMENT =================
const NEG = ['مشکل','خراب','شکایت','بد','ضعیف','نامناسب','تأخیر','دیر','ناامید','کلافه','عصبانی','ناراحت','بی‌کیفیت','معیوب','خسارت','جریمه','بی‌اعتنا','بی‌دقت','ناقص','کسری','اشتباه','شکسته','ترک','کپک','رطوبت','بو','پودر','فرورفته','نفس','غیرقابل','ناجی','بی‌پاسخ','بی‌محابا','کمرنگ','بی‌ارزش','زشت','سست','شله','نرم','سخت','خشک','آسیب','آسیب‌دیده','بی‌اعتبار','تجاوز','غفلت','فراموش','نادیده','بی‌توجهی','بی‌ارزشی','ممنوع','بلا'];
const POS = ['ممنون','ممنونم','عالی','خوب','راضی','کیفی','سریع','دقیق','تحسین','همکاری','سپاس','نیکو','مناسب','به‌موقع','خوشبخت','خوشحال','آفرین','تقدیر','معتبر','محکم','سفت','یکنواخت','یکدست','تمیز','نرم','خواب','آسودگی','به‌موقعی','زمانی','منظم'];
function sentiment(text) {
  const t = normalizeFa(text);
  let score = 0, hits = [];
  for (const w of NEG) if (t.includes(w)) { score -= 1; hits.push({ w, s: -1 }); }
  for (const w of POS) if (t.includes(w)) { score += 1; hits.push({ w, s: 1 }); }
  if (/خیلی|بسیار|خیلی هم|کاملاً|تماماً/.test(t) && hits.length) score = Math.sign(score) * Math.min(3, Math.abs(score) + 1);
  const norm = Math.max(-1, Math.min(1, score / Math.max(1, hits.length)));
  const label = norm < -0.3 ? 'منفی' : norm > 0.3 ? 'مثبت' : 'خنثی';
  return { score: Number(norm.toFixed(2)), label, hits };
}
// ================= COMPLAINT CLASSIFICATION =================
const CAT_KW = {
  quality: ['کیفیت','معیوب','فرورفته','بو','پودر','وزن','ابعاد','رنگ','ترک','کپک','نرم','سخت','سست','خام','خشک','رطوبت','ناهمگن','پف','چسب','دوخت','فرم','تراکم','دانسیته','گاز','فوران','شعله','سوخت'],
  product: ['محصول','اسفنج','تشک','فوم','کیت','کفی','بالش','توپر','رول','بوش','واشر','پد','سندویچ','ایزوه'],
  shipping: ['ارسال','بار','باربری','بسته','بسته‌بندی','شکستنی','تحویل','حمل','ترانزیت','کارتون','تسمه','چیدمان'],
  delay: ['تأخیر','دیر','موعد','زمان تحویل','تاخیر','کند','طولانی','ماه پیش','هفته پیش'],
  financial: ['پرداخت','چک','فاکتور','قیمت','قسط','مالی','اعتبار','تخفیف','شماره پیگیری','مبلغ','ریال','تومان','بازپرداخت'],
  service: ['خدمات','برخورد','پشتیبانی','پیگیری','پاسخ','تلفن','مشاوره','واکنش','تأیید','تایید'],
  laboratory: ['آزمایش','آزمایشگاه','نمونه','گزارش آزمایش','استاندارد','مطابقت'],
  sales: ['فروش','سفارش','خرید','پیشنهاد','قیمت فروش','نماینده','کارشناس'],
};
function classifyComplaint(text) {
  const t = normalizeFa(text);
  let best = 'other', bestN = 0;
  for (const [cat, kws] of Object.entries(CAT_KW)) {
    let n = 0;
    for (const k of kws) if (t.includes(k)) n++;
    if (n > bestN) { bestN = n; best = cat; }
  }
  const FA = { quality: 'کیفیت', product: 'محصول', shipping: 'ارسال', delay: 'تأخیر', financial: 'مالی', service: 'خدمات', laboratory: 'آزمایشگاه', sales: 'فروش', other: 'سایر' };
  return { category: best, label: FA[best], keywords: bestN };
}
const ROOT_CAUSES = [
  { re: /فرورفته|کف|سنگین|فشار/, cat: 'quality', cause: 'احتمالاً تنظیم نبودن تراکم/دانسیته فوم در خط تولید یا فشرده‌سازی نادرست هنگام حمل' },
  { re: /بو|بوی/, cat: 'quality', cause: 'احتمالاً آب‌نکردن یا خشک‌کردن ناکافی مواد اولیه پس از فرمینگ' },
  { re: /وزن|کسری|کم بودن وزن|دانسیته کم/, cat: 'quality', cause: 'احتمالاً انحراف تراکم مواد (پلی‌ول/MDI) در باچ تهیه' },
  { re: /ابعاد|اندازه|برش/, cat: 'quality', cause: 'احتمالاً انحراف در دستگاه برش یا تغییر اندازه بر اثر انبساط/انقباض' },
  { re: /ترک|شکست|پاره/, cat: 'quality', cause: 'احتمالاً نامناسب بودن نسبت کاتالیزور یا زمان پلیمریزیشن' },
  { re: /تأخیر|دیر|تاخیر/, cat: 'delay', cause: 'احتمالاً گلوگاه در برنامه‌ریزی تولید یا تأخیر تأمین مواد اولیه' },
  { re: /بار|حمل|باربری|بسته/, cat: 'shipping', cause: 'احتمالاً ضعف در بسته‌بندی یا انتخاب نامناسب باربری' },
  { re: /چک|پرداخت|فاکتور|مبلغ/, cat: 'financial', cause: 'احتمالاً ابهام در شرایط پرداخت یا مغایرت فاکتور' },
  { re: /پاسخ|پیگیری|برخورد/, cat: 'service', cause: 'احتمالاً طولانی بودن زمان پاسخ‌گویی واحد خدمات پس از فروش' },
];
function rootCause(text, category) {
  const t = normalizeFa(text);
  for (const rc of ROOT_CAUSES) if (rc.cat === category && rc.re.test(t)) return rc.cause;
  const fallback = {
    quality: 'احتمالاً انحراف در فرآیند تولید یا کنترل کیفیت ورودی مواد اولیه',
    product: 'احتمالاً مغایرت محصول با مشخصات فنی اعلام‌شده به مشتری',
    shipping: 'احتمالاً مشکل در زنجیره لجستیک و بسته‌بندی',
    delay: 'احتمالاً برنامه‌ریزی تولید یا تأمین مواد اولیه',
    financial: 'احتمالاً ابهام در شرایط مالی و پرداخت',
    service: 'احتمالاً ضعف در فرآیند پاسخ‌گویی پشتیبانی',
    laboratory: 'احتمالاً نیاز به بازبینی روش آزمایش یا کالیبراسیون دستگاه',
    sales: 'احتمالاً مغایرت در انتظارات اعلام‌شده در مرحله فروش',
    other: 'نیازمند بررسی بیشتر توسط واحد مربوطه',
  };
  return fallback[category] || fallback.other;
}
function analyzeComplaint(id) {
  const d = get();
  const c = d.prepare('SELECT * FROM complaints WHERE id=?').get(id);
  if (!c) return null;
  const text = `${c.subject} ${c.description}`;
  const sent = sentiment(text);
  const cls = classifyComplaint(text);
  const rc = rootCause(text, cls.category);
  const repeat = d.prepare(`SELECT id FROM complaints WHERE customer_id=? AND id<? AND status IN ('new','in_progress','waiting','resolved') AND created_at > datetime('now','-90 day') ORDER BY id DESC LIMIT 1`).get(c.customer_id, id);
  d.prepare('UPDATE complaints SET sentiment_score=?, ai_category=?, ai_root_cause=?, repeat_of=? WHERE id=?')
    .run(sent.score, cls.label, rc, repeat ? repeat.id : null, id);
  if (repeat) {
    require('../core/notify').notifyRoles(['quality_manager', 'ceo', 'super_admin'], 'complaint', 'شکایت تکراری شناسایی شد', `مشتری «${c.customer_id}» مجدداً شکایت مشابه ثبت کرده است.`, 'complaint', id);
  }
  return { sent, cls, rc, repeat: repeat ? repeat.id : null };
}
// ================= LEAD SCORING =================
const SOURCE_W = { website: 3, instagram: 2, whatsapp: 3, phone: 2, referral: 4, exhibition: 3, existing: 5, sms: 1, manual: 1, other: 1 };
function scoreLead(id) {
  const d = get();
  const l = d.prepare('SELECT * FROM leads WHERE id=?').get(id);
  if (!l) return null;
  let score = 0; const reasons = [];
  score += (SOURCE_W[l.source] || 1) * 6; reasons.push(`منبع: ${l.source} (+${(SOURCE_W[l.source] || 1) * 6})`);
  const v = Number(l.estimated_value) || 0;
  if (v >= 1e9) { score += 30; reasons.push('ارزش تخمینی بالای ۱ میلیارد (+۳۰)'); }
  else if (v >= 1e8) { score += 22; reasons.push('ارزش تخمینی ۱۰۰ میلیون و بیشتر (+۲۲)'); }
  else if (v >= 1e7) { score += 14; reasons.push('ارزش تخمینی ۱۰ میلیون و بیشتر (+۱۴)'); }
  else if (v > 0) { score += 8; reasons.push('ارزش تخمینی ثبت‌شده (+۸)'); }
  const acts = d.prepare(`SELECT COUNT(*) c FROM activities WHERE entity_type='lead' AND entity_id=?`).get(id).c;
  if (acts >= 5) { score += 15; reasons.push('تعامل بالای ۵ بار (+۱۵)'); }
  else if (acts >= 3) { score += 10; reasons.push('تعامل ۳ تا ۵ بار (+۱۰)'); }
  else if (acts >= 1) { score += 5; reasons.push('حداقل یک تعامل (+۵)'); }
  const ageDays = (Date.now() - new Date(l.created_at).getTime()) / 864e5;
  if (ageDays <= 3) { score += 12; reasons.push('سرنخ تازه کمتر از ۳ روز (+۱۲)'); }
  else if (ageDays <= 14) { score += 8; reasons.push('سرنخ تازه (+۸)'); }
  if (l.probability >= 60) { score += 10; reasons.push(`احتمال اعلام‌شده ${l.probability}٪ (+۱۰)`); }
  if (l.next_followup_at && new Date(l.next_followup_at) > new Date()) { score += 5; reasons.push('زمان پیگیری تعیین‌شده (+۵)'); }
  const cust = l.customer_id ? d.prepare('SELECT * FROM customers WHERE id=?').get(l.customer_id) : null;
  if (cust) { score += 10; reasons.push('مشتری شناخته‌شده است (+۱۰)'); }
  score = Math.min(100, Math.round(score));
  d.prepare(`UPDATE leads SET score=? WHERE id=?`).run(score, id);
  d.prepare('INSERT INTO ai_scores(entity_type, entity_id, kind, score, data, created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(entity_type, entity_id, kind) DO UPDATE SET score=excluded.score, data=excluded.data, created_at=excluded.created_at')
    .run('lead', id, 'lead', score, JSON.stringify({ reasons }), nowIso());
  return { score, reasons };
}
function rescoreAllLeads() {
  const ids = get().prepare("SELECT id FROM leads WHERE status IN ('new','contacted','qualified')").all();
  for (const x of ids) scoreLead(x.id);
  return ids.length;
}
// ================= CHURN =================
function churnScore(customerId) {
  const d = get();
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!c) return null;
  const invoices = d.prepare(`SELECT issue_date, total, status FROM invoices WHERE customer_id=? AND status != 'cancelled' ORDER BY issue_date DESC`).all(customerId);
  if (!invoices.length) return { score: 0, reasons: ['سابقه خرید ندارد'] };
  const now = Date.now();
  const last = new Date(invoices[0].issue_date).getTime();
  const recencyDays = (now - last) / 864e5;
  const spans = [];
  for (let i = 0; i < invoices.length - 1; i++) spans.push((new Date(invoices[i].issue_date).getTime() - new Date(invoices[i + 1].issue_date).getTime()) / 864e5);
  const avgSpan = spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 120;
  let score = 0; const reasons = [];
  const ratio = recencyDays / Math.max(30, avgSpan);
  if (ratio > 2.5) { score += 45; reasons.push(`آخرین خرید ${Math.round(recencyDays)} روز پیش است در حالی که میانگین فاصله خریدش ${Math.round(avgSpan)} روز است`); }
  else if (ratio > 1.5) { score += 30; reasons.push(`فعالیت خرید ${Math.round((ratio - 1) * 100)}٪ کندتر از معمول است`); }
  // trend: last 90d vs prev 90d
  const last90 = invoices.filter(i => now - new Date(i.issue_date).getTime() < 90 * 864e5).reduce((a, i) => a + i.total, 0);
  const prev90 = invoices.filter(i => { const t = now - new Date(i.issue_date).getTime(); return t >= 90 * 864e5 && t < 180 * 864e5; }).reduce((a, i) => a + i.total, 0);
  if (prev90 > 0 && last90 < prev90 * 0.6) { score += 25; reasons.push('مبلغ خرید ۹۰ روز اخیر کمتر از ۶۰٪ دوره قبل است'); }
  const openComp = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE customer_id=? AND status IN ('new','in_progress','waiting')`).get(customerId).c;
  if (openComp > 0) { score += 15; reasons.push(`${openComp} شکایت باز دارد`); }
  const overdue = d.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial','overdue')`).get(customerId).s;
  if (overdue > 0) { score += 10; reasons.push('مطالبات پرداخت‌نشده دارد'); }
  const lastAct = d.prepare(`SELECT MAX(created_at) m FROM activities WHERE entity_type='customer' AND entity_id=?`).get(customerId).m;
  if (lastAct && (now - new Date(lastAct).getTime()) > 45 * 864e5) { score += 5; reasons.push('بیش از ۴۵ روز تعامل ثبت‌شده‌ای ندارد'); }
  score = Math.min(100, Math.round(score));
  d.prepare('UPDATE customers SET churn_score=? WHERE id=?').run(score, customerId);
  d.prepare('INSERT INTO ai_scores(entity_type, entity_id, kind, score, data, created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(entity_type, entity_id, kind) DO UPDATE SET score=excluded.score, data=excluded.data, created_at=excluded.created_at')
    .run('customer', customerId, 'churn', score, JSON.stringify({ reasons }), nowIso());
  return { score, reasons };
}
function churnList(limit = 20) {
  const d = get();
  const custs = d.prepare(`SELECT id, name FROM customers WHERE archived_at IS NULL AND status='active'`).all();
  const out = [];
  for (const c of custs) {
    const r = churnScore(c.id);
    if (r && r.score >= 40) out.push({ id: c.id, name: c.name, score: r.score, reasons: r.reasons });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
// ================= SALES ANALYTICS =================
function salesTotals(from, to, scopeSql = '', params = []) {
  const d = get();
  const sql = `SELECT COALESCE(SUM(total),0) total, COUNT(*) cnt FROM invoices WHERE status IN ('unpaid','partial','paid','overdue') AND issue_date >= ? AND issue_date <= ? ${scopeSql}`;
  const r = d.prepare(sql).get(from, to, ...params);
  return { total: r.total, count: r.cnt };
}
function salesSummary(period = 'month') {
  const cur = jalaliPeriodRange(period);
  const prevPeriod = period === 'month' ? 'last_month' : (period === 'week' ? 'week' : 'year');
  const prev = jalaliPeriodRange(prevPeriod === period ? 'last_month' : prevPeriod);
  const curT = salesTotals(cur.from, cur.to);
  const prevT = salesTotals(prev.from, prev.to);
  const delta = prevT.total > 0 ? ((curT.total - prevT.total) / prevT.total) * 100 : (curT.total > 0 ? 100 : 0);
  const d = get();
  const topCustomers = d.prepare(`SELECT c.name, COALESCE(SUM(i.total),0) s, COUNT(DISTINCT i.id) n FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? GROUP BY c.id ORDER BY s DESC LIMIT 5`).all(cur.from, cur.to);
  const topProducts = d.prepare(`SELECT ii.name, COALESCE(SUM(ii.line_total),0) s FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? GROUP BY ii.name ORDER BY s DESC LIMIT 5`).all(cur.from, cur.to);
  const declines = d.prepare(`
    SELECT c.id, c.name,
      COALESCE(SUM(CASE WHEN i.issue_date >= ? THEN i.total ELSE 0 END),0) cur,
      COALESCE(SUM(CASE WHEN i.issue_date < ? THEN i.total ELSE 0 END),0) prev
    FROM invoices i JOIN customers c ON c.id=i.customer_id
    WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date >= datetime(?, '-90 day')
    GROUP BY c.id HAVING prev > 0 AND cur < prev * 0.6 ORDER BY (prev - cur) DESC LIMIT 3`).all(cur.from, cur.from, cur.from);
  return { period, cur, prev, curTotal: curT.total, prevTotal: prevT.total, delta: Math.round(delta * 10) / 10, curCount: curT.count, topCustomers, topProducts, declines };
}
function forecast(granularity = 'month', horizon = 3) {
  const d = get();
  const rows = d.prepare(`SELECT issue_date, total FROM invoices WHERE status IN ('unpaid','partial','paid','overdue')`).all();
  const series = {};
  for (const r of rows) {
    const dt = new Date(r.issue_date);
    const t = new Date(dt.getTime() + 4.5 * 3600e3);
    const [jy, jm, jd] = (() => { const { gregorianToJalaali } = require('../lib/jalali'); return gregorianToJalaali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); })();
    let key;
    if (granularity === 'month') key = `${jy}-${String(jm).padStart(2, '0')}`;
    else if (granularity === 'week') { const wk = Math.floor((t.getUTCDay() + 6) / 7); key = `${jy}-${String(jm).padStart(2, '0')}-w${wk}`; }
    else key = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    series[key] = (series[key] || 0) + r.total;
  }
  const keys = Object.keys(series).sort();
  if (keys.length < 3) return { ok: false, message: 'داده کافی برای پیش‌بینی وجود ندارد. حداقل چند دوره فروش ثبت کنید.' };
  const vals = keys.map(k => series[k]);
  const n = vals.length;
  const xMean = (n - 1) / 2, yMean = sum(vals) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (vals[i] - yMean); den += (i - xMean) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = yMean - slope * xMean;
  // seasonality (months) when monthly and enough history
  let seasonal = {};
  if (granularity === 'month' && n >= 12) {
    const byMonth = {};
    for (let i = 0; i < n; i++) {
      const m = parseInt(keys[i].split('-')[1], 10);
      (byMonth[m] = byMonth[m] || []).push(vals[i]);
    }
    for (const m of Object.keys(byMonth)) seasonal[m] = avg(byMonth[m]) / (yMean || 1);
  }
  const residuals = vals.map((v, i) => v - (slope * i + intercept));
  const rmse = Math.sqrt(avg(residuals, r => r * r));
  const hist = keys.slice(-12).map((k, i) => ({ key: k, value: series[k] }));
  const pred = [];
  for (let i = 0; i < horizon; i++) {
    const t = n + i;
    let base = slope * t + intercept;
    const nextKey = nextPeriodKey(keys[keys.length - 1], granularity, i + 1);
    const m = parseInt(nextKey.split('-')[1] || '1', 10);
    if (seasonal[m]) base *= seasonal[m];
    pred.push({ key: nextKey, value: Math.max(0, base), lo: Math.max(0, base - 1.96 * rmse), hi: base + 1.96 * rmse });
  }
  return { ok: true, granularity, horizon, history: hist, prediction: pred, rmse, trend: slope > 0 ? 'رشد' : 'کاهش' };
}
function nextPeriodKey(lastKey, gran, offset) {
  if (gran === 'day') {
    const [y, m, dd] = lastKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd + offset));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  if (gran === 'week') {
    const [y, m] = lastKey.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-w${offset}`;
  }
  const [y, m] = lastKey.split('-').map(Number);
  let mm = m - 1 + offset, yy = y;
  while (mm > 12) { mm -= 12; yy++; }
  return `${yy}-${String(mm).padStart(2, '0')}`;
}
function keyFa(key, gran) {
  if (gran === 'month') { const [y, m] = key.split('-'); return `${MONTHS_FA[+m - 1]} ${faDigits(y)}`; }
  return key;
}
// ================= EXECUTIVE SUMMARY =================
function executiveSummary() {
  const s = salesSummary('month');
  const d = get();
  const churn = churnList(5).filter(c => c.score >= 60);
  const pipe = d.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) v FROM opportunities WHERE status='open' AND archived_at IS NULL`).get();
  const hotOpps = d.prepare(`SELECT o.title, c.name, o.amount, o.probability FROM opportunities o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.status='open' AND o.probability>=70 AND o.expected_close_at <= datetime('now','+7 day') ORDER BY o.amount DESC LIMIT 3`).all();
  const openComp = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE status IN ('new','in_progress','waiting')`).get().c;
  const slaBreach = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE status IN ('new','in_progress','waiting') AND datetime(due_at) < datetime('now')`).get().c;
  // complaint bank patterns (structured defect bank — last 90 days)
  const topDefectTypes = d.prepare(`SELECT defect_type, COUNT(*) c FROM complaints WHERE defect_type != '' AND created_at >= datetime('now','-90 day') GROUP BY defect_type ORDER BY c DESC LIMIT 3`).all();
  const topDefectProducts = d.prepare(`SELECT p.name, COUNT(*) c FROM complaints cp LEFT JOIN products p ON p.id=cp.product_id WHERE cp.product_id IS NOT NULL AND cp.created_at >= datetime('now','-90 day') GROUP BY cp.product_id ORDER BY c DESC LIMIT 3`).all();
  const topCauses = d.prepare(`SELECT probable_cause, COUNT(*) c FROM complaints WHERE probable_cause != '' AND created_at >= datetime('now','-90 day') GROUP BY probable_cause ORDER BY c DESC LIMIT 2`).all();
  const repeatComplaints = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE repeat_of IS NOT NULL AND created_at >= datetime('now','-90 day')`).get().c;
  const lowStock = d.prepare('SELECT COUNT(*) c FROM stock_alerts WHERE resolved_at IS NULL').get().c;
  const receivables = d.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE status IN ('unpaid','partial','overdue')`).get().s;
  const { curTotal } = s;
  const growth = s.delta >= 0 ? `افزایش ${faDigits(Math.abs(s.delta))}٪` : `کاهش ${faDigits(Math.abs(s.delta))}٪`;
  let txt = `فروش این ماه ${fmtNum(curTotal)} ریال با ${growth} نسبت به ماه قبل است`;
  if (s.declines.length) txt += `. ${s.declines.map(x => x.name).join('، ')} ${s.declines.length > 1 ? 'کاهش خرید محسوسی داشته‌اند' : 'کاهش خرید محسوس داشته است'}`;
  txt += '.';
  if (hotOpps.length) txt += ` ${hotOpps.length} فرصت فروش با احتمال بالای ۷۰٪ تا ۷ روز آینده بسته می‌شوند و نیاز به پیگیری فوری دارند.`;
  else if (pipe.c) txt += ` در Pipeline فعلی ${faDigits(pipe.c)} فرصت به ارزش ${fmtNum(pipe.v)} ریال باز است.`;
  if (churn.length) txt += ` ${churn.length} مشتری (${churn.map(c => c.name).join('، ')}) در معرض ریزش هستند و پیشنهاد می‌شود تماس فعال با آن‌ها برقرار شود.`;
  if (openComp) txt += ` ${openComp} شکایت باز دارد${slaBreach ? ` که ${slaBreach} مورد از آن‌ها از SLA عبور کرده‌اند` : ''}.`;
  if (topDefectTypes.length) txt += ` پرتکرارترین عیب‌های ۹۰ روز اخیر: ${topDefectTypes.map(x => x.defect_type + ' (' + faDigits(x.c) + ' مورد)').join('، ')}.`;
  if (topDefectProducts.length) txt += ` محصولات پرتکرار در شکایات: ${topDefectProducts.map(x => x.name + ' (' + faDigits(x.c) + ')').join('، ')}.`;
  if (topCauses.length) txt += ` علل احتمالی پرتکرار: ${topCauses.map(x => x.probable_cause + ' (' + faDigits(x.c) + ' مورد)').join('، ')}.`;
  if (repeatComplaints) txt += ` ${faDigits(repeatComplaints)} شکایت تکراری در ۹۰ روز اخیر شناسایی شده که نیاز به اقدام پیشگیرانه دارد.`;
  if (lowStock) txt += ` ${lowStock} کالا از حد سفارش مجدد پایین‌تر رفته است.`;
  if (receivables > 0) txt += ` مطالبات باز ${fmtNum(receivables)} ریال است.`;
  txt += ' پیشنهاد اولویت‌بندی: پیگیری فرصت‌های نزدیک سررسید، فعال‌سازی مشتریان در معرض ریزش و وصول مطالبات سررسیدگذشته.';
  return { text: txt, data: { sales: s, churn, pipe, hotOpps, openComp, slaBreach, lowStock, receivables, complaintBank: { topDefectTypes, topDefectProducts, topCauses, repeatComplaints } } };
}
// ================= ANOMALIES =================
function anomalies() {
  const d = get();
  const out = [];
  const n = nowTehran();
  const rows = d.prepare(`SELECT customer_id, issue_date, total FROM invoices WHERE status IN ('unpaid','partial','paid','overdue') AND issue_date >= datetime('now','-12 month')`).all();
  const byCust = new Map();
  for (const r of rows) {
    const dt = new Date(r.issue_date);
    const t = new Date(dt.getTime() + 4.5 * 3600e3);
    const { gregorianToJalaali } = require('../lib/jalali');
    const [jy, jm] = gregorianToJalaali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    const key = `${jy}-${String(jm).padStart(2, '0')}`;
    if (!byCust.has(r.customer_id)) byCust.set(r.customer_id, {});
    const m = byCust.get(r.customer_id);
    m[key] = (m[key] || 0) + r.total;
  }
  for (const [cid, months] of byCust) {
    const vals = Object.keys(months).sort().map(k => months[k]);
    if (vals.length < 4) continue;
    const mean = avg(vals), sd = Math.sqrt(avg(vals, v => (v - mean) ** 2)) || 1;
    const last = vals[vals.length - 1];
    const z = (last - mean) / sd;
    const name = d.prepare('SELECT name FROM customers WHERE id=?').get(cid);
    if (!name) continue;
    if (z < -2) out.push({ customer: name.name, id: cid, type: 'کاهش ناگهانی خرید', detail: `خرید ماه اخیر ${fmtNum(last)} ریال (میانگین ${fmtNum(mean)})`, severity: 'high' });
    if (z > 2.5) out.push({ customer: name.name, id: cid, type: 'افزایش غیرعادی سفارش', detail: `خرید ماه اخیر ${fmtNum(last)} ریال در مقابل میانگین ${fmtNum(mean)}`, severity: 'medium' });
  }
  const od = d.prepare(`SELECT c.name, COALESCE(SUM(i.total - i.paid_amount),0) s, MIN(i.due_date) dd FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','overdue') AND i.due_date < datetime('now','-7 day') GROUP BY c.id HAVING s > 0 ORDER BY s DESC LIMIT 5`).all();
  for (const r of od) out.push({ customer: r.name, type: 'تأخیر پرداخت', detail: `مبلغ ${fmtNum(r.s)} ریال بیش از ۷ روز از سررسید`, severity: 'high' });
  return out;
}
// ================= RECOMMENDATIONS & CROSS-SELL =================
function recommendations(customerId) {
  const d = get();
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!c) return [];
  const recs = [];
  const churn = churnScore(customerId);
  if (churn && churn.score >= 60) recs.push({ action: 'تماس فوری', detail: 'مشتری در معرض ریزش است؛ تماس مدیر فروش توصیه می‌شود.', priority: 1 });
  const overdue = d.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial','overdue') AND (due_date IS NULL OR due_date < datetime('now'))`).get(customerId).s;
  if (overdue > 0) recs.push({ action: 'پیگیری پرداخت', detail: `مطالبات سررسیدگذشته ${fmtNum(overdue)} ریال`, priority: 2 });
  // cross-sell
  const bought = d.prepare(`SELECT DISTINCT ii.product_id FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.customer_id=? AND i.status!='cancelled'`).all(customerId).map(r => r.product_id).filter(Boolean);
  for (const pid of bought.slice(0, 8)) {
    const co = d.prepare(`
      SELECT p.id, p.name, COUNT(*) n FROM invoice_items a
      JOIN invoices i1 ON i1.id=a.invoice_id
      JOIN invoice_items b ON b.invoice_id=i1.id
      JOIN products p ON p.id=b.product_id
      WHERE a.product_id=? AND b.product_id!=? AND i1.customer_id!=?
      GROUP BY p.id ORDER BY n DESC LIMIT 1`).all(pid, pid, customerId);
    if (co[0] && !bought.includes(co[0].id)) {
      recs.push({ action: 'پیشنهاد محصول جدید', detail: `این مشتری ${co[0].n} بار هم‌زمان «${co[0].name}» خریده است؛ احتمال خرید مجدد بالا.`, priority: 3, product_id: co[0].id, product_name: co[0].name });
      break;
    }
  }
  const openComp = d.prepare(`SELECT id, subject FROM complaints WHERE customer_id=? AND status IN ('new','in_progress','waiting')`).all(customerId);
  for (const comp of openComp.slice(0, 2)) recs.push({ action: 'بررسی شکایت', detail: `«${comp.subject}» هنوز باز است.`, priority: 1, ref: { type: 'complaint', id: comp.id } });
  const lastInv = d.prepare(`SELECT issue_date FROM invoices WHERE customer_id=? AND status!='cancelled' ORDER BY issue_date DESC LIMIT 1`).get(customerId);
  if (lastInv && (Date.now() - new Date(lastInv.issue_date).getTime()) > 90 * 864e5) recs.push({ action: 'پیگیری مجدد خرید', detail: 'بیش از ۳ ماه از آخرین خرید می‌گذرد؛ ارسال کاتالوگ یا پیشنهاد ویژه توصیه می‌شود.', priority: 3 });
  if (!recs.length) recs.push({ action: 'نگهداری رابطه', detail: 'وضعیت مشتری پایداری دارد؛ پیگیری دوره‌ای کافی است.', priority: 5 });
  return recs;
}
function clv(customerId) {
  const d = get();
  const inv = d.prepare(`SELECT total, issue_date FROM invoices WHERE customer_id=? AND status!='cancelled'`).all(customerId);
  if (!inv.length) return 0;
  const margin = 0.25;
  const total = inv.reduce((a, i) => a + i.total, 0);
  const days = inv.length > 1 ? (Date.now() - new Date(inv[inv.length - 1].issue_date).getTime()) / 864e5 : 0;
  const freq = days > 0 ? inv.length / (days / 365) : inv.length;
  return Math.round(total * margin + (days > 30 ? freq * avg(inv, i => i.total) * 0.5 * margin : 0));
}
// ================= RAG-LITE (TF-IDF) =================
let _kbCache = null, _kbCacheAt = 0;
function kbIndex() {
  if (_kbCache && Date.now() - _kbCacheAt < 120000) return _kbCache;
  const docs = get().prepare(`SELECT id, title, text_content FROM documents WHERE COALESCE(text_content,'') != ''`).all();
  const chunks = [];
  const STOP = new Set(['و','در','که','از','به','برای','این','هم','با','یا','اما','است','هستند','می','شود','شد','دارد','دارند','خود','به','آن','او','ما','شما','چرا','چگونه','چه','کدام','هزار','میلیون','ریال','تومان','فوم','شرکت']);
  function toks(s) { return normalizeFa(s).split(/[\s،.!?؛:()«»"'-]+/).filter(t => t.length > 1 && !STOP.has(t)); }
  let maxF = 1;
  for (const doc of docs) {
    const paras = String(doc.text_content).split(/\n+|(?<=[.!?])\s+/).filter(p => p.trim().length > 40);
    for (const p of paras) {
      const tf = {};
      for (const t of toks(p)) tf[t] = (tf[t] || 0) + 1;
      const keys = Object.keys(tf);
      for (const t of keys) maxF = Math.max(maxF, tf[t]);
      chunks.push({ docId: doc.id, title: doc.title, text: p.trim().slice(0, 600), tf });
    }
  }
  const N = chunks.length || 1;
  const df = {};
  for (const c of chunks) for (const t of Object.keys(c.tf)) df[t] = (df[t] || 0) + 1;
  for (const c of chunks) {
    for (const t of Object.keys(c.tf)) c.tf[t] = (1 + Math.log(c.tf[t])) * Math.log(1 + N / (1 + (df[t] || 0)));
  }
  _kbCache = { chunks, maxF, toks };
  _kbCacheAt = Date.now();
  return _kbCache;
}
function rag(query, topK = 3) {
  const idx = kbIndex();
  if (!idx.chunks.length) return { ok: false, message: 'پایگاه دانش خالی است. ابتدا سند در «هوش مصنوعی ← پایگاه دانش» ثبت کنید.' };
  const qt = idx.toks(query);
  const qvec = {};
  for (const t of qt) qvec[t] = (qvec[t] || 0) + 1;
  let qnorm = Math.sqrt(Object.values(qvec).reduce((a, b) => a + b * b, 0)) || 1;
  const scored = idx.chunks.map(c => {
    let dot = 0, cnorm2 = 0;
    for (const t of Object.keys(c.tf)) { cnorm2 += c.tf[t] ** 2; if (qvec[t]) dot += qvec[t] * c.tf[t]; }
    const score = dot / (qnorm * (Math.sqrt(cnorm2) || 1));
    return { score, ...c };
  }).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK).filter(s => s.score > 0.05);
  if (!top.length) return { ok: false, message: 'مورد مرتبطی در پایگاه دانش پیدا نشد.', query };
  const answer = top.map((t, i) => `${i + 1}. ${t.text}`.slice(0, 700)).join('\n\n');
  return { ok: true, answer, sources: top.map(t => ({ docId: t.docId, title: t.title })) };
}
module.exports = {
  sentiment, classifyComplaint, rootCause, analyzeComplaint,
  scoreLead, rescoreAllLeads, churnScore, churnList,
  salesSummary, forecast, executiveSummary, anomalies,
  recommendations, clv, rag, keyFa, salesTotals,
};
