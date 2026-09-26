'use strict';
// ============ Jalali Date Picker + Time Picker (no manual input) ============
// Bind to any text input: the field becomes READONLY; values come only from the
// picker. Display: 1405/06/05 [14:30]. The ISO value is exposed as input._iso.
import { jalaliLib } from './core.js';
import { el, clear } from './ui.js';

const M_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const W_FA = ['ش', 'ی', 'د', 'چ', 'پ', 'ج', 'ش']; // Saturday-first week

function pad2(n) { return String(n).padStart(2, '0'); }
function todayJ() { const d = new Date(); return jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function fmtJ(j, withTime, hour, min) {
  let s = j.jy + '/' + pad2(j.jm) + '/' + pad2(j.jd);
  if (withTime) s += ' ' + pad2(hour) + ':' + pad2(min);
  return s;
}

export function bindDatePick(input, opts = {}) {
  const withTime = !!opts.withTime;
  const onPick = opts.onPick || null;
  input.setAttribute('readonly', 'readonly');
  input.classList.add('dp-input');
  input.style.cursor = 'pointer';

  let cur = { jy: 0, jm: 0, jd: 0 };
  let hour = opts.hour != null ? Number(opts.hour) : 9;
  let min = opts.min != null ? Number(opts.min) : 0;
  let view = null;
  let popup = null;
  let wrap = null;
  let closeFn = null;

  function iso() {
    if (!cur.jy) return null;
    const g = jalaliLib().toGregorian(cur.jy, cur.jm, cur.jd);
    return new Date(g.gy, g.gm - 1, g.gd, hour, min, 0).toISOString();
  }
  function paint() { input.value = cur.jy ? fmtJ(cur, withTime, hour, min) : ''; input._iso = iso(); }

  function setFromISO(v) {
    if (!v) { cur = { jy: 0, jm: 0, jd: 0 }; paint(); return; }
    const d = new Date(v);
    if (isNaN(d.getTime())) return;
    cur = jalaliLib().toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    hour = d.getHours(); min = d.getMinutes();
    paint();
  }
  function clearValue() { cur = { jy: 0, jm: 0, jd: 0 }; paint(); }
  function getValue() { return input._iso || null; }

  function build() {
    const p = el('div', { class: 'dp-popup', style: 'position:absolute; top:100%; right:0; z-index:60; background:var(--bg, #fff); border:1px solid var(--border); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.18); padding:10px; width:264px; margin-top:4px' });
    const head = el('div', { class: 'flex between', style: 'align-items:center; margin-bottom:8px' });
    const nav = (txt, fn, title) => { const b = el('button', { class: 'icon-btn', title, html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + txt + '</svg>' }); b.onclick = fn; return b; };
    const mv = (delta) => { let jm = view.jm + delta, jy = view.jy; if (jm < 1) { jm = 12; jy--; } if (jm > 12) { jm = 1; jy++; } view = { jy, jm }; renderGrid(); };
    head.append(
      nav('<polyline points="15 18 9 12 15 6"/>', () => mv(-1), 'ماه قبل'),
      el('b', { class: 'small', id: 'dp-title' }),
      el('div', { class: 'flex' },
        nav('<polyline points="9 18 15 12 9 6"/>', () => mv(1), 'ماه بعد'),
        (() => { const b = el('button', { class: 'btn sm', type: 'button' }, 'امروز'); b.onclick = () => { const t = todayJ(); view = { jy: t.jy, jm: t.tj ? t.jm : t.jm }; cur = t; paint(); close(); }; return b; })())
    );
    p.append(head);
    const wdRow = el('div', { style: 'display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center' });
    for (const w of W_FA) wdRow.append(el('div', { class: 'muted', style: 'font-size:11px; padding:3px 0' }, w));
    p.append(wdRow);
    const grid = el('div', { style: 'display:grid; grid-template-columns:repeat(7,1fr); gap:2px' });
    p.append(grid);
    if (withTime) {
      const tRow = el('div', { class: 'flex', style: 'gap:6px; margin-top:8px; align-items:center' });
      const hSel = el('select', { class: 'input', style: 'flex:1' });
      const mSel = el('select', { class: 'input', style: 'flex:1' });
      for (let h = 0; h < 24; h++) hSel.append(el('option', { value: h }, pad2(h)));
      for (let m = 0; m < 60; m += 5) mSel.append(el('option', { value: m }, pad2(m)));
      hSel.value = String(hour); mSel.value = String(min);
      hSel.onchange = () => { hour = Number(hSel.value); paint(); };
      mSel.onchange = () => { min = Number(mSel.value); paint(); };
      tRow.append(el('span', { class: 'small' }, 'ساعت:'), hSel, el('span', { class: 'small' }, 'دقیقه:'), mSel);
      p.append(tRow);
    }
    function renderGrid() {
      const title = p.querySelector('#dp-title');
      if (title) title.textContent = M_FA[view.jm - 1] + ' ' + view.jy;
      clear(grid);
      const firstG = jalaliLib().toGregorian(view.jy, view.jm, 1);
      const firstWd = (new Date(firstG.gy, firstG.gm - 1, firstG.gd).getDay() + 1) % 7; // Saturday=0
      const days = jalaliLib().monthLength(view.jy, view.jm);
      const t = todayJ();
      for (let i = 0; i < firstWd; i++) grid.append(el('div'));
      for (let jd = 1; jd <= days; jd++) {
        const sel = cur.jy === view.jy && cur.jm === view.jm && cur.jd === jd;
        const isToday = t.jy === view.jy && t.jm === view.jm && t.jd === jd;
        const cell = el('div', {
          style: 'display:flex; align-items:center; justify-content:center; padding:6px 0; border-radius:8px; cursor:pointer; font-size:13px; ' +
            (sel ? 'background:var(--gold,#c9a227); color:#fff; font-weight:700; ' : isToday ? 'border:1px solid var(--gold,#c9a227); font-weight:700; ' : 'hover:opacity:.7'),
        }, String(jd));
        cell.onclick = () => {
          cur = { jy: view.jy, jm: view.jm, jd };
          paint(); close();
          if (onPick) onPick(iso());
        };
        grid.append(cell);
      }
    }
    renderGrid();
    return p;
  }

  function open() {
    if (popup) return;
    if (!cur.jy) { const t = todayJ(); view = { jy: t.jy, jm: t.jm }; } else view = { jy: cur.jy, jm: cur.jm };
    if (!wrap) {
      wrap = el('div', { style: 'position:relative; display:block; width:100%' });
      const inp = input;
      input.parentNode.insertBefore(wrap, inp);
      wrap.append(inp);
    }
    popup = build();
    wrap.append(popup);
    closeFn = (e) => { if (!wrap.contains(e.target)) close(); };
    document.addEventListener('click', closeFn, true);
  }
  function close() {
    if (popup) { popup.remove(); popup = null; }
    if (closeFn) { document.removeEventListener('click', closeFn, true); closeFn = null; }
  }
  input.addEventListener('click', () => open());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  paint();
  return { set: setFromISO, clear: clearValue, get: getValue, open, close };
}
