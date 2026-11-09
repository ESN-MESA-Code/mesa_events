// Comms and Events one month at a time (brief 2026-10-29, C): switching
// months (arrows, list, remembered choice), the stage filters with counts,
// the inline actions (Review, Set up pretix, Advertise – round 2026-11-03;
// reminders are automatic), late as a mark, the phone track, and the Events
// page's month with its events.
import { USERS, admin, createEvent, hoursFromNow, TEST_TAG } from "../helpers/local";
import { expect, freshMonth, test } from "./fixtures";

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

test("Comms: a month by stage, filters, inline actions, switching months", async ({ page, as }) => {
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
  // Approved: in the Chat space by itself (round 2026-11-03) – next is pretix.
  const approved = await ev("Approved one", "approved", 11);
  await admin.from("events").update({ chat_space_requested_at: new Date().toISOString(), chat_space_name: `spaces/FAKEMONTH${tag.toUpperCase()}` }).eq("id", approved.id);
  // Submitted once, sent back: late, but not cancelled at the deadline (never-submitted ones are, round 2026-10-30).
  const late = await ev("Late one", "changes_requested", 12);
  await admin.from("descriptions").update({ submitted_at: hoursFromNow(-30) }).eq("event_id", late.id);
  const pretixOne = await ev("Pretix one", "published", 13);
  const advertiseOne = await ev("Advertise one", "published", 14);
  const waiting = await ev("Waiting one", "published", 15);
  // pretix ticked for two; the waiting one is also posted on Telegram and Instagram.
  const published = async (channel: string, eventId: string) => {
    const { data: p } = await admin.from("publication_posts").insert({ channel, scheduled_for: new Date().toISOString(), status: "published", published_at: new Date().toISOString() }).select("id").single();
    await admin.from("publication_post_events").insert({ post_id: p!.id, event_id: eventId });
  };
  for (const id of [advertiseOne.id, waiting.id]) await published("pretix", id);
  for (const c of ["telegram", "instagram"]) await published(c, waiting.id);
  const nextYear = await ev("Next year", "submitted", 5, other);

  await as(USERS.comms);
  await page.goto(`/team/comms?month=${month}`);
  await expect(page.getByTestId("comms-progress")).toHaveText("5 of 6 descriptions in · 1 of 6 upcoming advertised");
  // Needs Comms (default): review, pretix (two), advertise, the late one – not the one waiting for its event.
  const rows = page.getByTestId("comms-rows");
  await expect(page.getByTestId("filter-needs")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("filter-needs")).toContainText("5");
  await expect(page.getByTestId("filter-review")).toContainText("In review 1");
  await expect(page.getByTestId("filter-pretix")).toContainText("pretix to set up 2");
  await expect(page.getByTestId("filter-advertise")).toContainText("To advertise 1");
  await expect(page.getByTestId("filter-waiting")).toContainText("Waiting for the event 1");
  await expect(page.getByTestId("filter-publish")).toHaveCount(0);
  await expect(rows.locator("> li")).toHaveCount(5);
  await expect(rows).not.toContainText(waiting.title);
  const row = (id: string) => page.getByTestId(`comms-row-${id}`);
  await expect(row(late.id)).toContainText("late");
  await expect(row(review.id).locator('[aria-current="step"]')).toHaveText(/In review$/);
  await expect(row(review.id).getByRole("link", { name: "Review", exact: true })).toHaveAttribute("href", `/events/${review.id}/description?from=comms`);
  // The track: approved is done, pretix comes before the advertising; no Publish button, no ESN Activities.
  await expect(row(approved.id).locator('[aria-current="step"]')).toHaveText(/pretix page$/);
  await expect(row(approved.id).getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(row(approved.id).getByTestId("stage-track")).not.toContainText("ESN Activities");
  await expect(row(pretixOne.id).getByRole("link", { name: "Set up pretix", exact: true })).toHaveAttribute("href", `/team/comms/pretix?event=${pretixOne.id}#pretix-${pretixOne.id}`);
  await expect(row(advertiseOne.id).locator('[aria-current="step"]')).toHaveText(/Advertised$/);
  await expect(row(advertiseOne.id).getByRole("link", { name: "Advertise", exact: true })).toBeVisible();

  // No reminder button: the OC is reminded automatically (round 2026-11-03).
  await expect(row(late.id).getByTestId("row-action")).toHaveText("The OC writes it – reminded automatically");
  await page.getByTestId("filter-waiting").click();
  await expect(rows).toContainText(waiting.title);
  await expect(row(waiting.id)).toContainText("Advertised – the event is on");
  await expect(page).toHaveURL(new RegExp(`month=${month}&show=waiting`));

  // Switching months: the arrow, the list; the choice is remembered.
  await page.getByTestId("month-arrow-next").click();
  await expect(page).toHaveURL(new RegExp(`month=${other}`));
  await expect(page.getByTestId("comms-rows")).toContainText(nextYear.title);
  await page.getByLabel("Month", { exact: true }).selectOption(month);
  await expect(page).toHaveURL(new RegExp(`month=${month}`));
  await page.goto("/team/comms");
  await expect(page).toHaveURL(new RegExp(`month=${month}`));

  // Phones: the track is the current stage and "n of 7"; nothing scrolls sideways.
  await as(USERS.comms);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/team/comms?month=${month}&show=all`);
  await expect(row(review.id).getByTestId("stage-compact")).toHaveText("In review 2 of 7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await admin.from("publication_posts").delete().in("id", ((await admin.from("publication_post_events").select("post_id").in("event_id", [advertiseOne.id, waiting.id])).data ?? []).map((r) => r.post_id));
  await admin.from("fake_chat_messages").delete().like("text", `%${tag}%`);
});

test("Events: the month's overview, every month's open steps, planning a new month", async ({ page, as }) => {
  const month = freshMonth();
  const tag = Math.random().toString(36).slice(2, 7);
  const { data: cycle } = await admin.from("planning_cycles").insert({ month: `${month}-01`, status: "confirmed", created_by: TEST_TAG }).select("id").single();
  const short = await createEvent({ title: `Short ${tag}`, cycle_id: cycle!.id, starts_at: `${month}-08T18:00:00Z`, oc: USERS.oc, helpers: [], helpers_needed: 2 });
  const full = await createEvent({ title: `Full ${tag}`, cycle_id: cycle!.id, starts_at: `${month}-09T18:00:00Z`, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  await admin.from("descriptions").upsert({ event_id: full.id, status: "submitted" });

  // ?month= opens the month on its current step's tab (round 2026-11-03).
  await as(USERS.events);
  await page.goto(`/team/events?month=${month}`);
  await page.waitForURL(new RegExp(`/team/events/cycles/${cycle!.id}/descriptions$`));
  await expect(page.getByTestId("cycle-stepper").locator('[aria-current="step"]')).toHaveText(/Descriptions\s*by \d+ \w+$/);
  await expect(page.getByTestId(`month-event-${short.id}`).getByTestId("staffing")).toHaveText(`OC ${USERS.oc.name} · 0/2 helpers`);
  await expect(page.getByTestId(`month-event-${full.id}`).getByTestId("description")).toHaveText("Description: Waiting for Comms review");
  await expect(page.getByTestId("cycle-descriptions").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("descriptions-oc")).toContainText(short.title);
  await expect(page.getByTestId("descriptions-comms")).toContainText(full.title);
  // The Events page lists the open step of every month.
  await page.goto("/team/events");
  await expect(page.getByTestId(`todo-${month}-descriptions`)).toContainText("Set the deadline");

  // Executives read the month, without planning.
  await as(USERS.executive);
  await page.goto(`/team/events?month=${month}`);
  await expect(page.getByTestId("cycle-descriptions")).toContainText(full.title);
  await page.goto("/team/events");
  await expect(page.getByRole("link", { name: "+ Plan a new month" })).toHaveCount(0);

  // Planning the next month starts from the Events page.
  await as(USERS.events);
  await page.goto("/team/events");
  await page.getByRole("link", { name: "+ Plan a new month" }).click();
  await expect(page.getByTestId("new-cycle")).toBeVisible();
  await expect(page.getByLabel("New cycle: events in")).toBeVisible();
});
