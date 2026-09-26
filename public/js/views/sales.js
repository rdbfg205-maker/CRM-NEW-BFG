'use strict';
import { api, t, getToken, fmtNum, fmtMoney, fmtDate, faDigits, statusFa, jalaliLib, toEnDigits } from '../core.js';
// robust numeric parse: Persian/English digits + thousands separators
const numVal = (v) => { const n = Number(toEnDigits(String(v ?? '')).replace(/[,،\s]/g, '')); return Number.isFinite(n) ? n : 0; };
import { el, clear, toast, openModal, confirmDialog, emptyState, signaturePad } from '../ui.js';
import { ResourceView, iconBtn } from '../resource-view.js';
import { customerSelect } from '../customer-select.js';
import { helpBtn } from './help.js';
import { openCustomerMsgModal } from './customermsg.js';

export function quotesList(c) { const v = new ResourceView({ res: 'quote', title: 'پیش‌فاکتورها', quickAction: 'پیش‌فاکتور جدید' }); c.append(v.root); }
export function ordersList(c) { const v = new ResourceView({ res: 'order', title: 'سفارش‌ها', quickAction: 'سفارش جدید' }); c.append(v.root); }
export function invoicesList(c) { const v = new ResourceView({ res: 'invoice', title: 'فاکتورها', quickAction: 'فاکتور جدید' }); c.append(v.root); }
export function paymentsList(c) { const v = new ResourceView({ res: 'payment', title: 'پرداخت‌ها', quickAction: 'پرداخت جدید' }); c.append(v.root); }

// ============ document detail (quote/order/invoice) ============
export async function docDetail(c, kind, id) {
  const labels = { quote: 'پیش‌فاکتور', order: 'سفارش', invoice: 'فاکتور' };
  let doc;
  try { doc = (await api.get(`/api/r/${kind}/` + id)).item; } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  const back = { quote: '/quotes', order: '/orders', invoice: '/invoices' }[kind];
  const cust = doc.customer_id ? (await api.get('/api/r/customer/' + doc.customer_id).then(r => r.item).catch(() => null)) : null;
  c.append(el('div', { class: 'page-head' },
    el('a', { class: 'btn sm ghost', href: '#' + back }, '→ ' + labels[kind] + 'ها'),
    el('div', {}, el('h1', {}, labels[kind] + ' ' + (doc.number || '#' + doc.id)), el('div', { class: 'sub' }, cust ? cust.name + ' • ' + fmtDate(doc.created_at || doc.order_date || doc.issue_date) : '')),
    el('div', { class: 'actions' },
      helpBtn({ quote: 'quotes', order: 'orders', invoice: 'invoices' }[kind] || 'quotes'),
      kind === 'quote' && doc.status !== 'converted' ? el('button', { class: 'btn gold sm', onclick: async () => {
        if (!(await confirmDialog('تبدیل به سفارش', 'این پیش‌فاکتور به سفارش تبدیل و ردیف‌ها کپی می‌شود. ادامه می‌دهید؟', 'تبدیل'))) return;
        try { const r = await api.post(`/api/quotes/${id}/to-order`); toast('سفارش ایجاد شد', 'ok'); location.hash = '#/orders/' + r.order_id; } catch (e) { toast(e.message, 'err'); }
      } }, '→ تبدیل به سفارش') : null,
      kind === 'order' ? el('button', { class: 'btn gold sm', onclick: async () => {
        try { const r = await api.post(`/api/orders/${id}/to-invoice`); toast('فاکتور صادر شد', 'ok'); location.hash = '#/invoices/' + r.invoice_id; } catch (e) { toast(e.message, 'err'); }
      } }, '→ صدور فاکتور') : null,
      kind === 'order' && doc.quote_id ? el('a', { class: 'btn sm', href: '#/quotes/' + doc.quote_id }, '↖ پیش‌فاکتور مبدأ') : null,
      kind === 'quote' ? el('a', { class: 'btn sm', href: '#/customers/' + doc.customer_id }, 'مشتری') : null,
      kind === 'invoice' ? el('a', { class: 'btn sm', href: '#/customers/' + doc.customer_id }, 'مشتری') : null,
      kind === 'invoice' && doc.order_id ? el('a', { class: 'btn sm', href: '#/orders/' + doc.order_id }, '↖ سفارش') : null,
      kind === 'invoice' && doc.quote_id ? el('a', { class: 'btn sm', href: '#/quotes/' + doc.quote_id }, '↖ پیش‌فاکتور') : null,
      kind === 'order' ? el('a', { class: 'btn sm', href: '#/customers/' + doc.customer_id }, 'مشتری') : null,
      el('button', { class: 'btn sm', onclick: () => addPayment(doc) }, '＋ ثبت پرداخت'),
      (kind === 'quote' || kind === 'order' || kind === 'invoice') && ((window.__me && window.__me() || {}).permissions || {}).customer_message && !!(window.__me().permissions.customer_message.send)
        ? el('button', { class: 'btn sm gold', title: 'ارسال پیام به مشتری (پیامک/واتساپ/تلگرام/ایمیل)', onclick: () => openCustomerMsgModal({
            event_type: kind === 'quote' ? 'quote' : kind === 'order' ? 'shipment' : 'invoice',
            doc_type: kind === 'order' ? 'order' : kind,
            doc_id: Number(id), doc_number: doc.number || '', customer_id: doc.customer_id,
            customer_name: cust ? cust.name : '', amount: doc.total,
          }) }, kind === 'order' ? '📩 پیام ارسال کالا' : '📩 پیام به مشتری')
        : null,
      (() => {
        const wrap = el('div', { style: 'position:relative; display:inline-block' });
        const btn = el('button', { class: 'btn sm' }, '🖨 چاپ / PDF ▾');
        const menu = el('div', { style: 'display:none; position:absolute; top:100%; inset-inline-end:0; z-index:50; background:var(--bg,#fff); border:1px solid var(--border); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.15); min-width:190px; padding:4px' });
        const item = (href, label, checked) => {
          const a = el('a', { class: 'btn sm', style: 'display:block; width:100%', href }, (checked ? '☑ ' : '☐ ') + label);
          a.addEventListener('click', () => { menu.style.display = 'none'; });
          menu.append(a);
        };
        item(`/api/print/${kind}/${id}`, 'با سربرگ رسمی شرکت (PDF/چاپ)');
        item(`/api/print/${kind}/${id}?header=0`, 'بدون سربرگ رسمی');
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
        document.addEventListener('click', () => { menu.style.display = 'none'; });
        wrap.append(btn, menu);
        return wrap;
      })(),
    )));
  // chain reference strip (Order ← Quotation / Invoice ← Order ← Quotation)
  const chain = [];
  if (kind === 'order' && doc.quote_id) chain.push(['پیش‌فاکتور', doc.quote_id, '/quotes']);
  if (kind === 'invoice' && doc.order_id) chain.push(['سفارش', doc.order_id, '/orders']);
  if (kind === 'invoice' && doc.quote_id) chain.push(['پیش‌فاکتور', doc.quote_id, '/quotes']);
  if (chain.length) {
    const segs = [];
    segs.push(el('span', { class: 'muted' }, 'این سند از: '));
    chain.forEach(([l, cid, route], i) => {
      if (i) segs.push(el('span', { class: 'muted' }, ' ← '));
      segs.push(el('a', { href: '#' + route + '/' + cid }, l + ' #' + cid));
    });
    c.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-b small' }, ...segs)));
  }
  // summary strip
  const strip = el('div', { class: 'grid g-4 mb-16' });
  const s = (l, v, cls) => el('div', { class: 'card stat' }, el('div', { class: 's-label' }, l), el('div', { class: 's-value small ' + (cls || '') }, v));
  if (kind === 'quote') {
    strip.append(s('جمع خالص', fmtMoney(doc.subtotal)), s('مبلغ کل', fmtMoney(doc.total)), s('وضعیت', statusFa(doc.status)), s('اعتبار تا', doc.valid_until ? fmtDate(doc.valid_until) : '—'));
  } else if (kind === 'order') {
    strip.append(s('مبلغ کل', fmtMoney(doc.total)), s('وضعیت', statusFa(doc.status)), s('تاریخ تحویل', doc.due_date ? fmtDate(doc.due_date) : '—'), s('تاریخ ثبت', fmtDate(doc.order_date)));
  } else {
    const remain = Math.max(0, (doc.total || 0) - (doc.paid_amount || 0));
    strip.append(s('مبلغ کل', fmtMoney(doc.total)), s('پرداخت‌شده', fmtMoney(doc.paid_amount), 'up'), s('باقیمانده', fmtMoney(remain), remain > 0 ? 'down' : 'up'), s('وضعیت', statusFa(doc.status), /paid/.test(doc.status) ? 'up' : /overdue/.test(doc.status) ? 'down' : ''));
  }
  // Customer debt balance (Section 5) — real DB-backed balance shown on the
  // same document page (Customer → Proforma → Order → Invoice → Payment → Balance).
  if (doc.customer_id) {
    api.get('/api/customers/' + doc.customer_id + '/finance').then((fin) => {
      const tt = (fin && fin.totals) || {};
      const bal = tt.balance || 0;
      const credit = (fin && fin.customer && fin.customer.credit_status) ? ' — اعتبار: ' + fin.customer.credit_status : '';
      strip.append(s('مانده بدهی مشتری' + credit, fmtMoney(bal), bal > 0 ? 'down' : 'up'));
    }).catch(() => {});
  }
  c.append(strip);
  // ============ approval & signature chain (signature-based approvals) ============
  const apprBox = el('div', { class: 'card mb-16', style: 'display:none' });
  c.append(apprBox);
  loadApprovals();
  async function loadApprovals() {
    let ap;
    try { ap = await api.get(`/api/approvals/${kind}/${id}`); } catch { return; }
    if (!ap.configured) return;
    apprBox.style.display = '';
    const OVERALL_FA = { in_progress: ['در حال انجام', 'gold'], approved: ['تأیید و امضا شد', 'green'], rejected: ['رد شد', 'red'] };
    const [oFa, oCls] = OVERALL_FA[ap.overall] || ['—', ''];
    apprBox.innerHTML = '';
    apprBox.append(el('div', { class: 'card-h flex between' },
      el('h3', {}, '🖋 فرآیند تأیید و امضا'),
      el('span', { class: 'badge ' + oCls }, oFa)));
    const body = el('div', { class: 'card-b', style: 'display:flex; flex-direction:column; gap:10px' });
    for (const st of ap.items) {
      const S_FA = { pending: ['در انتظار امضا', 'gold'], awaiting: ['در صف (مرحله قبل باید امضا شود)', ''], approved: ['امضا شد', 'green'], rejected: ['رد شد', 'red'], cancelled: ['انصراف', 'red'] };
      const [sFa, sCls] = S_FA[st.status] || [st.status, ''];
      const row = el('div', { class: 'flex between', style: 'align-items:center; gap:10px; flex-wrap:wrap; border:1px solid var(--border); border-radius:10px; padding:10px 12px' });
      const left = el('div', { style: 'display:flex; align-items:center; gap:10px; flex:1; min-width:220px' },
        el('span', { class: 'badge', style: 'min-width:26px; text-align:center' }, faDigits(st.position)),
        el('div', {}, el('b', { class: 'small' }, st.label), el('div', { class: 'muted small' }, 'نقش الزامی: ' + st.required_role)));
      const right = el('div', { style: 'display:flex; align-items:center; gap:10px; flex-wrap:wrap' });
      right.append(el('span', { class: 'badge ' + sCls }, sFa));
      if (st.status === 'approved') {
        right.append(el('span', { class: 'small muted' }, (st.approver_name || '') + ' • ' + fmtDate(st.signed_at, { time: true })));
        if (st.signature) {
          const sigImg = el('img', { alt: 'امضا', style: 'max-height:34px; max-width:110px; border:1px solid var(--border); border-radius:6px; padding:2px 4px; background:#fff' });
          fetch(st.signature, { headers: { Authorization: 'Bearer ' + getToken() } }).then(r => r.ok ? r.blob() : Promise.reject(new Error('x')))
            .then(b => { sigImg.src = URL.createObjectURL(b); }).catch(() => sigImg.remove());
          right.append(sigImg);
        }
        if (st.note) right.append(el('span', { class: 'muted small', title: 'یادداشت' }, '📝 ' + st.note));
      } else if (st.status === 'rejected') {
        right.append(el('span', { class: 'small muted' }, (st.approver_name || '') + (st.note ? ' — ' + st.note : '')));
      } else if (st.status === 'pending' && st.i_can_sign_here) {
        right.append(el('button', { class: 'btn primary sm', onclick: () => signStageModal(st) }, '✍ امضا و تأیید'));
      }
      row.append(left, right);
      body.append(row);
    }
    if (!ap.has_my_signature) {
      body.append(el('div', { class: 'alert warn small' }, 'شما امضای الکترونیکی ندارید. برای امضای مراحل، ابتدا از «تنظیمات کاربر ← امضای الکترونیکی من» امضا را بارگذاری کنید.'));
    } else if (!ap.i_can_sign_any) {
      body.append(el('div', { class: 'muted small' }, 'شما مجوز استفاده از امضا در فرآیندها را ندارید (با مدیر سیستم هماهنگ کنید).'));
    }
    apprBox.append(body);
  }
  function signStageModal(st) {
    const pad = signaturePad();
    const useRegistered = el('input', { type: 'checkbox', checked: true, style: 'width:auto' });
    const noteIn = el('input', { placeholder: 'یادداشت (اختیاری — برای رد الزامی است)' });
    const ov = openModal('امضا و تأیید مرحله: ' + st.label, el('div', {},
      el('div', { class: 'alert info small' }, 'این امضا با هویت شما (' + ((window.__me() || {}).user || {}).full_name + ') و تاریخ فعلی ثبت می‌شود و قابل جعل یا تغییر نیست.'),
      el('div', { class: 'field' }, el('label', {}, 'امضای ثبت‌شده شما'), el('div', { class: 'flex', style: 'gap:10px; align-items:center; flex-wrap:wrap' },
        el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, useRegistered, 'استفاده از امضای ثبت‌شده'))),
      el('div', { class: 'field' }, el('label', {}, 'یا امضای جدید را بنویسید (در صورت تیک نبودن گزینه بالا)'), pad.canvas),
      el('div', { class: 'field' }, el('label', {}, 'یادداشت'), noteIn)), {
      large: true,
      footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn danger', onclick: async () => {
          if (!noteIn.value.trim()) return toast('برای رد، دلیل (یادداشت) الزامی است.', 'err');
          try {
            const r = await api.post(`/api/approvals/${kind}/${id}/reject`, { note: noteIn.value.trim() });
            toast('مرحله رد شد', 'ok'); ov.close(); loadApprovals();
          } catch (e) { toast(e.message, 'err'); }
        } }, 'رد مرحله'),
        el('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const payload = { note: noteIn.value.trim() };
            if (!useRegistered.checked) {
              if (!pad.dataUrl) return (e.target.disabled = false) || toast('امضا را بنویسید یا از امضای ثبت‌شده استفاده کنید.', 'err');
              payload.signature = pad.dataUrl;
            }
            const r = await api.post(`/api/approvals/${kind}/${id}/approve`, payload);
            toast('امضا و تأیید ثبت شد', 'ok'); ov.close(); loadApprovals();
          } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
        } }, '✍ امضا و تأیید'),
      ],
    });
  }
  // items editor
  const itemsBox = el('div', { class: 'card mb-16' });
  c.append(itemsBox);
  const isQuote = kind === 'quote';
  const _me = (typeof window !== 'undefined' && window.__me) ? (window.__me() || {}) : {};
  const canOverride = !!(isQuote && _me.permissions && _me.permissions.price_override && _me.permissions.price_override.edit);
  const STAGE_FA = { cash: 'نقدی', '3_month': '۳ ماهه', '6_month': '۶ ماهه', custom: 'سایر' };
  loadItems();
  async function loadItems() {
    itemsBox.innerHTML = '';
    try {
      const { items } = await api.get(`/api/r/${kind}/${id}/items`);
      const prods = (await api.get('/api/r/product?per_page=200').catch(() => ({ items: [] }))).items;
      const priceListMap = new Map(); // non-quote legacy: product_id -> price (last stage wins)
      const plSel = el('select', { style: 'width:auto; margin-inline-end:8px' });
      plSel.append(el('option', { value: '' }, 'لیست قیمت: پایه کالا'));
      const tbody = el('tbody');

      // ---- base price (quote): server-resolved per line (product/customer/list/stage) ----
      function paintBase(ctx) {
        const b = ctx.baseT, st = ctx.statusT;
        b.textContent = (ctx.base === null || ctx.base === undefined) ? '—' : fmtMoney(ctx.base);
        if (ctx.override) {
          st.innerHTML = '';
          st.append(el('span', { class: 'badge gold', style: 'margin-inline-end:6px' }, 'Override: بله'));
          if (ctx.reason) st.append(el('span', { class: 'muted' }, 'دلیل: ' + ctx.reason));
        } else {
          st.innerHTML = '';
          st.append(el('span', { class: 'muted' }, 'Override: خیر'));
        }
      }
      async function fetchBase(ctx) {
        const pSel = ctx.row.querySelector('td:first-child select');
        const stageSel = ctx.row.children[3] ? ctx.row.children[3].querySelector('select') : null;
        const pid = pSel && pSel.value ? Number(pSel.value) : null;
        const stage = stageSel ? stageSel.value : 'cash';
        if (!pid) { ctx.base = null; ctx.override = false; ctx.reason = null; paintBase(ctx); return; }
        try {
          const u = new URLSearchParams({ product_id: String(pid), customer_id: String(doc.customer_id || ''), payment_stage: stage });
          const lid = plSel.value || doc.price_list_id;
          if (lid) u.set('price_list_id', String(lid));
          const s = await api.get('/api/quotes/price-suggest?' + u.toString());
          const wasOverride = ctx.override;
          ctx.base = (s && s.price !== null && s.price !== undefined) ? Number(s.price) : null;
          ctx.reason = ctx.override ? ctx.reason : null;
          if (ctx.forcePrice) {
            // product changed → auto-fill the NEW suggested price
            ctx.forcePrice = false;
            ctx.mineTouched = false;
            ctx.override = false;
            if (ctx.priceI) ctx.priceI.value = ctx.base !== null ? String(ctx.base) : '';
          } else if (!wasOverride && ctx.priceI && !ctx.mineTouched) {
            // stage / price-list change on a line the user has NOT manually edited
            ctx.priceI.value = ctx.base !== null ? String(ctx.base) : '';
          }
          // otherwise: the user's manual price is preserved (no reset on qty/other fields)
          paintBase(ctx);
        } catch { /* keep last base */ }
      }
      // build one line row (quote = override-aware columns)
      function makeRow(it) {
        it = it || {};
        const pSel = el('select', {});
        pSel.append(el('option', { value: '' }, '—'));
        for (const p of prods) pSel.append(el('option', { value: p.id, selected: Number(p.id) === Number(it.product_id) ? '' : null }, p.name));
        if (it.product_id && ![...pSel.options].some(o => String(o.value) === String(it.product_id))) pSel.append(el('option', { value: it.product_id, selected: '' }, it.product_name || 'محصول #' + it.product_id));
        const nameI = el('input', { value: it.name || '' });
        const qtyI = el('input', { type: 'number', value: it.qty || 1, dir: 'ltr' });
        if (isQuote) {
          const stageSel = el('select', { style: 'width:96px' });
          for (const [v, l] of [['cash', 'نقدی'], ['3_month', '۳ ماهه'], ['6_month', '۶ ماهه']]) stageSel.append(el('option', { value: v, selected: (it.payment_stage || 'cash') === v ? '' : null }, l));
          const baseT = el('b', { class: 'num', dir: 'ltr' });
          const statusT = el('div', { class: 'small', style: 'margin-top:3px' });
          // unit price is ALWAYS manually editable; picking a product only auto-fills
          // the suggested price. Section 3 server-side override audit still applies on save.
          const priceI = el('input', { type: 'number', value: it.price || '', dir: 'ltr', title: 'قابل ویرایش دستی — انتخاب محصول قیمت پیشنهادی را درج می‌کند' });
          const reasonI = el('input', { placeholder: 'دلیل Override (الزامی)', style: 'width:150px', disabled: canOverride ? null : true });
          const discI = el('input', { type: 'number', value: it.discount_pct || 0, dir: 'ltr' });
          const taxI = el('input', { type: 'number', value: it.tax_rate == null ? '' : it.tax_rate, dir: 'ltr', placeholder: 'خالی = نرخ سند' });
          const lt = el('td', { class: 'num' }, fmtMoney(it.line_total || (it.qty * it.price * (1 - (it.discount_pct || 0) / 100))));
          const ctx = {
            row: null,
            base: (it.base_price === undefined || it.base_price === null) ? null : Number(it.base_price),
            override: !!it.override_status,
            reason: it.override_reason || null,
            priceI,
            mineTouched: !!it.override_status,
            savedPrice: (it.price === undefined || it.price === null) ? null : Number(it.price),
            isExisting: !!it.id,
            forcePrice: false,
          };
          ctx.baseT = baseT; ctx.statusT = statusT;
          // a reason is required whenever the user actually changes the final price
          // (new override OR restoring a previous override back to base). Empty
          // input means "keep base" — no reason needed for a NEW line at base.
          const effPrice = () => {
            const raw = String(priceI.value ?? '');
            return raw.trim() === '' ? (ctx.base !== null ? ctx.base : 0) : numVal(raw);
          };
          const needsReason = () => {
            if (!canOverride || ctx.base === null) return false;
            const p = effPrice();
            if (Math.abs(p - ctx.base) > 0.01) return true;
            if (ctx.isExisting && ctx.savedPrice !== null && Math.abs(p - (ctx.savedPrice || 0)) > 0.01) return true;
            return false;
          };
          const syncReason = () => {
            const need = needsReason();
            reasonI.style.display = need ? '' : 'none';
            ctx.override = ctx.base !== null && Math.abs(effPrice() - ctx.base) > 0.01;
            paintBase(ctx);
          };
          const recalcLine = () => {
            lt.textContent = fmtMoney(numVal(qtyI.value) * numVal(priceI.value) * (1 - numVal(discI.value) / 100));
          };
          qtyI.addEventListener('input', recalcLine);
          discI.addEventListener('input', recalcLine);
          priceI.addEventListener('input', () => { ctx.mineTouched = true; ctx.override = ctx.base !== null && Math.abs(effPrice() - ctx.base) > 0.01; syncReason(); recalcLine(); });
          pSel.addEventListener('change', () => { const p = prods.find(x => x.id === Number(pSel.value)); if (p && !nameI.value) nameI.value = p.name; ctx.forcePrice = !!pSel.value; fetchBase(ctx); });
          stageSel.addEventListener('change', () => fetchBase(ctx));
          const tr = el('tr', {},
            el('td', {}, pSel), el('td', {}, nameI),
            el('td', {}, qtyI), el('td', {}, stageSel),
            el('td', {}, baseT, statusT), el('td', {}, priceI),
            el('td', {}, discI), el('td', {}, taxI),
            lt, el('td', {}, reasonI),
            el('td', { class: 'row-act' }, iconBtn('trash', 'حذف ردیف', async () => {
              tr.remove();
              await saveItems(tbody, prods);
            })));
          ctx.row = tr;
          tr._ctx = ctx;
          tr._lineId = it.id || null;
          reasonI.style.display = ctx.override ? '' : 'none';
          paintBase(ctx);
          return tr;
        }
        const priceI = el('input', { type: 'number', value: it.price || '', dir: 'ltr' });
        const discI = el('input', { type: 'number', value: it.discount_pct || 0, dir: 'ltr' });
        const taxI = el('input', { type: 'number', value: it.tax_rate == null ? '' : it.tax_rate, dir: 'ltr', placeholder: 'خالی = نرخ سند' });
        const lt = el('td', { class: 'num' }, fmtMoney(it.line_total || (it.qty * it.price * (1 - (it.discount_pct || 0) / 100))));
        const recalcPlain = () => { lt.textContent = fmtMoney(numVal(qtyI.value) * numVal(priceI.value) * (1 - numVal(discI.value) / 100)); };
        qtyI.addEventListener('input', recalcPlain);
        priceI.addEventListener('input', recalcPlain);
        discI.addEventListener('input', recalcPlain);
        const plainTr = el('tr', {},
          el('td', {}, pSel), el('td', {}, nameI),
          el('td', {}, qtyI), el('td', {}, priceI), el('td', {}, discI), el('td', {}, taxI),
          lt,
          el('td', { class: 'row-act' }, iconBtn('trash', 'حذف ردیف', async () => {
            plainTr.remove();
            await saveItems(tbody, prods);
          })));
        plainTr._lineId = it.id || null;
        return plainTr;
      }
      for (const it of items) {
        const tr = makeRow(it);
        if (isQuote) {
          // fresh rows get their base from the server (existing rows already carry base_price)
          if (!it.base_price && it.product_id) fetchBase(tr._ctx);
        }
        tbody.append(tr);
      }
      const thead = isQuote
        ? el('tr', {}, el('th', {}, 'محصول'), el('th', {}, 'شرح'), el('th', {}, 'تعداد'), el('th', {}, 'مرحله'), el('th', {}, 'قیمت پایه'), el('th', {}, 'قیمت نهایی'), el('th', {}, 'تخفیف %'), el('th', {}, 'مالیات %'), el('th', {}, 'جمع'), el('th', {}, 'دلیل Override'), el('th', {}, ''))
        : el('tr', {}, el('th', {}, 'محصول'), el('th', {}, 'شرح'), el('th', {}, 'تعداد'), el('th', {}, 'قیمت واحد'), el('th', {}, 'تخفیف %'), el('th', {}, 'مالیات %'), el('th', {}, 'جمع'), el('th', {}, ''));
      if (!items.length) tbody.append(el('tr', {}, el('td', { colspan: isQuote ? 11 : 8, class: 'muted small', style: 'text-align:center; padding:18px' }, 'ردیفی ثبت نشده است. «افزودن ردیف» را بزنید.')));

      if (isQuote) {
        plSel.addEventListener('change', async () => {
          for (const tr of [...tbody.children]) if (tr._ctx) await fetchBase(tr._ctx);
        });
        api.get('/api/r/price_list?per_page=50').then(({ items: pls }) => {
          for (const pl of pls.filter(x => x.active)) plSel.append(el('option', { value: pl.id, selected: doc.price_list_id === pl.id ? '' : null }, pl.name));
        }).catch(() => {});
      } else {
        plSel.addEventListener('change', applyListPrices);
        api.get('/api/r/price_list?per_page=50').then(({ items: pls }) => {
          for (const pl of pls.filter(x => x.active)) plSel.append(el('option', { value: pl.id, selected: doc.price_list_id === pl.id ? '' : null }, pl.name));
          applyListPrices();
        }).catch(() => {});
        async function applyListPrices() {
          if (!plSel.value) { priceListMap.clear(); return; }
          try {
            const r = await api.get('/api/pricelist/' + plSel.value + '/items');
            priceListMap.clear();
            for (const x of r.items) priceListMap.set(x.product_id, x.price);
            for (const tr of tbody.children) {
              const pSel = tr.children[0] && tr.children[0].querySelector('select');
              const priceI = tr.children[3] && tr.children[3].querySelector('input');
              if (pSel && pSel.value && priceI && priceListMap.has(Number(pSel.value))) priceI.value = String(priceListMap.get(Number(pSel.value)));
            }
          } catch { /* keep base prices */ }
        }
      }
      itemsBox.append(
        el('div', { class: 'card-h' }, el('h3', {}, 'ردیف‌های ' + labels[kind].toLowerCase()),
          el('div', { class: 'flex', style: 'margin-inline-start:auto; align-items:center; gap:6px' }, plSel,
          el('button', { class: 'btn sm gold', onclick: () => {
            const tr = makeRow(null);
            if (isQuote && tr._ctx) { /* base fetched on product change */ }
            tbody.append(tr);
          } }, '＋ افزودن ردیف'))),
        tbody);
      const table = el('table', { class: 'tbl' }, el('thead', {}, thead), tbody);
      itemsBox.append(el('div', { class: 'tbl-wrap' }, table));
      const foot = el('div', { class: 'flex', style: 'padding:13px 16px; border-top:1px solid var(--border)' },
        el('span', { class: 'small muted', style: 'margin-inline-end:auto' }, 'قیمت واحد قابل ویرایش دستی است؛ انتخاب محصول فقط قیمت پیشنهادی را درج می‌کند.' + (canOverride ? ' تغییر قیمت نهایی (Override) با مجوز شما فعال است و دلیل آن الزامی است.' : ' برای ذخیرهٔ قیمت متفاوت از قیمت پایه، مجوز price_override لازم است.')),
        el('button', { class: 'btn primary sm', onclick: () => saveItems(tbody, prods) }, '💾 ذخیره ردیف‌ها'));
      itemsBox.append(foot);
    } catch (e) { itemsBox.append(el('div', { class: 'card-b alert danger' }, e.message)); }
  }
  async function saveItems(tbody, prods) {
    const items = [];
    for (const tr of tbody.children) {
      const cells = tr.children;
      if (cells.length < (isQuote ? 10 : 7)) continue;
      const pSel = cells[0].querySelector('select');
      const nameI = cells[1].querySelector('input');
      if (!pSel || !nameI) continue;
      if (!nameI.value.trim() && !pSel.value) continue;
      if (isQuote) {
        const ctx = tr._ctx;
        const priceI = cells[5].querySelector('input');
        const stageSel = cells[3].querySelector('select');
        const reasonI = cells[9].querySelector('input');
        const taxI = cells[7].querySelector('input');
        const base = ctx ? (ctx.base === null || ctx.base === undefined) ? null : Number(ctx.base) : null;
        const rawPrice = String(priceI.value ?? '');
        const effPrice = rawPrice.trim() === '' ? (base !== null ? base : 0) : numVal(rawPrice);
        const isOverride = base !== null && Math.abs(effPrice - base) > 0.01;
        // reason needed for any REAL final-price change (new override or restore)
        const needsReason = canOverride && base !== null && (
          isOverride ||
          (ctx && ctx.isExisting && ctx.savedPrice !== null && Math.abs(effPrice - (ctx.savedPrice || 0)) > 0.01)
        );
        const reason = (reasonI && reasonI.value || '').trim();
        if (needsReason && !reason) return toast('دلیل تغییر قیمت (Override Reason) برای ردیف «' + (nameI.value.trim() || '—') + '» الزامی است.', 'err');
        items.push({
          id: tr._lineId || undefined,
          product_id: pSel.value ? Number(pSel.value) : null,
          name: nameI.value.trim() || (prods.find(p => p.id === Number(pSel.value)) || {}).name || 'ردیف',
          qty: Number(cells[2].querySelector('input')?.value) || 0,
          payment_stage: stageSel ? stageSel.value : 'cash',
          price: Number(rawPrice) || 0,
          discount_pct: Number(cells[6].querySelector('input')?.value) || 0,
          tax_rate: taxI && taxI.value.trim() !== '' ? Number(taxI.value) || 0 : null,
          override_reason: needsReason ? reason : '',
        });
      } else {
        const taxI = cells[5].querySelector('input');
        items.push({
          product_id: pSel.value ? Number(pSel.value) : null,
          name: nameI.value.trim() || (prods.find(p => p.id === Number(pSel.value)) || {}).name || 'ردیف',
          qty: Number(cells[2].querySelector('input')?.value) || 0,
          price: Number(cells[3].querySelector('input')?.value) || 0,
          discount_pct: Number(cells[4].querySelector('input')?.value) || 0,
          tax_rate: taxI && taxI.value.trim() !== '' ? Number(taxI.value) || 0 : null,
        });
      }
    }
    if (!items.length) return toast('حداقل یک ردیف با نام ثبت کنید', 'err');
    try {
      await api.put(`/api/r/${kind}/${id}/items`, { items });
      if (plSel.value && doc.price_list_id !== Number(plSel.value)) {
        await api.put(`/api/r/${kind}/${id}`, { price_list_id: Number(plSel.value) });
        doc.price_list_id = Number(plSel.value);
      }
      toast('ردیف‌ها ذخیره شد', 'ok');
      loadItems();
    } catch (e) { toast(e.message, 'err'); }
  }
  // payments (for invoice)
  if (kind === 'invoice') {
    const payBox = el('div', { class: 'card mb-16' });
    c.append(payBox);
    payBox.append(el('div', { class: 'card-h' }, el('h3', {}, 'پرداخت‌های این فاکتور')));
    const { items: pays } = await api.get('/api/r/payment?per_page=100');
    const list = pays.filter(p => p.invoice_id === Number(id));
    if (!list.length) payBox.append(el('div', { class: 'card-b muted small' }, 'پرداختی ثبت نشده است.'));
    else payBox.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'شماره'), el('th', {}, 'مبلغ'), el('th', {}, 'روش'), el('th', {}, 'بانک/حساب'), el('th', {}, 'تاریخ'), el('th', {}, 'وضعیت'), el('th', {}, ''))),
      el('tbody', {}, list.map(p => el('tr', {},
        el('td', {}, p.number), el('td', { class: 'num' }, fmtMoney(p.amount)), el('td', {}, statusFa(p.method)),
        el('td', { class: 'small' }, [p.bank, p.account].filter(Boolean).join(' / ') || (p.reference || '—')),
        el('td', {}, fmtDate(p.paid_at)),
        el('td', {}, el('span', { class: 'badge ' + (/paid/.test(p.status || '') ? 'green' : /refunded|cancelled|failed/.test(p.status || '') ? 'red' : 'orange') }, statusFa(p.status) || p.status || 'ثبت‌شده')),
        (() => {
          const acts = [];
          if ((window.__me && window.__me() || {}).permissions && window.__me().permissions.customer_message && window.__me().permissions.customer_message.send) {
            acts.push(iconBtn('edit', 'پیام ثبت پرداخت به مشتری', () => openCustomerMsgModal({
              event_type: 'payment', doc_type: 'payment', doc_id: p.id, doc_number: p.number || '',
              customer_id: Number(id), customer_name: cust ? cust.name : '', amount: p.amount,
            })));
          }
          if (p.status === 'paid' || p.status === 'pending') {
            acts.push(iconBtn('trash', 'برگشت پرداخت', async () => {
              if (await confirmDialog('برگشت پرداخت', `پرداخت ${p.number} (${fmtMoney(p.amount)}) برگشت می‌خورد و مانده فاکتور به‌روزرسانی می‌شود.`, 'برگشت', true)) {
                try { await api.post('/api/payments/' + p.id + '/refund'); toast('پرداخت برگشت خورد', 'ok'); location.reload(); } catch (e) { toast(e.message, 'err'); }
              }
            }, 'danger'));
          }
          return el('td', { class: 'row-act' }, ...acts);
        })()))))));
  }
  // notes / activity
  const actBox = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'فعالیت‌ها')));
  c.append(actBox);
  const { items: acts } = await api.get(`/api/r/${kind}/${id}/activities`).catch(() => ({ items: [] }));
  if (!acts.length) actBox.append(el('div', { class: 'card-b muted small' }, 'فعالیتی ثبت نشده است.'));
  else actBox.append(el('div', { class: 'card-b' }, el('div', { class: 'timeline' }, acts.slice(0, 12).map(a => el('div', { class: 'tl-item' }, el('div', { class: 'tl-t' }, a.summary), el('div', { class: 'tl-d' }, (a.full_name ? a.full_name + ' — ' : '') + fmtDate(a.created_at, { time: true })))))));
}
function addPayment(doc) {
  const isInv = !!(doc.number && /^INV/.test(doc.number));
  const remain = isInv ? Math.max(0, (doc.total || 0) - (doc.paid_amount || 0)) : 0;
  const amount = el('input', { type: 'number', placeholder: 'مبلغ (ریال)', dir: 'ltr' });
  const method = el('select', {});
  for (const [v, l] of [['cash', 'نقدی'], ['card', 'کارت'], ['bank', 'انتقال بانکی / حواله'], ['check', 'چک'], ['installment', 'قسطی'], ['other', 'سایر']]) method.append(el('option', { value: v }, l));
  const bank = el('input', { placeholder: 'بانک (اختیاری)' });
  const account = el('input', { placeholder: 'شماره حساب (اختیاری)', dir: 'ltr' });
  const ref = el('input', { placeholder: 'شماره پیگیری / حواله', dir: 'ltr' });
  const checkInfo = el('input', { placeholder: 'شماره چک (در صورت چک)', dir: 'ltr' });
  const note = el('input', { placeholder: 'توضیحات (اختیاری)' });
  const ov = openModal('ثبت پرداخت', el('div', { class: 'form-grid' },
    isInv ? el('div', { class: 'alert info', style: 'grid-column:1/-1' }, `فاکتور ${doc.number} — مانده: ` + fmtMoney(remain)) : null,
    el('div', { class: 'field' }, el('label', {}, 'مبلغ (ریال)'), amount),
    el('div', { class: 'field' }, el('label', {}, 'روش پرداخت'), method),
    el('div', { class: 'field' }, el('label', {}, 'بانک'), bank),
    el('div', { class: 'field' }, el('label', {}, 'شماره حساب'), account),
    el('div', { class: 'field' }, el('label', {}, 'شماره پیگیری'), ref),
    el('div', { class: 'field' }, el('label', {}, 'مشخصات چک'), checkInfo),
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'توضیحات'), note)), {
    footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        const amt = Number(amount.value);
        if (!amt || amt <= 0) return toast('مبلغ معتبر وارد کنید', 'err');
        if (isInv && amt > remain + 0.5) return toast(`مبلغ بیشتر از مانده فاکتور (${fmtMoney(remain)}) است`, 'err');
        try {
          const body = { customer_id: doc.customer_id, amount: amt, method: method.value, reference: ref.value, bank: bank.value, account: account.value, check_info: checkInfo.value, notes: note.value };
          if (isInv) body.invoice_id = doc.id;
          await api.post('/api/payments', body);
          const full = isInv && amt >= remain - 0.5;
          toast(full ? 'پرداخت کامل شد — وضعیت فاکتور: پرداخت‌شده' : 'پرداخت ثبت شد — وضعیت فاکتور: پرداخت جزئی', 'ok');
          ov.close();
          location.reload();
        } catch (e) { toast(e.message, 'err'); }
      } }, t('save'))],
  });
}
// ============ commission (rules + lifecycle + reports) ============
const BASIS_TYPES = [
  { v: 'percent_sales', l: 'درصدی از مبلغ فروش (فاکتور)' },
  { v: 'percent_collected', l: 'درصدی از مبلغ وصول‌شده (پرداخت)' },
  { v: 'product', l: 'بر اساس محصول' },
  { v: 'customer', l: 'بر اساس مشتری' },
  { v: 'tier', l: 'پلکانی بر اساس مبلغ' },
  { v: 'margin', l: 'حاشیه سود' },
];
const BASIS_TYPE_FA = Object.fromEntries(BASIS_TYPES.map(x => [x.v, x.l]));
const COMM_STATUS_FA = { calculated: 'محاسبه‌شده (در انتظار تأیید)', approved: 'تأییدشده', paid: 'پرداخت‌شده', cancelled: 'لغوشده', pending: 'در انتظار' };
export async function commissionPage(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'پورسانت فروش'), el('div', { class: 'sub' }, 'قوانین پورسانت، محاسبه بر اساس فاکتور/وصول، تأیید و پرداخت — بدون محاسبه تکراری')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('commission')));
  c.append(_ph);
  // ---- rules ----
  const box = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'قوانین پورسانت'),
    el('button', { class: 'btn sm gold', style: 'margin-inline-start:auto', onclick: ruleForm }, '＋ قانون جدید')));
  c.append(box);
  let rules = (await api.get('/api/commissions').catch(() => ({ rules: [] }))).rules;
  const rbody = el('div', { class: 'tbl-wrap' });
  box.append(rbody);
  const fillRules = () => {
    clear(rbody);
    if (!rules.length) return rbody.append(el('div', { class: 'card-b muted small' }, 'قانونی تعریف نشده است.'));
      const tbody = el('tbody');
      for (const r of rules) {
        const base = r.basis_type === 'product' ? (r.product_name || ('محصول #' + r.product_id)) : r.basis_type === 'customer' ? (r.customer_name || ('مشتری #' + r.customer_id)) : '—';
        const tier = r.basis_type === 'tier' ? (fmtMoney(r.min_amount || 0) + ' تا ' + (r.max_amount ? fmtMoney(r.max_amount) : '∞')) : '—';
        const valid = (r.valid_from || r.valid_until) ? (r.valid_from ? fmtDate(r.valid_from) : 'شروع: —') + ' تا ' + (r.valid_until ? fmtDate(r.valid_until) : 'ادامه') : '—';
        const acts = el('div', { class: 'row-act', style: 'display:flex; gap:3px' });
        acts.append(iconBtn('edit', 'ویرایش', () => ruleForm(r)));
        acts.append(iconBtn('trash', 'حذف', async () => {
          if (await confirmDialog('حذف قانون', 'قانون «' + r.name + '» حذف شود؟', 'حذف', true)) {
            try { await api.del('/api/commission-rules/' + r.id); rules = rules.filter(x => x.id !== r.id); fillRules(); } catch (e) { toast(e.message, 'err'); }
          }
        }));
        tbody.append(el('tr', {},
          el('td', {}, el('b', {}, r.name)),
          el('td', { class: 'small' }, BASIS_TYPE_FA[r.basis_type] || r.basis_type || '—'),
          el('td', {}, faDigits(r.pct) + '٪'),
          el('td', { class: 'small' }, base),
          el('td', { class: 'small' }, tier),
          el('td', { class: 'small muted' }, valid),
          el('td', {}, el('span', { class: 'badge ' + (r.active ? 'green' : 'red') }, r.active ? 'فعال' : 'غیرفعال')),
          el('td', { class: 'row-act' }, acts)));
      }
      rbody.append(el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'نام'), el('th', {}, 'نوع محاسبه'), el('th', {}, 'درصد'), el('th', {}, 'مبنا (محصول/مشتری)'), el('th', {}, 'بازه مبلغ'), el('th', {}, 'اعتبار'), el('th', {}, 'وضعیت'), el('th', {}, ''))),
        tbody));
  };
  fillRules();
  function ruleForm(rule) {
    const isEdit = !!rule;
    const name = el('input', { placeholder: 'نام قانون', value: rule ? rule.name : '' });
    const basisType = el('select', {}, BASIS_TYPES.map(bt => el('option', { value: bt.v, selected: ((rule && rule.basis_type) || 'percent_sales') === bt.v ? '' : null }, bt.l)));
    const pct = el('input', { type: 'number', step: '0.1', placeholder: 'مثلاً 2', dir: 'ltr', value: rule ? rule.pct : '' });
    const prods = el('select', {}, el('option', { value: '' }, '— همه —'));
    const custs = customerSelect({ value: rule && rule.customer_id ? Number(rule.customer_id) : null });
    const sps = el('select', {}, el('option', { value: '' }, '— همه کارشناسان —'));
    const minA = el('input', { type: 'number', placeholder: 'از (ریال)', dir: 'ltr', value: rule && rule.min_amount ? rule.min_amount : '' });
    const maxA = el('input', { type: 'number', placeholder: 'تا (ریال، خالی = بی‌نهایت)', dir: 'ltr', value: rule && rule.max_amount ? rule.max_amount : '' });
    const vf = el('input', { type: 'text', placeholder: 'شماره: ۱۴۰/۰۱/۱', value: rule && rule.valid_from ? jalaliStr(rule.valid_from) : '' });
    const vu = el('input', { type: 'text', placeholder: 'شماره: ۱۴۰۵/۱۲/۲۹', value: rule && rule.valid_until ? jalaliStr(rule.valid_until) : '' });
    const target = el('input', { type: 'number', placeholder: 'هدف ماهانه (ریال) — اختیاری', dir: 'ltr', value: rule && rule.monthly_target ? rule.monthly_target : '' });
    const bonus = el('input', { type: 'number', placeholder: 'درصد اضافه هنگام تحقق هدف — اختیاری', dir: 'ltr', value: rule && rule.target_bonus_pct ? rule.target_bonus_pct : '' });
    const active = el('input', { type: 'checkbox', checked: rule ? !!rule.active : true });
    // lazy options
    api.get('/api/r/product?per_page=300').then(r2 => { for (const p of r2.items) prods.append(el('option', { value: p.id, selected: rule && rule.product_id === p.id ? '' : null }, p.name)); }).catch(() => {});
    api.get('/api/admin/users?per_page=200').then(r2 => { for (const u of (r2.items || [])) sps.append(el('option', { value: u.id, selected: rule && rule.salesperson_id === u.id ? '' : null }, u.full_name)); }).catch(() => {});
    const ov = openModal(isEdit ? 'ویرایش قانون پورسانت' : 'قانون پورسانت جدید', el('div', { class: 'form-grid' },
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'نام قانون'), name),
      el('div', { class: 'field' }, el('label', {}, 'نوع محاسبه'), basisType),
      el('div', { class: 'field' }, el('label', {}, 'درصد پورسانت'), pct),
      el('div', { class: 'field' }, el('label', {}, 'محصول (برای قانون محصول)'), prods),
      el('div', { class: 'field' }, el('label', {}, 'مشتری (برای قانون مشتری)'), custs),
      el('div', { class: 'field' }, el('label', {}, 'کارشناس فروش (محدودسازی)'), sps),
      el('div', { class: 'field' }, el('label', {}, 'حداقل مبلغ (قانون پلکانی)'), minA),
      el('div', { class: 'field' }, el('label', {}, 'حداکثر مبلغ (قانون پلکانی)'), maxA),
      el('div', { class: 'field' }, el('label', {}, 'اعتبار از (شمسی)'), vf),
      el('div', { class: 'field' }, el('label', {}, 'اعتبار تا (شمسی)'), vu),
      el('div', { class: 'field' }, el('label', {}, 'هدف ماهانه'), target),
      el('div', { class: 'field' }, el('label', {}, 'پورسانت هدف ٪'), bonus),
      el('div', { class: 'field' }, el('label', { class: 'chk', style: 'display:flex; gap:6px; align-items:center' }, active, 'فعال'))), {
      footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!name.value.trim()) return toast('نام الزامی است', 'err');
          if (!Number(pct.value)) return toast('درصد الزامی است', 'err');
          const parseJ = (v) => { if (!v.trim()) return null; const m = v.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (!m) return null; const g = jalaliLib().toGregorian(+m[1], +m[2], +m[3]); return new Date(g.gy, g.gm - 1, g.gd, 12).toISOString(); };
          let vfIso = parseJ(vf.value), vuIso = parseJ(vu.value);
          if (vf.value.trim() && !vfIso) return toast('تاریخ اعتبار از نامعتبر است', 'err');
          if (vu.value.trim() && !vuIso) return toast('تاریخ اعتبار تا نامعتبر است', 'err');
          try {
            const body = { name: name.value.trim(), basis_type: basisType.value, basis: basisType.value === 'margin' ? 'margin' : 'amount', pct: Number(pct.value), product_id: prods.value ? Number(prods.value) : null, customer_id: custs.value ? Number(custs.value) : null, salesperson_id: sps.value ? Number(sps.value) : null, min_amount: Number(minA.value) || 0, max_amount: maxA.value ? Number(maxA.value) : null, valid_from: vfIso, valid_until: vuIso, monthly_target: Number(target.value) || 0, target_bonus_pct: Number(bonus.value) || 0, active: active.checked ? 1 : 0 };
            if (isEdit) { await api.put('/api/commission-rules/' + rule.id, body); rules = rules.map(x => x.id === rule.id ? { ...x, ...body } : x); }
            else { const r2 = await api.post('/api/commission-rules', body); rules.push({ ...body, id: r2.id }); }
            fillRules(); ov.close(); toast('ذخیره شد', 'ok');
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save'))],
    });
  }
  // ---- commissions results ----
  const periodSel = el('select', { style: 'width:auto' });
  const statusSel = el('select', { style: 'width:auto' });
  const resBox = el('div', { class: 'card mt-16' },
    el('div', { class: 'card-h' }, el('h3', {}, 'پورسانت‌ها'),
      el('div', { class: 'flex', style: 'margin-inline-start:auto; gap:6px' },
        periodSel,
        statusSel,
        el('button', { class: 'btn sm primary', id: 'calc-btn' }, '⚙ محاسبه دوره'),
        el('a', { class: 'btn sm', href: '#/reports' }, '📊 گزارش‌ها'),
        el('a', { class: 'btn sm', id: 'comm-xlsx' }, '⬇ Excel'),
        el('a', { class: 'btn sm', id: 'comm-pdf' }, '🖨 PDF'))));
  c.append(resBox);
  // periods from data + current
  let allComms = [];
  const loadComms = async () => {
    rbody2.innerHTML = '<div class="skel" style="height:120px"></div>';
    try {
      const r2 = await api.get('/api/commissions');
      allComms = r2.rows || [];
      const periods = [...new Set(allComms.map(x => x.period))].sort().reverse();
      if (periodSel.value && !periods.includes(periodSel.value)) periods.unshift(periodSel.value);
      clear(periodSel);
      periodSel.append(el('option', { value: '' }, 'همه دوره‌ها'));
      for (const p of periods) periodSel.append(el('option', { value: p, selected: p === periodSel.value ? '' : null }, p));
      fillRes();
    } catch (e) { rbody2.innerHTML = ''; rbody2.append(el('div', { class: 'alert danger' }, e.message)); }
  };
  clear(statusSel);
  statusSel.append(el('option', { value: '' }, 'همه وضعیت‌ها'));
  for (const [v, l] of Object.entries(COMM_STATUS_FA)) statusSel.append(el('option', { value: v }, l));
  periodSel.addEventListener('change', fillRes);
  statusSel.addEventListener('change', fillRes);
  const rbody2 = el('div', { class: 'tbl-wrap' });
  resBox.append(rbody2);
  function fillRes() {
    clear(rbody2);
    const list = allComms.filter(x => (!periodSel.value || x.period === periodSel.value) && (!statusSel.value || x.status === statusSel.value));
    if (!list.length) return rbody2.append(el('div', { class: 'card-b muted small' }, 'پورسانتی یافت نشد. قانون بسازید و «محاسبه دوره» را بزنید.'));
    const tbody = el('tbody');
    for (const x of list) {
      const acts = el('div', { class: 'row-act', style: 'display:flex; gap:3px' });
      if (x.status === 'calculated' || x.status === 'pending') acts.append(iconBtn('edit', 'تأیید مدیریتی', async () => { try { await api.post('/api/commissions/' + x.id + '/approve'); toast('تأیید شد', 'ok'); loadComms(); } catch (e) { toast(e.message, 'err'); } }));
      if (x.status === 'approved') acts.append(iconBtn('check', 'ثبت پرداخت', async () => { try { await api.post('/api/commissions/' + x.id + '/pay'); toast('پرداخت شد', 'ok'); loadComms(); } catch (e) { toast(e.message, 'err'); } }));
      if (['calculated', 'approved', 'pending'].includes(x.status)) acts.append(iconBtn('trash', 'لغو', async () => { if (await confirmDialog('لغو پورسانت', 'این پورسانت لغو شود؟', 'لغو', true)) { try { await api.post('/api/commissions/' + x.id + '/cancel'); toast('لغو شد', 'ok'); loadComms(); } catch (e) { toast(e.message, 'err'); } } }));
      tbody.append(el('tr', {},
        el('td', {}, x.full_name || '—'),
        el('td', { class: 'num' }, x.period),
        el('td', { class: 'small' }, x.basis ? (BASIS_TYPE_FA[x.basis] || x.basis) : (x.basis_type || '—')),
        el('td', { class: 'small' }, x.invoice_number ? ('فاکتور ' + x.invoice_number) : x.payment_number ? ('پرداخت ' + x.payment_number) : '—'),
        el('td', { class: 'num small' }, x.customer_name || '—'),
        el('td', { class: 'num' }, fmtMoney(x.base)),
        el('td', {}, x.rate ? faDigits(x.rate) + '٪' : '—'),
        el('td', { class: 'num' }, fmtMoney(x.amount)),
        el('td', {}, el('span', { class: 'badge ' + (x.status === 'paid' ? 'green' : x.status === 'approved' ? 'gold' : x.status === 'cancelled' ? 'red' : 'orange') }, COMM_STATUS_FA[x.status] || x.status)),
        el('td', { class: 'row-act' }, acts)));
    }
    rbody2.append(el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'کارشناس'), el('th', {}, 'دوره'), el('th', {}, 'مبنا'), el('th', {}, 'رکورد مرجع'), el('th', {}, 'مشتری'), el('th', {}, 'مبلغ مبنای محاسبه'), el('th', {}, 'درصد'), el('th', {}, 'پورسانت'), el('th', {}, 'وضعیت'), el('th', {}, ''))),
      tbody));
  }
  resBox.querySelector('#calc-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r3 = await api.post('/api/commissions/calc', {});
      toast(`محاسبه شد — ${faDigits(r3.created || 0)} پورسانت جدید ثبت شد (تکراری محاسبه نمی‌شود)`, 'ok');
      loadComms();
    } catch (e2) { toast(e2.message, 'err'); }
    e.target.disabled = false;
  });
  // exports for visible list
  const exportUrl = (fmt) => {
    const u = new URLSearchParams({ format: fmt });
    if (periodSel.value) u.set('period', periodSel.value);
    return '/api/commissions/export?' + u.toString();
  };
  resBox.querySelector('#comm-xlsx').href = exportUrl('xlsx');
  resBox.querySelector('#comm-pdf').href = exportUrl('html');
  await loadComms();
}
function jalaliStr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const j = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0');
}
