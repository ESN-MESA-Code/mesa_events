# Brief 2026-10-29 – Drive photos, ESN Activities, idea inspiration, month-based team pages

New product requests from the user after the second review round. Everything here is in scope;
work through it in order A → D. The reference repo `D:\Claude\esn-event-description-bot` stays
read-only; its README (sections *Uploads to Telegram, pretix and ESN Activities*, *ESN Activities:
data collection + PR browser script*, *Photo reminders and picture folders*) and `src/Esn.gs`,
`src/Database.gs`, `worker/Worker.gs`, `worker/WebApp.gs`, `tools/esn-activities/mesa-esn.user.js`
describe how the bot did it.

## A. Event photos live in Google Drive, like the bot

**Now:** staff upload photos (max 15 MB, no videos) on the Hand-in tab into the private Supabase
Storage bucket `event-photos`; a job copies each file to a Drive folder named
`<date> <title>` and deletes it from Storage.

**Wanted:** the bot's way. Drive is where photos go, uploaded directly by the team:
- A job creates the event's folder in the photo drive (`DRIVE_PHOTOS_FOLDER_ID`) as
  `<root>/<semester>/<yyyy-MM-dd Event title>`. Semester folders follow the bot: `SoSe_26` =
  April–September, `WiSe_26-27` = October–March, created if missing. Port `semesterOf_` from
  `src/Database.gs` and the folder logic from `worker/Worker.gs`. Idempotent: reuse an existing
  folder of that name. Store the folder id and URL on the event.
- **Reminders in the event's Chat space** (jobs queue, once per event, idempotency keys):
  - at the event start: "📸 *Event* starts now – please take lots of pictures";
  - the next morning at 10:00 (Europe/Berlin): "📤 Please upload your pictures and videos here:
    📁 <folder link>".
  - Scheduled by pg_cron like the other jobs.
- **Hand-in tab:** a big "Open the photo folder in Drive" button instead of the file input. Show
  the photo count from Drive: a job or on-demand lookup through the Drive client lists the folder
  and caches `photo_count` and the time it was checked. "Photos handed in" (checklist,
  `lib/checklist.ts`, cycle Hand-in step) means at least one file is in the folder. Add a "Check
  again" button and a manual "Photos are uploaded" tick for the OC in case Drive cannot be read.
- **Remove the Storage path:** the `event-photos` bucket and its policies, `add_event_photo`,
  `addEventPhoto`, `event_photos` (or keep the table only if it still serves the count; decide and
  document), `lib/uploads.ts`, the `uploadPhoto` job handler, related tests and privacy text. Use a
  new migration. Nothing is deployed, so dropping is fine.
- Extend the Drive client interface and its fake (`lib/google/drive.ts`, `lib/google/fakes.ts`,
  `fake_*` tables) with `ensureFolder(path)` and `countFiles(folderId)`. No real Drive calls in dev
  or tests.
- **Folder access:** the photo drive is a shared drive the members can already open (as with the
  bot). Document that in `.env.example` and DECISIONS.md; do not add per-file sharing.

## B. ESN Activities uploads and their status (Comms)

The bot collected the data that the activities.esn.org form *Register your physical activity*
needs. PR then filled that form in their own Chrome with a Tampermonkey script and linked the
activity back. None of this was ported. ESN Activities has no API and Cloudflare blocks server
requests, so keep the browser-script approach.
- **Data collection:**
  - The ESN type of activity and the objectives are already kept on the description (DECISIONS,
    milestone 4).
  - Add the **event report** after the event, filled in by the OC (or Events): international and
    local participants, organizers, goals reached, what went well, what could be better,
    accessibility needs. Port the fields and defaults from `src/Esn.gs`.
  - Put the report on the Hand-in tab, as a checklist item, and in the cycle's Hand-in step.
  - Prefill participants from the attendance list's headcount where possible.
- **ESN form data:** a pure, unit-tested builder in `lib/esn/` (port of the bot's "ESN form data"
  from `src/Esn.gs`).
  - Input: title, dates, address parsed from the venue, link, goal (hook and first sentences),
    description, target audience, funding from the price, the per-type accessibility and
    sustainability defaults, and the report.
  - Output: the data plus the list of missing fields.
- **Browser script:**
  - Port `tools/esn-activities/mesa-esn.user.js` into this repo (`tools/esn-activities/`). It reads
    the form data from the platform and fills the form; nothing is submitted. After PR saves, a
    "Link to MESA Events" box posts the activity URL back.
  - Auth: cookies are not sent from activities.esn.org.
    - Each Comms member creates a **personal access token** on an "ESN Activities" settings page
      (shown once, stored hashed, revocable, logged).
    - API routes `GET /api/esn/events/[id]` and `POST /api/esn/events/[id]/linked` accept it as a
      Bearer token.
    - CORS is allowed only for `https://activities.esn.org`, and there are rate limits.
  - Add an install page with steps, like the bot's install page.
- **Manual fallback:** Comms can paste the ESN activity link and mark the event uploaded by hand.
- **Status per event:**
  - `not ready` (report or required fields missing, listed);
  - `ready to upload`;
  - `uploaded` (link, who, when).
  - On "uploaded", post to the event's Chat space through the jobs queue (once), as the bot did.
  - Activity log entries for every change.
- **Tests:**
  - unit tests for the builder and the address parsing (use the bot's cases);
  - DB/RLS tests: token storage, only Comms/Events/executives read the status, only Comms
    sets it;
  - API route tests: bad, revoked and expired tokens, CORS, and that a token never reaches
    another user's data;
  - E2E for the report → ready → manual link flow.
- The bot's Telegram and pretix uploads are **not** in scope (pretix is still an open design
  question).

## C. Comms and Events pages: one month at a time, organised by stage

The Comms page today lists all months together in buckets by description status (Awaiting review,
Approved, Late, Due, Missed, Published). It doesn't show where each event is in its life.
- **Month selector at the top** of `/team/comms` and `/team/events`:
  - `?month=YYYY-MM`, with ← → arrows and a dropdown of the cycles;
  - defaults to the first month that still has work (usually next month);
  - remembers the last choice per viewer (try/catch around storage);
  - on the Events page, "+ Plan a new month" sits in the dropdown.
  - Each page then shows **only that month's events**.
- **Comms page by stage:** one row per event of the month with a stage track (same visual
  language as the claim steps and the cycle stepper):
  Description **To write → In review → Approved → Published** → Event happened → **Report** →
  **ESN Activities uploaded**.
  - The current stage is highlighted, and its action is inline: Review, Publish, Remind OC, Open
    ESN form, Paste link.
  - Above the list, stage filter chips with counts ("In review 2 · Ready to publish 1 · ESN to
    upload 3"), plus a "Needs Comms" filter that is on by default.
  - Late and Missed become marks on the row (red "late", grey "missed"), not separate lists.
  - The month header shows progress ("5 of 8 descriptions in · 2 of 6 on ESN Activities").
- **Events page:** for the selected month, show the cycle stepper (from the previous rounds) with
  its main action, then that month's events with their status, staffing, description and hand-in
  stage. The separate cycle page can stay as the detail view (schedule, form, roster), reached
  from here, or be merged; decide by what is less clicking.
- The Home team queues link to the right month (`?month=`).
- Phone width (375 px): the stage track collapses to the current stage plus "n of m".
- E2E: switching months, the filters, the inline actions.

## D. Ideas: inspiration from previous events

On `/ideas`, add a **"Get inspired"** search over previous events, so members proposing ideas see
what worked before.
- Reuse `lib/description/search.ts` (the ported bot search: word starts, synonyms, umlaut
  folding, repeats grouped with "+N earlier").
- Filters: event type, season or month of year, "had a big turnout".
- Each result shows the title, the date(s), type, hook and first lines of the published
  description, the headcount from the attendance list, how often it ran, and the Drive photo
  folder link when there is one.
- **"Propose this again"** prefills the idea form (title, pitch from the hook, helpers needed,
  type suggestion) with a fresh date.
- Visible to all members. Show only what members may already read: published descriptions and
  headcounts, never names, claims or notes. Check with RLS or a definer function and an RLS test.
- **History from the bot:**
  - Add `npm run import:bot-archive -- <file>`, which imports past events from an export of the
    bot's database Sheet (semester tabs; the column layout is in the bot's README and
    `src/Database.gs`).
  - Input is a CSV/JSON file; this round makes no Google API calls.
  - Imported events are marked as history (completed, no cycle, `source = 'bot_archive'`) so they
    never touch workflows, staffing or reimbursements.
  - Write a fixture and tests.
  - Document how to export the Sheet.

## Done when

A–D are implemented with tests (unit, DB/RLS, API routes, E2E for the new flows); `lint`,
`typecheck`, `gen:actions --check`, unit, DB, E2E, the bundle scan and `docker build` pass. After
the suites the local database holds only the demo data, and the demo seed covers the new features:
- Drive folders and photo counts in the fake;
- an event report;
- one event uploaded to ESN Activities;
- some imported history for the inspiration search.

SPEC.md, DECISIONS.md, PROGRESS.md and `.env.example` are updated, and every part is committed
to local `main`. Nothing is pushed or deployed, and there are no real Google or ESN calls.
