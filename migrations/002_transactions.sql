CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROPOSED','COMMITTED','REVERSED','REJECTED')),
  reason TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'WEB_UI',
  request_text TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  committed_at TEXT,
  reversed_at TEXT,
  rejected_at TEXT,
  reversal_of TEXT REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transaction_changes (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE','UPDATE','DELETE')),
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_changes_tx ON transaction_changes(transaction_id);
