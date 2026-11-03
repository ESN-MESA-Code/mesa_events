-- ============================================================
-- MESA Events Platform – the Events team decides cancellations (round 2026-11-03)
--
-- * An OC no longer cancels an event: they ask the Events team
--   (request_cancellation(), a reason required). The request is recorded –
--   the event runs until the Events team cancels it or keeps it on
--   (decide_cancellation()) – and the Events team is @-mentioned in the
--   event's Chat space, so nobody can miss it and "but I asked" can be
--   checked. The OC can withdraw an open request. Under-staffed events:
--   the OC still decides "run anyway"; cancelling goes through a request.
-- * No event takes place without a description: one never sent by the
--   deadline cancels the event (as before); one Comms sent back has to be
--   sent again within N days (app_settings.description_fix_days, default
--   4) – not before the deadline – else the event is cancelled too, at the
--   latest 24 hours before it starts.
-- ============================================================

-- ── Cancellation requests ───────────────────────────────────────────────────
create table public.cancellation_requests (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  requested_by  text not null,
  reason        text not null constraint cancellation_requests_reason_check check (length(trim(reason)) between 1 and 300),
  requested_at  timestamptz not null default now(),
  decision      text constraint cancellation_requests_decision_check check (decision in ('cancelled', 'declined', 'withdrawn')),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text constraint cancellation_requests_note_check check (length(decision_note) <= 300)
);
-- One open request per event.
create unique index cancellation_requests_open_idx on public.cancellation_requests(event_id) where decision is null;

alter table public.cancellation_requests enable row level security;
create policy "Teams and the event's staff read the requests"
  on public.cancellation_requests for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id));
revoke insert, update, delete, truncate on public.cancellation_requests from anon, authenticated;
revoke all on public.cancellation_requests from anon;

create or replace function public.request_cancellation(event uuid, reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  r public.cancellation_requests;
begin
  if not public.is_event_oc(event) then
    raise exception 'Only the event''s OC asks the Events team to cancel' using errcode = '42501';
  end if;
  if coalesce(trim(reason), '') = '' then
    raise exception 'Say why the event should be cancelled' using errcode = '22023';
  end if;
  select * into e from public.events where id = event;
  if not found or e.status not in ('confirmed', 'understaffed') or e.starts_at <= now() then
    raise exception 'Only an event that is still ahead can be cancelled' using errcode = '22023';
  end if;
  if exists (select 1 from public.cancellation_requests c where c.event_id = event and c.decision is null) then
    raise exception 'The Events team already has a request for this event' using errcode = '22023';
  end if;
  insert into public.cancellation_requests (event_id, requested_by, reason)
  values (event, public.auth_email(), left(trim(reason), 300))
  returning * into r;
  perform private.log('events', event::text, 'cancellation_requested', event, e.cycle_id, jsonb_build_object('reason', r.reason));
  perform private.enqueue_job('chat.cancellation', jsonb_build_object('request_id', r.id, 'kind', 'requested'), 'chat.cancellation:requested:' || r.id, event);
  return r.id;
end;
$$;
revoke all on function public.request_cancellation(uuid, text) from public, anon;
grant execute on function public.request_cancellation(uuid, text) to authenticated;

-- The Events team cancels the event or keeps it on (with a note for the OC); the OC withdraws.
create or replace function public.decide_cancellation(request uuid, decision text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cancellation_requests;
begin
  if decision not in ('cancelled', 'declined', 'withdrawn') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  select * into r from public.cancellation_requests where id = request for update;
  if not found or r.decision is not null then
    raise exception 'This request is already decided' using errcode = '22023';
  end if;
  if decision = 'withdrawn' then
    if not public.is_event_oc(r.event_id) then
      raise exception 'Only the event''s OC withdraws the request' using errcode = '42501';
    end if;
  elsif not public.has_role('events') then
    raise exception 'Only the Events team decides cancellations' using errcode = '42501';
  end if;
  if decision = 'declined' and coalesce(trim(note), '') = '' then
    raise exception 'Tell the OC why the event stays on' using errcode = '22023';
  end if;
  update public.cancellation_requests
  set decision = decide_cancellation.decision, decided_by = public.auth_email(), decided_at = now(), decision_note = left(nullif(trim(note), ''), 300)
  where id = request;
  if decision = 'cancelled' then
    -- The cancellation tells the Chat space (chat.event_status).
    perform private.cancel_event(r.event_id, coalesce(nullif(trim(note), ''), r.reason));
  elsif decision = 'declined' then
    perform private.enqueue_job('chat.cancellation', jsonb_build_object('request_id', r.id, 'kind', 'declined'), 'chat.cancellation:declined:' || r.id, r.event_id);
  end if;
  perform private.log('events', r.event_id::text, 'cancellation_' || decision, r.event_id, null, jsonb_build_object('note', nullif(trim(note), '')));
end;
$$;
revoke all on function public.decide_cancellation(uuid, text, text) from public, anon;
grant execute on function public.decide_cancellation(uuid, text, text) to authenticated;

-- Cancelled another way (the Events team directly, a deadline): the open request is settled.
create or replace function private.settle_cancellation_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.cancellation_requests
    set decision = 'cancelled', decided_by = coalesce(new.cancelled_by, public.auth_email()), decided_at = now()
    where event_id = new.id and decision is null;
  end if;
  return new;
end;
$$;
revoke all on function private.settle_cancellation_requests() from public, anon, authenticated;
create trigger settle_cancellation_requests after update of status on public.events
  for each row execute function private.settle_cancellation_requests();

-- The OC asks instead of cancelling.
create or replace function public.cancel_event(event uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('events') then
    if public.is_event_oc(event) then
      raise exception 'As OC you ask the Events team to cancel – on the event page' using errcode = '42501';
    end if;
    raise exception 'Only the Events team cancels events' using errcode = '42501';
  end if;
  perform private.cancel_event(event, reason);
end;
$$;

create or replace function public.decide_understaffed(event uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
begin
  if decision not in ('run', 'cancel') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if not (public.has_role('events') or public.is_event_oc(event)) then
    raise exception 'Only the event''s OC or the Events team decides this' using errcode = '42501';
  end if;
  if decision = 'cancel' and not public.has_role('events') then
    raise exception 'As OC you ask the Events team to cancel – on the event page' using errcode = '42501';
  end if;
  select * into e from public.events where id = event for update;
  if not found then
    raise exception 'No such event' using errcode = '22023';
  end if;
  if e.status <> 'understaffed' then
    raise exception 'Only under-staffed events need this decision' using errcode = '22023';
  end if;
  if decision = 'cancel' then
    perform private.cancel_event(event, 'Not enough people');
    return;
  end if;
  if not exists (select 1 from public.assignments a where a.event_id = event and a.status = 'active' and a.role = 'oc') then
    raise exception 'The event needs an OC to run – assign one or cancel it' using errcode = '22023';
  end if;
  perform set_config('mesa.system_update', 'on', true);
  update public.events
  set status = 'confirmed', understaffed_decision = 'run', understaffed_decided_by = public.auth_email(), understaffed_decided_at = now()
  where id = event;
  perform set_config('mesa.system_update', 'off', true);
end;
$$;

-- ── A description sent back: N days to send it again ────────────────────────
insert into public.app_settings (key, value) values ('description_fix_days', '4') on conflict (key) do nothing;

create or replace function public.guard_description_fix_days_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key = 'description_fix_days'
     and (jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::numeric <> trunc((new.value #>> '{}')::numeric)
          or (new.value #>> '{}')::int not between 1 and 14) then
    raise exception 'Days to fix a description: a whole number from 1 to 14' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_description_fix_days_setting() from public, anon, authenticated;
create trigger guard_description_fix_days_setting before insert or update on public.app_settings
  for each row execute function public.guard_description_fix_days_setting();

-- When the description of `event` is due: the cycle's deadline; once Comms
-- sent it back, N days after that (not before the deadline); at the latest
-- 24 hours before the start. Null without a deadline or when it is in.
create or replace function private.description_due_at(event uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.description_deadline is null or coalesce(d.status, 'missing') in ('submitted', 'approved', 'published') then null
    when d.submitted_at is null then c.description_deadline
    else least(
      greatest(c.description_deadline,
               coalesce((select max(r.created_at) from public.reviews r where r.event_id = e.id and r.decision = 'changes_requested'), d.submitted_at)
               + make_interval(days => coalesce((select (s.value #>> '{}')::int from public.app_settings s where s.key = 'description_fix_days'), 4))),
      e.starts_at - interval '24 hours')
  end
  from public.events e
  join public.planning_cycles c on c.id = e.cycle_id
  left join public.descriptions d on d.event_id = e.id
  where e.id = event;
$$;
revoke all on function private.description_due_at(uuid) from public, anon, authenticated;

-- The due moments for the pages (teams and the event's staff).
create or replace function public.description_due(events uuid[])
returns table (event_id uuid, due_at timestamptz, sent_back boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, private.description_due_at(e.id), coalesce(d.submitted_at is not null and d.status in ('draft', 'changes_requested'), false)
  from public.events e
  left join public.descriptions d on d.event_id = e.id
  where e.id = any(events)
    and (public.is_team() or public.is_event_staff(e.id));
$$;
revoke all on function public.description_due(uuid[]) from public, anon;
grant execute on function public.description_due(uuid[]) to authenticated;

-- Cancels the events whose description is overdue: never sent by the
-- deadline, or not sent again in time after Comms sent it back.
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
    select e.id, d.submitted_at
    from public.events e
    join public.planning_cycles c on c.id = e.cycle_id
    left join public.descriptions d on d.event_id = e.id
    where c.description_deadline is not null
      and c.description_deadline <= now()
      and e.status in ('confirmed', 'understaffed')
      and e.starts_at > now()
      and coalesce(d.status, 'missing') in ('missing', 'draft', 'changes_requested')
      and private.description_due_at(e.id) <= now()
    for update of e skip locked
  loop
    perform private.cancel_event(ev.id, case when ev.submitted_at is null
      then 'Description not submitted by the deadline'
      else 'Description not sent again in time after Comms asked for changes' end);
    perform set_config('mesa.system_update', 'on', true);
    update public.events set cancelled_by = 'description deadline' where id = ev.id;
    perform set_config('mesa.system_update', 'off', true);
    n := n + 1;
  end loop;
  return n;
end;
$$;
