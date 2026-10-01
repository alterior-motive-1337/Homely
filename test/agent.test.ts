import assert from "node:assert/strict";
import test from "node:test";
import { migrate, openDatabase } from "../src/db.js";
import { seedDemo } from "../src/seed.js";
import { OpenAIAgentProvider } from "../src/agent/openaiProvider.js";

function response(id: string, output: unknown[], outputText = "") {
  return { id, output, output_text: outputText };
}

test("OpenAI provider executes grounded reads and returns final text", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  seedDemo(db);

  const calls: unknown[] = [];
  const fake = {
    responses: {
      create: async (input: unknown) => {
        calls.push(input);
        if (calls.length === 1) {
          return response("resp-1", [{
            type: "function_call",
            name: "get_asset",
            arguments: JSON.stringify({ assetId: "asset-tap" }),
            call_id: "call-1"
          }]);
        }
        return response("resp-2", [], "The kitchen tap previously lost pressure because sediment blocked the aerator.");
      }
    }
  };

  const provider = new OpenAIAgentProvider(db, fake as never, "test-model");
  const result = await provider.respond({ message: "What happened with the kitchen tap before?" });

  assert.match(result.text, /sediment/i);
  assert.deepEqual(result.toolsUsed, ["get_asset"]);
  assert.equal(calls.length, 2);
  db.close();
});

test("OpenAI provider can only create an inert proposal", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  seedDemo(db);
  const before = Number(db.prepare("SELECT COUNT(*) AS count FROM maintenance_rules").get()?.count ?? 0);

  let count = 0;
  const fake = {
    responses: {
      create: async () => {
        count += 1;
        if (count === 1) {
          return response("resp-a", [{
            type: "function_call",
            name: "preview_action",
            arguments: JSON.stringify({
              actionType: "CREATE_MAINTENANCE",
              payload: {
                assetId: "asset-tap",
                title: "Inspect kitchen aerator",
                nextDueAt: "2026-10-03",
                intervalDays: null
              },
              reason: "The previous pressure-loss incident was caused by sediment at the aerator.",
              requestText: "The kitchen tap is losing pressure again."
            }),
            call_id: "call-a"
          }]);
        }
        return response("resp-b", [], "This resembles the prior sediment blockage. I prepared an aerator inspection for approval.");
      }
    }
  };

  const provider = new OpenAIAgentProvider(db, fake as never, "test-model");
  const result = await provider.respond({ message: "The kitchen tap is losing pressure again." });

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.actionType, "CREATE_MAINTENANCE");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM maintenance_rules").get()?.count ?? 0), before);
  assert.equal(db.prepare("SELECT status FROM transactions WHERE id = ?").get(result.proposals[0]?.transactionId)?.status, "PROPOSED");
  db.close();
});
