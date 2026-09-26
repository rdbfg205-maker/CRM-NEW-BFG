'use strict';
// ============ Price Override + Audit (Proforma/Quote lines) ============
// The client-submitted price is a REQUEST, never a trusted value. On every quote
// line save the backend re-resolves the base price from the Price List (customer /
// product / payment stage / list validity) and decides the final unit price:
//   - no override:  Final = Base (price list price)
//   - override:     Final = client price — allowed ONLY when the user holds the
//                   `price_override` permission AND supplies a reason.
// Every REAL price change (final price differs from the previously stored line
// price) is written to the immutable audit log (PRICE_OVERRIDE / PRICE_RESTORE).
// The Price List itself is never modified by an override.
const { get, addActivity } = require('../db/db');
const { requirePerm } = require('../auth/auth');
const { audit } = require('../core/audit');
const { nowIso, parseId, toEnDigits } = require('../lib/util');
const { HttpError } = require('../lib/http');

const STAGES = ['cash', '3_month', '6_month', 'custom'];
const EPS = 0.01; // float tolerance for price comparison (IRR)

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(toEnDigits(String(v)).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const normStage = (s) => (STAGES.includes(s) ? s : 'cash');

// ---------- Authoritative base price resolution (server-side) ----------
// Priority:
//   1) the quote's price list (or the default / latest active list)
//        a) customer-specific item, exact stage
//        b) customer-specific item, 'cash' (only if another stage requested)
//        c) general item (any customer), exact stage
//        d) general item, 'cash' (only if another stage requested)
//   2) product base price (retail → wholesale → export → cost)
// Returns { base_price, source, price_list_id, price_list_name, stage }
// (base_price may be null when no authoritative price exists).
function resolveBasePrice({ product_id, customer_id, price_list_id, payment_stage }) {
  const d = get();
  const stage = normStage(payment_stage);
  const p = d.prepare('SELECT * FROM products WHERE id=?').get(product_id);
  if (!p) return { base_price: null, source: null, price_list_id: null, price_list_name: null, stage };
  const today = nowIso().slice(0, 10);
  const inRange = (v) => (!v.valid_from || v.valid_from <= today) && (!v.valid_until || v.valid_until >= today);
  let list = null;
  if (price_list_id) list = d.prepare('SELECT * FROM price_lists WHERE id=?').get(price_list_id) || null;
  if (!list) {
    list = d.prepare('SELECT * FROM price_lists WHERE is_default=1 AND active=1').get()
      || d.prepare('SELECT * FROM price_lists WHERE active=1 ORDER BY id DESC').get()
      || null;
  }
  if (list && inRange(list)) {
    const item = (cust, st) => cust
      ? d.prepare('SELECT * FROM price_list_items WHERE price_list_id=? AND product_id=? AND customer_id=? AND COALESCE(payment_stage,\'cash\')=?').get(list.id, product_id, cust, st)
      : d.prepare('SELECT * FROM price_list_items WHERE price_list_id=? AND product_id=? AND (customer_id IS NULL OR customer_id=0) AND COALESCE(payment_stage,\'cash\')=?').get(list.id, product_id, st);
    let it = null;
    if (customer_id) it = item(customer_id, stage);
    if (!it && stage !== 'cash' && customer_id) it = item(customer_id, 'cash');
    if (!it) it = item(null, stage);
    if (!it && stage !== 'cash') it = item(null, 'cash');
    if (it && it.price > 0) {
      const itIn = (!it.valid_from || it.valid_from <= today) && (!it.valid_until || it.valid_until >= today);
      if (itIn) {
        return { base_price: it.price, source: it.customer_id ? 'customer_price' : 'price_list', price_list_id: list.id, price_list_name: list.name, stage };
      }
    }
  }
  const base = p.price_retail || p.price_wholesale || p.price_export || p.price_cost || 0;
  return { base_price: base > 0 ? base : null, source: 'product_base', price_list_id: list ? list.id : null, price_list_name: list ? list.name : null, stage };
}

// ---------- Quote lines save (full replace, price-enforced) ----------
// user: authenticated user · ipAddr: client IP for the audit trail
// items: array of line payloads from PUT /api/r/quote/:id/items
function saveQuoteItems(user, ipAddr, quoteId, items) {
  const d = get();
  const quote = d.prepare('SELECT * FROM quotes WHERE id=?').get(quoteId);
  if (!quote) throw new HttpError(404, 'NOT_FOUND', 'پیش‌فاکتور پیدا نشد.');
  if (!Array.isArray(items)) items = [];
  // previous state for REAL-change detection. Matched by line id first, but a
  // client-provided id is a HINT, not authority: it is matched second by
  // (product_id, payment_stage) so stale/missing/forged ids cannot smuggle an
  // unpermitted price change (e.g. re-adding an overridden line at base price as
  // a "new" line to drop the override without permission or an audit trail).
  const prev = new Map();
  const prevByProduct = new Map();
  for (const row of d.prepare('SELECT * FROM quote_items WHERE quote_id=?').all(quoteId)) {
    prev.set(row.id, row);
    if (row.product_id) {
      const k = row.product_id + ':' + normStage(row.payment_stage);
      if (!prevByProduct.has(k)) prevByProduct.set(k, row);
    }
  }
  const prodById = new Map();
  const pids = [...new Set(items.map(i => parseId(i && i.product_id)).filter(Boolean))];
  if (pids.length) for (const p of d.prepare(`SELECT id, code FROM products WHERE id IN (${pids.map(() => '?').join(',')})`).all(...pids)) prodById.set(p.id, p);

  // ---- pass 1: resolve + enforce (no writes) — any violation aborts the whole save ----
  const plan = [];
  for (const it of items) {
    if (!it || !it.name || !String(it.name).trim()) continue;
    const name = String(it.name).trim();
    const qty = Number(toEnDigits(String(it.qty || '0'))) || 0;
    const disc = Number(toEnDigits(String(it.discount_pct || '0'))) || 0;
    const tax = (it.tax_rate === undefined || it.tax_rate === null || it.tax_rate === '') ? null
      : (Number(toEnDigits(String(it.tax_rate))) || 0);
    const pid = parseId(it.product_id);
    const entry = { it, name, qty, disc, tax, pid, base: null, stage: 'cash', final: 0, status: 0, reason: null, changed: false, prevFinal: null, prevReason: null, code: null };
    if (pid) {
      const prod = prodById.get(pid);
      if (!prod) throw new HttpError(422, 'VALIDATION', 'کالای انتخاب‌شده معتبر نیست.');
      entry.code = prod.code || null;
      entry.stage = normStage(it.payment_stage);
      const res = resolveBasePrice({ product_id: pid, customer_id: quote.customer_id || null, price_list_id: quote.price_list_id || null, payment_stage: entry.stage });
      entry.base = res.base_price;
      // client price is a request: prefer explicit override_price, else price;
      // absent/invalid/<=0 falls back to the authoritative base.
      const reqPrice = num(it.override_price) !== null ? num(it.override_price) : num(it.price);
      entry.final = (reqPrice !== null && reqPrice > 0) ? reqPrice : (entry.base !== null ? entry.base : 0);
      const prevRow = (parseId(it.id) ? prev.get(parseId(it.id)) : null) || prevByProduct.get(pid + ':' + entry.stage) || null;
      entry.prevFinal = prevRow ? (prevRow.price || 0) : null;
      entry.prevReason = prevRow ? (prevRow.override_reason || null) : null;
      const priceChanged = entry.prevFinal === null || Math.abs(entry.final - entry.prevFinal) > EPS;
      if (entry.base !== null && Math.abs(entry.final - entry.base) <= EPS) {
        // aligned with base → not an override
        entry.status = 0; entry.reason = null;
        // restoring a previous override back to base is still a REAL price change
        entry.changed = priceChanged && entry.prevFinal !== null;
        if (entry.changed) {
          requirePerm(user, 'price_override', 'edit');
          const reason = String(it.override_reason || '').trim();
          if (!reason) throw new HttpError(422, 'VALIDATION', 'دلیل تغییر قیمت (Override Reason) الزامی است.');
          if (reason.length > 500) throw new HttpError(422, 'VALIDATION', 'دلیل تغییر قیمت بیش از حد مجاز است.');
          entry.reason = reason; // kept for the audit entry (column stays NULL)
        }
      } else if (entry.base === null) {
        // no authoritative base for this product → keep legacy free price (no override tracking)
        entry.status = 0; entry.reason = null;
        entry.changed = false;
        entry.noBase = true;
      } else {
        entry.status = 1;
        entry.changed = priceChanged;
        if (priceChanged) {
          // any REAL price change away from the base requires the permission + reason
          requirePerm(user, 'price_override', 'edit');
          const reason = String(it.override_reason || '').trim();
          if (!reason) throw new HttpError(422, 'VALIDATION', 'دلیل تغییر قیمت (Override Reason) الزامی است.');
          if (reason.length > 500) throw new HttpError(422, 'VALIDATION', 'دلیل تغییر قیمت بیش از حد مجاز است.');
          entry.reason = reason;
        } else {
          // re-saving an existing unchanged override (e.g. only qty edited) — allowed
          // for any user who may edit the quote; the original reason is preserved.
          entry.reason = entry.prevReason || 'Override قبلی (بدون تغییر)';
        }
      }
    } else {
      // free-text line without a product: no authoritative base exists (legacy behavior)
      entry.final = num(it.price) || 0;
      entry.noBase = true;
      entry.changed = false; // never audited as price override
    }
    plan.push(entry);
  }

  // ---- pass 2: write (transactional) + audit only on REAL changes ----
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM quote_items WHERE quote_id=?').run(quoteId);
    const ins = d.prepare(`INSERT INTO quote_items(quote_id, product_id, name, qty, price, discount_pct, line_total, tax_rate, base_price, override_status, override_reason, payment_stage, product_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let n = 0, overrides = 0;
    for (const e of plan) {
      const baseCol = e.base !== null ? e.base : 0;
      // the column keeps the reason only while the line IS an override;
      // a restore (status 0) stores NULL — the reason still goes into the audit.
      const reasonCol = e.status === 1 ? e.reason : null;
      ins.run(quoteId, e.pid, e.name, e.qty, e.final, e.disc, 0, e.tax, baseCol, e.status, reasonCol, e.stage, e.code);
      if (e.changed && e.pid) {
        overrides++;
        const action = e.status === 1 ? 'PRICE_OVERRIDE' : 'PRICE_RESTORE';
        const oldPrice = e.prevFinal !== null ? e.prevFinal : baseCol;
        audit(user, 'quote', quoteId, action,
          { price: oldPrice, base_price: baseCol },
          {
            price: e.final, base_price: baseCol,
            difference: e.prevFinal !== null ? e.final - e.prevFinal : (baseCol ? e.final - baseCol : e.final),
            difference_from_base: baseCol ? e.final - baseCol : e.final,
            product_id: e.pid, product_code: e.code,
            customer_id: quote.customer_id || null,
            document_type: 'quote', document_id: quoteId, document_number: quote.number,
            payment_stage: e.stage,
            reason: e.reason,
            user_id: user.id, user_name: user.full_name,
          },
          ipAddr || '');
      }
      n++;
    }
    return { n, overrides };
  });
  const { n, overrides } = tx();
  // totals based on FINAL unit price (qty × final price → discount → tax) — existing logic
  require('../api/custom/sales').recalcDoc('quote_items', quoteId, false);
  addActivity('quote', quoteId, user.id, 'items', `ردیف‌ها به‌روزرسانی شد (${n} ردیف${overrides ? '، ' + overrides + ' تغییر قیمت' : ''})`);
  audit(user, 'quote', quoteId, 'items_update', null, { count: n, overrides });
  return { ok: true, saved: n, overrides };
}

module.exports = { resolveBasePrice, saveQuoteItems, STAGES };
