// The facts lib/cycle.ts turns into steps, for several cycles at once
// (Events dashboard, Home, cycle page). Server components only; the
// member's client decides what is visible (Events team, executives).
import type { Db } from "@/lib/supabase/session";
import { cycleProgress, type CycleFacts, type CycleProgress } from "@/lib/cycle";
import { nowMs } from "@/lib/dates";
import type { CycleStatus } from "@/lib/labels";

export interface CycleRow {
  id: string;
  month: string;
  status: CycleStatus;
  form_closes_at: string | null;
  description_deadline: string | null;
}

export interface HandInRow {
  event_id: string;
  starts_at: string;
  signed_off: boolean;
  photos_in: boolean;
  report_in: boolean;
  belege_missing: number;
}

export type CycleWithProgress = CycleRow & {
  facts: CycleFacts;
  progress: CycleProgress;
  /** Events that happened and are not handed in yet, with what is missing. */
  handInOpen: HandInRow[];
};


/** Handed in: list signed off, photos in Drive, the event report written, every Beleg with Finance. */
const handedIn = (h: HandInRow) => h.signed_off && h.photos_in && h.report_in && h.belege_missing === 0;

/** Description states that count as "in". */
const IN = ["submitted", "approved", "published"];

const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

export async function cyclesWithProgress(supabase: Db, cycles: CycleRow[]): Promise<CycleWithProgress[]> {
  if (!cycles.length) return [];
  const ids = cycles.map((c) => c.id);
  const [{ data: events }, { data: overview }, { data: handIn }] = await Promise.all([
    supabase.from("events").select("cycle_id").in("cycle_id", ids).neq("status", "dropped"),
    supabase.rpc("description_overview"),
    supabase.rpc("cycle_hand_in", { cycles: ids }),
  ]);
  const now = nowMs();
  return Promise.all(
    cycles.map(async (c) => {
      // Ideas and answers only matter before the roster is confirmed, so
      // confirmed cycles (most of them, over the years) cost no queries here.
      const [{ count: ideas }, { data: responses }] = await Promise.all([
        c.status === "confirmed"
          ? Promise.resolve({ count: 0 })
          : supabase.from("event_ideas").select("id", { count: "exact", head: true }).eq("status", "proposed").gte("proposed_date", c.month).lte("proposed_date", monthEnd(c.month)),
        ["planning", "confirmed"].includes(c.status) ? Promise.resolve({ data: [] }) : supabase.rpc("cycle_responses", { cycle: c.id }),
      ]);
      const mine = (overview ?? []).filter((o) => o.cycle_id === c.id);
      const running = (handIn ?? []).filter((h) => h.cycle_id === c.id && h.status !== "cancelled");
      const happened = running.filter((h) => Date.parse(h.starts_at) <= now);
      const facts: CycleFacts = {
        status: c.status,
        events: (events ?? []).filter((e) => e.cycle_id === c.id).length,
        openIdeas: ideas ?? 0,
        responses: (responses ?? []).length,
        formClosesAt: c.form_closes_at,
        descriptionDeadline: c.description_deadline,
        descriptions: {
          total: mine.length,
          in: mine.filter((o) => IN.includes(o.status)).length,
          published: mine.filter((o) => o.status === "published").length,
          upcomingMissing: mine.filter((o) => Date.parse(o.starts_at) > now && !IN.includes(o.status)).length,
        },
        handIn: {
          total: running.length,
          happened: happened.length,
          done: happened.filter(handedIn).length,
        },
      };
      const handInOpen = happened.filter((h) => !handedIn(h));
      return { ...c, facts, progress: cycleProgress(facts), handInOpen };
    })
  );
}
