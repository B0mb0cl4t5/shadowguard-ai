import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { verifyPassword } from "./password.ts";

const script = fileURLToPath(new URL("../scripts/hash-password.mjs", import.meta.url));
const output = execFileSync(process.execPath, [script, "--generate"], { encoding: "utf8" });
const lines = output.split("\n");
const code = lines[lines.findIndex((l) => l.startsWith("Access code")) + 1].trim();
const printedHash = lines[lines.findIndex((l) => l.startsWith("Hash for")) + 1];
const hash = printedHash.trim();

test("a generated code matches its hash", async () => {
  assert.equal(await verifyPassword(code, hash), true);
});

test("the hash still matches when pasted with the script's indentation", async () => {
  assert.notEqual(printedHash, hash);
  assert.equal(await verifyPassword(code, printedHash), true);
});

test("the hash still matches when a terminal wrapped it across lines", async () => {
  const wrapped = `${hash.slice(0, 7)}\r\n${hash.slice(7, 40)}\n${hash.slice(40)}\n`;
  assert.equal(await verifyPassword(code, wrapped), true);
});

test("a wrong code is refused", async () => {
  assert.equal(await verifyPassword(`${code}x`, hash), false);
});

test("a different hash is refused", async () => {
  const parts = hash.split(":");
  parts[3] = Buffer.alloc(32, 1).toString("base64");
  assert.equal(await verifyPassword(code, parts.join(":")), false);
});

test("a missing or malformed hash is refused", async () => {
  assert.equal(await verifyPassword(code, undefined), false);
  assert.equal(await verifyPassword(code, "not-a-hash"), false);
});
