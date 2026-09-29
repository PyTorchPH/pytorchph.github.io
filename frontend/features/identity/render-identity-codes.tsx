"use client";

import { useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { InfoPopover } from "@pytorch-ph/design-system/info-popover";

export type IdentityLink = { id: string; label: string; url: string };

const QR_SIZE = 192;
const PROFILE_ID = "pytorch-ph";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const subscribe = () => () => undefined;

// The member's place on the leaderboard is their public PyTorch Philippines profile.
function useProfileUrl(username: string) {
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => "");
  return origin && username ? `${origin}${BASE_PATH}/leaderboards/?member=${encodeURIComponent(username)}` : "";
}

// One QR code for the PyTorch Philippines profile, plus one for each connected account with a profile link.
export function IdentityCodes({ username, links }: { username: string; links: IdentityLink[] }) {
  const profileUrl = useProfileUrl(username);
  const codes: IdentityLink[] = [{ id: PROFILE_ID, label: "PyTorch PH profile", url: profileUrl }, ...links];
  const [selectedId, setSelectedId] = useState(PROFILE_ID);
  const selected = codes.find((code) => code.id === selectedId) ?? codes[0];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(selected.url);
      toast.success("Link copied.");
    } catch {
      toast.error("Copy failed. Select the link and copy it manually.");
    }
  };

  return <Card className="bg-surface" data-tour="profile-codes">
    <CardHeader>
      <div>
        <div className="flex items-center gap-2">
          <CardTitle>Identity QR codes</CardTitle>
          <InfoPopover label="About identity QR codes" title="One code to share">
            <p>Your <strong>PyTorch PH profile</strong> code is the one to share. It opens your place on the community leaderboard.</p>
            <p className="mt-2">LinkedIn, Facebook, and other platforms only accept their own codes, so a single code cannot work inside all of them. Instead, each connected account with a profile link gets its own code here.</p>
            <p className="mt-2 text-muted">Add a profile link to a connected source in Career Evidence to see its code.</p>
          </InfoPopover>
        </div>
        <CardDescription>Show a code at events so people can find you.</CardDescription>
      </div>
      <QrCode aria-hidden="true" className="text-accent" size={20} />
    </CardHeader>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a QR code">
      {codes.map((code) => <button aria-pressed={code.id === selected.id} className={`focus-ring border px-3 py-1.5 text-sm font-semibold ${code.id === selected.id ? "border-accent bg-accentSoft text-accent" : "border-border text-muted hover:text-ink"}`} key={code.id} onClick={() => setSelectedId(code.id)} type="button">{code.label}</button>)}
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-5">
      <div className="border border-border bg-white p-3">
        {selected.url ? <QRCodeSVG level="M" marginSize={1} size={QR_SIZE} title={`QR code for ${selected.label}`} value={selected.url} /> : <div className="flex items-center justify-center text-sm text-muted" style={{ width: QR_SIZE, height: QR_SIZE }}>Preparing code…</div>}
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-semibold">{selected.label}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted">{selected.url || "—"}</p>
        <Button className="mt-3" disabled={!selected.url} onClick={copy} size="sm" type="button" variant="secondary"><Copy size={14} />Copy link</Button>
      </div>
    </div>
  </Card>;
}
