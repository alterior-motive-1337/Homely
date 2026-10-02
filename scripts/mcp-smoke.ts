import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

function parseText(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  assert.equal(result.isError, undefined, "MCP tool returned an error");
  const block = result.content?.find((item) => item.type === "text");
  assert.ok(block?.text, "MCP tool returned no text payload");
  return JSON.parse(block.text);
}

const tempDir = mkdtempSync(path.join(tmpdir(), "homely-mcp-"));
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
);

const client = new Client(
  { name: "homely-smoke", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } }
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/mcp/server.js"],
  env: {
    ...inheritedEnv,
    HOMELY_DB_PATH: path.join(tempDir, "homely.db")
  }
});

await client.connect(transport);

try {
  const listed = await client.listTools();
  const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));

  for (const required of [
    "get_home_summary",
    "list_assets",
    "get_asset",
    "list_issues",
    "list_documents",
    "get_asset_history",
    "search_history",
    "list_maintenance_due",
    "list_projects",
    "preview_action",
    "get_transaction"
  ]) {
    assert.ok(tools.has(required), `missing MCP tool: ${required}`);
  }

  for (const forbidden of ["commit_action", "undo_action", "reject_action"]) {
    assert.ok(!tools.has(forbidden), `unsafe MCP mutation tool exposed: ${forbidden}`);
  }

  const summaryTool = tools.get("get_home_summary");
  assert.equal(summaryTool?.annotations?.readOnlyHint, true);
  assert.equal(summaryTool?.annotations?.idempotentHint, true);
  assert.equal(summaryTool?.annotations?.openWorldHint, false);

  const previewTool = tools.get("preview_action");
  assert.equal(previewTool?.annotations?.readOnlyHint, false);
  assert.equal(previewTool?.annotations?.destructiveHint, false);
  assert.equal(previewTool?.annotations?.openWorldHint, false);

  const summary = parseText(await client.callTool({ name: "get_home_summary", arguments: {} }));
  assert.equal(summary.home.name, "14 Hawthorn Residence");

  const issues = parseText(await client.callTool({
    name: "list_issues",
    arguments: { status: "ACTIVE" }
  }));
  assert.ok(issues.some((issue: { title: string }) => issue.title === "Camera 4 intermittent disconnect"));

  const documents = parseText(await client.callTool({
    name: "list_documents",
    arguments: { provider: "LOCAL" }
  }));
  assert.equal(documents.length, 3);
  assert.ok(documents.some((document: { title: string }) => document.title.includes("inverter warranty")));

  const projects = parseText(await client.callTool({
    name: "list_projects",
    arguments: { status: "ALL" }
  }));
  assert.ok(projects.some((project: { title: string }) => project.title === "Battery storage expansion"));

  const preview = parseText(await client.callTool({
    name: "preview_action",
    arguments: {
      actionType: "REPORT_ISSUE",
      reason: "MCP smoke test verifies proposal-only mutation access.",
      payload: {
        assetId: "asset-tap",
        title: "MCP smoke transaction issue",
        severity: "MEDIUM",
        description: "This proposal must not mutate home state."
      }
    }
  }));
  assert.equal(preview.transaction.status, "PROPOSED");

  const tapAfterPreview = parseText(await client.callTool({
    name: "get_asset",
    arguments: { assetId: "asset-tap" }
  }));
  assert.ok(!tapAfterPreview.issues.some((issue: { title: string }) => issue.title === "MCP smoke transaction issue"));

  const audit = parseText(await client.callTool({
    name: "get_transaction",
    arguments: { transactionId: preview.transaction.id }
  }));
  assert.equal(audit.status, "PROPOSED");
  assert.equal(audit.origin, "MCP");

  console.log("Homely MCP smoke test passed.");
} finally {
  await client.close();
  rmSync(tempDir, { recursive: true, force: true });
}
