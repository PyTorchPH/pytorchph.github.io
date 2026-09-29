"use client";

// Career Evidence workspace: add evidence (manual, photo, or an automatic source) and browse the gallery.
// Module map (caller-first):
//   CareerEvidenceView       state for items, sources and dialogs; composes the cards below
//   useEvidenceGallery       items plus the save and photo-upload flows
//     saveEvidenceItem       POST (new) or PATCH (existing) /api/product/evidence
//     uploadEvidencePhoto    validates, prepares and uploads one photo
//     preparePhotoBody       JPEG data URL for the official API, form data for the local gateway
//     compressToDataUrl      shrinks a photo until it fits the upload limit
//     newManualItem          blank draft for manual entry
//   AddEvidenceCard          mode tabs with ManualAddControls or AutomaticSourcePicker
//   AchievementGallery       verified count, upload error and AchievementCard grid

import Image from "next/image";
import { useRef, useState, type RefObject } from "react";
import { ChevronRight, Globe2, Link2, Pencil, Plus, Upload } from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { SegmentedTabs } from "@pytorch-ph/design-system/tabs";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import type { EvidenceItem, EvidenceSource, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { EvidenceDialog } from "./evidence-dialog";
import { MemberIntegrityNotice } from "./integrity-notice";
import { SourceDialog } from "./source-dialog";
import { isAutomaticSource, sourceTone, verificationTone } from "./tones";

type AddMode = "manual" | "automatic";

const addModes: Array<{ value: AddMode; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic (AI)" },
];
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTO_DATA_URL = 350_000;
const PHOTO_STEPS: Array<[number, number]> = [[800, 0.82], [640, 0.72], [480, 0.62], [360, 0.52]];

// Mental model: the gallery is the member's source of truth; sources and dialogs only add to or edit it.
export function CareerEvidenceView({ data, canWrite, canAutomate }: { data: ProductViewData; canWrite: boolean; canAutomate: boolean }) {
  const evidence = data.evidence;
  const [source, setSource] = useState<EvidenceSource | null>(null);
  const [sources, setSources] = useState(evidence?.sources || []);
  const [addMode, setAddMode] = useState<AddMode>("manual");
  const gallery = useEvidenceGallery(evidence?.items || []);
  if (!evidence) return <Card>No evidence view is available.</Card>;
  const replaceSource = (updated: EvidenceSource) => {
    setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSource(updated);
  };
  return (
    <div className="space-y-4">
      <MemberIntegrityNotice />
      <AddEvidenceCard addMode={addMode} canAutomate={canAutomate} canWrite={canWrite} gallery={gallery} onAddMode={setAddMode} onPickSource={setSource} sources={sources} />
      <AchievementGallery gallery={gallery} />
      {source && (
        <SourceDialog
          canAutomate={canAutomate}
          canWrite={canWrite}
          onChanged={replaceSource}
          onClose={() => setSource(null)}
          source={source}
        />
      )}
      {gallery.selected && (
        <EvidenceDialog
          canWrite={canWrite}
          item={gallery.selected}
          onClose={() => gallery.setSelected(null)}
          onSave={gallery.persist}
        />
      )}
    </div>
  );
}

// Mental model: saving or uploading returns the stored item, which replaces or prepends its gallery entry.
function useEvidenceGallery(initialItems: EvidenceItem[]) {
  const [items, setItems] = useState(initialItems);
  const [selected, setSelected] = useState<EvidenceItem | null>(null);
  const [actionError, setActionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const persist = async (item: EvidenceItem) => {
    const creating = isNewItem(item);
    const saved = await saveEvidenceItem(item, creating);
    setItems((current) =>
      creating
        ? [saved, ...current]
        : current.map((entry) => (entry.id === saved.id ? saved : entry)),
    );
  };

  const upload = async (file: File) => {
    setUploading(true);
    setActionError("");
    try {
      const item = await uploadEvidencePhoto(file);
      setItems((current) => [item, ...current]);
      setSelected(item);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not upload evidence.");
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const startManual = () => setSelected(newManualItem());

  return { items, selected, setSelected, actionError, uploading, uploadRef, persist, upload, startManual };
}

type Gallery = ReturnType<typeof useEvidenceGallery>;

const isNewItem = (item: EvidenceItem) => item.id.startsWith("new-");

async function saveEvidenceItem(item: EvidenceItem, creating: boolean): Promise<EvidenceItem> {
  const response = await fetch(
    creating ? "/api/product/evidence" : `/api/product/evidence/${item.id}`,
    {
      method: creating ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item, approve: true }),
    },
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Could not save evidence.");
  return payload.item as EvidenceItem;
}

// Mental model: validate the file, turn it into the body this deployment accepts, then upload it.
async function uploadEvidencePhoto(file: File): Promise<EvidenceItem> {
  if (!isAcceptedPhoto(file)) {
    throw new Error("Select a JPEG, PNG, or WebP photo no larger than 10 MB.");
  }
  const title = file.name.replace(/\.[^.]+$/, "");
  const { body, headers } = await preparePhotoBody(file, title);
  const response = await fetch("/api/product/evidence", {
    method: "POST",
    headers,
    body,
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Could not upload evidence.");
  return payload.item as EvidenceItem;
}

const isAcceptedPhoto = (file: File) => PHOTO_TYPES.includes(file.type) && file.size <= MAX_PHOTO_BYTES;

// The official API takes a compressed JPEG data URL; the local gateway takes multipart form data.
async function preparePhotoBody(file: File, title: string): Promise<{ body: BodyInit; headers: HeadersInit | undefined }> {
  if (process.env.NEXT_PUBLIC_API_ORIGIN) {
    const photoData = await compressToDataUrl(file);
    return { body: JSON.stringify({ title, photoData }), headers: { "Content-Type": "application/json" } };
  }
  const form = new FormData();
  form.set("file", file);
  form.set("title", title);
  return { body: form, headers: undefined };
}

// Mental model: redraw on a white canvas at decreasing sizes and qualities until the data URL fits.
async function compressToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    let photoData = "";
    for (const [edge, quality] of PHOTO_STEPS) {
      photoData = drawScaledJpeg(canvas, bitmap, edge, quality);
      if (photoData.length <= MAX_PHOTO_DATA_URL) break;
    }
    if (photoData.length > MAX_PHOTO_DATA_URL) throw new Error("This photo is too detailed for the demo upload limit.");
    return photoData;
  } finally {
    bitmap.close();
  }
}

function drawScaledJpeg(canvas: HTMLCanvasElement, bitmap: ImageBitmap, edge: number, quality: number) {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo processing is unavailable.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function newManualItem(): EvidenceItem {
  return {
    id: `new-${crypto.randomUUID()}`,
    sourceId: "manual",
    title: "New career achievement",
    organization: "",
    role: "",
    dateLabel: "",
    description: "",
    quantitative: [],
    qualitative: [],
    skills: [],
    mediaUrl: "/demo/evidence/manual-placeholder.svg",
    mediaAlt: "Placeholder for manually entered career evidence",
    verificationState: "draft",
  };
}

type AddEvidenceCardProps = {
  addMode: AddMode;
  onAddMode: (mode: AddMode) => void;
  sources: EvidenceSource[];
  onPickSource: (source: EvidenceSource) => void;
  gallery: Gallery;
  canWrite: boolean;
  canAutomate: boolean;
};

function AddEvidenceCard({ addMode, onAddMode, sources, onPickSource, gallery, canWrite, canAutomate }: AddEvidenceCardProps) {
  return (
    <Card className="bg-surface" data-tour="evidence-add">
      <CardHeader>
        <div>
          <CardTitle>Add evidence</CardTitle>
          <CardDescription>
            Enter it yourself, or let AI collect it from a source you
            connect.
          </CardDescription>
        </div>
        <div aria-label="How to add evidence" role="group">
          <SegmentedTabs items={addModes} onChange={onAddMode} value={addMode} />
        </div>
      </CardHeader>
      {addMode === "manual" ? (
        <ManualAddControls canWrite={canWrite} onManual={gallery.startManual} onUpload={gallery.upload} uploadRef={gallery.uploadRef} uploading={gallery.uploading} />
      ) : (
        <AutomaticSourcePicker canAutomate={canAutomate} onPick={onPickSource} sources={sources} />
      )}
    </Card>
  );
}

type ManualAddControlsProps = {
  canWrite: boolean;
  uploading: boolean;
  uploadRef: RefObject<HTMLInputElement | null>;
  onManual: () => void;
  onUpload: (file: File) => Promise<void>;
};

function ManualAddControls({ canWrite, uploading, uploadRef, onManual, onUpload }: ManualAddControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={!canWrite} onClick={onManual} size="sm" variant="secondary">
        <Plus size={14} />
        Manual entry
      </Button>
      <Button disabled={!canWrite || uploading} onClick={() => uploadRef.current?.click()} size="sm">
        <Upload size={14} />
        {uploading ? "Preparing…" : "Upload photo"}
      </Button>
      <input
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload an evidence image"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onUpload(file);
        }}
        ref={uploadRef}
        type="file"
      />
      <p className="w-full text-sm text-muted">
        You write the details. Nothing is collected for you.
      </p>
    </div>
  );
}

function AutomaticSourcePicker({ sources, canAutomate, onPick }: { sources: EvidenceSource[]; canAutomate: boolean; onPick: (source: EvidenceSource) => void }) {
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Choose a source. AI reads only what you allow and proposes
        evidence; each proposal waits for your review before it counts.
        {!canAutomate && " Automatic collection is locked until an AI endpoint is configured in Settings."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sources.filter(isAutomaticSource).map((item) => <SourceCard item={item} key={item.id} onPick={onPick} />)}
      </div>
    </>
  );
}

function SourceCard({ item, onPick }: { item: EvidenceSource; onPick: (source: EvidenceSource) => void }) {
  return (
    <button
      className="focus-ring group border border-border bg-elevated p-4 text-left transition hover:border-accent/40"
      onClick={() => onPick(item)}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center bg-surface text-accent">
          {item.connectionMethod === "website_session" ? <Globe2 size={18} /> : <Link2 size={18} />}
        </span>
        <Badge variant={sourceTone(item)}>
          {item.maturity === "available"
            ? item.connectionStatus?.replaceAll("_", " ")
            : item.maturity}
        </Badge>
      </div>
      <p className="mt-4 font-semibold">{item.label}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{item.kind}</p>
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>{item.evidenceCount || 0} items</span>
        <ChevronRight className="transition group-hover:translate-x-1" size={15} />
      </div>
    </button>
  );
}

const verifiedCount = (items: EvidenceItem[]) => items.filter((item) => item.verificationState === "user_verified").length;

function AchievementGallery({ gallery }: { gallery: Gallery }) {
  return (
    <Card className="bg-surface">
      <CardHeader>
        <div>
          <CardTitle>Achievement gallery</CardTitle>
          <CardDescription>
            Open a photo to edit the user-owned fact or review an AI proposal.
          </CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="success">
            {verifiedCount(gallery.items)}{" "}
            verified
          </Badge>
        </div>
      </CardHeader>
      {gallery.actionError && (
        <p
          aria-live="polite"
          className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
        >
          {gallery.actionError}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {gallery.items.map((item) => <AchievementCard item={item} key={item.id} onOpen={gallery.setSelected} />)}
      </div>
    </Card>
  );
}

function AchievementCard({ item, onOpen }: { item: EvidenceItem; onOpen: (item: EvidenceItem) => void }) {
  return (
    <button
      className="focus-ring group overflow-hidden rounded-xl border border-border bg-elevated text-left"
      onClick={() => onOpen(item)}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          alt={item.mediaAlt}
          className="object-cover transition duration-500 group-hover:scale-[1.03]"
          fill
          sizes="(max-width:768px) 100vw, 33vw"
          src={item.mediaUrl}
          unoptimized={item.mediaUrl.startsWith("/api/")}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 to-transparent p-4 pt-12">
          <Badge variant={verificationTone(item.verificationState)}>
            {item.verificationState.replaceAll("_", " ")}
          </Badge>
        </div>
      </div>
      <div className="p-4">
        <p className="font-semibold leading-6">{item.title}</p>
        <p className="mt-2 text-xs text-muted">
          {item.organization} · {item.dateLabel}
        </p>
        <div className="mt-4 flex items-center justify-between text-xs text-accent">
          <span className="flex items-center gap-1">
            <Pencil size={13} />
            Open achievement
          </span>
          <ChevronRight size={15} />
        </div>
      </div>
    </button>
  );
}
