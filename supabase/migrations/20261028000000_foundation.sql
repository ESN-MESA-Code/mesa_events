-- ============================================================
-- MESA Events Platform – foundation
--
-- * Workspace-only sign-in (as MESAttendance) and the confidentiality
--   rules every member accepts before seeing anything.
-- * profiles (one per auth user) and role_members: team roles synced from
--   Google Workspace groups (addresses are env configuration, see
--   lib/roles.ts) or added by hand by an admin.
-- * planning_cycles (one per month), event_series, events, assignments
--   (OC / helper per event).
-- * activity_log, written by triggers only.
-- * jobs: outgoing work (Google Chat, Drive, Directory) with retries and
--   idempotency keys; pg_cron + pg_net call the app's secret-protected
--   runner route (/api/jobs/run).
--
-- Everything here runs on self-hosted Supabase too (no Edge Functions).
-- ============================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Settings the API must never see (job runner URL and secret, domain).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.config (
  key   text primary key,
  value text not null
);

-- ── Generic helpers ─────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.workspace_domain()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from private.config where key = 'workspace_domain'), 'esnmesa.org');
$$;

create or replace function public.auth_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- ── Sign-up: Workspace Google accounts only ─────────────────────────────────
create or replace function public.enforce_workspace_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain text := public.workspace_domain();
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google'
     or lower(coalesce(new.email, '')) not like '%@' || domain
     or lower(coalesce(new.raw_user_meta_data -> 'custom_claims' ->> 'hd', '')) <> domain
  then
    raise exception 'Only % Google Workspace accounts may sign in', domain;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_workspace_signup() from public, anon, authenticated;

drop trigger if exists enforce_workspace_signup on auth.users;
create trigger enforce_workspace_signup
  before insert on auth.users
  for each row execute function public.enforce_workspace_signup();

-- ── Profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique constraint profiles_email_check check (email = lower(email)),
  full_name  text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return new;
end;
$$;

revoke all on function public.sync_profile() from public, anon, authenticated;

create trigger sync_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_profile();

-- ── Confidentiality rules (MESAttendance) ───────────────────────────────────
create table public.organiser_acknowledgements (
  email       text not null,
  version     text not null
    constraint organiser_acknowledgements_version_check check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now(),
  primary key (email, version)
);

alter table public.organiser_acknowledgements enable row level security;

create policy "Members read their own acknowledgements"
  on public.organiser_acknowledgements for select
  to authenticated
  using (email = public.auth_email());

revoke insert, update, delete, truncate on public.organiser_acknowledgements from anon, authenticated;

-- Keep in step with confidentiality_version in legal/details.json (a test checks this).
create or replace function public.confidentiality_version()
returns text
language sql
immutable
as $$
  select '2026-10-23'::text;
$$;

create or replace function public.is_workspace_account()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.auth_email() like '%@' || public.workspace_domain()
     and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
     and coalesce(auth.jwt() ->> 'role', '') = 'authenticated';
$$;

-- Every member policy uses this: a Workspace account that accepted the
-- current confidentiality rules.
create or replace function public.is_workspace_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_account()
     and exists (
       select 1 from public.organiser_acknowledgements a
       where a.email = public.auth_email() and a.version = public.confidentiality_version()
     );
$$;

create or replace function public.acknowledge_confidentiality(accepted_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_account() then
    raise exception 'Only Workspace members accept the confidentiality rules' using errcode = '42501';
  end if;
  if accepted_version is distinct from public.confidentiality_version() then
    raise exception 'The confidentiality rules have changed – please reload the page' using errcode = '22023';
  end if;
  insert into public.organiser_acknowledgements (email, version)
  values (public.auth_email(), accepted_version)
  on conflict do nothing;
end;
$$;

revoke all on function public.acknowledge_confidentiality(text) from public, anon;
grant execute on function public.acknowledge_confidentiality(text) to authenticated;

-- ── Team roles ──────────────────────────────────────────────────────────────
create type public.app_role as enum ('events', 'comms', 'finance', 'treasurer', 'executive', 'admin');

-- 'group' rows mirror the Google groups (replaced by each sync); 'manual'
-- rows are added by an admin and survive syncs.
create table public.role_members (
  email     text not null constraint role_members_email_check check (email = lower(email)),
  role      public.app_role not null,
  source    text not null default 'manual' constraint role_members_source_check check (source in ('group', 'manual')),
  synced_at timestamptz not null default now(),
  primary key (email, role, source)
);

alter table public.role_members enable row level security;

-- Whether the signed-in member has `wanted`. The Treasurer is part of Finance.
create or replace function public.has_role(wanted public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member()
     and exists (
       select 1 from public.role_members r
       where r.email = public.auth_email()
         and (r.role = wanted or (wanted = 'finance' and r.role = 'treasurer'))
     );
$$;

-- Teams that see every event: Events, Comms, Finance and the executives.
create or replace function public.is_team()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member()
     and exists (
       select 1 from public.role_members r
       where r.email = public.auth_email()
         and r.role in ('events', 'comms', 'finance', 'treasurer', 'executive')
     );
$$;

create or replace function public.is_executive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('executive');
$$;

create or replace function public.my_roles()
returns public.app_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct r.role order by r.role), '{}')
  from public.role_members r
  where public.is_workspace_member() and r.email = public.auth_email();
$$;

revoke all on function public.has_role(public.app_role) from public;
revoke all on function public.is_team() from public;
revoke all on function public.is_executive() from public;
revoke all on function public.my_roles() from public;
grant execute on function public.has_role(public.app_role) to anon, authenticated;
grant execute on function public.is_team() to anon, authenticated;
grant execute on function public.is_executive() to anon, authenticated;
grant execute on function public.my_roles() to authenticated;

create policy "Members read their own roles, admins all"
  on public.role_members for select
  to authenticated
  using (email = public.auth_email() and public.is_workspace_member() or public.has_role('admin'));

create policy "Admins add manual roles"
  on public.role_members for insert
  to authenticated
  with check (public.has_role('admin') and source = 'manual');

create policy "Admins remove manual roles"
  on public.role_members for delete
  to authenticated
  using (public.has_role('admin') and source = 'manual');

revoke update on public.role_members from anon, authenticated;
revoke all on public.role_members from anon;

-- The group sync (server, service role): one role's group members replace
-- that role's 'group' rows. Refuses an empty list (misconfiguration).
create or replace function public.replace_group_role(member_role public.app_role, emails text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain text := public.workspace_domain();
  wanted text[] := array(
    select distinct lower(trim(e)) from unnest(emails) e where lower(trim(e)) like '%@' || domain
  );
begin
  if cardinality(wanted) = 0 then
    raise exception 'The group for % has no members – roles left unchanged', member_role;
  end if;
  delete from public.role_members
  where role = member_role and source = 'group' and email <> all(wanted);
  insert into public.role_members (email, role, source)
  select unnest(wanted), member_role, 'group'
  on conflict (email, role, source) do update set synced_at = now();
  return cardinality(wanted);
end;
$$;

-- At login: one person's membership of one role's group.
create or replace function public.set_group_role(member_email text, member_role public.app_role, member boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if member then
    insert into public.role_members (email, role, source) values (lower(member_email), member_role, 'group')
    on conflict (email, role, source) do update set synced_at = now();
  else
    delete from public.role_members where email = lower(member_email) and role = member_role and source = 'group';
  end if;
end;
$$;

revoke all on function public.replace_group_role(public.app_role, text[]) from public, anon, authenticated;
revoke all on function public.set_group_role(text, public.app_role, boolean) from public, anon, authenticated;

-- Profiles: every member sees names (rosters, Chat mentions); nobody writes
-- them through the API (they follow the Google account).
alter table public.profiles enable row level security;
create policy "Members read profiles"
  on public.profiles for select
  to authenticated
  using (public.is_workspace_member());
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;

-- ── App settings (admin) ────────────────────────────────────────────────────
create table public.app_settings (
  key        text primary key constraint app_settings_key_check check (key ~ '^[a-z_]{1,60}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text default public.auth_email()
);

alter table public.app_settings enable row level security;
create policy "Members read settings" on public.app_settings for select to authenticated using (public.is_workspace_member());
create policy "Admins add settings" on public.app_settings for insert to authenticated with check (public.has_role('admin'));
create policy "Admins change settings" on public.app_settings for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
revoke delete on public.app_settings from anon, authenticated;
create trigger app_settings_updated_at before update on public.app_settings for each row execute function public.set_updated_at();

insert into public.app_settings (key, value) values
  ('default_helpers_needed', '2'),
  ('chat_notifications', 'true'),
  ('early_payout_threshold_cents', '10000');

-- ── Planning cycles ─────────────────────────────────────────────────────────
create type public.cycle_status as enum ('planning', 'form_open', 'form_closed', 'allocated', 'confirmed');

create table public.planning_cycles (
  id                   uuid primary key default gen_random_uuid(),
  -- First day of the month the cycle plans.
  month                date not null unique constraint planning_cycles_month_check check (extract(day from month) = 1),
  status               public.cycle_status not null default 'planning',
  form_closes_at       timestamptz,
  description_deadline timestamptz,
  allocated_at         timestamptz,
  confirmed_at         timestamptz,
  confirmed_by         text,
  created_by           text default public.auth_email(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger planning_cycles_updated_at before update on public.planning_cycles for each row execute function public.set_updated_at();

-- ── Event series and events ─────────────────────────────────────────────────
create table public.event_series (
  id         uuid primary key default gen_random_uuid(),
  title      text not null constraint event_series_title_check check (length(title) between 1 and 200),
  created_at timestamptz not null default now()
);

create type public.event_type as enum ('standard', 'special', 'day_trip', 'weekend_trip');
create type public.event_status as enum ('draft', 'scheduled', 'understaffed', 'confirmed', 'cancelled', 'dropped', 'completed');

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  cycle_id         uuid references public.planning_cycles(id) on delete restrict,
  series_id        uuid references public.event_series(id) on delete set null,
  title            text not null constraint events_title_check check (length(title) between 1 and 200),
  type             public.event_type not null default 'standard',
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  location         text constraint events_location_check check (length(location) <= 300),
  -- Money in integer cents; null with price_tba while the price is not fixed.
  price_cents      integer constraint events_price_check check (price_cents >= 0),
  capacity         integer constraint events_capacity_check check (capacity > 0),
  helpers_needed   smallint not null default 2 constraint events_helpers_check check (helpers_needed between 0 and 50),
  status           public.event_status not null default 'draft',
  -- 'public' is for the public calendar (P3); P1 events are internal.
  visibility       text not null default 'internal' constraint events_visibility_check check (visibility in ('internal', 'public')),
  -- Google Chat space (spaces/AAAA…), set by the jobs runner.
  chat_space_name  text,
  chat_space_url   text,
  -- Who proposed it (their idea); becomes OC by default.
  proposed_by      uuid references public.profiles(id) on delete set null,
  created_by       text default public.auth_email(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create index events_cycle_idx on public.events(cycle_id);
create index events_starts_at_idx on public.events(starts_at);
create trigger events_updated_at before update on public.events for each row execute function public.set_updated_at();

-- ── Assignments (OC / helper) ───────────────────────────────────────────────
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null constraint assignments_role_check check (role in ('oc', 'helper')),
  source      text not null default 'manual' constraint assignments_source_check check (source in ('auto', 'manual', 'replacement', 'proposer')),
  status      text not null default 'active' constraint assignments_status_check check (status in ('active', 'dropped_out')),
  created_at  timestamptz not null default now(),
  created_by  text default public.auth_email(),
  dropped_at  timestamptz,
  drop_reason text constraint assignments_drop_reason_check check (length(drop_reason) <= 500),
  constraint assignments_dropped_check check ((status = 'dropped_out') = (dropped_at is not null))
);

create unique index assignments_one_active_per_person on public.assignments(event_id, profile_id) where status = 'active';
create unique index assignments_one_active_oc on public.assignments(event_id) where status = 'active' and role = 'oc';
create index assignments_profile_idx on public.assignments(profile_id);

-- Per-event roles of the signed-in member.
create or replace function public.is_event_oc(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member() and exists (
    select 1 from public.assignments a
    where a.event_id = event and a.profile_id = auth.uid() and a.role = 'oc' and a.status = 'active'
  );
$$;

create or replace function public.is_event_staff(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member() and exists (
    select 1 from public.assignments a
    where a.event_id = event and a.profile_id = auth.uid() and a.status = 'active'
  );
$$;

-- Members see events on the internal calendar once they are scheduled
-- (not drafts of the month plan, not dropped ones).
create or replace function public.event_on_calendar(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = event and e.status in ('scheduled', 'understaffed', 'confirmed', 'cancelled', 'completed')
  );
$$;

create or replace function public.can_read_event(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_team()
      or public.is_event_staff(event)
      or (public.is_workspace_member() and public.event_on_calendar(event));
$$;

-- Rosters are public to members once the month's allocation is confirmed
-- (or for events outside a cycle); until then only teams and the person.
create or replace function public.roster_published(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    left join public.planning_cycles c on c.id = e.cycle_id
    where e.id = event and (e.cycle_id is null or c.status = 'confirmed')
  );
$$;

revoke all on function public.is_event_oc(uuid) from public;
revoke all on function public.is_event_staff(uuid) from public;
revoke all on function public.event_on_calendar(uuid) from public;
revoke all on function public.can_read_event(uuid) from public;
revoke all on function public.roster_published(uuid) from public;
grant execute on function public.is_event_oc(uuid) to authenticated;
grant execute on function public.is_event_staff(uuid) to authenticated;
grant execute on function public.event_on_calendar(uuid) to authenticated;
grant execute on function public.can_read_event(uuid) to authenticated;
grant execute on function public.roster_published(uuid) to authenticated;

-- ── RLS: cycles, series, events, assignments ────────────────────────────────
alter table public.planning_cycles enable row level security;
alter table public.event_series enable row level security;
alter table public.events enable row level security;
alter table public.assignments enable row level security;

create policy "Members read cycles past planning, teams all"
  on public.planning_cycles for select to authenticated
  using (public.is_team() or (public.is_workspace_member() and status <> 'planning'));
create policy "Events team creates cycles"
  on public.planning_cycles for insert to authenticated
  with check (public.has_role('events'));
create policy "Events team changes cycles"
  on public.planning_cycles for update to authenticated
  using (public.has_role('events')) with check (public.has_role('events'));
revoke delete on public.planning_cycles from anon, authenticated;

create policy "Members read series" on public.event_series for select to authenticated using (public.is_workspace_member());
create policy "Events team creates series" on public.event_series for insert to authenticated with check (public.has_role('events'));
create policy "Events team changes series" on public.event_series for update to authenticated using (public.has_role('events')) with check (public.has_role('events'));
revoke delete on public.event_series from anon, authenticated;

create policy "Members read calendar events, teams and staff all"
  on public.events for select to authenticated
  using (public.can_read_event(id));
create policy "Events team creates events"
  on public.events for insert to authenticated
  with check (public.has_role('events'));
-- The OC may change their event's details too; guard_event_update() limits
-- which columns.
create policy "Events team and the OC change events"
  on public.events for update to authenticated
  using (public.has_role('events') or public.is_event_oc(id))
  with check (public.has_role('events') or public.is_event_oc(id));
revoke delete on public.events from anon, authenticated;

create policy "Members read published rosters, teams all, everyone their own"
  on public.assignments for select to authenticated
  using (
    public.is_team()
    or (public.is_workspace_member() and profile_id = auth.uid())
    or (public.can_read_event(event_id) and public.roster_published(event_id))
  );
create policy "Events team assigns"
  on public.assignments for insert to authenticated
  with check (public.has_role('events'));
create policy "Events team changes assignments"
  on public.assignments for update to authenticated
  using (public.has_role('events')) with check (public.has_role('events'));
create policy "Events team removes assignments"
  on public.assignments for delete to authenticated
  using (public.has_role('events'));

revoke all on public.planning_cycles, public.event_series, public.events, public.assignments from anon;

-- What an OC may change on their own event (Events changes everything).
create or replace function public.guard_event_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.has_role('events') then
    return new;
  end if;
  -- An OC: details, and run / cancel an under-staffed event.
  if (new.cycle_id, new.series_id, new.title, new.type, new.helpers_needed, new.visibility,
      new.chat_space_name, new.chat_space_url, new.proposed_by, new.created_by)
     is distinct from
     (old.cycle_id, old.series_id, old.title, old.type, old.helpers_needed, old.visibility,
      old.chat_space_name, old.chat_space_url, old.proposed_by, old.created_by) then
    raise exception 'Only the Events team can change this' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'understaffed' and new.status in ('confirmed', 'cancelled')) then
    raise exception 'The OC can only decide whether an under-staffed event runs' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_event_update() from public, anon, authenticated;
create trigger guard_event_update before update on public.events for each row execute function public.guard_event_update();

-- Open slots of upcoming events with a published roster: no OC, or fewer
-- helpers than needed (after dropouts). Any member may claim them.
create or replace function public.open_slots()
returns table (event_id uuid, open_oc boolean, open_helpers integer)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select e.id,
           not exists (select 1 from public.assignments a where a.event_id = e.id and a.role = 'oc' and a.status = 'active'),
           greatest(0, e.helpers_needed - (
             select count(*) from public.assignments a where a.event_id = e.id and a.role = 'helper' and a.status = 'active'
           ))::integer
    from public.events e
    where public.is_workspace_member()
      and e.status in ('confirmed', 'understaffed')
      and e.starts_at > now()
      and public.roster_published(e.id)
  ) s (event_id, open_oc, open_helpers)
  where s.open_oc or s.open_helpers > 0;
$$;

revoke all on function public.open_slots() from public, anon;
grant execute on function public.open_slots() to authenticated;

-- ── Activity log (written by triggers and definer functions only) ───────────
create table public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_email text,
  event_id    uuid references public.events(id) on delete set null,
  cycle_id    uuid references public.planning_cycles(id) on delete set null,
  entity      text not null,
  entity_id   text,
  action      text not null,
  details     jsonb not null default '{}'
);

create index activity_log_event_idx on public.activity_log(event_id, at desc);

alter table public.activity_log enable row level security;
create policy "Events, executives and admins read the log; staff their event's"
  on public.activity_log for select to authenticated
  using (
    public.has_role('events') or public.has_role('executive') or public.has_role('admin')
    or (event_id is not null and public.is_event_staff(event_id))
  );
revoke insert, update, delete, truncate on public.activity_log from anon, authenticated;

create or replace function private.log(
  entity text, entity_id text, action text,
  event_id uuid default null, cycle_id uuid default null, details jsonb default '{}'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log (actor_email, event_id, cycle_id, entity, entity_id, action, details)
  values (nullif(public.auth_email(), ''), event_id, cycle_id, entity, entity_id, action, coalesce(details, '{}'));
$$;

create or replace function private.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  ev uuid;
  cy uuid;
  changed jsonb := '{}';
begin
  if tg_table_name = 'events' then
    ev := (r ->> 'id')::uuid;
    cy := (r ->> 'cycle_id')::uuid;
  elsif tg_table_name = 'planning_cycles' then
    cy := (r ->> 'id')::uuid;
  elsif r ? 'event_id' then
    ev := (r ->> 'event_id')::uuid;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}') into changed
    from jsonb_each(to_jsonb(new)) n
    where n.key not in ('updated_at') and n.value is distinct from (to_jsonb(old) -> n.key);
    if changed = '{}' then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    changed := r;
  end if;
  -- Never copy bank details into the log.
  changed := changed - 'iban' - 'paypal_email';
  perform private.log(tg_table_name, r ->> 'id', lower(tg_op), ev, cy, changed);
  return null;
end;
$$;

create trigger log_planning_cycles after insert or update on public.planning_cycles for each row execute function private.log_row_change();
create trigger log_events after insert or update on public.events for each row execute function private.log_row_change();
create trigger log_assignments after insert or update or delete on public.assignments for each row execute function private.log_row_change();

-- ── Jobs (outgoing work) ────────────────────────────────────────────────────
create table public.jobs (
  id              bigint generated always as identity primary key,
  kind            text not null constraint jobs_kind_check check (kind ~ '^[a-z]+\.[a-z_]+$'),
  payload         jsonb not null default '{}',
  -- At most one job per key: re-enqueuing a pending job does nothing, a
  -- finished "coalescing" job (e.g. membership sync) is run again.
  idempotency_key text not null unique,
  status          text not null default 'pending'
    constraint jobs_status_check check (status in ('pending', 'running', 'done', 'failed', 'dead')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 6,
  run_after       timestamptz not null default now(),
  -- Enqueued again while running: run once more afterwards.
  rerun           boolean not null default false,
  locked_at       timestamptz,
  locked_by       text,
  last_error      text,
  result          jsonb,
  event_id        uuid references public.events(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index jobs_due_idx on public.jobs(run_after) where status in ('pending', 'failed');
create trigger jobs_updated_at before update on public.jobs for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;
create policy "Admins read jobs" on public.jobs for select to authenticated using (public.has_role('admin'));
revoke insert, update, delete, truncate on public.jobs from anon, authenticated;
revoke all on public.jobs from anon;

create or replace function private.enqueue_job(
  job_kind text, job_payload jsonb, key text,
  job_event uuid default null, coalescing boolean default false, delay interval default '0'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id bigint;
begin
  insert into public.jobs (kind, payload, idempotency_key, event_id, run_after)
  values (job_kind, coalesce(job_payload, '{}'), key, job_event, now() + delay)
  on conflict (idempotency_key) do update set
    payload = case when coalescing then excluded.payload else public.jobs.payload end,
    -- A coalescing job that already ran (or gave up) runs again.
    status = case when coalescing and public.jobs.status in ('done', 'dead') then 'pending' else public.jobs.status end,
    attempts = case when coalescing and public.jobs.status in ('done', 'dead') then 0 else public.jobs.attempts end,
    run_after = case when coalescing and public.jobs.status in ('done', 'dead') then excluded.run_after else public.jobs.run_after end,
    rerun = public.jobs.rerun or (coalescing and public.jobs.status = 'running')
  returning id into job_id;
  return job_id;
end;
$$;

-- The runner (service role): claims due jobs, including ones whose worker
-- died (locked for more than 10 minutes).
create or replace function public.claim_jobs(worker text, max_jobs integer default 10)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
  set status = 'running', locked_at = now(), locked_by = worker, attempts = j.attempts + 1, rerun = false
  where j.id in (
    select id from public.jobs
    where (status in ('pending', 'failed') and run_after <= now())
       or (status = 'running' and locked_at < now() - interval '10 minutes')
    order by run_after, id
    for update skip locked
    limit greatest(1, least(max_jobs, 100))
  )
  returning j.*;
$$;

create or replace function public.complete_job(job_id bigint, job_result jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs
  set status = case when rerun then 'pending' else 'done' end,
      attempts = case when rerun then 0 else attempts end,
      rerun = false, result = job_result, last_error = null, locked_at = null, locked_by = null
  where id = job_id;
$$;

-- Exponential backoff: 1, 2, 4 … minutes (at most an hour); dead after max_attempts.
create or replace function public.fail_job(job_id bigint, error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs
  set status = case when attempts >= max_attempts then 'dead' else 'failed' end,
      run_after = now() + least(interval '1 minute' * power(2, greatest(attempts - 1, 0)), interval '1 hour'),
      last_error = left(error, 2000), locked_at = null, locked_by = null
  where id = job_id;
$$;

-- An admin retries a job that gave up.
create or replace function public.retry_job(job_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only admins retry jobs' using errcode = '42501';
  end if;
  update public.jobs set status = 'pending', attempts = 0, run_after = now(), last_error = null
  where id = job_id and status in ('failed', 'dead');
end;
$$;

revoke all on function private.enqueue_job(text, jsonb, text, uuid, boolean, interval) from public, anon, authenticated;
revoke all on function public.claim_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.complete_job(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.fail_job(bigint, text) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer) to service_role;
grant execute on function public.complete_job(bigint, jsonb) to service_role;
grant execute on function public.fail_job(bigint, text) to service_role;
revoke all on function public.retry_job(bigint) from public, anon;
grant execute on function public.retry_job(bigint) to authenticated;

-- The service role (app server) enqueues too, e.g. "sync roles now".
create or replace function public.enqueue_job(job_kind text, job_payload jsonb, key text, job_event uuid default null, coalescing boolean default false)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.enqueue_job(job_kind, job_payload, key, job_event, coalescing);
$$;
revoke all on function public.enqueue_job(text, jsonb, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_job(text, jsonb, text, uuid, boolean) to service_role;

-- pg_cron wakes the runner (POST /api/jobs/run with the shared secret) when
-- jobs are due. URL and secret live in private.config:
--   insert into private.config values ('job_runner_url', 'https://events.esnmesa.org/api/jobs/run'),
--                                     ('job_runner_secret', '<JOBS_SECRET>');
-- Without them nothing is called.
-- The request to send, or null (not configured, or nothing due).
create or replace function private.job_runner_request()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  url text := (select value from private.config where key = 'job_runner_url');
  secret text := (select value from private.config where key = 'job_runner_secret');
begin
  if url is null or secret is null then
    return null;
  end if;
  if not exists (
    select 1 from public.jobs
    where (status in ('pending', 'failed') and run_after <= now())
       or (status = 'running' and locked_at < now() - interval '10 minutes')
  ) then
    return null;
  end if;
  return jsonb_build_object(
    'url', url,
    'headers', jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json')
  );
end;
$$;

create or replace function private.invoke_job_runner()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  req jsonb := private.job_runner_request();
begin
  if req is null then
    return null;
  end if;
  return net.http_post(
    url := req ->> 'url',
    body := '{}'::jsonb,
    headers := req -> 'headers',
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.job_runner_request() from public, anon, authenticated;
revoke all on function private.invoke_job_runner() from public, anon, authenticated;

select cron.schedule('run-jobs', '30 seconds', 'select private.invoke_job_runner()');

-- Daily role sync from the Google groups (the runner skips it while the
-- Directory API is not configured).
select cron.schedule(
  'sync-roles',
  '0 4 * * *',
  $$select private.enqueue_job('directory.sync_roles', '{}', 'directory.sync_roles', null, true)$$
);

-- ── Privacy jobs (from MESAttendance) ───────────────────────────────────────
create or replace function public.purge_auth_ip_addresses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.audit_log_entries where created_at < now() - interval '30 days';
  update auth.sessions set ip = null, user_agent = null
  where created_at < now() - interval '30 days' and (ip is not null or user_agent is not null);
end;
$$;
revoke all on function public.purge_auth_ip_addresses() from public, anon, authenticated;
select cron.schedule('purge-auth-ip-addresses', '45 3 * * *', 'select public.purge_auth_ip_addresses()');

create or replace function public.delete_expired_acknowledgements()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.organiser_acknowledgements
    where accepted_at < date_trunc('year', now()) - interval '5 years'
    returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke all on function public.delete_expired_acknowledgements() from public, anon, authenticated;
select cron.schedule('delete-expired-acknowledgements', '50 3 * * *', 'select public.delete_expired_acknowledgements()');

-- Everything the layout needs about the signed-in member, in one call.
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email', public.auth_email(),
    'accepted', public.is_workspace_member(),
    'roles', to_jsonb(public.my_roles())
  )
  where public.is_workspace_account();
$$;
revoke all on function public.my_context() from public, anon;
grant execute on function public.my_context() to authenticated;
