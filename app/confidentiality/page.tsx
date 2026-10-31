import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { CONFIDENTIALITY_VERSION } from "@/lib/legal";
import { legalHtml } from "@/lib/legalContent";
import { getViewer } from "@/lib/supabase/session";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { LangTabs } from "@/components/LangTabs";

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

  // English and German as tabs, not stacked (usability review #15); the text is split at its rule (---).
  const [en, rest = ""] = legalHtml("organiser-confidentiality").split(/<hr\s*\/?>/);
  // The version line closes the German part but belongs to both.
  const [de, version = ""] = rest.split(/(?=<p><em>Version)/);

  return (
    <>
      <header className="bg-esn text-white shadow-md">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center">
          <Link href="/" aria-label="ESN MESA Events – home">
            <BrandMark product="Events" />
          </Link>
        </div>
      </header>
    <main className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
      <article className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 sm:p-10">
          {de ? (
            <LangTabs
              versions={[
                { lang: "en", label: "English", html: en },
                { lang: "de", label: "Deutsch", html: de },
              ]}
            />
          ) : (
            <div className="legal-prose" dangerouslySetInnerHTML={{ __html: en }} />
          )}
          {version && <div className="legal-prose mt-4" dangerouslySetInnerHTML={{ __html: version }} />}
        </div>

        {error && (
          <p role="alert" className="mx-6 sm:mx-10 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {ERRORS[error] ?? ERRORS.failed}
          </p>
        )}

        {/* The decision stays in view while reading (usability review #15). */}
        <div className="sticky bottom-0 rounded-b-xl bg-white/95 backdrop-blur px-6 sm:px-10 py-4 border-t border-gray-200 flex flex-col sm:flex-row gap-3">
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
        <p className="text-xs text-gray-500 px-6 sm:px-10 pb-4">Signed in as {viewer.email}</p>
      </article>
    </main>
    </>
  );
}
