"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function OrganizationPhotoSettings() {
  const queryClient = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoAvailable, setPhotoAvailable] = useState(true);
  const [photoRevision, setPhotoRevision] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const upload = useMutation({
    mutationFn: async (photo: File) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type) || photo.size > 384 * 1024) throw new Error("Choose a JPEG, PNG, or WebP photo under 384 KB.");
      const response = await fetch("/api/member/organization-photo", { method: "PUT", headers: { "Content-Type": photo.type }, body: photo });
      if (!response.ok) throw new Error("Photo upload failed.");
    },
    onSuccess: (_value, photo) => { setPreviewUrl(URL.createObjectURL(photo)); setPhotoAvailable(true); setPhotoRevision((value) => value + 1); setMenuOpen(false); toast.success("Profile photo saved."); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Photo upload failed."),
  });
  const remove = useMutation({
    mutationFn: async () => { const response = await fetch("/api/member/organization-photo", { method: "DELETE" }); if (!response.ok) throw new Error("Photo removal failed."); },
    onSuccess: () => { setPreviewUrl(null); setPhotoAvailable(false); setPhotoRevision((value) => value + 1); setMenuOpen(false); toast.success("Profile photo removed."); queryClient.invalidateQueries({ queryKey: ["officer-organization"] }); },
    onError: () => toast.error("Photo removal failed."),
  });
  return <div className="space-y-3">
    <h3 className="font-semibold">Profile photo</h3>
    <div className="group relative w-fit">
      <button aria-expanded={menuOpen} aria-label="Edit profile photo" className="relative flex size-24 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-elevated text-2xl font-semibold focus-ring" onClick={() => setMenuOpen((open) => !open)} type="button">
        {photoAvailable ? <img alt="Your profile" className="size-full object-cover" onError={() => { setPreviewUrl(null); setPhotoAvailable(false); }} src={previewUrl || `/api/member/self-photo?revision=${photoRevision}`} /> : <span aria-hidden="true">👤</span>}
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
  </div>;
}
