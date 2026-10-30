// Internal events, meetings and office hours, cash boxes, the ledger and the
// calendar feed (round 2026-10-30). The RLS matrix covers the tables row by
// row (rls-specs.ts); this file covers the rules and flows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TAG, USERS, admin, anonClient, as, createEvent, daysFromNow, hoursFromNow, type SeedUser } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as I from "@/lib/actions/internal";
import * as C from "@/lib/actions/cash";
import * as L from "@/lib/actions/ledger";
import * as F from "@/lib/actions/calendar";
import { isoToBerlinInput } from "@/lib/dates";
import { parseFeedSegment, renderFeed } from "@/lib/calendarFeed";

const internalIds: string[] = [];
let eventId: string;

async function internal(kind: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("internal_events")
    .insert({ kind: kind as never, title: `Test ${kind}`, starts_at: daysFromNow(5), created_by: TEST_TAG, ...extra })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  internalIds.push(data.id);
  return data.id as string;
}
const staff = (id: string, user: SeedUser, role: "oc" | "helper" | "attendee") => admin.from("internal_event_people").insert({ internal_event_id: id, profile_id: user.id, role });
const ok = <T,>(r: { ok: true; data: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.data;
};

beforeAll(async () => {
  eventId = (await createEvent({ title: "Cash box test event", starts_at: hoursFromNow(-2), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 })).id;
});
afterAll(async () => {
  await admin.from("finance_entries").delete().or(`event_id.eq.${eventId},created_by.eq.${TEST_TAG}`);
  if (internalIds.length) await admin.from("finance_entries").delete().in("internal_event_id", internalIds);
  await admin.from("cash_reports").delete().eq("event_id", eventId);
  if (internalIds.length) {
    await admin.from("cash_reports").delete().in("internal_event_id", internalIds);
    await admin.from("internal_events").delete().in("id", internalIds);
  }
  await admin.from("events").delete().eq("id", eventId);
  await admin.from("calendar_feeds").delete().in("profile_id", [USERS.member.id, USERS.executive.id, USERS.newcomer.id]);
  await admin.from("app_settings").delete().in("key", ["esncard_price_internal_cents", "esncard_price_external_cents"]);
});

describe("planning internal events", () => {
  it("HR and the Vice President plan; members, Events and executives cannot", async () => {
    const start = isoToBerlinInput(daysFromNow(7));
    for (const user of [USERS.hr, USERS.vp]) {
      const r = ok(await I.createInternalEvent(await actionContext(user), { kind: "stammtisch", starts_at: start }));
      internalIds.push(r.id);
      const { data } = await admin.from("internal_events").select("title, helpers_needed").eq("id", r.id).single();
      expect(data).toEqual({ title: "Stammtisch", helpers_needed: 1 });
    }
    for (const user of [USERS.member, USERS.events, USERS.executive, USERS.admin]) {
      expect(await I.createInternalEvent(await actionContext(user), { kind: "internal", starts_at: start }), user.email).toMatchObject({ ok: false, error: "forbidden" });
      const { error } = await (await as(user)).from("internal_events").insert({ kind: "internal", title: "Forged", starts_at: daysFromNow(7) });
      expect(error, user.email).not.toBeNull();
    }
  });

  it("Repeat creates one series; deleting from a date on removes the rest", async () => {
    const r = ok(await I.createInternalSeries(await actionContext(USERS.hr), { kind: "tuesday_talk", title: "Tuesday Talk", days: ["2041-03-05", "2041-03-19", "2041-03-12"], start: "19:00", minutes: 60, presentation_url: "https://slides.example/x" }));
    expect(r.created).toBe(3);
    const { data } = await admin.from("internal_events").select("id, starts_at, ends_at, presentation_url").eq("series_id", r.series_id).order("starts_at");
    internalIds.push(...data!.map((d) => d.id));
    expect(data!.map((d) => d.starts_at.slice(0, 16))).toEqual(["2041-03-05T18:00", "2041-03-12T18:00", "2041-03-19T18:00"]);
    expect(Date.parse(data![0].ends_at!) - Date.parse(data![0].starts_at)).toBe(3_600_000);
    expect(ok(await I.deleteInternalEvent(await actionContext(USERS.hr), { id: data![1].id, following: true })).deleted).toBe(2);
    expect((await admin.from("internal_events").select("id").eq("series_id", r.series_id)).data).toHaveLength(1);
  });

  it("rejects links that are not https and keeps the kind", async () => {
    expect(await I.createInternalEvent(await actionContext(USERS.hr), { kind: "board_meeting", starts_at: isoToBerlinInput(daysFromNow(3)), presentation_url: "javascript:alert(1)" })).toMatchObject({ ok: false, error: "invalid_input" });
    const id = await internal("stammtisch");
    const { error } = await (await as(USERS.hr)).from("internal_events").update({ kind: "internal" }).eq("id", id);
    expect(error?.message).toMatch(/kind/);
  });

  it("only staffed kinds get an OC and helpers; one OC each", async () => {
    const talk = await internal("tuesday_talk");
    expect(await I.assignInternal(await actionContext(USERS.hr), { internal_event_id: talk, profile_id: USERS.member.id, role: "oc" })).toMatchObject({ ok: false });
    const office = await internal("office_hour");
    ok(await I.assignInternal(await actionContext(USERS.hr), { internal_event_id: office, profile_id: USERS.oc.id, role: "oc" }));
    expect(await I.assignInternal(await actionContext(USERS.vp), { internal_event_id: office, profile_id: USERS.helper.id, role: "oc" })).toMatchObject({ ok: false, message: /OC already/ });
    ok(await I.assignInternal(await actionContext(USERS.vp), { internal_event_id: office, profile_id: USERS.helper.id, role: "helper" }));
    expect(await I.assignInternal(await actionContext(USERS.member), { internal_event_id: office, profile_id: USERS.member.id, role: "helper" })).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("who sees what", () => {
  it("board meetings: executives and planners only, also their people", async () => {
    const board = await internal("board_meeting");
    await staff(board, USERS.executive, "attendee").then(() => undefined, () => undefined);
    for (const [user, sees] of [
      [USERS.executive, true],
      [USERS.hr, true],
      [USERS.vp, true],
      [USERS.member, false],
      [USERS.events, false],
      [USERS.finance, false],
      [USERS.admin, false],
      [USERS.newcomer, false],
    ] as const) {
      const { data } = await (await as(user)).from("internal_events").select("id").eq("id", board);
      expect(data?.length ?? 0, user.email).toBe(sees ? 1 : 0);
    }
    expect((await anonClient().from("internal_events").select("id").eq("id", board)).data ?? []).toEqual([]);
    const talk = await internal("tuesday_talk");
    expect((await (await as(USERS.member)).from("internal_events").select("id").eq("id", talk)).data).toHaveLength(1);
  });
});

describe("signing up to internal events", () => {
  it("members sign up within the capacity and withdraw before it starts", async () => {
    const id = await internal("internal", { capacity: 1 });
    ok(await I.signUpInternal(await actionContext(USERS.member), { internal_event_id: id }));
    expect(await I.signUpInternal(await actionContext(USERS.member), { internal_event_id: id })).toMatchObject({ ok: false, message: /already/ });
    expect(await I.signUpInternal(await actionContext(USERS.volunteer1), { internal_event_id: id })).toMatchObject({ ok: false, message: /full/ });
    ok(await I.withdrawInternal(await actionContext(USERS.member), { internal_event_id: id }));
    ok(await I.signUpInternal(await actionContext(USERS.volunteer1), { internal_event_id: id }));
    // Straight to the table: refused.
    const { error } = await (await as(USERS.member)).from("internal_event_people").insert({ internal_event_id: id, profile_id: USERS.member.id, role: "attendee" });
    expect(error).not.toBeNull();
  });

  it("not to other kinds, past or cancelled dates, or hidden board meetings", async () => {
    const talk = await internal("tuesday_talk");
    expect(await I.signUpInternal(await actionContext(USERS.member), { internal_event_id: talk })).toMatchObject({ ok: false });
    const past = await internal("internal", { starts_at: hoursFromNow(-1) });
    expect(await I.signUpInternal(await actionContext(USERS.member), { internal_event_id: past })).toMatchObject({ ok: false, message: /not open/ });
    const cancelled = await internal("internal", { status: "cancelled" });
    expect(await I.signUpInternal(await actionContext(USERS.member), { internal_event_id: cancelled })).toMatchObject({ ok: false, message: /not open/ });
    const board = await internal("board_meeting");
    expect(await I.signUpInternal(await actionContext(USERS.member), { internal_event_id: board })).toMatchObject({ ok: false, message: /Not found/ });
  });
});

describe("the office hour's cash box", () => {
  let office: string;
  let report: string;
  beforeAll(async () => {
    office = await internal("office_hour", { starts_at: hoursFromNow(-1) });
    await staff(office, USERS.oc, "oc");
    await staff(office, USERS.helper, "helper");
    ok(await C.setEsncardPrices(await actionContext(USERS.finance), { internal_cents: 500, external_cents: 1500 }));
  });

  it("only the OC and helpers start and count it", async () => {
    expect(await C.startCashBox(await actionContext(USERS.member), { internal_event_id: office })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await C.startCashBox(await actionContext(USERS.finance), { internal_event_id: office })).toMatchObject({ ok: false, error: "forbidden" });
    report = ok(await C.startCashBox(await actionContext(USERS.helper), { internal_event_id: office })).report_id;
    expect(ok(await C.startCashBox(await actionContext(USERS.oc), { internal_event_id: office })).report_id).toBe(report);
    const { data } = await admin.from("cash_reports").select("card_price_internal_cents, card_price_external_cents").eq("id", report).single();
    expect(data).toEqual({ card_price_internal_cents: 500, card_price_external_cents: 1500 });
  });

  it("counts notes and coins, refuses anything else", async () => {
    expect(ok(await C.saveCashCount(await actionContext(USERS.helper), { report_id: report, phase: "opening", counts: { "2000": 2, "500": 2, "200": 0 } })).total_cents).toBe(5000);
    expect(await C.saveCashCount(await actionContext(USERS.helper), { report_id: report, phase: "opening", counts: { "300": 1 } })).toMatchObject({ ok: false, error: "invalid_input" });
    const { error } = await (await as(USERS.helper)).rpc("save_cash_count", { report, phase: "opening", counts: { "300": 1 } });
    expect(error?.message).toMatch(/euro note or coin/);
    const { data } = await admin.from("cash_reports").select("opening_counts, opening_cents, opening_counted_by").eq("id", report).single();
    expect(data).toEqual({ opening_counts: { "2000": 2, "500": 2 }, opening_cents: 5000, opening_counted_by: USERS.helper.email });
    expect(await C.saveCashCount(await actionContext(USERS.member), { report_id: report, phase: "closing", counts: { "100": 1 } })).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("ESNcards up and down, never below zero, only at office hours", async () => {
    const helper = await actionContext(USERS.helper);
    const oc = await actionContext(USERS.oc);
    await Promise.all([C.bumpEsncards(helper, { report_id: report, card: "internal", delta: 1 }), C.bumpEsncards(oc, { report_id: report, card: "internal", delta: 1 }), C.bumpEsncards(oc, { report_id: report, card: "external", delta: 1 })]);
    expect(ok(await C.bumpEsncards(helper, { report_id: report, card: "external", delta: 1 }))).toEqual({ internal: 2, external: 2 });
    expect(ok(await C.bumpEsncards(helper, { report_id: report, card: "external", delta: -5 }))).toEqual({ internal: 2, external: 0 });
    ok(await C.bumpEsncards(helper, { report_id: report, card: "external", delta: 1 }));
    expect(await C.bumpEsncards(await actionContext(USERS.member), { report_id: report, card: "internal", delta: 1 })).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("the OC signs off once both counts are in; then it is fixed until Finance reopens it", async () => {
    expect(await C.closeCashBox(await actionContext(USERS.oc), { report_id: report })).toMatchObject({ ok: false, message: /before and after/ });
    ok(await C.saveCashCount(await actionContext(USERS.oc), { report_id: report, phase: "closing", counts: { "5000": 1, "1000": 1, "500": 1, "100": 5 } }));
    expect(await C.closeCashBox(await actionContext(USERS.helper), { report_id: report })).toMatchObject({ ok: false, message: /Only the OC/ });
    ok(await C.closeCashBox(await actionContext(USERS.oc), { report_id: report }));
    expect(await C.bumpEsncards(await actionContext(USERS.oc), { report_id: report, card: "internal", delta: 1 })).toMatchObject({ ok: false, message: /signed off/ });
    expect(await C.saveCashCount(await actionContext(USERS.oc), { report_id: report, phase: "closing", counts: {} })).toMatchObject({ ok: false, message: /signed off/ });
    expect(await C.reopenCashBox(await actionContext(USERS.oc), { report_id: report })).toMatchObject({ ok: false, error: "forbidden" });
    ok(await C.reopenCashBox(await actionContext(USERS.finance), { report_id: report }));
    ok(await C.closeCashBox(await actionContext(USERS.oc), { report_id: report }));
    const { data } = await admin.from("cash_reports").select("opening_cents, closing_cents, esncards_internal, esncards_external, closed_by").eq("id", report).single();
    expect(data).toEqual({ opening_cents: 5000, closing_cents: 7000, esncards_internal: 2, esncards_external: 1, closed_by: USERS.oc.email });
  });

  it("Finance checks and books the takings once; booked boxes cannot be reopened", async () => {
    const { data: cat } = await admin.from("finance_categories").select("id").eq("name", "ESNcard sales").single();
    expect(await C.bookCashBox(await actionContext(USERS.executive), { report_id: report, category_id: cat!.id })).toMatchObject({ ok: false, error: "forbidden" });
    ok(await C.checkCashBox(await actionContext(USERS.finance), { report_id: report }));
    const entry = ok(await C.bookCashBox(await actionContext(USERS.treasurer), { report_id: report, category_id: cat!.id })).entry_id;
    const { data } = await admin.from("finance_entries").select("direction, amount_cents, payment_method, internal_event_id, description").eq("id", entry).single();
    expect(data).toEqual({ direction: "income", amount_cents: 2000, payment_method: "cash", internal_event_id: office, description: "Cash box: Test office_hour" });
    expect(await C.bookCashBox(await actionContext(USERS.finance), { report_id: report, category_id: cat!.id })).toMatchObject({ ok: false, message: /booked already/ });
    expect(await C.reopenCashBox(await actionContext(USERS.finance), { report_id: report })).toMatchObject({ ok: false, message: /booked/ });
  });

  it("who reads cash boxes", async () => {
    for (const [user, sees] of [
      [USERS.oc, true],
      [USERS.helper, true],
      [USERS.finance, true],
      [USERS.executive, true],
      [USERS.hr, true],
      [USERS.member, false],
      [USERS.events, false],
      [USERS.comms, false],
    ] as const) {
      const { data } = await (await as(user)).from("cash_reports").select("id").eq("id", report);
      expect(data?.length ?? 0, user.email).toBe(sees ? 1 : 0);
    }
  });
});

describe("an event's cash box (drinks and the like)", () => {
  it("the event's OC and helpers count, the OC signs off; no ESNcards", async () => {
    expect(await C.startCashBox(await actionContext(USERS.volunteer1), { event_id: eventId })).toMatchObject({ ok: false, error: "forbidden" });
    const report = ok(await C.startCashBox(await actionContext(USERS.helper), { event_id: eventId })).report_id;
    expect(await C.bumpEsncards(await actionContext(USERS.helper), { report_id: report, card: "internal", delta: 1 })).toMatchObject({ ok: false, message: /office hours/ });
    ok(await C.saveCashCount(await actionContext(USERS.helper), { report_id: report, phase: "opening", counts: { "1000": 3 } }));
    ok(await C.saveCashCount(await actionContext(USERS.helper), { report_id: report, phase: "closing", counts: { "1000": 3, "200": 10 } }));
    ok(await C.setCashNote(await actionContext(USERS.helper), { report_id: report, note: "20 drinks at € 1" }));
    ok(await C.closeCashBox(await actionContext(USERS.oc), { report_id: report }));
    const { data: cat } = await admin.from("finance_categories").select("id").eq("name", "Cash box takings").single();
    ok(await C.bookCashBox(await actionContext(USERS.finance), { report_id: report, category_id: cat!.id }));
    const { data } = await admin.from("finance_entries").select("amount_cents, event_id").eq("cash_report_id", report).single();
    expect(data).toEqual({ amount_cents: 2000, event_id: eventId });
    // The event's staff read their box; Events does too, other members not.
    expect((await (await as(USERS.events)).from("cash_reports").select("note").eq("id", report)).data).toEqual([{ note: "20 drinks at € 1" }]);
    expect((await (await as(USERS.volunteer1)).from("cash_reports").select("id").eq("id", report)).data).toEqual([]);
  });
});

describe("the ledger", () => {
  it("Finance books income and spending with categories of the right direction", async () => {
    const { data: cats } = await admin.from("finance_categories").select("id, name, direction");
    const merch = cats!.find((c) => c.name === "Merchandise")!;
    const revenue = cats!.find((c) => c.name === "Event revenue")!;
    const base = { booked_on: "2041-03-05", payment_method: "bank" as const, description: "Test merch" };
    expect(await L.addEntry(await actionContext(USERS.finance), { ...base, direction: "income", category_id: merch.id, amount_cents: 100 })).toMatchObject({ ok: false, message: /other direction/ });
    const id = ok(await L.addEntry(await actionContext(USERS.finance), { ...base, direction: "expense", category_id: merch.id, amount_cents: 25_000, beleg_ref: "B-17", beleg_received: true })).id;
    await admin.from("finance_entries").update({ created_by: TEST_TAG }).eq("id", id);
    const rev = ok(await L.addEntry(await actionContext(USERS.treasurer), { ...base, direction: "income", category_id: revenue.id, amount_cents: 30_000, event_id: eventId, description: "Ticket sales" })).id;
    await admin.from("finance_entries").update({ created_by: TEST_TAG }).eq("id", rev);
    for (const user of [USERS.executive, USERS.member, USERS.events, USERS.oc, USERS.hr]) {
      expect(await L.addEntry(await actionContext(user), { ...base, direction: "expense", category_id: merch.id, amount_cents: 1 }), user.email).toMatchObject({ ok: false, error: "forbidden" });
    }
    expect((await (await as(USERS.executive)).from("finance_entries").select("id").eq("id", id)).data).toHaveLength(1);
    for (const user of [USERS.member, USERS.oc, USERS.events, USERS.hr]) {
      expect((await (await as(user)).from("finance_entries").select("id").eq("id", id)).data, user.email).toEqual([]);
    }
    ok(await L.updateEntry(await actionContext(USERS.finance), { id, ...base, direction: "expense", category_id: merch.id, amount_cents: 26_000 }));
    expect((await admin.from("finance_entries").select("amount_cents, updated_by").eq("id", id).single()).data).toEqual({ amount_cents: 26_000, updated_by: USERS.finance.email });
    ok(await L.deleteEntry(await actionContext(USERS.finance), { id }));
  });

  it("categories: Finance adds and hides them, names are unique per direction", async () => {
    const name = `Test category ${Date.now()}`;
    ok(await L.addCategory(await actionContext(USERS.finance), { direction: "expense", name }));
    expect(await L.addCategory(await actionContext(USERS.finance), { direction: "expense", name: name.toUpperCase() })).toMatchObject({ ok: false, message: /already/ });
    const { data } = await admin.from("finance_categories").select("id").eq("name", name).single();
    ok(await L.setCategoryActive(await actionContext(USERS.finance), { id: data!.id, active: false }));
    expect(await L.addCategory(await actionContext(USERS.executive), { direction: "income", name: "x" })).toMatchObject({ ok: false, error: "forbidden" });
    await admin.from("finance_categories").delete().eq("id", data!.id);
  });
});

describe("the calendar feed", () => {
  it("a link shown once; the feed shows what its owner may see", async () => {
    const board = await internal("board_meeting", { title: "Feed board meeting" });
    const talk = await internal("tuesday_talk", { title: "Feed talk", presentation_url: "https://slides.example/feed" });
    const memberUrl = ok(await F.createCalendarFeed(await actionContext(USERS.member), {})).url;
    const execUrl = ok(await F.createCalendarFeed(await actionContext(USERS.executive), {})).url;
    const token = (url: string) => parseFeedSegment(url.split("/").at(-1)!)!;
    expect(token(memberUrl)).toMatch(/^mesa_cal_/);
    // Only the hash is stored.
    const { data: row } = await admin.from("calendar_feeds").select("token_hash").eq("profile_id", USERS.member.id).single();
    expect(row!.token_hash).not.toContain(token(memberUrl));

    const memberIcs = (await renderFeed(admin, token(memberUrl)))!;
    expect(memberIcs).toContain(`UID:internal-${talk}@mesa`);
    expect(memberIcs).toContain("Presentation: https://slides.example/feed");
    expect(memberIcs).toContain(`UID:event-${eventId}@mesa`);
    expect(memberIcs).not.toContain(board);
    expect((await renderFeed(admin, token(execUrl)))!).toContain(`UID:internal-${board}@mesa`);

    // The OC sees their role in the feed.
    const ocUrl = ok(await F.createCalendarFeed(await actionContext(USERS.oc), {})).url;
    expect((await renderFeed(admin, token(ocUrl)))!).toContain("You are the OC.");
    await admin.from("calendar_feeds").delete().eq("profile_id", USERS.oc.id);
  });

  it("replacing or turning off the link stops the old one; nobody else reads the token table", async () => {
    const first = ok(await F.createCalendarFeed(await actionContext(USERS.member), {})).url;
    const second = ok(await F.createCalendarFeed(await actionContext(USERS.member), {})).url;
    expect(await renderFeed(admin, parseFeedSegment(first.split("/").at(-1)!)!)).toBeNull();
    expect(await renderFeed(admin, parseFeedSegment(second.split("/").at(-1)!)!)).not.toBeNull();
    expect((await (await as(USERS.admin)).from("calendar_feeds").select("profile_id").eq("profile_id", USERS.member.id)).data).toEqual([]);
    // Members cannot call the feed function themselves.
    expect((await (await as(USERS.member)).rpc("calendar_feed_items", { token: "x" })).error).not.toBeNull();
    ok(await F.revokeCalendarFeed(await actionContext(USERS.member), {}));
    expect(await renderFeed(admin, parseFeedSegment(second.split("/").at(-1)!)!)).toBeNull();
  });

  it("refuses unknown tokens and members who lost access", async () => {
    expect(await renderFeed(admin, `mesa_cal_${"A".repeat(43)}`)).toBeNull();
    expect(parseFeedSegment("mesa_cal_short.ics")).toBeNull();
    // The newcomer has not accepted the confidentiality rules.
    const { error } = await (await as(USERS.newcomer)).rpc("create_calendar_feed");
    expect(error?.code).toBe("42501");
  });
});
