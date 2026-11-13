import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

test("firewall export retains approved, executed, and verified domain blocks", () => {
  const src = read("components/governance-export.tsx");
  assert.match(src, /r\.status === "approved"\s*\|\|\s*r\.status === "executed"\s*\|\|\s*r\.status === "verified"/);
  assert.match(src, /r\.status === "pending_approval"/);
});

test("block lifecycle advancement waits for server confirmation before reporting success", () => {
  const logSrc = read("components/remediation-log.tsx");
  const awaitAt = logSrc.indexOf("await advanceRemediation(");
  const toastAt = logSrc.indexOf("onToast?.(", awaitAt);
  const changedAt = logSrc.indexOf("onChanged?.()", awaitAt);
  assert.ok(awaitAt > 0, "remediation-log invokes advanceRemediation");
  assert.ok(toastAt > awaitAt, "success toast runs only after await advanceRemediation");
  assert.ok(changedAt > awaitAt, "reload callback runs only after await advanceRemediation");
});

test("audit verification waits for server response and routes guard rate limits before backendFetch", () => {
  const exportSrc = read("components/governance-export.tsx");
  const awaitAt = exportSrc.indexOf("await verifyAuditChain()");
  const toastAt = exportSrc.indexOf("onToast({", awaitAt);
  assert.ok(awaitAt > 0 && toastAt > awaitAt);

  for (const route of ["app/api/audit/verify/route.ts", "app/api/remediations/[id]/advance/route.ts"]) {
    const src = read(route);
    const body = src.slice(src.indexOf("export async function"));
    const limitIdx = body.indexOf("overBudget(");
    const fetchIdx = body.indexOf("backendFetch");
    assert.ok(body.includes('requireSession(["admin"])'), `${route} requires admin session`);
    assert.ok(limitIdx > 0 && fetchIdx > limitIdx, `${route} checks rate limit before backendFetch`);
  }
});

test("print view includes an executive summary header hidden on screen", () => {
  const shellSrc = read("components/dashboard-shell.tsx");
  assert.match(shellSrc, /className="hidden print:block[^"]*"/);
  assert.match(shellSrc, /Executive Governance Brief/);
});
