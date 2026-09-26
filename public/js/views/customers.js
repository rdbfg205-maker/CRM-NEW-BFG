'use strict';
import { api, t, fmtNum, fmtMoney, fmtDate, faDigits, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, tabs, emptyState, exportMenu } from '../ui.js';
import { ResourceView, iconBtn } from '../resource-view.js';
import { recordExportBtn } from '../export-center.js';
import { customerSelect } from '../customer-select.js';
import { helpBtn } from './help.js';
import { voiceRegisterButton, openVoiceRegister } from './voice-reg.js';
import { contactsImportButton } from './contacts-import.js';
import { PROVINCES, wireGeoCascade } from '../geo.js';

let _lastList = null;
window.__setLastView = (v) => { window.__lastView = v; };
export function registerLast(v) { window.__lastView = v; }

export function customersList(c) {
  const v = new ResourceView({
    res: 'customer', title: 'مشتریان', quickAction: 'مشتری جدید',
    extraActions: [
      (() => {
        const b = voiceRegisterButton();
        b.addEventListener('click', () => openVoiceRegister((id) => { v.load(); if (id) v.openDetail(id); }));
        return b;
      })(),
    ],
  });
  v._afterSave = () => {};
  registerLast(v);
  c.append(v.root);
}
export function leadsView(c) {
  const v = new ResourceView({
    res: 'lead', title: 'سرنخ‌ها', quickAction: 'سرنخ جدید',
    detailActions: (item) => {
      if (item.status === 'converted') return el('div', { class: 'mb-16' }, el('div', { class: 'alert info small' }, 'این سرنخ قبلاً به مشتری/فرصت تبدیل شده است.'));
      const btn = el('button', { class: 'btn gold sm', onclick: async () => {
        btn.disabled = true;
        try {
          const r = await api.post('/api/leads/' + item.id + '/convert', {});
          if (r.opportunity_id) { toast('سرنخ به فرصت فروش #' + r.opportunity_id + ' تبدیل شد (مشتری: #' + r.customer_id + ')', 'ok'); location.hash = '#/opportunities/' + r.opportunity_id; }
          else { toast('مشتری #' + r.customer_id + ' آماده است — فرصت را از صفحهٔ مشتری بسازید', 'ok'); location.hash = '#/customers/' + r.customer_id; }
        } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
      } }, '⇢ تبدیل به مشتری + فرصت فروش');
      return el('div', { class: 'mb-16' }, el('div', { class: 'alert info small' }, 'با تبدیل، مشتری در Customer Master (با بررسی تکراری) ثبت شده و یک فرصت فروش در Pipeline ایجاد می‌شود.'), btn);
    },
  });
  registerLast(v);
  c.append(v.root);
}
export function opportunitiesView(c) {
  const v = new ResourceView({ res: 'opportunity', title: 'فرصت‌های فروش', quickAction: 'فرصت جدید' });
  registerLast(v);
  c.append(v.root);
}
export function contactsList(c) {
  const searchIn = el('input', { class: 'input', placeholder: 'جستجو (نام / مشتری / تلفن / ایمیل)…', style: 'width:280px' });
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'مخاطبین')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('contacts'), exportMenu(fmt => '/api/contacts/export?format=' + fmt + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی مخاطبین'), contactsImportButton(() => load()), (() => { const b = voiceRegisterButton({ mode: 'contact' }); b.addEventListener('click', () => openVoiceRegister(() => load(), { mode: 'contact' })); return b; })(), el('button', { class: 'btn gold', onclick: () => contactForm(null) }, '＋ افزودن مخاطب')));
  c.append(_ph);
  const box = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(box);
  let timer = null;
  searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), 300); });
  c.append(el('div', { class: 'mb-16' }, searchIn));

  function contactForm(ct, presetCustomer) {
    const custCtl = customerSelect({ value: ct ? ct.customer_id : (presetCustomer || null) });
    const n = el('input', { placeholder: 'نام و نام خانوادگی *' });
    const pos = el('input', { placeholder: 'سمت / عنوان شغلی' });
    const mob = el('input', { placeholder: 'موبایل', dir: 'ltr' });
    const ph = el('input', { placeholder: 'تلفن ثابت', dir: 'ltr' });
    const em = el('input', { placeholder: 'ایمیل', dir: 'ltr' });
    const ad = el('input', { placeholder: 'آدرس' });
    const provSel = el('select', {}, el('option', { value: '' }, '— انتخاب استان —'), PROVINCES.map(p => el('option', { value: p }, p)));
    const cityIn = el('input', { placeholder: 'شهر (متناظر با استان)' });
    const indIn = el('input', { placeholder: 'شهرک صنعتی (متناظر با شهر)' });
    const nt = el('textarea', { placeholder: 'توضیحات' });
    const st = el('select', {}, el('option', { value: 'active' }, 'فعال'), el('option', { value: 'inactive' }, 'غیرفعال'));
    const prim = el('input', { type: 'checkbox' });
    if (ct) { n.value = ct.name || ''; pos.value = ct.position || ''; mob.value = ct.mobile || ''; ph.value = ct.phone || ''; em.value = ct.email || ''; provSel.value = ct.province || ''; cityIn.value = ct.city || ''; indIn.value = ct.industrial_city || ''; ad.value = ct.address || ''; nt.value = ct.notes || ''; st.value = ct.status || 'active'; prim.checked = !!ct.is_primary; }
    if (presetCustomer) custCtl.setValue(Number(presetCustomer));
    const contactGrid = el('div', { class: 'form-grid' },
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'مشتری (Master Data) *'), custCtl),
      el('div', { class: 'field' }, el('label', {}, 'نام *'), n),
      el('div', { class: 'field' }, el('label', {}, 'سمت'), pos),
      el('div', { class: 'field' }, el('label', {}, 'موبایل'), mob),
      el('div', { class: 'field' }, el('label', {}, 'تلفن'), ph),
      el('div', { class: 'field' }, el('label', {}, 'ایمیل'), em),
      el('div', { class: 'field' }, el('label', {}, 'استان'), provSel),
      el('div', { class: 'field' }, el('label', {}, 'شهر'), cityIn),
      el('div', { class: 'field' }, el('label', {}, 'شهرک صنعتی'), el('div', {}, indIn)),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'آدرس'), ad),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'توضیحات'), nt),
      el('div', { class: 'field' }, el('label', {}, 'وضعیت'), st),
      el('div', { class: 'field' }, el('label', { class: 'chk' }, prim, 'مخاطب اصلی')));
    wireGeoCascade({ provinceSel: provSel, cityIn: cityIn, indCityIn: indIn, indWrap: indIn.parentElement, attachTo: contactGrid }, { canCreate: !!(window.__me().permissions && window.__me().permissions.industrial_city && window.__me().permissions.industrial_city.create) });
    const ov = openModal(ct ? 'ویرایش مخاطب: ' + ct.name : 'مخاطب جدید', contactGrid, {
      footer: [
        ct ? el('button', { class: 'btn danger', onclick: async () => {
          if (await confirmDialog('حذف مخاطب', '«' + ct.name + '» حذف شود؟', 'حذف', true)) {
            try { await api.del('/api/customers/' + ct.customer_id + '/contacts/' + ct.id); ov.close(); load(); toast('حذف شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
          }
        } }, 'حذف') : null,
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          const custId = custCtl.value;
          if (!custId) return toast('مشتری را انتخاب کنید', 'err');
          if (!n.value.trim()) return toast('نام الزامی است', 'err');
          const body = { name: n.value.trim(), position: pos.value.trim(), phone: ph.value.trim(), mobile: mob.value.trim(), email: em.value.trim(), province: provSel.value, city: cityIn.value.trim(), industrial_city: indIn.value.trim(), address: ad.value.trim(), notes: nt.value.trim(), status: st.value, is_primary: prim.checked };
          const save = async (force) => {
            if (ct) await api.put('/api/customers/' + custId + '/contacts/' + ct.id, body);
            else await api.post('/api/customers/' + custId + '/contacts', { ...body, ...(force ? { _force: 1 } : {}) });
          };
          try {
            try { await save(false); }
            catch (e2) {
              if (e2.code === 'DUPLICATE') {
                const dups = (e2.data && e2.data.duplicates) || [];
                const dupMsg = dups.length ? dups.map(x => el('div', {}, x.name + ' — ' + (x.mobile || x.phone || x.email || ''))) : el('div', {}, 'رکورد مشابهی وجود ندارد.');
                if (await confirmDialog('مخاطب مشابه یافت شد', [dupMsg, el('div', {}, 'ادامه می‌دهید؟')], 'همچنین ثبت', false)) await save(true);
                else return;
              } else throw e2;
            }
            ov.close(); load(); toast('ذخیره شد', 'ok');
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save'))
      ]
    });
  }
  window.__contactsAdd = (presetCustomer) => contactForm(null, presetCustomer);

  async function load() {
    clear(box);
    box.append(el('div', { class: 'skel', style: 'height:200px' }));
    let data;
    try { data = await api.get('/api/contacts?per_page=100&q=' + encodeURIComponent(searchIn.value.trim())); }
    catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); return; }
    clear(box);
    const items = data.items || [];
    if (!items.length) return box.append(el('div', {}, emptyState('مخاطبی ثبت نشده است — با دکمهٔ «افزودن مخاطب» شروع کنید.')));
    const head = el('tr', {}, el('th', {}, 'نام'), el('th', {}, 'مشتری'), el('th', {}, 'سمت'), el('th', {}, 'موبایل'), el('th', {}, 'تلفن'), el('th', {}, 'ایمیل'), el('th', {}, 'وضعیت'), el('th', {}, ''));
    box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head),
      el('tbody', {}, items.map(r => {
        const acts = el('div', { class: 'row-act', style: 'display:flex; gap:3px' });
        acts.append(iconBtn('eye', 'ویرایش / مشاهده', () => contactForm(r)));
        return el('tr', { style: 'cursor:pointer', onclick: () => contactForm(r) },
          el('td', {}, el('b', { class: 'small' }, r.name), r.is_primary ? el('span', { class: 'badge gold small', style: 'margin-inline-start:6px' }, 'اصلی') : null),
          el('td', {}, el('a', { href: '#/customers/' + r.customer_id }, r.customer_name)),
          el('td', {}, r.position || '—'),
          el('td', { class: 'num' }, r.mobile || '—'),
          el('td', { class: 'num' }, r.phone || '—'),
          el('td', {}, r.email || '—'),
          el('td', {}, el('span', { class: 'badge ' + (r.status === 'active' ? 'green' : 'muted') }, r.status === 'active' ? 'فعال' : 'غیرفعال')),
          el('td', { class: 'row-act' }, acts));
      })))));
  }
  load();
}
// ============ Customer 360 ============
const PORTAL_CHANNELS_FA = { sms: 'پیامک', whatsapp: 'واتساپ', telegram: 'تلگرام', email: 'ایمیل' };
function directMessageForm(customerId) {
  const body = el('div');
  const ov = openModal('ارسال پیام مستقیم به مشتری', body, { footer: [
    el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
    el('button', { class: 'btn primary', onclick: async (e) => {
      e.target.disabled = true;
      try {
        const r = await api.post('/api/customermsg/send', { customer_id: customerId, event_type: 'manual', channel: chSel.value, body: bodyIn.value.trim() });
        toast(r && r.status === 'sent' ? 'پیام ارسال شد.' : 'پیام ثبت شد (وضعیت: ' + (r && r.status || 'pending') + ').', 'ok');
        ov.close();
      } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
    } }, 'ارسال')
  ]});
  const chSel = el('select', {});
  Object.entries(PORTAL_CHANNELS_FA).forEach(([v, l]) => chSel.append(el('option', { value: v }, l)));
  const bodyIn = el('textarea', { style: 'width:100%; min-height:110px', placeholder: 'متن اختصاصی پیام…' });
  body.append(
    el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'پلتفرم ارسال'), chSel),
    el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'متن پیام اختصاصی'), bodyIn),
    el('div', { class: 'muted small' }, 'اگر پلتفرم در تنظیمات یکپارچه‌سازی پیکربندی نشده باشد، پیام با وضعیت not_configured ثبت می‌شود (بدون ارسال واقعی).'));
}
function portalCredentialsForm(customerId, cust) {
  const body = el('div');
  const ov = openModal('دسترسی محدود مشتری (پورتال)', body, { footer: [
    el('button', { class: 'btn', onclick: () => ov.close() }, 'بستن'),
    el('button', { class: 'btn primary', onclick: async (e) => {
      e.target.disabled = true;
      try {
        const r = await api.post(`/api/r/customer/${customerId}/portal-credentials`, {
          username: usernameIn.value.trim(),
          password: passwordIn.value || undefined,
          enabled: enabledChk.checked,
        });
        toast(r.enabled ? 'دسترسی پورتال فعال شد — می‌توانید با لینک #/portal وارد شوید.' : 'تنظیمات پورتال ذخیره شد (غیرفعال).', 'ok');
        ov.close();
      } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
    } }, 'ذخیره و اعمال')
  ]});
  const usernameIn = el('input', { dir: 'ltr', placeholder: 'مثال: akhavan-com', value: cust.portal_username || '', style: 'width:100%' });
  const passwordIn = el('input', { type: 'password', dir: 'ltr', placeholder: cust.portal_has_password ? '*** (برای تغییر، رمز جدید وارد کنید)' : 'حداقل ۸ کاراکتر', style: 'width:100%' });
  const enabledChk = el('input', { type: 'checkbox', checked: cust.portal_enabled ? '' : null, style: 'width:auto' });
  body.append(
    el('div', { class: 'muted small mb-10' }, 'با فعال‌سازی، مشتری با نام کاربری و رمز عبور به پورتال (' , el('a', { href: '#/portal' }, '#/portal'), el('span', {}, ') دسترسی پیدا می‌کند و فقط داده‌های خودش (ثبت سفارش، مشاهده سفارش‌ها، ثبت/پیگیری شکایت، ارسال پیام) را می‌بیند.')),
    el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'نام کاربری/اکانت'), usernameIn),
    el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'رمز عبور'), passwordIn),
    el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, el('span', { style: 'display:inline-flex; align-items:center; gap:6px' }, enabledChk, 'فعال‌سازی دسترسی محدود مشتری'))));
}
export async function customerDetail(c, id) {
  let cust;
  try { cust = (await api.get('/api/r/customer/' + id)).item; } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  c.append(el('div', { class: 'page-head' },
    el('a', { class: 'btn sm ghost', href: '#/customers' }, '→ مشتریان'),
    el('div', {}, el('h1', {}, cust.name), el('div', { class: 'sub' }, (cust.number || '') + ' • ' + statusFa(cust.type) + (cust.city ? ' • ' + cust.city : ''))),
    el('div', { class: 'actions' },
      helpBtn('customers'),
      recordExportBtn('customer', cust, { title: cust.name }),
      el('button', { class: 'btn sm gold', onclick: () => location.hash = '#/quotes?new_customer=' + id }, '＋ پیش‌فاکتور جدید'),
      el('button', { class: 'btn sm gold', onclick: () => location.hash = '#/orders?new_customer=' + id }, '＋ سفارش جدید'),
      el('button', { class: 'btn sm gold', onclick: () => location.hash = '#/invoices?new_customer=' + id }, '＋ فاکتور جدید'),
      el('button', { class: 'btn sm gold', onclick: () => location.hash = '#/payments?new_customer=' + id }, '＋ ثبت پرداخت'),
      el('button', { class: 'btn sm', onclick: () => location.hash = '#/complaints?new_customer=' + id }, '＋ شکایت'),
      el('button', { class: 'btn sm', onclick: () => location.hash = '#/tickets?new_customer=' + id }, '＋ تیکت'),
      el('button', { class: 'btn sm', onclick: () => openChatFor('customer', id, cust.name) }, '💬 پیام'),
      el('button', { class: 'btn sm', title: 'ارسال پیام مستقیم با انتخاب پلتفرم و متن اختصاصی', onclick: () => directMessageForm(id) }, '📨 ارسال پیام'),
      el('button', { class: 'btn sm', title: 'دسترسی محدود مشتری (سفارش/شکایت/پیام خودشان)', onclick: () => portalCredentialsForm(id, cust) }, '🔐 پورتال مشتری'),
      el('button', { class: 'btn sm', onclick: () => location.hash = '#/ai/assistant?c=' + id }, '🤖 تحلیل AI'),
      el('button', { class: 'btn sm', title: 'Click-to-Call از طریق VoIP', onclick: () => {
        const num = cust.mobile || cust.phone;
        if (!num) return toast('شماره تماس برای این مشتری ثبت نشده است', 'err');
        api.post('/api/voip/call', { to: num }).then(r => toast('درخواست تماس ارسال شد — ' + (r.call_ref || 'Call ID: ' + r.call_id), 'ok')).catch(e => toast(e.message, 'err'));
      } }, '☎ تماس')))
    );
  // KPI strip
  const kpiBox = el('div', { class: 'grid g-4 mb-16' });
  c.append(kpiBox);
  const mk = async (label, fn) => {
    const card = el('div', { class: 'card stat' }, el('div', { class: 's-label' }, label), el('div', { class: 's-value skel', style: 'height:24px; width:80px' }));
    kpiBox.append(card);
    try {
      const v = await fn();
      card.querySelector('.s-value').classList.remove('skel');
      card.querySelector('.s-value').textContent = v;
    } catch { card.querySelector('.s-value').textContent = '—'; }
  };
  let fin = null;
  const getFin = async () => fin || (fin = await api.get(`/api/customers/${id}/finance`).catch(() => ({ totals: { total_invoices: 0, total_paid: 0, balance: 0, open_invoices: 0 } })));
  mk('مجموع فاکتور', async () => fmtMoney((await getFin()).totals.total_invoices));
  mk('مجموع پرداخت', async () => fmtMoney((await getFin()).totals.total_paid));
  mk('مانده (مطالبات)', async () => fmtMoney((await getFin()).totals.balance));
  mk('ریسک ریزش (AI)', async () => {
    const r = await api.get('/api/ai/customer/' + id);
    return faDigits(r.churn.score) + ' / ۱۰';
  });
  mk('ارزش کل (CLV)', async () => {
    const r = await api.get('/api/ai/customer/' + id);
    return fmtMoney(r.clv);
  });
  // Call history KPI (VoIP) — clickable → customer call history
  {
    const card = el('div', { class: 'card stat', style: 'cursor:pointer' },
      el('div', { class: 's-label' }, '☎ تماس‌ها'),
      el('div', { class: 's-value skel', style: 'height:24px; width:80px' }),
      el('div', { class: 'muted small' }, 'کلیک: تاریخچه تماس‌ها'));
    kpiBox.append(card);
    card.addEventListener('click', () => location.hash = '#/calls?customer=' + id);
    api.get('/api/voip/customers/' + id + '/stats').then(s => {
      card.querySelector('.s-value').classList.remove('skel');
      card.querySelector('.s-value').textContent = faDigits(s.count) + ' تماس';
      card.querySelector('.muted').textContent = (s.last ? 'آخرین: ' + fmtDate(s.last) + ' • ' : '') + Math.round((s.talk_sec || 0) / 60) + ' دقیقه کل' + (s.missed ? ' • ' + faDigits(s.missed) + ' از دست‌رفته' : '');
    }).catch(() => { card.querySelector('.s-value').classList.remove('skel'); card.querySelector('.s-value').textContent = '—'; });
  }
  const tabsBox = el('div', {});
  c.append(tabsBox);
  const content = el('div', {});
  c.append(content);
  const tabItems = ['اطلاعات', 'مخاطبین', 'سفارش‌ها', 'فاکتورها', 'پیش‌فاکتورها', 'فرصت‌ها', 'شکایات', 'تیکت‌ها', 'اسناد', 'پرداخت‌ها', 'پورسانت‌ها', 'فعالیت‌ها', 'نظرات', 'AI', 'جلسات', 'پیگیری‌ها'];
  const sel = (i) => {
    clear(tabsBox).append(tabs(tabItems, i, sel));
    loadTab(i);
  };
  async function loadTab(i) {
    clear(content);
    content.append(el('div', { class: 'skel', style: 'height:180px' }));
    try {
      if (i === 0) {
        const kv = el('dl', { class: 'kv' });
        for (const [k, l] of [['phone', 'تلفن'], ['mobile', 'موبایل'], ['email', 'ایمیل'], ['website', 'وب‌سایت'], ['tax_code', 'کد ملی / ثبت'], ['province', 'استان'], ['city', 'شهر'], ['address', 'آدرس'], ['industry', 'صنعت'], ['activity_type', 'نوع فعالیت'], ['credit_limit', 'سقف اعتبار'], ['credit_status', 'وضعیت اعتباری'], ['status', 'وضعیت'], ['salesperson_id', 'کارشناس فروش'], ['notes', 'یادداشت']]) {
          const v = cust[k];
          if (v === null || v === undefined || v === '') continue;
          let cell = v;
          if (k === 'credit_limit') cell = fmtMoney(v);
          else if (k === 'status' || k === 'credit_status') cell = statusFa(v);
          else if (k === 'salesperson_id') cell = cust.salesperson_id_name || ('#' + v);
          kv.append(el('dt', {}, l), el('dd', {}, String(cell)));
        }
        if (cust.custom_fields && typeof cust.custom_fields === 'object') {
          const meta = await window.__meta().catch(() => null);
          const defs = (meta && meta.resources.customer.fields) || [];
          for (const [fk, fv] of Object.entries(cust.custom_fields)) {
            if (fv === null || fv === undefined || fv === '') continue;
            kv.append(el('dt', {}, 'سفارشی: ' + fk), el('dd', {}, String(fv)));
          }
        }
        content.append(el('div', { class: 'card' }, el('div', { class: 'card-b' }, kv)));
      }
      if (i === 1) {
        const { items } = await api.get(`/api/customers/${id}/contacts`);
        const voiceBtn = (() => { const b = voiceRegisterButton({ mode: 'contact' }); b.className = 'btn sm'; b.title = 'ثبت سریع مخاطب این مشتری با صدا (fa-IR)'; b.addEventListener('click', () => openVoiceRegister(() => fill(), { mode: 'contact', presetCustomer: id })); return b; })();
        const box = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'مخاطبین'),
          el('div', { class: 'flex', style: 'margin-inline-start:auto; gap:6px' }, voiceBtn,
            el('button', { class: 'btn sm gold', onclick: () => contactForm(null, id) }, '＋ مخاطب')),
          el('div', { id: 'cts' })));
        content.append(box);
        const fill = () => {
          const b = box.querySelector('#cts');
          clear(b);
          if (!items.length) { b.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'مخاطبی ثبت نشده است.')); return; }
          const head = el('tr', {}, el('th', {}, 'نام'), el('th', {}, 'سمت'), el('th', {}, 'تلفن'), el('th', {}, 'موبایل'), el('th', {}, 'ایمیل'), el('th', {}, ''));
          const rows = items.map(ct => {
            const acts = el('div', { class: 'row-act', style: 'display:flex; gap:3px' });
            acts.append(iconBtn('eye', 'جزئیات و ویرایش', () => contactModal(ct)));
            acts.append(iconBtn('trash', 'حذف', async () => {
              if (await confirmDialog('حذف مخاطب', 'مخاطب حذف شود؟', 'حذف', true)) {
                try { await api.del(`/api/customers/${id}/contacts/${ct.id}`); items = items.filter(x => x.id !== ct.id); fill(); } catch (e) { toast(e.message, 'err'); }
              }
            }));
            return el('tr', { style: 'cursor:pointer', onclick: () => contactModal(ct) },
              el('td', {}, el('b', {}, ct.name), ct.is_primary ? el('span', { class: 'badge gold small', style: 'margin-inline-start:6px' }, 'اصلی') : null),
              el('td', {}, ct.position || '—'),
              el('td', { class: 'num' }, ct.phone || '—'),
              el('td', { class: 'num' }, ct.mobile || '—'),
              el('td', {}, ct.email || '—'),
              el('td', { class: 'row-act' }, acts));
          });
          b.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
        };
        fill();
        function contactForm() {
          const n = el('input', { placeholder: 'نام و نام خانوادگی' });
          const p = el('input', { placeholder: 'سمت' });
          const ph = el('input', { placeholder: 'تلفن' });
          const mo = el('input', { placeholder: 'موبایل' });
          const em = el('input', { placeholder: 'ایمیل' });
          openModal('مخاطب جدید', el('div', { class: 'form-grid' },
            el('div', { class: 'field' }, n), el('div', { class: 'field' }, p),
            el('div', { class: 'field' }, ph), el('div', { class: 'field' }, mo),
            el('div', { class: 'field', style: 'grid-column:1/-1' }, em)), {
            footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
              el('button', { class: 'btn primary', onclick: async () => {
                if (!n.value.trim()) return toast('نام الزامی است', 'err');
                try {
                  await api.post(`/api/customers/${id}/contacts`, { name: n.value, position: p.value, phone: ph.value, mobile: mo.value, email: em.value });
                  items.unshift({ id: Date.now(), name: n.value, position: p.value, phone: ph.value, mobile: mo.value, email: em.value });
                  fill(); ov.close(); toast('ذخیره شد', 'ok');
                } catch (e) { toast(e.message, 'err'); }
              } }, t('save'))],
          });
        }
        function contactModal(ct) {
          let fresh = { ...ct };
          const n = el('input', { value: fresh.name || '', placeholder: 'نام و نام خانوادگی' });
          const pos = el('input', { value: fresh.position || '', placeholder: 'سمت شغلی' });
          const ph = el('input', { value: fresh.phone || '', dir: 'ltr', placeholder: 'تلفن ثابت' });
          const mo = el('input', { value: fresh.mobile || '', dir: 'ltr', placeholder: 'موبایل' });
          const em = el('input', { value: fresh.email || '', dir: 'ltr', placeholder: 'ایمیل' });
          const prim = el('input', { type: 'checkbox', checked: fresh.is_primary ? '' : null });
          const ov = openModal('مخاطب: ' + (fresh.name || ''), el('div', { class: 'form-grid' },
            el('div', { class: 'field' }, el('label', {}, 'نام'), n),
            el('div', { class: 'field' }, el('label', {}, 'سمت'), pos),
            el('div', { class: 'field' }, el('label', {}, 'تلفن'), ph),
            el('div', { class: 'field' }, el('label', {}, 'موبایل'), mo),
            el('div', { class: 'field' }, el('label', {}, 'ایمیل'), em),
            el('div', { class: 'field' }, el('label', {}, 'مخاطب اصلی'), prim)),
            { footer: [
              el('button', { class: 'btn danger', onclick: async () => {
                if (!(await confirmDialog('حذف مخاطب', '«' + (n.value || 'این مخاطب') + '» حذف شود؟', 'حذف', true))) return;
                try { await api.del(`/api/customers/${id}/contacts/${fresh.id}`); items = items.filter(x => x.id !== fresh.id); ov.close(); fill(); toast('حذف شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
              } }, 'حذف'),
              el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
              el('button', { class: 'btn primary', onclick: async () => {
                if (!n.value.trim()) return toast('نام الزامی است', 'err');
                try {
                  const r = await api.put(`/api/customers/${id}/contacts/${fresh.id}`, { name: n.value.trim(), position: pos.value, phone: ph.value, mobile: mo.value, email: em.value, is_primary: prim.checked });
                  const idx = items.findIndex(x => x.id === fresh.id); if (idx >= 0) items[idx] = { ...items[idx], ...(r.item || {}) };
                  fill(); ov.close(); toast('ذخیره شد', 'ok');
                } catch (e) { toast(e.message, 'err'); }
              } }, t('save'))
            ]
          });
        }
      }
      if (i === 2 || i === 3 || i === 4 || i === 5) {
        const res = ['order', 'invoice', 'quote', 'opportunity'][i - 2];
        // server-side customer filter (real Customer Master link — no client-side partial filter)
        const { items } = await api.get(`/api/r/${res}?per_page=50&f_customer_id=${id}`);
        const list = items.filter(x => !x.customer_id || x.customer_id === Number(id));
        const cols = {
          order: [['number', 'شماره'], ['status', 'وضعیت'], ['order_date', 'تاریخ'], ['due_date', 'تحویل'], ['total', 'مبلغ']],
          invoice: [['number', 'شماره'], ['status', 'وضعیت'], ['issue_date', 'صدور'], ['due_date', 'سررسید'], ['total', 'مبلغ'], ['paid_amount', 'پرداختی']],
          quote: [['number', 'شماره'], ['status', 'وضعیت'], ['created_at', 'تاریخ'], ['valid_until', 'اعتبار تا'], ['total', 'مبلغ']],
          opportunity: [['title', 'عنوان'], ['status', 'وضعیت'], ['probability', 'احتمال'], ['expected_close_at', 'سررسید'], ['amount', 'مبلغ']],
        }[res];
        const routes = { order: '/orders', invoice: '/invoices', quote: '/quotes', opportunity: '/opportunities' }[res];
        const box = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, tabItems[i]), el('a', { class: 'btn sm', style: 'margin-inline-start:auto', href: '#' + routes + '?f_customer_id=' + id }, 'همه')));
        content.append(box);
        if (!list.length) return box.append(el('div', { class: 'muted small', style: 'padding:16px' }, 'رکوردی برای این مشتری ثبت نشده است.'));
        box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, cols.map(col => el('th', {}, col[1])))),
          el('tbody', {}, list.slice(0, 15).map(row => el('tr', { style: 'cursor:pointer', onclick: () => location.hash = '#' + routes + '/' + row.id },
            cols.map(col => {
              const v = row[col[0]];
              if (col[0] === 'total' || col[0] === 'paid_amount' || col[0] === 'amount') return el('td', { class: 'num' }, fmtMoney(v));
              if (col[0] === 'status' || col[0] === 'probability') return el('td', {}, col[0] === 'probability' ? el('span', { class: 'badge gold' }, faDigits(v) + '٪') : el('span', { class: 'badge' }, statusFa(v)));
              if (col[0].includes('date') || col[0] === 'valid_until' || col[0] === 'expected_close_at' || col[0] === 'created_at') return el('td', {}, fmtDate(v));
              return el('td', {}, v || '—');
            })))))));
      }
      if (i === 6 || i === 7) {
        const res = i === 6 ? 'complaint' : 'ticket';
        const { items } = await api.get(`/api/r/${res}?per_page=50`);
        const list = items.filter(x => x.customer_id === Number(id));
        const box = el('div', { class: 'card' });
        content.append(box);
        if (!list.length) return box.append(el('div', { class: 'card-b muted small' }, 'رکوردی ثبت نشده است.'));
        box.append(...list.slice(0, 12).map(row => el('div', { class: 'flex between', style: 'padding:11px 16px; border-top:1px solid var(--border); cursor:pointer', onclick: () => location.hash = '#' + (res === 'complaint' ? '/complaints/' + row.id : '/tickets') },
          el('div', {}, el('b', { class: 'small' }, row.subject || row.title), el('div', { class: 'muted small' }, (row.number || '') + ' • ' + fmtDate(row.created_at))),
          el('div', { class: 'flex' }, el('span', { class: 'badge ' + (/critical|high/.test(row.priority || '') ? 'red' : '') }, statusFa(row.priority)), el('span', { class: 'badge ' + (/resolved|closed|won/.test(row.status || '') ? 'green' : 'orange') }, statusFa(row.status))))));
      }
      if (i === 8) {
        const { items } = await api.get('/api/r/document?per_page=100');
        const box = el('div', { class: 'card' });
        content.append(box);
        const list = items.filter(x => (x.title || '').includes(cust.name) || (x.tags || '').includes(cust.name));
        if (!list.length) return box.append(el('div', { class: 'card-b muted small' }, 'سند اختصاصی ثبت نشده است. از بخش «اسناد» مدیریت کنید.'));
        box.append(...list.map(d => el('div', { class: 'flex between small', style: 'padding:10px 16px; border-top:1px solid var(--border)' }, el('span', {}, '📄 ' + d.title), el('span', { class: 'muted' }, fmtDate(d.created_at)))));
      }
      if (i === 9) {
        // Payments of this customer (master data → payments)
        const fin = await api.get(`/api/customers/${id}/finance`);
        const box = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'پرداخت‌های مشتری'), el('a', { class: 'btn sm', style: 'margin-inline-start:auto', href: '#/payments' }, 'همه پرداخت‌ها')));
        content.append(box);
        box.append(el('div', { class: 'card-b small muted' }, 'مجموع پرداخت: ' + fmtMoney(fin.totals.total_paid) + ' — مانده: ' + fmtMoney(fin.totals.balance)));
        const recent = fin.recent_payments || [];
        if (!recent.length) return box.append(el('div', { class: 'card-b muted small' }, 'پرداختی ثبت نشده است.'));
        box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'شماره'), el('th', {}, 'فاکتور'), el('th', {}, 'مبلغ'), el('th', {}, 'روش'), el('th', {}, 'بانک/حساب'), el('th', {}, 'تاریخ'), el('th', {}, 'وضعیت'))),
          el('tbody', {}, recent.map(p => el('tr', {},
            el('td', {}, p.number), el('td', {}, p.invoice_number || '—'), el('td', { class: 'num' }, fmtMoney(p.amount)),
            el('td', {}, statusFa(p.method)), el('td', { class: 'small' }, [p.bank, p.account].filter(Boolean).join(' / ') || '—'),
            el('td', {}, fmtDate(p.paid_at)),
            el('td', {}, el('span', { class: 'badge ' + (/paid/.test(p.status || '') ? 'green' : /refunded|cancelled|failed/.test(p.status || '') ? 'red' : 'orange') }, statusFa(p.status) || p.status || 'ثبت‌شده'))))))));
      }
      if (i === 10) {
        // Commissions related to this customer
        const comms = (await api.get('/api/commissions').catch(() => ({ rows: [] }))).rows || [];
        const list = comms.filter(x => x.customer_id === Number(id));
        const box = el('div', { class: 'card' });
        content.append(box);
        if (!list.length) return box.append(el('div', { class: 'card-b muted small' }, 'پورسانتی برای این مشتری ثبت نشده است.'));
        const total = list.filter(x => x.status !== 'cancelled').reduce((a, x) => a + x.amount, 0);
        box.append(el('div', { class: 'card-b small muted' }, 'مجموع پورسانت مرتبط: ' + fmtMoney(total)));
        box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'کارشناس'), el('th', {}, 'دوره'), el('th', {}, 'مبنای محاسبه'), el('th', {}, 'مبلغ مبنای محاسبه'), el('th', {}, 'درصد'), el('th', {}, 'پورسانت'), el('th', {}, 'وضعیت'))),
          el('tbody', {}, list.map(x => el('tr', {},
            el('td', {}, x.full_name || '—'), el('td', { class: 'num' }, x.period), el('td', { class: 'small' }, x.basis || '—'),
            el('td', { class: 'num' }, fmtMoney(x.base)), el('td', {}, x.rate ? faDigits(x.rate) + '٪' : '—'),
            el('td', { class: 'num' }, fmtMoney(x.amount)),
            el('td', {}, el('span', { class: 'badge ' + (x.status === 'paid' ? 'green' : x.status === 'cancelled' ? 'red' : '') }, x.status))))))));
      }
      if (i === 11) {
        const { items } = await api.get(`/api/r/customer/${id}/activities`);
        if (!items.length) return content.append(el('div', { class: 'card' }, el('div', { class: 'card-b muted small' }, 'فعالیتی ثبت نشده است.')));
        content.append(el('div', { class: 'card' }, el('div', { class: 'card-b' },
          el('div', { class: 'timeline' }, items.map(a => el('div', { class: 'tl-item' }, el('div', { class: 'tl-t' }, a.summary), el('div', { class: 'tl-d' }, (a.full_name ? a.full_name + ' — ' : '') + fmtDate(a.created_at, { time: true }))))))));
      }
      if (i === 12) {
        const { items } = await api.get(`/api/r/customer/${id}/comments`);
        const input = el('textarea', { placeholder: 'یادداشت خود را بنویسید…' });
        const btn = el('button', { class: 'btn primary sm', onclick: async () => {
          if (!input.value.trim()) return;
          try { await api.post(`/api/r/customer/${id}/comments`, { body: input.value }); input.value = ''; loadTab(12); } catch (e) { toast(e.message, 'err'); }
        } }, t('send'));
        content.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-b flex' }, input, btn)));
        if (items.length) content.append(el('div', { class: 'card' }, el('div', { class: 'card-b' }, items.map(cm => el('div', { class: 'mb-10 small' }, el('b', {}, cm.full_name), ' — ', el('span', { class: 'muted' }, fmtDate(cm.created_at, { time: true })), el('div', { class: 'mt-10' }, cm.body))))));
      }
      if (i === 13) {
        const r = await api.get('/api/ai/customer/' + id);
        const recs = r.recommendations || [];
        content.append(el('div', { class: 'grid g-2' },
          el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, '🤖 تحلیل هوشمند مشتری')),
            el('div', { class: 'card-b' },
              el('div', { class: 'kv mb-10' },
                el('dt', {}, 'ریسک ریزش'), el('dd', {}, faDigits(r.churn.score) + ' / ۱۰'),
                el('dt', {}, 'CLV تخمینی'), el('dd', {}, fmtMoney(r.clv)),
                r.sentiment ? [el('dt', {}, 'احساسات شکایات'), el('dd', {}, r.sentiment.label + ' (' + r.sentiment.score + ')')] : null),
              (r.churn.reasons || []).length ? el('div', { class: 'small muted mt-10' }, 'دلایل: ' + r.churn.reasons.join('؛ ')) : null)),
          el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'پیشنهاد اقدام‌ها (AI)')),
            el('div', {}, recs.map(rc => el('div', { class: 'flex between', style: 'padding:10px 16px; border-top:1px solid var(--border)' },
              el('span', { class: 'small' }, rc.detail || ''), el('span', { class: 'badge ' + (rc.priority <= 2 ? 'red' : rc.priority === 3 ? 'gold' : 'green') }, rc.action)))))));
      // Next Best Action (Smart Sales Team engine) — real, for this customer
      try {
        const nba = await api.get('/api/smart-sales/actions?limit=50');
        const mine = (nba.items || []).filter(a => a.customer_id === id || a.entity_id === id);
        content.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '⭐ Next Best Action (تیم هوشمند فروش)')),
          el('div', {}, mine.length ? mine.slice(0, 5).map(a => el('div', { class: 'flex between', style: 'padding:10px 16px; border-top:1px solid var(--border)' },
            el('div', {}, el('b', { class: 'small' }, a.title), el('div', { class: 'muted small' }, a.reason || '')),
            el('span', { class: 'badge ' + (a.priority === 1 ? 'red' : a.priority === 2 ? 'gold' : 'green') }, a.priority === 1 ? 'فوری' : a.priority === 2 ? 'مهم' : 'عادی'))) :
          el('div', { class: 'muted small', style: 'padding:14px' }, 'برای این مشتری پیشنهاد فعالی در صف نیست.'))));
      } catch { /* non-blocking */ }
      }
      if (i === 14) {
        // Meetings of this customer (planning/calendar ↔ customer master link)
        const { items } = await api.get(`/api/r/meeting?per_page=50&f_customer_id=${id}`);
        const list = items.filter(x => !x.customer_id || x.customer_id === Number(id));
        const box = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'جلسات (برنامه‌ریزی/تقویم)'), el('a', { class: 'btn sm', style: 'margin-inline-start:auto', href: '#/meetings?f_customer_id=' + id }, 'همه')));
        content.append(box);
        if (!list.length) return box.append(el('div', { class: 'muted small', style: 'padding:16px' }, 'جلسه‌ای برای این مشتری ثبت نشده است.'));
        box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'عنوان'), el('th', {}, 'شروع'), el('th', {}, 'محل'), el('th', {}, 'وضعیت'))),
          el('tbody', {}, list.slice(0, 15).map(row => el('tr', {},
            el('td', {}, el('b', { class: 'small' }, row.title)),
            el('td', {}, fmtDate(row.start_at, { time: true })),
            el('td', {}, row.location || '—'),
            el('td', {}, el('span', { class: 'badge' }, statusFa(row.status) || row.status || 'برنامه‌ریزی‌شده'))))))));
      }
      if (i === 15) {
        // Follow-ups of this customer (entity_type=customer, entity_id=this)
        const { items } = await api.get('/api/r/followup?per_page=200');
        const list = items.filter(x => x.entity_type === 'customer' && Number(x.entity_id) === Number(id));
        const box = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'پیگیری‌ها (Follow-ups)'), el('a', { class: 'btn sm', style: 'margin-inline-start:auto', href: '#/followups' }, 'همه')));
        content.append(box);
        if (!list.length) return box.append(el('div', { class: 'muted small', style: 'padding:16px' }, 'پیگیری‌ای برای این مشتری ثبت نشده است.'));
        const ST_CLS = { pending: 'orange', in_progress: 'blue', done: 'green', no_result: 'red', missed: 'red', cancelled: '' };
        const items15 = list.slice(0, 15);
        box.append(...items15.map(row => el('div', { class: 'flex between', style: 'padding:11px 16px; border-top:1px solid var(--border)' },
          el('div', {}, el('b', { class: 'small' }, row.subject || '—'), el('div', { class: 'muted small' }, ((row.note || '') + ' • ' + fmtDate(row.due_at)) + ' • ' + el('span', { id: 'fu-at-' + row.id }, 'در حال شمارش پیگیری‌ها…'))),
          el('span', { class: 'badge ' + (ST_CLS[row.status] || 'orange') }, statusFa(row.status) || row.status || 'در انتظار'))));
        // full attempt history per follow-up (real data, item: multi follow-up)
        items15.forEach(row => {
          api.get('/api/followups/' + row.id + '/attempts').then(r => {
            const span = box.querySelector('#fu-at-' + row.id);
            if (!span) return;
            const n2 = (r.items || []).length;
            const last = n2 ? r.items[n2 - 1] : null;
            span.textContent = (n2 ? faDigits(n2) + ' پیگیری انجام‌شده' + (last ? ' — آخرین: ' + last.result : '') : 'هنوز پیگیری‌ای ثبت نشده');
          }).catch(() => { const span = box.querySelector('#fu-at-' + row.id); if (span) span.textContent = '—'; });
        });
      }
    } catch (e) {
      clear(content).append(el('div', { class: 'alert danger' }, e.message));
    }
  }
  sel(0);
}
// quick messenger to a customer
function openChatFor(entity, id, name) {
  localStorage.setItem('bfc_chat_ref', JSON.stringify({ type: entity, id, name }));
  location.hash = '#/messenger';
}
