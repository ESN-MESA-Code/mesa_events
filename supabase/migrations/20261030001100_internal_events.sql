-- ============================================================
-- MESA Events Platform – internal events, meetings and office hours
-- (round 2026-10-30)
--
-- Not ESN activities: no volunteer form, description, Chat space,
-- attendance list or publishing. HR and the Vice President plan them
-- (public.is_internal_planner()), executives look.
--
-- * internal_kind_settings: per kind the default title, time, length,
--   helpers and the fixed text (office hours always have the same one).
-- * internal_events, one row per date, kind:
--     internal      – any member signs up (no formal description)
--     stammtisch    – regular, an OC and helpers
--     tuesday_talk  – meeting on selected Tuesdays, links its presentation
--     board_meeting – executive board, links its presentation; only
--                     executives (and the planners) see it
--     office_hour   – an OC and helpers, ESNcard sales and the cash box
--   Dates repeated together share a series_id.
-- * internal_event_people: OC / helper (planners assign) or attendee
--   (members sign themselves up to internal events).
-- ============================================================

-- ── Who plans and who sees board meetings ───────────────────────────────────
create or replace function public.is_internal_planner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('hr') or public.has_role('vice_president');
$$;

create or replace function public.sees_board_meetings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('executive') or public.is_internal_planner();
$$;

revoke all on function public.is_internal_planner() from public;
revoke all on function public.sees_board_meetings() from public;
grant execute on function public.is_internal_planner() to authenticated;
grant execute on function public.sees_board_meetings() to authenticated;

create type public.internal_kind as enum ('internal', 'stammtisch', 'tuesday_talk', 'board_meeting', 'office_hour');

-- ── Defaults per kind ───────────────────────────────────────────────────────
create table public.internal_kind_settings (
  kind            public.internal_kind primary key,
  default_title   text not null constraint internal_kind_settings_title_check check (length(trim(default_title)) between 1 and 200),
  default_start   time not null,
  default_minutes smallint not null constraint internal_kind_settings_minutes_check check (default_minutes between 15 and 1440),
  helpers_needed  smallint not null default 0 constraint internal_kind_settings_helpers_check check (helpers_needed between 0 and 20),
  -- The text every date of this kind shows (office hours: always the same).
  description     text not null default '' constraint internal_kind_settings_description_check check (length(description) <= 4000),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

insert into public.internal_kind_settings (kind, default_title, default_start, default_minutes, helpers_needed, description) values
  ('internal', 'Internal event', '19:00', 120, 0, ''),
  ('stammtisch', 'Stammtisch', '20:00', 180, 1, ''),
  ('tuesday_talk', 'Tuesday Talk', '19:00', 60, 0, ''),
  ('board_meeting', 'Executive board meeting', '18:30', 120, 0, ''),
  ('office_hour', 'Office hour', '14:00', 120, 1,
   'ESN MESA office hour: questions about ESN MESA, our events and Munich, and the ESNcard. '
   || 'Bring your student ID and a passport photo for a new ESNcard.');

alter table public.internal_kind_settings enable row level security;
create policy "Members read internal kind settings" on public.internal_kind_settings for select to authenticated using (public.is_workspace_member());
create policy "Planners change internal kind settings" on public.internal_kind_settings for update to authenticated
  using (public.is_internal_planner()) with check (public.is_internal_planner());
revoke insert, delete, truncate on public.internal_kind_settings from anon, authenticated;
revoke all on public.internal_kind_settings from anon;

create or replace function private.stamp_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := nullif(public.auth_email(), '');
  return new;
end;
$$;
create trigger internal_kind_settings_stamp before update on public.internal_kind_settings for each row execute function private.stamp_updated_by();

-- ── Internal events ─────────────────────────────────────────────────────────
create table public.internal_events (
  id               uuid primary key default gen_random_uuid(),
  kind             public.internal_kind not null,
  title            text not null constraint internal_events_title_check check (length(trim(title)) between 1 and 200),
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  location         text not null default '' constraint internal_events_location_check check (length(location) <= 300),
  -- A short note instead of a formal description.
  note             text not null default '' constraint internal_events_note_check check (length(note) <= 2000),
  -- Tuesday Talks and board meetings link their slides.
  presentation_url text constraint internal_events_presentation_check check (presentation_url ~ '^https://[^\s]{3,}$' and length(presentation_url) <= 1000),
  -- Sign-up limit of an internal event (null: no limit).
  capacity         integer constraint internal_events_capacity_check check (capacity between 1 and 10000),
  helpers_needed   smallint not null default 0 constraint internal_events_helpers_check check (helpers_needed between 0 and 20),
  status           text not null default 'scheduled' constraint internal_events_status_check check (status in ('scheduled', 'cancelled')),
  -- Dates created together by "Repeat".
  series_id        uuid,
  created_by       text default public.auth_email(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint internal_events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create index internal_events_starts_at_idx on public.internal_events(starts_at);
create index internal_events_series_idx on public.internal_events(series_id) where series_id is not null;
create trigger internal_events_updated_at before update on public.internal_events for each row execute function public.set_updated_at();

-- Whether the signed-in member sees an internal event (board meetings: executives and planners).
create or replace function public.can_read_internal_event(internal_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member() and exists (
    select 1 from public.internal_events e
    where e.id = internal_event and (e.kind <> 'board_meeting' or public.sees_board_meetings())
  );
$$;
revoke all on function public.can_read_internal_event(uuid) from public;
grant execute on function public.can_read_internal_event(uuid) to authenticated;

alter table public.internal_events enable row level security;
create policy "Members read internal events, board meetings the executive board"
  on public.internal_events for select to authenticated
  using (public.is_workspace_member() and (kind <> 'board_meeting' or public.sees_board_meetings()));
create policy "Planners create internal events" on public.internal_events for insert to authenticated with check (public.is_internal_planner());
create policy "Planners change internal events" on public.internal_events for update to authenticated
  using (public.is_internal_planner()) with check (public.is_internal_planner());
create policy "Planners remove internal events" on public.internal_events for delete to authenticated using (public.is_internal_planner());
revoke all on public.internal_events from anon;

-- ── People: OC / helper (planners) and attendees (members themselves) ───────
create table public.internal_event_people (
  id                uuid primary key default gen_random_uuid(),
  internal_event_id uuid not null references public.internal_events(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  role              text not null constraint internal_event_people_role_check check (role in ('oc', 'helper', 'attendee')),
  created_at        timestamptz not null default now(),
  created_by        text default public.auth_email(),
  constraint internal_event_people_once unique (internal_event_id, profile_id)
);
create unique index internal_event_people_one_oc on public.internal_event_people(internal_event_id) where role = 'oc';
create index internal_event_people_profile_idx on public.internal_event_people(profile_id);

-- Staffed kinds have an OC and helpers; members sign up to internal events.
create or replace function private.guard_internal_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.internal_kind;
begin
  select kind into k from public.internal_events where id = new.internal_event_id;
  if new.role in ('oc', 'helper') and k not in ('stammtisch', 'office_hour') then
    raise exception 'Only Stammtisch and office hours have an OC and helpers' using errcode = '22023';
  end if;
  if new.role = 'attendee' and k <> 'internal' then
    raise exception 'Members sign up to internal events only' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_internal_people() from public, anon, authenticated;
create trigger guard_internal_people before insert or update on public.internal_event_people for each row execute function private.guard_internal_people();

create or replace function public.is_internal_staff(internal_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member() and exists (
    select 1 from public.internal_event_people p
    where p.internal_event_id = internal_event and p.profile_id = auth.uid() and p.role in ('oc', 'helper')
  );
$$;

create or replace function public.is_internal_oc(internal_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member() and exists (
    select 1 from public.internal_event_people p
    where p.internal_event_id = internal_event and p.profile_id = auth.uid() and p.role = 'oc'
  );
$$;
revoke all on function public.is_internal_staff(uuid) from public;
revoke all on function public.is_internal_oc(uuid) from public;
grant execute on function public.is_internal_staff(uuid) to authenticated;
grant execute on function public.is_internal_oc(uuid) to authenticated;

alter table public.internal_event_people enable row level security;
create policy "Members read the people of internal events they see"
  on public.internal_event_people for select to authenticated
  using (public.can_read_internal_event(internal_event_id));
create policy "Planners assign people" on public.internal_event_people for insert to authenticated with check (public.is_internal_planner());
create policy "Planners change assignments" on public.internal_event_people for update to authenticated
  using (public.is_internal_planner()) with check (public.is_internal_planner());
create policy "Planners remove people" on public.internal_event_people for delete to authenticated using (public.is_internal_planner());
revoke all on public.internal_event_people from anon;

-- A member signs up to an upcoming internal event (within its capacity).
create or replace function public.sign_up_internal(internal_event uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.internal_events;
  taken integer;
  id uuid;
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  select * into e from public.internal_events where internal_events.id = internal_event for update;
  if e.id is null or not public.can_read_internal_event(e.id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if e.kind <> 'internal' then
    raise exception 'Members sign up to internal events only' using errcode = '22023';
  end if;
  if e.status <> 'scheduled' or e.starts_at <= now() then
    raise exception 'This event is not open for sign-ups' using errcode = '22023';
  end if;
  if exists (select 1 from public.internal_event_people p where p.internal_event_id = e.id and p.profile_id = auth.uid()) then
    raise exception 'You are already signed up' using errcode = '22023';
  end if;
  select count(*) into taken from public.internal_event_people p where p.internal_event_id = e.id and p.role = 'attendee';
  if e.capacity is not null and taken >= e.capacity then
    raise exception 'This event is full' using errcode = '22023';
  end if;
  insert into public.internal_event_people (internal_event_id, profile_id, role) values (e.id, auth.uid(), 'attendee')
  returning internal_event_people.id into id;
  return id;
end;
$$;

-- …and withdraws again before it starts.
create or replace function public.withdraw_internal(internal_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.internal_events e where e.id = internal_event and e.starts_at > now()) then
    raise exception 'The event has started – ask HR to take you off the list' using errcode = '22023';
  end if;
  delete from public.internal_event_people
  where internal_event_id = internal_event and profile_id = auth.uid() and role = 'attendee';
  if not found then
    raise exception 'You are not signed up' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.sign_up_internal(uuid) from public, anon;
revoke all on function public.withdraw_internal(uuid) from public, anon;
grant execute on function public.sign_up_internal(uuid) to authenticated;
grant execute on function public.withdraw_internal(uuid) to authenticated;

-- The kind stays (its people, cash box and visibility depend on it).
create or replace function private.guard_internal_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'The kind of an internal event cannot change – add a new one' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_internal_kind() from public, anon, authenticated;
create trigger guard_internal_kind before update on public.internal_events for each row execute function private.guard_internal_kind();
