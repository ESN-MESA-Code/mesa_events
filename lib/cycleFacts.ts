// The facts lib/cycle.ts turns into steps, for several cycles at once
// (Events dashboard, Home, cycle page). Server components only; the
// member's client decides what is visible (Events team, executives).
import type { Db } from "@/lib/supabase/session";
import { cycleProgress, type CycleFacts, type CycleProgress } from "@/lib/cycle";
import type { CycleStatus } from "@/lib/labels";

export interface CycleRow {
  id: string;
  month: string;
  status: CycleStatus;
  form_closes_at: string | null;
  description_deadline: string | null;
}

export type CycleWithProgress = CycleRow & { facts: CycleFacts; progress: CycleProgress };

const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

export async function cyclesWithProgress(supabase: Db, cycles: CycleRow[]): Promise<CycleWithProgress[]> {
  if (!cycles.length) return [];
  const ids = cycles.map((c) => c.id);
  const [{ data: events }, { data: overview }] = await Promise.all([
    supabase.from("events").select("cycle_id").in("cycle_id", ids).neq("status", "dropped"),
    supabase.rpc("description_overview"),
  ]);
  return Promise.all(
    cycles.map(async (c) => {
      const [{ count: ideas }, { data: responses }] = await Promise.all([
        supabase.from("event_ideas").select("id", { count: "exact", head: true }).eq("status", "proposed").gte("proposed_date", c.month).lte("proposed_date", monthEnd(c.month)),
        c.status === "planning" ? Promise.resolve({ data: [] }) : supabase.rpc("cycle_responses", { cycle: c.id }),
      ]);
      const mine = (overview ?? []).filter((o) => o.cycle_id === c.id);
      const facts: CycleFacts = {
        status: c.status,
        events: (events ?? []).filter((e) => e.cycle_id === c.id).length,
        openIdeas: ideas ?? 0,
        responses: (responses ?? []).length,
        formClosesAt: c.form_closes_at,
        descriptionDeadline: c.description_deadline,
        descriptions: {
          total: mine.length,
          in: mine.filter((o) => ["submitted", "approved", "published"].includes(o.status)).length,
          published: mine.filter((o) => o.status === "published").length,
        },
      };
      return { ...c, facts, progress: cycleProgress(facts) };
    })
  );
}
