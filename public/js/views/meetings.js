'use strict';
// ============ Meetings module (جلسات) — full production UI ============
// Reuses existing modules: customerSelect, bindDatePick (Shamsi), generic Task &
// Follow-up, generic Attachments, activities/notifications, and the Calendar
// aggregation. Talks to /api/r/meeting, /api/meetings, /api/r/meeting/:id/...
import { api, t, fmtDate, faDigits, statusFa, jalaliLib } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState, fileInput } from '../ui.js';
import { customerSelect } from '../customer-select.js';
import { bindDatePick } from '../datepick.js';
import { helpBtn } from './help.js';

const TYPE_FA = { internal: 'جلسه داخلی', customer: 'جلسه با مشتری', supplier: 'جلسه با تأمین‌کننده', other: 'جلسه با سایر اشخاص' };
const MODE_FA = { inperson: 'حضوری', online: 'آنلاین' };
const STATUS_FA = { scheduled: 'برنامه‌ریزی‌شده', done: 'برگزارشده', cancelled: 'لغوشده', postponed: 'به تعویق افتاده' };
const STATUS_CLS = { scheduled: '', done: 'green', cancelled: 'red', postponed: 'orange' };
const PRIO_FA = { low: 'کم', medium: 'متوسط', high: 'بالا', critical: 'بحرانی' };
const REMINDERS = [ ['', 'بدون یادآوری'], ['0', 'در زمان رویداد'], ['15', '۱۵ دقیقه قبل'], ['30', '۳۰ دقیقه قبل'], ['60', '۱ ساعت قبل'], ['1440', '۱ روز قبل'], ['custom', 'زمان سفارشی…'] ];
const FU_KINDS = [ ['call', 'تماس با مشتری'], ['message', 'ارسال پیام'], ['email', 'ارسال ایمیل'], ['proforma', 'ارسال پیش‌فاکتور'], ['sample', 'ارسال نمونه'], ['price', 'بررسی قیمت'], ['next_meeting', 'جلسه بعدی'], ['other', 'سایر'] ];

let USERS = [];
async function loadUsers() { try { USERS = (await api.get('/api/r/user?per_page=500')).items || []; } catch { USERS = []; } return USERS; }
function userOpts(sel, selected) {
  sel.append(el('option', { value: '' }, '—'));
  for (const u of USERS) sel.append(el('option', { value: u.id, selected: String(selected) === String(u.id) ? '' : null }, u.full_name + (u.department ? ' (' + u.department + ')' : '')));
}

export async function meetingsView(c, openId) {
  await loadUsers();
  const filters = { q: '', type: '', status: '', customer_id: '', responsible: '', from: '', to: '', hasTask: false, hasFu: false };

  c.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'جلسات'), el('div', { class: 'sub' }, 'برنامه‌ریزی، صورتجلسه، وظایف و پیگیری‌ها — اتصال کامل به مشتری و تقویم')),
    el('div', { class: 'actions' }, helpBtn('meetings'), el('button', { class: 'btn gold', onclick: () => meetingForm(null) }, '＋ افزودن جلسه'))));

  // toolbar: search + filters
  const qIn = el('input', { class: 'input', placeholder: 'جستجو (عنوان / محل / دستور جلسه)…', style: 'width:220px' });
  let qT; qIn.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { filters.q = qIn.value.trim(); load(); }, 350); });
  const typeSel = el('select', {}, el('option', { value: '' }, 'همه انواع'), Object.entries(TYPE_FA).map(([v, l]) => el('option', { value: v }, l)));
  typeSel.addEventListener('change', () => { filters.type = typeSel.value; load(); });
  const stSel = el('select', {}, el('option', { value: '' }, 'همه وضعیت‌ها'), Object.entries(STATUS_FA).map(([v, l]) => el('option', { value: v }, l)));
  stSel.addEventListener('change', () => { filters.status = stSel.value; load(); });
  const respSel = el('select', {}, el('option', { value: '' }, 'همه مسئولین')); userOpts(respSel, '');
  respSel.addEventListener('change', () => { filters.responsible = respSel.value; load(); });
  const custSel = customerSelect({ value: null, onChange: (id) => { filters.customer_id = id || ''; load(); } });
  const fromIn = el('input', { style: 'cursor:pointer; width:170px', placeholder: 'از تاریخ…' }); fromIn._dp = bindDatePick(fromIn, {});
  const toIn = el('input', { style: 'cursor:pointer; width:170px', placeholder: 'تا تاریخ…' }); toIn._dp = bindDatePick(toIn, {});
  fromIn._dp && fromIn.addEventListener('click', () => {});
  const dateApply = el('button', { class: 'btn sm', onclick: () => { filters.from = fromIn._dp.get() || ''; filters.to = toIn._dp.get() || ''; load(); } }, 'اعمال تاریخ');
  const hasTaskChk = el('input', { type: 'checkbox', style: 'width:auto' }); hasTaskChk.addEventListener('change', () => { filters.hasTask = hasTaskChk.checked; load(); });
  const hasFuChk = el('input', { type: 'checkbox', style: 'width:auto' }); hasFuChk.addEventListener('change', () => { filters.hasFu = hasFuChk.checked; load(); });

  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(el('div', { class: 'card mb-16' }, el('div', { class: 'toolbar' },
    el('div', { class: 'search grow' }, qIn),
    typeSel, stSel, respSel,
    el('div', { class: 'field', style: 'margin:0; min-width:180px' }, el('label', { class: 'small muted' }, 'مشتری'), custSel),
    el('div', { class: 'flex', style: 'gap:6px' }, fromIn, toIn, dateApply),
    el('label', { class: 'small muted', style: 'display:flex; gap:5px; align-items:center' }, hasTaskChk, 'دارای وظیفه'),
    el('label', { class: 'small muted', style: 'display:flex; gap:5px; align-items:center' }, hasFuChk, 'دارای پیگیری'))), card);

  async function load() {
    clear(card); card.append(el('div', { class: 'skel', style: 'height:180px' }));
    try {
      const p = new URLSearchParams({ per_page: '200' });
      if (filters.q) p.set('q', filters.q);
      if (filters.type) p.set('f_meeting_type', filters.type);
      if (filters.status) p.set('f_status', filters.status);
      if (filters.customer_id) p.set('f_customer_id', filters.customer_id);
      let items = (await api.get('/api/r/meeting?' + p.toString())).items || [];
      // client-side: responsible, date range, has-task / has-followup
      if (filters.responsible) items = items.filter(m => String(m.organizer_id || m.created_by || '') === String(filters.responsible));
      const fromT = filters.from ? new Date(filters.from).getTime() - 864e5 : null;
      const toT = filters.to ? new Date(filters.to).getTime() + 864e5 : null;
      if (fromT !== null) items = items.filter(m => m.start_at && new Date(m.start_at).getTime() >= fromT);
      if (toT !== null) items = items.filter(m => m.start_at && new Date(m.start_at).getTime() <= toT);
      if (filters.hasTask || filters.hasFu) {
        let taskIds = new Set(), fuIds = new Set();
        if (filters.hasTask) taskIds = new Set(((await api.get('/api/r/task?per_page=500')).items || []).filter(t => t.related_type === 'meeting').map(t => t.related_id));
        if (filters.hasFu) fuIds = new Set(((await api.get('/api/r/followup?per_page=500')).items || []).filter(f => f.entity_type === 'meeting').map(f => f.entity_id));
        if (filters.hasTask) items = items.filter(m => taskIds.has(m.id));
        if (filters.hasFu) items = items.filter(m => fuIds.has(m.id));
      }
      items.sort((a, b) => String(b.start_at || '').localeCompare(String(a.start_at || '')));
      clear(card);
      if (!items.length) return card.append(emptyState('جلسه‌ای مطابق فیلترها ثبت نشده است', el('button', { class: 'btn gold', onclick: () => meetingForm(null) }, '＋ افزودن جلسه')));
      const head = el('tr', {}, el('th', {}, 'عنوان'), el('th', {}, 'نوع'), el('th', {}, 'تاریخ'), el('th', {}, 'مشتری / مخاطب'), el('th', {}, 'وضعیت'), el('th', {}, ''));
      const rows = items.map(m => el('tr', { style: 'cursor:pointer', onclick: () => meetingDetail(m.id) },
        el('td', {}, el('b', { class: 'small' }, m.title)),
        el('td', {}, el('span', { class: 'badge' }, TYPE_FA[m.meeting_type] || m.meeting_type || '—')),
        el('td', {}, m.start_at ? fmtDate(m.start_at, { time: true }) : '—'),
        el('td', {}, m.customer_id ? (m.customer_id_name || ('#' + m.customer_id)) : (m.meeting_type === 'internal' ? 'داخلی' : '—')),
        el('td', {}, el('span', { class: 'badge ' + (STATUS_CLS[m.status] || '') }, STATUS_FA[m.status] || m.status || '—')),
        el('td', { class: 'row-act' }, el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); meetingForm(m.id); } }, 'ویرایش'))));
      card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
    } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
  }

  // ---------- create / edit form ----------
  function meetingForm(id) {
    // NOTE: m is always an object; in edit mode the real values are loaded
    // asynchronously into the controls at the bottom (item: meeting edit fix).
    const m = {};
    const titleIn = el('input', { placeholder: 'عنوان جلسه *', value: m.title || '' });
    const typeSel = el('select', {}, Object.entries(TYPE_FA).map(([v, l]) => el('option', { value: v, selected: (m.meeting_type || 'internal') === v ? '' : null }, l)));
    const startIn = el('input', { placeholder: 'تاریخ و ساعت شروع (شمسی) *', style: 'cursor:pointer' }); startIn._dp = bindDatePick(startIn, { withTime: true });
    const endIn = el('input', { placeholder: 'تاریخ و ساعت پایان (اختیاری)', style: 'cursor:pointer' }); endIn._dp = bindDatePick(endIn, { withTime: true });
    const locIn = el('input', { placeholder: 'محل جلسه', value: m.location || '' });
    const modeSel = el('select', {}, Object.entries(MODE_FA).map(([v, l]) => el('option', { value: v, selected: (m.mode || 'inperson') === v ? '' : null }, l)));
    const urlIn = el('input', { placeholder: 'https://… (لینک جلسه آنلاین)', dir: 'ltr', value: m.online_url || '' });
    modeSel.addEventListener('change', () => { urlIn.style.display = modeSel.value === 'online' ? '' : 'none'; });
    urlIn.style.display = modeSel.value === 'online' ? '' : 'none';
    // customer + contact
    const custCtl = customerSelect({ value: m.customer_id || null, onChange: (cid) => { contactSel.innerHTML = ''; contactSel.append(el('option', { value: '' }, '— بدون مخاطب —')); if (cid) loadContacts(cid); } });
    const contactSel = el('select', {}, el('option', { value: '' }, '— بدون مخاطب —'));
    async function loadContacts(cid) {
      try { const r = await api.get('/api/customers/' + cid + '/contacts'); contactSel.append(...(r.items || []).map(ct => el('option', { value: ct.id }, ct.name + (ct.position ? ' — ' + ct.position : '')))); if (m.contact_id) contactSel.value = String(m.contact_id); } catch { }
    }
    if (m.customer_id) loadContacts(m.customer_id);
    // organizer + internal members
    const orgSel = el('select', {}); userOpts(orgSel, m.organizer_id || '');
    const partSel = el('select', { multiple: true, size: 4 }); userOpts(partSel, null);
    if (m.participant_ids) { const pids = String(m.participant_ids).split(',').map(x => x.trim()).filter(Boolean); [...partSel.options].forEach(o => { if (pids.includes(String(o.value))) o.selected = true; }); }
    // agenda + minutes + reminder + status
    const descIn = el('textarea', { placeholder: 'دستور جلسه', value: m.description || '' });
    const notesIn = el('textarea', { placeholder: 'صورتجلسه / نتیجه / تصمیمات', value: m.notes || '' });
    const remSel = el('select', {}, REMINDERS.map(([v, l]) => el('option', { value: v, selected: String(m.reminder_minutes ?? '') === v ? '' : null }, l)));
    const remCustom = el('input', { type: 'number', placeholder: 'دقیقه', style: 'width:110px; display:' + (remSel.value === 'custom' ? '' : 'none') });
    if (m.reminder_minutes && !REMINDERS.some(r => r[0] === String(m.reminder_minutes))) { remSel.value = 'custom'; remCustom.style.display = ''; remCustom.value = m.reminder_minutes; }
    remSel.addEventListener('change', () => { remCustom.style.display = remSel.value === 'custom' ? '' : 'none'; });
    const stSel = el('select', {}, Object.entries(STATUS_FA).map(([v, l]) => el('option', { value: v, selected: (m.status || 'scheduled') === v ? '' : null }, l)));

    const body = el('div', { class: 'form-grid' },
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'عنوان جلسه *'), titleIn),
      el('div', { class: 'field' }, el('label', {}, 'نوع جلسه'), typeSel),
      el('div', { class: 'field' }, el('label', {}, 'مشتری مرتبط'), custCtl),
      el('div', { class: 'field' }, el('label', {}, 'مخاطب مرتبط'), contactSel),
      el('div', { class: 'field' }, el('label', {}, 'برگزارکننده'), orgSel),
      el('div', { class: 'field' }, el('label', {}, 'تاریخ و ساعت شروع *'), startIn),
      el('div', { class: 'field' }, el('label', {}, 'تاریخ و ساعت پایان'), endIn),
      el('div', { class: 'field' }, el('label', {}, 'نوع برگزاری'), modeSel),
      el('div', { class: 'field' }, el('label', {}, 'لینک آنلاین'), urlIn),
      el('div', { class: 'field' }, el('label', {}, 'محل جلسه'), locIn),
      el('div', { class: 'field' }, el('label', {}, 'اعضای داخلی شرکت'), partSel),
      el('div', { class: 'field' }, el('label', {}, 'یادآوری'), el('div', { class: 'flex', style: 'gap:6px' }, remSel, remCustom)),
      el('div', { class: 'field' }, el('label', {}, 'وضعیت'), stSel),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'دستور جلسه'), descIn),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'صورتجلسه / نتیجه'), notesIn));

    // ============ Action Items / Decisions (Section 13) ============
    // Every item becomes a REAL Task linked to the meeting (related_type='meeting'),
    // stored independently in the DB: responsible (assignee), follower, deadline,
    // priority, status, notes, result. Notifications go to responsible + follower.
    const actionsBox = el('div', { class: 'card', style: 'margin-top:14px' });
    const actionsList = el('div', {});
    let actions = []; // [{_task_id, _row, title, assignee, follower, due, priority, status, notes, result}]
    function actionRow(a) {
      a = a || {};
      const box = el('div', { class: 'form-grid', style: 'border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:10px; background:var(--bg,#fff)' });
      const tIn = el('input', { placeholder: 'شرح تصمیم / اقدام *', value: a.title || '', style: 'grid-column:1/-1' });
      const asSel = el('select', {}); userOpts(asSel, a.assignee || '');
      const foSel = el('select', {}); userOpts(foSel, a.follower || '');
      const dueIn = el('input', { placeholder: 'مهلت / تاریخ انجام (شمسی)', style: 'cursor:pointer' });
      dueIn._dp = bindDatePick(dueIn, { withTime: true });
      if (a.due) { try { dueIn._dp.set(a.due); } catch {} }
      const prSel = el('select', {}, Object.entries(PRIO_FA).map(([v, l]) => el('option', { value: v, selected: (a.priority || 'medium') === v ? '' : null }, l)));
      const stSel = el('select', {}, [['open', 'در انتظار'], ['in_progress', 'در حال انجام'], ['done', 'انجام‌شده'], ['cancelled', 'لغوشده']].map(([v, l]) => el('option', { value: v, selected: (a.status || 'open') === v ? '' : null }, l)));
      const ntIn = el('input', { placeholder: 'توضیحات', value: a.notes || '' });
      const rsIn = el('input', { placeholder: 'نتیجه', value: a.result || '' });
      a._row = box;
      a._get = () => ({
        title: tIn.value.trim(),
        assignee_id: asSel.value ? Number(asSel.value) : null,
        follower_id: foSel.value ? Number(foSel.value) : null,
        due_at: dueIn._dp.get() || null,
        priority: prSel.value,
        status: stSel.value,
        notes: ntIn.value.trim() || null,
        result: rsIn.value.trim() || null,
      });
      box.append(
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'شرح تصمیم / اقدام *'), tIn),
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'مسئول انجام'), asSel),
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'فرد پیگیری‌کننده'), foSel),
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'مهلت / تاریخ انجام'), dueIn),
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'اولویت'), prSel),
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'وضعیت'), stSel),
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'توضیحات'), ntIn),
        el('div', { class: 'field' }, el('label', { class: 'small' }, 'نتیجه'), rsIn),
        el('div', { class: 'field', style: 'display:flex; align-items:flex-end' },
          el('button', { class: 'btn sm danger', title: 'حذف این اقدام (فقط قبل از ذخیرهٔ کلی)', onclick: () => { const i = actions.indexOf(a); if (i >= 0) actions.splice(i, 1); box.remove(); } }, '✕ حذف')));
      return box;
    }
    function addAction(a) { actions.push(a); actionsList.append(actionRow(a)); }
    actionsBox.append(
      el('div', { class: 'card-h', style: 'padding:10px 14px' },
        el('h3', { class: 'small' }, '⚖ اقدامات / تصمیمات جلسه'),
        el('button', { class: 'btn sm gold', style: 'margin-inline-start:auto', onclick: () => { if (actions.length >= 50) return toast('حداکثر ۵۰ اقدام در هر جلسه', 'err'); addAction({}); } }, '＋ افزودن اقدام / تصمیم')),
      el('div', { style: 'padding:12px 14px' }, actionsList,
        el('div', { class: 'muted small' }, 'هر اقدام به‌صورت مستقل در دیتابیس به‌عنوان Task واقعی (مرتبط به همین جلسه) ذخیره می‌شود؛ مسئول و پیگیری‌کننده اعلان واقعی دریافت می‌کنند و مهلت آن در تقویم نمایش داده می‌شود.')));
    body.append(actionsBox);

    const ov = openModal(id ? 'ویرایش جلسه' : 'جلسه جدید', body, { large: true, footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async (e) => {
        e.target.disabled = true;
        if (!titleIn.value.trim()) { toast('عنوان جلسه الزامی است', 'err'); e.target.disabled = false; return; }
        const start = startIn._dp.get();
        if (!start) { toast('تاریخ و ساعت شروع را انتخاب کنید', 'err'); e.target.disabled = false; return; }
        const end = endIn._dp.get() || null;
        let rem = remSel.value === 'custom' ? (Number(remCustom.value) || null) : (remSel.value === '' ? null : Number(remSel.value));
        const payload = {
          title: titleIn.value.trim(), meeting_type: typeSel.value,
          customer_id: custCtl.value ? Number(custCtl.value) : null,
          contact_id: contactSel.value ? Number(contactSel.value) : null,
          start_at: start, end_at: end,
          mode: modeSel.value, online_url: modeSel.value === 'online' ? urlIn.value.trim() : null,
          location: locIn.value.trim() || null,
          organizer_id: orgSel.value ? Number(orgSel.value) : null,
          participant_ids: [...partSel.selectedOptions].map(o => o.value).join(',') || null,
          description: descIn.value.trim() || null, notes: notesIn.value.trim() || null,
          reminder_minutes: rem, status: stSel.value,
        };
        try {
          let meetingId = id;
          if (id) await api.put('/api/meetings/' + id, payload);
          else { const r = await api.post('/api/meetings', payload); meetingId = (r && (r.id || (r.item && r.item.id))) || null; }
          // save action items (Section 13) — each becomes a real linked Task
          if (meetingId) {
            for (const a of actions) {
              const v = a._get ? a._get() : {};
              if (!v.title) continue;
              if (a._task_id) {
                // existing action: update the real task
                await api.put('/api/r/task/' + a._task_id, {
                  title: v.title, assignee_id: v.assignee_id, follower_id: v.follower_id,
                  due_at: v.due_at, priority: v.priority, status: v.status,
                  notes: v.notes, result: v.result,
                });
              } else {
                await api.post('/api/r/meeting/' + meetingId + '/tasks', v);
              }
            }
          }
          toast('جلسه ذخیره شد' + (rem ? ' — یادآوری تنظیم شد' : '') + (actions.length ? ' — ' + faDigits(actions.length) + ' اقدام ثبت شد' : ''), 'ok'); ov.close(); load();
        } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
      } }, t('save')),
    ] });
    if (id) {
      // load existing action items (real linked tasks) into the form
      api.get('/api/r/meeting/' + id + '/full').then((r) => {
        for (const tk of (r.tasks || [])) {
          addAction({
            _task_id: tk.id, title: tk.title || '',
            assignee: tk.assignee_id || '', follower: tk.follower_id || '',
            due: tk.due_at || '', priority: tk.priority || 'medium',
            status: tk.status || 'open', notes: tk.notes || '', result: tk.result || '',
          });
        }
      }).catch(() => {});
      api.get('/api/r/meeting/' + id).then(({ item }) => {
        titleIn.value = item.title || ''; typeSel.value = item.meeting_type || 'internal';
        // customer + contact (must load after the async fetch, not from empty m)
        if (item.customer_id && custCtl.customerSelect && custCtl.customerSelect.setValue) {
          custCtl.customerSelect.setValue(item.customer_id);
          loadContacts(item.customer_id).then(() => { if (item.contact_id) contactSel.value = String(item.contact_id); });
        }
        if (item.start_at) startIn._dp.set(item.start_at); if (item.end_at) endIn._dp.set(item.end_at);
        locIn.value = item.location || ''; modeSel.value = item.mode || 'inperson'; urlIn.value = item.online_url || '';
        urlIn.style.display = modeSel.value === 'online' ? '' : 'none';
        orgSel.value = String(item.organizer_id || '');
        const pids = String(item.participant_ids || '').split(',').map(x => x.trim()).filter(Boolean); [...partSel.options].forEach(o => { if (pids.includes(String(o.value))) o.selected = true; });
        descIn.value = item.description || ''; notesIn.value = item.notes || '';
        if (item.reminder_minutes) { if (!REMINDERS.some(r => r[0] === String(item.reminder_minutes))) { remSel.value = 'custom'; remCustom.style.display = ''; remCustom.value = item.reminder_minutes; } }
        stSel.value = item.status || 'scheduled';
      }).catch(() => {});
    }
    return ov;
  }

  // ---------- detail (with attendees / attachments / tasks / followups / timeline) ----------
  async function meetingDetail(id) {
    const box = el('div');
    const ov = openModal('جلسه', box, { large: true, footer: [] });
    box.append(el('div', { class: 'skel', style: 'height:200px' }));
    try {
      const d = await api.get('/api/r/meeting/' + id + '/full');
      const m = d.meeting;
      clear(box);
      // header + actions
      const actions = el('div', { class: 'flex', style: 'gap:6px; flex-wrap:wrap' });
      actions.append(el('button', { class: 'btn sm', onclick: () => { ov.close(); meetingForm(id); } }, '✎ ویرایش'));
      actions.append(el('button', { class: 'btn sm', onclick: async () => { try { await api.put('/api/meetings/' + id, { status: m.status === 'done' ? 'scheduled' : 'done' }); meetingDetail(id); } catch (e) { toast(e.message, 'err'); } } }, m.status === 'done' ? '↩ بازگشت به برنامه‌ریزی‌شده' : '✓ برگزارشده علامت بزن'));
      if (m.status === 'scheduled') actions.append(el('button', { class: 'btn sm', onclick: async () => { try { await api.put('/api/meetings/' + id, { status: 'cancelled' }); meetingDetail(id); } catch (e) { toast(e.message, 'err'); } } }, '✕ لغو جلسه'));
      actions.append(el('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog('حذف جلسه', '«' + m.title + '» حذف شود؟ وظایف و پیگیری‌های متصل باقی می‌مانند اما به جلسه‌ای وصل نخواهند بود.', 'حذف', true)) { try { await api.del('/api/r/meeting/' + id + '?hard=1'); toast('حذف شد', 'ok'); ov.close(); load(); } catch (e) { toast(e.message, 'err'); } } } }, 'حذف'));
      box.append(el('div', { class: 'flex between', style: 'margin-bottom:10px' },
        el('div', {}, el('h2', { style: 'margin:0 0 4px' }, m.title), el('div', { class: 'sub' }, [TYPE_FA[m.meeting_type] || '—', MODE_FA[m.mode] || '', m.start_at ? fmtDate(m.start_at, { time: true }) : ''].filter(Boolean).join(' · '))), actions));

      // info grid
      const info = el('dl', { class: 'kv' });
      const put = (k, v) => { if (v) info.append(el('dt', {}, k), el('dd', {}, v)); };
      put('نوع جلسه', TYPE_FA[m.meeting_type] || m.meeting_type);
      put('تاریخ و ساعت', m.start_at ? fmtDate(m.start_at, { time: true }) + (m.end_at ? ' تا ' + fmtDate(m.end_at, { time: true }) : '') : '');
      put('محل', m.location);
      put('نوع برگزاری', MODE_FA[m.mode] || m.mode);
      if (m.online_url) put('لینک آنلاین', el('a', { href: m.online_url, target: '_blank', rel: 'noopener' }, m.online_url));
      if (d.customer) put('مشتری', el('a', { href: '#/customers/' + d.customer.id }, d.customer.name));
      if (d.contact) put('مخاطب', d.contact.name + (d.contact.position ? ' — ' + d.contact.position : ''));
      if (d.organizer) put('برگزارکننده', d.organizer.full_name);
      put('اعضای داخلی', (d.attendees || []).map(a => a.full_name).join('، '));
      put('وضعیت', STATUS_FA[m.status] || m.status);
      put('یادآوری', m.reminder_minutes ? (m.reminder_minutes >= 1440 ? (m.reminder_minutes / 1440) + ' روز قبل' : m.reminder_minutes + ' دقیقه قبل') : '—');
      box.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-b' }, info)));
      if (m.description) box.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '📋 دستور جلسه')), el('div', { class: 'card-b', style: 'white-space:pre-wrap' }, m.description)));
      if (m.notes) box.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '📝 صورتجلسه / نتیجه')), el('div', { class: 'card-b', style: 'white-space:pre-wrap' }, m.notes)));

      // Tasks
      const taskBox = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '✅ وظایف جلسه (' + (d.tasks || []).length + ')'), el('button', { class: 'btn sm gold', style: 'margin-inline-start:auto', onclick: () => taskForm(id) }, '＋ ایجاد وظیفه')));
      taskBox.append((d.tasks || []).length ? el('div', { class: 'card-b small' }, (d.tasks || []).map(tk => el('div', { class: 'flex between mb-10' }, el('span', {}, '• ' + tk.title + (tk.due_at ? ' — مهلت: ' + fmtDate(tk.due_at) : '')), el('span', { class: 'badge ' + (tk.status === 'done' ? 'green' : '') }, statusFa(tk.status) || tk.status)))) : el('div', { class: 'card-b muted small' }, 'وظیفه‌ای از این جلسه ایجاد نشده است.'));
      box.append(taskBox);
      // Follow-ups
      const fuBox = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '📌 پیگیری‌ها (' + (d.followups || []).length + ')'), el('button', { class: 'btn sm gold', style: 'margin-inline-start:auto', onclick: () => followupForm(id) }, '＋ ایجاد پیگیری')));
      fuBox.append((d.followups || []).length ? el('div', { class: 'card-b small' }, (d.followups || []).map(f => el('div', { class: 'flex between mb-10' }, el('span', {}, '• ' + (f.subject || '—') + (f.due_at ? ' — ' + fmtDate(f.due_at, { time: true }) : '')), el('span', { class: 'badge ' + (f.status === 'done' ? 'green' : f.status === 'missed' ? 'red' : 'orange') }, statusFa(f.status) || f.status)))) : el('div', { class: 'card-b muted small' }, 'پیگیری‌ای از این جلسه ثبت نشده است.'));
      box.append(fuBox);
      // Attachments
      const attBox = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '📎 پیوست‌ها (' + (d.attachments || []).length + ')')), el('div', { class: 'card-b small' }));
      const attBody = attBox.children[1];
      const renderAtt = () => { clear(attBody); attBody.append((d.attachments || []).length ? el('div', {}, (d.attachments || []).map(a => el('div', { class: 'flex between mb-10' }, el('span', {}, '📄 ' + a.file_name, el('span', { class: 'muted' }, ' (' + Math.round((a.size || 0) / 1024) + ' KB)')), el('a', { class: 'btn sm', href: '/api/attachments/' + a.id + '/download' }, 'دانلود')))) : el('div', { class: 'muted' }, 'پیوستی ثبت نشده است.')); const upRow = el('div', { class: 'flex', style: 'gap:8px; margin-top:8px' }, fi, el('button', { class: 'btn sm', onclick: async (e) => { if (!fi.files.length) return toast('فایلی انتخاب نشده است', 'err'); e.target.disabled = true; try { const fd = new FormData(); fd.append('file', fi.files[0]); fd.append('entity_type', 'meeting'); fd.append('entity_id', String(id)); await api.upload('/api/attachments', fd); d.attachments.push({ id: Date.now(), file_name: fi.files[0].name, size: fi.files[0].size }); renderAtt(); toast('پیوست اضافه شد', 'ok'); } catch (er) { toast(er.message, 'err'); } e.target.disabled = false; } }, '＋ افزودن پیوست')); attBody.append(upRow); };
      const fi = fileInput(); renderAtt();
      box.append(attBox);
      // Timeline
      box.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, '🕑 تاریخچه فعالیت (Activity Timeline)')), el('div', { class: 'card-b' }, (d.activities || []).length ? el('div', { class: 'timeline' }, (d.activities || []).map(a => el('div', { class: 'tl-item' }, el('div', { class: 'tl-t' }, a.summary || a.type), el('div', { class: 'tl-d' }, a.created_at ? fmtDate(a.created_at, { time: true }) : '')))) : el('div', { class: 'muted small' }, 'فعالیتی ثبت نشده است.'))));
    } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
    return ov;
  }

  // ---------- create a task from the meeting ----------
  function taskForm(meetingId) {
    const title = el('input', { placeholder: 'عنوان وظیفه *', value: 'ارسال نمونه فوم به مشتری' });
    const desc = el('textarea', { placeholder: 'شرح وظیفه' });
    const assignee = el('select', {}); userOpts(assignee, '');
    const prio = el('select', {}, Object.entries(PRIO_FA).map(([v, l]) => el('option', { value: v, selected: v === 'high' ? '' : null }, l)));
    const due = el('input', { placeholder: 'مهلت (شمسی)', style: 'cursor:pointer' }); due._dp = bindDatePick(due, { withTime: true });
    const status = el('select', {}, el('option', { value: 'open' }, 'باز'), el('option', { value: 'in_progress' }, 'در حال انجام'));
    const ov = openModal('ایجاد وظیفه از جلسه', el('div', { class: 'form-grid' },
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'عنوان وظیفه *'), title),
      el('div', { class: 'field' }, el('label', {}, 'مسئول انجام'), assignee),
      el('div', { class: 'field' }, el('label', {}, 'اولویت'), prio),
      el('div', { class: 'field' }, el('label', {}, 'مهلت انجام'), due),
      el('div', { class: 'field' }, el('label', {}, 'وضعیت'), status),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'شرح / توضیحات'), desc)), { footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; if (!title.value.trim()) { toast('عنوان وظیفه الزامی است', 'err'); e.target.disabled = false; return; } try { await api.post('/api/r/meeting/' + meetingId + '/tasks', { title: title.value.trim(), description: desc.value.trim() || null, assignee_id: assignee.value ? Number(assignee.value) : null, priority: prio.value, due_at: due._dp.get() || null, status: status.value }); toast('وظیفه ایجاد و به جلسه متصل شد', 'ok'); ov.close(); meetingDetail(meetingId); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; } } }, t('save')),
    ] });
    return ov;
  }

  // ---------- create a follow-up from the meeting ----------
  function followupForm(meetingId) {
    const kind = el('select', {}, FU_KINDS.map(([v, l]) => el('option', { value: v }, l)));
    const subject = el('input', { placeholder: 'موضوع پیگیری' });
    const resp = el('select', {}); userOpts(resp, '');
    const due = el('input', { placeholder: 'زمان پیگیری (شمسی) *', style: 'cursor:pointer' }); due._dp = bindDatePick(due, { withTime: true });
    const note = el('textarea', { placeholder: 'توضیحات' });
    const ov = openModal('ایجاد پیگیری از جلسه', el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', {}, 'نوع پیگیری'), kind),
      el('div', { class: 'field' }, el('label', {}, 'مسئول'), resp),
      el('div', { class: 'field' }, el('label', {}, 'زمان پیگیری *'), due),
      el('div', { class: 'field' }, el('label', {}, 'موضوع'), subject),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'توضیحات'), note)), { footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; const dueIso = due._dp.get(); if (!dueIso) { toast('زمان پیگیری را انتخاب کنید', 'err'); e.target.disabled = false; return; } try { await api.post('/api/r/meeting/' + meetingId + '/followups', { kind: kind.value, subject: subject.value.trim() || FU_KINDS.find(k => k[0] === kind.value)[1], due_at: dueIso, user_id: resp.value ? Number(resp.value) : null, note: note.value.trim() || null }); toast('پیگیری ایجاد شد' + ' (در صورت مشتری‌دار بودن، به مشتری نیز متصل شد)', 'ok'); ov.close(); meetingDetail(meetingId); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; } } }, t('save')),
    ] });
    return ov;
  }

  load();
  if (openId) setTimeout(() => meetingDetail(Number(openId)), 250);
}
