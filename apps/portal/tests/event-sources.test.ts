import assert from "node:assert/strict";
import test from "node:test";
import { automaticEventSource } from "@pytorch-ph/domain-protocol/organization";

test("recognizes Luma and Meetup event links", () => {
  assert.equal(automaticEventSource("https://lu.ma/pytorch-ph-meetup"), "Luma");
  assert.equal(automaticEventSource("https://luma.com/abc123"), "Luma");
  assert.equal(automaticEventSource("https://www.meetup.com/pytorch-manila/events/1/"), "Meetup");
});

test("returns null for unsupported or unsafe links", () => {
  assert.equal(automaticEventSource("https://example.org/event"), null);
  assert.equal(automaticEventSource("http://lu.ma/insecure"), null);
  assert.equal(automaticEventSource("https://notmeetup.com/event"), null);
  assert.equal(automaticEventSource("https://lu.ma.example.org/event"), null);
  assert.equal(automaticEventSource("not a link"), null);
});
