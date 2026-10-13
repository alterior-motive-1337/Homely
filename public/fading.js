// Fade only overflowing titles; preserve the full text for selection and accessibility.
export function watchFadingTitles(root) {
  const titles=new Set();
  let frame=0;
  function update(title) {
    title.classList.toggle("is-overflowing",title.clientWidth>0&&title.scrollWidth>title.clientWidth+1);
    title.title=title.textContent||"";
  }
  const resize=new ResizeObserver(entries=>entries.forEach(entry=>update(entry.target)));
  function scan() {
    frame=0;
    for(const title of titles){
      if(!root.contains(title)){resize.unobserve(title);titles.delete(title)}
    }
    for(const title of root.querySelectorAll(".fade-title")){
      if(!titles.has(title)){titles.add(title);resize.observe(title)}
      update(title);
    }
  }
  const changes=new MutationObserver(()=>{
    if(!frame)frame=requestAnimationFrame(scan);
  });
  changes.observe(root,{childList:true,characterData:true,subtree:true});
  scan();
  return ()=>{changes.disconnect();resize.disconnect();if(frame)cancelAnimationFrame(frame)};
}
