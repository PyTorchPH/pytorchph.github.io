// Network calls for the Organization page (all officer-only, through the portal gateway).
// Module map:
//   OrgChart / OrgPosition / OrgHistoryEntry / AssignableMember   response shapes
//   fetchOrgChart         GET  /api/officer/organization
//   searchAssignable      GET  /api/officer/organization/members?q=
//   assignPosition        POST /api/officer/organization/assignments {memberId, position}
//   removeHolder          DELETE /api/officer/organization/assignments/{position}/{memberId}
//   resignPosition        POST /api/officer/organization/resign {position}

import { fetchJson } from "@pytorch-ph/domain-client/transport";

export type OrgHolder = { id: string; name: string; handle: string };
export type OrgPosition = {
  slug: string; title: string; department: string; departmentName: string; rank: number;
  seats: "one" | "many"; parent: string | null; holders: OrgHolder[]; canManage: boolean; heldByViewer: boolean;
};
export type OrgHistoryEntry = { position: string; member: string; action: "assigned" | "removed" | "resigned"; actor: string; at: string };
export type OrgChart = { positions: OrgPosition[]; history: OrgHistoryEntry[] };
export type AssignableMember = { id: string; name: string; handle: string; email: string };

export const ORG_CHART_QUERY_KEY = ["officer-organization"] as const;

export const fetchOrgChart = () => fetchJson<OrgChart>("/api/officer/organization", { cache: "no-store" });

export const searchAssignable = (query: string) =>
  fetchJson<AssignableMember[]>(`/api/officer/organization/members?${new URLSearchParams({ q: query.trim() })}`, { cache: "no-store" });

const send = (path: string, method: string, body?: unknown) =>
  fetchJson<{ ok: true }>(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const assignPosition = (memberId: string, position: string) => send("/api/officer/organization/assignments", "POST", { memberId, position });
export const removeHolder = (position: string, memberId: string) => send(`/api/officer/organization/assignments/${encodeURIComponent(position)}/${encodeURIComponent(memberId)}`, "DELETE");
export const resignPosition = (position: string) => send("/api/officer/organization/resign", "POST", { position });
