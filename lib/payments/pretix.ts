// pretix orders (round 2026-11-11): from the "Order data" export (CSV, any
// language pretix offers in English or German) or from the REST API. An
// order belongs to an event through the pretix event slug – the part of
// the pretix link Comms pastes for every event. Pure
// (tests/unit/payments.test.ts).
import { column, detectDateOrder, parseAmount, parseCsv, parseDate } from "./csv";

export type PretixStatus = "paid" | "pending" | "canceled" | "expired";

export interface PretixOrder {
  /** The pretix event slug ("kayaking26"). */
  slug: string;
  /** Order code ("ABC12"). */
  code: string;
  status: PretixStatus;
  email: string;
  name: string;
  total: number;
  fees: number;
  tickets: number;
  /** Payment provider ("paypal", "banktransfer", "stripe" …), "" when unknown. */
  provider: string;
  /** "2026-11-11" */
  orderedOn: string | null;
  paidOn: string | null;
}

/**
 * The slug of a pretix event link: the second part of the path
 * (pretix.eu/<organizer>/<event>/) or the only one (an organizer's own
 * domain). Mirrors private.pretix_slug_of() in the database.
 */
export function pretixSlugOf(link: string | null | undefined): string | null {
  if (!link || !/^https?:\/\//i.test(link)) return null;
  const path = link.replace(/^https?:\/\/[^/]*/i, "").split("?")[0].split("#")[0];
  const parts = path.split("/").filter(Boolean);
  const slug = parts.length >= 2 ? parts[1] : parts.length === 1 ? parts[0] : null;
  return slug && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(slug) ? slug : null;
}

/** "Paid" / "bezahlt" / "p" → "paid" … null when unknown. */
export function pretixStatus(raw: string): PretixStatus | null {
  const s = raw.trim().toLowerCase();
  if (/^(p|paid|bezahlt)$/.test(s)) return "paid";
  if (/^(n|pending|ausstehend|offen|unpaid|unbezahlt)$/.test(s)) return "pending";
  if (/^(c|canceled|cancelled|storniert|abgesagt|refunded|erstattet)$/.test(s)) return "canceled";
  if (/^(e|expired|abgelaufen|verfallen)$/.test(s)) return "expired";
  return null;
}

const H = {
  slug: ["event slug", "event short form", "veranstaltungs-kurzform", "kurzform der veranstaltung", "event-kurzform", "slug"],
  code: ["order code", "bestellnummer", "bestellcode", "order"],
  total: ["order total", "total", "bestellsumme", "gesamtsumme", "summe"],
  status: ["status", "bestellstatus", "order status"],
  email: ["email", "e-mail", "e-mail-adresse"],
  name: ["name", "invoice address name", "rechnungsadresse name", "rechnungsadresse: name"],
  ordered: ["order date", "bestelldatum", "datum"],
  paid: ["date of last payment", "payment date", "datum der letzten zahlung", "zahlungsdatum"],
  provider: ["payment providers", "payment provider", "payment method", "payment type", "zahlungsanbieter", "zahlungsart", "zahlungsmethode"],
  fees: ["fees", "gebühren"],
  tickets: ["positions", "number of positions", "positionen", "tickets"],
} as const;

export interface PretixParse {
  orders: PretixOrder[];
  skipped: Array<{ line: number; reason: string }>;
  /** Whether the file names each order's event (an export of the organizer, not of one event). */
  hasSlug: boolean;
  missing: string[];
}

/** Parses pretix's "Order data" CSV. Without an event column, every order gets `slug` (the event chosen on upload). */
export function parsePretixCsv(text: string, slug?: string): PretixParse {
  const table = parseCsv(text);
  const headerAt = table.findIndex((r) => column(r, H.code) >= 0 && column(r, H.total) >= 0);
  const header = headerAt >= 0 ? table[headerAt] : (table[0] ?? []);
  const col = Object.fromEntries(Object.entries(H).map(([k, aliases]) => [k, column(header, aliases)])) as Record<keyof typeof H, number>;
  const missing = (["code", "total", "status"] as const).filter((k) => col[k] < 0).map((k) => H[k][0]);
  const hasSlug = col.slug >= 0;
  if (missing.length) return { orders: [], skipped: [], hasSlug, missing };
  const body = table.slice(headerAt + 1);
  const cell = (r: string[], k: keyof typeof H) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");
  const order = detectDateOrder(body.flatMap((r) => [cell(r, "ordered"), cell(r, "paid")]));
  const orders: PretixOrder[] = [];
  const skipped: PretixParse["skipped"] = [];
  body.forEach((r, i) => {
    const line = headerAt + i + 2;
    const code = cell(r, "code");
    const total = parseAmount(cell(r, "total"));
    const status = pretixStatus(cell(r, "status"));
    const eventSlug = hasSlug ? cell(r, "slug") : (slug ?? "");
    if (!/^[A-Za-z0-9]{1,30}$/.test(code)) return skipped.push({ line, reason: `no order code (“${code}”)` });
    if (total === null || total < 0) return skipped.push({ line, reason: `no total (“${cell(r, "total")}”)` });
    if (!status) return skipped.push({ line, reason: `status “${cell(r, "status")}”` });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(eventSlug)) return skipped.push({ line, reason: hasSlug ? `event “${eventSlug}”` : "no event chosen" });
    const tickets = Number.parseInt(cell(r, "tickets"), 10);
    orders.push({
      slug: eventSlug,
      code: code.toUpperCase(),
      status,
      email: cell(r, "email").slice(0, 200),
      name: cell(r, "name").slice(0, 200),
      total,
      fees: parseAmount(cell(r, "fees")) ?? 0,
      tickets: Number.isFinite(tickets) && tickets >= 0 ? Math.min(tickets, 10_000) : 1,
      provider: normaliseProvider(cell(r, "provider")),
      orderedOn: parseDate(cell(r, "ordered"), order),
      paidOn: parseDate(cell(r, "paid"), order),
    });
  });
  return { orders, skipped, hasSlug, missing };
}

/** "PayPal" / "paypal, banktransfer" / "Überweisung" → a short provider key. */
export function normaliseProvider(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (s.includes("paypal")) return "paypal";
  if (/bank|überweisung|ueberweisung|transfer/.test(s)) return "banktransfer";
  if (/stripe|card|karte|kredit/.test(s)) return "stripe";
  if (/free|kostenlos|gratis/.test(s)) return "free";
  if (/manual|manuell|box|cash|bar|kasse/.test(s)) return "manual";
  return s.slice(0, 60);
}

// ── REST API ───────────────────────────────────────────────────────────────

/** The fields of a pretix API order this import reads (GET /api/v1/organizers/{o}/events/{e}/orders/). */
export interface PretixApiOrder {
  code: string;
  status: string;
  email?: string | null;
  datetime?: string | null;
  total: string;
  invoice_address?: { name?: string | null } | null;
  fees?: Array<{ value: string }> | null;
  positions?: unknown[] | null;
  payments?: Array<{ provider: string; state: string; payment_date?: string | null; amount: string }> | null;
}

/** An API order as an imported order. */
export function fromApiOrder(slug: string, o: PretixApiOrder): PretixOrder | null {
  const status = pretixStatus(o.status);
  const total = parseAmount(o.total);
  if (!status || total === null || !/^[A-Za-z0-9]{1,30}$/.test(o.code)) return null;
  const confirmed = (o.payments ?? []).filter((p) => p.state === "confirmed" || p.state === "refunded");
  const last = confirmed[confirmed.length - 1] ?? (o.payments ?? [])[0];
  return {
    slug,
    code: o.code.toUpperCase(),
    status,
    email: (o.email ?? "").slice(0, 200),
    name: (o.invoice_address?.name ?? "").slice(0, 200),
    total,
    fees: (o.fees ?? []).reduce((s, f) => s + (parseAmount(f.value) ?? 0), 0),
    tickets: o.positions?.length ?? 1,
    provider: normaliseProvider(last?.provider ?? ""),
    orderedOn: o.datetime ? o.datetime.slice(0, 10) : null,
    paidOn: last?.payment_date ? last.payment_date.slice(0, 10) : null,
  };
}

export interface PretixApiConfig {
  /** "https://pretix.eu" */
  url: string;
  organizer: string;
  token: string;
}

/** The API's settings from the environment, or null when not set up. */
export function pretixApiConfig(env: Record<string, string | undefined> = process.env): PretixApiConfig | null {
  const organizer = env.PRETIX_ORGANIZER?.trim();
  const token = env.PRETIX_API_TOKEN?.trim();
  if (!organizer || !token) return null;
  return { url: (env.PRETIX_URL?.trim() || "https://pretix.eu").replace(/\/+$/, ""), organizer, token };
}

/** Every order of one pretix event, page by page. */
export async function fetchPretixOrders(cfg: PretixApiConfig, slug: string, fetchFn: typeof fetch = fetch): Promise<PretixOrder[]> {
  let next: string | null = `${cfg.url}/api/v1/organizers/${encodeURIComponent(cfg.organizer)}/events/${encodeURIComponent(slug)}/orders/`;
  const out: PretixOrder[] = [];
  for (let page = 0; next && page < 200; page++) {
    const res: Response = await fetchFn(next, { headers: { Authorization: `Token ${cfg.token}`, Accept: "application/json" }, cache: "no-store" });
    if (res.status === 404) throw new Error(`pretix does not know the event “${slug}” (organizer ${cfg.organizer}).`);
    if (res.status === 401 || res.status === 403) throw new Error("pretix refused the API token – check PRETIX_API_TOKEN and its team's permissions (orders: view).");
    if (!res.ok) throw new Error(`pretix answered ${res.status} for “${slug}”.`);
    const body = (await res.json()) as { next: string | null; results: PretixApiOrder[] };
    for (const o of body.results ?? []) {
      const order = fromApiOrder(slug, o);
      if (order) out.push(order);
    }
    // Only follow pages on the same host (the token goes along).
    next = body.next && body.next.startsWith(cfg.url) ? body.next : null;
  }
  return out;
}
