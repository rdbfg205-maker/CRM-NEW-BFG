// UI E2E (Playwright, real server 3050) for the 7-item mission:
// voice-register button, geo cascade, contacts import button, MEETING EDIT (the real
// Create → Edit → Save → Reload user path), follow-up attempts section, geo report filters.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const { chromium } = require('playwright');
const B = 'http://127.0.0.1:3050';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; fails.push(n + ' :: ' + x); console.log('  FAIL', n, '::', x); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const closeTopModal = async (pg) => { const x = pg.locator('.modal .icon-btn.x').last(); if (await x.count()) { await x.click(); await sleep(400); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));

  // login
  await page.goto(B + '/');
  await sleep(1200);
  await page.fill('input[placeholder="admin"]', 'admin');
  await page.fill('input[type="password"]', 'admin1234');
  await page.click('button:has-text("ورود")');
  await page.waitForSelector('#app.shell .topbar', { timeout: 20000 });
  ok('U1 login → shell', true);

  // ================= customers: voice register button + geo cascade =================
  await page.goto(B + '/#/customers');
  await sleep(1500);
  const voiceBtn = page.locator('button[title*="ثبت سریع مشتری با صدا"], button:has-text("🎙")').first();
  ok('U2 voice-register button visible in Customers toolbar', await voiceBtn.count() === 1, 'count=' + await voiceBtn.count());
  await voiceBtn.click();
  await sleep(800);
  const modalText = await page.locator('.modal, [class*="modal"]').first().innerText().catch(() => '');
  const sttHonest = modalText.includes('Web Speech API') || modalText.includes('شروع ضبط') || modalText.includes('مرورگر شما');
  ok('U3 voice modal opens with honest STT state (support or fallback, no fake success)', sttHonest, modalText.slice(0, 120));
  await closeTopModal(page);
  await sleep(400);

  // new customer form: geo cascade
  await page.click('button:has-text("＋ مشتری جدید"), button:has-text("مشتری جدید")');
  await sleep(900);
  const provField = page.locator('.modal .field', { hasText: 'استان' }).first();
  const provSel = provField.locator('select');
  ok('U4 province select in customer form', await provSel.count() === 1, 'count=' + await provSel.count());
  await provSel.selectOption('فارس');
  await sleep(500);
  const cityIn = page.locator('.modal input[placeholder="شهر"]').first();
  const listAttr = await cityIn.getAttribute('list').catch(() => null);
  let cityOptions = [];
  if (listAttr) cityOptions = await page.evaluate((id) => [...document.getElementById(id).options].map(o => o.value), listAttr);
  ok('U5 city datalist cascades from province (فارس → شیراز…)', cityOptions.includes('شیراز') && cityOptions.includes('مرودشت'), JSON.stringify(cityOptions.slice(0, 4)));
  const indIn = page.locator('.modal input[placeholder="شهرک صنعتی"]').first();
  ok('U6 industrial-city field with datalist', await indIn.count() === 1 && !!(await indIn.getAttribute('list')), '');
  const addIndBtn = page.locator('button:has-text("＋ شهرک صنعتی جدید")').first();
  ok('U7 "new industrial city" button (admin has create perm)', await addIndBtn.count() === 1, 'count=' + await addIndBtn.count());
  await closeTopModal(page);
  await sleep(400);

  // ================= contacts: import button =================
  await page.goto(B + '/#/contacts');
  await sleep(1200);
  ok('U8 contacts import button visible', await page.locator('button:has-text("Import از Excel")').count() === 1, '');
  await page.click('button:has-text("Import از Excel")');
  await sleep(600);
  ok('U9 contacts import wizard opens (target customer + file)', (await page.locator('.modal').first().innerText().catch(() => '')).includes('مشتری مقصد'), '');
  await closeTopModal(page);
  await sleep(300);

  // ================= MEETING EDIT: real Create → Edit → Save → Reload (UI) =================
  await page.goto(B + '/#/meetings');
  await sleep(1200);
  const stamp = String(Date.now()).slice(-5);
  await page.click('button:has-text("＋ افزودن جلسه"), button:has-text("جلسه جدید")');
  await sleep(700);
  await page.fill('.modal input[placeholder="عنوان جلسه *"]', 'جلسه UI ' + stamp);
  // pick a start date via the Jalali picker (readonly input → click popup day cell)
  const startIn = page.locator('.modal input[placeholder*="تاریخ و ساعت شروع"]');
  await startIn.click();
  await page.waitForSelector('.dp-popup', { timeout: 5000 });
  await page.locator('.dp-popup div', { hasText: /^28$/ }).first().click();
  await sleep(500);
  const startVal = await startIn.inputValue();
  ok('U10a start date picked via picker (Jalali value set)', /\d{4}\/\d{2}\/\d{2}/.test(startVal), 'value="' + startVal + '"');
  await page.click('.modal button:has-text("ذخیره")');
  await sleep(1200);
  const row1 = page.locator('tr', { hasText: 'جلسه UI ' + stamp });
  ok('U10 meeting created via UI (row visible)', await row1.count() === 1, 'rows=' + await row1.count());
  // EDIT
  await row1.locator('button:has-text("ویرایش")').click();
  await sleep(900);
  const titleVal = await page.locator('.modal input[placeholder="عنوان جلسه *"]').first().inputValue();
  ok('U11 edit form opens with PREVIOUS values (root-cause fix)', titleVal === 'جلسه UI ' + stamp, 'title="' + titleVal + '"');
  // change title + status
  await page.fill('.modal input[placeholder="عنوان جلسه *"]', 'جلسه UI ویرایش‌شده ' + stamp);
  const stSel = page.locator('.modal select', { hasText: /برنامه‌ریزی‌شده|انجام|scheduled/ }).last();
  await page.click('button:has-text("ذخیره")');
  await sleep(1200);
  const row2 = page.locator('tr', { hasText: 'جلسه UI ویرایش‌شده ' + stamp });
  ok('U12 edit saved (new title in list after save)', await row2.count() === 1, 'rows=' + await row2.count());
  // RELOAD (full page refresh → DB persistence)
  await page.reload();
  await sleep(1800);
  ok('U13 reload shows the edited value (persisted in DB)', await page.locator('tr', { hasText: 'جلسه UI ویرایش‌شده ' + stamp }).count() === 1, '');
  // cleanup meeting via API (test-only) — reuse the browser session token (no extra login → no rate limit)
  const A = await page.evaluate(() => localStorage.getItem('bfc_token') || localStorage.getItem('token') || '') || (await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) })).json()).access;
  const r = await (await fetch(B + '/api/r/meeting?q=' + encodeURIComponent('جلسه UI ' + stamp), { headers: { Authorization: 'Bearer ' + A } })).json();
  for (const it of (r.items || [])) { await fetch(B + '/api/r/meeting/' + it.id + '?hard=1', { method: 'DELETE', headers: { Authorization: 'Bearer ' + A } }); }

  // ================= follow-up attempts section in detail =================
  // create a follow-up for the first customer (or any) via API, then open its detail in UI
  const fus = await (await fetch(B + '/api/r/followup?per_page=5', { headers: { Authorization: 'Bearer ' + A } })).json();
  if (!(fus.items || []).length) {
    let cus2 = await (await fetch(B + '/api/r/customer?per_page=1', { headers: { Authorization: 'Bearer' + A } })).json();
    if (!(cus2.items || []).length) {
      const cr = await (await fetch(B + '/api/r/customer', { method: 'POST', headers: { Authorization: 'Bearer' + A, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'مشتری UI تست', type: 'company' }) })).json();
      cus2 = { items: [{ id: cr.id }] };
    }
    const fid = (cus2.items && cus2.items[0] && cus2.items[0].id) || null;
    if (!fid) throw new Error('cannot resolve a customer for follow-up test');
    await fetch(B + '/api/r/followup', { method: 'POST', headers: { Authorization: 'Bearer' + A, 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_type: 'customer', entity_id: fid, subject: 'پیگیری UI', due_at: '2026-09-26T09:00:00.000Z' }) });
  }
  const fus2 = await (await fetch(B + '/api/r/followup?per_page=5', { headers: { Authorization: 'Bearer ' + A } })).json();
  const fu = (fus2.items || [])[0];
  if (!fu) throw new Error('no follow-up found for UI detail test');
  await page.goto(B + '/#/followups');
  await sleep(1400);
  const fuRow = page.locator('tr', { hasText: fu.subject }).first();
  ok('U14 follow-up row visible', await fuRow.count() === 1, 'subject=' + fu.subject);
  await fuRow.click();
  await sleep(1000);
  const detText = await page.locator('.modal').first().innerText().catch(() => '');
  ok('U15 detail shows "تاریخچه پیگیری‌ها" section', detText.includes('تاریخچه پیگیری‌ها'), detText.slice(0, 80));
  ok('U16 "+ ثبت پیگیری جدید" button present', await page.locator('button:has-text("ثبت پیگیری جدید")').count() >= 1, '');
  await closeTopModal(page);
  await sleep(300);

  // ================= reports: geography filters =================
  await page.goto(B + '/#/reports');
  await sleep(1400);
  const kindSel = page.locator('.card select').first();
  const opts = await kindSel.locator('option').allInnerTexts().catch(() => []);
  ok('U17 geography report kind in Reports', opts.some(t => t.includes('جغرافیای مشتریان')), JSON.stringify(opts.slice(0, 20)));
  await kindSel.selectOption({ label: opts.find(t => t.includes('جغرافیای مشتریان')) });
  await sleep(400);
  const geoVisible = await page.locator('select', { hasText: 'همه استان‌ها' }).count();
  ok('U18 geo filters (استان/شهر/شهرک/نوع/وضعیت) appear for geography kind', geoVisible >= 1, 'provSel=' + geoVisible);

  // ================= responsive: mobile =================
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(B + '/#/customers');
  await sleep(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok('U19 mobile (375px) no horizontal overflow', !overflow, 'scrollW=' + await page.evaluate(() => document.documentElement.scrollWidth));

  ok('U20 no uncaught JS errors during the whole UI test', jsErr.length === 0, jsErr.slice(0, 3).join(' | '));
  await browser.close();

  console.log('');
  console.log('=====================================');
  console.log(`MISSION7 UI: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
