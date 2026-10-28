// Foundation: sign-up restriction, profiles, confidentiality gate, roles,
// role sync, the jobs queue and its schedule.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, anonClient, as, clientWithToken, createEvent, deleteEvent, forgedJwt, signedJwt } from "../helpers/local";
import { runDueJobs } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { MemoryChatClient, MemoryDirectoryClient, MemoryDriveClient } from "@/lib/google/fakes";

describe("sign-up", () => {
  it("rejects accounts that are not esnmesa.org Google Workspace accounts", async () => {
    for (const [email, provider, hd] of [
      ["someone@gmail.com", "google", "gmail.com"],
      ["someone@esnmesa.org", "email", "esnmesa.org"],
      ["someone@esnmesa.org", "google", ""],
    ]) {
      const { error } = await admin.auth.admin.createUser({
        email,
        password: "x-password-123",
        app_metadata: { provider },
        user_metadata: { custom_claims: { hd } },
      });
      expect(error, `${email} via ${provider}`).not.toBeNull();
    }
  });

  it("gives every seeded member a profile with their Google name", async () => {
    const { data } = await admin.from("profiles").select("id, email, full_name").eq("id", USERS.oc.id).single();
    expect(data).toEqual({ id: USERS.oc.id, email: USERS.oc.email, full_name: USERS.oc.name });
  });
});

describe("confidentiality gate and roles", () => {
  it("my_context reports roles from the database", async () => {
    const ctx = async (u: (typeof USERS)[keyof typeof USERS]) => (await (await as(u)).rpc("my_context")).data as { roles: string[]; accepted: boolean };
    expect(await ctx(USERS.events)).toMatchObject({ accepted: true, roles: ["events"] });
    expect(await ctx(USERS.treasurer)).toMatchObject({ roles: ["treasurer"] });
    expect(await ctx(USERS.member)).toMatchObject({ roles: [] });
    // Not accepted yet: no roles, nothing visible.
    expect(await ctx(USERS.newcomer)).toMatchObject({ accepted: false, roles: [] });
  });

  it("the Treasurer counts as Finance, nobody else gets roles they lack", async () => {
    expect((await (await as(USERS.treasurer)).rpc("has_role", { wanted: "finance" })).data).toBe(true);
    expect((await (await as(USERS.finance)).rpc("has_role", { wanted: "treasurer" })).data).toBe(false);
    expect((await (await as(USERS.admin)).rpc("has_role", { wanted: "events" })).data).toBe(false);
    expect((await anonClient().rpc("has_role", { wanted: "events" })).data).toBe(false);
  });

  it("a forged token for another domain or provider gets nothing", async () => {
    const gmail = await clientWithToken(forgedJwt("events@gmail.com"));
    expect((await gmail.rpc("is_workspace_member")).data).toBe(false);
    // Right email, but not signed in with Google.
    const pw = await clientWithToken(signedJwt({ sub: USERS.events.id, email: USERS.events.email, provider: "email" }));
    expect((await pw.rpc("has_role", { wanted: "events" })).data).toBe(false);
  });

  it("acknowledging needs the current version", async () => {
    const newcomer = await as(USERS.newcomer);
    const { error } = await newcomer.rpc("acknowledge_confidentiality", { accepted_version: "2000-01-01" });
    expect(error?.code).toBe("22023");
  });
});

describe("role sync", () => {
  afterAll(async () => {
    await admin.from("role_members").delete().eq("email", "new.events@esnmesa.org");
    await admin.from("role_members").upsert({ email: USERS.events.email, role: "events", source: "group" });
  });

  it("replace_group_role mirrors a group, keeps manual rows, refuses an empty group", async () => {
    await admin.from("role_members").insert({ email: "manual.events@esnmesa.org", role: "events", source: "manual" });
    const { data } = await admin.rpc("replace_group_role", {
      member_role: "events",
      emails: ["New.Events@esnmesa.org", "events@esnmesa.org", "outsider@gmail.com"],
    });
    expect(data).toBe(2);
    const { data: rows } = await admin.from("role_members").select("email, source").eq("role", "events").order("email");
    expect(rows).toEqual([
      { email: "events@esnmesa.org", source: "group" },
      { email: "manual.events@esnmesa.org", source: "manual" },
      { email: "new.events@esnmesa.org", source: "group" },
    ]);
    expect((await admin.rpc("replace_group_role", { member_role: "events", emails: [] })).error).not.toBeNull();
    await admin.from("role_members").delete().eq("email", "manual.events@esnmesa.org");
  });

  it("members cannot call the sync functions", async () => {
    const events = await as(USERS.events);
    expect((await events.rpc("replace_group_role", { member_role: "admin", emails: [USERS.events.email] })).error).not.toBeNull();
    expect((await events.rpc("set_group_role", { member_email: USERS.member.email, member_role: "admin", member: true })).error).not.toBeNull();
  });

  it("the sync job reads the configured groups through the Directory client", async () => {
    const directory = new MemoryDirectoryClient({ "events-team@esnmesa.org": ["events@esnmesa.org", "new.events@esnmesa.org"] });
    const google = { mode: "fake" as const, chat: new MemoryChatClient(), drive: new MemoryDriveClient(), directory };
    const key = `directory.sync_roles.test.${Date.now()}`;
    await admin.rpc("enqueue_job", { job_kind: "directory.sync_roles", job_payload: {}, key });
    await runDueJobs({ admin, google, env: { GROUP_EVENTS: "events-team@esnmesa.org" }, baseUrl: "http://x" }, HANDLERS, { worker: "test" });
    const { data: job } = await admin.from("jobs").select("status, result").eq("idempotency_key", key).single();
    expect(job).toEqual({ status: "done", result: { events: 2 } });
    const { data: rows } = await admin.from("role_members").select("email").eq("role", "events").eq("source", "group").order("email");
    expect(rows!.map((r) => r.email)).toEqual(["events@esnmesa.org", "new.events@esnmesa.org"]);
  });
});

describe("jobs queue", () => {
  let eventId: string;
  beforeAll(async () => {
    eventId = (await createEvent()).id;
  });
  afterAll(async () => {
    await admin.from("jobs").delete().like("idempotency_key", "test.%");
    await deleteEvent(eventId);
  });

  const google = { mode: "fake" as const, chat: new MemoryChatClient(), drive: new MemoryDriveClient(), directory: new MemoryDirectoryClient() };
  const deps = { admin, google, env: {}, baseUrl: "http://x" };

  it("one job per idempotency key", async () => {
    const key = `test.once.${Date.now()}`;
    const a = await admin.rpc("enqueue_job", { job_kind: "system.noop", job_payload: { n: 1 }, key });
    const b = await admin.rpc("enqueue_job", { job_kind: "system.noop", job_payload: { n: 2 }, key });
    expect(a.data).toBe(b.data);
    const { data } = await admin.from("jobs").select("payload").eq("idempotency_key", key).single();
    expect(data!.payload).toEqual({ n: 1 });
  });

  it("runs, retries with backoff, and gives up after max_attempts", async () => {
    const key = `test.retry.${Date.now()}`;
    await admin.rpc("enqueue_job", { job_kind: "system.unknown_kind", job_payload: {}, key });
    await admin.from("jobs").update({ max_attempts: 2 }).eq("idempotency_key", key);

    await runDueJobs(deps, HANDLERS, { worker: "test" });
    let { data: job } = await admin.from("jobs").select("*").eq("idempotency_key", key).single();
    expect(job).toMatchObject({ status: "failed", attempts: 1 });
    expect(job!.last_error).toMatch(/No handler/);
    expect(new Date(job!.run_after).getTime()).toBeGreaterThan(Date.now() + 30_000);

    // Due again now: the second failure is the last.
    await admin.from("jobs").update({ run_after: new Date(Date.now() - 3_600_000).toISOString() }).eq("idempotency_key", key);
    await runDueJobs(deps, HANDLERS, { worker: "test" });
    ({ data: job } = await admin.from("jobs").select("*").eq("idempotency_key", key).single());
    expect(job).toMatchObject({ status: "dead", attempts: 2 });

    // Only admins retry.
    expect((await (await as(USERS.events)).rpc("retry_job", { job_id: job!.id })).error?.code).toBe("42501");
    expect((await (await as(USERS.admin)).rpc("retry_job", { job_id: job!.id })).error).toBeNull();
    ({ data: job } = await admin.from("jobs").select("status, attempts").eq("idempotency_key", key).single());
    expect(job).toEqual({ status: "pending", attempts: 0 });
  });

  it("a coalescing job runs again after it finished, and once more if enqueued while running", async () => {
    const key = `test.coalesce.${Date.now()}`;
    const enqueue = (n: number) => admin.rpc("enqueue_job", { job_kind: "system.noop", job_payload: { n }, key, coalescing: true });
    await enqueue(1);
    await runDueJobs(deps, HANDLERS, { worker: "test" });
    let { data: job } = await admin.from("jobs").select("status, result").eq("idempotency_key", key).single();
    expect(job).toEqual({ status: "done", result: { echoed: { n: 1 } } });

    await enqueue(2);
    ({ data: job } = await admin.from("jobs").select("status, result").eq("idempotency_key", key).single());
    expect(job!.status).toBe("pending");

    // Enqueued while running: rerun afterwards.
    await admin.from("jobs").update({ status: "running" }).eq("idempotency_key", key);
    await enqueue(3);
    const { data: row } = await admin.from("jobs").select("id, rerun").eq("idempotency_key", key).single();
    expect(row!.rerun).toBe(true);
    await admin.rpc("complete_job", { job_id: row!.id });
    ({ data: job } = await admin.from("jobs").select("status").eq("idempotency_key", key).single());
    expect(job!.status).toBe("pending");
  });

  it("members can neither read nor write jobs; admins can read", async () => {
    const key = `test.rls.${Date.now()}`;
    await admin.rpc("enqueue_job", { job_kind: "system.noop", job_payload: {}, key, job_event: eventId });
    for (const u of [USERS.member, USERS.events, USERS.finance]) {
      const c = await as(u);
      expect((await c.from("jobs").select("id").eq("idempotency_key", key)).data).toEqual([]);
      expect((await c.from("jobs").insert({ kind: "system.noop", idempotency_key: `${key}.x` })).error).not.toBeNull();
      expect((await c.rpc("claim_jobs", { worker: "evil", max_jobs: 1 })).error).not.toBeNull();
      expect((await c.rpc("enqueue_job", { job_kind: "system.noop", job_payload: {}, key: `${key}.y` })).error).not.toBeNull();
    }
    expect((await (await as(USERS.admin)).from("jobs").select("id").eq("idempotency_key", key)).data).toHaveLength(1);
    expect((await anonClient().from("jobs").select("id")).error).not.toBeNull();
  });

  it("pg_cron schedules the runner, role sync and privacy jobs", async () => {
    const { data, error } = await admin.rpc("test_cron_jobs");
    expect(error).toBeNull();
    const names = (data as Array<{ jobname: string; schedule: string }>).map((j) => j.jobname);
    expect(names).toEqual(expect.arrayContaining(["run-jobs", "sync-roles", "purge-auth-ip-addresses", "delete-expired-acknowledgements"]));
  });

  it("the cron call goes to the configured runner URL with the secret (pg_net)", async () => {
    const key = `test.http.${Date.now()}`;
    await admin.rpc("enqueue_job", { job_kind: "system.noop", job_payload: {}, key });
    const { data, error } = await admin.rpc("test_invoke_job_runner");
    expect(error).toBeNull();
    expect(data).toMatchObject({ url: "http://host.docker.internal:3000/api/jobs/run", authorization: "Bearer local-jobs-secret-not-for-production" });
  });
});
