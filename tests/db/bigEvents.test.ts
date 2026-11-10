// Big events (round 2026-11-10): "big" is the Events team's mark, not the
// event's type. A new event is big when it is a special event or a weekend
// trip; the Events team changes it, the OC cannot; a changed type takes the
// mark along only while nobody decided otherwise.
import { afterAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, daysFromNow } from "../helpers/local";

const events: string[] = [];
afterAll(async () => {
  await admin.from("events").delete().in("id", events);
});

async function event(type: "standard" | "special" | "day_trip" | "weekend_trip") {
  const e = await createEvent({ type, oc: USERS.oc, starts_at: daysFromNow(30) });
  events.push(e.id);
  return e;
}
const bigOf = async (id: string) => (await admin.from("events").select("big").eq("id", id).single()).data?.big;

describe("big events", () => {
  it("special events and weekend trips start as big, the others not", async () => {
    expect((await event("special")).big).toBe(true);
    expect((await event("weekend_trip")).big).toBe(true);
    expect((await event("day_trip")).big).toBe(false);
    expect((await event("standard")).big).toBe(false);
  });

  it("the Events team marks an event big; the OC and Comms cannot", async () => {
    const e = await event("day_trip");
    await (await as(USERS.oc)).from("events").update({ big: true }).eq("id", e.id);
    await (await as(USERS.comms)).from("events").update({ big: true }).eq("id", e.id);
    expect(await bigOf(e.id)).toBe(false);
    // The OC's own details still save.
    expect((await (await as(USERS.oc)).from("events").update({ location: "Somewhere else" }).eq("id", e.id)).error).toBeNull();
    expect((await (await as(USERS.events)).from("events").update({ big: true }).eq("id", e.id)).error).toBeNull();
    expect(await bigOf(e.id)).toBe(true);
    // Never empty.
    expect((await admin.from("events").update({ big: null }).eq("id", e.id)).error?.code).toBe("23514");
  });

  it("a changed type takes the mark along until the Events team decided otherwise", async () => {
    const team = await as(USERS.events);
    const follows = await event("standard");
    expect((await team.from("events").update({ type: "weekend_trip" }).eq("id", follows.id)).error).toBeNull();
    expect(await bigOf(follows.id)).toBe(true);
    expect((await team.from("events").update({ type: "standard" }).eq("id", follows.id)).error).toBeNull();
    expect(await bigOf(follows.id)).toBe(false);

    // Marked by hand: a standard event that is big stays big, whatever its type becomes.
    const marked = await event("standard");
    expect((await team.from("events").update({ big: true }).eq("id", marked.id)).error).toBeNull();
    expect((await team.from("events").update({ type: "day_trip" }).eq("id", marked.id)).error).toBeNull();
    expect(await bigOf(marked.id)).toBe(true);
    // …and a weekend trip they said is not big stays that way as a special event.
    const small = await event("weekend_trip");
    expect((await team.from("events").update({ big: false }).eq("id", small.id)).error).toBeNull();
    expect((await team.from("events").update({ type: "special" }).eq("id", small.id)).error).toBeNull();
    expect(await bigOf(small.id)).toBe(false);
  });
});
