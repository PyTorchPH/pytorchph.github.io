"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { MemberPrivacySettings } from "@pytorch-ph/domain-protocol/privacy-feedback";

// Anonymous ranking and hiding the real name follow the leaderboard display mode, so they are
// not separate checkboxes.
const toggles: Array<[keyof MemberPrivacySettings, string, string]> = [
  ["hideGoogleIdentity", "Hide Google identity", "OAuth email and provider identity stay out of member-facing views."],
  ["deviceCacheEnabled", "Persistent device vault", "Allow reviewed manual data to remain encrypted in this browser profile."],
  ["automaticErrorReports", "Privacy-safe automatic errors", "Send redacted error metadata without HTML, screenshots, or form values."],
];

export const PRIVACY_QUERY_KEY = ["member-privacy"];

export function usePrivacySettings() {
  return useQuery({ queryKey: PRIVACY_QUERY_KEY, queryFn: async () => {
    const value = await fetchJson<MemberPrivacySettings>("/api/member/privacy", { cache: "no-store" });
    return { ...value, shareAchievements: value.shareAchievements ?? false };
  } });
}

export function savePrivacySettings(value: MemberPrivacySettings) {
  return fetchJson<MemberPrivacySettings>("/api/member/privacy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

const achievementChoices: Array<[boolean, string, string]> = [
  [false, "Hidden", "Default. Nobody else can open your achievements from the leaderboard; only your rank and points show."],
  [true, "Visible to members", "Members who open your leaderboard row see your approved evidence, event placements and verified skills. Anonymous mode still hides your name and source links."],
];

/** The privacy choices as a controlled list, for pages that save them with other settings. */
export function PrivacyToggles({ value, onChange }: { value: MemberPrivacySettings; onChange: (next: MemberPrivacySettings) => void }) {
  return <div className="space-y-2">
    <fieldset className="mb-3"><legend className="mb-2 text-sm font-semibold">My achievements on the leaderboard</legend><div className="grid gap-2 sm:grid-cols-2">
      {achievementChoices.map(([shared, label, detail]) => <label className="flex cursor-pointer gap-3 border border-border p-3" key={label}>
        <input checked={Boolean(value.shareAchievements) === shared} className="mt-1 accent-accent" name="share-achievements" onChange={() => onChange({ ...value, shareAchievements: shared })} type="radio" />
        <span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted">{detail}</span></span>
      </label>)}
    </div></fieldset>
    {toggles.map(([key, label, detail]) => <label className="flex cursor-pointer gap-3 border border-border p-3" key={key}>
      <input checked={Boolean(value[key])} className="mt-1 accent-accent" onChange={(event) => onChange({ ...value, [key]: event.target.checked })} type="checkbox" />
      <span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted">{detail}</span></span>
    </label>)}
  </div>;
}

// Stand-alone owner-only controls with their own save button (privacy page).
export function PrivacyControls() {
  const client = useQueryClient();
  const privacy = usePrivacySettings();
  const [draft, setDraft] = useState<MemberPrivacySettings | null>(null);
  useEffect(() => { if (privacy.data) setDraft(privacy.data); }, [privacy.data]);
  const save = useMutation({
    mutationFn: savePrivacySettings,
    onSuccess: (value) => { client.setQueryData(PRIVACY_QUERY_KEY, value); toast.success("Privacy controls saved."); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Privacy settings failed."),
  });
  if (!draft) return <p className="text-sm text-muted">{privacy.isError ? "Privacy controls are unavailable right now." : "Loading owner-only controls…"}</p>;
  return <div>
    <PrivacyToggles onChange={setDraft} value={draft} />
    <Button className="mt-3 w-full" disabled={save.isPending} onClick={() => save.mutate(draft)} type="button">{save.isPending ? "Saving…" : "Save privacy controls"}</Button>
  </div>;
}
