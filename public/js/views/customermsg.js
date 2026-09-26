'use strict';
// ============ Customer Messaging (Section 5) ============
// Message log / templates / settings + the send-to-customer modal used by the
// quote/order/invoice detail pages. Dates shown in Jalali (fmtDate).
import { api, t, faDigits, fmtDate, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState } from '../ui.js';
import { iconBtn } from '../resource-view.js';
import { helpBtn } from './help.js';

const EVENT_FA = { quote: 'پیش‌فاکتور', invoice: 'فاکتور', payment: 'پرداخت', shipment: 'ارسال کالا', manual: 'دستی' };
const CHANNEL_FA = { sms: 'پیامک', whatsapp: 'واتساپ', telegram: 'تلگرام', email: 'ایمیل' };
const MSG_STATUS_FA = { sent: 'ارسال شد', failed: 'ناموفق', not_configured: 'سرویس پیکربندی نشده', queued: 'در صف', pending: 'در انتظار' };
const msgStatusCls = (s) => (s === 'sent' ? 'green' : s === 'failed' ? 'red' : s === 'not_configured' ? 'orange' : s === 'queued' ? 'orange' : '');
const me = () => (window.__me && window.__me()) || {};
const canSend = () => !!(me().permissions && me().permissions.customer_message && me().permissions.customer_message.send);
const canManage = () => !!(me().permissions && me().permissions.customer_message && me().permissions.customer_message.manage);

// ---------- message log page ----------
export async function customerMsgPage(c) {
  const ph = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'پیام‌رسانی مشتریان'), el('div', { class: 'sub' }, 'روزنامهٔ پیام‌های ارسال‌شده به مشتریان (پیامک/واتساپ/تلگرام/ایمیل) — با وضعیت، تاریخ شمسی و کاربر')),
    el('div', { class: 'actions' }, helpBtn('customermsg'),
      canManage() ? el('a', { class: 'btn sm', href: '#/customer-messages/templates' }, '📝 قالب‌ها') : null,
      canManage() ? el('a', { class: 'btn sm', href: '#/customer-messages/settings' }, '⚙ تنظیمات') : null,
      canManage() ? el('a', { class: 'btn sm gold', href: '#/customer-messages/templates' }, '＋ قالب جدید') : null));
  c.append(ph);
  const fStatus = el('select', { class: 'f' });
  fStatus.append(el('option', { value: '' }, 'وضعیت: همه'));
  for (const [v, l] of Object.entries(MSG_STATUS_FA)) fStatus.append(el('option', { value: v }, l));
  const fEvent = el('select', { class: 'f' });
  fEvent.append(el('option', { value: '' }, 'رویداد: همه'));
  for (const [v, l] of Object.entries(EVENT_FA)) fEvent.append(el('option', { value: v }, l));
  const fChannel = el('select', { class: 'f' });
  fChannel.append(el('option', { value: '' }, 'کانال: همه'));
  for (const [v, l] of Object.entries(CHANNEL_FA)) fChannel.append(el('option', { value: v }, l));
  const card = el('div', { class: 'card mb-16' },
    el('div', { class: 'toolbar' }, fEvent, fChannel, fStatus, el('span', { class: 'grow' })),
    el('div', { class: 'tbl-wrap' }, el('div', { class: 'skel', style: 'height:160px' })));
  c.append(card);
  const load = async () => {
    const body = card.querySelector('.tbl-wrap');
    try {
      const p = new URLSearchParams({ per_page: '50' });
      if (fEvent.value) p.set('event_type', fEvent.value);
      if (fChannel.value) p.set('channel', fChannel.value);
      if (fStatus.value) p.set('status', fStatus.value);
      const { items, total } = await api.get('/api/customermsg/log?' + p.toString());
      clear(body);
      if (!items.length) return body.append(emptyState('پیامی ثبت نشده است'));
      body.append(el('div', { class: 'small muted mb-10' }, `مجموع ${faDigits(total)} پیام`));
      body.append(el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'تاریخ (شمسی)'), el('th', {}, 'مشتری'), el('th', {}, 'رویداد/سند'), el('th', {}, 'کانال'), el('th', {}, 'گیرنده'), el('th', {}, 'متن'), el('th', {}, 'وضعیت'), el('th', {}, 'کاربر'))),
        el('tbody', {}, items.map(m => el('tr', {},
          el('td', { class: 'small' }, fmtDate(m.created_at, { time: true })),
          el('td', {}, m.customer_name || ('#' + m.customer_id)),
          el('td', { class: 'small' }, EVENT_FA[m.event_type] || m.event_type + (m.doc_number ? ' — ' + m.doc_number : '')),
          el('td', {}, CHANNEL_FA[m.channel] || m.channel),
          el('td', { class: 'num small' }, m.to_addr || '—'),
          el('td', { class: 'small', style: 'max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, el('span', { title: m.body }, (m.body || '').slice(0, 90) + ((m.body || '').length > 90 ? '…' : ''))),
          el('td', {}, el('span', { class: 'badge ' + msgStatusCls(m.status), title: m.error || '' }, MSG_STATUS_FA[m.status] || m.status)),
          el('td', { class: 'small' }, m.user_name || 'سیستم'))))));
    } catch (e) { clear(body).append(el('div', { class: 'alert danger' }, e.message)); }
  };
  for (const s of [fEvent, fChannel, fStatus]) s.addEventListener('change', load);
  load();
}

// ---------- templates page ----------
export async function customerMsgTemplatesPage(c) {
  if (!canManage()) { c.append(el('div', { class: 'alert danger' }, 'شما مجوز مدیریت پیام‌رسانی مشتریان را ندارید.')); return; }
  const ph = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'قالب‌های پیام مشتری'), el('div', { class: 'sub' }, 'متغیرها: {{customer_name}} نام مشتری — {{doc_number}} شمارهٔ سند — {{amount}} مبلغ — {{date}} تاریخ شمسی — {{user_name}} نام ارسال‌کننده')),
    el('div', { class: 'actions' }, helpBtn('customermsg'), el('a', { class: 'btn sm', href: '#/customer-messages' }, '→ لیست پیام‌ها'), el('button', { class: 'btn sm gold', onclick: () => tplModal() }, '＋ قالب جدید')));
  c.append(ph);
  const card = el('div', { class: 'card' }, el('div', { class: 'tbl-wrap' }, el('div', { class: 'skel', style: 'height:160px' })));
  c.append(card);
  const load = async () => {
    const body = card.querySelector('.tbl-wrap');
    try {
      const { items } = await api.get('/api/customermsg/templates');
      clear(body);
      if (!items.length) return body.append(emptyState('قالبی ثبت نشده است'));
      body.append(el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'نام'), el('th', {}, 'رویداد'), el('th', {}, 'کانال'), el('th', {}, 'متن'), el('th', {}, 'وضعیت'), el('th', {}, ''))),
        el('tbody', {}, items.map(tp => el('tr', {},
          el('td', {}, el('b', {}, tp.name)),
          el('td', {}, EVENT_FA[tp.event_type] || tp.event_type),
          el('td', {}, CHANNEL_FA[tp.channel] || tp.channel),
          el('td', { class: 'small', style: 'max-width:420px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, el('span', { title: tp.body }, (tp.body || '').slice(0, 110) + ((tp.body || '').length > 110 ? '…' : ''))),
          el('td', {}, el('span', { class: 'badge ' + (tp.active ? 'green' : 'red') }, tp.active ? 'فعال' : 'غیرفعال')),
          el('td', { class: 'row-act' }, iconBtn('edit', 'ویرایش', () => tplModal(tp)), iconBtn('trash', 'حذف', async () => {
            if (!(await confirmDialog('حذف قالب', 'قالب «' + tp.name + '» حذف شود؟', 'حذف', true))) return;
            try { await api.del('/api/customermsg/templates/' + tp.id); toast('حذف شد', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          })))))));
    } catch (e) { clear(body).append(el('div', { class: 'alert danger' }, e.message)); }
  };
  function tplModal(tp) {
    const name = el('input', { value: tp ? tp.name : '', placeholder: 'مثلاً: اطلاع‌رسانی صدور فاکتور' });
    const eventSel = el('select', {});
    for (const [v, l] of Object.entries(EVENT_FA)) eventSel.append(el('option', { value: v, selected: (tp ? tp.event_type : 'quote') === v ? '' : null }, l));
    const chSel = el('select', {});
    for (const [v, l] of Object.entries(CHANNEL_FA)) chSel.append(el('option', { value: v, selected: (tp ? tp.channel : 'sms') === v ? '' : null }, l));
    const subject = el('input', { value: tp ? (tp.subject || '') : '', placeholder: 'موضوع (اختیاری — برای ایمیل/تلگرام)' });
    const body = el('textarea', { style: 'width:100%', placeholder: 'سلام {{customer_name}}، فاکتور {{doc_number}} به مبلغ {{amount}} ریال صادر شد. — {{user_name}}' });
    if (tp) body.value = tp.body;
    const active = el('input', { type: 'checkbox', style: 'width:auto', checked: tp ? !!tp.active : true });
    const ov = openModal(tp ? 'ویرایش قالب' : 'قالب پیام جدید', el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'نام قالب'), name),
      el('div', { class: 'field' }, el('label', {}, 'رویداد'), eventSel),
      el('div', { class: 'field' }, el('label', {}, 'کانال'), chSel),
      el('div', { class: 'field' }, el('label', {}, 'موضوع (اختیاری)'), subject),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'متن قالب'), body),
      el('div', { class: 'field' }, el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, active, 'فعال')),
    ), { large: true, footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const payload = { name: name.value.trim(), event_type: eventSel.value, channel: chSel.value, subject: subject.value.trim(), body: body.value.trim(), active: active.checked ? 1 : 0 };
          if (tp) await api.put('/api/customermsg/templates/' + tp.id, payload);
          else await api.post('/api/customermsg/templates', payload);
          toast('ذخیره شد', 'ok'); ov.close(); load();
        } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
      } }, t('save')),
    ] });
  }
  load();
}

// ---------- settings page ----------
export async function customerMsgSettingsPage(c) {
  if (!canManage()) { c.append(el('div', { class: 'alert danger' }, 'شما مجوز مدیریت پیام‌رسانی مشتریان را ندارید.')); return; }
  const ph = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'تنظیمات پیام‌رسانی مشتریان'), el('div', { class: 'sub' }, 'فعال/غیرفعال کلی + ارسال خودکار هنگام رویدادها + کانال پیش‌فرض — تغییرات با Audit ثبت می‌شوند')),
    el('div', { class: 'actions' }, helpBtn('customermsg'), el('a', { class: 'btn sm', href: '#/customer-messages' }, '→ لیست پیام‌ها')));
  c.append(ph);
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:160px' }));
  c.append(card);
  const load = async () => {
    try {
      const r = await api.get('/api/customermsg/settings');
      clear(card);
      const s = r.settings;
      const en = el('input', { type: 'checkbox', style: 'width:auto', checked: !!s.enabled });
      const defCh = el('select', {});
      for (const [v, l] of Object.entries(CHANNEL_FA)) defCh.append(el('option', { value: v, selected: s.default_channel === v ? '' : null }, l));
      const autos = {};
      for (const ev of ['quote', 'invoice', 'payment', 'shipment']) {
        autos[ev] = el('input', { type: 'checkbox', style: 'width:auto', checked: !!s.auto_send[ev] });
      }
      const chState = (v) => r.channels[v] ? el('span', { class: 'badge green' }, 'متصل') : el('span', { class: 'badge orange' }, 'NOT_CONFIGURED');
      card.append(
        el('div', { class: 'card-b', style: 'display:grid; grid-template-columns:1fr 1fr; gap:18px' },
          el('div', {},
            el('label', { class: 'chk', style: 'display:flex; gap:8px; align-items:center; font-weight:700' }, en, 'فعال‌سازی کلی پیام‌رسانی مشتریان'),
            el('div', { class: 'mt-10' }, el('label', { class: 'small muted', style: 'display:block; margin-bottom:6px' }, 'کانال پیش‌فرض'), defCh),
            el('div', { class: 'mt-10' }, el('label', { class: 'small muted', style: 'display:block; margin-bottom:6px' }, 'ارسال خودکار هنگام رویداد (با قالب فعالِ همان رویداد و کانال پیش‌فرض)') ,
              el('div', { class: 'flex wrap', style: 'gap:14px' },
                el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, autos.quote, EVENT_FA.quote),
                el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, autos.invoice, EVENT_FA.invoice),
                el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, autos.payment, EVENT_FA.payment),
                el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, autos.shipment, EVENT_FA.shipment)) )),
          el('div', {},
            el('label', { class: 'small muted', style: 'display:block; margin-bottom:6px' }, 'وضعیت کانال‌ها (تنظیم در Admin ← تنظیمات ← یکپارچه‌سازی‌ها)') ,
            el('div', { class: 'flex wrap', style: 'gap:10px' },
              ...Object.keys(CHANNEL_FA).map(v => el('span', { class: 'chip' }, CHANNEL_FA[v] + ' ', chState(v)))))));
      card.append(el('div', { class: 'card-b', style: 'border-top:1px solid var(--border)' },
        el('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          try {
            await api.put('/api/customermsg/settings', {
              enabled: en.checked, default_channel: defCh.value,
              auto_send: { quote: autos.quote.checked, invoice: autos.invoice.checked, payment: autos.payment.checked, shipment: autos.shipment.checked },
            });
            toast('تنظیمات ذخیره شد', 'ok');
          } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
        } }, '💾 ذخیره تنظیمات')));
    } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
  };
  load();
}

// ---------- send-to-customer modal (used by quote/order/invoice detail) ----------
// ctx: { event_type, doc_type, doc_id, doc_number, customer_id, customer_name }
export async function openCustomerMsgModal(ctx, onClose) {
  if (!canSend()) return;
  let states = { enabled: true, default_channel: 'sms', channels: {} };
  let tpls = [];
  try {
    const [st, tp] = await Promise.all([api.get('/api/customermsg/channels'), canManage() ? api.get('/api/customermsg/templates') : { items: [] }]);
    states = st; tpls = (tp.items || []).filter(x => x.active && x.event_type === ctx.event_type);
  } catch { /* channels fall back to defaults */ }
  if (!states.enabled) { toast('پیام‌رسانی مشتریان در تنظیمات غیرفعال است.', 'err'); return; }
  const chSel = el('select', {});
  for (const [v, l] of Object.entries(CHANNEL_FA)) {
    const cfg = states.channels[v];
    chSel.append(el('option', { value: v, selected: v === states.default_channel ? '' : null }, l + (cfg === false ? ' (NOT_CONFIGURED)' : '')));
  }
  const tplSel = el('select', {});
  tplSel.append(el('option', { value: '' }, '— متن دستی —'));
  for (const tp of tpls) tplSel.append(el('option', { value: tp.id }, tp.name + ' (' + (CHANNEL_FA[tp.channel] || tp.channel) + ')'));
  const bodyI = el('textarea', { style: 'width:100%', placeholder: 'متن پیام… (متغیرها: {{customer_name}}، {{doc_number}}، {{amount}}، {{date}}، {{user_name}})' });
  const preview = el('div', { class: 'card mb-10', style: 'background:var(--surface-2, #f6f7f9)' }, el('div', { class: 'small muted' }, 'پیش‌نمایش:'));
  const render = () => {
    let txt = bodyI.value || '';
    txt = txt.replace(/\{\{customer_name\}\}/g, ctx.customer_name || '').replace(/\{\{name\}\}/g, ctx.customer_name || '')
      .replace(/\{\{doc_number\}\}/g, ctx.doc_number || '').replace(/\{\{amount\}\}/g, ctx.amount || '0')
      .replace(/\{\{date\}\}/g, fmtDate(new Date().toISOString(), { time: false })).replace(/\{\{user_name\}\}/g, (me().user && me().user.full_name) || '');
    clear(preview); preview.append(el('div', { class: 'small' }, txt || '—'));
  };
  bodyI.addEventListener('input', render);
  tplSel.addEventListener('change', () => {
    const tp = tpls.find(x => x.id === Number(tplSel.value));
    if (tp) { bodyI.value = tp.body; chSel.value = tp.channel; render(); }
  });
  const ov = openModal('📩 پیام به مشتری: ' + (ctx.customer_name || ''), el('div', {},
    el('div', { class: 'alert info small mb-10' }, `رویداد: ${EVENT_FA[ctx.event_type] || ctx.event_type} — سند: ${ctx.doc_number || '—'}`),
    el('div', { class: 'field' }, el('label', {}, 'کانال'), chSel),
    el('div', { class: 'field' }, el('label', {}, 'قالب'), tplSel),
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'متن پیام'), bodyI),
    preview), {
    large: true,
    footer: [
      el('button', { class: 'btn', onclick: () => { ov.close(); onClose && onClose(); } }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await api.post('/api/customermsg/send', {
            customer_id: ctx.customer_id, event_type: ctx.event_type, doc_id: ctx.doc_id || null,
            channel: chSel.value, template_id: tplSel.value ? Number(tplSel.value) : null, body: bodyI.value,
          });
          if (r.status === 'sent') toast(`پیام ${CHANNEL_FA[ctx.channel] || chSel.value} ارسال شد.`, 'ok');
          else if (r.status === 'not_configured') toast('پیام در Message Log ثبت شد — سرویس پیام‌رسانی پیکربندی نشده (NOT_CONFIGURED). از Admin ← تنظیمات ← یکپارچه‌سازی‌ها پنل را متصل کنید.', 'err');
          else toast('ارسال ناموفق: ' + (r.error || ''), 'err');
          ov.close(); onClose && onClose();
        } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
      } }, 'ارسال'),
    ],
  });
  render();
}
