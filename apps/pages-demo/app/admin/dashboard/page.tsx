"use client";

import { useEffect } from "react";
import { DashboardCommandCenter } from "@pytorch-ph/domain-client/organization";
import { enterAs, useDemoAudience } from "../../demo-api";

// Officer Admin is an officer-only route, so a direct visit switches to the example officer.
export default function AdminDashboardPage() {
  const audience = useDemoAudience();
  useEffect(() => {
    if (audience === "member") enterAs("officer", "/admin/dashboard/");
  }, [audience]);
  return audience === "officer" ? <DashboardCommandCenter /> : null;
}
