// Comms and Events one month at a time (brief 2026-10-29, C): switching
// months (arrows, list, remembered choice), the stage filters with counts,
// the inline actions (Review, Publish, Remind OC, Paste link), late as a
// mark, the phone track, and the Events page's month with its events.
import { USERS, admin, createEvent, hoursFromNow, TEST_TAG } from "../helpers/local";
import { answerConfirm, expect, freshMonth, runJobs, test } from "./fixtures";

const fields = (title: string) => ({
  title,
  dateIso: "2045-01-10",
  time: "19:00",
  venue: "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich",
  price: "free",
  hook: "a test",
  intro: "A test event. Nothing more.",
  program: "Testing",
  bring: "Nothing",
  closing: "see you",
  esnType: "10",
  esnObjectives: "413,426",
  esnGoal: "Bring internationals and locals together.",
});

test("Comms: a month by stage, filters, inline actions, switching months", async ({ page, as, baseURL }) => {
  const month = freshMonth();
  const other = `${Number(month.slice(0, 4)) + 1}${month.slice(4)}`;
  const tag = Math.random().toString(36).slice(2, 7);
  const day = (m: string, d: number) => `${m}-${String(d).padStart(2, "0")}T18:00:00Z`;
  const { data: cycles } = await admin
    .from("planning_cycles")
    .insert([
      // The deadline has passed: undone descriptions are late.
      { month: `${month}-01`, status: "confirmed", description_deadline: hoursFromNow(-2), created_by: TEST_TAG },
      { month: `${other}-01`, status: "confirmed", created_by: TEST_TAG },
    ])
    .select("id, month");
  const cycleOf = (m: string) => cycles!.find((c) => c.month.startsWith(m))!.id;
  const ev = async (title: string, status: string | null, d: number, m = month) => {
    const e = await createEvent({ title: `${title} ${tag}`, cycle_id: cycleOf(m), starts_at: day(m, d), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
    if (status) await admin.from("descriptions").upsert({ event_id: e.id, status, fields: fields(e.title), approved_fields: fields(e.title), ...(status === "approved" || status === "published" ? { approved_text: `${e.title} – approved text` } : {}), ...(status === "published" ? { published_at: new Date().toISOString() } : {}) });
    return e;
  };
  const review = await ev("Review me", "submitted", 10);
  const publish = await ev("Publish me", "approved", 11);
  await admin.from("events").update({ chat_space_requested_at: new Date().toISOString(), chat_space_name: `spaces/FAKEMONTH${tag.toUpperCase()}` }).eq("id", publish.id);
  // Submitted once, sent back: late, but not cancelled at the deadline (never-submitted ones are, round 2026-10-30).
  const late = await ev("Late one", "changes_requested", 12);
  await admin.from("descriptions").update({ submitted_at: hoursFromNow(-30) }).eq("event_id", late.id);
  const waiting = await ev("Waiting one", "published", 13);
  const nextYear = await ev("Next year", "submitted", 5, other);
  // Happened last week, report in: ready for ESN Activities (no cycle: this month).
  const happened = await createEvent({ title: `Happened ${tag}`, starts_at: hoursFromNow(-30), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  await admin.from("descriptions").upsert({ event_id: happened.id, status: "published", fields: fields(happened.title), approved_fields: fields(happened.title), published_at: hoursFromNow(-40) });
  await admin.from("event_reports").upsert({ event_id: happened.id, intl_participants: 12, organizers: 2, went_well: "Fine." });

  await as(USERS.comms);
  await page.goto(`/team/comms?month=${month}`);
  await expect(page.getByTestId("comms-progress")).toHaveText("3 of 4 descriptions in · 0 of 0 on ESN Activities");
  // Needs Comms (default): review, publish, the late one – not the one waiting for its event.
  const rows = page.getByTestId("comms-rows");
  await expect(page.getByTestId("filter-needs")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("filter-needs")).toContainText("3");
  await expect(page.getByTestId("filter-review")).toContainText("In review 1");
  await expect(page.getByTestId("filter-publish")).toContainText("Ready to publish 1");
  await expect(page.getByTestId("filter-waiting")).toContainText("Waiting for the event 1");
  await expect(rows.locator("> li")).toHaveCount(3);
  await expect(rows).not.toContainText(waiting.title);
  const row = (id: string) => page.getByTestId(`comms-row-${id}`);
  await expect(row(late.id)).toContainText("late");
  await expect(row(review.id).locator('[aria-current="step"]')).toHaveText(/In review$/);
  await expect(row(review.id).getByRole("link", { name: "Review", exact: true })).toHaveAttribute("href", `/events/${review.id}/description?from=comms`);

  // Inline: remind the OC of the late one (once a day).
  await row(late.id).getByRole("button", { name: "Remind OC" }).click();
  await expect(row(late.id).getByRole("button", { name: "Reminded ✓" })).toBeVisible();
  // Inline: publish.
  page.once("dialog", (d) => d.accept());
  await row(publish.id).getByRole("button", { name: "Publish" }).click();
  await answerConfirm(page);
  await expect(row(publish.id)).toContainText("Publishing to the Chat space…");
  await runJobs(baseURL!);
  await page.reload();
  await expect(row(publish.id)).toHaveCount(0);
  await page.getByTestId("filter-waiting").click();
  await expect(rows).toContainText(publish.title);
  await expect(rows).toContainText(waiting.title);
  await expect(page).toHaveURL(new RegExp(`month=${month}&show=waiting`));

  // Switching months: the arrow, the list; the choice is remembered.
  await page.getByTestId("month-arrow-next").click();
  await expect(page).toHaveURL(new RegExp(`month=${other}`));
  await expect(page.getByTestId("comms-rows")).toContainText(nextYear.title);
  await page.getByLabel("Month", { exact: true }).selectOption(month);
  await expect(page).toHaveURL(new RegExp(`month=${month}`));
  await page.goto("/team/comms");
  await expect(page).toHaveURL(new RegExp(`month=${month}`));

  // This month: the event that happened is ready for ESN Activities; the executive board pastes the link (round 2026-10-30).
  await as(USERS.executive);
  const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).format(new Date(happened.starts_at));
  await page.goto(`/team/comms?month=${thisMonth}&show=esn`);
  const h = row(happened.id);
  await expect(h.locator('[aria-current="step"]')).toHaveText(/ESN Activities uploaded$/);
  await expect(h.getByTestId("open-esn-form")).toBeVisible();
  await h.getByRole("button", { name: "Paste link" }).click();
  await h.getByLabel("ESN activity link").fill(`https://activities.esn.org/activity/happened-${tag}-1`);
  await h.getByRole("button", { name: "Mark uploaded" }).click();
  await expect(h).toHaveCount(0);
  await page.goto(`/team/comms?month=${thisMonth}&show=done`);
  await expect(row(happened.id).getByRole("link", { name: "View on ESN Activities" })).toBeVisible();

  // Phones: the track is the current stage and "n of 7"; nothing scrolls sideways.
  await as(USERS.comms);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/team/comms?month=${month}&show=all`);
  await expect(row(review.id).getByTestId("stage-compact")).toHaveText("In review 2 of 7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await admin.from("fake_chat_messages").delete().like("text", `%${tag}%`);
});

test("Events: the month's cycle and events; planning a new month from the list", async ({ page, as }) => {
  const month = freshMonth();
  const tag = Math.random().toString(36).slice(2, 7);
  const { data: cycle } = await admin.from("planning_cycles").insert({ month: `${month}-01`, status: "confirmed", created_by: TEST_TAG }).select("id").single();
  const short = await createEvent({ title: `Short ${tag}`, cycle_id: cycle!.id, starts_at: `${month}-08T18:00:00Z`, oc: USERS.oc, helpers: [], helpers_needed: 2 });
  const full = await createEvent({ title: `Full ${tag}`, cycle_id: cycle!.id, starts_at: `${month}-09T18:00:00Z`, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  await admin.from("descriptions").upsert({ event_id: full.id, status: "submitted" });

  await as(USERS.events);
  await page.goto(`/team/events?month=${month}`);
  await expect(page.getByTestId("month-stepper").locator('[aria-current="step"]')).toHaveText(/Descriptions$/);
  await expect(page.getByTestId("month-next")).toHaveAttribute("href", `/team/events/cycles/${cycle!.id}/descriptions`);
  await expect(page.getByTestId(`month-event-${short.id}`).getByTestId("staffing")).toHaveText(`OC ${USERS.oc.name} · 0/2 helpers`);
  await expect(page.getByTestId(`month-event-${full.id}`).getByTestId("description")).toHaveText("Description: Waiting for Comms review");
  await expect(page.getByTestId("month-events").locator("> li")).toHaveCount(2);

  // Executives read the month, without planning.
  await as(USERS.executive);
  await page.goto(`/team/events?month=${month}`);
  await expect(page.getByTestId("month-events")).toContainText(full.title);
  await expect(page.getByLabel("Month", { exact: true }).locator("option", { hasText: "Plan a new month" })).toHaveCount(0);

  // Planning the next month starts from the month list.
  await as(USERS.events);
  await page.goto(`/team/events?month=${month}`);
  await page.getByLabel("Month", { exact: true }).selectOption({ label: "+ Plan a new month" });
  await expect(page.getByTestId("new-cycle")).toBeVisible();
  await expect(page.getByLabel("New cycle: events in")).toBeVisible();
});
