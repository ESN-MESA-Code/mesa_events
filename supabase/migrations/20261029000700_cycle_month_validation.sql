-- ============================================================
-- MESA Events Platform – a cycle's month is the month of its events
-- (review 2026-10-28, C2)
--
-- planning_cycles.month is the month the cycle's events take place in
-- (the cycle is planned in the month before). Ideas were already matched to
-- cycles by their own date; nothing checked that an event's date falls in
-- its cycle's month. Now the database refuses it for members and teams
-- (Europe/Berlin calendar month of starts_at), and a cycle's month cannot
-- change once it has events. Like the other guards it does not apply to the
-- service role (seed scripts, tests, jobs).
-- ============================================================

comment on column public.planning_cycles.month is
  'First day of the month the cycle''s events take place in (planned in the month before).';

create or replace function public.guard_event_cycle_month()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or new.cycle_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.starts_at, new.cycle_id) is not distinct from (old.starts_at, old.cycle_id) then
    return new;
  end if;
  select month into m from public.planning_cycles where id = new.cycle_id;
  if date_trunc('month', new.starts_at at time zone 'Europe/Berlin')::date is distinct from m then
    raise exception 'The event must take place in % – the month of its planning cycle', to_char(m, 'FMMonth YYYY')
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_cycle_month() from public, anon, authenticated;
create trigger guard_event_cycle_month before insert or update of starts_at, cycle_id on public.events
  for each row execute function public.guard_event_cycle_month();

create or replace function public.guard_cycle_month()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and new.month is distinct from old.month
     and exists (select 1 from public.events e where e.cycle_id = old.id) then
    raise exception 'The month of a cycle with events cannot change' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_cycle_month() from public, anon, authenticated;
create trigger guard_cycle_month before update of month on public.planning_cycles
  for each row execute function public.guard_cycle_month();
