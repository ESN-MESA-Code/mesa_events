// The calendar subscription (round 2026-10-30): a member's events as
// iCalendar (RFC 5545) for Google Calendar, Apple Calendar or Outlook.
// Times in UTC, lines folded at 75 octets, CRLF line ends. Pure
// (tests/unit/internal.test.ts).

export interface IcalItem {
  /** Stable across updates ("event-<id>@mesa"). */
  uid: string;
  title: string;
  /** ISO timestamps. */
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  description: string | null;
  /** The page in the platform (absolute URL). */
  url: string | null;
  cancelled: boolean;
  updatedAt: string;
  /** What kind of entry ("ESN event", "Office hour" …). */
  category: string;
}

/** Events without an end last two hours in the calendar. */
const DEFAULT_LENGTH_MS = 2 * 3_600_000;

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets (UTF-8), never inside a character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    // Continuation lines start with a space, which counts towards their 75.
    if (octets + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** ISO → "20261105T180000Z". */
export function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The whole calendar. `now` stamps DTSTAMP. */
export function buildCalendar(items: IcalItem[], opts: { name: string; now: Date }): string {
  const stamp = icsDate(opts.now.toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ESN MESA//Events Platform//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    // Ask calendar apps to refresh hourly (most poll less often anyway).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const item of items) {
    const end = item.endsAt && Date.parse(item.endsAt) > Date.parse(item.startsAt) ? item.endsAt : new Date(Date.parse(item.startsAt) + DEFAULT_LENGTH_MS).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.uid}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${icsDate(item.updatedAt)}`,
      `DTSTART:${icsDate(item.startsAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(item.cancelled ? `Cancelled: ${item.title}` : item.title)}`,
      `CATEGORIES:${icsEscape(item.category)}`,
      `STATUS:${item.cancelled ? "CANCELLED" : "CONFIRMED"}`
    );
    if (item.location) lines.push(`LOCATION:${icsEscape(item.location)}`);
    const description = [item.description, item.url].filter(Boolean).join("\n\n");
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    if (item.url) lines.push(`URL:${item.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
