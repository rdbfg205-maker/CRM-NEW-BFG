'use strict';
// Advanced reporting engine (Section 7 — Report Builder):
//   - sources for ALL CRM modules + combined cross-module chains
//   - nested AND/OR/NOT filters, free-text search (q), group by,
//     aggregation (count / sum / avg / min / max), grand total
//   - real per-row drill-down (entity + id) for opening the source record
//   - server-side permissions: requires report_definition:view (caller) +
//     <source entity>:view, and applies the user's row scope to the data
// All server-side, safe (whitelisted columns/tables, bound params), bounded.
const { get } = require('../db/db');
const { HttpError } = require('../lib/http');
const { normalizeFa, likeEscape } = require('../lib/util');
const { requirePerm, scopeWhere } = require('../auth/auth');

const SOURCES = {
  // ================= single-module sources =================
  customers: {
    nameFa: 'مشتریان', table: 'customers', join: '', alias: '', kind: 'single',
    entity: 'customer', scopeField: 'salesperson_id', scopeFallback: 'created_by',
    drill: { entity: 'customer', id: 'id' },
    cols: {
      number: { fa: 'کد', sql: 'number' },
      name: { fa: 'نام', sql: 'name' }, type: { fa: 'نوع', sql: 'type' }, city: { fa: 'شهر', sql: 'city' },
      phone: { fa: 'تلفن', sql: 'phone' }, status: { fa: 'وضعیت', sql: 'status' },
      category: { fa: 'دسته', sql: '(SELECT name FROM customer_categories WHERE id=customers.category_id)' },
      salesperson: { fa: 'فروشنده', sql: '(SELECT full_name FROM users WHERE id=customers.salesperson_id)' },
      credit_limit: { fa: 'سقف اعتبار', sql: 'credit_limit', agg: true },
      total_spent: { fa: 'مجموع خرید', sql: "(SELECT COALESCE(SUM(total),0) FROM invoices WHERE customer_id=customers.id AND status!='cancelled')", agg: true },
      invoice_count: { fa: 'تعداد فاکتور', sql: '(SELECT COUNT(*) FROM invoices WHERE customer_id=customers.id)', agg: true },
      churn_score: { fa: 'ریسک ریزش', sql: 'churn_score', agg: true },
      created_at: { fa: 'تاریخ ایجاد', sql: 'created_at', date: true },
    },
  },
  sales: {
    nameFa: 'فروش (فاکتورها)', table: 'invoices', join: 'LEFT JOIN customers c ON c.id=invoices.customer_id', alias: 'invoices.', kind: 'single',
    entity: 'invoice', scopeField: 'created_by',
    drill: { entity: 'invoice', id: 'invoices.id' },
    cols: {
      number: { fa: 'شماره', sql: 'invoices.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      issue_date: { fa: 'تاریخ صدور', sql: 'invoices.issue_date', date: true },
      due_date: { fa: 'سررسید', sql: 'invoices.due_date', date: true },
      status: { fa: 'وضعیت', sql: 'invoices.status' },
      subtotal: { fa: 'جمع خالص', sql: 'invoices.subtotal', agg: true },
      tax: { fa: 'مالیات', sql: 'invoices.tax', agg: true },
      total: { fa: 'مبلغ کل', sql: 'invoices.total', agg: true },
      paid_amount: { fa: 'پرداختی', sql: 'invoices.paid_amount', agg: true },
      balance: { fa: 'مانده', sql: 'COALESCE(invoices.total,0) - COALESCE(invoices.paid_amount,0)', agg: true },
    },
  },
  orders: {
    nameFa: 'سفارش‌ها', table: 'orders', join: 'LEFT JOIN customers c ON c.id=orders.customer_id', alias: 'orders.', kind: 'single',
    entity: 'order', scopeField: 'salesperson_id', scopeFallback: 'created_by',
    drill: { entity: 'order', id: 'orders.id' },
    cols: {
      number: { fa: 'شماره', sql: 'orders.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      status: { fa: 'وضعیت', sql: 'orders.status' },
      order_date: { fa: 'تاریخ سفارش', sql: 'orders.order_date', date: true },
      due_date: { fa: 'تحویل', sql: 'orders.due_date', date: true },
      total: { fa: 'مبلغ', sql: 'orders.total', agg: true },
    },
  },
  quotes: {
    nameFa: 'پیش‌فاکتورها', table: 'quotes q', join: 'LEFT JOIN customers c ON c.id=q.customer_id', alias: 'q.', kind: 'single',
    entity: 'quote', scopeField: 'salesperson_id', scopeFallback: 'created_by',
    drill: { entity: 'quote', id: 'q.id' },
    cols: {
      number: { fa: 'شماره', sql: 'q.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      status: { fa: 'وضعیت', sql: 'q.status' },
      subtotal: { fa: 'جمع خالص', sql: 'q.subtotal', agg: true },
      total: { fa: 'مبلغ کل', sql: 'q.total', agg: true },
      valid_until: { fa: 'اعتبار تا', sql: 'q.valid_until', date: true },
      created_at: { fa: 'تاریخ ایجاد', sql: 'q.created_at', date: true },
    },
  },
  payments: {
    nameFa: 'پرداخت‌ها', table: 'payments p', join: 'LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN customers c ON c.id=p.customer_id', alias: 'p.', kind: 'single',
    entity: 'payment',
    drill: { entity: 'payment', id: 'p.id' },
    cols: {
      number: { fa: 'شماره', sql: 'p.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      invoice: { fa: 'فاکتور', sql: 'i.number' },
      amount: { fa: 'مبلغ', sql: 'p.amount', agg: true },
      method: { fa: 'روش', sql: 'p.method' }, status: { fa: 'وضعیت', sql: 'p.status' },
      paid_at: { fa: 'تاریخ پرداخت', sql: 'p.paid_at', date: true },
      reference: { fa: 'شماره پیگیری', sql: 'p.reference' },
    },
  },
  suppliers: {
    nameFa: 'تأمین‌کنندگان', table: 'suppliers s', join: '', alias: 's.', kind: 'single',
    entity: 'supplier',
    drill: { entity: 'supplier', id: 's.id' },
    cols: {
      name: { fa: 'نام', sql: 's.name' }, category: { fa: 'دسته', sql: 's.category' },
      phone: { fa: 'تلفن', sql: 's.phone' },
      quality_rating: { fa: 'امتیاز کیفیت', sql: 's.quality_rating', agg: true },
      po_count: { fa: 'تعداد سفارش خرید', sql: '(SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id)', agg: true },
      po_total: { fa: 'مبلغ خریدها', sql: '(SELECT COALESCE(SUM(po2.total),0) FROM purchase_orders po2 WHERE po2.supplier_id=s.id)', agg: true },
      created_at: { fa: 'تاریخ ایجاد', sql: 's.created_at', date: true },
    },
  },
  purchase_orders: {
    nameFa: 'سفارش‌های خرید', table: 'purchase_orders po', join: 'LEFT JOIN suppliers s ON s.id=po.supplier_id', alias: 'po.', kind: 'single',
    entity: 'purchase_order',
    drill: { entity: 'purchase_order', id: 'po.id' },
    cols: {
      number: { fa: 'شماره', sql: 'po.number' }, supplier: { fa: 'تأمین‌کننده', sql: 's.name' },
      status: { fa: 'وضعیت', sql: 'po.status' },
      order_date: { fa: 'تاریخ سفارش', sql: 'po.order_date', date: true },
      expected_date: { fa: 'تحویل مورد انتظار', sql: 'po.expected_date', date: true },
      total: { fa: 'مبلغ', sql: 'po.total', agg: true },
    },
  },
  inventory: {
    nameFa: 'گردش موجودی', table: 'stock_transactions st', join: 'LEFT JOIN products p ON p.id=st.product_id', alias: 'st.', kind: 'single',
    entity: 'stock_transaction',
    drill: { entity: 'stock_transaction', id: 'st.id' },
    cols: {
      product: { fa: 'کالا', sql: 'p.name' }, type: { fa: 'نوع', sql: 'st.type' },
      qty: { fa: 'مقدار', sql: 'st.qty', agg: true }, note: { fa: 'توضیح', sql: 'st.note' },
      created_at: { fa: 'تاریخ', sql: 'st.created_at', date: true },
    },
  },
  stock: {
    nameFa: 'موجودی فعلی', table: 'products p', join: '', alias: 'p.', kind: 'single',
    entity: 'product',
    drill: { entity: 'product', id: 'p.id' },
    cols: {
      code: { fa: 'کد', sql: 'p.code' }, name: { fa: 'نام', sql: 'p.name' }, unit: { fa: 'واحد', sql: 'p.unit' },
      stock_qty: { fa: 'موجودی', sql: 'p.stock_qty', agg: true }, reorder_point: { fa: 'حد سفارش', sql: 'p.reorder_point', agg: true },
      price_cost: { fa: 'قیمت تمام‌شده', sql: 'p.price_cost', agg: true },
      value: { fa: 'ارزش موجودی', sql: '(p.stock_qty * COALESCE(p.price_cost,0))', agg: true },
    },
  },
  stock_alerts: {
    nameFa: 'هشدارهای موجودی', table: 'stock_alerts sa', join: 'LEFT JOIN products p ON p.id=sa.product_id', alias: 'sa.', kind: 'single',
    entity: 'stock_alert',
    drill: { entity: 'stock_alert', id: 'sa.id' },
    cols: {
      product: { fa: 'کالا', sql: 'p.name' }, level: { fa: 'سطح', sql: 'sa.level' },
      message: { fa: 'پیام', sql: 'sa.message' },
      created_at: { fa: 'تاریخ', sql: 'sa.created_at', date: true },
      resolved_at: { fa: 'تاریخ رفع', sql: 'sa.resolved_at', date: true },
    },
  },
  lab_requests: {
    nameFa: 'درخواست‌های آزمایش', table: 'lab_requests lq', join: 'LEFT JOIN customers c ON c.id=lq.customer_id', alias: 'lq.', kind: 'single',
    entity: 'lab_request',
    drill: { entity: 'lab_request', id: 'lq.id' },
    cols: {
      number: { fa: 'شماره', sql: 'lq.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      test_type: { fa: 'نوع آزمون', sql: 'lq.test_type' }, priority: { fa: 'اولویت', sql: 'lq.priority' },
      status: { fa: 'وضعیت', sql: 'lq.status' },
      received_at: { fa: 'تاریخ دریافت', sql: 'lq.received_at', date: true },
      due_at: { fa: 'سررسید', sql: 'lq.due_at', date: true },
    },
  },
  lab_results: {
    nameFa: 'نتایج آزمایش', table: 'lab_results lr', join: 'LEFT JOIN lab_requests lq ON lq.id=lr.request_id LEFT JOIN customers c ON c.id=lq.customer_id', alias: 'lr.', kind: 'single',
    entity: 'lab_result',
    drill: { entity: 'lab_result', id: 'lr.id' },
    cols: {
      request_number: { fa: 'درخواست', sql: 'lq.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      test_name: { fa: 'آزمون', sql: 'lr.test_name' }, method: { fa: 'روش', sql: 'lr.method' },
      result_value: { fa: 'نتیجه', sql: 'lr.result_value' }, unit: { fa: 'واحد', sql: 'lr.unit' },
      spec_text: { fa: 'محدوده مجاز', sql: 'lr.spec_text' }, status: { fa: 'وضعیت', sql: 'lr.status' },
      analyst: { fa: 'آزمایشگر', sql: 'lr.analyst' },
      test_date: { fa: 'تاریخ آزمون', sql: 'lr.test_date', date: true },
    },
  },
  price_lists: {
    nameFa: 'لیست قیمت‌ها', table: 'price_lists pl', join: '', alias: 'pl.', kind: 'single',
    entity: 'price_list',
    drill: { entity: 'price_list', id: 'pl.id' },
    cols: {
      name: { fa: 'نام لیست', sql: 'pl.name' }, currency: { fa: 'ارز', sql: 'pl.currency' },
      active: { fa: 'فعال', sql: 'pl.active' }, is_default: { fa: 'پیش‌فرض', sql: 'pl.is_default' },
      items_count: { fa: 'تعداد ردیف', sql: '(SELECT COUNT(*) FROM price_list_items WHERE price_list_id=pl.id)', agg: true },
      min_price: { fa: 'حداقل قیمت', sql: '(SELECT MIN(price) FROM price_list_items WHERE price_list_id=pl.id)', agg: true },
      max_price: { fa: 'حداکثر قیمت', sql: '(SELECT MAX(price) FROM price_list_items WHERE price_list_id=pl.id)', agg: true },
      valid_from: { fa: 'اعتبار از', sql: 'pl.valid_from', date: true },
      valid_until: { fa: 'اعتبار تا', sql: 'pl.valid_until', date: true },
      created_at: { fa: 'تاریخ ایجاد', sql: 'pl.created_at', date: true },
    },
  },
  complaints: {
    nameFa: 'شکایات', table: 'complaints cp', join: 'LEFT JOIN customers c ON c.id=cp.customer_id LEFT JOIN products p ON p.id=cp.product_id LEFT JOIN users u2 ON u2.id=cp.assigned_to', alias: 'cp.', kind: 'single',
    entity: 'complaint', scopeField: 'assigned_to', scopeFallback: 'created_by',
    drill: { entity: 'complaint', id: 'cp.id' },
    cols: {
      number: { fa: 'شماره', sql: 'cp.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      product: { fa: 'محصول', sql: 'p.name' },
      defect_family: { fa: 'خانواده محصول (بانک عیب)', sql: 'cp.defect_family' },
      defect_type: { fa: 'ویژگی مورد شکایت (نوع عیب)', sql: 'cp.defect_type' },
      subject: { fa: 'موضوع', sql: 'cp.subject' }, category: { fa: 'دسته', sql: 'cp.category' },
      source: { fa: 'منبع', sql: 'cp.source' },
      priority: { fa: 'شدت / اولویت', sql: 'cp.priority' }, status: { fa: 'وضعیت', sql: 'cp.status' },
      probable_cause: { fa: 'علت احتمالی', sql: 'cp.probable_cause' },
      corrective_action: { fa: 'اقدام اصلاحی', sql: 'cp.corrective_action' },
      preventive_action: { fa: 'اقدام پیشگیرانه', sql: 'cp.preventive_action' },
      review_result: { fa: 'نتیجه بررسی', sql: 'cp.review_result' },
      assigned_to: { fa: 'مسئول', sql: 'u2.full_name' },
      department: { fa: 'واحد مسئول', sql: 'cp.department' },
      created_at: { fa: 'تاریخ ثبت', sql: 'cp.created_at', date: true },
      due_at: { fa: 'سررسید SLA', sql: 'cp.due_at', date: true },
      resolved_at: { fa: 'تاریخ رفع', sql: 'cp.resolved_at', date: true },
    },
  },
  tickets: {
    nameFa: 'تیکت‌های پشتیبانی', table: 'tickets tk', join: 'LEFT JOIN customers c ON c.id=tk.customer_id', alias: 'tk.', kind: 'single',
    entity: 'ticket', scopeField: 'assigned_to', scopeFallback: 'created_by',
    drill: { entity: 'ticket', id: 'tk.id' },
    cols: {
      number: { fa: 'شماره', sql: 'tk.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
      subject: { fa: 'موضوع', sql: 'tk.subject' }, type: { fa: 'نوع', sql: 'tk.type' },
      priority: { fa: 'اولویت', sql: 'tk.priority' }, status: { fa: 'وضعیت', sql: 'tk.status' },
      csat: { fa: 'رضایت', sql: 'tk.csat', agg: true },
      sla_due_at: { fa: 'سررسید SLA', sql: 'tk.sla_due_at', date: true },
      resolved_at: { fa: 'تاریخ رفع', sql: 'tk.resolved_at', date: true },
    },
  },
  warranties: {
    nameFa: 'گارانتی‌ها', table: 'warranties wa', join: 'LEFT JOIN customers c ON c.id=wa.customer_id', alias: 'wa.', kind: 'single',
    entity: 'warranty',
    drill: { entity: 'warranty', id: 'wa.id' },
    cols: {
      customer: { fa: 'مشتری', sql: 'c.name' }, product: { fa: 'محصول', sql: 'wa.product_name' },
      serial: { fa: 'سریال', sql: 'wa.serial' }, status: { fa: 'وضعیت', sql: 'wa.status' },
      start_date: { fa: 'شروع گارانتی', sql: 'wa.start_date', date: true },
      end_date: { fa: 'پایان گارانتی', sql: 'wa.end_date', date: true },
    },
  },
  contracts: {
    nameFa: 'قراردادها', table: 'contracts ct', join: 'LEFT JOIN customers c ON c.id=ct.customer_id LEFT JOIN suppliers s ON s.id=ct.supplier_id', alias: 'ct.', kind: 'single',
    entity: 'contract',
    drill: { entity: 'contract', id: 'ct.id' },
    cols: {
      number: { fa: 'شماره', sql: 'ct.number' }, title: { fa: 'عنوان', sql: 'ct.title' },
      customer: { fa: 'مشتری', sql: 'c.name' }, supplier: { fa: 'تأمین‌کننده', sql: 's.name' },
      type: { fa: 'نوع', sql: 'ct.type' }, status: { fa: 'وضعیت', sql: 'ct.status' },
      value: { fa: 'مبلغ', sql: 'ct.value', agg: true },
      start_date: { fa: 'شروع', sql: 'ct.start_date', date: true },
      end_date: { fa: 'پایان', sql: 'ct.end_date', date: true },
    },
  },
  campaigns: {
    nameFa: 'کمپین‌های بازاریابی', table: 'campaigns ca', join: '', alias: 'ca.', kind: 'single',
    entity: 'campaign',
    drill: { entity: 'campaign', id: 'ca.id' },
    cols: {
      name: { fa: 'نام', sql: 'ca.name' }, channel: { fa: 'کانال', sql: 'ca.channel' },
      status: { fa: 'وضعیت', sql: 'ca.status' },
      sent_count: { fa: 'ارسال‌شده', sql: 'ca.sent_count', agg: true },
      opened_count: { fa: 'بازشده', sql: 'ca.opened_count', agg: true },
      clicked_count: { fa: 'کلیک‌شده', sql: 'ca.clicked_count', agg: true },
      converted_count: { fa: 'تبدیل‌شده', sql: 'ca.converted_count', agg: true },
      schedule_at: { fa: 'تاریخ برنامه‌ریزی', sql: 'ca.schedule_at', date: true },
    },
  },
  loyalty_members: {
    nameFa: 'اعضای باشگاه مشتریان', table: 'loyalty_accounts la', join: 'LEFT JOIN customers c ON c.id=la.customer_id LEFT JOIN loyalty_tiers lt ON lt.id=la.tier_id', alias: 'la.', kind: 'single',
    entity: 'loyalty_tier',
    drill: { entity: 'customer', id: 'la.customer_id' },
    cols: {
      customer: { fa: 'مشتری', sql: 'c.name' }, tier: { fa: 'سطح', sql: 'lt.name' },
      points_balance: { fa: 'امتیاز فعلی', sql: 'la.points_balance', agg: true },
      points_earned: { fa: 'امتیاز کل', sql: 'la.points_earned', agg: true },
    },
  },
  loyalty_tiers: {
    nameFa: 'سطوح باشگاه', table: 'loyalty_tiers lt', join: '', alias: 'lt.', kind: 'single',
    entity: 'loyalty_tier',
    drill: { entity: 'loyalty_tier', id: 'lt.id' },
    cols: {
      name: { fa: 'سطح', sql: 'lt.name' },
      min_points: { fa: 'حداقل امتیاز', sql: 'lt.min_points', agg: true },
      discount_pct: { fa: 'تخفیف ٪', sql: 'lt.discount_pct', agg: true },
      members_count: { fa: 'تعداد اعضا', sql: '(SELECT COUNT(*) FROM loyalty_accounts WHERE tier_id=lt.id)', agg: true },
    },
  },
  leads: {
    nameFa: 'سرنخ‌ها', table: 'leads ld', join: '', alias: 'ld.', kind: 'single',
    entity: 'lead', scopeField: 'salesperson_id', scopeFallback: 'created_by',
    drill: { entity: 'lead', id: 'ld.id' },
    cols: {
      number: { fa: 'کد', sql: 'ld.number' }, company: { fa: 'شرکت', sql: 'ld.company' },
      source: { fa: 'منبع', sql: 'ld.source' }, status: { fa: 'وضعیت', sql: 'ld.status' },
      estimated_value: { fa: 'ارزش', sql: 'ld.estimated_value', agg: true },
      score: { fa: 'امتیاز AI', sql: 'ld.score', agg: true },
      next_followup_at: { fa: 'پیگیری', sql: 'ld.next_followup_at', date: true },
      created_at: { fa: 'تاریخ', sql: 'ld.created_at', date: true },
    },
  },
  opportunities: {
    nameFa: 'فرصت‌های فروش', table: 'opportunities op', join: 'LEFT JOIN customers c ON c.id=op.customer_id', alias: 'op.', kind: 'single',
    entity: 'opportunity', scopeField: 'salesperson_id', scopeFallback: 'created_by',
    drill: { entity: 'opportunity', id: 'op.id' },
    cols: {
      number: { fa: 'کد', sql: 'op.number' }, title: { fa: 'عنوان', sql: 'op.title' },
      customer: { fa: 'مشتری', sql: 'c.name' },
      amount: { fa: 'مبلغ', sql: 'op.amount', agg: true },
      probability: { fa: 'احتمال', sql: 'op.probability', agg: true },
      status: { fa: 'وضعیت', sql: 'op.status' },
      expected_close_at: { fa: 'سررسید', sql: 'op.expected_close_at', date: true },
    },
  },
  tasks: {
    nameFa: 'وظایف', table: 'tasks tsk', join: 'LEFT JOIN users u ON u.id=tsk.assignee_id', alias: 'tsk.', kind: 'single',
    entity: 'task', scopeField: 'assignee_id', scopeFallback: 'created_by',
    drill: { entity: 'task', id: 'tsk.id' },
    cols: {
      title: { fa: 'عنوان', sql: 'tsk.title' }, assignee: { fa: 'مسئول', sql: 'u.full_name' },
      priority: { fa: 'اولویت', sql: 'tsk.priority' }, status: { fa: 'وضعیت', sql: 'tsk.status' },
      due_at: { fa: 'سررسید', sql: 'tsk.due_at', date: true },
      completed_at: { fa: 'تاریخ انجام', sql: 'tsk.completed_at', date: true },
    },
  },
  meetings: {
    nameFa: 'جلسات', table: 'meetings mt', join: 'LEFT JOIN customers c ON c.id=mt.customer_id', alias: 'mt.', kind: 'single',
    entity: 'meeting',
    drill: { entity: 'meeting', id: 'mt.id' },
    cols: {
      title: { fa: 'عنوان', sql: 'mt.title' }, meeting_type: { fa: 'نوع', sql: 'mt.meeting_type' },
      customer: { fa: 'مشتری', sql: 'c.name' }, status: { fa: 'وضعیت', sql: 'mt.status' },
      start_at: { fa: 'شروع', sql: 'mt.start_at', date: true },
      end_at: { fa: 'پایان', sql: 'mt.end_at', date: true },
      location: { fa: 'محل', sql: 'mt.location' },
    },
  },
  followups: {
    nameFa: 'پیگیری‌ها', table: 'followups fu', join: '', alias: 'fu.', kind: 'single',
    entity: 'followup',
    drill: { entity: 'followup', id: 'fu.id' },
    cols: {
      entity_type: { fa: 'مورد', sql: 'fu.entity_type' },
      subject: { fa: 'موضوع', sql: 'fu.subject' },
      status: { fa: 'وضعیت', sql: 'fu.status' },
      due_at: { fa: 'سررسید', sql: 'fu.due_at', date: true },
      done_at: { fa: 'انجام‌شده در', sql: 'fu.done_at', date: true },
    },
  },
  customer_contacts: {
    nameFa: 'مخاطبین', table: 'customer_contacts cct', join: 'LEFT JOIN customers c ON c.id=cct.customer_id', alias: 'cct.', kind: 'single',
    entity: 'customer',
    drill: { entity: 'customer', id: 'cct.customer_id' },
    cols: {
      name: { fa: 'نام مخاطب', sql: 'cct.name' }, customer: { fa: 'مشتری', sql: 'c.name' },
      position: { fa: 'سمت', sql: 'cct.position' }, mobile: { fa: 'موبایل', sql: 'cct.mobile' },
      phone: { fa: 'تلفن', sql: 'cct.phone' }, email: { fa: 'ایمیل', sql: 'cct.email' },
      status: { fa: 'وضعیت', sql: 'cct.status' },
      created_at: { fa: 'تاریخ ایجاد', sql: 'cct.created_at', date: true },
    },
  },
  voip_calls: {
    nameFa: 'تماس‌های تلفنی', table: 'voip_calls vc', join: 'LEFT JOIN customers c ON c.id=vc.customer_id LEFT JOIN users u ON u.id=vc.user_id', alias: 'vc.', kind: 'single',
    entity: 'voip_call',
    drill: { entity: 'voip_call', id: 'vc.id' },
    cols: {
      customer: { fa: 'مشتری', sql: 'c.name' }, agent: { fa: 'کارمند', sql: 'u.full_name' },
      direction: { fa: 'جهت', sql: 'vc.direction' }, status: { fa: 'وضعیت', sql: 'vc.status' },
      outcome_fa: { fa: 'نتیجه', sql: 'vc.outcome_fa' },
      duration_sec: { fa: 'مدت (ثانیه)', sql: 'vc.duration_sec', agg: true },
      started_at: { fa: 'تاریخ تماس', sql: 'vc.started_at', date: true },
    },
  },
  commissions: {
    nameFa: 'پورسانت‌ها', table: 'commissions cm', join: 'LEFT JOIN users u ON u.id=cm.user_id LEFT JOIN customers c ON c.id=cm.customer_id', alias: 'cm.', kind: 'single',
    entity: 'commission',
    drill: { entity: 'commission', id: 'cm.id' },
    cols: {
      user: { fa: 'کارمند', sql: 'u.full_name' }, customer: { fa: 'مشتری', sql: 'c.name' },
      period: { fa: 'دوره', sql: 'cm.period' }, basis: { fa: 'مبنای محاسبه', sql: 'cm.basis' },
      rate: { fa: 'نرخ ٪', sql: 'cm.rate', agg: true },
      base: { fa: 'مبلغ پایه', sql: 'cm.base', agg: true },
      amount: { fa: 'پورسانت', sql: 'cm.amount', agg: true },
      status: { fa: 'وضعیت', sql: 'cm.status' },
      created_at: { fa: 'تاریخ', sql: 'cm.created_at', date: true },
    },
  },
  documents: {
    nameFa: 'اسناد', table: 'documents dc', join: 'LEFT JOIN users u ON u.id=dc.user_id', alias: 'dc.', kind: 'single',
    entity: 'document',
    drill: { entity: 'document', id: 'dc.id' },
    cols: {
      title: { fa: 'عنوان', sql: 'dc.title' }, kind: { fa: 'نوع', sql: 'dc.kind' },
      category: { fa: 'دسته', sql: 'dc.category' }, user: { fa: 'مالک', sql: 'u.full_name' },
      size: { fa: 'حجم', sql: 'dc.size', agg: true },
      created_at: { fa: 'تاریخ', sql: 'dc.created_at', date: true },
    },
  },
  employees: {
    nameFa: 'عملکرد کارکنان', table: 'users u2', join: '', alias: 'u2.', kind: 'single',
    entity: 'user',
    drill: { entity: 'user', id: 'u2.id' },
    cols: {
      full_name: { fa: 'نام', sql: 'u2.full_name' }, department: { fa: 'واحد', sql: 'u2.department' },
      invoices: { fa: 'تعداد فاکتور', sql: '(SELECT COUNT(*) FROM invoices i WHERE i.created_by=u2.id)', agg: true },
      sales: { fa: 'مجموع فروش', sql: "(SELECT COALESCE(SUM(i2.total),0) FROM invoices i2 WHERE i2.created_by=u2.id AND i2.status!='cancelled')", agg: true },
      tasks_done: { fa: 'وظایف انجام‌شده', sql: "(SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u2.id AND t.status='done')", agg: true },
      open_complaints: { fa: 'شکایات باز', sql: "(SELECT COUNT(*) FROM complaints cp WHERE cp.assigned_to=u2.id AND cp.status IN ('new','in_progress','waiting'))", agg: true },
    },
  },

  // ================= combined cross-module chains =================
  customer_chain: {
    nameFa: 'زنجیرهٔ مشتری ← سفارش ← فاکتور ← پرداخت', table: 'customers c', join: '', alias: 'c.', kind: 'chain',
    entity: 'customer', scopeField: 'salesperson_id', scopeFallback: 'created_by',
    drill: { entity: 'customer', id: 'c.id' },
    cols: {
      name: { fa: 'مشتری', sql: 'c.name' },
      type: { fa: 'نوع', sql: 'c.type' },
      status: { fa: 'وضعیت مشتری', sql: 'c.status' },
      phone: { fa: 'تلفن', sql: 'c.phone' },
      city: { fa: 'شهر', sql: 'c.city' },
      created_at: { fa: 'تاریخ ایجاد', sql: 'c.created_at', date: true },
      orders_count: { fa: 'تعداد سفارش', sql: '(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.archived_at IS NULL)', agg: true },
      orders_total: { fa: 'مبلغ سفارش‌ها', sql: "(SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id=c.id AND o.archived_at IS NULL AND o.status!='cancelled')", agg: true },
      invoices_count: { fa: 'تعداد فاکتور', sql: "(SELECT COUNT(*) FROM invoices i WHERE i.customer_id=c.id AND i.archived_at IS NULL AND i.status!='cancelled')", agg: true },
      invoices_total: { fa: 'مبلغ فاکتورها', sql: "(SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.customer_id=c.id AND i.archived_at IS NULL AND i.status!='cancelled')", agg: true },
      paid_total: { fa: 'مجموع پرداختی‌ها', sql: "(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id IN (SELECT id FROM invoices WHERE customer_id=c.id AND status!='cancelled'))", agg: true },
      balance: { fa: 'ماندهٔ مطالبات', sql: "(SELECT COALESCE(SUM(i2.total),0) FROM invoices i2 WHERE i2.customer_id=c.id AND i2.archived_at IS NULL AND i2.status!='cancelled') - (SELECT COALESCE(SUM(p2.amount),0) FROM payments p2 WHERE p2.invoice_id IN (SELECT id FROM invoices WHERE customer_id=c.id AND status!='cancelled'))", agg: true },
      last_invoice_at: { fa: 'آخرین فاکتور', sql: '(SELECT MAX(i3.issue_date) FROM invoices i3 WHERE i3.customer_id=c.id AND i3.archived_at IS NULL)', date: true },
    },
  },
  invoice_chain: {
    nameFa: 'زنجیرهٔ فاکتور ← پرداخت', table: 'invoices i', join: 'LEFT JOIN customers c ON c.id=i.customer_id', alias: 'i.', kind: 'chain',
    entity: 'invoice', scopeField: 'created_by',
    drill: { entity: 'invoice', id: 'i.id' },
    cols: {
      number: { fa: 'شماره فاکتور', sql: 'i.number' },
      customer: { fa: 'مشتری', sql: 'c.name' },
      order_number: { fa: 'سفارش مبدا', sql: '(SELECT number FROM orders WHERE id=i.order_id)' },
      issue_date: { fa: 'تاریخ صدور', sql: 'i.issue_date', date: true },
      due_date: { fa: 'سررسید', sql: 'i.due_date', date: true },
      status: { fa: 'وضعیت', sql: 'i.status' },
      total: { fa: 'مبلغ کل', sql: 'i.total', agg: true },
      paid_amount: { fa: 'پرداخت‌شده', sql: 'i.paid_amount', agg: true },
      balance: { fa: 'مانده', sql: 'COALESCE(i.total,0) - COALESCE(i.paid_amount,0)', agg: true },
      payments_count: { fa: 'تعداد پرداخت', sql: '(SELECT COUNT(*) FROM payments p WHERE p.invoice_id=i.id)', agg: true },
      last_payment_at: { fa: 'آخرین پرداخت', sql: '(SELECT MAX(p2.paid_at) FROM payments p2 WHERE p2.invoice_id=i.id)', date: true },
    },
  },
  order_chain: {
    nameFa: 'زنجیرهٔ سفارش ← فاکتور', table: 'orders o', join: 'LEFT JOIN customers c ON c.id=o.customer_id', alias: 'o.', kind: 'chain',
    entity: 'order', scopeField: 'salesperson_id', scopeFallback: 'created_by',
    drill: { entity: 'order', id: 'o.id' },
    cols: {
      number: { fa: 'شماره سفارش', sql: 'o.number' },
      customer: { fa: 'مشتری', sql: 'c.name' },
      order_date: { fa: 'تاریخ سفارش', sql: 'o.order_date', date: true },
      due_date: { fa: 'تحویل', sql: 'o.due_date', date: true },
      status: { fa: 'وضعیت', sql: 'o.status' },
      total: { fa: 'مبلغ سفارش', sql: 'o.total', agg: true },
      invoiced: { fa: 'مبلغ فاکتورشده', sql: "(SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.order_id=o.id AND i.status!='cancelled')", agg: true },
      remaining: { fa: 'باقیمانده', sql: "COALESCE(o.total,0) - (SELECT COALESCE(SUM(i2.total),0) FROM invoices i2 WHERE i2.order_id=o.id AND i2.status!='cancelled')", agg: true },
      invoiced_count: { fa: 'تعداد فاکتور', sql: '(SELECT COUNT(*) FROM invoices i3 WHERE i3.order_id=o.id)', agg: true },
    },
  },
};
function sourceMeta() {
  const out = {};
  for (const [k, s] of Object.entries(SOURCES)) {
    out[k] = {
      nameFa: s.nameFa, kind: s.kind || 'single', entity: s.entity || null,
      cols: Object.fromEntries(Object.entries(s.cols).map(([ck, cv]) => [ck, { fa: cv.fa, agg: !!cv.agg, date: !!cv.date }])),
    };
  }
  return out;
}
function src(key) {
  const s = SOURCES[key];
  if (!s) throw new HttpError(400, 'BAD_SOURCE', 'منبع گزارش نامعتبر است.');
  return s;
}
// Build WHERE from nested filter tree:
// group = { op: 'AND'|'OR'|'NOT', conditions: [cond|group] }
// cond  = { field, op, value, value2 }
function buildWhere(srcDef, node, params) {
  if (!node) return { sql: '', params: [] };
  if (node.field !== undefined) {
    const colDef = srcDef.cols[node.field];
    if (!colDef) return { sql: '', params: [] };
    const colExpr = colDef.sql.startsWith('(') || colDef.sql.includes('.') ? colDef.sql : (srcDef.alias ? srcDef.alias + colDef.sql : colDef.sql);
    const params2 = [];
    let sql;
    switch (node.op) {
      case 'neq': sql = `(${colExpr} IS NOT ? AND ${colExpr} <> ?)`; params2.push(null, node.value); break;
      case 'contains': sql = `${colExpr} LIKE ?`; params2.push('%' + String(node.value ?? '') + '%'); break;
      case 'not_contains': sql = `${colExpr} NOT LIKE ?`; params2.push('%' + String(node.value ?? '') + '%'); break;
      case 'gt': sql = `${colExpr} > ?`; params2.push(Number(node.value)); break;
      case 'gte': sql = `${colExpr} >= ?`; params2.push(Number(node.value)); break;
      case 'lt': sql = `${colExpr} < ?`; params2.push(Number(node.value)); break;
      case 'lte': sql = `${colExpr} <= ?`; params2.push(Number(node.value)); break;
      case 'between': sql = `${colExpr} BETWEEN ? AND ?`; params2.push(node.value, node.value2); break;
      case 'is_null': sql = `(${colExpr} IS NULL OR ${colExpr} = '')`; break;
      case 'is_not_null': sql = `(${colExpr} IS NOT NULL AND ${colExpr} <> '')`; break;
      case 'eq':
      default: sql = `${colExpr} = ?`; params2.push(node.value); break;
    }
    return { sql, params: params2 };
  }
  const conds = node.conditions || [];
  const built = conds.map(c => buildWhere(srcDef, c, params));
  const valid = built.filter(b => b.sql);
  if (node.op === 'NOT') {
    if (!valid.length) return { sql: '', params: [] };
    return { sql: `NOT (${valid.map(b => b.sql).join(' AND ')})`, params: valid.flatMap(b => b.params) };
  }
  if (!valid.length) return { sql: '', params: [] };
  const joiner = node.op === 'OR' ? ' OR ' : ' AND ';
  return { sql: `(${valid.map(b => b.sql).join(joiner)})`, params: valid.flatMap(b => b.params) };
}
function colExpr(srcDef, key) {
  const cd = srcDef.cols[key];
  if (!cd) return null;
  return cd.sql.startsWith('(') || cd.sql.includes('.') ? cd.sql : (srcDef.alias ? srcDef.alias + key : cd.sql);
}
const _archCache = {};
function baseTable(srcDef) { return srcDef.table.split(/\s+/)[0].replace(/["']/g, ''); }
function hasArchived(srcDef) {
  const base = baseTable(srcDef);
  if (!(base in _archCache)) {
    try { _archCache[base] = get().prepare(`PRAGMA table_info(${base})`).all().some(c => c.name === 'archived_at'); }
    catch { _archCache[base] = false; }
  }
  return _archCache[base];
}
function hasCol(base, name) {
  try { return get().prepare(`PRAGMA table_info(${base})`).all().some(c => c.name === name); }
  catch { return false; }
}
// permissions + row scope (Section 7): caller must hold <entity>:view and
// sees only rows inside that user's scope for the source entity.
function applyEntityScope(srcDef, user, where, params) {
  if (!user || !srcDef.entity) return;
  const scope = requirePerm(user, srcDef.entity, 'view');
  if (scope === 'all') return;
  const field = srcDef.scopeField || srcDef.scopeFallback || null;
  if (!field) return;
  if (!hasCol(baseTable(srcDef), field)) return;
  const qual = srcDef.alias ? srcDef.alias + field : field;
  const sc = scopeWhere(srcDef.entity, user, scope, qual);
  if (sc.where) { where.push(sc.where); params.push(...sc.params); }
}
function run(definition, limit = 500, user = null) {
  const srcDef = src(definition.source);
  // default: all columns of the source (builder always sends explicit columns)
  const columns = (definition.columns && definition.columns.length ? definition.columns : Object.keys(srcDef.cols)).filter(c => srcDef.cols[c]);
  if (!columns.length) throw new HttpError(400, 'BAD_COLUMNS', 'ستونی برای گزارش انتخاب نشده است.');
  const params = [];
  const where = [];
  if (hasArchived(srcDef)) where.push((srcDef.alias || '') + 'archived_at IS NULL');
  if (user) applyEntityScope(srcDef, user, where, params);
  const w = buildWhere(srcDef, definition.filters || { op: 'AND', conditions: [] }, params);
  if (w.sql) { where.push(w.sql); params.push(...w.params); }
  // free-text search over the selected columns (normalized like list search)
  if (definition.q !== undefined && definition.q !== null && String(definition.q).trim() !== '') {
    const term = '%' + likeEscape(normalizeFa(String(definition.q).trim().replace(/\s+/g, ' '))) + '%';
    const ors = [];
    for (const c of columns) {
      const ce = colExpr(srcDef, c);
      if (!ce) continue;
      ors.push(`${ce} LIKE ?`);
      params.push(term);
    }
    if (ors.length) { where.push('(' + ors.join(' OR ') + ')'); }
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const aggMode = !!definition.group_by && srcDef.cols[definition.group_by];
  let selectCols, groupSql = '', orderSql = '';
  const limitSql = aggMode ? '' : ` LIMIT ${Math.min(limit || 500, 2000)}`;
  if (aggMode) {
    const gb = colExpr(srcDef, definition.group_by);
    const aggFn = definition.group_agg || 'count';
    const metric = columns.find(c => c !== definition.group_by && srcDef.cols[c].agg);
    const aggExpr = (aggFn === 'count') ? 'COUNT(*)' : (metric ? aggFn.toUpperCase() + '(' + colExpr(srcDef, metric) + ')' : 'COUNT(*)');
    selectCols = [gb + ' _group', aggExpr + ' _agg'];
    selectCols.push(...columns.filter(c => c !== definition.group_by).map(c => {
      const ce = colExpr(srcDef, c);
      if (!ce) return null;
      const agg = srcDef.cols[c].agg ? aggFn.toUpperCase() + '(' + ce + ')' : null;
      return agg ? agg + ' ' + c : null;
    }).filter(Boolean));
    groupSql = ` GROUP BY ${gb}`;
    orderSql = ' ORDER BY _agg DESC';
  } else {
    selectCols = columns.map(c => { const ce = colExpr(srcDef, c); return ce ? ce + ' ' + c : null; }).filter(Boolean);
    if (srcDef.drill) selectCols.push(srcDef.drill.id + ' _drill_id');
    if (definition.sort && srcDef.cols[definition.sort]) {
      const ce = colExpr(srcDef, definition.sort);
      orderSql = ' ORDER BY ' + ce + (definition.sort_dir === 'asc' ? ' ASC' : ' DESC');
    } else {
      const idExpr = srcDef.alias ? srcDef.alias + 'id' : 'id';
      orderSql = ` ORDER BY ${idExpr} DESC`;
    }
  }
  const sql = `SELECT ${selectCols.join(', ')} FROM ${srcDef.table} ${srcDef.join}${whereSql}${groupSql}${orderSql}${limitSql}`;
  let rows;
  try { rows = d_run(sql, params); } catch (e) { throw new Error('خطای کوئری: ' + e.message); }
  // drill-down metadata: point each row at its real source record
  if (!aggMode && srcDef.drill) {
    rows = rows.map(r => {
      const o = { ...r };
      o._drill = o._drill_id ? { entity: srcDef.drill.entity, id: o._drill_id } : null;
      delete o._drill_id;
      return o;
    });
  }
  // grand total (agg mode)
  let grandTotal = null;
  if (aggMode) {
    const gb = colExpr(srcDef, definition.group_by);
    const aggFn = definition.group_agg || 'count';
    const metric = columns.find(c => c !== definition.group_by && srcDef.cols[c].agg);
    const aggExpr = (aggFn === 'count') ? 'COUNT(*)' : (metric ? aggFn.toUpperCase() + '(' + colExpr(srcDef, metric) + ')' : 'COUNT(*)');
    const gt = d_run(`SELECT COUNT(*) _cnt, ${aggExpr} _agg FROM ${srcDef.table} ${srcDef.join}${whereSql}`, params);
    grandTotal = { count: gt[0]._cnt, agg: gt[0]._agg };
  }
  // subtotals: sum of each group agg
  let subtotals = null;
  if (aggMode && grandTotal) subtotals = { total: grandTotal.agg, groups: rows.length };
  return { source: definition.source, sourceFa: srcDef.nameFa, columns, aggMode, group_by: definition.group_by || null, group_agg: definition.group_agg || null, rows, grandTotal, subtotals, where: whereSql, sql };
}
function d_run(sql, params) { try { return get().prepare(sql).all(...params); } catch (e) { throw e; } }
function chartData(result) {
  if (result.aggMode) {
    return result.rows.map(r => ({ label: String(r._group ?? ''), value: Number(r._agg ?? 0) }));
  }
  const col = result.columns[0];
  const counts = {};
  for (const r of result.rows) { const k = String(r[col] ?? ''); counts[k] = (counts[k] || 0) + 1; }
  return Object.entries(counts).map(([label, value]) => ({ label, value }));
}
module.exports = { SOURCES, sourceMeta, run, chartData, buildWhere, colExpr };
