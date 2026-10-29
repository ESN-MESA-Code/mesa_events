# MESA Events Platform

ESN MESA's internal web platform for the monthly event workflow: ideas → month schedule →
volunteer form → OC/helper allocation → Google Chat spaces → event descriptions and Comms review →
attendance → hand-in (photos, attendance list, receipts) → reimbursements and payouts.

- **Spec:** [`docs/SPEC.md`](docs/SPEC.md) (authoritative) · **Decisions:** [`docs/DECISIONS.md`](docs/DECISIONS.md) ·
  **Status:** [`docs/PROGRESS.md`](docs/PROGRESS.md)
- **Stack:** Next.js 16 (App Router, React 19, TypeScript, Tailwind 4, shadcn-style components,
  TanStack Table, dnd-kit, date-fns + @date-fns/tz, react-hook-form + zod) and Supabase (Postgres,
  Auth, Realtime, Storage, RLS, pg_cron, pg_net). Attendance comes from MESAttendance; the
  description template from the ESN event description bot.
- **Portable:** standalone Node server, no Vercel features, all scheduling in pg_cron,
  configuration in env, `Dockerfile` + `docker-compose.yml`.

---

## Run it locally

Needs Node 22+ and Docker (or Podman). Nothing here touches a real Supabase project or Google.

```bash
npm install
```

```bash
npm run supabase:start
```

```bash
npm run seed:demo
```

```bash
npm run dev:local
```

Open http://localhost:3000 and pick a member under **Local test sign-in**. Everyone lands on
**Home** ("what's next for me": the open volunteer form, their events with the next step and
deadline, open slots, claims that need something, and a card per team queue for team members) – one seeded account
per role (member, OC and helper of the demo events, volunteers, Events, Comms, Finance,
Treasurer, executive, admin, and a newcomer who has not accepted the confidentiality rules). The
local sign-in exists only in development against a Supabase on your machine; production builds
compile it out (tested).

`seed:demo` prints links to a realistic month: confirmed events around today with Chat spaces
(each in the cycle of the month it takes place in), an under-staffed hike, a weekend trip, an
event happening now (attendance open, with the public form link), a past event with receipts for
Finance, the following month's open volunteer form and ideas for the month after. Run it again
to start over (it also removes what was added to its cycles by hand).

Good to know:

- The local Supabase uses ports **544xx** (API 54421, DB 54422) so it can run next to
  MESAttendance's stack.
- **Google services run on fakes** without a service account: spaces, members, messages and Drive
  files are recorded in the `fake_*` tables (Admin page shows "fake mode").
- **Background jobs** (Chat, Drive, role sync): pg_cron calls `POST /api/jobs/run` every 30 s
  while `dev:local` runs; `npm run jobs:run` runs them at once. Failed jobs retry with backoff;
  admins see and retry them under **Admin**.
- `npm run supabase:reset` rebuilds the database from the migrations and `supabase/seed.sql`.
- After a schema change: `npm run gen:types` (types/database.ts); after adding a server action in
  `lib/actions/*`: `npm run gen:actions` (writes `app/actions/*`; each action declares the pages it revalidates).

## Tests

| Command | What | Needs |
|---|---|---|
| `npm test` | Unit: allocation, reimbursement rules (every SPEC row) and claim steps, description template, 4,096 limit and search, Berlin dates, auth/open redirects, local login, security headers, Google clients, Chat texts, checklist and next step, cycle steps, My events grouping, plurals, navigation, breadcrumbs, activity texts, generated actions and their revalidation | nothing |
| `npm run test:db` | RLS matrix (every table × 11 roles × select/insert/update/delete, cross-event, anonymous), planning, Chat jobs, descriptions, attendance (ported MESAttendance tests), reimbursements and hand-in photo Storage, server actions re-checking roles | local Supabase |
| `npm run build:local` then `npm run test:bundle` | No service-role key, jobs secret, Google key or test password in `.next/static`; local sign-in compiled out; no source maps | a production build |
| `npm run test:e2e` | Playwright against the **production** build: the whole month across roles (idea → paid reimbursement), dropout and replacement, cancelling and reopening, a cycle's hand-in and Done step, Comms review, Home per role, locked volunteer form and Events clearing a response, cycle month validation, executive read-only Finance, every role's pages at 375 px, security (CSP nonce, headers, job route secret, local login 404, sign-in and confidentiality gates, No access, open redirects, IDOR on every `[id]` route, no receipt photos), public form, kiosk, legal pages | local Supabase, Chromium (`npx playwright install chromium`) |

`npm run lint` and `npm run typecheck` check the code; `npm run gen:actions -- --check` that the
generated server actions are up to date. `.github/workflows/ci.yml` runs all of it (plus a
types-drift check and the Docker build) on GitHub against a local Supabase in the runner. Stop `dev:local` before `test:db` and
`test:e2e` (its pg_cron job runner would work on the tests' jobs). `test:e2e` builds first; set
`E2E_SKIP_BUILD=1` to reuse the last `build:local`.

Both suites use the same local database as `dev:local` and remove what they created before and
after a run (`scripts/clean-test-data.mjs`: cycles in test months – before 2020 or from 2040 on –
and rows the test helpers tag with `created_by = tests@mesa.invalid`, with everything depending
on them). Run `npm run clean:test-data` by hand after an aborted run.

## Configuration

Every variable is documented in [`.env.example`](.env.example):

- Supabase URL and keys (`NEXT_PUBLIC_*` are baked in at build time; the service-role key is
  server-only),
- `APP_BASE_URL` (your own domain), `NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN`,
- `JOBS_SECRET` for the job runner route,
- the Google groups per role (`GROUP_EVENTS`, `GROUP_COMMS`, `GROUP_FINANCE`, `GROUP_TREASURER`,
  `GROUP_EXECUTIVES`, `GROUP_ADMINS`),
- the Google service account (Directory, Chat as `GOOGLE_CHAT_SUBJECT`, Drive folder).

The database needs the job runner's URL and secret (pg_cron calls the app through pg_net):

```sql
insert into private.config values ('job_runner_url', 'https://events.esnmesa.org/api/jobs/run'),
                                  ('job_runner_secret', '<JOBS_SECRET>')
on conflict (key) do update set value = excluded.value;
```

## Deploying

1. **Supabase:** a hosted project (Free) or self-hosted Supabase. Apply `supabase/migrations`
   (`supabase db push`, or `psql` in order). Never load `supabase/seed.sql` there. Enable Google
   sign-in (Internal OAuth consent screen of the Workspace, as in MESAttendance) and disable the
   other providers; set the Site URL and `https://<domain>/auth/callback`.
2. **App:** build the image with the public values and run it behind a TLS reverse proxy:

   ```bash
   docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t mesa-events .
   ```

   or `docker compose up -d --build` with a filled `.env` (see `docker-compose.yml`). Vercel works
   too (no Vercel-only features are used), but the target is the VPS.
3. Set `private.config` (above), the role groups, and the Google service account; check
   **Admin → Background jobs** after the first roster confirmation.

## Project layout

```
app/(app)/            member area: Home (/), calendar, ideas, volunteer, my events, event pages, no-access
  events/[id]/        overview (roster, claims, checklist), description, attendance, hand-in
  team/events|comms|finance/   team dashboards, cycles and roster, payouts, rules
  admin/              roles, settings, jobs
app/event/[token]     public attendance form    app/kiosk/[id]   form on an organiser's device
app/api/jobs/run      job runner (secret)      .github/workflows/ci.yml   CI (not pushed)
app/actions/          generated "use server" exports of lib/actions
lib/actions/          server actions: zod input, role checks from the database
lib/allocation.ts     deterministic OC/helper allocation
lib/reimbursement.ts  rules and suggested amounts (mirrored in SQL)
lib/description/      the bot's template and template search
lib/google/           Directory, Chat, Drive clients + fakes
lib/jobs/             job runner and handlers
supabase/migrations/  schema, RLS, functions, cron jobs
tests/unit|db|bundle|e2e
legal/                Impressum, privacy notices, terms (from MESAttendance – to be reviewed)
```
