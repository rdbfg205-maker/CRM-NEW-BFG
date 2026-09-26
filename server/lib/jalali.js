'use strict';
// Vendored Jalaali calendar wrapper (zero external deps, byte-exact identifiers).
const lib = require('./jalali-vendor.js');
function pick(suffix) {
  const k = Object.keys(lib).find(function (k) { return k.endsWith(suffix); });
  if (!k || typeof lib[k] !== 'function') throw new Error('vendor missing *' + suffix);
  return lib[k];
}
const toJalaali = pick('toJalaali');
const toGregorian = pick('toGregorian');
const jalaaliMonthLength = pick('jalaaliMonthLength');
const isLeapJalaaliYear = pick('isLeapJalaaliYear');
function gregorianToJalaali(gy, gm, gd) { const r = toJalaali(gy, gm, gd); return [r.jy, r.jm, r.jd]; }
function jalaaliToGregorian(jy, jm, jd) { const r = toGregorian(jy, jm, jd); return [r.gy, r.gm, r.gd]; }
(function selfTest() {
  const a = gregorianToJalaali(2026, 8, 27);
  if (a[0] !== 1405 || a[1] !== 6 || a[2] !== 5) throw new Error('self-test 1 failed');
  if (jalaaliMonthLength(1403, 12) !== 30 || jalaaliMonthLength(1404, 12) !== 29) throw new Error('self-test 2 failed');
  const g = jalaaliToGregorian(1403, 12, 30);
  if (g[0] !== 2025 || g[1] !== 3 || g[2] !== 20) throw new Error('self-test 3 failed');
})();
module.exports = { gregorianToJalaali: gregorianToJalaali, jalaaliToGregorian: jalaaliToGregorian, isLeapJalaaliYear: isLeapJalaaliYear, jalaaliMonthLength: jalaaliMonthLength };
