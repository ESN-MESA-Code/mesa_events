# MESA Events Platform – Build Spec (Phase 1, local only)

Condensed from the design report "MESA Events Platform – Design Report"
(https://claude.ai/artifact/WxtFTjCgMwgZArwRZKhU1U, as of 2026-10-28). Where this file and the
report differ, this file wins for the build.

## Goal

One internal web platform for ESN MESA's whole monthly event workflow: ideas → month schedule →
volunteer form → OC/helper allocation → Chat spaces → event description → Comms hand-off →
attendance → hand-in (photos, attendance list, receipts) → Finance reimbursement tracking.
Phase 1 is an internal tool. Public calendar (P3), Stripe ticketing and a finance ledger (P4) come
later; design for them but do not build them.

## Reference code (read-only, never modify)

- `D:\Claude\digital_attendance_list` – **MESAttendance**: Next.js 16 + Supabase app. Copy its
  stack, auth (`lib/auth.ts`, Workspace-domain Google login), local login for tests
  (`lib/localLogin.ts`, `scripts/dev-local.mjs`, `scripts/local-supabase.mjs`), Supabase helpers,
  test setup (Vitest unit + db projects, Playwright), migrations style, RLS patterns, legal pages,
  and all attendance features. Its features and tests move into this repo.
- `D:\Claude\esn-event-description-bot` – Apps Script Chat bot. Port the description template
  logic from `src/Description.gs` + `src/Config.gs` (house template, emojis, headings, TBA time and
  price, 4,096-character limit) and template search from `src/Search.gs` to TypeScript. Its README
  describes all features.

## Roles

Roles come from Google Workspace groups; group addresses are **configuration variables** (env).
Locally, seed users per role.

| Role | Can do |
|---|---|
| Member (any @esnmesa.org) | Propose ideas; fill volunteer form; see internal calendar; claim open slots |
| OC (per event) | Own the event: details, description, attendance, photos, receipts; decide whether an under-staffed event runs |
| Helper (per event) | See event and details; help with check-in; drop out |
| Events team | Ideas → schedule, set event type, open/close volunteer form, run/adjust allocation, set month's description deadline, create spaces, see all |
| Comms team | Review/approve descriptions, publish |
| Finance team | Track receipts and reimbursements, payout batches |
| Treasurer (Finance) | Only person who may edit reimbursement rules; approves weekend-trip "further expenses" beforehand |
| Executive | See everything incl. names on closed attendance lists (as MESAttendance) |
| Admin (IT) | Settings, role mapping |

## Monthly workflow (P1)

1. **Propose idea**: any member; title, date, pitch, number of helpers needed. Proposer becomes OC by default.
2. **Month schedule** (`planning_cycles`, one per month): Events accepts/moves/merges/rejects ideas, adds own events, sets each event's **type** (standard, special, day trip, weekend trip).
3. **Volunteer form**: lists all events of the cycle; each volunteer picks events they can do and ranks OC and helper preference per event; closes at a deadline. Store submission time. **Each volunteer submits once; after that their answers are locked** (Events can clear a response so the person can resubmit).
4. **Auto-allocation** after the deadline: highest priority first; ties broken first come first served by submission time. One OC per event, `helpers_needed` helpers. **No cap** per person; anyone may OC several events. Events nobody signed up for are **dropped**. If an event has an OC but too few helpers, flag it; the OC decides whether it runs or is cancelled. Must be a pure, deterministic, unit-tested function.
5. **Adjust roster**: Events edits assignments (drag and drop), then confirms.
6. **Chat space** per event: create space, invite OC, helpers, Comms and Events; set space description with the date and @-mention OC and helpers. Update membership when the roster changes.
7. **Roster changes**: helper/OC can drop out from the event page → open slot visible to **all members**; Events or the dropout looks for a replacement in Chat; whoever takes it claims the slot on the event page; space membership updated automatically; OC notified.
8. **Description editor**: structured fields in the house template, live preview of the rendered Chat post, 4,096-char counter, TBA time/price, templates from past events, autosave, editor presence. **One description deadline per cycle**, set by Events, for all events.
9. **Comms hand-off**: submit → Comms approves or requests changes (comments) → publish to the event's Chat space (+ @all), idempotent; editing after publish edits the message.
10. **Attendance**: all MESAttendance features, attached to `events`.
11. **Hand-in**: photos uploaded by the team straight into the event's **Drive folder** (`<semester>/<yyyy-MM-dd Title>`, created by a job; Chat reminders at the start and the next morning; the file count read from Drive, or the OC's tick), close attendance list, the **event report** (participants and results, for ESN Activities), register each receipt (expense kind, amount, vendor, date, note). **No receipt photos are stored**: the **paper Beleg is mandatory** (German law) — the platform only tracks it. (Brief 2026-10-29.)
12. **Reimbursement**: statuses not submitted → Beleg received (who/when) → checked → paid / rejected. Category: team costs or ancillary costs. Payout by bank transfer or PayPal (store IBAN/PayPal only until paid). Approved claims go into a **monthly payout batch**; claims > €100 can be flagged for early payout.

Dashboards per team: Events (one month at a time: the cycle's steps and that month's events), Comms (one month at a time, each event by stage from the description to ESN Activities, with the action inline), Finance (open receipts, reimbursements, batches), plus a per-event checklist.

Added by the brief of 2026-10-29 (docs/BRIEF-2026-10-29-photos-esn-inspiration.md and
docs/BRIEF-2026-10-29-publishing.md):

13. **ESN Activities**: the bot's "ESN form data" built from the description and the report; Comms
    uploads with a browser script (personal access tokens; no API) or pastes the link; status
    not ready → ready → uploaded per event.
14. **Get inspired** on /ideas: search over previous events (also history imported from the bot's
    Sheet), "Propose this again".
15. **Publishing**: status per event and channel (Chat, Telegram, Instagram, pretix, ESN
    Activities; channels as data); Telegram posts by the platform at their planned time
    (re-publishing edits them); a drag-and-drop schedule board per month for Comms.

## Reimbursement rules (store as versioned data in `reimbursement_policies`, not code)

Only the Treasurer edits them. Each claim stores the policy version used. Money in integer cents.

| Event type | Expense kind | OC | Helper | Condition |
|---|---|---|---|---|
| Standard | Ticket / entry fee | 100%, max €16 | 50%, max €8 | |
| Special | Ticket / entry fee | 100%, no cap | 50%, no cap | |
| Day trip | Food or drinks allowance | €16 | €8 | ideally one receipt |
| Any | Ancillary costs (food, drinks, decorations, bookings essential for the event) | 100% | 100% | |
| Weekend trip | Travel and accommodation | 100% | 50% | |
| Weekend trip | Food allowance | €16 per day | €8 per day | |
| Weekend trip | Further expenses (attractions, museums) | 100% | 50% | Treasurer pre-approval before purchase |
| Weekend trip | Ancillary costs for social activities | 100% | 100% | within a trip budget set before the trip |

General: only valid receipts; payouts monthly; > €100 may be paid earlier. Suggested amount =
min(amount × rate, cap) (per day where applicable); Finance confirms or overrides.

## Data model (first sketch – refine as needed)

`planning_cycles` (month = the month its events take place in), `event_ideas`, `events` (type, start/end, location, price, capacity, helpers_needed, status, visibility, chat space, cycle_id, series_id), `event_series`, `volunteer_responses` (+ submitted_at), `assignments` (role OC/helper, source auto/manual/replacement, status active/dropped_out), `descriptions` + `description_versions`, `reviews`, `attendance_lists`, `participants` (from MESAttendance), `receipts`, `reimbursements`, `reimbursement_policies`, `payout_batches`, `activity_log`, `jobs`, `profiles`, `role_members`. RLS on every table.

## Architecture constraints

- One Next.js 16 app (App Router, React 19, TypeScript, Tailwind 4, shadcn/ui, TanStack Table, dnd-kit, date-fns + @date-fns/tz Europe/Berlin, react-hook-form + zod). Supabase Postgres + Auth + Realtime + Storage, SQL migrations, RLS, `supabase gen types`. No ORM, no separate backend, no global state library, no Yjs.
- Outgoing work (Chat API, Drive) goes through a `jobs` table with retries and idempotency keys; `pg_cron` + `pg_net` call a secret-protected API route. Writes from the UI are direct.
- Google APIs: small fetch-based clients (like MESAttendance `lib/google/directory.ts`) behind interfaces, with **fakes** used in dev and tests. Service account key from env.
- **Portability to a self-hosted VPS** (hard requirement): `output: "standalone"`, Node runtime only, no Vercel-specific features (no Vercel cron, KV, Blob, Edge Config, Analytics, OIDC), only Supabase features that run self-hosted (no Edge Functions), all scheduling in pg_cron, all config in env documented in `.env.example`, Dockerfile + `docker-compose.yml` in the repo, base URL from env (own domain).
- EU/GDPR: keep MESAttendance's privacy rules (minimisation, retention, consent versions, anonymous stats).
- English UI.
