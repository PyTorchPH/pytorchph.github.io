"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@pytorch-ph/design-system/button";

type PublicationPermissions = {canEdit:boolean; canPublish:boolean; canChangeFlags:boolean};
type Publication = {isPublic:boolean; isDemo:boolean; description:string; topic:string; venue:string; registrationUrl:string; series:string};
const emptyPublication: Publication = {isPublic:false,isDemo:false,description:"",topic:"",venue:"",registrationUrl:"",series:""};

// Mental model: edit the saved event's publication metadata → validate → refresh the canonical event list.
export function EventPublicationSettings({eventId}: {eventId:string}) {
  const [open,setOpen] = useState(false);
  const [draft,setDraft] = useState<Publication>(emptyPublication);
  const client = useQueryClient();
  const queryKey = ["event-publication",eventId];
  const details = useQuery({queryKey,enabled:open,queryFn:()=>eventRequest<{publication:Publication; publicationPermissions:PublicationPermissions}>(`/events/${encodeURIComponent(eventId)}`)});
  useEffect(()=>{if(details.data) setDraft({...emptyPublication,...details.data.publication});},[details.data]);
  const save = useMutation({
    mutationFn: async () => {
      if(!details.data?.publicationPermissions?.canEdit) throw new Error("You do not have permission to edit this event publication.");
      if(draft.isPublic && !draft.description.trim()) throw new Error("Add an event description before publishing.");
      return eventRequest(`/events/${encodeURIComponent(eventId)}/publication`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,registrationUrl:draft.isDemo ? "" : draft.registrationUrl})});
    },
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({queryKey:["officer-events"]}),client.invalidateQueries({queryKey})]);
    },
  });
  function submit(event:FormEvent<HTMLFormElement>) {event.preventDefault();save.mutate();}
  return <div className="w-full"><Button type="button" size="sm" variant="secondary" aria-expanded={open} aria-controls={`event-publication-${eventId}`} onClick={()=>setOpen(!open)}>Website publication</Button>{open && <div id={`event-publication-${eventId}`} className="mt-3 rounded-lg border border-border p-4">{details.isError ? <p role="status" className="text-sm text-warning">{details.error instanceof Error ? details.error.message : "Event publication details are unavailable."}</p> : !details.data ? <p role="status" className="text-sm text-muted">Loading publication details…</p> : <form onSubmit={submit} className="grid gap-3"><p className="text-sm text-muted">This description belongs to the saved event and is reused on public pages. Private events stay out of public listings.</p>{!details.data.publicationPermissions?.canEdit && <p className="text-sm text-muted">You have read-only access to this event publication.</p>}<label className="flex gap-2"><input type="checkbox" checked={draft.isPublic} disabled={save.isPending || !details.data.publicationPermissions?.canPublish} onChange={event=>setDraft({...draft,isPublic:event.target.checked})} />Publish event on the website</label><label className="flex gap-2"><input type="checkbox" checked={draft.isDemo} disabled={save.isPending || !details.data.publicationPermissions?.canChangeFlags} onChange={event=>setDraft({...draft,isDemo:event.target.checked,registrationUrl:event.target.checked ? "" : draft.registrationUrl})} />Label as Demo/Test</label><label>Description<textarea required={draft.isPublic} maxLength={2000} rows={5} value={draft.description} disabled={save.isPending || !details.data.publicationPermissions?.canEdit} onChange={event=>setDraft({...draft,description:event.target.value})} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2" /></label>{([['topic','Topic',500],['venue','Venue or platform',300],['series','Learning series',200],['registrationUrl','Registration URL',2000]] as const).map(([field,label,maxLength])=><label key={field}>{label}<input type={field==="registrationUrl" ? "url" : "text"} maxLength={maxLength} pattern={field==="registrationUrl" ? "https://.+" : undefined} value={draft[field]} disabled={save.isPending || !details.data.publicationPermissions?.canEdit || (field==="registrationUrl" && draft.isDemo)} onChange={event=>setDraft({...draft,[field]:event.target.value})} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2" /></label>)}{draft.isDemo && <p className="text-xs text-muted">Demo/Test events cannot have a registration link.</p>}<Button type="submit" disabled={save.isPending || !details.data.publicationPermissions?.canEdit || (draft.isPublic && !draft.description.trim())}>{save.isPending ? "Saving…" : "Save website publication"}</Button><p role="status" className="text-sm">{save.isError ? (save.error instanceof Error ? save.error.message : "Publication could not be saved.") : save.isSuccess ? "Event publication saved. Public pages update on their next refresh." : ""}</p></form>}</div>}</div>;
}

async function eventRequest<T>(path:string,init?:RequestInit):Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_ORIGIN || ""}${path}`,{credentials:"include",cache:"no-store",...init});
  if(!response.ok) {
    const error = await response.json().catch(()=>({})) as {error?:string};
    throw new Error(error.error || `Event request failed (${response.status})`);
  }
  if(response.status===204) return undefined as T;
  return response.json() as Promise<T>;
}
