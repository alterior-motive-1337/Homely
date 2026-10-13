import { renderMarkdown } from "./markdown.js";

export function markdownBody(text, className="") {
  const body=document.createElement("div");
  body.className="markdown-body"+(className?" "+className:"");
  body.append(renderMarkdown(text));
  return body;
}

// Every AI surface uses the same sanitized renderer and message container.
export function createInteraction(text, {role="assistant",pending=false,error=false}={}) {
  const message=document.createElement("article");
  const author=role==="user"?"user":"assistant";
  message.className="message "+author+(pending?" chat-pending":"")+(error?" message-error":"");
  message.setAttribute("aria-label",author==="user"?"Your message":"Homely response");
  if(pending)message.setAttribute("role","status");
  if(error)message.setAttribute("role","alert");
  if(text!=null)message.append(markdownBody(text));
  return message;
}

export function createReview(preview={}, reason="", {title=true}={}) {
  const review=document.createElement("div");
  review.className="review-content";
  if(title&&preview.title){
    const heading=document.createElement("strong");
    heading.className="review-title";
    heading.textContent=preview.title;
    review.append(heading);
  }
  if(preview.summary)review.append(markdownBody(preview.summary));
  if(Array.isArray(preview.effects)&&preview.effects.length){
    const effects=document.createElement("ul");
    effects.className="review-effects";
    for(const effect of preview.effects){
      const item=document.createElement("li");
      item.append(markdownBody(effect));
      effects.append(item);
    }
    review.append(effects);
  }
  if(reason)review.append(markdownBody(reason,"review-reason"));
  return review;
}
