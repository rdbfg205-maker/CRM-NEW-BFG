'use strict';
import { api, t, fmtNum, fmtMoney, fmtDate, faDigits, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState } from '../ui.js';
import { lineChart, barChart } from '../ui.js';
import { helpBtn } from './help.js';

const SUGGESTIONS = [
  'فروش این ماه چقدر بوده؟',
  'بهترین مشتریان این ماه چه کسانی هستند؟',
  'کدام مشتری‌ها در خطر ریزش هستند؟',
  'فرصت‌های فروش مهم را نشان بده.',
  'موجودی انبار چه وضعیتی دارد؟',
  'مطالبات باز چقدر است؟',
  'پیش‌بینی فروش ۳ ماه آینده',
  'گارانتی محصولات چقدر است؟',
  'ثبت مشتری شرکت آریا فوم، موبایل 09121234567، شهر شیراز',
];

export async function assistantPage(c) {
  const head = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, '🤖 دستیار هوشمند CRM'), el('div', { class: 'sub' }, 'با داده‌های واقعی سیستم گفتگو کنید — پاسخ‌ها بر اساس مجوزهای شما محدود می‌شوند')));
  head.append(el('div', { class: 'actions' }, helpBtn('ai')));
  c.append(head);
  const card = el('div', { class: 'card' });
  const msgs = el('div', { class: 'ai-msgs' });
  card.append(msgs);
  const sug = el('div', { class: 'ai-sugs' });
  card.append(sug);
  const input = el('input', { placeholder: 'سؤال خود را به فارسی بنویسید… (مثلاً: فروش این ماه چقدر بوده؟)' });
  const send = el('button', { class: 'btn primary' }, t('send'));
  card.append(el('div', { class: 'chat-input', style: 'border-radius:0 0 12px 12px' }, input, send));
  c.append(card);
  for (const s of SUGGESTIONS) {
    const b = el('button', { class: 'ai-sug' }, s);
    b.addEventListener('click', () => { input.value = s; doSend(); });
    sug.append(b);
  }
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('c')) {
    api.get('/api/r/customer/' + q.get('c')).then(r => {
      appendBot('مشتری «' + r.item.name + '» را بررسی می‌کنم. تحلیل کامل ریسک ریزش، CLV و پیشنهاد اقدام‌ها در تب «AI» پرونده او موجود است. می‌توانید سؤال خاصی بپرسید، مثلاً: «وضعیت سفارش این مشتری چیست؟»');
    }).catch(() => {});
  }
  let convId = null;
  function appendUser(text) {
    const n = el('div', { class: 'ai-bubble user' }, text);
    msgs.append(n);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function appendBot(text) {
    const n = el('div', { class: 'ai-bubble bot' }, text);
    msgs.append(n);
    msgs.scrollTop = msgs.scrollHeight;
    return n;
  }
  function typing() {
    const n = el('div', { class: 'ai-bubble bot typing' }, el('i'), el('i'), el('i'));
    msgs.append(n);
    msgs.scrollTop = msgs.scrollHeight;
    return n;
  }
  async function doSend() {
    const q2 = input.value.trim();
    if (!q2) return;
    input.value = '';
    appendUser(q2);
    const tp = typing();
    try {
      const r = await api.post('/api/ai/chat', { query: q2, conversation_id: convId });
      convId = r.conversation_id;
      tp.remove();
      appendBot(r.text);
    } catch (e) {
      tp.remove();
      appendBot('خطا: ' + e.message);
    }
  }
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
}
export async function analyticsPage(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'تحلیل‌های هوشمند (AI)'), el('div', { class: 'sub' }, 'شناسایی رفتار غیرعادی، هشدارها و پیش‌بینی‌ها از روی داده‌های واقعی')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('ai')));
  c.append(_ph);
  const grid = el('div', { class: 'grid g-2' });
  c.append(grid);
  const anomCard = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, '🚨 هشدارهای هوشمند (Anomaly Detection)')), el('div', { class: 'card-b skel', style: 'height:150px' }));
  grid.append(anomCard);
  const sumCard = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'خلاصه مدیریتی (Descriptive + Prescriptive)')), el('div', { class: 'card-b skel', style: 'height:150px' }));
  grid.append(sumCard);
  api.get('/api/ai/anomalies').then(({ items }) => {
    clear(anomCard.children[1]);
    if (!items.length) anomCard.children[1].append(el('div', { class: 'muted small' }, 'رفتار غیرعادی خاصی شناسایی نشده است. ✔'));
    for (const a of items) {
      const r = el('div', { class: 'flex between', style: 'padding:9px 0; border-top:1px solid var(--border)' });
      r.append(el('span', { class: 'small' }, el('b', {}, a.customer + ' — '), a.type + ': ' + a.detail));
      r.append(el('span', { class: 'badge ' + (a.severity === 'high' ? 'red' : 'orange') }, a.severity === 'high' ? 'بحرانی' : 'مهم'));
      anomCard.children[1].append(r);
    }
  }).catch(e => clear(anomCard.children[1]).append(el('div', { class: 'alert danger' }, e.message)));
  api.get('/api/ai/summary').then(r => {
    clear(sumCard.children[1]);
    sumCard.children[1].append(el('div', { style: 'line-height:2.1; font-size:13.5px' }, r.text));
  }).catch(e => clear(sumCard.children[1]).append(el('div', { class: 'alert danger' }, e.message)));
}
export async function forecastPage(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'پیش‌بینی فروش (AI)'), el('div', { class: 'sub' }, 'بر اساس روند و فصلی‌بودن داده‌های تاریخی')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('ai')));
  c.append(_ph);
  const card = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'روند ماهانه و پیش‌بینی ۳ ماه آینده')), el('div', { class: 'card-b skel', style: 'height:240px' }));
  c.append(card);
  const body = card.children[1];
  try {
    const r = await api.get('/api/ai/forecast?granularity=month&horizon=3');
    clear(body);
    if (!r.ok) return body.append(el('div', { class: 'alert warn' }, r.message));
    const hist = r.history.map(h => ({ label: h.key.split('-')[1] + '/' + String(h.key.split('-')[0]).slice(2), value: h.value }));
    const pred = r.prediction.map(p => ({ label: p.key.split('-')[1] + '/' + String(p.key.split('-')[0]).slice(2) + ' *', value: p.value }));
    body.append(lineChart([...hist, ...pred], { format: v => fmtNum(v / 1e6) + 'M' }));
    body.append(el('div', { class: 'alert gold small mt-16' }, 'روند شناسایی‌شده: ' + r.trend + ' — ستاره (*) پیش‌بینی است. بازه اطمینان: ±' + faDigits(Math.round(1.96 * r.rmse / 1e6)) + ' میلیون ریال.'));
    const tbl = el('table', { class: 'tbl small mt-16' },
      el('thead', {}, el('tr', {}, el('th', {}, 'ماه'), el('th', {}, 'پیش‌بینی'), el('th', {}, 'پایین‌بند'), el('th', {}, 'بالابند'))),
      el('tbody', {}, r.prediction.map(p => el('tr', {}, el('td', {}, p.key), el('td', { class: 'num' }, fmtMoney(p.value)), el('td', { class: 'num' }, fmtMoney(p.lo)), el('td', { class: 'num' }, fmtMoney(p.hi))))));
    body.append(el('div', { class: 'tbl-wrap' }, tbl));
  } catch (e) { clear(body).append(el('div', { class: 'alert danger' }, e.message)); }
}
export async function churnPage(c) {
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'ریسک ریزش مشتریان (AI)'), el('div', { class: 'sub' }, 'محاسبه بر اساس تازگی خرید، روند خرید، شکایات و مطالبات')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('ai')));
  c.append(_ph);
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(card);
  try {
    const { items } = await api.get('/api/ai/churn');
    clear(card);
    if (!items.length) return card.append(el('div', {}, emptyState('مشتری با ریسک ریزش بالا ندارید ✔')));
    const head = el('tr', {}, el('th', {}, 'مشتری'), el('th', {}, 'ریسک'), el('th', {}, 'دلایل (تحلیل AI)'));
    const rows = items.map(x => {
      const bar = el('div', { class: 'progress', style: 'width:140px' }, el('div', { style: `width:${x.score}%; background:${x.score >= 70 ? 'var(--danger)' : x.score >= 50 ? 'var(--warn)' : 'var(--gold)'}` }));
      return el('tr', { style: 'cursor:pointer', onclick: () => location.hash = '#/customers/' + x.id },
        el('td', {}, el('b', {}, x.name)),
        el('td', {}, el('div', { class: 'flex' }, bar, el('b', {}, faDigits(x.score) + '/۱۰'))),
        el('td', { class: 'small muted' }, (x.reasons || []).join('؛ ')));
    });
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
}
export async function leadsPage(c) {
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'امتیازدهی سرنخ‌ها (AI)'), el('div', { class: 'sub' }, 'Lead Score ۰–۱۰ بر اساس منبع، ارزش، تعامل و تازگی')),
    el('div', { class: 'actions' }, helpBtn('ai'), el('button', { class: 'btn gold sm', id: 'ai-rescore-btn', onclick: async (e) => { const btn = e.currentTarget; if (btn.disabled) return; btn.disabled = true; const oldLabel = btn.textContent; btn.textContent = '⏳ در حال امتیازدهی…'; try { const r = await api.post('/api/ai/leads/rescore', {}); if (r && r.ok) { toast(faDigits(r.count) + ' سرنخ امتیازدهی شد', 'ok'); clear(c); leadsPage(c); } else { toast('امتیازدهی با خطا مواجه شد', 'err'); btn.disabled = false; btn.textContent = oldLabel; } } catch (e2) { toast('امتیازدهی مجدد: ' + (e2.message || 'خطای سرور'), 'err'); console.error('rescore failed:', e2); btn.disabled = false; btn.textContent = oldLabel; } } }, '⚙ امتیازدهی مجدد'))));
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(card);
  try {
    const { items } = await api.get('/api/ai/leads');
    clear(card);
    if (!items.length) return card.append(el('div', {}, emptyState('سرنخی فعال نیست')));
    const head = el('tr', {}, el('th', {}, 'سرنخ'), el('th', {}, 'منبع'), el('th', {}, 'ارزش'), el('th', {}, 'امتیاز'), el('th', {}, 'دلایل'));
    const rows = items.map(x => {
      const bar = el('div', { class: 'progress', style: 'width:120px' }, el('div', { style: `width:${x.score}%; background:${x.score >= 70 ? 'var(--success)' : x.score >= 40 ? 'var(--gold)' : 'var(--border-2)'}` }));
      return el('tr', {},
        el('td', {}, el('b', {}, x.company || x.contact_name || ('#' + x.id)), el('div', { class: 'muted small' }, x.product_interest || '')),
        el('td', {}, statusFa(x.source)),
        el('td', { class: 'num' }, fmtMoney(x.estimated_value)),
        el('td', {}, el('div', { class: 'flex' }, bar, el('b', {}, faDigits(x.score)))),
        el('td', { class: 'small muted' }, (x.reasons || []).slice(0, 3).join('؛ ')));
    });
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
}
export async function kbPage(c) {
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'پایگاه دانش (Knowledge Base)'), el('div', { class: 'sub' }, 'اسناد شرکت برای جستجوی هوشمند RAG — PDF/متن/SOP/FAQ')),
    el('div', { class: 'actions' }, helpBtn('ai'), el('button', { class: 'btn gold sm', onclick: () => addDoc() }, '＋ سند جدید'))));
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(card);
  try {
    const { items } = await api.get('/api/ai/kb');
    clear(card);
    if (!items.length) return card.append(el('div', {}, emptyState('سندی در پایگاه دانش نیست')));
    for (const d of items) {
      const row = el('div', { class: 'flex between', style: 'padding:11px 16px; border-top:1px solid var(--border)' });
      row.append(el('div', {}, el('b', { class: 'small' }, '📄 ' + d.title), el('div', { class: 'muted small' }, (d.category || '') + ' • ' + (d.len || 0) + ' کاراکتر • ' + fmtDate(d.created_at))));
      row.append(el('button', { class: 'btn sm danger', onclick: async () => {
        if (!(await confirmDialog('حذف سند', 'این سند از پایگاه دانش حذف شود؟', 'حذف', true))) return;
        try { await api.del('/api/ai/kb/' + d.id); toast('حذف شد', 'ok'); kbPage(c); } catch (e) { toast(e.message, 'err'); }
      } }, 'حذف'));
      card.append(row);
    }
  } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
  function addDoc() {
    const title = el('input', { placeholder: 'عنوان سند' });
    const cat = el('input', { placeholder: 'دسته (اختیاری)' });
    const text = el('textarea', { placeholder: 'متن سند را اینجا بچسبانید…', style: 'min-height:160px' });
    const fileIn = el('input', { type: 'file', accept: '.txt,.md,.csv' });
    const ov = openModal('سند جدید در پایگاه دانش', el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'عنوان'), title),
      el('div', { class: 'field' }, el('label', {}, 'دسته'), cat),
      el('div', { class: 'field' }, el('label', {}, 'متن'), text),
      el('div', { class: 'field' }, el('label', {}, 'یا فایل متنی (txt/md/csv)'), fileIn)),
      { footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!title.value.trim()) return toast('عنوان الزامی است', 'err');
          let body = { title: title.value, category: cat.value, text_content: text.value };
          if (fileIn.files.length) {
            const fd = new FormData();
            fd.append('file', fileIn.files[0]);
            fd.append('title', title.value);
            try { await api.upload('/api/ai/kb', fd); toast('ثبت شد', 'ok'); ov.close(); kbPage(c); return; } catch (e) { toast(e.message, 'err'); return; }
          }
          try { await api.post('/api/ai/kb', body); toast('ثبت شد', 'ok'); ov.close(); kbPage(c); } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ] });
  }
}
