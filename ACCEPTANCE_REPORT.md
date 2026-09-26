# ACCEPTANCE REPORT — BASPAR FOAM SMART CRM
**مرحلهٔ تکمیل CRM (مخاطبین، تاریخ/ساعت، جلسات، قوانین کار، تیم هوشمند) + معیارهای پذیرش ۳۸ ماژول**
**تاریخ: 2 مهر ۱۴۵ (2026-09-02) — استک: Node.js 20 + SQLite (better-sqlite3) + Vanilla JS ESM**

> روش: `acceptance-test.mjs` — ۱۵۴ چک خودکار سطح API/E2E روی دیتابیس واقعی (بدون Mock). هر ماژول فقط در صورت PASS همهٔ چک‌های خود «تکمیل» است.
> نتایج: **154/154 PASS — 38/38 ماژول PASS — 0 FAIL**

## جدول PASS/FAIL هر ماژول

| ماژول | نتیجه | چک‌ها | جزئیات |
|---|---|---|---|
| `1.داشبورد مدیریت/CEO` | **PASS** | 2/2 | |
| `2.داشبورد فروش` | **PASS** | 2/2 | |
| `3.مشتریان` | **PASS** | 8/8 | |
| `4.مخاطبین` | **PASS** | 8/8 | |
| `5.Leads` | **PASS** | 5/5 | |
| `6.Opportunities` | **PASS** | 5/5 | |
| `7.Sales Pipeline` | **PASS** | 5/5 | |
| `8.محصولات` | **PASS** | 6/6 | |
| `9.لیست قیمت` | **PASS** | 3/3 | |
| `10.پیش‌فاکتور (Proforma)` | **PASS** | 7/7 | |
| `11.سفارشات` | **PASS** | 1/1 | |
| `12.فاکتورها` | **PASS** | 3/3 | |
| `13.پرداخت‌ها` | **PASS** | 3/3 | |
| `14.پورسانت فروش` | **PASS** | 3/3 | |
| `15.آزمایشگاه — درخواست` | **PASS** | 2/2 | |
| `16.آزمایشگاه — نتایج` | **PASS** | 2/2 | |
| `17.شکایات` | **PASS** | 4/4 | |
| `18.تیکت‌ها` | **PASS** | 2/2 | |
| `19.گارانتی` | **PASS** | 1/1 | |
| `20.قراردادها` | **PASS** | 3/3 | |
| `21.کمپین‌ها` | **PASS** | 3/3 | |
| `22.جلسات` | **PASS** | 4/4 | |
| `23.تقویم و برنامه‌ریزی` | **PASS** | 3/3 | |
| `24.پیگیری‌ها (Follow-up)` | **PASS** | 3/3 | |
| `25.گزارش‌ها` | **PASS** | 3/3 | |
| `26.Report Builder` | **PASS** | 4/4 | |
| `27.مدیریت اسناد` | **PASS** | 4/4 | |
| `28.AI (Analytics/Forecast/Churn/Scoring)` | **PASS** | 3/3 | |
| `29.تیم هوشمند / AI Smart Team` | **PASS** | 13/13 | |
| `30.VoIP` | **PASS** | 5/5 | |
| `31.کاربران و نقش‌ها` | **PASS** | 5/5 | |
| `32.پروفایل و شخصی‌سازی کاربر` | **PASS** | 5/5 | |
| `33.راهنما / Help` | **PASS** | 2/2 | |
| `34.Workflow / فرآیند` | **PASS** | 4/4 | |
| `35.Import` | **PASS** | 3/3 | |
| `36.داشبوردهای کیفیت/انبار/آزمایشگاه/مالی` | **PASS** | 4/4 | |
| `37.خروجی‌های رسمی شرکت` | **PASS** | 4/4 | |
| `38.Security (regression)` | **PASS** | 7/7 | |

## پوشش معیارهای پذیرش (نمونهٔ چک‌های هر بخش)

| حوزه | چک‌های اعمال‌شده (از 154) |
|---|---|
| داده واقعی (بدون Mock) | همهٔ Create/Read روی DB واقعی؛ Dashboard/Reports/Commissions از همان DB خوانده شدند؛ VoIP فقط از CDR واقعی webhook |
| CRUD + Status | Create/Read/Update/Delete (یا تغییر وضعیت) برای customers/contacts/leads/opp/products/price-lists/quotes/orders/invoices/payments/complaints/tickets/warranties/contracts/campaigns/lab/wf-rules |
| ارتباط بین ماژول‌ها (دوطرفه) | Lead→Opportunity (Traceability) · Quote→Order→Invoice (سند مبدأ ردیابی‌شده) · Payment→Invoice (مانده) · Meeting→Calendar→Follow-up · Call(VoIP)→Customer Match→Follow-up · Idea→Task · Rule→Task/Follow-up |
| جستجو/فیلتر/صفحه‌بندی | q سروری (نام/تلفن/ایمیل) · f_customer_id · per_page/page · فیلترهای گزارش |
| تاریخ/ساعت شمسی | ذخیره ISO + نمایش Jalali (فرانت) · **Backend Validation: ورود دستی/متن نامعتبر → 422** (تست‌شده) · Date/Time Picker (بدون ورود دستی) · move رویداد در تقویم روی رکورد اصلی ذخیره می‌شود |
| Permission | rep روی admin-API → 403 · بدون توکن → 401 · workflow فقط admin · scope مشتری per-user · attachment بدون توکن 401 |
| Audit | contact_create/profile_update/competitor/idea/team_task/complaint در audit_logs ثبت شد (تست‌شده) |
| Export/Print | Excel/CSV (reports + definitions) · PDF/Print فاکتور/پیش‌فاکتور/قرارداد/آزمایش (200 + HTML + لوگوی BASPAR/SELEN + RTL) |
| Security regression | SQLi (q و مسیر id) · XSS · CSRF Origin → 403 · بدون Stack Trace · Secret نشت‌نکرده · Rate Limit فعال |

## قابلیت‌های ساخته‌شده/تکمیل‌شده در این مرحله (همه تست‌شده)

| قابلیت | پیاده‌سازی | تست |
|---|---|---|
| **مخاطبین — افزودن واقعی** | فرم کامل (نام/مشتری/سمت/موبایل/تلفن/ایمیل/آدرس/توضیحات/وضعیت/اصلی) + **Duplicate Detection (409)** + `GET /api/contacts` سراسری (search با نام/تلفن/ایمیل) + migration 013 (address/notes/status) | 8/8 |
| **Customer Selector** | کامپوننت `customer-select.js` (جستجوی نام/کد/تلفن، بدون پیش‌بارگذاری لیست کامل) در همهٔ فرم‌هایی که customer ref دارند (sales/pipeline/planning/followup…) | 5.Leads 5/5 · 10.Proforma 7/7 |
| **تاریخ/ساعت استاندارد** | کامپوننت `datepick.js`: **Jalali Date Picker + Time Picker، فیلد فقط‌خواندنی (ورود دستی غیرممکن)**؛ اتصال به resource-view (همهٔ فرم‌های عمومی) + فرم‌های planning (جلسه/پیگیری/تکرار)؛ **اعتبارسنجی Backend** در generic.js (ISO + شمسی، ردّ متن نامعتبر) | 6.Opp (تاریخ نامعتبر→422) · 23.Calendar 3/3 |
| **Pipeline — تاریخ‌ها** | هر کارت: تاریخ ایجاد، آخرین تغییر، **پیگیری بعدی (تاریخ+ساعت، هشدار عقب‌افتادگی)**؛ فیلد `next_followup_at` (migration 013) | 7.Pipeline 5/5 |
| **جلسات — کامل و واقعی** | افزودن/ویرایش جلسه (مشتری/مخاطب/مسئول/تاریخ شمسی/ساعت/محل/لینک آنلاین/توضیح/وضعیت) · نمایش در Calendar · **پیگیری بعدی جلسه** (ثبت followup با لینک به meeting) · Edit + Status | 22.جلسات 4/4 · 23.تقویم 3/3 |
| **قانون افزودن کار (Task Rules)** | رویداد جدید `opportunity_stage_changed` در موتور Workflow + شرط (مرحلهٔ هدف) + اقدامات (Task با مسئول/اولویت/سررسید + پیگیری) + UI (ایجاد/ویرایش قانون در Admin) · **اجرای واقعی**: تغییر Stage → Task + Follow-up ساخته شد | 34.Workflow 4/4 |
| **تیم هوشمند — Task** | مأموریت‌های تیم (مسئول/اولویت/سررسید/مشتری) + ماشین وضعیت (در انتظار→در حال انجام→انجام‌شده + مسدود/لغو + ردّ انتقال نامعتبر) | 29.Smart Team 13/13 |
| **تیم هوشمند — تحلیل رقبا** | جدول `competitors` + CRUD کامل (محصولات/سطح قیمت/نقاط قوت/ضعف/بازار هدف/بخش‌های هدف/مزیت ما/تهدیدها/فرصت‌ها) + UI در صفحهٔ تیم هوشمند | 29.Smart Team |
| **تیم هوشمند — خلق ایده** | جدول `ideas` + **تولید داده‌محور از CRM واقعی** (ریزش/فرصت‌های راکد/فروش محصولات/پیگیری‌های معوق — با ذکر رکوردهای واقعی، بدون اختراع داده) + ذخیره/تأیید/رد + **تبدیل ایدهٔ تأییدشده به Task** | 29.Smart Team |
| **ارتباط تیم هوشمند با CRM** | همهٔ منابع (customers/contacts/leads/opps/products/prices/quotes/orders/invoices/payments/meetings/followups/reports) با scope و permission فعلی | 28.AI 3/3 · 29.Smart Team |

## باگ‌های پیدا و رفع‌شده در همین مرحله (حین تست)

| # | باگ | رفع |
|---|---|---|
| B1 | **Backend date-validation ورودهای Picker (ISO …Z/…sssZ) را رد می‌کرد** (خروجی خودِ تاریخ‌گیر نامعتبر محسوب می‌شد) | `normalizeDateTimeInput` در generic.js: نرمال‌سازی ISO قبل از validate |
| B2 | **موتور Workflow: `entityId is not defined`** — اقدام‌های create_task/create_followup در رویداد stage-change اجرا نمی‌شدند (خطا در result) | پاس دادن `entityId` به `runAction` |
| B3 | **Duplicate Detection مخاطبین پیاده نشده بود** (POST قبلی) | افزودن کامل: تکرار موبایل/تلفن/ایمیل در مشتری یکسان → 409 + تأیید کاربر (`_force`) |
| B4 | Placeholder SQL در `competitors` INSERT (10 علامت برای 15 ستون) | ساخت پویای placeholders |
| B5 | رویداد `opportunity_stage_changed` در لیست رویدادهای مجاز نبود | افزودن به `workflowEvents` (options) |

## رگرسیون کامل (پس از همهٔ تغییرات — همگی سبز)

| مجموعه | نتیجه |
|---|---|
| final-check | 114/114 |
| customer-master-e2e | 49/49 |
| customer-master-test | 70/70 |
| sales-chain | 80/80 |
| calendar | 56/56 |
| import | 34/34 |
| scenarios | 41/41 |
| selector | 19/19 |
| voip-final-e2e | 65/65 |
| smartsales | 33/33 (+2 NOT-TESTED خارجی) |
| integration | 24/24 |
| **ui-test (رندر زنده)** | **66 روت · 133 فراخوانی API · 0 شکست · 0 خطای View** |
| **جمع رگرسیون** | **585/585 + 154/154 Acceptance + 66 UI = 0 شکست** |

## NOT TESTED (صادقانه — نیازمند محیط شرکت)
- PBX زنده (SIP/CDR واقعی) — لایهٔ CRM با webhook واقعی تست شد؛ فقط آدرس/کلید PBX واقعی مانده
- LLM آنلاین برای غنی‌سازی متن ایده‌ها — هستهٔ تولید ایده کاملاً آفلاین/داده‌محور است (بدون اختراع داده)
- پنتست شخص ثالث — توصیه می‌شود

## نتیجه نهایی این مرحله
**همهٔ 38 ماژول PASS (154/154) · رگرسیون 0 شکست · قابلیت‌های قبلی (Smart Team، Personalization، Calendar، Guide، VoIP، Master Customer Data، زنجیرهٔ فروش/مالی) حفظ و بازتست شدند · Security Hardening دست‌نخورده (38-1 Security regression 7/7).**
