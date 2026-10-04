PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN evidence_reason TEXT;
ALTER TABLE documents ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (evidence_status IN ('ACTIVE','REFERENCE','ARCHIVED'));
