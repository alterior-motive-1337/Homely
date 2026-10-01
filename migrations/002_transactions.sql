CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROPOSED','COMMITTED','REVERSED','REJECTED')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'USER',
  request_json TEXT NOT NULL DEFAULT '{}',
  before_json TEXT,
  after_json TEXT NOT NULL,
  approved_at TEXT,
  committed_at TEXT,
  reversed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE timeline_events ADD COLUMN maintenance_task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_asset_due ON maintenance_tasks(asset_id, due_at);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
