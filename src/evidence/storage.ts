import { randomUUID } from "node:crypto";
import type http from "node:http";
import { once } from "node:events";
import type { HomelyDatabase } from "../db.js";
import { DomainError } from "../domain/transactions.js";

export const MAX_FILE_BYTES = 50_000_000;
export const UPLOAD_CHUNK_BYTES = 1_000_000;

export function allowedMime(mime: string): boolean {
  return /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|ogg|webm|x-wav|flac)|application\/(pdf|octet-stream|zip|msword|vnd\.openxmlformats-officedocument\.[a-z-]+)|text\/(plain|csv)|application\/json)$/.test(mime);
}

export function startUpload(db: HomelyDatabase, input: Record<string,unknown>) {
  const name = String(input.name ?? "").replace(/[\\/\x00-\x1f]/g, "").slice(0,180).trim();
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const size = Number(input.size);
  if (!name) throw new DomainError("File name is required.");
  if (!allowedMime(mimeType)) throw new DomainError("Unsupported file type.", 415);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
    throw new DomainError("File size must be between 1 byte and 50 MB.", 413);
  }
  const id = "upload-" + randomUUID();
  db.prepare("DELETE FROM file_uploads WHERE document_id IS NULL AND created_at < datetime('now','-1 day')").run();
  db.prepare(`INSERT INTO file_uploads(id,file_name,mime_type,content,created_at,expected_bytes,received_bytes,completed)
    VALUES (?,?,?,?,?,?,0,0)`).run(id,name,mimeType,Buffer.alloc(0),new Date().toISOString(),size);
  return { id, name, mimeType, size, chunkSize: UPLOAD_CHUNK_BYTES };
}

export function appendUploadChunk(db: HomelyDatabase, id: string, index: number, bytes: Buffer) {
  if (!Number.isSafeInteger(index) || index < 0) throw new DomainError("Invalid chunk index.");
  if (bytes.length < 1 || bytes.length > UPLOAD_CHUNK_BYTES) throw new DomainError("Chunk must be between 1 byte and 1 MB.", 413);
  db.exec("BEGIN IMMEDIATE;");
  try {
    const file = db.prepare("SELECT expected_bytes, received_bytes, completed, document_id FROM file_uploads WHERE id=?").get(id);
    if (!file || Number(file.completed) !== 0 || file.document_id) throw new DomainError("Upload is not active.", 409);
    const nextIndex = Number(db.prepare("SELECT COUNT(*) AS n FROM file_upload_chunks WHERE upload_id=?").get(id)?.n ?? 0);
    if (nextIndex !== index) throw new DomainError("Chunks must be uploaded in order.", 409);
    const total = Number(file.received_bytes) + bytes.length;
    if (total > Number(file.expected_bytes)) throw new DomainError("Upload exceeds the declared size.", 413);
    db.prepare("INSERT INTO file_upload_chunks(upload_id,chunk_index,content) VALUES (?,?,?)").run(id,index,bytes);
    db.prepare("UPDATE file_uploads SET received_bytes=? WHERE id=?").run(total,id);
    db.exec("COMMIT;");
    return { received: total, expected: Number(file.expected_bytes) };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function finishUpload(db: HomelyDatabase, id: string) {
  const file = db.prepare("SELECT file_name,mime_type,expected_bytes,received_bytes,completed,document_id FROM file_uploads WHERE id=?").get(id);
  if (!file || Number(file.completed) !== 0 || file.document_id) throw new DomainError("Upload is not active.",409);
  if (Number(file.expected_bytes) !== Number(file.received_bytes)) throw new DomainError("Upload is incomplete.",409);
  db.prepare("UPDATE file_uploads SET completed=1 WHERE id=?").run(id);
  return { id, name: file.file_name, mimeType: file.mime_type, size: Number(file.received_bytes) };
}

export function getStoredFile(db: HomelyDatabase, documentId: string) {
  const row = db.prepare("SELECT id,file_name,mime_type,content,received_bytes,expected_bytes,completed FROM file_uploads WHERE document_id=?").get(documentId);
  if (!row || Number(row.completed) !== 1) throw new DomainError("File not found.",404);
  const chunked = Number(row.expected_bytes) > 0;
  return {
    id: String(row.id),
    name: String(row.file_name),
    mimeType: String(row.mime_type),
    length: chunked ? Number(row.received_bytes) : Buffer.from(row.content as Uint8Array).length,
    chunked,
    legacy: chunked ? null : Buffer.from(row.content as Uint8Array)
  };
}

export function readStoredFile(db: HomelyDatabase, documentId: string, maxBytes: number): Buffer {
  const meta = getStoredFile(db,documentId);
  if (meta.length > maxBytes) throw new DomainError("File exceeds this processor's limit.",413);
  if (!meta.chunked) return meta.legacy!;
  const chunks = db.prepare("SELECT content FROM file_upload_chunks WHERE upload_id=? ORDER BY chunk_index").all(meta.id);
  const buffers = chunks.map(row => Buffer.from(row.content as Uint8Array));
  const result = Buffer.concat(buffers);
  if (result.length !== meta.length) throw new DomainError("Stored file is incomplete.",500);
  return result;
}

function parseRange(raw: string | undefined, length: number) {
  if (!raw) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw);
  if (!match || (!match[1] && !match[2])) throw new DomainError("Invalid byte range.",416);
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : length - 1;
  if (!match[1]) { const suffix=Number(match[2]);start=Math.max(0,length-suffix);end=length-1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || end < start) {
    throw new DomainError("Range not satisfiable.",416);
  }
  return { start, end: Math.min(end,length-1), partial: true };
}

export async function streamStoredFile(
  db: HomelyDatabase, documentId: string, rawRange: string | undefined, res: http.ServerResponse
) {
  const meta=getStoredFile(db,documentId);
  const range=parseRange(rawRange,meta.length);
  res.setHeader("x-content-type-options","nosniff");
  res.setHeader("x-frame-options","DENY");
  res.setHeader("cache-control","private, no-store");
  res.setHeader("accept-ranges","bytes");
  res.setHeader("content-type",meta.mimeType);
  res.setHeader("content-disposition",/^(image\/|audio\/|video\/|application\/pdf$)/.test(meta.mimeType) ? "inline" : "attachment");
  res.setHeader("content-length",String(range.end-range.start+1));
  if (range.partial) res.setHeader("content-range",`bytes ${range.start}-${range.end}/${meta.length}`);
  res.writeHead(range.partial?206:200);
  if (!meta.chunked) { res.end(meta.legacy!.subarray(range.start,range.end+1));return; }
  const startChunk=Math.floor(range.start/UPLOAD_CHUNK_BYTES);
  const endChunk=Math.floor(range.end/UPLOAD_CHUNK_BYTES);
  for(let i=startChunk;i<=endChunk;i++){
    if(res.destroyed)return;
    const row=db.prepare("SELECT content FROM file_upload_chunks WHERE upload_id=? AND chunk_index=?").get(meta.id,i);
    if(!row){res.destroy();return;}
    const data=Buffer.from(row.content as Uint8Array);
    const start=i===startChunk?range.start-i*UPLOAD_CHUNK_BYTES:0;
    const end=i===endChunk?range.end-i*UPLOAD_CHUNK_BYTES+1:data.length;
    if(!res.write(data.subarray(start,end))) await once(res,"drain");
  }
  res.end();
}
