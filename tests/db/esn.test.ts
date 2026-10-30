// ESN Activities (brief 2026-10-29, B): the event report, the upload status
// (who reads, who sets, the Chat message once), personal access tokens
// (stored hashed, own only, revocable, logged) and the script's API routes
// (bad, revoked and expired tokens, CORS, rate limits, nothing of anyone
// else's).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SERVICE_ROLE_KEY, SUPABASE_URL, USERS, admin, as, createEvent, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as E from "@/lib/actions/esn";
import { runDueJobs } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";
import { ESN_ORIGIN, failureLimiter, hashToken, tokenLimiter } from "@/lib/esn/api";
import { MISSING } from "@/lib/esn/formData";
import { GET, OPTIONS } from "@/app/api/esn/events/[id]/route";
import { POST } from "@/app/api/esn/events/[id]/linked/route";

const deps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "http://mesa.test" };
const runJobs = () => runDueJobs(deps, HANDLERS, { worker: "esn-test" });
const space = `spaces/FAKEESN${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const ACTIVITY = "https://activities.esn.org/activity/pub-quiz-mesa-4711";

let past: string;
let future: string;
let other: string;
const created: string[] = [];
const report = { intl_participants: 30, local_participants: 4, organizers: 3, goals_reached: true, went_well: "Lots of laughs.", could_be_better: "", access_needs: false, access_note: "" };

const fields = {
  title: "ESN Quiz",
  dateIso: "2026-11-02",
  time: "19:00",
  venue: "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich",
  price: "5",
  hook: "a night of trivia",
  intro: "Teams battle it out. Prizes!",
  program: "Six rounds",
  bring: "A pen",
  closing: "see you there",
  esnType: "10",
  esnObjectives: "413,426",
};

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
  past = (await createEvent({ title: "ESN past quiz", starts_at: hoursFromNow(-30), oc: USERS.oc, helpers: [USERS.helper] })).id;
  future = (await createEvent({ title: "ESN future quiz", starts_at: hoursFromNow(48), oc: USERS.oc, helpers: [USERS.helper] })).id;
  other = (await createEvent({ title: "ESN other", starts_at: hoursFromNow(-30), oc: USERS.volunteer1 })).id;
  created.push(past, future, other);
  await admin.from("events").update({ chat_space_name: space }).eq("id", past);
  await admin.from("descriptions").upsert({ event_id: past, status: "published", fields, approved_fields: fields, published_at: new Date().toISOString() });
});
afterAll(async () => {
  await admin.from("fake_chat_messages").delete().eq("space", space);
  await admin.from("jobs").delete().in("event_id", created);
  await admin.from("events").delete().in("id", created);
  await admin.from("esn_access_tokens").delete().in("profile_id", [USERS.comms.id, USERS.executive.id, USERS.member.id]);
});
beforeEach(() => {
  tokenLimiter.clear();
  failureLimiter.clear();
});

describe("the event report", () => {
  it("the OC (or Events) writes it after the start; helpers, Comms and others cannot", async () => {
    expect(await E.saveEventReport(await actionContext(USERS.helper), { event_id: past, ...report })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.helper)).rpc("save_event_report", { event: past, intl_participants: 1, local_participants: 0, organizers: 1, goals_reached: true, went_well: "x" })).error?.code).toBe("42501");
    expect((await (await as(USERS.comms)).rpc("save_event_report", { event: past, intl_participants: 1, local_participants: 0, organizers: 1, goals_reached: true, went_well: "x" })).error?.code).toBe("42501");
    expect(await E.saveEventReport(await actionContext(USERS.oc), { event_id: future, ...report })).toMatchObject({ ok: false, message: "The report is written after the event has started" });
    expect(await E.saveEventReport(await actionContext(USERS.oc), { event_id: past, ...report, went_well: " " })).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await E.saveEventReport(await actionContext(USERS.oc), { event_id: past, ...report, intl_participants: -1 })).toMatchObject({ ok: false, error: "invalid_input" });
    expect((await E.saveEventReport(await actionContext(USERS.oc), { event_id: past, ...report })).ok).toBe(true);
    expect((await E.saveEventReport(await actionContext(USERS.events), { event_id: past, ...report, intl_participants: 31 })).ok).toBe(true);
    const { data } = await admin.from("event_reports").select("intl_participants, created_by, updated_by").eq("event_id", past).single();
    expect(data).toEqual({ intl_participants: 31, created_by: USERS.oc.email, updated_by: USERS.events.email });
  });

  it("the event's people and the teams read it, other members do not; changes are logged", async () => {
    for (const u of [USERS.oc, USERS.helper, USERS.comms, USERS.finance, USERS.executive]) {
      expect((await (await as(u)).from("event_reports").select("event_id").eq("event_id", past)).data, u.email).toHaveLength(1);
    }
    for (const u of [USERS.member, USERS.volunteer1]) expect((await (await as(u)).from("event_reports").select("event_id").eq("event_id", past)).data, u.email).toEqual([]);
    const { data: log } = await (await as(USERS.helper)).from("activity_log").select("action").eq("event_id", past).eq("entity", "event_reports");
    expect(log!.map((l) => l.action)).toEqual(expect.arrayContaining(["insert", "update"]));
  });

  it("prefills from the attendance list and the roster (counts only)", async () => {
    await admin.from("attendance_lists").update({ signed_off_at: new Date().toISOString(), signed_off_by: USERS.oc.email, headcount: 20 }).eq("event_id", past);
    await admin.from("event_stats").insert({ event_id: past, question: "nationality", answer: "DE", total: 6 });
    const { data } = await (await as(USERS.oc)).rpc("event_report_prefill", { event: past });
    expect(data).toEqual([{ headcount: 20, local_participants: 6, organizers: 2 }]);
    expect((await (await as(USERS.member)).rpc("event_report_prefill", { event: past })).data).toEqual([]);
  });
});

describe("the upload status", () => {
  it("only Comms, Events and executives read it; only the executive board sets it (round 2026-10-30)", async () => {
    expect(await E.markEsnUploaded(await actionContext(USERS.events), { event_id: past, url: ACTIVITY })).toMatchObject({ ok: false, error: "forbidden" });
    // Comms no longer does it (it moved to the executive board).
    expect(await E.markEsnUploaded(await actionContext(USERS.comms), { event_id: past, url: ACTIVITY })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.comms)).rpc("create_esn_token", { label: "x", valid_days: 30 })).error?.code).toBe("42501");
    expect((await (await as(USERS.oc)).rpc("mark_esn_uploaded", { event: past, url: ACTIVITY })).error?.code).toBe("42501");
    expect(await E.markEsnUploaded(await actionContext(USERS.executive), { event_id: past, url: "https://activities.esn.org/add/physical-activity" })).toMatchObject({ ok: false, error: "invalid_input" });
    expect((await (await as(USERS.executive)).rpc("mark_esn_uploaded", { event: past, url: "https://evil.example/activity/x" })).error?.code).toBe("22023");
    expect((await E.markEsnUploaded(await actionContext(USERS.executive), { event_id: past, url: `${ACTIVITY}?utm=x` })).ok).toBe(true);
    for (const u of [USERS.comms, USERS.events, USERS.executive]) expect((await (await as(u)).from("esn_uploads").select("activity_url").eq("event_id", past)).data, u.email).toEqual([{ activity_url: ACTIVITY }]);
    for (const u of [USERS.oc, USERS.helper, USERS.finance, USERS.member, USERS.admin]) expect((await (await as(u)).from("esn_uploads").select("event_id").eq("event_id", past)).data, u.email).toEqual([]);
    const { data } = await admin.from("esn_uploads").select("via, uploaded_by").eq("event_id", past).single();
    expect(data).toEqual({ via: "manual", uploaded_by: USERS.executive.email });
  });

  it("tells the event's space once, and logs every change", async () => {
    await runJobs();
    await (await as(USERS.executive)).rpc("mark_esn_uploaded", { event: past, url: "https://activities.esn.org/activity/pub-quiz-mesa-4712" });
    await runJobs();
    const { data: messages } = await admin.from("fake_chat_messages").select("text").eq("space", space).like("text", "%ESN Activities%");
    expect(messages).toEqual([{ text: `<users/all> 📢 The executive board has uploaded *ESN past quiz* on ESN Activities. <${ACTIVITY}|Open>` }]);
    expect((await E.unmarkEsnUploaded(await actionContext(USERS.executive), { event_id: past })).ok).toBe(true);
    const { data: log } = await (await as(USERS.comms)).from("activity_log").select("action").eq("event_id", past).eq("entity", "esn_uploads").order("id");
    expect(log!.map((l) => l.action)).toEqual(["insert", "update", "delete"]);
  });
});

describe("personal access tokens", () => {
  it("only executives create them; stored as SHA-256, shown once; owners see only their own", async () => {
    expect(await E.createEsnToken(await actionContext(USERS.member), { label: "x", valid_days: 30 })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.events)).rpc("create_esn_token", { label: "x", valid_days: 30 })).error?.code).toBe("42501");
    const r = await E.createEsnToken(await actionContext(USERS.executive), { label: "Laptop", valid_days: 90 });
    if (!r.ok) throw new Error(r.message);
    expect(r.data.token).toMatch(/^mesa_esn_[A-Za-z0-9_-]{43}$/);
    const { data: row } = await admin.from("esn_access_tokens").select("*").eq("token_prefix", r.data.token.slice(0, 13)).single();
    expect(row!.token_hash).toBe(hashToken(r.data.token));
    expect(JSON.stringify(row)).not.toContain(r.data.token);
    expect((await (await as(USERS.executive)).from("esn_access_tokens").select("id")).data!.map((t) => t.id)).toContain(row!.id);
    for (const u of [USERS.member, USERS.admin, USERS.comms]) expect((await (await as(u)).from("esn_access_tokens").select("id").eq("id", row!.id)).data, u.email).toEqual([]);
    // Nobody else revokes it; nobody resolves tokens but the service role.
    expect((await (await as(USERS.admin)).rpc("revoke_esn_token", { token: row!.id })).error).not.toBeNull();
    expect((await (await as(USERS.executive)).rpc("esn_token_owner", { hash: row!.token_hash })).error).not.toBeNull();
    const { data: log } = await (await as(USERS.events)).from("activity_log").select("details").eq("entity", "esn_access_tokens").eq("entity_id", row!.id);
    expect(log).toEqual([{ details: { label: "Laptop", token_prefix: r.data.token.slice(0, 13), valid_days: 90 } }]);
  });

  it("at most 5 active per person", async () => {
    const ctx = await actionContext(USERS.executive);
    const active = (await admin.from("esn_access_tokens").select("id").eq("profile_id", USERS.executive.id).is("revoked_at", null)).data!.length;
    for (let i = active; i < 5; i++) expect((await E.createEsnToken(ctx, { label: `t${i}`, valid_days: 30 })).ok).toBe(true);
    expect(await E.createEsnToken(ctx, { label: "sixth", valid_days: 30 })).toMatchObject({ ok: false, message: "You have 5 active tokens – revoke one first" });
    await admin.from("esn_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("profile_id", USERS.executive.id);
  });
});

describe("the script's API", () => {
  let token: string;
  const req = (method: string, path: string, opts: { token?: string | null; origin?: string; body?: unknown; ip?: string } = {}) => {
    const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "10.0.0.1" };
    const t = opts.token === undefined ? token : opts.token;
    if (t) headers.Authorization = `Bearer ${t}`;
    if (opts.origin) headers.Origin = opts.origin;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    return new Request(`http://mesa.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  };
  const get = (id: string, opts?: Parameters<typeof req>[2]) => GET(req("GET", `/api/esn/events/${id}`, opts), { params: Promise.resolve({ id }) });
  const link = (id: string, url: unknown, opts?: Parameters<typeof req>[2]) => POST(req("POST", `/api/esn/events/${id}/linked`, { ...opts, body: { url } }), { params: Promise.resolve({ id }) });

  beforeAll(async () => {
    const r = await E.createEsnToken(await actionContext(USERS.executive), { label: "API test", valid_days: 30 });
    if (!r.ok) throw new Error(r.message);
    token = r.data.token;
  });

  it("returns the form data for a valid token – event data only, no names or emails", async () => {
    const res = await get(past, { origin: ESN_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ESN_ORIGIN);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ event: past, title: "ESN Quiz", street: "Trautenwolfstraße 6", fee: "5.00", funding: ["44"], intl: 31, missing: [] });
    const text = JSON.stringify(body);
    for (const u of [USERS.oc, USERS.helper, USERS.comms, USERS.events]) {
      expect(text).not.toContain(u.email);
      expect(text).not.toContain(u.name);
    }
    expect((await get(future)).status).toBe(200);
    expect(((await (await get(future)).json()) as { data: { missing: string[] } }).data.missing).toContain(MISSING.report);
    expect((await get(crypto.randomUUID())).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    const { data: used } = await admin.from("esn_access_tokens").select("last_used_at").eq("token_hash", hashToken(token)).single();
    expect(used!.last_used_at).not.toBeNull();
  });

  it("refuses missing, malformed, unknown, revoked and expired tokens and a token whose owner left the executive board", async () => {
    expect((await get(past, { token: null })).status).toBe(401);
    expect((await get(past, { token: "mesa_esn_short" })).status).toBe(401);
    expect((await get(past, { token: `mesa_esn_${"x".repeat(43)}` })).status).toBe(401);

    const expired = `mesa_esn_${"e".repeat(43)}`;
    const revoked = `mesa_esn_${"r".repeat(43)}`;
    const notComms = `mesa_esn_${"m".repeat(43)}`;
    await admin.from("esn_access_tokens").insert([
      { profile_id: USERS.executive.id, label: "expired", token_hash: hashToken(expired), token_prefix: expired.slice(0, 13), expires_at: hoursFromNow(-1) },
      { profile_id: USERS.executive.id, label: "revoked", token_hash: hashToken(revoked), token_prefix: revoked.slice(0, 13), expires_at: hoursFromNow(24), revoked_at: hoursFromNow(-1) },
      { profile_id: USERS.member.id, label: "not comms", token_hash: hashToken(notComms), token_prefix: notComms.slice(0, 13), expires_at: hoursFromNow(24) },
    ]);
    for (const t of [expired, revoked, notComms]) {
      const res = await get(past, { token: t });
      expect(res.status, t.slice(0, 12)).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect((await link(past, ACTIVITY, { token: t })).status).toBe(401);
    }
    expect((await admin.from("esn_uploads").select("event_id").eq("event_id", past)).data).toEqual([]);
  });

  it("CORS: activities.esn.org only; other origins are refused", async () => {
    const pre = OPTIONS(req("OPTIONS", `/api/esn/events/${past}`, { origin: ESN_ORIGIN }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    const evil = OPTIONS(req("OPTIONS", `/api/esn/events/${past}`, { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const res = await get(past, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await link(past, ACTIVITY, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("links the saved activity for the token's owner, once told in Chat", async () => {
    expect((await link(past, "https://activities.esn.org/add/physical-activity")).status).toBe(400);
    expect((await link(crypto.randomUUID(), ACTIVITY)).status).toBe(404);
    const res = await link(past, ACTIVITY, { origin: ESN_ORIGIN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { data } = await admin.from("esn_uploads").select("activity_url, via, uploaded_by").eq("event_id", past).single();
    expect(data).toEqual({ activity_url: ACTIVITY, via: "script", uploaded_by: USERS.executive.email });
    expect(((await (await get(past)).json()) as { uploaded: string }).uploaded).toBe(ACTIVITY);
  });

  it("rate limits: per token, and failed attempts per address", async () => {
    for (let i = 0; i < 60; i++) tokenLimiter.hit(hashToken(token));
    const res = await get(past);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) expect((await get(past, { token: "nope", ip: "10.9.9.9" })).status).toBe(401);
    expect((await get(past, { token: "nope", ip: "10.9.9.9" })).status).toBe(429);
    expect((await get(past, { token: "nope", ip: "10.9.9.8" })).status).toBe(401);
  });
});
