import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { stepHref } from "@/lib/cycle";
import { cycleLabel, cyclePlannedIn } from "@/lib/dates";
import { monthParam } from "@/lib/month";
import { CycleNav } from "./CycleNav";

// Every page of a cycle (schedule, volunteer form, roster, descriptions,
// hand-in) under one header: the month selector (the same page in another
// month) and the cycle's steps as a breadcrumb – each step links to its page.
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
        months={cycles.map((c) => ({
          id: c.id,
          value: monthParam(c.month),
          label: cycleLabel(c.month),
          note: c.progress.done ? "done" : (c.progress.steps.find((s) => s.state === "current")?.label ?? undefined),
        }))}
        steps={cycle.progress.steps.map((s) => ({ ...s, href: stepHref(cycle.id, s.id) }))}
        next={{ href: cycle.progress.current ? stepHref(cycle.id, cycle.progress.current) : stepHref(cycle.id, "done"), action: cycle.progress.action, summary: cycle.progress.summary, done: cycle.progress.done }}
      />
      {children}
    </>
  );
}
