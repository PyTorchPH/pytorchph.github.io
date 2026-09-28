"use client";

import { enterAs, useDemoAudience } from "./demo-api";

const option = "focus-ring border px-2.5 py-1 font-semibold transition-colors";

export function DemoBar() {
  const audience = useDemoAudience();
  const style = (active: boolean) => `${option} ${active ? "border-white bg-white text-[#262626]" : "border-white/60 text-white hover:bg-white/10"}`;
  return <aside className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t-2 border-accent bg-[#262626] px-4 py-2 text-center text-xs text-white" aria-label="Demo notice">
    <span>Sample views<span className="hidden sm:inline"> · Example member/officer data is read-only · Real account signup uses the API</span><span className="sm:hidden"> · Example data is not saved</span></span>
    <span className="flex gap-2">
      <button aria-pressed={audience === "member"} className={style(audience === "member")} onClick={() => enterAs("member")} type="button">Use example member</button>
      <button aria-pressed={audience === "officer"} className={style(audience === "officer")} onClick={() => enterAs("officer")} type="button">Use example officer</button>
    </span>
  </aside>;
}
