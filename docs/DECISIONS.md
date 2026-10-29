# Decisions

Decisions taken while building Phase 1 autonomously (the user was not available). Each entry:
date, decision, why. `docs/SPEC.md` stays authoritative; these fill its gaps.

## 2026-10-28 – Milestone 1 (foundation)

- **Own local Supabase ports (544xx) and project id `mesa-events`.** MESAttendance's stack was
  running on the default 543xx ports; a second stack on other ports leaves it untouched.
- **Versions:** Next.js 16.4.3 / React 19.3.1 (latest 16.x, newer than MESAttendance's 16.1.6 for
  security fixes), Vitest 4 and TanStack Table 8 (the APIs MESAttendance and shadcn examples use;
  Vitest 5 / Table 9 are fresh majors), Supabase CLI 2.121.0 as in MESAttendance.
- **shadcn/ui components are written by hand** (`components/ui`) in shadcn's pattern (cva +
  tailwind-merge) instead of running the shadcn CLI, which downloads from an external registry.
- **Confidentiality gate kept for everyone.** MESAttendance's organiser confidentiality rules
  (accepted once, versioned) now gate the whole member area, because any member can become OC or
  helper and see attendance lists. `is_workspace_member()` = Workspace Google account + accepted.
- **Roles:** team roles live in `role_members` (`source` = `group` from the Google group sync, or
  `manual` added by an admin, surviving syncs). Group addresses are env variables `GROUP_*`. The
  Treasurer counts as Finance (`has_role('finance')`). Executives are a role (replacing
  MESAttendance's `executives` table). Admin (IT) gets settings, role mapping and the jobs view,
  not data access. Roles are re-checked at each login (like MESAttendance's executive check) and
  synced daily by a pg_cron-enqueued job.
- **"Team" visibility:** Events, Comms, Finance/Treasurer and executives read every event
  (`is_team()`); members read events once they are on the calendar (not drafts/dropped); OC and
  helpers always read their own events.
- **Rosters are visible to members only after the month's allocation is confirmed**
  (`roster_published()`); before that only teams and the person themself see an assignment.
- **OC may edit their own event's details** (location, time, price, capacity, ends) and decide
  whether an under-staffed event runs (`understaffed → confirmed/cancelled`); title, type, helper
  count, cycle and Chat fields are Events-only (`guard_event_update` trigger).
- **No deletes through the API** for cycles, events, series, settings, logs, jobs (as
  MESAttendance: proof must not be destroyable by a stolen session). Events may delete
  assignments while adjusting the roster.
- **Activity log is written only by triggers / definer functions**, never by clients; bank details
  are stripped from logged rows.
- **Jobs queue:** one row per idempotency key; "coalescing" jobs (membership syncs) run again when
  re-enqueued after finishing, and once more if re-enqueued while running (`rerun`). Exponential
  backoff 1, 2, 4 … minutes (max 1 h), dead after `max_attempts` (6); admins retry dead jobs.
  pg_cron runs `private.invoke_job_runner()` every 30 seconds, which POSTs to the app via pg_net
  only when jobs are due. URL and secret live in `private.config` (a schema the API cannot see),
  not in the migration; locally the seed sets them.
- **Google clients pick themselves:** real fetch-based clients when a service account is
  configured, otherwise database-backed fakes (`fake_*` tables, service role only) so the whole
  workflow can be run and inspected locally. `GOOGLE_MODE=fake|real` overrides. Unit tests use
  in-memory fakes.
- **Chat API acts as a Workspace user via domain-wide delegation (`GOOGLE_CHAT_SUBJECT`)**, because
  creating spaces and managing members needs user authentication. Not verifiable locally.
- **Local test sign-in is impossible in production builds:** `localLoginEnabled()` returns false
  whenever `NODE_ENV === "production"` (inlined by `next build`), in addition to MESAttendance's
  flag + local-URL checks. The route answers 404 then. The login page lets you pick any seeded
  role.
- **DB tests sign JWTs with the local stack's secret** for the seeded users' real ids instead of
  password sign-ins (PostgREST checks only the signature), which avoids Auth rate limits; E2E
  tests use real password sessions. Local Auth rate limits are raised in `supabase/config.toml`.
- **CSP with a per-request nonce** (`'strict-dynamic'`), set in `proxy.ts`; the root layout reads
  `headers()` so every page renders per request and gets the nonce. No `'unsafe-inline'` scripts.
- **Server actions** are defined once as `(ctx, input)` functions (`lib/actions/*`) that validate
  with zod and check roles from the database (`my_context()`), and are exported from
  `"use server"` files through `run()`. This makes the server-side authorization testable with
  any member's context; RLS checks again underneath.
- **Times:** all input and display in Europe/Berlin via `@date-fns/tz` (`lib/dates.ts`), whatever
  the browser/server zone (unit tests run with `TZ=America/New_York` to prove it).

## 2026-10-28 – Milestone 2 (planning cycle)

- **Volunteer ranks:** per event, an OC rank and a helper rank of 1 = "top choice", 2 = "happy
  to", 3 = "if needed" (or no). Allocation takes rank 1 first.
- **First come, first served per choice:** each event on the form keeps the time it was first
  added (`volunteer_choices.chosen_at`); changing a rank keeps it, adding an event later gets a
  later time. Fairer than one time per response (which could be gamed by an early, empty
  submission). The first submission time is stored too (`submitted_at`).
- **Allocation details** (`lib/allocation.ts`): events are independent (no caps); the idea's
  proposer is OC by default when they ticked "I want to be OC"; someone who only ranked OC is not
  made a helper; the final tie-break is the profile id, so the result never depends on input
  order; helpers but no OC → `no_oc` (Events assigns one); overlapping assignments of one person
  are reported, not prevented.
- **Allocation runs in the app, is saved by a definer function** (`save_allocation`) which
  replaces the cycle's assignments, so re-running before confirmation is safe. Confirmation sets
  each event's status from its actual staffing (dropped / under-staffed / confirmed).
- **Cycle status changes only through functions** (`open_volunteer_form`, `close_volunteer_form`,
  `save_allocation`, `confirm_allocation`); a trigger refuses direct status updates. pg_cron
  closes forms whose deadline passed (every minute).
- **Roster board:** dnd-kit drag and drop plus a "Move to…" select on every card (keyboard and
  screen-reader friendly, and what the E2E test uses). Moving someone to OC makes the previous OC
  a helper.
- **Ideas are moved between months by changing their date**; the month's cycle page lists ideas
  dated in that month.
- **Activity log has no foreign keys** (entries outlive deleted events) and is kept until the end
  of the third calendar year (cron).

## 2026-10-28 – Milestone 3 (Chat spaces)

- **Space description vs. mentions:** Chat space descriptions are plain text with at most 150
  characters, so the description holds the date and the OC's name; the @-mentions of OC and
  helpers are in a welcome message, and the full roster in the space guidelines.
- **Who is invited:** active OC and helpers plus everyone with the Events or Comms role
  (individually, from `role_members`). The platform records whom it added
  (`event_chat_members`) and removes only those people, never members added by hand in Chat.
- **Membership sync is one coalescing job per event**, re-run on every roster or team change.
- **Staffing follows dropouts and claims:** a dropout makes a confirmed event under-staffed, a
  claim that fills the last slot makes it confirmed again. The OC's explicit decision
  (run/cancel) is still possible on an under-staffed event.
- **Notifications:** dropouts and claims are posted to the space (@-mentioning the OC) and sent
  to the OC as a direct message, unless the admin setting `chat_notifications` is off.
- **Trusted definer functions mark their own event updates** with a transaction-local setting
  (`mesa.system_update`, `mesa.cycle_transition`); PostgREST cannot set these, so clients still
  hit the guards.

## 2026-10-28 – Milestone 4 (descriptions)

- **Port of the bot is literal** (template, emojis, headings, TBA, normalisers, messages); the
  only change is that impossible dates (30 February) are refused. The ESN Activities type and
  objectives are kept (they were required fields in the bot).
- **Who edits:** the OC, the Events team and the Comms team (Comms may fix typos during review
  without sending it back). Helpers read. Submitting: OC or Events. Reviewing and publishing:
  Comms only.
- **Autosave merges per field** (`save_description(event, patch)`), so two editors working on
  different fields never overwrite each other; others' changes arrive through Realtime and
  presence shows who else is editing. No CRDT/Yjs (per spec).
- **Every change after approval or publication needs a new review**; publishing then edits the
  same Chat message (fixed client message id), never posts a second one.
- **@all:** the description is posted with `<users/all>` appended; if that would exceed 4,096
  characters, @all is posted as a separate short message. The editor's counter counts the Chat
  text as in the bot.
- **Members can read published descriptions** (for templates from past events); drafts only the
  event's staff and the teams.

## 2026-10-28 – Milestone 5 (attendance)

- **One attendance list per event** (`attendance_lists`, created by trigger), instead of
  MESAttendance's columns on `events`.
- **Who runs a list:** the event's OC and helpers and the Events team (MESAttendance: every
  organiser). Names while open: those people; closed lists: executives only (unchanged). Numbers:
  staff and all teams (Finance checks counts).
- **Sign-off:** by the event's OC (MESAttendance: the creator); the Events team only when the
  event has no OC.
- **Retention deletes the list, not the event** (the event carries receipts that must be kept
  longer).
- **Visitors have no SELECT privilege on participants at all** (RLS alone in MESAttendance), so
  Realtime refuses their subscription instead of sending nothing.
- **Digital lists for every event type**, with a warning on trips that LMU-funded trips still need
  the paper list (MESAttendance's rule).

## 2026-10-28 – Milestone 6 (hand-in and reimbursements)

- **Rules as versioned data** (`reimbursement_policies` + `reimbursement_rules`, version 1 = the
  SPEC table). The Treasurer publishes a whole new version with an "in force from" date; a claim
  uses the version in force on its **event's date** and stores it. Rates in basis points, money
  in integer cents, half-up rounding.
- **One formula, two implementations:** `lib/reimbursement.ts` (UI preview, unit tests) and
  `public.suggest_reimbursement()` (the stored suggestion – a client cannot inject its own
  number). A DB test compares both over every rule, role, amount, day count, pre-approval and
  budget combination.
- **Allowances** ("€16 / €8") are modelled as 100 % with a cap, per day on weekend trips; days
  default to 1. Further expenses without an approved pre-approval suggest €0; social ancillary
  costs suggest at most what is left of the trip budget (€0 without a budget). Finance confirms or
  overrides in every case.
- **Who claims:** the event's active OC and helpers. **Who sees receipts, claims, bank details:**
  Finance (incl. Treasurer) and the claimant only – not the OC, not executives, not admins. The
  event's people see counts (`event_claims_summary`).
- **Bank/PayPal details** live in their own table per claim and are deleted when the claim is paid
  or rejected (trigger). Checking a claim requires them.
- **Statuses** follow the spec; "checked" claims join the open batch of the current month (the
  next month's if that one was paid). Above the `early_payout_threshold_cents` setting (default
  €100) Finance can pay a checked claim at once ("Pay early").
- **Trip budgets** are set by Finance (incl. Treasurer) before the weekend trip starts; the
  Treasurer alone decides pre-approvals.
- ~~**Receipt photos** in a private `receipts` bucket~~ – removed in the 2026-10-28 review (A2):
  the paper Beleg is mandatory, so receipts are tracked as data only.
- **Event photos** are uploaded to the private `event-photos` bucket (15 MB), then a job copies
  them to the event's Drive folder and deletes them from Storage. Real Drive upload cannot be
  exercised locally (fake Drive client records the files).

## 2026-10-28 – Milestone 7 (dashboards, tests, packaging)

- **E2E runs against the production standalone build** (`build:local` + `start-standalone`), not
  the dev server, so CSP, headers and "no local sign-in in production" are tested as shipped.
  Sessions are real Supabase Auth sessions put into cookies. One step "time-travels" an event's
  start (service role) to open its attendance list.
- **Local sign-in is removed from production bundles at build time** (`NODE_ENV` guard around the
  login markup); the bundle scan enforces it.
- **Explicit environment wins over local defaults** in `scripts/start-standalone.mjs` (Playwright
  sets `APP_BASE_URL` for links in Chat messages).
- **Docker image** runs as a non-root user, copies `legal/` (texts are read at runtime) and takes
  the `NEXT_PUBLIC_*` values as build args.
- **Checklist** rules live in a pure function (`lib/checklist.ts`) so they are unit-tested;
  cancelled events only list open receipts.

## 2026-10-28 – After hand-over

- **`dev:local` removes `.next/standalone` before starting.** A production standalone build left
  in `.next` by `build:local` / the E2E run made the dev server reload every page in an endless
  loop; the E2E run rebuilds it anyway.

## 2026-10-28 – Review round (docs/REVIEW-2026-10-28.md)

Implemented autonomously after the code review and UI walkthrough; the user was not available.

- **A1 – Locked volunteer form.** `submit_volunteer_form()` inserts the response once and refuses
  a second submission (`23505`, "You already submitted this form"). FCFS ties use
  `volunteer_responses.submitted_at` for all of a person's choices; `volunteer_choices.chosen_at`
  was **dropped** rather than kept in sync (one source of truth). The earlier "time per choice"
  decision (milestone 2) is superseded: with one submission per person it cannot be gamed.
- **A1 – Escape hatch:** the Events team clears one person's response on the cycle page
  (`clear_volunteer_response(cycle, profile, reason)`), **only while the form is open** (after
  the deadline the person could not resubmit anyway, and clearing would only lose data). A reason
  is required; the activity log records who cleared whose answers, when the original was
  submitted, how many events and why (cycle entry, no event id, so only Events, executives and
  admins read it). The person then submits again and gets a new submission time.
- **A2 – No receipt photos.** The `receipts` bucket, its policies, `receipts.reference_path`, the
  photo parameter of `register_receipt()` and the download route are gone. The migration deletes
  any stored objects with `storage.allow_delete_query` (nothing was deployed; on a stack with
  photos, remove the files with the Storage API first). Hand-in photos are unchanged.
- **B1 – Activity log by entity.** Claim entries (`entity = 'reimbursements'`) are readable by
  Finance (incl. Treasurer) only – and, since C4, executives (read-only) – never by the event's
  OC, helpers, the Events team or admins. Other entries: Events, executives, admins; the event's OC and helpers only for
  entities they can read anyway (event, roster, description, reviews, attendance list). Idea
  entries are no longer shown to event staff (pitch and decision note are the proposer's and the
  teams').
- **B2 – Drop-out reasons in their own table** (`assignment_drop_reasons`, OC of the event and
  Events only), written by `drop_out()`. Chosen over column privileges on `assignments`, which
  would break `select *` and embedded selects everywhere. The log only notes that a reason was
  given; existing log entries were scrubbed.
- **B3 – Dates are Events-only;** location, price and capacity stay OC-editable: the OC books the
  venue and knows the ticket price and capacity, and none of them affects planning, the form or
  which reimbursement policy applies.
- **B4 – A stale running job (worker died) with `attempts >= max_attempts` is marked dead** with
  a "gave up" note instead of being claimed again; admins retry it from the Admin page.
- **B5 – Revalidation is declared per action** (`defineAction(schema, handler, { revalidate })`,
  named pages in `PAGES`), applied by `run()`; the generated wrappers only call `run()`. Only
  actions that change the navigation (open/close/submit the volunteer form, manual roles)
  revalidate every page; description autosave revalidates nothing. The client still refreshes
  the page it is on after an action (`useAction`).
- **B6 – CI files only** (`.github/workflows/ci.yml`): checks, DB tests with a types-drift
  check, build + bundle scan + E2E, Docker build and smoke test, all against a local Supabase in
  the runner. Nothing pushed; no remote configured.
- **B7 – `seed:demo` deletes everything in its own cycles** (also events added there by hand,
  with their claims) before deleting the cycles.
- **C1 – Home at `/`** (and the logo). Order: volunteer form banner, my events with one next step
  each (`nextStep()` in `lib/checklist.ts`), open slots, my claims that need payout details or the
  Beleg, then team queue cards. Executives get all three team cards (read-only views).
- **C2 – Cycles are named "December 2026 events" (planned in November)**; `planning_cycles.month`
  is the month the events take place in. The database refuses an event outside its cycle's
  Berlin calendar month (insert, date change, cycle change) and a month change of a cycle with
  events – for members and teams; like the other guards it does not apply to the service role
  (seed, tests, jobs), which keeps the existing test fixtures (random far-future months).
- **C3 – Navigation:** personal (Home, Calendar, My events, Ideas, Volunteer only while a form is
  open, with a badge until answered) and a separate "Team" group (Events, Comms, Finance, Admin).
  Phones get a "Menu" button that opens both groups instead of a sideways-scrolling bar.
- **C4 – Executives read Finance** (receipts, claims, batches, pre-approvals, trip budgets, claim
  log entries) **read-only; bank and PayPal details stay Finance's and the claimant's.** Supersedes
  "not executives" for claims in milestone 6. Team pages send signed-in members without the role
  to a **No access** page (redirect, 200) – the role pages' existence is no secret; pages of one
  record (a cycle, a batch, an event) still answer 404 so ids give no hints. `forbidden()` was not
  used because `authInterrupts` is canary-only in this Next.js version.
- **C5 – Breadcrumbs via `?from=`** (home, me, calendar, events, comms, finance, `cycle:<id>`),
  whitelisted so the parameter cannot become an open redirect; tabs keep it. The next-step banner
  is shown on every tab for the event's OC and helpers. Activity is described in plain language
  for everyone who may read it; the raw log is a collapsed "Raw log" for Events, executives and
  admins. The plain text never names who dropped out (only that someone did).
- **C6 – Receipts and hand-in photos open on the day of the event** (Berlin date) in the UI;
  before that the tab shows the status and why the forms are not there yet. Pre-approval requests
  for weekend trips stay available before the trip (they must come before the purchase). The
  database does not enforce the day (Finance may need to register late or odd cases).
- **C7 – Claim amounts are labelled** Receipt amount / Suggested / Approved / Paid (Paid is the
  approved amount once paid, else "–"); progress Registered → Beleg received → Checked → Paid, a
  rejected claim shows "Rejected" at the step it reached.
- **C8 – A description is late** when the cycle's deadline passed or the event started (in
  `description_overview()`, so the Comms page, Home and checklist agree). Progress per cycle
  counts submitted, approved and published as "in".
- **C9 – Cycle steps are derived, not stored** (`lib/cycle.ts` from status and counts): Ideas
  (planning, no events) → Schedule (planning with events) → Volunteer form → Allocation (form
  closed) → Roster confirmed (allocated, waiting for confirmation) → Descriptions (confirmed, until
  all are in).
- **C10 – Cause of "Unsaved changes" after loading:** with no description yet, the editor marked
  every prefilled field dirty on load but scheduled no save. Now a new description shows "Not
  saved yet – prefilled from the event" and the prefill is saved with the first edit.
- **C11 – Shared pieces** (`components/status.tsx`: status chips, `Stepper`; `ClaimItem`;
  `formatShortDate` / `formatDue`) and a Playwright check that every role's main pages do not
  scroll sideways at 375 px.

## 2026-10-29 – Review round (docs/REVIEW-2026-10-29.md)

Implemented autonomously after the second review; the user was not available.

- **A1 – The decision is stored on the event** (`understaffed_decision = 'run'`, by, at), written
  only by `decide_understaffed()`; a guard refuses the columns (and any status change by the OC)
  from clients. `refresh_staffing()` keeps a short event confirmed while it is set. It is cleared
  whenever the event loses its active OC – drop-out, removal, role change or the Events team
  swapping the OC on the roster board – so the new OC decides again. **"Run it anyway" needs an
  OC** (refused otherwise): someone has to own a running event. Staffing is now refreshed by a
  trigger on every roster change, which also covers the Events team's roster edits after
  confirmation (before, those did not update the status).
- **A2 – Who cancels:** the Events team any confirmed or under-staffed event that has not started
  (with an optional reason, ≤ 300 characters, posted to the space); the OC only an under-staffed
  one, through the decision (reason "Not enough people"). Status changes to and from
  `cancelled` go only through `cancel_event()` / `reopen_event()`, also for the Events team, so
  nobody can skip the message. One `chat.event_status` job per cancellation (idempotency key with
  the cancellation time), the space message @-mentions OC and helpers and says receipts stay
  valid. **Without a space, OC and helpers get direct messages – regardless of the
  `chat_notifications` setting**, because there is no other channel. Reopening (Events only, not
  after the start) returns to the status the staffing gives, clears the earlier decision (it
  was cleared on cancelling) and posts "back on"; a later job for an older state skips itself.
  Comms sees cancelled events whose description was published until someone marks them
  **Handled** (`note_cancellation()`); Comms decides about a correction outside the platform.
  Claims are untouched.
- **A3 – "Completed" by a plain SQL function on a pg_cron schedule** (every 15 minutes, no job
  needed: nothing goes outside the database). End = `ends_at`, else start + 1 day. Completed is
  final. Every hand-in path already accepted completed events (checked by grep and a DB test).
  **My events:** Today = starts on today's Berlin date or is still running (trips); Past events
  are labelled from the person's next step: "Hand-in open" while it is an action, else "Done"
  (cancelled: "Cancelled", unless Belege are still missing).
- **A4 – An event is handed in** when its attendance list is signed off, at least one photo is
  handed in and no Beleg is outstanding (the same rule as the OC's next step). Cancelled events
  do not count for the cycle (Finance chases their Belege). The Descriptions step counts only
  events still ahead, so a past cycle never asks for reminders. **Done** = every running event
  happened and is handed in (or none ran). Progress is computed for every cycle (confirmed ones
  skip the ideas/answers queries, so the cost stays flat over the years); done cycles are a
  collapsed "Past cycles" list and leave the Home queue and the Comms per-month progress. The
  cycle page lists the events not handed in with what is missing.
- **A5 – Latest form deadline: the first day of the cycle's month, 23:59 Berlin** ("not after
  the first day", matching the form's existing default of the 1st, 23:59). **Latest description
  deadline: the first event's start** (dropped and cancelled events do not count). The reverse is
  refused too: adding or moving an event (or bringing one back) before an existing deadline.
  Like the other guards these apply to members and teams, not to the service role; the seed now
  computes its deadlines (two days before a cycle's first event at the latest).
- **A6 – Late = deadline passed and the event still ahead; Missed = started without a published
  description** (also submitted or approved ones – publishing afterwards makes no sense). Missed
  rows leave the review, publish, late and due lists; the Comms page shows the last 60 days of
  them collapsed. Supersedes C8's "late once the event started".
- **A7 – The test tag:** cycles in test months (before 2020 or from 2040 on) and rows the test
  helpers create with `created_by = tests@mesa.invalid`. `scripts/clean-test-data.mjs` removes
  them with their dependants (claims and receipts first, jobs, log entries, fake Google rows),
  plus jobs and fake Chat rows of events the tests deleted themselves and payout batches left
  without claims; both suites run it before and after (vitest `globalSetup`, Playwright global
  setup/teardown) and `npm run clean:test-data` runs it by hand. Activity-log rows of events the
  tests deleted themselves stay (the log outlives events by design). **The monthly E2E's time
  travel takes the quiz out of its far-future cycle** (an event without a cycle is valid) instead
  of borrowing the current month's cycle, which may exist already (the month is unique, e.g. the
  demo's); the cycle hand-in E2E uses a past test month whose events really happened. The DB
  tests' shared world still puts near-dated events into far-future cycles through the service
  role; it never reaches the dev UI because it is removed after the run.
- **B1 – After payout only the method is left** ("Paid to your PayPal account"): the details are
  deleted when a claim is paid.
- **B2 – The team part is counts only** (receipts and outstanding Belege), never names or
  amounts; team members who are not on the event see the event's counts.
- **B3 – `plural(n, one, many?)` and `isAre(n)` in `lib/plural.ts`**, used everywhere; this also
  changes the ported bot warning "The intro has n sentence(s)" (the only message of the literal
  port that changed). A unit test fails when "(s)", "(e)" or an inline plural comes back.
- **B4 – Each next step names its section** (`anchor`); on its own tab the banner says "Go to it
  ↓" and scrolls there, elsewhere it links to tab + section.
- **B5 – The badge goes where the steps are shown** (hand-in "Your receipts"); a claim still
  waiting for its Beleg says what to do. The Finance table and Home keep their badges (no steps
  there).
- **B6 – Wording per viewer:** the OC, the Events team ("can decide in the OC's place") and
  everyone else; without an OC "the Events team decides", and only cancelling is offered.

## 2026-10-29 – Staging (docs/BRIEF-2026-10-29-staging.md)

Implemented autonomously; the user was not available. How to set it up and present: `docs/STAGING.md`.

- **Two variables, both must say staging.** `NEXT_PUBLIC_APP_ENV` (build) and `APP_ENV`
  (runtime); unset means production in builds and development in `next dev`. `next.config.ts`
  always defines `NEXT_PUBLIC_APP_ENV` (`env`), because Next.js inlines a `NEXT_PUBLIC_` variable
  only when it is set at build time – the bundle scan found the staging link in a production
  build while it was unset. Staging-only code is guarded by the literal
  `process.env.NEXT_PUBLIC_APP_ENV === "staging"`, so production builds drop it.
- **The project ref** is the subdomain of a hosted project (`https://<ref>.supabase.co`), otherwise
  host and port of the URL (self-hosted, the local stack `127.0.0.1:54421`), so the same gate works
  for every target. Look-alike hosts (`<ref>.supabase.co.evil.example`) are not the project.
- **Boot check** in `instrumentation.ts` (Node runtime only, `lib/staging/boot.ts`): a staging build
  or runtime exits with a list of problems if build and runtime disagree, a gate fails,
  `GOOGLE_MODE` is not `fake`, `GOOGLE_SERVICE_ACCOUNT_*` or `TELEGRAM_BOT_TOKEN` is set, or the
  access code is shorter than 16 characters. It checks the Supabase URL the build baked in.
  `googleMode()` returns fake whenever `APP_ENV=staging`, whatever else is set (Telegram does the
  same in `telegramMode()`).
- **Banner** in the root layout, a server component, on every page (login, public forms and
  legal pages included). **"Switch role" and "Demo outbox" sit in the banner**, not in the member
  header: the banner is on every page, and the member layout belongs to the logo round.
- **robots.txt disallows everything in every environment** (an internal tool, and the public
  attendance form links should not be indexed either); `X-Robots-Tag: noindex, nofollow` only on
  staging (proxy, and next.config headers for static files in staging builds).
- **Demo outbox** (`/admin/demo-outbox`): staging and development only (404 in production builds),
  for **any signed-in member** – presenters switch roles, and the fakes hold demo data only. It
  reads the `fake_*` tables with the service role, newest first, with filters; mentions become
  names, semester folders are left out.
- **Demo sign-in** (`/staging`): server-rendered with plain forms and two route handlers, so no
  client code exists that a production build could carry. The code is compared in constant time
  (SHA-256 of both, `timingSafeEqual`); failed attempts are limited to 5 per client and 30 overall
  per 15 minutes, in memory per server instance (enough with 16+ characters; on Vercel each
  instance counts its own). A correct code sets a browser-session cookie (httpOnly, SameSite=Lax,
  Secure on https) holding an HMAC of the code and the project ref, so changing the code locks
  everyone out again.
- **Demo members sign in with a password derived from the service-role key** (HMAC per address).
  The anon key is public and the Email provider must be on for password sign-in, so a known
  password would let anyone skip the access code. Ten personas (one per role, plus a newcomer)
  map to members of the cast.
- **Demo members are created by a database function** (`staging_upsert_demo_user`): Auth's admin
  API creates users with provider "email", which the Workspace-only signup trigger refuses. The
  function inserts them as Google sign-in would, service role only, and only for addresses whose
  local part ends in `.demo` – it cannot touch a real member's account.
- **The database must be marked as a demo database** (`private.config` `environment` = `staging`,
  or `development` – set by `supabase/seed.sql` locally). Creating demo members and wiping refuse
  otherwise, so even a staging app pointed at the production database by mistake cannot wipe it.
  It is set by hand on the staging project, never by a migration.
- **The wipe** (`staging_wipe`) truncates a list of workflow tables and keeps members, accepted
  rules, team roles of real accounts, settings, the first rules version and the publication
  channels; demo members' roles and acknowledgements go (the seed adds them again). A table in
  neither list makes the wipe refuse, and a DB test checks the plan, so a new table needs a
  decision. No `CASCADE`: a kept table referencing a wiped one fails loudly.
- **"Reset demo data"** is a server-rendered form posting to `/admin/demo-data/reset`, which runs the
  action through `run()` (admin role, every gate) – a client component would have put the card into
  production bundles. Confirmed by typing RESET (plus a same-origin check); logged as an
  `activity_log` entry `staging`/`reset` written after the wipe.
- **The seed is TypeScript in `lib/staging/`**, shared by the Admin button and the CLI. The CLI loads
  it with a small loader (`scripts/staging/ts-loader.mjs`: the `@/` alias, extensionless imports,
  TypeScript's `transpileModule`) – Node's own type stripping cannot handle constructor parameter
  properties, and Node 26 dropped `--experimental-transform-types`. It reuses the app's own code:
  the description template, Chat message texts, allocation, reimbursement rules, photo folder
  names, the bot-archive import and the Telegram message builder.
- **Deterministic:** a fixed random seed and fixed ids (events keep their URLs across resets); only
  dates move with today (Berlin). The current month's events are placed by days from today and kept
  inside the month; only when that would put a past event in the future (or the other way round)
  do they fall into the neighbour month.
- **Six cycles:** three done months (confirmed, handed in, claims paid), the current month
  (confirmed), next month allocated by `lib/allocation.ts` from the volunteer answers plus one
  manual OC/helper swap, the month after with the form open; ideas for the month after that.
- **`seed:staging` replaces only its own data** (tag `staging-seed.demo@<domain>`) and the small
  demo seed's, whose months it takes over; it refuses if a cycle it did not create occupies one of
  the months. Members stay across runs. `--remove` takes the demo out again.
- **What went out is recorded consistently:** Chat spaces, messages and DMs use the real message
  builders and the same message ids as the jobs; matching `done` jobs carry the jobs' idempotency
  keys, so the schedulers do not send reminders again; the seed's Telegram messages use ids
  90000–90999 in the fake channel; planned Telegram posts have their pending job, as the board
  creates it. The triggers' log rows from the seed are replaced by a timeline with plausible times
  and the people who acted.
- **Money:** suggestions from `suggestAmount()` with rules version 1; paid claims went out with
  their month's batch (paid on the 3rd of the next month), checked ones wait in this month's open
  batch, early payouts have no batch; payout details exist only for open claims; official example
  IBANs and `@example.com` PayPal addresses only.
- **The local stack:** the other suites expect the normal demo state (with the staging demo loaded,
  its Events and Comms members join every new Chat space and its events queue photo jobs). The DB
  test and the staging E2E record what was there and put it back.
- **The staging build goes to `.next-staging`** (`distDir` from `NEXT_DIST_DIR`), so it never replaces
  the production build the E2E and bundle scan use; Next.js added its type folders to `tsconfig.json`.
  Locally it runs on port 3200 with the gates for the local stack and a test access code
  (`scripts/staging/local-env.mjs`).
- **Hosting:** a separate Supabase project and a separate Vercel project (not a Vercel environment of
  the production project: the database, keys and domain must differ anyway). The VPS path builds the
  same image with `NEXT_PUBLIC_APP_ENV=staging` next to production (port 3001) and runs the seed from
  the Dockerfile's `tools` stage.
