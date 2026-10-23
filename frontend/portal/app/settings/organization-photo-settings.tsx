"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { toast } from "sonner";
import { removePhoto, uploadPhoto } from "./photo/api";
import { PHOTO_QUERY_KEY, isCurrentPhotoChange, runCurrentPhotoChange, usePhotoPreview } from "./photo/preview";

type PhotoAction = { kind: "upload"; photo: File } | { kind: "remove" };
type PhotoChange = PhotoAction & { startedQuery: Query | undefined };

export function OrganizationPhotoSettings() {
  const queryClient = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const preview = usePhotoPreview();
  const change = useMutation({
    scope: { id: "member-self-photo" },
    onMutate: async (input: PhotoChange) => {
      if (isCurrentPhotoChange(queryClient, input.startedQuery)) {
        await queryClient.cancelQueries({ queryKey: PHOTO_QUERY_KEY, exact: true });
      }
    },
    mutationFn: (input: PhotoChange) => runCurrentPhotoChange(queryClient, input.startedQuery, () => input.kind === "upload" ? uploadPhoto(input.photo) : removePhoto()),
    onSuccess: (applied, input) => {
      if (!applied || !isCurrentPhotoChange(queryClient, input.startedQuery)) return;
      queryClient.setQueryData<Blob | null>(PHOTO_QUERY_KEY, input.kind === "upload" ? input.photo : null);
      setMenuOpen(false);
      toast.success(input.kind === "upload" ? "Profile photo saved." : "Profile photo removed.");
      void queryClient.invalidateQueries({ queryKey: ["officer-organization"] });
    },
    onError: (error, input) => {
      if (!isCurrentPhotoChange(queryClient, input.startedQuery)) return;
      toast.error(error.message);
      if (queryClient.getQueryData(PHOTO_QUERY_KEY) === undefined) {
        void queryClient.invalidateQueries({ queryKey: PHOTO_QUERY_KEY, exact: true });
      }
    },
  });
  function queuePhotoChange(action: PhotoAction) {
    const startedQuery = queryClient.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true });
    change.mutate({ ...action, startedQuery });
  }

  return <div className="space-y-3">
    <h3 className="font-semibold">Profile photo</h3>
    <div className="group relative w-fit">
      <button aria-expanded={menuOpen} aria-label="Edit profile photo" className="relative flex size-24 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-elevated text-2xl font-semibold focus-ring" onClick={() => setMenuOpen((open) => !open)} type="button">
        {preview.url ? <img alt="Your profile" className="size-full object-cover" onError={preview.onDecodeError} src={preview.url} /> : <span aria-hidden="true">👤</span>}
        <span className="absolute inset-x-0 bottom-0 bg-foreground/80 py-1 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">Edit profile</span>
      </button>
      {menuOpen && <div className="absolute left-0 top-full z-20 mt-2 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-lg">
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-elevated" disabled={change.isPending} onClick={() => uploadInput.current?.click()} type="button">Upload photo</button>
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-elevated" disabled={change.isPending} onClick={() => cameraInput.current?.click()} type="button">Take a picture</button>
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-elevated" disabled={change.isPending} onClick={() => queuePhotoChange({ kind: "remove" })} type="button">Remove photo</button>
      </div>}
      <input ref={uploadInput} accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" className="sr-only" disabled={change.isPending} onChange={(event) => { const photo = event.target.files?.[0]; if (photo) queuePhotoChange({ kind: "upload", photo }); event.target.value = ""; }} type="file" />
      <input ref={cameraInput} accept="image/*" aria-label="Take profile picture" capture="user" className="sr-only" disabled={change.isPending} onChange={(event) => { const photo = event.target.files?.[0]; if (photo) queuePhotoChange({ kind: "upload", photo }); event.target.value = ""; }} type="file" />
    </div>
    {preview.loading && <p aria-live="polite" className="text-sm text-muted">Nilo-load ang profile photo…</p>}
    {preview.absent && !preview.error && <p className="text-sm text-muted">Wala pang naka-save na profile photo.</p>}
    {preview.error && <div className="space-y-2"><p className="text-sm text-danger" role="alert">{preview.error}</p><button className="text-sm underline" disabled={change.isPending || preview.loading} onClick={preview.refresh} type="button">I-load ulit ang photo</button></div>}
    {change.error && <p className="text-sm text-danger" role="alert">{change.error.message}</p>}
  </div>;
}
