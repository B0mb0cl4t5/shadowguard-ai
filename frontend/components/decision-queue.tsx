import { relativeTime } from "@/lib/format";
import { reviewContext } from "@/lib/review-context";
import type { Dashboard, Remediation, Role } from "@/lib/types";

import { SeverityBadge, VerificationBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState, Panel, SubCard } from "./ui/card";

/**
 * The one thing on this screen that waits for a person. Review opens the
 * confirmation dialog; nothing is decided from this list. `detailed` adds the
 * context behind each proposal for the Remediation tab.
 */
export function DecisionQueue({
  pending,
  data,
  role,
  now,
  onReview,
  detailed = false,
  className = "",
}: {
  pending: Remediation[];
  data: Dashboard;
  role: Role;
  now: number;
  onReview: (item: Remediation) => void;
  detailed?: boolean;
  className?: string;
}) {
  const scored = pending.map((item) => ({ item, context: reviewContext(item, data) }));
  const worstFirst = scored.sort((a, b) => (b.context.exposure?.score ?? 0) - (a.context.exposure?.score ?? 0));

  return (
    <Panel title="Block proposals" note="Nothing is blocked until an admin approves it." className={className} bodyClassName="py-2">
      {worstFirst.length === 0 ? (
        <div className="py-3">
          <EmptyState>No proposals waiting. A new one appears when a tool reaches Critical.</EmptyState>
        </div>
      ) : (
        <ul>
          {worstFirst.map(({ item, context }) => (
            <li key={item.id} className="border-b border-rule py-3 last:border-b-0">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
                    {item.app}
                    {context.exposure && <SeverityBadge severity={context.exposure.severity} score={context.exposure.score} />}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {item.department}, <span className="whitespace-nowrap font-mono">{relativeTime(item.created_at, now)}</span>
                  </p>
                </div>
                {role === "admin" ? (
                  <Button
                    variant="secondary"
                    onClick={() => onReview(item)}
                    aria-label={`Review block of ${item.app} for ${item.department}`}
                  >
                    Review
                  </Button>
                ) : (
                  <span className="shrink-0 text-xs text-muted">Waiting for an admin</span>
                )}
              </div>
              {detailed && (
                <SubCard className="mt-3 space-y-2 p-3.5 text-sm text-ink2">
                  <p>{item.detail}</p>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-muted">
                    <div className="flex gap-1.5">
                      <dt>Domain</dt>
                      <dd className="font-mono text-ink2">{item.domain}</dd>
                    </div>
                    {context.users !== null && (
                      <div className="flex gap-1.5">
                        <dt>Users affected</dt>
                        <dd className="font-mono text-ink2">{context.users}</dd>
                      </div>
                    )}
                    {context.alternative && (
                      <div className="flex gap-1.5">
                        <dt>Approved alternative</dt>
                        <dd className="text-ink2">{context.alternative}</dd>
                      </div>
                    )}
                    {context.verification && (
                      <div className="flex items-center gap-1.5">
                        <dt className="sr-only">Policy</dt>
                        <dd>
                          <VerificationBadge status={context.verification} compact />
                        </dd>
                      </div>
                    )}
                  </dl>
                </SubCard>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
