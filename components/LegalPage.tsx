import Link from "next/link";
import { legalHtml } from "@/lib/legalContent";

/** A legal text from legal/<name>.md (Impressum, privacy notices) in the page frame. */
export default function LegalPage({
  name,
  lang,
  switchTo,
}: {
  name: string;
  lang: "de" | "en";
  /** The same page in the other language */
  switchTo?: { href: string; label: string };
}) {
  return (
    <main lang={lang} className="max-w-3xl mx-auto px-4 py-10">
      <article className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-10">
        {switchTo && (
          <p className="text-sm text-right mb-2">
            <Link href={switchTo.href} className="text-esn hover:underline">
              {switchTo.label}
            </Link>
          </p>
        )}
        <div className="legal-prose" dangerouslySetInnerHTML={{ __html: legalHtml(name) }} />
      </article>
    </main>
  );
}
