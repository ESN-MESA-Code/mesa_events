// ESN Activities (brief 2026-10-29, B): the OC writes the event report on
// the Hand-in tab, the event becomes "Ready to upload", the executive board
// (round 2026-10-30; it was Comms) pastes the saved activity's link by hand,
// the space is told; personal access tokens are shown once and can be revoked.
import { USERS, admin, createEvent, deleteEvent, hoursFromNow } from "../helpers/local";
import { answerConfirm, expect, runJobs, signInAs, test } from "./fixtures";

const fields = {
  title: "E2E ESN quiz",
  dateIso: "2026-11-02",
  time: "19:00",
  venue: "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich",
  price: "free",
  hook: "a night of trivia",
  intro: "Teams battle it out. Prizes!",
  program: "Six rounds",
  bring: "A pen",
  closing: "see you there",
  esnType: "10",
  esnObjectives: "413,426",
  esnGoal: "Bring internationals and locals together over a quiz night.",
};

test("report → ready to upload → link pasted by an executive → uploaded", async ({ page, context, baseURL }) => {
  const tag = Math.random().toString(36).slice(2, 7);
  const event = await createEvent({ title: `ESN quiz ${tag}`, starts_at: hoursFromNow(-26), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  const space = `spaces/FAKEE2EESN${tag.toUpperCase()}`;
  await admin.from("events").update({ chat_space_name: space }).eq("id", event.id);
  await admin.from("descriptions").upsert({ event_id: event.id, status: "published", fields, approved_fields: fields, published_at: new Date().toISOString() });
  await admin.from("attendance_lists").update({ signed_off_at: new Date().toISOString(), signed_off_by: USERS.oc.email, headcount: 28 }).eq("event_id", event.id);

  // An executive first: not ready, the report is missing.
  await signInAs(context, baseURL!, USERS.executive);
  await page.goto(`/events/${event.id}/hand-in`);
  const esn = page.locator("#esn-activities");
  await expect(esn.getByTestId("esn-status")).toContainText("Not ready");
  await expect(esn.getByTestId("esn-missing")).toContainText("event report");

  // The OC writes the report (prefilled from the list and the roster).
  await signInAs(context, baseURL!, USERS.oc);
  await page.goto(`/events/${event.id}/hand-in`);
  await expect(page.getByTestId("report-status")).toContainText("not written yet");
  const form = page.getByTestId("event-report-form");
  await expect(form.getByLabel("International participants")).toHaveValue("28");
  await expect(form.getByLabel("Organizers / volunteers")).toHaveValue("2");
  await form.getByLabel("What went well?").fill("Great mix of teams, lots of laughs.");
  await form.getByRole("button", { name: "Save the report" }).click();
  await expect(form.getByText("Thanks! Report saved.")).toBeVisible();
  await expect(page.getByTestId("report-status")).toContainText("written");
  // The OC does not see the upload status (Comms, Events and executives only).
  await expect(page.locator("#esn-activities")).toHaveCount(0);

  // The executive: ready; the ESN form link carries the event; the link is pasted by hand.
  await signInAs(context, baseURL!, USERS.executive);
  await page.goto(`/events/${event.id}/hand-in`);
  await expect(esn.getByTestId("esn-status")).toContainText("Ready to upload");
  await expect(esn.getByTestId("open-esn-form")).toHaveAttribute("href", `https://activities.esn.org/add/physical-activity#mesa=${event.id}`);
  await esn.getByRole("button", { name: "Paste link" }).click();
  await esn.getByLabel("ESN activity link").fill("https://example.com/not-esn");
  await esn.getByRole("button", { name: "Mark uploaded" }).click();
  await expect(esn.getByText("Paste the link of the saved activity")).toBeVisible();
  await esn.getByLabel("ESN activity link").fill(`https://activities.esn.org/activity/esn-quiz-${tag}-123`);
  await esn.getByRole("button", { name: "Mark uploaded" }).click();
  await expect(esn.getByTestId("esn-status")).toContainText("Uploaded");
  await expect(esn.getByRole("link", { name: "View on ESN Activities" })).toHaveAttribute("href", `https://activities.esn.org/activity/esn-quiz-${tag}-123`);
  await expect(esn.getByTestId("esn-status")).toContainText("executive@esnmesa.org");

  await runJobs(baseURL!);
  const { data: messages } = await admin.from("fake_chat_messages").select("text").eq("space", space);
  expect(messages!.map((m) => m.text)).toContain(`<users/all> 📢 The executive board has uploaded *ESN quiz ${tag}* on ESN Activities. <https://activities.esn.org/activity/esn-quiz-${tag}-123|Open>`);
  await admin.from("fake_chat_messages").delete().eq("space", space);
});

test("ESN Activities page: a token is shown once and can be revoked; others are sent away", async ({ page, context, baseURL }) => {
  // Members and Comms are sent away; the old address leads to the new page.
  for (const u of [USERS.member, USERS.comms]) {
    await signInAs(context, baseURL!, u);
    await page.goto("/team/comms/esn-activities");
    await expect(page).toHaveURL(/\/no-access/);
  }

  await signInAs(context, baseURL!, USERS.executive);
  await page.goto("/team/esn-activities");
  const label = `E2E ${Math.random().toString(36).slice(2, 7)}`;
  await page.getByLabel("Name").fill(label);
  await page.getByRole("button", { name: "Create token" }).click();
  const value = page.getByTestId("new-token-value");
  await expect(value).toHaveText(/^mesa_esn_[A-Za-z0-9_-]{43}$/);
  const token = (await value.textContent())!;
  await expect(page.getByTestId("new-token").getByLabel("Browser script")).toHaveValue(new RegExp(`const EMBEDDED_TOKEN = '${token}';`));

  // After a reload it is gone for good; the list shows only its start.
  await page.reload();
  await expect(page.getByTestId("new-token")).toHaveCount(0);
  const row = page.getByTestId("esn-tokens").locator("li", { hasText: label });
  await expect(row).toContainText(token.slice(0, 13));
  await expect(row).not.toContainText(token);
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Revoke" }).click();
  await answerConfirm(page);
  await expect(row).toContainText("revoked");

  const res = await fetch(`${baseURL}/api/esn/events/${crypto.randomUUID()}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(401);
  await admin.from("esn_access_tokens").delete().eq("label", label);
});

test("the OC enters the address: Germany and München by default, the city from the postal code", async ({ page, context, baseURL }) => {
  const event = await createEvent({ title: `Address ${Math.random().toString(36).slice(2, 7)}`, starts_at: hoursFromNow(72), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  await signInAs(context, baseURL!, USERS.oc);
  await page.goto(`/events/${event.id}`);
  await page.getByRole("button", { name: "Edit details" }).click();
  const fields = page.getByTestId("address-fields");
  await expect(fields.getByLabel("Country")).toHaveValue("DE");
  await expect(fields.getByLabel("City")).toHaveValue("München");
  await fields.getByLabel("Location name").fill("Boulderwelt Ost");

  // Not yet complete: the save is refused field by field.
  await fields.getByLabel("Street and house number").fill("Hanne-Hiob-Straße");
  await fields.getByLabel("Postal code").fill("8167");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(fields).toContainText("Add the house number");
  await expect(fields).toContainText("Not a postal code of Germany");

  // The postal code fills in the city.
  await fields.getByLabel("City").fill("");
  await fields.getByLabel("Street and house number").fill("Hanne-Hiob-Straße 4");
  await fields.getByLabel("Postal code").fill("81671");
  await expect(fields.getByLabel("City")).toHaveValue("München");
  await expect(fields).toContainText("✓ München");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("event-location")).toHaveText("Boulderwelt Ost (Hanne-Hiob-Straße 4, 81671 München)");
});

test("the address search fills in venue, street, postal code and city, verified (round 2026-10-30)", async ({ page, context, baseURL }) => {
  const event = await createEvent({ title: `Search ${Math.random().toString(36).slice(2, 7)}`, starts_at: hoursFromNow(72), oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  await signInAs(context, baseURL!, USERS.oc);
  await page.goto(`/events/${event.id}`);
  await page.getByRole("button", { name: "Edit details" }).click();
  const fields = page.getByTestId("address-fields");
  // The E2E server uses the built-in place list (ADDRESS_LOOKUP=fake).
  await fields.getByRole("combobox", { name: "Search a place or address" }).fill("hofbräu");
  await fields.getByTestId("address-suggestions").getByRole("button", { name: /Hofbräuhaus/ }).click();
  // The box keeps the chosen place, marked verified; the fields fold away.
  await expect(fields.getByRole("combobox", { name: "Search a place or address" })).toHaveValue("Hofbräuhaus, Platzl 9, 80331 München");
  await expect(fields.getByTestId("address-verified-chip")).toBeVisible();
  // Typed by hand: unknown addresses are refused on save.
  await fields.getByRole("button", { name: "Edit by hand" }).click();
  await fields.getByLabel("Street and house number").fill("Platzl 9");
  await fields.getByLabel("Postal code").fill("10115");
  await fields.getByLabel("City").fill("Berlin");
  await fields.getByRole("button", { name: "Check address" }).click();
  await expect(fields.getByTestId("address-verification")).toContainText("Address not found");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("This address was not found")).toBeVisible();
  await deleteEvent(event.id);
});
