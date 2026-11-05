import { DemoSignIn } from "@/components/demo-sign-in";
import { ShieldMark } from "@/components/icons";
import { LoginForm } from "@/components/login-form";
import { Card } from "@/components/ui/card";
import { demoRole } from "@/lib/demo-mode";
import { safeNextPath } from "@/lib/safe-next";
import { MAP_H, MAP_W, dotPath, isMalaysia } from "@/lib/world-map";

export const dynamic = "force-dynamic";

const LAND = dotPath();
const CAMPUS = dotPath(isMalaysia);

const FACTS = [
  "Metadata only: domain, department, time and volume. No message content, no staff identities.",
  "Every answer about a vendor's privacy policy is backed by a sentence quoted from it.",
  "Nothing is blocked automatically. A block waits for an admin to approve it.",
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(next);
  const demo = demoRole();

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[1200px] items-center gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-16">
      <section className="order-last lg:order-none">
        <div className="hidden items-center gap-2.5 lg:flex">
          <ShieldMark size={24} className="shrink-0 text-accent" />
          <span className="text-md font-semibold text-ink">ShadowGuard AI</span>
        </div>
        <h1 className="max-w-[30ch] text-title font-semibold tracking-tight text-ink lg:mt-6">
          Find the AI tools staff are using before student data leaks
        </h1>
        <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-ink2">
          ShadowGuard reads your network logs, checks what each AI vendor&apos;s privacy policy says it does with uploaded
          data, and scores the risk for every department.
        </p>
        {/* The same dotted world as the dashboard's traffic map, with the campus lit. */}
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="mt-8 hidden w-full max-w-[560px] lg:block" aria-hidden>
          <path d={LAND} fill="none" style={{ stroke: "var(--raised-hover)" }} strokeWidth="3.4" strokeLinecap="round" />
          <path d={CAMPUS} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="3.4" strokeLinecap="round" />
        </svg>
        <ul className="mt-8 grid max-w-[60ch] gap-3 border-t border-rule pt-6">
          {FACTS.map((fact) => (
            <li key={fact} className="flex gap-3 text-sm text-ink2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              {fact}
            </li>
          ))}
        </ul>
      </section>

      <Card className="w-full max-w-sm justify-self-center p-6 lg:justify-self-end">
        {/* On a phone the product story sits below the form, so the name comes first here. */}
        <div className="mb-5 flex items-center gap-2.5 lg:hidden">
          <ShieldMark size={22} className="shrink-0 text-accent" />
          <span className="text-md font-semibold text-ink">ShadowGuard AI</span>
        </div>
        <h2 className="text-md font-semibold text-ink">Sign in</h2>
        <p className="mt-1 text-sm text-muted">For university IT security staff.</p>
        {demo ? (
          // Demo mode: the one-click button leads, and the password form stays one click away.
          <div className="mt-5">
            <DemoSignIn role={demo} next={target} />
            <details className="mt-5 border-t border-rule pt-4">
              <summary className="cursor-pointer text-sm text-ink2 transition-colors hover:text-ink">Sign in with a password instead</summary>
              <div className="mt-4">
                <LoginForm next={target} />
              </div>
            </details>
          </div>
        ) : (
          <div className="mt-5">
            <LoginForm next={target} />
          </div>
        )}
        <p className="mt-5 text-xs leading-relaxed text-muted">Sign-in attempts are rate-limited and logged.</p>
      </Card>
    </main>
  );
}
