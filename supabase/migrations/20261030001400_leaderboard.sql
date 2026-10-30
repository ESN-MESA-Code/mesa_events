-- ============================================================
-- MESA Events Platform – the leaderboard on Home (round 2026-10-30)
--
-- Who OC'd and who helped the most ESN events this semester – once for
-- active members, once for newbies – to motivate people to organise and
-- help. Counts active OC / helper assignments of events that took place
-- (confirmed or completed, or under-staffed and run) in the semester.
-- Newbies are the members of the newbies Google group (role 'newbie',
-- synced like every role). Semester keys as lib/photos.ts: "2026-1" =
-- SoSe (April–September), "2026-2" = WiSe (October–March).
-- ============================================================

-- First and last day of a semester key.
create or replace function private.semester_bounds(semester text, out from_day date, out to_day date)
language sql
immutable
set search_path = ''
as $$
  select case when split_part(semester, '-', 2) = '1' then make_date(split_part(semester, '-', 1)::int, 4, 1) else make_date(split_part(semester, '-', 1)::int, 10, 1) end,
         case when split_part(semester, '-', 2) = '1' then make_date(split_part(semester, '-', 1)::int, 9, 30) else make_date(split_part(semester, '-', 1)::int + 1, 3, 31) end;
$$;
revoke all on function private.semester_bounds(text) from public, anon, authenticated;

-- Everyone with at least one OC or helper slot of an event that took place in the semester.
create or replace function public.leaderboard(semester text)
returns table (profile_id uuid, full_name text, oc_count integer, helper_count integer, newbie boolean)
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
  select p.id,
         coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
         (count(*) filter (where a.role = 'oc'))::integer,
         (count(*) filter (where a.role = 'helper'))::integer,
         exists (select 1 from public.role_members r where r.email = p.email and r.role = 'newbie')
  from public.assignments a
  join public.events e on e.id = a.event_id
  join public.profiles p on p.id = a.profile_id
  where a.status = 'active'
    and e.source = 'platform'
    and (e.status in ('confirmed', 'completed') or (e.status = 'understaffed' and e.understaffed_decision = 'run'))
    and e.starts_at < now()
    and (e.starts_at at time zone 'Europe/Berlin')::date between b.from_day and b.to_day
  group by p.id, p.full_name, p.email;
end;
$$;
revoke all on function public.leaderboard(text) from public, anon;
grant execute on function public.leaderboard(text) to authenticated;
