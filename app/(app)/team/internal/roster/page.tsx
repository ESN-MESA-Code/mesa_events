import type { Metadata } from "next";
import { isStaffed } from "@/lib/internal";
import { PlannerTop } from "../PlannerTop";
import { loadPlanner, type PlannerParams } from "../planner";
import { RosterBoard } from "./RosterBoard";

export const metadata: Metadata = { title: "Duty roster" };

// Who is OC and helper at the coming Stammtisch and office hours (its own tab
// since 2026-11-11): the same period as the Calendar tab; ?only=open shows the
// dates still missing someone.
export default async function DutyRosterPage({ searchParams }: { searchParams: Promise<PlannerParams & { only?: string }> }) {
  const sp = await searchParams;
  const data = await loadPlanner(sp, "Duty roster");
  return (
    <>
      <PlannerTop data={data} tab="roster" path="/team/internal/roster" />
      <RosterBoard
        events={data.events.filter((e) => isStaffed(e.kind) && !e.cancelled && !e.past)}
        members={data.members}
        canEdit={data.canEdit}
        period={data.period.label}
        openOnly={sp.only === "open"}
        calendarHref={data.href("/team/internal")}
      />
    </>
  );
}
