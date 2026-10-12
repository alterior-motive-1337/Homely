import assert from "node:assert/strict";
import test from "node:test";
import { HomeResearch } from "../src/integrations/webResearch.js";
import { researchToolDefinitions } from "../src/agent/researchTools.js";

test("Exa provides both search and bounded page content without Firecrawl", async () => {
  const reads: unknown[] = [];
  const research = new HomeResearch({
    search: async () => ({ results: [{ title: "Tap cartridge", url: "https://supplier.example", highlights: ["Replacement cartridge"] }] }),
    getContents: async (urls: unknown, options: unknown) => {
      reads.push({ urls, options });
      return { results: [{ title: "Tap cartridge", text: "Compatible cartridge. Price R450." }] };
    }
  } as never);
  assert.deepEqual(researchToolDefinitions(research).map((tool) => "name" in tool ? tool.name : ""), ["search_web", "read_web_page"]);
  await assert.rejects(research.readSearchResult("https://unseen.example/"), /returned by Homely search/);
  await assert.rejects(research.search({ query: "plumber", purpose: "LOCAL_SERVICE" }), /user-supplied location/);
  await research.search({ query: "tap cartridge", purpose: "PRODUCT" });
  const page = await research.readSearchResult("https://supplier.example/");
  assert.match(page.text, /R450/);
  assert.deepEqual(reads, [{ urls: ["https://supplier.example/"], options: { text: { maxCharacters: 14000 } } }]);
});
