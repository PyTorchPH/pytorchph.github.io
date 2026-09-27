"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The public site lives at the Pages root; the portal demo starts at its login screen.
export default function PortalEntryPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login/");
  }, [router]);
  return <main className="flex min-h-screen items-center justify-center p-6 text-sm">
    <Link className="underline" href="/login/">Continue to the PyTorch Philippines member portal</Link>
  </main>;
}
