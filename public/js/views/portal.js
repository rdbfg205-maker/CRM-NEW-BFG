'use strict';
// Customer self-service portal (#/portal) — restricted access, own data only.
// Uses its OWN token (bfc_portal_token) — never touches the staff app token.
import { el, clear, toast, openModal, confirmDialog, emptyState } from '../ui.js';
import { faDigits, fmtDate, fmtMoney } from '../core.js';

const PORTAL_TOKEN_KEY = 'bfc_portal_token';
const ptoken = () => { try { return localStorage.getItem(PORTAL_TOKEN_KEY) || ''; } catch { return ''; } };
const pset = (t) => { try { t ? localStorage.setItem(PORTAL_TOKEN_KEY, t) : localStorage.removeItem(PORTAL_TOKEN_KEY); } catch { /* ignore */ } };
async function papi(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ptoken() };
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401) { pset(null); throw Object.assign(new Error('نشست پورتال به پایان رسیده است.'), { code: 'UNAUTHORIZED', status: 401 }); }
    throw Object.assign(new Error((data && data.error && data.error.message) || 'خطا در ارتباط با سرور'), { code: data && data.error && data.error.code, status: res.status });
  }
  return data;
}
const ORDER_STATUS_FA = { pending: 'در انتظار', confirmed: 'تأییدشده', processing: 'در حال پردازش', shipped: 'ارسال‌شده', delivered: 'تحویل‌شده', cancelled: 'لغوشده' };
const COMP_STATUS_FA = { new: 'جدید', in_progress: 'در حال بررسی', waiting: 'در انتظار', resolved: 'حل‌شده', closed: 'بسته‌شده', rejected: 'ردشده' };
const PRIORITY_FA = { low: 'کم', medium: 'متوسط', high: 'زیاد', critical: 'بحرانی' };
const FAMILY_FA = { foam_sponge: 'فوم و اسفنج', polyurethane: 'مواد اولیه پلی‌یورتان', foam_mattress: 'تشک تمام‌فوم', bed_related: 'تشک و محصولات مرتبط با تخت', other: 'سایر' };
const CHANNEL_FA = { sms: 'پیامک', whatsapp: 'واتساپ', telegram: 'تلگرام', email: 'ایمیل' };

export function portalPage(c) {
  c.append(el('div', { class: 'boot-portal', style: 'padding:60px 10px' }, el('div', { class: 'skel', style: 'height:160px' })));
  render();
  async function render() {
    clear(c);
    if (!ptoken()) return renderLogin(c);
    let me = null;
    try { me = await papi('/api/portal/me'); } catch (e) { return renderLogin(c, e.message); }
    renderApp(c, me);
  }

  function renderLogin(c, err) {
    c.append(el('div', { class: 'card', style: 'max-width:430px; margin:40px auto' },
      el('div', { class: 'card-h' }, el('h3', {}, '🔐 پورتال مشتریان')),
      el('div', { class: 'card-b' },
        err ? el('div', { class: 'alert warn small mb-10' }, err) : null,
        el('div', { class: 'muted small mb-10' }, 'ورود با نام کاربری و رمزی که از طرف شرکت برای شما فعال شده است. شما فقط به اطلاعاتِ خودتان (سفارش‌ها، شکایات و پیام‌های خود) دسترسی دارید.'),
        el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'نام کاربری'), el('input', { id: 'p-user', dir: 'ltr', autocomplete: 'username' })),
        el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'رمز عبور'), el('input', { id: 'p-pass', type: 'password', dir: 'ltr', autocomplete: 'current-password' })),
        el('button', { class: 'btn primary', style: 'width:100%', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await papi('/api/portal/login', 'POST', { username: c.querySelector('#p-user').value.trim(), password: c.querySelector('#p-pass').value });
            pset(r.access);
            render();
          } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
        } }, 'ورود به پورتال'),
        el('div', { class: 'muted small', style: 'margin-top:14px; text-align:center' }, 'برای بازگشت به بخش اصلی CRM: ', el('a', { href: '#/' }, 'پنل اصلی')))));
  }

  function renderApp(c, me) {
    const cust = me.customer || {};
    c.append(el('div', { class: 'page-head' },
      el('div', {}, el('h1', {}, 'پورتال مشتری'), el('div', { class: 'sub' }, (cust.name || '') + ' — سفارش‌ها، شکایات و ارتباط با شرکت')),
      el('div', { class: 'actions' },
        el('a', { class: 'btn sm ghost', href: '#/' }, 'پنل اصلی'),
        el('button', { class: 'btn sm', onclick: () => { pset(null); location.hash = '#/'; } }, 'خروج'))));
    const tabNames = ['سفارش‌های من', 'شکایات من', 'پیام‌ها'];
    const boxes = [el('div'), el('div'), el('div')];
    c.append(el('div', { class: 'mb-16' }, (function () {
      const bar = el('div', { class: 'tabs' });
      tabNames.forEach((t, i) => bar.append(el('div', { class: 'tab' + (i === 0 ? ' active' : ''), onclick: () => {
        [...bar.children].forEach((x, j) => x.classList.toggle('active', j === i));
        boxes.forEach((b, j) => b.style.display = j === i ? '' : 'none');
      } }, t)));
      return bar;
    })()));
    boxes.forEach((b, i) => { b.style.display = i === 0 ? '' : 'none'; c.append(b); });
    loadOrders(boxes[0]);
    loadComplaints(boxes[1]);
    loadMessages(boxes[2]);
  }

  // ---------- orders ----------
  async function loadOrders(box) {
    clear(box);
    const top = el('div', { class: 'flex between mb-10' }, el('span', { class: 'muted small' }, 'سفارش‌های ثبت‌شده شما'), el('button', { class: 'btn sm gold', onclick: () => orderForm(() => loadOrders(box)) }, '＋ ثبت سفارش جدید'));
    box.append(el('div', { class: 'card' }, el('div', { class: 'card-b' }, top, el('div', { class: 'skel', style: 'height:120px' }))));
    try {
      const { items } = await papi('/api/portal/orders');
      const body = box.querySelector('.card-b');
      const sk = body.querySelector('.skel'); if (sk) sk.remove();
      if (!items.length) return body.append(emptyState('سفارشی ثبت نشده است.'));
      const rows = items.map(o => el('tr', { style: 'cursor:pointer', onclick: () => orderDetail(o.id, () => loadOrders(box)) },
        el('td', { dir: 'ltr' }, o.number),
        el('td', {}, fmtDate(o.order_date)),
        el('td', {}, faDigits(o.item_count || 0) + ' ردیف'),
        el('td', { class: 'num' }, fmtMoney(o.total || 0)),
        el('td', {}, el('span', { class: 'badge ' + (o.status === 'cancelled' ? 'red' : o.status === 'delivered' ? 'green' : 'gold') }, ORDER_STATUS_FA[o.status] || o.status))));
      body.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'شماره'), el('th', {}, 'تاریخ'), el('th', {}, 'ردیف'), el('th', {}, 'مبلغ کل'), el('th', {}, 'وضعیت'))), el('tbody', {}, rows))));
    } catch (e) { const sk = box.querySelector('.skel'); if (sk) sk.remove(); box.querySelector('.card-b').append(el('div', { class: 'alert danger' }, e.message)); }
  }
  function orderDetail(id, onDone) {
    (async () => {
      const body = el('div', { class: 'skel', style: 'height:120px' });
      const ov = openModal('جزئیات سفارش', body, { footer: [el('button', { class: 'btn', onclick: () => ov.close() }, 'بستن')] });
      try {
        const r = await papi('/api/portal/orders/' + id);
        clear(body);
        const o = r.item || {};
        body.append(el('div', { class: 'kv mb-10' },
          el('div', {}, el('b', {}, 'شماره: '), el('span', { dir: 'ltr' }, o.number || '—'), '   ', el('b', {}, 'وضعیت: '), ORDER_STATUS_FA[o.status] || o.status || '—'),
          el('div', {}, el('b', {}, 'تاریخ: '), fmtDate(o.order_date)),
          el('div', {}, el('b', {}, 'مبلغ کل: '), fmtMoney(o.total || 0))));
        const its = r.items || [];
        if (its.length) body.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, el('th', {}, 'محصول'), el('th', {}, 'تعداد'), el('th', {}, 'قیمت'), el('th', {}, 'جمع'))),
          el('tbody', {}, its.map(i => el('tr', {}, el('td', {}, i.name || '—'), el('td', { class: 'num' }, faDigits(i.qty)), el('td', { class: 'num' }, fmtMoney(i.price || 0)), el('td', { class: 'num' }, fmtMoney((i.qty || 0) * (i.price || 0)))))))));
      } catch (e) { clear(body); body.append(el('div', { class: 'alert danger' }, e.message)); }
    })();
  }
  function orderForm(onDone) {
    let prods = [];
    const body = el('div', { class: 'skel', style: 'height:140px' });
    const ov = openModal('ثبت سفارش جدید', body, { large: true, footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: async () => {
        const lines = [...linesBox.children].filter(tr => tr.children.length > 3 && tr.children[0].querySelector('select').value);
        if (!lines.length) return toast('حداقل یک ردیف با محصول انتخاب کنید', 'err');
        const items = [];
        for (const tr of lines) {
          const sel = tr.children[0].querySelector('select');
          const p = prods.find(x => String(x.id) === sel.value);
          const qty = Number(tr.children[1].querySelector('input').value);
          const priceRaw = tr.children[2].querySelector('input').value;
          const price = priceRaw === '' ? (p ? p.price_retail : 0) : Number(String(priceRaw).replace(/[۰-۹]/g, d => '۰۱۳۴۵۷۸۹'.indexOf(d)).replace(/[,،\s]/g, ''));
          if (!p || !(qty > 0) || !(price >= 0)) return toast('مقادیر ردیف را کامل و معتبر وارد کنید', 'err');
          items.push({ product_id: p.id, qty, price });
        }
        footerBtn.disabled = true;
        try {
          const r = await papi('/api/portal/orders', 'POST', { items, notes: notesIn.value.trim() });
          toast('سفارش شما با موفقیت ثبت شد (شماره سفارش: ' + r.order_id + ')', 'ok');
          ov.close(); onDone && onDone();
        } catch (e) { toast(e.message, 'err'); footerBtn.disabled = false; }
      } }, 'ثبت سفارش')
    ]});
    const footerBtn = ov.modal.querySelector('.m-f .btn.primary');
    (async () => {
      try {
        const r = await papi('/api/portal/products');
        prods = r.items || [];
        clear(body);
        if (!prods.length) return body.append(el('div', { class: 'alert warn' }, 'محصول فعالی برای سفارش وجود ندارد.'));
        const selFor = (sel) => {
          const s = el('select', {});
          s.append(el('option', { value: '' }, '— محصول را انتخاب کنید —'));
          prods.forEach(p => s.append(el('option', { value: p.id }, p.name + (p.code ? ' (' + p.code + ')' : ''))));
          s.value = sel || '';
          s.addEventListener('change', () => {
            const p = prods.find(x => String(x.id) === s.value);
            const priceCell = s.closest('tr').children[2];
            if (p) priceCell.querySelector('input').value = p.price_retail;
          });
          return s;
        };
        const numIn = (v = '') => el('input', { type: 'number', dir: 'ltr', value: v, style: 'width:110px' });
        const linesBox = el('tbody');
        const addLine = () => {
          const tr = el('tr', {},
            el('td', { style: 'min-width:220px' }, selFor()),
            el('td', {}, numIn(1)),
            el('td', {}, numIn('')),
            el('td', {}, el('button', { class: 'btn sm', onclick: () => tr.remove() }, '✕')));
          linesBox.append(tr);
        };
        addLine();
        const notesIn = el('input', { placeholder: 'توضیحات سفارش (اختیاری)' });
        body.append(
          el('div', { class: 'muted small mb-10' }, 'محصول را انتخاب کنید — قیمت پیشنهادی خودکار درج می‌شود و می‌توانید آن را ویرایش کنید.'),
          el('div', { class: 'tbl-wrap mb-10' }, el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, el('th', {}, 'محصول'), el('th', {}, 'تعداد'), el('th', {}, 'قیمت واحد'), el('th', {}, ''))),
            linesBox)),
          el('button', { class: 'btn sm mb-10', onclick: addLine }, '＋ افزودن ردیف'),
          el('div', { class: 'field' }, el('label', { class: 'small' }, 'توضیحات'), notesIn));
      } catch (e) { clear(body); body.append(el('div', { class: 'alert danger' }, e.message)); }
    })();
  }

  // ---------- complaints ----------
  async function loadComplaints(box) {
    clear(box);
    const top = el('div', { class: 'flex between mb-10' }, el('span', { class: 'muted small' }, 'شکایات ثبت‌شده شما'), el('button', { class: 'btn sm gold', onclick: () => complaintForm(() => loadComplaints(box)) }, '＋ ثبت شکایت'));
    box.append(el('div', { class: 'card' }, el('div', { class: 'card-b' }, top, el('div', { class: 'skel', style: 'height:120px' }))));
    try {
      const { items } = await papi('/api/portal/complaints');
      const body = box.querySelector('.card-b');
      const sk = body.querySelector('.skel'); if (sk) sk.remove();
      if (!items.length) return body.append(emptyState('شکایتی ثبت نشده است.'));
      const rows = items.map(o => el('tr', {},
        el('td', { dir: 'ltr' }, o.number || ('#' + o.id)),
        el('td', {}, o.subject || '—'),
        el('td', {}, FAMILY_FA[o.defect_family] || o.defect_type || '—'),
        el('td', {}, PRIORITY_FA[o.priority] || o.priority || '—'),
        el('td', {}, fmtDate(o.created_at)),
        el('td', {}, el('span', { class: 'badge ' + (o.status === 'resolved' || o.status === 'closed' ? 'green' : o.status === 'rejected' ? 'red' : 'gold') }, COMP_STATUS_FA[o.status] || o.status || '—'))));
      body.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, 'شماره'), el('th', {}, 'موضوع'), el('th', {}, 'نوع عیب'), el('th', {}, 'شدت'), el('th', {}, 'تاریخ'), el('th', {}, 'وضعیت'))),
        el('tbody', {}, rows))));
    } catch (e) { const sk = box.querySelector('.skel'); if (sk) sk.remove(); box.querySelector('.card-b').append(el('div', { class: 'alert danger' }, e.message)); }
  }
  function complaintForm(onDone) {
    (async () => {
      const body = el('div', { class: 'skel', style: 'height:140px' });
      const ov = openModal('ثبت شکایت جدید', body, { large: true, footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!subjectIn.value.trim()) return toast('موضوع شکایت الزامی است', 'err');
          footerBtn2.disabled = true;
          try {
            const r = await papi('/api/portal/complaints', 'POST', {
              subject: subjectIn.value.trim(), description: descIn.value.trim(),
              defect_family: famSel.value, defect_type: typeSel.value,
              product_id: prodSel.value ? Number(prodSel.value) : null,
              priority: priSel.value,
            });
            toast('شکایت شما ثبت شد (شماره: ' + r.complaint_id + ')', 'ok');
            ov.close(); onDone && onDone();
          } catch (e) { toast(e.message, 'err'); footerBtn2.disabled = false; }
        } }, 'ثبت شکایت')
      ]});
      const footerBtn2 = ov.modal.querySelector('.m-f .btn.primary');
      try {
        const [dt, pr] = await Promise.all([papi('/api/portal/defect-types'), papi('/api/portal/products')]);
        clear(body);
        const famSel = el('select', {});
        famSel.append(el('option', { value: '' }, '— انتخاب کنید —'));
        Object.entries(FAMILY_FA).forEach(([v, l]) => famSel.append(el('option', { value: v }, l)));
        const typeSel = el('select', {});
        const fillTypes = async () => {
          typeSel.innerHTML = '';
          if (!famSel.value) return;
          const r = await papi('/api/portal/defect-types?family=' + encodeURIComponent(famSel.value));
          typeSel.append(el('option', { value: '' }, '— ویژگی مورد شکایت —'));
          (r.items || []).forEach(x => typeSel.append(el('option', { value: x.defect_fa }, x.defect_fa)));
        };
        famSel.addEventListener('change', fillTypes);
        const prodSel = el('select', {});
        prodSel.append(el('option', { value: '' }, '— محصول مرتبط (اختیاری) —'));
        (pr.items || []).forEach(p => prodSel.append(el('option', { value: p.id }, p.name + (p.code ? ' (' + p.code + ')' : ''))));
        const subjectIn = el('input', { placeholder: 'موضوع شکایت' });
        const descIn = el('input', { placeholder: 'شرح دقیق مشکل (ابعاد، کد بارکد، شرایط و…)' });
        const priSel = el('select', {});
        Object.entries(PRIORITY_FA).forEach(([v, l]) => priSel.append(el('option', { value: v }, l)));
        priSel.value = 'medium';
        body.append(
          el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'خانواده محصول'), famSel),
          el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'ویژگی مورد شکایت (نوع عیب)'), typeSel),
          el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'محصول مرتبط (اختیاری)'), prodSel),
          el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'موضوع *'), subjectIn),
          el('div', { class: 'field mb-10' }, el('label', { class: 'small' }, 'شرح مشکل'), descIn),
          el('div', { class: 'field' }, el('label', { class: 'small' }, 'شدت مشکل'), priSel));
      } catch (e) { clear(body); body.append(el('div', { class: 'alert danger' }, e.message)); }
    })();
  }

  // ---------- messages ----------
  async function loadMessages(box) {
    clear(box);
    box.append(el('div', { class: 'card mb-16' },
      el('div', { class: 'card-h' }, el('h3', {}, 'ارسال پیام به شرکت')),
      el('div', { class: 'card-b' },
        el('div', { class: 'flex wrap mb-10', style: 'gap:8px' },
          el('div', { class: 'field' }, el('label', { class: 'muted small' }, 'پلتفرم'), (function () {
            const s = el('select', {});
            Object.entries(CHANNEL_FA).forEach(([v, l]) => s.append(el('option', { value: v }, l)));
            return s;
          })()),
          el('div', { class: 'field', style: 'flex:1; min-width:260px' }, el('label', { class: 'muted small' }, 'متن پیام'), el('input', { id: 'p-msg-body', placeholder: 'پیام خود را بنویسید…' }))),
        el('div', { class: 'flex wrap mb-10' }, (function () {
          const b = el('button', { class: 'btn primary sm', onclick: async (e) => {
            e.target.disabled = true;
            try {
              const r = await papi('/api/portal/messages', 'POST', { channel: box.querySelector('select').value, body: box.querySelector('#p-msg-body').value.trim() });
              toast('پیام شما ثبت شد و به تیم مربوطه ارسال می‌شود.', 'ok');
              box.querySelector('#p-msg-body').value = '';
              loadMessages(box);
            } catch (er) { toast(er.message, 'err'); e.target.disabled = false; }
          } }, '📨 ارسال پیام');
          return b;
        })()))));
    box.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'تاریخچه پیام‌ها')), el('div', { class: 'card-b' }, el('div', { class: 'skel', style: 'height:80px' }))));
    try {
      const { items } = await papi('/api/portal/messages');
      const body = box.querySelector('.card:last-child .card-b');
      const sk = body.querySelector('.skel'); if (sk) sk.remove();
      if (!items.length) return body.append(emptyState('پیامی ثبت نشده است.'));
      body.append(...items.map(m => el('div', { class: 'card mb-10' },
        el('div', { class: 'flex between small' }, el('span', { class: 'badge ' + (m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'gold') }, CHANNEL_FA[m.channel] || m.channel), el('span', { class: 'muted' }, fmtDate(m.created_at, { time: true }))),
        el('div', { class: 'small', style: 'margin-top:6px; line-height:1.9' }, m.body || ''))));
    } catch (e) { const sk = box.querySelector('.card:last-child .card-b .skel'); if (sk) sk.remove(); box.querySelector('.card:last-child .card-b').append(el('div', { class: 'alert danger' }, e.message)); }
  }
}
