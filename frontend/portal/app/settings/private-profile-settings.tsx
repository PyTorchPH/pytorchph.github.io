"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@pytorch-ph/design-system/button";
import { Input, Label } from "@pytorch-ph/design-system/input";
import { PROFILE_PACKAGE_QUERY_KEY, useProfilePackage, type ProfilePackage } from "@pytorch-ph/domain-client/member-profile";
import { fetchJson } from "@pytorch-ph/domain-client/transport";

export function PrivateProfileSettings() {
  const queryClient = useQueryClient();
  const profile = useProfilePackage();
  const [phone, setPhone] = useState("");
  useEffect(() => { if (profile.data) setPhone(profile.data.private.phoneNumber || ""); }, [profile.data]);
  const save = useMutation({
    mutationFn: () => fetchJson<ProfilePackage["private"]>("/api/member/private-profile", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone.trim() || null }),
    }),
    onSuccess: (saved) => {
      queryClient.setQueryData<ProfilePackage>(PROFILE_PACKAGE_QUERY_KEY, (current) => current ? { ...current, private: saved } : current);
      toast.success("Contact details saved.");
    },
    onError: () => toast.error("Contact details could not be saved."),
  });
  return <div className="space-y-3">
    <h3 className="font-semibold">Private contact details</h3>
    <p className="text-sm text-muted">{profile.data?.private.displayName || "Your name"} · visible to you in your profile and résumé.</p>
    <div><Label htmlFor="private-phone">Phone number</Label><Input id="private-phone" inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="+639123456789" value={phone} /></div>
    <Button disabled={!profile.data || save.isPending} onClick={() => save.mutate()} type="button" variant="secondary">Save contact details</Button>
  </div>;
}
