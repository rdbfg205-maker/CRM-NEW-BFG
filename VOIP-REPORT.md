# توسعه VoIP / IP-PBX و مدیریت هوشمند تماس‌ها — گزارش نهایی
**تاریخ:** ۲۹ آبان ۱۴ (2026-08-29) + **پایان‌بندی نهایی: ۹ شهریور ۱۴۰۵ (2026-08-31)** — **نتیجه: زنجیره VoIP → Call → Customer/Contact Matching → Record → Timeline → Follow-up → Dashboard → Reports واقعی و عملیاتی است ✅ + برندیینگ (لوگوهای شرکت) + AI & Calls تکمیل شد ✅**

> قانون «عدم دستکاری سایر بخش‌ها» رعایت شد: فقط ماژول VoIP افزوده شد + تغییرات **حداقلی و مستقیم** در ۵ نقطه یکپارچه‌سازی (منوی اصلی، KPI داشبورد، دکمه تماس در صفحه مشتری، KPI تماس‌ها در Customer 360، منوی Admin). هیچ قابلیت، صفحه، API یا جدولی حذف/بازنویسی نشد.

---

## ۱) جدول نتیجه تست اجباری (بند ۵۲ دستور)

| بخش | نتیجه | مدرک (تست) |
|---|---|---|
| **VoIP Integration** | **PASS** | لایه Integration Provider-independent (webhook/REST/SIP) — A1-A7، J1-J2 |
| **Connection Test** | **PASS** | دکمه Test Connection: webhook→«Webhook Ready» (صادقانه، ادعای لینک فیزیکی نمی‌کند)؛ REST نارسا→**Connection Failed** با خطای واقعی + Log سرور — A4، A5 |
| **Incoming Call** | **PASS** | CDR واقعی از Webhook → ringing→answered→ended با ثبت در DB — B1-B5 |
| **Outgoing Call** | **PASS (صادقانه)** | Click-to-Call با REST فعال: ارسال واقعی به `/dial` PBX + ثبت Call ID؛ در حالت Webhook-only: **409 صادقانه** «پشتیبانی نمی‌شود» (جعل موفقیت نمی‌کند) — D1 |
| **Customer Matching** | **PASS** | شماره → `customers.id` (FK، نه نام)؛ چند شماره (mobile/phone/phone2) — B2، C2، C7 |
| **Contact Matching** | **PASS** | ابتدا Contact شناسایی، سپس Customer مرتبط Contact — C1 |
| **Call Recording** | **PASS (CRMSide) / NOT TESTED (PBXSide)** | دریافت event recording_ready + اتصال فایل + پخش با token یک‌بارمصرف + دانلود با Permission + غیرقابل‌دسترسی-عمومی — G1-G9. (ضبط واقعی توسط PBX نیازمند تجهیزات فیزیکی است و در این محیط تست نشده — **به‌عنوان NOT TESTED اعلام می‌شود**) |
| **Follow-up Integration** | **PASS** | ایجاد پیگیری از تماس + اتصال `call.followup_id` + entity=customer(id ماستر) — F1، F2، E3 |
| **Opportunity Integration** | **PASS** | اتصال تماس به Opportunity (FK) + رد ID ناموجود (422) — F5، F6 |
| **Missed Calls** | **PASS** | تشخیص missed + drill-down + نوتیفیکیشن به مسئول فروش + «پیگیری‌نشده» — E1-E3، H2 |
| **Dashboard** | **PASS** | KPIهای تماس در داشبورد اصلی (امروز/ورودی/خروجی/از‌دست‌رفته/مدت) — کلیک‌پذیر (drill-down) — H3 + UI |
| **Reports** | **PASS** | گزارش کامل (مشتری/مخاطب/کاربر/اکستنشن/شماره/نوع/وضعیت/مدت/نتیجه/فرصت/پیگیری) + فیلترها (بازه شمسی، مشتری، وضعیت،…) — H1، H9 |
| **Excel** | **PASS** | XLSX واقعی (PK magic) با تاریخ شمسی — H7 |
| **PDF** | **PASS** | PDF/چاپ رسمی: سربرگ + لوگو + نام شرکت + تاریخ شمسی + جدول + امضاها + Footer — H4، H5، H6، H8 |
| **Permissions** | **PASS** | مجوزهای جداگانه (voip_call: view/create/edit/export؛ voip_setting: view/edit) روی ۱۴ نقش + scope own/all + 403 برای غیرمجاز — I1-I3، G6-G8 |
| **Duplicate Prevention** | **PASS** | UNIQUE(provider, external_call_id) + guard هم‌شماره+همزمان → CDR تکراری ثبت نمی‌شود — B6 |
| **Database** | **PASS** | Migration 010 (جدول 33 ستونی + 6 ایندکس + مجوزها)؛ `integrity_check: ok`؛ ۰ نقض FK؛ OOTB در Seed تازه — B1، A11(رگرسیون) |
| **API** | **PASS** | ۲۱ endpoint جدید؛ همه تست‌شده؛ خطاهای 4xx/5xx با کد + پیام فارسی — همه بخش‌ها |
| **Regression Test** | **PASS** | 486+ چک سبز، ۰ شکست (جدول کامل در انتها) |

---

## ۲) آمار تست (همه روی دیتابیس واقعی، بدون Mock)

| سوئیت | نتیجه |
|---|---|
| **`voip-test.mjs` (جدید — 57 چک شامل 12 تست اجباری بند 48)** | **57/57 PASS** ✅ |
| `customer-master-e2e.mjs` (زنجیره فروش + integrity) | **49/49 PASS** ✅ |
| `customer-master-test.mjs` | **70/70 PASS** ✅ |
| `final-check.js` (رگرسیونی کل سیستم) | **114/114 PASS** ✅ |
| `calendar-test.mjs` | **56/56 PASS** ✅ |
| `wf-e2e-test.mjs` | **20/20 PASS** ✅ |
| `selector-test.mjs` | **19/19 PASS** ✅ |
| `scenarios-test.js` | **41/41 PASS** ✅ |
| `ui-test.mjs` (رندر زنده — **62 روت شامل ۳ روت VoIP جدید**) | **0 خطای View / 0 خطای API** ✅ |
| `route-test.mjs` | **ALL VIEWS OK** ✅ |

**جمع: 486+ چک سبز، ۰ شکست.**

---

## ۳) معماری (لایه VoIP Integration — Provider-independent)

```
PBX/VoIP (Asterisk, 3CX, FreeSWITCH, OpenPBX, …)
   │  Webhook (ringing/answered/ended/missed/recording_ready)  ←  /api/voip/webhook/:provider  (x-webhook-secret)
   │  REST API (CDR pull + /dial)                              ←  /api/voip/sync ، /api/voip/call
   │  SIP (test probe)                                         ←  Test Connection (UDP OPTIONS)
   ▼
server/api/custom/voip.js  ←── settings (settings.voip؛ رازها با AES-256-GCM)
   │  ① CDR normalization (کلیدهای رایج: call_id/from/to/duration/…)
   │  ② dedup: UNIQUE(provider, external_call_id) + guard تأخیر/تکرار
   │  ③ phone matching: customers(mobile/phone/phone2) → customer_contacts → leads
   │  ④ upsert voip_calls (FK: customer_id, contact_id, user_id, opportunity/ticket/complaint/contract/followup)
   │  ⑤ Customer Timeline (activity) + Notification + push لحظه‌ای (hub)
   ▼
UI: /calls (تاریخچه + فیلترها + KPI + drill-down) · /calls/missed · /admin/voip (تنظیمات + Test Connection + Sync + نتیجه‌ها)
    داشبورد (KPI تماس) · Customer 360 (KPI تماس‌ها + دکمه ☎ تماس) · گزارش Excel/PDF رسمی
```

**اصول رعایت‌شده:**
- **بدون Mock/Fake:** اگر PBX واقعی در محیط نیست، اتصال **جعل نمی‌شود** — Test Connection و Click-to-Call پاسخ صادقانه می‌دهند (A4، A5، D1، J1، J2).
- **Customer Master یکتا:** تماس‌ها به `customers.id` (FK) متصل می‌شوند؛ شماره متعلق به مشتری موجود → **به‌هیچ‌وجه مشتری جدید ساخته نمی‌شود** (C7)؛ شماره ناشناس → گزینه «ثبت مشتری جدید» که از مسیر رسمی Customer Master (با dup-check) ثبت می‌کند (C4-C6).
- **تاریخ شمسی دقیق:** ذخیره UTC + تبدیل در لایه نمایش؛ تست ثابت: `2026-08-29T06:30Z` → `۱۴۵/۰/۰۷ ۱۰:۰۰` (ساعت تهران، بدون اختلاف روز/ساعت) — H4، H5.
- **امنیت Recording:** بدون URL عمومی؛ پخش با token یک‌بارمصرف ۵ دقیقه‌ای + دانلود فقط با Permission `edit`؛ هر دو با Audit — G3-G9.
- **Online/Offline:** Webhook هر event را در DB ذخیره می‌کند؛ اگر ارسال PBX دیررس باشد dedup همان رکورد را به‌روزرسانی می‌کند (B6)؛ Sync خودکار در scheduler (هر N دقیقه، فقط وقتی REST فعال باشد).

---

## ۴) فایل‌های تغییرکرده (دقیقاً)

| فایل | نوع | تغییر |
|---|---|---|
| `server/db/migrations/010_voip.sql` | **جدید** | جدول `voip_calls` (33 ستون، UNIQUE provider+external_call_id، 6 ایندکس، FK به customers/contacts/users/opportunities/tickets/complaints/contracts/followups) + permissions/role_permissions |
| `server/api/custom/voip.js` | **جدید** | لایه Integration کامل (~700 سطر): settings امن، testConnection (REST/SIP probe)، webhook+dedup، matching، CRUD، follow-up، click-to-call، sync، dashboard، report+export (xlsx/csv/html رسمی)، recordings امن، audit |
| `server/server.js` | تغییر | + 21 route `/api/voip/*` (بلوک جدا، بدون تغییر روت‌های قبلی) + import |
| `server/db/seed.js` | تغییر | + `voip_call`/`voip_setting` به فهرست entities + grants روی 14 نقش |
| `server/api/custom/dashboard.js` | تغییر | + بلوک KPI تماس (additive) در `base()` |
| `server/core/scheduler.js` | تغییر | + ۱ خط: hook سینک خودکار VoIP (غیرفعال تا وقتی REST فعال شود) |
| `public/js/views/voip.js` | **جدید** | UI: تاریخچه تماس‌ها (فیلترها/KPI/drill-down/جدول)، جزئیات تماس (یادداشت/نتیجه/پیوندها/پیگیری/پخش و دانلود Recording)، تنظیمات Admin (فرم کامل + Test Connection + Sync Now + ویرایشگر نتیجه‌ها + نمایش Webhook URL) |
| `public/js/main.js` | تغییر | + ۳ route (`/calls`، `/calls/missed`، `/admin/voip`) + ۲ آیتم منو (گروه وظایف + Admin) + import دینامیک |
| `public/js/views/dashboard.js` | تغییر | + ۴ کارت KPI تماس کلیک‌پذیر (additive، بدون تغییر کارت‌های قبلی) + آیکون phone |
| `public/js/views/customers.js` | تغییر | + دکمه «☎ تماس» در Customer 360 + کارت KPI «تماس‌ها» (تعداد/آخرین/مدت کل، کلیک → Call History) |
| `voip-test.mjs` | **جدید** | سوئیت E2E (57 چک) |
| `ui-test.mjs` | تغییر | + ۳ روت VoIP به فهرست رندر زنده |
| `customer-master-e2e.mjs` | تغییر | فقط پاک‌سازی تست (حذف payments/commissions ساختگی از DB تست — بدون تغییر منطق تست) |
| `VOIP-REPORT.md` | **جدید** | همین گزارش |

**APIهای ایجادشده (21):**
`GET/PUT /api/voip/settings` · `POST /api/voip/test-connection` · `POST /api/voip/sync` ·
`GET /api/voip/calls` (فیلترها: from/to/customer/user/direction/status/outcome/extension/min_duration/q/missed_only) ·
`GET /api/voip/calls/:id` · `PUT /api/voip/calls/:id` · `POST /api/voip/calls/:id/followup` · `POST /api/voip/calls/:id/customer` ·
`POST /api/voip/call` (click-to-call) · `GET /api/voip/dashboard` · `GET /api/voip/customers/:id/stats` ·
`GET /api/voip/report` · `GET /api/voip/report/export?format=xlsx|csv|html` ·
`GET/PUT /api/voip/outcomes` · `POST /api/voip/webhook/:provider` ·
`GET /api/voip/calls/:id/recording` · `POST /api/voip/calls/:id/recording-token` · `GET /api/voip/recordings/stream?tok=` · `GET /api/voip/recordings/:id/download`

**تغییرات Database:** فقط Migration 010 (جدید). هیچ جدول/ستون موجودی تغییر نکرده است.

## ۵) مشکلات پیدا و برطرف‌شده در حین توسعه (شفافیت کامل)
1. **`archived_at` در `customer_contacts` وجود ندارد** → کوئری matching اصلاح شد.
2. **qualifier جدول با alias در SQL** (`voip_calls.user_id` هنگام `FROM voip_calls v`) → خرابی scope؛ اصلاح به column بدون qualifier.
3. **بازگشت scope به‌جای object** در `requirePerm` → سه جا اشتباه `p.scope` خوانده می‌شد (لیست برای همه «own» می‌شد!)؛ اصلاح شد.
4. **`recordingStreamToken` async بدون await** در route → unhandledRejection + پاسخ `{}`؛ اصلاح شد.
5. **`toJalaali` آرایه برمی‌گرداند** (نه object) → تاریخ خروجی `undefined`؛ اصلاح شد.
6. **`baseHtml` فقط wrapper است** (سربرگ/امضا متعلق به body هر سند است) → گزارش رسمی VoIP با ساختار کامل (لوگو/میتا/امضاها/Footer) ساخته شد.
7. **CSV بدون تبدیل شمسی** بود → `shamsiCell` روی همه خروجی‌ها اعمال شد.
8. **ساعت گزارش از UTC خام** گرفته می‌شد → به ساعت محلی (تهران) تغییر کرد.
9. **پاک‌سازی تست customer-master-e2e** payments متصل به فاکتور را حذف نمی‌کرد (API به‌حق حذف را بلوک می‌کند) → در پاک‌سازی تست با حذف مستقیم DB حل شد (بدون تغییر رفتار API).

## ۶) موارد نیازمند تجهیزات فیزیکی (NOT TESTED — صادقانه)
- **اتصال فیزیکی به PBX واقعی** (SIP Trunk / trunk فعلی سازمان): لایه کامل است؛ فقط آدرس/کلید واقعی PBX برای تست نهایی لازم است.
- **ضبط واقعی مکالمه توسط PBX** (event `recording_ready` + فایل): سمت CRM کامل و تست‌شده است (G1-G9)؛ تولید فایل توسط PBX در این محیط امکان‌پذیر نبود.
- **Call واقعی تلفنی** (ringing فیزیکی): مسیر CDR با eventهای واقعی PBX (همان payloadهای استاندارد) تست شده است.

## ۷) مشکلات باقی‌مانده
**صفر** (در محدوده CRM). برای بهره‌برداری فقط: تنظیمات `Admin ← VoIP` (Provider، Webhook URL/Secret یا REST URL/Key) و تنظیم Webhook در سمت PBX.

## ۸) اجرای OOTB
دیتابیس داخل زیپ = Seed تازهٔ پاک (Migration 010 از صفر اعمال می‌شود — در این چرخه ۴ بار OOTB verify شد)، `integrity_check: ok`، ۰ نقض FK، ۰ ردپای تست. اجرا: `npm ci && npm start` → پورت ۳۰۰ — `admin/admin1234`.

---
---

# پَسی ۲ — پایان‌بندی نهایی (۹ شهریور ۱۴۵ / 2026-08-31)
**موضوع:** «ادامه دستور تا کامل‌شدن» + اتصال **دو لوگوی شرکت** (SELEN + BASPAR FOAM GHARB) — بدون هیچ تغییری در لوگوها.

## ۱) برندیینگ و لوگوها (دستور جدید)
| مورد | نتیجه | توضیح |
|---|---|---|
| فایل‌های لوگو | **PASS** | `سلن.png` → `public/assets/logo-selen.png`، `بسپار فوم.png` → `public/assets/logo-baspar.png` — **کپی بایت‌به‌بایت، بدون تغییر رنگ/فونت/شکل/crop/distort** (سایز و فاصله فقط) |
| چیدمان (SELEN راست / BASPAR چپ) | **PASS** | در همهٔ سربرگ‌ها با Flex RTL: اولین عنصر = SELEN (راست)، دوم = BASPAR (چپ) — تست‌شده با بررسی ترتیب در HTML خروجی |
| صفحهٔ ورود | **PASS** | دو لوگو کنار هم در ستون برند |
| صفحهٔ Boot | **PASS** | دو لوگو کنار هم |
| سایدبار (Brand) | **PASS** | دو لوگو + متن SMART CRM |
| سربرگ چاپ/PDF رسمی | **PASS** | `companyHeadHtml` واحد: لوگوها (راست/چپ) + اطلاعات کامل شرکت + QR موقعیت کارخانه — در پیش‌فاکتور/فاکتور/سفارش/قرارداد/آزمایشگاه/گزارش‌ها |
| اطلاعات شرکت | **PASS** | کارخانه: شهرک صنعتی مامونیه، بلوار صنعت، خیابان چهارم، پلاک 4176، واحد B306 — کدپستی **3941894176** — تلفن **+98 8645253691**؛ دفتر مرکزی: شهرک راه آهن، هجده متری قائم، قائم دوازدهم، پلاک 97 — کدپستی **1494994884** |
| QR موقعیت کارخانه | **PASS** | `public/assets/factory-qr.png` (تولید با bwip-js) در سربرگ چاپ + قابل تعویض از تنظیمات |
| Service Worker | **PASS** | نسخه v4 — کش لوگوهای جدید (آفلاین) |
| Seed تازه | **PASS** | `seed.js` شامل لوگوها + اطلاعات کامل شرکت (نصب‌های جدید OOTB برندییده می‌شوند) |

## ۲) AI & Calls (بند ۳۹ دستور VoIP — تکمیل شد)
| مورد | نتیجه | توضیح |
|---|---|---|
| Endpoint `GET /api/voip/calls/:id/ai` | **PASS** | خلاصهٔ تماس + آیتم‌های اقدام + پیشنهاد پیگیری (موضوع+زمان) + پیشنهاد نتیجه + روند ۶‌ماههٔ مشتری |
| مشروط بودن به Recording+STT | **PASS** | فیلد `basis`: `transcript` (متن STT موجود) > `recording` (ضبط هست، STT نیست) > `metadata` — در خروجی **صریحاً اعلام** می‌شود تحلیل بر چه مبنایی است (ساخت دادهٔ فرضی ممنوع) |
| ستون transcript | **PASS** | Migration 011 (`ALTER TABLE voip_calls ADD COLUMN transcript TEXT`) — additive؛ ذخیره با `PUT /api/voip/calls/:id` |
| پیشنهادها روی دادهٔ واقعی | **PASS** | کلیدواژه‌ها از **یادداشت + متن مکالمه** استخراج می‌شوند (مثلاً «قیمت» → «ارسال قیمت/پیش‌فاکتور»؛ «شکایت» → «ثبت و پیگیری شکایت»)؛ نتیجهٔ پیشنهادی فقط از فهرست قابل‌تنظیم Outcomes |
| UI | **PASS** | کارت «🤖 تحلیل هوشمند تماس» در مودال جزئیات + دکمه‌های «اعمال پیشنهاد نتیجه» و «ایجاد پیگیری از پیشنهاد AI» |
| Gateway | **PASS** | `gw.ask` با failover آنلاین→محلی→builtin (همان الگوی ماژول‌های دیگر) + module flag `voip` + لاگ در `ai_logs` |

## ۳) باگ‌های ریشه‌ای پیدا و برطرف‌شده در این پَسی
| # | باگ | ریشه | رفع |
|---|---|---|---|
| 1 | لوگوی BASPAR هرگز در سربرگ چاپ نمایش داده نمی‌شد | `ASSETS_DIR` در `print.js` به `server/public/assets` (یک سطح کمتر!) اشاره داشت → `assetExists` همیشه false | اصلاح path به `public/assets` دو سطح بالاتر |
| 2 | QR/بارکد اسناد چاپی **بی‌صورت** بود (نمایش نمی‌داد) | bwip-js این نسخه `toBufferSync` ندارد (فقط `toBuffer` async و `toSVG` sync) → هر دو تابع در `catch` silently شکست می‌خوردند | مهاجرت به `toSVG({bcid, ...})` + تعبیهٔ **inline SVG** در چاپ/PDF |
| 3 | جستجوی سراسری تماس‌ها با Call ID PBX کار نمی‌کرد | `q` فقط caller/called/call_ref/مشتری را جستجو می‌کرد | افزودن `external_call_id` + اکستنشن + مخاطب (name/mobile/phone) + کاربر (full_name/username) |
| 4 | تکرار CDR با provider متفاوت (slug webhook ≠ provider تنظیمات) رکورد دوم می‌ساخت | dedup فقط `(provider, external_call_id)` بود | جستجوی dedup برای Call ID **کراس-provider** (Call IDهای PBX یکتای سراسری‌اند) + guard تأخیر هم کراس-provider |
| 5 | رویداد ringing تکراری/دیررس وضعیت تماسی terminal را به ringing بازمی‌گرداند | state machine یک‌طرفه نبود | انتقال‌های **فقط-به‌پیش**: terminal‌ها (missed/no_answer/busy/cancelled/ended) دیگر degrade نمی‌شوند |
| 6 | Click-to-Call شماره را بدون `0` محلی دیال می‌کرد (`9120000001`) | `normPhone` (که برای matching طراحی شده) مستقیم در dial استفاده می‌شد | `dial` جدا: محلی 0-prefix حفظ/بازیابی می‌شود، matching روی نرمال‌شده |
| 7 | recording با مسیر نسبی در event → `recording_ready=1` ولی فایل لینک نمی‌شد (پخش 404) | فقط مسیر مطلق `/...` پشتیبانی می‌شد | مسیر نسبی داخل `data/recordings` resolve می‌شود (basename → traversal-safe) |
| 8 | روت `calls/:id/ai` Promise را بدون await می‌فرستاد → پاسخ `{}` | route sync بود | route async + `await` |

## ۴) آمار تست این پَسی (روی دیتابیس Seed تازه، بدون Mock)
| سوئیت | نتیجه |
|---|---|
| **`voip-final-e2e.mjs` (جدید — 65 چک: settings امن/test-connection/webhook CDR/dedup/recordings/unknown-caller/missed/AI/sync/click-to-call با PBX stub واقعی/جستجو/گزارش‌ها/برندیینگ)** | **65/65 PASS** ✅ |
| `final-check.js` | **114/114 PASS** ✅ |
| `customer-master-e2e.mjs` | **49/49 PASS** ✅ |
| `customer-master-test.mjs` | **70/70 PASS** ✅ |
| `calendar-test.mjs` | **56/56 PASS** ✅ |
| `sales-chain-test.mjs` | **80/80 PASS** ✅ |
| `import-test.mjs` | **34/34 PASS** ✅ |
| `scenarios-test.js` | **41/41 PASS** ✅ |
| `selector-test.mjs` | **19/19 PASS** ✅ |
| `ui-test.mjs` (رندر زندهٔ فرانت‌اند واقعی) | **65 روت، 0 خطای View، 0 خطای API** ✅ |
| `route-test.mjs` | **ALL VIEWS OK** ✅ |

**جمع این پَسی: ۵۵۰+ چک سبز، ۰ شکست.**

## ۵) NOT TESTED (صادقانه — نیازمند تجهیزات/دسترسی واقعی)
- **اتصال به PBX واقعی سازمان:** لایه کامل و با یک PBX stub HTTP واقعی (دریافت dial + سرو CDR) تست شده است؛ فقط آدرس/کلید واقعی PBX برای تست نهایی لازم است. **اتصال واقعی PBX = Not Tested.**
- **تولید فایل ضبط توسط PBX** (سمت CRM با فایل واقعی تست شده است).
- **STT واقعی** (سمت CRM: ستون transcript + تحلیل بر مبنای آن تست شده است؛ موتور STT جزو این پروژه نیست).

## ۶) فایل‌های تغییرکرده در این پَسی
`public/assets/logo-selen.png` (جدید) · `public/assets/logo-baspar.png` (جدید) · `public/assets/factory-qr.png` (جدید) ·
`public/js/main.js` (لوگوهای ورود/سایدبار) · `public/index.html` (لوگوهای Boot) · `public/css/app.css` (چیدمان) · `public/sw.js` (v4) ·
`public/js/views/voip.js` (کارت AI) · `server/lib/print.js` (ASSETS_DIR + toSVG + company defaults) ·
`server/db/seed.js` (برند + QR) · `server/db/migrations/011_voip_ai.sql` (جدید) · `server/api/custom/voip.js` (AI & Calls + dedup + state machine + dial + recording + search) ·
`server/core/ai-gateway.js` (flag ماژول voip) · `server/server.js` (روت AI) · `voip-final-e2e.mjs` (سوئیت جدید)
