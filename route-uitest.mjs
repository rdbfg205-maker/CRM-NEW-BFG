// Real browser test: log in and click through every module, checking for "صفحه پیدا نشد"
import { chromium } from 'playwright';

const BASE = 'http://localhost:3010';
const MODULES = [
  '/', '/dashboard/exec', '/dashboard/sales', '/kpi',
  '/customers', '/contacts', '/leads', '/opportunities', '/pipeline',
  '/products', '/pricelists', '/quotes', '/orders', '/invoices', '/payments', '/commission', '/smart-sales',
  '/stock', '/stock/movements', '/stock/raw', '/stock/alerts',
  '/lab/requests', '/lab/results',
  '/complaints', '/tickets', '/warranties', '/contracts',
  '/campaigns', '/loyalty',
  '/messenger', '/portal', '/customer-messages',
  '/meetings', '/outbox', '/tasks', '/calendar', '/followups', '/calls', '/smart-sales', '/help',
  '/reports', '/reports/auto',
  '/ai/assistant', '/ai/analytics', '/ai/forecast', '/ai/churn', '/ai/leads', '/ai/kb',
  '/documents', '/admin/users', '/admin/roles', '/admin/settings', '/admin/workflows', '/admin/backup', '/admin/audit', '/admin/voip',
];

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
// login if needed
if (await page.locator('input[type=password]').count()) {
  await page.fill('input[type=text]', 'admin');
  await page.fill('input[type=password]', 'admin1234');
  await page.click('button.btn.gold');
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(1000);

let notFound = [], errors = [];
for (const m of MODULES) {
  await page.evaluate((h) => { location.hash = h; }, '#' + m);
  await page.waitForTimeout(400);
  const txt = await page.locator('.content').innerText().catch(() => '');
  if (txt.includes('صفحه پیدا نشد')) notFound.push(m);
}
console.log('=== Modules showing "صفحه پیدا نشد" ===');
console.log(notFound.length ? notFound.join(', ') : 'NONE');
console.log('=== Console errors (unique) ===');
const uniq = [...new Set(consoleErrors)];
console.log(uniq.length ? uniq.join('\n') : 'NONE');
await browser.close();
process.exit(0);
