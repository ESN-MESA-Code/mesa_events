// Internal events, office hours and the calendar subscription (round
// 2026-10-30): HR plans by drag and drop (a kind onto a day, a member onto
// the OC slot) and repeats a Tuesday Talk; the OC of an office hour counts
// the cash box and the ESNcards and signs it off; a member signs up to an
// internal event, sees the leaderboard and subscribes to the calendar.
import { TEST_TAG, USERS, admin, as as asDb } from "../helpers/local";
import { answerConfirm, drag, expect, freshMonth, test } from "./fixtures";

const removeMonth = async (month: string) => {
  const { data } = await admin.from("internal_events").select("id").gte("starts_at", `${month}-01T00:00:00Z`).lt("starts_at", `${month}-28T23:59:59Z`);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) await admin.from("internal_events").delete().in("id", ids);
};

test("HR plans a month by drag and drop and repeats a Tuesday Talk", async ({ page, as }) => {
  const month = freshMonth();
  try {
    await as(USERS.hr);
    await page.goto(`/team/internal?view=month&month=${month}`);
    await expect(page.getByTestId("kind-palette")).toBeVisible();

    // A kind onto a day: an office hour at its default time.
    await drag(page, page.getByTestId("palette-office_hour"), page.getByTestId(`plan-day-${month}-10`));
    // The grid's chip (phones get a hidden list of the same days).
    const chip = page.getByTestId(`plan-office_hour-${month}-10`).filter({ visible: true });
    await expect(chip).toContainText("14:00");
    await expect(page.getByTestId("planner-editor")).toContainText("Office hour");

    // A member onto its OC slot – in a tall window, away from the edges where dnd-kit scrolls the page.
    await page.setViewportSize({ width: 1280, height: 2000 });
    const row = page.getByTestId(`roster-office_hour-${month}-10`);
    await expect(row).toBeVisible();
    await drag(page, page.getByTestId(`member-${USERS.member.id}`), page.getByLabel(`Office hour ${month}-10 oc`));
    await expect(row).toContainText(USERS.member.name);
    await page.setViewportSize({ width: 1280, height: 720 });

    // Repeat: the 1st Tuesday of the month.
    const repeat = page.getByTestId("repeat");
    await repeat.getByText("Repeat over").click(); // folded until needed (round 2026-11-03 (2))
    await repeat.getByLabel("Kind").selectOption("tuesday_talk");
    await expect(repeat.getByTestId("repeat-dates").locator("label")).toHaveCount(1);
    await repeat.getByRole("button", { name: /^Add 1 date$/ }).click();
    await expect(repeat).toContainText("1 date added.");
    await expect(page.getByTestId("planner-calendar").locator('[data-testid^="plan-tuesday_talk-"]').filter({ visible: true })).toHaveCount(1);
  } finally {
    await removeMonth(month);
  }
});

test("the OC counts the office hour's cash box and signs it off", async ({ page, as }) => {
  const { data: office } = await admin
    .from("internal_events")
    .insert({ kind: "office_hour", title: "E2E office hour", starts_at: new Date(Date.now() - 30 * 60_000).toISOString(), ends_at: new Date(Date.now() + 60 * 60_000).toISOString(), helpers_needed: 1, created_by: TEST_TAG })
    .select("id")
    .single();
  // The office hour box (its default) is counted empty here and holds what it held afterwards (round 2026-10-31).
  const { data: box } = await admin.from("cash_boxes").select("id, counts, cents").eq("default_for", "office_hour").single();
  const since = new Date().toISOString();
  await admin.from("cash_boxes").update({ counts: {}, cents: 0 }).eq("id", box!.id);
  try {
    await admin.from("internal_event_people").insert([
      { internal_event_id: office!.id, profile_id: USERS.oc.id, role: "oc" },
      { internal_event_id: office!.id, profile_id: USERS.helper.id, role: "helper" },
    ]);
    await as(USERS.oc);
    // The duty is in the OC's My events and Home; its step leads to the cash box (round 2026-11-03 (2)).
    await page.goto("/");
    await expect(page.getByTestId("home-duty").filter({ hasText: "E2E office hour" })).toContainText("Count the cash box before you open");
    await page.goto("/me");
    const duty = page.getByTestId("my-today").getByTestId("duty-card").filter({ hasText: "E2E office hour" });
    await duty.getByTestId("next-step").click();
    await expect(page).toHaveURL(new RegExp(`/office-hours/${office!.id}#cash-box$`));
    await expect(page.getByTestId("office-hour-text")).toContainText("office hour");
    await expect(page.getByLabel("Which cash box")).toHaveValue(box!.id);
    await page.getByRole("button", { name: "Start the cash box" }).click();
    await expect(page.getByTestId("cash-box-name")).toContainText("Office hour cash box");

    await page.getByLabel("Before (opening): € 10", { exact: true }).fill("5");
    await expect(page.getByTestId("total-opening")).toHaveText("€ 50.00");
    await page.getByTestId("count-opening").getByRole("button", { name: "Save the count" }).click();
    await expect(page.getByTestId("count-opening")).toContainText("Counted by Olga Organiser");

    await page.getByRole("button", { name: "One internal ESNcard sold" }).click();
    await expect(page.getByTestId("esncards-internal")).toContainText("1");

    await page.getByLabel("After (closing): € 20", { exact: true }).fill("3");
    await page.getByTestId("count-closing").getByRole("button", { name: "Save the count" }).click();
    await expect(page.getByTestId("cash-figures")).toContainText("€ 10.00");

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Close and sign off" }).click();
    await answerConfirm(page);
    await expect(page.getByTestId("cash-status")).toHaveText("Signed off");
    await expect(page.getByRole("button", { name: "One internal ESNcard sold" })).toBeDisabled();
    // The sign-off sets the box to the closing count.
    expect((await admin.from("cash_boxes").select("cents").eq("id", box!.id).single()).data).toEqual({ cents: 6000 });
  } finally {
    await admin.from("cash_box_changes").delete().eq("box_id", box!.id).gte("created_at", since);
    await admin.from("cash_boxes").update({ counts: box!.counts, cents: box!.cents }).eq("id", box!.id);
    await admin.from("cash_reports").delete().eq("internal_event_id", office!.id);
    await admin.from("internal_events").delete().eq("id", office!.id);
  }
});

test("a member signs up, sees the leaderboard and subscribes to the calendar", async ({ page, as }) => {
  const { data: bowling } = await admin
    .from("internal_events")
    .insert({ kind: "internal", title: "E2E bowling", starts_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), capacity: 5, created_by: TEST_TAG })
    .select("id")
    .single();
  try {
    await as(USERS.member);
    await page.goto(`/internal/${bowling!.id}`);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByTestId("sign-ups")).toContainText("You are signed up");
    await expect(page.getByTestId("sign-ups")).toContainText(USERS.member.name);

    // Home lists it under "Coming up in MESA"; the leaderboard has its own page (round 2026-11-02).
    await page.goto("/");
    await expect(page.getByTestId("home-internal")).toContainText("E2E bowling");
    await expect(page.getByTestId("home-leaderboard")).toHaveCount(0);
    await page.getByRole("link", { name: "Leaderboard" }).first().click();
    await expect(page.getByTestId("leaderboard-office_hour_count")).toBeVisible();
    await page.getByRole("link", { name: "Newbies" }).click();
    await expect(page.getByTestId("leaderboard-newbies")).toBeVisible();

    await page.goto("/calendar?show=internal");
    await page.getByRole("button", { name: "📅 Subscribe" }).click(); // a button in the top row (round 2026-11-03 (2))
    await page.getByRole("button", { name: /calendar link/ }).click();
    const url = await page.getByTestId("feed-url").inputValue();
    expect(url).toMatch(/\/api\/calendar\/mesa_cal_[A-Za-z0-9_-]{43}\.ics$/);
    const res = await page.request.get(url.replace(/^https?:\/\/[^/]+/, ""), { headers: { cookie: "" } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    expect(await res.text()).toContain(`UID:internal-${bowling!.id}@mesa`);
  } finally {
    await admin.from("calendar_feeds").delete().eq("profile_id", USERS.member.id);
    await admin.from("internal_events").delete().eq("id", bowling!.id);
  }
});

// Attendance of a Tuesday Talk (round 2026-11-03 (2)): HR shows the rotating
// code, a member scans it (its link), HR sees them, takes a check-in back,
// and the Activity page counts the talk.
test("HR shows the check-in code, a member scans it, HR reviews the activity", async ({ page, as }) => {
  const { data: talk } = await admin
    .from("internal_events")
    .insert({ kind: "tuesday_talk", title: "E2E Tuesday Talk", starts_at: new Date(Date.now() - 10 * 60_000).toISOString(), ends_at: new Date(Date.now() + 80 * 60_000).toISOString(), created_by: TEST_TAG })
    .select("id")
    .single();
  try {
    await as(USERS.hr);
    await page.goto(`/internal/${talk!.id}`);
    await expect(page.getByTestId("attendance-hr").getByTestId("show-code")).toHaveAttribute("href", `/checkin-screen/${talk!.id}`);
    await page.goto(`/checkin-screen/${talk!.id}`);
    await expect(page.getByTestId("checkin-digits")).toHaveText(/^\d{4}$/);
    // The QR code's link, as HR's screen makes it.
    const { data: code } = await (await asDb(USERS.hr)).rpc("checkin_code", { internal_event: talk!.id });

    await as(USERS.member);
    await page.goto(`/checkin/${talk!.id}?t=${encodeURIComponent(code![0].token)}`);
    await expect(page.getByTestId("checkin-result")).toHaveText("You are checked in ✓");
    await page.goto(`/internal/${talk!.id}`);
    await expect(page.getByTestId("checked-in")).toBeVisible();
    // A member sees only themself, not the list.
    await expect(page.getByTestId("attendance-list")).toHaveCount(0);

    await as(USERS.hr);
    await page.goto(`/internal/${talk!.id}`);
    const list = page.getByTestId("attendance-list");
    await expect(list).toContainText(USERS.member.name);
    await expect(list).toContainText("scanned");
    await page.goto("/team/internal/activity");
    await expect(page.getByTestId(`activity-${USERS.member.email}`)).toBeVisible();

    // HR takes it back; it is kept as such.
    await page.goto(`/internal/${talk!.id}`);
    await list.getByRole("button", { name: "Remove" }).click();
    await answerConfirm(page);
    await expect(page.getByTestId("attendance").getByText("Taken back (1)")).toBeVisible();
    await expect(page.getByTestId("attendance-list")).toHaveCount(0);
  } finally {
    await admin.from("internal_events").delete().eq("id", talk!.id);
  }
});
