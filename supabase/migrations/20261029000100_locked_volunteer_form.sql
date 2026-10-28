-- ============================================================
-- MESA Events Platform – the volunteer form locks after submitting
-- (review 2026-10-28, A1)
--
-- * A volunteer submits once per cycle; a second submission is refused.
-- * First come, first served uses the single submission time
--   (volunteer_responses.submitted_at) for all of a person's choices: the
--   per-choice time (volunteer_choices.chosen_at) is gone.
-- * Escape hatch: the Events team clears one person's response while the
--   form is open (logged with a reason); that person can then submit again
--   and gets a new submission time.
-- ============================================================

alter table public.volunteer_choices drop column chosen_at;

comment on column public.volunteer_responses.submitted_at is
  'The single submission (the form locks afterwards): first come, first served for all of the person''s choices.';

create or replace function public.submit_volunteer_form(cycle uuid, choices jsonb, note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.planning_cycles;
  response uuid;
  ch jsonb;
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  select * into c from public.planning_cycles where id = cycle;
  if not found or c.status <> 'form_open' or (c.form_closes_at is not null and now() >= c.form_closes_at) then
    raise exception 'The volunteer form is closed' using errcode = '22023';
  end if;
  if jsonb_typeof(choices) <> 'array' or jsonb_array_length(choices) > 200 then
    raise exception 'Invalid choices' using errcode = '22023';
  end if;
  for ch in select * from jsonb_array_elements(choices) loop
    if not exists (
      select 1 from public.events e
      where e.id = (ch ->> 'event_id')::uuid and e.cycle_id = cycle and e.status = 'scheduled'
    ) then
      raise exception 'Event % is not on this month''s form', ch ->> 'event_id' using errcode = '22023';
    end if;
  end loop;

  insert into public.volunteer_responses as r (cycle_id, profile_id, note)
  values (cycle, auth.uid(), left(coalesce(note, ''), 1000))
  on conflict (cycle_id, profile_id) do nothing
  returning r.id into response;
  if response is null then
    raise exception 'You already submitted this form. Ask the Events team if something changes.' using errcode = '23505';
  end if;

  insert into public.volunteer_choices (response_id, event_id, oc_rank, helper_rank)
  select response, (x ->> 'event_id')::uuid, nullif(x ->> 'oc_rank', '')::smallint, nullif(x ->> 'helper_rank', '')::smallint
  from jsonb_array_elements(choices) x;
  return response;
end;
$$;

-- The Events team clears one person's response so they can submit again
-- (a mistake, plans changed). Only while the form is open; logged.
create or replace function public.clear_volunteer_response(cycle uuid, profile uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.volunteer_responses;
  n integer;
begin
  perform private.require_cycle(cycle, array['form_open']::public.cycle_status[]);
  if coalesce(trim(reason), '') = '' then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  select * into r from public.volunteer_responses where cycle_id = cycle and profile_id = profile for update;
  if not found then
    raise exception 'This person has not submitted the form' using errcode = '22023';
  end if;
  select count(*) into n from public.volunteer_choices where response_id = r.id;
  delete from public.volunteer_responses where id = r.id;
  perform private.log('volunteer_responses', r.id::text, 'clear', null, cycle, jsonb_build_object(
    'profile_id', profile,
    'email', (select email from public.profiles where id = profile),
    'submitted_at', r.submitted_at,
    'events', n,
    'reason', left(trim(reason), 500)
  ));
end;
$$;
revoke all on function public.clear_volunteer_response(uuid, uuid, text) from public, anon;
grant execute on function public.clear_volunteer_response(uuid, uuid, text) to authenticated;

-- One row per choice (allocation, roster board); the submission time is the
-- tie-breaker for all of a person's choices.
drop function public.cycle_signups(uuid);
create function public.cycle_signups(cycle uuid)
returns table (profile_id uuid, full_name text, email text, event_id uuid, oc_rank smallint, helper_rank smallint, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id, p.full_name, p.email, v.event_id, v.oc_rank, v.helper_rank, r.submitted_at
  from public.volunteer_responses r
  join public.profiles p on p.id = r.profile_id
  join public.volunteer_choices v on v.response_id = r.id
  where r.cycle_id = cycle and (public.has_role('events') or public.has_role('executive'));
$$;
revoke all on function public.cycle_signups(uuid) from public, anon;
grant execute on function public.cycle_signups(uuid) to authenticated;

-- Who answered (also those who picked nothing), for the cycle page.
create or replace function public.cycle_responses(cycle uuid)
returns table (profile_id uuid, full_name text, email text, submitted_at timestamptz, note text, events integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id, p.full_name, p.email, r.submitted_at, r.note,
         (select count(*) from public.volunteer_choices v where v.response_id = r.id)::integer
  from public.volunteer_responses r
  join public.profiles p on p.id = r.profile_id
  where r.cycle_id = cycle and (public.has_role('events') or public.has_role('executive'))
  order by r.submitted_at;
$$;
revoke all on function public.cycle_responses(uuid) from public, anon;
grant execute on function public.cycle_responses(uuid) to authenticated;
