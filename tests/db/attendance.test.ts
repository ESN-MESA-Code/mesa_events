// Attendance lists, moved in from MESAttendance (tests/db/participants,
// lists, signoff, realtime, retention there) and attached to events: the
// event's OC and helpers (and Events) run the list, executives see closed
// lists, the OC signs off.
import { afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USERS, admin, anonClient, as, clientWithToken, createEvent, forgedJwt, hoursFromNow, type SeedUser } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as A from "@/lib/actions/attendance";
import { LEGAL } from "@/lib/legal";
import type { Database } from "@/types/database";

const anon = anonClient();
const cleanup: string[] = [];
afterAll(async () => {
  if (cleanup.length) await admin.from("events").delete().in("id", cleanup);
});

/** An event starting `hours` from now with OC oc@ and helper helper@; returns id and QR token. */
async function eventAt(hours = 0, extra: { oc?: SeedUser | null } = {}) {
  const ev = await createEvent({ starts_at: hoursFromNow(hours), oc: extra.oc === undefined ? USERS.oc : extra.oc, helpers: [USERS.helper] });
  cleanup.push(ev.id);
  const { data } = await admin.from("attendance_lists").select("public_token").eq("event_id", ev.id).single();
  return { id: ev.id, token: data!.public_token };
}

const signInArgs = (eventId: string, extra: object = {}) => ({
  event: eventId,
  first_name: "Max",
  last_name: "Mustermann",
  notice_version: "2026-10-23",
  terms_version: "2026-10-23",
  nationality: "IT",
  university: "TUM",
  exchange_program: "Erasmus+",
  esn_card: false,
  kiosk: false,
  ...extra,
});
const signIn = (client: SupabaseClient<Database>, eventId: string, extra: object = {}) =>
  client.rpc("sign_in", signInArgs(eventId, extra) as Database["public"]["Functions"]["sign_in"]["Args"]);

async function statsOf(eventId: string) {
  const { data } = await admin.from("event_stats").select("question, answer, total").eq("event_id", eventId);
  const out: Record<string, Record<string, number>> = {};
  for (const r of data ?? []) (out[r.question] ??= {})[r.answer] = r.total;
  return out;
}
const countRows = async (eventId: string) => (await admin.from("participants").select("*", { count: "exact", head: true }).eq("event_id", eventId)).count ?? 0;
const names = async (client: SupabaseClient<Database>, eventId: string) => (await client.from("participants").select("first_name").eq("event_id", eventId)).data ?? [];
const closeList = (id: string) => admin.from("events").update({ starts_at: hoursFromNow(-25) }).eq("id", id);

describe("every event has a list", () => {
  it("created with the event, with a 128-bit token", async () => {
    const { token } = await eventAt(5);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("signing in through the public form", () => {
  it("anyone can sign in; the answers are counted, not stored with the name", async () => {
    const { id } = await eventAt();
    expect((await signIn(anon, id, { first_name: "Erika" })).error).toBeNull();
    const { data: rows } = await admin.from("participants").select("*").eq("event_id", id);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ first_name: "Erika", entry_method: "self", recorded_by: null, terms_version: "2026-10-23" });
    for (const column of ["nationality", "university", "exchange_program", "esn_card"]) expect(rows![0]).not.toHaveProperty(column);
    expect(await statsOf(id)).toEqual({ nationality: { IT: 1 }, university: { TUM: 1 }, exchange_program: { "Erasmus+": 1 }, esn_card: { no: 1 } });
  });

  it("counts left-out answers as not given and adds up", async () => {
    const { id } = await eventAt();
    await signIn(anon, id);
    await signIn(anon, id, { nationality: "DE", esn_card: true });
    expect((await signIn(anon, id, { nationality: "", university: null, exchange_program: undefined, esn_card: null })).error).toBeNull();
    expect(await statsOf(id)).toEqual({
      nationality: { IT: 1, DE: 1, not_given: 1 },
      university: { TUM: 2, not_given: 1 },
      exchange_program: { "Erasmus+": 2, not_given: 1 },
      esn_card: { no: 1, yes: 1, not_given: 1 },
    });
  });

  it("cannot insert into participants directly, pretend a kiosk, or sign in to nothing", async () => {
    const { id } = await eventAt();
    expect((await anon.from("participants").insert({ event_id: id, first_name: "a", last_name: "b", notice_version: "2026-10-23", terms_version: "2026-10-23" })).error).not.toBeNull();
    expect((await signIn(anon, id, { kiosk: true })).error?.code).toBe("42501");
    expect((await signIn(anon, crypto.randomUUID())).error?.code).toBe("42501");
  });

  it.each([
    ["an empty first name", { first_name: "" }],
    ["a 201-character last name", { last_name: "x".repeat(201) }],
    ["a country name instead of a code", { nationality: "Germany" }],
    ["an unknown university", { university: "Harvard" }],
    ["an unknown exchange programme", { exchange_program: "Party" }],
    ["a malformed notice version", { notice_version: "yes" }],
    ["a malformed terms version", { terms_version: "latest" }],
  ])("rejects %s, and counts nothing", async (_, extra) => {
    const { id } = await eventAt();
    expect((await signIn(anon, id, extra)).error).not.toBeNull();
    expect(await countRows(id)).toBe(0);
    expect(await statsOf(id)).toEqual({});
  });
});

describe("kiosk sign-ins", () => {
  it("the event's OC and helpers record them under their own email; others cannot", async () => {
    const { id } = await eventAt();
    expect((await signIn(await as(USERS.helper), id, { kiosk: true, first_name: "Kiosk" })).error).toBeNull();
    const { data } = await admin.from("participants").select("entry_method, recorded_by").eq("event_id", id);
    expect(data).toEqual([{ entry_method: "kiosk", recorded_by: USERS.helper.email }]);
    // Another event's staff, plain members and outsiders cannot.
    for (const c of [await as(USERS.member), await as(USERS.volunteer1), await clientWithToken(forgedJwt("someone@gmail.com"))]) {
      expect((await signIn(c, id, { kiosk: true })).error?.code).toBe("42501");
    }
  });
});

describe("the sign-in window", () => {
  it.each([
    ["from 2 hours before the event", 1.9, true],
    ["during the event", 0, true],
    ["until 24 hours after it", -23.9, true],
    ["not earlier than 2 hours before", 2.1, false],
    ["not later than 24 hours after", -24.1, false],
  ])("sign-ins work %s", async (_, hours, allowed) => {
    const { id } = await eventAt(hours);
    const { error } = await signIn(anon, id);
    if (allowed) expect(error).toBeNull();
    else expect(error?.code).toBe("42501");
  });

  it("cancelled events take no sign-ins; the public form learns the state", async () => {
    const { id, token } = await eventAt(0);
    await admin.from("events").update({ status: "cancelled" }).eq("id", id);
    expect((await signIn(anon, id)).error?.code).toBe("42501");
    const { data } = await anon.rpc("get_public_event", { token });
    expect(data![0].closed).toBe(true);
    const upcoming = await eventAt(5);
    const { data: u } = await anon.rpc("get_public_event", { token: upcoming.token });
    expect(u![0]).toMatchObject({ closed: false, title: expect.any(String) });
    expect(Object.keys(u![0]).sort()).toEqual(["closed", "closes_at", "event_date", "id", "opens_at", "risk_notice", "title"]);
  });
});

describe("who sees the names", () => {
  it("the event's staff and Events while open; not other events' staff, Comms or Finance", async () => {
    const { id } = await eventAt(0);
    await signIn(anon, id, { first_name: "Open" });
    for (const u of [USERS.oc, USERS.helper, USERS.events, USERS.executive]) expect(await names(await as(u), id), u.email).toEqual([{ first_name: "Open" }]);
    for (const u of [USERS.volunteer1, USERS.member, USERS.comms, USERS.finance, USERS.admin]) expect(await names(await as(u), id), u.email).toEqual([]);
    expect(await names(anon, id)).toEqual([]);
  });

  it("only executives once the list is closed or signed off", async () => {
    const { id } = await eventAt(0);
    await signIn(anon, id, { first_name: "Closed" });
    expect((await A.signOffList(await actionContext(USERS.oc), { event_id: id, headcount: 1 })).ok).toBe(true);
    expect(await names(await as(USERS.oc), id)).toEqual([]);
    expect(await names(await as(USERS.executive), id)).toEqual([{ first_name: "Closed" }]);

    const other = await eventAt(0);
    await signIn(anon, other.id, { first_name: "Late" });
    await closeList(other.id);
    expect(await names(await as(USERS.helper), other.id)).toEqual([]);
    expect(await names(await as(USERS.executive), other.id)).toHaveLength(1);
  });

  it("nobody reads the counts table through the API", async () => {
    for (const c of [anon, await as(USERS.oc), await as(USERS.executive)]) {
      const { data } = await c.from("event_stats").select("*");
      expect(data ?? []).toEqual([]);
    }
  });

  it("nobody changes or deletes sign-ins", async () => {
    const { id } = await eventAt(0);
    await signIn(anon, id);
    for (const c of [anon, await as(USERS.oc), await as(USERS.events), await as(USERS.executive)]) {
      await c.from("participants").update({ first_name: "Changed" }).eq("event_id", id);
      await c.from("participants").delete().eq("event_id", id);
    }
    expect(await countRows(id)).toBe(1);
    expect((await admin.from("participants").select("first_name").eq("event_id", id)).data).toEqual([{ first_name: "Max" }]);
  });
});

describe("event_summary and counts", () => {
  it("staff get the numbers of an open list, no counts per answer yet", async () => {
    const { id } = await eventAt(0);
    await signIn(anon, id);
    await signIn(await as(USERS.oc), id, { nationality: "FR", kiosk: true });
    const { data } = await (await as(USERS.oc)).rpc("event_summary", { event: id });
    expect(data).toMatchObject({ signins: 2, kiosk: 1 });
    expect(data).not.toHaveProperty("nationality");
  });

  it("Finance sees the counts per answer once the list is closed, never names", async () => {
    const { id } = await eventAt(0);
    await signIn(anon, id);
    await signIn(anon, id, { nationality: "FR", university: null });
    await closeList(id);
    const finance = await as(USERS.finance);
    expect((await finance.rpc("event_summary", { event: id })).data).toMatchObject({ signins: 2, nationality: { IT: 1, FR: 1 }, university: { TUM: 1, not_given: 1 } });
    expect(await names(finance, id)).toEqual([]);
    expect((await finance.rpc("event_signin_counts")).data).toContainEqual({ event_id: id, signins: 2 });
  });

  it("tells members who are not staff, visitors and outsiders nothing", async () => {
    const { id } = await eventAt(0);
    for (const c of [anon, await as(USERS.member), await as(USERS.volunteer1), await clientWithToken(forgedJwt("someone@gmail.com"))]) {
      expect((await c.rpc("event_summary", { event: id })).data ?? null).toBeNull();
    }
  });
});

describe("signing off", () => {
  it("the OC signs off with a headcount; the database records who and when", async () => {
    const { id } = await eventAt(0);
    const { data, error } = await (await as(USERS.oc))
      .from("attendance_lists")
      .update({ headcount: 3, signed_off_by: "someone-else@esnmesa.org", signed_off_at: "2000-01-01T00:00:00Z" })
      .eq("event_id", id)
      .select("signed_off_at, signed_off_by, headcount")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ signed_off_by: USERS.oc.email, headcount: 3 });
    expect(new Date(data!.signed_off_at!).getFullYear()).toBeGreaterThan(2020);
  });

  it("needs a headcount; helpers, Events (when there is an OC) and others cannot", async () => {
    const { id } = await eventAt(0);
    expect((await (await as(USERS.oc)).from("attendance_lists").update({ signed_off_at: new Date().toISOString() }).eq("event_id", id)).error?.code).toBe("23514");
    expect(await A.signOffList(await actionContext(USERS.helper), { event_id: id, headcount: 2 })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.helper)).from("attendance_lists").update({ headcount: 2 }).eq("event_id", id)).error?.code).toBe("42501");
    expect((await (await as(USERS.events)).from("attendance_lists").update({ headcount: 2 }).eq("event_id", id)).error?.code).toBe("42501");
    const { count } = await (await as(USERS.member)).from("attendance_lists").update({ headcount: 2 }, { count: "exact" }).eq("event_id", id);
    expect(count ?? 0).toBe(0);
    expect(await A.signOffList(await actionContext(USERS.oc), { event_id: id, headcount: -1 })).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("Events signs off an event without an OC", async () => {
    const { id } = await eventAt(0, { oc: null });
    expect((await A.signOffList(await actionContext(USERS.events), { event_id: id, headcount: 4 })).ok).toBe(true);
  });

  it("is final, closes sign-ins, and the token cannot change", async () => {
    const { id, token } = await eventAt(0);
    expect((await signIn(anon, id)).error).toBeNull();
    await A.signOffList(await actionContext(USERS.oc), { event_id: id, headcount: 1 });
    const oc = await as(USERS.oc);
    expect((await oc.from("attendance_lists").update({ headcount: 99 }).eq("event_id", id)).error?.code).toBe("42501");
    expect((await oc.from("attendance_lists").update({ signed_off_at: null, signed_off_by: null, headcount: null }).eq("event_id", id)).error?.code).toBe("42501");
    expect((await signIn(anon, id)).error?.code).toBe("42501");
    expect((await signIn(oc, id, { kiosk: true })).error?.code).toBe("42501");
    expect((await anon.rpc("get_public_event", { token })).data![0].closed).toBe(true);
    expect((await oc.from("attendance_lists").update({ public_token: "guessable" }).eq("event_id", id)).error?.code).toBe("42501");
  });

  it("the date and risk notice are fixed once people signed in", async () => {
    const { id } = await eventAt(0);
    expect((await A.setRiskNotice(await actionContext(USERS.helper), { event_id: id, risk_notice: "Steep paths" })).ok).toBe(true);
    await signIn(anon, id);
    expect((await A.setRiskNotice(await actionContext(USERS.oc), { event_id: id, risk_notice: "Changed" })).ok).toBe(false);
    expect((await (await as(USERS.events)).from("events").update({ starts_at: hoursFromNow(48) }).eq("id", id)).error?.code).toBe("42501");
  });
});

describe("live list (realtime)", () => {
  it("only the event's organisers receive new sign-ins, names but no answers", async () => {
    const { id } = await eventAt(0);
    const clients: SupabaseClient<Database>[] = [];
    async function listen(client: SupabaseClient<Database>) {
      clients.push(client);
      const received: Record<string, unknown>[] = [];
      await new Promise<void>((resolve, reject) => {
        client
          .channel(`participants:${id}:${crypto.randomUUID()}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants", filter: `event_id=eq.${id}` }, (p) => received.push(p.new))
          .on("system", {}, (payload) => {
            if (payload.extension === "postgres_changes") {
              if (payload.status === "ok") resolve();
              else reject(new Error(payload.message));
            }
          })
          .subscribe((status, err) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
          });
      });
      return received;
    }
    const { signedJwt } = await import("../helpers/local");
    const fresh = (u: SeedUser) => clientWithToken(signedJwt({ sub: u.id, email: u.email }));
    const oc = await listen(await fresh(USERS.oc));
    const member = await listen(await fresh(USERS.member));
    // Visitors have no SELECT privilege on participants at all: realtime
    // refuses the subscription (stricter than RLS alone).
    const visitor = await listen(anonClient()).catch((err: Error) => {
      expect(err.message).toMatch(/invalid column for filter/);
      return [] as Record<string, unknown>[];
    });
    expect((await signIn(anonClient(), id, { first_name: "Live" })).error).toBeNull();
    await expect.poll(() => oc.length, { timeout: 15_000 }).toBe(1);
    expect(oc[0].first_name).toBe("Live");
    for (const column of ["nationality", "university", "exchange_program", "esn_card"]) expect(oc[0]).not.toHaveProperty(column);
    await new Promise((r) => setTimeout(r, 1500));
    expect(member).toEqual([]);
    expect(visitor).toEqual([]);
    await Promise.all(clients.map((c) => c.removeAllChannels()));
  });
});

describe("retention", () => {
  const startOfYear = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const yearsBefore = (years: number, days: number) => new Date(Date.UTC(startOfYear.getUTCFullYear() - years, 0, 1 + days)).toISOString();

  it("keeps lists as long as the privacy notice says", () => {
    expect(LEGAL.retention.years).toBe(3);
  });

  it("deletes lists (sign-ins, counts) past retention but keeps the event", async () => {
    const expired = await createEvent({ starts_at: yearsBefore(3, -1) });
    const kept = await createEvent({ starts_at: yearsBefore(3, 0) });
    cleanup.push(expired.id, kept.id);
    await admin.from("participants").insert({ event_id: expired.id, first_name: "Old", last_name: "Timer", notice_version: "2026-10-23", terms_version: "2026-10-23" });
    await admin.from("event_stats").insert({ event_id: expired.id, question: "esn_card", answer: "yes", total: 1 });

    for (const c of [anon, await as(USERS.admin)]) expect((await c.rpc("delete_expired_lists")).error).not.toBeNull();
    expect((await admin.rpc("delete_expired_lists")).error).toBeNull();
    expect((await admin.from("attendance_lists").select("event_id").in("event_id", [expired.id, kept.id])).data).toEqual([{ event_id: kept.id }]);
    expect((await admin.from("participants").select("id").eq("event_id", expired.id)).data).toEqual([]);
    expect((await admin.from("event_stats").select("event_id").eq("event_id", expired.id)).data).toEqual([]);
    expect((await admin.from("events").select("id").eq("id", expired.id)).data).toHaveLength(1);
  });
});

describe("kept in step with the app", () => {
  it("the database's sign-in window matches lib/attendance/window.ts", async () => {
    const { signinsCloseAt, signinsOpenAt } = await import("@/lib/attendance/window");
    const at = "2026-11-05T18:00:00.000Z";
    const open = await admin.rpc("signins_open_at", { event_date: at });
    const close = await admin.rpc("signins_close_at", { event_date: at });
    expect(new Date(open.data as string).toISOString()).toBe(signinsOpenAt(at).toISOString());
    expect(new Date(close.data as string).toISOString()).toBe(signinsCloseAt(at).toISOString());
  });

  it("the confidentiality version matches legal/details.json", async () => {
    expect((await admin.rpc("confidentiality_version")).data).toBe(LEGAL.confidentiality_version);
  });
});
