import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { ShieldMark } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { BackendError, backendFetch } from "@/lib/backend";
import { demoRole } from "@/lib/demo-mode";
import { sessionCookieName, verifySessionToken } from "@/lib/session";
import type { Dashboard } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Re-verify here as well as in middleware (defence in depth, OWASP A01).
  const session = await verifySessionToken((await cookies()).get(sessionCookieName())?.value);
  if (!session) redirect("/login");

  let data: Dashboard | null = null;
  let problem = "";
  try {
    data = await backendFetch<Dashboard>("/api/v1/dashboard", { role: "viewer" });
  } catch (err) {
    problem = err instanceof BackendError ? err.message : "The risk engine is unreachable";
  }

  if (!data) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card className="max-w-md p-5">
          <ShieldMark size={22} className="mb-3 text-warning" />
          <h1 className="text-lg font-semibold text-ink">Can&apos;t reach the risk engine</h1>
          <p className="mt-2 text-sm text-muted">{problem}</p>
          <p className="mt-4 text-xs text-muted">
            Check <span className="font-mono">SHADOWGUARD_API_URL</span> and the backend API keys in this deployment&apos;s environment.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main>
      <DashboardShell initial={data} role={session.role} demo={demoRole() !== null} />
    </main>
  );
}
