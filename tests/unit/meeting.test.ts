// The meeting point (round 2026-11-02): the event's columns as one value,
// the lines for the post, Home and the event page, the mismatch check of the
// description, and the form's draft → updateEvent's input.
import { describe, expect, it } from "vitest";
import { addressStarted, clockOf, draftPlace, eventMeeting, meetingDraft, meetingInput, meetingLine, meetingPlace, meetingShort, placeMismatch } from "@/lib/meeting";
import { prefillFromEvent } from "@/lib/description/prefill";
import { DEFAULT_ADDRESS } from "@/lib/address";

const hbf = { country: "DE", street: "Bayerstraße 10a", postalCode: "80335", city: "München" };
const columns = { meeting_point: "München Hauptbahnhof", meeting_country: "DE", meeting_street: "Bayerstraße 10a", meeting_postal_code: "80335", meeting_city: "München", meeting_time: "08:15:00" };

describe("the event's meeting point", () => {
  it("is null when people meet at the location", () => {
    expect(eventMeeting({})).toBeNull();
    expect(eventMeeting({ meeting_point: "  ", meeting_country: "DE", meeting_time: null })).toBeNull();
    expect(meetingLine(null)).toBe("");
    expect(meetingShort(null)).toBe("");
  });

  it("reads the columns", () => {
    expect(eventMeeting(columns)).toEqual({ point: "München Hauptbahnhof", address: hbf, time: "08:15" });
    expect(eventMeeting({ meeting_point: "Isartor" })).toEqual({ point: "Isartor", address: null, time: "" });
    // An address without a name is a meeting point too.
    expect(eventMeeting({ ...columns, meeting_point: null })).toMatchObject({ point: "", address: hbf });
    expect(clockOf("07:05:00")).toBe("07:05");
    expect(clockOf(null)).toBe("");
  });

  it("the lines: the post's place, with the time, and the short one for lists", () => {
    const m = eventMeeting(columns);
    expect(meetingPlace(m)).toBe("München Hauptbahnhof (Bayerstraße 10a, 80335 München)");
    expect(meetingLine(m)).toBe("München Hauptbahnhof (Bayerstraße 10a, 80335 München) at 08:15");
    expect(meetingShort(m)).toBe("Meet 08:15 at München Hauptbahnhof");
    expect(meetingShort(eventMeeting({ meeting_point: "Isartor" }))).toBe("Meet at Isartor");
    expect(meetingShort(eventMeeting({ ...columns, meeting_point: null }))).toBe("Meet 08:15 at Bayerstraße 10a");
  });

  it("a new description starts with it", () => {
    const ev = { title: "Hike", starts_at: "2026-12-05T08:00:00Z", location: "Tegernsee", price_cents: 2500 };
    expect(prefillFromEvent({ ...ev, ...columns })).toMatchObject({ venue: "Tegernsee", meeting: "München Hauptbahnhof (Bayerstraße 10a, 80335 München)", meetingTime: "08:15", time: "09:00" });
    expect(prefillFromEvent(ev)).toMatchObject({ meeting: "", meetingTime: "" });
  });
});

describe("the description's mismatch check", () => {
  const fields = { venue: "Tegernsee", meeting: "München Hauptbahnhof" };

  it("a meeting point that is not the location is not a mismatch", () => {
    expect(placeMismatch({ venue: "Tegernsee", meeting: "München Hauptbahnhof" }, fields)).toEqual({ venue: false, meeting: false });
    // A post that names the meeting point as its place (written before there was a meeting line).
    expect(placeMismatch({ venue: "München Hauptbahnhof", meeting: "" }, fields)).toEqual({ venue: false, meeting: true });
  });

  it("each line is compared with its own fields", () => {
    expect(placeMismatch({ venue: "Schliersee", meeting: "München Hauptbahnhof" }, fields)).toEqual({ venue: true, meeting: false });
    expect(placeMismatch({ venue: "Tegernsee", meeting: "Ostbahnhof" }, fields)).toEqual({ venue: false, meeting: true });
    // No meeting point in the fields: the post's meeting line is not checked; the venue as before.
    expect(placeMismatch({ venue: "Tegernsee ", meeting: "Ostbahnhof" }, { venue: "Tegernsee", meeting: "" })).toEqual({ venue: false, meeting: false });
    expect(placeMismatch({ venue: "", meeting: "" }, { venue: "Tegernsee", meeting: "" })).toEqual({ venue: true, meeting: false });
    expect(placeMismatch({ venue: "anything", meeting: "" }, { venue: "", meeting: "" })).toEqual({ venue: false, meeting: false });
  });
});

describe("the form's draft", () => {
  it("nothing entered: they meet at the location", () => {
    expect(meetingInput(meetingDraft(null))).toEqual({ value: null });
    expect(meetingDraft(null)).toEqual({ point: "", address: DEFAULT_ADDRESS, time: "" });
    expect(addressStarted(DEFAULT_ADDRESS)).toBe(false);
  });

  it("a name alone, or with a complete address and a time", () => {
    expect(meetingInput({ point: " Isartor ", address: DEFAULT_ADDRESS, time: "" })).toEqual({ value: { point: "Isartor", address: null, time: null } });
    expect(meetingInput({ point: "München Hauptbahnhof", address: hbf, time: "08:15" })).toEqual({
      value: { point: "München Hauptbahnhof", address: { country: "DE", street: "Bayerstraße 10a", postal_code: "80335", city: "München" }, time: "08:15" },
    });
  });

  it("refuses a started address that is not complete, and a time without a place", () => {
    expect(meetingInput({ point: "Hbf", address: { ...hbf, postalCode: "" }, time: "" })).toEqual({ error: "Please check the meeting point's address." });
    expect(meetingInput({ point: "", address: DEFAULT_ADDRESS, time: "08:00" })).toEqual({ error: "Name the meeting point for the meeting time – or clear the time." });
  });

  it("the post's line takes the address only once it is complete", () => {
    expect(draftPlace({ point: "Hbf", address: { ...hbf, street: "" }, time: "" })).toBe("Hbf");
    expect(draftPlace({ point: "Hbf", address: hbf, time: "08:15" })).toBe("Hbf (Bayerstraße 10a, 80335 München)");
  });
});
