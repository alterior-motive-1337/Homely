-- Isolate every household's records and staged files.
CREATE TABLE home_memberships (
  home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('OWNER','MEMBER','VIEWER')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY(home_id,user_id)
);
CREATE INDEX idx_memberships_user ON home_memberships(user_id,home_id);
INSERT INTO home_memberships(home_id,user_id,role,joined_at)
 SELECT home_id,user_id,'OWNER',claimed_at FROM home_owners;

ALTER TABLE transactions ADD COLUMN home_id TEXT REFERENCES homes(id);
UPDATE transactions SET home_id=(SELECT id FROM homes ORDER BY created_at LIMIT 1) WHERE home_id IS NULL;
CREATE INDEX idx_transaction_home ON transactions(home_id,created_at DESC);

ALTER TABLE documents ADD COLUMN home_id TEXT REFERENCES homes(id);
UPDATE documents SET home_id=COALESCE(
 (SELECT s.home_id FROM assets a JOIN systems s ON s.id=a.system_id WHERE a.id=documents.asset_id),
 (SELECT r.home_id FROM repairs r WHERE r.id=documents.repair_id),
 (SELECT c.home_id FROM charges c WHERE c.id=documents.charge_id),
 (SELECT p.home_id FROM purchase_candidates p WHERE p.id=documents.purchase_candidate_id),
 (SELECT id FROM homes ORDER BY created_at LIMIT 1)
) WHERE home_id IS NULL;
CREATE INDEX idx_documents_home ON documents(home_id,created_at DESC);

ALTER TABLE file_uploads ADD COLUMN home_id TEXT REFERENCES homes(id);
UPDATE file_uploads SET home_id=COALESCE(
 (SELECT d.home_id FROM documents d WHERE d.id=file_uploads.document_id),
 (SELECT id FROM homes ORDER BY created_at LIMIT 1)
) WHERE home_id IS NULL;
CREATE INDEX idx_uploads_home ON file_uploads(home_id,document_id);
