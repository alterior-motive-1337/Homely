CREATE TABLE file_uploads (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content BLOB NOT NULL,
  document_id TEXT UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_file_uploads_document ON file_uploads(document_id);
