import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import de from "i18n-iso-countries/langs/de.json";

// Nationalities are stored as ISO 3166-1 alpha-2 codes ("DE") and turned
// into names only for display (English; German names help the search). Names come
// from the i18n-iso-countries package – there is no list to maintain here.
countries.registerLocale(en);
countries.registerLocale(de);

type Lang = "en" | "de";

/** Lower-case and strip accents, so "turkiye" matches "Türkiye". */
const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

// Prefer a plain name over official forms like "Taiwan, Province of China".
const plainName = (names: string[]) => names.find((n) => !/[,(]/.test(n)) ?? names[0];

const allNames = (code: string, lang: Lang): string[] =>
  [countries.getName(code, lang, { select: "all" }) ?? []].flat();

interface Country {
  code: string;
  /** English name shown in the attendance form */
  name: string;
  /** Every English and German name and abbreviation, normalised for search */
  terms: string[];
}

const COUNTRY_INDEX: Country[] = Object.keys(countries.getAlpha2Codes())
  .map((code) => ({
    code,
    name: plainName(allNames(code, "en")),
    terms: [...allNames(code, "en"), ...allNames(code, "de")].map(normalize),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

export function isCountryCode(value: string): boolean {
  return COUNTRY_INDEX.some((c) => c.code === value);
}

/** Country name for a code in the given language ("DE" → "Deutschland"). */
export function countryName(code: string, lang: Lang = "en"): string {
  const names = allNames(code, lang);
  return names.length ? plainName(names) : code;
}

/** Code for a typed name or alias ("germany", "Deutschland", "UK"), or null. */
export function matchCountry(input: string): string | null {
  const needle = normalize(input);
  if (!needle) return null;
  return COUNTRY_INDEX.find((c) => c.terms.includes(needle))?.code ?? null;
}

/**
 * Countries matching a search, best first: names starting with the query,
 * then other names or abbreviations starting with it, then names containing it.
 */
export function searchCountries(query: string, limit = 8): { code: string; name: string }[] {
  const needle = normalize(query);
  if (!needle) return COUNTRY_INDEX;
  const starts = COUNTRY_INDEX.filter((c) => normalize(c.name).startsWith(needle));
  const aliasStarts = COUNTRY_INDEX.filter((c) => c.terms.some((t) => t.startsWith(needle)));
  const contains = COUNTRY_INDEX.filter((c) => c.terms.some((t) => t.includes(needle)));
  return [...new Set([...starts, ...aliasStarts, ...contains])].slice(0, limit);
}
