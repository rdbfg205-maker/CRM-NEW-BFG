'use strict';
// UI E2E for the Workflow Visual Engine (Playwright/Chromium, real server 3050):
// canvas render, add/undo node, inspector, validate, monitor, execution detail,
// my-tasks, responsive widths.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:3050';
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; failures.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));
  // login
  await page.goto(BASE + '/');
  await sleep(1200);
  await page.fill('input[placeholder="admin"]', 'admin');
  await page.fill('input[type="password"]', 'admin1234');
  await page.click('button:has-text("ورود")');
  await page.waitForSelector('#app.shell .topbar', { timeout: 20000 });
  ok('U1 login → shell', true);

  // list page
  await page.goto(BASE + '/#/processes');
  await sleep(1500);
  const listCount = await page.locator('table.tbl tr').count();
  ok('U2 processes list renders (4 templates + more)', listCount >= 4, 'rows=' + listCount);
  ok('U3 sales-chain template visible in list', await page.locator('text=فرآیند فروش کامل').count() > 0);

  // designer
  const salesRow = page.locator('tr', { hasText: 'فرآیند فروش کامل' });
  await salesRow.locator('button[title="طراح فرآیند"]').click();
  await sleep(2000);
  const canvas = page.locator('#wfe-canvas');
  ok('U4 designer canvas rendered', await canvas.count() === 1);
  const nodeCount = await canvas.locator('div[style*="cursor:grab"]').count();
  ok('U5 template nodes rendered on canvas (>=12)', nodeCount >= 12, 'nodes=' + nodeCount);
  const edgePaths = await canvas.locator('svg path[data-edge]').count();
  ok('U6 edges rendered (>=12)', edgePaths >= 12, 'edges=' + edgePaths);

  // select a node → inspector
  await canvas.locator('div[style*="cursor:grab"]').first().click();
  await sleep(500);
  ok('U7 node selection opens inspector', await page.locator('.wfe-insp h3').count() > 0);

  // add node from palette + undo
  const before = await canvas.locator('div[style*="cursor:grab"]').count();
  await page.locator('button', { hasText: 'Condition (شرط)' }).first().click();
  await sleep(500);
  const after = await canvas.locator('div[style*="cursor:grab"]').count();
  ok('U8 palette adds a node', after === before + 1, `before=${before} after=${after}`);
  // inspector shows condition builder
  ok('U9 condition builder in inspector (AND/OR)', await page.locator('.wfe-insp', { hasText: 'AND (همه)' }).count() > 0);
  // undo
  await page.keyboard.press('Control+z');
  await sleep(500);
  const afterUndo = await canvas.locator('div[style*="cursor:grab"]').count();
  ok('U10 undo removes the node (Ctrl+Z)', afterUndo === before, `afterUndo=${afterUndo}`);
  // draft autosave indicator
  ok('U11 draft autosave indicator present', await page.locator('#draft-ind').count() === 1);

  // validate
  await page.click('button:has-text("Validate")');
  await sleep(1500);
  const toastOk = await page.locator('#toasts', { hasText: 'معتبر' }).count();
  ok('U12 validate → valid toast', toastOk > 0);

  // monitor tab
  await page.locator('.tab', { hasText: 'Monitor' }).click();
  await sleep(1800);
  const execRows = await page.locator('table.tbl tr', { hasText: 'WF-' }).count();
  ok('U13 monitor shows executions with execution_no (WF-…)', execRows >= 1, 'rows=' + execRows);
  // open execution detail
  const firstExec = page.locator('table.tbl tr', { hasText: 'WF-' }).first();
  await firstExec.locator('button[title="جزئیات"]').click();
  await sleep(1500);
  const modalOpen = await page.locator('#modal-root', { hasText: 'Execution' }).count();
  ok('U14 execution detail modal opens (steps + log)', modalOpen > 0);
  ok('U15 detail shows مراحل + Log sections', await page.locator('#modal-root', { hasText: 'Log:' }).count() > 0);
  await page.locator('#modal-root button:has-text("بستن"), #modal-root .btn').last().click().catch(() => {});
  await sleep(400);

  // versions tab
  await page.locator('.tab', { hasText: 'نسخه‌ها' }).click();
  await sleep(800);
  ok('U16 versions tab lists versions', await page.locator('table.tbl tr', { hasText: 'فعال (Published)' }).count() >= 1);

  // responsive: tablet + mobile (monitor view should not overflow)
  for (const [w, h, name] of [[768, 1024, 'tablet'], [375, 812, 'mobile']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + '/#/processes');
    await sleep(1500);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    ok(`U17 ${name} no horizontal overflow`, m.sw <= m.iw + 2, `sw=${m.sw} iw=${m.iw}`);
  }

  ok('U18 no uncaught JS errors during UI test', jsErr.length === 0, jsErr.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n=====================================');
  console.log('WF ENGINE UI E2E: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('ALL UI TESTS PASSED ✅');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
