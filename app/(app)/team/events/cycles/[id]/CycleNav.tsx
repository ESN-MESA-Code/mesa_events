"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card, CardContent } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { Stepper, type StepView } from "@/components/status";

/**
 * The header of every cycle page: title, the month selector (switching
 * months keeps the page – schedule, form, roster …), the steps as links and
 * the next action. The step whose page is shown is outlined.
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
  // Several steps share a page (ideas + schedule, allocation + roster): outline the last of them reached.
  const hereSteps = steps.filter((s) => s.href === pathname);
  const here = hereSteps.find((s) => s.state === "current") ?? hereSteps.at(-1);

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
          <Stepper steps={steps.map((s) => ({ ...s, here: s === here }))} label="Steps of this cycle – each opens its page" testId="cycle-stepper" />
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
    </div>
  );
}
