# SECURITY BASELINE — BASPAR FOAM SMART CRM
**Stage 1 — Backup, Freeze & Security Baseline**
**تاریخ فریز:** ۹ شهریور ۱۴۰۵ / 2026-08-31 — **وضعیت: GOLDEN VERSION / BASELINE (فریز — تغییر ممنوع تا اعلام مرحله بعد)**

> ⚠️ **نکتهٔ صریح و مهم دربارهٔ استک:** دستور امنیتی به «Python» و «SQL Server» اشاره دارد، اما استک واقعی این پروژه **Node.js 20 + Express + SQLite (better-sqlite3)** است — **این پروژه نه Python دارد و نه SQL Server.** این baseline دقیقاً استک واقعی را ثبت می‌کند. مراحل بعدی (2-6) باید دقیقاً بر همین استک اعمال شوند و هیچ‌کدام از نتایج امنیتی برای کامپوننتی که وجود ندارد (مثلاً TLS روی SQL Server) جعلی اعلام نمی‌شود.

---

## ۱) خلاصهٔ وضعیت (Snapshot)

| مورد | مقدار |
|---|---|
| استک | Node.js **v20.20.2** + Express (روتینگ سفارشی، بدون فریمورک فرانت) + **better-sqlite3 12.11.1** (SQLite) + Vanilla JS ESM |
| پلتفرم | linux / x64 — npm 10.8.2 |
| دیتابیس | SQLite `data/baspar-crm.sqlite` (WAL) — **۹۱ جدول**، `integrity_check: ok`، **۰ نقض FK** |
| سرویس‌ها | ۱) HTTP server `node server/server.js` — پورت **3000** (bind 0.0.0.0) ۲) Scheduler داخلی (تیک ۶۰s) ۳) WebSocket hub روی همان پورت |
| پورت‌ها | فقط **3000** (HTTP/WS). دیتابیس فایل است — پورت شبکه ندارد. پورت 8888 متعلق به زیرساخت سنبوکس است، نه برنامه |
| API | **223 endpoint** (فهرست کامل: `data/backups/security-baseline-20260831/api-endpoints.txt`) |
| فایل‌های پروژه | **132 فایل** (بدون node_modules) — manifest SHA-256 کامل |
| TZ | Asia/Tehran |

## ۲) Dependencyها (Baseline — فریز)
| بسته | range در package.json | نسخهٔ قفل‌شده (package-lock) |
|---|---|---|
| better-sqlite3 | ^12.2.0 | **12.11.1** |
| bwip-js | ^4.5.1 | **4.11.4** |
| ws | ^8.18.0 | **8.21.3** |
| xlsx | 0.18.5 | **0.18.5** ⚠️ |

**⚠️ مشاهدات baseline برای مراحل بعد (بدون اقدام در این مرحله — Freeze):**
- `xlsx 0.18.5`: CVE-2023-30533 (ReDoS) و CVE-2024-22363 (Prototype Pollution) شناخته‌شده — در نسخه‌های 0.19+/0.20+ رفع شده. **مورد بررسی/ارتقا در Stage بعد با تست رگرسیون کامل** (این بسته فقط برای export XLSX استفاده می‌شود — مهاجرت به `SheetJS` نسخهٔ جدید یا جایگزین باید بدون تغییر خروجی انجام شود).
- بقیهٔ dependencies: نسخه‌های قفل‌شده فعلی در Stage بعد audit می‌شوند.
- **اصول Freeze:** هیچ dependency ارتقا/حذف نمی‌شود تا مرحلهٔ بعد صریحاً شروع شود.

## ۳) Environment Variables (فقط نام‌ها — هیچ مقدار Secret در این گزارش نیست)
| متغیر | کاربرد | پیش‌فرض |
|---|---|---|
| `PORT` | پورت HTTP | 3000 |
| `TZ` | منطقهٔ زمانی | Asia/Tehran |
| `DB_PATH` | مسیر دیتابیس | data/baspar-crm.sqlite |
| `DATA_DIR` | ریشهٔ دیتا (آپلود/ضبط/بکاپ) | data |
| `JWT_SECRET` | کلید امضای JWT | در صورت خالی: از کلید ذخیره‌شده در DB (`settings.enc_key`) استفاده می‌شود |
| `SEED_DEMO` | Seed دیتای دمو هنگام نصب اولیه | فعال |

**وضعیت Secrets در baseline (صادقانه):**
- کلید رمزنگاری (`enc_key`) و کلید JWT فعلی **در داخل دیتابیس** (settings) ذخیره‌اند — نه در سورس‌کد. **خروج کامل آن‌ها به Environment Variables کار Stage بعد است** (با سازگاری رو به عقب برای دیتابیس‌های موجود).
- رازهای VoIP (password/api_key/webhook_secret) و API Key های AI: **رمزنگاری‌شده** (AES-256-GCM با پیشوند `enc:`) در DB — مقدارشان در هیچ گزارش/ZIP در دسترس نیست.
- هیچ Secret در سورس‌کد، لاگ یا فایل‌های متنی پروژه یافت نشد (بررسی در Stage 12/17 با اسکن سیستماتیک تکرار می‌شود).

## ۴) وضعیت امنیتی موجود (چه چیزی الان فعال است)
| کنترل | وضعیت در baseline |
|---|---|
| Authentication | JWT (HS256) + `requireUser` روی همهٔ APIها؛ توطیف دو مرحله‌ای (TOTP) موجود؛ `must_change_password` برای admin اولیه |
| Authorization | نقش‌های 14گانه + permission-based (view/create/edit/export/delete) + scope `own/all` + بررسی در هر route؛ تست 403 در سوئیت‌ها |
| SQL Injection | تمام کوئری‌ها با better-sqlite3 **prepared statement/parameterized** (pattern یکپارچه در کل server/) |
| Hashing رمز | **scrypt** (Node crypto) — salt تصادفی ۱۶ بایت + ۶۴ بایت hash + مقایسه `timingSafeEqual` (پارامترهای پیش‌فرض scrypt — cost/پلیسی رمز در Stage بعد audit می‌شود) |
| Path Traversal | سرو استاتیک فقط از `public/` با `normalize` + `startsWith` guard؛ آپلودها پشت `data/` (خارج از وب)؛ streaming ضبط فقط با token یک‌بارمصرف |
| Error Handling | `sendError` یکپارچه با کد/پیام فارسی — Stack Trace خام به کاربر نمی‌رسد (audit در Stage بعد) |
| Secure Headers | `X-Content-Type-Options: nosniff`، `Referrer-Policy`، `Permissions-Policy` فعال — **HSTS/CSP/Frame-Protection در Stage بعد** |
| CORS | بدون CORS باز — فقط same-origin (API + WS روی یک origin) |
| Request Size | حد **30 MB** در `readBody` (خطای BODY_TOO_LARGE) |
| Audit Log | جدول `audit_logs` برای عملیات CRUD/تنظیمات/VoIP/نقش‌ها + `ai_logs` + `webhooks_log` — **لاگ ورود/خروج/ورود ناموفق در audit نیست** (فقط `last_login_at` + rate-limit) → مورد Stage بعد |
| Rate Limiting | **موجود:** 300 درخواست/دقیقه/IP روی API + **10 تلاش ورود/دقیقه/IP** (429 با پیام فارسی؛ پیام 401 عمومی — بدون enumeration کاربر) — تقویت (lockout/تأخیر تدریجی) در Stage بعد |
| Password Policy | فلگ `must_change_password` (admin اولیه) + scrypt — سیاست طول/پیچیدگی رمز در Stage بعد |
| HTTPS/TLS | **در سطح برنامه فعال نیست** (HTTP خالص) — readiness با Reverse Proxy/Config در Stage بعد |
| Backup داخلی | سیستم بکاپ admin موجود است (مسیر `data/backups/` — خارج از وب) |

## ۵) فایل‌های حساس (فقط نام — بدون محتوای Secret)
فهرست کامل: `data/backups/security-baseline-20260831/sensitive-files.json`
- `data/baspar-crm.sqlite` — کاربران/هش‌ها/کلیدها/رازهای رمزنگاری‌شده
- `server/lib/crypto.js` — کد رمزنگاری (کلید واقعی در DB است، نه سورس)
- `server/auth/auth.js` — احراز هویت و authorization
- `data/uploads/` و `data/recordings/` — فایل‌های کاربری (خارج از مسیر وب)
- `data/backups/` — بکاپ‌ها (خارج از مسیر وب)

## ۶) بکاپ‌ها (Stage 1)
| آرتیفکت | مسیر | وضعیت |
|---|---|---|
| بکاپ کامل پروژه (ZIP) | `data/backups/security-baseline-20260831/project-baseline.zip` (8.7 MB، 132 فایل) | ✅ |
| بکاپ دیتابیس | `data/backups/security-baseline-20260831/db/baspar-crm.sqlite` (byte-identical با DB زنده در لحظهٔ فریز) | ✅ |
| Schema dump | `data/backups/security-baseline-20260831/db/schema.sql` | ✅ |
| Data fingerprint (تعداد رکورد ۹۱ جدول) | `data/backups/security-baseline-20260831/db/data-fingerprint.json` | ✅ |
| Manifest SHA-256 (132 فایل) | `data/backups/security-baseline-20260831/manifest.json` | ✅ |
| Environment/stack/ports/endpoints | `environment.json` + `api-endpoints.txt` + `sensitive-files.json` | ✅ |

> بکاپ‌ها در `data/backups/` قرار دارند — **خارج از مسیر سرو وب** (فقط `public/` سرو می‌شود) و از ZIPهای توزیعاتی exclude شده‌اند.

## ۷) Freeze Rule (از این لحظه)
این نسخه = **BASELINE / GOLDEN VERSION**. تا شروع صریح Stage 2:
- ❌ تغییر کد Backend / Frontend / UI
- ❌ Migration دیتابیس
- ❌ ارتقا/حذف Dependency
- ❌ تغییر Configuration امنیتی
- ✅ فقط: مستندسازی، گزارش‌دهی، و بکاپ‌های اضافی (additive)

## ۸) نتیجهٔ تست Stage 1
| تست | نتیجه |
|---|---|
| **Backup Project** | **PASS** ✅ — ZIP کامل (132 فایل، manifest SHA-256) |
| **Database Backup** | **PASS** ✅ — کپی بایتی DB + schema + fingerprint (91 جدول)؛ integrity ok / 0 FK |
| **Baseline** | **PASS** ✅ — `SECURITY_BASELINE.md` + `SECURITY_CHANGELOG.md` + آرتیفکت‌های baseline |
| **Restore Verification** | **PASS** ✅ — 8/8: استخراج ZIP در محیط تمیز، هم‌خوانی SHA-256 همهٔ 132 فایل، باز شدن DB بازیابی‌شده (integrity ok / 0 FK / fingerprint یکسان)، DB بکاپ byte-identical |

---
**Stage 1 کامل شد. مطابق دستور، در Stage 2 قرار نگرفتم. منتظر اعلام مرحلهٔ بعد.**
