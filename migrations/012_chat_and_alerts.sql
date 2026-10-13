CREATE TABLE agent_contexts (
  response_id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_context_owner ON agent_contexts(home_id,user_id,created_at DESC);
CREATE TABLE agent_turns (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  request_text TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  response_id TEXT,
  proposals_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_turn_owner ON agent_turns(home_id,user_id,created_at DESC);
CREATE TABLE alert_receipts (
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  alert_key TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY(home_id,user_id,alert_key)
);
