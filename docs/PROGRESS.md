# Progress – Phase 1 (local only)

## Round 2026-11-02 (3): Posts for events weeks ahead

Status: **implemented and tested locally.** Decisions: `docs/DECISIONS.md` ("2026-11-02 – Posts
for events weeks ahead"). No migration.

| Item | What changed | Tests |
|---|---|---|
| Schedule list | The month's events, then upcoming events of the next three months by month, big ones first; events in their volunteer form included | Unit: trayGroups, listedAhead, isBigEvent; E2E: schedule.spec (big event two months ahead) |
| Planning | "Plan…" from today to the event's day, default three days before; any day before the event in any month | Unit: defaultPostDay; DB: a post weeks ahead, drafts refused; E2E |
| Telegram | No Confirm while the job would refuse (unapproved, TBA); the warning names the description's due date | Unit: postWarnings; DB: refusal; E2E |
| Comms and Home | "channels planned" opens the board of the posting month with the event highlighted; Home's Comms queue counts upcoming events (this month and three ahead) still to plan | Unit: boardMonthFor, stillToPlan; DB: loadStillToPlan |

## Round 2026-11-02 (2): Meeting point

Status: **implemented and tested locally.** Decisions: `docs/DECISIONS.md` ("2026-11-02 – The
meeting point"). New migration `20261102000200`.

| Item | What changed | Tests |
|---|---|---|
| Data | `events.meeting_point` + optional address + `meeting_time`; `event_formats.meeting_point`; `accept_idea()` takes the format's; calendar feed says where and when to meet | DB: OC saves / helper refused, action checks, shapes, schedule clears, feed; formats: accept carries it |
| Description | Fields `meeting` / `meetingTime`, own line in the post, prefilled from the event; meeting fields in Basics saved on the event; venue check compares the venue with the location only | Unit: render, validation, mismatch, prefill; E2E: meeting.spec |
| Forms | Event details (checkbox + place search + time), schedule add/edit (name), formats (usual meeting point) | E2E: meeting.spec |
| Display | Event page Details and header, helper info on Home, activity log | Unit: lines, activity; E2E: meeting.spec |

## Round 2026-11-02: Cycle timeline, new Home

Status: **implemented and tested locally.** Decisions: `docs/DECISIONS.md` ("2026-11-02 – The
cycle timeline and a new Home"). New migration `20261102000100`.

| Item | What changed | Tests |
|---|---|---|
| Timeline | `lib/timeline.ts` + `cycle_timeline()`; admin setting `cycle_timeline` (7 / 10 / 15 / 20) | Unit: dates (DST, year change), open idea months, labels; DB: SQL = TS, setting checked |
| Ideas | Closed per month after its 7th, later months always open; banner with countdown, date minimum and "goes into …" on /ideas; "Propose this again" dates in an open month | DB: member refused / later month and next year fine / Events free |
| Form | Opens by itself on the 10th (closing the 15th) when the schedule has events; deadline field prefilled, off-standard note | DB: opens on the day, not before, not when empty, service role only |
| Descriptions | Deadline defaults to the 20th on confirming; reminder to the OCs the day before | DB: default on confirm, reminder once |
| Events team | Stepper dates, late step in red with "Overdue since …"; warning when the coming month has no cycle | Unit: notes, lateness |
| Calendar | The four dates of next month's cycle on their days | – |
| Home | Leaderboard removed; "Waiting for you"; planning timeline with the member's state; Coming up in MESA (internal only); date leaves | E2E: Home per role, volunteer form, internal sign-up |

## Round 2026-10-31 (2): Publishing calendar, pretix checklist, cash boxes

Status: **implemented and tested locally.** Decisions: `docs/DECISIONS.md` ("2026-10-31 –
Publishing calendar …"). New migrations `20261031000200`, `20261031000300`.

| Item | What changed | Tests |
|---|---|---|
| Publishing board | Month calendar (whole month visible) with the events on their dates and the posts on theirs; events listed on the left with a TG / IG chip each to drag; post details in a dialog; no "All channels" lane | E2E: drag a chip onto a day, keyboard plan, bundle onto a post, wrong channel refused, confirm, publish |
| pretix | A tick per event (link optional) instead of scheduled posts | DB: tick, link, untick, Comms only, channel off; E2E: tick and link |
| Cash boxes | `cash_boxes` with notes and coins; Finance adds, removes, sets defaults, puts money in / takes it out / recounts; staff pick the box when starting (default per office hour / event), opening count suggested from the box, sign-off sets the box | DB: defaults, in/out/recount, never more out than in, remove only empty, RLS matrix |

## Round 2026-10-30 (2): Internal events, office hours, cash boxes, finance ledger, leaderboard, iCal

Status: **implemented and tested locally; committed on the local branch
`feature/internal-events-finance`, not merged, nothing pushed.** Decisions: `docs/DECISIONS.md`
("2026-10-30 – Internal events …"). New migrations `20261030001000`–`20261030001400`; new seed
members `hr@` and `vp@` (`supabase/seed.sql`).

| Item | What changed | Tests |
|---|---|---|
| Roles | `hr`, `vice_president`, `newbie` from Google groups (`GROUP_HR`, `GROUP_VICE_PRESIDENT`, `GROUP_NEWBIES`); not "team" | Unit: navigation; RLS matrix with HR and VP as roles |
| iCal | Personal feed link on /calendar (shown once, hashed, replace / turn off), `/api/calendar/<token>.ics`, Google / webcal / download | Unit: escaping, folding, UTC, cancelled; DB: visibility, revoke, lost access; E2E: link → feed |
| Internal events | `internal_events` (internal, Stammtisch, Tuesday Talk, board meeting, office hour), people, defaults per kind; pages `/internal/[id]`, sign-up; board meetings only for the executive board | DB: planners only, kinds, sign-ups, capacity; RLS matrix; E2E: sign-up |
| Planner | `/team/internal`: semester view (six months) or month, drag a kind onto a day, move dates, roster of the semester's Stammtisch and office hours (members onto slots), Repeat over the semester (every / 1st–4th / last weekday, holidays to untick), defaults per kind | Unit: semesters, repeat dates; E2E: drag and drop, roster, repeat |
| Office hours | `/office-hours` and `/office-hours/[id]`: the same text, who is on duty, the cash box with ESNcards internal / external, the OC's sign-off | DB: staff only, counts validated, atomic counter, sign-off rules; E2E: count, sell, sign off |
| Event cash box | "Cash box" tab on events (staff, Events, Finance, executives): same counting and sign-off | DB: event box, no ESNcards there |
| Finance | Tabs; `/team/finance/ledger`: per-semester balance, per event, by category, booking income/spending with Beleg, categories; `/team/finance/cash`: every box, ESNcard totals, prices, check/book | Unit: totals, per event; DB: ledger RLS, booking once, reopen rules |
| Home | Internal calendar card; leaderboard (OC / helped this semester, active members and newbies) | Unit: ranking; DB: what counts, newbies by group |
| Demo | `seed:demo` plans the semester (office hours, Stammtisch, talks, board meetings, bowling), an office hour running now, signed-off boxes, ledger entries, a newbie | `seed:demo` twice |

### Checks (this round)

| Check | Result |
|---|---|
| `npm test` (unit) | **478 passed** |
| `npm run test:db` | **2,977 passed** (18 files; RLS matrix now 13 roles) |
| `npm run build:local` + `npm run test:e2e` | **62 passed**, 1 skipped (as before), incl. `internal.spec.ts` |
| `npm run test:bundle` | **20 passed** |
| `npm run lint`, `npm run typecheck`, `npm run gen:actions -- --check` | clean |

Fixed on the way: `monthly-cycle.spec.ts` checked "Roster confirmed", which is also a step label of
the cycle's stepper, and could run the jobs before the confirmation – it now waits for the
confirmation in the database (it failed when the server was warm).

Not done / limits: the migrations were applied incrementally to the local database, not from a
fresh `npm run supabase:reset`; the staging demo (`seed:staging`) has no internal events and no
HR/VP personas yet; the ESNcard "expected cash" assumes every card was paid in cash; there is no
public (non-member) calendar feed.

## Round 2026-10-30: User requests (deadlines, navigation, schedule, Comms, addresses, payouts)

Status: **implemented and tested locally; committed on local `main`, nothing pushed.** Decisions: `docs/DECISIONS.md`
("2026-10-30"). New migrations `20261030000100`–`20261030000600`. No real Google, Telegram or
ESN call; the address lookup calls Photon only from `dev:local`.

| Item | What changed | Tests |
|---|---|---|
| Description deadline | Set only after the roster is confirmed, to a time ahead; locked once passed; events without a submitted description are cancelled at the deadline (pg_cron, every minute) | DB: roster gate, future only, locked, cancellation with reason and Chat job, nothing twice |
| Cycle pages | Schedule, volunteer form, roster, descriptions, hand-in on their own pages; the stepper links each step; the month selector in the header keeps the page | E2E: monthly cycle through the step links, form page, roster by drag and drop, hand-in page |
| Schedule | Drag-and-drop month calendar (events to other days, ideas onto days); aligned list; roster without "Move to…", sorted by date | Unit: calendar weeks, moving keeps the times |
| Calendar, Get inspired | Calendar grid / aligned list with the month selector; infinite scroll on Get inspired | E2E: dropout test uses the list view |
| ESN Activities | Executive board only (database, actions, page at `/team/esn-activities`, navigation); no longer Comms work | DB + E2E: executives mark, Comms and members refused, tokens |
| Publishing | Three required channels, "All channels" lane, coverage per event, event dates on the board, Telegram confirmation with preview, uploaded pictures (private bucket) | DB: confirmation, plan everywhere, uploads; E2E: confirm, all channels |
| Descriptions | ESN card below the preview: type, objectives, goal (required), ratings; ESN-only edits keep the review | Unit: validation, form data |
| Addresses | Location name + street + postal code + city + country, search with suggestions, verification on save (Photon through `/api/address`; fake in tests) | Unit: Photon mapping, verification, modes; E2E: search, refusal |
| Payout details | On the profile (avatar menu → payout page), copied to open claims and new ones, deletable, warnings on reimbursements | DB: copy, owner only, delete rules; RLS matrix row |
| Demo data | More for Comms: reviews waiting, changes requested, approved, draft, an event on all three channels, confirmed and unconfirmed Telegram posts, an uploaded picture | `seed:demo` run; no event cancelled by the deadline job |

### Checks (this round)

| Check | Result |
|---|---|
| `npm test` (unit) | **452 passed** |
| `npm run test:db` | **2,189 passed** (16 files) |
| `npm run lint`, `npm run typecheck`, `npm run gen:actions -- --check` | clean |
| E2E (the 7 changed spec files, production build) | **33 passed** (monthly cycle, cycle hand-in, team months, schedule, ESN, dropout, review incl. 375 px) |

Not done / limits: the full E2E suite, the bundle scan and the staging build were not rerun this
round; Photon's public instance has a fair-use policy (self-host it with `PHOTON_URL` for heavy
use); the legal texts do not yet mention the address lookup or saved payout details.

## Round 2026-10-29: Staging with rich demo data

Brief: `docs/BRIEF-2026-10-29-staging.md`. Status: **S1–S4 implemented and tested; all checks
green.** Committed on local `main` (S1, S2, S3, the staging-mode build and E2E, the seed's
extension for history and publishing, S4, docs); **nothing deployed or pushed, no cloud project
created**, no real Google, Telegram or ESN call. Setup, presenting and resetting:
`docs/STAGING.md`. Decisions: `docs/DECISIONS.md` ("2026-10-29 – Staging"). New migration
`20261029005000_staging_demo.sql`; `supabase/seed.sql` marks the local stack as a demo database.

| Item | What changed | Tests |
|---|---|---|
| S1 Environment | `APP_ENV` / `NEXT_PUBLIC_APP_ENV` (always inlined), `.env.example`, `.env.staging.example`; amber banner on every page and "[Staging]" titles; `X-Robots-Tag: noindex` and disallow-all `robots.txt`; fakes forced on staging; boot refuses real credentials, a non-fake Google mode, a short access code, mismatched build/runtime or a non-staging project; `/admin/demo-outbox` (staging and dev) lists Chat messages, DMs, spaces, Drive folders and Telegram posts | Unit: every gate combination, project refs, boot check, fakes, noindex, outbox helpers. E2E (staging): banner, title, noindex, robots, outbox; (production): none of it. Docker: the staging container exits with `GOOGLE_MODE=real` |
| S2 Demo sign-in | `/staging`: access code (constant time, rate-limited, session cookie) → role picker with what each role sees; 404 unless all four gates hold; passwords derived from the service-role key; "Switch role" in the banner; Google sign-in unchanged | Unit: code, cookie, limiter, passwords, cast and personas. Bundle scan: no staging sign-in code or strings in a production build (and present in a staging build). E2E (staging): wrong code → right code → picker → role → banner, switching roles, 375 px |
| S3 Demo data | `npm run seed:staging` / `staging:reset` (`--remote` only through the gates), Admin → "Reset demo data" (staging, typed confirmation, logged): 40 members, 35 events in six cycles relative to today with every status, ideas, answers, allocation with manual moves, drop-outs and claimed slots, descriptions in every stage (late, missed), attendance, Drive photos, reports, ESN Activities, claims in every status, batches, pre-approvals, trip budgets, an early payout, the outbox, publishing posts, bot-archive history, a natural activity log | DB: the seed twice, every status listed in the brief, sign-in only with the derived password, demo addresses only, service role only, the wipe (rolled back) and its refusal on an unmarked database, a decision for every table. E2E (staging): the reset needs RESET, admins only, same origin |
| S4 Deployment | `docs/STAGING.md` (checklist, Supabase + Vercel, VPS with `docker-compose.staging.yml`, presenting with a 10-minute walkthrough, resetting, troubleshooting); Dockerfile build arg `NEXT_PUBLIC_APP_ENV` and a `tools` stage; CI builds and smoke-tests the staging image and runs the staging E2E | Staging image built and smoke-tested locally (banner, noindex, refusal); main image unchanged |

### Checks (this round)

| Check | Result |
|---|---|
| `npm test` (unit) | **443 passed** (incl. the staging gates, sign-in, outbox and plural scan) |
| `npm run test:db` | **2,138 passed** (15 files), incl. `tests/db/staging.test.ts` |
| `npm run test:e2e` (production build) | **58 passed**, 1 skipped (as before), incl. `staging-off.spec.ts` |
| `npm run test:e2e:staging` (staging build) | **8 passed** (desktop and 375 px) |
| `npm run build:local` + `npm run test:bundle` | build OK, **20 passed**: no staging sign-in code or strings in the production bundle, present in the staging one |
| `npm run lint`, `npm run typecheck`, `npm run gen:actions -- --check` | clean |
| `docker build` | main image `mesa-events:local` (317 MB): login without banner or noindex, `/staging` 404, job route 401. Staging image: banner, noindex, exits with `GOOGLE_MODE=real` |
| Database after the suites | only the demo data (18 events, 4 cycles, 6 posts, no demo members; `clean:test-data` finds nothing) |

One earlier full run failed in `chat.test.ts`, `publishing.test.ts` and `schedule.spec.ts` because the
staging demo was loaded in the shared database at the time (see the limits below); on the demo
state all pass. Once, `seed:staging` replaced the demo data while another round's DB suite was
running – the sessions now take turns on the shared database.

Not done / limits: nothing deployed – the hosted steps in `docs/STAGING.md` are unverified,
in particular whether a hosted project's `postgres` role may write `auth.users` (the demo
members; noted in the troubleshooting table). The access-code rate limit is per server instance.
The in-app browser pane did not draw during this round, so the UI was checked through the
staging E2E (screenshots at 375 px) and HTTP requests instead of a manual walkthrough. The
other suites expect the normal local demo state: with `seed:staging` loaded, `chat.test.ts` and
the jobs tests of `publishing.test.ts` see the extra team members and jobs – run
`npm run seed:staging -- --remove && npm run seed:demo` before them (the staging tests restore
whatever was there).

## Round 2026-10-29: Drive photos, ESN Activities, month pages, inspiration, publishing

Briefs: `docs/BRIEF-2026-10-29-photos-esn-inspiration.md` (A–D) and
`docs/BRIEF-2026-10-29-publishing.md` (E), plus the user's request for a structured event
address. Status: **A–E and the address implemented and tested.** Committed on local `main`
(A, B, C, D, then E with the address, then docs); nothing deployed or pushed, no real Google,
ESN or Telegram call. Decisions: `docs/DECISIONS.md` ("2026-10-29 – Drive photos, …").
New migrations `20261029002000`–`20261029002300`, `20261029005100`, `20261029005200`
(`20261029005000` belongs to the staging session); existing ones unchanged.

### A – Event photos in Google Drive

| Item | What changed | Tests |
|---|---|---|
| Folders | `<root>/<SoSe_26 \| WiSe_26-27>/<yyyy-MM-dd Title>` by a job on the event's day (`drive.ensure_folder`), reused when it exists; `event_photo_folders` (id, URL, path) | Unit: names (bot's cases), client, fakes. DB: scheduler, folder path in the fake |
| Reminders | "📸 … starts now" at the start, "📤 … upload here 📁" at 10:00 the morning after the end (with the report link until it is in), once each; pg_cron every 5 min | DB: once each, texts |
| Count | Drive count hourly and on "Check again" (job), cached; "Photos are uploaded" tick (OC/Events) | DB: count incl. subfolders, permissions, Drive error kept, tick logged |
| Hand-in | "Open the photo folder in Drive" button, count, tick; checklist "Photos in Drive", next step, cycle hand-in | Unit: checklist; E2E: cycle hand-in, no file input |
| Removed | `event-photos` bucket and policies, `add_event_photo`, `event_photos`, `lib/uploads.ts`, upload job | DB: bucket and function gone |

### B – ESN Activities

| Item | What changed | Tests |
|---|---|---|
| Event report | `event_reports`, OC/Events after the start, prefilled from the list (headcount, German = local) and roster; Hand-in tab, checklist, next step, cycle Hand-in | DB: who writes/reads, log, prefill. E2E |
| Form data | `lib/esn`: address parser and builder ported from the bot, missing list, status not ready → ready → uploaded | Unit: bot's cases, status |
| Script + tokens | `tools/esn-activities/mesa-esn.user.js`; `GET /api/esn/events/[id]`, `POST …/linked` with personal access tokens (hashed, once, expiring, revocable, logged); CORS for activities.esn.org only; rate limits; ESN Activities page with install steps | DB/API: bad, revoked, expired, ex-Comms tokens, CORS, rate limits, no foreign data. E2E: token shown once, revoked |
| Manual link | Comms pastes the activity link (or takes it back); first link told in the space once | DB, E2E |

### C – One month at a time

| Item | What changed | Tests |
|---|---|---|
| Month selector | `?month=YYYY-MM`, ← →, list; first month with work by default; remembered per viewer; "+ Plan a new month" | Unit; E2E: switching, remembered |
| Comms by stage | One row per event with the stage track and the inline action (Review, Publish, Remind OC, Open ESN form, Paste link), filters with counts, "Needs Comms" default, late/missed marks, month progress, phone track | Unit: stages; DB: Remind OC; E2E: filters, actions, 375 px |
| Events month | Cycle stepper + main action, the month's events with status, staffing, description, hand-in | E2E |
| Home | Queues link to the right month | E2E (review) |

### D – Get inspired

| Item | What changed | Tests |
|---|---|---|
| Search | "Get inspired" on /ideas with the bot's search, filters (type, season/month, big turnout), results with headcount, runs, photo folder | Unit; E2E |
| Propose again | Prefilled idea form with a fresh date and a type suggestion | Unit; DB; E2E |
| Visibility | `inspiration_events()` for members: published descriptions, headcounts, folders only | DB |
| Import | `npm run import:bot-archive -- <csv\|json…>`: history (`source = 'bot_archive'`), idempotent, out of the workflows; fixture | Unit; DB |

### E – Publishing channels and schedule

| Item | What changed | Tests |
|---|---|---|
| Channels and status | `publication_channels` (admin switches), `publication_status()` per event and channel; chips on the Comms rows, "Not yet on" filter, "Published on" on the event page | DB; E2E |
| Telegram | Bot API client and fake; message builder (single, bundle, caption, 4,096); scheduled job per post version; re-publish edits; refusals (unapproved, TBA, length, picture); "📢 … on Telegram" once | Unit; DB; E2E (scheduled post published by the runner) |
| Board | `/team/comms/schedule`: lanes per channel × days, tray, drag to plan/bundle/move/remove, keyboard "Plan…"/"Move to…", warnings, Publish now/Edit/Mark published/Skip, Realtime + presence; Home "Posts planned this week" / "Overdue posts" | E2E: drag, keyboard, bundle, Instagram by hand |

### The event's address (user request)

| Item | What changed | Tests |
|---|---|---|
| Fields | Country (default Germany), street and house number, postal code, city (default München) on the event's Edit details; checks per country; city from the postal code (Munich and region, offline) | Unit; DB (action and constraints); E2E |
| Use | Description venue prefill, ESN form data (with the country) | Unit; DB |

### Checks (this round)

Run on a freshly reset local database (`supabase db reset` + `seed:demo`, with the user's
approval: the staging session's seed had been running in the same database).

| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm run gen:actions -- --check` | clean |
| `npm test` (unit) | **443 tests, 442 passed**; the one failure is the plural scan hitting `placed(s)` in the staging session's then-uncommitted `lib/staging/seed.ts` (not this round's code) |
| `npm run test:db` | **2,138 passed** (15 files), incl. the RLS matrix with the new tables |
| `npm run test:e2e` (production build) | **57 passed**, 1 skipped (as before: the organiser part of the live-list test on the phone project), 1 failed with `ERR_CONNECTION_REFUSED` (the test server was briefly unreachable); that spec (`ideas.spec.ts`) passed on its own right after |
| `npm run test:bundle` | **20 passed** |
| `supabase db reset` + `gen:types` | all migrations apply; types unchanged |
| `docker build` (with the `NEXT_PUBLIC_*` build args) | image `mesa-events:local` (317 MB); the container serves `/login` and `/impressum`, the job route and the ESN API answer 401 without credentials, `tools/esn-activities/` is in the image |
| Database after the suites | only the demo data (`clean:test-data` before and after both suites; `seed:demo` after the reset) |

Found and fixed during the runs: the publish action needs the description's approved text (test
data), two buttons named "Mark published" on a post card (the form's is now "Save link"), the
importer's top-level `await` (Playwright loads scripts through CommonJS), and the action count
test now includes the ESN and publishing modules.

Not done / limits: no real Google, ESN Activities or Telegram call (fakes only, as required); the
postal code lookup covers Munich and the region offline (other codes keep the typed city); HEIC
pictures are refused for Telegram instead of converted; no browser walkthrough beyond the E2E
tests.

## Review round 2026-10-29 (docs/REVIEW-2026-10-29.md)

Status: **every item of A and B implemented and tested; all checks green.** Committed on local
`main` (one commit per A item, B1+B2 together, the rest one each); nothing deployed or pushed, no
external API called. Decisions are in `docs/DECISIONS.md` ("Review round (docs/REVIEW-2026-10-29.md)").
New migrations `20261029001000`–`20261029001500`; existing ones unchanged, and the whole set
applies from scratch (`supabase db reset`, types unchanged afterwards).

| Item | What changed | Tests |
|---|---|---|
| A1 "Run it anyway" sticks | `events.understaffed_decision` (who/when), written only by `decide_understaffed()`; `refresh_staffing()` keeps a decided event confirmed; cleared when the event loses its OC (drop-out, removal, OC swap); staffing refreshed by a trigger on every roster change; OC can no longer write the status; "Run" needs an OC. | DB: run → claim (still short) → confirmed; drop-out keeps it; OC drops → under-staffed, decision cleared; new OC decides; roster swap clears it |
| A2 Cancel tells the team, reopen | `cancel_event()` (Events; OC via the under-staffed decision) stores who/when/why and enqueues one `chat.event_status` job per cancellation (space message mentioning OC and helpers, or DMs without a space); `reopen_event()` (Events only) back to the staffing status, space told; Comms "Cancelled after the description was published" with "Handled"; confirm dialog states the consequences. | DB: who may, one job per cancellation, message text, Comms list, reopen only by Events, DMs without a space. E2E `cancel.spec.ts` (Events cancel → Chat → Comms → reopen; OC's cancel dialog) |
| A3 Completed events | `private.complete_past_events()` on pg_cron every 15 min (end or start + 1 day); every hand-in path accepts completed; My events in Today / Coming up / Past, past labelled "Hand-in open" / "Done". | DB: the job's cases, hand-in on a completed event. Unit: grouping by Berlin day and end, hand-in labels |
| A4 Cycles finish | Stepper … → Descriptions → **Hand-in** ("3 of 5 events handed in", missing items per event on the cycle page) → **Done**; Descriptions counts only events ahead; done cycles collapsed under "Past cycles", out of the Home queue and Comms progress (`cycle_hand_in()`). | Unit: steps. E2E `cycle-hand-in.spec.ts` (past test month: Hand-in → Done → Past cycles, Home queue) |
| A5 Deadlines vs. month | DB refuses a description deadline after the first event's start (also an event added/moved before it) and a form deadline after the month's first day (Berlin); latest dates shown next to the inputs (`cycle_deadline_limits()`); seed fixed. | DB: limits, both refusals with their messages, event side |
| A6 Late vs. Missed | `description_overview()`: late = deadline passed and event ahead; missed = started without a published description; Comms "Missed" collapsed (60 days); Home counts only what can still be done. | DB: late/missed cases |
| A7 Test data | Tag = test months (< 2020, ≥ 2040) + `created_by = tests@mesa.invalid`; `scripts/clean-test-data.mjs` (`npm run clean:test-data`) before and after the DB and E2E suites; orphaned jobs/fake Chat rows and empty batches too; monthly E2E no longer leaves the quiz outside its cycle's month. The dev database was cleaned once (4 junk cycles, 8 events) and re-seeded. | Run of both suites, then a database check: only the demo's 4 cycles, 9 events, 2 ideas |
| B1 Payout line | "Payout: PayPal (olga@…)" / "Payout: bank transfer (DE89 •••• 3000)" until paid, "Paid to your … account" after. | Unit |
| B2 Hand-in receipts | "Yours: 2 receipts, all Belege in · Rest of the team: 1 receipt, 1 Beleg outstanding" (counts only). | Unit |
| B3 Plurals | `lib/plural.ts` everywhere (also "1 helpers" on the schedule and volunteer form). | Unit incl. a scan that fails on "(s)", "(e)" or inline plurals |
| B4 Next-step banner | Steps name their section; on its own tab the banner scrolls there ("Go to it ↓"). | Unit (`stepLink`) |
| B5 Claim card | No status badge next to the steps on the hand-in. | E2E (monthly cycle, hand-in text) |
| B6 Under-staffed banner | Worded for the OC, the Events team and others; without an OC "the Events team decides", only cancelling offered. | Unit |

### Checks (this round)

| Check | Result |
|---|---|
| `npm test` (unit) | **313 passed** (21 files) |
| `npm run test:db` | **1,760 passed** (8 files), incl. the RLS matrix |
| `npm run test:e2e` (production build) | **49 passed**, 1 skipped (as before: the organiser part of the live-list test on the phone project) |
| `npm run build:local` + `npm run test:bundle` | build OK, **10 passed** |
| `npm run lint`, `npm run typecheck`, `npm run gen:actions -- --check` | clean |
| `supabase db reset` + `gen:types` | all migrations apply; types unchanged |
| `docker build` | image `mesa-events:local` (315 MB); container serves `/login` and `/impressum`, job route 401 without secret |
| Database after the suites | only the demo data (`clean:test-data` finds nothing; `seed:demo` re-run after the reset) |

The first E2E run found two problems, both fixed: Playwright's loader cannot import a module
using `import.meta` (the cleanup script now detects a direct run from `process.argv`), and a
constant exported from a client component was used on the server (the cancel dialog showed
function text; the text now lives in `lib/labels.ts`).

Not done / limits: no browser walkthrough this round – the changed flows are covered by the E2E
tests above (incl. the cancel flow and the cycle's Hand-in step). The legal texts and the
never-run CI workflow are unchanged from the last round (see below).

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
