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
  Finance (incl. Treasurer) only – not by executives or admins either, matching who reads claims
  (milestone 6). Other entries: Events, executives, admins; the event's OC and helpers only for
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
