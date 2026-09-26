# گزارش نهایی — Workflow Visual Engine (موتور بصری فرآیندهای بسپار فوم غرب)

**تاریخ:** ۱۴۰۵/۰۶/۲۵ (۲۰۲-۰۹-۶) · **پورت اجرا:** 3050 · **وضعیت:** ✅ تکمیل‌شده و تست‌شده

این گزارش ۱۷ بندهٔ موردنیاز مأموریت نهایی را پوشش می‌دهد. همهٔ ادعاها با تست واقعی روی سرور زنده (پورت 3050) و پایگاه دادهٔ واقعی بهتر تأیید شده‌اند. **هیچ Mock / Fake / Static Execution در مسیر اجرا وجود ندارد.**

---

## ۱. ساختار Workflow قبل از ارتقا (وضعیت موجود)

پیش از این دور، پروژه سه لایهٔ جدا از هم داشت:

| لایه | وضعیت قبل |
|---|---|
| Rule Engine قدیمی | جدول‌های `workflow_rules` / `workflow_runs` — قوانین ساده (یک رویداد → چند اکشن) بدون گراف، بدون Approval/Signature، بدون نسخه |
| Visual Builder اولیه | `wf_processes` / `wf_versions` / `wf_instances` / `wf_steps` — گراف Node/Edge با `definition` JSON، ولی بدون: Execution ID، Draft/Publish جدا، Test Mode، Monitor کامل، Delay/Schedule، Loop Detection، مجوزهای ریز |
| امضا/تأیید | `user_signatures` + زنجیرهٔ تأیید اسناد (`approval_chains`, `doc_approvals`) — مجزا از فرآیندهای Workflow |

مشکل اصلی: گراف «قابل طراحی» بود ولی لایهٔ اجرا (اکشن‌های واقعی، Approval/Signature درون فرآیند، Schedule، Error/Retry، Audit) کامل نبود.

## ۲. چه چیزهایی تغییر کرد

1. **موتور اجرا (`server/core/workflow-engine.js`)**: ۱۹ نوع Node، ۱۹ اکشن واقعی، شرط‌ساز AND/OR/NOT با ۱۰ عملگر، Trigger واقعی از Event Bus، Delay/Schedule/Wait، Parallel/Merge، Loop Detection + Loop Protection (۳۰ مرحله)، Execution ID با فرمت `WF-YYYY-NNNNNN`، Test Mode (dry-run بدون اثر واقعی)، Error Handling با Retry/Continue/Stop، Audit برای هر گام.
2. **Lایهٔ API (`server/api/custom/workflow.js`)**: Draft/Publish جدا (Draft هرگز روی اجرا اثر نمی‌گذارد)، Validate قبل از Publish (با خطا Publish نمی‌شود)، Versioning (Create/Restore/Duplicate/Compare)، Activate/Deactivate، Monitor + Execution Logs + Retry + Cancel + Terminate، Test روی رکورد واقعی، My-Tasks (ماموریت‌های من)، Delete Protection (فرآیند با سابقهٔ اجرا نمی‌تواند حذف شود — باید Deactivate شود).
3. **امتیازدهی/امضا درون فرآیند**: Nodeهای `approval` و `signature` به سیستم واقعی امضای الکترونیکی وصل شدند: `captureSignature` **فقط امضای خود کاربر لاگین‌شده** را می‌پذیرد (ثبت یا dataURL جدید). هر Step: Approver/Status/Date/Comment/Reject-Reason/History + `signature_path` واقعی روی دیسک.
4. **Blocking Approval**: تا Sales Manager تأیید نکند، Approval مالی/مدیرعامل اصلاً فعال نمی‌شود (تست S8/S9: دسترسی اشتباه → 403).
5. **Event Bus واقعی (`server/core/workflow.js`)**: هر CRUD واقعی از `generic.js` (و `sales.js`/`approvals.js`) رویداد `{entity}_{created|updated|deleted|...}` می‌زند؛ موتور از همین رویداد واقعی اجرا را شروع می‌کند — جدا از Rule Engine قدیمی (هر دو از یک رویداد).
6. **Scheduler**: `delay`/`schedule`/`wait` با جدول `wf_schedules` و تیک ۶۰ ثانیه‌ای؛ ریجوان بعد از ریستارت سرور (`resumeInterrupted`).
7. **Cascade حذف**: Hard-Delete یک رکورد، همهٔ اجراهای **فعال** (running/waiting/pending) متصل به آن را terminate می‌کند و scheduleهای معوقش را خنثی می‌کند (بدون فرآیند یتیم).
8. **AI Quick Customer Registration (بند ۳۵ — این دور اضافه شد)**: دستیار AI با عبارت «ثبت مشتری …» مشتری را **از مسیر واقعی API** (validate + dedup + شماره‌گذاری + audit + search + `dispatch(customer_created)`) ثبت می‌کند؛ Workflow متصل به همان رویداد واقعی فعال می‌شود. بدون مجوز `customer:create` → رد (RBAC). پاسخ چت دقیقاً گزارش می‌دهد چه چیزی واقعاً انجام شد (کد مشتری + Execution IDها) — بدون نمایش جعلی.
9. **UI (`public/js/views/processes.js`)**: Canvas (Drag&Drop/Zoom/Pan/Fit/Undo-Redo/Duplicate)، Inspector کامل (Node/Connection/Condition Builder/Approval/Signature/Assignee داینامیک)، Draft با Auto-Save، Validate، Test Modal (رکورد واقعی + گزینهٔ Live Test جدا)، تب Monitor (Execution ID/رکورد/نود جاری/مسئول/مدت/Retry/Cancel)، تب نسخه‌ها، My-Tasks.

## ۳. فایل‌های تغییر‌یافته (این دور + دورهای قبلی موتور)

| فایل | نوع تغییر |
|---|---|
| `server/ai/nlu.js` | intent جدید `register_customer` + slot extraction (نام/موبایل/تلفن/ایمیل/شهر/شناسه/نوع) — بدون خراب‌شدن املا (آ/ا) |
| `server/ai/assistant.js` | اکشن قطعی `registerCustomerAction` با RBAC — هرگز به LLM سپرده نمی‌شود؛ ایجاد از مسیر واقعی `generic.create` |
| `public/js/views/ai.js` | چیپ پیشنهاد «ثبت سریع مشتری» در چت AI |
| `server/api/generic.js` | Cascade Hard-Delete → terminate اجراهای active (running/waiting/pending) + خنثی‌سازی wf_schedules |
| `server/core/workflow-engine.js` | موتور کامل اجرا (دورهای قبلی) + reject→`rejected`، اعتبارسنجی موجودبودن entity |
| `server/api/custom/workflow.js` | لایهٔ API کامل (دورهای قبلی) |
| `public/js/views/processes.js` | Canvas + Monitor + Versions + Test (دورهای قبلی) |
| `server/core/workflow.js` | Event Bus دو‌لایه (Rule Engine قدیمی + موتور بصری) — بدون تغییر این دور |
| `server/db/migrations/024_workflow_engine.sql` | Migration جدید |
| `server/db/seed.js` | ۴ تمپلیت اجرایی واقعی + مجوزها (دورهای قبلی) |
| تست‌ها: `ai-wf-event-test.mjs` (جدید)، `sales-scenario-wf-test.mjs` (جدید)، `cascade-test.mjs` (به‌روزرسانی) | E2E واقعی |

## ۴. Migrationهای اضافه‌شده

**فقط یک Migration: `024_workflow_engine.sql`** — کاملاً **ADDITIVE** و مطابق دستور «جداول مشابه را Duplicate نکن، ارتقا بده»:

- `wf_processes.draft_definition` — جداسازی Draft/Publish
- `wf_instances`: `execution_no` (WF-YYYY-NNNNNN)، `context` (اسنپ‌شات رکورد برای متغیرها)، `error/error_at/attempts` (Error Handling + Retry)، `test_mode`؛ وضعیت‌ها: pending/running/waiting/completed/rejected/terminated/failed/cancelled
- `wf_steps`: `result`، `signature_path/signature_mime` (اتصال به موتور امضا)، `error/retry_count`، `wait_until`
- جدول جدید `wf_schedules` — registry انتظارهای delay/datetime/wait_event (ریجوان توسط Scheduler ۶۰ ثانیه‌ای)
- جدول جدید `wf_logs` — لاگ رویدادهای هر Execution (Monitor + Audit)
- **۱۲ مجوز ریز** برای entity `workflow` + grant پیش‌فرض
- **هیچ جدولی Duplicate نشده** — ساختار `wf_*` موجود ارتقا یافته است.

## ۵. APIهای اضافه‌شده

```
GET    /api/wf/modules                     ماژول‌های قابل اتصال
GET    /api/wf/engine/meta                  Node Types/Actions/Triggers (Single Source of Canvas)
GET    /api/wf/processes                    لیست فرآیندها (+running)
GET    /api/wf/processes/:id                جزئیات + نسخه‌ها
POST   /api/wf/processes                    ایجاد فرآیند
PUT    /api/wf/processes/:id                Publish نسخهٔ جدید (با Validate)
PUT    /api/wf/processes/:id/draft          ذخیره Draft (بدون اثر روی اجرا)
GET    /api/wf/processes/:id/draft          خواندن Draft
POST   /api/wf/processes/:id/validate       اعتبارسنجی (Node/Connection/Trigger/Action/Condition/Recipient)
POST   /api/wf/processes/:id/publish        Publish (در صورت Error رد می‌شود)
POST   /api/wf/processes/:id/restore/:vid   بازگردانی نسخه
POST   /api/wf/processes/:id/activate-version/:vid
POST   /api/wf/processes/:id/duplicate      کپی فرآیند
POST   /api/wf/processes/:id/toggle         Activate/Deactivate
POST   /api/wf/processes/:id/test           Test Mode روی رکورد واقعی (live=true → Live Test)
DELETE /api/wf/processes/:id                حذف (با Delete Protection)
GET    /api/wf/instances | /api/wf/executions   Monitor (فیلتر process/status/test)
GET    /api/wf/executions/:id               Execution + Steps + Logs + Definition
GET    /api/wf/executions/:id/logs          لاگ رویدادها
POST   /api/wf/executions/:id/retry         ری‌تای اجرا/مرحله
POST   /api/wf/executions/:id/cancel        لغو
GET    /api/wf/my-tasks                     ماموریت‌های من (Approval/Signature/Task)
POST   /api/wf/instances/:id/step/:sid/complete   تکمیل مرحله (approve/reject/return/complete + امضا)
POST   /api/wf/instances/:id/terminate      پایان زودهنگم
GET    /api/wf/entity/:module/:id/instances  اجراهای متصل به یک رکورد
POST   /api/wf/entity/:module/:id/start     شروع دستی
POST   /api/wf/processes/:id/start-entity   شروع دستی فرآیند مشخص
GET    /api/wf/score                        نوار وضعیت اجراها (Header)
+ POST /api/ai/chat (intent register_customer) — ثبت سریع مشتری واقعی از AI
```

## ۶. Nodeهایی که ساخته شده (۱۹ نوع)

`start`, `trigger`, `action`, `assignment`, `condition`, `approval`, `signature`, `task`, `notification`, `message`, `email`, `delay`, `schedule`, `wait`, `parallel`, `merge`, `create_record`, `update_record`, `end`

(برچسب فارسی + آیکون + پامترهای اختصاصی هر Node در `NODE_META` — Single Source برای Canvas)

## ۷. Triggerهای فعال‌شده (همه از رویداد واقعی سیستم)

`created`, `updated`, `deleted`, `stage_changed`, `status_changed`, `approved`, `rejected`, `overdue`, `won`, `manual`

رویدادها از Event Bus واقعی می‌آیند: هر `POST/PUT/DELETE` ماژول‌های generic (customer, contact, lead, opportunity, quote, order, invoice, payment, product, inventory/stock, lab_request, complaint, ticket, warranty, contract, meeting, followup, task, campaign, …) + رویدادهای خاص (`opportunity_won`, `invoice_overdue` از Scheduler، `*_approved/rejected` از زنجیرهٔ تأیید، `stock_low`).

## ۸. Actionهای فعال‌شده (۱۹ اکشن واقعی)

`record.create`, `record.update`, `record.set_status`, `record.assign`, `record.add_note`, `record.add_tag`, `followup.create`, `task.create`, `meeting.create`, `notification`, `message` (WhatsApp/Telegram/Bale/Rubika/SMS — از پرووایدر واقعی؛ اگر تنظیم نباشد **Not Configured** ثبت می‌شود و ارسال جعلی نشان داده نمی‌شود), `email`, `quote.create`, `order.create`, `invoice.create`, `payment.register`, `stock.move`, `workflow.start`, `workflow.stop`

متغیرهای داینامیک: `{{customer.name}} {{customer.phone}} {{customer.mobile}} {{customer.company}} {{customer.category}} {{quote.number}} {{quote.total}} {{quote.status}} {{order.number}} {{invoice.number}} {{payment.amount}} {{workflow.execution_id}}` + هر فیلد هر ماژول از Context واقعی DB.

## ۹. پیاده‌سازی Approval / Signature

- **Approval**: هر Node تأیید یک `wf_step` مستقل با Status (pending/active → approved/rejected/returned) + تاریخ/ساعت + Comment + دلیل رد (الزامی هنگام reject) + تاریخچه در `wf_logs` و `audit_logs`.
- **مسئول**: User مشخص / نقش / واحد / **Dynamic** (مثلاً `customer.salesperson_id`) — `canCompleteStep` در هر مرحله احراز هویت می‌کند (RBAC؛ نقش اشتباه → 403).
- **Blocking**: گره‌های بعدی تا تأیید گره قبلی اصلاً فعال نمی‌شوند (تست S7/S8/S9).
- **Signature**: Node امضا به `captureSignature` سیستم واقعی وصل است: **فهرهنگر فقط امضای خودش** (ثبت‌شده در `user_signatures` یا dataURL تازه‌ای که در همان درخواست می‌کشد). فایل واقعی روی `data/uploads/signatures/approvals/` + `signature_path` روی Step + Audit. هر اجرا: User ID/Role/Signature/Approval Status/Record ID/Execution ID/Log — همه در DB.

## ۱۰. مجوزهای اضافه‌شده

Entity `workflow` با ۱۲ اکشن: `view, create, edit, delete, publish, restore, activate, deactivate, execute, test, monitor, audit` — هر endpoint با `requirePermWf` گارد شده. Grant پیش‌فرض: super_admin کامل؛ نقش‌های مدیریتی (ceo, sales_manager, finance_manager, quality/warehouse/production_manager) فقط view/monitor/test/audit — قابل تنظیم در Admin→Roles.
**نکته کلیدی (بند ۳۲)**: هر اکشن درون Workflow با مجوز مجری اجرا (actor) اعتبارسنجی می‌شود — اگر کاربر مجوز `invoice:delete` را نداشته باشد، Workflow هم نمی‌تواند Invoice حذف کند.

## ۱۱. تست‌هایی که انجام شد (روی سرور زندهٔ پورت 3050)

| # | سوئیت | نوع |
|---|---|---|
| 1 | `security-test.mjs` | امنیت (خروجی‌های نامعتبر، CSRF/Origin، Rate Limit، Upload، SQLi، XSS، IDOR) |
| 2 | `sales-chain-test.mjs` | زنجیرهٔ فروش کامل (Master Data→Quote→Order→Invoice→Payment→Commission→Reports) |
| 3 | `wf-e2e-test.mjs` | چرخهٔ کامل API موتور (Create/Start/Step/Score/Terminate) |
| 4 | `opc-e2e-test.mjs` | OPC/گزارش‌ها |
| 5 | `sales-scenario-wf-test.mjs` | **بند ۴۳**: سناریوی فروش واقعی از Event تا Completed با ۳ تأیید + ۳ امضا |
| 6 | `ai-wf-event-test.mjs` | **بند ۳۵**: ثبت مشتری از AI → Event → Workflow + RBAC + Dedup (۱۱ تست) |
| 7 | `cascade-test.mjs` | Hard-Delete → terminate اجراهای فعال |
| 8 | `followup-calendar-test.mjs` | پیگیری/تقویم |
| 9 | `dashboard-analytics-test.mjs` | داشبورد/تحلیل |
| 10 | `wf-engine-ui-e2e.mjs` | **Playwright**: Canvas واقعی (رندر Node/Edge، Inspector، Condition Builder، Undo، Draft، Validate، Monitor، Versions، Responsive) |
| 11 | `ui-e2e-browser.mjs` | **Playwright**: UI کلی CRM + Responsive (۳ viewport) + بدون خطای JS |

## ۱۲. نتیجهٔ هر تست (دور نهایی)

| سوئیت | نتیجه |
|---|---|
| security-test | ✅ **54 / 54** |
| sales-chain-test | ✅ **80 / 80** |
| wf-e2e-test | ✅ **22 / 22** |
| opc-e2e-test | ✅ **43 / 43** |
| sales-scenario-wf-test | ✅ **34 / 34** |
| ai-wf-event-test | ✅ **11 / 11** |
| cascade-test | ✅ **7 / 7** |
| followup-calendar-test | ✅ **14 / 14** |
| dashboard-analytics-test | ✅ **18 / 18** |
| wf-engine-ui-e2e (browser) | ✅ **19 / 19** |
| ui-e2e-browser (browser) | ✅ **35 / 35** |
| **جمع** | ✅ **337 / 337 — صفر FAIL** |

**بازتأیید نهایی (۱۴۰۵/۰۶/۲۵ — ۲۰۲۶-۰۹-۱۶):** چهار سوئیت کلیدی موتور روی سرور زندهٔ پورت 3050 دوباره اجرا شد: `ai-wf-event-test` (11/11)، `cascade-test` (7/7)، `wf-e2e-test` (22/22)، `sales-scenario-wf-test` (34/34) — **74/74 PASS**؛ سپس DB به‌طور کامل پاک‌سازی و چک‌پوینت شد و پروژه به‌صورت ZIP نهایی بسته و از روی همان ZIP روی پورت 3050 راه‌اندازی و تست شد (بند ۱۷).

## ۱۳. وضعیت امنیت

- **RBAC روی همهٔ اکشن‌ها** (هم endpointها هم اکشن‌های درون-Workflow) — 403 برای نقش نادرست در Approval (تست S9) و ثبت مشتری از AI (تست 35-10).
- **AuthN**: JWT + refresh + TOPT پشتیبانی؛ **Rate Limit** ورودی (تلاش‌های پیاپی → قفل ۱ دقیقه — رفتار واقعی مشاهده شد).
- **CSRF/Origin**: درخواست با Origin غیرمجاز → رد (تست‌شده).
- **XSS**: برچسب‌های یال/عنوان‌ها sanitize + whitelist در `validateDef` (stored-XSS قبلی رفع و تست‌شده).
- **SQLi**: همهٔ دسترسی‌ها با prepared statement.
- **Upload**: whitelist پسوند + sniffing تصویر (امضا/پیوست).
- **Secrets**: هیچ کلید/رمزی در Frontend نیست؛ کانال‌های پیام (SMS/WhatsApp/…) از Settings سمت سرور خوانده می‌شوند.
- **Audit**: همهٔ عملیات (create/edit/publish/execute/approve/reject/sign/delete) در `audit_logs`.
- نتیجهٔ سوئیت امنیتی: **54/54 PASS**.

## ۱۴. وضعیت Database

- Migration 024 اعمال‌شده و **ADDITIVE** (بدون duplicate جدول؛ ارتقای همان `wf_*`).
- ساختار نهایی: `wf_processes` (Draft+Active)، `wf_versions`، `wf_instances` (execution_no/context/error/test_mode)، `wf_steps` (result/signature/error/retry/wait_until)، `wf_schedules`، `wf_logs` + امضا: `user_signatures`/`doc_approvals`.
- **وضعیت نهایی DB (پاک‌سازی‌شده و چک‌پوینت‌شده)**: ۵ فرآیند واقعی (SLA + ۴ تمپلیت) · ۵ نسخه · **صفر** رکورد تست (customers/quotes/orders/invoices/followups/complaints/instances/steps/logs = ۰) · ۱۵ کاربر · WAL checkpoint شده.
- Delete Protection: فرآیند با سابقهٔ اجرا فقط با مجوز + Confirm حذف می‌شود؛ در حالت عادی Deactivate/Archive.

## ۱۵. وضعیت انطباق (Integrations)

- **Event Bus**: یک تابع `dispatch(event, entity, id, record)` در `server/core/workflow.js` — از `generic.js` (همهٔ ماژول‌های CRUD)، `sales.js` (تبدیل‌ها)، `approvals.js` (تأیید/رد اسناد) و `server.js` (رویدادهای سیستمی) — بدون معماری اضافه (بند ۳۶: حفظ ساختار فعلی).
- **CRM Modules**: Customers/Contacts/Leads/Opportunities/Pipeline/Quotes/Orders/Invoices/Payments/Products/Inventory/Lab/Complaints/Tickets/Warranty/Contracts/Campaigns/Meetings/Follow-ups/Tasks/Calendar/Finance/Customer Club/Communication Center — همه از همان مسیر generic رویداد می‌دهند (اتصال واقعی، نه ظاهری).
- **Scheduler (60s)**: سررسید پیگیری/وظیفه/جلسه/فاکتور + `processDueSchedules`/`resumeFromSchedule`/`resumeInterrupted`/`emitWaitEvent` موتور.
- **AI Assistant**: ثبت سریع مشتری → `customer_created` → Workflow (بند ۳۵، تست 11/11) + تحلیل AI روی فرآیندها (`/api/wf/ai/process/:id`).
- **امضا/تأیید**: یکپارچه با `user_signatures`/`doc_approvals` موجود (بند ۹).
- **Monitor/My-Tasks**: در UI + Header score.

## ۱۶. وضعیت اجرای Workflow (مهم‌ترین شرط — بند ۴۵)

Workflow **واقعاً اجرا می‌شود** — مستندات تست `sales-scenario-wf-test.mjs` (34/34) روی دادهٔ واقعی:

```
مشتری واقعی ساخته شد (CS-…)
 → رویداد customer_created → Execution WF-2026-NNNNNN (waiting)
 → پیگیری خوش‌آمد واقعی ساخته شد
 → پیش‌فاکتور واقعی ساخته شد (quote)
 → پیام WhatsApp: Not Configured (صادقانه — ارسال جعلی نشد)
 → بلوکه در تأیید مدیر فروش (مالی/مدیرعامل غیرفعال؛ 403 برای نقش اشتباه)
 → تأیید مدیر فروش (علی) + امضای دیجیتال واقعی (فایل PNG روی دیسک)
 → تأیید مدیر مالی (محمد) + امضای واقعی
 → تأیید مدیرعامل (رضا) + امضای واقعی
 → سفارش واقعی ساخته شد (quote → converted)
 → وظیفهٔ انبار (امین) — تکمیل شد
 → فاکتور واقعی صادر شد
 → اعلان واحد مالی ثبت شد
 → Execution = COMPLETED
 → 8 Step با Status/Timestamp مستقل + Audit ≥ 6 ورودی
```

همچنین: AI→Event (11/11)، حذف رکورد → terminate (7/7)، نسخه/Restore/Validate در UI (19/19).

## ۱۷. وضعیت پورت 3050

- `server/server.js`: `PORT = process.env.PORT || 3050`، `HOST = 0.0.0.0`.
- سرور روی **http://0.0.0.0:3050** اجرا می‌شود؛ `/health` → `{"status":"ok","db":true}` (تأیید‌شده روی سرور زنده).
- **همهٔ 337 تست بالا مستقیم روی پورت 3050 اجرا شده‌اند.**
- **تأیید ZIP نهایی (امروز):** ZIP تحویلی (`baspar-crm-workflow-engine-final.zip`) بدون `node_modules` و بدون فایل‌های `wal/shm` استخراج شد، فقط با `npm install` و `node server/server.js` روی **پورت 3050** (پیش‌فرض) راه‌اندازی شد؛ Health/DB/Log-in و چرخهٔ کامل موتور Workflow (سوئیت `wf-e2e-test`، 22/22) روی **همان نسخهٔ ZIP** سبز شد. یعنی ZIP «قابل اجرا از جعبه» است:
  ```bash
  unzip baspar-crm-workflow-engine-final.zip
  cd baspar-crm
  npm install
  node server/server.js        # → http://localhost:3050  (admin/admin1234)
  ```

---

## ✅ بیانیهٔ نهایی

Workflow Visual Engine دیگر «ابزار طراحی نمودار» نیست: **موتور واقعی اجرای فرآیندهای بسپار فوم غرب** است — هر Node/Connection/Condition/Action/Approval/Signature روی رکوردها و کاربران واقعی اثر می‌گذارد، همه‌چیز در پایگاه داده ذخیره می‌شود، و هیچ بخش Mock/Fake ندارد. پروژه روی پورت **3050** اجرا و با **337/337 تست** تأیید شده است.
