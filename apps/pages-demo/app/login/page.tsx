"use client";

import { LoginForm } from "@pytorch-ph/domain-client/identity";
import { DemoAccounts } from "../demo-accounts";
import { enterAs } from "../demo-api";

function enterVerifiedAccount(role: string) {
  enterAs(role === "officer" || role === "admin" ? "officer" : "member");
}

export default function LoginPage() {
  return <LoginForm demoControls={<DemoAccounts />} onAuthenticated={enterVerifiedAccount} />;
}
