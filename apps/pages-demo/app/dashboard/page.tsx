"use client";

import { MemberDashboard } from "@pytorch-ph/domain-client/leaderboards";
import { DashboardCommandCenter } from "@pytorch-ph/domain-client/organization";
import { useDemoAudience } from "../demo-api";

// Mirrors the portal's /dashboard, which picks the view from the signed-in audience.
export default function DashboardPage() {
  const audience = useDemoAudience();
  if (!audience) return null;
  return audience === "officer" ? <DashboardCommandCenter /> : <MemberDashboard />;
}
