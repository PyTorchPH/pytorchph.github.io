"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CircleHelp,
  ClipboardList,
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
import { ProductTourController, requestProductTour, useHasProductTour } from "@pytorch-ph/domain-client/onboarding";
import { SignOutButton } from "@pytorch-ph/domain-client/identity";
import { Button } from "@pytorch-ph/design-system/button";
import { Sheet } from "@pytorch-ph/design-system/sheet";
import { Progress } from "@pytorch-ph/design-system/progress";
import { SiteHeader } from "@pytorch-ph/domain-client/public-site";

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
  { href: "/settings", label: "Settings & Privacy", icon: Settings, alsoActiveOn: ["/trust", "/setup"] },
];

// Officers get these in addition: configuration and the workflows they run.
const officerNavItems: NavItem[] = [
  { href: "/admin/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/admin/events", label: "Event Workflow", icon: ClipboardList },
  { href: "/admin/evidence", label: "Evidence Review", icon: Search },
  { href: "/reports", label: "Reports & Feedback", icon: Bot },
  { href: "/connections", label: "Connections", icon: Unplug, capability: "connections" },
];

function AppShellContent({ children }: { children: React.ReactNode }) {
  // Static hosting serves routes with a trailing slash; navigation links are written without one.
  const pathname = usePathname().replace(/\/+$/, "") || "/";
  const [open, setOpen] = useState(false);
  const manifest = useCapabilities();
  const officerPortal = manifest.portal.audience === "officer";
  const hasTour = useHasProductTour();

  const renderItem = (item: NavItem) => {
    const active = [item.href, ...(item.alsoActiveOn ?? [])].some((href) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)));
    const Icon = item.icon;
    const capability = item.capability ? manifest.capabilities[item.capability] : undefined;
    const isLocked = capability?.state === "locked";
    const content = <><Icon aria-hidden="true" size={17} />{item.label}{isLocked && <LockKeyhole aria-hidden="true" className="ml-auto" size={14} />}</>;
    const row = "flex min-h-10 items-center gap-3 border-l-[3px] py-2 pl-3 pr-2 text-[15px]";
    if (isLocked) return (
      <span
        aria-disabled="true"
        className={cn(row, "cursor-not-allowed border-transparent text-muted")}
        key={item.href}
        title={capability.reason}
      >
        {content}
      </span>
    );
    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={cn(
          "focus-ring transition-colors duration-200",
          row,
          active ? "border-accent bg-surface font-semibold text-accent" : "border-transparent text-ink hover:text-accent"
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
    <aside className="flex h-full w-72 flex-col overflow-y-auto border-r border-border bg-canvas px-4 py-6 text-ink">
      <div className="mb-5 flex items-start justify-between gap-2 px-1">
        <div>
          <p className="data-label text-sm uppercase text-accent">{officerPortal ? "Officer portal" : "Member portal"}</p>
          <p className="mt-1 text-sm text-muted">{officerPortal ? "Community operations and your own progress" : "Your progress in the community"}</p>
        </div>
        <Button aria-label="Close menu" className="lg:hidden" onClick={() => setOpen(false)} size="icon" type="button" variant="ghost">
          <X size={18} />
        </Button>
      </div>
      <nav aria-label="Portal" className="space-y-0.5">
        {sharedNavItems.map(renderItem)}
        {officerPortal && <>
          <p className="data-label px-4 pb-2 pt-6 text-xs uppercase text-accent" id="officer-tools-heading">Officer tools</p>
          <div aria-labelledby="officer-tools-heading" className="space-y-0.5" role="group">{officerNavItems.map(renderItem)}</div>
        </>}
      </nav>
      <div className="mt-6 bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="data-label text-[11px] uppercase text-muted">Current cycle</p>
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
        </div>
        <Progress className="h-1 bg-elevated" indicatorClassName="bg-accent" value={68} />
        <p className="mt-2 text-xs text-muted">{officerPortal ? "Community operations and review readiness." : "Personal evidence and career readiness."}</p>
      </div>
      <div className="mt-auto bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <Shield aria-hidden="true" className="text-accent" size={16} />
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
      {manifest.localDemo && <div className="on-dark fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-center border-b border-accent bg-chrome px-3 text-center font-heading text-[10px] font-semibold uppercase tracking-[0.14em] sm:text-xs">Local {officerPortal ? "officer" : "member"} demo · Synthetic data · External actions disabled</div>}
      <SiteHeader
        className={cn("sticky", manifest.localDemo ? "top-8" : "top-0")}
        end={hasTour && <Button aria-label="Replay page tour" data-tour="tour-help" onClick={requestProductTour} size="sm" title="Show the tour of this page again" type="button" variant="outline"><CircleHelp aria-hidden="true" size={16} /><span className="hidden sm:inline">Page tour</span></Button>}
        start={<Button aria-label="Open menu" className="lg:hidden" onClick={() => setOpen(true)} size="icon" type="button" variant="secondary"><Menu size={18} /></Button>}
      />
      <div className={cn("hidden lg:fixed lg:bottom-0 lg:left-0 lg:block", manifest.localDemo ? "lg:top-28" : "lg:top-20")}>{sidebar}</div>
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
