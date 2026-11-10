# Staging – a demo site with test data

A staging deployment shows the platform to the board and the team leads with **made-up data only**:
40 fictional members (`….demo@esnmesa.org`), fifteen months of events around today (a planning
cycle for every month of the year: twelve done ones, the current month, next month and the one
after), and every step of the monthly workflow in some state. Nothing it does leaves the database: Google Chat, Drive,
Directory and Telegram run on the fakes, and **Demo outbox** shows what would have been sent.

This page is the checklist for setting it up (the user's step – nothing here was deployed), for
presenting, and for resetting. Design decisions are in `docs/DECISIONS.md` ("Staging").

## What makes a deployment "staging"

| | |
|---|---|
| Build | `NEXT_PUBLIC_APP_ENV=staging` (baked in; a production build contains no staging sign-in code – the bundle scan checks) |
| Runtime | `APP_ENV=staging` (the server refuses to start if build and runtime disagree) |
| Database | its own Supabase project; `STAGING_SUPABASE_PROJECT_REF` = that project, different from `PRODUCTION_SUPABASE_PROJECT_REF`; `private.config` `environment` = `staging` |
| Services | `GOOGLE_MODE=fake`, no service account, no Telegram token – the server refuses to start otherwise |
| Visible | an amber banner "Staging – demo data only, nothing is real" on every page, "[Staging]" in the tab title, `X-Robots-Tag: noindex` and a disallow-all `robots.txt` |
| Sign-in | **Demo sign-in** (`/staging`): the shared access code (`STAGING_ACCESS_CODE`, 16+ characters), then a role picker. Google sign-in keeps working for real members, who then see the demo data |

The demo sign-in and the reset need **all** of: staging build, staging runtime, the staging
project ref, and that ref not being the production one. The database adds its own lock: the
functions that create demo members and wipe the data refuse unless `private.config` says
`environment = staging` – a production database never has that row.

## Pre-flight checklist

Before the first deploy, and after changing any setting:

- [ ] A **separate** Supabase project for staging (never the production project, never a copy of
      production data).
- [ ] `STAGING_SUPABASE_PROJECT_REF` = the staging project's ref; `PRODUCTION_SUPABASE_PROJECT_REF`
      = the production project's ref (both set, and different).
- [ ] `NEXT_PUBLIC_APP_ENV=staging` at **build** time and `APP_ENV=staging` at runtime.
- [ ] `GOOGLE_MODE=fake`, `TELEGRAM_MODE=fake`; `GOOGLE_SERVICE_ACCOUNT_*` and
      `TELEGRAM_BOT_TOKEN` **not set**.
- [ ] `STAGING_ACCESS_CODE` set (16+ characters, e.g. `openssl rand -base64 18`) and shared with
      the presenters only – not in slides or the invitation mail to the audience.
- [ ] `private.config`: `environment = staging`, the job runner URL and secret (below).
- [ ] Supabase Auth: Email provider **on** (the demo members sign in with a password the server
      derives); Site URL and redirect URL of the staging domain.
- [ ] Demo data seeded (`staging:reset`), and the site shows the banner.
- [ ] Search engines: `curl -I https://<staging-domain>/login` shows `x-robots-tag: noindex, nofollow`.

If the server does not start, its log says which check failed ("Refusing to start: the staging
configuration is unsafe …").

## Target A – Supabase + Vercel (today's plan)

1. **Supabase project.** In the Supabase dashboard create a project, e.g. `mesa-events-staging`
   (Free plan, region EU Central / Frankfurt). Note its ref (`https://<ref>.supabase.co`), the anon
   key and the service-role key (Settings → API).
2. **Migrations.** From the repo, link the CLI to the **staging** project and push:

   ```bash
   npx -y supabase@2.121.0 link --project-ref <staging-ref>
   npx -y supabase@2.121.0 db push
   ```

   Check the ref twice – `db push` goes wherever the CLI is linked. Never load
   `supabase/seed.sql` (it holds local test accounts). The migrations enable `pg_cron` and `pg_net`;
   if `db push` complains, enable both under Database → Extensions and push again.
3. **Database settings** (SQL editor of the staging project):

   ```sql
   insert into private.config (key, value) values
     ('environment', 'staging'),
     ('job_runner_url', 'https://<staging-domain>/api/jobs/run'),
     ('job_runner_secret', '<JOBS_SECRET>')
   on conflict (key) do update set value = excluded.value;
   ```

   pg_cron then calls the job runner every 30 seconds (the fakes record Chat messages, Drive
   folders and Telegram posts; photo reminders and "completed" statuses follow the clock).
4. **Auth** (Authentication → Providers / URL Configuration): enable **Email** (demo members). Any
   sign-up that is not a Google Workspace account is refused by the database, so this opens nothing
   else. Site URL `https://<staging-domain>`, redirect URL `https://<staging-domain>/auth/callback`.
   Optional: Google, with the Workspace's OAuth client and the staging callback URL added.
5. **Vercel project.** New project from the same repository, e.g. `mesa-events-staging`
   (framework Next.js, default build command; the production branch can be `main` or a `staging`
   branch). Under Settings → Environment Variables add everything from `.env.staging.example` for
   the Production environment of this project – `NEXT_PUBLIC_APP_ENV=staging` must be there before
   the build. Add the staging domain (e.g. `staging.events.esnmesa.org`). Deploy.
6. **Demo data** – from a machine with the repository (`npm ci`), with the staging values in
   `.env.staging`:

   ```bash
   node --env-file=.env.staging scripts/seed-staging.mjs --remote --reset
   ```

   It refuses unless every gate holds for that environment. Later resets: the Admin button (below).
7. **Check** the pre-flight list on the live site: banner, `/staging` asks for the code, every role
   in the picker opens, Admin → background jobs run (the outbox fills as jobs run).

## Target B – a VPS with docker compose (portability)

`docker-compose.staging.yml` builds the staging image (`NEXT_PUBLIC_APP_ENV=staging`) and runs it on
`127.0.0.1:3001`, next to a production container on 3000. The main `docker-compose.yml` and
`Dockerfile` are unchanged in use (the Dockerfile gained the `NEXT_PUBLIC_APP_ENV` build arg,
default `production`, and a `tools` stage).

1. **Supabase**, either
   - a **hosted** staging project: steps 1–4 of Target A; or
   - **self-hosted** Supabase (its own docker-compose,
     https://supabase.com/docs/guides/self-hosting/docker, in its own directory): apply the
     migrations (`npx -y supabase@2.121.0 db push --db-url postgres://…`), run the SQL of step 3,
     configure Auth (step 4) in its `.env`. Then `STAGING_SUPABASE_PROJECT_REF` is the host (and
     port, if any) of `NEXT_PUBLIC_SUPABASE_URL`, e.g. `supabase.staging.example.org`.
2. **Configuration:** `cp .env.staging.example .env.staging` and fill it in (it never goes into git
   or the image).
3. **Start:**

   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
   ```

4. **TLS:** a reverse proxy (Caddy, nginx) for the staging domain → `127.0.0.1:3001`.
5. **Demo data:**

   ```bash
   docker compose -f docker-compose.staging.yml --env-file .env.staging run --rm tools npm run staging:reset -- --remote
   ```

The CI workflow builds and smoke-tests the staging image too (banner, noindex, refusal with
`GOOGLE_MODE=real`); nothing is pushed anywhere.

## Presenting

Open `https://<staging-domain>/login` → **Demo sign-in (staging)** → access code → pick a role.
**Switch role** (in the amber banner) brings the picker back; **Demo outbox** shows what the
platform would have posted. Every page except the sign-in pages needs a session: a link opened in a
browser that is not signed in lands on `/login`, and the demo sign-in then starts at the persona's
own page, not the link's – use the banner's links after signing in.

| Role | Demo person | Starts at | Shows |
|---|---|---|---|
| Events team | Amara Okafor | Events | Plans the month: ideas → schedule, volunteer form, allocation, roster board, confirmation |
| Member | Hannah Becker | Home | Volunteer form banner (not answered yet), calendar, own ideas, open slots to claim |
| OC (organiser) | Chloé Dubois | Home | Her events today (attendance and cash box open), hand-ins (photos missing, list and cash box to sign off), claims needing Belege; descriptions: one to write for next month, one sent back, one with Comms; an office hour she leads next week; saved bank details, a calendar link |
| Helper | Kwame Mensah | Home | Events he helps at, a drop-out, a slot he claimed, his claims, an office hour shift |
| Comms team | Sofia Marino | Comms | Each event by stage (To write → In review → Approved · in the Chat space → pretix page → Advertised → Event happened → Report), the Advertisement schedule (Telegram previews with pictures, posts planned weeks ahead), default pictures (mock ones for every event type and category and every second format – labelled placeholders, so the fallback format → category → type can be seen), ESN Activities (with her access tokens) |
| Finance team | Priya Raman | Finance | Claims in every status, the open payout batch, paid batches, an early payout; cash boxes with history (money in and out, a recount, a removed box), cash reports counting, to sign off, to check, to book; the ledger with missing Belege |
| Treasurer | Mateo Álvarez | Finance | Finance plus rules and the pre-approval waiting for him |
| HR | Ines Kraft | Internal | Office hours every Wednesday, Stammtisch every Thursday, Tuesday Talks, board meetings and internal events: staffed, a helper or the OC missing, cancelled, a full sign-up list |
| Vice President | Marco Bianchi | Internal | Plans with HR; reads everything as a board member |
| Executive (board) | Elif Yıldız | Home | Everything read-only, Finance and board meetings included |
| Admin (IT) | Nadia Haddad | Admin | Roles, settings, jobs, **Reset demo data** |
| Newcomer | Noor Al-Sayed | Confidentiality rules | What a new member sees first |

### A 15-minute walkthrough: one month, end to end

The demo holds four months at four stages, so one month can be followed from idea to payout
without waiting for a deadline: month +3 has ideas but no cycle, month +2 has its volunteer form
open with answers, month +1 is allocated with descriptions being written, and this month has events
today, hand-ins and claims. Keep the **Demo outbox** open in a second tab for steps 4, 6 and 7.

1. **(1 min) An idea.** **Member**: Home shows the planning timeline and the open volunteer form
   in "Waiting for you"; Ideas shows which month new ideas go into and the countdown to the 7th;
   "Get inspired" → "Propose this again" into month +3.
2. **(2 min) Planning the month.** **Events team** → Events → "+ Plan a new month" → month +3 →
   "Start planning": the stepper with the cycle's dates (7 / 10 / 15 / 20); accept the month's
   ideas (Sledging at the Blomberg, Pancake Breakfast and the one just proposed), set type and
   format, a meeting point apart from the location.
3. **(1 min) The volunteer form.** Still Events: "Open volunteer form" (the deadline is prefilled
   with the 15th; normally the form opens by itself on the 10th). **Member**: fill it in, rank OC and
   helper – then it is locked.
4. **(2 min) Allocation and roster.** **Events team** → month +2: "Close the form" → "Run
   allocation" → the roster board with an under-staffed event; move someone → "Confirm roster".
   **Demo outbox**: the Chat spaces and welcome messages (the jobs run every 30 s).
5. **(1 min) The description.** **OC**: "Waiting for you" → the "Panel: Life after Erasmus"
   description Comms sent back: the comment, the live preview, the 4,096 counter → submit.
6. **(2 min) Comms.** **Comms team** → Comms by stage → the Erasmus panel in review → "Approve": it
   goes to the Chat space by itself (**Demo outbox**: the post with @all). pretix pages: tick an
   event with an approved description. Advertisement schedule: click a day on its row, plan a
   Telegram post, open it – the preview with its (mock) default picture – and confirm; the events
   the Events team marked big are listed weeks ahead ("Mark big" on the month's schedule).
7. **(1.5 min) Event day.** **OC**: today's Language Café – attendance open (QR code, kiosk, live
   names), the cash box counted. **Helper**: drop out of an upcoming event; the slot is open to all
   members and the OC is told (**Demo outbox**).
8. **(1 min) Hand-in.** **OC**: the Tegernsee trip from two days ago → Hand-in: the to-do list
   (photos, attendance list, report, Belege) → "Sign off & close".
9. **(2 min) Money.** **Finance team**: claims from "not submitted" to "paid", the open batch of this
   month, an early payout above €100, cash boxes, the ledger with missing Belege; **Treasurer**: the
   pre-approval for the Prague trip.
10. **(1.5 min) Oversight.** **Executive**: the same pages read-only, closed attendance lists with
    names.

The walkthrough changes the demo data: reset after a dry run, and again shortly before presenting.

Dates move with today: rerun the reset before a presentation if the site has been up for weeks,
so "today" and "next month" still match. The extra office hour "running now" starts half an hour
before the reset – reset shortly before presenting the cash box.

pg_cron keeps working on the demo: at the description deadline it cancels events whose
description was never submitted. The seed therefore puts unsubmitted descriptions only in next
month (deadline ahead); this month's coming events all have theirs submitted.

## Resetting

- **Admin → Demo data → Reset demo data** (staging only): type `RESET`, confirm. It wipes all
  workflow data (events, answers, descriptions, claims, the outbox, jobs, the log) and seeds again;
  members who signed in with Google keep their accounts, roles and accepted rules. The reset is
  logged (activity log entry "staging reset" with who did it).
- **From a terminal:** `node --env-file=.env.staging scripts/seed-staging.mjs --remote --reset`
  (Target B: the `tools` service above).
- Without `--reset`, `seed:staging` only replaces the demo's own data.

Every way refuses unless all staging gates hold, and the database refuses unless it is marked
`environment = staging`.

## When something refuses

| Message | Meaning |
|---|---|
| "Refusing to start: the staging configuration is unsafe" (server log) | A pre-flight item is missing; the list under it names which. |
| "Refusing: not a staging target" (seed script with `--remote`) | The environment file does not pass the gates (wrong ref, `APP_ENV`, …). |
| "Not a demo database" | `private.config` has no `environment = staging` row (step 3). |
| "Only demo addresses …" | Something tried to create a demo member with a real-looking address. |
| "Reset refused: no decision for table(s) …" | A newer migration added a table; add it to `private.staging_wipe_lists()` in a new migration. |
| "permission denied for table users" while seeding | The demo members are written into `auth.users` by a function owned by `postgres` (as `supabase/seed.sql` does locally). Not verified on a hosted project – nothing was deployed. Check in the SQL editor: `select has_table_privilege('postgres', 'auth.users', 'insert');` – if it says false, the project does not allow it and the demo members need another way in (docs/DECISIONS.md, "Staging"). |
| `/staging` asks for the code again | The access code changed, or the browser session ended. |
| A role in the picker says "The demo members are missing" | Run the reset. |

## Rehearsing locally

- The local stack uses the same demo data (one dataset since 2026-11-01): `npm run seed:staging`
  loads it, and `npm run dev:local`'s **Local test sign-in** offers the same personas as the demo
  sign-in. `npm run seed:staging -- --remove` takes it out again.
- `npm run build:staging && npm run start:staging` runs a real staging build on
  http://localhost:3200 against the local stack, with the local access code
  `local-staging-access-code` (a test value, `scripts/staging/local-env.mjs`).
- `npm run test:e2e:staging` checks it end to end and leaves the local database as it was.
