'use strict';
// ============ API client ============
let _token = null;
export function setToken(t) { _token = t; }
export function getToken() { return _token; }

async function raw(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (_token) headers['Authorization'] = 'Bearer ' + _token;
  const res = await fetch(path, { ...opts, headers, credentials: 'include' });
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { data = await res.json(); } catch { data = null; } }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
      try {
        const r2 = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (r2.ok) {
          const d2 = await r2.json().catch(() => null);
          if (d2 && d2.access) { _token = d2.access; try { localStorage.setItem('bfc_token', d2.access); } catch (e) {} }
          return raw(path, opts);
        }
      } catch {}
      throw Object.assign(new Error('نشست شما به پایان رسیده است.'), { code: 'UNAUTHORIZED', status: 401 });
    }
    const err = new Error((data && data.error && data.error.message) || 'خطای ناشناخته');
    err.code = data && data.error && data.error.code;
    err.status = res.status;
    err.data = data && data.error;
    throw err;
  }
  return data;
}
export const api = {
  get: (p) => raw(p),
  post: (p, body) => raw(p, { method: 'POST', body: body || {} }),
  put: (p, body) => raw(p, { method: 'PUT', body: body || {} }),
  del: (p) => raw(p, { method: 'DELETE' }),
  upload: (p, formData) => raw(p, { method: 'POST', body: formData }),
};

// ============ i18n ============
let _lang = 'fa';
export function setLang(l) { _lang = l; document.documentElement.lang = l; document.documentElement.dir = l === 'fa' ? 'rtl' : 'ltr'; }
const D = {
  fa: {
    dashboard: 'داشبورد', myDash: 'داشبورد من', exec: 'داشبورد مدیرعامل', salesDash: 'داشبورد فروش', qualityDash: 'داشبورد کیفیت', warehouseDash: 'داشبورد انبار', labDash: 'داشبورد آزمایشگاه', financeDash: 'داشبورد مالی', kpi: 'KPI ها',
    customers: 'مشتریان', contacts: 'مخاطبین', leads: 'سرنخ‌ها', opportunities: 'فرصت‌های فروش', pipeline: 'Pipeline فروش',
    sales: 'فروش', products: 'محصولات', prices: 'لیست قیمت‌ها', quotes: 'پیش‌فاکتورها', orders: 'سفارش‌ها', invoices: 'فاکتورها', payments: 'پرداخت‌ها', commission: 'پورسانت فروش', smartSales: 'تیم هوشمند فروش',
    inventory: 'انبار', stock: 'موجودی کالا', movements: 'گردش کالا', raw: 'مواد اولیه', stockAlerts: 'هشدار موجودی',
    lab: 'آزمایشگاه', labRequests: 'درخواست آزمایش', labResults: 'نتایج آزمایش', labReports: 'گزارش آزمایشگاه',
    service: 'خدمات', complaints: 'شکایات', tickets: 'تیکت‌ها', warranties: 'گارانتی', contracts: 'قراردادها',
    marketing: 'بازاریابی', campaigns: 'کمپین‌ها', loyalty: 'باشگاه مشتریان',
    comms: 'ارتباطات', messenger: 'پیام‌رسان', meetings: 'جلسات', outbox: 'ایمیل و پیامک', customerMsg: 'پیام‌رسانی مشتریان', commCenter: 'مرکز ارتباطات',
    tasksG: 'وظایف', tasks: 'وظایف', calendar: 'تقویم', followups: 'پیگیری‌ها',
    reports: 'گزارش‌ها', reportsBuilder: 'سازنده گزارش', autoReports: 'گزارش‌های خودکار', aiReports: 'گزارش‌های AI',
    ai: 'هوش مصنوعی', assistant: 'دستیار هوشمند', aiAnalytics: 'تحلیل‌های AI', forecast: 'پیش‌بینی فروش', churn: 'ریسک ریزش', leadScoring: 'امتیاز سرنخ‌ها', kb: 'پایگاه دانش',
    documents: 'اسناد', docMgmt: 'مدیریت اسناد',
    admin: 'مدیریت', users: 'کاربران', roles: 'نقش‌ها', access: 'دسترسی‌ها', settings: 'تنظیمات', integrations: 'یکپارچه‌سازی', backup: 'پشتیبان‌گیری', audit: 'گزارد ممیزی', workflows: 'Workflow ها', processes: 'فرآیندها / OPC', approvals: 'تأییدها و امضا', customFields: 'فیلدهای سفارشی',
    new: 'ثبت جدید', search: 'جستجو…', actions: 'عملیات', save: 'ذخیره', cancel: 'انصراف', edit: 'ویرایش', delete: 'حذف', archive: 'آرشیو', restore: 'بازیابی', duplicate: 'کپی', export: 'خروجی Excel', exportCsv: 'خروجی CSV', import: 'ورود از Excel', print: 'چاپ / PDF', confirm: 'تأیید', close: 'بستن', all: 'همه', none: 'هیچ', status: 'وضعیت', date: 'تاریخ', total: 'مجموع', name: 'نام', notes: 'یادداشت', add: 'افزودن', apply: 'اعمال', send: 'ارسال', view: 'مشاهده', details: 'جزئیات',
    noData: 'داده‌ای ثبت نشده است', login: 'ورود', logout: 'خروج', remember: 'مرا به خاطر بسپار', forgot: 'رمز را فراموش کرده‌اید؟', password: 'رمز عبور', username: 'نام کاربری یا ایمیل', newPass: 'رمز جدید', changePass: 'تغییر رمز',
  },
  en: {
    dashboard: 'Dashboard', myDash: 'My Dashboard', exec: 'Executive', salesDash: 'Sales', qualityDash: 'Quality', warehouseDash: 'Inventory', labDash: 'Laboratory', financeDash: 'Finance', kpi: 'KPIs',
    customers: 'Customers', contacts: 'Contacts', leads: 'Leads', opportunities: 'Opportunities', pipeline: 'Pipeline',
    sales: 'Sales', products: 'Products', prices: 'Price Lists', quotes: 'Quotes', orders: 'Orders', invoices: 'Invoices', payments: 'Payments', commission: 'Commissions', smartSales: 'Smart Sales Team',
    inventory: 'Inventory', stock: 'Stock', movements: 'Movements', raw: 'Raw Materials', stockAlerts: 'Stock Alerts',
    lab: 'Laboratory', labRequests: 'Lab Requests', labResults: 'Lab Results', labReports: 'Lab Reports',
    service: 'Service', complaints: 'Complaints', tickets: 'Tickets', warranties: 'Warranties', contracts: 'Contracts',
    marketing: 'Marketing', campaigns: 'Campaigns', loyalty: 'Loyalty',
    comms: 'Communication', messenger: 'Messenger', meetings: 'Meetings', outbox: 'Outbox', customerMsg: 'Customer Messaging',
    tasksG: 'Tasks', tasks: 'Tasks', calendar: 'Calendar', followups: 'Follow-ups',
    reports: 'Reports', reportsBuilder: 'Report Builder', autoReports: 'Auto Reports', aiReports: 'AI Reports',
    ai: 'AI', assistant: 'AI Assistant', aiAnalytics: 'AI Analytics', forecast: 'Sales Forecast', churn: 'Churn Risk', leadScoring: 'Lead Scoring', kb: 'Knowledge Base',
    documents: 'Documents', docMgmt: 'Document Management',
    admin: 'Admin', users: 'Users', roles: 'Roles', access: 'Permissions', settings: 'Settings', integrations: 'Integrations', backup: 'Backup', audit: 'Audit Log', workflows: 'Workflows', processes: 'Processes / OPC', approvals: 'Approvals & Signatures', customFields: 'Custom Fields',
    new: 'New', search: 'Search…', actions: 'Actions', save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete', archive: 'Archive', restore: 'Restore', duplicate: 'Duplicate', export: 'Export XLSX', exportCsv: 'Export CSV', import: 'Import', print: 'Print / PDF', confirm: 'Confirm', close: 'Close', all: 'All', none: 'None', status: 'Status', date: 'Date', total: 'Total', name: 'Name', notes: 'Notes', add: 'Add', apply: 'Apply', send: 'Send', view: 'View', details: 'Details',
    noData: 'No records found', login: 'Sign in', logout: 'Logout', remember: 'Remember me', forgot: 'Forgot password?', password: 'Password', username: 'Username or email', newPass: 'New password', changePass: 'Change password',
  },
};
export { jalaliLib };
export function t(k) { return (D[_lang] && D[_lang][k]) || D.fa[k] || k; }

// ============ Formatting ============
let _jlib = null;
function jalaliLib() {
  if (_jlib) return _jlib;
  const j = (typeof window !== 'undefined' && window.jalaali) || (typeof globalThis !== 'undefined' && globalThis.jalaali);
  if (!j) throw new Error('jalali-lib-missing');
  const tj = Object.keys(j).find(function (k) { return k.endsWith('toJalaali'); });
  const tg = Object.keys(j).find(function (k) { return k.endsWith('toGregorian'); });
  const ml = Object.keys(j).find(function (k) { return k.endsWith('MonthLength'); });
  if (!tj || !tg || !ml) throw new Error('jalali-lib-incomplete');
  _jlib = { toJalaali: j[tj], toGregorian: j[tg], monthLength: j[ml] };
  return _jlib;
}
const gregorianToJalaali = (gy, gm, gd) => { const r = jalaliLib().toJalaali(gy, gm, gd); return [r.jy, r.jm, r.jd]; };
const jalaaliToGregorian = (jy, jm, jd) => { const r = jalaliLib().toGregorian(jy, jm, jd); return [r.gy, r.gm, r.gd]; };
const jalaaliMonthLength = (jy, jm) => jalaliLib().monthLength(jy, jm);

const MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const FA_DIG = { 0: '۰', 1: '۱', 2: '۲', 3: '۳', 4: '۴', 5: '۵', 6: '۶', 7: '۷', 8: '۸', 9: '۹' };
export function faDigits(s) { return String(s).replace(/[0-9]/g, (d) => FA_DIG[d]); }
export function toEnDigits(s) { return String(s).replace(/[۰-۹]/g, (d) => String('۰۱۳۴۵۷۸۹'.indexOf(d))); }
let _digitsFa = true;
export function setDigitsFa(v) { _digitsFa = v; }
export function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const neg = n < 0 ? '−' : '';
  let s = String(Math.round(Math.abs(Number(n))));
  s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (_digitsFa) s = faDigits(s);
  return neg + s;
}
let _currency = 'ریال';
export function setCurrency(c) { _currency = c; }
export function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return fmtNum(n) + ' ' + _currency;
}
function g2j(iso) {
  const d = new Date(iso);
  return gregorianToJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
export function fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const [jy, jm, jd] = g2j(iso);
  if (opts.time) {
    const d = new Date(iso);
    const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return fmtDate(iso) + ' ' + (faDigits ? faDigits(t) : t);
  }
  return _digitsFa ? faDigits(jy) + '/' + faDigits(String(jm).padStart(2, '0')) + '/' + faDigits(String(jd).padStart(2, '0')) : jy + '-' + String(jm).padStart(2, '0') + '-' + String(jd).padStart(2, '0');
}
export function fmtDateLong(iso) {
  if (!iso) return '—';
  const [jy, jm, jd] = g2j(iso);
  const d = new Date(iso);
  return WEEKDAYS_FA[d.getDay()] + ' ' + faDigits(jd) + ' ' + MONTHS_FA[jm - 1] + ' ' + faDigits(jy);
}
export function todayJalaali() {
  const n = new Date();
  return gregorianToJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
}
export function jalaliToISO(jy, jm, jd, hour = 12) {
  const [gy, gm, gd] = jalaaliToGregorian(jy, jm, jd);
  return new Date(gy, gm - 1, gd, hour, 0, 0).toISOString();
}
export function isoToJalaaliInput(iso) {
  if (!iso) return '';
  const [jy, jm, jd] = g2j(iso);
  return jy + '-' + String(jm).padStart(2, '0') + '-' + String(jd).padStart(2, '0');
}
export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'لحظاتی پیش';
  if (s < 3600) return faDigits(Math.floor(s / 60)) + ' دقیقه پیش';
  if (s < 86400) return faDigits(Math.floor(s / 3600)) + ' ساعت پیش';
  if (s < 86400 * 30) return faDigits(Math.floor(s / 86400)) + ' روز پیش';
  return fmtDate(iso);
}
const STATUS_FA = {
  active: 'فعال', inactive: 'غیرفعال', blocked: 'ممنوع',
  new: 'جدید', contacted: 'تماس‌گرفته', qualified: 'تأییدشده', converted: 'تبدیل‌شده', lost: 'از دست‌رفته',
  open: 'باز', won: 'موفق',
  draft: 'پیش‌نویس', sent: 'ارسال‌شده', accepted: 'پذیرفته‌شده', declined: 'ردشده', converted: 'تبدیل‌شده', expired: 'منقضی', cancelled: 'لغوشده',
  confirmed: 'تأییدشده', in_production: 'در حال تولید', ready: 'آماده ارسال', shipped: 'ارسال‌شده', delivered: 'تحویل‌شده', returned: 'بازگشتی',
  unpaid: 'پرداخت‌نشده', partial: 'پرداخت‌جزئی', paid: 'پرداخت‌شده', overdue: 'سررسیدگذشته',
  in_progress: 'در حال انجام', waiting: 'در انتظار', resolved: 'حل‌شده', closed: 'بسته‌شده', rejected: 'ردشده', reported: 'گزارش‌شده', received: 'دریافت‌شده', done: 'انجام‌شده', no_result: 'بدون نتیجه', cancelled: 'لغو‌شده', lead: 'اولیه',
  pending: 'در انتظار', missed: 'از دست‌رفته', scheduled: 'برنامه‌ریزی‌شده',
  low: 'کم', medium: 'متوسط', high: 'زیاد', critical: 'بحرانی',
  normal: 'متوسط', urgent: 'فوری',
  cash: 'نقد', check: 'چک', bank: 'حواله/واریز', installment: 'قسطی', other: 'سایر',
  quality: 'کیفیت', product: 'محصول', shipping: 'ارسال', delay: 'تأخیر', financial: 'مالی', service: 'خدمات', laboratory: 'آزمایشگاه', sales: 'فروش',
  unsent: 'ارسال‌نشده', confirmed_tax: 'تأییدشده',
  active_w: 'فعال', claim: 'در حال ادعا', terminated: 'فسخ‌شده',
  phone: 'تلفن', sms: 'پیامک', website: 'وب‌سایت', instagram: 'اینستاگرام', whatsapp: 'واتساپ', portal: 'پورتال', email: 'ایمیل', manual: 'دستی',
  company: 'شرکت', person: 'شخصی',
  pass: 'مطابق', fail: 'نامطابق',
  sending: 'در حال ارسال', failed: 'ناموفق',
  own: 'فقط خودم', team: 'تیم', department: 'واحد', all_scope: 'همه',
};
export function statusFa(s) { return STATUS_FA[s] || s || '—'; }
