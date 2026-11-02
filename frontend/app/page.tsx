import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { ShieldMark } from "@/components/icons";
import { BackendError, backendFetch } from "@/lib/backend";
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
        <div className="glass max-w-md p-8 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-300/30">
            <ShieldMark size={24} />
          </span>
          <h1 className="text-lg font-semibold text-white">Can&apos;t reach the risk engine</h1>
          <p className="mt-2 text-sm text-slate-400">{problem}</p>
          <p className="mt-4 text-xs text-slate-500">
            Check SHADOWGUARD_API_URL and the backend API keys in this deployment&apos;s environment.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <DashboardShell initial={data} role={session.role} />
    </main>
  );
}
