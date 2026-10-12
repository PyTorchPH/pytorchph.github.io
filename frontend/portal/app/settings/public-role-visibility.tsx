"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROFILE_PACKAGE_QUERY_KEY } from "@pytorch-ph/domain-client/member-profile";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

type PublicRoleVisibility = {isAssigned: boolean; nameVisible: boolean; photoVisible: boolean};
const queryKey = ["public-role-visibility"] as const;
const readVisibility = () => fetchJson<PublicRoleVisibility>("/api/member/public-role-visibility",{cache:"no-store"});

export function PublicRoleVisibilitySettings() {
  const client = useQueryClient();
  const visibility = useQuery({queryKey,queryFn:readVisibility});
  const save = useMutation({
    mutationFn: async ({field,granted}: {field:"name" | "photo"; granted:boolean}) => {
      await fetchJson(`/api/member/organization-${field}-consent`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({granted})});
      return readVisibility();
    },
    onSuccess: value => {
      client.setQueryData(queryKey,value);
      void client.invalidateQueries({queryKey:PROFILE_PACKAGE_QUERY_KEY});
      void client.invalidateQueries({queryKey:["officer-organization"]});
    },
  });
  if (visibility.isError) return <p role="status" className="mt-4 text-sm text-warning">Public role visibility settings are unavailable.</p>;
  if (!visibility.data) return <p role="status" className="mt-4 text-sm text-muted">Loading public role visibility…</p>;
  if (!visibility.data.isAssigned) return null;
  return <section className="mt-6 space-y-3" aria-labelledby="public-role-visibility-title"><h3 id="public-role-visibility-title" className="text-sm font-semibold">Public leadership and Campus Labs profile</h3><p className="text-xs leading-5 text-muted">Your assigned public role shows your name and organization photo by default unless you explicitly hide them. Hiding your name removes your profile from public role listings; hiding your photo keeps the profile without a picture. Photo permission does not create a photo if none is uploaded. These choices do not enable AI use or change your leaderboard display mode.</p><label className="flex gap-3 border border-border p-3"><input type="checkbox" checked={visibility.data.nameVisible} disabled={save.isPending} onChange={event=>save.mutate({field:"name",granted:event.target.checked})} className="accent-accent" /><span>Show my name in public role listings</span></label><label className="flex gap-3 border border-border p-3"><input type="checkbox" checked={visibility.data.photoVisible} disabled={save.isPending} onChange={event=>save.mutate({field:"photo",granted:event.target.checked})} className="accent-accent" /><span>Allow my organization photo in public role listings</span></label><p role="status" className="text-sm">{save.isPending ? "Saving public role visibility…" : save.isError ? (save.error instanceof Error ? save.error.message : "Public role visibility could not be saved.") : save.isSuccess ? "Public role visibility saved." : ""}</p></section>;
}
