import { PUBLIC_SITE_URL } from "@pytorch-ph/domain-protocol/organization";
import { cn } from "@pytorch-ph/design-system/merge-classes";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// The PyTorch Philippines wordmark from the public site. It opens the pytorch.ph landing page.
export function BrandMark({ className = "", tone = "onLight" }: { className?: string; tone?: "onDark" | "onLight" }) {
  return (
    <a aria-label="PyTorch PH: go to the pytorch.ph home page" className={cn("focus-ring inline-flex flex-none items-center", className)} href={PUBLIC_SITE_URL}>
      <img alt="" className="h-6 w-auto lg:h-8" height={32} src={`${BASE_PATH}/brand/${tone === "onDark" ? "logo-ph-dark" : "logo-ph"}.svg`} width={241} />
    </a>
  );
}
