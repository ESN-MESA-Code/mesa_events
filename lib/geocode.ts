// Address lookup and verification (round 2026-10-30), like a delivery
// form: members type a place or address and pick a suggestion, which fills
// in venue name, street, postal code, city and country; a saved address is
// checked against the lookup. The lookup is Photon (OpenStreetMap data,
// photon.komoot.io or a self-hosted instance – PHOTON_URL), always called
// from the server (members' IP addresses stay with us). ADDRESS_LOOKUP:
// "photon" | "fake" | "off"; tests, E2E and staging use the fake, dev:local
// and production Photon. The Photon mapping is pure (tests/unit/geocode.test.ts).
import { COUNTRIES, cityForPostalCode, sameCity, type EventAddress } from "@/lib/address";
import { isStagingBuild } from "@/lib/staging";

export interface AddressSuggestion {
  /** The place's name (venue), "" for a plain address. */
  name: string;
  street: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** One line for the list. */
  label: string;
}

export type LookupMode = "photon" | "fake" | "off";
export type Verification = "verified" | "not_found" | "unavailable";

export function lookupMode(env: Record<string, string | undefined> = process.env): LookupMode {
  // Staging never calls out (its fakes are enforced), whatever the variable says.
  if (env.APP_ENV === "staging" || isStagingBuild()) return "fake";
  const m = env.ADDRESS_LOOKUP;
  if (m === "photon" || m === "fake" || m === "off") return m;
  return env.NODE_ENV === "production" ? "photon" : "fake";
}

const SUPPORTED = new Set(COUNTRIES.map((c) => c.code));

interface PhotonFeature {
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    district?: string;
    countrycode?: string;
    type?: string;
    osm_key?: string;
  };
}

/** A Photon feature → a suggestion; null without street, house number or postal code, or outside the countries offered. */
export function fromPhoton(f: PhotonFeature): AddressSuggestion | null {
  const p = f.properties ?? {};
  const country = (p.countrycode ?? "").toUpperCase();
  const city = p.city ?? p.town ?? p.village ?? "";
  if (!p.street || !p.housenumber || !p.postcode || !city || !SUPPORTED.has(country)) return null;
  const street = `${p.street} ${p.housenumber}`;
  // A house's name is its address, not a venue.
  const name = p.name && p.name !== street && p.name !== p.street ? p.name : "";
  return { name, street, postalCode: p.postcode, city, country, label: [name, street, `${p.postcode} ${city}`].filter(Boolean).join(", ") };
}

/** Same address: street (case, "Str." / "Straße", spaces), postal code and city. */
export function sameAddress(a: Pick<EventAddress, "street" | "postalCode" | "city">, s: Pick<AddressSuggestion, "street" | "postalCode" | "city">): boolean {
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/str\.?(\s|$)/g, "straße$1")
      .replace(/strasse/g, "straße")
      .replace(/[\s.,-]+/g, "");
  return norm(a.street) === norm(s.street) && a.postalCode.replace(/\s/g, "") === s.postalCode.replace(/\s/g, "") && sameCity(a.city, s.city);
}

// ── The fake (tests, E2E, staging, dev without network) ──────────────────────
export const FAKE_PLACES: AddressSuggestion[] = [
  ["Shamrock Irish Pub", "Trautenwolfstraße 6", "80802", "München"],
  ["LMU Main Building", "Geschwister-Scholl-Platz 1", "80539", "München"],
  ["TUM Main Campus", "Arcisstraße 21", "80333", "München"],
  ["Hofbräuhaus", "Platzl 9", "80331", "München"],
  ["Deutsches Museum", "Museumsinsel 1", "80538", "München"],
  ["Olympiastadion", "Spiridon-Louis-Ring 21", "80809", "München"],
  ["Augustiner-Keller", "Arnulfstraße 52", "80335", "München"],
  ["Pinakothek der Moderne", "Barer Straße 40", "80333", "München"],
  ["Bavaria Filmstadt", "Bavariafilmplatz 7", "82031", "Grünwald"],
  ["Schloss Neuschwanstein", "Neuschwansteinstraße 20", "87645", "Schwangau"],
  // Meeting points and the trips' places (round 2026-11-02).
  ["München Hauptbahnhof", "Bayerstraße 10a", "80335", "München"],
  ["Bahnhof Tegernsee", "Bahnhofplatz 1", "83684", "Tegernsee"],
  ["", "Marienplatz 8", "80331", "München"],
].map(([name, street, postalCode, city]) => ({ name, street, postalCode, city, country: "DE", label: [name, street, `${postalCode} ${city}`].filter(Boolean).join(", ") }));

function fakeSearch(q: string): AddressSuggestion[] {
  const terms = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return FAKE_PLACES.filter((p) => terms.every((t) => p.label.toLowerCase().includes(t))).slice(0, 5);
}

// ── The lookup ──────────────────────────────────────────────────────────────
type Fetch = typeof fetch;

/** Suggestions for what the member typed (at most 5; [] when the lookup is off or fails). */
export async function searchAddresses(q: string, env: Record<string, string | undefined> = process.env, fetchFn: Fetch = fetch): Promise<AddressSuggestion[]> {
  const query = q.trim().slice(0, 120);
  if (query.length < 3) return [];
  const mode = lookupMode(env);
  if (mode === "off") return [];
  if (mode === "fake") return fakeSearch(query);
  const base = (env.PHOTON_URL || "https://photon.komoot.io").replace(/\/+$/, "");
  // Biased towards Munich, where most events are; local names ("München"), as addresses are written.
  const url = `${base}/api/?q=${encodeURIComponent(query)}&limit=10&lang=de&lat=48.137&lon=11.575`;
  try {
    const res = await fetchFn(url, { headers: { "User-Agent": "MESA-Events (events.esnmesa.org)" }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { features?: PhotonFeature[] };
    const out: AddressSuggestion[] = [];
    for (const f of body.features ?? []) {
      const hit = fromPhoton(f);
      if (hit && !out.some((o) => o.label === hit.label)) out.push(hit);
    }
    return out.slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Whether the address exists: a lookup result with the same street, postal
 * code and city. The fake knows its places and, like the offline check,
 * Munich-area postal codes with their town. "unavailable" when the lookup
 * cannot answer (off, down) – saving then relies on the form checks.
 */
export async function verifyAddress(a: EventAddress, env: Record<string, string | undefined> = process.env, fetchFn: Fetch = fetch): Promise<Verification> {
  const mode = lookupMode(env);
  if (mode === "off") return "unavailable";
  if (mode === "fake") {
    if (FAKE_PLACES.some((p) => sameAddress(a, p))) return "verified";
    const known = cityForPostalCode(a.country, a.postalCode);
    return known && sameCity(known, a.city) && /\d/.test(a.street) ? "verified" : "not_found";
  }
  const base = (env.PHOTON_URL || "https://photon.komoot.io").replace(/\/+$/, "");
  const url = `${base}/api/?q=${encodeURIComponent(`${a.street}, ${a.postalCode} ${a.city}`)}&limit=10&lang=de`;
  try {
    const res = await fetchFn(url, { headers: { "User-Agent": "MESA-Events (events.esnmesa.org)" }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { features?: PhotonFeature[] };
    const found = (body.features ?? []).map(fromPhoton).some((s) => s && s.country === a.country && sameAddress(a, s));
    return found ? "verified" : "not_found";
  } catch {
    return "unavailable";
  }
}
