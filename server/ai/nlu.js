'use strict';
const { normalizeFa, toEnDigits } = require('../lib/util');

// Farsi NLU-lite: intent detection + slot extraction
function parse(query) {
  const raw = String(query || '').trim();
  const q = normalizeFa(raw);
  const intent = { name: 'unknown', slots: {}, raw };

  const period = (() => {
    if (/امروز|روز امروز/.test(q)) return 'today';
    if (/این هفته|هفته جاری|این هفته/.test(q)) return 'week';
    if (/ماه قبل|ماه گذشته/.test(q)) return 'last_month';
    if (/این ماه|ماه جاری|ماه امسال|ماه/.test(q)) return 'month';
    if (/این سال|سال جاری|سال امسال|سال/.test(q)) return 'year';
    if (/دیروز/.test(q)) return 'yesterday';
    return null;
  })();
  intent.slots.period = period;

  const companyMatch = q.match(/(?:شرکت|فروشگاه|کارخانه|سازمان)\s+([ء-يa-z0-9\s]{2,40}?)(?:\s+(?:است|چطور|چیه|چیست|را|دارد|کرد|کرده|بود|بده|نشان|بیاور)[\s؟؟]*)?(?:[؟?]|$)/);
  if (companyMatch) intent.slots.company = companyMatch[1].trim();

  // ---- Action intent (real side-effect, item 35): AI quick customer registration ----
  if (/(ثبت|درج|ساخت|ایجاد|اعمال)(?:\s+(?:کن|بده|را|شو))?\s*(?:یک\s*|یه\s*|مستقیم\s*|سریع\s*)?(?:مشتری|شرکت)/.test(q)) {
    intent.name = 'register_customer';
    const dn = toEnDigits(q);
    const mobM = dn.match(/(?:^|\D)((?:0098|98|0)?9\d{9})(?=\D|$)/);
    const phM = dn.match(/(?:^|\D)(0\d{9,10})(?=\D|$)/);
    if (mobM) intent.slots.mobile = mobM[1];
    else if (phM) intent.slots.phone = phM[1];
    const emM = dn.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (emM) intent.slots.email = emM[0];
    const cityM = dn.match(/شهر\s+([\u0600-\u06FFa-z0-9\s\-]{2,30}?)(?=\s*(?:با|تلفن|موبایل|ایمیل|شماره|آدرس|شناسه|کد)|[،,;؛:]|$)/);
    if (cityM) intent.slots.city = cityM[1].trim();
    const taxM = dn.match(/(?:شناسه(?: ملی| اقتصادی)?|تکس|tax)\s*[:\-]?\s*(\d{4,20})/);
    if (taxM) intent.slots.tax_code = taxM[1];
    if (/(?:شخص|شخصی|حقیقی|فرد)/.test(q)) intent.slots.type = 'person';
    else if (/(?:شرکت|حقوقی|سازمان|کارخانه|فروشگاه)/.test(q)) intent.slots.type = 'company';
    // name: from the ORIGINAL text (normalizeFa breaks spelling: آ→ا), after the
    // action phrase, up to first phone / delimiter / keyword
    let s = raw
      .replace(/^(?:لطفاً?|خوب|باشه|ممنون)?\s*/, '')
      .replace(/^(?:ثبت|درج|ساخت|ایجاد|اعمال)(?:\s+(?:کن|بده|را|شو))?\s*(?:یک\s*|یه\s*|مستقیم\s*|سریع\s*)?/, '')
      .replace(/مشتری(ان)?\s*(?:جدید)?\s*/g, ' ')
      .replace(/^\s*(?:شخصی|شخص|حقیقی|فرد)\s+/, '')
      .replace(/\s+(?:را|رو)\s*$/, '')
      .replace(/\s*(?:کن|بده|بگیر|باشه|لطفاً?)\.?\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    s = s.split(/(?:0098|98|0)?9\d{9}|0\d{9,}/)[0];
    s = s.split(/[،,;؛:]/)[0];
    s = s.split(/\s+(?:با|در|شماره|تلفن|موبایل|ایمیل|شهر|آدرس|شناسه|کد|کانال|از)\s+/)[0];
    intent.slots.name = s.trim();
  } else
  if (/ریزش|درخطر|در خطر|نابود شدن|رو به افول/.test(q)) intent.name = 'churn_risk';
  else if (/(بهترین|برترین|عمده|مهم‌?ترین|تاپ)\s*مشتری/.test(q)) intent.name = 'top_customers';
  else if (/احتمال خرید|خرید مجدد|بازگشت به خرید|دوباره خرید/.test(q)) intent.name = 'repurchase';
  else if (/پیش‌?بینی|forecast|آینده فروش|فروش آینده/.test(q)) intent.name = 'forecast';
  else if (/مطالبات|وصول|بدهی مشتریان|پرداخت نشده|حساب باز|حساب‌های باز/.test(q)) intent.name = 'receivables';
  else if (/شکای/.test(q)) intent.name = 'complaints'; // شکای / شکایت / شکایات (plural morphology)
  else if (/(موجودی|انبار)( کم| نام| کافی| کمه)?/.test(q) && /(کم|نام|هشدار|کسری|پایان|تمام)/.test(q)) intent.name = 'stock_low';
  else if (/موجودی|انبار/.test(q)) intent.name = 'stock';
  else if (/سفارش.*وضعیت|وضعیت.*سفارش/.test(q)) intent.name = 'order_status';
  else if (/فرصت(های)?( فروش)?/.test(q)) intent.name = 'opportunities';
  else if (/مشتری( جدید|ان جدید|های جدید)/.test(q)) intent.name = 'new_customers';
  else if (/(فروش|درآمد|نرخ فروش|مجموع فروش|فروش چقدر|فروش ما)/.test(q)) intent.name = 'sales';
  else if (/کارشناس|فروشنده(ان)?/.test(q) && /عملکرد|فروش/.test(q)) intent.name = 'salesperson_perf';
  else if (/هشدار|انomaly|غیرعادی|ناتمام/.test(q)) intent.name = 'anomalies';
  else if (/توصیه|پیشنهاد|چه کار|چه باید|چه کنم|چکار/.test(q)) intent.name = 'advice';
  else if (/\d{4}\/\d{1,2}\/\d{1,2}/.test(toEnDigits(q))) intent.name = 'date_query';

  // fallback: if contains 'مشتری' → top_customers when 'بهترین' missing? keep unknown → RAG
  return intent;
}
module.exports = { parse };
