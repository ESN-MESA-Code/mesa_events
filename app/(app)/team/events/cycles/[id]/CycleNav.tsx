"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronLeft } from "lucide-react";
import { MonthSelector } from "@/components/MonthSelector";
import type { Step, StepId } from "@/lib/cycle";
import { cn } from "@/lib/utils";

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

type PageStep = { state: "done" | "current" | "todo"; late?: boolean; due?: string };

/** A page's status from its steps: current if one is, done once all are; the due date of the current step, else the last one with a date. */
function pageStep(steps: Step[], ids: StepId[]): PageStep | undefined {
  const mine = steps.filter((s) => ids.includes(s.id));
  if (!mine.length) return undefined;
  const current = mine.find((s) => s.state === "current");
  const state = current ? "current" : mine.every((s) => s.state === "done") ? "done" : "todo";
  const due = current?.note ?? [...mine].reverse().find((s) => s.note)?.note;
  return { state, late: current?.late, due };
}

const STEP_SR = { done: "done", current: "current step", todo: "not yet" } as const;

/**
 * The header of every cycle page (redesign 2026-11-08): the month as the
 * title with where it stands, the month selector (switching months keeps
 * the tab), and the pages as a numbered stage track in a card – ✓ done, the
 * current stage in ESN blue (red when behind; a running month can have two,
 * review 2026-11-03 #8), each with its date. The tinted stage is the page
 * shown. Scrolls sideways on phones, the page shown in view.
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
  const pages = PAGES.map((p) => ({ ...p, href: `${base}${p.path}`, active: pathname === `${base}${p.path}`, step: pageStep(steps, p.steps) }));
  const done = pages.every((p) => !p.step || p.step.state === "done");
  const late = pages.some((p) => p.step?.state === "current" && p.step.late);
  const open = pages.filter((p) => p.step?.state === "current").map((p) => p.label.toLowerCase());

  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && active && active.offsetLeft + active.offsetWidth > el.clientWidth) el.scrollLeft = active.offsetLeft - 16;
  }, [pathname]);

  return (
    <div className="mb-6 space-y-4" data-testid="cycle-nav">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto min-w-0">
          <Link href="/team/events" className="inline-flex items-center gap-0.5 text-sm font-medium text-gray-500 hover:text-esn">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Events team
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                done ? "bg-emerald-50 text-emerald-800" : late ? "bg-red-50 text-red-700" : "bg-esn/10 text-esn"
              )}
            >
              {done ? "Done" : `${late ? "Behind · " : ""}To do: ${open.join(", ")}`}
            </span>
          </div>
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

      <nav aria-label="Cycle pages" className="rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm" data-testid="cycle-stepper">
        <ol ref={list} className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {pages.map((p, i) => {
            const s = p.step;
            const isLate = s?.state === "current" && s.late;
            return (
              <li key={p.path} className="flex min-w-36 flex-1 shrink-0 items-center" aria-current={s?.state === "current" ? "step" : undefined} data-state={s?.state} data-late={s?.late || undefined}>
                <Link
                  href={p.href}
                  aria-current={p.active ? "page" : undefined}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors",
                    p.active ? "bg-esn/[0.07]" : "hover:bg-gray-50"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                      s?.state === "done" && "bg-emerald-100 text-emerald-700",
                      s?.state === "current" && (isLate ? "bg-red-600 text-white ring-4 ring-red-100" : "bg-esn text-white ring-4 ring-esn/15"),
                      (!s || s.state === "todo") && "bg-gray-100 text-gray-500"
                    )}
                  >
                    {s?.state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className={cn("whitespace-nowrap text-sm font-semibold", p.active ? "text-esn" : s?.state === "todo" ? "text-gray-500" : "text-gray-900")}>
                      {s && <span className="sr-only">{STEP_SR[s.state]}: </span>}
                      {p.label}
                    </span>
                    {s?.due && <span className={cn("whitespace-nowrap text-[11px]", isLate ? "font-medium text-red-700" : s.state === "current" ? "text-gray-700" : "text-gray-400")}>{s.due}</span>}
                  </span>
                </Link>
                {i < pages.length - 1 && <span aria-hidden="true" className={cn("mx-0.5 h-px w-3 shrink-0", s?.state === "done" ? "bg-emerald-300" : "bg-gray-200")} />}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
