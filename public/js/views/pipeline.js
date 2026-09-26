'use strict';
import { api, t, fmtMoney, fmtDate, faDigits, statusFa } from '../core.js';
import { el, clear, toast, openModal, confirmDialog } from '../ui.js';
import { ResourceView } from '../resource-view.js';
import { customerSelect } from '../customer-select.js';
import { helpBtn } from './help.js';

export async function pipelineBoard(c) {
  const state = { pipeline: 1, stage: null };
  const head = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'Pipeline فروش'), el('div', { class: 'sub' }, 'کشیدن و رها کردن فرصت‌ها بین مراحل')),
    el('div', { class: 'actions' },
      helpBtn('pipeline'),
      el('select', { id: 'pipe-sel', style: 'width:auto' }),
      el('button', { class: 'btn', onclick: () => stagesManager() }, '⚙ مدیریت مراحل'),
      el('button', { class: 'btn gold', onclick: () => newOpp() }, '＋ فرصت جدید')));
  const board = el('div', { class: 'kanban' });
  c.append(head, board);
  const sel = head.querySelector('#pipe-sel');
  const { items: pipes } = await api.get('/api/r/pipeline?per_page=50');
  if (!pipes.length) { board.append(el('div', { class: 'empty' }, 'Pipeline تعریف نشده است. از مدیریت ← Workflow و تنظیمات بسازید.')); return; }
  for (const p of pipes) sel.append(el('option', { value: p.id, selected: p.is_default ? '' : null }, p.name));
  sel.value = pipes.find(p => p.is_default)?.id || pipes[0].id;
  sel.addEventListener('change', () => { state.pipeline = Number(sel.value); load(); });
  state.pipeline = Number(sel.value);
  async function load() {
    board.innerHTML = '';
    board.append(el('div', { class: 'skel', style: 'height:300px' }));
    let data;
    try { data = await api.get(`/api/pipeline/${state.pipeline}/board`); } catch (e) { clear(board).append(el('div', { class: 'alert danger' }, e.message)); return; }
    clear(board);
    for (const col of data.stages) {
      const body = el('div', { class: 'k-body' });
      const colEl = el('div', { class: 'kb-col', 'data-stage': col.stage.id },
        el('div', { class: 'k-h' }, el('span', { class: 'dot-status', style: 'background:' + (col.stage.color || '#c9a227') }), col.stage.name, el('span', { class: 'cnt' }, faDigits(col.items.length))),
        body);
      for (const o of col.items) body.append(card(o));
      colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('drag-over'); });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
      colEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        colEl.classList.remove('drag-over');
        const oppId = e.dataTransfer.getData('text/opp');
        if (!oppId) return;
        await move(Number(oppId), col.stage.id);
      });
      board.append(colEl);
    }
  }
  function card(o) {
    const fuOverdue = o.next_followup_at && new Date(o.next_followup_at) < new Date();
    const n = el('div', { class: 'kb-card', draggable: '', 'data-id': o.id },
      el('div', { class: 'k-title' }, o.title),
      el('div', { class: 'k-cust' }, o.customer_name || '—'),
      el('div', { class: 'k-dates small muted', style: 'display:flex; flex-wrap:wrap; gap:8px; padding:0 10px; margin-top:4px' },
        o.created_at ? el('span', {}, 'ایجاد: ' + fmtDate(o.created_at)) : null,
        o.updated_at ? el('span', {}, 'تغییر: ' + fmtDate(o.updated_at)) : null,
        o.next_followup_at ? el('span', { class: fuOverdue ? 'red' : 'gold', style: fuOverdue ? 'color:#c0392b;font-weight:700' : 'color:#c9a227;font-weight:700' }, '⏰ پیگیری: ' + fmtDate(o.next_followup_at, { time: true }) + (fuOverdue ? ' (عقب‌افتاده)' : '')) : null),
      el('div', { class: 'k-foot' },
        o.salesperson_name ? el('span', {}, '👤 ' + o.salesperson_name) : null,
        o.probability ? el('span', { class: 'badge gold' }, faDigits(o.probability) + '٪') : null,
        el('span', { class: 'k-amt' }, fmtMoney(o.amount))));
    n.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/opp', String(o.id)); n.classList.add('dragging'); });
    n.addEventListener('dragend', () => n.classList.remove('dragging'));
    n.addEventListener('click', () => openOpp(o));
    return n;
  }
  async function move(oppId, stageId) {
    try {
      const r = await api.post('/api/pipeline/move', { opportunity_id: oppId, stage_id: stageId });
      if (r.won) toast('🎉 فرصت فروش موفق شد!', 'ok');
      if (r.lost) toast('فرصت ناموفق ثبت شد', '');
      load();
    } catch (e) { toast(e.message, 'err'); }
  }
  function openOpp(o) {
    const items = el('div');
    api.get(`/api/r/opportunity/${o.id}/items`).then(({ items: its }) => {
      clear(items);
      if (!its.length) return;
      const head = el('tr', {}, el('th', {}, 'محصول'), el('th', {}, 'تعداد'), el('th', {}, 'قیمت'), el('th', {}, 'جمع'));
      const rows = its.map(it => {
        const lt = it.qty * it.price * (1 - (it.discount_pct || 0) / 100);
        return el('tr', {}, el('td', {}, it.name), el('td', {}, faDigits(it.qty)), el('td', { class: 'num' }, fmtMoney(it.price)), el('td', { class: 'num' }, fmtMoney(lt)));
      });
      const tbl = el('table', { class: 'tbl small' }, el('thead', {}, head), el('tbody', {}, rows));
      items.append(el('div', { class: 'tbl-wrap mt-10' }, tbl));
    }).catch(() => {});
    const note = el('textarea', { placeholder: 'یادداشت…', value: o.notes || '' });
    const kv = el('dl', { class: 'kv' },
      el('dt', {}, 'مشتری'), el('dd', {}, o.customer_name || '—'),
      el('dt', {}, 'مبلغ'), el('dd', {}, fmtMoney(o.amount)),
      el('dt', {}, 'احتمال'), el('dd', {}, faDigits(o.probability) + '٪'),
      el('dt', {}, 'مسئول'), el('dd', {}, o.salesperson_name || '—'),
      el('dt', {}, 'تاریخ ایجاد'), el('dd', {}, o.created_at ? fmtDate(o.created_at) : '—'),
      el('dt', {}, 'آخرین تغییر (مرحله)'), el('dd', {}, o.updated_at ? fmtDate(o.updated_at) : '—'));
    if (o.next_followup_at) kv.append(el('dt', {}, 'پیگیری بعدی'), el('dd', { style: 'color:#c9a227;font-weight:700' }, fmtDate(o.next_followup_at, { time: true })));
    if (o.expected_close_at) kv.append(el('dt', {}, 'سررسید'), el('dd', {}, fmtDate(o.expected_close_at)));
    if (o.competitors) kv.append(el('dt', {}, 'رقبا'), el('dd', {}, o.competitors));
    openModal('فرصت: ' + o.title, el('div', {}, kv, items, el('label', { class: 'small muted mt-16' }, 'یادداشت'), note),
      { footer: [
        el('a', { class: 'btn', href: '#/opportunities/' + o.id }, 'ویرایش کامل'),
        el('button', { class: 'btn primary', onclick: async () => {
          try { await api.put('/api/r/opportunity/' + o.id, { notes: note.value }); toast('ذخیره شد', 'ok'); ov.close(); } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ] });
  }
  function newOpp() {
    const meta = window.__meta().then(m => m);
    const title = el('input', { placeholder: 'عنوان فرصت' });
    const cust = customerSelect({});
    const amount = el('input', { type: 'number', placeholder: 'مبلغ (ریال)', dir: 'ltr' });
    const prob = el('input', { type: 'number', value: 30, placeholder: 'احتمال %', dir: 'ltr' });
    const close = el('input', { type: 'date' });
    meta.then(async (m) => {
      try {
        const stages = await api.get('/api/r/pipeline_stages?per_page=100');
        const stageSel = el('select', {});
        for (const st of stages.items.filter(s2 => s2.pipeline_id === state.pipeline)) stageSel.append(el('option', { value: st.id }, st.name));
        body.append(el('div', { class: 'field' }, el('label', {}, 'مرحله'), stageSel));
        body._stage = stageSel;
      } catch {}
    });
    const body = el('div', { class: 'form-grid' },
      el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'عنوان'), title),
      el('div', { class: 'field' }, el('label', {}, 'مشتری'), cust),
      el('div', { class: 'field' }, el('label', {}, 'مبلغ (ریال)'), amount),
      el('div', { class: 'field' }, el('label', {}, 'احتمال (%)'), prob),
      el('div', { class: 'field' }, el('label', {}, 'تاریخ احتمالی'), close));
    const ov = openModal('فرصت فروش جدید', body, { footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: async () => {
        if (!title.value.trim() || !cust.value) return toast('عنوان و مشتری الزامی است', 'err');
        try {
          const stage = body._stage ? body._stage.value : null;
          const r = await api.post('/api/r/opportunity', { title: title.value, customer_id: Number(cust.value), amount: Number(amount.value) || 0, probability: Number(prob.value) || 20, pipeline_id: state.pipeline, stage_id: stage ? Number(stage) : null, expected_close_at: close.value ? new Date(close.value + 'T12:00:00').toISOString() : null });
          toast('فرصت ایجاد شد', 'ok'); ov.close(); load();
        } catch (e) { toast(e.message, 'err'); }
      } }, t('save')),
    ] });
  }
  function stagesManager() {
    const box = el('div', { class: 'skel', style: 'height:140px' });
    const ov = openModal('مدیریت مراحل Pipeline', el('div', {}, box), { large: true });
    (async () => {
      try {
        const { items: stages } = await api.get('/api/r/pipeline_stages?per_page=100');
        const mine = stages.filter(s => s.pipeline_id === state.pipeline).sort((a, b) => a.position - b.position);
        const { items: opps } = await api.get('/api/r/opportunity?per_page=500');
        clear(box);
        box.append(el('div', { class: 'muted small', style: 'padding:6px 2px' },
          'ترتیب، نام، رنگ و احتمال هر مرحله را ویرایش کنید. مرحلهٔ ۱ پیش‌فرض ورود فرصت‌های جدید است.'));
        const list = el('div', { style: 'max-height:400px; overflow:auto' });
        box.append(list, el('div', { class: 'flex between mt-16' },
          el('span', { class: 'muted small' }, 'جملهٔ «موفق»/«ناموفق» رفتار پایانی مرحله را تعیین می‌کند.'),
          el('button', { class: 'btn primary sm', onclick: () => {
            const name = el('input', { placeholder: 'نام مرحلهٔ جدید (مثلاً: پیش‌فاکتور)' });
            const color = el('input', { type: 'color', value: '#2a9d8f' });
            const prob = el('input', { type: 'number', placeholder: 'احتمال %', dir: 'ltr', value: 50 });
            let ov2 = null;
            ov2 = openModal('مرحلهٔ جدید', el('div', { class: 'form-grid' },
              el('div', { class: 'field' }, el('label', {}, 'نام'), name),
              el('div', { class: 'field' }, el('label', {}, 'رنگ'), color),
              el('div', { class: 'field' }, el('label', {}, 'احتمال موفقیت (%)'), prob)),
              { footer: [el('button', { class: 'btn', onclick: () => ov2.close() }, t('cancel')),
                el('button', { class: 'btn primary', onclick: async () => {
                  if (!name.value.trim()) return toast('نام الزامی است', 'err');
                  try {
                    await api.post('/api/r/pipeline_stages', { pipeline_id: state.pipeline, name: name.value.trim(), position: mine.length + 1, color: color.value, probability: Number(prob.value) || null });
                    toast('مرحله اضافه شد', 'ok'); ov2.close(); fill();
                  } catch (e) { toast(e.message, 'err'); }
                } }, t('save'))]
              }
            );
          } }, '＋ مرحلهٔ جدید')));
        async function fill() {
          const { items: st2 } = await api.get('/api/r/pipeline_stages?per_page=100');
          const cur = st2.filter(s => s.pipeline_id === state.pipeline).sort((a, b) => a.position - b.position);
          clear(list);
          cur.forEach((s, i) => {
            const count = opps.filter(o => o.stage_id === s.id && !['won', 'lost'].includes(o.status)).length;
            const nameIn = el('input', { value: s.name, style: 'flex:1' });
            const colorIn = el('input', { type: 'color', value: s.color || '#c9a227' });
            const probIn = el('input', { type: 'number', dir: 'ltr', placeholder: '—', value: s.probability !== null && s.probability !== undefined ? s.probability : '' });
            const row = el('div', { class: 'flex', style: 'gap:8px; padding:8px 4px; border-top:1px solid var(--border); align-items:center', 'data-sid': s.id });
            row.append(el('b', { class: 'small', style: 'width:26px; text-align:center' }, faDigits(i + 1)),
              colorIn, nameIn, probIn,
              el('span', { class: 'badge ' + (s.is_won ? 'green' : s.is_lost ? 'red' : '') }, s.is_won ? 'موفق' : s.is_lost ? 'ناموفق' : count + ' فرصت'));
            const acts = el('div', { class: 'row-act', style: 'display:flex; gap:2px' });
            acts.append(iconBtn('up', 'بالا', async () => { if (i === 0) return; await reorder(cur, i, -1); }));
            acts.append(iconBtn('down', 'پایین', async () => { if (i === cur.length - 1) return; await reorder(cur, i, 1); }));
            acts.append(iconBtn('check', 'ذخیرهٔ این مرحله', async () => {
              try {
                await api.put('/api/r/pipeline_stages/' + s.id, { name: nameIn.value.trim() || s.name, color: colorIn.value, probability: probIn.value === '' ? null : Number(probIn.value) });
                toast('ذخیره شد', 'ok'); fill(); load();
              } catch (e) { toast(e.message, 'err'); }
            }));
            acts.append(iconBtn('flag', s.is_won ? 'رفع نشان «موفق»' : 'تعیین مرحلهٔ موفق', async () => {
              try {
                if (!s.is_won) { for (const o of cur) if (o.is_won) await api.put('/api/r/pipeline_stages/' + o.id, { is_won: 0 }); }
                await api.put('/api/r/pipeline_stages/' + s.id, { is_won: s.is_won ? 0 : 1 });
                fill(); load();
              } catch (e) { toast(e.message, 'err'); }
            }));
            acts.append(iconBtn('trash', 'حذف مرحله', async () => {
              if (count > 0) return toast('این مرحله ' + faDigits(count) + ' فرصت فعال دارد؛ ابتدا فرصت‌ها را به مرحلهٔ دیگر منتقل کنید.', 'err');
              if (!(await confirmDialog('حذف مرحله', '«' + s.name + '» حذف شود؟', 'حذف', true))) return;
              try { await api.del('/api/r/pipeline_stages/' + s.id + '?hard=1'); toast('حذف شد', 'ok'); fill(); load(); } catch (e) { toast(e.message, 'err'); }
            }));
            row.append(acts);
            list.append(row);
          });
        }
        async function reorder(cur, i, dir) {
          const a = cur.slice();
          [a[i], a[i + dir]] = [a[i + dir], a[i]];
          try {
            for (let k = 0; k < a.length; k++) await api.put('/api/r/pipeline_stages/' + a[k].id, { position: k + 1 });
            fill(); load();
          } catch (e) { toast(e.message, 'err'); }
        }
        fill();
      } catch (e) { clear(box).append(el('div', { class: 'alert danger' }, e.message)); }
    })();
  }
  load();
}
