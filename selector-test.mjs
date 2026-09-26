// Frontend selector test: CustomerSelect + ref resolution against the REAL server.
// Runs the actual frontend modules (customer-select.js, resource-view.js) with DOM shims.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')('data/baspar-crm.sqlite');
const BASE = process.env.BASE || 'http://localhost:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra ? ':: ' + extra : ''); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- login (with rate-limit retry) ----
async function login() {
  let r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) });
  let j = await r.json();
  if (!j.access) { console.log('  (login rate-limited, waiting 65s...)'); await sleep(65000); r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) }); j = await r.json(); }
  return j.access;
}
const TOK = await login();

// ---- minimal DOM shim (enough for customer-select.js + resource-view.js) ----
let _uid = 0;
function makeEl(tag) {
  const el = {
    __uid: ++_uid, nodeType: 1, tagName: (tag || 'div').toUpperCase(), children: [],
    style: { setProperty() {}, cssText: '' }, dataset: {}, id: '', textContent: '', value: '',
    attrs: {}, listeners: {}, _html: '', _class: '', isConnected: true,
    classList: {
      add(...cs) { const s = new Set(el._class.split(/\s+/).filter(Boolean)); cs.forEach(c => s.add(c)); el._class = [...s].join(' '); },
      remove(...cs) { const s = new Set(el._class.split(/\s+/).filter(Boolean)); cs.forEach(c => s.delete(c)); el._class = [...s].join(' '); },
      contains(c) { return el._class.split(/\s+/).filter(Boolean).includes(c); },
    },
    append(...cs) { this.children.push(...cs.filter(Boolean)); },
    appendChild(c) { this.children.push(c); return c; },
    remove() { el.isConnected = false; },
    addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = v; if (k === 'class') el._class = String(v); },
    getAttribute(k) { return el.attrs[k] !== undefined ? el.attrs[k] : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get innerHTML() { return el._html || ''; },
    set innerHTML(v) { el._html = v; el.children = []; },
    get className() { return el._class; },
    set className(v) { el._class = String(v || ''); },
    focus() {}, blur() {},
  };
  return el;
}
globalThis.window = globalThis;
globalThis.document = {
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [] }),
  addEventListener() {}, removeEventListener() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  body: makeEl('body'),
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const h = { ...(opts.headers || {}) };
  h['Authorization'] = 'Bearer ' + TOK;
  return realFetch(String(url).startsWith('http') ? url : BASE + url, { ...opts, headers: h });
};
globalThis.jalaali = require('./server/lib/jalali-vendor.js').default || require('./server/lib/jalali-vendor.js');
globalThis.location = { hash: '', pathname: '/', search: '' };
globalThis.history = { replaceState() {} };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
globalThis.navigator = { userAgent: 'test' };
let META = null;
globalThis.__meta = async () => { if (!META) META = await (await realFetch(BASE + '/api/meta/options', { headers: { Authorization: 'Bearer ' + TOK } })).json(); return META; };
globalThis.__me = () => ({ user: { id: 1, username: 'admin', department: 'it' }, permissions: {} });

function deepText(node) {
  let t = node.textContent || '';
  for (const c of node.children || []) t += deepText(c);
  return t;
}
function deepNodes(node, out = []) {
  out.push(node);
  for (const c of node.children || []) deepNodes(c, out);
  return out;
}
const findRow = (root, text) => deepNodes(root).find(n => n.listeners && n.listeners.mousedown && deepText(n).includes(text));

const { customerSelect } = await import('./public/js/customer-select.js');
const { fieldControl, loadRefOptions, resolveResourceKey } = await import('./public/js/resource-view.js');

// create a real customer in the master (via the real API)
const stamp = Date.now().toString(36).toUpperCase();
const cre = await realFetch(BASE + '/api/r/customer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify({ name: 'سلکتور تست ' + stamp, type: 'company', phone: '0611111111', mobile: '0913' + stamp.slice(0, 7), status: 'active' }) });
const cjd = await cre.json();
const CID = cjd.id;
if (!CID) { console.log('customer create failed', JSON.stringify(cjd)); process.exit(2); }

// ---- F1: initial load (active customers from master) ----
console.log('== CustomerSelect (real component vs real server) ==');
const sel = customerSelect({ value: null });
await sleep(800);
ok('F1.1 active customer list loads from master (new customer visible)', deepText(sel).includes('سلکتور تست ' + stamp));

// ---- F2: server-side search ----
const input = deepNodes(sel).find(n => n.tagName === 'INPUT');
input.value = 'سلکتور تست ' + stamp;
input.listeners.input[0]({});
await sleep(800);
ok('F2.1 search by name shows the customer', deepText(sel).includes('سلکتور تست ' + stamp));
input.value = 'zzz-no-match-xyz';
input.listeners.input[0]({});
await sleep(800);
ok('F2.2 no-match state shown (پیدا نشد)', deepText(sel).includes('پیدا نشد'));

// ---- F3: select -> value + info card (master data) ----
input.value = 'سلکتور تست ' + stamp;
input.listeners.input[0]({});
await sleep(800);
const row = findRow(sel, 'سلکتور تست ' + stamp);
ok('F3.0 selectable row found', !!row);
if (row) row.listeners.mousedown[0]({ preventDefault() {} });
await sleep(900);
ok('F3.1 selected value = customer id (integer FK)', sel.value === CID, 'value=' + sel.value);
const info = deepText(sel);
ok('F3.2 info card shows master data (name + phone + city/label)', info.includes('سلکتور تست ' + stamp) && info.includes('تلفن'));
ok('F3.3 "مشاهده" link to customer detail present', info.includes('مشاهده'));

// ---- F4: clear resets ----
const clearBtn = deepNodes(sel).find(n => n.tagName === 'BUTTON' && deepText(n).includes('حذف'));
if (clearBtn) { clearBtn.listeners.click && clearBtn.listeners.click[0]({}); await sleep(200); }
ok('F4.1 clear button found', !!clearBtn);
ok('F4.2 clear resets value to null', sel.value === null, 'value=' + sel.value);

// ---- F5: preset value with INACTIVE customer (old documents must keep working) ----
db.prepare('UPDATE customers SET status=? WHERE id=?').run('inactive', CID);
const sel2 = customerSelect({ value: CID });
await sleep(900);
ok('F5.1 preset inactive customer displays (old document not broken)', sel2.value === CID && deepText(sel2).includes('سلکتور تست ' + stamp));
// delete via the API (not direct DB) so searchRemove keeps the FTS index consistent
const delR = await realFetch(BASE + '/api/r/customer/' + CID + '?hard=1', { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOK } });
ok('F5.2 cleanup via API (search index stays consistent)', delR.status === 200, 'status=' + delR.status);

// ---- F6: generic form wiring ----
console.log('== Generic form wiring ==');
const meta = await globalThis.__meta();
const ctrl = fieldControl({ key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer' }, null, meta);
ok('F6.1 customer ref renders the CustomerSelect component', !!ctrl.customerSelect);
ok('F6.2 component exposes .value for the form save handler', ctrl.value === null || typeof ctrl.value === 'number');
ok('F6.3 ref "product" resolves to registry key "product"', (await resolveResourceKey('product')) === 'product');
ok('F6.4 legacy table ref "products" resolves too', (await resolveResourceKey('products')) === 'product');
ok('F6.5 ref "customers" resolves to "customer"', (await resolveResourceKey('customers')) === 'customer');
ok('F6.6 ref "users" keeps the special users path', (await resolveResourceKey('users')) === 'users');
const selEl = makeEl('select');
await loadRefOptions(selEl, 'customers', null);
ok('F6.7 loadRefOptions(customers) populates from master', selEl.children.filter(c => c.tagName === 'OPTION').length > 10, 'n=' + selEl.children.length);
const prodSel = makeEl('select');
await loadRefOptions(prodSel, 'products', null);
ok('F6.8 loadRefOptions(products) populates from master', prodSel.children.filter(c => c.tagName === 'OPTION').length > 5, 'n=' + prodSel.children.length);

console.log('');
console.log('=====================================');
console.log(`SELECTOR SUITE: ${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
else console.log('ALL SELECTOR TESTS PASSED ✅');
process.exit(fail ? 1 : 0);
