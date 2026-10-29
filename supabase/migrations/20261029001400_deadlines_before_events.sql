-- ============================================================
-- MESA Events Platform – deadlines lie before the month's events
-- (review 2026-10-29, A5)
--
-- The description deadline (one for all events of a cycle) and the
-- volunteer form deadline could be set after the cycle's events started;
-- the demo seed did it. The database now refuses
-- * a description deadline after the start of the cycle's first event
--   (dropped and cancelled events do not count), also when an event is
--   added or moved before an existing deadline;
-- * a form deadline after the first day of the cycle's month (Berlin).
-- Like the other guards, for members and teams; the service role (seed,
-- tests, jobs) keeps its own data right (the seed was fixed).
-- ============================================================

-- The latest allowed deadlines of a cycle, for the checks and the UI.
create or replace function public.cycle_deadline_limits(cycle uuid)
returns table (form_latest timestamptz, description_latest timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select ((c.month + 1)::timestamp at time zone 'Europe/Berlin') - interval '1 minute',
         (select min(e.starts_at) from public.events e where e.cycle_id = c.id and e.status not in ('dropped', 'cancelled'))
  from public.planning_cycles c
  where c.id = cycle and public.is_workspace_member();
$$;
revoke all on function public.cycle_deadline_limits(uuid) from public, anon;
grant execute on function public.cycle_deadline_limits(uuid) to authenticated;

create or replace function private.berlin_label(at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(at at time zone 'Europe/Berlin', 'FMDD FMMonth YYYY, HH24:MI');
$$;
revoke all on function private.berlin_label(timestamptz) from public, anon, authenticated;

create or replace function public.guard_cycle_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_start timestamptz;
  form_limit timestamptz := (new.month + 1)::timestamp at time zone 'Europe/Berlin';
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if new.form_closes_at is distinct from (case when tg_op = 'UPDATE' then old.form_closes_at end)
     and new.form_closes_at >= form_limit then
    raise exception 'The volunteer form must close by % at the latest – the first day of the month its events take place in',
      private.berlin_label(form_limit - interval '1 minute') using errcode = '22023';
  end if;
  if new.description_deadline is distinct from (case when tg_op = 'UPDATE' then old.description_deadline end)
     and new.description_deadline is not null then
    select min(e.starts_at) into first_start from public.events e
    where e.cycle_id = new.id and e.status not in ('dropped', 'cancelled');
    if new.description_deadline > first_start then
      raise exception 'The description deadline must be by % at the latest – when the month''s first event starts',
        private.berlin_label(first_start) using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_cycle_deadlines() from public, anon, authenticated;
create trigger guard_cycle_deadlines before insert or update of form_closes_at, description_deadline on public.planning_cycles
  for each row execute function public.guard_cycle_deadlines();

-- An event added or moved before the cycle's description deadline.
create or replace function public.guard_event_before_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or new.cycle_id is null or new.status in ('dropped', 'cancelled') then
    return new;
  end if;
  -- Only when it moves, changes cycle, or comes back from dropped/cancelled.
  if tg_op = 'UPDATE' and (new.starts_at, new.cycle_id) is not distinct from (old.starts_at, old.cycle_id)
     and old.status not in ('dropped', 'cancelled') then
    return new;
  end if;
  select description_deadline into deadline from public.planning_cycles where id = new.cycle_id;
  if deadline is not null and new.starts_at < deadline then
    raise exception 'The event would start before the month''s description deadline (%) – move the deadline first',
      private.berlin_label(deadline) using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_before_deadline() from public, anon, authenticated;
create trigger guard_event_before_deadline before insert or update of starts_at, cycle_id, status on public.events
  for each row execute function public.guard_event_before_deadline();
