# Firewall Rules — سرور شرکت (Production)

## اصل
- **فقط پورت‌های ضروری** باز می‌مانند: `80/tcp` (redirect) و `443/tcp` (HTTPS) برای عموم؛ `22/tcp` فقط از IPهای مجاز مدیریت.
- **پورت 3000 (app) هرگز عمومی نیست** — روی `127.0.0.1` bind است (`HOST=127.0.0.1`) و فقط nginx به آن دسترسی دارد.
- **دیتابیس = فایل SQLite روی دیسک** — پورت شبکه ندارد (exposure شبکه‌ای صفر به‌صورت ساختاری). اگر در آینده به PostgreSQL/MSSQL مهاجرت شد: bind روی localhost + دسترسی فقط از IP سرور اپ.
- **SSH** فقط از IP/VPN مدیریت.

## ufw (ساده‌ترین)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# SSH فقط از IP مدیریت (مثلاً IP سرور پرش/VPN):
sudo ufw allow from 203.0.113.10 to any port 22 proto tcp
# اطمینان: 3000 بسته است (به‌صورت پیش‌فرض با default deny بسته است؛ صریح برای شفافیت):
sudo ufw deny 3000/tcp
sudo ufw enable
sudo ufw status verbose
```

## iptables (معادل)
```bash
# سیاست پیش‌فرض
iptables -P INPUT DROP
# loopback + established
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
# خدمات عمومی
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
# SSH فقط از IP مدیریت
iptables -A INPUT -p tcp --dport 22 -s 203.0.113.10 -j ACCEPT
# app port: حتی اگر اشتباهاً روی 0.0.0.0 bind شود، از فایروال بسته می‌ماند
iptables -A INPUT -p tcp --dport 3000 -j DROP
# نگه‌داشتن قوانین:
#   netfilter-persistent save  (Debian/Ubuntu) یا net-tools/services iptables (RHEL)
```

## راستی‌آزمایی (بعد از اعمال)
```bash
# از داخل سرور:
ss -ltnp | grep -E ':(80|443|3000|22)\b'
# باید: 80/443 روی nginx (0.0.0.0) · 3000 فقط روی 127.0.0.1 · 22
# از بیرون سرور (IP کلاینت):
nc -vz <server-ip> 3000    # باید FAIL/Become closed باشد
nc -vz <server-ip> 443     # باید succeed
curl -sI https://<domain>/health   # باید 200 + HSTS
```

## پورت‌های اضافی که باید بسته/غیرفعال باشند
| پورت | وضعیت موردنظر |
|---|---|
| 3000 | فقط 127.0.0.1 (bind) + DROP در فایروال (defense-in-depth) |
| 80 | فقط redirect → HTTPS |
| 443 | HTTPS (nginx) |
| 22 | فقط IPهای مجاز مدیریت |
| هر پورت DB | **نمی‌بایست وجود داشته باشد** (SQLite فایل است) — اگر سرویس DB دیگری روی سرور است: localhost-only |
| 5432/1433/3306/27017 | باید بسته باشد (اگر سرویسی آن‌ها را باز دارد) |
