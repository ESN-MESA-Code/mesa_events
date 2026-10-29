// "Get inspired" on /ideas (brief 2026-10-29, D): a member searches previous
// events (the bot archive fixture, imported for the test), sees repeats
// grouped, and proposes one again with the form prefilled.
import { readFileSync } from "node:fs";
import { TEST_TAG, USERS, admin } from "../helpers/local";
import { importArchive, recordsFromFile } from "../../scripts/bot-archive.mjs";
import { expect, test } from "./fixtures";

const FIXTURE = "tests/fixtures/bot-archive/WiSe_25-26.csv";
const refs = ["spaces/TESTARCHIVEQUIZ1", "spaces/TESTARCHIVEHIKE1", "spaces/TESTARCHIVEQUIZ2"];

test("Get inspired → Propose this again", async ({ page, as }) => {
  await admin.from("events").delete().in("archive_ref", refs);
  // Renamed, so the demo history (which has its own Pub Quiz runs) does not join the group.
  const records = recordsFromFile(FIXTURE, readFileSync(FIXTURE, "utf8")).map((r: { title: string }) => ({ ...r, title: r.title.replace("Pub Quiz", "Zebraquiz") }));
  await importArchive(admin, records, { createdBy: TEST_TAG });

  await as(USERS.member);
  await page.goto("/ideas");
  const results = page.getByTestId("inspiration-results");
  await page.getByLabel("Search previous events").fill("herzogstand");
  await expect(results.locator("> li")).toHaveCount(1);
  await expect(results).toContainText("Hike to the Herzogstand");
  await expect(results).toContainText("Day trip");

  await page.getByLabel("Search previous events").fill("zebraquiz");
  const quiz = results.locator("> li", { hasText: "Zebraquiz #2" });
  await expect(quiz).toContainText("+1 earlier");
  await expect(quiz).toContainText("ran 2 times");
  await quiz.getByRole("button", { name: "+1 earlier" }).click();
  await expect(quiz.getByTestId("earlier-runs")).toContainText("Zebraquiz");
  // Only what members may read: no names, no claims.
  await expect(results).not.toContainText("pr@esnmesa.org");

  // Filters: November only, big turnout.
  await page.getByLabel("Time of year").selectOption({ label: "November" });
  await expect(results).not.toContainText("Zebraquiz #2");
  await page.getByLabel("Big turnout").check();
  await expect(results.locator("> li", { hasText: "Zebraquiz" })).toContainText("39 people");
  await page.getByLabel("Big turnout").uncheck();
  await page.getByLabel("Time of year").selectOption({ label: "Any time of year" });

  await quiz.getByRole("button", { name: "Propose this again" }).click();
  const form = page.getByTestId("idea-form");
  await expect(form.getByLabel("Title")).toHaveValue("Zebraquiz");
  await expect(form.getByLabel("Pitch")).toHaveValue(/Round two of trivia\.[\s\S]*Ran before: 2026-03-04, 2025-11-06/);
  await expect(form.getByLabel("Date")).toHaveValue(/^\d{4}-03-\d{2}$/);
  await expect(form.getByLabel(/^Type/)).toHaveValue("standard");
  // A test date far ahead, so the cleanup takes the idea away.
  await form.getByLabel("Date").fill("2099-03-05");
  await form.getByRole("button", { name: "Propose idea" }).click();
  await expect(page.getByTestId("my-ideas")).toContainText("Zebraquiz");

  await admin.from("events").delete().in("archive_ref", refs);
});
