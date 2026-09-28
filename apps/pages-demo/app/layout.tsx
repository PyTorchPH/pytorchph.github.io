import type { Metadata, Viewport } from "next";
import { AppProviders } from "../../portal/components/providers";
import { FeedbackReporter } from "@pytorch-ph/domain-client/privacy-feedback";
import { DemoApiProvider } from "./demo-api";
import { fontVariables } from "../../portal/app/fonts";
import "../../portal/app/globals.css";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "PyTorch Philippines — Demo",
  description: "Explore the PyTorch Philippines community platform with fictional example accounts and sample data.",
  robots: { index: false, follow: false },
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: { icon: `${BASE_PATH}/icons/icon-192.png`, apple: `${BASE_PATH}/icons/apple-touch-icon.png` },
  appleWebApp: { capable: true, title: "PyTorch PH", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#262626" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html className={fontVariables} data-scroll-behavior="smooth" lang="en" style={{ "--hero-art": `url(${BASE_PATH}/brand/ph-network.svg)` } as React.CSSProperties}><body>
    <DemoApiProvider />
    <AppProviders>{children}<FeedbackReporter /></AppProviders>
  </body></html>;
}
