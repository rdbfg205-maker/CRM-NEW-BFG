'use strict';
// ============ Real event notifications for generic CRUD (Section 2) ============
// Fired from generic.afterCreate for events that had no notification before:
//   quote / invoice / order / payment creation, manual task assignment,
//   manual follow-up assignment. Each notification targets a REAL person or
//   REAL role from the DB; the creator is never notified about their own action.
// Best effort: any failure is swallowed (the main CRUD flow must never break).
const { notify, notifyRoles } = require('../core/notify');

function safe(fn) { try { fn(); } catch { /* best effort */ } }

function customerOf(d, row) {
  if (!row || !row.customer_id) return null;
  try { return d.prepare('SELECT id, name, salesperson_id FROM customers WHERE id=?').get(row.customer_id) || null; } catch { return null; }
}

function notifyDoc(user, table, id) {
  const d = require('../db/db').get();
  const row = d.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!row) return;
  const cu = customerOf(d, row);
  const label = (row.number ? row.number + ' — ' : '') + (cu ? cu.name : '');
  const sp = cu && cu.salesperson_id ? Number(cu.salesperson_id) : null;
  const exclude = user.id ? [Number(user.id)] : [];
  if (table === 'quotes') {
    if (sp && sp !== user.id) notify(sp, 'quote', 'پیش‌فاکتور جدید برای مشتری شما', label, 'quote', id, user.id);
    notifyRoles(['sales_manager', 'super_admin'], 'quote', 'پیش‌فاکتور جدید ثبت شد', label, 'quote', id, exclude, user.id);
  } else if (table === 'invoices') {
    if (sp && sp !== user.id) notify(sp, 'invoice', 'فاکتور جدید برای مشتری شما', label, 'invoice', id, user.id);
    notifyRoles(['finance_manager', 'ceo', 'super_admin'], 'invoice', 'فاکتور جدید صادر شد', label, 'invoice', id, exclude, user.id);
  } else if (table === 'orders') {
    if (sp && sp !== user.id) notify(sp, 'order', 'سفارش جدید برای مشتری شما', label, 'order', id, user.id);
    notifyRoles(['warehouse_manager', 'sales_manager', 'super_admin'], 'order', 'سفارش جدید ثبت شد', label, 'order', id, exclude, user.id);
  } else if (table === 'payments') {
    const amount = Number(row.amount || 0);
    let fullyPaid = false;
    if (row.invoice_id) {
      const inv = d.prepare('SELECT total, paid_amount FROM invoices WHERE id=?').get(row.invoice_id);
      fullyPaid = !!(inv && inv.paid_amount >= Number(inv.total) - 0.5);
    }
    if (sp && sp !== user.id) notify(sp, 'payment', 'پرداخت جدید برای مشتری شما', `${row.number || 'پرداخت'} — ${label}`.trim(), 'payment', id, user.id);
    // full-payment case is already announced by the reconciliation engine ("فاکتور کامل پرداخت شد")
    if (!fullyPaid) notifyRoles(['finance_manager', 'super_admin'], 'payment', 'پرداخت جدید دریافت شد', `${row.number || 'پرداخت'}${amount ? ' — ' + amount + ' ریال' : ''} — ${label}`.trim(), 'payment', id, exclude, user.id);
  }
}

// Role-only variant: used by the sales conversion routes (quoteToOrder /
// orderToInvoice) where the customer's salesperson is ALREADY notified by
// requireNotify — avoids double-notifying the same person for one event.
function notifyDocRoles(user, table, id) {
  return safe(() => {
    const d = require('../db/db').get();
    const row = d.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!row) return;
    const cu = customerOf(d, row);
    const label = (row.number ? row.number + ' — ' : '') + (cu ? cu.name : '');
    const exclude = user.id ? [Number(user.id)] : [];
    if (table === 'quotes') notifyRoles(['sales_manager', 'super_admin'], 'quote', 'پیش‌فاکتور جدید ثبت شد', label, 'quote', id, exclude, user.id);
    else if (table === 'invoices') notifyRoles(['finance_manager', 'ceo', 'super_admin'], 'invoice', 'فاکتور جدید صادر شد', label, 'invoice', id, exclude, user.id);
    else if (table === 'orders') notifyRoles(['warehouse_manager', 'sales_manager', 'super_admin'], 'order', 'سفارش جدید ثبت شد', label, 'order', id, exclude, user.id);
    else if (table === 'payments') {
      let fullyPaid = false;
      if (row.invoice_id) {
        const inv = d.prepare('SELECT total, paid_amount FROM invoices WHERE id=?').get(row.invoice_id);
        fullyPaid = !!(inv && inv.paid_amount >= Number(inv.total) - 0.5);
      }
      if (!fullyPaid) notifyRoles(['finance_manager', 'super_admin'], 'payment', 'پرداخت جدید دریافت شد', `${row.number || 'پرداخت'}${Number(row.amount) ? ' — ' + row.amount + ' ریال' : ''} — ${label}`.trim(), 'payment', id, exclude, user.id);
    }
  });
}

function onCreate(d, user, r, id, out) {
  const table = r.table, entity = r.entity;
  if (['quote', 'invoice', 'order', 'payment'].includes(entity)) return safe(() => notifyDoc(user, table, id));
  if (entity === 'task') {
    // manual tasks only — meeting/workflow flows notify on their own (related_type set)
    if (out && out.assignee_id && Number(out.assignee_id) !== user.id && !out.related_type) {
      return safe(() => notify(Number(out.assignee_id), 'task', 'وظیفه جدید به شما واگذار شد', out.title || '', 'task', id));
    }
    return;
  }
  if (entity === 'followup') {
    // manual follow-ups only — meeting flow notifies the responsible person itself
    if (out && out.user_id && Number(out.user_id) !== user.id && out.entity_type !== 'meeting') {
      return safe(() => notify(Number(out.user_id), 'followup', 'پیگیری جدید به شما واگذار شد', out.subject || '', 'followup', id));
    }
    return;
  }
}

module.exports = { onCreate, notifyDoc, notifyDocRoles };
