"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
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
  MessageCircle,
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

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; capability?: CapabilityKey; alsoActiveOn?: string[] };

// Members and officers share these pages.
const sharedNavItems: NavItem[] = [
  { href: "/dashboard", label: "My Performance", icon: Home },
  { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { href: "/career/evidence", label: "Career Evidence", icon: UserRound, capability: "evidence_read" },
  { href: "/career/resumes", label: "Resumes & Opportunities", icon: BriefcaseBusiness, capability: "resume_read", alsoActiveOn: ["/jobs/opportunities", "/jobs/analytics", "/jobs/automation"] },
  { href: "/events", label: "Community Events", icon: CalendarDays },
  { href: "/dashboard/community", label: "Community Preview", icon: MessageCircle },
  { href: "/dashboard/profile", label: "My Profile", icon: UserCheck },
  { href: "/settings", label: "Settings & Privacy", icon: Settings },
];

// Officers get these in addition: configuration and the workflows they run.
const officerNavItems: NavItem[] = [
  { href: "/admin/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/admin/events", label: "Event Workflow", icon: ClipboardList },
  { href: "/admin/evidence", label: "Evidence Review", icon: Search },
  { href: "/reports", label: "Reports & Feedback", icon: Bot },
  { href: "/connections", label: "Connections", icon: Unplug, capability: "connections" },
  { href: "/trust", label: "Integrity Console", icon: Shield },
];

function AppShellContent({ children }: { children: React.ReactNode }) {
  // Static hosting serves routes with a trailing slash; navigation links are written without one.
  const pathname = usePathname().replace(/\/+$/, "") || "/";
  const [open, setOpen] = useState(false);
  const manifest = useCapabilities();
  const officerPortal = manifest.portal.audience === "officer";

  const renderItem = (item: NavItem) => {
    const active = [item.href, ...(item.alsoActiveOn ?? []), ...(item.href === "/settings" && !officerPortal ? ["/trust"] : [])].some((href) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)));
    const Icon = item.icon;
    const capability = item.capability ? manifest.capabilities[item.capability] : undefined;
    const isLocked = capability?.state === "locked";
    const content = <><Icon size={18} />{item.label}{isLocked && <LockKeyhole className="ml-auto" size={14} />}</>;
    if (isLocked) return (
      <span
        aria-disabled="true"
        className="flex h-10 cursor-not-allowed items-center gap-3 rounded-lg px-3 text-sm font-semibold text-muted"
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
          active ? "bg-accent text-white" : "text-muted hover:bg-elevated hover:text-ink"
        )}
        href={item.href}
        key={item.href}
        onClick={() => setOpen(false)}
      >
        {content}
      </Link>
    );
  };

  const sidebar = (
    <aside className="flex h-full w-72 flex-col overflow-y-auto border-r border-border bg-canvas p-4 text-ink">
      <div className="mb-6 flex items-center justify-between">
        <Link className="focus-ring rounded-lg" href="/">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent shadow-lg shadow-accent/30">
              <Flame size={20} />
            </div>
            <div>
              <p className="font-mono text-sm font-bold tracking-[-0.02em]">PYTORCH PH</p>
              <p className="text-xs text-muted">{officerPortal ? "Officer / Developer" : "Member Workspace"}</p>
            </div>
          </div>
        </Link>
        <Button aria-label="Close menu" className="lg:hidden" onClick={() => setOpen(false)} size="icon" type="button" variant="ghost">
          <X size={18} />
        </Button>
      </div>
      <nav aria-label="Portal" className="space-y-1">
        {sharedNavItems.map(renderItem)}
        {officerPortal && <>
          <p className="px-3 pb-1 pt-5 font-mono text-[10px] uppercase tracking-widest text-muted" id="officer-tools-heading">Officer tools</p>
          <div aria-labelledby="officer-tools-heading" className="space-y-1" role="group">{officerNavItems.map(renderItem)}</div>
        </>}
      </nav>
      <div className="mt-6 rounded-lg border border-border bg-elevated p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Current cycle</p>
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
        </div>
        <Progress className="h-1.5 bg-elevated" indicatorClassName="bg-accent" value={68} />
        <p className="mt-2 text-xs text-muted">{officerPortal ? "Community operations and review readiness." : "Personal evidence and career readiness."}</p>
      </div>
      <div className="mt-auto rounded-lg border border-border bg-elevated p-3">
        <div className="mb-2 flex items-center gap-2">
          <Shield className="text-accent" size={16} />
          <p className="text-sm font-semibold">{officerPortal ? "Officer data gateway" : "Personal data gateway"}</p>
        </div>
        <p className="text-xs leading-5 text-muted">{officerPortal ? "Role checks run before officer data or diagnostics are returned." : "Officer diagnostics and operational payloads are excluded from this portal."}</p>
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
    <div className="min-h-screen bg-canvas text-ink">
      {manifest.localDemo && <div className="fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-center border-b border-accent/30 bg-accent px-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white sm:text-xs">Local {officerPortal ? "officer" : "member"} demo · Synthetic data · External actions disabled</div>}
      <header className={cn("sticky z-30 flex h-16 items-center justify-between border-b border-border bg-canvas/90 px-4 backdrop-blur lg:hidden", manifest.localDemo ? "top-8" : "top-0")}>
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
