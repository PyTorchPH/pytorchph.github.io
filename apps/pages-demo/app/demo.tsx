"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CalendarDays, LayoutDashboard, Trophy, UserRound } from "lucide-react";
import { BrandMark } from "@pytorch-ph/domain-client/public-site";
import { metrics, events, kanbanEvents, leaderboardRows, skillRadar } from "../../../domains/client/organization/read-demo-data";

const button = "focus-ring rounded-xl bg-[#e8590c] px-5 py-3 text-sm font-semibold text-white hover:bg-[#ff7a2d]";
const secondary = "focus-ring rounded-xl border border-white/15 px-5 py-3 text-sm text-[#FFF7ED] hover:bg-white/5";
const panel = "rounded-2xl border border-white/10 bg-[#141416] p-5";
const example = { name: "Alex Reyes", email: "demo.member@example.org", password: "example-only" };

export function DemoAccess({ createAccount }: { createAccount: boolean }) {
  const router = useRouter();
  return <main className="min-h-screen bg-[#0d0d0d] px-5 pb-20 pt-8 text-[#FFF7ED]">
    <div className="mx-auto max-w-6xl"><BrandMark /></div>
    <section className="mx-auto grid max-w-5xl gap-12 py-14 lg:grid-cols-2 lg:py-24">
      <div className="self-center">
        <p className="font-mono text-xs uppercase tracking-widest text-orange-400">Nationwide community · Interactive demo</p>
        <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-5xl">{createAccount ? "Try your community account." : "Welcome back, builder."}</h1>
        <p className="mt-5 leading-7 text-[#FFF7ED]/60">Explore PyTorch Philippines using an example account. The details are already filled in—no personal information needed.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className={button} href="/dashboard/">Use example member</Link>
          <Link className={secondary} href="/admin/dashboard/">Use example officer</Link>
        </div>
        <p className="mt-5 text-sm text-[#FFF7ED]/45">Both views are public previews. They do not create an account or grant real access.</p>
      </div>
      <form className={`${panel} space-y-5`} onSubmit={event => { event.preventDefault(); router.push("/dashboard/"); }}>
        <h2 className="text-2xl font-semibold">{createAccount ? "Create a demo account" : "Example member login"}</h2>
        {createAccount && <label className="block text-sm">Example name<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3" readOnly value={example.name} /></label>}
        <label className="block text-sm">Example email<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3" type="email" readOnly autoComplete="off" value={example.email} /></label>
        <label className="block text-sm">Example password<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3" type="password" readOnly autoComplete="off" value={example.password} /></label>
        <p className="text-xs leading-5 text-[#FFF7ED]/50">These are fictional demo details. Nothing is sent or saved.</p>
        <button className={`${button} flex w-full items-center justify-center gap-2`} type="submit">{createAccount ? "Create demo account" : "Enter demo"}<ArrowRight size={16} /></button>
        <Link className="block text-center text-sm text-orange-400 hover:underline" href={createAccount ? "/login/" : "/register/"}>{createAccount ? "Try the example login instead" : "Preview account creation"}</Link>
      </form>
    </section>
  </main>;
}

export function DemoWorkspace({ screen }: { screen: string }) {
  const officer = screen === "admin/dashboard";
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const isEvents = screen === "events";
  const isRanks = screen === "leaderboards";
  const isProfile = screen === "dashboard/profile";
  const title = isEvents ? "Community events" : isRanks ? "Community leaderboard" : isProfile ? "Your example profile" : officer ? "Officer overview" : "Your community, at a glance.";
  const navigation = [
    { href: "/dashboard/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/events/", label: "Events", icon: CalendarDays },
    { href: "/leaderboards/", label: "Leaderboard", icon: Trophy },
    { href: "/dashboard/profile/", label: "Profile", icon: UserRound },
  ];
  return <main className="min-h-screen bg-[#0d0d0d] pb-20 text-[#FFF7ED]">
    <header className="border-b border-white/10 px-5 py-5"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4"><BrandMark /><Link className="text-sm text-orange-400" href="/login/">Change example account</Link></div></header>
    <div className="mx-auto grid max-w-7xl gap-7 px-5 py-8 lg:grid-cols-[210px_1fr]">
      <nav aria-label="Demo workspace" className="flex flex-wrap gap-2 lg:flex-col">
        {navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={href === `/${screen}/` ? "page" : undefined} className={`focus-ring flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${href === `/${screen}/` ? "bg-orange-500/15 text-orange-400" : "text-[#FFF7ED]/65 hover:bg-white/5"}`}><Icon size={17} />{label}</Link>)}
        <Link href="/admin/dashboard/" className="focus-ring rounded-xl border border-white/10 px-4 py-3 text-sm text-[#FFF7ED]/65">Officer demo</Link>
      </nav>
      <section className="min-w-0 space-y-6">
        <div><p className="font-mono text-xs uppercase tracking-widest text-orange-400">Sample workspace · {officer ? "Officer" : "Member"}</p><h1 className="mt-3 text-3xl font-bold md:text-4xl">{title}</h1><p className="mt-3 text-sm leading-6 text-[#FFF7ED]/55">A preview of learning, contributions, and community life across the Philippines. All records are fictional.</p></div>
        {notice && <p role="status" className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 text-sm">{notice}</p>}
        {(isEvents || isRanks) && <label className="block text-sm">{isEvents ? "Find a sample event" : "Filter by name or specialty"}<input className="mt-2 w-full rounded-xl border border-white/10 bg-[#141416] p-3" value={filter} onChange={event => setFilter(event.target.value)} placeholder={isEvents ? "Try PyTorch or workshop" : "Try Computer Vision"} /></label>}
        {isEvents ? <div className="grid gap-4 md:grid-cols-2">{events.filter(item => `${item.title} ${item.type}`.toLowerCase().includes(filter.toLowerCase())).map(item => <article className={panel} key={item.title}><p className="text-xs text-orange-400">{item.type} · Sample event</p><h2 className="mt-3 text-xl font-semibold">{item.title}</h2><p className="mt-3 text-sm text-[#FFF7ED]/50">Sample date: {item.date} · {item.seats} example places</p><button className={`${secondary} mt-5`} onClick={() => setNotice(`Demo RSVP for ${item.title}. No registration was submitted.`)}>Preview RSVP</button></article>)}</div>
        : isRanks ? <div className={`${panel} overflow-x-auto`}><table className="w-full text-left text-sm"><thead className="text-[#FFF7ED]/45"><tr>{["Rank", "Example member", "Specialty", "Points"].map(value => <th key={value} className="whitespace-nowrap p-3">{value}</th>)}</tr></thead><tbody>{leaderboardRows.filter(item => `${item.name} ${item.track}`.toLowerCase().includes(filter.toLowerCase())).map(item => <tr key={item.rank} className="border-t border-white/10"><td className="p-3 text-orange-400">#{item.rank}</td><td className="whitespace-nowrap p-3">{item.name}</td><td className="p-3 text-[#FFF7ED]/60">{item.track}</td><td className="p-3 font-mono">{item.points.toLocaleString("en-US")}</td></tr>)}</tbody></table></div>
        : <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{metrics.map(item => <article className={panel} key={item.label}><p className="text-xs text-[#FFF7ED]/50">{item.label}</p><p className="mt-3 text-3xl font-bold">{item.value}</p><p className="mt-2 text-xs text-orange-400">Sample metric</p></article>)}</div>
          {officer ? <section><h2 className="mb-4 text-xl font-semibold">Event planning preview</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(kanbanEvents).map(([status, items]) => <div className={panel} key={status}><h3 className="mb-4 text-sm font-semibold capitalize text-orange-400">{status}</h3>{items.map(item => <p className="mb-3 rounded-lg border border-white/10 p-3 text-sm leading-6" key={item.id}>{item.title}</p>)}</div>)}</div></section>
          : <div className="grid gap-5 md:grid-cols-2"><article className={panel}><p className="text-xs text-orange-400">Fictional member</p><h2 className="mt-3 text-2xl font-semibold">{example.name}</h2><p className="mt-3 text-sm text-[#FFF7ED]/55">Community learner · Philippines</p><p className="mt-2 text-sm text-[#FFF7ED]/55">Exploring PyTorch, computer vision, and open-source collaboration.</p><Link className={`${secondary} mt-6 inline-block`} href="/events/">Explore example events</Link></article><article className={panel}><h2 className="mb-5 text-xl font-semibold">Example learning progress</h2>{skillRadar.map(item => <div className="mb-4" key={item.skill}><div className="mb-2 flex justify-between text-xs"><span>{item.skill}</span><span>{item.score}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#e8590c]" style={{ width: `${item.score}%` }} /></div></div>)}</article></div>}
        </>}
      </section>
    </div>
  </main>;
}
