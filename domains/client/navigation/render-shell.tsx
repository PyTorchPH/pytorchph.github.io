"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CircleHelp,
  ClipboardList,
  Flame,
  Home,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Search,
  Settings,
  Shield,
  Trophy,
  Unplug,
  UserCheck,
  UserRound,
  X
} from "lucide-react";
import { useState } from "react";
import type { CapabilityKey } from "@pytorch-ph/domain-protocol/identity";
import { cn } from "@pytorch-ph/design-system/merge-classes";
import { CapabilityProvider, useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { ProductTourController, requestProductTour } from "@pytorch-ph/domain-client/onboarding";
import { SignOutButton } from "@pytorch-ph/domain-client/identity";
import { Button } from "@pytorch-ph/design-system/button";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Sheet } from "@pytorch-ph/design-system/sheet";
import { Progress } from "@pytorch-ph/design-system/progress";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; capability?: CapabilityKey };

const memberNavItems: NavItem[] = [
  { href: "/dashboard", label: "Personal Dashboard", icon: Home },
  { href: "/career/evidence", label: "Career Evidence", icon: UserRound, capability: "evidence_read" },
  { href: "/career/resumes", label: "Resume Studio", icon: BarChart3, capability: "resume_read" },
  { href: "/jobs/opportunities", label: "Opportunities", icon: BriefcaseBusiness, capability: "opportunities_read" },
  { href: "/events", label: "Community Events", icon: CalendarDays },
  { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { href: "/trust", label: "Privacy & Trust", icon: Shield },
  { href: "/membership", label: "Membership", icon: UserCheck },
  { href: "/dashboard/profile", label: "My Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

const officerNavItems: NavItem[] = [
  { href: "/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/career/evidence", label: "Career Evidence", icon: UserRound, capability: "evidence_read" },
  { href: "/career/resumes", label: "Resume Studio", icon: BarChart3, capability: "resume_read" },
  { href: "/jobs/analytics", label: "Job Analytics", icon: Search, capability: "analytics_read" },
  { href: "/jobs/automation", label: "Job Automation", icon: Bot, capability: "application_draft" },
  { href: "/jobs/opportunities", label: "Opportunities", icon: BriefcaseBusiness, capability: "opportunities_read" },
  { href: "/connections", label: "Connections", icon: Unplug, capability: "connections" },
  { href: "/events", label: "Community Events", icon: CalendarDays },
  { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { href: "/trust", label: "Integrity Console", icon: Shield },
  { href: "/reports", label: "Reports & Feedback", icon: ClipboardList },
  { href: "/membership", label: "Member Reviews", icon: UserCheck },
  { href: "/admin/dashboard", label: "Officer Admin", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings }
];

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const manifest = useCapabilities();
  const officerPortal = manifest.portal.audience === "officer";
  const navItems = officerPortal ? officerNavItems : memberNavItems;

  const sidebar = (
    <aside className="flex h-full w-72 flex-col border-r border-white/10 bg-[#0d0d0d] p-4 text-[#FFF7ED]">
      <div className="mb-6 flex items-center justify-between">
        <Link className="focus-ring rounded-lg" href="/">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#e8590c] to-[#ff8a3d] shadow-lg shadow-[#e8590c]/30">
              <Flame size={20} />
            </div>
            <div>
              <p className="font-mono text-sm font-bold tracking-[-0.02em]">PYTORCH PH</p>
              <p className="text-xs text-[#FFF7ED]/45">{officerPortal ? "Officer / Developer" : "Member Workspace"}</p>
            </div>
          </div>
        </Link>
        <Button aria-label="Close menu" className="lg:hidden" onClick={() => setOpen(false)} size="icon" type="button" variant="ghost">
          <X size={18} />
        </Button>
      </div>
      <nav className="space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          const capability = item.capability ? manifest.capabilities[item.capability] : undefined;
          const isLocked = capability?.state === "locked";
          const content = <><Icon size={18} />{item.label}{isLocked && <LockKeyhole className="ml-auto" size={14} />}</>;
          if (isLocked) return (
            <span
              aria-disabled="true"
              className="flex h-10 cursor-not-allowed items-center gap-3 rounded-lg px-3 text-sm font-semibold text-[#FFF7ED]/25"
              key={item.href}
              title={capability.reason}
            >
              {content}
            </span>
          );
          return (
            <Link
              className={cn(
                "focus-ring flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-all duration-300 ease-in-out",
                active ? "bg-[#e8590c] text-white" : "text-[#FFF7ED]/55 hover:bg-white/[0.06] hover:text-[#FFF7ED]"
              )}
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              {content}
            </Link>
          );
        })}
      </nav>
      <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.035] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#FFF7ED]/40">Current cycle</p>
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        </div>
        <Progress className="h-1.5 bg-white/10" indicatorClassName="bg-[#e8590c]" value={68} />
        <p className="mt-2 text-xs text-[#FFF7ED]/45">{officerPortal ? "Community operations and review readiness." : "Personal evidence and career readiness."}</p>
      </div>
      <div className="mt-auto rounded-lg border border-white/10 bg-white/[0.035] p-3">
        <div className="mb-2 flex items-center gap-2">
          <Shield className="text-[#e8590c]" size={16} />
          <p className="text-sm font-semibold">{officerPortal ? "Officer data gateway" : "Personal data gateway"}</p>
        </div>
        <p className="text-xs leading-5 text-[#FFF7ED]/45">{officerPortal ? "Role checks run before officer data or diagnostics are returned." : "Officer diagnostics and operational payloads are excluded from this portal."}</p>
      </div>
      <Button
        className="mt-3 w-full justify-start gap-3"
        data-tour="tour-help"
        onClick={requestProductTour}
        type="button"
        variant="ghost"
      >
        <CircleHelp size={18} /> Help / Tour
      </Button>
      <SignOutButton />
    </aside>
  );

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#FFF7ED]">
      {manifest.localDemo && <div className="fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-center border-b border-[#ff8a3d]/30 bg-[#e8590c] px-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white sm:text-xs">Local {officerPortal ? "officer" : "member"} demo · Synthetic data · External actions disabled</div>}
      <header className={cn("sticky z-30 flex h-16 items-center justify-between border-b border-white/10 bg-[#0b0b0c]/90 px-4 backdrop-blur lg:hidden", manifest.localDemo ? "top-8" : "top-0")}>
        <Button aria-label="Open menu" onClick={() => setOpen(true)} size="icon" type="button" variant="secondary">
          <Menu size={18} />
        </Button>
        <Badge variant="orange">{officerPortal ? "Officer Portal" : "Member Portal"}</Badge>
        <Button aria-label="Replay page tour" data-tour="tour-help" onClick={requestProductTour} size="icon" type="button" variant="secondary">
          <CircleHelp size={18} />
        </Button>
      </header>
      <div className={cn("hidden lg:fixed lg:inset-x-auto lg:bottom-0 lg:left-0 lg:block", manifest.localDemo ? "lg:top-8" : "lg:top-0")}>{sidebar}</div>
      <Sheet onOpenChange={setOpen} open={open}>{sidebar}</Sheet>
      <main className={cn("lg:pl-72", manifest.localDemo && "pt-8")}>
        <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
      <ProductTourController />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <CapabilityProvider><AppShellContent>{children}</AppShellContent></CapabilityProvider>;
}
