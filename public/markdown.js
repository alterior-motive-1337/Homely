import { Marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/dompurify.js";

const escapeHtml=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const parser=new Marked({gfm:true,breaks:true,async:false,renderer:{
  html({text}){return escapeHtml(text)},
  // Display image references as links; chat does not fetch remote images automatically.
  image({href,title,text}){return '<a href="'+escapeHtml(href)+'"'+(title?' title="'+escapeHtml(title)+'"':'')+'>'+escapeHtml(text||"Image")+'</a>'}
}});

export function renderMarkdown(text){
  let fragment;
  try{
    fragment=DOMPurify.sanitize(parser.parse(String(text??"")),{
      ALLOWED_TAGS:["p","br","h1","h2","h3","h4","h5","h6","ul","ol","li","strong","em","del","blockquote","pre","code","a","hr","table","thead","tbody","tr","th","td","input"],
      ALLOWED_ATTR:["href","title","class","start","align","type","checked","disabled"],
      ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,RETURN_DOM_FRAGMENT:true
    });
  }catch(_){
    fragment=document.createDocumentFragment();const paragraph=document.createElement("p");paragraph.textContent=String(text??"");fragment.append(paragraph);return fragment;
  }
  for(const link of fragment.querySelectorAll("a")){
    try{
      const url=new URL(link.getAttribute("href")||"",location.href);
      if(!link.hasAttribute("href")||!["https:","http:","mailto:"].includes(url.protocol))throw new Error("Unsupported link");
      link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";
    }catch(_){link.replaceWith(...link.childNodes)}
  }
  for(const input of fragment.querySelectorAll("input")){input.type="checkbox";input.disabled=true;input.tabIndex=-1}
  for(const table of fragment.querySelectorAll("table")){
    const scroll=document.createElement("div");scroll.className="markdown-table";scroll.tabIndex=0;scroll.setAttribute("role","region");scroll.setAttribute("aria-label","Table");table.replaceWith(scroll);scroll.append(table);
  }
  for(const pre of fragment.querySelectorAll("pre")){
    const code=pre.querySelector("code");if(!code)continue;
    const block=document.createElement("div");block.className="markdown-code";
    const header=document.createElement("div");header.className="markdown-code-head";
    const language=document.createElement("span");language.textContent=Array.from(code.classList).find(c=>c.startsWith("language-"))?.slice(9)||"Code";header.append(language);
    if(navigator.clipboard?.writeText){
      const copy=document.createElement("button");copy.type="button";copy.className="code-copy";copy.textContent="Copy";copy.setAttribute("aria-label","Copy code");
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent||"");copy.textContent="Copied";setTimeout(()=>{copy.textContent="Copy"},1800)}catch(_){copy.textContent="Copy failed";setTimeout(()=>{copy.textContent="Copy"},1800)}};
      header.append(copy);
    }
    pre.tabIndex=0;pre.setAttribute("aria-label","Code block");pre.replaceWith(block);block.append(header,pre);
  }
  return fragment;
}
