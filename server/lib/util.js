'use strict';
const crypto = require('crypto');
const { gregorianToJalaali, jalaaliToGregorian, isLeapJalaaliYear, jalaaliMonthLength } = require('../lib/jalali');

const TZA = 4.5 * 3600 * 1000; // Asia/Tehran UTC+4:30

const MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const WEEKDAYS_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const MONTHS_EN = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];

function pad(n) { return String(n).padStart(2, '0'); }
function nowIso() { return new Date().toISOString(); }
function nowTehran() {
  const t = new Date(Date.now() + TZA);
  const gy = t.getUTCFullYear(), gm = t.getUTCMonth() + 1, gd = t.getUTCDate();
  const [jy, jm, jd] = gregorianToJalaali(gy, gm, gd);
  const dow = t.getUTCDay(); // 0=Sun
  return { gy, gm, gd, jy, jm, jd, dow, iso: new Date().toISOString() };
}
function faDigits(s) {
  const map = { '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹' };
  return String(s).replace(/[0-9]/g, d => map[d]);
}
function toEnDigits(s) {
  const map = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
  return String(s).replace(/[۰-۹]/g, d => map[d]);
}
function fmtNum(n, fa = true) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const neg = n < 0 ? '-' : '';
  const [i, d] = String(Math.abs(Number(n)).toFixed(0)).split('.');
  let out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (fa) out = faDigits(out);
  return neg + out;
}
function fmtMoney(n, fa = true, unit = 'ریال') {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return fmtNum(Math.round(n), fa) + (fa ? ' ' + unit : ' ' + unit);
}
function fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const fa = opts.fa !== false;
  const d = new Date(iso);
  const gy = d.getFullYear(), gm = d.getMonth() + 1, gd = d.getDate();
  const [jy, jm, jd] = gregorianToJalaali(gy, gm, gd);
  if (opts.time) {
    const hr = fa ? faDigits(pad(d.getHours())) : pad(d.getHours());
    const mn = fa ? faDigits(pad(d.getMinutes())) : pad(d.getMinutes());
    return `${fmtDate(iso, { ...opts, time: false })} - ${hr}:${mn}`;
  }
  if (fa) return `${faDigits(jy)}/${faDigits(pad(jm))}/${faDigits(pad(jd))}`;
  return `${jy}-${pad(jm)}-${pad(jd)}`;
}
function fmtDateLong(iso, fa = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  const gy = d.getFullYear(), gm = d.getMonth() + 1, gd = d.getDate();
  const [jy, jm, jd] = gregorianToJalaali(gy, gm, gd);
  const months = fa ? MONTHS_FA : MONTHS_EN;
  const wd = fa ? WEEKDAYS_FA[d.getDay()] : '';
  const y = fa ? faDigits(jy) : jy, m = fa ? faDigits(pad(jm)) : pad(jm), day = fa ? faDigits(jd) : jd;
  return `${wd ? wd + ' ' : ''}${day} ${months[jm - 1]} ${y}`;
}
function toJalaali(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return gregorianToJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function jalaliToIso(jy, jm, jd, hour = 0, min = 0) {
  const [gy, gm, gd] = jalaaliToGregorian(jy, jm, jd);
  return new Date(gy, gm - 1, gd, hour, min).toISOString();
}
// format ISO date/datetime for exports (CSV/XLSX/JSON/DOC) — Shamsi, Persian digits
function jalExport(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const [jy, jm, jd] = gregorianToJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const base = faDigits(jy) + '/' + faDigits(pad(jm)) + '/' + faDigits(pad(jd));
  if (/T\d{2}:\d{2}/.test(v)) return base + ' ' + faDigits(pad(d.getHours())) + ':' + faDigits(pad(d.getMinutes()));
  return base;
}
function monthLength(jy, jm) { return jalaaliMonthLength(jy, jm); }
// period helpers on jalali years
function jalaliPeriodRange(p) {
  const n = nowTehran();
  let jy = n.jy, jm = n.jm;
  if (p === 'today') { const [gy, gm, gd] = jalaaliToGregorian(jy, jm, 1); return { from: new Date(gy, gm - 1, gd).toISOString(), to: new Date(Date.now() + 1).toISOString() }; }
  if (p === 'month') { const [gy, gm, gd] = jalaaliToGregorian(jy, jm, 1); const [gy2, gm2, gd2] = jalaaliToGregorian(jy, jm, monthLength(jy, jm)); return { from: new Date(gy, gm - 1, gd).toISOString(), to: new Date(gy2, gm2 - 1, gd2, 23, 59, 59).toISOString() }; }
  if (p === 'year') { const [gy, gm, gd] = jalaaliToGregorian(jy, 1, 1); const [gy2, gm2, gd2] = jalaaliToGregorian(jy, 12, monthLength(jy, 12)); return { from: new Date(gy, gm - 1, gd).toISOString(), to: new Date(gy2, gm2 - 1, gd2, 23, 59, 59).toISOString() }; }
  if (p === 'last_month') { jm--; if (jm < 1) { jm = 12; jy--; } const [gy, gm, gd] = jalaaliToGregorian(jy, jm, 1); const [gy2, gm2, gd2] = jalaaliToGregorian(jy, jm, monthLength(jy, jm)); return { from: new Date(gy, gm - 1, gd).toISOString(), to: new Date(gy2, gm2 - 1, gd2, 23, 59, 59).toISOString() }; }
  if (p === 'week') { const d = new Date(); d.setHours(0, 0, 0, 0); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); d.setDate(d.getDate() + 7); return { from: new Date(d.getTime() - 7 * 864e5).toISOString(), to: d.toISOString() }; }
  return { from: null, to: null };
}
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function base64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function parseId(s) { const n = parseInt(toEnDigits(String(s)), 10); return Number.isFinite(n) ? n : null; }
function deepClone(o) { return o === undefined ? o : JSON.parse(JSON.stringify(o)); }
function pick(obj, keys) { const o = {}; for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k]; return o; }
function sum(arr, f) { return arr.reduce((a, x) => a + (f ? f(x) : x), 0); }
function avg(arr, f) { return arr.length ? sum(arr, f) / arr.length : 0; }
function groupBy(arr, f) { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
function titleFa(s) { return s; }
// normalize persian text for matching/search
function normalizeFa(s) {
  return toEnDigits(String(s || ''))
    .replace(/[يی]/g, 'ی')
    .replace(/[كك]/g, 'ک')
    .replace(/هـ/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ـ/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .toLowerCase()
    .trim();
}
// similarity of two persian names (token jaccard on normalized)
function nameSimilarity(a, b) {
  const ta = normalizeFa(a).split(/\s+/).filter(x => x.length > 1);
  const tb = normalizeFa(b).split(/\s+/).filter(x => x.length > 1);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta), sb = new Set(tb);
  let inter = 0; for (const t of sa) if (sb.has(t)) inter++;
  return inter / new Set([...sa, ...sb]).size;
}
function likeEscape(s) { return String(s).replace(/[\\%_]/g, m => '\\' + m); }
module.exports = {
  MONTHS_FA, MONTHS_EN, WEEKDAYS_FA, pad, nowIso, nowTehran, faDigits, toEnDigits,
  fmtNum, fmtMoney, fmtDate, fmtDateLong, toJalaali, jalaliToIso, jalExport, monthLength, jalaliPeriodRange,
  randomToken, uuid, base64url, sha256, esc, parseId, deepClone, pick, sum, avg, groupBy,
  normalizeFa, nameSimilarity, likeEscape,
};
