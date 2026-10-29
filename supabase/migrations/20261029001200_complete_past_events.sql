-- ============================================================
-- MESA Events Platform – events become "completed" (review 2026-10-29, A3)
--
-- Nothing set status = 'completed', so past events showed "Confirmed" or
-- "Under-staffed" forever. A pg_cron job marks confirmed and under-staffed
-- events completed once they ended: ends_at, or a day after the start when
-- no end is set. Everything that works for confirmed events after the day
-- (attendance, hand-in, receipts, photos, descriptions overview,
-- checklists) already accepts completed ones; open slots, dropping out and
-- the staffing refresh stop, as they do once an event started.
-- ============================================================

create or replace function private.complete_past_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform set_config('mesa.system_update', 'on', true);
  update public.events set status = 'completed'
  where status in ('confirmed', 'understaffed')
    and coalesce(ends_at, starts_at + interval '1 day') < now();
  get diagnostics n = row_count;
  perform set_config('mesa.system_update', 'off', true);
  return n;
end;
$$;
revoke all on function private.complete_past_events() from public, anon, authenticated;

-- Every 15 minutes: "completed" may lag the end by that much.
select cron.schedule('complete-past-events', '*/15 * * * *', 'select private.complete_past_events()');

-- The DB tests run it on demand (service role only).
create or replace function public.complete_past_events()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.complete_past_events();
$$;
revoke all on function public.complete_past_events() from public, anon, authenticated;
grant execute on function public.complete_past_events() to service_role;

select private.complete_past_events();
