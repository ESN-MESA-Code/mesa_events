// When people can sign in to an event: from 2 hours before it starts until
// 24 hours after (or until the sign-off, if earlier). The database enforces
// the same window – public.signins_open_at() / signins_close_at() in
// supabase/migrations/20261023000000_regular_events.sql; a test compares them.

export const OPENS_BEFORE_MS = 2 * 60 * 60 * 1000;
export const CLOSES_AFTER_MS = 24 * 60 * 60 * 1000;

export function signinsOpenAt(eventDate: string): Date {
  return new Date(new Date(eventDate).getTime() - OPENS_BEFORE_MS);
}

export function signinsCloseAt(eventDate: string): Date {
  return new Date(new Date(eventDate).getTime() + CLOSES_AFTER_MS);
}

/** "upcoming" before the window, "open" inside it, "closed" after it or once signed off. */
export function listState(
  event: { event_date: string; signed_off_at: string | null },
  now = Date.now()
): "upcoming" | "open" | "closed" {
  if (event.signed_off_at || now >= signinsCloseAt(event.event_date).getTime()) return "closed";
  return now < signinsOpenAt(event.event_date).getTime() ? "upcoming" : "open";
}

/** "Thursday, 05 November 2026 at 17:00" in the viewer's time zone. */
export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
