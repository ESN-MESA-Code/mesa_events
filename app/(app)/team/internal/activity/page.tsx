import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, nowMs } from "@/lib/dates";
import { parseSemesterKey, semesterFor, shiftSemester } from "@/lib/internal";
import type { ActivityRow } from "@/lib/internalAttendance";
import { Alert, PageHeader } from "@/components/ui";
import { ActivityTable } from "./ActivityTable";

export const metadata: Metadata = { title: "Activity" };

// What each member did in a semester (round 2026-11-03 (2)), for HR, the
// Vice President and the executive board: OC and helper of ESN events,
// office hours staffed, Tuesday Talks and other internal meetings attended –
// only what took place and was not cancelled (public.member_activity()).
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  await requirePageRole(["hr", "vice_president"], { executiveMayRead: true, page: "Activity" });
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
      <PageHeader title="Activity" description="Per member and semester: OC and helper of ESN events, office hours, Tuesday Talks and other meetings attended. Counts what took place.">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/team/internal" className="text-sm text-esn hover:underline">
            ← Internal planning
          </Link>
          <nav aria-label="Semester" className="flex items-center gap-1 text-sm">
            <Link href={link(prev.key)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-gray-700 hover:text-esn" aria-label={`Previous semester: ${prev.name}`}>
              ←
            </Link>
            <span className="min-w-28 rounded-md border border-esn/30 bg-esn/5 px-3 py-1.5 text-center font-semibold text-esn-dark" data-testid="activity-semester">
              {semester.name}
            </span>
            {semester.key === current.key ? (
              <span className="rounded-md border border-gray-200 px-2.5 py-1.5 text-gray-300" aria-hidden>
                →
              </span>
            ) : (
              <Link href={link(next.key)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-gray-700 hover:text-esn" aria-label={`Next semester: ${next.name}`}>
                →
              </Link>
            )}
          </nav>
        </div>
      </PageHeader>
      {error ? <Alert tone="error">{error.message}</Alert> : <ActivityTable rows={(data ?? []) as ActivityRow[]} semester={semester.name} />}
    </>
  );
}
