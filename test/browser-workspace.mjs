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
  await page.locator("#page-title").filter({ hasText: "14 Hawthorn Residence" }).waitFor({state:"attached"});
  assert.ok(await page.locator(".topbar").evaluate(el=>{const r=el.getBoundingClientRect();return r.width<=1&&r.height<=1}),"tab labels replace visible page headings");
  assert.equal(await page.locator("#refresh-view").count(),0,"manual refresh must not remain");
  assert.equal(await page.locator("#runtime-status").count(),0,"status ornament must not remain");
  assert.equal(await page.locator(".chat-head strong").count(),0,"assistant must not display a second header");
  assert.equal(await page.locator(".chat-rail").evaluate(el=>getComputedStyle(el).borderLeftWidth),"0px","assistant should not have a decorative divider");
  assert.equal(await page.locator("#chat-rail").getAttribute("aria-hidden"), "false", "desktop assistant must be docked");
  await page.getByText("Saved household chat",{exact:true}).waitFor();
  await noOverflow();
  // Visual hierarchy and sizing: navigation must be labeled and use a single top row.
  assert.equal(await page.locator(".nav-item .nav-label").first().isVisible(), true, "desktop tabs need visible text labels");
  assert.ok(await page.locator(".sidebar").evaluate(el => { const r=el.getBoundingClientRect(); return r.width > 1100 && r.height <= 72; }), "desktop navigation must fit a compact header");
  assert.ok(await page.locator(".metric").first().evaluate(el => el.getBoundingClientRect().height <= 125), "overview counters should not become oversized cards");
  assert.equal(await page.locator(".metrics").evaluate(el => getComputedStyle(el).borderTopWidth),"0px","overview metrics should have no enclosing border");
  assert.equal(await page.locator(".metric").first().evaluate(el => getComputedStyle(el).borderRightWidth),"0px","metrics should not be separated by visible dividers");
  assert.equal(await page.locator(".nav-item.active").evaluate(el => getComputedStyle(el).borderBottomWidth),"2px");
  assert.equal(await page.locator(".nav-item.active").evaluate(el => getComputedStyle(el).borderBottomColor), "rgba(0, 0, 0, 0)", "active navigation uses text emphasis rather than an accent line");
  const assistantWidth=()=>page.locator("#chat-rail").evaluate(el=>Math.round(el.getBoundingClientRect().width));
  const defaultWidth=await assistantWidth();
  const divider=page.locator("#assistant-resizer");
  const dividerBox=await divider.boundingBox();
  await page.mouse.move(dividerBox.x+dividerBox.width/2,dividerBox.y+180);
  await page.mouse.down();await page.mouse.move(dividerBox.x+dividerBox.width/2-100,dividerBox.y+180);await page.mouse.up();
  assert.equal(await assistantWidth(),defaultWidth+100,"drag must resize the assistant");
  await divider.focus();await page.keyboard.press("ArrowRight");
  assert.equal(await assistantWidth(),defaultWidth+80,"separator must support keyboard resizing");
  await page.reload();await page.locator("#home-repair").waitFor();
  assert.equal(await assistantWidth(),defaultWidth+80,"assistant width must survive reload");
  await page.locator("#assistant-collapse").click();
  assert.equal(await page.locator("#chat-rail").getAttribute("aria-hidden"),"true");
  assert.equal(await page.locator("#chat-rail").evaluate(el=>el.inert),true,"collapsed chat must not receive focus");
  assert.equal(await page.locator("#chat-trigger").evaluate(el=>el===document.activeElement),true);
  assert.ok(await page.locator(".workspace").evaluate(el=>el.getBoundingClientRect().width)>1300,"collapsed assistant must release its space");
  await page.reload();await page.locator("#home-repair").waitFor();
  assert.equal(await page.locator("#chat-rail").isVisible(),false,"collapsed layout must survive reload");
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator(".nav-item .nav-label").first().isVisible(), true, "mobile tabs retain labels");
  await noOverflow();
  await page.locator("#chat-open").click();
  assert.equal(await page.locator("#chat-rail").getAttribute("aria-hidden"),"false","mobile drawer must open even with desktop chat collapsed");
  await page.locator("#chat-close").click();
  await page.setViewportSize({width:1366,height:768});
  await page.locator("#chat-trigger").click();await divider.dblclick();
  assert.equal(await assistantWidth(),defaultWidth,"double-click must reset assistant width");
  await page.locator("#household-settings").click();
  await page.getByRole("link", { name: "Export household" }).waitFor();
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
  assert.equal(await placement("#record-search","#new-issue"),true,"issue search and main action must share a control row");
  assert.equal(await page.locator(".ledger-toolbar").count(),0,"records must not have a second toolbar band");
  const total = await page.locator(".ledger-entry").count();
  assert.equal(await page.locator(".ledger").evaluate(el => getComputedStyle(el).borderTopWidth),"0px","registers should not be boxed in");
  await page.locator('[data-status="resolved"]').click();
  assert.ok(await page.locator(".ledger-entry:visible").count() < total);
  await page.locator('[data-status="all"]').click();
  await page.locator("#record-search").fill("Camera 4");
  assert.equal(await page.locator(".ledger-entry:visible").count(), 1);
  const fetches = issueFetches;
  await go("appliances");
  assert.equal(await placement("#asset-search","#new-asset"),true,"asset search and main action must share a control row");
  assert.equal(await page.locator(".ledger-toolbar").count(),0,"asset register should not repeat the action header");
  await page.locator("#asset-search").fill("inverter");
  assert.equal(await page.locator("#new-asset").count(),1,"search updates must retain the primary action");
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
  await page.reload();
  await page.locator("#record-search").waitFor();
  assert.equal(issueFetches, fetches + 1);
  await page.locator("#new-issue").click();
  await page.locator('#issue-form select[name="assetId"]').selectOption("asset-tap");
  await page.locator('#issue-form input[name="title"]').fill("Browser transaction issue");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Approve & commit" }).click();
  await page.locator("[data-issue-open]").filter({ hasText: "Browser transaction issue" }).waitFor();

  await go("repairs");
  assert.equal(await placement("#record-search","#new-repair"),true,"repair search and action must share a control row");
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
  assert.equal(await placement("#file-search","#upload-file"),true,"file search and upload must share a control row");
  assert.equal(await page.locator(".file-browser .ledger-toolbar").count(),0,"file browser must not contain a duplicate toolbar");
  assert.equal(await page.locator(".file-controls #save-link").count(),1,"save link stays beside file upload");
  const infoDivider=page.locator("#file-info-resizer");
  const infoWidth=()=>page.locator("#file-inspector").evaluate(el=>Math.round(el.getBoundingClientRect().width));
  const originalInfoWidth=await infoWidth();
  assert.ok(await page.locator(".file-card").first().evaluate(el => el.getBoundingClientRect().height <= 115), "file items should be compact rather than oversized tiles");
  await infoDivider.focus();await page.keyboard.press("ArrowLeft");
  assert.equal(await infoWidth(),originalInfoWidth+20,"file information must resize independently");
  await page.locator("#file-info-toggle").click();
  assert.equal(await page.locator("#file-inspector").isVisible(),false);
  await go("home");await go("files");
  assert.equal(await page.locator("#file-inspector").isVisible(),false,"cached tabs must retain collapse state");
  await page.reload();await page.locator("#file-info-toggle").waitFor();
  assert.equal(await page.locator("#file-inspector").isVisible(),false,"rebuilt tabs must retain collapse state");
  await page.locator("#file-info-toggle").click();
  assert.equal(await infoWidth(),originalInfoWidth+20,"rebuilt file pane must retain width");
  await infoDivider.focus();await page.keyboard.press("Enter");
  assert.equal(await infoWidth(),originalInfoWidth);
  await noOverflow();
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
  await page.locator("#view-charges-shortcut").click();
  await page.locator("#add-charge").click();
  await page.locator('#charge-form input[name="name"]').fill("Browser charge");
  await page.locator('#charge-form input[name="category"]').fill("UTILITIES");
  await page.locator('#charge-form input[name="amount"]').fill("100");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-charges-shortcut").click();
  await page.locator("[data-charge-edit]").first().click();
  await page.locator('#charge-form select[name="active"]').selectOption("0");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-charges-shortcut").click();
  await page.getByText("INACTIVE",{exact:true}).waitFor();
  await page.locator("#modal-close").click();
  await page.locator("#view-purchases-shortcut").click();
  await page.locator("#add-purchase").click();
  await page.locator('#purchase-form input[name="title"]').fill("Browser purchase");
  await page.locator('#purchase-form input[name="category"]').fill("FURNITURE");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-purchases-shortcut").click();
  await page.locator("[data-purchase-edit]").first().click();
  await page.locator('#purchase-form select[name="status"]').selectOption("PURCHASED");
  await page.getByRole("button", {name:"Preview",exact:true}).click();
  await page.getByRole("button", {name:"Approve & commit"}).click();
  await page.locator("#modal").waitFor({state:"hidden"});
  await page.locator("#view-purchases-shortcut").click();
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
  await page.locator(".file-card").filter({hasText:"Video frame QA"}).click();
  await page.locator("#inspect-open").click();
  await page.route("**/api/documents/*/analyze",async route=>{
    const frames=route.request().postDataJSON().visualFrames;assert.equal(frames.length,3);
    assert.ok(frames.every(f=>f.image.startsWith("data:image/jpeg;base64,")&&f.timeSeconds>=0));
    await route.fulfill({json:{text:"Sampled frame summary.",model:"test",cached:false}});
  });
  await page.locator("#analyze-file").click();
  await page.getByText("Sampled frame summary.",{exact:true}).waitFor();
  await page.locator("#viewer-close").click();

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
  await page.getByText("Saved household chat",{exact:true}).waitFor();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  assert.equal(await page.locator("#chat-input").inputValue(), "check the kitchen tap");
  await page.getByRole("button", { name: "Stop listening", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__voiceAborts), 1);
  await page.locator("#chat-close").click();
  await page.locator("#chat-open").click();
  await page.locator("#clear-chat").click();
  await page.locator("#confirm-clear").click();
  await page.getByText("Saved household chat",{exact:true}).waitFor({state:"hidden"});
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
    if(view==="files"){
      assert.equal(await fresh.locator("#file-info-toggle").isVisible(),false,"unused file inspector toggle must disappear when no files exist");
      assert.equal(await fresh.locator("#file-inspector").isVisible(),false,"unused file inspector must disappear when no files exist");
    } else {
      assert.equal(await fresh.locator(".ledger-columns").isVisible(),false,"empty registers should not show useless column headings");
    }
  }
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
  await markdown.route("**/api/agent/history",route=>route.fulfill({json:{messages:[
    {role:"user",text:"**Keep my input literal**",proposals:[]},
    {role:"assistant",text:formattedReply,proposals:[]}
  ],previousResponseId:null}}));
  await markdown.route("**/api/agent/respond",route=>route.fulfill({json:{text:"### New reply\n\n**Ready** to review.",responseId:"markdown-response",proposals:[{
    transactionId:"markdown-proposal",reason:"User requested a record",preview:{title:"Review proposed change",summary:"A proposal still requires approval"}
  }]}}));
  await markdown.goto(base);
  await markdown.locator(".markdown-body h2").filter({hasText:"Kitchen check"}).waitFor();
  assert.equal(await markdown.locator(".message.user p").textContent(),"**Keep my input literal**");
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
  assert.equal(await markdown.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,"Markdown must fit narrow desktop pane");
  await markdown.locator("#chat-input").fill("Format this reply");
  await markdown.locator("#chat-input").press("Shift+Enter");
  assert.equal(await markdown.locator("#chat-input").inputValue(),"Format this reply\n","Shift+Enter inserts a newline");
  await markdown.locator("#chat-input").press("Enter");
  await markdown.locator(".markdown-body h3").filter({hasText:"New reply"}).waitFor();
  assert.equal(await markdown.locator("#chat-input").inputValue(),"","Enter submits without leaving extra text");
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
  assert.deepEqual(errors, [], "browser errors");
  console.log("Workspace browser checks passed: safe Markdown/history/replies/code copy, panel resizing/collapse/persistence, record commits, search/cache, related files, keyboard viewer, desktop/mobile, fresh home and voice.");
} finally { await browser.close(); }
