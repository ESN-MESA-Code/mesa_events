// Roster changes after confirmation: a helper drops out, the slot is open
// to every member, someone claims it, the space and the OC are told.
import { USERS, admin, as as asClient, createEvent, daysFromNow } from "../helpers/local";
import { expect, runJobs, signInAs, test } from "./fixtures";

test("dropout and replacement", async ({ page, context, baseURL }) => {
  page.on("dialog", (d) => d.accept());
  const title = `Karaoke ${Math.random().toString(36).slice(2, 7)}`;
  const ev = await createEvent({ title, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1, starts_at: daysFromNow(9) });
  await (await asClient(USERS.events)).rpc("request_chat_space", { event: ev.id });
  await runJobs(baseURL!);

  await signInAs(context, baseURL!, USERS.helper);
  await page.goto(`/events/${ev.id}`);
  await page.getByRole("button", { name: "Drop out" }).click();
  await page.getByLabel("Reason (optional)").fill("Exam that day");
  await page.getByRole("button", { name: "Drop out as helper" }).click();
  await expect(page.getByTestId("event-status")).toHaveText("Under-staffed");

  // Any member sees the open slot on the calendar and claims it.
  await signInAs(context, baseURL!, USERS.member);
  await page.goto("/calendar");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toContainText("1 helper slot open");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Claim a helper slot (1 open)" }).click();
  await expect(page.getByTestId("roster")).toContainText("Mia Member");
  await expect(page.getByTestId("event-status")).toHaveText("Confirmed");
  await expect(page.getByTestId("open-slots")).toHaveCount(0);
  // Only the OC and the Events team see why someone dropped out (review B2).
  await expect(page.getByText("Exam that day")).toHaveCount(0);

  await runJobs(baseURL!);
  const { data: e } = await admin.from("events").select("chat_space_name").eq("id", ev.id).single();
  const { data: members } = await admin.from("fake_chat_members").select("email").eq("space", e!.chat_space_name!);
  expect(members!.map((m) => m.email)).toContain("member@esnmesa.org");
  expect(members!.map((m) => m.email)).not.toContain("helper@esnmesa.org");
  const { data: dms } = await admin.from("fake_chat_messages").select("text").eq("space", "dm:oc@esnmesa.org").like("text", `%${title}%`);
  const texts = dms!.map((m) => m.text).join("\n");
  expect(texts).toContain("Hugo Helper dropped out as helper");
  expect(texts).toContain("Mia Member took the open helper slot");
  expect(texts).toContain(`${baseURL}/events/${ev.id}`);

  // The OC sees why.
  await signInAs(context, baseURL!, USERS.oc);
  await page.goto(`/events/${ev.id}`);
  await expect(page.getByText(/Dropped out: Hugo Helper \(helper: Exam that day\)/)).toBeVisible();
  await admin.from("events").delete().eq("id", ev.id);
});
