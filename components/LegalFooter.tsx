"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL } from "@/lib/legal";

/** Impressum, participation terms and privacy links, on every page (root layout). */
export default function LegalFooter() {
  const pathname = usePathname();
  // On the attendance forms the links open a new tab, so entered details are
  // not lost and a kiosk device stays on its form.
  const newTab =
    pathname.startsWith("/event/") || pathname.startsWith("/kiosk/")
      ? { target: "_blank", rel: "noopener" }
      : {};

  return (
    <footer className="border-t border-gray-200 py-4 px-4 text-center text-xs text-gray-500">
      <span>{LEGAL.association.short_name}</span>
      <span aria-hidden="true"> · </span>
      <Link href="/impressum" className="hover:text-gray-800 underline-offset-2 hover:underline" {...newTab}>
        Impressum / Legal notice
      </Link>
      <span aria-hidden="true"> · </span>
      <Link href="/terms" className="hover:text-gray-800 underline-offset-2 hover:underline" {...newTab}>
        Participation terms
      </Link>
      <span aria-hidden="true"> · </span>
      <Link href="/privacy" className="hover:text-gray-800 underline-offset-2 hover:underline" {...newTab}>
        Privacy / Datenschutz
      </Link>
    </footer>
  );
}
