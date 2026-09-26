'use strict';
// Voice → structured customer fields. Runs on the RAW speech transcript text
// (produced by the browser's Web Speech API in fa-IR). Pure text analysis —
// no online service, no fake: returns exactly what was found (null otherwise).
const { toEnDigits, normalizeFa } = require('../lib/util');

const PROVINCES = [
  'آذربایجان شرقی', 'آذربایجان غربی', 'اردبیل', 'اصفهان', 'البرز', 'ایلام', 'بوشهر',
  'چهارمحال و بختیاری', 'خراسان جنوبی', 'خراسان رضوی', 'خراسان شمالی', 'خوزستان',
  'زنجان', 'سمنان', 'سیستان و بلوچستان', 'فارس', 'گیلان', 'گلستان', 'کردستان',
  'کهگیلویه و بویراحمد', 'کرمان', 'قزوین', 'قم', 'لرستان', 'مازندران', 'مرکزی',
  'هرمزگان', 'همدان', 'یزد', 'تهران',
];

// Letter/digit class: Persian letters (block base + پ چ ژ گ ک ی …) + digits + latin.
// Deliberately EXCLUDES punctuation (، ؛ ؟ . : etc.) so words never cross commas.
const L = '[\\u0621-\\u064A\\u0671\\u067E\\u0686\\u068D\\u0698\\u06AF\\u06A9\\u06B5\\u06C0-\\u06CE\\u0660-\\u0669\\u06F0-\\u06F9a-z0-9]';
const W = L + '+(?:[\\s\\-]+' + L + '+)*'; // one or more words (spaces/dashes between letter-runs only)
const SEP = '(?:[،,;؛:؟?.\\…]|$)';
const BE = '\\s*(?:هست|هستم|است|بود|هستیم)\\s*';

// The word pattern W is greedy across spaces, so a captured phrase can swallow
// a trailing copula ("شیراز هستیم"). Strip trailing copula/filler words so the
// extracted value stays clean.
const COPLET = /\s+(?:هست|هستم|هستند|هستیم|هستید|بود|شد|ما|شما|ایم|فعالیت|می‌کنیم|کنیم)(?=\s*)$/;
const stripCopula = (s) => String(s || '').replace(COPLET, '').replace(/\s+/g, ' ').trim();

function extractCustomerFields(rawText) {
  const out = { name: null, company: null, mobile: null, phone: null, position: null, industry: null, province: null, city: null, industrial_city: null, notes: null, confidence: 0 };
  const text = String(rawText || '').trim();
  if (!text) return out;
  const q = normalizeFa(text);
  const digits = toEnDigits(q);
  const found = (k) => { if (out[k] !== null) out.confidence++; };

  // phones: mobile 09XXXXXXXXX (11 digits), landline 0XXXXXXXXX (10 digits)
  const mobM = digits.match(/(?:^|\D)(09\d{9})(?=\D|$)/);
  const phM = digits.match(/(?:^|\D)(0\d{9})(?=\D|$)/);
  if (mobM) { out.mobile = mobM[1]; found('mobile'); }
  if (phM && (!mobM || /تلفن|خط/.test(digits))) { out.phone = phM[1]; found('phone'); }

  // industrial city: «شهرک (صنعتی) X»
  const indM = q.match(new RegExp('شهرک\\s+(?:صنعتی\\s+)?(' + W + ')(?=' + BE + SEP + '|' + SEP + '|\\s+(?:فعالیت|ما|شرکت)|$)'));
  if (indM) { out.industrial_city = stripCopula(indM[1].trim()); found('industrial_city'); }

  // company: «شرکت X» (skip 'شرکت صنعتی …')
  const compM = q.match(new RegExp('شرکت\\s+(?!صنعتی\\s)(' + W + ')(?=' + BE + SEP + '|\\s+(?:فعالیت|را|و|در|از|با|شماره|تلفن|موبایل|شهر|استان|منظور)|$)'));
  if (compM) { out.company = stripCopula(compM[1].trim()); found('company'); }

  // name: «نامم X» / «نام من X هست(م)» / «من X هستم» / «نام X است»
  let nameM = q.match(new RegExp('نام(?:م|\\s+من|\\s+م)?\\s*(' + W + ')(?=' + BE + SEP + ')'))
    || q.match(new RegExp('(?:من|خودم)\\s+(' + W + ')\\s+هستم' + SEP + ''))
    || q.match(new RegExp('نام\\s+(' + W + ')(?=\\s+است' + SEP + ')'));
  if (nameM) {
    const nm = nameM[1].replace(/\b(آقا|سرکار|خانم|جناب)\b/g, '').replace(/\s+/g, ' ').trim();
    if (nm.length >= 2 && nm.length <= 40 && !/شرکت|صنعت|هستیم/.test(nm)) { out.name = nm; found('name'); }
  }

  // position: «سمت(م| من) X (هست)»
  const posM = q.match(new RegExp('سمت(?:م|\\s+من)?\\s*(' + W + ')(?=' + BE + SEP + ')'));
  if (posM) {
    const pm = stripCopula(posM[1].trim());
    if (pm.length >= 2 && pm.length <= 30) { out.position = pm; found('position'); }
  }

  // industry: «در صنعت X فعالیت» / «صنعت X»
  // gather candidates (prefer explicit 'در صنعت X'; drop geo-sounding values)
  const cand = [];
  const reDr = new RegExp('در\\s+صنعت\\s+(' + W + ')(?=\\s+فعالیت|' + SEP + ')', 'g');
  let mDr; while ((mDr = reDr.exec(q)) !== null) cand.push({ v: mDr[1].trim(), score: 2 });
  const rePlain = new RegExp('صنعت(?:ی)?\\s+(' + W + ')(?=\\s+(?:فعالیت|هستیم|ما|شرکت)|' + SEP + ')', 'g');
  let mPl; while ((mPl = rePlain.exec(q)) !== null) cand.push({ v: mPl[1].trim(), score: 1 });
  for (const c of cand.sort((a, b) => b.score - a.score)) {
    const v = c.v;
    if (!v || v.length < 2) continue;
    if (out.city && normalizeFa(v) === normalizeFa(out.city)) continue;
    if (out.industrial_city && normalizeFa(v) === normalizeFa(out.industrial_city)) continue;
    if (out.province && normalizeFa(v) === normalizeFa(out.province)) continue;
    if (/شهرک|صنعت/.test(v)) continue;
    out.industry = v; found('industry'); break;
  }

  // province: exact match from the canonical 30
  for (const p of PROVINCES) {
    const pn = normalizeFa(p);
    if (q.includes('استان ' + pn) || q.endsWith(pn) || new RegExp('\\b' + pn.replace(/[-\\]/g, '\\$&') + '\\b').test(q)) {
      out.province = p; found('province'); break;
    }
  }

  // city: «شهر X» first, then «در X» (not starting with صنعت/شهرک, not a province)
  let cityM = q.match(new RegExp('شهر\\s+(' + W + ')(?=\\s+(?:شهرک|فعالیت|هستیم|ما)|' + SEP + ')'));
  if (!cityM) cityM = q.match(new RegExp('در\\s+(?!صنعت|شهرک|شهر\\s)(' + L + '(?:[\\s\\-]?' + L + '){1,29})(?=\\s+(?:فعالیت|شهرک|شماره|تلفن|موبایل)|' + SEP + ')'));
  if (cityM) {
    const c = stripCopula(cityM[1].trim());
    if (c.length >= 2 && !PROVINCES.some(p => normalizeFa(p) === normalizeFa(c)) && !/صنعت|شهرک/.test(c)) { out.city = c; found('city'); }
  }

  // notes: keep the raw transcript (never lossy)
  out.notes = text.length > 1500 ? text.slice(0, 1500) + '…' : text;
  out.confidence = Math.min(10, out.confidence);
  out.complete = !!(out.name && (out.mobile || out.phone));
  return out;
}
module.exports = { extractCustomerFields, PROVINCES };
