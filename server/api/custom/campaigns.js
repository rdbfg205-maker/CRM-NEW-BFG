'use strict';
const { get, getSetting } = require('../../db/db');
const { nowIso } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { audit } = require('../../core/audit');
const { notify } = require('../../core/notify');
const { decSecret } = require('../../lib/crypto');

function audience(camp) {
  const d = get();
  let f = {};
  try { f = JSON.parse(camp.audience_filter || '{}'); } catch {}
  const where = ['c.archived_at IS NULL', "c.status='active'"], params = [];
  if (f.category_id) { where.push('c.category_id=?'); params.push(Number(f.category_id)); }
  if (f.province) { where.push('c.province=?'); params.push(f.province); }
  if (f.industry) { where.push('c.industry=?'); params.push(f.industry); }
  if (f.type) { where.push('c.type=?'); params.push(f.type); }
  if (f.last_purchase_days) {
    where.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id=c.id AND i.status!='cancelled' AND i.issue_date >= datetime('now', '-' || ? || ' day'))`);
    params.push(Number(f.last_purchase_days));
  }
  const rows = d.prepare(`SELECT c.id, c.name, COALESCE(c.mobile, c.phone) contact FROM customers c WHERE ${where.join(' AND ')}`).all(...params);
  return rows.filter(r => r.contact);
}
async function sendCampaign(user, campaignId) {
  const d = get();
  const camp = d.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
  if (!camp) throw new HttpError(404, 'NOT_FOUND', 'کمپین پیدا نشد.');
  if (['sending', 'sent', 'done'].includes(camp.status)) throw new HttpError(400, 'BAD_STATE', 'این کمپین قبلاً ارسال شده است.');
  const cfg = getSetting(camp.channel);
  const configured = cfg && cfg.active && cfg.settings;
  const recs = audience(camp);
  if (!recs.length) throw new HttpError(400, 'NO_RECIPIENTS', 'مخاطبی مطابق فیلتر انتخابی پیدا نشد.');
  d.prepare('UPDATE campaigns SET status=?, total=?, updated_at=? WHERE id=?').run('sending', recs.length, nowIso(), campaignId);
  const ins = d.prepare('INSERT INTO campaign_recipients(campaign_id, customer_id, contact, status) VALUES(?,?,?,?)');
  const outIns = d.prepare('INSERT INTO outbox(provider, channel, to_addr, subject, body, ref_type, ref_id, status, error, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  let sent = 0, failed = 0;
  const fill = (t) => String(t).replace(/\{\{name\}\}/g, '').replace(/\{\{customer\}\}/g, '');
  for (const r of recs) {
    const to = r.contact;
    const body = fill(camp.message).replace('{name}', r.name);
    if (configured) {
      try {
        await sendViaProvider(camp.channel, cfg, to, body, camp.subject);
        ins.run(campaignId, r.id, to, 'sent');
        outIns.run(cfg.key || camp.channel, camp.channel, to, camp.subject || '', body, 'campaign', campaignId, 'sent', '', nowIso(), nowIso());
        sent++;
      } catch (e) {
        ins.run(campaignId, r.id, to, 'failed');
        outIns.run(cfg.key || camp.channel, camp.channel, to, camp.subject || '', body, 'campaign', campaignId, 'failed', e.message, nowIso(), nowIso());
        failed++;
      }
    } else {
      // provider not configured: log as queued so nothing is lost; admin must configure integration
      ins.run(campaignId, r.id, to, 'pending');
      outIns.run(camp.channel, camp.channel, to, camp.subject || '', body, 'campaign', campaignId, 'queued', 'سرویس پیام‌رسانی پیکربندی نشده است. از Admin ← تنظیمات → یکپارچه‌سازی کلید/پنل را تنظیم کنید.', nowIso(), nowIso());
      failed++;
    }
  }
  const finalStatus = configured ? (sent ? 'done' : 'failed') : 'failed';
  d.prepare('UPDATE campaigns SET status=?, sent_count=?, delivered_count=0, opened_count=0, clicked_count=0, converted_count=?, error=?, updated_at=? WHERE id=?')
    .run(finalStatus, sent, sent, configured ? '' : 'سرویس ارسال پیکربندی نشده است. پیام‌ها در صف ارسال (outbox) ذخیره شدند.', nowIso(), campaignId);
  audit(user || { id: 0, username: 'system' }, 'campaign', campaignId, 'send', null, { sent, failed });
  if (user) notify(user.id, 'campaign', `کمپین «${camp.name}» ${finalStatus === 'done' ? 'ارسال شد' : 'با خطا انجام شد'}`, `ارسال‌شده: ${sent} — ناموفق/صف: ${failed}`, 'campaign', campaignId);
  return { ok: true, total: recs.length, sent, failed, queued: !configured };
}
async function sendViaProvider(channel, cfg, to, body, subject) {
  const s = cfg.settings || {};
  const key = decSecret(s.apiKey || s.api_key || s.token || '');
  const ctrl = new AbortController();
  const to2 = setTimeout(() => ctrl.abort(), 15000);
  try {
    if (channel === 'sms') {
      const url = (s.baseUrl || 'https://api.smspanel.example').replace(/\/$/, '') + '/send';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(s.authorization ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify({ to, text: body, ...(s.extra || {}) }), signal: ctrl.signal });
      if (!res.ok) throw new Error('SMS panel: ' + res.status);
    } else if (channel === 'email') {
      const url = (s.baseUrl || 'https://api.email.example').replace(/\/$/, '') + '/v1/emails';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ to: [to], subject: subject || '', text: body }), signal: ctrl.signal });
      if (!res.ok) throw new Error('Email API: ' + res.status);
    } else {
      const url = (s.baseUrl || 'https://api.whatsapp.example').replace(/\/$/, '') + '/messages';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ to, body }), signal: ctrl.signal });
      if (!res.ok) throw new Error('WhatsApp API: ' + res.status);
    }
  } finally { clearTimeout(to2); }
}
// webhook callback from panels (delivered/opened/clicked)
function handleCallback(provider, body) {
  const d = get();
  const statusMap = { delivered: 'delivered', opened: 'opened', clicked: 'clicked', converted: 'converted', failed: 'failed' };
  const st = statusMap[body.status] || (statusMap[body.event] || null);
  if (!st || !body.to) return { ok: false };
  const row = d.prepare('SELECT id FROM outbox WHERE to_addr=? AND channel=? ORDER BY id DESC LIMIT 1').get(String(body.to), provider);
  if (!row) return { ok: false };
  d.prepare('UPDATE outbox SET status=?, updated_at=? WHERE id=?').run(st, nowIso(), row.id);
  const r = d.prepare('SELECT campaign_id FROM campaign_recipients WHERE contact=? ORDER BY id DESC LIMIT 1').get(String(body.to));
  if (r) {
    d.prepare('UPDATE campaign_recipients SET status=? WHERE id=(SELECT MAX(id) FROM campaign_recipients WHERE campaign_id=?)').run(st, r.campaign_id);
    d.prepare('UPDATE campaigns SET ' + ({ delivered: 'delivered_count=delivered_count+1', opened: 'opened_count=opened_count+1', clicked: 'clicked_count=clicked_count+1', converted: 'converted_count=converted_count+1' })[st] + ', updated_at=? WHERE id=?').run(nowIso(), r.campaign_id);
  }
  return { ok: true };
}
module.exports = { sendCampaign, handleCallback, audience, sendViaProvider };
