"use client";

import { useEffect, useState } from "react";
import { GoogleButton } from "../../../features/identity/session/credentials/google-button";
import { officialAuth, hasAuthApi, hasGoogleSignIn } from "../../../features/identity/session/credentials/official-auth";

export default function CliLoginPage() {
  const [requestId, setRequestId] = useState("");
  const [role, setRole] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  useEffect(() => { setRequestId(new URLSearchParams(window.location.search).get("request") ?? ""); }, []);

  async function approve() {
    setBusy(true); setMessage("");
    try {
      await officialAuth("/auth/cli/approve", { requestId, userCode: code.trim().toUpperCase() });
      setApproved(true); setMessage("Aprubado na. Bumalik sa terminal; puwede nang isara ang tab.");
    } catch { setMessage("Hindi naaprubahan. I-check ang code, officer access, at login expiry."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-lg space-y-6 p-8">
    <h1 className="text-2xl font-bold">PyTorch PH Officer CLI</h1>
    <p>Mag-sign in o gumawa ng Google account connection. Mananatiling kailangan ang existing officer permissions.</p>
    <p>Aprubahan lang kung ikaw ang nagpasimula nito sa sarili mong terminal. Huwag ibahagi ang code.</p>
    {(!hasAuthApi() || !hasGoogleSignIn()) && <p role="alert">Hindi pa configured ang Google login sa deployment na ito.</p>}
    {!role && hasAuthApi() && hasGoogleSignIn() && <GoogleButton onConnected={viewer => setRole(viewer.role)} onError={() => setMessage("Hindi natuloy ang Google login. Subukan muli.")} />}
    {role && !["officer", "admin"].includes(role) && <p role="alert">Naka-sign in ka, pero kailangan ng officer access. Walang role na awtomatikong ibibigay.</p>}
    {["officer", "admin"].includes(role) && !approved && <form onSubmit={event => { event.preventDefault(); void approve(); }}>
      <label htmlFor="cli-code">Code mula sa sarili mong terminal</label>
      <input id="cli-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" maxLength={8} required className="m-2 rounded border p-2" />
      <button type="submit" disabled={busy || !/^[a-f0-9]{8}$/i.test(code.trim()) || !/^[0-9a-f-]{36}$/.test(requestId)} className="rounded border p-2">Aprubahan ang CLI login</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </main>;
}
