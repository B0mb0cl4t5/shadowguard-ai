import type { Tone } from "./format";
import type { DataLocation, PolicyAnalysis, ShadowApp } from "./types";

export type PdpaCheck = {
  section: string;
  principle: string;
  status: "Pass" | "Review" | "Violation";
  tone: Tone;
  detail: string;
};

/**
 * Evaluates a vendor's extracted privacy policy answers against Malaysia's
 * Personal Data Protection Act 2010 (Act 709, as amended 2024).
 */
export function evaluatePdpa(analysis: Pick<PolicyAnalysis, "answers" | "verification_status">): PdpaCheck[] {
  const a = analysis.answers;
  const train = a.trains_on_inputs ?? "unknown";
  const optOut = a.opt_out ?? "unknown";
  const share = a.third_party_sharing ?? "unknown";
  const retention = a.retention ?? "unknown";
  const location = (a.data_location ?? "unknown") as DataLocation;

  // 1. Section 9 — Security Principle (Training & Opt-Out)
  let sec9: PdpaCheck;
  if (train === "yes" && optOut === "no") {
    sec9 = {
      section: "s. 9",
      principle: "Security Principle",
      status: "Violation",
      tone: "danger",
      detail: "Uploaded data is used to train foundation models with no opt-out.",
    };
  } else if (train === "yes" || train === "unknown" || optOut === "unknown") {
    sec9 = {
      section: "s. 9",
      principle: "Security Principle",
      status: "Review",
      tone: "warning",
      detail:
        train === "yes"
          ? "Trains on user inputs unless an administrator explicitly opts out."
          : "Policy does not clearly rule out model training on uploaded records.",
    };
  } else {
    sec9 = {
      section: "s. 9",
      principle: "Security Principle",
      status: "Pass",
      tone: "success",
      detail: "Policy states customer inputs are never used to train models.",
    };
  }

  // 2. Section 8 — Disclosure Principle (Third-Party Sharing)
  let sec8: PdpaCheck;
  if (share === "yes") {
    sec8 = {
      section: "s. 8",
      principle: "Disclosure Principle",
      status: "Violation",
      tone: "danger",
      detail: "Permits disclosing uploaded content to third parties, partners or advertisers.",
    };
  } else if (share === "unknown") {
    sec8 = {
      section: "s. 8",
      principle: "Disclosure Principle",
      status: "Review",
      tone: "warning",
      detail: "Third-party disclosure boundaries are not stated in the policy.",
    };
  } else {
    sec8 = {
      section: "s. 8",
      principle: "Disclosure Principle",
      status: "Pass",
      tone: "success",
      detail: "Does not sell or disclose customer content to third parties.",
    };
  }

  // 3. Section 10 — Retention Principle
  let sec10: PdpaCheck;
  if (retention === "indefinite" || retention === ">365d") {
    sec10 = {
      section: "s. 10",
      principle: "Retention Principle",
      status: "Violation",
      tone: "danger",
      detail: `Retains uploaded records (${retention}) beyond the time needed for processing.`,
    };
  } else if (retention === "31-365d" || retention === "unknown") {
    sec10 = {
      section: "s. 10",
      principle: "Retention Principle",
      status: "Review",
      tone: "warning",
      detail:
        retention === "unknown"
          ? "Policy does not commit to a deletion schedule."
          : "Retains uploaded records for up to a year (31–365 days).",
    };
  } else {
    sec10 = {
      section: "s. 10",
      principle: "Retention Principle",
      status: "Pass",
      tone: "success",
      detail: "Deletes uploaded content within 30 days.",
    };
  }

  // 4. Section 129 — Cross-Border Data Transfer
  let sec129: PdpaCheck;
  if (location === "MY") {
    sec129 = {
      section: "s. 129",
      principle: "Cross-Border Transfer",
      status: "Pass",
      tone: "success",
      detail: "Data is stored in Malaysia in compliance with local residency.",
    };
  } else if (location === "SG" || location === "EU" || location === "US") {
    sec129 = {
      section: "s. 129",
      principle: "Cross-Border Transfer",
      status: "Review",
      tone: "warning",
      detail: `Transferred outside Malaysia (${location}); requires a Data Processing Addendum or consent.`,
    };
  } else {
    sec129 = {
      section: "s. 129",
      principle: "Cross-Border Transfer",
      status: "Violation",
      tone: "danger",
      detail: "Storage jurisdiction is unstated or outside approved adequacy regions.",
    };
  }

  return [sec9, sec8, sec10, sec129];
}

/** Concise summary string of PDPA issues for an app in the CSV audit export. */
export function summarizeAppPdpa(app: ShadowApp): string {
  const issues: string[] = [];
  if (app.trains_on_inputs === "yes") issues.push("s.9 Training");
  if (app.data_location !== "MY") issues.push(`s.129 Transfer (${app.data_location})`);
  if (app.verification_status === "unverified") issues.push("Unverified policy");
  return issues.length > 0 ? issues.join("; ") : "Compliant";
}
