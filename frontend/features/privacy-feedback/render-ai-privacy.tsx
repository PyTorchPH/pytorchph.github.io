"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { stringify } from "yaml";
import { toast } from "sonner";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import type { AiConsents, AiPurpose, AiFieldPolicy } from "@pytorch-ph/domain-protocol/privacy-feedback";

export function AiPrivacyControls() {
  const client=useQueryClient();
  const consent=useQuery({queryKey:["ai-purpose-consent"],queryFn:()=>fetchJson<AiConsents>("/api/member/ai-consent",{cache:"no-store"})});
  const policy=useQuery({queryKey:["ai-field-policy"],queryFn:()=>fetchJson<AiFieldPolicy>("/api/member/ai-policy",{cache:"no-store"})});
  const save=useMutation({mutationFn:(value:{purpose:AiPurpose;granted:boolean})=>fetchJson<AiConsents>("/api/member/ai-consent",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}),onSuccess:value=>client.setQueryData(["ai-purpose-consent"],value),onError:error=>toast.error(error instanceof Error ? error.message : "AI consent could not be saved.")});
  return <fieldset className="mt-4 space-y-3 rounded-lg border border-border p-3"><legend className="px-1 font-semibold">AI data privacy</legend>
    <p className="text-sm text-muted">Names, emails, links, images and unrestricted achievement text are excluded before model calls. AI consent is separate from achievement visibility.</p>
    {consent.data ? (["learning_recommendations","officer_assistant"] as const).map(purpose=><label className="flex gap-2 text-sm" key={purpose}><input checked={consent.data[purpose]} disabled={save.isPending} onChange={event=>save.mutate({purpose,granted:event.target.checked})} type="checkbox"/>{purpose==="learning_recommendations" ? "Allow category-only learning recommendations" : "Allow pseudonymized officer AI views (officer access required)"}</label>) : <p className="text-sm">{consent.isError ? "AI privacy controls are unavailable." : "Loading AI consents…"}</p>}
    <label className="flex gap-2 text-sm"><input checked={false} disabled type="checkbox"/>Model training enrollment is unavailable and stays off.</label>
    <p className="text-xs text-muted">Your provider&apos;s retention/training settings are separate. An alias is pseudonymous; it does not guarantee anonymity.</p>
    {policy.data && <details><summary className="cursor-pointer text-sm">Sensitive-field policy (YAML preview)</summary><textarea aria-label="Canonical AI field policy" className="mt-2 w-full font-mono text-xs" readOnly rows={12} value={stringify(policy.data)}/></details>}
  </fieldset>;
}
