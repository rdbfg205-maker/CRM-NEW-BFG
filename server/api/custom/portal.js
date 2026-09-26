// Customer self-service portal — restricted access (each customer sees ONLY own data).
// Auth: customer credentials (portal_username + portal_password_hash), JWT typ='customer'.
// Row scope is enforced in every query: customer_id = session customer, always.
const { get } = require('../../db/db');
const { HttpError } = require('../../lib/http');
const { jwtSign, jwtVerify, hashPassword, verifyPassword, randomToken } = require('../../lib/crypto');
const { nextNumber, addActivity } = require('../../db/db');
const { audit } = require('../../core/audit');
function nextNo(prefix, table) { return nextNumber(prefix, table); }
const nowIso = () => new Date().toISOString();
const { rateLimit } = require('../../lib/http');
const notify = require('../../core/notify');
const { recalcDoc } = require('./sales');

const PORTAL_TTL = 12 * 3600; // 12h

// ---------- auth ----------
function login(ip, b) {
  if (!rateLimit('portal_login:' + (ip || 'x'), 10, 60000)) throw new HttpError(429, 'RATE_LIMIT', 'تلاش‌های زیاد است. بعداً دوباره امتحان کنید.');
  const username = String((b && b.username) || '').trim();
  const password = String((b && b.password) || '');
  if (!username || !password) throw new HttpError(400, 'VALIDATION', 'نام کاربری و رمز عبور الزامی است.');
  const d = get();
  const c = d.prepare("SELECT * FROM customers WHERE portal_username=? AND archived_at IS NULL").get(username);
  if (!c || !c.portal_enabled) throw new HttpError(401, 'BAD_CREDENTIALS', 'دسترسی پورتال برای این مشتری فعال نیست.');
  if (c.status !== 'active') throw new HttpError(403, 'CUSTOMER_BLOCKED', 'حساب شما فعال نیست.');
  if (!c.portal_password_hash || !verifyPassword(password, c.portal_password_hash)) throw new HttpError(401, 'BAD_CREDENTIALS', 'نام کاربری یا رمز عبور نادرست است.');
  const access = jwtSign({ typ: 'customer', custId: c.id, username: c.portal_username }, PORTAL_TTL);
  audit({ id: 0, username: 'portal:' + c.portal_username }, 'customer_portal', c.id, 'login', null, { via: 'portal' }, '');
  return { access, customer: { id: c.id, name: c.name, portal_username: c.portal_username } };
}
function requirePortal(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'وارد پورتال نشده‌اید.');
  let p = null;
  try { p = jwtVerify(token); } catch { p = null; }
  if (!p || p.typ !== 'customer') throw new HttpError(401, 'UNAUTHORIZED', 'نشست نامعتبر است.');
  const d = get();
  const c = d.prepare('SELECT * FROM customers WHERE id=? AND archived_at IS NULL').get(p.custId);
  if (!c || !c.portal_enabled || c.status !== 'active') throw new HttpError(403, 'PORTAL_DISABLED', 'دسترسی پورتال فعال نیست.');
  return c;
}
function me(c) {
  const d = get();
  return {
    customer: { id: c.id, name: c.name, phone: c.phone, mobile: c.mobile, email: c.email, city: c.city },
    has_password: !!c.portal_password_hash,
    orders: d.prepare("SELECT COUNT(*) c FROM orders WHERE customer_id=? AND archived_at IS NULL").get(c.id).c,
    complaints: d.prepare("SELECT COUNT(*) c FROM complaints WHERE customer_id=? AND status != 'rejected'").get(c.id).c,
  };
}
function changePassword(c, b) {
  const current = String((b && b.current) || '');
  const next = String((b && b.next) || '');
  if (next.length < 8) throw new HttpError(422, 'VALIDATION', 'رمز عبور جدید حداقل ۸ کاراکتر باشد.');
  if (c.portal_password_hash && !verifyPassword(current, c.portal_password_hash)) throw new HttpError(401, 'BAD_CREDENTIALS', 'رمز عبور فعلی نادرست است.');
  const d = get();
  d.prepare('UPDATE customers SET portal_password_hash=? WHERE id=?').run(hashPassword(next), c.id);
  audit({ id: 0, username: 'portal:' + c.portal_username }, 'customer_portal', c.id, 'change_password', null, null, '');
  return { ok: true };
}

// ---------- orders (own only) ----------
function createOrder(c, b) {
  const items = Array.isArray(b && b.items) ? b.items : [];
  if (!items.length) throw new HttpError(400, 'VALIDATION', 'حداقل یک ردیف سفارش وارد کنید.');
  const d = get();
  const notes = String((b && b.notes) || '').slice(0, 500);
  const tx = d.transaction(() => {
    let total = 0;
    const prepared = items.map(it => {
      const pid = Number(it && it.product_id);
      if (!pid) throw new HttpError(400, 'VALIDATION', 'هر ردیف باید محصول داشته باشد.');
      const p = d.prepare('SELECT * FROM products WHERE id=? AND archived_at IS NULL AND active=1').get(pid);
      if (!p) throw new HttpError(400, 'BAD_PRODUCT', 'محصول انتخاب‌شده معتبر نیست (ردیف ' + (prepared.length + 1) + ').');
      const qty = Math.floor(Number(it.qty));
      if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'VALIDATION', 'تعداد باید عدد مثبت باشد.');
      // manual price allowed (as in proforma); default = product retail price
      let price = (it.price !== undefined && it.price !== null && it.price !== '') ? Number(it.price) : p.price_retail;
      if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'VALIDATION', 'قیمت معتبر نیست.');
      const lt = qty * price;
      total += lt;
      return { pid, name: p.name, qty, price, lt };
    });
    const info = d.prepare("INSERT INTO orders(number, customer_id, salesperson_id, status, order_date, total, notes, created_by, created_at, updated_by, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)")
      .run(nextNo('OD', 'orders'), c.id, c.salesperson_id || null, 'confirmed', nowIso(), total, notes + (notes ? ' — ' : '') + 'ثبت‌شده از پورتال مشتری', c.id, nowIso(), c.id, nowIso());
    const oid = Number(info.lastInsertRowid);
    const ins = d.prepare('INSERT INTO order_items(order_id, product_id, name, qty, price, discount_pct, tax_rate, line_total) VALUES(?,?,?,?,?,?,?,?)');
    for (const it of prepared) ins.run(oid, it.pid, it.name, it.qty, it.price, 0, null, it.lt);
    addActivity('order', oid, c.id, 'create', 'ثبت سفارش از پورتال مشتری');
    audit({ id: 0, username: 'portal:' + c.portal_username }, 'order', oid, 'create', null, { total, items: prepared.length, via: 'portal' }, '');
    return { oid, total };
  });
  const r = tx();
  try { recalcDoc('order_items', r.oid, null); } catch { /* totals already set */ }
  if (c.salesperson_id) notify.notifyRoles(['sales', 'sales_manager', 'super_admin'], 'order', 'سفارش جدید از پورتال مشتری', `مشتری «${c.name}» یک سفارش ثبت کرده است.`, 'order', r.oid);
  return { ok: true, order_id: r.oid, total: r.total };
}
function listOrders(c) {
  const d = get();
  const items = d.prepare(`SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) item_count
    FROM orders o WHERE o.customer_id=? AND o.archived_at IS NULL ORDER BY o.id DESC LIMIT 200`).all(c.id);
  return { items };
}
function orderDetail(c, id) {
  const d = get();
  const o = d.prepare('SELECT * FROM orders WHERE id=? AND archived_at IS NULL').get(Number(id));
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'سفارش پیدا نشد.');
  if (o.customer_id !== c.id) throw new HttpError(403, 'FORBIDDEN', 'دسترسی به این رکورد ندارید.');
  const items = d.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  return { item: o, items };
}

// ---------- complaints (own only, from the structured bank) ----------
function createComplaint(c, b) {
  const subject = String((b && b.subject) || '').trim();
  const description = String((b && b.description) || '').trim();
  if (!subject) throw new HttpError(422, 'VALIDATION', 'موضوع شکایت الزامی است.');
  const d = get();
  const info = d.prepare(`INSERT INTO complaints(number, customer_id, product_id, defect_family, defect_type, category, subject, description, priority, status, source, notes, created_by, created_at, updated_by, updated_at, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
    .run(nextNo('CMP', 'complaints'), c.id,
      b && b.product_id ? Number(b.product_id) : null,
      String((b && b.defect_family) || '').slice(0, 40),
      String((b && b.defect_type) || '').slice(0, 120),
      'product', subject, description,
      ['low', 'medium', 'high', 'critical'].includes(b && b.priority) ? b.priority : 'medium',
      'new', 'portal', 'ثبت‌شده از پورتال مشتری', c.id, nowIso(), c.id, nowIso());
  const cid = Number(info.lastInsertRowid);
  addActivity('complaint', cid, c.id, 'create', 'ثبت شکایت از پورتال مشتری');
  audit({ id: 0, username: 'portal:' + c.portal_username }, 'complaint', cid, 'create', null, { via: 'portal' }, '');
  notify.notifyRoles(['quality_manager', 'ceo', 'super_admin'], 'complaint', 'شکایت جدید از پورتال مشتری', `مشتری «${c.name}» شکایتی ثبت کرده است: ${subject}`, 'complaint', cid);
  return { ok: true, complaint_id: cid };
}
function listComplaints(c) {
  const d = get();
  const items = d.prepare("SELECT * FROM complaints WHERE customer_id=? AND status != 'rejected' ORDER BY id DESC LIMIT 200").all(c.id);
  return { items };
}

// ---------- catalog + defect bank (read-only, for portal forms) ----------
function listProducts(c) {
  const d = get();
  const items = d.prepare('SELECT id, name, code, unit, price_retail FROM products WHERE archived_at IS NULL AND active=1 ORDER BY name LIMIT 500').all();
  return { items };
}
function defectTypes(c, family) {
  const d = get();
  const items = family
    ? d.prepare('SELECT defect_key, defect_fa, family, family_fa FROM complaint_defect_types WHERE family=? ORDER BY id').all(String(family).slice(0, 40))
    : d.prepare('SELECT defect_key, defect_fa, family, family_fa FROM complaint_defect_types ORDER BY family, id').all();
  return { items };
}

// ---------- messages (customer → company) ----------
function sendMessage(c, b) {
  const channel = ['sms', 'whatsapp', 'telegram', 'email'].includes(b && b.channel) ? b.channel : 'email';
  const body = String((b && b.body) || '').trim();
  if (!body) throw new HttpError(422, 'VALIDATION', 'متن پیام خالی است.');
  if (body.length > 4000) throw new HttpError(422, 'VALIDATION', 'متن پیام بیش از حد مجاز است.');
  const to = c.mobile || c.phone || c.email || '';
  const d = get();
  const info = d.prepare(`INSERT INTO customer_messages(customer_id, user_id, event_type, channel, to_addr, subject, body, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(c.id, null, 'portal_inbound', channel, to, 'پیام از پورتال مشتری', body, 'pending', nowIso(), nowIso());
  addActivity('customer', c.id, c.id, 'portal_message', 'پیام جدید از پورتال مشتری');
  audit({ id: 0, username: 'portal:' + c.portal_username }, 'customer_message', Number(info.lastInsertRowid), 'create', null, { via: 'portal', channel }, '');
  notify.notifyRoles(['sales', 'sales_manager', 'support', 'super_admin'], 'customer', 'پیام جدید از پورتال مشتری', `مشتری «${c.name}» پیامی برای شرکت ارسال کرده است.`, 'customer', c.id);
  return { ok: true, message_id: Number(info.lastInsertRowid) };
}
function listMessages(c) {
  const d = get();
  const items = d.prepare("SELECT * FROM customer_messages WHERE customer_id=? ORDER BY id DESC LIMIT 200").all(c.id);
  return { items };
}

module.exports = { login, requirePortal, me, changePassword, createOrder, listOrders, orderDetail, listProducts, defectTypes, createComplaint, listComplaints, sendMessage, listMessages, CHANNELS: ['sms', 'whatsapp', 'telegram', 'email'] };
