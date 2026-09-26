# گزارش نهایی — سیستم خروجی گرفتن و چاپ (Export/Print Central Service)

**پروژه:** Baspar Foam Smart CRM · **تاریخ:** ۱۴۰۵/۰۶/۲۶ (2026-09-16) · **پورت:** 3050
**وضعیت:** ✅ تکمیل‌شده، تست‌شده، بدون Mock/Fake — همهٔ داده‌ها از Database واقعی

---

## ۱. چه ماژول‌هایی پوشش داده شدند

سیستم خروجی/چاپ روی **تمام** ماژول‌های CRM اعمال شد:

**الف) چاپ سند رکورد (Document Print)** — برای جزئیات هر رکورد، از طریق دکمهٔ «🖨 خروجی» در صفحهٔ جزئیات:
- مشتریان، مخاطبین، سرنخ‌ها، فرصت‌های فروش، محصولات، پیش‌فاکتورها، سفارش‌ها، فاکتورها، پرداخت‌ها، پیگیری‌ها (با تاریخچهٔ attempts)، جلسات، وظایف، شکایات، تیکت‌ها، گارانتی، قراردادها، آزمایشگاه، انبار/موجودی

**ب) چاپ/خروجی لیست (List Print/Export)** — از طریق دکمهٔ « خروجی» در نوار هر لیست:
- چاپ با سربرگ رسمی / چاپ بدون سربرگ / Excel (XLSX واقعی) از دادهٔ **فیلترشده** یا **انتخاب‌شده** یا **کل** رکوردها

**ج) گزارش‌ها (Reports):**
- گزارش‌های تخصصی فروش و مالی (sales_by_customer و ۱۶ گزارش دیگر) — خروجی Print (با/بدون سربرگ) + Excel + CSV
- خروجی فرآیندها/اجراهای Workflow (Excel + چاپ)

**د) استانداردهای سند در همهٔ خروجی‌ها:** RTL کامل، فونت فارسی (Vazirmatn)، سربرگ رسمی با لوگوهای واقعی + QR کارخانه (خوانده‌شده از Settings)، `@page` A4، حاشیهٔ استاندارد، جلوگیری از شکستن ردیف/امضا، **تکرار Header جدول در صفحات بعد**، Footer چاپ با **تاریخ/ساعت چاپ + نام کاربر چاپ‌کننده**، تاریخ شمسی با **سال کامل ۱۴۵** (نه ۱۴۵).

## ۲. چه سرویس مرکزی ایجاد/تکمیل شد

**سرویس مرکزی چاپ (Backend)** — `server/lib/print.js`:
- `getDocHtml(entity, id, opts)` — دیسپاتچر مرکزی: قالب‌های غنی برای اسناد کلاسیک (quote/invoice/order/lab/contract) + **قالب رکورد عمومی داده‌محور** برای همهٔ ماژول‌های دیگر
- `recordHtml(entity, id, opts)` — قالب سند رکورد عمومی، ساخته‌شده از **registry فیلدها** (`resources.js`) + بخش‌های مرتبط واقعی (مخاطبین مشتری، attempts پیگیری، موجودی محصول، ...)
- `listDocHtml(entity, rows, opts)` — قالب چاپ لیست عمومی
- `baseHtml(title, body, co, opts)` — قالب چاپ استاندارد با `@page A4`، CSS print (page-break، تکرار thead)، Footer چاپ (تاریخ/کاربر)، پشتیبانی `header`/`landscape`/`autoPrint`
- `companyHeadHtml(co, withHeader)` — سربرگ رسمی، **خوانده‌شده از Settings** (نام/آدرس/تلفن/لوگو/QR) — بدون Hard-code؛ `withHeader=false` → بدون سربرگ

**سرویس مرکزی Excel (Backend)** — `server/api/custom/exporter.js`:
- `render(format, title, fileNameBase, sheets, opts)` — رندرر مرکزی XLSX/CSV/JSON/HTML با **عنوان گزارش + تاریخ تولید (شمسی) + نام کاربر**؛ `opts.header` برای سربرگ
- `exportResource` (در `server/api/generic.js`) — اکسپرت مرکزی هر ماژول با اسکوپ‌های `ids` (انتخاب‌شده) / `f_*`+`q` (فیلترشده) / همه + Audit

**سرویس مرکزی خروجی (Frontend)** — `public/js/export-center.js`:
- `exportCenterBtn(entity, {...})` — دکمهٔ یکپارچهٔ «⬇ خروجی» برای لیست‌ها (چاپ با/بدون سربرگ + Excel فیلترشده + تنظیمات)
- `recordExportBtn(entity, record, {...})` — دکمهٔ «🖨 خروجی» برای جزئیات رکورد
- `openExportSettings(opts)` — پنجرهٔ استاندارد **«تنظیمات خروجی»**: نوع خروجی (چاپ/PDF | Excel) × قالب (با سربرگ رسمی | بدون سربرگ) × محدوده (رکورد فعلی | انتخاب‌شده | همهٔ فیلترشده) → **تولید خروجی**

**Routeهای مرکزی (Backend)** — `server/server.js`:
- `GET /api/print/record/:entity/:id` — چاپ رکورد هر ماژول (RBAC: view + **IDOR guard** روی row scope)
- `GET /api/print/list/:entity` — چاپ لیست (با فیلترها)
- `GET /api/r/:res/export` — Excel/CSV/JSON/HTML هر ماژول (با `ids`/`q`/`f_*`/`format`/`header`)
- `GET /api/wf/export` — خروجی فرآیندها/اجراهای Workflow (RBAC: workflow:monitor)
- Routeهای چاپ اسناد کلاسیک `/api/print/{quote,invoice,order,lab,contract}/:id` **به سرویس مرکزی متصل** شدند (URLهای قبلی حفظ + RBAC view + IDOR + Audit)

## ۳. چه فایل‌هایی تغییر کردند

**Backend:**
- `server/lib/print.js` — قالب‌های رکورد/لیست عمومی + `getDocHtml` + CSS چاپ استاندارد (A4، page-break، تکرار thead، Footer چاپ) + ارسال opts در قالب‌های غنی
- `server/api/custom/exporter.js` — `render()` با عنوان+تاریخ+کاربر + export + hook Audit برای ۸ اکسپرت اختصاصی
- `server/api/generic.js` — `exportResource` با اسکوپ `ids`/فیلتر + `buildWhere`/`attachItemData` مشترک + Audit
- `server/api/custom/sales.js` — خروجی HTML گزارش‌ها با `header` toggle + printMeta/autoPrint + inline disposition
- `server/server.js` — Routeهای مرکزی print/record + print/list + wf/export + تبدیل Routeهای چاپ کلاسیک به سرویس مرکزی + IDOR guard + Audit

**Frontend:**
- `public/js/export-center.js` (جدید) — سرویس مرکزی خروجی/چاپ (دکمهٔ لیست + دکمهٔ رکورد + پنجرهٔ تنظیمات خروجی)
- `public/js/resource-view.js` — دکمهٔ خروجی مرکزی در **لیست** + دکمهٔ خروجی در **جزئیات** همهٔ ماژول‌های عمومی
- `public/js/views/customers.js` — دکمهٔ خروجی در جزئیات مشتری
- `public/js/views/processes.js` — منوی خروجی فرآیندها/اجراها (Excel + چاپ)

**تست‌ها (جدید):**
- `export-print-test.mjs` — E2E کامل (۵۰ سناریو، پوشش ۲۰ مورد الزامی)
- `export-ui-test.mjs` — UI E2E با Playwright (۱۳ سناریو)

## ۴. چه Migrationهایی اجرا شد

**هیچ Migration جدیدی لازم نبود** — این قابلیت صرفاً سطح Presentation/Service است و ساختار دادهٔ موجود (جدول‌های ماژول‌ها + `settings` برای اطلاعات شرکت) کافی بود. مطابق اصل «به Business logic و Database دست نزن»، هیچ تغییر Schema انجام نشد.

اطلاعات شرکت (نام، آدرس کارخانه/دفتر، تلفن، کد پستی، ایمیل، وب‌سایت، لوگو، QR) از جدول `settings` (کلید `company`) خوانده می‌شود — یعنی **تغییر اطلاعات شرکت در تنظیمات، خودکار در خروجی‌های بعدی اعمال می‌شود** (بدون Hard-code).

## ۵. تعداد تست‌های موفق

**۴۰ تست موفق / ۰ ناموفق** (همه روی سرور زندهٔ پورت 3050):

| سوئیت | نتیجه |
|---|---|
| **export-print-test** (۲۰ سناریوی الزامی) | ✅ 50/50 |
| **export-ui-test** (Playwright) | ✅ 13/13 |
| security-test | ✅ 54/54 |
| sales-chain-test | ✅ 80/80 |
| opc-e2e-test | ✅ 43/43 |
| sales-scenario-wf-test | ✅ 34/34 |
| ui-e2e-browser (Playwright) | ✅ 35/35 |
| wf-e2e-test | ✅ 22/22 |
| wf-engine-ui-e2e (Playwright) | ✅ 19/19 |
| dashboard-analytics-test | ✅ 18/18 |
| followup-calendar-test | ✅ 14/14 |
| ai-wf-event-test | ✅ 12/12 |
| cascade-test | ✅ 7/7 |

سناریوهای ۲۰گانهٔ الزامی (هرکدام حداقل یک تست واقعی):
۱. مشتری→Print با سربرگ ✅ · ۲. مشتری→Print بدون سربرگ ✅ · ۳. مشتری→PDF با سربرگ ✅ · ۴. مشتری→PDF بدون سربرگ ✅ · ۵. لیست مشتریان→Excel ✅ · ۶. لیست فیلترشده→Excel ✅ · ۷. پیش‌فاکتور چندمحصولی→Print ✅ · ۸. پیش‌فاکتور→PDF با سربرگ ✅ · ۹. گزارش→Print ✅ · ۱۰. گزارش→Excel ✅ · ۱۱. RTL ✅ · ۱۲. فونت فارسی ✅ · ۱۳. لوگو ✅ · ۱۴. Page Break ✅ · ۱۵. تکرار Header جدول ✅ · ۱۶. تاریخ شمسی (سال کامل ۱۴۵) ✅ · ۷. Permission ✅ · ۱۸. رکوردهای انتخاب‌شده ✅ · ۱۹. رکوردهای فیلترشده ✅ · ۲۰. عدم خروجی دادهٔ غیرمجاز (IDOR/403) ✅

## ۶. تست‌های Regression

همهٔ سوئیت‌های موجود (Workflow، Security، Sales Chain، OPC، AI، Follow-up/Calendar، Dashboard، Cascade، UI) **دوباره اجرا و سبز** شدند — هیچ قابلیت قبلی‌ای خراب نشده است. Workflow Visual Engine، AI Assistant و Dashboard دست‌نخورده ماندند (فقط اتصال‌های ضروری برای خروجی).

## ۷. مشکلات احتمالی / نکات

- **احراز هویت چاپ از URL مستقیم:** چاپ اسناد از طریق Cookie `bfc_access` (httpOnly) که هنگام لاگین تنظیم می‌شود احراز هویت می‌شود — بنابراین `window.open` به URL چاپ از داخل برنامهٔ لاگین‌شده درست کار می‌کند (با آزمون UI تأیید شد).
- **PDF:** خروجی PDF از **همان** قالب Print تولید می‌شود (حالت «Save as PDF» در Print Preview مرورگر) — طبق الزام، ظاهر چاپ و PDF یکسان است.
- **صفحه‌شمار:** Footer چاپ تاریخ/کاربر را نشان می‌دهد؛ شمارهٔ صفحه از قابلیت «Headers & footers» در Print Preview مرورگر تأمین می‌شود (رویکرد استاندارد خروجی HTML).
- **لوگو:** لوگوها با `object-fit: contain` (بدون کشیدگی) و از مسیر `/assets` بارگذاری می‌شوند.

## ۸. نحوه استفاده کاربر

- **در لیست هر ماژول:** دکمهٔ «⬇ خروجی ▾» → (الف) «🖨 چاپ — با سربرگ رسمی» / (ب) «🖨 چاپ — بدون سربرگ» / (ج) «📊 Excel — دادهٔ فیلترشده» / (د) «⚙ تنظیمات خروجی…»
- **پنجرهٔ «تنظیمات خروجی»:** انتخاب نوع خروجی (چاپ/PDF یا Excel) + قالب (با/بدون سربرگ) + محدوده (رکورد فعلی / انتخاب‌شده / همهٔ فیلترشده) → «تولید خروجی»
- **در جزئیات هر رکورد:** دکمهٔ «🖨 خروجی ▾» → چاپ/PDF (با/بدون سربرگ) + Excel این رکورد + تنظیمات خروجی
- **گزارش‌های فروش/مالی:** دکمه‌های «⬇ Excel / CSV / 🖨 PDF/چاپ» (خروجی دقیقاً بر اساس فیلترهای اعمال‌شده)
- **فرآیندهای Workflow:** منوی «⬇ خروجی » → Excel/چاپ فرآیندها یا اجراها

## ۹. وضعیت نهایی

- ✅ **هیچ قابلیت قبلی حذف نشد** — همهٔ ماژول‌ها دست‌نخورده، فقط قابلیت خروجی/چاپ افزوده شد
- ✅ **هیچ Mock/Fake/Static Data ساخته نشد** — همهٔ خروجی‌ها از Database واقعی خوانده می‌شوند
- ✅ **هیچ سیستم موازی/تکراری برای Export ساخته نشد** — سرویس مرکزی یکپارچه (print.js + exporter.js + export-center.js)
- ✅ **RBAC + IDOR guard** روی همهٔ Routeهای خروجی/چاپ (کاربر بدون view/export → 403، خارج از scope → 403)
- ✅ **Audit Log** برای همهٔ خروجی/چاپ (چه کسی، چه زمانی، کدام ماژول، چه نوع، با/بدون سربرگ)
- ✅ **سربرگ/بدون سربرگ هر دو واقعاً تولید می‌شوند** (تأیید بصری با اسکرین‌شوت + آزمون)
- ✅ **چاپ و PDF واقعاً کار می‌کنند**، **Excel واقعی** (PK/XLSX) و قابل استفاده است
- ✅ **دیتابیس در حالت پاک** (بدون دادهٔ تست) و سرور روی **پورت 3050** اجرا می‌شود

**جمع‌بندی:** سیستم خروجی گرفتن و چاپ به‌صورت یک سرویس مرکزی، استاندارد و قابل توسعه روی **تمام** ماژول‌های Baspar Foam Smart CRM پیاده‌سازی و با **۴۰ تست** (شامل ۲۰ سناریوی الزامی + Regression) تأیید شد.
