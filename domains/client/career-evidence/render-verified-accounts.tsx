"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, RefreshCw, Unlink } from "lucide-react";
import { collectOwnProfile, verifyIdentity, type ExtensionProvider } from "@pytorch-ph/domain-client/client-automation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

type VerifiedAccount = { provider: ExtensionProvider; handle: string; profileUrl: string; verifiedAt: string };

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/$/, "");
const PROVIDERS: Array<{ id: ExtensionProvider; label: string }> = [
  { id: "github", label: "GitHub" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
];
const ACCOUNTS_KEY = ["member-accounts"];

// Verification reads who is signed in on that site in this browser, so only your own profile
// can be bound; syncing collects that profile and sends it straight to officer review.
export function VerifiedAccounts({ extensionReady }: { extensionReady: boolean }) {
  const client = useQueryClient();
  const accounts = useQuery({ queryKey: ACCOUNTS_KEY, queryFn: () => fetchJson<VerifiedAccount[]>("/api/member/accounts", { cache: "no-store" }) });
  const [notice, setNotice] = useState<Record<string, string>>({});
  const say = (provider: ExtensionProvider, message: string) => setNotice((current) => ({ ...current, [provider]: message }));

  const verify = useMutation({
    mutationFn: async (provider: ExtensionProvider) => {
      const identity = await verifyIdentity(provider);
      return fetchJson<VerifiedAccount>(`/api/member/accounts/${provider}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: identity.handle, profileUrl: identity.profileUrl }) });
    },
    onSuccess: async (account) => { say(account.provider, `Verified as ${account.handle}.`); await client.invalidateQueries({ queryKey: ACCOUNTS_KEY }); },
    onError: (error, provider) => say(provider, error instanceof Error ? error.message : "Verification failed."),
  });

  const sync = useMutation({
    mutationFn: async (account: VerifiedAccount) => {
      const payload = await collectOwnProfile(account.provider, account.profileUrl);
      const response = await fetch(`${API_ORIGIN}/evidence/extension`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { submitted?: number; duplicates?: number; error?: string };
      if (!response.ok) throw new Error(body.error || `Profile sync failed (${response.status}).`);
      return { provider: account.provider, submitted: body.submitted ?? 0, duplicates: body.duplicates ?? 0 };
    },
    onSuccess: (result) => say(result.provider, `${result.submitted} item${result.submitted === 1 ? "" : "s"} sent to officer review${result.duplicates ? `; ${result.duplicates} already submitted` : ""}.`),
    onError: (error, account) => say(account.provider, error instanceof Error ? error.message : "Profile sync failed."),
  });

  const disconnect = useMutation({
    mutationFn: (provider: ExtensionProvider) => fetchJson(`/api/member/accounts/${provider}`, { method: "DELETE" }),
    onSuccess: async (_, provider) => { say(provider, "Disconnected."); await client.invalidateQueries({ queryKey: ACCOUNTS_KEY }); },
    onError: (error, provider) => say(provider, error instanceof Error ? error.message : "Disconnect failed."),
  });

  const busy = verify.isPending || sync.isPending || disconnect.isPending;
  return <ul className="mt-4 space-y-2">
    {PROVIDERS.map(({ id, label }) => {
      const account = accounts.data?.find((item) => item.provider === id);
      return <li className="border border-border bg-elevated p-3" key={id}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><p className="flex items-center gap-2 font-semibold">{label}{account && <Badge variant="success"><BadgeCheck aria-hidden="true" size={13} /> Verified</Badge>}</p>
            <p className="mt-1 truncate text-xs text-muted">{account ? account.profileUrl : `Sign in to ${label} in this browser, then verify.`}</p></div>
          <div className="flex flex-wrap gap-2">
            {account ? <>
              <Button disabled={!extensionReady || busy} onClick={() => sync.mutate(account)} size="sm" type="button"><RefreshCw aria-hidden="true" size={14} /> Sync my profile</Button>
              <Button disabled={busy} onClick={() => disconnect.mutate(id)} size="sm" type="button" variant="ghost"><Unlink aria-hidden="true" size={14} /> Disconnect</Button>
            </> : <Button disabled={!extensionReady || busy} onClick={() => verify.mutate(id)} size="sm" type="button" variant="secondary">Verify with extension</Button>}
          </div>
        </div>
        {notice[id] && <p aria-live="polite" className="mt-2 text-xs text-muted">{notice[id]}</p>}
      </li>;
    })}
  </ul>;
}
