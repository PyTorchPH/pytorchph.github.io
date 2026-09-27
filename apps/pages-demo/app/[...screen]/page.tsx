import { DemoAccess, DemoWorkspace } from "../demo";
import { MemberDashboard } from "@pytorch-ph/domain-client/leaderboards";
import { DashboardCommandCenter } from "@pytorch-ph/domain-client/organization";

export function generateStaticParams() {
  return ["login", "register", "dashboard", "events", "leaderboards", "dashboard/profile", "admin/dashboard"].map(path => ({ screen: path.split("/") }));
}

export default async function Page({ params }: { params: Promise<{ screen: string[] }> }) {
  const path = (await params).screen.join("/");
  if (path === "login" || path === "register") return <DemoAccess createAccount={path === "register"} />;
  if (path === "dashboard") return <MemberDashboard />;
  if (path === "admin/dashboard") return <DashboardCommandCenter />;
  return <DemoWorkspace screen={path} />;
}
