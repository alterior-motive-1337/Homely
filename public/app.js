import { renderMarkdown } from "./markdown.js";

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const content=$("#content"), pageTitle=$("#page-title"), nav=$("#nav");
const modal=$("#modal"), modalBody=$("#modal-body"), viewer=$("#viewer"), viewerBody=$("#viewer-body"), viewerTitle=$("#viewer-title");
const toast=$("#toast"), chatRail=$("#chat-rail"), chatBody=$("#chat-body"), chatForm=$("#chat-form"), chatInput=$("#chat-input"), voiceButton=$("#voice-button");
const agentState=$("#agent-state");
const state={view:"home",assets:[],agentMessages:[],previousResponseId:null,integrations:null,objectUrl:null,viewRevision:0,stopVoice:null,needsReload:false,viewLoadedAt:0,alerts:[],chatLoading:true,chatBusy:false};
const viewPanels=new Map();
const VIEW_CACHE_MS=45000;
const ACTIVE_REFRESH_MS=45000;
const LAYOUT_KEY="homely_workspace_layout_v1";
const workspaceLayout={assistant:{width:null,collapsed:false},files:{width:null,collapsed:false}};
try{
  const saved=JSON.parse(localStorage.getItem(LAYOUT_KEY)||"null");
  for(const name of Object.keys(workspaceLayout)){
    const pane=saved?.[name];
    if(pane){workspaceLayout[name].collapsed=pane.collapsed===true;if(Number.isFinite(pane.width))workspaceLayout[name].width=Math.max(180,Math.min(640,pane.width))}
  }
}catch(_){/* Layout remains usable when browser storage is unavailable. */}
function saveWorkspaceLayout(){try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(workspaceLayout))}catch(_){}}

function bindPanelResize({name,container,panel,handle,variable,min,max,mainMin,breakpoint}){
  const preference=workspaceLayout[name];
  if(preference.width!=null)container.style.setProperty(variable,preference.width+"px");
  const bounds=()=>({min,max:Math.max(min,Math.min(max,container.clientWidth-mainMin))});
  function updateAria(){const limits=bounds();handle.setAttribute("aria-valuemin",String(limits.min));handle.setAttribute("aria-valuemax",String(Math.round(limits.max)));const width=Math.round(panel.getBoundingClientRect().width);handle.setAttribute("aria-valuenow",String(width));handle.setAttribute("aria-valuetext",width+" pixels")}
  function setWidth(width){const limits=bounds();preference.width=Math.round(Math.max(limits.min,Math.min(limits.max,width)));container.style.setProperty(variable,preference.width+"px");updateAria()}
  function reset(){preference.width=null;container.style.removeProperty(variable);updateAria();saveWorkspaceLayout()}
  let drag=null;
  handle.onpointerdown=e=>{
    if(e.button!==0||!window.matchMedia("(min-width: "+breakpoint+"px)").matches)return;
    e.preventDefault();handle.focus();drag={id:e.pointerId,x:e.clientX,width:panel.getBoundingClientRect().width,preference:preference.width};
    handle.setPointerCapture(e.pointerId);document.body.classList.add("panel-resizing");
  };
  handle.onpointermove=e=>{if(drag?.id===e.pointerId)setWidth(drag.width+drag.x-e.clientX)};
  function finish(cancel=false){if(!drag)return;const previous=drag;drag=null;document.body.classList.remove("panel-resizing");if(cancel){preference.width=previous.preference;if(preference.width==null)container.style.removeProperty(variable);else container.style.setProperty(variable,preference.width+"px")}if(handle.hasPointerCapture(previous.id))handle.releasePointerCapture(previous.id);updateAria();saveWorkspaceLayout()}
  handle.onpointerup=()=>finish();handle.onpointercancel=()=>finish(true);handle.onlostpointercapture=()=>finish(true);
  handle.ondblclick=reset;
  handle.onkeydown=e=>{
    if(e.key==="Escape"&&drag){e.preventDefault();e.stopPropagation();finish(true);return}
    if(e.key==="Enter"){e.preventDefault();reset();return}
    const width=panel.getBoundingClientRect().width,step=e.shiftKey?50:20,limits=bounds();
    const next=e.key==="ArrowLeft"?width+step:e.key==="ArrowRight"?width-step:e.key==="Home"?limits.min:e.key==="End"?limits.max:null;
    if(next!=null){e.preventDefault();setWidth(next);saveWorkspaceLayout()}
  };
  const observer=new ResizeObserver(updateAria);observer.observe(panel);
  // File tabs are cached or rebuilt; release observers for detached panels.
  if(name==="files"){state.filePanelObserver?.disconnect();state.filePanelObserver=observer}
  updateAria();
}

function esc(v){return String(v==null?"":v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function fmtDate(v){return v?new Intl.DateTimeFormat("en-ZA",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(v)):"—"}
function assetAge(a){const value=a.acquired_at||a.purchase_date;if(!value)return"Unknown";const date=new Date(value),now=new Date();if(!Number.isFinite(date.getTime()))return"Unknown";let months=(now.getFullYear()-date.getFullYear())*12+now.getMonth()-date.getMonth();if(now.getDate()<date.getDate())months-=1;if(months<0)return"Not yet acquired";const years=Math.floor(months/12);return years?years+"y "+months%12+"m":months+"m"}
function money(c){return c==null?"—":new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR",maximumFractionDigits:0}).format(Number(c)/100)}
function today(){return new Date().toISOString().slice(0,10)}


async function api(path,options){
  const init=Object.assign({},options||{});
  if(init.body&&typeof init.body!=="string"&&!(init.body instanceof Blob)){init.headers=Object.assign({"content-type":"application/json"},init.headers||{});init.body=JSON.stringify(init.body)}
  const res=await fetch(path,init);let data=null;try{data=await res.json()}catch(_){}
  if(res.ok && (path.endsWith("/commit")||path.endsWith("/undo"))){
    viewPanels.clear();state.assets=[];state.needsReload=true;void refreshAlerts();
  }
  if(res.status===401){window.location.replace("/");throw new Error("Session expired. Please sign in again.")}
  if(!res.ok)throw new Error(data&&data.error?data.error:"Request failed: "+res.status);
  return data
}
function notify(message){toast.textContent=message;toast.classList.add("show");setTimeout(function(){toast.classList.remove("show")},2400)}
function loading(label){if(!state.silentRefresh)content.innerHTML='<div class="loading">'+esc(label||"Loading…")+"</div>"}
function fail(e){console.error(e);content.innerHTML='<div class="error">'+esc(e&&e.message?e.message:"Homely could not load this view.")+"</div>"}
function badge(v){return '<span class="badge '+esc(v||"")+'">'+esc(v||"UNKNOWN")+"</span>"}
function row(title,meta,right,note){return '<div class="row"><div><div class="row-title">'+esc(title)+'</div><div class="row-meta">'+esc(meta||"")+'</div>'+(note?'<div class="row-note">'+esc(note)+"</div>":"")+'</div><div class="row-actions">'+(right||"")+"</div></div>"}


function emptyState(title,buttons,compact=false){
  return '<section class="empty-state'+(compact?' compact':'')+'"><div class="empty-symbol" aria-hidden="true">'+fileIcon()+'</div><h2>'+esc(title)+'</h2>'
    +(buttons?'<div class="hero-actions">'+buttons+'</div>':'')+'</section>';
}
function fillForm(form,values){Object.entries(values).forEach(([name,value])=>{const input=form.elements.namedItem(name);if(input)input.value=value==null?"":String(value)})}

async function loadChatHistory(){
  try{const history=await api("/api/agent/history");state.agentMessages=history.messages||[];state.previousResponseId=history.previousResponseId;renderChat()}
  catch(e){notify(e.message)}
  finally{state.chatLoading=false;if(state.integrations)setRuntime(state.integrations)}
}
$("#clear-chat").onclick=()=>{
  if(state.chatBusy)return;
  openModal('<h2>Clear chat?</h2><p>Messages will be deleted.</p><div class="form-actions"><button class="button" id="cancel-clear">Cancel</button><button class="primary-button" id="confirm-clear">Clear chat</button></div>');
  $("#cancel-clear").onclick=closeModal;
  $("#confirm-clear").onclick=async()=>{try{await api("/api/agent/history",{method:"DELETE"});state.agentMessages=[];state.previousResponseId=null;renderChat();closeModal()}catch(e){notify(e.message)}};
};
const notifiedAlerts=new Set();
async function refreshAlerts(){
  try{
    state.alerts=(await api("/api/alerts")).alerts;
    const trigger=$("#alerts-trigger");trigger.hidden=!state.alerts.length;trigger.textContent="Alerts "+state.alerts.length;
    if("Notification" in window&&Notification.permission==="granted")state.alerts.forEach(alert=>{
      if(notifiedAlerts.has(alert.key))return;notifiedAlerts.add(alert.key);
      try{const notification=new Notification(alert.title,{body:alert.detail,tag:alert.key});notification.onclick=()=>{window.focus();void showAlerts();notification.close()}}catch(_){}
    });
  }catch(_){}
}
async function showAlerts(){
  await refreshAlerts();
  openModal('<h2>Alerts</h2>'+(("Notification" in window&&Notification.permission!=="granted")?'<button class="button" id="enable-notifications" type="button">Enable notifications</button>':'')+'<div class="rows">'+(state.alerts.map(a=>row(a.title,a.detail,badge(a.severity)+'<button class="button" data-alert-open="'+esc(a.key)+'">Open</button><button class="button" data-alert-ack="'+esc(a.key)+'">Acknowledge</button>'+(a.kind==="MAINTENANCE"?'<button class="button" data-maintenance-complete="'+esc(a.recordId)+'">Complete</button>':''))).join('')||'<div class="empty">No alerts.</div>')+'</div>');
  const enable=$("#enable-notifications");if(enable)enable.onclick=async()=>{const permission=await Notification.requestPermission();if(permission==="granted"){enable.hidden=true;await refreshAlerts()}};
  $$("[data-alert-ack]",modalBody).forEach(b=>b.onclick=async()=>{try{await api("/api/alerts/acknowledge",{method:"POST",body:{key:b.dataset.alertAck}});await showAlerts()}catch(e){notify(e.message)}});
  $$("[data-alert-open]",modalBody).forEach(b=>b.onclick=()=>{const alert=state.alerts.find(a=>a.key===b.dataset.alertOpen);if(alert)void openAsset(alert.assetId)});
  $$("[data-maintenance-complete]",modalBody).forEach(b=>b.onclick=()=>previewAction("COMPLETE_MAINTENANCE",{maintenanceId:b.dataset.maintenanceComplete,completedAt:today()},"Homeowner completed maintenance."));
}
$("#alerts-trigger").onclick=()=>void showAlerts();
function ledger(title,count,action,body,columns){
  return '<section class="ledger" aria-label="'+esc(title)+'">'
    +'<div class="ledger-rows" role="list">'+(body||'<div class="ledger-zero" role="status">No records</div>')+'</div></section>';
}
function linkedFilesButton(label,id){
  return '<button type="button" class="ledger-file-link" data-'+label+'="'+esc(id)+'" title="Open record and related files" aria-label="Open record and related files">'+fileIcon()+'<span>Files</span></button>';
}

function fileIcon(doc={}){
  const mime=String(doc.mime_type||doc.mimeType||'').toLowerCase();
  const paths=mime.startsWith('image/')?'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>':mime.startsWith('video/')?'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4z"/>':mime.startsWith('audio/')?'<path d="M9 18V5l11-2v13M9 5l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>';
  return '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
}

function quickSearch(label,id){
  return '<div class="quick-search">'
    +'<button type="button" class="icon-button search-toggle" title="Search '+esc(label)+'" aria-label="Search '+esc(label)+'" aria-expanded="false" aria-controls="'+id+'">'
    +'<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 5 5"/></svg></button>'
    +'<input class="search" id="'+id+'" type="search" placeholder="Search '+esc(label)+'" aria-label="Search '+esc(label)+'" hidden></div>';
}
content.addEventListener("click",event=>{
  const button=event.target.closest(".search-toggle");
  if(!button)return;
  const container=button.closest(".quick-search"),input=container?.querySelector("input");
  if(!container||!input)return;
  const open=button.getAttribute("aria-expanded")!=="true";
  button.setAttribute("aria-expanded",String(open));
  input.hidden=!open;
  if(open)input.focus();
  else{
    if(input.value){input.value="";input.dispatchEvent(new Event("input",{bubbles:true}))}
    button.focus();
  }
});
content.addEventListener("keydown",event=>{
  if(event.key!=="Escape")return;
  const container=event.target.closest(".quick-search");
  const button=container?.querySelector(".search-toggle");
  if(!button||button.getAttribute("aria-expanded")!=="true")return;
  event.preventDefault();event.stopPropagation();button.click();
});

function registerTools(label,status=false,action="",count=0){
  return '<div class="register-tools page-controls"><div class="controls-leading">'+quickSearch(label,"record-search")
    +(status?'<div class="register-filters" aria-label="Issue status"><button type="button" data-status="all" aria-pressed="true">All</button><button type="button" data-status="open" aria-pressed="false">Open</button><button type="button" data-status="resolved" aria-pressed="false">Resolved</button></div>':'')
    +'</div><span class="search-count" id="search-count" role="status">'+count+' '+(count===1?'entry':'entries')+'</span>'
    +'<div class="controls-actions">'+action+'</div></div>';
}
function bindRegisterSearch(items,textFor,isOpen){
  const search=$("#record-search"),entries=$$(".ledger-entry",content);
  let status="all";
  const empty=document.createElement("div");empty.className="search-empty";empty.hidden=true;
  empty.innerHTML='<strong>No matching records</strong>';
  $(".ledger-rows",content).appendChild(empty);
  function update(){
    const query=search.value.trim().toLowerCase();let count=0;
    entries.forEach((entry,index)=>{const item=items[index];const matches=textFor(item).toLowerCase().includes(query)&&(!isOpen||status==="all"||(status==="open"?isOpen(item):!isOpen(item)));entry.hidden=!matches;if(matches)count++});
    empty.hidden=!items.length||count>0;
    $("#search-count").textContent=query||status!=="all"?count+" of "+items.length:items.length+" "+(items.length===1?"entry":"entries");
    $("#search-count").classList.toggle("is-filtered",Boolean(query||status!=="all"));
  }
  search.oninput=update;
  $$("[data-status]",content).forEach(button=>button.onclick=()=>{status=button.dataset.status;$$("[data-status]",content).forEach(b=>b.setAttribute("aria-pressed",String(b===button)));update()});
}

function setRuntime(x){
  state.integrations=x;
  const ai=x&&x.ai;
  agentState.textContent=ai&&ai.available?"Ready":"Chat unavailable";
  chatInput.disabled=!(ai&&ai.available)||state.chatLoading;
  chatForm.querySelector('button[type="submit"]').disabled=!(ai&&ai.available)||state.chatLoading||state.chatBusy;
  voiceButton.disabled=!(ai&&ai.available);
  chatInput.placeholder=ai&&ai.available?"Ask Homely…":"Chat unavailable";
}
async function refreshStatus(){
  try{setRuntime(await api("/api/integrations/status"))}
  catch(_){agentState.textContent="Chat unavailable"}
}

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
  $("#reject-preview").onclick=async function(){await api("/api/transactions/"+encodeURIComponent(t.id)+"/reject",{method:"POST"});closeModal();notify("Proposal rejected.")};
  $("#commit-preview").onclick=async function(){await api("/api/transactions/"+encodeURIComponent(t.id)+"/commit",{method:"POST"});closeModal();notify(actionType==="RECORD_REPAIR"?"Repair recorded.":"Saved.");await selectView(state.view)}
}

async function openIssueForm(){
  const options=await assetOptions("");
  openModal('<h2>Report a problem</h2><form class="form" id="issue-form"><div class="form-grid"><div class="field full"><label>Asset</label><select name="assetId" required>'+options+'</select></div><div class="field"><label>Title</label><input name="title" maxlength="160" required></div><div class="field"><label>Severity</label><select name="severity"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></div><div class="field"><label>Detected</label><input type="date" name="detectedAt" value="'+today()+'" required></div><div class="field full"><label>Description</label><textarea name="description"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#issue-form").onsubmit=async function(e){e.preventDefault();const d=new FormData(e.currentTarget);await previewAction("REPORT_ISSUE",{assetId:d.get("assetId"),title:d.get("title"),severity:d.get("severity"),description:d.get("description"),detectedAt:d.get("detectedAt")},"Homeowner reported an issue through Homely.")}
}
function openResolveForm(issue){
  openModal('<p class="eyebrow">Resolve issue</p><h2>'+esc(issue.title)+'</h2><form class="form" id="resolve-form"><div class="form-grid"><div class="field"><label>Resolved</label><input type="date" name="resolvedAt" value="'+today()+'" required></div><div class="field full"><label>Resolution</label><textarea name="resolution" required></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#resolve-form").onsubmit=async function(e){e.preventDefault();const d=new FormData(e.currentTarget);await previewAction("RESOLVE_ISSUE",{issueId:issue.id,resolvedAt:d.get("resolvedAt"),resolution:d.get("resolution")},"Homeowner marked the issue resolved.")}
}
async function openRepairForm(prefill){
  prefill=prefill||{};
  const options=await assetOptions(prefill.asset_id||"");
  const issues=await api("/api/issues");
  const issueOpts=['<option value="">None</option>'].concat(issues.map(function(i){return '<option value="'+esc(i.id)+'" '+(i.id===prefill.id?"selected":"")+">"+esc(i.title)+" · "+esc(i.asset_name)+"</option>"})).join("");
  const title=prefill.title?"Repair: "+prefill.title:"";
  openModal('<h2>Record a repair</h2><form class="form" id="repair-form"><div class="form-grid"><div class="field full"><label>Asset</label><select name="assetId" required>'+options+'</select></div><div class="field full"><label>Linked issue</label><select name="issueId">'+issueOpts+'</select></div><div class="field full"><label>Repair title</label><input name="title" maxlength="180" required value="'+esc(title)+'"></div><div class="field"><label>Date</label><input type="date" name="repairDate" value="'+today()+'" required></div><div class="field"><label>Cost (ZAR)</label><input type="number" name="cost" min="0" step=".01" placeholder="0.00"></div><div class="field full"><label>Contractor / person</label><input name="contractor" maxlength="240"></div><div class="field full"><label>Work performed</label><textarea name="description"></textarea></div><div class="field full"><label>Outcome</label><textarea name="outcome"></textarea></div></div><div class="row-note">Permanent record.</div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  $("#repair-form").onsubmit=async function(e){e.preventDefault();const d=new FormData(e.currentTarget),cost=String(d.get("cost")||"").trim();await previewAction("RECORD_REPAIR",{assetId:d.get("assetId"),issueId:d.get("issueId")||null,title:d.get("title"),repairDate:d.get("repairDate"),costCents:cost?Math.round(Number(cost)*100):null,contractor:d.get("contractor"),description:d.get("description"),outcome:d.get("outcome")},"Homeowner recorded completed repair work.")}
}

function openChargeForm(existing){
  existing=existing||null;
  openModal('<h2>'+ (existing?'Edit charge':'Add recurring charge') +'</h2><form class="form" id="charge-form"><div class="form-grid"><div class="field full"><label>Name</label><input name="name" maxlength="180" required></div><div class="field"><label>Category</label><input name="category" maxlength="80" required></div><div class="field"><label>Amount (ZAR)</label><input type="number" name="amount" min="0" step=".01" required></div><div class="field"><label>Billing cycle</label><select name="billingCycle"><option selected>MONTHLY</option><option>QUARTERLY</option><option>ANNUAL</option><option>OTHER</option></select></div><div class="field"><label>Due day</label><input type="number" name="dueDay" min="1" max="31"></div><div class="field"><label>Activity</label><select name="active"><option value="1">Active</option><option value="0">Inactive</option></select></div><div class="field full"><label>Provider</label><input name="provider" maxlength="240"></div><div class="field full"><label>Notes</label><textarea name="notes"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  if(existing)fillForm($("#charge-form"),{name:existing.name,category:existing.category,amount:Number(existing.amount_cents)/100,billingCycle:existing.billing_cycle,dueDay:existing.due_day,provider:existing.provider,notes:existing.notes,active:existing.active});
  $("#charge-form").onsubmit=async function(e){
    e.preventDefault();const d=new FormData(e.currentTarget),amount=String(d.get("amount")||"").trim(),due=String(d.get("dueDay")||"").trim();
    await previewAction(existing?"UPDATE_CHARGE":"CREATE_CHARGE",{...(existing?{chargeId:existing.id}:{}),active:Number(d.get("active")),name:d.get("name"),category:d.get("category"),amountCents:Math.round(Number(amount)*100),billingCycle:d.get("billingCycle"),dueDay:due?Number(due):null,provider:d.get("provider"),notes:d.get("notes")},"Homeowner recorded a recurring household charge.");
  };
}

async function openPurchaseForm(existing){
  existing=existing||null;
  const options=await assetOptions("");
  const optionalAssets='<option value="">None</option>'+options;
  openModal('<h2>'+(existing?"Edit purchase":"Save potential purchase")+'</h2><form class="form" id="purchase-form"><div class="form-grid"><div class="field full"><label>Title</label><input name="title" maxlength="220" required></div><div class="field"><label>Category</label><input name="category" maxlength="80" required></div><div class="field"><label>Status</label><select name="status"><option selected>SAVED</option><option>SHORTLISTED</option>'+(existing?'<option>PURCHASED</option><option>DISMISSED</option>':'')+'</select></div><div class="field full"><label>Related asset</label><select name="assetId">'+optionalAssets+'</select></div><div class="field"><label>Budget (ZAR)</label><input type="number" name="budget" min="0" step=".01"></div><div class="field"><label>Expected cost (ZAR)</label><input type="number" name="expected" min="0" step=".01"></div><div class="field full"><label>Source name</label><input name="sourceName" maxlength="240"></div><div class="field full"><label>Source URL</label><input type="url" name="sourceUrl" maxlength="2000" placeholder="https://…"></div><div class="field full"><label>Reason</label><textarea name="rationale"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  if(existing)fillForm($("#purchase-form"),{title:existing.title,category:existing.category,status:existing.status,assetId:existing.asset_id,budget:existing.budget_cents==null?null:Number(existing.budget_cents)/100,expected:existing.expected_cost_cents==null?null:Number(existing.expected_cost_cents)/100,sourceName:existing.source_name,sourceUrl:existing.source_url,rationale:existing.rationale});
  $("#purchase-form").onsubmit=async function(e){
    e.preventDefault();const d=new FormData(e.currentTarget),budget=String(d.get("budget")||"").trim(),expected=String(d.get("expected")||"").trim();
    await previewAction(existing?"UPDATE_PURCHASE":"SAVE_PURCHASE",{...(existing?{purchaseCandidateId:existing.id}:{}),assetId:d.get("assetId")||null,title:d.get("title"),category:d.get("category"),status:d.get("status"),budgetCents:budget?Math.round(Number(budget)*100):null,expectedCostCents:expected?Math.round(Number(expected)*100):null,sourceUrl:d.get("sourceUrl"),sourceName:d.get("sourceName"),rationale:d.get("rationale")},"Homeowner saved a potential household purchase.");
  };
}

async function showHome(){
  loading();const revision=state.viewRevision;
  try{
    const [d,assets]=await Promise.all([api("/api/overview"),api("/api/assets")]);
    if(revision!==state.viewRevision)return;
    state.assets=assets;
    const memory=d.memory||{},repairs=memory.repairs||[],charges=memory.charges||[],purchases=memory.purchases||[];
    const upcoming=d.upcoming||[],recent=d.recent||[],summary=d.summary||{};
    const attention=(d.attention?.issues||[]).map(i=>row(i.title,i.asset_name,badge(i.severity)))
      .concat((d.attention?.maintenance||[]).map(m=>row(m.title,m.asset_name+" · "+m.days_overdue+" days overdue",badge("OVERDUE"))));
    const homeName=d.home?.name||"My Home";
    pageTitle.textContent=homeName;
    document.title=homeName+" · Homely";
    if(!assets.length&&!repairs.length&&!charges.length&&!purchases.length&&!recent.length){
      content.innerHTML='<section class="home-empty"><h2>No assets</h2><p>Your home record is empty.</p>'
        +'<div class="home-empty-actions"><button class="primary-button" id="home-first-asset">Register asset</button><button class="button" id="home-first-file">Upload file</button></div></section>';
      $("#home-first-asset").onclick=()=>openAssetForm();
      $("#home-first-file").onclick=()=>openUploadEvidenceForm();
      return;
    }
    const quiet=!attention.length&&!upcoming.length&&!repairs.length&&!charges.length&&!purchases.length;
    let html='<div class="home-overview'+(quiet?' home-overview-quiet':'')+'">';
    html+='<section class="metrics" aria-label="Household overview">'
      +'<div class="metric"><span>Registered assets</span><strong>'+assets.length+'</strong></div>'
      +'<div class="metric"><span>Open issues</span><strong>'+Number(summary.open_issues||0)+'</strong></div>'
      +'<div class="metric"><span>Overdue</span><strong>'+Number(summary.overdue_maintenance||0)+'</strong></div>'
      +'</section>';
    if(Number(summary.systems_needing_attention||0)>0&&!attention.length){
      html+='<p class="home-attention-note">'+Number(summary.systems_needing_attention)+' systems need attention</p>';
    }
    if(attention.length||upcoming.length){
      html+='<div class="home-priority">';
      if(attention.length)html+='<section class="card"><div class="card-head"><h2>Needs attention</h2><button class="ghost-link" data-go="issues">View issues</button></div><div class="card-body rows">'+attention.slice(0,4).join("")+'</div></section>';
      if(upcoming.length)html+='<section class="card"><div class="card-head"><h2>Coming up</h2><span class="row-meta">Next 30 days</span></div><div class="card-body rows">'+upcoming.slice(0,4).map(m=>row(m.title,m.asset_name+' · '+fmtDate(m.next_due_at),'<span class="badge">'+Number(m.days_until)+'d</span>')).join("")+'</div></section>';
      html+='</div>';
    }
    if(repairs.length||charges.length||purchases.length){
      html+='<div class="home-memory">';
      if(repairs.length)html+='<section class="card"><div class="card-head"><h2>Recent repairs</h2><button class="ghost-link" data-go="repairs">View all</button></div><div class="card-body rows">'+repairs.slice(0,3).map(r=>row(r.title,fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+'</span>')).join("")+'</div></section>';
      if(charges.length)html+='<section class="card"><div class="card-head"><h2>Charges</h2><button class="ghost-link" id="view-charges">View all</button></div><div class="card-body rows">'+charges.slice(0,3).map(c=>row(c.name,c.billing_cycle,'<span class="money">'+money(c.amount_cents)+'</span>')).join("")+'</div></section>';
      if(purchases.length)html+='<section class="card"><div class="card-head"><h2>Saved purchases</h2><button class="ghost-link" id="view-purchases">View all</button></div><div class="card-body rows">'+purchases.slice(0,3).map(p=>row(p.title,p.status,'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+'</span>')).join("")+'</div></section>';
      html+='</div>';
    }
    if(recent.length||assets.length){
      html+='<section class="home-recent" aria-label="Recent home records">';
      if(recent.length){
        html+='<div class="home-recent-list">'+recent.slice(0,3).map(e=>'<div class="home-recent-item"><span class="home-recent-name">'+esc(e.title)+'</span><span class="home-recent-detail">'+fmtDate(e.occurred_at)+'</span></div>').join("")+'</div>';
      }else{
        html+='<div class="home-recent-list">'+assets.slice(0,3).map(a=>'<button class="home-recent-item" type="button" data-home-asset="'+esc(a.id)+'"><span class="home-recent-name">'+esc(a.name)+'</span><span class="home-recent-detail">'+esc(a.category||"Asset")+'</span></button>').join("")+'</div>';
      }
      html+='<div class="home-recent-tail"><button class="ghost-link" '+(recent.length?'id="home-history-link"':'data-go="appliances"')+'>'+(recent.length?'History':'View all')+'</button></div></section>';
    }
    html+='<nav class="home-utilities" aria-label="Other home records"><div class="utility-links"><button class="ghost-link" id="view-charges-shortcut">Charges</button><button class="ghost-link" id="view-purchases-shortcut">Purchases</button><button class="ghost-link" id="view-history">History</button></div></nav></div>';
    content.innerHTML=html;
    const chargesBtn=$("#view-charges");if(chargesBtn)chargesBtn.onclick=showCharges;
    const purchasesBtn=$("#view-purchases");if(purchasesBtn)purchasesBtn.onclick=showPurchases;
    const historyBtn=$("#home-history-link");if(historyBtn)historyBtn.onclick=showHistory;
    $("#view-charges-shortcut").onclick=showCharges;
    $("#view-purchases-shortcut").onclick=showPurchases;
    $("#view-history").onclick=showHistory;
    $$("[data-go]",content).forEach(b=>b.onclick=()=>navigate(b.dataset.go));
    $$("[data-home-asset]",content).forEach(b=>b.onclick=()=>openAsset(b.dataset.homeAsset));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

async function showCharges(){
  try{const items=await api("/api/charges");openModal('<div class="card-head"><h2>Recurring charges</h2><button class="button" id="add-charge">+ Charge</button></div><div class="rows">'+(items.map(function(c){return row(c.name,c.billing_cycle+" · "+(c.provider||c.category),'<span class="money">'+money(c.amount_cents)+'</span>'+badge(Number(c.active)?'ACTIVE':'INACTIVE')+'<button class="button" data-charge-edit="'+esc(c.id)+'">Edit</button>',c.notes||"")}).join("")||'<div class="empty">No charges.</div>')+'</div>');$("#add-charge").onclick=()=>openChargeForm();$$("[data-charge-edit]",modalBody).forEach(b=>b.onclick=()=>openChargeForm(items.find(c=>c.id===b.dataset.chargeEdit)))}catch(e){notify(e.message)}
}
async function showPurchases(){
  try{const items=await api("/api/purchases");openModal('<div class="card-head"><h2>Potential purchases</h2><button class="button" id="add-purchase">+ Save</button></div><div class="rows">'+(items.map(function(p){return row(p.title,p.category+" · "+p.status,'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+'</span><button class="button" data-purchase-edit="'+esc(p.id)+'">Edit</button>',p.rationale||"")}).join("")||'<div class="empty">No purchases.</div>')+'</div>');$("#add-purchase").onclick=()=>openPurchaseForm();$$("[data-purchase-edit]",modalBody).forEach(b=>b.onclick=()=>openPurchaseForm(items.find(p=>p.id===b.dataset.purchaseEdit)))}catch(e){notify(e.message)}
}
async function showHistory(){
  try{
    const results=await Promise.all([api("/api/timeline"),api("/api/transactions")]);
    const permanent=["REPORT_ISSUE","RESOLVE_ISSUE","RECORD_REPAIR"];
    openModal('<h2>Home history</h2><div class="rows">'+results[0].map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")+'</div><div class="detail-section"><h3>Changes</h3><div class="rows">'+(results[1].map(function(t){return row(t.action_type.replaceAll("_"," "),fmtDate(t.created_at),badge(t.status)+(t.status==="COMMITTED"&&!permanent.includes(t.action_type)?'<button class="button" data-undo="'+esc(t.id)+'">Undo</button>':""),t.reason)}).join("")||'<div class="empty">No changes.</div>')+'</div></div>');
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
      return '<div class="ledger-entry" role="listitem"><button type="button" class="ledger-main" data-issue-open="'+esc(item.id)+'"><span class="ledger-entry-content"><strong>'+esc(item.title)+'</strong><small>'+esc(item.asset_name||"Home")+'</small></span></button>'
        +'<div class="ledger-details"><span>'+fmtDate(item.detected_at)+'</span>'+badge(item.status)+badge(item.severity)+'</div>'
        +'<div class="ledger-actions">'+linkedFilesButton("issue-files",item.id)
        +(active?'<button class="ledger-quiet-action" type="button" data-repair="'+esc(item.id)+'">Repair</button><button class="ledger-quiet-action" type="button" data-resolve="'+esc(item.id)+'">Resolve</button>':'')
        +'</div></div>';
    }).join("");
    content.innerHTML=registerTools("issues",true,action,items.length)+ledger("Issues",items.length,"",body,"Issue");
    bindRegisterSearch(items,i=>[i.title,i.asset_name,i.description,i.status,i.severity].filter(Boolean).join(" "),i=>!["RESOLVED","CLOSED"].includes(i.status));
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
    const body=items.map((r,index)=>'<div class="ledger-entry" role="listitem"><button type="button" class="ledger-main" data-repair-open="'+esc(r.id)+'"><span class="ledger-entry-content"><strong>'+esc(r.title)+'</strong><small>'+esc(r.asset_name||"Home")+'</small></span></button><div class="ledger-details"><span>'+fmtDate(r.repair_date)+'</span><strong class="money">'+money(r.cost_cents)+'</strong></div><div class="ledger-actions">'+linkedFilesButton("repair-files",r.id)+'</div></div>').join("");
    content.innerHTML=registerTools("repairs",false,action,items.length)+ledger("Repairs",items.length,"",body,"Repair");
    bindRegisterSearch(items,r=>[r.title,r.asset_name,r.contractor,r.description,r.outcome].filter(Boolean).join(" "));
    const add=$("#new-repair");if(add)add.onclick=()=>openRepairForm();
    const register=$("#new-asset");if(register)register.onclick=()=>openAssetForm();
    $$("[data-repair-open]",content).forEach(b=>b.onclick=()=>openRepair(items.find(r=>r.id===b.dataset.repairOpen)));
    $$("[data-repair-files]",content).forEach(b=>b.onclick=()=>openRepair(items.find(r=>r.id===b.dataset.repairFiles)));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function evidenceMarkup(docs){return '<div class="detail-section"><h3>Files</h3><div class="rows">'+(docs.map(function(d){return row(d.title,d.type+" · "+fmtDate(d.occurred_at||d.created_at),'<button class="button" data-evidence="'+esc(d.id)+'">Open</button>',d.evidence_reason||"")}).join("")||'<div class="empty">No files.</div>')+'</div></div>'}
function bindEvidence(docs){$$("[data-evidence]",modalBody).forEach(function(b){b.onclick=function(){openFile(docs.find(function(d){return d.id===b.dataset.evidence}))}})}
async function openIssue(issue){
  if(!issue)return;
  try{const results=await Promise.all([api("/api/documents"),api("/api/assets/"+encodeURIComponent(issue.asset_id))]),docs=results[0].filter(function(d){return d.issue_id===issue.id}),history=(results[1].history||[]).filter(function(e){return e.issue_id===issue.id});
    openModal('<p class="eyebrow">Issue · '+esc(issue.asset_name)+'</p><h2>'+esc(issue.title)+'</h2><div class="hero-actions">'+badge(issue.status)+badge(issue.severity)+'</div><div class="detail-grid"><div class="detail"><span>Detected</span><strong>'+fmtDate(issue.detected_at)+'</strong></div><div class="detail"><span>Resolved</span><strong>'+fmtDate(issue.resolved_at)+'</strong></div></div><p>'+esc(issue.description||"—")+'</p>'+(history.length?'<div class="detail-section"><h3>History</h3><div class="rows">'+history.map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")+'</div></div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="issue-attach">Attach file</button><button class="button" id="issue-asset">View asset</button>'+(!["RESOLVED","CLOSED"].includes(issue.status)?'<button class="button" id="issue-repair">Record repair</button><button class="primary-button" id="issue-resolve">Resolve</button>':"")+'</div>');
    bindEvidence(docs);$("#issue-attach").onclick=function(){openUploadEvidenceForm({assetId:issue.asset_id,issueId:issue.id})};$("#issue-asset").onclick=function(){openAsset(issue.asset_id)};if($("#issue-repair"))$("#issue-repair").onclick=function(){openRepairForm(issue)};if($("#issue-resolve"))$("#issue-resolve").onclick=function(){openResolveForm(issue)};
  }catch(e){notify(e.message)}
}
async function openRepair(repair){
  if(!repair)return;
  try{const docs=(await api("/api/documents")).filter(function(d){return d.repair_id===repair.id});
    openModal('<p class="eyebrow">Repair · '+esc(repair.asset_name)+'</p><h2>'+esc(repair.title)+'</h2><div class="detail-grid">'+[["Date",fmtDate(repair.repair_date)],["Cost",money(repair.cost_cents)],["Contractor",repair.contractor||"—"]].map(function(pair){return '<div class="detail"><span>'+esc(pair[0])+'</span><strong>'+esc(pair[1])+'</strong></div>'}).join("")+'</div><div class="detail-section"><h3>Work performed</h3><p>'+esc(repair.description||"—")+'</p></div><div class="detail-section"><h3>Outcome</h3><p>'+esc(repair.outcome||"—")+'</p></div>'+(repair.issue_title?'<div class="row-meta">Issue: '+esc(repair.issue_title)+'</div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="repair-attach">Attach file</button><button class="button" id="repair-asset">View asset</button></div>');bindEvidence(docs);$("#repair-attach").onclick=function(){openUploadEvidenceForm({assetId:repair.asset_id,repairId:repair.id})};$("#repair-asset").onclick=function(){openAsset(repair.asset_id)};
  }catch(e){notify(e.message)}
}


async function openAssetForm(existing){
  const systems=await api("/api/systems");
  const options=systems.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>'}).join("");
  if(!options){notify("No home systems available.");return}
  openModal('<h2>'+(existing?"Edit appliance or furniture":"Register appliance or furniture")+'</h2><form class="form" id="asset-form"><div class="form-grid"><div class="field"><label>System</label><select name="systemId" required>'+options+'</select></div><div class="field"><label>Category</label><input name="category" maxlength="80" required></div><div class="field full"><label>Name</label><input name="name" maxlength="180" required></div><div class="field"><label>Condition</label><select name="condition"><option>UNKNOWN</option><option>NEW</option><option>GOOD</option><option>FAIR</option><option>POOR</option><option>FAILED</option></select></div><div class="field"><label>Room or location</label><input name="location" maxlength="200"></div><div class="field"><label>Manufacturer</label><input name="manufacturer" maxlength="160"></div><div class="field"><label>Model</label><input name="model" maxlength="160"></div><div class="field full"><label>Serial number</label><input name="serialNumber" maxlength="160"></div><div class="field"><label>Purchase date</label><input name="purchaseDate" type="date"></div><div class="field"><label>Purchase price (ZAR)</label><input name="purchaseCost" type="number" min="0" step=".01"></div><div class="field"><label>Warranty end</label><input name="warrantyEnd" type="date"></div><div class="field full"><label>Notes</label><textarea name="notes" maxlength="3000"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
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
  const body=items.map((a,index)=>'<div class="ledger-entry" role="listitem"><button type="button" class="ledger-main" data-asset="'+esc(a.id)+'"><span class="ledger-entry-content"><strong>'+esc(a.name)+'</strong><small>'+esc([a.category,a.location].filter(Boolean).join(" · ")||a.system_name||"Household asset")+'</small></span></button><div class="ledger-details">'+badge(a.condition||"UNKNOWN")+'<span>'+money(a.purchase_cost_cents)+'</span></div><div class="ledger-actions"><button type="button" class="ledger-file-link" data-asset-file="'+esc(a.id)+'" aria-label="Open asset and associated files">▤ <span>Files</span></button></div></div>').join("");
  target.innerHTML=ledger("Appliances & furniture",items.length,"",body,"Asset");
  const count=$("#asset-count");
  if(count)count.textContent=items.length+" "+(items.length===1?"entry":"entries");
  $$("[data-asset]",target).forEach(b=>b.onclick=()=>openAsset(b.dataset.asset));
  $$("[data-asset-file]",target).forEach(b=>b.onclick=()=>openAsset(b.dataset.assetFile));
}
async function showAppliances(){
  loading();const revision=state.viewRevision;
  try{
    state.assets=await api("/api/assets");
    if(revision!==state.viewRevision)return;
    content.innerHTML='<div class="register-search page-controls"><div class="controls-leading">'+quickSearch("assets","asset-search")+'</div><span class="search-count" id="asset-count"></span><div class="controls-actions"><button type="button" class="primary-button" id="new-asset">+ Register asset</button></div></div><div id="asset-results"></div>';
    $("#new-asset").onclick=()=>openAssetForm();
    renderAssets(state.assets);
    $("#asset-search").oninput=e=>{const q=e.target.value.toLowerCase().trim();renderAssets(state.assets.filter(a=>[a.name,a.system_name,a.location,a.manufacturer,a.model,a.category].some(v=>String(v||"").toLowerCase().includes(q))));$("#asset-count")?.classList.toggle("is-filtered",Boolean(q))};
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
    openModal(html);$("#edit-asset").onclick=function(){openAssetForm(a)};$$("[data-file]",modalBody).forEach(function(b){b.onclick=async function(){try{const docs=await api("/api/documents"),doc=docs.find(function(d){return d.id===b.dataset.file});if(doc)await openFile(doc)}catch(e){notify(e.message)}}})
  }catch(e){notify(e.message)}
}

function fileHref(d){const raw=String(d.web_view_link||d.local_path||d.source_url||"").trim();try{const url=new URL(raw,location.origin);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password?url.href:""}catch(_){return""}}
async function sampleVideoFrames(video){
  function wait(event){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error("Video could not be sampled.")),15_000);
    const ready=()=>finish(),error=()=>finish(new Error("Video unavailable."));
    function finish(err){clearTimeout(timer);video.removeEventListener(event,ready);video.removeEventListener("error",error);err?reject(err):resolve()}
    video.addEventListener(event,ready,{once:true});video.addEventListener("error",error,{once:true});
  })}
  if(!video)throw new Error("Open the video first.");
  const previous=video.currentTime,playing=!video.paused;video.pause();
  try{
    if(video.readyState<2){const ready=wait("loadeddata");video.preload="auto";video.load();await ready}
    if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error("Video duration unavailable.");
    const canvas=document.createElement("canvas"),scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    const context=canvas.getContext("2d"),frames=[];
    for(const fraction of [.05,.5,.95]){
      const time=video.duration*fraction;
      if(Math.abs(video.currentTime-time)>.01){const seek=wait("seeked");video.currentTime=time;await seek}
      context.drawImage(video,0,0,canvas.width,canvas.height);
      frames.push({image:canvas.toDataURL("image/jpeg",.6),timeSeconds:Math.round(time*100)/100});
    }
    return frames;
  }finally{video.currentTime=previous;if(playing)void video.play().catch(()=>{})}
}
async function openFile(doc){
  const revision=state.viewerRevision=(state.viewerRevision||0)+1;
  if(state.stopVoice)state.stopVoice();
  const href=fileHref(doc),mime=String(doc.mime_type||"");
  const stored=String(doc.local_path||"").startsWith("/api/files/");
  viewerTitle.textContent=doc.title||"File";viewerBody.innerHTML="";
  const insight=$("#viewer-insight"),analyze=$("#analyze-file");
  insight.textContent="";insight.hidden=true;
  if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}
  analyze.hidden=!stored || !/^(image\/(png|jpeg|webp)|audio\/|video\/(mp4|webm)|text\/(plain|csv)|application\/(json|pdf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))/.test(mime);
  analyze.disabled=false;analyze.textContent="Analyze";
  analyze.onclick=async function(){
    analyze.disabled=true;analyze.textContent="Analyzing…";
    insight.hidden=false;insight.textContent="Processing stored evidence…";
    try{
      const visualFrames=mime.startsWith("video/")?await sampleVideoFrames($("video",viewerBody)):undefined;
      if(revision!==state.viewerRevision)return;
      const result=await api("/api/documents/"+encodeURIComponent(doc.id)+"/analyze",{method:"POST",body:visualFrames?{visualFrames}:{}});
      if(revision===state.viewerRevision)insight.textContent=result.text;
    }catch(e){if(revision===state.viewerRevision)insight.textContent=e.message}
    finally{if(revision===state.viewerRevision){analyze.disabled=false;analyze.textContent="Analyze"}}
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
viewer.addEventListener("close",function(){state.viewerRevision=(state.viewerRevision||0)+1;$("#viewer-insight").hidden=true;if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}});

async function openLinkEvidenceForm(){
  const results=await Promise.all([assetOptions(""),api("/api/issues"),api("/api/repairs"),api("/api/charges"),api("/api/purchases")]);
  const options=results[0],issues=results[1],repairs=results[2],charges=results[3],purchases=results[4];
  const optional=function(label,items,display){return '<option value="">'+esc(label)+'</option>'+items.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(display(x))+'</option>'}).join("")};
  const assetOptionsHtml='<option value="">None</option>'+options;
  openModal('<h2>Save a source link</h2><form class="form" id="link-evidence-form"><div class="form-grid"><div class="field full"><label>Source URL</label><input type="url" name="sourceUrl" maxlength="2000" placeholder="https://…" required></div><div class="field full"><label>Title</label><input name="title" maxlength="240" required></div><div class="field"><label>Type</label><select name="documentType"><option>WARRANTY</option><option>MANUAL</option><option>INVOICE</option><option>RECEIPT</option><option>INSPECTION</option><option>PHOTO</option><option>VIDEO</option><option>REPORT</option><option selected>OTHER</option></select></div><div class="field"><label>Evidence date</label><input type="date" name="occurredAt" value="'+today()+'" required></div><div class="field"><label>Status</label><select name="evidenceStatus"><option selected>ACTIVE</option><option>REFERENCE</option><option>ARCHIVED</option></select></div><div class="field"><label>Asset</label><select name="assetId">'+assetOptionsHtml+'</select></div><div class="field"><label>Issue</label><select name="issueId">'+optional("None",issues,function(x){return x.title+" · "+x.asset_name})+'</select></div><div class="field"><label>Repair</label><select name="repairId">'+optional("None",repairs,function(x){return x.title+" · "+x.asset_name})+'</select></div><div class="field"><label>Recurring charge</label><select name="chargeId">'+optional("None",charges,function(x){return x.name+" · "+x.billing_cycle})+'</select></div><div class="field"><label>Potential purchase</label><select name="purchaseCandidateId">'+optional("None",purchases,function(x){return x.title+" · "+x.status})+'</select></div><div class="field full"><label>Provenance</label><input name="provenance" maxlength="1000" value="Saved by homeowner."></div><div class="field full"><label>Reason</label><textarea name="evidenceReason" maxlength="2000"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview evidence</button></div></form>');
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
    const buttons='<button class="button" id="save-link" type="button">+ Save link</button><button class="primary-button" id="upload-file" type="button">+ Upload file</button><button class="icon-button" id="file-info-toggle" type="button" '+(docs.length?'':'hidden ')+'aria-controls="file-inspector" aria-label="Hide file information" title="Hide file information"><svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>';
    let cards=docs.map(d=>{
      const links=[d.asset_name,d.issue_title&&"Issue: "+d.issue_title,d.repair_title&&"Repair: "+d.repair_title,d.charge_name&&"Charge: "+d.charge_name,d.purchase_title&&"Purchase: "+d.purchase_title].filter(Boolean);
      return '<button class="file-card" type="button" data-file="'+esc(d.id)+'" aria-label="Select '+esc(d.title)+'" aria-pressed="false">'
        +'<span class="file-glyph" aria-hidden="true">'+fileIcon(d)+'</span><span class="file-entry-copy"><strong>'+esc(d.title)+'</strong><small>'+esc(links.join(" · ")||d.type||"File")+'</small></span><span class="file-type">'+esc(d.type||"FILE")+'</span></button>';
    }).join("");
    if(!docs.length)cards='<div class="files-empty"><span class="file-glyph" aria-hidden="true">'+fileIcon()+'</span><strong>No files</strong></div>';
    content.innerHTML='<div class="file-controls page-controls"><div class="controls-leading">'+quickSearch("files","file-search")+'</div><span class="search-count" id="file-count">'+docs.length+' '+(docs.length===1?'file':'files')+'</span><div class="controls-actions">'+buttons+'</div></div>'
      +'<section class="file-browser"><div class="file-browser-body"><div class="file-browser-main"><div class="file-grid" role="list" aria-label="Files">'+cards+'</div></div><aside class="file-inspector" id="file-inspector"><div class="panel-resizer" id="file-info-resizer" role="separator" tabindex="0" aria-label="Resize file information" aria-orientation="vertical" aria-controls="file-inspector" title="Drag or use arrow keys to resize. Double-click to reset."></div><div id="file-inspector-content"><div class="inspector-placeholder"><span class="file-glyph" aria-hidden="true">'+fileIcon()+'</span></div></div></aside></div></section>';
    $("#save-link").onclick=()=>openLinkEvidenceForm();
    $("#upload-file").onclick=()=>openUploadEvidenceForm();
    const browser=$(".file-browser"),infoPanel=$("#file-inspector"),infoToggle=$("#file-info-toggle");
    function syncInfo(){const collapsed=workspaceLayout.files.collapsed;browser.classList.toggle("inspector-collapsed",collapsed);infoPanel.inert=collapsed;infoPanel.setAttribute("aria-hidden",String(collapsed));infoToggle.setAttribute("aria-expanded",String(!collapsed));infoToggle.setAttribute("aria-label",collapsed?"Show file information":"Hide file information");infoToggle.title=collapsed?"Show file information":"Hide file information"}
    infoToggle.onclick=()=>{workspaceLayout.files.collapsed=!workspaceLayout.files.collapsed;syncInfo();saveWorkspaceLayout()};
    syncInfo();
    bindPanelResize({name:"files",container:browser,panel:infoPanel,handle:$("#file-info-resizer"),variable:"--info-width",min:180,max:360,mainMin:280,breakpoint:701});
    const inspector=$("#file-inspector-content");
    function selectFile(doc){
      $$("[data-file]",content).forEach(card=>card.setAttribute("aria-pressed",String(card.dataset.file===doc.id)));
      const related=[doc.asset_name,doc.issue_title&&"Issue: "+doc.issue_title,doc.repair_title&&"Repair: "+doc.repair_title,doc.charge_name&&"Charge: "+doc.charge_name,doc.purchase_title&&"Purchase: "+doc.purchase_title].filter(Boolean).join(" · ");
      inspector.innerHTML='<div class="inspector-heading"><span class="file-glyph" aria-hidden="true">'+fileIcon(doc)+'</span><strong>'+esc(doc.title)+'</strong></div><dl class="inspector-details">'
        +'<div><dt>Type</dt><dd>'+esc(doc.type||"File")+'</dd></div><div><dt>Date</dt><dd>'+fmtDate(doc.occurred_at||doc.created_at)+'</dd></div>'
        +(related?'<div><dt>Linked to</dt><dd>'+esc(related)+'</dd></div>':'')
        +(doc.evidence_reason?'<div><dt>Reason</dt><dd>'+esc(doc.evidence_reason)+'</dd></div>':'')
        +'</dl><button type="button" class="primary-button inspector-open" id="inspect-open">Open file ↗</button>';
      $("#inspect-open").onclick=()=>openFile(doc);
    }
    const search=$("#file-search");
    const noMatches=document.createElement("div");noMatches.className="search-empty";noMatches.hidden=true;noMatches.innerHTML='<strong>No matching files</strong>';$(".file-grid",content).appendChild(noMatches);
    search.oninput=e=>{
      const q=e.target.value.toLowerCase().trim();let count=0;
      $$("[data-file]",content).forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(q);if(!card.hidden)count++});
      noMatches.hidden=!docs.length||count>0;
      const visibleCount=$("#file-count");
      if(visibleCount){visibleCount.textContent=q?count+" of "+docs.length:docs.length+" "+(docs.length===1?"file":"files");visibleCount.classList.toggle("is-filtered",Boolean(q))}
      if(!$("[data-file][aria-pressed=true]:not([hidden])",content)){
        $$("[data-file]",content).forEach(card=>card.setAttribute("aria-pressed","false"));
        inspector.innerHTML='<div class="inspector-placeholder"><span class="file-glyph" aria-hidden="true">'+fileIcon()+'</span></div>';
      }
    };
    $$("[data-file]",content).forEach(b=>{
      const doc=docs.find(d=>d.id===b.dataset.file);
      b.onclick=()=>selectFile(doc);
      b.ondblclick=()=>openFile(doc);
      b.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();void openFile(doc)}};
    });
    if(docs.length)selectFile(docs[0]);
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function messageMarkup(m){
  return '<article class="message '+(m.role==="user"?"user":"assistant")+'"><div class="message-role">'+(m.role==="user"?"You":"Homely")+'</div>'+(m.role==="user"?'<p>'+esc(m.text)+'</p>':'<div class="markdown-body"></div>')+(m.proposals||[]).map(function(p){return '<div class="proposal"><strong>'+esc(p.preview.title)+'</strong><div class="row-meta">'+esc(p.preview.summary)+'</div><div class="row-note">'+esc(p.reason)+'</div>'+(p.status==="PROPOSED"?'<div class="proposal-actions"><button class="button" data-reject="'+esc(p.transactionId)+'">Reject</button><button class="primary-button" data-approve="'+esc(p.transactionId)+'">Approve</button></div>':'<div class="row-meta">'+esc(p.status)+"</div>")+"</div>"}).join("")+"</article>"
}
function renderChat(){
  $("#clear-chat").hidden=!state.agentMessages.length;
  chatBody.innerHTML=state.agentMessages.length?state.agentMessages.map(messageMarkup).join(""):"";
  const messages=$$(".message",chatBody);state.agentMessages.forEach((message,index)=>{if(message.role!=="user")$(".markdown-body",messages[index]).append(renderMarkdown(message.text))});
  $$("[data-approve]",chatBody).forEach(function(b){b.onclick=async function(){try{await api("/api/transactions/"+encodeURIComponent(b.dataset.approve)+"/commit",{method:"POST"});state.agentMessages.forEach(function(m){const p=m.proposals&&m.proposals.find(function(x){return x.transactionId===b.dataset.approve});if(p)p.status="COMMITTED"});renderChat();notify("Approved and committed.");await selectView(state.view)}catch(e){notify(e.message)}}});
  $$("[data-reject]",chatBody).forEach(function(b){b.onclick=async function(){try{await api("/api/transactions/"+encodeURIComponent(b.dataset.reject)+"/reject",{method:"POST"});state.agentMessages.forEach(function(m){const p=m.proposals&&m.proposals.find(function(x){return x.transactionId===b.dataset.reject});if(p)p.status="REJECTED"});renderChat();notify("Proposal rejected.")}catch(e){notify(e.message)}}});
  if(state.chatBusy){
    const pending=document.createElement("p");
    pending.className="chat-pending";
    pending.setAttribute("role","status");
    pending.textContent="Working…";
    chatBody.appendChild(pending);
  }
  chatBody.scrollTop=chatBody.scrollHeight
}
chatInput.addEventListener("keydown",event=>{
  if(event.key!=="Enter"||event.isComposing||event.keyCode===229)return;
  if(event.shiftKey&&!event.ctrlKey&&!event.metaKey)return;
  event.preventDefault();
  if(!chatInput.disabled&&!state.chatLoading&&!state.chatBusy&&chatInput.value.trim())chatForm.requestSubmit();
});
chatForm.onsubmit=async function(e){
  e.preventDefault();if(state.chatLoading||state.chatBusy)return;const message=chatInput.value.trim();if(!message)return;state.chatBusy=true;$("#clear-chat").disabled=true;
  state.agentMessages.push({role:"user",text:message,proposals:[]});chatInput.value="";renderChat();const button=chatForm.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Working…";
  try{const r=await api("/api/agent/respond",{method:"POST",body:{message:message,previousResponseId:state.previousResponseId}});state.previousResponseId=r.responseId;state.agentMessages.push({role:"assistant",text:r.text,proposals:(r.proposals||[]).map(function(p){return Object.assign({},p,{status:"PROPOSED"})})})}
  catch(err){state.agentMessages.push({role:"assistant",text:err.message,proposals:[]})}
  finally{
    state.chatBusy=false;$("#clear-chat").disabled=false;
    button.disabled=!(state.integrations&&state.integrations.ai&&state.integrations.ai.available);
    button.textContent="Send";renderChat();
    if(!chatRail.inert&&chatRail.contains(document.activeElement))chatInput.focus();
  }
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
    viewPanels.set(state.view,{fragment:fragment,time:state.viewLoadedAt||Date.now(),title:pageTitle.textContent});
  }else{content.replaceChildren()}
  state.needsReload=false;state.view=next;
  pageTitle.textContent=views[next][0];document.title=views[next][0]+" · Homely";
  $$(".nav-item").forEach(function(b){b.classList.toggle("active",b.dataset.view===next);if(b.dataset.view===next)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  const saved=viewPanels.get(next);
  if(saved && Date.now()-saved.time<VIEW_CACHE_MS){
    viewPanels.delete(next);state.viewLoadedAt=saved.time;content.appendChild(saved.fragment);pageTitle.textContent=saved.title;document.title=saved.title+" · Homely";return;
  }
  viewPanels.delete(next);state.viewLoadedAt=Date.now();
  await views[next][1]();
}
function navigate(view,replace){view=normalizeView(view);const url=view==="home"?"/":"/?view="+encodeURIComponent(view);if(replace)history.replaceState({view:view},"",url);else history.pushState({view:view},"",url);void selectView(view)}
nav.onclick=function(e){const b=e.target.closest("[data-view]");if(b)navigate(b.dataset.view,false)};
window.onpopstate=function(){selectView(new URLSearchParams(location.search).get("view")||"home")};
function syncAssistantAccessibility(){
  const docked=window.matchMedia("(min-width: 960px)").matches;
  const visible=docked?!workspaceLayout.assistant.collapsed:chatRail.classList.contains("open");
  $("#app-shell").classList.toggle("assistant-collapsed",workspaceLayout.assistant.collapsed);
  chatRail.setAttribute("aria-hidden",String(!visible));chatRail.inert=!visible;
  const modalAssistant=!docked&&visible;
  $(".workspace").inert=modalAssistant;$(".sidebar").inert=modalAssistant;
  chatRail.setAttribute("role",modalAssistant?"dialog":"complementary");
  if(modalAssistant)chatRail.setAttribute("aria-modal","true");else chatRail.removeAttribute("aria-modal");
  if(docked){chatRail.classList.remove("open");$("#chat-backdrop").hidden=true;document.body.classList.remove("chat-visible")}
  $("#chat-open").setAttribute("aria-expanded",String(visible));$("#chat-trigger").setAttribute("aria-expanded",String(visible));
  if(!visible&&chatRail.contains(document.activeElement))(docked?$("#chat-trigger"):$("#chat-open")).focus();
}
window.addEventListener("resize",syncAssistantAccessibility);
function openChat(){
  if(window.matchMedia("(min-width: 960px)").matches){workspaceLayout.assistant.collapsed=false;saveWorkspaceLayout();syncAssistantAccessibility();$("#assistant-collapse").focus();return}
  state.chatReturnFocus=document.activeElement;
  document.body.classList.add("chat-visible");
  chatRail.classList.add("open");
  chatRail.setAttribute("aria-hidden","false");
  $("#chat-backdrop").hidden=false;
  $("#chat-open").setAttribute("aria-expanded","true");
  $("#chat-trigger").setAttribute("aria-expanded","true");
  syncAssistantAccessibility();
  requestAnimationFrame(()=>{if(chatRail.classList.contains("open"))(chatInput.disabled?$("#chat-close"):chatInput).focus()});
}
function closeChat(){
  if(state.stopVoice)state.stopVoice();
  if(window.matchMedia("(min-width: 960px)").matches){workspaceLayout.assistant.collapsed=true;chatRail.classList.remove("open");saveWorkspaceLayout();syncAssistantAccessibility();$("#chat-trigger").focus();return}
  chatRail.classList.remove("open");
  document.body.classList.remove("chat-visible");
  chatRail.setAttribute("aria-hidden","true");
  $("#chat-backdrop").hidden=true;
  $("#chat-open").setAttribute("aria-expanded","false");
  $("#chat-trigger").setAttribute("aria-expanded","false");
  syncAssistantAccessibility();
  if(!window.matchMedia("(min-width: 960px)").matches)state.chatReturnFocus?.focus();
}
$("#chat-open").onclick=openChat;
$("#chat-trigger").onclick=openChat;
$("#chat-close").onclick=closeChat;
$("#assistant-collapse").onclick=closeChat;
bindPanelResize({name:"assistant",container:$("#app-shell"),panel:chatRail,handle:$("#assistant-resizer"),variable:"--assistant-width",min:280,max:640,mainMin:480,breakpoint:960});
$("#chat-backdrop").onclick=closeChat;
async function refreshVisibleView(force=false){
  if(!state.ready||document.hidden||state.viewRefreshPending||state.chatBusy||modal.open||viewer.open)return;
  if(!force&&Date.now()-state.viewLoadedAt<ACTIVE_REFRESH_MS)return;
  const focused=document.activeElement;
  if(focused&&content.contains(focused)&&focused.matches("input,select,textarea,[contenteditable],button"))return;
  const current=state.view,revision=++state.viewRevision;
  state.viewRefreshPending=true;state.silentRefresh=true;
  try{
    await views[current][1]();
    if(state.view===current&&state.viewRevision===revision)state.viewLoadedAt=Date.now();
  }finally{state.silentRefresh=false;state.viewRefreshPending=false}
}
window.addEventListener("focus",()=>void refreshVisibleView());
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refreshVisibleView()});
async function openHouseholdSettings(){
  try{
    const state=await api("/api/homes"),members=await api("/api/homes/members");
    const home=state.homes.find(h=>h.id===state.currentHomeId);
    const owner=home&&home.role==="OWNER";
    const pending=owner?await api("/api/homes/invitations"):[];
    let markup='<h2>Household settings</h2><p class="row-meta">'+esc($("#account-email").textContent)+'</p>';
    markup+='<div class="detail-section"><h3>Your homes</h3><div class="rows">'+state.homes.map(h=>
      row(h.name,h.role,h.id===state.currentHomeId?'<span class="badge">Current</span>':'<button type="button" class="button" data-switch="'+esc(h.id)+'">Open home</button>')
    ).join("")+'</div></div>';
    if(owner){
      markup+='<div class="detail-section"><h3>Home name</h3><form class="form" id="rename-home-form"><div class="field"><label>Household</label><input name="homeName" maxlength="100" value="'+esc(home.name)+'" required></div><div class="form-actions"><button class="button" type="submit">Save name</button></div></form></div>';
      markup+='<div class="detail-section"><h3>Invite a member</h3><form class="form" id="invite-home-form"><div class="field"><label>Google email address</label><input name="email" type="email" required></div><div class="field"><label>Access</label><select name="role"><option value="MEMBER">Member — edit records</option><option value="VIEWER">Viewer — read only</option></select></div><div class="form-actions"><button class="button" type="submit">Create invite link</button></div></form><div id="invite-result"></div></div>';
      markup+='<div class="detail-section"><h3>Pending invitations</h3><div class="rows">'+(pending.map(x=>row(x.email,x.role+' · expires '+fmtDate(x.expires_at),'<button type="button" class="button" data-revoke="'+esc(x.id)+'">Revoke</button>')).join("")||'<div class="empty">None</div>')+'</div></div>';
    }
    if(owner)markup+='<div class="detail-section"><h3>Download your data</h3><div class="form-actions"><a class="button" href="/api/account/export" download="homely-backup.tar">Export household</a></div></div>';
        markup+='<div class="detail-section"><h3>Members</h3><div class="rows">'+members.map(x=>row(x.name,x.email+' · '+x.role,owner&&x.id!==state.homes.find(h=>h.id===state.currentHomeId)?.owner_id&&x.role!=="OWNER"?'<button type="button" class="button" data-remove="'+esc(x.id)+'">Remove</button>':'')).join("")+'</div></div>';
    markup+='<div class="detail-section"><h3>Delete account</h3><div class="form-actions"><button type="button" class="button" id="delete-account">Delete account…</button></div></div>';
    openModal('<div class="settings-content">'+markup+'</div>');
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
  openModal('<h2>Join a home</h2><div class="form-actions"><button class="button" id="dismiss-invite">Later</button><button class="primary-button" id="accept-invite">Accept invitation</button></div>');
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
        : auth.enabled ? ""
        : "Sign-in unavailable.";
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
    syncAssistantAccessibility();void refreshStatus();void loadChatHistory();void refreshAlerts();await selectView(initial);state.ready=true;renderChat();setupVoiceInput();
    setInterval(()=>{if(!document.hidden){void refreshAlerts();void refreshVisibleView()}},45_000);
  }catch(error){
    $("#app-shell").hidden=true;$("#auth-screen").hidden=false;
    $("#auth-message").textContent=error.message;
    $("#google-signin").setAttribute("aria-disabled","true");
  }
}
void bootstrap();
window.addEventListener("keydown",function(e){
  if(modal.open||viewer.open)return;
  if(e.key==="/"&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing
    &&!document.activeElement?.matches("input,textarea,select,[contenteditable=true]")){
    const button=content.querySelector(".search-toggle");
    if(button&&!button.closest("[hidden]")){
      e.preventDefault();
      if(button.getAttribute("aria-expanded")!=="true")button.click();
      else button.closest(".quick-search")?.querySelector("input")?.focus();
    }
    return;
  }
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==="Space"){
    e.preventDefault();
    const docked=window.matchMedia("(min-width: 960px)").matches;
    const opened=docked?!workspaceLayout.assistant.collapsed:chatRail.classList.contains("open");
    if(opened){if(document.activeElement===chatInput)closeChat();else chatInput.focus()}
    else{openChat();if(docked&&!chatInput.disabled)chatInput.focus()}
    return;
  }
  if(e.key==="Escape"&&(chatRail.contains(document.activeElement)||chatRail.classList.contains("open"))){closeChat();return}
  if(e.key==="Tab"&&chatRail.classList.contains("open")&&!window.matchMedia("(min-width: 960px)").matches){
    const controls=$$("button:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']",chatRail).filter(el=>!el.hidden&&el.getClientRects().length);
    if(controls.length){
      e.preventDefault();const index=controls.indexOf(document.activeElement);
      controls[(index+(e.shiftKey?-1:1)+controls.length)%controls.length].focus();
    }
  }
});

