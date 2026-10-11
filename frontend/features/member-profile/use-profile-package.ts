"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchProfilePackage, PROFILE_PACKAGE_QUERY_KEY } from "./api";

// React Query keeps private fields in memory only. Reloading the document fetches a fresh package.
export function useProfilePackage() {
  return useQuery({
    queryKey: PROFILE_PACKAGE_QUERY_KEY,
    queryFn: ({ signal }) => fetchProfilePackage(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
