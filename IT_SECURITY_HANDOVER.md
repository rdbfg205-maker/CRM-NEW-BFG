# IT SECURITY HANDOVER — BASPAR FOAM SMART CRM
**بازگشتری امنیتی به تیم IT شرکت · 2 مهر ۱۴ (2026-09-02)**
**استک: Node.js 20 + SQLite (better-sqlite3) · فرانت Vanilla JS ESM · بدون فریم‌ورک build**

---

## ۱) معماری امنیتی (Security Architecture)

```
Internet ──► nginx (80→443 TLS, HSTS, rate-limit, headers)
              └──► 127.0.0.1:3000 ──► node server/server.js (NODE_ENV=production, HOST=127.0.0.1)
                                          └── /var/lib/baspar-crm/baspar-crm.sqlite (mode 600)
```

- **سطح شبکه**: اپ فقط روی loopback listen می‌کند؛ تنها دروازهٔ عمومی nginx است (فایروال 3000 را deny می‌کند — defense in depth).
- **سطح اپلیکیشن**: احراز هویت JWT (access 2h + refresh با rotation/revocation) · مجوزها per-entity/per-action/per-scope (all/own) · rate-limit (login 10/min/IP، عمومی 300/min/IP) · Origin check (CSRF) · Security Headers.
- **سطح داده**: SQLite فایل‌محجور (بدون پورت شبکه) · همهٔ کوئری‌ها parameterized · backups mode 600 خارج web root · رمزنگاری اختیاری AES-256-GCM.

## ۲) کنترل‌های امنیتی فعال (همه تست‌شده)

| کنترل | مکان | وضعیت |
|---|---|---|
| JWT امضا + expiry + refresh rotation/revocation | `server/auth/auth.js` | ✅ تست |
| Rate Limiting (login 10/min، API 300/min) | `server/lib/http.js` → `server/server.js` | ✅ تست (429) |
| CSRF: Origin check برای POST/PUT/DELETE | `server/server.js` (middleware) | ✅ تست (403 ORIGIN_MISMATCH) |
| Security Headers: CSP/HSTS/XFO/nosniff/Referrer/Permissions-Policy | `server/server.js` | ✅ تست |
| SQL Injection: parameterized سراسری (better-sqlite3) | کل `server/` | ✅ تست (پروب UNION/stacked → 404 بدون نشت) |
| XSS: فرانت DOM API (textContent/`el()`) + `esc()` در چاپ | `public/js/` + `server/lib/print.js` | ✅ آویدیت + پروب |
| IDOR: row-scope (own/all) در list/update/delete + مسیرهای زیرمجموعه | `server/api/generic.js` | ✅ تست (403/404) |
| Authorization: ماتریس نقش×action×scope + requireAdmin برای Workflow/Admin | `server/auth/auth.js` | ✅ تست (ماتریس 16 + PE) |
| File Upload: magic-bytes (PNG/JPEG/WebP) + سقف 30MB + نام رندوم + mode 600 | `server/server.js` | ✅ تست (فایل جعلی → 400) |
| File Serving: خارج web root + basename guard + nosniff + attachment | `server/server.js` | ✅ تست (traversal → 404) |
| Secrets: env-only (JWT_SECRET/BACKUP_KEY) · masked در پاسخ‌ها (`••••`) · hash در DB | `server/lib/crypto.js`, `settings` | ✅ اسکن: صفر در source/ZIP |
| Webhook Security: shared secret + **timestamp ±5min + nonce replay protection** | `server/server.js` (webhookReplayCheck) | ✅ تست (stale/replay → 401 + **عدم پردازش payload** — رفع WF-1) |
| Error Handling: JSON تمیز، بدون stack trace، پیام 401 عمومی (بدون enumeration) | `sendError` | ✅ تست |
| Audit Log: ورود/خروج/ورود ناموفق/تغییرات/بکاپ/Workflow/Restore — غیرقابل حذف توسط کاربران عادی | `audit_logs` | ✅ تست |
| Session Cookies: HttpOnly + SameSite=Lax + Secure پشت TLS | `server/auth/auth.js` | ✅ تست (TLS-simulated) |
| Backup Security: mode 600، خارج public، رمزنگاری اختیاری، permission محدود، audit | `admin.js` | ✅ تست |
| Production: bind loopback، بدون debug، `npm audit` = 0 | — | ✅ production-test 25/25 |

## ۳) Secret‌ها — محل و نحوهٔ مدیریت

| Secret | محل | نحوهٔ تنظیم |
|---|---|---|
| `JWT_SECRET` | `/etc/baspar-crm/env` (chmod 600) یا env | `openssl rand -hex 32` — اگر خالی باشد، کلید در DB ساخته می‌شود (سازگاری) — **توصیه: env** |
| `BACKUP_KEY` (اختیاری — رمزنگاری بکاپ) | env سرور (systemd `Environment=` یا env file) | `openssl rand -hex 32` — **هرگز در Git/ZIP/DB ذخیره نشود** |
| VoIP webhook secret | settings (DB، encrypted at rest با `enc:`) | از پنل Admin → VoIP — در پاسخ‌ها masked |
| AI API key (اختیاری) | settings (DB، encrypted) | از پنل Admin → AI |

**قوانین**: هیچ Secret در source/ZIP نیست (اسکن‌شده). لاگ‌ها را برای `Bearer|token|secret|password` اسکن کنید — باید صفر باشد (تست شد).

## ۴) Monitoring و Log

- **Application log**: journald (`journalctl -u baspar-crm -f`) — خطای [error] = ورودی‌های نامعتبر/تست‌های منفی (بررسی‌پذیر)، خطای [security] = بلوک‌های امنیتی (replay/origin).
- **Audit trail**: `audit_logs` (Admin → گزارش ممیزی) — چه کسی/چه کاری/چه زمانی + مقادیر قبل/بعد.
- **Health**: `GET /health` → `{status, db, uptime}` — برای monitoring (503 در حالت degraded).
- **نکاه‌های توصیه‌شده**: 429های مکرر login (brute-force) · [security] replay-blocked · 5xx در log · حجم/فایل بکاپ.

## ۵) Incident Response — اقدامات فوری

| حادثه | اقدام |
|---|---|
| شک به سرقت Token | Admin → کاربر: تغییر رمز (جلسه‌ها/refreshها با logout/تغییر رمز revoke می‌شوند) |
| شک به تغییر داده | از `audit_logs` ردیابی کنید (کاربر/زمان/مقدار) → Restore از آخرین بکاپ سالم (`BACKUP_RESTORE_GUIDE.md`) |
| Bکاپ خراب | از بکاپ قبلی در تاریخچه (آخرین موفق) → integrity check → restore |
| نیاز به حذف کل سیستم | stop service → حذف `/var/lib/baspar-crm` + `/opt/baspar-crm` → **اسم `BACKUP_KEY`/`JWT_SECRET` را هم تغییر دهید** |

## ۶) Checklist ماهانه (توصیه)

- [ ] `PRAGMA integrity_check` روی بکاپ جدید
- [ ] بررسی آخرین بکاپ موفق + کپی خارج از سرور (قانون 3-2-1)
- [ ] اسکن log برای [security] و 429 مکرر
- [ ] بررسی audit log برای عملیات حساس (restore/تغییر نقش/حذف)
- [ ] `npm audit` در سرور (پیش از هر upgrade)
- [ ] تست Restore روی محیط جدا (نه سرور زنده)

## ۷) موارد NOT TESTED در سنبوکس (وظیفهٔ استقرار)

- TLS واقعی (certbot + `nginx -t`) · Firewall واقعی (ufw) · PBX فیزیکی · پنتست شخص ثالث — همه با template/راهنمای کامل در `deploy/` و `SERVER_DEPLOYMENT.md` جبران شده‌اند.
