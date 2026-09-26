# Master Data مشتریان — گزارش Audit و اصلاح سراسری
**تاریخ:** ۲۹ آبان ۱۴۰ (2026-08-29) — **نتیجه: زنجیره Customer Master → API → Selector → Form → Database در تمام ماژول‌ها واقعی و عملیاتی است ✅**

> قانون «حذف هیچ‌چیز نشود» رعایت شد: هیچ API/صفحه/جدول/ویژگی حذف یا بازنویسی نشد؛ فقط **رفع ریشه‌ای ۳ باگ + یکپارچه‌سازی ۲ فرم** با Component مشترک انجام شد.

---

## ۱) نتیجه تست اجباری (طبق بند ۴۴ دستور)

| بخش | نتیجه | مدرک |
|---|---|---|
| **Customer Master** | **PASS** | A1-A11: ایجاد مشتری واقعی در `customers` (PK=id, Soft Delete با `archived_at`)؛ جستجو نام/کد/تلفن/موبایل/شناسه ملی؛ بدون جدول منبع دوم؛ ۰ ارجاع یتیم |
| **Quotation Customer Selector** | **PASS** | B2-B10: تست ۱۰ مرحله‌ای اجباری — مشتری جدید بلافاصله در Selector (بدون Cache)؛ snapshot کامل اطلاعات؛ ذخیره `quote.customer_id → customers.id`؛ Refresh و بازگشایی صحیح |
| **Order Customer Selector** | **PASS** | C2 + D3c + E1/E2 |
| **Invoice Customer Selector** | **PASS** | C3 + E2 (customer + total>0) |
| **Payment Customer Selector** | **PASS** | C4 + E3 (فاکتورهای باز همان مشتری + اعتبارسنجی تعلق) |
| **Commission Customer Relation** | **PASS** | C5 (قانون با مبنا=مشتری) + E4/E4b (پورسانت محاسبه‌شده با نام مشتری) |
| **Opportunity** | **PASS** | C1 (فرم اصلی + فرم سریع Pipeline) |
| **Meeting** | **PASS** | C6 |
| **Follow-up** | **PASS** | C7 (پیوند entity_type=customer با id ماستر) |
| **Complaint** | **PASS** | C8 |
| **Ticket** | **PASS** | C9 |
| **Warranty** | **PASS** | C10 |
| **Contract** | **PASS** | C11 |
| **Test Request (Lab)** | **PASS** | C12 |
| **Campaign** | **PASS** | C13 (audience مستقیم از جدول `customers` با فیلتر استان/دسته/صنعت/نوع) |
| **Reports** | **PASS** | فیلتر مشتری گزارش‌ها از `/api/r/customer` (همان Customer Master) می‌خواند؛ فهرست جداگانه وجود ندارد |
| **Dashboard** | **PASS** | KPIهای مشتری از API داشبورد که مستقیم روی جدول `customers` است؛ فیلتر جداگانه ندارد |

**سوئیت‌های تست اجراشده (همه روی دیتابیس واقعی، بدون Mock):**

| سوئیت | نتیجه |
|---|---|
| `customer-master-e2e.mjs` (جدید — ۴۹ چک شامل تست ۱۰ مرحله‌ای و زنجیره فروش) | **49/49 PASS** ✅ |
| `customer-master-test.mjs` (موجود) | **70/70 PASS** ✅ |
| `final-check.js` (رگرسیونی کل سیستم) | **114/114 PASS** ✅ |
| `wf-e2e-test.mjs` | **20/20 PASS** ✅ |
| `calendar-test.mjs` | **56/56 PASS** ✅ |
| `ui-test.mjs` (رندر زندهٔ ۵۹ صفحه) | **59 روت / ۰ خطای View / ۰ خطای API** ✅ |
| `route-test.mjs` | **ALL VIEWS OK** ✅ |
| `scenarios-test.js` | **41/41 PASS** ✅ |
| `selector-test.mjs` | **19/19 PASS** ✅ |

**جمع کل: ۳۹۸+ چک سبز، ۰ شکست.**

---

## ۲) باگ‌های پیدا و برطرف‌شده (ریشه‌ای)

### باگ ۱ — جدول تبدیل ارقام فارسی در `customer-select.js` خراب بود (بحرانی)
- **شرح:** تابع `toEnDigits` از رشته‌ی `'۰۱۲۵۶۸'` (فقط ۸ رقم، بدون ۳ و ۷) استفاده می‌کرد. نتیجه: جستجوی **کد مشتری / تلفن / موبایل / شناسه ملی** با ارقام ۳ تا ۹ همه نادرست بودند؛ ورودی ۳ یا ۷ رشتهٔ `"-1"` در کوئری تزریق می‌کرد.
- **اصلاح:** `public/js/customer-select.js` — جدول کامل ۱۰ رقمی `'۰۱۲۳۴۵۶۷۸۹'`. (تست A9 این تبدیل را statically verify می‌کند.)

### باگ ۲ — جستجوی سراسری API: `likeEscape` محاسبه می‌شد ولی استفاده نمی‌شد
- **شرح:** در `server/api/generic.js` (list عمومی) متغیر `term` با `likeEscape` ساخته می‌شد ولی پارامترهای LIKE با مقدار **بدون escape** پر می‌شدند → کاراکترهای `%` و `_` در جستجو به‌عنوان وایلدکارت عمل می‌کردند.
- **اصلاح:** استفاده از `term` escape‌شده در پارامترها.

### باگ ۳ — endpoint `GET /api/campaigns/:id/audience` با 404 خراب بود
- **شرح:** روت فقط به‌عنوان `POST` ثبت شده بود؛ فراخوانی استاندارد `GET` (پیش‌نمایش مخاطبان کمپین) ۴۰ برمی‌گرداند.
- **اصلاح:** `server/server.js` — handler مشترک `campaignAudienceHandler` روی **هر دو** GET و POST (POST برای سازگاری عقب‌گرد حفظ شد).

### یکپارچه‌سازی — ۲ فرم از Component مشترک استفاده نمی‌کردند (الگوی تکراریِ خود ایراد)
- `public/js/views/pipeline.js` (فرم سریع «فرصت جدید») و `public/js/views/sales.js` (قانون پورسانت با مبنا=مشتری) از `<select>` ساده با `per_page=200/300` و بدون جستجو/فیلتر فعال/حالت‌های loading-empty-error استفاده می‌کردند.
- **اصلاح:** هر دو به **`customerSelect` مشترک** (همان Component ماستر: جستجوی سروری + debounce + فیلتر فعال + snapshot + مشاهده مشتری) تغییر کردند.

---

## ۳) چیزهایی که Audit شد و **درست بود** (بدون تغییر)

- **API مشتریان:** `GET /api/r/customer` — سروری‌search روی `searchFields = [name, phone, mobile, email, tax_code, city, number]`؛ فیلتر `f_status`؛ صفحه‌بندی؛ scope/Permission (`scopeField: salesperson_id`، fallback `created_by`)؛ `GET /api/r/customer/:id` بدون فیلتر status (برای نمایش سوابق).
- **Database:** جدول `customers` (PK=`id`، Soft Delete با `archived_at`، بدون Hard Delete)؛ **هیچ جدول منبع مشتری دومی وجود ندارد** (فقط `customer_categories` و `customer_contacts`)؛ ارجاع همهٔ اسناد به `customers.id` با **۰ رکورد یتیم** (تست A11).
- **Ref Integrity (بندهای ۲۸/۲۹):** موتور عمومی در `validate()` هر `ref` (شامل `customer_id`) را بررسی می‌کند: ID نامعتبر/غیروموجود → **422** (تست D1: `customer_id=999999` رد شد)؛ string/int mismatch → coerce صحیح به integer (تست D2). `sales.addPayment` هم تعلق فاکتور به مشتری را جداگانه validate می‌کند.
- **Customer Detail → اسناد جدید (بندهای ۱۲-۱۷):** دکمه‌های پیش‌فاکتور/سفارش/فاکتور/پرداخت/شکایت/تیکت با `?new_customer=id` → فرم با مشتری پیش‌انتخاب‌شده باز می‌شود (منطق `new_customer` در `ResourceView.mount`).
- **غیرفعال‌شدن مشتری (بند ۹):** اسناد جدید فقط `f_status=active` می‌گیرند؛ سوابق قبلی نام مشتری را همچنان نشان می‌دهند (تست‌های D3/D3b/D3c).
- **Audit (بند ۳۵):** تغییر مشتری در سند، تغییر `{from,to}` را در Audit Log ثبت می‌کند (تست‌های D5b/D5c: مشتری A → B قابل ردیابی است).
- **Refresh (بند ۳۱):** لیست‌ها بدون Cache سروری؛ مشتری جدید بلافاصله در Selector دیده می‌شود (تست A3).
- **Performance (بند ۳۳):** جستجوی سروری + `per_page` + debounce ۳۰۰ms در Component.
- **Campaign (بند ۲۴):** `audience()` مستقیم از جدول `customers` با فیلترهای معتبر می‌خواند.

## ۴) APIها: تغییر/افزایش
| API | تغییر |
|---|---|
| `GET /api/campaigns/:id/audience` | **افزوده شد** (قبلاً فقط POST داشت؛ GET با 404 خراب بود) |
| `GET /api/r/customer` | اصلاح داخلی: LIKE با escape درست (رفتار API همان) |
| سایر `/api/r/*` | بدون تغییر |

## ۵) تغییرات Database
**هیچ تغییر ساختاری (Schema) لازم نبود** — همهٔ ارتباط‌ها از قبل به `customers.id` بودند. (تست‌ها فقط رکورد ساختند و پاکیزه کردند؛ دیتابیس تحویلی Seed تازه و پاک است.)

## ۶) فایل‌های تغییرکرده (دقیقاً)
| فایل | تغییر |
|---|---|
| `public/js/customer-select.js` | اصلاح جدول ارقام فارسی در `toEnDigits` (خط ۱۱) |
| `server/api/generic.js` | `list()`: استفاده از `term` escape‌شده در LIKE |
| `server/server.js` | روت `GET /api/campaigns/:id/audience` + handler مشترک |
| `public/js/views/pipeline.js` | فرم سریع فرصت → `customerSelect` مشترک (+ import) |
| `public/js/views/sales.js` | قانون پورسانت (مشتری) → `customerSelect` مشترک (+ import) |
| `customer-master-e2e.mjs` | **جدید** — سوئیت E2E اجباری (۴۹ چک) |
| `CUSTOMER-MASTER-REPORT.md` | **جدید** — همین گزارش |

## ۷) مشکلات باقی‌مانده
**صفر.** (یادداشت: فیلترهای سادهٔ `<select>` در چند داشبورد/فیلتر — تقویم، گزارش‌ها، قیمت‌های سفارشی — از همان API ماستر `/api/r/customer` می‌خوانند و فهرست جداگانه ندارند؛ چون فیلتر dropdown هستند و فرم انتخاب سند نیستند، طبق بند «عدم تغییر سایر قسمت‌ها» دست‌نخورده ماندند.)

## ۸) اجرای OOTB
دیتابیس داخل زیپ = Seed تازهٔ پاک (`integrity_check: ok`، ۰ نقض FK، ۰ ردپای تست). اجرا: `npm ci && npm start` → پورت ۳۰۰۰ — `admin/admin1234`.
