"use client";

// "Complete your profile" page body (/onboarding).
// Module map:
//   CompleteProfile     loads reference options + saved profile, then renders the form
//   ├─ ProfileForm      owns the draft; About you → Study & work → Interests → Consent; submit
//   └─ useSaveProfile   PUT, refresh the ["member-profile"] cache, go to /dashboard/
//   LoadProblem         error card for a failed load

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import type { ProfileOptions } from "@pytorch-ph/domain-protocol/identity";
import { PROFILE_OPTIONS_QUERY_KEY, PROFILE_QUERY_KEY, fetchProfileOptions, saveProfile } from "../api";
import { useMemberProfile } from "../use-profile-gate";
import { AboutYouSection } from "./about-you";
import { draftFromProfile, findDraftProblem, toProfileInput, type ProfileDraft } from "./form-state";
import { ConsentSection, InterestsSection } from "./interests-consent";
import { StudyWorkSection } from "./study-work";

// Mental model: both reads must succeed before the form mounts, so the draft is seeded exactly once
// from the saved profile (Settings → "Edit profile details" reuses this page prefilled).
export function CompleteProfile() {
  const options = useQuery({ queryKey: PROFILE_OPTIONS_QUERY_KEY, queryFn: fetchProfileOptions, staleTime: Infinity });
  const profile = useMemberProfile();
  if (options.isError || profile.isError) return <LoadProblem />;
  if (!options.data || !profile.data) return <p className="text-sm text-muted">Loading your profile…</p>;
  const editing = profile.data.complete;
  return <Card className="mx-auto max-w-3xl">
    <CardHeader><div>
      {!editing && <p className="data-label mb-1 text-xs uppercase tracking-widest text-accent">Step 2 of 2 · Create your account</p>}
      <CardTitle>{editing ? "Edit profile details" : "Welcome! Finish creating your account"}</CardTitle>
      <CardDescription>{editing ? "Update the details you shared when you joined." : "You are now a member of PyTorch Philippines. A few questions help us plan events for the community; it takes about a minute."}</CardDescription>
    </div></CardHeader>
    <ProfileForm initial={draftFromProfile(profile.data.profile)} options={options.data} />
  </Card>;
}

function ProfileForm({ initial, options }: { initial: ProfileDraft; options: ProfileOptions }) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveProfile(setProblem);
  const update = (changes: Partial<ProfileDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = findDraftProblem(draft);
    setProblem(found);
    if (!found) save.mutate(draft);
  };
  return <form className="space-y-6" noValidate onSubmit={submit}>
    <AboutYouSection draft={draft} options={options} update={update} />
    <StudyWorkSection draft={draft} options={options} update={update} />
    <InterestsSection draft={draft} options={options} update={update} />
    <ConsentSection draft={draft} update={update} />
    {problem && <p className="border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{problem}</p>}
    <div className="flex justify-end">
      <Button disabled={save.isPending} type="submit">{save.isPending ? "Saving…" : "Save and continue"}</Button>
    </div>
  </form>;
}

function useSaveProfile(onProblem: (message: string) => void) {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ProfileDraft) => saveProfile(toProfileInput(draft)),
    onSuccess: (status) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, status);
      toast.success("Profile saved.");
      router.replace("/dashboard/");
    },
    onError: (error) => onProblem(error instanceof Error ? error.message : "Could not save your profile."),
  });
}

function LoadProblem() {
  return <Card className="mx-auto max-w-3xl">
    <p className="font-semibold">We couldn't load the profile form.</p>
    <p className="mt-1 text-sm text-muted">Check your connection and refresh. If you are signed out, sign in first.</p>
  </Card>;
}
