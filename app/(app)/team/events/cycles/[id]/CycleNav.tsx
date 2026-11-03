"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MonthSelector } from "@/components/MonthSelector";
import { TabBar, type Tab } from "@/components/TabBar";
import type { Step, StepId } from "@/lib/cycle";

/** The cycle's pages and the steps done on each (Allocation and Roster on one). */
const PAGES: Array<{ path: string; label: string; steps: StepId[] }> = [
  // Always a tab, also once the schedule is fixed (round 2026-11-03).
  { path: "/ideas", label: "Ideas", steps: ["ideas"] },
  { path: "/schedule", label: "Schedule", steps: ["schedule"] },
  { path: "/form", label: "Volunteer form", steps: ["form"] },
  { path: "/roster", label: "Roster", steps: ["allocation", "roster"] },
  { path: "/descriptions", label: "Descriptions", steps: ["descriptions"] },
  { path: "/hand-in", label: "Hand-in", steps: ["handin"] },
];

/** A page's status from its steps: current if one is, done once all are; the due date of the current step, else the last one with a date. */
function pageStep(steps: Step[], ids: StepId[]): Tab["step"] {
  const mine = steps.filter((s) => ids.includes(s.id));
  if (!mine.length) return undefined;
  const current = mine.find((s) => s.state === "current");
  const state = current ? "current" : mine.every((s) => s.state === "done") ? "done" : "todo";
  const due = current?.note ?? [...mine].reverse().find((s) => s.note)?.note;
  return { state, late: current?.late, due };
}

/**
 * The header of every cycle page: title, the month selector (switching
 * months keeps the tab) and the pages as tabs that are the cycle's steps
 * too (round 2026-11-03: one bar, no stepper or next-step box besides) – ✓
 * done, marked where the cycle is (a running month can have two, review
 * 2026-11-03 #8), with each step's date. The underlined tab is the page shown.
 */
export function CycleNav({
  cycleId,
  title,
  plannedIn,
  months,
  steps,
}: {
  cycleId: string;
  title: string;
  plannedIn: string;
  months: Array<{ id: string; value: string; label: string; note?: string }>;
  steps: Step[];
}) {
  const pathname = usePathname();
  const base = `/team/events/cycles/${cycleId}`;
  const sub = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const current = months.find((m) => m.id === cycleId)!;
  const tabs: Tab[] = PAGES.map((p) => ({ href: `${base}${p.path}`, label: p.label, active: pathname === `${base}${p.path}`, step: pageStep(steps, p.steps) }));

  return (
    <div className="mb-6 space-y-4" data-testid="cycle-nav">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <p className="text-xs text-gray-500">
            <Link href="/team/events" className="hover:text-esn hover:underline">
              Events team
            </Link>{" "}
            › {title}
          </p>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{plannedIn}</p>
        </div>
        <MonthSelector
          options={months.map((m) => ({ value: m.value, label: m.label, note: m.note, href: `/team/events/cycles/${m.id}${sub}` }))}
          current={current.value}
          path="/team/events"
          storageKey="mesa:month:events"
          explicit
        />
      </div>
      <TabBar label="Cycle pages" tabs={tabs} testId="cycle-stepper" />
    </div>
  );
}
