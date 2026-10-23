"use client";

import { useEffect, useState } from "react";
import { useQuery, type Query, type QueryClient } from "@tanstack/react-query";
import { readPhoto } from "./api";

export const PHOTO_QUERY_KEY = ["member-self-photo"] as const;

export function usePhotoPreview() {
  const query = useQuery({
    queryKey: PHOTO_QUERY_KEY,
    queryFn: ({ signal }) => readPhoto(signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);

  useEffect(() => {
    setDecodeFailed(false);
    if (!query.data) {
      setUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(query.data);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [query.data]);

  return {
    url,
    loading: query.isPending && query.fetchStatus === "fetching",
    absent: query.data === null,
    error: query.error?.message ?? (decodeFailed ? "Hindi maipakita ang profile photo. Subukan itong i-load ulit." : null),
    refresh: () => { setDecodeFailed(false); void query.refetch(); },
    onDecodeError: () => setDecodeFailed(true),
  };
}

export async function runCurrentPhotoChange(
  queryClient: QueryClient,
  startedQuery: Query | undefined,
  action: () => Promise<void>,
): Promise<boolean> {
  if (!isCurrentPhotoChange(queryClient, startedQuery)) {
    console.info({ event: "portal.photo.change_skipped", component: "profile-photo", outcome: "skipped", reason: "stale_query" });
    return false;
  }
  await action();
  return true;
}

export function isCurrentPhotoChange(
  queryClient: QueryClient,
  startedQuery: Query | undefined,
): boolean {
  return startedQuery !== undefined
    && queryClient.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true }) === startedQuery;
}
