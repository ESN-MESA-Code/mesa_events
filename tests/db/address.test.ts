// The event's address (user request 2026-10-29): the OC or the Events team
// saves country, street, postal code and city; the action checks them like
// the form, the database keeps the shapes; the ESN form data uses them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/planning";
import { loadEsn } from "@/lib/esn/load";

let id: string;
const munich = { country: "DE", street: "Trautenwolfstraße 6", postal_code: "80802", city: "München" };

beforeAll(async () => {
  id = (await createEvent({ title: "Address quiz", starts_at: hoursFromNow(72), oc: USERS.oc, helpers: [USERS.helper] })).id;
});
afterAll(async () => {
  await admin.from("events").delete().eq("id", id);
});

describe("the event's address", () => {
  it("the OC saves it; the helper cannot", async () => {
    expect(await P.updateEvent(await actionContext(USERS.helper), { id, location: "Shamrock", address: munich })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await P.updateEvent(await actionContext(USERS.oc), { id, location: "Shamrock", address: munich })).ok).toBe(true);
    const { data } = await admin.from("events").select("location, address_country, address_street, address_postal_code, address_city").eq("id", id).single();
    expect(data).toEqual({ location: "Shamrock", address_country: "DE", address_street: "Trautenwolfstraße 6", address_postal_code: "80802", address_city: "München" });
  });

  it("the action checks it like the form", async () => {
    const r = await P.updateEvent(await actionContext(USERS.oc), { id, address: { ...munich, postal_code: "8080", street: "Marienplatz", city: "Augsburg" } });
    expect(r).toMatchObject({ ok: false, error: "invalid_input" });
    expect(r.ok ? [] : r.issues).toEqual(
      expect.arrayContaining(["address.street: Add the house number (e.g. Trautenwolfstraße 6).", "address.postal_code: Not a postal code of Germany (e.g. 81671)."])
    );
    expect(await P.updateEvent(await actionContext(USERS.oc), { id, address: { ...munich, city: "Augsburg" } })).toMatchObject({ ok: false, issues: ["address.city: 80802 is München, not Augsburg."] });
  });

  it("the database keeps the shapes too (a direct update by the OC)", async () => {
    const oc = await as(USERS.oc);
    expect((await oc.from("events").update({ address_postal_code: "123" }).eq("id", id)).error?.message).toMatch(/events_address_de_postal_check/);
    expect((await oc.from("events").update({ address_street: "Marienplatz" }).eq("id", id)).error?.message).toMatch(/events_address_street_check/);
    expect((await oc.from("events").update({ address_country: "Germany" }).eq("id", id)).error?.message).toMatch(/events_address_country_check/);
  });

  it("the ESN form data uses it", async () => {
    const e = (await loadEsn(await as(USERS.comms), [id])).get(id)!;
    expect(e.data).toMatchObject({ country: "DE", street: "Trautenwolfstraße 6", postal: "80802", city: "München" });
  });
});
