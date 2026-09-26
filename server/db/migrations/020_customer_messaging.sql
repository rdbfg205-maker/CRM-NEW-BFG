-- 020: Customer Messaging (Section 5) — ADDITIVE only.
-- No existing table/column altered. Reuses existing provider settings
-- (sms/whatsapp/telegram/email in `settings`) and the existing `outbox`
-- table for panel-delivery tracking; this adds the template + message log
-- layer plus two dedicated permissions.

-- Configurable message templates (per event type + channel)
CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'manual',
  channel TEXT NOT NULL DEFAULT 'sms',
  subject TEXT,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msgtpl_event_channel ON message_templates(event_type, channel, active);

-- Customer message log (immutable log — no generic CRUD endpoint exists for it)
CREATE TABLE IF NOT EXISTS customer_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER,
  event_type TEXT NOT NULL DEFAULT 'manual',
  doc_type TEXT,
  doc_id INTEGER,
  doc_number TEXT,
  channel TEXT NOT NULL,
  template_id INTEGER,
  to_addr TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custmsg_customer ON customer_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_custmsg_doc ON customer_messages(doc_type, doc_id);
CREATE INDEX IF NOT EXISTS idx_custmsg_status ON customer_messages(status);

-- Dedicated permissions (same entity:action model as price_override/bulk_edit)
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('customer_message', 'view');
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('customer_message', 'send');
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('customer_message', 'manage');

-- Default grants, mirroring existing role-grant style:
-- view/send: the roles that register quotes/invoices/payments/shipments
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'customer_message' AND p.action IN ('view', 'send')
  AND r.name IN ('sales', 'sales_manager', 'ceo', 'finance', 'finance_manager', 'warehouse_manager');
-- manage: templates + settings (management roles)
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'customer_message' AND p.action = 'manage'
  AND r.name IN ('sales_manager', 'ceo');
