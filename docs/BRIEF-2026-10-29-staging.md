# Brief 2026-10-29 – staging setup with rich demo data

The user wants to **present the app to the responsible people** (board, team leads) on a staging
server. The server uses **test data only, never production data**, and the demo data should be much
richer than today's `seed:demo`.

This round prepares everything. It does **not** deploy anything and creates no cloud projects:
deploying needs the user's accounts and is their step, documented as a checklist.

## S1. A `staging` app environment

- New env `APP_ENV` = `production` | `staging` | `development`, plus `NEXT_PUBLIC_APP_ENV` inlined
  at build time. Document both in `.env.example` and add `.env.staging.example`.
- **Staging banner** on every page (root layout, not the member layout): "Staging – demo data
  only, nothing is real". Thin, clearly coloured, readable at 375 px. The tab title gets the prefix
  "[Staging]".
- `X-Robots-Tag: noindex` and a disallow-all `robots.txt` in staging.
- **External services are always fakes in staging**: Google Chat, Drive and Directory, Telegram,
  and anything else added meanwhile.
  - Refuse to start (a clear error at boot) if staging is configured with real credentials or
    `GOOGLE_MODE` other than fake.
- **Demo outbox page** (`/admin/demo-outbox`, staging and dev only) lists what would have been
  sent: Chat messages and spaces, Drive folders, Telegram posts. It reads the `fake_*` tables
  newest first and shows them human-readably. Presenters use it to show what the platform posts.

## S2. Demo sign-in on staging, safely

The local test sign-in (`lib/localLogin.ts`) is compiled out of production builds and needs a
local Supabase. Staging is a production build on the internet, so it needs its own guarded
version:
- **Enabled only when all of these hold:**
  - `NEXT_PUBLIC_APP_ENV=staging` at build time (dead code in production builds, verified by the
    bundle scan);
  - `APP_ENV=staging` at runtime;
  - the Supabase project ref equals `STAGING_SUPABASE_PROJECT_REF`;
  - that ref differs from `PRODUCTION_SUPABASE_PROJECT_REF` when the latter is set.
- **Shared access code:** the role picker sits behind a staging access code (`STAGING_ACCESS_CODE`,
  at least 16 characters, constant-time compare, rate-limited, cookie for the browser session).
  The site is public, so random visitors must not get in.
- **Picker:** a role picker with a short description of what each role sees ("Events team –
  plans the month …"), so presenters can switch roles quickly. There is also a "Switch role"
  link in the header while on staging.
- **Google sign-in** stays available on staging, but is not required.
- **Tests:**
  - unit tests for every gate combination;
  - a bundle-scan check that a production build contains no staging sign-in code or strings;
  - E2E against a staging-mode build (code → picker → role → banner visible).

## S3. Rich, realistic demo data (`npm run seed:staging`)

A deterministic seed (fixed random seed) relative to today, so the demo always looks current.
Works on the local stack too, so `dev:local` shows the same rich data.
- **Months:** 3 past cycles (done, with hand-ins and paid claims), the current month (events
  happening, some today), next month (form closed, roster being adjusted), and the month after
  (ideas and schedule, volunteer form open).
- **People:** about 40 fictional members with diverse, clearly fictional international names. Use
  `@esnmesa.org` demo addresses with the local part ending in `.demo`; no real people. Cover every
  role, a newcomer and a few very active volunteers.
- **Events:** about 30 across all types (standard, special, day trip, weekend trip), with realistic
  titles, venues in Munich, prices and capacities. Include every status: scheduled, confirmed,
  under-staffed (one decided "run", one waiting), cancelled (reopenable), completed, dropped.
- **Ideas** in every state; **volunteer responses** with ranks and submission times; **allocation**
  results with manual moves, dropouts with reasons and claimed replacements.
- **Descriptions** in every stage (missing, draft, changes requested with comments, submitted,
  approved, published), using real-looking texts in the house template, plus late and missed ones.
- **Attendance lists** with fictional participants, headcounts and signed-off lists.
- **Hand-in:** Drive folders and photo counts in the fake, event reports, receipts, and claims in
  every status (not submitted, Beleg received, checked, paid, rejected). Include payout batches
  (paid and open), a pre-approval, a trip budget, bank and PayPal details using official
  example/test IBANs only, and an early payout above €100.
- **Comms:** ESN Activities statuses (not ready, ready, uploaded), and publishing channels and
  scheduled posts (Telegram, Instagram, pretix), **as far as these features exist in the code when
  you write the seed**. They are being built in parallel; see "Working alongside other sessions".
- **History** for the ideas inspiration search (imported-archive style events), if that feature
  exists by then.
- Activity log entries that read naturally.
- **Commands:**
  - `npm run seed:staging` builds the data;
  - `npm run staging:reset` wipes all data except auth config and reseeds;
  - an Admin button "Reset demo data", shown in staging only, does the same server-side, logged
    and confirmation-protected.
  - The reset must refuse to run unless the S2 staging gates hold (never against production).
- **Tests:** a DB test that the seed runs twice cleanly, and that every status listed above
  exists after seeding.

## S4. Deployment configs and instructions (no deploy)

- **Target A (matches today's plan):** a separate **Supabase project for staging** plus a
  **Vercel project** (or Vercel environment) with staging env vars. Document creating the
  project, applying migrations (`supabase db push` against the staging ref), setting env vars,
  running `staging:reset`, and the pg_cron and jobs secret setup.
- **Target B (portability):** `docker-compose.staging.yml` (app + self-hosted Supabase, or app
  pointing at a hosted Supabase) with `.env.staging.example`, for a VPS. Keep the main Docker
  setup working.
- `docs/STAGING.md` covers:
  - both paths, step by step, with a pre-flight checklist (gates set, fakes on, access code
    shared, production refs different);
  - how to present: which role shows what, and a suggested 10-minute walkthrough script through
    the month's workflow;
  - how to reset.
- The CI workflow file builds the staging image too (files only, nothing pushed).

## Done when

- S1–S4 are implemented with tests.
- `lint`, `typecheck`, `gen:actions --check`, unit, DB, E2E (including the staging-mode E2E), the
  bundle scan (production build has no staging sign-in) and `docker build` pass.
- `npm run seed:staging` works on the local stack, and the local database is back to its normal
  state after the test suites.
- DECISIONS.md, PROGRESS.md, `.env.example` and `docs/STAGING.md` are updated.
- Everything is committed to local `main`. Nothing is pushed or deployed, and no cloud project is
  created.

## Working alongside other sessions

Two other sessions work in the same checkout at the same time:
- one builds Drive photos, ESN Activities, month pages, idea inspiration and publishing; it edits
  `scripts/seed-demo.mjs`, the Comms and Events pages, and the jobs;
- one builds the pretzel logo and wordmark; it edits `components/BrandMark.tsx`,
  `app/(app)/layout.tsx`, the icons and `design/`.

So:
- put the staging seed in **new files** (`scripts/seed-staging.mjs`, `scripts/staging/*`) layered
  on top of the demo seed rather than editing `seed-demo.mjs`;
- put the banner in the root `app/layout.tsx` or a new component;
- commit only your own files with explicit pathspecs (`git commit -- <paths>`); never `git add -A`,
  stash, reset or checkout others' changes;
- before your final checks, look at `git log` for what the others have landed since you started,
  and extend the staging seed to cover it;
- if a full test run fails only because of another session's unfinished work, say so in PROGRESS.md
  rather than changing their files.
