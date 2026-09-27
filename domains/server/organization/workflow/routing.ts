import type { ActivityContext, Department, RoutingRule } from "@pytorch-ph/domain-protocol/organization/workflow";

/**
 * Step 2 — decide which departments must approve, from a CONFIGURABLE rules table.
 * The table is admin-editable (DB/config), so changing org structure needs no code change.
 */
export interface RoutingRules {
  /** Return the required approver departments for this activity. */
  resolve(context: ActivityContext): Department[];
}

/**
 * Table-driven implementation. Load rules from the DB/config and pass them in. Matches by
 * (category, scope). Returns [] when no rule matches — the caller decides the fallback
 * (e.g. default to secretariat).
 */
export class TableRoutingRules implements RoutingRules {
  constructor(private readonly rules: RoutingRule[]) {}

  resolve(context: ActivityContext): Department[] {
    const match = this.rules.find(
      (r) => r.category === context.category && r.scope === context.scope,
    );
    return match ? [...match.requiredDepartments] : [];
  }
}
