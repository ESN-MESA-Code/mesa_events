# MESA Events – usability review, 2026-10-30

Walkthrough of the local app (`npm run dev:local`, seeded demo data, branch
`feature/internal-events-finance` at `78176c5`) from the point of view of each role:
newcomer, member/helper, OC, participant (public sign-in form), Events team, Comms and Finance.
Desktop (800 px) and phone (375 px).

Not reviewed: Office hours, Internal events, Cash box and Finance ledger. These are still
uncommitted work in another session.

Overall: the app is in good shape. Home's "what's next for you" cards, the **Your next step**
banner on every event and the cycle stepper give each role a clear path. Most of the problems
below are about **feedback, consequences people are not told about, and the same data showing up
in two places with different values**, not about missing features.

Severity: **P1** = people will make a costly mistake or miss a deadline · **P2** = friction or
confusion on a main flow · **P3** = polish.

---

## P1 – fix first

### 1. OCs aren't told that a late description cancels the event
The Events team's Descriptions page says *"Events whose description is not submitted by then are
cancelled automatically"* (`CycleControls.tsx:142`). The OC never sees that. Home, the next-step
banner and the Description tab only say "due Mon 2 Nov, 19:00".
**Fix:** wherever an OC sees a description deadline (Home card, next-step banner, Description tab
info bar), add "– after that the event is cancelled". Turn the due date amber within 48 h and red
within 24 h or when overdue.

### 2. Template text gets through as real content
The Programme and "What should I bring?" fields come pre-filled with *Welcome and introductions /
The main part / Drinks afterwards*. That text counts as filled in, so validation passes. The seeded
**Hike to the Kampenwand** is waiting for Comms review with "Drinks afterwards" as its programme,
and Comms can approve it as is.
**Fix:** show the defaults as placeholders, or keep them as values but flag "still the template
text" (like the TBA price hint) and block submit until the OC has changed or confirmed them. Show
the same warning to Comms in review.

### 3. Location: the editor and the preview disagree
On *Ice Skating*, the form shows Location "Munich, München", Location name "Munich" and City
"München", but the preview prints **"Münchner Eiszauber, Karlsplatz"**. On *Kampenwand* the form
says "Kampenwandstraße 1, 83229 München" and the preview "Kampenwand, Aschau im Chiemgau". The
Overview tab shows yet another value ("Munich"). The OC can't tell which value is published.
**Fix:** use one source of truth. The preview must render exactly what the form holds. If the
preview uses a different field (for example the event's address set on the Overview tab), show
that field in the editor with an "edit" link.

### 4. Price is in two places with two values
Overview → Details shows **Price € 6.00**. The Description tab shows **Price: TBA**, and so does
the post. Same problem as #3.
**Fix:** use one price field. Or, if the description price is meant to be separate, label it
("Price shown in the post") and show a warning when the two differ.

### 5. The OC's next step blames them for someone else's missing receipt
*Pub Crawl* (OC Olga): Home and the banner say **"Hand in the Belege"**, but all of Olga's receipts
are in. The missing one is Hugo's (helper). `nextStep()` (`lib/checklist.ts:150-156`) uses the
team-wide `belegeMissing`.
**Fix:** say "Hugo Helper still has to hand in 1 Beleg", or "Remind Hugo" as a `waiting` step. The
Hand-in status line should name who is missing a Beleg, not just "Rest of the team: 1 Beleg
outstanding".

### 6. "Finish & sign off" shows too early
On the Attendance tab, **Finish & sign off** is the dark primary button even before sign-ins open
("Not open yet"), and while sign-ins are running it sits right next to the "Open for sign-ins"
badge. One tap closes the list during the event.
**Fix:** hide or disable it before the event starts. While the event runs, make it a secondary
button lower on the page, and use a proper confirm dialog that shows the sign-in count ("Close the
list with 3 sign-ins? Participants can't sign in afterwards.").

---

## P2 – main-flow friction

### 7. No feedback after actions
The app has no toast or status-message system (only 3 `aria-live` regions in the whole app).
Claiming a slot, submitting the volunteer form, approving and so on just re-render the page. On
the claim flow you have to notice your name in the Team list.
**Fix:** add a small toast or inline success message for every server action ("You're now a helper
at Hike to the Kampenwand – see you on Sun 8 Nov"), with `role="status"`.

### 8. Irreversible actions use native `confirm()` without context
There are 12 `confirm()` calls (volunteer submit, claim slot, drop out, close form, schedule
remove …). The prompts are vague: *"Help at this event?"* doesn't say the date. *"Submit your
answers (0 events)?"* lets someone submit an empty form that then locks.
**Fix:** use one styled `ConfirmDialog` component that names the event, date and consequence. For
the volunteer form, refuse a 0-event submission, or say clearly "you'll be listed as unavailable
for all events".

### 9. Helpers get no instructions
A helper's next step before the event is *"… Help at the event – see the Chat space"*
(`lib/checklist.ts:134`). It's a dead end: Home doesn't link the Chat space, there's no meeting
point or time, and the "…" glyph looks like a loading state.
**Fix:** link straight to the Chat space, show start time and location, and use a clear icon for
"waiting".

### 10. Home doesn't put urgent items first
The OC's Home lists events by date. *"Fix the description (Comms asked for changes)"* (Weekend in
the Alps) is last. *Language Café*, which is happening **now**, sits in the middle with no "live"
marker.
**Fix:** sort action items by urgency: happening now, overdue, due soon, waiting, done. Add a
"Happening now – open attendance" highlight.

### 11. Team queues are at the bottom of Home and list every month
For Events, Comms and Finance users, the **Team queues** card is below the leaderboard. Its list
includes every cycle that exists (dozens of lines in the current data).
**Fix:** show team queues above the leaderboard, limit them to current and next months, and add a
"more" link.

### 12. The internal calendar card only shows the current month
On 30 Oct it shows October with one day left and "Nothing internal in the next weeks", while the
member has three events in November. Every day is also a link to the same URL, which means 31
useless tab stops.
**Fix:** show the next N weeks or an upcoming list. Include the user's own events. Make the grid
non-interactive, or link each day to its own date.

### 13. The full calendar opens on a nearly finished month
Same issue on `/calendar` on the 30th. Past days look the same as future ones.
**Fix:** after about the 25th, open on the next month (or default to the List view of upcoming
events). Dim past days.

### 14. Newcomers get no orientation
After accepting the confidentiality rules, a newcomer lands on the same Home as everyone else.
Nothing explains OC vs helper, how allocation works or what is expected.
**Fix:** a dismissible "How MESA events work" card on Home for members with no events yet (3–4
steps, a link to the volunteer form). Also explain the orange dot on the avatar (missing payout
details), for example with a tooltip or a Home card.

### 15. The confidentiality page is hard to read
The English and German text are stacked (two screens). The "I agree to" items lost their bullet
markers and read as run-on lines. The accept button is below the fold. There is no app header or
logo.
**Fix:** add an EN/DE toggle (both texts stay legally available), restore list markers, keep the
accept button sticky at the bottom, and add the app header.

### 16. The description editor is long and the preview scrolls away
The Chat preview isn't sticky, so it's gone by the time you edit Programme or Details. Validation
errors are spread over the whole page, and "Submit for Comms review" at the very bottom is
disabled with only "Fix the points marked in the form first".
**Fix:** make the preview column sticky on desktop. Next to the disabled submit button, list the
open errors as jump links. Put the 30 objectives in a normal list, not a nested scroll box.

### 17. Comms review: actions at the bottom, no record of what changed
Approve and Request changes are at the end of a long page. There's no way to see what the OC
changed since the last "changes requested", and comments apply only to the whole description.
**Fix:** a sticky review bar (Approve / Request changes) at the top. Show the last review comment
with what changed since then (at least highlight the fields that changed).

### 18. The cycle stepper uses two "current" styles
A filled pill means the current cycle step. An outlined pill means the current page. "Allocation"
and "Roster confirmed" both go to `/roster`, and "Done" goes to hand-in. On the roster page of
December you see "Volunteer form" filled and "Roster confirmed" outlined.
**Fix:** keep the stepper for status only, and use real sub-tabs (Schedule · Form · Roster ·
Descriptions · Hand-in) for navigation.

### 19. The volunteer form admin has no way to nudge people
With 0 answers and 4 days left, the next step is "Wait for answers, or close the form early".
**Fix:** add "Remind members" (Chat announcement) and show who hasn't answered yet. On the
member side, use segmented buttons (No · If needed · Happy to · Top choice, in that order) instead
of 2×N dropdowns. The current option order, No / Top choice / Happy to / If needed, is neither
ascending nor descending.

### 20. The roster doesn't warn about overload
The volunteers list shows "Olga Organiser · 0 wishes · 4 assigned" with no warning. There are no
same-day conflict hints. Changes on a confirmed roster save immediately and go out to the OC, with
no undo.
**Fix:** flag ≥3 assignments and same-day clashes. After a change on a confirmed roster, show an
undo toast before the Chat announcement is sent.

### 21. The month's events lists don't highlight problems
The Events team's month list and its Descriptions page give *Draft*, *Changes requested* and
*Waiting for Comms* the same weight as healthy rows, and they don't show the OC.
**Fix:** colour problem states, show the OC's name, and add a per-row "Remind".

### 22. Finance: unclear verbs and caps
"**Check**" (approve?) and "Reject" sit side by side with no visual difference in risk. "capped"
on Hugo's € 25 → € 8 claim doesn't say why. The KPI tiles (Belege missing 1, To check 2 …) can't
be clicked.
**Fix:** rename the button to "Approve €14.00", make Reject a danger-styled button with a reason,
add a tooltip on "capped" with the rule ("Helper: max € 8"), and make the tiles filter the table.

---

## P3 – polish

23. **The event tab bar shows a stray vertical scrollbar** (▲▼ at the right edge) at 800 px. On
   phones the tabs are cut off ("Ca…" for Cash box) with nothing to show you can scroll. Use
   horizontal scroll with a fade, or wrap the tabs.
24. **Hydration error on the Attendance tab**: `QRCodeDisplay` prints the URL differently on the
   server (`/event/…`) and the client (`http://localhost:3000/event/…`). Pass the absolute URL from
   the server.
25. **"Loading participants…" never finishes** when Realtime can't connect (the WebSocket to
   `:54421/realtime` failed). Fall back to a fetch and show an error.
26. **The attendance summary is hard to read**: "Signed in between 11:00–11:00", "Counted by
   organiser –" with no visible place to enter a count, and "On organiser's device". Explain these,
   or hide them while they're empty. Add a "Show QR full screen" button for projecting it.
27. **German and English mixed** in the English UI: "Belege", "Beleg" in checklists, buttons and
   next steps. Use "receipt (Beleg)" once as an explanation and "receipt" everywhere else.
28. **Checklist icons are inconsistent** (✅ / ◻️ / ⬜ emoji). Use one icon set (done, open,
   not yet).
29. **The 404 page has no navigation.** Keep the app header on it.
30. **The status "Confirmed" appears together with "No Chat space yet – created when the month's
   roster is confirmed"** (Ice Skating). Say which of the two is confirmed: the event or the roster.
31. **Withdraw** on your own idea is styled as plain text. Make it a button and ask for
   confirmation.
32. **The public sign-in form**: the legal text before the button is long on a phone (two
   screens). Collapse the full terms behind "Read the terms", and keep the summary and checkbox.

## Test-data note (not a UX issue)
The shared local database contains leftover test cycles (September 2244 … October 8925 events,
"World A/World B" slots), probably from `test:db` runs. They clutter the month pickers and team
queues. `npm run clean:test-data` exists. Even so, the month picker and team queues should not
show cycles years in the future (see #11).

## Status (2026-10-31, branch `ux/usability-review-fixes`)

Fixed on the branch cut from `d6fd077`. "Partly" means part of the proposed fix needs a product
decision or a migration and was left out; what is missing is said in the note. Decisions taken
are in docs/DECISIONS.md ("2026-10-31 – Usability review fixes").

| # | Status | Note | Commit |
|---|---|---|---|
| 1 | Fixed | Home, banner, checklist and Description tab say "– after that the event is cancelled" (for drafts); due date amber < 48 h, red < 24 h or overdue. | 16a3950 |
| 2 | Fixed | The example programme is an error on submit and approval (client and server). The editor itself starts empty – the text came from the demo seed, which now gives each event its own programme except the hike. | 8a31405 |
| 3 | Fixed | Fields kept separate (Comms may word the post's line): the editor shows when the post's venue differs from the venue fields, with "Use the fields in the post". | 5a82cd9 |
| 4 | Fixed | "Price shown in the post" with the event's price as hint; a difference is flagged with "Use € 6.00 in the post". | 5a82cd9 |
| 5 | Partly | Next steps count only the member's own missing paper receipts; only others' missing → waiting step "The rest of the team still has to hand in 1 paper receipt – remind them in the Chat space". Naming the person needs a new definer function and revisiting DECISIONS B2 (counts only, no names). | 1bab836 |
| 6 | Fixed | No sign-off button before sign-ins open; while open it is a secondary button in an "Event over?" card at the bottom; the confirm dialog names the sign-in count. | 71a85f9 |
| 7 | Fixed | Shared `role="status"` message region; main flows say what happened, other ActionButtons "Done.". | 60e496f |
| 8 | Fixed | All 12 `confirm()` calls replaced by a styled dialog naming event, date and consequence; an empty volunteer form says the member is listed as unavailable for all events. | 60e496f |
| 9 | Fixed | Helpers see start time, venue and a direct Chat space link on Home; clock icon for "waiting". | 65dd3dd |
| 10 | Fixed | Home orders happening now, overdue, due < 48 h, to do, waiting, done; running events get a "Happening now" badge and an attendance button. | b792bc9 |
| 11 | Fixed | Team queues above the leaderboard; the Events card lists last month to two months ahead, "n more months" links the rest. | 3e80692 |
| 12 | Fixed | Next four weeks instead of the month, own ESN events included, the grid is no longer 28–31 links. | 0b45a25 |
| 13 | Fixed | From the 25th the calendar opens on the next month; past days dimmed; month picker leaves out cycles more than a year ahead. | e62492a |
| 14 | Fixed | Dismissible "How MESA events work" card for members without events; it and the avatar's tooltip explain the orange dot. | 506b16b |
| 15 | Fixed | App header, EN/DE tabs (both texts stay on the page), list markers restored, sticky accept bar. | 93c7e68 |
| 16 | Fixed | Sticky preview column on desktop, open errors as links next to Submit, objectives as a plain list. | 191cb83 |
| 17 | Partly | Sticky review bar at the top; last "changes requested" comment and the steps changed since the reviewed version, marked on the cards. Per-field comments would need a new table: not done. The demo DB has no reviewed version yet (the seed now adds one for the Alps weekend; it shows after `seed:demo`). | 191cb83 |
| 18 | Fixed | Cycle pages have tabs (Schedule · Volunteer form · Roster · Descriptions · Hand-in); the stepper is status only. | e82f29d |
| 19 | Partly | Form page lists who has not answered (with "Copy their email addresses"); members choose with segmented buttons No · If needed · Happy to · Top choice. A "Remind members" Chat announcement needs a new outgoing job and a decision on the members' space: not done. | 4bf2a05, 60e496f |
| 20 | Fixed | ≥ 3 assignments and same-day events flagged; on a confirmed roster a change waits 10 s with Undo before it is saved and announced. The Undo flow was not exercised in the browser (synthetic drags did not trigger dnd-kit) – check by hand. | a6194c8 |
| 21 | Fixed | Problem rows marked (amber, red after the deadline), coloured description status, OC named, "Remind OC" per row. | 0d4650e |
| 22 | Fixed | "Approve € 14.00" in one click (plus "Other amount…"), red "Reject…" needing a reason, "capped by the rule (Helper: 50 %, max € 8.00)", figures filter the table. | d95a179 |
| 23 | Fixed | Shared tab bar: no vertical scrollbar, horizontal scroll with a fade on phones. | f805227 |
| 24 | Fixed | QR link built on the server and passed down. | a594db7 |
| 25 | Fixed | Failed fetch is reported; without Realtime the list polls every 15 s and says so. Not exercised with Realtime actually down – check by hand. | a594db7 |
| 26 | Fixed | Only meaningful figures, explained; "Signed in at 00:08"; "Show QR full screen". | a594db7 |
| 27 | Fixed | "Paper receipt" throughout; "Beleg" once as the explanation. | 1425d07 |
| 28 | Fixed | One icon set (lucide) with text alternatives. | 9378bb9 |
| 29 | Fixed | Unknown URLs render the member area's 404 with header and navigation. | 8d46a79, a49d2bc |
| 30 | Fixed | Chat space card says whether the event or the month's roster is confirmed. | 354496c |
| 31 | Fixed | "Withdraw idea" is an outlined red button with a confirm dialog. Not clicked in the browser: the demo data has no idea in "proposed". | 459f3ff |
| 32 | Partly | Participation terms fold behind "Read the terms" (one line and the checkbox stay). The GDPR notice stays fully visible (Art. 21(4)); shortening or moving it needs a legal decision. | c94255a |
