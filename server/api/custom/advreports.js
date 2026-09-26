'use strict';
// Advanced Reporting module API: sources, run, export (xlsx/csv/json/doc/html), templates, charts.
const XLSX = require('xlsx');
const { get } = require('../../db/db');
const { nowIso, fmtNum, fmtDateLong, faDigits, jalExport } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { requirePerm, requireUser } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const engine = require('../../core/report-engine');

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function listSources(user) {
  requirePerm(user, 'report_definition', 'view');
  return { sources: engine.sourceMeta() };
}
function runReport(user, definition) {
  requirePerm(user, 'report_definition', 'view');
  // user is passed so the engine enforces <source entity>:view + row scope
  const result = engine.run(definition, 500, user);
  const chart = engine.chartData(result);
  const headers = buildHeaders(result);
  // keep result.rows as engine object rows (exportReport re-maps them); flattened arrays are exposed separately
  return { ...result, chart, headers, table_rows: buildRows(result), export_rows: buildExportRows(result) };
}
function buildHeaders(result) {
  const srcDef = engine.SOURCES[result.source];
  if (result.aggMode) {
    const h = [srcDef.cols[result.group_by].fa];
    const agg = result.group_agg || 'count';
    h.push(aggWord(agg) + srcDef.cols[result.group_by].fa);
    for (const c of result.columns.filter(c => c !== result.group_by)) h.push(aggWord(agg) + srcDef.cols[c].fa);
    return h;
  }
  return result.columns.map(c => srcDef.cols[c].fa);
}
function aggWord(agg) { return agg === 'sum' ? 'جمع ' : agg === 'avg' ? 'میانگین ' : agg === 'min' ? 'حداقل ' : agg === 'max' ? 'حداکثر ' : 'تعداد '; }
function buildRows(result) {
  if (result.aggMode) return result.rows.map(r => [r._group, r._agg, ...result.columns.filter(c => c !== result.group_by).map(c => r[c])]);
  return result.rows.map(r => result.columns.map(c => r[c]));
}
function buildExportRows(result) {
  const rows = buildRows(result);
  if (result.aggMode && result.grandTotal) rows.push(['جمع کل', result.grandTotal.agg, ...result.columns.filter(c => c !== result.group_by).map(() => '')]);
  return rows;
}
function exportReport(user, definition, format, template) {
  requirePerm(user, 'report_definition', 'export');
  const result = runReport(user, definition);
  const tpl = template || {};
  const srcFa = engine.SOURCES[definition.source].nameFa;
  const title = definition.name || (srcFa + ' — گزارش');
  const dateFa = fmtDateLong(new Date().toISOString());
  const reportNo = 'RPT-' + String(Date.now()).slice(-8);
  const headers = buildHeaders(result);
  const dataRows = buildExportRows(result).map(r => r.map(c => jalExport(c)));
  if (format === 'json') return { type: 'json', data: JSON.stringify({ report: { title, date: dateFa, number: reportNo, source: srcFa, columns: headers, rows: dataRows }, template: tpl }, null, 2), fileName: title + '.json' };
  if (format === 'csv') {
    const csv = '\uFEFF' + [headers, ...dataRows].map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    return { type: 'csv', data: csv, fileName: title + '.csv' };
  }
  if (format === 'xlsx') {
    const aoa = buildAoa(headers, dataRows, title, dateFa, reportNo, srcFa, tpl);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, srcFa.slice(0, 28));
    return { type: 'xlsx', data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), fileName: title + '.xlsx' };
  }
  if (format === 'doc' || format === 'html') {
    return { type: format, data: '\uFEFF' + reportHtml(title, dateFa, reportNo, srcFa, headers, dataRows, tpl), fileName: title + (format === 'doc' ? '.doc' : '.html') };
  }
  if (format === 'pdf') {
    // printable page (print-to-PDF), same convention as the other print reports:
    // company header, Jalali dates (dataRows are jalExport-ed), @page rules
    const printMod = require('../../lib/print');
    const co = printMod.company();
    const rowsHtml = dataRows.map(r => '<tr>' + r.map(c => '<td>' + esc(typeof c === 'number' ? c.toLocaleString('fa-IR') : c) + '</td>').join('') + '</tr>').join('');
    const body = `
  ${printMod.companyHeadHtml(co)}
  <h1>${esc(title)}</h1>
  <div class="meta">
    <div><b>منبع:</b><span>${esc(srcFa)}</span></div>
    <div><b>تاریخ تهیه:</b><span>${esc(dateFa)}</span></div>
    <div><b>شماره گزارش:</b><span>${esc(reportNo)}</span></div>
    <div><b>تهیه‌کننده:</b><span>${esc(user.full_name || '')}</span></div>
  </div>
  <table class="items"><thead><tr>${headers.map(h => '<th>' + esc(h) + '</th>').join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>
  <div class="footer"><div class="sign"><div class="line"></div>تهیه‌کننده</div><div style="text-align:center">صفحه ۱ از </div><div class="sign"><div class="line"></div>تأیید مدیریت</div></div>`;
    return { type: 'html', data: printMod.baseHtml(title, body, co), fileName: title + '.html' };
  }
  throw new HttpError(400, 'BAD_FORMAT', 'فرمت خروجی نامعتبر است.');
}
function buildAoa(headers, dataRows, title, dateFa, reportNo, srcFa, tpl) {
  const aoa = [];
  if (tpl.header !== false) { aoa.push(['گزارش: ' + title]); aoa.push(['منبع: ' + srcFa]); aoa.push(['تاریخ: ' + dateFa]); aoa.push(['شماره گزارش: ' + reportNo]); aoa.push([]); }
  aoa.push(headers);
  aoa.push(...dataRows);
  if (tpl.footer !== false) aoa.push([], ['تولیدشده توسط CRM هوشمند بسپار فوم غرب — ' + dateFa]);
  return aoa;
}
function reportHtml(title, dateFa, reportNo, srcFa, headers, dataRows, tpl) {
  const t = tpl || {};
  const rows = dataRows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
  const head = t.header === false ? '' : `<div class="head"><div class="t">${esc(title)}</div><div class="meta">منبع: ${esc(srcFa)} &nbsp;|&nbsp; تاریخ: ${esc(dateFa)} &nbsp;|&nbsp; شماره: ${esc(reportNo)}</div></div>`;
  const foot = t.footer === false ? '' : `<div class="foot">تولیدشده توسط CRM هوشمند بسپار فوم غرب — ${esc(dateFa)}</div>`;
  const fit = t.fit_one_page ? 'fit' : '';
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: ${t.paper === 'A5' ? 'A5' : 'A4'} ${t.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: ${t.fit_one_page ? '8mm' : '15mm'}; }
* { box-sizing: border-box; }
body { font-family: Tahoma, sans-serif; color: #1c1e22; margin: 0; padding: 12px; direction: rtl; }
.head { border-bottom: 2px solid #c9a227; padding-bottom: 8px; margin-bottom: 12px; }
.head .t { font-size: 18px; font-weight: 700; }
.head .meta { font-size: 11px; color: #666; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: right; word-break: break-word; }
th { background: #171a20; color: #fff; }
tr { page-break-inside: avoid; }
thead { display: table-header-group; }
.foot { margin-top: 12px; font-size: 10px; color: #888; text-align: center; }
.${fit} table { font-size: 9px; } .${fit} th, .${fit} td { padding: 3px 4px; }
</style></head><body>${head}<table><thead><tr>${headers.map(h => '<th>' + esc(h) + '</th>').join('')}</tr></thead><tbody>${rows}</tbody></table>${foot}</body></html>`;
}
// templates
function listTemplates(user) {
  requirePerm(user, 'report_definition', 'view');
  const items = d().prepare('SELECT * FROM report_templates ORDER BY favorite DESC, id DESC').all().map(parseTpl);
  return { items };
}
function d() { return get(); }
function parseTpl(t) {
  const sp = (s, dft, isArr) => { try { const v = JSON.parse(s); return isArr ? (Array.isArray(v) ? v : dft) : (v && typeof v === 'object' ? v : dft); } catch { return dft; } };
  return { ...t, columns: sp(t.columns, [], true), filters: sp(t.filters, { op: 'AND', conditions: [] }, false), template: sp(t.template, {}, false) };
}
function saveTemplate(user, body) {
  requirePerm(user, 'report_definition', 'create');
  const d = get();
  const name = body.name || 'گزارش بدون نام';
  const source = body.source || 'sales';
  if (!engine.SOURCES[source]) throw new HttpError(400, 'BAD_SOURCE', 'منبع نامعتبر است.');
  const columns = JSON.stringify(body.columns || []);
  const filters = JSON.stringify(body.filters || { op: 'AND', conditions: [] });
  const group_by = body.group_by || '';
  const group_agg = body.group_agg || 'count';
  const sort = body.sort || '';
  const sort_dir = body.sort_dir || 'desc';
  const chart_type = body.chart_type || 'table';
  const template = JSON.stringify(body.template || {});
  const favorite = body.favorite ? 1 : 0;
  const permission = body.permission || 'view';
  if (body.id) {
    d.prepare('UPDATE report_templates SET name=?, source=?, columns=?, filters=?, group_by=?, group_agg=?, sort=?, sort_dir=?, chart_type=?, template=?, favorite=?, permission=?, updated_at=? WHERE id=?')
      .run(name, source, columns, filters, group_by, group_agg, sort, sort_dir, chart_type, template, favorite, permission, nowIso(), body.id);
    audit(user, 'report_definition', body.id, 'update', null, { name });
    return { id: Number(body.id) };
  }
  const r = d.prepare('INSERT INTO report_templates(name, source, columns, filters, group_by, group_agg, sort, sort_dir, chart_type, template, favorite, permission, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(name, source, columns, filters, group_by, group_agg, sort, sort_dir, chart_type, template, favorite, permission, user.id, nowIso(), nowIso());
  audit(user, 'report_definition', Number(r.lastInsertRowid), 'create', null, { name });
  return { id: Number(r.lastInsertRowid) };
}
function getTemplate(user, id) {
  requirePerm(user, 'report_definition', 'view');
  const t = d().prepare('SELECT * FROM report_templates WHERE id=?').get(id);
  if (!t) throw new HttpError(404, 'NOT_FOUND', 'قالب پیدا نشد.');
  return { template: parseTpl(t) };
}
function deleteTemplate(user, id) {
  requirePerm(user, 'report_definition', 'delete');
  d().prepare('DELETE FROM report_templates WHERE id=?').run(id);
  audit(user, 'report_definition', id, 'delete', null, null);
  return { ok: true };
}
function toggleFavorite(user, id) {
  requirePerm(user, 'report_definition', 'edit');
  d().prepare('UPDATE report_templates SET favorite = 1 - favorite WHERE id=?').run(id);
  return { ok: true };
}
function runTemplate(user, id) {
  const t = d().prepare('SELECT * FROM report_templates WHERE id=?').get(id);
  if (!t) throw new HttpError(404, 'NOT_FOUND', 'قالب پیدا نشد.');
  const perm = t.permission || 'view';
  requirePerm(user, 'report_definition', perm === 'view' ? 'view' : perm);
  const definition = { name: t.name, source: t.source, columns: JSON.parse(t.columns || '[]'), filters: JSON.parse(t.filters || '{}'), group_by: t.group_by, group_agg: t.group_agg, sort: t.sort, sort_dir: t.sort_dir, chart_type: t.chart_type, template: JSON.parse(t.template || '{}') };
  return runReport(user, definition);
}
function exportTemplate(user, id, format, template) {
  const t = d().prepare('SELECT * FROM report_templates WHERE id=?').get(id);
  if (!t) throw new HttpError(404, 'NOT_FOUND', 'قالب پیدا نشد.');
  const definition = { name: t.name, source: t.source, columns: JSON.parse(t.columns || '[]'), filters: JSON.parse(t.filters || '{}'), group_by: t.group_by, group_agg: t.group_agg, sort: t.sort, sort_dir: t.sort_dir, template: JSON.parse(t.template || '{}') };
  return exportReport(user, definition, format, template);
}
module.exports = { listSources, runReport, exportReport, listTemplates, saveTemplate, getTemplate, deleteTemplate, toggleFavorite, runTemplate, exportTemplate };
