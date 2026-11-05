export type Severity = "critical" | "high" | "moderate" | "low";
export type Role = "viewer" | "admin";
export type DataLocation = "MY" | "SG" | "EU" | "US" | "OTHER" | "unknown";

/** One event in the live feed. It carries no user id, hashed or otherwise. */
export interface LiveEvent {
  id: number;
  observed_at: string;
  app_id: number;
  app: string;
  department: string;
  bytes_out: number;
  bytes_in: number;
  dest_ip: string | null;
  data_location: DataLocation;
  severity: Severity | null;
  score: number | null;
}

export interface LiveFeed {
  /** Changes whenever the full dashboard would, so it is refetched only when it needs to be. */
  revision: string;
  latest_event_id: number;
  policies_changed_at: string | null;
  last_minute: { events: number; bytes_out: number; bytes_in: number };
  events: LiveEvent[];
}

export interface DestinationIp {
  ip: string;
  bytes_out: number;
  bytes_in: number;
}

export interface Factor {
  label: string;
  points: number;
  note: string;
  /** Maximum possible points for this factor (from the backend rubric). */
  max_points?: number;
}

export interface AppDepartment {
  department: string;
  severity: Severity;
  score: number;
  users: number;
  status: "open" | "mitigated" | "accepted";
  factors: Factor[];
}

export interface ShadowApp {
  id: number;
  name: string;
  domain: string;
  category: string;
  vendor_id: number;
  vendor: string;
  posture_score: number;
  trains_on_inputs: "yes" | "no" | "unknown";
  verification_status: "verified" | "unverified";
  /** Where the vendor's privacy policy says data is stored. A stated region, not an IP lookup. */
  data_location: DataLocation;
  /** Bytes sent to this tool in the monitoring window. */
  bytes_out: number;
  /** Bytes received from it. Zero for a collector that doesn't report inbound traffic. */
  bytes_in: number;
  /** The vendor's busiest public addresses, largest first. Client addresses are never collected. */
  dest_ips: DestinationIp[];
  alternative: string | null;
  /** Set when the vendor has more than one stored policy version (newest version's date). */
  policy_changed_at: string | null;
  max_score: number;
  total_users: number;
  total_events: number;
  first_seen: string;
  last_seen: string;
  departments: AppDepartment[];
  severity: Severity;
}

export type RemediationType = "nudge" | "risk_ticket" | "block_domain";
export type RemediationStatus =
  | "executed"
  | "simulated"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "failed";

export interface Remediation {
  id: number;
  created_at: string;
  action_type: RemediationType;
  status: RemediationStatus;
  requires_approval: boolean;
  detail: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  app: string;
  domain: string;
  department: string;
}

export interface DepartmentExposure {
  name: string;
  data_class: string;
  sensitivity: number;
  max_score: number;
  shadow_tools: number;
}

export interface TrendPoint {
  day: string;
  exposure_index: number;
  detections: number;
  critical: number;
}

export interface Dashboard {
  generated_at: string;
  kpis: {
    shadow_ai_apps: number;
    active_leak_risks: number;
    exposure_index: number;
    exposure_severity: Severity;
    exposure_delta_7d: number | null;
    remediations_24h: number;
    pending_approvals: number;
    departments_affected: number;
  };
  /** The configured exposure window in days (backend `EXPOSURE_WINDOW_DAYS`). */
  exposure_window_days: number;
  severity_breakdown: Record<Severity, number>;
  trend: TrendPoint[];
  apps: ShadowApp[];
  departments: DepartmentExposure[];
  remediations: Remediation[];
}

export interface Evidence {
  field: string;
  value: string;
  quote: string;
}

export interface VendorDetail {
  id: number;
  name: string;
  website: string;
  policy_url: string | null;
  answers: Record<string, string>;
  posture_score: number;
  severity: Severity;
  factors: Factor[];
  evidence: Evidence[];
  injection_flags: string[];
  verification_status: "verified" | "unverified";
  verification_notes: string[];
  extractor: "rules" | "gemini";
  analyzed_at: string | null;
  apps: { id: number; name: string; domain: string; category: string; approved: boolean }[];
  /** Newest first; two entries mean the policy changed. */
  policy_history: PolicyVersion[];
}

export interface PolicyVersion {
  captured_at: string;
  posture_score: number;
  severity: Severity;
  verification_status: "verified" | "unverified";
  policy_text: string;
  truncated: boolean;
}

/** Result of a policy analysis (stored vendor or a dry run from the live test box). */
export interface PolicyAnalysis {
  posture_score: number;
  severity: Severity;
  factors: Factor[];
  answers: Record<string, string>;
  evidence: Evidence[];
  injection_flags: string[];
  verification_status: "verified" | "unverified";
  verification_notes: string[];
  extractor: "rules" | "gemini";
  dry_run?: boolean;
}
