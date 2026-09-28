import { headers } from "next/headers";
import type { PortalAudience } from "@pytorch-ph/domain-protocol/identity";

const officerOnlyPrefixes = [
  "/admin",
  "/career/advisor",
  "/connections",
  "/reports",
];

function configuredHosts(name: "PYTORCH_PH_MEMBER_HOSTS" | "PYTORCH_PH_OFFICER_HOSTS") {
  const fallback = name === "PYTORCH_PH_OFFICER_HOSTS"
    ? "officers.ph.localhost:3100"
    : "members.ph.localhost:3100,localhost:3100,127.0.0.1:3100";
  return new Set((process.env[name] || fallback).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function audienceForHost(host: string | null | undefined): PortalAudience {
  const normalized = (host || "").trim().toLowerCase();
  return configuredHosts("PYTORCH_PH_OFFICER_HOSTS").has(normalized) ? "officer" : "member";
}

export async function portalAudience(): Promise<PortalAudience> {
  return audienceForHost((await headers()).get("host"));
}

export function isOfficerOnlyPath(pathname: string) {
  return officerOnlyPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function memberDestination(pathname: string) {
  return isOfficerOnlyPath(pathname) ? "/dashboard" : pathname;
}

export function portalOrigin(audience: PortalAudience) {
  const configured = audience === "officer"
    ? process.env.PYTORCH_PH_OFFICER_URL
    : process.env.PYTORCH_PH_MEMBER_URL;
  return configured?.trim().replace(/\/$/, "")
    || `http://${audience === "officer" ? "officers" : "members"}.ph.localhost:3100`;
}
