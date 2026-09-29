"use client";

// Public landing page, composed top to bottom from ./_landing.
// Module map:
//   Nav, Hero, Features, LeaderboardPreview, KanbanPreview, Testimonials, FaqSection,
//   JoinCallToAction, Footer

import { JoinCallToAction, Footer } from "./_landing/closing";
import { FaqSection } from "./_landing/faq";
import { Features } from "./_landing/features";
import { Hero } from "./_landing/hero";
import { Nav } from "./_landing/nav";
import { KanbanPreview, LeaderboardPreview } from "./_landing/previews";
import { Testimonials } from "./_landing/testimonials";

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
      <JoinCallToAction />
      <Footer />
    </main>
  );
}
