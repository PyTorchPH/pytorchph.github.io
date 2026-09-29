import type { ReactNode } from "react";
import { FilipinoPhrase } from "@pytorch-ph/design-system/filipino-phrase";
import { SiteHeader } from "@pytorch-ph/domain-client/public-site";

// Sign-in and registration pages: the public site's header, its dark hero beside the form.
export function AuthShell({ children, title, sub }: { children: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <SiteHeader />
      <div className="flex flex-1 flex-col lg:flex-row">
        <section aria-label="About PyTorch Philippines" className="hero-panel hidden flex-1 flex-col justify-center p-12 lg:flex xl:p-16">
          <FilipinoPhrase className="mb-3 text-lg" meaning="Come in. You are welcome here." phrase="Tuloy po kayo" />
          <p className="hero-title max-w-[16ch] text-[2.75rem] xl:text-[3.25rem]">Empowering the next generation of builders.</p>
          <p className="mt-6 max-w-md text-lg leading-8 text-ink">
            PyTorch Philippines connects learners, researchers, educators, engineers, and community organizers nationwide. No school affiliation is required.
          </p>
        </section>
        <div className="flex flex-1 items-center justify-center p-6 py-10">
          <div className="w-full max-w-md">
            <FilipinoPhrase className="mb-4 lg:hidden" meaning="Come in. You are welcome here." phrase="Tuloy po kayo" />
            <div className="mb-2 font-heading text-xs font-semibold uppercase tracking-[0.14em] text-accent">{sub}</div>
            <h1 className="mb-8 text-3xl text-ink">{title}</h1>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
