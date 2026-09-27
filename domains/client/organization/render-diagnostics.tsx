import type { DeveloperDiagnostics as DiagnosticData } from "@pytorch-ph/domain-protocol/career-evidence";

export function DeveloperDiagnostics({ data }: { data?: DiagnosticData }) {
  if (!data) return null;
  return (
    <details className="rounded-lg border border-border bg-surface p-4" data-testid="developer-diagnostics">
      <summary className="cursor-pointer text-sm font-semibold text-muted">Developer diagnostics</summary>
      <p className="mt-2 text-xs leading-5 text-muted">Officer-visible, allowlisted technical metadata. Credentials and raw records are never included.</p>
      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-4 font-mono text-xs text-muted">{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
