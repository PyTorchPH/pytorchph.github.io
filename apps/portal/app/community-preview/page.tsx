import { PUBLIC_SITE_URL } from "@pytorch-ph/domain-protocol/organization";
import { CommunityDemoContent } from "../dashboard/community/page";

export const metadata = {
  title: "PyTorch PH Community Preview",
  description: "Explore the proposed PyTorch PH community channels and event paths with sample profiles.",
};

export default function PublicCommunityPreviewPage() {
  return <main className="min-h-screen bg-canvas text-ink">
    <header className="border-b border-border"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4"><a aria-label="PyTorch PH: go to the pytorch.ph home page" className="font-mono text-sm font-bold tracking-wide text-accent" href={PUBLIC_SITE_URL}>PYTORCH PH</a><a className="text-sm text-muted hover:text-foreground" href={PUBLIC_SITE_URL}>Back to website</a></div></header>
    <div className="mx-auto max-w-7xl px-5 py-8 lg:py-10"><CommunityDemoContent /></div>
  </main>;
}
