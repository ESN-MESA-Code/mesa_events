import { loadEventForPage } from "@/lib/events";
import { eventChecklist, type ChecklistInput } from "@/lib/checklist";
import { nowMs } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

const ICON = { done: "✅", todo: "⬜", late: "⚠️", later: "◻️" } as const;

// What still has to happen for this event (OC, helpers and the teams).
export async function EventChecklist({ eventId }: { eventId: string }) {
  const { event, supabase, isStaff, isTeam, cycle } = await loadEventForPage(eventId);
  if (!isStaff && !isTeam) return null;
  const [{ data: assignments }, { data: description }, { data: list }, { count: photos }, { data: claims }] = await Promise.all([
    supabase.from("assignments").select("role").eq("event_id", eventId).eq("status", "active"),
    supabase.from("descriptions").select("status").eq("event_id", eventId).maybeSingle(),
    supabase.from("attendance_lists").select("signed_off_at").eq("event_id", eventId).maybeSingle(),
    supabase.from("event_photos").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.rpc("event_claims_summary", { event: eventId }),
  ]);
  const c = (claims ?? {}) as { receipts?: number; belege_missing?: number };
  const input: ChecklistInput = {
    status: event.status,
    startsAt: event.starts_at,
    now: nowMs(),
    hasOc: (assignments ?? []).some((a) => a.role === "oc"),
    helpers: (assignments ?? []).filter((a) => a.role === "helper").length,
    helpersNeeded: event.helpers_needed,
    chatSpace: event.chat_space_name ? "created" : event.chat_space_requested_at ? "requested" : "none",
    description: (description?.status as ChecklistInput["description"]) ?? "missing",
    descriptionDeadline: cycle?.description_deadline ?? null,
    listSignedOff: !!list?.signed_off_at,
    photos: photos ?? 0,
    receipts: c.receipts ?? 0,
    belegeMissing: c.belege_missing ?? 0,
  };
  const items = eventChecklist(input);
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist</CardTitle>
        <span className="text-xs text-gray-500">
          {items.filter((i) => i.state === "done").length}/{items.length} done
        </span>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm" data-testid="checklist">
          {items.map((i) => (
            <li key={i.key} data-state={i.state} className={cn("flex items-baseline gap-2", i.state === "later" && "text-gray-400", i.state === "late" && "text-red-700")}>
              <span aria-hidden="true">{ICON[i.state]}</span>
              <span>{i.label}</span>
              {i.detail && <span className="ml-auto text-xs text-gray-500">{i.detail}</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
