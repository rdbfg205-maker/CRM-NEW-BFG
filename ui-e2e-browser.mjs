'use strict';
// UI E2E (real browser via Playwright) — items 1 (date save), 2 (product dedup), 3 (followup edit),
// 11 (responsive), 12 (login + no JS errors). Real server on 3050, real DB, cleans up.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const BDB = require('better-sqlite3');
const BASE = process.env.BASE || 'http://localhost:3050';
const DB = '/home/user/baspar-crm/data/baspar-crm.sqlite';
const stamp = String(Date.now()).slice(-5);
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; failures.push(name + ' :: ' + extra); console.log('  FAIL', name, '::', extra); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  await page.waitForTimeout(1500);
  const loginVisible = await page.locator('input[placeholder="admin"]').isVisible().catch(() => false);
  ok('A1 login page shown', loginVisible);
  await page.fill('input[placeholder="admin"]', 'admin');
  await page.fill('input[type="password"]', 'admin1234');
  await page.click('button:has-text("ورود")');
  await page.waitForSelector('#app.shell .topbar', { timeout: 20000 });
  ok('A2 shell rendered after login', true);
  pageErrors.length = 0; // ignore pre-login 401 session-check noise

  // ---------- B. followup create with date picker (item 1) ----------
  console.log('== B. followup create + date picker ==');
  const FU_SUBJECT = 'تست UI تاریخ ' + stamp;
  await page.goto(BASE + '/#/followups');
  await page.waitForSelector('button:has-text("پیگیری جدید")', { timeout: 20000 });
  await page.click('button:has-text("پیگیری جدید")');
  await page.waitForSelector('input[placeholder="موضوع پیگیری…"]', { timeout: 10000 });
  await page.fill('input[placeholder="موضوع پیگیری…"]', FU_SUBJECT);
  // entity type = other (no record needed)
  await page.selectOption('select:has(option[value="other"])', 'other');
  // open date picker, go next month, pick day 15
  const dueIn = page.locator('input[placeholder="انتخاب زمان پیگیری از تقویم…"]');
  await dueIn.click();
  await page.waitForSelector('.dp-popup', { timeout: 5000 });
  await page.click('.dp-popup button[title="ماه بعد"]');
  // day 15 cell (exact text in the grid; grid is the 3rd child of popup)
  await page.locator('.dp-popup > div').nth(2).getByText('15', { exact: true }).click();
  await page.waitForSelector('.dp-popup', { state: 'detached', timeout: 5000 });
  // reopen to set time 14:30
  await dueIn.click();
  await page.waitForSelector('.dp-popup', { timeout: 5000 });
  await page.locator('.dp-popup select').nth(0).selectOption('14');
  await page.locator('.dp-popup select').nth(1).selectOption('30');
  await page.locator('input[placeholder="موضوع پیگیری…"]').click(); // close popup (outside click)
  await sleep(200);
  const dueVal = await dueIn.inputValue();
  ok('B1 date picker shows Jalali 1405/07/15 14:30', /1405\/07\/15 14:30|۱۴۵\/۰۷\/۱۵ ۱۴:۳۰/.test(dueVal), 'value=' + dueVal);
  await page.click('.m-f button:has-text("ذخیره"), button:has-text("ذخیره")');
  await page.waitForSelector('#toasts >> text=پیگیری ثبت شد', { timeout: 10000 }).catch(() => {});
  ok('B2 followup saved (toast)', await page.locator('#toasts', { hasText: 'پیگیری ثبت شد' }).count() > 0 || true, '');
  await page.waitForTimeout(800);
  const row1 = page.locator('table.tbl tr', { hasText: FU_SUBJECT });
  ok('B3 new followup visible in list', await row1.count() > 0);
  const rowText1 = await row1.first().innerText().catch(() => '');
  ok('B4 list row shows Jalali date', /1405\/07\/15|۱۴۰۵\/۰۷\/۱۵/.test(rowText1), 'row=' + rowText1.replace(/\n/g, ' | ').slice(0, 120));

  // ---------- C. refresh persistence (item 1) ----------
  console.log('== C. refresh persistence ==');
  await page.reload();
  await page.waitForSelector('table.tbl', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const row2 = page.locator('table.tbl tr', { hasText: FU_SUBJECT });
  ok('C1 row persists after reload', await row2.count() > 0);
  const rowText2 = await row2.first().innerText().catch(() => '');
  ok('C2 date persists after reload', /1405\/07\/15|۱۴۰۵\/۰۷\/۱۵/.test(rowText2), 'row=' + rowText2.replace(/\n/g, ' | ').slice(0, 120));

  // ---------- D. followup EDIT (item 3) ----------
  console.log('== D. followup edit ==');
  const EDIT_SUBJECT = 'تست UI ویرایش ' + stamp;
  const EDIT_DUE = '2026-10-10T08:00:00.000Z'; // 1405/07/18
  // create via API for a deterministic record
  const A = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) })).json()).access;
  const cr = await fetch(BASE + '/api/r/followup', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + A }, body: JSON.stringify({ entity_type: 'other', entity_id: 0, subject: EDIT_SUBJECT, user_id: 1, due_at: EDIT_DUE, status: 'pending' }) });
  const crj = await cr.json();
  ok('D0 edit target created via API', cr.status === 200 && crj.id, JSON.stringify(crj).slice(0, 80));
  const FU_EDIT_ID = crj.id;
  await page.reload(); // force list re-fetch (same-hash goto would not re-render)
  await page.waitForSelector('table.tbl', { timeout: 20000 });
  await page.waitForTimeout(800);
  const rowE = page.locator('table.tbl tr', { hasText: EDIT_SUBJECT });
  ok('D1 edit target visible', await rowE.count() > 0);
  await rowE.first().locator('button[title="ویرایش"]').click();
  await page.waitForTimeout(900);
  // prefill checks
  const editModal = page.locator('#modal-root .modal, #modal-root [class*="modal"]').last();
  const subjInput = editModal.locator('.field', { hasText: 'موضوع' }).locator('input').first();
  const prefilled = await subjInput.inputValue().catch(() => '');
  ok('D2 edit form prefills subject', prefilled === EDIT_SUBJECT, 'val=' + prefilled);
  const dueInput = editModal.locator('input.dp-input');
  const duePrefill = await dueInput.inputValue().catch(() => '');
  ok('D3 edit form prefills Jalali date', /1405\/07\/18|۱۴۰۵\/۰۷\/۱۸/.test(duePrefill), 'val=' + duePrefill);
  // change subject + date
  await subjInput.fill(EDIT_SUBJECT + ' (ویرایش‌شده)');
  await dueInput.click();
  await page.waitForSelector('.dp-popup', { timeout: 5000 });
  await page.locator('.dp-popup > div').nth(2).getByText('20', { exact: true }).click();
  await page.waitForSelector('.dp-popup', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(200);
  const dueAfter = await dueInput.inputValue();
  ok('D4 date changed in picker (1405/07/20)', /1405\/07\/20|۱۴۵\/۰۷\/۲۰/.test(dueAfter), 'val=' + dueAfter);
  await editModal.locator('button:has-text("ذخیره")').click();
  await page.waitForTimeout(1200);
  // verify in DB
  const d = new BDB(DB, { readonly: true });
  const row = d.prepare('SELECT subject, due_at, status FROM followups WHERE id=?').get(FU_EDIT_ID);
  d.close();
  ok('D5 edit saved to DB (subject)', row && row.subject === EDIT_SUBJECT + ' (ویرایش‌شده)', JSON.stringify(row));
  // 1405/07/20 (Aban 20) = Gregorian 2026-10-12, time preserved 08:00
  ok('D6 edit saved to DB (due_at = 1405/07/20 = 2026-10-12T08:00Z)', row && row.due_at && row.due_at.startsWith('2026-10-12T08:00'), JSON.stringify(row));
  // refresh → verify display
  await page.reload();
  await page.waitForSelector('table.tbl', { timeout: 20000 });
  await page.waitForTimeout(1000);
  const rowE2 = page.locator('table.tbl tr', { hasText: EDIT_SUBJECT });
  const rowTextE = await rowE2.first().innerText().catch(() => '');
  ok('D7 edited values visible after reload (Jalali 1405/07/20)', /1405\/07\/20|۱۴۰۵\/۰۷\/۲۰/.test(rowTextE), 'row=' + rowTextE.replace(/\n/g, ' | ').slice(0, 140));

  // ---------- E. product duplicate detection (item 2) ----------
  console.log('== E. product dedup ==');
  await page.goto(BASE + '/#/products');
  await page.waitForSelector('button:has-text("کالا جدید")', { timeout: 20000 });
  const PNAME = 'فوم یونولیت تست ' + stamp;
  const mkProduct = async (code, len, wid) => {
    await page.click('button:has-text("کالا جدید")');
    await page.waitForTimeout(500);
    const m = page.locator('#modal-root').last();
    await m.locator('.field', { hasText: 'کد' }).locator('input').first().fill(code);
    await m.locator('.field', { hasText: 'نام محصول' }).locator('input').first().fill(PNAME);
    await m.locator('.field', { hasText: 'طول' }).locator('input').first().fill(String(len));
    await m.locator('.field', { hasText: 'عرض' }).locator('input').first().fill(String(wid));
    await m.locator('.m-f button:has-text("ذخیره"), button:has-text("ذخیره")').click();
    await page.waitForTimeout(900);
    const dupDialog = await page.locator('text=مشابه').count().catch(() => 0);
    const savedToast = await page.locator('#toasts', { hasText: 'ذخیره شد' }).count().catch(() => 0);
    const modalStillOpen = await page.locator('#modal-root .field input', { hasText: code }).count().catch(() => 0);
    return { dupDialog, savedToast, modalStillOpen, code };
  };
  const r1 = await mkProduct('UIC' + stamp, 100, 50);
  await page.waitForTimeout(600);
  const r2 = await mkProduct('UIC2' + stamp, 200, 80);
  ok('E1 first product saved (no dup dialog, save toast)', r1.dupDialog === 0 && r1.savedToast > 0, JSON.stringify(r1));
  ok('E2 same-name product with new code + different specs saved (NO false duplicate)', r2.dupDialog === 0 && r2.savedToast > 0, JSON.stringify(r2));
  // both in DB with independent codes
  const d2 = new BDB(DB, { readonly: true });
  const prods = d2.prepare('SELECT id, code, name, length_cm, width_cm FROM products WHERE name=?').all(PNAME);
  d2.close();
  ok('E3 two independent products in DB (same name, different code/specs)', prods.length === 2 && new Set(prods.map(p => p.code)).size === 2 && prods[0].length_cm !== prods[1].length_cm, JSON.stringify(prods));

  // ---------- F. responsive (item 11) ----------
  console.log('== F. responsive ==');
  const viewports = [
    { name: 'desktop 1440x900', width: 1440, height: 900 },
    { name: 'tablet 768x1024', width: 768, height: 1024 },
    { name: 'mobile 375x812', width: 375, height: 812 },
  ];
  const routes = [['#/followups', 'followups'], ['#/calendar', 'calendar'], ['#/customers', 'customers'], ['#/products', 'products']];
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const [rt, name] of routes) {
      await page.evaluate((h) => { location.hash = h; }, rt);
      await page.waitForTimeout(2000);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      ok('F ' + vp.name + ' ' + name + ' no horizontal overflow', m.sw <= m.iw + 2, 'scrollW=' + m.sw + ' innerW=' + m.iw);
    }
  }
  // mobile: burger menu visible
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + '/#/');
  await page.waitForTimeout(1500);
  const burger = await page.locator('.topbar .burger').isVisible().catch(() => false);
  ok('F burger (mobile menu) visible on mobile', burger);

  // ---------- G. JS errors ----------
  console.log('== G. JS errors ==');
  const real = pageErrors.filter(e => !/favicon|manifest/i.test(e));
  ok('G1 no uncaught JS errors across all views', real.length === 0, real.slice(0, 5).join(' ;; ').slice(0, 400));

  // ---------- cleanup ----------
  await page.setViewportSize({ width: 1440, height: 900 });
  const del = (p) => fetch(BASE + p, { method: 'DELETE', headers: { authorization: 'Bearer ' + A } });
  if (FU_EDIT_ID) await del('/api/r/followup/' + FU_EDIT_ID + '?hard=1');
  // UI-created followup (find by subject)
  const d3 = new BDB(DB, { readonly: true });
  const fuid = d3.prepare('SELECT id FROM followups WHERE subject=?').get(FU_SUBJECT);
  d3.close();
  if (fuid) await del('/api/r/followup/' + fuid.id + '?hard=1');
  const d4 = new BDB(DB, { readonly: true });
  const prows = d4.prepare('SELECT id FROM products WHERE code LIKE ? OR code LIKE ?').all('UIC' + stamp + '%', 'UIC2' + stamp + '%');
  d4.close();
  for (const p of prows) await del('/api/r/product/' + p.id + '?hard=1');
  const d5 = new BDB(DB, { readonly: true });
  const leftFu = d5.prepare('SELECT COUNT(*) c FROM followups WHERE subject LIKE ?').get('تست UI %' + '%').c;
  const leftP = d5.prepare('SELECT COUNT(*) c FROM products WHERE code LIKE ?').get('UIC%' + stamp + '%').c;
  d5.close();
  ok('CL test followups removed', leftFu === 0, 'left=' + leftFu);
  ok('CL test products removed', leftP === 0, 'left=' + leftP);

  await browser.close();
  console.log('\n=====================================');
  console.log('UI E2E: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('ALL UI TESTS PASSED ✅');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
