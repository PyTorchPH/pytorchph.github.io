"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { Card } from "@pytorch-ph/design-system/card";
import { ContentFields } from "./render-fields";
import { collectionFields, labels, newEntry, type Collection, type WebsiteDraft, type WebsiteDocument } from "./model";

// Mental model: edit a local copy → save a new immutable draft → presidents approve that saved revision.
export function WebsiteContentEditor() {
  const officer = useCapabilities().portal.audience === "officer";
  const [draft, setDraft] = useState<WebsiteDraft>();
  const [document, setDocument] = useState<WebsiteDocument>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = !!draft && JSON.stringify(document)!==JSON.stringify(draft.document);
  function receiveDraftSnapshot(view: WebsiteDraft) { setDraft(view); setDocument(structuredClone(view.document)); }
  useEffect(() => { if (!officer) return; let current=true; fetchJson<WebsiteDraft>("/api/officer/site-content", {cache:"no-store"}).then(view => { if (current) receiveDraftSnapshot(view); }).catch(error => { if(current) setMessage(error instanceof Error ? error.message : "Unable to load website draft"); }); return () => {current=false;}; }, [officer]);
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
  function updateCollectionEntry(collection: Collection,index: number,key: string,value: string) { setDocument(current => current ? {...current,[collection]:current[collection].map((row,n)=>n===index ? {...row,[key]:value} : row)} : current); }
  if (!officer) return <Card>Officer access required.</Card>;
  if (!draft || !document) return <Card><p role="status">{message || "Loading website content…"}</p></Card>;
  return <div className="space-y-6"><header><h1 className="font-heading text-3xl font-semibold">Website content</h1><p className="mt-2 text-sm text-muted">Edit content that changes over time. Branding, the community narrative, and footer contacts are maintained in the static site build.</p></header><Card><p>Draft {draft.revision} · Published {draft.publishedRevision} · {draft.approvals}/{draft.requiredApprovals} current-president approvals{dirty ? " · Unsaved edits" : ""}</p><div className="mt-3 flex flex-wrap gap-3"><button disabled={busy || !dirty} onClick={()=>void submitDraftAction("save")} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40">Save draft</button>{draft.canApprove && <button disabled={busy || dirty || draft.revision===draft.publishedRevision} onClick={()=>void submitDraftAction("approve")} className="rounded-lg border border-border px-4 py-2 disabled:opacity-40">Approve publication</button>}<button disabled={busy} onClick={()=>void submitDraftAction("reload")} className="rounded-lg border border-border px-4 py-2">Reload draft</button></div><p role="status" className="mt-3 text-sm">{message}</p></Card>{(Object.keys(collectionFields) as Collection[]).map(collection=><Card key={collection}><h2 className="text-xl font-semibold">{labels[collection]}</h2><p className="mt-2 text-sm text-muted">Plain text only. Photos use approved HTTPS image URLs or existing /assets/ paths. Unknown event dates must be Coming Soon or Tentative.</p>{document[collection].map((row,index)=><fieldset key={row.id ?? index} className="mt-4 space-y-3 rounded-lg border border-border p-4"><legend className="px-2 text-sm">{row.title || row.name || row.university || `Entry ${index+1}`}</legend><ContentFields row={row} onChange={(key,value)=>updateCollectionEntry(collection,index,key,value)}/><button onClick={()=>setDocument({...document,[collection]:document[collection].filter((_,n)=>n!==index)})} className="text-sm text-warning">Remove entry</button></fieldset>)}<button onClick={()=>setDocument({...document,[collection]:[...document[collection],newEntry(collection)]})} className="mt-4 rounded-lg border border-border px-4 py-2">Add entry</button></Card>)}</div>;
}
