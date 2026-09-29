import { SiteHeader } from "@pytorch-ph/domain-client/public-site";
import { CommunityDemoContent } from "../dashboard/community/page";

export const metadata = {
  title: "PyTorch PH Community Preview",
  description: "Explore the proposed PyTorch PH community channels and event paths with sample profiles.",
};

export default function PublicCommunityPreviewPage() {
  return <div className="min-h-screen bg-canvas text-ink">
    <SiteHeader />
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><CommunityDemoContent /></main>
  </div>;
}
