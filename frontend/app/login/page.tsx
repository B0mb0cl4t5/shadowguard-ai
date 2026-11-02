import { ShieldMark } from "@/components/icons";
import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(next);

  return (
    <main className="grid min-h-dvh place-items-center p-5">
      <div className="glass w-full max-w-sm p-7 sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-signal/10 text-signal ring-1 ring-inset ring-signal/30 shadow-glow-signal">
            <ShieldMark size={24} />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">ShadowGuard AI</h1>
            <p className="text-xs text-slate-400">Shadow AI risk governance</p>
          </div>
        </div>
        <LoginForm next={target} />
        <p className="mt-6 text-[0.7rem] leading-relaxed text-slate-500">
          Restricted to university IT security staff. Sign-in attempts are rate-limited and logged.
        </p>
      </div>
    </main>
  );
}
