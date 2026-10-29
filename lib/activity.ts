// The event page's "Recent activity" in plain language for the OC and
// helpers (the raw log stays available to Events, executives and admins).
// Pure (tests/unit/activity.test.ts).
import { EVENT_STATUS_LABELS, type EventStatus } from "@/lib/labels";

export interface LogEntry {
  entity: string;
  action: string;
  details: Record<string, unknown>;
  actor_email: string | null;
}

const DESCRIPTION: Record<string, string> = {
  draft: "Description started",
  submitted: "Description submitted for Comms review",
  changes_requested: "Comms asked for changes to the description",
  approved: "Comms approved the description",
  published: "Description published in the Chat space",
};

const EVENT_FIELDS: Record<string, string> = {
  starts_at: "date",
  ends_at: "end",
  location: "location",
  price_cents: "price",
  capacity: "capacity",
  title: "title",
  type: "type",
  helpers_needed: "number of helpers",
};

/** One readable line, or null for entries that mean nothing to the event's people. */
export function describeActivity(e: LogEntry, nameOf: (profileId: string) => string | undefined): string | null {
  const d = e.details ?? {};
  const who = (id: unknown) => (typeof id === "string" && nameOf(id)) || "Someone";
  if (e.entity === "events") {
    if (e.action === "insert") return "Event added to the schedule";
    if (d.understaffed_decision === "run") return "Decided to run it with fewer helpers";
    if (d.status === "cancelled") return "Event cancelled";
    if (d.status && d.cancelled_at === null) return `Event reopened (${EVENT_STATUS_LABELS[d.status as EventStatus] ?? d.status})`;
    if (typeof d.status === "string") return `Status: ${EVENT_STATUS_LABELS[d.status as EventStatus] ?? d.status}`;
    if ("understaffed_decision" in d && d.understaffed_decision === null) return "The OC left – the run-with-fewer-helpers decision was reset";
    if (d.chat_space_url || d.chat_space_name) return "Chat space created";
    const fields = Object.keys(d).filter((k) => k in EVENT_FIELDS).map((k) => EVENT_FIELDS[k]);
    return fields.length ? `Changed the ${fields.join(", ")}` : null;
  }
  if (e.entity === "assignments") {
    const role = d.role === "oc" ? "OC" : d.role === "helper" ? "helper" : null;
    if (e.action === "insert") return `${who(d.profile_id)} joined${role ? ` as ${role}` : ""}${d.source === "replacement" ? " (took an open slot)" : ""}`;
    if (e.action === "delete") return "Someone was taken off the roster";
    if (d.status === "dropped_out") return "Someone dropped out";
    if (role) return `Someone is now ${role}`;
    return null;
  }
  if (e.entity === "descriptions") return typeof d.status === "string" ? (DESCRIPTION[d.status] ?? null) : e.action === "insert" ? DESCRIPTION.draft : null;
  if (e.entity === "reviews") return d.decision === "approved" ? "Comms approved the description" : "Comms asked for changes to the description";
  if (e.entity === "attendance_lists") return d.signed_off_at ? `Attendance list signed off${typeof d.headcount === "number" ? ` (${d.headcount} counted)` : ""}` : null;
  return null;
}
