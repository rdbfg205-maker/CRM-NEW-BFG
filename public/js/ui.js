'use strict';
import { t } from './core.js';

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v; // ⚠ trusted/static markup only (SVG icon sprites) — never user data
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'disabled') n.disabled = !!v;
    else if (k === 'checked') n.checked = !!v;
    else if (k === 'selected') n.selected = !!v;
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
export function h(tag, attrs, ...children) { return el(tag, attrs, ...children); }
export function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

// ---------- toast ----------
// Bottom-anchored, non-intrusive, independently dismissible. Each toast has its
// own close button that removes ONLY that toast. Error toasts linger longer so
// important information is not lost; closing one never affects the others.
export function toast(msg, type = '') {
  const box = document.getElementById('toasts');
  const n = el('div', { class: 'toast ' + type }, el('div', { class: 'toast-msg', style: 'flex:1; line-height:1.6' }, msg));
  const closed = [false];
  const close = () => { if (closed[0]) return; closed[0] = true; n.style.opacity = '0'; n.style.transition = 'opacity .3s'; setTimeout(() => n.remove(), 320); };
  const x = el('button', { class: 'toast-x', title: 'بستن این اعلان', 'aria-label': 'بستن', onclick: (e) => { e.stopPropagation(); close(); } }, '✕');
  n.append(x);
  box.append(n);
  setTimeout(close, type === 'err' ? 6500 : 4200);
}

// ---------- modal ----------
export function openModal(title, bodyNode, { footer = null, large = false, onClose = null } = {}) {
  const root = document.getElementById('modal-root');
  const modal = el('div', { class: 'modal' + (large ? ' lg' : '') },
    el('div', { class: 'm-h' }, el('h3', {}, title), el('button', { class: 'icon-btn x', onclick: close }, '✕')),
    el('div', { class: 'm-b' }, bodyNode),
  );
  if (footer) modal.append(el('div', { class: 'm-f' }, footer));
  const ov = el('div', { class: 'modal-ov' }, modal);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  function close() { ov.remove(); if (onClose) onClose(); }
  root.append(ov);
  return { close, modal, body: modal.querySelector('.m-b') };
}
export function confirmDialog(title, text, okLabel = 'تأیید', danger = false) {
  return new Promise((resolve) => {
    const ov = openModal(title, el('div', { style: 'font-size:13.5px; color:var(--muted); line-height:2' }, text), {
      footer: [
        el('button', { class: 'btn', onclick: () => { ov.close(); resolve(false); } }, t('cancel')),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { ov.close(); resolve(true); } }, okLabel),
      ],
    });
    ov._close = ov.close;
  });
}

// ---------- tabs ----------
export function tabs(items, activeIdx = 0, onSel = null) {
  const wrap = el('div', { class: 'tabs' });
  items.forEach((it, i) => {
    const label = typeof it === 'string' ? it : it.label;
    wrap.append(el('div', { class: 'tab' + (i === activeIdx ? ' active' : ''), onclick: () => { clear(wrap).append(...render()); if (onSel) onSel(i); } }, label));
  });
  function render() {
    return items.map((it, i) => el('div', { class: 'tab' + (i === activeIdx ? ' active' : ''), onclick: () => { activeIdx = i; clear(wrap).append(...render()); if (onSel) onSel(i); } }, typeof it === 'string' ? it : it.label));
  }
  return wrap;
}

// ---------- empty / skeleton ----------
export function emptyState(title, action = null) {
  return el('div', { class: 'empty' },
    el('div', { class: 'e-ic' }, '🗂'),
    el('h3', {}, title || t('noData')),
    action ? el('div', { class: 'mt-10' }, action) : null,
  );
}
export function skeletonRows(n = 5) {
  const box = el('div', { style: 'padding:16px; display:flex; flex-direction:column; gap:12px' });
  for (let i = 0; i < n; i++) box.append(el('div', { class: 'skel', style: 'height:44px' }));
  return box;
}

// ---------- charts (SVG) ----------
export function lineChart(series, { height = 220, color = '#c9a227', fill = true, format = (v) => Math.round(v / 1e6) + 'M' } = {}) {
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) color = '#c9a227'; // color is interpolated into SVG markup — hex only
  const w = 720, h = height, padL = 10, padR = 10, padT = 18, padB = 30;
  const vals = series.map(s => s.value);
  const max = Math.max(...vals, 1), min = 0;
  const stepX = (w - padL - padR) / Math.max(1, series.length - 1);
  const pts = series.map((s, i) => [padL + i * stepX, padT + (h - padT - padB) * (1 - (s.value - min) / (max - min || 1))]);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = fill ? path + ` L${pts[pts.length - 1][0]} ${h - padB} L${pts[0][0]} ${h - padB} Z` : '';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.style.overflow = 'visible';
  if (fill) {
    const grad = document.createElementNS(ns, 'defs');
    grad.innerHTML = `<linearGradient id="lg${color.replace('#','')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
    svg.append(grad);
    const a = document.createElementNS(ns, 'path');
    a.setAttribute('d', area); a.setAttribute('fill', `url(#lg${color.replace('#','')})`);
    svg.append(a);
  }
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', '2.5'); p.setAttribute('stroke-linecap', 'round');
  svg.append(p);
  pts.forEach((pt, i) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]); c.setAttribute('r', 3.4);
    c.setAttribute('fill', color);
    const tt = document.createElementNS(ns, 'title');
    tt.textContent = series[i].label + ': ' + format(series[i].value);
    c.append(tt);
    if (series[i].href) { c.style.cursor = 'pointer'; c.addEventListener('click', () => { location.hash = series[i].href; }); }
    svg.append(c);
    if (series.length <= 14 || i % Math.ceil(series.length / 12) === 0) {
      const tx = document.createElementNS(ns, 'text');
      tx.setAttribute('x', pt[0]); tx.setAttribute('y', h - 8);
      tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('font-size', '10.5');
      tx.setAttribute('fill', 'var(--muted)');
      tx.textContent = series[i].label;
      svg.append(tx);
    }
  });
  return svg;
}
export function barChart(items, { height = 200, color = '#c9a227', format = (v) => Math.round(v) } = []) {
  const max = Math.max(...items.map(i => i.value), 1);
  const wrap = el('div', { style: `display:flex; align-items:flex-end; gap:7px; height:${height}px; padding-top:8px` });
  for (const it of items) {
    const hgt = Math.max(4, (it.value / max) * (height - 44));
    const col = el('div', { style: 'flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:5px; height:100%; justify-content:flex-end', title: it.label + ': ' + format(it.value) + (it.href ? ' (برای مشاهده کلیک کنید)' : '') },
      el('div', { style: `width:70%; height:${hgt}px; background:${it.color || color}; border-radius:5px 5px 2px 2px; opacity:0.9` + (it.href ? '; cursor:pointer' : '') }),
      el('div', { style: 'font-size:10px; color:var(--muted); white-space:nowrap; overflow:hidden; max-width:100%; text-overflow:ellipsis' }, it.label),
    );
    if (it.href) col.addEventListener('click', () => { location.hash = it.href; });
    wrap.append(col);
  }
  return wrap;
}
export function donut(items, { size = 150 } = {}) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 42 42');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  let off = 25;
  const palette = ['#c9a227', '#2a9d8f', '#e76f51', '#264653', '#7c5cd6', '#c0392b', '#3d6cb3', '#8a6d14'];
  items.forEach((it, i) => {
    const pct = (it.value / total) * 100;
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', 21); c.setAttribute('cy', 21); c.setAttribute('r', 15.9);
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', it.color || palette[i % palette.length]);
    c.setAttribute('stroke-width', 6);
    c.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);
    c.setAttribute('stroke-dashoffset', off);
    c.setAttribute('transform', 'rotate(-90 21 21)');
    const tt = document.createElementNS(ns, 'title'); tt.textContent = it.label + ': ' + it.value; c.append(tt);
    if (it.href) { c.style.cursor = 'pointer'; c.addEventListener('click', () => { location.hash = it.href; }); }
    svg.append(c);
    off = (off - pct + 100) % 100;
  });
  return el('div', { style: 'display:flex; gap:16px; align-items:center; flex-wrap:wrap' },
    svg,
    el('div', { style: 'display:flex; flex-direction:column; gap:4px; min-width:120px' },
      items.map((it, i) => {
        const row = el('div', { class: 'flex', style: 'gap:7px; font-size:12px' + (it.href ? '; cursor:pointer' : '') }, el('span', { style: `width:10px;height:10px;border-radius:3px;background:${it.color || palette[i % palette.length]}; display:inline-block` }), el('span', { class: 'muted' }, it.label), el('b', { style: 'margin-inline-start:auto' }, it.value));
        if (it.href) row.addEventListener('click', () => { location.hash = it.href; });
        return row;
      })),
  );
}
export function progressPct(pct, color) {
  return el('div', { class: 'progress', style: 'width:120px' }, el('div', { style: `width:${Math.min(100, Math.max(2, pct))}%; ${color ? 'background:' + color : ''}` }));
}

// ---------- file upload input ----------
export function fileInput(multiple = false, onChange = null) {
  const f = el('input', { type: 'file', multiple: multiple ? '' : null });
  if (onChange) f.addEventListener('change', () => onChange(f.files));
  return f;
}

// ---------- signature pad ----------
export function signaturePad(onChange = null) {
  const canvas = el('canvas', { width: 520, height: 160, style: 'border:1.5px dashed var(--border-2); border-radius:10px; touch-action:none; width:100%; background:var(--surface-2)' });
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1c1e22'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  let drawing = false, last = null, dirty = false;
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (canvas.width / r.width), y: (p.clientY - r.top) * (canvas.height / r.height) };
  }
  function start(e) { drawing = true; last = pos(e); e.preventDefault(); }
  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; dirty = true;
    if (onChange) onChange(canvas.toDataURL('image/png'));
    e.preventDefault();
  }
  function end() { drawing = false; }
  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove', move); canvas.addEventListener('touchend', end);
  return {
    canvas,
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; if (onChange) onChange(null); },
    get dataUrl() { return dirty ? canvas.toDataURL('image/png') : null; },
  };
}

// loading guard: shows a hint after `ms` if the skeleton is still there (prevents perceived freeze)
export function loadGuard(box, ms = 9000) {
  if (!box || !box.setInterval) return () => {};
  const t = setTimeout(() => {
    if (box.isConnected) {
      const d = document.createElement('div');
      d.className = 'small muted';
      d.style.cssText = 'padding:10px 16px; border-top:1px dashed var(--border)';
      d.textContent = '⏳ بارگذاری طولانی‌تر از حد معمول است. اتصال اینترنت/سرور را بررسی کنید یا صفحه را رفرش کنید.';
      box.append(d);
    }
  }, ms);
  box._guard = t;
  return () => { try { clearTimeout(t); } catch (e) {} };
}

// ---------- digital signature ----------
export function signatureModal(entityType, entityId, label, onDone) {
  const pad = signaturePad();
  const ov = openModal('امضای دیجیتال — ' + (label || ''), el('div', {},
    el('div', { class: 'alert info small mb-10' }, 'با موس یا لمس روی زیرانداز امضا کنید. امضا به صورت امن به این رکورد پیوست می‌شود و در اسناد چاپی درج خواهد شد.'),
    pad.canvas,
    el('div', { class: 'flex', style: 'justify-content:flex-start; margin-top:10px' },
      el('button', { class: 'btn sm ghost', onclick: () => pad.clear() }, 'پاک کردن'))),
    { footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
      el('button', { class: 'btn primary', onclick: () => {
        if (!pad.dataUrl) return toast('ابتدا امضا را بنویسید', 'err');
        // dataURL -> blob -> upload
        fetch(pad.dataUrl).then(r => r.blob()).then(blob => {
          const fd = new FormData();
          fd.append('file', new File([blob], 'signature.png', { type: 'image/png' }));
          fd.append('entity_type', 'signature');
          fd.append('entity_id', String(entityId));
          return api.upload('/api/attachments', fd);
        }).then(() => {
          toast('امضا ثبت شد', 'ok');
          ov.close();
          if (onDone) onDone();
        }).catch(e => toast(e.message || 'خطا در ذخیره امضا', 'err'));
      } }, t('save')),
    ] });
  return ov;
}
// ---------- export menu (Section 6: Search & Export) ----------
// buildUrl(fmt) → full URL for a format (xlsx|csv|json|html). html = printable page (print→PDF).
export function exportMenu(buildUrl, title = 'خروجی') {
  const wrap = el('div', { style: 'position:relative; display:inline-block' });
  const btn = el('button', { class: 'btn', title: 'خروجی بر اساس جستجو/فیلتر فعلی' }, '⬇ ', title, ' ▾');
  const menu = el('div', { style: 'display:none; position:absolute; top:100%; inset-inline-end:0; z-index:50; background:var(--bg,#fff); border:1px solid var(--border); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.15); min-width:190px; padding:4px' });
  const mk = (fmt, label) => {
    const a = el('a', { class: 'btn sm', style: 'display:block; width:100%', href: buildUrl(fmt), target: fmt === 'html' ? '_blank' : '_self', rel: fmt === 'html' ? 'noopener' : null }, label);
    a.addEventListener('click', () => { menu.style.display = 'none'; });
    menu.append(a);
  };
  mk('xlsx', 'Excel (XLSX)');
  mk('csv', 'CSV');
  mk('json', 'JSON');
  mk('html', 'PDF / چاپ (تاریخ شمسی)');
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
  document.addEventListener('click', () => { menu.style.display = 'none'; });
  wrap.append(btn, menu);
  return wrap;
}
// small search input wired to a reload callback (debounced)
export function searchInput(placeholder, onSearch) {
  const inp = el('input', { class: 'input', placeholder, style: 'width:300px' });
  let timer = null;
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => onSearch(inp.value.trim()), 300); });
  inp._get = () => inp.value.trim();
  return inp;
}
