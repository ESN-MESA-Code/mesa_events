// The flows changed by the review of 2026-10-28: Home per role, the locked
// volunteer form and Events clearing a response, cycle month validation,
// executive read-only Finance, the event page (breadcrumb, next step), the
// description editor after loading, and every main page at phone width.
import type { Page } from "@playwright/test";
import { USERS, admin, createEvent, daysFromNow, type SeedUser } from "../helpers/local";
import { cycleLabel } from "../../lib/dates";
import { answerConfirm, expect, freshMonth, signInAs, test } from "./fixtures";

test.describe("Home per role", () => {
  const cases: Array<[string, SeedUser, string[]]> = [
    ["member", USERS.member, []],
    ["OC", USERS.oc, []],
    ["helper", USERS.helper, []],
    ["Events", USERS.events, ["queue-events"]],
    ["Comms", USERS.comms, ["queue-comms"]],
    ["Finance", USERS.finance, ["queue-finance"]],
    ["Treasurer", USERS.treasurer, ["queue-finance"]],
    ["executive", USERS.executive, ["queue-events", "queue-comms", "queue-finance"]],
    ["admin", USERS.admin, []],
  ];
  for (const [name, user, queues] of cases) {
    test(`${name}: what's next, and their team queues`, async ({ page, context, baseURL }) => {
      await signInAs(context, baseURL!, user);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: `Hi ${user.name.split(" ")[0]}` })).toBeVisible();
      await expect(page.getByRole("heading", { name: "My events" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Coming up in MESA" })).toBeVisible();
      for (const q of ["queue-events", "queue-comms", "queue-finance"]) {
        await expect(page.getByTestId(q), q).toHaveCount(queues.includes(q) ? 1 : 0);
      }
      // The logo leads Home; team pages are their own group in the navigation.
      await expect(page.getByRole("link", { name: "MESA Events – home" })).toHaveAttribute("href", "/");
      const team = page.getByTestId("nav-team");
      if (queues.length || name === "admin") await expect(team).toBeVisible();
      else await expect(team).toHaveCount(0);
    });
  }

  test("the OC's event shows its next step with the deadline, linking to the right tab", async ({ page, context, baseURL }) => {
    const ev = await createEvent({ title: `Next step ${Math.random().toString(36).slice(2, 7)}`, oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(4), helpers_needed: 1 });
    try {
      await signInAs(context, baseURL!, USERS.oc);
      await page.goto("/");
      const card = page.getByTestId("home-needs-you").getByRole("listitem").filter({ hasText: ev.title });
      await expect(card.getByTestId("next-step")).toContainText("Write the description");
      await card.getByTestId("next-step").click();
      await expect(page).toHaveURL(new RegExp(`/events/${ev.id}/description\\?from=home$`));
      await expect(page.getByTestId("breadcrumb")).toHaveText("← Home");
      // A new description is prefilled, not "unsaved" (review C10).
      await expect(page.getByTestId("save-state")).toContainText("Not saved yet");
      await expect(page.getByTestId("save-state")).not.toHaveText("Unsaved changes");
      await page.getByLabel("Location name").fill("Backstage");
      await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
      const { data } = await admin.from("descriptions").select("fields").eq("event_id", ev.id).single();
      expect(data!.fields).toMatchObject({ venue: "Backstage", title: ev.title });

      // From My events (under To do) the breadcrumb leads back there; the banner and checklist link to tabs.
      await page.goto("/me");
      await expect(page.getByTestId("my-todo").getByRole("listitem").filter({ hasText: ev.title }).getByTestId("next-step")).toContainText("Write the description");
      await page.getByRole("link", { name: ev.title }).first().click();
      await expect(page.getByTestId("breadcrumb")).toHaveText("← My events");
      await expect(page.getByTestId("next-step-banner")).toContainText("Write the description");
      await expect(page.getByTestId("checklist").getByRole("link", { name: /Description published/ })).toHaveAttribute("href", `/events/${ev.id}/description`);
      // Recent activity in plain words for the OC, no raw log.
      await expect(page.getByTestId("activity")).toContainText("Event added to the schedule");
      await expect(page.getByTestId("raw-log")).toHaveCount(0);
      // Before the event, the hand-in is not open yet.
      await page.getByRole("link", { name: "Hand-in", exact: true }).click();
      await expect(page.getByTestId("receipts-later")).toContainText("Hand-in opens on the day of the event");
      await expect(page.getByTestId("receipt-form")).toHaveCount(0);
    } finally {
      await admin.from("events").delete().eq("id", ev.id);
    }
  });
});

test.describe("volunteer form, cycle month", () => {
  const month = `${freshMonth()}-01`;
  let cycleId = "";
  test.beforeAll(async () => {
    const { data: c } = await admin
      .from("planning_cycles")
      .insert({ month, status: "form_open", form_closes_at: daysFromNow(3) })
      .select("id")
      .single();
    cycleId = c!.id;
    await admin.from("events").insert({ cycle_id: cycleId, title: `Form test ${month}`, status: "scheduled", starts_at: `${month.slice(0, 8)}14T18:00:00Z`, helpers_needed: 2 });
  });
  test.afterAll(async () => {
    await admin.from("events").delete().eq("cycle_id", cycleId);
    await admin.from("planning_cycles").delete().eq("id", cycleId);
  });

  test("a volunteer submits once; Events clears the answers; they submit again", async ({ page, context, baseURL }) => {
    page.on("dialog", (d) => d.accept());
    const label = cycleLabel(month);
    const answer = async () => {
      await page.goto("/volunteer");
      const form = page.getByRole("region", { name: `Volunteer form ${label}` });
      await form.getByRole("radiogroup", { name: `Helper for Form test ${month}` }).getByRole("radio", { name: "Top choice" }).check();
      await form.getByRole("radiogroup", { name: /How many of these events can you do/ }).getByRole("radio", { name: "2" }).check();
      await form.getByRole("button", { name: "Submit my answers" }).click();
      await answerConfirm(page);
      return form;
    };

    await signInAs(context, baseURL!, USERS.volunteer2);
    await page.goto("/");
    await expect(page.getByTestId("home-volunteer").filter({ hasText: label })).toContainText("is open");
    const form = await answer();
    await expect(form.getByTestId("volunteer-summary")).toContainText("Submitted ✓");
    await expect(form.getByTestId("volunteer-summary")).toContainText(`Form test ${month}`);
    await expect(form.getByTestId("volunteer-summary")).toContainText("Helper: Top choice");
    // Locked: no form any more.
    await expect(form.getByRole("button", { name: "Submit my answers" })).toHaveCount(0);
    await expect(form.getByRole("radiogroup")).toHaveCount(0);
    // The answered form is off Home (Volunteer shows the answers, checked above).
    await page.goto("/");
    await expect(page.getByTestId("home-volunteer").filter({ hasText: label })).toHaveCount(0);

    // Events clears the answers on the cycle's volunteer form page, with a reason.
    await signInAs(context, baseURL!, USERS.events);
    await page.goto(`/team/events/cycles/${cycleId}/form`);
    const row = page.getByTestId(`response-${USERS.volunteer2.email}`);
    await expect(row).toContainText("1 event");
    await row.getByRole("button", { name: "Clear" }).click();
    await row.getByLabel(/Reason for clearing/).fill("Wanted OC, not helper");
    await row.getByRole("button", { name: "Clear answers" }).click();
    await expect(page.getByTestId(`response-${USERS.volunteer2.email}`)).toHaveCount(0);
    const { data: log } = await admin.from("activity_log").select("actor_email, details").eq("cycle_id", cycleId).eq("action", "clear").single();
    expect(log).toMatchObject({ actor_email: USERS.events.email, details: { email: USERS.volunteer2.email, reason: "Wanted OC, not helper" } });

    // The volunteer can answer again.
    await signInAs(context, baseURL!, USERS.volunteer2);
    const again = await answer();
    await expect(again.getByTestId("volunteer-summary")).toContainText("Submitted ✓");
  });

  test("the schedule only takes events in the cycle's month", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, USERS.events);
    await page.goto(`/team/events/cycles/${cycleId}`);
    await expect(page.getByRole("heading", { name: cycleLabel(month) })).toBeVisible();
    await expect(page.getByTestId("cycle-stepper").locator('[aria-current="step"]')).toContainText("Volunteer form");
    await page.getByRole("button", { name: "+ Add an event" }).click();
    await page.locator("#new-title").fill("Wrong month");
    const [y, m] = month.split("-").map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    await page.locator("#new-start").fill(`${next}-02T19:00`);
    await page.getByRole("button", { name: "Add event" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "must take place in" })).toBeVisible();
    expect((await admin.from("events").select("id").eq("title", "Wrong month")).data).toEqual([]);
  });
});

test("executives read Finance without acting; bank details stay with Finance", async ({ page, context, baseURL }) => {
  const ev = await createEvent({ title: `Exec finance ${Math.random().toString(36).slice(2, 7)}`, oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(-1) });
  const vendor = `Exec vendor ${Math.random().toString(36).slice(2, 7)}`;
  const { data: pol } = await admin.from("reimbursement_policies").select("id, version").eq("version", 1).single();
  const { data: rule } = await admin.from("reimbursement_rules").select("id").eq("policy_id", pol!.id).eq("expense_kind", "ticket").eq("event_type", "standard").single();
  const { data: receipt } = await admin.from("receipts").insert({ event_id: ev.id, claimant_id: USERS.helper.id, expense_kind: "ticket", vendor, amount_cents: 1200, purchased_on: "2026-10-01" }).select("id").single();
  const { data: claim } = await admin
    .from("reimbursements")
    .insert({ receipt_id: receipt!.id, event_id: ev.id, claimant_id: USERS.helper.id, claimant_role: "helper", category: "team_costs", suggested_cents: 600, policy_id: pol!.id, policy_version: 1, rule_id: rule!.id, payout_method: "bank" })
    .select("id")
    .single();
  await admin.from("payout_details").insert({ reimbursement_id: claim!.id, iban: "DE89370400440532013000", account_holder: "Hugo Helper" });
  try {
    await signInAs(context, baseURL!, USERS.executive);
    await page.goto("/");
    await page.getByTestId("nav-team").getByRole("link", { name: "Finance" }).click();
    await expect(page).toHaveURL(/\/team\/finance$/);
    await expect(page.getByTestId("read-only")).toBeVisible();
    const row = page.getByTestId(`claim-${vendor}`);
    await expect(row).toContainText("Paper receipt not handed in");
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(page.getByText("DE89370400440532013000")).toHaveCount(0);

    // Finance acts on the same row.
    await signInAs(context, baseURL!, USERS.finance);
    await page.goto("/team/finance");
    await expect(page.getByTestId("read-only")).toHaveCount(0);
    await expect(page.getByTestId(`claim-${vendor}`).getByRole("button", { name: "Paper receipt received" })).toBeVisible();
  } finally {
    await admin.from("reimbursements").delete().eq("id", claim!.id);
    await admin.from("receipts").delete().eq("id", receipt!.id);
    await admin.from("events").delete().eq("id", ev.id);
  }
});

test.describe("phone width (375 px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const noOverflow = async (page: Page, path: string) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, `${path} scrolls sideways`).toBeLessThanOrEqual(375);
  };

  const pages: Array<[SeedUser, string[]]> = [
    [USERS.member, ["/", "/calendar", "/me", "/ideas", "/volunteer"]],
    [USERS.oc, ["/", "/me"]],
    [USERS.helper, ["/", "/me"]],
    [USERS.events, ["/", "/team/events"]],
    [USERS.comms, ["/", "/team/comms"]],
    [USERS.finance, ["/", "/team/finance"]],
    [USERS.treasurer, ["/", "/team/finance/policies"]],
    [USERS.executive, ["/", "/team/events", "/team/comms", "/team/finance"]],
    [USERS.admin, ["/", "/admin"]],
  ];
  for (const [user, paths] of pages) {
    test(`${user.email}: main pages fit, the menu opens`, async ({ page, context, baseURL }) => {
      await signInAs(context, baseURL!, user);
      for (const p of paths) await noOverflow(page, p);
      await page.goto("/");
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.locator("#mobile-nav").getByRole("link", { name: "Calendar" })).toBeVisible();
    });
  }

  test("an event's pages fit for its OC", async ({ page, context, baseURL }) => {
    const ev = await createEvent({ title: `Phone ${Math.random().toString(36).slice(2, 7)}`, oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(-1), helpers_needed: 1 });
    try {
      await signInAs(context, baseURL!, USERS.oc);
      for (const tab of ["", "/description", "/attendance", "/hand-in"]) await noOverflow(page, `/events/${ev.id}${tab}`);
    } finally {
      await admin.from("events").delete().eq("id", ev.id);
    }
  });
});
