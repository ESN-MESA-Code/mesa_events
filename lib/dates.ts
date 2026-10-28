// All dates are entered and shown in Europe/Berlin, whatever the time zone
// of the browser or server (a Vercel or VPS server runs in UTC). Stored as
// timestamptz (UTC). tests/unit/dates.test.ts covers DST changes.
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { TIME_ZONE } from "@/lib/env";

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-11-05T19:00" (wall clock in Berlin, a datetime-local value) → ISO timestamp (UTC). */
export function berlinInputToIso(value: string): string {
  const m = LOCAL_INPUT.exec(value);
  if (!m) throw new Error(`Not a date and time: ${value}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new TZDate(y, mo - 1, d, h, mi, 0, TIME_ZONE);
  // Times that do not exist (the hour skipped in March) move forward; check the round trip.
  return new Date(date.getTime()).toISOString();
}

/** ISO timestamp → "2026-11-05T19:00" in Berlin, for <input type="datetime-local">. */
export function isoToBerlinInput(iso: string): string {
  return format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "yyyy-MM-dd'T'HH:mm");
}

/** ISO timestamp → "2026-11-05" (the date in Berlin). */
export function berlinDate(iso: string): string {
  return format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "yyyy-MM-dd");
}

/** ISO timestamp → "19:00" in Berlin. */
export function berlinTime(iso: string): string {
  return format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "HH:mm");
}

/** "Thu, 5 Nov 2026, 19:00" */
export function formatDateTime(iso: string): string {
  return format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "EEE, d MMM yyyy, HH:mm");
}

/** "Thu, 5 Nov 2026" */
export function formatDate(iso: string): string {
  return format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "EEE, d MMM yyyy");
}

/** "Thursday, 05 November 2026 at 17:00" – the attendance form's long format. */
export function formatLongDateTime(iso: string): string {
  return format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "EEEE, dd MMMM yyyy 'at' HH:mm");
}

/** "2026-11-01" (a planning cycle's month) → "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return format(new Date(Date.UTC(y, m - 1, 15)), "MMMM yyyy");
}

/**
 * A planning cycle by the month its events take place in:
 * "2026-12-01" → "December 2026 events". Used everywhere a cycle is named.
 */
export function cycleLabel(month: string): string {
  return `${monthLabel(month)} events`;
}

/** When a cycle is planned: the month before its events, "planned in November". */
export function cyclePlannedIn(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `planned in ${format(new Date(Date.UTC(y, m - 2, 15)), "MMMM")}`;
}

/** First day of the month (Berlin) of an ISO timestamp, as "2026-11-01". */
export function monthOf(iso: string): string {
  return `${berlinDate(iso).slice(0, 7)}-01`;
}

/** The start of `month` ("2026-11-01") at 00:00 in Berlin, as ISO. */
export function monthStartIso(month: string): string {
  return berlinInputToIso(`${month}T00:00`);
}

/** The start of the month after `month`, at 00:00 in Berlin, as ISO. */
export function nextMonthStartIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return berlinInputToIso(`${ny}-${String(nm).padStart(2, "0")}-01T00:00`);
}

/** Days an event spans in Berlin, counting start and end day (weekend-trip food allowance). */
export function daysSpanned(startIso: string, endIso: string | null): number {
  if (!endIso) return 1;
  const a = Date.parse(`${berlinDate(startIso)}T00:00:00Z`);
  const b = Date.parse(`${berlinDate(endIso)}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Money: integer cents → "€ 12.50". */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "–";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}€ ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "12,50" / "12.5" / "€ 12" → 1250 cents; null if not a valid amount. */
export function parseEuroToCents(raw: string): number | null {
  const s = raw.replace(/€|eur/gi, "").replace(/\s+/g, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** The current time in milliseconds (a function, so server components can call it). */
export function nowMs(): number {
  return Date.now();
}

/** "Sat 31 Oct" – deadlines and dates in lists. */
export function formatShortDate(iso: string): string {
  return format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "EEE d MMM");
}

/** "due Sat 31 Oct, 23:59" or "was due …" once passed. */
export function formatDue(iso: string, now = Date.now()): string {
  const when = format(new TZDate(new Date(iso).getTime(), TIME_ZONE), "EEE d MMM, HH:mm");
  return Date.parse(iso) < now ? `was due ${when}` : `due ${when}`;
}
