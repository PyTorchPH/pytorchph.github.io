"use client";

import Link from "next/link";
import { AccountBinding } from "@pytorch-ph/domain-client/career-evidence";
import { CompleteProfile } from "@pytorch-ph/domain-client/member-profile";
import { PRIVACY_QUERY_KEY, savePrivacySettings, usePrivacySettings } from "@pytorch-ph/domain-client/privacy-feedback";
import { useProfilePackage } from "@pytorch-ph/domain-client/member-profile";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@pytorch-ph/design-system/card";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { SegmentedTabs, TabPanel } from "@pytorch-ph/design-system/tabs";
import { fetchJson } from "@pytorch-ph/domain-client/transport";
import { LeaveCommunity } from "../../components/leave-community";
import { LocalAIConnection } from "../../components/local-ai-connection";
import type { LeaderboardIdentitySettings } from "@pytorch-ph/domain-protocol/leaderboards";
import type { MemberPrivacySettings } from "@pytorch-ph/domain-protocol/privacy-feedback";
import { OrganizationPhotoSettings } from "./organization-photo-settings";
import { PublicRoleVisibilitySettings } from "./public-role-visibility";
import { ProfileConsentSettings } from "./profile-consents";
import { PrivateProfileSettings } from "./private-profile-settings";

type Mode = LeaderboardIdentitySettings["mode"];

export default function SettingsPage() {
  const [section, setSection] = useState<"privacy" | "profile" | "connections" | "account">("privacy");
  const queryClient = useQueryClient();
  const profilePackage = useProfilePackage();
  const query = useQuery({ queryKey: ["leaderboard-identity"], queryFn: () => fetchJson<LeaderboardIdentitySettings>("/api/member/leaderboard-identity", { cache: "no-store" }) });
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<Mode>("nickname");
  const consent = profilePackage.data?.consents.realNameVisible ?? false;
  const [availability, setAvailability] = useState<"idle" | "available" | "unavailable">("idle");
  const privacyQuery = usePrivacySettings();
  const [privacy, setPrivacy] = useState<MemberPrivacySettings | null>(null);
  useEffect(() => { if (query.data) { setUsername(query.data.username); setMode(query.data.mode); } }, [query.data]);
  useEffect(() => { if (privacyQuery.data) setPrivacy(privacyQuery.data); }, [privacyQuery.data]);
  const mutation = useMutation({
    mutationFn: async () => {
      const identity = await fetchJson<LeaderboardIdentitySettings>("/api/member/leaderboard-identity", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, mode, realNameConsent: consent }) });
      const savedPrivacy = privacy ? await savePrivacySettings({ ...privacy, anonymousRanking: mode === "anonymous", hideRealName: mode !== "real_name" }) : null;
      return { identity, savedPrivacy };
    },
    onSuccess: ({ identity, savedPrivacy }) => {
      queryClient.setQueryData(["leaderboard-identity"], identity);
      if (savedPrivacy) queryClient.setQueryData(PRIVACY_QUERY_KEY, savedPrivacy);
      queryClient.invalidateQueries({ queryKey: ["member-leaderboard"] });
      toast.success("Leaderboard and privacy settings saved.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Settings could not be saved."),
  });
  async function checkAvailability() {
    try {
      const result = await fetchJson<{ available: boolean }>(`/api/member/leaderboard-identity?username=${encodeURIComponent(username)}`, { cache: "no-store" });
      setAvailability(result.available ? "available" : "unavailable");
    } catch { setAvailability("unavailable"); }
  }
  const preview = mode === "anonymous" ? "Member #7A82F (changes each season)" : mode === "real_name" ? consent ? "Your account display name" : "Consent required" : username || "Your username";

  return <AppShell>
    <div className="page-hero flex flex-wrap items-center justify-between gap-3" data-tour="settings-heading">
      <div><h1 className="text-3xl font-bold tracking-[-0.02em]">Settings</h1><p className="mt-2 text-muted">Leaderboard and privacy, AI connection, and connected accounts.</p></div>
      <Badge variant="orange">Private by default</Badge>
    </div>
    <div aria-label="Settings sections"><SegmentedTabs items={[{ value: "privacy", label: "Leaderboard & privacy" }, { value: "profile", label: "Profile" }, { value: "connections", label: "Connections" }, { value: "account", label: "Account" }]} onChange={setSection} value={section} /></div>
    <TabPanel>
    {section === "privacy" && <>
    <Card className="bg-surface" data-tour="settings-privacy" id="privacy">
      <CardHeader><div><CardTitle>Leaderboard &amp; privacy</CardTitle><CardDescription>How you appear on leaderboards and what leaves your device. <Link className="text-accent underline underline-offset-2" href="/trust">How your data is protected</Link></CardDescription></div><UserCog aria-hidden="true" className="text-accent" /></CardHeader>
      {query.data?.reviewRequired && <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Review the generated username before continuing.</div>}
      <div className="grid items-start gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-5">
          <div><Label htmlFor="leaderboard-username">Username</Label><div className="flex gap-2"><Input id="leaderboard-username" maxLength={24} minLength={3} onChange={(event) => { setUsername(event.target.value); setAvailability("idle"); }} pattern="[A-Za-z0-9_-]{3,24}" value={username} /><Button onClick={checkAvailability} type="button" variant="outline">Check</Button></div><p className="mt-2 text-xs text-muted">3–24 characters: letters, numbers, underscore, or hyphen. Unique without regard to case.</p>{availability !== "idle" && <p className={`mt-2 text-xs ${availability === "available" ? "text-success" : "text-warning"}`}>{availability === "available" ? "Username is available." : "Username is invalid or unavailable."}</p>}</div>
          <fieldset><legend className="mb-2 text-sm font-semibold">Show me on leaderboards as</legend><div className="grid gap-2">{([['nickname','Username','Show your username.'],['anonymous','Anonymous','A season-scoped Member # label; your own row stays highlighted for you.'],['real_name','Real name','Your account display name, only with your consent.']] as const).map(([value,label,detail]) => <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3" key={value}><input checked={mode===value} name="identity-mode" onChange={() => setMode(value)} type="radio" /><span><span className="block font-semibold">{label}</span><span className="text-xs text-muted">{detail}</span></span></label>)}</div></fieldset>
          {mode === "real_name" && !consent && <p className="text-sm text-warning">Enable “Show my real name” below to use this mode.</p>}
        </div>
        <div className="self-start"><p className="mb-2 text-sm font-semibold">Preview</p><div className="rounded-xl border border-accent/30 bg-accentSoft p-3 text-center text-base font-bold">{preview}</div><p className="mt-3 text-xs leading-5 text-muted">Leaderboards never show your email or account ID. Your evidence and placements appear only if you turn on sharing below.</p></div>
      </div>
      <h3 className="mb-2 mt-6 text-sm font-semibold">Privacy</h3>
      <ProfileConsentSettings />
      <PublicRoleVisibilitySettings />
      <Button className="mt-4 w-full sm:w-auto" disabled={query.isLoading || !privacy || mutation.isPending || !username || (mode === "real_name" && !consent)} onClick={() => mutation.mutate()} type="button">{mutation.isPending ? "Saving…" : "Save leaderboard and privacy"}</Button>
    </Card>
    </>}
    {section === "profile" && <div className="space-y-5" id="profile-details"><OrganizationPhotoSettings /><PrivateProfileSettings /><CompleteProfile embedded /></div>}
    {section === "connections" && <><LocalAIConnection /><AccountBinding /></>}
    {section === "account" && <LeaveCommunity />}
    </TabPanel>
  </AppShell>;
}
