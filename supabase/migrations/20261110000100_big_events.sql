-- ============================================================
-- MESA Events Platform – big events are the Events team's call (round 2026-11-10)
--
-- Comms advertises "big" events weeks ahead (the board lists them early,
-- the "big" label, the filter). Until now an event was big by its type
-- (special, day trip, weekend trip) – which starts as the proposer's
-- suggestion on the idea. Now it is a mark of its own:
-- * events.big: set by the Events team on the month's schedule. A new event
--   is big when it is a special event or a weekend trip; a day trip is not,
--   unless the Events team says so.
-- * When the Events team changes an event's type and never decided about
--   "big" (it still is what the old type gave), it follows the new type.
-- * Only the Events team changes it (OCs edit their event's details too);
--   the service role (seeds, jobs) has no email.
-- ============================================================

alter table public.events add column big boolean;
comment on column public.events.big is
  'The Events team''s call: a big event is advertised weeks ahead. Filled when the event is made (special events and weekend trips are big).';

update public.events set big = type in ('special', 'weekend_trip');

-- Never null once written (the trigger below fills it). A check and not
-- "not null", so that inserts may leave it out.
alter table public.events add constraint events_big_set check (big is not null);

create or replace function private.big_by_default(type public.event_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select type in ('special', 'weekend_trip');
$$;
revoke all on function private.big_by_default(public.event_type) from public, anon, authenticated;

create or replace function private.fill_event_big()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.big is null then
      new.big := private.big_by_default(new.type);
    end if;
  elsif new.type is distinct from old.type
        and new.big is not distinct from old.big
        and old.big = private.big_by_default(old.type) then
    new.big := private.big_by_default(new.type);
  end if;
  return new;
end;
$$;
revoke all on function private.fill_event_big() from public, anon, authenticated;
create trigger events_fill_big before insert or update of type on public.events
  for each row execute function private.fill_event_big();

create or replace function private.guard_event_big()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.big is distinct from old.big and public.auth_email() <> '' and not public.has_role('events') then
    raise exception 'Only the Events team marks an event as big' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_event_big() from public, anon, authenticated;
create trigger events_guard_big before update of big on public.events
  for each row execute function private.guard_event_big();
