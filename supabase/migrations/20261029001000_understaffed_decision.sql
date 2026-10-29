-- ============================================================
-- MESA Events Platform – "Run it anyway" sticks (review 2026-10-29, A1)
--
-- The OC's decision that an under-staffed event runs only flipped the
-- status to confirmed; the next roster change (refresh_staffing()) set it
-- back to under-staffed while helpers were still short, and the OC was
-- asked again. The decision is now stored on the event
-- (understaffed_decision = 'run', who and when), written only by
-- decide_understaffed(), and refresh_staffing() keeps the event confirmed
-- while it is set. It is cleared when the event loses its OC (the new OC
-- decides again).
--
-- Staffing is now refreshed by a trigger on every roster change (also the
-- Events team's edits on the roster board after confirmation, which did not
-- refresh it before).
-- ============================================================

alter table public.events
  add column understaffed_decision   text constraint events_understaffed_decision_check check (understaffed_decision in ('run')),
  add column understaffed_decided_by text,
  add column understaffed_decided_at timestamptz;

comment on column public.events.understaffed_decision is
  '''run'': the OC (or Events) decided the under-staffed event runs; kept until the event loses its OC.';

-- The decision columns are written only by the definer functions.
create or replace function public.guard_event_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or coalesce(current_setting('mesa.system_update', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if (new.understaffed_decision, new.understaffed_decided_by, new.understaffed_decided_at) is distinct from (null::text, null::text, null::timestamptz) then
      raise exception 'The decision is made on the event page' using errcode = '42501';
    end if;
  elsif (new.understaffed_decision, new.understaffed_decided_by, new.understaffed_decided_at)
        is distinct from (old.understaffed_decision, old.understaffed_decided_by, old.understaffed_decided_at) then
    raise exception 'The decision is made on the event page' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_decision() from public, anon, authenticated;
create trigger guard_event_decision before insert or update on public.events
  for each row execute function public.guard_event_decision();

-- The OC no longer flips the status directly: deciding goes through
-- decide_understaffed() (which records the decision).
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
  -- An OC: location, price, capacity.
  if (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
    raise exception 'Only the Events team changes the date' using errcode = '42501';
  end if;
  if (new.cycle_id, new.series_id, new.title, new.type, new.helpers_needed, new.visibility,
      new.chat_space_name, new.chat_space_url, new.chat_space_requested_at, new.proposed_by, new.created_by)
     is distinct from
     (old.cycle_id, old.series_id, old.title, old.type, old.helpers_needed, old.visibility,
      old.chat_space_name, old.chat_space_url, old.chat_space_requested_at, old.proposed_by, old.created_by) then
    raise exception 'Only the Events team can change this' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Decide on the event page whether an under-staffed event runs' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_update() from public, anon, authenticated;

-- Status from the staffing; a stored "run" keeps a short event confirmed
-- as long as it has an OC.
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
  if not found or e.status not in ('confirmed', 'understaffed') then
    return;
  end if;
  select count(*) filter (where role = 'oc'), count(*) filter (where role = 'helper') into oc, helpers
  from public.assignments where event_id = event and status = 'active';
  perform set_config('mesa.system_update', 'on', true);
  update public.events set
    status = case
      when oc = 0 then 'understaffed'
      when helpers >= e.helpers_needed or e.understaffed_decision = 'run' then 'confirmed'
      else 'understaffed'
    end::public.event_status
  where id = event
    and status is distinct from case
      when oc = 0 then 'understaffed'
      when helpers >= e.helpers_needed or e.understaffed_decision = 'run' then 'confirmed'
      else 'understaffed'
    end::public.event_status;
  perform set_config('mesa.system_update', 'off', true);
end;
$$;
revoke all on function private.refresh_staffing(uuid) from public, anon, authenticated;

-- Every roster change: the event loses its OC → the decision is cleared;
-- then the status follows the staffing.
create or replace function private.staffing_after_roster_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev uuid := coalesce(new.event_id, old.event_id);
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'oc' and old.status = 'active'
     and (tg_op = 'DELETE' or new.status <> 'active' or new.role <> 'oc' or new.profile_id <> old.profile_id or new.event_id <> old.event_id) then
    perform set_config('mesa.system_update', 'on', true);
    update public.events set understaffed_decision = null, understaffed_decided_by = null, understaffed_decided_at = null
    where id = old.event_id and understaffed_decision is not null;
    perform set_config('mesa.system_update', 'off', true);
    if old.event_id <> ev then
      perform private.refresh_staffing(old.event_id);
    end if;
  end if;
  perform private.refresh_staffing(ev);
  return null;
end;
$$;
revoke all on function private.staffing_after_roster_change() from public, anon, authenticated;
create trigger staffing_after_roster_change
  after insert or update or delete on public.assignments
  for each row execute function private.staffing_after_roster_change();

-- The OC (or the Events team) decides whether an under-staffed event runs.
create or replace function public.decide_understaffed(event uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
begin
  if decision not in ('run', 'cancel') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if not (public.has_role('events') or public.is_event_oc(event)) then
    raise exception 'Only the event''s OC or the Events team decides this' using errcode = '42501';
  end if;
  select * into e from public.events where id = event for update;
  if not found then
    raise exception 'No such event' using errcode = '22023';
  end if;
  if e.status <> 'understaffed' then
    raise exception 'Only under-staffed events need this decision' using errcode = '22023';
  end if;
  perform set_config('mesa.system_update', 'on', true);
  if decision = 'run' then
    if not exists (select 1 from public.assignments a where a.event_id = event and a.status = 'active' and a.role = 'oc') then
      raise exception 'The event needs an OC to run – assign one or cancel it' using errcode = '22023';
    end if;
    update public.events
    set status = 'confirmed', understaffed_decision = 'run', understaffed_decided_by = public.auth_email(), understaffed_decided_at = now()
    where id = event;
  else
    update public.events set status = 'cancelled' where id = event;
  end if;
  perform set_config('mesa.system_update', 'off', true);
end;
$$;
revoke all on function public.decide_understaffed(uuid, text) from public, anon;
grant execute on function public.decide_understaffed(uuid, text) to authenticated;
