# گزارش تکمیل — مأموریت ۷ بنده (Excel Import، ساختار جغرافیایی، گزارش جغرافیایی، ویرایش جلسات، پیگیری‌های متعدد، ثبت صوتی مشتری)

**تاریخ:** ۱۴۰/۰/۲۶ (2026-09-16) · **پورت:** 3050 · **وضعیت:** ✅ تکمیل‌شده و تست‌شده (417/417 تست)

مبدأ: «هیچ قابلیت قبلی حذف نشود، هیچ Mock/Fake ساخته نشود، Workflow/AI/Dashboard دست‌نخورده بمانند (مگر اتصال ضروری)». همهٔ قابلیت‌ها با دادهٔ واقعی در Database ذخیره و از UI واقعی قابل استفاده‌اند.

---

## ۱) Excel Import مشتریان و مخاطبین ✅

**وضعیت پیشین:** زیرساخت Import عمومی (XLSX/XLS/CSV/JSON/XML/TXT با نگاشت ستون) برای مشتریان موجود بود؛ مخاطبین اصلاً Import نداشتند؛ مدیریت تکراری فقط «رد» بود.

**تغییرات:**
- **سیاست سه‌گانهٔ تکراری** در wizard عمومی (`resource-view.js` + `generic.importCommitMapped`):
  - **رد تکراری‌ها** (بدون هیچ تغییری روی دادهٔ فعلی)
  - **به‌روزرسانی رکورد موجود** — فقط ستون‌های نگاشت‌شده تغییر می‌کنند (بدون overwrite فیلدهای نگاشت‌نشده)
  - **ثبت به‌عنوان رکورد جدید** — فقط با تأیید صریح کاربر در confirmDialog
- نمایش **ردیف‌های تکراری** (ردیف فایل + رکورد موجود + فیلد تکراری) پیش از ثبت
- شمارش نهایی: **موفق / بروزرسانی‌شده / بدون تغییر / تکراری-رد / خطادار** + قبل/بعد شمارندهٔ دیتابیس + Audit Log
- **تبدیل خودکار اعداد فارسی** به لاتین در مقادیر فایل (تلفن/موبایل/مبالغ)
- **Import مخاطبین** (فایل جدید `server/api/custom/contacts-import.js` + wizard در `contacts-import.js` سمت UI): انتخاب **مشتری مقصد**، فرمت‌های XLSX/XLS/CSV، نگاشت ستون (نام/سمت/تلفن/موبایل/ایمیل/استان/شهر/شهرک صنعتی/مخاطب اصلی)، تشخیص تکراری **در محدودهٔ همان مشتری**، سه سیاست تکراری، ثبت واقعی در `customer_contacts`
- مجوز: `customer:import` (grant برای sales/sales_manager/marketing/ceo) — بدون مجوز → 403

**فایل‌ها:** `server/api/generic.js` (dupPolicy + per-row dups + toEnDigits)، `server/server.js` (routeهای `/api/contacts/import/*` + فیلدهای جغرافیایی در CRUD مخاطب)، `public/js/resource-view.js` (UI سیاست تکراری)، `public/js/views/contacts-import.js` (wizard)، `server/api/custom/contacts-import.js`

## ۲) ساختار جغرافیایی: استان → شهر → شهرک صنعتی ✅

**مهاجرت 025** (`server/db/migrations/025_geo_followup_voice.sql`):
- `customers.industrial_city`
- `customer_contacts.province/city/industrial_city/updated_at`
- جدول جدید **`industrial_cities`** (name+city یکتا، province، created_by) — **دیتابیس واقعی شهرک‌های صنعتی** که کاربر مجاز ثبت/لغو می‌کند
- `customers.source` (برای ردیابی منبع ثبت — Voice Assistant)
- مجوزهای `industrial_city: view/create/edit` + grantها

**UI:**
- فرم مشتری (عمومی `resource-view.js`): کلاس‌دادهٔ **cascade** — انتخاب استان → دیتالیست شهرهای همان استان (فایل مشترک `public/js/geo.js` با ۳۰ استان و شهرهای اصلی) → دیتالیست شهرک‌های صنعتی ثبت‌شده برای همان شهر + دکمهٔ **«＋ شهرک صنعتی جدید»** (فقط برای نقش‌های دارای مجوز create)
- فرم مخاطب (`contactForm` در `customers.js`): همان سه سطح با cascade
- ویرایش: هر سه سطح در Edit قابل تغییر است (تست G7)
- فهرست استان‌های سرور (`OPT.provinces`) به **۳۰ استان صحیح** ارتقا یافت (پیش‌تر ناقص/تکراری بود: خراسان شمالی/جنوبی، همدان، بوشهر، ایلام غایب و «میان‌دوآب» اشتباه بود)

**API:** `GET/POST /api/industrial-cities` (فیلتر city/province، 409 برای تکراری)، `DELETE /api/industrial-cities/:id` (فقط admin، 409 اگر در رکوردها استفاده شود)

## ۳) گزارش‌گیری جغرافیایی ✅

- نوع گزارش جدید **`customer_geography`** در موتور گزارش (`sales.js`): «جغرافیای مشتریان (استان/شهر/شهرک صنعتی)» — ردیف به‌ازای هر مشتری با ستون‌های استان/شهر/شهرک صنعتی/عنوان/نوع/وضعیت/مسئول فروش/تعداد مخاطبین/تعداد فاکتور/مجموع/تاریخ ثبت — **مستقیماً از جدول‌های واقعی**
- **فیلترها:** استان، شهر، شهرک صنعتی، نوع مشتری (شرکت/شخصی)، وضعیت مشتری (فعال/اولیه/غیرفعال/ممنوع)، مسئول فروش، بازهٔ تاریخ ثبت (از/تا شمسی موجود) + جستجو
- **خروجی‌ها:** نمایش در جدول + **Excel (XLSX واقعی)** + CSV + **HTML/چاپ رسمی** (هدر شرکت) + summary با برش‌های جغرافیایی (فهرست استان‌ها/شهرها/شهرک‌های موجود در نتایج)
- UI (`reports.js`): با انتخاب این گزارش، کانتینر فیلترهای جغرافیایی ظاهر می‌شود (و فیلتر «مشتری» پنهان)

## ۴) جلسات — رفع باگ ویرایش ✅ (ریشه‌یابی کامل)

**ریشهٔ مشکل:** در `meetingForm(id)` متغیر `m` با `const m = id ? null : {}` مقدار می‌گرفت؛ در حالت ویرایش `m = null` بود و اولین دسترسی (`m.title`) **TypeError** می‌زد — یعنی فرم اصلاً باز نمی‌شد (دکمه کار نمی‌کرد، خطا فقط در کنسول بود).

**رفع:**
- `const m = {}` + بارگذاری واقعی مقادیر از API در بلاک async (عنوان، نوع، مشتری، مخاطب، تاریخ‌ها از Jalali picker، محل، وضعیت، یادآوری، اعضای داخلی) — **مخاطب/مشتری هم در ویرایش بارگذاری می‌شوند** (`custCtl.customerSelect.setValue` + `loadContacts`)
- API `PUT /api/meetings/:id` از قبل سالم بود (generic.update) — فقط UI خراب بود
- **تقویت Validation عمومی:** فیلد `required` با مقدار خالی (`''`) دیگر رد نمی‌شد — حالا «عنوان نمی‌تواند خالی باشد» (generic.js)
- **تست واقعی Create → Edit → Save → Reload** (Playwright `mission7-ui-test.mjs` U10–U13): ایجاد جلسه از UI با Jalali picker → کلیک «ویرایش» → فرم با مقادیر قبلی باز می‌شود → تغییر عنوان → ذخیره → **بعد از page.reload مقدار جدید از دیتابیس نمایش داده می‌شود**

## ۵) پیگیری — چند پیگیری برای یک موضوع (Attempts) ✅

**مهاجرت 025:** جدول جدید **`followup_attempts`** (followup_id, acted_at, method, result, note, user_id, next_followup_at, reminded_at)

**قوانین:**
- یک Follow-up اصلی می‌تواند **بسیاری Attempt** داشته باشد؛ **هیچ Attempt قبلی حذف نمی‌شود** (endpoint حذف وجود ندارد — تاریخچه immutable است)
- وضعیت اصلی: **Open (pending) / In Progress / Completed (done) / No Result / Cancelled / Missed**
- ثبت اولین Attempt، وضعیت اصلی را به‌صورت خودکار `in_progress` می‌کند؛ **تا نتیجهٔ نهایی (ذخیره وضعیت) باز می‌ماند**
- هر Attempt: **تاریخ/ساعت، نحوه (تماس/جلسه/ایمیل/پیام/بازدید/سایر)، نتیجه، توضیحات، کاربر، و پیگیری بعدی (Reminder)**

**اتصال‌ها (واقعی):**
- **Calendar:** رویدادهای «پیگیری بعدی» در تقویم نمایش داده می‌شوند (تست F6)
- **Notifications + Scheduler:** یادآوری سررسید شدهٔ پیگیری‌های بعدی یک‌بار اعلان می‌دهد و `reminded_at` ثبت می‌شود (scheduler.js)
- **پروندهٔ مشتری:** تب «پیگیری‌ها» در جزئیات مشتری، تعداد و آخرین نتیجهٔ attempts هر موضوع را نشان می‌دهد
- **UI:** در جزئیات Follow-up بخش «تاریخچهٔ پیگیری‌ها» (لیست timeline) + دکمهٔ **«＋ ثبت پیگیری جدید»** (فرم: تاریخ/نحوه/نتیجه/توضیح/پیگیری بعدی) + کنترل وضعیت اصلی
- Audit Log برای ثبت attempt و تغییر وضعیت

**API:** `GET/POST /api/followups/:id/attempts`، `POST /api/followups/:id/status`

## ۶) Voice Customer Registration ✅ (از UI تا Database)

**دکمهٔ مشخص در نوار مشتری‌ها:** «🎙 ثبت سریع مشتری با صدا» (`public/js/views/voice-reg.js`)

**فلو واقعی (بدون هیچ fake):**
1. **Speech-to-Text مرورگری** (Web Speech API با `fa-IR`، زنده با interim results) — اگر مرورگر پشتیبانی نکند، **شفاف اعلام می‌شود** و fallback تایپ متن گفتار فعال است (هرگز موفقیت جعلی)
2. **استخراج اطلاعات سمت سرور** (`server/ai/voice-extract.js` + `POST /api/voice/parse`): نام، شرکت، موبایل/تلفن (اعداد فارسی→لاتین)، سمت، صنعت، استان (از ۳۰ استان واقعی)، شهر، شهرک صنعتی، توضیحات (متن کامل گفتار) — تحلیل متن واقعی، بدون سرویس آنلاین
3. **نمایش مقادیر استخراج‌شده در فرم قابل ویرایش** پیش از ثبت + هشدار «اطلاعات ناقص»
4. **ثبت نهایی با تأیید کاربر** از مسیر واقعی API مشتری (validate + dedup + شماره + audit + **رویداد customer_created → Workflow**)
5. `source = 'Voice Assistant'` در دیتابیس + متن گفتار در notes + صنعت گفتاری اگر با master industry تطبیق داده شده باشد
6. **اطلاعات ناقص → وضعیت «اولیه (در انتظار تکمیل)»** (`status='lead'` — گزینهٔ جدید در master وضعیت مشتری) و بعداً قابل تکمیل

## ۷) تست اجباری ✅ (417/417 روی سرور زندهٔ پورت 3050)

| سوئیت | پوشش | نتیجه |
|---|---|---|
| `mission7-e2e-test.mjs` (جدید) | Import مشتری XLSX + اعداد فارسی + ۳ سیاست تکراری + خطا / Import مخاطب + تکراری+به‌روزرسانی / شهرک صنعتی (CRUD+409) + جغرافیای مشتری/مخاطب + ویرایش / گزارش جغرافیایی (۵ فیلتر + XLSX + HTML) / جلسه Create→Edit→persist→validation / ۳ Attempt + immutable + در-progress + تقویم + وضعیت نهایی / voice parse + ثبت واقعی + lead / RBAC (403 lab، 200 support، 401 بدون توکن) | **58/58** |
| `mission7-ui-test.mjs` (جدید, Playwright) | دکمهٔ صدا + مودال + وضعیت صادقانهٔ STT / cascade استان→شهر→شهرک + دکمهٔ شهرک جدید / دکمه + wizard Import مخاطبین / **جلسه: Create UI → Edit (مقادیر قبلی) → Save → Reload (دایورم)** / بخش تاریخچهٔ پیگیری‌ها + دکمهٔ attempt جدید / گزارش جغرافیایی + فیلترها در UI / Responsive 375px / بدون خطای JS | **21/21** |
| `sales-chain-test.mjs` | زنجیرهٔ فروش کامل (با ۱۷ نوع گزارش) | 80/80 |
| `security-test.mjs` | امنیت کامل | 54/54 |
| `sales-scenario-wf-test.mjs` | سناریوی فروش E2E موتور Workflow | 34/34 |
| `opc-e2e-test.mjs` | OPC/گزارش‌ها | 43/43 |
| `wf-e2e-test.mjs` | موتور Workflow | 22/22 |
| `wf-engine-ui-e2e.mjs` (Playwright) | Canvas ویزوال (با بهبودهای جدید) | 19/19 |
| `ui-e2e-browser.mjs` (Playwright) | UI عمومی + responsive | 35/35 |
| `ai-wf-event-test.mjs` | AI → Event → Workflow | 12/12 |
| `followup-calendar-test.mjs` | پیگیری/تقویم | 14/14 |
| `dashboard-analytics-test.mjs` | داشبورد | 18/18 |
| `cascade-test.mjs` | حذف رکورد → terminate اجراها | 7/7 |
| **جمع** | | **417/417** |

## نمایش منظم‌تر Workflow (درخواست تکمیلی) ✅

- **Auto-fit هنگام باز شدن طراح** — کل فرآیند در نمای اول منظم دیده می‌شود (نه زوم/نامنظم)
- **Auto Layout بهبودیافته:** تراز لایه‌ای (longest-path)، فاصلهٔ یکنواخت (250×120)، گره‌های بدون اتصال در ردیف جدا، و Fit خودکار پس از چیدمان
- **Grid-snap (10px) هنگام Drag** — گره‌ها روی شبکه می‌نشینند
- فقط ظاهر Canvas (`processes.js`) — موتور/داده‌ها دست‌نخورده؛ تست Canvas 19/19 سبز

## فایل‌های تغییر‌یافته (این دور)

**Backend:** `server/db/migrations/025_geo_followup_voice.sql` (جدید)، `server/api/generic.js` (dupPolicy/empty-required/toEnDigits در import)، `server/api/resources.js` (فیلدهای جغرافیایی + source + وضعیت lead + ۳۰ استان)، `server/api/custom/contacts-import.js` (جدید)، `server/api/custom/geography.js` (جدید)، `server/api/custom/sales.js` (گزارش customer_geography + sanitize عنوان XLSX)، `server/server.js` (routeهای جدید + جغرافیای CRUD مخاطب)، `server/core/scheduler.js` (یادآوری attempts)، `server/api/custom/calendar.js` (رویدادهای attempts + همهٔ وضعیت‌ها)، `server/ai/voice-extract.js` (جدید)

**Frontend:** `public/js/geo.js` (جدید — استان/شهر + cascade)، `public/js/resource-view.js` (cascade جغرافیایی + UI سیاست تکراری import)، `public/js/views/customers.js` (دکمهٔ صدا، wizard import مخاطبین، جغرافیای فرم مخاطب، attempts در تب پیگیری مشتری)، `public/js/views/voice-reg.js` (جدید)، `public/js/views/contacts-import.js` (جدید)، `public/js/views/planning.js` (بخش attempts در جزئیات)، `public/js/views/meetings.js` (**رفع باگ ویرایش** + بارگذاری مشتری/مخاطب در Edit)، `public/js/views/reports.js` (فیلترهای جغرافیایی + برچسب‌ها)، `public/js/views/processes.js` (auto-fit/layout/snap)، `public/js/core.js` (برچسب وضعیت‌های جدید)

**تست‌ها:** `mission7-e2e-test.mjs`، `mission7-ui-test.mjs` (جدید) + به‌روزرسانی `sales-chain-test.mjs` (۱۷ نوع گزارش)

**دست‌نخورده (طبق اصل مأموریت):** Workflow Visual Engine (موتور/API/داده)، AI Assistant (حالت‌های موجود)، Dashboard، و سایر ماژول‌های سالم — فقط اتصال‌های ضروری (رویداد customer_created از ثبت صوتی، تقویم/یادآوری برای attempts).

## وضعیت پایگاه داده (پاک‌سازی نهایی)

- Migration 025 اعمال‌شده؛ جداول جدید: `industrial_cities`، `followup_attempts`
- داده‌های آزمایشی همهٔ دورهای تست پاک‌سازی شد (customers/quotes/meetings/followups/contacts = 0؛ ۵ فرآیند Workflow واقعی و ۳۰ استان/فیلدهای جغرافیایی در master data)
- سرور روی **0.0.0.0:3050** با `/health` OK اجرا می‌شود
