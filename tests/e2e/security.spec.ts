// App security against the production build: headers, the jobs route's
// secret, no local test sign-in, login and confidentiality gates, open
// redirects, and IDOR attempts on every [id] route.
import { USERS, admin, createCycle, createEvent, daysFromNow, JOBS_SECRET } from "../helpers/local";
import { expect, test, signInAs } from "./fixtures";

test.describe("headers", () => {
  test("CSP with a nonce, no framing, no sniffing", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    const csp = h["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("same-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("every script carries the request's nonce", async ({ page }) => {
    const res = await page.goto("/login");
    const nonce = /'nonce-([^']+)'/.exec(res!.headers()["content-security-policy"])![1];
    const scripts = await page.locator("script").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
    expect(scripts.length).toBeGreaterThan(0);
    for (const n of scripts) expect(n).toBe(nonce);
    // Hydrated: the Google button is interactive, so no script was blocked.
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
  });
});

test.describe("jobs route", () => {
  test("rejects a missing or wrong secret, and GET", async ({ request }) => {
    expect((await request.post("/api/jobs/run")).status()).toBe(401);
    expect((await request.post("/api/jobs/run", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.post("/api/jobs/run", { headers: { Authorization: `Bearer ${JOBS_SECRET}x` } })).status()).toBe(401);
    expect((await request.post("/api/jobs/run", { headers: { Authorization: JOBS_SECRET } })).status()).toBe(401);
    expect((await request.get("/api/jobs/run")).status()).toBe(405);
    expect((await request.post("/api/jobs/run", { headers: { Authorization: `Bearer ${JOBS_SECRET}` } })).status()).toBe(200);
  });
});

test.describe("local test sign-in in a production build", () => {
  test("is not offered and does not work", async ({ page, request }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByText("Local test sign-in")).toHaveCount(0);
    const res = await request.post("/auth/local-login", { form: { email: USERS.admin.email, next: "/admin" }, maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});

test.describe("sign-in gates", () => {
  test("signed-out visitors go to the login page; APIs answer 401", async ({ page, request }) => {
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/login\?next=%2Fcalendar$/);
    expect((await request.get(`/api/anything/${crypto.randomUUID()}`, { maxRedirects: 0 })).status()).toBe(401);
    for (const p of ["/admin", "/team/finance", "/me", `/kiosk/${crypto.randomUUID()}`]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).toBe(307);
      expect(res.headers()["location"], p).toContain("/login?next=");
    }
  });

  test("members who have not accepted the confidentiality rules see nothing", async ({ page, context, baseURL }) => {
    await admin.from("organiser_acknowledgements").delete().eq("email", USERS.newcomer.email);
    await signInAs(context, baseURL!, USERS.newcomer);
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/confidentiality\?next=%2Fcalendar/);
    await expect(page.getByRole("button", { name: "I accept / Ich akzeptiere" })).toBeVisible();
  });

  test("open redirects are refused after accepting the rules", async ({ context, baseURL, page }) => {
    await signInAs(context, baseURL!, USERS.member);
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/%2F%2Fevil.example"]) {
      const res = await page.request.post("/confidentiality/accept", { form: { version: "2026-10-23", next }, maxRedirects: 0 });
      expect(res.status(), next).toBe(303);
      expect(new URL(res.headers()["location"]).origin, next).toBe(new URL(baseURL!).origin);
      expect(new URL(res.headers()["location"]).pathname, next).toBe("/");
    }
    const cb = await page.request.get("/auth/callback?code=bogus&next=//evil.example", { maxRedirects: 0 });
    expect(new URL(cb.headers()["location"]).origin).toBe(new URL(baseURL!).origin);
  });
});

test.describe("IDOR: every [id] route checks the member, not the URL", () => {
  let cycleId: string;
  let draftId: string;
  let eventA: string;
  let batchId: string;
  let claimId: string;

  test.beforeAll(async () => {
    cycleId = (await createCycle()).id;
    draftId = (await createEvent({ title: "IDOR draft", status: "draft" })).id;
    eventA = (await createEvent({ title: "IDOR event A", oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(-1) })).id;
    // A claim owned by the helper.
    const { data: pol } = await admin.from("reimbursement_policies").select("id, version").eq("version", 1).single();
    const { data: rule } = await admin.from("reimbursement_rules").select("id").eq("policy_id", pol!.id).eq("expense_kind", "ticket").eq("event_type", "standard").single();
    const { data: receipt } = await admin
      .from("receipts")
      .insert({ event_id: eventA, claimant_id: USERS.helper.id, expense_kind: "ticket", vendor: "IDOR", amount_cents: 100, purchased_on: "2026-10-01" })
      .select("id")
      .single();
    const { data: claim } = await admin
      .from("reimbursements")
      .insert({ receipt_id: receipt!.id, event_id: eventA, claimant_id: USERS.helper.id, claimant_role: "helper", category: "team_costs", suggested_cents: 50, policy_id: pol!.id, policy_version: pol!.version, rule_id: rule!.id })
      .select("id")
      .single();
    claimId = claim!.id;
    const { data: batch } = await admin.from("payout_batches").insert({ month: `${3000 + Math.floor(Math.random() * 5000)}-01-01` }).select("id").single();
    batchId = batch!.id;
  });

  test.afterAll(async () => {
    await admin.from("reimbursements").delete().eq("id", claimId);
    await admin.from("receipts").delete().eq("vendor", "IDOR");
    await admin.from("payout_batches").delete().eq("id", batchId);
    await admin.from("events").delete().in("id", [draftId, eventA]);
    await admin.from("planning_cycles").delete().eq("id", cycleId);
  });

  const status = async (page: import("@playwright/test").Page, path: string) => (await page.request.get(path, { maxRedirects: 0 })).status();

  test("a plain member gets 404 for records they may not see; team pages say No access", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, USERS.member);
    for (const [p, name] of [
      ["/admin", "Admin"],
      ["/team/finance", "Finance"],
      ["/team/comms", "Comms"],
      ["/team/events", "Events team"],
    ] as const) {
      const res = await page.request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).toBe(307);
      expect(res.headers()["location"], p).toContain(`/no-access?page=${encodeURIComponent(name)}`);
    }
    await page.goto("/team/finance");
    await expect(page.getByTestId("no-access")).toContainText("Finance is for a team you are not in");
    // The page name is not taken from anywhere else.
    await page.goto("/no-access?page=%3Cscript%3E");
    await expect(page.getByTestId("no-access")).toContainText("This page is for a team you are not in");
    for (const p of [
      `/team/events/cycles/${cycleId}`,
      `/team/events/cycles/${cycleId}/roster`,
      `/team/finance/batches/${batchId}`,
      `/events/${draftId}`,
      `/events/${draftId}/description`,
      `/events/${crypto.randomUUID()}`,
      "/events/not-a-uuid",
      `/kiosk/${eventA}`,
    ]) {
      expect(await status(page, p), p).toBe(404);
    }
    // Unknown pages render the styled page with a way back.
    await page.goto(`/events/${crypto.randomUUID()}`);
    await expect(page.getByTestId("not-found")).toContainText("Back to Home");
  });

  test("no receipt photos: the old photo route is gone for everyone, the hand-in form has no upload", async ({ page, context, baseURL }) => {
    for (const user of [USERS.helper, USERS.finance]) {
      await signInAs(context, baseURL!, user);
      expect(await status(page, `/api/receipts/${claimId}/file`), user.email).toBe(404);
    }
    await signInAs(context, baseURL!, USERS.helper);
    await page.goto(`/events/${eventA}/hand-in#register-receipt`);
    await expect(page.getByTestId("receipt-form")).toBeVisible();
    await expect(page.getByTestId("receipt-form").locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByTestId("my-claims")).toContainText("IDOR");
    await expect(page.getByText("View photo")).toHaveCount(0);
    // Event photos go straight to Drive too (brief 2026-10-29, A): no file input on the whole tab.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test("another event's helper sees neither names nor receipts there", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, USERS.volunteer2);
    await page.goto(`/events/${eventA}/attendance`);
    await expect(page.getByText("The attendance list is for the event's OC and helpers.")).toBeVisible();
    await page.goto(`/events/${eventA}/hand-in`);
    await expect(page.getByText("The hand-in is for the event's OC and helpers.")).toBeVisible();
    expect(await status(page, `/kiosk/${eventA}`)).toBe(404);
  });

  test("finance pages: Finance, executives read-only (no bank details), nobody else", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, USERS.finance);
    expect(await status(page, `/team/finance/batches/${batchId}`)).toBe(200);
    await signInAs(context, baseURL!, USERS.executive);
    expect(await status(page, `/team/finance/batches/${batchId}`)).toBe(200);
    await page.goto(`/team/finance/batches/${batchId}`);
    await expect(page.getByRole("button", { name: "Mark batch paid" })).toHaveCount(0);
    for (const user of [USERS.events, USERS.comms, USERS.admin, USERS.oc]) {
      await signInAs(context, baseURL!, user);
      expect(await status(page, `/team/finance/batches/${batchId}`), user.email).toBe(404);
    }
  });
});
