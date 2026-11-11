// The advertisement board (brief 2026-10-29, E3; one board since round
// 2026-11-09 (5), its popups redesigned 2026-11-10): click a day on an
// event's row to plan a post, plan one from the event's panel, add a second
// event to a post (a bundle), set up the pretix page, mark an Instagram post
// posted, confirm a Telegram post after its preview and see it publish
// itself through the job runner.
import type { Page } from "@playwright/test";
import { TEST_TAG, USERS, admin, createEvent, setAsideTypePictures } from "../helpers/local";
import { answerConfirm, expect, freshMonth, runJobs, test } from "./fixtures";
import { addMonths } from "@/lib/dates";
import { dayDiff } from "@/lib/month";
import { mondayOf } from "@/app/(app)/team/comms/schedule/boardModel";

const fields = (title: string) => ({ title, dateIso: "2045-01-10", time: "19:00", venue: "Shamrock", price: "5", hook: "a test", intro: "A test event.", program: "Testing", bring: "Nothing", closing: "see you" });

// The demo data has mock default pictures for the event types (lib/staging/pictures.ts): set aside
// here, so a post without a picture of its own goes out as text.
let restorePictures: () => Promise<void> = async () => {};
test.beforeAll(async () => {
  restorePictures = await setAsideTypePictures();
});
test.afterAll(async () => {
  await restorePictures();
});

/** A day's width on the board (Board.tsx). */
const COL = 28;

/** Clicks a day on an event's row; the board was opened with ?month=…, so it starts on the Monday of the month's first week. */
async function clickDay(page: Page, month: string, eventId: string, day: string) {
  await page.getByTestId(`row-label-${eventId}`).scrollIntoViewIfNeeded();
  const box = (await page.locator(`[data-track="${eventId}"]`).boundingBox())!;
  await page.mouse.click(box.x + dayDiff(mondayOf(`${month}-01`), day) * COL + COL / 2, box.y + box.height / 2);
}

/** The popover of a day: picks the channel and plans the post. */
async function planInPopover(page: Page, channel: "Telegram" | "Instagram") {
  const popover = page.getByTestId("cell-popover");
  await popover.getByRole("group", { name: "Channel" }).getByRole("button", { name: channel }).click();
  await popover.getByTestId("cell-plan").click();
  await expect(popover).toBeHidden();
}

const markers = (page: Page, eventId: string, channel?: "Telegram" | "Instagram") => page.getByTestId(`tl-row-${eventId}`).locator(channel ? `[data-marker][aria-label*="${channel}"]` : "[data-marker]");

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
  await expect(page.getByTestId(`row-label-${quiz.id}`)).toContainText(quiz.title);
  // Nothing planned yet: both channels are missing on the quiz's row.
  await expect(page.getByTestId(`mark-telegram-${quiz.id}`)).toHaveAttribute("data-tone", "missing");

  // A day on the quiz's row: a Telegram post on the 3rd.
  await clickDay(page, month, quiz.id, `${month}-03`);
  await expect(page.getByTestId("cell-popover")).toContainText(quiz.title);
  await planInPopover(page, "Telegram");
  const tgMarker = markers(page, quiz.id, "Telegram");
  // Not confirmed yet: it would not go out. Planned shows as planned, not as done.
  await expect(tgMarker).toHaveAttribute("aria-label", /10:00 \(not confirmed\)/);
  await expect(page.getByTestId(`mark-telegram-${quiz.id}`)).toHaveAttribute("data-tone", "planned");
  // Its dialog opens with the preview; confirm after a look.
  await tgMarker.click();
  const dialog = page.getByTestId("post-dialog");
  await expect(dialog.getByTestId("telegram-preview")).toContainText(quiz.title, { ignoreCase: true });
  await dialog.getByRole("button", { name: /^Confirm for / }).click();
  await expect(dialog).toContainText("⏰ 10:00 · confirmed");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(tgMarker).toHaveAttribute("aria-label", /10:00 \(planned\)/);

  // From the event's panel: the hike on Instagram on the 5th.
  await page.getByTestId(`row-label-${hike.id}`).click();
  const panel = page.getByTestId("event-panel");
  await panel.getByRole("group", { name: `Channel for ${hike.title}` }).getByRole("button", { name: "Instagram" }).click();
  await panel.getByLabel(`Day for ${hike.title}`).fill(`${month}-05`);
  await panel.getByRole("button", { name: "Plan the post" }).click();
  const igMarker = markers(page, hike.id, "Instagram");
  await expect(igMarker).toHaveAttribute("aria-label", /\(planned\)/);

  // pretix is not a post: it has its own page (round 2026-11-09), linked from the event's panel.
  await expect(page.getByTestId(`pretix-${hike.id}`)).toContainText("pretix page not set up");
  await panel.getByRole("link", { name: /Not set up yet/ }).click();
  await expect(page).toHaveURL(new RegExp(`/team/comms/pretix\\?event=${hike.id}`));
  const pretixRow = page.getByTestId(`pretix-row-${hike.id}`);
  await pretixRow.getByLabel(`pretix link of ${hike.title}`).fill(`https://pretix.eu/esnmesa/e2e-hike-${hike.id.slice(0, 8)}/`);
  await pretixRow.getByRole("button", { name: "Mark set up" }).click();
  await expect(pretixRow.getByTestId("pretix-done-by")).toContainText("Set up by");
  await expect(pretixRow.getByRole("link", { name: "open" })).toHaveAttribute("href", `https://pretix.eu/esnmesa/e2e-hike-${hike.id.slice(0, 8)}/`);
  await page.goto(`/team/comms/schedule?month=${month}`);
  await expect(page.getByTestId(`pretix-${hike.id}`)).toHaveAttribute("data-tone", "done");

  // Bundle: the 5th on the quiz's row has the hike's Instagram post already – the quiz goes into it.
  await clickDay(page, month, quiz.id, `${month}-05`);
  const popover = page.getByTestId("cell-popover");
  await popover.getByRole("group", { name: "Channel" }).getByRole("button", { name: "Instagram" }).click();
  await popover.getByTestId("bundle-options").getByLabel(/Add it to the Instagram post at 10:00/).check();
  await expect(popover.getByTestId("cell-plan")).toHaveText("Add to the post");
  await popover.getByTestId("cell-plan").click();
  await expect(popover).toBeHidden();
  // One post, a marker on both rows.
  await expect(markers(page, quiz.id, "Instagram")).toHaveCount(1);
  await expect(igMarker).toContainText("2");

  // Instagram is posted by hand: the link.
  await igMarker.click();
  await expect(dialog).toContainText("2 events together");
  await dialog.getByRole("button", { name: "Mark posted" }).click();
  await dialog.getByLabel("Link of the published post").fill("https://www.instagram.com/p/e2e-test/");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await expect(dialog).toContainText("✓ posted");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(igMarker).toHaveAttribute("aria-label", /\(posted\)/);
  await expect(page.getByTestId(`mark-instagram-${hike.id}`)).toHaveAttribute("data-tone", "done");

  // The Telegram post's time comes (time travel: its job is due now) – it publishes itself.
  const { data: tgPost } = await admin.from("publication_post_events").select("post_id, publication_posts!inner(channel, version)").eq("event_id", quiz.id).eq("publication_posts.channel", "telegram").single();
  const version = (tgPost!.publication_posts as { version: number }).version;
  await admin.from("jobs").update({ run_after: new Date(Date.now() - 60_000).toISOString() }).eq("idempotency_key", `telegram.publish_post:${tgPost!.post_id}:${version}`);
  await runJobs(baseURL!);
  await page.reload();
  await expect(tgMarker).toHaveAttribute("aria-label", /\(posted\)/);
  await tgMarker.click();
  await expect(dialog).toContainText("✓ posted");
  await expect(dialog.getByRole("link", { name: "Open the post" })).toHaveAttribute("href", /^https:\/\/t\.me\/mesa_fake_channel\/\d+$/);
  await dialog.getByRole("button", { name: "Close" }).click();
  const { data: post } = await admin.from("publication_posts").select("telegram").eq("id", tgPost!.post_id).single();
  const tg = post!.telegram as { chatId: string; messages: Array<{ textMessageId: number }> };
  const textMessageId = tg.messages[0].textMessageId;
  const { data: msg } = await admin.from("fake_telegram_messages").select("text").eq("chat_id", tg.chatId).eq("message_id", textMessageId).single();
  // The title in capitals (description layout B, 2026-11-08).
  expect(msg!.text.startsWith(`<b>${quiz.title.toUpperCase()}</b>`)).toBe(true);

  // The Comms row and the event page show where the quiz is out.
  await page.goto(`/team/comms?month=${month}&show=all`);
  await expect(page.getByTestId(`comms-row-${quiz.id}`).getByTestId("channel-chips")).toContainText("Telegram ✓");
  await expect(page.getByTestId(`comms-row-${quiz.id}`).getByTestId("channel-chips")).toContainText("Instagram ✓");
  // pretix is a stage of its own in the track, not a chip at the foot of the row (round 2026-11-10).
  await expect(page.getByTestId(`comms-row-${hike.id}`).getByTestId("stage-track").locator('li[title^="pretix page"]')).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId(`comms-row-${hike.id}`).getByTestId("channel-chips")).not.toContainText("pretix");
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

// Round 2026-11-02: big events are advertised weeks ahead – the board lists
// them below its window, their posts sit on this month's days, and Telegram
// says why it cannot be confirmed yet. Round 2026-11-10: "big" is the Events
// team's mark (a weekend trip starts with it), not the event's type.
test("plan posts for a big event two months ahead", async ({ page, as }) => {
  const month = freshMonth();
  const later = addMonths(`${month}-01`, 2).slice(0, 7);
  const tag = Math.random().toString(36).slice(2, 7);
  const trip = await createEvent({ title: `Weekend trip ${tag}`, type: "weekend_trip", status: "scheduled", starts_at: `${later}-14T07:00:00Z`, oc: USERS.oc, helpers_needed: 1 });
  const stammtisch = await createEvent({ title: `Stammtisch ${tag}`, status: "scheduled", starts_at: `${later}-03T18:00:00Z`, oc: USERS.oc, helpers_needed: 1 });
  // The board's month has its own event.
  const quiz = await createEvent({ title: `Quiz ${tag}`, starts_at: `${month}-25T18:00:00Z`, oc: USERS.oc, helpers_needed: 1 });

  await as(USERS.comms);
  await page.goto(`/team/comms/schedule?month=${month}`);
  await expect(page.getByTestId(`row-label-${quiz.id}`)).toBeVisible();
  // The trip is big: it has a row although it is beyond the weeks shown; the Stammtisch of that month has none.
  await expect(page.getByTestId("timeline")).toContainText("Later – big events advertised weeks ahead");
  await expect(page.getByTestId(`row-label-${trip.id}`)).toContainText("big");
  await expect(page.getByTestId(`tl-row-${stammtisch.id}`)).toHaveCount(0);
  // The Events team takes the mark off: the row goes; back on: it is there again.
  await admin.from("events").update({ big: false }).eq("id", trip.id);
  await page.reload();
  await expect(page.getByTestId(`row-label-${quiz.id}`)).toBeVisible();
  await expect(page.getByTestId(`tl-row-${trip.id}`)).toHaveCount(0);
  await admin.from("events").update({ big: true }).eq("id", trip.id);
  await page.reload();
  await expect(page.getByTestId(`row-label-${trip.id}`)).toContainText("big");

  // A Telegram post on a day of this month, weeks before the trip.
  await clickDay(page, month, trip.id, `${month}-15`);
  await planInPopover(page, "Telegram");
  const tgMarker = markers(page, trip.id, "Telegram");
  await expect(tgMarker).toHaveCount(1);
  await expect(page.getByTestId(`mark-telegram-${trip.id}`)).toHaveAttribute("data-tone", "planned");
  // No description yet: planned, but nothing to confirm.
  await tgMarker.click();
  const dialog = page.getByTestId("post-dialog");
  await expect(dialog.getByTestId("telegram-refusal")).toContainText(`The description of “${trip.title}” is not approved yet.`);
  await expect(dialog.getByRole("button", { name: /^Confirm for / })).toBeHidden();
  await expect(dialog).toContainText("d before");
  await dialog.getByRole("button", { name: "Close" }).click();

  // From the event's panel, on a day of the month after this one: it lands there.
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  await page.getByTestId(`row-label-${trip.id}`).click();
  const panel = page.getByTestId("event-panel");
  await panel.getByRole("group", { name: `Channel for ${trip.title}` }).getByRole("button", { name: "Instagram" }).click();
  await panel.getByLabel(`Day for ${trip.title}`).fill(`${next}-10`);
  await panel.getByRole("button", { name: "Plan the post" }).click();
  await expect(panel.getByTestId("panel-posts").locator("li")).toHaveCount(2);
  await expect(page.getByTestId(`mark-instagram-${trip.id}`)).toHaveAttribute("data-tone", "planned");
  const { data: planned } = await admin.from("publication_post_events").select("publication_posts!inner(channel, scheduled_for)").eq("event_id", trip.id).eq("publication_posts.channel", "instagram").single();
  expect((planned!.publication_posts as { scheduled_for: string }).scheduled_for.slice(0, 10)).toBe(`${next}-10`);

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
  // One post, a marker on each event's row.
  await expect(markers(page, brunch.id)).toHaveCount(1);
  await markers(page, karaoke.id).click();
  const dialog = page.getByTestId("post-dialog");
  await expect(dialog).toContainText("2 events together");
  // The preview is there at once: two messages, in the post's order.
  const preview = dialog.getByTestId("telegram-preview");
  await expect(preview).toContainText("as 2 messages");
  await expect(preview.getByTestId("telegram-message")).toHaveCount(2);
  await expect(preview.getByTestId("telegram-message").nth(0)).toContainText(karaoke.title, { ignoreCase: true });
  await expect(preview.getByTestId("telegram-message").nth(1)).toContainText(brunch.title, { ignoreCase: true });

  // The picture is added in the same panel and shows on the first message.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  // Each message has its own button; the karaoke's message gets the picture.
  await expect(preview.getByLabel("Add a picture")).toHaveCount(2);
  await preview.getByTestId("telegram-message").nth(0).getByLabel("Add a picture").setInputFiles({ name: "party.png", mimeType: "image/png", buffer: png });
  await expect(preview.getByTestId("telegram-message").nth(0).getByRole("img", { name: "Picture of the post" })).toBeVisible();
  await expect(preview.getByTestId("telegram-message").nth(0).getByLabel("Replace the picture")).toHaveCount(1);
  await expect(preview.getByTestId("telegram-message").nth(1).getByRole("img")).toHaveCount(0);

  // Posted from the dialog's foot.
  await dialog.getByRole("button", { name: "Confirm and post now" }).click();
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
    ["photo", `<b>${karaoke.title.toUpperCase()}</b>`],
    ["text", `<b>${brunch.title.toUpperCase()}</b>`],
  ]);
  await admin.from("fake_telegram_messages").delete().eq("chat_id", tg.chatId).in("message_id", ids);
});
