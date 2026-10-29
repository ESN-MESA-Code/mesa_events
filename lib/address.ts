// The event's address, as ESN Activities asks for it (country, street
// address, postal code, city): a small "location finder" that checks the
// postal code's format per country and fills in the city from the postal
// code. The lookup is offline (no external API): every Munich code
// (80331–81929) and the towns around Munich and in Bavaria that MESA's
// events go to; other valid codes keep the city as typed. Pure
// (tests/unit/address.test.ts).

export interface EventAddress {
  /** ISO 3166-1 alpha-2, e.g. "DE". */
  country: string;
  street: string;
  postalCode: string;
  city: string;
}

export const DEFAULT_ADDRESS: EventAddress = { country: "DE", street: "", postalCode: "", city: "München" };

/** The countries offered (Germany first), with their postal code format. */
export const COUNTRIES: Array<{ code: string; name: string; postal: RegExp; example: string }> = [
  { code: "DE", name: "Germany", postal: /^\d{5}$/, example: "81671" },
  { code: "AT", name: "Austria", postal: /^\d{4}$/, example: "5020" },
  { code: "CH", name: "Switzerland", postal: /^\d{4}$/, example: "8001" },
  { code: "IT", name: "Italy", postal: /^\d{5}$/, example: "39100" },
  { code: "CZ", name: "Czechia", postal: /^\d{3} ?\d{2}$/, example: "110 00" },
  { code: "FR", name: "France", postal: /^\d{5}$/, example: "75001" },
  { code: "NL", name: "Netherlands", postal: /^\d{4} ?[A-Z]{2}$/i, example: "1012 AB" },
  { code: "BE", name: "Belgium", postal: /^\d{4}$/, example: "1000" },
  { code: "PL", name: "Poland", postal: /^\d{2}-\d{3}$/, example: "00-001" },
  { code: "HU", name: "Hungary", postal: /^\d{4}$/, example: "1051" },
  { code: "SI", name: "Slovenia", postal: /^\d{4}$/, example: "1000" },
  { code: "HR", name: "Croatia", postal: /^\d{5}$/, example: "10000" },
  { code: "ES", name: "Spain", postal: /^\d{5}$/, example: "28001" },
  { code: "DK", name: "Denmark", postal: /^\d{4}$/, example: "1050" },
];

export const countryName = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

/** German postal code ranges → town (inclusive). */
const DE_RANGES: Array<[number, number, string]> = [
  [80331, 81929, "München"],
  [83022, 83026, "Rosenheim"],
  [85049, 85057, "Ingolstadt"],
  [85354, 85356, "Freising"],
  [86150, 86199, "Augsburg"],
  [90402, 90491, "Nürnberg"],
  [93047, 93059, "Regensburg"],
];

/** Single German postal codes → town (around Munich and the usual trips). */
const DE_CODES: Record<string, string> = {
  "82008": "Unterhaching",
  "82024": "Taufkirchen",
  "82031": "Grünwald",
  "82041": "Oberhaching",
  "82049": "Pullach im Isartal",
  "82110": "Germering",
  "82131": "Gauting",
  "82152": "Planegg",
  "82166": "Gräfelfing",
  "82205": "Gilching",
  "82256": "Fürstenfeldbruck",
  "82319": "Starnberg",
  "82362": "Weilheim in Oberbayern",
  "82418": "Murnau am Staffelsee",
  "82431": "Kochel am See",
  "82432": "Kochel am See",
  "82467": "Garmisch-Partenkirchen",
  "83684": "Tegernsee",
  "83700": "Rottach-Egern",
  "83727": "Schliersee",
  "85221": "Dachau",
  "85435": "Erding",
  "85521": "Ottobrunn",
  "85540": "Haar",
  "85579": "Neubiberg",
  "85609": "Aschheim",
  "85622": "Feldkirchen",
  "85716": "Unterschleißheim",
  "85737": "Ismaning",
  "85748": "Garching bei München",
  "85764": "Oberschleißheim",
  "85774": "Unterföhring",
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");
/** "München" = "Munich" = "Muenchen". */
const SAME_CITY: Record<string, string[]> = { muenchen: ["munich", "monaco"], nuernberg: ["nuremberg"] };
export function sameCity(a: string, b: string): boolean {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  return Object.entries(SAME_CITY).some(([k, alts]) => [k, ...alts].includes(x) && [k, ...alts].includes(y));
}

/** The town of a postal code, when the platform knows it; null otherwise. */
export function cityForPostalCode(country: string, postalCode: string): string | null {
  const code = postalCode.trim();
  if (country !== "DE" || !/^\d{5}$/.test(code)) return null;
  if (DE_CODES[code]) return DE_CODES[code];
  const n = Number(code);
  return DE_RANGES.find(([from, to]) => n >= from && n <= to)?.[2] ?? null;
}

export type AddressErrors = Partial<Record<keyof EventAddress, string>>;

/** What is wrong with the address, per field (empty: all fine). */
export function validateAddress(a: EventAddress): AddressErrors {
  const e: AddressErrors = {};
  const country = COUNTRIES.find((c) => c.code === a.country);
  if (!country) e.country = "Pick the country.";
  const street = a.street.trim();
  if (!street) e.street = "Enter the street and house number.";
  else if (!/\d/.test(street)) e.street = "Add the house number (e.g. Trautenwolfstraße 6).";
  const code = a.postalCode.trim();
  if (!code) e.postalCode = "Enter the postal code.";
  else if (country && !country.postal.test(code)) e.postalCode = `Not a postal code of ${country.name} (e.g. ${country.example}).`;
  else if (a.country === "DE" && Number(code) < 1001) e.postalCode = "German postal codes start at 01001.";
  const city = a.city.trim();
  const known = cityForPostalCode(a.country, code);
  if (!city) e.city = "Enter the city.";
  else if (known && !sameCity(city, known)) e.city = `${code} is ${known}, not ${city}.`;
  return e;
}

export const hasAddress = (a: Partial<EventAddress> | null | undefined): a is EventAddress => !!a?.street?.trim() && !!a.postalCode?.trim();

/** "Shamrock (Trautenwolfstraße 6, 80802 München)" – the venue line of the description and the ESN form's address in one. */
export function formatVenue(name: string | null | undefined, a: Partial<EventAddress> | null | undefined): string {
  const place = (name ?? "").trim();
  if (!hasAddress(a)) return place;
  const line = `${a.street.trim()}, ${a.postalCode.trim()} ${a.city.trim()}${a.country && a.country !== "DE" ? `, ${countryName(a.country)}` : ""}`;
  return place ? `${place} (${line})` : line;
}

/** The address columns of an event row (events.address_*). */
export function eventAddress(e: { address_country?: string | null; address_street?: string | null; address_postal_code?: string | null; address_city?: string | null }): EventAddress {
  return { country: e.address_country || "DE", street: e.address_street ?? "", postalCode: e.address_postal_code ?? "", city: e.address_city ?? "" };
}
