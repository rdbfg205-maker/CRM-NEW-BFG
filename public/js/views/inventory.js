'use strict';
import { api, t, fmtNum, fmtMoney, fmtDate, faDigits, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState, exportMenu } from '../ui.js';
import { ResourceView, iconBtn } from '../resource-view.js';
import { helpBtn } from './help.js';

const TYPE_FA = { in: 'ورود', out: 'خروج', transfer: 'انتقال', adjust: 'اصلاح', reservation: 'رزرو' };

export async function stockView(c, rawOnly) {
  const searchIn = el('input', { class: 'input', placeholder: rawOnly ? 'جستجو (نام / کد / دسته)…' : 'جستجو (نام / کد / دسته) — داده از دیتابیس', style: 'width:300px' });
  const catSel = el('select', { style: 'min-width:170px' }, el('option', { value: '' }, 'همه دسته‌ها'));
  const statusSel = el('select', { style: 'min-width:140px' },
    el('option', { value: '' }, 'همه وضعیت‌ها'),
    el('option', { value: 'low' }, 'کمبود'),
    el('option', { value: 'over' }, 'بیش از حد'),
    el('option', { value: 'ok' }, 'معمول'));
  const sortSel = el('select', { style: 'min-width:160px' },
    el('option', { value: 'id:desc' }, 'جدیدترین'),
    el('option', { value: 'name:asc' }, 'نام (الفبا)'),
    el('option', { value: 'stock_qty:asc' }, 'موجودی (کم‌ترین)'),
    el('option', { value: 'stock_qty:desc' }, 'موجودی (بیش‌ترین)'));
  c.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, rawOnly ? 'مواد اولیه' : 'موجودی کالا'), el('div', { class: 'sub' }, 'موجودی، حداقل و حداکثر از دیتابیس واقعی — هشدار کمبود خودکار')),
    el('div', { class: 'actions' },
      helpBtn('stock'),
      exportMenu(fmt => '/api/stock/export?format=' + fmt + (rawOnly ? '&raw=1' : '') + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی موجودی'),
      el('a', { class: 'btn', href: '#/products' }, 'مدیریت محصولات'),
      el('button', { class: 'btn gold', onclick: () => stockMoveModal(rawOnly) }, '＋ حرکت موجودی'))));
  const box = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:280px' }));
  c.append(box);
  let timer = null;
  const reload = () => load();
  searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reload, 300); });
  catSel.addEventListener('change', reload);
  statusSel.addEventListener('change', reload);
  sortSel.addEventListener('change', reload);
  c.append(el('div', { class: 'mb-16 flex wrap', style: 'gap:8px; align-items:flex-end' },
    el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'جستجو'), searchIn),
    el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'دسته'), catSel),
    el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'وضعیت'), statusSel),
    el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'مرتب‌سازی'), sortSel)));
  // category options from DB
  api.get('/api/r/product_categories?per_page=200').then(r => {
    for (const cat of (r.items || [])) catSel.append(el('option', { value: cat.id }, cat.name));
  }).catch(() => {});
  async function load() {
    clear(box);
    box.append(el('div', { class: 'skel', style: 'height:280px' }));
    try {
      const u = new URLSearchParams({ per_page: '200', sort: sortSel.value });
      if (searchIn.value.trim()) u.set('q', searchIn.value.trim());
      if (catSel.value) u.set('f_category_id', catSel.value);
      if (rawOnly) u.set('f_is_raw_material', '1');
      const { items } = await api.get('/api/r/product?' + u.toString());
      let list = rawOnly ? items.filter(p => p.is_raw_material) : items;
      list = list.filter(p => !p.archived_at);
      if (statusSel.value) {
        list = list.filter(p => {
          const low = p.reorder_point > 0 && p.stock_qty <= p.reorder_point;
          const over = p.max_stock > 0 && p.stock_qty > p.max_stock;
          return statusSel.value === 'low' ? low : statusSel.value === 'over' ? over : !low && !over;
        });
      }
      clear(box);
      if (!list.length) return box.append(el('div', {}, emptyState('کالایی ثبت نشده است')));
      const head = el('tr', {}, el('th', {}, 'کد'), el('th', {}, 'نام'), el('th', {}, 'دسته'), el('th', {}, 'موجودی'), el('th', {}, 'حداقل (سفارش مجدد)'), el('th', {}, 'حداکثر'), el('th', {}, 'ارزش'), el('th', {}, 'وضعیت'));
      const rows = list.map(p => {
        const low = p.reorder_point > 0 && p.stock_qty <= p.reorder_point;
        const over = p.max_stock > 0 && p.stock_qty > p.max_stock;
        return el('tr', { style: 'cursor:pointer', onclick: () => stockMoveModal(rawOnly, p) },
          el('td', { class: 'num' }, p.code || '—'),
          el('td', {}, el('b', {}, p.name), p.unit ? el('span', { class: 'muted small' }, ' (' + p.unit + ')') : null),
          el('td', {}, p.category_name || '—'),
          el('td', {}, el('b', { class: low ? 'down' : '' }, faDigits(p.stock_qty))),
          el('td', { class: 'muted' }, faDigits(p.reorder_point || 0)),
          el('td', { class: 'muted' }, faDigits(p.max_stock || 0)),
          el('td', { class: 'num' }, fmtMoney(p.stock_qty * (p.price_cost || 0))),
          el('td', {}, low ? el('span', { class: 'badge red' }, 'کمبود') : over ? el('span', { class: 'badge orange' }, 'بیش از حد') : el('span', { class: 'badge green' }, 'معمول')));
      });
      box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
    } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
  }
  load();
}
function stockMoveModal(rawOnly, preset) {
  const prods = [];
  const pSel = el('select', {});
  api.get('/api/r/product?per_page=200').then(({ items }) => {
    const list = items.filter(p => !rawOnly || p.is_raw_material);
    for (const p of list) pSel.append(el('option', { value: p.id, selected: preset && p.id === preset.id ? '' : null }, p.name + ' (موجودی: ' + faDigits(p.stock_qty) + ' ' + (p.unit || '') + ')'));
    if (preset) pSel.value = String(preset.id);
  }).catch(() => {});
  const type = el('select', {});
  for (const [v, l] of [['in', 'ورود به انبار'], ['out', 'خروج از انبار'], ['transfer', 'انتقال (بین انبارها)'], ['adjust', 'اصلاح (تفحص)'], ['reservation', 'رزرو']]) type.append(el('option', { value: v }, l));
  const qty = el('input', { type: 'number', placeholder: 'مقدار', dir: 'ltr' });
  const note = el('input', { placeholder: 'توضیح' });
  const ov = openModal('حرکت موجودی', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'کالا'), pSel),
    el('div', { class: 'field' }, el('label', {}, 'نوع حرکت'), type),
    el('div', { class: 'field' }, el('label', {}, 'مقدار'), qty),
    el('div', { class: 'field' }, el('label', {}, 'توضیح'), note),
    el('div', { class: 'muted small' }, 'انتقال = جابه‌جایی داخلی بین انبارها؛ موجودی کل تغییر نمی‌کند و حرکت در Audit ثبت می‌شود.')),
    { footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        if (!pSel.value || !Number(qty.value)) return toast('کالا و مقدار را وارد کنید', 'err');
        try {
          const r = await api.post('/api/stock/move', { product_id: Number(pSel.value), type: type.value, qty: Number(qty.value), note: note.value });
          toast('موجودی به‌روزرسانی شد (جدید: ' + faDigits(r.new_stock) + ')', 'ok');
          ov.close();
          location.reload();
        } catch (e) { toast(e.message, 'err'); }
      } }, t('save')),
    ] });
}
export async function movementsView(c) {
  // NOTE: declared BEFORE the header — exportMenu() invokes its url-builder
  // eagerly at build time, so referencing this input there must not hit the TDZ
  // ("Cannot access 'searchIn' before initialization").
  const searchIn = el('input', { class: 'input', placeholder: 'جستجو (کالا / توضیح / کاربر)…', style: 'width:280px' });
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'گردش کالا'), el('div', { class: 'sub' }, 'تمامی حرکات ورود، خروج، انتقال، اصلاح و رزرو — با Audit Log')));
  _ph.append(el('div', { class: 'actions' },
    helpBtn('stock'),
    exportMenu(fmt => '/api/stock/movements/export?format=' + fmt + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی گردش')));
  c.append(_ph);
  const typeSel = el('select', { style: 'min-width:150px' }, el('option', { value: '' }, 'همه حرکات'), ...Object.entries(TYPE_FA).map(([v, l]) => el('option', { value: v }, l)));
  const box = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:280px' }));
  c.append(box);
  let timer = null;
  async function load() {
    clear(box);
    box.append(el('div', { class: 'skel', style: 'height:280px' }));
    try {
      const u = new URLSearchParams({ per_page: '100', sort: 'id:desc' });
      if (searchIn.value.trim()) u.set('q', searchIn.value.trim());
      if (typeSel.value) u.set('f_type', typeSel.value);
      const { items } = await api.get('/api/r/stock_transaction?' + u.toString());
      clear(box);
      if (!items.length) return box.append(el('div', {}, emptyState('حرکتی ثبت نشده است')));
      const head = el('tr', {}, el('th', {}, 'کالا'), el('th', {}, 'نوع'), el('th', {}, 'مقدار'), el('th', {}, 'مستند'), el('th', {}, 'توضیح'), el('th', {}, 'کاربر'), el('th', {}, 'تاریخ (شمسی)'));
      const rows = items.map(m => el('tr', {},
        el('td', {}, m.product_name || ('#' + m.product_id)),
        el('td', {}, el('span', { class: 'badge ' + (m.type === 'in' ? 'green' : m.type === 'out' ? 'red' : 'gold') }, TYPE_FA[m.type] || m.type)),
        el('td', { class: 'num ' + (m.qty >= 0 ? '' : 'down') }, (m.qty >= 0 ? '+' : '') + fmtNum(m.qty)),
        el('td', { class: 'muted small' }, m.ref_type ? (m.ref_type + (m.ref_id ? ' #' + m.ref_id : '')) : '—'),
        el('td', {}, m.note || '—'),
        el('td', {}, m.user_name || '—'),
        el('td', {}, fmtDate(m.created_at, { time: true }))));
      box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
    } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
  }
  searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  typeSel.addEventListener('change', load);
  c.append(el('div', { class: 'mb-16 flex wrap', style: 'gap:8px; align-items:flex-end' },
    el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'جستجو'), searchIn),
    el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'نوع حرکت'), typeSel)));
  load();
}
export async function alertsView(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'هشدارهای موجودی'), el('div', { class: 'sub' }, 'اقلام در آستانه سفارش مجدد، بیش از حد مجاز یا منفی — هشدارهای خودکار انبار')));
  _ph.append(el('div', { class: 'actions' },
    helpBtn('stock'),
    exportMenu(fmt => '/api/stock/alerts/export?format=' + fmt, 'خروجی هشدارها')));
  c.append(_ph);
  const box = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(box);
  try {
    const { items } = await api.get('/api/r/stock_alert?per_page=100&sort=id:desc');
    clear(box);
    if (!items.length) return box.append(el('div', {}, emptyState('هشداری فعال نیست ✔')));
    for (const a of items) {
      box.append(el('div', { class: 'flex between', style: 'padding:11px 16px; border-top:1px solid var(--border)' },
        el('div', {},
          el('b', { class: 'small' }, a.product_name || ('کالا #' + a.product_id)),
          el('div', { class: 'muted small' }, a.message || ''),
          el('div', { class: 'muted small' }, fmtDate(a.created_at, { time: true }))),
        el('div', { class: 'flex' },
          a.level === 'max' ? el('span', { class: 'badge orange' }, 'بیش از حد') : el('span', { class: 'badge red' }, 'کمبود'),
          !a.resolved_at ? el('button', { class: 'btn sm', onclick: async () => {
            try {
              await api.put('/api/r/stock_alert/' + a.id, { resolved_at: new Date().toISOString() });
              toast('هشدار برطرف شد', 'ok');
              location.reload();
            } catch (e) { toast(e.message, 'err'); }
          } }, 'برطرف شد') : el('span', { class: 'badge green' }, 'برطرف شد'))));
    }
  } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
}
