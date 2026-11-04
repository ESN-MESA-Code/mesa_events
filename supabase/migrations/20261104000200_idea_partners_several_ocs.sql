-- ============================================================
-- MESA Events Platform – partners on ideas, several OCs per event (2026-11-04)
--
-- * Ideas and events say how many OCs they need (ocs_needed, default 1),
--   like helpers_needed. An event may have that many active OCs: the
--   one-OC-per-event index is gone. Staffing counts OCs against it.
-- * The proposer can name partners for an idea, each as co-OC or helper
--   (idea_partners). A partner is asked first: they accept or decline
--   (respond_idea_partner()) while the idea is open, or until the month is
--   allocated. Accepted partners of an accepted idea are fixed on its event
--   like the proposer (OC): event_fixed_people() lists them for the
--   allocation and the volunteer form.
-- * The volunteer form takes no OC answers once the fixed OCs fill the OC
--   slots, and nothing from people fixed on the event.
-- ============================================================

-- ── OCs needed ──────────────────────────────────────────────────────────────
alter table public.event_ideas
  add column ocs_needed smallint not null default 1 constraint event_ideas_ocs_needed_check check (ocs_needed between 1 and 10);
alter table public.events
  add column ocs_needed smallint not null default 1 constraint events_ocs_needed_check check (ocs_needed between 1 and 10);
comment on column public.events.ocs_needed is 'How many OCs the event needs (the allocation fills that many OC slots).';

drop index public.assignments_one_active_oc;

-- Only the Events team changes how many OCs and helpers an event needs.
create or replace function public.guard_event_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or coalesce(current_setting('mesa.system_update', true), '') = 'on'
     or public.has_role('events') then
    return new;
  end if;
  -- An OC: location, price, capacity.
  if (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
    raise exception 'Only the Events team changes the date' using errcode = '42501';
  end if;
  if (new.cycle_id, new.series_id, new.title, new.type, new.helpers_needed, new.ocs_needed, new.visibility,
      new.chat_space_name, new.chat_space_url, new.chat_space_requested_at, new.proposed_by, new.created_by)
     is distinct from
     (old.cycle_id, old.series_id, old.title, old.type, old.helpers_needed, old.ocs_needed, old.visibility,
      old.chat_space_name, old.chat_space_url, old.chat_space_requested_at, old.proposed_by, old.created_by) then
    raise exception 'Only the Events team can change this' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Decide on the event page whether an under-staffed event runs' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── Staffing with several OCs ───────────────────────────────────────────────
-- No OC at all: under-staffed. Fewer OCs or helpers than needed: under-staffed
-- unless the OC decided to run it anyway.
create or replace function private.refresh_staffing(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  oc integer;
  helpers integer;
  next_status public.event_status;
begin
  select * into e from public.events where id = event;
  if not found or e.status not in ('confirmed', 'understaffed') then
    return;
  end if;
  select count(*) filter (where role = 'oc'), count(*) filter (where role = 'helper') into oc, helpers
  from public.assignments where event_id = event and status = 'active';
  next_status := case
      when oc = 0 then 'understaffed'
      when (helpers >= e.helpers_needed and oc >= e.ocs_needed) or e.understaffed_decision = 'run' then 'confirmed'
      else 'understaffed'
    end;
  perform set_config('mesa.system_update', 'on', true);
  update public.events set status = next_status where id = event and status is distinct from next_status;
  perform set_config('mesa.system_update', 'off', true);
end;
$$;

create or replace function public.confirm_allocation(cycle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  perform private.require_cycle(cycle, array['allocated']::public.cycle_status[]);
  update public.events ev set status = case
      when s.oc = 0 and s.helpers = 0 then 'dropped'
      when s.oc < ev.ocs_needed or s.helpers < ev.helpers_needed then 'understaffed'
      else 'confirmed'
    end::public.event_status
  from (
    select x.id,
      (select count(*) from public.assignments a where a.event_id = x.id and a.status = 'active' and a.role = 'oc') as oc,
      (select count(*) from public.assignments a where a.event_id = x.id and a.status = 'active' and a.role = 'helper') as helpers
    from public.events x where x.cycle_id = cycle and x.status = 'scheduled'
  ) s
  where ev.id = s.id;
  update public.planning_cycles set status = 'confirmed', confirmed_at = now(), confirmed_by = public.auth_email() where id = cycle;
  for e in select id from public.events where cycle_id = cycle and status in ('confirmed', 'understaffed') loop
    perform private.request_chat_space(e.id);
  end loop;
end;
$$;

create or replace function public.reopen_event(event uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  oc integer;
  helpers integer;
  next_status public.event_status;
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team reopens events' using errcode = '42501';
  end if;
  select * into e from public.events where id = event for update;
  if not found or e.status <> 'cancelled' then
    raise exception 'Only cancelled events can be reopened' using errcode = '22023';
  end if;
  if e.starts_at <= now() then
    raise exception 'The event has already started' using errcode = '22023';
  end if;
  select count(*) filter (where role = 'oc'), count(*) filter (where role = 'helper') into oc, helpers
  from public.assignments where event_id = event and status = 'active';
  next_status := case when oc < e.ocs_needed or helpers < e.helpers_needed then 'understaffed' else 'confirmed' end;
  perform set_config('mesa.system_update', 'on', true);
  update public.events
  set status = next_status, cancelled_at = null, cancelled_by = null, cancel_reason = null,
      cancellation_noted_at = null, cancellation_noted_by = null
  where id = event;
  perform set_config('mesa.system_update', 'off', true);
  perform private.enqueue_job('chat.event_status',
    jsonb_build_object('event_id', event, 'kind', 'reopened', 'at', now()),
    'chat.event_status:reopened:' || event || ':' || (extract(epoch from e.cancelled_at) * 1000000)::bigint, event);
  if e.chat_space_requested_at is null then
    perform private.request_chat_space(event);
  end if;
  return next_status::text;
end;
$$;

-- Open slots: OC slots below ocs_needed, helpers below helpers_needed.
create or replace function public.open_slots()
returns table (event_id uuid, open_oc boolean, open_helpers integer)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select e.id,
           (select count(*) from public.assignments a where a.event_id = e.id and a.role = 'oc' and a.status = 'active') < e.ocs_needed,
           greatest(0, e.helpers_needed - (
             select count(*) from public.assignments a where a.event_id = e.id and a.role = 'helper' and a.status = 'active'
           ))::integer
    from public.events e
    where public.is_workspace_member()
      and e.status in ('confirmed', 'understaffed')
      and e.starts_at > now()
      and public.roster_published(e.id)
  ) s (event_id, open_oc, open_helpers)
  where s.open_oc or s.open_helpers > 0;
$$;

-- ── Partners on ideas ───────────────────────────────────────────────────────
create table public.idea_partners (
  idea_id      uuid not null references public.event_ideas(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         text not null constraint idea_partners_role_check check (role in ('oc', 'helper')),
  status       text not null default 'invited' constraint idea_partners_status_check check (status in ('invited', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (idea_id, profile_id)
);
create index idea_partners_profile_idx on public.idea_partners(profile_id);
alter table public.idea_partners enable row level security;
revoke all on public.idea_partners from anon;
-- The two read policies look at each other's table through these definer
-- helpers (policies that query each other directly recurse).
create or replace function public.is_idea_proposer(idea uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.event_ideas i where i.id = idea and i.proposer_id = auth.uid());
$$;
create or replace function public.is_idea_partner(idea uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.idea_partners p where p.idea_id = idea and p.profile_id = auth.uid());
$$;
revoke all on function public.is_idea_proposer(uuid), public.is_idea_partner(uuid) from public, anon;
grant execute on function public.is_idea_proposer(uuid), public.is_idea_partner(uuid) to authenticated;

-- Changes only through the functions below.
create policy "Partners, the proposer and teams read partners"
  on public.idea_partners for select to authenticated
  using (public.is_team() or (public.is_workspace_member() and (profile_id = auth.uid() or public.is_idea_proposer(idea_id))));

-- Partners may read the idea they are asked to join.
create policy "Partners read their ideas"
  on public.event_ideas for select to authenticated
  using (public.is_workspace_member() and public.is_idea_partner(id));

-- The proposer (or the Events team) sets an open idea's partners: [{profile_id, role}].
-- Unchanged partners keep their answer; a new role asks again.
create or replace function public.set_idea_partners(idea uuid, partners jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.event_ideas;
begin
  select * into i from public.event_ideas where id = idea for update;
  if not found or not public.is_workspace_member() or (i.proposer_id <> auth.uid() and not public.has_role('events')) then
    raise exception 'Only the proposer names partners' using errcode = '42501';
  end if;
  if i.status <> 'proposed' then
    raise exception 'Partners can only be changed while the idea is open' using errcode = '22023';
  end if;
  if jsonb_typeof(partners) <> 'array' or jsonb_array_length(partners) > 5 then
    raise exception 'At most five partners' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(partners) x
    where x ->> 'role' not in ('oc', 'helper')
       or (x ->> 'profile_id')::uuid = i.proposer_id
       or not exists (select 1 from public.profiles p where p.id = (x ->> 'profile_id')::uuid)
  ) or (select count(distinct x ->> 'profile_id') from jsonb_array_elements(partners) x) <> jsonb_array_length(partners) then
    raise exception 'Invalid partners' using errcode = '22023';
  end if;
  delete from public.idea_partners p
  where p.idea_id = idea
    and not exists (select 1 from jsonb_array_elements(partners) x where (x ->> 'profile_id')::uuid = p.profile_id and x ->> 'role' = p.role);
  insert into public.idea_partners (idea_id, profile_id, role)
  select idea, (x ->> 'profile_id')::uuid, x ->> 'role' from jsonb_array_elements(partners) x
  on conflict (idea_id, profile_id) do nothing;
end;
$$;
revoke all on function public.set_idea_partners(uuid, jsonb) from public, anon;
grant execute on function public.set_idea_partners(uuid, jsonb) to authenticated;

-- A partner accepts or declines – while the idea is open, or until its month is allocated.
create or replace function public.respond_idea_partner(idea uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.event_ideas;
  cycle_status public.cycle_status;
begin
  select * into i from public.event_ideas where id = idea;
  if not found or not exists (select 1 from public.idea_partners p where p.idea_id = idea and p.profile_id = auth.uid()) then
    raise exception 'You are not asked to join this idea' using errcode = '42501';
  end if;
  if i.status = 'accepted' then
    select c.status into cycle_status from public.events e join public.planning_cycles c on c.id = e.cycle_id where e.id = i.event_id;
  end if;
  if not (i.status = 'proposed' or (i.status = 'accepted' and cycle_status in ('planning', 'form_open', 'form_closed'))) then
    raise exception 'Too late to answer: the roster is made already' using errcode = '22023';
  end if;
  update public.idea_partners set status = case when accept then 'accepted' else 'declined' end, responded_at = now()
  where idea_id = idea and profile_id = auth.uid();
end;
$$;
revoke all on function public.respond_idea_partner(uuid, boolean) from public, anon;
grant execute on function public.respond_idea_partner(uuid, boolean) to authenticated;

-- Who is on an event of the cycle before the allocation: the proposer who
-- OCs it and the accepted partners of its idea. Members see them on the form.
create or replace function public.event_fixed_people(cycle uuid)
returns table (event_id uuid, profile_id uuid, role text, full_name text, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.proposed_by, 'oc', p.full_name, 'proposer'
  from public.events e join public.profiles p on p.id = e.proposed_by
  where e.cycle_id = cycle and public.is_workspace_member()
  union all
  select e.id, ip.profile_id, ip.role, p.full_name, 'partner'
  from public.events e
  join public.event_ideas i on i.event_id = e.id and i.status = 'accepted'
  join public.idea_partners ip on ip.idea_id = i.id and ip.status = 'accepted'
  join public.profiles p on p.id = ip.profile_id
  where e.cycle_id = cycle and public.is_workspace_member()
    and ip.profile_id is distinct from e.proposed_by;
$$;
revoke all on function public.event_fixed_people(uuid) from public, anon;
grant execute on function public.event_fixed_people(uuid) to authenticated;

-- The event takes the idea's OCs needed – at least the proposer (if they
-- OC) plus the co-OCs asked.
create or replace function public.accept_idea(
  idea uuid, cycle uuid, event_type public.event_type, starts timestamptz, helpers smallint default null,
  category uuid default null, format uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.event_ideas;
  c public.planning_cycles;
  f public.event_formats;
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
  select * into f from public.event_formats where id = coalesce(format, i.format_id);
  insert into public.events (cycle_id, title, type, starts_at, helpers_needed, ocs_needed, proposed_by, status, category_id, format_id, location, meeting_point)
  values (cycle, i.title, event_type, starts, coalesce(helpers, i.helpers_needed),
          least(10, greatest(i.ocs_needed, i.wants_to_oc::integer
            + (select count(*) from public.idea_partners p where p.idea_id = idea and p.role = 'oc' and p.status <> 'declined')::integer)),
          case when i.wants_to_oc then i.proposer_id end,
          case when c.status = 'form_open' then 'scheduled' else 'draft' end::public.event_status,
          coalesce(category, i.category_id), f.id, f.location, f.meeting_point)
  returning id into new_event;
  update public.event_ideas set status = 'accepted', event_id = new_event,
         category_id = coalesce(category, category_id), format_id = coalesce(format, format_id)
  where id = idea;
  return new_event;
end;
$$;

-- ── The volunteer form ──────────────────────────────────────────────────────
create or replace function public.submit_volunteer_form(cycle uuid, choices jsonb, note text default '', max_events smallint default null, max_oc smallint default null)
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
    -- Someone already on the event (proposer, partner) answers nothing for it.
    if exists (select 1 from public.event_fixed_people(cycle) f where f.event_id = (ch ->> 'event_id')::uuid and f.profile_id = auth.uid()) then
      raise exception 'You are on event % already (your idea)', ch ->> 'event_id' using errcode = '22023';
    end if;
    -- The OC slots are taken already: no OC answers.
    if nullif(ch ->> 'oc_rank', '') is not null and (
      select count(*) from public.event_fixed_people(cycle) f where f.event_id = (ch ->> 'event_id')::uuid and f.role = 'oc'
    ) >= (select e.ocs_needed from public.events e where e.id = (ch ->> 'event_id')::uuid) then
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

-- ── Reset demo data ─────────────────────────────────────────────────────────
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'advertising_pictures', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'calendar_feeds',
    'cancellation_requests', 'cash_box_changes', 'cash_boxes', 'cash_reports', 'description_versions', 'descriptions',
    'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_formats', 'event_ideas', 'event_photo_folders',
    'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages',
    'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files', 'fake_drive_folders',
    'fake_telegram_messages', 'finance_entries', 'idea_partners', 'internal_attendance', 'internal_event_people', 'internal_events', 'jobs',
    'participants', 'payout_batches', 'payout_details', 'planning_cycles', 'preapprovals',
    'profile_payout_details', 'publication_post_events', 'publication_posts', 'receipts',
    'reimbursements', 'reviews', 'trip_budgets', 'volunteer_choices', 'volunteer_responses'
  ]) as t
  union all
  -- reimbursement_policies/rules: versions after the first are removed;
  -- role_members: demo members' rows are removed.
  select t, 'keep' from unnest(array[
    'app_settings', 'event_categories', 'finance_categories', 'internal_kind_settings', 'organiser_acknowledgements', 'profiles',
    'publication_channels', 'reimbursement_policies', 'reimbursement_rules', 'role_members'
  ]) as t;
$$;
revoke all on function private.staging_wipe_lists() from public, anon, authenticated;
