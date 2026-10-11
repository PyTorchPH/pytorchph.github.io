"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

const PHOTO_CONSENT_KEY = ["organization-photo-consent"] as const;

export function LeaderboardPhotoConsent() {
  const queryClient = useQueryClient();
  const consent = useQuery({ queryKey: ["leaderboard-photo-consent"], queryFn: () => fetchJson<{ granted: boolean }>("/api/member/leaderboard-photo-consent", { cache: "no-store" }), retry: false });
  const [selected, setSelected] = useState<boolean | null>(null);
  const granted = selected ?? consent.data?.granted ?? false;
  const save = useMutation({
    mutationFn: () => fetchJson<{ granted: boolean }>("/api/member/leaderboard-photo-consent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ granted }) }),
    onSuccess: (value) => { queryClient.setQueryData(["leaderboard-photo-consent"], value); setSelected(null); toast.success("Leaderboard photo choice saved."); },
    onError: () => toast.error("Leaderboard photo choice could not be saved."),
  });
  return <div className="mt-6 border-t border-border pt-5">
    <label className="flex items-start gap-3 text-sm"><input checked={granted} disabled={!consent.data} onChange={(event) => setSelected(event.target.checked)} type="checkbox" /><span><strong className="block">Show my profile photo in leaderboard popouts</strong><span className="text-xs text-muted">Only members who open your shared achievements can see the photo. This choice is separate from the organization chart.</span></span></label>
    {consent.isError && <p className="mt-2 text-xs text-muted">Photo consent is unavailable right now.</p>}
    <Button className="mt-3" disabled={!consent.data || save.isPending || selected === null} onClick={() => save.mutate()} type="button" variant="secondary">Save photo choice</Button>
  </div>;
}

export function OrganizationPhotoSettings() {
  const queryClient = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoAvailable, setPhotoAvailable] = useState(true);
  const [photoRevision, setPhotoRevision] = useState(0);
  const consent = useQuery({ queryKey: PHOTO_CONSENT_KEY, queryFn: () => fetchJson<{ granted: boolean }>("/api/member/organization-photo-consent", { cache: "no-store" }), retry: false });
  const [showPhoto, setShowPhoto] = useState<boolean | null>(null);
  const selectedConsent = showPhoto ?? consent.data?.granted ?? false;
  const upload = useMutation({
    mutationFn: async (photo: File) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type) || photo.size > 384 * 1024) throw new Error("Choose a JPEG, PNG, or WebP photo under 384 KB.");
      const response = await fetch("/api/member/organization-photo", { method: "PUT", headers: { "Content-Type": photo.type }, body: photo });
      if (!response.ok) throw new Error("Photo upload failed.");
    },
    onSuccess: () => { setPhotoAvailable(true); setPhotoRevision((value) => value + 1); setMenuOpen(false); toast.success("Profile photo saved."); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Photo upload failed."),
  });
  const remove = useMutation({
    mutationFn: async () => { const response = await fetch("/api/member/organization-photo", { method: "DELETE" }); if (!response.ok) throw new Error("Photo removal failed."); },
    onSuccess: () => { setPhotoAvailable(false); setPhotoRevision((value) => value + 1); setMenuOpen(false); toast.success("Profile photo removed."); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); },
    onError: () => toast.error("Photo removal failed."),
  });
  const saveConsent = useMutation({
    mutationFn: () => fetchJson<{ granted: boolean }>("/api/member/organization-photo-consent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ granted: selectedConsent }) }),
    onSuccess: (saved) => { queryClient.setQueryData(PHOTO_CONSENT_KEY, saved); setShowPhoto(null); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); toast.success("Organization photo consent saved."); },
    onError: () => toast.error("Organization photo consent could not be saved."),
  });
  return <div className="space-y-3">
    <h3 className="font-semibold">Profile photo</h3>
    <div className="group relative w-fit">
      <button aria-expanded={menuOpen} aria-label="Edit profile photo" className="relative flex size-24 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-elevated text-2xl font-semibold focus-ring" onClick={() => setMenuOpen((open) => !open)} type="button">
        {photoAvailable && selectedConsent ? <img alt="Your profile" className="size-full object-cover" onError={() => setPhotoAvailable(false)} src={`/api/member/organization-photo?revision=${photoRevision}`} /> : <span aria-hidden="true">👤</span>}
        <span className="absolute inset-x-0 bottom-0 bg-foreground/80 py-1 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">Edit profile</span>
      </button>
      {menuOpen && <div className="absolute left-0 top-full z-20 mt-2 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-lg">
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => uploadInput.current?.click()} type="button">Upload photo</button>
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => cameraInput.current?.click()} type="button">Take a picture</button>
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-elevated" disabled={remove.isPending} onClick={() => remove.mutate()} type="button">Remove photo</button>
      </div>}
      <input ref={uploadInput} accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} type="file" />
      <input ref={cameraInput} accept="image/*" aria-label="Take profile picture" capture="user" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} type="file" />
    </div>
    {consent.isError ? <p className="mt-2 text-sm text-muted">Photo controls are available when the private identity service is configured.</p> : <>
      <label className="mt-3 flex items-center gap-3 text-sm"><input checked={selectedConsent} disabled={!consent.data} onChange={(event) => setShowPhoto(event.target.checked)} type="checkbox" />Show my photo on the organization chart</label>
      <Button className="mt-3" disabled={!consent.data || saveConsent.isPending} onClick={() => saveConsent.mutate()} type="button" variant="secondary">Save photo consent</Button>
    </>}
  </div>;
}
