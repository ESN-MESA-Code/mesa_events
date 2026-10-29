import Link from "next/link";

/**
 * The thin strip on top of every page of a staging deployment (root
 * layout). It carries the presenters' links too: "Switch role" (the demo
 * sign-in) and the demo outbox. Server component: nothing of it is in a
 * production build's browser bundle.
 */
export function StagingBanner({ signIn }: { signIn: boolean }) {
  return (
    <div
      role="note"
      aria-label="Staging environment"
      data-testid="staging-banner"
      className="bg-amber-300 text-amber-950 text-xs sm:text-sm border-b border-amber-500 bg-[repeating-linear-gradient(135deg,transparent,transparent_12px,rgb(0_0_0/0.04)_12px,rgb(0_0_0/0.04)_24px)]"
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-semibold mr-auto">
          <span aria-hidden="true">🧪 </span>Staging – demo data only, nothing is real
        </p>
        <nav aria-label="Demo" className="flex items-center gap-3">
          <Link href="/admin/demo-outbox" className="underline underline-offset-2 hover:no-underline">
            Demo outbox
          </Link>
          {signIn && (
            <Link href="/staging" className="underline underline-offset-2 hover:no-underline font-semibold">
              Switch role
            </Link>
          )}
        </nav>
      </div>
    </div>
  );
}
