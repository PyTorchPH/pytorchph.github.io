"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

const PHOTO_CONSENT_KEY = ["organization-photo-consent"] as const;

export function OrganizationPhotoSettings() {
  const queryClient = useQueryClient();
  const [photo, setPhoto] = useState<File | null>(null);
  const consent = useQuery({ queryKey: PHOTO_CONSENT_KEY, queryFn: () => fetchJson<{ granted: boolean }>("/api/member/organization-photo-consent", { cache: "no-store" }), retry: false });
  const [showPhoto, setShowPhoto] = useState<boolean | null>(null);
  const selectedConsent = showPhoto ?? consent.data?.granted ?? false;
  const upload = useMutation({
    mutationFn: async () => {
      if (!photo || !["image/jpeg", "image/png", "image/webp"].includes(photo.type) || photo.size > 384 * 1024) throw new Error("Choose a JPEG, PNG, or WebP photo under 384 KB.");
      const response = await fetch("/api/member/organization-photo", { method: "PUT", headers: { "Content-Type": photo.type }, body: photo });
      if (!response.ok) throw new Error("Photo upload failed.");
    },
    onSuccess: () => { setPhoto(null); toast.success("Organization photo saved."); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Photo upload failed."),
  });
  const remove = useMutation({
    mutationFn: async () => { const response = await fetch("/api/member/organization-photo", { method: "DELETE" }); if (!response.ok) throw new Error("Photo removal failed."); },
    onSuccess: () => { toast.success("Organization photo removed."); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); },
    onError: () => toast.error("Photo removal failed."),
  });
  const saveConsent = useMutation({
    mutationFn: () => fetchJson<{ granted: boolean }>("/api/member/organization-photo-consent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ granted: selectedConsent }) }),
    onSuccess: (saved) => { queryClient.setQueryData(PHOTO_CONSENT_KEY, saved); setShowPhoto(null); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); toast.success("Organization photo consent saved."); },
    onError: () => toast.error("Organization photo consent could not be saved."),
  });
  return <div className="mt-6 border-t border-border pt-5">
    <h3 className="font-semibold">Organization chart photo</h3>
    <p className="mt-1 text-sm text-muted">Your photo stays in the private identity service. It appears on the officer organization chart only with your consent. Upload a JPEG, PNG, or WebP photo under 384 KB; the identity service creates a small WebP thumbnail.</p>
    {consent.isError ? <p className="mt-2 text-sm text-muted">Photo controls are available when the private identity service is configured.</p> : <>
      <label className="mt-3 flex items-center gap-3 text-sm"><input checked={selectedConsent} disabled={!consent.data} onChange={(event) => setShowPhoto(event.target.checked)} type="checkbox" />Show my photo on the organization chart</label>
      <Button className="mt-3" disabled={!consent.data || saveConsent.isPending} onClick={() => saveConsent.mutate()} type="button" variant="secondary">Save photo consent</Button>
      <div className="mt-4 flex flex-wrap items-center gap-3"><input accept="image/jpeg,image/png,image/webp" aria-label="Choose organization photo" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} type="file" /><Button disabled={!photo || upload.isPending} onClick={() => upload.mutate()} type="button" variant="secondary">Upload photo</Button><Button disabled={remove.isPending} onClick={() => remove.mutate()} type="button" variant="outline">Remove photo</Button></div>
    </>}
  </div>;
}
