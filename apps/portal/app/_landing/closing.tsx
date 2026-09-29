// The page's closing call to action and footer.
// Module map:
//   JoinCallToAction  final "join the community" band
//   Footer            brand, social links, product links and community notes

import Link from "next/link";
import { ArrowRight, Flame, Github, Linkedin, Twitter } from "lucide-react";

const socialIcons = [Github, Linkedin, Twitter];

export function JoinCallToAction() {
  return (
    <section className="relative overflow-hidden border-t border-border bg-canvas py-32">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--accent-rgb)/.1),transparent)]" />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-4xl font-extrabold leading-tight tracking-[-0.02em] text-ink md:text-6xl">
          Your community. Your growth.
          <br />
          <span className="text-accent">Your trajectory.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-muted">
          Join with your email and connect with people learning and building across the Philippines. No school affiliation required.
        </p>
        <Link
          className="focus-ring mt-10 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent px-7 py-3.5 text-white shadow-2xl shadow-accent/50 transition-all duration-300 hover:scale-[1.02]"
          href="/register"
        >
          Join the community <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border bg-canvas pb-3">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent">
              <Flame className="text-white" size={18} />
            </div>
            <div className="font-mono text-ink">PYTORCH PH</div>
          </div>
          <p className="max-w-md text-sm leading-7 text-muted">
            Community-led learning, research, and collaboration across the Philippines. Open to every background and experience level.
          </p>
          <div className="mt-6 flex gap-3">
            {socialIcons.map((Icon, iconIndex) => (
              <a className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted transition-all duration-300 hover:border-accent/30 hover:text-accent" href="#" key={iconIndex}>
                <Icon size={15} />
              </a>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-ink">Product</div>
          <div className="space-y-2 text-sm text-muted">
            <Link className="block hover:text-accent" href="/dashboard">Dashboard</Link>
            <Link className="block hover:text-accent" href="/leaderboards">Leaderboards</Link>
            <Link className="block hover:text-accent" href="/events">Events</Link>
            <Link className="block hover:text-accent" href="/dashboard/profile">Profile</Link>
          </div>
        </div>
        <div>
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-ink">Community</div>
          <div className="space-y-2 text-sm text-muted">
            <div>Independent, nationwide community</div>
            <div>Luzon · Visayas · Mindanao</div>
            <a className="block hover:text-accent" href="https://github.com/PyTorchPH">github.com/PyTorchPH</a>
          </div>
        </div>
      </div>
      <div className="border-t border-border py-6 text-center font-mono text-xs text-muted">
        Copyright 2026 PyTorch Philippines. Built by the community, for the community.
      </div>
    </footer>
  );
}
