"use client";

// The Google Identity Services button, exchanging Google's ID token for a PyTorch PH session.
// Module map (caller-first):
//   GoogleButton          loads the Google script once and renders the button into a div
//   mountGoogleButton     initializes Google Identity and draws the button
//   exchangeGoogleToken   POST /auth/google with the credential

import { useEffect, useRef } from "react";
import { GOOGLE_CLIENT_ID, officialAuth, type OfficialViewer } from "./official-auth";

type GoogleIdentity = { accounts: { id: { initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void; renderButton: (element: HTMLElement, options: { theme: string; size: string; shape: string; logo_alignment: string; width: number }) => void } } };
type Callbacks = { onConnected: (viewer: OfficialViewer) => void; onError: (message: string) => void };

// Mental model: callbacks live in a ref so the script loads once while the latest handlers still receive the result.
export function GoogleButton({ onConnected, onError }: Callbacks) {
  const button = useRef<HTMLDivElement>(null);
  const callbacks = useRef<Callbacks>({ onConnected, onError });
  callbacks.current = { onConnected, onError };
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !button.current) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => mountGoogleButton(button.current, callbacks);
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);
  return <div className="flex w-full justify-center" ref={button} />;
}

function mountGoogleButton(element: HTMLDivElement | null, callbacks: { current: Callbacks }) {
  const google = (window as unknown as { google?: GoogleIdentity }).google;
  if (!google || !element) return;
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: ({ credential }) => {
    void exchangeGoogleToken(credential).then(viewer => callbacks.current.onConnected(viewer)).catch((reason: Error) => callbacks.current.onError(reason.message));
  } });
  google.accounts.id.renderButton(element, { theme: "outline", size: "large", shape: "rectangular", logo_alignment: "left", width: buttonWidth(element) });
}

// Google sizes the personalized "Sign in as …" button to its text unless given a width; 400px is Google's maximum.
const GOOGLE_MAX_BUTTON_WIDTH = 400;

const buttonWidth = (element: HTMLElement) => Math.min(GOOGLE_MAX_BUTTON_WIDTH, Math.max(200, Math.floor(element.clientWidth)));

const exchangeGoogleToken = (credential: string) => officialAuth<OfficialViewer>("/auth/google", { id_token: credential });
