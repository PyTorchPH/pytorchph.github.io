import { LockKeyhole, ShieldCheck } from "lucide-react";
import { hasAdvancedAnalytics, type UserTier } from "@pytorch-ph/domain-protocol/identity";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Card } from "@pytorch-ph/design-system/card";

export function LockedAnalytics({ tier }: { tier: UserTier }) {
  if (hasAdvancedAnalytics(tier)) {
    return (
      <Badge variant="success">
        <ShieldCheck size={14} />
        Analytics unlocked
      </Badge>
    );
  }

  return (
    <Badge variant="locked">
      <LockKeyhole size={14} />
      1 day remaining
    </Badge>
  );
}

export function GatePanel({ tier }: { tier: UserTier }) {
  if (hasAdvancedAnalytics(tier)) {
    return (
      <Card className="bg-elevated">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-bold">Advanced analytics active</p>
            <p className="mt-1 text-sm text-muted">Personal growth, radar charts, and award blocks are visible.</p>
          </div>
          <LockedAnalytics tier={tier} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-elevated">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-bold">Member analytics locked</p>
          <p className="mt-1 text-sm text-muted">Attend one PyTorch community event to open growth metrics.</p>
        </div>
        <LockedAnalytics tier={tier} />
      </div>
    </Card>
  );
}
