const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const content=$("#content"), pageTitle=$("#page-title"), nav=$("#nav");
const modal=$("#modal"), modalBody=$("#modal-body"), viewer=$("#viewer"), viewerBody=$("#viewer-body"), viewerTitle=$("#viewer-title");
const toast=$("#toast"), chatRail=$("#chat-rail"), chatBody=$("#chat-body"), chatForm=$("#chat-form"), chatInput=$("#chat-input");
const runtime=$("#runtime-status"), runtimeText=$("#runtime-text"), agentState=$("#agent-state");
const state={view:"home",assets:[],agentMessages:[],previousResponseId:null,integrations:null,objectUrl:null};

function esc(v){return String(v==null?"":v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function fmtDate(v){return v?new Intl.DateTimeFormat("en-ZA",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(v)):"—"}
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
  const backup=x&&x.backup, ai=x&&x.ai;
  if(backup&&backup.enabled&&!backup.connected){runtime.classList.add("warn");runtimeText.textContent="Backup not connected"}
  else if(backup&&backup.lastError){runtime.classList.add("bad");runtimeText.textContent="Backup degraded"}
  else{runtime.classList.add("good");runtimeText.textContent=backup&&backup.enabled?"Home memory durable":"Local memory active"}
  agentState.textContent=ai&&ai.available?String(ai.provider||"AI")+" · "+String(ai.model):"Structured memory only";
  chatInput.disabled=!(ai&&ai.available);chatForm.querySelector("button").disabled=!(ai&&ai.available)
}
async function refreshStatus(){try{setRuntime(await api("/api/integrations/status"))}catch(_){runtime.classList.add("bad");runtimeText.textContent="Status unavailable"}}

function openModal(html){modalBody.innerHTML=html;modal.showModal()}
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

async function showHome(){
  loading();
  try{
    const d=await api("/api/overview"), total=d.systems.reduce(function(n,s){return n+Number(s.asset_count||0)},0);
    const memory=d.memory||{}, repairs=memory.repairs||[],charges=memory.charges||[],purchases=memory.purchases||[];
    let html='<div class="hero"><div><p class="eyebrow">Active property</p><h2>'+esc(d.home&&d.home.name||"Home")+'</h2><p>'+esc(d.home&&d.home.address_label||"Persistent household record")+'</p></div><div class="hero-actions"><button class="button" id="home-issue">+ Issue</button><button class="primary-button" id="home-repair">+ Repair</button></div></div>';
    html+='<section class="metrics"><div class="metric"><span>Open issues</span><strong>'+d.summary.open_issues+'</strong></div><div class="metric"><span>Attention</span><strong>'+d.summary.systems_needing_attention+'</strong></div><div class="metric"><span>Overdue</span><strong>'+d.summary.overdue_maintenance+'</strong></div><div class="metric"><span>Assets</span><strong>'+total+'</strong></div><div class="metric"><span>Saved buys</span><strong>'+(d.summary.saved_purchases||0)+'</strong></div></section>';
    html+='<div class="grid">';
    html+='<section class="card"><div class="card-head"><h2>Needs attention</h2><button class="button" data-go="issues">All issues</button></div><div class="card-body rows">'+(d.attention.issues.slice(0,5).map(function(i){return row(i.title,i.asset_name+" · "+fmtDate(i.detected_at),badge(i.severity))}).join("")||'<div class="empty">No active issues.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Recent repairs</h2><button class="button" data-go="repairs">History</button></div><div class="card-body rows">'+(repairs.map(function(r){return row(r.title,r.asset_name+" · "+fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+"</span>",r.outcome||"")}).join("")||'<div class="empty">No repair records yet.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Upcoming</h2></div><div class="card-body rows">'+(d.upcoming.slice(0,5).map(function(m){return row(m.title,m.asset_name+" · "+fmtDate(m.next_due_at),'<span class="badge">'+Number(m.days_until)+"d</span>")}).join("")||'<div class="empty">Nothing due in the next 30 days.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Recurring charges</h2></div><div class="card-body rows">'+(charges.slice(0,5).map(function(c){return row(c.name,c.billing_cycle+" · "+(c.provider||c.category),'<span class="money">'+money(c.amount_cents)+"</span>")}).join("")||'<div class="empty">No recurring charges recorded.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Potential purchases</h2></div><div class="card-body rows">'+(purchases.slice(0,5).map(function(p){return row(p.title,p.category+" · "+p.status,'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+"</span>",p.rationale||"")}).join("")||'<div class="empty">No purchase research saved.</div>')+'</div></section>';
    html+='<section class="card"><div class="card-head"><h2>Recent memory</h2></div><div class="card-body rows">'+(d.recent.slice(0,5).map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")||'<div class="empty">No recent activity.</div>')+'</div></section></div>';
    content.innerHTML=html;$("#home-issue").onclick=openIssueForm;$("#home-repair").onclick=function(){openRepairForm()};$$("[data-go]").forEach(function(b){b.onclick=function(){navigate(b.dataset.go)}})
  }catch(e){fail(e)}
}

async function showIssues(){
  loading();
  try{
    const items=await api("/api/issues");
    let body=items.map(function(i){const active=!["RESOLVED","CLOSED"].includes(i.status);return '<div class="row"><button class="row-open" data-asset="'+esc(i.asset_id)+'"><div class="row-title">'+esc(i.title)+'</div><div class="row-meta">'+esc(i.asset_name)+" · detected "+fmtDate(i.detected_at)+'</div><div class="row-note">'+esc(i.description||"")+'</div></button><div class="row-actions">'+badge(i.severity)+badge(i.status)+(active?'<button class="button" data-repair="'+esc(i.id)+'">Repair</button><button class="button" data-resolve="'+esc(i.id)+'">Resolve</button>':"")+"</div></div>"}).join("");
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Problem register</p><h2>Issues</h2><p>Resolved history stays attached to the home.</p></div><div class="hero-actions"><button class="primary-button" id="new-issue">Report issue</button></div></div><section class="card"><div class="card-body rows">'+(body||'<div class="empty">No issues recorded.</div>')+"</div></section>";
    $("#new-issue").onclick=openIssueForm;
    $$("[data-resolve]").forEach(function(b){b.onclick=function(){openResolveForm(items.find(function(i){return i.id===b.dataset.resolve}))}});
    $$("[data-repair]").forEach(function(b){b.onclick=function(){openRepairForm(items.find(function(i){return i.id===b.dataset.repair}))}});
    $$("[data-asset]").forEach(function(b){b.onclick=function(){openAsset(b.dataset.asset)}})
  }catch(e){fail(e)}
}

async function showRepairs(){
  loading();
  try{
    const items=await api("/api/repairs");
    const body=items.map(function(r){return '<div class="row"><button class="row-open" data-asset="'+esc(r.asset_id)+'"><div class="row-title">'+esc(r.title)+'</div><div class="row-meta">'+esc(r.asset_name)+" · "+fmtDate(r.repair_date)+(r.contractor?" · "+esc(r.contractor):"")+'</div><div class="row-note">'+esc(r.outcome||r.description||"")+'</div></button><div class="row-actions"><span class="money">'+money(r.cost_cents)+"</span>"+(r.issue_title?'<span class="badge">ISSUE LINKED</span>':"")+"</div></div>"}).join("");
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Permanent history</p><h2>Repairs</h2><p>What was fixed, when, by whom and what it cost.</p></div><div class="hero-actions"><button class="primary-button" id="new-repair">Record repair</button></div></div><section class="card"><div class="card-body rows">'+(body||'<div class="empty">No repair records yet.</div>')+"</div></section>";
    $("#new-repair").onclick=function(){openRepairForm()};$$("[data-asset]").forEach(function(b){b.onclick=function(){openAsset(b.dataset.asset)}})
  }catch(e){fail(e)}
}

function renderAssets(items){
  $("#asset-results").innerHTML='<div class="table-wrap"><table><thead><tr><th>Asset</th><th>Condition</th><th>Health</th><th>System</th><th>Location</th><th>Purchase</th></tr></thead><tbody>'+items.map(function(a){return '<tr data-asset="'+esc(a.id)+'"><td><strong>'+esc(a.name)+'</strong><div class="row-meta">'+esc(a.manufacturer||"")+" "+esc(a.model||"")+'</div></td><td>'+badge(a.condition||"UNKNOWN")+"</td><td>"+badge(a.health)+"</td><td>"+esc(a.system_name)+"</td><td>"+esc(a.location||"—")+'</td><td>'+money(a.purchase_cost_cents)+"</td></tr>"}).join("")+"</tbody></table></div>";
  $$("[data-asset]",$("#asset-results")).forEach(function(r){r.onclick=function(){openAsset(r.dataset.asset)}})
}
async function showAppliances(){
  loading();
  try{
    state.assets=await api("/api/assets");
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Appliances & furniture</p><h2>Asset registry</h2><p>Condition, age, purchase information, faults, repairs and evidence.</p></div></div><div class="toolbar"><input class="search" id="asset-search" type="search" placeholder="Search assets, systems or rooms…"></div><div id="asset-results"></div>';
    renderAssets(state.assets);$("#asset-search").oninput=function(e){const q=e.target.value.toLowerCase().trim();renderAssets(state.assets.filter(function(a){return [a.name,a.system_name,a.location,a.manufacturer,a.model,a.category].some(function(v){return String(v||"").toLowerCase().includes(q)})}))}
  }catch(e){fail(e)}
}
async function openAsset(id){
  try{
    const a=await api("/api/assets/"+encodeURIComponent(id));
    let html='<p class="eyebrow">'+esc(a.system_name)+'</p><h2>'+esc(a.name)+'</h2><div class="hero-actions">'+badge(a.condition||"UNKNOWN")+badge(a.health)+'</div><div class="detail-grid">';
    [["Location",a.location||"—"],["Purchased",fmtDate(a.purchase_date)],["Purchase price",money(a.purchase_cost_cents)],["Manufacturer",a.manufacturer||"—"],["Model",a.model||"—"],["Warranty end",fmtDate(a.warranty_end)]].forEach(function(v){html+='<div class="detail"><span>'+esc(v[0])+'</span><strong>'+esc(v[1])+"</strong></div>"});
    html+="</div>";if(a.notes)html+='<div class="detail-section"><h3>Notes</h3><div class="row-note">'+esc(a.notes)+"</div></div>";
    html+='<div class="detail-section"><h3>Issues</h3><div class="rows">'+(a.issues.map(function(i){return row(i.title,fmtDate(i.detected_at)+" · "+i.severity,badge(i.status),i.description||"")}).join("")||'<div class="empty">No issues.</div>')+"</div></div>";
    html+='<div class="detail-section"><h3>Repairs</h3><div class="rows">'+((a.repairs||[]).map(function(r){return row(r.title,fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+"</span>",r.outcome||"")}).join("")||'<div class="empty">No repairs.</div>')+"</div></div>";
    html+='<div class="detail-section"><h3>Files</h3><div class="rows">'+(a.documents.map(function(d){return row(d.title,d.type,'<button class="button" data-file="'+esc(d.id)+'">Open</button>')}).join("")||'<div class="empty">No files.</div>')+"</div></div>";
    openModal(html);$$("[data-file]",modalBody).forEach(function(b){b.onclick=async function(){const docs=await api("/api/documents"),doc=docs.find(function(d){return d.id===b.dataset.file});if(doc)openFile(doc)}})
  }catch(e){notify(e.message)}
}

function fileHref(d){return String(d.web_view_link||d.local_path||d.source_url||"").trim()}
async function openFile(doc){
  const href=fileHref(doc);viewerTitle.textContent=doc.title||"File";viewerBody.innerHTML="";
  if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}
  if(!href){viewerBody.innerHTML='<div class="viewer-link"><div><strong>File metadata is recorded, but no viewable location is attached.</strong></div></div>';viewer.showModal();return}
  if(href.startsWith("/")){
    try{
      const res=await fetch(href);if(!res.ok)throw new Error("File unavailable");const blob=await res.blob();state.objectUrl=URL.createObjectURL(blob);const mt=doc.mime_type||blob.type||"";
      if(mt.startsWith("image/"))viewerBody.innerHTML='<img src="'+esc(state.objectUrl)+'" alt="">';
      else if(mt.startsWith("video/"))viewerBody.innerHTML='<video controls src="'+esc(state.objectUrl)+'"></video>';
      else viewerBody.innerHTML='<iframe title="'+esc(doc.title)+'" src="'+esc(state.objectUrl)+'"></iframe>'
    }catch(e){viewerBody.innerHTML='<div class="viewer-link"><div><strong>'+esc(e.message)+"</strong></div></div>"}
  }else viewerBody.innerHTML='<div class="viewer-link"><div><strong>'+esc(doc.title)+'</strong><div class="row-meta">External file · '+esc(doc.provider||"source")+'</div><a class="primary-button" href="'+esc(href)+'" target="_blank" rel="noreferrer">Open source</a></div></div>';
  viewer.showModal()
}
$("#viewer-close").onclick=function(){viewer.close()};
viewer.addEventListener("close",function(){if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}});

async function showFiles(){
  loading();
  try{
    const both=await Promise.all([api("/api/documents"),api("/api/integrations/status")]),docs=both[0],integrations=both[1],drive=integrations.googleDrive;
    content.innerHTML='<div class="hero"><div><p class="eyebrow">Household evidence</p><h2>Files</h2><p>Receipts, manuals, photos, videos, invoices and source links.</p></div><div class="hero-actions">'+(drive&&drive.enabled&&drive.configured&&!drive.connected?'<button class="button" id="drive-connect">Connect Drive</button>':"")+'</div></div><div class="file-grid">'+(docs.map(function(d){return '<button class="file-card" data-file="'+esc(d.id)+'"><div class="file-type">'+esc(d.type||"FILE")+" · "+esc(d.provider||"")+'</div><strong>'+esc(d.title)+'</strong><small>'+esc(d.asset_name||d.repair_title||d.issue_title||d.charge_name||d.purchase_title||"Home record")+" · "+fmtDate(d.occurred_at||d.created_at)+"</small></button>"}).join("")||'<div class="empty">No files recorded.</div>')+"</div>";
    if($("#drive-connect"))$("#drive-connect").onclick=function(){location.href="/api/google-drive/connect"};
    $$("[data-file]",content).forEach(function(b){b.onclick=function(){openFile(docs.find(function(d){return d.id===b.dataset.file}))}})
  }catch(e){fail(e)}
}

function messageMarkup(m){
  return '<article class="message '+m.role+'"><div class="message-role">'+(m.role==="user"?"You":"Homely")+'</div><p>'+esc(m.text)+'</p>'+(m.proposals||[]).map(function(p){return '<div class="proposal"><strong>'+esc(p.preview.title)+'</strong><div class="row-meta">'+esc(p.preview.summary)+'</div><div class="row-note">'+esc(p.reason)+'</div>'+(p.status==="PROPOSED"?'<div class="proposal-actions"><button class="button" data-reject="'+esc(p.transactionId)+'">Reject</button><button class="primary-button" data-approve="'+esc(p.transactionId)+'">Approve</button></div>':'<div class="row-meta">'+esc(p.status)+"</div>")+"</div>"}).join("")+"</article>"
}
function renderChat(){
  chatBody.innerHTML=state.agentMessages.length?state.agentMessages.map(messageMarkup).join(""):'<div class="chat-empty">Ask about this home, its history, files, repairs, costs or what to do next.</div>';
  $$("[data-approve]",chatBody).forEach(function(b){b.onclick=async function(){try{await api("/api/transactions/"+encodeURIComponent(b.dataset.approve)+"/commit",{method:"POST"});state.agentMessages.forEach(function(m){const p=m.proposals&&m.proposals.find(function(x){return x.transactionId===b.dataset.approve});if(p)p.status="COMMITTED"});renderChat();notify("Approved and committed.");await selectView(state.view)}catch(e){notify(e.message)}}});
  $$("[data-reject]",chatBody).forEach(function(b){b.onclick=async function(){try{await api("/api/transactions/"+encodeURIComponent(b.dataset.reject)+"/reject",{method:"POST"});state.agentMessages.forEach(function(m){const p=m.proposals&&m.proposals.find(function(x){return x.transactionId===b.dataset.reject});if(p)p.status="REJECTED"});renderChat();notify("Proposal rejected.")}catch(e){notify(e.message)}}});
  chatBody.scrollTop=chatBody.scrollHeight
}
chatForm.onsubmit=async function(e){
  e.preventDefault();const message=chatInput.value.trim();if(!message)return;
  state.agentMessages.push({role:"user",text:message,proposals:[]});chatInput.value="";renderChat();const button=chatForm.querySelector("button");button.disabled=true;button.textContent="Working…";
  try{const r=await api("/api/agent/respond",{method:"POST",body:{message:message,previousResponseId:state.previousResponseId}});state.previousResponseId=r.responseId;state.agentMessages.push({role:"assistant",text:r.text,proposals:(r.proposals||[]).map(function(p){return Object.assign({},p,{status:"PROPOSED"})})})}
  catch(err){state.agentMessages.push({role:"assistant",text:err.message,proposals:[]})}
  finally{button.disabled=!(state.integrations&&state.integrations.ai&&state.integrations.ai.available);button.textContent="Send";renderChat()}
};

const views={home:["Home",showHome],issues:["Issues",showIssues],repairs:["Repairs",showRepairs],appliances:["Appliances & furniture",showAppliances],files:["Files",showFiles]};
function normalizeView(v){if(v==="overview")return"home";if(v==="assets")return"appliances";if(v==="documents")return"files";return views[v]?v:"home"}
async function selectView(view){state.view=normalizeView(view);pageTitle.textContent=views[state.view][0];document.title=views[state.view][0]+" · Homely";$$(".nav-item").forEach(function(b){b.classList.toggle("active",b.dataset.view===state.view)});await views[state.view][1]()}
function navigate(view,replace){view=normalizeView(view);const url=view==="home"?"/":"/?view="+encodeURIComponent(view);if(replace)history.replaceState({view:view},"",url);else history.pushState({view:view},"",url);void selectView(view)}
nav.onclick=function(e){const b=e.target.closest("[data-view]");if(b)navigate(b.dataset.view,false)};
window.onpopstate=function(){selectView(new URLSearchParams(location.search).get("view")||"home")};
$("#logout-button").onclick=async function(){try{await api("/api/auth/logout",{method:"POST"})}finally{location.href="/auth/login"}};
$("#chat-open").onclick=function(){chatRail.classList.add("open")};$("#chat-close").onclick=function(){chatRail.classList.remove("open")};
const initial=normalizeView(new URLSearchParams(location.search).get("view")||"home");
void refreshStatus();void selectView(initial);renderChat();
