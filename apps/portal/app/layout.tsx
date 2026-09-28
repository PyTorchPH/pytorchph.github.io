import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/components/providers";
import { FeedbackReporter } from "@pytorch-ph/domain-client/privacy-feedback";
import "./globals.css";

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
    <html lang="en" data-scroll-behavior="smooth">
      <body><AppProviders>{children}<FeedbackReporter /></AppProviders></body>
    </html>
  );
}
