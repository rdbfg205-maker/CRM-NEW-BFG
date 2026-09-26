'use strict';
import { api, t, fmtDate, fmtMoney, fmtNum, faDigits, statusFa, jalaliLib } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState, exportMenu } from '../ui.js';
import { ResourceView, iconBtn } from '../resource-view.js';
import { helpBtn } from './help.js';

export function simple(res, title, c) {
  const v = new ResourceView({ res, title, quickAction: null });
  c.append(v.root);
}
export function productView(c) {
  const v = new ResourceView({ res: 'product', title: 'محصولات و مواد اولیه', quickAction: 'کالا جدید' });
  c.append(v.root);
}
const CURRENCY_FA = { IRR: 'ریال', IRT: 'تومان', USD: 'دولار' };
export function priceListView(c) {
  let lists = [];
  const searchIn = el('input', { class: 'input', placeholder: 'جستجو (نام لیست)…', style: 'width:280px' });
  c.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'لیست قیمت‌ها'), el('div', { class: 'sub' }, 'تعریف چند لیست قیمت (خرده/عمده/صادرات) با قیمت اختصاصی هر کالا')),
    el('div', { class: 'actions' }, helpBtn('pricelists'), exportMenu(fmt => '/api/pricelist/export?format=' + fmt + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی لیست قیمت‌ها'),  el('button', { class: 'btn gold', onclick: () => listForm(null) }, '＋ لیست جدید'))));
  let timer = null;
  searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), 300); });
  c.append(el('div', { class: 'mb-16' }, searchIn));
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:180px' }));
  c.append(card);
  load();
  async function load() {
    try {
      const u = new URLSearchParams({ per_page: '50' });
      if (searchIn.value.trim()) u.set('q', searchIn.value.trim());
      const r = await api.get('/api/r/price_list?' + u.toString());
      lists = r.items;
      clear(card);
      if (!lists.length) return card.append(el('div', {}, emptyState('لیست قیمتی تعریف نشده است')));
      const head = el('tr', {}, el('th', {}, 'نام'), el('th', {}, 'ارز'), el('th', {}, 'تاریخ اعتبار'), el('th', {}, 'وضعیت'), el('th', {}, 'عملیات'));
      const body = el('tbody');
      for (const pl of lists) {
        const valid = (pl.valid_from || pl.valid_until) ? (pl.valid_from ? fmtDate(pl.valid_from) : 'شروع: —') + ' تا ' + (pl.valid_until ? fmtDate(pl.valid_until) : 'ادامه') : '—';
        const acts = el('div', { class: 'row-act', style: 'display:flex; gap:4px' });
        acts.append(iconBtn('tag', 'مدیریت قیمت‌ها', () => itemsForm(pl)));
        acts.append(iconBtn('edit', 'ویرایش', () => listForm(pl)));
        acts.append(iconBtn('copy', 'کپی لیست', async () => {
          if (await confirmDialog('کپی لیست', 'یک کپی از این لیست همراه با قیمت‌ها ساخته شود؟', 'کپی')) {
            try { await api.post('/api/pricelist/' + pl.id + '/duplicate', {}); toast('کپی شد', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          }
        }));
        acts.append(iconBtn('star', pl.is_default ? 'لغو پیش‌فرض' : 'پیش‌فرض', async () => {
          try { await api.put('/api/r/price_list/' + pl.id, { is_default: pl.is_default ? 0 : 1 }); load(); } catch (e) { toast(e.message, 'err'); }
        }));
        acts.append(iconBtn('trash', 'حذف', async () => {
          if (await confirmDialog('حذف لیست قیمت', '«' + pl.name + '» همراه با قیمت‌های آن حذف شود؟', 'حذف', true)) {
            try { await api.del('/api/r/price_list/' + pl.id + '?hard=1'); toast('حذف شد', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          }
        }));
        body.append(el('tr', {},
          el('td', {}, el('b', {}, pl.name), pl.is_default ? el('span', { class: 'badge gold', style: 'margin-inline-start:6px' }, 'پیش‌فرض') : null),
          el('td', {}, CURRENCY_FA[pl.currency] || pl.currency),
          el('td', { class: 'small muted' }, valid),
          el('td', {}, el('span', { class: 'badge ' + (pl.active ? 'green' : 'red') }, pl.active ? 'فعال' : 'غیرفعال')),
          el('td', { class: 'row-act' }, acts)));
      }
      card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), body)));
    } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
  }
  function listForm(pl) {
    const isEdit = !!pl;
    const name = el('input', { placeholder: 'نام لیست (مثلاً عمده‌فروشان)', value: pl ? pl.name : '' });
    const cur = el('select', {});
    for (const [v, l] of Object.entries(CURRENCY_FA)) cur.append(el('option', { value: v, selected: (pl && pl.currency === v) ? '' : null }, l));
    const desc = el('textarea', { placeholder: 'توضیحات (اختیاری)', value: pl && pl.description ? pl.description : '' });
    const from = el('input', { type: 'text', placeholder: 'شماره: ۱۴۰/۰/۱', value: pl && pl.valid_from ? jalaliStr2(pl.valid_from) : '' });
    const until = el('input', { type: 'text', placeholder: 'شماره: ۱۴۵/۱۲/۲۹', value: pl && pl.valid_until ? jalaliStr2(pl.valid_until) : '' });
    const active = el('input', { type: 'checkbox', checked: pl && !pl.active ? null : '' });
    const isDef = el('input', { type: 'checkbox', checked: pl && pl.is_default ? '' : null });
    const ov = openModal(isEdit ? 'ویرایش لیست قیمت' : 'لیست قیمت جدید', el('div', { class: 'form-grid' },
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'نام لیست'), name),
      el('div', { class: 'field' }, el('label', {}, 'واحد پول'), cur),
      el('div', { class: 'field' }, el('label', {}, 'فعال'), active),
      el('div', { class: 'field' }, el('label', {}, 'تاریخ شروع (شمسی، اختیاری)'), from),
      el('div', { class: 'field' }, el('label', {}, 'تاریخ پایان (شمسی، اختیاری)'), until),
      el('div', { class: 'field' }, el('label', {}, 'لیست پیش‌فرض'), isDef),
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'توضیحات'), desc)), {
      footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!name.value.trim()) return toast('نام الزامی است', 'err');
          const parseJ = (v) => { if (!v.trim()) return null; const m = v.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (!m) return null; const g = jalaliLib().toGregorian(+m[1], +m[2], +m[3]); return new Date(g.gy, g.gm - 1, g.gd, 12).toISOString(); };
          const vf = parseJ(from.value), vu = parseJ(until.value);
          if (from.value.trim() && !vf) return toast('تاریخ شروع نامعتبر است', 'err');
          if (until.value.trim() && !vu) return toast('تاریخ پایان نامعتبر است', 'err');
          const body = { name: name.value.trim(), currency: cur.value, active: active.checked ? 1 : 0, is_default: isDef.checked ? 1 : 0, description: desc.value.trim() || null, valid_from: vf, valid_until: vu };
          try {
            if (isEdit) await api.put('/api/r/price_list/' + pl.id, body);
            else await api.post('/api/r/price_list', body);
            toast('ذخیره شد', 'ok'); ov.close(); load();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save'))
      ]
    }
  );
  }
  function jalaliStr2(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const j = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0');
  }
  async function itemsForm(pl) {
    const box = el('div', { class: 'skel', style: 'height:140px' });
    const ov = openModal('قیمت‌ها — ' + pl.name, el('div', {}, box), { large: true });
    const saved = [];
    try {
      const [pr, cr] = await Promise.all([
        api.get('/api/r/product?per_page=300'),
        api.get('/api/pricelist/' + pl.id + '/items').catch(() => ({ items: [] })),
        api.get('/api/r/customer?per_page=300').catch(() => ({ items: [] })),
      ]);
      const prods = pr.items.filter(p => !p.is_raw_material);
      const customers = cr.items;
      for (const ci of cr.items) saved.push(ci);
      const searchIn = el('input', { placeholder: 'جستجوی کالا (نام یا کد)…' });
      const listBox = el('div', { style: 'max-height:420px; overflow:auto' });
      function renderList() {
        clear(listBox);
        const q = searchIn.value.trim();
        const rows = prods.filter(p => !q || p.name.includes(q) || (p.code || '').includes(q));
        if (!rows.length) { listBox.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'کالایی پیدا نشد.')); return; }
        for (const p of rows) {
          const gen = saved.find(x => !x.customer_id && x.product_id === p.id);
          const custItems = saved.filter(x => x.customer_id && x.product_id === p.id);
          const row = el('div', { style: 'padding:8px 4px; border-top:1px solid var(--border)' });
          row.append(el('div', { class: 'flex between', style: 'align-items:center' },
            el('div', {}, el('b', { class: 'small' }, p.name), el('div', { class: 'muted small' }, (p.code || '') + (p.unit ? ' • ' + p.unit : ''))),
            el('div', { class: 'flex', style: 'gap:6px; align-items:center' },
              el('span', { class: 'muted small' }, 'قیمت عمومی:'),
              priceInput(p.id, null, gen),
              gen ? el('span', { class: 'badge green small' }, 'ثبت‌شده') : null)));
          if (custItems.length) {
            row.append(el('div', { style: 'margin-top:6px; padding-inline-start:14px' }));
            for (const ci of custItems) {
              const custName = ci.customer_name || ('مشتری #' + ci.customer_id);
              const cRow = el('div', { class: 'flex between', style: 'align-items:center; margin-top:4px' },
                el('span', { class: 'small' }, '👤 ' + custName + (ci.discount_pct ? ' (تخفیف ' + faDigits(ci.discount_pct) + '٪)' : '') + (ci.tax_rate ? ' + مالیات ' + faDigits(ci.tax_rate) + '٪' : '')),
                el('div', { class: 'flex', style: 'gap:4px' }, priceInput(p.id, ci.customer_id, ci),
                  iconBtn('trash', 'حذف قیمت مشتری', async () => {
                    if (await confirmDialog('حذف قیمت اختصاصی', 'قیمت اختصاصی «' + custName + '» حذف شود؟', 'حذف', true)) {
                      const i2 = saved.indexOf(ci); if (i2 >= 0) saved.splice(i2, 1);
                      renderList();
                    }
                  })));
              row.lastChild.append(cRow);
            }
          }
          row.append(el('div', { style: 'margin-top:6px; padding-inline-start:14px' },
            el('button', { class: 'btn sm ghost', style: 'font-size:11px', onclick: () => custPriceForm(p) }, '＋ قیمت اختصاصی مشتری')));
          listBox.append(row);
        }
      }
      function priceInput(pid, custId, item) {
        const inp = el('input', { type: 'number', dir: 'ltr', placeholder: 'قیمت', value: item ? String(item.price) : '', style: 'width:120px' });
        inp.addEventListener('input', () => {
          const v = Number(inp.value);
          if (v > 0) {
            const i2 = saved.findIndex(x => x.product_id === pid && (x.customer_id || null) === (custId || null));
            if (i2 >= 0) saved[i2].price = v; else saved.push({ product_id: pid, customer_id: custId || null, price: v });
          } else if (inp.value.trim() === '') {
            const i2 = saved.findIndex(x => x.product_id === pid && (x.customer_id || null) === (custId || null));
            if (i2 >= 0) saved.splice(i2, 1);
          }
        });
        return inp;
      }
      function custPriceForm(p) {
        const custSel = el('select', {});
        custSel.append(el('option', { value: '' }, '— انتخاب مشتری —'));
        for (const cu of customers) custSel.append(el('option', { value: cu.id }, cu.name));
        const price = el('input', { type: 'number', dir: 'ltr', placeholder: 'قیمت (ریال)' });
        const disc = el('input', { type: 'number', dir: 'ltr', placeholder: 'تخفیف ٪ (اختیاری)', value: 0 });
        const tax = el('input', { type: 'number', dir: 'ltr', placeholder: 'مالیات ٪ (اختیاری)', value: 0 });
        const minQ = el('input', { type: 'number', dir: 'ltr', placeholder: 'حداقل تعداد (اختیاری)' });
        const maxQ = el('input', { type: 'number', dir: 'ltr', placeholder: 'حداکثر تعداد (اختیاری)' });
        const vf = el('input', { type: 'text', placeholder: 'اعتبار از (شمسی، اختیاری)' });
        const vu = el('input', { type: 'text', placeholder: 'اعتبار تا (شمسی، اختیاری)' });
        const parseJ = (v) => { if (!v.trim()) return null; const m = v.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (!m) return null; const g = jalaliLib().toGregorian(+m[1], +m[2], +m[3]); return new Date(g.gy, g.gm - 1, g.gd, 12).toISOString(); };
        const ov2 = openModal('قیمت اختصاصی — ' + p.name, el('div', { class: 'form-grid' },
          el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'مشتری'), custSel),
          el('div', { class: 'field' }, el('label', {}, 'قیمت (ریال)'), price),
          el('div', { class: 'field' }, el('label', {}, 'تخفیف ٪'), disc),
          el('div', { class: 'field' }, el('label', {}, 'مالیات ٪'), tax),
          el('div', { class: 'field' }, el('label', {}, 'حداقل تعداد'), minQ),
          el('div', { class: 'field' }, el('label', {}, 'حداکثر تعداد'), maxQ),
          el('div', { class: 'field' }, el('label', {}, 'اعتبار از'), vf),
          el('div', { class: 'field' }, el('label', {}, 'اعتبار تا'), vu)), {
          footer: [el('button', { class: 'btn', onclick: () => ov2.close() }, t('cancel')),
            el('button', { class: 'btn primary', onclick: async () => {
              if (!custSel.value) return toast('مشتری را انتخاب کنید', 'err');
              if (!Number(price.value) || Number(price.value) <= 0) return toast('قیمت معتبر وارد کنید', 'err');
              const item = { product_id: p.id, customer_id: Number(custSel.value), price: Number(price.value), discount_pct: Number(disc.value) || 0, tax_rate: Number(tax.value) || 0, min_qty: Number(minQ.value) || 0, max_qty: maxQ.value ? Number(maxQ.value) : null, valid_from: parseJ(vf.value), valid_until: parseJ(vu.value), customer_name: (customers.find(cu => cu.id === Number(custSel.value)) || {}).name || '' };
              if (vf.value.trim() && !item.valid_from) return toast('تاریخ اعتبار از نامعتبر است', 'err');
              if (vu.value.trim() && !item.valid_until) return toast('تاریخ اعتبار تا نامعتبر است', 'err');
              const i2 = saved.findIndex(x => x.product_id === p.id && x.customer_id === item.customer_id);
              if (i2 >= 0) saved[i2] = item; else saved.push(item);
              ov2.close(); renderList();
            } }, t('save'))],
        });
      }
      searchIn.addEventListener('input', renderList);
      renderList();
      clear(box);
      box.append(searchIn, listBox,
        el('div', { class: 'flex between mt-16' },
          el('span', { class: 'muted small' }, 'قیمت خالی = بدون قیمت اختصاصی (قیمت پایهٔ کالا استفاده می‌شود)'),
          el('button', { class: 'btn primary sm', onclick: async () => {
            const items = saved.filter(x => x.price > 0);
            if (!items.length) return toast('حداقل یک قیمت وارد کنید', 'err');
            try {
              const r = await api.post('/api/pricelist/' + pl.id + '/items', { items });
              toast(faDigits(r.saved) + ' قیمت ذخیره شد', 'ok'); ov.close();
            } catch (e) { toast(e.message, 'err'); }
          } }, '💾 ذخیره قیمت‌ها')));
    } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
  }
}
export function campaignsView(c) {
  const v = new ResourceView({ res: 'campaign', title: 'کمپین‌های بازاریابی', quickAction: 'کمپین جدید' });
  c.append(v.root);
}
export async function loyaltyView(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'باشگاه مشتریان'), el('div', { class: 'sub' }, 'سطوح، امتیازها، تخفیف‌ها، قوانین و تراکنش‌های واقعی — اتصال به Customer Master و فروش')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('campaigns')));
  c.append(_ph);
  const tabs = el('div', { class: 'tabs mb-16' });
  const panes = el('div', {});
  c.append(tabs, panes);
  const tabDefs = [
    { id: 'members', label: 'اعضا' },
    { id: 'tx', label: 'تراکنش‌ها' },
    { id: 'tiers', label: 'سطوح' },
    { id: 'rules', label: 'قوانین' },
  ];
  let active = 'members';
  const rendered = {};
  function renderTab(id) {
    active = id;
    for (const b of tabs.children) b.classList.toggle('active', b.dataset.tab === id);
    if (!rendered[id]) {
      rendered[id] = el('div', {});
      panes.append(rendered[id]);
      (id === 'members' ? renderMembers : id === 'tx' ? renderTx : id === 'tiers' ? renderTiers : renderRules)(rendered[id]);
    }
    for (const p of panes.children) p.style.display = p === rendered[id] ? '' : 'none';
  }
  tabDefs.forEach(td => {
    const b = el('button', { class: 'btn sm' + (td.id === active ? ' active' : '') }, td.label);
    b.dataset.tab = td.id;
    b.addEventListener('click', () => renderTab(td.id));
    tabs.append(b);
  });

  // ============ members (accounts) ============
  async function renderMembers(box) {
    const searchIn = el('input', { class: 'input', placeholder: 'جستجو (نام مشتری / موبایل / سطح)…', style: 'width:280px' });
    const tierSel = el('select', { style: 'min-width:160px' }, el('option', { value: '' }, 'همه سطوح'));
    api.get('/api/r/loyalty_tier?per_page=100').then(r => { for (const t2 of r.items) tierSel.append(el('option', { value: t2.id }, t2.name)); }).catch(() => {});
    const addBtn = el('button', { class: 'btn gold' }, '＋ عضو جدید');
    const boxTop = el('div', { class: 'flex wrap mb-16', style: 'gap:8px; align-items:flex-end' },
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'جستجو'), searchIn),
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'سطح'), tierSel),
      addBtn,
      exportMenu(fmt => '/api/loyalty/accounts/export?format=' + fmt + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی اعضا'));
    const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
    box.append(boxTop, card);
    let timer = null;
    const reload = () => load();
    searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reload, 300); });
    tierSel.addEventListener('change', reload);
    async function load() {
      clear(card);
      card.append(el('div', { class: 'skel', style: 'height:200px' }));
      try {
        const u = new URLSearchParams({ per_page: '100' });
        if (searchIn.value.trim()) u.set('q', searchIn.value.trim());
        if (tierSel.value) u.set('f_tier_id', tierSel.value);
        const { items, total } = await api.get('/api/loyalty/accounts?' + u.toString());
        clear(card);
        if (!items.length) return card.append(el('div', {}, emptyState('عضویی ثبت نشده است')));
        const head = el('tr', {}, el('th', {}, 'مشتری'), el('th', {}, 'موبایل'), el('th', {}, 'سطح'), el('th', {}, 'موجودی امتیاز'), el('th', {}, 'امتیاز کل'), el('th', {}, 'تخفیف'), el('th', {}, 'عملیات'));
        const rows = items.map(m => {
          const tr = el('tr', {});
          tr.append(el('td', {}, el('b', {}, m.customer_name || ('#' + m.customer_id)), el('div', { class: 'muted small' }, 'وضعیت مشتری: ' + (m.customer_status || '—'))));
          tr.append(el('td', { class: 'num' }, m.customer_mobile || m.customer_phone || '—'));
          tr.append(el('td', {}, m.tier_name || '—'));
          tr.append(el('td', { class: 'num' }, el('b', {}, faDigits(m.points_balance))));
          tr.append(el('td', { class: 'num muted' }, faDigits(m.points_earned)));
          tr.append(el('td', {}, faDigits(m.tier_discount || 0) + '٪'));
          const acts = el('span', { class: 'flex' });
          const ptsBtn = el('button', { class: 'btn sm' }, 'امتیاز');
          ptsBtn.addEventListener('click', () => pointsModal(m));
          const rmBtn = iconBtn('trash', 'حذف', async () => {
            if (await confirmDialog('حذف عضو', 'حساب این مشتری حذف شود؟ (فقط بدون سابقهٔ تراکنش)', 'حذف', true)) {
              try { await api.del('/api/loyalty/accounts/' + m.customer_id); toast('حذف شد', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
            }
          });
          acts.append(ptsBtn, rmBtn);
          tr.append(el('td', {}, acts));
          return tr;
        });
        card.append(el('div', { class: 'muted small mb-8' }, faDigits(total) + ' عضو'),
          el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
      } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
    }
    function pointsModal(m) {
      const typeSel = el('select', {}, el('option', { value: 'earn' }, 'اعتماد امتیاز'), el('option', { value: 'redeem' }, 'استفاده از امتیاز'), el('option', { value: 'adjust' }, 'اصلاح (±)'));
      const pts = el('input', { type: 'number', placeholder: 'مقدار', dir: 'ltr', value: '100' });
      const note = el('input', { placeholder: 'توضیح' });
      const ov = openModal('امتیاز — ' + (m.customer_name || ''), el('div', {},
        el('div', { class: 'muted small' }, 'موجودی فعلی: ' + faDigits(m.points_balance), el('br'), 'سطح فعلی: ' + (m.tier_name || '—')),
        el('div', { class: 'field' }, el('label', {}, 'نوع'), typeSel),
        el('div', { class: 'field' }, el('label', {}, 'مقدار امتیاز'), pts),
        el('div', { class: 'field' }, el('label', {}, 'توضیح'), note)),
        { footer: [
          el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
          el('button', { class: 'btn primary', onclick: async () => {
            try {
              const n = Number(pts.value);
              const r = await api.post('/api/loyalty/transactions', { customer_id: m.customer_id, type: typeSel.value, points: n, note: note.value });
              toast('انجام شد — موجودی جدید: ' + faDigits(r.balance), 'ok');
              ov.close(); load();
            } catch (e) { toast(e.message, 'err'); }
          } }, t('save')),
        ] });
    }
    addBtn.addEventListener('click', async () => {
      const custSel = el('select', {});
      const note = el('input', { placeholder: 'توضیح (اختیاری)' });
      const ov = openModal('عضو جدید در باشگاه', el('div', {},
        el('div', { class: 'field' }, el('label', {}, 'مشتری (از Customer Master)'), custSel),
        el('div', { class: 'field' }, el('label', {}, 'توضیح'), note)),
        { footer: [
          el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
          el('button', { class: 'btn primary', onclick: async () => {
            if (!custSel.value) return toast('مشتری را انتخاب کنید', 'err');
            try { const r = await api.post('/api/loyalty/accounts', { customer_id: Number(custSel.value) }); toast('ثبت شد', 'ok'); ov.close(); load(); } catch (e) { toast(e.message, 'err'); }
          } }, t('save')),
        ] });
      try {
        const { items } = await api.get('/api/r/customer?per_page=300&f_status=active');
        for (const cu of items) custSel.append(el('option', { value: cu.id }, cu.name + (cu.mobile ? ' — ' + cu.mobile : '')));
      } catch { }
    });
    load();
  }

  // ============ transactions ============
  async function renderTx(box) {
    const searchIn = el('input', { class: 'input', placeholder: 'جستجو (مشتری / توضیح)…', style: 'width:260px' });
    const typeSel = el('select', { style: 'min-width:150px' },
      el('option', { value: '' }, 'همه انواع'),
      el('option', { value: 'earn' }, 'اعتماد'), el('option', { value: 'redeem' }, 'استفاده'), el('option', { value: 'adjust' }, 'اصلاح'));
    const boxTop = el('div', { class: 'flex wrap mb-16', style: 'gap:8px; align-items:flex-end' },
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'جستجو'), searchIn),
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'نوع'), typeSel),
      exportMenu(fmt => '/api/loyalty/transactions/export?format=' + fmt + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی تراکنش‌ها'));
    const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
    box.append(boxTop, card);
    let timer = null;
    const reload = () => load();
    searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reload, 300); });
    typeSel.addEventListener('change', reload);
    async function load() {
      clear(card);
      card.append(el('div', { class: 'skel', style: 'height:200px' }));
      try {
        const u = new URLSearchParams({ per_page: '150' });
        if (searchIn.value.trim()) u.set('q', searchIn.value.trim());
        if (typeSel.value) u.set('f_type', typeSel.value);
        const { items } = await api.get('/api/loyalty/transactions?' + u.toString());
        clear(card);
        if (!items.length) return card.append(el('div', {}, emptyState('تراکنشی ثبت نشده است')));
        const TX_FA = { earn: 'اعتماد', redeem: 'استفاده', adjust: 'اصلاح' };
        const head = el('tr', {}, el('th', {}, 'مشتری'), el('th', {}, 'نوع'), el('th', {}, 'امتیاز'), el('th', {}, 'مستند'), el('th', {}, 'توضیح'), el('th', {}, 'تاریخ (شمسی)'), el('th', {}, ''));
        const rows = items.map(x => el('tr', {},
          el('td', {}, x.customer_name || ('#' + x.customer_id)),
          el('td', {}, el('span', { class: 'badge ' + (x.type === 'earn' ? 'green' : x.type === 'redeem' ? 'orange' : 'gold') }, TX_FA[x.type] || x.type)),
          el('td', { class: 'num ' + (x.points >= 0 ? '' : 'down') }, (x.points >= 0 ? '+' : '') + faDigits(x.points)),
          el('td', { class: 'muted small' }, x.ref_type ? (x.ref_type + (x.ref_id ? ' #' + x.ref_id : '')) : '—'),
          el('td', { class: 'small' }, x.note || '—'),
          el('td', {}, fmtDate(x.created_at, { time: true })),
          el('td', {}, iconBtn('trash', 'حذف تراکنش', async () => {
            if (await confirmDialog('حذف تراکنش', 'تراکنش حذف و اثر آن بر موجودی امتیاز برگشت می‌خورد. ادامه؟', 'حذف', true)) {
              try { await api.del('/api/loyalty/transactions/' + x.id); toast('حذف شد', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
            }
          }))));
        card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
      } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
    }
    load();
  }

  // ============ tiers (existing CRUD) ============
  async function renderTiers(box) {
    const searchIn = el('input', { class: 'input', placeholder: 'جستجو (نام سطح)…', style: 'width:240px' });
    const nameIn = el('input', { placeholder: 'نام سطح جدید' });
    const minIn = el('input', { type: 'number', placeholder: 'حداقل امتیاز', dir: 'ltr' });
    const discIn = el('input', { type: 'number', placeholder: 'تخفیف ٪', dir: 'ltr' });
    const addBtn = el('button', { class: 'btn gold' }, '＋ سطح جدید');
    const boxTop = el('div', { class: 'flex wrap mb-16', style: 'gap:8px; align-items:flex-end' },
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'جستجو'), searchIn),
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'نام'), nameIn),
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'حداقل امتیاز'), minIn),
      el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'تخفیف ٪'), discIn),
      addBtn,
      exportMenu(fmt => '/api/loyalty/export?format=' + fmt + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی باشگاه'));
    const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:180px' }));
    box.append(boxTop, card);
    let timer = null;
    async function load() {
      clear(card);
      card.append(el('div', { class: 'skel', style: 'height:180px' }));
      try {
        const u = new URLSearchParams({ per_page: '50' });
        if (searchIn.value.trim()) u.set('q', searchIn.value.trim());
        const { items: tiers } = await api.get('/api/r/loyalty_tier?' + u.toString());
        clear(card);
        if (!tiers.length) return card.append(el('div', {}, emptyState('سطحی تعریف نشده است')));
        for (const t2 of tiers) {
          const row = el('div', { class: 'flex between', style: 'padding:11px 16px; border-top:1px solid var(--border)' });
          row.append(el('div', {}, el('b', {}, el('span', { class: 'dot-status', style: 'background:' + (t2.color || '#c9a227') + '; display:inline-block; margin-inline-end:7px' }), t2.name),
            el('div', { class: 'muted small' }, 'حداقل امتیاز: ' + faDigits(t2.min_points) + ' • تخفیف: ' + faDigits(t2.discount_pct) + '٪')));
          row.append(iconBtn('trash', 'حذف', async () => {
            if (await confirmDialog('حذف سطح', 'سطح حذف شود؟', 'حذف', true)) { try { await api.del('/api/r/loyalty_tier/' + t2.id + '?hard=1'); location.reload(); } catch (e) { toast(e.message, 'err'); } }
          }));
          card.append(row);
        }
      } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
    }
    searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    addBtn.addEventListener('click', async () => {
      if (!nameIn.value.trim()) return toast('نام سطح را وارد کنید', 'err');
      try {
        await api.post('/api/r/loyalty_tier', { name: nameIn.value.trim(), min_points: Number(minIn.value) || 0, discount_pct: Number(discIn.value) || 0 });
        nameIn.value = minIn.value = discIn.value = '';
        toast('سطح ثبت شد', 'ok'); load();
      } catch (e) { toast(e.message, 'err'); }
    });
    load();
  }

  // ============ rules ============
  async function renderRules(box) {
    const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:140px' }));
    box.append(card);
    function elRateEditor() {
      const inp = el('input', { type: 'number', step: '0.5', min: '0', placeholder: 'امتیاز برای هر ۱ میلیون ریال (1 = فعلی، 0 = غیرفعال)', dir: 'ltr', style: 'width:320px' });
      const b = el('button', { class: 'btn sm' }, 'ثبت نرخ');
      b.addEventListener('click', async () => {
        try { await api.post('/api/loyalty/rules', { earn_rate: Number(inp.value) }); toast('نرخ به‌روزرسانی شد', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
      });
      return el('span', { class: 'flex', style: 'gap:6px' }, inp, b);
    }
    async function load() {
      clear(card);
      try {
        const r = await api.get('/api/loyalty/rules');
        clear(card);
        const perMillion = r.points_per_million || 0;
        const row1 = el('div', { class: 'flex between', style: 'padding:10px 0; border-bottom:1px solid var(--border)' });
        const info1 = el('div', {}, el('b', {}, 'نرخ امتیازدهی فروش'),
          el('div', { class: 'muted small' }, (r.enabled ? 'فعال' : 'غیرفعال') + ' — ' + faDigits(perMillion) + ' امتیاز برای هر ۱ میلیون ریال، هنگام پرداخت کامل فاکتور'));
        row1.append(info1, elRateEditor());
        const row2 = el('div', { class: 'flex between', style: 'padding:10px 0' });
        const info2 = el('div', {}, el('b', {}, 'قوانین سطح‌بندی'),
          el('div', { class: 'muted small' }, r.note || 'سطح هر عضو بر اساس «امتیاز کل کسب‌شده» به‌صورت خودکار به بالاترین سطح واجد شرط ارتقا می‌یابد'));
        row2.append(info2);
        const row3 = el('div', {}, el('b', {}, 'سطوح فعلی: '),
          (r.tiers || []).map(x => el('span', { class: 'badge', style: 'margin-inline-end:6px' }, x.name + ' (≥' + faDigits(x.min_points) + ' — ' + faDigits(x.discount_pct) + '٪)')));
        card.append(el('div', { class: 'card-b' }, row1, row2, row3));
      } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
    }
    load();
  }

  renderTab(active);
}

export async function outboxView(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'صندوق ارسال (ایمیل/پیامک)'), el('div', { class: 'sub' }, 'پیام‌های ارسالی و وضعیت تحویل/باز شدن — با وب‌هوک پنل‌ها به‌روزرسانی می‌شود')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('campaigns')));
  c.append(_ph);
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(card);
  try {
    const { items } = await api.get('/api/outbox');
    clear(card);
    if (!items.length) return card.append(el('div', {}, emptyState('پیامی ارسال نشده است')));
    const head = el('tr', {}, el('th', {}, 'کانال'), el('th', {}, 'گیرنده'), el('th', {}, 'متن'), el('th', {}, 'وضعیت'), el('th', {}, 'تاریخ'));
    const rows = items.slice(0, 100).map(o => el('tr', {},
      el('td', {}, o.channel),
      el('td', { class: 'num small' }, o.to_addr),
      el('td', { class: 'small' }, (o.subject ? o.subject + ' — ' : '') + (o.body || '').slice(0, 60)),
      el('td', {}, el('span', { class: 'badge ' + (o.status === 'sent' || o.status === 'delivered' ? 'green' : o.status === 'failed' ? 'red' : o.status === 'queued' ? 'orange' : '') }, o.status)),
      el('td', {}, fmtDate(o.created_at, { time: true }))));
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
}
export function documentsView(c) {
  const v = new ResourceView({ res: 'document', title: 'مدیریت اسناد', quickAction: 'سند جدید', hideColumns: ['text_content'] });
  c.append(v.root);
}
