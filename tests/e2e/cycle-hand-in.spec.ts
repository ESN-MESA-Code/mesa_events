// A cycle after its events (review 2026-10-29 A4): the stepper moves on from
// the descriptions to Hand-in ("1 of 2 events handed in", what is missing
// where) and to Done; done cycles leave the dashboard cards and the Home
// queue for the collapsed "Past cycles". The cycle is in a past test month,
// so its events really happened – no time travel, no event outside its
// cycle's month (A7).
import { USERS, admin, createEvent, pastTestMonth } from "../helpers/local";
import { cycleLabel } from "../../lib/dates";
import { expect, signInAs, test } from "./fixtures";

test("a past cycle: hand-in, then done", async ({ page, context, baseURL }) => {
  const month = pastTestMonth();
  const { data: cycle } = await admin
    .from("planning_cycles")
    .insert({ month, status: "confirmed", description_deadline: `${month.slice(0, 8)}03T18:00:00Z`, confirmed_at: `${month.slice(0, 8)}01T10:00:00Z` })
    .select("id")
    .single();
  const day = (d: number) => `${month.slice(0, 8)}${String(d).padStart(2, "0")}T18:00:00Z`;
  const tag = Math.random().toString(36).slice(2, 7);
  const done = await createEvent({ title: `Handed in ${tag}`, cycle_id: cycle!.id, status: "completed", starts_at: day(10), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  const open = await createEvent({ title: `Not handed in ${tag}`, cycle_id: cycle!.id, status: "completed", starts_at: day(20), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  const handIn = async (eventId: string) => {
    await admin.from("attendance_lists").update({ signed_off_at: day(21), signed_off_by: USERS.oc.email, headcount: 10 }).eq("event_id", eventId);
    await admin.from("event_photo_folders").upsert({ event_id: eventId, photo_count: 3, counted_at: day(22) });
    await admin.from("event_reports").upsert({ event_id: eventId, intl_participants: 9, organizers: 2, went_well: "Fine." });
  };
  await handIn(done.id);
  const label = cycleLabel(month);

  await signInAs(context, baseURL!, USERS.events);
  await page.goto(`/team/events/cycles/${cycle!.id}`);
  // No description was written, but the events are over: no more reminders.
  await expect(page.getByTestId("cycle-stepper").locator('[aria-current="step"]')).toHaveText(/Hand-in/);
  await expect(page.getByTestId("cycle-next")).toContainText("Remind the OCs of 1 event that is not handed in yet");
  await expect(page.getByTestId("cycle-next")).toContainText("1 of 2 events handed in");
  await expect(page.getByTestId("cycle-next")).not.toContainText("descriptions are missing");
  // The hand-in step has its own page; the next action leads there (round 2026-10-30).
  await page.getByTestId("cycle-next").click();
  await page.waitForURL(/\/hand-in$/);
  const missing = page.getByTestId("hand-in-open");
  await expect(missing).toContainText(`Not handed in ${tag}`);
  await expect(missing).toContainText("missing attendance list, photos, event report");
  await expect(missing).not.toContainText(`Handed in ${tag}`);
  await expect(missing.getByRole("link", { name: `Not handed in ${tag}` })).toHaveAttribute("href", `/events/${open.id}/hand-in?from=cycle:${cycle!.id}`);

  // Still running: the month on the Events page, each event with what is missing.
  await page.goto(`/team/events?month=${month.slice(0, 7)}`);
  await expect(page.getByTestId("month-summary")).toContainText("hand-in · 1 of 2 events handed in");
  await expect(page.getByTestId(`month-event-${open.id}`).getByTestId("handin")).toHaveText("Hand-in: missing attendance list, photos, event report");
  await expect(page.getByTestId(`month-event-${done.id}`).getByTestId("handin")).toHaveText("Hand-in: ✓ handed in");

  await page.goto("/");
  await expect(page.getByTestId("queue-events")).toContainText(label);

  // The last event is handed in: done.
  await handIn(open.id);
  await page.goto(`/team/events/cycles/${cycle!.id}`);
  await expect(page.getByTestId("cycle-next")).toContainText("Every event is handed in – the cycle is done");
  await expect(page.getByTestId("cycle-stepper").locator('[aria-current="step"]')).toHaveCount(0);

  await page.goto(`/team/events?month=${month.slice(0, 7)}`);
  await expect(page.getByTestId("month-next")).toContainText("Every event is handed in");
  await expect(page.getByLabel("Month", { exact: true }).locator(`option[value="${month.slice(0, 7)}"]`)).toHaveText(`${label} · done`);

  await page.goto("/");
  await expect(page.getByTestId("queue-events")).not.toContainText(label);
});
