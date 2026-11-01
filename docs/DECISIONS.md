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