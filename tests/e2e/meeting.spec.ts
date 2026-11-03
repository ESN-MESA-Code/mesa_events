// The meeting point (round 2026-11-02): a hike meets at München Hauptbahnhof
// and happens at the Tegernsee. The OC sets the meeting point in the event's
// details; the event page and the helper's Home show it; a new description
// has it on its own line, and the venue check does not complain about it.
import { USERS, admin, createEvent, deleteEvent, hoursFromNow } from "../helpers/local";
import { expect, signInAs, test } from "./fixtures";

test("the OC sets a meeting point; the event page, the post and the helper's Home show it", async ({ page, context, baseURL, browser }) => {
  const event = await createEvent({ title: `Tegernsee hike ${Math.random().toString(36).slice(2, 7)}`, starts_at: hoursFromNow(72), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  await admin
    .from("events")
    .update({ location: "Bahnhof Tegernsee", address_street: "Bahnhofplatz 1", address_postal_code: "83684", address_city: "Tegernsee" })
    .eq("id", event.id);

  await test.step("the OC enters the meeting point in the details", async () => {
    await signInAs(context, baseURL!, USERS.oc);
    await page.goto(`/events/${event.id}`);
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.getByTestId("meeting-fields")).toHaveCount(0);
    await page.getByLabel("People meet somewhere else first").check();
    const meeting = page.getByTestId("meeting-fields");
    // A time without a place is refused.
    await meeting.getByLabel("Meeting time").fill("08:15");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Name the meeting point for the meeting time")).toBeVisible();
    // The same search as the location (ADDRESS_LOOKUP=fake knows the station).
    await meeting.getByRole("combobox", { name: "Search the meeting point" }).fill("hauptbahnhof");
    await meeting.getByTestId("address-suggestions").getByRole("button", { name: /München Hauptbahnhof/ }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("event-meeting")).toHaveText("München Hauptbahnhof (Bayerstraße 10a, 80335 München) at 08:15");
    // The location stays where the hike happens.
    await expect(page.getByTestId("event-location")).toHaveText("Bahnhof Tegernsee (Bahnhofplatz 1, 83684 Tegernsee)");
  });

  await test.step("a new description has the meeting point on its own line; no venue warning", async () => {
    await page.goto(`/events/${event.id}/description`);
    await expect(page.getByTestId("preview")).toContainText("📍 Bahnhof Tegernsee (Bahnhofplatz 1, 83684 Tegernsee)");
    await expect(page.getByTestId("preview")).toContainText("🤝 Meeting point: München Hauptbahnhof (Bayerstraße 10a, 80335 München) at 08:15");
    await expect(page.getByTestId("meets-elsewhere")).toBeChecked();
    await expect(page.getByTestId("venue-mismatch")).toHaveCount(0);
    await expect(page.getByTestId("meeting-mismatch")).toHaveCount(0);
    // Another meeting time in the fields: the post follows, the event too.
    await page.getByTestId("meeting-fields").getByLabel("Meeting time").fill("07:50");
    await expect(page.getByTestId("preview")).toContainText("Meeting point: München Hauptbahnhof (Bayerstraße 10a, 80335 München) at 07:50");
    await expect.poll(async () => (await admin.from("events").select("meeting_time").eq("id", event.id).single()).data?.meeting_time).toBe("07:50:00");
  });

  await test.step("the helper's My events says where to be first", async () => {
    const helper = await browser.newContext();
    await signInAs(helper, baseURL!, USERS.helper);
    const home = await helper.newPage();
    await home.goto("/me");
    await expect(home.getByTestId("helper-info").filter({ hasText: "Bahnhof Tegernsee" })).toContainText("Meet 07:50 at München Hauptbahnhof");
    await helper.close();
  });

  await deleteEvent(event.id);
});
