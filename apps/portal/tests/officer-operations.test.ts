import assert from "node:assert/strict";
import test from "node:test";
import { configuredMailAdapter } from "@pytorch-ph/domain-server/organization";

test("copy/export is the safe default mail adapter", async () => {
  const previous = process.env.PYTORCH_PH_EVENT_MAIL_MODE;
  delete process.env.PYTORCH_PH_EVENT_MAIL_MODE;
  try {
    const adapter = configuredMailAdapter();
    assert.equal(adapter.mode, "copy_export");
    const receipt = await adapter.deliverApproved({ to: ["reviewed-export@local.invalid"], subject: "Subject", body: "Body", revisionHash: "abc" }, "stable-key");
    assert.deepEqual(receipt, { provider: "copy_export", messageId: "export:stable-key" });
  } finally {
    if (previous === undefined) delete process.env.PYTORCH_PH_EVENT_MAIL_MODE;
    else process.env.PYTORCH_PH_EVENT_MAIL_MODE = previous;
  }
});

test("Gmail mode fails closed when configuration or recipient allowlist is wrong", async () => {
  const previous = { mode: process.env.PYTORCH_PH_EVENT_MAIL_MODE, token: process.env.PYTORCH_PH_GMAIL_ACCESS_TOKEN, recipient: process.env.PYTORCH_PH_SADO_EMAIL };
  process.env.PYTORCH_PH_EVENT_MAIL_MODE = "gmail";
  delete process.env.PYTORCH_PH_GMAIL_ACCESS_TOKEN;
  process.env.PYTORCH_PH_SADO_EMAIL = "sado@example.edu";
  try {
    await assert.rejects(() => configuredMailAdapter().deliverApproved({ to: ["sado@example.edu"], subject: "Subject", body: "Body", revisionHash: "abc" }, "stable-key"), /not fully configured/);
    process.env.PYTORCH_PH_GMAIL_ACCESS_TOKEN = "test-token";
    await assert.rejects(() => configuredMailAdapter().deliverApproved({ to: ["other@example.edu"], subject: "Subject", body: "Body", revisionHash: "abc" }, "stable-key"), /allowlist/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === "mode" ? "PYTORCH_PH_EVENT_MAIL_MODE" : key === "token" ? "PYTORCH_PH_GMAIL_ACCESS_TOKEN" : "PYTORCH_PH_SADO_EMAIL";
      if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
    }
  }
});
