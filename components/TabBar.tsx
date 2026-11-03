"use client";

// Page tabs (event tabs, cycle pages). They scroll sideways on narrow
// screens with a fade at the edge that has more, instead of being cut off
// or showing a stray vertical scrollbar (usability review #23). Tabs can
// carry a step's status – the cycle pages are its steps, so the tabs are the
// stepper too (round 2026-11-03).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Tab {
  href: string;
  label: string;
  active: boolean;
  /** A dot after the label, with this text for screen readers and the tooltip. */
  note?: string;
  /** The tab is a step: done ✓, the current one marked, still to do grey. */
  step?: { state: "done" | "current" | "todo"; late?: boolean; due?: string };
}

const STEP_SR = { done: "done", current: "current step", todo: "not yet" } as const;

export function TabBar({ label, tabs, testId }: { label: string; tabs: Tab[]; testId?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    // The active tab in view on narrow screens.
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && active.offsetLeft + active.offsetWidth > el.clientWidth) el.scrollLeft = active.offsetLeft - 16;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <nav aria-label={label} className="relative border-b border-gray-200" data-testid={testId}>
      <ul ref={ref} className="flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <li key={t.href} className="shrink-0" aria-current={t.step?.state === "current" ? "step" : undefined} data-state={t.step?.state} data-late={t.step?.late || undefined}>
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={cn(
                "flex flex-col whitespace-nowrap border-b-2 px-2 py-2 text-sm font-medium sm:px-3",
                t.active ? "border-esn text-esn" : "border-transparent text-gray-600 hover:text-gray-900",
                t.step?.state === "todo" && !t.active && "text-gray-400"
              )}
            >
              <span className="flex items-center gap-1">
                {t.step && <span className="sr-only">{STEP_SR[t.step.state]}: </span>}
                {t.step?.state === "done" && (
                  <span aria-hidden="true" className="text-emerald-600">
                    ✓
                  </span>
                )}
                {t.step?.state === "current" && <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", t.step.late ? "bg-red-600" : "bg-esn-orange")} />}
                {t.label}
                {t.note && <span className="h-2 w-2 rounded-full bg-esn-orange" title={t.note} aria-label={t.note} />}
              </span>
              {t.step?.due && <span className={cn("text-[11px] font-normal", t.step.state === "current" ? (t.step.late ? "text-red-700" : "text-gray-700") : "text-gray-400")}>{t.step.due}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {more.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-gray-50 to-transparent" />}
      {more.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-gray-50 to-transparent" />}
    </nav>
  );
}
