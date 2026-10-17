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
  const error=await page.locator("#content .error").count() ? await page.locator("#content .error").first().textContent() : null;
  assert.equal(error,null,view+" failed to render: "+error);
};
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "horizontal overflow");
try {
  await page.goto(base);
  await page.locator("#page-title").filter({ hasText: "14 Hawthorn Residence" }).waitFor({state:"attached"});
  assert.ok(await page.locator(".topbar").evaluate(el=>{const r=el.getBoundingClientRect();return r.width<=1&&r.height<=1}),"tab labels replace visible page headings");
  assert.equal(await page.locator("#refresh-view").count(),0,"manual refresh must not remain");
  assert.equal(await page.locator("#runtime-status").count(),0,"status ornament must not remain");
  assert.equal(await page.locator("#chat-current-title").count(),1,"assistant must label the active conversation");
  assert.equal(await page.locator(".chat-rail").evaluate(el=>getComputedStyle(el).borderLeftWidth),"0px","assistant should not have a decorative divider");
  assert.equal(await page.locator("#chat-rail").getAttribute("aria-hidden"), "false", "desktop assistant must be docked");
  await page.locator("#chat-body").getByText("Saved household chat",{exact:true}).waitFor();
  await noOverflow();
  assert.ok(await page.locator(".nav-item").first().evaluate(el=>{
    const rgb=getComputedStyle(el).color.match(/\d+/g)?.map(Number);
    return rgb?.every(channel=>channel>=160);
  }),"inactive navigation labels must be legible on the dark surface");
  // Visual hierarchy and sizing: navigation must be labeled and use a single top row.
  assert.equal(await page.locator(".nav-item .nav-label").first().isVisible(), true, "desktop tabs need visible text labels");
  assert.ok(await page.locator(".sidebar").evaluate(el => { const r=el.getBoundingClientRect(); return r.width > 1100 && r.height <= 72; }), "desktop navigation must fit a compact header");
  assert.ok(await page.locator(".metric").first().evaluate(el => el.getBoundingClientRect().height <= 125), "overview counters should not become oversized cards");
  assert.equal(await page.locator(".metric").first().locator("strong").textContent(), "16", "home must show registered assets rather than unrelated empty counts");
  assert.equal(await page.locator("#home-repair,#home-issue").count(),0,"home must not duplicate issue/repair actions already in their own tabs");
  assert.equal(await page.locator(".home-recent").count(),0,"do not duplicate the same household records as a recent-record strip");
  assert.equal(await page.locator(".home-recent-title").count(),0,"do not label an obvious recent-record list");
  assert.equal(await page.locator(".metrics").evaluate(el=>{
    const view=document.querySelector(".workspace").getBoundingClientRect(),box=el.getBoundingClientRect();
    return Math.abs((box.left+box.right)/2-(view.left+view.right)/2)<12;
  }),true,"overview metrics must be centered in the workspace");
  assert.equal(await page.locator(".metrics").evaluate(el => getComputedStyle(el).borderTopWidth),"0px","overview metrics should have no enclosing border");
  assert.equal(await page.locator(".metric").first().evaluate(el => getComputedStyle(el).borderRightWidth),"0px","metrics should not be separated by visible dividers");
  assert.equal(await page.locator(".metrics").evaluate(el=>el.classList.contains("metrics-"+el.children.length)),true,"summary columns match the number of visible metrics");
  assert.equal(await page.locator(".metrics").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length),await page.locator(".metric").count(),"summary has no unused counter slots");
  assert.equal(await page.locator(".nav-item.active").evaluate(el => getComputedStyle(el).borderBottomWidth),"2px");
  assert.equal(await page.locator(".nav-item.active").evaluate(el => getComputedStyle(el).borderBottomColor), "rgba(0, 0, 0, 0)", "active navigation uses text emphasis rather than an accent line");
  // Home records must navigate to the issue or repair, not dead-end summaries.
  assert.ok(await page.locator("[data-home-issue]").count()>0,"Home has issue shortcuts");
  await page.locator("[data-home-issue]").first().click();
  await page.locator("#issue-attach").waitFor();
  await page.locator("#modal-close").click();
  if(await page.locator("[data-home-repair]").count()){
    await page.locator("[data-home-repair]").first().click();
    await page.locator("#repair-attach").waitFor();
    await page.locator("#modal-close").click();
  }
  if(await page.locator("[data-home-maintenance]").count()){
    await page.locator("[data-home-maintenance]").first().click();
    await page.locator("#maintenance-complete").waitFor();
    await page.locator("#maintenance-asset").click();
    await page.locator("#edit-asset").waitFor();
    await page.locator("#modal-close").click();
  }
  await page.locator("#assistant-expand").click();
  assert.ok(await page.locator("#chat-rail").evaluate(el=>el.getBoundingClientRect().width>1200),"expanded chat must fill the desktop workspace");
  await page.locator("#assistant-expand").click();
  assert.ok(await page.locator(".workspace").isVisible(),"restored chat must return main workspace");
  const assistantWidth=()=>page.locator("#chat-rail").evaluate(el=>Math.round(el.getBoundingClientRect().width));
  const defaultWidth=await assistantWidth();
  const divider=page.locator("#assistant-resizer");
  const dividerBox=await divider.boundingBox();
  await page.mouse.move(dividerBox.x+dividerBox.width/2,dividerBox.y+180);
  await page.mouse.down();await page.mouse.move(dividerBox.x+dividerBox.width/2-100,dividerBox.y+180);await page.mouse.up();
  assert.equal(await assistantWidth(),defaultWidth+100,"drag must resize the assistant");
  await divider.focus();await page.keyboard.press("ArrowRight");
  assert.equal(await assistantWidth(),defaultWidth+80,"separator must support keyboard resizing");
  await page.reload();await page.locator(".metrics").waitFor();
  assert.equal(await assistantWidth(),defaultWidth+80,"assistant width must survive reload");
  await page.locator("#assistant-collapse").click();
  assert.equal(await page.locator("#chat-rail").getAttribute("aria-hidden"),"true");
  assert.equal(await page.locator("#chat-rail").evaluate(el=>el.inert),true,"collapsed chat must not receive focus");
  assert.equal(await page.locator("#chat-trigger").evaluate(el=>el===document.activeElement),true);
  assert.ok(await page.locator(".workspace").evaluate(el=>el.getBoundingClientRect().width)>1300,"collapsed assistant must release its space");
  await page.reload();await page.locator(".metrics").waitFor();
  assert.equal(await page.locator("#chat-rail").isVisible(),false,"collapsed layout must survive reload");
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator(".nav-item .nav-label").first().isVisible(), true, "mobile tabs retain labels");
  await noOverflow();
  assert.equal(await page.locator("#chat-open").getAttribute("aria-label"),"Open chat","mobile launcher must have an accessible label");
  assert.equal((await page.locator("#chat-open").textContent()).trim(),"","mobile launcher should be icon-only");
  await page.locator("#chat-open").click();
  assert.equal(await page.locator("#chat-rail").getAttribute("aria-hidden"),"false","mobile drawer must open even with desktop chat collapsed");
  await page.locator("#chat-close").click();
  await page.setViewportSize({width:1366,height:768});
  await page.locator("#chat-trigger").click();await divider.dblclick();
  assert.equal(await assistantWidth(),defaultWidth,"double-click must reset assistant width");
  let releaseHomes;
  const heldHomes=new Promise(resolve=>{releaseHomes=resolve});
  await page.route("**/api/homes",async route=>{await heldHomes;await route.continue()});
  await page.locator("#household-settings").click();
  await page.locator("#modal").waitFor({state:"visible"});
  assert.match(await page.locator("#modal-body").textContent(),/Opening settings/,"slow settings must acknowledge the click immediately");
  releaseHomes();
  await page.getByRole("link", { name: "Export household" }).waitFor();
  assert.equal(await page.locator("#modal").getAttribute("aria-labelledby"),"modal-title","open dialogs must be labelled by their visible heading");
  assert.equal(await page.locator("#modal-title").textContent(),"Household settings");
  assert.ok(await page.locator("#modal").evaluate(el=>{
    const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
  }),"settings dialog must stay inside the viewport");
  await page.unroute("**/api/homes");
  const inlineSettings=await page.locator("#rename-home-form").evaluate(form=>{
    const input=form.querySelector("input").getBoundingClientRect();
    const button=form.querySelector('button[type="submit"]').getBoundingClientRect();
    return Math.abs(input.bottom-button.bottom)<6 && input.right<button.left;
  });
  assert.equal(inlineSettings,true,"name save button must sit beside its input");
  const inlineInvitation=await page.locator("#invite-home-form").evaluate(form=>{
    const role=form.querySelector("select").getBoundingClientRect();
    const button=form.querySelector('button[type="submit"]').getBoundingClientRect();
    return Math.abs(role.bottom-button.bottom)<6 && role.right<button.left;
  });
  assert.equal(inlineInvitation,true,"invite action must sit beside the access selector");
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
  const placement=async(searchSelector,actionSelector)=>{
    const search=await page.locator(searchSelector).boundingBox();
    const action=await page.locator(actionSelector).boundingBox();
    return Boolean(search&&action&&Math.abs((search.y+search.height/2)-(action.y+action.height/2))<22&&action.x>search.x+search.width);
  };
  assert.equal(await placement(".register-tools .search-toggle","#new-issue"),true,"issue search control and main action must share a row");
  assert.equal(await page.locator("#record-search").isVisible(),false,"search must remain hidden until requested");
  await page.keyboard.press("/");
  assert.equal(await page.locator("#record-search").isVisible(),true,"slash opens direct search");
  assert.equal(await page.locator("#record-search").evaluate(el=>document.activeElement===el),true,"slash focuses local search");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#record-search").isVisible(),false,"Escape hides local search");
  await page.locator(".search-toggle").click();
  assert.equal(await page.locator(".ledger-toolbar,.ledger-columns,.ledger-index").count(),0,"records must not have table headings, indexes or second toolbars");
  assert.equal(await page.locator(".ledger-rows [role=listitem]").count(),await page.locator(".ledger-entry").count(),"records should be represented as a simple list");
  const total = await page.locator(".ledger-entry").count();
  assert.ok(await page.locator(".ledger-entry .ledger-details").first().evaluate(details=>{
    const row=details.closest(".ledger-entry").getBoundingClientRect(),rect=details.getBoundingClientRect();
    return rect.right>=row.right-36 && rect.left>row.left+row.width*.46;
  }),"record status aligns to the trailing edge rather than a middle column");
  assert.equal(await page.locator(".ledger").evaluate(el => getComputedStyle(el).borderTopWidth),"0px","registers should not be boxed in");
  await page.locator('[data-status="resolved"]').click();
  assert.ok(await page.locator(".ledger-entry:visible").count() < total);
  await page.locator('[data-status="all"]').click();
  await page.locator("#record-search").fill("Camera 4");
  assert.equal(await page.locator(".ledger-entry:visible").count(), 1);
  // Automatic refresh retains view-local search and filter controls.
  const refreshedIssues=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/issues"&&response.request().method()==="GET");
  await page.evaluate(()=>{
    document.activeElement?.blur();
    const original=Date.now;
    Date.now=()=>original()+90_000;
    window.dispatchEvent(new Event("focus"));
    Date.now=original;
  });
  await refreshedIssues;
  await page.waitForFunction(()=>document.querySelector("#record-search")?.value==="Camera 4" &&
    document.querySelector(".quick-search .search-toggle")?.getAttribute("aria-expanded")==="true");
  const fetches = issueFetches;
  await go("appliances");
  assert.equal(await placement(".register-tools .search-toggle","#new-asset"),true,"asset search icon and action must share a row");
  assert.equal(await page.locator("#record-search").isVisible(),false,"asset search is collapsed by default");
  await page.locator(".search-toggle").click();
  assert.equal(await page.locator(".ledger-toolbar").count(),0,"asset register should not repeat the action header");
  await page.locator("#record-search").fill("inverter");
  assert.equal(await page.locator("#new-asset").count(),1,"search updates must retain the primary action");
  await page.locator("[data-asset]:visible").first().click();
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
  await page.reload();
  await page.locator("#record-search").waitFor({state:"attached"});
  assert.equal(issueFetches, fetches + 1);
  await page.locator("#new-issue").click();
  assert.equal(await page.locator("#modal").getAttribute("aria-labelledby"),"modal-title");
  assert.equal(await page.locator("#modal-title").textContent(),"Report a problem");
  const controls=await page.locator('#issue-form .field input,#issue-form .field select').evaluateAll(elements=>
    elements.map(el=>({height:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize)}))
  );
  assert.ok(controls.every(el=>el.height>=40&&el.font>=13),"record forms share readable input dimensions");
  await page.locator('#issue-form select[name="assetId"]').selectOption("asset-tap");
  await page.locator('#issue-form input[name="title"]').fill("Browser transaction issue");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Approve & commit" }).click();
  await page.locator("[data-issue-open]").filter({ hasText: "Browser transaction issue" }).waitFor();

  await go("repairs");
  assert.equal(await placement(".register-tools .search-toggle","#new-repair"),true,"repair search icon and action must share a row");
  await page.locator("#new-repair").click();
  await page.locator('#repair-form select[name="assetId"]').selectOption("asset-tap");
  await page.locator('#repair-form input[name="title"]').fill("Browser repair record");
  await page.locator('#repair-form input[name="cost"]').fill("250");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Approve & commit" }).click();
  await page.locator("[data-repair-open]").filter({ hasText: "Browser repair record" }).click();
  await page.getByRole("heading", { name: "Work performed", exact: true }).waitFor();
  await page.locator("#modal-close").click();
  await go("home");
  await page.locator("[data-home-repair]").first().click();
  await page.locator("#repair-attach").waitFor();
  await page.locator("#modal-close").click();
  await go("repairs");
  await page.locator(".search-toggle").click();
  await page.locator("#record-search").fill("no-such-repair-xyz");
  await page.getByText("No matching records", { exact: true }).waitFor();
  await page.locator("#record-search").fill("");

  await go("files");
  assert.ok(await page.locator(".file-grid").evaluate(grid=>{
    const box=grid.getBoundingClientRect(),view=document.querySelector(".workspace").getBoundingClientRect();
    return box.width<=1088 && Math.abs((box.left+box.right)/2-(view.left+view.right)/2)<24;
  }),"file records follow the same centered content alignment");
  assert.equal(await placement(".file-controls .search-toggle","#upload-file"),true,"file search icon and upload must share a row");
  assert.equal(await page.locator(".file-browser .ledger-toolbar,.file-inspector>.ledger-overline").count(),0,"file browser needs no secondary labels");
  assert.equal(await page.locator(".file-grid").evaluate(el=>getComputedStyle(el).display),"grid","files should use an actual thumbnail grid");
  assert.ok(await page.locator(".file-card").first().evaluate(el=>{
    const r=el.getBoundingClientRect(),preview=el.querySelector(".file-preview").getBoundingClientRect();
    return r.height>=140&&r.height<=360&&preview.height>=80&&preview.width>=150;
  }),"file cards need useful preview space");
  const fileTileBoxes=await page.locator(".file-card").evaluateAll(rows=>rows.slice(0,2).map(el=>el.getBoundingClientRect().toJSON()));
  if(fileTileBoxes.length>1)assert.ok(Math.abs(fileTileBoxes[1].y-fileTileBoxes[0].y)<4,"desktop preview cards should share a row");
  assert.equal(await page.locator(".file-controls #save-link").count(),1,"save link stays beside file upload");
  assert.equal(await page.locator("#file-inspector,#file-info-toggle,#file-info-resizer").count(),0,"file metadata inspector must not consume workspace");
  assert.ok(await page.locator(".file-card").first().evaluate(el => {
    const rect=el.getBoundingClientRect(),css=getComputedStyle(el);
    return rect.height >= 140 && css.borderTopWidth==="1px" && css.borderBottomWidth==="1px";
  }),"file previews must retain complete selection borders");
  await noOverflow();
  let releaseRepairOptions;
  const repairOptions=new Promise(resolve=>{releaseRepairOptions=resolve});
  await page.route("**/api/repairs",async route=>{await repairOptions;await route.continue()});
  await page.locator("#upload-file").click();
  await page.locator("#modal").waitFor({state:"visible"});
  assert.match(await page.locator("#modal-body").textContent(),/Preparing file options/,"upload action must respond before metadata loads");
  releaseRepairOptions();
  await page.locator('#link-evidence-form input[name="attachment"]').waitFor();
  await page.unroute("**/api/repairs");
  await page.locator("#modal-close").click();
  // Uploaded bytes must reach the same preview/reject flow as linked evidence.
  await page.locator("#upload-file").click();
  await page.locator('#link-evidence-form input[name="attachment"]').waitFor();
  await page.locator('#link-evidence-form input[name="attachment"]').setInputFiles({
    name:"normalization-check.txt",mimeType:"text/plain",
    buffer:Buffer.from("Verify the normalized file-upload approval path.")
  });
  await page.locator('#link-evidence-form button.primary-button').click();
  await page.locator("#commit-preview").waitFor({state:"visible"});
  await page.locator("#reject-preview").click();
  await page.locator("#modal").waitFor({state:"hidden"});
  // Closing an upload while its first chunk is held must abort further work.
  let releaseChunk,chunkStartedResolve,finishRequests=0;
  const chunkStarted=new Promise(resolve=>{chunkStartedResolve=resolve});
  const holdChunk=new Promise(resolve=>{releaseChunk=resolve});
  await page.route("**/api/uploads/*/finish",async route=>{finishRequests++;await route.continue()});
  await page.route("**/api/uploads/*/chunks/*",async route=>{
    chunkStartedResolve();await holdChunk;
    try{await route.continue()}catch(_){}
  });
  await page.locator("#upload-file").click();
  await page.locator('#link-evidence-form input[name="attachment"]').waitFor();
  assert.equal(await page.locator('label[for="homely-attachment"]').count(),1,"upload chooser is labelled");
  await page.locator('#link-evidence-form input[name="attachment"]').setInputFiles({
    name:"cancelled-upload.txt",mimeType:"text/plain",buffer:Buffer.from("Cancelled upload transfer.")
  });
  await page.locator('#link-evidence-form button.primary-button').click();
  await chunkStarted;
  await page.locator("#modal-close").click();
  releaseChunk();
  await page.waitForTimeout(120);
  assert.equal(finishRequests,0,"discarded uploads must not finish");
  await page.unroute("**/api/uploads/*/chunks/*");
  await page.unroute("**/api/uploads/*/finish");
  await page.locator("#save-link").click();
  await page.locator('#link-evidence-form input[name="sourceUrl"]').waitFor();
  await page.locator("#modal-close").click();
  // One click selects; a double click opens the viewer before a delayed response.
  let releaseText;
  const heldText=new Promise(resolve=>{releaseText=resolve});
  await page.route("**/demo-documents/inverter-warranty.txt",async route=>{await heldText;await route.continue()});
  await page.locator(".file-card").filter({hasText:"Sunsynk 8 kW inverter warranty"}).click();
  assert.equal(await page.locator("#viewer").isVisible(),false,"single click selects without opening");
  assert.equal(await page.locator(".file-card").filter({hasText:"Sunsynk 8 kW inverter warranty"}).getAttribute("aria-pressed"),"true");
  await page.locator(".file-card").filter({hasText:"Sunsynk 8 kW inverter warranty"}).dblclick();
  await page.locator("#viewer").waitFor({state:"visible"});
  await page.getByText("Opening file…",{exact:true}).waitFor();
  releaseText();
  await page.locator("#viewer-body .viewer-text").waitFor();
  assert.equal(await page.locator(".viewer-head").evaluate(el=>Math.round(el.getBoundingClientRect().height)),60,"file preview header uses the shared compact toolbar");
  assert.match(await page.locator("#viewer-body .viewer-text").textContent(),/20 January 2030/);
  await page.locator("#viewer-close").click();
  await page.unroute("**/demo-documents/inverter-warranty.txt");
  await page.locator(".search-toggle").click();
  await page.locator("#file-search").fill("no-such-file-xyz");
  await page.getByText("No matching files", { exact: true }).waitFor();
  assert.equal(await page.locator("#file-inspector").count(), 0, "file list should not recreate metadata inspector");
  assert.equal(await page.locator('.file-card[aria-pressed="true"]').count(), 0);
  await page.locator("#file-search").fill("");
  await page.locator(".file-card").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#viewer").waitFor({ state: "visible" });
  await page.locator("#viewer-body .viewer-text").waitFor();
  await page.locator("#viewer-close").click();
  await go("home");
  await go("files");
  await go("home");
  assert.equal(await page.locator("#page-title").textContent(), "14 Hawthorn Residence", "cached home title");
  await page.locator("#view-charges,#view-charges-shortcut").click();
  await page.locator("#add-charge").click();
  await page.locator('#charge-form input[name="name"]').fill("Browser charge");
  await page.locator('#charge-form input[name="category"]').fill("UTILITIES");
  await page.locator('#charge-form input[name="amount"]').fill("100");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.locator("#action-review .message.assistant .markdown-body").first().waitFor();
  assert.equal(await page.locator("#action-review .message.assistant .markdown-body").count()>0,true,"action reviews use the shared Markdown message box");
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-charges,#view-charges-shortcut").click();
  await page.locator("[data-charge-edit]").first().click();
  await page.locator('#charge-form select[name="active"]').selectOption("0");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-charges,#view-charges-shortcut").click();
  await page.getByText("Inactive",{exact:true}).waitFor();
  await page.locator("#modal-close").click();
  await page.locator("#view-purchases,#view-purchases-shortcut").click();
  await page.locator("#add-purchase").click();
  assert.equal(await page.locator('#purchase-form select[name="status"]').count(),0,
    "new purchases start as Saved without an unnecessary status selector");
  await page.locator('#purchase-form input[name="title"]').fill("Browser purchase");
  await page.locator('#purchase-form input[name="category"]').fill("FURNITURE");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-purchases,#view-purchases-shortcut").click();
  await page.locator("[data-purchase-edit]").first().click();
  assert.deepEqual(await page.locator('#purchase-form select[name="status"] option').allTextContents(),
    ["Saved","Purchased","Dismissed"]);
  await page.locator('#purchase-form select[name="status"]').selectOption("PURCHASED");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-purchases,#view-purchases-shortcut").click();
  await page.locator("[data-purchase-edit]").first().click();
  assert.equal(await page.locator('#purchase-form select[name="status"]').inputValue(),"PURCHASED");
  await page.locator("#modal-close").click();
  await page.locator("#alerts-trigger").click();
  await page.locator("[data-alert-ack]").first().waitFor();
  const acknowledgedKey=await page.locator("[data-alert-ack]").first().getAttribute("data-alert-ack");
  await page.locator("[data-alert-ack]").first().click();
  await page.locator('[data-alert-ack="'+acknowledgedKey+'"]').waitFor({state:"hidden"});
  await page.locator("#modal-close").click();

  const videoBytes=Buffer.from(fs.readFileSync(new URL("./fixtures/video.webm.base64",import.meta.url),"utf8"),"base64");
  const upload=await (await page.request.post(base+"/api/uploads/start",{data:{name:"clip.webm",mimeType:"video/webm",size:videoBytes.length}})).json();
  assert.ok((await page.request.put(base+"/api/uploads/"+upload.id+"/chunks/0",{data:videoBytes,headers:{"content-type":"application/octet-stream"}})).ok());
  assert.ok((await page.request.post(base+"/api/uploads/"+upload.id+"/finish")).ok());
  const proposal=await (await page.request.post(base+"/api/transactions/preview",{data:{actionType:"ATTACH_DOCUMENT",reason:"Browser video QA",payload:{title:"Video frame QA",documentType:"VIDEO",provider:"LOCAL",uploadId:upload.id}}})).json();
  assert.ok((await page.request.post(base+"/api/transactions/"+proposal.transaction.id+"/commit")).ok());
  await go("files");
  // Simulate returning to a tab after the automatic revalidation interval.
  await page.evaluate(()=>{
    const original=Date.now;
    Date.now=()=>original()+60000;
    window.dispatchEvent(new Event("focus"));
    Date.now=original;
  });
  await page.locator(".file-card").filter({hasText:"Video frame QA"}).waitFor();
  await page.locator(".file-card").filter({hasText:"Video frame QA"}).dblclick();
  await page.locator("#viewer").waitFor({state:"visible"});
  await page.locator("#viewer-body video").waitFor();
  let analysisRequests=0,releaseAnalysis;
  const analysisHeld=new Promise(resolve=>{releaseAnalysis=resolve});
  const formattedAnalysis="### Visible equipment\n\n**Inverter**\n\n- Check the cable\n\n[Receipt](https://example.com/receipt) [Unsafe](javascript:alert(1))\n\n<script>window.__analysisExecuted=true</script>";
  await page.route("**/api/documents/*/analyze",async route=>{
    const frames=route.request().postDataJSON().visualFrames;assert.equal(frames.length,3);
    assert.ok(frames.every(f=>f.image.startsWith("data:image/jpeg;base64,")&&f.timeSeconds>=0));
    analysisRequests++;
    if(analysisRequests===1)await analysisHeld;
    if(analysisRequests===3){await route.fulfill({status:503,json:{error:"**Analysis unavailable**\n\nTry again."}});return}
    await route.fulfill({json:{text:formattedAnalysis,model:"test",cached:analysisRequests>1}});
  });
  await page.locator("#analyze-file").click();
  await page.locator("#viewer-insight .message.assistant.chat-pending").waitFor();
  assert.equal(await page.locator("#viewer-insight .chat-pending").getAttribute("role"),"status");
  releaseAnalysis();
  await page.locator("#viewer-insight h3").filter({hasText:"Visible equipment"}).waitFor();
  assert.equal(await page.locator("#viewer-insight .markdown-body strong").textContent(),"Inverter");
  assert.equal(await page.locator("#viewer-insight .markdown-body ul li").textContent(),"Check the cable");
  assert.equal(await page.locator('#viewer-insight script,#viewer-insight a[href^="javascript:"],#viewer-insight [onerror]').count(),0);
  assert.equal(await page.evaluate(()=>window.__analysisExecuted),undefined);
  assert.equal(await page.getByRole("link",{name:"Receipt",exact:true}).getAttribute("rel"),"noopener noreferrer");
  assert.notEqual(await page.locator("#viewer-insight .message.assistant").evaluate(el=>getComputedStyle(el).backgroundColor),"rgba(0, 0, 0, 0)","analysis must have a visible message box");
  if(process.env.TEST_SCREENSHOT_DIR)await page.screenshot({path:process.env.TEST_SCREENSHOT_DIR+"/analysis-markdown.png"});
  await page.locator("#analyze-file").click();
  await page.locator("#viewer-insight h3").filter({hasText:"Visible equipment"}).waitFor();
  assert.equal(analysisRequests,2,"cached analyses use the same Markdown surface");
  await page.locator("#analyze-file").click();
  await page.locator("#viewer-insight .message-error strong").filter({hasText:"Analysis unavailable"}).waitFor();
  assert.equal(await page.locator("#viewer-insight .message-error").getAttribute("role"),"alert");
  assert.equal(await page.locator("#analyze-file").isEnabled(),true,"failed analysis permits a retry");
  await page.locator("#viewer-close").click();

  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await go("home"); await noOverflow();
    assert.equal(await page.locator(".metrics").evaluate(el=>{
      const view=document.querySelector(".workspace").getBoundingClientRect(),box=el.getBoundingClientRect();
      return Math.abs((box.left+box.right)/2-(view.left+view.right)/2)<12;
    }),true,"home metric alignment should survive resizing");
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
  await page.locator("#chat-body").getByText("Saved household chat",{exact:true}).waitFor();
  await page.getByRole("button", { name: "Dictate message", exact: true }).click();
  assert.equal(await page.locator("#chat-input").inputValue(), "check the kitchen tap");
  await page.getByRole("button", { name: "Stop listening", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__voiceAborts), 1);
  await page.locator("#chat-close").click();
  await page.locator("#chat-open").click();
  await page.locator("#chat-new").click();
  await page.locator("#chat-body").getByText("Saved household chat",{exact:true}).waitFor({state:"hidden"});
  await page.locator("#chat-conversations-toggle").click();
  await page.locator('#chat-history-list .chat-history-item[aria-current="false"]').first().click();
  await page.locator("#chat-body").getByText("Saved household chat",{exact:true}).waitFor();
  await page.locator("#chat-current-title").click();
  await page.locator(".chat-title-editor").fill("Kitchen tap inspection");
  await page.locator(".chat-title-editor").press("Enter");
  await page.locator("#chat-current-title").filter({hasText:"Kitchen tap inspection"}).waitFor();
  const renamedChats=await (await page.request.get(base+"/api/agent/conversations")).json();
  assert.ok(renamedChats.conversations.some(c=>c.title==="Kitchen tap inspection"),"renaming chat persists per household");
  await page.locator("#chat-close").click();

  const fresh = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  fresh.on("pageerror", error => errors.push(String(error)));
  await fresh.context().addCookies([{ name: "homely_test_view", value: "fresh", url: base }]);
  await fresh.goto(base);
  await fresh.getByRole("heading", { name: "No assets" }).waitFor();
  assert.equal(await fresh.locator(".home-empty").evaluate(el=>{
    const r=el.getBoundingClientRect();
    const view=document.querySelector(".workspace").getBoundingClientRect();
    return Math.abs((r.left+r.right)/2-(view.left+view.right)/2)<12;
  }),true,"empty Home must be centered");
  await fresh.getByRole("button", { name: "Register asset" }).click();
  await fresh.locator("#asset-form").waitFor(); await fresh.locator("#modal-close").click();
  for (const view of ["issues", "repairs", "appliances", "files"]) {
    await fresh.locator('[data-view="' + view + '"]').click();
    await fresh.locator(view === "files" ? ".files-empty" : ".ledger-zero").waitFor();
    if(view==="files"){
      assert.equal(await fresh.locator("#file-info-toggle").count(),0,"unused file inspector toggle must not exist");
      assert.equal(await fresh.locator("#file-inspector").count(),0,"unused file inspector must not exist");
    } else {
      assert.equal(await fresh.locator(".ledger-columns").isVisible(),false,"empty registers should not show useless column headings");
    }
  }
  // Long names must stay in their text column while every control remains usable.
  const names=await browser.newPage({viewport:{width:1366,height:768}});
  names.on("pageerror",error=>errors.push(String(error)));
  const longName="Household_receipt_"+"equipment_reference_".repeat(12)+"2026.pdf";
  let longDocument,zeroCostAssetId;
  await names.route("**/api/documents",async route=>{
    const response=await route.fetch(),docs=await response.json();
    longDocument={...docs[0],title:longName,mime_type:"text/plain",provider:"LOCAL",local_path:"/api/files/fade-test",web_view_link:null,source_url:null};
    docs[0]=longDocument;if(docs[1])docs[1]={...docs[1],title:"Receipt.txt"};
    await route.fulfill({response,json:docs});
  });
  await names.route("**/api/files/fade-test",route=>route.fulfill({body:"Receipt preview",contentType:"text/plain"}));
  await names.route("**/api/assets",async route=>{
    const response=await route.fetch(),assets=await response.json();
    assets[0]={...assets[0],name:longName.slice(0,180),condition:"UNKNOWN",purchase_cost_cents:null};
    if(assets[1]){zeroCostAssetId=assets[1].id;assets[1]={...assets[1],purchase_cost_cents:0};}
    await route.fulfill({response,json:assets});
  });
  await names.route("**/api/assets/*",async route=>{
    const response=await route.fetch(),asset=await response.json();
    await route.fulfill({response,json:{...asset,purchase_cost_cents:asset.id===zeroCostAssetId?0:asset.purchase_cost_cents,documents:[longDocument]}});
  });
  await names.goto(base);
  await names.locator('[data-view="files"]').click();
  const longTitle=names.locator(".file-card .fade-title").first();
  await names.locator(".file-card .fade-title.is-overflowing").first().waitFor();
  assert.equal(await longTitle.getAttribute("title"),longName,"full filename remains available");
  assert.notEqual(await longTitle.evaluate(el=>getComputedStyle(el).maskImage),"none","overflowing filenames fade");
  assert.equal(await names.locator(".file-card .fade-title").nth(1).evaluate(el=>getComputedStyle(el).maskImage),"none","short names stay fully visible");
  for(const width of [1366,390,320]){
    await names.setViewportSize({width,height:844});
    await names.locator(".file-card .fade-title.is-overflowing").first().waitFor();
    assert.equal(await names.locator(".file-card").first().evaluate(el=>{
      const title=el.querySelector(".fade-title").getBoundingClientRect(),box=el.getBoundingClientRect();
      return title.left>=box.left&&title.right<=box.right&&box.height>=140&&
        el.querySelector(".file-preview").getBoundingClientRect().height>=80;
    }),true,"long names stay inside visual file cards");
    await names.locator(".file-card").first().dblclick();
    await names.locator("#viewer-title.is-overflowing").waitFor();
    assert.equal(await names.locator(".viewer-head").evaluate(el=>{
      const title=el.querySelector("#viewer-title").getBoundingClientRect(),buttons=el.querySelector(".viewer-controls").getBoundingClientRect(),box=el.getBoundingClientRect();
      return title.right<=buttons.left&&buttons.right<=box.right;
    }),true,"viewer title must not push Analyze or Close offscreen");
    assert.equal(await names.locator("#analyze-file").isVisible(),true);
    await names.locator("#viewer-close").click();
    if(process.env.TEST_SCREENSHOT_DIR)await names.screenshot({path:process.env.TEST_SCREENSHOT_DIR+"/faded-names-"+width+".png"});
  }
  await names.setViewportSize({width:1366,height:768});
  await names.locator('[data-view="appliances"]').click();
  await names.locator(".ledger-entry").first().waitFor();
  assert.equal(await names.locator(".ledger-entry .ledger-details .badge.operational").first().count(),1,"every appliance shows one actionable operational label");
  await names.locator("[data-asset]").first().click();
  await names.locator("#modal .row-title.is-overflowing").waitFor();
  assert.equal(await names.locator("#modal .row").filter({has:names.locator(".fade-title")}).first().evaluate(el=>{
    return el.querySelector(".fade-title").getBoundingClientRect().right<=el.querySelector(".row-actions").getBoundingClientRect().left;
  }),true,"attached filenames leave room for Open");
  await names.locator("#modal [data-file]").click();
  await names.locator("#viewer-body .viewer-text").waitFor();
  await names.locator("#viewer-close").click();await names.locator("#modal-close").click();
  await names.locator("[data-asset]").nth(1).click();
  assert.match(await names.locator("#modal .detail").filter({hasText:"Purchase price"}).locator("strong").first().textContent(),/R\s*0/,"zero purchase price remains accessible in record details");
  await names.locator("#modal-close").click();
  assert.equal(await names.locator(".ledger-entry").first().evaluate(el=>getComputedStyle(el).borderTopWidth),"1px","entries have visible borders");
  await names.close();
  // Render saved and new replies using provider-free Markdown fixtures.
  const markdown = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  markdown.on("pageerror", error => errors.push(String(error)));
  await markdown.addInitScript(() => {
    Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{window.__copiedCode=text}}});
  });
  const formattedReply = [
    "## Kitchen check", "", "Check **pressure** and *flow*. Use `safe_mode`.", "",
    "- Inspect the filter", "  - Keep the washer", "- [x] Record the reading", "",
    "1. Close the valve", "2. Test again", "", "> Keep the receipt.", "",
    "| Item | Price | Condition | Next step |", "| --- | ---: | --- | --- |",
    "| Filter | R250 | Good | Inspect |", "",
    "```javascript", 'const sample = "<script>literal code</script>";', "x".repeat(180), "```", "",
    "[Supplier](https://example.com/products) and https://example.com/help", "",
    "[Unsafe](javascript:alert(1)) [Encoded](jav&#x61;script:alert(1)) [Data](data:text/html,test)", "",
    '<script>window.__markdownExecuted=true</script><img src=x onerror="window.__markdownExecuted=true">', "",
    '<svg onload="window.__markdownExecuted=true"></svg>', "",
    "![Image reference](https://example.invalid/tracking.png)"
  ].join("\n");
  await markdown.route("**/api/integrations/status",async route=>{
    const response=await route.fetch(),data=await response.json();data.ai.available=true;await route.fulfill({response,json:data});
  });
  await markdown.route("**/api/agent/history**",route=>route.fulfill({json:{messages:[
    {role:"user",text:"**Format my message**",proposals:[]},
    {role:"assistant",text:formattedReply,proposals:[]}
  ],previousResponseId:null}}));
  await markdown.route("**/api/agent/respond",route=>route.fulfill({json:{text:"### New reply\n\n**Ready** to review.",responseId:"markdown-response",proposals:[{
    transactionId:"markdown-proposal",reason:"User requested a **record**",preview:{title:"Review proposed change",summary:"A proposal still requires **approval**",effects:["Keep **history**","Review the [receipt](https://example.com/receipt)"]}
  }]}}));
  await markdown.goto(base);
  await markdown.locator(".markdown-body h2").filter({hasText:"Kitchen check"}).waitFor();
  assert.equal(await markdown.locator(".message.user .markdown-body strong").textContent(),"Format my message");
  for(const role of ["user","assistant"]){
    assert.notEqual(await markdown.locator(".message."+role).first().evaluate(el=>getComputedStyle(el).backgroundColor),"rgba(0, 0, 0, 0)",role+" interactions must have visible bubbles");
    assert.ok(await markdown.locator(".message."+role).first().evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius))>0);
  }
  assert.ok(await markdown.locator(".markdown-body strong").count()>0);
  assert.ok(await markdown.locator(".markdown-body ul ul").count()>0);
  assert.ok(await markdown.locator(".markdown-body ol").count()>0);
  assert.equal(await markdown.locator('.markdown-body input[type="checkbox"]').isDisabled(),true);
  assert.equal(await markdown.locator(".markdown-table table").count(),1);
  assert.equal(await markdown.locator(".markdown-code pre code").textContent(), 'const sample = "<script>literal code</script>";\n'+"x".repeat(180)+"\n");
  await markdown.getByRole("button",{name:"Copy code",exact:true}).click();
  assert.ok((await markdown.evaluate(()=>window.__copiedCode)).includes("literal code"));
  const supplier=markdown.getByRole("link",{name:"Supplier",exact:true});
  assert.equal(await supplier.getAttribute("target"),"_blank");
  assert.equal(await supplier.getAttribute("rel"),"noopener noreferrer");
  assert.equal(await markdown.locator('.markdown-body a[href^="javascript:"],.markdown-body a[href^="data:"]').count(),0);
  assert.equal(await markdown.locator(".markdown-body script,.markdown-body img,.markdown-body svg,.markdown-body iframe,.markdown-body [onerror]").count(),0);
  assert.equal(await markdown.evaluate(()=>window.__markdownExecuted),undefined);
  await markdown.locator("#assistant-resizer").focus();await markdown.keyboard.press("Home");
  const desktopOverflow=await markdown.evaluate(()=>({
    window:innerWidth,doc:document.documentElement.scrollWidth,
    overflowing:[...document.querySelectorAll("body *")].map(el=>({selector:el.tagName.toLowerCase()+(el.id?"#"+el.id:"")+(el.className&&typeof el.className==="string"?"."+el.className.split(" ").slice(0,2).join("."):""),right:Math.round(el.getBoundingClientRect().right),left:Math.round(el.getBoundingClientRect().left),width:Math.round(el.scrollWidth)})).filter(x=>x.right>innerWidth+3).slice(0,10)
  }));
  if(desktopOverflow.doc>desktopOverflow.window+2)console.log("Markdown horizontal overflow diagnosis:",JSON.stringify(desktopOverflow));
  assert.equal(await markdown.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,"Markdown must fit narrow desktop pane");
  await markdown.locator("#chat-input").fill("Format this reply");
  await markdown.locator("#chat-input").press("Shift+Enter");
  assert.equal(await markdown.locator("#chat-input").inputValue(),"Format this reply\n","Shift+Enter inserts a newline");
  await markdown.locator("#chat-input").press("Enter");
  await markdown.locator(".markdown-body h3").filter({hasText:"New reply"}).waitFor();
  assert.equal(await markdown.locator("#chat-input").inputValue(),"","Enter submits without leaving extra text");
  assert.equal(await markdown.locator(".proposal .review-effects li strong").textContent(),"history","proposal effects render Markdown");
  assert.equal(await markdown.locator(".proposal .review-reason strong").textContent(),"record","proposal reasons render Markdown");
  if(process.env.TEST_SCREENSHOT_DIR)await markdown.screenshot({path:process.env.TEST_SCREENSHOT_DIR+"/chat-bubbles.png"});
  await markdown.keyboard.press("Control+Shift+Space");
  assert.equal(await markdown.locator("#chat-rail").getAttribute("aria-hidden"),"true","Ctrl+Shift+Space toggles chat closed from input");
  await markdown.keyboard.press("Control+Shift+Space");
  assert.equal(await markdown.locator("#chat-rail").getAttribute("aria-hidden"),"false","Ctrl+Shift+Space reopens chat");
  assert.equal(await markdown.locator("#chat-input").evaluate(el=>document.activeElement===el),true,"keyboard shortcut focuses composer");
  assert.equal(await markdown.locator('[data-approve="markdown-proposal"]').count(),1,"Markdown must preserve proposal controls");
  for(const width of [390,320]){
    await markdown.setViewportSize({width,height:844});
    if(await markdown.locator("#chat-open").isVisible())await markdown.locator("#chat-open").click();
    assert.equal(await markdown.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,"Markdown must not overflow on mobile");
    assert.equal(await markdown.locator("#chat-rail").evaluate(el=>el.scrollWidth>el.clientWidth+2),false,"Code and tables must scroll within the panel");
  }
  // Exercise Android-like touch behavior separately from desktop mouse emulation.
  const mobileContext=await browser.newContext({
    viewport:{width:360,height:800},deviceScaleFactor:3,
    hasTouch:true,isMobile:true
  });
  const android=await mobileContext.newPage();
  android.on("pageerror",error=>errors.push("Android: "+String(error)));
  await android.goto(base);
  await android.locator(".metrics").waitFor();
  assert.equal(await android.locator("#household-settings").isVisible(),true,"Android must retain household settings");
  assert.equal(await android.locator("#sign-out").isVisible(),true,"Android must retain sign-out");
  assert.equal(await android.locator("#chat-open").isVisible(),true,"Android must expose assistant launcher");
  for(const id of ["household-settings","sign-out","modal-close"]){
    if(id==="modal-close")continue;
    const dimensions=await android.locator("#"+id).evaluate(el=>({
      width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height
    }));
    assert.ok(dimensions.width>=43&&dimensions.height>=43,id+" must be touch sized");
  }
  for(const width of [320,360,390,412,768,959]){
    await android.setViewportSize({width,height:800});
    const actual=await android.evaluate(()=>({
      window:innerWidth,page:document.documentElement.scrollWidth,
      settings:getComputedStyle(document.querySelector("#household-settings")).display,
      navItems:[...document.querySelectorAll(".nav-item")].filter(el=>el.getClientRects().length).length
    }));
    assert.equal(actual.page<=actual.window+2,true,"Android "+width+"px must not overflow horizontally");
    assert.notEqual(actual.settings,"none","Settings must not disappear at "+width+"px");
    assert.equal(actual.navItems,5,"All five navigation entries remain reachable at "+width+"px");
  }
  await android.setViewportSize({width:360,height:800});
  await android.locator('[data-view="issues"]').tap();
  await android.locator("#new-issue").tap();
  await android.locator("#issue-form").waitFor();
  const touchFont=await android.locator('#issue-form input[name="title"]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  assert.ok(touchFont>=16,"Android form fields must not trigger text auto-zoom");
  const modalCloseSize=await android.locator("#modal-close").evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(modalCloseSize>=43,"Android modal close must be touch sized");
  await android.locator("#modal-close").tap();
  await android.locator("#chat-open").tap();
  await android.locator("#chat-rail").waitFor({state:"visible"});
  assert.equal(await android.locator("#chat-rail").getAttribute("aria-hidden"),"false");
  const chatHeight=await android.locator("#chat-rail").evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(chatHeight<=800&&chatHeight>300,"Android chat must fit the visual viewport");
  await android.goBack();
  assert.equal(await android.locator("#chat-rail").getAttribute("aria-hidden"),"true","Android Back closes chat, not the view");
  assert.equal(new URL(android.url()).searchParams.get("view"),"issues","Back must preserve the current record view");
  await android.goForward();
  assert.equal(await android.locator("#chat-rail").getAttribute("aria-hidden"),"false","Android Forward can restore chat");
  await android.locator("#chat-close").tap();
  assert.equal(await android.locator("#chat-rail").getAttribute("aria-hidden"),"true");
  await android.waitForFunction(()=>!history.state?.homelyChat);
  await android.setViewportSize({width:960,height:800});
  await android.waitForFunction(()=>window.matchMedia("(min-width: 960px)").matches && document.querySelector("#chat-rail").getAttribute("aria-hidden")==="false");
  assert.equal(await android.locator("#chat-open").isVisible(),false,"Desktop view must not show Android floating launcher");
  assert.equal(await android.locator("#chat-rail").getAttribute("aria-hidden"),"false","Desktop retains docked chat");
  if(process.env.TEST_SCREENSHOT_DIR)await android.screenshot({path:process.env.TEST_SCREENSHOT_DIR+"/android-desktop-parity.png"});
  await mobileContext.close();
  // Slow AI approvals disable both action controls and issue one commit request.
  let commitRequests=0,releaseProposal;
  const holdProposal=new Promise(resolve=>releaseProposal=resolve);
  await markdown.route("**/api/transactions/markdown-proposal/commit",async route=>{
    commitRequests++;await holdProposal;await route.fulfill({json:{ok:true}});
  });
  await markdown.locator('[data-approve="markdown-proposal"]').click();
  assert.equal(await markdown.locator('[data-approve="markdown-proposal"]').isDisabled(),true);
  assert.equal(await markdown.locator('[data-reject="markdown-proposal"]').isDisabled(),true);
  releaseProposal();
  await markdown.getByText("Approved and committed.",{exact:true}).waitFor();
  assert.equal(commitRequests,1,"approval must issue one commit request");
  await markdown.unroute("**/api/transactions/markdown-proposal/commit");
  // The test link creates and opens a persistent private sample home.
  const sampleContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const sample=await sampleContext.newPage();
  sample.on("pageerror",error=>errors.push(String(error)));
  await sample.goto(base+"/?sample=1");
  await sample.locator("#page-title").filter({hasText:"Sample home"}).waitFor({state:"attached"});
  assert.equal(new URL(sample.url()).searchParams.has("sample"),false,"sample intent is consumed");
  const sampleHome=await sample.evaluate(async()=>await(await fetch("/api/homes")).json());
  assert.equal(sampleHome.homes.length,2,"existing home is retained");
  const sampleAssets=await sample.evaluate(async()=>await(await fetch("/api/assets")).json());
  assert.equal(sampleAssets.length,9);
  assert.ok(sampleAssets.every(a=>typeof a.operational_state==="string"));
  const overview=await sample.evaluate(async()=>await(await fetch("/api/overview")).json());
  assert.ok(overview.insights&&overview.insights.service,"Home reports computed insights from the selected household");
  assert.equal(overview.insights.service.out_of_service,1,"sample has one explicitly failed appliance");
  await sample.locator(".home-insights .insight-row").first().waitFor();
  assert.ok(await sample.locator(".home-insights .insight-row").count()>=2);
  await sample.locator('[data-insight-action="appliances"]').click();
  await sample.locator(".ledger-entry .badge.operational").first().waitFor();
  await sample.locator('[data-view="issues"]').click();
  await sample.locator(".ledger-entry .badge.IN_PROGRESS").first().waitFor();
  assert.equal(await sample.locator(".badge.IN_PROGRESS").first().textContent(),"In progress");
  assert.equal(await sample.locator(".ledger-entry .badge.IN_PROGRESS").count(),2,"Monitoring and In progress share one display stage");
  assert.equal(await sample.locator(".badge.CRITICAL").first().textContent(),"High","historical Critical renders as High");
  const priorities=await sample.locator(".ledger-entry .badge.priority").evaluateAll(nodes=>
    Object.fromEntries(nodes.map(el=>[el.classList[2],{label:el.textContent,tone:el.dataset.tone,color:getComputedStyle(el).color}])));
  assert.equal(priorities.LOW.label,"Low");
  assert.equal(priorities.LOW.tone,"neutral");
  assert.equal(priorities.MEDIUM.label,"Medium");
  assert.equal(priorities.MEDIUM.tone,"attention");
  assert.equal(priorities.HIGH.label,"High");
  assert.equal(priorities.HIGH.tone,"urgent");
  assert.equal(priorities.CRITICAL.label,"High");
  assert.equal(new Set([priorities.LOW.color,priorities.MEDIUM.color,priorities.HIGH.color]).size,3,"priority alone has three colors");
  await sample.locator("#new-issue").click();
  assert.deepEqual(await sample.locator('#issue-form select[name="severity"] option').allTextContents(),["Low","Medium","High"]);
  assert.equal(await sample.locator('#issue-form select[name="severity"]').inputValue(),"MEDIUM");
  await sample.locator("#modal-close").click();
  await sample.locator('[data-view="appliances"]').click();
  await sample.locator(".ledger-entry .badge.operational").first().waitFor();
  const states=await sample.locator(".ledger-entry .badge.operational").evaluateAll(nodes=>
    [...new Set(nodes.map(el=>el.textContent))].sort());
  assert.deepEqual(states,["Needs attention","Not assessed","Out of service","Working"]);
  const stateStyles=await sample.locator(".ledger-entry .badge.operational").evaluateAll(nodes=>
    Object.fromEntries(nodes.map(el=>[el.textContent,{tone:el.dataset.tone,color:getComputedStyle(el).color,
      border:getComputedStyle(el).borderTopWidth,background:getComputedStyle(el).backgroundColor}])));
  assert.equal(stateStyles["Working"].tone,"positive");
  assert.equal(stateStyles["Needs attention"].tone,"attention");
  assert.equal(stateStyles["Out of service"].tone,"urgent");
  assert.equal(stateStyles["Not assessed"].tone,"neutral");
  assert.ok(Object.values(stateStyles).every(v=>v.border==="1px"&&v.background!=="rgba(0, 0, 0, 0)"),
    "every operational label has a visible border and light fill");
  await sample.locator("[data-asset]").filter({hasText:"Washing machine"}).first().click();
  await sample.locator(".hero-actions .badge").filter({hasText:"Out of service"}).waitFor();
  await sample.locator(".asset-facts").waitFor();
  assert.match(await sample.locator(".asset-assessment-note").textContent(),/recorded condition/);
  await sample.locator("#edit-asset").click();
  await sample.locator('#asset-form select[name="condition"]').waitFor();
  assert.deepEqual(await sample.locator('#asset-form select[name="condition"] option').allTextContents(),
    ["Not assessed","Working","Needs attention","Out of service"]);
  assert.equal(await sample.locator('#asset-form select[name="condition"]').inputValue(),"FAILED",
    "editing other asset details must preserve historical Failed without rewriting it");
  await sample.locator("#modal-close").click();
  if(process.env.TEST_SCREENSHOT_DIR)await sample.screenshot({path:process.env.TEST_SCREENSHOT_DIR+"/sample-states-mobile.png"});
  await sample.locator('[data-view="files"]').click();
  const thumbnail=sample.locator(".file-preview-video video").first();
  await thumbnail.waitFor();
  assert.match(await thumbnail.getAttribute("src"),/api\/files\//,"video thumbnail uses the protected local file");
  assert.equal(await thumbnail.getAttribute("preload"),"metadata","video preview must avoid eager full download");
  assert.equal(await sample.locator(".file-grid").evaluate(el=>getComputedStyle(el).display),"grid");
  const visibleTiles=await sample.locator(".file-card").evaluateAll(nodes=>nodes.slice(0,2).map(el=>el.getBoundingClientRect().toJSON()));
  assert.ok(visibleTiles.length<2||Math.abs(visibleTiles[0].y-visibleTiles[1].y)<4,"Android cards should fit two columns when space allows");
  const touchFile=sample.locator(".file-card").filter({hasText:"Washing machine warranty.txt"});
  await touchFile.waitFor();
  await touchFile.tap();
  assert.equal(await sample.locator("#viewer").isVisible(),false,"single tap selects only");
  assert.equal(await touchFile.getAttribute("aria-pressed"),"true");
  const selection=await touchFile.evaluate(el=>{
    const style=getComputedStyle(el),other=getComputedStyle(el.parentElement.querySelector('.file-card:not([aria-pressed="true"])'));
    return {top:style.borderTopWidth,bottom:style.borderBottomWidth,color:style.borderTopColor,other:other.borderTopColor};
  });
  assert.equal(selection.top,"1px");assert.equal(selection.bottom,"1px");
  assert.notEqual(selection.color,selection.other,"selection needs a visible fine border");
  await sample.waitForTimeout(500); // Start a fresh pair after the selection inspection.
  await touchFile.tap();await touchFile.tap();
  await sample.locator("#viewer-body .viewer-text").waitFor();
  assert.match(await sample.locator("#viewer-body").textContent(),/SAMPLE WARRANTY/);
  await sample.locator("#analyze-file").click();
  await sample.locator("#viewer-insight .message.assistant:not(.chat-pending)").waitFor();
  assert.match(await sample.locator("#viewer-insight").textContent(),/SAMPLE-WASHER/,"sample file analysis reads stored bytes");
  await sample.locator("#viewer-close").click();
  const sampleDocs=await sample.evaluate(async()=>await(await fetch("/api/documents")).json());
  assert.equal(sampleDocs.length,7);
  const imageDoc=sampleDocs.find(d=>d.mime_type==="image/svg+xml");
  assert.ok(imageDoc,"sample home contains a real image for visual preview testing");
  await sample.locator(".file-card").filter({hasText:"Reading corner reference"}).waitFor();
  const loadedImage=sample.locator(".file-card").filter({hasText:"Reading corner reference"}).locator(".file-preview-image");
  await loadedImage.waitFor();
  assert.equal(await loadedImage.evaluate(el=>el.complete&&el.naturalWidth>0),true,"real image thumbnails render from protected stored files");
  const videoDoc=sampleDocs.find(d=>d.mime_type==="video/webm");
  const sampleRange=await sample.request.get(base+videoDoc.local_path,{headers:{Range:"bytes=0-3"}});
  assert.equal(sampleRange.status(),206);assert.equal((await sampleRange.body()).toString("hex"),"1a45dfa3");
  if(process.env.TEST_SCREENSHOT_DIR)await sample.screenshot({path:process.env.TEST_SCREENSHOT_DIR+"/sample-files-mobile.png"});
  await sample.goto(base+"/?sample=1");
  await sample.locator("#page-title").filter({hasText:"Sample home"}).waitFor({state:"attached"});
  assert.equal(await sample.evaluate(async()=> (await(await fetch("/api/assets")).json()).length),9,"reopening does not duplicate samples");
  await sample.locator("#household-settings").click();
  await sample.locator('[data-switch="home-hawthorn"]').click();
  await sample.locator("#page-title").filter({hasText:"14 Hawthorn Residence"}).waitFor({state:"attached"});
  await sampleContext.close();
  assert.deepEqual(errors, [], "browser errors");
  console.log("Workspace browser checks passed: safe Markdown/history/replies/code copy, panel resizing/collapse/persistence, record commits, search/cache, related files, keyboard viewer, desktop/mobile, fresh home and voice.");
} finally { await browser.close(); }

