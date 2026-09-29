"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { MemberPrivacySettings } from "@pytorch-ph/domain-protocol/privacy-feedback";

const toggles: Array<[keyof MemberPrivacySettings, string, string]> = [
  ["shareAchievements", "Show my achievements on the leaderboard", "Off by default. When on, members who open your leaderboard row see your approved evidence, event placements and verified skills. Anonymous ranking still hides your name and source links."],
  ["hideGoogleIdentity", "Hide Google identity", "OAuth email and provider identity stay out of member-facing views."],
  ["hideRealName", "Hide real name", "Use only the selected leaderboard label outside owner/officer-authorized workflows."],
  ["anonymousRanking", "Anonymous seasonal ranking", "Use a season-scoped alias while preserving your highlighted own row."],
  ["deviceCacheEnabled", "Persistent device vault", "Allow reviewed manual data to remain encrypted in this browser profile."],
  ["automaticErrorReports", "Privacy-safe automatic errors", "Send redacted error metadata without HTML, screenshots, or form values."],
];

// Owner-only visibility controls, shared by Settings and the privacy page.
export function PrivacyControls() {
  const client = useQueryClient();
  const privacy = useQuery({ queryKey: ["member-privacy"], queryFn: () => fetchJson<MemberPrivacySettings>("/api/member/privacy", { cache: "no-store" }) });
  const [draft, setDraft] = useState<MemberPrivacySettings | null>(null);
  useEffect(() => { if (privacy.data) setDraft({ ...privacy.data, shareAchievements: privacy.data.shareAchievements ?? false }); }, [privacy.data]);
  const save = useMutation({
    mutationFn: (value: MemberPrivacySettings) => fetchJson<MemberPrivacySettings>("/api/member/privacy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    onSuccess: (value) => { client.setQueryData(["member-privacy"], value); toast.success("Privacy controls saved."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Privacy settings failed."),
  });
  if (!draft) return <p className="text-sm text-muted">{privacy.isError ? "Privacy controls are unavailable right now." : "Loading owner-only controls…"}</p>;
  return <div className="space-y-2">
    {toggles.map(([key, label, detail]) => <label className="flex cursor-pointer gap-3 border border-border p-3" key={key}>
      <input checked={draft[key]} className="mt-1 accent-accent" onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} type="checkbox" />
      <span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted">{detail}</span></span>
    </label>)}
    <Button className="mt-3 w-full" disabled={save.isPending} onClick={() => save.mutate(draft)} type="button">{save.isPending ? "Saving…" : "Save privacy controls"}</Button>
  </div>;
}
