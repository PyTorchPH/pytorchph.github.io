// Two-column product previews: text on one side, an illustration on the other.
// Module map (caller-first):
//   LeaderboardPreview  sample ranking rows
//   KanbanPreview       event workflow columns with placeholder tasks
//   AltSection          the shared two-column layout (optionally mirrored)
//   tasksInColumn       2 or 3 placeholder tasks, alternating by column

import type { ReactNode } from "react";
import { Reveal } from "@pytorch-ph/domain-client/public-site";
import { kanbanColumns, leaderboardSample } from "./content";

export function LeaderboardPreview() {
  return (
    <AltSection
      body="The leaderboard categorizes members by skill domain: Computer Vision, NLP, Optimization, MLOps, and research. Rankings use event participation and reviewed public-safe activity scores."
      eyebrow="global leaderboard"
      id="leaderboard"
      title="Specialty rankings, refreshed every cycle."
    >
      <div className="space-y-2 font-mono text-sm">
        {leaderboardSample.map((member) => (
          <div className="flex items-center justify-between rounded-lg border border-border bg-canvas p-3" key={member.rank}>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-accent/30 bg-accent/15 text-xs text-accent">#{member.rank}</div>
              <span className="text-ink">{member.name}</span>
            </div>
            <span className="text-accent">{member.score}</span>
          </div>
        ))}
      </div>
    </AltSection>
  );
}

export function KanbanPreview() {
  return (
    <AltSection
      body="Officers move events through planning, approval, live registration, and concluded states. Drafts and AI summaries remain human-reviewed before dispatch."
      eyebrow="kanban operations"
      id="ops"
      reverse
      title="Run hackathons like an engineering team."
    >
      <div className="grid grid-cols-4 gap-2 font-mono text-[10px]">
        {kanbanColumns.map((column, index) => (
          <div className="space-y-1.5" key={column}>
            <div className="uppercase tracking-widest text-muted">{column}</div>
            {Array.from({ length: tasksInColumn(index) }).map((_, taskIndex) => (
              <div className="h-10 rounded border border-border bg-canvas p-1.5 text-muted" key={`${column}-${taskIndex}`}>
                task-{index}{taskIndex}
              </div>
            ))}
          </div>
        ))}
      </div>
    </AltSection>
  );
}

const tasksInColumn = (columnIndex: number) => 2 + (columnIndex % 2);

type AltSectionProps = { id: string; eyebrow: string; title: string; body: string; reverse?: boolean; children: ReactNode };

function AltSection({ id, eyebrow, title, body, reverse, children }: AltSectionProps) {
  return (
    <section className="relative border-t border-border bg-canvas py-28" id={id}>
      <div className={`mx-auto grid max-w-7xl items-center gap-16 px-6 md:grid-cols-2 ${reverse ? "md:[direction:rtl]" : ""}`}>
        <Reveal className="md:[direction:ltr]">
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">{eyebrow}</div>
          <h2 className="mb-5 text-3xl font-bold tracking-[-0.02em] text-ink md:text-4xl">{title}</h2>
          <p className="leading-8 text-muted">{body}</p>
        </Reveal>
        <Reveal className="md:[direction:ltr]" delay={120}>
          <div className="rounded-2xl bg-[linear-gradient(135deg,rgb(var(--accent-rgb)/.1),transparent)] p-px">
            <div className="rounded-2xl border border-border bg-surface p-6">{children}</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
