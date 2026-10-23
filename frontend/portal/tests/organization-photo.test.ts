import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { MAX_PHOTO_BYTES, PhotoRequestError, readPhoto, removePhoto, uploadPhoto } from "../app/settings/photo/api";
import { PHOTO_QUERY_KEY, isCurrentPhotoChange, runCurrentPhotoChange } from "../app/settings/photo/preview";

test("self photo reads authenticated binary data through the portal fetch bridge", async () => {
  const controller = new AbortController();
  let called = false;
  const photo = await readPhoto(controller.signal, async (input, init) => {
    called = true;
    assert.equal(input, "/api/member/self-photo");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, controller.signal);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp" } });
  });
  assert.equal(called, true);
  assert.equal(photo?.type, "image/webp");
  assert.deepEqual(new Uint8Array(await photo!.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test("a missing photo is different from a failed read", async () => {
  assert.equal(await readPhoto(undefined, async () => new Response(null, { status: 404 })), null);
  await assert.rejects(readPhoto(undefined, async () => new Response(null, { status: 503 })), (error: unknown) => {
    assert.ok(error instanceof PhotoRequestError);
    assert.equal(error.operation, "load");
    assert.equal(error.status, 503);
    assert.match(error.message, /Hindi ma-load/);
    return true;
  });
});

test("upload sends original bytes and accepts an empty 204 without parsing JSON", async () => {
  const photo = new File([new Uint8Array([10, 20, 30])], "portrait.jpg", { type: "image/jpeg" });
  await uploadPhoto(photo, async (input, init) => {
    assert.equal(input, "/api/member/organization-photo");
    assert.equal(init?.method, "PUT");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "image/jpeg");
    assert.equal(init?.body, photo);
    return new Response(null, { status: 204 });
  });
});

test("removal sends no body and accepts the real 204 contract", async () => {
  await removePhoto(async (input, init) => {
    assert.equal(input, "/api/member/organization-photo");
    assert.equal(init?.method, "DELETE");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.body, undefined);
    return new Response(null, { status: 204 });
  });
});

test("invalid or oversized uploads fail before sending a request", async () => {
  const request: typeof fetch = async () => { assert.fail("Invalid uploads must not reach the API"); };
  const invalid = [
    new File(["not an image"], "photo.txt", { type: "text/plain" }),
    new File([], "empty.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "large.jpg", { type: "image/jpeg" }),
  ];
  for (const photo of invalid) await assert.rejects(uploadPhoto(photo, request), PhotoRequestError);
});

test("both mutation failures expose bounded Taglish status messages, never response content", async () => {
  const photo = new File(["photo"], "photo.webp", { type: "image/webp" });
  const sensitive = "private_token=DO_NOT_SHOW; internal database failure";
  for (const status of [401, 403, 413, 429, 503]) {
    for (const mutate of [(request: typeof fetch) => uploadPhoto(photo, request), removePhoto]) {
      await assert.rejects(mutate(async () => new Response(sensitive, { status })), (error: unknown) => {
        assert.ok(error instanceof PhotoRequestError);
        assert.equal(error.status, status);
        assert.match(error.message, new RegExp(`\\(${status}\\)`));
        assert.match(error.message, /Hindi ma-(save|remove) ang profile photo/);
        assert.ok(!error.message.includes(sensitive));
        assert.ok(error.message.length < 220);
        return true;
      });
    }
  }
});

test("read failures do not treat HTML or empty binary responses as an absent photo", async () => {
  for (const response of [new Response("<html>Not an API</html>"), new Response(null, { headers: { "Content-Type": "image/webp" } })]) {
    await assert.rejects(readPhoto(undefined, async () => response), (error: unknown) => {
      assert.ok(error instanceof PhotoRequestError);
      assert.equal(error.status, 502);
      return true;
    });
  }
});

test("aborted preview reads retain cancellation rather than creating a user-visible failure", async () => {
  const controller = new AbortController();
  controller.abort();
  const reason = new DOMException("Aborted", "AbortError");
  await assert.rejects(readPhoto(controller.signal, async () => { throw reason; }), (error: unknown) => error === reason);
});

test("network diagnostics do not expose untrusted exception messages", async () => {
  await assert.rejects(removePhoto(async () => { throw new Error("secret internal address"); }), (error: unknown) => {
    assert.ok(error instanceof PhotoRequestError);
    assert.equal(error.status, null);
    assert.match(error.message, /connection/);
    assert.ok(!error.message.includes("secret"));
    return true;
  });
});

test("a failed binary read keeps untrusted stream diagnostics out of the UI", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error("private stream detail")); } });
  await assert.rejects(readPhoto(undefined, async () => new Response(stream, { headers: { "Content-Type": "image/webp" } })), (error: unknown) => {
    assert.ok(error instanceof PhotoRequestError);
    assert.equal(error.status, null);
    assert.ok(!error.message.includes("private"));
    return true;
  });
});

test("a change can update the same current photo query", () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const previous = new Blob(["previous"], { type: "image/webp" });
  const replacement = new Blob(["replacement"], { type: "image/webp" });
  client.setQueryData(PHOTO_QUERY_KEY, previous);
  const startedQuery = client.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true });
  assert.equal(isCurrentPhotoChange(client, startedQuery), true);
  if (isCurrentPhotoChange(client, startedQuery)) client.setQueryData(PHOTO_QUERY_KEY, replacement);
  assert.equal(client.getQueryData(PHOTO_QUERY_KEY), replacement);
  client.clear();
});

test("cache clearing invalidates a pending photo change without recreating private data", () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(PHOTO_QUERY_KEY, new Blob(["previous owner"], { type: "image/webp" }));
  const startedQuery = client.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true });
  client.clear();
  assert.equal(isCurrentPhotoChange(client, startedQuery), false);
  if (isCurrentPhotoChange(client, startedQuery)) client.setQueryData(PHOTO_QUERY_KEY, new Blob(["late private result"]));
  assert.equal(client.getQueryData(PHOTO_QUERY_KEY), undefined);
  assert.equal(client.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true }), undefined);
});

test("same-key recreation for another session rejects the previous query identity", () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(PHOTO_QUERY_KEY, new Blob(["previous owner"], { type: "image/webp" }));
  const startedQuery = client.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true });
  client.clear();
  const currentPhoto = new Blob(["current owner"], { type: "image/webp" });
  client.setQueryData(PHOTO_QUERY_KEY, currentPhoto);
  const currentQuery = client.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true });
  assert.notEqual(startedQuery, currentQuery);
  assert.equal(isCurrentPhotoChange(client, startedQuery), false);
  assert.equal(isCurrentPhotoChange(client, currentQuery), true);
  assert.equal(client.getQueryData(PHOTO_QUERY_KEY), currentPhoto);
  client.clear();
});

test("an absent photo query never authorizes an absent change identity", () => {
  const client = new QueryClient();
  assert.equal(isCurrentPhotoChange(client, undefined), false);
});

test("a queued photo change invokes the outbound action for the current query", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(PHOTO_QUERY_KEY, null);
  const startedQuery = client.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true });
  let calls = 0;
  const applied = await runCurrentPhotoChange(client, startedQuery, async () => { calls++; });
  assert.equal(applied, true);
  assert.equal(calls, 1);
  client.clear();
});

for (const recreate of [false, true]) {
  test(`a delayed queued photo action is not sent after cache clear${recreate ? " and same-key recreation" : ""}`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(PHOTO_QUERY_KEY, new Blob(["previous owner"], { type: "image/webp" }));
    const startedQuery = client.getQueryCache().find({ queryKey: PHOTO_QUERY_KEY, exact: true });
    let release: (() => void) | undefined;
    let calls = 0;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const queued = ready.then(() => runCurrentPhotoChange(client, startedQuery, async () => { calls++; }));
    client.clear();
    const currentPhoto = new Blob(["current owner"], { type: "image/webp" });
    if (recreate) client.setQueryData(PHOTO_QUERY_KEY, currentPhoto);
    release!();
    assert.equal(await queued, false);
    assert.equal(calls, 0);
    assert.equal(client.getQueryData(PHOTO_QUERY_KEY), recreate ? currentPhoto : undefined);
    client.clear();
  });
}
