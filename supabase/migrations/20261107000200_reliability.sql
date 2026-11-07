-- ============================================================
-- MESA Events Platform – reliability: no-show reports and the blacklist
-- (2026-11-07)
--
-- * After an event has started, its OC (or the Events team) reports who of
--   the team was missing and why: no-show without notice, cancelled at short
--   notice outside the app, very late or left early, or excused (a good
--   reason). No report = was there. The cause can be personal ("sick"), so
--   reports are read only by the event's OC, the Events team, HR and the
--   executive board – like drop-out reasons.
-- * The blacklist: the Events team and HR put unreliable members on it (with
--   a reason) and take them off again; entries are kept with who and when.
--   People on it still fill in the volunteer form – the Events team sees
--   what they wanted – but the automatic allocation leaves them out
--   (lib/actions/planning.ts), and a trigger lets anyone add them only as a
--   helper on an event the Events team marked non-crucial
--   (events.non_crucial). Assignments made before they were put on the
--   list stay; the roster board marks them.
-- * member_reliability(): per member, for HR and the Events team – events
--   done, each kind of report, late drop-outs (in the app, less than 48 hours
--   before the start) and whether they are on the blacklist.
-- ============================================================

-- ── Non-crucial events ──────────────────────────────────────────────────────
alter table public.events add column non_crucial boolean not null default false;
comment on column public.events.non_crucial is
  'The Events team''s call: the event also runs if a helper does not show up, so people on the blacklist may help on it.';

-- Only the Events team changes it (OCs edit their event's details too);
-- the service role (seeds, jobs) has no email.
create or replace function private.guard_non_crucial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.non_crucial is distinct from old.non_crucial and public.auth_email() <> '' and not public.has_role('events') then
    raise exception 'Only the Events team marks an event as non-crucial' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_non_crucial() from public, anon, authenticated;
create trigger events_guard_non_crucial before update of non_crucial on public.events
  for each row execute function private.guard_non_crucial();

-- ── The blacklist ───────────────────────────────────────────────────────────
create table public.volunteer_blacklist (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  reason      text not null constraint volunteer_blacklist_reason_check check (length(reason) between 1 and 500),
  added_by    text not null,
  added_at    timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  text,
  remove_note text constraint volunteer_blacklist_remove_note_check check (length(remove_note) <= 500),
  constraint volunteer_blacklist_removed_check check ((removed_at is null) = (removed_by is null))
);
-- One current entry per member; earlier ones stay as history.
create unique index volunteer_blacklist_one_current on public.volunteer_blacklist (profile_id) where removed_at is null;

alter table public.volunteer_blacklist enable row level security;
create policy "The Events team, HR and the executive board read the blacklist" on public.volunteer_blacklist for select to authenticated
  using (public.has_role('events') or public.has_role('hr') or public.has_role('executive'));
-- Written only through blacklist_add() and blacklist_remove().
revoke insert, update, delete, truncate on public.volunteer_blacklist from anon, authenticated;
revoke all on public.volunteer_blacklist from anon;

create or replace function private.is_blacklisted(profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.volunteer_blacklist b where b.profile_id = profile and b.removed_at is null);
$$;
revoke all on function private.is_blacklisted(uuid) from public, anon, authenticated;

create or replace function public.blacklist_add(profile uuid, reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry uuid;
begin
  if not (public.has_role('events') or public.has_role('hr')) then
    raise exception 'The Events team and HR only' using errcode = '42501';
  end if;
  if nullif(trim(reason), '') is null then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = profile) then
    raise exception 'No such member' using errcode = '22023';
  end if;
  if private.is_blacklisted(profile) then
    raise exception 'This member is on the blacklist already' using errcode = '23505';
  end if;
  insert into public.volunteer_blacklist (profile_id, reason, added_by)
  values (profile, left(trim(reason), 500), public.auth_email())
  returning id into entry;
  return entry;
end;
$$;

create or replace function public.blacklist_remove(profile uuid, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.has_role('events') or public.has_role('hr')) then
    raise exception 'The Events team and HR only' using errcode = '42501';
  end if;
  update public.volunteer_blacklist
  set removed_at = now(), removed_by = public.auth_email(), remove_note = nullif(left(trim(coalesce(note, '')), 500), '')
  where profile_id = profile and removed_at is null;
  if not found then
    raise exception 'This member is not on the blacklist' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.blacklist_add(uuid, text), public.blacklist_remove(uuid, text) from public, anon;
grant execute on function public.blacklist_add(uuid, text), public.blacklist_remove(uuid, text) to authenticated;

-- Someone on the blacklist joins an event only as a helper on a non-crucial
-- one – however they are added (allocation, roster board, claiming a slot,
-- an idea's partner). Checked when they are added, moved to another event or
-- made OC; becoming a helper on their current event is always fine.
create or replace function private.guard_blacklisted_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  crucial boolean;
  who text;
begin
  if new.status <> 'active' or not private.is_blacklisted(new.profile_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.event_id = old.event_id and old.status = 'active' and (new.role = old.role or new.role = 'helper') then
    return new;
  end if;
  select not e.non_crucial into crucial from public.events e where e.id = new.event_id;
  if new.role = 'helper' and not crucial then
    return new;
  end if;
  if new.profile_id = auth.uid() then
    raise exception 'Please ask the Events team to add you to this event.' using errcode = '42501';
  end if;
  select coalesce(nullif(p.full_name, ''), p.email) into who from public.profiles p where p.id = new.profile_id;
  raise exception '% is on the blacklist: only as a helper on an event marked non-crucial.', who using errcode = '42501';
end;
$$;
revoke all on function private.guard_blacklisted_assignment() from public, anon, authenticated;
create trigger assignments_guard_blacklist before insert or update of event_id, role, status on public.assignments
  for each row execute function private.guard_blacklisted_assignment();

-- ── Attendance reports ──────────────────────────────────────────────────────
create table public.attendance_reports (
  assignment_id uuid primary key references public.assignments (id) on delete cascade,
  event_id      uuid not null references public.events (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  outcome       text not null constraint attendance_reports_outcome_check check (outcome in ('no_show', 'short_notice', 'late', 'excused')),
  note          text constraint attendance_reports_note_check check (length(note) <= 500),
  reported_by   text not null,
  reported_at   timestamptz not null default now()
);
create index attendance_reports_event_idx on public.attendance_reports (event_id);
create index attendance_reports_profile_idx on public.attendance_reports (profile_id);
comment on column public.attendance_reports.outcome is
  'no_show = did not come, no notice; short_notice = cancelled at short notice outside the app; late = very late or left early; excused = missed for a good reason.';

alter table public.attendance_reports enable row level security;
create policy "The event's OC, the Events team, HR and the board read attendance reports" on public.attendance_reports for select to authenticated
  using (public.has_role('events') or public.has_role('hr') or public.has_role('executive') or public.is_event_oc(event_id));
-- Written only through report_attendance() and clear_attendance_report().
revoke insert, update, delete, truncate on public.attendance_reports from anon, authenticated;
revoke all on public.attendance_reports from anon;

-- The OC (or the Events team) of an event that has started; not about oneself.
create or replace function private.require_reporter(assignment uuid)
returns public.assignments
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.assignments;
  e public.events;
begin
  select * into a from public.assignments where id = assignment;
  if not found then
    raise exception 'No such assignment' using errcode = '22023';
  end if;
  if not (public.has_role('events') or public.is_event_oc(a.event_id)) then
    raise exception 'Only the event''s OC and the Events team report attendance' using errcode = '42501';
  end if;
  if a.profile_id = auth.uid() then
    raise exception 'You cannot report on yourself' using errcode = '42501';
  end if;
  select * into e from public.events where id = a.event_id;
  if e.starts_at > now() then
    raise exception 'Attendance is reported once the event has started' using errcode = '22023';
  end if;
  if e.status in ('cancelled', 'dropped', 'draft') then
    raise exception 'The event did not take place' using errcode = '22023';
  end if;
  if a.status <> 'active' then
    raise exception 'They dropped out before the event – that is counted already' using errcode = '22023';
  end if;
  return a;
end;
$$;
revoke all on function private.require_reporter(uuid) from public, anon, authenticated;

create or replace function public.report_attendance(assignment uuid, outcome text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.assignments;
begin
  a := private.require_reporter(assignment);
  insert into public.attendance_reports as r (assignment_id, event_id, profile_id, outcome, note, reported_by)
  values (a.id, a.event_id, a.profile_id, outcome, nullif(left(trim(coalesce(note, '')), 500), ''), public.auth_email())
  on conflict (assignment_id) do update
    set outcome = excluded.outcome, note = excluded.note, reported_by = excluded.reported_by, reported_at = now();
end;
$$;

create or replace function public.clear_attendance_report(assignment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_reporter(assignment);
  delete from public.attendance_reports where assignment_id = assignment;
end;
$$;
revoke all on function public.report_attendance(uuid, text, text), public.clear_attendance_report(uuid) from public, anon;
grant execute on function public.report_attendance(uuid, text, text), public.clear_attendance_report(uuid) to authenticated;

-- ── What HR reviews: reliability per member ─────────────────────────────────
-- Members who were on an ESN event that started in the last `months` months
-- (or dropped out of one), and everyone on the blacklist. Only events that
-- took place (not cancelled or dropped).
create or replace function public.member_reliability(months integer default 12)
returns table (
  profile_id uuid, full_name text, email text,
  events_done integer, no_show integer, short_notice integer, late integer, excused integer, late_dropouts integer,
  last_incident_at timestamptz,
  blacklisted boolean, blacklist_reason text, blacklisted_by text, blacklisted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role('events') or public.has_role('hr') or public.has_role('executive')) then
    raise exception 'The Events team, HR and the executive board only' using errcode = '42501';
  end if;
  if months is null or months not between 1 and 120 then
    raise exception 'Between 1 and 120 months' using errcode = '22023';
  end if;
  return query
  with ev as (
    select e.id, e.starts_at from public.events e
    where e.status not in ('cancelled', 'dropped', 'draft')
      and e.starts_at <= now() and e.starts_at > now() - make_interval(months => months)
  ),
  done as (
    select a.profile_id as id, count(*)::integer as n
    from public.assignments a join ev on ev.id = a.event_id
    where a.status = 'active' group by a.profile_id
  ),
  rep as (
    select r.profile_id as id,
      (count(*) filter (where r.outcome = 'no_show'))::integer as no_show,
      (count(*) filter (where r.outcome = 'short_notice'))::integer as short_notice,
      (count(*) filter (where r.outcome = 'late'))::integer as late,
      (count(*) filter (where r.outcome = 'excused'))::integer as excused,
      max(ev.starts_at) filter (where r.outcome <> 'excused') as last_at
    from public.attendance_reports r join ev on ev.id = r.event_id
    join public.assignments a on a.id = r.assignment_id and a.status = 'active'
    group by r.profile_id
  ),
  drops as (
    select a.profile_id as id, count(*)::integer as n, max(ev.starts_at) as last_at
    from public.assignments a join ev on ev.id = a.event_id
    where a.status = 'dropped_out' and a.dropped_at > ev.starts_at - interval '48 hours'
    group by a.profile_id
  ),
  bl as (
    select b.profile_id as id, b.reason, b.added_by, b.added_at from public.volunteer_blacklist b where b.removed_at is null
  ),
  people as (
    select id from done union select id from rep union select id from drops union select id from bl
  )
  select p.id, p.full_name, p.email,
    coalesce(done.n, 0), coalesce(rep.no_show, 0), coalesce(rep.short_notice, 0), coalesce(rep.late, 0), coalesce(rep.excused, 0), coalesce(drops.n, 0),
    greatest(rep.last_at, drops.last_at),
    bl.id is not null, bl.reason, bl.added_by, bl.added_at
  from people x
  join public.profiles p on p.id = x.id
  left join done on done.id = x.id
  left join rep on rep.id = x.id
  left join drops on drops.id = x.id
  left join bl on bl.id = x.id
  order by p.full_name, p.email;
end;
$$;
revoke all on function public.member_reliability(integer) from public, anon;
grant execute on function public.member_reliability(integer) to authenticated;

-- One member's incidents (reports and late drop-outs), newest first, and
-- their blacklist history – the detail behind a row of member_reliability().
-- Drop-out reasons stay with the OC and the Events team (they are not here).
create or replace function public.member_incidents(profile uuid)
returns table (event_id uuid, event_title text, starts_at timestamptz, kind text, note text, reported_by text, reported_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role('events') or public.has_role('hr') or public.has_role('executive')) then
    raise exception 'The Events team, HR and the executive board only' using errcode = '42501';
  end if;
  return query
  select e.id, e.title, e.starts_at, r.outcome, r.note, r.reported_by, r.reported_at
  from public.attendance_reports r
  join public.events e on e.id = r.event_id
  join public.assignments a on a.id = r.assignment_id and a.status = 'active'
  where r.profile_id = profile and e.status not in ('cancelled', 'dropped', 'draft')
  union all
  select e.id, e.title, e.starts_at, 'late_dropout', null, null, a.dropped_at
  from public.assignments a join public.events e on e.id = a.event_id
  where a.profile_id = profile and a.status = 'dropped_out' and a.dropped_at > e.starts_at - interval '48 hours'
    and e.status not in ('cancelled', 'dropped', 'draft') and e.starts_at <= now()
  order by 3 desc;
end;
$$;
revoke all on function public.member_incidents(uuid) from public, anon;
grant execute on function public.member_incidents(uuid) to authenticated;

-- ── "Reset demo data" knows the new tables ──────────────────────────────────
-- attendance_reports go with their events; the blacklist is demo data too.
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'advertising_pictures', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'attendance_reports', 'calendar_feeds',
    'cancellation_requests', 'cash_box_changes', 'cash_boxes', 'cash_reports', 'description_versions', 'descriptions',
    'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_formats', 'event_ideas', 'event_photo_folders',
    'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages',
    'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files', 'fake_drive_folders',
    'fake_telegram_messages', 'finance_entries', 'idea_partners', 'internal_attendance', 'internal_event_people', 'internal_events', 'jobs',
    'participants', 'payout_batches', 'payout_details', 'planning_cycles', 'preapprovals',
    'profile_payout_details', 'publication_post_events', 'publication_posts', 'receipts',
    'reimbursements', 'reviews', 'trip_budgets', 'volunteer_blacklist', 'volunteer_choices', 'volunteer_responses'
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
