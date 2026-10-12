-- Preserve legacy single-BLOB files while supporting resumable 50 MB uploads.
ALTER TABLE file_uploads ADD COLUMN expected_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE file_uploads ADD COLUMN received_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE file_uploads ADD COLUMN completed INTEGER NOT NULL DEFAULT 1 CHECK(completed IN (0,1));

CREATE TABLE file_upload_chunks(
  upload_id TEXT NOT NULL REFERENCES file_uploads(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content BLOB NOT NULL,
  PRIMARY KEY(upload_id, chunk_index)
);

CREATE TABLE file_analysis(
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  content_text TEXT NOT NULL,
  model TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);
