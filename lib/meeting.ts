// The meeting point (round 2026-11-02): where people meet when that is not
// where the event happens – a hike meets at München Hauptbahnhof and takes
// place at the Tegernsee. Optional: a place's name, its address (the same
// shapes as the event's, lib/address.ts) and the time to be there (Berlin
// time on the event's day). Pure (tests/unit/meeting.test.ts).
import { DEFAULT_ADDRESS, formatVenue, hasAddress, validateAddress, type EventAddress } from "@/lib/address";

export interface EventMeeting {
  /** The place's name ("München Hauptbahnhof"); may be empty when only the address is known. */
  point: string;
  address: EventAddress | null;
  /** "HH:MM", or "" when not set. */
  time: string;
}

/** The meeting columns of an event row (events.meeting_*). */
type MeetingColumns = {
  meeting_point?: string | null;
  meeting_country?: string | null;
  meeting_street?: string | null;
  meeting_postal_code?: string | null;
  meeting_city?: string | null;
  meeting_time?: string | null;
};

/** "08:15:00" → "08:15"; anything else → "". */
export function clockOf(time: string | null | undefined): string {
  const m = String(time ?? "").match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

/** The event's meeting point, or null when people meet at the location. */
export function eventMeeting(e: MeetingColumns): EventMeeting | null {
  const address: EventAddress = { country: e.meeting_country || "DE", street: e.meeting_street ?? "", postalCode: e.meeting_postal_code ?? "", city: e.meeting_city ?? "" };
  const point = (e.meeting_point ?? "").trim();
  if (!point && !hasAddress(address)) return null;
  return { point, address: hasAddress(address) ? address : null, time: clockOf(e.meeting_time) };
}

/** "München Hauptbahnhof (Bayerstraße 10a, 80335 München)" – the place as the post names it. */
export function meetingPlace(m: Pick<EventMeeting, "point" | "address"> | null): string {
  return m ? formatVenue(m.point, m.address) : "";
}

/** The place with the time: "München Hauptbahnhof (…) at 08:15". */
export function meetingLine(m: EventMeeting | null): string {
  const place = meetingPlace(m);
  if (!place) return "";
  return m!.time ? `${place} at ${m!.time}` : place;
}

/** For lists (Home, the header): "Meet 08:15 at München Hauptbahnhof" – the name only, or the street when there is none. */
export function meetingShort(m: EventMeeting | null): string {
  if (!m) return "";
  const where = m.point || m.address?.street || "";
  if (!where) return "";
  return m.time ? `Meet ${m.time} at ${where}` : `Meet at ${where}`;
}

/**
 * Which lines of the post differ from what the fields say. The venue line is
 * compared with the location only – the meeting point has its own line, so a
 * meeting point that is not the location is not a mismatch. A post whose venue
 * line names the meeting point (written before there was a meeting line) is
 * not flagged either: it is not wrong, only less precise.
 */
export function placeMismatch(post: { venue: string; meeting: string }, fields: { venue: string; meeting: string }): { venue: boolean; meeting: boolean } {
  const postVenue = post.venue.trim();
  const venue = !!fields.venue && postVenue !== fields.venue && !(fields.meeting && postVenue === fields.meeting);
  const meeting = !!fields.meeting && post.meeting.trim() !== fields.meeting;
  return { venue, meeting };
}

// ── The forms (event details, description) ──────────────────────────────────

/** What the meeting fields hold while editing. */
export interface MeetingDraft {
  point: string;
  address: EventAddress;
  /** "HH:MM" or "". */
  time: string;
}

export function meetingDraft(m: EventMeeting | null): MeetingDraft {
  return { point: m?.point ?? "", address: m?.address ?? { ...DEFAULT_ADDRESS }, time: m?.time ?? "" };
}

/** True once someone typed a street or postal code (the city alone is the default). */
export const addressStarted = (a: EventAddress) => !!(a.street.trim() || a.postalCode.trim());

/** What updateEvent's `meeting` takes. */
export interface MeetingInput {
  point: string;
  address: { country: string; street: string; postal_code: string; city: string } | null;
  time: string | null;
}

/**
 * The draft as updateEvent's `meeting`: null when nothing is entered (they
 * meet at the location); an error when the address is started but not
 * complete, or a time has no place.
 */
export function meetingInput(d: MeetingDraft): { value: MeetingInput | null; error?: undefined } | { error: string; value?: undefined } {
  const point = d.point.trim();
  const started = addressStarted(d.address);
  if (!point && !started) return d.time ? { error: "Name the meeting point for the meeting time – or clear the time." } : { value: null };
  if (started && Object.keys(validateAddress(d.address)).length) return { error: "Please check the meeting point's address." };
  if (d.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) return { error: "The meeting time is not a time (HH:MM)." };
  const a = d.address;
  return {
    value: {
      point,
      address: started ? { country: a.country, street: a.street.trim(), postal_code: a.postalCode.trim(), city: a.city.trim() } : null,
      time: d.time || null,
    },
  };
}

/** The draft as the post's meeting line (the place; the address only once complete). */
export function draftPlace(d: MeetingDraft): string {
  const complete = !Object.keys(validateAddress(d.address)).length;
  return complete ? formatVenue(d.point, d.address) : d.point.trim();
}
