-- ============================================================
-- MESA Events Platform – Chat spaces and roster changes
--
-- * Confirming a month's roster requests a Google Chat space per event
--   (job chat.create_space): OC, helpers, Comms and Events are invited, the
--   space description names the date and the OC, a welcome message
--   @-mentions OC and helpers.
-- * Any roster change re-syncs the space's members (coalescing job
--   chat.sync_members). The platform only removes people it added itself
--   (event_chat_members).
-- * Helpers and OCs drop out from the event page (drop_out()); the slot is
--   open for every member (open_slots()) and anyone can claim it
--   (claim_slot()). The space and the OC are told (chat.roster_message).
-- ============================================================

alter table public.events add column chat_space_requested_at timestamptz;

-- Who the platform added to an event's space (service role only).
create table public.event_chat_members (
  event_id uuid not null references public.events(id) on delete cascade,
  email    text not null,
  added_at timestamptz not null default now(),
  primary key (event_id, email)
);
alter table public.event_chat_members enable row level security;
revoke all on public.event_chat_members from anon, authenticated;

-- ── Requesting spaces ───────────────────────────────────────────────────────
create or replace function private.request_chat_space(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('mesa.system_update', 'on', true);
  update public.events set chat_space_requested_at = coalesce(chat_space_requested_at, now()) where id = event;
  perform set_config('mesa.system_update', 'off', true);
  perform private.enqueue_job('chat.create_space', jsonb_build_object('event_id', event), 'chat.create_space:' || event, event);
end;
$$;

-- Events can create a space by hand (events outside a cycle, or a retry).
create or replace function public.request_chat_space(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team creates Chat spaces' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events where id = event and status not in ('draft', 'dropped')) then
    raise exception 'Not for planned or dropped events' using errcode = '22023';
  end if;
  perform private.request_chat_space(event);
end;
$$;
revoke all on function private.request_chat_space(uuid) from public, anon, authenticated;
revoke all on function public.request_chat_space(uuid) from public, anon;
grant execute on function public.request_chat_space(uuid) to authenticated;

-- Confirming the roster now also requests the spaces.
create or replace function public.confirm_allocation(cycle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  perform private.require_cycle(cycle, array['allocated']::public.cycle_status[]);
  update public.events ev set status = case
      when s.oc = 0 and s.helpers = 0 then 'dropped'
      when s.oc = 0 or s.helpers < ev.helpers_needed then 'understaffed'
      else 'confirmed'
    end::public.event_status
  from (
    select x.id,
      (select count(*) from public.assignments a where a.event_id = x.id and a.status = 'active' and a.role = 'oc') as oc,
      (select count(*) from public.assignments a where a.event_id = x.id and a.status = 'active' and a.role = 'helper') as helpers
    from public.events x where x.cycle_id = cycle and x.status = 'scheduled'
  ) s
  where ev.id = s.id;
  update public.planning_cycles set status = 'confirmed', confirmed_at = now(), confirmed_by = public.auth_email() where id = cycle;
  for e in select id from public.events where cycle_id = cycle and status in ('confirmed', 'understaffed') loop
    perform private.request_chat_space(e.id);
  end loop;
end;
$$;

-- ── Keeping members in sync ─────────────────────────────────────────────────
create or replace function private.sync_chat_after_roster_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev uuid := coalesce(new.event_id, old.event_id);
begin
  if exists (select 1 from public.events e where e.id = ev and e.chat_space_requested_at is not null) then
    perform private.enqueue_job('chat.sync_members', jsonb_build_object('event_id', ev), 'chat.sync_members:' || ev, ev, true);
  end if;
  return null;
end;
$$;
revoke all on function private.sync_chat_after_roster_change() from public, anon, authenticated;
create trigger sync_chat_after_roster_change
  after insert or update or delete on public.assignments
  for each row execute function private.sync_chat_after_roster_change();

-- Comms and Events are in every upcoming event's space.
create or replace function private.sync_chat_after_team_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev uuid;
begin
  if coalesce(new.role, old.role) not in ('events', 'comms') then
    return null;
  end if;
  for ev in select id from public.events where chat_space_requested_at is not null and starts_at > now() loop
    perform private.enqueue_job('chat.sync_members', jsonb_build_object('event_id', ev), 'chat.sync_members:' || ev, ev, true);
  end loop;
  return null;
end;
$$;
revoke all on function private.sync_chat_after_team_change() from public, anon, authenticated;
create trigger sync_chat_after_team_change
  after insert or delete on public.role_members
  for each row execute function private.sync_chat_after_team_change();

-- Who belongs in an event's space (the jobs runner asks, as service role).
create or replace function public.chat_space_roster(event uuid)
returns table (email text, full_name text, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.email, p.full_name, a.role
  from public.assignments a join public.profiles p on p.id = a.profile_id
  where a.event_id = event and a.status = 'active'
  union
  select distinct r.email, coalesce(p.full_name, r.email), 'team'
  from public.role_members r left join public.profiles p on p.email = r.email
  where r.role in ('events', 'comms')
    and not exists (
      select 1 from public.assignments a join public.profiles q on q.id = a.profile_id
      where a.event_id = event and a.status = 'active' and q.email = r.email
    );
$$;
revoke all on function public.chat_space_roster(uuid) from public, anon, authenticated;
grant execute on function public.chat_space_roster(uuid) to service_role;

-- ── Staffing after dropouts and claims ──────────────────────────────────────
-- Definer functions that change events on someone's behalf (the staffing
-- after a dropout) mark the update as theirs, so the OC column guard lets
-- it through.
create or replace function public.guard_event_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or coalesce(current_setting('mesa.system_update', true), '') = 'on'
     or public.has_role('events') then
    return new;
  end if;
  -- An OC: details, and run / cancel an under-staffed event.
  if (new.cycle_id, new.series_id, new.title, new.type, new.helpers_needed, new.visibility,
      new.chat_space_name, new.chat_space_url, new.chat_space_requested_at, new.proposed_by, new.created_by)
     is distinct from
     (old.cycle_id, old.series_id, old.title, old.type, old.helpers_needed, old.visibility,
      old.chat_space_name, old.chat_space_url, old.chat_space_requested_at, old.proposed_by, old.created_by) then
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

create or replace function private.refresh_staffing(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  oc integer;
  helpers integer;
begin
  select * into e from public.events where id = event;
  if e.status not in ('confirmed', 'understaffed') then
    return;
  end if;
  select count(*) filter (where role = 'oc'), count(*) filter (where role = 'helper') into oc, helpers
  from public.assignments where event_id = event and status = 'active';
  perform set_config('mesa.system_update', 'on', true);
  update public.events set status = case when oc = 0 or helpers < e.helpers_needed then 'understaffed' else 'confirmed' end::public.event_status
  where id = event;
  perform set_config('mesa.system_update', 'off', true);
end;
$$;
revoke all on function private.refresh_staffing(uuid) from public, anon, authenticated;

-- A helper or OC drops out (or Events takes them off); the slot opens.
create or replace function public.drop_out(assignment uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.assignments;
begin
  select * into a from public.assignments where id = assignment for update;
  if not found or a.status <> 'active' then
    raise exception 'No such assignment' using errcode = '22023';
  end if;
  if not (public.is_workspace_member() and (a.profile_id = auth.uid() or public.has_role('events'))) then
    raise exception 'You can only drop out yourself' using errcode = '42501';
  end if;
  if exists (select 1 from public.events e where e.id = a.event_id and e.starts_at <= now()) then
    raise exception 'The event has already started' using errcode = '22023';
  end if;
  update public.assignments set status = 'dropped_out', dropped_at = now(), drop_reason = left(nullif(trim(reason), ''), 500)
  where id = assignment;
  perform private.refresh_staffing(a.event_id);
  perform private.enqueue_job('chat.roster_message',
    jsonb_build_object('event_id', a.event_id, 'kind', 'dropout', 'profile_id', a.profile_id, 'role', a.role, 'assignment_id', a.id),
    'chat.roster_message:dropout:' || a.id, a.event_id);
end;
$$;
revoke all on function public.drop_out(uuid, text) from public, anon;
grant execute on function public.drop_out(uuid, text) to authenticated;

-- Any member takes an open slot (open_slots()).
create or replace function public.claim_slot(event uuid, slot_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  new_id uuid;
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  if slot_role not in ('oc', 'helper') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  perform 1 from public.events where id = event for update;
  select * into s from public.open_slots() o where o.event_id = event;
  if not found or (slot_role = 'oc' and not s.open_oc) or (slot_role = 'helper' and s.open_helpers = 0) then
    raise exception 'This slot is not open (any more)' using errcode = '22023';
  end if;
  if exists (select 1 from public.assignments a where a.event_id = event and a.profile_id = auth.uid() and a.status = 'active') then
    raise exception 'You are already on this event' using errcode = '22023';
  end if;
  insert into public.assignments (event_id, profile_id, role, source)
  values (event, auth.uid(), slot_role, 'replacement')
  returning id into new_id;
  perform private.refresh_staffing(event);
  perform private.enqueue_job('chat.roster_message',
    jsonb_build_object('event_id', event, 'kind', 'claim', 'profile_id', auth.uid(), 'role', slot_role, 'assignment_id', new_id),
    'chat.roster_message:claim:' || new_id, event);
  return new_id;
end;
$$;
revoke all on function public.claim_slot(uuid, text) from public, anon;
grant execute on function public.claim_slot(uuid, text) to authenticated;
