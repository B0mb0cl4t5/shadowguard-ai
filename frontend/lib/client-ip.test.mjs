import assert from "node:assert/strict";
import { test } from "node:test";

import { clientIpFrom, UNTRUSTED } from "./client-ip.ts";

const forwarded = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });

test("a forwarded address is ignored unless a known proxy set it", () => {
  // Anyone can send this header; trusting it here would let a client pick a fresh address per guess.
  assert.equal(clientIpFrom(forwarded, {}), UNTRUSTED);
  assert.equal(clientIpFrom(forwarded, { TRUST_PROXY: "false" }), UNTRUSTED);
  assert.equal(clientIpFrom(forwarded, { VERCEL: "0" }), UNTRUSTED);
});

test("on Vercel, or with TRUST_PROXY, the first forwarded hop is the client", () => {
  assert.equal(clientIpFrom(forwarded, { VERCEL: "1" }), "203.0.113.7");
  assert.equal(clientIpFrom(forwarded, { TRUST_PROXY: " True " }), "203.0.113.7");
});

test("a trusted proxy that sent no address still yields a bucket", () => {
  assert.equal(clientIpFrom(new Headers(), { VERCEL: "1" }), "unknown");
  assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "" }), { VERCEL: "1" }), "unknown");
});
