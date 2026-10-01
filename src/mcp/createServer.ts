import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { HomelyDatabase } from "../db.js";
import { executeHomelyTool } from "../tools/homelyTools.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const proposalAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

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
    version: "0.3.0"
  });

  server.registerTool(
    "get_home_summary",
    {
      description: "Return the current deterministic home health summary, active issues, overdue maintenance, upcoming maintenance, and recent history.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations
    },
    async () => {
      try { return ok(executeHomelyTool(db, "get_home_summary", {}, "MCP")); } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "list_assets",
    {
      description: "List recorded home assets with their system and deterministic health state.",
      inputSchema: z.object({
        system: z.string().trim().min(1).optional().describe("Optional system name or category filter."),
        health: z.enum(["HEALTHY","ATTENTION","DEGRADED","FAILED","UNKNOWN"]).optional()
      }),
      annotations: readOnlyAnnotations
    },
    async ({ system, health }) => {
      try {
        return ok(executeHomelyTool(db, "list_assets", {
          system: system ?? null,
          health: health ?? null
        }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "get_asset",
    {
      description: "Get one asset including issues, maintenance, documents, health and recent history.",
      inputSchema: z.object({ assetId: z.string().min(1) }),
      annotations: readOnlyAnnotations
    },
    async ({ assetId }) => {
      try {
        return ok(executeHomelyTool(db, "get_asset", { assetId }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "list_issues",
    {
      description: "List the issue register, including active and resolved issues with asset and system context.",
      inputSchema: z.object({
        status: z.enum(["ACTIVE","RESOLVED","ALL"]).default("ACTIVE")
      }),
      annotations: readOnlyAnnotations
    },
    async ({ status }) => {
      try {
        return ok(executeHomelyTool(db, "list_issues", { status }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "list_documents",
    {
      description: "List Homely document records and their linked asset or issue context. This returns Homely metadata, not external file contents.",
      inputSchema: z.object({
        provider: z.enum(["LOCAL","GOOGLE_DRIVE","ALL"]).default("ALL")
      }),
      annotations: readOnlyAnnotations
    },
    async ({ provider }) => {
      try {
        return ok(executeHomelyTool(db, "list_documents", { provider }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "get_asset_history",
    {
      description: "Return the recorded chronological history for a specific asset.",
      inputSchema: z.object({ assetId: z.string().min(1) }),
      annotations: readOnlyAnnotations
    },
    async ({ assetId }) => {
      try {
        return ok(executeHomelyTool(db, "get_asset_history", { assetId }, "MCP"));
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
      }),
      annotations: readOnlyAnnotations
    },
    async ({ query, assetId, limit }) => {
      try {
        return ok(executeHomelyTool(db, "search_history", {
          query: query ?? null,
          assetId: assetId ?? null,
          limit
        }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "list_maintenance_due",
    {
      description: "List active maintenance obligations, optionally restricted to overdue or upcoming items.",
      inputSchema: z.object({
        state: z.enum(["OVERDUE","UPCOMING","ALL"]).default("ALL")
      }),
      annotations: readOnlyAnnotations
    },
    async ({ state }) => {
      try {
        return ok(executeHomelyTool(db, "list_maintenance_due", { state }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "preview_action",
    {
      description: "Validate and create an inert Homely transaction proposal. This does not change home state. Homely itself must separately approve, commit, reject, or undo transactions; those operations are intentionally not exposed through MCP.",
      inputSchema: z.object({
        actionType: z.enum(["REPORT_ISSUE","CREATE_MAINTENANCE","RESOLVE_ISSUE","COMPLETE_MAINTENANCE"]),
        payload: z.record(z.string(), z.unknown()),
        reason: z.string().trim().min(1).max(500),
        requestText: z.string().max(2000).optional()
      }),
      annotations: proposalAnnotations
    },
    async ({ actionType, payload, reason, requestText }) => {
      try {
        return ok(executeHomelyTool(db, "preview_action", {
          actionType,
          payload,
          reason,
          requestText: requestText ?? null
        }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  server.registerTool(
    "get_transaction",
    {
      description: "Get a Homely transaction and its recorded entity changes for audit/explanation.",
      inputSchema: z.object({ transactionId: z.string().min(1) }),
      annotations: readOnlyAnnotations
    },
    async ({ transactionId }) => {
      try {
        return ok(executeHomelyTool(db, "get_transaction", { transactionId }, "MCP"));
      } catch (error) { return fail(error); }
    }
  );

  return server;
}
