import { upsertLocalAccount } from "@pytorch-ph/domain-server/identity";
// @ts-expect-error Development fixture is intentionally JavaScript-owned.
import { localAccounts } from "./accounts.mjs";

for (const value of Object.values(localAccounts) as Array<{ userId: string; email: string; password: string; role: "member" | "admin"; isOfficer: boolean }>) {
  upsertLocalAccount({ ...value, membershipStatus: "active", membershipPaid: true });
}
console.log(JSON.stringify({ event: "local_auth.accounts_seeded", outcome: "success", count: Object.keys(localAccounts).length }));
