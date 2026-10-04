PRAGMA foreign_keys = ON;

ALTER TABLE assets ADD COLUMN condition TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK (condition IN ('UNKNOWN','NEW','GOOD','FAIR','POOR','FAILED'));

CREATE TABLE repairs (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  repair_date TEXT NOT NULL,
  cost_cents INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),
  contractor TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE charges (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('MONTHLY','QUARTERLY','ANNUAL','OTHER')),
  due_day INTEGER CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31)),
  provider TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE purchase_candidates (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SAVED'
    CHECK (status IN ('SAVED','SHORTLISTED','PURCHASED','DISMISSED')),
  budget_cents INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0),
  expected_cost_cents INTEGER CHECK (expected_cost_cents IS NULL OR expected_cost_cents >= 0),
  source_url TEXT,
  source_name TEXT,
  rationale TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE documents ADD COLUMN repair_id TEXT REFERENCES repairs(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN charge_id TEXT REFERENCES charges(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN purchase_candidate_id TEXT REFERENCES purchase_candidates(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN source_url TEXT;
ALTER TABLE documents ADD COLUMN provenance TEXT;
ALTER TABLE documents ADD COLUMN occurred_at TEXT;

ALTER TABLE timeline_events ADD COLUMN repair_id TEXT REFERENCES repairs(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN charge_id TEXT REFERENCES charges(id) ON DELETE SET NULL;
ALTER TABLE timeline_events ADD COLUMN purchase_candidate_id TEXT REFERENCES purchase_candidates(id) ON DELETE SET NULL;

CREATE INDEX idx_repairs_home_date ON repairs(home_id, repair_date DESC);
CREATE INDEX idx_repairs_asset_date ON repairs(asset_id, repair_date DESC);
CREATE INDEX idx_repairs_issue ON repairs(issue_id);
CREATE INDEX idx_charges_home_active ON charges(home_id, active, category);
CREATE INDEX idx_purchase_home_status ON purchase_candidates(home_id, status, created_at DESC);
CREATE INDEX idx_documents_repair ON documents(repair_id);
CREATE INDEX idx_documents_charge ON documents(charge_id);
CREATE INDEX idx_documents_purchase ON documents(purchase_candidate_id);
