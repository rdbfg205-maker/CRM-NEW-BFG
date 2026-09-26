-- 013_crm_completeness.sql — تکمیل CRM (additive; touches nothing existing)
-- 1) customer_contacts: fields requested for the full Contacts module
ALTER TABLE customer_contacts ADD COLUMN address TEXT DEFAULT '';
ALTER TABLE customer_contacts ADD COLUMN notes TEXT DEFAULT '';
ALTER TABLE customer_contacts ADD COLUMN status TEXT DEFAULT 'active';   -- active | inactive

-- 2) opportunities: next follow-up datetime (pipeline card standard)
ALTER TABLE opportunities ADD COLUMN next_followup_at TEXT;

-- 3) Smart Team: Competitor Analysis
CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  products TEXT DEFAULT '',
  price_level TEXT DEFAULT '',          -- پایین‌تر | مشابه | بالاتر | —
  strengths TEXT DEFAULT '',
  weaknesses TEXT DEFAULT '',
  target_market TEXT DEFAULT '',
  target_segments TEXT DEFAULT '',
  advantages_ours TEXT DEFAULT '',      -- مزیت رقابتی ما نسبت به این رقیب
  threats TEXT DEFAULT '',
  opportunities TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 4) Smart Team: Idea Generation
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  goal TEXT DEFAULT '',
  category TEXT DEFAULT 'sales',        -- sales | marketing | customer_growth | customer_retention | new_product | service | cost | process | productivity | market_dev | competitive
  reason TEXT DEFAULT '',               -- دلیل پیشنهاد (بر اساس داده واقعی CRM)
  data_refs TEXT DEFAULT '',            -- رکوردهای واقعی CRM پشت این ایده (شماره/نام)
  priority TEXT DEFAULT 'medium',       -- low | medium | high
  impact TEXT DEFAULT '',               -- اثر احتمالی (کم/متوسط/زیاد + توضیح)
  status TEXT DEFAULT 'proposed',       -- proposed | approved | rejected | done
  owner_id INTEGER,
  task_id INTEGER,                      -- اگر به Task تبدیل شده
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 5) permissions + role grants (parity with seed.js for fresh installs)
INSERT OR IGNORE INTO permissions(entity, action) VALUES
  ('competitor', 'view'), ('competitor', 'edit'), ('competitor', 'delete'),
  ('idea', 'view'), ('idea', 'edit'), ('idea', 'approve');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name IN ('super_admin','ceo','sales_manager','sales','rep','marketing') AND p.entity IN ('competitor','idea') AND p.action IN ('view','edit');
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name IN ('super_admin','ceo','sales_manager') AND p.entity IN ('competitor','idea') AND p.action IN ('delete','approve');
