'use strict';
// ============ VoIP / Call Management UI ============
// Global call history, filters, KPIs, call detail (notes/outcome/links/
// follow-up/recordings/click-to-call) and VoIP admin settings.
import { api, t, faDigits, statusFa, fmtDate } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState } from '../ui.js';
import { parseJalaaliInput } from '../resource-view.js';
import { helpBtn } from './help.js';

const DIR_FA = { inbound: 'ورودی', outbound: 'خروجی' };
const STATUS_FA = { ringing: 'در حال زنگ', answered: 'پاسخ داده شد', missed: 'از دست‌رفته', no_answer: 'پاسخ نداد', busy: 'مشغول', cancelled: 'لغو‌شده', ended: 'پایان' };
const STATUS_CLS = { missed: 'red', no_answer: 'red', busy: 'orange', ringing: 'orange', answered: 'green', ended: 'green', cancelled: 'gray' };

function durLabel(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return faDigits(m) + ':' + faDigits(String(s).padStart(2, '0'));
}

// ================= Global call history =================
export function callsView(c, presetFilter = null) {
  const me = (window.__me && window.__me()) || { user: { id: 1 } };
  const state = {
    page: 1, from: '', to: '', customer: '', user: '', extension: '',
    direction: presetFilter && presetFilter.direction || '', status: presetFilter && presetFilter.status || '',
    outcome: '', min_duration: '', q: '', missed_only: presetFilter && presetFilter.missed || '',
  };
  const head = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'تاریخچه تماس‌ها (VoIP)'), el('div', { class: 'sub' }, 'تماس‌های ورودی و خروجی — شناسایی خودکار مشتری/مخاطب از Customer Master')),
    el('div', { class: 'actions' }, helpBtn('calls')));
  c.append(head);
  const kpiBox = el('div', { class: 'grid g-4 mb-16' });
  c.append(kpiBox);
  const loadKpi = async () => {
    try {
      const k = await api.get('/api/voip/dashboard');
      clear(kpiBox);
      const mk = (label, val, link, cls) => {
        const card = el('div', { class: 'card stat', style: 'cursor:pointer' },
          el('div', { class: 's-label' }, label), el('div', { class: 's-value small ' + (cls || '') }, val),
          el('div', { class: 'muted small' }, 'کلیک: لیست'));
        card.addEventListener('click', () => { Object.assign(state, link); state.page = 1; load(); });
        return card;
      };
      kpiBox.append(
        mk('تماس‌های امروز', faDigits(k.today), { status: '', direction: '', missed_only: '' }),
        mk('ورودی امروز', faDigits(k.inbound), { direction: 'inbound', status: '', missed_only: '' }),
        mk('خروجی امروز', faDigits(k.outbound), { direction: 'outbound', status: '', missed_only: '' }),
        mk('🔴 از دست‌رفته (امروز)', faDigits(k.missed), { missed_only: '1', status: 'missed', direction: '' }, k.missed ? 'down' : 'up'),
        mk('کل مدت مکالمات (امروز)', Math.round(k.talk_sec / 60) ? faDigits(Math.round(k.talk_sec / 60)) + ' دقیقه' : '—', {}),
        mk('پیگیری‌نشده (مجموع)', faDigits(k.unfollowed), { missed_only: '1' }, k.unfollowed ? 'down' : ''),
      );
    } catch { kpiBox.innerHTML = ''; }
  };

  // filters
  const fromIn = el('input', { placeholder: 'از (شمسی) ۱۴۰/۰۶/۱' });
  const toIn = el('input', { placeholder: 'تا (شمسی) ۱۴۰/۰۶/۰' });
  const dirSel = el('select', {}, el('option', { value: '' }, 'همه نوع'), el('option', { value: 'inbound' }, 'ورودی'), el('option', { value: 'outbound' }, 'خروجی'));
  const stSel = el('select', {}, el('option', { value: '' }, 'همه وضعیت'), ...Object.entries(STATUS_FA).map(([v, l]) => el('option', { value: v }, l)));
  const outSel = el('select', {}, el('option', { value: '' }, 'همه نتیجه'));
  const extIn = el('input', { placeholder: 'اکستنشن' });
  const minDur = el('input', { type: 'number', placeholder: 'حداقل مدت (ثانیه)', style: 'width:150px' });
  const custSel = el('select', {}, el('option', { value: '' }, 'همه مشتریان'));
  const userSel = el('select', {}, el('option', { value: '' }, 'همه کاربران'));
  const qIn = el('input', { placeholder: 'جستجو: شماره / مشتری / Call ID' });
  let usersLoaded = false;
  const loadUsers = () => { if (usersLoaded) return; usersLoaded = true; api.get('/api/admin/users?per_page=200').then(r => { for (const u of (r.items || [])) userSel.append(el('option', { value: u.id }, u.full_name)); }).catch(() => {}); };
  loadUsers();
  api.get('/api/voip/outcomes').then(r => { for (const o of (r.items || [])) outSel.append(el('option', { value: o.v }, o.l)); }).catch(() => {});
  api.get('/api/r/customer?per_page=300').then(r => { for (const cu of (r.items || [])) custSel.append(el('option', { value: cu.id }, cu.name)); }).catch(() => {});
  const filterBar = el('div', { class: 'card mb-16' },
    el('div', { class: 'form-grid', style: 'grid-template-columns:repeat(auto-fit,minmax(160px,1fr))' },
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'از'), fromIn),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'تا'), toIn),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'نوع'), dirSel),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'وضعیت'), stSel),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'نتیجه'), outSel),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'مشتری'), custSel),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'کاربر'), userSel),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'اکستنشن'), extIn),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'حداقل مدت'), minDur),
      el('div', { class: 'field' }, el('label', { class: 'small' }, 'جستجو'), qIn)),
    el('div', { class: 'flex', style: 'gap:8px; padding:10px 14px; border-top:1px solid var(--border)' },
      el('button', { class: 'btn primary sm' }, 'اعمال فیلتر'),
      el('button', { class: 'btn sm' }, 'پاک کردن'),
      el('span', { class: 'grow' }),
      el('a', { class: 'btn sm', id: 'voip-xlsx' }, '⬇ Excel'),
      el('a', { class: 'btn sm', id: 'voip-pdf', target: '_blank', rel: 'noopener' }, '🖨 PDF / چاپ رسمی')));
  filterBar.querySelectorAll('button')[0].addEventListener('click', () => { state.page = 1; load(); });
  filterBar.querySelectorAll('button')[1].addEventListener('click', () => {
    Object.assign(state, { from: '', to: '', customer: '', user: '', extension: '', direction: '', status: '', outcome: '', min_duration: '', q: '', missed_only: '' });
    fromIn.value = toIn.value = extIn.value = minDur.value = qIn.value = '';
    dirSel.value = stSel.value = outSel.value = custSel.value = userSel.value = '';
    state.page = 1; load();
  });
  c.append(filterBar);

  const body = el('div', { class: 'card' }, el('div', { class: 'tbl-wrap' }, el('div', { class: 'skel', style: 'height:200px' })));
  c.append(body);
  const pager = el('div', { class: 'pager mt-16' });
  c.append(pager);

  function exportParams(fmt) {
    const p = new URLSearchParams({ format: fmt });
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.customer) p.set('customer_id', state.customer);
    if (state.user) p.set('user_id', state.user);
    if (state.direction) p.set('direction', state.direction);
    if (state.status) p.set('status', state.status);
    if (state.outcome) p.set('outcome', state.outcome);
    if (state.extension) p.set('extension', state.extension);
    if (state.min_duration) p.set('min_duration', state.min_duration);
    if (state.q) p.set('q', state.q);
    if (state.missed_only) p.set('missed_only', state.missed_only);
    return '/api/voip/report/export?' + p.toString();
  }

  async function load() {
    const p = new URLSearchParams({ per_page: '30', page: String(state.page) });
    const f = parseJalaaliInput(fromIn.value); const t2 = parseJalaaliInput(toIn.value);
    if (f) p.set('from', f);
    if (t2) p.set('to', new Date(new Date(t2).getTime() + 86399000).toISOString());
    if (dirSel.value) p.set('direction', dirSel.value);
    if (stSel.value) p.set('status', stSel.value);
    if (outSel.value) p.set('outcome', outSel.value);
    if (custSel.value) p.set('customer_id', custSel.value);
    if (userSel.value) p.set('user_id', userSel.value);
    if (extIn.value.trim()) p.set('extension', extIn.value.trim());
    if (minDur.value) p.set('min_duration', minDur.value);
    if (qIn.value.trim()) p.set('q', qIn.value.trim());
    if (missedOnlyChecked()) p.set('missed_only', '1');
    body.querySelector('.tbl-wrap').innerHTML = '<div class="skel" style="height:200px"></div>';
    try {
      const r = await api.get('/api/voip/calls?' + p.toString());
      state.from = f || ''; state.to = t2 ? new Date(new Date(t2).getTime() + 86399000).toISOString() : '';
      filterBar.querySelector('#voip-xlsx').href = exportParams('xlsx');
      filterBar.querySelector('#voip-pdf').href = exportParams('html');
      const wrap = body.querySelector('.tbl-wrap');
      clear(wrap);
      if (!r.items.length) {
        wrap.append(emptyState('تماسی با این فیلتر پیدا نشد.', el('a', { class: 'btn gold', href: '#/admin/voip' }, '⚙ تنظیمات VoIP')));
        pager.innerHTML = '';
        return;
      }
      const thead = el('tr', {}, ['تاریخ', 'شماره', 'نوع', 'وضعیت', 'مشتری', 'مخاطب', 'کاربر', 'اکستنشن', 'مدت', 'نتیجه', ''].map(h => el('th', {}, h)));
      const rows = r.items.map(it => {
        const missed = it.status === 'missed';
        return el('tr', { style: 'cursor:pointer' + (missed ? '; background:rgba(220,38,38,.05)' : '') },
          el('td', { class: 'small' }, fmtDate(it.started_at || it.created_at, { time: true })),
          el('td', { class: 'small', dir: 'ltr' }, (missed ? '🔴 ' : '') + (it.caller || it.called || '—')),
          el('td', {}, el('span', { class: 'badge ' + (it.direction === 'inbound' ? 'gold' : 'blue') }, DIR_FA[it.direction] || it.direction)),
          el('td', {}, el('span', { class: 'badge ' + (STATUS_CLS[it.status] || '') }, STATUS_FA[it.status] || it.status)),
          el('td', {}, it.customer_id ? el('a', { href: '#/customers/' + it.customer_id }, it.customer_name || ('#' + it.customer_id)) : el('span', { class: 'muted small' }, 'ناشناس')),
          el('td', { class: 'small' }, it.contact_name || '—'),
          el('td', { class: 'small' }, it.user_name || '—'),
          el('td', { class: 'small' }, it.extension || it.agent_extension || '—'),
          el('td', { class: 'num small' }, durLabel(it.duration_sec)),
          el('td', { class: 'small' }, it.outcome_fa || '—'),
          el('td', { class: 'row-act' }, el('span', { class: 'muted small' }, 'ⓘ')));
        rows[rows.length - 1].addEventListener('click', () => callDetailModal(it.id));
        return rows[rows.length - 1];
      });
      wrap.append(el('table', { class: 'tbl' }, el('thead', {}, thead), el('tbody', {}, ...rows)));
      clear(pager);
      if (r.pages > 1) {
        pager.append(
          el('button', { class: 'pg-btn' + (state.page === 1 ? ' active' : ''), disabled: state.page <= 1 ? '' : null, onclick: () => { state.page--; load(); } }, 'قبلی'),
          el('span', { class: 'info' }, faDigits(state.page) + ' / ' + faDigits(r.pages)),
          el('button', { class: 'pg-btn' + (state.page === r.pages ? ' active' : ''), disabled: state.page >= r.pages ? '' : null, onclick: () => { state.page++; load(); } }, 'بعدی'),
        );
      }
    } catch (e) {
      clear(body.querySelector('.tbl-wrap')).append(el('div', { class: 'alert danger' }, 'دریافت تماس‌ها با خطا مواجه شد: ' + e.message));
    }
  }
  let missedFlag = false;
  function missedOnlyChecked() { return missedFlag || !!state.missed_only; }
  const missedBtn = el('label', { class: 'small muted', style: 'display:flex; gap:6px; align-items:center; cursor:pointer' }, el('input', { type: 'checkbox', style: 'width:auto', onchange: (e) => { missedFlag = e.target.checked; state.page = 1; load(); } }), 'فقط تماس‌های از دست‌رفته');
  filterBar.querySelector('.flex').append(missedBtn);
  if (presetFilter && presetFilter.missed) missedFlag = true;
  loadKpi();
  load();
  return { reload: () => { loadKpi(); load(); } };
}

// ================= Call detail modal =================
function callDetailModal(id) {
  const box = el('div', { class: 'skel', style: 'height:260px' });
  const ov = openModal('جزئیات تماس', box, { large: true });
  api.get('/api/voip/calls/' + id).then(c => {
    clear(box);
    const rows = [
      ['Call ID', (c.call_ref || ('#' + c.id)) + (c.external_call_id ? ' (' + c.external_call_id + ')' : '')],
      ['تاریخ', fmtDate(c.started_at || c.created_at, { time: true })],
      ['نوع', DIR_FA[c.direction] || c.direction],
      ['وضعیت', STATUS_FA[c.status] || c.status],
      ['شماره زنگ‌زنان', c.caller || '—'],
      ['شماره زنگ‌خورده', c.called || '—'],
      ['اکستنشن', c.extension || c.agent_extension || '—'],
      ['مدت', durLabel(c.duration_sec)],
      ['کاربر', c.user_name || '—'],
      ['مشتری', c.customer_id ? (c.customer_name || ('#' + c.customer_id)) : 'ناشناس'],
      ['کد مشتری', c.customer_number || '—'],
      ['مخاطب', c.contact_name || '—'],
      ['روش شناسایی', c.matched_by || '—'],
    ];
    if (c.lead_id) rows.push(['سرنخ', c.lead_name || ('#' + c.lead_id)]);
    const grid = el('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))]));
    box.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-b' }, grid)));

    // links to records
    const linkRow = el('div', { class: 'form-grid', style: 'grid-template-columns:repeat(auto-fit,minmax(170px,1fr))' });
    const mkLink = (label, key, res) => {
      const sel = el('select', {}, el('option', { value: '' }, '— بدون پیوند —'));
      api.get('/api/r/' + res + '?per_page=200').then(r => {
        for (const it of (r.items || [])) sel.append(el('option', { value: it.id }, it.number || it.title || it.subject || it.company || ('#' + it.id)));
        if (c[key]) [...sel.options].find(o => String(o.value) === String(c[key])) && (sel.value = c[key]);
      }).catch(() => {});
      sel.addEventListener('change', async () => {
        try { await api.put('/api/voip/calls/' + id, { [key]: sel.value ? Number(sel.value) : null }); toast('پیوند ذخیره شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
      });
      linkRow.append(el('div', { class: 'field' }, el('label', { class: 'small' }, label), sel));
    };
    mkLink('فرصت فروش', 'opportunity_id', 'opportunity');
    mkLink('تیکت', 'ticket_id', 'ticket');
    mkLink('شکایت', 'complaint_id', 'complaint');
    mkLink('قرارداد', 'contract_id', 'contract');
    box.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'پیوند به سایر ماژول‌ها')), linkRow));

    // notes + outcome
    const noteTa = el('textarea', { rows: 3, placeholder: 'یادداشت تماس (مثلاً: مشتری درخواست ارسال قیمت جدید داشت…)', value: c.notes || '' });
    const outSel = el('select', {}, el('option', { value: '' }, '— انتخاب نتیجه —'));
    api.get('/api/voip/outcomes').then(r => {
      for (const o of (r.items || [])) outSel.append(el('option', { value: o.v, selected: c.outcome === o.v ? '' : null }, o.l));
    }).catch(() => {});
    const saveNote = el('button', { class: 'btn primary sm', onclick: async () => {
      try {
        const body = { notes: noteTa.value };
        if (outSel.value) body.outcome = outSel.value;
        else if (c.outcome) body.outcome = null;
        await api.put('/api/voip/calls/' + id, body);
        toast('یادداشت/نتیجه ذخیره شد', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    } }, 'ذخیره');
    box.append(el('div', { class: 'card mb-16' },
      el('div', { class: 'card-h' }, el('h3', {}, 'یادداشت و نتیجه تماس')),
      el('div', { class: 'card-b' },
        el('div', { class: 'form-grid', style: 'grid-template-columns:1fr 200px' },
          el('div', { class: 'field' }, el('label', { class: 'small' }, 'یادداشت'), noteTa),
          el('div', { class: 'field' }, el('label', { class: 'small' }, 'نتیجه تماس'), outSel)),
        el('div', { class: 'flex', style: 'gap:8px' }, saveNote))));

    // AI analysis (summary / action items / follow-up suggestion / outcome suggestion / trend)
    const aiBox = el('div');
    const aiCard = el('div', { class: 'card mb-16' },
      el('div', { class: 'card-h' }, el('h3', {}, '🤖 تحلیل هوشمند تماس'), el('span', { class: 'muted small' }, 'برای این تماس: خلاصه، اقدامات، پیشنهاد پیگیری، پیشنهاد نتیجه و روند')),
      el('div', { class: 'card-b' }, aiBox));
    aiBox.append(el('div', { class: 'flex', style: 'gap:8px' },
      el('button', { class: 'btn gold sm', onclick: async (e) => {
        const b = e.target; b.disabled = true; b.textContent = 'در حال تحلیل…';
        try {
          const r = await api.get('/api/voip/calls/' + id + '/ai');
          clear(aiBox);
          const srcFa = { online: 'آنلاین (مدل زبانی)', local: 'محلی (LLM)', builtin: 'تحلیل داخلی روی دادهٔ واقعی', disabled: 'غیرفعال' }[r.source] || r.source;
          const basisFa = { transcript: 'بر اساس متن مکالمه (STT)', recording: 'ضبط موجود است — بدون STT — بر اساس متادیتا و یادداشت‌ها', metadata: 'بر اساس متادیتا و یادداشت‌ها (بدون ضبط)' }[r.basis] || r.basis;
          aiBox.append(el('div', { class: 'muted small mb-10' }, 'منبع: ' + srcFa + ' — مبنا: ' + basisFa));
          if (r.text) aiBox.append(el('div', { style: 'white-space:pre-line; line-height:2; font-size:13px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:10px 12px' }, r.text));
          const qa = el('div', { class: 'flex', style: 'gap:8px; margin-top:10px; flex-wrap:wrap' });
          if (r.suggestion && r.suggestion.outcome) {
            const so = r.suggestion.outcome;
            qa.append(el('button', { class: 'btn sm', onclick: async () => {
              outSel.value = so;
              try { await api.put('/api/voip/calls/' + id, { outcome: so }); toast('پیشنهاد نتیجه اعمال شد', 'ok'); } catch (er) { toast(er.message, 'err'); }
            } }, '✓ اعمال پیشنهاد نتیجه'));
          }
          if (r.suggestion && r.suggestion.followup_subject) {
            qa.append(el('button', { class: 'btn sm gold', onclick: async () => {
              try {
                const r2 = await api.post('/api/voip/calls/' + id + '/followup', { subject: r.suggestion.followup_subject, due_at: r.suggestion.followup_due || null });
                toast('پیگیری #' + r2.followup_id + ' بر اساس پیشنهاد AI ایجاد شد', 'ok');
              } catch (er) { toast(er.message, 'err'); }
            } }, '＋ ایجاد پیگیری از پیشنهاد AI'));
          }
          aiBox.append(qa);
        } catch (er) { clear(aiBox).append(el('div', { class: 'alert danger' }, er.message)); }
        finally { b.disabled = false; b.textContent = '🤖 تولید تحلیل'; }
      } }, '🤖 تولید تحلیل')));
    box.append(aiCard);

    // recording
    const recBox = el('div');
    box.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'ضبط مکالمه')), el('div', { class: 'card-b' }, recBox)));
    api.get('/api/voip/calls/' + id + '/recording').then(m => {
      if (!m.ready) { recBox.append(el('span', { class: 'muted small' }, 'برای این تماس ضبطی ثبت نشده است.')); return; }
      const playBtn = el('button', { class: 'btn sm gold', onclick: async () => {
        try {
          const t = await api.post('/api/voip/calls/' + id + '/recording-token');
          const audio = el('audio', { controls: '', src: t.url, style: 'width:100%' });
          recBox.append(audio);
        } catch (e) { toast(e.message, 'err'); }
      } }, '▶ پخش مکالمه');
      recBox.append(el('div', { class: 'flex', style: 'gap:8px' }, playBtn,
        el('a', { class: 'btn sm', href: '/api/voip/recordings/' + id + '/download' }, '⬇ دانلود')));
    }).catch(() => recBox.append(el('span', { class: 'muted small' }, 'دریافت اطلاعات ضبط ناموفق بود.')));

    // actions: follow-up, click-to-call, register customer
    const actions = el('div', { class: 'flex', style: 'gap:8px' });
    const fuBtn = el('button', { class: 'btn gold', onclick: () => followupFromCall(c, ov) }, '＋ ایجاد پیگیری از تماس');
    if (c.followup_id) fuBtn.textContent = '↻ پیگیری مرتبط: #' + c.followup_id + ' (ویرایش پیوند)';
    actions.append(fuBtn);
    const number = c.caller || c.called;
    if (number) {
      const callBtn = el('button', { class: 'btn', onclick: async () => {
        try {
          const r = await api.post('/api/voip/call', { to: number });
          toast('درخواست تماس ارسال شد — Call ID: ' + (r.call_ref || r.call_id), 'ok');
        } catch (e) { toast(e.message, 'err'); }
      } }, '☎ تماس مجدد (Click-to-Call)');
      actions.append(callBtn);
    }
    if (!c.customer_id && number) {
      actions.append(el('button', { class: 'btn', onclick: () => registerCustomerFromCall(c, ov) }, '＋ ثبت مشتری جدید از این تماس'));
    }
    if (c.customer_id) {
      actions.append(el('a', { class: 'btn', href: '#/customers/' + c.customer_id }, 'مشاهده مشتری'));
    }
    box.append(actions);

    // audit history
    if (c.history && c.history.length) {
      const h = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'تاریخچه (Audit)')),
        el('div', { class: 'card-b small' }, c.history.slice(0, 10).map(x => el('div', { class: 'muted' }, (x.username || '') + ' — ' + x.action + ' — ' + fmtDate(x.at, { time: true })))));
      box.append(h);
    }
  }).catch(e => { clear(box).append(el('div', { class: 'alert danger' }, e.message)); });
  return ov;
}

function followupFromCall(call, parent) {
  const subject = el('input', { placeholder: 'مثلاً: ارسال پیش‌فاکتور تا فردا' });
  const dueIn = el('input', { placeholder: 'زمان پیگیری (شمسی): ۱۴۰/۰۶/۸ ۰:۰۰' });
  const userSel = el('select', {}, el('option', { value: '' }, '— خودم —'));
  api.get('/api/admin/users?per_page=200').then(r => { for (const u of (r.items || [])) userSel.append(el('option', { value: u.id }, u.full_name)); }).catch(() => {});
  const ov = openModal('ایجاد پیگیری از تماس', el('div', { class: 'form-grid' },
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'موضوع پیگیری *'), subject),
    el('div', { class: 'field' }, el('label', {}, 'زمان پیگیری'), dueIn),
    el('div', { class: 'field' }, el('label', {}, 'مسئول پیگیری'), userSel)), {
    footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: async () => {
        if (!subject.value.trim()) return toast('موضوع الزامی است', 'err');
        const due = parseJalaaliInput(dueIn.value);
        if (dueIn.value.trim() && !due) return toast('زمان پیگیری معتبر نیست', 'err');
        try {
          const r = await api.post('/api/voip/calls/' + call.id + '/followup', { subject: subject.value.trim(), due_at: due, user_id: userSel.value ? Number(userSel.value) : null });
          toast('پیگیری #' + r.followup_id + ' ایجاد و به تماس متصل شد', 'ok');
          ov.close(); parent.close();
        } catch (e) { toast(e.message, 'err'); }
      } }, 'ایجاد پیگیری'),
    ] });
}

function registerCustomerFromCall(call, parent) {
  const name = el('input', { placeholder: 'نام / عنوان مشتری *' });
  const number = el('input', { value: call.caller || call.called || '', dir: 'ltr' });
  const typeSel = el('select', {}, el('option', { value: 'company' }, 'شرکت'), el('option', { value: 'person' }, 'شخصی'));
  const ov = openModal('ثبت مشتری جدید از تماس', el('div', { class: 'form-grid' },
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'نام مشتری *'), name),
    el('div', { class: 'field' }, el('label', {}, 'شماره تماس (از تماس دریافت شد)'), number),
    el('div', { class: 'field' }, el('label', {}, 'نوع'), typeSel)), {
    footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: async () => {
        if (!name.value.trim()) return toast('نام الزامی است', 'err');
        try {
          const r = await api.post('/api/voip/calls/' + call.id + '/customer', { name: name.value.trim(), phone: number.value.trim(), type: typeSel.value });
          toast('مشتری «' + (r.name || r.customer_id) + '» در Customer Master ثبت و به تماس متصل شد', 'ok');
          ov.close(); parent.close();
        } catch (e) { toast(e.message, 'err'); }
      } }, 'ثبت در Customer Master'),
    ] });
}

// ================= VoIP admin settings =================
export function voipSettingsView(c) {
  const F = ['provider', 'connection_type', 'pbx_address', 'api_url', 'api_port', 'sip_server', 'sip_port', 'ssl', 'extension', 'username', 'password', 'dial_path', 'cdr_path', 'api_key', 'webhook_secret', 'recording_path', 'auto_sync', 'sync_interval_min'];
  const SENS = new Set(['password', 'api_key', 'webhook_secret']);
  const inputs = {};
  const head = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'VoIP / IP-PBX — تنظیمات اتصال'), el('div', { class: 'sub' }, 'لایهٔ یکپارچه‌سازی Provider-independent — SIP / SIP Trunk / REST API / Webhook / CDR')),
    el('div', { class: 'actions' }, helpBtn('calls')));
  c.append(head);

  const card = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'اتصال به PBX / VoIP')));
  c.append(card);
  const grid = el('div', { class: 'form-grid' });
  card.append(grid);
  const act = el('input', { type: 'checkbox', style: 'width:auto' });
  const connType = el('select', {},
    el('option', { value: 'webhook' }, 'Webhook (PBX رویدادها را به CRM می‌فرستد)'),
    el('option', { value: 'rest' }, 'REST API (CRM از PBX می‌خواند + Click-to-Call)'),
    el('option', { value: 'sip' }, 'SIP مستقیم (پروبر اتصال)'));
  const mk = (key, label, opts = {}) => {
    const inp = el('input', { placeholder: key, dir: 'ltr', type: SENS.has(key) ? 'password' : 'text' });
    inputs[key] = inp;
    grid.append(el('div', { class: 'field' }, el('label', { class: 'small' }, label, opts.hint ? el('span', { class: 'muted', style: 'margin-inline-start:6px' }, '(' + opts.hint + ')') : ''), inp));
    return inp;
  };
  mk('provider', 'Provider (نام PBX/سیستم)', {});
  grid.append(el('div', { class: 'field' }, el('label', { class: 'small' }, 'نوع اتصال'), connType));
  mk('pbx_address', 'PBX Address (IP/Hostname)');
  mk('api_url', 'API URL (Base)', { hint: 'مثلاً http://pbx.example.com/api' });
  mk('api_port', 'API Port', { hint: 'اختیاری' });
  mk('sip_server', 'SIP Server');
  mk('sip_port', 'SIP Port', { hint: 'پیش‌فرض 5060' });
  mk('extension', 'Extension (اکستنشن CRM/اپراتور)');
  mk('username', 'Username');
  mk('password', 'Password / Token', { hint: 'با رمزنگاری AES-256-GCM ذخیره می‌شود' });
  mk('api_key', 'API Key', { hint: 'رمزنگاری‌شده' });
  mk('dial_path', 'Click-to-Call Path', { hint: 'پیش‌فرض /dial' });
  mk('cdr_path', 'CDR Path', { hint: 'پیش‌فرض /cdr' });
  mk('recording_path', 'Recording Path (PBX)');
  const sslChk = el('input', { type: 'checkbox', style: 'width:auto' });
  const autoChk = el('input', { type: 'checkbox', style: 'width:auto' });
  const syncMin = el('input', { type: 'number', value: '5', style: 'width:90px' });
  grid.append(
    el('div', { class: 'field' }, el('label', { class: 'small chk' }, sslChk, 'SSL/TLS')),
    el('div', { class: 'field' }, el('label', { class: 'small chk' }, autoChk, 'Auto Sync (سینک خودکار CDR)')),
    el('div', { class: 'field' }, el('label', { class: 'small' }, 'فاصله سینک (دقیقه)'), syncMin));
  const webhookSecret = mk('webhook_secret', 'Webhook Secret', { hint: 'PBX باید در هر درخواست هدر x-webhook-secret را بفرستد — رمزنگاری‌شده' });
  const webhookUrl = el('div', { class: 'alert info small', style: 'grid-column:1/-1; direction:ltr; text-align:left; word-break:break-all' });
  grid.append(el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', { class: 'small' }, 'Webhook URL (در PBX تنظیم کنید)'), webhookUrl));
  const activeRow = el('div', { class: 'flex', style: 'gap:16px; padding:12px 14px; border-top:1px solid var(--border)' },
    el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, act, 'VoIP فعال'),
    el('span', { class: 'grow' }),
    el('button', { class: 'btn sm', id: 'v-test' }, '🔌 Test Connection'),
    el('button', { class: 'btn sm', id: 'v-sync' }, '🔄 Sync Now (دریافت CDR)'),
    el('button', { class: 'btn primary sm', id: 'v-save' }, '💾 ذخیره تنظیمات'));
  const testOut = el('div', { class: 'small', style: 'padding:10px 14px; display:none' });
  card.append(activeRow, testOut);

  // outcomes editor
  const outCard = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'نتیجه‌های تماس (قابل تنظیم)')), el('div', { class: 'card-b' }));
  const outBody = outCard.children[1];
  const outItems = [];
  const outRow = (v, l, i) => {
    const vi = el('input', { value: v, dir: 'ltr', placeholder: 'code', style: 'width:170px' });
    const li = el('input', { value: l, placeholder: 'عنوان فارسی', style: 'width:230px' });
    const row = el('div', { class: 'flex', style: 'gap:6px; margin-top:6px; align-items:center' },
      vi, li, el('button', { class: 'btn sm', onclick: () => { outItems.splice(i, 1); row.remove(); } }, 'حذف'));
    vi.addEventListener('input', () => outItems[i].v = vi.value);
    li.addEventListener('input', () => outItems[i].l = li.value);
    outBody.append(row);
  };
  const addOut = el('button', { class: 'btn sm mt-16', onclick: () => { outItems.push({ v: '', l: '' }); outRow('', '', outItems.length - 1); } }, '＋ افزودن نتیجه');
  outBody.append(addOut);
  const outSave = el('button', { class: 'btn primary sm mt-16', onclick: async () => {
    try { await api.put('/api/voip/outcomes', { items: outItems.filter(x => x.v && x.l) }); toast('نتیجه‌ها ذخیره شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
  } }, 'ذخیره نتیجه‌ها');
  outBody.append(outSave);
  c.append(outCard);

  api.get('/api/voip/settings').then(async r => {
    const s = r.settings || {};
    for (const k of F) {
      if (k === 'connection_type') { connType.value = s.connection_type || 'webhook'; continue; }
      if (k === 'auto_sync') { autoChk.checked = !!s.auto_sync; continue; }
      if (k === 'sync_interval_min') { syncMin.value = s.sync_interval_min || 5; continue; }
      if (SENS.has(k)) { if (s[k]) inputs[k].value = '••••'; inputs[k].dataset.set = s[k] ? '1' : ''; continue; }
      inputs[k].value = s[k] || '';
    }
    act.checked = !!s.active;
    const provider = inputs.provider.value || 'pbx';
    webhookUrl.textContent = location.origin + '/api/voip/webhook/' + provider;
    inputs.provider.addEventListener('input', () => { webhookUrl.textContent = location.origin + '/api/voip/webhook/' + (inputs.provider.value || 'pbx'); });
    for (const o of (r.outcomes || [])) { outItems.push({ v: o.v, l: o.l }); outRow(o.v, o.l, outItems.length - 1); }
  }).catch(e => toast(e.message, 'err'));

  activeRow.querySelector('#v-save').addEventListener('click', async () => {
    const body = { active: act.checked ? 1 : 0, connection_type: connType.value, auto_sync: autoChk.checked ? 1 : 0, sync_interval_min: Number(syncMin.value) || 5 };
    for (const k of F) {
      if (['connection_type', 'auto_sync', 'sync_interval_min'].includes(k)) continue;
      let v = inputs[k].value.trim();
      if (SENS.has(k) && v === '••••') continue; // keep existing encrypted secret
      body[k] = v;
    }
    try {
      const r = await api.put('/api/voip/settings', body);
      toast('تنظیمات VoIP ذخیره شد', 'ok');
      if (r.settings && r.settings.provider) webhookUrl.textContent = location.origin + '/api/voip/webhook/' + (r.settings.provider || 'pbx');
    } catch (e) { toast(e.message, 'err'); }
  });
  activeRow.querySelector('#v-test').addEventListener('click', async () => {
    // save first (so the test uses the latest config)
    const btn = activeRow.querySelector('#v-test');
    btn.disabled = true; testOut.style.display = '';
    testOut.innerHTML = '<span class="muted">در حال بررسی اتصال واقعی…</span>';
    try {
      const body = { active: act.checked ? 1 : 0, connection_type: connType.value };
      for (const k of F) {
        if (['connection_type', 'auto_sync', 'sync_interval_min'].includes(k)) continue;
        let v = inputs[k].value.trim();
        if (SENS.has(k) && v === '••••') continue;
        body[k] = v;
      }
      await api.put('/api/voip/settings', body);
      const r = await api.post('/api/voip/test-connection', {});
      testOut.innerHTML = '';
      testOut.append(el('span', { class: 'badge ' + (r.ok ? 'green' : 'red') }, r.ok ? (r.mode === 'webhook' ? 'WEBHOOK READY' : 'CONNECTED') : 'CONNECTION FAILED'));
      testOut.append(el('span', { class: 'muted', style: 'margin-inline-start:8px' }, r.message + (r.http_status ? ' (HTTP ' + r.http_status + ', ' + r.ms + 'ms)' : '')));
    } catch (e) {
      testOut.innerHTML = '';
      testOut.append(el('span', { class: 'badge red' }, 'CONNECTION FAILED'), el('span', { class: 'muted', style: 'margin-inline-start:8px' }, e.message));
    }
    btn.disabled = false;
  });
  activeRow.querySelector('#v-sync').addEventListener('click', async () => {
    const btn = activeRow.querySelector('#v-sync');
    btn.disabled = true;
    try {
      const r = await api.post('/api/voip/sync', {});
      toast(r.imported ? r.imported + ' تماس از PBX دریافت و ثبت شد' : r.message, r.imported ? 'ok' : 'warn');
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  });
}
