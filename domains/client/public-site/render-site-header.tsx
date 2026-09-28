import type { ReactNode } from "react";
import Link from "next/link";
import { PUBLIC_SITE_URL } from "@pytorch-ph/domain-protocol/organization";
import { cn } from "@pytorch-ph/design-system/merge-classes";
import { BrandMark } from "./render-brand";

const SITE_ROOT = PUBLIC_SITE_URL.replace(/\/+$/, "");

// Same order as the public site's main menu.
const siteLinks = [
  { label: "Community", path: "/" },
  { label: "News & Blog", path: "/news/" },
  { label: "Learn", path: "/learn/" },
  { label: "About", path: "/about/" },
];

// The dark header of the public site, so the portal and pytorch.ph read as one website.
// `start` and `end` hold page controls, such as the menu button on small screens.
export function SiteHeader({ className, end, start }: { className?: string; end?: ReactNode; start?: ReactNode }) {
  return (
    <header className={cn("on-dark z-40 flex h-16 items-center gap-3 bg-chrome px-4 sm:px-6 lg:h-20 lg:px-8", className)}>
      {start}
      <BrandMark tone="onDark" />
      <nav aria-label="PyTorch Philippines" className="ml-auto hidden items-center gap-8 lg:flex">
        {siteLinks.map((link) => <a className="focus-ring text-base text-ink transition-colors hover:text-accent" href={`${SITE_ROOT}${link.path}`} key={link.path}>{link.label}</a>)}
        <Link aria-current="page" className="focus-ring text-base text-accent" href="/dashboard">Member Portal</Link>
      </nav>
      {end && <div className="ml-auto flex items-center gap-2 lg:ml-0">{end}</div>}
    </header>
  );
}
