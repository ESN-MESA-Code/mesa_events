# Progress – Phase 1 (local only)

## Review round 2026-10-28 (docs/REVIEW-2026-10-28.md)

Status: **every item of A, B and C implemented and tested; all checks green.** Committed on local
`main` (one commit per A/B item, C in groups); nothing deployed or pushed, no external API
called. Decisions are in `docs/DECISIONS.md` ("Review round"). New migrations
`20261029000100`–`20261029000900`; the existing ones were not changed, and the whole set applies
from scratch (`supabase db reset`).

| Item | What changed |
|---|---|
| A1 Locked volunteer form | `submit_volunteer_form()` refuses a second submission; FCFS ties use the single `submitted_at` (`volunteer_choices.chosen_at` dropped, `lib/allocation.ts` takes `submittedAt`); Volunteer page shows a read-only summary ("Submitted ✓ … ask the Events team"); Events clears one person's answers on the cycle page with a reason (logged), the person submits again. |
| A2 No receipt photos | Migration drops `receipts.reference_path`, the `receipts` bucket and policies, and the photo parameter of `register_receipt()`; upload field, `/api/receipts/[id]/file` and the Finance photo link removed. Hand-in photos unchanged. |
| B1 Claim log leak | `activity_log` select policy by entity: claim entries only for Finance (and, after C4, executives); event staff read only entities they can read anyway. RLS test with a real claim as the helper of the same event, matrix cases. |
| B2 Drop-out reasons | Moved to `assignment_drop_reasons` (OC of the event and Events only), not logged; hint "no health details". |
| B3 Event dates | `starts_at`/`ends_at` Events-only (trigger, action, form); location, price, capacity stay with the OC. |
| B4 Stale jobs | `claim_jobs()` marks stale running jobs dead once `attempts >= max_attempts`. DB test. |
| B5 Revalidation | Actions declare `revalidate` targets; autosave none; only navigation-changing actions revalidate all pages. Unit test. |
| B6 CI | `.github/workflows/ci.yml` (lint, typecheck, unit, gen:actions check, audit; DB tests + types drift; build, bundle scan, E2E; Docker build + smoke). `npm run gen:actions [-- --check]`. |
| B7 `seed:demo` re-run | Cleanup removes everything in the demo's cycles first. |
| C1 Home | `/` per role: volunteer banner or "submitted ✓", my events with next step + deadline, open slots, claims needing something, team queue cards. |
| C2 Cycle month | Labels "December 2026 events (planned in November)" everywhere; DB refuses events outside the cycle's Berlin month and month changes of cycles with events; seed fixed. |
| C3 Navigation | Personal group + separate Team group; Volunteer only while a form is open (badge until answered); phone menu. |
| C4 Executive Finance | Read-only Finance for executives (RLS, no bank details, no actions); styled not-found pages; No access page for team pages. |
| C5 Event page | Next-step banner, checklist items link to their tab with deadlines, breadcrumbs from `?from=`, plain-language activity (raw log for Events/executives/admins). |
| C6 Phase-aware tabs | Hand-in: status first; receipts and photos from the event's day, otherwise disabled with the reason. |
| C7 Claims | Receipt amount / Suggested / Approved / Paid, steps Registered → Beleg received → Checked → Paid, grouped by event. |
| C8 Comms | Late = deadline passed or event started (database); "x of y descriptions in" per cycle. |
| C9 Events cycles | Stepper Ideas → Schedule → Volunteer form → Allocation → Roster confirmed → Descriptions with the next action; dashboard = one card per cycle. |
| C10 "Unsaved changes" | Cause: a new description marked every prefilled field dirty on load. Now "Not saved yet – prefilled…", saved with the first edit. |
| C11 Consistency | Shared status chips, stepper, claim item, date formats; every role's main pages checked at 375 px (browser walkthrough + Playwright). |

### Checks (this round)

| Check | Result |
|---|---|
| `npm test` (unit) | **295 passed** (19 files) |
| `npm run test:db` | **1,745 passed** (7 files), incl. the RLS matrix |
| `npm run build:local` + `npm run test:bundle` | build OK, **10 passed** |
| `npm run test:e2e` (production build) | **46 passed**, 1 skipped (as before: the organiser part of the live-list test on the phone project) |
| `npm run lint`, `npm run typecheck`, `npm run gen:actions -- --check` | clean |
| `supabase db reset` + `gen:types` | all migrations apply; types unchanged |
| `docker build` | image `mesa-events:local` (315 MB); container serves `/login` and `/impressum`, job route 401 without secret |

UI walkthrough: done in the in-app browser against `dev:local` at desktop and 375 px (OC,
Events, executive, member) – it found the tab overflow on phones, a deadline shown for a past
event and the empty-state text when a form is open (fixed); the remaining roles are covered by
`tests/e2e/review.spec.ts` (Home per role and every role's pages at 375 px).

One run failed only because it crossed midnight: the month-long E2E test moved an event to "in
30 minutes", which landed on the next day, while the hand-in opens on the event's day (C6). The
test now moves it to 15 minutes ago; the suite passed afterwards.

Not done / limits: nothing from the review is left open. As before, the **legal texts** must be
updated by the board (they do not yet describe the new processing); the CI workflow has never run
on GitHub (nothing pushed).

## Phase 1 build

Status 2026-10-28: **milestones 1–7 complete; all checks green.** Everything is committed on
the local `main` branch; nothing was deployed or pushed, and no external API was called.

## Built

| Milestone | What |
|---|---|
| 1 Foundation | Next.js 16 + Supabase scaffold from MESAttendance; Workspace-only Google login and confidentiality gate; roles from configurable Google groups (`role_members`, synced daily and at login; manual additions by admins); profiles, planning cycles, events, assignments, activity log; jobs queue with retries, backoff and idempotency keys run by pg_cron + pg_net through a secret-protected route; Directory/Chat/Drive clients behind interfaces with DB and memory fakes; local test sign-in per role (impossible in production builds); nonce-based CSP and security headers; navigation and admin page. |
| 2 Planning cycle | Ideas (proposer is OC by default), month schedule with event types (accept, merge, move, reject, own events), volunteer form with OC/helper ranks and per-choice submission time, deterministic allocation (priorities, FCFS ties, no caps, drops, under-staffing), drag-and-drop roster board with a "Move to…" fallback, confirmation by Events only. |
| 3 Chat spaces | A space per event when the roster is confirmed; members (OC, helpers, Comms, Events) kept in sync; description (date, OC) and welcome message with @-mentions; dropouts, open slots for all members, claiming, staffing status, messages to the space and DMs to the OC; the OC's decision on under-staffed events. |
| 4 Descriptions | Ported house template, normalisers, 4,096 limit and template search; editor with live preview, counter, TBA time/price, templates from published events, per-field autosave, realtime updates and presence; one deadline per cycle; Comms approve / request changes; idempotent publish with @all that edits the same message after later approvals; Comms dashboard. |
| 5 Attendance | MESAttendance's lists attached to events: QR token, public form, kiosk, live names (event staff while open, executives always), anonymous counts, sign-off by the OC with headcount, sign-in window, three-year retention. |
| 6 Hand-in & reimbursements | Versioned rules seeded with the SPEC table, Treasurer-only publishing; suggestions computed in the database and mirrored in TypeScript; receipts (photos removed in the review round); statuses Beleg → checked → paid/rejected; monthly payout batches; early payout above €100; pre-approvals; trip budgets; payout details deleted when settled; event photos to Drive via a job. |
| 7 Dashboards | Events (schedule, short of people, form status), Comms (awaiting review, ready, late, due, published), Finance (figures, claims table, batches, pre-approvals, budgets, rules); per-event checklist; Dockerfile + docker-compose (image built and smoke-tested). |

## Checks (last run)

| Check | Result |
|---|---|
| `npm test` (unit) | **271 passed** (14 files) |
| `npm run test:db` | **1,673 passed** (7 files), incl. the RLS matrix |
| `npm run test:bundle` (after `build:local`) | **10 passed** |
| `npm run test:e2e` (production build) | **23 passed**, 1 skipped (organiser part of the live-list test on the phone project) |
| `npm run lint`, `npm run typecheck` | clean |
| `npm audit` | 0 vulnerabilities |
| `docker build` | image `mesa-events:local` builds (315 MB); container serves `/login`, `/impressum`, job route answers 401 without secret |

The bundle scan found one real issue during the run – the local sign-in markup was still in the
production login chunk (only disabled at runtime); it is now dropped at build time.

## Gaps and known limitations

- **Real Google APIs** (Chat spaces and messages, Drive upload, Directory) cannot be exercised
  locally; the fakes stand in, and the real clients are tested against a mocked `fetch` only. Chat
  needs domain-wide delegation for a bot user (`GOOGLE_CHAT_SUBJECT`); verify scopes with
  Workspace admins before going live.
- **Legal texts** were copied from MESAttendance and do not yet cover the new processing
  (volunteer data, receipts, IBAN/PayPal, Chat). The board must update the privacy notice and
  data protection documentation before real use.
- Drag and drop on the roster board is checked manually; the E2E test uses the "Move to…"
  control on the same board.
- Realtime presence in the description editor is checked manually (two browsers); autosave,
  merge and review are covered by tests.
- Times are entered and shown in Europe/Berlin; the volunteer form deadline is closed by a
  minutely cron job, so it can stay open up to a minute longer than set (the submission itself
  checks the deadline exactly).
- Public calendar (P3), Stripe ticketing and a finance ledger (P4) are not built, as specified;
  `events.visibility` and the event series table are in place for them.
