'use strict';
import { api, setToken, getToken, t, setLang, setDigitsFa, setCurrency, fmtDate, faDigits, statusFa, jalaliLib } from './core.js';
import { el, clear, toast, openModal, confirmDialog, lineChart, barChart, donut } from './ui.js';
import { ResourceView, iconBtn } from './resource-view.js';

// ============ global state ============
let ME = null;
window.__me = () => ME;
let META = null;
window.__meta = async () => { if (!META) META = await api.get('/api/meta/options'); return META; };

const NAV = [
  { group: 'داشبورد', items: [
    { p: '/', k: 'myDash', ic: 'home', roles: [] },
    { p: '/dashboard/exec', k: 'exec', ic: 'star', roles: ['ceo', 'super_admin'] },
    { p: '/dashboard/sales', k: 'salesDash', ic: 'chart', roles: ['sales_manager', 'sales', 'super_admin', 'ceo'] },
    { p: '/dashboard/quality', k: 'qualityDash', ic: 'shield', roles: ['quality_manager', 'super_admin', 'ceo'] },
    { p: '/dashboard/warehouse', k: 'warehouseDash', ic: 'box', roles: ['warehouse_manager', 'super_admin', 'ceo', 'production_manager'] },
    { p: '/dashboard/lab', k: 'labDash', ic: 'flask', roles: ['lab', 'lab_manager', 'super_admin', 'ceo'] },
    { p: '/dashboard/finance', k: 'financeDash', ic: 'cash', roles: ['finance_manager', 'finance', 'super_admin', 'ceo'] },
    { p: '/kpi', k: 'kpi', ic: 'kpi', roles: [] },
  ] },
  { group: 'مشتریان', items: [
    { p: '/customers', k: 'customers', ic: 'users', perm: 'customer' },
    { p: '/contacts', k: 'contacts', ic: 'phone', perm: 'customer' },
    { p: '/leads', k: 'leads', ic: 'spark', perm: 'lead' },
    { p: '/opportunities', k: 'opportunities', ic: 'target', perm: 'opportunity' },
    { p: '/pipeline', k: 'pipeline', ic: 'kanban', perm: 'opportunity' },
  ] },
  { group: 'فروش', items: [
    { p: '/products', k: 'products', ic: 'box2', perm: 'product' },
    { p: '/pricelists', k: 'prices', ic: 'tag', perm: 'price_list' },
    { p: '/quotes', k: 'quotes', ic: 'file', perm: 'quote' },
    { p: '/orders', k: 'orders', ic: 'cart', perm: 'order' },
    { p: '/invoices', k: 'invoices', ic: 'receipt', perm: 'invoice' },
    { p: '/payments', k: 'payments', ic: 'cash', perm: 'payment' },
    { p: '/commission', k: 'commission', ic: 'percent', perm: 'commission' },
    { p: '/smart-sales', k: 'smartSales', ic: 'sparkles', perm: 'smart_sales' },
  ] },
  { group: 'انبار', items: [
    { p: '/stock', k: 'stock', ic: 'warehouse', perm: 'product' },
    { p: '/stock/movements', k: 'movements', ic: 'swap', perm: 'stock_transaction' },
    { p: '/stock/raw', k: 'raw', ic: 'drop', perm: 'product' },
    { p: '/stock/alerts', k: 'stockAlerts', ic: 'alert', perm: 'stock_alert' },
  ] },
  { group: 'آزمایشگاه', items: [
    { p: '/lab/requests', k: 'labRequests', ic: 'flask', perm: 'lab_request' },
    { p: '/lab/results', k: 'labResults', ic: 'list', perm: 'lab_result' },
  ] },
  { group: 'خدمات', items: [
    { p: '/complaints', k: 'complaints', ic: 'flag', perm: 'complaint' },
    { p: '/tickets', k: 'tickets', ic: 'ticket', perm: 'ticket' },
    { p: '/warranties', k: 'warranties', ic: 'medal', perm: 'warranty' },
    { p: '/contracts', k: 'contracts', ic: 'contract', perm: 'contract' },
  ] },
  { group: 'بازاریابی', items: [
    { p: '/campaigns', k: 'campaigns', ic: 'megaphone', perm: 'campaign' },
    { p: '/loyalty', k: 'loyalty', ic: 'gift', perm: 'loyalty_tier' },
  ] },
  { group: 'ارتباطات', items: [
    { p: '/messenger', k: 'messenger', ic: 'chat' },
    { p: '/meetings', k: 'meetings', ic: 'cal', perm: 'meeting' },
    { p: '/comm-center', k: 'commCenter', ic: 'phone' },
    { p: '/customer-messages', k: 'customerMsg', ic: 'mail', perm: 'customer_message' },
    { p: '/outbox', k: 'outbox', ic: 'mail' },
  ] },
  { group: 'وظایف', items: [
    { p: '/tasks', k: 'tasks', ic: 'check', perm: 'task' },
    { p: '/calendar', k: 'calendar', ic: 'cal2' },
    { p: '/followups', k: 'followups', ic: 'refresh', perm: 'followup' },
    { p: '/calls', k: 'calls', ic: 'phone', perm: 'voip_call' },
  ] },
  { group: 'گزارش‌ها', items: [
    { p: '/reports', k: 'reportsBuilder', ic: 'report', perm: 'report_definition' },
    { p: '/reports/auto', k: 'autoReports', ic: 'report2' },
  ] },
  { group: 'هوش مصنوعی', items: [
    { p: '/ai/assistant', k: 'assistant', ic: 'ai' },
    { p: '/ai/analytics', k: 'aiAnalytics', ic: 'chart2' },
    { p: '/ai/forecast', k: 'forecast', ic: 'trend' },
    { p: '/ai/churn', k: 'churn', ic: 'risk' },
    { p: '/ai/leads', k: 'leadScoring', ic: 'star2' },
    { p: '/ai/kb', k: 'kb', ic: 'book' },
  ] },
  { group: 'اسناد', items: [
    { p: '/documents', k: 'docMgmt', ic: 'folder', perm: 'document' },
    { p: '/help', k: 'help', ic: 'help' },
  ] },
  { group: 'مدیریت', items: [
    { p: '/admin/users', k: 'users', ic: 'users2', perm: 'user' },
    { p: '/admin/roles', k: 'roles', ic: 'layers', perm: 'role' },
    { p: '/admin/settings', k: 'settings', ic: 'gear', perm: 'settings' },
    { p: '/admin/workflows', k: 'workflows', ic: 'flow', perm: 'workflow_rule' },
    { p: '/admin/approvals', k: 'approvals', ic: 'check', roles: ['super_admin'] },
    { p: '/processes', k: 'processes', ic: 'flow', roles: ['super_admin'] },
    { p: '/admin/backup', k: 'backup', ic: 'db', perm: 'backup' },
    { p: '/admin/audit', k: 'audit', ic: 'eye2', perm: 'audit_log' },
    { p: '/admin/voip', k: 'voipSettings', ic: 'phone', perm: 'voip_setting' },
  ] },
];
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  flask: '<path d="M10 2v7.5L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9.5V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/><line x1="7" y1="16" x2="17" y2="16"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
  kpi: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/><circle cx="18" cy="4" r="1.6"/><circle cx="12" cy="10" r="1.6"/><circle cx="6" cy="16" r="1.6"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  users2: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.81.37 1.6.72 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.29a2 2 0 0 1 2.11-.45c.74.35 1.53.6 2.34.72A2 2 0 0 1 22 16.92z"/>',
  spark: '<path d="M12 3v18M5.6 5.6l12.8 12.8M3 12h18M5.6 18.4L18.4 5.6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  box2: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="13" y2="15"/>',
  percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  warehouse: '<path d="M22 20V8l-10-5L2 8v12"/><path d="M6 20v-8h12v8"/><path d="M6 16h12"/>',
  swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><line x1="13" y1="5" x2="13" y2="19"/>',
  medal: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13l1.5 9-5-3-5 3 1.5-9"/>',
  contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/>',
  megaphone: '<path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  cal2: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1.4" fill="currentColor"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="17" x2="9" y2="13"/><line x1="13" y1="17" x2="13" y2="11"/><line x1="17" y1="17" x2="17" y2="15"/>',
  report2: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="3"/><line x1="14.5" y1="16.5" x2="17" y2="19"/>',
  ai: '<path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="22" x2="15" y2="22"/><line x1="12" y1="19" x2="12" y2="21"/>',
  chart2: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  risk: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  star2: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  flow: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 7.5l3.5 8M17 7.5l-3.5 8"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  eye2: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
};
function navIcon(name) { return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`; }

// ============ auth ============
async function boot() {
  try {
    const me = await api.get('/api/me');
    ME = me;
    setToken(localStorage.getItem('bfc_token') || '');
    applyUserPrefs();
    enterShell();
  } catch {
    showLogin();
  }
}
function applyBrand(hex) {
  const st = (document.documentElement && document.documentElement.style) || { setProperty() {}, removeProperty() {} };
  const set = (k, v) => { try { st.setProperty(k, v); } catch {} };
  const rem = (k) => { try { st.removeProperty(k); } catch {} };
  if (!hex) { rem('--gold'); rem('--gold-soft'); rem('--gold-dim'); return; }
  const n = parseInt(String(hex).slice(1), 16);
  if (isNaN(n)) return;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  set('--gold', hex);
  set('--gold-soft', `rgb(${Math.min(255, Math.round(r + (255 - r) * 0.42))}, ${Math.min(255, Math.round(g + (255 - g) * 0.42))}, ${Math.min(255, Math.round(b + (255 - b) * 0.42))})`);
  set('--gold-dim', hex + '24');
}
function applyUserPrefs() {
  const s = ME.settings || {};
  document.documentElement.dataset.theme = s.theme || 'light';
  setLang(s.language || 'fa');
  setDigitsFa(s.digits !== 'en');
  setCurrency(s.currency || 'ریال');
  if (s.sidebar_collapsed) document.body.classList.add('side-collapsed');
  // per-user personalization: brand color + UI scale (only this user's session)
  applyBrand(s.brand_color);
  try {
    const sc = Number(s.ui_scale) || 100;
    document.body.style.zoom = sc === 100 ? '' : String(sc / 100);
  } catch {}
}
async function doLogin(username, password, totp) {
  const body = { username, password };
  if (totp) body.totp = totp;
  const r = await api.post('/api/auth/login', body);
  if (r.totp_required) return { totp_required: true, temp_token: r.temp_token };
  setToken(r.access);
  localStorage.setItem('bfc_token', r.access);
  const me = await api.get('/api/me');
  ME = me;
  applyUserPrefs();
  enterShell();
}
function logout() {
  api.post('/api/auth/logout').catch(() => {});
  localStorage.removeItem('bfc_token');
  location.hash = '';
  location.reload();
}

// ============ login page ============
function showLogin() {
  window.__appStarted = true;
  const app = document.getElementById('app');
  clear(app);
  const [pw, setPw] = [null, null];
  const userInput = el('input', { type: 'text', placeholder: 'admin', autocomplete: 'username' });
  const passInput = el('input', { type: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
  const errBox = el('div');
  const submit = el('button', { class: 'btn gold', style: 'width:100%; justify-content:center; padding:11px', onclick: async (e) => {
    e.target.disabled = true; errBox.innerHTML = '';
    try {
      const r = await doLogin(userInput.value.trim(), passInput.value);
      if (r.totp_required) show2FA(r.temp_token);
    } catch (er) {
      errBox.append(el('div', { class: 'login-err' }, er.message));
      e.target.disabled = false;
    }
  } }, t('login'));
  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
  const aboutPanel = el('div', { class: 'login-about' },
    el('h3', {}, 'درباره نرم‌افزار'),
    el('p', {}, 'سامانه یکپارچهٔ مدیریت مشتریان و عملیات (Smart CRM) شرکت دانش‌بنیان بسپار فوم غرب؛ با پوشش کامل مدیریت مشتریان، سرنخ و فرصت‌های فروش، فروش (پیش‌فاکتور/سفارش/فاکتور/پرداخت/پورسانت)، انبار و مواد اولیه، آزمایشگاه، خدمات (شکایت/تیکت/گارانتی/قرارداد)، جلسات و برنامه‌ریزی، بازاریابی، گزارش‌سازی و هوش مصنوعی — همگی متصل به پایگاه دادهٔ واقعی و قابل استفادهٔ عملیاتی.'),
    el('div', { class: 'login-about-svc' },
      el('span', { class: 'badge' }, 'مشتری‌محور'), el('span', { class: 'badge' }, 'Sales Pipeline'),
      el('span', { class: 'badge' }, 'انبار'), el('span', { class: 'badge' }, 'آزمایشگاه'),
      el('span', { class: 'badge' }, 'خدمات پس از فروش'), el('span', { class: 'badge' }, 'جلسات'),
      el('span', { class: 'badge' }, 'گزارش‌ها'), el('span', { class: 'badge' }, 'هوش مصنوعی')),
    el('div', { class: 'login-about-foot' },
      el('div', {}, el('b', {}, 'شرکت دانش‌بنیان بسپار فوم غرب'), el('span', { class: 'muted' }, 'BASPAR FOAM GHARB — دانش‌بنیان'))),
    el('div', { class: 'login-about-designer' }, el('span', { class: 'muted' }, 'طراح و توسعه‌دهنده:'), el('b', {}, 'دکتر محمدرضا دهفولی')));
  app.append(el('div', { class: 'login-wrap' },
    el('div', { class: 'login-brand' },
      el('div', { class: 'login-logos' },
        el('img', { src: '/assets/logo-selen.png', alt: 'SELEN' }),
        el('img', { src: '/assets/logo-baspar.png', alt: 'BASPAR FOAM GHARB' })),
      el('div', { class: 'lb-t' }, el('b', {}, 'BASPAR FOAM GHARB'), el('span', {}, 'SMART CRM • CRM هوشمند')),
      aboutPanel),
    el('div', { class: 'login-form-side' },
      el('div', { class: 'login-card card' },
        el('div', { class: 'card-b' },
          el('h1', {}, 'ورود به سیستم'),
          el('div', { class: 'lc-sub' }, 'CRM هوشمند شرکت دانش‌بنیان بسپار فوم غرب'),
          errBox,
          el('div', { class: 'field' }, el('label', {}, t('username')), userInput),
          el('div', { class: 'field' }, el('label', {}, t('password')), passInput),
          el('div', { class: 'flex between mb-10' },
            el('label', { class: 'small muted', style: 'display:flex; gap:6px; align-items:center' }, el('input', { type: 'checkbox', style: 'width:auto', checked: '' }), 'مرا به خاطر بسپار'),
            el('a', { style: 'font-size:12.5px; cursor:pointer', onclick: showForgot }, 'رمز را فراموش کرده‌اید؟')),
          submit,
          el('div', { class: 'login-note', html: 'ورود اولیه: کاربر <b>admin</b> — پس از ورود، رمز عبور را تغییر دهید.' }),
        )),
  )));
}
function show2FA(tempToken) {
  const code = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'کد ۶ رقمی', style: 'text-align:center; letter-spacing:6px; font-size:18px' });
  const ov = openModal('تأیید دو مرحله‌ای', el('div', {},
    el('div', { class: 'lc-sub' }, 'کد تأیید را از اپلیکیشن مدیریت رمز خود وارد کنید.'), code),
    { footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await doLogin(localStorage.getItem('bfc_user') || code.dataset.u || '', '', code.value.trim());
        } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
      } }, t('confirm')),
    ] });
}
function showForgot() {
  const idInput = el('input', { type: 'text', placeholder: 'ایمیل یا نام کاربری' });
  const msg = el('div', { class: 'mt-10 small' });
  const ov = openModal('بازیابی رمز عبور', el('div', {}, idInput, msg), {
    footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('close')),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const r = await api.post('/api/auth/forgot', { email: idInput.value.trim() });
          msg.innerHTML = ''; msg.append(el('div', { class: 'alert info' }, r.message));
        } catch (e) { msg.innerHTML = ''; msg.append(el('div', { class: 'alert danger' }, e.message)); }
      } }, 'درخواست کد بازیابی')],
  });
}

// ============ shell ============
let ROUTES = {};
function registerRoute(path, viewFn) { ROUTES[path] = viewFn; }
function routeParam(pattern, path, seg) { const a = pattern.split('/'); const b = path.split('/'); const i = a.indexOf(':' + seg); return i >= 0 && b[i] !== undefined ? b[i] : null; }

const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
let _clockTimer = null;
function buildWelcomeStrip() {
  const me = window.__me() || { user: { full_name: '' } };
  const name = (me.user.full_name || '').split(' ')[0];
  const strip = el('div', { class: 'welcome-strip' },
    el('div', { class: 'ws-welcome' }, '👋 خوش آمدید، ' + (name || 'کاربر گرامی') + ' — به CRM هوشمند بسپار فوم غرب'),
    el('div', { class: 'ws-clock' }, el('span', { class: 'ws-date' }, ''), el('span', { class: 'ws-sep' }, '•'), el('span', { class: 'ws-time' }, '')));
  const dateEl = strip.querySelector('.ws-date');
  const timeEl = strip.querySelector('.ws-time');
  const tick = () => {
    try {
      const n = new Date();
      const j = jalaliLib().toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
      const p2 = (x) => String(x).padStart(2, '0');
      dateEl.textContent = WEEKDAYS[n.getDay()] + ' ' + faDigits(j.jd) + ' ' + MONTHS_FA[j.jm - 1] + ' ' + faDigits(j.jy);
      timeEl.textContent = faDigits(p2(n.getHours())) + ':' + faDigits(p2(n.getMinutes())) + ':' + faDigits(p2(n.getSeconds()));
    } catch (e) {}
  };
  tick();
  if (_clockTimer) clearInterval(_clockTimer);
  _clockTimer = setInterval(tick, 1000);
  return strip;
}
function enterShell() {
  window.__appStarted = true;
  const app = document.getElementById('app');
  clear(app);
  app.className = 'shell';
  const sidebar = el('aside', { class: 'sidebar' });
  buildSidebar(sidebar);
  const topbar = el('header', { class: 'topbar' });
  const strip = buildWelcomeStrip();
  const content = el('main', { class: 'content' });
  app.append(sidebar, el('div', { class: 'main' }, topbar, strip, content));
  buildTopbar(topbar);
  connectWS();
  if (!location.hash) location.hash = '#/';
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdK(); }
    if (e.key === 'Escape') closeOverlays();
  });
  // PWA install + offline
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('online', () => { hideSyncBar(); syncOfflineQueue(); });
  window.addEventListener('offline', () => showSyncBar());
}
function buildSidebar(sidebar) {
  const brand = el('div', { class: 'brand' },
    el('div', { class: 'brand-logos' },
      el('img', { src: '/assets/logo-selen.png', alt: 'SELEN' }),
      el('img', { src: '/assets/logo-baspar.png', alt: 'BASPAR FOAM GHARB' })),
    el('div', { class: 'bt' }, el('b', {}, 'بسپار فوم غرب'), el('span', {}, 'SMART CRM')));
  const roles = ME.roles.map(r => r.name);
  const perms = ME.permissions || {};
  const nav = el('nav', { style: 'flex:1' });
  for (const g of NAV) {
    const items = g.items.filter(it => {
      if (it.roles) return roles.some(r => it.roles.includes(r));
      if (it.perm) return !!perms[it.perm] && perms[it.perm].view;
      return true;
    });
    if (!items.length) continue;
    const box = el('div', { class: 'nav-group' }, el('div', { class: 'ng-title' }, g.group));
    for (const it of items) {
      box.append(el('a', { class: 'nav-item', href: '#' + it.p, 'data-p': it.p, html: navIcon(it.ic), onclick: (e) => { if (window.innerWidth <= 1000) document.body.classList.remove('side-open'); } },
        el('span', {}, t(it.k)),
        it.p === '/complaints' || it.p === '/tasks' ? el('span', { class: 'badge-n', 'data-count': it.p }, '0') : null));
    }
    nav.append(box);
  }
  const foot = el('div', { class: 'side-foot' },
    el('div', { class: 'avatar' }, (ME.user.full_name || '؟').slice(0, 2)),
    el('div', { class: 'uf grow' }, el('b', {}, ME.user.full_name), el('span', {}, ME.roles.map(r => r.name_fa).join('، '))),
    el('button', { class: 'icon-btn', title: 'خروج', onclick: logout, html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' }));
  sidebar.append(brand, nav, foot);
}
let _notifOpen = false;
function buildTopbar(topbar) {
  topbar.append(
    el('button', { class: 'icon-btn burger', onclick: () => document.body.classList.toggle('side-open'), html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' }),
    el('button', { class: 'icon-btn', title: 'بازکردن منو (Ctrl+K)', onclick: openCmdK, html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="10" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><line x1="6" y1="16" x2="11" y2="16"/></svg>' }),
    el('div', { class: 'searchbox' },
      (() => {
        const inp = el('input', { placeholder: 'جستجوی سراسری… (مشتری، فاکتور، محصول، سند…)  —  Ctrl+K' });
        const box = el('div', { class: 'search-results' });
        let timer = null;
        inp.addEventListener('input', () => {
          clearTimeout(timer);
          const q = inp.value.trim();
          if (q.length < 2) { box.classList.remove('open'); return; }
          timer = setTimeout(async () => {
            try {
              const r = await api.get('/api/search?q=' + encodeURIComponent(q));
              box.innerHTML = '';
              const names = { customer: 'مشتری', lead: 'سرنخ', product: 'محصول', order: 'سفارش', invoice: 'فاکتور', quote: 'پیش‌فاکتور', supplier: 'تأمین‌کننده', complaint: 'شکایت', ticket: 'تیکت', document: 'سند', task: 'وظیفه' };
              if (!r.results.length) box.append(el('div', { class: 'sr-item muted' }, 'نتیجه‌ای پیدا نشد'));
              for (const it of r.results) {
                box.append(el('div', { class: 'sr-item', onclick: () => { box.classList.remove('open'); inp.value = ''; goForKind(it); } },
                  el('span', { class: 'kind' }, names[it.kind] || it.kind), el('span', { class: 'grow' }, it.title)));
              }
              box.classList.add('open');
            } catch {}
          }, 300);
        });
        inp.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 250));
        const wrap = el('div', { style: 'position:relative; flex:1' }, inp, box);
        return wrap;
      })()),
    el('div', { class: 't-actions' },
      el('button', { class: 'icon-btn', title: 'تغییر حالت', onclick: () => {
        const th = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = th;
        api.put('/api/settings', { theme: th }).catch(() => {});
      }, html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>' }),
      (() => {
        const b = el('button', { class: 'icon-btn', title: 'اعلان‌ها', onclick: () => toggleNotifs() });
        b.innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
        b.append(el('span', { class: 'dot', style: 'display:none' }));
        refreshNotifCount();
        return b;
      })(),
      el('button', { class: 'icon-btn', title: 'تنظیمات کاربر', onclick: () => userSettingsPage(), html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>' }),
    ),
  );
}
function goForKind(it) {
  const map = { customer: '/customers/' + it.id, lead: '/leads/' + it.id, product: '/products/' + it.id, order: '/orders/' + it.id, invoice: '/invoices/' + it.id, quote: '/quotes/' + it.id, supplier: '/suppliers/' + it.id, complaint: '/complaints/' + it.id, ticket: '/tickets/' + it.id, document: '/documents/' + it.id, task: '/tasks' };
  location.hash = '#' + (map[it.kind] || '/');
}
async function refreshNotifCount() {
  try {
    const r = await api.get('/api/notifications');
    const dots = document.querySelectorAll('.t-actions .icon-btn .dot');
    if (dots.length) { dots[0].style.display = r.unread ? 'flex' : 'none'; dots[0].textContent = faDigits(r.unread > 99 ? '99+' : r.unread); }
  } catch {}
}
function toggleNotifs() {
  const old = document.querySelector('.notif-panel');
  if (old) { old.remove(); _notifOpen = false; return; }
  _notifOpen = true;
  const panel = el('div', { class: 'notif-panel' });
  document.body.append(panel);
  panel.append(el('div', { class: 'skel', style: 'height:100px; margin:10px' }));
  api.get('/api/notifications').then(r => {
    panel.innerHTML = '';
    panel.append(el('div', { class: 'flex between', style: 'padding:13px 15px; border-bottom:1px solid var(--border)' },
      el('b', {}, 'اعلان‌ها'), el('button', { class: 'btn sm ghost', onclick: async () => { await api.post('/api/notifications/read', { all: 1 }); toggleNotifs(); toggleNotifs(); } }, 'خواندن همه')));
    if (!r.items.length) panel.append(el('div', { class: 'empty small' }, 'اعلانی وجود ندارد'));
    for (const n of r.items.slice(0, 40)) {
      panel.append(el('div', { class: 'notif-item' + (n.read_at ? '' : ' unread'), onclick: async () => {
        await api.post('/api/notifications/read', { ids: [n.id] });
        if (n.ref_type) { const kind = n.ref_type.replace('_request', ''); const map = { customer: '/customers', lead: '/leads', opportunity: '/opportunities', order: '/orders', invoice: '/invoices', quote: '/quotes', complaint: '/complaints', ticket: '/tickets', task: '/tasks', stock_alert: '/stock/alerts', followup: '/followups', meeting: '/meetings', warranty: '/warranties', campaign: '/campaigns', approval: '/admin/settings', conversation: '/messenger', message: '/messenger', user: '/admin/users', backup: '/admin/backup', report_instance: '/reports/auto', payment: '/payments', order: '/orders', quote: '/quotes' }; const base = map[kind] || '/'; if (n.ref_id && base.includes('/')) location.hash = '#' + base + '/' + n.ref_id; else location.hash = '#' + base; }
        toggleNotifs();
      } },
        el('div', { class: 'n-t' }, n.title),
        n.body ? el('div', { class: 'n-b' }, n.body) : null,
        el('div', { class: 'n-d' }, (n.creator_name ? 'ایجادکننده: ' + n.creator_name + ' • ' : 'سیستم • ') + fmtDate(n.created_at, { time: true }))));
    }
  }).catch(() => { panel.innerHTML = ''; });
}
// ============ routing ============
function renderRoute() {
  const rawHash = (location.hash || '#/').slice(1);
  const qi = rawHash.indexOf('?');
  const path = qi >= 0 ? rawHash.slice(0, qi) : rawHash; // query part keeps the list filters (drill-down)
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.p === path || path.startsWith(a.dataset.p + '/')));
  const content = document.querySelector('.content');
  if (!content) return;
  clear(content);
  // find registered route (with :param support)
  let fn = null, matchedPattern = null;
  for (const [rp, f] of Object.entries(ROUTES)) {
    if (rp === path) { fn = f; matchedPattern = rp; break; }
    const pa = rp.split('/'), ca = path.split('/');
    if (pa.length !== ca.length) continue;
    let ok = true;
    for (let i = 0; i < pa.length; i++) if (pa[i].startsWith(':') ? !ca[i] : pa[i] !== ca[i]) { ok = false; break; }
    if (ok) { fn = f; matchedPattern = rp; break; }
  }
  if (!fn) {
    // routes are registered by loadViews() after boot; on a cold reload the first
    // renderRoute can run before registration finishes — show a loader and re-render
    // when views are ready instead of a false «page not found»
    if (!window.__viewsReady) {
      window.__viewsPendingPath = path;
      const box = el('div', { class: 'skel', style: 'height:420px; margin:20px' });
      content.append(box);
      return;
    }
    const box = el('div', { class: 'empty', style: 'padding:80px' }, el('h3', {}, 'صفحه پیدا نشد'), el('div', { class: 'muted', style: 'direction:ltr' }, path));
    if (__viewFailed.length) box.append(el('div', { class: 'muted', style: 'margin-top:10px' }, 'امکانش هست ماژول مربوطه لود نشده باشد (کش/Service Worker قدیمی).'),
      el('button', { class: 'btn sm primary', style: 'margin-top:10px', onclick: () => location.reload() }, '🔄 تلاش مجدد (Ctrl+Shift+R)'));
    content.append(box); return;
  }
  // safety net: any view error shows a Persian error card with retry (never an infinite spinner)
  try {
    const r = fn(content, path, matchedPattern);
    if (r && typeof r.catch === 'function') {
      r.catch((e) => {
        console.error('view error:', e);
        if (!content.querySelector('.alert')) {
          content.append(el('div', { class: 'alert danger' },
            '⚠️ خطا در بارگذاری این صفحه: ' + (e && e.message ? e.message : 'خطای نامشخص'),
            el('button', { class: 'btn sm primary', style: 'margin-top:10px', onclick: () => renderRoute() }, '🔄 تلاش مجدد')));
        }
      });
    }
  } catch (e) {
    console.error('view error:', e);
    content.append(el('div', { class: 'alert danger' },
      '⚠️ خطا در بارگذاری این صفحه: ' + (e && e.message ? e.message : 'خطای نامشخص'),
      el('button', { class: 'btn sm primary', style: 'margin-top:10px', onclick: () => renderRoute() }, '🔄 تلاش مجدد')));
  }
}
function closeOverlays() {
  document.querySelectorAll('.cmdk-ov, .notif-panel, .search-results.open').forEach(x => x.remove());
  document.querySelectorAll('#modal-root > .modal-ov').forEach(x => x.remove());
}
// ============ command palette ============
const CMD = [
  { l: 'مشتری جدید', a: () => quickCreate('customer') },
  { l: 'سرنخ جدید', a: () => quickCreate('lead') },
  { l: 'فرصت فروش جدید', a: () => quickCreate('opportunity') },
  { l: 'سفارش جدید', a: () => quickCreate('order') },
  { l: 'شکایت جدید', a: () => quickCreate('complaint') },
  { l: 'وظیفه جدید', a: () => quickCreate('task') },
  { l: 'گزارش فروش', a: () => (location.hash = '#/reports') },
  { l: 'دستیار هوشمند', a: () => (location.hash = '#/ai/assistant') },
  { l: 'پیام‌رسان', a: () => (location.hash = '#/messenger') },
  { l: 'داشبورد مدیرعامل', a: () => (location.hash = '#/dashboard/exec') },
  { l: 'تغییر حالت روشن/تاریک', a: () => document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' },
];
function openCmdK() {
  const ov = el('div', { class: 'cmdk-ov' });
  const inp = el('input', { placeholder: 'دستور یا جستجو… (مشتری جدید، گزارش فروش، …)' });
  const list = el('div', { class: 'ck-list' });
  const mk = (q = '') => {
    list.innerHTML = '';
    const items = CMD.filter(c => !q || c.l.includes(q));
    // also search customers
    if (q.length > 1) {
      api.get('/api/search?q=' + encodeURIComponent(q)).then(r => {
        for (const it of r.results.slice(0, 6)) {
          list.append(el('div', { class: 'ck-item', onclick: () => { ov.remove(); goForKind(it); } }, el('span', { class: 'kind' }, it.kind), it.title));
        }
      }).catch(() => {});
    }
    items.forEach((c, i) => list.append(el('div', { class: 'ck-item' + (i === 0 ? ' sel' : ''), onclick: () => { ov.remove(); c.a(); } }, c.l)));
    if (!items.length && q) list.append(el('div', { class: 'ck-item muted' }, 'دستوری پیدا نشد'));
  };
  mk();
  inp.addEventListener('input', () => mk(inp.value.trim()));
  ov.append(el('div', { class: 'cmdk' }, inp, list, el('div', { class: 'ck-hint' }, 'Esc برای بستن')));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.remove(); });
  document.body.append(ov);
  inp.focus();
}
// quick create: open the module form directly
function quickCreate(res) {
  const map = { customer: '/customers', lead: '/leads', opportunity: '/opportunities', order: '/orders', complaint: '/complaints', task: '/tasks' };
  location.hash = '#' + map[res];
  setTimeout(() => { const v = window.__lastView; if (v && v.openForm) v.openForm(); }, 350);
}
// ============ WS ============
// Live notification toast (bottom-right): real-time, dismissible, clickable
// with a direct link to the record; duplicates (same id) are suppressed.
const NOTIF_LINK = { customer: '/customers', lead: '/leads', opportunity: '/opportunities', order: '/orders', invoice: '/invoices', quote: '/quotes', complaint: '/complaints', ticket: '/tickets', task: '/tasks', followup: '/followups', meeting: '/meetings', warranty: '/warranties', campaign: '/campaigns', approval: '/admin/settings', doc_approval: '/admin/settings', conversation: '/messenger', message: '/messenger', user: '/admin/users', backup: '/admin/backup', report_instance: '/reports/auto', payment: '/payments', invoice: '/invoices', stock_alert: '/stock/alerts', wf_instance: '/processes' };
function liveNotifToast(data) {
  const box = document.getElementById('toasts');
  if (!box || !data) return;
  const key = String(data.id || ((data.ref_type || '') + ':' + (data.ref_id || '') + ':' + (data.title || '')));
  for (const t of [...box.children]) if (t.dataset && t.dataset.notifKey === key) return; // no duplicate
  const kind = String(data.ref_type || '').replace('_request', '');
  const base = NOTIF_LINK[kind] || '/';
  const href = (data.ref_id && base !== '/') ? base + '/' + data.ref_id : base;
  const n = el('div', { class: 'toast', style: 'cursor:pointer; border-inline-start:4px solid #c9a227' });
  if (n.dataset) n.dataset.notifKey = key; else n.setAttribute('data-notif-key', key);
  const msg = el('div', { class: 'toast-msg', style: 'flex:1; line-height:1.6' },
    el('b', {}, '🔔 ' + (data.title || 'اعلان جدید')),
    data.body ? el('div', { class: 'small muted' }, String(data.body)) : null,
    el('div', { class: 'small muted', style: 'opacity:.7' }, 'برای رسیدن مستقیم به رکورد کلیک کنید'));
  const x = el('button', { class: 'toast-x', title: 'بستن این اعلان', 'aria-label': 'بستن', onclick: (e) => { e.stopPropagation(); n.remove(); } }, '✕');
  n.append(msg, x);
  n.addEventListener('click', async () => {
    if (data.id) { try { await api.post('/api/notifications/read', { ids: [data.id] }); refreshNotifCount(); } catch {} }
    n.remove();
    if (href) location.hash = '#' + href;
  });
  box.append(n);
  setTimeout(() => { if (n.parentNode) n.remove(); }, 12000);
}
let WS = null;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  WS = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(localStorage.getItem('bfc_token') || '')}`);
  WS.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'notification') { liveNotifToast(m.data); refreshNotifCount(); }
    if (m.type === 'call') {
      openModal('تماس جدید', el('div', { style: 'text-align:center; padding:10px' },
        el('div', { class: 'avatar', style: 'width:70px; height:70px; margin:0 auto 12px; font-size:24px' }, (m.from_name || '؟').slice(0, 2)),
        el('b', {}, m.from_name || 'کاربر'), el('div', { class: 'muted small' }, m.kind === 'video' ? 'تماس تصویری' : 'تماس صوتی')), {
        footer: [
          el('button', { class: 'btn', onclick: () => { api.post(`/api/calls/${m.callId}/end`).catch(() => {}); window.__closeModalAll(); } }, 'رد کردن'),
          el('button', { class: 'btn primary', onclick: () => { api.post(`/api/calls/${m.callId}/answer`).catch(() => {}); startWebRTCCall(m); window.__closeModalAll(); } }, 'پاسخ دادن'),
        ],
      });
    }
    if (m.type === 'message' && location.hash === '#/messenger' && window.__messengerActive) window.__messengerRefresh && window.__messengerRefresh(m.message);
  };
  WS.onclose = () => { if (ME) setTimeout(connectWS, 4000); };
}
function startWebRTCCall(m) {
  // WebRTC voice/video using server signaling
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const stream = navigator.mediaDevices.getUserMedia({ audio: true, video: m.kind === 'video' }).catch(() => null);
  pc.onicecandidate = (e) => { if (e.candidate) api.post('/api/calls/' + m.callId + '/signal', { to: m.from, candidate: e.candidate.toJSON() }).catch(() => {}); };
  stream.then(s => { if (s) { s.getTracks().forEach(tr => pc.addTrack(tr, s)); toast('تماس برقرار شد', 'ok'); } }).catch(() => toast('دسترسی به میکروفون/دوربین لازم است', 'err'));
  window.__pc = pc;
}
window.__closeModalAll = () => document.querySelectorAll('#modal-root > .modal-ov').forEach(x => x.remove());
// ============ offline sync ============
function showSyncBar() {
  let b = document.querySelector('.syncbar');
  if (!b) { b = el('div', { class: 'syncbar' }, '📡 حالت آفلاین — تغییرات شما در صف همگام‌سازی است'); document.body.append(b); }
}
function hideSyncBar() { const b = document.querySelector('.syncbar'); if (b) b.remove(); }
function queueOffline(entity, op, data, id) {
  try {
    const q = JSON.parse(localStorage.getItem('bfc_queue') || '[]');
    q.push({ entity, op, data, id, at: new Date().toISOString() });
    localStorage.setItem('bfc_queue', JSON.stringify(q));
    showSyncBar();
  } catch {}
}
async function syncOfflineQueue() {
  let q = [];
  try { q = JSON.parse(localStorage.getItem('bfc_queue') || '[]'); } catch {}
  if (!q.length) return;
  try {
    const r = await api.post('/api/sync/batch', { changes: q });
    localStorage.setItem('bfc_queue', '[]');
    if (r.ok) toast(`همگام‌سازی: ${faDigits(r.results.filter(x => x.ok).length)} تغییر ثبت شد`, 'ok');
    const failed = r.results.filter(x => !x.ok);
    if (failed.length) toast(`${faDigits(failed.length)} تغییر به‌خاطر تعارض/خطا ثبت نشد (مشاهده در گزارش همگام‌سازی)`, 'err');
  } catch { /* still offline */ }
}
// ============ user settings page ============
function refreshMeChrome() {
  try {
    const foot = document.querySelector('.side-foot');
    if (!foot) return;
    const nameEl = foot.querySelector('.uf b');
    if (nameEl) nameEl.textContent = ME.user.full_name || '';
    const av = foot.querySelector('.avatar');
    if (av) {
      if (ME.user.avatar) {
        av.innerHTML = '';
        const im = document.createElement('img');
        im.src = ME.user.avatar;
        im.alt = 'avatar';
        im.style.cssText = 'width:100%; height:100%; border-radius:50%; object-fit:cover; display:block';
        av.append(im);
      } else {
        av.textContent = (ME.user.full_name || '؟').slice(0, 2);
      }
    }
  } catch { /* non-critical */ }
}
function userSettingsPage() {
  const s = ME.settings || {};
  const pw1 = el('input', { type: 'password', placeholder: 'رمز فعلی' });
  const pw2 = el('input', { type: 'password', placeholder: 'رمز جدید' });
  const themeSel = el('select', { value: s.theme || 'light' });
  themeSel.append(el('option', { value: 'light' }, 'روشن'), el('option', { value: 'dark' }, 'تاریک'));
  const digSel = el('select', { value: s.digits === 'en' ? 'en' : 'fa' });
  digSel.append(el('option', { value: 'fa' }, 'اعداد فارسی'), el('option', { value: 'en' }, 'اعداد انگلیسی'));
  const curSel = el('select', { value: s.currency || 'ریال' });
  curSel.append(el('option', { value: 'ریال' }, 'ریال'), el('option', { value: 'تومان' }, 'تومان'));
  // ---- personalization: brand color + UI scale (per-user, saved on this account) ----
  const BRANDS = [['#c9a227', 'طلایی (پیش‌فرض)'], ['#2f6fb2', 'آبی'], ['#1e8e63', 'سبز'], ['#7c5cd6', 'بنفش'], ['#c0392b', 'سرخ'], ['#2a9d8f', 'فیروزه‌ای'], ['#c77d1f', 'نارنجی'], ['#6d727b', 'خاکستری']];
  let pickedBrand = s.brand_color || '';
  const brandBtns = [
    (() => { const b = el('button', { class: 'btn sm', type: 'button' }, 'پیش‌فرض'); b._hex = ''; return b; })(),
    ...BRANDS.map(([hex, l]) => { const b = el('button', { class: 'btn sm', type: 'button', title: l }, el('span', { style: `display:inline-block; width:13px; height:13px; border-radius:4px; background:${hex}; vertical-align:-2px` }), ' ' + l); b._hex = hex; return b; }),
  ];
  const brandBox = el('div', { class: 'flex wrap', style: 'gap:6px' }, brandBtns);
  const paintBrand = () => { for (const b of brandBtns) { const on = b._hex === pickedBrand; b.style.borderColor = on ? (b._hex || 'var(--text)') : ''; b.style.fontWeight = on ? '700' : ''; } };
  for (const b of brandBtns) b.addEventListener('click', () => { pickedBrand = b._hex; applyBrand(pickedBrand); paintBrand(); });
  paintBrand();
  const scaleSel = el('select', { value: String(s.ui_scale || 100) });
  for (const [v, l] of [['90', 'کوچک (۹۰٪)'], ['100', 'استاندارد (۱۰۰٪)'], ['110', 'بزرگ (۱۱۰٪)'], ['120', 'خیلی بزرگ (۱۲۰٪)']]) scaleSel.append(el('option', { value: v }, l));
  scaleSel.addEventListener('change', () => { try { const sc = Number(scaleSel.value); document.body.style.zoom = sc === 100 ? '' : String(sc / 100); } catch {} });
  // ---- personal profile (self-service: name/email/phone + avatar) ----
  const pName = el('input', { value: ME.user.full_name || '', placeholder: 'نام و نام خانوادگی' });
  const pEmail = el('input', { value: ME.user.email || '', dir: 'ltr', placeholder: 'name@company.com' });
  const pPhone = el('input', { value: ME.user.phone || '', dir: 'ltr', placeholder: 'شماره تماس' });
  const avatarImg = el('div', { class: 'avatar', style: 'width:64px; height:64px; font-size:22px; flex:0 0 auto' }, (ME.user.full_name || '؟').slice(0, 2));
  const paintAvatar = () => {
    if (ME.user.avatar) {
      avatarImg.innerHTML = '';
      const im = document.createElement('img');
      im.src = ME.user.avatar;
      im.alt = 'avatar';
      im.style.cssText = 'width:100%; height:100%; border-radius:50%; object-fit:cover; display:block';
      avatarImg.append(im);
    } else {
      avatarImg.textContent = (ME.user.full_name || '؟').slice(0, 2);
    }
  };
  paintAvatar();
  const fileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  fileIn.addEventListener('change', async () => {
    if (!fileIn.files || !fileIn.files[0]) return;
    const fd = new FormData();
    fd.append('file', fileIn.files[0]);
    try {
      const r = await api.upload('/api/me/avatar', fd);
      ME.user.avatar = r.avatar;
      paintAvatar(); refreshMeChrome();
      toast('تصویر پروفایل ذخیره شد', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    fileIn.value = '';
  });
  const personalBox = el('div', {},
    el('h4', {}, 'مشخصات شخصی (پروفایل)'),
    el('div', { class: 'form-grid' },
      el('div', { class: 'field', style: 'grid-column:1/-1' },
        el('div', { style: 'display:flex; align-items:center; gap:16px' },
          avatarImg,
          el('div', {},
            el('div', { style: 'margin-bottom:6px' }, fileIn),
            el('div', { class: 'muted small' }, 'تصویر پروفایل: PNG/JPEG/WebP — حداکثر ۲ مگابایت')))),
      el('div', { class: 'field' }, el('label', {}, 'نام و نام خانوادگی *'), pName),
      el('div', { class: 'field' }, el('label', {}, 'ایمیل'), pEmail),
      el('div', { class: 'field' }, el('label', {}, 'تلفن'), pPhone)),
    ME.user.avatar ? el('button', { class: 'btn sm danger', style: 'margin-top:8px', onclick: async () => {
      try { await api.del('/api/me/avatar'); ME.user.avatar = ''; paintAvatar(); refreshMeChrome(); toast('تصویر حذف شد', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    } }, 'حذف تصویر پروفایل') : null,
    el('div', { style: 'display:flex; gap:8px; margin-top:10px' },
      el('button', { class: 'btn primary sm', onclick: async () => {
        if (!pName.value.trim()) return toast('نام الزامی است', 'err');
        try {
          const r = await api.put('/api/me', { full_name: pName.value.trim(), email: pEmail.value.trim(), phone: pPhone.value.trim() });
          ME.user = { ...ME.user, ...r.user };
          refreshMeChrome();
          toast('مشخصات شخصی ذخیره شد', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      } }, 'ذخیره مشخصات')));
  // ---- e-signature (self-service: only YOUR OWN signature) ----
  const sigBox = el('div', {});
  const sigFileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'max-width:260px' });
  sigFileIn.addEventListener('change', async () => {
    if (!sigFileIn.files || !sigFileIn.files[0]) return;
    const f = sigFileIn.files[0];
    if (f.size > 2 * 1024 * 1024) { toast('حجم امضا نباید بیشتر از ۲ مگابایت باشد', 'err'); sigFileIn.value = ''; return; }
    const fd = new FormData();
    fd.append('file', f);
    try {
      const r = await api.upload('/api/signature/me', fd);
      toast('امضای شما ثبت شد', 'ok');
      loadMySignature(r);
    } catch (e) { toast(e.message, 'err'); }
    sigFileIn.value = '';
  });
  async function loadMySignature(meta) {
    clear(sigBox);
    const m = meta || (await api.get('/api/signature/me').catch(() => ({ has_signature: false })));
    sigBox.append(el('h4', { class: 'mt-16' }, 'امضای الکترونیکی من'));
    sigBox.append(el('div', { class: 'muted small', style: 'margin-bottom:8px; line-height:1.9' },
      'این امضا فقط توسط شما مدیریت می‌شود و هنگام تأیید/امضای فرآیندها (مثلاً پیش‌فاکتور) با هویت و تاریخ شما ثبت می‌شود.'));
    const row = el('div', { style: 'display:flex; align-items:center; gap:14px; flex-wrap:wrap' });
    if (m.has_signature) {
      const imgWrap = el('div', { style: 'min-width:150px; min-height:54px; border:1.5px dashed var(--border-2); border-radius:10px; padding:6px; display:flex; align-items:center; justify-content:center; background:var(--surface-2)' }, el('span', { class: 'muted small' }, '…'));
      row.append(imgWrap);
      fetch('/api/signature/me/download', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then(r2 => r2.ok ? r2.blob() : Promise.reject(new Error('download failed')))
        .then(b => { const im = document.createElement('img'); im.src = URL.createObjectURL(b); im.style.cssText = 'max-width:150px; max-height:54px; object-fit:contain'; im.alt = 'امضا'; imgWrap.innerHTML = ''; imgWrap.append(im); })
        .catch(() => { imgWrap.innerHTML = ''; imgWrap.append(el('span', { class: 'muted small' }, 'خطا در نمایش امضا')); });
      row.append(el('button', { class: 'btn sm danger', onclick: async () => {
        if (!(await confirmDialog('حذف امضا', 'امضای الکترونیکی شما حذف شود؟ (این عمل قابل بازگشت نیست)', 'حذف', true))) return;
        try { await api.del('/api/signature/me'); toast('امضا حذف شد', 'ok'); loadMySignature(); } catch (e) { toast(e.message, 'err'); }
      } }, 'حذف امضا'));
    } else {
      row.append(el('span', { class: 'badge' }, 'امضایی ثبت نشده است'));
    }
    row.append(sigFileIn, el('span', { class: 'muted small' }, 'PNG/JPG/WEBP — حداکثر ۲MB'));
    sigBox.append(row);
    sigBox.append(el('div', { style: 'margin-top:8px' },
      el('span', { class: 'badge ' + (m.can_sign ? 'green' : '') }, m.can_sign ? '✓ مجاز به استفاده از امضا در فرآیندهای تأیید' : '✗ مجوز استفاده از امضا در فرآیندها را ندارید (با مدیر سیستم هماهنگ کنید)')));
  }
  loadMySignature();
  const ov = openModal('تنظیمات کاربر و امنیت', el('div', {},
    personalBox,
    sigBox,
    el('div', { style: 'border-top:1px solid var(--border); margin-top:16px; padding-top:4px' }),
    el('h4', {}, 'شخصی‌سازی محیط (فقط برای حساب شما ذخیره می‌شود)'),
    el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', {}, 'حالت روشن / تیره'), themeSel),
      el('div', { class: 'field' }, el('label', {}, 'اعداد'), digSel),
      el('div', { class: 'field' }, el('label', {}, 'واحد پول'), curSel),
      el('div', { class: 'field' }, el('label', {}, 'اندازه نمایش'), scaleSel),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'رنگ اصلی Interface'), brandBox),
    ),
    el('button', { class: 'btn primary sm', onclick: async () => {
      const v = { theme: themeSel.value, digits: digSel.value, currency: curSel.value, brand_color: pickedBrand, ui_scale: Number(scaleSel.value) };
      try {
        const r = await api.put('/api/settings', v);
        ME.settings = r; applyUserPrefs(); toast('تنظیمات شخصی شما ذخیره شد', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    } }, 'ذخیره شخصی‌سازی'),
    el('h4', { class: 'mt-16' }, 'تغییر رمز عبور'),
    el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', {}, 'رمز فعلی'), pw1),
      el('div', { class: 'field' }, el('label', {}, 'رمز جدید'), pw2)),
    el('button', { class: 'btn sm', onclick: async () => {
      try { await api.post('/api/auth/password', { current: pw1.value, new: pw2.value }); toast('رمز تغییر کرد', 'ok'); pw1.value = pw2.value = ''; }
      catch (e) { toast(e.message, 'err'); }
    } }, t('changePass')),
    el('h4', { class: 'mt-16' }, 'تأیید دوعاملی (2FA)'),
    el('div', { class: 'flex', style: 'flex-wrap:wrap' },
      ME.user.totp_enabled
        ? [el('span', { class: 'badge green' }, '۲FA فعال است'),
          el('button', { class: 'btn sm danger', onclick: async () => { await api.post('/api/auth/totp/disable', {}); ME.user.totp_enabled = false; toast('غیرفعال شد', 'ok'); userSettingsPage(); } }, 'غیرفعال کردن')]
        : [el('span', { class: 'badge' }, '۲FA غیرفعال'),
          el('button', { class: 'btn sm primary', onclick: async () => {
            const r = await api.post('/api/auth/totp/setup', {});
            const codeInput = el('input', { type: 'text', placeholder: 'کد ۶ رقمی', style: 'text-align:center; letter-spacing:4px' });
            const ov2 = openModal('فعال‌سازی ۲FA', el('div', {},
              el('p', { class: 'small' }, 'رمز زیر را در اپلیکیشن Authenticator خود وارد کنید:'),
              el('div', { class: 'code-box mb-10' }, r.secret),
              el('div', { class: 'code-box small mb-10' }, r.uri),
              el('p', { class: 'small muted' }, 'سپس کد ۶ رقمی را برای تأیید وارد کنید.'), codeInput),
              { footer: [el('button', { class: 'btn', onclick: () => ov2.close() }, t('close')), el('button', { class: 'btn primary', onclick: async () => {
                try { await api.post('/api/auth/totp/enable', { code: codeInput.value.trim() }); toast('۲FA فعال شد', 'ok'); ME.user.totp_enabled = true; ov2.close(); userSettingsPage(); } catch (e) { toast(e.message, 'err'); }
              } }, t('confirm'))] });
          } }, 'فعال‌سازی ۲FA')]),
  ), { large: true, footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('close'))] });
  // fix 2FA modal closure (simplify)
}
// ============ boot views ============
// هر ماژول جداگانه و با fail-safe لود می‌شود: شکست load یک فایل view (کش/Service Worker
// قدیمی، شبکه، فایل ناقص) دیگر نمی‌تواند ثبت Routeهای بقیه را مختل کند و علت، قابل‌مشاهده می‌شود.
const __viewFailed = [];
const failSafeImport = (p) => import(p).catch((e) => { console.error('[bfc] view load failed:', p, e); __viewFailed.push(p); return null; });
async function loadViews() {
  const [loginV, dashV, custV, pipeV, salesV, invV, svcV, labV, msgV, planV, repV, aiV, admV, miscV, voipV, helpV, smartV, mtgV, cmV, portalV, procV, commV] = await Promise.all([
    failSafeImport('./views/dashboard.js'), failSafeImport('./views/dashboard.js'), failSafeImport('./views/customers.js'), failSafeImport('./views/pipeline.js'),
    failSafeImport('./views/sales.js'), failSafeImport('./views/inventory.js'), failSafeImport('./views/service.js'), failSafeImport('./views/lab.js'),
    failSafeImport('./views/messenger.js'), failSafeImport('./views/planning.js'), failSafeImport('./views/reports.js'), failSafeImport('./views/ai.js'),
    failSafeImport('./views/admin.js'), failSafeImport('./views/misc.js'), failSafeImport('./views/voip.js'), failSafeImport('./views/help.js'),
    failSafeImport('./views/smart-sales.js'), failSafeImport('./views/meetings.js'), failSafeImport('./views/customermsg.js'),
    failSafeImport('./views/portal.js'), failSafeImport('./views/processes.js'),
    failSafeImport('./views/commcenter.js'),
  ]);
  if (__viewFailed.length) {
    window.__viewFailed = __viewFailed;
    const t = document.getElementById('toasts');
    if (t) t.append(el('div', { class: 'toast err', style: 'position:fixed;bottom:16px;right:16px;z-index:9999;direction:rtl;max-width:420px' },
      el('div', { style: 'font-size:13px' }, '⚠️ بارگذاری بعضی ماژول‌های UI شکست خورد: ' + __viewFailed.join('، ') + ' — معمولاً کش/Service Worker قدیمی است. با Ctrl+Shift+R یا پاک‌کردن دادهٔ سایت (DevTools → Application) بارگذاری مجدد کنید.'),
      el('button', { class: 'btn sm primary', style: 'margin-top:8px', onclick: () => location.reload() }, '🔄 تلاش مجدد')));
  }
  // dashboards
  registerRoute('/', (c) => dashV.myDashboard(c));
  registerRoute('/dashboard/exec', (c) => dashV.roleDashboard(c, 'ceo', 'داشبورد مدیرعامل'));
  registerRoute('/dashboard/sales', (c) => dashV.roleDashboard(c, 'sales_manager', 'داشبورد فروش'));
  registerRoute('/dashboard/quality', (c) => dashV.roleDashboard(c, 'quality_manager', 'داشبورد کیفیت'));
  registerRoute('/dashboard/warehouse', (c) => dashV.roleDashboard(c, 'warehouse_manager', 'داشبورد انبار'));
  registerRoute('/dashboard/lab', (c) => dashV.roleDashboard(c, 'lab_manager', 'داشبورد آزمایشگاه'));
  registerRoute('/dashboard/finance', (c) => dashV.roleDashboard(c, 'finance_manager', 'داشبورد مالی'));
  registerRoute('/kpi', (c) => dashV.kpiPage(c));
  // customers & sales
  registerRoute('/customers', (c) => custV.customersList(c));
  registerRoute('/customers/:id', (c, p, pat) => custV.customerDetail(c, routeParam(pat, p, 'id')));
  registerRoute('/contacts', (c) => custV.contactsList(c));
  registerRoute('/leads', (c) => custV.leadsView(c));
  registerRoute('/opportunities', (c) => custV.opportunitiesView(c));
  registerRoute('/pipeline', (c) => pipeV.pipelineBoard(c));
  registerRoute('/products', (c) => miscV.productView(c));
  registerRoute('/pricelists', (c) => miscV.priceListView(c));
  registerRoute('/quotes', (c) => salesV.quotesList(c));
  registerRoute('/quotes/:id', (c, p, pat) => salesV.docDetail(c, 'quote', routeParam(pat, p, 'id')));
  registerRoute('/orders', (c) => salesV.ordersList(c));
  registerRoute('/orders/:id', (c, p, pat) => salesV.docDetail(c, 'order', routeParam(pat, p, 'id')));
  registerRoute('/invoices', (c) => salesV.invoicesList(c));
  registerRoute('/invoices/:id', (c, p, pat) => salesV.docDetail(c, 'invoice', routeParam(pat, p, 'id')));
  registerRoute('/payments', (c) => salesV.paymentsList(c));
  registerRoute('/commission', (c) => salesV.commissionPage(c));
  // inventory
  registerRoute('/stock', (c) => invV.stockView(c, false));
  registerRoute('/stock/raw', (c) => invV.stockView(c, true));
  registerRoute('/stock/movements', (c) => invV.movementsView(c));
  registerRoute('/stock/alerts', (c) => invV.alertsView(c));
  // lab
  registerRoute('/lab/requests', (c) => labV.requestsView(c));
  registerRoute('/lab/results', (c) => labV.resultsView(c));
  // service
  registerRoute('/complaints', (c) => svcV.complaintsView(c));
  registerRoute('/complaints/:id', (c, p, pat) => svcV.complaintDetail(c, routeParam(pat, p, 'id')));
  registerRoute('/tickets', (c) => svcV.ticketsView(c));
  registerRoute('/warranties', (c) => miscV.simple('warranty', 'گارانتی', c));
  registerRoute('/contracts', (c) => miscV.simple('contract', 'قراردادها', c));
  // marketing
  registerRoute('/campaigns', (c) => miscV.campaignsView(c));
  registerRoute('/loyalty', (c) => miscV.loyaltyView(c));
  // comms
  registerRoute('/messenger', (c) => msgV.messengerPage(c));
  registerRoute('/portal', (c) => portalV.portalPage(c));
  registerRoute('/customer-messages', (c) => cmV.customerMsgPage(c));
  registerRoute('/customer-messages/templates', (c) => cmV.customerMsgTemplatesPage(c));
  registerRoute('/customer-messages/settings', (c) => cmV.customerMsgSettingsPage(c));
  registerRoute('/comm-center', (c) => commV.commCenterPage(c));
  registerRoute('/meetings', (c) => mtgV.meetingsView(c));
  registerRoute('/meetings/:id', (c, p, pat) => { c.append(el('div', { class: 'page-head' }, el('a', { class: 'btn sm ghost', href: '#/meetings' }, '→ جلسات'), el('div', {}, el('h1', {}, 'جزئیات جلسه')))); mtgV.meetingsView(c, routeParam(pat, p, 'id')); });
  registerRoute('/outbox', (c) => miscV.outboxView(c));
  // planning
  registerRoute('/tasks', (c) => planV.tasksView(c));
  registerRoute('/calendar', (c) => planV.calendarView(c));
  registerRoute('/followups', (c) => planV.followupsView(c));
  // process / OPC designer (super_admin only — enforced in backend too)
  registerRoute('/processes', (c) => procV.processesList(c));
  registerRoute('/processes/:id', (c, p, pat) => {
    const q = new URLSearchParams((location.hash || '').split('?')[1] || '');
    procV.processDesigner(c, routeParam(pat, p, 'id'), q.get('tab') || 'design');
  });
  registerRoute('/calls', (c) => voipV.callsView(c));
  registerRoute('/calls/missed', (c) => voipV.callsView(c, { missed: '1', status: 'missed' }));
  registerRoute('/smart-sales', (c) => smartV.smartSalesPage(c));
  registerRoute('/help', (c) => helpV.helpView(c));
  // reports
  registerRoute('/reports', (c) => repV.reportBuilder(c));
  registerRoute('/reports/auto', (c) => repV.autoReports(c));
  // AI
  registerRoute('/ai/assistant', (c) => aiV.assistantPage(c));
  registerRoute('/ai/analytics', (c) => aiV.analyticsPage(c));
  registerRoute('/ai/forecast', (c) => aiV.forecastPage(c));
  registerRoute('/ai/churn', (c) => aiV.churnPage(c));
  registerRoute('/ai/leads', (c) => aiV.leadsPage(c));
  registerRoute('/ai/kb', (c) => aiV.kbPage(c));
  // documents
  registerRoute('/documents', (c) => miscV.documentsView(c));
  // admin
  registerRoute('/admin/users', (c) => admV.usersPage(c));
  registerRoute('/admin/roles', (c) => admV.rolesPage(c));
  registerRoute('/admin/settings', (c) => admV.settingsPage(c));
  registerRoute('/admin/workflows', (c) => admV.workflowsPage(c));
  registerRoute('/admin/approvals', (c) => admV.approvalChainsPage(c));
  registerRoute('/admin/backup', (c) => admV.backupPage(c));
  registerRoute('/admin/audit', (c) => admV.auditPage(c));
  registerRoute('/admin/voip', (c) => voipV.voipSettingsView(c));
  // views ready: resolve the first render that raced the registration (cold reload)
  window.__viewsReady = true;
  if (window.__viewsPendingPath) { const p = window.__viewsPendingPath; window.__viewsPendingPath = null; if (((location.hash || '#/').slice(1).split('?')[0]) === p) renderRoute(); }
}
boot().then(loadViews);
