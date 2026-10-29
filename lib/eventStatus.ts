// What the checklist and the next step need about an event, loaded with the
// signed-in member's client (RLS applies). Server components only.
import { cache } from "react";
import { createSessionClient, type Db } from "@/lib/supabase/session";
import { nowMs } from "@/lib/dates";
import type { ChecklistInput } from "@/lib/checklist";
import { photosIn } from "@/lib/photos";

export interface EventForStatus {
  id: string;
  status: string;
  starts_at: string;
  helpers_needed: number;
  chat_space_name: string | null;
  chat_space_requested_at: string | null;
}

export async function checklistInput(supabase: Db, event: EventForStatus, descriptionDeadline: string | null): Promise<ChecklistInput> {
  const [{ data: assignments }, { data: description }, { data: list }, { data: photos }, { data: report }, { data: claims }] = await Promise.all([
    supabase.from("assignments").select("role").eq("event_id", event.id).eq("status", "active"),
    supabase.from("descriptions").select("status").eq("event_id", event.id).maybeSingle(),
    supabase.from("attendance_lists").select("signed_off_at").eq("event_id", event.id).maybeSingle(),
    supabase.from("event_photo_folders").select("photo_count, marked_uploaded_at").eq("event_id", event.id).maybeSingle(),
    supabase.from("event_reports").select("event_id").eq("event_id", event.id).maybeSingle(),
    supabase.rpc("event_claims_summary", { event: event.id }),
  ]);
  const c = (claims ?? {}) as { receipts?: number; belege_missing?: number };
  return {
    status: event.status,
    startsAt: event.starts_at,
    now: nowMs(),
    hasOc: (assignments ?? []).some((a) => a.role === "oc"),
    helpers: (assignments ?? []).filter((a) => a.role === "helper").length,
    helpersNeeded: event.helpers_needed,
    chatSpace: event.chat_space_name ? "created" : event.chat_space_requested_at ? "requested" : "none",
    description: (description?.status as ChecklistInput["description"]) ?? "missing",
    descriptionDeadline,
    listSignedOff: !!list?.signed_off_at,
    photos: photos?.photo_count ?? null,
    photosIn: photosIn(photos),
    reportIn: !!report,
    receipts: c.receipts ?? 0,
    belegeMissing: c.belege_missing ?? 0,
  };
}

/** Open volunteer forms and whether the member answered (navigation and Home). Cached per request. */
export const volunteerForms = cache(async (viewerId: string) => {
  const supabase = await createSessionClient();
  const { data: cycles } = await supabase.from("planning_cycles").select("id, month, form_closes_at").eq("status", "form_open").order("month");
  if (!cycles?.length) return [];
  const { data: mine } = await supabase
    .from("volunteer_responses")
    .select("cycle_id, submitted_at, volunteer_choices(event_id)")
    .eq("profile_id", viewerId)
    .in("cycle_id", cycles.map((c) => c.id));
  const byCycle = new Map((mine ?? []).map((r) => [r.cycle_id, r]));
  return cycles.map((c) => {
    const r = byCycle.get(c.id);
    return { ...c, submittedAt: r?.submitted_at ?? null, events: r ? (r.volunteer_choices ?? []).length : 0 };
  });
});
