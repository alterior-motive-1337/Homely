-- Allow an account to participate in more than one home, selecting its active home per session.
ALTER TABLE auth_sessions ADD COLUMN home_id TEXT REFERENCES homes(id);
UPDATE auth_sessions SET home_id=(
  SELECT m.home_id FROM home_memberships m WHERE m.user_id=auth_sessions.user_id
  ORDER BY m.joined_at LIMIT 1
) WHERE home_id IS NULL;

CREATE TABLE home_invitations (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('MEMBER','VIEWER')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_home_invites_home ON home_invitations(home_id,created_at DESC);
CREATE INDEX idx_home_invites_pending ON home_invitations(email,expires_at);
