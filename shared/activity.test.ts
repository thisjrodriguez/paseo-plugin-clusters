import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentLike, usedAt } from "./activity.ts";

/** A fixed clock, so nothing here depends on how long the test takes. */
const NOW = Date.parse("2026-09-28T07:56:00.000Z");
const at = (hoursAgo: number) => NOW - hoursAgo * 3600_000;
const iso = (hoursAgo: number) => new Date(at(hoursAgo)).toISOString();

test("use is the user's last message", () => {
  assert.equal(usedAt({ lastUserMessageAt: iso(3), createdAt: iso(200) }), at(3));
});

test("a session never written to counts from when it was created", () => {
  assert.equal(usedAt({ lastUserMessageAt: null, createdAt: iso(5) }), at(5));
});

test("a record the daemon only rewrote is not use", () => {
  // What a daemon restart looks like: every agent re-saved a minute ago, none of them touched by
  // the user in days. Recents must still see them as days old.
  const restarted = { updatedAt: iso(0.01), lastActivityAt: iso(0.01) };
  const agent = { ...restarted, lastUserMessageAt: iso(70), createdAt: iso(180) } as AgentLike;
  assert.equal(usedAt(agent), at(70));
});

test("nothing to go on is not recent", () => {
  assert.equal(usedAt({}), 0);
  assert.equal(usedAt({ lastUserMessageAt: null, createdAt: null }), 0);
  assert.equal(usedAt({ lastUserMessageAt: "not a date" }), 0);
});
