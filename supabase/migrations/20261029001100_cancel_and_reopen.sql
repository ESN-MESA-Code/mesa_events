-- ============================================================
-- MESA Events Platform – cancelling tells the team; Events can reopen
-- (review 2026-10-29, A2)
--
-- Cancelling only flipped the status: the helpers, the Chat space, Comms
-- (whose description may already be out) and the Events team learnt
-- nothing, and it could not be undone.
-- * cancel_event(): the Events team cancels a running event (any reason),
--   the OC an under-staffed one (decide_understaffed(…, 'cancel')). Who,
--   when and why are stored; a Chat message goes to the event's space with
--   OC and helpers mentioned (jobs queue, one idempotency key per
--   cancellation; without a space they get direct messages).
-- * Comms sees cancelled events whose description was published on its
--   dashboard and decides whether to post a correction
--   (note_cancellation() marks it handled).
-- * reopen_event(): the Events team only, back to the status the staffing
--   gives; the space is told. Both are logged (activity_log).
-- Registered receipts stay valid: claims are untouched.
-- ============================================================

alter table public.events
  add column cancelled_at          timestamptz,
  add column cancelled_by          text,
  add column cancel_reason         text constraint events_cancel_reason_check check (length(cancel_reason) <= 300),
  add column cancellation_noted_at timestamptz,
  add column cancellation_noted_by text;

-- Status changes to and from "cancelled", the decision and the
-- cancellation columns are written only by the definer functions.
create or replace function public.guard_event_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or coalesce(current_setting('mesa.system_update', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'cancelled'
       or (new.understaffed_decision, new.understaffed_decided_by, new.understaffed_decided_at,
           new.cancelled_at, new.cancelled_by, new.cancel_reason, new.cancellation_noted_at, new.cancellation_noted_by)
          is distinct from (null::text, null::text, null::timestamptz, null::timestamptz, null::text, null::text, null::timestamptz, null::text) then
      raise exception 'The decision is made on the event page' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.understaffed_decision, new.understaffed_decided_by, new.understaffed_decided_at)
     is distinct from (old.understaffed_decision, old.understaffed_decided_by, old.understaffed_decided_at) then
    raise exception 'The decision is made on the event page' using errcode = '42501';
  end if;
  if (new.cancelled_at, new.cancelled_by, new.cancel_reason, new.cancellation_noted_at, new.cancellation_noted_by)
     is distinct from (old.cancelled_at, old.cancelled_by, old.cancel_reason, old.cancellation_noted_at, old.cancellation_noted_by)
     or (new.status is distinct from old.status and 'cancelled' in (new.status, old.status)) then
    raise exception 'Cancel or reopen the event on its page' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_decision() from public, anon, authenticated;

-- The cancellation itself (callers check who may).
create or replace function private.cancel_event(event uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
begin
  select * into e from public.events where id = event for update;
  if not found or e.status not in ('confirmed', 'understaffed') then
    raise exception 'Only planned events that are running can be cancelled' using errcode = '22023';
  end if;
  if e.starts_at <= now() then
    raise exception 'The event has already started' using errcode = '22023';
  end if;
  perform set_config('mesa.system_update', 'on', true);
  update public.events
  set status = 'cancelled', cancelled_at = now(), cancelled_by = public.auth_email(),
      cancel_reason = left(nullif(trim(reason), ''), 300),
      cancellation_noted_at = null, cancellation_noted_by = null,
      understaffed_decision = null, understaffed_decided_by = null, understaffed_decided_at = null
  where id = event
  returning * into e;
  perform set_config('mesa.system_update', 'off', true);
  perform private.enqueue_job('chat.event_status',
    jsonb_build_object('event_id', event, 'kind', 'cancelled', 'at', e.cancelled_at),
    'chat.event_status:cancelled:' || event || ':' || (extract(epoch from e.cancelled_at) * 1000000)::bigint, event);
end;
$$;
revoke all on function private.cancel_event(uuid, text) from public, anon, authenticated;

-- The Events team cancels any running event; the OC an under-staffed one
-- (decide_understaffed).
create or replace function public.cancel_event(event uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('events') then
    if public.is_event_oc(event) then
      raise exception 'As OC you can cancel the event when it is short of people; otherwise ask the Events team' using errcode = '42501';
    end if;
    raise exception 'Only the Events team cancels events' using errcode = '42501';
  end if;
  perform private.cancel_event(event, reason);
end;
$$;
revoke all on function public.cancel_event(uuid, text) from public, anon;
grant execute on function public.cancel_event(uuid, text) to authenticated;

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

-- The Events team reopens a cancelled event that has not started yet.
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
  next_status := case when oc = 0 or helpers < e.helpers_needed then 'understaffed' else 'confirmed' end;
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
revoke all on function public.reopen_event(uuid) from public, anon;
grant execute on function public.reopen_event(uuid) to authenticated;

-- Comms has looked at a cancelled event whose description was published
-- (and posted a correction or decided not to).
create or replace function public.note_cancellation(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team does this' using errcode = '42501';
  end if;
  perform set_config('mesa.system_update', 'on', true);
  update public.events set cancellation_noted_at = now(), cancellation_noted_by = public.auth_email()
  where id = event and status = 'cancelled';
  get diagnostics n = row_count;
  perform set_config('mesa.system_update', 'off', true);
  if n = 0 then
    raise exception 'The event is not cancelled' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.note_cancellation(uuid) from public, anon;
grant execute on function public.note_cancellation(uuid) to authenticated;
