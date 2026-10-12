/* Published community content. Never interpret officer-authored text as HTML. */
(() => {
  "use strict";
  const script = document.currentScript;
  const api = script.dataset.api;
  const defaultsUrl = script.dataset.defaults;
  const targets = name => [...document.querySelectorAll(`[data-site-content="${name}"]`)];
  function element(tag, text, className) { const node=document.createElement(tag); if(text) node.textContent=text; if(className) node.className=className; return node; }
  function safeUrl(value) { if(!value) return ""; try { const url=new URL(value,location.origin); return url.protocol==="https:" || (value.startsWith("/assets/") && !value.startsWith("//")) ? url.href : ""; } catch { return ""; } }
  function image(url, label) { const src=safeUrl(url); if(!src) return null; const img=element("img"); img.src=src; img.alt=label; img.loading="lazy"; img.width=240; img.height=240; img.className="ph-managed-photo"; return img; }
  function paragraph(parent,label,value) { if(value) parent.append(element("p",label ? `${label}: ${value}` : value)); }
  function card(title) { const node=element("article",null,"ph-card"); node.append(element("h3",title)); return node; }
  function replace(name, nodes, empty) { targets(name).forEach(target=>{target.replaceChildren(...nodes.map(node=>node.cloneNode(true))); if(!nodes.length) target.append(element("p",empty,"ph-empty"));}); }
  function date(value) { const parsed=new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
  function displayDate(value) { return date(value)?.toLocaleDateString("en-PH",{year:"numeric",month:"long",day:"numeric",timeZone:"Asia/Manila"}) ?? ""; }
  let latestEvents=[];
  function selectedEventSeries() { return document.querySelector("[data-event-series][aria-selected='true']")?.dataset.eventSeries ?? ""; }
  function renderEvents(rows) {
    latestEvents=rows;
    const today=new Date(); today.setHours(0,0,0,0);
    const series=selectedEventSeries();
    const upcoming=rows.filter(row=>(!series||row.series===series)&&(!date(row.startsAt)||date(row.startsAt)>=today)).sort((a,b)=>(date(a.startsAt)?.getTime() ?? Infinity)-(date(b.startsAt)?.getTime() ?? Infinity));
    replace("events",upcoming.map(row=>{const node=card(row.title); node.id=`event-${row.id}`; const photo=image(row.photoUrl,row.title);if(photo)node.prepend(photo);paragraph(node,"Date",row.scheduleLabel||row.dateStatus==="coming_soon" ? row.scheduleLabel||"Coming Soon" : row.dateStatus==="tentative" ? `Tentative${row.startsAt ? ` · ${displayDate(row.startsAt)}` : ""}` : displayDate(row.startsAt)); paragraph(node,"Series",row.series); paragraph(node,"Modules",row.modules||row.topic); paragraph(node,"Type",row.eventType); paragraph(node,"Venue / platform",row.venue); const url=safeUrl(row.registrationUrl); if(url){const link=element("a","Registration details","ph-profile-link");link.href=url;link.rel="noopener noreferrer";node.append(link);}return node;}),"No upcoming events match this learning series.");
  }
  function setupEventTabs() { document.querySelectorAll("[data-event-series]").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("[data-event-series]").forEach(item=>item.setAttribute("aria-selected",String(item===button)));renderEvents(latestEvents);})); }
  function renderLeadership(rows) {
    for(const group of ["ambassador","core","department"]) replace(`leadership-${group}`,rows.filter(row=>row.group===group).map(row=>{const node=card(row.name); const photo=image(row.photoUrl,row.name); if(photo)node.prepend(photo);paragraph(node,"",row.title);paragraph(node,"",row.affiliation);paragraph(node,"Department",row.department);return node;}),"Leadership details will be added by the community officers.");
  }
  function renderChapters(rows) { for(const island of ["Luzon","Visayas","Mindanao"]) replace(`chapters-${island}`,rows.filter(row=>row.island===island).map(row=>{const node=card(row.university);const photo=image(row.photoUrl,row.chapter);if(photo)node.prepend(photo);paragraph(node,"Chapter",row.chapter);paragraph(node,"Status",row.status);return node;}),"No participating chapters published yet."); }
  function article(row) { const node=card(row.title);node.id=`article-${row.id}`;const photo=image(row.photoUrl,row.title);if(photo)node.prepend(photo);paragraph(node,"Published",displayDate(row.publishedAt)); for(const [label,key] of [["Event date","eventDate"],["Venue / platform","venue"],["Speakers","speakers"],["Topics","topics"],["Highlights","highlights"],["Takeaways","takeaways"],["Acknowledgments","acknowledgments"]]) paragraph(node,label,key==="eventDate" ? displayDate(row[key]) : row[key]);return node; }
  function renderArticles(rows) { const sorted=[...rows].sort((a,b)=>(date(b.publishedAt)?.getTime()??0)-(date(a.publishedAt)?.getTime()??0));replace("news",sorted.filter(row=>row.kind==="news").map(article),"No community news published yet.");replace("recaps",sorted.filter(row=>row.kind==="recap").map(article),"Past-event recaps will appear here with verified details and documentation."); }
  function renderOfficialNews(rows) { if(!Array.isArray(rows))return;replace("pytorch-news",rows.map(row=>{const node=card(row.title);paragraph(node,"Published",displayDate(row.publishedAt));paragraph(node,"",row.excerpt);const url=safeUrl(row.url);if(url){const link=element("a","Read on pytorch.org","ph-profile-link");link.href=url;link.rel="noopener noreferrer";node.append(link);}return node;}),"Latest PyTorch news is temporarily unavailable. Visit pytorch.org/blog for the source feed."); }
  function render(document, officialNews) { renderLeadership(document.leadership);renderEvents(document.events);renderChapters(document.chapters);renderArticles(document.articles);renderOfficialNews(officialNews); }
  let baseline;
  async function refresh() { try {const response=await fetch(api,{credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error(`HTTP ${response.status}`);const value=await response.json();render(value.document,value.officialPytorchNews);document.documentElement.dataset.siteContentRevision=String(value.revision);document.documentElement.dataset.siteContentStatus="published";}catch(error){document.documentElement.dataset.siteContentStatus="fallback";console.warn("site_content.refresh_failed",{message:String(error)});} }
  async function start() { try {setupEventTabs();const response=await fetch(defaultsUrl,{credentials:"omit"});if(!response.ok)throw Error(`HTTP ${response.status}`);baseline=await response.json();render(baseline);await refresh();setInterval(()=>{if(!document.hidden)void refresh();},60000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refresh();});}catch(error){console.warn("site_content.defaults_failed",{message:String(error)});} }
  void start();
})();
