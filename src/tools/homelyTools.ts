import type { HomelyDatabase } from "../db.js";
import { activeHomeId } from "../security/homeScope.js";
import {
  getAsset,
  getOverview,
  getTimeline,
  listAssets,
  listCharges,
  listDocuments,
  listIssues,
  listMaintenance,
  listProjects,
  listPurchaseCandidates,
  listRepairs
} from "../domain/repository.js";
import { DomainError, getTransaction, proposeTransaction, type ActionType } from "../domain/transactions.js";

export type HomelyToolName =
  | "get_home_summary"
  | "list_assets"
  | "get_asset"
  | "list_issues"
  | "list_repairs"
  | "list_charges"
  | "list_purchases"
  | "list_documents"
  | "get_document"
  | "analyze_document"
  | "get_asset_history"
  | "search_history"
  | "list_maintenance_due"
  | "list_projects"
  | "preview_action"
  | "get_transaction";

export interface HomelyToolDefinition {
  type: "function";
  name: HomelyToolName;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
}

export const agentToolDefinitions: HomelyToolDefinition[] = [
  {
    type: "function",
    name: "get_home_summary",
    description: "Return deterministic current home health, active issues, overdue and upcoming maintenance, and recent history.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_assets",
    description: "List recorded home assets with system and deterministic health. Use this to resolve a user's natural-language reference to an asset.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        system: { type: ["string", "null"], description: "Optional system name/category filter." },
        health: {
          anyOf: [
            { type: "string", enum: ["HEALTHY","ATTENTION","DEGRADED","FAILED","UNKNOWN"] },
            { type: "null" }
          ]
        }
      },
      required: ["system", "health"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_asset",
    description: "Get one asset with current fields, issues, maintenance, documents, health and recent history.",
    strict: true,
    parameters: {
      type: "object",
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_issues",
    description: "List the issue register with asset/system context. Use ACTIVE for unresolved work or RESOLVED for historical fixes.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE","RESOLVED","ALL"] }
      },
      required: ["status"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_repairs",
    description: "List permanent repair records with asset, system, linked issue, date, cost, contractor and outcome.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        assetId: { type: ["string", "null"] }
      },
      required: ["assetId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_charges",
    description: "List recurring household charges. Use ACTIVE for current monthly/recurring costs or ALL for history.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE","ALL"] }
      },
      required: ["status"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_purchases",
    description: "List saved and shortlisted potential purchases with budget, expected cost, source and rationale.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["SAVED","SHORTLISTED","PURCHASED","DISMISSED","ACTIVE","ALL"] }
      },
      required: ["status"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_documents",
    description: "List Homely document metadata and linked asset/issue context. Does not retrieve external file contents.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["LOCAL","GOOGLE_DRIVE","ALL"] }
      },
      required: ["provider"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_document",
    description: "Read one Homely evidence record and, when a small plain-text attachment is stored in Turso, include its actual text. Other media return metadata only; never claim to have read an unparsed PDF, image or video.",
    strict: true,
    parameters: {
      type: "object",
      properties: { documentId: { type: "string" } },
      required: ["documentId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "analyze_document",
    description: "Read a specific stored file on explicit request. Text, PDF and DOCX extract locally (documents up to 12 MB; text up to 1 MB). Images use Groq vision up to 12 MB; audio/video speech transcription supports 25 MB. Cached visual video samples may be available; new frame sampling starts in the file viewer. Treat model output as observations, not verified house facts.",
    strict: true,
    parameters: { type:"object",properties:{ documentId:{type:"string"} },required:["documentId"],additionalProperties:false }
  },
  {
    type: "function",
    name: "get_asset_history",
    description: "Return chronological recorded history for one known asset.",
    strict: true,
    parameters: {
      type: "object",
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "search_history",
    description: "Search the property timeline by text and optionally restrict to one asset.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: ["string", "null"] },
        assetId: { type: ["string", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      required: ["query", "assetId", "limit"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_maintenance_due",
    description: "List active maintenance obligations by due state.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["OVERDUE","UPCOMING","ALL"] }
      },
      required: ["state"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "list_projects",
    description: "List property projects with status, dates, budget and notes.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        status: {
          anyOf: [
            { type: "string", enum: ["PLANNED","ACTIVE","PAUSED","COMPLETE","CANCELLED","ALL"] },
            { type: "null" }
          ]
        }
      },
      required: ["status"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "preview_action",
    description: "Create an inert Homely transaction proposal after grounding the action in home state/history. This never changes home state. The application will separately ask the human to approve or reject it.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        actionType: {
          type: "string",
          enum: ["CREATE_ASSET","UPDATE_ASSET","REPORT_ISSUE","CREATE_MAINTENANCE","RESOLVE_ISSUE","COMPLETE_MAINTENANCE","RECORD_REPAIR","CREATE_CHARGE","UPDATE_CHARGE","SAVE_PURCHASE","UPDATE_PURCHASE","CREATE_PROJECT","UPDATE_PROJECT_STATUS"]
        },
        payload: {
          type: "object",
          description: "Action-specific payload accepted by Homely domain validation.",
          additionalProperties: true
        },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        requestText: { type: ["string", "null"], maxLength: 2000 }
      },
      required: ["actionType","payload","reason","requestText"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_transaction",
    description: "Read an existing Homely transaction and its recorded changes for explanation/audit.",
    strict: true,
    parameters: {
      type: "object",
      properties: { transactionId: { type: "string" } },
      required: ["transactionId"],
      additionalProperties: false
    }
  }
];

function rowValue(row: unknown, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

export function executeHomelyTool(
  db: HomelyDatabase,
  name: HomelyToolName,
  args: Record<string, unknown>,
  origin = "AGENT"
): unknown {
  if (name === "get_home_summary") return getOverview(db);

  if (name === "list_assets") {
    const system = args.system === null || args.system === undefined ? null : String(args.system).toLowerCase();
    const health = args.health === null || args.health === undefined ? null : String(args.health);
    return listAssets(db).filter((asset) => {
      const matchesSystem = !system ||
        String(rowValue(asset, "system_name") ?? "").toLowerCase().includes(system) ||
        String(rowValue(asset, "system_category") ?? "").toLowerCase().includes(system);
      return matchesSystem && (!health || String(asset.health) === health);
    });
  }

  if (name === "get_asset") {
    const asset = getAsset(db, String(args.assetId ?? ""));
    if (!asset) throw new DomainError("Asset not found.", 404);
    return asset;
  }

  if (name === "list_issues") {
    const status = String(args.status ?? "ACTIVE");
    return listIssues(db).filter((issue) => {
      const resolved = ["RESOLVED","CLOSED"].includes(String(issue.status));
      if (status === "ACTIVE") return !resolved;
      if (status === "RESOLVED") return resolved;
      return true;
    });
  }

  if (name === "list_repairs") {
    const assetId = args.assetId === null || args.assetId === undefined ? null : String(args.assetId);
    return listRepairs(db).filter((row) => !assetId || String(row.asset_id) === assetId);
  }

  if (name === "list_charges") {
    const status = String(args.status ?? "ACTIVE");
    return listCharges(db).filter((row) => status === "ALL" || Number(row.active) === 1);
  }

  if (name === "list_purchases") {
    const status = String(args.status ?? "ACTIVE");
    return listPurchaseCandidates(db).filter((row) => {
      if (status === "ALL") return true;
      if (status === "ACTIVE") return ["SAVED","SHORTLISTED"].includes(String(row.status));
      return String(row.status) === status;
    });
  }

  if (name === "list_documents") {
    const provider = String(args.provider ?? "ALL");
    return listDocuments(db).filter((document) =>
      provider === "ALL" || String(document.provider) === provider
    );
  }

  if (name === "get_document") {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND home_id IS COALESCE(NULLIF(?,''),home_id)").get(String(args.documentId ?? ""),activeHomeId() ?? "");
    if (!doc) throw new DomainError("Document not found.", 404);
    const file = db.prepare("SELECT id,mime_type,content,expected_bytes FROM file_uploads WHERE document_id = ?").get(String(doc.id));
    const analyzed=db.prepare("SELECT content_text,model FROM file_analysis WHERE document_id=?").get(String(doc.id));
    const mime = file ? String(file.mime_type) : String(doc.mime_type ?? "");
    const firstChunk=file && Number(file.expected_bytes)>0
      ? db.prepare("SELECT content FROM file_upload_chunks WHERE upload_id=? AND chunk_index=0").get(String(file.id))
      : null;
    const directText = file && ["text/plain","text/csv","application/json"].includes(mime)
      ? Buffer.from((firstChunk?.content??file.content) as Uint8Array).toString("utf8").slice(0,20000)
      : null;
    const text=analyzed ? String(analyzed.content_text) : directText;
    return {
      ...doc,
      contentText: text,
      contentReadable: text !== null,
      analysisModel: analyzed?.model ?? null,
      note: analyzed ? "Cached multimedia analysis; confirm important details against the original evidence."
        : directText !== null ? "First 20,000 characters of stored text; more may exist."
        : "Only metadata available. To interpret attached media, use analyze_document on explicit request."
    };
  }

  if (name === "get_asset_history") {
    const asset = getAsset(db, String(args.assetId ?? ""));
    if (!asset) throw new DomainError("Asset not found.", 404);
    return asset.history;
  }

  if (name === "search_history") {
    const query = args.query === null || args.query === undefined ? null : String(args.query).toLowerCase();
    const assetId = args.assetId === null || args.assetId === undefined ? null : String(args.assetId);
    const limit = Math.max(1, Math.min(50, Number(args.limit ?? 20) || 20));
    return getTimeline(db, 250).filter((event) => {
      if (assetId && String(event.asset_id ?? "") !== assetId) return false;
      if (!query) return true;
      return [event.title, event.summary, event.asset_name, event.event_type]
        .some((value) => String(value ?? "").toLowerCase().includes(query));
    }).slice(0, limit);
  }

  if (name === "list_maintenance_due") {
    const state = String(args.state ?? "ALL");
    return listMaintenance(db).filter((row) => state === "ALL" || String(row.due_state) === state);
  }

  if (name === "list_projects") {
    const status = args.status === null || args.status === undefined ? "ALL" : String(args.status);
    return listProjects(db).filter((row) => status === "ALL" || String(row.status) === status);
  }

  if (name === "preview_action") {
    return proposeTransaction(db, {
      actionType: String(args.actionType ?? "") as ActionType,
      payload: (args.payload && typeof args.payload === "object" ? args.payload : {}) as Record<string, unknown>,
      reason: String(args.reason ?? ""),
      requestText: args.requestText === null || args.requestText === undefined ? null : String(args.requestText),
      origin
    });
  }

  if (name === "get_transaction") {
    const transaction = getTransaction(db, String(args.transactionId ?? ""));
    if (!transaction) throw new DomainError("Transaction not found.", 404);
    return transaction;
  }

  throw new DomainError(`Unknown Homely tool: ${name}`, 404);
}
