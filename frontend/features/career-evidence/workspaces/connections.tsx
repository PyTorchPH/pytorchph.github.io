"use client";

// Provider connections: sanitized status cards and a dialog with guided next steps.
// Module map (caller-first):
//   ConnectionsWorkspaceView  card grid plus the dialog for the chosen connection
//   ConnectionCard            one provider's status summary
//   ConnectionDialog          current state, verification warning and actions
//   ConnectionActions         check/disconnect when connected, connect/continue otherwise

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Plug, RefreshCw, Server, Unplug } from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card, CardHeader } from "@pytorch-ph/design-system/card";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import type { Connection, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import { connectionTone } from "./tones";

// Mental model: cards only describe state; the dialog explains the next human step without touching secrets.
export function ConnectionsWorkspaceView({ data }: { data: ProductViewData }) {
  const [selected, setSelected] = useState<Connection | null>(null);
  const [notice, setNotice] = useState("");
  const connections = useMemo(() => data.connections || [], [data.connections]);
  const open = (item: Connection) => {
    setSelected(item);
    setNotice("");
  };
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connections.length ? (
          connections.map((item) => <ConnectionCard item={item} key={item.id} onOpen={open} />)
        ) : (
          <Card>No connection summaries.</Card>
        )}
      </section>
      {selected && <ConnectionDialog notice={notice} onClose={() => setSelected(null)} onNotice={setNotice} selected={selected} />}
    </>
  );
}

const isConnectionLive = (item: Connection) => item.status === "connected";

function ConnectionCard({ item, onOpen }: { item: Connection; onOpen: (item: Connection) => void }) {
  const connected = isConnectionLive(item);
  return (
    <button
      className="focus-ring group text-left"
      onClick={() => onOpen(item)}
    >
      <Card className="h-full bg-surface group-hover:border-accent/40">
        <CardHeader>
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${connected ? "bg-success/10 text-success" : "bg-elevated text-muted"}`}
          >
            {connected ? <Server size={20} /> : <Unplug size={20} />}
          </div>
          <Badge variant={connectionTone(item.status)}>
            {item.status.replaceAll("_", " ")}
          </Badge>
        </CardHeader>
        <h2 className="font-bold">{item.label}</h2>
        <p className="mt-1 text-xs uppercase tracking-widest text-muted">
          {item.category.replaceAll("_", " ")}
        </p>
        <p className="mt-4 text-sm leading-6 text-muted">
          {item.detail}
        </p>
        <p className="mt-5 flex items-center justify-between text-xs font-semibold text-accent">
          <span>
            {connected ? "Manage connection" : "Connection options"}
          </span>
          <ChevronRight
            className="transition group-hover:translate-x-1"
            size={15}
          />
        </p>
      </Card>
    </button>
  );
}

function ConnectionDialog({ selected, notice, onNotice, onClose }: { selected: Connection; notice: string; onNotice: (notice: string) => void; onClose: () => void }) {
  return (
    <AppDialog
      description="Connection state is sanitized; secrets and browser storage never appear here."
      onClose={onClose}
      title={selected.label}
    >
      <div className="rounded-xl border border-border bg-elevated p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Current state</p>
          <Badge variant={connectionTone(selected.status)}>
            {selected.status.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted">
          {selected.detail}
        </p>
      </div>
      {selected.status === "verification_required" && (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mr-2 inline text-warning" size={16} />A
          normal visible browser must be used. CAPTCHA and identity checks
          cannot be bypassed.
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-xl border border-accent/25 bg-accentSoft p-4 text-sm">
          {notice}
        </p>
      )}
      <ConnectionActions onNotice={onNotice} selected={selected} />
    </AppDialog>
  );
}

function ConnectionActions({ selected, onNotice }: { selected: Connection; onNotice: (notice: string) => void }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {isConnectionLive(selected) ? (
        <>
          <Button
            onClick={() =>
              onNotice(
                "Connection check queued in preview; live checks run through the server gateway.",
              )
            }
          >
            <RefreshCw size={15} />
            Check connection
          </Button>
          <Button
            onClick={() =>
              onNotice(
                "The live gateway requires confirmation before disconnecting.",
              )
            }
            variant="secondary"
          >
            Disconnect
          </Button>
        </>
      ) : (
        <Button
          onClick={() =>
            onNotice(
              "Guided connection is ready. External verification remains a human step.",
            )
          }
        >
          <Plug size={15} />
          {selected.status === "verification_required"
            ? "Continue verification"
            : "Connect"}
        </Button>
      )}
    </div>
  );
}
