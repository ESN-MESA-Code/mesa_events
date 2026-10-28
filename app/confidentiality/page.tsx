import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { CONFIDENTIALITY_VERSION } from "@/lib/legal";
import { legalHtml } from "@/lib/legalContent";
import { getViewer } from "@/lib/supabase/session";

export const metadata: Metadata = { title: "Confidentiality" };

const ERRORS: Record<string, string> = {
  changed: "The rules have changed in the meantime – please read them again.",
  failed: "That did not work. Please try again.",
};

// Shown once after a member's first login (and again when the text changes):
// the rules in legal/organiser-confidentiality.md. Nothing in the member
// area opens before they are accepted.
export default async function ConfidentialityPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext ?? null);

  // Defence in depth – the proxy already redirects signed-out visitors.
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/confidentiality?next=${next}`)}`);
  if (viewer.accepted) redirect(next);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <article className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-10">
        <div className="legal-prose" dangerouslySetInnerHTML={{ __html: legalHtml("organiser-confidentiality") }} />

        {error && (
          <p role="alert" className="mt-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {ERRORS[error] ?? ERRORS.failed}
          </p>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200 flex flex-col sm:flex-row gap-3">
          <form action="/confidentiality/accept" method="post" className="flex-1">
            <input type="hidden" name="version" value={CONFIDENTIALITY_VERSION} />
            <input type="hidden" name="next" value={next} />
            <button className="w-full bg-esn text-white py-2.5 px-4 rounded-md text-sm font-medium hover:bg-esn-dark transition-colors">
              I accept / Ich akzeptiere
            </button>
          </form>
          <form action="/auth/signout" method="post">
            <button className="w-full border border-gray-300 text-gray-700 py-2.5 px-4 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors">
              Sign out / Abmelden
            </button>
          </form>
        </div>
        <p className="text-xs text-gray-500 mt-3">Signed in as {viewer.email}</p>
      </article>
    </main>
  );
}
