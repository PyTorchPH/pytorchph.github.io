"use client";

import { enterAs, useDemoAudience } from "./demo-api";

const option = "focus-ring rounded-lg border px-3 py-2 text-sm font-semibold transition-colors";

export function DemoAccounts() {
  const audience = useDemoAudience();
  if (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN) return null;
  const style = (active: boolean) => `${option} ${active ? "border-accent bg-accent/10 text-ink" : "border-border bg-elevated text-ink hover:border-accent"}`;
  return <section aria-label="Example accounts" className="mt-6 border-t border-border pt-5">
    <p className="mb-3 text-sm text-muted">Explore fictional, read-only member and officer views.</p>
    <div className="grid grid-cols-2 gap-2">
      <button aria-pressed={audience === "member"} className={style(audience === "member")} onClick={() => enterAs("member")} type="button">Use example member</button>
      <button aria-pressed={audience === "officer"} className={style(audience === "officer")} onClick={() => enterAs("officer")} type="button">Use example officer</button>
    </div>
  </section>;
}
