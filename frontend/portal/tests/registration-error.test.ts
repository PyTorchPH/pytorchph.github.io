import assert from "node:assert/strict";
import test from "node:test";
import { API_ORIGIN, OfficialAuthError, officialAuth } from "../../features/identity/session/credentials/official-auth";
import { registrationErrorMessage } from "../../features/identity/session/credentials/registration/error";

const privateDetail = "PRIVATE_UPSTREAM_DETAIL_TOKEN_MUST_NOT_RENDER";
const authPaths = ["/auth/email/start", "/auth/password", "/auth/email/verify", "/auth/google"];

test("signup preserves the full-name credential contract and authenticated request options", async () => {
  const body = { name: "Synthetic Member", username: "synthetic_member", email: "new-member@example.test", password: "Fixture#Pass9" };
  const reply = { message: "If this address can register, a verification code has been sent." };
  const result = await officialAuth("/auth/email/start", body, async (input, init) => {
    assert.equal(input, `${API_ORIGIN}/auth/email/start`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    return Response.json(reply);
  });
  assert.deepEqual(result, reply);
});

for (const path of ["/auth/password", "/auth/email/verify", "/auth/google"]) {
  test(`${path} retains the successful viewer reply unchanged`, async () => {
    const reply = { id: "synthetic-member", display_name: "Synthetic Member", role: "member" };
    assert.deepEqual(await officialAuth(path, {}, async () => Response.json(reply)), reply);
  });
}

test("HTTP errors are classified before parsing an upstream body", async () => {
  const response = new Response(privateDetail, { status: 503, headers: { "content-type": "text/html" } });
  response.json = async () => { assert.fail("An unsuccessful auth response body must not be parsed"); };
  await assert.rejects(officialAuth("/auth/email/start", {}, async () => response), (error: unknown) => {
    assert.ok(error instanceof OfficialAuthError);
    assert.equal(error.status, 503);
    assert.equal(error.operation, "signup");
    assert.match(error.message, /Hindi ito nangangahulugang invalid o taken ang email mo/);
    assert.ok(!error.message.includes(privateDetail));
    return true;
  });
});

for (const path of authPaths) {
  test(`${path} sanitizes HTML service outages and network exceptions`, async () => {
    for (const request of [
      async () => new Response(`<html>${privateDetail}</html>`, { status: 503, headers: { "content-type": "text/html" } }),
      async () => { throw new Error(privateDetail); },
    ]) {
      await assert.rejects(officialAuth(path, {}, request), (error: unknown) => {
        assert.ok(error instanceof OfficialAuthError);
        assert.ok(!error.message.includes(privateDetail));
        assert.ok(error.message.length < 240);
        assert.match(error.message, /Subukan|subukan/);
        return true;
      });
    }
  });

  test(`${path} never reports success for malformed JSON or the wrong response shape`, async () => {
    for (const response of [
      new Response(`<html>${privateDetail}</html>`, { status: 200, headers: { "content-type": "text/html" } }),
      Response.json(null), Response.json([]), Response.json({}), Response.json({ error: privateDetail }),
    ]) {
      await assert.rejects(officialAuth(path, {}, async () => response), (error: unknown) => {
        assert.ok(error instanceof OfficialAuthError);
        assert.equal(error.status, 200);
        assert.equal(error.reason, "invalid_response");
        assert.ok(!error.message.includes(privateDetail));
        return true;
      });
    }
  });
}

test("password failures never reveal whether an account exists", async () => {
  const messages: string[] = [];
  for (const detail of ["No account exists", "Wrong password", privateDetail]) {
    await assert.rejects(officialAuth("/auth/password", {}, async () => Response.json({ error: detail }, { status: 401 })), (error: unknown) => {
      assert.ok(error instanceof OfficialAuthError);
      messages.push(error.message);
      return true;
    });
  }
  assert.equal(new Set(messages).size, 1);
  assert.match(messages[0], /Hindi tama ang email o password \(401\)/);
});

test("rate limiting remains distinct from rejected credentials and infrastructure failure", async () => {
  for (const path of authPaths) {
    await assert.rejects(officialAuth(path, {}, async () => Response.json({ error: privateDetail }, { status: 429 })), (error: unknown) => {
      assert.ok(error instanceof OfficialAuthError);
      assert.match(error.message, /\(429\).*Maghintay/);
      assert.ok(!error.message.includes(privateDetail));
      return true;
    });
  }
});

test("rejected verification and denied requests remain failures with useful bounded diagnostics", async () => {
  for (const status of [400, 401, 403, 410, 422, 503]) {
    await assert.rejects(officialAuth("/auth/email/verify", {}, async () => Response.json({ error: privateDetail }, { status })), (error: unknown) => {
      assert.ok(error instanceof OfficialAuthError);
      assert.equal(error.status, status);
      assert.match(error.message, new RegExp(`\\(${status}\\)`));
      assert.ok(!error.message.includes(privateDetail));
      return true;
    });
  }
});

test("both legacy registration outage strings explain service failure, not email validity", () => {
  for (const message of ["Email verification is unavailable", "Registration verification service is temporarily unavailable. Please try again later."]) {
    assert.match(registrationErrorMessage(new Error(message)), /Hindi ito nangangahulugang invalid o taken ang email mo/);
  }
});

test("registration adapters preserve typed failures but never expose unknown error messages", () => {
  const failure = new OfficialAuthError("signup", 429);
  assert.equal(registrationErrorMessage(failure), failure.message);
  for (const value of [new Error(privateDetail), { error: privateDetail }, null]) {
    assert.equal(registrationErrorMessage(value), "Hindi natuloy ang registration. Subukan ulit.");
  }
  assert.match(registrationErrorMessage(new Error("Invalid registration details")), /\(400\).*Suriin/);
  assert.match(registrationErrorMessage(new Error("Invalid email address")), /\(400\).*Suriin/);
});

test("a failed success-response stream cannot expose internal exceptions or authenticate", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error(privateDetail)); } });
  await assert.rejects(officialAuth("/auth/password", {}, async () => new Response(stream)), (error: unknown) => {
    assert.ok(error instanceof OfficialAuthError);
    assert.equal(error.reason, "invalid_response");
    assert.ok(!error.message.includes(privateDetail));
    return true;
  });
});
