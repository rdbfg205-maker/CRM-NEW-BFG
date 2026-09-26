'use strict';
// AI report assistant: natural language -> safe query -> REAL data (with failover).
const { get } = require('../../db/db');
const engine = require('../../core/report-engine');
const gw = require('../../core/ai-gateway');
const { fmtNum, faDigits } = require('../../lib/util');

function normalizeFa(s) { return String(s || '').replace(/[يی]/g, 'ی').replace(/[كك]/g, 'ک').replace(/[أإآ]/g, 'ا').toLowerCase(); }
function parseReportQuery(query) {
  const q = normalizeFa(query);
  let source = 'sales';
  if (/شکایت/.test(q)) source = 'complaints';
  else if (/سرنخ|لید/.test(q)) source = 'leads';
  else if (/فرصت/.test(q)) source = 'opportunities';
  else if (/سفارش/.test(q)) source = 'orders';
  else if (/موجودی|کالا|انبار/.test(q)) source = 'stock';
  else if (/کارکنان|نفرات|عملکرد/.test(q)) source = 'employees';
  else if (/آزمایش/.test(q)) source = 'lab';
  else if (/فروش|فاکتور/.test(q)) source = 'sales';
  else if (/مشتری/.test(q)) source = 'customers';
  const conditions = [];
  const statusField = { sales: 'status', complaints: 'status', orders: 'status', leads: 'status', opportunities: 'status', customers: 'status', employees: 'department', lab: 'status' }[source];
  const statusMap = { 'باز': 'open', 'بسته': 'closed', 'در حال': 'in_progress', active: 'active', open: 'open', closed: 'closed', resolved: 'resolved', in_progress: 'in_progress' };
  const mStatus = q.match(/\b(باز|بسته|در حال|active|open|closed|resolved|in_progress)\b/);
  if (mStatus && statusField && statusMap[mStatus[1]]) conditions.push({ field: statusField, op: 'eq', value: statusMap[mStatus[1]] });
  const mPrio = q.match(/\b(بحرانی|زیاد|متوسط|کم)\b/);
  if (mPrio && source === 'complaints') conditions.push({ field: 'priority', op: 'eq', value: { 'بحرانی': 'critical', 'زیاد': 'high', 'متوسط': 'medium', 'کم': 'low' }[mPrio[1]] });
  if (/(تأخیر|سررسید|SLA)/i.test(q) && source === 'complaints') conditions.push({ field: 'status', op: 'eq', value: 'open' });
  const filters = { op: 'AND', conditions };
  let group_by = '', group_agg = 'count';
  if (/میانگین/.test(q)) group_agg = 'avg';
  else if (/حداکثر/.test(q)) group_agg = 'max';
  else if (/حداقل/.test(q)) group_agg = 'min';
  else if (/جمع|مجموع/.test(q)) group_agg = 'sum';
  if (/گروه|دسته|طبق|به تفکیک|تعداد|جمع|مجموع|میانگین/.test(q)) group_by = { sales: 'status', complaints: 'category', orders: 'status', leads: 'source', opportunities: 'status', stock: 'code', customers: 'city', employees: 'department', lab: 'status' }[source] || '';
  const columns = group_by ? [group_by] : Object.keys(engine.SOURCES[source].cols).slice(0, 5);
  return { definition: { source, columns, filters, group_by, group_agg, sort: group_by || '', sort_dir: 'desc' }, source, group_by, group_agg };
}
function runParsed(parsed, limit = 100) {
  const r = engine.run(parsed.definition, limit);
  const fa = (n) => faDigits(n);
  const lines = ['گزارش «' + engine.SOURCES[parsed.definition.source].nameFa + '» (دادهٔ واقعی سیستم):'];
  for (const row of r.rows.slice(0, 20)) lines.push((Array.isArray(row) ? row : Object.values(row)).join(' | '));
  if (r.rows.length > 20) lines.push('... و ' + fa(r.rows.length - 20) + ' ردیف دیگر');
  if (r.grandTotal) lines.push('جمع کل: ' + fmtNum(r.grandTotal.agg));
  const chart = engine.chartData(r);
  return { text: lines.join('\n'), rows: r.rows, chart, grandTotal: r.grandTotal };
}
async function reportAssistant(user, query) {
  if (!gw.moduleEnabled('reporting')) return { text: 'هوش مصنوعی برای گزارش‌گیری غیرفعال است.', source: 'disabled' };
  const parsed = parseReportQuery(query);
  const builtin = () => runParsed(parsed).text;
  const sys = 'تو دستیار گزارش‌گیری CRM بسپار فوم غرب هستی. فقط بر اساس دادهٔ واقعی پاسخ بده. اگر داده کافی نیست بگو «اطلاعات کافی نیست». به فارسی و ساختاریافته پاسخ بده.';
  const builtinText = builtin();
  const messages = [{ role: 'user', content: 'درخواست گزارش:\n' + query + '\n\nتفسیر:\n' + JSON.stringify(parsed.definition) + '\n\nدادهٔ واقعی استخراج‌شده:\n' + builtinText + '\n\nاین داده را به فارسی خلاصه و ساختاریافته تحلیل کن.' }];
  return await gw.ask(user, 'reporting', 'report_assistant', messages, sys, builtin);
}
module.exports = { reportAssistant, parseReportQuery, runParsed };
