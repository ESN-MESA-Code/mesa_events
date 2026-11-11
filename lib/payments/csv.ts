// CSV reading for the payment imports (round 2026-11-11): PayPal and pretix
// exports in English or German, comma, semicolon or tab separated, with a
// byte order mark or without. Pure (tests/unit/payments.test.ts).

/** Splits CSV text into rows of cells (quotes, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** The separator of the header line: the most frequent of , ; and tab outside quotes. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in counts) counts[c]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ",";
}

/** Header name for matching: lower case, no quotes, single spaces. */
export const normHeader = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

/** The index of the first column whose header is one of `aliases` (normalised), or -1. */
export function column(headers: string[], aliases: readonly string[]): number {
  const norm = headers.map(normHeader);
  for (const a of aliases) {
    const i = norm.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * An amount as exports write it → cents: "1.234,56", "1,234.56", "-12,50",
 * "12.50", "€ 5", "(3.00)". Null when it is not a number.
 */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.replace(/[€$£\s ]|EUR/gi, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let whole: string;
  let frac = "";
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? "," : ".";
    const [w, f] = [s.slice(0, s.lastIndexOf(dec)), s.slice(s.lastIndexOf(dec) + 1)];
    whole = w.replace(/[.,']/g, "");
    frac = f;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    // One separator with one or two digits after it: decimals. Otherwise thousands.
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      whole = parts[0];
      frac = parts[1];
    } else whole = parts.join("");
  } else whole = s;
  whole = whole.replace(/'/g, "");
  if (!/^\d*$/.test(whole) || !/^\d{0,2}$/.test(frac) || (whole === "" && frac === "")) return null;
  const cents = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export type DateOrder = "dmy" | "mdy";

/** "11.11.2026", "11/11/2026", "2026-11-11", "11-11-2026" → "2026-11-11"; null when it is not a date. */
export function parseDate(raw: string | undefined, order: DateOrder = "dmy"): string | null {
  const s = (raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoDay(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return isoDay(year(m[3]), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) return order === "mdy" ? isoDay(year(m[3]), +m[1], +m[2]) : isoDay(year(m[3]), +m[2], +m[1]);
  return null;
}

const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

function isoDay(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Whether slashed dates are day/month or month/day: the first value above 12
 * decides (13/02 is a day first, 02/13 a month first); the fallback when no
 * date says (German and UK exports write the day first).
 */
export function detectDateOrder(values: string[], fallback: DateOrder = "dmy"): DateOrder {
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) return "dmy";
    if (+m[2] > 12) return "mdy";
  }
  return fallback;
}

/** "14:05:33" / "2:05 PM" → "14:05"; "00:00" when there is none. */
export function parseTime(raw: string | undefined): string {
  const m = (raw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (!m) return "00:00";
  let h = Number(m[1]);
  if (m[3]) {
    const pm = m[3].toLowerCase() === "pm";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return `${String(Math.min(h, 23)).padStart(2, "0")}:${m[2]}`;
}

/** A CSV cell: quoted when needed. */
export function csvCell(v: string | number | null | undefined, sep = ";"): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r") ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV with a byte order mark (Excel opens umlauts right) and CRLF line ends. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>, sep = ";"): string {
  return "﻿" + rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join("\r\n") + "\r\n";
}

/** Cents as a German decimal for spreadsheets: 1234 → "12,34", -5 → "-0,05". */
export function centsDe(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
