import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

function parseText(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  assert.equal(result.isError, undefined, "MCP tool returned an error");
  const block = result.content?.find((item) => item.type === "text");
  assert.ok(block?.text, "MCP tool returned no text payload");
  return JSON.parse(block.text);
}

const client = new Client(
  { name: "homely-smoke", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } }
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/mcp/server.js"]
});

await client.connect(transport);

try {
  const listed = await client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const required of [
    "get_home_summary",
    "list_assets",
    "get_asset",
    "search_history",
    "preview_action",
    "commit_action",
    "undo_action",
    "get_transaction"
  ]) {
    assert.ok(names.has(required), `missing MCP tool: ${required}`);
  }

  const summary = parseText(await client.callTool({ name: "get_home_summary", arguments: {} }));
  assert.equal(summary.home.name, "14 Hawthorn Residence");

  const preview = parseText(await client.callTool({
    name: "preview_action",
    arguments: {
      actionType: "REPORT_ISSUE",
      reason: "MCP smoke test verifies the guarded mutation loop.",
      payload: {
        assetId: "asset-tap",
        title: "MCP smoke transaction issue",
        severity: "MEDIUM",
        description: "Temporary issue created by the MCP integration test."
      }
    }
  }));
  assert.equal(preview.transaction.status, "PROPOSED");

  const transactionId = preview.transaction.id;
  parseText(await client.callTool({
    name: "commit_action",
    arguments: { transactionId, userApproved: true }
  }));

  const tapAfterCommit = parseText(await client.callTool({
    name: "get_asset",
    arguments: { assetId: "asset-tap" }
  }));
  assert.ok(tapAfterCommit.issues.some((issue: { title: string }) => issue.title === "MCP smoke transaction issue"));

  parseText(await client.callTool({
    name: "undo_action",
    arguments: { transactionId, userApproved: true }
  }));

  const tapAfterUndo = parseText(await client.callTool({
    name: "get_asset",
    arguments: { assetId: "asset-tap" }
  }));
  assert.ok(!tapAfterUndo.issues.some((issue: { title: string }) => issue.title === "MCP smoke transaction issue"));

  const audit = parseText(await client.callTool({
    name: "get_transaction",
    arguments: { transactionId }
  }));
  assert.equal(audit.status, "REVERSED");

  console.log("Homely MCP smoke test passed.");
} finally {
  await client.close();
}
