"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import type { CapabilityKey } from "@pytorch-ph/domain-protocol/identity";
import { useCapability } from "@pytorch-ph/domain-client/onboarding";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";

export function CapabilityGate({ capabilityKey, children }: { capabilityKey: CapabilityKey; children: React.ReactNode }) {
  const capability = useCapability(capabilityKey);
  if (capability.state !== "locked") return <>{children}</>;
  return (
    <Card aria-live="polite" className="border-border bg-surface opacity-75" data-capability={capabilityKey}>
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 flex-none text-muted" size={20} />
        <div>
          <div className="flex flex-wrap items-center gap-2"><strong>Feature locked</strong><Badge variant="locked">Permission required</Badge></div>
          <p className="mt-2 text-sm text-muted">{capability.reason}</p>
          {capability.missing.length > 0 && <p className="mt-2 text-xs text-muted">Required: {capability.missing.join(", ")}</p>}
        </div>
      </div>
    </Card>
  );
}

export function CapabilityStatus({ capabilityKey }: { capabilityKey: CapabilityKey }) {
  const capability = useCapability(capabilityKey);
  if (capability.state === "locked") return <Badge variant="locked"><LockKeyhole size={13} /> Locked</Badge>;
  if (capability.state === "read_only") return <Badge><ShieldCheck size={13} /> Read only</Badge>;
  return <Badge variant="success"><ShieldCheck size={13} /> Available</Badge>;
}
