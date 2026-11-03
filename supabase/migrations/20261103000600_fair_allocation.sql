-- ============================================================
-- MESA Events Platform – a fairer allocation (round 2026-11-03)
--
-- * Five levels instead of three: 1 = top choice, 2 = keen, 3 = happy to,
--   4 = could do, 5 = if needed. Existing answers keep their meaning
--   (old 2 "happy to" → 3, old 3 "if needed" → 5).
-- * Each volunteer says how many events they can do this month
--   (volunteer_responses.max_events, null = no limit) and how many of them
--   as OC (max_oc, null = no limit; the form's default is 1). Answers given before
--   this migration keep the old behaviour: no limits.
-- * allocation_history(): per volunteer of a cycle, their events of the
--   three months before, whether they ever were on an event, and whether
--   they signed up last month and got nothing – the allocation's fairness
--   and experience inputs (lib/allocation.ts).
-- * An event whose OC is set already (the idea's proposer wants to OC it,
--   events.proposed_by) takes no OC answers, and its proposer cannot sign up
--   as its helper: submit_volunteer_form() refuses both.
-- ============================================================

-- ── Five levels ─────────────────────────────────────────────────────────────
alter table public.volunteer_choices drop constraint volunteer_choices_oc_rank_check;
alter table public.volunteer_choices drop constraint volunteer_choices_helper_rank_check;
update public.volunteer_choices set
  oc_rank = case oc_rank when 2 then 3 when 3 then 5 else oc_rank end,
  helper_rank = case helper_rank when 2 then 3 when 3 then 5 else helper_rank end
where oc_rank in (2, 3) or helper_rank in (2, 3);
alter table public.volunteer_choices
  add constraint volunteer_choices_oc_rank_check check (oc_rank between 1 and 5),
  add constraint volunteer_choices_helper_rank_check check (helper_rank between 1 and 5);
comment on column public.volunteer_choices.oc_rank is
  '1 = top choice, 2 = keen, 3 = happy to, 4 = could do, 5 = if needed; null = not as OC.';
comment on column public.volunteer_choices.helper_rank is
  '1 = top choice, 2 = keen, 3 = happy to, 4 = could do, 5 = if needed; null = not as helper.';

-- ── Limits per volunteer ────────────────────────────────────────────────────
alter table public.volunteer_responses
  add column max_events smallint constraint volunteer_responses_max_events_check check (max_events between 1 and 31),
  add column max_oc smallint constraint volunteer_responses_max_oc_check check (max_oc between 1 and 31);
comment on column public.volunteer_responses.max_events is 'How many events the volunteer can do this month; null = no limit.';
comment on column public.volunteer_responses.max_oc is 'How many of them as OC; null = no limit. The form preselects 1.';

drop function public.submit_volunteer_form(uuid, jsonb, text);
create function public.submit_volunteer_form(cycle uuid, choices jsonb, note text default '', max_events smallint default null, max_oc smallint default null)
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
    -- The proposer is the OC already: nobody else votes for OC, they do not help on it.
    if exists (
      select 1 from public.events e
      where e.id = (ch ->> 'event_id')::uuid and e.proposed_by is not null
        and (nullif(ch ->> 'oc_rank', '') is not null or (e.proposed_by = auth.uid() and nullif(ch ->> 'helper_rank', '') is not null))
    ) then
      raise exception 'Event % has its OC already (the idea''s proposer)', ch ->> 'event_id' using errcode = '22023';
    end if;
  end loop;

  insert into public.volunteer_responses as r (cycle_id, profile_id, note, max_events, max_oc)
  values (cycle, auth.uid(), left(coalesce(note, ''), 1000), submit_volunteer_form.max_events, submit_volunteer_form.max_oc)
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
revoke all on function public.submit_volunteer_form(uuid, jsonb, text, smallint, smallint) from public, anon;
grant execute on function public.submit_volunteer_form(uuid, jsonb, text, smallint, smallint) to authenticated;

-- One row per choice (allocation, roster board), now with the person's limits.
drop function public.cycle_signups(uuid);
create function public.cycle_signups(cycle uuid)
returns table (profile_id uuid, full_name text, email text, event_id uuid, oc_rank smallint, helper_rank smallint, submitted_at timestamptz, max_events smallint, max_oc smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id, p.full_name, p.email, v.event_id, v.oc_rank, v.helper_rank, r.submitted_at, r.max_events, r.max_oc
  from public.volunteer_responses r
  join public.profiles p on p.id = r.profile_id
  join public.volunteer_choices v on v.response_id = r.id
  where r.cycle_id = cycle and (public.has_role('events') or public.has_role('executive'));
$$;
revoke all on function public.cycle_signups(uuid) from public, anon;
grant execute on function public.cycle_signups(uuid) to authenticated;

-- ── History for fairness and experience ─────────────────────────────────────
-- Per volunteer of the cycle: OC/helper slots (active, event not cancelled or
-- dropped) in the three months before the cycle's month and ever before it,
-- and whether they signed up in the month before and got no slot at all.
create function public.allocation_history(cycle uuid)
returns table (profile_id uuid, recent_events integer, past_events integer, unplaced_last_cycle boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select id, month, (month::timestamp at time zone 'Europe/Berlin') as starts from public.planning_cycles where id = cycle
  ),
  prev as (
    select pc.id from public.planning_cycles pc, c where pc.month = (c.month - interval '1 month')::date
  ),
  people as (
    select r.profile_id from public.volunteer_responses r where r.cycle_id = cycle
  )
  select
    p.profile_id,
    (select count(*)::integer from public.assignments a join public.events e on e.id = a.event_id, c
      where a.profile_id = p.profile_id and a.status = 'active' and e.status not in ('cancelled', 'dropped')
        and e.starts_at < c.starts and e.starts_at >= c.starts - interval '3 months'),
    (select count(*)::integer from public.assignments a join public.events e on e.id = a.event_id, c
      where a.profile_id = p.profile_id and a.status = 'active' and e.status not in ('cancelled', 'dropped')
        and e.starts_at < c.starts),
    exists (
      select 1 from public.volunteer_responses r join public.volunteer_choices v on v.response_id = r.id
      where r.cycle_id = (select id from prev) and r.profile_id = p.profile_id
    ) and not exists (
      select 1 from public.assignments a join public.events e on e.id = a.event_id
      where e.cycle_id = (select id from prev) and a.profile_id = p.profile_id
    )
  from people p
  where public.has_role('events') or public.has_role('executive');
$$;
revoke all on function public.allocation_history(uuid) from public, anon;
grant execute on function public.allocation_history(uuid) to authenticated;
