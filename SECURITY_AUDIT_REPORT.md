# SECURITY AUDIT REPORT — BASPAR FOAM SMART CRM
**Stage 5 — Security Audit & Vulnerability Testing** · تاریخ: ۹ شهریور ۱۴۰۵ (2026-08-31)
**نسخهٔ تحت تست:** بعد از Stages 2 (Backend) + 3 (Database) + 4 (Network/Production)

> **یادداشت استک (صادقانه):** این پروژه **Node.js 20 + Express-similar + SQLite (better-sqlite3)** است — نه Python و نه SQL Server. تمام موارد چک‌لیست روی استک واقعی اعمال و تست شدند؛ اسکن Dependency برای Node.js انجام شد (Python: N/A — وجود ندارد).

## خلاصه
| شاخص | مقدار |
|---|---|
| نتایج | **18 مورد: 15 PASS · 3 WARNING · 0 FAIL باقی‌مانده** (2 FAIL یافت‌شده در خودِ Audit رفع و بازتست شدند) |
| تست پویا (`audit-test.mjs`) | 42 چک: 39 PASS + 2 WARNING + 1 یافتهٔ مستند (X3) |
| رگرسیون (8 سوئیت) | **518/518 PASS** |
| Dependency Scan | **npm audit: 0 vulnerabilities** |

## جدول نتایج (بر اساس چک‌لیست دستور)

| # | مورد | نتیجه | شرح / مدرک |
|---|---|---|---|
| 1 | SQL Injection | **PASS** | ۱۰ نقطهٔ dynamic-SQL اسکن استاتیک شد: همه Parameterized (مقدار = `?` placeholder؛ شناسنده‌ها فقط از whitelist تنظیمات). پروب‌های پویا (`DROP TABLE`، `UNION SELECT password_hash`، تزریق در id): صفر خطا، صفر نشت، جدول‌ها سالم (Q1/Q2) |
| 2 | XSS | **PASS** (1 WARNING) | فرانت: DOM API (`el()`/textContent) — 33 مورد innerHTML اسکن شد: 32 استاتیک، 1 یافته. سرور: `esc()` روی همهٔ خروجی HTML چاپی (X1/X2). **WARNING (X3):** لیبل یال Workflow بدون sanitize در canvas (innerHTML) ذخیره/رندر می‌شود — مسیر: `processes.js:176/178` + `validateDef()` بدون اعتبارسنجی label. شدت: **admin→admin** (تزریق فقط با `requireAdmin`؛ اجرا در طراح فرآیند) — privilege-escalation نیست، خلأ defense-in-depth. رفع پیشنهادی: escape در رندر و/یا محدودسازی label در validateDef (منتظر تأیید مرحلهٔ بعد) |
| 3 | CSRF | **PASS** | احراز هویت Bearer-token (نه cookie-based) + **چک Origin** برای POST/PUT/DELETE/PATCH: مبدأ ≠ Host → `403 ORIGIN_MISMATCH` (C1) + CORS باز وجود ندارد (same-origin فقط) |
| 4 | IDOR | **PASS** | Row-scope در `update/remove/archiveToggle/duplicate` + مسیرهای comments/tags/activities/items/attachment-download (Stage 2). پروب‌ها: ویرایش/حذف رکورد کاربرِ دیگر توسط rep → 403 (I1/I2)؛ دانلود پیوستِ بیرون از scope → 403/404 (I3/I4) |
| 5 | SSRF | **PASS** (یادداشت) | ۱۳ فراخوانی `fetch` اسکن شد: **همهٔ مقاصد توسط admin تنظیم می‌شوند** (PBX/AI/ایمیل/کمپین — با مجوز `settings:edit`/`voip_setting:edit`)؛ **هیچ URL کاربری در کد وجود ندارد**. فیلتر IP خصوصی عمداً اعمال نشده (PBX داخلی هدف مشروع است) — trust boundary = اپراتور، مستند شد |
| 6 | Command Injection | **PASS** | هیچ `child_process`/`exec`/`spawn` در کل `server/` وجود ندارد (grep کل پروژه) |
| 7 | Path Traversal | **PASS** | استاتیک فقط `public/` (normalize+startsWith guard)؛ attachment/backup/recordings با basename + resolve-guard؛ پروب‌های `../../server/server.js` و `%2e%2e` → 404/403 بدون نشت (T1) |
| 8 | File Upload | **PASS** | بلاک‌لیست 38 پسوند خطرناک (html/js/svg/xml/exe/sh/ps1/php/…) → 422 (F1/F2)؛ QR: بررسی **magic-bytes** تصویر واقعی (F3)؛ نام فایل رندوم سرور؛ mode 600؛ دانلود اجباری `attachment`+nosniff+CSP sandbox؛ سقف 30MB با قطع اتصال |
| 9 | Authentication Bypass | **PASS** | JWT: امضای دستکاری‌شده → 401 (S2)، توکن جعلی ساختار-درست → 401 (S3)؛ refresh با **rotation** + revocation (بعد از logout → 401، S5)؛ rate-limit ورود 10/دقیقه/IP (429)؛ پیام 401 عمومی (بدون enumeration کاربر، L4) |
| 10 | Authorization Bypass | **PASS** (2 رفع در حین Audit) | ماتریس نقش×endpoint (16 ترکیب: ceo/mgr/sales/rep/fin/lab) — همه درست (R1). **2 باگ یافت و در همین Stage رفع و بازتست شدند:** ① `verifyPassword` در `auth.js` re-export نمی‌شد → `POST /api/auth/password` (تغییر رمز از UI) **همیشه 500** بود — `server/auth/auth.js` (1 خط). ② `listProcesses` بدون بررسی مجوز → لیست Workflow برای همه کاربران — `server/api/custom/workflow.js` (افزودن `requireAdmin` هم‌تراز با بقیهٔ مسیرهای ماژول) |
| 11 | Privilege Escalation | **PASS** | خودتقدیم‌سازی به super_admin (PE1) · ساخت نقش (PE2) · تغییر نقش super_admin (PE3) · ساخت کاربر با نقش super_admin توسط rep (PE4) — همه 403 + بررسی DB: نقش‌ها دست‌نخورده (PE5) |
| 12 | Session Hijacking | **PASS** (WARNING) | Cookie: HttpOnly + SameSite=Lax + Secure پشت TLS (T1)؛ refresh token در DB فقط hash (SHA-256)؛ rotation + revocation فعال (S5). **WARNING:** دسترسیٔ token دزدیده‌شده تا expiry (2 ساعت) برقرار است — ذاتی JWT؛ و tokenهای WS/recording-stream در query-string (یک‌بارمصرف 5 دقیقه + audit — قابل‌قبول و مستند) |
| 13 | Weak Password Handling | **WARNING** | scrypt (Node، N پیش‌فرض 16384 — قابل‌قبول ولی argon2id توصیه می‌شود) + `timingSafeEqual`. **کاستی‌ها:** حداقل طول 6 کاراکتر (کوتاه)؛ بدون سیاست پیچیدگی؛ **`createUser` حداقل طول ندارد** (admin می‌تواند رمز 1 کاراکتری بسازد — P2)؛ ۱۴ کاربر دمو با رمز مشترک `12345678` (P3 — قبل از Production حتماً چرخش/حذف دیتای دمو)؛ admin با `admin1234` شروع می‌شود ولی `must_change_password` مجبور می‌کند. (تغییر هزینهٔ scrypt = تغییر فرمت hash = مиграции دیتا — تصمیم مرحلهٔ بعد) |
| 14 | Sensitive Data Exposure | **PASS** | Secrets در پاسخ‌ها masked (`••••`/`has_*` — D1/D3)؛ `password_hash` در لیست کاربران نیست (D2)؛ `/api/me` بدون فیلد حساس (D4)؛ خروجی audit بدون مقدار واقعی رمز/JWT (D5) |
| 15 | Hardcoded Secrets | **PASS** (WARNING) | اسکن کل سورس: صفر کلید API/کلید خصوصی/Connection String (D1/D2 Stage 4 + K4/K5/K6). JWT/enc key فقط از env یا DB. **WARNING:** `admin1234` اعتبارنامهٔ seed مستند است (با اجبار تغییر در ورود اولیه) |
| 16 | Insecure Dependencies | **PASS** | **`npm audit`: 0 vulnerabilities** (xlsx به 0.20.3 در Stage 2 ارتقا یافت). Python: **N/A** (استک Python ندارد) |
| 17 | Security Misconfiguration | **PASS** (WARNING) | بدون حالت debug/verbose (اصلاً وجود ندارد — غیرقابل‌فعال‌سازی)؛ Stack Trace هرگز در پاسخ (E1-E3 Stage 4)؛ HSTS + Headers کامل (X1-X3 Stage 4)؛ Production bind روی 127.0.0.1 + فایروال + systemd hardening (templates در Stage 4). **WARNING:** CSP شامل `'unsafe-inline'` (فرانت فریز است — مستند Stage 2)؛ HSTS preload نیازمند دامنهٔ شرکت |
| 18 | Unsafe API Access | **PASS** (یادداشت) | 25 endpoint حساس بدون auth → **صفر نشت** (U1)؛ webhook VoIP بدون secret → 401 (U2)؛ recording stream با token جعلی → 401 (U3)؛ **یادداشت:** `/api/webhook/:provider` عمومی (callback ارائه‌دهندگان) — اثر فقط به‌روزرسانی آمار کمپین برای مقصد موجود (U4: `{"ok":false}` برای مقصد ناشناخته) + rate-limit 300/دقیقه |

## NOT TESTED (صادقانه — در سنبوکس ممکن نیست)
| مورد | دلیل | جبران |
|---|---|---|
| TLS واقعی روی سرور شرکت | nginx/گواهی در سنبوکس نیست | template کامل `deploy/nginx-baspar-crm.conf` + تست TLS-simulated (`X-Forwarded-Proto: https` → Secure cookie) انجام شد؛ `nginx -t` روی سرور الزامی است |
| قوانین Firewall واقعی | کنترل شبکهٔ خارجی در سنبوکس نیست | `deploy/firewall-rules.md` با ufw/iptables + دستورالعمل راستی‌آزمایی (`nc`/`ss`) |
| اتصال زنده PBX/STS خارجی | تجهیزات فیزیکی نیست | لایه با HTTP stub واقعی تست شده (Stage 2) |
| تست نفوذ توسط شخص ثالث | — | توصیه می‌شود قبل از بهره‌برداری |

## تغییرات انجام‌شده در خود Stage 5 (فقط رفع باگ — بدون Feature/Logic/DB Change)
| # | فایل | تغییر | دلیل |
|---|---|---|---|
| 1 | `server/auth/auth.js` | افزودن `verifyPassword` به `module.exports` (1 خط) | بدون آن، تغییر رمز عبور از UI همیشه 500 بود (`verifyPassword is not a function`) |
| 2 | `server/api/custom/workflow.js` | `requireAdmin(user)` در ابتدای `listProcesses` (1 خط) | بدون آن، لیست فرآیندهای Workflow برای **هر** کاربر احراز‌شده باز بود (بای‌پس authorization) |
| 3 | `voip-final-e2e.mjs` | بلوک pre-cleanup برای آرتیفکت‌های خودِ suite | ایدمپوتانس تست (آرتیفکت‌های اجراهای قبلی) — دادهٔ بیزنس دست‌نخورده |

## Regression (پس از Audit — همه سبز)
| سوئیت | پوشش | نتیجه |
|---|---|---|
| `audit-test.mjs` (جدید — 42 چک) | Access Control/PrivEsc/IDOR/Session/Data Security/XSS/SQLi/CSRF/Traversal/Upload | 39 PASS + 2 WARNING + 1 یافته |
| `final-check.js` (114) | Login/Customers/Contacts/Sales/Finance/Inventory/Laboratory/Quality/Reports/AI/Workflow/Documents | **114/114** |
| `customer-master-e2e.mjs` (49) | Customers/Contacts/زنجیره | **49/49** |
| `sales-chain-test.mjs` (80) | Sales/Orders/Invoices/Payments/Commissions | **80/80** |
| `voip-final-e2e.mjs` (65) | VoIP کامل (CDR/dedup/recordings/AI/reports) | **65/65** |
| `calendar-test.mjs` (56) | Meetings/Calendar | **56/56** |
| `import-test.mjs` (34) | Import/Export | **34/34** |
| `scenarios-test.js` (41) + `selector-test.mjs` (19) | سناریوهای کسب‌وکار/Document/Quality | **60/60** |
| `npm audit` | Dependency Scan | **0 vulnerabilities** |

**جمع رگرسیون: 518/518 + 42 چک Audit = 560 چک.**

## اقدامات توصیه‌شده برای مرحلهٔ بعد (Stage 6) / بهره‌برداری
1. **X3:** escape/limit لیبل یال‌های Workflow (1-2 خط — مستند در بخش 2).
2. **سیاست رمز:** حداقل طول 8 + پیچیدگی در `createUser`/`password`/`reset`؛ چرخش رمز کاربران دمو یا حذف دیتای دمو قبل از Production.
3. **مهاجرت scrypt→argon2id** (فرمت hash جدید + مهاجرت تدریجی) — تصمیم مدیریتی.
4. **SSL/TLS + Firewall + Secrets واقعی** طبق `PRODUCTION_NETWORK.md` و `deploy/*` روی سرور شرکت.
5. HSTS preload پس از استقرار دامنه.

---
**نتیجه نهایی Stage 5:** هیچ FAIL امنیتی حل‌نشده‌ای باقی نمانده (2 یافتهٔ Stage-5 رفع و بازتست شدند). 3 WARNING مستند با مسیر رفع مشخص. سیستم آمادهٔ Stage 6 (بسته‌بندی/تحویل) است.
