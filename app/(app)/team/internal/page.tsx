import type { Metadata } from "next";
import { PlannerBoard } from "./PlannerBoard";
import { PlannerTop } from "./PlannerTop";
import { loadPlanner, type PlannerParams } from "./planner";

export const metadata: Metadata = { title: "Internal planning" };

// HR and the Vice President plan internal events, meetings and office hours
// (round 2026-10-30) for a whole semester at a time (or one month): drag a
// kind onto a day, move dates by drag and drop, repeat them over the
// semester (every Thursday, the 2nd and 4th Tuesday …). Executives look.
// Who is on duty is the Duty roster tab (split 2026-11-11); ?date= opens a date.
export default async function InternalPlanningPage({ searchParams }: { searchParams: Promise<PlannerParams & { date?: string }> }) {
  const sp = await searchParams;
  const data = await loadPlanner(sp, "Internal planning");
  return (
    <>
      <PlannerTop data={data} tab="calendar" path="/team/internal" />
      <PlannerBoard
        months={data.months}
        compact={data.view === "semester"}
        today={data.today}
        period={data.period}
        events={data.events}
        kinds={data.kinds}
        canEdit={data.canEdit}
        openId={sp.date && data.events.some((e) => e.id === sp.date) ? sp.date : null}
        rosterHref={data.href("/team/internal/roster")}
      />
    </>
  );
}
