import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { monthNote } from "@/lib/cycle";
import { cycleLabel, cyclePlannedIn, monthLabel } from "@/lib/dates";
import { monthParam } from "@/lib/month";
import { CycleNav } from "./CycleNav";

// Every page of a cycle (ideas, schedule, volunteer form, roster,
// descriptions, hand-in) under one header: the month selector (the same tab
// in another month) and the tabs with the cycle's steps on them.
export default async function CycleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const { data: rows } = await supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month");
  const cycles = await cyclesWithProgress(supabase, rows ?? []);
  const cycle = cycles.find((c) => c.id === id);
  if (!cycle) notFound();

  return (
    <>
      <CycleNav
        cycleId={cycle.id}
        title={cycleLabel(cycle.month)}
        plannedIn={cyclePlannedIn(cycle.month)}
        months={cycles.map((c) => ({ id: c.id, value: monthParam(c.month), label: monthLabel(c.month), note: monthNote(c.progress) }))}
        steps={cycle.progress.steps}
      />
      {children}
    </>
  );
}
