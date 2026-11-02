import assert from "node:assert/strict";
import { test } from "node:test";

import { safeNextPath } from "./safe-next.ts";

for (const next of [
  "//evil.example",
  "/\\evil.example",
  "/\\/evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "/.//evil.example",
  "/a/..//evil.example",
  "https://evil.example",
  "evil.example",
  "",
  undefined,
  ["/", "//evil.example"],
]) {
  test(`refuses ${JSON.stringify(next)}`, () => {
    assert.equal(safeNextPath(next), "/");
  });
}

for (const next of ["/", "/settings", "/?severity=high&sort=exposure", "/vendors/4#policy"]) {
  test(`keeps ${next}`, () => {
    assert.equal(safeNextPath(next), next);
  });
}
