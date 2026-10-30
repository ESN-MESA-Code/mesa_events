-- ============================================================
-- MESA Events Platform – the description deadline is binding
-- (round 2026-10-30)
--
-- * The deadline is set only once the roster is confirmed (the events
--   and their OCs are known), and only to a time still ahead.
-- * Once it has passed it can no longer be changed or removed: the next
--   phase has started.
-- * At the deadline, every running event of the cycle that has not
--   started and whose description was never submitted to Comms is
--   cancelled (reason stored, the Chat space told, as with a manual
--   cancellation). A pg_cron job checks every minute.
-- Like the other guards, for members and teams; the service role (seed,
-- tests, jobs) keeps its own data right.
-- ============================================================

create or replace function public.guard_cycle_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_start timestamptz;
  form_limit timestamptz := (new.month + 1)::timestamp at time zone 'Europe/Berlin';
  old_deadline timestamptz := case when tg_op = 'UPDATE' then old.description_deadline end;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if new.form_closes_at is distinct from (case when tg_op = 'UPDATE' then old.form_closes_at end)
     and new.form_closes_at >= form_limit then
    raise exception 'The volunteer form must close by % at the latest – the first day of the month its events take place in',
      private.berlin_label(form_limit - interval '1 minute') using errcode = '22023';
  end if;
  if new.description_deadline is distinct from old_deadline then
    if old_deadline is not null and old_deadline <= now() then
      raise exception 'The description deadline has passed – it can no longer be changed' using errcode = '22023';
    end if;
    if new.status <> 'confirmed' then
      raise exception 'Set the description deadline once the roster is confirmed' using errcode = '22023';
    end if;
    if new.description_deadline is not null then
      if new.description_deadline <= now() then
        raise exception 'The description deadline must lie in the future' using errcode = '22023';
      end if;
      select min(e.starts_at) into first_start from public.events e
      where e.cycle_id = new.id and e.status not in ('dropped', 'cancelled');
      if new.description_deadline > first_start then
        raise exception 'The description deadline must be by % at the latest – when the month''s first event starts',
          private.berlin_label(first_start) using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_cycle_deadlines() from public, anon, authenticated;

-- Cancels the events whose description is overdue (never submitted by the
-- cycle's deadline). Returns how many.
create or replace function private.cancel_overdue_descriptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev record;
  n integer := 0;
begin
  for ev in
    select e.id
    from public.events e
    join public.planning_cycles c on c.id = e.cycle_id
    left join public.descriptions d on d.event_id = e.id
    where c.description_deadline is not null
      and c.description_deadline <= now()
      and e.status in ('confirmed', 'understaffed')
      and e.starts_at > now()
      and d.submitted_at is null
    for update of e skip locked
  loop
    perform private.cancel_event(ev.id, 'Description not submitted by the deadline');
    perform set_config('mesa.system_update', 'on', true);
    update public.events set cancelled_by = 'description deadline' where id = ev.id;
    perform set_config('mesa.system_update', 'off', true);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.cancel_overdue_descriptions() from public, anon, authenticated;

select cron.schedule('cancel-overdue-descriptions', '* * * * *', 'select private.cancel_overdue_descriptions()');

-- The DB tests run it on demand (service role only).
create or replace function public.cancel_overdue_descriptions()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.cancel_overdue_descriptions();
$$;
revoke all on function public.cancel_overdue_descriptions() from public, anon, authenticated;
grant execute on function public.cancel_overdue_descriptions() to service_role;
