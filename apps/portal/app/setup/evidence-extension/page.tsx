import Image from "next/image";
import { Puzzle, ShieldCheck } from "lucide-react";
import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";

const steps = [
  ["Build the extension", "Run npm run build --workspace @pytorch-ph/evidence-extension from the repository root.", "/setup/evidence-extension/build.svg"],
  ["Open Chrome extensions", "Enter chrome://extensions in Chrome and switch Developer mode on.", "/setup/evidence-extension/developer-mode.svg"],
  ["Load the unpacked build", "Choose Load unpacked, then select apps/evidence-extension/dist.", "/setup/evidence-extension/load-unpacked.svg"],
  ["Return and verify", "Allow the listed Facebook, LinkedIn, and GitHub sites, then refresh the portal. Detection is automatic.", "/setup/evidence-extension/verify.svg"],
] as const;

export default function EvidenceExtensionSetupPage() {
  return <AppShell><div className="mx-auto max-w-4xl space-y-5"><header><Badge variant="orange"><Puzzle size={14}/>Developer extension</Badge><h1 className="mt-4 text-3xl font-extrabold">Install the Evidence Collector</h1><p className="mt-2 max-w-2xl text-muted">This setup unlocks scraper components only. Manual evidence and Resume Studio work without it.</p></header><Card className="border-success/30 bg-success/10"><ShieldCheck className="text-success"/><p className="mt-3 text-sm text-muted">The extension uses your normal browser session and stops for login, CAPTCHA, verification, and rate limits. It never asks for your password.</p></Card><ol className="space-y-5">{steps.map(([title, detail, image], index) => <li key={title}><Card className="grid gap-5 bg-surface md:grid-cols-[1fr_1.2fr]"><div><p className="data-label text-sm text-accent">Step {index + 1}</p><h2 className="mt-2 text-xl font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{detail}</p></div><Image alt={`Illustration for step ${index + 1}: ${title}`} className="w-full rounded-lg border border-border" height={300} src={image} width={560}/></Card></li>)}</ol></div></AppShell>;
}
