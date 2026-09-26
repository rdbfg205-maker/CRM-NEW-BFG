# CRM هوشمند بسپار فوم غرب — BASPAR FOAM SMART CRM

نرم‌افزار یکپارچه مدیریت روابط با مشتریان + هوش مصنوعی برای شرکت دانش‌بنیان **بسپار فوم غرب**.
این سیستم کل چرخهٔ «اولین ارتباط با مشتری → سرنخ → فرصت فروش → پیش‌فاکتور → سفارش → فاکتور → پرداخت → ارسال → آزمایشگاه → پشتیبانی → شکایت → رضایت → فروش تکراری» را در یک پلتفرم واحد مدیریت می‌کند.

---

## ویژگی‌های اصلی

| دسته | امکانات |
|---|---|
| **مشتریان** | Customer 360 (اطلاعات، مخاطبین، خریدها، مطالبات، شکایات، Timeline)، دسته‌بندی، سقف اعتبار، CLV، ریسک ریزش AI، جستجو و تشخیص تکراری |
| **فروش** | سرنخ‌ها با Lead Score (AI)، Pipeline بصری Drag&Drop، فرصت‌های فروش، پیش‌فاکتور → سفارش → فاکتور، پرداخت‌ها، پورسانت فروش با قوانین قابل تنظیم |
| **انبار** | مواد اولیه/محصول نهایی، ورود/خروج/انتقال/اصلاح، حد سفارش مجدد با **هشدار خودکار**، گردش موجودی |
| **تأمین** | تأمین‌کنندگان، سفارش خرید، امتیازدهی کیفیت/تحویل/قیمت |
| **آزمایشگاه** | درخواست آزمایش، نتایج آزمون (Pass/Fail)، صدور **گزارش آزمایشگاهی PDF** |
| **خدمات** | شکایات با **SLA و Escalation خودکار**، طبقه‌بندی AI، Sentiment، علت ریشه‌ای، CSAT، تیکت، گارانتی، قرارداد |
| **بازاریابی** | کمپین SMS/ایمیل/واتساپ با مخاطب‌یابی، باشگاه مشتریان (امتیاز/سطح/تخفیف) |
| **ارتباطات** | پیام‌رسان داخلی (مستقیم/گروه/کانال، فایل، اشاره @)، تماس صوتی/تصویری WebRTC، جلسات، صندوق ارسال |
| **هوش مصنوعی** | دستیار فارسی‌زبان (پاسخ از دادهٔ واقعی DB)، تحلیل هوشمند شکایات، پیش‌بینی فروش، ریسک ریزش، Lead Scoring، تشخیص رفتار غیرعادی، پیشنهاد اقدام، **RAG روی پایگاه دانش شرکت** |
| **گزارش‌ها** | سازندهٔ گزارش (منبع/ستون/فیلتر/گروه‌بندی) با خروجی **Excel/CSV**، گزارش خودکار روز/هفته/ماه با تحلیل AI |
| **مدیریت** | کاربران، نقش‌ها و دسترسی‌ها (RBAC + Scope: خودم/تیم/واحد/همه)، 2FA، Audit Log، Workflow ها، تنظیمات، یکپارچه‌سازی‌ها، بکاپ/ریستور |
| **فرهنگ** | کاملاً RTL فارسی + انگلیسی، تاریخ **شمسی** (با میلادی)، اعداد فارسی/انگلیسی، ریال/تومان، فونت وزیرمتن |
| **پایه‌فنی** | PWA (قابل نصب)، آفلاین محدود + همگام‌سازی خودکار، جستجوی سراسری، Command Palette (Ctrl+K)، چاپ PDF پیش‌فاکتور/فاکتور/گزارش با لوگو |

## معماری

```
browser (SPA — ES Modules، بدون build step)
   │  REST JSON  +  WebSocket
   ▼
Node.js 20+ (HTTP سرور + WS + Scheduler + AI Engine)
   │
   ▼
SQLite (better-sqlite3) — Relational، WAL mode
   • ~75 جدول (users, customers, leads, opportunities, quotes, orders,
     invoices, payments, products, stock_transactions, lab_requests/results,
     complaints, tickets, campaigns, conversations, tasks, notifications,
     documents, ai_*, approvals, workflow_*, audit_logs, backups, …)
   • FTS5 برای جستجوی سراسری
   • داده در data/baspar-crm.sqlite ، بکاپ‌ها در data/backups
```

- **بدون نیاز به PostgreSQL** برای راه‌اندازی سریع؛ لایهٔ داده مودولار است و قابل جابجایی است.
- **AI Provider-Based**: موتور محلی (بدون نیاز به کلید) + قابلیت اتصال Gemini / OpenAI / Claude / API سفارشی از پنل مدیریت. کلیدها AES-256-GCM رمزنگاری‌شده در سرور نگهداری می‌شوند.
- **امنیت**: هش scrypt، JWT + Refresh Token (چرخشی)، 2FA TOTP، RBAC در سطح رکورد، Rate Limiting، Prepared Statements، CSRF cookie، CSP، رمزنگاری Secrets.

## نصب و اجرا (سریع)

### پیش‌نیاز
- **Node.js 20 یا بالاتر** (فقط پیش‌نیاز؛ کاربر نهایی Node لازم ندارد)

### روش ۱ — اجرای مستقیم
```bash
cd baspar-crm
npm install          # یک‌بار
npm start            # یا: node server/server.js
```
سپس مرورگر: **http://localhost:3000**

**ورود اولیه:** `admin` / `admin1234` — در اولین ورود رمز را تغییر دهید (تنظیمات کاربر ← تغییر رمز).

> در اجرای اول، داده‌های نمونه (۳۴ مشتری، ~۲۵۰ فاکتور ۲۰ ماهه، سرنخ، سفارش، شکایت، آزمایش و…) به‌صورت Seed در دیتابیس ثبت می‌شوند و از پنل **مدیریت ← تنظیمات ← حذف داده‌های نمونه** قابل حذف کامل هستند. برای شروع بدون دادهٔ نمونه: `SEED_DEMO=0 npm start`.

### روش ۲ — Docker
```bash
docker build -t baspar-crm .
docker run -d -p 3000:3000 -v baspar-data:/app/data --name baspar-crm baspar-crm
```

### روش ۳ — نسخه دسکتاپ ویندوز (Setup.exe)
پوشهٔ `electron/` شامل پکیج دسکتاپ است (برنامهٔ Windows + Desktop Shortcut + اجرای بدون ترمینال):
```bash
cd electron
npm install
npm run dist     # خروجی: dist/BasparFoamCRM-Setup-x.x.x.exe
```
برنامهٔ دسکتاپ همان سرور و دیتابیس را به‌صورت یکپارچه اجرا می‌کند (Local Server Mode).

> **جایگزین سریع بدون کامپایل:** نسخهٔ وب را باز کنید → منو ← «Install App / نصب برنامه» (PWA). روی ویندوز از Chrome/Edge: سه‌نقطه ← Install Baspar CRM → آیکون دسکتاپ + پنجرهٔ مستقل.

### متغیرهای محیطی (`.env.example` نمونه است)
| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` | 3000 | پورت HTTP |
| `DATA_DIR` | `./data` | محل دیتابیس/بکاپ/فایل‌ها |
| `DB_PATH` | `DATA_DIR/baspar-crm.sqlite` | مسیر دیتابیس |
| `SEED_DEMO` | 1 | ۱ = Seed دادهٔ نمونه در اولین اجرا |
| `JWT_SECRET` | خودکار ساخته می‌شود | برای چند سرور، مقدار ثابت بگذارید |

## تنظیمات یکپارچه‌سازی (Admin ← تنظیمات)
- **پنل پیامکی / ایمیل / واتساپ / تلگرام**: baseUrl + API Key → ارسال کمپین و اعلان‌ها واقعی می‌شود. وب‌هوک دریافتی: `POST /api/webhook/:provider` (برای وضعیت delivered/opened).
- **درگاه پرداخت، نرم‌افزار حسابداری، سامانه مودیان مالیاتی**: فیلدهای اتصال موجود است؛ ساختار ارسال/دریافت در Lایهٔ Integration پیاده است.
- **AI**: انتخاب Provider (Gemini/OpenAI/Claude/Custom) + مدل + کلید → دستیار و تحلیل‌ها از طریق LLM واقعی انجام می‌شود؛ بدون کلید، موتور محلی AI کار می‌کند.

## ساختار دیتابیس و Seed
- `server/db/migrations/001_init.sql` — کل Schema (اجرا خودکار هنگام استارت).
- `server/db/seed.js` — Seed نقش‌ها/دسترسی‌ها/اطلاعات مرجع + دادهٔ نمونه (کامل‌نمای Entityها: users, customers, contacts, leads, opportunities, pipelines, products, price_lists, quotes, orders, invoices, payments, suppliers, purchase_orders, stock_transactions, lab_requests/results, complaints, tickets, warranties, contracts, campaigns, loyalty, conversations, messages, meetings, tasks, followups, notifications, documents, ai_*, reports, integrations, outbox, approvals, workflows, backups, audit_logs).

## تست‌های سناریویی (اجرا شده)
1. مشتری → سرنخ → Opportunity → پیش‌فاکتور → سفارش → فاکتور → پرداخت → امتیاز باشگاه ✔
2. شکایت → SLA → Escalation خودکار → حل → CSAT ✔
3. خرید → تحلیل AI → Churn Score با دلایل فارسی ✔
4. موجودی → کاهش → Reorder Point → هشدار خودکار به انبار ✔
5. سرنخ → Lead Score AI → پیگیری ✔
6. ورود مدیرعامل → داشبورد اجرایی + خلاصهٔ مدیریتی AI ✔

## مستندات API
`GET /api/docs` — فهرست کامل APIها. همهٔ ماژول‌ها از مسیر یکپارچهٔ CRUD پیروی می‌کنند:
```
GET    /api/r/:resource?q=&f_&sort=&page=     (لیست + جستجو + فیلتر)
GET    /api/r/:resource/:id                   (جزئیات)
POST   /api/r/:resource                       (ایجاد — با تشخیص تکراری)
PUT    /api/r/:resource/:id                   (ویرایش)
DELETE /api/r/:resource/:id?hard=1            (حذف / آرشیو)
POST   /api/r/:resource/:id/archive|duplicate
GET    /api/r/:resource/:id/comments|tags|activities|audit|attachments|items
GET    /api/r/:resource/export?format=xlsx|csv
POST   /api/r/:resource/import  →  /import/commit   (پیش‌نمایش + خطا + ثبت)
```

## پشتیبان‌گیری
- بکاپ **خودکار روزانه** + **دستی** از پنل مدیریت ← بکاپ (فایل SQLite قابل انتقال).
- **Restore** از پنل با یک کلیک (سرویس برای لحظهٔ بازیابی متوقف می‌شود).

## مجوزها (نقش‌های از پیش تعریف‌شده)
مدیر سیستم، مدیرعامل، مدیر فروش، کارشناس فروش، مدیر مالی، کارشناس مالی، مدیر تولید، مدیر کیفیت، آزمایشگاه، R&D، انبار، پشتیبانی، بازاریابی، نماینده فروش — نقش‌های جدید + دسترسی‌های سفارشی (دیدن/ایجاد/ویرایش/حذف/خروجی/تأیید/آرشیو با Scope) از پنل مدیریت قابل ساخت است.

## محدودیت‌های شناخته‌شده
- دیتابیس SQLite برای کار تک‌سرور/میان‌مقیاس بهینه است؛ برای مقیاس بزرگ، لایهٔ `db.js` نقطهٔ تعویض به PostgreSQL است.
- تماس WebRTC برای کیفیت بالای LAN نیاز به STUN/TURN اختصاصی دارد (پیش‌فرض: STUN عمومی گوگل).

---
© شرکت دانش‌بنیان بسپار فوم غرب — BASPAR FOAM GARB
