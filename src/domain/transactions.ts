import { randomUUID } from "node:crypto";
import type { HomelyDatabase } from "../db.js";

export type ActionType =
  | "REPORT_ISSUE"
  | "CREATE_MAINTENANCE"
  | "RESOLVE_ISSUE"
  | "COMPLETE_MAINTENANCE"
  | "ATTACH_DOCUMENT";

export class DomainError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

type JsonRecord = Record<string, unknown>;

export interface TransactionRecord extends JsonRecord {
  id: string;
  action_type: string;
  status: string;
  reason: string;
  changes: JsonRecord[];
}

interface ProposalInput {
  actionType: ActionType;
  payload: JsonRecord;
  reason: string;
  requestText?: string | null;
  origin?: string;
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function requireText(value: unknown, label: string, max = 220): string {
  const text = String(value ?? "").trim();
  if (!text) throw new DomainError(`${label} is required.`);
  if (text.length > max) throw new DomainError(`${label} is too long.`);
  return text;
}

function optionalText(value: unknown, max = 2000): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > max) throw new DomainError("Text value is too long.");
  return text;
}

function requireDate(value: unknown, label: string): string {
  const text = requireText(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text + "T00:00:00Z"))) {
    throw new DomainError(`${label} must be a valid YYYY-MM-DD date.`);
  }
  return text;
}

function getAsset(db: HomelyDatabase, assetId: string) {
  const asset = db.prepare("SELECT id, name FROM assets WHERE id = ?").get(assetId);
  if (!asset) throw new DomainError("Asset not found.", 404);
  return asset;
}

function getIssue(db: HomelyDatabase, issueId: string) {
  const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId);
  if (!issue) throw new DomainError("Issue not found.", 404);
  return issue;
}

function getMaintenance(db: HomelyDatabase, maintenanceId: string) {
  const rule = db.prepare("SELECT * FROM maintenance_rules WHERE id = ?").get(maintenanceId);
  if (!rule) throw new DomainError("Maintenance rule not found.", 404);
  return rule;
}

function validatePayload(db: HomelyDatabase, actionType: ActionType, raw: JsonRecord): JsonRecord {
  if (actionType === "REPORT_ISSUE") {
    const assetId = requireText(raw.assetId, "Asset", 120);
    getAsset(db, assetId);
    const severity = requireText(raw.severity, "Severity", 20).toUpperCase();
    if (!["LOW","MEDIUM","HIGH","CRITICAL"].includes(severity)) {
      throw new DomainError("Severity must be LOW, MEDIUM, HIGH or CRITICAL.");
    }
    return {
      assetId,
      title: requireText(raw.title, "Issue title", 160),
      severity,
      description: optionalText(raw.description),
      detectedAt: raw.detectedAt ? requireDate(raw.detectedAt, "Detected date") : todayIso()
    };
  }

  if (actionType === "CREATE_MAINTENANCE") {
    const assetId = requireText(raw.assetId, "Asset", 120);
    getAsset(db, assetId);
    let intervalDays: number | null = null;
    if (raw.intervalDays !== null && raw.intervalDays !== undefined && String(raw.intervalDays).trim() !== "") {
      intervalDays = Number(raw.intervalDays);
      if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) {
        throw new DomainError("Interval must be a whole number between 1 and 3650 days.");
      }
    }
    return {
      assetId,
      title: requireText(raw.title, "Maintenance title", 160),
      nextDueAt: requireDate(raw.nextDueAt, "Due date"),
      intervalDays
    };
  }

  if (actionType === "ATTACH_DOCUMENT") {
    const assetId = requireText(raw.assetId, "Asset", 120);
    getAsset(db, assetId);
    const documentType = requireText(raw.documentType, "Document type", 40).toUpperCase();
    if (!["WARRANTY","MANUAL","INVOICE","RECEIPT","INSPECTION","PHOTO","REPORT","OTHER"].includes(documentType)) {
      throw new DomainError("Unsupported document type.");
    }
    return {
      assetId,
      title: requireText(raw.title, "Document title", 240),
      documentType,
      providerFileId: requireText(raw.providerFileId, "Drive file ID", 300),
      mimeType: optionalText(raw.mimeType, 200),
      webViewLink: optionalText(raw.webViewLink, 1000)
    };
  }

  if (actionType === "RESOLVE_ISSUE") {
    const issueId = requireText(raw.issueId, "Issue", 120);
    const issue = getIssue(db, issueId);
    if (["RESOLVED","CLOSED"].includes(String(issue.status))) {
      throw new DomainError("Issue is already resolved.", 409);
    }
    return {
      issueId,
      resolution: optionalText(raw.resolution) ?? "Issue resolved by homeowner.",
      resolvedAt: raw.resolvedAt ? requireDate(raw.resolvedAt, "Resolved date") : todayIso()
    };
  }

  if (actionType === "COMPLETE_MAINTENANCE") {
    const maintenanceId = requireText(raw.maintenanceId, "Maintenance rule", 120);
    const rule = getMaintenance(db, maintenanceId);
    if (Number(rule.active) !== 1) throw new DomainError("Maintenance rule is inactive.", 409);
    return {
      maintenanceId,
      completedAt: raw.completedAt ? requireDate(raw.completedAt, "Completion date") : todayIso(),
      note: optionalText(raw.note)
    };
  }

  throw new DomainError("Unsupported action type.");
}

function addDays(date: string, days: number): string {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function previewFor(db: HomelyDatabase, actionType: ActionType, payload: JsonRecord) {
  if (actionType === "REPORT_ISSUE") {
    const asset = getAsset(db, String(payload.assetId));
    return {
      title: `Report issue: ${payload.title}`,
      summary: `${payload.severity} issue on ${asset.name}`,
      effects: ["Create an open issue", "Recalculate asset/system health", "Add a house timeline event"]
    };
  }

  if (actionType === "CREATE_MAINTENANCE") {
    const asset = getAsset(db, String(payload.assetId));
    return {
      title: `Plan maintenance: ${payload.title}`,
      summary: `${asset.name} · due ${payload.nextDueAt}`,
      effects: [
        "Create a maintenance obligation",
        "Recalculate health when overdue",
        "Add a house timeline event"
      ]
    };
  }

  if (actionType === "ATTACH_DOCUMENT") {
    const asset = getAsset(db, String(payload.assetId));
    return {
      title: `Attach document: ${payload.title}`,
      summary: `${payload.documentType} on ${asset.name} from Google Drive`,
      effects: ["Create a Homely document record", "Link it to the selected asset", "Add a house timeline event"]
    };
  }

  if (actionType === "RESOLVE_ISSUE") {
    const issue = getIssue(db, String(payload.issueId));
    return {
      title: `Resolve issue: ${issue.title}`,
      summary: String(payload.resolution),
      effects: ["Mark the issue resolved", "Recalculate health", "Add a house timeline event"]
    };
  }

  const rule = getMaintenance(db, String(payload.maintenanceId));
  const nextDue = rule.interval_days
    ? addDays(String(payload.completedAt), Number(rule.interval_days))
    : null;
  return {
    title: `Complete maintenance: ${rule.title}`,
    summary: nextDue
      ? `Completion will be recorded and the next due date will move to ${nextDue}.`
      : "Completion will be recorded and this one-off obligation will close.",
    effects: ["Record completion", nextDue ? "Advance the next due date" : "Close the one-off obligation", "Add a house timeline event"]
  };
}

export function proposeTransaction(db: HomelyDatabase, input: ProposalInput) {
  const reason = requireText(input.reason, "Reason", 500);
  const payload = validatePayload(db, input.actionType, input.payload ?? {});
  const id = newId("tx");
  const createdAt = nowIso();

  db.prepare(`
    INSERT INTO transactions(
      id,action_type,status,reason,origin,request_text,payload_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `).run(
    id,
    input.actionType,
    "PROPOSED",
    reason,
    input.origin ?? "WEB_UI",
    optionalText(input.requestText, 2000),
    JSON.stringify(payload),
    createdAt
  );

  return {
    transaction: getTransaction(db, id),
    preview: previewFor(db, input.actionType, payload)
  };
}

function recordChange(
  db: HomelyDatabase,
  transactionId: string,
  entityType: string,
  entityId: string,
  operation: "CREATE" | "UPDATE" | "DELETE",
  before: unknown,
  after: unknown,
  createdAt: string
): void {
  db.prepare(`
    INSERT INTO transaction_changes(
      id,transaction_id,entity_type,entity_id,operation,before_json,after_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `).run(
    newId("chg"),
    transactionId,
    entityType,
    entityId,
    operation,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
    createdAt
  );
}

function createTimelineEvent(
  db: HomelyDatabase,
  transactionId: string,
  input: {
    eventType: string;
    title: string;
    summary: string | null;
    occurredAt: string;
    assetId?: string | null;
    issueId?: string | null;
    maintenanceRuleId?: string | null;
    documentId?: string | null;
  },
  createdAt: string
): JsonRecord {
  const home = db.prepare("SELECT id FROM homes ORDER BY created_at LIMIT 1").get();
  if (!home) throw new DomainError("Home record is missing.", 500);

  const eventId = newId("event");
  db.prepare(`
    INSERT INTO timeline_events(
      id,home_id,event_type,title,summary,occurred_at,asset_id,issue_id,
      maintenance_rule_id,document_id,metadata_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    eventId,
    String(home.id),
    input.eventType,
    input.title,
    input.summary,
    input.occurredAt,
    input.assetId ?? null,
    input.issueId ?? null,
    input.maintenanceRuleId ?? null,
    input.documentId ?? null,
    JSON.stringify({ transactionId }),
    createdAt
  );
  const event = db.prepare("SELECT * FROM timeline_events WHERE id = ?").get(eventId) as JsonRecord;
  recordChange(db, transactionId, "timeline_event", eventId, "CREATE", null, event, createdAt);
  return event;
}

export function rejectTransaction(db: HomelyDatabase, transactionId: string) {
  const transaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
  if (!transaction) throw new DomainError("Transaction not found.", 404);
  if (String(transaction.status) !== "PROPOSED") {
    throw new DomainError("Only proposed transactions can be rejected.", 409);
  }
  db.prepare(
    "UPDATE transactions SET status = 'REJECTED', rejected_at = ? WHERE id = ?"
  ).run(nowIso(), transactionId);
  return getTransaction(db, transactionId);
}

export function commitTransaction(db: HomelyDatabase, transactionId: string) {
  const transaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
  if (!transaction) throw new DomainError("Transaction not found.", 404);
  if (String(transaction.status) !== "PROPOSED") {
    throw new DomainError("Only proposed transactions can be committed.", 409);
  }

  const actionType = String(transaction.action_type) as ActionType;
  const payload = JSON.parse(String(transaction.payload_json)) as JsonRecord;
  const createdAt = nowIso();

  db.exec("BEGIN IMMEDIATE;");
  try {
    if (actionType === "REPORT_ISSUE") {
      const issueId = newId("issue");
      db.prepare(`
        INSERT INTO issues(
          id,asset_id,title,status,severity,description,detected_at,resolved_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        issueId,
        String(payload.assetId),
        String(payload.title),
        "OPEN",
        String(payload.severity),
        payload.description === null || payload.description === undefined ? null : String(payload.description),
        String(payload.detectedAt),
        null,
        createdAt,
        createdAt
      );
      const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId) as JsonRecord;
      recordChange(db, transactionId, "issue", issueId, "CREATE", null, issue, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "ISSUE_REPORTED",
        title: String(payload.title),
        summary: payload.description ? String(payload.description) : `${payload.severity} issue reported.`,
        occurredAt: String(payload.detectedAt) + "T12:00:00.000Z",
        assetId: String(payload.assetId),
        issueId
      }, createdAt);
    }

    if (actionType === "CREATE_MAINTENANCE") {
      const maintenanceId = newId("maint");
      db.prepare(`
        INSERT INTO maintenance_rules(
          id,asset_id,title,interval_days,last_completed_at,next_due_at,active,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,1,?,?)
      `).run(
        maintenanceId,
        String(payload.assetId),
        String(payload.title),
        payload.intervalDays === null || payload.intervalDays === undefined ? null : Number(payload.intervalDays),
        null,
        String(payload.nextDueAt),
        createdAt,
        createdAt
      );
      const rule = db.prepare("SELECT * FROM maintenance_rules WHERE id = ?").get(maintenanceId) as JsonRecord;
      recordChange(db, transactionId, "maintenance_rule", maintenanceId, "CREATE", null, rule, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "MAINTENANCE_PLANNED",
        title: `Maintenance planned: ${payload.title}`,
        summary: `Due ${payload.nextDueAt}.`,
        occurredAt: createdAt,
        assetId: String(payload.assetId),
        maintenanceRuleId: maintenanceId
      }, createdAt);
    }

    if (actionType === "ATTACH_DOCUMENT") {
      const documentId = newId("doc");
      db.prepare(`
        INSERT INTO documents(
          id,title,type,provider,provider_file_id,local_path,mime_type,asset_id,issue_id,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        documentId,
        String(payload.title),
        String(payload.documentType),
        "GOOGLE_DRIVE",
        String(payload.providerFileId),
        null,
        payload.mimeType === null || payload.mimeType === undefined ? null : String(payload.mimeType),
        String(payload.assetId),
        null,
        createdAt,
        createdAt
      );
      const document = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as JsonRecord;
      recordChange(db, transactionId, "document", documentId, "CREATE", null, document, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "DOCUMENT_ATTACHED",
        title: `Document attached: ${payload.title}`,
        summary: `${payload.documentType} linked from Google Drive.`,
        occurredAt: createdAt,
        assetId: String(payload.assetId),
        documentId
      }, createdAt);
    }

    if (actionType === "RESOLVE_ISSUE") {
      const before = getIssue(db, String(payload.issueId)) as JsonRecord;
      if (["RESOLVED","CLOSED"].includes(String(before.status))) {
        throw new DomainError("Issue is already resolved.", 409);
      }
      db.prepare(
        "UPDATE issues SET status = 'RESOLVED', resolved_at = ?, updated_at = ? WHERE id = ?"
      ).run(String(payload.resolvedAt), createdAt, String(payload.issueId));
      const after = getIssue(db, String(payload.issueId)) as JsonRecord;
      recordChange(db, transactionId, "issue", String(payload.issueId), "UPDATE", before, after, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "ISSUE_RESOLVED",
        title: `Resolved: ${before.title}`,
        summary: String(payload.resolution),
        occurredAt: String(payload.resolvedAt) + "T12:00:00.000Z",
        assetId: String(before.asset_id),
        issueId: String(payload.issueId)
      }, createdAt);
    }

    if (actionType === "COMPLETE_MAINTENANCE") {
      const before = getMaintenance(db, String(payload.maintenanceId)) as JsonRecord;
      if (Number(before.active) !== 1) throw new DomainError("Maintenance rule is inactive.", 409);
      const interval = before.interval_days === null ? null : Number(before.interval_days);
      const nextDue = interval ? addDays(String(payload.completedAt), interval) : String(before.next_due_at);
      const active = interval ? 1 : 0;
      db.prepare(
        "UPDATE maintenance_rules SET last_completed_at = ?, next_due_at = ?, active = ?, updated_at = ? WHERE id = ?"
      ).run(String(payload.completedAt), nextDue, active, createdAt, String(payload.maintenanceId));
      const after = getMaintenance(db, String(payload.maintenanceId)) as JsonRecord;
      recordChange(db, transactionId, "maintenance_rule", String(payload.maintenanceId), "UPDATE", before, after, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "MAINTENANCE_COMPLETED",
        title: `Completed: ${before.title}`,
        summary: payload.note ? String(payload.note) : interval ? `Next due ${nextDue}.` : "One-off maintenance completed.",
        occurredAt: String(payload.completedAt) + "T12:00:00.000Z",
        assetId: String(before.asset_id),
        maintenanceRuleId: String(payload.maintenanceId)
      }, createdAt);
    }

    db.prepare(`
      UPDATE transactions
      SET status = 'COMMITTED', approved_at = ?, committed_at = ?
      WHERE id = ?
    `).run(createdAt, createdAt, transactionId);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return getTransaction(db, transactionId);
}

function parseJson(value: unknown): JsonRecord | null {
  return value === null || value === undefined ? null : JSON.parse(String(value)) as JsonRecord;
}

function sameRow(current: unknown, expected: JsonRecord | null): boolean {
  if (!current || !expected) return false;
  return JSON.stringify(current) === JSON.stringify(expected);
}

function reverseChange(db: HomelyDatabase, change: JsonRecord, undoId: string, changedAt: string): void {
  const entityType = String(change.entity_type);
  const entityId = String(change.entity_id);
  const operation = String(change.operation);
  const before = parseJson(change.before_json);
  const after = parseJson(change.after_json);

  if (operation === "CREATE") {
    if (entityType === "timeline_event") {
      const current = db.prepare("SELECT * FROM timeline_events WHERE id = ?").get(entityId);
      if (current && !sameRow(current, after)) throw new DomainError("Timeline state changed after this transaction.", 409);
      db.prepare("DELETE FROM timeline_events WHERE id = ?").run(entityId);
    } else if (entityType === "issue") {
      const current = db.prepare("SELECT * FROM issues WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Issue changed after this transaction and cannot be safely undone.", 409);
      db.prepare("DELETE FROM issues WHERE id = ?").run(entityId);
    } else if (entityType === "maintenance_rule") {
      const current = db.prepare("SELECT * FROM maintenance_rules WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Maintenance changed after this transaction and cannot be safely undone.", 409);
      db.prepare("DELETE FROM maintenance_rules WHERE id = ?").run(entityId);
    } else if (entityType === "document") {
      const current = db.prepare("SELECT * FROM documents WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Document association changed after this transaction and cannot be safely undone.", 409);
      db.prepare("DELETE FROM documents WHERE id = ?").run(entityId);
    } else {
      throw new DomainError("This transaction contains an unsupported undo operation.", 409);
    }
    recordChange(db, undoId, entityType, entityId, "DELETE", after, null, changedAt);
    return;
  }

  if (operation === "UPDATE") {
    if (!before || !after) throw new DomainError("Transaction history is incomplete.", 409);

    if (entityType === "issue") {
      const current = db.prepare("SELECT * FROM issues WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Issue changed after this transaction and cannot be safely undone.", 409);
      db.prepare(
        "UPDATE issues SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?"
      ).run(
        String(before.status),
        before.resolved_at === null || before.resolved_at === undefined ? null : String(before.resolved_at),
        String(before.updated_at),
        entityId
      );
      const restored = db.prepare("SELECT * FROM issues WHERE id = ?").get(entityId);
      recordChange(db, undoId, entityType, entityId, "UPDATE", after, restored, changedAt);
      return;
    }

    if (entityType === "maintenance_rule") {
      const current = db.prepare("SELECT * FROM maintenance_rules WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Maintenance changed after this transaction and cannot be safely undone.", 409);
      db.prepare(
        "UPDATE maintenance_rules SET last_completed_at = ?, next_due_at = ?, active = ?, updated_at = ? WHERE id = ?"
      ).run(
        before.last_completed_at === null || before.last_completed_at === undefined ? null : String(before.last_completed_at),
        String(before.next_due_at),
        Number(before.active),
        String(before.updated_at),
        entityId
      );
      const restored = db.prepare("SELECT * FROM maintenance_rules WHERE id = ?").get(entityId);
      recordChange(db, undoId, entityType, entityId, "UPDATE", after, restored, changedAt);
      return;
    }
  }

  throw new DomainError("This transaction contains an unsupported undo operation.", 409);
}

export function undoTransaction(db: HomelyDatabase, transactionId: string) {
  const original = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
  if (!original) throw new DomainError("Transaction not found.", 404);
  if (String(original.status) !== "COMMITTED") throw new DomainError("Only committed transactions can be undone.", 409);
  if (String(original.action_type) === "UNDO") throw new DomainError("Undo transactions cannot be undone.", 409);

  const changes = db.prepare(
    "SELECT * FROM transaction_changes WHERE transaction_id = ? ORDER BY rowid DESC"
  ).all(transactionId) as JsonRecord[];

  const undoId = newId("tx");
  const changedAt = nowIso();

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      INSERT INTO transactions(
        id,action_type,status,reason,origin,request_text,payload_json,
        created_at,approved_at,committed_at,reversal_of
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      undoId,
      "UNDO",
      "COMMITTED",
      `Undo transaction ${transactionId}`,
      "WEB_UI",
      null,
      JSON.stringify({ targetTransactionId: transactionId }),
      changedAt,
      changedAt,
      changedAt,
      transactionId
    );

    for (const change of changes) reverseChange(db, change, undoId, changedAt);

    db.prepare(
      "UPDATE transactions SET status = 'REVERSED', reversed_at = ? WHERE id = ?"
    ).run(changedAt, transactionId);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    original: getTransaction(db, transactionId),
    reversal: getTransaction(db, undoId)
  };
}

export function getTransaction(db: HomelyDatabase, transactionId: string): TransactionRecord | null {
  const transaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId) as JsonRecord | undefined;
  if (!transaction) return null;
  const changes = db.prepare(
    "SELECT * FROM transaction_changes WHERE transaction_id = ? ORDER BY rowid"
  ).all(transactionId) as JsonRecord[];
  return {
    ...transaction,
    id: String(transaction.id),
    action_type: String(transaction.action_type),
    status: String(transaction.status),
    reason: String(transaction.reason),
    changes
  };
}

export function listTransactions(db: HomelyDatabase, limit = 50) {
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM transaction_changes c WHERE c.transaction_id = t.id) AS change_count
    FROM transactions t
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(limit);
}
