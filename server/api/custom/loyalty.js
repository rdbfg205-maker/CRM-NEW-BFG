'use strict';
// Section 9 — Customer Club (باشگاه مشتریان): accounts, points, transactions, rules, export.
// Works on the EXISTING loyalty schema (loyalty_accounts / loyalty_transactions / loyalty_tiers).
// Real data only; per-entity permissions; audit on every change; never fabricates.
const { get, getSetting, setSetting } = require('../../db/db');
const { requirePerm } = require('../../auth/auth');
const { nowIso, fmtDate, likeEscape } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { audit } = require('../../core/audit');
const XLSX = require('xlsx');

const TX_TYPES = ['earn', 'redeem', 'adjust'];
// earn rate: points per RIAL (default 0.001 = 1 point per 1,000 rials) — shared with the sales flow
function earnRate() {
  try { return Math.max(0, Number(JSON.parse(getSetting('loyalty_earn_rate') || '0'))); } catch { return 0; }
}
function setEarnRate(user, rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(422, 'VALIDATION', 'نرخ امتیاز نامعتبر است (0 تا 100).');
  setSetting('loyalty_earn_rate', String(n));
  audit(user, 'loyalty_account', 0, 'rules_update', null, { earn_rate: n });
  return { earn_rate: n };
}
function tierForPoints(d, points) {
  return d.prepare('SELECT * FROM loyalty_tiers WHERE min_points <= ? ORDER BY min_points DESC LIMIT 1').get(points) || null;
}
// recompute the account tier from points_earned (returns the tier or null)
function applyTier(d, customerId) {
  const acc = d.prepare('SELECT * FROM loyalty_accounts WHERE customer_id=?').get(customerId);
  if (!acc) return null;
  const t = tierForPoints(d, acc.points_earned);
  if (t && t.id !== acc.tier_id) d.prepare('UPDATE loyalty_accounts SET tier_id=? WHERE customer_id=?').run(t.id, customerId);
  return t;
}
function accountView(d, customerId) {
  return d.prepare(`SELECT la.*, c.name AS customer_name, c.phone AS customer_phone, c.mobile AS customer_mobile, c.status AS customer_status,
    lt.name AS tier_name, lt.discount_pct AS tier_discount, lt.min_points AS tier_min_points
  FROM loyalty_accounts la
  LEFT JOIN customers c ON c.id=la.customer_id
  LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id
  WHERE la.customer_id=?`).get(customerId);
}
// ---------------- accounts ----------------
function listAccounts(user, q) {
  requirePerm(user, 'loyalty_account', 'view');
  const d = get();
  const where = ['1=1'], params = [];
  if (q.q) {
    const term = '%' + likeEscape(String(q.q)) + '%';
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.mobile LIKE ? OR lt.name LIKE ?)');
    params.push(term, term, term, term);
  }
  if (q.f_tier_id) { where.push('la.tier_id = ?'); params.push(Number(q.f_tier_id)); }
  if (q.f_customer_status) { where.push('c.status = ?'); params.push(q.f_customer_status); }
  const perPage = Math.min(parseInt(q.per_page) || 50, 500);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const total = d.prepare(`SELECT COUNT(*) c FROM loyalty_accounts la
    LEFT JOIN customers c ON c.id=la.customer_id LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id WHERE ${where.join(' AND ')}`).get(...params).c;
  const rows = d.prepare(`SELECT la.*, c.name AS customer_name, c.phone AS customer_phone, c.mobile AS customer_mobile, c.status AS customer_status,
    lt.name AS tier_name, lt.discount_pct AS tier_discount
    FROM loyalty_accounts la
    LEFT JOIN customers c ON c.id=la.customer_id
    LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id
    WHERE ${where.join(' AND ')} ORDER BY la.points_balance DESC, la.id DESC LIMIT ? OFFSET ?`).all(...params, perPage, (page - 1) * perPage);
  return { items: rows, total, page, per_page: perPage };
}
function getAccount(user, customerId) {
  requirePerm(user, 'loyalty_account', 'view');
  const d = get();
  const acc = accountView(d, Number(customerId));
  if (!acc) throw new HttpError(404, 'NOT_FOUND', 'حساب باشگاه پیدا نشد.');
  return { item: acc };
}
function createAccount(user, b) {
  requirePerm(user, 'loyalty_account', 'create');
  const d = get();
  const customerId = Number(b.customer_id);
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  const existing = d.prepare('SELECT * FROM loyalty_accounts WHERE customer_id=?').get(customerId);
  if (existing) throw new HttpError(409, 'DUPLICATE', 'این مشتری قبلاً در باشگاه ثبت شده است.');
  let tierId = 0;
  if (b.tier_id) {
    const t = d.prepare('SELECT id, min_points FROM loyalty_tiers WHERE id=?').get(Number(b.tier_id));
    if (!t) throw new HttpError(422, 'VALIDATION', 'سطح نامعتبر است.');
    tierId = t.id;
  }
  const info = d.prepare('INSERT INTO loyalty_accounts(customer_id, tier_id, points_balance, points_earned) VALUES(?,?,0,0)').run(customerId, tierId);
  const id = Number(info.lastInsertRowid);
  audit(user, 'loyalty_account', id, 'create', null, { customer_id: customerId, tier_id: tierId, customer: c.name });
  return { id, item: accountView(d, customerId) };
}
function updateAccount(user, customerId, b) {
  requirePerm(user, 'loyalty_account', 'edit');
  const d = get();
  const acc = d.prepare('SELECT * FROM loyalty_accounts WHERE customer_id=?').get(Number(customerId));
  if (!acc) throw new HttpError(404, 'NOT_FOUND', 'حساب باشگاه پیدا نشد.');
  const changes = {};
  if (b.tier_id !== undefined) {
    const tid = b.tier_id ? Number(b.tier_id) : 0;
    if (tid && !d.prepare('SELECT id FROM loyalty_tiers WHERE id=?').get(tid)) throw new HttpError(422, 'VALIDATION', 'سطح نامعتبر است.');
    changes.tier_id = tid;
  }
  if (b.points_balance !== undefined && b.points_balance !== null && b.points_balance !== '') {
    const n = Math.trunc(Number(b.points_balance));
    if (!Number.isFinite(n) || n < 0) throw new HttpError(422, 'VALIDATION', 'موجودی امتیاز نامعتبر است.');
    changes.points_balance = n;
  }
  const keys = Object.keys(changes);
  if (keys.length) {
    const old = { tier_id: acc.tier_id, points_balance: acc.points_balance };
    d.prepare(`UPDATE loyalty_accounts SET ${keys.map(k => k + '=?').join(',')} WHERE customer_id=?`).run(...keys.map(k => changes[k]), acc.customer_id);
    audit(user, 'loyalty_account', acc.id, 'edit', old, changes);
  }
  return { ok: true, item: accountView(d, acc.customer_id) };
}
function deleteAccount(user, customerId) {
  requirePerm(user, 'loyalty_account', 'delete');
  const d = get();
  const acc = d.prepare('SELECT * FROM loyalty_accounts WHERE customer_id=?').get(Number(customerId));
  if (!acc) throw new HttpError(404, 'NOT_FOUND', 'حساب باشگاه پیدا نشد.');
  if (d.prepare('SELECT COUNT(*) c FROM loyalty_transactions WHERE customer_id=?').get(acc.customer_id).c > 0) {
    throw new HttpError(400, 'HAS_TRANSACTIONS', 'حساب دارای سابقهٔ تراکنش است و قابل حذف نیست.');
  }
  d.prepare('DELETE FROM loyalty_accounts WHERE customer_id=?').run(acc.customer_id);
  audit(user, 'loyalty_account', acc.id, 'delete', { customer_id: acc.customer_id }, null);
  return { ok: true };
}
// ---------------- transactions ----------------
function listTransactions(user, q) {
  requirePerm(user, 'loyalty_transaction', 'view');
  const d = get();
  const where = ['1=1'], params = [];
  if (q.q) {
    const term = '%' + likeEscape(String(q.q)) + '%';
    where.push('(c.name LIKE ? OR t.note LIKE ? OR lt.name LIKE ?)');
    params.push(term, term, term);
  }
  if (q.f_customer_id) { where.push('t.customer_id = ?'); params.push(Number(q.f_customer_id)); }
  if (q.f_type) {
    if (!TX_TYPES.includes(q.f_type)) throw new HttpError(422, 'VALIDATION', 'نوع تراکنش نامعتبر است.');
    where.push('t.type = ?'); params.push(q.f_type);
  }
  if (q.f_from) { where.push('t.created_at >= ?'); params.push(q.f_from); }
  if (q.f_to) { where.push('t.created_at <= ?'); params.push(q.f_to); }
  const perPage = Math.min(parseInt(q.per_page) || 100, 1000);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const total = d.prepare(`SELECT COUNT(*) c FROM loyalty_transactions t
    LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN loyalty_tiers lt ON lt.id=(SELECT tier_id FROM loyalty_accounts WHERE customer_id=t.customer_id)
    WHERE ${where.join(' AND ')}`).get(...params).c;
  const rows = d.prepare(`SELECT t.*, c.name AS customer_name, c.phone AS customer_phone,
    la.tier_id, lt.name AS tier_name,
    la.points_balance AS balance_now
    FROM loyalty_transactions t
    LEFT JOIN customers c ON c.id=t.customer_id
    LEFT JOIN loyalty_accounts la ON la.customer_id=t.customer_id
    LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id
    WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT ? OFFSET ?`).all(...params, perPage, (page - 1) * perPage);
  return { items: rows, total, page, per_page: perPage };
}
function addTransaction(user, b) {
  requirePerm(user, 'loyalty_transaction', 'create');
  const d = get();
  const type = b.type;
  if (!TX_TYPES.includes(type)) throw new HttpError(422, 'VALIDATION', 'نوع تراکنش نامعتبر است (earn/redeem/adjust).');
  const points = Math.trunc(Number(b.points));
  if (!Number.isFinite(points) || points === 0) throw new HttpError(422, 'VALIDATION', 'مقدار امتیاز نامعتبر است.');
  if ((type === 'earn' || type === 'redeem') && points < 0) throw new HttpError(422, 'VALIDATION', 'مقدار امتیاز باید مثبت باشد.');
  let customerId = b.customer_id ? Number(b.customer_id) : null;
  if (!customerId && b.account_id) {
    const acc = d.prepare('SELECT customer_id FROM loyalty_accounts WHERE id=?').get(Number(b.account_id));
    if (!acc) throw new HttpError(404, 'NOT_FOUND', 'حساب باشگاه پیدا نشد.');
    customerId = acc.customer_id;
  }
  if (!customerId) throw new HttpError(422, 'VALIDATION', 'مشتری/حساب مشخص نشده است.');
  let acc = d.prepare('SELECT * FROM loyalty_accounts WHERE customer_id=?').get(customerId);
  if (!acc) throw new HttpError(404, 'NOT_FOUND', 'این مشتری در باشگاه نیست (ابتدا عضویت ثبت شود).');
  // stored `points` is always the signed delta applied to the balance
  const stored = type === 'earn' ? points : type === 'redeem' ? -points : points;
  const newBalance = acc.points_balance + stored;
  if (newBalance < 0) throw new HttpError(400, 'INSUFFICIENT_POINTS', `امتیاز کافی نیست (موجودی: ${acc.points_balance}).`);
  const newEarned = acc.points_earned + (type === 'earn' ? points : 0);
  const txId = d.transaction(() => {
    d.prepare('UPDATE loyalty_accounts SET points_balance=?, points_earned=? WHERE customer_id=?').run(newBalance, newEarned, customerId);
    applyTier(d, customerId);
    const note = b.note || (type === 'earn' ? 'اعتماد امتیاز دستی' : type === 'redeem' ? 'استفاده از امتیاز' : 'اصلاح امتیاز');
    const info = d.prepare('INSERT INTO loyalty_transactions(customer_id, type, points, ref_type, ref_id, note, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(customerId, type, stored, b.ref_type || '', Number(b.ref_id) || 0, note, nowIso());
    return Number(info.lastInsertRowid);
  })();
  audit(user, 'loyalty_transaction', txId, type, { before: acc.points_balance }, { after: newBalance, points: stored, note: b.note || '' });
  return { id: txId, balance: newBalance };
}
function deleteTransaction(user, txId) {
  requirePerm(user, 'loyalty_transaction', 'delete');
  const d = get();
  const t = d.prepare('SELECT * FROM loyalty_transactions WHERE id=?').get(Number(txId));
  if (!t) throw new HttpError(404, 'NOT_FOUND', 'تراکنش پیدا نشد.');
  d.transaction(() => {
    const acc = d.prepare('SELECT * FROM loyalty_accounts WHERE customer_id=?').get(t.customer_id);
    if (acc) {
      // reverse the signed delta; earned points only revert for earn rows
      d.prepare('UPDATE loyalty_accounts SET points_balance=points_balance-?, points_earned=CASE WHEN ? THEN points_earned-? ELSE points_earned END WHERE customer_id=?')
        .run(t.points, t.type === 'earn' ? 1 : 0, t.type === 'earn' ? t.points : 0, t.customer_id);
      applyTier(d, t.customer_id);
    }
    d.prepare('DELETE FROM loyalty_transactions WHERE id=?').run(t.id);
  })();
  audit(user, 'loyalty_transaction', t.id, 'delete', t, null);
  return { ok: true };
}
// ---------------- rules ----------------
function rulesInfo() {
  const d = get();
  const tiers = d.prepare('SELECT * FROM loyalty_tiers ORDER BY min_points').all();
  const rate = earnRate();
  return { earn_rate: rate, points_per_million: rate, enabled: rate > 0, on: 'full_payment', note: 'امتیازدهی هنگام پرداخت کامل فاکتور؛ سطح عضو بر اساس امتیاز کل کسب‌شده به‌صورت خودکار به‌روزرسانی می‌شود', tiers };
}
// ---------------- export (XLSX / CSV / JSON / HTML-printable) ----------------
const TX_FA = { earn: 'اعتماد', redeem: 'استفاده', adjust: 'اصلاح' };
function renderLoyalty(format, title, fileNameBase, headers, rows) {
  const aoa = [headers, ...rows];
  if (format === 'csv') {
    const csv = '\uFEFF' + aoa.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    return { type: 'csv', data: Buffer.from(csv, 'utf8'), mime: 'text/csv; charset=utf-8', fileName: fileNameBase + '.csv' };
  }
  if (format === 'json') {
    const obj = { source: title, generated_at: nowIso(), note: 'تاریخ‌ها شمسی (رقم انگلیسی) — داده از دیتابیس واقعی', rows: rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))) };
    return { type: 'json', data: Buffer.from(JSON.stringify(obj, null, 2), 'utf8'), mime: 'application/json; charset=utf-8', fileName: fileNameBase + '.json' };
  }
  if (format === 'html') {
    const printMod = require('../../lib/print');
    const co = printMod.company();
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rowsHtml = rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
    const body = printMod.companyHeadHtml(co) + `<h1>${esc(title)}</h1>
      <div class="meta"><div><b>تاریخ خروجی:</b><span>${esc(fmtDate(nowIso(), { time: true, fa: true }))}</span></div><div><b>تعداد ردیف:</b><span>${esc(String(rows.length))}</span></div></div>
      <table class="items"><thead><tr>${headers.map(h => '<th>' + esc(h) + '</th>').join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>
      <div class="footer"><div class="sign"><div class="line"></div>تهیه‌کننده</div><div class="sign"><div class="line"></div>تأیید مدیریت</div></div>`;
    return { type: 'html', data: Buffer.from(printMod.baseHtml(title, body, co), 'utf8'), mime: 'text/html; charset=utf-8', fileName: fileNameBase + '.html', disposition: 'inline' };
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 28));
  return { type: 'xlsx', data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: fileNameBase + '.xlsx' };
}
function exportAccounts(user, q, format) {
  requirePerm(user, 'loyalty_account', 'export');
  const d = get();
  const where = ['1=1'], params = [];
  if (q) { const term = '%' + likeEscape(String(q)) + '%'; where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.mobile LIKE ? OR lt.name LIKE ?)'); params.push(term, term, term, term); }
  const rows = d.prepare(`SELECT la.*, c.name AS customer_name, c.mobile AS customer_mobile, lt.name AS tier_name, lt.discount_pct
    FROM loyalty_accounts la LEFT JOIN customers c ON c.id=la.customer_id LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id
    WHERE ${where.join(' AND ')} ORDER BY la.points_balance DESC LIMIT 10000`).all(...params);
  const headers = ['مشتری', 'موبایل', 'سطح فعلی', 'موجودی امتیاز', 'امتیاز کل', 'تخفیف ٪'];
  const out = rows.map(r => [r.customer_name, r.customer_mobile || '', r.tier_name || '—', r.points_balance, r.points_earned, r.discount_pct || 0]);
  const res = renderLoyalty(format, 'اعضای باشگاه مشتریان', 'loyalty-accounts-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), headers, out);
  res.count = rows.length;
  return res;
}
function exportTransactions(user, q, format) {
  requirePerm(user, 'loyalty_transaction', 'export');
  const d = get();
  const where = ['1=1'], params = [];
  if (q) { const term = '%' + likeEscape(String(q)) + '%'; where.push('(c.name LIKE ? OR t.note LIKE ?)'); params.push(term, term); }
  const rows = d.prepare(`SELECT t.*, c.name AS customer_name, lt.name AS tier_name FROM loyalty_transactions t
    LEFT JOIN customers c ON c.id=t.customer_id
    LEFT JOIN loyalty_tiers lt ON lt.id=(SELECT tier_id FROM loyalty_accounts WHERE customer_id=t.customer_id)
    WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 10000`).all(...params);
  const headers = ['مشتری', 'نوع', 'امتیاز', 'سطح', 'مستند', 'توضیح', 'تاریخ (شمسی)'];
  const out = rows.map(r => [r.customer_name, TX_FA[r.type] || r.type, r.points, r.tier_name || '—', r.ref_type ? (r.ref_type + (r.ref_id ? ' #' + r.ref_id : '')) : '—', r.note || '', fmtDate(r.created_at, { time: true, fa: false })]);
  const res = renderLoyalty(format, 'تراکنش‌های باشگاه مشتریان', 'loyalty-transactions-' + (q ? 'search-' : 'all-') + nowIso().slice(0, 10), headers, out);
  res.count = rows.length;
  return res;
}
module.exports = {
  TX_TYPES, earnRate, setEarnRate, rulesInfo,
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  listTransactions, addTransaction, deleteTransaction,
  exportAccounts, exportTransactions, applyTier,
};
