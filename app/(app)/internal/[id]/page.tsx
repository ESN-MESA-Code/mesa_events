import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadInternalForPage } from "@/lib/internalEvents";
import { hasPresentation, internalPath, isStaffed, takesSignUps } from "@/lib/internal";
import { formatDateTime, nowMs } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { InternalHeader } from "@/components/InternalHeader";
import { signUpInternal, withdrawInternal } from "@/app/actions/internal";
import { checkinWindow, takesAttendance } from "@/lib/internalAttendance";
import { hasRole } from "@/lib/roles";
import { AttendanceCard, type AttendanceEntry } from "./Attendance";

export const metadata: Metadata = { title: "Internal event" };

// An internal event, meeting or Stammtisch (round 2026-10-30): no formal
// description – a note, the presentation of a meeting, who comes or who is
// on duty, and signing up to internal events. Tuesday Talks and internal
// events take attendance (round 2026-11-03 (2)).
export default async function InternalEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, people, mine, isPlanner, viewer, supabase } = await loadInternalForPage(id);
  if (event.kind === "office_hour") redirect(internalPath(event.kind, id));
  const upcoming = Date.parse(event.starts_at) > nowMs();
  const attendees = people.filter((p) => p.role === "attendee");
  const oc = people.find((p) => p.role === "oc");
  const helpers = people.filter((p) => p.role === "helper");
  const full = event.capacity !== null && attendees.length >= event.capacity;
  const open = takesSignUps(event.kind) && event.status === "scheduled" && upcoming;

  // Attendance (round 2026-11-03 (2)): RLS gives a member only their own row.
  const attendance = takesAttendance(event.kind);
  const seesAll = isPlanner || hasRole(viewer.roles, "executive");
  const [{ data: checked }, { data: members }] = attendance
    ? await Promise.all([
        supabase.from("internal_attendance").select("profile_id, via, added_by, created_at, removed_at, removed_by, profiles(full_name, email)").eq("internal_event_id", id).order("created_at"),
        isPlanner ? supabase.from("profiles").select("id, full_name, email").order("full_name") : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }];
  const entries: AttendanceEntry[] = (checked ?? []).map((r) => {
    const prof = r.profiles as { full_name: string; email: string } | null;
    return { profileId: r.profile_id, name: prof?.full_name || prof?.email || "?", via: r.via as AttendanceEntry["via"], addedBy: r.added_by, at: formatDateTime(r.created_at), removedAt: r.removed_at ? formatDateTime(r.removed_at) : null, removedBy: r.removed_by };
  });
  const checkin = checkinWindow(event, nowMs());

  return (
    <div className="space-y-5">
      <InternalHeader event={event} back={{ href: "/calendar?show=internal", label: "Calendar" }} role={mine?.role ?? null} planner={isPlanner} />
      {event.status === "cancelled" && <Alert tone="warning">This date is cancelled.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {event.note ? <p className="whitespace-pre-wrap">{event.note}</p> : <p className="text-gray-500">No note.</p>}
            {hasPresentation(event.kind) && (
              <p>
                {event.presentation_url ? (
                  <a href={event.presentation_url} target="_blank" rel="noopener noreferrer" className="font-medium text-esn hover:underline" data-testid="presentation-link">
                    Open the presentation ↗
                  </a>
                ) : (
                  <span className="text-gray-500">The presentation is not linked yet.</span>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        {takesSignUps(event.kind) && (
          <Card data-testid="sign-ups">
            <CardHeader>
              <CardTitle>Who comes</CardTitle>
              <Badge tone={full ? "amber" : "gray"}>
                {attendees.length}
                {event.capacity !== null && ` / ${event.capacity}`}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {mine?.role === "attendee" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-emerald-700">You are signed up ✓</span>
                  {upcoming && (
                    <ActionButton action={withdrawInternal} input={{ internal_event_id: id }} variant="outline">
                      Withdraw
                    </ActionButton>
                  )}
                </div>
              ) : open && !full ? (
                <ActionButton action={signUpInternal} input={{ internal_event_id: id }} size="default">
                  Sign up
                </ActionButton>
              ) : (
                <p className="text-gray-500">{full && open ? "This event is full." : "Sign-ups are closed."}</p>
              )}
              {!attendees.length ? <EmptyState>Nobody has signed up yet.</EmptyState> : <p className="text-gray-700">{attendees.map((a) => a.name).join(", ")}</p>}
            </CardContent>
          </Card>
        )}

        {attendance && (
          <AttendanceCard
            eventId={id}
            state={checkin.state}
            opensLabel={formatDateTime(checkin.opens)}
            closesLabel={formatDateTime(checkin.closes)}
            closedBy={event.attendance_closed_by}
            planner={isPlanner}
            seesAll={seesAll}
            mine={entries.find((e) => e.profileId === viewer.id) ?? null}
            entries={seesAll ? entries : []}
            members={(members ?? []).map((m) => ({ id: m.id, name: m.full_name || m.email }))}
          />
        )}

        {isStaffed(event.kind) && (
          <Card data-testid="duty">
            <CardHeader>
              <CardTitle>On duty</CardTitle>
              <Badge tone={oc && helpers.length >= event.helpers_needed ? "green" : "amber"}>{oc ? `OC + ${plural(helpers.length, "helper")}` : "No OC yet"}</Badge>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-gray-500">OC:</span> {oc?.name ?? "–"}
              </p>
              <p>
                <span className="text-gray-500">
                  Helpers ({helpers.length}/{event.helpers_needed}):
                </span>{" "}
                {helpers.map((h) => h.name).join(", ") || "–"}
              </p>
              <p className="pt-2 text-xs text-gray-500">HR and the Vice President assign the team.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
