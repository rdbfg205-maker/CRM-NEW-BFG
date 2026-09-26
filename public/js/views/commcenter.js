'use strict';
// ============ Communication Center (مرکز ارتباطات) ============
// Unified READ-ONLY view of ALL real company communications from the backend
// aggregation endpoint /api/comm/center (VoIP calls + customer messages +
// internal calls). Filters: customer / user / channel / direction / status /
// date range. Reporting: summary counts by channel, direction and status.
// Every row links to the real record (customer / doc / contact). No fake data.
import { api, t, faDigits, fmtDate } from '../core.js';
import { el, clear, toast, emptyState, skeletonRows } from '../ui.js';
import { customerSelect } from '../customer-select.js';
import { bindDatePick } from '../datepick.js';
import { helpBtn } from './help.js';

const CH_FA = { phone: '☎ تلفن (VoIP)', sms: '✉ پیامک', whatsapp: 'واتساپ', telegram: 'تلگرام', email: 'ایمیل', internal: 'تماس داخلی' };
const DIR_FA = { incoming: 'ورودی', outgoing: 'خروجی', missed: 'بی‌پاسخ' };
const DIR_CLS = { incoming: 'green', outgoing: '', missed: 'red' };

let USERS = [];
async function loadUsers() { try { USERS = (await api.get('/api/r/user?per_page=500')).items || []; } catch { USERS = []; } return USERS; }

export async function commCenterPage(c) {
  await loadUsers();
  const f = { customer_id: '', user_id: '', channel: '', direction: '', status: '', from: '', to: '' };

  c.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'مرکز ارتباطات'), el('div', { class: 'sub' }, 'تمام ارتباطات واقعی شرکت (تماس‌های VoIP، پیام‌های مشتریان و تماس‌های داخلی) — فقط دادهٔ دیتابیس، بدون رکورد ساختگی'))),
    el('div', { class: 'actions' }, helpBtn('commcenter')));

  // filters
  const custSel = customerSelect({ value: null, onChange: (id) => { f.customer_id = id || ''; load(); } });
  const userSel = el('select', {}, el('option', { value: '' }, 'همه کاربران'));
  for (const u of USERS) userSel.append(el('option', { value: u.id }, u.full_name));
  userSel.addEventListener('change', () => { f.user_id = userSel.value; load(); });
  const chSel = el('select', {}, el('option', { value: '' }, 'همه کانال‌ها'), Object.entries(CH_FA).map(([v, l]) => el('option', { value: v }, l)));
  chSel.addEventListener('change', () => { f.channel = chSel.value; load(); });
  const dirSel = el('select', {}, el('option', { value: '' }, 'همه جهت‌ها'), Object.entries(DIR_FA).map(([v, l]) => el('option', { value: v }, l)));
  dirSel.addEventListener('change', () => { f.direction = dirSel.value; load(); });
  const stSel = el('select', {}, el('option', { value: '' }, 'همه وضعیت‌ها'), [['answered', 'پاسخ‌داده‌شده'], ['no_answer', 'بی‌پاسخ'], ['missed', 'بی‌پاسخ'], ['busy', 'مشغول'], ['sent', 'ارسال‌شده'], ['failed', 'ناموفق'], ['not_configured', 'در انتظار پیکربندی'], ['ended', 'پایان‌یافته']].map(([v, l]) => el('option', { value: v }, l)));
  stSel.addEventListener('change', () => { f.status = stSel.value; load(); });
  const fromIn = el('input', { style: 'cursor:pointer; width:150px', placeholder: 'از تاریخ…' }); fromIn._dp = bindDatePick(fromIn, {});
  const toIn = el('input', { style: 'cursor:pointer; width:150px', placeholder: 'تا تاریخ…' }); toIn._dp = bindDatePick(toIn, {});
  const dateApply = el('button', { class: 'btn sm', onclick: () => { f.from = fromIn._dp.get() || ''; f.to = toIn._dp.get() || ''; load(); } }, 'اعمال تاریخ');

  c.append(el('div', { class: 'card mb-16' }, el('div', { class: 'toolbar' },
    el('div', { class: 'search grow' }, custSel),
    userSel, chSel, dirSel, stSel, fromIn, toIn, dateApply)));

  // summary strip (reporting)
  const sumCard = el('div', { class: 'grid g-4 mb-16' });
  c.append(sumCard);
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(card);

  const S = (l, v, cls) => el('div', { class: 'card stat' }, el('div', { class: 's-label' }, l), el('div', { class: 's-value small ' + (cls || '') }, v));
  function paintSummary(s) {
    clear(sumCard);
    sumCard.append(
      S('مجموع ارتباطات', faDigits(s.total)),
      S('تماس VoIP', faDigits(s.sources.voip), ''),
      S('پیام مشتری', faDigits(s.sources.messages), ''),
      S('تماس داخلی', faDigits(s.sources.internal), ''));
    const by = (o) => Object.entries(o || {}).map(([k, v]) => faDigits(v) + ' ' + (CH_FA[k] || DIR_FA[k] || k)).join('، ') || '—';
    sumCard.append(
      el('div', { class: 'card stat' }, el('div', { class: 's-label' }, 'بر اساس کانال'), el('div', { class: 'small', style: 'margin-top:4px; line-height:1.8' }, by(s.by_channel))),
      el('div', { class: 'card stat' }, el('div', { class: 's-label' }, 'بر اساس جهت'), el('div', { class: 'small', style: 'margin-top:4px; line-height:1.8' }, by(s.by_direction))),
      el('div', { class: 'card stat', style: 'grid-column:span 2' }, el('div', { class: 's-label' }, 'بر اساس وضعیت/نتیجه'), el('div', { class: 'small', style: 'margin-top:4px; line-height:1.8' }, by(s.by_status))));
  }

  let page = 1;
  async function load() {
    card.innerHTML = ''; card.append(el('div', { class: 'skel', style: 'height:200px' }));
    try {
      const u = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) u.set(k, v);
      u.set('page', String(page));
      const r = await api.get('/api/comm/center?' + u.toString());
      clear(card);
      paintSummary(r.summary || { total: 0, sources: { voip: 0, messages: 0, internal: 0 } });
      if (!r.items.length) return card.append(el('div', {}, emptyState('ارتباطی با این فیلترها ثبت نشده است.')));
      const head = el('tr', {}, el('th', {}, 'تاریخ/ساعت'), el('th', {}, 'مشتری / مخاطب'), el('th', {}, 'کاربر'), el('th', {}, 'کانال'), el('th', {}, 'جهت'), el('th', {}, 'وضعیت / نتیجه'), el('th', {}, 'موضوع'), el('th', {}, 'مدت'), el('th', {}, ''));
      const body = el('tbody');
      for (const it of r.items) {
        const who = [it.customer_name, it.contact_name].filter(Boolean).join(' / ') || (it.other ? it.other : '—');
        const link = it.ref_type === 'customer' && it.ref_id ? '/customers/' + it.ref_id : (it.ref_type && it.ref_id ? '/' + (it.ref_type === 'contact' ? 'customers' : it.ref_type) + '/' + it.ref_id : null);
        const row = el('tr', {},
          el('td', { class: 'small muted' }, fmtDate(it.at, { time: true })),
          el('td', { class: 'small' }, link ? el('a', { href: '#' + link }, who) : who),
          el('td', { class: 'small muted' }, it.user_name || '—'),
          el('td', { class: 'small' }, CH_FA[it.channel] || it.channel),
          el('td', {}, el('span', { class: 'badge ' + (DIR_CLS[it.direction] || '') }, DIR_FA[it.direction] || it.direction)),
          el('td', { class: 'small' }, it.result || it.status || '—'),
          el('td', { class: 'small', style: 'max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, it.subject || '—'),
          el('td', { class: 'num small' }, it.duration_sec != null ? faDigits(it.duration_sec) + 's' : '—'),
          el('td', { class: 'row-act' }, link ? el('a', { class: 'btn sm', href: '#' + link }, 'مستند') : null));
        if (it.body) row.title = it.body;
        body.append(row);
      }
      card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), body)));
      if (r.pages > 1) {
        const nav = el('div', { class: 'flex', style: 'padding:10px 14px; gap:6px; border-top:1px solid var(--border)' },
          el('button', { class: 'btn sm', disabled: page <= 1 ? '' : null, onclick: () => { page--; load(); } }, 'قبلی'),
          el('span', { class: 'muted small', style: 'align-self:center' }, 'صفحهٔ ' + faDigits(page) + ' از ' + faDigits(r.pages)),
          el('button', { class: 'btn sm', disabled: page >= r.pages ? '' : null, onclick: () => { page++; load(); } }, 'بعدی'));
        card.append(nav);
      }
    } catch (e) {
      clear(card); card.append(el('div', { class: 'alert danger' }, e.message));
    }
  }
  load();
}
