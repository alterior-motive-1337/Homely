CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PLANNED','ACTIVE','PAUSED','COMPLETE','CANCELLED')),
  description TEXT,
  start_date TEXT,
  target_date TEXT,
  budget_cents INTEGER CHECK(budget_cents IS NULL OR budget_cents >= 0),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_projects_home_status ON projects(home_id, status, target_date);

ALTER TABLE timeline_events
  ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
