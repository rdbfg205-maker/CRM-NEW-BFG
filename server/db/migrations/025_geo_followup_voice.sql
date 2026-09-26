-- 025: Geographic structure (province → city → industrial city) + follow-up
-- attempts + voice registration source. ADDITIVE only — no existing column
-- is dropped or renamed.

-- ---------- 1) geographic levels on customers ----------
ALTER TABLE customers ADD COLUMN industrial_city TEXT DEFAULT '';

-- ---------- 2) geographic levels on contacts ----------
ALTER TABLE customer_contacts ADD COLUMN province TEXT DEFAULT '';
ALTER TABLE customer_contacts ADD COLUMN city TEXT DEFAULT '';
ALTER TABLE customer_contacts ADD COLUMN industrial_city TEXT DEFAULT '';
ALTER TABLE customer_contacts ADD COLUMN updated_at TEXT DEFAULT '';

-- ---------- 3) industrial cities registry (real, user-maintained) ----------
CREATE TABLE IF NOT EXISTS industrial_cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (name, city)
);
CREATE INDEX IF NOT EXISTS idx_industrial_cities_city ON industrial_cities(city);
CREATE INDEX IF NOT EXISTS idx_industrial_cities_province ON industrial_cities(province);

-- ---------- 4) follow-up attempts (multi-follow on one subject) ----------
-- Each attempt is immutable history: date/time, method, result, note, user,
-- optional reminder for the NEXT follow-up.
CREATE TABLE IF NOT EXISTS followup_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  followup_id INTEGER NOT NULL,
  acted_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'call',
  result TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  next_followup_at TEXT,
  reminded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followup_attempts_fu ON followup_attempts(followup_id, id);
CREATE INDEX IF NOT EXISTS idx_followup_attempts_next ON followup_attempts(next_followup_at, reminded_at);

-- ---------- 5) voice registration source on customers ----------
ALTER TABLE customers ADD COLUMN source TEXT DEFAULT '';

-- ---------- 6) permissions: industrial cities registry ----------
INSERT OR IGNORE INTO permissions(entity, action) VALUES
  ('industrial_city', 'view'), ('industrial_city', 'create'), ('industrial_city', 'edit');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'industrial_city'
  AND p.action IN ('view', 'create')
  AND r.name IN ('super_admin', 'sales', 'sales_manager', 'marketing', 'rep', 'support', 'finance', 'finance_manager');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'industrial_city' AND p.action = 'edit' AND r.name = 'super_admin';

-- ---------- 7) import permission for customer/contacts (contacts use customer:import) ----------
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'customer' AND p.action = 'import'
  AND r.name IN ('sales', 'sales_manager', 'marketing', 'ceo');
