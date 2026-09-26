# BACKUP / RESTORE GUIDE — BASPAR FOAM SMART CRM
**راهنمای پشتیبان‌گیری و بازیابی · 2 مهر ۱۴ (2026-09-02)**

## ۱) مدل بکاپ

- **نوع**: کپی سازگار از فایل SQLite (WAL checkpoint + copy) — **بکاپ واقعی** (نه UI نمایشی)
- **فایل**: `baspar-backup-<YYYY-MM-DDTHH-MM-SS>.sqlite` (یا `.sqlite.enc` اگر رمزنگاری فعال باشد)
- **حقوق**: mode 600، خارج از web root
- **تاریخچه**: جدول `backups` در DB — نام/حجم/نوع (خودکار/دستی)/وضعیت (موفق/ناموفق)/خطا + **آخرین بکاپ موفق/ناموفق**

## ۲) زمان‌بندی (Scheduled Backup)

مکان: **Admin → پشتیبان‌گیری و بازیابی** (فقط super_admin)

| گزینه | مقادیر | پیش‌فرض |
|---|---|---|
| بازه | روزانه / هفتگی / ماهانه | روزانه |
| ساعت اجرا (تهران) | 00-23 | 02:00 |
| روز هفته (هفتگی) | شنبه..جمعه | شنبه |
| روز ماه (ماهانه) | 1-28 | 1 |
| نگهداری (روز) | 1-365 | 30 |

scheduler هر دقیقه بررسی می‌کند و در بازهٔ مشخص اجرا می‌کند (idempotent — هر روز فقط یک‌بار).

## ۳) محل بکاپ (Local / Network / سفارشی)

- پیش‌فرض: `data/backups/` (داخل دایرکتوری داده)
- سفارشی: **مسیر مطلق** دلخواه — برای مقصد شبکه، درگاه NFS/SMB را mount کنید و مسیر درگاه را وارد کنید (مثلاً `/mnt/backup-nas/baspar-crm`)
- مسیر نسبی یا نامعتبر **رد می‌شود** (400) — تست‌شده
- دسترسی نوشتن به مسیر در زمان ذخیره تنظیمات بررسی می‌شود

## ۴) رمزنگاری (اختیاری — AES-256-GCM)

- فعال‌سازی: تنظیم `BACKUP_KEY` در محیط سرور (systemd `Environment=` یا env file) — **خارج از Git/ZIP/DB**
  ```bash
  openssl rand -hex 32   # مقدار BACKUP_KEY
  ```
- فایل‌های بکاپ: `...sqlite.enc` با header `BSBK1|<iv>|<auth-tag>|<ciphertext>`
- بدون `BACKUP_KEY`: بکاپ‌ها شفاف ذخیره می‌شوند (با mode 600) — در پنل وضعیت نمایش داده می‌شود
- **هشدار**: اگر `BACKUP_KEY` گم شود، بکاپ‌های رمزنگاری‌شده بازیابی‌ناپذیرند — کلید را در保管 امن شرکت نگه دارید

## ۵) بکاپ دستی

- پنل: **Admin → پشتیبان‌گیری → «⬇ پشتیبان‌گیری فوری»**
- خط فرمان:
  ```bash
  sudo -u baspar sqlite3 /var/lib/baspar-crm/baspar-crm.sqlite \
    ".backup /var/lib/baspar-crm/backups/manual-$(date +%F).sqlite"
  ```

## ۶) بازیابی (Restore)

### از پنل (توصیه)
1. Admin → پشتیبان‌گیری → روی ردیف بکاپ «بازیابی»
2. تأیید → DB جایگزین می‌شود — **اتصال زنده به‌صورت ایمن reopen می‌شود (بدون نیاز به restart)** — تست‌شده
3. کاربرها دوباره وارد شوند (جلسه‌ها بازنشسته می‌شوند)

### از خط فرمان
```bash
sudo systemctl stop baspar-crm
cp /var/lib/baspar-crm/backups/<file>.sqlite /var/lib/baspar-crm/baspar-crm.sqlite
rm -f /var/lib/baspar-crm/baspar-crm.sqlite-wal /var/lib/baspar-crm/baspar-crm.sqlite-shm
chown baspar:baspar /var/lib/baspar-crm/baspar-crm.sqlite && chmod 600 /var/lib/baspar-crm/baspar-crm.sqlite
# صحت‌سنجی:
sudo -u baspar sqlite3 /var/lib/baspar-crm/baspar-crm.sqlite "PRAGMA integrity_check; PRAGMA foreign_key_check;"
sudo systemctl start baspar-crm
curl -fsS http://127.0.0.1:3000/health
```
(برای فایل `.enc`: ابتدا با کلید رمزگشایی کنید — ابزار: `node -e` با همان الگوریتم AES-256-GCM و `BACKUP_KEY`، یا از پنل بازیابی استفاده کنید که خودکار رمزگشایی می‌کند.)

## ۷) بکاپ خارج از سرور (الزامی — قانون 3-2-1)

```bash
# crontab کاربر baspar (یا restic/borg):
0 3 * * * rsync -a /var/lib/baspar-crm/backups/ backup-server:/var/backups/baspar-crm/
```
- حداقل: یک کپی خارج از سرور + یک کپی آفلاین/غیرقابل‌تغییر
- **تست بازیابی ماهانه**: کپی یک بکاپ → `integrity_check` روی محیط جدا (هرگز روی سرور زنده تست نکنید مگر از پنل)

## ۸) صحت‌سنجی (Integrity)

```bash
sqlite3 <file>.sqlite "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```
- بکاپ سالم: `ok` + خروجی خالی
- در پنل: وضعیت هر بکاپ (موفق/ناموفق + پیام خطا) + آخرین موفق/ناموفق

## ۹) نکات عملیاتی

- Restore **وضعیت نقطه‌ای در زمان** را بازمی‌گرداند — بکاپ جدیدتر از لحظهٔ restore، ردیف تاریخچهٔ خود را در جدول `backups` ندارد (طبیعی و مورد انتظار)
- retention (پیش‌فرض 30 روز) بکاپ‌های موفق قدیمی را پاک می‌کند + audit `retention_purge`
- بکاپ‌ها شامل **کل DB** (شامل settings رمزنگاری‌شده) هستند — به‌عنوان دادهٔ حساس در نظر بگیرید
