// Cancelling an event tells the team and can be undone (review 2026-10-29
// A2): Events cancels with a reason, the Chat space hears of it, Comms sees
// the published description is now wrong, Events reopens it. The OC asks
// the Events team to cancel instead (round 2026-11-03).
import { USERS, admin, as as asClient, createEvent, daysFromNow } from "../helpers/local";
import { answerConfirm, expect, runJobs, signInAs, test } from "./fixtures";

test("Events cancels an event, Comms is shown it, Events reopens it", async ({ page, context, baseURL }) => {
  const title = `Cinema ${Math.random().toString(36).slice(2, 7)}`;
  const ev = await createEvent({ title, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1, starts_at: daysFromNow(8) });
  try {
    await (await asClient(USERS.events)).rpc("request_chat_space", { event: ev.id });
    await runJobs(baseURL!);
    await admin.from("descriptions").upsert({ event_id: ev.id, status: "published", published_at: new Date().toISOString() });

    await signInAs(context, baseURL!, USERS.events);
    await page.goto(`/events/${ev.id}`);
    await page.getByRole("button", { name: "Cancel the event…" }).click();
    const form = page.getByTestId("cancel-event-form");
    await expect(form).toContainText("The team and the Chat space are told; registered receipts stay valid.");
    await form.getByLabel("Reason for the team (optional)").fill("Venue closed");
    await form.getByRole("button", { name: "Cancel the event" }).click();
    expect(await answerConfirm(page)).toContain(`Cancel ${title} on`);
    await expect(page.getByTestId("event-status")).toHaveText("Cancelled");
    await expect(page.getByTestId("cancelled-banner")).toContainText("Venue closed");

    await runJobs(baseURL!);
    const { data: e } = await admin.from("events").select("chat_space_name").eq("id", ev.id).single();
    const { data: msgs } = await admin.from("fake_chat_messages").select("text").eq("space", e!.chat_space_name!).like("text", "🚫%");
    expect(msgs).toHaveLength(1);
    expect(msgs![0].text).toContain("Reason: Venue closed");
    expect(msgs![0].text).toContain("<users/helper@esnmesa.org>");

    // Comms: the description is out, the event is off.
    await signInAs(context, baseURL!, USERS.comms);
    await page.goto("/team/comms");
    const notice = page.getByTestId("cancelled-published");
    await expect(notice).toContainText(title);
    await expect(notice).toContainText("Venue closed");
    await notice.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Handled" }).click();
    await expect(page.getByTestId("cancelled-published").filter({ hasText: title })).toHaveCount(0);

    // The OC cannot reopen; the Events team can.
    await signInAs(context, baseURL!, USERS.oc);
    await page.goto(`/events/${ev.id}`);
    await expect(page.getByTestId("cancelled-banner")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen the event" })).toHaveCount(0);

    await signInAs(context, baseURL!, USERS.events);
    await page.goto(`/events/${ev.id}`);
    await page.getByRole("button", { name: "Reopen the event" }).click();
    await answerConfirm(page);
    await expect(page.getByTestId("event-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("cancelled-banner")).toHaveCount(0);
    await runJobs(baseURL!);
    const { count } = await admin.from("fake_chat_messages").select("name", { count: "exact", head: true }).eq("space", e!.chat_space_name!).like("text", "✅%back on%");
    expect(count).toBe(1);
  } finally {
    await admin.from("events").delete().eq("id", ev.id);
  }
});

test("the OC asks the Events team to cancel; Events is told in Chat and decides", async ({ page, context, baseURL }) => {
  const ev = await createEvent({ title: `Short ${Math.random().toString(36).slice(2, 7)}`, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 3, starts_at: daysFromNow(6) });
  try {
    // The OC cannot cancel any more (round 2026-11-03), only ask – with a reason.
    expect((await (await asClient(USERS.oc)).rpc("cancel_event", { event: ev.id })).error?.code).toBe("42501");
    await signInAs(context, baseURL!, USERS.oc);
    await page.goto(`/events/${ev.id}`);
    const banner = page.getByTestId("understaffed-banner");
    await expect(banner.getByRole("button", { name: "Cancel the event" })).toHaveCount(0);
    await banner.getByRole("button", { name: "Ask the Events team to cancel…" }).click();
    await banner.getByLabel("Why should it be cancelled?").fill("Nobody can come");
    await banner.getByRole("button", { name: "Send the request" }).click();
    expect(await answerConfirm(page)).toContain("The Events team is told in Chat and decides");
    await expect(page.getByTestId("cancellation-request")).toContainText("“Nobody can come” – it stays on until the Events team decides.");
    await expect(page.getByTestId("event-status")).not.toHaveText("Cancelled");
    // No space yet: each member of the Events team gets a direct message.
    await runJobs(baseURL!);
    const { data } = await admin.from("fake_chat_messages").select("text").eq("space", `dm:${USERS.events.email}`).like("text", `%asks to cancel *${ev.title}*%`);
    expect(data).toHaveLength(1);

    // The Events team sees it on its page and cancels.
    await signInAs(context, baseURL!, USERS.events);
    await page.goto(`/events/${ev.id}`);
    await page.getByTestId("cancellation-request").getByRole("button", { name: "Cancel the event" }).click();
    await answerConfirm(page);
    await expect(page.getByTestId("event-status")).toHaveText("Cancelled");
    await runJobs(baseURL!);
    const { data: told } = await admin.from("fake_chat_messages").select("text").eq("space", "dm:helper@esnmesa.org").like("text", `%${ev.title}%is cancelled%`);
    expect(told).toHaveLength(1);
  } finally {
    await admin.from("events").delete().eq("id", ev.id);
  }
});
