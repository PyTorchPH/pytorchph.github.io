"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "";
const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

export type OfficialViewer = { id: string; display_name: string; role: string };
type GoogleApi = { accounts: { id: { initialize: (value: { client_id: string; callback: (value: { credential: string }) => void }) => void; renderButton: (element: HTMLElement, value: { theme: string; size: string }) => void } } };

export function OfficialGoogleConnect({ onConnected, onError }: { onConnected: (viewer: OfficialViewer) => void; onError: (message: string) => void }) {
  const [ready, setReady] = useState(false);
  const button = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onConnected, onError });
  callbacks.current = { onConnected, onError };

  useEffect(() => {
    if (!ready || !button.current || !apiOrigin || !clientId) return;
    const google = (window as unknown as { google?: GoogleApi }).google;
    if (!google) return;
    google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => {
      void fetch(`${apiOrigin}/auth/google`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_token: credential }) })
        .then(async (response) => {
          const payload = await response.json() as OfficialViewer & { error?: string };
          if (!response.ok) throw new Error(payload.error || "Google sign-in failed");
          callbacks.current.onConnected(payload);
        })
        .catch((error: Error) => callbacks.current.onError(error.message));
    } });
    google.accounts.id.renderButton(button.current, { theme: "outline", size: "large" });
  }, [ready]);

  if (!apiOrigin || !clientId) return <p className="text-sm text-muted">Official account login is not configured.</p>;
  return <><Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setReady(true)} /><div ref={button} /></>;
}
