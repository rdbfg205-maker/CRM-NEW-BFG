-- BASPAR FOAM SMART CRM — Initial Schema (SQLite)
PRAGMA journal_mode = WAL;

-- ============ AUTH / USERS ============
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  department TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  totp_secret TEXT DEFAULT '',
  totp_enabled INTEGER DEFAULT 0,
  avatar TEXT DEFAULT '',
  last_login_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  name_fa TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_system INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  action TEXT NOT NULL,
  UNIQUE(entity, action)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  scope TEXT DEFAULT 'all',
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  user_agent TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- ============ SETTINGS ============
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT,
  PRIMARY KEY (user_id, key)
);

-- ============ AUDIT ============
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  ip TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);

-- ============ GENERIC (tags/comments/attachments/activities) ============
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#c9a227',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_tags (
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id, tag_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id, created_at DESC);

-- ============ CUSTOMERS ============
CREATE TABLE IF NOT EXISTS customer_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  description TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  type TEXT DEFAULT 'company',              -- company | person
  name TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  tax_code TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  phone2 TEXT DEFAULT '',
  mobile TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  province TEXT DEFAULT '',
  city TEXT DEFAULT '',
  address TEXT DEFAULT '',
  industry TEXT DEFAULT '',
  activity_type TEXT DEFAULT '',
  category_id INTEGER,
  credit_limit REAL DEFAULT 0,
  credit_used REAL DEFAULT 0,
  credit_status TEXT DEFAULT 'نورمال',
  status TEXT DEFAULT 'active',             -- active | inactive | blocked
  salesperson_id INTEGER,
  representative_id INTEGER,
  churn_score REAL DEFAULT 0,
  churn_data TEXT,
  custom_fields TEXT,
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_tax ON customers(tax_code);
CREATE TABLE IF NOT EXISTS customer_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  mobile TEXT DEFAULT '',
  email TEXT DEFAULT '',
  is_primary INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON customer_contacts(customer_id);

-- ============ LEADS / OPPORTUNITIES / PIPELINES ============
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  source TEXT DEFAULT 'manual',
  contact_name TEXT DEFAULT '',
  company TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  product_interest TEXT DEFAULT '',
  estimated_value REAL DEFAULT 0,
  probability INTEGER DEFAULT 10,
  status TEXT DEFAULT 'new',                -- new | contacted | qualified | converted | lost
  salesperson_id INTEGER,
  next_action TEXT DEFAULT '',
  next_followup_at TEXT,
  score REAL DEFAULT 0,
  score_data TEXT,
  customer_id INTEGER,
  notes TEXT DEFAULT '',
  custom_fields TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE TABLE IF NOT EXISTS pipelines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  color TEXT DEFAULT '#c9a227',
  is_won INTEGER DEFAULT 0,
  is_lost INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  pipeline_id INTEGER,
  stage_id INTEGER,
  customer_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  amount REAL DEFAULT 0,
  quantity REAL DEFAULT 0,
  probability INTEGER DEFAULT 20,
  expected_close_at TEXT,
  competitors TEXT DEFAULT '',
  salesperson_id INTEGER,
  status TEXT DEFAULT 'open',               -- open | won | lost
  won_at TEXT,
  lost_reason TEXT DEFAULT '',
  quote_id INTEGER,
  notes TEXT DEFAULT '',
  custom_fields TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_stage ON opportunities(stage_id);
CREATE INDEX IF NOT EXISTS idx_opp_customer ON opportunities(customer_id);
CREATE TABLE IF NOT EXISTS opportunity_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  qty REAL DEFAULT 1,
  price REAL DEFAULT 0,
  discount_pct REAL DEFAULT 0
);

-- ============ PRODUCTS / PRICING ============
CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,
  name TEXT NOT NULL,
  name_en TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  sku TEXT DEFAULT '',
  name TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  category_id INTEGER,
  unit TEXT DEFAULT 'عدد',
  description TEXT DEFAULT '',
  spec TEXT,                                 -- JSON technical specs
  price_retail REAL DEFAULT 0,
  price_wholesale REAL DEFAULT 0,
  price_export REAL DEFAULT 0,
  price_cost REAL DEFAULT 0,
  min_order REAL DEFAULT 0,
  stock_qty REAL DEFAULT 0,
  reserved_qty REAL DEFAULT 0,
  reorder_point REAL DEFAULT 0,
  max_stock REAL DEFAULT 0,
  is_raw_material INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  image TEXT DEFAULT '',
  custom_fields TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE TABLE IF NOT EXISTS price_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  currency TEXT DEFAULT 'IRR',
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  price_list_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  price REAL NOT NULL,
  min_qty REAL DEFAULT 0,
  UNIQUE(price_list_id, product_id)
);

-- ============ SALES DOCUMENTS ============
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  customer_id INTEGER NOT NULL,
  salesperson_id INTEGER,
  price_list_id INTEGER,
  currency TEXT DEFAULT 'IRR',
  discount_pct REAL DEFAULT 0,
  shipping REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',              -- draft | sent | accepted | declined | converted | expired | cancelled
  valid_until TEXT,
  order_id INTEGER,
  notes TEXT DEFAULT '',
  subtotal REAL DEFAULT 0,
  total REAL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  qty REAL DEFAULT 1,
  price REAL DEFAULT 0,
  discount_pct REAL DEFAULT 0,
  line_total REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  quote_id INTEGER,
  customer_id INTEGER NOT NULL,
  salesperson_id INTEGER,
  status TEXT DEFAULT 'confirmed',          -- draft | confirmed | in_production | ready | shipped | delivered | cancelled | returned
  order_date TEXT NOT NULL,
  due_date TEXT,
  delivery_date TEXT,
  delivery_address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  total REAL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  qty REAL DEFAULT 1,
  price REAL DEFAULT 0,
  discount_pct REAL DEFAULT 0,
  line_total REAL DEFAULT 0,
  status TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  order_id INTEGER,
  quote_id INTEGER,
  customer_id INTEGER NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT DEFAULT 'IRR',
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  shipping REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'unpaid',             -- unpaid | partial | paid | overdue | cancelled
  terms TEXT DEFAULT '',
  tax_number TEXT DEFAULT '',
  tax_system_status TEXT DEFAULT 'unsent',  -- unsent | sent | confirmed | rejected
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(issue_date);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  qty REAL DEFAULT 1,
  price REAL DEFAULT 0,
  discount_pct REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  line_total REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  invoice_id INTEGER,
  customer_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'bank',               -- cash | check | bank | installment | other
  reference TEXT DEFAULT '',
  check_info TEXT DEFAULT '',
  paid_at TEXT NOT NULL,
  notes TEXT DEFAULT '',
  received_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- ============ COMMISSIONS ============
CREATE TABLE IF NOT EXISTS commission_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  basis TEXT DEFAULT 'amount',               -- amount | margin | quantity
  pct REAL NOT NULL,
  product_id INTEGER,
  customer_id INTEGER,
  monthly_target REAL DEFAULT 0,
  target_bonus_pct REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  period TEXT NOT NULL,                      -- e.g. 1405-03
  rule_id INTEGER,
  base REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',               -- draft | confirmed | paid
  created_at TEXT NOT NULL,
  UNIQUE(user_id, period, rule_id)
);

-- ============ SUPPLIERS / PURCHASE ============
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  name TEXT NOT NULL,
  tax_code TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  category TEXT DEFAULT '',
  quality_rating REAL DEFAULT 0,
  delivery_rating REAL DEFAULT 0,
  price_rating REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  custom_fields TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  supplier_id INTEGER NOT NULL,
  status TEXT DEFAULT 'draft',              -- draft | sent | partial | received | cancelled
  order_date TEXT NOT NULL,
  expected_date TEXT,
  total REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS po_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  product_id INTEGER,
  name TEXT NOT NULL,
  qty REAL DEFAULT 0,
  price REAL DEFAULT 0,
  received_qty REAL DEFAULT 0
);

-- ============ INVENTORY ============
CREATE TABLE IF NOT EXISTS stock_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  type TEXT NOT NULL,                        -- in | out | transfer | adjust | reservation
  qty REAL NOT NULL,
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  note TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_txn_product ON stock_transactions(product_id, created_at DESC);
CREATE TABLE IF NOT EXISTS stock_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  level TEXT DEFAULT 'reorder',
  message TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- ============ LABORATORY ============
CREATE TABLE IF NOT EXISTS lab_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  customer_id INTEGER,
  order_id INTEGER,
  sample_desc TEXT DEFAULT '',
  sample_code TEXT DEFAULT '',
  test_type TEXT DEFAULT '',
  priority TEXT DEFAULT 'normal',           -- low | normal | high | urgent
  status TEXT DEFAULT 'received',           -- received | in_progress | done | reported | cancelled
  received_at TEXT NOT NULL,
  due_at TEXT,
  analyst_id INTEGER,
  notes TEXT DEFAULT '',
  report_generated_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS lab_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  test_name TEXT NOT NULL,
  method TEXT DEFAULT '',
  result_value TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  spec_text TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',            -- pending | pass | fail
  analyst TEXT DEFAULT '',
  test_date TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_results_request ON lab_results(request_id);

-- ============ COMPLAINTS / SERVICE ============
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  customer_id INTEGER NOT NULL,
  source TEXT DEFAULT 'manual',             -- phone | sms | website | instagram | whatsapp | portal | email | manual
  category TEXT DEFAULT 'quality',          -- quality | product | shipping | delay | financial | service | laboratory | sales | other
  subject TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium',           -- low | medium | high | critical
  status TEXT DEFAULT 'new',                -- new | in_progress | waiting | resolved | closed | rejected
  assigned_to INTEGER,
  department TEXT DEFAULT '',
  sla_hours INTEGER DEFAULT 48,
  due_at TEXT,
  resolved_at TEXT,
  sentiment_score REAL,
  ai_category TEXT,
  ai_root_cause TEXT,
  repeat_of INTEGER,
  csat INTEGER,
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE TABLE IF NOT EXISTS complaint_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  customer_id INTEGER NOT NULL,
  type TEXT DEFAULT 'service',              -- warranty | technical | service | other
  subject TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',               -- open | in_progress | waiting | resolved | closed
  assigned_to INTEGER,
  sla_due_at TEXT,
  resolved_at TEXT,
  related_complaint_id INTEGER,
  csat INTEGER,
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS warranties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  order_id INTEGER,
  product_name TEXT DEFAULT '',
  serial TEXT DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'active',             -- active | expired | claim
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  customer_id INTEGER,
  supplier_id INTEGER,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'sales',                -- sales | service | warranty | other
  start_date TEXT,
  end_date TEXT,
  value REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',              -- draft | active | expired | terminated
  file TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1
);

-- ============ MARKETING / LOYALTY ============
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT DEFAULT 'sms',               -- sms | email | whatsapp
  subject TEXT DEFAULT '',
  message TEXT NOT NULL,
  audience_filter TEXT,                     -- JSON
  schedule_at TEXT,
  status TEXT DEFAULT 'draft',              -- draft | scheduled | sending | sent | done | failed
  total INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  converted_count INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  customer_id INTEGER,
  contact TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',            -- pending | sent | delivered | opened | clicked | converted | failed
  sent_at TEXT,
  error TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  min_points INTEGER DEFAULT 0,
  discount_pct REAL DEFAULT 0,
  color TEXT DEFAULT '#c9a227'
);
CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER UNIQUE NOT NULL,
  tier_id INTEGER,
  points_balance INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  type TEXT NOT NULL,                       -- earn | redeem | adjust
  points INTEGER NOT NULL,
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

-- ============ MESSENGER ============
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                       -- direct | group | channel
  title TEXT NOT NULL,
  member_ids TEXT DEFAULT '[]',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_at TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER,
  type TEXT DEFAULT 'text',                 -- text | file | image | voice | system | call
  body TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  reply_to INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id DESC);
CREATE TABLE IF NOT EXISTS calls_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiator_id INTEGER,
  target_id INTEGER,
  kind TEXT DEFAULT 'voice',                -- voice | video
  status TEXT DEFAULT 'missed',             -- ringing | active | missed | ended
  started_at TEXT NOT NULL,
  ended_at TEXT
);

-- ============ PLANNING ============
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  customer_id INTEGER,
  participant_ids TEXT DEFAULT '[]',
  start_at TEXT NOT NULL,
  end_at TEXT,
  location TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'scheduled',          -- scheduled | done | cancelled
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assignee_id INTEGER,
  related_type TEXT DEFAULT '',
  related_id INTEGER,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',               -- open | in_progress | done | cancelled
  due_at TEXT,
  reminder_sent INTEGER DEFAULT 0,
  completed_at TEXT,
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  subject TEXT DEFAULT '',
  note TEXT DEFAULT '',
  due_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',            -- pending | done | missed
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(due_at, status);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- ============ DOCUMENTS / KB ============
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'library',              -- kb | library | contract | tech | sop | faq | product
  category TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  text_content TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind);

-- ============ AI ============
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,                       -- user | assistant
  content TEXT NOT NULL,
  data TEXT,
  provider TEXT DEFAULT 'local',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                       -- lead | churn | sentiment | opportunity
  score REAL,
  data TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, kind)
);

-- ============ REPORTS ============
CREATE TABLE IF NOT EXISTS report_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  columns TEXT DEFAULT '[]',
  filters TEXT DEFAULT '{}',
  group_by TEXT DEFAULT '',
  sort TEXT DEFAULT '',
  is_system INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                       -- daily | weekly | monthly | manual
  period_start TEXT,
  period_end TEXT,
  title TEXT DEFAULT '',
  data TEXT,
  ai_analysis TEXT DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL
);

-- ============ INTEGRATIONS / MESSAGING ============
CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  name TEXT,
  type TEXT NOT NULL,                       -- sms | email | whatsapp | telegram | payment | accounting | tax
  settings TEXT DEFAULT '{}',
  active INTEGER DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  channel TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body TEXT NOT NULL,
  ref_type TEXT DEFAULT '',
  ref_id INTEGER,
  status TEXT DEFAULT 'queued',             -- queued | sent | delivered | opened | clicked | failed
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
CREATE TABLE IF NOT EXISTS webhooks_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  path TEXT,
  payload TEXT,
  status_code INTEGER,
  created_at TEXT NOT NULL
);

-- ============ APPROVALS / WORKFLOWS ============
CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                       -- discount | price | credit_limit | refund | po | contract | other
  entity_type TEXT DEFAULT '',
  entity_id INTEGER,
  title TEXT NOT NULL,
  reason TEXT DEFAULT '',
  data TEXT,
  requested_by INTEGER NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',            -- pending | approved | rejected | cancelled
  decided_by INTEGER,
  decided_at TEXT,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS workflow_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event TEXT NOT NULL,                      -- complaint_created | lead_created | invoice_overdue | stock_low | opportunity_won | ...
  conditions TEXT DEFAULT '{}',
  actions TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER,
  event TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  result TEXT,
  created_at TEXT NOT NULL
);

-- ============ BACKUP / SYNC ============
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  kind TEXT DEFAULT 'manual',               -- auto | manual
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  entity_type TEXT,
  entity_id INTEGER,
  op TEXT,
  result TEXT,
  created_at TEXT NOT NULL
);

-- ============ SEARCH (FTS) ============
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  title, body, kind, contentless
);
CREATE TABLE IF NOT EXISTS search_map (
  fts_rowid INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  id INTEGER NOT NULL
);
