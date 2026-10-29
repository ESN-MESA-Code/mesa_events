-- Staging demo data (docs/STAGING.md): the demo members and the "Reset demo
-- data" wipe. Both are service-role only and refuse to run unless the
-- database itself is marked as a demo database – set by hand on the staging
-- project, and by supabase/seed.sql on the local stack, never by a
-- migration:
--   insert into private.config (key, value) values ('environment', 'staging')
--   on conflict (key) do update set value = excluded.value;
-- So even a staging app pointed at the production database by mistake
-- cannot wipe it (the app checks its own gates first, lib/staging.ts).

create or replace function private.is_demo_database()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from private.config where key = 'environment'), '') in ('staging', 'development');
$$;
revoke all on function private.is_demo_database() from public, anon, authenticated;

create or replace function private.require_demo_database()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_demo_database() then
    raise exception 'Not a demo database: private.config ''environment'' must be ''staging'' (or ''development'' locally)'
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_demo_database() from public, anon, authenticated;

-- A demo member as Google sign-in would create them (the signup trigger only
-- admits Google Workspace accounts, so Auth's admin API cannot create them),
-- with a password the staging sign-in derives on the server
-- (lib/staging/password.ts). Only addresses whose local part ends in ".demo"
-- – never a real member's account.
create or replace function public.staging_upsert_demo_user(user_id uuid, user_email text, user_name text, user_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_domain text := public.workspace_domain();
  demo_email text := lower(user_email);
begin
  perform private.require_demo_database();
  if demo_email !~ ('^[a-z0-9-]+(\.[a-z0-9-]+)*\.demo@' || replace(ws_domain, '.', '\.') || '$') then
    raise exception 'Only demo addresses (…demo@%) can be demo members', ws_domain using errcode = '22023';
  end if;
  if length(coalesce(user_password, '')) < 32 then
    raise exception 'The demo password is derived on the server and has at least 32 characters' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where u.email = demo_email and u.id <> user_id) then
    raise exception 'Another account already uses %', demo_email using errcode = '23505';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', user_id, 'authenticated', 'authenticated', demo_email,
    extensions.crypt(user_password, extensions.gen_salt('bf')), now(),
    '{"provider": "google", "providers": ["google"]}',
    jsonb_build_object('full_name', user_name, 'custom_claims', jsonb_build_object('hd', ws_domain)),
    now(), now(), '', '', '', ''
  )
  on conflict (id) do update set
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), user_id, user_id::text, jsonb_build_object('sub', user_id, 'email', demo_email), 'email', now(), now(), now()
  where not exists (select 1 from auth.identities i where i.user_id = staging_upsert_demo_user.user_id and i.provider = 'email');
end;
$$;
revoke all on function public.staging_upsert_demo_user(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.staging_upsert_demo_user(uuid, text, text, text) to service_role;

-- What "Reset demo data" does with each table: everything the workflow
-- creates goes; members, their accepted rules, team roles of real accounts,
-- settings and the first rules version (from the migrations) stay. A table
-- in neither list makes the wipe refuse (tests/db/staging.test.ts too), so a
-- new table needs a decision here.
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'description_versions',
    'descriptions', 'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_ideas',
    'event_photo_folders', 'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members',
    'fake_chat_messages', 'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files',
    'fake_drive_folders', 'fake_telegram_messages', 'jobs', 'participants', 'payout_batches',
    'payout_details', 'planning_cycles', 'preapprovals', 'publication_post_events', 'publication_posts',
    'receipts', 'reimbursements', 'reviews', 'trip_budgets', 'volunteer_choices', 'volunteer_responses'
  ]) as t
  union all
  -- reimbursement_policies/rules: versions after the first are removed;
  -- role_members: demo members' rows are removed.
  select t, 'keep' from unnest(array[
    'app_settings', 'organiser_acknowledgements', 'profiles', 'publication_channels',
    'reimbursement_policies', 'reimbursement_rules', 'role_members'
  ]) as t;
$$;
revoke all on function private.staging_wipe_lists() from public, anon, authenticated;

create or replace function public.staging_wipe_plan()
returns table (table_name text, action text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.tablename::text, coalesce(l.action, 'unlisted')
  from pg_catalog.pg_tables t
  left join private.staging_wipe_lists() l on l.table_name = t.tablename
  where t.schemaname = 'public'
  order by 1;
$$;
revoke all on function public.staging_wipe_plan() from public, anon, authenticated;
grant execute on function public.staging_wipe_plan() to service_role;

create or replace function public.staging_wipe()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  unlisted text;
  tables text;
  demo_pattern text := '\.demo@' || replace(public.workspace_domain(), '.', '\.') || '$';
begin
  perform private.require_demo_database();
  select string_agg(table_name, ', ') into unlisted from public.staging_wipe_plan() where action = 'unlisted';
  if unlisted is not null then
    raise exception 'Reset refused: no decision for table(s) %', unlisted using errcode = '55000';
  end if;
  select string_agg(format('public.%I', p.table_name), ', ') into tables
  from public.staging_wipe_plan() p where p.action = 'wipe';
  -- No CASCADE: a kept table that references a wiped one makes this fail
  -- instead of losing it silently.
  execute 'truncate table ' || tables || ' restart identity';
  delete from public.reimbursement_policies where version > 1;
  delete from public.role_members where email ~ demo_pattern;
  delete from public.organiser_acknowledgements where email ~ demo_pattern;
  return jsonb_build_object('wiped', (select count(*) from public.staging_wipe_plan() where action = 'wipe'));
end;
$$;
revoke all on function public.staging_wipe() from public, anon, authenticated;
grant execute on function public.staging_wipe() to service_role;
