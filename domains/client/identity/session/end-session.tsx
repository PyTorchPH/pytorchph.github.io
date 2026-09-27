"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@pytorch-ph/design-system/button";

export function SignOutButton() {
  const router = useRouter();
  return <Button className="mt-2 w-full justify-start gap-3" onClick={async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }} type="button" variant="ghost"><LogOut size={18} />Sign out</Button>;
}
