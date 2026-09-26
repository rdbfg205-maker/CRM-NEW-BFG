'use strict';
// UI AUDIT E2E (real browser via Playwright) — verifies the NEW features of this
// audit round render and work against the live server on :3050 (real DB):
//  - Voice registration buttons (customers + contacts)
//  - Meeting Action Items section (render + add row + persisted actions load)
//  - Communication Center page (summary + table)
//  - Quote: per-line tax column + customer debt balance card
//  - Live real-time notification toast (WS push from a real API event)
//  - No console/page errors; responsive (no horizontal overflow on mobile)
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const BASE = process.env.BASE || 'http://localhost:3050';
const DB = '/home/user/baspar-crm/data/baspar-crm.sqlite';
const stamp = String(Date.now()).slice(-5);
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  PASS ' + name + (extra ? '  ' + extra : '')); } else { fail++; failures.push(name + ' :: ' + extra); console.log('  FAIL ' + name + ' :: ' + extra); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function closeAllModals(pg) {
  for (let i = 0; i < 5; i++) {
    const x = pg.locator('.modal-ov .icon-btn.x').last();
    if (await x.isVisible().catch(() => false)) { await x.click({ timeout: 2000 }).catch(() => {}); await sleep(250); } else break;
  }
}

async function apiLogin(u, p) {
  for (let a = 0; ; a++) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    if (r.status === 429 && a < 3) { await sleep(70000); continue; }
    const j = await r.json();
    if (!j.access) throw new Error('apiLogin failed ' + u + ' ' + r.status);
    return j.access;
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)); });

  // ---------- A. login ----------
  console.log('== A. login ==');
  await page.goto(BASE + '/');
  await page.waitForTimeout(1200);
  await page.fill('input[placeholder="admin"]', 'admin');
  await page.fill('input[type="password"]', 'admin1234');
  await page.click('button:has-text("ورود")');
  await page.waitForSelector('#app.shell .topbar', { timeout: 20000 });
  ok('A1 logged in, shell rendered', true);
  pageErrors.length = 0;

  // ---------- B. voice buttons ----------
  console.log('== B. voice registration buttons ==');
  await page.goto(BASE + '/#/customers');
  await page.waitForSelector('button:has-text("ثبت سریع مشتری با صدا")', { timeout: 20000 });
  ok('B1 customers page has voice register button', true);
  await page.goto(BASE + '/#/contacts');
  await page.waitForSelector('button:has-text("ثبت سریع مخاطب با صدا")', { timeout: 20000 });
  ok('B2 contacts page has voice register button', true);
  // open the modal: capture stage renders with transcript + start button
  await page.click('button:has-text("ثبت سریع مخاطب با صدا")');
  await page.waitForSelector('button:has-text("شروع ضبط"), button:has-text("استخراج اطلاعات")', { timeout: 8000 });
  const modalText = await page.locator('.modal, [class*=modal]').first().innerText().catch(() => '');
  ok('B3 voice modal opens with capture UI', /استخراج اطلاعات/.test(modalText));
  // close modal (no Escape support; use the ✕ button)
  await closeAllModals(page);

  // ---------- C. meeting action items ----------
  console.log('== C. meeting action items ==');
  // use a real meeting that has actions (created by the E2E suite) — fallback: create one via API
  let meetId;
  {
    const db = BDB(DB, { readonly: true });
    const row = db.prepare(`SELECT m.id FROM meetings m WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.related_type='meeting' AND t.related_id=m.id) ORDER BY m.id DESC LIMIT 1`).get();
    db.close();
    meetId = row && row.id;
  }
  if (!meetId) {
    const t = await apiLogin('admin', 'admin1234');
    const r = await fetch(BASE + '/api/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ title: 'جلسه UI ' + stamp, start_at: new Date().toISOString(), status: 'scheduled' }) });
    meetId = (await r.json()).id;
  }
  await closeAllModals(page);
  await page.goto(BASE + '/#/meetings/' + meetId);
  await page.waitForSelector('button:has-text("✎ ویرایش")', { timeout: 20000 });
  // open the edit form (details view has an edit button; fallback: meetings list)
  await page.locator('button:has-text("✎ ویرایش")').first().click({ timeout: 8000 });
  await page.waitForSelector('button:has-text("افزودن اقدام / تصمیم")', { timeout: 15000 });
  ok('C1 meeting form shows Action Items section', true);
  // existing action rows load asynchronously (full detail fetch) — poll the input VALUES (innerText excludes input values)
  let actionVals = '';
  for (let i = 0; i < 12; i++) {
    actionVals = await page.evaluate(() => [...document.querySelectorAll('input[placeholder="شرح تصمیم / اقدام *"]')].map(x => x.value).join('|'));
    if (/بررسی قیمت مواد اولیه/.test(actionVals)) break;
    await sleep(500);
  }
  ok('C2 persisted actions loaded in form (input values)', /ارسال پیش[\u200c]?فاکتور/.test(actionVals) && /بررسی قیمت مواد اولیه/.test(actionVals) && /برنامه[\u200c]?ریزی تحویل/.test(actionVals), actionVals.slice(0, 80));
  // add a new action row (DOM check)
  await page.click('button:has-text("افزودن اقدام / تصمیم")');
  await page.waitForSelector('input[placeholder="شرح تصمیم / اقدام *"]', { timeout: 6000 });
  ok('C3 add action row renders editable fields', true);
  const fieldsText = await page.evaluate(() => document.body.innerText);
  ok('C4 action row has responsible/follower/deadline/priority/result fields', /مسئول انجام/.test(fieldsText) && /فرد پیگیری‌کننده/.test(fieldsText) && /مهلت \/ تاریخ انجام/.test(fieldsText) && /اولویت/.test(fieldsText) && /نتیجه/.test(fieldsText));

  // ---------- D. communication center ----------
  console.log('== D. communication center ==');
  await page.goto(BASE + '/#/comm-center');
  await page.waitForSelector('h1:has-text("مرکز ارتباطات")', { timeout: 20000 });
  ok('D1 comm center page renders', true);
  await page.waitForTimeout(1500);
  const ccText = await page.evaluate(() => document.body.innerText);
  ok('D2 summary reporting present (channel/direction)', /بر اساس کانال/.test(ccText) && /بر اساس جهت/.test(ccText));
  ok('D3 table present with rows or honest empty state', /مجموع ارتباطات/.test(ccText) && (/وضعیت \/ نتیجه/.test(ccText) || /ارتباطی با این فیلترها/.test(ccText)));

  // ---------- E. quote: per-line tax + customer balance ----------
  console.log('== E. quote detail: tax column + balance card ==');
  const saraTok = await apiLogin('sara.m', '12345678');
  const adminTok = await apiLogin('admin', 'admin1234');
  // create a fresh quote with 2 taxed lines via API (real data)
  const custR = await fetch(BASE + '/api/r/customer?per_page=1', { headers: { Authorization: 'Bearer ' + adminTok } });
  const cust = (await custR.json()).items[0];
  const qR = await fetch(BASE + '/api/r/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok }, body: JSON.stringify({ customer_id: cust.id, tax_rate: 0 }) });
  const qid = (await qR.json()).id;
  // two real products with known base prices (item price = base price → no override needed)
  const mkProd = async (code, price) => {
    const r = await fetch(BASE + '/api/r/product', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok }, body: JSON.stringify({ code, name: 'اسفنج UI ' + code, unit: 'متر', price_retail: price, stock_qty: 100 }) });
    const j = await r.json();
    return j.id || (j.item && j.item.id);
  };
  const pid1 = await mkProd('PD-UI-1-' + stamp, 1000000);
  const pid2 = await mkProd('PD-UI-2-' + stamp, 500000);
  await fetch(BASE + `/api/r/quote/${qid}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok }, body: JSON.stringify({ items: [
    { product_id: pid1, name: 'اسفنج UI ۱', qty: 1, price: 1000000, discount_pct: 0, tax_rate: 10 },
    { product_id: pid2, name: 'اسفنج UI ۲', qty: 2, price: 500000, discount_pct: 0, tax_rate: 20 },
  ] }) });
  await page.goto(BASE + '/#/quotes/' + qid);
  await page.waitForSelector('th:has-text("مالیات %")', { timeout: 20000 });
  ok('E1 quote detail shows per-line tax column', true);
  await page.waitForSelector('.card.stat:has-text("مانده بدهی مشتری")', { timeout: 10000 });
  ok('E2 customer debt balance card on quote page', true);

  // ---------- F. live real-time toast ----------
  console.log('== F. live notification toast (WS push) ==');
  // admin is logged in in the browser (WS connected). sara creates a task assigned to admin (id 1)
  await page.goto(BASE + '/#/customers');
  await page.waitForSelector('#app.shell .topbar', { timeout: 15000 });
  const taskTitle = 'توست ریل‌تایم UI ' + stamp;
  await fetch(BASE + '/api/r/task', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + saraTok }, body: JSON.stringify({ title: taskTitle, assignee_id: 1, priority: 'medium', status: 'open' }) });
  const toast = page.locator('.toast').filter({ hasText: taskTitle }).first();
  const toastShown = await toast.waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
  ok('F1 live toast appeared for real-time event (no refresh)', toastShown);
  if (toastShown) {
    const tt = await toast.innerText().catch(() => '');
    ok('F2 toast shows title + click hint', /وظیفه جدید به شما واگذار شد/.test(tt) && /کلیک/.test(tt));
  } else ok('F2 toast shows title + click hint', false, 'no toast');

  // ---------- G. no JS errors ----------
  console.log('== G. console/page errors ==');
  const realErrors = pageErrors.filter(e => !/401|Failed to load resource|favicon/i.test(e));
  ok('G1 no page/console JS errors during audit', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  // ---------- H. responsive (mobile) ----------
  console.log('== H. responsive ==');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mctx.newPage();
  await mpage.goto(BASE + '/');
  await mpage.waitForTimeout(1000);
  await mpage.fill('input[placeholder="admin"]', 'admin');
  await mpage.fill('input[type="password"]', 'admin1234');
  await mpage.click('button:has-text("ورود")');
  await mpage.waitForSelector('#app.shell .topbar', { timeout: 20000 });
  for (const route of ['/customers', '/comm-center', '/meetings']) {
    await mpage.goto(BASE + '/' + route);
    await mpage.waitForTimeout(1800);
    const ovf = await mpage.evaluate(() => {
      const c = document.querySelector('.content') || document.documentElement;
      return c.scrollWidth - c.clientWidth;
    });
    ok('H ' + route + ' no horizontal overflow (mobile 390px)', ovf <= 4, 'overflow=' + ovf + 'px');
  }
  await mctx.close();

  await browser.close();
  console.log('\n====================================');
  console.log(`UI AUDIT E2E: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log('FAILED:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
