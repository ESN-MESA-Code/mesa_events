// The event's address as ESN Activities wants it (user request 2026-10-29):
// postal code formats per country, the city from the postal code, the
// checks, the venue line, and the ESN form data built from it.
import { describe, expect, it } from "vitest";
import { DEFAULT_ADDRESS, cityForPostalCode, eventAddress, formatVenue, sameCity, validateAddress, type EventAddress } from "@/lib/address";
import { buildEsnFormData, MISSING } from "@/lib/esn/formData";
import { prefillFromEvent } from "@/lib/description/prefill";

const a = (x: Partial<EventAddress>): EventAddress => ({ ...DEFAULT_ADDRESS, street: "Trautenwolfstraße 6", postalCode: "80802", ...x });

describe("location finder", () => {
  it("starts in Germany, in München", () => {
    expect(DEFAULT_ADDRESS).toEqual({ country: "DE", street: "", postalCode: "", city: "München" });
  });

  it("knows the city of Munich's and nearby postal codes", () => {
    expect(cityForPostalCode("DE", "80331")).toBe("München");
    expect(cityForPostalCode("DE", "81929")).toBe("München");
    expect(cityForPostalCode("DE", "85748")).toBe("Garching bei München");
    expect(cityForPostalCode("DE", "86159")).toBe("Augsburg");
    expect(cityForPostalCode("DE", "10115")).toBeNull();
    expect(cityForPostalCode("DE", "8080")).toBeNull();
    expect(cityForPostalCode("AT", "5020")).toBeNull();
  });

  it("checks every field: house number, postal code format, the city of a known code", () => {
    expect(validateAddress(a({}))).toEqual({});
    expect(validateAddress(a({ city: "Munich" }))).toEqual({});
    expect(validateAddress({ ...DEFAULT_ADDRESS, city: "" })).toEqual({ street: "Enter the street and house number.", postalCode: "Enter the postal code.", city: "Enter the city." });
    expect(validateAddress(a({ street: "Marienplatz" })).street).toBe("Add the house number (e.g. Trautenwolfstraße 6).");
    expect(validateAddress(a({ postalCode: "8080" })).postalCode).toBe("Not a postal code of Germany (e.g. 81671).");
    expect(validateAddress(a({ postalCode: "00999" })).postalCode).toBe("German postal codes start at 01001.");
    expect(validateAddress(a({ city: "Augsburg" })).city).toBe("80802 is München, not Augsburg.");
    // An unknown but valid code keeps the city as typed.
    expect(validateAddress(a({ postalCode: "10115", city: "Berlin" }))).toEqual({});
    expect(validateAddress(a({ country: "AT", postalCode: "5020", city: "Salzburg", street: "Getreidegasse 9" }))).toEqual({});
    expect(validateAddress(a({ country: "AT", postalCode: "50200", city: "Salzburg" })).postalCode).toBe("Not a postal code of Austria (e.g. 5020).");
    expect(validateAddress(a({ country: "XX" })).country).toBe("Pick the country.");
  });

  it("München = Munich = Muenchen", () => {
    expect(sameCity("München", "Munich")).toBe(true);
    expect(sameCity("Muenchen", "München")).toBe(true);
    expect(sameCity("Garching", "Garching bei München")).toBe(true);
    expect(sameCity("Augsburg", "München")).toBe(false);
  });

  it("the venue line: the place and its address (the country when not Germany)", () => {
    expect(formatVenue("Shamrock", a({ city: "München" }))).toBe("Shamrock (Trautenwolfstraße 6, 80802 München)");
    expect(formatVenue("", a({}))).toBe("Trautenwolfstraße 6, 80802 München");
    expect(formatVenue("Mozart House", a({ country: "AT", street: "Getreidegasse 9", postalCode: "5020", city: "Salzburg" }))).toBe("Mozart House (Getreidegasse 9, 5020 Salzburg, Austria)");
    expect(formatVenue("Shamrock", { country: "DE", street: "", postalCode: "", city: "München" })).toBe("Shamrock");
  });
});

describe("where the address goes", () => {
  const event = { title: "Quiz", starts_at: "2026-11-05T18:00:00Z", ends_at: null, location: "Shamrock", price_cents: 500 };
  const columns = { address_country: "DE", address_street: "Trautenwolfstraße 6", address_postal_code: "80802", address_city: "München" };

  it("the description's venue is prefilled with it", () => {
    expect(prefillFromEvent({ ...event, ...columns }).venue).toBe("Shamrock (Trautenwolfstraße 6, 80802 München)");
    expect(prefillFromEvent({ ...event }).venue).toBe("Shamrock");
  });

  it("the ESN form takes the entered address before the venue text, with its country", () => {
    const d = buildEsnFormData({ eventId: "e", event, address: eventAddress(columns), published: null, classification: null, report: null });
    expect(d).toMatchObject({ country: "DE", street: "Trautenwolfstraße 6", postal: "80802", city: "München" });
    expect(d.missing).not.toContain(MISSING.address);
    const at = buildEsnFormData({ eventId: "e", event, address: eventAddress({ ...columns, address_country: "AT", address_street: "Getreidegasse 9", address_postal_code: "5020", address_city: "Salzburg" }), published: null, classification: null, report: null });
    expect(at).toMatchObject({ country: "AT", postal: "5020", city: "Salzburg" });
    expect(buildEsnFormData({ eventId: "e", event, address: eventAddress({}), published: null, classification: null, report: null }).missing).toContain(MISSING.address);
  });
});
