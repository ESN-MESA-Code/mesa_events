// A titled white panel (redesign 2026-11-07): the cards of the event page,
// with the rounder corners of the Home, Ideas and My events cards. The team
// pages (redesign 2026-11-08) add an icon, a count chip and a line below
// the title.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const COUNT_TONE = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-esn text-white",
  amber: "bg-amber-100 text-amber-900",
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-700",
} as const;

export function Panel({
  title,
  aside,
  id,
  className,
  children,
  icon: Icon,
  count,
  countTone = "gray",
  description,
  testId,
}: {
  title: string;
  aside?: React.ReactNode;
  id?: string;
  className?: string;
  children: React.ReactNode;
  icon?: LucideIcon;
  count?: React.ReactNode;
  countTone?: keyof typeof COUNT_TONE;
  description?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section id={id} aria-label={title} className={cn("scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5", className)} data-testid={testId}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="mr-auto flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-esn/5 text-esn" aria-hidden="true">
              <Icon className="h-[18px] w-[18px]" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
              {title}
              {count !== undefined && <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums", COUNT_TONE[countTone])}>{count}</span>}
            </h2>
            {description && <p className="text-sm text-gray-500">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A group inside a panel ("Waiting for the OC · 3"): a small heading with a tinted count. */
export function PanelGroup({ title, count, tone = "gray", hint, testId, children, className }: { title: string; count?: number; tone?: keyof typeof COUNT_TONE; hint?: React.ReactNode; testId?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className} data-testid={testId}>
      <h3 className="flex flex-wrap items-center gap-2 pb-1 text-xs font-bold uppercase tracking-wider text-gray-500">
        {title}
        {count !== undefined && <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold normal-case tracking-normal tabular-nums", COUNT_TONE[tone])}>{count}</span>}
        {hint && <span className="ml-auto text-xs font-normal normal-case tracking-normal text-gray-500">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}
