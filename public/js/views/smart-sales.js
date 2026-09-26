'use strict';
// ============ تیم هوشمند فروش — Smart Sales Team (page with a DISTINCT purpose) ============
// NOT a second sales dashboard: this page surfaces intelligence (Next Best Action, Smart
// Follow-up, Target achievement, Stalled, High-Priority, At-Risk, AI Assistant).
// All data is real (database-backed) and drill-down links go to the real record pages.
import { api, t, fmtNum, fmtMoney, fmtDate, faDigits } from '../core.js';
import { el, clear, toast, openModal, confirmDialog } from '../ui.js';
import { helpBtn } from './help.js';
import { customerSelect } from '../customer-select.js';

const TYPE_FA = {
  call: ['تماس', '#2a9d8f'], follow_up: ['پیگیری', '#c9a227'], payment: ['وصول', '#7c5cd6'],
  escalation: ['اعتراض', '#c0392b'], reactivation: ['فعال‌سازی', '#3d6cb3'],
};
function typeBadge(type) {
  const [fa, c] = TYPE_FA[type] || [type, '#888'];
  return el('span', { class: 'badge', style: `background:${c}22;color:${c};border:1px solid ${c}` }, fa);
}
function prioPill(p) {
  const map = { 1: ['فوری', '#c0392b'], 2: ['مهم', '#c9a227'], 3: ['عادی', '#3d6cb3'] };
  const [fa, c] = map[p] || map[3];
  return el('span', { class: 'badge', style: `background:${c}22;color:${c};border:1px solid ${c}` }, fa);
}
function go(hash) { location.hash = hash; }

export async function smartSalesPage(c) {
  const me = window.__me && window.__me();
  const canUse = me && me.permissions && me.permissions.smart_sales && me.permissions.smart_sales.use;
  const canManage = me && me.permissions && me.permissions.smart_sales && me.permissions.smart_sales.manage;
  clear(c);
  const ph = el('div', { class: 'page-head' },
    el('div', {}, el('h1', {}, '🧠 تیم هوشمند فروش'), el('div', { class: 'sub' }, 'هوش فروش — Next Best Action، پیگیری هوشمند، هدف‌ها، فرصت‌های راکد، سرنخ‌های داغ و مشتریان در معرض ریزش (دادهٔ واقعی CRM)')),
    el('div', { class: 'actions' }, helpBtn('smart-sales')));
  c.append(ph);

  // ---------- AI Orchestrator status bar ----------
  const aiBox = el('div');
  c.append(el('div', { class: 'card mb-16' }, el('div', { class: 'card-b' }, aiBox)));
  loadAiStatus(aiBox);

  // ---------- Next Best Action ----------
  const actCard = el('div', { class: 'card mb-16' });
  c.append(actCard);
  loadActions(actCard, canUse);

  // ---------- Smart Follow-up ----------
  const fuCard = el('div', { class: 'card mb-16' });
  c.append(fuCard);
  loadSmartFollowups(fuCard, canUse);

  // ---------- Targets ----------
  const tgCard = el('div', { class: 'card mb-16' });
  c.append(tgCard);
  loadTargets(tgCard, canManage);

  // ---------- Stalled / High-Priority / At-Risk (three columns) ----------
  // The three loaders resolve independently; each mounts into its own pre-created
  // slot so the column order stays stable no matter which request returns first.
  const grid = el('div', { class: 'grid g-3 mb-16' });
  grid.append(el('div'), el('div'), el('div')); // placeholder slots, replaced by mountSlot()
  c.append(grid);
  loadStalled(grid, 0);
  loadHighPriorityLeads(grid, 1);
  loadAtRisk(grid, 2);

  // ---------- Smart Team: Tasks / Competitors / Ideas ----------
  const taskCard = el('div', { class: 'card mb-16' });
  c.append(taskCard);
  loadTeamTasks(taskCard, canUse);

  const compCard = el('div', { class: 'card mb-16' });
  c.append(compCard);
  loadCompetitors(compCard, canManage);

  const ideaCard = el('div', { class: 'card mb-16' });
  c.append(ideaCard);
  loadIdeas(ideaCard, canUse);

  // ---------- AI Sales Assistant ----------
  const aiCard = el('div', { class: 'card mb-16' });
  c.append(aiCard);
  loadAssistant(aiCard);
}

// ================= Team Tasks (مأموریت‌های تیم هوشمند) =================
const TASK_STATUS_FA = { open: 'در انتظار', in_progress: 'در حال انجام', blocked: 'مسدود', done: 'انجام‌شده', cancelled: 'لغوشده' };
const TASK_NEXT = { open: [['in_progress', '▶ شروع']], in_progress: [['blocked', '⛔ مسدود'], ['done', '✓ انجام شد'], ['cancelled', 'لغو']], blocked: [['in_progress', '▶ ادامه']], done: [], cancelled: [['open', 'بازگشت']] };
async function loadTeamTasks(card, canUse) {
  const body = el('div');
  card.append(el('div', { class: 'card-h' }, el('h3', {}, '🎯 مأموریت‌های تیم هوشمند'), el('span', { class: 'muted small' }, 'وظایف با پیوند به مشتری/فرصت/ایده — وضعیت: در انتظار → در حال انجام → انجام‌شده (＋ مسدود/لغو)')),
    el('div', { class: 'actions' }, canUse ? el('button', { class: 'btn gold sm', onclick: () => teamTaskModal() }, '＋ ثبت مأموریت') : null));
  card.append(el('div', { class: 'card-b' }, body));
  skel(body, 100);
  try {
    const { items } = await api.get('/api/smart-sales/team-tasks');
    clear(body);
    if (!items.length) return body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'مأموریتی ثبت نشده است.'));
    const rows = items.map(t => {
      const acts = el('div', { class: 'flex', style: 'gap:4px' });
      for (const [st, l] of TASK_NEXT[t.status] || []) {
        acts.append(el('button', { class: 'btn sm ' + (st === 'done' ? 'primary' : 'ghost'), onclick: async (e) => {
          e.stopPropagation();
          try { await api.post('/api/smart-sales/team-tasks/' + t.id + '/status', { status: st }); toast('وضعیت به‌روزرسانی شد', 'ok'); loadTeamTasks(card, canUse); } catch (er) { toast(er.message, 'err'); }
        } }, l));
      }
      return el('div', { class: 'flex between', style: 'padding:10px 16px; border-top:1px solid var(--border)' },
        el('div', {},
          el('b', { class: 'small' }, t.title),
          el('div', { class: 'muted small' }, [t.customer_name ? 'مشتری: ' + t.customer_name : null, t.assignee_name ? 'مسئول: ' + t.assignee_name : null, t.due_at ? 'سررسید: ' + fmtDate(t.due_at) : null, t.description].filter(Boolean).join(' • '))),
        el('div', { class: 'flex', style: 'align-items:center; gap:6px' },
          prioPill(t.priority), el('span', { class: 'badge ' + (t.status === 'done' ? 'green' : t.status === 'blocked' ? 'red' : t.status === 'in_progress' ? 'gold' : 'muted') }, TASK_STATUS_FA[t.status] || t.status),
          acts));
    });
    body.append(...rows);
  } catch (e) { clear(body).append(el('div', { class: 'alert danger' }, e.message)); }
}
async function teamTaskModal() {
  const title = el('input', { placeholder: 'عنوان مأموریت *' });
  const desc = el('textarea', { placeholder: 'توضیحات / هدف' });
  const custCtl = customerSelect({ value: null });
  const assignee = el('select', {});
  assignee.append(el('option', { value: '' }, 'خودم'));
  try { const teams = await api.get('/api/calendar/teams'); for (const u of (teams.users || [])) assignee.append(el('option', { value: u.id }, u.full_name)); } catch {}
  const prio = el('select', {}, el('option', { value: 'medium' }, 'اولویت: متوسط'), el('option', { value: 'high' }, 'اولویت: بالا'), el('option', { value: 'low' }, 'اولویت: پایین'));
  const days = el('input', { type: 'number', placeholder: '۷', style: 'width:100px' });
  const ov = openModal('مأموریت جدید برای تیم هوشمند', el('div', { class: 'form-grid' },
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'عنوان *'), title),
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'توضیحات / هدف'), desc),
    el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', {}, 'مشتری مرتبط'), custCtl),
    el('div', { class: 'field' }, el('label', {}, 'مسئول'), assignee),
    el('div', { class: 'field' }, el('label', {}, 'اولویت'), prio),
    el('div', { class: 'field' }, el('label', {}, 'سررسید (تعداد روز از الآن)'), days)), {
    footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: async () => {
        if (!title.value.trim()) return toast('عنوان الزامی است', 'err');
        try {
          const r = await api.post('/api/smart-sales/team-tasks', { title: title.value.trim(), description: desc.value.trim(), customer_id: custCtl.value || null, assignee_id: assignee.value ? Number(assignee.value) : null, priority: prio.value, due_days: days.value ? Number(days.value) : null });
          toast('مأموریت ثبت شد (task #' + r.task_id + ')', 'ok'); ov.close();
          location.reload();
        } catch (e) { toast(e.message, 'err'); }
      } }, 'ثبت')
    ]
  });
}

// ================= Competitor Analysis (تحلیل رقبا) =================
const COMP_FA = { products: 'محصولات', price_level: 'سطح قیمت', strengths: 'نقاط قوت', weaknesses: 'نقاط ضعف', target_market: 'بازار هدف', target_segments: 'بخش‌های هدف', advantages_ours: 'مزیت ما', threats: 'تهدیدها', opportunities: 'فرصت‌ها', notes: 'یادداشت' };
async function loadCompetitors(card, canManage) {
  const body = el('div');
  card.append(el('div', { class: 'card-h' }, el('h3', {}, '🥊 تحلیل رقبا'), el('span', { class: 'muted small' }, 'پرونده رقبا — محصولات، قیمت، نقاط قوت/ضعف، بازار و تهدیدها/فرصت‌ها'),
    el('div', { class: 'actions' }, canManage ? el('button', { class: 'btn gold sm', onclick: () => compModal(null, card) }, '＋ ثبت رقیب') : null)));
  card.append(el('div', { class: 'card-b' }, body));
  skel(body, 80);
  try {
    const { items } = await api.get('/api/smart-sales/competitors');
    clear(body);
    if (!items.length) return body.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'رقیبی ثبت نشده است.'));
    for (const comp of items) {
      const box = el('div', { style: 'border-top:1px solid var(--border); padding:12px 16px' });
      const head = el('div', { class: 'flex between' },
        el('b', {}, comp.name + (comp.price_level ? ' — ' + comp.price_level : '')),
        canManage ? el('div', { class: 'flex', style: 'gap:4px' }, el('button', { class: 'btn sm ghost', onclick: () => compModal(comp, card) }, 'ویرایش'), el('button', { class: 'btn sm danger ghost', onclick: async () => { if (await confirmDialog('حذف رقیب', '«' + comp.name + '» حذف شود؟', 'حذف', true)) { try { await api.del('/api/smart-sales/competitors/' + comp.id); toast('حذف شد', 'ok'); loadCompetitors(card, canManage); } catch (e) { toast(e.message, 'err'); } } } }, 'حذف')) : null);
      box.append(head);
      const grid = el('div', { class: 'grid g-2 small', style: 'margin-top:8px' });
      for (const k of Object.keys(COMP_FA)) {
        const v = comp[k];
        if (!v) continue;
        grid.append(el('div', {}, el('span', { class: 'muted' }, COMP_FA[k] + ': '), String(v)));
      }
      if (grid.children.length) box.append(grid);
      body.append(box);
    }
  } catch (e) { clear(body).append(el('div', { class: 'alert danger' }, e.message)); }
}
function compModal(comp, card) {
  const fields = ['name', 'products', 'price_level', 'strengths', 'weaknesses', 'target_market', 'target_segments', 'advantages_ours', 'threats', 'opportunities', 'notes'];
  const labels = { name: 'نام رقیب *', products: 'محصولات', price_level: 'سطح قیمت (پایین‌تر/مشابه/بالاتر)', strengths: 'نقاط قوت', weaknesses: 'نقاط ضعف', target_market: 'بازار هدف', target_segments: 'مشتریان/بخش‌های هدف', advantages_ours: 'مزیت رقابتی ما نسبت به او', threats: 'تهدیدها', opportunities: 'فرصت‌ها', notes: 'یادداشت' };
  const ctrls = {};
  const box = el('div', { class: 'form-grid' });
  for (const k of fields) {
    const big = ['products', 'strengths', 'weaknesses', 'advantages_ours', 'threats', 'opportunities', 'notes'].includes(k);
    const inp = big ? el('textarea', { placeholder: labels[k] }) : el('input', { placeholder: labels[k] });
    if (comp) inp.value = comp[k] || '';
    ctrls[k] = inp;
    box.append(el('div', { class: big ? 'field' : 'field', style: big ? 'grid-column:1/-1' : '' }, el('label', {}, labels[k]), inp));
  }
  const ov = openModal(comp ? 'ویرایش رقیب: ' + comp.name : 'رقیب جدید', box, {
    footer: [
      el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: async () => {
        const b = {};
        for (const k of fields) b[k] = ctrls[k].value.trim();
        if (!b.name) return toast('نام رقیب الزامی است', 'err');
        try {
          if (comp) await api.put('/api/smart-sales/competitors/' + comp.id, b);
          else await api.post('/api/smart-sales/competitors', b);
          toast('ذخیره شد', 'ok'); ov.close(); if (card) loadCompetitors(card, true);
        } catch (e) { toast(e.message, 'err'); }
      } }, 'ذخیره')
    ]
  });
}

// ================= Idea Generation (خلق ایده — داده‌محور) =================
const IDEA_CAT_FA = { sales: 'فروش', marketing: 'بازاریابی', customer_growth: 'افزایش مشتری', customer_retention: 'حفظ مشتری', new_product: 'محصول جدید', service: 'بهبود خدمات', cost: 'کاهش هزینه', process: 'بهبود فرآیند', productivity: 'بهره‌وری', market_dev: 'توسعه بازار', competitive: 'مزیت رقابتی' };
const IDEA_STATUS_FA = { proposed: 'پیشنهادی', approved: 'تأییدشده', rejected: 'ردشده', done: 'انجام‌شده/تبدیل‌شده' };
async function loadIdeas(card, canUse) {
  const body = el('div');
  card.append(el('div', { class: 'card-h' }, el('h3', {}, '💡 خلق ایده'), el('span', { class: 'muted small' }, 'تولید ایده بر اساس داده واقعی CRM (ریزش، فرصت‌های راکد، فروش محصولات، پیگیری‌های معوق) — بدون داده ساختگی')),
    el('div', { class: 'actions' }, canUse ? el('button', { class: 'btn gold sm', onclick: async () => {
      const btn = event.target; btn.disabled = true;
      try {
        const r = await api.post('/api/smart-sales/ideas/generate', {});
        genBox.innerHTML = '';
        genBox.append(el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'منبع: ' + r.source + ' — ' + (r.honesty || '')));
        for (const g of (r.ideas || [])) {
          genBox.append(el('div', { class: 'flex between', style: 'padding:9px 0; border-top:1px solid var(--border); align-items:center' },
            el('div', {}, el('b', { class: 'small' }, g.title), el('div', { class: 'muted small' }, (g.data_refs || '').slice(0, 140)), el('span', { class: 'badge muted' }, IDEA_CAT_FA[g.category] || g.category)),
            el('button', { class: 'btn sm', onclick: async (e) => { e.stopPropagation(); try { await api.post('/api/smart-sales/ideas', g); toast('ایده ثبت شد', 'ok'); loadIdeas(card, canUse); } catch (er) { toast(er.message, 'err'); } } }, '＋ ثبت')));
        }
        if (!(r.ideas || []).length) genBox.append(el('div', { class: 'muted small' }, 'بر اساس داده فعلی CRM، ایده جدیدی پیشنهاد نمی‌شود.'));
      } catch (e) { toast(e.message, 'err'); }
      btn.disabled = false;
    } }, '🔄 تولید از داده CRM') : null));
  card.append(el('div', { class: 'card-b' }, body));
  const genBox = el('div', { style: 'margin-bottom:10px' });
  body.append(genBox);
  skel(body, 80);
  try {
    const { items } = await api.get('/api/smart-sales/ideas');
    const list = el('div');
    for (const it of items) {
      const acts = el('div', { class: 'flex', style: 'gap:4px' });
      if (it.status === 'proposed' && canUse) {
        acts.append(el('button', { class: 'btn sm primary ghost', onclick: async () => { try { await api.post('/api/smart-sales/ideas/' + it.id + '/status', { status: 'approved' }); toast('تأیید شد', 'ok'); loadIdeas(card, canUse); } catch (e) { toast(e.message, 'err'); } } }, '✓ تأیید'));
        acts.append(el('button', { class: 'btn sm ghost', onclick: async () => { try { await api.post('/api/smart-sales/ideas/' + it.id + '/status', { status: 'rejected' }); toast('رد شد', 'ok'); loadIdeas(card, canUse); } catch (e) { toast(e.message, 'err'); } } }, 'رد'));
      }
      if (it.status === 'approved' && canUse) {
        acts.append(el('button', { class: 'btn sm gold', onclick: async () => {
          const days = prompt('سررسید Task (روز) — خالی = بدون سررسید', '7');
          if (days === null) return;
          try { const r = await api.post('/api/smart-sales/ideas/' + it.id + '/task', { due_days: days ? Number(days) : null }); toast('به Task تبدیل شد (task #' + r.task_id + ')', 'ok'); loadIdeas(card, canUse); } catch (e) { toast(e.message, 'err'); }
        } }, '→ تبدیل به Task'));
      }
      if (it.task_id) acts.append(el('span', { class: 'badge muted' }, 'task #' + it.task_id));
      body2append(el('div', { class: 'flex between', style: 'padding:10px 16px; border-top:1px solid var(--border)' },
        el('div', {},
          el('b', { class: 'small' }, it.title),
          el('div', { class: 'muted small' }, [IDEA_CAT_FA[it.category] || it.category, it.owner_name ? 'مسئول: ' + it.owner_name : null, it.reason, it.data_refs].filter(Boolean).join(' • ').slice(0, 220))),
        el('div', { class: 'flex', style: 'align-items:center; gap:6px' }, el('span', { class: 'badge ' + (it.status === 'approved' ? 'green' : it.status === 'rejected' ? 'red' : it.status === 'done' ? 'muted' : 'gold') }, IDEA_STATUS_FA[it.status] || it.status), acts)));
    }
    body.append(list);
    if (!items.length) body.append(el('div', { class: 'muted small', style: 'padding:10px 0' }, 'ایده‌ای ثبت نشده — «تولید از داده CRM» را بزنید.'));
  } catch (e) { clear(body).append(el('div', { class: 'alert danger' }, e.message)); }
  function body2append(x) { body.append(x); }
}

function cardShell(title, sub, body, actions = []) {
  const card = el('div', {}, el('div', { class: 'card-h' }, el('h3', {}, title), sub ? el('span', { class: 'muted small' }, sub) : null, ...actions), el('div', { class: 'card-b' }, body));
  return { card, body };
}
function skel(body, h = 120) { body.append(el('div', { class: 'skel', style: `height:${h}px` })); }

async function loadAiStatus(box) {
  skel(box, 40);
  try {
    const s = await api.get('/api/ai/status');
    clear(box);
    const modeFa = { auto: 'خودکار', online_only: 'فقط آنلاین', offline_only: 'فقط آفلاین', hybrid: 'Hybrid (ترکیبی)' }[s.mode] || s.mode;
    const chain = s.chain.map(x => ({ online: 'آنلاین', local: 'LLM محلی', local_intelligence: 'هوش محلی' }[x] || x)).join(' ← ');
    const lv = (st, okFa, warnFa, offFa) => {
      if (st.status === 'ready') return el('span', { class: 'badge', style: 'background:#2a9d8f22;color:#2a9d8f;border:1px solid #2a9d8f' }, okFa);
      if (st.status === 'ready_pending_test') return el('span', { class: 'badge', style: 'background:#c9a22722;color:#c9a227;border:1px solid #c9a227' }, 'پیکربندی‌شده — برای اطمینان تست کنید');
      if (st.status === 'not_configured') return el('span', { class: 'badge', style: 'background:#c0392b22;color:#c0392b;border:1px solid #c0392b' }, warnFa);
      return el('span', { class: 'badge muted' }, offFa);
    };
    const online = s.levels.online, local = s.levels.local, li = s.levels.local_intelligence;
    box.append(
      el('div', { class: 'flex wrap', style: 'gap:10px; align-items:center' },
        el('div', {}, el('b', {}, 'حالت AI: '), el('span', { class: 'badge', style: 'background:#7c5cd622;color:#7c5cd6;border:1px solid #7c5cd6' }, modeFa)),
        el('div', {}, el('b', {}, 'زنجیره: '), el('span', { class: 'muted small' }, chain)),
        el('div', {}, el('b', {}, 'آنلاین: '), lv(online, 'آماده', 'بدون کلید', 'غیرفعال')),
        el('div', {}, el('b', {}, 'LLM محلی: '), lv(local, 'آماده', 'بدون endpoint', 'غیرفعال')),
        el('div', {}, el('b', {}, 'هوش محلی: '), lv(li, 'همیشه فعال', '', 'غیرفعال')),
        el('a', { class: 'btn sm', style: 'margin-inline-start:auto', onclick: () => go('#/admin/settings?tab=ai') }, '⚙ تنظیمات AI')));
    box.append(el('div', { class: 'muted small', style: 'margin-top:8px' }, 'آفلاین ≠ غیرفعال: حتی بدون اینترنت و بدون LLM محلی، هوش محلی (Scoring/Forecast/NBA/هدف) فعال می‌ماند.'));
  } catch (e) { clear(box); box.append(el('div', { class: 'alert danger' }, e.message)); }
}

async function loadActions(card, canUse) {
  const body = el('div');
  const { card: c2, body: b2 } = cardShell('⭐ اقدام بعدی هوشمند (Next Best Action)', 'پیشنهاد بر اساس دادهٔ واقعی — کلیک = رکورد واقعی', body);
  clear(card); card.append(c2);
  clear(body); skel(body, 140);
  try {
    const r = await api.get('/api/smart-sales/actions?limit=30');
    clear(body);
    if (!r.items || !r.items.length) { body.append(el('div', { class: 'muted' }, 'در حال حاضر پیشنهادی در اولویت نیست.')); return; }
    const tbl = el('table', { class: 'tbl' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, 'اولویت'), el('th', {}, 'نوع'), el('th', {}, 'اقدام'), el('th', {}, 'دلیل / منبع'), el('th', {}, ''))));
    const tb = el('tbody');
    for (const a of r.items) {
      const href = {
        customer: '#/customers/' + a.entity_id, lead: '#/leads', opportunity: '#/opportunities',
        complaint: '#/complaints', invoice: '#/invoices', followup: '#/followups',
      }[a.entity] || '#/';
      tb.append(el('tr', {},
        el('td', {}, prioPill(a.priority)),
        el('td', {}, typeBadge(a.type)),
        el('td', {}, el('a', { href, style: 'color:var(--gold); text-decoration:none' }, a.title + (a.score ? ' (' + faDigits(a.score) + '٪)' : ''))),
        el('td', { class: 'muted small' }, a.reason || ''),
        el('td', {}, canUse && a.entity === 'followup' ? el('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { await api.post('/api/smart-sales/followups/' + a.entity_id + '/task'); toast('Task ساخته شد', 'ok'); loadActions(card, canUse); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; } } }, '＋ Task') : null)));
    }
    tbl.append(tb); body.append(tbl);
  } catch (e) { clear(body); body.append(el('div', { class: 'alert danger' }, e.message)); }
}

async function loadSmartFollowups(card, canUse) {
  const body = el('div');
  const { card: c2, body: b2 } = cardShell('⏰ صف پیگیری هوشمند', 'پیگیری‌های عقب‌افتاده + پیشنهاد زمان مناسب + ساخت Task', body);
  clear(card); card.append(c2);
  clear(body); skel(body, 120);
  try {
    const r = await api.get('/api/smart-sales/followups');
    clear(body);
    if (!r.items || !r.items.length) { body.append(el('div', { class: 'muted' }, 'پیگیری در انتظارِ نزدیک یا عقب‌افتاده‌ای نیست.')); return; }
    const tbl = el('table', { class: 'tbl' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, 'موضوع'), el('th', {}, 'مشتری'), el('th', {}, 'سررسید'), el('th', {}, 'وضعیت'), el('th', {}, 'پیشنهاد زمان'), el('th', {}, ''))));
    const tb = el('tbody');
    for (const f of r.items) {
      const href = f.entity_type === 'customer' ? '#/customers/' + f.entity_id : (f.entity_type === 'lead' ? '#/leads' : '#/');
      tb.append(el('tr', {},
        el('td', {}, el('a', { href, style: 'color:var(--gold); text-decoration:none' }, f.subject || 'بدون موضوع')),
        el('td', {}, f.customer_name || '—'),
        el('td', {}, fmtDate(f.due_at)),
        el('td', {}, f.overdue ? el('span', { class: 'badge', style: 'background:#c0392b22;color:#c0392b;border:1px solid #c0392b' }, 'عقب‌افتاده (' + faDigits(f.overdue_days) + ' روز)') : el('span', { class: 'badge muted' }, 'پیش‌رو')),
        el('td', { class: 'small' }, fmtDate(f.suggested_at)),
        el('td', {}, canUse ? el('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { const rr = await api.post('/api/smart-sales/followups/' + f.id + '/task'); toast('Task ساخته شد (سررسید: ' + fmtDate(rr.due_at) + ')', 'ok'); loadSmartFollowups(card, canUse); } catch (er) { toast(er.message, 'err'); e.target.disabled = false; } } }, '＋ Task') : null)));
    }
    tbl.append(tb); body.append(tbl);
  } catch (e) { clear(body); body.append(el('div', { class: 'alert danger' }, e.message)); }
}

async function loadTargets(card, canManage) {
  const body = el('div');
  const act = canManage ? [el('button', { class: 'btn sm', onclick: () => targetModal() }, '＋ ثبت هدف'), el('button', { class: 'btn sm', onclick: async () => { try { const r = await api.post('/api/smart-sales/rescore'); toast('بازامتیازگذاری: ' + faDigits(r.leads) + ' سرنخ / ' + faDigits(r.customers) + ' مشتری', 'ok'); loadTargets(card, canManage); } catch (e) { toast(e.message, 'err'); } } }, '↻ بازامتیازگذاری AI')] : [];
  const { card: c2, body: b2 } = cardShell('🎯 هدف‌های فروش (Target Engine)', 'دست‌یابی واقعی بر اساس فاکتورها — دورهٔ ماه/فصل/سال', body, act);
  clear(card); card.append(c2);
  clear(body); skel(body, 120);
  try {
    const r = await api.get('/api/smart-sales/targets');
    clear(body);
    if (!r.items || !r.items.length) { body.append(el('div', { class: 'muted' }, canManage ? 'هنوز هدفی ثبت نشده است. با «ثبت هدف» شروع کنید.' : 'هدفی ثبت نشده است.')); return; }
    for (const t of r.items) {
      const scopeFa = { company: 'شرکت', department: 'دپارتمان: ' + t.scope_name, salesperson: t.scope_name || 'فروشنده' }[t.scope_type] || t.scope_type;
      const periodFa = { month: 'ماه', quarter: 'فصل', year: 'سال' }[t.period_type] || t.period_type;
      const bar = el('div', { style: 'height:8px; background:var(--surface-2); border-radius:6px; overflow:hidden; margin-top:6px' });
      bar.append(el('div', { style: `height:100%; width:${t.pct}%; background:${t.pct >= 100 ? '#2a9d8f' : t.pct >= 60 ? '#c9a227' : '#c0392b'}; border-radius:6px; transition:width .4s` }));
      body.append(el('div', { style: 'padding:10px 0; border-bottom:1px solid var(--border)' },
        el('div', { class: 'flex between', style: 'align-items:center' },
          el('div', {}, el('b', {}, scopeFa), el('span', { class: 'muted small' }, ' — ' + periodFa + ' از ' + fmtDate(t.period_start))),
          el('div', { class: 'flex', style: 'gap:14px' },
            el('div', {}, el('b', {}, faDigits(t.pct) + '٪'), el('div', { class: 'muted small' }, fmtMoney(t.achieved) + ' / ' + fmtMoney(t.amount))),
            canManage ? el('button', { class: 'icon-btn', title: 'حذف', onclick: async () => { if (!await confirmDialog('حذف هدف', 'این هدف حذف شود؟', 'حذف', true)) return; try { await api.del('/api/smart-sales/targets/' + t.id); toast('حذف شد', 'ok'); loadTargets(card, canManage); } catch (e) { toast(e.message, 'err'); } } }, '🗑') : null)),
        bar));
    }
  } catch (e) { clear(body); body.append(el('div', { class: 'alert danger' }, e.message)); }
}
function targetModal() {
  const scopeSel = el('select', {}, el('option', { value: 'company' }, 'کل شرکت'), el('option', { value: 'department' }, 'دپارتمان'), el('option', { value: 'salesperson' }, 'فروشنده'));
  const deptIn = el('input', { placeholder: 'نام دپارتمان (مثلاً sales)', style: 'display:none' });
  const userSel = el('select', { style: 'display:none' }, el('option', { value: '' }, 'انتخاب کاربر…'));
  const periodSel = el('select', {}, el('option', { value: 'month' }, 'ماه'), el('option', { value: 'quarter' }, 'فصل'), el('option', { value: 'year' }, 'سال'));
  const dateIn = el('input', { type: 'date' });
  const amountIn = el('input', { type: 'number', placeholder: 'مبلغ هدف (ریال)', dir: 'ltr' });
  scopeSel.addEventListener('change', () => {
    deptIn.style.display = scopeSel.value === 'department' ? '' : 'none';
    userSel.style.display = scopeSel.value === 'salesperson' ? '' : 'none';
  });
  api.get('/api/admin/users?per_page=200').then(r => { for (const u of (r.items || [])) userSel.append(el('option', { value: u.id }, u.full_name + ' (' + u.username + ')')); }).catch(() => {});
  const ov = openModal('ثبت هدف فروش', el('div', { class: 'form-grid' },
    el('div', { class: 'field' }, el('label', {}, 'سطح هدف'), scopeSel),
    el('div', { class: 'field' }, el('label', {}, 'دپارتمان'), deptIn),
    el('div', { class: 'field' }, el('label', {}, 'فروشنده'), userSel),
    el('div', { class: 'field' }, el('label', {}, 'دوره'), periodSel),
    el('div', { class: 'field' }, el('label', {}, 'شروع دوره'), dateIn),
    el('div', { class: 'field' }, el('label', {}, 'مبلغ هدف (ریال)'), amountIn)), {
    footer: [el('button', { class: 'btn', onclick: () => ov.close() }, 'انصراف'),
      el('button', { class: 'btn primary', onclick: async () => {
        const body = { scope_type: scopeSel.value, period_type: periodSel.value, period_start: dateIn.value, amount: Number(amountIn.value) || 0 };
        if (scopeSel.value === 'department') body.scope_name = deptIn.value.trim();
        if (scopeSel.value === 'salesperson') { body.scope_ref = userSel.value; body.scope_name = userSel.options[userSel.selectedIndex]?.text || ''; }
        if (!body.period_start) return toast('شروع دوره را انتخاب کنید', 'err');
        try { await api.post('/api/smart-sales/targets', body); toast('هدف ثبت شد', 'ok'); ov.close(); location.hash = '#/smart-sales'; } catch (e) { toast(e.message, 'err'); }
      } }, 'ثبت هدف')] });
}

// Element.children is a read-only HTMLCollection — `children[i] = node` throws
// "Indexed property setter is not supported" in strict mode (ES modules are strict),
// which killed all three Smart-Sales columns. Mount through real DOM APIs instead.
function mountSlot(grid, i, node) {
  const ref = grid.children[i];
  if (ref && ref !== node) grid.replaceChild(node, ref);
  else if (!ref) grid.append(node);
  return node;
}

async function loadStalled(grid, i) {
  const card = el('div', { class: 'card' });
  mountSlot(grid, i, card);
  const body = el('div');
  card.append(el('div', { class: 'card-h' }, el('h3', {}, '🐢 فرصت‌های راکد'), el('span', { class: 'muted small' }, 'بیش از ۲۱ روز بدون فعالیت')), el('div', { class: 'card-b' }, body));
  skel(body, 120);
  try {
    const r = await api.get('/api/smart-sales/stalled');
    clear(body);
    if (!r.items || !r.items.length) { body.append(el('div', { class: 'muted' }, 'فرصت راکدی نیست.')); return; }
    for (const o of r.items) {
      body.append(el('div', { style: 'padding:8px 0; border-bottom:1px solid var(--border)' },
        el('div', { class: 'flex between' }, el('a', { href: '#/opportunities', style: 'color:var(--gold); text-decoration:none' }, o.title || o.number || ''), el('span', { class: 'badge', style: 'background:#c0392b22;color:#c0392b;border:1px solid #c0392b' }, faDigits(o.stalled_days) + ' روز')),
        el('div', { class: 'muted small' }, (o.cname || '') + ' — ' + fmtMoney(o.amount) + ' — احتمال ' + faDigits(o.probability || 0) + '٪')));
    }
  } catch (e) { clear(body); body.append(el('div', { class: 'alert danger small' }, e.message)); }
}
async function loadHighPriorityLeads(grid, i) {
  const card = el('div', { class: 'card' });
  mountSlot(grid, i, card);
  const body = el('div');
  card.append(el('div', { class: 'card-h' }, el('h3', {}, '🔥 سرنخ‌های داغ'), el('span', { class: 'muted small' }, 'بالای امتیاز AI')), el('div', { class: 'card-b' }, body));
  skel(body, 120);
  try {
    const r = await api.get('/api/smart-sales/leads');
    clear(body);
    if (!r.items || !r.items.length) { body.append(el('div', { class: 'muted' }, 'سرنخ داغی نیست.')); return; }
    for (const l of r.items) {
      const sc = Number(l.score) || 0;
      body.append(el('div', { style: 'padding:8px 0; border-bottom:1px solid var(--border)' },
        el('div', { class: 'flex between' }, el('a', { href: '#/leads', style: 'color:var(--gold); text-decoration:none' }, l.company || 'سرنخ'), el('span', { class: 'badge', style: `background:${sc >= 70 ? '#2a9d8f' : '#c9a227'}22;color:${sc >= 70 ? '#2a9d8f' : '#c9a227'};border:1px solid ${sc >= 70 ? '#2a9d8f' : '#c9a227'}` }, faDigits(sc) + '/100')),
        el('div', { class: 'muted small' }, (l.contact_name || '') + (l.estimated_value ? ' — ' + fmtMoney(l.estimated_value) : ''))));
    }
  } catch (e) { clear(body); body.append(el('div', { class: 'alert danger small' }, e.message)); }
}
async function loadAtRisk(grid, i) {
  const card = el('div', { class: 'card' });
  mountSlot(grid, i, card);
  const body = el('div');
  card.append(el('div', { class: 'card-h' }, el('h3', {}, '⚠️ مشتریان در معرض ریزش'), el('span', { class: 'muted small' }, 'ریسک AI با دلیل')), el('div', { class: 'card-b' }, body));
  skel(body, 120);
  try {
    const r = await api.get('/api/smart-sales/at-risk');
    clear(body);
    if (!r.items || !r.items.length) { body.append(el('div', { class: 'muted' }, 'مشتری پرریسکی شناسایی نشده است.')); return; }
    for (const x of r.items) {
      body.append(el('div', { style: 'padding:8px 0; border-bottom:1px solid var(--border)' },
        el('div', { class: 'flex between' }, el('a', { href: '#/customers/' + x.id, style: 'color:var(--gold); text-decoration:none' }, x.name || ''), el('span', { class: 'badge', style: 'background:#c0392b22;color:#c0392b;border:1px solid #c0392b' }, 'ریسک ' + faDigits(x.churn_score) + '٪')),
        x.reason_list ? el('div', { class: 'muted small' }, x.reason_list) : null));
    }
  } catch (e) { clear(body); body.append(el('div', { class: 'alert danger small' }, e.message)); }
}

function loadAssistant(card) {
  const body = el('div');
  const { card: c2, body: b2 } = cardShell('💬 دستیار هوشمند فروش (AI Sales Assistant)', 'پاسخ بر اساس دادهٔ واقعی + مجوز شما — Hybrid AI', body);
  clear(card); card.append(c2);
  const log = el('div', { style: 'max-height:300px; overflow:auto; display:flex; flex-direction:column; gap:8px; margin-bottom:10px' });
  const inp = el('input', { placeholder: 'مثلاً: فروش این ماه چقدر است؟ / مشتری پرریسک کیست؟ / بهترین اقدام برای …' });
  const send = async () => {
    const q = inp.value.trim(); if (!q) return;
    log.append(el('div', { class: 'muted small' }, 'شما: ' + q));
    inp.value = '';
    const thinking = el('div', { class: 'muted small' }, 'در حال پردازش…');
    log.append(thinking); log.scrollTop = log.scrollHeight;
    try {
      const r = await api.post('/api/ai/chat', { query: q });
      clear(thinking);
      const eng = { online: ' آنلاین', local: ' LLM محلی', local_intelligence: '⚙️ هوش محلی' }[r.engine] || (r.provider ? '🤖 ' + r.provider : '🤖 AI');
      thinking.append(el('div', { style: 'white-space:pre-line; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:10px; line-height:1.9' }, r.text || 'پاسخی دریافت نشد.'));
      log.append(el('div', { class: 'muted small' }, 'موتور: ' + eng + (r.conversation_id ? ' · گفتگو #' + r.conversation_id : '')));
    } catch (e) { clear(thinking); thinking.append(el('div', { class: 'alert danger small' }, e.message)); }
    log.scrollTop = log.scrollHeight;
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  body.append(log, el('div', { class: 'flex', style: 'gap:8px' }, inp, el('button', { class: 'btn primary sm', onclick: send }, 'ارسال')));
}
