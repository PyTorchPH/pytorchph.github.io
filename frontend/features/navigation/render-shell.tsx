"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Home,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  Menu,
  MessageCircle,
  Network,
  Search,
  Settings,
  Shield,
  Trophy,
  UserCheck,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { CapabilityKey } from "@pytorch-ph/domain-protocol/identity";
import { cn } from "@pytorch-ph/design-system/merge-classes";
import { CapabilityProvider, useCapabilities } from "@pytorch-ph/domain-client/onboarding";
import { ProductTourController, requestProductTour, useHasProductTour } from "@pytorch-ph/domain-client/onboarding";
import { SignOutButton } from "@pytorch-ph/domain-client/identity";
import { useProfileGate } from "@pytorch-ph/domain-client/member-profile";
import { Button } from "@pytorch-ph/design-system/button";
import { Sheet } from "@pytorch-ph/design-system/sheet";
import { Progress } from "@pytorch-ph/design-system/progress";
import { SiteHeader } from "@pytorch-ph/domain-client/public-site";

const SIDEBAR_KEY = "pytorch-ph-sidebar";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; capability?: CapabilityKey; alsoActiveOn?: string[] };

// Members and officers share these pages.
const sharedNavItems: NavItem[] = [
  { href: "/dashboard", label: "My Performance", icon: Home },
  { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { href: "/career/evidence", label: "Career Evidence", icon: UserRound },
  { href: "/career/resumes", label: "Resumes & Opportunities", icon: BriefcaseBusiness, alsoActiveOn: ["/jobs/opportunities", "/jobs/analytics", "/jobs/automation"] },
  { href: "/events", label: "Community Events", icon: CalendarDays },
  { href: "/dashboard/community", label: "Community Preview", icon: MessageCircle },
  { href: "/dashboard/profile", label: "My Profile", icon: UserCheck },
  { href: "/settings", label: "Settings & Privacy", icon: Settings, alsoActiveOn: ["/trust", "/setup"] },
];

// Officers get these in addition: configuration and the workflows they run.
const officerNavItems: NavItem[] = [
  { href: "/admin/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/admin/events", label: "Event Workflow", icon: ClipboardList },
  { href: "/admin/organization", label: "Organization", icon: Network },
  { href: "/admin/mail", label: "Email Drafts", icon: Mail },
  { href: "/admin/evidence", label: "Evidence Review", icon: Search },
  { href: "/reports", label: "Reports & Feedback", icon: Bot },
];

function AppShellContent({ children }: { children: React.ReactNode }) {
  // Static hosting serves routes with a trailing slash; navigation links are written without one.
  const pathname = usePathname().replace(/\/+$/, "") || "/";
  // Members who have not finished "Complete your profile" are sent to /onboarding first.
  useProfileGate(pathname);
  const [open, setOpen] = useState(false);
  // Desktop only: the sidebar can be collapsed; the choice is remembered in this browser.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "collapsed"); } catch { /* storage unavailable */ } }, []);
  const toggleSidebar = () => setCollapsed((current) => {
    const next = !current;
    try { localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open"); } catch { /* storage unavailable */ }
    return next;
  });
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
          <p className="data-label text-sm uppercase text-accent">Member portal</p>
          <p className="mt-1 text-sm text-muted">{officerPortal ? "Your progress, plus officer tools" : "Your progress in the community"}</p>
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
      <SignOutButton />
    </aside>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader
        className="sticky top-0"
        start={<Button aria-label="Open menu" className="lg:hidden" onClick={() => setOpen(true)} size="icon" type="button" variant="secondary"><Menu size={18} /></Button>}
      />
      <div className={cn("hidden lg:fixed lg:bottom-0 lg:left-0 lg:top-20", collapsed ? "lg:hidden" : "lg:block")}>{sidebar}</div>
      <button aria-expanded={!collapsed} aria-label={collapsed ? "Open sidebar" : "Close sidebar"} className={cn("focus-ring fixed top-24 z-40 hidden h-10 w-6 items-center justify-center border border-l-0 border-border bg-surface text-muted shadow-md hover:text-accent lg:flex", collapsed ? "left-0" : "left-72")} onClick={toggleSidebar} title={collapsed ? "Open sidebar" : "Close sidebar"} type="button">{collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronLeft aria-hidden="true" size={16} />}</button>
      <Sheet onOpenChange={setOpen} open={open}>{sidebar}</Sheet>
      <main className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-6" : "lg:pl-72")}>
        <div className="relative mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
          {/* Sits in the top-right corner of the page hero that follows it. */}
          {hasTour && <div className="on-dark absolute right-4 top-3 z-10 sm:right-6 lg:right-8 lg:top-4" data-page-tour>
            <Button aria-label="Replay page tour" data-tour="tour-help" onClick={requestProductTour} size="sm" title="Show the tour of this page again" type="button" variant="outline"><CircleHelp aria-hidden="true" size={16} />Page tour</Button>
          </div>}
          {children}
        </div>
      </main>
      <ProductTourController />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <CapabilityProvider><AppShellContent>{children}</AppShellContent></CapabilityProvider>;
}
