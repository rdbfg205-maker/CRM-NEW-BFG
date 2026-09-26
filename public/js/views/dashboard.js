'use strict';
import { api, t, fmtNum, fmtMoney, fmtDate, faDigits, statusFa } from '../core.js';
import { el, clear, toast } from '../ui.js';
import { lineChart, barChart, donut } from '../ui.js';
import { helpBtn } from './help.js';
import { aiSalesIntelligence } from './ai-intelligence.js';

function statCard(label, value, sub = '', ic = '') {
  const card = el('div', { class: 'card stat' });
  if (ic) card.append(el('div', { class: 's-ic', html: ic }));
  card.append(el('div', { class: 's-label' }, label));
  card.append(el('div', { class: 's-value' }, value));
  if (sub) card.append(el('div', { class: 's-sub' }, sub));
  return card;
}
// clickable KPI card → drill-down (e.g. calendar with filters)
function statCardLink(label, value, sub, ic, href) {
  const card = statCard(label, value, sub, ic);
  card.style.cursor = 'pointer';
  card.title = 'برای مشاهده کلیک کنید';
  card.addEventListener('click', () => { location.hash = href; });
  return card;
}
const I = {
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.81.37 1.6.72 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.29a2 2 0 0 1 2.11-.45c.74.35 1.53.6 2.34.72A2 2 0 0 1 22 16.92z"/></svg>',
};
function quickActions() {
  const box = el('div', { class: 'card mb-16' }, el('div', { class: 'card-b flex wrap', style: 'gap:8px' }));
  const inner = box.children[0];
  inner.append(el('b', { class: 'muted small' }, 'عملیات سریع:'));
  const mk = (label, res) => {
    const b = el('button', { class: 'btn sm' }, '＋ ', label);
    b.addEventListener('click', () => {
      const map = { customer: '/customers', lead: '/leads', opportunity: '/opportunities', order: '/orders', complaint: '/complaints', task: '/tasks' };
      location.hash = '#' + map[res];
      setTimeout(() => { if (window.__lastView && window.__lastView.openForm) window.__lastView.openForm(); }, 350);
    });
    return b;
  };
  for (const [l, r] of [['مشتری', 'customer'], ['سرنخ', 'lead'], ['فرصت فروش', 'opportunity'], ['سفارش', 'order'], ['شکایت', 'complaint'], ['وظیفه', 'task']]) inner.append(mk(l, r));
  return box;
}
function taskWidget(tasks) {
  const card = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'وظایف من')));
  const body = el('div');
  card.append(body);
  if (!tasks.length) {
    body.append(el('div', { class: 'small muted', style: 'padding:12px 16px' }, 'وظیفه بازی ندارید. ✔'));
    return card;
  }
  for (const tsk of tasks.slice(0, 6)) {
    const row = el('div', { class: 'flex between', style: 'padding:9px 16px; border-top:1px solid var(--border); font-size:13px', onclick: () => location.hash = '#/tasks' });
    row.append(el('span', {}, tsk.title));
    row.append(el('span', { class: 'muted small' }, tsk.due_at ? fmtDate(tsk.due_at, { time: true }) : ''));
    body.append(row);
  }
  return card;
}
function aiSummaryBox(data) {
  const card = el('div', { class: 'card mb-16', style: 'border-inline-start:3px solid var(--gold)' });
  const body = el('div', { class: 'card-b' });
  const head = el('div', { class: 'flex between mb-10' });
  head.append(el('b', {}, '🤖 خلاصه مدیریتی هوشمند (AI)'));
  const btn = el('button', { class: 'btn sm ghost' }, 'دستیار AI');
  btn.addEventListener('click', () => location.hash = '#/ai/assistant');
  head.append(btn);
  body.append(head);
  if (data && data.text) body.append(el('div', { style: 'line-height:2.1; font-size:13.5px' }, data.text));
  else body.append(el('div', { class: 'skel', style: 'height:60px' }));
  card.append(body);
  return card;
}
function loadingGrid(n = 6) {
  const g = el('div', { class: 'grid g-6' });
  for (let i = 0; i < n; i++) g.append(el('div', { class: 'skel', style: 'height:92px' }));
  return g;
}
function listCard(title, rowsFn, allHref = '') {
  const h3 = el('h3', {}, title);
  let head = el('div', { class: 'card-h' }, h3);
  if (allHref) {
    head = el('div', { class: 'card-h' },
      el('div', { style: 'cursor:pointer', onclick: () => { location.hash = allHref; } }, h3),
      el('a', { class: 'btn sm', style: 'margin-inline-start:auto', href: allHref }, 'همه ←'));
  }
  const card = el('div', { class: 'card' }, head);
  const body = el('div');
  card.append(body);
  rowsFn(body);
  return card;
}
function rowItem(inner) {
  return el('div', { class: 'flex between small', style: 'padding:8px 16px; border-top:1px solid var(--border)' }, inner);
}
// ---------- Complaint bank (structured defect bank) — real data + drill-down ----------
const DEFECT_FAMILY_FA = { foam_sponge: 'فوم و اسفنج', polyurethane: 'مواد اولیه پلی‌یورتان', foam_mattress: 'تشک تمام‌فوم', bed_related: 'تشک و محصولات مرتبط با تخت', other: 'سایر' };
function complaintBankSection(c, d) {
  const bank = d.complaintBank;
  if (!bank) return;
  const row = el('div', { class: 'grid g-2 mt-16' });
  c.append(row);
  row.append(listCard('بانک شکایات — پرتکرارترین عیب‌ها (۹۰ روز)', (body) => {
    const list = bank.topTypes || [];
    if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'داده‌ای وجود ندارد — هنگام ثبت شکایت، نوع عیب را انتخاب کنید'));
    for (const t of list) {
      const r = rowItem(''); clear(r);
      r.append(el('span', {}, t.defect_type));
      r.append(el('span', { class: 'badge gold', style: 'margin-inline-start:8px' }, faDigits(t.c) + ' مورد'));
      r.style.cursor = 'pointer'; r.title = 'باز کردن لیست شکایات با این فیلتر';
      r.addEventListener('click', () => location.hash = '#/complaints?f_defect_type=' + encodeURIComponent(t.defect_type));
      body.append(r);
    }
  }, '#/complaints'));
  row.append(listCard('شکایات بر اساس محصول و واحد مسئول (۹۰ روز)', (body) => {
    const prods = bank.topProducts || []; const teams = bank.byTeam || [];
    if (!prods.length && !teams.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'داده‌ای وجود ندارد'));
    if (prods.length) {
      body.append(el('div', { class: 'muted small', style: 'padding:10px 16px 4px' }, 'محصولات پرتکرار:'));
      for (const p of prods) {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, p.name));
        r.append(el('span', { class: 'badge orange', style: 'margin-inline-start:8px' }, faDigits(p.c) + ' شکایت'));
        body.append(r);
      }
    }
    if (teams.length) {
      body.append(el('div', { class: 'muted small', style: 'padding:10px 16px 4px' }, 'بر اساس واحد مسئول:'));
      for (const t of teams) {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, statusFa(t.department) || t.department));
        r.append(el('span', { class: 'badge', style: 'margin-inline-start:8px' }, faDigits(t.c) + ' مورد'));
        r.style.cursor = 'pointer';
        r.addEventListener('click', () => location.hash = '#/complaints?f_department=' + encodeURIComponent(t.department));
        body.append(r);
      }
    }
  }, '#/complaints'));
  const row2 = el('div', { class: 'grid g-2 mt-16' });
  c.append(row2);
  row2.append(listCard('شکایات بر اساس خانواده محصول (۹۰ روز)', (body) => {
    const list = bank.byFamily || [];
    if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'داده‌ای وجود ندارد'));
    for (const f of list) {
      const r = rowItem(''); clear(r);
      r.append(el('span', {}, DEFECT_FAMILY_FA[f.defect_family] || f.defect_family));
      r.append(el('span', { class: 'badge gold', style: 'margin-inline-start:8px' }, faDigits(f.c) + ' مورد'));
      r.style.cursor = 'pointer';
      r.addEventListener('click', () => location.hash = '#/complaints?f_defect_family=' + encodeURIComponent(f.defect_family));
      body.append(r);
    }
  }, '#/complaints'));
  row2.append(listCard('روند شکایات (۶ ماه اخیر) و SLA', (body) => {
    const tr = bank.trend || [];
    if (tr.length) body.append(barChart(tr.map(x => ({ label: (x.m || '').slice(5), value: x.c })), { height: 140, format: (v) => faDigits(v) }));
    else body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'داده‌ای وجود ندارد'));
    body.append(el('div', { class: 'flex between small', style: 'padding:10px 4px 4px' },
      el('span', { class: 'muted' }, 'شکایات بازِ سررسیدگذشته (SLA breach):'),
      el('span', { class: 'badge ' + (bank.openSla > 0 ? 'red' : 'green') }, faDigits(bank.openSla || 0) + ' مورد')));
  }, '#/complaints'));
}

export async function myDashboard(c) {
  const head = el('div', { class: 'page-head' });
  const t1 = el('div');
  t1.append(el('h1', {}, 'داشبورد من'));
  t1.append(el('div', { class: 'sub' }, 'خوش آمدید، ' + (window.__me().user.full_name || '')));
  head.append(t1);
  const aiBtn = el('button', { class: 'btn gold' }, '🤖 دستیار هوشمند');
  aiBtn.addEventListener('click', () => location.hash = '#/ai/assistant');
  head.append(el('div', { class: 'actions' }, helpBtn('dashboard'), aiBtn));
  c.append(head, quickActions());
  const g = loadingGrid();
  c.append(g);
  let d;
  try { d = await api.get('/api/dashboard'); } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  clear(g);
  const k = d.kpi;
  g.append(statCardLink('فروش امروز', fmtMoney(k.salesToday), faDigits(k.salesTodayCount) + ' فاکتور — → لیست', I.cash, '#/invoices'));
  g.append(statCardLink('فروش این ماه', fmtMoney(k.salesMonth), (k.growth === null ? '' : (k.growth >= 0 ? '▲ ' : '▼ ') + faDigits(Math.abs(k.growth)) + '٪ نسبت به ماه قبل') + ' — ' + faDigits(k.salesMonthCount) + ' فاکتور — → لیست', I.cash, '#/invoices'));
  g.append(statCardLink('مشتریان فعال', faDigits(k.customers), faDigits(k.customersTotal) + ' مشتری کل — → لیست', I.users, '#/customers?f_status=active'));
  g.append(statCardLink('Pipeline', fmtMoney(k.pipelineValue), faDigits(k.pipelineCount) + ' فرصت باز — → قیف', I.target, '#/pipeline'));
  g.append(statCardLink('مطالبات باز', fmtMoney(k.receivables), 'فاکتورهای پرداخت‌نشده — → لیست', I.flag, '#/invoices?f_status=unpaid'));
  g.append(statCardLink('هشدارهای موجودی', faDigits(k.lowStock), faDigits(k.slaBreach) + ' شکایت از SLA عبور کرده — → لیست', I.warn, '#/stock/alerts'));
  // ---- VoIP / Calls (clickable drill-down) ----
  const callsRow = el('div', { class: 'grid g-4 mt-16' });
  c.append(callsRow);
  callsRow.append(statCardLink('☎ تماس‌های امروز', faDigits(k.callsToday || 0), faDigits(k.callsTalkMin || 0) + ' دقیقه مکالمه', I.phone, '#/calls'));
  callsRow.append(statCardLink('📞 ورودی امروز', faDigits(k.callsInbound || 0), 'تماس‌های ورودی', I.phone, '#/calls'));
  callsRow.append(statCardLink('📤 خروجی امروز', faDigits(k.callsOutbound || 0), 'تماس‌های خروجی', I.phone, '#/calls'));
  callsRow.append(statCardLink('🔴 از دست‌رفته', faDigits(k.callsMissed || 0), faDigits(k.callsUnfollowed || 0) + ' پیگیری‌نشده', I.phone, '#/calls/missed'));
  const row2 = el('div', { class: 'grid g-3 mt-16' });
  c.append(row2);
  row2.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'روند فروش ۱۲ ماه'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک روی نقطه = لیست فاکتورها')), el('div', { class: 'card-b' }, lineChart((d.series || []).map(s => ({ ...s, href: '#/invoices' })), { format: v => fmtNum(v / 1e6) + 'M' }))));
  const ordersCard = listCard('آخرین سفارش‌ها', (body) => {
    body.append(el('div', { class: 'skel', style: 'height:120px; margin:10px' }));
    api.get('/api/r/order?per_page=8').then(({ items }) => {
      clear(body);
      if (!items.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'سفارشی ثبت نشده است'));
      for (const o of items.slice(0, 6)) {
        const row = rowItem('');
        clear(row);
        row.append(el('span', {}, el('b', {}, o.number || ('#' + o.id)), ' — ' + (o.customer_name || '')));
        const r2 = el('span', { class: 'flex' });
        r2.append(el('span', { class: 'badge ' + (/in_production/.test(o.status) ? 'orange' : /delivered/.test(o.status) ? 'green' : '') }, statusFa(o.status)));
        r2.append(el('span', { class: 'money' }, fmtMoney(o.total)));
        row.append(r2);
        row.addEventListener('click', () => location.hash = '#/orders/' + o.id);
        body.append(row);
      }
    }).catch(() => clear(body).append(el('div', { class: 'muted small', style: 'padding:14px' }, 'خطا در بارگذاری')));
  }, '#/orders');
  row2.append(ordersCard);
  row2.append(el('div', {}, taskWidget(d.myTasks)));
  // AI Sales Intelligence (extended section — no duplicate KPIs)
  aiSalesIntelligence(c);
}
export async function roleDashboard(c, role, title) {
  const head = el('div', { class: 'page-head' });
  const t1 = el('div');
  t1.append(el('h1', {}, title));
  t1.append(el('div', { class: 'sub' }, 'بازدید ' + fmtDate(new Date().toISOString())));
  head.append(t1);
  const back = el('a', { class: 'btn sm', href: '#/' }, 'داشبورد من');
  head.append(el('div', { class: 'actions' }, helpBtn('dashboard'), back));
  c.append(head);
  const g = loadingGrid();
  c.append(g);
  let d;
  try { d = await api.get('/api/dashboard?role=' + role); } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  clear(g);
  const k = d.kpi;
  if (role === 'ceo' || role === 'super_admin') {
    c.insertBefore(aiSummaryBox(d.summary), g);
    g.append(statCardLink('فروش سال', fmtMoney(k.salesYear), faDigits(k.salesYearCount) + ' فاکتور — → لیست', I.cash, '#/invoices'));
    g.append(statCardLink('فروش این ماه', fmtMoney(k.salesMonth), (k.growth === null ? '' : (k.growth >= 0 ? '▲' : '▼') + ' ' + faDigits(Math.abs(k.growth)) + '٪ — → لیست'), I.cash, '#/invoices'));
    g.append(statCardLink('مطالبات باز', fmtMoney(k.receivables), 'فاکتورهای باز — → لیست', I.flag, '#/invoices?f_status=unpaid'));
    g.append(statCardLink('مشتریان در معرض ریزش', faDigits(k.churnCount), 'ریسک ۶۰+ از AI — → تحلیل', I.warn, '#/ai/churn'));
    g.append(statCardLink('Pipeline', fmtMoney(k.pipelineValue), faDigits(k.pipelineCount) + ' فرصت — → قیف', I.target, '#/pipeline'));
    g.append(statCardLink('شکایات باز', faDigits(k.complaintsOpen), faDigits(k.slaBreach) + ' مورد SLA breach — → لیست', I.flag, '#/complaints'));
    // ---- Calendar drill-down KPIs ----
    g.append(statCardLink('جلسات امروز', faDigits(k.meetingsToday || 0), '→ تقویم جلسات امروز', I.users, '#/calendar?type=meeting'));
    g.append(statCardLink('پیگیری‌های امروز', faDigits(k.followupsToday || 0), '→ تقویم پیگیری‌ها', I.target, '#/calendar?type=followup'));
    g.append(statCardLink('وظایف امروز', faDigits(k.tasksToday || 0), '→ تقویم وظایف', I.cash, '#/calendar?type=task'));
    g.append(statCardLink('فعالیت‌های عقب‌افتاده', faDigits(k.overdueToday || 0), '→ لیست عقب‌افتاده‌ها', I.warn, '#/calendar'));
    const row = el('div', { class: 'grid g-3 mt-16' });
    c.append(row);
    row.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'روند فروش'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک روی نقطه = لیست')), el('div', { class: 'card-b' }, lineChart((d.series || []).map(s => ({ ...s, href: '#/invoices' })), { format: v => fmtNum(v / 1e6) + 'M' }))));
    row.append(listCard('مشتریان برتر این ماه', (body) => {
      const list = (d.topCust || []).slice(0, 6);
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'داده‌ای وجود ندارد'));
      list.forEach((x, i) => {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, faDigits(i + 1) + '. ' + x.name));
        r.append(el('span', { class: 'money' }, fmtMoney(x.s)));
        if (x.id) r.addEventListener('click', () => location.hash = '#/customers/' + x.id);
        body.append(r);
      });
    }, '#/customers'));
    row.append(listCard('هشدارهای مهم', (body) => {
      const list = d.alerts || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'هشداری فعال نیست ✔'));
      for (const a of list) {
        const r = rowItem(''); clear(r);
        r.append(el('span', { class: 'badge ' + (a.type === 'sla' ? 'red' : a.type === 'payment' ? 'orange' : 'gold') }, a.type));
        r.append(el('span', {}, ' ' + a.text));
        const target = a.type === 'sla' ? '#/complaints' : a.type === 'payment' ? '#/invoices?f_status=unpaid' : '#/reports';
        r.style.cursor = 'pointer';
        r.addEventListener('click', () => location.hash = target);
        body.append(r);
      }
    }, '#/reports'));
    const row2 = el('div', { class: 'grid g-2 mt-16' });
    c.append(row2);
    row2.append(listCard('فرصت‌های داغ (احتمال ۷۰٪+)', (body) => {
      const list = d.hotOpps || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'فرصت داغی نیست'));
      for (const o of list.slice(0, 6)) {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, o.title + ' — ' + (o.name || '')));
        const rr = el('span', { class: 'flex' });
        rr.append(el('span', { class: 'badge gold' }, faDigits(o.probability) + '٪'));
        rr.append(el('span', { class: 'money' }, fmtMoney(o.amount)));
        r.append(rr);
        r.addEventListener('click', () => location.hash = '#/opportunities/' + o.id);
        body.append(r);
      }
    }, '#/opportunities'));
    row2.append(listCard('مشتریان در معرض ریزش', (body) => {
      const list = d.churn || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'مشتری در معرض ریزش ندارید ✔'));
      for (const x of list) {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, x.name));
        r.append(el('span', { class: 'badge red' }, 'ریسک ' + faDigits(x.score)));
        r.addEventListener('click', () => location.hash = '#/customers/' + x.id);
        body.append(r);
      }
    }, '#/customers?f_status=active'));
    complaintBankSection(c, d);
  } else if (role === 'sales_manager' || role === 'sales') {
    const ch = d.chain || {};
    g.append(statCardLink('فروش این ماه', fmtMoney(k.salesMonth), '→ گزارش فروش', I.cash, '#/reports'));
    g.append(statCardLink('Pipeline', fmtMoney(k.pipelineValue), faDigits(k.pipelineCount) + ' فرصت', I.target, '#/pipeline'));
    g.append(statCardLink('پیش‌فاکتورهای باز', faDigits((ch.openQuotes || {}).n || 0), fmtMoney((ch.openQuotes || {}).v || 0) + ' — → لیست', I.flag, '#/quotes'));
    g.append(statCardLink('سفارش‌های باز', faDigits((ch.openOrders || {}).n || 0), fmtMoney((ch.openOrders || {}).v || 0) + ' — → لیست', I.flag, '#/orders'));
    g.append(statCardLink('فاکتورهای باز (مانده)', fmtMoney((ch.openInvoices || {}).v || 0), faDigits((ch.openInvoices || {}).n || 0) + ' فاکتور — → لیست', I.warn, '#/invoices'));
    g.append(statCardLink('وصول این ماه', fmtMoney((ch.collectionsMonth || {}).s || 0), faDigits((ch.collectionsMonth || {}).c || 0) + ' پرداخت — → لیست', I.cash, '#/payments'));
    g.append(statCardLink('مطالبات کل', fmtMoney(k.receivables), '→ فاکتورهای بدهکار', I.flag, '#/invoices'));
    g.append(statCardLink('پورسانت در انتظار تأیید', fmtMoney((ch.commissions || {}).pending || 0), '→ مدیریت پورسانت', I.warn, '#/commission'));
    const row = el('div', { class: 'grid g-2 mt-16' });
    c.append(row);
    row.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'قیف فروش (Pipeline)'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک روی ستون = قیف')), el('div', { class: 'card-b' }, barChart((d.funnel || []).map(f => ({ label: f.name, value: f.c, href: '#/pipeline' })), { height: 180 }))));
    row.append(listCard('عملکرد کارشناسان (این ماه)', (body) => {
      const list = (d.perf || []).slice(0, 8);
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'داده‌ای وجود ندارد'));
      list.forEach((p, i) => {
        const r = rowItem(''); clear(r);
        r.append(el('span', {},
          el('span', {}, faDigits(i + 1) + '. ' + (p.full_name || '')),
          el('span', { class: 'muted' }, ' (' + faDigits(p.n) + ' فاکتور)')));
        r.append(el('span', { class: 'money' }, fmtMoney(p.s)));
        r.addEventListener('click', () => location.hash = '#/invoices');
        body.append(r);
      });
    }, '#/invoices'));
    const row2 = el('div', { class: 'grid g-3 mt-16' });
    c.append(row2);
    row2.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'روند فروش'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک روی نقطه = لیست')), el('div', { class: 'card-b' }, lineChart((d.series || []).map(s => ({ ...s, href: '#/invoices' })), { format: v => fmtNum(v / 1e6) + 'M' }))));
    row2.append(taskWidget(d.myTasks));
    row2.append(listCard('پیگیری‌های من', (body) => {
      const list = d.followups || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'پیگیری ندارید'));
      for (const f of list.slice(0, 6)) {
        const r = el('div', { class: 'small', style: 'padding:8px 16px; border-top:1px solid var(--border); cursor:pointer' }, '• ' + (f.subject || f.entity_type) + ' — ' + fmtDate(f.due_at, { time: true }));
        r.addEventListener('click', () => location.hash = '#/followups');
        body.append(r);
      }
    }, '#/followups'));
    // AI Sales Intelligence (extended section — no duplicate KPIs)
    aiSalesIntelligence(c);
  } else if (role === 'quality_manager') {
    g.append(statCardLink('شکایات باز', faDigits(k.complaintsOpen), '— → لیست', I.flag, '#/complaints'));
    g.append(statCardLink('رعایت SLA', d.slaCompliance !== undefined ? faDigits(d.slaCompliance) + '٪' : '—', 'از کل حل‌شده‌ها — → لیست', I.target, '#/complaints'));
    g.append(statCardLink('رضایت مشتری (CSAT)', d.csat !== null ? faDigits(d.csat) + ' / 5' : '—', '— → لیست شکایات', I.target, '#/complaints'));
    g.append(statCardLink('شکایات تکراری', faDigits(d.repeats), '— → لیست', I.warn, '#/complaints'));
    const row = el('div', { class: 'grid g-3 mt-16' });
    c.append(row);
    row.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'شکایات بر اساس دسته'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک = لیست')), el('div', { class: 'card-b' }, donut((d.byCat || []).map(x => ({ label: statusFa(x.category), value: x.c, href: '#/complaints' }))))));
    row.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'توزیع وضعیت'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک = لیست')), el('div', { class: 'card-b' }, donut((d.byStatus || []).map(x => ({ label: statusFa(x.status), value: x.c, href: '#/complaints?f_status=' + x.status }))))));
    row.append(listCard('علل ریشه‌ای (تحلیل AI)', (body) => {
      const list = d.rootCauses || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'داده کافی نیست'));
      for (const r of list) {
        const row2 = el('div', { class: 'small', style: 'padding:8px 16px; border-top:1px solid var(--border)' });
        row2.append(el('span', {}, r.ai_root_cause));
        row2.append(el('span', { class: 'badge gold', style: 'margin-inline-start:8px' }, faDigits(r.c) + ' مورد'));
        body.append(row2);
      }
    }));
    complaintBankSection(c, d);
  } else if (role === 'warehouse_manager') {
    g.append(statCardLink('ارزش کل موجودی', fmtMoney(d.stockValue), '— → موجودی کالا', I.box, '#/stock'));
    g.append(statCardLink('ارزش مواد اولیه', fmtMoney(d.rawMaterialValue), '— → موجودی مواد', I.box, '#/stock/raw'));
    g.append(statCardLink('هشدارهای کمبود', faDigits((d.lowStockItems || []).length), '— → لیست هشدارها', I.warn, '#/stock/alerts'));
    g.append(statCardLink('سفارش‌های باز', faDigits(k.openOrders), '— → لیست سفارش‌ها', I.flag, '#/orders'));
    const row = el('div', { class: 'grid g-2 mt-16' });
    c.append(row);
    row.append(listCard('کالاهای کم‌موجود', (body) => {
      const list = d.lowStockItems || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'کالایی در وضعیت کمبود نیست ✔'));
      for (const p of list) {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, p.name));
        const rr = el('span', { class: 'flex' });
        rr.append(el('span', { class: 'badge red' }, faDigits(p.stock_qty) + ' ' + p.unit));
        rr.append(el('span', { class: 'muted small' }, '/ حد ' + faDigits(p.reorder_point)));
        r.append(rr);
        r.addEventListener('click', () => location.hash = '#/stock/alerts');
        body.append(r);
      }
    }, '#/stock/alerts'));
    row.append(listCard('آخرین حرکات موجودی', (body) => {
      const list = d.moves || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'حرکتی ثبت نشده است'));
      for (const m of list.slice(0, 8)) {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, (m.name || '') + ' — ' + statusFa(m.type)));
        r.append(el('span', { class: 'num ' + (m.qty >= 0 ? '' : 'down') }, (m.qty >= 0 ? '+' : '') + fmtNum(m.qty)));
        r.addEventListener('click', () => location.hash = '#/stock/movements');
        body.append(r);
      }
    }, '#/stock/movements'));
  } else if (role === 'lab_manager') {
    const openCount = (d.byStatus || []).filter(x => ['received', 'in_progress'].includes(x.status)).reduce((a, b) => a + b.c, 0);
    g.append(statCardLink('درخواست‌های باز', faDigits(openCount), '— → لیست درخواست‌ها', I.flag, '#/lab/requests'));
    g.append(statCardLink('در انتظار پاسخ', faDigits((d.overdue || []).length), 'عبر از سررسید — → لیست', I.warn, '#/lab/requests'));
    const pf = d.passFail || [];
    const pCount = (pf.find(x => x.status === 'pass') || {}).c || 0;
    const fCount = (pf.find(x => x.status === 'fail') || {}).c || 0;
    g.append(statCardLink('نرخ عدم انطباق', (pCount + fCount) ? faDigits(Math.round(fCount / (pCount + fCount) * 100)) + '٪' : '—', 'در نتایج ثبت‌شده — → نتایج', I.flag, '#/lab/results'));
    const row = el('div', { class: 'grid g-2 mt-16' });
    c.append(row);
    row.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'درخواست‌ها بر اساس وضعیت'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک = لیست')), el('div', { class: 'card-b' }, donut((d.byStatus || []).map(x => ({ label: statusFa(x.status), value: x.c, href: '#/lab/requests' }))))));
    row.append(listCard('آخرین درخواست‌ها', (body) => {
      const list = d.recent || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'درخواستی ثبت نشده است'));
      for (const r of list.slice(0, 8)) {
        const row2 = rowItem(''); clear(row2);
        row2.append(el('span', {}, r.number + ' — ' + (r.sample_desc || '')));
        row2.append(el('span', { class: 'badge ' + (/reported|done/.test(r.status) ? 'green' : 'orange') }, statusFa(r.status)));
        row2.addEventListener('click', () => location.hash = '#/lab/requests');
        body.append(row2);
      }
    }, '#/lab/requests'));
  } else if (role === 'finance_manager') {
    g.append(statCardLink('فروش این ماه', fmtMoney(k.salesMonth), '→ گزارش فروش', I.cash, '#/reports'));
    g.append(statCardLink('وصول این ماه', fmtMoney(d.collections), faDigits(d.collectionsCount) + ' پرداخت — → لیست', I.cash, '#/payments'));
    g.append(statCardLink('مطالبات کل', fmtMoney(d.receivablesTotal !== undefined ? d.receivablesTotal : k.receivables), '→ گزارش مطالبات', I.warn, '#/reports'));
    g.append(statCardLink('سررسیدگذشته', fmtMoney((d.aging || {}).a1 || 0), 'بیش از ۳۰ روز — → لیست', I.warn, '#/invoices?f_status=overdue'));
    g.append(statCardLink('پورسانت معوق (در انتظار/تأییدشده)', fmtMoney(d.commissionsPayable), '→ مدیریت پورسانت', I.flag, '#/commission'));
    g.append(statCardLink('پورسانت پرداخت‌شده', fmtMoney(d.commissionsPaid || 0), '→ مدیریت پورسانت', I.cash, '#/commission'));
    const row = el('div', { class: 'grid g-2 mt-16' });
    c.append(row);
    row.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'بازسنجی مطالبات (Aging)'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک روی ستون = لیست')), el('div', { class: 'card-b' },
      barChart([
        { label: 'نسیه', value: (d.aging || {}).a0 || 0, color: '#9aa0ab', href: '#/invoices?f_status=unpaid' },
        { label: '۳۰+ روز', value: (d.aging || {}).a1 || 0, color: '#c0392b', href: '#/invoices?f_status=overdue' },
        { label: '۳۰ روز اخیر', value: (d.aging || {}).a2 || 0, color: '#c77d1f', href: '#/invoices?f_status=partial' },
        { label: 'آینده', value: (d.aging || {}).a3 || 0, color: '#2a9d8f', href: '#/invoices' },
      ], { height: 170, format: v => fmtNum(v / 1e6) + 'M' }))));
    row.append(listCard('بزرگ‌ترین بدهکاران', (body) => {
      const list = d.topDebtors || [];
      if (!list.length) body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'بدهکاری نیست ✔'));
      for (const x of list) {
        const r = rowItem(''); clear(r);
        r.append(el('span', {}, x.name));
        r.append(el('span', { class: 'money down' }, fmtMoney(x.s)));
        r.addEventListener('click', () => location.hash = '#/customers/' + x.id);
        body.append(r);
      }
    }, '#/invoices?f_status=unpaid'));
  }
}
export async function kpiPage(c) {
  const head = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'شاخص‌های کلیدی عملکرد (KPI)'), el('div', { class: 'sub' }, 'فروش • کارکنان • مشتری • خدمات • انبار')));
  head.append(el('div', { class: 'actions' }, helpBtn('dashboard')));
  c.append(head);
  let d;
  try { d = await api.get('/api/dashboard'); } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  const k = d.kpi;
  const row1 = el('div', { class: 'grid g-4 mb-16' });
  c.append(row1);
  row1.append(statCardLink('فروش ماه', fmtMoney(k.salesMonth), (k.growth === null ? '' : (k.growth >= 0 ? '▲' : '▼') + ' ' + faDigits(Math.abs(k.growth)) + '٪ — → لیست'), I.cash, '#/invoices'));
  row1.append(statCardLink('میانگین ارزش سفارش', k.salesMonthCount ? fmtMoney(k.salesMonth / k.salesMonthCount) : '—', '— → سفارش‌ها', I.target, '#/orders'));
  row1.append(statCardLink('ارزش Pipeline', fmtMoney(k.pipelineValue), faDigits(k.pipelineCount) + ' فرصت — → قیف', I.target, '#/pipeline'));
  row1.append(statCardLink('مطالبات باز', fmtMoney(k.receivables), '— → لیست', I.flag, '#/invoices?f_status=unpaid'));
  const row2 = el('div', { class: 'grid g-3' });
  c.append(row2);
  row2.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'روند فروش ۱۲ ماه'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک روی نقطه = لیست')), el('div', { class: 'card-b' }, lineChart((d.series || []).map(s => ({ ...s, href: '#/invoices' })), { format: v => fmtNum(v / 1e6) + 'M' }))));
  row2.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'وضعیت مشتریان'), el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'کلیک = لیست')), el('div', { class: 'card-b' },
    donut([
      { label: 'فعال', value: k.customers, color: '#1e8e63', href: '#/customers?f_status=active' },
      { label: 'غیرفعال', value: Math.max(0, k.customersTotal - k.customers), color: '#9aa0ab', href: '#/customers?f_status=inactive' },
      { label: 'در معرض ریزش', value: k.churnCount, color: '#c0392b', href: '#/ai/churn' },
    ]))));
  const svcRows = [
    ['شکایات باز', faDigits(k.complaintsOpen), '#/complaints'],
    ['SLA breach', faDigits(k.slaBreach), '#/complaints'],
    ['سفارش‌های باز', faDigits(k.openOrders), '#/orders'],
    ['هشدار موجودی', faDigits(k.lowStock), '#/stock/alerts'],
  ];
  const svc = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'خدمات پس از فروش')), el('div', { class: 'card-b' },
    el('dl', { class: 'kv' }, ...svcRows.flatMap(([l, v, href]) => [
      el('dt', {}, l),
      el('dd', { style: 'cursor:pointer', onclick: () => location.hash = href }, v),
    ]))));
  const perf = el('div', { class: 'card mt-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'عملکرد کارکنان (ماه جاری)')), el('div', { class: 'tbl-wrap skel', style: 'height:120px' }));
  c.append(perf);
  api.get('/api/dashboard?role=sales_manager').then(r => {
    perf.querySelector('.tbl-wrap').classList.remove('skel');
    perf.querySelector('.tbl-wrap').innerHTML = '';
    const rows = (r.perf || []).map(p => el('tr', {}, el('td', {}, p.full_name), el('td', { class: 'num' }, fmtMoney(p.s)), el('td', {}, faDigits(p.n)), el('td', {}, faDigits(p.d || 0)), el('td', {}, faDigits(p.f || 0))));
    perf.querySelector('.tbl-wrap').append(el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'کارشناس'), el('th', {}, 'فروش ماه'), el('th', {}, 'فاکتور'), el('th', {}, 'وظایف انجام‌شده'), el('th', {}, 'پیگیری‌ها'))),
      el('tbody', {}, rows)));
  }).catch(() => {});
}
