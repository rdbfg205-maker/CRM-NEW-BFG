'use strict';
// Shared "AI Sales Intelligence" section — appended to the EXISTING dashboards.
// No duplicate operational KPIs: only intelligence that does not exist elsewhere,
// and drill-downs reuse existing pages where they exist (churn/leads) or go to
// the Smart Sales Team page (new capabilities).
import { api, faDigits, fmtMoney } from '../core.js';
import { el, clear } from '../ui.js';

export function aiSalesIntelligence(c) {
  const sec = el('div', { class: 'card mb-16 mt-16' });
  const head = el('div', { class: 'card-h' },
    el('h3', {}, '🧠 AI Sales Intelligence'),
    el('span', { class: 'muted small' }, 'هوش فروش — دادهٔ واقعی، بدون تکرار KPIهای بالا'),
    el('a', { class: 'btn sm', style: 'margin-inline-start:auto', href: '#/smart-sales' }, 'تیم هوشمند فروش ←'));
  const grid = el('div', { class: 'grid g-3 mt-16' });
  const card = (label, value, sub, href, color = 'var(--gold)') => {
    const cd = el('div', { class: 'card', style: 'cursor:pointer; border-inline-start:3px solid ' + color });
    cd.title = 'برای مشاهده کلیک کنید';
    cd.append(el('div', { class: 's-label' }, label));
    cd.append(el('div', { class: 's-value' }, value));
    if (sub) cd.append(el('div', { class: 's-sub' }, sub));
    cd.addEventListener('click', () => { location.hash = href; });
    return cd;
  };
  grid.append(
    card('🐢 فرصت‌های راکد', '…', 'بیش از ۲۱ روز بدون فعالیت — → لیست', '#/smart-sales', '#c0392b'),
    card('🎯 دستیابی هدف ماه', '…', 'بر اساس فاکتورهای واقعی — → هدف‌ها', '#/smart-sales', '#7c5cd6'),
    card('⭐ اقدام‌های هوشمند', '…', 'Next Best Action — → صف اقدامات', '#/smart-sales', '#c9a227'),
    card('⚠️ مشتریان در معرض ریزش', '…', 'ریسک AI — → تحلیل ریزش', '#/ai/churn', '#c0392b'),
    card('🔥 سرنخ‌های داغ', '…', 'بالای امتیاز AI — → سرنخ‌ها', '#/ai/leads', '#2a9d8f'),
    card('⏰ پیگیری‌های عقب‌افتاده', '…', 'صف هوشمند پیگیری — → صف', '#/smart-sales', '#3d6cb3'));
  sec.append(head, grid);
  c.append(sec);
  (async () => {
    const cells = [...grid.children];
    try {
      const [st, tg, act, risk, leads, fus] = await Promise.all([
        api.get('/api/smart-sales/stalled?limit=50').catch(() => ({ items: [] })),
        api.get('/api/smart-sales/targets?period_type=month').catch(() => ({ items: [] })),
        api.get('/api/smart-sales/actions?limit=50').catch(() => ({ items: [] })),
        api.get('/api/smart-sales/at-risk?limit=50').catch(() => ({ items: [] })),
        api.get('/api/smart-sales/leads?limit=50').catch(() => ({ items: [] })),
        api.get('/api/smart-sales/followups').catch(() => ({ items: [] })),
      ]);
      const setVal = (i, v, s) => { const cd = cells[i]; const sv = cd.children[1]; sv.textContent = v; const ss = cd.children[2]; if (ss) ss.textContent = s; };
      setVal(0, faDigits((st.items || []).length), (st.items || []).length ? 'نیازمند پیگیری فوری' : 'فرصت راکدی نیست');
      const curMonth = new Date().toISOString().slice(0, 7) + '-01';
      const t = (tg.items || []).find(x => x.period_start === curMonth) || (tg.items || [])[0];
      if (t) setVal(1, faDigits(t.pct) + '٪', fmtMoney(t.achieved) + ' از ' + fmtMoney(t.amount));
      else setVal(1, '—', 'هدف ماه جاری ثبت نشده است');
      const urgent = (act.items || []).filter(a => a.priority === 1).length;
      setVal(2, faDigits(urgent), (act.items || []).length + ' پیشنهاد فعال در صف');
      setVal(3, faDigits((risk.items || []).length), (risk.items || []).length ? 'نیازمند اقدام پیشگیرانه' : 'مشتری پرریسکی نیست');
      setVal(4, faDigits((leads.items || []).length), (leads.items || []).length ? 'برای تماس اولویت‌دار' : 'سرنخ داغی نیست');
      const overdue = (fus.items || []).filter(f => f.overdue);
      setVal(5, faDigits(overdue.length), overdue.length ? 'با پیشنهاد زمان جدید' : 'هیچ پیگیری عقب‌افتاده‌ای نیست');
    } catch { /* leave placeholders */ }
  })();
  return sec;
}
