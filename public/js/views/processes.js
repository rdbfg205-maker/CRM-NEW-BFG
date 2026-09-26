'use strict';
// ============ Workflow Visual Engine — Designer + Monitor ============
// Canvas (drag/drop, zoom, pan, minimap, auto-layout, undo/redo, copy/paste,
// search, fullscreen) + node properties (action/condition/approval/signature/
// message/email/delay/wait/records) + Variable picker + Draft autosave +
// Validate/Test/Publish + Monitor (executions, steps, logs, retry/cancel) +
// My Tasks (approve/reject/sign with the real signature pad).
import { api, t, fmtDate, faDigits, statusFa, getToken } from '../core.js';
import { el, clear, toast, openModal, confirmDialog, emptyState, signaturePad } from '../ui.js';
import { helpBtn } from './help.js';

let META = null;
async function loadMeta() { if (!META) META = await api.get('/api/wf/engine/meta'); return META; }
const escSvg = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_FA = {
  pending: ['در صف', ''], running: ['در حال اجرا', 'gold'], waiting: ['در انتظار', 'gold'],
  completed: ['تکمیل‌شده', 'green'], rejected: ['رد‌شده', 'red'], terminated: ['متوقف', 'red'],
  failed: ['ناموفق', 'red'], cancelled: ['لغوشده', 'red'],
};
const stBadge = (s) => { const [l, c] = STATUS_FA[s] || [s, '']; return el('span', { class: 'badge ' + c }, l); };
const faVar = (s) => faDigits(String(s));

// ================= list page =================
export async function processesList(c) {
  c.append(el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, 'مدیریت فرآیندها — Workflow Engine'),
      el('div', { class: 'sub' }, 'طراحی Visual، ذخیره در دیتابیس و اجرای واقعی فرآیندهای CRM — رویدادمحور، با تأیید/امضا/اقدامات واقعی')),
    el('div', { class: 'actions' }, helpBtn('admin'),
      (() => {
        const wrap = el('div', { style: 'position:relative; display:inline-block' });
        const btn = el('button', { class: 'btn', title: 'خروجی از فرآیندها/اجراها (Excel یا چاپ)' }, '⬇ خروجی ▾');
        const menu = el('div', { style: 'display:none; position:absolute; top:100%; inset-inline-end:0; z-index:60; background:var(--bg,#fff); border:1px solid var(--border); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.15); min-width:230px; padding:4px; text-align:right' });
        const item = (label, url) => { const a = el('a', { class: 'btn sm', style: 'display:block; width:100%', href: url, target: url.endsWith('html') ? '_blank' : '_self' }, label); a.addEventListener('click', () => menu.style.display = 'none'); menu.append(a); };
        item('📊 Excel — فرآیندها', '/api/wf/export?scope=processes&format=xlsx');
        item('📊 Excel — اجراها', '/api/wf/export?scope=executions&format=xlsx');
        item('🖨 چاپ — فرآیندها', '/api/wf/export?scope=processes&format=html');
        item('🖨 چاپ — اجراها', '/api/wf/export?scope=executions&format=html');
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
        document.addEventListener('click', () => { menu.style.display = 'none'; });
        wrap.append(btn, menu);
        return wrap;
      })(),
      el('button', { class: 'btn gold', onclick: () => newProcessModal() }, '＋ فرآیند جدید'))));
  const card = el('div', { class: 'card' }, el('div', { class: 'skel', style: 'height:200px' }));
  c.append(card);
  try {
    const { items } = await api.get('/api/wf/processes');
    clear(card);
    if (!items.length) return card.append(el('div', {}, emptyState('فرآیندی تعریف نشده است')));
    const head = el('tr', {}, el('th', {}, 'نام'), el('th', {}, 'ماژول/رویداد'), el('th', {}, 'نسخه'), el('th', {}, 'اجرا'), el('th', {}, 'در جریان'), el('th', {}, 'وضعیت'), el('th', {}, 'عملیات'));
    const body = el('tbody');
    for (const p of items) {
      const acts = el('div', { class: 'row-act', style: 'display:flex; gap:4px' });
      acts.append(iconA('⬡', 'طراح فرآیند', () => location.hash = '#/processes/' + p.id));
      acts.append(iconA('📊', 'Monitor', () => location.hash = '#/processes/' + p.id + '?tab=monitor'));
      acts.append(iconA('⏻', p.active ? 'غیرفعال' : 'فعال', async () => {
        try { await api.post(`/api/wf/processes/${p.id}/toggle`, { active: !p.active }); toast('به‌روزرسانی شد', 'ok'); location.reload(); } catch (e) { toast(e.message, 'err'); }
      }));
      acts.append(iconA('⧉', 'تکثیر', async () => {
        try { const r = await api.post('/api/wf/processes/' + p.id + '/duplicate', {}); toast('کپی ساخته شد: ' + r.name, 'ok'); location.reload(); } catch (e) { toast(e.message, 'err'); }
      }));
      acts.append(iconA('🗑', 'حذف/آرشیو', async () => {
        if (await confirmDialog('حذف فرآیند', 'فرآیند «' + p.name + '» حذف شود؟ (در صورت داشتن تاریخچهٔ اجرا، غیرفعال/Archive می‌شود)', 'حذف', true)) {
          try { const r = await api.del('/api/wf/processes/' + p.id); toast(r.archived ? 'به‌جای حذف، غیرفعال شد (حذف‌محافظی)' : 'حذف شد', r.archived ? 'warn' : 'ok'); location.reload(); } catch (e) { toast(e.message, 'err'); }
        }
      }));
      body.append(el('tr', {},
        el('td', {}, el('b', { class: 'small' }, p.name), el('div', { class: 'muted small' }, p.description || '')),
        el('td', { class: 'small' }, p.module_fa + ' • ' + triggerFa(p.trigger_event)),
        el('td', { class: 'num small' }, faDigits(p.current_version || 1) + (p.has_draft ? ' + پیش‌نویس' : '')),
        el('td', { class: 'num' }, faDigits(p.total_executions || 0)),
        el('td', { class: 'num' }, p.running ? el('span', { class: 'badge gold' }, faDigits(p.running)) : '—'),
        el('td', {}, el('span', { class: 'badge ' + (p.active ? 'green' : 'red') }, p.active ? 'فعال' : 'غیرفعال')),
        el('td', { class: 'row-act' }, acts)));
    }
    card.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), body)));
  } catch (e) { clear(card).append(el('div', { class: 'alert danger' }, e.message)); }
  function newProcessModal() {
    const name = el('input', { placeholder: 'نام فرآیند (مثلاً: فرآیند فروش)' });
    const modSel = el('select', {});
    const trigSel = el('select', {});
    const desc = el('input', { placeholder: 'توضیح (اختیاری)' });
    loadMeta().then(m => {
      for (const x of m.modules) modSel.append(el('option', { value: x.key }, x.fa));
      for (const [v, l] of m.triggers) trigSel.append(el('option', { value: v }, l));
    }).catch(() => {});
    const ov = openModal('فرآیند جدید', el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'نام'), name),
      el('div', { class: 'field' }, el('label', {}, 'ماژول (منشأ رویداد)'), modSel),
      el('div', { class: 'field' }, el('label', {}, 'رویداد شروع (Trigger)'), trigSel),
      el('div', { class: 'field' }, el('label', {}, 'توضیح'), desc)), {
      footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!name.value.trim()) return toast('نام الزامی است', 'err');
          try {
            const r = await api.post('/api/wf/processes', { name: name.value.trim(), module: modSel.value || 'customer', description: desc.value, trigger_event: trigSel.value || 'created' });
            ov.close(); location.hash = '#/processes/' + r.id;
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save'))],
    });
  }
}
function iconA(ic, label, fn) {
  const b = el('button', { class: 'icon-btn', title: label, onclick: fn });
  b.textContent = ic; return b;
}
function triggerFa(v) {
  const m = [['created', 'ایجاد'], ['updated', 'به‌روزرسانی'], ['deleted', 'حذف'], ['stage_changed', 'تغییر مرحله'], ['status_changed', 'تغییر وضعیت'], ['approved', 'تأیید'], ['rejected', 'رد'], ['overdue', 'سررسید'], ['won', 'Won'], ['manual', 'دستی']];
  return (m.find(x => x[0] === v) || [v, v])[1];
}

// ================= designer =================
export async function processDesigner(c, id, tab = 'design') {
  let proc = null, vers = [], def = { nodes: [], edges: [] };
  let sel = null, selEdge = null, connecting = null, clipboard = null;
  let view = { x: 0, y: 0, z: 1 };
  let undoStack = [], redoStack = [], dirty = false, draftTimer = null, draftState = '—';
  let booted = false, metaReady = null;
  metaReady = loadMeta();

  const saveBtn = el('button', { class: 'btn gold', onclick: () => publish() }, '🚀 Publish');
  const valBtn = el('button', { class: 'btn', onclick: () => doValidate() }, '✔ Validate');
  const testBtn = el('button', { class: 'btn', onclick: () => testModal() }, '▶ Test');
  c.append(el('div', { class: 'page-head' },
    el('a', { class: 'btn sm ghost', href: '#/processes' }, '→ فرآیندها'),
    el('div', {}, el('h1', {}, 'در حال بارگذاری…'), el('div', { class: 'sub muted small' }, '')),
    el('div', { class: 'actions' }, helpBtn('admin'), valBtn, testBtn, saveBtn,
      el('span', { class: 'muted small', id: 'draft-ind', style: 'align-self:center' }, 'Draft: —'))));
  const head = c.children[0];
  const card = el('div', { class: 'card' });
  c.append(card);
  const draftInd = head.querySelector('#draft-ind');
  let tabBoxEl = null;
  let designerRedraw = null;

  async function boot() {
    if (booted) return; booted = true;
    const [r, m] = await Promise.all([api.get('/api/wf/processes/' + id), metaReady]);
    proc = r.process; vers = r.versions;
    const activeV = vers.find(v => v.active) || vers[0];
    def = JSON.parse(JSON.stringify(activeV ? activeV.definition : { nodes: [], edges: [] }));
    clear(head.children[1]);
    head.children[1].append(el('h1', {}, proc.name),
      el('div', { class: 'sub' }, 'ماژول: ' + proc.module_fa + ' • رویداد: ' + triggerFa(proc.trigger_event) + ' • نسخهٔ فعال: ' + faDigits(proc.current_version || 1) + (proc.active ? ' • فعال' : ' • غیرفعال')));
    const tabs = el('div', { class: 'tabs', style: 'margin:10px 0' });
    const renderTabs = () => {
      clear(tabs);
      for (const [k, l] of [['design', '⬡ طراح (Canvas)'], ['opc', '📋 جدول OPC'], ['monitor', '📊 Monitor'], ['versions', '🗂 نسخه‌ها']]) {
        tabs.append(el('div', { class: 'tab' + (tab === k ? ' active' : ''), onclick: () => { tab = k; renderTabs(); renderTab(); } }, l));
      }
    };
    renderTabs();
    tabBoxEl = el('div');
    card.append(tabs, tabBoxEl);
    const renderTab = async () => { clear(tabBoxEl); tabBoxEl.append(tab === 'design' ? await buildDesigner() : (tab === 'opc' ? buildOPC() : (tab === 'monitor' ? await buildMonitor() : buildVersions()))); };
    // exposed for the OPC table (row click → jump to that node in the designer)
    window.__wfeSwitchDesign = (nid) => { sel = nid || null; tab = 'design'; renderTabs(); renderTab(); };
    renderTab();
  }

  // ---------- undo/redo + autosave draft ----------
  function snapshot() { undoStack.push(JSON.stringify(def)); if (undoStack.length > 50) undoStack.shift(); redoStack = []; dirty = true; }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(def)); def = JSON.parse(undoStack.pop()); sel = null; if (designerRedraw) designerRedraw(); onDirty(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(def)); def = JSON.parse(redoStack.pop()); sel = null; if (designerRedraw) designerRedraw(); onDirty(); }
  function onDirty() {
    if (draftInd) draftInd.textContent = 'Draft: در انتظار…';
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      try {
        await api.put('/api/wf/processes/' + id + '/draft', { definition: def });
        if (draftInd) draftInd.textContent = 'Draft: ذخیره شد ✓ (' + new Date().toLocaleTimeString('fa-IR') + ')';
      } catch {
        if (draftInd) draftInd.textContent = 'Draft: خطا';
      }
    }, 1500);
  }
  async function publish() {
    const v = await doValidate(true);
    if (v && !v.ok) return;
    try {
      await api.put('/api/wf/processes/' + id, { definition: def, change_note: promptFa('شرح تغییر (اختیاری)') });
      toast('Publish شد — نسخهٔ جدید فعال است', 'ok');
      if (draftInd) draftInd.textContent = 'Draft: —';
      bootedListRefresh();
    } catch (e) { toast(e.message, 'err'); }
  }
  function bootedListRefresh() { api.get('/api/wf/processes/' + id).then(r => { proc = r.process; vers = r.versions; }).catch(() => {}); }
  function promptFa(ph) {
    let res; const p = new Promise(x => res = x);
    const inp = el('input', { placeholder: ph });
    const ov = openModal('ذخیره', el('div', { class: 'field' }, inp), {
      footer: [el('button', { class: 'btn primary', onclick: () => { ov.close(); res(inp.value); } }, t('save'))],
    });
    return p;
  }
  async function doValidate(silent) {
    try {
      const r = await api.post('/api/wf/processes/' + id + '/validate', {});
      if (silent) return r;
      if (r.ok) toast('تعریف معتبر است ✓', 'ok');
      else toast('خطاهای تعریف: ' + r.errors.length, 'err'), openModal('خطاهای Validate', el('div', { class: 'card-b small' }, ...r.errors.map(e => el('div', { class: 'alert danger small', style: 'margin-bottom:6px' }, '• ' + e))));
      return r;
    } catch (e) { toast(e.message, 'err'); return null; }
  }
  function testModal() {
    const selRec = el('select', {});
    const liveCh = el('input', { type: 'checkbox', style: 'width:auto' });
    const box = el('div', {});
    const ov = openModal('Test Workflow — اجرای آزمایشی', el('div', {},
      el('div', { class: 'alert info small' }, 'یک رکورد واقعی از ماژول «' + proc.module_fa + '» انتخاب کنید. در حالت تست، عملیات واقعی (ایجاد/تغییر/ارسال) انجام نمی‌شود — فقط شرایط و مسیر اجرا می‌شود.'),
      el('div', { class: 'field' }, el('label', {}, 'رکورد تست'), selRec),
      el('div', { class: 'field' }, el('label', { class: 'chk', style: 'display:flex; gap:6px' }, liveCh, 'Live Test (اجرای واقعی — فقط اگر اطمینان دارید)')), box), {
      large: true,
      footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          box.append(el('div', { class: 'muted small' }, 'در حال اجرای تست…'));
          try {
            const r = await api.post('/api/wf/processes/' + id + '/test', { entity_id: Number(selRec.value), live: liveCh.checked });
            clear(box);
            if (!r.ok) return box.append(el('div', { class: 'alert danger small' }, (r.errors || []).join(' | ')));
            box.append(el('div', { class: 'alert ' + (r.status === 'completed' ? 'ok' : 'info') + ' small' },
              'نتیجهٔ اجرا: ' + (STATUS_FA[r.status] || [r.status])[0] + ' — Execution: ' + r.execution_no + ' — وضعیت فعلی: ' + (r.current_node || '—') + ' (' + r.mode + ')'));
            box.append(el('b', { class: 'small' }, 'Trace:'));
            for (const l of (r.trace || []).reverse()) {
              box.append(el('div', { class: 'small', style: 'padding:3px 0; border-bottom:1px dashed var(--border); font-family:monospace; direction:rtl' },
                el('span', { class: 'badge ' + (l.level === 'error' ? 'red' : l.level === 'success' ? 'green' : l.level === 'warn' ? 'gold' : '') }, l.level), ' ', l.message));
            }
            if ((r.steps || []).length) {
              box.append(el('b', { class: 'small', style: 'margin-top:8px' }, 'مراحل:'));
              for (const s of r.steps) box.append(el('div', { class: 'small muted' }, '• ' + s.node + ' — ' + (STATUS_FA[s.status] || [s.status])[0] + (s.result ? ' (' + s.result + ')' : '') + (s.signed ? ' ✍ امضا شد' : '')));
            }
          } catch (e2) { clear(box); box.append(el('div', { class: 'alert danger small' }, e2.message)); }
          e.target.disabled = false;
        } }, 'اجرای Test')],
    });
    api.get('/api/r/' + proc.module + '?per_page=30').then(({ items }) => {
      selRec.append(el('option', { value: '' }, '— انتخاب کنید —'));
      for (const it of items || []) selRec.append(el('option', { value: it.id }, '#' + it.id + ' — ' + (it.name || it.number || it.subject || it.title || '')));
    }).catch(() => {});
  }

  // ================= designer canvas =================
  async function buildDesigner() {
    const wrap = el('div', { style: 'display:flex; gap:12px; flex-wrap:wrap' });
    // palette
    const pal = el('div', { style: 'width:190px; flex-shrink:0' }, el('b', { class: 'small' }, 'افزودن Node'));
    const m = await metaReady;
    const ordered = ['start', 'action', 'condition', 'approval', 'signature', 'task', 'assignment', 'notification', 'message', 'email', 'delay', 'schedule', 'wait', 'parallel', 'merge', 'create_record', 'update_record', 'end'];
    for (const ty of ordered) {
      const nt = m.nodeTypes.find(x => x.type === ty);
      if (!nt) continue;
      pal.append(el('button', { class: 'btn sm', style: 'width:100%; margin-top:5px; border-inline-start:4px solid ' + nt.color, onclick: () => addNode(nt.type) }, nt.ic + ' ' + nt.fa));
    }
    pal.append(el('div', { class: 'muted small', style: 'margin-top:10px; line-height:2' },
      el('div', {}, '• Drag & Drop / Zoom / Pan'),
      el('div', {}, '• اتصال: dot خروجی → Node مقصد'),
      el('div', {}, '• Ctrl+Z / Ctrl+Y: Undo/Redo'),
      el('div', {}, '• Ctrl+C/V: کپی/چسبند'),
      el('div', {}, '• Del: حذف Node/اتصال'),
      el('div', {}, '• Auto-save Draft فعال')));
    // toolbar
    const tool = el('div', { class: 'flex', style: 'gap:4px; flex-wrap:wrap; margin-bottom:6px' },
      tbtn('↶', 'Undo (Ctrl+Z)', undo), tbtn('↷', 'Redo (Ctrl+Y)', redo),
      tbtn('＋', 'Zoom In', () => zoomAt(1.2, canvasR())) , tbtn('－', 'Zoom Out', () => zoomAt(1 / 1.2, canvasR())),
      tbtn('⛶', 'Fit to Screen', fit), tbtn('▦', 'Auto Layout', autoLayout),
      tbtn('🔍', 'Search Node', searchModal), tbtn('⛶', 'Full Screen', fullscreen));
    // canvas
    const canvas = el('div', { id: 'wfe-canvas', style: 'position:relative; width:100%; height:560px; background:var(--surface-2); border:1px solid var(--border); border-radius:10px; overflow:hidden; cursor:grab' });
    const world = el('div', { style: 'position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform' });
    const svg = el('svg', { style: 'position:absolute; left:-1000px; top:-1000px; width:6000px; height:4000px; overflow:visible', 'data-w': 6000, 'data-h': 4000 });
    world.append(svg);
    canvas.append(world);
    const mini = el('div', { style: 'position:absolute; left:10px; bottom:10px; width:150px; height:100px; background:rgba(20,22,26,.85); border:1px solid var(--border); border-radius:6px; overflow:hidden; cursor:pointer' });
    const miniSvg = el('svg', { style: 'width:100%; height:100%' });
    mini.append(miniSvg);
    canvas.append(mini);
    wrap.append(pal, el('div', { style: 'flex:1; min-width:560px' }, tool, canvas));
    const insp = el('div', { class: 'card wfe-insp', style: 'width:100%; margin-top:12px' });
    const out = el('div', {}, wrap, insp);

    // ---- view helpers ----
    function canvasR() { const r = canvas.getBoundingClientRect(); return { cx: r.width / 2, cy: r.height / 2 }; }
    function applyView() { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; drawMini(); }
    function zoomAt(f, center) {
      const nz = Math.max(0.25, Math.min(2.5, view.z * f));
      const k = nz / view.z;
      view.x = center.cx - (center.cx - view.x) * k;
      view.y = center.cy - (center.cy - view.y) * k;
      view.z = nz; applyView();
    }
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, { cx: e.offsetX, cy: e.offsetY }); }, { passive: false });
    function fit() {
      const ns = def.nodes; if (!ns.length) return;
      const xs = ns.map(n => n.x || 0), ys = ns.map(n => n.y || 0);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 190, y1 = Math.max(...ys) + 70;
      const r = canvas.getBoundingClientRect();
      view.z = Math.min(2, Math.min(r.width / (x1 - x0), r.height / (y1 - y0)));
      view.x = (r.width - (x1 - x0) * view.z) / 2 - x0 * view.z;
      view.y = (r.height - (y1 - y0) * view.z) / 2 - y0 * view.z;
      applyView();
    }
    function autoLayout() {
      snapshot();
      // tidy layered layout: level = longest path from a start node, uniform spacing,
      // orphan nodes grouped on their own row — then fit to screen.
      const level = {};
      const starts = def.nodes.filter(n => n.type === 'start' || n.type === 'trigger');
      for (const s of (starts.length ? starts : def.nodes)) level[s.id] = 0;
      for (let i = 0; i < def.nodes.length; i++) {
        for (const e of def.edges) {
          if (level[e.from] === undefined) continue;
          level[e.to] = Math.max(level[e.to] === undefined ? 0 : level[e.to], level[e.from] + 1);
        }
      }
      const orphans = def.nodes.filter(n => level[n.id] === undefined);
      const byLevel = {};
      for (const n of def.nodes) {
        const L = level[n.id] !== undefined ? level[n.id] : (orphans.length ? orphans.length : 0);
        (byLevel[L] = byLevel[L] || []).push(n);
      }
      const XS = 250, YS = 120, X0 = 40, Y0 = 40;
      for (const L of Object.keys(byLevel)) {
        const arr = byLevel[L].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        arr.forEach((n, i) => { n.x = X0 + Number(L) * XS; n.y = Y0 + i * YS; });
      }
      onDirty(); redraw();
      setTimeout(() => fit(), 30);
    }
    function searchModal() {
      const inp = el('input', { placeholder: 'جستجوی Node (نام/نوع)…' });
      const ov = openModal('جستجوی Node', inp, {
        footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel'))],
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = inp.value.trim(); if (!q) return;
        const hit = def.nodes.find(n => (n.title || '').includes(q) || n.type.includes(q));
        ov.close();
        if (!hit) return toast('یافت نشد', 'err');
        centerOn(hit);
        sel = hit.id; draw(); renderInsp();
      });
      inp.focus();
    }
    function centerOn(n) {
      const r = canvas.getBoundingClientRect();
      view.x = r.width / 2 - (n.x + 95) * view.z;
      view.y = r.height / 2 - (n.y + 30) * view.z;
      applyView();
    }
    function fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else canvas.requestFullscreen && canvas.requestFullscreen();
    }
    function tbtn(ic, title, fn) { const b = el('button', { class: 'icon-btn', title }, ic); b.onclick = fn; return b; }

    // ---- add / delete / duplicate / copy / paste ----
    function addNode(type) {
      snapshot();
      const r = canvas.getBoundingClientRect();
      const gx = (r.width / 2 - view.x) / view.z - 95, gy = (r.height / 2 - view.y) / view.z - 30;
      const nn = {
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type,
        title: (m.nodeTypes.find(x => x.type === type) || {}).fa || type,
        x: Math.round(gx), y: Math.round(gy),
        assignee_type: (type === 'approval' || type === 'signature' || type === 'task') ? 'role' : 'none', assignee: '',
        notify: true,
      };
      if (type === 'condition') nn.condition = { logic: 'AND', conditions: [{ field: proc.module + '.status', op: 'eq', value: '' }] };
      if (type === 'action' || type === 'create_record' || type === 'update_record') nn.params = nn.params || {};
      if (type === 'delay') nn.params = { delay_value: 1, delay_unit: 'hour' };
      if (type === 'wait') nn.params = { event: '' };
      def.nodes.push(nn); sel = nn.id; draw(); renderInsp(); onDirty();
    }
    function deleteSel() {
      if (selEdge != null) { snapshot(); def.edges = def.edges.filter((e, i) => i !== selEdge); selEdge = null; draw(); onDirty(); return; }
      if (!sel) return;
      const n = def.nodes.find(x => x.id === sel);
      if (!n) return;
      if (n.type === 'start' || n.type === 'trigger' || n.type === 'end') return toast('Node شروع/پایان قابل حذف نیست', 'err');
      snapshot();
      def.nodes = def.nodes.filter(x => x.id !== sel);
      def.edges = def.edges.filter(x => x.from !== sel && x.to !== sel);
      sel = null; draw(); renderInsp(); onDirty();
    }
    function dupSel() {
      if (!sel) return;
      const n = def.nodes.find(x => x.id === sel); if (!n) return;
      snapshot();
      const copy = JSON.parse(JSON.stringify(n));
      copy.id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      copy.x = n.x + 40; copy.y = n.y + 40; copy.title = n.title + ' (کپی)';
      def.nodes.push(copy); sel = copy.id; draw(); renderInsp(); onDirty();
    }
    function copySel() { if (sel) { clipboard = JSON.parse(JSON.stringify(def.nodes.find(x => x.id === sel))); if (clipboard) toast('کپی شد', 'ok'); } }
    function pasteClip() {
      if (!clipboard) return;
      snapshot();
      const copy = JSON.parse(JSON.stringify(clipboard));
      copy.id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      copy.x = (clipboard.x || 100) + 60; copy.y = (clipboard.y || 100) + 60;
      def.nodes.push(copy); sel = copy.id; draw(); renderInsp(); onDirty();
    }
    document.addEventListener('keydown', wfeKeyHandler);
    function wfeKeyHandler(e) {
      if (!document.getElementById('wfe-canvas')) { document.removeEventListener('keydown', wfeKeyHandler); return; }
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') copySel();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') pasteClip();
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
      else if (e.key === 'Escape') { connecting = null; selEdge = null; draw(); }
    }

    // ---- draw ----
    function draw() {
      const paths = [];
      def.edges.forEach((e, i) => {
        const a = def.nodes.find(n => n.id === e.from), b = def.nodes.find(n => n.id === e.to);
        if (!a || !b) return;
        const x1 = a.x + 190, y1 = a.y + 30, x2 = b.x, y2 = b.y + 30;
        const mx = (x1 + x2) / 2;
        const col = e.label === 'true' ? '#2a9d8f' : e.label === 'false' ? '#c0392b' : e.label === 'approve' ? '#2a9d8f' : e.label === 'reject' ? '#c0392b' : e.label === 'branch' ? '#c9622a' : e.label === 'return' || e.label === 'loop' ? '#c9a227' : '#8a8f98';
        const selStyle = selEdge === i ? ' stroke-width:4' : '';
        paths.push('<path d="M' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + (x2 - 6) + ' ' + y2 + '" fill="none" stroke="' + col + '" stroke-width="2"' + selStyle + ' marker-end="url(#wfe-arr)" style="cursor:pointer" data-edge="' + i + '"/>');
        if (e.label) paths.push('<text x="' + mx + '" y="' + ((y1 + y2) / 2 - 8) + '" text-anchor="middle" font-size="11" fill="' + col + '">' + escSvg(edgeLabelFa(e.label)) + '</text>');
      });
      svg.innerHTML = '<defs><marker id="wfe-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8a8f98"/></marker></defs>' + paths.join('');
      [...world.children].forEach(ch => { if (ch.tagName === 'DIV') ch.remove(); });
      for (const n of def.nodes) {
        const nt = m.nodeTypes.find(x => x.type === n.type) || { color: '#666', ic: '?', fa: n.type };
        const isSE = n.type === 'start' || n.type === 'trigger' || n.type === 'end';
        const nd = el('div', { style: 'position:absolute; left:' + (n.x || 0) + 'px; top:' + (n.y || 0) + 'px; width:190px; background:var(--surface); border:2px solid ' + nt.color + (sel === n.id ? '; box-shadow:0 0 0 3px rgba(201,162,39,.4)' : '') + (connecting && n.id !== (def.nodes.find(x => x.id === sel) || {}).id ? '; border-style:dashed' : '') + '; border-radius:10px; padding:8px 10px; cursor:grab; user-select:none' });
        nd.append(el('div', { style: 'display:flex; align-items:center; gap:6px' },
          el('span', { class: 'badge', style: 'font-family:monospace; background:' + nt.color + '; color:#fff; min-width:26px; text-align:center' }, nt.ic),
          el('b', { class: 'small' }, n.title || nt.fa)));
        const sub = [];
        if (n.type === 'action' || n.type === 'create_record' || n.type === 'update_record') sub.push(actionFa(n));
        if (n.type === 'condition') sub.push('شرط: ' + (n.condition ? condSummary(n.condition) : '—'));
        if (n.type === 'approval' || n.type === 'signature' || n.type === 'task') sub.push(assigneeFa(n));
        if (n.type === 'message' || n.type === 'email') sub.push((n.params && n.params.channel ? n.params.channel + ' → ' : '') + (n.params && (n.params.recipient || n.params.to) || ''));
        if (n.type === 'delay' || n.type === 'schedule') sub.push(delayFa(n));
        if (n.type === 'notification') sub.push(notifFa(n));
        if (sub.length) nd.append(el('div', { class: 'muted small', style: 'margin-top:3px; max-height:34px; overflow:hidden' }, sub.join(' • ')));
        // output port
        if (!isSE || n.type !== 'end') {
          const port = el('div', { title: 'اتصال به Node دیگر (درگ یا کلیک → Node مقصد)', style: 'position:absolute; left:-9px; top:26px; width:14px; height:14px; border-radius:50%; background:' + nt.color + '; border:2px solid var(--surface); cursor:crosshair' });
          port.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); startConnect(n); });
          nd.append(port);
        }
        if (n.type === 'end') nd.style.borderStyle = 'dashed';
        nd.addEventListener('mousedown', (ev) => { if (connecting) { ev.stopPropagation(); } else startDrag(ev, n); });
        nd.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (connecting) { finishConnect(n); return; }
          sel = n.id; selEdge = null; draw(); renderInsp();
        });
        world.append(nd);
      }
      applyView();
    }
    function redraw() { draw(); }
    // connect
    function startConnect(n) { connecting = n.id; sel = n.id; draw(); toast('حالا Node مقصد را کلیک کنید (Esc = لغو)', 'ok'); }
    function finishConnect(target) {
      const from = connecting; connecting = null;
      if (!from || from === target.id) return draw();
      if (def.edges.some(e => e.from === from && e.to === target.id)) return toast('این اتصال وجود دارد', 'err');
      snapshot();
      def.edges.push({ from, to: target.id, label: defaultLabel(from) });
      draw(); renderInsp(); onDirty();
    }
    function defaultLabel(from) {
      const n = def.nodes.find(x => x.id === from);
      if (!n) return '';
      if (n.type === 'condition') return 'true';
      if (n.type === 'approval') return 'approve';
      if (n.type === 'parallel') return 'branch';
      return '';
    }
    // pan
    let panning = null;
    canvas.addEventListener('mousedown', (e) => {
      if (e.target === canvas || e.target === world || e.target.tagName === 'svg' || e.target.tagName === 'svg') {
        if (e.target.closest && e.target.closest('[data-edge]')) return;
        panning = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        canvas.style.cursor = 'grabbing';
      }
    });
    document.addEventListener('mousemove', wfeMouseMove);
    function wfeMouseMove(e) { if (panning) { view.x = panning.vx + (e.clientX - panning.sx); view.y = panning.vy + (e.clientY - panning.sy); applyView(); } }
    document.addEventListener('mouseup', () => { if (panning) { panning = null; canvas.style.cursor = 'grab'; } });
    svg.addEventListener('click', (e) => {
      const t = e.target.closest ? e.target.closest('[data-edge]') : null;
      if (t) { selEdge = Number(t.dataset.edge); sel = null; draw(); renderInsp(); }
    });
    // drag node
    let dragging = null;
    function startDrag(ev, n) {
      ev.preventDefault();
      dragging = { n, sx: ev.clientX, sy: ev.clientY, ox: n.x || 0, oy: n.y || 0, moved: false, snap: false };
    }
    document.addEventListener('mousemove', wfeDragMove);
    function wfeDragMove(e) {
      if (!dragging) return;
      const dx = (e.clientX - dragging.sx) / view.z, dy = (e.clientY - dragging.sy) / view.z;
      if (Math.abs(dx) + Math.abs(dy) > 2) { dragging.moved = true; if (!dragging.snap) { snapshot(); dragging.snap = true; } }
      if (dragging.moved) { dragging.n.x = Math.round((dragging.ox + dx) / 10) * 10; dragging.n.y = Math.round((dragging.oy + dy) / 10) * 10; draw(); }
    }
    document.addEventListener('mouseup', wfeDragUp);
    function wfeDragUp() { if (dragging) { if (dragging.moved) onDirty(); dragging = null; } }
    // minimap
    function drawMini() {
      const ns = def.nodes; if (!ns.length) { miniSvg.innerHTML = ''; return; }
      const xs = ns.map(n => n.x || 0), ys = ns.map(n => n.y || 0);
      const x0 = Math.min(...xs) - 50, y0 = Math.min(...ys) - 50, x1 = Math.max(...xs) + 240, y1 = Math.max(...ys) + 120;
      const sx = 150 / (x1 - x0), sy = 100 / (y1 - y0), s = Math.min(sx, sy);
      let h = '';
      for (const n of ns) { const nt = m.nodeTypes.find(x => x.type === n.type); h += '<rect x="' + ((n.x - x0) * s) + '" y="' + ((n.y - y0) * s) + '" width="' + Math.max(3, 190 * s) + '" height="' + Math.max(2, 60 * s) + '" fill="' + (nt ? nt.color : '#888') + '"/>'; }
      const r = canvas.getBoundingClientRect();
      const vx = (-view.x / view.z - x0) * s, vy = (-view.y / view.z - y0) * s;
      h += '<rect x="' + vx + '" y="' + vy + '" width="' + (r.width / view.z) * s + '" height="' + (r.height / view.z) * s + '" fill="none" stroke="#c9a227" stroke-width="1.5"/>';
      miniSvg.innerHTML = h;
    }
    mini.addEventListener('click', () => fit());

    // ---- inspector ----
    function renderInsp() {
      clear(insp);
      if (selEdge != null) return renderEdgeInsp();
      const n = def.nodes.find(x => x.id === sel);
      if (!n) { insp.append(el('div', { class: 'card-b muted small' }, 'یک Node را انتخاب کنید. از palette اضافه کنید، Drag کنید، با dot خروجی اتصال بزنید.')); return; }
      const nt = m.nodeTypes.find(x => x.type === n.type);
      const isSE = n.type === 'start' || n.type === 'trigger' || n.type === 'end';
      const titleIn = el('input', { value: n.title || '' });
      titleIn.addEventListener('change', () => { snapshot(); n.title = titleIn.value; draw(); onDirty(); });
      const rows = [el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'عنوان Node'), titleIn))];
      // type-specific
      rows.push(nodeProps(n));
      // error policy for auto nodes
      if (!isSE && nt && nt.auto) {
        const errSel = el('select', {});
        for (const [v, l] of [['stop', 'در صورت خطا: توقف (Stop)'], ['continue', 'در صورت خطا: ادامه (Continue)'], ['retry', 'در صورت خطا: یک تلاش مجدد (Retry)']]) errSel.append(el('option', { value: v, selected: (n.on_error || 'stop') === v ? '' : null }, l));
        errSel.addEventListener('change', () => { n.on_error = errSel.value; onDirty(); });
        const notifyCh = el('input', { type: 'checkbox', checked: n.notify !== false ? '' : null });
        rows.push(el('div', { class: 'form-grid' },
          el('div', { class: 'field' }, el('label', {}, 'سیاست خطا'), errSel),
          el('div', { class: 'field' }, el('label', { class: 'chk', style: 'display:flex; gap:6px' }, notifyCh, 'اعلان هنگام رسیدن به مرحله'))));
        notifyCh.addEventListener('change', () => { n.notify = notifyCh.checked; onDirty(); });
      }
      // connections
      const outs = def.edges.map((e, i) => ({ ...e, _i: i })).filter(e => e.from === n.id);
      const connSel = el('select', {});
      connSel.append(el('option', { value: '' }, '— Node مقصد —'));
      for (const t2 of def.nodes) if (t2.id !== n.id) connSel.append(el('option', { value: t2.id }, t2.title));
      const lblSel = el('select', {});
      const labels = n.type === 'condition' ? [['', '—'], ['true', 'بله'], ['false', 'خیر']]
        : n.type === 'approval' ? [['', 'پیش‌رو'], ['approve', 'در صورت تأیید'], ['reject', 'در صورت رد'], ['return', 'در صورت بازگشت']]
        : n.type === 'parallel' ? [['branch', 'شاخهٔ موازی']]
        : [['', 'پیش‌رو']];
      for (const [v, l] of labels) lblSel.append(el('option', { value: v }, l));
      rows.push(el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'ساخت اتصال به…'), connSel),
        el('div', { class: 'field' }, el('label', {}, 'برچسب اتصال'), lblSel),
        el('div', { class: 'field' }, el('label', {}, ''), el('button', { class: 'btn sm', onclick: () => {
          if (!connSel.value) return toast('مقصد را انتخاب کنید', 'err');
          snapshot(); def.edges.push({ from: n.id, to: connSel.value, label: lblSel.value || '' }); draw(); renderInsp(); onDirty();
        } }, '＋ اتصال'))));
      const connList = el('div');
      if (outs.length) {
        connList.append(el('b', { class: 'small' }, 'اتصالات خروجی:'));
        for (const e of outs) {
          const toN = def.nodes.find(x => x.id === e.to);
          connList.append(el('div', { class: 'flex between', style: 'padding:5px 0; border-top:1px solid var(--border)' },
            el('span', { class: 'small' }, '→ ' + (toN ? toN.title : e.to) + (e.label ? ' (' + edgeLabelFa(e.label) + ')' : '')),
            el('button', { class: 'btn sm danger', onclick: () => { snapshot(); def.edges.splice(e._i, 1); draw(); renderInsp(); onDirty(); } }, 'حذف')));
        }
      }
      const delB = el('button', { class: 'btn danger sm', onclick: () => { if (isSE) return toast('شروع/پایان قابل حذف نیست', 'err'); deleteSel(); } }, '🗑 حذف Node');
      const dupB = el('button', { class: 'btn sm', onclick: () => { if (isSE) return toast('شروع/پایان تکرار نمی‌شود', 'err'); dupSel(); } }, '⧉ Duplicate');
      insp.append(el('div', { class: 'card-h flex between' }, el('h3', {}, (nt ? nt.ic + ' ' + nt.fa : n.type) + ' — ' + (n.title || '')), el('div', { class: 'flex' }, dupB, delB)),
        el('div', { class: 'card-b' }, ...rows, connList));
    }
    function renderEdgeInsp() {
      const e = def.edges[selEdge]; if (!e) return;
      const a = def.nodes.find(x => x.id === e.from), b = def.nodes.find(x => x.id === e.to);
      const lblSel = el('select', {});
      for (const l of ['', 'true', 'false', 'approve', 'reject', 'return', 'loop', 'branch']) lblSel.append(el('option', { value: l, selected: (e.label || '') === l ? '' : null }, l ? edgeLabelFa(l) : '— پیش‌رو —'));
      lblSel.addEventListener('change', () => { snapshot(); e.label = lblSel.value || ''; draw(); onDirty(); });
      insp.append(el('div', { class: 'card-h flex between' }, el('h3', {}, 'اتصال: ' + (a ? a.title : '?') + ' → ' + (b ? b.title : '?')),
        el('button', { class: 'btn danger sm', onclick: () => { snapshot(); def.edges.splice(selEdge, 1); selEdge = null; draw(); renderInsp(); onDirty(); } }, '🗑 حذف اتصال')),
        el('div', { class: 'card-b' }, el('div', { class: 'field' }, el('label', {}, 'برچسب/شرط مسیر'), lblSel)));
    }
    // ---- node property editors ----
    function nodeProps(n) {
      const p = [];
      if (n.type === 'action') p.push(actionEditor(n));
      if (n.type === 'create_record' || n.type === 'update_record') p.push(recordEditor(n));
      if (n.type === 'condition') p.push(condEditor(n));
      if (n.type === 'approval' || n.type === 'signature' || n.type === 'task' || n.type === 'assignment') p.push(assigneeEditor(n));
      if (n.type === 'notification') p.push(notifEditor(n));
      if (n.type === 'message' || n.type === 'email') p.push(msgEditor(n));
      if (n.type === 'delay' || n.type === 'schedule') p.push(delayEditor(n));
      if (n.type === 'wait') p.push(waitEditor(n));
      if (n.type === 'assignment') {
        const fIn = el('input', { value: n.params ? n.params.field || '' : '', placeholder: 'salesperson_id / assigned_to / analyst_id…' });
        fIn.addEventListener('change', () => { n.params = n.params || {}; n.params.field = fIn.value.trim(); onDirty(); });
        p.push(el('div', { class: 'form-grid' }, el('div', { class: 'field' }, el('label', {}, 'فیلد مقصد رکورد'), fIn)));
      }
      return p;
    }
    function actionFa(n) { const a = m.actions.find(x => x.key === n.action); return a ? a.fa : (n.action || '—'); }
    function actionEditor(n) {
      n.params = n.params || {};
      const actSel = el('select', {});
      for (const a of m.actions) actSel.append(el('option', { value: a.key, selected: n.action === a.key ? '' : null }, a.fa));
      const paramsBox = el('div', { class: 'card-b small', style: 'background:var(--surface-2)' });
      const renderParams = () => {
        clear(paramsBox);
        const a = m.actions.find(x => x.key === n.action);
        if (!a) return;
        for (const fp of a.params) {
          n.params[fp.key] = n.params[fp.key] !== undefined ? n.params[fp.key] : (fp.type === 'kv' ? {} : (fp.type === 'recipients' ? { users: [], roles: [], departments: [] } : ''));
          const inp = paramInput(fp, n.params[fp.key]);
          inp.addEventListener('change', () => { n.params[fp.key] = inp.value; onDirty(); });
          paramsBox.append(el('div', { class: 'field', style: 'margin-bottom:6px' },
            el('label', { class: 'small' }, fp.label || fp.key + (fp.required ? ' *' : '')), inp));
        }
      };
      actSel.addEventListener('change', () => { snapshot(); n.action = actSel.value; n.params = {}; renderParams(); onDirty(); draw(); });
      renderParams();
      return el('div', {}, el('div', { class: 'field' }, el('label', {}, 'Action (عملیات واقعی)'), actSel), paramsBox);
    }
    function paramInput(fp, val) {
      if (fp.type === 'module') {
        const s = el('select', {});
        for (const x of m.modules) s.append(el('option', { value: x.key, selected: val === x.key ? '' : null }, x.fa));
        return s;
      }
      if (fp.type === 'channel') {
        const s = el('select', {});
        for (const x of m.channels) s.append(el('option', { value: x, selected: val === x ? '' : null }, x));
        return s;
      }
      if (fp.type === 'number') return el('input', { type: 'number', value: val ?? '' });
      if (fp.type === 'kv') return el('textarea', { rows: 3, placeholder: 'JSON: {"field": "value یا {{var.field}}"}', value: typeof val === 'string' ? val : JSON.stringify(val || {}) });
      if (fp.type === 'recipients') return el('input', { placeholder: 'JSON: {"users":["id"],"roles":["sales_manager"],"departments":["فروش"],"all":false}', value: typeof val === 'string' ? val : JSON.stringify(val || {}) });
      return el('input', { value: val ?? '', placeholder: fp.key + ' — از {{customer.name}} و… استفاده کنید' });
    }
    function recordEditor(n) {
      n.params = n.params || {};
      const modSel = el('select', {});
      modSel.append(el('option', { value: '' }, '— ماژول —'));
      for (const x of m.modules) modSel.append(el('option', { value: x.key, selected: n.params.module === x.key ? '' : null }, x.fa));
      modSel.addEventListener('change', () => { n.params.module = modSel.value; onDirty(); });
      const kv = el('textarea', { rows: 3, placeholder: 'JSON فیلدها: {"name":"{{...}}", "status":"active"}', value: typeof n.params.values === 'string' ? n.params.values : JSON.stringify(n.params.values || {}) });
      kv.addEventListener('change', () => { n.params.values = kv.value; onDirty(); });
      return el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'ماژول CRM'), modSel),
        el('div', { class: 'field' }, el('label', {}, n.type === 'create_record' ? 'فیلدهای رکورد جدید (JSON + Variables)' : 'فیلدهای به‌روزرسانی (JSON + Variables)'), kv));
    }
    function condSummary(c) {
      if (!c) return '—';
      if (c.conditions) return (c.logic || 'AND') + (c.not ? ' NOT' : '') + '(' + c.conditions.length + ')';
      return c.field + ' ' + (condOpFa(c.op) || c.op) + ' ' + (c.value ?? '');
    }
    function condOpFa(op) { const o = m.conditionOps.find(x => x[0] === op); return o ? o[1] : op; }
    function condEditor(n) {
      n.condition = n.condition || { logic: 'AND', conditions: [] };
      const box = el('div', {});
      const render = () => {
        clear(box);
        const g = n.condition;
        const logicSel = el('select', {});
        for (const v of ['AND', 'OR']) logicSel.append(el('option', { value: v, selected: (g.logic || 'AND') === v ? '' : null }, v === 'AND' ? 'AND (همه)' : 'OR (هرکدام)'));
        logicSel.addEventListener('change', () => { snapshot(); g.logic = logicSel.value; render(); onDirty(); });
        const notCh = el('input', { type: 'checkbox', checked: g.not ? '' : null });
        notCh.addEventListener('change', () => { snapshot(); g.not = notCh.checked; render(); onDirty(); });
        box.append(el('div', { class: 'flex', style: 'gap:8px; margin-bottom:6px' }, logicSel, el('label', { class: 'chk small', style: 'display:flex; gap:4px; align-items:center' }, notCh, 'NOT')));
        (g.conditions || []).forEach((leaf, i) => {
          const row = el('div', { class: 'flex', style: 'gap:4px; margin-bottom:4px; align-items:center; flex-wrap:wrap' });
          if (leaf.conditions) {
            row.append(el('span', { class: 'badge' }, 'گروه'), el('button', { class: 'btn sm', onclick: () => { snapshot(); g.conditions.splice(i, 1); render(); onDirty(); } }, 'حذف گروه'));
          } else {
            const fIn = el('input', { value: leaf.field || '', placeholder: 'customer.name', style: 'min-width:130px' });
            const opSel = el('select', {});
            for (const [v, , l] of m.conditionOps) opSel.append(el('option', { value: v, selected: (leaf.op || 'eq') === v ? '' : null }, l));
            const vIn = el('input', { value: leaf.value != null ? String(leaf.value) : '', placeholder: 'مقدار', style: 'min-width:90px' });
            fIn.addEventListener('change', () => { snapshot(); leaf.field = fIn.value.trim(); onDirty(); });
            opSel.addEventListener('change', () => { snapshot(); leaf.op = opSel.value; onDirty(); });
            vIn.addEventListener('change', () => { snapshot(); leaf.value = vIn.value; onDirty(); });
            row.append(fIn, opSel, vIn,
              el('button', { class: 'btn sm', onclick: () => openVarPicker(vIn) }, '🧩'),
              el('button', { class: 'btn sm danger', onclick: () => { snapshot(); g.conditions.splice(i, 1); render(); onDirty(); } }, '✕'));
          }
          box.append(row);
        });
        box.append(el('div', { class: 'flex', style: 'gap:6px' },
          el('button', { class: 'btn sm', onclick: () => { snapshot(); g.conditions.push({ field: '', op: 'eq', value: '' }); render(); onDirty(); } }, '＋ شرط'),
          el('button', { class: 'btn sm', onclick: () => { snapshot(); g.conditions.push({ logic: 'AND', conditions: [{ field: '', op: 'eq', value: '' }] }); render(); onDirty(); } }, '＋ زیرگروه')));
      };
      render();
      return el('div', {}, el('label', { class: 'small' }, 'شرط‌ها (از دادهٔ واقعی Database خوانده می‌شود)'), box);
    }
    function assigneeFa(n) {
      if (!n.assignee_type || n.assignee_type === 'none') return 'بدون مسئول';
      return ({ user: 'کاربر', role: 'نقش', department: 'واحد', dynamic: 'Dynamic' }[n.assignee_type] || n.assignee_type) + ': ' + (n.assignee || '—');
    }
    function assigneeEditor(n) {
      const tSel = el('select', {});
      for (const [v, l] of m.assigneeTypes) tSel.append(el('option', { value: v, selected: (n.assignee_type || 'none') === v ? '' : null }, l));
      const box = el('div', {});
      const render = () => {
        clear(box);
        if (!n.assignee_type || n.assignee_type === 'none') { box.append(el('span', { class: 'muted small' }, 'بدون مسئول مشخص')); return; }
        if (n.assignee_type === 'dynamic') {
          const inp = el('input', { value: n.assignee || '', placeholder: 'مثلاً customer.salesperson_id یا quote.salesperson_id' });
          inp.addEventListener('change', () => { snapshot(); n.assignee = inp.value.trim(); onDirty(); });
          box.append(inp, el('button', { class: 'btn sm', onclick: () => openVarPicker(inp) }, '🧩'));
          return;
        }
        const inp = el('input', { value: n.assignee || '', placeholder: n.assignee_type === 'role' ? 'نام نقش (sales_manager…)' : n.assignee_type === 'department' ? 'نام واحد' : 'شناسه کاربر' });
        inp.addEventListener('change', () => { snapshot(); n.assignee = inp.value.trim(); onDirty(); });
        box.append(inp);
      };
      tSel.addEventListener('change', () => { snapshot(); n.assignee_type = tSel.value; render(); onDirty(); });
      render();
      return el('div', {}, el('div', { class: 'field' }, el('label', {}, n.type === 'signature' ? 'امضاکننده (فقط امضای خودش)' : n.type === 'approval' ? 'تأییدکننده' : 'مسئول'), tSel), box);
    }
    function notifFa(n) {
      const r = n.params && n.params.recipients; if (!r) return '—';
      const parts = [];
      if ((r.roles || []).length) parts.push('نقش: ' + r.roles.join(','));
      if ((r.users || []).length) parts.push('کاربر: ' + r.users.join(','));
      if (r.all) parts.push('همه');
      return parts.join('، ') || '—';
    }
    function notifEditor(n) {
      n.params = n.params || {}; n.params.recipients = n.params.recipients || { users: [], roles: [], departments: [] };
      const r = n.params.recipients;
      const rolesIn = el('input', { value: (r.roles || []).join(', '), placeholder: 'sales_manager, finance_manager (با کما)' });
      const usersIn = el('input', { value: (r.users || []).join(', '), placeholder: 'id کاربران (با کما)' });
      const allCh = el('input', { type: 'checkbox', checked: r.all ? '' : null });
      const titleIn = el('input', { value: n.params.title || '', placeholder: 'عنوان اعلان — {{customer.name}}' });
      const bodyIn = el('input', { value: n.params.body || '', placeholder: 'متن اعلان' });
      rolesIn.addEventListener('change', () => { snapshot(); r.roles = rolesIn.value.split(',').map(x => x.trim()).filter(Boolean); onDirty(); draw(); });
      usersIn.addEventListener('change', () => { snapshot(); r.users = usersIn.value.split(',').map(x => x.trim()).filter(Boolean); onDirty(); draw(); });
      allCh.addEventListener('change', () => { snapshot(); r.all = allCh.checked; onDirty(); });
      titleIn.addEventListener('change', () => { n.params.title = titleIn.value; onDirty(); });
      bodyIn.addEventListener('change', () => { n.params.body = bodyIn.value; onDirty(); });
      return el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'گیرنده — نقش‌ها'), rolesIn),
        el('div', { class: 'field' }, el('label', {}, 'گیرنده — id کاربران'), usersIn),
        el('div', { class: 'field' }, el('label', { class: 'chk', style: 'display:flex; gap:6px' }, allCh, 'همهٔ کاربران')),
        el('div', { class: 'field' }, el('label', {}, 'عنوان'), titleIn),
        el('div', { class: 'field' }, el('label', {}, 'متن'), bodyIn));
    }
    function msgEditor(n) {
      n.params = n.params || {};
      const isMail = n.type === 'email';
      const chSel = el('select', {});
      for (const x of m.channels.filter(x => x !== 'email' || isMail)) chSel.append(el('option', { value: x, selected: (n.params.channel || (isMail ? 'email' : 'sms')) === x ? '' : null }, x));
      chSel.addEventListener('change', () => { n.params.channel = chSel.value; onDirty(); });
      const recIn = el('input', { value: n.params.recipient || n.params.to || '', placeholder: isMail ? 'customer.email' : 'customer.phone یا customer.mobile' });
      const tplIn = el('textarea', { rows: 3, placeholder: isMail ? 'متن ایمیل — {{customer.name}} {{invoice.number}}' : 'متن پیام — {{customer.name}}', value: n.params.template || n.params.body || n.params.subject || '' });
      const subIn = isMail ? el('input', { value: n.params.subject || '', placeholder: 'موضوع ایمیل' }) : null;
      recIn.addEventListener('change', () => { snapshot(); if (isMail) n.params.to = recIn.value.trim(); else n.params.recipient = recIn.value.trim(); onDirty(); draw(); });
      tplIn.addEventListener('change', () => { n.params[isMail ? 'body' : 'template'] = tplIn.value; onDirty(); });
      if (subIn) subIn.addEventListener('change', () => { n.params.subject = subIn.value; onDirty(); });
      const box = [el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'کانال (Platform واقعی)'), chSel),
        el('div', { class: 'field' }, el('label', {}, 'گیرنده (Variable)'), recIn), el('button', { class: 'btn sm', onclick: () => openVarPicker(recIn) }, '🧩 متغیر'))];
      if (subIn) box.push(el('div', { class: 'field' }, el('label', {}, 'موضوع'), subIn));
      box.push(el('div', { class: 'field' }, el('label', {}, 'متن (Variable‌ها از دادهٔ واقعی Execution خوانده می‌شوند)'), tplIn));
      box.push(el('div', { class: 'muted small' }, 'اگر Platform تنظیم نباشد، مرحله «Not Configured» می‌شود — هرگز ارسال جعلی نمایش داده نمی‌شود.'));
      return el('div', {}, ...box);
    }
    function delayFa(n) {
      const p = n.params || {};
      if (p.due_at) return 'تا ' + p.due_at;
      return (p.delay_value || 0) + ' ' + ({ minute: 'دقیقه', hour: 'ساعت', day: 'روز', week: 'هفته' }[p.delay_unit] || '') ;
    }
    function delayEditor(n) {
      n.params = n.params || {};
      const vIn = el('input', { type: 'number', value: n.params.delay_value != null ? n.params.delay_value : 1, style: 'width:90px' });
      const uSel = el('select', {});
      for (const [v, l] of [['minute', 'دقیقه'], ['hour', 'ساعت'], ['day', 'روز'], ['week', 'هفته']]) uSel.append(el('option', { value: v, selected: (n.params.delay_unit || 'hour') === v ? '' : null }, l));
      const dtIn = el('input', { type: 'datetime-local', value: n.params.due_at || '' });
      vIn.addEventListener('change', () => { n.params.delay_value = Number(vIn.value) || 0; n.params.due_at = ''; onDirty(); });
      uSel.addEventListener('change', () => { n.params.delay_unit = uSel.value; onDirty(); });
      dtIn.addEventListener('change', () => { n.params.due_at = dtIn.value; if (dtIn.value) n.params.delay_value = 0; onDirty(); });
      return el('div', { class: 'form-grid' },
        el('div', { class: 'field' }, el('label', {}, 'مدت تأخیر'), el('div', { class: 'flex' }, vIn, uSel)),
        el('div', { class: 'field' }, el('label', {}, 'یا تاریخ/ساعت مشخص'), dtIn));
    }
    function waitEditor(n) {
      n.params = n.params || {};
      const inp = el('input', { value: n.params.event || '', placeholder: 'نام رویداد (مثلاً quote_approved)' });
      inp.addEventListener('change', () => { n.params.event = inp.value.trim(); onDirty(); });
      return el('div', { class: 'field' }, el('label', {}, 'انتظار برای رویداد'), inp, el('div', { class: 'muted small' }, 'Execution در این Node «waiting» می‌ماند تا رویداد رخ دهد.'));
    }
    function openVarPicker(target) {
      const box = el('div', {});
      const rows = [];
      const mod = proc ? proc.module : 'customer';
      api.get('/api/r/' + mod + '?per_page=1').then(({ items }) => {
        if (items && items[0]) {
          rows.push({ group: mod + ' (رکورد)', vars: Object.keys(items[0]) });
        }
      }).catch(() => {});
      rows.push({ group: 'customer (مشتری مرتبط)', vars: ['name', 'phone', 'mobile', 'email', 'number'] });
      rows.push({ group: 'wf (اجرا)', vars: ['execution_no', 'execution_id', 'module', 'entity_id', 'title', 'status', 'started_at'] });
      rows.push({ group: 'user (کاربر مجری)', vars: ['username', 'full_name', 'department', 'id'] });
      const render = () => {
        clear(box);
        for (const g of rows) {
          box.append(el('b', { class: 'small' }, g.group));
          for (const v of g.vars) box.append(el('button', { class: 'btn sm', style: 'margin:2px 2px 2px 0', onclick: () => {
            const ins = '{ {' + g.group.split(' ')[0] + '.' + v + ' }}'.replace(' ', '');
            target.value = (target.value || '') + '{{' + g.group.split(' ')[0] + '.' + v + '}}';
            ov.close();
          } }, '{{' + g.group.split(' ')[0] + '.' + v + '}}'));
        }
      };
      const ov = openModal('Variable Picker — درج متغیر', box, { large: true });
      setTimeout(render, 150);
    }

    designerRedraw = () => { draw(); renderInsp(); };
    draw(); renderInsp();
    // open already framed: fit the whole flow into the visible canvas (orderly view)
    setTimeout(() => fit(), 60);
    return out;
  }

  // ================= OPC table (keep from before) =================
  function buildOPC() {
    const box = el('div');
    const opOrder = () => {
      const start = def.nodes.find(n => n.type === 'start' || n.type === 'trigger');
      const visited = new Set(), order = [], queue = start ? [start.id] : [];
      while (queue.length) {
        const id = queue.shift(); if (visited.has(id)) continue; visited.add(id);
        const nd = def.nodes.find(x => x.id === id); if (!nd) continue;
        order.push(nd);
        for (const e of def.edges) if (e.from === id && !visited.has(e.to)) queue.push(e.to);
      }
      for (const nd of def.nodes) if (!visited.has(nd.id)) order.push(nd);
      return order;
    };
    const nextPathsOf = (n) => {
      const outs = def.edges.filter(e => e.from === n.id);
      if (!outs.length) return n.type === 'end' ? '— (پایان)' : '⚠ بدون مسیر بعدی';
      return outs.map(e => {
        const t = def.nodes.find(x => x.id === e.to);
        return (t ? t.title : e.to) + (e.label ? ' (' + edgeLabelFa(e.label) + ')' : '');
      }).join('، ');
    };
    const order = opOrder();
    if (!order.length) return box.append(emptyState('Node تعریف نشده است.'));
    box.append(el('div', { class: 'alert info small mb-10' }, 'جدول OPC — ترتیب عملیات (DFS از شروع). روی ردیف کلیک = انتخاب در طراح.'));
    const head = el('tr', {}, el('th', {}, '#'), el('th', {}, 'ایستگاه'), el('th', {}, 'نوع'), el('th', {}, 'عملیات/مسئول'), el('th', {}, 'مسیر بعدی (شرط)'));
    const body = el('tbody');
    order.forEach((n, i) => {
      const nt = m.nodeTypes.find(x => x.type === n.type);
      body.append(el('tr', { style: 'cursor:pointer', onclick: () => { if (window.__wfeSwitchDesign) window.__wfeSwitchDesign(n.id); } },
        el('td', { class: 'num' }, faDigits(i + 1)),
        el('td', {}, el('b', { class: 'small' }, n.title || n.type)),
        el('td', { class: 'small' }, nt ? nt.fa : n.type),
        el('td', { class: 'small muted' }, [actionFa(n), assigneeFa(n)].filter(Boolean).join(' • ') || '—'),
        el('td', { class: 'small' }, nextPathsOf(n))));
    });
    box.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), body)));
    return box;
  }

  // ================= Monitor =================
  async function buildMonitor() {
    const box = el('div', {}, el('div', { class: 'skel', style: 'height:80px' }));
    let mt = null, items = [];
    try { mt = await api.get('/api/wf/my-tasks'); } catch { mt = null; }
    try { const r = await api.get('/api/wf/executions' + (proc ? '?process=' + proc.id : '')); items = r.items || []; } catch (e) {
      clear(box); box.append(el('div', { class: 'alert danger' }, e.message)); return box;
    }
    clear(box);
    // My tasks (full action UI)
    if (mt && (mt.items || []).length) {
      const head = el('div', { class: 'card-h' }, el('h3', {}, '✋ کارهای من (تأیید/امضا/مراحل من)'));
      const list = el('div', { class: 'card-b' });
      for (const tk of mt.items) {
        const resSel = el('select', {});
        for (const [v, l] of [['complete', 'تکمیل'], ['approve', 'تأیید'], ['reject', 'رد'], ['return', 'بازگشت']]) resSel.append(el('option', { value: v }, l));
        const noteIn = el('input', { placeholder: 'یادداشت / دلیل رد (برای رد الزامی)' });
        let pad = null, sigBox = null;
        if (tk.needs_signature) { pad = signaturePad(); sigBox = el('div', { class: 'field' }, el('label', {}, 'امضای شما (فقط امضای خودتان ثبت می‌شود)'), pad.canvas); }
        list.append(el('div', { class: 'flex between', style: 'padding:10px 0; border-top:1px solid var(--border); gap:10px; flex-wrap:wrap; align-items:flex-start' },
          el('div', { style: 'flex:1; min-width:220px' },
            el('b', { class: 'small' }, tk.node_title),
            el('div', { class: 'muted small' }, tk.process_name + ' — ' + tk.record_title + (tk.needs_signature ? ' — ✍ نیاز به امضا' : ''))),
          el('div', { class: 'flex', style: 'gap:6px; flex-wrap:wrap' }, resSel, noteIn, sigBox,
            el('button', { class: 'btn primary sm', onclick: async (e) => {
              e.target.disabled = true;
              const payload = { result: resSel.value, note: noteIn.value.trim() };
              if (tk.needs_signature && resSel.value !== 'reject' && pad && pad.dataUrl) payload.signature = pad.dataUrl;
              try {
                await api.post(`/api/wf/instances/${tk.execution_id}/step/${tk.step_id}/complete`, payload);
                toast('ثبت شد', 'ok');
                renderTabRefresh();
              } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
            } }, 'ثبت'))));
      }
      box.append(el('div', { class: 'card mb-12' }, head, list));
    }
    // Executions table
    if (!items.length) return box.append(el('div', { class: 'card' }, emptyState('اجرای فعالی نیست')));
    const head = el('tr', {}, el('th', {}, 'Execution'), el('th', {}, 'رکورد'), el('th', {}, 'Node فعلی'), el('th', {}, 'مسئول فعلی'), el('th', {}, 'وضعیت'), el('th', {}, 'تاریخ'), el('th', {}, 'مدت'), el('th', {}, 'عملیات'));
    const body = el('tbody');
    for (const i of items) {
      const acts = el('div', { class: 'row-act', style: 'display:flex; gap:4px' });
      acts.append(iconA('👁', 'جزئیات', () => openExec(i.id)));
      if (i.status === 'running' || i.status === 'waiting') acts.append(iconA('✖', 'Cancel', async () => {
        if (await confirmDialog('لغو اجرا', 'این اجرا لغو شود؟', 'لغو', true)) { try { await api.post('/api/wf/executions/' + i.id + '/cancel'); toast('لغوشد', 'ok'); renderTabRefresh(); } catch (e) { toast(e.message, 'err'); } }
      }));
      if (i.status === 'failed' || i.status === 'terminated') acts.append(iconA('↻', 'Retry', async () => {
        try { await api.post('/api/wf/executions/' + i.id + '/retry'); toast('تلاش مجدد', 'ok'); renderTabRefresh(); } catch (e) { toast(e.message, 'err'); }
      }));
      body.append(el('tr', {},
        el('td', { class: 'small', dir: 'ltr' }, i.execution_no || ('#' + i.id)),
        el('td', { class: 'small' }, i.title || ('#' + i.entity_id)),
        el('td', { class: 'small' }, i.current_node_title || '—'),
        el('td', { class: 'small muted' }, i.current_responsible || '—'),
        el('td', {}, stBadge(i.status)),
        el('td', { class: 'small muted' }, fmtDate(i.started_at, { time: true })),
        el('td', { class: 'small num' }, faDigits(i.duration_sec || 0) + 's'),
        el('td', { class: 'row-act' }, acts)));
    }
    box.append(el('div', { class: 'card' }, el('div', { class: 'card-h' }, el('h3', {}, '📊 Executions (Monitor)')), el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), body))));
    return box;
  }
  // ============ Execution path — real highlighted trace (Section 3) ============
  // Built ONLY from real data: instance (current_node_id/status), steps
  // (per-node status/result/assignee) and the published definition (nodes/edges).
  // Shows: START → completed → CURRENT (gold) → NEXT (blue) → …, failed steps
  // in red, waiting steps in gold outline, with condition labels on edges.
  function execPathStrip(i, steps, defObj) {
    const wrap = el('div', { class: 'card', style: 'margin-top:10px' });
    try {
      const d = defObj || { nodes: [], edges: [] };
      const nodes = d.nodes || [], edges = d.edges || [];
      // BFS order from the start node (same order as the OPC table)
      const starts = nodes.filter(n => n.type === 'start' || n.type === 'trigger');
      const visited = new Set(), order = [], queue = (starts.length ? starts : nodes).map(n => n.id);
      while (queue.length) {
        const nid = queue.shift(); if (visited.has(nid)) continue; visited.add(nid);
        const nd = nodes.find(x => x.id === nid); if (!nd) continue;
        order.push(nd);
        for (const e of edges) if (e.from === nid && !visited.has(e.to)) queue.push(e.to);
      }
      for (const nd of nodes) if (!visited.has(nd.id)) order.push(nd);
      if (!order.length) return null;
      // real step states per node (latest step wins)
      const stepState = {};
      for (const s of steps) {
        if (!s || !s.node_id) continue;
        const prev = stepState[s.node_id];
        if (!prev || (s.created_at || '') >= (prev.created_at || '')) stepState[s.node_id] = s;
      }
      const nodeState = (n) => {
        const s = stepState[n.id];
        if (i.current_node_id === n.id && ['running', 'waiting'].includes(i.status)) return 'current';
        if (s) {
          if (['completed', 'approved', 'signed', 'done', 'success'].includes(s.status)) return 'done';
          if (['failed', 'error', 'rejected'].includes(s.status)) return s.status === 'rejected' ? (i.status === 'rejected' ? 'failed' : 'rejected') : 'failed';
          if (['active', 'pending', 'waiting'].includes(s.status)) return ['running', 'waiting'].includes(i.status) ? 'current' : 'waiting';
        }
        if (i.current_node_id === n.id) return 'current';
        return 'pending';
      };
      const firstDone = order.map(nodeState).findIndex(st => st === 'done');
      const isDone = (n) => { const st = nodeState(n); return st === 'done' || (st === 'pending' && firstDone >= 0 && order.indexOf(n) < order.findIndex(x => nodeState(x) !== 'pending' && nodeState(x) !== 'done')); };
      const nextState = (n) => {
        const st = nodeState(n);
        if (st === 'pending' || st === 'waiting') {
          const curIdx = order.findIndex(x => nodeState(x) === 'current');
          if (curIdx >= 0 && order.indexOf(n) > curIdx && ['running', 'waiting'].includes(i.status)) return 'next';
        }
        return st;
      };
      const meta = {
        done: order.filter(n => isDone(n)).length,
        failed: order.filter(n => nodeState(n) === 'failed' || nodeState(n) === 'rejected').length,
        waiting: order.filter(n => nodeState(n) === 'waiting').length,
      };
      const nextNode = (['running', 'waiting']).includes(i.status) ? order.find(n => nextState(n) === 'next') : null;
      wrap.append(el('div', { class: 'flex', style: 'gap:8px; flex-wrap:wrap; margin-bottom:8px' },
        el('b', { class: 'small' }, 'مسیر اجرای واقعی:'),
        el('span', { class: 'badge green' }, 'تکمیل: ' + faDigits(meta.done)),
        meta.failed ? el('span', { class: 'badge red' }, 'ناموفق: ' + faDigits(meta.failed)) : null,
        meta.waiting ? el('span', { class: 'badge gold' }, 'در انتظار: ' + faDigits(meta.waiting)) : null,
        i.current_responsible ? el('span', { class: 'badge' }, 'مسئول فعلی: ' + i.current_responsible) : null,
        nextNode ? el('span', { class: 'badge', style: 'background:#1d4ed8' }, 'گام بعدی: ' + (nextNode.title || nextNode.type)) : null));
      const flow = el('div', { style: 'display:flex; flex-wrap:wrap; gap:4px; align-items:flex-start; direction:rtl; padding:6px 0' });
      order.forEach((n, idx) => {
        const st = nextState(n);
        const base = { done: 'background:#0f5132; color:#fff; border:2px solid #2a9d8f', failed: 'background:#7f1d1d; color:#fff; border:2px solid #ef4444', rejected: 'background:#7f1d1d; color:#fff; border:2px solid #ef4444', current: 'background:#92400e; color:#fff; border:2px solid #c9a227', waiting: 'background:transparent; color:#92400e; border:2px dashed #c9a227', next: 'background:#1e3a8a; color:#fff; border:2px solid #60a5fa', pending: 'background:var(--surface-2); color:var(--text,#333); border:2px solid var(--border,#ddd)' }[st] || '';
        const s = stepState[n.id];
        const chip = el('div', { title: (n.title || n.type) + (s && s.note ? ' — ' + s.note : ''), style: 'max-width:150px; padding:5px 9px; border-radius:8px; font-size:12px; line-height:1.5; ' + base });
        const ico = ({ start: '▶', trigger: '⚡', end: '⏹', condition: '⑂', approval: '✔', signature: '✍', task: '✅', action: '⚙', message: '✉', email: '@', delay: '⏱', schedule: '📅', wait: '⏳', parallel: '⫿', merge: '⊕', create_record: '＋', update_record: '±', assignment: '→', notification: '🔔' }[n.type]) || '•';
        chip.append(el('span', { style: 'margin-inline-end:4px' }, ico), el('b', { class: 'small' }, n.title || n.type));
        const subs = [];
        if (st === 'current') subs.push('جاری');
        if (st === 'next') subs.push('بعدی');
        if (s && (s.result || s.error)) subs.push(s.error ? 'خطا: ' + String(s.error).slice(0, 60) : String(s.result).slice(0, 60));
        if (s && s.assignee_name) subs.push('مسئول: ' + s.assignee_name);
        if (subs.length) chip.append(el('div', { class: 'small', style: 'opacity:.85; font-size:10.5px; margin-top:2px' }, subs.join(' • ')));
        flow.append(chip);
        if (idx < order.length - 1) {
          // edge to the next node in path order (condition label where present)
          const e = edges.find(x => x.from === n.id && x.to === order[idx + 1].id);
          const taken = !!stepState[n.id] && stepState[n.id].status && ['completed', 'approved', 'signed', 'done', 'success', 'rejected'].includes(stepState[n.id].status);
          flow.append(el('div', { title: e && e.label ? 'شرط: ' + edgeLabelFa(e.label) : '', style: 'align-self:center; color:' + (taken ? '#2a9d8f' : '#9aa0a6') + '; font-size:15px; padding:0 2px' }, e && e.label ? '← ' + edgeLabelFa(e.label) : '←'));
        }
      });
      wrap.append(flow);
      return wrap;
    } catch { return null; }
  }

  async function openExec(instId) {
    const ov = openModal('Execution — در حال بارگذاری…', el('div', { class: 'skel', style: 'height:120px' }), { large: true, footer: [el('button', { class: 'btn', onclick: () => ov.close() }, t('close'))] });
    try {
      const r = await api.get('/api/wf/executions/' + instId);
      const i = r.instance;
      clear(ov.body);
      ov.body.append(
        el('div', { class: 'flex between', style: 'margin-bottom:8px; flex-wrap:wrap; gap:8px' },
          el('div', {}, el('b', {}, (i.execution_no || '#' + i.id) + ' — ' + (i.title || '')), el('div', { class: 'muted small' }, 'فرآیند: ' + (i.process_name || '') + ' • ' + i.module_fa)),
          el('div', { class: 'flex' }, stBadge(i.status),
            (i.status === 'running' || i.status === 'waiting') ? el('button', { class: 'btn sm danger', onclick: async () => { try { await api.post('/api/wf/executions/' + i.id + '/cancel'); toast('لغوشد', 'ok'); ov.close(); } catch (e) { toast(e.message, 'err'); } } }, 'Cancel') : null,
            (i.status === 'failed' || i.status === 'terminated') ? el('button', { class: 'btn sm', onclick: async () => { try { await api.post('/api/wf/executions/' + i.id + '/retry'); toast('تلاش مجدد', 'ok'); ov.close(); } catch (e) { toast(e.message, 'err'); } } }, 'Retry') : null)),
        el('div', { class: 'alert ' + (i.error ? 'danger' : 'info') + ' small' },
          'وضعیت فعلی: ' + (i.current_node_title || (i.completed_at ? 'پایان' : '—')) + (i.current_responsible ? ' • مسئول: ' + i.current_responsible : '') + (i.error ? ' • خطا: ' + i.error : '')),
        execPathStrip(i, r.steps || [], r.definition) || null,
        el('div', { class: 'muted small', style: 'margin-top:6px' },
          'شروع: ' + (i.started_at ? fmtDate(i.started_at, { time: true }) : '—') +
          ' • پایان: ' + (i.completed_at ? fmtDate(i.completed_at, { time: true }) : '—') +
          (i.attempts ? ' • تلاش‌ها: ' + faDigits(i.attempts) : '')),
        el('b', { class: 'small' }, 'مراحل:'));
      for (const s of (r.steps || [])) {
        ov.body.append(el('div', { class: 'flex between', style: 'padding:6px 0; border-top:1px dashed var(--border); flex-wrap:wrap; gap:6px' },
          el('div', { class: 'small' }, '• ' + (s.node_title || s.node_id) + ' — ' + (STATUS_FA[s.status] || [s.status])[0] + (s.result ? ' (' + s.result + ')' : '') + (s.signed ? ' ✍' : '') + (s.note ? ' — ' + s.note : '')),
          el('div', { class: 'muted small' }, (s.assignee_name || '') + (s.department ? ' • ' + s.department : ''))));
      }
      ov.body.append(el('b', { class: 'small', style: 'margin-top:10px' }, 'Log:'));
      for (const l of (r.logs || []).reverse()) {
        ov.body.append(el('div', { class: 'small', style: 'padding:2px 0; font-family:monospace' },
          el('span', { class: 'badge ' + (l.level === 'error' ? 'red' : l.level === 'success' ? 'green' : l.level === 'warn' ? 'gold' : ''), style: 'min-width:52px; text-align:center' }, l.level),
          ' ' + l.message + ' <span class="muted">' + (l.created_at || '').slice(11, 19) + '</span>'));
      }
    } catch (e) { clear(ov.body); ov.body.append(el('div', { class: 'alert danger small' }, e.message)); }
  }
  function renderTabRefresh() {
    if (tabBoxEl) { clear(tabBoxEl); tabBoxEl.append(buildMonitor()); }
    else location.reload();
  }

  // ================= versions =================
  function buildVersions() {
    const box = el('div');
    const head = el('tr', {}, el('th', {}, 'نسخه'), el('th', {}, 'شرح'), el('th', {}, 'تاریخ'), el('th', {}, 'وضعیت'), el('th', {}, ''));
    const body = el('tbody');
    for (const v of [...vers].reverse()) {
      body.append(el('tr', {},
        el('td', { class: 'num' }, faDigits(v.version)),
        el('td', { class: 'small' }, v.change_note || '—'),
        el('td', { class: 'small' }, fmtDate(v.created_at, { time: true })),
        el('td', {}, el('span', { class: 'badge ' + (v.active ? 'green' : '') }, v.active ? 'فعال (Published)' : 'مخفی')),
        el('td', { class: 'row-act' }, v.active ? null : el('button', { class: 'btn sm', onclick: async () => {
          if (await confirmDialog('Restore', 'نسخهٔ ' + faDigits(v.version) + ' به‌عنوان نسخهٔ جدید فعال شود؟', 'Restore')) {
            try { await api.post(`/api/wf/processes/${id}/restore/${v.id}`); toast('Restore شد', 'ok'); location.reload(); } catch (e) { toast(e.message, 'err'); }
          }
        } }, 'Restore'))));
    }
    box.append(el('div', { class: 'card' }, el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', {}, head), body))));
    return box;
  }
  function edgeLabelFa(l) { return ({ true: 'بله', false: 'خیر', approve: 'تأیید', reject: 'رد', return: 'بازگشت', loop: 'تکرار', branch: 'شاخه' }[l]) || l; }

  boot().catch(e => card.append(el('div', { class: 'alert danger' }, e.message)));
}
