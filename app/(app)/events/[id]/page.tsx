import type { Metadata } from "next";
import { loadEventForPage } from "@/lib/events";
import { formatCents, formatDateTime, formatShortDate, isoToBerlinInput, nowMs } from "@/lib/dates";
import { describeActivity } from "@/lib/activity";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { claimSlot, decideUnderstaffed, reopenEvent, requestChatSpace } from "@/app/actions/roster";
import { CANCEL_CONSEQUENCES, CancelEventForm, DropOutButton, EventDetailsForm } from "./EventClient";
import { EventChecklist } from "./EventChecklist";
import { isAre, plural } from "@/lib/plural";

export const metadata: Metadata = { title: "Event" };

export default async function EventOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, supabase, viewer, myAssignment, isOc, isEvents, canManage, isStaff, isTeam } = await loadEventForPage(id);

  const [{ data: roster }, { data: slots }, { data: log }, { data: reasons }] = await Promise.all([
    supabase.from("assignments").select("id, role, status, source, dropped_at, profile_id, profiles(full_name, email)").eq("event_id", id).order("created_at"),
    supabase.rpc("open_slots"),
    supabase.from("activity_log").select("id, at, actor_email, entity, action, details").eq("event_id", id).order("at", { ascending: false }).limit(20),
    // Drop-out reasons: the OC and the Events team only (RLS).
    canManage ? supabase.from("assignment_drop_reasons").select("assignment_id, reason").eq("event_id", id) : Promise.resolve({ data: [] }),
  ]);
  const reasonOf = new Map((reasons ?? []).map((r) => [r.assignment_id, r.reason]));
  const active = (roster ?? []).filter((a) => a.status === "active");
  const dropped = (roster ?? []).filter((a) => a.status === "dropped_out");
  const slot = (slots ?? []).find((s) => s.event_id === id);
  const upcoming = Date.parse(event.starts_at) > nowMs();
  const name = (a: (typeof active)[number]) => (a.profiles as { full_name: string } | null)?.full_name ?? "?";
  const names = new Map((roster ?? []).map((a) => [a.profile_id, name(a)]));
  // Plain language for everyone; the raw log for Events, executives and admins.
  const rawLog = isEvents || viewer.roles.includes("executive") || viewer.roles.includes("admin");
  const activity = (log ?? [])
    .map((l) => ({ ...l, text: describeActivity({ ...l, details: (l.details ?? {}) as Record<string, unknown> }, (pid) => names.get(pid)) }))
    .filter((l) => l.text)
    .slice(0, 8);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        {event.status === "understaffed" && (
          <Alert tone="warning" id="decide" className="scroll-mt-4" data-testid="understaffed-banner">
            <p className="font-medium">This event is short of people.</p>
            <p className="mt-1">
              {slot?.open_oc ? "It has no OC. " : ""}
              {slot && slot.open_helpers > 0 ? `${plural(slot.open_helpers, "helper slot")} ${isAre(slot.open_helpers)} open. ` : ""}
              {canManage ? "As OC you decide whether it runs as it is or is cancelled." : "The OC decides whether it runs."}
            </p>
            {canManage && (
              <div className="mt-2 flex gap-2">
                <ActionButton action={decideUnderstaffed} input={{ event_id: id, decision: "run" }} variant="success">
                  Run it anyway
                </ActionButton>
                <ActionButton action={decideUnderstaffed} input={{ event_id: id, decision: "cancel" }} variant="destructive" confirm={`Cancel this event? ${CANCEL_CONSEQUENCES}`}>
                  Cancel the event
                </ActionButton>
              </div>
            )}
          </Alert>
        )}

        {event.status === "cancelled" && (
          <Alert tone="error" data-testid="cancelled-banner">
            <p className="font-medium">This event is cancelled.</p>
            <p className="mt-1">
              {event.cancelled_at ? `Cancelled ${formatShortDate(event.cancelled_at)}` : "Cancelled"}
              {event.cancel_reason ? ` – ${event.cancel_reason}` : ""}. The team and the Chat space were told; receipts already registered stay valid.
            </p>
            {isEvents && upcoming && (
              <div className="mt-2">
                <ActionButton action={reopenEvent} input={{ event_id: id }} variant="outline" confirm="Reopen this event? It goes back to confirmed or under-staffed, depending on its team, and the Chat space is told.">
                  Reopen the event
                </ActionButton>
              </div>
            )}
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
              <dt className="text-gray-500">Starts</dt>
              <dd>{formatDateTime(event.starts_at)}</dd>
              <dt className="text-gray-500">Ends</dt>
              <dd>{event.ends_at ? formatDateTime(event.ends_at) : "–"}</dd>
              <dt className="text-gray-500">Location</dt>
              <dd>{event.location || "–"}</dd>
              <dt className="text-gray-500">Price</dt>
              <dd>{event.price_cents === null ? "TBA" : event.price_cents === 0 ? "Free" : formatCents(event.price_cents)}</dd>
              <dt className="text-gray-500">Capacity</dt>
              <dd>{event.capacity ?? "–"}</dd>
              <dt className="text-gray-500">Helpers needed</dt>
              <dd>{event.helpers_needed}</dd>
            </dl>
            {canManage && !["dropped", "cancelled"].includes(event.status) && (
              <EventDetailsForm
                eventsTeam={isEvents}
                event={{
                  id,
                  startsAt: isoToBerlinInput(event.starts_at),
                  endsAt: event.ends_at ? isoToBerlinInput(event.ends_at) : "",
                  location: event.location ?? "",
                  price: event.price_cents === null ? "" : (event.price_cents / 100).toFixed(2),
                  capacity: event.capacity ? String(event.capacity) : "",
                }}
              />
            )}
            {isEvents && upcoming && ["confirmed", "understaffed"].includes(event.status) && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <CancelEventForm eventId={id} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <span className="text-sm text-gray-500">
              {active.filter((a) => a.role === "helper").length}/{event.helpers_needed} helpers
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            {!roster?.length && <EmptyState>The roster is not published yet.</EmptyState>}
            {event.understaffed_decision === "run" && active.filter((a) => a.role === "helper").length < event.helpers_needed && (
              <p className="text-xs text-gray-600" data-testid="runs-short">
                Runs with fewer helpers – decided {event.understaffed_decided_at ? formatShortDate(event.understaffed_decided_at) : ""}. Open slots can still be claimed.
              </p>
            )}
            <ul className="space-y-1.5 text-sm" data-testid="roster">
              {active
                .sort((a, b) => (a.role === b.role ? 0 : a.role === "oc" ? -1 : 1))
                .map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Badge tone={a.role === "oc" ? "blue" : "gray"}>{a.role === "oc" ? "OC" : "Helper"}</Badge>
                    <span className="font-medium text-gray-900">{name(a)}</span>
                    {a.source === "replacement" && <span className="text-xs text-gray-500">(took an open slot)</span>}
                    {a.profile_id === viewer.id && upcoming && (
                      <span className="ml-auto">
                        <DropOutButton assignmentId={a.id} role={a.role as "oc" | "helper"} />
                      </span>
                    )}
                  </li>
                ))}
            </ul>
            {slot && upcoming && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm space-y-2" data-testid="open-slots">
                <p className="font-medium text-amber-900">Open slots</p>
                <div className="flex flex-wrap gap-2">
                  {slot.open_oc && !isStaff && (
                    <ActionButton action={claimSlot} input={{ event_id: id, role: "oc" }} confirm="Become the OC of this event?">
                      Claim the OC slot
                    </ActionButton>
                  )}
                  {slot.open_helpers > 0 && !isStaff && (
                    <ActionButton action={claimSlot} input={{ event_id: id, role: "helper" }} confirm="Help at this event?">
                      Claim a helper slot ({slot.open_helpers} open)
                    </ActionButton>
                  )}
                  {isStaff && <span className="text-amber-900">{slot.open_oc ? "The OC slot" : plural(slot.open_helpers, "helper slot")} open – find a replacement in the Chat space.</span>}
                </div>
              </div>
            )}
            {dropped.length > 0 && (isTeam || isOc) && (
              <p className="text-xs text-gray-500" data-testid="dropped-out">
                Dropped out: {dropped.map((a) => `${name(a)} (${a.role}${reasonOf.get(a.id) ? `: ${reasonOf.get(a.id)}` : ""})`).join("; ")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <EventChecklist eventId={id} />
        <Card id="chat-space" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Chat space</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2" data-testid="chat-space">
            {event.chat_space_url ? (
              <a href={event.chat_space_url} target="_blank" rel="noopener noreferrer" className="text-esn font-medium hover:underline">
                Open the event&apos;s Chat space ↗
              </a>
            ) : event.chat_space_requested_at ? (
              <p className="text-gray-600">The space is being created…</p>
            ) : (
              <p className="text-gray-600">No space yet – it is created when the month&apos;s roster is confirmed.</p>
            )}
            {isEvents && !event.chat_space_requested_at && !["draft", "dropped"].includes(event.status) && (
              <ActionButton action={requestChatSpace} input={{ event_id: id }} variant="outline">
                Create Chat space now
              </ActionButton>
            )}
          </CardContent>
        </Card>
        {myAssignment && !upcoming && <p className="text-xs text-gray-500">The event has started; dropping out is no longer possible here.</p>}
        {(activity.length > 0 || (rawLog && (log ?? []).length > 0)) && (
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ul className="text-sm text-gray-700 space-y-1" data-testid="activity">
                {activity.map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-x-2">
                    <span>{l.text}</span>
                    <span className="ml-auto text-xs text-gray-500">{formatShortDate(l.at)}</span>
                  </li>
                ))}
              </ul>
              {rawLog && (
                <details className="text-xs text-gray-600">
                  <summary className="cursor-pointer text-esn">Raw log</summary>
                  <ul className="mt-1 space-y-1 font-mono" data-testid="raw-log">
                    {(log ?? []).map((l) => (
                      <li key={l.id}>
                        {formatDateTime(l.at)} · {l.actor_email ?? "system"} · {l.entity} {l.action}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
