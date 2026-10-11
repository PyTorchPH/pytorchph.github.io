"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { PROFILE_PACKAGE_QUERY_KEY, saveIdentitySettings, useProfilePackage, type IdentitySettings, type ProfilePackage } from "@pytorch-ph/domain-client/member-profile";

const choices: Array<[keyof IdentitySettings, string, string]> = [
  ["realNameVisible", "Show my real name", "Allow my display name on the organization chart and in real-name leaderboard mode."],
  ["photoVisible", "Show my photo", "Allow my profile photo on the organization chart and leaderboard. I can always view my own photo."],
  ["analyticsOptOut", "Do not include my profile answers in demographics", "Exclude my answers from community demographics."],
  ["hideGoogleIdentity", "Hide Google identity", "Keep my provider identity out of member-facing views."],
  ["automaticErrorReports", "Send privacy-safe error reports", "Send redacted error metadata without form values or screenshots."],
  ["shareAchievements", "Show my achievements to members", "Members may open my approved achievements from the leaderboard."],
];

export function ProfileConsentSettings() {
  const queryClient = useQueryClient();
  const profile = useProfilePackage();
  const [draft, setDraft] = useState<IdentitySettings | null>(null);
  useEffect(() => { if (profile.data) setDraft(profile.data.consents); }, [profile.data]);
  const save = useMutation({
    mutationFn: (value: IdentitySettings) => saveIdentitySettings(value),
    onSuccess: (saved) => {
      queryClient.setQueryData<ProfilePackage>(PROFILE_PACKAGE_QUERY_KEY, (current) => current ? { ...current, consents: saved } : current);
      queryClient.invalidateQueries({ queryKey: ["member-privacy"] });
      queryClient.invalidateQueries({ queryKey: ["member-leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["officer-organization"] });
      toast.success("Privacy settings saved.");
    },
    onError: () => toast.error("Privacy settings could not be saved."),
  });
  if (!draft) return <p className="text-sm text-muted">{profile.isError ? "Privacy settings are unavailable." : "Loading privacy settings…"}</p>;
  return <div className="space-y-3">
    {choices.map(([key, label, detail]) => <label className="flex cursor-pointer gap-3 border border-border p-3" key={key}>
      <input checked={draft[key]} className="mt-1 accent-accent" onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} type="checkbox" />
      <span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted">{detail}</span></span>
    </label>)}
    <Button disabled={save.isPending} onClick={() => save.mutate(draft)} type="button">{save.isPending ? "Saving…" : "Save privacy choices"}</Button>
  </div>;
}
