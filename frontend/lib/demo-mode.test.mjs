import assert from "node:assert/strict";
import { test } from "node:test";

import { demoRole } from "./demo-mode.ts";

test("demo sign-in is off unless explicitly set", () => {
  for (const value of [undefined, "", "true", "yes", "1", "root", "administrator"]) {
    assert.equal(demoRole(value), null, `${JSON.stringify(value)} must leave it off`);
  }
});

test("demo sign-in accepts only the two roles", () => {
  assert.equal(demoRole("admin"), "admin");
  assert.equal(demoRole(" Viewer "), "viewer");
});
