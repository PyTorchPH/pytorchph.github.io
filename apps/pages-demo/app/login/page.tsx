"use client";

import { LoginForm } from "@pytorch-ph/domain-client/identity";
import { DemoAccounts } from "../demo-accounts";
import { enterAs } from "../demo-api";

function enterVerifiedAccount(role: string) {
  enterAs(role === "officer" || role === "admin" ? "officer" : "member");
}

// Fictional example accounts for the offline demo only; real accounts sign in through the API.
function enterExampleAccount(email: string, password: string) {
  const match = /^demo\.(member|officer)@example\.org$/i.exec(email.trim());
  if (!match || password !== "demo-password") return false;
  enterAs(match[1].toLowerCase() === "officer" ? "officer" : "member");
  return true;
}

export default function LoginPage() {
  return <LoginForm demoControls={<DemoAccounts />} onAuthenticated={enterVerifiedAccount} onExampleSignIn={enterExampleAccount} />;
}
