import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import KioskView from "@/components/attendance/KioskView";
import { attendanceFormTexts } from "@/lib/legalContent";
import type { Event } from "@/types/attendance";

// Attendance form on an OC's or helper's device, for participants without a
// phone or internet. Outside the member layout so the navigation is hidden.
export default async function KioskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Defence in depth – the proxy already redirects signed-out visitors.
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/kiosk/${id}`)}`);

  const supabase = await createSessionClient();
  const { data: organiser } = await supabase.rpc("is_list_organiser", { event: id });
  if (organiser !== true) notFound();
  const { data: event } = await supabase.from("events").select("id, title, starts_at, attendance_lists(*)").eq("id", id).maybeSingle();
  const list = event?.attendance_lists as unknown as { public_token: string; risk_notice: string | null; signed_off_at: string | null; signed_off_by: string | null; headcount: number | null } | null;
  if (!event || !list) notFound();

  const listEvent: Event = {
    id: event.id,
    title: event.title,
    event_date: event.starts_at,
    public_token: list.public_token,
    risk_notice: list.risk_notice,
    signed_off_at: list.signed_off_at,
    signed_off_by: list.signed_off_by,
    headcount: list.headcount,
  };
  return <KioskView event={listEvent} recordedBy={viewer.email} texts={attendanceFormTexts()} />;
}
