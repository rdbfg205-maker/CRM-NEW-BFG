-- 004_calendar: first-class Calendar & Planning events + permissions
CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'meeting',
  start_at TEXT NOT NULL,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  participant_ids TEXT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  contact_id INTEGER,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  complaint_id INTEGER REFERENCES complaints(id) ON DELETE SET NULL,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  warranty_id INTEGER REFERENCES warranties(id) ON DELETE SET NULL,
  project_id INTEGER,
  ref_type TEXT,
  ref_id INTEGER,
  description TEXT,
  location TEXT,
  online_url TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'scheduled',
  reminder_minutes INTEGER,
  recurrence TEXT NOT NULL DEFAULT 'none',
  recurrence_rule TEXT,
  recurrence_end_at TEXT,
  color TEXT,
  reminder_sent_at TEXT,
  created_by INTEGER,
  created_at TEXT,
  updated_by INTEGER,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cal_events_start ON calendar_events(start_at);
CREATE INDEX IF NOT EXISTS idx_cal_events_end ON calendar_events(end_at);
CREATE INDEX IF NOT EXISTS idx_cal_events_user ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_cal_events_customer ON calendar_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_cal_events_type ON calendar_events(type, status);
CREATE INDEX IF NOT EXISTS idx_cal_events_reminder ON calendar_events(reminder_minutes, reminder_sent_at, status);

-- permissions for the new entity (idempotent)
INSERT OR IGNORE INTO permissions(entity, action) VALUES
  ('calendar_event','view'), ('calendar_event','create'), ('calendar_event','edit'),
  ('calendar_event','delete'), ('calendar_event','export'), ('calendar_event','approve'),
  ('calendar_event','archive'), ('calendar_event','restore'), ('calendar_event','import');

-- role grants (idempotent): managers view/create/edit all, staff own
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
  SELECT r.id, p.id, 'all' FROM roles r, permissions p
  WHERE r.name IN ('ceo','sales_manager','production_manager','quality_manager','finance_manager','warehouse_manager','marketing')
    AND p.entity='calendar_event' AND p.action IN ('view','create','edit','export');
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
  SELECT r.id, p.id, 'all' FROM roles r, permissions p
  WHERE r.name IN ('super_admin','ceo') AND p.entity='calendar_event';
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
  SELECT r.id, p.id, 'own' FROM roles r, permissions p
  WHERE r.name IN ('sales','finance','lab','support','rd','rep')
    AND p.entity='calendar_event' AND p.action IN ('view','create','edit');
-- super_admin gets every action (parity with seed behavior)
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
  SELECT r.id, p.id, 'all' FROM roles r, permissions p
  WHERE r.name='super_admin' AND p.entity='calendar_event';
