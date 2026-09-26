-- 023: E-Signatures + Approval Chains (signature-based approvals) + Bulk Delete permission.
-- ADDITIVE only. No existing table is modified.
--
-- 1) user_signatures: each user's own e-signature image, tied 1:1 to user_id.
-- 2) permissions: signature:approve (may sign/use e-signature), bulk_delete:delete
--    (may bulk-delete), approval_chain:edit (admin: manage approval chains).
-- 3) approval_chains / approval_chain_stages / doc_approvals: a generic,
--    role-based, sequential, signature-capturing approval workflow that works
--    for any document type (seeded default = quote: sales_manager ->
--    finance_manager -> ceo). Extensible to other modules without code changes.

-- ---------- 1) user signatures ----------
CREATE TABLE IF NOT EXISTS user_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  file_name TEXT,
  file_path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/png',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_signatures_user ON user_signatures(user_id);

-- ---------- 2) permissions + default grants ----------
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('signature', 'approve');
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('bulk_delete', 'delete');
INSERT OR IGNORE INTO permissions(entity, action) VALUES ('approval_chain', 'edit');

-- signature:approve default grants to management roles (super_admin has *:*).
-- Admins adjust per role in Admin -> Roles (signature row, "approve" column).
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'signature' AND p.action = 'approve'
  AND r.name IN ('sales_manager','finance_manager','quality_manager','warehouse_manager','production_manager','ceo');

-- bulk_delete:delete default grants mirroring bulk_edit (management only).
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'bulk_delete' AND p.action = 'delete'
  AND r.name IN ('sales_manager','ceo');

-- ---------- 3) approval chains ----------
CREATE TABLE IF NOT EXISTS approval_chains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_chain_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acs_chain ON approval_chain_stages(chain_id, position);

CREATE TABLE IF NOT EXISTS doc_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  doc_id INTEGER NOT NULL,
  chain_id INTEGER,
  stage_id INTEGER,
  position INTEGER NOT NULL,
  label TEXT,
  required_role TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting',
  approver_id INTEGER,
  approver_name TEXT,
  note TEXT,
  signed_at TEXT,
  signature_path TEXT,
  signature_mime TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_docapprovals_doc ON doc_approvals(doc_type, doc_id);

-- Seeded default chain for quotes (the documented example). Active by default;
-- admins can edit stages/roles or deactivate it in Admin -> Approvals.
INSERT OR IGNORE INTO approval_chains(id, doc_type, name, active, created_by, created_at, updated_at)
VALUES (1, 'quote', 'تأیید پیش‌فاکتور', 1, 1,
        (SELECT COALESCE(MAX(created_at), datetime('now')) FROM users),
        (SELECT COALESCE(MAX(created_at), datetime('now')) FROM users));
INSERT OR IGNORE INTO approval_chain_stages(id, chain_id, position, label, role, created_at) VALUES
  (1, 1, 1, 'تأیید مدیر فروش',   'sales_manager',  (SELECT COALESCE(MAX(created_at), datetime('now')) FROM users)),
  (2, 1, 2, 'تأیید مدیر مالی',   'finance_manager',(SELECT COALESCE(MAX(created_at), datetime('now')) FROM users)),
  (3, 1, 3, 'تأیید مدیرعامل',    'ceo',            (SELECT COALESCE(MAX(created_at), datetime('now')) FROM users));
