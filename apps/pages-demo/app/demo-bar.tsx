"use client";

import { enterAs, useDemoAudience } from "./demo-api";

const option = "focus-ring rounded-md border px-2.5 py-1 font-semibold transition-colors";

export function DemoBar() {
  const audience = useDemoAudience();
  const style = (active: boolean) => `${option} ${active ? "border-orange-400/70 bg-orange-500/20 text-orange-100" : "border-orange-500/30 text-orange-200/80 hover:bg-orange-500/10"}`;
  return <aside className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-orange-500/30 bg-[#17100b]/95 px-4 py-2 text-center text-xs text-orange-100 backdrop-blur" aria-label="Demo notice">
    <span>Demo only · Fictional accounts and sample data · No real signup, payments, or submissions</span>
    <span className="flex gap-2">
      <button className={style(audience === "member")} onClick={() => enterAs("member")} type="button">Use example member</button>
      <button className={style(audience === "officer")} onClick={() => enterAs("officer")} type="button">Use example officer</button>
    </span>
  </aside>;
}
