"use client";

import { useEffect, type ReactNode } from "react";
import { enterAs, useDemoAudience } from "./demo-api";

// Officer tools are officer-only routes, so a direct visit switches the demo to the example officer.
export function OfficerOnly({ path, children }: { path: string; children: ReactNode }) {
  const audience = useDemoAudience();
  useEffect(() => {
    if (audience === "member") enterAs("officer", path);
  }, [audience, path]);
  return audience === "officer" ? <>{children}</> : null;
}
