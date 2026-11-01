// `npm run import:bot-archive -- <file> [<file> …] [--dry-run]` – imports past
// events from an export of the description bot's database Sheet (brief
// 2026-10-29, D), so the "Get inspired" search on /ideas knows what ran
// before the platform. No Google API calls: export the Sheet first (one CSV
// per semester tab – File → Download → CSV – or one JSON file, see
// docs/DECISIONS.md) and pass the files.
//
// The semester tabs (WiSe 26/27, SoSe 26 …) have one row per event with the
// columns of DB_COLUMNS in the bot's src/Database.gs; they are found by
// their header names, so the order does not matter:
//   Date · Time · Event · Venue · Price · Space · ✔ Approved · ⬆ Telegram ·
//   ⬆ pretix · ⬆ ESN · Telegram picture · Upload status · Description ·
//   pretix event · ESN Activities link · Chat markup · ESN form data ·
//   Published by · Last updated · Event ID
// The bot's _Registry tab works too (one row per description: eventId,
// eventTitle, status, published – the fields as JSON –, publishedBy,
// publishedAt, dbSheet …; round 2026-11-01): its published descriptions are
// taken as they are, drafts, removed rows and the Training sheet skipped.
// The same Event ID as in the semester tabs, so both can be imported.
//
// Each row becomes a history event: completed, no cycle, source =
// 'bot_archive' (archive_ref = the bot's Event ID, so a second run updates
// instead of duplicating), its published description (fields read back
// from the rendered text) and – when the bot had one – the event report
// from "ESN form data". History never takes part in planning, staffing,
// hand-in or reimbursements.
//
// Writes with the service role: the local stack by default, or the project
// in NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY when both are set.
// The pure parts are unit-tested (tests/unit/botArchive.test.ts).
import { readFileSync } from "node:fs";

export const ARCHIVE_SOURCE = "bot_archive";
export const ARCHIVE_ACTOR = "bot-archive@esnmesa.org";

// ── CSV ────────────────────────────────────────────────────────────────────

/** RFC 4180 CSV (quotes, doubled quotes, line breaks inside quotes) → rows of cells. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Header row + rows → objects keyed by the bot's column keys (unknown headers ignored). */
const HEADERS = {
  date: "Date",
  time: "Time",
  title: "Event",
  venue: "Venue",
  price: "Price",
  description: "Description",
  esnLink: "ESN Activities link",
  esnData: "ESN form data",
  publishedBy: "Published by",
  updated: "Last updated",
  eventId: "Event ID",
};

export function rowsToRecords(table) {
  const [header, ...rows] = table;
  if (!header) return [];
  if (header.includes("eventId") && header.includes("published")) return registryToRecords(table);
  const index = {};
  for (const [key, name] of Object.entries(HEADERS)) index[key] = header.findIndex((h) => h.trim() === name);
  if (index.date < 0 || index.title < 0) throw new Error(`Not a semester tab of the bot's Sheet: no "Date" and "Event" columns (found: ${header.join(", ")})`);
  return rows.map((r) => Object.fromEntries(Object.entries(index).map(([k, i]) => [k, i >= 0 ? String(r[i] ?? "").trim() : ""])));
}

/**
 * The _Registry tab → records carrying the published fields. Only
 * PUBLISHED rows of a semester sheet count; the others say why not.
 */
export function registryToRecords(table) {
  const [header, ...rows] = table;
  const col = (r, name) => String(r[header.indexOf(name)] ?? "").trim();
  return rows.map((r) => {
    const eventId = col(r, "eventId");
    const sheet = col(r, "dbSheet");
    let fields = null;
    try {
      fields = JSON.parse(col(r, "published") || "null");
    } catch {
      fields = null;
    }
    const title = String(fields?.title || col(r, "eventTitle"));
    const skip =
      col(r, "status") !== "PUBLISHED" || !fields
        ? `not published (${eventId})`
        : /^training$/i.test(sheet) || /^training/i.test(title)
          ? `training (${title})`
          : null;
    return {
      ...(skip ? { skip } : {}),
      eventId,
      title,
      date: String(fields?.dateIso ?? ""),
      time: String(fields?.time ?? ""),
      venue: String(fields?.venue ?? ""),
      price: String(fields?.price ?? ""),
      fields,
      publishedBy: col(r, "publishedBy"),
      publishedAt: col(r, "publishedAt"),
      esnData: "",
    };
  });
}

/** A file: a CSV of one tab, or JSON – { "<tab>": [[header…], [row…]] }, an array of such tables, or an array of records. */
export function recordsFromFile(name, text) {
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(text);
    const tables = Array.isArray(data) ? data : Object.values(data);
    return tables.flatMap((t) => (Array.isArray(t) && Array.isArray(t[0]) ? rowsToRecords(t.map((r) => r.map((c) => String(c ?? "")))) : [t]));
  }
  return rowsToRecords(parseCsv(text));
}

// ── One row → an event ─────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

/** "Mon, 02.11.2026" / "02.11.2026" / "2026-11-02" / "11/2/2026" → "2026-11-02" (null if none). */
export function parseSheetDate(raw) {
  const s = String(raw ?? "").trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}

/** "19:00", "19:00–22:00", "7 pm" → "19:00"; "TBA" or nothing → null. */
export function parseSheetTime(raw) {
  const s = String(raw ?? "").trim();
  let m = s.match(/(\d{1,2})[:.](\d{2})/);
  if (m) return `${pad(m[1])}:${m[2]}`;
  m = s.match(/(\d{1,2})\s*(am|pm)/i);
  if (m) return `${pad((Number(m[1]) % 12) + (m[2].toLowerCase() === "pm" ? 12 : 0))}:00`;
  return null;
}

/** "€ 12.50 (incl. drink)" → 1250; "FREE" → 0; "TBA" or unreadable → null. */
export function parseSheetPrice(raw) {
  const s = String(raw ?? "").trim();
  if (/^(free|gratis|kostenlos)/i.test(s)) return 0;
  const m = s.match(/(\d+)(?:[.,](\d{1,2}))?/);
  if (!m || /^tb[adc]/i.test(s)) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** A Berlin wall-clock time ("2026-11-02", "19:00") → ISO (UTC), without a time-zone library. */
export function berlinToIso(dateIso, time) {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (shown - guess)).toISOString();
}

/**
 * The bot's rendered description (the "Description" column, plain text) →
 * the template's fields: hook ("Are you ready for …? 🎉"), intro (the
 * paragraph after it), program and bring (the bullets under their
 * headings), closing ("We can't wait to … ✨").
 */
export function parseBotDescription(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim());
  const out = { hook: "", intro: "", program: "", bring: "", closing: "" };
  const bulletsAfter = (re) => {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) return "";
    const items = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j]) {
        if (items.length) break;
        continue;
      }
      if (!/^[•\-*▪◦·]/.test(lines[j])) break;
      items.push(lines[j].replace(/^[•\-*▪◦·]\s*/, ""));
    }
    return items.join("\n");
  };
  const hookAt = lines.findIndex((l) => /^are you ready for /i.test(l));
  if (hookAt >= 0) {
    out.hook = lines[hookAt].replace(/^are you ready for\s+/i, "").replace(/[\s?!.🎉]+$/u, "");
    const intro = [];
    for (let j = hookAt + 1; j < lines.length; j++) {
      if (!lines[j]) {
        if (intro.length) break;
        continue;
      }
      if (/^[🤔🎒⚠️]/u.test(lines[j]) || /WHAT DOES THE EVENT LOOK LIKE/i.test(lines[j])) break;
      intro.push(lines[j]);
    }
    out.intro = intro.join(" ");
  }
  out.program = bulletsAfter(/WHAT DOES THE EVENT LOOK LIKE/i);
  out.bring = bulletsAfter(/WHAT SHOULD I BRING/i);
  const closing = lines.find((l) => /^we can[’']?t wait to /i.test(l));
  if (closing) out.closing = closing.replace(/^we can[’']?t wait to\s+/i, "").replace(/[\s.✨]+$/u, "");
  return out;
}

/** ESN form data (JSON in the bot's column) → its report part, or null. */
export function reportFromEsnData(raw) {
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || !(Number(d.intl) > 0) || !String(d.positive ?? "").trim()) return null;
  return {
    intl_participants: Math.min(Number(d.intl) || 0, 99999),
    local_participants: Math.min(Number(d.local) || 0, 99999),
    organizers: Math.min(Number(d.coord) || 0, 99999),
    goals_reached: d.reached !== false,
    went_well: String(d.positive).trim().slice(0, 1000),
    could_be_better: String(d.improve ?? "").trim().slice(0, 1000),
    access_needs: !!d.accessNeeds,
    access_note: String(d.accessNote ?? "").trim().slice(0, 1000),
  };
}

/** ESN type and objectives from the form data ("9" = trip outside the city → day trip). */
function classification(raw) {
  try {
    const d = JSON.parse(raw);
    return { esnType: String((d.types ?? [])[0] ?? ""), esnObjectives: (d.objectives ?? []).join(",") };
  } catch {
    return { esnType: "", esnObjectives: "" };
  }
}

/**
 * One Sheet row → what to store, or { skip: reason }. Rows of events that
 * have not happened yet are skipped (they are no history).
 */
export function mapRecord(r, today) {
  if (r.skip) return { skip: r.skip };
  const dateIso = parseSheetDate(r.date);
  const title = String(r.title ?? "").replace(/\s+/g, " ").trim();
  if (!dateIso || !title) return { skip: `no date or title (${r.date || "?"} ${title || "?"})` };
  if (dateIso >= today) return { skip: `not past yet (${dateIso} ${title})` };
  const time = parseSheetTime(r.time);
  const startsAt = berlinToIso(dateIso, time ?? "12:00");
  const parsed = parseBotDescription(r.description);
  const cls = r.fields ? { esnType: String(r.fields.esnType ?? ""), esnObjectives: String(r.fields.esnObjectives ?? "") } : classification(r.esnData);
  const priceRaw = String(r.price ?? "").trim();
  const sheetFields = {
    title,
    dateIso,
    time: time ?? "TBA",
    venue: String(r.venue ?? "").trim(),
    price: priceRaw.replace(/\s*\(.*\)\s*$/, "").replace(/^€\s*/, "") || "TBA",
    priceNote: (priceRaw.match(/\((.*)\)\s*$/) ?? [])[1] ?? "",
    ...parsed,
    importantHeading: "",
    important: "",
    weather: false,
    ...cls,
  };
  // The registry has the fields themselves (its price without "€").
  const fields = r.fields ? { ...sheetFields, ...r.fields, title, dateIso, time: time ?? "TBA", weather: r.fields.weather === true, ...cls } : sheetFields;
  const ref = String(r.eventId ?? "").trim() || `${dateIso} ${title}`;
  return {
    ref,
    event: {
      title: title.slice(0, 200),
      type: /weekend/i.test(title) ? "weekend_trip" : cls.esnType === "9" ? "day_trip" : "standard",
      starts_at: startsAt,
      location: fields.venue.slice(0, 300) || null,
      price_cents: parseSheetPrice(priceRaw),
    },
    description: fields,
    publishedAt: /^\d{4}-\d{2}-\d{2}T/.test(r.publishedAt ?? "") ? r.publishedAt : parseSheetDate(r.updated) ? berlinToIso(parseSheetDate(r.updated), "12:00") : startsAt,
    publishedBy: String(r.publishedBy ?? "").trim() || null,
    report: reportFromEsnData(r.esnData),
    esnLink: /^https:\/\/activities\.esn\.org\/(activity\/[a-z0-9-]+|node\/\d+)\/?$/i.test(String(r.esnLink ?? "").trim()) ? String(r.esnLink).trim() : null,
  };
}

// ── Writing ────────────────────────────────────────────────────────────────

const check = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

/**
 * Imports the records with the service-role client `db`. Idempotent per
 * archive_ref: an event imported before is updated. `createdBy` tags the
 * rows (the demo seed and the tests use their own tags).
 */
export async function importArchive(db, records, { today, dryRun = false, createdBy = ARCHIVE_ACTOR } = {}) {
  const result = { imported: 0, updated: 0, skipped: [] };
  const day = today ?? new Date().toISOString().slice(0, 10);
  for (const r of records) {
    const m = mapRecord(r, day);
    if (m.skip) {
      result.skipped.push(m.skip);
      continue;
    }
    if (dryRun) {
      result.imported++;
      continue;
    }
    const existing = check(await db.from("events").select("id").eq("archive_ref", m.ref).maybeSingle(), "lookup");
    let id = existing?.id;
    if (id) {
      check(await db.from("events").update(m.event).eq("id", id), `update ${m.ref}`);
      result.updated++;
    } else {
      id = check(
        await db
          .from("events")
          .insert({ ...m.event, status: "completed", cycle_id: null, helpers_needed: 0, source: ARCHIVE_SOURCE, archive_ref: m.ref, created_by: createdBy })
          .select("id")
          .single(),
        `insert ${m.ref}`
      ).id;
      result.imported++;
    }
    check(
      await db.from("descriptions").upsert({
        event_id: id,
        status: "published",
        fields: m.description,
        approved_fields: m.description,
        published_at: m.publishedAt,
        published_by: m.publishedBy,
        updated_by: createdBy,
      }),
      `description ${m.ref}`
    );
    if (m.report) check(await db.from("event_reports").upsert({ event_id: id, ...m.report, created_by: createdBy, updated_by: createdBy }), `report ${m.ref}`);
    if (m.esnLink) check(await db.from("esn_uploads").upsert({ event_id: id, activity_url: m.esnLink, via: "manual", uploaded_by: createdBy }), `ESN link ${m.ref}`);
  }
  return result;
}

// Run directly (no import.meta and no top-level await: Playwright loads this
// file through its CommonJS transform, like clean-test-data.mjs).
if (/bot-archive\.mjs$/.test(process.argv[1] ?? "")) main();

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) {
    console.error("Usage: npm run import:bot-archive -- <tab.csv | sheet.json> [more files] [--dry-run]");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { LOCAL_ENV } = await import("./local-supabase.mjs");
  const remote = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = remote ? process.env.NEXT_PUBLIC_SUPABASE_URL : LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL;
  const key = remote ? process.env.SUPABASE_SERVICE_ROLE_KEY : LOCAL_ENV.SUPABASE_SERVICE_ROLE_KEY;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const records = files.flatMap((f) => recordsFromFile(f, readFileSync(f, "utf8")));
  importArchive(db, records, { dryRun: args.includes("--dry-run") })
    .then((r) => {
      console.log(`${args.includes("--dry-run") ? "Would import" : "Imported"} ${r.imported} events${r.updated ? `, updated ${r.updated}` : ""} into ${url}.`);
      if (r.skipped.length) console.log(`Skipped ${r.skipped.length}:\n  ${r.skipped.join("\n  ")}`);
    })
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
