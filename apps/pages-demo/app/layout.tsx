import type { Metadata } from "next";
import { AppProviders } from "../../portal/components/providers";
import { FeedbackReporter } from "@pytorch-ph/domain-client/privacy-feedback";
import { DemoBar } from "./demo-bar";
import "../../portal/app/globals.css";

export const metadata: Metadata = {
  title: "PyTorch Philippines — Demo",
  description: "Explore the PyTorch Philippines community platform with fictional example accounts and sample data.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth"><body className="pb-24 sm:pb-14">
    <AppProviders>{children}<FeedbackReporter /></AppProviders>
    <DemoBar />
  </body></html>;
}
