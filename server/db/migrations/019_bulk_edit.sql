-- 019: Bulk Edit permission (Section 4) — ADDITIVE only.
-- No table changes: bulk edits reuse the existing per-record validation/scope
-- engine and the immutable audit_logs table (action BULK_EDIT / BULK_EDIT_SUMMARY).

-- Dedicated permission for controlled bulk editing (same entity:action model
-- as price_override). Enforced server-side ONLY; the UI just hides the button.
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('bulk_edit', 'edit');

-- Default grants to management roles (super_admin already has *:* wildcard),
-- mirroring the price_override grants from migration 018. Admins can adjust
-- per role in Admin → Roles.
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'bulk_edit' AND p.action = 'edit'
  AND r.name IN ('sales_manager', 'ceo');
