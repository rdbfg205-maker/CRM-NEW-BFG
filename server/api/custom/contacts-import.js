'use strict';
// Real Excel/CSV import for CUSTOMER CONTACTS (sub-resource of Customer Master).
// Same 3-step wizard as customer import: parse → validate (dups + policy) → commit.
// Duplicates are scoped to the TARGET CUSTOMER (same customer + phone/mobile/email).
const { get } = require('../../db/db');
const { nowIso, toEnDigits } = require('../../lib/util');
const { HttpError } = require('../../lib/http');
const { requirePerm } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { parseFileToTable } = require('../generic');

const FIELDS = [
  { key: 'name', label: 'نام *' },
  { key: 'position', label: 'سمت' },
  { key: 'phone', label: 'تلفن' },
  { key: 'mobile', label: 'موبایل' },
  { key: 'email', label: 'ایمیل' },
  { key: 'province', label: 'استان' },
  { key: 'city', label: 'شهر' },
  { key: 'industrial_city', label: 'شهرک صنعتی' },
  { key: 'address', label: 'آدرس' },
  { key: 'notes', label: 'یادداشت' },
  { key: 'is_primary', label: 'مخاطب اصلی' },
];
const ALIAS = {
  'نام': 'name', 'نام و عنوان': 'name', 'عنوان': 'name', 'name': 'name',
  'سمت': 'position', 'پوزیشن': 'position', 'position': 'position',
  'تلفن': 'phone', 'شماره تماس': 'phone', 'phone': 'phone',
  'موبایل': 'mobile', 'موبایل/تلفن': 'mobile', 'mobile': 'mobile',
  'ایمیل': 'email', 'email': 'email',
  'استان': 'province', 'شهر': 'city', 'شهرک': 'industrial_city', 'شهرک صنعتی': 'industrial_city',
  'آدرس': 'address', 'توضیحات': 'notes', 'یادداشت': 'notes', 'notes': 'notes',
  'مخاطب اصلی': 'is_primary', 'اصلی': 'is_primary', 'primary': 'is_primary',
};
const cache = new Map();

function rowData(row, mapping) {
  const data = {};
  for (const m of mapping || []) {
    if (!m || !m.key || !FIELDS.some(f => f.key === m.key)) continue;
    const v = row[m.col];
    if (v === undefined || v === null || v === '') continue;
    data[m.key] = typeof v === 'number' ? v : toEnDigits(String(v).trim());
  }
  if (data.is_primary !== undefined) {
    const t = String(data.is_primary).trim().toLowerCase();
    data.is_primary = ['1', 'true', 'بله', 'فشار', 'x', 'yes', '✓'].includes(t);
  }
  return data;
}
function findDupInCustomer(d, customerId, data) {
  const mob = String(data.mobile || '').replace(/\D/g, ''), ph = String(data.phone || '').replace(/\D/g, ''), em = String(data.email || '').trim().toLowerCase();
  const list = d.prepare('SELECT id, name, mobile, phone, email FROM customer_contacts WHERE customer_id=?').all(customerId);
  const hit = list.find(x =>
    (mob && mob.length >= 6 && String(x.mobile || '').replace(/\D/g, '') === mob) ||
    (ph && ph.length >= 6 && String(x.phone || '').replace(/\D/g, '') === ph) ||
    (em && String(x.email || '').toLowerCase() === em));
  if (!hit) return null;
  const field = (mob && mob.length >= 6 && String(hit.mobile || '').replace(/\D/g, '') === mob) ? 'mobile' : ((ph && ph.length >= 6 && String(hit.phone || '').replace(/\D/g, '') === ph) ? 'phone' : 'email');
  return { id: hit.id, field, name: hit.name };
}

function parse(user, customerId, buffer, fileName) {
  requirePerm(user, 'customer', 'import');
  const cust = get().prepare('SELECT id, name FROM customers WHERE id=? AND archived_at IS NULL').get(customerId);
  if (!cust) throw new HttpError(404, 'NOT_FOUND', 'مشتری پیدا نشد.');
  const t = parseFileToTable(buffer, fileName);
  const suggested = [];
  for (let i = 0; i < t.header.length; i++) {
    const h = String(t.header[i] || '').trim();
    const f = FIELDS.find(x => x.label === h || x.key === h) || FIELDS.find(x => ALIAS[h] === x.key);
    suggested.push({ col: i, key: f ? f.key : null });
  }
  const tempId = 'cimp_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
  cache.set(tempId, { customerId: cust.id, rows: t.rows, at: Date.now() });
  setTimeout(() => cache.delete(tempId), 15 * 60000);
  return {
    tempId, format: t.format, header: t.header, fileRowCount: t.rows.length,
    fields: FIELDS, suggested, samples: t.rows.slice(0, 3),
    customer: { id: cust.id, name: cust.name },
  };
}
function validate(user, tempId, mapping) {
  requirePerm(user, 'customer', 'import');
  const c = cache.get(tempId);
  if (!c) throw new HttpError(400, 'IMPORT_EXPIRED', 'جلسه import منقضی شده است. لطفاً دوباره فایل را بارگذاری کنید.');
  const d = get();
  const valid = [], errors = [], dupRows = [];
  let dupCount = 0;
  for (let ri = 0; ri < c.rows.length; ri++) {
    const data = rowData(c.rows[ri], mapping);
    if (!String(data.name || '').trim()) { errors.push({ row: ri + 2, errors: ['نام الزامی است'] }); continue; }
    if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email))) { errors.push({ row: ri + 2, errors: ['ایمیل نامعتبر است'] }); continue; }
    valid.push({ row: ri + 2, data });
    const dup = findDupInCustomer(d, c.customerId, data);
    if (dup) { dupCount++; dupRows.push({ row: ri + 2, id: dup.id, field: dup.field, name: dup.name }); }
  }
  cache.set(tempId, { ...c, valid });
  setTimeout(() => cache.delete(tempId), 15 * 60000);
  return {
    validCount: valid.length, dupCount, errorCount: errors.length, dupRows: dupRows.slice(0, 500),
    fileRowCount: c.rows.length, errors: errors.slice(0, 500),
    preview: valid.slice(0, 10).map(v => v.data),
  };
}
function commit(user, tempId, mapping, dupPolicy) {
  requirePerm(user, 'customer', 'import');
  const policy = ['skip', 'update', 'new'].includes(dupPolicy) ? dupPolicy : 'skip';
  const c = cache.get(tempId);
  if (!c || !Array.isArray(c.valid) || !c.valid.length) throw new HttpError(400, 'NOTHING_TO_COMMIT', 'رکورد معتبری برای ثبت وجود ندارد. ابتدا اعتبارسنجی کنید.');
  const d = get();
  const before = d.prepare('SELECT COUNT(*) c FROM customer_contacts').get().c;
  let ok = 0, dup = 0, updated = 0, unchanged = 0, fail = 0;
  const seen = new Set();
  const tx = d.transaction(() => {
    for (const v of c.valid) {
      const data = v.data;
      const mob = String(data.mobile || '').replace(/\D/g, ''), ph = String(data.phone || '').replace(/\D/g, ''), em = String(data.email || '').trim().toLowerCase();
      const key = mob || ph || em || '';
      if (key && seen.has(key)) { if (policy !== 'new') { dup++; continue; } }
      const ex = findDupInCustomer(d, c.customerId, data);
      if (ex) {
        if (policy === 'skip') { dup++; continue; }
        if (policy === 'update') {
          const cur = d.prepare('SELECT * FROM customer_contacts WHERE id=?').get(ex.id);
          const willChange = ['name', 'position', 'phone', 'mobile', 'email', 'province', 'city', 'industrial_city', 'address', 'notes']
            .some(k => data[k] !== undefined && String(data[k] ?? '') !== String(cur[k] ?? ''));
          if (!willChange) { unchanged++; continue; }
          d.prepare('UPDATE customer_contacts SET name=?, position=?, phone=?, mobile=?, email=?, province=?, city=?, industrial_city=?, address=?, notes=?, updated_at=? WHERE id=?').run(
            data.name !== undefined ? String(data.name).trim() : cur.name,
            data.position !== undefined ? String(data.position || '') : (cur.position || ''),
            data.phone !== undefined ? String(data.phone || '') : (cur.phone || ''),
            data.mobile !== undefined ? String(data.mobile || '') : (cur.mobile || ''),
            data.email !== undefined ? String(data.email || '') : (cur.email || ''),
            data.province !== undefined ? String(data.province || '') : (cur.province || ''),
            data.city !== undefined ? String(data.city || '') : (cur.city || ''),
            data.industrial_city !== undefined ? String(data.industrial_city || '') : (cur.industrial_city || ''),
            data.address !== undefined ? String(data.address || '') : (cur.address || ''),
            data.notes !== undefined ? String(data.notes || '') : (cur.notes || ''),
            nowIso(), ex.id);
          if (data.is_primary) { d.prepare('UPDATE customer_contacts SET is_primary=0 WHERE customer_id=? AND id!=?').run(c.customerId, ex.id); d.prepare('UPDATE customer_contacts SET is_primary=1 WHERE id=?').run(ex.id); }
          updated++; continue;
        }
        // policy 'new' → create a NEW contact (user-confirmed)
      }
      if (key) seen.add(key);
      try {
        const info = d.prepare('INSERT INTO customer_contacts(customer_id, name, position, phone, mobile, email, province, city, industrial_city, address, notes, status, is_primary, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(c.customerId, String(data.name).trim(), String(data.position || ''), String(data.phone || ''), String(data.mobile || ''), String(data.email || ''), String(data.province || ''), String(data.city || ''), String(data.industrial_city || ''), String(data.address || ''), String(data.notes || ''), 'active', data.is_primary ? 1 : 0, nowIso());
        if (data.is_primary) d.prepare('UPDATE customer_contacts SET is_primary=0 WHERE customer_id=? AND id!=?').run(c.customerId, info.lastInsertRowid);
        ok++;
      } catch (e) { fail++; }
    }
  });
  tx();
  const after = d.prepare('SELECT COUNT(*) c FROM customer_contacts').get().c;
  cache.delete(tempId);
  audit(user, 'customer', c.customerId, 'contacts_import', null, { ok, dup, updated, unchanged, fail, fileRows: c.rows.length, before, after, dupPolicy: policy }, '');
  return { ok, dup, updated, unchanged, fail, fileRowCount: c.rows.length, before, after, dupPolicy: policy };
}
module.exports = { parse, validate, commit, FIELDS };
