"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { backLink, withFrom } from "@/lib/breadcrumbs";

/** "← My events" etc.: back to where the member came from (?from=…). */
export function EventBreadcrumb({ fallback }: { fallback: string }) {
  const from = useSearchParams().get("from") ?? fallback;
  const back = backLink(from);
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <Link href={back.href} className="text-esn hover:underline" data-testid="breadcrumb">
        ← {back.label}
      </Link>
    </nav>
  );
}

export function EventTabs({ id, notes }: { id: string; notes: Partial<Record<string, string>> }) {
  const pathname = usePathname();
  const from = useSearchParams().get("from");
  const tabs = [
    { href: `/events/${id}`, label: "Overview" },
    { href: `/events/${id}/description`, label: "Description" },
    { href: `/events/${id}/attendance`, label: "Attendance" },
    { href: `/events/${id}/hand-in`, label: "Hand-in" },
  ];
  return (
    <nav aria-label="Event" className="border-b border-gray-200">
      <ul className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = pathname === t.href;
          const note = notes[t.label];
          return (
            <li key={t.href}>
              <Link
                href={withFrom(t.href, from)}
                aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap", active ? "border-esn text-esn" : "border-transparent text-gray-600 hover:text-gray-900")}
              >
                {t.label}
                {note && <span className="h-2 w-2 rounded-full bg-esn-orange" title={note} aria-label={note} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
