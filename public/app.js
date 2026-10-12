const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const content=$("#content"), pageTitle=$("#page-title"), nav=$("#nav");
const modal=$("#modal"), modalBody=$("#modal-body"), viewer=$("#viewer"), viewerBody=$("#viewer-body"), viewerTitle=$("#viewer-title");
const toast=$("#toast"), chatRail=$("#chat-rail"), chatBody=$("#chat-body"), chatForm=$("#chat-form"), chatInput=$("#chat-input"), voiceButton=$("#voice-button");
const runtime=$("#runtime-status"), runtimeText=$("#runtime-text"), agentState=$("#agent-state");
const state={view:"home",assets:[],agentMessages:[],previousResponseId:null,integrations:null,objectUrl:null,viewRevision:0,stopVoice:null};

function esc(v){return String(v==null?"":v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function fmtDate(v){return v?new Intl.DateTimeFormat("en-ZA",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(v)):"—"}
function assetAge(a){const value=a.acquired_at||a.purchase_date;if(!value)return"Unknown";const date=new Date(value),now=new Date();if(!Number.isFinite(date.getTime()))return"Unknown";let months=(now.getFullYear()-date.getFullYear())*12+now.getMonth()-date.getMonth();if(now.getDate()<date.getDate())months-=1;if(months<0)return"Not yet acquired";const years=Math.floor(months/12);return years?years+"y "+months%12+"m":months+"m"}
function money(c){return c==null?"—":new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR",maximumFractionDigits:0}).format(Number(c)/100)}
function today(){return new Date().toISOString().slice(0,10)}
$("#today").textContent=new Intl.DateTimeFormat("en-ZA",{day:"2-digit",month:"short",year:"numeric"}).format(new Date());

async function api(path,options){
  const init=Object.assign({},options||{});
  if(init.body&&typeof init.body!=="string"){init.headers=Object.assign({"content-type":"application/json"},init.headers||{});init.body=JSON.stringify(init.body)}
  const res=await fetch(path,init);let data=null;try{data=await res.json()}catch(_){}
  if(!res.ok)throw new Error(data&&data.error?data.error:"Request failed: "+res.status);
  return data
}
function notify(message){toast.textContent=message;toast.classList.add("show");setTimeout(function(){toast.classList.remove("show")},2400)}
function loading(label){content.innerHTML='<div class="loading">'+esc(label||"Loading home memory…")+"</div>"}
function fail(e){console.error(e);content.innerHTML='<div class="error">'+esc(e&&e.message?e.message:"Homely could not load this view.")+"</div>"}
function badge(v){return '<span class="badge '+esc(v||"")+'">'+esc(v||"UNKNOWN")+"</span>"}
function row(title,meta,right,note){return '<div class="row"><div><div class="row-title">'+esc(title)+'</div><div class="row-meta">'+esc(meta||"")+'</div>'+(note?'<div class="row-note">'+esc(note)+"</div>":"")+'</div><div class="row-actions">'+(right||"")+"</div></div>"}

function setRuntime(x){
  state.integrations=x;runtime.className="runtime-status";
  const ai=x&&x.ai;
  runtime.classList.add("good");runtimeText.textContent="Home memory active";
  agentState.textContent=ai&&ai.available?"Ready":"Chat unavailable";
  chatInput.disabled=!(ai&&ai.available);chatForm.querySelector('button[type="submit"]').disabled=!(ai&&ai.available);
  chatInput.placeholder=ai&&ai.available?"Ask Homely…":"Chat is not connected yet";

}
async function refreshStatus(){try{setRuntime(await api("/api/integrations/status"))}catch(_){runtime.classList.add("bad");runtimeText.textContent="Status unavailable"}}

function openModal(html){modalBody.innerHTML=html;$$(".field",modalBody).forEach(function(field,index){const label=$("label",field),input=$("input,select,textarea",field);if(label&&input){input.id=input.id||"record-field-"+index;label.htmlFor=input.id}});modal.showModal()}
function closeModal(){if(modal.open)modal.close();modalBody.innerHTML=""}
$("#modal-close").onclick=closeModal;
modal.addEventListener("cancel",function(e){e.preventDefault();closeModal()});

async function assetOptions(selected){
  if(!state.assets.length)state.assets=await api("/api/assets");
  return state.assets.map(function(a){return '<option value="'+esc(a.id)+'" '+(a.id===selected?"selected":"")+">"+esc(a.name)+" · "+esc(a.system_name)+"</option>"}).join("")
}

async function previewAction(actionType,payload,reason,requestText){
  const result=await api("/api/transactions/preview",{method:"POST",body:{actionType:actionType,payload:payload,reason:reason,requestText:requestText||null}});
  const p=result.preview,t=result.transaction;
  openModal('<p class="eyebrow">Approval required</p><h2>'+esc(p.title)+'</h2><div class="preview"><strong>'+esc(p.summary)+'</strong><ul>'+p.effects.map(function(x){return "<li>"+esc(x)+"</li>"}).join("")+'</ul></div><div class="form-actions"><button class="button" id="reject-preview">Reject</button><button class="primary-button" id="commit-preview">Approve & commit</button></div>');
  $("#reject-preview").onclick=async function(){await api("/api/transactions/"+encodeURIComponent(t.id)+"/reject",{method:"POST"});closeModal();notify("Proposal rejected. No state changed.")};
  $("#commit-preview").onclick=async function(){await api("/api/transactions/"+encodeURIComponent(t.id)+"/commit",{method:"POST"});closeModal();notify(actionType==="RECORD_REPAIR"?"Repair permanently recorded.":"Home memory updated.");await selectView(state.view)}
}

async function openIssueForm(){
  const options=await assetOptions("");
  openModal('<p class="eyebrow">New issue</p><h2>Report a problem</h2><form class="form" id="issue-form"><div class="form-grid"><div class="field full"><label>Asset</label><select name="assetId" required>'+options+'</select></div><div class="field"><label>Title</label><input name="title" maxlength="160" required></div><div class="field"><label>Severity</label><select name="severity"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></div><div class="field"><label>Detected</label><input type="date" name="detectedAt" value="'+today()+'" required></div><div class="field full"><label>Description</label><textarea name="description"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#issue-form").onsubmit=async function(e){e.preventDefault();const d=new FormData(e.currentTarget);await previewAction("REPORT_ISSUE",{assetId:d.get("assetId"),title:d.get("title"),severity:d.get("severity"),description:d.get("description"),detectedAt:d.get("detectedAt")},"Homeowner reported an issue through Homely.")}
}
function openResolveForm(issue){
  openModal('<p class="eyebrow">Resolve issue</p><h2>'+esc(issue.title)+'</h2><form class="form" id="resolve-form"><div class="form-grid"><div class="field"><label>Resolved</label><input type="date" name="resolvedAt" value="'+today()+'" required></div><div class="field full"><label>Resolution</label><textarea name="resolution" required placeholder="What fixed it?"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#resolve-form").onsubmit=async function(e){e.preventDefault();const d=new FormData(e.currentTarget);await previewAction("RESOLVE_ISSUE",{issueId:issue.id,resolvedAt:d.get("resolvedAt"),resolution:d.get("resolution")},"Homeowner marked the issue resolved.")}
}
async function openRepairForm(prefill){
  prefill=prefill||{};
  const options=await assetOptions(prefill.asset_id||"");
  const issues=await api("/api/issues");
  const issueOpts=['<option value="">No linked issue</option>'].concat(issues.map(function(i){return '<option value="'+esc(i.id)+'" '+(i.id===prefill.id?"selected":"")+">"+esc(i.title)+" · "+esc(i.asset_name)+"</option>"})).join("");
  const title=prefill.title?"Repair: "+prefill.title:"";
  openModal('<p class="eyebrow">Permanent repair history</p><h2>Record a repair</h2><form class="form" id="repair-form"><div class="form-grid"><div class="field full"><label>Asset</label><select name="assetId" required>'+options+'</select></div><div class="field full"><label>Linked issue</label><select name="issueId">'+issueOpts+'</select></div><div class="field full"><label>Repair title</label><input name="title" maxlength="180" required value="'+esc(title)+'"></div><div class="field"><label>Date</label><input type="date" name="repairDate" value="'+today()+'" required></div><div class="field"><label>Cost (ZAR)</label><input type="number" name="cost" min="0" step=".01" placeholder="0.00"></div><div class="field full"><label>Contractor / person</label><input name="contractor" maxlength="240"></div><div class="field full"><label>Work performed</label><textarea name="description"></textarea></div><div class="field full"><label>Outcome</label><textarea name="outcome" placeholder="What changed after the repair?"></textarea></div></div><div class="row-note">Repair records are permanent. Corrections are added as new history instead of deleting the original record.</div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#repair-form").onsubmit=async function(e){e.preventDefault();const d=new FormData(e.currentTarget),cost=String(d.get("cost")||"").trim();await previewAction("RECORD_REPAIR",{assetId:d.get("assetId"),issueId:d.get("issueId")||null,title:d.get("title"),repairDate:d.get("repairDate"),costCents:cost?Math.round(Number(cost)*100):null,contractor:d.get("contractor"),description:d.get("description"),outcome:d.get("outcome")},"Homeowner recorded completed repair work.")}
}

function openChargeForm(){
  openModal('<p class="eyebrow">Household costs</p><h2>Add recurring charge</h2><form class="form" id="charge-form"><div class="form-grid"><div class="field full"><label>Name</label><input name="name" maxlength="180" required placeholder="Home internet"></div><div class="field"><label>Category</label><input name="category" maxlength="80" required placeholder="UTILITIES"></div><div class="field"><label>Amount (ZAR)</label><input type="number" name="amount" min="0" step=".01" required></div><div class="field"><label>Billing cycle</label><select name="billingCycle"><option selected>MONTHLY</option><option>QUARTERLY</option><option>ANNUAL</option><option>OTHER</option></select></div><div class="field"><label>Due day</label><input type="number" name="dueDay" min="1" max="31" placeholder="15"></div><div class="field full"><label>Provider</label><input name="provider" maxlength="240"></div><div class="field full"><label>Notes</label><textarea name="notes"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#charge-form").onsubmit=async function(e){
    e.preventDefault();const d=new FormData(e.currentTarget),amount=String(d.get("amount")||"").trim(),due=String(d.get("dueDay")||"").trim();
    await previewAction("CREATE_CHARGE",{name:d.get("name"),category:d.get("category"),amountCents:Math.round(Number(amount)*100),billingCycle:d.get("billingCycle"),dueDay:due?Number(due):null,provider:d.get("provider"),notes:d.get("notes")},"Homeowner recorded a recurring household charge.");
  };
}

async function openPurchaseForm(){
  const options=await assetOptions("");
  const optionalAssets='<option value="">Not tied to an existing asset</option>'+options;
  openModal('<p class="eyebrow">Purchase memory</p><h2>Save potential purchase</h2><form class="form" id="purchase-form"><div class="form-grid"><div class="field full"><label>Title</label><input name="title" maxlength="220" required placeholder="Replacement washing machine"></div><div class="field"><label>Category</label><input name="category" maxlength="80" required placeholder="APPLIANCE"></div><div class="field"><label>Status</label><select name="status"><option selected>SAVED</option><option>SHORTLISTED</option></select></div><div class="field full"><label>Related asset</label><select name="assetId">'+optionalAssets+'</select></div><div class="field"><label>Budget (ZAR)</label><input type="number" name="budget" min="0" step=".01"></div><div class="field"><label>Expected cost (ZAR)</label><input type="number" name="expected" min="0" step=".01"></div><div class="field full"><label>Source name</label><input name="sourceName" maxlength="240" placeholder="Store or website"></div><div class="field full"><label>Source URL</label><input type="url" name="sourceUrl" maxlength="2000" placeholder="https://…"></div><div class="field full"><label>Why save it?</label><textarea name="rationale"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#purchase-form").onsubmit=async function(e){
    e.preventDefault();const d=new FormData(e.currentTarget),budget=String(d.get("budget")||"").trim(),expected=String(d.get("expected")||"").trim();
    await previewAction("SAVE_PURCHASE",{assetId:d.get("assetId")||null,title:d.get("title"),category:d.get("category"),status:d.get("status"),budgetCents:budget?Math.round(Number(budget)*100):null,expectedCostCents:expected?Math.round(Number(expected)*100):null,sourceUrl:d.get("sourceUrl"),sourceName:d.get("sourceName"),rationale:d.get("rationale")},"Homeowner saved a potential household purchase.");
  };
}

async function showHome(){
  loading();const revision=state.viewRevision;
  try{
    const d=await api("/api/overview");if(revision!==state.viewRevision)return;
    const memory=d.memory||{},repairs=memory.repairs||[],charges=memory.charges||[],purchases=memory.purchases||[];
    const attention=d.attention.issues.map(function(i){return row(i.title,i.asset_name,badge(i.severity))}).concat(d.attention.maintenance.map(function(m){return row(m.title,m.asset_name+" · "+m.days_overdue+" days overdue",badge("OVERDUE"))}));
    let html='<div class="home-overview"><div class="hero"><div><p class="eyebrow">Your home</p><h2>'+esc(d.home&&d.home.name||"Home")+'</h2></div><div class="hero-actions"><button class="button" id="home-issue">+ Issue</button><button class="primary-button" id="home-repair">+ Repair</button></div></div>';
    html+='<section class="metrics"><div class="metric"><span>Open issues</span><strong>'+d.summary.open_issues+'</strong></div><div class="metric"><span>Needs attention</span><strong>'+d.summary.systems_needing_attention+'</strong></div><div class="metric"><span>Overdue</span><strong>'+d.summary.overdue_maintenance+'</strong></div></section>';
    html+='<div class="home-priority"><section class="card"><div class="card-head"><h2>Needs attention</h2><button class="ghost-link" data-go="issues">All issues</button></div><div class="card-body rows">'+(attention.slice(0,3).join("")||'<div class="empty">Everything is in order.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Coming up</h2><span class="row-meta">Next 30 days</span></div><div class="card-body rows">'+(d.upcoming.slice(0,3).map(function(m){return row(m.title,m.asset_name+' · '+fmtDate(m.next_due_at),'<span class="badge">'+Number(m.days_until)+'d</span>')}).join("")||'<div class="empty">Nothing due.</div>')+'</div></section></div>';
    html+='<div class="home-memory"><section class="card"><div class="card-head"><h2>Recent repairs</h2><button class="ghost-link" data-go="repairs">All</button></div><div class="card-body rows">'+(repairs.slice(0,2).map(function(r){return row(r.title,fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+'</span>')}).join("")||'<div class="empty">No repairs yet.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Charges</h2><button class="ghost-link" id="view-charges">View all</button></div><div class="card-body rows">'+(charges.slice(0,2).map(function(c){return row(c.name,c.billing_cycle,'<span class="money">'+money(c.amount_cents)+'</span>')}).join("")||'<div class="empty">No charges yet.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Saved purchases</h2><button class="ghost-link" id="view-purchases">View all</button></div><div class="card-body rows">'+(purchases.slice(0,2).map(function(p){return row(p.title,p.status,'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+'</span>')}).join("")||'<div class="empty">No saved purchases.</div>')+'</div></section></div>';
    html+='<section class="memory-strip"><div><span class="eyebrow">Latest activity</span><div class="row-title">'+esc(d.recent[0]&&d.recent[0].title||"No activity yet")+'</div></div><button class="button" id="view-history">History</button></section></div>';
    content.innerHTML=html;$("#home-issue").onclick=openIssueForm;$("#home-repair").onclick=function(){openRepairForm()};$("#view-charges").onclick=showCharges;$("#view-purchases").onclick=showPurchases;$("#view-history").onclick=showHistory;
    $$("[data-go]",content).forEach(function(b){b.onclick=function(){navigate(b.dataset.go)}})
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

async function showCharges(){
  try{const items=await api("/api/charges");openModal('<div class="card-head"><h2>Recurring charges</h2><button class="button" id="add-charge">+ Charge</button></div><div class="rows">'+(items.map(function(c){return row(c.name,c.billing_cycle+" · "+(c.provider||c.category),'<span class="money">'+money(c.amount_cents)+'</span>',c.notes||"")}).join("")||'<div class="empty">No charges recorded.</div>')+'</div>');$("#add-charge").onclick=openChargeForm}catch(e){notify(e.message)}
}
async function showPurchases(){
  try{const items=await api("/api/purchases");openModal('<div class="card-head"><h2>Potential purchases</h2><button class="button" id="add-purchase">+ Save</button></div><div class="rows">'+(items.map(function(p){return row(p.title,p.category+" · "+p.status,'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+'</span>',p.rationale||"")}).join("")||'<div class="empty">No purchases saved.</div>')+'</div>');$("#add-purchase").onclick=function(){openPurchaseForm()}}catch(e){notify(e.message)}
}
async function showHistory(){
  try{
    const results=await Promise.all([api("/api/timeline"),api("/api/transactions")]);
    const permanent=["REPORT_ISSUE","RESOLVE_ISSUE","RECORD_REPAIR"];
    openModal('<h2>Home history</h2><div class="rows">'+results[0].map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")+'</div><div class="detail-section"><h3>Changes</h3><div class="rows">'+(results[1].map(function(t){return row(t.action_type.replaceAll("_"," "),fmtDate(t.created_at),badge(t.status)+(t.status==="COMMITTED"&&!permanent.includes(t.action_type)?'<button class="button" data-undo="'+esc(t.id)+'">Undo</button>':""),t.reason)}).join("")||'<div class="empty">No changes recorded.</div>')+'</div></div>');
    $$("[data-undo]",modalBody).forEach(function(b){b.onclick=async function(){b.disabled=true;try{await api("/api/transactions/"+encodeURIComponent(b.dataset.undo)+"/undo",{method:"POST"});closeModal();notify("Change undone.");await selectView(state.view)}catch(e){b.disabled=false;notify(e.message)}}});
  }catch(e){notify(e.message)}
}

async function showIssues(){
  loading();const revision=state.viewRevision;
  try{
    const items=await api("/api/issues");if(revision!==state.viewRevision)return;
    let body=items.map(function(i){const active=!["RESOLVED","CLOSED"].includes(i.status);return '<div class="row"><button class="row-open" data-issue-open="'+esc(i.id)+'"><div class="row-title">'+esc(i.title)+'</div><div class="row-meta">'+esc(i.asset_name)+" · detected "+fmtDate(i.detected_at)+'</div><div class="row-note">'+esc(i.description||"")+'</div></button><div class="row-actions">'+badge(i.severity)+badge(i.status)+(active?'<button class="button" data-repair="'+esc(i.id)+'">Repair</button><button class="button" data-resolve="'+esc(i.id)+'">Resolve</button>':"")+"</div></div>"}).join("");
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Problem register</p><h2>Issues</h2><p>Resolved history stays attached to the home.</p></div><div class="hero-actions"><button class="primary-button" id="new-issue">Report issue</button></div></div><section class="card"><div class="card-body rows">'+(body||'<div class="empty">No issues recorded.</div>')+"</div></section>";
    $("#new-issue").onclick=openIssueForm;
    $$("[data-resolve]").forEach(function(b){b.onclick=function(){openResolveForm(items.find(function(i){return i.id===b.dataset.resolve}))}});
    $$("[data-repair]").forEach(function(b){b.onclick=function(){openRepairForm(items.find(function(i){return i.id===b.dataset.repair}))}});
    $$("[data-issue-open]",content).forEach(function(b){b.onclick=function(){openIssue(items.find(function(i){return i.id===b.dataset.issueOpen}))}})
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

async function showRepairs(){
  loading();const revision=state.viewRevision;
  try{
    const items=await api("/api/repairs");if(revision!==state.viewRevision)return;
    const body=items.map(function(r){return '<div class="row"><button class="row-open" data-repair-open="'+esc(r.id)+'"><div class="row-title">'+esc(r.title)+'</div><div class="row-meta">'+esc(r.asset_name)+" · "+fmtDate(r.repair_date)+(r.contractor?" · "+esc(r.contractor):"")+'</div><div class="row-note">'+esc(r.outcome||r.description||"")+'</div></button><div class="row-actions"><span class="money">'+money(r.cost_cents)+"</span>"+(r.issue_title?'<span class="badge">ISSUE LINKED</span>':"")+"</div></div>"}).join("");
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Permanent history</p><h2>Repairs</h2><p>What was fixed, when, by whom and what it cost.</p></div><div class="hero-actions"><button class="primary-button" id="new-repair">Record repair</button></div></div><section class="card"><div class="card-body rows">'+(body||'<div class="empty">No repair records yet.</div>')+"</div></section>";
    $("#new-repair").onclick=function(){openRepairForm()};$$("[data-repair-open]",content).forEach(function(b){b.onclick=function(){openRepair(items.find(function(r){return r.id===b.dataset.repairOpen}))}})
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function evidenceMarkup(docs){return '<div class="detail-section"><h3>Files</h3><div class="rows">'+(docs.map(function(d){return row(d.title,d.type+" · "+fmtDate(d.occurred_at||d.created_at),'<button class="button" data-evidence="'+esc(d.id)+'">Open</button>',d.evidence_reason||"")}).join("")||'<div class="empty">No evidence attached.</div>')+'</div></div>'}
function bindEvidence(docs){$$("[data-evidence]",modalBody).forEach(function(b){b.onclick=function(){openFile(docs.find(function(d){return d.id===b.dataset.evidence}))}})}
async function openIssue(issue){
  if(!issue)return;
  try{const results=await Promise.all([api("/api/documents"),api("/api/assets/"+encodeURIComponent(issue.asset_id))]),docs=results[0].filter(function(d){return d.issue_id===issue.id}),history=(results[1].history||[]).filter(function(e){return e.issue_id===issue.id});
    openModal('<p class="eyebrow">Issue · '+esc(issue.asset_name)+'</p><h2>'+esc(issue.title)+'</h2><div class="hero-actions">'+badge(issue.status)+badge(issue.severity)+'</div><div class="detail-grid"><div class="detail"><span>Detected</span><strong>'+fmtDate(issue.detected_at)+'</strong></div><div class="detail"><span>Resolved</span><strong>'+fmtDate(issue.resolved_at)+'</strong></div></div><p>'+esc(issue.description||"No description recorded.")+'</p>'+(history.length?'<div class="detail-section"><h3>History</h3><div class="rows">'+history.map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")+'</div></div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="issue-asset">View asset</button>'+(!["RESOLVED","CLOSED"].includes(issue.status)?'<button class="button" id="issue-repair">Record repair</button><button class="primary-button" id="issue-resolve">Resolve</button>':"")+'</div>');
    bindEvidence(docs);$("#issue-asset").onclick=function(){openAsset(issue.asset_id)};if($("#issue-repair"))$("#issue-repair").onclick=function(){openRepairForm(issue)};if($("#issue-resolve"))$("#issue-resolve").onclick=function(){openResolveForm(issue)};
  }catch(e){notify(e.message)}
}
async function openRepair(repair){
  if(!repair)return;
  try{const docs=(await api("/api/documents")).filter(function(d){return d.repair_id===repair.id});
    openModal('<p class="eyebrow">Repair · '+esc(repair.asset_name)+'</p><h2>'+esc(repair.title)+'</h2><div class="detail-grid">'+[["Date",fmtDate(repair.repair_date)],["Cost",money(repair.cost_cents)],["Contractor",repair.contractor||"—"]].map(function(pair){return '<div class="detail"><span>'+esc(pair[0])+'</span><strong>'+esc(pair[1])+'</strong></div>'}).join("")+'</div><div class="detail-section"><h3>Work performed</h3><p>'+esc(repair.description||"No description recorded.")+'</p></div><div class="detail-section"><h3>Outcome</h3><p>'+esc(repair.outcome||"No outcome recorded.")+'</p></div>'+(repair.issue_title?'<div class="row-meta">Issue: '+esc(repair.issue_title)+'</div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="repair-asset">View asset</button></div>');bindEvidence(docs);$("#repair-asset").onclick=function(){openAsset(repair.asset_id)};
  }catch(e){notify(e.message)}
}

function renderAssets(items){
  $("#asset-results").innerHTML='<div class="table-wrap"><table><thead><tr><th>Asset</th><th>Condition</th><th>Health</th><th>System</th><th>Location</th><th>Purchase</th></tr></thead><tbody>'+items.map(function(a){return '<tr data-asset="'+esc(a.id)+'"><td><strong>'+esc(a.name)+'</strong><div class="row-meta">'+esc(a.manufacturer||"")+" "+esc(a.model||"")+'</div></td><td>'+badge(a.condition||"UNKNOWN")+"</td><td>"+badge(a.health)+"</td><td>"+esc(a.system_name)+"</td><td>"+esc(a.location||"—")+'</td><td>'+money(a.purchase_cost_cents)+"</td></tr>"}).join("")+"</tbody></table></div>";
  $$("[data-asset]",$("#asset-results")).forEach(function(r){r.onclick=function(){openAsset(r.dataset.asset)}})
}
async function showAppliances(){
  loading();const revision=state.viewRevision;
  try{
    state.assets=await api("/api/assets");if(revision!==state.viewRevision)return;
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Appliances & furniture</p><h2>Asset registry</h2><p>Condition, age, purchase information, faults, repairs and evidence.</p></div></div><div class="toolbar"><input class="search" id="asset-search" type="search" placeholder="Search assets, systems or rooms…"></div><div id="asset-results"></div>';
    renderAssets(state.assets);$("#asset-search").oninput=function(e){const q=e.target.value.toLowerCase().trim();renderAssets(state.assets.filter(function(a){return [a.name,a.system_name,a.location,a.manufacturer,a.model,a.category].some(function(v){return String(v||"").toLowerCase().includes(q)})}))}
  }catch(e){if(revision===state.viewRevision)fail(e)}
}
async function openAsset(id){
  try{
    const a=await api("/api/assets/"+encodeURIComponent(id));
    let html='<p class="eyebrow">'+esc(a.system_name)+'</p><h2>'+esc(a.name)+'</h2><div class="hero-actions">'+badge(a.condition||"UNKNOWN")+badge(a.health)+'</div><div class="detail-grid">';
    [["Location",a.location||"—"],["Purchased",fmtDate(a.purchase_date)],["Age",assetAge(a)],["Purchase price",money(a.purchase_cost_cents)],["Manufacturer",a.manufacturer||"—"],["Model",a.model||"—"],["Warranty end",fmtDate(a.warranty_end)]].forEach(function(v){html+='<div class="detail"><span>'+esc(v[0])+'</span><strong>'+esc(v[1])+"</strong></div>"});
    html+="</div>";if(a.notes)html+='<div class="detail-section"><h3>Notes</h3><div class="row-note">'+esc(a.notes)+"</div></div>";
    html+='<div class="detail-section"><h3>Issues</h3><div class="rows">'+(a.issues.map(function(i){return row(i.title,fmtDate(i.detected_at)+" · "+i.severity,badge(i.status),i.description||"")}).join("")||'<div class="empty">No issues.</div>')+"</div></div>";
    html+='<div class="detail-section"><h3>Repairs</h3><div class="rows">'+((a.repairs||[]).map(function(r){return row(r.title,fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+"</span>",r.outcome||"")}).join("")||'<div class="empty">No repairs.</div>')+"</div></div>";
    html+='<div class="detail-section"><h3>Files</h3><div class="rows">'+(a.documents.map(function(d){return row(d.title,d.type,'<button class="button" data-file="'+esc(d.id)+'">Open</button>')}).join("")||'<div class="empty">No files.</div>')+"</div></div>";
    openModal(html);$$("[data-file]",modalBody).forEach(function(b){b.onclick=async function(){const docs=await api("/api/documents"),doc=docs.find(function(d){return d.id===b.dataset.file});if(doc)openFile(doc)}})
  }catch(e){notify(e.message)}
}

function fileHref(d){const raw=String(d.web_view_link||d.local_path||d.source_url||"").trim();try{const url=new URL(raw,location.origin);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password?url.href:""}catch(_){return""}}
async function openFile(doc){
  if(state.stopVoice)state.stopVoice();
  const href=fileHref(doc);viewerTitle.textContent=doc.title||"File";viewerBody.innerHTML="";
  if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}
  if(!href){viewerBody.innerHTML='<div class="viewer-link"><div><strong>File metadata is recorded, but no viewable location is attached.</strong></div></div>';viewer.showModal();return}
  if(new URL(href).origin===location.origin){
    try{
      const res=await fetch(href);if(!res.ok)throw new Error("File unavailable");const blob=await res.blob();state.objectUrl=URL.createObjectURL(blob);const mt=doc.mime_type||blob.type||"";
      if(mt.startsWith("image/"))viewerBody.innerHTML='<img src="'+esc(state.objectUrl)+'" alt="">';
      else if(mt.startsWith("video/"))viewerBody.innerHTML='<video controls src="'+esc(state.objectUrl)+'"></video>';
      else if(mt.startsWith("audio/"))viewerBody.innerHTML='<audio controls src="'+esc(state.objectUrl)+'"></audio>';
      else viewerBody.innerHTML='<iframe sandbox title="'+esc(doc.title)+'" src="'+esc(state.objectUrl)+'"></iframe>'
    }catch(e){viewerBody.innerHTML='<div class="viewer-link"><div><strong>'+esc(e.message)+"</strong></div></div>"}
  }else if(doc.provider==="GOOGLE_DRIVE"&&doc.provider_file_id){viewerBody.innerHTML='<iframe title="'+esc(doc.title)+'" src="https://drive.google.com/file/d/'+encodeURIComponent(doc.provider_file_id)+'/preview" sandbox="allow-scripts allow-same-origin"></iframe>'}
  else if(String(doc.mime_type||"").startsWith("image/")){viewerBody.innerHTML='<img src="'+esc(href)+'" alt="'+esc(doc.title)+'">'}
  else if(String(doc.mime_type||"").startsWith("video/")){viewerBody.innerHTML='<video controls src="'+esc(href)+'"></video>'}
  else if(String(doc.mime_type||"").startsWith("audio/")){viewerBody.innerHTML='<audio controls src="'+esc(href)+'"></audio>'}
  else viewerBody.innerHTML='<div class="viewer-link"><div><strong>'+esc(doc.title)+'</strong><div class="row-meta">External file · '+esc(doc.provider||"source")+'</div><a class="primary-button" href="'+esc(href)+'" target="_blank" rel="noreferrer">Open source</a></div></div>';
  viewer.showModal()
}
$("#viewer-close").onclick=function(){viewer.close()};
viewer.addEventListener("close",function(){if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}});

async function openLinkEvidenceForm(){
  const results=await Promise.all([assetOptions(""),api("/api/issues"),api("/api/repairs"),api("/api/charges"),api("/api/purchases")]);
  const options=results[0],issues=results[1],repairs=results[2],charges=results[3],purchases=results[4];
  const optional=function(label,items,display){return '<option value="">'+esc(label)+'</option>'+items.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(display(x))+'</option>'}).join("")};
  const assetOptionsHtml='<option value="">No direct asset link</option>'+options;
  openModal('<p class="eyebrow">Link evidence</p><h2>Save a source link</h2><form class="form" id="link-evidence-form"><div class="form-grid"><div class="field full"><label>Source URL</label><input type="url" name="sourceUrl" maxlength="2000" placeholder="https://…" required></div><div class="field full"><label>Title</label><input name="title" maxlength="240" required placeholder="Product page, manual, receipt or reference"></div><div class="field"><label>Type</label><select name="documentType"><option>WARRANTY</option><option>MANUAL</option><option>INVOICE</option><option>RECEIPT</option><option>INSPECTION</option><option>PHOTO</option><option>VIDEO</option><option>REPORT</option><option selected>OTHER</option></select></div><div class="field"><label>Evidence date</label><input type="date" name="occurredAt" value="'+today()+'" required></div><div class="field"><label>Status</label><select name="evidenceStatus"><option selected>ACTIVE</option><option>REFERENCE</option><option>ARCHIVED</option></select></div><div class="field full"><label>Asset</label><select name="assetId">'+assetOptionsHtml+'</select></div><div class="field full"><label>Issue</label><select name="issueId">'+optional("No linked issue",issues,function(x){return x.title+" · "+x.asset_name})+'</select></div><div class="field full"><label>Repair</label><select name="repairId">'+optional("No linked repair",repairs,function(x){return x.title+" · "+x.asset_name})+'</select></div><div class="field full"><label>Recurring charge</label><select name="chargeId">'+optional("No linked charge",charges,function(x){return x.name+" · "+x.billing_cycle})+'</select></div><div class="field full"><label>Potential purchase</label><select name="purchaseCandidateId">'+optional("No linked purchase",purchases,function(x){return x.title+" · "+x.status})+'</select></div><div class="field full"><label>Provenance</label><input name="provenance" maxlength="1000" value="Saved directly by homeowner in Homely."></div><div class="field full"><label>Why keep this evidence?</label><textarea name="evidenceReason" maxlength="2000"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview evidence</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#link-evidence-form").onsubmit=async function(e){
    e.preventDefault();const d=new FormData(e.currentTarget),url=String(d.get("sourceUrl")||"").trim();
    await previewAction("ATTACH_DOCUMENT",{
      assetId:d.get("assetId")||null,
      issueId:d.get("issueId")||null,
      repairId:d.get("repairId")||null,
      chargeId:d.get("chargeId")||null,
      purchaseCandidateId:d.get("purchaseCandidateId")||null,
      title:d.get("title"),
      documentType:d.get("documentType"),
      provider:"LOCAL",
      providerFileId:null,
      mimeType:"text/uri-list",
      webViewLink:url,
      sourceUrl:url,
      provenance:d.get("provenance"),
      occurredAt:d.get("occurredAt"),
      evidenceReason:d.get("evidenceReason"),
      evidenceStatus:d.get("evidenceStatus")
    },"Homeowner saved this source link as household evidence.");
  };
}

async function openDriveImport(file){
  const results=await Promise.all([assetOptions(""),api("/api/issues"),api("/api/repairs"),api("/api/charges"),api("/api/purchases")]);
  const options=results[0],issues=results[1],repairs=results[2],charges=results[3],purchases=results[4];
  const optional=function(label,items,display){return '<option value="">'+esc(label)+'</option>'+items.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(display(x))+'</option>'}).join("")};
  const issueOptions=optional("No linked issue",issues,function(x){return x.title+" · "+x.asset_name});
  const repairOptions=optional("No linked repair",repairs,function(x){return x.title+" · "+x.asset_name});
  const chargeOptions=optional("No linked charge",charges,function(x){return x.name+" · "+x.billing_cycle});
  const purchaseOptions=optional("No linked purchase",purchases,function(x){return x.title+" · "+x.status});
  const assetOptionsHtml='<option value="">No direct asset link</option>'+options;
  openModal('<p class="eyebrow">Google Drive evidence</p><h2>Attach selected file</h2><div class="row-meta">'+esc(file.name)+' · '+esc(file.mimeType||"unknown type")+'</div><form class="form" id="drive-import-form"><div class="form-grid"><div class="field full"><label>Title</label><input name="title" maxlength="240" value="'+esc(file.name)+'" required></div><div class="field"><label>File type</label><select name="documentType"><option>WARRANTY</option><option>MANUAL</option><option>INVOICE</option><option>RECEIPT</option><option>INSPECTION</option><option>PHOTO</option><option>VIDEO</option><option>REPORT</option><option selected>OTHER</option></select></div><div class="field"><label>Evidence date</label><input type="date" name="occurredAt" value="'+today()+'" required></div><div class="field"><label>Status</label><select name="evidenceStatus"><option selected>ACTIVE</option><option>REFERENCE</option><option>ARCHIVED</option></select></div><div class="field full"><label>Asset</label><select name="assetId">'+assetOptionsHtml+'</select></div><div class="field full"><label>Issue</label><select name="issueId">'+issueOptions+'</select></div><div class="field full"><label>Repair</label><select name="repairId">'+repairOptions+'</select></div><div class="field full"><label>Recurring charge</label><select name="chargeId">'+chargeOptions+'</select></div><div class="field full"><label>Potential purchase</label><select name="purchaseCandidateId">'+purchaseOptions+'</select></div><div class="field full"><label>Provenance</label><input name="provenance" maxlength="1000" value="Selected by homeowner from Google Drive."></div><div class="field full"><label>Why keep this evidence?</label><textarea name="evidenceReason" maxlength="2000" placeholder="Warranty proof, repair invoice, before/after photo, product research…"></textarea></div><div class="field full"><label>Source URL</label><input type="url" name="sourceUrl" maxlength="2000" value="'+esc(file.webViewLink||"")+'"></div></div><div class="row-note">You can link the same evidence to an asset and the issue, repair, charge or purchase it explains.</div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview evidence</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#drive-import-form").onsubmit=async function(e){
    e.preventDefault();const d=new FormData(e.currentTarget);
    await previewAction("ATTACH_DOCUMENT",{
      assetId:d.get("assetId")||null,
      issueId:d.get("issueId")||null,
      repairId:d.get("repairId")||null,
      chargeId:d.get("chargeId")||null,
      purchaseCandidateId:d.get("purchaseCandidateId")||null,
      title:d.get("title"),
      documentType:d.get("documentType"),
      provider:"GOOGLE_DRIVE",
      providerFileId:file.id,
      mimeType:file.mimeType,
      webViewLink:file.webViewLink,
      sourceUrl:d.get("sourceUrl")||null,
      provenance:d.get("provenance"),
      occurredAt:d.get("occurredAt"),
      evidenceReason:d.get("evidenceReason"),
      evidenceStatus:d.get("evidenceStatus")
    },"Homeowner explicitly selected this file as household evidence.");
  };
}

async function showFiles(){
  loading();const revision=state.viewRevision;
  try{
    const both=await Promise.all([api("/api/documents"),api("/api/integrations/status")]),docs=both[0],integrations=both[1],drive=integrations.googleDrive;
    if(revision!==state.viewRevision)return;
    const driveControls=drive&&drive.enabled&&drive.configured?(drive.connected?'<button class="button" id="drive-select">Select from Drive</button><button class="button" id="drive-disconnect">Disconnect</button>':'<button class="button" id="drive-connect">Connect Drive</button>'):"";
    const driveActions='<button class="button" id="save-link">Save link</button>'+driveControls;
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Household evidence</p><h2>Files</h2><p>Receipts, manuals, photos, videos, invoices and source links with preserved context.</p></div><div class="hero-actions">'+driveActions+'</div></div><div class="toolbar"><input class="search" id="file-search" type="search" placeholder="Search files and associations…" aria-label="Search files"></div><div class="file-grid">'+(docs.map(function(d){const links=[d.asset_name,d.issue_title&&"Issue: "+d.issue_title,d.repair_title&&"Repair: "+d.repair_title,d.charge_name&&"Charge: "+d.charge_name,d.purchase_title&&"Purchase: "+d.purchase_title].filter(Boolean);return '<button class="file-card" data-file="'+esc(d.id)+'"><div class="file-type">'+esc(d.type||"FILE")+" · "+esc(d.evidence_status||"ACTIVE")+" · "+esc(d.provider||"")+'</div><strong>'+esc(d.title)+'</strong><small>'+esc((links.join(" · ")||"General home evidence")+" · "+fmtDate(d.occurred_at||d.created_at))+'</small>'+(d.evidence_reason?'<span class="file-reason">'+esc(d.evidence_reason)+'</span>':"")+'</button>'}).join("")||'<div class="empty">No files recorded.</div>')+"</div>";
    $("#file-search").oninput=function(e){const q=e.target.value.toLowerCase().trim();$$("[data-file]",content).forEach(function(card){card.hidden=!card.textContent.toLowerCase().includes(q)})};
    $("#save-link").onclick=function(){openLinkEvidenceForm()};
    if($("#drive-connect"))$("#drive-connect").onclick=function(){location.href="/api/google-drive/connect"};
    if($("#drive-select"))$("#drive-select").onclick=function(){location.href="/api/google-drive/connect"};
    if($("#drive-disconnect"))$("#drive-disconnect").onclick=async function(){await api("/api/google-drive/disconnect",{method:"POST"});notify("Google Drive disconnected. Existing file records were preserved.");await showFiles()};
    $$("[data-file]",content).forEach(function(b){b.onclick=function(){openFile(docs.find(function(d){return d.id===b.dataset.file}))}});
    const params=new URLSearchParams(location.search),driveError=params.get("driveError"),picked=params.get("drivePicked"),connected=params.get("driveConnected");
    if(driveError){history.replaceState({view:"files"},"","/?view=files");notify("Google Drive selection was cancelled or failed.")}
    else if(picked&&drive&&drive.connected){history.replaceState({view:"files"},"","/?view=files");const files=await api("/api/google-drive/files?ids="+encodeURIComponent(picked));if(files.length)await openDriveImport(files[0])}
    else if(connected){history.replaceState({view:"files"},"","/?view=files");notify("Google Drive connected. Select a file to attach it to Homely.")}
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function messageMarkup(m){
  return '<article class="message '+m.role+'"><div class="message-role">'+(m.role==="user"?"You":"Homely")+'</div><p>'+esc(m.text)+'</p>'+(m.proposals||[]).map(function(p){return '<div class="proposal"><strong>'+esc(p.preview.title)+'</strong><div class="row-meta">'+esc(p.preview.summary)+'</div><div class="row-note">'+esc(p.reason)+'</div>'+(p.status==="PROPOSED"?'<div class="proposal-actions"><button class="button" data-reject="'+esc(p.transactionId)+'">Reject</button><button class="primary-button" data-approve="'+esc(p.transactionId)+'">Approve</button></div>':'<div class="row-meta">'+esc(p.status)+"</div>")+"</div>"}).join("")+"</article>"
}
function renderChat(){
  chatBody.innerHTML=state.agentMessages.length?state.agentMessages.map(messageMarkup).join(""):'<div class="chat-empty">What needs attention?</div>';
  $$("[data-approve]",chatBody).forEach(function(b){b.onclick=async function(){try{await api("/api/transactions/"+encodeURIComponent(b.dataset.approve)+"/commit",{method:"POST"});state.agentMessages.forEach(function(m){const p=m.proposals&&m.proposals.find(function(x){return x.transactionId===b.dataset.approve});if(p)p.status="COMMITTED"});renderChat();notify("Approved and committed.");await selectView(state.view)}catch(e){notify(e.message)}}});
  $$("[data-reject]",chatBody).forEach(function(b){b.onclick=async function(){try{await api("/api/transactions/"+encodeURIComponent(b.dataset.reject)+"/reject",{method:"POST"});state.agentMessages.forEach(function(m){const p=m.proposals&&m.proposals.find(function(x){return x.transactionId===b.dataset.reject});if(p)p.status="REJECTED"});renderChat();notify("Proposal rejected.")}catch(e){notify(e.message)}}});
  chatBody.scrollTop=chatBody.scrollHeight
}
chatForm.onsubmit=async function(e){
  e.preventDefault();const message=chatInput.value.trim();if(!message)return;
  state.agentMessages.push({role:"user",text:message,proposals:[]});chatInput.value="";renderChat();const button=chatForm.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Working…";
  try{const r=await api("/api/agent/respond",{method:"POST",body:{message:message,previousResponseId:state.previousResponseId}});state.previousResponseId=r.responseId;state.agentMessages.push({role:"assistant",text:r.text,proposals:(r.proposals||[]).map(function(p){return Object.assign({},p,{status:"PROPOSED"})})})}
  catch(err){state.agentMessages.push({role:"assistant",text:err.message,proposals:[]})}
  finally{button.disabled=!(state.integrations&&state.integrations.ai&&state.integrations.ai.available);button.textContent="Send";renderChat()}
};

function setupVoiceInput(){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!voiceButton)return;
  if(!Recognition){voiceButton.hidden=true;return}
  const recognition=new Recognition();
  recognition.lang="en-ZA";
  recognition.interimResults=true;
  recognition.continuous=false;
  let prefix="",listening=false;
  function reset(){listening=false;voiceButton.classList.remove("listening");voiceButton.textContent="Voice"}
  state.stopVoice=function(){if(!listening)return;reset();if(recognition.abort)recognition.abort();else recognition.stop()};
  recognition.onstart=function(){if(!listening){recognition.abort();return}voiceButton.classList.add("listening");voiceButton.textContent="Stop listening"};
  recognition.onresult=function(event){
    if(!listening)return;
    let transcript="";for(let i=0;i<event.results.length;i++)transcript+=event.results[i][0].transcript;
    chatInput.value=(prefix?prefix+" ":"")+transcript.trim();chatInput.focus();
  };
  recognition.onerror=function(event){if(event.error!=="aborted")notify(event.error==="not-allowed"?"Microphone permission was denied.":"Voice input could not start.");reset()};
  recognition.onend=reset;
  voiceButton.onclick=function(){if(listening){state.stopVoice();return}prefix=chatInput.value.trim();listening=true;try{recognition.start()}catch(e){reset();notify("Voice input could not start.")}};
  window.addEventListener("pagehide",state.stopVoice);

}

const views={home:["Home",showHome],issues:["Issues",showIssues],repairs:["Repairs",showRepairs],appliances:["Appliances & furniture",showAppliances],files:["Files",showFiles]};
function normalizeView(v){if(v==="overview"||v==="history"||v==="agent")return"home";if(v==="work")return"issues";if(v==="assets")return"appliances";if(v==="documents")return"files";return views[v]?v:"home"}
async function selectView(view){state.viewRevision+=1;state.view=normalizeView(view);pageTitle.textContent=views[state.view][0];document.title=views[state.view][0]+" · Homely";$$(".nav-item").forEach(function(b){b.classList.toggle("active",b.dataset.view===state.view);if(b.dataset.view===state.view)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});await views[state.view][1]()}
function navigate(view,replace){view=normalizeView(view);const url=view==="home"?"/":"/?view="+encodeURIComponent(view);if(replace)history.replaceState({view:view},"",url);else history.pushState({view:view},"",url);void selectView(view)}
nav.onclick=function(e){const b=e.target.closest("[data-view]");if(b)navigate(b.dataset.view,false)};
window.onpopstate=function(){selectView(new URLSearchParams(location.search).get("view")||"home")};
$("#chat-open").onclick=function(){chatRail.classList.add("open")};$("#chat-close").onclick=function(){if(state.stopVoice)state.stopVoice();chatRail.classList.remove("open")};
const initial=normalizeView(new URLSearchParams(location.search).get("view")||"home");
void refreshStatus();void selectView(initial);renderChat();setupVoiceInput();
window.addEventListener("keydown",function(e){if(e.key==="Escape"&&!modal.open&&!viewer.open){if(state.stopVoice)state.stopVoice();chatRail.classList.remove("open")}});

