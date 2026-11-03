// The member's events with their next step, loaded once for Home and My
// events (round 2026-11-03 (2)) so both pages say the same about an event.
// Server components only; RLS applies. Duties at office hours and Stammtisch
// come along (loadMyDuties) so both pages list them with the events.
import type { Db } from "@/lib/supabase/session";
import type { EventStatus } from "@/lib/labels";
import { nextStep, type NextStep } from "@/lib/checklist";
import { checklistInput } from "@/lib/eventStatus";
import { happeningNow } from "@/lib/myEvents";
import { dutyStep, dutyTimed, type DutyData, type DutyStep } from "@/lib/myDuties";

export interface MyEventData {
  id: string;
  title: string;
  status: EventStatus;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  meeting_point: string | null;
  meeting_street: string | null;
  meeting_postal_code: string | null;
  meeting_city: string | null;
  meeting_time: string | null;
  helpers_needed: number;
  chat_space_name: string | null;
  chat_space_url: string | null;
  chat_space_requested_at: string | null;
  planning_cycles: { description_deadline: string | null } | null;
}

export interface MyEvent {
  assignmentId: string;
  role: "oc" | "helper";
  event: MyEventData;
  step: NextStep;
  live: boolean;
  /** The member's claims for the event not paid or rejected yet. */
  openClaims: { count: number; cents: number };
}

const EVENT_FIELDS =
  "id, title, status, starts_at, ends_at, location, meeting_point, meeting_street, meeting_postal_code, meeting_city, meeting_time, helpers_needed, chat_space_name, chat_space_url, chat_space_requested_at, planning_cycles(description_deadline)";

/** Active assignments, drafts left out; with `since`, only events starting after it. */
export async function loadMyEvents(supabase: Db, viewerId: string, now: number, { since }: { since?: number } = {}): Promise<MyEvent[]> {
  const [{ data: assignments }, { data: claims }] = await Promise.all([
    supabase.from("assignments").select(`id, role, events(${EVENT_FIELDS})`).eq("profile_id", viewerId).eq("status", "active"),
    supabase.from("reimbursements").select("event_id, suggested_cents, approved_cents").eq("claimant_id", viewerId).not("status", "in", "(paid,rejected)"),
  ]);
  const open = new Map<string, { count: number; cents: number }>();
  for (const c of claims ?? []) {
    const o = open.get(c.event_id) ?? { count: 0, cents: 0 };
    open.set(c.event_id, { count: o.count + 1, cents: o.cents + (c.approved_cents ?? c.suggested_cents) });
  }
  const mine = (assignments ?? [])
    .map((a) => ({ assignmentId: a.id, role: a.role as "oc" | "helper", event: a.events as unknown as MyEventData | null }))
    .filter((a): a is { assignmentId: string; role: "oc" | "helper"; event: MyEventData } => !!a.event && a.event.status !== "draft" && (since === undefined || Date.parse(a.event.starts_at) > since));
  return Promise.all(
    mine.map(async (a) => {
      const input = await checklistInput(supabase, a.event, a.event.planning_cycles?.description_deadline ?? null, viewerId);
      return { ...a, step: nextStep(input, a.role), live: happeningNow(a.event, now), openClaims: open.get(a.event.id) ?? { count: 0, cents: 0 } };
    })
  );
}

/** An office hour or Stammtisch where the member is on duty (round 2026-11-03 (2)). */
export interface MyDuty {
  key: string;
  role: "oc" | "helper";
  duty: DutyData;
  step: DutyStep;
  live: boolean;
}

/** An ESN event or a duty, as My events and Home list them together. */
export type MyItem = { type: "event"; key: string; item: MyEvent } | { type: "duty"; key: string; item: MyDuty };

export const itemTimed = (x: MyItem) => (x.type === "event" ? x.item.event : dutyTimed(x.item.duty));
export const itemStep = (x: MyItem): Pick<NextStep, "kind" | "due"> => x.item.step;

export function myItems(events: MyEvent[], duties: MyDuty[]): MyItem[] {
  return [...events.map((item) => ({ type: "event" as const, key: item.assignmentId, item })), ...duties.map((item) => ({ type: "duty" as const, key: item.key, item }))];
}

const DAY = 86_400_000;

/** Duties from six weeks back (a cash box left to sign off) to ten weeks ahead, each with its next step. */
export async function loadMyDuties(supabase: Db, viewerId: string, now: number): Promise<MyDuty[]> {
  const { data } = await supabase
    .from("internal_event_people")
    .select("id, role, internal_events(id, kind, title, status, starts_at, ends_at, location)")
    .eq("profile_id", viewerId)
    .in("role", ["oc", "helper"]);
  const rows = (data ?? [])
    .map((p) => ({ key: p.id, role: p.role as "oc" | "helper", duty: p.internal_events as unknown as DutyData | null }))
    .filter((p): p is { key: string; role: "oc" | "helper"; duty: DutyData } => !!p.duty && Date.parse(p.duty.starts_at) > now - 42 * DAY && Date.parse(p.duty.starts_at) < now + 70 * DAY);
  const offices = rows.filter((r) => r.duty.kind === "office_hour").map((r) => r.duty.id);
  const { data: boxes } = offices.length ? await supabase.from("cash_reports").select("internal_event_id, opening_counted_at, closed_at").in("internal_event_id", offices) : { data: [] };
  const boxOf = new Map((boxes ?? []).map((b) => [b.internal_event_id, { openingCountedAt: b.opening_counted_at, closedAt: b.closed_at }]));
  return rows.map((r) => ({ ...r, step: dutyStep(r.duty, r.role, boxOf.get(r.duty.id) ?? null, now), live: happeningNow(dutyTimed(r.duty), now) }));
}
