"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card, CardContent } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { Stepper, type StepView } from "@/components/status";
import { TabBar } from "@/components/TabBar";

/**
 * The header of every cycle page: title, the month selector (switching
 * months keeps the page – schedule, form, roster …), the steps as status
 * only, the next action, and the pages as tabs (usability review #18: one
 * "current" style each – the filled step is where the cycle is, the
 * underlined tab is the page shown; the tab holding the current step has a dot).
 */
export function CycleNav({
  cycleId,
  title,
  plannedIn,
  months,
  steps,
  next,
}: {
  cycleId: string;
  title: string;
  plannedIn: string;
  months: Array<{ id: string; value: string; label: string; note?: string }>;
  steps: Array<StepView & { href: string }>;
  next: { href: string; action: string; summary: string; done: boolean };
}) {
  const pathname = usePathname();
  const base = `/team/events/cycles/${cycleId}`;
  const sub = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const current = months.find((m) => m.id === cycleId)!;
  const tabs = [
    { href: base, label: "Schedule" },
    { href: `${base}/form`, label: "Volunteer form" },
    { href: `${base}/roster`, label: "Roster" },
    { href: `${base}/descriptions`, label: "Descriptions" },
    { href: `${base}/hand-in`, label: "Hand-in" },
  ];
  const currentHref = steps.find((s) => s.state === "current")?.href;

  return (
    <div className="mb-6 space-y-4" data-testid="cycle-nav">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <p className="text-xs text-gray-500">
            <Link href={`/team/events?month=${current.value}`} className="hover:text-esn hover:underline">
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
      <Card>
        <CardContent className="space-y-3 pt-5">
          <Stepper steps={steps.map((s) => ({ label: s.label, state: s.state, note: s.note, late: s.late }))} label="Steps of this cycle" testId="cycle-stepper" />
          <Link
            href={next.href}
            className={next.done ? "block text-sm text-emerald-700" : "block rounded-md border border-esn/30 bg-esn/5 px-3 py-2 text-sm hover:underline"}
            data-testid="cycle-next"
          >
            <span className="font-semibold text-esn-dark">{next.done ? "✓ " : "Next: "}</span>
            {next.action}
            <span className="text-gray-500"> · {next.summary}</span>
          </Link>
        </CardContent>
      </Card>
      <TabBar label="Cycle pages" tabs={tabs.map((t) => ({ ...t, active: pathname === t.href, note: currentHref === t.href ? "The cycle's current step is here" : undefined }))} />
    </div>
  );
}
