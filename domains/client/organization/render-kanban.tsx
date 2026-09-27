"use client";

import { GripVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { kanbanEvents } from "@pytorch-ph/domain-client/organization";
import type { AnalyticsState, DashboardAnalytics } from "@pytorch-ph/domain-protocol/career-evidence";
import { cn } from "@pytorch-ph/design-system/merge-classes";
import { Badge } from "@pytorch-ph/design-system/badge";

type ColumnKey = keyof typeof kanbanEvents;

const columns: Array<{ key: ColumnKey; title: string }> = [
  { key: "planning", title: "Planning" },
  { key: "approved", title: "Approved" },
  { key: "live", title: "Live Registration" },
  { key: "concluded", title: "Concluded" }
];

export function KanbanBoard({ data = kanbanEvents, state }: { data?: DashboardAnalytics["events"]["data"]; state?: AnalyticsState } = {}) {
  const [board, setBoard] = useState(data);
  const [dragging, setDragging] = useState<{ id: string; column: ColumnKey } | null>(null);
  const total = useMemo(() => Object.values(board).reduce((sum, list) => sum + list.length, 0), [board]);
  useEffect(() => setBoard(data), [data]);

  function moveCard(target: ColumnKey) {
    if (!dragging || dragging.column === target) return;
    const sourceItems = [...board[dragging.column]];
    const item = sourceItems.find((event) => event.id === dragging.id);
    if (!item) return;
    setBoard({
      ...board,
      [dragging.column]: sourceItems.filter((event) => event.id !== dragging.id),
      [target]: [item, ...board[target]]
    });
  }

  return (
    <div className="relative">
      {state === "unavailable" && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><span className="rounded-full border border-border bg-canvas/85 px-5 py-2 font-mono text-xs uppercase tracking-[0.18em] text-muted shadow-xl">Data unavailable</span></div>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-[-0.02em]">PyTorch Event Management</h2>
          <p className="text-sm text-muted">{total} community activities across officer workflow states.</p>
        </div>
        <Badge variant="orange">Human approval required</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        {columns.map((column) => (
          <div
            className="min-h-72 rounded-lg border border-border bg-elevated p-3"
            key={column.key}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => moveCard(column.key)}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">{column.title}</h3>
              <span className="data-label text-xs text-muted">{board[column.key].length}</span>
            </div>
            <div className="space-y-3">
              {board[column.key].map((event) => (
                <article
                  className={cn(
                    "cursor-grab rounded-lg border border-border bg-surface p-3 transition-all duration-300 ease-in-out active:cursor-grabbing",
                    dragging?.id === event.id && "opacity-60"
                  )}
                  draggable={state !== "unavailable"}
                  key={event.id}
                  onDragEnd={() => setDragging(null)}
                  onDragStart={() => setDragging({ id: event.id, column: column.key })}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical className="mt-0.5 text-muted" size={16} />
                    <div className="min-w-0">
                      <p className="font-semibold leading-5">{event.title}</p>
                      <p className="mt-2 text-xs text-muted">{event.owner}</p>
                      <p className="data-label mt-3 text-xs text-accent">{event.seats} seats</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
