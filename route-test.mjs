import jalaliPkg from './server/lib/jalali-vendor.js';
const API = process.env.BASE || 'http://localhost:3050';
const TOK = process.env.TOK;
const elements = new Map();
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), children: [], style: { setProperty(){}, cssText: '' },
    dataset: {}, className: '', id: '', textContent: '', value: '', attrs: {}, listeners: {}, _html: '',
    isConnected: true,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    append(...cs) { this.children.push(...cs.filter(Boolean)); },
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.isConnected = false; }, insertBefore(n) { this.children.push(n); },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    setAttributeNS(ns, k, v) { this.attrs[k] = v; },
    querySelector() { return makeEl('div'); }, querySelectorAll() { return []; },
    closest() { return makeEl('div'); },
    compareDocumentPosition() { return 0; },
    get firstChild() { return this.children[0] || null; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    scrollTop: 0, scrollHeight: 0,
    getContext() { return new Proxy({}, { get: () => () => {} }); },
  };
  Object.defineProperty(el, 'innerHTML', { set(v){ this._html = v; this.children = []; }, get(){ return this._html || ''; } });
  return el;
}
const appEl = makeEl('div');
const winListeners = {};
globalThis.window = globalThis;
globalThis.document = {
  getElementById(id) { if (id === 'app') return appEl; if (!elements.has(id)) elements.set(id, makeEl('div')); return elements.get(id); },
  createElement: (t) => makeEl(t),
  createElementNS: (ns, t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  querySelector() { return makeEl('div'); },
  querySelectorAll() { return []; },
  addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener() {},
  documentElement: makeEl('html'),
  body: makeEl('body'),
  title: '',
};
const locListeners = [];
globalThis.location = {
  hash: '', href: API + '/', protocol: 'http:', host: new URL(BASE).host,
  reload() {},
};
Object.defineProperty(globalThis.location, 'hash', {
  get() { return locListeners._h || ''; },
  set(v) { locListeners._h = v; (winListeners.hashchange || []).forEach(f => f({})); },
});
globalThis.localStorage = { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } };
globalThis.navigator = { userAgent: 'test', language: 'fa' };
globalThis.jalaali = jalaliPkg.default || jalaliPkg;
globalThis.fetch = async (url, opts) => {
  const u = String(url).replace(API, '');
  const headers = { ...(opts && opts.headers) };
  if (TOK) headers['Authorization'] = 'Bearer ' + TOK;
  const res = await fetch(API + u, { ...opts, headers });
  return res;
};
globalThis.WebSocket = class { constructor(){} close(){} send(){} };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.clearTimeout = () => {};
globalThis.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
globalThis.confirm = () => false;

const routes = [
  '/', '/dashboard/exec', '/dashboard/sales', '/dashboard/quality', '/dashboard/warehouse', '/dashboard/lab', '/dashboard/finance', '/kpi',
  '/customers', '/customers/1', '/contacts', '/leads', '/opportunities', '/pipeline',
  '/products', '/pricelists', '/quotes', '/quotes/1', '/orders', '/orders/1', '/invoices', '/invoices/1', '/payments', '/commission',
  '/stock', '/stock/raw', '/stock/movements', '/stock/alerts',
  '/lab/requests', '/lab/requests/1', '/lab/results',
  '/complaints', '/complaints/1', '/tickets', '/warranties', '/contracts',
  '/campaigns', '/loyalty',
  '/messenger', '/meetings', '/outbox',
  '/tasks', '/calendar', '/followups',
  '/reports', '/reports/auto',
  '/ai/assistant', '/ai/analytics', '/ai/forecast', '/ai/churn', '/ai/leads', '/ai/kb',
  '/documents',
  '/admin/users', '/admin/roles', '/admin/settings', '/admin/workflows', '/admin/backup', '/admin/audit',
];

try {
  await import('./public/js/main.js');
} catch (e) {
  console.error('MAIN IMPORT FAILED:', e.message); process.exit(1);
}
await new Promise(r => setTimeout(r, 300));
let errors = 0;
for (const r of routes) {
  const before = (winListeners.error || []).length;
  globalThis.location.hash = '#' + r;
  await new Promise(res => setTimeout(res, 400));
  const newErrs = (winListeners.error || []).length - before;
  if (newErrs > 0) { errors++; console.log('VIEW ERROR @', r, '→ errors:', newErrs); }
  else console.log('ok', r);
}
console.log(errors === 0 ? '\nALL VIEWS OK' : `\n${errors} ROUTES WITH ERRORS`);
process.exit(errors === 0 ? 0 : 1);
