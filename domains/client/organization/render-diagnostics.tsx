import type { DeveloperDiagnostics as DiagnosticData } from "@pytorch-ph/domain-protocol/career-evidence";

export function DeveloperDiagnostics({ data }: { data?: DiagnosticData }) {
  if (!data) return null;
  return (
    <details className="rounded-lg border border-white/10 bg-[#141416] p-4" data-testid="developer-diagnostics">
      <summary className="cursor-pointer text-sm font-semibold text-[#FFF7ED]/60">Developer diagnostics</summary>
      <p className="mt-2 text-xs leading-5 text-[#FFF7ED]/40">Officer-visible, allowlisted technical metadata. Credentials and raw records are never included.</p>
      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0d0d0d] p-4 font-mono text-xs text-[#FFF7ED]/55">{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
