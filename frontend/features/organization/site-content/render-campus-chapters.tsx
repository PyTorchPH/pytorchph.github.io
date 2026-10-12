"use client";
import { useEffect, useState, type FormEvent } from "react";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { Card } from "@pytorch-ph/design-system/card";

type CampusChapter = { id?: string; university: string; chapter: string; island: string; status: string; leadId: string };
type ChapterView = { canManage: boolean; chapters: CampusChapter[]; eligibleLeads: {id: string; name: string}[] };
const emptyChapter: CampusChapter = {university:"",chapter:"",island:"Luzon",status:"forming",leadId:""};

// Mental model: choose an assigned lead → save the canonical chapter → public directory reads that record.
export function CampusChapterAssignments() {
  const [view,setView] = useState<ChapterView>();
  const [chapter,setChapter] = useState<CampusChapter>(emptyChapter);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  useEffect(()=>{ let current=true; fetchJson<ChapterView>("/api/officer/campus-chapters",{cache:"no-store"}).then(value=>{if(current) setView(value);}).catch(error=>{if(current) setMessage(error instanceof Error ? error.message : "Unable to load Campus Labs chapters");}); return ()=>{current=false;}; },[]);
  async function saveChapter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view?.canManage || busy) return;
    setBusy(true); setMessage("");
    try {
      await fetchJson("/api/officer/campus-chapters",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(chapter)});
      setView(await fetchJson<ChapterView>("/api/officer/campus-chapters",{cache:"no-store"}));
      setChapter(emptyChapter); setMessage("Chapter saved. The public directory follows member name and photo visibility settings.");
    } catch(error) {setMessage(error instanceof Error ? error.message : "Unable to save chapter");}
    finally {setBusy(false);}
  }
  return <Card><h2 className="text-xl font-semibold">Campus Labs chapter assignments</h2><p className="mt-2 text-sm text-muted">Assign actual Campus Labs leads to chapters. Public profiles use their member visibility settings; paused chapters can remain in the directory with their status.</p><p role="status" className="mt-3 text-sm">{message || (!view ? "Loading chapter assignments…" : "")}</p>{view && <><ul className="mt-4 space-y-3">{view.chapters.map(row=><li key={row.id} className="rounded-lg border border-border p-3"><p className="font-semibold">{row.university} · {row.chapter}</p><p className="text-sm text-muted">{row.island} · {row.status} · {view.eligibleLeads.find(lead=>lead.id===row.leadId)?.name || "Lead assignment unavailable"}</p>{view.canManage && <button type="button" className="mt-2 text-sm text-accent" onClick={()=>setChapter({...row})}>Edit chapter</button>}</li>)}</ul>{view.chapters.length===0 && <p className="mt-3 text-sm">No chapter assignments yet.</p>}{view.canManage && <form onSubmit={event=>void saveChapter(event)} className="mt-4 grid gap-3"><label>University<input required maxLength={160} value={chapter.university} onChange={event=>setChapter({...chapter,university:event.target.value})} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2" /></label><label>Chapter name<input required maxLength={160} value={chapter.chapter} onChange={event=>setChapter({...chapter,chapter:event.target.value})} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2" /></label><label>Island group<select value={chapter.island} onChange={event=>setChapter({...chapter,island:event.target.value})} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2">{["Luzon","Visayas","Mindanao"].map(value=><option key={value}>{value}</option>)}</select></label><label>Chapter status<select value={chapter.status} onChange={event=>setChapter({...chapter,status:event.target.value})} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2">{["active","forming","paused"].map(value=><option key={value}>{value}</option>)}</select></label><label>Campus Labs lead<select required value={chapter.leadId} onChange={event=>setChapter({...chapter,leadId:event.target.value})} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2"><option value="">Select an assigned Campus Labs lead</option>{view.eligibleLeads.map(lead=><option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label><p className="text-sm text-muted">Only members with a current Campus Labs lead role can be assigned.</p><div className="flex gap-3"><button disabled={busy || view.eligibleLeads.length===0} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40">{busy ? "Saving…" : "Save chapter"}</button><button type="button" disabled={busy} onClick={()=>setChapter(emptyChapter)} className="rounded-lg border border-border px-4 py-2">New chapter</button></div></form>}</>}</Card>;
}
