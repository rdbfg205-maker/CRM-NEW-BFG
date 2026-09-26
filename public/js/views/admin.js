'use strict';
import { api, t, getToken, fmtDate, fmtMoney, fmtNum, faDigits, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState } from '../ui.js';
import { iconBtn } from '../resource-view.js';
import { helpBtn } from './help.js';

// ============ Users ============
export async function usersPage(c) {
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'کاربران'), el('div', { class: 'sub' }, 'مدیریت حساب‌ها و نقش‌ها'))),
    el('div', { class: 'actions' }, helpBtn('admin'), el('button', { class: 'btn gold', onclick: () => userModal() }, '＋ کاربر جدید')));

  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:220px' }));
  c.append(card);
  let items = [];
  const sigMap = {}; // userId -> { has_sig, can_sign }
  try {
    const [r, sigR] = await Promise.all([
      api.get('/api/admin/users?per_page=200'),
      api.get('/api/admin/signatures').catch(() => ({ items: [] })),
    ]);
    items = r.items;
    for (const s of (sigR.items || [])) sigMap[s.id] = s;
  } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); return; }
  render();
  function viewSignature(u) {
    const box = el('div', { class: 'skel', style: 'height:80px' });
    const ov = openModal('امضای الکترونیکی: ' + u.full_name, box, {
      footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('close'))],
    });
    api.get('/api/admin/users/' + u.id + '/signature').then((info) => {
      clear(box);
      box.append(el('div', { class: 'flex between mb-10' },
        el('span', { class: 'badge ' + (info.has_signature ? 'green' : '') }, info.has_signature ? 'امضا ثبت شده' : 'امضایی ثبت نشده'),
        el('span', { class: 'badge ' + (info.can_sign ? 'green' : 'red') }, info.can_sign ? '✓ مجاز به امضا' : '✗ فاقد مجوز امضا')));
      if (info.has_signature) {
        const imgWrap = el('div', { style: 'min-height:70px; border:1.5px dashed var(--border-2); border-radius:10px; padding:10px; display:flex; align-items:center; justify-content:center; background:var(--surface-2)' });
        box.append(imgWrap);
        fetch('/api/admin/users/' + u.id + '/signature/download', { headers: { Authorization: 'Bearer ' + getToken() } })
          .then(r2 => r2.ok ? r2.blob() : Promise.reject(new Error('x')))
          .then(b => { const im = document.createElement('img'); im.src = URL.createObjectURL(b); im.style.cssText = 'max-width:220px; max-height:80px; object-fit:contain'; im.alt = 'امضا'; imgWrap.append(im); })
          .catch(() => imgWrap.append(el('span', { class: 'muted small' }, 'خطا در نمایش امضا')));
        box.append(el('div', { class: 'muted small mt-10' }, 'به‌روزرسانی: ' + (info.updated_at ? fmtDate(info.updated_at, { time: true }) : '—')));
      } else {
        box.append(el('div', { class: 'muted' }, 'این کاربر هنوز امضای الکترونیکی ثبت نکرده است (از بخش پروفایل خود، امضا را بارگذاری می‌کند).'));
      }
    }).catch(e => { clear(box).append(el('div', { class: 'alert danger' }, e.message)); });
  }
  function render() {
    clear(card);
    const head = el('tr', {}, el('th', {}, 'نام'), el('th', {}, 'نام کاربری'), el('th', {}, 'ایمیل'), el('th', {}, 'واحد'), el('th', {}, 'نقش‌ها'), el('th', {}, 'امضا'), el('th', {}, 'وضعیت'), el('th', {}, ''));
    const rows = items.map(u => {
      const s = sigMap[u.id] || {};
      const acts = el('td', { class: 'row-act' });
      if (s.has_sig) acts.append(iconBtn('eye', 'مشاهده امضا', () => viewSignature(u)));
      acts.append(iconBtn('edit', 'ویرایش', () => userModal(u)));
      acts.append(iconBtn('trash', u.archived_at ? 'بازیابی' : 'آرشیو', async () => {
        try { await api.del('/api/admin/users/' + u.id); u.archived_at = u.archived_at ? null : new Date().toISOString(); render(); } catch (e) { toast(e.message, 'err'); }
      }));
      return el('tr', {},
        el('td', {}, el('b', {}, u.full_name)),
        el('td', { class: 'num' }, u.username),
        el('td', {}, u.email || '—'),
        el('td', {}, u.department || '—'),
        el('td', {}, u.role_names || '—'),
        el('td', {}, s.has_sig
          ? el('span', { class: 'badge green' }, '✓ ثبت‌شده' + (s.can_sign ? '' : ' (بدون مجوز)'))
          : el('span', { class: 'badge' }, 'ثبت نشده')),
        el('td', {}, u.archived_at ? el('span', { class: 'badge' }, 'آرشیو') : u.active ? el('span', { class: 'badge green' }, 'فعال') : el('span', { class: 'badge red' }, 'غیرفعال')),
        acts);
    });
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  }
  function userModal(u) {
    const name = el('input', { value: u ? u.full_name : '', placeholder: 'نام و نام خانوادگی' });
    const un = el('input', { value: u ? u.username : '', placeholder: 'نام کاربری', disabled: u ? '' : null, dir: 'ltr' });
    const em = el('input', { value: u ? u.email : '', placeholder: 'ایمیل', dir: 'ltr' });
    const dept = el('input', { value: u ? u.department : '', placeholder: 'واحد (sales, finance, …)' });
    const pw = el('input', { type: 'password', placeholder: u ? 'رمز جدید (برای بازنشانی)' : 'رمز عبور اولیه' });
    const active = el('input', { type: 'checkbox', checked: u ? !!u.active : true, style: 'width:auto' });
    const rolesBox = el('div', { class: 'flex wrap', style: 'gap:8px' });
    api.get('/api/admin/roles').then(({ roles }) => {
      const cur = (u && u.role_ids) ? u.role_ids : (u ? String(u.role_names || '').split(', ') : ['sales']);
      for (const r of roles) {
        const cb = el('input', { type: 'checkbox', value: r.id, checked: cur.includes(r.name) ? '' : null, style: 'width:auto; margin-inline-end:5px' });
        rolesBox.append(el('label', { class: 'badge', style: 'cursor:pointer; display:inline-flex; gap:5px' }, cb, r.name_fa));
      }
    }).catch(() => {});
    const formGrid = el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', {}, 'نام'), name),
      el('div', { class: 'field' }, el('label', {}, 'نام کاربری'), un),
      el('div', { class: 'field' }, el('label', {}, 'ایمیل'), em),
      el('div', { class: 'field' }, el('label', {}, 'واحد'), dept),
      el('div', { class: 'field' }, el('label', {}, 'رمز'), pw),
      el('div', { class: 'field' }, el('label', {}, 'فعال'), active));
    const body = el('div', {}, formGrid, el('label', { class: 'small muted mt-16' }, 'نقش‌ها:'), rolesBox);
    const ov = openModal(u ? 'ویرایش کاربر' : 'کاربر جدید', body,
      { footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          const body = { full_name: name.value, email: em.value, department: dept.value, active: active.checked, role_ids: [...rolesBox.querySelectorAll('input:checked')].map(x => Number(x.value)) };
          try {
            if (u) {
              if (pw.value) body.password = pw.value;
              await api.put('/api/admin/users/' + u.id, body);
              toast('ذخیره شد', 'ok');
            } else {
              body.username = un.value;
              body.password = pw.value || '12345678';
              await api.post('/api/admin/users', body);
              toast('کاربر ایجاد شد', 'ok');
            }
            ov.close();
            location.reload();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ] });
  }
}
// ============ Roles ============
export async function rolesPage(c) {
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'نقش‌ها و دسترسی‌ها'), el('div', { class: 'sub' }, 'تعریف نقش و تعیین مجوزها (دیدن/ایجاد/ویرایش/حذف/خروجی/تأیید/آرشیو) با دامنه')),
    el('div', { class: 'actions' }, helpBtn('admin'), el('button', { class: 'btn gold', onclick: () => roleModal() }, '＋ نقش جدید'))));

  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(card);
  let roles = [];
  try { roles = (await api.get('/api/admin/roles')).roles; } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); return; }
  render();
  function render() {
    clear(card);
    const head = el('tr', {}, el('th', {}, 'نقش'), el('th', {}, 'توضیحات'), el('th', {}, 'کاربران'), el('th', {}, 'دسترسی‌ها'), el('th', {}, ''));
    const rows = roles.map(r => el('tr', {},
      el('td', {}, el('b', {}, r.name_fa), r.is_system ? el('span', { class: 'badge', style: 'margin-inline-start:6px' }, 'سیستمی') : ''),
      el('td', { class: 'muted small' }, r.description || '—'),
      el('td', {}, faDigits(r.user_count)),
      el('td', { class: 'small muted' }, r.permissions.slice(0, 8).map(p => p.entity + ':' + p.action).join('، ') + (r.permissions.length > 8 ? '، …' : '')),
      el('td', { class: 'row-act' },
        iconBtn('edit', 'دسترسی‌ها', () => permModal(r)),
        !r.is_system ? iconBtn('trash', 'حذف', async () => {
          if (await confirmDialog('حذف نقش', 'نقش «' + r.name_fa + '» حذف شود؟', 'حذف', true)) {
            try { await api.del('/api/admin/roles/' + r.id); roles = roles.filter(x => x.id !== r.id); render(); } catch (e) { toast(e.message, 'err'); }
        } }) : null)));
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  }
  function permModal(r) {
    const ENT_FA = { customer: 'مشتریان', customer_category: 'دسته مشتریان', lead: 'سرنخ‌ها', opportunity: 'فرصت‌های فروش', pipeline: 'Pipeline ها', pipeline_stage: 'مراحل Pipeline', product: 'محصولات', product_category: 'دسته محصولات', price_list: 'لیست قیمت', quote: 'پیش‌فاکتورها', order: 'سفارش‌ها', invoice: 'فاکتورها', payment: 'پرداخت‌ها', supplier: 'تأمین‌کنندگان', purchase_order: 'سفارش خرید', stock_transaction: 'گردش موجودی', stock_alert: 'هشدار موجودی', lab_request: 'درخواست آزمایش', lab_result: 'نتیجه آزمایش', complaint: 'شکایات', ticket: 'تیکت‌ها', warranty: 'گارانتی', contract: 'قراردادها', campaign: 'کمپین‌ها', loyalty_tier: 'سطوح باشگاه', loyalty_account: 'اعضای باشگاه', loyalty_transaction: 'تراکنش‌های باشگاه', meeting: 'جلسات', task: 'وظایف', followup: 'پیگیری‌ها', document: 'اسناد', workflow_rule: 'Workflow ها', tag: 'برچسب‌ها', report_definition: 'گزارش‌ها', user: 'کاربران', role: 'نقش‌ها', settings: 'تنظیمات', audit_log: 'ممیزی', backup: 'بکاپ', commission: 'پورسانت', approval: 'تأییدها', price_override: 'تغییر قیمت (Override)', signature: 'امضای الکترونیکی', bulk_delete: 'حذف گروهی', approval_chain: 'فرآیند تأیید و امضا' };
    const ACT_FA = { view: 'مشاهده', create: 'ایجاد', edit: 'ویرایش', delete: 'حذف', export: 'خروجی', approve: 'تأیید', archive: 'آرشیو', restore: 'بازیابی', import: 'ورود' };
    const list = el('div', { style: 'max-height:440px; overflow:auto' });
    list.append(el('div', { class: 'alert info small' }, 'تیک بزنید تا اجازه داده شود. «دامنهٔ دسترسی» مشخص می‌کند روی کدام رکوردها اعمال می‌شود: فقط خودم / تیم / واحد / همه.'));
    api.get('/api/admin/roles').then(({ roles: all, actions }) => {
      const me = all.find(x => x.id === r.id);
      const cur = Object.fromEntries((me.permissions || []).map(p => [p.entity + ':' + p.action, p.scope]));
      const entities = Object.keys(ENT_FA);
      const head = el('tr');
      head.append(el('th', {}, 'ماژول'));
      for (const a of actions) head.append(el('th', { style: 'text-align:center' }, ACT_FA[a] || a));
      head.append(el('th', {}, 'دامنهٔ دسترسی'));
      const tbl = el('table', { class: 'tbl', style: 'min-width:900px' });
      const thead = el('thead'); thead.append(head);
      const tbody = el('tbody');
      for (const e of entities) {
        const tr = el('tr');
        tr.append(el('td', {}, el('b', { class: 'small' }, ENT_FA[e] || e)));
        const cbs = [];
        for (const a of actions) {
          const td = el('td', { style: 'text-align:center' });
          const cb = el('input', { type: 'checkbox', style: 'width:auto; cursor:pointer' });
          if (cur[e + ':' + a]) { cb.checked = true; cb.dataset.scope = cur[e + ':' + a]; }
          cbs.push(cb);
          td.append(cb);
          tr.append(td);
        }
        const tdScope = el('td');
        const sc = el('select', { style: 'width:150px' });
        for (const [v, l] of [['own', 'فقط خودم'], ['team', 'تیم'], ['department', 'واحد'], ['all', 'همه']]) sc.append(el('option', { value: v }, l));
        const scopes = cbs.filter(x => x.checked).map(x => x.dataset.scope);
        if (scopes.length) sc.value = scopes[0];
        sc.addEventListener('change', () => cbs.forEach(x => { if (x.checked) x.dataset.scope = sc.value; }));
        cbs.forEach(x => x.addEventListener('change', () => { if (x.checked && !x.dataset.scope) x.dataset.scope = sc.value; }));
        tdScope.append(sc);
        tr.append(tdScope);
        tbody.append(tr);
      }
      tbl.append(thead, tbody);
      list.append(tbl);
      list._collect = () => {
        const perms = [];
        for (const tr of tbody.children) {
          const entityLabel = tr.children[0].textContent.trim();
          const entKey = Object.keys(ENT_FA).find(k => (ENT_FA[k] || k) === entityLabel);
          if (!entKey) continue;
          const scopeSel = tr.children[tr.children.length - 1].querySelector('select');
          for (let i = 1; i < tr.children.length - 1; i++) {
            const cb = tr.children[i].querySelector('input');
            if (cb && cb.checked) perms.push({ entity: entKey, action: actions[i - 1], scope: cb.dataset.scope || scopeSel.value || 'all' });
          }
        }
        return perms;
      };
    }).catch(e => list.append(el('div', { class: 'alert danger' }, e.message)));
    const ov = openModal('دسترسی‌های نقش: ' + r.name_fa, el('div', {}, list), { large: true, footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        if (!list._collect) return toast('در حال بارگذاری است', 'err');
        try {
          const perms = list._collect();
          await api.put('/api/admin/roles/' + r.id, { permissions: perms });
          toast('دسترسی‌ها ذخیره شد', 'ok');
          ov.close(); render();
        } catch (e) { toast(e.message, 'err'); }
      } }, t('save')),
    ] });
  }
  function roleModal() {
    const name = el('input', { placeholder: 'نام (انگلیسی، مثلاً hr)', dir: 'ltr' });
    const nameFa = el('input', { placeholder: 'نام فارسی (مثلاً منابع انسانی)' });
    const desc = el('input', { placeholder: 'توضیحات' });
    const ov = openModal('نقش جدید', el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'نام'), name),
      el('div', { class: 'field' }, el('label', {}, 'نام فارسی'), nameFa),
      el('div', { class: 'field' }, el('label', {}, 'توضیحات'), desc)),
      { footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          try {
            const r = await api.post('/api/admin/roles', { name: name.value, name_fa: nameFa.value, description: desc.value });
            toast('ایجاد شد — حالا دسترسی‌ها را تنظیم کنید', 'ok');
            ov.close();
            location.reload();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ] });
  }
}
// ============ Settings ============
export async function settingsPage(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'تنظیمات سیستم'), el('div', { class: 'sub' }, 'شرکت، مالی، AI، یکپارچه‌سازی‌ها، Fیلدهای سفارشی')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('admin')));
  c.append(_ph);
  let S = {};
  try { S = await api.get('/api/admin/settings'); } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  const card = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'اطلاعات شرکت (برای چاپ اسناد و فاکتورها)')), el('div', { class: 'card-b form-grid' }));
  c.append(card);
  const cb = card.children[1];
  const co = S.company || {};
  const coInputs = {};
  for (const [k, l, ltr] of [
    ['name', 'نام شرکت', 0], ['nameEn', 'نام انگلیسی', 1],
    ['factory_address', 'آدرس کارخانه', 0], ['factory_postal', 'کد پستی کارخانه', 1], ['factory_phone', 'تلفن کارخانه', 1],
    ['hq_address', 'آدرس دفتر مرکزی', 0], ['hq_postal', 'کد پستی دفتر مرکزی', 1],
    ['email', 'ایمیل', 1], ['website', 'وب‌سایت', 1], ['tax_code', 'کد اقتصادی', 0],
  ]) {
    const inp = el('input', { value: co[k] || '', placeholder: l, dir: ltr ? 'ltr' : null });
    coInputs[k] = inp;
    cb.append(el('div', { class: 'field' }, el('label', {}, l), inp));
  }
  // QR code of factory (shown in official print headers)
  const qrWrap = el('div', { class: 'field' }, el('label', {}, 'QR Code موقعیت کارخانه (در سربرگ چاپ نمایش داده می‌شود)'));
  if (co.qr_image) qrWrap.append(el('img', { src: co.qr_image, alt: 'QR', style: 'width:84px; height:84px; border:1px solid var(--border); border-radius:8px; padding:3px; background:#fff' }));
  const qrFile = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  qrWrap.append(qrFile, el('div', { class: 'muted small' }, 'فرمت تصویر، حداکثر 3MB'));
  const qrBtn = el('button', { class: 'btn sm', onclick: async () => {
    if (!qrFile.files.length) return toast('فایل تصویر را انتخاب کنید', 'err');
    const fd = new FormData();
    fd.append('file', qrFile.files[0]);
    try { await api.upload('/api/admin/company-qr', fd); toast('QR Code ذخیره شد', 'ok'); settingsPage(c); }
    catch (e) { toast(e.message, 'err'); }
  } }, 'بارگذاری QR');
  qrWrap.append(qrBtn);
  cb.append(qrWrap);
  cb.append(el('button', { class: 'btn primary sm', onclick: async () => {
    const v = {};
    for (const k of Object.keys(coInputs)) v[k] = coInputs[k].value;
    v.address = v.factory_address; // keep legacy address field in sync for older consumers
    try { await api.put('/api/admin/settings', { company: { ...co, ...v } }); toast('ذخیره شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
  } }, 'ذخیره اطلاعات شرکت'));
  // financial
  const fin = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'مالی')), el('div', { class: 'card-b form-grid' }));
  c.append(fin);
  const fb = fin.children[1];
  const taxIn = el('input', { type: 'number', value: S.tax_rate || 9, dir: 'ltr' });
  const curIn = el('select', {});
  for (const v of ['ریال', 'تومان']) curIn.append(el('option', { value: v, selected: (S.currency || 'ریال') === v ? '' : null }, v));
  fb.append(el('div', { class: 'field' }, el('label', {}, 'نرخ مالیات بر ارزش افزوده (%)'), taxIn),
    el('div', { class: 'field' }, el('label', {}, 'واحد پول پیش‌فرض'), curIn),
    el('div', { class: 'field' }, el('label', {}, 'نرخ امتیاز باشگاه مشتریان (امتیاز به ازای هر میلیون ریال)'), el('input', { type: 'number', value: S.loyalty_earn_rate || 1, dir: 'ltr', id: 'loyalty-rate' })));
  fb.append(el('button', { class: 'btn primary sm', onclick: async () => {
    try {
      await api.put('/api/admin/settings', { tax_rate: Number(taxIn.value), currency: curIn.value, loyalty_earn_rate: Number(fb.querySelector('#loyalty-rate').value) });
      toast('ذخیره شد', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  } }, 'ذخیره مالی'));
  // integrations
  const integ = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '🔌 یکپارچه‌سازی‌ها (SMS / ایمیل / واتساپ / درگاه / مودیان / حسابداری)')), el('div', {}));
  c.append(integ);
  const ib = integ.children[1];
  const INTS = [
    ['sms', 'پنل پیامکی', ['baseUrl', 'apiKey', 'sender', 'templateId']],
    ['email', 'ایمیل (SMTP/API)', ['baseUrl', 'apiKey']],
    ['whatsapp', 'واتساپ Business API', ['baseUrl', 'apiKey']],
    ['telegram', 'تلگرام / بل', ['baseUrl', 'token']],
    ['payment_gateway', 'درگاه پرداخت', ['baseUrl', 'merchantId', 'callbackUrl']],
    ['accounting', 'نرم‌افزار حسابداری', ['baseUrl', 'apiKey']],
    ['tax_system', 'سامانه مودیان مالیاتی', ['baseUrl', 'apiKey']],
  ];
  for (const [key, label, fields] of INTS) {
    const cur = S[key] || { active: 0, settings: {} };
    const row = el('div', { class: 'card-b', style: 'border-top:1px solid var(--border)' });
    const head = el('div', { class: 'flex between mb-10' });
    const act = el('input', { type: 'checkbox', checked: cur.active ? '' : null, style: 'width:auto' });
    const statusBadge = el('span', { class: 'badge muted' }, (cur.active && cur.settings && cur.settings.baseUrl) ? 'پیکربندی‌شده — تست کنید' : 'Not Configured');
    const testBtn = el('button', { class: 'btn sm' }, '⚡ Test Connection');
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      statusBadge.className = 'badge orange'; statusBadge.textContent = 'در حال تست واقعی…';
      try {
        const r = await api.post('/api/integrations/' + key + '/test');
        if (r.status === 'connected') { statusBadge.className = 'badge green'; statusBadge.textContent = (key === 'telegram' && r.api_ok) ? ('Connected — @' + (r.username || '')) : ('Connected' + (r.http_status ? ' (HTTP ' + r.http_status + ')' : '')); }
        else if (r.status === 'connection_failed') { statusBadge.className = 'badge red'; statusBadge.textContent = 'Connection Failed' + (r.error ? ' — ' + r.error : ''); }
        else { statusBadge.className = 'badge muted'; statusBadge.textContent = 'Not Configured'; }
      } catch (e) { statusBadge.className = 'badge red'; statusBadge.textContent = 'خطا: ' + e.message; }
      testBtn.disabled = false;
    });
    head.append(el('b', { class: 'small' }, label), el('label', { class: 'small muted', style: 'display:flex; gap:6px; align-items:center' }, act, 'فعال'), el('span', { class: 'flex', style: 'gap:6px; align-items:center' }, statusBadge, testBtn));
    row.append(head);
    const grid = el('div', { class: 'form-grid' });
    for (const f of fields) {
      const inp = el('input', { value: cur.settings && cur.settings[f] ? (f === 'apiKey' || f === 'token' ? '••••••' : cur.settings[f]) : '', placeholder: f, dir: 'ltr', type: f === 'apiKey' || f === 'token' ? 'password' : 'text' });
      inp._key = f;
      grid.append(el('div', { class: 'field' }, el('label', {}, f), inp));
    }
    grid.append(el('button', { class: 'btn primary sm', style: 'margin-top:6px', onclick: async () => {
      const v = { active: act.checked, settings: { ...(cur.settings || {}) } };
      for (const inp of grid.querySelectorAll('input[type=text], input[type=password]')) {
        if (inp.value && !inp.value.startsWith('•')) v.settings[inp._key] = inp.value;
      }
      try { await api.put('/api/admin/settings', { [key]: v }); toast('ذخیره شد' + (act.checked ? '' : ' (غیرفعال)'), 'ok'); } catch (e) { toast(e.message, 'err'); }
    } }, 'ذخیره'));
    row.append(grid);
    ib.append(row);
  }
  ib.append(el('div', { class: 'card-b small muted' }, 'کلیدهای API در سرور به‌صورت رمزنگاری‌شده (AES-256) نگهداری می‌شوند و هرگز در فرانت‌اند نمایش داده نمی‌شوند. وب‌هوک دریافتی: POST /api/webhook/:provider'));
  // ---------- AI Settings (Hybrid AI: Mode + Privacy + Providers + Real Test) ----------
  const aiCard = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, '🤖 تنظیمات AI (Hybrid — آنلاین / LLM محلی / هوش محلی)')), el('div', { class: 'card-b' }));
  c.append(aiCard);
  const ab = aiCard.children[1];
  api.get('/api/ai2/settings').then(async (cfg) => {
    const aiMode = cfg.ai_mode || 'hybrid';
    const priv = cfg.ai_privacy || {};
    const modeSel = el('select', {},
      el('option', { value: 'hybrid', selected: aiMode === 'hybrid' ? '' : null }, 'Hybrid (ترکیبی — پیش‌فرض)'),
      el('option', { value: 'auto', selected: aiMode === 'auto' ? '' : null }, 'خودکار'),
      el('option', { value: 'online_only', selected: aiMode === 'online_only' ? '' : null }, 'فقط آنلاین'),
      el('option', { value: 'offline_only', selected: aiMode === 'offline_only' ? '' : null }, 'فقط آفلاین'));
    const providerSel = el('select', {}, ...['gemini', 'openai', 'claude', 'custom'].map(p => el('option', { value: p, selected: (cfg.online_provider || 'gemini') === p ? '' : null }, p)));
    const modelIn = el('input', { value: cfg.online_model || '', dir: 'ltr', placeholder: 'model' });
    const keyIn = el('input', { type: 'password', dir: 'ltr', value: cfg.online_api_key_masked || '', placeholder: 'API Key (رمزنگاری‌شده ذخیره می‌شود)' });
    const localIn = el('input', { value: cfg.local_endpoint || '', dir: 'ltr', placeholder: 'http://127.0.0.1:11434/v1 (Ollama / llama.cpp / LM Studio)' });
    const localModelIn = el('input', { value: cfg.local_model || '', dir: 'ltr', placeholder: 'model' });
    const onOn = el('input', { type: 'checkbox', checked: cfg.online_enabled ? '' : null, style: 'width:auto' });
    const offOn = el('input', { type: 'checkbox', checked: cfg.offline_enabled ? '' : null, style: 'width:auto' });
    const privBoxes = {};
    const privRow = el('div', { class: 'flex wrap', style: 'gap:14px; margin:8px 0' });
    for (const [pk, pl] of [['online_allowed', 'AI آنلاین مجاز'], ['offline_allowed', 'AI محلی مجاز'], ['customer', 'داده مشتری'], ['contact', 'داده مخاطب'], ['financial', 'داده مالی'], ['sales', 'داده فروش'], ['notes', 'یادداشت‌ها'], ['files', 'فایل‌ها'], ['masking', 'ماسک داده‌های حساس']]) {
      const cb = el('input', { type: 'checkbox', checked: priv[pk] !== false ? '' : (pk === 'files' ? null : ''), style: 'width:auto' });
      cb.checked = (pk === 'files') ? !!priv.files : (priv[pk] !== false);
      privBoxes[pk] = cb;
      privRow.append(el('label', { class: 'small', style: 'display:flex; gap:6px; align-items:center' }, cb, pl));
    }
    const aiTestBadge = el('span', { class: 'badge muted' }, 'تست نشده');
    const aiTestBtn = el('button', { class: 'btn sm', onclick: async () => {
      aiTestBtn.disabled = true; aiTestBadge.className = 'badge orange'; aiTestBadge.textContent = 'تست واقعی…';
      try {
        const r = await api.post('/api/ai2/test');
        const parts = [];
        if (r.online) { if (r.online.ok) parts.push('آنلاین: ✅ ' + (r.online.model || '')); else parts.push('آنلاین: ❌ ' + (r.online.error || '')); }
        if (r.local) { if (r.local.ok) parts.push('محلی: ✅ ' + (r.local.model || '')); else parts.push('محلی: ❌ ' + (r.local.error || '')); }
        if (!parts.length) parts.push('هوش محلی: ✅ همیشه فعال');
        aiTestBadge.className = (r.online && r.online.ok) || (r.local && r.local.ok) ? 'badge green' : 'badge red';
        aiTestBadge.textContent = parts.join(' · ');
      } catch (e) { aiTestBadge.className = 'badge red'; aiTestBadge.textContent = 'خطا: ' + e.message; }
      aiTestBtn.disabled = false;
    } }, '⚡ تست واقعی AI');
    ab.append(
      el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'حالت AI (AI Mode)'), modeSel),
        el('div', { class: 'field' }, el('label', {}, 'Online Provider'), providerSel),
        el('div', { class: 'field' }, el('label', {}, 'Online Model'), modelIn),
        el('div', { class: 'field' }, el('label', {}, 'Online API Key'), keyIn),
        el('div', { class: 'field' }, el('label', { style: 'display:flex; gap:8px; align-items:center' }, onOn, 'فعال‌سازی AI آنلاین'), el('label', { style: 'display:flex; gap:8px; align-items:center' }, offOn, 'فعال‌سازی LLM محلی (آفلاین)')),
        el('div', { class: 'field' }, el('label', {}, 'Local LLM Endpoint (Ollama/llama.cpp)'), localIn),
        el('div', { class: 'field' }, el('label', {}, 'Local Model'), localModelIn)),
      el('div', { style: 'margin-top:10px' }, el('b', { class: 'small' }, 'AI Privacy (داده‌ای که به موتور AI داده شود):'), privRow),
      el('div', { class: 'flex between', style: 'margin-top:10px; align-items:center' },
        el('span', { class: 'muted small' }, 'زنجیره: آنلاین ← LLM محلی ← هوش محلی (آفلاین ≠ غیرفعال). کلیدها رمزنگاری‌شده و هرگز به فرانت نمی‌روند.'),
        el('div', { class: 'flex', style: 'gap:8px; align-items:center' }, aiTestBadge, aiTestBtn, el('button', { class: 'btn primary sm', onclick: async () => {
          try {
            const body = { ai_mode: modeSel.value, online_provider: providerSel.value, online_model: modelIn.value, online_enabled: onOn.checked, local_enabled: offOn.checked, local_endpoint: localIn.value, local_model: localModelIn.value, ai_privacy: {} };
            for (const pk of Object.keys(privBoxes)) body.ai_privacy[pk] = privBoxes[pk].checked;
            if (keyIn.value && !keyIn.value.startsWith('•')) body.online_api_key = keyIn.value;
            await api.put('/api/ai2/settings', body);
            toast('تنظیمات AI ذخیره شد', 'ok');
          } catch (e) { toast(e.message, 'err'); }
        } }, 'ذخیره AI'))));
  }).catch(() => ab.append(el('div', { class: 'alert danger' }, 'خطا در بارگذاری تنظیمات AI')));
  // demo data removal
  const demoCard = el('div', { class: 'card' }, el('div', { class: 'card-b flex between' },
    el('div', {}, el('b', {}, 'حذف داده‌های نمونه'), el('div', { class: 'muted small' }, 'همه رکوردهای دمو (مشتریان، فاکتورها، …) حذف می‌شوند. این عمل برگشت‌پذیر نیست.')),
    el('button', { class: 'btn danger', onclick: async () => {
      if (!(await confirmDialog('حذف داده‌های نمونه', 'همه داده‌های نمونه حذف شود؟', 'حذف', true))) return;
      try { await api.post('/api/admin/demo-data/delete', {}); toast('داده‌های نمونه حذف شد', 'ok'); setTimeout(() => location.reload(), 800); } catch (e) { toast(e.message, 'err'); }
    } }, 'حذف داده‌های نمونه')));
  c.append(demoCard);
}
// ============ Workflows ============
export async function workflowsPage(c) {
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'Workflow ها'), el('div', { class: 'sub' }, 'قوانین رویداد → اقدام (اعلان، پیگیری، وظیفه، ارتقا)'))),
    el('div', { class: 'actions' }, helpBtn('admin'), el('button', { class: 'btn gold', onclick: () => ruleModal() }, '＋ قانون جدید')));

  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:180px' }));
  c.append(card);
  let rules = [];
  try { rules = (await api.get('/api/r/workflow_rule?per_page=100')).items; } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); return; }
  render();
  function render() {
    clear(card);
    if (!rules.length) return card.append(el('div', {}, emptyState('قانونی تعریف نشده است')));
    for (const r of rules) {
      let acts = [];
      try { acts = JSON.parse(r.actions || '[]'); } catch {}
      const row = el('div', { class: 'flex between', style: 'padding:11px 16px; border-top:1px solid var(--border)' });
      const left = el('div');
      left.append(el('b', { class: 'small' }, r.name));
      left.append(el('div', { class: 'muted small' }, 'رویداد: ' + r.event + ' — اقدامات: ' + acts.map(a => a.type).join('، ')));
      row.append(left);
      const right = el('div', { class: 'flex' });
      right.append(el('span', { class: 'badge ' + (r.active ? 'green' : 'muted') }, r.active ? 'فعال' : 'غیرفعال'));
      right.append(iconBtn('power', r.active ? 'غیرفعال‌کردن قانون' : 'فعال‌کردن قانون', async () => {
        try { await api.put('/api/r/workflow_rule/' + r.id, { active: r.active ? 0 : 1 }); r.active = r.active ? 0 : 1; render(); toast(r.active ? 'قانون فعال شد' : 'قانون غیرفعال شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
      }));
      right.append(iconBtn('edit', 'ویرایش قانون', () => ruleModal(r)));
      const delBtn = iconBtn('trash', 'حذف', async () => {
        if (await confirmDialog('حذف قانون', 'قانون حذف شود؟', 'حذف', true)) {
          try { await api.del('/api/r/workflow_rule/' + r.id + '?hard=1'); rules = rules.filter(x => x.id !== r.id); render(); } catch (e) { toast(e.message, 'err'); }
        }
      });
      right.append(delBtn);
      row.append(right);
      card.append(row);
    }
  }
  function ruleModal(existing) {
    const name = el('input', { placeholder: 'نام قانون', value: existing ? existing.name : '' });
    const activeChk = el('input', { type: 'checkbox', checked: existing ? !!existing.active : true, style: 'width:auto' });
    const ev = el('select', {});
    for (const [v, l] of [['opportunity_stage_changed', 'تغییر مرحله فرصت فروش (Pipeline)'], ['complaint_created', 'ثبت شکایت'], ['lead_created', 'ثبت سرنخ'], ['opportunity_won', 'موفقیت فرصت فروش'], ['invoice_overdue', 'سررسیدگذشتن فاکتور'], ['stock_low', 'کمبود موجودی'], ['customer_created', 'ثبت مشتری'], ['order_created', 'ثبت سفارش'], ['quote_created', 'صدور پیش‌فاکتور']]) ev.append(el('option', { value: v }, l));
    if (existing) ev.value = existing.event;
    let stageSel = null;
    const condBox = el('div');
    const syncCond = () => {
      condBox.innerHTML = '';
      stageSel = null;
      if (ev.value === 'opportunity_stage_changed') {
        stageSel = el('select', {});
        stageSel.append(el('option', { value: '' }, 'هر مرحله (بدون شرط)'));
        api.get('/api/r/pipeline_stages?per_page=100').then(({ items }) => {
          for (const st of items) {
            const o = el('option', { value: st.id }, st.name);
            if (existing) { try { const c = JSON.parse(existing.conditions || '{}'); if (c.stage_id && c.stage_id.__eq === st.id) o.selected = true; } catch {} }
            stageSel.append(o);
          }
        }).catch(() => {});
        condBox.append(el('div', { class: 'field' }, el('label', {}, 'شرط: مرحله‌ای که فرصت وارد آن می‌شود'), stageSel));
      }
    };
    ev.addEventListener('change', syncCond);
    syncCond();
    const actsBox = el('div', { class: 'flex wrap', style: 'gap:8px' });
    const actDefs = [
      ['notify_roles:quality_manager', 'اعلان به مدیر کیفیت'],
      ['notify_roles:ceo', 'اعلان به مدیرعامل'],
      ['notify_roles:finance_manager', 'اعلان به مدیر مالی'],
      ['notify_roles:warehouse_manager', 'اعلان به مدیر انبار'],
      ['notify_roles:sales_manager', 'اعلان به مدیر فروش'],
      ['create_followup', 'ایجاد پیگیری'],
      ['create_task', 'ایجاد وظیفه (Task)'],
    ];
    const taskRoleSel = el('select', { style: 'display:none' }, el('option', { value: '' }, 'مسئول: خود سازنده'), el('option', { value: 'sales_manager' }, 'مسئول: مدیر فروش'), el('option', { value: 'sales' }, 'مسئول: کارشناس فروش'), el('option', { value: 'rep' }, 'مسئول: نمایندگی'));
    const taskDays = el('input', { type: 'number', placeholder: '۳', style: 'display:none; width:90px' });
    const taskPrio = el('select', { style: 'display:none' }, el('option', { value: 'medium' }, 'اولویت: متوسط'), el('option', { value: 'high' }, 'اولویت: بالا'), el('option', { value: 'low' }, 'اولویت: پایین'));
    const fuDays = el('input', { type: 'number', placeholder: '۱', style: 'display:none; width:90px' });
    let existingActions = [];
    if (existing) { try { existingActions = JSON.parse(existing.actions || '[]'); } catch {} }
    for (const [v, l] of actDefs) {
      const cb = el('input', { type: 'checkbox', value: v, style: 'width:auto; margin-inline-end:5px' });
      cb.checked = existingActions.some(a => a.type === v.split(':')[0]);
      cb.addEventListener('change', () => {
        const show = cb.checked ? '' : 'none';
        if (v.startsWith('create_task')) { taskRoleSel.style.display = show; taskDays.style.display = show; taskPrio.style.display = show; }
        if (v === 'create_followup') fuDays.style.display = show;
      });
      actsBox.append(el('label', { class: 'badge', style: 'cursor:pointer; display:inline-flex; gap:5px' }, cb, l));
    }
    for (const a of existingActions) {
      if (a.type === 'create_task') { taskRoleSel.style.display = ''; taskDays.style.display = ''; taskPrio.style.display = ''; if (a.role) taskRoleSel.value = a.role; if (a.due_days) taskDays.value = a.due_days; if (a.priority) taskPrio.value = a.priority; }
      if (a.type === 'create_followup' && a.due_days) { fuDays.style.display = ''; fuDays.value = a.due_days; }
    }
    const ov = openModal(existing ? 'ویرایش قانون Workflow' : 'قانون Workflow جدید', el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'نام'), name),
      el('div', { class: 'field' }, el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, activeChk, 'قانون فعال است (در غیر این صورت اجرا نمی‌شود)')),
      el('div', { class: 'field' }, el('label', {}, 'رویداد (Trigger)'), ev),
      condBox,
      el('div', { class: 'field' }, el('label', {}, 'اقدام‌ها (Action)'), actsBox,
        el('div', { class: 'flex', style: 'gap:6px; margin-top:6px; flex-wrap:wrap' },
          el('span', { class: 'muted small' }, 'نقش مسئول Task:'), taskRoleSel,
          el('span', { class: 'muted small' }, 'سررسید Task (روز):'), taskDays, taskPrio),
        el('div', { class: 'flex', style: 'gap:6px; margin-top:6px' },
          el('span', { class: 'muted small' }, 'سررسید پیگیری (روز):'), fuDays))), {
      footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          const actions = [...actsBox.querySelectorAll('input:checked')].map(x => {
            const [type, extra] = x.value.split(':');
            const a = { type };
            if (extra) { if (type === 'notify_roles') a.roles = [extra]; }
            if (type === 'create_followup') {
              const et = { complaint_created: 'complaint', lead_created: 'lead', opportunity_stage_changed: 'opportunity', opportunity_won: 'opportunity', order_created: 'order', quote_created: 'quote', customer_created: 'customer', invoice_overdue: 'invoice', stock_low: 'stock_alert' }[ev.value] || 'other';
              a.entity_type = et;
              a.subject = 'پیگیری خودکار: ' + name.value;
              if (fuDays.value) a.due_days = Number(fuDays.value);
            }
            if (type === 'create_task') {
              a.title = 'وظیفه خودکار: ' + name.value;
              if (taskRoleSel.value) a.role = taskRoleSel.value;
              if (taskDays.value) a.due_days = Number(taskDays.value);
              a.priority = taskPrio.value;
            }
            return a;
          });
          const conditions = (ev.value === 'opportunity_stage_changed' && stageSel && stageSel.value) ? { stage_id: { __eq: Number(stageSel.value) } } : {};
          const body = { name: name.value, event: ev.value, conditions: JSON.stringify(conditions), actions: JSON.stringify(actions), active: activeChk.checked ? 1 : 0 };
          try {
            if (existing) await api.put('/api/r/workflow_rule/' + existing.id, body);
            else await api.post('/api/r/workflow_rule', body);
            toast('قانون ذخیره شد و بلافاصله فعال است', 'ok'); ov.close(); location.reload();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save'))
      ]
    });
  }
}
// ============ Backup ============
export async function backupPage(c) {
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'پشتیبان‌گیری و بازیابی (Backup Manager)'), el('div', { class: 'sub' }, 'بکاپ واقعی SQLite — زمان‌بندی/محل/رمزنگاری قابل تنظیم + تاریخچه و بازیابی'))));

  // ---- settings + summary ----
  const top = el('div', { class: 'grid g-2 mb-16' });
  c.append(top);
  const setCard = el('div', { class: 'card' });
  top.append(setCard);
  const sumCard = el('div', { class: 'card' });
  top.append(sumCard);

  let data = null;
  try { data = await api.get('/api/admin/backups'); } catch (e) { clear(setCard).append(el('div', { class: 'alert danger' }, e.message)); return; }
  const items = data.items || [];

  // summary
  sumCard.append(el('div', { class: 'card-h' }, el('h3', {}, 'وضعیت بکاپ'),
    el('div', { class: 'actions' }, el('button', { class: 'btn gold sm', onclick: doBackup }, '⬇ پشتیبان‌گیری فوری'))));
  const sum = el('div', { class: 'card-b' });
  const kv = (l, v, cls) => { sum.append(el('div', { class: 'flex between small', style: 'padding:7px 0; border-top:1px solid var(--border)' }, el('span', { class: 'muted' }, l), el('span', { class: cls || '' }, v))); };
  kv('آخرین بکاپ موفق', data.last_success ? fmtDate(data.last_success.created_at, { time: true }) + ' — ' + faDigits(Math.round(data.last_success.size / 1024)) + ' KB' : '—', data.last_success ? 'green' : '');
  kv('آخرین بکاپ ناموفق', data.last_failed ? fmtDate(data.last_failed.created_at, { time: true }) + (data.last_failed.error ? ' — ' + data.last_failed.error : '') : '—', data.last_failed ? 'red' : '');
  kv('محل بکاپ', data.dir || '—');
  kv('رمزنگاری (AES-256-GCM)', data.encrypted ? 'فعال (BACKUP_KEY تنظیم است)' : 'غیرفعال (برای فعال‌سازی BACKUP_KEY را در محیط سرور تنظیم کنید)', data.encrypted ? 'green' : '');
  sumCard.append(sum);

  // settings form
  setCard.append(el('div', { class: 'card-h' }, el('h3', {}, 'زمان‌بندی و محل بکاپ')));
  const sBody = el('div', { class: 'card-b' });
  const sched = { freq: 'daily', hour: 2, day: 1, day_of_month: 1 };
  try { const st = (await api.get('/api/admin/settings')).settings || {}; if (st.backup_schedule) Object.assign(sched, st.backup_schedule); } catch {}
  const freqSel = el('select', {}, el('option', { value: 'daily' }, 'روزانه'), el('option', { value: 'weekly' }, 'هفتگی'), el('option', { value: 'monthly' }, 'ماهانه'));
  freqSel.value = sched.freq;
  const hourSel = el('select', {});
  for (let h = 0; h < 24; h++) hourSel.append(el('option', { value: h }, String(h).padStart(2, '0') + ':00'));
  hourSel.value = String(sched.hour);
  const daySel = el('select', {});
  ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'].forEach((w, i) => daySel.append(el('option', { value: i + 1 }, w)));
  daySel.value = String(sched.day || 1);
  const domSel = el('select', {});
  for (let d2 = 1; d2 <= 28; d2++) domSel.append(el('option', { value: d2 }, faDigits(d2) + 'م'));
  domSel.value = String(sched.day_of_month || 1);
  const retIn = el('input', { type: 'number', value: sched.retention_days || 30, style: 'width:90px' });
  let retVal = 30;
  try { const st = (await api.get('/api/admin/settings')).settings || {}; retVal = Number(st.backup_retention_days) || 30; retIn.value = retVal; } catch {}
  const dirIn = el('input', { placeholder: 'مسیر سفارشی (مطلق) — خالی = پیش‌فرض داخل دایرکتوری داده', dir: 'ltr', value: '' });
  try { const st = (await api.get('/api/admin/settings')).settings || {}; dirIn.value = st.backup_dir || ''; } catch {}
  const dayField = el('div', { class: 'field', style: 'display:none' }, el('label', {}, 'روز هفته'), daySel);
  const domField = el('div', { class: 'field', style: 'display:none' }, el('label', {}, 'روز ماه'), domSel);
  freqSel.addEventListener('change', () => { dayField.style.display = freqSel.value === 'weekly' ? '' : 'none'; domField.style.display = freqSel.value === 'monthly' ? '' : 'none'; });
  freqSel.dispatchEvent(new Event('change'));
  sBody.append(
    el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', {}, 'بازهٔ زمان‌بندی'), freqSel),
      el('div', { class: 'field' }, el('label', {}, 'ساعت اجرا (تهران)'), hourSel),
      dayField, domField,
      el('div', { class: 'field' }, el('label', {}, 'نگهداری (روز)'), retIn),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'محل بکاپ (Local/Network/سفارشی — باید از طریق این سرور دسترس‌پذیر باشد)'), dirIn)),
    el('div', { class: 'flex', style: 'gap:8px; margin-top:10px' },
      el('button', { class: 'btn primary sm', onclick: async () => {
        try {
          const r = await api.post('/api/admin/backup-settings', { schedule: { freq: freqSel.value, hour: Number(hourSel.value), day: Number(daySel.value), day_of_month: Number(domSel.value) }, retention_days: Number(retIn.value) || 30, backup_dir: dirIn.value.trim() });
          toast('تنظیمات بکاپ ذخیره شد — زمان‌بندی: ' + (r.schedule.freq === 'daily' ? 'روزانه' : r.schedule.freq === 'weekly' ? 'هفتگی' : 'ماهانه') + ' ساعت ' + r.schedule.hour + ':00', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      } }, 'ذخیره تنظیمات'),
      el('span', { class: 'muted small', style: 'align-self:center' }, 'بکاپ واقعی است (کپی سازگار SQLite + checkpoint WAL) — تاریخچه و بازیابی در جدول زیر.')));
  setCard.append(sBody);

  // ---- history ----
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:180px' }));
  c.append(card);
  render();
  function render() {
    clear(card);
    if (!items.length) return card.append(el('div', {}, emptyState('بکاپی موجود نیست')));
    const head = el('tr', {}, el('th', {}, 'فایل'), el('th', {}, 'حجم'), el('th', {}, 'نوع'), el('th', {}, 'وضعیت'), el('th', {}, 'تاریخ'), el('th', {}, ''));
    const rows = items.map(b => el('tr', {},
      el('td', { class: 'num small' }, b.file_name),
      el('td', {}, b.size ? faDigits(Math.round(b.size / 1024)) + ' KB' : '—'),
      el('td', {}, b.kind === 'auto' ? 'خودکار' : 'دستی'),
      el('td', {}, el('span', { class: 'badge ' + (b.status === 'success' ? 'green' : 'red') }, b.status === 'success' ? 'موفق' : 'ناموفق') + (b.status === 'failed' && b.error ? el('div', { class: 'muted small' }, b.error) : null)),
      el('td', {}, fmtDate(b.created_at, { time: true })),
      el('td', { class: 'row-act' },
        b.status === 'success' ? el('a', { class: 'btn sm', href: '/api/admin/backups/' + b.id + '/download' }, 'دانلود') : null,
        b.status === 'success' ? iconBtn('arch', 'بازیابی / Recovery', async () => {
          // item 10: two-step confirmation for a sensitive operation
          const ok1 = await confirmDialog('⚠️ هشدار بازیابی بکاپ', 'بازیابی این بکاپ می‌تواند اطلاعات فعلی را تغییر یا جایگزین کند. یک «بکاپ قبل از بازیابی» به‌صورت خودکار و امن گرفته می‌شود تا در صورت بروز مشکل امکان برگشت وجود داشته باشد. سپس سازگاری ساختار/نسخهٔ بکاپ بررسی می‌شود و در صورت نامعتبر بودن، Restore انجام نمی‌شود.', 'ادامه…', true);
          if (!ok1) return;
          const ok2 = await confirmDialog('تأیید نهایی Recovery', 'آیا واقعاً مطمئن هستید؟ پایگاه داده با بکاپ «' + (b.file_name || '') + '» جایگزین می‌شود و پس از انجام باید دوباره وارد شوید. این عملیات فقط برای نقش‌های دارای مجوز «Backup Restore» قابل اجراست.', 'ادامه Recovery', true);
          if (!ok2) return;
          try {
            const r = await api.post('/api/admin/backups/' + b.id + '/restore', {});
            toast('بازیابی شد' + (r && r.recovery_id ? ' — Recovery ' + r.recovery_id : '') + (r && r.pre_recovery_backup ? ' (بکاپ قبل از بازیابی: ' + r.pre_recovery_backup + ')' : '') + ' — لطفاً دوباره وارد شوید', 'ok');
            setTimeout(() => location.reload(), 1500);
          } catch (e) { toast(e.message, 'err'); }
        }) : null)));
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  }
  async function doBackup() {
    try { const r = await api.post('/api/admin/backups', {}); toast('بکاپ گرفته شد: ' + r.file_name + (r.encrypted ? ' (رمزنگاری‌شده)' : ''), 'ok'); const d2 = await api.get('/api/admin/backups'); items.length = 0; items.push(...d2.items); location.reload(); } catch (e) { toast(e.message, 'err'); }
  }
}
// ============ Audit ============
export async function auditPage(c) {
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'گزارش ممیزی (Audit Log)'), el('div', { class: 'sub' }, 'چه کسی چه چیزی را چه زمانی تغییر داده است — غیرقابل حذف توسط کاربران عادی'))));
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:220px' }));
  c.append(card);
  try {
    const { items } = await api.get('/api/admin/audit?per_page=200');
    clear(card);
    if (!items.length) return card.append(el('div', {}, emptyState('رکوردی ثبت نشده است')));
    const head = el('tr', {}, el('th', {}, 'کاربر'), el('th', {}, 'Entity'), el('th', {}, 'عملیات'), el('th', {}, 'تاریخ'));
    const rows = items.slice(0, 200).map(a => el('tr', {},
      el('td', {}, a.username),
      el('td', { class: 'small' }, a.entity + (a.entity_id ? ' #' + a.entity_id : '')),
      el('td', { class: 'small' }, a.action),
      el('td', {}, fmtDate(a.at, { time: true }))));
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
}

// ============ Approval Chains (تأییدها و امضا) ============
// Admin manages the signature-based approval workflow per document type:
// stages (label + required role), order, active toggle. Enforced server-side;
// the UI is the control surface.
export async function approvalChainsPage(c) {
  c.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'فرآیند تأیید و امضا'), el('div', { class: 'sub' }, 'زنجیرهٔ تأیید مرحله‌به‌مرحله با امضای الکترونیکی — هر مرحله نقش مشخصی دارد و بدون تأیید مرحلهٔ قبل، مرحلهٔ بعد قابل امضا نیست.')),
    el('div', { class: 'actions' }, helpBtn('approvals'), el('button', { class: 'btn gold', onclick: () => chainModal() }, '＋ فرآیند تأیید جدید'))));
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:220px' }));
  c.append(card);
  let chains = [];
  async function load() {
    try {
      ({ items: chains } = await api.get('/api/approval-chains'));
      render();
    } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
  }
  const DOC_FA = { quote: 'پیش‌فاکتور', order: 'سفارش', invoice: 'فاکتور', contract: 'قرارداد', purchase_order: 'سفارش خرید', complaint: 'شکایت' };
  function render() {
    clear(card);
    if (!chains.length) { card.append(el('div', {}, emptyState('فرآیند تأییدی تعریف نشده است'))); return; }
    const body = el('tbody');
    for (const ch of chains) {
      const acts = el('div', { class: 'row-act', style: 'display:flex; gap:4px' });
      acts.append(iconBtn('edit', 'ویرایش مراحل', () => chainModal(ch)));
      acts.append(iconBtn('power', ch.active ? 'غیرفعال‌کردن' : 'فعال‌کردن', async () => {
        try { await api.put('/api/approval-chains/' + ch.doc_type, { name: ch.name, active: !ch.active, stages: ch.stages.map(s => ({ label: s.label, role: s.role })) }); toast('به‌روزرسانی شد', 'ok'); load(); }
        catch (e) { toast(e.message, 'err'); }
      }));
      body.append(el('tr', {},
        el('td', {}, el('b', {}, DOC_FA[ch.doc_type] || ch.doc_type), el('div', { class: 'muted small' }, ch.name)),
        el('td', {}, ch.stages.map((s, i) => el('span', { class: 'chip', style: 'margin-inline-end:6px' }, (i + 1) + '. ' + s.label + ' (' + s.role + ')')).join(' ')),
        el('td', {}, el('span', { class: 'badge ' + (ch.active ? 'green' : 'red') }, ch.active ? 'فعال' : 'غیرفعال')),
        el('td', { class: 'row-act' }, acts)));
    }
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'سند'), el('th', {}, 'مراحل (به ترتیب)'), el('th', {}, 'وضعیت'), el('th', {}, ''))), body)));
  }
  async function chainModal(ch) {
    let roleList = [];
    try { roleList = (await api.get('/api/admin/roles')).roles.filter(r => r.name !== 'super_admin'); } catch { /* role list optional for UI */ }
    const name = el('input', { value: ch ? ch.name : '', placeholder: 'مثلاً: تأیید پیش‌فاکتور' });
    const docSel = el('select', {});
    for (const [k, l] of Object.entries(DOC_FA)) docSel.append(el('option', { value: k, selected: ch && ch.doc_type === k ? '' : null }, l));
    const active = el('input', { type: 'checkbox', checked: !ch || !!ch.active, style: 'width:auto' });
    const stagesBox = el('div', { style: 'display:flex; flex-direction:column; gap:8px' });
    const renumber = () => { [...stagesBox.children].forEach((r, i) => { r.children[0].textContent = (i + 1) + '.'; }); };
    function addStageRow(stage) {
      const label = el('input', { value: stage ? stage.label : '', placeholder: 'عنوان مرحله (مثلاً تأیید مدیر فروش)' });
      const roleSel = el('select', {});
      roleSel.append(el('option', { value: '' }, '— نقش —'));
      for (const r of roleList) roleSel.append(el('option', { value: r.name, selected: stage && stage.role === r.name ? '' : null }, r.name_fa || r.name));
      const row = el('div', { class: 'flex', style: 'gap:8px; align-items:center; flex-wrap:wrap' },
        el('span', { class: 'muted small', style: 'width:22px; text-align:center' }, '·'), label, roleSel,
        el('button', { class: 'btn sm', title: 'بالا', onclick: () => moveRow(row, -1) }, '↑'),
        el('button', { class: 'btn sm', title: 'پایین', onclick: () => moveRow(row, 1) }, '↓'),
        el('button', { class: 'btn sm danger', title: 'حذف مرحله', onclick: () => { row.remove(); renumber(); } }, '✕'));
      stagesBox.append(row);
      renumber();
    }
    function moveRow(row, dir) {
      const rows = [...stagesBox.children];
      const i = rows.indexOf(row), j = i + dir;
      if (j < 0 || j >= rows.length) return;
      if (dir < 0) stagesBox.insertBefore(row, rows[j]); else stagesBox.insertBefore(rows[j], row);
      renumber();
    }
    if (ch) ch.stages.forEach(s => addStageRow(s)); else addStageRow(null);
    const addBtn = el('button', { class: 'btn sm', onclick: () => addStageRow(null) }, '＋ افزودن مرحله');
    const ov = openModal(ch ? 'ویرایش فرآیند تأیید' : 'فرآیند تأیید جدید', el('div', {},
      el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'نام فرآیند'), name),
        el('div', { class: 'field' }, el('label', {}, 'نوع سند'), ch ? el('input', { value: DOC_FA[ch.doc_type] || ch.doc_type, readonly: '' }) : docSel),
        el('div', { class: 'field' }, el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, active, 'فعال'))),
      el('h4', { class: 'mt-8' }, 'مراحل (به ترتیب)'),
      el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'هر مرحله یک نقش الزامی دارد. کاربری که آن نقش را داشته باشد (و مجوز امضا را داشته باشد) می‌تواند آن مرحله را امضا کند. بدون تأیید مرحلهٔ قبل، مرحلهٔ بعد قفل است.'),
      stagesBox, addBtn), {
      large: true,
      footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          const stages = [...stagesBox.children].map(r => ({ label: r.children[1].value.trim(), role: r.children[2].value })).filter(s => s.label && s.role);
          if (!stages.length) return toast('حداقل یک مرحله با عنوان و نقش لازم است', 'err');
          try {
            await api.put('/api/approval-chains/' + (ch ? ch.doc_type : docSel.value), { name: name.value.trim(), active: active.checked, stages });
            toast('فرآیند تأیید ذخیره شد', 'ok'); ov.close(); load();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ],
    });
  }
  load();
}
