-- ============================================================
-- MESA Events Platform – office hours on the leaderboard (2026-10-31)
--
-- The leaderboard moves to its own page and gets a third category: office
-- hours staffed (OC or helper) that took place in the semester and were
-- not cancelled. ESN events count as before. The return type changes, so
-- the function is dropped and created again.
-- ============================================================

drop function if exists public.leaderboard(text);

-- Everyone with at least one OC or helper slot of an event, or a shift in an
-- office hour, that took place in the semester.
create or replace function public.leaderboard(semester text)
returns table (profile_id uuid, full_name text, oc_count integer, helper_count integer, office_hour_count integer, newbie boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  if semester !~ '^[0-9]{4}-[12]$' then
    raise exception 'Not a semester: %', semester using errcode = '22023';
  end if;
  select * into b from private.semester_bounds(semester);
  return query
  with ev as (
    select a.profile_id as id,
           (count(*) filter (where a.role = 'oc'))::integer as oc,
           (count(*) filter (where a.role = 'helper'))::integer as helper
    from public.assignments a
    join public.events e on e.id = a.event_id
    where a.status = 'active'
      and e.source = 'platform'
      and (e.status in ('confirmed', 'completed') or (e.status = 'understaffed' and e.understaffed_decision = 'run'))
      and e.starts_at < now()
      and (e.starts_at at time zone 'Europe/Berlin')::date between b.from_day and b.to_day
    group by a.profile_id
  ), oh as (
    select ip.profile_id as id, count(*)::integer as n
    from public.internal_event_people ip
    join public.internal_events ie on ie.id = ip.internal_event_id
    where ie.kind = 'office_hour'
      and ie.status = 'scheduled'
      and ip.role in ('oc', 'helper')
      and ie.starts_at < now()
      and (ie.starts_at at time zone 'Europe/Berlin')::date between b.from_day and b.to_day
    group by ip.profile_id
  )
  select p.id,
         coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
         coalesce(ev.oc, 0),
         coalesce(ev.helper, 0),
         coalesce(oh.n, 0),
         exists (select 1 from public.role_members r where r.email = p.email and r.role = 'newbie')
  from public.profiles p
  left join ev on ev.id = p.id
  left join oh on oh.id = p.id
  where ev.id is not null or oh.id is not null;
end;
$$;
revoke all on function public.leaderboard(text) from public, anon;
grant execute on function public.leaderboard(text) to authenticated;
