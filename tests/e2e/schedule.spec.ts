// The publishing schedule (brief 2026-10-29, E3; round 2026-10-31): drag an
// event's channel chip from the list onto a day of the month calendar, plan
// one with the keyboard alternative, bundle a second event into a post, tick
// pretix off, mark an Instagram post published, confirm a Telegram post
// after its preview and see it publish itself through the job runner.
import { TEST_TAG, USERS, admin, createEvent } from "../helpers/local";
import { drag, expect, freshMonth, runJobs, test } from "./fixtures";

const fields = (title: string) => ({ title, dateIso: "2045-01-10", time: "19:00", venue: "Shamrock", price: "5", hook: "a test", intro: "A test event.", program: "Testing", bring: "Nothing", closing: "see you" });

test("plan, bundle, publish by hand and by schedule", async ({ page, as, baseURL }) => {
  const month = freshMonth();
  const tag = Math.random().toString(36).slice(2, 7);
  const { data: cycle } = await admin.from("planning_cycles").insert({ month: `${month}-01`, status: "confirmed", created_by: TEST_TAG }).select("id").single();
  const ev = async (title: string, d: number) => {
    const e = await createEvent({ title: `${title} ${tag}`, cycle_id: cycle!.id, starts_at: `${month}-${String(d).padStart(2, "0")}T18:00:00Z`, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
    await admin.from("descriptions").upsert({ event_id: e.id, status: "approved", fields: fields(e.title), approved_fields: fields(e.title) });
    return e;
  };
  const quiz = await ev("Quiz", 20);
  const hike = await ev("Hike", 22);
  await admin.from("events").update({ chat_space_name: `spaces/FAKESCHED${tag.toUpperCase()}` }).eq("id", quiz.id);

  await as(USERS.comms);
  await page.goto(`/team/comms/schedule?month=${month}`);
  const list = page.getByTestId("tray");
  await expect(list).toContainText(quiz.title);
  // The events show on the day they take place.
  await expect(page.getByTestId(`day-${month}-20`).getByTestId(`cal-event-${quiz.id}`)).toBeVisible();

  // Drag: the quiz's Telegram chip onto the 3rd.
  await drag(page, page.getByTestId(`chip-telegram-${quiz.id}`), page.getByTestId(`day-${month}-03`));
  const third = page.getByTestId(`day-${month}-03`);
  const tgChip = third.locator('[data-testid^="post-"]');
  await expect(tgChip).toContainText(quiz.title);
  // Not confirmed yet: it would not go out.
  await expect(tgChip).toContainText("TG 10:00 ⏸");
  await expect(page.getByTestId(`coverage-${quiz.id}`)).toContainText("TG ⏰");
  // Its details open with the preview; confirm after a look.
  await tgChip.locator("button").click();
  const dialog = page.getByTestId("post-dialog");
  await expect(dialog.getByTestId("telegram-preview")).toContainText(quiz.title);
  await dialog.getByRole("button", { name: /^Confirm for / }).click();
  await expect(dialog).toContainText("⏰ 10:00 · confirmed");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(tgChip).toContainText("TG 10:00 ⏰");

  // The keyboard way: the hike on Instagram on the 5th.
  await list.getByTestId(`tray-${hike.id}`).locator("summary", { hasText: "Plan…" }).click();
  await page.getByLabel(`Channel for ${hike.title}`).selectOption({ label: "Instagram" });
  await page.getByLabel(`Day for ${hike.title}`).fill(`${month}-05`);
  await page.getByRole("button", { name: "Plan the post" }).click();
  const fifth = page.getByTestId(`day-${month}-05`);
  const igPost = fifth.locator('[data-testid^="post-"]');
  await expect(igPost).toContainText(hike.title);

  // Bundle: the quiz's Instagram chip dropped onto the hike's post.
  await drag(page, page.getByTestId(`chip-instagram-${quiz.id}`), igPost);
  await expect(igPost).toContainText("2:");
  await expect(igPost).toContainText(quiz.title);
  // A Telegram chip on an Instagram post: no.
  await drag(page, page.getByTestId(`chip-telegram-${hike.id}`), igPost);
  await expect(page.getByText("That post is on Instagram", { exact: false })).toBeVisible();

  // pretix is a tick, not a post.
  await expect(page.getByTestId("schedule-board")).not.toContainText("pretix");
  await list.getByLabel(`pretix page of ${hike.title} is up`).check();
  await expect(list.getByTestId(`pretix-${hike.id}`)).toContainText("pretix page is up ✓");
  await list.getByLabel(`pretix link of ${hike.title}`).fill("https://pretix.eu/esnmesa/e2e-hike/");
  await list.getByTestId(`pretix-${hike.id}`).getByRole("button", { name: "Save" }).click();
  await expect(list.getByTestId(`pretix-${hike.id}`).getByRole("link", { name: "open" })).toHaveAttribute("href", "https://pretix.eu/esnmesa/e2e-hike/");

  // Instagram is published by hand: the link.
  await igPost.locator("button").click();
  await dialog.getByRole("button", { name: "Mark published" }).click();
  await dialog.getByLabel("Link of the published post").fill("https://www.instagram.com/p/e2e-test/");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await expect(dialog).toContainText("✓ published");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(igPost).toContainText("IG 10:00 ✓");

  // The Telegram post's time comes (time travel: its job is due now) – it publishes itself.
  const { data: tgPost } = await admin.from("publication_post_events").select("post_id, publication_posts!inner(channel, version)").eq("event_id", quiz.id).eq("publication_posts.channel", "telegram").single();
  const version = (tgPost!.publication_posts as { version: number }).version;
  await admin.from("jobs").update({ run_after: new Date(Date.now() - 60_000).toISOString() }).eq("idempotency_key", `telegram.publish_post:${tgPost!.post_id}:${version}`);
  await runJobs(baseURL!);
  await page.reload();
  await expect(tgChip).toContainText("TG 10:00 ✓");
  await tgChip.locator("button").click();
  await expect(dialog).toContainText("✓ published");
  await expect(dialog.getByRole("link", { name: "Open the post" })).toHaveAttribute("href", /^https:\/\/t\.me\/mesa_fake_channel\/\d+$/);
  await dialog.getByRole("button", { name: "Close" }).click();
  const { data: post } = await admin.from("publication_posts").select("telegram").eq("id", tgPost!.post_id).single();
  const tg = post!.telegram as { chatId: string; textMessageId: number };
  const { data: msg } = await admin.from("fake_telegram_messages").select("text").eq("chat_id", tg.chatId).eq("message_id", tg.textMessageId).single();
  expect(msg!.text.startsWith(`<b>${quiz.title}</b>`)).toBe(true);

  // The Comms row and the event page show where the quiz is out.
  await page.goto(`/team/comms?month=${month}&show=all`);
  await expect(page.getByTestId(`comms-row-${quiz.id}`).getByTestId("channel-chips")).toContainText("Telegram ✓");
  await expect(page.getByTestId(`comms-row-${quiz.id}`).getByTestId("channel-chips")).toContainText("Instagram ✓");
  await expect(page.getByTestId(`comms-row-${hike.id}`).getByTestId("channel-chips")).toContainText("pretix ✓");
  await page.getByTestId("channel-filters").getByRole("link", { name: "Telegram" }).click();
  await expect(page.getByTestId("comms-rows")).toContainText(hike.title);
  await expect(page.getByTestId("comms-rows")).not.toContainText(quiz.title);
  await as(USERS.oc);
  await page.goto(`/events/${quiz.id}`);
  await expect(page.getByTestId("published-on")).toContainText("Telegram");
  await expect(page.getByTestId("published-on")).toContainText("✓ published");

  await admin.from("fake_telegram_messages").delete().eq("chat_id", tg.chatId).eq("message_id", tg.textMessageId);
  await admin.from("fake_chat_messages").delete().like("text", `%${tag}%`);
});
