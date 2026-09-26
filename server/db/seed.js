'use strict';
// Runs automatically on first start (also: npm run seed)
const { get, setSetting, getSetting } = require('./db');
const { hashPassword } = require('../lib/crypto');
const { nowIso } = require('../lib/util');
const { jalaaliToGregorian } = require('../lib/jalali');
const { notify } = require('../core/notify');

// "Delete demo data" (Admin → Settings) wipes the business tables *and* the reference
// data seedCore() owns (pipelines, pipeline_stages, products, categories, price lists),
// but `settings.seeded_core` stays set — so the next start skipped seedCore() and
// seedDemo() then died on the missing default pipeline. The sample dataset could never be
// recreated and the Pipeline / Products / Pricing modules were left empty.
// Detect that state and re-run the (idempotent) core seeding.
function coreReferenceMissing() {
  const d = get();
  const count = (t) => { try { return d.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return 1; } };
  return count('pipelines') === 0 || count('pipeline_stages') === 0 || count('product_categories') === 0;
}
function run() {
  const d = get();
  if (getSetting('seeded_core') && !coreReferenceMissing()) { maybeDemo(); seedWorkflowTemplates(); return; }
  if (getSetting('seeded_core') && coreReferenceMissing()) console.log('[seed] core reference data missing (demo data was deleted) — re-seeding core');
  seedCore();
  maybeDemo();
  seedWorkflowTemplates();
}
// ---------------------------------------------------------------------------
// Real, executable workflow templates (Workflow Visual Engine).
// Idempotent: INSERT OR IGNORE by unique key — safe on every start.
// These are PUBLISHED active processes that really run on real CRM events.
// ---------------------------------------------------------------------------
function wfSeed(d, key, name, module, trigger, description, def) {
  const ts = nowIso();
  const exists = d.prepare('SELECT id FROM wf_processes WHERE key=?').get(key);
  if (exists) return;
  const info = d.prepare('INSERT INTO wf_processes(key, name, module, description, trigger_event, trigger_value, active, current_version, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,1,1,1,?,?)')
    .run(key, name, module, description, trigger, '', ts, ts);
  const pid = Number(info.lastInsertRowid);
  d.prepare('INSERT INTO wf_versions(process_id, version, definition, change_note, active, created_by, created_at) VALUES(?,?,?,?,1,1,?)')
    .run(pid, 1, JSON.stringify(def), 'تیمپلیت اولیه', ts);
}
function seedWorkflowTemplates() {
  const d = get();
  try {
    // ---------- 1) Full sales chain (Customer → Proforma → 3× approval+signature → Order → Warehouse → Invoice → Finance → Done)
    wfSeed(d, 'tpl_sales_chain', 'فرآیند فروش کامل (پیش‌فاکتور تا فاکتور)', 'customer', 'created',
      'Template اصلی شرکت: مشتری ← پیگیری خوش‌آمد ← پیش‌فاکتور ← تأیید+امضای مدیر فروش/مالی/مدیرعامل ← سفارش ← انبار ← فاکتور ← تسویه',
      {
        nodes: [
          { id: 'start', type: 'start', title: 'شروع (مشتری جدید)', x: 40, y: 240 },
          { id: 'n_fu', type: 'action', title: 'ایجاد پیگیری خوش‌آمد', action: 'followup.create', params: { subject: 'پیگیری خوش‌آمد مشتری جدید: {{customer.name}}', due_days: 1, assign: 'customer.salesperson_id' }, x: 240, y: 240 },
          { id: 'n_msg', type: 'message', title: 'ارسال پیام خوش‌آمد (WhatsApp)', params: { channel: 'whatsapp', recipient: 'customer.mobile', template: 'سلام {{customer.name}}، خوش آمدید به بسپار فوم غرب. کارشناس فروش شما به‌زودی با شما تماس می‌گیرد.' }, on_error: 'continue', x: 440, y: 240 },
          { id: 'n_quote', type: 'action', title: 'ایجاد پیش‌فاکتور اولیه', action: 'quote.create', params: { tax_rate: 9 }, x: 640, y: 240 },
          { id: 'n_appr1', type: 'approval', title: 'تأیید مدیر فروش', assignee_type: 'role', assignee: 'sales_manager', x: 840, y: 240 },
          { id: 'n_sig1', type: 'signature', title: 'امضای مدیر فروش', assignee_type: 'role', assignee: 'sales_manager', x: 1040, y: 240 },
          { id: 'n_appr2', type: 'approval', title: 'تأیید مدیر مالی', assignee_type: 'role', assignee: 'finance_manager', x: 1240, y: 240 },
          { id: 'n_sig2', type: 'signature', title: 'امضای مدیر مالی', assignee_type: 'role', assignee: 'finance_manager', x: 1440, y: 240 },
          { id: 'n_appr3', type: 'approval', title: 'تأیید مدیرعامل', assignee_type: 'role', assignee: 'ceo', x: 1640, y: 240 },
          { id: 'n_sig3', type: 'signature', title: 'امضای مدیرعامل', assignee_type: 'role', assignee: 'ceo', x: 1840, y: 240 },
          { id: 'n_order', type: 'action', title: 'تبدیل به سفارش', action: 'order.create', params: {}, x: 2040, y: 240 },
          { id: 'n_wh', type: 'task', title: 'آماده‌سازی انبار', assignee_type: 'role', assignee: 'warehouse_manager', x: 2240, y: 240 },
          { id: 'n_inv', type: 'action', title: 'صدور فاکتور', action: 'invoice.create', params: {}, x: 2440, y: 240 },
          { id: 'n_fin', type: 'notification', title: 'اعلان واحد مالی', params: { recipients: { roles: ['finance', 'finance_manager'] }, title: 'فاکتور جدید صادر شد: {{invoice.number}}', body: 'لطفاً رسیدگی فرمایید.' }, x: 2640, y: 240 },
          { id: 'end', type: 'end', title: 'پایان', x: 2840, y: 240 },
        ],
        edges: [
          { from: 'start', to: 'n_fu', label: '' }, { from: 'n_fu', to: 'n_msg', label: '' },
          { from: 'n_msg', to: 'n_quote', label: '' }, { from: 'n_quote', to: 'n_appr1', label: '' },
          { from: 'n_appr1', to: 'n_sig1', label: 'approve' }, { from: 'n_appr1', to: 'end', label: 'reject' },
          { from: 'n_sig1', to: 'n_appr2', label: '' }, { from: 'n_appr2', to: 'n_sig2', label: 'approve' }, { from: 'n_appr2', to: 'end', label: 'reject' },
          { from: 'n_sig2', to: 'n_appr3', label: '' }, { from: 'n_appr3', to: 'n_sig3', label: 'approve' }, { from: 'n_appr3', to: 'end', label: 'reject' },
          { from: 'n_sig3', to: 'n_order', label: '' }, { from: 'n_order', to: 'n_wh', label: '' },
          { from: 'n_wh', to: 'n_inv', label: '' }, { from: 'n_inv', to: 'n_fin', label: '' },
          { from: 'n_fin', to: 'end', label: '' },
        ],
      });
    // ---------- 2) Complaint
    wfSeed(d, 'tpl_complaint', 'فرآیند شکایت (کیفیت)', 'complaint', 'created',
      'Template شکایت: اختصاص مدیر کیفیت ← وظیفه بررسی ← تحلیل ← شرط معتبر/نامعتبر ← اقدام اصلاحی یا اطلاع‌رسانی ← پیگیری ← بستن',
      {
        nodes: [
          { id: 'start', type: 'start', title: 'شروع (شکایت جدید)', x: 40, y: 240 },
          { id: 'n_assign', type: 'action', title: 'اختصاص به مدیر کیفیت', action: 'record.assign', params: { field: 'assigned_to', user: 'quality_manager' }, x: 240, y: 240 },
          { id: 'n_task', type: 'action', title: 'ایجاد وظیفه بررسی', action: 'task.create', params: { title: 'بررسی شکایت: {{complaint.subject}}', assign: 'complaint.assigned_to', due_days: 2, priority: 'high' }, x: 440, y: 240 },
          { id: 'n_analyze', type: 'task', title: 'تحلیل کیفیت', assignee_type: 'role', assignee: 'quality_manager', x: 640, y: 240 },
          { id: 'n_cond', type: 'condition', title: 'شکایت معتبر است؟', condition: { logic: 'AND', conditions: [{ field: 'complaint.status', op: 'neq', value: 'rejected' }] }, x: 840, y: 240 },
          { id: 'n_correct', type: 'action', title: 'ایجاد اقدام اصلاحی (Follow-up)', action: 'followup.create', params: { subject: 'اقدام اصلاحی شکایت: {{complaint.subject}}', due_days: 5, assign: 'complaint.assigned_to' }, x: 1040, y: 120 },
          { id: 'n_notify', type: 'notification', title: 'اطلاع‌رسانی به مشتری', params: { recipients: { roles: ['support'] }, title: 'شکایت نامعتبر: {{complaint.subject}}', body: 'نیاز به اطلاع‌رسانی به مشتری است.' }, x: 1040, y: 360 },
          { id: 'n_follow', type: 'action', title: 'پیگیری نهایی', action: 'followup.create', params: { subject: 'پیگیری نهایی شکایت: {{complaint.subject}}', due_days: 7 }, x: 1240, y: 240 },
          { id: 'n_close', type: 'action', title: 'بستن شکایت', action: 'record.set_status', params: { status: 'resolved' }, x: 1440, y: 240 },
          { id: 'end', type: 'end', title: 'پایان', x: 1640, y: 240 },
        ],
        edges: [
          { from: 'start', to: 'n_assign', label: '' }, { from: 'n_assign', to: 'n_task', label: '' },
          { from: 'n_task', to: 'n_analyze', label: '' }, { from: 'n_analyze', to: 'n_cond', label: '' },
          { from: 'n_cond', to: 'n_correct', label: 'true' }, { from: 'n_cond', to: 'n_notify', label: 'false' },
          { from: 'n_correct', to: 'n_follow', label: '' }, { from: 'n_notify', to: 'n_follow', label: '' },
          { from: 'n_follow', to: 'n_close', label: '' }, { from: 'n_close', to: 'end', label: '' },
        ],
      });
    // ---------- 3) Lab
    wfSeed(d, 'tpl_lab', 'فرآیند آزمایشگاه', 'lab_request', 'created',
      'Template آزمایشگاه: اختصاص آزمایشگاه ← دریافت نمونه ← آزمایش ← ثبت نتیجه ← بازبینی کیفیت ← تأیید ← ارسال نتیجه ← بستن',
      {
        nodes: [
          { id: 'start', type: 'start', title: 'شروع (درخواست آزمایش)', x: 40, y: 240 },
          { id: 'n_assign', type: 'action', title: 'اختصاص به آزمایشگاه', action: 'record.assign', params: { field: 'analyst_id', user: 'lab' }, x: 240, y: 240 },
          { id: 'n_receive', type: 'task', title: 'دریافت نمونه', assignee_type: 'role', assignee: 'lab', x: 440, y: 240 },
          { id: 'n_test', type: 'task', title: 'اجرای آزمایش', assignee_type: 'role', assignee: 'lab', x: 640, y: 240 },
          { id: 'n_result', type: 'action', title: 'ثبت نتیجه (فعال‌سازی نتیجه)', action: 'record.set_status', params: { status: 'in_progress' }, x: 840, y: 240 },
          { id: 'n_review', type: 'task', title: 'بازبینی کیفیت', assignee_type: 'role', assignee: 'quality_manager', x: 1040, y: 240 },
          { id: 'n_approve', type: 'approval', title: 'تأیید نهایی', assignee_type: 'role', assignee: 'quality_manager', x: 1240, y: 240 },
          { id: 'n_send', type: 'notification', title: 'ارسال نتیجه', params: { recipients: { roles: ['sales_manager'] }, title: 'نتیجه آزمایش: {{lab_request.number}}', body: 'نتیجه آزمایش آماده است.' }, x: 1440, y: 240 },
          { id: 'n_close', type: 'action', title: 'بستن درخواست', action: 'record.set_status', params: { status: 'done' }, x: 1640, y: 240 },
          { id: 'end', type: 'end', title: 'پایان', x: 1840, y: 240 },
        ],
        edges: [
          { from: 'start', to: 'n_assign', label: '' }, { from: 'n_assign', to: 'n_receive', label: '' },
          { from: 'n_receive', to: 'n_test', label: '' }, { from: 'n_test', to: 'n_result', label: '' },
          { from: 'n_result', to: 'n_review', label: '' }, { from: 'n_review', to: 'n_approve', label: '' },
          { from: 'n_approve', to: 'n_send', label: 'approve' }, { from: 'n_approve', to: 'end', label: 'reject' },
          { from: 'n_send', to: 'n_close', label: '' }, { from: 'n_close', to: 'end', label: '' },
        ],
      });
    // ---------- 4) Collections (invoice overdue)
    wfSeed(d, 'tpl_collections', 'فرآیند وصول مطالبات (فاکتور معوق)', 'invoice', 'overdue',
      'Template وصول: فاکتور سررسیدگذشته ← وظیفه وصول ← اختصاص مالی ← ارسال یادآوری ← ۳ روز انتظار ← شرط پرداخت‌شده؟ ← بستن یا تشدید به مدیر مالی',
      {
        nodes: [
          { id: 'start', type: 'start', title: 'شروع (فاکتور معوق)', x: 40, y: 240 },
          { id: 'n_task', type: 'action', title: 'ایجاد وظیفه وصول', action: 'task.create', params: { title: 'وصول مطالبات: {{invoice.number}}', due_days: 1, priority: 'high' }, x: 240, y: 240 },
          { id: 'n_notify_fin', type: 'notification', title: 'اختصاص به واحد مالی (اعلان)', params: { recipients: { roles: ['finance', 'finance_manager'] }, title: 'وصول مطالبات: {{invoice.number}}', body: 'فاکتور سررسید گذشته است — پیگیری تسویه.' }, x: 440, y: 240 },
          { id: 'n_remind', type: 'message', title: 'ارسال یادآوری به مشتری', params: { channel: 'sms', recipient: 'customer.phone', template: 'بازگشتی: فاکتور {{invoice.number}} شما سررسید گذشته است. لطفاً تسویه فرمایید.' }, on_error: 'continue', x: 640, y: 240 },
          { id: 'n_delay', type: 'delay', title: '۳ روز انتظار', params: { delay_value: 3, delay_unit: 'day' }, x: 840, y: 240 },
          { id: 'n_cond', type: 'condition', title: 'پرداخت شده؟', condition: { logic: 'AND', conditions: [{ field: 'invoice.status', op: 'eq', value: 'paid' }] }, x: 1040, y: 240 },
          { id: 'n_close', type: 'action', title: 'بستن (تسویه شد)', action: 'record.add_note', params: { text: 'مطالبات تسویه شد (Workflow).' }, x: 1240, y: 120 },
          { id: 'n_escalate', type: 'approval', title: 'تشدید به مدیر مالی', assignee_type: 'role', assignee: 'finance_manager', x: 1240, y: 360 },
          { id: 'end', type: 'end', title: 'پایان', x: 1500, y: 240 },
        ],
        edges: [
          { from: 'start', to: 'n_task', label: '' }, { from: 'n_task', to: 'n_assign', label: '' },
          { from: 'n_assign', to: 'n_remind', label: '' }, { from: 'n_remind', to: 'n_delay', label: '' },
          { from: 'n_delay', to: 'n_cond', label: '' },
          { from: 'n_cond', to: 'n_close', label: 'true' }, { from: 'n_cond', to: 'n_escalate', label: 'false' },
          { from: 'n_close', to: 'end', label: '' }, { from: 'n_escalate', to: 'end', label: 'approve' },
        ],
      });
    console.log('[seed] workflow templates ensured (4 templates)');
  } catch (e) {
    console.error('[seed] workflow templates failed:', e.message);
  }
}
// deterministic PRNG
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(1405);
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function ri(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
function rf(min, max, dec = 0) { return Number((rnd() * (max - min) + min).toFixed(dec)); }
// jalali date within range
function jDate(jy, jm, jd, h = 0) {
  const [gy, gm, gd] = jalaaliToGregorian(jy, jm, Math.min(jd, 30));
  return new Date(gy, gm - 1, gd, h, ri(0, 59)).toISOString();
}

function seedCore() {
  const d = get();
  const tx = d.transaction(() => {
    // ---------- roles ----------
    const roles = [
      ['super_admin', 'مدیر سیستم', 'دسترسی کامل'],
      ['ceo', 'مدیرعامل', 'داشبورد اجرایی، تأیید نهایی'],
      ['sales_manager', 'مدیر فروش', 'نظارت بر فروش و پورسانت'],
      ['sales', 'کارشناس فروش', 'مدیریت مشتریان و فروش'],
      ['finance_manager', 'مدیر مالی', 'فاکتور، پرداخت، مطالبات'],
      ['finance', 'کارشناس مالی', 'ثبت پرداخت و صورت‌حساب'],
      ['production_manager', 'مدیر تولید', 'سفارش‌ها و تولید'],
      ['quality_manager', 'مدیر کیفیت', 'شکایات و کنترل کیفیت'],
      ['lab', 'آزمایشگاه', 'درخواست و نتایج آزمایش'],
      ['rd', 'تحقیق و توسعه', 'پروژه‌های R&D'],
      ['warehouse_manager', 'مدیر انبار', 'موجودی و تأمین'],
      ['support', 'پشتیبانی', 'تیکت‌ها و خدمات پس از فروش'],
      ['marketing', 'بازاریابی', 'کمپین و باشگاه مشتریان'],
      ['rep', 'نماینده فروش', 'ثبت سرنخ و پیگیری'],
    ];
    for (const [name, nameFa, desc] of roles) {
      d.prepare('INSERT OR IGNORE INTO roles(name, name_fa, description, is_system, created_at) VALUES(?,?,?,1,?)').run(name, nameFa, desc, nowIso());
    }
    // ---------- permissions ----------
    const entities = ['customer', 'customer_category', 'lead', 'opportunity', 'pipeline', 'pipeline_stage', 'product', 'product_category', 'price_list', 'quote', 'order', 'invoice', 'payment', 'supplier', 'purchase_order', 'stock_transaction', 'stock_alert', 'lab_request', 'lab_result', 'complaint', 'ticket', 'warranty', 'contract', 'campaign', 'loyalty_tier', 'meeting', 'task', 'followup', 'document', 'workflow_rule', 'tag', 'report_definition', 'user', 'role', 'settings', 'audit_log', 'backup', 'commission', 'approval', 'workflow', 'report_template', 'ai_log', 'ai', 'calendar_event', 'voip_call', 'voip_setting', 'smart_sales'];
    for (const e of entities) for (const a of ['view', 'create', 'edit', 'delete', 'export', 'approve', 'archive', 'restore', 'import']) {
      d.prepare('INSERT OR IGNORE INTO permissions(entity, action) VALUES(?,?)').run(e, a);
    }
    // Defensive: a grant references a permission, so ensure it exists (fresh-install safe —
    // otherwise a referenced permission missing from a migration would crash the whole seed).
    const getPer = (e, a) => {
      let row = d.prepare('SELECT id FROM permissions WHERE entity=? AND action=?').get(e, a);
      if (!row) { const info = d.prepare('INSERT INTO permissions(entity, action) VALUES(?,?)').run(e, a); row = { id: info.lastInsertRowid }; }
      return row.id;
    };
    const roleId = (n) => d.prepare('SELECT id FROM roles WHERE name=?').get(n).id;
    function grant(role, ents, actions, scope) {
      const ins = d.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope) VALUES(?,?,?)');
      for (const e of ents) for (const a of actions) ins.run(roleId(role), getPer(e, a), scope);
    }
    const biz = ['customer', 'customer_category', 'lead', 'opportunity', 'pipeline', 'pipeline_stage', 'product', 'product_category', 'price_list', 'quote', 'order', 'invoice', 'payment', 'supplier', 'purchase_order', 'stock_transaction', 'stock_alert', 'lab_request', 'lab_result', 'complaint', 'ticket', 'warranty', 'contract', 'campaign', 'loyalty_tier', 'meeting', 'task', 'followup', 'document', 'tag', 'report_definition', 'commission', 'approval'];
    const allActions = ['view', 'create', 'edit', 'delete', 'export', 'approve', 'archive', 'restore', 'import'];
    grant('super_admin', [...biz, 'user', 'role', 'settings', 'audit_log', 'backup', 'workflow_rule', 'workflow', 'report_template', 'ai_log', 'ai', 'calendar_event'], allActions, 'all');
    grant('ceo', [...biz, 'audit_log', 'report_definition', 'report_template', 'ai_log', 'ai', 'calendar_event'], ['view', 'export', 'approve', 'archive'], 'all');
    grant('sales_manager', [...biz, 'calendar_event'], ['view', 'create', 'edit', 'export', 'approve', 'archive', 'restore'], 'all');
    grant('sales_manager', ['report_template', 'ai_log', 'ai'], ['view', 'create', 'edit', 'export'], 'all');
    // NOTE: role_permissions PK (role_id, permission_id) — broader view scope must be granted
    // BEFORE the own-scope biz grant, otherwise INSERT OR IGNORE keeps the narrower scope.
    grant('sales', ['customer', 'lead', 'opportunity', 'quote', 'order', 'product'], ['view'], 'team');
    grant('sales', ['customer', 'customer_category', 'lead', 'opportunity', 'quote', 'order', 'product', 'product_category', 'price_list', 'meeting', 'task', 'followup', 'document', 'tag', 'warranty'], ['view', 'create', 'edit', 'export'], 'own');
    grant('finance_manager', ['invoice', 'payment', 'order', 'quote', 'commission', 'customer', 'approval'], ['view', 'create', 'edit', 'export', 'approve', 'archive'], 'all');
    grant('finance', ['invoice', 'payment', 'commission'], ['view', 'create', 'edit', 'export'], 'own');
    grant('finance', ['invoice', 'payment', 'customer'], ['view'], 'all');
    grant('production_manager', ['order', 'product', 'product_category', 'purchase_order', 'supplier', 'stock_transaction', 'stock_alert', 'task', 'meeting'], ['view', 'create', 'edit', 'export'], 'all');
    grant('quality_manager', ['complaint', 'ticket', 'lab_request', 'lab_result', 'customer', 'report_definition', 'document'], ['view', 'create', 'edit', 'export', 'approve', 'archive'], 'all');
    grant('lab', ['lab_request', 'customer'], ['view'], 'all');
    grant('lab', ['lab_request', 'lab_result', 'document'], ['view', 'create', 'edit'], 'own');
    grant('rd', ['document', 'lab_request', 'lab_result', 'task', 'product'], ['view', 'create', 'edit'], 'all');
    grant('warehouse_manager', ['product', 'product_category', 'supplier', 'purchase_order', 'stock_transaction', 'stock_alert', 'customer', 'task'], ['view', 'create', 'edit', 'export', 'archive'], 'all');
    // broader view scope first (PK-safe ordering, see sales grant above)
    grant('support', ['customer', 'complaint', 'ticket'], ['view'], 'all');
    grant('support', ['ticket', 'complaint', 'warranty', 'customer', 'task', 'followup'], ['view', 'create', 'edit'], 'own');
    grant('marketing', ['customer'], ['view'], 'all');
    grant('marketing', ['campaign', 'loyalty_tier', 'customer', 'document', 'report_definition'], ['view', 'create', 'edit', 'export'], 'own');
    grant('rep', ['lead', 'customer', 'quote', 'task', 'followup', 'meeting'], ['view', 'create', 'edit'], 'own');
    // calendar_event per-role grants (parity with migration 004 — fresh-DB safe)
    grant('production_manager', ['calendar_event'], ['view', 'create', 'edit', 'export'], 'all');
    grant('quality_manager', ['calendar_event'], ['view', 'create', 'edit', 'export'], 'all');
    grant('finance_manager', ['calendar_event'], ['view', 'create', 'edit', 'export'], 'all');
    grant('warehouse_manager', ['calendar_event'], ['view', 'create', 'edit', 'export'], 'all');
    grant('marketing', ['calendar_event'], ['view', 'create', 'edit', 'export'], 'all');
    for (const cr of ['sales', 'finance', 'lab', 'support', 'rd', 'rep']) grant(cr, ['calendar_event'], ['view', 'create', 'edit'], 'own');
    // voip per-role grants (parity with migration 010 — fresh-DB safe)
    grant('super_admin', ['voip_setting'], ['view', 'edit'], 'all');
    grant('ceo', ['voip_call'], ['view', 'export'], 'all');
    grant('sales_manager', ['voip_call'], ['view', 'create', 'edit', 'export'], 'all');
    grant('sales_manager', ['voip_setting'], ['view', 'edit'], 'all');
    grant('sales', ['voip_call'], ['view', 'create', 'edit', 'export'], 'all');
    grant('rep', ['voip_call'], ['view', 'create', 'edit', 'export'], 'own');
    grant('support', ['voip_call'], ['view', 'create', 'edit'], 'own');
    for (const cr of ['finance_manager', 'finance', 'marketing', 'quality_manager', 'production_manager', 'warehouse_manager', 'lab', 'rd']) grant(cr, ['voip_call'], ['view', 'export'], 'all');
    // smart sales team per-role grants (parity with migration 012 — fresh-DB safe)
    for (const r2 of ['super_admin', 'ceo', 'sales_manager', 'sales', 'rep', 'finance_manager', 'finance', 'marketing']) grant(r2, ['smart_sales'], ['view'], 'all');
    for (const r2 of ['super_admin', 'sales_manager', 'sales', 'rep']) grant(r2, ['smart_sales'], ['use'], 'all');
    for (const r2 of ['super_admin', 'sales_manager']) grant(r2, ['smart_sales'], ['manage'], 'all');
    // smart team: competitor analysis + idea generation (parity with migration 013)
    for (const r2 of ['super_admin', 'ceo', 'sales_manager', 'sales', 'rep', 'marketing']) grant(r2, ['competitor', 'idea'], ['view', 'edit'], 'all');
    for (const r2 of ['super_admin', 'ceo', 'sales_manager']) grant(r2, ['competitor', 'idea'], ['delete', 'approve'], 'all');
    // ---------- admin user ----------
    d.prepare('INSERT OR IGNORE INTO users(username, email, password_hash, full_name, department, active, must_change_password, created_at, updated_at, version) VALUES(?,?,?,?,?,?,1,?,?,1)')
      .run('admin', 'admin@baspar-foam.ir', hashPassword('admin1234'), 'مدیر سیستم', 'it', 1, nowIso(), nowIso());
    const adminId = d.prepare('SELECT id FROM users WHERE username=?').get('admin').id;
    d.prepare('INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES(?,?)').run(adminId, roleId('super_admin'));
    // ---------- reference data ----------
    for (const n of ['عمده‌فروش', 'خرده‌فروش', 'تولیدکننده', 'کارخانه', 'آزمایشگاه', 'مشتری صنعتی', 'مشتری صادراتی', 'نماینده', 'سایر']) {
      d.prepare('INSERT OR IGNORE INTO customer_categories(name) VALUES(?)').run(n);
    }
    const cats = [
      ['فوم و اسفنج', null], ['تشک و خواب', null], ['کفپوش و بالشتک', null], ['مواد اولیه', null], ['بسته‌بندی', null], ['سایر', null],
    ];
    for (const [n] of cats) d.prepare('INSERT OR IGNORE INTO product_categories(name) VALUES(?)').run(n);
    // ---------- pipelines ----------
    const pipes = [
      ['فروش عمومی', [['سرنخ', 1], ['تماس گرفته', 2], ['تأییدشده', 3], ['پیشنهاد فنی/مالی', 4], ['در حال مذاکره', 5], ['موفق', 6, 1], ['ناموفق', 7, 0, 1]]],
      ['مواد اولیه', [['درخواست', 1], ['تایید فنی', 2], ['قرارداد', 3], ['موفق', 4, 1], ['ناموفق', 5, 0, 1]]],
      ['خدمات و آزمایشگاه', [['درخواست', 1], ['بررسی', 2], ['اجرا', 3], ['پایان', 4, 1]]],
    ];
    for (const [name, stages] of pipes) {
      // idempotent: seedCore() can run again after a demo-data wipe (see run()), and this
      // is the one block that used a plain INSERT — skip pipelines that already exist
      const existing = d.prepare('SELECT id FROM pipelines WHERE name=?').get(name);
      const pi = existing ? existing.id
        : d.prepare('INSERT INTO pipelines(name, is_default, active, created_at) VALUES(?,?,1,?)').run(name, name === 'فروش عمومی' ? 1 : 0, nowIso()).lastInsertRowid;
      for (const s of stages) {
        if (d.prepare('SELECT id FROM pipeline_stages WHERE pipeline_id=? AND name=?').get(pi, s[0])) continue;
        d.prepare('INSERT INTO pipeline_stages(pipeline_id, name, position, is_won, is_lost) VALUES(?,?,?,?,?)').run(pi, s[0], s[1], s[2] || 0, s[3] || 0);
      }
    }
    for (const [n, min, disc, color] of [['برنزی', 0, 0, '#b08d57'], ['نقره‌ای', 100, 1, '#8a94a6'], ['طلایی', 500, 2, '#c9a227'], ['پلاتینی', 2000, 4, '#171a20']]) {
      d.prepare('INSERT OR IGNORE INTO loyalty_tiers(name, min_points, discount_pct, color) VALUES(?,?,?,?)').run(n, min, disc, color);
    }
    for (const [n, c] of [['VIP', '#c9a227'], ['ارزش بالا', '#2a9d8f'], ['صادرات', '#7c5cd6'], ['در ریسک', '#c0392b'], ['آزمایشگاه', '#3d6cb3'], ['فوری', '#e05263']]) {
      d.prepare('INSERT OR IGNORE INTO tags(name, color, created_at) VALUES(?,?,?)').run(n, c, nowIso());
    }
    // ---------- settings ----------
    setSetting('company', {
      name: 'شرکت دانش‌بنیان بسپار فوم غرب', nameEn: 'BASPAR FOAM GHARB', logo: '/assets/logo-selen.png',
      logo_selen: '/assets/logo-selen.png', logo_baspar: '/assets/logo-baspar.png',
      address: 'استان مرکزی، شهرستان زرندیه، شهرک صنعتی مامونیه، بلوار صنعت، خیابان چهارم، پلاک 4176، واحد B306',
      phone: '+98 8645253691',
      factory_address: 'استان مرکزی، شهرستان زرندیه، شهرک صنعتی مامونیه، بلوار صنعت، خیابان چهارم، پلاک 4176، واحد B306',
      factory_postal: '3941894176',
      factory_phone: '+98 8645253691',
      hq_address: 'شهرک راه آهن، خیابان هجده متری قائم، خیابان قائم دوازدهم، پلاک 97',
      hq_postal: '1494994884',
      qr_image: '/assets/factory-qr.png',
      email: 'info@baspar-foam.ir', website: 'www.baspar-foam.ir', tax_code: '۱۰۸۰۴۵۶۷۲',
    });
    setSetting('tax_rate', 9);
    setSetting('currency', 'ریال');
    setSetting('numerals', 'fa');
    setSetting('sla_complaints', { quality: 48, product: 72, shipping: 24, delay: 24, financial: 120, service: 48, laboratory: 96, sales: 72, other: 120 });
    setSetting('loyalty_earn_rate', 1);
    setSetting('ai_provider', { provider: 'local', model: '', apiKey: '', baseUrl: '', temperature: 0.4 });
    setSetting('sms', { active: 0, settings: {} });
    setSetting('email', { active: 0, settings: {} });
    setSetting('whatsapp', { active: 0, settings: {} });
    setSetting('telegram', { active: 0, settings: {} });
    setSetting('payment_gateway', { active: 0, settings: {} });
    setSetting('accounting', { active: 0, settings: {} });
    setSetting('tax_system', { active: 0, settings: {} });
    setSetting('custom_fields', {
      customer: [
        { key: 'capacity', label: 'ظرفیت تولید (متری بر ماه)', type: 'number' },
        { key: 'national_id', label: 'شناسه ملی', type: 'text' },
        { key: 'export_market', label: 'بازار صادراتی', type: 'text' },
      ],
    });
    // ---------- workflow rules ----------
    const wr = d.prepare('INSERT INTO workflow_rules(name, event, conditions, actions, active, created_at) VALUES(?,?,?,?,1,?)');
    wr.run('اعلان شکایت جدید به واحد کیفیت', 'complaint_created', '{}', JSON.stringify([{ type: 'notify_roles', roles: ['quality_manager'], title: 'شکایت جدید ثبت شد', ref_type: 'complaint' }]), nowIso());
    wr.run('پیگیری خودکار شکایت', 'complaint_created', '{"priority":{"__gte":"high"}}', JSON.stringify([{ type: 'notify_roles', roles: ['quality_manager', 'ceo'], title: 'شکایت با اولویت بالا', ref_type: 'complaint' }]), nowIso());
    wr.run('پیگیری خودکار سرنخ جدید', 'lead_created', '{}', JSON.stringify([{ type: 'create_followup', entity_type: 'lead', subject: 'پیگیری سرنخ جدید', due_at: null }]), nowIso());
    wr.run('اعلان فاکتور سررسیدگذشته', 'invoice_overdue', '{}', JSON.stringify([{ type: 'notify_roles', roles: ['finance_manager', 'ceo'], title: 'فاکتور سررسیدگذشته', ref_type: 'invoice' }]), nowIso());
    wr.run('اعلان کمبود موجودی', 'stock_low', '{}', JSON.stringify([{ type: 'notify_roles', roles: ['warehouse_manager'], title: 'کمبود موجودی', ref_type: 'stock_alert' }]), nowIso());
    wr.run('اعلان موفقیت فروش به مدیرعامل', 'opportunity_won', '{}', JSON.stringify([{ type: 'notify_roles', roles: ['ceo'], title: 'فرصت فروش موفق شد', ref_type: 'opportunity' }]), nowIso());
    // commission default rule
    d.prepare('INSERT OR IGNORE INTO commission_rules(name, basis, pct, monthly_target, target_bonus_pct, active, created_at) VALUES(?,?,?,?,?,1,?)').run('پورسانت فروش پایه (٪۱.۵ از مبلغ)', 'amount', 1.5, 500000000, 0.5, nowIso());
    // ---------- sample workflow (complaint SLA) ----------
    const slaDef = {
      nodes: [
        { id: 'start', type: 'start', title: 'شروع', x: 40, y: 200, form: [], condition: null, assignee_type: 'none', assignee: '', sla_hours: 0, priority: '', notify: false },
        { id: 'classify', type: 'task', title: 'ثبت و طبقه‌بندی شکایت', x: 220, y: 200, form: [], condition: null, assignee_type: 'role', assignee: 'support', sla_hours: 24, priority: 'high', notify: true },
        { id: 'condition', type: 'condition', title: 'اولویت بحرانی؟', x: 430, y: 200, condition: { field: 'priority', op: 'eq', value: 'critical' }, form: [], assignee_type: 'none', assignee: '', sla_hours: 0, priority: '', notify: false },
        { id: 'urgent', type: 'task', title: 'اقدام فوری مدیر کیفیت', x: 640, y: 90, form: [], condition: null, assignee_type: 'role', assignee: 'quality_manager', sla_hours: 4, priority: 'critical', notify: true },
        { id: 'normal', type: 'task', title: 'پیگیری واحد مربوطه', x: 640, y: 320, form: [], condition: null, assignee_type: 'department', assignee: 'quality', sla_hours: 24, priority: 'medium', notify: true },
        { id: 'merge', type: 'approval', title: 'تأیید نهایی حل', x: 850, y: 200, form: [], condition: null, assignee_type: 'role', assignee: 'quality_manager', sla_hours: 24, priority: '', notify: true },
        { id: 'end', type: 'end', title: 'پایان', x: 1040, y: 200, form: [], condition: null, assignee_type: 'none', assignee: '', sla_hours: 0, priority: '', notify: false }
      ],
      edges: [
        { from: 'start', to: 'classify' },
        { from: 'classify', to: 'condition' },
        { from: 'condition', to: 'urgent', label: 'true' },
        { from: 'condition', to: 'normal', label: 'false' },
        { from: 'urgent', to: 'merge' },
        { from: 'normal', to: 'merge' },
        { from: 'merge', to: 'end', label: 'approve' },
        { from: 'merge', to: 'classify', label: 'return' }
      ]
    };
    d.prepare('INSERT OR IGNORE INTO wf_processes(key, name, module, description, trigger_event, trigger_value, active, current_version, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('wf_complaint_sla', 'فرآیند مدیریت شکایت (SLA)', 'complaint', 'فرآیند استاندارد مدیریت شکایت با اسلای و تأیید نهایی', 'created', '', 1, 1, adminId, nowIso(), nowIso());
    const wfId = d.prepare("SELECT id FROM wf_processes WHERE key='wf_complaint_sla'").get().id;
    d.prepare('INSERT OR IGNORE INTO wf_versions(process_id, version, definition, change_note, active, created_by, created_at) VALUES(?,?,?,?,1,?,?)')
      .run(wfId, 1, JSON.stringify(slaDef), 'نسخهٔ اول (نمونه)', adminId, nowIso());
    d.prepare('UPDATE wf_processes SET current_version=1 WHERE id=?').run(wfId);
  });
  tx();
  setSetting('seeded_core', true);
  console.log('[seed] core seeded');
}
function maybeDemo() {
  if (getSetting('demo_data')) return;
  // Demo/sample data is OPT-IN (SEED_DEMO=1). A fresh production install starts RAW with no
  // mock data by default (per requirement: no sample data auto-created on the final run).
  if (process.env.SEED_DEMO !== '1') return;
  try {
    seedDemo();
    setSetting('demo_data', true);
    console.log('[seed] demo data seeded (removable from Admin panel)');
  } catch (e) {
    console.error('[seed] demo failed:', e.stack);
  }
}
function seedDemo() {
  const d = get();
  const adminId = d.prepare('SELECT id FROM users WHERE username=?').get('admin').id;
  const roles = {};
  for (const r of d.prepare('SELECT id, name FROM roles').all()) roles[r.name] = r.id;
  const tx = d.transaction(() => {
    // users
    const demoUsers = [
      ['reza.m', 'رضا محمدی', 'ceo', 'مدیریت'],
      ['ali.k', 'علی کریمی', 'sales_manager', 'sales'],
      ['sara.m', 'سارا موسوی', 'sales', 'sales'],
      ['hooman.d', 'هومان دهقانی', 'sales', 'sales'],
      ['negar.s', 'نگار صادقی', 'sales', 'sales'],
      ['mohammad.f', 'محمد فلاحی', 'finance_manager', 'finance'],
      ['zan.ah', 'زینب احمدی', 'finance', 'finance'],
      ['karim.r', 'کریم رستمی', 'production_manager', 'production'],
      ['fatemeh.l', 'فاطمه لطفی', 'quality_manager', 'quality'],
      ['saeid.t', 'سعید توکلی', 'lab', 'lab'],
      ['amin.p', 'امین پارسا', 'warehouse_manager', 'warehouse'],
      ['maryam.h', 'مریم حسن‌زاده', 'support', 'support'],
      ['babak.n', 'بابک نوروزی', 'marketing', 'marketing'],
      ['omid.v', 'امید صادقی', 'rep', 'sales'],
    ];
    const userIds = {};
    for (const [un, fn, role, dept] of demoUsers) {
      // Idempotent on purpose: deleting the demo data from Admin → Settings removes the
      // business tables but keeps `users`, so a plain INSERT here blew up with
      // "UNIQUE constraint failed: users.username" and rolled the whole demo transaction
      // back — the sample dataset could never be created again. Same INSERT OR IGNORE +
      // SELECT pattern seedCore() already uses for the admin user.
      d.prepare('INSERT OR IGNORE INTO users(username, email, password_hash, full_name, department, active, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,1,?,?,1)')
        .run(un, un + '@baspar-foam.ir', hashPassword('12345678'), fn, dept, adminId, nowIso(), nowIso());
      const uid = d.prepare('SELECT id FROM users WHERE username=?').get(un).id;
      d.prepare('INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES(?,?)').run(uid, roles[role]);
      userIds[role + '_' + un] = Number(uid);
    }
    const salesIds = [userIds['sales_sara.m'], userIds['sales_hooman.d'], userIds['sales_negar.s'], userIds['rep_omid.v']];
    const salesMgr = userIds['sales_manager_ali.k'];
    const finMgr = userIds['finance_manager_mohammad.f'];
    const qualMgr = userIds['quality_manager_fatemeh.l'];
    const labUser = userIds['lab_saeid.t'];
    const whMgr = userIds['warehouse_manager_amin.p'];
    const ceo = userIds['ceo_reza.m'];
    // products
    const prods = [
      ['FOAM-100', 'اسفنج رول تراکم ۲۸', 'فوم و اسفنج', 850000, 720000, 980000, 520000, 500, 42, 80],
      ['FOAM-110', 'اسفنج تخت تراکم ۳۰', 'فوم و اسفنج', 2400000, 2050000, 2900000, 1350000, 100, 120, 250],
      ['MATT-200', 'تشک فومی ۲۰۰×۲۰۰', 'تشک و خواب', 14500000, 12500000, 17800000, 8200000, 20, 35, 60],
      ['MATT-210', 'تشک فومی ۱۸۰×۲۰۰', 'تشک و خواب', 11800000, 10200000, 14500000, 6800000, 20, 28, 55],
      ['KIT-300', 'کیت اسفنج مبل ۳ نفره', 'کفپوش و بالشتک', 6800000, 5900000, 7600000, 3600000, 10, 22, 40],
      ['CUSH-310', 'بالشت فومی طبی', 'کفپوش و بالشتک', 1900000, 1650000, 2400000, 900000, 100, 150, 300],
      ['SOLE-400', 'کفی فومی طبی', 'کفپوش و بالشتک', 950000, 820000, 1200000, 410000, 200, 400, 800],
      ['SAND-500', 'فوم ساندویچی ۲۵ سانتی', 'فوم و اسفنج', 3200000, 2750000, 3900000, 1600000, 50, 60, 120],
      ['CAR-600', 'پد فومی صندلی خودرو', 'سایر', 1250000, 1080000, 1600000, 520000, 100, 250, 500],
      ['CHAIR-610', 'اسفنج صندلی اداری', 'سایر', 2100000, 1850000, 2600000, 980000, 50, 90, 180],
      ['RAW-001', 'پلی‌ول 110L', 'مواد اولیه', 28500000, 26000000, 31000000, 19500000, 20, 25, 60],
      ['RAW-002', 'پلی‌ول 400', 'مواد اولیه', 31000000, 28500000, 33500000, 21500000, 10, 12, 30],
      ['RAW-003', 'MDI (ایزوسیانات)', 'مواد اولیه', 42000000, 39000000, 46000000, 30000000, 10, 14, 35],
      ['RAW-004', 'کاتالیزور T-91', 'مواد اولیه', 18000000, 16500000, 20000000, 11000000, 5, 8, 20],
    ].map(p => {
      const cat = d.prepare('SELECT id FROM product_categories WHERE name=?').get(p[2]) || d.prepare('SELECT id FROM product_categories LIMIT 1').get();
      const isRaw = p[0].startsWith('RAW');
      const info = d.prepare('INSERT INTO products(code, sku, name, category_id, unit, price_retail, price_wholesale, price_export, price_cost, min_order, stock_qty, reorder_point, max_stock, is_raw_material, active, description, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,1)')
        .run(p[0], p[0] + '-SKU', p[1], cat.id, isRaw ? 'لیتر' : 'عدد', p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], isRaw ? 1 : 0, isRaw ? 'مواد اولیه' : 'محصول فومی بسپار فوم غرب', adminId, nowIso(), nowIso());
      return { id: Number(info.lastInsertRowid), retail: p[3], cost: p[6], qty: p[8], reorder: p[9], name: p[1], raw: isRaw };
    });
    const catIds = Object.fromEntries(d.prepare('SELECT id, name FROM product_categories').all().map(r => [r.name, r.id]));
    const priceLists = [
      ['فروشگاه', 'خرده', 1.0], ['عمده‌فروشان', 'عمده', 0.9], ['صادرات', 'صادراتی', 1.12],
    ].map(([n, dsc, f]) => {
      const li = d.prepare('INSERT INTO price_lists(name, currency, active, created_at) VALUES(?,?,1,?)').run(n, 'IRR', nowIso()).lastInsertRowid;
      for (const p of prods.filter(x => !x.raw)) {
        d.prepare('INSERT INTO price_list_items(price_list_id, product_id, price) VALUES(?,?,?)').run(li, p.id, Math.round(p.retail * f / 10000) * 10000);
      }
      return li;
    });
    // customers
    const custNames = ['فوم‌سازی پارس', 'اسفنج صنعت شرق', 'تخت و تشک البرز', 'بهداشت فراز', 'صنایع شیمیایی زاگرس', 'مبلمان آریا', 'بسته‌بندی نرگس', 'تجهیزات خواب سپیدار', 'کفپوش و بالشتک یاس', 'صنایع پلی‌یورتان مغان', 'فروشگاه تشک کاوه', 'تولیدات فوم سیرجان', 'مبلمان مدرن تهران', 'بهداشتی پدنا', 'اسفنج صنعت قزوین', 'تشک‌سازی اصفهان', 'صنایع خواب کرمان', 'فوم و پلاستیک هریس', 'مبلمان پارسیان', 'بسته‌بندی کاغذی سمنان', 'تجهیزات طبی نیا', 'فروشگاه مواد شیمیایی یزد', 'تولیدات تشک فارس', 'صنایع فوم کرمانشاه', 'خواب راحت اهواز', 'مبلمان لوکس شیراز', 'بهداشتی سبز گیلان', 'اسفنج صنعت تبریز', 'تشک طبی راز', 'فوم صنعتی زاهدان', 'مبلمان صنعتی مشهد', 'کفپوش ورزشی کیش', 'صنایع خواب بجنورد', 'تجهیزات بیمارستانی قم'];
    const provinces = ['اصفهان', 'تهران', 'فارس', 'خراسان رضوی', 'البرز', 'مازندران', 'گلستان', 'هرمزگان', 'خوزستان', 'مرکزی', 'یزد', 'کرمان', 'آذربایجان شرقی'];
    const custIds = [];
    for (let i = 0; i < 34; i++) {
      const type = i % 5 === 0 ? 'person' : 'company';
      const name = i < custNames.length ? custNames[i] : pick(custNames) + ' ' + ri(2, 99);
      const createdJy = ri(1402, 1404), createdJm = ri(1, 12), createdJd = ri(1, 28);
      const cat = pick(d.prepare('SELECT id FROM customer_categories').all());
      const info = d.prepare('INSERT INTO customers(type, name, phone, mobile, email, province, city, address, industry, activity_type, category_id, credit_limit, credit_status, status, salesperson_id, churn_score, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run(type, name, String(ri(2100000000, 2199999999)), String(ri(9120000000, 9199999999)), 'info' + i + '@' + pick(['gmail.com', 'outlook.com', 'yahoo.com']), pick(provinces), '—', pick(['کیلومتر ۵ جاده صنعتی', 'بازار بزرگ، محله صنایع', 'منطقه صنعتی شرق', 'خیابان کارگزاران']), pick(['فوم و اسفنج', 'تولید تشک', 'بسته‌بندی', 'مبلمان', 'بهداشتی', 'تأمین‌کننده']), pick(['عمده‌فروشی', 'خرده‌فروشی', 'تولید', 'صادرات']), cat.id, ri(200, 2000) * 1000000, pick(['نورمال', 'نورمال', 'نورمال', 'هشدار']), pick(['active', 'active', 'active', 'inactive']), pick(salesIds), 0, adminId, jDate(createdJy, createdJm, createdJd), nowIso());
      custIds.push(Number(info.lastInsertRowid));
      // contacts
      d.prepare('INSERT INTO customer_contacts(customer_id, name, position, phone, is_primary, created_at) VALUES(?,?,?,?,1,?)').run(info.lastInsertRowid, pick(['م. احمدی', 'ح. رضایی', 'س. قاسمی', 'ع. موسوی', 'ف. کمالی']), pick(['مدیر خرید', 'مدیرعامل', 'کارشناس خرید', 'مدیر فنی']), String(ri(9120000000, 9199999999)), nowIso());
      // loyalty account
      d.prepare('INSERT OR IGNORE INTO loyalty_accounts(customer_id, tier_id) VALUES(?,1)').run(info.lastInsertRowid);
    }
    // invoices: 20 months ending at current month
    const finUser = userIds['finance_zan.ah'];
    let invoiceCount = 0;
    const nowJ = (function () { const j = require('../lib/jalali'); const t = new Date(); const r = j.gregorianToJalaali(t.getFullYear(), t.getMonth() + 1, t.getDate()); return { jy: r[0], jm: r[1] }; })();
    const months = [];
    for (let mi = 19; mi >= 0; mi--) { let mm = nowJ.jm - mi, yy = nowJ.jy; while (mm < 1) { mm += 12; yy--; } months.push([yy, mm]); }
    for (const [jy, jm] of months) {
      const season = [0.9, 0.85, 0.8, 0.75, 0.7, 1.0, 1.1, 1.05, 1.3, 1.25, 1.15, 1.2][jm - 1];
      const nInv = Math.round(ri(5, 10) * season);
      for (let k = 0; k < nInv; k++) {
        const custId = pick(custIds);
        // some customers decline in recent months
        const jd = ri(1, 28);
        const date = jDate(jy, jm, jd, ri(9, 17));
        const nItems = ri(1, 4);
        let subtotal = 0, tax = 0;
        const lines = [];
        for (let li = 0; li < nItems; li++) {
          const p = pick(prods.filter(x => !x.raw));
          const qty = pick([1, 2, 3, 5, 8, 10, 15, 20, 30]);
          const price = p.retail * rf(0.82, 1.0);
          const lineTotal = Math.round(qty * price);
          const t = Math.round(lineTotal * 0.09);
          subtotal += lineTotal; tax += t;
          lines.push([p.id, p.name, qty, Math.round(price), lineTotal, t]);
        }
        const total = subtotal + tax;
        const invInfo = d.prepare('INSERT INTO invoices(number, customer_id, issue_date, due_date, subtotal, tax, total, paid_amount, status, terms, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
          .run('INV-' + jy + String(jm).padStart(2, '0') + '-' + String(100 + invoiceCount).padStart(4, '0'), custId, date, new Date(new Date(date).getTime() + 30 * 864e5).toISOString(), subtotal, tax, total, 0, 'unpaid', 'نقد/۳۰ روز', finUser, nowIso(), nowIso());
        const invId = Number(invInfo.lastInsertRowid);
        for (const l of lines) d.prepare('INSERT INTO invoice_items(invoice_id, product_id, name, qty, price, discount_pct, tax_rate, line_total) VALUES(?,?,?,?,?,?,?,?)').run(invId, l[0], l[1], l[2], l[3], 0, 9, l[4]);
        // payment
        const r = rnd();
        if (r < 0.72) {
          const payDate = new Date(new Date(date).getTime() + ri(1, 25) * 864e5).toISOString();
          d.prepare('INSERT INTO payments(number, invoice_id, customer_id, amount, method, reference, paid_at, received_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run('PAY-' + ri(10000, 99999), invId, custId, total, pick(['bank', 'cash', 'check', 'bank']), String(ri(1000000000, 9999999999)), payDate, finUser, nowIso());
          d.prepare("UPDATE invoices SET paid_amount=?, status='paid' WHERE id=?").run(total, invId);
        } else if (r < 0.85) {
          const part = Math.round(total * rf(0.3, 0.7));
          const payDate = new Date(new Date(date).getTime() + ri(1, 20) * 864e5).toISOString();
          d.prepare('INSERT INTO payments(number, invoice_id, customer_id, amount, method, paid_at, received_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
            .run('PAY-' + ri(10000, 99999), invId, custId, part, pick(['bank', 'installment']), payDate, finUser, nowIso());
          d.prepare("UPDATE invoices SET paid_amount=?, status='partial' WHERE id=?").run(part, invId);
        }
        // stock out for finished products
        for (const l of lines) {
          const prod = prods.find(p => p.id === l[0]);
          if (prod && !prod.raw) {
            d.prepare('INSERT INTO stock_transactions(product_id, type, qty, note, ref_type, ref_id, user_id, created_at) VALUES(?,?,?,?,?,?,?,?)')
              .run(prod.id, 'out', -l[2], 'فروش ' + 'INV-' + jy + String(jm).padStart(2, '0'), 'invoice', invId, finUser, date);
            const cur = d.prepare('SELECT stock_qty FROM products WHERE id=?').get(prod.id).stock_qty;
            if (cur - l[2] > 0) d.prepare('UPDATE products SET stock_qty=stock_qty-? WHERE id=?').run(l[2], prod.id);
          }
        }
        invoiceCount++;
      }
    }
    // quotes (recent, some sent/draft)
    for (let i = 0; i < 14; i++) {
      const custId = pick(custIds);
      const date = jDate(1404, pick([2, 3, 4]), ri(1, 25));
      const qInfo = d.prepare('INSERT INTO quotes(number, customer_id, salesperson_id, price_list_id, discount_pct, tax_rate, status, valid_until, subtotal, total, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('QT-1404-' + String(101 + i), custId, pick(salesIds), pick(priceLists), pick([0, 3, 5, 8]), 9, pick(['draft', 'sent', 'sent', 'accepted', 'expired']), new Date(new Date(date).getTime() + 14 * 864e5).toISOString(), 0, 0, finUser, nowIso(), nowIso());
      const qi = Number(qInfo.lastInsertRowid);
      const p = pick(prods.filter(x => !x.raw));
      const qty = ri(5, 40);
      const price = p.retail;
      const st = Math.round(qty * price);
      const tot = Math.round(st * 1.09);
      d.prepare('INSERT INTO quote_items(quote_id, product_id, name, qty, price, discount_pct, line_total) VALUES(?,?,?,?,?,?,?)').run(qi, p.id, p.name, qty, price, 0, st);
      d.prepare('UPDATE quotes SET subtotal=?, total=? WHERE id=?').run(st, tot, qi);
    }
    // orders
    const orders = [];
    for (let i = 0; i < 34; i++) {
      const custId = pick(custIds);
      const jy = pick([1403, 1404]), jm = ri(1, 12);
      const date = jDate(jy, jm, ri(1, 25));
      const st = pick(['confirmed', 'in_production', 'ready', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled']);
      const p = pick(prods.filter(x => !x.raw));
      const qty = ri(5, 30);
      const total = Math.round(qty * p.retail * 1.09);
      const oInfo = d.prepare('INSERT INTO orders(number, customer_id, salesperson_id, status, order_date, due_date, total, notes, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('OD-1404-' + String(201 + i), custId, pick(salesIds), st, date, new Date(new Date(date).getTime() + 15 * 864e5).toISOString(), total, '', finUser, nowIso(), nowIso());
      d.prepare('INSERT INTO order_items(order_id, product_id, name, qty, price, discount_pct, line_total, status) VALUES(?,?,?,?,?,?,?,?)')
        .run(oInfo.lastInsertRowid, p.id, p.name, qty, p.retail, 0, Math.round(qty * p.retail), st === 'delivered' ? 'delivered' : 'pending');
      orders.push(Number(oInfo.lastInsertRowid));
    }
    // suppliers
    const supNames = [['پتروشیمی خلیج فارس', 'polyl'], ['گروه شیمیایی البرز', 'mdi'], ['تأمین پالایه اصفهان', 'chemical'], ['بسته‌بندی پارس', 'packaging'], ['صنایع ماشین‌آلات یزد', 'machine'], ['تأمین مواد اولیه تهران', 'chemical']];
    const supIds = [];
    for (const [n, c] of supNames) {
      const info = d.prepare('INSERT INTO suppliers(name, tax_code, contact_name, phone, category, quality_rating, delivery_rating, price_rating, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)')
        .run(n, ri(100000000, 999999999), pick(['م. حسینی', 'ر. کاظمی', 'ج. نوری']), String(ri(9120000000, 9199999999)), c, rf(3.2, 5, 1), rf(2.8, 5, 1), rf(3, 4.8, 1), adminId, nowIso(), nowIso());
      supIds.push(Number(info.lastInsertRowid));
    }
    for (let i = 0; i < 7; i++) {
      const p = pick(prods.filter(x => x.raw));
      const qty = ri(5, 30);
      const po = d.prepare('INSERT INTO purchase_orders(number, supplier_id, status, order_date, expected_date, total, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,1)')
        .run('PO-1404-' + String(301 + i), pick(supIds), pick(['received', 'received', 'sent', 'partial']), jDate(1404, ri(1, 4), ri(1, 25)), jDate(1404, ri(2, 5), ri(1, 25)), qty * p.cost, adminId, nowIso(), nowIso()).lastInsertRowid;
      d.prepare('INSERT INTO po_items(po_id, product_id, name, qty, price, received_qty) VALUES(?,?,?,?,?,?)').run(po, p.id, p.name, qty, p.cost, pick(['received', 'partial']).includes(pick(['x'])) ? qty : Math.round(qty * rf(0.3, 1)));
      // stock in for received
      if (rnd() < 0.7) {
        d.prepare('INSERT INTO stock_transactions(product_id, type, qty, note, ref_type, ref_id, user_id, created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(p.id, 'in', qty, 'خرید از تأمین‌کننده', 'po', po, whMgr, jDate(1404, ri(2, 4), ri(1, 25)));
        d.prepare('UPDATE products SET stock_qty=stock_qty+? WHERE id=?').run(qty, p.id);
      }
    }
    // leads
    for (let i = 0; i < 36; i++) {
      const date = jDate(1404, ri(1, 4), ri(1, 25));
      const l = d.prepare('INSERT INTO leads(number, source, contact_name, company, phone, email, product_interest, estimated_value, probability, status, salesperson_id, next_followup_at, score, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('LD-1404-' + String(401 + i), pick(['website', 'instagram', 'whatsapp', 'phone', 'referral', 'exhibition', 'sms', 'manual']), pick(['حسین کریمی', 'مهدی تهرانی', 'فاطمه شریفی', 'علی نائینی', 'سمیرا حیدری']), pick(['فروشگاه تشک امید', 'مبلمان نوین', 'صنایع خواب زاگرس', 'بهداشتی آریا', 'کفپوش پارس', '—', '—', '—']), String(ri(9120000000, 9199999999)), 'lead' + i + '@mail.com', pick(['اسفنج رول', 'تشک فومی', 'کیت مبل', 'پد صندلی خودرو', 'فوم ساندویچی', 'کفی طبی']), ri(5, 400) * 1000000, ri(10, 90), pick(['new', 'new', 'contacted', 'contacted', 'qualified']), pick(salesIds), new Date(Date.now() + ri(1, 10) * 864e5).toISOString(), 0, finUser, date, nowIso());
      // a couple activities
      d.prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,?,?,?,?)').run('lead', l.lastInsertRowid, pick(salesIds), 'call', 'تماس اولیه و معرفی محصولات', date);
      if (rnd() < 0.5) d.prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, created_at) VALUES(?,?,?,?,?,?)').run('lead', l.lastInsertRowid, pick(salesIds), 'meeting', 'جلسه حضوری در محل مشتری', new Date(new Date(date).getTime() + 3 * 864e5).toISOString());
    }
    // opportunities
    const pipeDefault = d.prepare('SELECT id FROM pipelines WHERE is_default=1').get().id;
    const stages = d.prepare('SELECT id, name FROM pipeline_stages WHERE pipeline_id=? ORDER BY position').all(pipeDefault);
    for (let i = 0; i < 26; i++) {
      const custId = pick(custIds);
      const st = pick(stages.filter(s => !['موفق', 'ناموفق'].includes(s.name)));
      const date = jDate(1404, ri(1, 4), ri(1, 25));
      const o = d.prepare('INSERT INTO opportunities(number, pipeline_id, stage_id, customer_id, title, amount, probability, expected_close_at, competitors, salesperson_id, status, notes, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('OP-1404-' + String(501 + i), pipeDefault, st.id, custId, pick(['فروش فصلی اسفنج', 'تأمین تشک بیمارستانی', 'قرارداد سالانه کفپوش', 'تولید سفارشی بالشت', 'فروش عمده پد خودرو', 'پروژه هتل ۵ ستاره', 'تأمین مبل اداری', 'صادرات به افغانستان', 'فروش کیت مبل', 'قرارداد توزیع شرق کشور']), ri(20, 900) * 1000000, ri(15, 85), new Date(Date.now() + ri(-10, 45) * 864e5).toISOString(), pick(['اسفنج شرق', 'فوم تهران', '—', '—', '—']), pick(salesIds), 'open', '', finUser, date, nowIso());
    }
    // lab
    const testTypes = ['density', 'compress', 'tensile', 'rebound', 'flame', 'dimension'];
    for (let i = 0; i < 16; i++) {
      const custId = pick(custIds);
      const date = jDate(1404, ri(1, 4), ri(1, 25));
      const st = pick(['received', 'in_progress', 'done', 'done', 'reported']);
      const lr = d.prepare('INSERT INTO lab_requests(number, customer_id, sample_desc, sample_code, test_type, priority, status, received_at, due_at, analyst_id, notes, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('LR-1404-' + String(601 + i), custId, pick(['نمونه اسفنج رول تراکم ۲۸', 'نمونه تشک ۲۰۰', 'نمونه کیت مبل', 'نمونه پد خودرو', 'نمونه فوم ساندویچی']), 'S-' + ri(100, 999), pick(testTypes), pick(['normal', 'normal', 'high', 'urgent']), st, date, new Date(new Date(date).getTime() + 5 * 864e5).toISOString(), labUser, 'آزمون درخواستی مشتری', adminId, nowIso(), nowIso());
      if (['done', 'reported'].includes(st)) {
        const nRes = ri(2, 4);
        for (let k = 0; k < nRes; k++) {
          d.prepare('INSERT INTO lab_results(request_id, test_name, method, result_value, unit, spec_text, status, analyst, test_date, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(lr.lastInsertRowid, pick(['چگالی', 'مقاومت فشاری', 'بازگشت ارتجاعی', 'مقاومت کششی', 'ابعاد']), pick(['ASTM D1621', 'ASTM D3574', 'ISO 2439', 'ISO 1856']), rf(25, 45, 1), 'kg/m3', pick(['۲۸±۲', '۳۰±۲', '۲۵±۳', '—']), pick(['pass', 'pass', 'pass', 'fail']), 'س. توکلی', new Date(new Date(date).getTime() + 3 * 864e5).toISOString(), nowIso());
        }
      }
    }
    // complaints
    const compTexts = [
      ['کیفیت', 'کاهش وزن بسته', 'وزن بسته‌ها کمتر از قرارداد است', 'quality'],
      ['کیفیت', 'فرورفتگی در سطح تشک', 'بعد از یک ماه استفاده فرورفتگی ایجاد شده', 'quality'],
      ['ارسال', 'تأخیر ارسال بار', 'بار دو روز دیرتر از موعد ارسال شد', 'shipping'],
      ['تأخیر', 'عدم تحویل به‌موقع', 'سفارش شماره OD-1404-205 به‌موقع تحویل نشد', 'delay'],
      ['مالی', 'مغایرت مبلغ فاکتور', 'مبلغ فاکتور با پیش‌فاکتور مطابقت ندارد', 'financial'],
      ['محصول', 'بوی نامطبیع محصول', 'بوی شیمیایی قوی در محموله جدید', 'product'],
      ['کیفیت', 'ناهماهنگی رنگ اسفنج', 'رنگ دو رول با هم فرق دارد', 'quality'],
      ['خدمات', 'عدم پاسخ‌گویی تلفن', 'چند روز است به تماس‌ها پاسخ داده نمی‌شود', 'service'],
      ['آزمایشگاه', 'تأخیر در صدور گزارش', 'گزارش آزمایش بیش از موعد آماده نشده', 'laboratory'],
      ['فروش', 'غیرمناسب بودن تخفیف اعلام‌شده', 'تخفیف اعلام‌شده با لیست قیمت فرق دارد', 'sales'],
    ];
    for (let i = 0; i < 22; i++) {
      const [cat, subj, desc, autoCat] = pick(compTexts);
      const custId = pick(custIds);
      const date = jDate(1404, ri(1, 4), ri(1, 25));
      const st = pick(['new', 'in_progress', 'in_progress', 'waiting', 'resolved', 'resolved', 'closed']);
      const prio = pick(['low', 'medium', 'medium', 'high', 'critical']);
      const slaH = { low: 120, medium: 48, high: 24, critical: 12 }[prio];
      const c = d.prepare('INSERT INTO complaints(number, customer_id, source, category, subject, description, priority, status, assigned_to, department, sla_hours, due_at, resolved_at, sentiment_score, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('CMP-1404-' + String(701 + i), custId, pick(['phone', 'website', 'whatsapp', 'instagram', 'email', 'manual']), autoCat, subj, desc, prio, st, pick([qualMgr, userIds['support_maryam.h']]), pick(['quality', 'service', 'sales', 'finance']), slaH, new Date(new Date(date).getTime() + slaH * 3600e3).toISOString(), st === 'resolved' || st === 'closed' ? new Date(new Date(date).getTime() + slaH * 0.7 * 3600e3).toISOString() : null, rf(-1, 0.5, 2), adminId, date, nowIso());
      d.prepare('INSERT INTO complaint_events(complaint_id, from_status, to_status, note, user_id, created_at) VALUES(?,?,?,?,0,?)').run(c.lastInsertRowid, null, 'new', 'ثبت شکایت', date);
      if (['in_progress', 'waiting'].includes(st)) d.prepare('INSERT INTO complaint_events(complaint_id, from_status, to_status, note, user_id, created_at) VALUES(?,?,?,?,0,?)').run(c.lastInsertRowid, 'new', st, 'در حال بررسی', new Date(new Date(date).getTime() + 4 * 3600e3).toISOString());
    }
    // tickets
    for (let i = 0; i < 10; i++) {
      const custId = pick(custIds);
      const date = jDate(1404, ri(1, 4), ri(1, 25));
      d.prepare('INSERT INTO tickets(number, customer_id, type, subject, description, priority, status, assigned_to, sla_due_at, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('TKT-1404-' + String(801 + i), custId, pick(['warranty', 'technical', 'service']), pick(['عیب در دوخت تشک', 'درخواست تعویض کیت', 'مشکل نصب', 'درخواست آموزش استفاده', 'تعمیر مکانیکی']), 'مشخصات در تماس ثبت شد', pick(['low', 'medium', 'high']), pick(['open', 'in_progress', 'resolved']), pick([userIds['support_maryam.h'], qualMgr]), new Date(new Date(date).getTime() + 48 * 3600e3).toISOString(), adminId, date, nowIso());
    }
    // warranties
    for (let i = 0; i < 6; i++) {
      const custId = pick(custIds);
      d.prepare('INSERT INTO warranties(customer_id, order_id, product_name, serial, start_date, end_date, status, created_by, created_at) VALUES(?,?,?,?,?,?,?,0,?)')
        .run(custId, pick(orders) || null, pick(['تشک فومی ۲۰۰', 'کیت مبل ۳ نفره', 'بالشت طبی']), 'SN-' + ri(10000, 99999), jDate(1403, ri(1, 12), ri(1, 25)), jDate(1404, ri(1, 12), ri(1, 25)), pick(['active', 'active', 'expired']), nowIso());
    }
    // contracts
    for (let i = 0; i < 5; i++) {
      const custId = pick(custIds);
      d.prepare('INSERT INTO contracts(number, customer_id, title, type, start_date, end_date, value, status, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)')
        .run('CT-1404-' + String(901 + i), custId, pick(['قرارداد تأمین سالانه', 'قرارداد فروش فصلی', 'قرارداد خدمات فنی', 'قرارداد توزیع', 'قرارداد گارانتی']), pick(['sales', 'service', 'warranty']), jDate(1403, ri(6, 12), ri(1, 25)), jDate(1404, ri(3, 12), ri(1, 25)), ri(50, 900) * 1000000, pick(['active', 'active', 'draft', 'expired']), adminId, nowIso(), nowIso());
    }
    // meetings
    for (let i = 0; i < 9; i++) {
      const start = new Date(Date.now() + ri(-20, 20) * 864e5 + ri(9, 16) * 3600e3).toISOString();
      d.prepare('INSERT INTO meetings(title, customer_id, participant_ids, start_at, end_at, location, description, status, notes, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)')
        .run(pick(['جلسه مذاکره قرارداد', 'جلسه بررسی شکایت', 'جلسه هماهنگی تولید', 'جلسه فروش فصلی', 'جلسه بازرسی کیفیت']), pick(custIds), JSON.stringify([ceo, salesMgr, qualMgr]), start, new Date(new Date(start).getTime() + 3600e3).toISOString(), pick(['دفتر مرکزی', 'کارخانه', 'محل مشتری']), pick(['بررسی شرایط همکاری', 'ارائه نمونه', '—']), start < nowIso() ? 'done' : 'scheduled', start < nowIso() ? 'توافق بر سر قیمت عمده حاصل شد.' : '', nowIso());
    }
    // tasks
    const taskTitles = ['پیگیری پرداخت فاکتور', 'ارسال کاتالوگ جدید', 'بررسی نمونه مشتری', 'هماهنگی انبار برای ارسال', 'بازدید از مشتری', 'به‌روزرسانی لیست قیمت', 'پیگیری شکایت باز', 'آماده‌سازی پیشنهاد فنی', 'جلسه با تأمین‌کننده پلی‌ول', 'کنترل کیفیت محموله'];
    for (let i = 0; i < 24; i++) {
      d.prepare('INSERT INTO tasks(title, description, assignee_id, related_type, related_id, priority, status, due_at, completed_at, created_by, created_at, updated_at, version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)')
        .run(pick(taskTitles), '', pick([salesMgr, ...salesIds, finMgr, qualMgr, whMgr]), pick(['customer', 'invoice', 'complaint', 'opportunity']), ri(1, 30), pick(['low', 'medium', 'high']), pick(['open', 'open', 'in_progress', 'done']), new Date(Date.now() + ri(-5, 15) * 864e5).toISOString(), 'done' ? nowIso() : null, adminId, nowIso(), nowIso());
    }
    // followups
    for (let i = 0; i < 16; i++) {
      const et = pick(['customer', 'lead', 'opportunity']);
      d.prepare('INSERT INTO followups(entity_type, entity_id, user_id, subject, note, due_at, status) VALUES(?,?,?,?,?,?,?)')
        .run(et, ri(1, 30), pick(salesIds), pick(['پیگیری پیشنهاد', 'تأیید سفارش', 'جلسه حضوری', 'پیگیری پرداخت']), '', new Date(Date.now() + ri(-3, 12) * 864e5).toISOString(), pick(['pending', 'pending', 'done', 'missed']));
    }
    // campaigns
    const camp = d.prepare('INSERT INTO campaigns(name, channel, subject, message, audience_filter, status, total, sent_count, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('جشنواره پاییزه ۱۴۰', 'sms', '', '{name} گرامی، جشنواره پاییزه بسپار فوم غرب با تخفیف ویژه عمده‌فروشان شروع شد. با ما همراه باشید!', JSON.stringify({ category_id: null }), 'done', 0, 0, adminId, nowIso(), nowIso()).lastInsertRowid;
    const camp2 = d.prepare('INSERT INTO campaigns(name, channel, subject, message, status, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('معرفی تشک جدید طبی', 'email', 'تشک جدید بسپار را ببینید', 'تشک جدید ما با فناوری فوم طبی... {name} عزیز از آن بهره‌مند شوید.', 'sent', adminId, nowIso(), nowIso()).lastInsertRowid;
    d.prepare('INSERT INTO campaigns(name, channel, subject, message, status, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('فروش ویژه عمده‌فروشان', 'whatsapp', '', 'فروش ویژه ۱۴۰۴: تخفیف ۸٪ برای سفارش‌های بالای ۵۰ میلیون ریال', 'draft', adminId, nowIso(), nowIso());
    // demo messenger conversations
    const dAdmin = adminId;
    const dAli = userIds['sales_manager_ali.k'];
    const dSara = userIds['sales_sara.m'];
    const dHooman = userIds['sales_hooman.d'];
    const nowD = new Date();
    const minsAgo = (m) => new Date(nowD.getTime() - m * 60000).toISOString();
    function seedMsg(convId, senderId, body, m) {
      d.prepare('INSERT INTO messages(conversation_id, sender_id, type, body, created_at) VALUES(?,?,?,?,?)').run(convId, senderId, 'text', body, minsAgo(m));
    }
    let c1 = d.prepare("SELECT id FROM conversations WHERE type='direct'").get();
    if (!c1) {
      const i1 = d.prepare('INSERT INTO conversations(type, title, member_ids, created_by, created_at) VALUES(?,?,?,?,?)').run('direct', 'علی کریمی', JSON.stringify([dAdmin, dAli]), dAdmin, nowIso()).lastInsertRowid;
      d.prepare('INSERT INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(i1, dAdmin, minsAgo(10));
      d.prepare('INSERT INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(i1, dAli, minsAgo(25));
      seedMsg(i1, dAli, 'سلام، پیش‌فاکتور مشتری «تخت و تشک البرز» آماده شد. لطفاً بررسی کنید.', 480);
      seedMsg(i1, dAdmin, 'ممنون، تا ظهر امشب بررسی می‌کنم. تخفیف ۵٪ هم اعمال کن.', 300);
      seedMsg(i1, dAli, 'انجام شد. مشتری منتظر تأیید نهایی است. 🌙', 120);
    }
    let c2 = d.prepare("SELECT id FROM conversations WHERE type='group'").get();
    if (!c2) {
      const i2 = d.prepare('INSERT INTO conversations(type, title, member_ids, created_by, created_at) VALUES(?,?,?,?,?)').run('group', 'تیم فروش', JSON.stringify([dAdmin, dAli, dSara, dHooman]), dAli, nowIso()).lastInsertRowid;
      for (const u of [dAdmin, dAli, dSara, dHooman]) d.prepare('INSERT INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(i2, u, minsAgo(30));
      seedMsg(i2, dSara, 'سرنخ جدید از نمایشگاه ثبت شد — «صنایع خواب زاگرس» برای اسفنج رول.', 2000);
      seedMsg(i2, dHooman, 'من هم فردا با «فروشگاه تشک کاوه» جلسه دارم.', 1500);
      seedMsg(i2, dAli, 'عالی. @سارا.s لطفاً امتیاز AI سرنخ‌های جدید را چک کن.', 900);
      seedMsg(i2, dAdmin, 'بچه‌ها، گزارش فروش این هفته پنجشنبه در جلسه تیم است. 👏', 200);
    }
    let c3 = d.prepare("SELECT id FROM conversations WHERE type='channel'").get();
    if (!c3) {
      const i3 = d.prepare('INSERT INTO conversations(type, title, member_ids, created_by, created_at) VALUES(?,?,?,?,?)').run('channel', 'اطلاعیه‌های شرکت', JSON.stringify([dAdmin, dAli, dSara, dHooman]), dAdmin, nowIso()).lastInsertRowid;
      for (const u of [dAdmin, dAli, dSara, dHooman]) d.prepare('INSERT INTO conversation_members(conversation_id, user_id, last_read_at) VALUES(?,?,?)').run(i3, u, minsAgo(5000));
      seedMsg(i3, dAdmin, '📢 برنامه تولید هفته آینده از شنبه فعال می‌شود. سفارش‌ها را تا جمعه ثبت کنید.', 4300);
      seedMsg(i3, dAdmin, ' یادآوری: نمونه‌های آزمایشگاهی را حداکثر تا ساعت ۱۲ صبح به آزمایشگاه برسانید.', 1500);
    }
    // KB documents
    const kbDocs = [
      ['فرآیند تولید فوم پلی‌یورتان — دستورالعمل', 'sop', 'مواد اولیه: پلی‌ول 110L، MDI، کاتالیزور T-91، آب و سورفکتانت. نسبت باچ: ۱۰ جزء پلی‌ول به ۱۰۰ جزء ایزوسیانات. دمای مواد: ۲۰ تا ۲۵ درجه. زمان پلیمریزیشن ۱۵ دقیقه. تراکم هدف ۲۸ کیلوگرم بر مترمکعب با انحراف حداکثر ۲ واحد. بعد از فرمینگ، فوم باید ۲۴ ساعت در دمای ۶۰ درجه خشک شود. کنترل چگالی هر ۲ ساعت نمونه‌گیری می‌شود و در صورت انحراف از محدوده ۲۸±۲، باچ متوقف و تنظیم می‌شود.'],
      ['شرایط گارانتی محصولات بسپار', 'faq', 'تمام محصولات فومی دارای ۱۸ ماه گارانتی در برابر عیوب تولیدی هستند. گارانتی شامل فرورفتگی بیش از ۱۰٪ در شرایط استفاده عادی، ترک و جداشدگی لایه‌ها می‌شود. مواردی که ناشی از نگهداری نادرست، رطوبت یا ضربه محسوب می‌شوند خارج از گارانتی است. برای فعال‌سازی گارانتی باید فاکتور خرید و شماره سریال ارسال شود.'],
      ['پاسخ‌گویی به شکایات مشتریان — پروتکل', 'sop', 'شکایات با اولویت بحرانی حداکثر ۱۲ ساعت، اولویت بالا ۲۴ ساعت، متوسط ۴۸ ساعت و کم ۱۲۰ ساعت پاسخ داده می‌شوند. مسئول واحد کیفیت باید هر شکایت را با یک نفر متخصص پیوند بزند. پس از حل، رضایت مشتری (CSAT) ثبت می‌شود. شکایات تکراری (بیش از ۲ مورد در ۹۰ روز) به مدیرعامل گزارش می‌شود.'],
      ['مشخصات فنی اسفنج رول تراکم ۲۸', 'product', 'اسفنج رول پلی‌یورتان تراکم ۲۸: ضخامت ۵ تا ۲۰ سانتی‌متر، عرض رول ۲۰۰ سانتی‌متر، چگالی ۲۸±۲ کیلوگرم بر مترمکعب، مقاومت فشاری ۳۵ کیلوپاسکال، بازگشت ارتجاعی حداقل ۳۵٪، رنگ سفید یا مشکی، آنتی‌باکتریال. مناسب تشک، مبل، صندلی خودرو و بالشت.'],
      ['ایمنی و بهداشت محیط تولید', 'sop', 'تمام کارکنان هنگام ورود به خط تولید باید ماسک، عینک و دستکش مناسب را استفاده کنند. هوای محفظه فرمینگ باید با کولینگ کافی ۲۵ درجه باشد. چک‌لیست ایمنی هر ۴ ساعت توسط سرپرست تکمیل شود. در صورت نشت MDI، ناحیه فوراً خنک و تهویه شود.'],
      ['شرایط پرداخت و اعتبار مشتریان', 'faq', 'مشتریان عمده‌فروش تا سقف اعتبار اعلام‌شده (حداکثر ۲۰۰ میلیون ریال) می‌توانند ۳۰ روز اعتبار داشته باشند. پرداخت از طریق حواله به شماره ۰۱۰-۱۲۳۴۵۶۷۸۹ به نام شرکت دانش‌بنیان بسپار فوم غرب. فاکتورهای بالای ۱۰۰ میلیون ریال با ۵۰٪ پیش‌پرداخت ثبت می‌شوند.'],
    ];
    for (const [t, k, c] of kbDocs) {
      d.prepare('INSERT INTO documents(title, kind, category, text_content, tags, user_id, created_at) VALUES(?,?,?,?,?,?,0)')
        .run(t, k, c, c, 'آنها', nowIso());
      const did = d.prepare('SELECT MAX(id) id FROM documents').get().id;
      require('./db').searchIndex('document', did, t, c.slice(0, 2000));
    }
    // stock alerts for low items
    for (const p of prods) {
      if (p.qty - p.reorder <= p.reorder * 0.5) {
        d.prepare('INSERT INTO stock_alerts(product_id, level, message, created_at) VALUES(?,?,?,?)')
          .run(p.id, 'reorder', `موجودی «${p.name}» پایین است.`, nowIso());
      }
    }
  });
  tx();
  console.log('[seed] demo data done');
}
run();
