'use strict';
const XLSX = require('xlsx');
const { get } = require('../../db/db');
const { nowIso, fmtDateLong, fmtNum, faDigits, jalExport } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const engine = require('../../ai/engine');

// Report sources with their column definitions
const SOURCES = {
  sales: { nameFa: 'فروش (فاکتورها)', table: 'invoices i', join: `LEFT JOIN customers c ON c.id=i.customer_id`, whereAlias: 'i.', cols: {
    number: { fa: 'شماره', sql: 'i.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
    issue_date: { fa: 'تاریخ صدور', sql: 'i.issue_date' }, due_date: { fa: 'سررسید', sql: 'i.due_date' },
    subtotal: { fa: 'جمع خالص', sql: 'i.subtotal' }, tax: { fa: 'مالیات', sql: 'i.tax' },
    total: { fa: 'مبلغ کل', sql: 'i.total' }, paid_amount: { fa: 'پرداختی', sql: 'i.paid_amount' },
    status: { fa: 'وضعیت', sql: 'i.status' },
  } },
  orders: { nameFa: 'سفارش‌ها', table: 'orders o', join: `LEFT JOIN customers c ON c.id=o.customer_id`, whereAlias: 'o.', cols: {
    number: { fa: 'شماره', sql: 'o.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
    status: { fa: 'وضعیت', sql: 'o.status' }, order_date: { fa: 'تاریخ', sql: 'o.order_date' },
    due_date: { fa: 'تحویل', sql: 'o.due_date' }, total: { fa: 'مبلغ', sql: 'o.total' },
  } },
  customers: { nameFa: 'مشتریان', table: 'customers', join: '', cols: {
    number: { fa: 'کد', sql: 'number' }, name: { fa: 'نام', sql: 'name' }, type: { fa: 'نوع', sql: 'type' },
    category: { fa: 'دسته', sql: '(SELECT name FROM customer_categories WHERE id=customers.category_id)' },
    phone: { fa: 'تلفن', sql: 'phone' }, city: { fa: 'شهر', sql: 'city' },
    credit_limit: { fa: 'سقف اعتبار', sql: 'credit_limit' }, status: { fa: 'وضعیت', sql: 'status' },
    churn_score: { fa: 'ریسک ریزش', sql: 'churn_score' },
    total_spent: { fa: 'مجموع خرید', sql: '(SELECT COALESCE(SUM(total),0) FROM invoices WHERE customer_id=customers.id AND status!=\'cancelled\')' },
  } },
  orders_items: { nameFa: 'ردیف‌های سفارش', table: 'order_items oi', join: `JOIN orders o ON o.id=oi.order_id LEFT JOIN customers c ON c.id=o.customer_id`, whereAlias: 'oi.', cols: {
    order: { fa: 'سفارش', sql: 'o.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
    name: { fa: 'محصول', sql: 'oi.name' }, qty: { fa: 'تعداد', sql: 'oi.qty' },
    price: { fa: 'قیمت', sql: 'oi.price' }, line_total: { fa: 'جمع ردیف', sql: 'oi.line_total' }, status: { fa: 'وضعیت', sql: 'o.status' },
  } },
  inventory: { nameFa: 'گردش موجودی', table: 'stock_transactions st', join: `LEFT JOIN products p ON p.id=st.product_id`, whereAlias: 'st.', cols: {
    product: { fa: 'کالا', sql: 'p.name' }, type: { fa: 'نوع', sql: 'st.type' }, qty: { fa: 'مقدار', sql: 'st.qty' },
    note: { fa: 'توضیح', sql: 'st.note' }, created_at: { fa: 'تاریخ', sql: 'st.created_at' },
  } },
  stock: { nameFa: 'موجودی فعلی', table: 'products', join: '', cols: {
    code: { fa: 'کد', sql: 'code' }, name: { fa: 'نام', sql: 'name' }, unit: { fa: 'واحد', sql: 'unit' },
    stock_qty: { fa: 'موجودی', sql: 'stock_qty' }, reorder_point: { fa: 'حد سفارش', sql: 'reorder_point' },
    price_cost: { fa: 'قیمت تمام‌شده', sql: 'price_cost' },
    value: { fa: 'ارزش موجودی', sql: '(stock_qty * COALESCE(price_cost,0))' },
  } },
  complaints: { nameFa: 'شکایات', table: 'complaints cp', join: `LEFT JOIN customers c ON c.id=cp.customer_id`, whereAlias: 'cp.', cols: {
    number: { fa: 'شماره', sql: 'cp.number' }, customer: { fa: 'مشتری', sql: 'c.name' },
    subject: { fa: 'موضوع', sql: 'cp.subject' }, category: { fa: 'دسته', sql: 'cp.category' },
    priority: { fa: 'اولویت', sql: 'cp.priority' }, status: { fa: 'وضعیت', sql: 'cp.status' },
    created_at: { fa: 'تاریخ', sql: 'cp.created_at' }, due_at: { fa: 'سررسید SLA', sql: 'cp.due_at' },
  } },
  leads: { nameFa: 'سرنخ‌ها', table: 'leads', join: '', cols: {
    number: { fa: 'کد', sql: 'number' }, company: { fa: 'شرکت', sql: 'company' }, source: { fa: 'منبع', sql: 'source' },
    estimated_value: { fa: 'ارزش', sql: 'estimated_value' }, status: { fa: 'وضعیت', sql: 'status' },
    score: { fa: 'امتیاز AI', sql: 'score' }, next_followup_at: { fa: 'پیگیری', sql: 'next_followup_at' }, created_at: { fa: 'تاریخ', sql: 'created_at' },
  } },
  opportunities: { nameFa: 'فرصت‌های فروش', table: 'opportunities op', join: `LEFT JOIN customers c ON c.id=op.customer_id`, whereAlias: 'op.', cols: {
    number: { fa: 'کد', sql: 'op.number' }, title: { fa: 'عنوان', sql: 'op.title' }, customer: { fa: 'مشتری', sql: 'c.name' },
    amount: { fa: 'مبلغ', sql: 'op.amount' }, probability: { fa: 'احتمال', sql: 'op.probability' },
    status: { fa: 'وضعیت', sql: 'op.status' }, expected_close_at: { fa: 'سررسید', sql: 'op.expected_close_at' },
  } },
  employees: { nameFa: 'عملکرد کارکنان', table: 'users', join: '', cols: {
    full_name: { fa: 'نام', sql: 'full_name' }, department: { fa: 'واحد', sql: 'department' },
    invoices: { fa: 'فاکتورها', sql: "(SELECT COUNT(*) FROM invoices i WHERE i.created_by=users.id)" },
    sales: { fa: 'مجموع فروش', sql: "(SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.created_by=users.id AND i.status!='cancelled')" },
    tasks_done: { fa: 'وظایف انجام‌شده', sql: "(SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=users.id AND t.status='done')" },
    open_complaints: { fa: 'شکایات باز', sql: "(SELECT COUNT(*) FROM complaints cp WHERE cp.assigned_to=users.id AND cp.status IN ('new','in_progress','waiting'))" },
  } },
};
function runReport(definition) {
  const src = SOURCES[definition.source];
  if (!src) throw new HttpError(400, 'BAD_SOURCE', 'منبع گزارش نامعتبر است.');
  const cols = (definition.columns && definition.columns.length ? definition.columns : Object.keys(src.cols)).filter(c => src.cols[c]);
  if (!cols.length) throw new HttpError(400, 'BAD_COLUMNS', 'هیچ ستون معتبری برای این منبع انتخاب نشده است.');
  const d = get();
  // Only filter out archived rows when the base table actually has that column.
  // order_items / stock_transactions / complaints have no archived_at, so the
  // unconditional predicate used to raise "no such column: archived_at" → HTTP 500.
  const baseTable = String(src.table).trim().split(/\s+/)[0];
  const alias = (src.whereAlias || '').replace(/\.$/, '');
  const hasArch = d.prepare(`PRAGMA table_info(${baseTable})`).all().some(c => c.name === 'archived_at');
  const where = hasArch ? [(alias ? alias + '.' : '') + 'archived_at IS NULL'] : [];
  const params = [];
  const f = definition.filters || {};
  for (const [k, v] of Object.entries(f)) {
    if (!src.cols[k] || v === '' || v === null || v === undefined) continue;
    if (src.cols[k].sql.includes('SELECT')) continue; // skip subqueries
    if (typeof v === 'object' && v.__from) { where.push(`${src.cols[k].sql} >= ?`); params.push(v.__from); }
    else if (typeof v === 'object' && v.__to) { where.push(`${src.cols[k].sql} <= ?`); params.push(v.__to); }
    else { where.push(`${src.cols[k].sql} LIKE ?`); params.push('%' + v + '%'); }
  }
  let groupSql = '';
  if (definition.group_by && src.cols[definition.group_by]) {
    groupSql = 'GROUP BY ' + src.cols[definition.group_by].sql;
    // aggregate numeric columns
    const gCols = cols.map(c => {
      if (c === definition.group_by) return src.cols[c].sql + ' "' + c + '"';
      const isDate = /date|_at/.test(c);
      if (!isDate) return `COALESCE(SUM(CAST(COALESCE(${src.cols[c].sql},0) AS REAL)),0) "${c}"`;
      return src.cols[c].sql + ' "' + c + '"';
    });
    const sql = `SELECT ${gCols.join(',')} FROM ${src.table} ${src.join}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ${groupSql} ORDER BY ${definition.sort && src.cols[definition.sort] ? src.cols[definition.sort].sql + ' ' + (definition.sort_dir || 'DESC') : (alias ? alias + '.' : '') + 'id DESC'}`;
    const rows = d.prepare(sql).all(...params);
    return { source: definition.source, columns: cols, rows: limitRows(rows) };
  }
  const sel = cols.map(c => src.cols[c].sql + ' "' + c + '"').join(',');
  const sql = `SELECT ${sel} FROM ${src.table} ${src.join}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${definition.sort && src.cols[definition.sort] ? src.cols[definition.sort].sql + ' ' + (definition.sort_dir || 'ASC') : (alias ? alias + '.' : '') + 'id DESC'} LIMIT 5000`;
  const rows = d.prepare(sql).all(...params);
  return { source: definition.source, columns: cols, rows: limitRows(rows) };
}
function limitRows(rows) {
  return rows.map(r => {
    const o = {};
    for (const k of Object.keys(r)) {
      let v = r[k];
      if (typeof v === 'number') v = Math.round(v * 100) / 100;
      o[k] = v;
    }
    return o;
  });
}
function exportReport(definition, format) {
  const res = runReport(definition);
  const src = SOURCES[definition.source];
  const head = res.columns.map(c => src.cols[c].fa);
  const rows = res.rows.map(r => res.columns.map(c => jalExport(r[c] ?? '')));
  if (format === 'csv') {
    let csv = '\uFEFF' + [head, ...rows].map(row => row.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    return { type: 'csv', data: csv, fileName: src.nameFa + '.csv' };
  }
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws['!cols'] = head.map(h => ({ wch: Math.max(10, h.length + 6) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, src.nameFa.slice(0, 30));
  return { type: 'xlsx', data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), fileName: src.nameFa + '.xlsx' };
}
function autoReport(kind, periodStart, periodEnd, user) {
  const d = get();
  const data = { kind };
  const from = periodStart, to = periodEnd;
  const q = (s, ...p) => d.prepare(s).get(...p);
  data.sales = q(`SELECT COALESCE(SUM(total),0) total, COUNT(*) c FROM invoices WHERE status IN ('unpaid','partial','paid','overdue') AND issue_date>=? AND issue_date<=?`, from, to);
  data.payments = q(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM payments WHERE paid_at>=? AND paid_at<=?`, from, to);
  data.customersNew = q(`SELECT COUNT(*) c FROM customers WHERE created_at>=? AND created_at<=?`, from, to).c;
  data.leadsNew = q(`SELECT COUNT(*) c FROM leads WHERE created_at>=? AND created_at<=?`, from, to).c;
  data.oppsWon = q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) v FROM opportunities WHERE status='won' AND won_at IS NOT NULL AND won_at>=? AND won_at<=?`, from, to);
  data.complaintsNew = q(`SELECT COUNT(*) c FROM complaints WHERE created_at>=? AND created_at<=?`, from, to).c;
  data.complaintsResolved = q(`SELECT COUNT(*) c FROM complaints WHERE status IN ('resolved','closed') AND resolved_at>=? AND resolved_at<=?`, from, to).c;
  data.lowStock = q(`SELECT COUNT(*) c FROM stock_alerts WHERE resolved_at IS NULL`).c;
  data.receivables = q(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE status IN ('unpaid','partial','overdue')`).s;
  data.topCustomers = d.prepare(`SELECT c.name, COALESCE(SUM(i.total),0) s FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? GROUP BY c.id ORDER BY s DESC LIMIT 5`).all(from, to);
  data.topProducts = d.prepare(`SELECT ii.name, COALESCE(SUM(ii.line_total),0) s FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? GROUP BY ii.name ORDER BY s DESC LIMIT 5`).all(from, to);
  // AI analysis (local engine)
  const parts = [];
  parts.push(`فروش ${kind === 'daily' ? 'روزانه' : kind === 'weekly' ? 'هفتگی' : 'ماهانه'}: ${fmtNum(data.sales.total)} ریال در ${faDigits(data.sales.c)} فاکتور.`);
  if (data.payments.s) parts.push(`وصول مطالبات: ${fmtNum(data.payments.s)} ریال در ${faDigits(data.payments.c)} پرداخت.`);
  if (data.customersNew) parts.push(`${faDigits(data.customersNew)} مشتری جدید ثبت شد.`);
  if (data.leadsNew) parts.push(`${faDigits(data.leadsNew)} سرنخ جدید.`);
  if (data.oppsWon.c) parts.push(`${faDigits(data.oppsWon.c)} فرصت فروش موفق شد (${fmtNum(data.oppsWon.v)} ریال).`);
  if (data.complaintsNew) parts.push(`${faDigits(data.complaintsNew)} شکایت جدید ثبت شد.`);
  if (data.complaintsResolved) parts.push(`${faDigits(data.complaintsResolved)} شکایت حل شد.`);
  if (data.topCustomers.length) parts.push('مشتریان برتر: ' + data.topCustomers.slice(0, 3).map(x => x.name).join('، ') + '.');
  if (data.lowStock) parts.push(`هشدار: ${faDigits(data.lowStock)} کالا در وضعیت کمبود است.`);
  if (data.receivables > 0) parts.push(`مطالبات باز فعلی: ${fmtNum(data.receivables)} ریال — پیشنهاد: اولویت با وصول فاکتورهای سررسیدگذشته است.`);
  data.ai_analysis = parts.join(' ');
  const info = d.prepare('INSERT INTO report_instances(kind, period_start, period_end, title, data, ai_analysis, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(kind, from, to, `گزارش ${kind === 'daily' ? 'روزانه' : kind === 'weekly' ? 'هفتگی' : 'ماهانه'} — بسپار فوم غرب`, JSON.stringify(data), parts.join(' '), user ? user.id : 0, nowIso());
  return Number(info.lastInsertRowid);
}
module.exports = { SOURCES, runReport, exportReport, autoReport };
