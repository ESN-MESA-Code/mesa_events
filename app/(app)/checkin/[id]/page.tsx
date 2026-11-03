import type { Metadata } from "next";
import { loadInternalForPage } from "@/lib/internalEvents";
import { internalPath } from "@/lib/internal";
import { CheckIn } from "./CheckIn";

export const metadata: Metadata = { title: "Check in" };

// Where the QR code on HR's screen leads (round 2026-11-03 (2)): signed in
// (the login comes back here), the member is checked in at once. The token
// is good for three minutes; the database checks it and the time.
export default async function CheckinPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const { event } = await loadInternalForPage(id);
  return <CheckIn eventId={id} title={event.title} token={t ?? null} back={internalPath(event.kind, id)} />;
}
