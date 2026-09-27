import type { Metadata } from "next";
import { AppProviders } from "@/components/providers";
import { FeedbackReporter } from "@pytorch-ph/domain-client/privacy-feedback";
import "./globals.css";

export const metadata: Metadata = {
  title: "PyTorch Philippines",
  description: "A nationwide community for PyTorch learning, research, career growth, and collaboration across the Philippines."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body><AppProviders>{children}<FeedbackReporter /></AppProviders></body>
    </html>
  );
}
