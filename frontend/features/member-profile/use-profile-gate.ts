"use client";

// Sends signed-in members with an unfinished profile to /onboarding/.
// Module map:
//   useMemberProfile   the one cached GET /api/member/profile query (key ["member-profile"])
//   useProfileGate     redirect rule used by AppShell
//   isGateExempt       routes a member can visit before finishing the profile

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ProfileStatus } from "@pytorch-ph/domain-protocol/identity";
import { PROFILE_QUERY_KEY, fetchProfile } from "./api";

const EXEMPT_PREFIXES = ["/onboarding", "/settings"];
const PROFILE_STALE_MS = 5 * 60 * 1000;

export function useMemberProfile() {
  return useQuery<ProfileStatus>({ queryKey: PROFILE_QUERY_KEY, queryFn: fetchProfile, staleTime: PROFILE_STALE_MS, retry: false });
}

// Mental model: only an explicit `complete: false` redirects. Signed-out visitors, API errors, and
// the static demo without a backend all leave the page alone.
export function useProfileGate(pathname: string): void {
  const router = useRouter();
  const { data } = useMemberProfile();
  const mustComplete = data?.complete === false && !isGateExempt(pathname);
  useEffect(() => {
    if (mustComplete) router.replace("/onboarding/");
  }, [mustComplete, router]);
}

const isGateExempt = (pathname: string) =>
  EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
