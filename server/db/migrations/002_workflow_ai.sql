-- 002: Workflow Management + Advanced Reporting + AI Gateway
-- ============ Workflow ============
CREATE TABLE IF NOT EXISTS wf_processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT DEFAULT '',
  trigger_event TEXT DEFAULT 'created',
  trigger_value TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  current_version INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wf_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  definition TEXT NOT NULL,
  change_note TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(process_id, version)
);
CREATE TABLE IF NOT EXISTS wf_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  module TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  title TEXT DEFAULT '',
  status TEXT DEFAULT 'running',
  current_node_id TEXT,
  data TEXT DEFAULT '{}',
  started_by INTEGER,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_inst_process ON wf_instances(process_id);
CREATE INDEX IF NOT EXISTS idx_wf_inst_module ON wf_instances(module, entity_id);
CREATE INDEX IF NOT EXISTS idx_wf_inst_status ON wf_instances(status);
CREATE TABLE IF NOT EXISTS wf_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  parent_id INTEGER,
  node_title TEXT DEFAULT '',
  assignee_id INTEGER,
  department TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  remaining INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  form_data TEXT DEFAULT '{}',
  attachment TEXT DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_steps_inst ON wf_steps(instance_id);

-- ============ Advanced Reporting ============
CREATE TABLE IF NOT EXISTS report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  columns TEXT DEFAULT '[]',
  filters TEXT DEFAULT '[]',
  group_by TEXT DEFAULT '',
  group_agg TEXT DEFAULT 'count',
  sort TEXT DEFAULT '',
  sort_dir TEXT DEFAULT 'desc',
  chart_type TEXT DEFAULT 'table',
  template TEXT DEFAULT '{}',
  favorite INTEGER DEFAULT 0,
  permission TEXT DEFAULT 'view',
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ============ AI Gateway ============
CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  module TEXT DEFAULT '',
  request_type TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  model TEXT DEFAULT '',
  source TEXT DEFAULT '',
  success INTEGER DEFAULT 1,
  error TEXT DEFAULT '',
  duration_ms INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_at ON ai_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_user ON ai_logs(user_id, created_at DESC);
