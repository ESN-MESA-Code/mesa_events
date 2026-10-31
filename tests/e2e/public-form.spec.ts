// The public attendance form participants open from the QR code (desktop
// and phone), and kiosk mode on the OC's device (from MESAttendance).
import type { Page } from "@playwright/test";
import { NOTICE_VERSION, TERMS_VERSION } from "../../lib/legal";
import { USERS, admin, createEvent, hoursFromNow } from "../helpers/local";
import { expect, signInAs, test } from "./fixtures";

const created: string[] = [];
test.afterAll(async () => {
  if (created.length) await admin.from("events").delete().in("id", created);
});

async function openList(title: string, startsInHours = 0) {
  const ev = await createEvent({ title, starts_at: hoursFromNow(startsInHours), oc: USERS.oc, helpers: [USERS.helper] });
  created.push(ev.id);
  const { data } = await admin.from("attendance_lists").select("public_token").eq("event_id", ev.id).single();
  return { id: ev.id, token: data!.public_token };
}

async function fillForm(page: Page, first = "Erika", last = "Mustermann") {
  await page.locator('input[name="first_name"]').fill(first);
  await page.locator('input[name="last_name"]').fill(last);
  const country = page.getByRole("combobox");
  await country.fill("Ital");
  await page.getByRole("option", { name: "Italy" }).click();
  await page.getByRole("radiogroup", { name: "University" }).getByRole("radio", { name: "TUM" }).check();
  await page.getByRole("radiogroup", { name: "Exchange programme" }).getByRole("radio", { name: "Erasmus+" }).check();
  await page.getByRole("radiogroup", { name: "ESNcard" }).getByRole("radio", { name: "Yes" }).check();
}

async function acceptAndSubmit(page: Page) {
  await page.getByRole("checkbox", { name: /I accept the participation terms/ }).check();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("signs in with the notice and terms versions; answers only counted", async ({ page }) => {
  const ev = await openList(`Form test ${Date.now()}`);
  await page.goto(`/event/${ev.token}`);
  await expect(page.getByRole("heading", { name: /Form test/ })).toBeVisible();
  await fillForm(page);
  await acceptAndSubmit(page);
  await expect(page.getByText("Thank you!")).toBeVisible();

  const { data: rows } = await admin.from("participants").select("*").eq("event_id", ev.id);
  expect(rows).toHaveLength(1);
  expect(rows![0]).toMatchObject({ first_name: "Erika", entry_method: "self", notice_version: NOTICE_VERSION, terms_version: TERMS_VERSION });
  const { data: stats } = await admin.from("event_stats").select("question, answer, total").eq("event_id", ev.id);
  expect(stats).toEqual(expect.arrayContaining([{ question: "nationality", answer: "IT", total: 1 }]));
});

test("a list that is not open yet, or closed, takes no sign-ins", async ({ page }) => {
  const later = await openList(`Later ${Date.now()}`, 5);
  await page.goto(`/event/${later.token}`);
  await expect(page.getByRole("heading", { name: "Sign-ins are not open yet" })).toBeVisible({ timeout: 30_000 });
  const done = await openList(`Done ${Date.now()}`, -30);
  await page.goto(`/event/${done.token}`);
  await expect(page.getByRole("heading", { name: "Sign-ins are closed" })).toBeVisible();
  await page.goto(`/event/${"0".repeat(32)}`);
  await expect(page.getByText("Event not found.")).toBeVisible();
});

test("the OC sees the name live and signs the list off; kiosk records under their email", async ({ page, context, baseURL, browser }, info) => {
  test.skip(info.project.name === "phone", "The organiser part runs on desktop; participants are covered on the phone above.");
  const ev = await openList(`Live list ${Date.now()}`);
  await signInAs(context, baseURL!, USERS.oc);
  await page.goto(`/events/${ev.id}/attendance`);
  await expect(page.getByTestId("list-state")).toHaveText("Open for sign-ins");

  // A participant on their own phone (another browser context).
  const visitor = await browser.newContext();
  const form = await visitor.newPage();
  await form.goto(`/event/${ev.token}`);
  await fillForm(form, "Live", "Person");
  await acceptAndSubmit(form);
  await expect(form.getByText("Thank you!")).toBeVisible();
  await visitor.close();
  await expect(page.getByRole("cell", { name: "Live", exact: true })).toBeVisible({ timeout: 20_000 });

  // Kiosk on the OC's device.
  await page.getByRole("link", { name: "Sign in on this device" }).click();
  await expect(page.getByText(`Signed in as ${USERS.oc.email}`)).toBeVisible();
  await fillForm(page, "Kiosk", "Person");
  await acceptAndSubmit(page);
  await expect(page.getByText("Please hand the device back")).toBeVisible();
  const { data } = await admin.from("participants").select("entry_method, recorded_by").eq("event_id", ev.id).eq("first_name", "Kiosk").single();
  expect(data).toEqual({ entry_method: "kiosk", recorded_by: USERS.oc.email });

  // Sign-off with a headcount.
  await page.goto(`/events/${ev.id}/attendance`);
  await page.getByRole("button", { name: "Finish & sign off" }).click();
  await page.getByRole("spinbutton").fill("3");
  await page.getByRole("button", { name: "Sign off & close sign-ins" }).click();
  await page.getByTestId("confirm-yes").click();
  await expect(page.getByTestId("list-state")).toHaveText("✓ Signed off");
  await expect(page.getByText("The list is closed: only executives see the names now.")).toBeVisible();
});
