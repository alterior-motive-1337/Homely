import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { HomelyDatabase } from "../db.js";
import { getAsset, getOverview, getTimeline, listAssets, listMaintenance } from "../domain/repository.js";
import {
  commitTransaction,
  DomainError,
  getTransaction,
  proposeTransaction,
  rejectTransaction,
  undoTransaction,
  type ActionType
} from "../domain/transactions.js";

function ok(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Homely could not complete this tool call.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }]
  };
}

export function buildHomelyMcpServer(db: HomelyDatabase): McpServer {
  const server = new McpServer({
    name: "Homely",
    version: "0.2.0"
  });

  server.registerTool(
    "get_home_summary",
    {
      description: "Return the current deterministic home health summary, active issues, overdue maintenance, upcoming maintenance, and recent history.",
      inputSchema: z.object({})
    },
    async () => {
      try { return ok(getOverview(db)); } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "list_assets",
    {
      description: "List recorded home assets with their system and deterministic health state.",
      inputSchema: z.object({
        system: z.string().trim().min(1).optional().describe("Optional system name or category filter."),
        health: z.enum(["HEALTHY","ATTENTION","DEGRADED","FAILED","UNKNOWN"]).optional()
      })
    },
    async ({ system, health }) => {
      try {
        const assets = listAssets(db).filter((asset) => {
          const row = asset as typeof asset & Record<string, unknown>;
          const matchesSystem = !system ||
            String(row.system_name ?? "").toLowerCase().includes(system.toLowerCase()) ||
            String(row.system_category ?? "").toLowerCase().includes(system.toLowerCase());
          return matchesSystem && (!health || asset.health === health);
        });
        return ok(assets);
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "get_asset",
    {
      description: "Get one asset including issues, maintenance, documents, health and recent history.",
      inputSchema: z.object({ assetId: z.string().min(1) })
    },
    async ({ assetId }) => {
      try {
        const asset = getAsset(db, assetId);
        if (!asset) throw new DomainError("Asset not found.", 404);
        return ok(asset);
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "get_asset_history",
    {
      description: "Return the recorded chronological history for a specific asset.",
      inputSchema: z.object({ assetId: z.string().min(1) })
    },
    async ({ assetId }) => {
      try {
        const asset = getAsset(db, assetId);
        if (!asset) throw new DomainError("Asset not found.", 404);
        return ok(asset.history);
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "search_history",
    {
      description: "Search the house timeline by words and optionally restrict results to one asset.",
      inputSchema: z.object({
        query: z.string().trim().max(200).optional(),
        assetId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(20)
      })
    },
    async ({ query, assetId, limit }) => {
      try {
        const needle = query?.toLowerCase();
        const events = getTimeline(db, 250).filter((event) => {
          if (assetId && String(event.asset_id ?? "") !== assetId) return false;
          if (!needle) return true;
          return [event.title, event.summary, event.asset_name, event.event_type]
            .some((value) => String(value ?? "").toLowerCase().includes(needle));
        }).slice(0, limit);
        return ok(events);
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "list_maintenance_due",
    {
      description: "List active maintenance obligations, optionally restricted to overdue or upcoming items.",
      inputSchema: z.object({
        state: z.enum(["OVERDUE","UPCOMING","ALL"]).default("ALL")
      })
    },
    async ({ state }) => {
      try {
        const rows = listMaintenance(db).filter((row) => state === "ALL" || row.due_state === state);
        return ok(rows);
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "preview_action",
    {
      description: "Validate and create an inert Homely transaction proposal. This does not change home state. Use commit_action only after the user explicitly approves this exact proposal.",
      inputSchema: z.object({
        actionType: z.enum(["REPORT_ISSUE","CREATE_MAINTENANCE","RESOLVE_ISSUE","COMPLETE_MAINTENANCE"]),
        payload: z.record(z.string(), z.unknown()),
        reason: z.string().trim().min(1).max(500),
        requestText: z.string().max(2000).optional()
      })
    },
    async ({ actionType, payload, reason, requestText }) => {
      try {
        return ok(proposeTransaction(db, {
          actionType: actionType as ActionType,
          payload,
          reason,
          requestText,
          origin: "MCP"
        }));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "commit_action",
    {
      description: "Commit a previously previewed Homely transaction. Call only after explicit human approval of the exact transaction preview.",
      inputSchema: z.object({
        transactionId: z.string().min(1),
        userApproved: z.literal(true).describe("Must be true only after the user explicitly approved this transaction.")
      })
    },
    async ({ transactionId }) => {
      try { return ok(commitTransaction(db, transactionId)); } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "reject_action",
    {
      description: "Reject a proposed transaction after the user declines it. Rejection changes no home state and remains in the audit history.",
      inputSchema: z.object({ transactionId: z.string().min(1) })
    },
    async ({ transactionId }) => {
      try { return ok(rejectTransaction(db, transactionId)); } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "undo_action",
    {
      description: "Reverse a committed Homely transaction when safe. The original transaction and reversal remain in the audit history.",
      inputSchema: z.object({
        transactionId: z.string().min(1),
        userApproved: z.literal(true).describe("Must be true only after the user explicitly approved the reversal.")
      })
    },
    async ({ transactionId }) => {
      try { return ok(undoTransaction(db, transactionId)); } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "get_transaction",
    {
      description: "Get a Homely transaction and its recorded entity changes for audit/explanation.",
      inputSchema: z.object({ transactionId: z.string().min(1) })
    },
    async ({ transactionId }) => {
      try {
        const transaction = getTransaction(db, transactionId);
        if (!transaction) throw new DomainError("Transaction not found.", 404);
        return ok(transaction);
      } catch (error) { return fail(error); }
    }
  );

  return server;
}
