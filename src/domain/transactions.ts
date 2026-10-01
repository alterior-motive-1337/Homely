import { randomUUID } from "node:crypto";
import type { HomelyDatabase } from "../db.js";

export type ActionType = "REPORT_ISSUE" | "CREATE_MAINTENANCE_TASK";
export type TransactionStatus = "PROPOSED" | "COMMITTED" | "REVERSED" | "REJECTED";
type Snapshot = Record<string, string | null>;

export interface TransactionRecord {
  id: string;
  home_id: string;
  action_type: ActionType;
  status: TransactionStatus;
  entity_type: string;
  entity_id: string;
  reason: string;
  origin: string;
  approved_at: string | null;
  committed_at: string | null;
  reversed_at: string | null;
  created_at: string;
  updated_at: string;
  request: Record<string, unknown>;
  before: Snapshot | null;
  after: Snapshot;
}

export interface PreviewActionInput {
  type: ActionType;
  assetId: string;
  title: string;
  description?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  dueAt?: string | null;
  reason?: string;
  origin?: string;
}

function required(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function getHomeId(db: HomelyDatabase): string {
  const home = db.prepare("SELECT id FROM homes ORDER BY created_at LIMIT 1").get();
  if (!home) throw new Error("No home exists.");
  return String(home.id);
}

function getAsset(db: HomelyDatabase, assetId: string) {
  const asset = db.prepare("SELECT id, name FROM assets WHERE id = ?").get(assetId);
  if (!asset) throw new Error("Asset not found.");
  return asset;
}

function readTransaction(db: HomelyDatabase, transactionId: string): TransactionRecord | null {
  const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
  if (!row) return null;

  return {
    id: String(row.id),
    home_id: String(row.home_id),
    action_type: String(row.action_type) as ActionType,
    status: String(row.status) as TransactionStatus,
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    reason: String(row.reason),
    origin: String(row.origin),
    approved_at: row.approved_at == null ? null : String(row.approved_at),
    committed_at: row.committed_at == null ? null : String(row.committed_at),
    reversed_at: row.reversed_at == null ? null : String(row.reversed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    request: JSON.parse(String(row.request_json ?? "{}")) as Record<string, unknown>,
    before: row.before_json ? JSON.parse(String(row.before_json)) as Snapshot : null,
    after: JSON.parse(String(row.after_json)) as Snapshot
  };
}

export function previewAction(db: HomelyDatabase, input: PreviewActionInput) {
  const homeId = getHomeId(db);
  const assetId = required(input.assetId, "Asset");
  const asset = getAsset(db, assetId);
  const title = required(input.title, "Title");
  const now = new Date().toISOString();
  const transactionId = `tx-${randomUUID()}`;
  const origin = String(input.origin ?? "USER").trim() || "USER";

  let entityType: string;
  let entityId: string;
  let reason: string;
  let after: Record<string, unknown>;

  if (input.type === "REPORT_ISSUE") {
    entityType = "Issue";
    entityId = `issue-${randomUUID()}`;
    const severity = input.severity ?? "MEDIUM";
    if (!["LOW","MEDIUM","HIGH","CRITICAL"].includes(severity)) {
      throw new Error("Invalid issue severity.");
    }
    reason = String(input.reason ?? `Issue reported for ${asset.name}.`).trim();
    after = {
      id: entityId,
      asset_id: assetId,
      title,
      status: "OPEN",
      severity,
      description: String(input.description ?? "").trim() || null,
      detected_at: now.slice(0, 10),
      resolved_at: null,
      created_at: now,
      updated_at: now
    };
  } else if (input.type === "CREATE_MAINTENANCE_TASK") {
    entityType = "MaintenanceTask";
    entityId = `task-${randomUUID()}`;
    if (input.dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)) {
      throw new Error("Due date must use YYYY-MM-DD.");
    }
    reason = required(input.reason, "Reason");
    after = {
      id: entityId,
      asset_id: assetId,
      title,
      due_at: input.dueAt ?? null,
      status: "OPEN",
      reason,
      created_at: now,
      updated_at: now
    };
  } else {
    throw new Error("Unsupported action type.");
  }

  db.prepare(`
    INSERT INTO transactions(
      id,home_id,action_type,status,entity_type,entity_id,reason,origin,
      request_json,before_json,after_json,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    transactionId, homeId, input.type, "PROPOSED", entityType, entityId,
    reason, origin, JSON.stringify(input), null, JSON.stringify(after), now, now
  );

  return readTransaction(db, transactionId);
}

export function getTransaction(db: HomelyDatabase, transactionId: string) {
  return readTransaction(db, transactionId);
}

export function listTransactions(db: HomelyDatabase, limit = 50) {
  return db.prepare(`
    SELECT id, action_type, status, entity_type, entity_id, reason, origin,
      approved_at, committed_at, reversed_at, created_at, updated_at
    FROM transactions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function rejectTransaction(db: HomelyDatabase, transactionId: string) {
  const transaction = readTransaction(db, transactionId);
  if (!transaction) throw new Error("Transaction not found.");
  if (transaction.status !== "PROPOSED") throw new Error("Only proposed transactions can be rejected.");
  const now = new Date().toISOString();
  db.prepare("UPDATE transactions SET status = 'REJECTED', updated_at = ? WHERE id = ?")
    .run(now, transactionId);
  return readTransaction(db, transactionId);
}

function snapshotRequired(snapshot: Snapshot, key: string): string {
  const value = snapshot[key];
  if (value == null) throw new Error(`Transaction snapshot is missing ${key}.`);
  return value;
}

function snapshotOptional(snapshot: Snapshot, key: string): string | null {
  return snapshot[key] ?? null;
}

export function commitTransaction(db: HomelyDatabase, transactionId: string) {
  const transaction = readTransaction(db, transactionId);
  if (!transaction) throw new Error("Transaction not found.");
  if (transaction.status !== "PROPOSED") throw new Error("Only proposed transactions can be committed.");

  const now = new Date().toISOString();
  const after = transaction.after;
  db.exec("BEGIN IMMEDIATE;");
  try {
    if (transaction.action_type === "REPORT_ISSUE") {
      const id = snapshotRequired(after, "id");
      const assetId = snapshotRequired(after, "asset_id");
      const issueTitle = snapshotRequired(after, "title");
      const status = snapshotRequired(after, "status");
      const severity = snapshotRequired(after, "severity");
      const detectedAt = snapshotRequired(after, "detected_at");
      const createdAt = snapshotRequired(after, "created_at");
      const updatedAt = snapshotRequired(after, "updated_at");
      const description = snapshotOptional(after, "description");
      const resolvedAt = snapshotOptional(after, "resolved_at");

      db.prepare(`
        INSERT INTO issues(
          id,asset_id,title,status,severity,description,detected_at,resolved_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, assetId, issueTitle, status, severity,
        description, detectedAt, resolvedAt, createdAt, updatedAt
      );

      db.prepare(`
        INSERT INTO timeline_events(
          id,home_id,event_type,title,summary,occurred_at,asset_id,issue_id,
          metadata_json,transaction_id,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        `event-${randomUUID()}`, transaction.home_id, "ISSUE_REPORTED",
        `Issue reported — ${issueTitle}`, description ?? transaction.reason,
        now, assetId, id, "{}", transactionId, now
      );
    } else if (transaction.action_type === "CREATE_MAINTENANCE_TASK") {
      const id = snapshotRequired(after, "id");
      const assetId = snapshotRequired(after, "asset_id");
      const taskTitle = snapshotRequired(after, "title");
      const status = snapshotRequired(after, "status");
      const reason = snapshotRequired(after, "reason");
      const createdAt = snapshotRequired(after, "created_at");
      const updatedAt = snapshotRequired(after, "updated_at");
      const dueAt = snapshotOptional(after, "due_at");

      db.prepare(`
        INSERT INTO maintenance_tasks(
          id,asset_id,title,due_at,status,reason,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?)
      `).run(id, assetId, taskTitle, dueAt, status, reason, createdAt, updatedAt);

      db.prepare(`
        INSERT INTO timeline_events(
          id,home_id,event_type,title,summary,occurred_at,asset_id,
          maintenance_task_id,metadata_json,transaction_id,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        `event-${randomUUID()}`, transaction.home_id, "MAINTENANCE_PLANNED",
        `Maintenance planned — ${taskTitle}`, transaction.reason,
        now, assetId, id, "{}", transactionId, now
      );
    } else {
      throw new Error("Unsupported transaction action.");
    }

    db.prepare(`
      UPDATE transactions
      SET status = 'COMMITTED', approved_at = ?, committed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, now, transactionId);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return readTransaction(db, transactionId);
}

export function undoTransaction(db: HomelyDatabase, transactionId: string) {
  const transaction = readTransaction(db, transactionId);
  if (!transaction) throw new Error("Transaction not found.");
  if (transaction.status !== "COMMITTED") throw new Error("Only committed transactions can be undone.");

  const after = transaction.after;
  const assetId = snapshotRequired(after, "asset_id");
  const originalUpdatedAt = snapshotRequired(after, "updated_at");
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE;");
  try {
    if (transaction.action_type === "REPORT_ISSUE") {
      const current = db.prepare("SELECT updated_at FROM issues WHERE id = ?").get(transaction.entity_id);
      if (!current) throw new Error("The created issue no longer exists.");
      if (String(current.updated_at) !== originalUpdatedAt) {
        throw new Error("The issue changed after this transaction and cannot be safely undone.");
      }
      db.prepare("DELETE FROM issues WHERE id = ?").run(transaction.entity_id);
    } else if (transaction.action_type === "CREATE_MAINTENANCE_TASK") {
      const current = db.prepare("SELECT updated_at FROM maintenance_tasks WHERE id = ?").get(transaction.entity_id);
      if (!current) throw new Error("The created maintenance task no longer exists.");
      if (String(current.updated_at) !== originalUpdatedAt) {
        throw new Error("The maintenance task changed after this transaction and cannot be safely undone.");
      }
      db.prepare("DELETE FROM maintenance_tasks WHERE id = ?").run(transaction.entity_id);
    } else {
      throw new Error("This transaction cannot be undone.");
    }

    db.prepare(`
      INSERT INTO timeline_events(
        id,home_id,event_type,title,summary,occurred_at,asset_id,
        metadata_json,transaction_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      `event-${randomUUID()}`, transaction.home_id, "TRANSACTION_REVERSED",
      `Action undone — ${transaction.action_type.replaceAll("_", " ").toLowerCase()}`,
      transaction.reason, now, assetId, "{}", transactionId, now
    );

    db.prepare(`
      UPDATE transactions SET status = 'REVERSED', reversed_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, transactionId);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return readTransaction(db, transactionId);
}
