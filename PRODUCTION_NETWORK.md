# PRODUCTION NETWORK — BASPAR FOAM SMART CRM
**Stage 4 — Network & Production Hardening** · تاریخ: ۹ شهریور ۱۴۰۵ (2026-08-31)

> **استک واقعی (صادقانه):** Node.js 20 (Express-similar custom HTTP server) + **SQLite (better-sqlite3)** + Vanilla JS frontend — بدون Python و بدون SQL Server. TLS در این معماری روی **Reverse Proxy (nginx)** Terminated می‌شود و app پشت آن HTTP داخلی دارد.

## ۱) معماری هدف Production
```
Internet
   │ 443 (TLS)            80 (redirect)
   ▼                       ▼
┌─────────────────────────────────────────┐
│ nginx (Reverse Proxy + TLS termination) │   ← deploy/nginx-baspar-crm.conf
│  · HSTS/nosniff/XFO/Referrer            │
│  · client_max_body_size 30m             │
│  · rate-limit login (لبه)               │
│  · WebSocket upgrade                    │
└──────────────┬──────────────────────────┘
               │ 127.0.0.1:3000 (فقط loopback)
┌──────────────▼──────────────────────────┐
│ node server/server.js  (HOST=127.0.0.1) │   ← deploy/baspar-crm.service
│  · JWT + refresh tokens                 │
│  · permission/scope engine              │
│  · scheduler (بکاپ روزانه 02:00)       │
│  · WebSocket hub                        │
└──────────────┬──────────────────────────┘
               │ فایل (بدون پورت شبکه)
   /var/lib/baspar-crm/baspar-crm.sqlite   ← mode 600 · data/ mode 700 · خارج web root
   /var/lib/baspar-crm/backups|uploads|recordings
```

**خروجی‌های شبکهٔ عمومی: فقط 80 و 443.** پورت 3000 روی loopback است. دیتابیس فایل محجور است → **پورت/کانال شبکهٔ DB وجود ندارد** (exposure شبکه‌ای DB = صفر به‌صورت ساختاری؛ تست E1/E2 در Stage 3 تأیید کرد).

## ۲) HTTPS / TLS
- TLS **روی nginx** Terminated می‌شود (گواهی Let's Encrypt/ACME) — تنظیمات: `TLSv1.2/1.3`، cipherهای مدرن، session cache، `ssl_session_tickets off`.
- **HTTP → HTTPS:** `return 301 https://$host$request_uri;`
- app `X-Forwarded-Proto` را می‌خواند (Stage 2): کوکی‌ها پشت TLS به‌درستی `Secure` می‌شوند (تست K3).
- **HSTS:** هم در app (`max-age=31536000; includeSubDomains`) و هم در nginx — بعد از اولین پاسخ HTTPS، مرورگر فقط HTTPS قبول می‌کند.

## ۳) Secure Headers (فعال در app — Stage 2؛ nginx defense-in-depth)
| Header | مقدار |
|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`* |
| X-Frame-Options | `DENY` (env `X_FRAME_OPTIONS` قابل تنظیم — *در Preview سنبوکس ALLOWALL است چون اپ در iframe می‌جاسازد؛ Production = DENY) |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` (هم روی پاسخ‌ها و هم فایل‌های استاتیک/پیوست) |
| Referrer-Policy | `no-referrer` |
| Permissions-Policy | `camera=(self), microphone=(self), geolocation=(self)` |
| X-XSS-Protection | `0` (غیرفعال‌سازی auditor قدیمی — best practice) |

\* `'unsafe-inline'` برای script/style به‌دلیل اسکریپت inline صفحهٔ boot است (فرانت فریز است — در Stage 2 مستند شد).

## ۴) CORS
**CORS باز وجود ندارد** — API فقط same-origin پاسخ می‌دهد (بدون `Access-Control-Allow-Origin`). به‌علاوه، چک Origin برای POST/PUT/DELETE/PATCH: مبدأ متفاوت از Host → `403 ORIGIN_MISMATCH` (CSRF defense-in-depth، Stage 2). کلاینت‌های native بدون Origin مجازند.

## ۵) Secure Cookies (Stage 2)
- `bfc_access` / `bfc_refresh`: `HttpOnly` + `SameSite=Lax` + **`Secure` فقط وقتی پشت TLS** (تشخیص از `X-Forwarded-Proto`) — روی HTTP ساده Secure ارسال نمی‌شود تا توسعهٔ محلی خراب نشود.
- Refresh token در DB فقط به‌صورت **hash (SHA-256)** نگهداری می‌شود.

## ۶) Production Configuration
| مورد | وضعیت |
|---|---|
| `NODE_ENV=production` | بک‌بانر PRODUCTION؛ هیچ رفتار debug/verbose در کد وجود ندارد (بررسی شد — غیرقابل‌فعال‌سازی نیست چون اصلاً وجود ندارد) |
| Development server | ندارد — `node server/server.js` همان سرور Production است (Node http) |
| Errorهای داخلی | 500 → پیام عمومی فارسی؛ Stack Trace **فقط در لاگ سرور**، هرگز در پاسخ (تست E1-E3) |
| Bind host | `HOST=127.0.0.1` در Production (پیش‌فرض 0.0.0.0 فقط برای dev/sandbox) |
| پورت‌ها | فقط 3000 (loopback) + 80/443 روی nginx |
| CORS | same-origin فقط (بخش ۴) |
| Request size | سقف 30MB با قطع اتصال فوری (DoS protection، تست Z1) |
| Rate limiting | 300 req/min/IP (API) + 10 login/min/IP (app) + `limit_req` روی login در nginx (لبه) |

## ۷) Environment Variables (بدون Secret در سورس)
فایل نمونه: **`deploy/env.example`** (فقط placeholder). مقدار واقعی در `/etc/baspar-crm/env` با `chmod 600` — توسط `EnvironmentFile=` در systemd لود می‌شود (بدون dependency dotenv).

| متغیر | کاربرد | Production |
|---|---|---|
| `NODE_ENV` | حالت اجرا | `production` |
| `PORT` | پورت داخلی | `3000` |
| `HOST` | bind address | **`127.0.0.1`** |
| `TZ` | منطقه زمانی | `Asia/Tehran` |
| `DB_PATH` | مسیر فایل DB | `/var/lib/baspar-crm/baspar-crm.sqlite` |
| `DATA_DIR` | ریشه دیتا (آپلود/ضبط/بکاپ) | `/var/lib/baspar-crm` |
| `JWT_SECRET` | کلید امضای JWT (env بر DB برتری دارد) | `openssl rand -hex 32` |
| `X_FRAME_OPTIONS` | clickjacking policy | `DENY` |
| `SEED_DEMO` | Seed دیتای دمو (فقط نصب تازه) | `1` |

## ۸) Service Management (systemd)
فایل: **`deploy/baspar-crm.service`** — کاربر اختصاصی `baspar`، `Restart=always`، hardening:
`NoNewPrivileges`، `PrivateTmp`، `ProtectSystem=full`، `ProtectHome`، `ProtectKernel*`، `RestrictSUIDSGID`، `RestrictRealtime`، `LockPersonality`، `ReadWritePaths=/var/lib/baspar-crm` (فقط دیتا writable)، و `IPAddressDeny=any` + `IPAddressAllow=127.0.0.1 ::1` (اپ اصلاً نمی‌تواند به شبکهٔ عمومی وصل شود).
مانیتوریng: `systemd-analyze security baspar-crm` · `journalctl -u baspar-crm -f`

## ۹) Health Check
**`GET /health`** (و `/healthz`) — بدون احراز هویت، بدون دادهٔ حساس:
```json
{ "status": "ok", "db": true, "uptime_sec": 12345, "time": "2026-08-31T10:00:00.000Z" }
```
- `200` = سالم · `503` = دیتابیس در دسترس نیست (degraded)
- nginx بلوک `location = /health` بدون rate-limit و بدون access_log دارد (برای LB/monitoring).
- نمونه: `curl -fsS https://<domain>/health` · در cron/monitor: هشدار اگر دو بار متوالی 503 بدهد.

## ۱۰) Logging
- **Application log:** stdout/stderr → **journald** (systemd) — `journalctl -u baspar-crm`؛ چرخش خودکار journald (`SystemMaxUse=500M` در `/etc/systemd/journald.conf`).
- **لاگ‌های امنیتی در DB:** `audit_logs` (ورود/خروج/ورود ناموفق/رد مجوز/تغییرات/بکاپ) + `ai_logs` + `webhooks_log` — **رمز/API Key هرگز لاگ نمی‌شود** (Stage 2/3).
- **nginx access/error logs:** `/var/log/nginx/baspar-crm.*` + logrotate پیش‌فرض.
- **بدون فاش‌سازی Stack Trace در پاسخ کاربر** (Stage 2) — Stack فقط در لاگ سرور.

## ۱۱) Backup Configuration
- **خودکار:** بکاپ کامل DB روزانه ساعت **02:00 (تهران)** توسط scheduler داخلی → `/var/lib/baspar-crm/backups/baspar-backup-<stamp>.sqlite` (mode **600**، خارج web root).
- **Retention:** پیش‌فرض **30 روز** (`settings.backup_retention_days` قابل تنظیم) — پاک‌سازی با audit `retention_purge` (Stage 3).
- **دستی:** `POST /api/admin/backups` (فقط super_admin) · دانلود `GET /api/admin/backups/:id/download` (فقط super_admin + گارد مسیر) · restore با `restart_required`.
- **توصیهٔ 3-2-1:** حداقل یک کپی از بکاپ‌ها روزانه به سرور/بکاپ آفلاین دیگر کپی شود (rsync/restic خارج از سرور) — بکاپ روی همین دیسک، ریسک از دست‌رفتی سرور را پوشش نمی‌دهد.
- **Restore Test (ماهانه):** `PRAGMA integrity_check` روی بکاپ + بازیابی روی محیط تست (مستند در SERVER_DEPLOYMENT.md — Stage 6).

## ۱۲) Firewall / Network
فایل: **`deploy/firewall-rules.md`** — خلاصه:
- عمومی: فقط `80/tcp` (redirect) و `443/tcp` · `22/tcp` فقط IPهای مجاز مدیریت.
- `3000/tcp`: bind loopback + `DROP` در فایروال (defense-in-depth).
- **دیتابیس پورت شبکه ندارد** (فایل SQLite) — چیزی برای expose نکردن هست؛ اگر DB شبکه‌ای دیگری روی سرور است: localhost-only.

## ۱۳) تست‌های Production (انجام‌شده در این Stage)
| تست | نتیجه |
|---|---|
| `production-test.mjs` (جدید — 24 چک) | **24/24 PASS** ✅ |
| Health endpoint (200/ok + db:true؛ 503 در حالت degraded) | ✅ |
| TLS-simulated: `X-Forwarded-Proto: https` → کوکی `Secure` | ✅ |
| Secure Headers کامل روی همهٔ پاسخ‌ها (API + static + health) | ✅ |
| Login/Session/Logout + JWT + refresh (حالت Production) | ✅ |
| Database connection (health db:true + CRUD) | ✅ |
| Error handling (400/403/404/429/500 — بدون Stack Trace) | ✅ |
| Bind `HOST=127.0.0.1` (فقط loopback قابل‌دسترسی) | ✅ |
| CSRF/Origin check فعال در Production | ✅ |
| Regression: final-check.js (114) | **114/114** ✅ |

## ۱۴) فهرست فایل‌های Stage 4
| فایل | نوع |
|---|---|
| `deploy/env.example` | **جدید** — template محیط (بدون Secret) |
| `deploy/nginx-baspar-crm.conf` | **جدید** — Reverse Proxy + TLS |
| `deploy/baspar-crm.service` | **جدید** — systemd + hardening |
| `deploy/firewall-rules.md` | **جدید** — قوانین ufw/iptables + راستی‌آزمایی |
| `PRODUCTION_NETWORK.md` | **جدید** — این مستند |
| `server/server.js` | تغییر — Health endpoint + env `HOST` + بک‌بانر Production (additive، بدون تغییر API/رفتار) |
| `production-test.mjs` | **جدید** — سوئیت تست Production |

## ۱۵) موارد نیازمند اقدام روی سرور شرکت (در سنبوکس قابل انجام نبود — صادقانه)
1. نصب nginx + صدور گواهی TLS برای دامنهٔ شرکت (مسیر گواهی در template جای‌گذاری شده).
2. تنظیم `server_name` و مسیر گواهی‌ها در `nginx-baspar-crm.conf`.
3. اعمال قوانین فایروال (IPهای مجاز مدیریت را در `firewall-rules.md` جای‌گذاری کنید).
4. قرار دادن مقادیر واقعی Secrets در `/etc/baspar-crm/env` (chmod 600).
5. تست واقعی `nginx -t` و بارگذاری — در این سنبوکس nginx نصب نیست؛ syntax template مطابق مستندات رسمی nginx نوشته شده ولی **باید روی سرور با `nginx -t` تأیید شود**.
