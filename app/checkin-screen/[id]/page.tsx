import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { isInternalPlanner } from "@/lib/roles";
import { appBaseUrl } from "@/lib/env";
import { takesAttendance } from "@/lib/internalAttendance";
import type { InternalKind } from "@/lib/internal";
import { CheckinScreen } from "./CheckinScreen";

export const metadata: Metadata = { title: "Check in" };

// HR's screen for a Tuesday Talk or internal event (round 2026-11-03 (2)):
// a QR code and four digits that change every 20 seconds, for the laptop or
// the projector. Outside the member layout so the navigation is hidden.
export default async function CheckinScreenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/checkin-screen/${id}`)}`);
  if (!isInternalPlanner(viewer.roles)) notFound();
  const supabase = await createSessionClient();
  const { data: event } = await supabase.from("internal_events").select("id, kind, title").eq("id", id).maybeSingle();
  if (!event || !takesAttendance(event.kind as InternalKind)) notFound();
  return <CheckinScreen eventId={id} title={event.title} base={appBaseUrl()} />;
}
