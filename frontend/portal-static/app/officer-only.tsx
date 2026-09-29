"use client";

import { useEffect, useState, type ReactNode } from "react";
import { enterAs, useDemoAudience } from "./demo-api";

// Officer tools are officer-only routes, so a direct visit switches the demo to the example officer.
export function OfficerOnly({ path, children }: { path: string; children: ReactNode }) {
  const audience = useDemoAudience();
  const [verified, setVerified] = useState(false);
  const apiOrigin = process.env.NEXT_PUBLIC_AUTH_API_ORIGIN;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  useEffect(() => {
    if (!apiOrigin) {
      if (audience === "member") enterAs("officer", path);
      return;
    }
    const controller = new AbortController();
    void fetch(`${apiOrigin}/auth/me`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) { window.location.assign(`${basePath}/login/`); return; }
        const viewer = await response.json() as { role: string };
        if (viewer.role !== "officer" && viewer.role !== "admin") { window.location.assign(`${basePath}/dashboard/`); return; }
        // The server session decides the role, so a new tab needs no client-side audience switch.
        setVerified(true);
      })
      .catch(() => { if (!controller.signal.aborted) window.location.assign(`${basePath}/login/`); });
    return () => controller.abort();
  }, [apiOrigin, audience, basePath, path]);
  return (apiOrigin ? verified : audience === "officer") ? <>{children}</> : null;
}
