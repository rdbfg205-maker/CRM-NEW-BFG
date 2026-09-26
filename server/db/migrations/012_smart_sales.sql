-- 012_smart_sales.sql — «تیم هوشمند فروش» (additive; touches nothing existing)
-- Sales Target Engine: company / department / salesperson targets per period.
-- Achievement is computed live from real invoice data (no parallel data store).
CREATE TABLE IF NOT EXISTS sales_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL DEFAULT 'salesperson',   -- company | department | salesperson
  scope_ref INTEGER,                                 -- NULL=company · department id=users.department (text) stored in scope_name · salesperson=user id
  scope_name TEXT NOT NULL DEFAULT '',               -- '' = all company · department name · user full_name
  period_type TEXT NOT NULL DEFAULT 'month',         -- month | quarter | year
  period_start TEXT NOT NULL,                        -- ISO date of period start (e.g. 2026-09-01)
  amount REAL NOT NULL DEFAULT 0,                    -- target amount (rial)
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_targets_scope ON sales_targets(scope_type, scope_ref, period_type, period_start);

-- permissions (parity with seed.js for fresh installs)
INSERT OR IGNORE INTO permissions(entity, action) VALUES
  ('smart_sales', 'view'), ('smart_sales', 'use'), ('smart_sales', 'manage');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name IN ('super_admin','ceo','sales_manager','sales','rep','finance_manager','finance','marketing') AND p.entity='smart_sales' AND p.action='view';
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name IN ('super_admin','sales_manager','sales','rep') AND p.entity='smart_sales' AND p.action='use';
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all' FROM roles r, permissions p
WHERE r.name IN ('super_admin','sales_manager') AND p.entity='smart_sales' AND p.action='manage';
