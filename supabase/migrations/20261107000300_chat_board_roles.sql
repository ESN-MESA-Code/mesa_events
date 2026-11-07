-- Event Chat spaces: Finance (incl. the Treasurer), the executive board and
-- the Vice President are invited too, next to Events and Comms (2026-11-07).
-- Keep in step with CHAT_SPACE_ROLES in lib/roles.ts.

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
  where r.role in ('events', 'comms', 'finance', 'treasurer', 'executive', 'vice_president')
    and not exists (
      select 1 from public.assignments a join public.profiles q on q.id = a.profile_id
      where a.event_id = event and a.status = 'active' and q.email = r.email
    );
$$;
revoke all on function public.chat_space_roster(uuid) from public, anon, authenticated;
grant execute on function public.chat_space_roster(uuid) to service_role;

-- These teams are in every upcoming event's space.
create or replace function private.sync_chat_after_team_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev uuid;
begin
  if coalesce(new.role, old.role) not in ('events', 'comms', 'finance', 'treasurer', 'executive', 'vice_president') then
    return null;
  end if;
  for ev in select id from public.events where chat_space_requested_at is not null and starts_at > now() loop
    perform private.enqueue_job('chat.sync_members', jsonb_build_object('event_id', ev), 'chat.sync_members:' || ev, ev, true);
  end loop;
  return null;
end;
$$;
revoke all on function private.sync_chat_after_team_change() from public, anon, authenticated;

-- Spaces that already exist: add the newly invited roles to the upcoming ones.
do $$
declare
  ev uuid;
begin
  for ev in select id from public.events where chat_space_name is not null and starts_at > now() loop
    perform private.enqueue_job('chat.sync_members', jsonb_build_object('event_id', ev), 'chat.sync_members:' || ev, ev, true);
  end loop;
end;
$$;
