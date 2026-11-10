"use client";

import { useState } from "react";

import { summarizeAppPdpa } from "@/lib/pdpa";
import type { Dashboard } from "@/lib/types";
import type { Toast } from "@/lib/use-toast";

import { Badge } from "./ui/badge";
import { Button, Segmented } from "./ui/button";
import { Panel, SubCard } from "./ui/card";

type FirewallTarget = "fortigate" | "squid";

function blockedDomains(data: Dashboard): { approved: string[]; staged: string[] } {
  const approvedSet = new Set<string>();
  const stagedSet = new Set<string>();
  for (const r of data.remediations) {
    if (r.action_type !== "block_domain") continue;
    if (r.status === "approved") approvedSet.add(r.domain);
    else if (r.status === "pending_approval") stagedSet.add(r.domain);
  }
  for (const d of approvedSet) stagedSet.delete(d);
  return {
    approved: [...approvedSet].sort(),
    staged: [...stagedSet].sort(),
  };
}

export function buildFortigateConfig(data: Dashboard): string {
  const { approved, staged } = blockedDomains(data);
  const lines = [
    "# ShadowGuard AI — FortiGate Web Filter URL Blocklist",
    `# Generated: ${data.generated_at}`,
    `# Approved blocks: ${approved.length} | Pending admin approval: ${staged.length}`,
    "config webfilter urlfilter",
    "    edit 9001",
    '        set name "ShadowGuard-Unapproved-AI"',
    "        config entries",
  ];
  let idx = 1;
  for (const domain of approved) {
    lines.push(
      `            edit ${idx}`,
      `                set url "*.${domain}"`,
      "                set type wildcard",
      "                set action block",
      "                set status enable",
      "            next",
    );
    idx += 1;
  }
  for (const domain of staged) {
    lines.push(
      `            # STAGED (awaiting admin approval in ShadowGuard): ${domain}`,
      `            # edit ${idx}`,
      `            #     set url "*.${domain}"`,
      "            #     set type wildcard",
      "            #     set action block",
      "            #     set status disable",
      "            # next",
    );
    idx += 1;
  }
  lines.push("        end", "    next", "end");
  return lines.join("\n");
}

export function buildSquidAcl(data: Dashboard): string {
  const { approved, staged } = blockedDomains(data);
  const lines = [
    "# ShadowGuard AI — Squid Proxy dstdomain ACL Blocklist",
    `# Generated: ${data.generated_at}`,
    "# Usage in squid.conf:",
    '#   acl shadowguard_blocked dstdomain "/etc/squid/shadowguard-blocked.acl"',
    "#   http_access deny shadowguard_blocked",
    "",
  ];
  for (const domain of approved) {
    lines.push(`.${domain}`);
  }
  for (const domain of staged) {
    lines.push(`# STAGED (awaiting admin approval): .${domain}`);
  }
  return lines.join("\n");
}

function csvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildPdpaCsv(data: Dashboard): string {
  const headers = [
    "Tool",
    "Vendor",
    "Domain",
    "Category",
    "Worst Exposure Score",
    "Severity",
    "Posture Score",
    "Policy Verification",
    "Trains on Input",
    "Storage Region",
    "Active Users",
    "Bytes Out",
    "Bytes In",
    "Departments Reached",
    "PDPA (Act 709) Assessment",
    "Approved Alternative",
  ];
  const rows = [...data.apps]
    .sort((a, b) => b.max_score - a.max_score)
    .map((app) =>
      [
        app.name,
        app.vendor,
        app.domain,
        app.category,
        app.max_score,
        app.severity,
        app.posture_score,
        app.verification_status,
        app.trains_on_inputs,
        app.data_location,
        app.total_users,
        app.bytes_out,
        app.bytes_in,
        app.departments.map((d) => `${d.department} (${d.score})`).join(" | "),
        summarizeAppPdpa(app),
        app.alternative ?? "None",
      ]
        .map(csvCell)
        .join(","),
    );
  return [headers.map(csvCell).join(","), ...rows].join("\r\n");
}

export function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function GovernanceExport({
  data,
  onToast,
  className = "",
}: {
  data: Dashboard;
  onToast: (t: Omit<Toast, "id" | "leaving">) => void;
  className?: string;
}) {
  const [target, setTarget] = useState<FirewallTarget>("fortigate");
  const { approved, staged } = blockedDomains(data);
  const configText = target === "fortigate" ? buildFortigateConfig(data) : buildSquidAcl(data);
  const configFilename = target === "fortigate" ? "shadowguard-fortigate-blocklist.conf" : "shadowguard-squid-blocked.acl";

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(configText);
      onToast({
        title: "Firewall rule copied",
        description: `${target === "fortigate" ? "FortiGate CLI" : "Squid ACL"} configuration copied to your clipboard.`,
        tone: "success",
      });
    } catch {
      onToast({
        title: "Could not copy",
        description: "Use the Download button to save the configuration file instead.",
        tone: "warning",
      });
    }
  }

  return (
    <Panel
      title="Firewall enforcement & PDPA compliance export"
      note="Export human-approved domain blocks as ready-to-apply FortiGate or Squid rules, or download a full PDPA (Act 709) governance audit CSV."
      tone="accent"
      className={className}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Firewall format"
            value={target}
            onChange={setTarget}
            options={[
              { value: "fortigate", label: "FortiGate CLI" },
              { value: "squid", label: "Squid ACL" },
            ]}
          />
          <Button variant="secondary" size="sm" onClick={() => void copyConfig()}>
            Copy rule
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              downloadTextFile(configFilename, configText);
              onToast({
                title: "Firewall rule downloaded",
                description: `Saved ${configFilename} (${approved.length} active blocks, ${staged.length} staged).`,
                tone: "success",
              });
            }}
          >
            Download rule
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              downloadTextFile("shadowguard-pdpa-audit.csv", buildPdpaCsv(data), "text/csv;charset=utf-8");
              onToast({
                title: "PDPA audit report downloaded",
                description: `Saved shadowguard-pdpa-audit.csv with ${data.apps.length} tools and statutory checks.`,
                tone: "success",
              });
            }}
          >
            Export PDPA CSV
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 pb-3 text-xs text-ink2">
        <Badge tone="success">{approved.length} approved {approved.length === 1 ? "block" : "blocks"} active</Badge>
        <Badge tone="warning">{staged.length} pending human approval (commented out)</Badge>
        <span className="text-muted">Only blocks approved by an admin are enabled in the exported rule.</span>
      </div>
      <SubCard className="max-h-56 overflow-x-auto overflow-y-auto p-3.5 font-mono text-xs leading-relaxed text-ink2">
        <pre>{configText}</pre>
      </SubCard>
    </Panel>
  );
}
