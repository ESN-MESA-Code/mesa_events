import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, UserCheck } from "lucide-react";
import { Badge, PageHeader, buttonVariants } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { monthLabel } from "@/lib/dates";
import { monthParam } from "@/lib/month";
import { cn } from "@/lib/utils";
import { dayLabel } from "./plannerFormat";
import type { PlannerData } from "./planner";

export type PlannerTab = "calendar" | "roster" | "activity";

/**
 * The title and the tabs of the internal planning (split 2026-11-11):
 * Calendar, Duty roster and Activity – each its own page, the period carried
 * from tab to tab.
 */
export function PlannerTabs({
  tab,
  links,
  open,
  readOnly,
  description,
}: {
  tab: PlannerTab;
  links: Record<PlannerTab, string>;
  /** Dates not fully staffed, on the Duty roster tab. */
  open?: number;
  readOnly: boolean;
  description: string;
}) {
  const tabs: Array<{ key: PlannerTab; label: string; icon: React.ReactNode; testId: string }> = [
    { key: "calendar", label: "Calendar", icon: <CalendarDays className="size-4" aria-hidden="true" />, testId: "tab-calendar" },
    { key: "roster", label: "Duty roster", icon: <UserCheck className="size-4" aria-hidden="true" />, testId: "tab-roster" },
    { key: "activity", label: "Activity", icon: <ClipboardList className="size-4" aria-hidden="true" />, testId: "activity-link" },
  ];
  return (
    <>
      <PageHeader title="Internal planning" description={description}>
        {readOnly && <Badge data-testid="read-only">Read-only (executive)</Badge>}
      </PageHeader>
      <nav aria-label="Internal planning" className="-mt-2 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={links[t.key]}
            aria-current={tab === t.key ? "page" : undefined}
            data-testid={t.testId}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "border-esn text-esn" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-900"
            )}
          >
            {t.icon}
            {t.label}
            {t.key === "roster" && !!open && (
              <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold tabular-nums text-amber-800" aria-label={`${open} not fully staffed`}>
                {open}
              </span>
            )}
          </Link>
        ))}
      </nav>
    </>
  );
}

/** Calendar and Duty roster: the tabs, the period (semester or month) and the figures for it. */
export function PlannerTop({ data, tab, path }: { data: PlannerData; tab: "calendar" | "roster"; path: string }) {
  const { view, semester, prevSemester: prev, nextSemester: next, month, summary } = data;
  const calendar = "/team/internal";
  const roster = "/team/internal/roster";
  const viewLink = (v: "semester" | "month") => (v === "semester" ? `${path}?view=semester&semester=${semester.key}` : `${path}?view=month&month=${monthParam(month)}`);
  return (
    <>
      <PlannerTabs
        tab={tab}
        links={{ calendar: data.href(calendar), roster: data.href(roster), activity: `/team/internal/activity?semester=${semester.key}` }}
        open={summary.noOc + summary.short}
        readOnly={!data.canEdit}
        description={
          tab === "calendar"
            ? "Stammtisch, Tuesday Talks, board meetings, office hours and internal events – plan the semester. (Not ESN activities: no description or volunteer form.)"
            : "Who is OC and helper at the coming Stammtisch and office hours."
        }
      />

      {/* The period: semester or month, and which one – the same on both tabs. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="View" className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm">
          {(["semester", "month"] as const).map((v) => (
            <Link
              key={v}
              href={viewLink(v)}
              aria-current={view === v ? "page" : undefined}
              className={cn("rounded-md px-3 py-1 font-medium transition-colors", view === v ? "bg-white text-esn shadow-sm" : "text-gray-600 hover:text-gray-900")}
            >
              {v === "semester" ? "Semester" : "Month"}
            </Link>
          ))}
        </nav>
        {view === "semester" ? (
          <nav aria-label="Semester" className="flex items-center gap-1" data-testid="semester-nav">
            <Link href={`${path}?view=semester&semester=${prev.key}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Previous semester (${prev.name})`}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <span className="min-w-24 text-center text-base font-semibold text-gray-900">{semester.name}</span>
            <Link href={`${path}?view=semester&semester=${next.key}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Next semester (${next.name})`}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </nav>
        ) : (
          <MonthSelector
            options={data.monthOptions.map((m) => ({ value: monthParam(m), label: monthLabel(m), href: `${path}?view=month&month=${monthParam(m)}` }))}
            current={monthParam(month)}
            path={path}
            storageKey="mesa:month:internal"
            explicit={!!data.askedMonth}
          />
        )}
      </div>

      {/* The period at a glance. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="planner-summary">
        <Stat label={`Coming up · ${data.period.label}`} value={summary.coming} sub={`${summary.total} ${summary.total === 1 ? "date" : "dates"} in total`} />
        <Stat
          label="Next up"
          value={summary.next ? dayLabel(summary.next.start.slice(0, 10)) : "–"}
          sub={summary.next ? `${summary.next.start.slice(11)} · ${summary.next.title}` : "Nothing planned"}
          href={summary.next ? data.href(calendar, { date: summary.next.id }) : undefined}
        />
        <Stat label="Without an OC" value={summary.noOc} tone={summary.noOc ? "red" : "green"} sub={summary.noOc ? "Assign one in the roster" : "Every duty has an OC"} href={data.href(roster, { only: "open" })} />
        <Stat label="Short of helpers" value={summary.short} tone={summary.short ? "amber" : "green"} sub={summary.short ? "Helpers still missing" : "Enough helpers"} href={data.href(roster, { only: "open" })} />
      </div>
    </>
  );
}

/** A figure at the top of the planner; a link where it leads somewhere. */
function Stat({ label, value, sub, tone, href }: { label: string; value: React.ReactNode; sub: string; tone?: "red" | "amber" | "green"; href?: string }) {
  const body = (
    <>
      <span className="block truncate text-xs font-medium text-gray-500">{label}</span>
      <span
        className={cn(
          "mt-1 block truncate text-xl font-bold tabular-nums sm:text-2xl",
          tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "green" ? "text-emerald-600" : "text-gray-900"
        )}
      >
        {value}
      </span>
      <span className="mt-0.5 block truncate text-xs text-gray-500">{sub}</span>
    </>
  );
  const cls = "block rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-esn/40 hover:bg-esn/5")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
