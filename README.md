# MESA Events Platform

ESN MESA's internal event workflow: ideas → month schedule → volunteer form → allocation → Chat
spaces → descriptions and Comms review → attendance → hand-in → reimbursements. Next.js 16 +
Supabase, portable to a self-hosted VPS (standalone Node server, pg_cron, Dockerfile).
Spec: [`docs/SPEC.md`](docs/SPEC.md); decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md);
status: [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Run locally (needs Docker)

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

Open http://localhost:3000 and use **Local test sign-in** (one seeded member per role; only in
development). Google services run on database fakes; pg_cron calls the job runner every 30 s
(or `npm run jobs:run`). The local stack uses ports 544xx (`supabase/config.toml`).

## Tests

```bash
npm test
```

```bash
npm run test:db
```

`npm run lint` and `npm run typecheck` check the code. Stop `dev:local` before `test:db` (its job
runner would process the tests' jobs). E2E: see `docs/PROGRESS.md` (not finished).

## Configuration and deployment

All variables are documented in [`.env.example`](.env.example). Build the image with the
`NEXT_PUBLIC_*` build args (see `Dockerfile`) and run it with `docker-compose.yml`; store the job
runner URL and secret in `private.config` in the database.
