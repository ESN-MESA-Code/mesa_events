// The meeting point (round 2026-11-02): where people meet when it is not the
// location. The OC or the Events team saves it (place, optional address,
// time); the database keeps the shapes; clearing the name in the schedule
// clears it all; the calendar feed says where and when to meet.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, daysFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/planning";
import * as F from "@/lib/actions/calendar";
import { parseFeedSegment, renderFeed } from "@/lib/calendarFeed";
import { eventMeeting, meetingLine } from "@/lib/meeting";

let id: string;
const hbf = { country: "DE", street: "Bayerstraße 10a", postal_code: "80335", city: "München" };
const columns = "location, meeting_point, meeting_country, meeting_street, meeting_postal_code, meeting_city, meeting_time";

beforeAll(async () => {
  id = (await createEvent({ title: "Meeting point hike", starts_at: daysFromNow(10), oc: USERS.oc, helpers: [USERS.helper] })).id;
  await admin.from("events").update({ location: "Tegernsee" }).eq("id", id);
});
afterAll(async () => {
  await admin.from("calendar_feeds").delete().eq("profile_id", USERS.helper.id);
  await admin.from("events").delete().eq("id", id);
});

describe("the meeting point", () => {
  it("the OC saves it next to the location; the helper cannot", async () => {
    const meeting = { point: "München Hauptbahnhof", address: hbf, time: "08:15" };
    expect(await P.updateEvent(await actionContext(USERS.helper), { id, meeting })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await P.updateEvent(await actionContext(USERS.oc), { id, meeting })).ok).toBe(true);
    const { data } = await admin.from("events").select(columns).eq("id", id).single();
    expect(data).toEqual({
      location: "Tegernsee",
      meeting_point: "München Hauptbahnhof",
      meeting_country: "DE",
      meeting_street: "Bayerstraße 10a",
      meeting_postal_code: "80335",
      meeting_city: "München",
      meeting_time: "08:15:00",
    });
    expect(meetingLine(eventMeeting(data!))).toBe("München Hauptbahnhof (Bayerstraße 10a, 80335 München) at 08:15");
  });

  it("the action checks it: an address like the location's, a time only with a place", async () => {
    const oc = await actionContext(USERS.oc);
    const bad = await P.updateEvent(oc, { id, meeting: { point: "Hbf", address: { ...hbf, postal_code: "8033" }, time: null } });
    expect(bad.ok ? [] : bad.issues).toEqual(["meeting.address.postal_code: Not a postal code of Germany (e.g. 81671)."]);
    expect(await P.updateEvent(oc, { id, meeting: { point: "", address: null, time: "08:00" } })).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await P.updateEvent(oc, { id, meeting: { point: "Hbf", address: null, time: "8 Uhr" } })).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await P.updateEvent(oc, { id, meeting: { point: "Hbf", address: hbf, time: "07:45" } })).toMatchObject({ ok: true });
  });

  it("the database keeps the shapes too (a direct update by the OC)", async () => {
    const oc = await as(USERS.oc);
    expect((await oc.from("events").update({ meeting_postal_code: "123" }).eq("id", id)).error?.message).toMatch(/events_meeting_de_postal_check/);
    expect((await oc.from("events").update({ meeting_street: "Bahnhof" }).eq("id", id)).error?.message).toMatch(/events_meeting_street_check/);
    expect((await oc.from("events").update({ meeting_point: null, meeting_street: null, meeting_postal_code: null, meeting_city: null }).eq("id", id)).error?.message).toMatch(
      /events_meeting_needs_place_check/
    );
    expect((await oc.from("events").update({ meeting_time: "08:15:30" }).eq("id", id)).error?.message).toMatch(/events_meeting_time_check/);
  });

  it("the calendar feed says where and when to meet; the location stays the place of the event", async () => {
    const url = (await F.createCalendarFeed(await actionContext(USERS.helper), {})) as { ok: true; data: { url: string } };
    const ics = (await renderFeed(admin, parseFeedSegment(url.data.url.split("/").at(-1)!)!))!;
    const unfolded = ics.replace(/\r\n /g, "");
    const entry = unfolded.slice(unfolded.indexOf(`UID:event-${id}@mesa`));
    expect(entry.slice(0, entry.indexOf("END:VEVENT"))).toMatch(/LOCATION:Tegernsee\r\n/);
    expect(entry.slice(0, entry.indexOf("END:VEVENT"))).toContain("DESCRIPTION:Meeting point: Hbf\\, Bayerstraße 10a\\, 80335 München at 07:45\\nYou are a helper.");
  });

  it("clearing the name in the schedule clears it all: they meet at the location", async () => {
    const events = await actionContext(USERS.events);
    expect((await P.updateEvent(events, { id, meeting_point: "Hauptbahnhof, Gleis 26" })).ok).toBe(true);
    expect((await admin.from("events").select("meeting_point, meeting_street, meeting_time").eq("id", id).single()).data).toEqual({
      meeting_point: "Hauptbahnhof, Gleis 26",
      meeting_street: "Bayerstraße 10a",
      meeting_time: "07:45:00",
    });
    expect((await P.updateEvent(events, { id, meeting_point: "" })).ok).toBe(true);
    const { data } = await admin.from("events").select(columns).eq("id", id).single();
    expect(eventMeeting(data!)).toBeNull();
    expect(data).toMatchObject({ location: "Tegernsee", meeting_point: null, meeting_street: null, meeting_time: null });
  });

  it("null clears it from the details form", async () => {
    const oc = await actionContext(USERS.oc);
    expect((await P.updateEvent(oc, { id, meeting: { point: "Isartor", address: null, time: "09:00" } })).ok).toBe(true);
    expect((await P.updateEvent(oc, { id, meeting: null })).ok).toBe(true);
    expect((await admin.from("events").select("meeting_point, meeting_time").eq("id", id).single()).data).toEqual({ meeting_point: null, meeting_time: null });
  });
});
