-- 018: Price Override + Audit for Proforma (quote) lines — ADDITIVE only.
-- No existing column/table is altered; legacy rows keep working
-- (base_price=0, override_status=0, payment_stage='cash').

-- Per-line price provenance: how the final unit price was determined
ALTER TABLE quote_items ADD COLUMN base_price REAL NOT NULL DEFAULT 0;
ALTER TABLE quote_items ADD COLUMN override_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quote_items ADD COLUMN override_reason TEXT;
ALTER TABLE quote_items ADD COLUMN payment_stage TEXT NOT NULL DEFAULT 'cash';
-- snapshot of the product code at save time (audit-friendly, self-contained lines)
ALTER TABLE quote_items ADD COLUMN product_code TEXT;

-- Dedicated permission for manual price changes (entity:action model of the system).
-- Enforced server-side on quote line saves; visible in the role matrix UI.
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('price_override', 'edit');

-- Default grants to management roles (super_admin already has *:* via the wildcard).
-- Admins can adjust per role in Admin → Roles.
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'price_override' AND p.action = 'edit'
  AND r.name IN ('sales_manager', 'ceo');
