"use client";

import { useState } from "react";
import { Bell, BookOpen, Check, ChevronDown, Hash, LockKeyhole, MessageCircle, ShieldCheck, Sparkles, Users, Volume2 } from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { communityDemoProfiles, communityDemoView, communityInterestOptions } from "./demo-model";
import { PeerTutorials } from "./peer-tutorials";

const channelIcon = { text: Hash, forum: MessageCircle, voice: Volume2, stage: Volume2 };
const bandDescription: Record<string, string> = {
  beginner: "Start learning together",
  builder: "Build and share projects",
  advanced: "Explore deeper techniques",
  mentor: "Guide and review others",
};

export function CommunityDemoContent() {
  const [profileId, setProfileId] = useState("beginner");
  const [interests, setInterests] = useState<string[]>(["interest-learn"]);
  const [showAll, setShowAll] = useState(false);
  const view = communityDemoView(profileId, interests);
  const shownChannels = view.availableChannels.filter((channel) => channel.defaultChannel || showAll || view.recommendedKeys.has(channel.key));
  const categories = [...new Set(shownChannels.map((channel) => channel.category))];
  const roleNames = [...view.profile.roleNames, ...(view.rankFamily ? [view.rankFamily[0].toUpperCase() + view.rankFamily.slice(1)] : [])];

  function toggleInterest(key: string) {
    setInterests((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  return <div className="space-y-6 pb-10">
      <section className="overflow-hidden rounded-3xl border border-accent/25 bg-[radial-gradient(circle_at_90%_10%,rgb(var(--accent-rgb)/.1),transparent_38%),linear-gradient(130deg,rgb(var(--surface-rgb)),rgb(var(--surface-rgb)))] p-6 lg:p-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <Badge variant="orange"><Sparkles size={14} /> Website demo</Badge>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight lg:text-4xl">Find your place in PyTorch PH</h1>
            <p className="mt-3 leading-7 text-muted">A calmer first look at the proposed community. Pick a sample profile and interests to preview the channels and events that fit.</p>
          </div>
          <div className="rounded-2xl border border-border bg-elevated px-4 py-3 text-sm text-muted"><Users className="mb-2 text-accent" size={22} />Community preview<br /><strong className="text-ink">No Discord account needed</strong></div>
        </div>
        <p className="mt-6 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">Sample data only. Choices on this page do not link accounts, award points, or assign Discord roles.</p>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
        <Card className="bg-surface">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-accentSoft p-2 text-accent"><Users size={20}/></div><div><h2 className="text-lg font-bold">Preview as a member</h2><p className="text-sm text-muted">Switch profiles to see how verified progress changes access.</p></div></div>
          <label className="mt-5 block text-sm font-semibold" htmlFor="community-profile">Sample profile</label>
          <div className="relative mt-2"><select className="h-12 w-full appearance-none rounded-xl border border-border bg-elevated px-4 pr-10 text-ink" id="community-profile" onChange={(event) => setProfileId(event.target.value)} value={profileId}>{communityDemoProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} — {profile.note}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-4 top-4 text-muted" size={17}/></div>
          <p className="mt-6 text-sm font-semibold">What are you here for?</p>
          <p className="mt-1 text-sm text-muted">Interests tailor suggestions; they never unlock gated spaces.</p>
          <div className="mt-3 flex flex-wrap gap-2">{communityInterestOptions.map((answer) => {
            const selected = interests.includes(answer.roleKey);
            return <button aria-pressed={selected} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${selected ? "border-accent bg-accentSoft text-accent" : "border-border bg-elevated text-muted hover:text-ink"}`} key={answer.roleKey} onClick={() => toggleInterest(answer.roleKey)} type="button">{selected && <Check size={14} />}{answer.label}</button>;
          })}</div>
        </Card>

        <Card className="border-accent/20 bg-surface">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-success/10 p-2 text-success"><ShieldCheck size={20}/></div><div><h2 className="text-lg font-bold">Your preview access</h2><p className="text-sm text-muted">Based on the existing website tier rules.</p></div></div>
          <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl border border-border bg-elevated p-4"><p className="text-xs uppercase tracking-wide text-muted">Access band</p><p className="mt-2 text-xl font-bold capitalize">{view.profile.accessBand === "none" ? "Not linked" : view.profile.accessBand}</p></div><div className="rounded-xl border border-border bg-elevated p-4"><p className="text-xs uppercase tracking-wide text-muted">Points rank</p><p className="mt-2 text-xl font-bold capitalize">{view.rankFamily ?? "None yet"}</p></div></div>
          <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Website-managed roles</p><div className="mt-2 flex flex-wrap gap-2">{roleNames.length ? roleNames.map((name) => <Badge key={name}>{name}</Badge>) : <span className="text-sm text-muted">Linking a member account would start verified access.</span>}</div></div>
          <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted">Moderator, Administrator, and Event Host roles are assigned by people in Discord, never from website points.</p>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,.55fr)]">
        <Card className="bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Your channel list</h2><p className="mt-1 text-sm text-muted">Everyone starts with seven useful channels. Relevant spaces appear as you grow.</p></div><Button onClick={() => setShowAll((value) => !value)} size="sm" variant="outline">{showAll ? "Show suggestions" : `Show all ${view.availableChannels.length} available`}</Button></div>
          <div className="mt-6 space-y-6">{categories.map((category) => <div key={category}><h3 className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-muted">{category}</h3><div className="grid gap-2 sm:grid-cols-2">{shownChannels.filter((channel) => channel.category === category).map((channel) => {
            const Icon = channelIcon[channel.kind];
            return <div className="flex items-center gap-3 rounded-xl border border-border bg-elevated px-3 py-3" key={channel.key}><Icon className="shrink-0 text-accent" size={18}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{channel.name}</p><p className="text-xs text-muted">{channel.defaultChannel ? "Available to everyone" : "Unlocked for this profile"}</p></div>{!channel.defaultChannel && view.recommendedKeys.has(channel.key) && <Sparkles aria-label="Suggested for your interests" className="ml-auto shrink-0 text-warning" size={15}/>}</div>;
          })}</div></div>)}</div>
          {view.lockedChannels.length > 0 && <div className="mt-6 border-t border-border pt-5"><h3 className="flex items-center gap-2 text-sm font-bold"><LockKeyhole size={16}/> More to unlock</h3><p className="mt-1 text-xs text-muted">Verified points or credentials can unlock learning spaces. Interest choices alone cannot.</p><div className="mt-3 flex flex-wrap gap-2">{view.lockedChannels.filter((channel) => channel.category === "LEARNING PATHS").map((channel) => <span className="rounded-full border border-border px-3 py-1.5 text-xs text-muted" key={channel.key}># {channel.name}</span>)}</div></div>}
        </Card>

        <div className="space-y-4">
          <Card className="bg-surface"><div className="flex items-center gap-2"><BookOpen className="text-accent" size={19}/><h2 className="font-bold">Event paths</h2></div><p className="mt-2 text-sm text-muted">The same access roles can guide who sees each learning event.</p><div className="mt-4 space-y-2">{view.eventBands.map((event) => <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-elevated p-3" key={event.key}><div><p className="text-sm font-semibold">{event.label}</p><p className="text-xs text-muted">{bandDescription[event.key]}</p></div><Badge variant={event.unlocked ? "success" : "default"}>{event.unlocked ? "Open" : "Locked"}</Badge></div>)}</div></Card>
          <Card className="bg-surface"><div className="flex items-center gap-2"><Bell className="text-accent" size={18}/><h2 className="font-bold">Launch approach</h2></div><p className="mt-2 text-sm leading-6 text-muted">Discord's own Onboarding, Server Guide, forums, and AutoMod keep the setup familiar. The custom PyTorch PH app would handle website-linked roles in a later phase.</p><Badge className="mt-4" variant="warning">Preview only</Badge></Card>
        </div>
      </section>

      <PeerTutorials accessBand={view.profile.accessBand} />
  </div>;
}

export default function CommunityDemoPage() {
  return <AppShell><CommunityDemoContent /></AppShell>;
}
