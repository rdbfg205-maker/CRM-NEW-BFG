'use strict';
const { get } = require('../../db/db');
const { requirePerm } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { notify } = require('../../core/notify');
const { dispatch } = require('../../core/workflow');
const { addActivity } = require('../../db/db');
const { nowIso, fmtNum, faDigits } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const generic = require('../generic');

function recalcDoc(table, id, taxCol) {
  const d = get();
  const items = d.prepare(`SELECT * FROM ${table} WHERE ${table === 'quote_items' ? 'quote_id' : table === 'order_items' ? 'order_id' : 'invoice_id'}=?`).all(id);
  let subtotal = 0, tax = 0;
  for (const it of items) {
    const lt = (it.qty * it.price) * (1 - (it.discount_pct || 0) / 100);
    d.prepare(`UPDATE ${table} SET line_total=? WHERE id=?`).run(lt, it.id);
    subtotal += lt;
    if (taxCol) tax += lt * ((it.tax_rate || 0) / 100);
  }
  const doc = d.prepare(`SELECT * FROM ${table === 'quote_items' ? 'quotes' : table === 'order_items' ? 'orders' : 'invoices'} WHERE id=?`).get(id);
  if (table === 'quote_items') {
    const disc = subtotal * ((doc.discount_pct || 0) / 100);
    const base = subtotal - disc;
    // per-line tax_rate (fallback: document tax_rate); if all lines explicit (even 0), use per-line sum
    let taxAmt;
    if (items.every(it => it.tax_rate === null || it.tax_rate === undefined)) {
      taxAmt = base * ((doc.tax_rate || 0) / 100);
    } else {
      let lt2 = 0;
      for (const it of items) {
        const v = (it.qty * it.price) * (1 - (it.discount_pct || 0) / 100);
        const tr = (it.tax_rate !== null && it.tax_rate !== undefined) ? Number(it.tax_rate) : (doc.tax_rate || 0);
        lt2 += v * (tr / 100);
      }
      taxAmt = lt2;
    }
    const total = base + taxAmt + (doc.shipping || 0);
    d.prepare('UPDATE quotes SET subtotal=?, total=? WHERE id=?').run(subtotal, total, id);
  } else if (table === 'order_items') {
    d.prepare('UPDATE orders SET total=? WHERE id=?').run(subtotal, id);
  } else {
    const total = subtotal - (doc.discount || 0) + tax + (doc.shipping || 0);
    d.prepare('UPDATE invoices SET subtotal=?, tax=?, total=? WHERE id=?').run(subtotal, tax, total, id);
  }
  return subtotal;
}
// ---------------- Pipeline board ----------------
function board(pipelineId, user) {
  requirePerm(user, 'opportunity', 'view');
  const d = get();
  const stages = d.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id=? ORDER BY position').all(pipelineId || 0);
  const scope = requirePerm(user, 'opportunity', 'view');
  const sc = scopeWhereFor(user);
  const opps = d.prepare(`SELECT o.id, o.number, o.title, o.amount, o.probability, o.stage_id, o.customer_id, o.salesperson_id, o.created_at, o.updated_at, o.next_followup_at, c.name customer_name, u.full_name salesperson_name FROM opportunities o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.salesperson_id WHERE o.archived_at IS NULL ${sc.sql} ${pipelineId ? 'AND o.pipeline_id=?' : ''} ORDER BY o.id DESC`).all(...sc.params, ...(pipelineId ? [pipelineId] : []));
  const byStage = {};
  for (const s of stages) byStage[s.id] = { stage: s, items: [] };
  const none = { stage: { id: 0, name: 'بدون مرحله' }, items: [] };
  for (const o of opps) (byStage[o.stage_id] || none).items.push(o);
  return { stages: [...Object.values(byStage), none].filter(x => x.items.length || x.stage.id !== 0), total: opps.length };
}
function scopeWhereFor(user) {
  const { hasPerm, scopeWhere } = require('../../auth/auth');
  const p = hasPerm(user, 'opportunity', 'view');
  const sc = scopeWhere('opportunity', user, p.scope, 'salesperson_id');
  return { sql: sc.where ? 'AND ' + sc.where : '', params: sc.params };
}
function moveOpp(user, opportunityId, stageId) {
  const d = get();
  requirePerm(user, 'opportunity', 'edit');
  const opp = d.prepare('SELECT * FROM opportunities WHERE id=?').get(opportunityId);
  if (!opp) throw new HttpError(404, 'NOT_FOUND', 'فرصت فروش پیدا نشد.');
  const stage = d.prepare('SELECT * FROM pipeline_stages WHERE id=?').get(stageId);
  if (!stage) throw new HttpError(404, 'NOT_FOUND', 'مرحله پیدا نشد.');
  d.prepare('UPDATE opportunities SET stage_id=?, updated_at=?, updated_by=? WHERE id=?').run(stageId, nowIso(), user.id, opportunityId);
  addActivity('opportunity', opportunityId, user.id, 'stage', `به مرحله «${stage.name}» منتقل شد`);
  audit(user, 'opportunity', opportunityId, 'stage_move', { stage: opp.stage_id }, { stage: stageId });
  if (stage.is_won && opp.status !== 'won') {
    d.prepare("UPDATE opportunities SET status='won', won_at=? WHERE id=?").run(nowIso(), opportunityId);
    dispatch('opportunity_won', 'opportunity', opportunityId, opp);
    notifyRoles(['sales_manager', 'ceo', 'super_admin'], 'opportunity', 'فرصت فروش موفق شد', `«${opp.title}» با مبلغ ${fmtNum(opp.amount)} ریال بسته شد.`, 'opportunity', opportunityId, [], user.id);
    // AI: probability update
    try { require('../../ai/engine'); } catch {}
  }
  if (stage.is_lost && opp.status !== 'lost') {
    d.prepare("UPDATE opportunities SET status='lost' WHERE id=?").run(opportunityId);
    addActivity('opportunity', opportunityId, user.id, 'lost', 'فرصت ناموفق شد');
  }
  return { ok: true, stage: stage.name, won: !!stage.is_won, lost: !!stage.is_lost };
}
function notifyRoles(roles, type, title, body, refType, refId) {
  require('../../core/notify').notifyRoles(roles, type, title, body, refType, refId);
}
// ---------------- Conversions ----------------
function quoteToOrder(user, quoteId) {
  const d = get();
  requirePerm(user, 'order', 'create');
  const q = d.prepare('SELECT * FROM quotes WHERE id=?').get(quoteId);
  if (!q) throw new HttpError(404, 'NOT_FOUND', 'پیش‌فاکتور پیدا نشد.');
  if (q.status === 'converted') throw new HttpError(400, 'BAD_STATE', 'این پیش‌فاکتور قبلاً به سفارش تبدیل شده است.');
  const tx = d.transaction(() => {
    const items = d.prepare('SELECT * FROM quote_items WHERE quote_id=?').all(quoteId);
    // order carries the pre-tax line sum (tax is applied at invoicing)
    const info = d.prepare('INSERT INTO orders(number, customer_id, salesperson_id, quote_id, status, order_date, total, notes, created_by, created_at, updated_by, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)')
      .run(nextNo('OD', 'orders'), q.customer_id, q.salesperson_id, quoteId, 'confirmed', nowIso(), q.subtotal || q.total, 'تبدیل‌شده از پیش‌فاکتور ' + q.number, user.id, nowIso(), user.id, nowIso());
    const oid = Number(info.lastInsertRowid);
    const ins = d.prepare('INSERT INTO order_items(order_id, product_id, name, qty, price, discount_pct, tax_rate, line_total) VALUES(?,?,?,?,?,?,?,?)');
    for (const it of items) ins.run(oid, it.product_id, it.name, it.qty, it.price, it.discount_pct, it.tax_rate !== undefined ? it.tax_rate : null, it.line_total);
    d.prepare("UPDATE quotes SET status='converted', order_id=? WHERE id=?").run(oid, quoteId);
    addActivity('order', oid, user.id, 'create', `از پیش‌فاکتور ${q.number} ایجاد شد`);
    addActivity('quote', quoteId, user.id, 'convert', 'به سفارش تبدیل شد');
    dispatch('order_created', 'order', oid, { customer_id: q.customer_id, total: q.total });
    requireNotify(q.customer_id, 'order', 'سفارش شما ثبت شد', `سفارش از پیش‌فاکتور ${q.number} با مبلغ ${fmtNum(q.total)} ریال ثبت شد.`, 'order', oid);
    // Section 2: role notification (salesperson already notified above — no duplicate)
    try { require('../notifications').notifyDocRoles(user, 'orders', oid); } catch { /* best-effort */ }
    audit(user, 'order', oid, 'create_from_quote', null, { quote: quoteId });
    return oid;
  });
  const oid = tx();
  return { ok: true, order_id: oid };
}
function orderToInvoice(user, orderId) {
  const d = get();
  requirePerm(user, 'invoice', 'create');
  const o = d.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'سفارش پیدا نشد.');
  const existing = d.prepare('SELECT id FROM invoices WHERE order_id=?').get(orderId);
  if (existing) throw new HttpError(400, 'BAD_STATE', 'برای این سفارش قبلاً فاکتور صادر شده است.');
  const taxRate = Number(get().prepare('SELECT value FROM settings WHERE key=?').get('tax_rate')?.value || 9) / 100;
  const taxRateNum = Number((JSON.parse(getSettingSafe('tax_rate', '9')) || 9));
  const tx = d.transaction(() => {
    const items = d.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
    const invNumber = nextNo('INV', 'invoices');
    const info = d.prepare('INSERT INTO invoices(number, order_id, customer_id, issue_date, subtotal, total, paid_amount, status, created_by, created_at, updated_by, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)')
      .run(invNumber, orderId, o.customer_id, nowIso(), 0, o.total, 0, 'unpaid', user.id, nowIso(), user.id, nowIso());
    const invId = Number(info.lastInsertRowid);
    const ins = d.prepare('INSERT INTO invoice_items(invoice_id, product_id, name, qty, price, discount_pct, tax_rate, line_total) VALUES(?,?,?,?,?,?,?,?)');
    let subtotal = 0, tax = 0;
    for (const it of items) {
      const lt = it.line_total || (it.qty * it.price * (1 - (it.discount_pct || 0) / 100));
      // per-line tax_rate (carried from quote/order); fallback: system tax rate
      const tr = it.tax_rate !== null && it.tax_rate !== undefined ? Number(it.tax_rate) : taxRateNum;
      const taxAmt = lt * (tr / 100);
      subtotal += lt; tax += taxAmt;
      ins.run(invId, it.product_id, it.name, it.qty, it.price, it.discount_pct, tr, lt);
    }
    const total = subtotal + tax;
    d.prepare('UPDATE invoices SET subtotal=?, tax=?, total=?, due_date=? WHERE id=?').run(subtotal, tax, total, addDays(30), invId);
    // Section 8: stock out for warehouse-tracked items only (items with on-hand stock
    // or a reorder point). Never blocks invoicing; shortages surface via stock alerts.
    for (const it of items) {
      if (!it.product_id) continue;
      const p = d.prepare('SELECT id, stock_qty, reorder_point, name, unit FROM products WHERE id=?').get(it.product_id);
      if (!p || !(p.stock_qty > 0 || p.reorder_point > 0)) continue;
      generic.recordStockTx(p.id, 'out', -Math.abs(it.qty || 0), `خروج فاکتور ${invNumber} (از سفارش ${o.number})`, user.id, 'invoice', invId);
    }
    addActivity('invoice', invId, user.id, 'create', `از سفارش ${o.number} ایجاد شد`);
    audit(user, 'invoice', invId, 'create_from_order', null, { order: orderId });
    dispatch('invoice_created', 'invoice', invId, { customer_id: o.customer_id, total });
    requireNotify(o.customer_id, 'invoice', 'فاکتور صادر شد', `فاکتور ${''} به مبلغ ${fmtNum(total)} ریال صادر شد.`, 'invoice', invId);
    // Section 2: role notification (salesperson already notified above — no duplicate)
    try { require('../notifications').notifyDocRoles(user, 'invoices', invId); } catch { /* best-effort */ }
    return invId;
  });
  const invId = tx();
  // Section 5: auto customer message on invoice creation (if enabled in settings)
  try { require('./customermsg').autoSendForEvent('invoice', invId, user); } catch (e) { console.error('customermsg invoice', e.message); }
  return { ok: true, invoice_id: invId };
}
function getSettingSafe(key, def) {
  try { const v = get().prepare('SELECT value FROM settings WHERE key=?').get(key); return v ? v.value : def; } catch { return def; }
}
function requireNotify(customerId, type, title, body, refType, refId) {
  const sp = get().prepare('SELECT salesperson_id FROM customers WHERE id=?').get(customerId);
  if (sp && sp.salesperson_id) notify(sp.salesperson_id, type, title, body, refType, refId);
}
function nextNo(prefix, table) {
  return require('../../db/db').nextNumber(prefix, table);
}
function addDays(n) { return new Date(Date.now() + n * 864e5).toISOString(); }
// ---------------- Payments ----------------
function addPayment(user, data) {
  requirePerm(user, 'payment', 'create');
  const d = get();
  const amount = Number(data.amount);
  if (!amount || amount <= 0) throw new HttpError(422, 'VALIDATION', 'مبلغ پرداخت باید بزرگ‌تر از صفر باشد.');
    const customerId = Number(data.customer_id);
    if (!customerId || !d.prepare('SELECT id FROM customers WHERE id=? AND (archived_at IS NULL OR archived_at IS NOT NULL)').get(customerId)) throw new HttpError(422, 'VALIDATION', 'مشتری نامعتبر است.');
    const inv = data.invoice_id ? d.prepare('SELECT * FROM invoices WHERE id=?').get(Number(data.invoice_id)) : null;
    if (data.invoice_id && !inv) throw new HttpError(404, 'NOT_FOUND', 'فاکتور پیدا نشد.');
    if (inv && inv.status === 'cancelled') throw new HttpError(400, 'BAD_STATE', 'این فاکتور لغو شده است.');
    if (inv && inv.customer_id !== customerId) throw new HttpError(422, 'VALIDATION', 'فاکتور متعلق به این مشتری نیست.');
    if (inv && (inv.paid_amount || 0) + amount > inv.total + 0.5) throw new HttpError(422, 'OVERPAYMENT', `مبلغ پرداخت (${fmtNum(amount)}) از مانده فاکتور (${fmtNum(inv.total - (inv.paid_amount || 0))}) بیشتر است.`);
    const status = data.status || 'paid';
    if (!['pending', 'paid', 'failed', 'cancelled', 'refunded'].includes(status)) throw new HttpError(422, 'VALIDATION', 'وضعیت پرداخت نامعتبر است.');
    const tx = d.transaction(() => {
      const info = d.prepare('INSERT INTO payments(number, invoice_id, customer_id, amount, method, reference, check_info, paid_at, notes, received_by, bank, account, status, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(nextNo('PAY', 'payments'), inv ? inv.id : 0, customerId, amount, data.method || 'bank', data.reference || '', data.check_info || '', data.paid_at || nowIso(), data.notes || '', user.id, data.bank || '', data.account || '', status, nowIso());
      const payId = Number(info.lastInsertRowid);
    if (inv && status === 'paid') {
      const paid = (inv.paid_amount || 0) + amount;
      const invStatus = paid >= inv.total - 0.5 ? 'paid' : 'partial';
      d.prepare('UPDATE invoices SET paid_amount=?, status=?, updated_at=? WHERE id=?').run(paid, invStatus, nowIso(), inv.id);
      addActivity('invoice', inv.id, user.id, 'payment', `پرداخت ${fmtNum(amount)} ریال ثبت شد`);
      if (invStatus === 'paid') {
        // loyalty points (on full payment)
        const earnRate = Math.max(0, Number(JSON.parse(getSettingSafe('loyalty_earn_rate', '0'))));
        if (earnRate > 0) {
          d.prepare('INSERT OR IGNORE INTO loyalty_accounts(customer_id) VALUES(?)').run(customerId);
          // Section 9: configurable earn rate — points per 1,000,000 rial (setting '1' = legacy behavior)
          const pts = Math.floor(inv.total / 1000000 * earnRate);
          if (pts > 0) {
            d.prepare('UPDATE loyalty_accounts SET points_balance=points_balance+?, points_earned=points_earned+? WHERE customer_id=?').run(pts, pts, customerId);
            d.prepare('INSERT INTO loyalty_transactions(customer_id, type, points, ref_type, ref_id, note, created_at) VALUES(?,?,?,?,?,?,?)')
              .run(customerId, 'earn', pts, 'invoice', inv.id, `امتیاز باشگاه مشتریان از فاکتور ${inv.number}`, nowIso());
          }
          updateTier(customerId);
        }
        notify(user.id, 'payment', 'فاکتور کامل پرداخت شد', `فاکتور ${inv.number} — ${fmtNum(inv.total)} ریال`, 'invoice', inv.id, user.id);
      }
      // credit_used update
      const cust = d.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
      if (cust) {
        const open = d.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial','overdue')`).get(customerId).s;
        d.prepare('UPDATE customers SET credit_used=? WHERE id=?').run(open, customerId);
        if (cust.credit_limit > 0 && open > cust.credit_limit) {
          d.prepare("UPDATE customers SET credit_status='متوقف' WHERE id=?").run(customerId);
          notifyRoles(['finance_manager', 'ceo', 'super_admin'], 'credit', 'اعتبار مشتری تمام شد', `مطالبات «${cust.name}» از سقف اعتبار عبور کرد.`, 'customer', customerId);
        }
      }
    }
    audit(user, 'payment', payId, 'create', null, { amount, invoice: inv ? inv.id : 0 });
    addActivity('customer', customerId, user.id, 'payment', `پرداخت ${fmtNum(amount)} ریال`);
    return payId;
  });
  const id = tx();
  // Section 5: auto customer message on payment registration (if enabled in settings)
  try { require('./customermsg').autoSendForEvent('payment', id, user); } catch (e) { console.error('customermsg payment', e.message); }
  // real-event feed for the Workflow Visual Engine
  try { dispatch('payment_created', 'payment', id, { customer_id: customerId, amount, invoice_id: inv ? inv.id : 0, status: 'paid' }); } catch { /* best-effort */ }
  // Section 2: real payment notification (salesperson + finance role)
  try { require('../notifications').notifyDoc(user, 'payments', id); } catch { /* best-effort */ }
  return { ok: true, payment_id: id };
}
// refund a payment: reverses the invoice reconciliation
function refundPayment(user, payId) {
  requirePerm(user, 'payment', 'edit');
  const d = get();
  const p = d.prepare('SELECT * FROM payments WHERE id=?').get(payId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'پرداخت پیدا نشد.');
  if (p.status === 'refunded') throw new HttpError(400, 'BAD_STATE', 'این پرداخت قبلاً برگشت خورده است.');
  if (p.status !== 'paid' && p.status !== 'pending') throw new HttpError(400, 'BAD_STATE', 'فقط پرداخت‌های ثبت‌شده قابل برگشت هستند.');
  const inv = p.invoice_id ? d.prepare('SELECT * FROM invoices WHERE id=?').get(p.invoice_id) : null;
  const tx = d.transaction(() => {
    // NOTE: the `payments` table has no updated_at column (see 001_init.sql) — writing it
    // here used to throw SQLITE_ERROR and make every payment refund fail with HTTP 500.
    d.prepare("UPDATE payments SET status='refunded' WHERE id=?").run(payId);
    if (inv && p.status === 'paid') {
      const paid = Math.max(0, (inv.paid_amount || 0) - p.amount);
      const invStatus = paid <= 0.5 ? 'unpaid' : paid >= inv.total - 0.5 ? 'paid' : 'partial';
      d.prepare('UPDATE invoices SET paid_amount=?, status=?, updated_at=? WHERE id=?').run(paid, invStatus, nowIso(), inv.id);
    }
    // reverse credit_used
    const open = d.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial','overdue')`).get(p.customer_id).s;
    d.prepare('UPDATE customers SET credit_used=? WHERE id=?').run(open, p.customer_id);
    audit(user, 'payment', payId, 'refund', { status: p.status }, { status: 'refunded' });
    addActivity('payment', payId, user.id, 'refund', 'برگشت پرداخت: ' + fmtNum(p.amount) + ' ریال');
    notify(user.id, 'payment', 'برگشت پرداخت', `پرداخت ${p.number} (${fmtNum(p.amount)} ریال) برگشت خورد.`, 'payment', payId, user.id);
    return true;
  });
  tx();
  return { ok: true };
}
function updateTier(customerId) {
  const d = get();
  const tiers = d.prepare('SELECT * FROM loyalty_tiers ORDER BY min_points DESC').all();
  const acc = d.prepare('SELECT * FROM loyalty_accounts WHERE customer_id=?').get(customerId);
  if (!acc || !tiers.length) return;
  const tier = tiers.find(t => acc.points_balance >= t.min_points) || tiers[tiers.length - 1];
  if (acc.tier_id !== tier.id) {
    d.prepare('UPDATE loyalty_accounts SET tier_id=? WHERE customer_id=?').run(tier.id, customerId);
    requireNotify(customerId, 'loyalty', 'ارتقای سطح باشگاه مشتریان', `شما به سطح «${tier.name}» ارتقا یافتید.`, 'loyalty', customerId);
  }
}
// ---------------- Commissions (rule-based, per-invoice & per-payment, dedup-safe) ----------------
const BASIS_FA = { percent_sales: 'درصدی از مبلغ فروش', percent_collected: 'درصدی از مبلغ وصول‌شده', product: 'بر اساس محصول', customer: 'بر اساس مشتری', tier: 'پلکانی بر اساس مبلغ', margin: 'حاشیه سود' };
function activeRulesFor(d, rule) {
  const now = nowIso();
  if (!rule.active) return false;
  if (rule.valid_from && rule.valid_from > now) return false;
  if (rule.valid_until && rule.valid_until < now) return false;
  return true;
}
function calcCommissions(user, period) {
  requirePerm(user, 'commission', 'approve');
  const d = get();
  const { gregorianToJalaali, jalaaliToGregorian } = require('../../lib/jalali');
  const n = new Date();
  const [jy, jm] = gregorianToJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
  const per = period || `${jy}-${String(jm).padStart(2, '0')}`;
  const [py, pm] = per.split('-').map(Number);
  if (!Number.isFinite(py) || !Number.isFinite(pm) || pm < 1 || pm > 12) throw new HttpError(422, 'VALIDATION', 'دوره (شماره ماه شمسی) نامعتبر است. فرمت: 1405-06');
  const start = jalaaliToGregorian(py, pm, 1);
  const lastDay = pm < 12 ? jalaaliToGregorian(py, pm + 1, 1) : jalaaliToGregorian(py + 1, 1, 1);
  const from = new Date(start[0], start[1] - 1, start[2]).toISOString();
  const to = new Date(lastDay[0], lastDay[1] - 1, lastDay[2] + 1).toISOString();
  const rules = d.prepare('SELECT * FROM commission_rules WHERE active=1').all().filter(activeRulesFor.bind(null, d));
  if (!rules.length) throw new HttpError(422, 'NO_RULE', 'قانون پورسانت فعالی وجود ندارد. ابتدا قانون تعریف کنید.');
  const created = [];
  // resolve the salesperson from the document chain: order → quote → invoice creator
  const spOf = (inv) => {
    if (inv.order_id) { const o = d.prepare('SELECT salesperson_id, quote_id FROM orders WHERE id=?').get(inv.order_id); if (o && o.salesperson_id) return o.salesperson_id; if (o && o.quote_id) { const q = d.prepare('SELECT salesperson_id FROM quotes WHERE id=?').get(o.quote_id); if (q && q.salesperson_id) return q.salesperson_id; } }
    if (inv.quote_id) { const q = d.prepare('SELECT salesperson_id FROM quotes WHERE id=?').get(inv.quote_id); if (q && q.salesperson_id) return q.salesperson_id; }
    return inv.created_by || null;
  };
  const tx = d.transaction(() => {
    const ins = d.prepare('INSERT INTO commissions(user_id, period, rule_id, invoice_id, payment_id, customer_id, basis, rate, base, amount, status, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    const seenInv = (ruleId, invId) => invId && d.prepare('SELECT id FROM commissions WHERE rule_id=? AND invoice_id=?').get(ruleId, invId);
    const seenPay = (ruleId, payId) => payId && d.prepare('SELECT id FROM commissions WHERE rule_id=? AND payment_id=?').get(ruleId, payId);
    // ---- A) invoices issued in period (basis: percent_sales / customer / product / tier) ----
    const invoices = d.prepare(`SELECT i.*, c.province FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<?`).all(from, to);
    for (const inv of invoices) {
      const sp = spOf(inv); // salesperson (from order/quote chain)
      if (!sp) continue;
      const lines = d.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(inv.id);
      for (const rule of rules) {
        if (!activeRulesFor(d, rule)) continue;
        if (rule.basis_type === 'percent_collected') continue; // handled by payments
        if (rule.salesperson_id && rule.salesperson_id !== sp) continue;
        let base = 0, matched = false;
        if (rule.basis_type === 'product' && rule.product_id) {
          base = lines.filter(l => l.product_id === rule.product_id).reduce((a, l) => a + (l.line_total || 0), 0);
          matched = base > 0;
        } else if (rule.basis_type === 'customer' && rule.customer_id) {
          base = inv.customer_id === rule.customer_id ? (inv.total || 0) : 0;
          matched = base > 0;
        } else if (rule.basis_type === 'tier') {
          base = (inv.total || 0) >= (rule.min_amount || 0) && (rule.max_amount === null || rule.max_amount === undefined || (inv.total || 0) < (rule.max_amount)) ? (inv.total || 0) : 0;
          matched = base > 0;
        } else {
          // percent_sales / margin: whole invoice (optionally scoped by customer)
          if (rule.customer_id && inv.customer_id !== rule.customer_id) continue;
          if (rule.product_id) {
            base = lines.filter(l => l.product_id === rule.product_id).reduce((a, l) => a + (l.line_total || 0), 0);
          } else {
            base = inv.total || 0;
            if (rule.basis === 'margin') {
              const cost = lines.reduce((a, l) => { const p = d.prepare('SELECT price_cost FROM products WHERE id=?').get(l.product_id || 0); return a + (l.qty * (p ? p.price_cost || 0 : 0)); }, 0);
              base = Math.max(0, (inv.total || 0) - cost);
            }
          }
          matched = base > 0;
        }
        if (!matched) continue;
        if (seenInv(rule.id, inv.id)) continue; // dedup
        const amount = Math.round(base * (rule.pct || 0) / 100);
        if (!amount) continue;
        ins.run(sp, per, rule.id, inv.id, null, inv.customer_id, rule.basis_type === 'margin' ? 'margin' : (rule.basis_type || 'percent_sales'), rule.pct, Math.round(base), amount, 'calculated', nowIso());
        created.push({ rule: rule.name, invoice: inv.number, amount });
      }
    }
    // ---- B) payments collected in period (basis: percent_collected) ----
    const pays = d.prepare(`SELECT p.*, i.created_by sp, i.order_id i_order, i.quote_id i_quote, i.total inv_total, i.customer_id inv_cust FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.status='paid' AND p.invoice_id>0 AND p.paid_at>=? AND p.paid_at<?`).all(from, to);
    for (const pay of pays) {
      const sp = spOf({ order_id: pay.i_order, quote_id: pay.i_quote, created_by: pay.sp });
      if (!sp) continue;
      for (const rule of rules) {
        if (rule.basis_type !== 'percent_collected') continue;
        if (rule.salesperson_id && rule.salesperson_id !== sp) continue;
        if (rule.customer_id && pay.inv_cust !== rule.customer_id) continue;
        if (rule.product_id) {
          // collected portion attributable to the product lines of the invoice
          const lines = d.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(pay.invoice_id);
          const tot = lines.reduce((a, l) => a + (l.line_total || 0), 0);
          const share = tot > 0 ? lines.filter(l => l.product_id === rule.product_id).reduce((a, l) => a + (l.line_total || 0), 0) / tot : 0;
          if (share <= 0) continue;
          const base = Math.round(pay.amount * share);
          if (seenPay(rule.id, pay.id)) continue;
          const amount = Math.round(base * (rule.pct || 0) / 100);
          if (!amount) continue;
          ins.run(sp, per, rule.id, pay.invoice_id, pay.id, pay.inv_cust, 'percent_collected', rule.pct, base, amount, 'calculated', nowIso());
          created.push({ rule: rule.name, payment: pay.number, amount });
          continue;
        }
        if (seenPay(rule.id, pay.id)) continue; // dedup — each payment counted once per rule
        const base = pay.amount;
        const amount = Math.round(base * (rule.pct || 0) / 100);
        if (!amount) continue;
        ins.run(sp, per, rule.id, pay.invoice_id, pay.id, pay.inv_cust, 'percent_collected', rule.pct, Math.round(base), amount, 'calculated', nowIso());
        created.push({ rule: rule.name, payment: pay.number, amount });
      }
    }
  });
  tx();
  audit(user, 'commission', 0, 'calc', null, { period: per, created: created.length });
  const rows = d.prepare('SELECT c.*, u.full_name, i.number invoice_number, p.number payment_number FROM commissions c JOIN users u ON u.id=c.user_id LEFT JOIN invoices i ON i.id=c.invoice_id LEFT JOIN payments p ON p.id=c.payment_id WHERE c.period=? ORDER BY c.id DESC').all(per);
  return { period: per, created: created.length, rows };
}
// ---- commission lifecycle ----
function setCommissionStatus(user, payId, from, to, actionLabel) {
  requirePerm(user, 'commission', 'approve');
  const d = get();
  const c = d.prepare('SELECT * FROM commissions WHERE id=?').get(payId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'پورسانت پیدا نشد.');
  if (!from.includes(c.status)) throw new HttpError(400, 'BAD_STATE', `وضعیت فعلی (${c.status}) برای این عملیات مجاز نیست.`);
  d.prepare('UPDATE commissions SET status=? WHERE id=?').run(to, payId);
  audit(user, 'commission', payId, actionLabel, { status: c.status }, { status: to });
  addActivity('commission', payId, user.id, actionLabel, `پورسانت ${actionLabel}: ${fmtNum(c.amount)} ریال`);
  return { ok: true, status: to };
}
function approveCommission(user, id) { return setCommissionStatus(user, id, ['calculated', 'pending'], 'approved', 'approve'); }
function payCommission(user, id) { return setCommissionStatus(user, id, ['approved'], 'paid', 'pay'); }
function cancelCommission(user, id) { return setCommissionStatus(user, id, ['calculated', 'approved', 'pending'], 'cancelled', 'cancel'); }
// ---------------- Stock ops ----------------
function stockMove(user, data) {
  const d = get();
  requirePerm(user, 'stock_transaction', 'create');
  const productId = Number(data.product_id);
  const type = data.type;
  let qty = Number(data.qty) || 0;
  if (!['in', 'out', 'transfer', 'adjust', 'reservation'].includes(type)) throw new HttpError(422, 'VALIDATION', 'نوع حرکت نامعتبر است.');
  const p = d.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'کالا پیدا نشد.');
  const before = p.stock_qty || 0;
  if (type === 'out') qty = -Math.abs(qty);
  else if (type === 'in') qty = Math.abs(qty);
  else if (type === 'reservation') qty = -(Math.abs(qty) || 0);
  else if (type === 'transfer') qty = Math.abs(qty);
  if (!qty) throw new HttpError(422, 'VALIDATION', 'مقدار صفر است.');
  // Section 8: transfer = internal movement between warehouse locations; the single
  // stock column (total on hand) is unchanged — the movement row is the audit trail.
  const stockDelta = type === 'transfer' ? 0 : qty;
  if ((type === 'out' || type === 'reservation') && before + qty < 0) throw new HttpError(400, 'STOCK_INSUFFICIENT', `موجودی کافی نیست (موجودی فعلی: ${before} ${p.unit}).`);
  const txId = d.transaction(() => {
    return generic.recordStockTx(productId, type, qty, data.note || '', user.id, data.ref_type || '', Number(data.ref_id) || 0, stockDelta);
  })();
  const after = d.prepare('SELECT stock_qty FROM products WHERE id=?').get(productId).stock_qty;
  audit(user, 'stock_transaction', txId, 'move',
    { product_id: productId, product: p.name, type, before_stock: before },
    { qty, after_stock: after, note: data.note || '', ref_type: data.ref_type || '', ref_id: Number(data.ref_id) || 0 });
  return { ok: true, new_stock: after, tx_id: txId };
}
// ---------------- Section 8: purchase order receive → stock in ----------------
function poReceive(user, poId, data = {}) {
  const d = get();
  requirePerm(user, 'purchase_order', 'edit');
  requirePerm(user, 'stock_transaction', 'create');
  const po = d.prepare('SELECT * FROM purchase_orders WHERE id=?').get(poId);
  if (!po) throw new HttpError(404, 'NOT_FOUND', 'سفارش خرید پیدا نشد.');
  if (!['sent', 'partial'].includes(po.status)) throw new HttpError(400, 'BAD_STATE', `فقط سفارش‌های «ارسال‌شده/تحویل جزئی» قابل دریافت هستند (وضعیت فعلی: ${po.status}).`);
  const items = d.prepare('SELECT * FROM po_items WHERE po_id=?').all(poId);
  if (!items.length) throw new HttpError(422, 'VALIDATION', 'سفارش خرید ردیفی ندارد.');
  // optional per-line partial receive: { qty: { [item_id]: n } } — default: full remaining
  const qtyMap = (data.qty && typeof data.qty === 'object') ? data.qty : null;
  const received = {};
  const tx = d.transaction(() => {
    for (const it of items) {
      const remaining = (it.qty || 0) - (it.received_qty || 0);
      if (remaining <= 0) continue;
      let recv = (qtyMap && qtyMap[it.id] !== undefined && qtyMap[it.id] !== null && String(qtyMap[it.id]).trim() !== '') ? Number(qtyMap[it.id]) : remaining;
      if (!Number.isFinite(recv) || recv <= 0) continue;
      if (recv > remaining) throw new HttpError(422, 'VALIDATION', `دریافت ردیف «${it.name}» (${recv}) از مانده (${remaining}) بیشتر است.`);
      d.prepare('UPDATE po_items SET received_qty = received_qty + ? WHERE id=?').run(recv, it.id);
      received[it.id] = recv;
      if (it.product_id) {
        const p = d.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
        if (p) generic.recordStockTx(p.id, 'in', recv, 'دریافت سفارش خرید ' + po.number, user.id, 'purchase_order', poId);
      }
    }
    const left = d.prepare('SELECT COUNT(*) c FROM po_items WHERE po_id=? AND received_qty < qty').get(poId).c;
    d.prepare('UPDATE purchase_orders SET status=? WHERE id=?').run(left ? 'partial' : 'received', poId);
    return left;
  });
  const left = tx();
  addActivity('purchase_order', poId, user.id, 'receive', left ? 'دریافت جزئی کالا از تأمین‌کننده' : 'دریافت کامل کالا از تأمین‌کننده');
  audit(user, 'purchase_order', poId, 'receive', { status: po.status }, { status: left ? 'partial' : 'received', received });
  return { ok: true, status: left ? 'partial' : 'received', received };
}
// ---------------- Lab report ----------------
function generateLabReport(user, requestId) {
  const d = get();
  requirePerm(user, 'lab_request', 'edit');
  const r = d.prepare('SELECT * FROM lab_requests WHERE id=?').get(requestId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'درخواست پیدا نشد.');
  if (r.status !== 'done' && r.status !== 'reported') throw new HttpError(400, 'BAD_STATE', 'ابتدا وضعیت درخواست را «انجام‌شده» کنید.');
  d.prepare('UPDATE lab_requests SET status=?, report_generated_at=? WHERE id=?').run('reported', nowIso(), requestId);
  addActivity('lab_request', requestId, user.id, 'report', 'گزارش آزمایشگاهی صادر شد');
  return { ok: true, printUrl: '/api/print/lab/' + requestId };
}
// ---------------- Calendar ----------------
function calendarEvents(user, from, to) {
  const d = get();
  const f = from || new Date().toISOString();
  const t = to || new Date(Date.now() + 30 * 864e5).toISOString();
  const events = [];
  for (const m of d.prepare('SELECT * FROM meetings WHERE start_at>=? AND start_at<=? AND status!=\'cancelled\'').all(f, t)) {
    events.push({ id: m.id, type: 'meeting', title: m.title, start: m.start_at, end: m.end_at, color: '#7c5cd6', ref_type: 'meeting', ref_id: m.id, status: m.status });
  }
  for (const tsk of d.prepare('SELECT * FROM tasks WHERE due_at IS NOT NULL AND due_at>=? AND due_at<=? AND status IN (\'open\',\'in_progress\')').all(f, t)) {
    events.push({ id: tsk.id, type: 'task', title: 'وظیفه: ' + tsk.title, start: tsk.due_at, end: null, color: '#c9622a', ref_type: 'task', ref_id: tsk.id, status: tsk.status });
  }
  for (const fu of d.prepare('SELECT * FROM followups WHERE due_at>=? AND due_at<=? AND status=\'pending\'').all(f, t)) {
    events.push({ id: fu.id, type: 'followup', title: 'پیگیری: ' + (fu.subject || fu.entity_type), start: fu.due_at, end: null, color: '#2a9d8f', ref_type: 'followup', ref_id: fu.id, status: 'pending' });
  }
  for (const opp of d.prepare('SELECT * FROM opportunities WHERE expected_close_at IS NOT NULL AND expected_close_at>=? AND expected_close_at<=? AND status=\'open\'').all(f, t)) {
    events.push({ id: opp.id, type: 'opportunity', title: 'بسته شدن: ' + opp.title, start: opp.expected_close_at, end: null, color: '#c9a227', ref_type: 'opportunity', ref_id: opp.id, status: 'open' });
  }
  for (const inv of d.prepare('SELECT * FROM invoices WHERE due_date IS NOT NULL AND due_date>=? AND due_date<=? AND status IN (\'unpaid\',\'partial\',\'overdue\')').all(f, t)) {
    events.push({ id: inv.id, type: 'payment', title: 'سررسید فاکتور ' + inv.number, start: inv.due_date, end: null, color: '#c0392b', ref_type: 'invoice', ref_id: inv.id, status: inv.status });
  }
  events.sort((a, b) => a.start < b.start ? -1 : 1);
  return { events };
}
// ---------------- Price suggestion (per-customer price resolution) ----------------
function suggestPrice(user, q) {
  requirePerm(user, 'product', 'view');
  const d = get();
  const pid = Number(q.product_id);
  const custId = q.customer_id ? Number(q.customer_id) : null;
  const plId = q.price_list_id ? Number(q.price_list_id) : null;
  // payment stage (cash / 3_month / 6_month / custom) — default 'cash'
  const STAGES = ['cash', '3_month', '6_month', 'custom'];
  const stage = STAGES.includes(q.payment_stage) ? q.payment_stage : 'cash';
  const p = d.prepare('SELECT * FROM products WHERE id=?').get(pid);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'کالا پیدا نشد.');
  const today = nowIso().slice(0, 10);
  const listInRange = (pl) => (!pl.valid_from || pl.valid_from <= today) && (!pl.valid_until || pl.valid_until >= today);
  const out = { product_id: pid, product_name: p.name, product_code: p.code, unit: p.unit, source: null, price: null, discount_pct: 0, tax_rate: 0, list_expired: false, stage };
  // 1) explicit list
  let list = plId ? d.prepare('SELECT * FROM price_lists WHERE id=?').get(plId) : null;
  if (!list) list = d.prepare('SELECT * FROM price_lists WHERE is_default=1 AND active=1').get() || d.prepare('SELECT * FROM price_lists WHERE active=1 ORDER BY id DESC').get() || null;
  if (list) {
    const listOk = listInRange(list);
    if (!listOk) out.list_expired = true;
    if (listOk) {
      const item = (cust, st) => cust
        ? d.prepare('SELECT * FROM price_list_items WHERE price_list_id=? AND product_id=? AND customer_id=? AND COALESCE(payment_stage,\'cash\')=?').get(list.id, pid, cust, st)
        : d.prepare('SELECT * FROM price_list_items WHERE price_list_id=? AND product_id=? AND (customer_id IS NULL OR customer_id=0) AND COALESCE(payment_stage,\'cash\')=?').get(list.id, pid, st);
      let it = null;
      if (custId) it = item(custId, stage);
      if (!it && stage !== 'cash' && custId) it = item(custId, 'cash');
      if (!it) it = item(null, stage);
      if (!it && stage !== 'cash') it = item(null, 'cash');
      if (it) {
        const itemIn = (!it.valid_from || it.valid_from <= today) && (!it.valid_until || it.valid_until >= today);
        if (itemIn && it.price > 0) {
          out.price = it.price; out.discount_pct = it.discount_pct || 0; out.tax_rate = it.tax_rate || 0;
          out.source = it.customer_id ? 'customer_price' : 'price_list';
          out.price_list_id = list.id; out.price_list_name = list.name;
          return out;
        }
      }
    }
  }
  // 2) product base price
  out.price = p.price_retail || p.price_wholesale || p.price_export || p.price_cost || 0;
  out.source = 'product_base';
  return out;
}
// ---------------- Customer 360 finance ----------------
function customerFinance(user, customerId) {
  requirePerm(user, 'customer', 'view');
  const d = get();
  const id = Number(customerId);
  const c = d.prepare('SELECT * FROM customers WHERE id=?').get(id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  const q = (sql, ...p) => d.prepare(sql).get(...p);
  const totalInvoices = q(`SELECT COALESCE(SUM(total),0) s, COUNT(*) n FROM invoices WHERE customer_id=? AND status!='cancelled'`, id).s;
  const totalPaid = q(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM payments WHERE customer_id=? AND status='paid'`, id).s;
  const balance = q(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial','overdue')`, id).s;
  const openInvoices = q(`SELECT COALESCE(SUM(total-paid_amount),0) s, COUNT(*) n FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial','overdue')`, id);
  const collectionsMonth = (() => { const r = require('../../lib/jalali'); const n2 = new Date(); const [jy, jm] = r.gregorianToJalaali(n2.getFullYear(), n2.getMonth() + 1, n2.getDate()); const st = r.jalaaliToGregorian(jy, jm, 1); return q(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE customer_id=? AND status='paid' AND paid_at>=?`, id, new Date(st[0], st[1] - 1, st[2]).toISOString()).s; })();
  const quotes = q(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM quotes WHERE customer_id=?`, id);
  const orders = q(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE customer_id=? AND status!='cancelled'`, id);
  const recentPayments = d.prepare('SELECT p.*, i.number invoice_number FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.customer_id=? ORDER BY p.id DESC LIMIT 5').all(id);
  const commissionTotal = q(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM commissions WHERE customer_id=? AND status!='cancelled'`, id);
  const spName = c.salesperson_id ? (d.prepare('SELECT full_name FROM users WHERE id=?').get(c.salesperson_id) || {}).full_name || null : null;
  const related = {
    last_invoice: q(`SELECT number, total, paid_amount, issue_date, status FROM invoices WHERE customer_id=? AND status!='cancelled' ORDER BY id DESC LIMIT 1`, id) || null,
    last_order: q(`SELECT number, total, order_date, status FROM orders WHERE customer_id=? AND status!='cancelled' ORDER BY id DESC LIMIT 1`, id) || null,
    last_followup: q(`SELECT subject, due_at, status FROM followups WHERE entity_type='customer' AND entity_id=? ORDER BY id DESC LIMIT 1`, id) || null,
    active_contract: q(`SELECT number, title, end_date, status FROM contracts WHERE customer_id=? AND status IN ('active','draft') ORDER BY id DESC LIMIT 1`, id) || null,
    last_payment: (recentPayments[0] || null),
  };
  return {
    customer: { id: c.id, number: c.number, name: c.name, type: c.type, tax_code: c.tax_code, phone: c.phone, mobile: c.mobile, email: c.email, city: c.city, province: c.province, status: c.status, salesperson_id: c.salesperson_id, salesperson_id_name: spName, credit_limit: c.credit_limit, credit_used: c.credit_used, credit_status: c.credit_status },
    totals: { total_invoices: totalInvoices, total_paid: totalPaid, balance, open_invoices: openInvoices.n, open_invoices_amount: openInvoices.s, collections_month: collectionsMonth, quotes: quotes.n, orders: orders.n, commission_total: commissionTotal.s },
    recent_payments: recentPayments,
    related,
  };
}
// ---------------- Sales & Finance reports ----------------
const SALES_REPORTS = {
  sales_by_customer: { title: 'فروش بر اساس مشتری', cols: ['customer', 'invoices', 'total', 'paid', 'balance'] },
  sales_by_product: { title: 'فروش بر اساس محصول', cols: ['product', 'qty', 'total'] },
  sales_by_salesperson: { title: 'فروش بر اساس فروشنده', cols: ['salesperson', 'invoices', 'total', 'paid', 'balance'] },
  sales_by_month: { title: 'فروش بر اساس ماه (شمسی)', cols: ['month', 'invoices', 'total', 'paid'] },
  sales_by_year: { title: 'فروش بر اساس سال (شمسی)', cols: ['year', 'invoices', 'total', 'paid'] },
  sales_by_region: { title: 'فروش بر اساس منطقه', cols: ['region', 'invoices', 'total', 'paid'] },
  open_invoices: { title: 'فاکتورهای باز', cols: ['number', 'customer', 'issue_date', 'due_date', 'total', 'paid', 'balance', 'status'] },
  payments_report: { title: 'گزارش پرداخت‌ها', cols: ['number', 'date', 'customer', 'invoice', 'amount', 'method', 'status'] },
  collections: { title: 'وصولی بر اساس مشتری', cols: ['customer', 'payments', 'total'] },
  receivables: { title: 'مطالبات (بدهی مشتریان)', cols: ['customer', 'open_invoices', 'balance', 'credit_limit', 'status'] },
  commission_by_salesperson: { title: 'پورسانت هر فروشنده', cols: ['salesperson', 'commissions', 'base', 'amount'] },
  commission_by_customer: { title: 'پورسانت بر اساس مشتری', cols: ['customer', 'commissions', 'base', 'amount'] },
  commission_by_product: { title: 'پورسانت بر اساس محصول', cols: ['product', 'commissions', 'amount'] },
  commission_by_invoice: { title: 'پورسانت بر اساس فاکتور', cols: ['invoice', 'customer', 'commissions', 'base', 'amount'] },
  commission_paid: { title: 'پورسانت پرداخت‌شده', cols: ['salesperson', 'commissions', 'amount', 'period'] },
  commission_unpaid: { title: 'پورسانت پرداخت‌نشده', cols: ['salesperson', 'commissions', 'amount', 'period', 'status'] },
  customer_geography: { title: 'جغرافیای مشتریان (استان/شهر/شهرک صنعتی)', cols: ['province', 'city', 'industrial_city', 'name', 'type', 'status', 'salesperson', 'contacts', 'invoices', 'total', 'created_at'] },
};
function salesReport(user, kind, q) {
  requirePerm(user, 'commission', 'view');
  if (!SALES_REPORTS[kind]) throw new HttpError(404, 'NOT_FOUND', 'نوع گزارش پیدا نشد.');
  const d = get();
  const { jalaaliToGregorian } = require('../../lib/jalali');
  const now = new Date();
  const fromIso = q.from ? new Date(q.from).toISOString() : new Date(now.getFullYear() - 1, 0, 1).toISOString();
  const toIso = q.to ? new Date(q.to).toISOString() : new Date(now.getTime() + 864e5).toISOString();
  const custId = q.customer_id ? Number(q.customer_id) : null;
  const spId = q.salesperson_id ? Number(q.salesperson_id) : null;
  const statusF = q.status || '';
  const rows = [];

  if (kind === 'customer_geography') {
    // Geographic report: Province -> City -> Industrial City -> Customer, from REAL DB rows
    const where = ['c.archived_at IS NULL'], params = [];
    if (q.province) { where.push('c.province = ?'); params.push(String(q.province)); }
    if (q.city) { where.push('c.city = ?'); params.push(String(q.city)); }
    if (q.industrial_city) { where.push('c.industrial_city = ?'); params.push(String(q.industrial_city)); }
    if (q.ctype) { where.push('c.type = ?'); params.push(String(q.ctype)); }
    if (statusF) { where.push('c.status = ?'); params.push(statusF); }
    if (spId) { where.push('c.salesperson_id = ?'); params.push(spId); }
    if (custId) { where.push('c.id = ?'); params.push(custId); }
    if (q.from || q.to) { where.push('c.created_at BETWEEN ? AND ?'); params.push(q.from ? new Date(q.from).toISOString() : '1970-01-01T00:00:00.000Z', q.to ? new Date(q.to).toISOString() : '2999-01-01T00:00:00.000Z'); }
    if (q.gq) { where.push('(c.name LIKE ? OR c.number LIKE ?)'); params.push('%' + String(q.gq).replace(/[%_]/g, '') + '%', '%' + String(q.gq).replace(/[%_]/g, '') + '%'); }
    const geoRows = d.prepare(`SELECT c.*, u.full_name sp_name,
      (SELECT COUNT(*) FROM customer_contacts cc WHERE cc.customer_id = c.id) n_contacts,
      (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status != 'cancelled') n_inv,
      (SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.customer_id = c.id AND i.status != 'cancelled') inv_total
      FROM customers c LEFT JOIN users u ON u.id = c.salesperson_id
      WHERE ${where.join(' AND ')} ORDER BY c.province, c.city, c.industrial_city, c.name`).all(...params);
    const typeFa = { company: 'شرکت', person: 'شخصی' };
    const geoOut = geoRows.map(c => ({
      province: c.province || '—', city: c.city || '—', industrial_city: c.industrial_city || '—',
      name: c.name, type: typeFa[c.type] || c.type || '—', status: c.status,
      salesperson: c.sp_name || '—', contacts: c.n_contacts, invoices: c.n_inv,
      total: c.inv_total, created_at: c.created_at,
    }));
    const provinces = [...new Set(geoOut.map(r => r.province))].filter(x => x !== '—');
    const cities = [...new Set(geoOut.map(r => r.city))].filter(x => x !== '—');
    const inds = [...new Set(geoOut.map(r => r.industrial_city))].filter(x => x !== '—');
    return {
      kind, title: SALES_REPORTS[kind].title, columns: SALES_REPORTS[kind].cols, rows: geoOut,
      summary: { total_rows: geoOut.length, sum_total: geoOut.reduce((a, r) => a + (r.total || 0), 0), geo: { provinces, cities, industrial_cities: inds } },
    };
  }
  const J = require('../../lib/jalali');
  const shamsiKey = (iso, level) => { const dt = new Date(iso); const [jy, jm] = J.gregorianToJalaali(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); return level === 'year' ? String(jy) : `${jy}/${String(jm).padStart(2, '0')}`; };
  if (kind === 'sales_by_customer' || kind === 'sales_by_salesperson' || kind === 'sales_by_region' || kind === 'sales_by_month' || kind === 'sales_by_year') {
    const keyOf = (r) => kind === 'sales_by_customer' ? (r.c_name || '—') : kind === 'sales_by_salesperson' ? (r.u_name || '—') : kind === 'sales_by_region' ? (r.c_province || '—') : shamsiKey(r.issue_date, kind === 'sales_by_month' ? 'month' : 'year');
    for (const r of d.prepare(`SELECT i.*, c.name c_name, c.province c_province, u.full_name u_name FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=i.created_by WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? ${custId ? 'AND i.customer_id=?' : ''} ${spId ? 'AND i.created_by=?' : ''}`).all(fromIso, toIso, ...(custId ? [custId] : []), ...(spId ? [spId] : []))) {
      const key = keyOf(r);
      let row = rows.find(x => x._k === key);
      if (!row) { row = { _k: key, name: key, invoices: 0, total: 0, paid: 0, balance: 0 }; rows.push(row); }
      row.invoices++; row.total += r.total || 0; row.paid += r.paid_amount || 0; row.balance += (r.total - r.paid_amount) || 0;
    }
    rows.sort((a, b) => b.total - a.total);
  } else if (kind === 'sales_by_product') {
    for (const r of d.prepare(`SELECT ii.*, p.name p_name FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN products p ON p.id=ii.product_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? ${custId ? 'AND i.customer_id=?' : ''} ${spId ? 'AND i.created_by=?' : ''}`).all(fromIso, toIso, ...(custId ? [custId] : []), ...(spId ? [spId] : []))) {
      const name = r.p_name || r.name || '—';
      const row = rows.find(x => x._k === name) || { _k: name, name, qty: 0, total: 0 };
      row.qty += r.qty || 0; row.total += r.line_total || 0;
      if (!rows.includes(row)) rows.push(row);
    }
    rows.sort((a, b) => b.total - a.total);
  } else if (kind === 'open_invoices') {
    for (const r of d.prepare(`SELECT i.*, c.name c_name FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','overdue') ${statusF ? `AND i.status=?` : ''} ${custId ? 'AND i.customer_id=?' : ''}`).all(...(statusF ? [statusF] : []), ...(custId ? [custId] : []))) {
      rows.push({ number: r.number, customer: r.c_name || '—', issue_date: r.issue_date, due_date: r.due_date, total: r.total, paid: r.paid_amount, balance: r.total - r.paid_amount, status: r.status });
    }
  } else if (kind === 'payments_report' || kind === 'collections') {
    const pays = d.prepare(`SELECT p.*, c.name c_name, i.number i_number FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.paid_at>=? AND p.paid_at<=? ${custId ? 'AND p.customer_id=?' : ''} ${statusF ? `AND p.status=?` : ''}`).all(fromIso, toIso, ...(custId ? [custId] : []), ...(statusF ? [statusF] : []));
    if (kind === 'payments_report') { for (const r of pays) rows.push({ number: r.number, date: r.paid_at, customer: r.c_name || '—', invoice: r.i_number || '—', amount: r.amount, method: r.method, status: r.status }); }
    else { for (const r of pays) { if (r.status === 'refunded') continue; const row = rows.find(x => x._k === r.c_name) || { _k: r.c_name, name: r.c_name || '—', payments: 0, total: 0 }; row.payments++; row.total += r.amount; if (!rows.includes(row)) rows.push(row); } rows.sort((a, b) => b.total - a.total); }
  } else if (kind === 'receivables') {
    for (const r of d.prepare(`SELECT c.id, c.name, c.credit_limit, c.status, COALESCE(SUM(i.total-i.paid_amount),0) bal, COUNT(i.id) n FROM customers c LEFT JOIN invoices i ON i.customer_id=c.id AND i.status IN ('unpaid','partial','overdue') GROUP BY c.id HAVING bal>0 ORDER BY bal DESC`).all()) {
      if (custId && r.id !== custId) continue;
      rows.push({ customer: r.name, open_invoices: r.n, balance: r.bal, credit_limit: r.credit_limit, status: r.status });
    }
  } else if (kind.startsWith('commission')) {
    const base = `SELECT c.*, u.full_name u_name, i.number i_number, cu.name cu_name FROM commissions c JOIN users u ON u.id=c.user_id LEFT JOIN invoices i ON i.id=c.invoice_id LEFT JOIN customers cu ON cu.id=c.customer_id WHERE 1=1`;
    const cond = []; const params = [];
    if (kind === 'commission_paid') cond.push("c.status='paid'");
    if (kind === 'commission_unpaid') cond.push("c.status IN ('calculated','approved','pending')");
    if (custId) { cond.push('c.customer_id=?'); params.push(custId); }
    if (spId) { cond.push('c.user_id=?'); params.push(spId); }
    // Jalali period filter (month granularity on the commission period 'YYYY-MM')
    const jPeriodOf = (iso) => { const dt = new Date(iso); const [jy, jm] = J.gregorianToJalaali(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); return `${jy}-${String(jm).padStart(2, '0')}`; };
    if (q.from) { cond.push('c.period>=?'); params.push(jPeriodOf(fromIso)); }
    if (q.to) { cond.push('c.period<=?'); params.push(jPeriodOf(toIso)); }
    const all = d.prepare(base + (cond.length ? ' AND ' + cond.join(' AND ') : '')).all(...params);
    if (kind === 'commission_by_salesperson') for (const r of all) { if (r.status === 'cancelled') continue; const row = rows.find(x => x._k === r.u_name) || { _k: r.u_name, name: r.u_name || '—', commissions: 0, base: 0, amount: 0 }; row.commissions++; row.base += r.base || 0; row.amount += r.amount || 0; if (!rows.includes(row)) rows.push(row); }
    else if (kind === 'commission_by_customer') for (const r of all) { if (r.status === 'cancelled') continue; const k = r.cu_name || '—'; const row = rows.find(x => x._k === k) || { _k: k, name: k, commissions: 0, base: 0, amount: 0 }; row.commissions++; row.base += r.base || 0; row.amount += r.amount || 0; if (!rows.includes(row)) rows.push(row); }
    else if (kind === 'commission_by_product') for (const r of all) {
      if (r.status === 'cancelled' || !r.invoice_id) continue;
      const lines = d.prepare('SELECT ii.*, p.name p_name FROM invoice_items ii LEFT JOIN products p ON p.id=ii.product_id WHERE ii.invoice_id=?').all(r.invoice_id);
      const tot = lines.reduce((a, l) => a + (l.line_total || 0), 0);
      for (const l of lines) { if (!tot) continue; const k = l.p_name || l.name || '—'; const share = (l.line_total || 0) / tot; const row = rows.find(x => x._k === k) || { _k: k, name: k, commissions: 0, amount: 0 }; row.commissions += 1; row.amount += Math.round((r.amount || 0) * share); if (!rows.includes(row)) rows.push(row); }
    }
    else if (kind === 'commission_by_invoice') for (const r of all) { if (r.status === 'cancelled' || !r.invoice_id) continue; const row = rows.find(x => x._k === r.i_number) || { _k: r.i_number, name: r.i_number || '—', customer: r.cu_name || '—', commissions: 0, base: 0, amount: 0 }; row.commissions++; row.base += r.base || 0; row.amount += r.amount || 0; if (!rows.includes(row)) rows.push(row); }
    else if (kind === 'commission_paid' || kind === 'commission_unpaid') for (const r of all) { const row = rows.find(x => x._k === r.u_name + '|' + r.period) || { _k: r.u_name + '|' + r.period, salesperson: r.u_name || '—', period: r.period, commissions: 0, amount: 0, status: r.status }; row.commissions++; row.amount += r.amount || 0; if (!rows.includes(row)) rows.push(row); }
    if (kind !== 'commission_by_product') rows.sort((a, b) => (b.amount || 0) - (a.amount || 0));
  }
  const summary = { total_rows: rows.length, sum_total: rows.reduce((a, r) => a + (r.total || 0), 0), sum_amount: rows.reduce((a, r) => a + (r.amount || 0), 0), sum_balance: rows.reduce((a, r) => a + (r.balance || 0), 0) };
  return { kind, title: SALES_REPORTS[kind].title, columns: SALES_REPORTS[kind].cols, rows: rows.map(({ _k, ...r }) => r), summary, from: fromIso, to: toIso };
}
function salesReportExport(user, kind, q, format) {
  const rep = salesReport(user, kind, q);
  const co = require('../../lib/print').company();
  const { fmtDateLong, jalExport, esc } = require('../../lib/util');
  const dateFa = fmtDateLong(nowIso());
  const headFa = { customer: 'مشتری', invoices: 'تعداد فاکتور', total: 'مبلغ فروش', paid: 'پرداختی', balance: 'مانده', product: 'محصول', qty: 'تعداد', salesperson: 'فروشنده', month: 'ماه', year: 'سال', region: 'منطقه', number: 'شماره', issue_date: 'تاریخ صدور', due_date: 'سررسید', payments: 'تعداد', date: 'تاریخ', invoice: 'فاکتور', amount: 'مبلغ', method: 'روش', status: 'وضعیت', open_invoices: 'فاکتور باز', credit_limit: 'سقف اعتبار', commissions: 'تعداد', base: 'مبنای محاسبه', period: 'دوره' };
  const headers = rep.columns.map(c => headFa[c] || c);
  const dataRows = rep.rows.map(r => rep.columns.map(c => {
    const v = r[c];
    if (c.endsWith('_date') || c === 'date') return v ? jalExport(v) : '—';
    if (typeof v === 'number') return v;
    return v === null || v === undefined ? '—' : v;
  }));
  if (format === 'csv') {
    const csv = '\uFEFF' + [headers, ...dataRows].map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    return { type: 'csv', data: csv, fileName: rep.title + '.csv' };
  }
  if (format === 'xlsx') {
    const XLSX = require('xlsx');
    const aoa = [[rep.title], ['شرکت: ' + co.name], ['تهیه‌شده: ' + dateFa + ' توسط ' + user.full_name], [], headers, ...dataRows, [], ['جمع‌بندی', rep.summary.sum_total ? rep.summary.sum_total : rep.summary.sum_amount || rep.summary.total_rows]];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, rep.title.replace(/[\\/\?\*\[\]:]/g, ' ').slice(0, 28));
    return { type: 'xlsx', data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), fileName: rep.title + '.xlsx' };
  }
  if (format === 'html' || format === 'pdf') {
    const headerOn = q.header !== '0';
    const rowsHtml = dataRows.map(r => '<tr>' + r.map(x => `<td>${esc(typeof x === 'number' ? x.toLocaleString('fa-IR') : x)}</td>`).join('') + '</tr>').join('');
    const body = `
  ${require('../../lib/print').companyHeadHtml(co, headerOn)}
  <h1>${esc(rep.title)}</h1>
  <div class="meta">
    <div><b>بازهٔ زمانی:</b><span>${jalExport(rep.from)} تا ${jalExport(rep.to)}</span></div>
    <div><b>تاریخ تهیه:</b><span>${esc(dateFa)}</span></div>
    <div><b>تهیه‌کننده:</b><span>${esc(user.full_name)}</span></div>
    <div><b>شمارهٔ گزارش:</b><span>SAL-${String(Date.now()).slice(-8)}</span></div>
  </div>
  <table class="items"><thead><tr>${headers.map(h => '<th>' + esc(h) + '</th>').join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>
  <div class="totals"><div class="grand"><b>جمع کل</b><span>${rep.summary.sum_total || rep.summary.sum_amount || rep.summary.total_rows} ${rep.summary.sum_balance ? '— مانده: ' + rep.summary.sum_balance : ''}</span></div></div>
  <div class="footer"><div class="sign"><div class="line"></div>تهیه‌کننده</div><div class="sign"><div class="line"></div>تأیید مدیریت</div></div>`;
    const { fmtDate } = require('../../lib/util');
    const { nowIso } = require('../../lib/util');
    return { type: 'html', data: require('../../lib/print').baseHtml(rep.title, body, co, { printMeta: { at: fmtDate(nowIso(), { time: true, fa: false }) + ' ' + new Date().toTimeString().slice(0, 5), user: user.full_name }, autoPrint: q.autoprint === '1' }), fileName: rep.title + '.html' };
  }
  throw new HttpError(400, 'BAD_FORMAT', 'فرمت نامعتبر است.');
}
module.exports = {
  board, moveOpp, quoteToOrder, orderToInvoice, poReceive, addPayment, refundPayment, calcCommissions,
  approveCommission, payCommission, cancelCommission, suggestPrice, customerFinance,
  salesReport, salesReportExport, SALES_REPORTS, BASIS_FA,
  stockMove, generateLabReport, calendarEvents, recalcDoc, updateTier,
};
