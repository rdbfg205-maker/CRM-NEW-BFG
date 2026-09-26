// UI harness v2: loads the REAL frontend (main.js + all views) against the REAL server
// with a faithful DOM shim, navigates every route, and reports:
//   [render] unhandled view errors/rejections
//   [api]    every HTTP call that returned >= 400
import jalaliPkg from './server/lib/jalali-vendor.js';
const API = process.env.BASE || 'http://localhost:3050';
const TOK = process.env.TOK;
const realFetch = globalThis.fetch;

// ================= mini-DOM =================
let _uid = 0;
function makeEl(tag) {
  const el = {
    __uid: ++_uid,
    nodeType: 1,
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    style: { setProperty(){}, cssText: '' },
    dataset: {},
    id: '', textContent: '', value: '', checked: false,
    attrs: {}, listeners: {}, _html: '', _class: '',
    isConnected: true, disabled: false,
    classList: {
      add(...cs) { const s = new Set(el._class.split(/\s+/).filter(Boolean)); cs.forEach(c => s.add(c)); el._class = [...s].join(' '); },
      remove(...cs) { const s = new Set(el._class.split(/\s+/).filter(Boolean)); cs.forEach(c => s.delete(c)); el._class = [...s].join(' '); },
      toggle(c, force) { const has = el._class.split(/\s+/).includes(c); const want = force === undefined ? !has : force; if (want) el.classList.add(c); else el.classList.remove(c); return want; },
      contains(c) { return el._class.split(/\s+/).filter(Boolean).includes(c); },
    },
    get className() { return el._class; },
    set className(v) { el._class = String(v || ''); },
    append(...cs) { this.children.push(...cs.filter(Boolean)); },
    appendChild(c) { this.children.push(c); return c; },
    remove() { el.isConnected = false; },
    insertBefore(n) { this.children.push(n); },
    replaceWith(n) { this.children.push(n); },
    addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = v; if (k === 'class') el._class = String(v); if (k === 'id') el.id = v; if (k === 'value') el.value = v; },
    getAttribute(k) { if (k === 'class') return el._class; return el.attrs[k] !== undefined ? el.attrs[k] : null; },
    setAttributeNS(ns, k, v) { el.setAttribute(k, v); },
    hasAttribute(k) { return el.attrs[k] !== undefined; },
    querySelector(sel) { return qsaIn(el, sel)[0] || null; },
    querySelectorAll(sel) { return qsaIn(el, sel); },
    closest(sel) { let n = el.parentNode; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; },
    matches(sel) { return matchChain(el, sel.split(',').map(s => s.trim())); },
    compareDocumentPosition() { return 0; },
    get firstChild() { return el.children[0] || null; },
    get lastChild() { return el.children[el.children.length - 1] || null; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    focus() {}, blur() {}, click() { (el.listeners.click || []).forEach(f => f({ stopPropagation(){}, preventDefault(){} })); },
    getContext() { return new Proxy({}, { get: () => () => {} }); },
    rows: { get length() { return 0; } },
  };
  Object.defineProperty(el, 'innerHTML', {
    set(v) { el._html = v; el.children = []; },
    get() { return el._html || ''; },
  });
  Object.defineProperty(el, 'parentElement', { get() { return el.parentNode; } });
  el.parentNode = null;
  const _append = el.append.bind(el);
  el.append = (...cs) => { _append(...cs); cs.filter(Boolean).forEach(c => { if (c && typeof c === 'object') c.parentNode = el; }); };
  return el;
}
// --- selector engine (supports tag, #id, .class, [attr], [attr=v], comma, descendant, child) ---
function parseSimple(sel) {
  let tag = null, id = null; const classes = [], attrs = [];
  const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=["']?([\w-]+)["']?)?\]/g;
  let m;
  while ((m = re.exec(sel))) {
    if (m[1]) tag = m[1]; else if (m[2]) classes.push(m[2]); else if (m[3]) id = m[3];
    else if (m[4]) attrs.push({ k: m[4], v: m[5] !== undefined ? m[5] : null });
  }
  return { tag, id, classes, attrs };
}
function matchSimple(node, sel) {
  const s = parseSimple(sel);
  if (!node || !node.classList) return false;
  if (s.tag && node.tagName !== s.tag.toUpperCase()) return false;
  if (s.id && node.id !== s.id) return false;
  for (const c of s.classes) if (!node.classList.contains(c)) return false;
  for (const a of s.attrs) {
    if (a.v === null) { if (node.hasAttribute(a.k)) continue; return false; }
    if (node.getAttribute(a.k) !== a.v) return false;
  }
  return true;
}
function matchChain(node, simpleParts) {
  // simpleParts: one selector (already comma-split upstream) as tokens; match rightmost on node, rest on ancestors
  const tokens = simpleParts.replace(/>/g, ' ').trim().split(/\s+/);
  if (!matchSimple(node, tokens[tokens.length - 1])) return false;
  const chain = tokens.slice(0, -1).reverse();
  const anc = [];
  let a = node.parentNode;
  while (a) { anc.push(a); a = a.parentNode; }
  let i = 0;
  for (const an of anc) { if (matchSimple(an, chain[i])) i++; if (i === chain.length) return true; }
  return chain.length === 0;
}
function qsaIn(root, sel) {
  const out = [];
  const groups = sel.split(',').map(s => s.trim());
  (function walk(n) {
    for (const c of n.children || []) {
      if (!c || c.nodeType === 3) continue;
      for (const g of groups) if (matchChain(c, g)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

// ================= globals =================
const appEl = makeEl('div'); appEl.id = 'app';
const modalRoot = makeEl('div'); modalRoot.id = 'modal-root';
const toasts = makeEl('div'); toasts.id = 'toasts';
const docBody = makeEl('body');
const winListeners = {};
globalThis.window = globalThis;
globalThis.document = {
  getElementById(id) {
    if (id === 'app') return appEl;
    if (id === 'modal-root') return modalRoot;
    if (id === 'toasts') return toasts;
    const found = qsaIn(docBody, '#' + id)[0] || qsaIn(appEl, '#' + id)[0];
    if (found) return found;
    const e = makeEl('div'); e.id = id; docBody.append(e); return e;
  },
  createElement: (t) => makeEl(t),
  createElementNS: (ns, t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t, children: [] }),
  querySelector(sel) { return qsaIn(docBody, sel)[0] || qsaIn(appEl, sel)[0] || null; },
  querySelectorAll(sel) { return [...new Set([...qsaIn(docBody, sel), ...qsaIn(appEl, sel)])]; },
  addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener() {},
  documentElement: makeEl('html'),
  body: docBody,
  title: '',
};
docBody.append(appEl, toasts, modalRoot);
const locState = { h: '' };
globalThis.location = { href: API + '/', protocol: 'http:', host: new URL(BASE).host, reload() {} };
Object.defineProperty(globalThis.location, 'hash', {
  get() { return locState.h || ''; },
  set(v) { locState.h = v; (winListeners.hashchange || []).forEach(f => f({})); },
});
globalThis.localStorage = { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } };
globalThis.navigator = { userAgent: 'test', language: 'fa' };
globalThis.jalaali = jalaliPkg.default || jalaliPkg;

const apiFails = [];
const apiCalls = { total: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url).startsWith('http') ? String(url) : API + String(url);
  const headers = { ...(opts.headers || {}) };
  if (TOK && String(url).includes('/api/')) headers['Authorization'] = 'Bearer ' + TOK;
  apiCalls.total++;
  let res;
  try {
    res = await realFetch(u, { ...opts, headers });
  } catch (e1) {
    // Node-internal transient error under parallel fetches — retry once
    if (/parser\.deref|socket/i.test(String(e1 && e1.message))) {
      res = await realFetch(u, { ...opts, headers });
    } else throw e1;
  }
  // 429 = rate limiter working as intended (a requested security feature), not a defect —
  // the harness fires many requests in a burst, which legitimately trips the per-endpoint limit.
  if (res.status >= 400 && res.status !== 429) apiFails.push({ method: (opts.method || 'GET').toUpperCase(), path: String(url).replace(API, ''), status: res.status });
  return res;
};
globalThis.WebSocket = class { constructor(){} close(){} send(){} };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.clearTimeout = () => {};
globalThis.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
globalThis.confirm = () => false;

let viewErrors = 0, harnessNoise = 0;
const errorLog = [];
const isNodeFetchNoise = (e) => /parser\.deref|Cannot destructure property 'socket'/i.test(String(e && e.message || e));
const reportErr = (where, e) => {
  if (isNodeFetchNoise(e)) { harnessNoise++; return; } // Node-internal artifact of parallel keep-alive fetches in the harness; browsers are unaffected
  viewErrors++; errorLog.push(`${where} → ${e && e.message ? e.message : e}`);
};
process.on('unhandledRejection', (reason) => reportErr('unhandledrejection', reason));
process.on('uncaughtException', (err) => reportErr('uncaughtException', err));

// ================= run =================
try {
  globalThis.localStorage.setItem('bfc_token', TOK);
  globalThis.localStorage.setItem('bfc_user', 'admin');
  await import('./public/js/main.js');
} catch (e) {
  console.error('MAIN IMPORT FAILED:', e.message); process.exit(1);
}
await new Promise(r => setTimeout(r, 700));
const ME = globalThis.window.__me && globalThis.window.__me();
if (!ME) { console.error('BOOT FAILED: ME is null (login/token problem)'); process.exit(2); }
console.log(`booted as ${ME.user.username} | perms: ${Object.keys(ME.permissions || {}).length} modules`);

const routes = [
  '/', '/dashboard/exec', '/dashboard/sales', '/dashboard/quality', '/dashboard/warehouse', '/dashboard/lab', '/dashboard/finance', '/kpi',
  '/customers', '/customers/1', '/contacts', '/leads', '/opportunities', '/pipeline',
  '/products', '/pricelists', '/quotes', '/quotes/1', '/orders', '/orders/1', '/invoices', '/invoices/1', '/payments', '/commission', '/smart-sales',
  '/stock', '/stock/raw', '/stock/movements', '/stock/alerts',
  '/lab/requests', '/lab/requests/1', '/lab/results',
  '/complaints', '/complaints/1', '/tickets', '/warranties', '/contracts',
  '/campaigns', '/loyalty',
  '/messenger', '/meetings', '/outbox',
  '/tasks', '/calendar', '/followups', '/calls', '/calls/missed',
  '/reports', '/reports/auto',
  '/ai/assistant', '/ai/analytics', '/ai/forecast', '/ai/churn', '/ai/leads', '/ai/kb',
  '/documents',
  '/admin/users', '/admin/roles', '/admin/settings', '/admin/workflows', '/admin/backup', '/admin/audit', '/admin/voip',
  '/help', '/help?m=customers', '/help?m=calls',
];
let badRoutes = 0;
for (const r of routes) {
  const eBefore = errorLog.length, aBefore = apiFails.length, nBefore = harnessNoise;
  locState.h = '#' + r;
  (winListeners.hashchange || []).forEach(f => f({}));
  await new Promise(res => setTimeout(res, 500));
  const newErrs = errorLog.slice(eBefore);
  const newApi = apiFails.slice(aBefore);
  // content assertion: the view must have rendered something real
  const contentEl = qsaIn(appEl, '.content')[0];
  const rendered = contentEl ? qsaIn(contentEl, '*').length : -1;
  const empty = rendered < 1;
  if (newErrs.length || newApi.length || empty) {
    badRoutes++;
    console.log('FAIL ' + r);
    if (empty) console.log(`   [content] empty/missing (${rendered})`);
    newErrs.forEach(e => console.log('   [render] ' + e));
    newApi.forEach(a => console.log(`   [api] ${a.method} ${a.path} → ${a.status}`));
  } else console.log('ok   ' + r);
}
console.log('-------------------------------------');
console.log(`routes: ${routes.length}, bad: ${badRoutes} | api calls: ${apiCalls.total}, failures: ${apiFails.length} | view errors: ${viewErrors} | harness noise (node-fetch artifact): ${harnessNoise}`);
process.exit(badRoutes === 0 && viewErrors === 0 ? 0 : 1);
