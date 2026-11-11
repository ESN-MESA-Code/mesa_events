import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, nowMs } from "@/lib/dates";
import { parseSemesterKey, semesterFor, shiftSemester } from "@/lib/internal";
import type { ActivityRow } from "@/lib/internalAttendance";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, buttonVariants } from "@/components/ui";
import { isInternalPlanner } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { PlannerTabs } from "../PlannerTop";
import { ActivityTable } from "./ActivityTable";

export const metadata: Metadata = { title: "Activity" };

// What each member did in a semester (round 2026-11-03 (2)), for HR, the
// Vice President and the executive board: OC and helper of ESN events,
// office hours staffed, Tuesday Talks and other internal meetings attended –
// only what took place and was not cancelled (public.member_activity()).
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const viewer = await requirePageRole(["hr", "vice_president"], { executiveMayRead: true, page: "Activity" });
  const supabase = await createSessionClient();
  const sp = await searchParams;
  const current = semesterFor(berlinDate(new Date(nowMs()).toISOString()));
  const semester = parseSemesterKey(sp.semester) ?? current;
  const { data, error } = await supabase.rpc("member_activity", { semester: semester.key });
  const prev = shiftSemester(semester, -1);
  const next = shiftSemester(semester, 1);
  const link = (key: string) => `/team/internal/activity?semester=${key}`;

  return (
    <>
      <PlannerTabs
        tab="activity"
        links={{
          calendar: `/team/internal?view=semester&semester=${semester.key}`,
          roster: `/team/internal/roster?view=semester&semester=${semester.key}`,
          activity: link(semester.key),
        }}
        readOnly={!isInternalPlanner(viewer.roles)}
        description="Per member and semester: OC and helper of ESN events, office hours, Tuesday Talks and other meetings attended. Counts what took place."
      />
      <nav aria-label="Semester" className="mb-4 flex items-center gap-1">
        <Link href={link(prev.key)} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Previous semester: ${prev.name}`}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
        <span className="min-w-24 text-center text-base font-semibold text-gray-900" data-testid="activity-semester">
          {semester.name}
        </span>
        {semester.key === current.key ? (
          <span className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "opacity-30")} aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        ) : (
          <Link href={link(next.key)} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Next semester: ${next.name}`}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </nav>
      {error ? <Alert tone="error">{error.message}</Alert> : <ActivityTable rows={(data ?? []) as ActivityRow[]} semester={semester.name} />}
    </>
  );
}
