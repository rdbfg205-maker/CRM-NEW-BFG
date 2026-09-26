'use strict';
import { api, t, fmtNum, faDigits, fmtDate, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState, exportMenu } from '../ui.js';
import { ResourceView, iconBtn } from '../resource-view.js';
import { helpBtn } from './help.js';

export function requestsView(c) {
  const v = new ResourceView({ res: 'lab_request', title: 'درخواست‌های آزمایش', quickAction: 'درخواست جدید', hideColumns: ['notes'] });
  v._afterSave = () => {};
  c.append(v.root);
  // wrap: add "report" action row via detail
}
export async function resultsView(c) {
  const searchIn = el('input', { class: 'input', placeholder: 'جستجو (آزمون / روش / نتیجه / درخواست)…', style: 'width:320px' });
  const _ph = el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'نتایج آزمایش'), el('div', { class: 'sub' }, 'ثبت و بررسی نتایج آزمون‌ها')));
  _ph.append(el('div', { class: 'actions' }, helpBtn('lab'), exportMenu(fmt => '/api/lab/results/export?format=' + fmt + (searchIn.value.trim() ? '&q=' + encodeURIComponent(searchIn.value.trim()) : ''), 'خروجی نتایج')));
  c.append(_ph);
  let timer = null;
  searchIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), 300); });
  c.append(el('div', { class: 'mb-16' }, searchIn));
  const box = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:280px' }));
  c.append(box);
  async function load() {
    clear(box);
    box.append(el('div', { class: 'skel', style: 'height:280px' }));
    try {
      const u = new URLSearchParams({ per_page: '100', sort: 'id:desc' });
      if (searchIn.value.trim()) u.set('q', searchIn.value.trim());
      const { items } = await api.get('/api/r/lab_result?' + u.toString());
      clear(box);
    if (!items.length) return box.append(el('div', {}, emptyState('نتیجه‌ای ثبت نشده است')));
    const head = el('tr', {}, el('th', {}, 'درخواست'), el('th', {}, 'آزمون'), el('th', {}, 'روش'), el('th', {}, 'نتیجه'), el('th', {}, 'محدوده'), el('th', {}, 'وضعیت'), el('th', {}, 'تاریخ'), el('th', {}, ''));
    const reqs = await api.get('/api/r/lab_request?per_page=200');
    const rmap = Object.fromEntries(reqs.items.map(r => [r.id, r]));
    const rows = items.map(r => {
      const passBtn = (st) => el('button', { class: 'btn sm ' + (st === 'pass' ? 'primary' : 'danger'), onclick: async (e) => {
        e.stopPropagation();
        try { await api.put('/api/r/lab_result/' + r.id, { status: st }); toast('ثبت شد', 'ok'); location.reload(); } catch (er) { toast(er.message, 'err'); }
      } }, st === 'pass' ? 'مطابق' : 'نامطابق');
      return el('tr', { style: 'cursor:pointer', onclick: () => { if (rmap[r.request_id]) location.hash = '#/lab/requests'; } },
        el('td', {}, (rmap[r.request_id] || {}).number || ('#' + r.request_id)),
        el('td', {}, r.test_name), el('td', { class: 'muted' }, r.method || '—'),
        el('td', {}, (r.result_value || '—') + ' ' + (r.unit || '')),
        el('td', { class: 'muted' }, r.spec_text || '—'),
        el('td', {}, r.status === 'pending' ? el('div', { class: 'flex' }, passBtn('pass'), passBtn('fail')) : el('span', { class: 'badge ' + (r.status === 'pass' ? 'green' : 'red') }, statusFa(r.status))),
        el('td', {}, fmtDate(r.test_date || r.created_at)),
        el('td', { class: 'row-act' }, iconBtn('trash', 'حذف', async (e) => {
          e.stopPropagation();
          if (await confirmDialog('حذف نتیجه', 'این نتیجه حذف شود؟', 'حذف', true)) { try { await api.del('/api/r/lab_result/' + r.id + '?hard=1'); location.reload(); } catch (er) { toast(er.message, 'err'); } }
        })));
    });
    box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
    } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
  }
  load();
}
// lab request detail with results + report
export async function labRequestDetail(c, id) {
  let req;
  try { req = (await api.get('/api/r/lab_request/' + id)).item; } catch (e) { c.append(el('div', { class: 'alert danger' }, e.message)); return; }
  c.append(el('div', { class: 'page-head' },
    el('a', { class: 'btn sm ghost', href: '#/lab/requests' }, '→ درخواست‌ها'),
    el('div', {}, el('h1', {}, 'درخواست ' + (req.number || '#' + req.id)), el('div', { class: 'sub' }, (req.sample_desc || '') + ' • ' + statusFa(req.status) + ' • ' + (req.customer_name || ''))),
    el('div', { class: 'actions' },
      helpBtn('lab'),
      el('button', { class: 'btn sm', onclick: () => addResult() }, '＋ ثبت نتیجه'),
      ['done', 'reported'].includes(req.status) ? el('a', { class: 'btn gold sm', href: '/api/print/lab/' + id, target: '_blank' }, '🖨 گزارش آزمایشگاه (PDF)') :
      el('button', { class: 'btn gold sm', onclick: async () => {
        if (!(await confirmDialog('صدور گزارش', 'وضعیت درخواست به «گزارش‌شده» تغییر و گزارش PDF قابل چاپ می‌شود. ادامه می‌دهید؟', 'صدور'))) return;
        try { await api.post('/api/lab/' + id + '/report'); toast('گزارش صادر شد', 'ok'); location.reload(); } catch (e2) { toast(e2.message, 'err'); }
      } }, '📄 صدور گزارش'))));
  const resBox = el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, 'نتایج آزمون‌ها')));
  c.append(resBox);
  load();
  async function load() {
    resBox.innerHTML = '';
    resBox.append(el('div', { class: 'card-h' }, el('h3', {}, 'نتایج آزمون‌ها')));
    const { items } = await api.get('/api/r/lab_result?per_page=100');
    const list = items.filter(r => r.request_id === Number(id));
    if (!list.length) return resBox.append(el('div', { class: 'card-b muted small' }, 'هنوز نتیجه‌ای ثبت نشده است.'));
    const head = el('tr', {}, el('th', {}, 'آزمون'), el('th', {}, 'روش'), el('th', {}, 'نتیجه'), el('th', {}, 'محدوده مجاز'), el('th', {}, 'وضعیت'), el('th', {}, 'آزمایشگر'), el('th', {}, ''));
    const rows = list.map(r => el('tr', {},
      el('td', {}, r.test_name), el('td', { class: 'muted' }, r.method || '—'),
      el('td', {}, (r.result_value || '—') + ' ' + (r.unit || '')), el('td', { class: 'muted' }, r.spec_text || '—'),
      el('td', {}, el('span', { class: 'badge ' + (r.status === 'pass' ? 'green' : r.status === 'fail' ? 'red' : '') }, statusFa(r.status))),
      el('td', {}, r.analyst || '—'),
      el('td', { class: 'row-act' }, iconBtn('trash', 'حذف', async () => {
        if (await confirmDialog('حذف نتیجه', 'این نتیجه حذف شود؟', 'حذف', true)) { try { await api.del('/api/r/lab_result/' + r.id + '?hard=1'); load(); } catch (e) { toast(e.message, 'err'); } }
      }))));
    resBox.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), el('tbody', {}, rows))));
  }
  function addResult() {
    const name = el('input', { placeholder: 'نام آزمون (مثلاً چگالی)' });
    const method = el('input', { placeholder: 'روش (مثلاً ASTM D1621)' });
    const val = el('input', { placeholder: 'مقدار نتیجه', dir: 'ltr' });
    const unit = el('input', { placeholder: 'واحد (kg/m3)' });
    const spec = el('input', { placeholder: 'محدوده مجاز (مثلاً ۲۸±۲)' });
    const analyst = el('input', { placeholder: 'نام آزمایشگر' });
    const ov = openModal('ثبت نتیجه آزمایش', el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', {}, 'نام آزمون'), name),
      el('div', { class: 'field' }, el('label', {}, 'روش'), method),
      el('div', { class: 'field' }, el('label', {}, 'نتیجه'), val),
      el('div', { class: 'field' }, el('label', {}, 'واحد'), unit),
      el('div', { class: 'field' }, el('label', {}, 'محدوده مجاز'), spec),
      el('div', { class: 'field' }, el('label', {}, 'آزمایشگر'), analyst)),
      { footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!name.value.trim()) return toast('نام آزمون الزامی است', 'err');
          try {
            await api.post('/api/r/lab_result', { request_id: Number(id), test_name: name.value, method: method.value, result_value: val.value, unit: unit.value, spec_text: spec.value, analyst: analyst.value, status: 'pending', test_date: new Date().toISOString() });
            toast('ثبت شد', 'ok'); ov.close(); load();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ] });
  }
}
