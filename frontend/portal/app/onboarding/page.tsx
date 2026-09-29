"use client";

import { AppShell } from "@pytorch-ph/domain-client/navigation";
import { CompleteProfile } from "@pytorch-ph/domain-client/member-profile";

export default function OnboardingPage() {
  return <AppShell><CompleteProfile /></AppShell>;
}
