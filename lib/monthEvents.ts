// The month's events as the Events team's cycle tabs list them (review
// 2026-11-03 #1): Descriptions and Hand-in show the same data –
// staffing, description, hand-in and the last automatic reminder – each
// filtered. The hand-in is the attendance list, photos and the event
// report; receipts are Finance's (round 2026-11-03). Server components only.
import type { Db } from "@/lib/supabase/session";
import { shownStatus, type CycleStatus, type EventStatus } from "@/lib/labels";
import { photosIn } from "@/lib/photos";

export interface MonthEvent {
  id: string;
  title: string;
  startsAt: string;
  /** The status to show (lib/labels.ts shownStatus). */
  status: EventStatus;
  oc: string | null;
  helpers: number;
  helpersNeeded: number;
  /** The roster is confirmed: staffing, description and hand-in count. */
  confirmed: boolean;
  /** Description status ("missing" without one). */
  description: string;
  /** When the OC sent the description to Comms (ISO), or null. */
  submittedAt: string | null;
  /** Submitted after the deadline, or missed it (description_overview). */
  descriptionLate: boolean;
  started: boolean;
  running: boolean;
  /** What the hand-in still misses ("attendance list", "photos", "event report"). */
  missing: string[];
  /** Each part of the hand-in once the event started (null before). */
  handIn: { list: boolean; photos: boolean; report: boolean } | null;
  /** Before the event: no OC or helpers short. */
  staffOpen: boolean;
  /** Before the event: the description is not in. */
  descOpen: boolean;
  /** After the event: something is not handed in. */
  handInOpen: boolean;
  /** The description deadline has passed. */
  deadlinePassed: boolean;
  /** When the OC was last reminded, per topic (ISO). */
  reminded: { description?: string; handin?: string };
}

const OPEN_DESCRIPTION = ["missing", "draft", "changes_requested"];

export async function loadMonthEvents(
  supabase: Db,
  cycle: { id: string; status: CycleStatus; description_deadline: string | null },
  now: number
): Promise<MonthEvent[]> {
  const [{ data: events }, { data: handIn }, { data: overview }, { data: log }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, starts_at, ends_at, status, helpers_needed, assignments(role, status, profiles(full_name)), descriptions(status, submitted_at), event_photo_folders(photo_count, marked_uploaded_at)")
      .eq("cycle_id", cycle.id)
      .neq("status", "dropped")
      .order("starts_at"),
    supabase.rpc("cycle_hand_in", { cycles: [cycle.id] }),
    supabase.rpc("description_overview"),
    // The reminders sent (send_oc_reminders() logs each one); readable by the Events team.
    supabase.from("activity_log").select("event_id, at, details").eq("cycle_id", cycle.id).eq("action", "remind").order("at"),
  ]);
  const handInOf = new Map((handIn ?? []).map((h) => [h.event_id, h]));
  const lateOf = new Map((overview ?? []).filter((o) => o.cycle_id === cycle.id).map((o) => [o.event_id, o.late || o.missed]));
  const reminded = new Map<string, MonthEvent["reminded"]>();
  for (const l of log ?? []) {
    const logged = (l.details as { reminded?: string } | null)?.reminded;
    // "report": the old manual reminder of the event report, part of the hand-in.
    const about = logged === "report" ? "handin" : logged;
    if (!l.event_id || (about !== "description" && about !== "handin")) continue;
    reminded.set(l.event_id, { ...reminded.get(l.event_id), [about]: l.at });
  }
  const confirmed = cycle.status === "confirmed";
  const deadlinePassed = !!cycle.description_deadline && Date.parse(cycle.description_deadline) < now;

  return (events ?? []).map((e) => {
    const active = (e.assignments ?? []).filter((a) => a.status === "active");
    const oc = (active.find((a) => a.role === "oc")?.profiles as { full_name: string } | null)?.full_name ?? null;
    const helpers = active.filter((a) => a.role === "helper").length;
    const d = e.descriptions as { status: string; submitted_at: string | null } | null;
    const description = d?.status ?? "missing";
    const h = handInOf.get(e.id);
    const started = Date.parse(e.starts_at) <= now;
    const running = !["cancelled", "dropped"].includes(e.status);
    const parts = !started || !running ? null : h ? { list: h.signed_off, photos: h.photos_in, report: h.report_in } : { list: false, photos: photosIn(e.event_photo_folders as never), report: false };
    const missing = parts ? ([!parts.list && "attendance list", !parts.photos && "photos", !parts.report && "event report"].filter(Boolean) as string[]) : [];
    const short = !oc || helpers < e.helpers_needed;
    return {
      id: e.id,
      title: e.title,
      startsAt: e.starts_at,
      status: confirmed ? shownStatus({ status: e.status, startsAt: e.starts_at, endsAt: e.ends_at, short }, now) : e.status,
      oc,
      helpers,
      helpersNeeded: e.helpers_needed,
      confirmed,
      description,
      submittedAt: d?.submitted_at ?? null,
      descriptionLate: lateOf.get(e.id) ?? false,
      started,
      running,
      missing,
      handIn: parts,
      staffOpen: confirmed && running && !started && short,
      descOpen: confirmed && running && !started && OPEN_DESCRIPTION.includes(description),
      handInOpen: confirmed && running && started && missing.length > 0,
      deadlinePassed,
      reminded: reminded.get(e.id) ?? {},
    };
  });
}
