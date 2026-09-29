"use client";

import { useState } from "react";
import { UserX } from "lucide-react";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";

const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/$/, "");
const CONFIRMATION = "DELETE";

// Leaving deletes the account and every record the member owns on the server.
export function LeaveCommunity() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function leave() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_ORIGIN}/members/me`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Account deletion failed (${response.status}).`);
      }
      try { sessionStorage.clear(); } catch { /* Storage may be unavailable. */ }
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account deletion failed.");
      setBusy(false);
    }
  }

  return <Card className="mt-4 border-danger/30 bg-surface" id="leave">
    <CardHeader><div><CardTitle>Leave PyTorch PH</CardTitle><CardDescription>Deletes your account and everything tied to it: points, evidence, attendance, leaderboard standing, settings and sessions. This cannot be undone.</CardDescription></div><UserX aria-hidden="true" className="text-danger" /></CardHeader>
    {API_ORIGIN ? <div className="space-y-3">
      <div><Label htmlFor="leave-confirm">Type {CONFIRMATION} to confirm</Label><Input autoComplete="off" id="leave-confirm" onChange={event => setConfirm(event.target.value)} value={confirm} /></div>
      <Button disabled={busy || confirm !== CONFIRMATION} onClick={() => { void leave(); }} type="button" variant="destructive">{busy ? "Deleting…" : "Delete my account"}</Button>
      {error && <p aria-live="polite" className="text-sm text-danger">{error}</p>}
    </div> : <p className="text-sm text-muted">Account deletion is available on the official portal.</p>}
  </Card>;
}
