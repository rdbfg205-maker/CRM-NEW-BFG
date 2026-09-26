'use strict';
import { api, t, fmtDate, faDigits } from '../core.js';
import { el, clear, toast, openModal } from '../ui.js';
import { iconBtn } from '../resource-view.js';
import { helpBtn } from './help.js';

export async function messengerPage(c) {
  const layout = el('div', { class: 'card', style: 'overflow:hidden' });
  const side = el('div', { class: 'chat-side' });
  const main = el('div', { class: 'chat-main' });
  layout.append(el('div', { class: 'chat-layout' }, side, main));
  c.append(el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, 'پیام‌رسان داخلی'), el('div', { class: 'sub' }, 'گفتگوی تیمی، متصل به رکوردهای CRM')),
    el('div', { class: 'actions' }, helpBtn('messenger'),  el('button', { class: 'btn gold sm', onclick: newConvModal }, '＋ گفتگو جدید'))));
  c.append(layout);
  const convsBox = el('div');
  const newBtn = el('button', { class: 'btn sm gold', style: 'margin:10px' }, '＋ گفتگو جدید');
  newBtn.addEventListener('click', newConvModal);
  side.append(newBtn, convsBox);
  let activeConv = null;
  let wsRefresh = null;
  window.__messengerRefresh = (msg) => { if (msg.conversation_id === activeConv) appendMsg(msg, true); };
  loadConvs();
  async function loadConvs() {
    clear(convsBox);
    try {
      const { items } = await api.get('/api/messages/conversations');
      if (!items.length) convsBox.append(el('div', { class: 'muted small', style: 'padding:14px' }, 'هنوز گفتگویی نیست. اولین گفتگو را بسازید.'));
      for (const cv of items) {
        const item = el('div', { class: 'conv-item' + (activeConv === cv.id ? ' active' : '') });
        item.append(el('div', { class: 'c-t' }, cv.title, cv.unread ? el('span', { class: 'badge gold', style: 'margin-inline-start:auto' }, faDigits(cv.unread)) : null));
        item.append(el('div', { class: 'c-l' }, cv.last_body || ''));
        item.addEventListener('click', () => openConv(cv));
        convsBox.append(item);
      }
    } catch (e) { convsBox.append(el('div', { class: 'alert danger small' }, e.message)); }
  }
  async function openConv(cv) {
    activeConv = cv.id;
    document.body.classList.add('chat-side-open');
    loadConvs();
    clear(main);
    main.innerHTML = '';
    const head = el('div', { style: 'padding:11px 15px; border-bottom:1px solid var(--border); font-weight:700', class: 'flex between' });
    head.append(el('span', {}, '💬 ' + cv.title));
    head.append(el('span', { class: 'muted small' }, (cv.members_list || []).map(m => m.full_name).join('، ')));
    main.append(head);
    const msgs = el('div', { class: 'msgs' });
    main.append(msgs);
    const input = el('input', { placeholder: 'پیام خود را بنویسید… (@کاربر برای اشاره)' });
    const send = el('button', { class: 'btn primary' }, t('send'));
    const fileBtn = el('button', { class: 'btn' }, '📎');
    const fileIn = el('input', { type: 'file', style: 'display:none' });
    fileBtn.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      if (!fileIn.files.length || !activeConv) return;
      const fd = new FormData();
      fd.append('file', fileIn.files[0]);
      fd.append('body', fileIn.files[0].name);
      try { await api.upload(`/api/messages/conversations/${activeConv}`, fd); fileIn.value = ''; loadConvs(); } catch (e) { toast(e.message, 'err'); }
    });
    const doSend = async () => {
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      appendLocal({ conversation_id: activeConv, sender_id: window.__me().user.id, sender_name: window.__me().user.full_name, body, created_at: new Date().toISOString() });
      try {
        const ref = JSON.parse(localStorage.getItem('bfc_chat_ref') || 'null');
        await api.post(`/api/messages/conversations/${activeConv}`, { body, ref_type: ref ? ref.type : '', ref_id: ref ? ref.id : 0 });
      } catch (e) { toast(e.message, 'err'); }
    };
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
    main.append(el('div', { class: 'chat-input' }, input, fileBtn, fileIn, send));
    try {
      const r = await api.get(`/api/messages/conversations/${activeConv}`);
      for (const m of r.items) renderMsg(msgs, m);
      api.post(`/api/messages/conversations/${activeConv}/read`, {}).catch(() => {});
      msgs.scrollTop = msgs.scrollHeight;
    } catch (e) { msgs.append(el('div', { class: 'alert danger small' }, e.message)); }
  }
  function appendLocal(m) { renderMsg(main.querySelector('.msgs'), m); const box = main.querySelector('.msgs'); box.scrollTop = box.scrollHeight; }
  function appendMsg(m, silent) { const box = main.querySelector('.msgs'); if (box) { renderMsg(box, m); box.scrollTop = box.scrollHeight; } if (!silent) loadConvs(); }
  function renderMsg(box, m) {
    const mine = m.sender_id === window.__me().user.id;
    const n = el('div', { class: 'msg ' + (mine ? 'mine' : 'theirs') });
    if (m.file) n.append(el('div', {}, '📎 ' + (m.file || 'فایل')));
    if (m.body) n.append(el('div', {}, m.body));
    if (m.ref_type) n.append(el('div', {}, el('span', { class: 'm-ref' }, '#' + m.ref_type + '/' + m.ref_id)));
    n.append(el('div', { class: 'm-meta' }, (mine ? '' : m.sender_name + ' — ') + fmtDate(m.created_at, { time: true })));
    box.append(n);
  }
  function newConvModal() {
    const type = el('select', {});
    type.append(el('option', { value: 'direct' }, 'مستقیم (با یک کاربر)'), el('option', { value: 'group' }, 'گروه'), el('option', { value: 'channel' }, 'کانال'));
    const title = el('input', { placeholder: 'عنوان (برای گروه/کانال)' });
    const userSel = el('select', {});
    api.get('/api/admin/users?per_page=200').then(({ items }) => {
      for (const u of items.filter(u2 => u.id !== window.__me().user.id)) userSel.append(el('option', { value: u.id }, u.full_name));
    }).catch(() => {});
    const membersBox = el('div');
    type.addEventListener('change', () => {
      membersBox.innerHTML = '';
      if (type.value === 'direct') membersBox.append(el('div', { class: 'field' }, el('label', {}, 'کاربر مقصد'), userSel));
      else {
        const msel = el('select', { multiple: '' });
        api.get('/api/admin/users?per_page=200').then(({ items }) => {
          for (const u of items.filter(u2 => u.id !== window.__me().user.id)) msel.append(el('option', { value: u.id }, u.full_name));
        }).catch(() => {});
        membersBox.append(el('div', { class: 'field' }, el('label', {}, 'اعضا (Ctrl+کلیک)'), msel), el('input', { class: 'member-in', style: 'display:none' }));
        membersBox._msel = msel;
      }
    });
    const ov = openModal('گفتگوی جدید', el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'نوع'), type),
      el('div', { class: 'field' }, el('label', {}, 'عنوان'), title),
      membersBox),
      { footer: [
        el('button', { class: 'btn', onclick: () => ov.close() }, t('cancel')),
        el('button', { class: 'btn primary', onclick: async () => {
          try {
            let body = { type: type.value, title: title.value };
            if (type.value === 'direct') {
              if (!userSel.value) return toast('کاربر مقصد را انتخاب کنید', 'err');
              body = { type: 'direct', other_user_id: Number(userSel.value) };
            } else if (membersBox._msel) {
              body.member_ids = [...membersBox._msel.selectedOptions].map(o => Number(o.value));
            }
            const r = await api.post('/api/messages/conversations', body);
            toast('گفتگو ایجاد شد', 'ok');
            ov.close();
            loadConvs();
          } catch (e) { toast(e.message, 'err'); }
        } }, t('save')),
      ] });
  }
}
