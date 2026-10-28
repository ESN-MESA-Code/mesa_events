# Progress – Phase 1 (local only)

Status 2026-10-28: **milestones 1–6 done and committed, milestone 7 partly done.** The run stopped
at the usage limit before the end-to-end suite, the bundle scan, `docker build` and the final
checks were finished. Nothing was deployed or pushed.

## Built

| Milestone | What | Commit |
|---|---|---|
| 1 Foundation | Next.js 16 + Supabase, Workspace login, roles from configurable groups (`role_members`), profiles, cycles, events, assignments, activity log, jobs queue (retries, idempotency keys, pg_cron + pg_net → secret-protected `/api/jobs/run`), Google Directory/Chat/Drive clients with DB and memory fakes, local test sign-in per role (impossible in production builds), nonce CSP | `8d1fab2` |
| 2 Planning cycle | ideas, month schedule (event types), volunteer form, deterministic allocation (`lib/allocation.ts`), roster board (dnd-kit + "Move to…"), confirmation | `03d3742` |
| 3 Chat spaces | spaces per event via jobs, member sync, welcome message with @-mentions, dropouts, open slots, claiming, OC notifications | `2952f21` |
| 4 Descriptions | bot template + search ported, editor with live preview, 4,096 counter, TBA, templates, per-field autosave, realtime + presence, cycle deadline, Comms review, idempotent publish (+@all, edits same message), Comms dashboard | `1d9aae4` |
| 5 Attendance | MESAttendance moved in (lists per event, public form, kiosk, live names, sign-off by OC, counts, retention) | `f7534aa` |
| 6 Hand-in | versioned rules (SPEC table), Treasurer-only publishing, suggestions computed in DB and TS (parity test), receipts in private Storage, statuses, monthly batches, early payout, pre-approvals, trip budgets, payout details purged when settled, photos → Drive job, Finance dashboard, My events | `8f0798b` |
| 7 Dashboards | Events, Comms, Finance dashboards; per-event checklist (`lib/checklist.ts`); Dockerfile + docker-compose; Playwright config + fixtures | final commit |

## Tests (last run)

- Unit (Vitest): **271 passed** – allocation, reimbursement (every SPEC row, caps, per day,
  pre-approval, budgets, versioning), description template/limit/search, dates/time zones, auth
  and open redirects, local login (incl. production), security headers, Google clients, Chat
  texts, checklist.
- DB (Vitest against local Supabase): **1,673 passed** – including the RLS matrix (every table ×
  11 roles × select/insert/update/delete, cross-event, anonymous), planning, chat, descriptions,
  attendance (ported MESAttendance tests), reimbursements, server actions re-checking roles.
- `npm run lint`, `npm run typecheck`: clean at the M6 commit. `npm audit`: 0 vulnerabilities at
  install.

## Not done yet (gaps)

1. **E2E (Playwright)** – config and fixtures exist (`playwright.config.ts`,
   `tests/e2e/fixtures.ts`) but the specs are not written: full monthly cycle, dropout/replacement,
   Comms review, security (headers, job route 401, local login 404 in prod, IDOR on `[id]` routes,
   receipt file route), public form/kiosk, legal pages.
2. **Bundle scan** (`tests/bundle`, no service-role key/secrets in `.next/static`) – not written.
3. **`docker build`** not verified; the Dockerfile and compose file are untested.
4. **README** – only a short local-setup section (below in README.md); needs the full setup,
   deployment and testing guide.
5. Local Auth rate-limit change in `supabase/config.toml` needs a `supabase stop && start` before
   E2E.

## Known limitations

- Real Google Chat/Drive/Directory calls cannot run locally; the DB-backed fakes stand in.
- The legal texts were copied from MESAttendance and do not yet cover the new processing
  (receipts, IBAN/PayPal, volunteer data) – the board must review them.
- Description presence/realtime only checked manually in the browser.
