import type { Metadata } from "next";
import { loadEventForPage } from "@/lib/events";
import { formatCents, formatDateTime, formatShortDate, isoToBerlinInput, nowMs } from "@/lib/dates";
import { describeActivity } from "@/lib/activity";
import { understaffedNote } from "@/lib/checklist";
import { Clock, MapPin, MessageSquare, Navigation, Ticket, UserPlus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Alert, buttonVariants, EmptyState } from "@/components/ui";
import { Panel } from "@/components/Panel";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/ActionButton";
import { claimSlot, decideUnderstaffed, reopenEvent, requestChatSpace } from "@/app/actions/roster";
import { CancelEventForm, CancellationDecision, DropOutButton, EventDetailsForm, RequestCancellationForm } from "./EventClient";
import { CANCEL_CONSEQUENCES } from "@/lib/labels";
import { EventChecklist } from "./EventChecklist";
import { AttendanceReport } from "./AttendanceReport";
import type { AttendanceOutcome } from "@/lib/reliability";
import { isAre, plural } from "@/lib/plural";
import { STATE_MARK, stateLabel, type ChannelState } from "@/lib/publishing";
import { eventAddress, formatVenue, hasAddress } from "@/lib/address";
import { eventMeeting, meetingLine } from "@/lib/meeting";

export const metadata: Metadata = { title: "Event" };

export default async function EventOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, supabase, viewer, myAssignment, isOc, isEvents, canManage, isStaff, isTeam, cycle } = await loadEventForPage(id);

  // After the start the OC (or the Events team) reports who was missing (2026-11-07).
  const mayReport = (isOc || isEvents) && Date.parse(event.starts_at) <= nowMs() && !["cancelled", "dropped", "draft"].includes(event.status);
  const [{ data: roster }, { data: slots }, { data: log }, { data: reasons }, { data: published }, { data: requests }, { data: reports }] = await Promise.all([
    supabase.from("assignments").select("id, role, status, source, dropped_at, profile_id, profiles(full_name, email)").eq("event_id", id).order("created_at"),
    supabase.rpc("open_slots"),
    supabase.from("activity_log").select("id, at, actor_email, entity, action, details").eq("event_id", id).order("at", { ascending: false }).limit(20),
    // Drop-out reasons: the OC and the Events team only (RLS).
    canManage ? supabase.from("assignment_drop_reasons").select("assignment_id, reason").eq("event_id", id) : Promise.resolve({ data: [] }),
    // Where the event is published (brief 2026-10-29, E1): staff and teams, read-only.
    isStaff || isTeam ? supabase.rpc("publication_status", { events: [id] }) : Promise.resolve({ data: [] }),
    // Cancellation requests (round 2026-11-03): the OC asks, the Events team decides.
    isStaff || isTeam
      ? supabase.from("cancellation_requests").select("id, requested_by, reason, requested_at, decision, decision_note, decided_at").eq("event_id", id).order("requested_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
    mayReport ? supabase.from("attendance_reports").select("assignment_id, outcome, note").eq("event_id", id) : Promise.resolve({ data: [] }),
  ]);
  const reportOf = new Map((reports ?? []).map((r) => [r.assignment_id, { outcome: r.outcome as AttendanceOutcome, note: r.note }]));
  const { data: channelNames } = (published ?? []).length ? await supabase.from("publication_channels").select("key, name") : { data: [] };
  const channelName = new Map((channelNames ?? []).map((c) => [c.key, c.name]));
  const reasonOf = new Map((reasons ?? []).map((r) => [r.assignment_id, r.reason]));
  const active = (roster ?? []).filter((a) => a.status === "active");
  const dropped = (roster ?? []).filter((a) => a.status === "dropped_out");
  const slot = (slots ?? []).find((s) => s.event_id === id);
  const hasOc = active.some((a) => a.role === "oc");
  const helpers = active.filter((a) => a.role === "helper").length;
  const lastRequest = (requests ?? [])[0] ?? null;
  const openRequest = lastRequest && !lastRequest.decision ? lastRequest : null;
  const requester = openRequest ? ((roster ?? []).find((a) => (a.profiles as { email: string } | null)?.email === openRequest.requested_by)?.profiles as { full_name: string } | null)?.full_name ?? openRequest.requested_by : null;
  // The OC asks instead of cancelling; the Events team cancels directly.
  const mayAsk = isOc && !isEvents && !openRequest && ["confirmed", "understaffed"].includes(event.status);
  const upcoming = Date.parse(event.starts_at) > nowMs();
  // What a confirm dialog names (usability review #8).
  const when = formatDateTime(event.starts_at);
  const venue = formatVenue(event.location, eventAddress(event));
  const meeting = eventMeeting(event);
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
              {understaffedNote(hasOc, isOc ? "oc" : isEvents ? "events" : "other")}
            </p>
            {canManage && (
              <div className="mt-2 flex gap-2">
                {hasOc && (
                  <ActionButton action={decideUnderstaffed} input={{ event_id: id, decision: "run" }} variant="success" done="It runs with the team it has – open slots can still be claimed.">
                    Run it anyway
                  </ActionButton>
                )}
                {isEvents ? (
                  <ActionButton
                    action={decideUnderstaffed}
                    input={{ event_id: id, decision: "cancel" }}
                    variant="destructive"
                    confirm={{ title: `Cancel ${event.title} on ${when}?`, body: CANCEL_CONSEQUENCES, confirmLabel: "Cancel the event", cancelLabel: "Keep it", danger: true }}
                    done="Event cancelled."
                  >
                    Cancel the event
                  </ActionButton>
                ) : (
                  mayAsk && upcoming && <RequestCancellationForm eventId={id} title={event.title} when={when} />
                )}
              </div>
            )}
          </Alert>
        )}

        {openRequest && (
          <Alert tone="warning" data-testid="cancellation-request">
            <p className="font-medium">
              {requester} asked the Events team to cancel this event ({formatShortDate(openRequest.requested_at)}).
            </p>
            <p className="mt-1">“{openRequest.reason}” – it stays on until the Events team decides.</p>
            <CancellationDecision requestId={openRequest.id} title={event.title} when={when} canDecide={isEvents && upcoming} canWithdraw={isOc && !isEvents} />
          </Alert>
        )}
        {!openRequest && lastRequest?.decision === "declined" && (isOc || isEvents) && event.status !== "cancelled" && (
          <Alert tone="info" data-testid="cancellation-declined">
            The Events team kept this event on ({formatShortDate(lastRequest.decided_at!)}): “{lastRequest.decision_note}”
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
                <ActionButton
                  action={reopenEvent}
                  input={{ event_id: id }}
                  variant="outline"
                  confirm={{ title: `Reopen ${event.title} on ${when}?`, body: "It goes back to confirmed or under-staffed, depending on its team, and the Chat space is told.", confirmLabel: "Reopen" }}
                  done="Event reopened."
                >
                  Reopen the event
                </ActionButton>
              </div>
            )}
          </Alert>
        )}

        <Panel title="Details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-6">
            <Fact icon={Clock} label="Starts">
              {formatDateTime(event.starts_at)}
            </Fact>
            <Fact icon={Clock} label="Ends">
              {event.ends_at ? formatDateTime(event.ends_at) : "–"}
            </Fact>
            <Fact icon={MapPin} label="Location" testId="event-location" wide>
              {formatVenue(event.location, eventAddress(event)) || "–"}
            </Fact>
            {meeting && (
              <Fact icon={Navigation} label="Meeting point" testId="event-meeting" wide>
                {meetingLine(meeting)}
              </Fact>
            )}
            <Fact icon={Ticket} label="Price">
              {event.price_cents === null ? "TBA" : event.price_cents === 0 ? "Free" : formatCents(event.price_cents)}
            </Fact>
            <Fact icon={Users} label="Capacity">
              {event.capacity ?? "–"}
            </Fact>
          </dl>
          {canManage && !["dropped", "cancelled"].includes(event.status) && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <EventDetailsForm
                eventsTeam={isEvents}
                event={{
                  id,
                  startsAt: isoToBerlinInput(event.starts_at),
                  endsAt: event.ends_at ? isoToBerlinInput(event.ends_at) : "",
                  location: event.location ?? "",
                  address: hasAddress(eventAddress(event)) ? eventAddress(event) : null,
                  meeting,
                  price: event.price_cents === null ? "" : (event.price_cents / 100).toFixed(2),
                  capacity: event.capacity ? String(event.capacity) : "",
                }}
              />
            </div>
          )}
          {isEvents && upcoming && ["confirmed", "understaffed"].includes(event.status) && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <CancelEventForm eventId={id} title={event.title} when={when} />
            </div>
          )}
          {mayAsk && upcoming && event.status === "confirmed" && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <RequestCancellationForm eventId={id} title={event.title} when={when} />
            </div>
          )}
        </Panel>

        <Panel
          title="Team"
          aside={
            <span className="text-sm text-gray-600">
              <span className="font-semibold tabular-nums text-gray-900">
                {helpers}/{event.helpers_needed}
              </span>{" "}
              helpers
            </span>
          }
        >
          {event.helpers_needed > 0 && (
            <div className="-mt-1 mb-4 h-1.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${helpers} of ${event.helpers_needed} helpers`}>
              <div className={cn("h-full rounded-full", helpers >= event.helpers_needed ? "bg-emerald-500" : "bg-esn")} style={{ width: `${Math.min(100, (helpers / event.helpers_needed) * 100)}%` }} />
            </div>
          )}
          {!roster?.length && <EmptyState>The roster is not published yet.</EmptyState>}
          {event.understaffed_decision === "run" && helpers < event.helpers_needed && (
            <p className="mb-3 text-xs text-gray-600" data-testid="runs-short">
              Runs with fewer helpers – decided {event.understaffed_decided_at ? formatShortDate(event.understaffed_decided_at) : ""}. Open slots can still be claimed.
            </p>
          )}
          <ul className="divide-y divide-gray-100" data-testid="roster">
            {active
              .sort((a, b) => (a.role === b.role ? 0 : a.role === "oc" ? -1 : 1))
              .map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", a.role === "oc" ? "bg-esn text-white" : "bg-esn/10 text-esn-dark")}
                    aria-hidden="true"
                  >
                    {initials(name(a))}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium text-gray-900">
                      {name(a)}
                      {a.profile_id === viewer.id && <span className="ml-1.5 text-xs font-semibold text-esn">(you)</span>}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {a.role === "oc" ? "OC" : "Helper"}
                      {a.source === "replacement" && " · took an open slot"}
                    </span>
                  </span>
                  {a.profile_id === viewer.id && upcoming && <DropOutButton assignmentId={a.id} role={a.role as "oc" | "helper"} title={event.title} />}
                </li>
              ))}
          </ul>
          {slot && upcoming && (
            <div className="mt-4 space-y-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-3 text-sm" data-testid="open-slots">
              <p className="flex flex-wrap items-center gap-x-2 font-semibold text-amber-900">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Open slots
                <span className="font-normal text-amber-800">
                  {[slot.open_oc && "the OC", slot.open_helpers > 0 && plural(slot.open_helpers, "helper")].filter(Boolean).join(" and ")}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {slot.open_oc && !isStaff && (
                  <ActionButton
                    action={claimSlot}
                    input={{ event_id: id, role: "oc" }}
                    confirm={{ title: `Become the OC of ${event.title}?`, body: `${when}${venue ? ` · ${venue}` : ""}. You own the event from now on: details, description, attendance and hand-in. You are added to its Chat space.`, confirmLabel: "Become the OC" }}
                    done={`You're now the OC of ${event.title} – the description is your next step.`}
                  >
                    Claim the OC slot
                  </ActionButton>
                )}
                {slot.open_helpers > 0 && !isStaff && (
                  <ActionButton
                    action={claimSlot}
                    input={{ event_id: id, role: "helper" }}
                    confirm={{ title: `Help at ${event.title}?`, body: `${when}${venue ? ` · ${venue}` : ""}. The OC is told, and you are added to the event's Chat space.`, confirmLabel: "Yes, I'll help" }}
                    done={`You're now a helper at ${event.title} – see you on ${formatShortDate(event.starts_at)}.`}
                  >
                    Claim a helper slot ({slot.open_helpers} open)
                  </ActionButton>
                )}
                {isStaff && <span className="text-amber-900">{slot.open_oc ? "The OC slot" : plural(slot.open_helpers, "helper slot")} open – find a replacement in the Chat space.</span>}
              </div>
            </div>
          )}
          {dropped.length > 0 && (isTeam || isOc) && (
            <p className="mt-3 text-xs text-gray-500" data-testid="dropped-out">
              Dropped out: {dropped.map((a) => `${name(a)} (${a.role}${reasonOf.get(a.id) ? `: ${reasonOf.get(a.id)}` : ""})`).join("; ")}
            </p>
          )}
        </Panel>

        {mayReport && active.some((a) => a.profile_id !== viewer.id) && (
          <Panel title="Who was missing?" id="attendance-report">
            <AttendanceReport
              eventId={id}
              members={active
                .filter((a) => a.profile_id !== viewer.id)
                .sort((a, b) => (a.role === b.role ? 0 : a.role === "oc" ? -1 : 1))
                .map((a) => ({ assignmentId: a.id, name: name(a), role: a.role as "oc" | "helper", report: reportOf.get(a.id) ?? null }))}
            />
          </Panel>
        )}
      </div>

      <div className="space-y-6">
        <EventChecklist eventId={id} />
        <Panel title="Chat space" id="chat-space">
          <div className="space-y-3 text-sm" data-testid="chat-space">
            {event.chat_space_url ? (
              <a href={event.chat_space_url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                Open the event&apos;s Chat space ↗
              </a>
            ) : event.chat_space_requested_at ? (
              <p className="text-gray-600">The space is being created…</p>
            ) : cycle && cycle.status !== "confirmed" ? (
              // Say which "confirmed" is meant (usability review #30): the event's status vs the month's roster.
              <p className="text-gray-600">No space yet – it is created when the Events team confirms the month&apos;s roster{event.status === "confirmed" ? " (the event itself is already confirmed)" : ""}.</p>
            ) : (
              <p className="text-gray-600">No space yet, although the month&apos;s roster is confirmed – {isEvents ? "create it below." : "the Events team can create it."}</p>
            )}
            {isEvents && !event.chat_space_requested_at && !["draft", "dropped"].includes(event.status) && (
              <ActionButton action={requestChatSpace} input={{ event_id: id }} variant="outline" done="The Chat space is being created.">
                Create Chat space now
              </ActionButton>
            )}
          </div>
        </Panel>
        {(published ?? []).length > 0 && (
          <Panel title="Chat space and advertising">
            <ul className="divide-y divide-gray-100 text-sm" data-testid="published-on">
              {(published ?? []).map((p) => {
                const state = p.state as ChannelState;
                return (
                  <li key={p.channel} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                    <span className="w-28 font-medium text-gray-700">{channelName.get(p.channel) ?? p.channel}</span>
                    <span className={state === "published" ? "text-emerald-700" : state === "planned" ? "text-esn" : "text-gray-500"}>
                      {STATE_MARK[state]} {stateLabel(p.channel, state)}
                      {p.at && state !== "not_planned" ? ` ${formatShortDate(p.at)}` : ""}
                    </span>
                    {state === "published" && p.link && (
                      <a href={p.link} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-semibold text-esn hover:underline">
                        Open
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
        {myAssignment && !upcoming && <p className="text-xs text-gray-500">The event has started; dropping out is no longer possible here.</p>}
        {(activity.length > 0 || (rawLog && (log ?? []).length > 0)) && (
          <Panel title="Recent activity">
            <ul className="space-y-3 text-sm text-gray-700" data-testid="activity">
              {activity.map((l) => (
                <li key={l.id} className="relative flex gap-3 pl-4 before:absolute before:left-0 before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-esn/30">
                  <span className="min-w-0 flex-1">{l.text}</span>
                  <span className="shrink-0 text-xs text-gray-500">{formatShortDate(l.at)}</span>
                </li>
              ))}
            </ul>
            {rawLog && (
              <details className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-esn">Raw log</summary>
                <ul className="mt-1 space-y-1 break-all font-mono" data-testid="raw-log">
                  {(log ?? []).map((l) => (
                    <li key={l.id}>
                      {formatDateTime(l.at)} · {l.actor_email ?? "system"} · {l.entity} {l.action}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

/** "Chloé Dubois" → "CD". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** One fact of the event: an icon, a small label, the value. */
function Fact({ icon: Icon, label, testId, wide, children }: { icon: LucideIcon; label: string; testId?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 gap-3", wide && "col-span-2")}>
      <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-esn/5 text-esn sm:flex" aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-gray-500">{label}</dt>
        <dd className="text-sm font-medium text-gray-900 break-words" data-testid={testId}>
          {children}
        </dd>
      </div>
    </div>
  );
}
