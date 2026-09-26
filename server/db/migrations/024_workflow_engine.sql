-- 024: Workflow Visual Engine — execution hardening.
-- ADDITIVE only: extends the existing wf_* engine in place (no duplicate tables).
--   - wf_processes: draft_definition (Draft/Publish separation — drafts never
--     affect running executions; the active version stays the published one).
--   - wf_instances: execution_no (WF-YYYY-NNNNNN), context (entity snapshot for
--     variables), error/error_at/attempts (error handling + retry), test_mode.
--     Status vocabulary extended: pending|running|waiting|completed|rejected|
--     terminated|failed|cancelled.
--   - wf_steps: result, signature capture (signature engine integration),
--     error + retry_count (error handling), wait_until (delay/schedule).
--   - wf_schedules: pending delay/schedule waits; the 60s scheduler resumes them.
--   - wf_logs: per-execution event log (monitor + audit).
--   - permissions: workflow entity with 12 granular actions + default grants.

-- ---------- 1) draft definition on processes ----------
ALTER TABLE wf_processes ADD COLUMN draft_definition TEXT DEFAULT '';

-- ---------- 2) execution hardening on instances ----------
ALTER TABLE wf_instances ADD COLUMN execution_no TEXT DEFAULT '';
ALTER TABLE wf_instances ADD COLUMN context TEXT DEFAULT '{}';
ALTER TABLE wf_instances ADD COLUMN error TEXT DEFAULT '';
ALTER TABLE wf_instances ADD COLUMN error_at TEXT;
ALTER TABLE wf_instances ADD COLUMN attempts INTEGER DEFAULT 0;
ALTER TABLE wf_instances ADD COLUMN test_mode INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_wf_instances_execno ON wf_instances(execution_no);
CREATE INDEX IF NOT EXISTS idx_wf_instances_status ON wf_instances(status);

-- ---------- 3) step hardening (approvals/signatures/delays/errors) ----------
ALTER TABLE wf_steps ADD COLUMN result TEXT DEFAULT '';
ALTER TABLE wf_steps ADD COLUMN signature_path TEXT DEFAULT '';
ALTER TABLE wf_steps ADD COLUMN signature_mime TEXT DEFAULT '';
ALTER TABLE wf_steps ADD COLUMN error TEXT DEFAULT '';
ALTER TABLE wf_steps ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE wf_steps ADD COLUMN wait_until TEXT;
CREATE INDEX IF NOT EXISTS idx_wf_steps_active ON wf_steps(status, assignee_id);

-- ---------- 4) schedule registry (delay/schedule nodes) ----------
CREATE TABLE IF NOT EXISTS wf_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  step_id INTEGER,
  due_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'delay',      -- delay | datetime | wait_event
  payload TEXT DEFAULT '{}',
  processed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_schedules_due ON wf_schedules(processed_at, due_at);

-- ---------- 5) execution event log ----------
CREATE TABLE IF NOT EXISTS wf_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL,
  node_id TEXT DEFAULT '',
  step_id INTEGER,
  level TEXT NOT NULL DEFAULT 'info',      -- info | warn | error | success
  message TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_logs_exec ON wf_logs(execution_id, id);

-- ---------- 6) granular workflow permissions ----------
INSERT OR IGNORE INTO permissions(entity, action) VALUES
  ('workflow', 'view'), ('workflow', 'create'), ('workflow', 'edit'),
  ('workflow', 'delete'), ('workflow', 'publish'), ('workflow', 'restore'),
  ('workflow', 'activate'), ('workflow', 'deactivate'), ('workflow', 'execute'),
  ('workflow', 'test'), ('workflow', 'monitor'), ('workflow', 'audit');

-- default grants: full workflow control to super_admin only (via *:*),
-- design visibility (view/monitor/test) to management roles so they can
-- follow processes that concern them; admin adjusts per role in Admin -> Roles.
INSERT OR IGNORE INTO role_permissions(role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM roles r, permissions p
WHERE p.entity = 'workflow'
  AND p.action IN ('view', 'monitor', 'test', 'audit')
  AND r.name IN ('ceo','sales_manager','finance_manager','quality_manager','warehouse_manager','production_manager');
