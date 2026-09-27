import { DemoAccess, DemoWorkspace } from "../demo";

export function generateStaticParams() {
  return ["login", "register", "dashboard", "events", "leaderboards", "dashboard/profile", "admin/dashboard"].map(path => ({ screen: path.split("/") }));
}

export default async function Page({ params }: { params: Promise<{ screen: string[] }> }) {
  const path = (await params).screen.join("/");
  if (path === "login" || path === "register") return <DemoAccess createAccount={path === "register"} />;
  return <DemoWorkspace screen={path} />;
}
