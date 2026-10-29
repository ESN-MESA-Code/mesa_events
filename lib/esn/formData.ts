// ESN Activities (activities.esn.org) – the data for "Register your physical
// activity", ported from the bot's "ESN form data" (esnFormData_ in
// src/Esn.gs). Pure and unit-tested (tests/unit/esn.test.ts); the browser
// script (tools/esn-activities/mesa-esn.user.js) fills the form with it.
//
//   while writing (description) – activity type + objectives
//   derived                     – title, dates, address (from the venue), goal,
//                                 description, audience, funding (from the
//                                 price), accessibility + sustainability ratings
//   after the event (report)    – participants, goals reached, what went
//                                 well / could be better, accessibility needs
// IDs are the form's option values (checked 09/2026, as in the bot).
import { esnObjectiveIds, esnType, formatPrice, isTbaPrice, normalizeHook, oneLine, paragraph, renderDescription, type DescriptionFields } from "@/lib/description/template";
import { berlinDate } from "@/lib/dates";
import { parseAddress } from "@/lib/esn/address";
import { hasAddress, type EventAddress } from "@/lib/address";

export const ESN_ADD_URL = "https://activities.esn.org/add/physical-activity";

/** Ratings per activity type: [noise, amount of people, accessibility of the location, terrain] / [zero waste, sustainable travel]; 0 = N/A, 1 = low, 2 = medium, 3 = high. */
export const ESN_RATINGS: Record<string, { access: [number, number, number, number]; sustain: [number, number] }> = {
  "10": { access: [2, 2, 2, 1], sustain: [1, 2] },
  "442": { access: [3, 3, 2, 1], sustain: [1, 2] },
  "441": { access: [2, 2, 2, 1], sustain: [2, 2] },
  "31": { access: [2, 2, 1, 2], sustain: [1, 2] },
  "438": { access: [1, 2, 2, 2], sustain: [1, 2] },
  "9": { access: [1, 2, 1, 3], sustain: [1, 2] },
  "13": { access: [1, 1, 2, 1], sustain: [1, 2] },
  "11": { access: [1, 2, 2, 1], sustain: [1, 2] },
  "439": { access: [1, 1, 2, 2], sustain: [2, 2] },
  "12": { access: [2, 3, 2, 1], sustain: [1, 2] },
  "440": { access: [2, 3, 2, 1], sustain: [1, 2] },
  "14": { access: [1, 1, 2, 2], sustain: [1, 2] },
};

export const ESN_IDS = {
  organiser: "160", // ESN MESA München
  mainOrganiser: "613", // "Our organisation is the Main Organiser"
  audience: ["431", "430"], // International Students, Volunteers
  fundingFee: "44",
  fundingOrganiser: "46",
} as const;

/** The report after the event (public.event_reports). */
export interface EventReport {
  intl_participants: number;
  local_participants: number;
  organizers: number;
  goals_reached: boolean;
  went_well: string;
  could_be_better: string;
  access_needs: boolean;
  access_note: string;
}

export interface EsnFormInput {
  eventId: string;
  /** The event as planned (fallbacks while there is no published description). */
  event: { title: string; starts_at: string; ends_at: string | null; location: string | null; price_cents: number | null };
  /** The event's address (country, street, postal code, city) – used before anything parsed from the venue text. */
  address?: EventAddress | null;
  /** The published description (what Comms approved), or null. */
  published: DescriptionFields | null;
  /** The current classification (type and objectives can change without a new publication). */
  classification: Pick<DescriptionFields, "esnType" | "esnObjectives"> | null;
  /** Registration link (pretix), when there is one. */
  link?: string;
  report: EventReport | null;
}

export interface EsnFormData {
  v: 1;
  event: string;
  title: string;
  start: string;
  end: string;
  country: string;
  street: string;
  postal: string;
  city: string;
  link: string;
  types: string[];
  objectives: string[];
  goal: string;
  description: string;
  audience: string[];
  funding: string[];
  fee: string;
  access: number[];
  sustain: number[];
  local: number;
  intl: number;
  coord: number;
  accessNeeds: boolean;
  accessNote: string;
  reached: boolean;
  positive: string;
  improve: string;
  /** What is still missing, in words (the script lists it; the Comms page shows it). */
  missing: string[];
}

/** Missing-field texts, also used to tell the report apart. */
export const MISSING = {
  published: "published description (Comms approves and publishes it first)",
  type: "activity type + objectives (Details step of the description)",
  address: "street address / postal code (the address on the event's Details: country, street, postal code, city)",
  report: "event report (participants, results) – Hand-in tab, after the event",
  price: "price (still TBA) – fee / funding",
} as const;

/** The goal: the hook and the first two sentences of the intro (at most 600 characters). */
export function esnGoal(d: Pick<DescriptionFields, "hook" | "intro">): string {
  const intro = paragraph(d.intro)
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(" ");
  const hook = normalizeHook(d.hook);
  return oneLine(hook ? `${hook.charAt(0).toUpperCase()}${hook.slice(1)}. ${intro}` : intro).slice(0, 600);
}

/** Everything the browser script needs to fill "Register your physical activity". */
export function buildEsnFormData(i: EsnFormInput): EsnFormData {
  const d = i.published;
  const cls = i.classification?.esnType ? i.classification : d;
  const type = esnType(cls?.esnType ?? "");
  const venue = d ? d.venue : (i.event.location ?? "");
  // The address entered on the event wins; else what the venue text says (the bot's way).
  const structured = hasAddress(i.address) ? i.address : null;
  const address = structured ? { street: structured.street.trim(), postal: structured.postalCode.trim(), city: structured.city.trim() } : parseAddress(venue);
  const priceRaw = d ? d.price : i.event.price_cents === null ? "TBA" : (i.event.price_cents / 100).toFixed(2);
  const price = formatPrice(priceRaw, d?.priceNote ?? "").value ?? "";
  const fee = (price.match(/€ (\d+\.\d{2})/) ?? [])[1] ?? "";
  const r = i.report;
  const ratings = type ? ESN_RATINGS[type.id] : null;

  const missing: string[] = [];
  if (!d) missing.push(MISSING.published);
  if (!type) missing.push(MISSING.type);
  if (!address.street || !address.postal) missing.push(MISSING.address);
  if (!r) missing.push(MISSING.report);
  if (isTbaPrice(priceRaw)) missing.push(MISSING.price);

  return {
    v: 1,
    event: i.eventId,
    title: oneLine(d?.title || i.event.title),
    start: berlinDate(i.event.starts_at),
    end: berlinDate(i.event.ends_at ?? i.event.starts_at),
    country: structured?.country ?? "DE",
    street: address.street,
    postal: address.postal,
    city: address.city || "München",
    link: i.link ?? "",
    types: type ? [type.id] : [],
    objectives: cls ? esnObjectiveIds(cls) : [],
    goal: d ? esnGoal(d) : "",
    description: d ? `<p>${renderDescription(d).html}</p>` : "",
    audience: [...ESN_IDS.audience],
    funding: [fee ? ESN_IDS.fundingFee : ESN_IDS.fundingOrganiser],
    fee,
    access: ratings ? [...ratings.access] : [2, 2, 2, 1],
    sustain: ratings ? [...ratings.sustain] : [1, 2],
    local: r ? r.local_participants : 0,
    intl: r ? r.intl_participants : 0,
    coord: r ? r.organizers : 0,
    accessNeeds: !!r?.access_needs,
    accessNote: r ? oneLine(r.access_note) : "",
    reached: r ? r.goals_reached : false,
    positive: r ? oneLine(r.went_well) : "",
    improve: r ? oneLine(r.could_be_better) : "",
    missing,
  };
}

/** Opens the ESN form for this event; the browser script reads #mesa=<event id>. */
export function esnUploadUrl(eventId: string): string {
  return `${ESN_ADD_URL}#mesa=${encodeURIComponent(eventId)}`;
}

/** A saved activity page: https://activities.esn.org/activity/<name>-<number> (or /node/<number>). */
export function isEsnActivityUrl(url: string): boolean {
  return /^https:\/\/activities\.esn\.org\/(activity\/[a-z0-9-]+|node\/\d+)\/?([?#].*)?$/i.test(String(url || "").trim());
}

export interface EsnUpload {
  activity_url: string;
  uploaded_at: string;
  uploaded_by: string;
  via: string;
}

export type EsnStatus =
  | { state: "not_ready"; missing: string[] }
  | { state: "ready" }
  | { state: "uploaded"; url: string; by: string; at: string; via: string };

/**
 * not ready (report or required fields missing, listed) → ready to upload →
 * uploaded (link, who, when). An uploaded event stays uploaded.
 */
export function esnStatus(data: Pick<EsnFormData, "missing">, upload: EsnUpload | null): EsnStatus {
  if (upload) return { state: "uploaded", url: upload.activity_url, by: upload.uploaded_by, at: upload.uploaded_at, via: upload.via };
  // A TBA price is a warning, not a blocker: the fee can be typed into the form.
  const blocking = data.missing.filter((m) => m !== MISSING.price);
  return blocking.length ? { state: "not_ready", missing: data.missing } : { state: "ready" };
}

export const ESN_STATUS_LABEL: Record<EsnStatus["state"], string> = {
  not_ready: "Not ready",
  ready: "Ready to upload",
  uploaded: "Uploaded",
};
