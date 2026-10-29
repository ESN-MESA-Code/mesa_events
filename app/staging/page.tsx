import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { getViewer } from "@/lib/supabase/session";
import { WORKSPACE_DOMAIN } from "@/lib/auth";
import { stagingSignInEnabled, supabaseProjectRef } from "@/lib/staging";
import { ACCESS_COOKIE, hasAccess } from "@/lib/staging/access";
import { PERSONAS, demoEmail, person } from "@/lib/staging/people";

export const metadata: Metadata = { title: "Demo sign-in" };

const ERRORS: Record<string, string> = {
  wrong_code: "That is not the access code.",
  too_many: "Too many wrong codes. Wait 15 minutes and try again.",
  unknown_role: "Pick one of the roles below.",
  not_seeded: "The demo members are missing. An admin resets the demo data (docs/STAGING.md).",
};

// The staging demo sign-in: the access code first, then a role picker.
// Server-rendered with plain forms, so a production build has none of it in
// its browser bundle; and it answers 404 unless every staging gate holds.
export default async function StagingSignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "staging" || !stagingSignInEnabled()) notFound();
  const { error } = await searchParams;
  const unlocked = hasAccess((await cookies()).get(ACCESS_COOKIE)?.value, process.env.STAGING_ACCESS_CODE, supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL));
  const viewer = unlocked ? await getViewer() : null;
  const message = error ? (ERRORS[error] ?? null) : null;

  return (
    <main className="min-h-full flex justify-center px-4 py-8">
      <div className="w-full max-w-3xl space-y-5">
        <div className="text-center">
          <BrandMark tone="dark" size="lg" />
          <h1 className="text-xl font-bold text-gray-900 mt-4">Demo sign-in</h1>
          <p className="text-sm text-gray-500 mt-1">
            Staging only – every person and event here is made up. Pick a role to see the platform through their eyes.
          </p>
        </div>

        {message && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {message}
          </p>
        )}

        {!unlocked ? (
          <form action="/auth/staging/code" method="post" className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 max-w-sm mx-auto space-y-3">
            <label htmlFor="code" className="block text-sm font-medium text-gray-700">
              Access code
            </label>
            <input
              id="code"
              name="code"
              type="password"
              required
              autoComplete="off"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button className="w-full rounded-md bg-esn px-4 py-2.5 text-sm font-medium text-white hover:bg-esn/90">Continue</button>
            <p className="text-xs text-gray-500">The presenters share the code. Members can also sign in with Google on the normal sign-in page.</p>
          </form>
        ) : (
          <>
            {viewer && (
              <p className="text-sm text-gray-600 text-center" data-testid="signed-in-as">
                Signed in as <strong>{viewer.name}</strong>.{" "}
                <Link href="/" className="text-esn underline underline-offset-2">
                  Back to the app
                </Link>
              </p>
            )}
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Roles">
              {PERSONAS.map((p) => {
                const who = person(p.person);
                return (
                  <li key={p.key}>
                    <form action="/auth/staging/sign-in" method="post" className="h-full">
                      <input type="hidden" name="persona" value={p.key} />
                      <button className="h-full w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-esn hover:shadow focus-visible:outline-2 focus-visible:outline-esn">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-semibold text-gray-900">{p.label}</span>
                          <span className="text-xs text-gray-500">as {who.name}</span>
                        </span>
                        <span className="block text-sm text-gray-600 mt-1">{p.sees}</span>
                        <span className="sr-only">{demoEmail(who, WORKSPACE_DOMAIN)}</span>
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
