"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  ChevronDown,
  Flame,
  Github,
  GitBranch,
  Linkedin,
  Quote,
  ShieldCheck,
  Sparkles,
  Trophy,
  Twitter,
  Zap
} from "lucide-react";
import { BrandMark } from "@pytorch-ph/domain-client/public-site";
import { Counter } from "@pytorch-ph/domain-client/public-site";
import { FigmaParticleHero } from "@pytorch-ph/domain-client/public-site";
import { Reveal } from "@pytorch-ph/domain-client/public-site";

const faq = [
  {
    q: "Who can join PyTorch Philippines?",
    a: "Everyone interested in learning, researching, teaching, or building with PyTorch across the Philippines. Students and professionals are welcome; no school affiliation or school email is required."
  },
  {
    q: "How does the leaderboard work?",
    a: "The prototype models ranks from event participation, reviewed achievements, and public-safe activity signals. Private source data is never exposed on public tables."
  },
  {
    q: "What unlocks specialty analytics?",
    a: "General members unlock deeper analytics after at least one community event. Active, Elite, and Officer roles see progressively richer data."
  },
  {
    q: "Does AI post or approve actions automatically?",
    a: "No. AI can draft recommendations and summaries, but humans approve final event posts, awards, and generated artifacts."
  }
];

const testimonials = [
  {
    name: "Camille Aquino",
    role: "Community learner · Demo persona",
    quote: "The community finally feels like an engineering org. Events, skills, and merit all point to one growth path."
  },
  {
    name: "Jared Sison",
    role: "Software developer · Demo persona",
    quote: "Seeing my PyTorch and MLOps bars move after every workshop made progress concrete."
  },
  {
    name: "Mika Domingo",
    role: "Community organizer · Demo persona",
    quote: "Officer planning became easier once events, approvals, and member readiness lived in one place."
  }
];

function Nav() {
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
      {open && (
        <div className="space-y-3 border-t border-border bg-canvas px-6 py-4 md:hidden">
          {["features", "leaderboard", "voices", "faq"].map((section) => (
            <a className="block capitalize text-muted" href={`#${section}`} key={section} onClick={() => setOpen(false)}>
              {section}
            </a>
          ))}
          <Link className="block text-muted" href="/login">Sign in</Link>
          <Link className="block text-accent" href="/register">Get access</Link>
        </div>
      )}
    </header>
  );
}

function Hero() {
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    const onScroll = () => setScroll(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="relative min-h-screen overflow-hidden bg-canvas pt-16">
      <FigmaParticleHero />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(var(--accent-rgb)/.1),transparent_38%)]" style={{ transform: `translateY(${scroll * 0.08}px)` }} />
      <div className="relative mx-auto max-w-7xl px-6 pb-32 pt-24 text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-xs tracking-wider text-ink">
          <Sparkles className="text-accent" size={12} />
          NATIONWIDE PYTORCH COMMUNITY
        </div>
        <h1
          className="font-extrabold leading-[0.95] tracking-[-0.02em] text-ink"
          style={{ fontSize: "clamp(2.5rem, 7vw, 5.5rem)", transform: `translateY(${scroll * -0.05}px)` }}
        >
          PyTorch Philippines
          <br />
          <span className="text-accent">Build. Learn. Connect.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
          A nationwide community for learners, researchers, educators, engineers, and open-source contributors. Build skills, share research, and grow together across the Philippines.
        </p>
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
        <p className="mt-10 text-xs text-muted">Website preview · Community statistics and member stories below are sample data.</p>
        <div className="mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-elevated md:grid-cols-4">
          {[
            { value: 1284, suffix: "", label: "Members" },
            { value: 847, suffix: "", label: "Active weekly" },
            { value: 96, suffix: "%", label: "Retention" },
            { value: 42, suffix: "", label: "Events hosted" }
          ].map((item) => (
            <div className="bg-canvas px-6 py-6 text-left" key={item.label}>
              <div className="text-3xl font-bold text-ink">
                <Counter suffix={item.suffix} to={item.value} />
              </div>
              <div className="mt-1 font-mono text-xs uppercase tracking-widest text-muted">{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { Icon: Trophy, title: "Public-safe leaderboard", desc: "Members rank through verified events, merits, and reviewed activity signals without exposing private raw data." },
    { Icon: Sparkles, title: "Exclusive PyTorch events", desc: "Workshop, hackathon, and peer lab access shaped by community role and activity tier." },
    { Icon: Activity, title: "Specialty analytics", desc: "Per-member radar for Computer Vision, NLP, Optimization, MLOps, and research readiness." },
    { Icon: ShieldCheck, title: "Open nationwide", desc: "Join with your email. Verified accounts and role-based permissions protect community spaces." },
    { Icon: Zap, title: "Priority access", desc: "Active and Elite members receive early signals and priority reservation labels." },
    { Icon: GitBranch, title: "Human-approved AI", desc: "AI drafts recommendations and summaries; officers approve final community actions." }
  ];

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
            <Reveal delay={index * 80} key={feature.title}>
              <div className="group h-full rounded-2xl border border-border bg-gradient-to-b from-white/[0.04] to-transparent p-6 transition-all duration-300 hover:border-accent/40">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 transition group-hover:bg-accent/20">
                  <feature.Icon className="text-accent" size={18} />
                </div>
                <div className="mb-2 text-lg font-semibold text-ink">{feature.title}</div>
                <div className="text-sm leading-7 text-muted">{feature.desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function AltSection({ id, eyebrow, title, body, reverse, children }: { id: string; eyebrow: string; title: string; body: string; reverse?: boolean; children: React.ReactNode }) {
  return (
    <section className="relative border-t border-border bg-canvas py-28" id={id}>
      <div className={`mx-auto grid max-w-7xl items-center gap-16 px-6 md:grid-cols-2 ${reverse ? "md:[direction:rtl]" : ""}`}>
        <Reveal className="md:[direction:ltr]">
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">{eyebrow}</div>
          <h2 className="mb-5 text-3xl font-bold tracking-[-0.02em] text-ink md:text-4xl">{title}</h2>
          <p className="leading-8 text-muted">{body}</p>
        </Reveal>
        <Reveal className="md:[direction:ltr]" delay={120}>
          <div className="rounded-2xl bg-[linear-gradient(135deg,rgb(var(--accent-rgb)/.1),transparent)] p-px">
            <div className="rounded-2xl border border-border bg-surface p-6">{children}</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function LeaderboardPreview() {
  const rows = [
    { rank: 1, name: "Mika_7A82F", score: 982 },
    { rank: 2, name: "Member #18C2A", score: 941 },
    { rank: 3, name: "Daniel_P", score: 918 },
    { rank: 4, name: "Member #4D91B", score: 877 }
  ];

  return (
    <AltSection
      body="The leaderboard categorizes members by skill domain: Computer Vision, NLP, Optimization, MLOps, and research. Rankings use event participation and reviewed public-safe activity scores."
      eyebrow="global leaderboard"
      id="leaderboard"
      title="Specialty rankings, refreshed every cycle."
    >
      <div className="space-y-2 font-mono text-sm">
        {rows.map((member) => (
          <div className="flex items-center justify-between rounded-lg border border-border bg-canvas p-3" key={member.rank}>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-accent/30 bg-accent/15 text-xs text-accent">#{member.rank}</div>
              <span className="text-ink">{member.name}</span>
            </div>
            <span className="text-accent">{member.score}</span>
          </div>
        ))}
      </div>
    </AltSection>
  );
}

function KanbanPreview() {
  return (
    <AltSection
      body="Officers move events through planning, approval, live registration, and concluded states. Drafts and AI summaries remain human-reviewed before dispatch."
      eyebrow="kanban operations"
      id="ops"
      reverse
      title="Run hackathons like an engineering team."
    >
      <div className="grid grid-cols-4 gap-2 font-mono text-[10px]">
        {["Plan", "Approve", "Live", "Done"].map((column, index) => (
          <div className="space-y-1.5" key={column}>
            <div className="uppercase tracking-widest text-muted">{column}</div>
            {Array.from({ length: 2 + (index % 2) }).map((_, taskIndex) => (
              <div className="h-10 rounded border border-border bg-canvas p-1.5 text-muted" key={`${column}-${taskIndex}`}>
                task-{index}{taskIndex}
              </div>
            ))}
          </div>
        ))}
      </div>
    </AltSection>
  );
}

function Testimonials() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((value) => (value + 1) % testimonials.length), 5000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="relative border-t border-border bg-canvas py-32" id="voices">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <div className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">voices from the community</div>
        <Quote className="mx-auto mb-6 text-accent/30" size={48} />
        <div className="relative h-56">
          {testimonials.map((item, itemIndex) => (
            <div className={`absolute inset-0 transition-all duration-700 ${index === itemIndex ? "opacity-100" : "translate-y-4 opacity-0"}`} key={item.name}>
              <p className="text-2xl italic leading-relaxed text-ink">"{item.quote}"</p>
              <div className="mt-6 text-ink">{item.name}</div>
              <div className="font-mono text-sm text-muted">{item.role}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex justify-center gap-2">
          {testimonials.map((item, itemIndex) => (
            <button
              aria-label={`Show ${item.name} testimonial`}
              className={`h-1.5 rounded-full transition-all ${index === itemIndex ? "w-8 bg-accent" : "w-1.5 bg-elevated"}`}
              key={item.name}
              onClick={() => setIndex(itemIndex)}
              type="button"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  const [open, setOpen] = useState(0);

  return (
    <section className="relative border-t border-border bg-canvas py-32" id="faq">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal>
          <div className="mb-12 text-center">
            <div className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">FAQ</div>
            <h2 className="text-4xl font-bold tracking-[-0.02em] text-ink">Frequently asked.</h2>
          </div>
        </Reveal>
        <div className="space-y-2">
          {faq.map((item, index) => (
            <Reveal delay={index * 60} key={item.q}>
              <div className="overflow-hidden rounded-xl border border-border bg-elevated">
                <button
                  className="focus-ring flex w-full items-center justify-between p-5 text-left text-ink transition-all duration-300 hover:bg-elevated"
                  onClick={() => setOpen(open === index ? -1 : index)}
                  type="button"
                >
                  <span>{item.q}</span>
                  <ChevronDown className={`text-accent transition ${open === index ? "rotate-180" : ""}`} size={18} />
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${open === index ? "max-h-40" : "max-h-0"}`}>
                  <div className="px-5 pb-5 text-sm leading-7 text-muted">{item.a}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
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
            {[Github, Linkedin, Twitter].map((Icon, iconIndex) => (
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

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <Nav />
      <Hero />
      <Features />
      <LeaderboardPreview />
      <KanbanPreview />
      <Testimonials />
      <FaqSection />
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
      <Footer />
    </main>
  );
}
