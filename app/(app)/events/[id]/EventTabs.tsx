"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { backLink, withFrom } from "@/lib/breadcrumbs";
import { stepLink, type NextStep } from "@/lib/checklist";
import { DueLabel } from "@/components/status";
import { StepIcon } from "@/components/StepIcon";
import { TabBar } from "@/components/TabBar";

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
  return <TabBar label="Event" tabs={tabs.map((t) => ({ href: withFrom(t.href, from), label: t.label, active: pathname === t.href, note: notes[t.label] }))} />;
}

/**
 * "Your next step": to the tab where it is done, or down to it on that tab (review 2026-10-29 B4).
 * The foot of the event's header (redesign 2026-11-07).
 */
export function NextStepBanner({ id, step, now }: { id: string; step: NextStep; now: number }) {
  const link = stepLink(id, step, usePathname());
  return (
    <Link
      href={link.href}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-3 transition-colors sm:px-5",
        step.kind === "action" ? "border-esn/20 bg-esn/5 hover:bg-esn/10" : "border-gray-100 bg-gray-50 hover:bg-gray-100"
      )}
      data-testid="next-step-banner"
    >
      <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{step.kind === "action" ? "Your next step" : "Status"}</span>
      <span className="flex min-w-0 items-center gap-1.5 font-semibold text-esn-dark">
        <StepIcon kind={step.kind === "done" ? "done" : step.kind} />
        {step.label}
      </span>
      {step.due && <DueLabel iso={step.due} now={now} note={step.dueNote} className="text-sm" />}
      <span className="ml-auto text-sm font-semibold text-esn">{link.label}</span>
    </Link>
  );
}
