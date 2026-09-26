-- 010_voip.sql — VoIP / IP-PBX integration layer (additive; touches nothing else)
-- Call records (CDR) from PBX/webhook, matched to Customer/Contact/Lead,
-- linked to Follow-up/Opportunity/Ticket/Complaint/Contract. Internal WebRTC
-- calls (calls_log) are untouched.

CREATE TABLE IF NOT EXISTS voip_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_call_id TEXT,               -- Call ID از PBX/VoIP (کلید یکتایی/anti-duplicate)
  call_ref TEXT,                       -- شناسه داخلی VC-xxxx
  provider TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'inbound',   -- inbound / outbound
  status TEXT NOT NULL DEFAULT 'ringing',      -- ringing / answered / missed / no_answer / busy / cancelled / ended
  outcome TEXT,                        -- نتیجه تماس (کد قابل تنظیم)
  outcome_fa TEXT,
  caller TEXT,                         -- شماره زنگ‌زنان
  called TEXT,                         -- شماره زنگ‌خورده
  extension TEXT,
  agent_extension TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,                  -- کاربر/اپراتور
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,          -- پیوند به Master (id، نه نام)
  contact_id INTEGER REFERENCES customer_contacts(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  complaint_id INTEGER REFERENCES complaints(id) ON DELETE SET NULL,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  followup_id INTEGER REFERENCES followups(id) ON DELETE SET NULL,
  matched_by TEXT,                     -- customer_phone / customer_mobile / contact_mobile / lead_phone / manual
  started_at TEXT,                     -- ISO UTC
  answered_at TEXT,
  ended_at TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  recording_id TEXT,
  recording_file TEXT,                 -- مسیر داخل data/recordings (دسترسی با Authentication)
  recording_ready INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  raw TEXT,                            -- payload خام PBX
  synced_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(provider, external_call_id)
);
CREATE INDEX IF NOT EXISTS idx_voip_calls_started ON voip_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_voip_calls_customer ON voip_calls(customer_id);
CREATE INDEX IF NOT EXISTS idx_voip_calls_user ON voip_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_voip_calls_status ON voip_calls(status);
CREATE INDEX IF NOT EXISTS idx_voip_calls_caller ON voip_calls(caller);
CREATE INDEX IF NOT EXISTS idx_voip_calls_external ON voip_calls(external_call_id);

-- permissions (parity with seed.js for fresh installs)
INSERT OR IGNORE INTO permissions(entity, action) VALUES
  ('voip_call', 'view'), ('voip_call', 'create'), ('voip_call', 'edit'),
  ('voip_call', 'export'), ('voip_call', 'delete'),
  ('voip_setting', 'view'), ('voip_setting', 'edit');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name = 'super_admin' AND p.entity IN ('voip_call', 'voip_setting');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name = 'ceo' AND p.entity = 'voip_call' AND p.action IN ('view', 'export');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name IN ('sales_manager', 'sales', 'rep') AND p.entity = 'voip_call' AND p.action IN ('view', 'create', 'edit', 'export');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'own' FROM roles r, permissions p
WHERE r.name = 'support' AND p.entity = 'voip_call' AND p.action IN ('view', 'create', 'edit');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name IN ('finance_manager', 'finance', 'marketing', 'quality_manager', 'production_manager', 'warehouse_manager', 'lab', 'rd')
  AND p.entity = 'voip_call' AND p.action IN ('view', 'export');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name = 'sales_manager' AND p.entity = 'voip_setting' AND p.action IN ('view', 'edit');
