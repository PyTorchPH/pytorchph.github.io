"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@pytorch-ph/design-system/button";

const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/$/, "");
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  return <>
    <Button className="mt-2 w-full justify-start gap-3" onClick={async () => {
      setError("");
      try {
        if (API_ORIGIN) {
          const response = await fetch(`${API_ORIGIN}/auth/signout`, { method: "POST", credentials: "include", cache: "no-store" });
          if (!response.ok) throw new Error("Sign out failed. Please try again.");
        }
        if (!API_ORIGIN || STATIC_DEMO) {
          const response = await fetch("/api/auth/signout", { method: "POST" });
          if (!response.ok) throw new Error("Sign out failed. Please try again.");
        }
        router.replace("/login");
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Sign out failed. Please try again.");
      }
    }} type="button" variant="ghost"><LogOut size={18} />Sign out</Button>
    {error && <p role="alert" className="px-3 text-xs text-accent">{error}</p>}
  </>;
}
