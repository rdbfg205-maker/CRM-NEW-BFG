// UI E2E (Playwright): central Export/Print service components render & work
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; fails.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function login(u, p) {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  return (await r.json()).access;
}
const H = (t) => ({ Authorization: 'Bearer ' + t });

(async () => {
  const A = await login('admin', 'admin1234');
  const STAMP = String(Date.now()).slice(-6);
  // one real customer for the detail view
  const r = await fetch(B + '/api/r/customer', { method: 'POST', headers: { ...H(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'مشتری UI خروجی ' + STAMP, type: 'company' }) });
  const CUST = (await r.json()).id;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));

  await page.goto(B + '/');
  await sleep(1200);
  await page.fill('input[placeholder="admin"]', 'admin');
  await page.fill('input[type="password"]', 'admin1234');
  await page.click('button:has-text("ورود")');
  await page.waitForSelector('#app.shell .topbar', { timeout: 20000 });
  ok('U1 login → shell', true);

  // ===== customers list: central export button =====
  await page.goto(B + '/#/customers');
  await sleep(1500);
  const expBtn = page.locator('button:has-text("⬇ خروجی")').first();
  ok('U2 list has central export button', await expBtn.count() === 1, 'count=' + await expBtn.count());
  await expBtn.click();
  await sleep(400);
  const menuVisible = await page.locator('button:has-text("🖨 چاپ — با سربرگ رسمی")').count();
  ok('U3 export menu: print with/without header + Excel + settings', menuVisible === 1 && await page.locator('button:has-text("📊 Excel — دادهٔ فیلترشده")').count() === 1 && await page.locator('button:has-text("⚙ تنظیمات خروجی…")').count() === 1, 'print=' + menuVisible);
  // open settings modal
  await page.locator('button:has-text("⚙ تنظیمات خروجی…")').first().click();
  await sleep(500);
  const modal = page.locator('.modal', { hasText: 'تنظیمات خروجی' });
  ok('U4 "تنظیمات خروجی" modal opens', await modal.count() === 1, 'count=' + await modal.count());
  ok('U5 modal: type/template/scope controls', (await modal.locator('select').count()) === 3, 'selects=' + await modal.locator('select').count());
  ok('U6 modal: generate button present', await modal.locator('button:has-text("تولید خروجی")').count() === 1, '');
  await modal.locator('button:has-text("انصراف")').click();
  await sleep(300);

  // ===== customer detail: record export button =====
  await page.goto(B + '/#/customers/' + CUST);
  await sleep(1500);
  const recBtn = page.locator('button:has-text("🖨 خروجی")').first();
  ok('U7 customer detail has record export button', await recBtn.count() === 1, 'count=' + await recBtn.count());
  await recBtn.click();
  await sleep(400);
  ok('U8 record export menu: print(with/without) + excel + settings', await page.locator('button:has-text("🖨 چاپ / PDF — با سربرگ رسمی")').count() === 1 && await page.locator('button:has-text("📊 Excel — این رکورد")').count() === 1, '');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await sleep(200);

  // ===== generic resource list (products) also has the central button =====
  await page.goto(B + '/#/products');
  await sleep(1500);
  ok('U9 products list has central export button', await page.locator('button:has-text("⬇ خروجی")').count() === 1, 'count=' + await page.locator('button:has-text("⬇ خروجی")').count());

  // ===== workflow list export menu =====
  await page.goto(B + '/#/processes');
  await sleep(1500);
  ok('U10 workflow list has export menu', await page.locator('button:has-text("⬇ خروجی")').count() === 1, 'count=' + await page.locator('button:has-text("⬇ خروجی")').count());
  await page.locator('button:has-text("⬇ خروجی")').first().click();
  await sleep(300);
  ok('U11 wf export menu: processes/executions xlsx+print', await page.locator('a:has-text("📊 Excel — فرآیندها")').count() === 1 && await page.locator('a:has-text("🖨 چاپ — اجراها")').count() === 1, '');

  // ===== report page: export links still present (sales reports) =====
  await page.goto(B + '/#/reports');
  await sleep(1500);
  ok('U12 sales reports export links present (Excel/CSV/Print)', await page.locator('a:has-text("⬇ Excel")').count() >= 1 || await page.locator('a[id="sr-xlsx"]').count() >= 1, 'xlsx=' + await page.locator('a[id="sr-xlsx"]').count());

  ok('U13 no uncaught JS errors', jsErr.length === 0, jsErr.slice(0, 3).join(' | '));

  // cleanup (API + direct-DB fallback so nothing bleeds into other suites)
  await fetch(B + '/api/r/customer/' + CUST + '?hard=1', { method: 'DELETE', headers: H(A) });
  const db = require('better-sqlite3')('/home/user/baspar-crm/data/baspar-crm.sqlite');
  db.prepare("DELETE FROM customers WHERE name LIKE ?").run('%UI خروجی ' + STAMP);
  db.close();
  await browser.close();

  console.log('');
  console.log('=====================================');
  console.log(`EXPORT UI E2E: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
