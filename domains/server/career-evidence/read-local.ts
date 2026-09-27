import type { ProductRepository, ProductView, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { overlayLocalCareerState } from "./store-local";
import { demoProductView } from "./read-demo";
import { readLocalDemoState } from "./read-demo-state";

export class LocalProductRepository implements ProductRepository {
  readonly provider = "local" as const;

  async read(view: ProductView, userId: string): Promise<ProductViewData> {
    const base = overlayLocalCareerState(demoProductView(view), userId);
    const runtime = readLocalDemoState(userId);
    const sequence = ["discovered", "drafted", "human_review", "demo_confirmed"];
    const opportunities = (base.opportunities || []).map((item) => {
      const stage = runtime.opportunityStages[item.id] || item.stage;
      const position = sequence.indexOf(stage);
      return { ...item, stage, nextStage: stage === "demo_confirmed" ? null : sequence[Math.min(sequence.length - 1, Math.max(0, position) + 1)] };
    });
    const reviews = (base.operations?.reviews || []).filter((item) => !runtime.approvedReviewIds.includes(item.id));
    const events = (base.events || []).map((item) => ({ ...item, registered: runtime.registeredEventIds.includes(item.id) }));
    const bonus = Math.max(0, runtime.registeredEventIds.length - 1) * 120;
    const leaderboard = (base.leaderboard || []).map((item) => item.currentUser ? { ...item, points: item.points + bonus, streak: item.streak + Math.max(0, runtime.registeredEventIds.length - 1) } : item)
      .sort((a, b) => b.points - a.points)
      .map((item, index) => ({ ...item, rank: index + 1 }));
    const completed = opportunities.filter((item) => item.stage === "demo_confirmed").length;

    return {
      ...base,
      opportunities,
      events,
      leaderboard,
      operations: base.operations ? { ...base.operations, completed, reviews } : base.operations,
      analytics: base.analytics ? {
        ...base.analytics,
        approvals: { ...base.analytics.approvals, data: base.analytics.approvals.data.filter((item) => !runtime.approvedReviewIds.includes(item.id)) },
        leaderboard: { ...base.analytics.leaderboard, data: leaderboard },
        metrics: {
          ...base.analytics.metrics,
          data: base.analytics.metrics.data.map((item) => {
            if (item.label === "Active applications") return { ...item, value: String(opportunities.filter((opportunity) => opportunity.stage !== "demo_confirmed").length) };
            if (item.label === "Upcoming events") return { ...item, delta: `${events.filter((event) => event.registered).length} joined` };
            return item;
          }),
        },
      } : base.analytics,
    };
  }
}
