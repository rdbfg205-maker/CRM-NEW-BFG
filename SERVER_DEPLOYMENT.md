# SERVER DEPLOYMENT — BASPAR FOAM SMART CRM (Production)
**Stage 6 — راهنمای نصب روی سرور شرکت** · 2026-08-31
استک: **Node.js 20 + Express-similar + SQLite (better-sqlite3)** · فرانت: Vanilla JS ESM (بدون build step)

> این راهنما برای استک **واقعی پروژه** نوشته شده است (Python/SQL Server در این پروژه وجود ندارد).

## ۰) خلاصهٔ معماری
```
Internet ──► nginx (80→redirect / 443 TLS) ──► 127.0.0.1:3000 ──► node server/server.js
                                                          │
                                              /var/lib/baspar-crm/baspar-crm.sqlite (mode 600)
                                              /var/lib/baspar-crm/{backups,uploads,recordings}
```
- پورت‌های عمومی: **فقط 80 و 443** (+ 22 فقط از IPهای مجاز).
- دیتابیس: **فایل SQLite** — پورت شبکه ندارد؛ exposure شبکه‌ای صفر است.
- Health: `GET /health` → `{"status":"ok","db":true,...}` (503 اگر DB در دسترس نباشد).

## ۱) پیش‌نیازها
| مورد | نسخه | نصب |
|---|---|---|
| Node.js | **20.x LTS** | `apt install nodejs` یا nodesource |
| nginx | 1.22+ | `apt install nginx` |
| certbot (Let's Encrypt) | — | `apt install certbot python3-certbot-nginx` |
| ufw | — | `apt install ufw` |

## ۲) کاربر و دایرکتوری‌ها
```bash
sudo useradd -r -s /usr/sbin/nologin baspar
sudo mkdir -p /opt/baspar-crm /var/lib/baspar-crm /etc/baspar-crm
sudo chown -R baspar:baspar /opt/baspar-crm /var/lib/baspar-crm
sudo chmod 700 /var/lib/baspar-crm /etc/baspar-crm
```

## ۳) انتقال کد (از ZIP تولیدشده)
```bash
# روی سرور:
sudo mkdir -p /opt/baspar-crm
sudo unzip baspar-crm-production.zip -d /opt/baspar-crm
sudo chown -R baspar:baspar /opt/baspar-crm
# ZIP فاقد node_modules است (به‌صورت امن روی سرور نصب می‌شود):
cd /opt/baspar-crm && sudo -u baspar npm ci --omit=dev --no-audit --no-fund
```
> **نکتهٔ وابستگی `xlsx`:** نسخهٔ 0.20.3 از CDN رسمی SheetJS نصب می‌شود (در package.json به‌صورت tarball). اگر سرور بدون اینترنت است، قبل از ارسال، `npm ci` را روی یک دستگاه آنلاین انجام و `node_modules` را جداگانه (خارج از ZIP عمومی) منتقل کنید.

## ۴) تنظیم Environment (Secrets — خارج از کد و ZIP)
```bash
sudo -u baspar cp /opt/baspar-crm/deploy/env.example /etc/baspar-crm/env
sudo -u baspar chmod 600 /etc/baspar-crm/env
sudo nano /etc/baspar-crm/env
```
| متغیر | مقدار پیشنهادی |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `HOST` | **`127.0.0.1`** (فقط loopback) |
| `TZ` | `Asia/Tehran` |
| `DB_PATH` | `/var/lib/baspar-crm/baspar-crm.sqlite` |
| `DATA_DIR` | `/var/lib/baspar-crm` |
| `JWT_SECRET` | خروجی `openssl rand -hex 32` |
| `X_FRAME_OPTIONS` | `DENY` |

## ۵) دیتابیس
- **نصب اولیه:** دیتابیس به‌صورت خودکار در اولین اجرا ساخته و Seed می‌شود (13 Migration + نقش‌ها + دیتای دمو) — نیازی به اقدام دستی نیست.
- **مهاجرت از نسخهٔ قدیمی:** فایل `baspar-crm.sqlite` قدیمی (با WAL) را در `/var/lib/baspar-crm/` قرار دهید؛ Migrationهای جدید در استارت اعمال می‌شوند. **حتماً قبل از کپی، بکاپ بگیرید (بخش ۱۲).**
- **اعتبارنامه اولیه:** `admin / admin1234` — سیستم در اولین ورود **اجباری تغییر رمز** می‌کند (`must_change_password`).
- کاربران دمو با رمز مشترک `12345678` هستند — **پس از اولین ورود، رمز همه را عوض کنید** یا دیتای دمو را از پنل Admin حذف کنید.

## ۶) TLS / HTTPS
```bash
# با nginx.conf بخش ۷ اعمال‌شده:
sudo certbot --nginx -d crm.yourcompany.com -m admin@yourcompany.com --agree-tos --redirect
# تمدید خودکار:
sudo systemctl list-timers | grep certbot
```
- cipherها/پروتکل‌ها در `deploy/nginx-baspar-crm.conf` (TLSv1.2/1.3) تنظیم شده‌اند.
- کوکی‌های Session پشت TLS به‌درستی `Secure` می‌شوند (اپ `X-Forwarded-Proto` را می‌خواند — تست‌شده).
- HSTS: هم در اپ (`max-age=31536000; includeSubDomains`) و هم در nginx.

## ۷) Reverse Proxy (nginx)
```bash
sudo cp /opt/baspar-crm/deploy/nginx-baspar-crm.conf /etc/nginx/sites-available/baspar-crm.conf
# تغییرات لازم داخل فایل:
#   1) server_name → دامنهٔ واقعی
#   2) ssl_certificate / ssl_certificate_key → مسیر گواهی‌ها
#   3) بلوک map $http_upgrade → به سطح http (nginx.conf) منتقل شود
sudo ln -s /etc/nginx/sites-available/baspar-crm.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
محتوای اصلی: redirect HTTP→HTTPS، `server_tokens off`، headers امنیتی، `client_max_body_size 30m`، **rate-limit روی login** (`limit_req`)، **WebSocket upgrade** (هاب پیام‌رسانی لحظه‌ای)، بلوک `/health` برای LB/monitoring.

## ۸) Firewall
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from <IP-مدیریت> to any port 22 proto tcp   # فقط IPهای مجاز
sudo ufw deny 3000/tcp                                     # دفاع عمیق: حتی اگر bind اشتباه شود
sudo ufw enable && sudo ufw status verbose
```
(معادل iptables: `deploy/firewall-rules.md`)

## ۹) اجرای Backend (systemd)
```bash
sudo cp /opt/baspar-crm/deploy/baspar-crm.service /etc/systemd/system/baspar-crm.service
# ویرایش: مسیرها مطابق بخش ۲ (پیش‌فرض‌ها همین‌ها هستند)
sudo systemctl daemon-reload
sudo systemctl enable --now baspar-crm
systemctl status baspar-crm
```
Service شامل hardening است: `NoNewPrivileges`، `PrivateTmp`، `ProtectSystem=full`، `ProtectHome`، `ReadWritePaths=/var/lib/baspar-crm`، و **`IPAddressDeny=any` + `IPAddressAllow=127.0.0.1 ::1`** (اپ اصلاً نمی‌تواند به شبکهٔ عمومی وصل شود).
- مانیتور: `sudo systemd-analyze security baspar-crm`
- لاگ: `journalctl -u baspar-crm -f`

## ۱۰) Frontend
فرانت **build ندارد** — فایل‌های استاتیک از همین Node سرو می‌شوند و nginx همهٔ درخواست‌ها را به `127.0.0.1:3000` forward می‌کند (در nginx.conf تنظیم شده). Service Worker (PWA/آفلاین) خودش در `/sw.js` است.

## ۱۱) Health Check
```bash
curl -fsS http://127.0.0.1:3000/health      # داخلی
curl -fsSI  https://crm.yourcompany.com/health   # بیرونی
# برای monitoring (prometheus/blackbox): هر 30 ثانیه؛ 2 بار 503 متوالی = هشدار
```
فیلد `db:true` = اتصال دیتابیس سالم.

## ۱۲) Backup / Restore
**خودکار:** بکاپ کامل DB هر شب ساعت **02:00 (تهران)** توسط scheduler داخلی → `/var/lib/baspar-crm/backups/baspar-backup-<stamp>.sqlite` (mode **600**، خارج از web root) با **Retention 30 روز** (قابل تنظیم از `settings.backup_retention_days` — از پنل Admin یا مستقیم در settings) و audit `retention_purge`.

**خارج از سرور (الزامی — قانون 3-2-1):**
```bash
# روی سرور بکاپ (crontab کاربر baspar یا restic/borg):
0 3 * * * rsync -a /var/lib/baspar-crm/backups/ backup-server:/var/backups/baspar-crm/
```

**دستی:** از پنل Admin → Backup (فقط super_admin) یا خط فرمان:
```bash
sudo -u baspar node -e "require('/opt/baspar-crm/server/db/db').open(); const {execSync}=require('child_process'); ..."
# یا ساده‌تر با sqlite3:
sudo -u baspar sqlite3 /var/lib/baspar-crm/baspar-crm.sqlite ".backup /var/lib/baspar-crm/backups/manual-$(date +%F).sqlite"
```

**Restore (تست‌شده در Stage 6 روی کپی — روی DB زنده نیاز به restart دارد):**
```bash
sudo systemctl stop baspar-crm
sudo cp /var/lib/baspar-crm/backups/<file>.sqlite /var/lib/baspar-crm/baspar-crm.sqlite
sudo rm -f /var/lib/baspar-crm/baspar-crm.sqlite-wal /var/lib/baspar-crm/baspar-crm.sqlite-shm
sudo chown baspar:baspar /var/lib/baspar-crm/baspar-crm.sqlite && sudo chmod 600 /var/lib/baspar-crm/baspar-crm.sqlite
# راستی‌آزمایی:
sudo -u baspar sqlite3 /var/lib/baspar-crm/baspar-crm.sqlite "PRAGMA integrity_check; PRAGMA foreign_key_check;"
sudo systemctl start baspar-crm
curl -fsS http://127.0.0.1:3000/health
```
**تست Restore ماهانه** را در crontab بگذارید (کپی بکاپ → integrity_check روی محیط تست).

## ۱۳) Logging
| لاگ | مکان | چرخش |
|---|---|---|
| Application | journald (`journalctl -u baspar-crm`) | `/etc/systemd/journald.conf` → `SystemMaxUse=500M` |
| nginx | `/var/log/nginx/baspar-crm.{access,error}.log` | logrotate پیش‌فرض |
| امنیتی (در DB) | `audit_logs` (ورود/خروج/ورود ناموفق/رد مجوز/تغییرات/بکاپ) + `ai_logs` + `webhooks_log` | نگهداری با خود DB؛ **رمز/API Key/Token هرگز لاگ نمی‌شود** (تست‌شده) |

## ۱۴) به‌روزرسانی (Upgrade)
```bash
sudo systemctl stop baspar-crm
sudo sqlite3 /var/lib/baspar-crm/baspar-crm.sqlite ".backup /var/lib/baspar-crm/backups/pre-upgrade-$(date +%F).sqlite"
cd /opt/baspar-crm && sudo unzip -o <new-zip> && sudo chown -R baspar:baspar .
sudo -u baspar npm ci --omit=dev --no-audit --no-fund
sudo systemctl start baspar-crm    # Migrationهای جدید خودکار اعمال می‌شوند
curl -fsS http://127.0.0.1:3000/health
```

## ۱۵) تست نهایی بعد از نصب (Checklist)
```bash
# 1) health
curl -fsS http://127.0.0.1:3000/health | grep '"status":"ok"'
# 2) HTTP → HTTPS redirect
curl -sI http://crm.yourcompany.com/ | grep -i "location: https"
# 3) headers
curl -sI https://crm.yourcompany.com/ | grep -iE "strict-transport|x-frame|content-security|x-content-type"
# 4) login + تغییر اجباری رمز
# (مرورگر: ورود با admin → سیستم رمز جدید می‌خواهد)
# 5) پورت‌ها
sudo ss -ltnp | grep -E ':(80|443|3000|22)\b'   # 3000 فقط 127.0.0.1
nc -vz <server-ip> 3000                          # باید بسته باشد
# 6) بکاپ خودکار (فردا صبح)
ls -la /var/lib/baspar-crm/backups/ | head
# 7) سرویس‌ها
systemctl status baspar-crm nginx
# 8) UI: داشبورد، یک مشتری، یک فاکتور، گزارش، VoIP settings — مرور سریع
```

## ۱۶) فهرست فایل‌های بستهٔ Production
| فایل | کاربرد |
|---|---|
| `server/` ، `public/` | Backend + Frontend (کامل) |
| `package.json` + `package-lock.json` | Dependencies (نصب با `npm ci --omit=dev`) |
| `server/db/migrations/` + `server/db/seed.js` | Database Scripts (13 Migration + Seed — خودکار) |
| `deploy/env.example` | Environment Template (بدون Secret) |
| `deploy/nginx-baspar-crm.conf` | Production Configuration (Reverse Proxy + TLS) |
| `deploy/baspar-crm.service` | Service Management (systemd + hardening) |
| `deploy/firewall-rules.md` | Firewall |
| `SERVER_DEPLOYMENT.md` | همین راهنما |
| `PRODUCTION_NETWORK.md` | مستند شبکه/Production (Stage 4) |
| `SECURITY_AUDIT_REPORT.md` | گزارش Security Audit (Stage 5) |
| `FINAL_PRODUCTION_CHECKLIST.md` | چک‌لیست نهایی PASS/FAIL (Stage 6) |
| `SECURITY_CHANGELOG.md` | تاریخچهٔ تغییرات امنیتی (Stages 2–6) |
| `VOIP-REPORT.md` ، `README.md` | مستندات VoIP + راهنمای کلی |
| `*-test.mjs` / `*.js` (ریشه) | سوئیت‌های تست (اجرا روی سرور برای راستی‌آزمایی اختیاری) |
| `SERVER_DEPLOYMENT.md` §۱۷ | راهنمای نصب Windows |

## ۱۷) نصب روی Windows Server (Production)

> معادل Windows برای بخش‌های ۲ تا ۱۲ (Linux). همهٔ مقادیر Environment همانند Linux از **خارج از کد/ZIP** تنظیم می‌شوند.

### ۱۷.۱) پیش‌نیازها
- **Node.js LTS** (x64) از nodejs.org — نصب System-wide
- **C++ Build Tools** یا استفاده از باینری پیش‌ساختهٔ `better-sqlite3` (نسخهٔ LTS معمولا نیازی به کامپایل ندارد)
- (اختیاری) **NSSM** (nssm.cc) برای اجرای Node به‌عنوان Windows Service — یا Task Scheduler

### ۱۷.۲) دایرکتوری و کاربر
1. کاربر محلی اختصاصی بسازید: `New-LocalUser -Name baspar -Password (ConvertTo-SecureString 'ChangeMe123!' -AsPlainText) -FullName 'Baspar CRM Service'`
2. کد را در `C:\baspar\baspar-crm` کپی کنید (بدون `node_modules` و `data/`)
3. مجوزها:
   ```powershell
   icacls C:\baspar\baspar-crm /grant baspar:(OI)(CI)M
   mkdir C:\baspar\data
   icacls C:\baspar\data /grant baspar:(OI)(CI)F
   ```

### ۱۷.۳) Dependencies (روی سرور)
```powershell
cd C:\baspar\baspar-crm
npm ci --omit=dev
```

### ۱۷.۴) Environment (Secrets — خارج از کد)
با NSSM (پیشنهادی):
```powershell
nssm install baspar-crm "C:\Program Files\nodejs\node.exe" "C:\baspar\baspar-crm\server\server.js"
nssm set baspar-crm AppDirectory C:\baspar\baspar-crm
nssm set baspar-crm AppEnvironmentExtra "NODE_ENV=production" "HOST=127.0.0.1" "PORT=3000" "DATA_DIR=C:\baspar\data" "JWT_SECRET=<long-random>"
nssm set baspar-crm Start SERVICE_AUTO_START
nssm start baspar-crm
# بررسی:
sc.exe query baspar-crm
```
با Task Scheduler (بدون NSSM): task جدید → Action: `node` → Arguments: `C:\baspar\baspar-crm\server\server.js` → Start in: `C:\baspar\baspar-crm` → Environment: همان متغیرهای بالا؛ Trigger: At startup + Run whether user is logged on or not + Run with highest privileges.

> `JWT_SECRET` و (در صورت نیاز) `BACKUP_KEY` هرگز در کد، ZIP یا دیتابیس ذخیره نشوند.

### ۱۷.۵) Firewall (Windows Defender Firewall)
```powershell
New-NetFirewallRule -DisplayName "baspar-crm-internal" -Direction Inbound -LocalPort 3000 -RemoteAddress 127.0.0.1 -Action Allow
# اگر Reverse Proxy روی همین هاست است، پورت 443/80 فقط برای proxy باز می‌ماند؛ پورت 3000 به اینترنت بسته می‌ماند.
```

### ۱۷.۶) Reverse Proxy / TLS (Windows)
- **IIS** با Application Request Routing (ARR) + URL Rewrite: Site `baspar.example.com` (TLS) → Inbound rule `http://*:443/*` → `http://127.0.0.1:3000/{R:1}`
- یا **Caddy for Windows** (ساده‌ترین گزینه، TLS خودکار):
  ```
  baspar.example.com {
      reverse_proxy 127.0.0.1:3000
  }
  ```

### ۱۷.۷) Health Check و Backup (Windows)
- Health: `Invoke-RestMethod http://127.0.0.1:3000/health` — انتظار `{ "status":"ok", "db":true }`
- Backup خودکار: همان تنظیمات داخل اپ (Admin ← Backup) + (اختیاری) Task Scheduler برای بکاپ فایلی `C:\baspar\data\baspar-crm.sqlite` به NAS (robocopy/restic)
- Log‌ها: NSSM `nssm set baspar-crm AppStdout / AppStderr` → فایل؛ یا PowerShell Transcription برای Task Scheduler


**فاقد از بسته:** `node_modules/` · `data/` (دیتابیس/آپلود/بکاپ — هیچ Secret یا دیتای واقعی در ZIP نیست) · `.git/`
