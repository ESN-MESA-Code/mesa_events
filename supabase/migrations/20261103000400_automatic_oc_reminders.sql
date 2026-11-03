-- ============================================================
-- MESA Events Platform – automatic reminders to the OC (round 2026-11-03)
--
-- The Events team no longer reminds OCs by hand ("Remind OC" is gone, so
-- is remind_oc()): a job checks every 15 minutes and reminds in Chat
--   * description: from N days before the cycle's description deadline,
--     every M days, while the description is not in and the event ahead;
--   * hand-in: from N days after the event, every M days, at most K times,
--     while the attendance list, the photos or the event report is missing.
-- Only between 10:00 and 20:00 Berlin time, at most once a Berlin day per
-- event and topic. The days are an admin setting (app_settings.oc_reminders);
-- 0 days switches a reminder off. Receipts are Finance's: not part of it.
-- It replaces remind_due_descriptions() (the day before the deadline).
-- ============================================================

insert into public.app_settings (key, value)
values ('oc_reminders', '{"description_days_before": 3, "description_every_days": 1, "handin_days_after": 1, "handin_every_days": 3, "handin_max": 3}')
on conflict (key) do nothing;

-- The setting must stay usable: whole days, in range.
create or replace function public.guard_oc_reminders_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := new.value;
  k text;
begin
  if new.key <> 'oc_reminders' then
    return new;
  end if;
  if jsonb_typeof(v) <> 'object' then
    raise exception 'The reminders need an object' using errcode = '22023';
  end if;
  foreach k in array array['description_days_before', 'description_every_days', 'handin_days_after', 'handin_every_days', 'handin_max'] loop
    if jsonb_typeof(v -> k) <> 'number' or (v ->> k)::numeric <> trunc((v ->> k)::numeric) then
      raise exception 'The reminders need % as a whole number', k using errcode = '22023';
    end if;
  end loop;
  if not ((v ->> 'description_days_before')::int between 0 and 14 and (v ->> 'description_every_days')::int between 1 and 14
          and (v ->> 'handin_days_after')::int between 0 and 14 and (v ->> 'handin_every_days')::int between 1 and 14
          and (v ->> 'handin_max')::int between 1 and 10) then
    raise exception 'Reminder days: start 0–14 (0 = off), every 1–14, at most 1–10 hand-in reminders' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_oc_reminders_setting() from public, anon, authenticated;
create trigger guard_oc_reminders_setting before insert or update on public.app_settings
  for each row execute function public.guard_oc_reminders_setting();

-- The last reminder (any, also the old manual and day-before ones) and how many there were.
create or replace function private.oc_reminders_sent(event uuid, about text)
returns table (last_at timestamptz, sent integer)
language sql
stable
security definer
set search_path = ''
as $$
  select max(j.created_at), count(*)::integer
  from public.jobs j
  where j.kind = 'chat.remind_oc'
    and j.event_id = event
    and (j.idempotency_key like 'chat.remind_oc:' || about || ':%'
         -- The old manual "report" reminders count as hand-in ones.
         or (about = 'handin' and j.idempotency_key like 'chat.remind_oc:report:%'));
$$;
revoke all on function private.oc_reminders_sent(uuid, text) from public, anon, authenticated;

-- Sends what is due at `at` (the clock; tests pass one). Returns how many.
create or replace function public.send_oc_reminders(at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s jsonb := coalesce((select v.value from public.app_settings v where v.key = 'oc_reminders'),
                      '{"description_days_before": 3, "description_every_days": 1, "handin_days_after": 1, "handin_every_days": 3, "handin_max": 3}');
  today date := (at at time zone 'Europe/Berlin')::date;
  hour int := extract(hour from at at time zone 'Europe/Berlin')::int;
  ev record;
  prev record;
  key text;
  n integer := 0;
begin
  if hour < 10 or hour >= 20 then
    return 0;
  end if;

  -- Descriptions: not in, the event ahead, the deadline close (or passed: sent back for changes).
  if (s ->> 'description_days_before')::int > 0 then
    for ev in
      select e.id, e.cycle_id
      from public.events e
      join public.planning_cycles c on c.id = e.cycle_id
      where c.status = 'confirmed'
        and c.description_deadline is not null
        and (c.description_deadline at time zone 'Europe/Berlin')::date - today <= (s ->> 'description_days_before')::int
        and e.status in ('confirmed', 'understaffed')
        and e.starts_at > at
        and not exists (select 1 from public.descriptions d where d.event_id = e.id and d.status in ('submitted', 'approved', 'published'))
    loop
      select * into prev from private.oc_reminders_sent(ev.id, 'description');
      continue when prev.last_at is not null and today - (prev.last_at at time zone 'Europe/Berlin')::date < (s ->> 'description_every_days')::int;
      key := 'chat.remind_oc:description:' || ev.id || ':' || today;
      continue when exists (select 1 from public.jobs j where j.idempotency_key = key);
      perform private.enqueue_job('chat.remind_oc', jsonb_build_object('event_id', ev.id, 'about', 'description'), key, ev.id);
      perform private.log('events', ev.id::text, 'remind', ev.id, ev.cycle_id, jsonb_build_object('reminded', 'description', 'automatic', true));
      n := n + 1;
    end loop;
  end if;

  -- Hand-in: the event is over, something is missing, within the reminders' window.
  if (s ->> 'handin_days_after')::int > 0 then
    for ev in
      select e.id, e.cycle_id
      from public.events e
      left join public.attendance_lists l on l.event_id = e.id
      where e.status in ('confirmed', 'understaffed', 'completed')
        and coalesce(e.ends_at, e.starts_at) < at
        and today - (coalesce(e.ends_at, e.starts_at) at time zone 'Europe/Berlin')::date
            between (s ->> 'handin_days_after')::int
                and (s ->> 'handin_days_after')::int + (s ->> 'handin_every_days')::int * (s ->> 'handin_max')::int
        and (l.signed_off_at is null
             or not private.photos_in(e.id)
             or not exists (select 1 from public.event_reports r where r.event_id = e.id))
    loop
      select * into prev from private.oc_reminders_sent(ev.id, 'handin');
      continue when prev.sent >= (s ->> 'handin_max')::int;
      continue when prev.last_at is not null and today - (prev.last_at at time zone 'Europe/Berlin')::date < (s ->> 'handin_every_days')::int;
      key := 'chat.remind_oc:handin:' || ev.id || ':' || today;
      continue when exists (select 1 from public.jobs j where j.idempotency_key = key);
      perform private.enqueue_job('chat.remind_oc', jsonb_build_object('event_id', ev.id, 'about', 'handin'), key, ev.id);
      perform private.log('events', ev.id::text, 'remind', ev.id, ev.cycle_id, jsonb_build_object('reminded', 'handin', 'automatic', true));
      n := n + 1;
    end loop;
  end if;
  return n;
end;
$$;
revoke all on function public.send_oc_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.send_oc_reminders(timestamptz) to service_role;

select cron.unschedule('remind-due-descriptions') where exists (select 1 from cron.job where jobname = 'remind-due-descriptions');
drop function if exists public.remind_due_descriptions(timestamptz);
drop function if exists public.remind_oc(uuid, text);
select cron.schedule('send-oc-reminders', '*/15 * * * *', 'select public.send_oc_reminders()');
