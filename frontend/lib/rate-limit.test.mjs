import assert from "node:assert/strict";
import { test } from "node:test";

import { allowShared } from "./rate-limit.ts";

const checks = (ip) => [
  { key: `login:m:${ip}`, limit: 2, windowMs: 60_000 },
  { key: `login:h:${ip}`, limit: 30, windowMs: 3_600_000 },
];

test("the shared count gets hashed buckets, never the client IP", async () => {
  let sent;
  const allowed = await allowShared(checks("203.0.113.40"), async (shared) => ((sent = shared), true));
  assert.equal(allowed, true);
  assert.equal(sent.length, 2);
  for (const c of sent) {
    assert.match(c.bucket, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(c).includes("203.0.113.40"));
  }
  assert.deepEqual(sent.map((c) => c.windowSeconds), [60, 3600]);
});

test("the shared count can refuse what this instance would allow", async () => {
  assert.equal(await allowShared(checks("203.0.113.41"), async () => false), false);
});

test("this instance's limit applies first and keeps floods off the database", async () => {
  let calls = 0;
  const send = async () => ((calls += 1), true);
  const ip = "203.0.113.42";
  assert.equal(await allowShared(checks(ip), send), true);
  assert.equal(await allowShared(checks(ip), send), true);
  assert.equal(await allowShared(checks(ip), send), false);
  assert.equal(calls, 2);
});

test("an unreachable shared count falls back to this instance's limit", async () => {
  const unreachable = async () => {
    throw Object.assign(new Error("The risk engine is unreachable"), { status: 502 });
  };
  assert.equal(await allowShared(checks("203.0.113.43"), unreachable), true);
});

test("a 'too many requests' answer refuses the attempt", async () => {
  const flooded = async () => {
    throw Object.assign(new Error("Too many requests"), { status: 429 });
  };
  assert.equal(await allowShared(checks("203.0.113.44"), flooded), false);
});
