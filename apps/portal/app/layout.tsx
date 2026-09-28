import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/components/providers";
import { FeedbackReporter } from "@pytorch-ph/domain-client/privacy-feedback";
import { fontVariables } from "./fonts";
import "./globals.css";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "PyTorch Philippines",
  description: "A nationwide community for PyTorch learning, research, career growth, and collaboration across the Philippines.",
  // Installable on phones and desktops; paths in the manifest are relative to it.
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "PyTorch PH", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#262626" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={fontVariables} data-scroll-behavior="smooth" lang="en" style={{ "--hero-art": `url(${BASE_PATH}/brand/ph-network.svg)` } as React.CSSProperties}>
      <body><AppProviders>{children}<FeedbackReporter /></AppProviders></body>
    </html>
  );
}
