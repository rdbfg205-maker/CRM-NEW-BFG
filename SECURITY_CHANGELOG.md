# SECURITY CHANGELOG — BASPAR FOAM SMART CRM
**فرمت هر entry:** تاریخ | مرحله | تغییر | فایل‌ها | نتیجه تست

---

## 2026-08-31 — Stage 1: Backup, Freeze & Security Baseline (فقط ثبت وضعیت — بدون هیچ تغییر عملیاتی)

### ثبت‌شده (additive — فایل‌های جدید، بدون دست‌کاری هیچ کد/دیتا/تنظیمی)
| نوع | مسیر | توضیح |
|---|---|---|
| Backup | `data/backups/security-baseline-20260831/project-baseline.zip` | بکاپ کامل پروژه (132 فایل + DB) — 8.7 MB |
| Backup | `data/backups/security-baseline-20260831/db/baspar-crm.sqlite` | کپی بایتی دیتابیس در لحظهٔ فریز (integrity ok / 0 FK) |
| Backup | `data/backups/security-baseline-20260831/db/schema.sql` | Schema dump کامل |
| Backup | `data/backups/security-baseline-20260831/db/data-fingerprint.json` | تعداد رکورد هر ۹۱ جدول (اثرانگشت داده) |
| Baseline | `data/backups/security-baseline-20260831/manifest.json` | SHA-256 همهٔ 132 فایل پروژه |
| Baseline | `data/backups/security-baseline-20260831/environment.json` | استک/نسخه‌ها/dependencyها/متغیرهای محیطی/پورت‌ها/سرویس‌ها |
| Baseline | `data/backups/security-baseline-20260831/api-endpoints.txt` | فهرست 223 endpoint |
| Baseline | `data/backups/security-baseline-20260831/sensitive-files.json` | شناسایی فایل‌های حساس (فقط نام — بدون مقدار Secret) |
| Documentation | `SECURITY_BASELINE.md` | baseline کامل + وضعیت امنیتی موجود + مشاهدات (مثل xlsx 0.18.5) |
| Tooling | `tools-security-baseline.js` | اسکریپت ساخت baseline (read-only) |
| Tooling | `tools-security-restore-check.js` | اسکریپت Verify بازیابی |

### تغییر عملیاتی
**هیچ** — مطابق Freeze Rule: بدون تغییر Backend / Frontend / UI / DB / Dependency / Configuration.

### وضعیت فریز
**نسخهٔ فعلی = BASELINE / GOLDEN VERSION.** مراحل 2 تا 6 منتظر اعلام صریح.

### تست‌های Stage 1
| تست | نتیجه |
|---|---|
| Backup Project | PASS |
| Database Backup | PASS |
| Baseline | PASS |
| Restore Verification (8 چک: استخراج، SHA-256 × 132 فایل، باز شدن DB بازیابی‌شده، integrity، 0 FK، fingerprint 91 جدول، byte-identity) | **PASS (8/8)** |

---

## 2026-08-31 — Stage 2: Backend Security Hardening (فقط لایهٔ Backend/امنیت — بدون تغییر UI/Feature/Workflow)

### تغییرات (فقط کد امنیتی)
| فایل | تغییر | دلیل |
|---|---|---|
| `server/server.js` | Security Headers: CSP (سازگار با فرانت فریزشده)، `X-Frame-Options` (پیش‌فرض DENY، قابل تنظیم با env `X_FRAME_OPTIONS`)، HSTS، `X-XSS-Protection: 0` (به nosniff/Referrer-Policy/Permissions-Policy موجود اضافه شد) | بند 11 دستور |
| `server/server.js` | بررسی Origin برای POST/PUT/DELETE/PATCH: مبدأ متفاوت از Host → 403 ORIGIN_MISMATCH (CSRF defense-in-depth؛ کلاینت‌های native بدون Origin مجاز) | بند 7 (CSRF) |
| `server/server.js` | `setSecret(process.env.JWT_SECRET ←→ fallback: getSetting('jwt_secret'))` — env بر DB اولویت دارد (سازگار رو به عقب؛ messenger از قبل همین منطق را داشت) | بند 9 (Secrets) |
| `server/server.js` | audit خروج کاربر (`logout`) | بند 13 |
| `server/server.js` | `attachFiles`: مسدودسازی ۳۸ پسوند خطرناک (html/js/svg/xml/exe/sh/ps1/php/…) → 422 UPLOAD_BLOCKED | بند 8 (File Upload) |
| `server/server.js` | دانلود پیوست: `Content-Disposition: attachment` (موجود) + `nosniff` + CSP `sandbox allow-downloads` روی پاسخ فایل؛ + بررسی scope رکورد والد (IDOR) | بندهای 7 و 8 |
| `server/server.js` | مسیرهای comments/tags/activities/attachments/items: `scopedRowAs` — وجود رکورد + scope کاربر (view/edit) | بند 6 (Authorization/IDOR) |
| `server/auth/auth.js` | Cookie: `Secure` فقط پشت TLS (x-forwarded-proto=https)؛ `HttpOnly` + `SameSite=Lax` (موجود) حفظ شد | بند 5 (Session/Cookie) |
| `server/auth/auth.js` | audit ورود موفق (`login`) و ناموفق (`login_failed` — فقط username+IP، هرگز رمز) | بند 13 |
| `server/auth/auth.js` | audit رد مجوز (`permission_denied`) در `requirePerm` | بند 13 |
| `server/api/generic.js` | `assertRowScope()` + اعمال آن در `update`، `remove`، `archiveToggle` (archive+restore)، `duplicate` — **رفع IDOR: ویرایش/حذف/آرشیو/کپی رکورد خارج از scope → 403** (show/list از قبل این چک را داشتند) | بند 6 (Authorization/IDOR) |
| `package.json` + `package-lock.json` | `xlsx` 0.18.5 → **0.20.3** (از CDN رسمی SheetJS — در npm registry نسخهٔ امن وجود ندارد) — رفع ۲ CVE (ReDoS GHSA-5pgg-2g8v-p4x9، Prototype Pollution GHSA-4r6h-8v6p-xvw6)؛ `npm audit` = **0 vulnerability** | بند 2 (Dependency Audit) |
| `security-test.mjs` | **جدید** — سوئیت امنیتی 54 چکی (هدرها، CSRF/Origin، brute-force، audit، IDOR مثبت/منفی، آپلود، traversal، SQLi، خطاها، کوکی، حد حجم، اسکن secret، اسکن parameterized-query) | بند 17/18 |

### یافته و رفع‌شده (باگ واقعی)
- **IDOR در generic.update/remove/archiveToggle/duplicate + مسیرهای comments/tags/items/attachment-download**: کاربر با مجوز `edit` scope=own می‌توانست رکورد کاربر دیگری را ویرایش/حذف کند (و هر کاربر احراز‌شده پیوست هر رکورد را دانلود می‌کرد). رفع شد با `assertRowScope` — هم‌معنای scope فعلی list/show (بدون تغییر رفتار برای کاربران مجاز).

### بدون تغییر (مطابق قانون)
UI/فرانت، دیتابیس (بدون Migration)، Contract APIها (رفتار همهٔ endpointها برای کاربران مجاز دقیقاً مثل قبل)، Workflow، منطق کسب‌وکار، دیتا.

### نتایج تست Stage 2
| تست | نتیجه |
|---|---|
| **security-test.mjs (جدید)** | **54/54 PASS** ✅ |
| final-check.js | 114/114 ✅ |
| customer-master-e2e / customer-master-test | 49/49 + 70/70 ✅ |
| calendar / sales-chain / import / scenarios / selector | 56 + 80 + 34 + 41 + 19 ✅ |
| voip-final-e2e.mjs | 65/65 ✅ |
| ui-test.mjs (رندر زنده 65 روت) | 0 خطای View/API ✅ |
| route-test.mjs | ALL VIEWS OK ✅ |
| npm audit | **0 vulnerabilities** ✅ |

**جمع Stage 2: ۵۵۲+ چک سبز، ۰ شکست.**

---

## 2026-08-31 — Stage 3: Database Layer Security Hardening
**یادداشت استک:** این پروژه **SQL Server ندارد** — لایهٔ دیتابیس واقعی **SQLite (better-sqlite3)** است. چک‌لیست Stage 3 دقیقاً روی لایهٔ واقعی اعمال شد؛ موارد N/A صادقانه گزارش شدند.

### پیش‌نیاز
- **اسنپات وضعیت پیش از تغییر** (اصل: بکاپ قبل از هر تغییر): `data/backups/security-baseline-stage3/` (کپی DB + fingerprint 91 جدول + schema + فهرست 12 Migration).

### تغییرات (فقط امنیت لایهٔ DB)
| فایل | تغییر | دلیل |
|---|---|---|
| `server/api/custom/admin.js` — `createBackup` | بعد از ساخت بکاپ: `chmod 600` روی فایل + **Retention** (پاک‌سازی خودکار بکاپ‌های قدیمی‌تر از `settings.backup_retention_days`، پیش‌فرض ۳۰ روز) با audit `retention_purge` | بند «Backup Security / Retention / Access Control» |
| `server/api/custom/admin.js` — `downloadBackup` | گارد مسیر: فقط نام‌های تولیدشدهٔ سرور (`baspar-backup-\d+\.sqlite`) + resolve داخل `data/backups` (defense-in-depth در برابر traversal) | بند «Database Exposure» |
| Filesystem | `data/` = **700**، `data/backups`/`uploads`/`recordings` = **700**، فایل DB و همهٔ بکاپ‌ها = **600** (قبل: 644/755 — قابل‌خواندن توسط هر کاربر OS سرور!) | Least Privilege در سطح فایل‌سیستم |
| `db-security-test.mjs` | **جدید** — سوئیت 32 چکی: integrity، FK، پایداری schema در برابر baseline، پایداری Migration، fingerprint داده، نفوذ HTTP به فایل DB، امنیت بکاپ (مجوز/retention/mode/audit)، SQLi probes، CRUD واقعی، اسکن سورس | بندهای 17/18 |

### یافته‌های Stage 3
1. **حقوق فایل‌سیستم DB: 644/755** → هر کاربر OS روی سرور می‌توانست DB (شامل هش رمزها و کلیدهای رمزنگاری) را بخواند. **رفع شد** (700/600).
2. **بدون Retention بکاپ** → انباشته‌شدن بی‌پایان بکاپ‌ها (هرکدام کپی کامل DB). **رفع شد** (retention پیش‌فرض ۳۰ روز، قابل تنظیم، با audit).
3. بکاپ‌های جدید با mode ۶۰ نوشته می‌شوند.

### N/A صادقانه (مختص SQL Server — در استک واقعی معادل ندارند)
- **TLS/Connection Security روی کانال DB:** N/A — SQLite دیتابیس **فایل محجور (embedded)** است؛ هیچ کانال شبکه/پورت DB وجود ندارد → **exposure شبکهٔ DB به‌صورت ساختاری صفر است** (تست E1/E2 تأیید کرد فایل DB از HTTP در دسترس نیست).
- **Database Roles/Users SQL Server:** معادل = مجوزهای OS + scope application-level (Stage 2) + مجوز `backup:view/edit` فقط super_admin.
- **Encryption at rest:** فایل SQLite روی دیسک plaintext است؛ با 700/600 + خارج‌بودن از web root کنترل شد. رمزنگاری کامل فایل = تصمیم سطح سرور (Full-Disk Encryption) — در SERVER_DEPLOYMENT.md ثبت می‌شود.
- **Connection String در سورس:** N/A — مسیر DB فقط از `process.env.DB_PATH` با پیش‌فرض نسبی امن (تست D1/D3).

### نتایج تست Stage 3
| تست | نتیجه |
|---|---|
| **db-security-test.mjs (جدید)** | **32/32 PASS** ✅ |
| CRUD Regression: final-check / customer-master-e2e / sales-chain / calendar | 114 + 49 + 80 + 56 = **299/299** ✅ |
| Database Integrity: `integrity_check=ok`، `foreign_key_check=0`، schema/Migration یکسان با baseline (12 Migration، 91 جدول، 0 تغییر ناخواسته) | ✅ |
| Data Fingerprint: ۲۴ جدول دادهٔ تجاری (customers/products/invoices/orders/quotes/payments/…) **تغییری نکرده** — اختلاف‌ها فقط جداول عملیاتی/تست (audit_logs، refresh_tokens، search_index، voip_calls از E2E و settings از پیکربندی E2E) | ✅ (مستند) |

---

## 2026-08-31 — Stage 4: Network & Production Hardening
**یادداشت استک (صادقانه):** TLS در این معماری روی **Reverse Proxy (nginx)** Terminated می‌شود؛ app پشت آن HTTP داخلی دارد. Node.js/SQLite است — هیچ کامپوننت Python/SQL Serverی وجود ندارد.

### تغییرات کد (فقط زیرساخت Production — بدون تغییر API کاربری/UI/DB/Logic)
| فایل | تغییر |
|---|---|
| `server/server.js` | **Health endpoint** `GET /health` (+`/healthz`): بدون احراز هویت، بدون دادهٔ حساس، `200 {status:ok,db:true}` / `503 degraded`، no-cache — additive |
| `server/server.js` | **Bind قابل‌پیکربندی:** `HOST` env (پیش‌فرض 0.0.0.0 برای dev/sandbox؛ **127.0.0.1 در Production**) + بک‌بانر `NODE_ENV=production` |

### فایل‌های جدید (Template — بدون هیچ Secret واقعی)
| فایل | محتوا |
|---|---|
| `deploy/env.example` | تمام env vars با placeholder (`JWT_SECRET=CHANGE_ME_...`) — مصرف با systemd `EnvironmentFile` (بدون dependency dotenv) |
| `deploy/nginx-baspar-crm.conf` | Reverse Proxy کامل: TLSv1.2/1.3 + cipherهای مدرن، HTTP→HTTPS redirect، HSTS/nosniff/XFO/Referrer، `server_tokens off`، `client_max_body_size 30m`، **rate-limit login در لبه**، **WebSocket upgrade** (هاب پیام‌رسانی)، `location /health` برای LB |
| `deploy/baspar-crm.service` | systemd: کاربر اختصاصی `baspar`، `Restart=always`، hardening کامل (NoNewPrivileges/PrivateTmp/ProtectSystem=full/RestrictSUIDSGID/…) + `IPAddressDeny=any` + `IPAddressAllow=127.0.0.1 ::1` (اپ **نمی‌تواند** به شبکهٔ عمومی وصل شود) + `ReadWritePaths=/var/lib/baspar-crm` |
| `deploy/firewall-rules.md` | ufw + iptables: فقط 80/443 عمومی، 22 فقط IPهای مجاز، 3000 = loopback bind + DROP (defense-in-depth)، راهنمای راستی‌آزمایی |
| `PRODUCTION_NETWORK.md` | مستند کامل: معماری، HTTPS/TLS، Headers، CORS، Cookies، Production Config، Env، Service، Health، Logging، Backup، Firewall + نتایج تست + موارد نیازمند اقدام روی سرور شرکت |
| `production-test.mjs` | **سوئیت 25 چکی** Production (bind loopback، health، TLS-simulated Secure cookie، headers روی static/api/health، login/session/token، CRUD، error handling، CSRF، env بررسی از /proc) |

### نتایج تست Stage 4
| تست | نتیجه |
|---|---|
| **production-test.mjs (حالت `NODE_ENV=production HOST=127.0.0.1`)** | **25/25 PASS** ✅ |
| Regression: final-check.js **روی سرور Production** | **114/114** ✅ |
| Bind: فقط `127.0.0.1:3000` (سکت 0.0.0.0 اپ وجود ندارد؛ سوکت 169.254.* متعلق به زیرساخت سنبوکس است) | ✅ |
| TLS: `X-Forwarded-Proto: https` → کوکی `Secure` (مکانیزم Stage 2) | ✅ |
| Secure Headers کامل روی سه کلاس پاسخ (static/api/health) | ✅ |
| Health: 200/ok + db:true + بدون نشت داده | ✅ |
| Error handling: 400/401/404/429 بدون Stack Trace · بدون نشت نسخهٔ سرور (Server header) | ✅ |
| CSRF/Origin check فعال در Production | ✅ |

### صادقانه — مواردی که فقط روی سرور شرکت قابل انجام/تأیید است
1. **صدور گواهی TLS** برای دامنهٔ شرکت + نصب nginx و `nginx -t` (در سنبوکس nginx نیست؛ template مطابق مستندات رسمی نوشته شده ولی **باید روی سرور تأیید شود**).
2. اعمال قوانین فایروال با IPهای واقعی مدیریت.
3. قرار دادن Secrets واقعی در `/etc/baspar-crm/env` (chmod 600).
4. کپی روزانهٔ بکاپ‌ها به مقصد خارج از سرور (3-2-1).

---

## 2026-08-31 — Stage 5: Security Audit & Vulnerability Testing
**خروجی اصلی:** `SECURITY_AUDIT_REPORT.md` (18 مورد: 15 PASS · 3 WARNING · 0 FAIL باقی‌مانده)

### یافته و رفع‌شده در خودِ Audit (فقط رفع باگ — بدون Feature/Logic/DB Change)
| # | فایل | باگ | رفع |
|---|---|---|---|
| 1 | `server/auth/auth.js` | `verifyPassword` re-export نمی‌شد → `POST /api/auth/password` (تغییر رمز از UI) **همیشه 500** | افزودن به `module.exports` (1 خط) |
| 2 | `server/api/custom/workflow.js` | `listProcesses` بدون بررسی مجوز → لیست Workflow برای همه کاربران (authz bypass) | `requireAdmin` (هم‌تراز با getProcess/createProcess) |
| 3 | `voip-final-e2e.mjs` | آرتیفکت‌های اجراهای قبلی → نتایج نادرست در اجراهای تکراری | بلوک pre-cleanup برای آرتیفکت‌های خودِ suite |

### یافته‌های WARNING (مستند — رفع در Stage 6 / تصمیم مدیریتی)
1. **X3:** لیبل یال Workflow بدون sanitize در canvas (innerHTML) — stored-XSS با شدت admin→admin (`processes.js:176/178` + `validateDef()`)
2. **سیاست رمز:** بدون حداقل طول در `createUser`؛ حداقل 6 کاراکتر در تغییر/ریست؛ 14 کاربر دمو با رمز مشترک `12345678` (چرخش قبل از Production)
3. **کاستی ذاتی/مستند:** token دزدیده‌شده تا expiry (2h)؛ scrypt N=16384 (argon2id توصیه می‌شود — نیازمند مهاجرت فرمت hash)

### NOT TESTED (صادقانه)
TLS واقعی روی سرور شرکت (بدون nginx) · Firewall واقعی (بدون شبکهٔ خارجی) · PBX/STS زنده · پنتست شخص ثالث

### تست
| مجموعه | نتیجه |
|---|---|
| `audit-test.mjs` (جدید — 42 چک: 25 پروب unauth، ماتریس 16 نقش×endpoint، 5 PrivEsc، 4 IDOR، 5 Session، 5 DataSecurity، 3 XSS، 2 SQLi، CSRF، Traversal، 3 Upload، 3 Log-scan) | 39 PASS + 2 WARN + 1 یافته |
| رگرسیون 8 سوئیت (final-check/customer-master-e2e/sales-chain/voip-e2e/calendar/import/scenarios/selector) | **518/518** |
| `npm audit` | **0 vulnerabilities** |

---

## 2026-08-31 — Stage 6: Final Regression & Production Package
**خروجی‌ها:** `SERVER_DEPLOYMENT.md` (راهنمای نصب 16 بخشی) · `FINAL_PRODUCTION_CHECKLIST.md` (چک‌لیست نهایی) · `baspar-crm-production.zip`

### تغییر کد در این Stage (فقط زیرساخت امنیتی — بدون Feature/Logic Change)
| فایل | تغییر |
|---|---|
| `server/server.js` | اعمال idempotent مجوزهای فایل‌سیستم در **هر استارت**: `data/` → 700 ،DB → 600 (FS snapshot ممکن است modes را ریست کند — سخت‌سازی Stage 3 با این راه همیشگی شد) |

### تست‌های Stage 6
| مجموعه | نتیجه |
|---|---|
| `integration-test.mjs` (جدید — 24 چک: 3 زنجیرهٔ کامل واقعی) | **24/24** |
| رگرسیون 8 سوئیت (final-check/customer-master×2/sales-chain/calendar/import/scenarios/selector/voip-e2e) | **528/528** |
| ui-test (65 روت) + route-test | **0 خطا / ALL VIEWS OK** |
| production-test (حالت Production واقعی: NODE_ENV+HOST=127.0.0.1) | **25/25** |
| db-security-test | **32/32** |
| security-test / audit-test | **53-54/54** · **39+2WARN+1مستند** |
| Database: integrity/FK/backup(600)/restore(kopy)/migrations | **PASS** |
| `npm audit` | **0 vulnerabilities** |

### Package
`baspar-crm-production.zip`: کد کامل + deploy templates + مستندات امنیتی/نصب + سوئیت‌های تست — **فاقد** node_modules · data/ (هیچ Secret/دیتای واقعی) · .git.

---

## 2026-09-01 — Verify نهایی: حفظ 100٪ قابلیت‌ها + Production Readiness (پس از Stage 6)
**دستور:** «قانون قطعی حفظ 100٪ تمام آیتم‌ها...» — Baseline قبل و بعد + تست کامل سلامت + Production readiness.

### ابزار جدید
| فایل | نقش |
|---|---|
| `baseline-compare.mjs` | مقایسۀ ساختاری/SHA-256 نسخهٔ زنده با **ZIP طلایی Stage 1** (قبل از هر تغییر امنیتی): فایل‌ها، API routes، Frontend routes، NAV menus، جداول/ستون‌های DB، Roles/Permissions، تعاریف بیزنس |

### نتیجهٔ مقایسه (14/14 PASS)
- **0 فایل حذف‌شده** از 131 · **16 افزودنی — همه مستند** (deploy/* + گزارش‌ها + ابزارهای تست)
- **Frontend: 42/42 فایل بایت‌به‌بایت یکسان** (صفر تغییر UI)
- **Backend: دقیقاً 5 فایل تغییرکرده = 5 اصلاح امنیتی مستند** (server.js, auth.js, workflow.js, admin.js, generic.js) — 47 فایل دیگر یکسان
- **API: 223/223 روت (صفر حذف، صفر اضافه)** · Frontend routes 62/62 · NAV یکسان
- **DB: 91/91 جدول + همهٔ ستون‌ها یکسان** · Roles/Permissions/role_permissions/user_roles یکسان · Settings: صفر حذف
- تعاریف بیزنس (Reports/Workflows/Campaigns/پورسانت/قیمت/Pipeline): سالم

### تست‌های تاز این مرحله (همه سبز)
| مجموعه | نتیجه |
|---|---|
| رگرسیون کامل (8 سوئیت + voip + integration) | **552/552** |
| ui-test (رندر زندهٔ 65 صفحه با دادهٔ واقعی) | **0 خطا** |
| baseline-compare | **14/14** |
| Production run پاک (NODE_ENV=production HOST=127.0.0.1) + production-test | **25/25** · لاگ استارت پاک |
| Performance (60 موازی) | avg 214ms · p95 334ms · **0 خطای 5xx** |
| Log scan Production | صفر uncaught/SQLITE/Secret (7 خط [error] = تست‌های منفی عمدی سوئیت) |
| npm audit | **0 vulnerabilities** |

**نتیجه: FINAL / PRODUCTION READY — با حفظ 100٪ قابلیت‌ها.**

---

## 2026-09-01 (19:10) — Stage 6 Final Verify: Finding WF-1 (Webhook Replay Bypass) — FIXED

**Severity: Medium** · **Status: FIXED + retested (Production)** · **Scope: security only — no feature change**

- **Bug:** `webhookReplayCheck()` in `server/server.js` returned `res.end(...)` (the truthy ServerResponse) in both rejection branches (stale `X-Webhook-Timestamp` / repeated `X-Webhook-Nonce`). The route guard `if (!webhookReplayCheck(req,res)) return;` therefore did NOT stop execution: the replayed/stale payload was **still processed and stored** despite the 401 response, and a second `writeHead` threw `Cannot write headers after sent` (visible in server logs).
- **Fix (2 lines):** each rejection branch now does `res.end(...); return false;` so the handler halts immediately.
- **Retest (production mode, fresh DB):**
  1. legitimate webhook (fresh nonce, valid ts) → `200 {ok:true}` + CDR stored ✅
  2. **replay** — same nonce, *different* payload → `401 REPLAY` and payload **NOT stored** (verified in DB) ✅
  3. **stale timestamp** (−2h) → `401 TIMESTAMP_STALE` and payload **NOT stored** ✅
  4. production log scan: **0** occurrences of `Cannot write headers after sent` ✅
- **Client-visible behavior unchanged** (401 codes/messages identical); only the server-side processing of rejected requests is now actually stopped.

---

## 2026-09-02 (04:30) — Stage 7: User Requests — Profile Personalization + Cross-Module Links

**Scope: additive features (user-requested). No existing behavior removed/changed. Security: self-service endpoints restricted to own record, image magic-bytes gate, traversal-safe serving, full audit trail.**

### 1) Profile personalization (self-service)
| Change | File | Notes |
|---|---|---|
| `PUT /api/me` — self-service update of own full_name/email/phone | `server/server.js` | validation (non-empty name, email/phone format) + `audit(profile_update)`. Only own record — no `:id` param → IDOR impossible |
| `POST /api/me/avatar` — avatar upload | `server/server.js` | **image magic-bytes only** (MIME untrusted), max 2MB, stored `data/uploads/avatars/` mode 600 (outside web root), random unguessable name `av-<uid>-<hex16>.<ext>` (capability URL), previous file auto-removed, `audit(avatar_update)` |
| `DELETE /api/me/avatar` — remove own avatar | `server/server.js` | removes file + clears field, `audit(avatar_remove)` |
| `GET /api/avatars/:name` — serve avatar | `server/server.js` | strict name regex + resolve-guard (traversal → 404), `nosniff` + `default-src 'none'` CSP + `no-store` |
| `publicUser()` now includes `phone` | `server/auth/auth.js` | needed for profile display; phone is non-sensitive in this CRM context (already visible in admin user list) |
| UI: «مشخصات شخصی» section in user settings modal | `public/js/main.js` | name/email/phone fields + avatar upload/preview/remove + live chrome refresh (`refreshMeChrome`) |

### 2) Cross-module linking (planning/calendar ↔ customers ↔ proforma)
| Change | File | Notes |
|---|---|---|
| Customer 360: new tabs «جلسات» + «پیگیری‌ها» | `public/js/views/customers.js` | meetings via server-side `f_customer_id` filter; followups via entity_type=customer filter (same pattern as complaint/ticket tabs) |
| `meeting.customer_id` now `filter: 1` | `server/api/resources.js` | enables server-side `f_customer_id` on meetings (parity with all other resources) |
| Proforma (quote) detail: «مشتری» link button | `public/js/views/sales.js` | quote previously showed customer name in header only; invoice/order already had the button — now consistent across all three doc types |

### Tests — `profile-crosslink-test.mjs` (28/28 PASS)
- P1–P6: profile update + validations (400s) + unauth 401
- P7–P18: avatar upload/serving/round-trip, non-image rejected (magic bytes), zero-filled fake rejected, **path traversal 404**, nonexistent 404, delete + file removed from disk, audit trail (profile_update/avatar_update/avatar_remove)
- X1–X10: customer→meeting `f_customer_id` server filter (positive+negative), customer followup list, quote↔customer link (detail + 360 tab data path), Smart Sales actions API live

### Full regression after Stage 7 (all green)
final-check 114 · customer-master-e2e 49 · customer-master-test 70 · sales-chain 80 · calendar 56 · import 34 · scenarios 41 · selector 19 · voip-e2e 65 · smartsales 33 (+2 NOT-TESTED) · integration 24 · profile-crosslink 28 = **613/613** · ui-test: 66 routes · 166 API calls · 0 failures

---

## 2026-09-02 (18:00) — Stage 7: CRM Completeness (Contacts / Dates / Meetings / Task-Rules / Smart Team) + 38-Module Acceptance

**Scope: additive features (user-requested) + bug fixes found during testing. No security control removed/weakened. Security regression: PASS (SQLi/XSS/CSRF/IDOR/Session/Secrets/Rate-Limit/Headers).**

### Additions
| Area | Change | Files |
|---|---|---|
| Migration 013 | `customer_contacts.address/notes/status` · `opportunities.next_followup_at` · `competitors` · `ideas` · permissions+grants (competitor/idea) | `server/db/migrations/013_crm_completeness.sql`, `server/db/seed.js` |
| Contacts module | Full add/edit (all fields), **duplicate detection (409 + user force-confirm)**, global searchable list `GET /api/contacts` (name/phone/email) | `server/server.js` (POST/GET), `public/js/views/customers.js` (contacts page) |
| Date/Time standard | **`public/js/datepick.js`** — Jalali Date Picker + Time Picker, fields readonly (no manual input); bound in resource-view (all generic forms) + planning forms; **backend date validation** (`normalizeDateTimeInput` in generic.js — ISO & Shamsi, garbage → 422) | `public/js/datepick.js`, `public/js/resource-view.js`, `public/js/views/planning.js`, `server/api/generic.js` |
| Pipeline | Card shows created/updated/**next follow-up (date+time, overdue highlight)**; `next_followup_at` field | `public/js/views/pipeline.js`, `server/api/custom/sales.js` (board SQL) |
| Meetings | Full real module: create/edit (customer/contact/owner/Jalali date/time/location/online link/status/result), Calendar display, **next follow-up from meeting** (real followup record) | `public/js/views/planning.js` |
| Task rules (Workflow) | New event **`opportunity_stage_changed`** + stage condition + actions (task with assignee-role/priority/due-days, followup) + rule create/edit UI | `server/api/resources.js` (workflowEvents), `public/js/views/admin.js` (ruleModal), engine `server/core/workflow.js` |
| Smart Team: tasks | Team missions (assignee/priority/due/customer) + status machine (open→in_progress→done + blocked/cancelled, invalid transitions rejected) | `server/api/custom/smartsales.js`, routes in `server/server.js`, `public/js/views/smart-sales.js` |
| Smart Team: competitor analysis | `competitors` CRUD (products/price/strengths/weaknesses/market/segments/our-advantage/threats/opportunities) + UI | same files |
| Smart Team: idea generation | `ideas` + **data-driven generator from real CRM** (churn/stalled/products/overdue-followups, citing real records; no invented data) + save/approve/reject + **idea→task** | same files |

### Bugs found & fixed during this stage
| # | Bug | Fix |
|---|---|---|
| B1 | Backend date validator rejected the picker's own ISO output (`…Z/…sssZ`) | `normalizeDateTimeInput` normalizes ISO before validation |
| B2 | Workflow engine: `entityId is not defined` — stage-change rules silently no-op'd | pass `entityId` into `runAction` |
| B3 | Contact duplicate detection never implemented on POST | full implementation + 409 + force-confirm |
| B4 | `competitors` INSERT had 10 placeholders for 15 columns | dynamic placeholders |
| B5 | `opportunity_stage_changed` missing from allowed rule events | added to `workflowEvents` |

### Tests (all green)
- **Acceptance: 154/154 — 38/38 modules PASS** (`acceptance-test.mjs`, real DB, no mocks) — see `ACCEPTANCE_REPORT.md`
- Regression: final-check 114 · customer-master-e2e 49 · customer-master-test 70 · sales-chain 80 · calendar 56 · import 34 · scenarios 41 · selector 19 · voip 65 · smartsales 33(+2 NT) · integration 24 = **585/585**
- UI: **66 routes · 133 API calls · 0 failures · 0 view errors**
- Security regression (module 38): **7/7**
