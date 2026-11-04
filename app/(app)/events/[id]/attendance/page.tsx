import type { Metadata } from "next";
import { loadEventForPage } from "@/lib/events";
import { Alert, Card, CardContent, EmptyState } from "@/components/ui";
import { AttendanceManager } from "./AttendanceManager";
import type { Event as ListEvent } from "@/types/attendance";
import { headers } from "next/headers";
import { appBaseUrl } from "@/lib/env";

export const metadata: Metadata = { title: "Attendance" };

// The event's attendance list (moved in from MESAttendance): QR code, live
// names, kiosk mode, sign-off with a headcount, the counts for Finance.
export default async function AttendanceTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, supabase, isOc, isEvents, isStaff, isTeam, viewer } = await loadEventForPage(id);

  if (!isStaff && !isTeam) {
    return (
      <Card>
        <EmptyState>The attendance list is for the event&apos;s OC and helpers.</EmptyState>
      </Card>
    );
  }

  const [{ data: list }, { data: oc }] = await Promise.all([
    supabase.from("attendance_lists").select("*").eq("event_id", id).maybeSingle(),
    // Several OCs since 2026-11-04: any of them signs off.
    supabase.from("assignments").select("profiles(email)").eq("event_id", id).eq("role", "oc").eq("status", "active"),
  ]);
  if (!list) {
    return (
      <Card>
        <EmptyState>This event has no attendance list (any more – lists are deleted after three years).</EmptyState>
      </Card>
    );
  }

  const listEvent: ListEvent = {
    id,
    title: event.title,
    event_date: event.starts_at,
    public_token: list.public_token,
    risk_notice: list.risk_notice,
    signed_off_at: list.signed_off_at,
    signed_off_by: list.signed_off_by,
    headcount: list.headcount,
  };
  const ocEmail = (oc ?? []).map((o) => (o.profiles as { email: string } | null)?.email).filter(Boolean).join(", ") || null;
  // The sign-in link as participants open it: the configured base URL, else this request's own (local runs).
  const h = await headers();
  const base = process.env.APP_BASE_URL ? appBaseUrl() : `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <div className="space-y-4">
      {(event.type === "day_trip" || event.type === "weekend_trip") && (
        <Alert tone="warning">LMU does not accept digital attendance lists: for funded trips keep the paper list as well.</Alert>
      )}
      <CardContent className="p-0">
        <AttendanceManager
          event={listEvent}
          canSignOff={isOc || (isEvents && !ocEmail)}
          canOrganise={isStaff || isEvents}
          ocEmail={ocEmail}
          isExecutive={viewer.roles.includes("executive")}
          attendanceUrl={`${base}/event/${list.public_token}`}
        />
      </CardContent>
    </div>
  );
}
