-- ============================================================
-- MESA Events Platform – the monthly planning cycle
--
-- ideas → month schedule (Events) → volunteer form → automatic allocation
-- (computed by the app, lib/allocation.ts) → roster adjustments →
-- confirmation by the Events team.
--
-- Cycle status changes only through the functions below (a trigger refuses
-- direct status updates), so their side effects always happen.
-- ============================================================

-- ── Activity log outlives what it describes ─────────────────────────────────
-- Deleting an event (retention job, admins) cascades to its assignments,
-- whose log entries would point at the deleted event: no foreign keys.
-- Entries are kept until the end of the third calendar year, like the
-- attendance lists.
alter table public.activity_log
  drop constraint activity_log_event_id_fkey,
  drop constraint activity_log_cycle_id_fkey;

create or replace function public.delete_expired_activity()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.activity_log where at < date_trunc('year', now()) - interval '3 years' returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke all on function public.delete_expired_activity() from public, anon, authenticated;
select cron.schedule('delete-expired-activity', '40 3 * * *', 'select public.delete_expired_activity()');

-- ── Ideas ───────────────────────────────────────────────────────────────────
create table public.event_ideas (
  id             uuid primary key default gen_random_uuid(),
  title          text not null constraint event_ideas_title_check check (length(title) between 1 and 200),
  proposed_date  date not null,
  pitch          text not null default '' constraint event_ideas_pitch_check check (length(pitch) <= 2000),
  helpers_needed smallint not null default 2 constraint event_ideas_helpers_check check (helpers_needed between 0 and 50),
  -- The proposer becomes OC by default (SPEC); they can say no.
  wants_to_oc    boolean not null default true,
  proposer_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status         text not null default 'proposed'
    constraint event_ideas_status_check check (status in ('proposed', 'accepted', 'rejected', 'merged')),
  -- The event it became (accepted) or was merged into.
  event_id       uuid references public.events(id) on delete set null,
  decision_note  text constraint event_ideas_note_check check (length(decision_note) <= 1000),
  decided_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index event_ideas_date_idx on public.event_ideas(proposed_date);
create trigger event_ideas_updated_at before update on public.event_ideas for each row execute function public.set_updated_at();
create trigger log_event_ideas after insert or update on public.event_ideas for each row execute function private.log_row_change();

alter table public.event_ideas enable row level security;
create policy "Members read their ideas, teams all"
  on public.event_ideas for select to authenticated
  using (public.is_team() or (public.is_workspace_member() and proposer_id = auth.uid()));
create policy "Members propose ideas"
  on public.event_ideas for insert to authenticated
  with check (public.is_workspace_member() and proposer_id = auth.uid() and status = 'proposed' and event_id is null);
create policy "Proposers edit open ideas, Events all"
  on public.event_ideas for update to authenticated
  using (public.has_role('events') or (public.is_workspace_member() and proposer_id = auth.uid() and status = 'proposed'))
  with check (public.has_role('events') or (proposer_id = auth.uid() and status = 'proposed' and event_id is null));
create policy "Proposers withdraw open ideas"
  on public.event_ideas for delete to authenticated
  using (public.is_workspace_member() and proposer_id = auth.uid() and status = 'proposed');
revoke all on public.event_ideas from anon;

-- Events records who decided; proposers cannot move their idea's decision fields.
create or replace function public.guard_idea_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if public.has_role('events') then
    if new.status is distinct from old.status then
      new.decided_by := public.auth_email();
    end if;
    return new;
  end if;
  if (new.status, new.event_id, new.decision_note, new.decided_by, new.proposer_id)
     is distinct from (old.status, old.event_id, old.decision_note, old.decided_by, old.proposer_id) then
    raise exception 'Only the Events team decides on ideas' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_idea_update() from public, anon, authenticated;
create trigger guard_idea_update before update on public.event_ideas for each row execute function public.guard_idea_update();

-- Events accepts an idea: it becomes a draft event of the cycle, its
-- proposer the default OC (when they want to).
create or replace function public.accept_idea(
  idea uuid, cycle uuid, event_type public.event_type, starts timestamptz, helpers smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.event_ideas;
  c public.planning_cycles;
  new_event uuid;
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team accepts ideas' using errcode = '42501';
  end if;
  select * into i from public.event_ideas where id = idea for update;
  if not found or i.status <> 'proposed' then
    raise exception 'This idea is not open any more' using errcode = '22023';
  end if;
  select * into c from public.planning_cycles where id = cycle;
  if not found or c.status not in ('planning', 'form_open') then
    raise exception 'Ideas can only be added while the schedule is being planned' using errcode = '22023';
  end if;
  insert into public.events (cycle_id, title, type, starts_at, helpers_needed, proposed_by, status)
  values (cycle, i.title, event_type, starts, coalesce(helpers, i.helpers_needed), case when i.wants_to_oc then i.proposer_id end,
          case when c.status = 'form_open' then 'scheduled' else 'draft' end::public.event_status)
  returning id into new_event;
  update public.event_ideas set status = 'accepted', event_id = new_event where id = idea;
  return new_event;
end;
$$;
revoke all on function public.accept_idea(uuid, uuid, public.event_type, timestamptz, smallint) from public, anon;
grant execute on function public.accept_idea(uuid, uuid, public.event_type, timestamptz, smallint) to authenticated;

-- ── Volunteer form ──────────────────────────────────────────────────────────
create table public.volunteer_responses (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references public.planning_cycles(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  note         text not null default '' constraint volunteer_responses_note_check check (length(note) <= 1000),
  -- First submission; each choice keeps its own time (FCFS per event).
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (cycle_id, profile_id)
);

create table public.volunteer_choices (
  response_id uuid not null references public.volunteer_responses(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  -- 1 = top choice, 2 = happy to, 3 = if needed; null = not in this role.
  oc_rank     smallint constraint volunteer_choices_oc_rank_check check (oc_rank between 1 and 3),
  helper_rank smallint constraint volunteer_choices_helper_rank_check check (helper_rank between 1 and 3),
  -- When the event was first added to the form: ties are first come, first served.
  chosen_at   timestamptz not null default now(),
  primary key (response_id, event_id),
  constraint volunteer_choices_some_role check (oc_rank is not null or helper_rank is not null)
);

alter table public.volunteer_responses enable row level security;
alter table public.volunteer_choices enable row level security;

create policy "Volunteers read their response, Events and executives all"
  on public.volunteer_responses for select to authenticated
  using (public.has_role('events') or public.has_role('executive') or (public.is_workspace_member() and profile_id = auth.uid()));
create policy "Volunteers read their choices, Events and executives all"
  on public.volunteer_choices for select to authenticated
  using (
    public.has_role('events') or public.has_role('executive')
    or exists (select 1 from public.volunteer_responses r where r.id = response_id and r.profile_id = auth.uid() and public.is_workspace_member())
  );
-- Written only through submit_volunteer_form() (checks the deadline).
revoke insert, update, delete, truncate on public.volunteer_responses, public.volunteer_choices from anon, authenticated;
revoke all on public.volunteer_responses, public.volunteer_choices from anon;

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
  on conflict (cycle_id, profile_id) do update set note = excluded.note, updated_at = now()
  returning r.id into response;

  -- Events no longer chosen go; kept ones keep their time.
  delete from public.volunteer_choices v
  where v.response_id = response
    and v.event_id not in (select (x ->> 'event_id')::uuid from jsonb_array_elements(choices) x);
  insert into public.volunteer_choices as v (response_id, event_id, oc_rank, helper_rank)
  select response, (x ->> 'event_id')::uuid, nullif(x ->> 'oc_rank', '')::smallint, nullif(x ->> 'helper_rank', '')::smallint
  from jsonb_array_elements(choices) x
  on conflict (response_id, event_id) do update set oc_rank = excluded.oc_rank, helper_rank = excluded.helper_rank;
  return response;
end;
$$;
revoke all on function public.submit_volunteer_form(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_volunteer_form(uuid, jsonb, text) to authenticated;

-- ── Cycle status: only through these functions ──────────────────────────────
create or replace function public.guard_cycle_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and coalesce(current_setting('mesa.cycle_transition', true), '') <> 'on' then
    raise exception 'Use the cycle actions to change its status' using errcode = '42501';
  end if;
  if (new.confirmed_at, new.confirmed_by, new.allocated_at) is distinct from (old.confirmed_at, old.confirmed_by, old.allocated_at)
     and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and coalesce(current_setting('mesa.cycle_transition', true), '') <> 'on' then
    raise exception 'Use the cycle actions to change its status' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_cycle_status before update on public.planning_cycles for each row execute function public.guard_cycle_status();

create or replace function private.require_cycle(cycle uuid, allowed public.cycle_status[])
returns public.planning_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.planning_cycles;
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team can do this' using errcode = '42501';
  end if;
  select * into c from public.planning_cycles where id = cycle for update;
  if not found then
    raise exception 'No such cycle' using errcode = '22023';
  end if;
  if not (c.status = any(allowed)) then
    raise exception 'Not possible while the cycle is "%"', c.status using errcode = '22023';
  end if;
  perform set_config('mesa.cycle_transition', 'on', true);
  return c;
end;
$$;

-- Opens the form: the month's draft events go on it (and on the calendar).
create or replace function public.open_volunteer_form(cycle uuid, closes_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_cycle(cycle, array['planning', 'form_closed']::public.cycle_status[]);
  if closes_at <= now() then
    raise exception 'The deadline must be in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from public.events where cycle_id = cycle and status in ('draft', 'scheduled')) then
    raise exception 'Add events to the schedule first' using errcode = '22023';
  end if;
  update public.events set status = 'scheduled' where cycle_id = cycle and status = 'draft';
  update public.planning_cycles set status = 'form_open', form_closes_at = closes_at where id = cycle;
end;
$$;

create or replace function public.close_volunteer_form(cycle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_cycle(cycle, array['form_open']::public.cycle_status[]);
  update public.planning_cycles set status = 'form_closed', form_closes_at = least(coalesce(form_closes_at, now()), now()) where id = cycle;
end;
$$;

-- pg_cron closes forms whose deadline passed.
create or replace function private.close_due_forms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform set_config('mesa.cycle_transition', 'on', true);
  update public.planning_cycles set status = 'form_closed'
  where status = 'form_open' and form_closes_at is not null and form_closes_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function private.close_due_forms() from public, anon, authenticated;
select cron.schedule('close-volunteer-forms', '* * * * *', 'select private.close_due_forms()');

-- Saves a computed allocation (lib/allocation.ts): replaces every
-- assignment of the cycle's events. Rerunning before confirmation is fine.
create or replace function public.save_allocation(cycle uuid, rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform private.require_cycle(cycle, array['form_closed', 'allocated']::public.cycle_status[]);
  if exists (
    select 1 from jsonb_array_elements(rows) x
    where not exists (select 1 from public.events e where e.id = (x ->> 'event_id')::uuid and e.cycle_id = cycle)
  ) then
    raise exception 'Assignment for an event outside this cycle' using errcode = '22023';
  end if;
  delete from public.assignments a using public.events e where a.event_id = e.id and e.cycle_id = cycle;
  insert into public.assignments (event_id, profile_id, role, source)
  select (x ->> 'event_id')::uuid, (x ->> 'profile_id')::uuid, x ->> 'role', coalesce(x ->> 'source', 'auto')
  from jsonb_array_elements(rows) x;
  get diagnostics n = row_count;
  update public.planning_cycles set status = 'allocated', allocated_at = now() where id = cycle;
  return n;
end;
$$;

-- Confirms the roster: each event's status follows its staffing; the roster
-- becomes visible to all members and Chat spaces get created (jobs).
create or replace function public.confirm_allocation(cycle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_cycle(cycle, array['allocated']::public.cycle_status[]);
  update public.events e set status = case
      when s.oc = 0 and s.helpers = 0 then 'dropped'
      when s.oc = 0 or s.helpers < e.helpers_needed then 'understaffed'
      else 'confirmed'
    end::public.event_status
  from (
    select ev.id,
      (select count(*) from public.assignments a where a.event_id = ev.id and a.status = 'active' and a.role = 'oc') as oc,
      (select count(*) from public.assignments a where a.event_id = ev.id and a.status = 'active' and a.role = 'helper') as helpers
    from public.events ev where ev.cycle_id = cycle and ev.status = 'scheduled'
  ) s
  where e.id = s.id;
  update public.planning_cycles set status = 'confirmed', confirmed_at = now(), confirmed_by = public.auth_email() where id = cycle;
end;
$$;

revoke all on function private.require_cycle(uuid, public.cycle_status[]) from public, anon, authenticated;
revoke all on function public.open_volunteer_form(uuid, timestamptz) from public, anon;
revoke all on function public.close_volunteer_form(uuid) from public, anon;
revoke all on function public.save_allocation(uuid, jsonb) from public, anon;
revoke all on function public.confirm_allocation(uuid) from public, anon;
grant execute on function public.open_volunteer_form(uuid, timestamptz) to authenticated;
grant execute on function public.close_volunteer_form(uuid) to authenticated;
grant execute on function public.save_allocation(uuid, jsonb) to authenticated;
grant execute on function public.confirm_allocation(uuid) to authenticated;

-- What the form, the allocation and the roster board need about volunteers
-- (Events team only; one row per choice).
create or replace function public.cycle_signups(cycle uuid)
returns table (profile_id uuid, full_name text, email text, event_id uuid, oc_rank smallint, helper_rank smallint, chosen_at timestamptz, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id, p.full_name, p.email, v.event_id, v.oc_rank, v.helper_rank, v.chosen_at, r.submitted_at
  from public.volunteer_responses r
  join public.profiles p on p.id = r.profile_id
  join public.volunteer_choices v on v.response_id = r.id
  where r.cycle_id = cycle and (public.has_role('events') or public.has_role('executive'));
$$;
revoke all on function public.cycle_signups(uuid) from public, anon;
grant execute on function public.cycle_signups(uuid) to authenticated;
