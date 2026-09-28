"use client";

import { useEffect, useState } from "react";
import { ProductWorkspace } from "@pytorch-ph/domain-client/career-evidence";
import { Card } from "@pytorch-ph/design-system/card";
import { OfficialGoogleConnect, type OfficialViewer } from "../../../components/official-google-connect";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";

export default function Page() {
  const [viewer, setViewer] = useState<OfficialViewer | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!apiOrigin) return;
    void fetch(`${apiOrigin}/auth/me`, { credentials: "include", cache: "no-store" })
      .then(async (response) => { if (response.ok) setViewer(await response.json() as OfficialViewer); })
      .catch(() => setMessage("Official member session is unavailable."));
  }, []);
  return <>
    {apiOrigin && <Card className="mx-auto mb-4 max-w-7xl bg-surface"><h2 className="font-semibold">Official evidence account</h2><p className="mt-1 text-sm text-muted">Connect your approved Google account before submitting reviewed extension evidence to the organization ledger.</p>
      {viewer ? <p className="mt-2 text-sm">{viewer.display_name} · {viewer.role === "pending" ? "Awaiting member approval" : "Connected"}</p> : <div className="mt-3"><OfficialGoogleConnect onConnected={setViewer} onError={setMessage} /></div>}
      {message && <p aria-live="polite" className="mt-2 text-sm text-warning">{message}</p>}
    </Card>}
    <ProductWorkspace capabilityKey="evidence_read" view="career-evidence" safety="All sources pass through the retrieval middleman; generated displays never overwrite source evidence." />
  </>;
}
