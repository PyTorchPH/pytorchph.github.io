"use client";

// Fixed top navigation with a collapsible mobile menu.
// Module map (caller-first):
//   Nav         brand, section links, sign-in actions and the mobile toggle
//   MobileMenu  section links and sign-in actions for small screens

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BrandMark } from "@pytorch-ph/domain-client/public-site";
import { sectionAnchors } from "./content";

// Mental model: desktop shows everything inline; on mobile one toggle reveals the same links.
export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-canvas/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <BrandMark />
        <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
          <a className="focus-ring rounded-lg hover:text-accent" href="#features">Features</a>
          <a className="focus-ring rounded-lg hover:text-accent" href="#leaderboard">Leaderboard</a>
          <a className="focus-ring rounded-lg hover:text-accent" href="#voices">Voices</a>
          <a className="focus-ring rounded-lg hover:text-accent" href="#faq">FAQ</a>
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <Link className="focus-ring rounded-lg text-sm text-muted hover:text-ink" href="/login">Sign in</Link>
          <Link
            className="focus-ring rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white shadow-lg shadow-accent/30 transition-all duration-300 hover:bg-accent/90"
            href="/register"
          >
            Get access
          </Link>
        </div>
        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="focus-ring rounded-lg text-ink md:hidden"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <ChevronDown className={`transition ${open ? "rotate-180" : ""}`} size={20} />
        </button>
      </div>
      {open && <MobileMenu onNavigate={() => setOpen(false)} />}
    </header>
  );
}

function MobileMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="space-y-3 border-t border-border bg-canvas px-6 py-4 md:hidden">
      {sectionAnchors.map((section) => (
        <a className="block capitalize text-muted" href={`#${section}`} key={section} onClick={onNavigate}>
          {section}
        </a>
      ))}
      <Link className="block text-muted" href="/login">Sign in</Link>
      <Link className="block text-accent" href="/register">Get access</Link>
    </div>
  );
}
