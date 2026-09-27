import { DashboardCommandCenter } from "@pytorch-ph/domain-client/organization";
import { MemberDashboard } from "@pytorch-ph/domain-client/leaderboards";
import { portalAudience } from "@pytorch-ph/domain-server/identity";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return await portalAudience() === "officer" ? <DashboardCommandCenter /> : <MemberDashboard />;
}
