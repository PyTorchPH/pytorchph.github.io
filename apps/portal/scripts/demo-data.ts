import { ensureLocalDemo } from "@pytorch-ph/domain-server/career-evidence";
import { localDemoStatus, resetLocalDemo } from "@pytorch-ph/domain-server/career-evidence";

const command = process.argv[2] || "status";
const confirmed = process.argv.includes("--confirm");
const quiet = process.argv.includes("--quiet");
const userId = process.env.PYTORCH_PH_DEV_USER_ID || "00000000-0000-4000-8000-000000000001";

if ((process.env.PYTORCH_PH_DATA_PROVIDER || "local") !== "local" || process.env.NODE_ENV === "production") {
  throw new Error("Local demo commands refuse non-local providers and production environments.");
}

if (command === "ensure" || command === "seed") {
  ensureLocalDemo(userId);
  if (!quiet) console.log(JSON.stringify(localDemoStatus(userId), null, 2));
} else if (command === "status") {
  console.log(JSON.stringify(localDemoStatus(userId), null, 2));
} else if (command === "reset") {
  if (!confirmed) throw new Error("Reset requires --confirm. The existing database will be copied to var/state/demo/backups first.");
  console.log(JSON.stringify(resetLocalDemo(userId), null, 2));
} else {
  throw new Error("Usage: demo-data.ts status|ensure|seed|reset [--confirm] [--quiet]");
}
