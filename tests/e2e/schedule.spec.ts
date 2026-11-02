// The publishing schedule (brief 2026-10-29, E3; round 2026-10-31): drag an
// event's channel chip from the list onto a day of the month calendar, plan
// one with the keyboard alternative, bundle a second event into a post, tick
// pretix off, mark an Instagram post published, confirm a Telegram post
// after its preview and see it publish itself through the job runner.
import { TEST_TAG, USERS, admin, createEvent } from "../helpers/local";
import { answerConfirm, drag, expect, freshMonth, runJobs, test } from "./fixtures";
import { addMonths, monthLabel } from "@/lib/dates";

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
  await page.getByTestId(`chip-instagram-${quiz.id}`).evaluate((el) => el.scrollIntoView({ block: "center" }));
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
  await dialog.getByRole("button", { name: "Mark posted" }).click();
  await dialog.getByLabel("Link of the published post").fill("https://www.instagram.com/p/e2e-test/");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await expect(dialog).toContainText("✓ posted");
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
  await expect(dialog).toContainText("✓ posted");
  await expect(dialog.getByRole("link", { name: "Open the post" })).toHaveAttribute("href", /^https:\/\/t\.me\/mesa_fake_channel\/\d+$/);
  await dialog.getByRole("button", { name: "Close" }).click();
  const { data: post } = await admin.from("publication_posts").select("telegram").eq("id", tgPost!.post_id).single();
  const tg = post!.telegram as { chatId: string; messages: Array<{ textMessageId: number }> };
  const textMessageId = tg.messages[0].textMessageId;
  const { data: msg } = await admin.from("fake_telegram_messages").select("text").eq("chat_id", tg.chatId).eq("message_id", textMessageId).single();
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
  await expect(page.getByTestId("published-on")).toContainText("✓ posted");

  await admin.from("fake_telegram_messages").delete().eq("chat_id", tg.chatId).eq("message_id", textMessageId);
  await admin.from("fake_chat_messages").delete().like("text", `%${tag}%`);
});

// Round 2026-11-02: big events are advertised weeks ahead – the list of a
// month holds the later months' events (big ones first), their posts sit
// on this month's days, and Telegram says why it cannot be confirmed yet.
test("plan posts for a big event two months ahead", async ({ page, as }) => {
  const month = freshMonth();
  const later = addMonths(`${month}-01`, 2).slice(0, 7);
  const tag = Math.random().toString(36).slice(2, 7);
  const trip = await createEvent({ title: `Weekend trip ${tag}`, type: "weekend_trip", status: "scheduled", starts_at: `${later}-14T07:00:00Z`, oc: USERS.oc, helpers_needed: 1 });
  const stammtisch = await createEvent({ title: `Stammtisch ${tag}`, status: "scheduled", starts_at: `${later}-03T18:00:00Z`, oc: USERS.oc, helpers_needed: 1 });
  // The board's month has its own event (a month without events or posts is not offered).
  const quiz = await createEvent({ title: `Quiz ${tag}`, starts_at: `${month}-25T18:00:00Z`, oc: USERS.oc, helpers_needed: 1 });

  await as(USERS.comms);
  await page.goto(`/team/comms/schedule?month=${month}`);
  const list = page.getByTestId("tray");
  await expect(list.getByTestId(`tray-${quiz.id}`)).toBeVisible();
  const group = list.getByTestId(`tray-later-${later}`);
  await expect(group).toContainText(`Coming up: ${monthLabel(`${later}-01`)}`);
  // The trip is big: it leads its month.
  await expect(group.getByTestId(`tray-${trip.id}`)).toContainText("big");
  const order = await group.locator('li[data-testid^="tray-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(order.indexOf(`tray-${trip.id}`)).toBeLessThan(order.indexOf(`tray-${stammtisch.id}`));

  // Its Telegram chip onto a day of this month, weeks before the trip.
  // (Centred first: from the bottom of the list the window would scroll while dragging.)
  await page.getByTestId(`chip-telegram-${trip.id}`).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await drag(page, page.getByTestId(`chip-telegram-${trip.id}`), page.getByTestId(`day-${month}-15`));
  const tgChip = page.getByTestId(`day-${month}-15`).locator('[data-testid^="post-"]');
  await expect(tgChip).toContainText(trip.title);
  await expect(page.getByTestId(`coverage-${trip.id}`)).toContainText("TG ⏰");
  // No description yet: planned, but nothing to confirm.
  await tgChip.locator("button").click();
  const dialog = page.getByTestId("post-dialog");
  await expect(dialog.getByTestId("telegram-refusal")).toContainText(`The description of “${trip.title}” is not approved yet.`);
  await expect(dialog.getByRole("button", { name: /^Confirm for / })).toBeHidden();
  await expect(dialog).toContainText("d before");
  await dialog.getByRole("button", { name: "Close" }).click();

  // The keyboard way, on a day of the month after this one: it lands there.
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  await group.getByTestId(`tray-${trip.id}`).locator("summary", { hasText: "Plan…" }).click();
  await page.getByLabel(`Channel for ${trip.title}`).selectOption({ label: "Instagram" });
  await page.getByLabel(`Day for ${trip.title}`).fill(`${next}-20`);
  await expect(group.getByTestId(`tray-${trip.id}`)).toContainText(`That day is on the ${monthLabel(`${next}-01`)} board.`);
  await page.getByRole("button", { name: "Plan the post" }).click();
  await expect(page.getByTestId(`coverage-${trip.id}`)).toContainText("IG ⏰");
  await page.goto(`/team/comms/schedule?month=${next}`);
  await expect(page.getByTestId(`day-${next}-20`).locator('[data-testid^="post-"]')).toContainText(trip.title);

  await admin.from("publication_posts").delete().in("id", ((await admin.from("publication_post_events").select("post_id").eq("event_id", trip.id)).data ?? []).map((r) => r.post_id));
  await admin.from("events").delete().in("id", [trip.id, stammtisch.id, quiz.id]);
});

// Round 2026-11-03: a Telegram post opens on its preview – one message per
// event, the picture (added right there) on the first – and is posted from it.
test("a Telegram post of two events: preview with the picture, posted as separate messages", async ({ page, as, baseURL }) => {
  const month = freshMonth();
  const tag = Math.random().toString(36).slice(2, 7);
  const ev = async (title: string, d: number) => {
    const e = await createEvent({ title: `${title} ${tag}`, starts_at: `${month}-${String(d).padStart(2, "0")}T18:00:00Z`, oc: USERS.oc, helpers_needed: 1 });
    await admin.from("descriptions").upsert({ event_id: e.id, status: "approved", fields: fields(e.title), approved_fields: fields(e.title) });
    return e;
  };
  const karaoke = await ev("Karaoke", 12);
  const brunch = await ev("Brunch", 14);
  // Planned as Comms would (create_post checks the Comms role, so straight into the tables here).
  const { data: created } = await admin.from("publication_posts").insert({ channel: "telegram", scheduled_for: `${month}-08T09:00:00Z` }).select("id").single();
  await admin.from("publication_post_events").insert([
    { post_id: created!.id, event_id: karaoke.id, position: 0 },
    { post_id: created!.id, event_id: brunch.id, position: 1 },
  ]);

  await as(USERS.comms);
  await page.goto(`/team/comms/schedule?month=${month}`);
  const chip = page.getByTestId(`day-${month}-08`).locator('[data-testid^="post-"]');
  await chip.locator("button").click();
  const dialog = page.getByTestId("post-dialog");
  // The preview is there at once: two messages, in the post's order.
  const preview = dialog.getByTestId("telegram-preview");
  await expect(preview).toContainText("as 2 messages");
  await expect(preview.getByTestId("telegram-message")).toHaveCount(2);
  await expect(preview.getByTestId("telegram-message").nth(0)).toContainText(karaoke.title);
  await expect(preview.getByTestId("telegram-message").nth(1)).toContainText(brunch.title);

  // The picture is added in the same panel and shows on the first message.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  // Each message has its own button; the karaoke's message gets the picture.
  await expect(preview.getByLabel("Add a picture")).toHaveCount(2);
  await preview.getByTestId("telegram-message").nth(0).getByLabel("Add a picture").setInputFiles({ name: "party.png", mimeType: "image/png", buffer: png });
  await expect(preview.getByTestId("telegram-message").nth(0).getByRole("img", { name: "Picture of the post" })).toBeVisible();
  await expect(preview.getByTestId("telegram-message").nth(0).getByLabel("Replace the picture")).toHaveCount(1);
  await expect(preview.getByTestId("telegram-message").nth(1).getByRole("img")).toHaveCount(0);

  // Posted from the preview.
  await preview.getByRole("button", { name: "Confirm and post now" }).click();
  await answerConfirm(page);
  await expect(page.getByText("Posted to the Telegram channel.")).toBeVisible();
  const { data: pe } = await admin.from("publication_post_events").select("post_id").eq("event_id", karaoke.id).single();
  const { data: version } = await admin.from("publication_posts").select("version").eq("id", pe!.post_id).single();
  await admin.from("jobs").update({ run_after: new Date(Date.now() - 60_000).toISOString() }).eq("idempotency_key", `telegram.publish_post:${pe!.post_id}:${version!.version}`);
  await runJobs(baseURL!);
  const { data: post } = await admin.from("publication_posts").select("status, telegram").eq("id", pe!.post_id).single();
  expect(post!.status).toBe("published");
  const tg = post!.telegram as { chatId: string; messages: Array<{ layout: string; photoMessageId?: number; textMessageId?: number }> };
  expect(tg.messages.map((m) => m.layout)).toEqual(["photo", "text"]);
  const ids = tg.messages.flatMap((m) => [m.photoMessageId, m.textMessageId]).filter((x): x is number => !!x);
  const { data: sent } = await admin.from("fake_telegram_messages").select("kind, text").eq("chat_id", tg.chatId).in("message_id", ids).order("message_id");
  expect(sent!.map((m) => [m.kind, m.text.split("\n")[0]])).toEqual([
    ["photo", `<b>${karaoke.title}</b>`],
    ["text", `<b>${brunch.title}</b>`],
  ]);
  await admin.from("fake_telegram_messages").delete().eq("chat_id", tg.chatId).in("message_id", ids);
});
