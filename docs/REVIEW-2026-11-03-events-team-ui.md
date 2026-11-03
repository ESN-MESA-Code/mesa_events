# Events team UI – review, 2026-11-03

Walkthrough as **Amara Okafor (Events team)** on the local stack (`main` at `94ec76f`, seeded
demo data, today = Tue 3 Nov 2026). Pages: `/team/events` and every cycle tab (Schedule ·
Volunteer form · Roster · Descriptions · Hand-in) for November (running), December (roster)
and January (form open). Desktop 800 px and phone 375 px.

The individual pages work. What feels off is the **structure around them**: the Events team
always has three months in flight, the UI shows one, and the same month has two "home" pages
with five different lists of the same events.

---

## A. Structure and navigation

### 1. Two home pages for one month
`/team/events` shows the month card (stepper + next step) and "The month's events".
The cycle page (`/team/events/cycles/[id]`) repeats the stepper, next step and month selector,
then lists the same events again under Schedule. The same 13 November events appear in **five
lists** (landing, Schedule list, Schedule calendar, Descriptions, Hand-in), each with different
columns and actions: the landing list has OC names and Remind; the Hand-in tab has neither; the
Descriptions tab has Remind but no hand-in.
**Fix:** make the landing list the cycle's first tab, **Overview**. `/team/events` opens the
picked month's Overview. One header everywhere (breadcrumb, month, status, tabs). Descriptions
and Hand-in become filtered views of the same row component, with the same OC name and Remind.

### 2. Three months of work, one month on screen
Right now Events has: November hand-ins overdue (5 events since 1 Nov), December roster to
confirm (due 17 Nov), January form open (closes Sat 7 Nov). The page shows one of them; the
others are only hinted at in the dropdown notes.
**Fix:** a "To do across months" strip at the top of `/team/events`: one line per active cycle
with its next action and due date, linking to the right tab. `cyclesWithProgress` already
computes this for every cycle.

### 3. Month-selector notes read as done
The dropdown says **"December 2026 events · Roster confirmed"** while the roster is *not*
confirmed. The note is the label of the current (to-do) step, and the step labels are states
("Roster confirmed"). It is also cut to "November 2026 events · Desc" (`max-w-[16rem]`).
**Fix:** step labels as tasks ("Roster", "Descriptions"), notes as "to do: confirm roster".
Shorter option labels ("Dec 2026 – confirm roster", the word "events" is redundant).

### 4. The page jumps to another month after loading
`/team/events` rendered November, then `MonthSelector` replaced the URL with the remembered
December from `localStorage`. You see one month, then the page changes under you, and the
"open on the month with work" default is lost.
**Fix:** remember the month in a cookie read on the server, or stop remembering on the landing
page once #2 shows all months.

### 5. The stepper behaves differently on the two pages
On `/team/events` each step is a link; on the cycle pages the same stepper is status only
(usability review #18). Pick one: status only, tabs for navigation.

### 6. On a phone the header fills the first screen
Breadcrumb, title, month selector, stepper (three rows of pills) and the next-step box come
before the tabs; the content starts below the fold on every tab.
**Fix:** on phones show the stepper as one line ("Step 6 of 8 · Descriptions · by 30 Oct") with
an expander, and put the tabs right under the title.

### 7. Small things in the landing header
- Two links to the same cycle page: the month title and "Schedule →".
- "Categories and formats" sits next to the month selector as if it belonged to the month. It
  is a team setting: move it to the right of the page title as a secondary button.

## B. Status and next step

### 8. The next step ignores overdue hand-ins
November: 5 events are missing hand-ins since 1 Nov, but the cycle stays on **Descriptions**
and says "Remind OCs whose descriptions are missing", because one upcoming event (Panel, changes
requested) has no approved description. The Hand-in tab gets no dot. Cause: `cycleProgress`
checks `upcomingMissing` before hand-in (`lib/cycle.ts:133-145`).
**Fix:** once the first event has happened the month is *running*: show both counts
("1 description open · 5 hand-ins missing"), put a dot on both tabs, and pick the more urgent one
as the next action.

### 9. The description deadline text doesn't match what happened
The Descriptions tab says the deadline passed and *"Events whose description was not submitted
by then were cancelled"*. But **Karaoke Night** (description "Not started") ran on 2 Nov as
Confirmed, and **Panel** ("late · Changes requested") still gets "Remind OC", and the next step
still says to remind OCs. Either the auto-cancel didn't run (maybe the seed data) or the rule is
different. The UI has to say what really happens, e.g. "1 event is late – cancel it or let it
run".

### 10. Status badges contradict the staffing
Board Game Night with **1/2 helpers** shows *Confirmed*; Ice Skating with 1/2 shows
*Under-staffed*. Karaoke Night (2 Nov) and today's Language Café show *Confirmed* while the
1 Nov events show *Completed*.

### 11. The volunteer form's next step is a dead end
January: "Next: **Nudge** those who have not answered (volunteer form page)". That is shown
*on* the volunteer form page, which has no nudge button, only "Not answered yet: 44 members"
with no names.
**Fix:** a "Remind 44 members" button (Chat announcement, like `RemindButton`), the names
behind an expander, and drop "(volunteer form page)" from the text.

### 12. "Remind OC" doesn't say what about
A row can be missing a description and a report. The button is the same either way and doesn't
show when the OC was last reminded.
**Fix:** "Remind about report" / "Remind about description", plus "reminded 2 days ago".

## C. Lists

### 13. Hand-in tab on a phone: titles cut off
The title column gets what's left after date and status: "Languag…", "Kar…". The two Language
Cafés can't be told apart. No OC and no Remind on this tab (see #1).
**Fix:** on phones put the title first, date and "missing …" below.

### 14. The month's events list isn't grouped
Every past event has an amber border, so the problem marker stops meaning anything; you scan
13 rows by date.
**Fix:** groups: **Needs action** (count) · **Coming up** · **Done / cancelled**.

### 15. Roster: unassigned volunteers are hidden in the list
- "**1 wishes**" (plural bug, `RosterBoard.tsx:203`).
- Five volunteers with 0 assignments (Camila, Fatima, Mateo, Nikos, Thanh) are sorted
  alphabetically among the others, while Nuremberg and Isar are short of helpers and Swing Dance
  has no OC.
**Fix:** "Not assigned yet" at the top of the volunteers list, highlighted. On a short event,
show which of them are free that day.

### 16. Schedule tab on a running month
- Drag and drop still works on completed and past events. Lock them.
- "Ideas for this month – 0" still shows for a month whose form closed weeks ago. Collapse it
  after the form opened.
- "2 helpers · **3 sign-ups**": "sign-ups" is also the word for attendance. Say "3 volunteered".

### 17. Step dates out of order (demo data?)
January's stepper reads "Ideas by 7 Dec · Schedule by 10 Dec · Volunteer form until 7 Nov" and
"planned in December", while the form is open now. Probably the seed opened the form early, but
the UI could say "form opened early" instead of showing dates that go backwards.

---

## Status (same day)

All addressed in the working tree, except where noted:

- **#1, #5, #7** – cycle tabs: **Overview** (first, at `/team/events/cycles/[id]`) · Schedule
  (moved to `/schedule`) · Volunteer form · Roster · Descriptions · Hand-in. Overview,
  Descriptions and Hand-in share one row (`MonthEvents.tsx`, loader `lib/monthEvents.ts`).
  The steps live on the tabs (see #6). "Categories and formats" is a button by the title.
- **#2, #4** – `/team/events` lists every month's open steps ("To do") and the months; no month
  selector there, so no jump. `?month=` redirects to that month's overview.
- **#3** – step "Roster confirmed" is now "Roster"; month notes read "to do: roster"; no "events" in
  the option labels; the select shrinks on phones instead of overflowing.
- **#6** – the stepper and the tabs are now one bar (decided after the first round): each tab
  shows its step – ✓ done, a dot where the cycle is (red when late), the step's date below.
  Ideas + Schedule share the Schedule tab, Allocation + Roster the Roster tab. On phones the
  bar scrolls sideways, so the header is just title, month and tabs.
- **#8** – a running month has both steps open (`CycleProgress.todos`), both tabs get a dot, the
  next-step box shows one line per step.
- **#9** – the locked-deadline text says how many events the deadline actually cancelled. Why
  Karaoke Night (no description) wasn't cancelled is still open: probably the demo data.
- **#10** – `shownStatus()` (`lib/labels.ts`): live staffing before the start, completed once
  over. Display only; the stored status is unchanged.
- **#11** – *the review was partly wrong:* the list of members who haven't answered was already
  there, collapsed. The list now starts open, and the next step links straight to it. Sending a
  Chat reminder to all of them is **not built** (it needs a new job).
- **#12** – "Remind about description / report", plus "reminded 2 Nov" from the activity log.
- **#13, #14** – rows stack on phones; Overview groups: Needs action · Coming up · Done · Cancelled.
- **#15** – "Not assigned yet" first and marked; "1 wish"; short events list the unassigned people.
- **#16** – *the review was partly wrong:* past events could already not be dragged. Ideas are
  hidden once the schedule is locked; "3 volunteered" instead of "3 sign-ups".
- **#17** – a form opened early shows "opened early · until 7 Nov" and no standard dates before it.

## Suggested order
1. **#8, #9, #10** – the status and next step are wrong, so people act on the wrong thing.
2. **#1 + #2 + #5** – one Overview tab, the cross-month to-do strip, a status-only stepper.
3. **#3, #4** – month labels and the jump.
4. **#11, #12, #13, #15** – dead ends and lists.
5. The rest.

## Round 2 (same day, after trying it)

- **One bar:** the stepper and the tabs are one tab bar (see #6).
- **Reminders are automatic:** `send_oc_reminders()` (migration `20261103000400`, pg_cron every 15
  min, 10:00–20:00 Berlin, at most once a day per event and topic) reminds of the description from
  N days before the deadline, every M days, and of the hand-in from N days after the event, every M
  days, at most K times. Admin → Settings → "Reminders to the OC" (0 days = off). It replaces
  `remind_due_descriptions()`; `remind_oc()`, the `remindOc` action and every "Remind …" button
  (Events and Comms) are gone. The next-step lines now say what is open ("6 events are not handed
  in yet – the OCs are reminded automatically"), and the rows show "reminded Tue 3 Nov".
- **Receipts are Finance's:** the Events team's hand-in is the attendance list, photos and the
  event report – in the rows, the month's progress and the reminders.
- **Descriptions tab:** deadline plus the reminder rule, then the events by who has the
  description: Waiting for the OC · With Comms · Approved or published · Took place without one.
- **Hand-in tab:** a checklist per event (attendance list · photos · event report) – Missing
  something · Handed in · Still ahead.
- **Ideas tab:** every month has an Ideas tab (open and decided ideas), also once the schedule is
  fixed; a new month opens there. The Events page lists ideas for months without a cycle.
- **Events page:** only the months – each month in progress with its open steps, the done ones
  below.
- **No Overview, no next-step box:** both repeated the tabs. A month (`/team/events/cycles/[id]`,
  `?month=`) opens on the tab of its current step, the Hand-in once it is done. The header is
  title, month and the tab bar.

## Round 3 (same day)

- **The Events team decides cancellations** (migration `20261103000500`): an OC can no longer
  cancel (not even an under-staffed event). They press "Ask the Events team to cancel…" with a
  reason; the request is recorded, the Events team is @-mentioned in the event's Chat space (or
  DMed without one), the event stays on, and the request shows in red on its month's card on the
  Events page and on the event page. The Events team cancels it or keeps it on (a note for the
  OC, posted in Chat); the OC can withdraw. Cancelling another way settles an open request.
- **No event without a description:** never sent by the deadline → cancelled (as before). Sent
  back by Comms → must be sent again within N days (Admin → Settings, default 4), never before
  the deadline, at the latest 24 h before the start, else cancelled too. Reminders give that due
  date and say the event is cancelled otherwise.
- **Descriptions tab:** one card – deadline line, Waiting for the OC (state, due date, last
  reminder), With Comms (sent date), Published folded, a muted "Not needed" line.
- **Events page:** one card per month in progress, side by side, short labels ("Hand-in · 6 not
  handed in"), cancel requests first; the next unplanned month as a dashed card; done months
  and ideas for later months as one line each.
