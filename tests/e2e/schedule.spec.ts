// The publishing schedule (brief 2026-10-29, E3): drag an event from the
// tray onto a day, plan one with the keyboard alternative, bundle a second
// event into a post, plan an event on all three channels at once, mark an
// Instagram post published, confirm a Telegram post after its preview and
// see it publish itself through the job runner (round 2026-10-30).
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
  const tray = page.getByTestId("tray");
  await expect(tray).toContainText(quiz.title);

  // Drag: the quiz onto the 3rd in the Telegram lane.
  await drag(page, page.getByTestId(`tray-${quiz.id}`), page.getByTestId(`cell-telegram-${month}-03`));
  const telegramCell = page.getByTestId(`cell-telegram-${month}-03`);
  await expect(telegramCell).toContainText(quiz.title);
  // Not confirmed yet: it would not go out.
  await expect(telegramCell).toContainText("⏸ 10:00 · not confirmed");
  // Still in the tray (not on all channels), now with Telegram planned.
  await expect(page.getByTestId(`coverage-${quiz.id}`)).toContainText("TG ⏰");
  // Confirm after a look at the preview.
  await telegramCell.getByRole("button", { name: "Preview & confirm" }).click();
  await expect(telegramCell.getByTestId("telegram-preview")).toContainText(quiz.title);
  await telegramCell.getByRole("button", { name: /^Confirm for / }).click();
  await expect(telegramCell).toContainText("⏰ 10:00 · confirmed");

  // The keyboard way: the hike on Instagram on the 5th.
  await tray.locator("li", { hasText: hike.title }).locator("summary", { hasText: "Plan…" }).click();
  await page.getByLabel(`Channel for ${hike.title}`).selectOption({ label: "Instagram" });
  await page.getByLabel(`Day for ${hike.title}`).fill(`${month}-05`);
  await page.getByRole("button", { name: "Plan the post" }).click();
  const instagramCell = page.getByTestId(`cell-instagram-${month}-05`);
  await expect(instagramCell).toContainText(hike.title);

  // Bundle: the quiz (still free on Instagram) dropped onto the hike's post.
  const igPost = instagramCell.locator('[data-testid^="post-"]');
  await drag(page, page.getByTestId(`tray-${quiz.id}`), igPost);
  await expect(igPost).toContainText("2 events");
  await expect(igPost).toContainText(quiz.title);

  // All channels at once: the hike dropped on "All channels" gets Telegram and pretix (Instagram it has).
  await drag(page, page.getByTestId(`tray-${hike.id}`), page.getByTestId(`cell-__all-${month}-08`));
  await expect(page.getByTestId(`cell-telegram-${month}-08`)).toContainText(hike.title);
  await expect(page.getByTestId(`cell-pretix-${month}-08`)).toContainText(hike.title);
  await expect(page.getByTestId(`cell-instagram-${month}-08`)).not.toContainText(hike.title);
  await expect(page.getByTestId(`tray-${hike.id}`)).toHaveCount(0);

  // Instagram is published by hand: the link.
  await igPost.getByRole("button", { name: "Mark published" }).click();
  await igPost.getByLabel("Link of the published post").fill("https://www.instagram.com/p/e2e-test/");
  await igPost.getByRole("button", { name: "Save link" }).click();
  await expect(igPost).toContainText("✓ published");

  // The Telegram post's time comes (time travel: its job is due now) – it publishes itself.
  const { data: tgPost } = await admin.from("publication_post_events").select("post_id, publication_posts!inner(channel, version)").eq("event_id", quiz.id).eq("publication_posts.channel", "telegram").single();
  const version = (tgPost!.publication_posts as { version: number }).version;
  await admin.from("jobs").update({ run_after: new Date(Date.now() - 60_000).toISOString() }).eq("idempotency_key", `telegram.publish_post:${tgPost!.post_id}:${version}`);
  await runJobs(baseURL!);
  await page.reload();
  await expect(telegramCell).toContainText("✓ published");
  await expect(telegramCell.getByRole("link", { name: "Open the post" })).toHaveAttribute("href", /^https:\/\/t\.me\/mesa_fake_channel\/\d+$/);
  const { data: post } = await admin.from("publication_posts").select("telegram").eq("id", tgPost!.post_id).single();
  const tg = post!.telegram as { chatId: string; textMessageId: number };
  const { data: msg } = await admin.from("fake_telegram_messages").select("text").eq("chat_id", tg.chatId).eq("message_id", tg.textMessageId).single();
  expect(msg!.text.startsWith(`<b>${quiz.title}</b>`)).toBe(true);

  // The Comms row and the event page show where the quiz is out.
  await page.goto(`/team/comms?month=${month}&show=all`);
  await expect(page.getByTestId(`comms-row-${quiz.id}`).getByTestId("channel-chips")).toContainText("Telegram ✓");
  await expect(page.getByTestId(`comms-row-${quiz.id}`).getByTestId("channel-chips")).toContainText("Instagram ✓");
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
