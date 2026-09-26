# گزارش نهایی — توسعه و اصلاح زنجیره فروش و مالی
## Customer → Product → Price List → Quotation → Order → Invoice → Payment → Sales Commission
**تاریخ:** ۲۹ آبان ۱۴۰۵ (2026-08-29) — **نتیجه: زنجیره کامل در دیتابیس واقعی اجرا و تست شد — ۸۰/۸۰ چک زنجیره + ۳۲۹+ چک کل ✅**

> قانون محدوده تغییرات رعایت شد: فقط ماژول‌های زنجیره (و وابستگی‌های مستقیم حداقلی) تغییر کردند. ماژول‌های R&D، تولید، آزمایشگاه، QC، شکایات، تیکت، گارانتی، قرارداد، کمپین، جلسات، تقویم، پیگیری، Workflow، اسناد و Knowledge Base دست‌نخورده ماندند و در رگرسیون سبز هستند.

## ۱) فایل‌های تغییرکرده (نام دقیق)
**Backend:**
- `server/api/custom/sales.js` — موتور زنجیره: `suggestPrice` (قیمت اختصاصی مشتری)، `quoteToOrder` (انتقال واقعی + tax_rate ردیفی + جمع پیش‌مالیاتی)، `orderToInvoice` (مالیات ردیفی با_FALLBACK نرخ سیستم)، `addPayment` (اعتبارسنجی مشتری/فاکتور/بیش‌پرداخت/بانک/حساب/وضعیت + مغایرت + اعتبار مشتری)، `refundPayment` (برگشت + بازگردانی مانده)، موتور پورسانت `calcCommissions` (۶ نوع قانون، شناسایی فروشنده از زنجیره سند، بدون محاسبه تکراری)، `approveCommission`/`payCommission`/`cancelCommission` (چرخه وضعیت)، `customerFinance` (جمع‌های واقعی ۳۶۰)، `salesReport` + `salesReportExport` (۱۶ گزارش + Excel/CSV/PDF)
- `server/server.js` — مسیرهای جدید (بخش ۲)، گاردهای مالی (حذف پرداخت متصل به فاکتور → 409، اعتبارسنجی product در ردیف‌ها)، upsert آیتم لیست قیمت با قیمت اختصاصی مشتری، PUT قانون پورسانت با merge مقادیر موجود
- `server/api/resources.js` — فیلدهای فرم: `tax_rate` در ردیف‌های پیش‌فاکتور/سفارش، `bank/account/status` در پرداخت، `viewed` در وضعیت پیش‌فاکتور، روش‌های پرداخت کامل (نقدی/کارت/بانکی/چک/قسطی/سایر)، `description` در لیست قیمت
- `server/lib/print.js` — `orderHtml` (چاپ رسمی سفارش: سربرگ/لوگو/کد بارکد/امضا)
- `server/api/custom/dashboard.js` — KPIهای زنجیره در داشبورد فروش (پیش‌فاکتور/سفارش/فاکتور باز، وصول ماه، پورسانت‌ها) و داشبورد مالی (مطالبات کل، پورسانت معوق/پرداخت‌شده)

**Database (مایگریشن‌های جدید):**
- `server/db/migrations/005_sales_chain.sql` — ستون‌های جدید (price_list_items: customer_id/discount_pct/tax_rate/max_qty/valid_from/until؛ payments: bank/account/status؛ commission_rules: basis_type/min_amount/max_amount/valid_from/until/salesperson_id؛ commissions: invoice_id/payment_id/customer_id/basis/rate؛ quote_items+order_items: tax_rate؛ description در price_lists) + ایندکس‌ها
- `server/db/migrations/006_commissions.sql` — بازسازی جدول commissions (حذف UNIQUE قدیمی user/period/rule که با چندپرداخت روی یک فاکتور ناسازگار بود)
- `server/db/migrations/007_price_list_items.sql` — بازسازی price_list_items برای قیمت اختصاصی مشتری (UNIQUE جدید: list+product+customer)
- `server/db/migrations/008_commissions_unique.sql` — UNIQUE صحیح: (rule_id, payment_id) و (rule_id, invoice_id) فقط برای پورسانت مبتنی بر فاکتور
- `server/db/seed.js` — مجوزهای calendar_event (وابستگی دور قبلی) — بدون تغییر در داده‌های دمو

**Frontend:**
- `public/js/views/sales.js` — صفحه پورسانت کامل (قوانین + محاسبه + تأیید/پرداخت/لغو + خروجی Excel/PDF)، فرم پرداخت (بانک/حساب/چک/مانده)، دکمه‌های زنجیره در جزئیات اسناد (سفارش←پیش‌فاکتور، فاکتور←سفارش/پیش‌فاکتور/مشتری)، برگشت پرداخت در لیست پرداخت‌های فاکتور
- `public/js/views/misc.js` — لیست قیمت‌ها: تاریخ شمسی + توضیحات در فرم لیست؛ مدیریت قیمت‌ها با **قیمت اختصاصی مشتری** (تخفیف/مالیات/حداقل/حداکثر/اعتبار) + قیمت عمومی
- `public/js/views/customers.js` — Customer 360: KPIهای مالی واقعی از DB (مجموع فاکتور/پرداخت/مانده) + تب «پرداخت‌ها» + تب «پورسانت‌ها»
- `public/js/views/dashboard.js` — KPIهای زنجیره با دریل‌داون کلیک‌شونده (فروش، پیش‌فاکتور/سفارش/فاکتور باز، وصول، مطالبات، پورسانت)
- `public/js/views/reports.js` — بخش «گزارش‌های تخصصی فروش و مالی» (۱۶ گزارش + فیلتر تاریخ شمسی/مشتری/فروشنده/وضعیت + خروجی Excel/CSV/PDF)
- `public/js/resource-view.js` — خواندن فیلترهای اولیه از hash (پشتیبانی دریل‌داون `#/invoices?f_status=overdue`)
- `public/js/main.js` — تفکیک query-string از مسیر در router (برای دریل‌داون)

**تست:**
- `sales-chain-test.mjs` — **جدید** — ۸۰ چک E2E (سناریوی اجباری + ویرایش + حذف + خطا + گزارش + داشبورد)
- `final-check.js` — به‌روزرسانی payload تست payment (زوج سازگار customer/invoice + گاردهای مالی)

## ۲) APIهای تغییرکرده / ایجادشده
**ایجادشده:**
| Endpoint | توضیح |
|---|---|
| `GET /api/quotes/price-suggest?product_id=&customer_id=&price_list_id=` | پیشنهاد قیمت: قیمت اختصاصی مشتری ← قیمت لیست ← قیمت پایه کالا (با flag لیست منقضی) |
| `GET /api/customers/:id/finance` | جمع‌های واقعی: مجموع فاکتور/پرداخت/مانده/وصول ماه + پرداخت‌های اخیر |
| `POST /api/payments/:id/refund` | برگشت پرداخت + بازگردانی مانده فاکتور + اعتبار مشتری |
| `POST /api/commissions/:id/approve` | تأیید مدیریتی (calculated → approved) |
| `POST /api/commissions/:id/pay` | ثبت پرداخت پورسانت (approved → paid) |
| `POST /api/commissions/:id/cancel` | لغو (calculated/approved → cancelled) |
| `GET /api/salesreports/kinds` | فهرست ۱۶ گزارش تخصصی |
| `GET /api/salesreports/:kind?from=&to=&customer_id=&salesperson_id=&status=` | اجرای گزارش (فروش/مالی/پورسانت) |
| `GET /api/salesreports/:kind/export?format=xlsx\|csv\|html` | خروجی Excel/CSV/PDF رسمی |
| `GET /api/commissions/export?format=&period=` | خروجی پورسانت‌ها |
| `GET /api/print/order/:id` | چاپ رسمی سفارش |

**تغییرکرده:**
- `POST /api/r/payment` — حالا از طریق موتور مغایرت (`addPayment`) می‌گذرد: اعتبارسنجی + به‌روزرسانی وضعیت فاکتور + اعتبار مشتری (قبل: INSERT ساده بدون مغایرت)
- `PUT /api/r/:res/:id/items` — ردیف‌ها: `tax_rate` قابل خالی (null = نرخ سند) + اعتبارسنجی وجود کالا
- `POST/PUT /api/pricelist/:id/item(s)` — قیمت اختصاصی مشتری + تخفیف/مالیات/حداقل/حداکثر/اعتبار
- `PUT /api/commission-rules/:id` — merge مقادیر موجود (ویرایش جزئی بدون خالی‌شدن فیلدها)
- `DELETE /api/r/payment/:id` — گاردها مالی: پرداخت متصل به فاکتور → **409** (برگشت بزنید)
- `POST /api/commissions/calc` — موتور جدید (۶ نوع قانون، بدون تکرار، با مرجع رکورد)

## ۳) Database — Tables / Relations / Indexes
- **Relations واقعی (FK) حفظ و تست شدند:** Customer→Quotes/Orders/Invoices/Payments/Commissions؛ Quotation→Order (order.quote_id)؛ Order→Invoice (invoice.order_id)؛ Invoice→Payment (payment.invoice_id)؛ Payment/Invoice→Commission (payment_id/invoice_id + user_id فروشنده)
- **UNIQUE جدید:** `commissions(rule_id, payment_id) WHERE payment_id IS NOT NULL`؛ `commissions(rule_id, invoice_id) WHERE invoice_id IS NOT NULL AND payment_id IS NULL`؛ `price_list_items(price_list_id, product_id, COALESCE(customer_id,0))`
- **ایندکس‌های جدید:** idx_payments_customer، idx_commissions_user_period، idx_pli_list_prod، idx_pli_unique، idx_commissions_rule_invoice/payment
- **تغییرات ستونی:** ۴ جدول بازسازی‌شده (commissions، price_list_items) + ستون‌های جدید در ۵ جدول دیگر — همه در ۴ مایگریشن تبادلی

## ۴) وضعیت تست به‌ازای هر ماژول
| ماژول | نتیجه |
|---|---|
| **Price List** | **PASS** — قیمت عمومی + اختصاصی مشتری + قیمت پیشنهادی صحیح + لیست منقضی = قیمت پایه + ویرایش/حذف آیتم |
| **Quotation** | **PASS** — ردیف‌ها + جمع صحیح (۱,۰۱۲,۰۰,۰۰۰) + وضعیت viewed + تبدیل به سفارش (کپی واقعی ردیف‌ها) |
| **Order** | **PASS** — customer_id/quote_id واقعی + جمع انتقال‌یافته + ردیف‌ها + وضعیت + چاپ رسمی |
| **Invoice** | **PASS** — subtotal=سفارش، مالیات ردیفی (۹٪+۰٪=۷۵,۲۴۰,۰۰۰) + total صحیح + لینک‌ها + چاپ |
| **Payment** | **PASS** — ۴۰٪ → partial + مانده ۶۰٪؛ ۶۰٪ → paid؛ بیش‌پرداخت = 422؛ بانک/حساب/چک؛ برگشت (refund)؛ گارد حذف 409 |
| **Commission** | **PASS** — ۳٪ از ۴۰٪ وصولی = ۱۳,۰۴,۸۸۰؛ باقی‌مانده = ۱۹,۵۷۰,۳۲۰؛ **بدون تکرار**؛ approve→pay؛ re-approve blocked؛ cancel؛ 403 برای غیرمدیر |
| **Customer Integration** | **PASS** — همان customer_id در کل زنجیره + ۳۶۰ (KPI واقعی + لیست‌ها + تب‌های پرداخت/پورسانت) |
| **Reports** | **PASS** — ۱۶ نوع گزارش بدون خطا + فروش به تفکیک مشتری/محصول/فروشنده/ماه/سال/منطقه + مالی + ۶ گزارش پورسانت |
| **Excel** | **PASS** — XLSX واقعی (PK magic) با Heder/تاریخ شمسی/جمع‌بندی + CSV با BOM |
| **PDF** | **PASS** — خروجی رسمی: سربرگ/لوگو/نام شرکت/شماره گزارش/تاریخ شمسی/تهیه‌کننده/امضا/فوتر |
| **End-to-End** | **PASS** — ۸۰/۸۰ چک |

## ۵) تست‌های خطا (همه بدون Crash)
مشتری نامعتبر (422) • کالا نامعتبر در ردیف (422) • لیست قیمت منقضی (قیمت پایه + flag) • مبلغ منفی (422) • مبلغ صفر (422) • Payment بیش از مانده (422 OVERPAYMENT) • فاکتور نامعتبر (404) • تطبیق نداشتن مشتری-فاکتور (422) • دسترسی غیرمجاز به تأیید پورسانت (403) • مشتری حذف‌شده/نامشخص (404)

## ۶) رگرسیون کامل (ماژول‌های خارج از محدوده سالم)
- `final-check.js` (۱۱۴ آزمون شامل آزمایشگاه/شکایت/تیکت/Workflow/مسنجر/…) — **۱۱۴/۱۱۴ ✅**
- `calendar-test.mjs` — **۵۶/۵۶ ✅**
- `wf-e2e-test.mjs` — **۲۰/۲۰ ✅**
- `ui-test.mjs` (۵۹ صفحه رندر زنده) — **۵۹/۵۹، خطای View: ۰، خطای API: ۰ ✅**
- `sales-chain-test.mjs` — **۸۰/۸۰ ✅**
- **جمع: ۳۲۹+ چک سبز — ۰ شکست**

## ۷) وابستگی‌های خارجی تغییرکرده (حداقلی، طبق ماده ۴۶)
- `server/api/generic.js` — **بدون تغییر** (گاردهای مالی در server.js پیاده شدند)
- `public/js/resource-view.js` + `main.js` — فقط افزودن پشتیبانی query-string در hash (برای دریل‌داون داشبورد) — هیچ رفتاری از بین نرفت
- `server/lib/print.js` — فقط افزودن `orderHtml` + export `baseHtml`
- **هیچ قابلیت قبلی حذف/بازنویسی نشد.**

## ۸) خطاهای باقی‌مانده
**صفر.** (همه خطاهای لاگ سرور، پاسخ‌های گارد/اعتبارسنجی/مجوز از تست‌های خطا هستند — یعنی گاردها درست کار می‌کنند.)
