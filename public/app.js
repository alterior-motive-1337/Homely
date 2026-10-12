const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const content=$("#content"), pageTitle=$("#page-title"), nav=$("#nav");
const modal=$("#modal"), modalBody=$("#modal-body"), viewer=$("#viewer"), viewerBody=$("#viewer-body"), viewerTitle=$("#viewer-title");
const toast=$("#toast"), chatRail=$("#chat-rail"), chatBody=$("#chat-body"), chatForm=$("#chat-form"), chatInput=$("#chat-input"), voiceButton=$("#voice-button");
const runtime=$("#runtime-status"), runtimeText=$("#runtime-text"), agentState=$("#agent-state");
const state={view:"home",assets:[],agentMessages:[],previousResponseId:null,integrations:null,objectUrl:null,viewRevision:0,stopVoice:null,needsReload:false,viewLoadedAt:0};
const viewPanels=new Map();
const VIEW_CACHE_MS=120000;

function esc(v){return String(v==null?"":v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function fmtDate(v){return v?new Intl.DateTimeFormat("en-ZA",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(v)):"—"}
function assetAge(a){const value=a.acquired_at||a.purchase_date;if(!value)return"Unknown";const date=new Date(value),now=new Date();if(!Number.isFinite(date.getTime()))return"Unknown";let months=(now.getFullYear()-date.getFullYear())*12+now.getMonth()-date.getMonth();if(now.getDate()<date.getDate())months-=1;if(months<0)return"Not yet acquired";const years=Math.floor(months/12);return years?years+"y "+months%12+"m":months+"m"}
function money(c){return c==null?"—":new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR",maximumFractionDigits:0}).format(Number(c)/100)}
function today(){return new Date().toISOString().slice(0,10)}
$("#today").textContent=new Intl.DateTimeFormat("en-ZA",{day:"2-digit",month:"short",year:"numeric"}).format(new Date());

async function api(path,options){
  const init=Object.assign({},options||{});
  if(init.body&&typeof init.body!=="string"&&!(init.body instanceof Blob)){init.headers=Object.assign({"content-type":"application/json"},init.headers||{});init.body=JSON.stringify(init.body)}
  const res=await fetch(path,init);let data=null;try{data=await res.json()}catch(_){}
  if(res.ok && (path.endsWith("/commit")||path.endsWith("/undo"))){
    viewPanels.clear();state.assets=[];state.needsReload=true;
  }
  if(res.status===401){window.location.replace("/");throw new Error("Session expired. Please sign in again.")}
  if(!res.ok)throw new Error(data&&data.error?data.error:"Request failed: "+res.status);
  return data
}
function notify(message){toast.textContent=message;toast.classList.add("show");setTimeout(function(){toast.classList.remove("show")},2400)}
function loading(label){content.innerHTML='<div class="loading">'+esc(label||"Loading home memory…")+"</div>"}
function fail(e){console.error(e);content.innerHTML='<div class="error">'+esc(e&&e.message?e.message:"Homely could not load this view.")+"</div>"}
function badge(v){return '<span class="badge '+esc(v||"")+'">'+esc(v||"UNKNOWN")+"</span>"}
function row(title,meta,right,note){return '<div class="row"><div><div class="row-title">'+esc(title)+'</div><div class="row-meta">'+esc(meta||"")+'</div>'+(note?'<div class="row-note">'+esc(note)+"</div>":"")+'</div><div class="row-actions">'+(right||"")+"</div></div>"}


function emptyState(title,description,buttons,compact=false){
  return '<section class="empty-state'+(compact?' compact':'')+'"><div class="empty-symbol" aria-hidden="true">▤</div><h2>'+esc(title)+'</h2>'
    +(description?'<p>'+esc(description)+'</p>':'')
    +(buttons?'<div class="hero-actions">'+buttons+'</div>':'')+'</section>';
}
function ledger(title,count,action,body,emptyMessage,columns){
  return '<section class="ledger" aria-label="'+esc(title)+'">'
   +'<header class="ledger-toolbar"><div class="ledger-identity"><span class="ledger-overline">'+esc(title)+'</span><span class="ledger-count">'+count+' '+(count===1?'entry':'entries')+'</span></div>'
   +'<div class="ledger-controls">'+(action||'')+'</div></header>'
   +'<div class="ledger-columns"><span>'+esc(columns||'Record')+'</span><span>Details</span><span>Related</span></div>'
   +'<div class="ledger-rows">'+(body||'<div class="ledger-zero"><span class="ledger-zero-mark" aria-hidden="true">—</span><div><strong>No records yet</strong><p>'+esc(emptyMessage||'Nothing has been recorded.')+'</p></div></div>')+'</div></section>';
}
function linkedFilesButton(label,id){
  return '<button type="button" class="ledger-file-link" data-'+label+'="'+esc(id)+'" title="Open record and related files" aria-label="Open record and related files">▤ <span>Files</span></button>';
}

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
    const [d,assets]=await Promise.all([api("/api/overview"),api("/api/assets")]);
    if(revision!==state.viewRevision)return;
    state.assets=assets;
    const memory=d.memory||{},repairs=memory.repairs||[],charges=memory.charges||[],purchases=memory.purchases||[];
    const attention=d.attention.issues.map(function(i){return row(i.title,i.asset_name,badge(i.severity))})
      .concat(d.attention.maintenance.map(function(m){return row(m.title,m.asset_name+" · "+m.days_overdue+" days overdue",badge("OVERDUE"))}));
    const homeName=d.home&&d.home.name||"My Home";
    pageTitle.textContent=homeName;
    document.title=homeName+" · Homely";
    if(!assets.length&&!repairs.length&&!charges.length&&!purchases.length&&!d.recent.length){
      content.innerHTML=emptyState("Start with what you own.",
        "Add an appliance, fixture, or piece of furniture. Homely will keep its issues, repairs, documents, and history connected.",
        '<button class="primary-button" id="home-first-asset">Register first asset</button><button class="button" id="home-first-file">Upload a file</button>');
      $("#home-first-asset").onclick=()=>openAssetForm();
      $("#home-first-file").onclick=()=>openUploadEvidenceForm();
      return;
    }
    let html='<div class="home-overview"><div class="hero"><div class="hero-actions"><button class="button" id="home-issue">Report issue</button><button class="primary-button" id="home-repair">Record repair</button></div></div>';
    html+='<section class="metrics" aria-label="Household overview"><div class="metric"><span>Open issues</span><strong>'+d.summary.open_issues+'</strong></div><div class="metric"><span>Needs attention</span><strong>'+d.summary.systems_needing_attention+'</strong></div><div class="metric"><span>Overdue</span><strong>'+d.summary.overdue_maintenance+'</strong></div></section>';
    if(attention.length||d.upcoming.length){
      html+='<div class="home-priority">';
      if(attention.length)html+='<section class="card"><div class="card-head"><h2>Needs attention</h2><button class="ghost-link" data-go="issues">All issues</button></div><div class="card-body rows">'+attention.slice(0,4).join("")+'</div></section>';
      if(d.upcoming.length)html+='<section class="card"><div class="card-head"><h2>Coming up</h2><span class="row-meta">Next 30 days</span></div><div class="card-body rows">'+d.upcoming.slice(0,4).map(m=>row(m.title,m.asset_name+' · '+fmtDate(m.next_due_at),'<span class="badge">'+Number(m.days_until)+'d</span>')).join("")+'</div></section>';
      html+='</div>';
    }else html+='<p class="quiet-status">No outstanding issues or upcoming maintenance.</p>';
    if(repairs.length||charges.length||purchases.length){
      html+='<div class="home-memory">';
      if(repairs.length)html+='<section class="card"><div class="card-head"><h2>Recent repairs</h2><button class="ghost-link" data-go="repairs">All</button></div><div class="card-body rows">'+repairs.slice(0,3).map(r=>row(r.title,fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+'</span>')).join("")+'</div></section>';
      if(charges.length)html+='<section class="card"><div class="card-head"><h2>Charges</h2><button class="ghost-link" id="view-charges">View all</button></div><div class="card-body rows">'+charges.slice(0,3).map(c=>row(c.name,c.billing_cycle,'<span class="money">'+money(c.amount_cents)+'</span>')).join("")+'</div></section>';
      if(purchases.length)html+='<section class="card"><div class="card-head"><h2>Saved purchases</h2><button class="ghost-link" id="view-purchases">View all</button></div><div class="card-body rows">'+purchases.slice(0,3).map(p=>row(p.title,p.status,'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+'</span>')).join("")+'</div></section>';
      html+='</div>';
    }
    html+='<div class="home-utilities"><div class="utility-links"><button class="ghost-link" id="view-charges-shortcut">Charges</button><button class="ghost-link" id="view-purchases-shortcut">Purchases</button><button class="ghost-link" id="view-history">History</button></div></div></div>';
    content.innerHTML=html;
    $("#home-issue").onclick=openIssueForm;
    $("#home-repair").onclick=()=>openRepairForm();
    const chargesBtn=$("#view-charges");if(chargesBtn)chargesBtn.onclick=showCharges;
    const purchasesBtn=$("#view-purchases");if(purchasesBtn)purchasesBtn.onclick=showPurchases;
    $("#view-charges-shortcut").onclick=showCharges;
    $("#view-purchases-shortcut").onclick=showPurchases;
    $("#view-history").onclick=showHistory;
    $$("[data-go]",content).forEach(b=>b.onclick=()=>navigate(b.dataset.go));
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
    const [items,assets]=await Promise.all([api("/api/issues"),api("/api/assets")]);
    if(revision!==state.viewRevision)return;
    state.assets=assets;
    const action=assets.length
       ? '<button class="primary-button" id="new-issue" type="button">+ Report issue</button>'
       : '<button class="primary-button" id="new-asset" type="button">+ Register asset</button>';
    const body=items.map((item,index)=>{
      const active=!["RESOLVED","CLOSED"].includes(item.status);
      return '<div class="ledger-entry"><button type="button" class="ledger-main" data-issue-open="'+esc(item.id)+'"><span class="ledger-index">'+String(index+1).padStart(2,"0")+'</span><span class="ledger-entry-content"><strong>'+esc(item.title)+'</strong><small>'+esc(item.asset_name||"Home")+(item.description?' · '+esc(item.description):'')+'</small></span></button>'
        +'<div class="ledger-details"><span>'+fmtDate(item.detected_at)+'</span>'+badge(item.status)+badge(item.severity)+'</div>'
        +'<div class="ledger-actions">'+linkedFilesButton("issue-files",item.id)
        +(active?'<button class="ledger-quiet-action" type="button" data-repair="'+esc(item.id)+'">Repair</button><button class="ledger-quiet-action" type="button" data-resolve="'+esc(item.id)+'">Resolve</button>':'')
        +'</div></div>';
    }).join("");
    content.innerHTML=ledger("Issues",items.length,action,body,assets.length?"Report an issue to create a dated record and keep its files together.":"Register the first household asset to begin logging issues.","Issue");
    const add=$("#new-issue");if(add)add.onclick=openIssueForm;
    const register=$("#new-asset");if(register)register.onclick=()=>openAssetForm();
    $$("[data-resolve]",content).forEach(b=>b.onclick=()=>openResolveForm(items.find(i=>i.id===b.dataset.resolve)));
    $$("[data-repair]",content).forEach(b=>b.onclick=()=>openRepairForm(items.find(i=>i.id===b.dataset.repair)));
    $$("[data-issue-open]",content).forEach(b=>b.onclick=()=>openIssue(items.find(i=>i.id===b.dataset.issueOpen)));
    $$("[data-issue-files]",content).forEach(b=>b.onclick=()=>openIssue(items.find(i=>i.id===b.dataset.issueFiles)));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}


async function showRepairs(){
  loading();const revision=state.viewRevision;
  try{
    const [items,assets]=await Promise.all([api("/api/repairs"),api("/api/assets")]);
    if(revision!==state.viewRevision)return;
    state.assets=assets;
    const action=assets.length?'<button class="primary-button" id="new-repair" type="button">+ Record repair</button>':'<button class="primary-button" id="new-asset" type="button">+ Register asset</button>';
    const body=items.map((r,index)=>'<div class="ledger-entry"><button type="button" class="ledger-main" data-repair-open="'+esc(r.id)+'"><span class="ledger-index">'+String(index+1).padStart(2,"0")+'</span><span class="ledger-entry-content"><strong>'+esc(r.title)+'</strong><small>'+esc(r.asset_name||"Home")+(r.outcome||r.description?' · '+esc(r.outcome||r.description):'')+'</small></span></button><div class="ledger-details"><span>'+fmtDate(r.repair_date)+'</span><strong class="money">'+money(r.cost_cents)+'</strong></div><div class="ledger-actions">'+linkedFilesButton("repair-files",r.id)+'</div></div>').join("");
    content.innerHTML=ledger("Repairs",items.length,action,body,assets.length?"Repairs and their costs will appear here.":"Register a household asset to begin recording repairs.","Repair");
    const add=$("#new-repair");if(add)add.onclick=()=>openRepairForm();
    const register=$("#new-asset");if(register)register.onclick=()=>openAssetForm();
    $$("[data-repair-open]",content).forEach(b=>b.onclick=()=>openRepair(items.find(r=>r.id===b.dataset.repairOpen)));
    $$("[data-repair-files]",content).forEach(b=>b.onclick=()=>openRepair(items.find(r=>r.id===b.dataset.repairFiles)));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function evidenceMarkup(docs){return '<div class="detail-section"><h3>Files</h3><div class="rows">'+(docs.map(function(d){return row(d.title,d.type+" · "+fmtDate(d.occurred_at||d.created_at),'<button class="button" data-evidence="'+esc(d.id)+'">Open</button>',d.evidence_reason||"")}).join("")||'<div class="empty">No evidence attached.</div>')+'</div></div>'}
function bindEvidence(docs){$$("[data-evidence]",modalBody).forEach(function(b){b.onclick=function(){openFile(docs.find(function(d){return d.id===b.dataset.evidence}))}})}
async function openIssue(issue){
  if(!issue)return;
  try{const results=await Promise.all([api("/api/documents"),api("/api/assets/"+encodeURIComponent(issue.asset_id))]),docs=results[0].filter(function(d){return d.issue_id===issue.id}),history=(results[1].history||[]).filter(function(e){return e.issue_id===issue.id});
    openModal('<p class="eyebrow">Issue · '+esc(issue.asset_name)+'</p><h2>'+esc(issue.title)+'</h2><div class="hero-actions">'+badge(issue.status)+badge(issue.severity)+'</div><div class="detail-grid"><div class="detail"><span>Detected</span><strong>'+fmtDate(issue.detected_at)+'</strong></div><div class="detail"><span>Resolved</span><strong>'+fmtDate(issue.resolved_at)+'</strong></div></div><p>'+esc(issue.description||"No description recorded.")+'</p>'+(history.length?'<div class="detail-section"><h3>History</h3><div class="rows">'+history.map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")+'</div></div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="issue-attach">Attach file</button><button class="button" id="issue-asset">View asset</button>'+(!["RESOLVED","CLOSED"].includes(issue.status)?'<button class="button" id="issue-repair">Record repair</button><button class="primary-button" id="issue-resolve">Resolve</button>':"")+'</div>');
    bindEvidence(docs);$("#issue-attach").onclick=function(){openUploadEvidenceForm({assetId:issue.asset_id,issueId:issue.id})};$("#issue-asset").onclick=function(){openAsset(issue.asset_id)};if($("#issue-repair"))$("#issue-repair").onclick=function(){openRepairForm(issue)};if($("#issue-resolve"))$("#issue-resolve").onclick=function(){openResolveForm(issue)};
  }catch(e){notify(e.message)}
}
async function openRepair(repair){
  if(!repair)return;
  try{const docs=(await api("/api/documents")).filter(function(d){return d.repair_id===repair.id});
    openModal('<p class="eyebrow">Repair · '+esc(repair.asset_name)+'</p><h2>'+esc(repair.title)+'</h2><div class="detail-grid">'+[["Date",fmtDate(repair.repair_date)],["Cost",money(repair.cost_cents)],["Contractor",repair.contractor||"—"]].map(function(pair){return '<div class="detail"><span>'+esc(pair[0])+'</span><strong>'+esc(pair[1])+'</strong></div>'}).join("")+'</div><div class="detail-section"><h3>Work performed</h3><p>'+esc(repair.description||"No description recorded.")+'</p></div><div class="detail-section"><h3>Outcome</h3><p>'+esc(repair.outcome||"No outcome recorded.")+'</p></div>'+(repair.issue_title?'<div class="row-meta">Issue: '+esc(repair.issue_title)+'</div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="repair-attach">Attach file</button><button class="button" id="repair-asset">View asset</button></div>');bindEvidence(docs);$("#repair-attach").onclick=function(){openUploadEvidenceForm({assetId:repair.asset_id,repairId:repair.id})};$("#repair-asset").onclick=function(){openAsset(repair.asset_id)};
  }catch(e){notify(e.message)}
}


async function openAssetForm(existing){
  const systems=await api("/api/systems");
  const options=systems.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>'}).join("");
  if(!options){notify("No home systems available.");return}
  openModal('<p class="eyebrow">Asset register</p><h2>'+(existing?"Edit appliance or furniture":"Register appliance or furniture")+'</h2><form class="form" id="asset-form"><div class="form-grid"><div class="field"><label>System</label><select name="systemId" required>'+options+'</select></div><div class="field"><label>Category</label><input name="category" placeholder="APPLIANCE / FURNITURE" maxlength="80" required></div><div class="field full"><label>Name</label><input name="name" maxlength="180" required></div><div class="field"><label>Condition</label><select name="condition"><option>UNKNOWN</option><option>NEW</option><option>GOOD</option><option>FAIR</option><option>POOR</option><option>FAILED</option></select></div><div class="field"><label>Room or location</label><input name="location" maxlength="200"></div><div class="field"><label>Manufacturer</label><input name="manufacturer" maxlength="160"></div><div class="field"><label>Model</label><input name="model" maxlength="160"></div><div class="field full"><label>Serial number</label><input name="serialNumber" maxlength="160"></div><div class="field"><label>Purchase date</label><input name="purchaseDate" type="date"></div><div class="field"><label>Purchase price (ZAR)</label><input name="purchaseCost" type="number" min="0" step=".01"></div><div class="field"><label>Warranty end</label><input name="warrantyEnd" type="date"></div><div class="field full"><label>Notes</label><textarea name="notes" maxlength="3000"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  if(existing){
    const form=$("#asset-form");
    const values={systemId:existing.system_id,name:existing.name,category:existing.category,
      condition:existing.condition,location:existing.location,manufacturer:existing.manufacturer,
      model:existing.model,serialNumber:existing.serial_number,purchaseDate:existing.purchase_date,
      purchaseCost:existing.purchase_cost_cents==null?"":Number(existing.purchase_cost_cents)/100,
      warrantyEnd:existing.warranty_end,notes:existing.notes};
    for(const [key,value] of Object.entries(values)){
      const element=form.elements.namedItem(key);
      if(element)element.value=value==null?"":String(value);
    }
  }
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#asset-form").onsubmit=async function(e){
    e.preventDefault();const d=new FormData(e.currentTarget),cost=String(d.get("purchaseCost")||"").trim();
    try{await previewAction(existing?"UPDATE_ASSET":"CREATE_ASSET",{assetId:existing?existing.id:null,systemId:d.get("systemId"),name:d.get("name"),category:d.get("category"),condition:d.get("condition"),location:d.get("location"),manufacturer:d.get("manufacturer"),model:d.get("model"),serialNumber:d.get("serialNumber"),purchaseDate:d.get("purchaseDate")||null,purchaseCostCents:cost?Math.round(Number(cost)*100):null,warrantyEnd:d.get("warrantyEnd")||null,notes:d.get("notes")},existing?"Homeowner updated a household asset.":"Homeowner registered a household asset.")}
    catch(err){notify(err.message)}
  };
}


function renderAssets(items){
  const target=$("#asset-results");
  if(!target)return;
  const filtered=state.assets.length>0;
  const body=items.map((a,index)=>'<div class="ledger-entry"><button type="button" class="ledger-main" data-asset="'+esc(a.id)+'"><span class="ledger-index">'+String(index+1).padStart(2,"0")+'</span><span class="ledger-entry-content"><strong>'+esc(a.name)+'</strong><small>'+esc([a.category,a.location].filter(Boolean).join(" · ")||a.system_name||"Household asset")+'</small></span></button><div class="ledger-details">'+badge(a.condition||"UNKNOWN")+'<span>'+money(a.purchase_cost_cents)+'</span></div><div class="ledger-actions"><button type="button" class="ledger-file-link" data-asset-file="'+esc(a.id)+'" aria-label="Open asset and associated files">▤ <span>Files</span></button></div></div>').join("");
  target.innerHTML=ledger("Appliances & furniture",items.length,'<button type="button" class="primary-button" id="new-asset">+ Register asset</button>',body,filtered?"No assets match your search.":"Your appliances, furniture and fixtures will appear here.","Asset");
  $("#new-asset").onclick=()=>openAssetForm();
  $$("[data-asset]",target).forEach(b=>b.onclick=()=>openAsset(b.dataset.asset));
  $$("[data-asset-file]",target).forEach(b=>b.onclick=()=>openAsset(b.dataset.assetFile));
}
async function showAppliances(){
  loading();const revision=state.viewRevision;
  try{
    state.assets=await api("/api/assets");
    if(revision!==state.viewRevision)return;
    content.innerHTML='<div class="toolbar register-search"><input class="search" id="asset-search" type="search" placeholder="Search appliances & furniture" aria-label="Search assets"></div><div id="asset-results"></div>';
    renderAssets(state.assets);
    $("#asset-search").oninput=e=>{const q=e.target.value.toLowerCase().trim();renderAssets(state.assets.filter(a=>[a.name,a.system_name,a.location,a.manufacturer,a.model,a.category].some(v=>String(v||"").toLowerCase().includes(q))))};
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
    html+='<div class="form-actions"><button class="primary-button" id="edit-asset">Edit details</button></div>';
    openModal(html);$("#edit-asset").onclick=function(){openAssetForm(a)};$("[data-file]",modalBody).forEach(function(b){b.onclick=async function(){const docs=await api("/api/documents"),doc=docs.find(function(d){return d.id===b.dataset.file});if(doc)openFile(doc)}})
  }catch(e){notify(e.message)}
}

function fileHref(d){const raw=String(d.web_view_link||d.local_path||d.source_url||"").trim();try{const url=new URL(raw,location.origin);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password?url.href:""}catch(_){return""}}
async function openFile(doc){
  if(state.stopVoice)state.stopVoice();
  const href=fileHref(doc),mime=String(doc.mime_type||"");
  const stored=String(doc.local_path||"").startsWith("/api/files/");
  viewerTitle.textContent=doc.title||"File";viewerBody.innerHTML="";
  const insight=$("#viewer-insight"),analyze=$("#analyze-file");
  insight.textContent="";insight.hidden=true;
  if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}
  analyze.hidden=!stored || !/^(image\/(png|jpeg|webp)|audio\/|video\/(mp4|webm)|text\/(plain|csv)|application\/json)/.test(mime);
  analyze.disabled=false;analyze.textContent="Analyze";
  analyze.onclick=async function(){
    analyze.disabled=true;analyze.textContent="Analyzing…";
    insight.hidden=false;insight.textContent="Processing stored evidence…";
    try{
      const result=await api("/api/documents/"+encodeURIComponent(doc.id)+"/analyze",{method:"POST"});
      insight.textContent=result.text+"\n\n"+(result.cached?"Cached · ":"")+"Processed with "+result.model;
    }catch(e){insight.textContent=e.message}
    finally{analyze.disabled=false;analyze.textContent="Analyze"}
  };
  if(!href){
    viewerBody.innerHTML='<div class="viewer-link"><strong>No viewable file is attached.</strong></div>';
  }else if(new URL(href).origin===location.origin){
    try{
      if(stored && mime.startsWith("video/")) viewerBody.innerHTML='<video controls preload="metadata" src="'+esc(href)+'"></video>';
      else if(stored && mime.startsWith("audio/")) viewerBody.innerHTML='<audio controls preload="metadata" src="'+esc(href)+'"></audio>';
      else{
        const res=await fetch(href);
        if(!res.ok)throw new Error("File unavailable");
        const blob=await res.blob();state.objectUrl=URL.createObjectURL(blob);
        const type=mime||blob.type||"";
        if(type.startsWith("image/"))viewerBody.innerHTML='<img src="'+esc(state.objectUrl)+'" alt="">';
        else viewerBody.innerHTML='<iframe sandbox title="'+esc(doc.title)+'" src="'+esc(state.objectUrl)+'"></iframe>';
      }
    }catch(e){viewerBody.innerHTML='<div class="viewer-link"><strong>'+esc(e.message)+'</strong></div>'}
  }else if(doc.provider==="GOOGLE_DRIVE"&&doc.provider_file_id){
    viewerBody.innerHTML='<iframe title="'+esc(doc.title)+'" src="https://drive.google.com/file/d/'+encodeURIComponent(doc.provider_file_id)+'/preview" sandbox="allow-scripts allow-same-origin"></iframe>';
  }else if(mime.startsWith("image/"))viewerBody.innerHTML='<img src="'+esc(href)+'" alt="'+esc(doc.title)+'">';
  else if(mime.startsWith("video/"))viewerBody.innerHTML='<video controls src="'+esc(href)+'"></video>';
  else if(mime.startsWith("audio/"))viewerBody.innerHTML='<audio controls src="'+esc(href)+'"></audio>';
  else viewerBody.innerHTML='<div class="viewer-link"><a class="primary-button" href="'+esc(href)+'" target="_blank" rel="noreferrer">Open source</a></div>';
  viewer.showModal();
}
$("#viewer-close").onclick=function(){viewer.close()};
viewer.addEventListener("close",function(){$("#viewer-insight").hidden=true;if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}});

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


async function openUploadEvidenceForm(defaults){
  await openLinkEvidenceForm();
  const form=$("#link-evidence-form");
  if(!form)return;
  const source=$('input[name="sourceUrl"]',form);
  source.closest(".field").innerHTML='<label>File (maximum 50 MB)</label><input type="file" name="attachment" required accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,audio/*,video/mp4,video/webm,.doc,.docx,.zip">';
  $(".eyebrow",modalBody).textContent="Upload evidence";
  $("h2",modalBody).textContent="Attach a file";
  $(".primary-button",form).textContent="Preview attachment";
  const d=defaults||{};
  for(const key of ["assetId","issueId","repairId","chargeId","purchaseCandidateId"]){
    const element=form.elements.namedItem(key);
    if(element&&d[key])element.value=d[key];
  }
  const fileInput=form.elements.namedItem("attachment");
  fileInput.onchange=function(){
    const file=fileInput.files&&fileInput.files[0];if(!file)return;
    if(!form.elements.namedItem("title").value.trim())form.elements.namedItem("title").value=file.name.slice(0,240);
    const type=form.elements.namedItem("documentType");
    if(file.type.startsWith("image/"))type.value="PHOTO";
    else if(file.type.startsWith("video/"))type.value="VIDEO";
    else if(file.type==="application/pdf")type.value="REPORT";
  };
  form.onsubmit=async function(e){
    e.preventDefault();const data=new FormData(form),file=fileInput.files&&fileInput.files[0];
    if(!file)return notify("Select a file.");
    if(!file.size||file.size>50_000_000)return notify("Select a file of 50 MB or less.");

    const submit=$('button[type="submit"]',form);
    if(submit)submit.disabled=true;
    try{
      const staged=await api("/api/uploads/start",{method:"POST",body:{name:file.name,mimeType:file.type||"application/octet-stream",size:file.size}});
      const total=Math.ceil(file.size/staged.chunkSize);
      for(let index=0;index<total;index++){
        const chunk=file.slice(index*staged.chunkSize,Math.min(file.size,(index+1)*staged.chunkSize));
        await api("/api/uploads/"+encodeURIComponent(staged.id)+"/chunks/"+index,
          {method:"PUT",headers:{"content-type":"application/octet-stream"},body:chunk});
        if(submit)submit.textContent="Uploading "+Math.round((index+1)/total*100)+"%";
      }
      await api("/api/uploads/"+encodeURIComponent(staged.id)+"/finish",{method:"POST"});
      if(submit)submit.textContent="Preview attachment";
      await previewAction("ATTACH_DOCUMENT",{
        assetId:data.get("assetId")||null,issueId:data.get("issueId")||null,
        repairId:data.get("repairId")||null,chargeId:data.get("chargeId")||null,
        purchaseCandidateId:data.get("purchaseCandidateId")||null,
        title:data.get("title"),documentType:data.get("documentType"),
        provider:"LOCAL",uploadId:staged.id,providerFileId:null,
        mimeType:staged.mimeType,webViewLink:null,sourceUrl:null,
        provenance:data.get("provenance"),occurredAt:data.get("occurredAt"),
        evidenceReason:data.get("evidenceReason"),evidenceStatus:data.get("evidenceStatus")
      },"Homeowner attached a file as household evidence.");
    }catch(err){notify(err.message)}
    finally{if(submit)submit.disabled=false}
  };
}


async function showFiles(){
  loading();const revision=state.viewRevision;
  try{
    const docs=await api("/api/documents");
    if(revision!==state.viewRevision)return;
    const buttons='<button class="button" id="save-link" type="button">+ Save link</button><button class="primary-button" id="upload-file" type="button">+ Upload file</button>';
    let cards=docs.map(d=>{
      const links=[d.asset_name,d.issue_title&&"Issue: "+d.issue_title,d.repair_title&&"Repair: "+d.repair_title,d.charge_name&&"Charge: "+d.charge_name,d.purchase_title&&"Purchase: "+d.purchase_title].filter(Boolean);
      return '<button class="file-card" type="button" data-file="'+esc(d.id)+'" aria-label="Select '+esc(d.title)+'" aria-pressed="false"><span class="file-glyph" aria-hidden="true">▤</span><span class="file-type">'+esc(d.type||"FILE")+'</span><strong>'+esc(d.title)+'</strong><small>'+esc((links.join(" · ")||"Household file"))+'</small></button>';
    }).join("");
    if(!docs.length)cards='<div class="files-empty"><span class="file-glyph" aria-hidden="true">▤</span><strong>No files yet</strong><p>Receipts, manuals, photos and documents will appear here.</p></div>';
    content.innerHTML='<section class="file-browser"><div class="ledger-toolbar"><div class="ledger-identity"><span class="ledger-overline">Files</span><span class="ledger-count">'+docs.length+' '+(docs.length===1?'file':'files')+'</span></div><div class="ledger-controls">'+buttons+'</div></div>'
      +'<div class="file-browser-body"><div class="file-browser-main"><div class="file-browser-search"><input class="search" id="file-search" type="search" placeholder="Search files" aria-label="Search files"></div><div class="file-grid">'+cards+'</div></div><aside class="file-inspector" id="file-inspector"><span class="ledger-overline">Information</span><div class="inspector-placeholder"><span class="file-glyph" aria-hidden="true">▤</span><p>Select a file to see its details.</p></div></aside></div></section>';
    $("#save-link").onclick=()=>openLinkEvidenceForm();
    $("#upload-file").onclick=()=>openUploadEvidenceForm();
    const inspector=$("#file-inspector");
    function selectFile(doc){
      $$("[data-file]",content).forEach(card=>card.setAttribute("aria-pressed",String(card.dataset.file===doc.id)));
      const related=[doc.asset_name,doc.issue_title&&"Issue: "+doc.issue_title,doc.repair_title&&"Repair: "+doc.repair_title,doc.charge_name&&"Charge: "+doc.charge_name,doc.purchase_title&&"Purchase: "+doc.purchase_title].filter(Boolean).join(" · ");
      inspector.innerHTML='<span class="ledger-overline">Information</span><div class="inspector-heading"><span class="file-glyph" aria-hidden="true">▤</span><strong>'+esc(doc.title)+'</strong></div><dl class="inspector-details">'
        +'<div><dt>Type</dt><dd>'+esc(doc.type||"File")+'</dd></div><div><dt>Date</dt><dd>'+fmtDate(doc.occurred_at||doc.created_at)+'</dd></div>'
        +(related?'<div><dt>Linked to</dt><dd>'+esc(related)+'</dd></div>':'')
        +(doc.evidence_reason?'<div><dt>Reason</dt><dd>'+esc(doc.evidence_reason)+'</dd></div>':'')
        +'</dl><button type="button" class="primary-button inspector-open" id="inspect-open">Open file ↗</button>';
      $("#inspect-open").onclick=()=>openFile(doc);
    }
    const search=$("#file-search");
    search.oninput=e=>{const q=e.target.value.toLowerCase().trim();$$("[data-file]",content).forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(q)})};
    $$("[data-file]",content).forEach(b=>{
      const doc=docs.find(d=>d.id===b.dataset.file);
      b.onclick=()=>selectFile(doc);
      b.ondblclick=()=>openFile(doc);
    });
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function messageMarkup(m){
  return '<article class="message '+m.role+'"><div class="message-role">'+(m.role==="user"?"You":"Homely")+'</div><p>'+esc(m.text)+'</p>'+(m.proposals||[]).map(function(p){return '<div class="proposal"><strong>'+esc(p.preview.title)+'</strong><div class="row-meta">'+esc(p.preview.summary)+'</div><div class="row-note">'+esc(p.reason)+'</div>'+(p.status==="PROPOSED"?'<div class="proposal-actions"><button class="button" data-reject="'+esc(p.transactionId)+'">Reject</button><button class="primary-button" data-approve="'+esc(p.transactionId)+'">Approve</button></div>':'<div class="row-meta">'+esc(p.status)+"</div>")+"</div>"}).join("")+"</article>"
}
function renderChat(){
  chatBody.innerHTML=state.agentMessages.length?state.agentMessages.map(messageMarkup).join(""):'<div class="chat-empty">Ask about your home.</div>';
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
async function selectView(view){
  state.viewRevision+=1;
  const next=normalizeView(view),stale=state.needsReload;
  if(state.view && content.hasChildNodes() && !stale && !content.querySelector(".loading,.error")){
    const fragment=document.createDocumentFragment();
    while(content.firstChild)fragment.appendChild(content.firstChild);
    viewPanels.set(state.view,{fragment:fragment,time:state.viewLoadedAt||Date.now()});
  }else{content.replaceChildren()}
  state.needsReload=false;state.view=next;
  pageTitle.textContent=views[next][0];document.title=views[next][0]+" · Homely";
  $$(".nav-item").forEach(function(b){b.classList.toggle("active",b.dataset.view===next);if(b.dataset.view===next)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  const saved=viewPanels.get(next);
  if(saved && Date.now()-saved.time<VIEW_CACHE_MS){
    viewPanels.delete(next);state.viewLoadedAt=saved.time;content.appendChild(saved.fragment);return;
  }
  viewPanels.delete(next);state.viewLoadedAt=Date.now();
  await views[next][1]();
}
function navigate(view,replace){view=normalizeView(view);const url=view==="home"?"/":"/?view="+encodeURIComponent(view);if(replace)history.replaceState({view:view},"",url);else history.pushState({view:view},"",url);void selectView(view)}
nav.onclick=function(e){const b=e.target.closest("[data-view]");if(b)navigate(b.dataset.view,false)};
window.onpopstate=function(){selectView(new URLSearchParams(location.search).get("view")||"home")};
function syncAssistantAccessibility(){
  const docked=window.matchMedia("(min-width: 960px)").matches;
  chatRail.setAttribute("aria-hidden",String(!(docked||chatRail.classList.contains("open"))));
  if(docked)$("#chat-backdrop").hidden=true;
}
window.addEventListener("resize",syncAssistantAccessibility);
function openChat(){
  chatRail.classList.add("open");
  chatRail.setAttribute("aria-hidden","false");
  $("#chat-backdrop").hidden=false;
  $("#chat-open").setAttribute("aria-expanded","true");
  $("#chat-trigger").setAttribute("aria-expanded","true");
  syncAssistantAccessibility();
  chatInput.focus();
}
function closeChat(){
  if(state.stopVoice)state.stopVoice();
  chatRail.classList.remove("open");
  chatRail.setAttribute("aria-hidden","true");
  $("#chat-backdrop").hidden=true;
  $("#chat-open").setAttribute("aria-expanded","false");
  $("#chat-trigger").setAttribute("aria-expanded","false");
  syncAssistantAccessibility();
}
$("#chat-open").onclick=openChat;
$("#chat-trigger").onclick=openChat;
$("#chat-close").onclick=closeChat;
$("#chat-backdrop").onclick=closeChat;
$("#refresh-view").onclick=function(){viewPanels.clear();state.needsReload=true;void selectView(state.view)};
async function openHouseholdSettings(){
  try{
    const state=await api("/api/homes"),members=await api("/api/homes/members");
    const home=state.homes.find(h=>h.id===state.currentHomeId);
    const owner=home&&home.role==="OWNER";
    const pending=owner?await api("/api/homes/invitations"):[];
    let markup='<p class="eyebrow">Account</p><h2>Household settings</h2><p class="row-meta">'+esc($("#account-email").textContent)+'</p>';
    markup+='<div class="detail-section"><h3>Your homes</h3><div class="rows">'+state.homes.map(h=>
      row(h.name,h.role,h.id===state.currentHomeId?'<span class="badge">Current</span>':'<button type="button" class="button" data-switch="'+esc(h.id)+'">Open home</button>')
    ).join("")+'</div></div>';
    if(owner){
      markup+='<div class="detail-section"><h3>Home name</h3><form class="form" id="rename-home-form"><div class="field"><label>Household</label><input name="homeName" maxlength="100" value="'+esc(home.name)+'" required></div><div class="form-actions"><button class="button" type="submit">Save name</button></div></form></div>';
      markup+='<div class="detail-section"><h3>Invite a member</h3><form class="form" id="invite-home-form"><div class="field"><label>Google email address</label><input name="email" type="email" required placeholder="person@example.com"></div><div class="field"><label>Access</label><select name="role"><option value="MEMBER">Member — edit records</option><option value="VIEWER">Viewer — read only</option></select></div><div class="form-actions"><button class="button" type="submit">Create invite link</button></div></form><div id="invite-result"></div></div>';
      markup+='<div class="detail-section"><h3>Pending invitations</h3><div class="rows">'+(pending.map(x=>row(x.email,x.role+' · expires '+fmtDate(x.expires_at),'<button type="button" class="button" data-revoke="'+esc(x.id)+'">Revoke</button>')).join("")||'<div class="empty">No pending invitations.</div>')+'</div></div>';
    }
    if(owner)markup+='<div class="detail-section"><h3>Download your data</h3><p class="row-meta">Includes household records, audit history, and original uploaded files.</p><div class="form-actions"><a class="button" href="/api/account/export" download="homely-backup.tar">Export household</a></div></div>';
        markup+='<div class="detail-section"><h3>Members</h3><div class="rows">'+members.map(x=>row(x.name,x.email+' · '+x.role,owner&&x.id!==state.homes.find(h=>h.id===state.currentHomeId)?.owner_id&&x.role!=="OWNER"?'<button type="button" class="button" data-remove="'+esc(x.id)+'">Remove</button>':'')).join("")+'</div></div>';
    markup+='<div class="detail-section"><h3>Delete account</h3><p class="row-meta">Irreversible. Export your home first. If you own a shared household, remove its members before deleting the account.</p><div class="form-actions"><button type="button" class="button" id="delete-account">Delete account…</button></div></div>';
    openModal(markup);
    $("#delete-account").onclick=function(){
      closeModal();
      openModal('<p class="eyebrow">Permanent deletion</p><h2>Delete account and owned home</h2><p class="row-note">Your account, sessions, household records, original files and audit history will be deleted. This cannot be undone. Sign out and sign in again if your session is older than 15 minutes.</p><form id="delete-account-form" class="form"><div class="field"><label>Type DELETE MY ACCOUNT to confirm</label><input name="confirmation" autocomplete="off" required></div><div class="form-actions"><button type="button" class="button" id="cancel-delete">Cancel</button><button class="button" type="submit">Permanently delete</button></div></form>');
      $("#cancel-delete").onclick=closeModal;
      $("#delete-account-form").onsubmit=async event=>{
        event.preventDefault();
        const confirmation=String(new FormData(event.currentTarget).get("confirmation")||"");
        if(confirmation!=="DELETE MY ACCOUNT"){notify("Confirmation does not match.");return}
        try{await api("/api/account/delete",{method:"DELETE",body:{confirmation}});window.location.replace("/")}
        catch(error){notify(error.message)}
      };
    };
    $$("[data-switch]",modalBody).forEach(button=>button.onclick=async()=>{
      try{await api("/api/homes/active",{method:"POST",body:{homeId:button.dataset.switch}});window.location.assign("/")}
      catch(e){notify(e.message)}
    });
    const rename=$("#rename-home-form");
    if(rename)rename.onsubmit=async e=>{
      e.preventDefault();
      try{await api("/api/homes/current",{method:"PATCH",body:{name:new FormData(rename).get("homeName")}});closeModal();window.location.assign("/")}
      catch(error){notify(error.message)}
    };
    const invite=$("#invite-home-form");
    if(invite)invite.onsubmit=async e=>{
      e.preventDefault();
      try{
        const data=new FormData(invite);
        const result=await api("/api/homes/invitations",{method:"POST",body:{email:data.get("email"),role:data.get("role")}});
        const link=new URL(result.link,location.origin).href;
        $("#invite-result").innerHTML='<div class="field"><label>Invitation link — share with '+esc(result.email)+'</label><input id="invite-link" readonly value="'+esc(link)+'"></div><div class="form-actions"><button type="button" class="button" id="copy-invite">Copy link</button></div>';
        $("#copy-invite").onclick=async()=>{try{await navigator.clipboard.writeText(link);notify("Invitation copied.")}catch(_){$("#invite-link").select();notify("Select and copy the invitation link.")}};
      }catch(error){notify(error.message)}
    };
    $$("[data-revoke]",modalBody).forEach(button=>button.onclick=async()=>{
      try{await api("/api/homes/invitations/"+encodeURIComponent(button.dataset.revoke),{method:"DELETE"});closeModal();await openHouseholdSettings()}
      catch(error){notify(error.message)}
    });
    $$("[data-remove]",modalBody).forEach(button=>button.onclick=async()=>{
      if(!confirm("Remove this member's access to the household?"))return;
      try{await api("/api/homes/members/"+encodeURIComponent(button.dataset.remove),{method:"DELETE"});closeModal();await openHouseholdSettings()}
      catch(error){notify(error.message)}
    });
  }catch(error){notify(error.message)}
}
function offerPendingInvitation(){
  const q=new URLSearchParams(location.search);
  const candidate=q.get("invite")||sessionStorage.getItem("homely_pending_invite");
  if(!candidate || !/^[a-zA-Z0-9_-]{43}$/.test(candidate))return;
  sessionStorage.setItem("homely_pending_invite",candidate);
  const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete("invite");
  history.replaceState({}, "",cleanUrl.pathname+cleanUrl.search);
  openModal('<p class="eyebrow">Household invitation</p><h2>Join a home</h2><p>Accept this invitation to open the shared household with the role chosen by its owner.</p><div class="form-actions"><button class="button" id="dismiss-invite">Later</button><button class="primary-button" id="accept-invite">Accept invitation</button></div>');
  $("#dismiss-invite").onclick=closeModal;
  $("#accept-invite").onclick=async()=>{
    try{
      await api("/api/homes/invitations/accept",{method:"POST",body:{token:candidate}});
      sessionStorage.removeItem("homely_pending_invite");closeModal();window.location.assign("/");
    }catch(error){notify(error.message)}
  };
}

async function bootstrap(){
  try{
    const response=await fetch("/api/auth/status",{cache:"no-store"});
    if(!response.ok)throw new Error("Authentication status unavailable.");
    const auth=await response.json();
    if(!auth.authenticated){
      $("#app-shell").hidden=true;$("#auth-screen").hidden=false;
      const invite=new URLSearchParams(location.search).get("invite");
      if(invite&&/^[a-zA-Z0-9_-]{43}$/.test(invite))sessionStorage.setItem("homely_pending_invite",invite);
      $("#google-signin").setAttribute("aria-disabled",auth.enabled?"false":"true");
      const message=location.search.includes("auth_error=")
        ? "Google sign-in was unsuccessful. Check your account and try again."
        : auth.enabled ? "Sign in with Google to access your private home."
        : "Google Sign-In is not configured yet. Add the OAuth credentials in Render.";
      $("#auth-message").textContent=message;
      return;
    }
    $("#auth-screen").hidden=true;$("#app-shell").hidden=false;
    $("#account-email").textContent=auth.user&&auth.user.email?auth.user.email:"Signed in";
    $("#household-settings").onclick=openHouseholdSettings;
    offerPendingInvitation();
    $("#sign-out").onclick=async function(){
      try{
        const res=await fetch("/auth/logout",{method:"POST",credentials:"same-origin"});
        if(!res.ok)throw new Error("Could not sign out.");
        window.location.replace("/");
      }catch(error){notify(error.message)}
    };
    const initial=normalizeView(new URLSearchParams(location.search).get("view")||"home");
    syncAssistantAccessibility();void refreshStatus();void selectView(initial);renderChat();setupVoiceInput();
  }catch(error){
    $("#app-shell").hidden=true;$("#auth-screen").hidden=false;
    $("#auth-message").textContent=error.message;
    $("#google-signin").setAttribute("aria-disabled","true");
  }
}
void bootstrap();
window.addEventListener("keydown",function(e){if(e.key==="Escape"&&!modal.open&&!viewer.open){closeChat()}});

