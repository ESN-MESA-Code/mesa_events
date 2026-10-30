// Address lookup (round 2026-10-30): Photon results as suggestions, the
// same-address rule for verification, the fake, and which lookup runs where.
import { describe, expect, it, vi } from "vitest";
import { FAKE_PLACES, fromPhoton, lookupMode, sameAddress, searchAddresses, verifyAddress } from "@/lib/geocode";

const shamrock = { properties: { name: "Shamrock Irish Pub", street: "Trautenwolfstraße", housenumber: "6", postcode: "80802", city: "München", countrycode: "DE" } };
const json = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("address lookup", () => {
  it("turns Photon results into suggestions (venue, street with number, postal code, city, country)", () => {
    expect(fromPhoton(shamrock)).toEqual({
      name: "Shamrock Irish Pub",
      street: "Trautenwolfstraße 6",
      postalCode: "80802",
      city: "München",
      country: "DE",
      label: "Shamrock Irish Pub, Trautenwolfstraße 6, 80802 München",
    });
    // A town instead of a city; a house named like its street has no venue name.
    expect(fromPhoton({ properties: { name: "Platzl", street: "Platzl", housenumber: "9", postcode: "80331", town: "München", countrycode: "de" } })).toMatchObject({ name: "", city: "München" });
    // No house number, or a country not offered: no suggestion.
    expect(fromPhoton({ properties: { street: "Marienplatz", postcode: "80331", city: "München", countrycode: "DE" } })).toBeNull();
    expect(fromPhoton({ properties: { ...shamrock.properties, countrycode: "US" } })).toBeNull();
  });

  it("compares addresses like a person would", () => {
    const s = { street: "Trautenwolfstraße 6", postalCode: "80802", city: "München" };
    expect(sameAddress({ street: "trautenwolfstr. 6", postalCode: "80802", city: "Munich" }, s)).toBe(true);
    expect(sameAddress({ street: "Trautenwolfstrasse 6", postalCode: "80802", city: "München" }, s)).toBe(true);
    expect(sameAddress({ street: "Trautenwolfstraße 8", postalCode: "80802", city: "München" }, s)).toBe(false);
  });

  it("asks Photon from the server and verifies against its answer", async () => {
    const env = { ADDRESS_LOOKUP: "photon", PHOTON_URL: "https://photon.example/" };
    const f = json({ features: [shamrock, shamrock, { properties: {} }] });
    expect(await searchAddresses("shamrock", env, f)).toHaveLength(1);
    expect(String((f as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toMatch(/^https:\/\/photon\.example\/api\/\?q=shamrock&/);
    expect(await verifyAddress({ country: "DE", street: "Trautenwolfstr. 6", postalCode: "80802", city: "München" }, env, f)).toBe("verified");
    expect(await verifyAddress({ country: "DE", street: "Trautenwolfstraße 99", postalCode: "80802", city: "München" }, env, f)).toBe("not_found");
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await verifyAddress({ country: "DE", street: "Trautenwolfstraße 6", postalCode: "80802", city: "München" }, env, down)).toBe("unavailable");
    expect(await searchAddresses("shamrock", env, down)).toEqual([]);
    expect(await searchAddresses("ab", env, f)).toEqual([]);
  });

  it("the fake knows its places and Munich-area postal codes", async () => {
    const env = { ADDRESS_LOOKUP: "fake" };
    expect((await searchAddresses("hofbräu", env)).map((s) => s.street)).toEqual(["Platzl 9"]);
    expect(await verifyAddress({ country: "DE", street: FAKE_PLACES[0].street, postalCode: FAKE_PLACES[0].postalCode, city: "München" }, env)).toBe("verified");
    expect(await verifyAddress({ country: "DE", street: "Leopoldstraße 13", postalCode: "80802", city: "München" }, env)).toBe("verified");
    expect(await verifyAddress({ country: "DE", street: "Hauptstraße 1", postalCode: "10115", city: "Berlin" }, env)).toBe("not_found");
  });

  it("uses the fake in tests and staging, Photon in production", () => {
    expect(lookupMode({ NODE_ENV: "test" })).toBe("fake");
    expect(lookupMode({ NODE_ENV: "production" })).toBe("photon");
    expect(lookupMode({ NODE_ENV: "production", ADDRESS_LOOKUP: "off" })).toBe("off");
    expect(lookupMode({ NODE_ENV: "production", APP_ENV: "staging", ADDRESS_LOOKUP: "photon" })).toBe("fake");
  });
});
