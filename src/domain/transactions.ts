import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { HomelyDatabase } from "../db.js";
import { activeHomeId } from "../security/homeScope.js";

export type ActionType =
  | "CREATE_ASSET"
  | "UPDATE_ASSET"
  | "REPORT_ISSUE"
  | "CREATE_MAINTENANCE"
  | "RESOLVE_ISSUE"
  | "COMPLETE_MAINTENANCE"
  | "ATTACH_DOCUMENT"
  | "RECORD_REPAIR"
  | "CREATE_CHARGE"
  | "SAVE_PURCHASE"
  | "CREATE_PROJECT"
  | "UPDATE_PROJECT_STATUS";

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
  const asset = db.prepare("SELECT a.id,a.name FROM assets a JOIN systems s ON s.id=a.system_id WHERE a.id=? AND s.home_id=COALESCE(NULLIF(?,''),s.home_id)").get(assetId,activeHomeId() ?? "");
  if (!asset) throw new DomainError("Asset not found.", 404);
  return asset;
}

function getIssue(db: HomelyDatabase, issueId: string) {
  const issue = db.prepare("SELECT i.* FROM issues i JOIN assets a ON a.id=i.asset_id JOIN systems s ON s.id=a.system_id WHERE i.id=? AND s.home_id=COALESCE(NULLIF(?,''),s.home_id)").get(issueId,activeHomeId() ?? "");
  if (!issue) throw new DomainError("Issue not found.", 404);
  return issue;
}

function getRepair(db: HomelyDatabase, repairId: string) {
  const repair = db.prepare("SELECT * FROM repairs WHERE id=? AND home_id=COALESCE(NULLIF(?,''),home_id)").get(repairId,activeHomeId() ?? "");
  if (!repair) throw new DomainError("Repair not found.", 404);
  return repair;
}

function getCharge(db: HomelyDatabase, chargeId: string) {
  const charge = db.prepare("SELECT * FROM charges WHERE id=? AND home_id=COALESCE(NULLIF(?,''),home_id)").get(chargeId,activeHomeId() ?? "");
  if (!charge) throw new DomainError("Charge not found.", 404);
  return charge;
}

function getPurchaseCandidate(db: HomelyDatabase, purchaseCandidateId: string) {
  const purchase = db.prepare("SELECT * FROM purchase_candidates WHERE id=? AND home_id=COALESCE(NULLIF(?,''),home_id)").get(purchaseCandidateId,activeHomeId() ?? "");
  if (!purchase) throw new DomainError("Purchase candidate not found.", 404);
  return purchase;
}

function getMaintenance(db: HomelyDatabase, maintenanceId: string) {
  const rule = db.prepare("SELECT m.* FROM maintenance_rules m JOIN assets a ON a.id=m.asset_id JOIN systems s ON s.id=a.system_id WHERE m.id=? AND s.home_id=COALESCE(NULLIF(?,''),s.home_id)").get(maintenanceId,activeHomeId() ?? "");
  if (!rule) throw new DomainError("Maintenance rule not found.", 404);
  return rule;
}

function getProject(db: HomelyDatabase, projectId: string) {
  const project = db.prepare("SELECT * FROM projects WHERE id=? AND home_id=COALESCE(NULLIF(?,''),home_id)").get(projectId,activeHomeId() ?? "");
  if (!project) throw new DomainError("Project not found.", 404);
  return project;
}

function validatePayload(db: HomelyDatabase, actionType: ActionType, raw: JsonRecord): JsonRecord {
  if (actionType === "CREATE_ASSET" || actionType === "UPDATE_ASSET") {
    const assetId = actionType === "UPDATE_ASSET" ? requireText(raw.assetId, "Asset", 120) : null;
    if (assetId) getAsset(db, assetId);
    const systemId = requireText(raw.systemId, "System", 120);
    if (!db.prepare("SELECT id FROM systems WHERE id=? AND home_id=COALESCE(NULLIF(?,''),home_id)").get(systemId,activeHomeId() ?? "")) throw new DomainError("System not found.", 404);
    const condition = raw.condition ? requireText(raw.condition, "Condition", 20).toUpperCase() : "UNKNOWN";
    if (!["UNKNOWN","NEW","GOOD","FAIR","POOR","FAILED"].includes(condition)) throw new DomainError("Invalid asset condition.");
    let purchaseCostCents: number | null = null;
    if (raw.purchaseCostCents !== null && raw.purchaseCostCents !== undefined && String(raw.purchaseCostCents).trim() !== "") {
      purchaseCostCents = Number(raw.purchaseCostCents);
      if (!Number.isSafeInteger(purchaseCostCents) || purchaseCostCents < 0 || purchaseCostCents > 100_000_000_000) throw new DomainError("Invalid purchase cost.");
    }
    return {
      ...(assetId ? { assetId } : {}),
      systemId,
      name: requireText(raw.name, "Asset name", 180),
      category: requireText(raw.category, "Category", 80),
      condition,
      location: optionalText(raw.location, 200),
      manufacturer: optionalText(raw.manufacturer, 160),
      model: optionalText(raw.model, 160),
      serialNumber: optionalText(raw.serialNumber, 160),
      purchaseDate: raw.purchaseDate ? requireDate(raw.purchaseDate, "Purchase date") : null,
      purchaseCostCents,
      warrantyEnd: raw.warrantyEnd ? requireDate(raw.warrantyEnd, "Warranty end") : null,
      notes: optionalText(raw.notes, 3000)
    };
  }
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
    let assetId = raw.assetId ? requireText(raw.assetId, "Asset", 120) : null;
    if (assetId) getAsset(db, assetId);

    const issueId = raw.issueId ? requireText(raw.issueId, "Issue", 120) : null;
    if (issueId) {
      const issue = getIssue(db, issueId);
      const issueAssetId = String(issue.asset_id);
      if (assetId && issueAssetId !== assetId) throw new DomainError("Selected issue does not belong to the selected asset.");
      assetId = assetId ?? issueAssetId;
    }

    const repairId = raw.repairId ? requireText(raw.repairId, "Repair", 120) : null;
    if (repairId) {
      const repair = getRepair(db, repairId);
      const repairAssetId = String(repair.asset_id);
      if (assetId && repairAssetId !== assetId) throw new DomainError("Selected repair does not belong to the selected asset.");
      assetId = assetId ?? repairAssetId;
    }

    const chargeId = raw.chargeId ? requireText(raw.chargeId, "Charge", 120) : null;
    if (chargeId) getCharge(db, chargeId);

    const purchaseCandidateId = raw.purchaseCandidateId
      ? requireText(raw.purchaseCandidateId, "Purchase candidate", 120)
      : null;
    if (purchaseCandidateId) {
      const purchase = getPurchaseCandidate(db, purchaseCandidateId);
      const purchaseAssetId = purchase.asset_id ? String(purchase.asset_id) : null;
      if (purchaseAssetId && assetId && purchaseAssetId !== assetId) {
        throw new DomainError("Selected purchase does not belong to the selected asset.");
      }
      assetId = assetId ?? purchaseAssetId;
    }

    const documentType = requireText(raw.documentType, "Document type", 40).toUpperCase();
    if (!["WARRANTY","MANUAL","INVOICE","RECEIPT","INSPECTION","PHOTO","VIDEO","REPORT","OTHER"].includes(documentType)) {
      throw new DomainError("Unsupported document type.");
    }

    const evidenceStatus = raw.evidenceStatus
      ? requireText(raw.evidenceStatus, "Evidence status", 20).toUpperCase()
      : "ACTIVE";
    if (!["ACTIVE","REFERENCE","ARCHIVED"].includes(evidenceStatus)) {
      throw new DomainError("Evidence status must be ACTIVE, REFERENCE or ARCHIVED.");
    }

    const provider = raw.provider ? requireText(raw.provider, "Evidence provider", 30).toUpperCase() : "GOOGLE_DRIVE";
    if (!["LOCAL","GOOGLE_DRIVE"].includes(provider)) {
      throw new DomainError("Evidence provider must be LOCAL or GOOGLE_DRIVE.");
    }
    const sourceUrl = optionalText(raw.sourceUrl, 2000);
    const webViewLink = optionalText(raw.webViewLink, 1000);
    const providerFileId = provider === "GOOGLE_DRIVE"
      ? requireText(raw.providerFileId, "Drive file ID", 300)
      : null;
    const uploadId = raw.uploadId ? requireText(raw.uploadId, "Upload", 120) : null;
    const upload = uploadId
      ? db.prepare("SELECT document_id,mime_type,completed FROM file_uploads WHERE id=? AND home_id=COALESCE(NULLIF(?,''),home_id)").get(uploadId,activeHomeId() ?? "")
      : null;
    if (uploadId && (!upload || upload.document_id || Number(upload.completed) !== 1 || provider !== "LOCAL")) {
      throw new DomainError("Staged upload is missing, already linked or incompatible.", 409);
    }
    if (provider === "LOCAL" && !sourceUrl && !webViewLink && !uploadId) {
      throw new DomainError("Evidence requires a source link or staged upload.");
    }

    return {
      assetId,
      issueId,
      repairId,
      chargeId,
      purchaseCandidateId,
      title: requireText(raw.title, "Document title", 240),
      documentType,
      provider,
      providerFileId,
      uploadId,
      mimeType: upload ? String(upload.mime_type) : optionalText(raw.mimeType, 200),
      webViewLink,
      sourceUrl,
      provenance: optionalText(raw.provenance, 1000) ?? (provider === "GOOGLE_DRIVE"
        ? "Selected by homeowner from Google Drive."
        : "Saved directly by homeowner in Homely."),
      occurredAt: raw.occurredAt ? requireDate(raw.occurredAt, "Evidence date") : todayIso(),
      evidenceReason: optionalText(raw.evidenceReason, 2000),
      evidenceStatus
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

  if (actionType === "RECORD_REPAIR") {
    const assetId = requireText(raw.assetId, "Asset", 120);
    getAsset(db, assetId);
    const issueId = raw.issueId ? requireText(raw.issueId, "Issue", 120) : null;
    if (issueId) {
      const issue = getIssue(db, issueId);
      if (String(issue.asset_id) !== assetId) {
        throw new DomainError("Repair issue must belong to the selected asset.");
      }
    }

    let costCents: number | null = null;
    if (raw.costCents !== null && raw.costCents !== undefined && String(raw.costCents).trim() !== "") {
      costCents = Number(raw.costCents);
      if (!Number.isInteger(costCents) || costCents < 0 || costCents > 100_000_000_000) {
        throw new DomainError("Repair cost must be a non-negative whole number of cents.");
      }
    }

    return {
      assetId,
      issueId,
      title: requireText(raw.title, "Repair title", 180),
      description: optionalText(raw.description, 4000),
      repairDate: raw.repairDate ? requireDate(raw.repairDate, "Repair date") : todayIso(),
      costCents,
      contractor: optionalText(raw.contractor, 240),
      outcome: optionalText(raw.outcome, 2000)
    };
  }

  if (actionType === "CREATE_CHARGE") {
    const amountCents = Number(raw.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > 100_000_000_000) {
      throw new DomainError("Charge amount must be a non-negative whole number of cents.");
    }
    const billingCycle = requireText(raw.billingCycle, "Billing cycle", 20).toUpperCase();
    if (!["MONTHLY","QUARTERLY","ANNUAL","OTHER"].includes(billingCycle)) {
      throw new DomainError("Unsupported billing cycle.");
    }
    let dueDay: number | null = null;
    if (raw.dueDay !== null && raw.dueDay !== undefined && String(raw.dueDay).trim() !== "") {
      dueDay = Number(raw.dueDay);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
        throw new DomainError("Due day must be between 1 and 31.");
      }
    }
    return {
      name: requireText(raw.name, "Charge name", 180),
      category: requireText(raw.category, "Charge category", 80).toUpperCase(),
      amountCents,
      billingCycle,
      dueDay,
      provider: optionalText(raw.provider, 240),
      notes: optionalText(raw.notes, 2000)
    };
  }

  if (actionType === "SAVE_PURCHASE") {
    const assetId = raw.assetId ? requireText(raw.assetId, "Asset", 120) : null;
    if (assetId) getAsset(db, assetId);

    const money = (value: unknown, label: string): number | null => {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000_000_000) {
        throw new DomainError(`${label} must be a non-negative whole number of cents.`);
      }
      return parsed;
    };

    const status = raw.status ? requireText(raw.status, "Purchase status", 20).toUpperCase() : "SAVED";
    if (!["SAVED","SHORTLISTED"].includes(status)) {
      throw new DomainError("New purchase candidates must be SAVED or SHORTLISTED.");
    }

    return {
      assetId,
      title: requireText(raw.title, "Purchase title", 220),
      category: requireText(raw.category, "Purchase category", 80).toUpperCase(),
      status,
      budgetCents: money(raw.budgetCents, "Budget"),
      expectedCostCents: money(raw.expectedCostCents, "Expected cost"),
      sourceUrl: optionalText(raw.sourceUrl, 2000),
      sourceName: optionalText(raw.sourceName, 240),
      rationale: optionalText(raw.rationale, 3000)
    };
  }

  if (actionType === "CREATE_PROJECT") {
    const startDate = raw.startDate ? requireDate(raw.startDate, "Start date") : null;
    const targetDate = raw.targetDate ? requireDate(raw.targetDate, "Target date") : null;
    if (startDate && targetDate && targetDate < startDate) {
      throw new DomainError("Target date cannot be before the start date.");
    }

    let budgetCents: number | null = null;
    if (raw.budgetCents !== null && raw.budgetCents !== undefined && String(raw.budgetCents).trim() !== "") {
      budgetCents = Number(raw.budgetCents);
      if (!Number.isInteger(budgetCents) || budgetCents < 0 || budgetCents > 100_000_000_000) {
        throw new DomainError("Project budget must be a non-negative whole number of cents.");
      }
    }

    const status = raw.status ? requireText(raw.status, "Project status", 20).toUpperCase() : "PLANNED";
    if (!["PLANNED","ACTIVE"].includes(status)) {
      throw new DomainError("New projects must start as PLANNED or ACTIVE.");
    }

    return {
      title: requireText(raw.title, "Project title", 180),
      description: optionalText(raw.description, 4000),
      status,
      startDate,
      targetDate,
      budgetCents
    };
  }

  if (actionType === "UPDATE_PROJECT_STATUS") {
    const projectId = requireText(raw.projectId, "Project", 120);
    const project = getProject(db, projectId);
    const status = requireText(raw.status, "Project status", 20).toUpperCase();
    if (!["PLANNED","ACTIVE","PAUSED","COMPLETE","CANCELLED"].includes(status)) {
      throw new DomainError("Unsupported project status.");
    }
    if (String(project.status) === status) {
      throw new DomainError("Project is already in that status.", 409);
    }
    return {
      projectId,
      status,
      note: optionalText(raw.note, 2000),
      completedAt: status === "COMPLETE"
        ? (raw.completedAt ? requireDate(raw.completedAt, "Completion date") : todayIso())
        : null
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
  if (actionType === "UPDATE_ASSET") {
    return {
      title: `Update asset: ${payload.name}`,
      summary: "Revise recorded condition, purchase and warranty information",
      effects: ["Update an existing asset", "Preserve the original values in the transaction audit", "Add an asset timeline event"]
    };
  }
  if (actionType === "CREATE_ASSET") {
    const system = db.prepare("SELECT name FROM systems WHERE id = ?").get(String(payload.systemId));
    return {
      title: `Register asset: ${payload.name}`,
      summary: `${payload.category} · ${system?.name ?? "Home"}`,
      effects: ["Create a new appliance/furniture record", "Preserve acquisition and condition details", "Add a home timeline event"]
    };
  }
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
    const links: string[] = [];
    if (payload.assetId) links.push(String(getAsset(db, String(payload.assetId)).name));
    if (payload.issueId) links.push(`issue: ${getIssue(db, String(payload.issueId)).title}`);
    if (payload.repairId) links.push(`repair: ${getRepair(db, String(payload.repairId)).title}`);
    if (payload.chargeId) links.push(`charge: ${getCharge(db, String(payload.chargeId)).name}`);
    if (payload.purchaseCandidateId) links.push(`purchase: ${getPurchaseCandidate(db, String(payload.purchaseCandidateId)).title}`);
    return {
      title: `Attach evidence: ${payload.title}`,
      summary: `${payload.documentType} · ${links.length ? links.join(" · ") : "general home evidence"}`,
      effects: [
        "Create a Homely evidence record",
        "Preserve provenance, date, status and selected associations",
        "Add a house timeline event"
      ]
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

  if (actionType === "RECORD_REPAIR") {
    const asset = getAsset(db, String(payload.assetId));
    return {
      title: `Record repair: ${payload.title}`,
      summary: `${asset.name} · ${payload.repairDate}`,
      effects: [
        "Create a permanent repair record",
        "Link the repair to the asset and issue when supplied",
        "Add a house timeline event"
      ]
    };
  }

  if (actionType === "CREATE_CHARGE") {
    return {
      title: `Add recurring charge: ${payload.name}`,
      summary: `${payload.billingCycle} household charge`,
      effects: ["Create a household charge record", "Expose it to Homely memory", "Add a house timeline event"]
    };
  }

  if (actionType === "SAVE_PURCHASE") {
    return {
      title: `Save purchase candidate: ${payload.title}`,
      summary: String(payload.category),
      effects: ["Save the researched purchase", "Preserve source and budget context", "Add a house timeline event"]
    };
  }

  if (actionType === "CREATE_PROJECT") {
    return {
      title: `Create project: ${payload.title}`,
      summary: payload.targetDate ? `${payload.status} · target ${payload.targetDate}` : String(payload.status),
      effects: ["Create a property project", "Add a house timeline event", "Expose the project to Homely tools"]
    };
  }

  if (actionType === "UPDATE_PROJECT_STATUS") {
    const project = getProject(db, String(payload.projectId));
    return {
      title: `Update project: ${project.title}`,
      summary: `${project.status} → ${payload.status}`,
      effects: ["Update project status", "Preserve the previous state for undo", "Add a house timeline event"]
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
  const homeId=activeHomeId();
  const id = newId("tx");
  const createdAt = nowIso();

  db.prepare(`
    INSERT INTO transactions(
      id,action_type,status,reason,origin,request_text,payload_json,created_at,home_id
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    input.actionType,
    "PROPOSED",
    reason,
    input.origin ?? "WEB_UI",
    optionalText(input.requestText, 2000),
    JSON.stringify(payload),
    createdAt,
    homeId
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
    projectId?: string | null;
    repairId?: string | null;
    chargeId?: string | null;
    purchaseCandidateId?: string | null;
  },
  createdAt: string
): JsonRecord {
  const home = db.prepare("SELECT id FROM homes WHERE id=COALESCE(NULLIF(?,''),id) ORDER BY created_at LIMIT 1").get(activeHomeId() ?? "");
  if (!home) throw new DomainError("Home record is missing.", 500);

  const eventId = newId("event");
  db.prepare(`
    INSERT INTO timeline_events(
      id,home_id,event_type,title,summary,occurred_at,asset_id,issue_id,
      maintenance_rule_id,document_id,project_id,repair_id,charge_id,purchase_candidate_id,metadata_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
    input.projectId ?? null,
    input.repairId ?? null,
    input.chargeId ?? null,
    input.purchaseCandidateId ?? null,
    JSON.stringify({ transactionId }),
    createdAt
  );
  const event = db.prepare("SELECT * FROM timeline_events WHERE id = ?").get(eventId) as JsonRecord;
  recordChange(db, transactionId, "timeline_event", eventId, "CREATE", null, event, createdAt);
  return event;
}

export function rejectTransaction(db: HomelyDatabase, transactionId: string) {
  const transaction = db.prepare("SELECT * FROM transactions WHERE id=? AND home_id IS COALESCE(NULLIF(?,''),home_id)").get(transactionId,activeHomeId() ?? "");
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
  const transaction = db.prepare("SELECT * FROM transactions WHERE id=? AND home_id IS COALESCE(NULLIF(?,''),home_id)").get(transactionId,activeHomeId() ?? "");
  if (!transaction) throw new DomainError("Transaction not found.", 404);
  if (String(transaction.status) !== "PROPOSED") {
    throw new DomainError("Only proposed transactions can be committed.", 409);
  }

  const actionType = String(transaction.action_type) as ActionType;
  const payload = JSON.parse(String(transaction.payload_json)) as JsonRecord;
  const createdAt = nowIso();

  db.exec("BEGIN IMMEDIATE;");
  try {
    if (actionType === "UPDATE_ASSET") {
      const assetId = String(payload.assetId);
      const before = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as JsonRecord | undefined;
      if (!before) throw new DomainError("Asset not found.", 404);
      db.prepare(`
        UPDATE assets SET system_id=?,name=?,category=?,location=?,manufacturer=?,model=?,
          serial_number=?,purchase_date=?,purchase_cost_cents=?,warranty_end=?,notes=?,condition=?,updated_at=?
        WHERE id=?
      `).run(
        String(payload.systemId),String(payload.name),String(payload.category),
        payload.location ? String(payload.location) : null,
        payload.manufacturer ? String(payload.manufacturer) : null,
        payload.model ? String(payload.model) : null,
        payload.serialNumber ? String(payload.serialNumber) : null,
        payload.purchaseDate ? String(payload.purchaseDate) : null,
        payload.purchaseCostCents === null ? null : Number(payload.purchaseCostCents),
        payload.warrantyEnd ? String(payload.warrantyEnd) : null,
        payload.notes ? String(payload.notes) : null,
        String(payload.condition),createdAt,assetId
      );
      const after = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId);
      recordChange(db, transactionId, "asset", assetId, "UPDATE", before, after, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "ASSET_UPDATED", title: `Updated: ${payload.name}`,
        summary: "Asset condition and details updated.", occurredAt: createdAt, assetId
      }, createdAt);
    }

    if (actionType === "CREATE_ASSET") {
      const assetId = newId("asset");
      db.prepare(`
        INSERT INTO assets(
          id,system_id,name,category,location,manufacturer,model,serial_number,
          purchase_date,purchase_cost_cents,warranty_end,notes,condition,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        assetId, String(payload.systemId), String(payload.name), String(payload.category),
        payload.location ? String(payload.location) : null,
        payload.manufacturer ? String(payload.manufacturer) : null,
        payload.model ? String(payload.model) : null,
        payload.serialNumber ? String(payload.serialNumber) : null,
        payload.purchaseDate ? String(payload.purchaseDate) : null,
        payload.purchaseCostCents === null ? null : Number(payload.purchaseCostCents),
        payload.warrantyEnd ? String(payload.warrantyEnd) : null,
        payload.notes ? String(payload.notes) : null,
        String(payload.condition), createdAt, createdAt
      );
      const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as JsonRecord;
      recordChange(db, transactionId, "asset", assetId, "CREATE", null, asset, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "ASSET_REGISTERED", title: `Registered: ${payload.name}`,
        summary: `${payload.category} added to the home register.`,
        occurredAt: createdAt, assetId
      }, createdAt);
    }

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

    if (actionType === "RECORD_REPAIR") {
      const home = db.prepare("SELECT id FROM homes WHERE id=COALESCE(NULLIF(?,''),id) ORDER BY created_at LIMIT 1").get(activeHomeId() ?? "");
      if (!home) throw new DomainError("Home record is missing.", 500);
      const repairId = newId("repair");
      db.prepare(`
        INSERT INTO repairs(
          id,home_id,asset_id,issue_id,title,description,repair_date,cost_cents,contractor,outcome,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        repairId,
        String(home.id),
        String(payload.assetId),
        payload.issueId ? String(payload.issueId) : null,
        String(payload.title),
        payload.description === null || payload.description === undefined ? null : String(payload.description),
        String(payload.repairDate),
        payload.costCents === null || payload.costCents === undefined ? null : Number(payload.costCents),
        payload.contractor === null || payload.contractor === undefined ? null : String(payload.contractor),
        payload.outcome === null || payload.outcome === undefined ? null : String(payload.outcome),
        createdAt
      );
      const repair = db.prepare("SELECT * FROM repairs WHERE id = ?").get(repairId) as JsonRecord;
      recordChange(db, transactionId, "repair", repairId, "CREATE", null, repair, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "REPAIR_RECORDED",
        title: `Repair recorded: ${payload.title}`,
        summary: payload.outcome ? String(payload.outcome) : (payload.description ? String(payload.description) : null),
        occurredAt: String(payload.repairDate) + "T12:00:00.000Z",
        assetId: String(payload.assetId),
        issueId: payload.issueId ? String(payload.issueId) : null,
        repairId
      }, createdAt);
    }

    if (actionType === "CREATE_CHARGE") {
      const home = db.prepare("SELECT id FROM homes WHERE id=COALESCE(NULLIF(?,''),id) ORDER BY created_at LIMIT 1").get(activeHomeId() ?? "");
      if (!home) throw new DomainError("Home record is missing.", 500);
      const chargeId = newId("charge");
      db.prepare(`
        INSERT INTO charges(
          id,home_id,name,category,amount_cents,billing_cycle,due_day,provider,notes,active,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)
      `).run(
        chargeId,
        String(home.id),
        String(payload.name),
        String(payload.category),
        Number(payload.amountCents),
        String(payload.billingCycle),
        payload.dueDay === null || payload.dueDay === undefined ? null : Number(payload.dueDay),
        payload.provider === null || payload.provider === undefined ? null : String(payload.provider),
        payload.notes === null || payload.notes === undefined ? null : String(payload.notes),
        createdAt,
        createdAt
      );
      const charge = db.prepare("SELECT * FROM charges WHERE id = ?").get(chargeId) as JsonRecord;
      recordChange(db, transactionId, "charge", chargeId, "CREATE", null, charge, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "CHARGE_CREATED",
        title: `Household charge added: ${payload.name}`,
        summary: `${payload.billingCycle} · ${payload.category}`,
        occurredAt: createdAt,
        chargeId
      }, createdAt);
    }

    if (actionType === "SAVE_PURCHASE") {
      const home = db.prepare("SELECT id FROM homes WHERE id=COALESCE(NULLIF(?,''),id) ORDER BY created_at LIMIT 1").get(activeHomeId() ?? "");
      if (!home) throw new DomainError("Home record is missing.", 500);
      const purchaseId = newId("purchase");
      db.prepare(`
        INSERT INTO purchase_candidates(
          id,home_id,asset_id,title,category,status,budget_cents,expected_cost_cents,
          source_url,source_name,rationale,metadata_json,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        purchaseId,
        String(home.id),
        payload.assetId ? String(payload.assetId) : null,
        String(payload.title),
        String(payload.category),
        String(payload.status),
        payload.budgetCents === null || payload.budgetCents === undefined ? null : Number(payload.budgetCents),
        payload.expectedCostCents === null || payload.expectedCostCents === undefined ? null : Number(payload.expectedCostCents),
        payload.sourceUrl === null || payload.sourceUrl === undefined ? null : String(payload.sourceUrl),
        payload.sourceName === null || payload.sourceName === undefined ? null : String(payload.sourceName),
        payload.rationale === null || payload.rationale === undefined ? null : String(payload.rationale),
        JSON.stringify({ savedFrom: String(transaction.origin ?? "UNKNOWN") }),
        createdAt,
        createdAt
      );
      const purchase = db.prepare("SELECT * FROM purchase_candidates WHERE id = ?").get(purchaseId) as JsonRecord;
      recordChange(db, transactionId, "purchase_candidate", purchaseId, "CREATE", null, purchase, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "PURCHASE_SAVED",
        title: `Purchase candidate saved: ${payload.title}`,
        summary: payload.rationale ? String(payload.rationale) : String(payload.category),
        occurredAt: createdAt,
        assetId: payload.assetId ? String(payload.assetId) : null,
        purchaseCandidateId: purchaseId
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
          id,title,type,provider,provider_file_id,local_path,mime_type,web_view_link,
          asset_id,issue_id,repair_id,charge_id,purchase_candidate_id,source_url,provenance,
          occurred_at,evidence_reason,evidence_status,created_at,updated_at,home_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        documentId,
        String(payload.title),
        String(payload.documentType),
        String(payload.provider),
        payload.providerFileId ? String(payload.providerFileId) : null,
        payload.uploadId ? "/api/files/" + documentId : null,
        payload.mimeType === null || payload.mimeType === undefined ? null : String(payload.mimeType),
        payload.webViewLink === null || payload.webViewLink === undefined ? null : String(payload.webViewLink),
        payload.assetId ? String(payload.assetId) : null,
        payload.issueId ? String(payload.issueId) : null,
        payload.repairId ? String(payload.repairId) : null,
        payload.chargeId ? String(payload.chargeId) : null,
        payload.purchaseCandidateId ? String(payload.purchaseCandidateId) : null,
        payload.sourceUrl === null || payload.sourceUrl === undefined ? null : String(payload.sourceUrl),
        payload.provenance === null || payload.provenance === undefined ? null : String(payload.provenance),
        String(payload.occurredAt) + "T12:00:00.000Z",
        payload.evidenceReason === null || payload.evidenceReason === undefined ? null : String(payload.evidenceReason),
        String(payload.evidenceStatus),
        createdAt,
        createdAt,
        activeHomeId()
      );
      if (payload.uploadId) {
        const linked = db.prepare(
          "UPDATE file_uploads SET document_id = ? WHERE id = ? AND document_id IS NULL AND home_id IS COALESCE(NULLIF(?,''),home_id)"
        ).run(documentId, String(payload.uploadId),activeHomeId() ?? "");
        if (Number(linked.changes) !== 1) throw new DomainError("Staged upload has expired or is already linked.", 409);
      }
      const document = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as JsonRecord;
      recordChange(db, transactionId, "document", documentId, "CREATE", null, document, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "DOCUMENT_ATTACHED",
        title: `Evidence attached: ${payload.title}`,
        summary: payload.evidenceReason
          ? String(payload.evidenceReason)
          : `${payload.documentType} evidence recorded in Homely.`,
        occurredAt: String(payload.occurredAt) + "T12:00:00.000Z",
        assetId: payload.assetId ? String(payload.assetId) : null,
        issueId: payload.issueId ? String(payload.issueId) : null,
        repairId: payload.repairId ? String(payload.repairId) : null,
        chargeId: payload.chargeId ? String(payload.chargeId) : null,
        purchaseCandidateId: payload.purchaseCandidateId ? String(payload.purchaseCandidateId) : null,
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

    if (actionType === "CREATE_PROJECT") {
      const home = db.prepare("SELECT id FROM homes WHERE id=COALESCE(NULLIF(?,''),id) ORDER BY created_at LIMIT 1").get(activeHomeId() ?? "");
      if (!home) throw new DomainError("Home record is missing.", 500);
      const projectId = newId("project");
      db.prepare(`
        INSERT INTO projects(
          id,home_id,title,status,description,start_date,target_date,budget_cents,completed_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        projectId,
        String(home.id),
        String(payload.title),
        String(payload.status),
        payload.description === null || payload.description === undefined ? null : String(payload.description),
        payload.startDate === null || payload.startDate === undefined ? null : String(payload.startDate),
        payload.targetDate === null || payload.targetDate === undefined ? null : String(payload.targetDate),
        payload.budgetCents === null || payload.budgetCents === undefined ? null : Number(payload.budgetCents),
        null,
        createdAt,
        createdAt
      );
      const project = getProject(db, projectId) as JsonRecord;
      recordChange(db, transactionId, "project", projectId, "CREATE", null, project, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "PROJECT_CREATED",
        title: `Project created: ${payload.title}`,
        summary: payload.description ? String(payload.description) : `${payload.status} project created.`,
        occurredAt: createdAt,
        projectId
      }, createdAt);
    }

    if (actionType === "UPDATE_PROJECT_STATUS") {
      const before = getProject(db, String(payload.projectId)) as JsonRecord;
      db.prepare(
        "UPDATE projects SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?"
      ).run(
        String(payload.status),
        payload.completedAt === null || payload.completedAt === undefined ? null : String(payload.completedAt),
        createdAt,
        String(payload.projectId)
      );
      const after = getProject(db, String(payload.projectId)) as JsonRecord;
      recordChange(db, transactionId, "project", String(payload.projectId), "UPDATE", before, after, createdAt);
      createTimelineEvent(db, transactionId, {
        eventType: "PROJECT_STATUS_CHANGED",
        title: `Project ${payload.status}: ${before.title}`,
        summary: payload.note ? String(payload.note) : `Status changed from ${before.status} to ${payload.status}.`,
        occurredAt: payload.completedAt ? String(payload.completedAt) + "T12:00:00.000Z" : createdAt,
        projectId: String(payload.projectId)
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
  if (!current || typeof current !== "object" || !expected) return false;
  // Older snapshots may contain libSQL timing metadata; preserve every data field.
  const recordData = (row: object) => Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "_metadata")
  );
  return isDeepStrictEqual(recordData(current), recordData(expected));
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
    } else if (entityType === "asset") {
      const current = db.prepare("SELECT * FROM assets WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Asset changed after this transaction.", 409);
      const associations = ["issues", "repairs", "maintenance_rules", "documents", "purchase_candidates"];
      for (const table of associations) {
        if (db.prepare(`SELECT 1 FROM ${table} WHERE asset_id = ? LIMIT 1`).get(entityId)) {
          throw new DomainError("Asset has linked history and cannot be deleted.", 409);
        }
      }
      db.prepare("DELETE FROM assets WHERE id = ?").run(entityId);
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
    } else if (entityType === "project") {
      const current = db.prepare("SELECT * FROM projects WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Project changed after this transaction and cannot be safely undone.", 409);
      db.prepare("DELETE FROM projects WHERE id = ?").run(entityId);
    } else if (entityType === "charge") {
      const current = db.prepare("SELECT * FROM charges WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Charge changed after this transaction and cannot be safely undone.", 409);
      db.prepare("DELETE FROM charges WHERE id = ?").run(entityId);
    } else if (entityType === "purchase_candidate") {
      const current = db.prepare("SELECT * FROM purchase_candidates WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Purchase candidate changed after this transaction and cannot be safely undone.", 409);
      db.prepare("DELETE FROM purchase_candidates WHERE id = ?").run(entityId);
    } else if (entityType === "repair") {
      throw new DomainError("Repair records are permanent and cannot be deleted by undo.", 409);
    } else {
      throw new DomainError("This transaction contains an unsupported undo operation.", 409);
    }
    recordChange(db, undoId, entityType, entityId, "DELETE", after, null, changedAt);
    return;
  }

  if (operation === "UPDATE") {
    if (!before || !after) throw new DomainError("Transaction history is incomplete.", 409);
    if (entityType === "asset") {
      const current = db.prepare("SELECT * FROM assets WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Asset has changed since this update.", 409);
      db.prepare(`
        UPDATE assets SET system_id=?,name=?,category=?,location=?,manufacturer=?,model=?,
          serial_number=?,purchase_date=?,purchase_cost_cents=?,warranty_end=?,notes=?,condition=?,updated_at=?
        WHERE id=?
      `).run(
        String(before.system_id),String(before.name),String(before.category),
        before.location as string | null, before.manufacturer as string | null,
        before.model as string | null, before.serial_number as string | null,
        before.purchase_date as string | null,
        before.purchase_cost_cents as number | null, before.warranty_end as string | null,
        before.notes as string | null, String(before.condition), String(before.updated_at), entityId
      );
      const restored = db.prepare("SELECT * FROM assets WHERE id = ?").get(entityId);
      recordChange(db, undoId, entityType, entityId, "UPDATE", after, restored, changedAt);
      return;
    }

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

    if (entityType === "project") {
      const current = db.prepare("SELECT * FROM projects WHERE id = ?").get(entityId);
      if (!sameRow(current, after)) throw new DomainError("Project changed after this transaction and cannot be safely undone.", 409);
      db.prepare(
        "UPDATE projects SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?"
      ).run(
        String(before.status),
        before.completed_at === null || before.completed_at === undefined ? null : String(before.completed_at),
        String(before.updated_at),
        entityId
      );
      const restored = db.prepare("SELECT * FROM projects WHERE id = ?").get(entityId);
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
  const original = db.prepare("SELECT * FROM transactions WHERE id=? AND home_id IS COALESCE(NULLIF(?,''),home_id)").get(transactionId,activeHomeId() ?? "");
  if (!original) throw new DomainError("Transaction not found.", 404);
  if (String(original.status) !== "COMMITTED") throw new DomainError("Only committed transactions can be undone.", 409);
  if (String(original.action_type) === "UNDO") throw new DomainError("Undo transactions cannot be undone.", 409);
  if (["REPORT_ISSUE","RECORD_REPAIR"].includes(String(original.action_type))) {
    throw new DomainError(
      String(original.action_type) === "REPORT_ISSUE"
        ? "Issue records are permanent. Resolve the issue or add correcting history instead of deleting it."
        : "Repair records are permanent. Add a correcting record instead of deleting history.",
      409
    );
  }

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
        created_at,approved_at,committed_at,reversal_of,home_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
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
      transactionId,
      activeHomeId()
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
  const transaction = db.prepare("SELECT * FROM transactions WHERE id=? AND home_id IS COALESCE(NULLIF(?,''),home_id)").get(transactionId,activeHomeId() ?? "") as JsonRecord | undefined;
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
    WHERE t.home_id IS COALESCE(NULLIF(?,''),t.home_id)
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(activeHomeId(),limit);
}

