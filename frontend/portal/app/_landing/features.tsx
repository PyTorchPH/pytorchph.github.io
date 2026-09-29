// Capabilities grid.
// Module map (caller-first):
//   Features     heading plus the feature cards
//   FeatureCard  one capability with its icon

import type { LucideIcon } from "lucide-react";
import { Activity, GitBranch, ShieldCheck, Sparkles, Trophy, Zap } from "lucide-react";
import { Reveal } from "@pytorch-ph/domain-client/public-site";

type Feature = { Icon: LucideIcon; title: string; desc: string };

const features: Feature[] = [
  { Icon: Trophy, title: "Public-safe leaderboard", desc: "Members rank through verified events, merits, and reviewed activity signals without exposing private raw data." },
  { Icon: Sparkles, title: "Exclusive PyTorch events", desc: "Workshop, hackathon, and peer lab access shaped by community role and activity tier." },
  { Icon: Activity, title: "Specialty analytics", desc: "Per-member radar for Computer Vision, NLP, Optimization, MLOps, and research readiness." },
  { Icon: ShieldCheck, title: "Open nationwide", desc: "Join with your email. Verified accounts and role-based permissions protect community spaces." },
  { Icon: Zap, title: "Priority access", desc: "Active and Elite members receive early signals and priority reservation labels." },
  { Icon: GitBranch, title: "Human-approved AI", desc: "AI drafts recommendations and summaries; officers approve final community actions." }
];

const REVEAL_STEP_MS = 80;

export function Features() {
  return (
    <section className="relative border-t border-border bg-canvas py-32" id="features">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal>
          <div className="mb-16 text-center">
            <div className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">capabilities</div>
            <h2 className="text-4xl font-bold tracking-[-0.02em] text-ink md:text-5xl">
              One community to learn, build,
              <br />
              and grow together.
            </h2>
          </div>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <Reveal delay={index * REVEAL_STEP_MS} key={feature.title}>
              <FeatureCard feature={feature} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <div className="group h-full rounded-2xl border border-border bg-gradient-to-b from-white/[0.04] to-transparent p-6 transition-all duration-300 hover:border-accent/40">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 transition group-hover:bg-accent/20">
        <feature.Icon className="text-accent" size={18} />
      </div>
      <div className="mb-2 text-lg font-semibold text-ink">{feature.title}</div>
      <div className="text-sm leading-7 text-muted">{feature.desc}</div>
    </div>
  );
}
