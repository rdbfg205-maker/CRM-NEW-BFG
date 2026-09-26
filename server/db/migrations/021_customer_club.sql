-- 021: Customer Club (Loyalty) — Section 9. ADDITIVE only.
-- The loyalty tables (loyalty_tiers / loyalty_accounts / loyalty_transactions) already exist
-- and are untouched. This migration only adds the per-entity permissions used by the new
-- Customer Club API (accounts / transactions / rules / export) and default role grants.
-- super_admin already has *:* via the wildcard; admins can adjust per role in Admin → Roles.

INSERT OR IGNORE INTO permissions(entity, action) VALUES
  ('loyalty_account', 'view'),
  ('loyalty_account', 'create'),
  ('loyalty_account', 'edit'),
  ('loyalty_account', 'delete'),
  ('loyalty_account', 'export'),
  ('loyalty_transaction', 'view'),
  ('loyalty_transaction', 'create'),
  ('loyalty_transaction', 'edit'),
  ('loyalty_transaction', 'delete'),
  ('loyalty_transaction', 'export');

-- Management: full control of the customer club
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity IN ('loyalty_account', 'loyalty_transaction')
  AND r.name IN ('sales_manager', 'finance_manager', 'ceo');

-- Sales (own customers) + Finance: view + daily operations (enroll / points), no delete
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity IN ('loyalty_account', 'loyalty_transaction')
  AND p.action IN ('view', 'create', 'edit')
  AND r.name IN ('sales', 'finance');

-- Export rights for finance & management reporting (delete stays with management + super_admin)
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity IN ('loyalty_account', 'loyalty_transaction')
  AND p.action = 'export'
  AND r.name IN ('sales', 'finance');
