-- ============================================================
-- MESA Events Platform – the cash boxes themselves (round 2026-10-31)
--
-- * cash_boxes: the physical boxes, with the notes and coins Finance knows
--   are in them. Two to start with: the office hour box and the events
--   box. Finance adds and removes boxes (a removed box keeps its history;
--   only an empty box is removed) and says which box office hours and
--   events take by default.
-- * cash_box_changes: every change of a box's content – Finance puts
--   money in (change, new coins …), takes it out (to the bank …) or
--   recounts it; a signed-off office hour or event sets the box to what
--   was counted at the end.
-- * cash_reports.cash_box_id: the box an office hour or event counted. The
--   staff pick it when they start (the default otherwise); its content
--   is the suggested opening count.
-- Finance and executives read the boxes' history; members read the boxes
-- (to pick one and see what should be in it); only Finance changes them.
-- ============================================================

create table public.cash_boxes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null constraint cash_boxes_name_check check (length(trim(name)) between 1 and 80),
  -- The box office hours (office_hour) or events and the rest (event) start with.
  default_for text constraint cash_boxes_default_check check (default_for in ('office_hour', 'event')),
  -- Notes and coins in cents, as in cash_reports: {"5000": 1, "200": 4}.
  counts      jsonb not null default '{}',
  cents       integer not null default 0 constraint cash_boxes_cents_check check (cents between 0 and 100000000),
  position    smallint not null default 100,
  removed_at  timestamptz,
  removed_by  text,
  created_at  timestamptz not null default now(),
  created_by  text default public.auth_email(),
  updated_at  timestamptz not null default now(),
  constraint cash_boxes_removed_check check (removed_at is null or default_for is null)
);
create unique index cash_boxes_name_idx on public.cash_boxes(lower(trim(name))) where removed_at is null;
create unique index cash_boxes_default_idx on public.cash_boxes(default_for) where default_for is not null;
create trigger cash_boxes_updated_at before update on public.cash_boxes for each row execute function public.set_updated_at();

insert into public.cash_boxes (name, default_for, position) values
  ('Office hour cash box', 'office_hour', 0),
  ('Events cash box', 'event', 1);

create table public.cash_box_changes (
  id             uuid primary key default gen_random_uuid(),
  box_id         uuid not null references public.cash_boxes(id) on delete cascade,
  -- in / out: the notes and coins put in or taken out; recount / report: the box's content afterwards.
  kind           text not null constraint cash_box_changes_kind_check check (kind in ('in', 'out', 'recount', 'report')),
  counts         jsonb not null default '{}',
  cents_before   integer not null,
  cents_after    integer not null,
  cash_report_id uuid references public.cash_reports(id) on delete set null,
  note           text not null default '' constraint cash_box_changes_note_check check (length(note) <= 300),
  created_at     timestamptz not null default now(),
  created_by     text default public.auth_email()
);
create index cash_box_changes_box_idx on public.cash_box_changes(box_id, created_at desc);

alter table public.cash_boxes enable row level security;
alter table public.cash_box_changes enable row level security;
create policy "Members read the cash boxes" on public.cash_boxes for select to authenticated using (public.is_workspace_member());
create policy "Finance and executives read cash box changes" on public.cash_box_changes for select to authenticated
  using (public.has_role('finance') or public.has_role('executive'));
revoke insert, update, delete, truncate on public.cash_boxes, public.cash_box_changes from anon, authenticated;
revoke all on public.cash_boxes, public.cash_box_changes from anon;

-- ── The box of a cash report ────────────────────────────────────────────────
alter table public.cash_reports add column cash_box_id uuid references public.cash_boxes(id) on delete restrict;

-- The default box of an office hour, or of an event and anything else.
create or replace function private.default_cash_box(internal_event uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.id from public.cash_boxes b
     where b.removed_at is null
       and b.default_for = case when exists (select 1 from public.internal_events e where e.id = internal_event and e.kind = 'office_hour') then 'office_hour' else 'event' end),
    (select b.id from public.cash_boxes b where b.removed_at is null order by b.position, b.created_at limit 1)
  );
$$;
revoke all on function private.default_cash_box(uuid) from public, anon, authenticated;

update public.cash_reports r set cash_box_id = private.default_cash_box(r.internal_event_id);

create or replace function private.cash_report_box()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cash_box_id is null then
    new.cash_box_id := private.default_cash_box(new.internal_event_id);
  end if;
  if new.cash_box_id is null then
    raise exception 'There is no cash box – Finance adds one first' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.cash_report_box() from public, anon, authenticated;
create trigger cash_report_box before insert on public.cash_reports for each row execute function private.cash_report_box();
alter table public.cash_reports alter column cash_box_id set not null;
create index cash_reports_box_idx on public.cash_reports(cash_box_id);

-- The staff start the cash box of their event or office hour (once), with a box of their choice.
drop function public.ensure_cash_report(uuid, uuid);
create or replace function public.ensure_cash_report(event uuid default null, internal_event uuid default null, box uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  id uuid;
  k public.internal_kind;
begin
  if num_nonnulls(event, internal_event) <> 1 then
    raise exception 'Name either an event or an internal event' using errcode = '22023';
  end if;
  if box is not null and not exists (select 1 from public.cash_boxes b where b.id = box and b.removed_at is null) then
    raise exception 'This cash box was removed' using errcode = '22023';
  end if;
  if event is not null then
    if not public.is_event_staff(event) then
      raise exception 'Only the event''s OC and helpers count its cash box' using errcode = '42501';
    end if;
    if exists (select 1 from public.events e where e.id = event and e.status in ('draft', 'dropped')) then
      raise exception 'This event does not take place' using errcode = '22023';
    end if;
    select r.id into id from public.cash_reports r where r.event_id = event;
    if id is null then
      insert into public.cash_reports (event_id, cash_box_id) values (event, box) on conflict (event_id) do nothing returning cash_reports.id into id;
      if id is null then select r.id into id from public.cash_reports r where r.event_id = event; end if;
    end if;
    return id;
  end if;
  if not public.is_internal_staff(internal_event) then
    raise exception 'Only the OC and helpers count the cash box' using errcode = '42501';
  end if;
  select kind into k from public.internal_events e where e.id = internal_event;
  select r.id into id from public.cash_reports r where r.internal_event_id = internal_event;
  if id is null then
    insert into public.cash_reports (internal_event_id, cash_box_id, card_price_internal_cents, card_price_external_cents)
    values (
      internal_event,
      box,
      case when k = 'office_hour' then (select (s.value #>> '{}')::integer from public.app_settings s where s.key = 'esncard_price_internal_cents') end,
      case when k = 'office_hour' then (select (s.value #>> '{}')::integer from public.app_settings s where s.key = 'esncard_price_external_cents') end
    )
    on conflict (internal_event_id) do nothing returning cash_reports.id into id;
    if id is null then select r.id into id from public.cash_reports r where r.internal_event_id = internal_event; end if;
  end if;
  return id;
end;
$$;
revoke all on function public.ensure_cash_report(uuid, uuid, uuid) from public, anon;
grant execute on function public.ensure_cash_report(uuid, uuid, uuid) to authenticated;

-- The OC signs off: counts and sales are final, and the box holds what was counted at the end.
create or replace function public.close_cash_report(report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cash_reports := private.open_report_for_staff(report);
  b public.cash_boxes;
begin
  if not private.cash_report_oc(r) then
    raise exception 'Only the OC signs off the cash box' using errcode = '42501';
  end if;
  if r.opening_cents is null or r.closing_cents is null then
    raise exception 'Count the box before and after first' using errcode = '22023';
  end if;
  update public.cash_reports set closed_at = now(), closed_by = public.auth_email() where id = r.id;
  select * into b from public.cash_boxes where id = r.cash_box_id and removed_at is null for update;
  if b.id is not null then
    update public.cash_boxes set counts = r.closing_counts, cents = r.closing_cents where id = b.id;
    insert into public.cash_box_changes (box_id, kind, counts, cents_before, cents_after, cash_report_id)
    values (b.id, 'report', r.closing_counts, b.cents, r.closing_cents, r.id);
  end if;
end;
$$;

-- ── What Finance does with the boxes ────────────────────────────────────────
create or replace function public.add_cash_box(name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  id uuid;
begin
  perform private.require_finance();
  if length(trim(coalesce(add_cash_box.name, ''))) not between 1 and 80 then
    raise exception 'Give the cash box a name (up to 80 characters)' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_boxes b where b.removed_at is null and lower(trim(b.name)) = lower(trim(add_cash_box.name))) then
    raise exception 'There is a cash box of that name already' using errcode = '22023';
  end if;
  insert into public.cash_boxes (name, position)
  values (trim(add_cash_box.name), coalesce((select max(b.position) + 1 from public.cash_boxes b where b.removed_at is null), 0))
  returning cash_boxes.id into id;
  perform private.log('cash_boxes', id::text, 'insert', null, null, jsonb_build_object('name', trim(add_cash_box.name)));
  return id;
end;
$$;

-- Only an empty box that no open office hour or event counts is removed; its history stays.
create or replace function public.remove_cash_box(box uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.cash_boxes;
begin
  perform private.require_finance();
  select * into b from public.cash_boxes where id = box and removed_at is null for update;
  if b.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if b.cents > 0 then
    raise exception 'Take the money out of the box first' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_reports r where r.cash_box_id = box and r.closed_at is null) then
    raise exception 'An office hour or event still counts with this box – sign it off first' using errcode = '22023';
  end if;
  update public.cash_boxes set removed_at = now(), removed_by = public.auth_email(), default_for = null where id = box;
  perform private.log('cash_boxes', box::text, 'delete', null, null, jsonb_build_object('name', b.name));
end;
$$;

-- The box office hours (office_hour) or events (event) start with.
create or replace function public.set_cash_box_default(box uuid, kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  if kind not in ('office_hour', 'event') then
    raise exception 'A default is for office hours or events' using errcode = '22023';
  end if;
  if not exists (select 1 from public.cash_boxes b where b.id = box and b.removed_at is null) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  update public.cash_boxes set default_for = null where default_for = kind and id <> box;
  update public.cash_boxes set default_for = kind where id = box;
end;
$$;

-- Money in (mode in), out (out) or the box counted anew (recount); returns the box's new total.
create or replace function public.adjust_cash_box(box uuid, mode text, counts jsonb, note text default '')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.cash_boxes;
  given integer := private.cash_total(counts);
  merged jsonb;
  short text;
  total integer;
begin
  perform private.require_finance();
  select * into b from public.cash_boxes where id = box and removed_at is null for update;
  if b.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if mode not in ('in', 'out', 'recount') then
    raise exception 'Put money in, take it out or recount the box' using errcode = '22023';
  end if;
  if mode <> 'recount' and given = 0 then
    raise exception 'Enter the notes and coins' using errcode = '22023';
  end if;
  if mode = 'recount' then
    select coalesce(jsonb_object_agg(key, value), '{}') into merged from jsonb_each(counts) where (value #>> '{}')::integer > 0;
  else
    select coalesce(jsonb_object_agg(k, n), '{}'),
           string_agg(case when n < 0 then (-n)::text || ' × ' || case when k::integer >= 100 then '€ ' || (k::integer / 100)::text else k || ' ct' end end, ', ')
      into merged, short
    from (
      select k, sum(n)::integer as n
      from (
        select key as k, (value #>> '{}')::integer as n from jsonb_each(b.counts)
        union all
        select key, (case when mode = 'out' then -1 else 1 end) * (value #>> '{}')::integer from jsonb_each(counts)
      ) x
      group by k
    ) y
    where n <> 0;
    if short is not null then
      raise exception 'The box does not hold that much: % missing', short using errcode = '22023';
    end if;
  end if;
  total := private.cash_total(merged);
  update public.cash_boxes set counts = merged, cents = total where id = box;
  insert into public.cash_box_changes (box_id, kind, counts, cents_before, cents_after, note)
  values (box, mode, case when mode = 'recount' then merged else (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(counts) where (value #>> '{}')::integer > 0) end,
          b.cents, total, left(trim(coalesce(adjust_cash_box.note, '')), 300));
  return total;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['add_cash_box(text)', 'remove_cash_box(uuid)', 'set_cash_box_default(uuid, text)', 'adjust_cash_box(uuid, text, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ── "Reset demo data" knows the boxes ───────────────────────────────────────
-- The boxes and their history are wiped; the two boxes of a fresh database
-- come back, empty.
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'calendar_feeds',
    'cash_box_changes', 'cash_boxes', 'cash_reports', 'description_versions', 'descriptions',
    'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_ideas', 'event_photo_folders',
    'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages',
    'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files', 'fake_drive_folders',
    'fake_telegram_messages', 'finance_entries', 'internal_event_people', 'internal_events', 'jobs',
    'participants', 'payout_batches', 'payout_details', 'planning_cycles', 'preapprovals',
    'profile_payout_details', 'publication_post_events', 'publication_posts', 'receipts',
    'reimbursements', 'reviews', 'trip_budgets', 'volunteer_choices', 'volunteer_responses'
  ]) as t
  union all
  -- reimbursement_policies/rules: versions after the first are removed;
  -- role_members: demo members' rows are removed.
  select t, 'keep' from unnest(array[
    'app_settings', 'finance_categories', 'internal_kind_settings', 'organiser_acknowledgements', 'profiles',
    'publication_channels', 'reimbursement_policies', 'reimbursement_rules', 'role_members'
  ]) as t;
$$;
revoke all on function private.staging_wipe_lists() from public, anon, authenticated;

create or replace function public.staging_wipe()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  unlisted text;
  tables text;
  demo_pattern text := '\.demo@' || replace(public.workspace_domain(), '.', '\.') || '$';
begin
  perform private.require_demo_database();
  select string_agg(table_name, ', ') into unlisted from public.staging_wipe_plan() where action = 'unlisted';
  if unlisted is not null then
    raise exception 'Reset refused: no decision for table(s) %', unlisted using errcode = '55000';
  end if;
  select string_agg(format('public.%I', p.table_name), ', ') into tables
  from public.staging_wipe_plan() p where p.action = 'wipe';
  -- No CASCADE: a kept table that references a wiped one makes this fail
  -- instead of losing it silently.
  execute 'truncate table ' || tables || ' restart identity';
  insert into public.cash_boxes (name, default_for, position) values
    ('Office hour cash box', 'office_hour', 0),
    ('Events cash box', 'event', 1);
  delete from public.reimbursement_policies where version > 1;
  delete from public.role_members where email ~ demo_pattern;
  delete from public.organiser_acknowledgements where email ~ demo_pattern;
  return jsonb_build_object('wiped', (select count(*) from public.staging_wipe_plan() where action = 'wipe'));
end;
$$;
revoke all on function public.staging_wipe() from public, anon, authenticated;
grant execute on function public.staging_wipe() to service_role;
