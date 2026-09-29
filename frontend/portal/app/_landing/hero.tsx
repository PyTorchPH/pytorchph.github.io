"use client";

// Opening hero with a light parallax, calls to action and sample community counters.
// Module map (caller-first):
//   Hero             particles, headline, actions and the stats strip
//   useScrollOffset  the window's vertical scroll, for the parallax
//   HeroActions      join and explore buttons
//   HeroStats        animated sample counters

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Counter, FigmaParticleHero } from "@pytorch-ph/domain-client/public-site";
import { heroStats } from "./content";

const GLOW_PARALLAX = 0.08;
const HEADLINE_PARALLAX = -0.05;

// Mental model: background and headline drift at different speeds as the page scrolls.
export function Hero() {
  const scroll = useScrollOffset();

  return (
    <section className="relative min-h-screen overflow-hidden bg-canvas pt-16">
      <FigmaParticleHero />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(var(--accent-rgb)/.1),transparent_38%)]" style={{ transform: `translateY(${scroll * GLOW_PARALLAX}px)` }} />
      <div className="relative mx-auto max-w-7xl px-6 pb-32 pt-24 text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-xs tracking-wider text-ink">
          <Sparkles className="text-accent" size={12} />
          NATIONWIDE PYTORCH COMMUNITY
        </div>
        <h1
          className="font-extrabold leading-[0.95] tracking-[-0.02em] text-ink"
          style={{ fontSize: "clamp(2.5rem, 7vw, 5.5rem)", transform: `translateY(${scroll * HEADLINE_PARALLAX}px)` }}
        >
          PyTorch Philippines
          <br />
          <span className="text-accent">Build. Learn. Connect.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
          A nationwide community for learners, researchers, educators, engineers, and open-source contributors. Build skills, share research, and grow together across the Philippines.
        </p>
        <HeroActions />
        <p className="mt-10 text-xs text-muted">Website preview · Community statistics and member stories below are sample data.</p>
        <HeroStats />
      </div>
    </section>
  );
}

function useScrollOffset() {
  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    const onScroll = () => setScroll(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scroll;
}

function HeroActions() {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
      <Link
        className="focus-ring group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent px-6 py-3 text-white shadow-2xl shadow-accent/40 transition-all duration-300 hover:shadow-accent/70"
        href="/register"
      >
        Join PyTorch Philippines
        <ArrowRight className="transition group-hover:translate-x-1" size={16} />
      </Link>
      <Link className="focus-ring inline-flex items-center gap-2 rounded-xl border border-border px-6 py-3 text-ink transition-all duration-300 hover:bg-elevated" href="/dashboard">
        Explore the system
      </Link>
    </div>
  );
}

function HeroStats() {
  return (
    <div className="mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-elevated md:grid-cols-4">
      {heroStats.map((item) => (
        <div className="bg-canvas px-6 py-6 text-left" key={item.label}>
          <div className="text-3xl font-bold text-ink">
            <Counter suffix={item.suffix} to={item.value} />
          </div>
          <div className="mt-1 font-mono text-xs uppercase tracking-widest text-muted">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
