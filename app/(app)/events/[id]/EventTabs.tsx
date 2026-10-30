"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { backLink, withFrom } from "@/lib/breadcrumbs";
import { stepLink, type NextStep } from "@/lib/checklist";

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

export function EventTabs({ id, notes, cash }: { id: string; notes: Partial<Record<string, string>>; cash: boolean }) {
  const pathname = usePathname();
  const from = useSearchParams().get("from");
  const tabs = [
    { href: `/events/${id}`, label: "Overview" },
    { href: `/events/${id}/description`, label: "Description" },
    { href: `/events/${id}/attendance`, label: "Attendance" },
    { href: `/events/${id}/hand-in`, label: "Hand-in" },
    // The cash box (round 2026-10-30): staff, Events, Finance and executives.
    ...(cash ? [{ href: `/events/${id}/cash`, label: "Cash box" }] : []),
  ];
  return (
    <nav aria-label="Event" className="border-b border-gray-200">
      <ul className="flex overflow-x-auto sm:gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href;
          const note = notes[t.label];
          return (
            <li key={t.href}>
              <Link
                href={withFrom(t.href, from)}
                aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-1 px-2 sm:px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap", active ? "border-esn text-esn" : "border-transparent text-gray-600 hover:text-gray-900")}
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

/** "Your next step": to the tab where it is done, or down to it on that tab (review 2026-10-29 B4). */
export function NextStepBanner({ id, step, due }: { id: string; step: NextStep; due: string | null }) {
  const link = stepLink(id, step, usePathname());
  return (
    <Link
      href={link.href}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 hover:shadow-sm",
        step.kind === "action" ? "border-esn/30 bg-esn/5" : "border-gray-200 bg-white"
      )}
      data-testid="next-step-banner"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{step.kind === "action" ? "Your next step" : "Status"}</span>
      <span className="font-semibold text-esn-dark">{step.label}</span>
      {due && <span className="text-sm text-gray-600">{due}</span>}
      <span className="ml-auto text-sm text-esn">{link.label}</span>
    </Link>
  );
}
