# CRM BASELINE — قبل از توسعه «تیم هوشمند فروش»
**قانون شماره 2** · 1 مهر 1405 (2026-09-01)
مرجع اصلی برای جلوگیری از Duplicate Feature و Regression.

## 1) داشبوردهای موجود (public/js/views/dashboard.js)
| داشبورد | مسیر | KPIها (همه `statCardLink` = Drill-Down واقعی) |
|---|---|---|
| داشبورد اصلی (myDashboard) | `#/dashboard` | فروش امروز، فروش این ماه، مشتریان فعال، Pipeline، مطالبات باز، هشدارهای موجودی + **VoIP**: تماس‌های امروز/ورودی/خروجی/از‌دست‌رفته |
| داشبورد فروش (roleDashboard sales) | `#/dashboard/sales` | فروش سال، فروش این ماه، مطالبات باز، **مشتریان در معرض ریزش (AI)**، Pipeline، شکایات باز، جلسات/پیگیری‌ها/وظایف امروز، فعالیت‌های عقب‌افتاده + نمودار روند فروش (کلیک = لیست) |
| داشبوردهای نقش‌ها | ceo/quality/warehouse/lab/finance | KPIهای اختصاصی هر نقش (همه با Drill-Down) |
| صفحه KPI | `#/kpi` | KPIهای سفارشی |
| داشبورد VoIP | `#/calls` | KPI تماس‌ها (امروز/ورودی/خروجی/missed/مدت) — کلیک = فیلتر لیست تماس‌ها |

## 2) AI موجود (reuse — تکرار ممنوع)
| قابلیت | مسیر/API | موتور |
|---|---|---|
| دستیار گفتگویی (chat + RAG + KB) | `#/ai` · `POST /api/ai/chat` | provider آنلاین (Gemini/OpenAI-compatible) → fallback موتور محلی intent-based |
| Lead Scoring | `#/ai/leads` · `/api/ai/leads` | محلی (engine.scoreLead — تعامل/مراجعات/عمر) |
| Churn Prediction | `#/ai/churn` · `/api/ai/churn` | محلی (engine.churnScore: درactivity/پرداخت/شکایت) |
| Opportunity Scoring | `/api/ai/opportunities` | محلی |
| Forecast | `#/ai/forecast` · `/api/ai/forecast` | محلی (میانگین موفقیتماندگار + پایپلاین) |
| Anomaly Report / Executive Summary | `/api/ai/anomalies`, `/api/ai/summary` | محلی |
| Customer Insights | `/api/ai/customer/:id` | scope-aware |
| AI Analytics / Report Assistant | `/api/ai2/*` | gateway (online→local→builtin) |
| AI Gateway/Orchestrator | `server/core/ai-gateway.js` | online (Gemini/OpenAI/Claude/custom) → local (Ollama/LM-compatible) → builtin؛ لاگ `ai_logs` (provider/model/latency/source)؛ `POST /api/ai2/test` = پینگ واقعی |
| تنظیمات AI | `aigw.settings/saveSettings` | online/local enabled، provider، model، endpoint، timeout، temperature، module_flags |
| Motor Local Intelligence | `server/ai/engine.js` + `nlu.js` + `assistant.js` | sentiment/classifyComplaint/rootCause/scoreLead/churn/salesTotals/forecast/executiveSummary — **با scope کاربر (scopedInvoiceWhere)** |

## 3) ماژول‌ها (NAV — 13 گروه)
داشبورد · مشتریان (customers/contacts/leads/categories) · فروش (pipeline/opportunities/quotes/orders/invoices/payments/commissions) · انبار · آزمایشگاه · خدمات (complaints/tickets/warranties/contracts) · بازاریابی (campaigns/loyalty) · ارتباطات (messages/voip calls) · وظایف (calendar/tasks/followups/meetings) · گزارش‌ها (reports/report builder/advanced) · **هوش مصنوعی** (assistant/analytics/forecast/churn/leads/kb) · اسناد · مدیریت (users/roles/settings/audit/backup/workflows/**voip settings**)

## 4) جدول‌های DB (91 جدول) — مرتبط با ماژول جدید
- موجود و قابل reuse: `customers`, `leads`, `opportunities`, `invoice(s)_items`, `payments`, `followups`, `tasks`, `meetings`, `complaints`, `activities`, `ai_scores`, `ai_logs`, `ai_conversations`, `commission_rules`, `commissions`, `notifications`, `outbox`, `integrations` (خالی — settings در settings key)، `voip_calls`
- **جدید در این توسعه (فقط):** `sales_targets` (Migration 012)

## 5) Roles/Permissions (موجود — reuse)
15 کاربر، 12 نقش (super_admin/ceo/sales_manager/sales/rep/finance_manager/finance/production_manager/quality_manager/warehouse_manager/lab/marketing/support) · permissions بر پایه entity:action با scope (all/department/team/own)
- **جدید در این توسعه:** entity `smart_sales` (view/use/manage) — additive

## 6) Automation/Scheduler/Notifications (موجود)
- Workflow engine (wf_processes/wf_versions/wf_instances + triggers) · scheduler (task overdue، followups due→missed+notify، invoice overdue) · notification center (messenger hub + WebSocket + notifications table)

## 7) Integrationهای موجود (settings keys)
`voip` (مدیریت کامل + Test Connection واقعی + webhook secret) · `sms` · `email` · `whatsapp` · `telegram` · `payment_gateway` · `ai_settings` (gateway) — کارت «یکپارچه‌سازی‌ها» در Admin بدون نمایش وضعیت واقعی/تست واحد ← **گپ: Integration Center**

## 8) Drill-Down (موجود — الگوی استاندارد)
`statCardLink` (کارت‌های KPI → مسیر با فیلتر)، `lineChart` با `href` (نقطه = لیست)، لینک‌های گزارش به لیست/جزئیات رکورد → **الگوی موجود، reuse می‌شود**

## 9) Gap Analysis — چه چیزی واقعاً جدید است
| مورد | وضعیت قبلی | تصمیم |
|---|---|---|
| Sales Target Engine (شرکت/تیم/فروشنده × ماه/فصل/سال) | **نبود** | **جدید** (sales_targets + API + UI در صفحهٔ جدید) |
| Next Best Action (rules-based) | نبود | **جدید** (موتور قوانین روی دادهٔ واقعی) |
| Smart Follow-up Queue (پیشنهاد زمان + ساخت Task + نوتیفیکیشن) | فقط auto-missed در scheduler | **توسعه** (صف هوشمند + اکشن) |
| Stalled Opportunities | نبود | **جدید** (query واقعی) |
| High Priority / At-Risk / Lead Scoring | **بود** (AI module) | **REUSE** (فقط نمایش در بخش هوشمند — بدون موتور دوم) |
| AI Mode (Auto/Online/Offline/Hybrid) + Privacy | نبود (فقط online/local enabled) | **جدید** (settings + enforcement در orchestrator) |
| AI Orchestrator Status API (وضعیت واقعی 3 سطح) | جزئی (ai2/test) | **توسعه** (`/api/ai/status`) |
| بخش «AI Sales Intelligence» در داشبورد فروش موجود | نبود | **افزودن section** به همان داشبورد (نه داشبورد دوم) |
| صفحهٔ مستقل «تیم هوشمند فروش» | نبود | **جدید** با هدف متفاوت (NBA + Smart Follow-up + Targets + Assistant) — بدون KPI تکراری داشبورد فروش |
| Integration Center (وضعیت واقعی + تست واحد) | کارت تنظیمات بدون وضعیت | **توسعه** (reuse تنظیمات موجود + test واقعی) |
| Webhook Security (timestamp/replay) | فقط secret | **توسعه** (additive، سازگار رو به عقب) |
| Customer 360 (score/NBA/AI) | تب AI موجود | **توسعه** (NBA + score در تب موجود) |
| Forecast/Churn/Scoring Engines | بود | **REUSE** |
