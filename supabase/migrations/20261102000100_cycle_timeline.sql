-- ============================================================
-- MESA Events Platform – the cycle's fixed timeline (round 2026-11-02)
--
-- In the month before the events' month:
--   7th  last day to propose ideas for the month (23:59)
--   10th the volunteer form opens (09:00)
--   15th last day to sign up as OC or helper (23:59)
--   20th last day to submit descriptions (23:59)
-- The days are an admin setting (app_settings.cycle_timeline); lib/timeline.ts
-- computes the same instants for the pages.
--
-- * Ideas: a member can no longer propose (or move) an idea into a month
--   whose ideas deadline passed – any later month stays open (ideas for
--   next year are welcome). The Events team is not bound.
-- * The volunteer form opens by itself on its day, for a cycle still
--   planning that has events on the schedule, closing on the 15th.
-- * Confirming the roster sets the description deadline to the 20th when
--   none is set and the 20th still lies ahead (and before the first event).
-- * The day before a cycle's description deadline, the OCs whose
--   description is not in get a Chat reminder (once).
-- ============================================================

insert into public.app_settings (key, value)
values ('cycle_timeline', '{"ideas_due": 7, "form_opens": 10, "form_closes": 15, "descriptions_due": 20}')
on conflict (key) do nothing;

-- The setting must stay usable: whole days 1–28, in order.
create or replace function public.guard_cycle_timeline_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := new.value;
begin
  if new.key <> 'cycle_timeline' then
    return new;
  end if;
  if jsonb_typeof(v) <> 'object'
     or not (v ?& array['ideas_due', 'form_opens', 'form_closes', 'descriptions_due'])
     or jsonb_typeof(v -> 'ideas_due') <> 'number' or jsonb_typeof(v -> 'form_opens') <> 'number'
     or jsonb_typeof(v -> 'form_closes') <> 'number' or jsonb_typeof(v -> 'descriptions_due') <> 'number' then
    raise exception 'The timeline needs ideas_due, form_opens, form_closes and descriptions_due' using errcode = '22023';
  end if;
  if not ((v ->> 'ideas_due')::numeric between 1 and 28 and (v ->> 'descriptions_due')::numeric between 1 and 28
          and (v ->> 'ideas_due')::numeric = trunc((v ->> 'ideas_due')::numeric)
          and (v ->> 'form_opens')::numeric = trunc((v ->> 'form_opens')::numeric)
          and (v ->> 'form_closes')::numeric = trunc((v ->> 'form_closes')::numeric)
          and (v ->> 'descriptions_due')::numeric = trunc((v ->> 'descriptions_due')::numeric)
          and (v ->> 'ideas_due')::numeric < (v ->> 'form_opens')::numeric
          and (v ->> 'form_opens')::numeric < (v ->> 'form_closes')::numeric
          and (v ->> 'form_closes')::numeric < (v ->> 'descriptions_due')::numeric) then
    raise exception 'The days must be whole numbers from 1 to 28, in order: ideas, form opens, form closes, descriptions' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_cycle_timeline_setting() from public, anon, authenticated;
create trigger guard_cycle_timeline_setting before insert or update on public.app_settings
  for each row execute function public.guard_cycle_timeline_setting();

-- The instants of the cycle for `month` (its first day), as lib/timeline.ts.
create or replace function public.cycle_timeline(month date)
returns table (ideas_due timestamptz, form_opens timestamptz, form_closes timestamptz, descriptions_due timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select coalesce((select s.value from public.app_settings s where s.key = 'cycle_timeline'),
                    '{"ideas_due": 7, "form_opens": 10, "form_closes": 15, "descriptions_due": 20}') as v,
           (date_trunc('month', month) - interval '1 month')::date as planned_in
  )
  select (d.planned_in + (d.v ->> 'ideas_due')::int - 1 + time '23:59') at time zone 'Europe/Berlin',
         (d.planned_in + (d.v ->> 'form_opens')::int - 1 + time '09:00') at time zone 'Europe/Berlin',
         (d.planned_in + (d.v ->> 'form_closes')::int - 1 + time '23:59') at time zone 'Europe/Berlin',
         (d.planned_in + (d.v ->> 'descriptions_due')::int - 1 + time '23:59') at time zone 'Europe/Berlin'
  from d;
$$;
revoke all on function public.cycle_timeline(date) from public, anon;
grant execute on function public.cycle_timeline(date) to authenticated;

-- ── Ideas close on the 7th for the month after ─────────────────────────────
create or replace function public.guard_idea_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  due timestamptz;
  month date := date_trunc('month', new.proposed_date)::date;
  next_open date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.has_role('events') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.proposed_date = old.proposed_date then
    return new;
  end if;
  select t.ideas_due into due from public.cycle_timeline(month) t;
  if due < now() then
    next_open := (date_trunc('month', now() at time zone 'Europe/Berlin') + interval '1 month')::date;
    if (select t.ideas_due from public.cycle_timeline(next_open) t) < now() then
      next_open := (next_open + interval '1 month')::date;
    end if;
    raise exception 'Ideas for % closed on % – pick a date in % or later',
      to_char(month, 'FMMonth YYYY'), private.berlin_label(due), to_char(next_open, 'FMMonth YYYY') using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_idea_date() from public, anon, authenticated;
create trigger guard_idea_date before insert or update on public.event_ideas
  for each row execute function public.guard_idea_date();

-- ── The form opens by itself on its day ─────────────────────────────────────
-- A cycle still planning, with events on the schedule, between the opening
-- and the closing day: its form opens and closes on the closing day (never
-- after the first day of the month, review 2026-10-29 A5). A cycle whose
-- schedule is empty stays planning (the Events page shows it as late).
-- `at` is the clock (tests pass their own).
create or replace function public.open_due_forms(at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  n integer := 0;
begin
  perform set_config('mesa.cycle_transition', 'on', true);
  for c in
    select pc.id, t.form_closes
    from public.planning_cycles pc
    cross join lateral public.cycle_timeline(pc.month) t
    where pc.status = 'planning'
      and t.form_opens <= at and t.form_closes > at
      and exists (select 1 from public.events e where e.cycle_id = pc.id and e.status in ('draft', 'scheduled'))
    for update of pc skip locked
  loop
    update public.events set status = 'scheduled' where cycle_id = c.id and status = 'draft';
    update public.planning_cycles set status = 'form_open', form_closes_at = c.form_closes where id = c.id;
    perform private.log('planning_cycles', c.id::text, 'form_opened', null, c.id, jsonb_build_object('automatic', true, 'closes', c.form_closes));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.open_due_forms(timestamptz) from public, anon, authenticated;
grant execute on function public.open_due_forms(timestamptz) to service_role;
select cron.schedule('open-volunteer-forms', '* * * * *', 'select public.open_due_forms()');

-- ── The description deadline defaults to the 20th ───────────────────────────
-- Named so it runs before guard_cycle_deadlines (triggers fire by name),
-- which checks the value like one set by hand.
create or replace function public.default_description_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  due timestamptz;
  first_start timestamptz;
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' or new.description_deadline is not null then
    return new;
  end if;
  select t.descriptions_due into due from public.cycle_timeline(new.month) t;
  select min(e.starts_at) into first_start from public.events e
  where e.cycle_id = new.id and e.status not in ('dropped', 'cancelled');
  if due > now() and (first_start is null or due <= first_start) then
    new.description_deadline := due;
  end if;
  return new;
end;
$$;
revoke all on function public.default_description_deadline() from public, anon, authenticated;
create trigger default_description_deadline before update on public.planning_cycles
  for each row execute function public.default_description_deadline();

-- ── A reminder the day before the description deadline ──────────────────────
-- Once per event and deadline; not when a reminder went out the same Berlin
-- day already (Comms or Events clicked "Remind OC"). `at` is the clock.
create or replace function public.remind_due_descriptions(at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev record;
  n integer := 0;
  key text;
begin
  for ev in
    select e.id, e.cycle_id, c.description_deadline
    from public.events e
    join public.planning_cycles c on c.id = e.cycle_id
    where c.status = 'confirmed'
      and c.description_deadline is not null
      and at >= c.description_deadline - interval '24 hours'
      and at < c.description_deadline
      and e.status in ('confirmed', 'understaffed')
      and e.starts_at > at
      and not exists (select 1 from public.descriptions d where d.event_id = e.id and d.status in ('submitted', 'approved', 'published'))
  loop
    key := 'chat.remind_oc:description:' || ev.id || ':deadline:' || extract(epoch from ev.description_deadline)::bigint;
    continue when exists (select 1 from public.jobs j where j.idempotency_key = key)
      or exists (select 1 from public.jobs j where j.idempotency_key = 'chat.remind_oc:description:' || ev.id || ':' || (at at time zone 'Europe/Berlin')::date);
    perform private.enqueue_job('chat.remind_oc', jsonb_build_object('event_id', ev.id, 'about', 'description'), key, ev.id);
    perform private.log('events', ev.id::text, 'remind', ev.id, ev.cycle_id, jsonb_build_object('reminded', 'description', 'automatic', true));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.remind_due_descriptions(timestamptz) from public, anon, authenticated;
grant execute on function public.remind_due_descriptions(timestamptz) to service_role;
select cron.schedule('remind-due-descriptions', '*/15 * * * *', 'select public.remind_due_descriptions()');
