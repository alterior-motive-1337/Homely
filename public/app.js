import { createInteraction, createReview } from "./interactions.js";
import { watchFadingTitles } from "./fading.js";
import { normalizeCurrency, formatMinorAmount, majorToMinorAmount, minorToMajorAmount, localDateInput,
  normalizeStatus, statusLabel, statusTone, priorityLabel, priorityTone, operationalLabel, operationalTone, issueStageLabel, purchaseStageLabel, healthLevelLabel, actionLabel, displayLabel, matchesSearch, countLabel, matchesStatusFilter, calendarDate } from "./ui-normalization.js";

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const content=$("#content"), pageTitle=$("#page-title"), nav=$("#nav");
const modal=$("#modal"), modalBody=$("#modal-body"), viewer=$("#viewer"), viewerBody=$("#viewer-body"), viewerTitle=$("#viewer-title");
const toast=$("#toast"), chatRail=$("#chat-rail"), chatBody=$("#chat-body"), chatForm=$("#chat-form"), chatInput=$("#chat-input"), voiceButton=$("#voice-button");
viewerTitle.classList.add("fade-title");
watchFadingTitles(document.body);
const state={view:"home",assets:[],agentMessages:[],conversations:[],conversationId:null,previousResponseId:null,integrations:null,objectUrl:null,viewRevision:0,stopVoice:null,needsReload:false,viewLoadedAt:0,alerts:[],chatLoading:true,chatBusy:false,currency:normalizeCurrency()};
const viewPanels=new Map();
const VIEW_CACHE_MS=45000;
const ACTIVE_REFRESH_MS=45000;
const LAYOUT_KEY="homely_workspace_layout_v1";
const workspaceLayout={assistant:{width:null,collapsed:false,expanded:false},files:{width:null,collapsed:false,mobileCollapsed:true}};
const compactFiles=window.matchMedia("(max-width: 700px)");
compactFiles.addEventListener("change",()=>state.syncFileInfo?.());
try{
  const saved=JSON.parse(localStorage.getItem(LAYOUT_KEY)||"null");
  for(const name of Object.keys(workspaceLayout)){
    const pane=saved?.[name];
    if(pane){workspaceLayout[name].collapsed=pane.collapsed===true;if(name==="files")workspaceLayout.files.mobileCollapsed=pane.mobileCollapsed!==false;if(name==="assistant")workspaceLayout.assistant.expanded=pane.expanded===true;if(Number.isFinite(pane.width))workspaceLayout[name].width=Math.max(180,Math.min(640,pane.width))}
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
function fmtDate(v){
  const date=calendarDate(v);
  return date?new Intl.DateTimeFormat("en-ZA",{day:"2-digit",month:"short",year:"numeric"}).format(date):"—";
}
function assetAge(a){const value=a.acquired_at||a.purchase_date;if(!value)return"Unknown";const date=calendarDate(value),now=new Date();if(!date)return"Unknown";let months=(now.getFullYear()-date.getFullYear())*12+now.getMonth()-date.getMonth();if(now.getDate()<date.getDate())months-=1;if(months<0)return"Not yet acquired";const years=Math.floor(months/12);return years?years+"y "+months%12+"m":months+"m"}
function money(c){return formatMinorAmount(c,state.currency)}
function amountToCents(v){return majorToMinorAmount(v,state.currency)}
function centsToAmount(v){return minorToMajorAmount(v,state.currency)}
function amountLabel(name){return name+" ("+state.currency.code+")"}
function today(){return localDateInput()}


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
let toastTimeout;
function notify(message){
  clearTimeout(toastTimeout);
  toast.textContent=message;
  toast.classList.add("show");
  toastTimeout=setTimeout(()=>toast.classList.remove("show"),3000);
}
function loading(label){if(!state.silentRefresh)content.innerHTML='<div class="loading">'+esc(label||"Loading…")+"</div>"}
function fail(e){console.error(e);content.innerHTML='<div class="error">'+esc(e&&e.message?e.message:"Homely could not load this view.")+"</div>"}
function badge(v){
  const status=normalizeStatus(v);
  return '<span class="badge '+esc(status)+'" data-tone="'+statusTone(status)+'">'+esc(statusLabel(status))+'</span>';
}
function conditionOptions(previous){
  const code=normalizeStatus(previous);
  const unrated=code==="NEW"?"NEW":"UNKNOWN";
  const attention=["FAIR","POOR"].includes(code)?code:"FAIR";
  return [["Not assessed",unrated],["Working","GOOD"],["Needs attention",attention],["Out of service","FAILED"]]
    .map(([label,value])=>'<option value="'+value+'">'+label+'</option>').join("");
}
function operationalBadge(asset){
  const code=asset.operational_state||"UNASSESSED";
  return '<span class="badge operational '+esc(code)+'" data-tone="'+operationalTone(code)+'">'+esc(operationalLabel(code))+'</span>';
}
function analysisMetric(label,value,description,action){
  return '<div class="insight-row"><div class="insight-copy"><strong>'+esc(label)+'</strong><small>'+esc(description)+'</small></div>'
    +'<span class="insight-value">'+esc(value)+'</span>'
    +(action?'<button type="button" class="insight-action" data-insight-action="'+esc(action)+'" aria-label="Open '+esc(label)+'">View</button>':'')+'</div>';
}
function purchaseOptions(previous){
  const saved=normalizeStatus(previous)==="SHORTLISTED"?"SHORTLISTED":"SAVED";
  return '<option value="'+saved+'">Saved</option><option value="PURCHASED">Purchased</option><option value="DISMISSED">Dismissed</option>';
}
function priorityBadge(v){
  const code=normalizeStatus(v);
  return '<span class="badge priority '+esc(code)+'" data-tone="'+priorityTone(code)+'">'+esc(priorityLabel(code))+'</span>';
}
function row(title,meta,right,note,fadeTitle=false){return '<div class="row"><div><div class="row-title'+(fadeTitle?' fade-title':'')+'">'+esc(title)+'</div>'+(meta?'<div class="row-meta">'+esc(meta)+'</div>':'')+(note?'<div class="row-note">'+esc(note)+"</div>":"")+'</div><div class="row-actions">'+(right||"")+"</div></div>"}


// Home summaries are shortcuts to their underlying records, not dead-end tiles.
function homeActionRow(title,meta,right,kind,id){
  return '<button type="button" class="row home-action-row" data-home-'+kind+'="'+esc(id)+'">'
    +'<span class="home-action-copy"><span class="row-title">'+esc(title)+'</span>'
    +(meta?'<span class="row-meta">'+esc(meta)+'</span>':'')+'</span>'
    +(right?'<span class="row-actions">'+right+'</span>':'')+'</button>';
}
function emptyState(title,buttons,compact=false){
  return '<section class="empty-state'+(compact?' compact':'')+'"><div class="empty-symbol" aria-hidden="true">'+fileIcon()+'</div><h2>'+esc(title)+'</h2>'
    +(buttons?'<div class="hero-actions">'+buttons+'</div>':'')+'</section>';
}
function fillForm(form,values){Object.entries(values).forEach(([name,value])=>{const input=form.elements.namedItem(name);if(input)input.value=value==null?"":String(value)})}

function updateChatTitle(){
  const active=state.conversations.find(c=>c.id===state.conversationId);
  const title=$("#chat-current-title"),label=active?.title||"New chat";
  title.textContent=label;
  title.title=active?"Rename "+label:"Start a chat to name it";
  title.setAttribute("aria-label",active?"Rename chat: "+label:"No chat selected");
  title.disabled=!active;
}
$("#chat-current-title").addEventListener("click",()=>{
  const conversation=state.conversations.find(c=>c.id===state.conversationId);
  if(!conversation||state.chatBusy||state.chatLoading||$(".chat-title-editor"))return;
  const title=$("#chat-current-title"),input=document.createElement("input");
  input.type="text";input.className="chat-title-editor";input.maxLength=60;
  input.setAttribute("aria-label","Conversation name");
  input.value=conversation.title;
  title.hidden=true;title.after(input);input.focus();input.select();
  let finished=false;
  async function finish(save){
    if(finished)return;finished=true;
    const name=input.value.trim();input.remove();title.hidden=false;
    if(!save||!name||name===conversation.title){updateChatTitle();return}
    try{
      const renamed=await api("/api/agent/conversations/"+encodeURIComponent(conversation.id),{method:"PATCH",body:{title:name}});
      conversation.title=renamed.title;renderConversationList();updateChatTitle();
    }catch(e){notify(e.message);updateChatTitle()}
  }
  input.onkeydown=event=>{
    if(event.key==="Enter"){event.preventDefault();void finish(true)}
    if(event.key==="Escape"){event.preventDefault();void finish(false)}
  };
  input.onblur=()=>void finish(true);
});
function toggleConversationList(show){
  $("#chat-history-panel").hidden=!show;
  $("#chat-conversations-toggle").setAttribute("aria-expanded",String(Boolean(show)));
}
function renderConversationList(){
  const list=$("#chat-history-list");list.replaceChildren();
  if(!state.conversations.length){const empty=document.createElement("p");empty.className="chat-history-empty";empty.textContent="No previous chats";list.append(empty);return}
  for(const c of state.conversations){
    const button=document.createElement("button");button.type="button";button.className="chat-history-item";
    button.textContent=c.title||"New chat";button.title=c.title||"New chat";
    button.setAttribute("aria-current",String(c.id===state.conversationId));
    button.onclick=()=>{void switchConversation(c.id)};
    list.append(button);
  }
}
async function refreshConversationList(){
  const result=await api("/api/agent/conversations");
  state.conversations=result.conversations||[];
  renderConversationList();updateChatTitle();
}
async function switchConversation(id){
  if(state.chatBusy||state.chatLoading)return;
  state.chatLoading=true;
  try{
    const result=await api("/api/agent/history?conversationId="+encodeURIComponent(id));
    state.conversationId=result.conversationId;
    state.agentMessages=result.messages||[];
    state.previousResponseId=result.previousResponseId||null;
    renderConversationList();updateChatTitle();renderChat();toggleConversationList(false);
  }catch(e){notify(e.message)}
  finally{state.chatLoading=false;if(state.integrations)setRuntime(state.integrations)}
}
async function loadChatHistory(){
  try{
    await refreshConversationList();
    state.conversationId=state.conversations[0]?.id||null;
    if(state.conversationId){
      const result=await api("/api/agent/history?conversationId="+encodeURIComponent(state.conversationId));
      state.agentMessages=result.messages||[];
      state.previousResponseId=result.previousResponseId||null;
    }else{state.agentMessages=[];state.previousResponseId=null}
    renderConversationList();updateChatTitle();renderChat();
  }catch(e){notify(e.message)}
  finally{state.chatLoading=false;if(state.integrations)setRuntime(state.integrations)}
}
$("#chat-conversations-toggle").onclick=()=>toggleConversationList($("#chat-history-panel").hidden);
$("#chat-new").onclick=async()=>{
  if(state.chatBusy||state.chatLoading)return;
  state.chatLoading=true;
  try{
    const c=await api("/api/agent/conversations",{method:"POST"});
    state.conversations.unshift(c);state.conversationId=c.id;
    state.agentMessages=[];state.previousResponseId=null;chatInput.value="";
    renderConversationList();updateChatTitle();renderChat();toggleConversationList(false);
    if(!chatInput.disabled)chatInput.focus();
  }catch(e){notify(e.message)}
  finally{state.chatLoading=false;if(state.integrations)setRuntime(state.integrations)}
};
const notifiedAlerts=new Set();
async function refreshAlerts(){
  try{
    state.alerts=(await api("/api/alerts")).alerts;
    const trigger=$("#alerts-trigger");trigger.hidden=!state.alerts.length;
    const alertLabel="Alerts ("+state.alerts.length+")";
    trigger.setAttribute("aria-label",alertLabel);trigger.title=alertLabel;
    $("#alerts-count").textContent=state.alerts.length>99?"99+":String(state.alerts.length);
    if("Notification" in window&&Notification.permission==="granted")state.alerts.forEach(alert=>{
      if(notifiedAlerts.has(alert.key))return;notifiedAlerts.add(alert.key);
      try{const notification=new Notification(alert.title,{body:alert.detail,tag:alert.key});notification.onclick=()=>{window.focus();void showAlerts();notification.close()}}catch(_){}
    });
  }catch(_){}
}
async function showAlerts(){
  const pending=waitingModal("Loading alerts…");
  await refreshAlerts();
  if(!modalPending(pending))return;
  openModal('<h2>Alerts</h2>'+(("Notification" in window&&Notification.permission!=="granted")?'<button class="button" id="enable-notifications" type="button">Enable notifications</button>':'')+'<div class="rows">'+(state.alerts.map(a=>row(a.title,a.detail,(a.kind==="ISSUE"?priorityBadge(a.severity):badge(a.severity))+'<button class="button" data-alert-open="'+esc(a.key)+'">Open</button><button class="button" data-alert-ack="'+esc(a.key)+'">Acknowledge</button>'+(a.kind==="MAINTENANCE"?'<button class="button" data-maintenance-complete="'+esc(a.recordId)+'">Complete</button>':''))).join('')||'<div class="empty">No alerts.</div>')+'</div>');
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
  return '<button type="button" class="ledger-file-link" data-'+label+'="'+esc(id)+'" title="Open record and related files" aria-label="Open record and related files">'+fileIcon()+'</button>';
}

function fileIcon(doc={}){
  const mime=String(doc.mime_type||doc.mimeType||'').toLowerCase();
  const paths=mime.startsWith('image/')?'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>':mime.startsWith('video/')?'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4z"/>':mime.startsWith('audio/')?'<path d="M9 18V5l11-2v13M9 5l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>';
  return '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
}

// A lightweight visual cover for every format. Only same-origin media is
// loaded into tiles; external links never initiate third-party requests.
function filePreview(doc){
  const mime=String(doc.mime_type||doc.mimeType||"").toLowerCase();
  const name=String(doc.title||"").toLowerCase();
  const type=mime.startsWith("image/")?"Image":mime.startsWith("video/")?"Video":
    mime.startsWith("audio/")?"Audio":mime==="application/pdf"||name.endsWith(".pdf")?"PDF":
    mime.startsWith("text/")||mime==="application/json"?"Text":
    mime.includes("wordprocessingml")||name.endsWith(".doc")||name.endsWith(".docx")?"Document":
    name.endsWith(".zip")?"Archive":"File";
  const href=fileHref(doc);
  let local=false;
  try{local=Boolean(href)&&new URL(href).origin===location.origin}catch(_){}
  const image=local&&mime.startsWith("image/")?'<img class="file-preview-image" src="'+esc(href)+'" alt="" loading="lazy" decoding="async">':"";
  const video=local&&mime.startsWith("video/")?'<video class="file-preview-video" src="'+esc(href)+'" preload="metadata" muted playsinline tabindex="-1" aria-hidden="true"></video>':"";
  return '<span class="file-preview file-preview-'+type.toLowerCase()+'" aria-hidden="true">'
    +'<span class="file-preview-fallback">'+fileIcon(doc)+'</span>'
    +image+video
    +(type==="Video"?'<span class="file-preview-play">'+fileIcon({mime_type:"video/mp4"})+'</span>':"")
    +'<span class="file-preview-kind">'+esc(type)+'</span></span>';
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

function registerAction(id,label,kind="plus",primary=true){
  const paths=kind==="upload"
    ?'<path d="M12 16V4m-5 5 5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'
    :kind==="link"
      ?'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>'
      :'<path d="M12 5v14M5 12h14"/>';
  return '<button type="button" class="'+(primary?"primary-button":"button")+' icon-action" id="'+esc(id)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'"><svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg></button>';
}
function registerTools(label,status=false,action="",count=0){
  return '<div class="register-tools page-controls"><div class="controls-leading">'+quickSearch(label,"record-search")
    +(status?'<div class="register-filters" aria-label="Issue status"><button type="button" data-status="all" aria-pressed="true">All</button><button type="button" data-status="open" aria-pressed="false">Active</button><button type="button" data-status="resolved" aria-pressed="false">Resolved</button></div>':'')
    +'</div><span class="search-count" id="search-count" role="status">'+count+' '+(count===1?'entry':'entries')+'</span>'
    +'<div class="controls-actions">'+action+'</div></div>';
}
function bindCollectionSearch({items,entrySelector,searchId,countId,container,
  textFor,isOpen=null,unit="entry",plural=unit==="entry"?"entries":unit+"s",emptyMessage="No matching records",onUpdate}){
  const search=$("#"+searchId,content),counter=$("#"+countId,content),entries=$$(entrySelector,content);
  if(!search||!counter||entries.length!==items.length)return;
  if(!items.length)return;
  const empty=document.createElement("div");empty.className="search-empty";empty.hidden=true;
  const emptyLabel=document.createElement("strong");emptyLabel.textContent=emptyMessage;empty.append(emptyLabel);
  container.append(empty);
  let status="all";
  function update(){
    const query=search.value.trim();let count=0;
    entries.forEach((entry,index)=>{
      const item=items[index];
      const visible=matchesSearch(textFor(item),query)&&matchesStatusFilter(status,isOpen?isOpen(item):null);
      entry.hidden=!visible;if(visible)count++;
    });
    const filtered=Boolean(query||status!=="all");
    empty.hidden=!items.length||count>0;
    counter.textContent=countLabel(count,items.length,unit,plural,filtered);
    counter.classList.toggle("is-filtered",filtered);
    if(onUpdate)onUpdate(entries);
  }
  search.oninput=update;
  $$("[data-status]",content).forEach(button=>button.onclick=()=>{
    status=button.dataset.status;
    $$("[data-status]",content).forEach(b=>b.setAttribute("aria-pressed",String(b===button)));
    update();
  });
  update();
}
function bindRegisterSearch(items,textFor,isOpen){
  bindCollectionSearch({
    items,entrySelector:".ledger-entry",searchId:"record-search",countId:"search-count",
    container:$(".ledger-rows",content),textFor,isOpen
  });
}
function setRuntime(x){
  state.integrations=x;
  const ai=x&&x.ai;
  chatInput.disabled=!(ai&&ai.available)||state.chatLoading;
  chatForm.querySelector('button[type="submit"]').disabled=!(ai&&ai.available)||state.chatLoading||state.chatBusy;
  voiceButton.disabled=!(ai&&ai.available);
  chatInput.placeholder=ai&&ai.available?"Ask Homely…":"Chat unavailable";
}
async function refreshStatus(){
  try{setRuntime(await api("/api/integrations/status"))}
  catch(_){setRuntime({ai:{available:false}})}
}

let modalGeneration=0;
let activeUploadController=null;
function cancelPendingUpload(){
  if(activeUploadController){activeUploadController.abort();activeUploadController=null}
}
function openModal(html){
  cancelPendingUpload();
  modalGeneration++;
  modalBody.innerHTML=html;
  const title=modalBody.querySelector("h2");
  if(title){
    title.id="modal-title";
    modal.setAttribute("aria-labelledby","modal-title");
    modal.removeAttribute("aria-label");
  }else{
    modal.removeAttribute("aria-labelledby");
    modal.setAttribute("aria-label","Loading home record");
  }
  modalBody.querySelectorAll(".field").forEach(function(field,index){
    const label=$("label",field),input=$("input,select,textarea",field);
    if(label&&input){input.id=input.id||"record-field-"+index;label.htmlFor=input.id}
  });
  if(!modal.open)modal.showModal();
  return modalGeneration;
}
function closeModal(){
  cancelPendingUpload();
  modalGeneration++;
  if(modal.open)modal.close();
  modalBody.innerHTML="";
}
function waitingModal(text){return openModal('<div class="loading" role="status">'+esc(text||"Loading…")+'</div>')}
function modalPending(token){return modal.open&&modalGeneration===token}
function modalLoadFailed(token,error){
  if(modalPending(token)){closeModal();notify(error instanceof Error?error.message:"Could not load form.")}
}
$("#modal-close").onclick=closeModal;
modal.addEventListener("cancel",function(e){e.preventDefault();closeModal()});
modal.addEventListener("close",()=>{modalGeneration++});

async function assetOptions(selected){
  if(!state.assets.length)state.assets=await api("/api/assets");
  return state.assets.map(function(a){return '<option value="'+esc(a.id)+'" '+(a.id===selected?"selected":"")+">"+esc(a.name)+" · "+esc(a.system_name)+"</option>"}).join("")
}

async function previewAction(actionType,payload,reason,requestText){
  const submit=modal.open?$("form button[type='submit'],form button.primary-button",modalBody):null;
  if(submit?.disabled)return;
  const original=submit?.textContent;
  const formGeneration=modalGeneration;
  if(submit){submit.disabled=true;submit.textContent="Preparing…"}
  try{
    const result=await api("/api/transactions/preview",{method:"POST",body:{actionType:actionType,payload:payload,reason:reason,requestText:requestText||null}});
    const p=result.preview,t=result.transaction;
    if(!modalPending(formGeneration)){
      // Never reopen a discarded form when preview preparation completes late.
      try{await api("/api/transactions/"+encodeURIComponent(t.id)+"/reject",{method:"POST"})}catch(_){}
      return;
    }
    openModal('<p class="eyebrow">Approval required</p><h2>'+esc(p.title)+'</h2><div id="action-review"></div><div class="form-actions"><button class="button" id="reject-preview">Reject</button><button class="primary-button" id="commit-preview">Approve & commit</button></div>');
    const review=createInteraction(null);
    review.classList.add("preview");
    review.append(createReview(p,"",{title:false}));
    $("#action-review").append(review);
    const previewGeneration=modalGeneration;
    $("#reject-preview").onclick=async function(){
      const button=$("#reject-preview"),other=$("#commit-preview");
      button.disabled=true;other.disabled=true;button.textContent="Rejecting…";
      try{await api("/api/transactions/"+encodeURIComponent(t.id)+"/reject",{method:"POST"});if(modalPending(previewGeneration))closeModal();notify("Proposal rejected.")}
      catch(error){if(button.isConnected){button.disabled=false;other.disabled=false;button.textContent="Reject"}notify(error.message)}
    };
    $("#commit-preview").onclick=async function(){
      const button=$("#commit-preview"),other=$("#reject-preview");
      button.disabled=true;other.disabled=true;button.textContent="Saving…";
      try{
        await api("/api/transactions/"+encodeURIComponent(t.id)+"/commit",{method:"POST"});
        if(modalPending(previewGeneration))closeModal();
        notify(actionType==="RECORD_REPAIR"?"Repair recorded.":"Saved.");
        await selectView(state.view);
      }catch(error){if(button.isConnected){button.disabled=false;other.disabled=false;button.textContent="Approve & commit"}notify(error.message)}
    };
  }catch(error){notify(error instanceof Error?error.message:"Could not prepare action.")}
  finally{if(submit?.isConnected){submit.disabled=false;submit.textContent=original}}
}

function bindPreviewForm(selector,buildProposal){
  const form=$(selector,modalBody);
  form.onsubmit=async event=>{
    event.preventDefault();
    try{
      const [actionType,payload,reason]=buildProposal(new FormData(event.currentTarget));
      await previewAction(actionType,payload,reason);
    }catch(error){notify(error instanceof Error?error.message:"Could not prepare action.")}
  };
}

async function openIssueForm(){
  const pending=waitingModal("Preparing issue form…");
  let options;
  try{options=await assetOptions("")}catch(error){modalLoadFailed(pending,error);return}
  if(!modalPending(pending))return;
  openModal('<h2>Report a problem</h2><form class="form" id="issue-form"><div class="form-grid"><div class="field full"><label>Asset</label><select name="assetId" required>'+options+'</select></div><div class="field"><label>Title</label><input name="title" maxlength="160" required></div><div class="field"><label>Priority</label><select name="severity"><option value="LOW">Low</option><option value="MEDIUM" selected>Medium</option><option value="HIGH">High</option></select></div><div class="field"><label>Date detected</label><input type="date" name="detectedAt" value="'+today()+'" required></div><div class="field full"><label>Description</label><textarea name="description"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  bindPreviewForm("#issue-form",d=>["REPORT_ISSUE",{
    assetId:d.get("assetId"),title:d.get("title"),severity:d.get("severity"),
    description:d.get("description"),detectedAt:d.get("detectedAt")
  },"Homeowner reported an issue through Homely."]);
}
function openResolveForm(issue){
  openModal('<p class="eyebrow">Resolve issue</p><h2>'+esc(issue.title)+'</h2><form class="form" id="resolve-form"><div class="form-grid"><div class="field"><label>Date resolved</label><input type="date" name="resolvedAt" value="'+today()+'" required></div><div class="field full"><label>Resolution</label><textarea name="resolution" required></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  bindPreviewForm("#resolve-form",d=>["RESOLVE_ISSUE",{
    issueId:issue.id,resolvedAt:d.get("resolvedAt"),resolution:d.get("resolution")
  },"Homeowner marked the issue resolved."]);
}
async function openRepairForm(prefill){
  prefill=prefill||{};
  const pending=waitingModal("Preparing repair form…");
  let options,issues;
  try{
    [options,issues]=await Promise.all([assetOptions(prefill.asset_id||""),api("/api/issues")]);
  }catch(error){modalLoadFailed(pending,error);return}
  if(!modalPending(pending))return;
  const issueOpts=['<option value="">None</option>'].concat(issues.map(function(i){return '<option value="'+esc(i.id)+'" '+(i.id===prefill.id?"selected":"")+">"+esc(i.title)+" · "+esc(i.asset_name)+"</option>"})).join("");
  const title=prefill.title?"Repair: "+prefill.title:"";
  openModal('<h2>Record a repair</h2><form class="form" id="repair-form"><div class="form-grid"><div class="field full"><label>Asset</label><select name="assetId" required>'+options+'</select></div><div class="field full"><label>Linked issue</label><select name="issueId">'+issueOpts+'</select></div><div class="field full"><label>Repair title</label><input name="title" maxlength="180" required value="'+esc(title)+'"></div><div class="field"><label>Date</label><input type="date" name="repairDate" value="'+today()+'" required></div><div class="field"><label>'+esc(amountLabel("Cost"))+'</label><input type="number" name="cost" min="0" step=".01" placeholder="0.00"></div><div class="field full"><label>Contractor / person</label><input name="contractor" maxlength="240"></div><div class="field full"><label>Work performed</label><textarea name="description"></textarea></div><div class="field full"><label>Outcome</label><textarea name="outcome"></textarea></div></div><div class="row-note">Permanent record.</div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  bindPreviewForm("#repair-form",d=>["RECORD_REPAIR",{
    assetId:d.get("assetId"),issueId:d.get("issueId")||null,title:d.get("title"),
    repairDate:d.get("repairDate"),costCents:amountToCents(d.get("cost")),
    contractor:d.get("contractor"),description:d.get("description"),outcome:d.get("outcome")
  },"Homeowner recorded completed repair work."]);
}

function openChargeForm(existing){
  existing=existing||null;
  openModal('<h2>'+ (existing?'Edit charge':'Add recurring charge') +'</h2><form class="form" id="charge-form"><div class="form-grid"><div class="field full"><label>Name</label><input name="name" maxlength="180" required></div><div class="field"><label>Category</label><input name="category" maxlength="80" required></div><div class="field"><label>'+esc(amountLabel("Amount"))+'</label><input type="number" name="amount" min="0" step=".01" required></div><div class="field"><label>Billing cycle</label><select name="billingCycle"><option value="MONTHLY" selected>Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option><option value="OTHER">Other</option></select></div><div class="field"><label>Due day</label><input type="number" name="dueDay" min="1" max="31"></div><div class="field"><label>Status</label><select name="active"><option value="1">Active</option><option value="0">Inactive</option></select></div><div class="field full"><label>Provider</label><input name="provider" maxlength="240"></div><div class="field full"><label>Notes</label><textarea name="notes"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  if(existing)fillForm($("#charge-form"),{name:existing.name,category:existing.category,amount:centsToAmount(existing.amount_cents),billingCycle:existing.billing_cycle,dueDay:existing.due_day,provider:existing.provider,notes:existing.notes,active:existing.active});
  bindPreviewForm("#charge-form",d=>[existing?"UPDATE_CHARGE":"CREATE_CHARGE",{
    ...(existing?{chargeId:existing.id}:{}),active:Number(d.get("active")),name:d.get("name"),
    category:d.get("category"),amountCents:amountToCents(d.get("amount")),
    billingCycle:d.get("billingCycle"),dueDay:d.get("dueDay")?Number(d.get("dueDay")):null,
    provider:d.get("provider"),notes:d.get("notes")
  },"Homeowner recorded a recurring household charge."]);
}

async function openPurchaseForm(existing){
  existing=existing||null;
  const pending=waitingModal("Preparing purchase form…");
  let options;
  try{options=await assetOptions("")}catch(error){modalLoadFailed(pending,error);return}
  if(!modalPending(pending))return;
  const optionalAssets='<option value="">None</option>'+options;
  openModal('<h2>'+(existing?"Edit purchase":"Save potential purchase")+'</h2><form class="form" id="purchase-form"><div class="form-grid"><div class="field full"><label>Title</label><input name="title" maxlength="220" required></div><div class="field"><label>Category</label><input name="category" maxlength="80" required></div>'+(existing?'<div class="field"><label>Status</label><select name="status">'+purchaseOptions(existing.status)+'</select></div>':'')+'<div class="field full"><label>Related asset</label><select name="assetId">'+optionalAssets+'</select></div><div class="field"><label>'+esc(amountLabel("Budget"))+'</label><input type="number" name="budget" min="0" step=".01"></div><div class="field"><label>'+esc(amountLabel("Expected cost"))+'</label><input type="number" name="expected" min="0" step=".01"></div><div class="field full"><label>Source name</label><input name="sourceName" maxlength="240"></div><div class="field full"><label>Source URL</label><input type="url" name="sourceUrl" maxlength="2000" placeholder="https://…"></div><div class="field full"><label>Reason</label><textarea name="rationale"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  if(existing)fillForm($("#purchase-form"),{title:existing.title,category:existing.category,status:existing.status,assetId:existing.asset_id,budget:existing.budget_cents==null?null:centsToAmount(existing.budget_cents),expected:existing.expected_cost_cents==null?null:centsToAmount(existing.expected_cost_cents),sourceName:existing.source_name,sourceUrl:existing.source_url,rationale:existing.rationale});
  bindPreviewForm("#purchase-form",d=>[existing?"UPDATE_PURCHASE":"SAVE_PURCHASE",{
    ...(existing?{purchaseCandidateId:existing.id}:{}),assetId:d.get("assetId")||null,
    title:d.get("title"),category:d.get("category"),status:d.get("status")||"SAVED",
    budgetCents:amountToCents(d.get("budget")),expectedCostCents:amountToCents(d.get("expected")),
    sourceUrl:d.get("sourceUrl"),sourceName:d.get("sourceName"),rationale:d.get("rationale")
  },"Homeowner saved a potential household purchase."]);
}

function openMaintenanceSummary(rule){
  if(!rule)return;
  openModal('<p class="eyebrow">Maintenance</p><h2>'+esc(rule.title)+'</h2>'
    +'<div class="detail-grid"><div class="detail"><span>Asset</span><strong>'+esc(rule.asset_name||"Home")+'</strong></div>'
    +'<div class="detail"><span>Due</span><strong>'+esc(fmtDate(rule.next_due_at))+'</strong></div></div>'
    +'<div class="form-actions"><button class="button" id="maintenance-asset" type="button">View asset</button>'
    +'<button class="primary-button" id="maintenance-complete" type="button">Mark complete</button></div>');
  $("#maintenance-asset").onclick=()=>openAsset(rule.asset_id);
  $("#maintenance-complete").onclick=()=>previewAction("COMPLETE_MAINTENANCE",{
    maintenanceId:rule.id,completedAt:today()
  },"Homeowner completed scheduled household maintenance.");
}
async function showHome(){
  loading();const revision=state.viewRevision;
  try{
    const [d,assets]=await Promise.all([api("/api/overview"),api("/api/assets")]);
    if(revision!==state.viewRevision)return;
    state.assets=assets;
    const memory=d.memory||{},repairs=memory.repairs||[],charges=memory.charges||[],purchases=memory.purchases||[];
    const upcoming=d.upcoming||[],recent=d.recent||[],summary=d.summary||{};
    state.currency=normalizeCurrency(d.currency);
    const issueShortcuts=d.attention?.issues||[];
    const maintenanceShortcuts=[...(d.attention?.maintenance||[]),...upcoming];
    const attention=issueShortcuts.map(i=>homeActionRow(i.title,i.asset_name,priorityBadge(i.severity),"issue",i.id))
      .concat((d.attention?.maintenance||[]).map(m=>homeActionRow(m.title,m.asset_name+" · "+m.days_overdue+" days overdue",badge("OVERDUE"),"maintenance",m.id)));
    const homeName=d.home?.name||"My Home";
    pageTitle.textContent=homeName;
    document.title=homeName+" · Homely";
    if(!assets.length&&!repairs.length&&!charges.length&&!purchases.length&&!recent.length){
      content.innerHTML='<section class="home-empty" aria-labelledby="home-welcome-title">'
        +'<p class="eyebrow">A fresh start for '+esc(homeName)+'</p><h2 id="home-welcome-title">Build your home’s memory, one detail at a time.</h2>'
        +'<p class="home-welcome-copy">Start with one appliance or a document. Add what you know; everything else can wait. Homely keeps your records private unless you invite someone.</p>'
        +'<div class="home-empty-actions">'
        +'<article class="home-start-step"><span class="home-start-number">01</span><h3>Add something you own</h3><p>Track its condition, warranty, repairs and related records.</p><button class="primary-button" id="home-first-asset">Add an appliance or furnishing</button></article>'
        +'<article class="home-start-step"><span class="home-start-number">02</span><h3>Keep its paperwork</h3><p>Save a receipt, manual, warranty, photo or video.</p><button class="button" id="home-first-file">Add a document or photo</button></article>'
        +'<article class="home-start-step"><span class="home-start-number">03</span><h3>Make this home yours</h3><p>Choose a home name or invite a trusted household member.</p><button class="button" id="home-first-settings">Set up your household</button></article>'
        +'</div></section>';
      $("#home-first-asset").onclick=()=>openAssetForm();
      $("#home-first-file").onclick=()=>openUploadEvidenceForm();
      $("#home-first-settings").onclick=()=>openHouseholdSettings();
      return;
    }
    const quiet=!attention.length&&!upcoming.length&&!repairs.length&&!charges.length&&!purchases.length;
    let html='<div class="home-overview'+(quiet?' home-overview-quiet':'')+'">';
    const openIssues=Number(summary.open_issues||0),overdue=Number(summary.overdue_maintenance||0);
    {
      const metricCount=1+Number(Boolean(openIssues))+Number(Boolean(overdue));
      html+='<section class="metrics metrics-'+metricCount+'" aria-label="Household overview">'
        +'<div class="metric"><span>Registered assets</span><strong>'+assets.length+'</strong></div>'
        +(openIssues?'<div class="metric"><span>Open issues</span><strong>'+openIssues+'</strong></div>':'')
        +(overdue?'<div class="metric"><span>Overdue</span><strong>'+overdue+'</strong></div>':'')
        +'</section>';
    }
    const insights=d.insights;
    if(insights){
      const metrics=[];
      const service=insights.service||{},repairData=insights.repairs||{},expense=insights.charges||{};
      const affected=Number(service.needing_attention||0)+Number(service.out_of_service||0);
      if(affected||Number(service.unassessed||0)){
        const note=[affected+" requiring a check",
          Number(service.out_of_service||0)?service.out_of_service+" out of service":null,
          Number(service.unassessed||0)?service.unassessed+" not assessed":null].filter(Boolean).join(" · ");
        metrics.push(analysisMetric("Appliance attention",affected+" / "+assets.length,note,"appliances"));
      }
      if(Number(repairData.count_12m||0)){
        const known=Number(repairData.cost_count_12m||0);
        metrics.push(analysisMetric("Repairs · last 365 days",
          known?money(repairData.recorded_cost_cents_12m):"No costs entered",
          repairData.count_12m+" repairs · "+known+" with a recorded cost","repairs"));
      }
      if(Number(expense.active_count||0)){
        const estimated=Number(expense.estimated_count||0);
        const missing=Number(expense.unspecified_cycle_count||0);
        metrics.push(analysisMetric("Estimated monthly charges",
          estimated?money(expense.estimated_monthly_cents):"Not estimable",
          estimated+" of "+expense.active_count+" active charges included"+(missing?" · "+missing+" excluded (unspecified cycle)":""),
          "charges"));
      }
      if(metrics.length)html+='<section class="home-insights" aria-label="Home insights"><div class="card-head"><h2>Insights</h2></div><div class="insight-rows">'+metrics.join("")+'</div></section>';
    }
    if(Number(summary.systems_needing_attention||0)>0&&!attention.length){
      html+='<p class="home-attention-note">'+Number(summary.systems_needing_attention)+' systems need attention</p>';
    }
    if(attention.length||upcoming.length){
      html+='<div class="home-priority">';
      if(attention.length)html+='<section class="card"><div class="card-head"><h2>Needs attention</h2><button class="ghost-link" data-go="issues">View issues</button></div><div class="card-body rows">'+attention.slice(0,4).join("")+'</div></section>';
      if(upcoming.length)html+='<section class="card"><div class="card-head"><h2>Coming up</h2><span class="row-meta">Next 30 days</span></div><div class="card-body rows">'+upcoming.slice(0,4).map(m=>homeActionRow(m.title,m.asset_name+' · '+fmtDate(m.next_due_at),'<span class="badge">'+Number(m.days_until)+'d</span>',"maintenance",m.id)).join("")+'</div></section>';
      html+='</div>';
    }
    if(repairs.length||charges.length||purchases.length){
      html+='<div class="home-memory">';
      if(repairs.length)html+='<section class="card"><div class="card-head"><h2>Recent repairs</h2><button class="ghost-link" data-go="repairs">View all</button></div><div class="card-body rows">'+repairs.slice(0,3).map(r=>homeActionRow(r.title,fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+'</span>',"repair",r.id)).join("")+'</div></section>';
      if(charges.length)html+='<section class="card"><div class="card-head"><h2>Charges</h2><button class="ghost-link" id="view-charges">View all</button></div><div class="card-body rows">'+charges.slice(0,3).map(c=>row(c.name,statusLabel(c.billing_cycle),'<span class="money">'+money(c.amount_cents)+'</span>')).join("")+'</div></section>';
      if(purchases.length)html+='<section class="card"><div class="card-head"><h2>Saved purchases</h2><button class="ghost-link" id="view-purchases">View all</button></div><div class="card-body rows">'+purchases.slice(0,3).map(p=>row(p.title,purchaseStageLabel(p.status),'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+'</span>')).join("")+'</div></section>';
      html+='</div>';
    }
    html+='<nav class="home-utilities" aria-label="Other home records"><div class="utility-links">'+(!charges.length?'<button class="ghost-link" id="view-charges-shortcut">Charges</button>':'')+(!purchases.length?'<button class="ghost-link" id="view-purchases-shortcut">Purchases</button>':'')+'<button class="ghost-link" id="view-history">History</button></div></nav></div>';
    content.innerHTML=html;
    const chargesBtn=$("#view-charges");if(chargesBtn)chargesBtn.onclick=showCharges;
    const purchasesBtn=$("#view-purchases");if(purchasesBtn)purchasesBtn.onclick=showPurchases;
    const chargesShortcut=$("#view-charges-shortcut");if(chargesShortcut)chargesShortcut.onclick=showCharges;
    const purchasesShortcut=$("#view-purchases-shortcut");if(purchasesShortcut)purchasesShortcut.onclick=showPurchases;
    $("#view-history").onclick=showHistory;
    $$("[data-insight-action]",content).forEach(button=>button.onclick=()=>{
      const target=button.dataset.insightAction;
      if(target==="charges")void showCharges();
      else if(target==="repairs"||target==="appliances")navigate(target);
    });
    $$("[data-go]",content).forEach(b=>b.onclick=()=>navigate(b.dataset.go));
    $$("[data-home-maintenance]",content).forEach(b=>b.onclick=()=>openMaintenanceSummary(maintenanceShortcuts.find(m=>m.id===b.dataset.homeMaintenance)));
    $$("[data-home-asset]",content).forEach(b=>b.onclick=()=>openAsset(b.dataset.homeAsset));
    $$("[data-home-issue]",content).forEach(b=>b.onclick=()=>openIssue(issueShortcuts.find(i=>i.id===b.dataset.homeIssue)));
    $$("[data-home-repair]",content).forEach(b=>b.onclick=()=>openRepair(repairs.find(r=>r.id===b.dataset.homeRepair)));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

async function showCharges(){
  const pending=waitingModal("Loading records…");
  try{const items=await api("/api/charges");if(!modalPending(pending))return;openModal('<div class="card-head"><h2>Recurring charges</h2><button class="button" id="add-charge">Add charge</button></div><div class="rows">'+(items.map(function(c){return row(c.name,statusLabel(c.billing_cycle)+" · "+(c.provider||displayLabel(c.category)),'<span class="money">'+money(c.amount_cents)+'</span>'+badge(Number(c.active)?'ACTIVE':'INACTIVE')+'<button class="button" data-charge-edit="'+esc(c.id)+'">Edit</button>',c.notes||"")}).join("")||'<div class="empty">No charges.</div>')+'</div>');$("#add-charge").onclick=()=>openChargeForm();$$("[data-charge-edit]",modalBody).forEach(b=>b.onclick=()=>openChargeForm(items.find(c=>c.id===b.dataset.chargeEdit)))}catch(e){modalLoadFailed(pending,e)}
}
async function showPurchases(){
  const pending=waitingModal("Loading records…");
  try{const items=await api("/api/purchases");if(!modalPending(pending))return;openModal('<div class="card-head"><h2>Potential purchases</h2><button class="button" id="add-purchase">Save purchase</button></div><div class="rows">'+(items.map(function(p){return row(p.title,displayLabel(p.category)+" · "+purchaseStageLabel(p.status),'<span class="money">'+money(p.expected_cost_cents==null?p.budget_cents:p.expected_cost_cents)+'</span><button class="button" data-purchase-edit="'+esc(p.id)+'">Edit</button>',p.rationale||"")}).join("")||'<div class="empty">No purchases.</div>')+'</div>');$("#add-purchase").onclick=()=>openPurchaseForm();$$("[data-purchase-edit]",modalBody).forEach(b=>b.onclick=()=>openPurchaseForm(items.find(p=>p.id===b.dataset.purchaseEdit)))}catch(e){modalLoadFailed(pending,e)}
}
async function showHistory(){
  const pending=waitingModal("Loading records…");
  try{
    const results=await Promise.all([api("/api/timeline"),api("/api/transactions")]);
    if(!modalPending(pending))return;
    const permanent=["REPORT_ISSUE","RESOLVE_ISSUE","RECORD_REPAIR"];
    openModal('<h2>Home history</h2><div class="rows">'+results[0].map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")+'</div><div class="detail-section"><h3>Changes</h3><div class="rows">'+(results[1].map(function(t){return row(actionLabel(t.action_type),fmtDate(t.created_at),badge(t.status)+(t.status==="COMMITTED"&&!permanent.includes(t.action_type)?'<button class="button" data-undo="'+esc(t.id)+'">Undo</button>':""),t.reason)}).join("")||'<div class="empty">No changes.</div>')+'</div></div>');
    $$("[data-undo]",modalBody).forEach(function(b){b.onclick=async function(){b.disabled=true;try{await api("/api/transactions/"+encodeURIComponent(b.dataset.undo)+"/undo",{method:"POST"});closeModal();notify("Change undone.");await selectView(state.view)}catch(e){b.disabled=false;notify(e.message)}}});
  }catch(e){modalLoadFailed(pending,e)}
}


async function showIssues(){
  loading();const revision=state.viewRevision;
  try{
    const [items,assets]=await Promise.all([api("/api/issues"),api("/api/assets")]);
    if(revision!==state.viewRevision)return;
    state.assets=assets;
    const action=assets.length?registerAction("new-issue","Report issue"):registerAction("new-asset","Register asset");
    const body=items.map(item=>{
      const severity=normalizeStatus(item.severity);
      const unresolved=!["RESOLVED","CLOSED"].includes(normalizeStatus(item.status));
      const emphasize=unresolved;
      return '<div class="ledger-entry" role="listitem"><button type="button" class="ledger-main" data-issue-open="'+esc(item.id)+'"><span class="ledger-entry-content"><strong class="fade-title">'+esc(item.title)+'</strong><small>'+esc(item.asset_name||"Home")+'</small></span></button>'
        +'<div class="ledger-details">'+badge(issueStageLabel(item.status))+(emphasize?priorityBadge(item.severity):'')+'</div></div>';
    }).join("");
    content.innerHTML=registerTools("issues",true,action,items.length)+ledger("Issues",items.length,"",body,"Issue");
    bindRegisterSearch(items,i=>[i.title,i.asset_name,i.description,i.status,i.severity].filter(Boolean).join(" "),i=>!["RESOLVED","CLOSED"].includes(i.status));
    const add=$("#new-issue");if(add)add.onclick=openIssueForm;
    const register=$("#new-asset");if(register)register.onclick=()=>openAssetForm();
    $$("[data-issue-open]",content).forEach(b=>b.onclick=()=>openIssue(items.find(i=>i.id===b.dataset.issueOpen)));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}


async function showRepairs(){
  loading();const revision=state.viewRevision;
  try{
    const [items,assets]=await Promise.all([api("/api/repairs"),api("/api/assets")]);
    if(revision!==state.viewRevision)return;
    state.assets=assets;
    const action=assets.length?registerAction("new-repair","Record repair"):registerAction("new-asset","Register asset");
    const body=items.map(r=>'<div class="ledger-entry" role="listitem"><button type="button" class="ledger-main" data-repair-open="'+esc(r.id)+'"><span class="ledger-entry-content"><strong class="fade-title">'+esc(r.title)+'</strong><small>'+esc(r.asset_name||"Home")+'</small></span></button>'+(r.cost_cents!=null?'<div class="ledger-details"><strong class="money">'+money(r.cost_cents)+'</strong></div>':'')+'</div>').join("");
    content.innerHTML=registerTools("repairs",false,action,items.length)+ledger("Repairs",items.length,"",body,"Repair");
    bindRegisterSearch(items,r=>[r.title,r.asset_name,r.contractor,r.description,r.outcome].filter(Boolean).join(" "));
    const add=$("#new-repair");if(add)add.onclick=()=>openRepairForm();
    const register=$("#new-asset");if(register)register.onclick=()=>openAssetForm();
    $$("[data-repair-open]",content).forEach(b=>b.onclick=()=>openRepair(items.find(r=>r.id===b.dataset.repairOpen)));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function evidenceMarkup(docs){return '<div class="detail-section"><h3>Files</h3><div class="rows">'+(docs.map(function(d){return row(d.title,statusLabel(d.type)+" · "+fmtDate(d.occurred_at||d.created_at),'<button class="button" data-evidence="'+esc(d.id)+'">Open</button>',d.evidence_reason||"",true)}).join("")||'<div class="empty">No files.</div>')+'</div></div>'}
function bindEvidence(docs){$$("[data-evidence]",modalBody).forEach(function(b){b.onclick=function(){openFile(docs.find(function(d){return d.id===b.dataset.evidence}))}})}
async function openIssue(issue){
  if(!issue)return;
  const pending=waitingModal("Opening issue…");
  try{const results=await Promise.all([api("/api/documents"),api("/api/assets/"+encodeURIComponent(issue.asset_id))]);
    if(!modalPending(pending))return;
    const docs=results[0].filter(function(d){return d.issue_id===issue.id}),history=(results[1].history||[]).filter(function(e){return e.issue_id===issue.id});
    openModal('<p class="eyebrow">Issue · '+esc(issue.asset_name)+'</p><h2>'+esc(issue.title)+'</h2><div class="hero-actions">'+badge(issueStageLabel(issue.status))+priorityBadge(issue.severity)+'</div><div class="detail-grid"><div class="detail"><span>Detected</span><strong>'+fmtDate(issue.detected_at)+'</strong></div><div class="detail"><span>Resolved</span><strong>'+fmtDate(issue.resolved_at)+'</strong></div></div><p>'+esc(issue.description||"—")+'</p>'+(history.length?'<div class="detail-section"><h3>History</h3><div class="rows">'+history.map(function(e){return row(e.title,fmtDate(e.occurred_at),"",e.summary||"")}).join("")+'</div></div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="issue-attach">Attach file</button><button class="button" id="issue-asset">View asset</button>'+(!["RESOLVED","CLOSED"].includes(issue.status)?'<button class="button" id="issue-repair">Record repair</button><button class="primary-button" id="issue-resolve">Resolve</button>':"")+'</div>');
    bindEvidence(docs);$("#issue-attach").onclick=function(){openUploadEvidenceForm({assetId:issue.asset_id,issueId:issue.id})};$("#issue-asset").onclick=function(){openAsset(issue.asset_id)};if($("#issue-repair"))$("#issue-repair").onclick=function(){openRepairForm(issue)};if($("#issue-resolve"))$("#issue-resolve").onclick=function(){openResolveForm(issue)};
  }catch(e){modalLoadFailed(pending,e)}
}
async function openRepair(repair){
  if(!repair)return;
  const pending=waitingModal("Opening repair…");
  try{const docs=(await api("/api/documents")).filter(function(d){return d.repair_id===repair.id});
    if(!modalPending(pending))return;
    openModal('<p class="eyebrow">Repair · '+esc(repair.asset_name)+'</p><h2>'+esc(repair.title)+'</h2><div class="detail-grid">'+[["Date",fmtDate(repair.repair_date)],["Cost",money(repair.cost_cents)],["Contractor",repair.contractor||"—"]].map(function(pair){return '<div class="detail"><span>'+esc(pair[0])+'</span><strong>'+esc(pair[1])+'</strong></div>'}).join("")+'</div><div class="detail-section"><h3>Work performed</h3><p>'+esc(repair.description||"—")+'</p></div><div class="detail-section"><h3>Outcome</h3><p>'+esc(repair.outcome||"—")+'</p></div>'+(repair.issue_title?'<div class="row-meta">Issue: '+esc(repair.issue_title)+'</div>':"")+evidenceMarkup(docs)+'<div class="form-actions"><button class="button" id="repair-attach">Attach file</button><button class="button" id="repair-asset">View asset</button></div>');bindEvidence(docs);$("#repair-attach").onclick=function(){openUploadEvidenceForm({assetId:repair.asset_id,repairId:repair.id})};$("#repair-asset").onclick=function(){openAsset(repair.asset_id)};
  }catch(e){modalLoadFailed(pending,e)}
}


async function openAssetForm(existing){
  const pending=waitingModal("Preparing asset form…");
  let systems;
  try{systems=await api("/api/systems")}catch(error){modalLoadFailed(pending,error);return}
  if(!modalPending(pending))return;
  const options=systems.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>'}).join("");
  if(!options){closeModal();notify("No home systems available.");return}
  openModal('<h2>'+(existing?"Edit appliance or furniture":"Register appliance or furniture")+'</h2><form class="form" id="asset-form"><div class="form-grid"><div class="field"><label>System</label><select name="systemId" required>'+options+'</select></div><div class="field"><label>Category</label><input name="category" maxlength="80" required></div><div class="field full"><label>Name</label><input name="name" maxlength="180" required></div><div class="field"><label>Operational condition</label><select name="condition">'+conditionOptions(existing?.condition)+'</select></div><div class="field"><label>Room or location</label><input name="location" maxlength="200"></div><div class="field"><label>Manufacturer</label><input name="manufacturer" maxlength="160"></div><div class="field"><label>Model</label><input name="model" maxlength="160"></div><div class="field full"><label>Serial number</label><input name="serialNumber" maxlength="160"></div><div class="field"><label>Purchase date</label><input name="purchaseDate" type="date"></div><div class="field"><label>'+esc(amountLabel("Purchase price"))+'</label><input name="purchaseCost" type="number" min="0" step=".01"></div><div class="field"><label>Warranty end</label><input name="warrantyEnd" type="date"></div><div class="field full"><label>Notes</label><textarea name="notes" maxlength="3000"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview</button></div></form>');
  if(existing){
    const form=$("#asset-form");
    const values={systemId:existing.system_id,name:existing.name,category:existing.category,
      condition:existing.condition,location:existing.location,manufacturer:existing.manufacturer,
      model:existing.model,serialNumber:existing.serial_number,purchaseDate:existing.purchase_date,
      purchaseCost:existing.purchase_cost_cents==null?"":centsToAmount(existing.purchase_cost_cents),
      warrantyEnd:existing.warranty_end,notes:existing.notes};
    for(const [key,value] of Object.entries(values)){
      const element=form.elements.namedItem(key);
      if(element)element.value=value==null?"":String(value);
    }
  }
  $("[data-cancel]",modalBody).onclick=closeModal;
  bindPreviewForm("#asset-form",d=>[existing?"UPDATE_ASSET":"CREATE_ASSET",{
    assetId:existing?existing.id:null,systemId:d.get("systemId"),name:d.get("name"),
    category:d.get("category"),condition:d.get("condition"),location:d.get("location"),
    manufacturer:d.get("manufacturer"),model:d.get("model"),serialNumber:d.get("serialNumber"),
    purchaseDate:d.get("purchaseDate")||null,purchaseCostCents:amountToCents(d.get("purchaseCost")),
    warrantyEnd:d.get("warrantyEnd")||null,notes:d.get("notes")
  },existing?"Homeowner updated a household asset.":"Homeowner registered a household asset."]);
}


function renderAssets(items){
  const target=$("#asset-results");
  if(!target)return;
  const body=items.map(a=>'<div class="ledger-entry" role="listitem"><button type="button" class="ledger-main" data-asset="'+esc(a.id)+'"><span class="ledger-entry-content"><strong class="fade-title">'+esc(a.name)+'</strong><small>'+esc([displayLabel(a.category),a.location].filter(Boolean).join(" · ")||a.system_name||"Household asset")+'</small></span></button><div class="ledger-details">'+operationalBadge(a)+'</div></div>').join("");
  target.innerHTML=ledger("Appliances & furniture",items.length,"",body,"Asset");
  $$("[data-asset]",target).forEach(b=>b.onclick=()=>openAsset(b.dataset.asset));
}
async function showAppliances(){
  loading();const revision=state.viewRevision;
  try{
    state.assets=await api("/api/assets");
    if(revision!==state.viewRevision)return;
    content.innerHTML=registerTools("assets",false,registerAction("new-asset","Register asset"),state.assets.length)+'<div id="asset-results"></div>';
    $("#new-asset").onclick=()=>openAssetForm();
    renderAssets(state.assets);
    bindRegisterSearch(state.assets,a=>[a.name,a.system_name,a.location,a.manufacturer,a.model,a.category].filter(Boolean).join(" "));
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

async function openAsset(id){
  const pending=waitingModal("Opening asset…");
  try{
    const a=await api("/api/assets/"+encodeURIComponent(id));
    if(!modalPending(pending))return;
    const activeIssues=(a.issues||[]).filter(i=>!["RESOLVED","CLOSED"].includes(normalizeStatus(i.status)));
    const overdueRules=(a.maintenance||[]).filter(m=>Number(m.active)===1&&String(m.next_due_at||"")<today());
    const pricedRepairs=(a.repairs||[]).filter(r=>r.cost_cents!=null&&Number.isSafeInteger(Number(r.cost_cents))&&Number(r.cost_cents)>=0);
    const repairSpend=pricedRepairs.reduce((total,r)=>total+Number(r.cost_cents),0);
    let html='<p class="eyebrow">'+esc(a.system_name)+'</p><h2>'+esc(a.name)+'</h2><div class="hero-actions">'+operationalBadge(a)+'</div>'
      +'<p class="asset-assessment-note">Based on the recorded condition, unresolved issues and overdue maintenance.</p>'
      +'<div class="asset-facts">'
      +'<span>'+activeIssues.length+' unresolved '+(activeIssues.length===1?'issue':'issues')+'</span>'
      +'<span>'+(a.repairs||[]).length+' recorded '+((a.repairs||[]).length===1?'repair':'repairs')+'</span>'
      +(pricedRepairs.length?'<span>'+money(repairSpend)+' recorded repair costs</span>':'')
      +(overdueRules.length?'<span>'+overdueRules.length+' overdue '+(overdueRules.length===1?'service task':'service tasks')+'</span>':'')
      +'</div><div class="detail-grid">';
    [["Location",a.location||"—"],["Purchased",fmtDate(a.purchase_date)],["Age",assetAge(a)],["Purchase price",money(a.purchase_cost_cents)],["Manufacturer",a.manufacturer||"—"],["Model",a.model||"—"],["Warranty end",fmtDate(a.warranty_end)]].forEach(function(v){html+='<div class="detail"><span>'+esc(v[0])+'</span><strong>'+esc(v[1])+"</strong></div>"});
    html+="</div>";if(a.notes)html+='<div class="detail-section"><h3>Notes</h3><div class="row-note">'+esc(a.notes)+"</div></div>";
    html+='<div class="detail-section"><h3>Issues</h3><div class="rows">'+(a.issues.map(function(i){return row(i.title,fmtDate(i.detected_at)+" · "+priorityLabel(i.severity),badge(issueStageLabel(i.status)),i.description||"")}).join("")||'<div class="empty">No issues.</div>')+"</div></div>";
    html+='<div class="detail-section"><h3>Repairs</h3><div class="rows">'+((a.repairs||[]).map(function(r){return row(r.title,fmtDate(r.repair_date),'<span class="money">'+money(r.cost_cents)+"</span>",r.outcome||"")}).join("")||'<div class="empty">No repairs.</div>')+"</div></div>";
    html+='<div class="detail-section"><h3>Files</h3><div class="rows">'+(a.documents.map(function(d){return row(d.title,d.type,'<button class="button" data-file="'+esc(d.id)+'">Open</button>',"",true)}).join("")||'<div class="empty">No files.</div>')+"</div></div>";
    html+='<div class="form-actions"><button class="primary-button" id="edit-asset">Edit details</button></div>';
    openModal(html);$("#edit-asset").onclick=function(){openAssetForm(a)};$$("[data-file]",modalBody).forEach(function(b){b.onclick=function(){const doc=(a.documents||[]).find(d=>d.id===b.dataset.file);if(doc)void openFile(doc)}})
  }catch(e){modalLoadFailed(pending,e)}
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
  if(viewer.open&&state.viewerDocumentId===doc.id)return;
  state.viewerDocumentId=doc.id;
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
    insight.hidden=false;insight.replaceChildren(createInteraction("Processing stored evidence…",{pending:true}));
    try{
      const visualFrames=mime.startsWith("video/")?await sampleVideoFrames($("video",viewerBody)):undefined;
      if(revision!==state.viewerRevision)return;
      const result=await api("/api/documents/"+encodeURIComponent(doc.id)+"/analyze",{method:"POST",body:visualFrames?{visualFrames}:{}});
      if(revision===state.viewerRevision)insight.replaceChildren(createInteraction(result.text));
    }catch(e){if(revision===state.viewerRevision)insight.replaceChildren(createInteraction(e.message,{error:true}))}
    finally{if(revision===state.viewerRevision){analyze.disabled=false;analyze.textContent="Analyze"}}
  };
  viewerBody.innerHTML='<div class="viewer-loading" role="status">Opening file…</div>';
  if(!viewer.open)viewer.showModal();
  const live=()=>revision===state.viewerRevision&&viewer.open;
  const action=(text,url,download=false)=>'<a class="primary-button" href="'+esc(url)+'" '+(download?'download':'target="_blank" rel="noopener noreferrer"')+'>'+esc(text)+'</a>';
  if(!href){
    viewerBody.innerHTML='<div class="viewer-link"><strong>No file or source link is attached.</strong></div>';
    return;
  }
  if(new URL(href).origin===location.origin){
    if(mime.startsWith("video/")||mime.startsWith("audio/")){
      viewerBody.innerHTML=mime.startsWith("video/")
        ?'<video controls preload="metadata" src="'+esc(href)+'"></video>'
        :'<audio controls preload="metadata" src="'+esc(href)+'"></audio>';
      return;
    }
    if(mime.startsWith("image/")){
      viewerBody.innerHTML='<img src="'+esc(href)+'" alt="'+esc(doc.title)+'">';
      const image=$("img",viewerBody);
      image.onerror=()=>{if(live())viewerBody.innerHTML='<div class="viewer-link"><strong>Image unavailable.</strong>'+action("Open file",href)+'</div>'};
      return;
    }
    if(!/^(application\/pdf|text\/plain|text\/csv|application\/json)$/.test(mime)){
      viewerBody.innerHTML='<div class="viewer-link">'+action("Download file",href,true)+'</div>';
      return;
    }
    try{
      const res=await fetch(href,{credentials:"same-origin"});
      if(!live())return;
      if(!res.ok)throw new Error("File unavailable (HTTP "+res.status+").");
      if(mime.startsWith("text/")||mime==="application/json"){
        const plain=await res.text();
        if(!live())return;
        const pre=document.createElement("pre");
        pre.className="viewer-text";
        pre.textContent=plain.length>500000?plain.slice(0,500000)+"\n\n[Preview truncated]":plain;
        viewerBody.replaceChildren(pre);
      }else{
        const blob=await res.blob();
        if(!live())return;
        state.objectUrl=URL.createObjectURL(blob);
        viewerBody.innerHTML='<embed type="application/pdf" src="'+esc(state.objectUrl)+'" />'
          +'<div class="viewer-file-action">'+action("Open PDF",href)+action("Download PDF",href,true)+'</div>';
      }
    }catch(e){
      if(live())viewerBody.innerHTML='<div class="viewer-link"><strong>'+esc(e.message)+'</strong>'+action("Try opening file",href)+'</div>';
    }
  }else if(doc.provider==="GOOGLE_DRIVE"&&doc.provider_file_id){
    viewerBody.innerHTML='<iframe title="'+esc(doc.title)+'" src="https://drive.google.com/file/d/'+encodeURIComponent(doc.provider_file_id)+'/preview" sandbox="allow-scripts allow-same-origin"></iframe>';
  }else if(mime.startsWith("image/")){
    viewerBody.innerHTML='<img src="'+esc(href)+'" alt="'+esc(doc.title)+'">';
  }else if(mime.startsWith("video/")){
    viewerBody.innerHTML='<video controls preload="metadata" src="'+esc(href)+'"></video>';
  }else if(mime.startsWith("audio/")){
    viewerBody.innerHTML='<audio controls preload="metadata" src="'+esc(href)+'"></audio>';
  }else{
    viewerBody.innerHTML='<div class="viewer-link">'+action("Open source",href)+'</div>';
  }
}
$("#viewer-close").onclick=function(){viewer.close()};
viewer.addEventListener("close",function(){state.viewerRevision=(state.viewerRevision||0)+1;$("#viewer-insight").hidden=true;if(state.objectUrl){URL.revokeObjectURL(state.objectUrl);state.objectUrl=null}});

async function openLinkEvidenceForm(){
  const pending=waitingModal("Preparing file options…");
  let results;
  try {
    results=await Promise.all([assetOptions(""),api("/api/issues"),api("/api/repairs"),api("/api/charges"),api("/api/purchases")]);
  } catch(error){modalLoadFailed(pending,error);return}
  if(!modalPending(pending))return;
  const options=results[0],issues=results[1],repairs=results[2],charges=results[3],purchases=results[4];
  const optional=function(label,items,display){return '<option value="">'+esc(label)+'</option>'+items.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(display(x))+'</option>'}).join("")};
  const assetOptionsHtml='<option value="">None</option>'+options;
  openModal('<h2>Save a source link</h2><form class="form" id="link-evidence-form"><div class="form-grid"><div class="field full"><label>Source URL</label><input type="url" name="sourceUrl" maxlength="2000" placeholder="https://…" required></div><div class="field full"><label>Title</label><input name="title" maxlength="240" required></div><div class="field"><label>Type</label><select name="documentType"><option>WARRANTY</option><option>MANUAL</option><option>INVOICE</option><option>RECEIPT</option><option>INSPECTION</option><option>PHOTO</option><option>VIDEO</option><option>REPORT</option><option value="OTHER" selected>Other</option></select></div><div class="field"><label>Evidence date</label><input type="date" name="occurredAt" value="'+today()+'" required></div><div class="field"><label>Status</label><select name="evidenceStatus"><option selected>ACTIVE</option><option>REFERENCE</option><option>ARCHIVED</option></select></div><div class="field"><label>Asset</label><select name="assetId">'+assetOptionsHtml+'</select></div><div class="field"><label>Issue</label><select name="issueId">'+optional("None",issues,function(x){return x.title+" · "+x.asset_name})+'</select></div><div class="field"><label>Repair</label><select name="repairId">'+optional("None",repairs,function(x){return x.title+" · "+x.asset_name})+'</select></div><div class="field"><label>Recurring charge</label><select name="chargeId">'+optional("None",charges,function(x){return x.name+" · "+x.billing_cycle})+'</select></div><div class="field"><label>Potential purchase</label><select name="purchaseCandidateId">'+optional("None",purchases,function(x){return x.title+" · "+x.status})+'</select></div><div class="field full"><label>Provenance</label><input name="provenance" maxlength="1000" value="Saved by homeowner."></div><div class="field full"><label>Reason</label><textarea name="evidenceReason" maxlength="2000"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="primary-button">Preview evidence</button></div></form>');
  $("[data-cancel]",modalBody).onclick=closeModal;
  bindPreviewForm("#link-evidence-form",d=>{
    const url=String(d.get("sourceUrl")||"").trim();
    return ["ATTACH_DOCUMENT",{
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
    },"Homeowner saved this source link as household evidence."];
  });
}


async function openUploadEvidenceForm(defaults){
  await openLinkEvidenceForm();
  const form=$("#link-evidence-form");
  if(!form)return;
  const source=$('input[name="sourceUrl"]',form);
  source.closest(".field").innerHTML='<label for="homely-attachment">File (maximum 50 MB)</label><input id="homely-attachment" type="file" name="attachment" required accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,audio/*,video/mp4,video/webm,.doc,.docx,.zip">';
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

    if(activeUploadController)return;
    const submit=$('button[type="submit"],button.primary-button',form);
    const uploadGeneration=modalGeneration;
    const controller=new AbortController();
    activeUploadController=controller;
    if(submit)submit.disabled=true;
    try{
      const staged=await api("/api/uploads/start",{method:"POST",signal:controller.signal,body:{name:file.name,mimeType:file.type||"application/octet-stream",size:file.size}});
      const total=Math.ceil(file.size/staged.chunkSize);
      for(let index=0;index<total;index++){
        if(controller.signal.aborted||!modalPending(uploadGeneration))return;
        const chunk=file.slice(index*staged.chunkSize,Math.min(file.size,(index+1)*staged.chunkSize));
        await api("/api/uploads/"+encodeURIComponent(staged.id)+"/chunks/"+index,
          {method:"PUT",signal:controller.signal,headers:{"content-type":"application/octet-stream"},body:chunk});
        if(submit)submit.textContent="Uploading "+Math.round((index+1)/total*100)+"%";
      }
      await api("/api/uploads/"+encodeURIComponent(staged.id)+"/finish",{method:"POST",signal:controller.signal});
      if(!modalPending(uploadGeneration))return;
      if(submit){submit.disabled=false;submit.textContent="Preview attachment"}
      activeUploadController=null;
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
    }catch(err){if(!controller.signal.aborted&&modalPending(uploadGeneration))notify(err.message)}
    finally{
      if(activeUploadController===controller)activeUploadController=null;
      if(submit?.isConnected){submit.disabled=false;submit.textContent="Preview attachment"}
    }
  };
}


async function showFiles(){
  loading();const revision=state.viewRevision;
  try{
    const docs=await api("/api/documents");
    if(revision!==state.viewRevision)return;
    const actions=registerAction("save-link","Save link","link",false)+registerAction("upload-file","Upload file","upload");
    const cards=docs.map(d=>{
      const links=[d.asset_name,d.issue_title&&"Issue: "+d.issue_title,d.repair_title&&"Repair: "+d.repair_title,d.charge_name&&"Charge: "+d.charge_name,d.purchase_title&&"Purchase: "+d.purchase_title].filter(Boolean);
      return '<button class="file-card" type="button" data-file="'+esc(d.id)+'" aria-label="Select '+esc(d.title)+'" aria-pressed="false">'
        +'<span class="file-row-icon" aria-hidden="true">'+fileIcon(d)+'</span><span class="file-entry-copy"><strong class="fade-title">'+esc(d.title)+'</strong>'
        +'<small>'+esc(links[0]||"Household file")+'</small></span></button>';
    }).join("")||'<div class="files-empty"><span class="file-glyph" aria-hidden="true">'+fileIcon()+'</span><strong>No files</strong></div>';
    content.innerHTML='<div class="file-controls page-controls"><div class="controls-leading">'+quickSearch("files","file-search")+'</div><span class="search-count" id="file-count">'+docs.length+' '+(docs.length===1?'file':'files')+'</span><div class="controls-actions">'+actions+'</div></div>'
      +'<section class="file-browser"><div class="file-browser-body"><div class="file-browser-main"><div class="file-list">'+cards+'</div></div></div></section>';
    $("#save-link").onclick=()=>openLinkEvidenceForm();
    $("#upload-file").onclick=()=>openUploadEvidenceForm();
    state.syncFileInfo=null;
    bindCollectionSearch({
      items:docs,entrySelector:".file-card",searchId:"file-search",countId:"file-count",
      container:$(".file-list",content),
      textFor:d=>[d.title,d.asset_name,d.issue_title,d.repair_title,d.charge_name,d.purchase_title].filter(Boolean).join(" "),
      unit:"file",plural:"files",emptyMessage:"No matching files",
      onUpdate:()=>{if(!$(".file-card[aria-pressed=true]:not([hidden])",content))for(const card of document.querySelectorAll(".file-card"))card.setAttribute("aria-pressed","false")}
    });
    $$("[data-file]",content).forEach(b=>{
      const doc=docs.find(d=>d.id===b.dataset.file);
      const select=()=>$$("[data-file]",content).forEach(card=>card.setAttribute("aria-pressed",String(card===b)));
      b.title="Double-click or double-tap to open";
      b.onclick=select;
      b.ondblclick=()=>{select();void openFile(doc)};
      b.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();select();void openFile(doc)}};
      let tap=null;
      b.onpointerup=e=>{
        if(e.pointerType!=="touch")return;
        const next={at:performance.now(),x:e.clientX,y:e.clientY};
        if(tap&&next.at-tap.at<450&&Math.hypot(next.x-tap.x,next.y-tap.y)<24){tap=null;select();void openFile(doc)}
        else tap=next;
      };
    });
  }catch(e){if(revision===state.viewRevision)fail(e)}
}

function messageElement(m){
  const message=createInteraction(m.text,{role:m.role});
  for(const p of m.proposals||[]){
    const proposal=document.createElement("section");
    proposal.className="proposal";
    proposal.append(createReview(p.preview,p.reason));
    if(p.status==="PROPOSED"){
      const actions=document.createElement("div");actions.className="proposal-actions";
      for(const action of ["reject","approve"]){
        const button=document.createElement("button");button.type="button";
        button.className=action==="approve"?"primary-button":"button";
        button.dataset[action]=p.transactionId;button.textContent=action==="approve"?"Approve":"Reject";
        actions.append(button);
      }
      proposal.append(actions);
    }else{
      const status=document.createElement("div");status.className="row-meta";status.textContent=statusLabel(p.status);
      proposal.append(status);
    }
    message.append(proposal);
  }
  return message;
}
const pendingProposalActions=new Set();
function renderChat(){
  chatBody.replaceChildren(...state.agentMessages.map(messageElement));
  if(!state.agentMessages.length){const empty=document.createElement("p");empty.className="chat-empty";empty.textContent="Ask Homely anything about your home.";chatBody.append(empty)}

  async function actOnProposal(id,action){
    if(pendingProposalActions.has(id))return;
    pendingProposalActions.add(id);
    const controls=$$("[data-approve],[data-reject]",chatBody).filter(b=>
      b.dataset.approve===id||b.dataset.reject===id);
    controls.forEach(b=>b.disabled=true);
    try{
      await api("/api/transactions/"+encodeURIComponent(id)+"/"+action,{method:"POST"});
      for(const message of state.agentMessages){
        const proposal=(message.proposals||[]).find(p=>p.transactionId===id);
        if(proposal)proposal.status=action==="commit"?"COMMITTED":"REJECTED";
      }
      renderChat();
      notify(action==="commit"?"Approved and committed.":"Proposal rejected.");
      if(action==="commit")await selectView(state.view);
    }catch(e){notify(e.message);controls.forEach(b=>{if(b.isConnected)b.disabled=false})}
    finally{pendingProposalActions.delete(id)}
  }
  $$("[data-approve]",chatBody).forEach(b=>b.onclick=()=>actOnProposal(b.dataset.approve,"commit"));
  $$("[data-reject]",chatBody).forEach(b=>b.onclick=()=>actOnProposal(b.dataset.reject,"reject"));
  $$("[data-approve],[data-reject]",chatBody).forEach(b=>{
    if(pendingProposalActions.has(b.dataset.approve||b.dataset.reject))b.disabled=true;
  });
  if(state.chatBusy){
    chatBody.appendChild(createInteraction("Working…",{pending:true}));
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
  e.preventDefault();if(state.chatLoading||state.chatBusy)return;const message=chatInput.value.trim();if(!message)return;state.chatBusy=true;$("#chat-new").disabled=true;
  state.agentMessages.push({role:"user",text:message,proposals:[]});chatInput.value="";renderChat();const button=chatForm.querySelector('button[type="submit"]');button.disabled=true;button.setAttribute("aria-label","Sending message");
  try{
    if(!state.conversationId){
      const c=await api("/api/agent/conversations",{method:"POST"});
      state.conversationId=c.id;state.conversations.unshift(c);
    }
    const r=await api("/api/agent/respond",{method:"POST",body:{message,conversationId:state.conversationId,previousResponseId:state.previousResponseId}});
    state.previousResponseId=r.responseId;
    state.agentMessages.push({role:"assistant",text:r.text,proposals:(r.proposals||[]).map(p=>({...p,status:"PROPOSED"}))});
    await refreshConversationList();
  }
  catch(err){state.agentMessages.push({role:"assistant",text:err.message,proposals:[]})}
  finally{
    state.chatBusy=false;$("#chat-new").disabled=false;
    button.disabled=!(state.integrations&&state.integrations.ai&&state.integrations.ai.available);
    button.setAttribute("aria-label","Send message");renderChat();
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
  function reset(){listening=false;voiceButton.classList.remove("listening");voiceButton.setAttribute("aria-label","Dictate message");voiceButton.setAttribute("aria-pressed","false");voiceButton.title="Dictate message"}
  state.stopVoice=function(){if(!listening)return;reset();if(recognition.abort)recognition.abort();else recognition.stop()};
  recognition.onstart=function(){if(!listening){recognition.abort();return}voiceButton.classList.add("listening");voiceButton.setAttribute("aria-label","Stop listening");voiceButton.setAttribute("aria-pressed","true");voiceButton.title="Stop listening"};
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
function navigate(view,replace){
  view=normalizeView(view);
  if(!replace&&view===state.view&&!history.state?.homelyChat)return;
  const url=view==="home"?"/":"/?view="+encodeURIComponent(view);
  if(replace)history.replaceState({view},"",url);
  else history.pushState({view},"",url);
  void selectView(view);
}
nav.onclick=function(e){const b=e.target.closest("[data-view]");if(b)navigate(b.dataset.view,false)};
window.onpopstate=function(){
  const next=normalizeView(new URLSearchParams(location.search).get("view")||"home");
  if(window.matchMedia("(max-width: 959px)").matches){
    if(history.state?.homelyChat){
      if(!chatRail.classList.contains("open"))openChat(true);
    }else if(chatRail.classList.contains("open"))closeChat(true);
  }
  if(next!==state.view)void selectView(next);
};
// Android's keyboard can shrink only the visual viewport; 100dvh alone may
// leave the composer below the keyboard. This does not affect desktop docking.
function syncMobileChatViewport(){
  if(window.matchMedia("(min-width: 960px)").matches||!chatRail.classList.contains("open")){
    chatRail.style.removeProperty("--homely-visual-height");
    chatRail.style.removeProperty("--homely-visual-top");
    return;
  }
  const viewport=window.visualViewport;
  if(!viewport)return;
  chatRail.style.setProperty("--homely-visual-height",Math.max(200,Math.round(viewport.height))+"px");
  chatRail.style.setProperty("--homely-visual-top",Math.round(viewport.offsetTop)+"px");
}
window.visualViewport?.addEventListener("resize",syncMobileChatViewport);
window.visualViewport?.addEventListener("scroll",syncMobileChatViewport);
window.addEventListener("resize",syncMobileChatViewport);
function syncAssistantAccessibility(){
  const docked=window.matchMedia("(min-width: 960px)").matches;
  const visible=docked?!workspaceLayout.assistant.collapsed:chatRail.classList.contains("open");
  $("#app-shell").classList.toggle("assistant-collapsed",workspaceLayout.assistant.collapsed);
  $("#app-shell").classList.toggle("assistant-expanded",docked&&workspaceLayout.assistant.expanded&&!workspaceLayout.assistant.collapsed);
  $("#assistant-expand").setAttribute("aria-pressed",String(workspaceLayout.assistant.expanded));
  $("#assistant-expand").setAttribute("aria-label",workspaceLayout.assistant.expanded?"Restore chat width":"Expand chat");
  $("#assistant-expand").title=workspaceLayout.assistant.expanded?"Restore chat width":"Expand chat";
  chatRail.setAttribute("aria-hidden",String(!visible));chatRail.inert=!visible;
  syncMobileChatViewport();
  const modalAssistant=!docked&&visible;
  $(".workspace").inert=modalAssistant;$(".sidebar").inert=modalAssistant;
  chatRail.setAttribute("role",modalAssistant?"dialog":"complementary");
  if(modalAssistant)chatRail.setAttribute("aria-modal","true");else chatRail.removeAttribute("aria-modal");
  if(docked){chatRail.classList.remove("open");$("#chat-backdrop").hidden=true;document.body.classList.remove("chat-visible")}
  if(!visible)toggleConversationList(false);
  $("#chat-open").setAttribute("aria-expanded",String(visible));$("#chat-trigger").setAttribute("aria-expanded",String(visible));
  if(!visible&&chatRail.contains(document.activeElement))(docked?$("#chat-trigger"):$("#chat-open")).focus();
}
window.addEventListener("resize",syncAssistantAccessibility);
function openChat(fromHistory=false){
  if(window.matchMedia("(min-width: 960px)").matches){workspaceLayout.assistant.collapsed=false;saveWorkspaceLayout();syncAssistantAccessibility();$("#assistant-collapse").focus();return}
  if(chatRail.classList.contains("open"))return;
  state.chatReturnFocus=document.activeElement;
  if(!fromHistory&&!history.state?.homelyChat){
    history.pushState({...history.state,view:state.view,homelyChat:true},"",location.href);
  }
  document.body.classList.add("chat-visible");
  chatRail.classList.add("open");
  chatRail.setAttribute("aria-hidden","false");
  $("#chat-backdrop").hidden=false;
  $("#chat-open").setAttribute("aria-expanded","true");
  $("#chat-trigger").setAttribute("aria-expanded","true");
  syncAssistantAccessibility();
  requestAnimationFrame(()=>{if(chatRail.classList.contains("open"))(chatInput.disabled?$("#chat-close"):chatInput).focus()});
}
function closeChat(fromHistory=false){
  if(state.stopVoice)state.stopVoice();
  if(window.matchMedia("(min-width: 960px)").matches){workspaceLayout.assistant.collapsed=true;chatRail.classList.remove("open");saveWorkspaceLayout();syncAssistantAccessibility();$("#chat-trigger").focus();return}
  const wasOpen=chatRail.classList.contains("open");
  chatRail.classList.remove("open");
  document.body.classList.remove("chat-visible");
  chatRail.setAttribute("aria-hidden","true");
  $("#chat-backdrop").hidden=true;
  $("#chat-open").setAttribute("aria-expanded","false");
  $("#chat-trigger").setAttribute("aria-expanded","false");
  syncAssistantAccessibility();
  if(!window.matchMedia("(min-width: 960px)").matches)state.chatReturnFocus?.focus();
  if(wasOpen&&!fromHistory&&history.state?.homelyChat)history.back();
}
$("#chat-open").onclick=()=>openChat();
$("#chat-trigger").onclick=()=>openChat();
$("#chat-close").onclick=()=>closeChat();
$("#assistant-collapse").onclick=()=>closeChat();
$("#assistant-expand").onclick=()=>{workspaceLayout.assistant.expanded=!workspaceLayout.assistant.expanded;workspaceLayout.assistant.collapsed=false;saveWorkspaceLayout();syncAssistantAccessibility()};
bindPanelResize({name:"assistant",container:$("#app-shell"),panel:chatRail,handle:$("#assistant-resizer"),variable:"--assistant-width",min:280,max:640,mainMin:480,breakpoint:960});
$("#chat-backdrop").onclick=()=>closeChat();
// Preserve view-local controls when a background refresh replaces the DOM.
function captureViewState(){
  const search=content.querySelector(".quick-search input");
  const toggle=content.querySelector(".search-toggle");
  const selected=content.querySelector(".file-card[aria-pressed='true']");
  const filter=content.querySelector(".register-filters [data-status][aria-pressed='true']");
  return {
    searchOpen:toggle?.getAttribute("aria-expanded")==="true",
    query:search?.value||"",
    status:filter?.dataset.status||"all",
    selectedFile:selected?.dataset.file||null
  };
}
function restoreViewState(saved){
  if(!saved)return;
  const toggle=content.querySelector(".search-toggle"),input=content.querySelector(".quick-search input");
  if(saved.searchOpen&&toggle&&toggle.getAttribute("aria-expanded")!=="true")toggle.click();
  if(input&&saved.query){input.value=saved.query;input.dispatchEvent(new Event("input",{bubbles:true}))}
  if(saved.status!=="all")content.querySelector('.register-filters [data-status="'+saved.status+'"]')?.click();
  if(saved.selectedFile){
    const entry=Array.from(content.querySelectorAll(".file-card")).find(el=>el.dataset.file===saved.selectedFile&&!el.hidden);
    entry?.click();
  }
}
async function refreshVisibleView(force=false){
  if(!state.ready||document.hidden||state.viewRefreshPending||state.chatBusy||modal.open||viewer.open)return;
  if(!force&&Date.now()-state.viewLoadedAt<ACTIVE_REFRESH_MS)return;
  const focused=document.activeElement;
  if(focused&&content.contains(focused)&&focused.matches("input,select,textarea,[contenteditable],button"))return;
  const current=state.view,revision=++state.viewRevision;
  const saved=captureViewState();
  state.viewRefreshPending=true;state.silentRefresh=true;
  try{
    await views[current][1]();
    if(state.view===current&&state.viewRevision===revision){
      restoreViewState(saved);
      state.viewLoadedAt=Date.now();
    }
  }finally{state.silentRefresh=false;state.viewRefreshPending=false}
}
window.addEventListener("focus",()=>void refreshVisibleView());
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refreshVisibleView()});
async function openHouseholdSettings(){
  const pending=waitingModal("Opening settings…");
  try{
    const [state,members]=await Promise.all([api("/api/homes"),api("/api/homes/members")]);
    if(!modalPending(pending))return;
    const home=state.homes.find(h=>h.id===state.currentHomeId);
    const owner=home&&home.role==="OWNER";
    const hasSample=state.homes.some(h=>h.id.startsWith("home-sample-"));
    const pendingInvites=owner?await api("/api/homes/invitations"):[];
    if(!modalPending(pending))return;
    let markup='<h2>Household settings</h2><p class="row-meta">'+esc($("#account-email").textContent)+'</p>';
    markup+='<div class="detail-section"><h3>Your homes</h3><div class="rows">'+state.homes.map(h=>
      row(h.name,statusLabel(h.role),h.id===state.currentHomeId?'<span class="badge">Current</span>':'<button type="button" class="button" data-switch="'+esc(h.id)+'">Open home</button>')
    ).join("")+'</div>'+(owner&&!hasSample?'<div class="form-actions"><button type="button" class="button" id="open-sample-home">Open sample home</button></div>':'')+'</div>';
    if(owner){
      markup+='<div class="detail-section"><h3>Home name</h3><form class="form" id="rename-home-form"><div class="field"><label>Household</label><input name="homeName" maxlength="100" value="'+esc(home.name)+'" required></div><div class="form-actions"><button class="button" type="submit">Save name</button></div></form></div>';
      markup+='<div class="detail-section"><h3>Invite a member</h3><form class="form" id="invite-home-form"><div class="field"><label>Google email address</label><input name="email" type="email" required></div><div class="field"><label>Access</label><select name="role"><option value="MEMBER">Member — edit records</option><option value="VIEWER">Viewer — read only</option></select></div><div class="form-actions"><button class="button" type="submit">Create invite link</button></div></form><div id="invite-result"></div></div>';
      if(pendingInvites.length)markup+='<div class="detail-section"><h3>Pending invitations</h3><div class="rows">'+pendingInvites.map(x=>row(x.email,statusLabel(x.role)+' · expires '+fmtDate(x.expires_at),'<button type="button" class="button" data-revoke="'+esc(x.id)+'">Revoke</button>')).join("")+'</div></div>';
    }
    if(owner)markup+='<div class="detail-section"><h3>Download your data</h3><div class="form-actions"><a class="button" href="/api/account/export" download="homely-backup.tar">Export household</a></div></div>';
    if(members.length>1)markup+='<div class="detail-section"><h3>Members</h3><div class="rows">'+members.map(x=>row(x.name,x.email+' · '+statusLabel(x.role),owner&&x.role!=="OWNER"?'<button type="button" class="button" data-remove="'+esc(x.id)+'">Remove</button>':'')).join("")+'</div></div>';
    markup+='<div class="detail-section"><h3>Delete account</h3><div class="form-actions"><button type="button" class="button" id="delete-account">Delete account…</button></div></div>';
    openModal('<div class="settings-content">'+markup+'</div>');
    const sampleButton=$("#open-sample-home");
    if(sampleButton)sampleButton.onclick=async()=>{
      sampleButton.disabled=true;sampleButton.textContent="Opening…";
      try{await api("/api/homes/sample",{method:"POST"});window.location.assign("/")}
      catch(error){notify(error.message);sampleButton.disabled=false;sampleButton.textContent="Open sample home"}
    };
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
  }catch(error){modalLoadFailed(pending,error)}
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
    if(new URLSearchParams(location.search).get("sample")==="1")sessionStorage.setItem("homely_pending_sample","1");
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
    if(sessionStorage.getItem("homely_pending_sample")==="1"){
      try{
        await api("/api/homes/sample",{method:"POST"});
        sessionStorage.removeItem("homely_pending_sample");
        const url=new URL(location.href);url.searchParams.delete("sample");history.replaceState(null,"",url);
      }catch(error){sessionStorage.removeItem("homely_pending_sample");notify(error.message)}
    }
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

