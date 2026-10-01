import type { HomelyDatabase } from "../db.js";
import { getAsset, getOverview, getTimeline, listAssets, listMaintenance } from "../domain/repository.js";
import { DomainError, getTransaction, proposeTransaction, type ActionType } from "../domain/transactions.js";

export type HomelyToolName =
  | "get_home_summary"
  | "list_assets"
  | "get_asset"
  | "get_asset_history"
  | "search_history"
  | "list_maintenance_due"
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
    name: "preview_action",
    description: "Create an inert Homely transaction proposal after grounding the action in home state/history. This never changes home state. The application will separately ask the human to approve or reject it.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        actionType: {
          type: "string",
          enum: ["REPORT_ISSUE","CREATE_MAINTENANCE","RESOLVE_ISSUE","COMPLETE_MAINTENANCE"]
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
