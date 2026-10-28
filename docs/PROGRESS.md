# Progress – Phase 1 (local only)

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
| 6 Hand-in & reimbursements | Versioned rules seeded with the SPEC table, Treasurer-only publishing; suggestions computed in the database and mirrored in TypeScript; receipts with private Storage photos; statuses Beleg → checked → paid/rejected; monthly payout batches; early payout above €100; pre-approvals; trip budgets; payout details deleted when settled; event photos to Drive via a job. |
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
