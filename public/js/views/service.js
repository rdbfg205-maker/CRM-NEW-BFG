'use strict';
import { api, t, fmtNum, fmtMoney, fmtDate, faDigits, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, tabs, emptyState } from '../ui.js';
import { ResourceView, iconBtn } from '../resource-view.js';
import { helpBtn } from './help.js';

export function complaintsView(c) {
  const v = new ResourceView({ res: 'complaint', title: 'شکایات', quickAction: 'شکایت جدید', hideColumns: ['description'], extraColumns: [] });
  c.append(v.root);
}
export function ticketsView(c) {
  const v = new ResourceView({ res: 'ticket', title: 'تیکت‌های خدمات', quickAction: 'تیکت جدید' });
  c.append(v.root);
}
export async function complaintDetail(c, id) {
  let comp;
  try { comp = (await api.get('/api/r/complaint/' + id)).item; } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  const cust = comp.customer_id ? await api.get('/api/r/customer/' + comp.customer_id).then(r => r.item).catch(() => null) : null;
  const prioCls = { low: 'green', medium: 'gold', high: 'orange', critical: 'red' }[comp.priority] || '';
  const slaOver = comp.due_at && !['resolved', 'closed', 'rejected'].includes(comp.status) && new Date(comp.due_at) < new Date();
  c.append(el('div', { class: 'page-head' },
    el('a', { class: 'btn sm ghost', href: '#/complaints' }, '→ شکایات'),
    el('div', {}, el('h1', {}, comp.subject), el('div', { class: 'sub' }, (comp.number || '') + ' • ' + (cust ? cust.name : '') + ' • ' + fmtDate(comp.created_at, { time: true }))),
    el('div', { class: 'actions' },
      helpBtn('complaints'),
      el('span', { class: 'badge ' + prioCls }, 'اولویت: ' + statusFa(comp.priority)),
      el('span', { class: 'badge ' + (slaOver ? 'red' : 'green') }, slaOver ? 'از SLA عبور کرده' : 'SLA: ' + (comp.due_at ? fmtDate(comp.due_at, { time: true }) : '—')),
      el('button', { class: 'btn sm gold', onclick: () => statusMenu() }, 'وضعیت را تغییر بده'))));
  if (slaOver) c.append(el('div', { class: 'alert danger' }, '⚠ این شکایت از زمان مجاز SLA عبور کرده و به‌صورت خودکار ارتقا داده شده است. رسیدگی فوری توصیه می‌شود.'));
  // SLA progress
  if (comp.due_at) {
    const start = new Date(comp.created_at).getTime();
    const end = new Date(comp.due_at).getTime();
    const done = (['resolved', 'closed', 'rejected'].includes(comp.status) && comp.resolved_at) ? new Date(comp.resolved_at).getTime() : Date.now();
    const pct = Math.min(100, Math.max(0, ((done - start) / (end - start)) * 100));
    c.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-b flex', style: 'gap:14px; align-items:center' },
      el('b', { class: 'small' }, 'زمان SLA:'),
      el('div', { class: 'progress grow' }, el('div', { style: `width:${pct}%; background:${pct >= 100 ? 'var(--danger)' : pct >= 75 ? 'var(--warn)' : 'var(--success)'}` })),
      el('span', { class: 'small muted' }, faDigits(Math.round(pct)) + '٪'))));
  }
  const grid = el('div', { class: 'grid g-2 mb-16' });
  c.append(grid);
  grid.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'شرح شکایت')),
    el('div', { class: 'card-b' },
      el('div', { style: 'line-height:2.1; white-space:pre-wrap; font-size:13.5px' }, comp.description || '—'),
      el('dl', { class: 'kv mt-16' },
        el('dt', {}, 'منبع'), el('dd', {}, statusFa(comp.source)),
        el('dt', {}, 'دسته'), el('dd', {}, statusFa(comp.category)),
        el('dt', {}, 'مسئول'), el('dd', {}, comp.assigned_to_name || '—'),
        el('dt', {}, 'واحد'), el('dd', {}, comp.department || '—')))));
  grid.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, '🤖 تحلیل هوشمند')),
    el('div', { class: 'card-b' },
      el('dl', { class: 'kv' },
        el('dt', {}, 'احساسات متن'), el('dd', {}, comp.sentiment_score !== null && comp.sentiment_score !== undefined ? ((comp.sentiment_score < 0 ? 'منفی' : comp.sentiment_score > 0 ? 'مثبت' : 'خنثی') + ' (' + comp.sentiment_score + ')') : '—'),
        el('dt', {}, 'دسته‌بندی AI'), el('dd', {}, comp.ai_category || '—'),
        el('dt', {}, 'شکایت تکراری'), el('dd', {}, comp.repeat_of ? 'بله (از #' + comp.repeat_of + ')' : 'خیر')),
      comp.ai_root_cause ? el('div', { class: 'alert gold mt-16 small' }, 'علت ریشه‌ای محتمل: ' + comp.ai_root_cause) : null,
      (comp.status === 'resolved' || comp.status === 'closed') ? csatBox() : null)));
  // timeline
  const tlBox = el('div', { class: 'card mb-16' }, el('div', { class: 'card-h' }, el('h3', {}, 'رویدادها و تغییرات وضعیت')));
  c.append(tlBox);
  loadTimeline();
  // comments
  const cmBox = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'پیگیری و نظرات')));
  c.append(cmBox);
  loadComments();
  async function loadTimeline() {
    tlBox.innerHTML = '';
    tlBox.append(el('div', { class: 'card-h' }, el('h3', {}, 'رویدادها و تغییرات وضعیت')));
    try {
      const { items } = await api.get(`/api/r/complaint/${id}/activities`);
      if (!items.length) return tlBox.append(el('div', { class: 'card-b muted small' }, 'رویدادی ثبت نشده است.'));
      tlBox.append(el('div', { class: 'card-b' }, el('div', { class: 'timeline' }, items.map(a => el('div', { class: 'tl-item' }, el('div', { class: 'tl-t' }, a.summary), el('div', { class: 'tl-d' }, (a.full_name ? a.full_name + ' — ' : '') + fmtDate(a.created_at, { time: true })))))));
    } catch (e) { tlBox.append(el('div', { class: 'card-b alert danger' }, e.message)); }
  }
  async function loadComments() {
    cmBox.innerHTML = '';
    cmBox.append(el('div', { class: 'card-h' }, el('h3', {}, 'پیگیری و نظرات')));
    const input = el('textarea', { placeholder: 'نتیجه پیگیری یا توضیح بنویسید…' });
    const btn = el('button', { class: 'btn primary sm', onclick: async () => {
      if (!input.value.trim()) return;
      try { await api.post(`/api/r/complaint/${id}/comments`, { body: input.value }); input.value = ''; loadComments(); } catch (e) { toast(e.message, 'err'); }
    } }, t('send'));
    cmBox.append(el('div', { class: 'card-b flex' }, input, btn));
    try {
      const { items } = await api.get(`/api/r/complaint/${id}/comments`);
      if (items.length) cmBox.append(el('div', { class: 'card-b' }, items.map(cm => el('div', { class: 'mb-10 small' }, el('b', {}, cm.full_name), ' — ', el('span', { class: 'muted' }, fmtDate(cm.created_at, { time: true })), el('div', { class: 'mt-10' }, cm.body)))));
    } catch {}
  }
  function csatBox() {
    const box = el('div', { class: 'mt-16' });
    box.append(el('b', { class: 'small' }, 'رضایت مشتری (CSAT): '));
    for (let i = 5; i >= 1; i--) {
      box.append(el('button', { class: 'btn sm' + (comp.csat === i ? ' gold' : ''), onclick: async () => {
        try { await api.put('/api/r/complaint/' + id, { csat: i }); comp.csat = i; csatBox(); loadTimeline(); toast('ثبت شد', 'ok'); } catch (e) { toast(e.message, 'err'); }
      } }, faDigits(i) + ' ★'));
    }
    return box;
  }
  async function statusMenu() {
    const statuses = [
      ['new', 'جدید'], ['in_progress', 'در حال بررسی'], ['waiting', 'در انتظار'],
      ['resolved', 'حل‌شده'], ['closed', 'بسته‌شده'], ['rejected', 'ردشده'],
    ];
    const sel = el('select', {});
    for (const [v, l] of statuses) sel.append(el('option', { value: v, selected: comp.status === v ? '' : null }, l));
    const assignee = el('select', {});
    try {
      const { items } = await api.get('/api/admin/users?per_page=100');
      assignee.append(el('option', { value: '' }, '— بدون تغییر —'));
      for (const u of items.items) assignee.append(el('option', { value: u.id, selected: comp.assigned_to === u.id ? '' : null }, u.full_name));
    } catch {}
    const note = el('input', { placeholder: 'توضیح تغییر (اختیاری)' });
    openModal('تغییر وضعیت شکایت', el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'وضعیت'), sel),
      el('div', { class: 'field' }, el('label', {}, 'مسئول'), assignee),
      el('div', { class: 'field' }, el('label', {}, 'توضیح'), note)),
      { footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          const body = { status: sel.value };
          if (assignee.value) body.assigned_to = Number(assignee.value);
          try {
            await api.put('/api/r/complaint/' + id, body);
            toast('به‌روزرسانی شد', 'ok'); ov.close();
            location.reload();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ] });
  }
}
