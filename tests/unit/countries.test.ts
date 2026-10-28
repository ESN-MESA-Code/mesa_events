import { describe, expect, it } from "vitest";
import { countryName, isCountryCode, matchCountry, searchCountries } from "@/lib/countries";

describe("isCountryCode", () => {
  it("knows ISO alpha-2 codes only", () => {
    expect(isCountryCode("DE")).toBe(true);
    expect(isCountryCode("de")).toBe(false);
    expect(isCountryCode("Germany")).toBe(false);
    expect(isCountryCode("XX")).toBe(false);
  });
});

describe("countryName", () => {
  it("prints names in English unless asked for German", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("DE", "de")).toBe("Deutschland");
    expect(countryName("DE", "en")).toBe("Germany");
    expect(countryName("IT", "de")).toBe("Italien");
  });

  it("prefers plain names over official forms", () => {
    expect(countryName("TW", "en")).not.toMatch(/[,(]/);
  });

  it("falls back to the code for unknown codes", () => {
    expect(countryName("XX", "en")).toBe("XX");
  });
});

describe("matchCountry", () => {
  it("matches English and German names and aliases, ignoring case and accents", () => {
    expect(matchCountry("germany")).toBe("DE");
    expect(matchCountry("Deutschland")).toBe("DE");
    expect(matchCountry("turkiye")).toBe("TR");
    expect(matchCountry("  Spain ")).toBe("ES");
  });

  it("returns null for nothing or nonsense", () => {
    expect(matchCountry("")).toBeNull();
    expect(matchCountry("Atlantis")).toBeNull();
  });
});

describe("searchCountries", () => {
  it("puts names starting with the query first", () => {
    expect(searchCountries("ger")[0].code).toBe("DE");
    expect(searchCountries("ital")[0].code).toBe("IT");
  });

  it("finds German names too", () => {
    expect(searchCountries("Spanien").map((c) => c.code)).toContain("ES");
  });

  it("limits the results", () => {
    expect(searchCountries("a", 5)).toHaveLength(5);
  });
});
