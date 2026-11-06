#!/usr/bin/env node
/**
 * Hash a dashboard password for DASHBOARD_ADMIN_CODE_HASH / DASHBOARD_VIEWER_CODE_HASH.
 *
 *   npm run hash-password            # prompts, input hidden
 *   npm run hash-password -- --generate   # creates a strong random password and its hash
 *
 * Output format: pbkdf2_sha256:<iterations>:<salt b64>:<hash b64>
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const ITERATIONS = 600_000; // OWASP Password Storage Cheat Sheet (2023) figure for PBKDF2-HMAC-SHA256

function hash(code) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(code, salt, ITERATIONS, 32, "sha256");
  return `pbkdf2_sha256:${ITERATIONS}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

function done(code, generated) {
  if (code.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  if (code.length > 128) {
    console.error("Use at most 128 characters.");
    process.exit(1);
  }
  if (generated) console.log(`\nPassword (share privately, shown once):\n  ${code}`);
  console.log(`\nHash for the environment variable:\n  ${hash(code)}\n`);
}

if (process.argv.includes("--generate")) {
  done(randomBytes(18).toString("base64url"), true);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => {
    if (s.includes("Password to hash")) process.stdout.write(s);
  };
  rl.question("Password to hash: ", (code) => {
    rl.close();
    process.stdout.write("\n");
    done(code.trim(), false);
  });
}
