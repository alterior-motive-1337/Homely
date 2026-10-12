-- Authentication is separate from household records. The existing home is private to one approved Google identity.
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE home_owners (
  home_id TEXT PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE auth_login_attempts (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_auth_attempts_expiry ON auth_login_attempts(expires_at);
