-- ============================================================
-- MESA Events Platform – "Remind OC" on the Comms page
-- (brief 2026-10-29, C)
--
-- The Comms page is organised by each event's stage; where the OC has to
-- act (write the description, write the event report) Comms – or the Events
-- team – can remind them in one click. The reminder goes out through the
-- jobs queue (chat.remind_oc): to the event's Chat space @-mentioning the
-- OC, or as a direct message without a space. At most one reminder per
-- event, topic and Berlin day (idempotency key); each one is logged.
-- ============================================================

create or replace function public.remind_oc(event uuid, about text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  key text;
begin
  if not (public.has_role('comms') or public.has_role('events')) then
    raise exception 'Only the Comms and Events teams send reminders' using errcode = '42501';
  end if;
  if about not in ('description', 'report') then
    raise exception 'Unknown reminder' using errcode = '22023';
  end if;
  select * into e from public.events where id = event;
  if not found or e.status not in ('confirmed', 'understaffed', 'completed') then
    raise exception 'This event does not run' using errcode = '22023';
  end if;
  if about = 'description' and exists (select 1 from public.descriptions d where d.event_id = event and d.status in ('submitted', 'approved', 'published')) then
    raise exception 'The description is already in' using errcode = '22023';
  end if;
  if about = 'report' and (e.starts_at > now() or exists (select 1 from public.event_reports r where r.event_id = event)) then
    raise exception 'No report is due' using errcode = '22023';
  end if;
  key := 'chat.remind_oc:' || about || ':' || event || ':' || (now() at time zone 'Europe/Berlin')::date;
  if exists (select 1 from public.jobs j where j.idempotency_key = key) then
    return false; -- already reminded today
  end if;
  perform private.enqueue_job('chat.remind_oc', jsonb_build_object('event_id', event, 'about', about), key, event);
  perform private.log('events', event::text, 'remind', event, e.cycle_id, jsonb_build_object('reminded', about));
  return true;
end;
$$;
revoke all on function public.remind_oc(uuid, text) from public, anon;
grant execute on function public.remind_oc(uuid, text) to authenticated;
