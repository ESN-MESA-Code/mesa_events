-- ============================================================
-- Local development and tests only.
-- `supabase start` / `supabase db reset` load this file; a production
-- deployment never does (see README, "Deploying").
-- ============================================================

-- One member per role, signing in with a password because Google sign-in
-- is not available locally. The metadata matches what Google sign-in
-- stores, so the signup trigger and is_workspace_member() accept them.
-- Used by lib/localLogin.ts (local test sign-in) and tests/helpers/local.ts.
-- Per-event roles (OC, helper) come from assignments: oc@ and helper@ are
-- made OC / helper of events by the tests and the demo seed.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('local-test-password', extensions.gen_salt('bf')), now(),
  '{"provider": "google", "providers": ["google"]}',
  jsonb_build_object('full_name', full_name, 'custom_claims', jsonb_build_object('hd', 'esnmesa.org')),
  now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'member@esnmesa.org', 'Mia Member'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'oc@esnmesa.org', 'Olga Organiser'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'helper@esnmesa.org', 'Hugo Helper'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'events@esnmesa.org', 'Eva Events'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'comms@esnmesa.org', 'Cora Comms'),
  ('a0000000-0000-4000-8000-000000000006'::uuid, 'finance@esnmesa.org', 'Finn Finance'),
  ('a0000000-0000-4000-8000-000000000007'::uuid, 'treasurer@esnmesa.org', 'Theo Treasurer'),
  ('a0000000-0000-4000-8000-000000000008'::uuid, 'executive@esnmesa.org', 'Ezra Executive'),
  ('a0000000-0000-4000-8000-000000000009'::uuid, 'admin@esnmesa.org', 'Ada Admin'),
  ('a0000000-0000-4000-8000-00000000000a'::uuid, 'volunteer1@esnmesa.org', 'Vera Volunteer'),
  ('a0000000-0000-4000-8000-00000000000b'::uuid, 'volunteer2@esnmesa.org', 'Victor Volunteer'),
  ('a0000000-0000-4000-8000-00000000000c'::uuid, 'newcomer@esnmesa.org', 'Nora Newcomer'),
  ('a0000000-0000-4000-8000-00000000000d'::uuid, 'signout@esnmesa.org', 'Sam Signout')
) as seeded (id, email, full_name);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id, 'email', email), 'email', now(), now(), now()
from auth.users
where email like '%@esnmesa.org';

-- All but the newcomer accepted the current confidentiality rules.
insert into public.organiser_acknowledgements (email, version)
select email, public.confidentiality_version()
from auth.users
where email like '%@esnmesa.org' and email <> 'newcomer@esnmesa.org';

-- As if the group sync had found them in the role groups.
insert into public.role_members (email, role, source) values
  ('events@esnmesa.org', 'events', 'group'),
  ('comms@esnmesa.org', 'comms', 'group'),
  ('finance@esnmesa.org', 'finance', 'group'),
  ('treasurer@esnmesa.org', 'treasurer', 'group'),
  ('executive@esnmesa.org', 'executive', 'group'),
  ('admin@esnmesa.org', 'admin', 'group');

-- The local job runner: pg_cron calls `npm run dev:local` on the host.
insert into private.config (key, value) values
  ('job_runner_url', 'http://host.docker.internal:3000/api/jobs/run'),
  ('job_runner_secret', 'local-jobs-secret-not-for-production')
on conflict (key) do update set value = excluded.value;

-- Test-only views of what the database schedules and sends (service role,
-- local stack only – never in a migration).
create or replace function public.test_cron_jobs()
returns table (jobname text, schedule text, command text)
language sql
security definer
set search_path = ''
as $$
  select jobname::text, schedule::text, command::text from cron.job order by jobname;
$$;

create or replace function public.test_invoke_job_runner()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'url', r ->> 'url',
    'authorization', r -> 'headers' ->> 'Authorization',
    'request_id', private.invoke_job_runner()
  )
  from (select private.job_runner_request() as r) x;
$$;

create or replace function public.test_close_due_forms()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.close_due_forms();
$$;
revoke all on function public.test_close_due_forms() from public, anon, authenticated;
grant execute on function public.test_close_due_forms() to service_role;

revoke all on function public.test_cron_jobs() from public, anon, authenticated;
revoke all on function public.test_invoke_job_runner() from public, anon, authenticated;
grant execute on function public.test_cron_jobs() to service_role;
grant execute on function public.test_invoke_job_runner() to service_role;

-- Hosted projects have the GraphQL API enabled; mirror that so the tests
-- check it does not expose more than the REST API.
create extension if not exists pg_graphql;
