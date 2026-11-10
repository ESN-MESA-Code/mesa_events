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

## 2026-10-29 – Drive photos, ESN Activities, month pages, inspiration, publishing (docs/BRIEF-2026-10-29-photos-esn-inspiration.md, docs/BRIEF-2026-10-29-publishing.md)

Implemented autonomously; the user was not available.

**A – Event photos in Google Drive**
- **The folder is a 1:1 table, `event_photo_folders`, not columns on `events`.** Only jobs and
  definer functions write it, so the event guard needed no new columns; it is read like the
  hand-in (the event's OC and helpers and the teams). It also holds the cached count
  (`photo_count`, `counted_at`, `count_error`) and the OC's tick (`marked_uploaded_*`).
- **`event_photos` is dropped**: it held one row per uploaded file, and the count now comes from
  Drive. The `event-photos` bucket, its policies, `add_event_photo()`, `lib/uploads.ts` and the
  upload job are gone (migration `20261029002000`). The privacy texts never mentioned hand-in
  photos, so they needed no change.
- **Folder path as the bot:** `<DRIVE_PHOTOS_FOLDER_ID>/<SoSe_26 | WiSe_26-27>/<yyyy-MM-dd Title>`
  (Berlin date of the start, slashes in titles become "-"). The name is fixed once created: a
  later title change does not rename it. The bot's `semesterFolderName_` gave "WiSe_-1-00" for
  January 2000; years wrap here. Existing folders of the same name are reused.
- **When:** `private.schedule_photo_jobs()` runs every 5 minutes (pg_cron) and enqueues, per
  running event: the folder from the morning of the event's day (the hand-in opens then);
  "📸 … starts now" within 12 hours of the start; "📤 … upload here" at **10:00 Berlin the day
  after the event ended** (multi-day trips: after the end, not mid-trip), for two days; and the
  count hourly for two weeks. Reminders only with a Chat space, each once per event (idempotency
  key and a fixed message id). The upload reminder asks for the event report (B) until it is in.
- **"Check again" goes through the jobs queue** like all Drive work (coalescing
  `drive.count_photos:<event>`); the page refreshes for up to a minute until the new count
  arrives. **Photos count as handed in** with at least one file (subfolders included, three
  levels) or the tick "Photos are uploaded" by the OC or the Events team, for when Drive cannot
  be read.
- **Drive scope is the full `drive` scope** (was `drive.file`): counting files that members
  uploaded needs it. The service account (or `GOOGLE_DRIVE_SUBJECT`) must be a member of the
  shared photo drive; members open the folders through their own access to that shared drive, so
  there is no per-file sharing.
- Locally the fake Drive has folders and files (`fake_drive_folders`, `fake_drive_files`);
  `npm run fake:drive -- <event id> [n]` "uploads" files to try the count.

**B – ESN Activities**
- **The event report is its own table** (`event_reports`), written by the OC or the Events team
  after the start and read by the event's people and the teams. The form is prefilled from the
  attendance list (headcount minus German nationality answers = international, German = local,
  from the anonymous counts) and the roster (active OC and helpers = organizers).
- **The builder is the bot's `esnFormData_`** with its ratings per type, funding from the price,
  the goal (hook and two intro sentences), the description HTML from the *published* (approved)
  fields and type/objectives from the current fields. Missing: published description, type,
  street/postal code, report, TBA price. **A TBA price is listed but does not block "ready"**
  (the fee can be typed into the ESN form). End date = the Berlin date of `ends_at`.
- **Personal access tokens** (`mesa_esn_` + 43 base64url characters, 256 bits): shown once,
  stored as SHA-256, valid 30/90/180/365 days (default 180), at most 5 active per person,
  revocable; creation and revocation are logged (label and prefix only). A token works only while
  its owner is in the Comms team (checked on every call). The API resolves it with the service
  role (`esn_token_owner`), returns event data only (no names, emails or claims) and links as the
  token's owner (`esn_api_link`).
- **CORS** allows `https://activities.esn.org` only; requests carrying another `Origin` get 403
  (Tampermonkey's requests carry none). **Rate limits** are kept in the server process (one app
  server on the VPS): 60 calls a minute per token, 20 failed attempts per 10 minutes per address.
- **The script** asks for the token on first use and keeps it in Tampermonkey's storage; right
  after creating a token the page offers the script with the token filled in (inserted in the
  browser, never sent back). The script file ships next to the server like `legal/`.
- **Who sees the status:** Comms, Events and executives (`esn_uploads`); only Comms pastes the
  link or takes it back. The first link posts "📢 Comms has uploaded … on ESN Activities" to the
  space, once per event. The cycle's Hand-in step and the OC's next step include the report.

**C – One month at a time**
- **The default month is the first one with work for that page's team**: Comms – something to
  review, publish or upload, or a late description; Events – a cycle that is not done and not
  just waiting for its events to happen. The viewer's last choice is remembered in
  `localStorage` (per page, try/catch) and wins when the URL names no month and the month is still
  offered. Comms offers months from six months back; the Events list offers every cycle.
- **Comms stages** (current = where the event is): To write → In review → Approved → Published →
  Event happened → Report → ESN Activities uploaded. A missed event (started without a published
  description) moves on to Report/ESN with its description stages left open and a grey mark.
  **"Needs Comms"** = in review, approved, ESN ready, or a late description (chasing). Filters are
  links (`?show=`), so they work without JavaScript.
- **"Remind OC"** is a new action (`remind_oc`, Comms or Events): a Chat message in the event's
  space mentioning the OC (a direct message without a space), at most once per event, topic and
  Berlin day; logged. Publishing from the Comms row shows "Publishing…" until the job ran.
- **Events page:** the cycle page stays the detail view (schedule, form, roster); merging would
  put three large boards on one page, and the month view links there in one click. The old
  cross-month "Coming up", "Short of people" and "Past cycles" lists are gone (staffing is on each
  event row; past cycles are in the month list, marked "done").
- **Phones:** the stage track shows the current stage and "n of 7".

**D – Get inspired**
- **History has `events.source = 'bot_archive'`** (and `archive_ref` = the bot's Event ID,
  unique): completed, no cycle, no roster, `helpers_needed` 0, and left out of the Comms
  overview, the photo scheduler and the calendar, so it never touches workflows, staffing or
  reimbursements.
- **What members see** comes from `inspiration_events()` (definer, accepted members only): the
  published title, hook, intro, venue and price, the date and type, the headcount (signed-off
  list, else the report's international + local) and the Drive folder link. Never names,
  rosters, claims or notes.
- **"Big turnout" = 30 people or more.** Seasons are meteorological (December–February …).
- **"Propose this again"**: the title without "#2" or years, the pitch from the hook and first
  intro sentence plus "Ran before: …", helpers (2 for history), the type as a suggestion
  (`event_ideas.type_suggestion`, preselected when Events accepts the idea), and a **fresh
  date**: the same day of the year, at least two weeks ahead, moved to the same weekday.
- **The import reads an export, no Google API:** one CSV per semester tab (File → Download →
  Comma-separated values, once per tab) or one JSON file (`{ "<tab>": [[header…], [row…]] }`),
  columns found by their header names (the bot's `DB_COLUMNS`). Rows still ahead are skipped; a
  second run updates (by Event ID). The description fields are read back from the rendered text
  (hook, intro, program, bring, closing); the report and the ESN link come from "ESN form data"
  and "ESN Activities link". It writes with the service role: the local stack, or the project in
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

**E – Publishing channels and the schedule** (docs/BRIEF-2026-10-29-publishing.md)
- **Channels are data** (`publication_channels`): chat (auto), telegram (auto), instagram and
  pretix (manual), esn (manual, through B). Chat and ESN Activities follow their own flows and have
  no lane on the board (`schedulable = false`). Admins switch channels on and off.
- **The status per event and channel is derived**, not stored (`publication_status()`): Chat from
  the description (approved = planned, published), ESN from `esn_uploads`, the others from the
  posts (published before planned (the earliest) before skipped). Staff and teams read it.
- **Posts** (`publication_posts` + ordered `publication_post_events`) are written only through
  Comms' definer functions; every change bumps `version`. A planned Telegram post has one job
  `telegram.publish_post:<post>:<version>` with `run_after` = its time; an older version's job
  skips itself. A change to a published Telegram post (edit, publish again) runs at once and edits
  the same messages. Published posts cannot be deleted (they are the record); a post without
  events is removed.
- **Telegram as in the bot:** bold title + the rendered description (HTML), or for a bundle a
  heading and a short block per event (title, date, price, and the pretix link once a pretix post
  is published). Pictures: one photo post when the text fits 1,024 characters, else the photo
  (caption: the title) followed by the text; a layout change deletes and reposts. **Refused**
  (the reason on the card, no retry): an unapproved description, a TBA price, more than 4,096
  characters, an unusable picture.
- **No HEIC conversion.** The bot used Drive's thumbnail rendition (Apps Script); here that would
  need a native image library (sharp/libheif) in the image. Drive pictures must be JPG/PNG/WebP up
  to 10 MB (refused with a clear message otherwise); image URLs are passed to Telegram as they are.
- **Telegram client:** the Bot API with `TELEGRAM_BOT_TOKEN` (+ `TELEGRAM_CHAT_ID`, optional
  `TELEGRAM_TOPIC_ID`); without a token, on staging or with `TELEGRAM_MODE=fake` the
  `fake_telegram_messages` table. No real Telegram call was made.
- **The first publication of an event on a channel** (Telegram by the job, a manual channel by
  "Mark published") posts "📢 Comms has published *Event* on <channel>" to its space, once.
- **Board layout:** lanes are rows and the month's days are columns; the board scrolls sideways
  inside its frame (the page does not), which works at 375 px. A dropped post gets 10:00 Berlin;
  "Plan…" and "Move to…" set day and time. Realtime (`postgres_changes` on both tables) refreshes
  the board for everyone on it; presence shows who else is there.
- **Migration order:** the staging session added `20261029005000` meanwhile, so the publishing
  migration is `20261029005100` (after it).

**The event's address (user request during the round)**
- **Four fields on the event**, as ESN Activities asks: `address_country` (ISO code, default
  `DE`), `address_street`, `address_postal_code`, `address_city`; `location` stays the venue's
  name ("Shamrock"). The OC (or the Events team) enters them under **Edit details**; the form
  starts on Germany and München.
- **The location finder is offline** (no external API, as everywhere in this round): postal code
  formats for 14 countries; for Germany every Munich code (80331–81929 → München) and the
  towns around Munich and of the usual trips fill in the city; another valid code keeps the city
  as typed ("Not in the list – check the city"). A known code with a different city is refused
  ("80802 is München, not Augsburg"; München = Munich = Muenchen). A full German postal code
  list (or a geocoding service) can replace `lib/address.ts`'s tables later without changing
  the form.
- **The street needs a house number**; a German postal code has five digits. The action checks
  like the form and the database keeps the shapes (constraints). The address is required as soon
  as a venue is entered; while the place is open, details (price, capacity) can still be saved.
- **Where it goes:** the description's venue is prefilled as "Venue (Street 4, 81671 München)",
  and the ESN form data takes the entered address (with its country) before anything parsed from
  the venue text, so "street address / postal code" leaves the missing list once it is entered.

## 2026-10-30 – Round of user requests (deadlines, navigation, schedule, Comms, addresses, payouts)

Requested in one message (plus payout details on the profile while the round ran). Where the
user did not choose, the recommended option was taken and is noted here.

**Description deadline**
- **Set only once the roster is confirmed**, to a time still ahead, and at the latest when the
  month's first event starts (as before). **Locked once it has passed** – changing or removing it
  is refused by the database (`guard_cycle_deadlines`).
- **At the deadline, events whose description was never submitted are cancelled** (recommended
  option "not submitted": a slow Comms review never cancels an event; a description sent back
  with changes requested was submitted and is only marked late).
  `private.cancel_overdue_descriptions()` runs every minute (pg_cron) and cancels like a manual
  cancellation (the Chat space is told; Comms sees it if something was published) with the
  reason "Description not submitted by the deadline" and `cancelled_by = 'description deadline'`.
  Events that started are left alone.
- The demo seed submits a description for every event still ahead in a cycle whose deadline has
  passed, so `seed:demo` never leads to cancellations.

**Cycle pages and navigation**
- **One page per step**, under a shared header (`cycles/[id]/layout.tsx`): schedule and ideas,
  volunteer form (`/form`), allocation and roster (`/roster`), descriptions and the deadline
  (`/descriptions`), hand-in (`/hand-in`). The **stepper is the breadcrumb**: every step links to
  its page, the page shown is outlined, and "Next: …" leads to the current step's page. The
  Events dashboard's stepper links the same way.
- **The month selector is on every team page and the calendar**: the cycle header (switching
  months keeps the page, e.g. roster → roster), Events, Comms (both tabs), ESN Activities,
  Calendar. Options may carry their own link (`MonthChoice.href`).
- **Comms pages are tabs** ("Events by stage", "Publishing schedule", keeping the month);
  executives get a link to ESN Activities there.

**Schedule and roster**
- **The roster has no "Move to…" menu**; drag and drop only (dnd-kit's keyboard sensor still
  moves chips without a mouse). Event cards are sorted by date with the date on top.
- **The month schedule is a drag-and-drop calendar**: drag an event to another day (start and end
  times are kept, `moveToDay`), or an idea from the tray onto a day to accept it (its suggested
  type, 19:00, its helpers). Started, completed and cancelled events do not move. The list below
  uses one grid, so dates, titles, type and status line up.
- **Calendar page**: month grid by default, `?view=list` for the aligned list; one month at a
  time with the month selector.
- **Get inspired** loads 12 events at a time and more as the end of the list comes into view
  (IntersectionObserver, with a "Load more" button as fallback); a new search starts again.

**ESN Activities is the executive board's** (recommended option: executives only). Marking
uploads, taking a link back and personal access tokens need the executive role (database and
actions); a token works while its owner is an executive. The page moved to
`/team/esn-activities` (the old address redirects) and lists the month's past events with their
status and actions; "ESN Activities" is in the team navigation for executives. ESN work no
longer counts as "Needs Comms". The Chat message says "The executive board has uploaded …".

**Publishing**
- **Three required channels** (recommended option): Telegram, Instagram, pretix
  (`publication_channels.required`). The Chat space post stays automatic with the description;
  ESN Activities follows the event. The board has an **"All channels" lane**: dropping an event
  there plans it on every required channel it is not on yet, on that day (`plan_everywhere`); a
  lane plans one channel. The tray lists upcoming events not on all channels, each with
  TG / IG / pretix coverage (✓, ⏰ date, –) counted over all months; the Comms rows show
  "n/3 channels planned".
- **When the event is vs. when it is advertised**: a "📅 Events" row shows each event on its
  date; each post lists its events with "📅 date · n d before" (red when after the event).
  Clicking an event highlights its date column and all its posts.
- **Telegram posts need a confirmation**: the card's "Preview & confirm" shows the picture and
  the text as it will be posted; "Confirm for <time>" queues the job, "Confirm and publish now"
  posts at once. Any change (events, time, picture, heading) takes the confirmation back
  (`post_changed(post, confirm)`), so nothing unseen goes out; the job skips unconfirmed posts.
- **Pictures are uploaded**, not linked: the private bucket `post-pictures` (JPG, PNG, WebP,
  10 MB; Comms only), `picture = 'upload:<post id>/<file>'`. The job reads the file only when it
  sends it and removes it once the post is out (re-publishing then edits the caption); replaced
  or deleted posts remove their upload. Drive links and URLs still work for older posts.

**Description step**: the ESN details have their own card **below the preview** – activity
type, objectives, **goal** (required, 20–600 characters, with a suggestion from hook and intro)
and the **accessibility and sustainability ratings** (default: the type's). They feed the ESN
form data (what is entered wins). Changing only these keeps the description's status (no new
review).

**Addresses**
- **Location name, street and house number, postal code, city, country** as separate fields,
  with a search box that suggests places and addresses and fills all fields in, as delivery
  forms do. The lookup is **Photon** (OpenStreetMap; recommended option: free, no key,
  autocomplete allowed), called **from our server** (`/api/address`, members only), so members'
  browsers never talk to it. `PHOTON_URL` points to photon.komoot.io or a self-hosted instance.
- **Verification**: picking a suggestion marks the address verified; "Check address" looks typed
  addresses up; **saving checks again** and refuses an address the lookup does not know. When the
  lookup cannot answer (down, `ADDRESS_LOOKUP=off`), the form's own checks decide.
- `ADDRESS_LOOKUP=fake` (tests, E2E, staging, local builds) uses a built-in list of Munich places
  and the Munich-area postal codes; `dev:local` uses Photon.
- **The description's venue uses the same fields** (location name, address, search) instead of one
  text box. They write the post's venue line ("Shamrock (Trautenwolfstraße 6, 80802 München)");
  for the OC and the Events team a complete address is saved on the event too (verified; Comms
  only changes the post's line). Suggestions ask Photon for German names ("München").

**Payout details on the profile** (user request during the round)
- **Saved once** from the profile menu (click the initials, top right → "Payout details"):
  IBAN with account holder, or PayPal (`profile_payout_details`, readable by the member only).
- **Saving copies them** onto the member's claims that are not paid or rejected; a new claim
  without its own details gets them (trigger). Finance keeps seeing the claim's copy only.
- **Deleting** removes them from the profile and from claims Finance has not checked yet;
  checked claims keep theirs until they are paid (then they are deleted, as before).
- **Shown where reimbursements are**: "My reimbursements" names the account (masked) or warns that
  none is saved; the receipt form says where it will be paid; the avatar has a dot and the menu
  says "missing" while nothing is saved. Not written to the activity log (the Events team reads it).

## 2026-10-30 – Internal events, office hours, cash boxes, finance ledger, leaderboard, iCal

- **Three new roles from Google groups:** `hr` (`GROUP_HR`), `vice_president`
  (`GROUP_VICE_PRESIDENT`) and `newbie` (`GROUP_NEWBIES`), synced like every role. None of them is
  "team" (`is_team()` and `isTeam()` leave them out): HR and the VP see what members see plus what
  they plan; newbies are members. Planning internal events is `is_internal_planner()` = HR or VP;
  executives read the planner.
- **Internal events are their own table, not `events`.** Internal events, Stammtisch, Tuesday
  Talks, executive board meetings and office hours are not ESN activities: no cycle, volunteer
  form, description, Chat space, attendance, publishing or ESN Activities. Putting them in
  `events` would have leaked into every one of those queries. `internal_events.kind` decides what
  a date has (`lib/internal.ts`): sign-ups (internal), OC + helpers (Stammtisch, office hour), a
  presentation link (Tuesday Talk, board meeting), a cash box (Stammtisch, office hour). The kind
  never changes after creation (trigger).
- **Executive board meetings are visible to executives and the planners only**, in RLS
  (`can_read_internal_event()`), so also their people, the calendar, Home and the iCal feed.
- **Defaults per kind** (`internal_kind_settings`: title, time, length, helpers, text) are edited
  by the planners; the office hour text is the kind's text, so every office hour shows the same
  description.
- **Planning a whole semester** (user request): the planner opens on the semester (WiSe
  October–March, SoSe April–September, as the photo folders), six month calendars with drag and
  drop (a kind from the palette onto a day at its default time; a date to another day keeping its
  times), the OC/helper roster of all coming Stammtisch and office hours of the semester (members
  dragged onto slots, a duty count per member), and "Repeat" over the semester: weekday, every week
  or the 1st–4th / last of each month, a preview of the dates with already planned ones unticked
  and holidays to untick. Repeated dates share a `series_id`; "Delete this and later" removes the
  rest of a series. A month view stays for detail work.
- **Sign-ups:** members sign themselves up to internal events through `sign_up_internal()`
  (upcoming, scheduled, within the capacity, row-locked) and withdraw before the start; OC and
  helpers are assigned by the planners only (the brief: "HR and VP manage scheduling and
  assignment").
- **One cash box model for office hours and events** (`cash_reports`, one per office hour /
  Stammtisch or per ESN event that uses the box): counts per euro note and coin before and after
  (validated in the database, totals computed there), ESNcards sold (internal = members,
  external) counted atomically from several phones (`bump_esncards()`), a note on what was sold,
  and the OC's sign-off (`close_cash_report()`, needs both counts) that freezes it. Finance marks
  it checked, reopens it, or books its takings (after − before) into the ledger once
  (`book_cash_report()`; a booked box cannot be reopened until the entry is removed). The staff of
  the event/office hour count it; Events (event boxes), the planners (office hour boxes), Finance
  and executives read it; nobody writes the table directly.
- **ESNcard prices** are Finance's setting (`set_esncard_prices()`, stored in `app_settings`) and
  copied onto a box when it starts, so the "expected cash" and the difference stay right when the
  price changes later. The expectation assumes every card was paid in cash.
- **The ledger** (`finance_entries`, `finance_categories`): Finance books other income and spending
  with categories (seeded: event revenue, ESNcard sales, cash box takings, membership fees,
  sponsoring; event costs, merchandise, ESNcards, office, travel, bank fees, other), optionally per
  event, with how it was paid (MESA bank account by default), the Beleg reference and whether the
  paper Beleg is filed. Categories are never deleted, only hidden. Finance edits and deletes
  entries (stamped `updated_by`); there is no activity-log trigger on purpose – the log is
  readable by the event's staff, and ledger amounts are Finance's.
- **Finance overview per semester** (`lib/finance.ts`): balance = income − spending −
  reimbursements paid − reimbursements checked (due). Claims not yet checked and cash boxes not
  booked are shown next to the balance, not in it (they would count twice once booked or
  checked). Per event: ledger income and spending, claims, the balance and unbooked cash.
- **Leaderboard on Home:** OC and helper slots of ESN events that took place this semester
  (confirmed or completed, or under-staffed and run; not cancelled, not ahead), top 3 places with
  ties, once for active members and once for newbies (user: newbies are the newbies group, not a
  date). Computed by `leaderboard()` (definer, members only) because rosters of other events are
  not always readable by every member.
- **Calendar subscription (iCal):** one personal feed per member at
  `/api/calendar/<token>.ics` (public path; the token is the authentication, like the ESN
  Activities tokens): shown once, stored as SHA-256, replaced or turned off by its owner, refused
  when the owner lost access (left the Workspace or the rules changed). It holds what the owner
  may see – scheduled ESN events (cancelled ones as `STATUS:CANCELLED`) and internal events, board
  meetings only for the executive board – from half a year back, with their role ("You are the
  OC."). Google Calendar, Apple Calendar/Outlook (webcal://) and a download link are offered. A
  public feed for non-members was not built: P1 events are internal.
- **The planner, office hours and finance pages are server-rendered with small client islands**,
  as the other pages; the drag and drop reuses dnd-kit with the pointer and keyboard sensors.

## 2026-10-31 – Usability review fixes (docs/USABILITY_REVIEW_2026-10-30.md)

Status per finding at the end of the review document. Decisions taken where the review left a
choice:

- **Feedback and confirmations are one mechanism** (`components/Feedback.tsx`, mounted in the
  root layout): a `role="status"` message region and a styled `<dialog>` confirm that names the
  thing, the date and the consequence. `useAction().run(…, done)` shows a message after an action;
  `ActionButton` says "Done." unless given its own. No `window.confirm()` is left in the app.
- **The post's venue and price stay separate from the event's** (#3, #4): Comms may word the
  post's line differently (round 2026-10-30). The editor labels the price "Price shown in the
  post" and warns when post and event differ, with one click to take the event's value.
- **Example programme text is refused** (#2) like a missing field, on submit and on approval.
- **Next steps count only the member's own missing paper receipts** (#5). The team part stays
  counts only (B2 above): naming who is missing one needs a new definer function and revisiting
  B2 – not done.
- **Cycle pages have tabs; the stepper is status only** (#18). This replaces "the stepper is the
  breadcrumb" (round 2026-10-30) on cycle pages; the Events dashboard's stepper keeps its links.
- **Changes on a confirmed roster wait 10 s for Undo** in the browser before they are saved and
  announced (#20); leaving the page meanwhile warns. Before confirmation they save at once.
- **"Paper receipt"** in the English UI (#27); "Beleg" once as the explanation (hand-in, Finance).
- **One icon set** (lucide, already a dependency) for steps and checklists (`StepIcon`).
- **Unknown addresses render inside the member area** (`app/(app)/[...missing]`), so the
  navigation stays (#29).
- **The GDPR data processing notice on the public form stays fully visible** (#32): Art. 21(4)
  wants the right to object shown clearly and separately; only the participation terms fold.

## 2026-10-31 – Leaderboard page with office hours

- **Own page `/leaderboard`** (in the main navigation); Home keeps a teaser with each category's
  leader in the viewer's group and a link. The page shows one semester at a time (earlier ones
  browsable with ←/→, never a future one), totals, the viewer's places, and per category a podium
  for the top three and a bar per member after that – everyone on the board, not only the top 3.
- **Office hours as a third category:** OC or helper of an office hour that took place in the
  semester and was not cancelled. `leaderboard()` returns `office_hour_count` (return type
  changed: dropped and created again, migration `20261031000100`).
- **Colours:** one per category (OC indigo `#4549B8`, helped cyan `#0091C8`, office hours orange
  `#E06A12`), checked for colour-vision deficiency and contrast on white; names and numbers stay
  in the gray text colours, ties share a step on the podium.

## 2026-10-31 – Publishing calendar, pretix checklist, cash boxes as objects

- **pretix is a checklist, not a channel on the schedule.** Comms ticks "pretix page is up" per
  event (link optional). A tick is still a published pretix post of the event, so
  `publication_status`, the Chat space notice and the sign-up link in Telegram bundles keep
  working; untick removes it. `publication_channels.pretix.schedulable = false`; planned pretix
  posts were deleted (migration `20261031000200`, `set_pretix_ready()`). This replaces "Three
  required channels" (2026-10-30) for pretix; Telegram and Instagram stay required.
- **No "All channels" lane any more.** The board is a month calendar like the cycle schedule and
  the internal planner (whole month at once, no sideways scrolling), the month's events listed on
  the left like the roster's volunteers. Each event has a chip per channel (TG, IG): drag a chip
  onto a day to plan that post, onto a post of the same channel to bundle. Events show on their
  date (📅) so the lead time is visible. A post opens in a dialog for preview, confirm, publish,
  skip and the rest. `plan_everywhere()` stays in the database but the board no longer offers it.
- **Phone twins of drop targets get their own ids** (`mday`, `mpost`): a hidden twin with the
  same id has a zero-size rect and swallows the drop. A post under the pointer wins over its day.
- **Cash boxes are physical objects** (`cash_boxes`, migration `20261031000300`): name, notes and
  coins in it, the default box of office hours and of events. Two to start: "Office hour cash
  box" and "Events cash box". Finance adds boxes, removes empty ones (history stays), picks the
  defaults, and puts money in, takes it out or recounts (`adjust_cash_box()`, every change in
  `cash_box_changes`). Members read the boxes (to pick one); the history is Finance and
  executives only.
- **An office hour or event counts one box** (`cash_reports.cash_box_id`, not null; the default
  when the staff don't pick one). Its content is filled in as the suggested opening count, and
  the OC's sign-off sets the box to the closing count. Finance then takes the takings out
  ("Take money out") when they go to the bank.

## 2026-11-01 – One demo dataset, a fuller staging demo

- **The local stack and staging use the same demo data** (
pm run seed:staging). The small
  local demo seed (seed:demo, scripts/seed-demo*.mjs) is gone: two datasets drifted apart and
  both needed care with every round. The local sign-in lists the demo personas (signing in with
  their derived password, lib/staging/password.ts) next to the supabase/seed.sql test
  accounts, which the automated tests keep using. Tests that count team members ignore demo
  members (….demo@).
- **Pointing local development at the hosted staging project was not done:** the DB tests reset
  and rewrite data, unreviewed migrations would reach a shared database, and the local sign-in
  needs a Supabase on this machine.
- **The demo covers the internal side** (lib/staging/internal.ts): office hours, Stammtisch,
  Tuesday Talks, board meetings and internal events with staff, open slots, cancellations and a
  full sign-up list; cash boxes with history and reports in every state; the ledger; saved
  payout details, calendar links and ESN tokens. Personas HR and Vice President; newbies.
- **Unsubmitted descriptions only in next month.** pg_cron cancels the current month's coming
  events whose description was never submitted (its deadline has passed); the seed had a draft
  there, which staging cancelled within a minute. A DB test checks no seeded event qualifies.
## 2026-11-01 – Event categories and formats

- **Two things, not one:** a *category* says what kind of event it is (16 seeded: Language &
  Meet-ups, Movies & Watch parties, Social impact, Rally & Scavenger hunt, Karaoke & Music,
  Festivals & Traditions, Dance & Yoga, Food & Drinks, Sports, Hiking & Outdoors, Trips &
  Excursions, Creative workshops, Museums & Culture, City tours & Visits, Games & Quiz, Party &
  Nightlife); a *format* is a recurring event (Language Café, Partnachklamm hike, Bouldering)
  whose runs belong together. `events.type` stays as it is – it decides the reimbursement rules
  – so "Hike to the Partnachklamm" is a day trip *and* Hiking.
- **One category per event and idea**, not tags: filters, badges and counts stay simple; the
  search covers the rest. A format brings its category (trigger); a category given with it wins.
- **The Events team keeps both** on `/team/events/formats` (executives read): categories with
  emoji, ESN activity type and keywords, never deleted, only hidden (like the ledger's); formats
  with type, helpers and usual place, merge one into another, take a run out. Only the Events
  team changes an event's category or format (trigger; the OC keeps place and price).
- **Suggestions, never silent sorting:** `suggestCategory()` (lib/formats.ts) takes the first
  category in `sort` order whose keyword matches the title (else the hook, else the intro) –
  the seed is ordered specific → general so "Singing Workshop" is music, "Cycling Tour" sports,
  "Bar Rallye" a rally, "Hiking Trip" a hike. Keywords of up to 4 letters match whole words
  ("tour" is not "Tournament"). The idea and schedule forms prefill the suggestion until someone
  picks; past events are sorted on the formats page, where the rows are suggested and saved in
  bulk (`sort_past_events()`, one transaction). Checked against all 177 titles of the bot's
  registry from SoSe 25 to WiSe 26/27 (tests/fixtures/registry-titles.json – titles and hooks
  only): every one gets a category.
- **Runs of one event meet by a looser name** for the sorting suggestions (`formatKey()`):
  without semester tags, numbers, "ESN MESA" and filler words – "Hike to Leutaschklamm" =
  "Hiking Trip to Leutaschklamm", "Day Trip Salzburg" = "Trip to Salzburg", "Football World Cup
  Watch Party: MEX - RSA" = "…: ESP - CPV". The bot's template search keeps its literal grouping
  for events without a format; with a format, runs group by it.
- **Where it shows:** the idea form ("Is this a new run of …?", category), Get inspired (category
  filter, runs of a format as one result with their average turnout), the month schedule
  (category on each event, format and category when accepting, ideas of one format together with
  "planned already" and "N more ideas"), the description editor ("Start from the last Language
  Café" first; a new description gets the category's ESN activity type and objectives).
- **The bot's _Registry tab can be imported** (`npm run import:bot-archive -- _Registry.csv`):
  its published descriptions are taken as they are (no parsing of the rendered text), drafts,
  removed rows and the Training sheet skipped, the same Event IDs as the semester tabs. Titles
  with "weekend" become weekend trips. The import does not sort – that is the formats page.
- **Existing events are sorted up front** (user request: Get inspired showed none with a
  category): `npm run sort:events` (lib/formatsApply.ts) does what "Save all" does with the rows
  as suggested – a category where none is set, a format for each name that ran more than once,
  ideas after their event or title; a dry run unless `--apply`, `--remote` only behind the staging
  gates. The demo seed runs the same for the planned events and the history. Staging was sorted
  with it on 2026-11-02; the page stays for checking and for what no keyword matches.
- **Staging reset:** "Reset demo data" wipes formats and keeps categories.

## 2026-11-02 – The cycle timeline and a new Home

Requested: make the organisation's timeline (in the month before the events' month: ideas by
the 7th, helper form opens on the 10th, sign-up until the 15th, descriptions by the 20th)
part of the app and visible; ideas for later months (next year) must stay possible. And a new
Home without the leaderboard. Where the user did not choose, the recommended option was taken.

**Timeline**
- **One definition, two places:** `lib/timeline.ts` (pages) and `public.cycle_timeline(month)`
  (guards, jobs) compute the same instants (a DB test compares them). Days of the month before;
  deadlines at 23:59 Berlin, the form opens at 09:00. The days are the admin setting
  `app_settings.cycle_timeline` (Admin → Settings), checked in the action and the database
  (whole days 1–28, in order). An Events-only milestone, **roster confirmed**, is two days after
  the form closes (the 17th): the OCs then have three days to write.
- **Ideas close per month, never in general:** a member's idea (new, or moved by them) must be
  dated in a month whose ideas deadline is still ahead (`guard_idea_date`); every later month is
  open – ideas for next year welcome. The Events team is not bound (they add events anyway).
  The idea form starts its date at the first open day and says which month's schedule the idea
  goes into; "Propose this again" picks a date in an open month (`freshDate(…, earliestDay)`,
  replacing "two weeks ahead").
- **The form opens by itself** on the 10th (`open_due_forms()`, pg_cron every minute) for a cycle
  still planning that has events on the schedule, closing on the 15th. An empty schedule stays
  planning and shows as late; Events can still open earlier or with another deadline. Cycles are
  **not** created automatically (the demo seed inserts them and would collide); the Events page
  and Home's Events queue warn when the coming month has no cycle.
- **The description deadline defaults to the 20th** when the roster is confirmed and none is set
  (trigger before `guard_cycle_deadlines`, which checks it like a hand-set one: ahead, not after
  the first event). As the deadline cancels events without a submitted description (round
  2026-10-30), the 20th is binding from then on; Events can still change it before it passes.
- **A reminder the day before** the description deadline (`remind_due_descriptions()`, every 15
  minutes): the same `chat.remind_oc` job as the "Remind OC" button, once per event and
  deadline, skipped when someone reminded that day already. Ideas and the form get no Chat
  reminder – there is no members' space; Home, the navigation badge and the Ideas page show them.
- **Off-standard dates are allowed but visible:** the form and description deadline fields start
  with the standard date and say when a value differs.
- **Late steps:** the cycle stepper shows each step's date; the current step turns red once its
  date passed (ideas/schedule: the form's opening day; allocation/roster: the 17th) and the next
  action says "Overdue since …".
- **The calendar** marks the four dates of next month's cycle on their days (not in the
  "Internal" view).

**Home**
- **The leaderboard left Home** (it keeps its page and navigation entry). The internal calendar
  card's month grid and the member's own events in it repeated the Calendar and "My events": it
  became **Coming up in MESA**, only internal events, meetings and office hours of the next four
  weeks.
- **Waiting for you** (only when something waits): unanswered volunteer forms and claims that
  need payout details or the paper receipt – formerly a banner per form and a claims card.
  An event's next step stays on the event under My events, never twice.
- **Planning timeline** of the cycle members work towards (next month's events until their
  descriptions are due, then the month after): the four dates with "in 5 days", and per date the
  member's own state (ideas proposed for that month, answered or not, their descriptions as OC).
  A deadline set on the cycle wins over the standard day.
- **My events** with a date leaf per event; open slots with their date; team queues unchanged
  (the Events queue warns about a missing cycle and shows a late cycle in red).

## 2026-11-02 – The meeting point

Where people meet is not always where the event happens: a hike meets at München Hauptbahnhof
and takes place at the Tegernsee. Until now an event had one place (`events.location` + the
address), so OCs put the meeting point into the venue and the description's venue check
complained that the post's venue was not the event's location.

- **Two places, the location stays the event's.** `location` and `address_*` remain where the
  event happens – that is what ESN Activities asks for (its export is unchanged) and what the
  calendar entry's LOCATION says. The meeting point is optional and separate: `meeting_point`
  (name), `meeting_country/street/postal_code/city` (an optional address with the same shapes and
  checks as the event's, verified with the same lookup) and `meeting_time`. No meeting point =
  people meet at the location; nothing changes for those events.
- **The meeting time is a time of day** (`time`, Berlin, on the event's day), not an instant: it
  follows the event when the Events team moves the date, and needs no check against `starts_at`
  in the database (which would break on every date move). A meeting time after the start is only
  a warning in the description. The database requires a place (name or street) for a time or an
  address (`events_meeting_needs_place_check`), whole minutes only.
- **Who changes it:** the OC changes the place, so the meeting point too – `guard_event_update()`
  lists only the Events team's columns, so no guard change was needed; RLS is unchanged (the OC
  and the Events team update the event). The activity log names "meeting point" / "meeting
  time".
- **Where it is entered:** the event's "Edit details" (checkbox "People meet somewhere else
  first", then the same place search as the location plus a time); the description's Basics (the
  same fields, saved on the event like the venue); the schedule's add and edit forms (the name
  only – address and time on the event page; clearing the name there clears the whole meeting
  point, as "they meet at the location"). A format has a **usual meeting point**
  (`event_formats.meeting_point`); a new event of the format starts with it (schedule form and
  `accept_idea()`).
- **The post has its own line** under the venue: `🤝 Meeting point: München Hauptbahnhof
  (Bayerstraße 10a, 80335 München) at 08:15`, only when there is a meeting point – the house
  template is otherwise unchanged. Description fields `meeting` and `meetingTime` (older drafts
  load with them empty); a new description starts with the event's meeting point.
- **The mismatch check compares like with like** (`placeMismatch`, lib/meeting.ts): the venue
  line with the location, the meeting line with the meeting point. A post whose venue line names
  the meeting point (written before there was a meeting line) is not flagged: it is not wrong,
  only less precise. The meeting line has its own warning and "Use the fields in the post".
- **Shown where helpers and participants need it:** the event page (Details and the header:
  "Meet 08:15 at München Hauptbahnhof"), the helper's info on Home next to "Starts 18:00 ·
  <location>", the Chat post, and the calendar feed (first line of the entry's description:
  "Meeting point: … at 08:15"). The month calendar and its lists keep showing the location.
- The fake address lookup (tests, staging) knows München Hauptbahnhof and Bahnhof Tegernsee; the
  demo seed gives the Tegernsee and Kampenwand trips a meeting point in Munich.

## 2026-11-02 – Posts for events weeks ahead

Comms advertises big events (parties, day and weekend trips) a month or more before they happen.
The publishing schedule worked one month at a time, which got in the way. What blocked it:

- **The list held one month.** The board's list showed the selected month's events (plus events
  already on that month's posts), so a December trip could not be dragged onto a November day.
- **Events in their volunteer form were missing.** The list came from `description_overview()`,
  which has only confirmed, understaffed and completed events, while `private.check_post_event`
  already accepts `scheduled` ones – so next month's events (form open from the 10th to the 15th)
  and anything later never showed, not even in their own month.
- **"Plan…" was held to the month** (the date field's min/max were the month's first and last
  day) and the calendar only takes drops on its own days. Moving a post to another month already
  worked ("Change day" had no limit).
- **The default month** counted work only in the month an event takes place.
- **Database:** nothing about `scheduled_for` – no "before the event", no "not in the past"; only
  the board warns "planned after the event". **Descriptions:** a post can be planned with no
  approved description (a warning); only the Telegram job refuses to send one (unapproved or TBA),
  at its time, and then does not retry.

Decisions:

- **The board's month is the month the posts go out.** Below the month's own events the list
  holds the upcoming events of the next three months (`AHEAD_MONTHS`), grouped by month ("Coming
  up: December 2026 (9, 3 big)"), the next month open, the others folded. Three months covers the
  big parties and trips; more would make the list long without helping (an event further out
  shows up on the board three months before its month). Within a later month the **big events
  come first** (type special, day trip, weekend trip, with a "big" badge), then by date. Their
  chips go onto this month's days like any other. Later months are shown only while the board's
  month is not over (an old month's board stays as it was). "Only the ones still to do" and the
  "N upcoming still to plan" line cover all of them.
- **The list takes the events Comms may post about** – the same statuses as
  `check_post_event` (`scheduled`, `confirmed`, `understaffed`, `completed`, from the platform),
  read from `events` directly. **Drafts stay out** (the cycle is not fixed yet; kept rule).
- **A post may sit on any day up to its event.** "Plan…" offers today … the event's day and
  suggests three days before the event, on this month's board when possible (a January trip on
  the November board: 30 November); a day in another month says "That day is on the December
  2026 board". The calendar still shows one month; a post planned elsewhere shows in the
  event's chips (⏰ date) and on that month's board.
- **No new database guard**, so no migration: the rules stay where they were. "After the event"
  remains a warning (not a refusal), planning without a description remains allowed – for an
  event weeks ahead the description is written by the 20th of the month before.
- **Telegram tells it straight away:** a planned Telegram post whose description is not
  approved yet (or whose price is TBA) shows the job's own reason in its preview and **no
  Confirm button** – it can stay planned and is confirmed once the description is approved. The
  job keeps refusing as before (approval can be taken back later). The warning "description not
  approved yet" names when it is due ("due Sun 20 Dec") when the event's cycle has a deadline.
- **"To plan" counts ahead:** the current month is marked "to plan" when an upcoming event of the
  next three months is on no channel yet (its posts can go out now); the board still opens on the
  first month with work.
- **Comms page, "Events by stage":** the "N/M channels planned" link opens the board of the
  month the event's first post goes out in (for an event ahead with none yet, the first board
  from now on that lists it – `boardMonthFor()`) and highlights the event (`?event=`). The tab itself still lists events by the month they
  happen in.
- **Home, the Comms queue:** a new figure "Upcoming events still to plan" – upcoming events of
  this month and the three ahead (what the board lists) missing a required schedule channel (Telegram, Instagram; skipped posts do not
  count) – leading to the board (`lib/publishingLoad.ts`, `stillToPlan()`).

## 2026-11-03 – Telegram preview first, pictures, publish vs. advertise, Comms stages, hand-in to-do list

- **The preview is what a Telegram post opens on.** Clicking a Telegram post shows the messages as
  the channel will get them, every time (not only while unconfirmed), with "Confirm for …" and
  "Confirm and publish now" (or "Publish again") right under them. The separate "Preview &
  confirm" and "Picture & heading" links are gone.
- **Pictures are added in the preview.** Choosing a file uploads it and saves it at once (no extra
  Save); it shows on its message in the preview, where Telegram puts it. "Replace the picture" /
  "Remove the picture" sit in the same panel, as does the heading of a post of several events. Each change takes the confirmation back, as before. After publishing the
  upload is deleted (kept rule), so the preview of a published post says the picture is gone.
- **A post of several events is one message per event.** Each event gets the same message as a
  post of that event alone (title, full description), in the post's order – the short blocks of a
  bundle are gone. The heading, when set, becomes its own first message ("📅 This week at ESN
  MESA"). Each message may carry a picture (see below; photo with caption when it fits 1,024
  characters, else photo then text – the bot's rule per message).
- **Sign-up link:** an event whose pretix page is ticked with a link gets "🔗 Sign up: …" under
  its message – now for single-event posts too (before only bundles listed it).
- **Re-publishing** edits each message in place when the post still has the same messages (same
  count and layouts); otherwise the old messages are deleted and the post is sent anew. The
  stored state is `{ chatId, picture, messages: [{ layout, photoMessageId?, textMessageId? }],
  messageId }`; posts published before this round (one layout at the top) are read as one
  message, so they are still edited in place. The 4,096-character check runs per message and
  names the event when the post has several.
- **Hand-in status (OC's hand-in tab) as a to-do list.** The four items (attendance list, photos,
  event report, receipts) are listed top to bottom instead of four columns of circle icons that
  looked like radio buttons. Each row: a green check when done, an amber "To do" tag or a grey
  "Later" tag, the item and its detail, and for open items a link to where it is done ("Sign
  off →", "Write it →" …); the header says "2 of 4 done".
- **"Publish" and "advertise" are two words now.** *Publish* is the event description in the
  event's Chat space; *advertise* is the posts on Telegram and Instagram. The Comms board is the
  **Advertisement schedule** (tab, page title); on it a post is "posted" ("Mark posted", "✓
  posted", "Confirm and post now", "Post again"), and the channel chips say "posted" (pretix:
  "set up") – only the Chat space says "published". Database values stay as they were
  (`publication_posts.status = 'published'`).
- **Approving publishes.** There is no separate Publish step: "Approve and publish" in the review
  bar approves the description and requests the Chat publication at once
  (`private.request_description_publish()` from `review_description()`, migration
  `20261103000100`). Without a Chat space yet it goes out when the space is created (trigger on
  `events.chat_space_name`). A re-approval after edits updates the message already posted, as
  before. Approved descriptions never sent before this round are sent by the migration (upcoming
  events with a space). `publish_description()` stays as the same request by hand (no button).
- **The Comms stage track** (Events by stage) is now To write → In review → Approved · in the
  Chat space → pretix page → Advertised → Event happened → Report. "Published" (merged into
  Approved) and "ESN Activities uploaded" are gone: ESN Activities is the executive board's work
  and keeps its own page. **pretix is a stage of its own before the advertising** – a chore for
  every event, and the posts link to its page; the board warns "pretix page not set up yet" on a
  post of an event without it (a warning, not a refusal). *Advertised* = posted (or skipped on
  purpose) on every required advertising channel (Telegram, Instagram). Filters: To write, In
  review, pretix to set up, To advertise, Waiting for the event, Report missing, Done; "Needs
  Comms" = review, pretix, advertise, late. Row actions: Review, Tick pretix / Advertise (to the
  board, event highlighted), Remind OC. The header counts "x of y upcoming advertised" instead of
  ESN uploads.
- **Home's Comms queue:** "Approved – ready to publish" is gone; "pretix pages to set up" and
  "Upcoming events still to advertise" (this month and the three ahead) lead to the board.
- **A picture per event's message.** In a post of several events every event's message has its
  own "Add a picture" button (`publication_post_events.picture`, `set_post_event_picture()`,
  migration `20261103000200`); the heading message keeps the post's picture. A post of one event
  keeps one picture: the event's (setting it clears the post's own).
- **Default pictures (Pictures tab, next to the schedule).** Comms chooses once a picture per
  format (event series, e.g. Language Café) and per event type; an event's message without its own
  picture takes its format's, else its type's, and the preview marks it "Default picture". They
  live in the private bucket `advertising-pictures` (`library:<path>`) and are kept – unlike post
  uploads, which go once the post is out. Comms sets them (`set_default_picture()`); Events and
  executives see them. A demo reset on staging removes them with the formats.
- **A clearer picture button:** an outline button with an image icon ("Add a picture" / "Replace
  the picture") opens the file picker; choosing a file uploads and saves at once.
- **Event colours on the board:** every event gets a colour dot (by date, ten colours), shown on
  its list entry, on its date in the calendar and on every post that advertises it (a bundle
  shows one dot per event). Pointing at an event (list or calendar) highlights its posts, as a
  click did before. The legend explains it.

## 2026-11-03 (2) – Home, My events and Reimbursements apart

- **Home is "what needs me now".** One "Waiting for you" list holds everything the member has to
  do, each thing once: an event happening now (with the attendance button), an event's next step
  when it is overdue, due within a week or has no date (hand-ins, decisions), an open volunteer
  form, missing payout details (only without saved profile details), paper receipts whose event
  step does not already say so, and open slots as one offer. Later deadlines wait on My events.
  Empty, it says "Nothing waiting for you ✓". Below: the member's next three events not already
  waiting, and Coming up in MESA; team queues for team members. The planning timeline left Home
  (the cycle dates are on the Calendar; the open form and due descriptions are waiting items).
- **My events is everything about the member's own events,** by what is to do: Today, To do
  (coming up, the step is theirs), Coming up (waiting on others or all set), To finish (past, the
  hand-in is theirs), Done (folded). Home and My events load the events the same way
  (`lib/myEventsLoad.ts`) and show the same card (`components/MyEventCard.tsx`). Status badges
  only for under-staffed, cancelled and dropped – the next step says the rest.
- **My events holds only the events** – no reimbursements summary, no volunteer form card; the
  form has Volunteer (and Home while it is open).
- **Navigation order:** the member’s own things first – Home, My events, Reimbursements, Volunteer
  (while a form is open) – then the pages to browse: Ideas, Calendar, Leaderboard.
- **Attendance of Tuesday Talks and internal events** (migration `20261103000300`): members cannot
  check in from home. HR or the Vice President opens "Show the check-in code" (`/checkin-screen/[id]`,
  for the laptop or projector): a QR code and four digits that change every 20 seconds, derived
  from a server key (`private.checkin_secret`, HMAC of the meeting and the 20-second window) – nothing
  per meeting is stored or shown to members. Scanning opens `/checkin/[id]?t=…` (the login comes
  back there); the token is accepted for three minutes (time to sign in), the typed digits for 40
  seconds and five wrong tries per member and meeting. Checking in is open from 30 minutes before
  to 30 minutes after the meeting (two hours without an end) and until HR closes the list. HR adds
  anyone ("phone died") and takes check-ins back at any time, also after closing; a taken-back
  check-in is kept with who and when, and that member cannot check in again. A member reads only
  their own check-ins; HR, the VP and the executive board read all. Written only through the
  functions (`check_in_internal`, `mark_internal_attendance`, `close_internal_attendance`).
- **Activity** (`/team/internal/activity`, linked from Internal planning; HR, VP, executive board):
  per member and semester OC and helper of ESN events (as on the leaderboard), office hours staffed,
  Tuesday Talks and other internal meetings attended – what took place and was not cancelled
  (`member_activity()`); every member with a profile is listed, sortable, searchable, as CSV.
- **Office hours are duties, not a page.** HR assigns them, so an office hour only matters to the
  people on duty: a member’s duties (OC or helper at an office hour or Stammtisch, six weeks back
  to ten ahead) are cards in My events and rows on Home, with the step from the time and the
  office hour’s cash box (count before opening; count and sign off at the end; the OC signs off an
  open box afterwards under To finish). The overview page and its navigation item are gone –
  all office hours are on the Calendar, who is on duty in Internal planning, the boxes under
  Finance; `/office-hours` redirects to the Calendar’s internal events, the office hour’s own
  page stays (back link: My events). Coming up in MESA leaves the member’s own duties out.
- **Calendar subscription** is a button in the Calendar’s top row that opens a small panel, instead
  of a card under the month.
- **Folded until needed:** forms used now and then no longer fill their page every visit –
  Ideas' propose form (unfolded while the member has no ideas, from a #propose link or "Propose
  this again"), the ledger's "Book income or spending", the Treasurer's rules editor, and
  Internal planning's "Repeat over …" and "Defaults per kind" (`components/Fold.tsx`).
- **Reimbursements have their own page** (`/me/reimbursements`) and their own item in the main
  navigation (My events is active on `/me` only): claims follow the money, not
  the events, and outlive them by weeks. The payout details moved onto it (`/me/payout`
  redirects); a claim shows the per-claim form only while it has no details at all. Paid and
  rejected claims are folded into one line. The profile menu keeps only Sign out.
- **A claim in three lines:** what it was for, the amount that counts (expected → approved →
  paid, with the receipt amount when it differs), and one status line ("Paper receipt received
  3 Nov – Finance checks it next") with four progress dots.
- **The hand-in tab is its to-do list.** The status card and the sections below it were the
  same steps twice, with both big forms always open. Now each step is one row (✓ / To do / Later,
  or “OC” for a helper looking at the OC’s steps) that unfolds to where it is done; done steps stay
  folded (photos keep “Open folder” in the row), the viewer’s first open step starts unfolded, and
  a link into a step (#register-receipt, #your-receipts, #event-report …) unfolds it. Folds keep
  the member’s choice across the refresh after saving. Receipts: the member’s claims first, the
  form behind “Register a receipt” (open while there are none), the Beleg rule as one line.
- **The planning timeline keeps its steps in order.** A form opened or closed before the ideas
  day used to leave "Ideas due" as the next step after ticked later steps. Now a later passed
  step passes the earlier ones, and what the cycle did wins over the standard dates.

## 2026-11-03 (3) – A fairer allocation

- **Why:** the allocation filled each event on its own. Marking everything "top choice" won
  everywhere, ties went to whoever clicked first when the form opened, nobody had a limit, and
  overlapping events were only reported. A keen member could get five events while others who
  signed up got none.
- **Five levels** instead of three: top choice, keen, happy to, could do, if needed (stored as
  1–5, 1 = best; old answers mapped 2 → 3, 3 → 5).
- **Limits per volunteer:** "How many of these events can you do?" (1–5 or no limit, required
  once an event is picked) and "How many of them as OC, at most?" (preselected 1). Stored on
  `volunteer_responses` (`max_events`, `max_oc`, null = no limit; answers from before have none).
  Both questions are always shown, not only after the first pick, so nobody misses them.
- **Proposer events:** when the idea's proposer OCs it (`events.proposed_by`), the form shows
  "OC: <name> (proposed the idea)" instead of the OC question; the proposer sees "You are the OC"
  and no questions for it, and a "Your idea" badge marks their ideas (also those they do not OC).
  `submit_volunteer_form()` refuses OC answers for such events and the proposer as helper.
- **The algorithm** (`lib/allocation.ts`): 0. proposers; 1. OCs, the event with the fewest
  candidates first, preferring people without an OC role; 2. helpers in rounds (round n: nobody
  gets more than n events, an OC already has one), the event with the fewest candidates per open
  slot first. Hard rules: limits, no overlapping events (a proposer's two overlapping ideas: the
  later one is reported and needs an OC from the Events team). Score: half the rank (1–5 points
  / 3), half the rank relative to the person's own answers (points / their mean, at most 2 –
  padding the form with "if needed" does not make a top choice unbeatable); +0.5 if they signed
  up last month and got nothing; −0.1 per event in the three months before (at most 5); +0.3 for
  experience as OC, and as helper while the team has nobody experienced.
- **Ties by lottery, not submission time:** a hash of the cycle id and the person – the same
  roster on every re-run, no reason to race the form at 09:00. The submission time is still
  stored and shown.
- **History** comes from `allocation_history(cycle)` (Events and executives only).
- **The run's summary** adds top choices met, volunteers without an event and proposer clashes;
  the roster board shows each person's maximum and flags anyone over it.
- **Explained under the form** in seven short points (`HowItWorks` in `VolunteerForm.tsx`) –
  keep it in step with `lib/allocation.ts`.

## 2026-11-04 – Partners on ideas, several OCs per event

- **Several OCs:** ideas and events have "OCs needed" (`ocs_needed`, 1–10, default 1) next to
  helpers needed. The one-OC-per-event index is gone. Staffing counts OCs like helpers: no OC →
  under-staffed; fewer OCs or helpers than needed → under-staffed unless the OC decided to run it
  (`refresh_staffing`, `confirm_allocation`, `reopen_event`); `open_slots()` offers an OC slot
  while OCs are below `ocs_needed`.
- **Partners on ideas** (`idea_partners`): the proposer names up to five members, each as co-OC
  or helper – in the propose form or later on their open idea. **They confirm first** (asked by
  the user): "Asked to join" on Ideas and a row in Home's "Waiting for you"; yes / no / step back
  until the month is allocated. Changing partners keeps the answers of the unchanged ones; a new
  role asks again. Only the proposer (or Events) names partners, only the partner answers
  (`set_idea_partners`, `respond_idea_partner`, definer functions; RLS: teams, the proposer and
  the partner read them). The two read policies use definer helpers (`is_idea_proposer`,
  `is_idea_partner`): policies that query each other's tables recurse.
- **Accepting an idea** sets the event's OCs needed to at least the proposer (if they OC) plus
  the co-OCs not declined.
- **Fixed people:** `event_fixed_people(cycle)` – the proposer who OCs the event and the partners
  who said yes. The allocation places them first (`fixed` on `AllocationEvent`, replacing
  `defaultOcId`; source `proposer`), the form shows them ("OC: Léa (proposed the idea)", "With
  …", "Helping already: …") and asks them nothing for that event; `submit_volunteer_form()`
  refuses OC answers once they fill the OC slots and any answer from them.
- **Roster board:** "OCs 1/2" and "Short of OCs". Making someone OC on a full OC team moves the
  OC who has been on it longest to helper – with one OC, the previous OC, as before.
- **Chat:** mentions, reminders and direct messages go to every OC; the space description lists
  all OC names. The attendance list names every OC who may sign off.


## 2026-11-04 – Calendar redesign (month grid, day list, phones)

- **One set of entries, two layouts.** The page builds one list of entries (ESN events, internal
  events, next month's cycle deadlines) and shows it as a month grid (`MonthGrid.tsx`) or a day
  list (`DayList.tsx`, `?view=list`). On phones (below `md`) both views are the day list under a
  mini month (`MiniMonth.tsx`); the Month/List switch is hidden there. Grouping, folding, week
  labels and venues are pure (`lib/calendarView.ts`).
- **One colour per category** (`lib/calendarStyle.ts`): a left bar in the grid and the list, a dot
  in the mini month. Deadlines are red with a clock (they were dashed amber, like a Stammtisch).
- **Grid:** visible month title (the month select styled as a heading, `MonthSelector title`),
  a Today button, today as a filled day number; past days grey without fading their text; the
  neighbouring months' dates in the first and last weeks; titles wrap to two lines; the viewer's
  part and open slots are icons (with the text for screen readers and on hover) instead of badges;
  more than three events → two and "+N more", which opens the list at that day.
- **List:** days are headings (sticky), weeks are labelled, time in its own column; the type only
  when it adds something ("Standard" and labels the title repeats are dropped); "You" and "Needs"
  are separate columns ("You: OC / helper / signed up" alike for ESN and internal events);
  "Completed" is dropped (past rows are grey), cancelled rows are struck through; the venue (up to
  the first comma) instead of the full address, which shows on hover; deadlines are rows on their
  day.
- **Today first:** in the current month the days before today fold into "Show 1–3 Nov · 6 earlier
  events"; today always has a heading ("Nothing planned today" when empty). `#day-YYYY-MM-DD`
  links (Today, "+N more", mini-month taps) open the fold when needed (`reveal.ts`).
- **"Mine" filter** (`?show=mine`): only what the member is OC, helper or signed up for.
- **Office hours are ESN events** (asked by the user): the "ESN events" filter shows them, the
  "Internal" one doesn't, and old `/office-hours` links open "ESN events". They keep their own
  grey colour, next to ESN events in the legend. (They are still stored as an internal kind.)
  Home's "Coming up in MESA" leaves them out too (a member's own office-hour duties stay in My
  events and "Waiting for you").
- **Phones:** Subscribe moves under the list (left-aligned so its panel fits the screen).

## 2026-11-07 – "No photos taken": photos are not a must for the hand-in

- **Why:** photos counted only with a file in the Drive folder or the OC's tick "Photos are
  uploaded", and the OC was reminded until then. When nobody took pictures there is nothing to
  upload, so the step could never be done honestly.
- **"Nobody took photos?"** under the photo folder on the hand-in tab, for the OC, the helpers
  and the Events team, once the event has started. A reason is optional (up to 300 characters).
  It closes the photo step like photos would (`private.photos_in()` / `photosIn()`), so the
  checklist, the next step, the cycle's hand-in and the automatic hand-in reminders all treat it
  as done. Stored on `event_photo_folders` (`no_photos_at`, `no_photos_by`, `no_photos_reason`)
  through `declare_no_photos(event, declared, reason)`; logged with the reason.
- **Shown as said:** the hand-in row reads "No photos taken"; the box names who said it, when, and
  why, for everyone who sees the hand-in. "We did take photos – undo" takes it back (same people).
  The "Photos are uploaded" tick is hidden while it is set, and the option is not offered once the
  folder holds files (photos found later count as photos).

## 2026-11-07 – More teams in every event's Chat space

- **Invited roles:** Events, Comms, Finance (incl. the Treasurer, as everywhere), the executive
  board (`executive`, the whole board group – there is no separate President role) and the Vice
  President, from `role_members` (`CHAT_SPACE_ROLES` in `lib/roles.ts`, `chat_space_roster()`).
  HR, newbies and IT are not invited. Joining or leaving one of these roles re-syncs every
  upcoming space; the migration re-synced the upcoming spaces that already existed.

## 2026-11-09 – Comms: category pictures, advertising a month ahead, aligned tracks

- **Default pictures per category** (hike, pub, city tour …) on the Pictures tab, besides format
  and type. An event's message without its own picture takes its **format's, else its category's,
  else its type's** (`defaultPictureOf()` in `lib/publishingLoad.ts`; `advertising_pictures.category_id`,
  `set_default_picture(format, type, picture, category)`). The tab lists category, format, type.
- **Picture cards** keep the name to two lines (full name on hover) and the note to one, so the
  pictures in a row line up however long a format's name is.
- **Drafts may be advertised once they are at most six weeks away** (`DRAFT_AHEAD_DAYS`,
  `advertisable()`, `private.check_post_event`). Why: a cycle's events stay drafts until its
  volunteer form opens (around the 10th of the month before), so an event early next month could
  not be advertised a month ahead. They show on the board with a "draft" badge and the warning
  "still a draft – the date may change"; they are not counted as "to plan" (Home, the board's
  "still to plan" line, the month's "to plan" mark). Drafts further out stay off the board.
- **Cancelled events are never posted to Telegram**: the job refuses a post with a cancelled or
  dropped event (it did not check the event's status before), and the board warns
  "cancelled – skip this post".
- **Long titles on the board**: event and post chips in the calendar show two lines (the full
  title on hover); the list's cards wrap the title next to its badges.
- **Comms page stage track**: one column per stage, the same in every row – a bar plus a label
  with a fixed-width mark (✓ done, ● now, ○ to do) – instead of chips whose "✓ " prefix shifted
  every following stage. The channel chips sit in fixed columns too. "Approved · in the Chat
  space" is now "In the Chat space" (it fits its column).

## 2026-11-09 (2) – Comms content planning: the planning sheet in the app

Comms planned in a spreadsheet next to the app ("Planning WiSe26"): a task list (task, post /
story / reel / other, deadline, one or two people, status, caption and Canva link), a calendar per
month by content type (event stories, trip promos "sales date" → "sales NOW", office hours, big
events, posts, extras; a "This week 9–15" story every Sunday and the next month's calendar post at
the month's end), a post-ideas backlog and a list of reel ideas. What moved into the app:

- **Posts without an event**: a post may have no event when it has a title – the month's
  calendar, "This week", awareness, recaps, the survival guide. Not on Telegram (its messages are
  made from event descriptions). An event post may have a title too ("Sales NOW"); removing its
  last event keeps a titled post. "+ Post without event" on the board.
- **What, who, how far** on every post (`publication_posts.title`, `format` post / story / reel,
  `assignees` up to three Comms members, `progress` to do → in progress → ready, `caption` up to
  Instagram's 2,200 characters with a Copy button, `design_link`), edited in the post's dialog
  ("Content") through `update_post_content()`. It does not bump the post's version or take
  Telegram's confirmation back – none of it goes into a Telegram message. `comms_team()` lists who
  can be assigned. Chips on the calendar show the format (STORY / REEL), the progress and the
  people's initials; "Mine" on the board fades everyone else's posts.
- **Regular posts in one go** ("Regular posts" on the board, `regularPosts()`): a "This week"
  story every Sunday for the coming Monday–Sunday and the next month's calendar post two days
  before the month ends, on one channel (Instagram by default), from today on; ones already
  planned (same channel, day and title) are left alone.
- **Content list** tab (`/team/comms/content`): the sheet's task list – every post of the month
  with when, what, where (channel and format), who, status (changed in place), caption and design
  links; "Still to post", "Mine", "All"; overdue posts in red; "N without anyone yet". A row opens
  the post on the board (`?post=`).
- **Kept out (for now)**: the post-ideas and reel-ideas backlogs (inspiration links; fine in a
  shared sheet or an Instagram collection until undated posts exist), and tasks that are not posts
  (new logo, stickers, website text). A fixed promo series (save the date → sales now → reminder) was
  tried and dropped as too rigid; instead "Plan…" plans several posts of an event at once.

## 2026-11-09 (3) – Events vs. posts on the board, several posts per event, event cards

- **Events are labels, posts are cards.** On the calendar an event is a line of text (its dot,
  📅 time, title) with a mark per required channel (green ✓ posted, blue planned, red – still
  missing while it is ahead); posts are bordered cards with a shadow. A dashed line separates
  them in a day. "Events" and "Posts" in the header hide either.
- **Lead time on every post card**: "−3d", "−2w", "day of", red "+1d" after the event – counted
  to the post's next event (`leadOf()`); the full text on hover.
- **Clicking an event shows its campaign**: other posts fade, the days from its first post to the
  event are shaded, the event's day is outlined.
- **The first days of next month** finish the last week, greyed, with their events (not drop
  targets: posts there belong to next month's board).
- **"By event" view** next to the calendar: one row per event (past ones only with posts on the
  view), days from the month's first to the last listed event (at most 120); each post a marker
  on its day – square post / reel, round story, light planned, solid posted, dashed unconfirmed
  Telegram, pink Instagram, blue Telegram – a line from the first post to the event's 📅, "no
  posts" in red for upcoming events without any, a row for posts without an event. Drop a channel
  chip on a day column to plan, drag a marker to move the post; clicking an event fades the rest.
  The page loads the posts of the month and the months the list looks ahead for it.
- **Several posts per event at once**: "Plan…" holds rows (channel, format, day, time, optional
  title); "+ Another post" adds one a week later while that is before the event;
  `planEventPosts` plans them together. Adding the event to an existing post moved below.
- **Event cards in the list**: the event's colour as a stripe on the left (the same colour as
  its dot and posts), the title larger, "📅 date, time · in N days" (amber within a week), the
  description status as a coloured pill, the channel chips under "Channels · drag onto a day"
  (red dashed while a required one is missing, green once posted), pretix and Plan… in a footer.

## 2026-11-09 (4) – pretix pages apart from the advertising

- **Why:** setting up an event's pretix page is a chore Comms does once per event, not
  advertising – it sat on the schedule as a tick in every event's card.
- **"pretix pages" tab** (`/team/comms/pretix`, after "Events by stage"): the upcoming events the
  schedule lists (this month and the months ahead, drafts from six weeks on), "To set up" first,
  **due before the event's first post** (the posts link to it): red when that day has come or
  passed, amber within three days, "No post planned yet" otherwise. Each row: date, title, big /
  draft, how soon, the description's status (its title links to the description); a link field
  and **Mark set up**; once set up "✓ Set up by <name>, <day>", open, Undo, and a warning when the
  link is missing (the Telegram posts then have no "Sign up"). "Done" and "All" filters; a link
  naming an event (`?event=`) highlights it and shows it even when it is further ahead.
- **Elsewhere:** the schedule's event cards show only "pretix page ✓" or "pretix page not set
  up →" linking there; "Events by stage" says **Set up pretix** (to the tab, not the board);
  Home's "pretix pages to set up" leads to the tab.
- **Storage unchanged** (a published "pretix" post with the link, by and when), so the Telegram
  sign-up link, the stages, Home and the board's warnings read it as before.

## 2026-11-09 (5) – the advertisement schedule is one board (prototype)

- **Why:** the schedule had three ways to look at the same posts (the event list on the left, the
  month calendar, the "By event" rows). Comms plan per event, so the per-event rows are the one
  view; the calendar's job (seeing busy days) moved into a row of its own.
- **One board** (`/team/comms/schedule`, `Board.tsx`): a row per event, the days left to right,
  each post a marker on its day (square post / reel ringed, round story, light planned, solid
  posted, dashed unconfirmed Telegram, pink Instagram, blue Telegram, an amber dot for warnings,
  "+n" when a day holds more than fits), the event's day tinted with 📅, a line from its first
  post to it (to the edge, "→ 17 Jan", when the event is beyond the window). Weekends shaded,
  week lines, the month names on top. A **"Without an event"** row stays at the bottom; big events
  after the window (up to AHEAD_MONTHS) follow under "Later – big events advertised weeks ahead".
  The month calendar, the event list on the left, the channel chips and the view switch are gone.
- **Posts per day** row under the dates (1 light, 2 darker, 3 amber, 4+ red; the list on hover),
  counting what goes out on the chosen channel whatever the other filters; **Today** as a pill,
  the day circled and a line through every row.
- **Row labels** carry what the event cards showed: colour dot, category emoji, title, big /
  draft, 📅 date (amber within a week), a description dot, a mark per channel (✓ posted, ⏰
  planned, – missing; red with a ring when a required channel is missing for an upcoming
  non-draft event) and pretix (🎟✓ / 🎟– linking to the pretix pages). Phones show the title,
  date and a red "!" for "still needs posts". Clicking a label focuses the event (the other rows
  fade) and opens its **panel** – beside the board on wide screens, a sheet from the bottom on
  phones – with the date, description (link), each channel, pretix, every post of the event
  (also outside the window; click to open) and the campaign planner (several posts on several
  days, or "add it to a post").
- **Planning on the board:** click, tap or right-click a day on a row – or arrow keys (Shift for a
  week) and Enter on the focused board – for a popover at that cell (a bottom sheet on phones):
  the day (changeable) and its lead time, the posts already there (to open), then one or more
  posts (channel, format, time, optional title; "+ Another post" picks the next channel not used
  yet, a required missing one first). When the day already has a planned post with events on the
  chosen channel, a radio offers **"Add to the Telegram post at 10:00 (…)"** – `addToPost` – in
  place of a new post. On "Without an event" a title is required and Telegram is not offered.
  New posts of an event go through `planEventPosts`, bundles through `addToPost`.
- **Moving:** drag a planned marker sideways; the day comes from the drag distance (no drop
  targets), the column it would land on is shaded and the overlay says "→ Wed 25 Nov (+2 d)".
  Clicking a marker opens the post dialog as before (Telegram preview / confirm, content,
  warnings, lead times per event).
- **Not built: bundling by dragging a marker onto another row's marker.** It would have to merge
  two posts (which caption, assignees, pictures, Telegram confirmation win?) or delete one; the
  popover's "Add to the … post" does the same thing explicitly and works on phones and by
  keyboard.
- **Filters** above the board: search (titles), channel, status (planned / not confirmed / posted
  / skipped), category (the ones on the board), Needs posts (with its count), Big events, Mine,
  Past events (by default a past event only shows while it has posts in view), Clear. Post filters
  hide markers, event filters hide rows; the focused event always stays. On phones the filters
  fold behind one button.
- **The window** replaces the months: from this week's Monday for eight weeks, ← → by four weeks,
  "This week", "Jump to…" a month (`?from=YYYY-MM-DD`, snapped to a Monday; `?month=YYYY-MM` still
  works – this month opens on this week, another on the week of its 1st). A link with `?post=` or
  `?event=` (content list, Comms page) moves the window to show the post, or the event from its
  first post (or three weeks before it), unless `?from` says otherwise. The page loads events and
  posts from three months back (the coverage marks look at every post) and hands the board the
  window's posts plus every post of a listed event.
- **Regular posts** asks for the month now (this month and the next two), since the window is no
  longer a month.
- Realtime refresh and presence, drafts, warnings and the Telegram dialog are unchanged. No
  migration. Prototype: no unit or e2e tests were added or updated (the e2e specs of the old
  calendar, chips and tray will fail until rewritten).

## 2026-11-09 (6) – The board: no event colours, clearer event labels, posted together

- **No event colours.** They were needed to match calendar chips to their events; on the board a
  post sits on its event's row, so the dots and coloured campaign lines are gone (a grey line
  from the first post to the event stays).
- **Event labels** (left column, 17rem): a date tile (month, day, weekday; amber within a week,
  grey once past), the title with big / draft, then category emoji and "in N d"; at the bottom
  right one row of marks – 📝 description (✓ approved, … in review, – missing), each channel,
  🎟 pretix. A red edge on the left while an upcoming event still misses a required channel;
  the focused event's edge is purple.
- **Posted together**: a post of several events gets a line in its channel's colour through its
  markers on their rows (dots on each row, "+n" when some of its events have no row in view), a
  small number on each marker (how many events), and hovering or focusing one marker lights up
  all of them.
- **Rough edges fixed**: markers 14 px in a 24×20 px target; the event panel slides over the
  board on wide screens instead of taking a column; the filters (not the search) are remembered
  on the device (saved when changed).

## 2026-11-09 (7) – Board polish: header, marks, "Without an event" first

- **Header**: month names are blocks whose name sticks next to the event column, so they stay
  readable when the board scrolls sideways (they slid under it); "Today" is written in today's
  own day cell instead of a pill that was cut off at the board's left edge.
- **The "Later – big events" divider** has its own background above the today line (the line
  showed through it).
- **An event's marks** follow "in N d" on its second line, in the order the work is done –
  description, pretix, Telegram, Instagram – as small icons: green done, light green planned (a
  channel), red still missing, grey no longer relevant; the words in the tooltip and for screen
  readers. The pretix mark is no longer a link (it sat inside the row's button); the event's
  panel has pretix.
- **"Without an event"** is the first row.

## 2026-11-09 (8) – Demo data for the Comms pages

- **The seed shows the content planning**: titles, post / story / reel, who makes a post, how far
  it is, captions and Canva links on its posts; posts without an event (the month's "This week"
  stories and next month's calendar with the same titles "Regular posts" gives, last month's
  recap); next month's trip (Prague) with a whole campaign (save the date, sales open, sales
  now, Telegram, last chance); an Instagram story bundling two of next month's events; pretix
  ticked for three upcoming events, the rest left for the pretix tab. Planned posts never land
  before now (they would show overdue).
- **Re-runs**: the demo Comms team's posts without an event are removed with the rest (they are
  not found through events), and so are blacklist entries of demo members – one added by hand on
  staging stopped the seed ("Aisha Bello is on the blacklist").

## 2026-11-10 – "Big" is the Events team's mark; board marks, post popups, mock pictures

- **"Big" is no longer the event's type.** It was derived from the type (special, day trip,
  weekend trip), and the type starts as the proposer's suggestion on the idea – so in effect the
  OC decided what Comms advertises weeks ahead. Now `events.big` is a mark of its own
  (migration `20261110000100_big_events`): the Events team switches it on the month's schedule
  ("Big" / "Mark big" on each row, also after the schedule is fixed; `setEventBig`), a trigger
  lets nobody else change it. **Default**: a new event is big when it is a special event or a
  weekend trip – a day trip is not, unless the Events team says so (existing events were set the
  same way). When the type is changed and nobody decided about "big" (it still is what the old
  type gave), it follows the new type; a mark set by hand stays. The board's early rows, the
  "Big events" filter, the labels on the board, the event panel and the pretix tab read the mark.
- **Events by stage: no pretix chip.** pretix has its own stage in the track, so it is gone from
  the chips at the foot of a row and from "Not yet on"; "n/m channels planned" counts the
  advertising channels only.
- **Board, an event's marks**: they sit at the right edge of the label, so each icon is in the
  same column in every row (they used to follow "in 3 d" / "tomorrow" / "past" and so jumped
  from row to row). **Colours**: done is filled green, planned a blue outline on white, missing
  red, not needed grey – fill and hue both differ (planned was a lighter green, hard to tell
  from done). The legend names all four; the event panel uses the same icons for description,
  pretix and each channel.
- **Planning a post (the popover on a day, the campaign planner in the event panel)**: the
  channel and the format are buttons (each channel with its icon and colour; post / story / reel
  with the shape it has on the board) instead of two unlabelled dropdowns, every field has a
  label, Telegram says what it posts ("a message made from the event's description"), and the
  day and the button are in a foot that stays in view. Several posts are numbered cards.
- **A post's dialog** (`PostDialog.tsx`) was one narrow column: the content form, a preview that
  scrolled inside the scrolling dialog, and the actions as text links at the very end. Now: a
  header (channel, title or events, when, state), two columns – left what it advertises (order,
  remove), title, format, who makes it, how far it is; right the thing that goes out (the
  Telegram messages as bubbles with their pictures, or the Instagram caption and design link) –
  and a foot that stays in view: Change day / Skip / Delete on the left, the next step as the
  one filled button on the right (Confirm, Mark posted). Format, who and progress save at once;
  the texts with "Save changes". Telegram posts no longer show a caption and a format they do
  not use. One column on phones.
- **Mock default pictures in the demo data** (`lib/staging/pictures.ts`): the Pictures tab and
  the Telegram previews had nothing to show on staging. The seed draws a labelled placeholder
  (a coloured card with the name in pixel letters; a PNG written by hand, no image library, so
  it also runs from "Reset demo data") for every event type, every category and every second
  format – the formats left out show the empty slot and the fallback to the category's picture.
  Slots that already have a picture are left alone; the mock ones go with `--remove`.
- **pretix tab: the event a link named stays in view.** Ticked under "To set up", an event left
  the list at once – no "Set up by", no link to open, no Undo – and a link to an event already
  set up (from the board's panel) showed a list without it. The event named by `?event=` is now
  listed first whatever the filter.
- **Tests brought up to date**: `tests/e2e/schedule.spec.ts` still described the calendar and
  tray the board replaced on 2026-11-09 (5); it now drives the board (a day on a row, the event
  panel, a bundle from the popover, the post dialog) and the Events team's mark. The Telegram
  expectations in `tests/db/publishing.test.ts`, `tests/db/advertising.test.ts` and
  `monthly-cycle.spec.ts` follow description layout B (2026-11-08: titles in capitals, "are you
  ready"). Tests whose posts must go out as text set the event types' default pictures aside
  and put them back (`setAsideTypePictures()`), since the demo data now has mock ones.
