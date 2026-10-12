"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Card } from "@pytorch-ph/design-system/card";
import { ContentFields } from "./render-fields";
import { editorTabs, labels, newEntry, type EditableCollection, type WebsiteDraft, type WebsiteDocument } from "./model";

// Mental model: edit a local copy → save a new immutable draft → presidents approve that saved revision.
export function WebsiteContentEditor() {
  const officer = useCapabilities().portal.audience === "officer";
  const [draft, setDraft] = useState<WebsiteDraft>();
  const [document, setDocument] = useState<WebsiteDocument>();
  const [events, setEvents] = useState<SavedEvent[]>();
  const [eventError, setEventError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeCollection, setActiveCollection] = useState<EditableCollection>("events");
  const [message, setMessage] = useState("");
  const dirty = !!draft && JSON.stringify(document)!==JSON.stringify(draft.document);
  function receiveDraftSnapshot(view: WebsiteDraft) { setDraft(view); setDocument(structuredClone(view.document)); }
  useEffect(() => { if (!officer) return; let current=true; fetchJson<WebsiteDraft>("/api/officer/site-content", {cache:"no-store"}).then(view => { if (current) receiveDraftSnapshot(view); }).catch(error => { if(current) setMessage(error instanceof Error ? error.message : "Unable to load website draft"); }); return () => {current=false;}; }, [officer]);
  useEffect(() => { if (!officer) return; let current=true; fetchJson<{events: SavedEvent[]}>("/api/officer/events", {cache:"no-store"}).then(view=>{ if(current) setEvents(view.events); }).catch(error=>{ if(current) setEventError(error instanceof Error ? error.message : "Unable to load saved events"); }); return ()=>{current=false;}; }, [officer]);
  async function submitDraftAction(kind: "save" | "approve" | "reload") {
    if (!draft || !document || busy) return;
    if (kind==="reload" && dirty && !window.confirm("Discard unsaved website edits and reload?")) return;
    setBusy(true); setMessage("");
    try {
      const view=await fetchJson<WebsiteDraft>(kind==="approve" ? "/api/officer/site-content/approve" : "/api/officer/site-content", kind==="reload" ? {cache:"no-store"} : {method:kind==="save" ? "PUT" : "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(kind==="save" ? {revision:draft.revision,document} : {revision:draft.revision})});
      receiveDraftSnapshot(view); setMessage(kind==="save" ? "Draft saved. Published pages stay unchanged until presidential approval." : kind==="approve" ? (view.publishedRevision===view.revision ? "Published. Public pages receive this version on their next refresh." : "Approval recorded. Waiting for the remaining presidential approval.") : "Latest draft loaded.");
    } catch(error) { setMessage(error instanceof Error ? error.message : "Website content request failed"); }
    finally { setBusy(false); }
  }
  function updateCollectionEntry(collection: EditableCollection,index: number,key: string,value: string) { setDocument(current => current ? {...current,[collection]:current[collection].map((row,n)=>n===index ? {...row,[key]:value} : row)} : current); }
  if (!officer) return <Card>Officer access required.</Card>;
  if (!draft || !document) return <Card><p role="status">{message || "Loading website content…"}</p></Card>;
  return <div className="space-y-6"><header><h1 className="font-heading text-3xl font-semibold">Website content</h1><p className="mt-2 text-sm text-muted">Events and programs come from saved organization events. News and recap edits use the website draft and presidential approval flow.</p></header><Card><p>Draft {draft.revision} · Published {draft.publishedRevision} · {draft.approvals}/{draft.requiredApprovals} current-president approvals{dirty ? " · Unsaved edits" : ""}</p><div className="mt-3 flex flex-wrap gap-3"><button disabled={busy || !dirty} onClick={()=>void submitDraftAction("save")} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40">Save draft</button>{draft.canApprove && <button disabled={busy || dirty || draft.revision===draft.publishedRevision} onClick={()=>void submitDraftAction("approve")} className="rounded-lg border border-border px-4 py-2 disabled:opacity-40">Approve publication</button>}<button disabled={busy} onClick={()=>void submitDraftAction("reload")} className="rounded-lg border border-border px-4 py-2">Reload draft</button></div><p role="status" className="mt-3 text-sm">{message}</p></Card><Card><h2 className="text-xl font-semibold">Automatic member directories</h2><p className="mt-2 text-sm text-muted">Leadership and Campus Labs use backend role and chapter assignments with member profile visibility settings. Names and photos are managed through member profiles; these directories are not edited in this draft.</p></Card><div role="tablist" aria-label="Website content sections" className="flex gap-2">{editorTabs.map(({collection,label},index)=><button key={collection} id={`website-tab-${collection}`} role="tab" aria-selected={activeCollection===collection} aria-controls={`website-panel-${collection}`} tabIndex={activeCollection===collection ? 0 : -1} onClick={()=>setActiveCollection(collection)} onKeyDown={event=>{ const next=tabIndexForKey(event.key,index); if(next===undefined) return; event.preventDefault(); const selected=editorTabs[next].collection; setActiveCollection(selected); window.document.getElementById(`website-tab-${selected}`)?.focus(); }} className="rounded-lg border border-border px-4 py-2 aria-selected:bg-accent aria-selected:text-white">{label}</button>)}</div>{editorTabs.map(({collection})=><section key={collection} id={`website-panel-${collection}`} role="tabpanel" aria-labelledby={`website-tab-${collection}`} hidden={activeCollection!==collection} tabIndex={0}>{collection==="events" ? <SavedEvents events={events} error={eventError} /> : <Card><h2 className="text-xl font-semibold">{labels[collection]}</h2><p className="mt-2 text-sm text-muted">Plain text only. Photos use approved HTTPS image URLs or existing /assets/ paths. Unknown event dates must be Coming Soon or Tentative.</p>{document[collection].map((row,index)=><fieldset key={row.id ?? index} className="mt-4 space-y-3 rounded-lg border border-border p-4"><legend className="px-2 text-sm">{row.title || row.name || row.university || `Entry ${index+1}`}</legend><ContentFields row={row} onChange={(key,value)=>updateCollectionEntry(collection,index,key,value)}/><button onClick={()=>setDocument({...document,[collection]:document[collection].filter((_,n)=>n!==index)})} className="text-sm text-warning">Remove entry</button></fieldset>)}<button onClick={()=>setDocument({...document,[collection]:[...document[collection],newEntry(collection)]})} className="mt-4 rounded-lg border border-border px-4 py-2">Add entry</button></Card>}</section>)}</div>;
}

function tabIndexForKey(key: string, current: number): number | undefined {
  if (key === "ArrowRight") return (current + 1) % editorTabs.length;
  if (key === "ArrowLeft") return (current + editorTabs.length - 1) % editorTabs.length;
  if (key === "Home") return 0;
  if (key === "End") return editorTabs.length - 1;
  return undefined;
}
type SavedEvent = { id: string; title: string; category: string; startsAt: string; isPublic?: boolean; isDemo?: boolean };

function SavedEvents({events,error}: {events: SavedEvent[] | undefined; error: string}) {
  return <Card><h2 className="text-xl font-semibold">Events & Programs</h2><p className="mt-2 text-sm text-muted">Create and manage events in the existing event workspace. Public events appear on related website pages on their next refresh; private events remain in the officer workspace. Demo events are labeled Demo/Test.</p><a href="/admin/events/" className="mt-3 inline-block font-semibold text-accent">Open event workspace →</a>{error ? <p role="status" className="mt-3">{error}</p> : !events ? <p role="status" className="mt-3">Loading saved events…</p> : events.length===0 ? <p className="mt-3">No saved events yet. Create an event in the event workspace.</p> : <ul className="mt-4 space-y-3">{events.map(event=><li key={event.id} className="rounded-lg border border-border p-3"><h3 className="font-semibold">{event.title}</h3><p className="text-sm text-muted">{event.category} · {event.startsAt || "Coming Soon"} · {event.isPublic ? "Public website" : "Private / draft"}{event.isDemo ? " · Demo/Test" : ""}</p></li>)}</ul>}</Card>;
}