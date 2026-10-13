import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE || "playwright");
const executablePath = process.env.TEST_BROWSER_EXECUTABLE || (fs.existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
const errors = [];
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on("pageerror", error => errors.push(String(error)));
const go = async view => {
  await page.locator('[data-view="' + view + '"]').click();
  await page.locator("#content .loading").waitFor({ state: "hidden" });
};
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "horizontal overflow");
try {
  await page.goto(base);
  await page.locator("#page-title").filter({ hasText: "14 Hawthorn Residence" }).waitFor();
  assert.equal(await page.locator("#chat-rail").getAttribute("aria-hidden"), "false", "desktop assistant must be docked");
  await noOverflow();
  await page.locator("#household-settings").click();
  await page.getByRole("link", { name: "Export household" }).waitFor();
  await page.locator('#invite-home-form input[name="email"]').fill("ci-invite@example.test");
  await page.locator('#invite-home-form select[name="role"]').selectOption("VIEWER");
  await page.getByRole("button", { name: "Create invite link" }).click();
  await page.locator("#invite-link").waitFor();
  await page.getByRole("button", { name: "Delete account…" }).click();
  await page.locator("#delete-account-form").waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  let issueFetches = 0;
  page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === "/api/issues") issueFetches++; });
  await go("issues");
  const total = await page.locator(".ledger-entry").count();
  await page.locator('[data-status="resolved"]').click();
  assert.ok(await page.locator(".ledger-entry:visible").count() < total);
  await page.locator('[data-status="all"]').click();
  await page.locator("#record-search").fill("Camera 4");
  assert.equal(await page.locator(".ledger-entry:visible").count(), 1);
  const fetches = issueFetches;
  await go("appliances");
  await page.locator("#asset-search").fill("inverter");
  await page.locator("[data-asset]").first().click();
  const fileButtons = page.locator("#modal [data-file]");
  await fileButtons.first().waitFor();
  assert.ok(await fileButtons.count() > 0);
  // Every related file control must open the viewer, including the last one.
  await fileButtons.last().click();
  await page.locator("#viewer").waitFor({ state: "visible" });
  await page.locator("#viewer-close").click();
  await page.locator("#modal-close").click();
  await go("issues");
  assert.equal(await page.locator("#record-search").inputValue(), "Camera 4", "cached tab must retain search");
  assert.equal(issueFetches, fetches, "cached tab must not refetch");
  await page.locator("#record-search").fill("no-such-record-xyz");
  await page.getByText("No matching records", { exact: true }).waitFor();
  await page.locator("#refresh-view").click();
  await page.locator("#record-search").waitFor();
  assert.equal(issueFetches, fetches + 1);
  await page.locator("#new-issue").click();
  await page.locator('#issue-form select[name="assetId"]').selectOption("asset-tap");
  await page.locator('#issue-form input[name="title"]').fill("Browser transaction issue");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Approve & commit" }).click();
  await page.locator("[data-issue-open]").filter({ hasText: "Browser transaction issue" }).waitFor();

  await go("repairs");
  await page.locator("#new-repair").click();
  await page.locator('#repair-form select[name="assetId"]').selectOption("asset-tap");
  await page.locator('#repair-form input[name="title"]').fill("Browser repair record");
  await page.locator('#repair-form input[name="cost"]').fill("250");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Approve & commit" }).click();
  await page.locator("[data-repair-open]").filter({ hasText: "Browser repair record" }).click();
  await page.getByRole("heading", { name: "Work performed", exact: true }).waitFor();
  await page.locator("#modal-close").click();
  await page.locator("#record-search").fill("no-such-repair-xyz");
  await page.getByText("No matching records", { exact: true }).waitFor();
  await page.locator("#record-search").fill("");

  await go("files");
  await page.locator("#upload-file").click();
  await page.locator('#link-evidence-form input[name="attachment"]').waitFor();
  await page.locator("#modal-close").click();
  await page.locator("#save-link").click();
  await page.locator('#link-evidence-form input[name="sourceUrl"]').waitFor();
  await page.locator("#modal-close").click();
  await page.locator(".file-card").first().click();
  await page.locator("#inspect-open").waitFor();
  await page.locator("#file-search").fill("no-such-file-xyz");
  await page.getByText("No matching files", { exact: true }).waitFor();
  assert.equal(await page.locator("#inspect-open").count(), 0, "hidden selection must not leave a stale inspector");
  assert.equal(await page.locator('.file-card[aria-pressed="true"]').count(), 0);
  await page.locator("#file-search").fill("");
  await page.locator(".file-card").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#viewer").waitFor({ state: "visible" });
  await page.locator("#viewer-close").click();
  await go("home");
  await go("files");
  await go("home");
  assert.equal(await page.locator("#page-title").textContent(), "14 Hawthorn Residence", "cached home title");

  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await go("issues"); await noOverflow();
    await go("files"); await noOverflow();
    if(process.env.TEST_SCREENSHOT_DIR)await page.screenshot({path:process.env.TEST_SCREENSHOT_DIR+"/files-"+width+".png"});
  }
  assert.equal(await page.locator("#chat-rail").evaluate(el => el.inert), true);
  await page.locator("#chat-open").click();
  await page.locator("#chat-close").waitFor({state:"visible"});
  assert.equal(await page.locator("#chat-rail").evaluate(el => el.inert), false);
  await page.locator("#chat-close").focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator("#chat-rail").evaluate(el => el.contains(document.activeElement)), true, "mobile focus must stay in assistant");
  await page.locator("#chat-close").click();
  assert.equal(await page.locator("#chat-rail").evaluate(el => el.inert), true);
  assert.equal(await page.locator("#chat-open").evaluate(el => el === document.activeElement), true, "restore focus to opener");
  // Stub only provider readiness and browser speech; no paid inference is called.
  await page.route("**/api/integrations/status", async route => {
    const response = await route.fetch(); const data = await response.json(); data.ai.available = true;
    await route.fulfill({ response, json: data });
  });
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      start() { this.onstart?.(); this.onresult?.({ results: [[{ transcript: "check the kitchen tap" }]] }); }
      abort() { window.__voiceAborts = (window.__voiceAborts || 0) + 1; this.onend?.(); }
    };
  });
  await page.reload();
  await page.locator("#chat-open").click();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  assert.equal(await page.locator("#chat-input").inputValue(), "check the kitchen tap");
  await page.getByRole("button", { name: "Stop listening", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__voiceAborts), 1);
  await page.locator("#chat-close").click();

  const fresh = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  fresh.on("pageerror", error => errors.push(String(error)));
  await fresh.context().addCookies([{ name: "homely_test_view", value: "fresh", url: base }]);
  await fresh.goto(base);
  await fresh.getByRole("heading", { name: "No assets" }).waitFor();
  await fresh.getByRole("button", { name: "Register asset" }).click();
  await fresh.locator("#asset-form").waitFor(); await fresh.locator("#modal-close").click();
  for (const view of ["issues", "repairs", "appliances", "files"]) {
    await fresh.locator('[data-view="' + view + '"]').click();
    await fresh.locator(view === "files" ? ".files-empty" : ".ledger-zero").waitFor();
  }
  assert.deepEqual(errors, [], "browser errors");
  console.log("Workspace browser checks passed: record commits, search/cache, related files, keyboard viewer, desktop/mobile, fresh home and voice.");
} finally { await browser.close(); }
