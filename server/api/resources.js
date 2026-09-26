'use strict';
// Resource registry — drives the generic CRUD engine, UI forms, permissions, search.
const R = {};

R.customer = {
  table: 'customers', entity: 'customer', nameFa: 'مشتریان', nameEn: 'Customers', singularFa: 'مشتری',
  numberPrefix: 'CS', searchFields: ['name', 'phone', 'mobile', 'email', 'tax_code', 'city', 'number'],
  scopeField: 'salesperson_id', scopeFallback: 'created_by',
  fields: [
    { key: 'number', label: 'کد', type: 'text', list: 1, readonly: 1 },
    { key: 'name', label: 'نام / عنوان', type: 'text', required: 1, list: 1, search: 1, dupCheck: 'name' },
    { key: 'source', label: 'منبع ثبت', type: 'text', list: 1 },
    { key: 'name_en', label: 'نام انگلیسی', type: 'text' },
    { key: 'type', label: 'نوع', type: 'select', options: [{ v: 'company', l: 'شرکت' }, { v: 'person', l: 'شخصی' }], default: 'company', list: 1, filter: 1 },
    { key: 'category_id', label: 'دسته‌بندی', type: 'ref', ref: 'customer_categories', list: 1, filter: 1 },
    { key: 'phone', label: 'تلفن', type: 'text', list: 1, dupCheck: 'phone', search: 1 },
    { key: 'mobile', label: 'موبایل', type: 'text', dupCheck: 'mobile' },
    { key: 'phone2', label: 'تلفن ۲', type: 'text' },
    { key: 'email', label: 'ایمیل', type: 'email', dupCheck: 'email' },
    { key: 'website', label: 'وب‌سایت', type: 'text' },
    { key: 'tax_code', label: 'کد ملی / ثبت', type: 'text', dupCheck: 'tax_code' },
    { key: 'province', label: 'استان', type: 'select', options: 'provinces', filter: 1 },
    { key: 'city', label: 'شهر', type: 'text', filter: 1 },
    { key: 'industrial_city', label: 'شهرک صنعتی', type: 'text', filter: 1 },
    { key: 'address', label: 'آدرس', type: 'textarea' },
    { key: 'industry', label: 'صنعت', type: 'select', options: 'industries', filter: 1 },
    { key: 'activity_type', label: 'نوع فعالیت', type: 'text' },
    { key: 'credit_limit', label: 'سقف اعتبار (ریال)', type: 'money' },
    { key: 'credit_status', label: 'وضعیت اعتباری', type: 'select', options: [{ v: 'نورمال', l: 'نورمال' }, { v: 'هشدار', l: 'هشدار' }, { v: 'متوقف', l: 'متوقف' }], list: 1, filter: 1 },
    { key: 'payment_terms', label: 'شرایط پرداخت', type: 'select', options: [{ v: 'cash', l: 'نقد' }, { v: 'credit', l: 'اعتباری' }, { v: 'other', l: 'سایر' }], default: 'cash', list: 1, filter: 1 },
    { key: 'payment_terms_note', label: 'توضیح شرایط پرداخت', type: 'text' },
    { key: 'status', label: 'وضعیت', type: 'select', options: [{ v: 'active', l: 'فعال' }, { v: 'lead', l: 'اولیه (در انتظار تکمیل)' }, { v: 'inactive', l: 'غیرفعال' }, { v: 'blocked', l: 'ممنوع' }], default: 'active', list: 1, filter: 1 },
    { key: 'portal_username', label: 'نام کاربری پورتال', type: 'text', list: 1 },
    { key: 'portal_enabled', label: 'دسترسی محدود مشتری (پورتال)', type: 'bool' },
    { key: 'salesperson_id', label: 'کارشناس فروش', type: 'ref', ref: 'users', list: 1, filter: 1 },
    { key: 'representative_id', label: 'نماینده', type: 'ref', ref: 'users' },
    { key: 'churn_score', label: 'ریسک ریزش (AI)', type: 'number', list: 1 },
    { key: 'notes', label: 'یادداشت‌ها', type: 'textarea' },
    { key: 'custom_fields', label: 'فیلدهای سفارشی', type: 'json' },
  ],
  dupFields: ['phone', 'mobile', 'email', 'tax_code', 'name'],
  detailTabs: ['info', 'contacts', 'orders', 'payments', 'invoices', 'opportunities', 'complaints', 'tickets', 'quotes', 'documents', 'timeline', 'comments', 'attachments', 'tags', 'ai', 'audit'],
};

R.customer_categories = {
  table: 'customer_categories', entity: 'customer_category', nameFa: 'دسته‌بندی مشتریان', nameEn: 'Customer Categories', singularFa: 'دسته',
  fields: [
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1 },
    { key: 'name_en', label: 'نام انگلیسی', type: 'text', list: 1 },
    { key: 'description', label: 'توضیحات', type: 'textarea' },
  ],
};

R.lead = {
  table: 'leads', entity: 'lead', nameFa: 'سرنخ‌ها', nameEn: 'Leads', singularFa: 'سرنخ',
  numberPrefix: 'LD', searchFields: ['company', 'contact_name', 'phone', 'email', 'number'],
  scopeField: 'salesperson_id', scopeFallback: 'created_by',
  fields: [
    { key: 'number', label: 'کد', type: 'text', readonly: 1 },
    { key: 'company', label: 'شرکت', type: 'text', list: 1, search: 1, dupCheck: 'name' },
    { key: 'contact_name', label: 'نام مخاطب', type: 'text', list: 1 },
    { key: 'source', label: 'منبع', type: 'select', options: 'leadSources', list: 1, filter: 1 },
    { key: 'phone', label: 'تلفن', type: 'text', list: 1, dupCheck: 'phone' },
    { key: 'email', label: 'ایمیل', type: 'email' },
    { key: 'product_interest', label: 'محصول مورد نظر', type: 'text', list: 1 },
    { key: 'estimated_value', label: 'ارزش تخمینی (ریال)', type: 'money', list: 1 },
    { key: 'probability', label: 'احتمال (%)', type: 'number' },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'leadStatuses', default: 'new', list: 1, filter: 1 },
    { key: 'salesperson_id', label: 'کارشناس فروش', type: 'ref', ref: 'users', list: 1, filter: 1 },
    { key: 'score', label: 'امتیاز AI', type: 'number', list: 1 },
    { key: 'next_action', label: 'اقدام بعدی', type: 'text' },
    { key: 'next_followup_at', label: 'زمان پیگیری', type: 'datetime', list: 1 },
    { key: 'customer_id', label: 'مشتری (تبدیل‌شده)', type: 'ref', ref: 'customer' },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
    { key: 'custom_fields', label: 'فیلدهای سفارشی', type: 'json' },
  ],
  dupFields: ['phone', 'email', 'company'],
  detailTabs: ['info', 'timeline', 'comments', 'attachments', 'tags'],
};

R.opportunity = {
  table: 'opportunities', entity: 'opportunity', nameFa: 'فرصت‌های فروش', nameEn: 'Opportunities', singularFa: 'فرصت فروش',
  numberPrefix: 'OP', searchFields: ['title', 'number', 'competitors'],
  scopeField: 'salesperson_id', scopeFallback: 'created_by',
  lines: { table: 'opportunity_items', refKey: 'opportunity_id', fields: [
    { key: 'product_id', label: 'محصول', type: 'ref', ref: 'product' },
    { key: 'name', label: 'عنوان', type: 'text', required: 1 },
    { key: 'qty', label: 'تعداد', type: 'number', default: 1 },
    { key: 'price', label: 'قیمت واحد (ریال)', type: 'money' },
    { key: 'discount_pct', label: 'تخفیف %', type: 'number', default: 0 },
  ] },
  fields: [
    { key: 'number', label: 'کد', type: 'text', readonly: 1 },
    { key: 'title', label: 'عنوان', type: 'text', required: 1, list: 1, search: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'pipeline_id', label: 'Pipeline', type: 'ref', ref: 'pipeline', filter: 1 },
    { key: 'stage_id', label: 'مرحله', type: 'ref', ref: 'pipeline_stages', list: 1, filter: 1 },
    { key: 'amount', label: 'مبلغ (ریال)', type: 'money', list: 1 },
    { key: 'quantity', label: 'تعداد', type: 'number' },
    { key: 'probability', label: 'احتمال موفقیت (%)', type: 'number', list: 1 },
    { key: 'next_followup_at', label: 'پیگیری بعدی', type: 'datetime', list: 1 },
    { key: 'expected_close_at', label: 'تاریخ احتمالی بسته شدن', type: 'date', list: 1 },
    { key: 'competitors', label: 'رقبا', type: 'text' },
    { key: 'salesperson_id', label: 'کارشناس فروش', type: 'ref', ref: 'users', list: 1, filter: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'oppStatuses', default: 'open', list: 1, filter: 1 },
    { key: 'quote_id', label: 'پیش‌فاکتور مرتبط', type: 'ref', ref: 'quote' },
    { key: 'lost_reason', label: 'دلیل عدم موفقیت', type: 'text' },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
    { key: 'custom_fields', label: 'فیلدهای سفارشی', type: 'json' },
  ],
  detailTabs: ['info', 'items', 'timeline', 'comments', 'attachments', 'tags'],
};

R.pipeline = {
  table: 'pipelines', entity: 'pipeline', nameFa: 'Pipeline ها', nameEn: 'Pipelines', singularFa: 'Pipeline',
  fields: [
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1 },
    { key: 'description', label: 'توضیحات', type: 'textarea' },
    { key: 'is_default', label: 'پیش‌فرض', type: 'bool' },
    { key: 'active', label: 'فعال', type: 'bool', default: 1 },
  ],
};

R.pipeline_stages = {
  table: 'pipeline_stages', entity: 'pipeline_stage', nameFa: 'مراحل Pipeline', nameEn: 'Pipeline Stages', singularFa: 'مرحله',
  fields: [
    { key: 'pipeline_id', label: 'Pipeline', type: 'ref', ref: 'pipeline', required: 1, list: 1 },
    { key: 'name', label: 'نام مرحله', type: 'text', required: 1, list: 1 },
    { key: 'position', label: 'ترتیب', type: 'number', default: 0 },
    { key: 'color', label: 'رنگ', type: 'text', default: '#c9a227' },
    { key: 'probability', label: 'احتمال موفقیت (%)', type: 'number' },
    { key: 'is_won', label: 'مرحله موفق', type: 'bool' },
    { key: 'is_lost', label: 'مرحله ناموفق', type: 'bool' },
  ],
};

R.product = {
  table: 'products', entity: 'product', nameFa: 'محصولات', nameEn: 'Products', singularFa: 'محصول',
  // Section 8: fast search by name, code AND category name (subquery — same trusted-registry pattern)
  numberPrefix: 'PD', searchFields: ['name', 'code', 'sku', 'description', '(SELECT name FROM product_categories WHERE id=products.category_id)'],
  fields: [
    { key: 'code', label: 'کد', type: 'text', required: 1, list: 1, dupCheck: 'code' },
    { key: 'sku', label: 'SKU', type: 'text' },
    { key: 'name', label: 'نام محصول', type: 'text', required: 1, list: 1, search: 1 },
    { key: 'name_en', label: 'نام انگلیسی', type: 'text' },
    { key: 'category_id', label: 'دسته', type: 'ref', ref: 'product_categories', list: 1, filter: 1 },
    { key: 'is_raw_material', label: 'مواد اولیه', type: 'bool', filter: 1 },
    { key: 'unit', label: 'واحد', type: 'select', options: [{ v: 'عدد', l: 'عدد' }, { v: 'کیلوگرم', l: 'کیلوگرم' }, { v: 'متر', l: 'متر' }, { v: 'متر مربع', l: 'متر مربع' }, { v: 'لیتر', l: 'لیتر' }, { v: 'بسته', l: 'بسته' }, { v: 'کارتن', l: 'کارتن' }] },
    { key: 'price_retail', label: 'قیمت خرده (ریال)', type: 'money', list: 1 },
    { key: 'price_wholesale', label: 'قیمت عمده (ریال)', type: 'money', list: 1 },
    { key: 'price_export', label: 'قیمت صادرات (ریال)', type: 'money' },
    { key: 'price_cost', label: 'قیمت تمام‌شده (ریال)', type: 'money' },
    { key: 'min_order', label: 'حداقل سفارش', type: 'number' },
    { key: 'stock_qty', label: 'موجودی', type: 'number', list: 1 },
    { key: 'reserved_qty', label: 'رزرو شده', type: 'number' },
    { key: 'reorder_point', label: 'حد سفارش مجدد', type: 'number', list: 1 },
    { key: 'max_stock', label: 'حداکثر موجودی', type: 'number' },
    { key: 'description', label: 'توضیحات', type: 'textarea' },
    { key: 'image', label: 'تصویر محصول (URL)', type: 'text' },
    { key: 'spec', label: 'مشخصات فنی (JSON)', type: 'json' },
    { key: 'length_cm', label: 'طول (سانتی‌متر)', type: 'number' },
    { key: 'width_cm', label: 'عرض (سانتی‌متر)', type: 'number' },
    { key: 'height_cm', label: 'ارتفاع (سانتی‌متر)', type: 'number' },
    { key: 'weight_kg', label: 'وزن (کیلوگرم)', type: 'number', list: 1 },
    { key: 'active', label: 'فعال', type: 'bool', default: 1, filter: 1 },
    { key: 'custom_fields', label: 'فیلدهای سفارشی', type: 'json' },
  ],
  // Duplicate identity = unique product identifiers ONLY (code/SKU).
  // Same name/description with different specs (color, dimensions, weight, spec JSON)
  // is a DIFFERENT product — name similarity must not block a new-code register.
  dupFields: ['code', 'sku'],
  detailTabs: ['info', 'stock', 'orders', 'timeline', 'comments', 'attachments', 'tags'],
};

R.product_categories = {
  table: 'product_categories', entity: 'product_category', nameFa: 'دسته‌های محصول', nameEn: 'Product Categories', singularFa: 'دسته',
  fields: [
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1 },
    { key: 'name_en', label: 'نام انگلیسی', type: 'text' },
    { key: 'parent_id', label: 'دسته مادر', type: 'ref', ref: 'product_categories' },
  ],
};

R.price_list = {
  table: 'price_lists', entity: 'price_list', nameFa: 'لیست قیمت‌ها', nameEn: 'Price Lists', singularFa: 'لیست قیمت',
  fields: [
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1 },
    { key: 'currency', label: 'واحد پول', type: 'select', options: [{ v: 'IRR', l: 'ریال' }, { v: 'IRT', l: 'تومان' }, { v: 'USD', l: 'دولار' }], list: 1 },
    { key: 'valid_from', label: 'تاریخ شروع', type: 'date' },
    { key: 'valid_until', label: 'تاریخ پایان', type: 'date' },
    { key: 'is_default', label: 'پیش‌فرض', type: 'bool' },
    { key: 'active', label: 'فعال', type: 'bool', default: 1, list: 1 },
    { key: 'description', label: 'توضیحات', type: 'textarea' },
  ],
};

R.quote = {
  table: 'quotes', entity: 'quote', nameFa: 'پیش‌فاکتورها', nameEn: 'Quotes', singularFa: 'پیش‌فاکتور',
  numberPrefix: 'QT', searchFields: ['number', 'notes'],
  scopeField: 'salesperson_id', scopeFallback: 'created_by',
  lines: { table: 'quote_items', refKey: 'quote_id', fields: [
    { key: 'product_id', label: 'محصول', type: 'ref', ref: 'product' },
    { key: 'name', label: 'شرح', type: 'text', required: 1 },
    { key: 'qty', label: 'تعداد', type: 'number', default: 1 },
    { key: 'price', label: 'قیمت واحد (ریال)', type: 'money' },
    { key: 'discount_pct', label: 'تخفیف %', type: 'number', default: 0 },
    { key: 'tax_rate', label: 'مالیات % (خالی = نرخ سند)', type: 'number' },
  ], recalc: true },
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1, search: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'salesperson_id', label: 'کارشناس فروش', type: 'ref', ref: 'users', list: 1 },
    { key: 'currency', label: 'واحد پول', type: 'select', options: [{ v: 'IRR', l: 'ریال' }, { v: 'IRT', l: 'تومان' }, { v: 'USD', l: 'دولار' }], default: 'IRR' },
    { key: 'price_list_id', label: 'لیست قیمت', type: 'ref', ref: 'price_list' },
    { key: 'discount_pct', label: 'تخفیف کل %', type: 'number', default: 0 },
    { key: 'shipping', label: 'هزینه حمل (ریال)', type: 'money', default: 0 },
    { key: 'tax_rate', label: 'مالیات %', type: 'number', default: 0 },
    { key: 'subtotal', label: 'جمع خالص', type: 'money', readonly: 1, list: 1 },
    { key: 'total', label: 'مبلغ کل', type: 'money', readonly: 1, list: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'quoteStatuses', default: 'draft', list: 1, filter: 1 },
    { key: 'valid_until', label: 'اعتبار تا', type: 'date', list: 1 },
    { key: 'notes', label: 'توضیحات', type: 'textarea' },
  ],
  detailTabs: ['info', 'items', 'timeline', 'comments', 'attachments'],
};

R.order = {
  table: 'orders', entity: 'order', nameFa: 'سفارش‌ها', nameEn: 'Orders', singularFa: 'سفارش',
  numberPrefix: 'OD', searchFields: ['number', 'notes'],
  scopeField: 'salesperson_id', scopeFallback: 'created_by',
  lines: { table: 'order_items', refKey: 'order_id', fields: [
    { key: 'product_id', label: 'محصول', type: 'ref', ref: 'product' },
    { key: 'name', label: 'شرح', type: 'text', required: 1 },
    { key: 'qty', label: 'تعداد', type: 'number', default: 1 },
    { key: 'price', label: 'قیمت واحد (ریال)', type: 'money' },
    { key: 'discount_pct', label: 'تخفیف %', type: 'number', default: 0 },
    { key: 'tax_rate', label: 'مالیات % (خالی = نرخ سند)', type: 'number' },
  ], recalc: true },
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1, search: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'salesperson_id', label: 'مسئول', type: 'ref', ref: 'users', list: 1 },
    { key: 'quote_id', label: 'پیش‌فاکتور مبدأ', type: 'ref', ref: 'quote' },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'orderStatuses', default: 'confirmed', list: 1, filter: 1 },
    { key: 'order_date', label: 'تاریخ ثبت', type: 'date', list: 1, defaultNow: 1 },
    { key: 'due_date', label: 'تاریخ تحویل', type: 'date', list: 1 },
    { key: 'delivery_date', label: 'تاریخ ارسال', type: 'date' },
    { key: 'delivery_address', label: 'آدرس تحویل', type: 'textarea' },
    { key: 'total', label: 'مبلغ کل', type: 'money', readonly: 1, list: 1 },
    { key: 'notes', label: 'توضیحات', type: 'textarea' },
  ],
  detailTabs: ['info', 'items', 'invoices', 'timeline', 'comments', 'attachments'],
};

R.invoice = {
  table: 'invoices', entity: 'invoice', nameFa: 'فاکتورها', nameEn: 'Invoices', singularFa: 'فاکتور',
  numberPrefix: 'INV', searchFields: ['number', 'tax_number', 'notes'],
  scopeField: 'created_by',
  lines: { table: 'invoice_items', refKey: 'invoice_id', fields: [
    { key: 'product_id', label: 'محصول', type: 'ref', ref: 'product' },
    { key: 'name', label: 'شرح', type: 'text', required: 1 },
    { key: 'qty', label: 'تعداد', type: 'number', default: 1 },
    { key: 'price', label: 'قیمت واحد (ریال)', type: 'money' },
    { key: 'discount_pct', label: 'تخفیف %', type: 'number', default: 0 },
    { key: 'tax_rate', label: 'مالیات %', type: 'number', default: 0 },
  ], recalc: true },
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1, search: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'order_id', label: 'سفارش مبدأ', type: 'ref', ref: 'order' },
    { key: 'quote_id', label: 'پیش‌فاکتور', type: 'ref', ref: 'quote' },
    { key: 'currency', label: 'واحد پول', type: 'select', options: [{ v: 'IRR', l: 'ریال' }, { v: 'IRT', l: 'تومان' }, { v: 'USD', l: 'دولار' }], default: 'IRR' },
    { key: 'issue_date', label: 'تاریخ صدور', type: 'date', list: 1, defaultNow: 1 },
    { key: 'due_date', label: 'سررسید', type: 'date', list: 1 },
    { key: 'subtotal', label: 'جمع خالص', type: 'money', readonly: 1 },
    { key: 'discount', label: 'تخفیف (ریال)', type: 'money', default: 0 },
    { key: 'tax', label: 'مالیات', type: 'money', default: 0 },
    { key: 'shipping', label: 'حمل', type: 'money', default: 0 },
    { key: 'total', label: 'مبلغ کل', type: 'money', readonly: 1, list: 1 },
    { key: 'paid_amount', label: 'مبلغ پرداختی', type: 'money', readonly: 1, list: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'invoiceStatuses', default: 'unpaid', list: 1, filter: 1 },
    { key: 'terms', label: 'شرایط پرداخت', type: 'text' },
    { key: 'tax_number', label: 'شماره ثبت مالیاتی', type: 'text' },
    { key: 'tax_system_status', label: 'وضعیت سامانه مودیان', type: 'select', options: 'taxStatuses', list: 1 },
    { key: 'notes', label: 'توضیحات', type: 'textarea' },
  ],
  detailTabs: ['info', 'items', 'payments', 'timeline', 'comments', 'attachments'],
};

R.payment = {
  table: 'payments', entity: 'payment', nameFa: 'پرداخت‌ها', nameEn: 'Payments', singularFa: 'پرداخت',
  numberPrefix: 'PAY',
  // real searchable columns of `payments` (+ customer name via subquery, same pattern as lab_request)
  searchFields: ['number', 'reference', 'check_info', 'bank', 'account', 'notes', '(SELECT name FROM customers WHERE id=payments.customer_id)'],
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1 },
    { key: 'invoice_id', label: 'فاکتور', type: 'ref', ref: 'invoice', list: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'amount', label: 'مبلغ (ریال)', type: 'money', required: 1, list: 1 },
    { key: 'method', label: 'روش', type: 'select', options: 'payMethods', default: 'bank', list: 1, filter: 1 },
    { key: 'reference', label: 'شماره پیگیری', type: 'text' },
    { key: 'received_by', label: 'دریافت‌کننده', type: 'ref', ref: 'users' },
    { key: 'bank', label: 'بانک', type: 'text' },
    { key: 'account', label: 'شماره حساب', type: 'text' },
    { key: 'check_info', label: 'مشخصات چک', type: 'text' },
    { key: 'paid_at', label: 'تاریخ پرداخت', type: 'date', list: 1, defaultNow: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'payStatuses', list: 1, filter: 1 },
    { key: 'notes', label: 'توضیحات', type: 'text' },
  ],
};

R.supplier = {
  table: 'suppliers', entity: 'supplier', nameFa: 'تأمین‌کنندگان', nameEn: 'Suppliers', singularFa: 'تأمین‌کننده',
  numberPrefix: 'SP', searchFields: ['name', 'tax_code', 'phone', 'contact_name'],
  fields: [
    { key: 'number', label: 'کد', type: 'text', readonly: 1 },
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1, search: 1, dupCheck: 'name' },
    { key: 'tax_code', label: 'کد ثبت', type: 'text', dupCheck: 'tax_code' },
    { key: 'contact_name', label: 'مخاطب', type: 'text', list: 1 },
    { key: 'phone', label: 'تلفن', type: 'text', list: 1, dupCheck: 'phone' },
    { key: 'email', label: 'ایمیل', type: 'email' },
    { key: 'address', label: 'آدرس', type: 'text' },
    { key: 'category', label: 'دسته', type: 'select', options: 'supplierCategories', list: 1, filter: 1 },
    { key: 'quality_rating', label: 'امتیاز کیفیت (۱-۵)', type: 'number', list: 1 },
    { key: 'delivery_rating', label: 'امتیاز تحویل (۱-۵)', type: 'number', list: 1 },
    { key: 'price_rating', label: 'امتیاز قیمت (۱-۵)', type: 'number' },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
    { key: 'custom_fields', label: 'فیلدهای سفارشی', type: 'json' },
  ],
  dupFields: ['phone', 'tax_code', 'name'],
  detailTabs: ['info', 'purchase_orders', 'timeline', 'comments', 'attachments', 'tags'],
};

R.purchase_order = {
  table: 'purchase_orders', entity: 'purchase_order', nameFa: 'سفارش‌های خرید', nameEn: 'Purchase Orders', singularFa: 'سفارش خرید',
  numberPrefix: 'PO',
  searchFields: ['number', 'notes', '(SELECT name FROM suppliers WHERE id=purchase_orders.supplier_id)'],
  lines: { table: 'po_items', refKey: 'po_id', fields: [
    { key: 'product_id', label: 'کالای خریداری', type: 'ref', ref: 'product' },
    { key: 'name', label: 'شرح', type: 'text', required: 1 },
    { key: 'qty', label: 'تعداد', type: 'number' },
    { key: 'price', label: 'قیمت (ریال)', type: 'money' },
    { key: 'received_qty', label: 'مورد دریافت', type: 'number', default: 0 },
  ] },
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1 },
    { key: 'supplier_id', label: 'تأمین‌کننده', type: 'ref', ref: 'supplier', required: 1, list: 1, filter: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'poStatuses', default: 'draft', list: 1, filter: 1 },
    { key: 'order_date', label: 'تاریخ ثبت', type: 'date', list: 1, defaultNow: 1 },
    { key: 'expected_date', label: 'تاریخ تحویل', type: 'date', list: 1 },
    { key: 'total', label: 'مبلغ کل', type: 'money', list: 1 },
    { key: 'notes', label: 'توضیحات', type: 'textarea' },
  ],
  detailTabs: ['info', 'items', 'timeline', 'comments', 'attachments'],
};

R.stock_transaction = {
  table: 'stock_transactions', entity: 'stock_transaction', nameFa: 'گردش موجودی', nameEn: 'Stock Movements', singularFa: 'گردش',
  // Section 8: search by product name/code, note and acting user (server-side)
  searchFields: ['note', 'ref_type', '(SELECT name FROM products WHERE id=stock_transactions.product_id)', '(SELECT code FROM products WHERE id=stock_transactions.product_id)', '(SELECT full_name FROM users WHERE id=stock_transactions.user_id)'],
  fields: [
    { key: 'product_id', label: 'کالا', type: 'ref', ref: 'product', required: 1, list: 1, filter: 1 },
    { key: 'type', label: 'نوع', type: 'select', options: 'stockTypes', list: 1, filter: 1 },
    { key: 'qty', label: 'مقدار', type: 'number', list: 1 },
    { key: 'note', label: 'توضیح', type: 'text', list: 1 },
    { key: 'ref_type', label: 'مستند', type: 'text' },
    { key: 'ref_id', label: 'کد مستند', type: 'number' },
    { key: 'user_id', label: 'کاربر', type: 'ref', ref: 'users', list: 1 },
    { key: 'created_at', label: 'تاریخ', type: 'datetime', list: 1 },
  ],
  detailTabs: [],
};

R.stock_alert = {
  table: 'stock_alerts', entity: 'stock_alert', nameFa: 'هشدارهای موجودی', nameEn: 'Stock Alerts', singularFa: 'هشدار',
  // Section 8: search by product name/code and alert message (server-side)
  searchFields: ['message', 'level', '(SELECT name FROM products WHERE id=stock_alerts.product_id)', '(SELECT code FROM products WHERE id=stock_alerts.product_id)'],
  fields: [
    { key: 'product_id', label: 'کالا', type: 'ref', ref: 'product', required: 1, list: 1 },
    { key: 'level', label: 'سطح', type: 'text', list: 1 },
    { key: 'message', label: 'پیام', type: 'text', list: 1 },
    { key: 'created_at', label: 'تاریخ', type: 'datetime', list: 1 },
    { key: 'resolved_at', label: 'برطرف‌شده', type: 'datetime' },
  ],
  detailTabs: [],
};

R.lab_request = {
  table: 'lab_requests', entity: 'lab_request', nameFa: 'درخواست‌های آزمایش', nameEn: 'Lab Requests', singularFa: 'درخواست آزمایش',
  numberPrefix: 'LR', searchFields: ['number', 'sample_desc', 'test_type', '(SELECT name FROM customers WHERE id=lab_requests.customer_id)'],
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', list: 1, filter: 1 },
    { key: 'order_id', label: 'سفارش مرتبط', type: 'ref', ref: 'order' },
    { key: 'sample_desc', label: 'شرح نمونه', type: 'text', list: 1 },
    { key: 'sample_code', label: 'کد نمونه', type: 'text' },
    { key: 'test_type', label: 'نوع آزمون', type: 'select', options: 'labTests', list: 1, filter: 1 },
    { key: 'priority', label: 'اولویت', type: 'select', options: 'priorities', default: 'low', list: 1, filter: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'labStatuses', default: 'received', list: 1, filter: 1 },
    { key: 'received_at', label: 'تاریخ دریافت', type: 'date', list: 1, defaultNow: 1 },
    { key: 'due_at', label: 'سررسید', type: 'date', list: 1 },
    { key: 'analyst_id', label: 'آزمایشگر', type: 'ref', ref: 'users', list: 1 },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
  ],
  detailTabs: ['info', 'results', 'timeline', 'comments', 'attachments'],
};

R.lab_result = {
  table: 'lab_results', entity: 'lab_result', nameFa: 'نتایج آزمایش', nameEn: 'Lab Results', singularFa: 'نتیجه آزمایش',
  searchFields: ['test_name', 'method', 'result_value', 'spec_text', 'analyst', 'status'],
  fields: [
    { key: 'request_id', label: 'درخواست', type: 'ref', ref: 'lab_request', required: 1, list: 1, filter: 1 },
    { key: 'test_name', label: 'نام آزمون', type: 'text', required: 1, list: 1 },
    { key: 'method', label: 'روش', type: 'text' },
    { key: 'result_value', label: 'نتیجه', type: 'text', list: 1 },
    { key: 'unit', label: 'واحد', type: 'text' },
    { key: 'spec_text', label: 'محدوده مجاز', type: 'text' },
    { key: 'status', label: 'وضعیت', type: 'select', options: [{ v: 'pending', l: 'در انتظار' }, { v: 'pass', l: 'مطابق' }, { v: 'fail', l: 'نامطابق' }], default: 'pending', list: 1, filter: 1 },
    { key: 'analyst', label: 'آزمایشگر', type: 'text' },
    { key: 'test_date', label: 'تاریخ آزمون', type: 'date' },
    { key: 'notes', label: 'یادداشت', type: 'text' },
  ],
  detailTabs: ['info'],
};

R.complaint = {
  table: 'complaints', entity: 'complaint', nameFa: 'شکایات', nameEn: 'Complaints', singularFa: 'شکایت',
  numberPrefix: 'CMP', searchFields: ['subject', 'description', 'number'],
  scopeField: 'assigned_to', scopeFallback: 'created_by',
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'product_id', label: 'محصول (از Product Master)', type: 'ref', ref: 'product', list: 1, filter: 1 },
    { key: 'referred_team', label: 'ارجاع به (تیم)', type: 'select', options: 'complaintTeams', list: 1, filter: 1 },
    { key: 'source', label: 'منبع', type: 'select', options: 'complaintSources', default: 'manual', list: 1, filter: 1 },
    { key: 'category', label: 'دسته', type: 'select', options: 'complaintCategories', list: 1, filter: 1 },
    { key: 'defect_family', label: 'خانواده محصول (بانک عیب)', type: 'select', options: 'complaintDefectFamilies', list: 1, filter: 1 },
    { key: 'defect_type', label: 'ویژگی مورد شکایت (نوع عیب)', type: 'text', list: 1, filter: 1 },
    { key: 'probable_cause', label: 'علت احتمالی', type: 'text' },
    { key: 'corrective_action', label: 'اقدام اصلاحی', type: 'textarea' },
    { key: 'preventive_action', label: 'اقدام پیشگیرانه', type: 'textarea' },
    { key: 'review_result', label: 'نتیجه بررسی', type: 'textarea' },
    { key: 'subject', label: 'موضوع', type: 'text', required: 1, list: 1 },
    { key: 'description', label: 'شرح', type: 'textarea' },
    { key: 'priority', label: 'اولویت', type: 'select', options: 'priorities', default: 'medium', list: 1, filter: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'complaintStatuses', default: 'new', list: 1, filter: 1 },
    { key: 'assigned_to', label: 'مسئول', type: 'ref', ref: 'users', list: 1, filter: 1 },
    { key: 'department', label: 'واحد مربوطه', type: 'select', options: 'departments' },
    { key: 'sla_hours', label: 'SLA (ساعت)', type: 'number', default: 48 },
    { key: 'due_at', label: 'سررسید SLA', type: 'datetime', list: 1 },
    { key: 'resolved_at', label: 'زمان حل', type: 'datetime' },
    { key: 'sentiment_score', label: 'احساسات (AI)', type: 'number' },
    { key: 'ai_category', label: 'دسته‌بندی AI', type: 'text' },
    { key: 'ai_root_cause', label: 'علت ریشه‌ای (AI)', type: 'text' },
    { key: 'repeat_of', label: 'تکراری از', type: 'number' },
    { key: 'csat', label: 'رضایت (۱-۵)', type: 'number' },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
  ],
  detailTabs: ['info', 'timeline', 'comments', 'attachments', 'tags'],
};

R.ticket = {
  table: 'tickets', entity: 'ticket', nameFa: 'تیکت‌ها', nameEn: 'Tickets', singularFa: 'تیکت',
  numberPrefix: 'TKT', searchFields: ['subject', 'description', 'number'],
  scopeField: 'assigned_to', scopeFallback: 'created_by',
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'type', label: 'نوع', type: 'select', options: 'ticketTypes', default: 'service', list: 1, filter: 1 },
    { key: 'subject', label: 'موضوع', type: 'text', required: 1, list: 1 },
    { key: 'description', label: 'شرح', type: 'textarea' },
    { key: 'priority', label: 'اولویت', type: 'select', options: 'priorities', default: 'medium', list: 1, filter: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'ticketStatuses', default: 'open', list: 1, filter: 1 },
    { key: 'assigned_to', label: 'مسئول', type: 'ref', ref: 'users', list: 1 },
    { key: 'sla_due_at', label: 'سررسید SLA', type: 'datetime', list: 1 },
    { key: 'resolved_at', label: 'زمان حل', type: 'datetime' },
    { key: 'related_complaint_id', label: 'شکایت مرتبط', type: 'number' },
    { key: 'csat', label: 'رضایت (۱-۵)', type: 'number' },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
  ],
  detailTabs: ['info', 'timeline', 'comments', 'attachments'],
};

R.warranty = {
  table: 'warranties', entity: 'warranty', nameFa: 'گارانتی', nameEn: 'Warranties', singularFa: 'گارانتی',
  searchFields: ['product_name', 'serial', 'notes', '(SELECT name FROM customers WHERE id=warranties.customer_id)'],
  fields: [
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', required: 1, list: 1, filter: 1 },
    { key: 'order_id', label: 'سفارش', type: 'ref', ref: 'order' },
    { key: 'product_name', label: 'محصول', type: 'text', list: 1 },
    { key: 'serial', label: 'سریال', type: 'text' },
    { key: 'start_date', label: 'شروع', type: 'date', list: 1 },
    { key: 'end_date', label: 'پایان', type: 'date', list: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: [{ v: 'active', l: 'فعال' }, { v: 'expired', l: 'منقضی' }, { v: 'claim', l: 'در حال ادعا' }], default: 'active', list: 1, filter: 1 },
    { key: 'notes', label: 'یادداشت', type: 'text' },
  ],
  detailTabs: ['info'],
};

R.contract = {
  table: 'contracts', entity: 'contract', nameFa: 'قراردادها', nameEn: 'Contracts', singularFa: 'قرارداد',
  numberPrefix: 'CT', searchFields: ['title', 'number'],
  fields: [
    { key: 'number', label: 'شماره', type: 'text', readonly: 1, list: 1 },
    { key: 'title', label: 'عنوان', type: 'text', required: 1, list: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', list: 1 },
    { key: 'supplier_id', label: 'تأمین‌کننده', type: 'ref', ref: 'supplier', list: 1 },
    { key: 'type', label: 'نوع', type: 'select', options: [{ v: 'sales', l: 'فروش' }, { v: 'service', l: 'خدمات' }, { v: 'warranty', l: 'گارانتی' }, { v: 'other', l: 'سایر' }], list: 1, filter: 1 },
    { key: 'start_date', label: 'شروع', type: 'date', list: 1 },
    { key: 'end_date', label: 'پایان', type: 'date', list: 1 },
    { key: 'value', label: 'مبلغ (ریال)', type: 'money', list: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'contractStatuses', default: 'draft', list: 1, filter: 1 },
    { key: 'file', label: 'فایل قرارداد', type: 'text', readonly: 1 },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
  ],
  detailTabs: ['info', 'attachments', 'timeline'],
};

R.campaign = {
  table: 'campaigns', entity: 'campaign', nameFa: 'کمپین‌های بازاریابی', nameEn: 'Campaigns', singularFa: 'کمپین',
  fields: [
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1 },
    { key: 'channel', label: 'کانال', type: 'select', options: [{ v: 'sms', l: 'پیامک' }, { v: 'email', l: 'ایمیل' }, { v: 'whatsapp', l: 'واتساپ' }], list: 1, filter: 1 },
    { key: 'subject', label: 'موضوع (ایمیل)', type: 'text' },
    { key: 'message', label: 'متن پیام', type: 'textarea', required: 1 },
    { key: 'audience_filter', label: 'مخاطبین (فیلتر JSON)', type: 'json' },
    { key: 'schedule_at', label: 'زمان ارسال', type: 'datetime' },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'campaignStatuses', default: 'draft', list: 1, filter: 1 },
    { key: 'total', label: 'مخاطب', type: 'number', readonly: 1, list: 1 },
    { key: 'sent_count', label: 'ارسال‌شده', type: 'number', readonly: 1, list: 1 },
    { key: 'delivered_count', label: 'تحویل‌شده', type: 'number', readonly: 1 },
    { key: 'opened_count', label: 'بازشده', type: 'number', readonly: 1 },
    { key: 'clicked_count', label: 'کلیک‌شده', type: 'number', readonly: 1 },
    { key: 'converted_count', label: 'تبدیل‌شده', type: 'number', readonly: 1 },
    { key: 'error', label: 'خطا', type: 'text', readonly: 1 },
  ],
  detailTabs: ['info', 'recipients'],
};

R.loyalty_tier = {
  table: 'loyalty_tiers', entity: 'loyalty_tier', nameFa: 'سطوح باشگاه مشتریان', nameEn: 'Loyalty Tiers', singularFa: 'سطح',
  fields: [
    { key: 'name', label: 'نام سطح', type: 'text', required: 1, list: 1 },
    { key: 'min_points', label: 'حداقل امتیاز', type: 'number', list: 1 },
    { key: 'discount_pct', label: 'تخفیف %', type: 'number', list: 1 },
    { key: 'color', label: 'رنگ', type: 'text' },
  ],
};

R.meeting = {
  table: 'meetings', entity: 'meeting', nameFa: 'جلسات', nameEn: 'Meetings', singularFa: 'جلسه',
  searchFields: ['title', 'location', 'description', 'notes'],
  fields: [
    { key: 'title', label: 'عنوان', type: 'text', required: 1, list: 1 },
    { key: 'meeting_type', label: 'نوع جلسه', type: 'select', options: [
      { v: 'internal', l: 'جلسه داخلی' }, { v: 'customer', l: 'جلسه با مشتری' },
      { v: 'supplier', l: 'جلسه با تأمین‌کننده' }, { v: 'other', l: 'جلسه با سایر اشخاص' },
    ], default: 'internal', list: 1, filter: 1 },
    { key: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customer', list: 1, filter: 1 },
    { key: 'contact_id', label: 'مخاطب مرتبط', type: 'number' },
    { key: 'start_at', label: 'شروع', type: 'datetime', required: 1, list: 1 },
    { key: 'end_at', label: 'پایان', type: 'datetime' },
    { key: 'mode', label: 'نوع برگزاری', type: 'select', options: [{ v: 'inperson', l: 'حضوری' }, { v: 'online', l: 'آنلاین' }], default: 'inperson' },
    { key: 'online_url', label: 'لینک جلسه آنلاین', type: 'text' },
    { key: 'location', label: 'محل جلسه', type: 'text', list: 1 },
    { key: 'organizer_id', label: 'برگزارکننده', type: 'ref', ref: 'users' },
    { key: 'participant_ids', label: 'اعضای داخلی شرکت (idها، ویرگول‌دار)', type: 'text' },
    { key: 'description', label: 'دستور جلسه', type: 'textarea' },
    { key: 'notes', label: 'صورتجلسه / نتیجه', type: 'textarea' },
    { key: 'reminder_minutes', label: 'یادآوری (دقیقه قبل)', type: 'number' },
    { key: 'status', label: 'وضعیت', type: 'select', options: [
      { v: 'scheduled', l: 'برنامه‌ریزی‌شده' }, { v: 'done', l: 'برگزارشده' },
      { v: 'cancelled', l: 'لغوشده' }, { v: 'postponed', l: 'به تعویق افتاده' },
    ], default: 'scheduled', list: 1, filter: 1 },
  ],
  detailTabs: ['info', 'timeline', 'comments'],
};

R.task = {
  table: 'tasks', entity: 'task', nameFa: 'وظایف', nameEn: 'Tasks', singularFa: 'وظیفه',
  scopeField: 'assignee_id', scopeFallback: 'created_by',
  searchFields: ['title', 'description', 'notes', 'result'],
  fields: [
    { key: 'title', label: 'عنوان', type: 'text', required: 1, list: 1 },
    { key: 'description', label: 'توضیحات', type: 'textarea' },
    { key: 'assignee_id', label: 'مسئول', type: 'ref', ref: 'users', list: 1, filter: 1 },
    { key: 'follower_id', label: 'پیگیری‌کننده', type: 'ref', ref: 'users', list: 1 },
    { key: 'related_type', label: 'رکورد مرتبط', type: 'text' },
    { key: 'related_id', label: 'شناسه رکورد', type: 'number' },
    { key: 'priority', label: 'اولویت', type: 'select', options: 'priorities', default: 'medium', list: 1, filter: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: 'taskStatuses', default: 'open', list: 1, filter: 1 },
    { key: 'due_at', label: 'مهلت', type: 'datetime', list: 1 },
    { key: 'completed_at', label: 'زمان انجام', type: 'datetime', readonly: 1 },
    { key: 'notes', label: 'یادداشت', type: 'textarea' },
    { key: 'result', label: 'نتیجه', type: 'textarea' },
  ],
  detailTabs: ['info', 'timeline', 'comments'],
};

R.followup = {
  table: 'followups', entity: 'followup', nameFa: 'پیگیری‌ها', nameEn: 'Follow-ups', singularFa: 'پیگیری',
  searchFields: ['subject', 'note'],
  fields: [
    { key: 'entity_type', label: 'نوع رکورد', type: 'text', list: 1 },
    { key: 'entity_id', label: 'شناسه', type: 'number', list: 1 },
    { key: 'user_id', label: 'مسئول', type: 'ref', ref: 'users', list: 1, filter: 1 },
    { key: 'subject', label: 'موضوع', type: 'text', list: 1 },
    { key: 'note', label: 'توضیح', type: 'text' },
    { key: 'due_at', label: 'زمان', type: 'datetime', required: 1, list: 1 },
    { key: 'status', label: 'وضعیت', type: 'select', options: [{ v: 'pending', l: 'باز (Open)' }, { v: 'in_progress', l: 'در حال پیگیری (In Progress)' }, { v: 'done', l: 'پایان‌بندی شد (Completed)' }, { v: 'no_result', l: 'بدون نتیجه (No Result)' }, { v: 'missed', l: 'از دست‌رفته (Missed)' }, { v: 'cancelled', l: 'لغو (Cancelled)' }], default: 'pending', list: 1, filter: 1 },
    { key: 'done_at', label: 'زمان انجام', type: 'datetime', readonly: 1 },
  ],
  detailTabs: [],
};

R.document = {
  table: 'documents', entity: 'document', nameFa: 'اسناد', nameEn: 'Documents', singularFa: 'سند',
  searchFields: ['title', 'text_content', 'category'],
  fields: [
    { key: 'title', label: 'عنوان', type: 'text', required: 1, list: 1 },
    { key: 'kind', label: 'نوع', type: 'select', options: [{ v: 'kb', l: 'پایگاه دانش AI' }, { v: 'library', l: 'کتابخانه' }, { v: 'contract', l: 'قرارداد' }, { v: 'tech', l: 'فنی' }, { v: 'sop', l: 'دستورالعمل' }, { v: 'faq', l: 'پرسش‌پاسخ' }, { v: 'product', l: 'محصول' }], default: 'library', list: 1, filter: 1 },
    { key: 'category', label: 'دسته', type: 'text', list: 1 },
    { key: 'file_name', label: 'فایل', type: 'text', readonly: 1, list: 1 },
    { key: 'text_content', label: 'متن (برای جستجوی AI)', type: 'textarea' },
    { key: 'tags', label: 'برچسب‌ها (ویرگول‌دار)', type: 'text' },
  ],
  detailTabs: ['info', 'timeline'],
};

R.workflow_rule = {
  table: 'workflow_rules', entity: 'workflow_rule', nameFa: 'قوانین Workflow', nameEn: 'Workflow Rules', singularFa: 'قانون',
  fields: [
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1 },
    { key: 'event', label: 'رویداد', type: 'select', options: 'workflowEvents', list: 1 },
    { key: 'conditions', label: 'شرایط (JSON)', type: 'json' },
    { key: 'actions', label: 'اقدامات (JSON)', type: 'json' },
    { key: 'active', label: 'فعال', type: 'bool', default: 1 },
  ],
  detailTabs: [],
};

R.tag = {
  table: 'tags', entity: 'tag', nameFa: 'برچسب‌ها', nameEn: 'Tags', singularFa: 'برچسب',
  fields: [
    { key: 'name', label: 'نام', type: 'text', required: 1, list: 1 },
    { key: 'color', label: 'رنگ', type: 'text', default: '#c9a227', list: 1 },
  ],
  detailTabs: [],
};

R.report_definition = {
  table: 'report_definitions', entity: 'report_definition', nameFa: 'گزارش‌های ذخیره‌شده', nameEn: 'Saved Reports', singularFa: 'گزارش',
  fields: [
    { key: 'name', label: 'نام گزارش', type: 'text', required: 1, list: 1 },
    { key: 'source', label: 'منبع', type: 'text', list: 1 },
    { key: 'columns', label: 'ستون‌ها', type: 'json', readonly: 1 },
    { key: 'filters', label: 'فیلترها', type: 'json', readonly: 1 },
    { key: 'group_by', label: 'گروه‌بندی', type: 'text' },
    { key: 'sort', label: 'مرتب‌سازی', type: 'text' },
  ],
  detailTabs: [],
};

// option pools
const OPT = {
  provinces: ['آذربایجان شرقی','آذربایجان غربی','اردبیل','اصفهان','البرز','ایلام','بوشهر','چهارمحال و بختیاری','خراسان جنوبی','خراسان رضوی','خراسان شمالی','خوزستان','زنجان','سمنان','سیستان و بلوچستان','فارس','گیلان','گلستان','کردستان','کهگیلویه و بویراحمد','کرمان','قزوین','قم','لرستان','مازندران','مرکزی','هرمزگان','همدان','یزد','تهران'],
  industries: ['فوم و اسفنج','تولید تشک','بسته‌بندی','مبلمان','بهداشتی','صنایع شیمیایی','تأمین‌کننده','صادرات','سایر'],
  leadSources: [{ v: 'website', l: 'وب‌سایت' }, { v: 'instagram', l: 'اینستاگرام' }, { v: 'whatsapp', l: 'واتساپ' }, { v: 'phone', l: 'تلفن' }, { v: 'sms', l: 'پیامک' }, { v: 'referral', l: 'معرفی' }, { v: 'exhibition', l: 'نمایشگاه' }, { v: 'existing', l: 'مشتری فعلی' }, { v: 'manual', l: 'دستی' }, { v: 'other', l: 'سایر' }],
  leadStatuses: [{ v: 'new', l: 'جدید' }, { v: 'contacted', l: 'تماس‌گرفته' }, { v: 'qualified', l: 'تأییدشده' }, { v: 'converted', l: 'تبدیل‌شده به مشتری' }, { v: 'lost', l: 'از دست‌رفته' }],
  oppStatuses: [{ v: 'open', l: 'باز' }, { v: 'won', l: 'موفق' }, { v: 'lost', l: 'ناموفق' }],
  quoteStatuses: [{ v: 'draft', l: 'پیش‌نویس' }, { v: 'sent', l: 'ارسال‌شده' }, { v: 'viewed', l: 'مشاهده‌شده' }, { v: 'accepted', l: 'پذیرفته‌شده' }, { v: 'declined', l: 'ردشده' }, { v: 'converted', l: 'تبدیل‌شده به سفارش' }, { v: 'expired', l: 'منقضی' }, { v: 'cancelled', l: 'لغوشده' }],
  orderStatuses: [{ v: 'draft', l: 'پیش‌نویس' }, { v: 'confirmed', l: 'تأییدشده' }, { v: 'in_production', l: 'در حال تولید' }, { v: 'ready', l: 'آماده ارسال' }, { v: 'shipped', l: 'ارسال‌شده' }, { v: 'delivered', l: 'تحویل‌شده' }, { v: 'cancelled', l: 'لغوشده' }, { v: 'returned', l: 'بازگشتی' }],
  invoiceStatuses: [{ v: 'unpaid', l: 'پرداخت‌نشده' }, { v: 'partial', l: 'پرداخت‌جزئی' }, { v: 'paid', l: 'پرداخت‌شده' }, { v: 'overdue', l: 'سررسیدگذشته' }, { v: 'cancelled', l: 'لغوشده' }],
  taxStatuses: [{ v: 'unsent', l: 'فرستاده‌نشده' }, { v: 'sent', l: 'ارسال‌شده' }, { v: 'confirmed', l: 'تأییدشده' }, { v: 'rejected', l: 'ردشده' }],
  payMethods: [{ v: 'cash', l: 'نقدی' }, { v: 'card', l: 'کارت' }, { v: 'bank', l: 'انتقال بانکی / حواله' }, { v: 'check', l: 'چک' }, { v: 'installment', l: 'قسطی' }, { v: 'other', l: 'سایر' }],
  payStatuses: [{ v: 'pending', l: 'در انتظار' }, { v: 'paid', l: 'ثبت‌شده' }, { v: 'failed', l: 'ناموفق' }, { v: 'cancelled', l: 'لغوشده' }, { v: 'refunded', l: 'برگشت‌خورده' }],
  supplierCategories: [{ v: 'polyl', l: 'پلی‌ول' }, { v: 'mdi', l: 'MDI / ایزوسیانات' }, { v: 'chemical', l: 'مواد شیمیایی' }, { v: 'packaging', l: 'بسته‌بندی' }, { v: 'machine', l: 'ماشین‌آلات' }, { v: 'other', l: 'سایر' }],
  poStatuses: [{ v: 'draft', l: 'پیش‌نویس' }, { v: 'sent', l: 'ارسال‌شده' }, { v: 'partial', l: 'تحویل جزئی' }, { v: 'received', l: 'تحویل‌شده' }, { v: 'cancelled', l: 'لغوشده' }],
  stockTypes: [{ v: 'in', l: 'ورود' }, { v: 'out', l: 'خروج' }, { v: 'transfer', l: 'انتقال' }, { v: 'adjust', l: 'اصلاح' }, { v: 'reservation', l: 'رزرو' }],
  labTests: [{ v: 'density', l: 'چگالی' }, { v: 'compress', l: 'مقاومت فشاری' }, { v: 'tensile', l: 'مقاومت کششی' }, { v: 'rebound', l: 'بازگشت ارتجاعی' }, { v: 'flame', l: 'آزمون شعله' }, { v: 'dimension', l: 'ابعاد و اندازه' }, { v: 'chemical', l: 'ترکیب شیمیایی' }, { v: 'other', l: 'سایر' }],
  labStatuses: [{ v: 'received', l: 'دریافت‌شده' }, { v: 'in_progress', l: 'در حال انجام' }, { v: 'done', l: 'انجام‌شده' }, { v: 'reported', l: 'گزارش‌شده' }, { v: 'cancelled', l: 'لغوشده' }],
  priorities: [{ v: 'low', l: 'کم' }, { v: 'medium', l: 'متوسط' }, { v: 'high', l: 'زیاد' }, { v: 'critical', l: 'بحرانی' }],
  complaintSources: [{ v: 'phone', l: 'تلفن' }, { v: 'sms', l: 'پیامک' }, { v: 'website', l: 'وب‌سایت' }, { v: 'instagram', l: 'اینستاگرام' }, { v: 'whatsapp', l: 'واتساپ' }, { v: 'portal', l: 'پورتال' }, { v: 'email', l: 'ایمیل' }, { v: 'manual', l: 'دستی' }],
  complaintCategories: [{ v: 'quality', l: 'کیفیت' }, { v: 'product', l: 'محصول' }, { v: 'shipping', l: 'ارسال' }, { v: 'delay', l: 'تأخیر' }, { v: 'financial', l: 'مالی' }, { v: 'service', l: 'خدمات' }, { v: 'laboratory', l: 'آزمایشگاه' }, { v: 'sales', l: 'فروش' }, { v: 'other', l: 'سایر' }],
  complaintStatuses: [{ v: 'new', l: 'جدید' }, { v: 'in_progress', l: 'در حال بررسی' }, { v: 'waiting', l: 'در انتظار' }, { v: 'resolved', l: 'حل‌شده' }, { v: 'closed', l: 'بسته‌شده' }, { v: 'rejected', l: 'ردشده' }],
  complaintTeams: [{ v: 'CFT', l: 'CFT' }, { v: 'quality', l: 'کیفیت' }, { v: 'production', l: 'تولید' }, { v: 'lab', l: 'آزمایشگاه' }, { v: 'support', l: 'پشتیبانی' }, { v: 'sales', l: 'فروش' }, { v: 'finance', l: 'مالی' }, { v: 'other', l: 'سایر' }],
  complaintDefectFamilies: [{ v: 'foam_sponge', l: 'فوم و اسفنج' }, { v: 'polyurethane', l: 'مواد اولیه پلی‌یورتان' }, { v: 'foam_mattress', l: 'تشک تمام‌فوم' }, { v: 'bed_related', l: 'تشک و محصولات مرتبط با تخت' }, { v: 'other', l: 'سایر' }],
  ticketTypes: [{ v: 'warranty', l: 'گارانتی' }, { v: 'technical', l: 'فنی' }, { v: 'service', l: 'خدمات' }, { v: 'other', l: 'سایر' }],
  ticketStatuses: [{ v: 'open', l: 'باز' }, { v: 'in_progress', l: 'در حال انجام' }, { v: 'waiting', l: 'در انتظار' }, { v: 'resolved', l: 'حل‌شده' }, { v: 'closed', l: 'بسته‌شده' }],
  contractStatuses: [{ v: 'draft', l: 'پیش‌نویس' }, { v: 'active', l: 'فعال' }, { v: 'expired', l: 'منقضی' }, { v: 'terminated', l: 'فسخ‌شده' }],
  campaignStatuses: [{ v: 'draft', l: 'پیش‌نویس' }, { v: 'scheduled', l: 'زمان‌بندی‌شده' }, { v: 'sending', l: 'در حال ارسال' }, { v: 'sent', l: 'ارسال‌شده' }, { v: 'done', l: 'پایان‌یافته' }, { v: 'failed', l: 'ناموفق' }],
  taskStatuses: [{ v: 'open', l: 'در انتظار' }, { v: 'in_progress', l: 'در حال انجام' }, { v: 'blocked', l: 'مسدود' }, { v: 'done', l: 'انجام‌شده' }, { v: 'cancelled', l: 'لغوشده' }],
  departments: [{ v: 'sales', l: 'فروش' }, { v: 'finance', l: 'مالی' }, { v: 'production', l: 'تولید' }, { v: 'quality', l: 'کیفیت' }, { v: 'lab', l: 'آزمایشگاه' }, { v: 'warehouse', l: 'انبار' }, { v: 'marketing', l: 'بازاریابی' }, { v: 'support', l: 'پشتیبانی' }, { v: 'rd', l: 'تحقیق و توسعه' }],
  workflowEvents: [
    { v: 'opportunity_stage_changed', l: 'تغییر مرحله فرصت فروش (Pipeline)' },
    { v: 'complaint_created', l: 'ثبت شکایت' },
    { v: 'lead_created', l: 'ثبت سرنخ' },
    { v: 'opportunity_won', l: 'موفقیت فرصت فروش' },
    { v: 'invoice_overdue', l: 'سررسیدگذشتن فاکتور' },
    { v: 'stock_low', l: 'کمبود موجودی' },
    { v: 'customer_created', l: 'ثبت مشتری' },
    { v: 'quote_created', l: 'صدور پیش‌فاکتور' },
    { v: 'order_created', l: 'ثبت سفارش' },
  ],
};
function resolveOptions(opts) {
  if (typeof opts === 'string') return OPT[opts] || [];
  return opts;
}
module.exports = { R, OPT, resolveOptions };
