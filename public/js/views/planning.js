'use strict';
import { api, t, fmtDate, fmtDateLong, faDigits, statusFa, jalaliLib } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState } from '../ui.js';
import { ResourceView, iconBtn, parseJalaaliInput } from '../resource-view.js';
import { customerSelect } from '../customer-select.js';
import { bindDatePick } from '../datepick.js';
import { helpBtn } from './help.js';

export function tasksView(c) {
  const v = new ResourceView({ res: 'task', title: 'وظایف', quickAction: 'وظیفه جدید' });
  c.append(v.root);
}
export function followupsView(c) {
  const v = new ResourceView({ res: 'followup', title: 'پیگیری‌ها', quickAction: 'پیگیری جدید' });
  // custom NEW form: entity type + real Customer Master selector
  const origOpen = v.openForm.bind(v);
  v.openForm = (id = null, preset = null) => (id ? origOpen(id, preset) : followupNewForm(v, preset));
  // multi-follow-up: attempts history + next-reminder inside the detail view
  v.detailActions = (item, ov) => followupAttemptsSection(item, ov, () => v.openDetail(item.id), () => v.load());
  c.append(v.root);
}

const ATTEMPT_METHODS = [['call', 'تماس تلفنی'], ['meeting', 'جلسه'], ['email', 'ایمیل'], ['message', 'پیام'], ['visit', 'بازدید حضوری'], ['other', 'سایر']];
function followupAttemptsSection(item, ov, refreshDetail, refreshList) {
  const box = el('div', { class: 'card mb-16' },
    el('div', { class: 'card-h' }, el('h3', {}, 'تاریخچه پیگیری‌ها (Follow-up Attempts)'),
      el('button', { class: 'btn sm gold', style: 'margin-inline-start:auto', id: 'fu-add-attempt' }, '＋ ثبت پیگیری جدید')));
  const listBox = el('div');
  box.append(listBox);
  async function loadAttempts() {
    clear(listBox);
    try {
      const r = await api.get('/api/followups/' + item.id + '/attempts');
      if (!r.items.length) return listBox.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'هنوز پیگیری‌ای برای این موضوع ثبت نشده است. با «ثبت پیگیری جدید» اولین تلاش را ثبت کنید.'));
      const line = (a) => el('div', { class: 'tl-item' },
        el('div', { class: 'tl-t' }, el('b', { class: 'small' }, (ATTEMPT_METHODS.find(m => m[0] === a.method) || ['','—'])[1] + ': ' + (a.result || '—')),
          a.note ? el('div', { class: 'small muted' }, a.note) : null),
        el('div', { class: 'tl-d' }, (a.user_name || '') + (a.user_name ? ' — ' : '') + fmtDate(a.acted_at, { time: true }) + (a.next_followup_at ? ' • ↻ پیگیری بعدی: ' + fmtDate(a.next_followup_at, { time: true }) : '')));
      listBox.append(el('div', { class: 'timeline' }, r.items.map(line)));
    } catch (e) { listBox.append(el('div', { class: 'alert danger small' }, e.message)); }
  }
  // parent status control (Open → final result)
  const stSel = el('select', {},
    el('option', { value: 'pending' }, 'باز (Open)'),
    el('option', { value: 'in_progress' }, 'در حال پیگیری (In Progress)'),
    el('option', { value: 'done' }, 'پایان‌بندی شد (Completed)'),
    el('option', { value: 'no_result' }, 'بدون نتیجه (No Result)'),
    el('option', { value: 'cancelled' }, 'لغو (Cancelled)'));
  stSel.value = item.status || 'pending';
  const stWrap = el('div', { class: 'field small' }, el('label', {}, 'وضعیت اصلی پیگیری'),
    el('div', { class: 'flex', style: 'gap:6px' }, stSel,
      el('button', { class: 'btn sm', id: 'fu-set-status' }, 'ذخیره وضعیت')));
  stWrap.querySelector('#fu-set-status').addEventListener('click', async () => {
    try {
      await api.post('/api/followups/' + item.id + '/status', { status: stSel.value });
      toast('وضعیت به‌روزرسانی شد', 'ok');
      if (refreshDetail) refreshDetail(); else if (ov && ov.close) ov.close();
      if (refreshList) refreshList();
    } catch (e) { toast(e.message, 'err'); }
  });
  box.append(el('div', { style: 'padding:0 16px 14px' }, stWrap));
  box.querySelector('#fu-add-attempt').addEventListener('click', () => attemptForm(item, () => {
    loadAttempts();
    // server may have flipped parent pending → in_progress; refresh the grid too
    if (refreshDetail) { try { refreshDetail(); } catch { /* detail re-open optional */ } }
    if (refreshList) refreshList();
  }));
  loadAttempts();
  return box;
}
function attemptForm(item, onSaved) {
  const methodSel = el('select', {}, ATTEMPT_METHODS.map(([v, l]) => el('option', { value: v }, l)));
  const whenIn = el('input', { placeholder: 'تاریخ و ساعت این پیگیری (پیش‌فرض: الان)', style: 'cursor:pointer' });
  whenIn._dp = bindDatePick(whenIn, { withTime: true });
  const resultIn = el('input', { placeholder: 'نتیجهٔ پیگیری * (مثلاً: تماس شد — هنوز تصمیم نگرفته)' });
  const noteIn = el('textarea', { placeholder: 'توضیحات (اختیاری)' });
  const nextIn = el('input', { placeholder: 'زمان پیگیری بعدی / Reminder (اختیاری)', style: 'cursor:pointer' });
  nextIn._dp = bindDatePick(nextIn, { withTime: true });
  const ov = openModal('ثبت پیگیری جدید (Attempt)', el('div', { class: 'form-grid' },
    el('div', { class: 'field' }, el('label', {}, 'نحوهٔ پیگیری'), methodSel),
    el('div', { class: 'field' }, el('label', {}, 'تاریخ و ساعت'), whenIn),
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'نتیجه *'), resultIn),
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'توضیحات'), noteIn),
    el('div', { class: 'field' }, el('label', {}, 'پیگیری بعدی (Reminder)'), nextIn),
  ), { footer: [
    el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
    el('button', { class: 'btn primary', onclick: async (e) => {
      if (!resultIn.value.trim()) return toast('نتیجهٔ پیگیری الزامی است', 'err');
      e.target.disabled = true;
      const payload = {
        method: methodSel.value,
        acted_at: (whenIn._dp && whenIn._dp.get()) || new Date().toISOString(),
        result: resultIn.value.trim(),
        note: noteIn.value.trim() || null,
        next_followup_at: (nextIn._dp && nextIn._dp.get()) || null,
      };
      try {
        await api.post('/api/followups/' + item.id + '/attempts', payload);
        toast('پیگیری ثبت شد' + (payload.next_followup_at ? ' — یادآوری در تقویم/اعلانات تنظیم شد' : ''), 'ok');
        ov.close(); onSaved && onSaved();
      } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
    } }, t('save')),
  ] });
  return ov;
}
const FOLLOWUP_ENTITIES = [
  { v: 'customer', l: 'مشتری' }, { v: 'lead', l: 'سرنخ' }, { v: 'opportunity', l: 'فرصت فروش' },
  { v: 'order', l: 'سفارش' }, { v: 'invoice', l: 'فاکتور' }, { v: 'complaint', l: 'شکایت' },
  { v: 'ticket', l: 'تیکت' }, { v: 'meeting', l: 'جلسه' }, { v: 'task', l: 'وظیفه' }, { v: 'other', l: 'سایر' },
];
function followupNewForm(v, preset) {
  const ov = openModal('پیگیری جدید', null, { large: true, footer: [] });
  const body = el('div', { class: 'form-grid' });
  ov.body.append(body);
  const subject = el('input', { placeholder: 'موضوع پیگیری…' });
  const typeSel = el('select', {}, FOLLOWUP_ENTITIES.map(o => el('option', { value: o.v }, o.l)));
  const entityBox = el('div');
  let entityCtrl = null;
  const entityIdIn = el('input', { type: 'number', placeholder: 'شناسه رکورد', dir: 'ltr', style: 'display:none' });
  const userSel = el('select', {}, el('option', { value: '' }, '— خودم —'));
  api.get('/api/r/user?per_page=200').then(r => { for (const u of (r.items || [])) userSel.append(el('option', { value: u.id }, u.name)); }).catch(() => {});
  const dueIn = el('input', { placeholder: 'انتخاب زمان پیگیری از تقویم…', style: 'cursor:pointer' });
  dueIn._dp = bindDatePick(dueIn, { withTime: true });
  const noteIn = el('input', { placeholder: 'توضیح (اختیاری)' });
  function syncEntity() {
    clear(entityBox);
    entityCtrl = null;
    if (typeSel.value === 'customer') {
      entityCtrl = customerSelect({ value: null, onChange: () => {} });
      entityBox.append(entityCtrl);
      entityIdIn.style.display = 'none';
    } else {
      entityIdIn.style.display = '';
      entityBox.append(entityIdIn);
    }
  }
  typeSel.addEventListener('change', syncEntity);
  syncEntity();
  body.append(
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'موضوع *'), subject),
    el('div', { class: 'field' }, el('label', {}, 'نوع رکورد'), typeSel),
    el('div', { class: 'field' }, el('label', {}, typeSel.value === 'customer' ? 'مشتری (از Master Data)' : 'شناسه رکورد'), entityBox),
    el('div', { class: 'field' }, el('label', {}, 'مسئول پیگیری'), userSel),
    el('div', { class: 'field' }, el('label', {}, 'زمان پیگیری *'), dueIn),
    el('div', { class: 'field' }, el('label', {}, 'توضیح'), noteIn));
  const foot = el('div', { class: 'flex', style: 'gap:8px' },
    el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
    el('button', { class: 'btn primary', onclick: async () => {
      if (!subject.value.trim()) return toast('موضوع الزامی است', 'err');
      const entityId = typeSel.value === 'customer' ? (entityCtrl ? entityCtrl.value : null) : (entityIdIn.value ? Number(entityIdIn.value) : null);
      if (typeSel.value !== 'other' && !entityId) return toast(typeSel.value === 'customer' ? 'مشتری را انتخاب کنید' : 'شناسه رکورد را وارد کنید', 'err');
      const due = dueIn._dp ? dueIn._dp.get() : parseJalaaliInput(dueIn.value);
      if (!due) return toast('زمان پیگیری معتبر نیست (فرمت: ۱۴۰/۰/۱۰ ۴:۳۰)', 'err');
      try {
        await api.post('/api/r/followup', {
          entity_type: typeSel.value, entity_id: entityId || 0, subject: subject.value.trim(),
          user_id: userSel.value ? Number(userSel.value) : (window.__me().user.id),
          due_at: due, note: noteIn.value.trim() || null, status: 'pending',
        });
        toast('پیگیری ثبت شد', 'ok'); ov.close(); v.load();
      } catch (e) { toast(e.message, 'err'); }
    } }, t('save')));
  // move footer buttons into the modal footer
  const mFoot = ov.modal.querySelector('.m-f');
  if (mFoot) mFoot.append(...foot.children); else ov.modal.append(foot);
  return ov;
}
// ===================== Calendar & Planning (Jalaali, full-featured) =====================

const WD = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const EVT_FA = {
  meeting: 'جلسه', call: 'تماس', followup: 'پیگیری', task: 'وظیفه', reminder: 'یادآوری',
  sales: 'فعالیت فروش', rd: 'فعالیت R&D', qc: 'فعالیت QC', lab: 'فعالیت آزمایشگاه',
  project: 'فعالیت پروژه', approval: 'تأیید', deadline: 'مهلت', contract_expiry: 'انقضای قرارداد', other: 'سایر',
};
const EVT_COLOR_DEFAULT = {
  meeting: '#7c5cd6', call: '#3b82f6', followup: '#2a9d8f', task: '#c9622a', reminder: '#8b5cf6',
  sales: '#c9a227', rd: '#0ea5e9', qc: '#ef4444', lab: '#14b8a6', project: '#f59e0b',
  approval: '#6366f1', deadline: '#dc2626', contract_expiry: '#b91c1c', other: '#6b7280',
};
const STATUS_FA = { scheduled: 'برنامه‌ریزی‌شده', done: 'انجام‌شده', cancelled: 'لغوشده', pending: 'در انتظار', open: 'باز', in_progress: 'در حال انجام', unpaid: 'پرداخت‌نشده', partial: 'پرداخت جزئی', overdue: 'سررسیدگذشته', active: 'فعال', draft: 'پیش‌نویس', received: 'دریافت‌شده', new: 'جدید', waiting: 'در انتظار', converted: 'تبدیل‌شده', open2: 'باز' };
const PRIO_FA = { low: 'کم', medium: 'متوسط', high: 'زیاد', critical: 'بحرانی' };
const REMINDERS = [
  { v: '', l: 'بدون یادآوری' }, { v: 5, l: '۵ دقیقه قبل' }, { v: 10, l: '۱۰ دقیقه قبل' },
  { v: 15, l: '۱۵ دقیقه قبل' }, { v: 30, l: '۳۰ دقیقه قبل' }, { v: 60, l: '۱ ساعت قبل' },
  { v: 1440, l: '۱ روز قبل' }, { v: 'custom', l: 'زمان سفارشی…' },
];
const RECUR = [
  { v: 'none', l: 'تکراری نیست' }, { v: 'daily', l: 'روزانه' }, { v: 'weekly', l: 'هفتگی' },
  { v: 'monthly', l: 'ماهانه' }, { v: 'yearly', l: 'سالانه' }, { v: 'custom', l: 'سفارشی' },
];
const SOURCE_URL = {
  meeting: '/meetings', task: '/tasks', followup: '/followups', opportunity: '/opportunities',
  invoice: '/invoices', contract: '/contracts', lab_request: '/lab/requests', complaint: '/complaints',
  ticket: '/tickets', calendar_event: '/calendar', warranty: '/warranties',
};
const SOURCE_FA = {
  meeting: 'جلسه', task: 'وظیفه', followup: 'پیگیری', opportunity: 'فرصت فروش',
  invoice: 'فاکتور', contract: 'قرارداد', lab_request: 'درخواست آزمایش', complaint: 'شکایت',
  ticket: 'تیکت', calendar_event: 'رویداد تقویم', warranty: 'گارانتی',
};

function jToISO(jy, jm, jd, hour = 12, min = 0) {
  const g = jalaliLib().toGregorian(jy, jm, jd);
  return new Date(g.gy, g.gm - 1, g.gd, hour, min, 0).toISOString();
}
function isoToJ(iso) { const d = new Date(iso); return jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function jKey(jy, jm, jd) { return jy * 10000 + jm * 100 + jd; }
function jStr(j) { return faDigits(j.jy) + '/' + faDigits(String(j.jm).padStart(2, '0')) + '/' + faDigits(String(j.jd).padStart(2, '0')); }
function hhmm(d) { return faDigits(String(d.getHours()).padStart(2, '0')) + ':' + faDigits(String(d.getMinutes()).padStart(2, '0')); }
function todayJ() { const n = new Date(); return jalaliLib().toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate()); }
function parseShamsi(s) {
  const m = String(s || '').trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (jm < 1 || jm > 12) return null;
  if (jd < 1 || jd > jalaliLib().monthLength(jy, jm)) return null; // invalid (e.g. Esfand 30 non-leap)
  return { jy, jm, jd };
}
function hashParams() {
  const h = location.hash || '';
  const qi = h.indexOf('?');
  if (qi < 0) return {};
  const p = {};
  for (const [k, v] of new URLSearchParams(h.slice(qi + 1))) p[k] = v;
  return p;
}

export async function calendarView(c) {
  const me = (window.__me && window.__me()) || { user: { id: 1 } };
  const initParams = hashParams();
  const state = {
    mode: 'month', jy: 0, jm: 0, jd: 0,
    filters: {
      types: new Set(Object.keys(EVT_FA)), users: new Set([me.user.id]), departments: new Set(),
      status: '', priority: '', customerId: '', holidays: true,
    },
    colors: { ...EVT_COLOR_DEFAULT },
    teams: { users: [], departments: [] },
    holidays: {},
  };
  let colorsLoaded = false;

  // ---- load user color settings + teams ----
  try { const r = await api.get('/api/calendar/colors'); if (r && r.colors) state.colors = r.colors; } catch {}
  colorsLoaded = true;
  try { state.teams = await api.get('/api/calendar/teams'); } catch {}

  // ---- header ----
  const searchIn = el('input', { class: 'input', placeholder: 'جستجو در عنوان، مشتری، مسئول…', style: 'width:220px' });
  let searchTimer = null;
  searchIn.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 400); });
  const cHead = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'تقویم و برنامه‌ریزی کاری'), el('div', { class: 'sub' }, 'جلسات، وظایف، پیگیری‌ها، سررسیدها و رویدادهای سازمانی — تقویم شمسی')),
    el('div', { class: 'actions' },
      helpBtn('calendar'),
      searchIn,
      el('button', { class: 'btn sm', id: 'cal-prev', title: 'قبلی' }, '→'),
      el('b', { id: 'cal-title', style: 'min-width:200px; text-align:center' }, ''),
      el('button', { class: 'btn sm', id: 'cal-next', title: 'بعدی' }, '←'),
      el('button', { class: 'btn sm', id: 'cal-today' }, 'امروز'),
      el('button', { class: 'btn sm', id: 'cal-month' }, 'ماه'),
      el('button', { class: 'btn sm', id: 'cal-week' }, 'هفته'),
      el('button', { class: 'btn sm', id: 'cal-day' }, 'روز'),
      el('button', { class: 'btn sm', id: 'cal-agenda' }, 'آجندای'),
      el('button', { class: 'btn sm', id: 'cal-report' }, '📊 گزارش'),
      el('button', { class: 'btn sm', id: 'cal-ai' }, '🤖 AI تقویم'),
      el('button', { class: 'btn sm', id: 'cal-settings' }, '⚙'),
      el('button', { class: 'btn gold sm', id: 'cal-add' }, '＋ رویداد جدید')));
  c.append(cHead);

  // ---- layout: sidebar + main ----
  const wrap = el('div', { class: 'cal-layout' });
  const side = el('aside', { class: 'cal-side' });
  const main = el('section', { class: 'cal-main' });
  wrap.append(side, main);
  c.append(wrap);

  // ---- sidebar: team calendars ----
  const teamsBox = el('div', { class: 'cal-side-box' }, el('h4', {}, 'تقویم تیمی'));
  const meChk = el('input', { type: 'checkbox', checked: true });
  meChk.addEventListener('change', () => { if (meChk.checked) state.filters.users.add(me.user.id); else state.filters.users.delete(me.user.id); render(); });
  teamsBox.append(el('label', { class: 'cal-team-row' }, meChk, el('span', { class: 'dot', style: 'background:#c9a227' }), el('b', {}, 'تقویم من')));
  const deptGroups = {};
  for (const u of state.teams.users || []) { if (u.id === me.user.id) continue; (deptGroups[u.department || 'بدون واحد'] = deptGroups[u.department || 'بدون واحد'] || []).push(u); }
  for (const [dept, us] of Object.entries(deptGroups)) {
    const dChk = el('input', { type: 'checkbox' });
    const row = el('label', { class: 'cal-team-row dept' }, dChk, el('b', {}, 'تقویم ' + dept));
    dChk.addEventListener('change', () => { for (const u of us) { if (dChk.checked) state.filters.users.add(u.id); else state.filters.users.delete(u.id); } render(); });
    teamsBox.append(row);
    for (const u of us) {
      const uChk = el('input', { type: 'checkbox' });
      uChk.addEventListener('change', () => { if (uChk.checked) state.filters.users.add(u.id); else state.filters.users.delete(u.id); render(); });
      teamsBox.append(el('label', { class: 'cal-team-row sub' }, uChk, el('span', { class: 'dot', style: 'background:' + deptDot(u) }), el('span', {}, u.full_name)));
    }
  }
  function deptDot(u) { const i = (u.department || '').length; const cols = ['#7c5cd6', '#2a9d8f', '#c9a227', '#3b82f6', '#0ea5e9', '#f59e0b']; return cols[i % cols.length]; }
  side.append(teamsBox);

  // ---- sidebar: activity types ----
  const typesBox = el('div', { class: 'cal-side-box' }, el('h4', {}, 'انواع فعالیت'));
  for (const [k, fa] of Object.entries(EVT_FA)) {
    const chk = el('input', { type: 'checkbox', checked: true });
    chk.addEventListener('change', () => { if (chk.checked) state.filters.types.add(k); else state.filters.types.delete(k); render(); });
    typesBox.append(el('label', { class: 'cal-team-row' }, chk, el('span', { class: 'dot', style: 'background:' + (state.colors[k] || '#666') }), el('span', {}, fa)));
  }
  side.append(typesBox);

  // ---- sidebar: filters ----
  const fBox = el('div', { class: 'cal-side-box' }, el('h4', {}, 'فیلترها'));
  const statusSel = el('select', {}, el('option', { value: '' }, 'همه وضعیت‌ها'), el('option', { value: 'scheduled' }, 'برنامه‌ریزی‌شده'), el('option', { value: 'done' }, 'انجام‌شده'), el('option', { value: 'cancelled' }, 'لغوشده'));
  statusSel.addEventListener('change', () => { state.filters.status = statusSel.value; render(); });
  const prioSel = el('select', {}, el('option', { value: '' }, 'همه اولویت‌ها'), el('option', { value: 'low' }, 'کم'), el('option', { value: 'medium' }, 'متوسط'), el('option', { value: 'high' }, 'زیاد'), el('option', { value: 'critical' }, 'بحرانی'));
  prioSel.addEventListener('change', () => { state.filters.priority = prioSel.value; render(); });
  const custSel = el('select', {}, el('option', { value: '' }, 'همه مشتریان'));
  custSel.addEventListener('change', () => { state.filters.customerId = custSel.value; render(); });
  api.get('/api/r/customer?per_page=200').then(({ items }) => { for (const cu of items) custSel.append(el('option', { value: cu.id }, cu.name)); }).catch(() => {});
  const holChk = el('input', { type: 'checkbox', checked: true });
  holChk.addEventListener('change', () => { state.filters.holidays = holChk.checked; render(); });
  fBox.append(
    el('div', { class: 'field' }, el('label', {}, 'وضعیت'), statusSel),
    el('div', { class: 'field' }, el('label', {}, 'اولویت'), prioSel),
    el('div', { class: 'field' }, el('label', {}, 'مشتری'), custSel),
    el('label', { class: 'cal-team-row' }, holChk, el('span', {}, 'نمایش تعطیلات رسمی')));
  side.append(fBox);

  // ---- main: calendar box + panels ----
  const box = el('div', { class: 'card cal-card' });
  const panels = el('div', { class: 'cal-panels' });
  const aiBox = el('div', { class: 'card cal-ai hidden' });
  main.append(box, panels, aiBox);

  // ---- controls ----
  const titleEl = cHead.querySelector('#cal-title');
  cHead.querySelector('#cal-prev').addEventListener('click', () => nav(-1));
  cHead.querySelector('#cal-next').addEventListener('click', () => nav(1));
  cHead.querySelector('#cal-today').addEventListener('click', () => { const t = todayJ(); state.jy = t.jy; state.jm = t.jm; state.jd = t.jd; render(); });
  cHead.querySelector('#cal-add').addEventListener('click', () => eventForm(null));
  cHead.querySelector('#cal-report').addEventListener('click', () => reportModal());
  cHead.querySelector('#cal-settings').addEventListener('click', () => settingsModal());
  cHead.querySelector('#cal-ai').addEventListener('click', () => { aiBox.classList.toggle('hidden'); if (!aiBox.classList.contains('hidden') && !aiBox.dataset.init) initAi(); });
  for (const [id, mode] of [['cal-month', 'month'], ['cal-week', 'week'], ['cal-day', 'day'], ['cal-agenda', 'agenda']]) {
    cHead.querySelector('#' + id).addEventListener('click', () => { state.mode = mode; render(); });
  }

  // initial position (deep-link support)
  {
    const t = todayJ();
    state.jy = t.jy; state.jm = t.jm; state.jd = t.jd;
    if (initParams.type && EVT_FA[initParams.type]) { state.filters.types = new Set([initParams.type]); }
    if (initParams.date) { const p = parseShamsi(initParams.date); if (p) { state.jy = p.jy; state.jm = p.jm; state.jd = p.jd; } }
    if (initParams.status) state.filters.status = initParams.status;
    if (initParams.customer) state.filters.customerId = initParams.customer;
  }

  function nav(dir) {
    if (state.mode === 'month') { state.jm += dir; if (state.jm < 1) { state.jm = 12; state.jy--; } if (state.jm > 12) { state.jm = 1; state.jy++; } }
    else if (state.mode === 'agenda') { state.jd += dir * 14; rollJ(); }
    else { state.jd += dir * (state.mode === 'week' ? 7 : 1); rollJ(); }
    render();
  }
  function rollJ() {
    // normalize jd (may be 0 or > monthLength after arithmetic on Gregorian-safe shift)
    const g = jalaliLib().toGregorian(state.jy, state.jm, Math.max(1, state.jd));
    const d = new Date(g.gy, g.gm - 1, g.gd);
    d.setDate(d.getDate() + (state.jd - Math.max(1, state.jd)));
    const j = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    state.jy = j.jy; state.jm = j.jm; state.jd = j.jd;
  }

  // ---- data ----
  async function fetchRange(fromIso, toIso) {
    const f = state.filters;
    const q = new URLSearchParams({ from: fromIso, to: toIso, per_page: '500', holidays: f.holidays ? '1' : '0' });
    if (f.status) q.set('status', f.status);
    if (f.priority) q.set('priority', f.priority);
    if (f.customerId) q.set('customer_id', f.customerId);
    if (searchIn.value.trim()) q.set('q', searchIn.value.trim());
    // user filter: apply client-side for derived (server scopes by permission)
    const r = await api.get('/api/calendar/events?' + q.toString());
    let evs = r.events || [];
    if (f.types.size < Object.keys(EVT_FA).length) evs = evs.filter(e => f.types.has(e.type));
    if (f.users.size) evs = evs.filter(e => !e.users || !e.users.length || e.users.some(u => f.users.has(u.id)) || e.editable);
    evs.forEach(e => { e._color = (e.editable && e.color) ? e.color : (state.colors[e.type] || e.color || '#666'); });
    return { events: evs, holidays: r.holidays || [] };
  }

  async function render() {
    for (const [id, mode] of [['cal-month', 'month'], ['cal-week', 'week'], ['cal-day', 'day'], ['cal-agenda', 'agenda']]) {
      const b = cHead.querySelector('#' + id);
      if (b) b.className = 'btn sm' + (state.mode === mode ? ' gold' : '');
    }
    clear(box);
    box.append(el('div', { class: 'skel', style: 'height:260px' }));
    try {
      if (state.mode === 'month') await renderMonth();
      else if (state.mode === 'week') await renderWeek();
      else if (state.mode === 'day') await renderDay();
      else await renderAgenda();
    } catch (e) {
      clear(box).append(el('div', { class: 'alert danger' }, 'خطا: ' + e.message));
    }
    renderPanels();
  }

  function holidayFor(jy, jm, jd) {
    const k = jy * 10000 + jm * 100 + jd;
    return state.holidays[k] || null;
  }
  function evChip(ev, compact = false) {
    const stateCls = ev.status === 'done' ? ' done' : ev.status === 'missed' ? ' missed' : ev.status === 'cancelled' ? ' cancelled' : '';
    const stateFa = { done: ' (انجام‌شده)', missed: ' (از دست رفته)', cancelled: ' (لغوشده)' }[ev.status] || '';
    const ch = el('div', { class: 'cal-ev' + stateCls, style: 'background:' + ev._color, title: ev.title + stateFa + (ev.customer ? ' — ' + ev.customer.name : ''), draggable: ev.editable ? 'true' : 'false' });
    ch.textContent = ev.title;
    if (ev.editable) {
      ch.addEventListener('dragstart', (e2) => { e2.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'event', id: ev.ref_id, start: ev.occurrence_start || ev.start, end: ev.end, recurring: !!ev.is_occurrence })); });
    }
    ch.addEventListener('click', (e2) => { e2.stopPropagation(); evDetail(ev); });
    return ch;
  }

  async function renderMonth() {
    titleEl.textContent = MONTHS_FA[state.jm - 1] + ' ' + faDigits(state.jy);
    const firstG = jalaliLib().toGregorian(state.jy, state.jm, 1);
    const firstDate = new Date(firstG.gy, firstG.gm - 1, firstG.gd);
    const nDays = jalaliLib().monthLength(state.jy, state.jm);
    const startOffset = (firstDate.getDay() + 1) % 7; // Saturday=0
    const rangeStart = new Date(firstDate.getTime() - startOffset * 864e5);
    const rangeEnd = new Date(firstDate.getTime() + (nDays - 1) * 864e5 + 864e5);
    const { events, holidays } = await fetchRange(rangeStart.toISOString(), rangeEnd.toISOString());
    for (const h of holidays) state.holidays[h.jy * 10000 + h.jm * 100 + h.jd] = h;
    const byDay = {};
    for (const ev of events) { const j = isoToJ(ev.occurrence_start || ev.start); if (j.jy === state.jy && j.jm === state.jm) (byDay[j.jd] = byDay[j.jd] || []).push(ev); }
    const head = el('div', { class: 'cal-head' });
    for (let i = 0; i < 7; i++) head.append(el('div', { class: i === 6 ? 'fri' : '' }, WD[i]));
    const grid = el('div', { class: 'cal-grid' });
    box.append(head, grid);
    for (let i = 0; i < startOffset; i++) grid.append(el('div', { class: 'cal-cell out' }));
    const tJ = todayJ();
    for (let d = 1; d <= nDays; d++) {
      const hol = holidayFor(state.jy, state.jm, d);
      const isFri = (firstDate.getDay() + (d - 1)) % 7 === 6;
      const cell = el('div', { class: 'cal-cell' + (tJ.jy === state.jy && tJ.jm === state.jm && tJ.jd === d ? ' today' : '') + (isFri ? ' fri' : '') + (hol ? ' holiday' : '') });
      cell.append(el('div', { class: 'cal-cell-top' }, el('span', { class: 'd' }, faDigits(d)), hol ? el('span', { class: 'hol-badge', title: hol.names.join('، ') }, '🎉') : null));
      const evs = (byDay[d] || []).slice().sort((a, b) => String(a.occurrence_start).localeCompare(String(b.occurrence_start)));
      for (const ev of evs.slice(0, 4)) cell.append(evChip(ev));
      if (evs.length > 4) cell.append(el('div', { class: 'muted small' }, '+' + faDigits(evs.length - 4)));
      cell.addEventListener('click', (e) => { if (e.target.closest('.cal-ev')) return; eventForm(null, d); });
      // drop target
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault(); cell.classList.remove('drag-over');
        onDropMove(e, { jy: state.jy, jm: state.jm, jd: d, hour: null });
      });
      grid.append(cell);
    }
  }

  async function renderWeek() {
    const firstG = jalaliLib().toGregorian(state.jy, state.jm, state.jd);
    const cur = new Date(firstG.gy, firstG.gm - 1, firstG.gd);
    const offset = (cur.getDay() + 1) % 7;
    const weekStart = new Date(cur.getTime() - offset * 864e5);
    const weekEnd = new Date(weekStart.getTime() + 7 * 864e5);
    const j0 = isoToJ(weekStart.toISOString());
    const j1 = isoToJ(weekEnd.toISOString());
    titleEl.textContent = 'هفته ' + jStr(j0) + ' تا ' + jStr(j1);
    const { events, holidays } = await fetchRange(weekStart.toISOString(), weekEnd.toISOString());
    for (const h of holidays) state.holidays[h.jy * 10000 + h.jm * 100 + h.jd] = h;
    const byDay = {};
    for (const ev of events) { const j = isoToJ(ev.occurrence_start || ev.start); byDay[jKey(j.jy, j.jm, j.jd)] = byDay[jKey(j.jy, j.jm, j.jd)] || []; byDay[jKey(j.jy, j.jm, j.jd)].push(ev); }
    const head = el('div', { class: 'cal-head' });
    const tJ = todayJ();
    const cols = el('div', { class: 'cal-grid week' });
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getTime() + i * 864e5);
      const j = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const isToday = j.jy === tJ.jy && j.jm === tJ.jm && j.jd === tJ.jd;
      const hol = holidayFor(j.jy, j.jm, j.jd);
      head.append(el('div', { class: (i === 6 ? 'fri ' : '') + (hol ? 'holiday' : ''), style: isToday ? 'background:#23262c; color:var(--gold-soft)' : '' }, WD[i] + ' ' + faDigits(j.jd) + (hol ? ' 🎉' : '')));
      const cell = el('div', { class: 'cal-cell week-cell' + (isToday ? ' today' : '') + (i === 6 ? ' fri' : '') });
      cell.append(el('span', { class: 'd' }, MONTHS_FA[j.jm - 1] + ' ' + faDigits(j.jd)));
      const evs = (byDay[jKey(j.jy, j.jm, j.jd)] || []).slice().sort((a, b) => String(a.occurrence_start).localeCompare(String(b.occurrence_start)));
      for (const ev of evs) {
        const wCls = ev.status === 'done' ? ' done' : ev.status === 'missed' ? ' missed' : ev.status === 'cancelled' ? ' cancelled' : '';
        const row = el('div', { class: 'cal-ev week-ev' + wCls, title: ev.title + ({ done: ' (انجام‌شده)', missed: ' (از دست رفته)', cancelled: ' (لغوشده)' }[ev.status] || ''), style: 'background:' + ev._color, draggable: ev.editable ? 'true' : 'false' }, hhmm(new Date(ev.occurrence_start || ev.start)) + ' ' + ev.title + ({ done: ' ✓', missed: ' ✕' }[ev.status] || ''));
        if (ev.editable) row.addEventListener('dragstart', (e2) => e2.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'event', id: ev.ref_id, start: ev.occurrence_start || ev.start, end: ev.end, recurring: !!ev.is_occurrence })));
        row.addEventListener('click', (e2) => { e2.stopPropagation(); evDetail(ev); });
        cell.append(row);
      }
      cell.addEventListener('click', (e) => { if (e.target.closest('.cal-ev')) return; eventForm(null, null, { jy: j.jy, jm: j.jm, jd: j.jd }); });
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (e) => { e.preventDefault(); cell.classList.remove('drag-over'); onDropMove(e, { jy: j.jy, jm: j.jm, jd: j.jd, hour: null }); });
      cols.append(cell);
    }
    box.append(head, cols);
  }

  async function renderDay() {
    const g = jalaliLib().toGregorian(state.jy, state.jm, state.jd);
    const dayDate = new Date(g.gy, g.gm - 1, g.gd);
    titleEl.textContent = WD[(dayDate.getDay() + 1) % 7] + ' ' + jStr({ jy: state.jy, jm: state.jm, jd: state.jd });
    const dayStart = jToISO(state.jy, state.jm, state.jd, 0, 0);
    const dayEnd = jToISO(state.jy, state.jm, state.jd, 23, 59);
    const { events, holidays } = await fetchRange(dayStart, dayEnd);
    const hol = holidayFor(state.jy, state.jm, state.jd);
    box.append(el('div', { class: 'card-h flex between' },
      el('h3', {}, 'برنامهٔ روز' + (hol ? ' — ' + hol.names.join('، ') : '') + ' (' + faDigits(events.length) + ' مورد)'),
      el('button', { class: 'btn sm gold', onclick: () => eventForm(null, state.jd) }, '＋ افزودن به امروز')));
    const grid = el('div', { class: 'cal-day' });
    // hour rows
    const hourEls = {};
    for (let h = 0; h < 24; h++) {
      const row = el('div', { class: 'cal-hour', 'data-hour': h },
        el('span', { class: 'cal-hour-lbl' }, faDigits(String(h).padStart(2, '0')) + ':۰۰'),
        el('div', { class: 'cal-hour-slot' }));
      hourEls[h] = row;
      row.addEventListener('click', (e) => { if (e.target.closest('.cal-ev')) return; eventForm(null, state.jd, { hour: h }); });
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drag-over'); onDropMove(e, { jy: state.jy, jm: state.jm, jd: state.jd, hour: h }); });
      grid.append(row);
    }
    for (const ev of events) {
      const d = new Date(ev.occurrence_start || ev.start);
      const h = d.getHours();
      const chip = el('div', { class: 'cal-ev day-ev', style: 'background:' + ev._color + '; top:' + (d.getMinutes() / 60 * 100) + '%', draggable: ev.editable ? 'true' : 'false' }, hhmm(d) + ' ' + ev.title);
      chip.addEventListener('click', (e2) => { e2.stopPropagation(); evDetail(ev); });
      if (ev.editable) chip.addEventListener('dragstart', (e2) => e2.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'event', id: ev.ref_id, start: ev.occurrence_start || ev.start, end: ev.end, recurring: !!ev.is_occurrence })));
      hourEls[h] && hourEls[h].querySelector('.cal-hour-slot').append(chip);
    }
    box.append(grid);
  }

  async function renderAgenda() {
    const g0 = jalaliLib().toGregorian(state.jy, state.jm, state.jd);
    const start = new Date(g0.gy, g0.gm - 1, g0.gd);
    const end = new Date(start.getTime() + 13 * 864e5);
    titleEl.textContent = 'آجندای — از ' + jStr({ jy: state.jy, jm: state.jm, jd: state.jd });
    const { events, holidays } = await fetchRange(start.toISOString(), end.toISOString());
    for (const h of holidays) state.holidays[h.jy * 10000 + h.jm * 100 + h.jd] = h;
    const byDay = {};
    for (const ev of events) { const j = isoToJ(ev.occurrence_start || ev.start); byDay[jKey(j.jy, j.jm, j.jd)] = byDay[jKey(j.jy, j.jm, j.jd)] || []; byDay[jKey(j.jy, j.jm, j.jd)].push(ev); }
    const list = el('div');
    const tJ = todayJ();
    for (let i = 0; i < 14; i++) {
      const d = new Date(start.getTime() + i * 864e5);
      const j = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const hol = holidayFor(j.jy, j.jm, j.jd);
      const isToday = j.jy === tJ.jy && j.jm === tJ.jm && j.jd === tJ.jd;
      const evs = (byDay[jKey(j.jy, j.jm, j.jd)] || []).slice().sort((a, b) => String(a.occurrence_start).localeCompare(String(b.occurrence_start)));
      const dayHead = el('div', { class: 'cal-agg-day' + (isToday ? ' today' : '') + (hol ? ' holiday' : '') },
        el('b', {}, (WD[(d.getDay() + 1) % 7] + ' ' + jStr(j)) + (hol ? ' — ' + hol.names.join('، ') : '')),
        el('span', { class: 'muted small' }, evs.length ? faDigits(evs.length) + ' رویداد' : ''));
      list.append(dayHead);
      if (!evs.length) list.append(el('div', { class: 'cal-agg-empty' }, '—'));
      for (const ev of evs) {
        const aTitle = el('span', { class: 'cal-agg-title' + (ev.status === 'done' || ev.status === 'missed' ? ' settled' : ''), style: 'cursor:pointer' }, ev.title);
        const row = el('div', { class: 'cal-agg-row' },
          el('span', { class: 'dot', style: 'background:' + ev._color }),
          el('span', { class: 'cal-agg-time' }, hhmm(new Date(ev.occurrence_start || ev.start))),
          aTitle,
          ev.customer ? el('span', { class: 'muted small' }, '— ' + ev.customer.name) : null,
          el('span', { class: 'badge small' }, EVT_FA[ev.type] || ev.type),
          ev.status === 'done' ? el('span', { class: 'badge small', style: 'background:var(--success,#1e8e63); color:#fff' }, 'انجام‌شده') : null,
          ev.status === 'missed' ? el('span', { class: 'badge small', style: 'background:var(--danger,#c0392b); color:#fff' }, 'از دست رفته') : null,
          ev.ref_id && ev.url ? el('a', { class: 'icon-btn', title: 'رکورد اصلی', href: '#' + ev.url + '/' + ev.ref_id }, '↗') : null);
        row.querySelector('.cal-agg-title').addEventListener('click', () => evDetail(ev));
        list.append(row);
      }
    }
    box.append(list);
  }

  // ---- drag & drop → save to DB ----
  async function onDropMove(e, target) {
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || ''); } catch { return; }
    if (!payload || payload.kind !== 'event') return;
    const oldStart = new Date(payload.start);
    const newStart = target.hour != null
      ? jToISO(target.jy, target.jm, target.jd, target.hour, 0)
      : jToISO(target.jy, target.jm, target.jd, oldStart.getHours(), oldStart.getMinutes());
    let newEnd = null;
    if (payload.end) {
      const span = new Date(payload.end) - oldStart;
      newEnd = new Date(new Date(newStart).getTime() + span).toISOString();
    }
    try {
      const r = await api.post('/api/calendar/events/' + payload.id + '/move', { start_at: newStart, end_at: newEnd });
      toast(r.series_shifted ? 'جابه‌جایی ذخیره شد — برای کل سری اعمال شد' : 'جابه‌جایی ذخیره شد — ' + jStr(isoToJ(r.start_at)), 'ok');
      render();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  // ---- event detail modal ----
  function evDetail(ev) {
    const start = new Date(ev.occurrence_start || ev.start);
    const end = ev.end ? new Date(ev.end) : null;
    const j = isoToJ(ev.occurrence_start || ev.start);
    const rows = [
      ['نوع', EVT_FA[ev.type] || ev.type],
      ['تاریخ', jStr(j) + ' — ' + (WD[(start.getDay() + 1) % 7])],
      ['ساعت', hhmm(start) + (end ? ' تا ' + hhmm(end) : '')],
      ['وضعیت', STATUS_FA[ev.status] || ev.status || '—'],
      ['اولویت', ev.priority ? PRIO_FA[ev.priority] || ev.priority : '—'],
      ['مسئول', (ev.users || []).map(u => u.full_name).join('، ') || '—'],
      ['مشتری', ev.customer ? ev.customer.name : '—'],
      ['مکان', (ev.location || '—')],
      ['منبع', SOURCE_FA[ev.source] || ev.source],
    ];
    if (ev.description) rows.push(['توضیحات', ev.description]);
    if (ev.online_url) rows.push(['لینک جلسه آنلاین', ev.online_url]);
    if (ev.reminder_minutes) rows.push(['یادآوری', ev.reminder_minutes + ' دقیقه قبل']);
    if (ev.recurrence && ev.recurrence !== 'none') rows.push(['تکرار', ({ daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه', yearly: 'سالانه', custom: 'سفارشی' })[ev.recurrence]]);
    const body = el('div', {},
      el('div', { class: 'cal-detail-rows' }, rows.map(([k, v]) => el('div', { class: 'cal-detail-row' }, el('b', {}, k + ': '), v === ev.online_url ? el('a', { href: v, target: '_blank', rel: 'noopener' }, v) : el('span', {}, String(v))))));
    const footer = [];
    if (ev.editable) {
      footer.push(el('button', { class: 'btn', onclick: async () => { if (await confirmDialog('حذف رویداد', 'این رویداد از تقویم حذف شود؟', 'حذف', true)) { try { await api.del('/api/calendar/events/' + ev.ref_id); ov.close(); toast('حذف شد', 'ok'); render(); } catch (e2) { toast(e2.message, 'err'); } } } }, 'حذف'));
      footer.push(el('button', { class: 'btn', onclick: () => eventForm(ev) }, 'ویرایش / Drag&Drop'));
      footer.push(el('button', { class: 'btn', onclick: async () => { try { await api.post('/api/calendar/events/' + ev.ref_id + '/done', { done: ev.status !== 'done' }); ov.close(); toast(ev.status === 'done' ? 'باز شد' : 'انجام‌شده علامت خورد', 'ok'); render(); } catch (e2) { toast(e2.message, 'err'); } } }, ev.status === 'done' ? 'باز کردن' : '✓ انجام شد'));
    }
    if (ev.url && ev.ref_id && !ev.editable) {
      footer.push(el('a', { class: 'btn primary', href: '#' + ev.url + '/' + ev.ref_id }, 'مشاهده رکورد اصلی (' + (SOURCE_FA[ev.source] || ev.source) + ')'));
    } else if (ev.editable && ev.ref_type && ev.ref_type !== 'calendar_event' && ev.ref_id) {
      footer.push(el('a', { class: 'btn primary', href: '#' + (SOURCE_URL[ev.ref_type] || '/calendar') + '/' + ev.ref_id }, 'مشاهده رکورد اصلی'));
    }
    footer.push(el('button', { class: 'btn', onclick: () => ov.close() }, 'بستن'));
    const ov = openModal('جزئیات رویداد — ' + ev.title, body, { footer, large: true });
    // history for calendar events
    if (ev.editable) {
      api.get('/api/calendar/events/' + ev.ref_id).then(r => {
        if (r && r.history && r.history.length) {
          const h = el('div', { class: 'mt-8' }, el('b', { class: 'small' }, 'تاریخچه تغییرات:'));
          for (const x of r.history.slice(0, 8)) {
            const oldV = x.old_value ? (JSON.parse(x.old_value || '{}') || {}).start_at : null;
            const newV = x.new_value ? (JSON.parse(x.new_value || '{}') || {}).start_at : null;
            h.append(el('div', { class: 'muted small' }, (x.username || '') + ' — ' + x.action + (oldV && newV ? ' — ' + jStr(isoToJ(oldV)) + ' → ' + jStr(isoToJ(newV)) : '') + ' — ' + jStr(isoToJ(x.at))));
          }
          body.append(h);
        }
      }).catch(() => {});
    }
    return ov;
  }

  // ---- event create/edit form ----
  function refSelect(refRes, label, current) {
    const sel = el('select', {}, el('option', { value: '' }, '— بدون پیوند —'));
    sel._refRes = refRes;
    api.get('/api/r/' + refRes + '?per_page=200').then(({ items }) => {
      for (const it of items) {
        const o = el('option', { value: it.id }, it.name || it.title || it.company || it.number || ('#' + it.id));
        if (String(current) === String(it.id)) o.selected = true;
        sel.append(o);
      }
    }).catch(() => {});
    return sel;
  }
  function eventForm(ev, presetDay, preset) {
    const isEdit = !!ev;
    const evData = ev || {};
    const start = evData.occurrence_start || evData.start || null;
    const j = start ? isoToJ(start) : { jy: preset && preset.jy ? preset.jy : state.jy, jm: preset && preset.jm ? preset.jm : state.jm, jd: presetDay || (preset && preset.jd ? preset.jd : state.jd) };
    const stD = start ? new Date(start) : new Date();
    const typeSel = el('select', {}, Object.entries(EVT_FA).map(([v, l]) => el('option', { value: v, selected: (evData.type === v ? '' : null) }, l)));
    if (!start && !evData.type) typeSel.value = 'meeting';
    const titleIn = el('input', { placeholder: 'عنوان رویداد…', value: evData.title || '' });
    const dateIn = el('input', { placeholder: 'انتخاب تاریخ و ساعت از تقویم…', style: 'cursor:pointer' });
    dateIn._dp = bindDatePick(dateIn, { withTime: true, hour: stD.getHours(), min: stD.getMinutes() });
    if (start) dateIn._dp.set(start);
    const timeIn = null; // time now comes from the date picker
    const allDayChk = el('input', { type: 'checkbox', checked: !!(evData.all_day) });
    const durIn = el('input', { type: 'number', min: '15', step: '15', value: evData.end ? Math.max(15, Math.round((new Date(evData.end) - new Date(evData.start)) / 60000)) : 60, placeholder: 'دقیقه' });
    const prioSel = el('select', {}, Object.entries(PRIO_FA).map(([v, l]) => el('option', { value: v, selected: ((evData.priority || 'medium') === v ? '' : null) }, l)));
    const statusSel = el('select', {}, Object.entries({ scheduled: 'برنامه‌ریزی‌شده', done: 'انجام‌شده', cancelled: 'لغوشده' }).map(([v, l]) => el('option', { value: v, selected: ((evData.status || 'scheduled') === v ? '' : null) }, l)));
    const userSel = el('select', {}, el('option', { value: '' }, '— خودم —'));
    for (const u of state.teams.users || []) {
      const o = el('option', { value: u.id, selected: evData.user_id === u.id ? '' : null }, u.full_name + (u.department ? ' (' + u.department + ')' : ''));
      userSel.append(o);
    }
    const partSel = el('select', { multiple: true, size: 3 });
    for (const u of state.teams.users || []) {
      const partIds = String(evData.participant_ids || '').split(',').map(x => x.trim()).filter(Boolean);
      partSel.append(el('option', { value: u.id, selected: partIds.includes(String(u.id)) ? '' : null }, u.full_name));
    }
    const custSel = customerSelect({ value: evData.customer_id ? Number(evData.customer_id) : null, onChange: (id) => loadContacts(id) });
    const contactSel = el('select', {}, el('option', { value: '' }, '— بدون پیوند —'));
    const loadContacts = (customerId) => {
      clear(contactSel);
      contactSel.append(el('option', { value: '' }, '— بدون پیوند —'));
      if (customerId) api.get('/api/customers/' + customerId + '/contacts').then(r => {
        for (const it of (r.items || [])) {
          const o = el('option', { value: it.id }, it.name || ('#' + it.id));
          if (String(evData.contact_id) === String(it.id)) o.selected = true;
          contactSel.append(o);
        }
      }).catch(() => {});
    };
    loadContacts(evData.customer_id);
    const leadSel = refSelect('lead', 'Lead', evData.lead_id);
    const oppSel = refSelect('opportunity', 'Opportunity', evData.opportunity_id);
    const taskSel = refSelect('task', 'Task', evData.task_id);
    const contractSel = refSelect('contract', 'Contract', evData.contract_id);
    const complaintSel = refSelect('complaint', 'Complaint', evData.complaint_id);
    const ticketSel = refSelect('ticket', 'Ticket', evData.ticket_id);
    const warrantySel = refSelect('warranty', 'Warranty', evData.warranty_id);
    const fuChk = el('input', { type: 'checkbox' });
    const fuWhenIn = el('input', { placeholder: 'انتخاب زمان پیگیری بعدی از تقویم…', style: 'cursor:pointer; flex:1' });
    fuWhenIn._dp = bindDatePick(fuWhenIn, { withTime: true });
    const fuRow = el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'پیگیری بعدی (بعد از جلسه، پیگیری به‌صورت خودکار ثبت می‌شود)'),
      el('div', { class: 'flex', style: 'gap:10px; align-items:center' }, el('label', { class: 'chk' }, fuChk, 'فعال'), fuWhenIn));
    const descIn = el('textarea', { placeholder: 'توضیحات (اختیاری)', value: evData.description || '' });
    const locIn = el('input', { placeholder: 'مکان', value: evData.location || '' });
    const urlIn = el('input', { placeholder: 'لینک جلسه آنلاین (Zoom/Teams/…)', value: evData.online_url || '' });
    const remSel = el('select', {}, REMINDERS.map(r => el('option', { value: String(r.v), selected: (String(evData.reminder_minutes ?? '') === String(r.v) || (r.v === 'custom' && evData.reminder_minutes && !REMINDERS.some(x => Number(x.v) === evData.reminder_minutes)) ? '' : null) }, r.l)));
    const remCustomIn = el('input', { type: 'number', min: '1', placeholder: 'دقیقه (مثلاً ۲۴۰)', value: (evData.reminder_minutes && !REMINDERS.some(x => Number(x.v) === evData.reminder_minutes)) ? evData.reminder_minutes : '', style: 'width:120px' });
    remSel.addEventListener('change', () => { remCustomIn.style.display = remSel.value === 'custom' ? '' : 'none'; });
    remCustomIn.style.display = remSel.value === 'custom' ? '' : 'none';
    const recSel = el('select', {}, RECUR.map(r => el('option', { value: r.v, selected: ((evData.recurrence || 'none') === r.v ? '' : null) }, r.l)));
    const recIn = el('input', { type: 'number', min: '1', placeholder: 'هر چند (روز/هفته/ماه)', value: (evData.recurrence_rule && JSON.parse(evData.recurrence_rule || '{}').interval) || 1, style: 'width:110px' });
    const recEndIn = el('input', { placeholder: 'پایان تکرار (شمسی، اختیاری)', value: evData.recurrence_end_at ? jStr(isoToJ(evData.recurrence_end_at)) : '', style: 'width:160px' });
    const colorIn = el('input', { type: 'color', value: evData.color || state.colors[evData.type || typeSel.value] || '#7c5cd6' });
    recSel.addEventListener('change', () => { const on = recSel.value !== 'none'; recIn.style.display = on ? '' : 'none'; recEndIn.style.display = on ? '' : 'none'; });
    const syncFuRow = () => { fuRow.style.display = typeSel.value === 'meeting' ? '' : 'none'; };
    typeSel.addEventListener('change', syncFuRow);
    syncFuRow();
    const recOn = (evData.recurrence || 'none') !== 'none';
    recIn.style.display = recOn ? '' : 'none'; recEndIn.style.display = recOn ? '' : 'none';

    const body = el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', {}, 'عنوان *'), titleIn),
      el('div', { class: 'field' }, el('label', {}, 'نوع رویداد'), typeSel),
      el('div', { class: 'field' }, el('label', {}, 'تاریخ (شمسی) *'), dateIn),
      el('div', { class: 'field flex', style: 'gap:8px' }, el('label', { class: 'chk' }, allDayChk, 'تمام‌روز'), el('span', { class: 'muted small' }, 'مدت(دقیقه):'), durIn),
      el('div', { class: 'field' }, el('label', {}, 'مسئول'), userSel),
      el('div', { class: 'field' }, el('label', {}, 'شرکت‌کنندگان'), partSel),
      el('div', { class: 'field' }, el('label', {}, 'مشتری'), custSel),
      el('div', { class: 'field' }, el('label', {}, 'مخاطب'), contactSel),
      el('div', { class: 'field' }, el('label', {}, 'Lead'), leadSel),
      el('div', { class: 'field' }, el('label', {}, 'Opportunity'), oppSel),
      el('div', { class: 'field' }, el('label', {}, 'Task'), taskSel),
      el('div', { class: 'field' }, el('label', {}, 'Contract'), contractSel),
      el('div', { class: 'field' }, el('label', {}, 'Complaint'), complaintSel),
      el('div', { class: 'field' }, el('label', {}, 'Ticket'), ticketSel),
      el('div', { class: 'field' }, el('label', {}, 'Warranty'), warrantySel),
      fuRow,
      el('div', { class: 'field' }, el('label', {}, 'اولویت'), prioSel),
      el('div', { class: 'field' }, el('label', {}, 'وضعیت'), statusSel),
      el('div', { class: 'field' }, el('label', {}, 'یادآوری (Reminder)'), el('div', { class: 'flex', style: 'gap:8px' }, remSel, remCustomIn)),
      el('div', { class: 'field' }, el('label', {}, 'تکرار (Recurring)'), el('div', { class: 'flex', style: 'gap:8px' }, recSel, recIn, recEndIn)),
      el('div', { class: 'field' }, el('label', {}, 'رنگ'), colorIn),
      el('div', { class: 'field' }, el('label', {}, 'مکان'), locIn),
      el('div', { class: 'field' }, el('label', {}, 'لینک جلسه آنلاین'), urlIn),
      el('div', { class: 'field span-2' }, el('label', {}, 'توضیحات'), descIn));

    const ov = openModal(isEdit ? 'ویرایش رویداد' : 'رویداد جدید در تقویم', body, { large: true, footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: async () => {
        if (!titleIn.value.trim()) return toast('عنوان الزامی است', 'err');
        let startIso = dateIn._dp ? dateIn._dp.get() : null;
        if (!startIso) return toast('تاریخ و ساعت رویداد را از تقویم انتخاب کنید', 'err');
        if (allDayChk.checked) {
          const d0 = new Date(startIso);
          const g = jalaliLib().toJalaali(d0.getFullYear(), d0.getMonth() + 1, d0.getDate());
          startIso = jToISO(g.jy, g.jm, g.jd, 9, 0);
        }
        const p = { jy: 0, jm: 0, jd: 0 };
        const durMin = allDayChk.checked ? 0 : (Number(durIn.value) || 60);
        const endIso = durMin > 0 ? new Date(new Date(startIso).getTime() + durMin * 60000).toISOString() : null;
        const recEnd = recSel.value !== 'none' && recEndIn.value.trim() ? parseShamsi(recEndIn.value.trim()) : null;
        if (recSel.value === 'custom' && recEndIn.value.trim() && !recEnd) return toast('تاریخ پایان تکرار معتبر نیست', 'err');
        const body2 = {
          title: titleIn.value.trim(), type: typeSel.value, start_at: startIso, end_at: endIso,
          all_day: allDayChk.checked ? 1 : 0, priority: prioSel.value, status: statusSel.value,
          user_id: userSel.value ? Number(userSel.value) : null,
          participant_ids: [...partSel.selectedOptions].map(o => o.value).join(',') || null,
          customer_id: custSel.value ? Number(custSel.value) : null,
          contact_id: contactSel.value ? Number(contactSel.value) : null,
          lead_id: leadSel.value ? Number(leadSel.value) : null,
          opportunity_id: oppSel.value ? Number(oppSel.value) : null,
          task_id: taskSel.value ? Number(taskSel.value) : null,
          contract_id: contractSel.value ? Number(contractSel.value) : null,
          complaint_id: complaintSel.value ? Number(complaintSel.value) : null,
          ticket_id: ticketSel.value ? Number(ticketSel.value) : null,
          warranty_id: warrantySel.value ? Number(warrantySel.value) : null,
          description: descIn.value.trim() || null, location: locIn.value.trim() || null, online_url: urlIn.value.trim() || null,
          recurrence: recSel.value,
          recurrence_rule: recSel.value === 'custom' ? JSON.stringify({ interval: Number(recIn.value) || 1, unit: 'day' }) : (recSel.value !== 'none' ? JSON.stringify({ interval: 1 }) : null),
          recurrence_end_at: recEnd ? jToISO(recEnd.jy, recEnd.jm, recEnd.jd, 23, 59) : null,
          color: colorIn.value || null,
        };
        let rem = remSel.value;
        if (rem === 'custom') rem = remCustomIn.value ? Number(remCustomIn.value) : null;
        body2.reminder_minutes = rem ? Number(rem) : null;
        try {
          let r2 = null;
          if (isEdit) { r2 = await api.put('/api/calendar/events/' + ev.ref_id, body2); toast('رویداد ویرایش و در دیتابیس ذخیره شد', 'ok'); }
          else { r2 = await api.post('/api/calendar/events', body2); toast('رویداد در تقویم و دیتابیس ثبت شد' + (body2.reminder_minutes ? ' — یادآوری به‌صورت خودکار ارسال می‌شود' : ''), 'ok'); }
          // next follow-up: real followup record linked to the meeting (customer timeline + calendar)
          if (typeSel.value === 'meeting' && fuChk.checked) {
            const refId = isEdit ? ev.ref_id : (r2 && (r2.ref_id || r2.id)) || null;
            if (refId) {
              const fuDue = fuWhenIn._dp ? fuWhenIn._dp.get() : null;
              if (!fuDue) return toast('زمان پیگیری بعدی را از تقویم انتخاب کنید', 'err');
              await api.post('/api/r/followup', {
                entity_type: 'meeting', entity_id: Number(refId), subject: 'پیگیری جلسه: ' + titleIn.value.trim(),
                user_id: userSel.value ? Number(userSel.value) : (window.__me ? window.__me().user.id : 0),
                due_at: fuDue, note: 'تولیدشده از فرم جلسه', status: 'pending',
              });
              toast('پیگیری بعدی جلسه ثبت شد', 'ok');
            }
          }
          ov.close(); render();
        } catch (e2) { toast(e2.message, 'err'); }
      } }, 'ذخیره در دیتابیس') ] });
    return ov;
  }

  // ---- bottom panels: today / upcoming / overdue ----
  async function renderPanels() {
    clear(panels);
    try {
      const [today, overdue] = await Promise.all([api.get('/api/calendar/today'), api.get('/api/calendar/overdue')]);
      const upState = { range: 'today' };
      // tabs
      const tabRow = el('div', { class: 'cal-panel-tabs' });
      const panelBox = el('div', { class: 'cal-panel-body' });
      panels.append(el('div', { class: 'card cal-panel' }, tabRow, panelBox));
      function setTab(key) {
        upState.range = key;
        for (const b of tabRow.querySelectorAll('button')) b.className = 'btn sm' + (b.dataset.tab === key ? ' gold' : '');
        loadUpcoming(key);
      }
      for (const [k, l] of [['today', 'امروز'], ['tomorrow', 'فردا'], ['this_week', 'این هفته'], ['next_week', 'هفته آینده']]) {
        const b = el('button', { class: 'btn sm', 'data-tab': k }, l);
        b.addEventListener('click', () => setTab(k));
        tabRow.append(b);
      }
      tabRow.append(el('span', { class: 'muted small', style: 'margin-inline-start:auto' }, 'برنامهٔ پیش‌رو:'));
      async function loadUpcoming(key) {
        clear(panelBox);
        panelBox.append(el('div', { class: 'skel', style: 'height:90px' }));
        try {
          if (key === 'today') {
            const t = today;
            const flat = Object.entries(t.grouped).flatMap(([g, arr]) => arr.map(x => ({ ...x, g })));
            if (!flat.length) { panelBox.append(el('div', { class: 'muted small', style: 'padding:10px' }, 'برنامه‌ای برای امروز ندارید.')); return; }
            for (const x of flat.slice(0, 30)) {
              panelBox.append(el('div', { class: 'cal-mini-row' },
                el('span', { class: 'dot', style: 'background:' + (state.colors[x.type] || '#666') }),
                el('span', { class: 'cal-agg-time' }, hhmm(new Date(x.start))),
                el('span', { style: 'cursor:pointer', onclick: () => location.hash = '#' + (x.url || '/calendar') + '/' + (x.ref_id || '') }, x.title),
                x.customer ? el('span', { class: 'muted small' }, '— ' + x.customer.name) : null,
                el('span', { class: 'badge small' }, EVT_FA[x.type] || x.type)));
            }
          } else {
            const r = await api.get('/api/calendar/upcoming?range=' + key);
            const days = Object.keys(r.days).sort();
            if (!days.length) { panelBox.append(el('div', { class: 'muted small', style: 'padding:10px' }, 'رویدادی در این بازه نیست.')); return; }
            for (const dk of days) {
              const [jy, jm, jd] = dk.split('-').map(Number);
              panelBox.append(el('div', { class: 'muted small', style: 'margin-top:8px; font-weight:700' }, jStr({ jy, jm, jd })));
              for (const x of r.days[dk]) {
                panelBox.append(el('div', { class: 'cal-mini-row' },
                  el('span', { class: 'dot', style: 'background:' + (state.colors[x.type] || '#666') }),
                  el('span', { class: 'cal-agg-time' }, hhmm(new Date(x.start))),
                  el('span', { style: 'cursor:pointer', onclick: () => location.hash = '#' + (x.url || '/calendar') + '/' + (x.ref_id || '') }, x.title),
                  x.customer ? el('span', { class: 'muted small' }, '— ' + x.customer.name) : null));
              }
            }
          }
        } catch (e2) { clear(panelBox).append(el('div', { class: 'alert danger' }, e2.message)); }
      }
      setTab('today');
      // overdue strip
      if (overdue && overdue.total) {
        const odBox = el('div', { class: 'card cal-overdue' }, el('div', { class: 'card-h' }, el('h3', {}, '⚠ فعالیت‌های عقب‌افتاده (' + faDigits(overdue.total) + ')')));
        const list = el('div');
        for (const x of overdue.items.slice(0, 12)) {
          list.append(el('div', { class: 'cal-mini-row' },
            el('span', { class: 'dot', style: 'background:#dc2626' }),
            el('span', { style: 'cursor:pointer', onclick: () => location.hash = '#' + (x.url || '/') + '/' + (x.ref_id || '') }, x.title),
            el('span', { class: 'badge danger small' }, faDigits(x.days_late) + ' روز تأخیر'),
            el('span', { class: 'muted small' }, jStr(isoToJ(x.due)))));
        }
        odBox.append(list);
        panels.append(odBox);
      }
    } catch (e) { /* panels are non-critical */ }
  }

  // ---- report modal ----
  async function reportModal() {
    const fromIn = el('input', { value: jStr(todayJ()) });
    const toIn = el('input', { value: jStr(todayJ()) });
    const typeSel = el('select', {}, el('option', { value: '' }, 'همه انواع'), Object.entries(EVT_FA).map(([v, l]) => el('option', { value: v }, l)));
    const userSel = el('select', {}, el('option', { value: '' }, 'همه کاربران'));
    for (const u of state.teams.users || []) userSel.append(el('option', { value: u.id }, u.full_name));
    let data = null;
    const resultBox = el('div');
    const ov = openModal('گزارش تقویم و برنامه‌ریزی', el('div', {},
      el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'از (شمسی)'), fromIn),
        el('div', { class: 'field' }, el('label', {}, 'تا (شمسی)'), toIn),
        el('div', { class: 'field' }, el('label', {}, 'نوع'), typeSel),
        el('div', { class: 'field' }, el('label', {}, 'مسئول'), userSel)),
      el('div', { class: 'flex', style: 'gap:8px; margin:10px 0' },
        el('button', { class: 'btn primary sm', id: 'rpt-run' }, 'اجرا'),
        el('span', { class: 'muted small' }, '→ مشاهده، Excel، CSV، PDF/چاپ')),
      resultBox), {
      large: true, footer: [el('button', { class: 'btn', onclick: () => ov.close() }, 'بستن')],
    });
    function runReport() {
      const f = parseShamsi(fromIn.value), t2 = parseShamsi(toIn.value);
      if (!f || !t2) return toast('تاریخ‌ها معتبر نیستند', 'err');
      const q = new URLSearchParams({ from: jToISO(f.jy, f.jm, f.jd, 0, 0), to: jToISO(t2.jy, t2.jm, t2.jd, 23, 59) });
      if (typeSel.value) q.set('type', typeSel.value);
      if (userSel.value) q.set('user_id', userSel.value);
      api.get('/api/calendar/report?' + q.toString()).then(r => {
        data = r;
        clear(resultBox);
        const s = r.summary;
        resultBox.append(el('div', { class: 'cal-report-sum' },
          el('div', { class: 'kpi-mini' }, el('b', {}, faDigits(s.total)), el('span', {}, 'مجموع')),
          el('div', { class: 'kpi-mini' }, el('b', {}, faDigits(s.done)), el('span', {}, 'انجام‌شده')),
          el('div', { class: 'kpi-mini' }, el('b', {}, faDigits(s.pending)), el('span', {}, 'در انتظار')),
          el('div', { class: 'kpi-mini' }, el('b', { style: 'color:#dc2626' }, faDigits(s.overdue)), el('span', {}, 'عقب‌افتاده')),
          el('div', { class: 'kpi-mini' }, el('b', {}, faDigits(s.total_hours)), el('span', {}, 'ساعت'))));
        const tbl = el('table', { class: 'tbl' });
        tbl.append(el('thead', {}, el('tr', {}, ['نوع', 'عنوان', 'تاریخ', 'مسئول', 'واحد', 'مشتری', 'وضعیت'].map(h => el('th', {}, h)))));
        const tb = el('tbody');
        for (const row of r.rows.slice(0, 100)) {
          tb.append(el('tr', {},
            el('td', {}, row.type_fa), el('td', {}, row.title), el('td', {}, fmtDate(row.start)),
            el('td', {}, row.user || '—'), el('td', {}, row.department || '—'), el('td', {}, row.customer || '—'), el('td', {}, STATUS_FA[row.status] || row.status)));
        }
        tbl.append(tb);
        resultBox.append(el('div', { class: 'tbl-wrap', style: 'max-height:340px; overflow:auto' }, tbl));
        const expQ = (fmt) => q.toString() + '&format=' + fmt;
        resultBox.append(el('div', { class: 'flex', style: 'gap:8px; margin-top:10px' },
          el('a', { class: 'btn sm', href: '/api/calendar/report/export?' + expQ('xlsx') }, '⬇ Excel'),
          el('a', { class: 'btn sm', href: '/api/calendar/report/export?' + expQ('csv') }, '⬇ CSV'),
          el('a', { class: 'btn sm', href: '/api/calendar/report/export?' + expQ('html'), target: '_blank', rel: 'noopener' }, '🖨 PDF / چاپ رسمی')));
      }).catch(e => toast(e.message, 'err'));
    }
    ov.modal.querySelector('#rpt-run').addEventListener('click', runReport);
  }

  // ---- settings modal (colors + holidays) ----
  function settingsModal() {
    const body = el('div', {}, el('h4', {}, 'رنگ‌بندی انواع فعالیت'));
    const colorInp = {};
    for (const [k, fa] of Object.entries(EVT_FA)) {
      const inp = el('input', { type: 'color', value: state.colors[k] || EVT_COLOR_DEFAULT[k] });
      colorInp[k] = inp;
      body.append(el('label', { class: 'cal-team-row' }, el('span', {}, fa), inp));
    }
    body.append(el('h4', { style: 'margin-top:14px' }, 'تعطیلات رسمی (قابل ویرایش — هر تعطیلی در هر سال یک‌بار تکرار می‌شود)'));
    const holBox = el('div', { style: 'max-height:260px; overflow:auto' });
    let holList = [];
    const renderHol = () => {
      clear(holBox);
      const sorted = [...holList].sort((a, b) => (a.jm - b.jm) || (a.jd - b.jd));
      if (!sorted.length) { holBox.append(el('span', { class: 'muted small' }, 'تعطیلی تعریف نشده است.')); return; }
      for (const h of sorted) {
        const row = el('div', { class: 'cal-team-row', style: 'align-items:center' });
        row.append(el('b', { style: 'width:64px; direction:ltr; text-align:left' }, faDigits(h.jd) + '/' + faDigits(h.jm)), el('span', {}, h.name));
        const del = el('button', { class: 'icon-btn', title: 'حذف', style: 'margin-inline-start:auto' }, '×');
        del.addEventListener('click', () => { holList = holList.filter(x => !(x.jm === h.jm && x.jd === h.jd && x.name === h.name)); renderHol(); });
        row.append(del);
        holBox.append(row);
      }
    };
    // load the RAW stored list (no year-expansion → each holiday exactly once)
    api.get('/api/calendar/holidays?raw=1').then(r => {
      holList = (r.holidays || []).map(h => ({ jm: Number(h.jm), jd: Number(h.jd), name: String(h.name || '').trim(), ...(h.jy ? { jy: Number(h.jy) } : {}) }));
      renderHol();
    }).catch(e => holBox.append(el('div', { class: 'alert danger small' }, 'بارگذاری تعطیلات ناموفق: ' + e.message)));
    body.append(holBox);
    const hName = el('input', { placeholder: 'نام تعطیلی (مثلاً: روز معلم)' });
    const hMonth = el('select', {});
    const M_FA = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
    M_FA.forEach((m, i) => hMonth.append(el('option', { value: i + 1 }, m)));
    const hDay = el('select', {});
    for (let d2 = 1; d2 <= 31; d2++) hDay.append(el('option', { value: d2 }, faDigits(d2)));
    const hAdd = el('button', { class: 'btn sm', onclick: () => {
      const name = hName.value.trim();
      if (!name) return toast('نام تعطیلی را وارد کنید', 'err');
      const jm = Number(hMonth.value), jd = Number(hDay.value);
      if (holList.some(h => h.jm === jm && h.jd === jd && h.name === name)) return toast('این تعطیلی قبلاً ثبت شده است', 'err');
      holList.push({ jm, jd, name });
      hName.value = '';
      renderHol();
    } }, '＋ افزودن');
    body.append(el('div', { class: 'field', style: 'margin-top:10px' }, el('label', {}, 'افزودن تعطیلی جدید'),
      el('div', { class: 'flex', style: 'gap:6px; align-items:center; flex-wrap:wrap' }, hName, hMonth, hDay, hAdd)));
    const ov = openModal('تنظیمات تقویم', body, { large: true, footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'بستن'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const colors = {}; for (const [k, i] of Object.entries(colorInp)) colors[k] = i.value;
          await api.put('/api/calendar/colors', { colors });
          state.colors = colors;
          toast('رنگ‌ها ذخیره شد', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      } }, 'ذخیره رنگ‌ها'),
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          const r = await api.put('/api/calendar/holidays', { holidays: holList });
          holList = (r.holidays || []).map(h => ({ jm: Number(h.jm), jd: Number(h.jd), name: String(h.name || '').trim(), ...(h.jy ? { jy: Number(h.jy) } : {}) }));
          renderHol();
          toast('تعطیلات ذخیره شد', 'ok');
          ov.close(); render();
        } catch (e) { toast('ذخیره تعطیلات: ' + (e.message || 'خطا'), 'err'); }
      } }, 'ذخیره تعطیلات'),
    ] });
  }

  // ---- AI calendar panel ----
  function initAi() {
    aiBox.dataset.init = '1';
    const msgBox = el('div', { class: 'cal-ai-msgs' });
    const inEl = el('input', { placeholder: 'مثلاً: برای هفته آینده جلسات من را بررسی کن / فعالیت‌های عقب‌افتاده من / یک جلسه با مشتری X برای هفته آینده برنامه ریزی کن…' });
    aiBox.append(
      el('div', { class: 'card-h' }, el('h3', {}, '🤖 AI تقویم'), el('span', { class: 'muted small' }, 'آنلاین + آفلاین — در عملیات حساس از شما تأیید می‌گیرد')),
      msgBox,
      el('div', { class: 'cal-ai-in' }, inEl, el('button', { class: 'btn primary sm', id: 'ai-send' }, 'ارسال')));
    function addMsg(text, who = 'ai', extra = null) {
      const m = el('div', { class: 'cal-ai-msg ' + who }, text);
      if (extra) m.append(extra);
      msgBox.append(m);
      msgBox.scrollTop = msgBox.scrollHeight;
    }
    addMsg('سلام! من دستیار تقویم هستم. برنامه‌ها، جلسات، پیگیری‌ها و فعالیت‌های عقب‌افتاده را می‌بینم. سؤال کنید یا بگویید چه چیزی برنامه‌ریزی کنید.', 'ai');
    const send = async () => {
      const q = inEl.value.trim();
      if (!q) return;
      inEl.value = '';
      addMsg(q, 'me');
      const wait = addMsg('…', 'ai');
      try {
        const r = await api.post('/api/calendar/ai', { query: q });
        wait.remove();
        let extra = null;
        if (r.requires_confirmation && r.draft) {
          const d = r.draft;
          extra = el('div', { class: 'cal-ai-confirm' },
            el('div', {}, 'پیشنهاد ثبت: ', el('b', {}, d.title), ' — ' + jStr(isoToJ(d.start_at)) + ' ' + hhmm(new Date(d.start_at))),
            el('div', { class: 'flex', style: 'gap:8px; margin-top:8px' },
              el('button', { class: 'btn primary sm', onclick: async (e) => {
                e.target.disabled = true;
                try { const c = await api.post('/api/calendar/events', d); extra.remove(); addMsg('✅ ثبت شد: «' + d.title + '» در دیتابیس ذخیره گردید.', 'ai'); render(); } catch (e2) { toast(e2.message, 'err'); }
              } }, '✓ تأیید و ثبت در تقویم'),
              el('button', { class: 'btn sm', onclick: () => { extra.remove(); addMsg('رد شد — چیزی ثبت نشد.', 'ai'); } }, 'رد')));
        }
        addMsg(r.text, 'ai', extra);
        render();
      } catch (e) { wait.remove(); addMsg('خطا: ' + e.message, 'ai'); }
    };
    aiBox.querySelector('#ai-send').addEventListener('click', send);
    inEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  render();
}
