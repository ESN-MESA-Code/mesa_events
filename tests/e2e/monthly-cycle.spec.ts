// The whole month across roles, through the UI: idea → schedule → volunteer
// form → allocation → roster adjustment → confirmation → Chat space →
// description with a Comms review → publish → attendance → receipt →
// Finance → paid.
import { TEST_TAG, USERS, admin, hoursFromNow } from "../helpers/local";
import { cycleLabel } from "../../lib/dates";
import { drag, expect, freshMonth, runJobs, signInAs, test, waitSaved } from "./fixtures";

test("a month from idea to paid reimbursement", async ({ page, context, baseURL, browser }) => {
  test.setTimeout(480_000);
  page.on("dialog", (d) => d.accept());
  const month = freshMonth();
  const tag = Math.random().toString(36).slice(2, 7);
  const quiz = `Quiz ${tag}`;
  const hike = `Hike ${tag}`;
  const vendor = `Box office ${tag}`;
  const as = (u: (typeof USERS)[keyof typeof USERS]) => signInAs(context, baseURL!, u);
  const eventId = async (title: string) => (await admin.from("events").select("id").eq("title", title).single()).data!.id;

  await test.step("a member proposes an idea (and will OC it)", async () => {
    await as(USERS.member);
    await page.goto("/ideas");
    await page.locator("#idea-title").fill(quiz);
    await page.locator("#idea-date").fill(`${month}-12`);
    await page.locator("#idea-helpers").fill("2");
    await page.locator("#idea-pitch").fill("Trivia in English, prizes for the top three teams.");
    await page.getByRole("button", { name: "Propose idea" }).click();
    await expect(page.getByTestId("my-ideas")).toContainText(quiz);
    await expect(page.getByTestId("my-ideas")).toContainText("Waiting for Events");
  });

  let cycleUrl = "";
  await test.step("Events builds the month's schedule", async () => {
    await as(USERS.events);
    await page.goto("/team/events");
    // "+ Plan a new month" sits in the month list (brief 2026-10-29, C).
    await page.getByLabel("Month", { exact: true }).selectOption({ label: "+ Plan a new month" });
    await page.locator("#cycle-month").fill(month);
    await page.getByRole("button", { name: "Start planning" }).click();
    await page.waitForURL(/\/team\/events\/cycles\/[0-9a-f-]{36}$/);
    cycleUrl = page.url();

    const card = page.getByTestId(`idea-${quiz}`);
    await card.getByRole("button", { name: "Accept" }).click();
    await card.getByLabel("Event type").selectOption({ label: "Special" });
    await card.getByRole("button", { name: "Add to schedule" }).click();
    await expect(page.getByTestId("schedule")).toContainText(quiz);

    await page.getByRole("button", { name: "+ Add an event" }).click();
    await page.locator("#new-title").fill(hike);
    await page.locator("#new-type").selectOption({ label: "Day trip" });
    await page.locator("#new-start").fill(`${month}-20T08:00`);
    await page.locator("#new-helpers").fill("1");
    await page.getByRole("button", { name: "Add event" }).click();
    await expect(page.getByTestId("schedule")).toContainText(hike);

    // The volunteer form has its own page; the cycle's steps lead there (round 2026-10-30).
    await page.getByTestId("cycle-stepper").getByRole("link", { name: "Volunteer form" }).click();
    await page.waitForURL(/\/form$/);
    await page.locator("#form-deadline").fill(`${month}-01T12:00`);
    await page.getByRole("button", { name: "Open volunteer form" }).click();
    await expect(page.getByTestId("form-state")).toContainText("Open");
  });

  await test.step("volunteers fill in the form", async () => {
    const answer = async (user: (typeof USERS)[keyof typeof USERS], picks: Array<[string, string]>, count: number) => {
      await as(user);
      await page.goto("/volunteer");
      const form = page.getByRole("region", { name: `Volunteer form ${cycleLabel(`${month}-01`)}` });
      for (const [label, choice] of picks) await form.getByLabel(label).selectOption({ label: choice });
      await form.getByRole("button", { name: "Submit my answers" }).click();
      const summary = form.getByTestId("volunteer-summary");
      await expect(summary).toContainText("Submitted ✓");
      await expect(summary.getByRole("listitem")).toHaveCount(count);
    };
    await answer(USERS.volunteer1, [[`OC for ${hike}`, "Top choice"], [`Helper for ${quiz}`, "Top choice"]], 2);
    await answer(USERS.volunteer2, [[`Helper for ${quiz}`, "Happy to"], [`Helper for ${hike}`, "Top choice"]], 2);
    await answer(USERS.helper, [[`Helper for ${quiz}`, "Top choice"]], 1);
  });

  await test.step("Events closes the form, allocates, adjusts the roster and confirms", async () => {
    await as(USERS.events);
    await page.goto(`${cycleUrl}/form`);
    await page.getByRole("button", { name: "Close form now" }).click();
    await expect(page.getByTestId("form-state")).toContainText("Closed");
    await page.getByTestId("cycle-next").click();
    await page.waitForURL(/\/roster$/);
    await page.getByRole("button", { name: "Run allocation" }).click();
    await expect(page.getByText(/Allocation done: 5 assignments/)).toBeVisible();

    const quizCard = page.getByTestId(`roster-${quiz}`);
    await expect(quizCard).toContainText("Mia Member");
    await expect(quizCard).toContainText("Vera Volunteer");
    await expect(quizCard).toContainText("Hugo Helper");
    await expect(page.getByTestId(`roster-${hike}`)).toContainText("Victor Volunteer");
    // Move Hugo from the quiz to the hike: drag and drop (the "Move to…" menu is gone).
    // A tall window: both cards in view, away from the edges where dnd-kit scrolls the page.
    await page.setViewportSize({ width: 1280, height: 1600 });
    await drag(page, quizCard.getByText("Hugo Helper"), page.getByLabel(`${hike} helpers`));
    await expect(page.getByTestId(`roster-${hike}`)).toContainText("Hugo Helper");
    await expect(quizCard).toContainText("Short of helpers");
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.getByRole("button", { name: "Confirm roster" }).click();
    await expect(page.getByText("Roster confirmed", { exact: true })).toBeVisible();
  });

  const quizId = await eventId(quiz);
  await test.step("Chat spaces are created by the jobs", async () => {
    // "Roster confirmed" is also a step of the cycle's stepper: wait for the confirmation itself.
    await expect.poll(async () => (await admin.from("events").select("chat_space_requested_at").eq("id", quizId).single()).data?.chat_space_requested_at ?? null).not.toBeNull();
    await runJobs(baseURL!);
    const { data: ev } = await admin.from("events").select("chat_space_name").eq("id", quizId).single();
    const { data: members } = await admin.from("fake_chat_members").select("email").eq("space", ev!.chat_space_name!);
    expect(members!.map((m) => m.email)).toEqual(expect.arrayContaining(["member@esnmesa.org", "volunteer1@esnmesa.org", "comms@esnmesa.org", "events@esnmesa.org"]));
  });

  await test.step("the OC runs the under-staffed event anyway", async () => {
    await as(USERS.member);
    await page.goto(`/events/${quizId}`);
    await expect(page.getByTestId("chat-space")).toContainText("Open the event's Chat space");
    await page.getByTestId("understaffed-banner").getByRole("button", { name: "Run it anyway" }).click();
    await expect(page.getByTestId("event-status")).toHaveText("Confirmed");
  });

  await test.step("the OC writes the description and submits it", async () => {
    await page.goto(`/events/${quizId}/description`);
    // The venue: search the place, pick it – name and address are filled in (round 2026-10-30).
    await page.getByRole("combobox", { name: "Search a place or address" }).fill("shamrock");
    await page.getByTestId("address-suggestions").getByRole("button", { name: /Shamrock Irish Pub/ }).click();
    await expect(page.getByRole("combobox", { name: "Search a place or address" })).toHaveValue("Shamrock Irish Pub, Trautenwolfstraße 6, 80802 München");
    await page.locator("#f-hook").fill("a night of trivia");
    await page.locator("#f-intro").fill("Test your knowledge in teams. Prizes for the best three!");
    await page.locator("#f-program").fill("Six rounds\nPrizes");
    await page.locator("#f-bring").fill("Good mood 😄");
    await page.locator("#f-closing").fill("see you there!");
    await page.locator("#f-esnType").selectOption({ label: "Game or social activity" });
    await page.locator("#f-esnGoal").fill("Bring internationals and locals together over a quiz night.");
    await waitSaved(page);
    await expect(page.getByTestId("char-counter")).toContainText("/ 4,096");
    await expect(page.getByTestId("preview")).toContainText("Are you ready for a night of trivia? 🎉");
    await page.getByRole("button", { name: "Submit for Comms review" }).click();
    await expect(page.getByTestId("description-status")).toHaveText("Waiting for Comms review");
  });

  await test.step("Comms requests changes; the OC fixes and resubmits", async () => {
    await as(USERS.comms);
    await page.goto(`/team/comms?month=${month}`);
    // Needs Comms is the default filter; the review is the row's action.
    await page.getByTestId("comms-rows").locator("li", { hasText: quiz }).getByRole("link", { name: "Review" }).click();
    await page.getByLabel("Review comment").fill("Please add the meeting point.");
    await page.getByRole("button", { name: "Request changes" }).click();
    await expect(page.getByTestId("description-status")).toHaveText("Changes requested");

    await as(USERS.member);
    await page.goto(`/events/${quizId}/description`);
    await expect(page.getByTestId("reviews")).toContainText("Please add the meeting point.");
    await page.locator("#f-important").fill("Meet at the entrance");
    await waitSaved(page);
    await page.getByRole("button", { name: "Submit for Comms review" }).click();
    await expect(page.getByTestId("description-status")).toHaveText("Waiting for Comms review");
  });

  await test.step("Comms approves and publishes to the Chat space with @all", async () => {
    await as(USERS.comms);
    await page.goto(`/events/${quizId}/description`);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("description-status")).toHaveText("Approved – ready to publish");
    await page.getByRole("button", { name: "Publish to the Chat space (@all)" }).click();
    await expect
      .poll(async () => (await admin.from("descriptions").select("publish_requested_at").eq("event_id", quizId).single()).data!.publish_requested_at)
      .not.toBeNull();
    await runJobs(baseURL!);
    await page.reload();
    await expect(page.getByTestId("description-status")).toHaveText("Published");
    const { data: d } = await admin.from("descriptions").select("published_message_name").eq("event_id", quizId).single();
    const { data: msg } = await admin.from("fake_chat_messages").select("text").eq("name", d!.published_message_name!).single();
    expect(msg!.text).toContain("Meet at the entrance");
    expect(msg!.text.endsWith("<users/all>")).toBe(true);
  });

  await test.step("on the day: a participant signs in, the OC signs the list off", async () => {
    // Time travel: the quiz started a quarter of an hour ago (sign-ins open,
    // and the hand-in is open whatever the time of day the test runs). Its
    // cycle is in a far-future test month, so the quiz leaves the cycle
    // (an event without a cycle is valid) instead of sitting in it outside
    // its month (review 2026-10-29 A7); the tag lets the teardown find it.
    await admin.from("events").update({ starts_at: hoursFromNow(-0.25), cycle_id: null, created_by: TEST_TAG }).eq("id", quizId);
    const { data: list } = await admin.from("attendance_lists").select("public_token").eq("event_id", quizId).single();
    const visitor = await browser.newContext();
    const form = await visitor.newPage();
    await form.goto(`/event/${list!.public_token}`);
    await form.locator('input[name="first_name"]').fill("Giulia");
    await form.locator('input[name="last_name"]').fill("Rossi");
    await form.getByRole("checkbox", { name: /I accept the participation terms/ }).check();
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(form.getByText("Thank you!")).toBeVisible();
    await visitor.close();

    await as(USERS.member);
    await page.goto(`/events/${quizId}/attendance`);
    await expect(page.getByRole("cell", { name: "Giulia", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Finish & sign off" }).click();
    await page.getByRole("spinbutton").fill("12");
    await page.getByRole("button", { name: "Sign off & close sign-ins" }).click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("list-state")).toHaveText("✓ Signed off");
  });

  await test.step("a helper registers a receipt with bank details", async () => {
    await as(USERS.volunteer1);
    await page.goto(`/events/${quizId}/hand-in`);
    await page.locator("#r-kind").selectOption({ label: "Ticket / entry fee" });
    await page.locator("#r-amount").fill("20");
    await expect(page.getByTestId("suggestion")).toContainText("€ 10.00");
    await page.locator("#r-vendor").fill(vendor);
    await page.locator("#r-method").selectOption({ label: "Bank transfer" });
    await page.locator("#r-holder").fill("Vera Volunteer");
    await page.locator("#r-iban").fill("DE89 3704 0044 0532 0130 00");
    await page.getByRole("button", { name: "Register receipt" }).click();
    await expect(page.getByText("Registered. Now hand the paper Beleg to Finance.")).toBeVisible();
    await expect(page.getByTestId("my-claims")).toContainText("Beleg not handed in");
  });

  await test.step("Finance receives the Beleg, checks the claim and pays the month's batch", async () => {
    await as(USERS.finance);
    await page.goto("/team/finance");
    const row = page.getByTestId(`claim-${vendor}`);
    await row.getByRole("button", { name: "Beleg received" }).click();
    await expect(row).toContainText("Beleg received");
    await row.getByRole("button", { name: "Check" }).click();
    await expect(row.getByLabel("Amount to pay")).toHaveValue("10.00");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row).toContainText("Checked – waiting for payout");

    const { data: claim } = await admin.from("reimbursements").select("batch_id").eq("event_id", quizId).single();
    await page.goto(`/team/finance/batches/${claim!.batch_id}`);
    await expect(page.getByTestId("transfers")).toContainText("DE89370400440532013000");
    await page.getByRole("button", { name: "Mark batch paid" }).click();
    await expect(page.getByTestId("transfers")).toContainText("deleted after payout");
  });

  await test.step("the helper sees the claim paid", async () => {
    await as(USERS.volunteer1);
    await page.goto("/me");
    await expect(page.getByTestId("my-reimbursements")).toContainText("Paid");
  });
});
