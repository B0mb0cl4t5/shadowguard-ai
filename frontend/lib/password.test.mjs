import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { roleForCredentials, verifyPassword } from "./password.ts";

const script = fileURLToPath(new URL("../scripts/hash-password.mjs", import.meta.url));

function generate() {
  const output = execFileSync(process.execPath, [script, "--generate"], { encoding: "utf8" });
  const lines = output.split("\n");
  return {
    password: lines[lines.findIndex((l) => l.startsWith("Password")) + 1].trim(),
    printedHash: lines[lines.findIndex((l) => l.startsWith("Hash for")) + 1],
  };
}

const { password, printedHash } = generate();
const hash = printedHash.trim();

test("a generated password matches its hash", async () => {
  assert.equal(await verifyPassword(password, hash), true);
});

test("the hash still matches when pasted with the script's indentation", async () => {
  assert.notEqual(printedHash, hash);
  assert.equal(await verifyPassword(password, printedHash), true);
});

test("the hash still matches when a terminal wrapped it across lines", async () => {
  const wrapped = `${hash.slice(0, 7)}\r\n${hash.slice(7, 40)}\n${hash.slice(40)}\n`;
  assert.equal(await verifyPassword(password, wrapped), true);
});

test("a wrong password is refused", async () => {
  assert.equal(await verifyPassword(`${password}x`, hash), false);
});

test("a different hash is refused", async () => {
  const parts = hash.split(":");
  parts[3] = Buffer.alloc(32, 1).toString("base64");
  assert.equal(await verifyPassword(password, parts.join(":")), false);
});

test("a missing or malformed hash is refused", async () => {
  assert.equal(await verifyPassword(password, undefined), false);
  assert.equal(await verifyPassword(password, "not-a-hash"), false);
});

const viewer = generate();
const ENV_NAMES = [
  "DASHBOARD_ADMIN_CODE_HASH",
  "DASHBOARD_VIEWER_CODE_HASH",
  "DASHBOARD_ADMIN_USERNAME",
  "DASHBOARD_VIEWER_USERNAME",
];

beforeEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.DASHBOARD_ADMIN_CODE_HASH = hash;
  process.env.DASHBOARD_VIEWER_CODE_HASH = viewer.printedHash;
});

afterEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
});

test("default usernames sign in with the matching role", async () => {
  assert.equal(await roleForCredentials("admin", password), "admin");
  assert.equal(await roleForCredentials("viewer", viewer.password), "viewer");
});

test("usernames ignore case and surrounding spaces", async () => {
  assert.equal(await roleForCredentials("  Admin ", password), "admin");
});

test("configured usernames replace the defaults", async () => {
  process.env.DASHBOARD_ADMIN_USERNAME = "Zi.Xuan";
  assert.equal(await roleForCredentials("zi.xuan", password), "admin");
  assert.equal(await roleForCredentials("admin", password), null);
});

test("a password only works with its own username", async () => {
  assert.equal(await roleForCredentials("viewer", password), null);
  assert.equal(await roleForCredentials("admin", viewer.password), null);
  assert.equal(await roleForCredentials("nobody", password), null);
});

test("a wrong password is refused for a real username", async () => {
  assert.equal(await roleForCredentials("admin", `${password}x`), null);
});

test("no account can sign in when the hashes are not configured", async () => {
  delete process.env.DASHBOARD_ADMIN_CODE_HASH;
  delete process.env.DASHBOARD_VIEWER_CODE_HASH;
  assert.equal(await roleForCredentials("admin", password), null);
});
