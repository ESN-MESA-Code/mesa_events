-- ============================================================
-- MESA Events Platform – calendar subscription (iCal) and the demo reset
-- (round 2026-10-30)
--
-- * calendar_feeds: one personal feed per member. Calendar apps cannot
--   sign in, so the feed URL carries a secret token: shown once, stored
--   as SHA-256 (as the ESN access tokens), replaced or turned off by its
--   owner. /calendar/feed/<token>.ics resolves it with
--   calendar_feed_items() (service role), which returns what the owner
--   may see: the scheduled ESN events and internal events, board
--   meetings only for the executive board and the planners. A member who
--   no longer has access (left the Workspace, rules not accepted) gets
--   nothing.
-- * "Reset demo data" knows the new tables.
-- ============================================================

create table public.calendar_feeds (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  token_hash   text not null unique constraint calendar_feeds_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.calendar_feeds enable row level security;
create policy "Members see their own calendar feed"
  on public.calendar_feeds for select to authenticated
  using (public.is_workspace_member() and profile_id = auth.uid());
revoke insert, update, delete, truncate on public.calendar_feeds from anon, authenticated;
revoke all on public.calendar_feeds from anon;

-- A new feed token for the signed-in member (replaces the old one); returned once.
create or replace function public.create_calendar_feed()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  token := 'mesa_cal_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.calendar_feeds (profile_id, token_hash, token_prefix)
  values (auth.uid(), encode(extensions.digest(token, 'sha256'), 'hex'), left(token, 13))
  on conflict (profile_id) do update
    set token_hash = excluded.token_hash, token_prefix = excluded.token_prefix, created_at = now(), last_used_at = null;
  return token;
end;
$$;

create or replace function public.revoke_calendar_feed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  delete from public.calendar_feeds where profile_id = auth.uid();
end;
$$;
revoke all on function public.create_calendar_feed() from public, anon;
revoke all on function public.revoke_calendar_feed() from public, anon;
grant execute on function public.create_calendar_feed() to authenticated;
grant execute on function public.revoke_calendar_feed() to authenticated;

-- What a feed shows (service role only; the route renders it as iCalendar).
-- From half a year back. Refused (P0002) when the token is unknown or its
-- owner has lost access.
create or replace function public.calendar_feed_items(token text)
returns table (
  uid text,
  kind text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  description text,
  path text,
  cancelled boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  owner_email text;
  roles public.app_role[];
  board boolean;
begin
  select f.profile_id, p.email into owner, owner_email
  from public.calendar_feeds f join public.profiles p on p.id = f.profile_id
  where f.token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
  if owner is null
     or owner_email not like '%@' || public.workspace_domain()
     or not exists (select 1 from public.organiser_acknowledgements a where a.email = owner_email and a.version = public.confidentiality_version()) then
    raise exception 'Unknown calendar feed' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(r.role), '{}') into roles from public.role_members r where r.email = owner_email;
  board := roles && array['executive', 'hr', 'vice_president']::public.app_role[];
  -- Calendar apps poll often; note the use at most hourly.
  update public.calendar_feeds set last_used_at = now()
  where profile_id = owner and (last_used_at is null or last_used_at < now() - interval '1 hour');

  return query
  select 'event-' || e.id::text || '@mesa',
         'event',
         e.title,
         e.starts_at,
         e.ends_at,
         concat_ws(', ', nullif(e.location, ''), nullif(e.address_street, ''), nullif(concat_ws(' ', nullif(e.address_postal_code, ''), nullif(e.address_city, '')), '')),
         concat_ws(E'\n',
           case a.role when 'oc' then 'You are the OC.' when 'helper' then 'You are a helper.' end,
           case when e.status = 'understaffed' then 'Short of helpers.' end),
         '/events/' || e.id::text,
         e.status = 'cancelled',
         e.updated_at
  from public.events e
  left join public.assignments a on a.event_id = e.id and a.profile_id = owner and a.status = 'active'
  where e.source = 'platform'
    and e.status in ('scheduled', 'understaffed', 'confirmed', 'cancelled', 'completed')
    and e.starts_at > now() - interval '183 days'
  union all
  select 'internal-' || i.id::text || '@mesa',
         i.kind::text,
         i.title,
         i.starts_at,
         i.ends_at,
         nullif(i.location, ''),
         concat_ws(E'\n',
           case p.role when 'oc' then 'You are the OC.' when 'helper' then 'You are a helper.' when 'attendee' then 'You signed up.' end,
           nullif(i.note, ''),
           case when i.kind = 'office_hour' then nullif(s.description, '') end,
           case when i.presentation_url is not null then 'Presentation: ' || i.presentation_url end),
         case when i.kind = 'office_hour' then '/office-hours/' else '/internal/' end || i.id::text,
         i.status = 'cancelled',
         i.updated_at
  from public.internal_events i
  join public.internal_kind_settings s on s.kind = i.kind
  left join public.internal_event_people p on p.internal_event_id = i.id and p.profile_id = owner
  where (i.kind <> 'board_meeting' or board)
    and i.starts_at > now() - interval '183 days';
end;
$$;
revoke all on function public.calendar_feed_items(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_items(text) to service_role;

-- ── "Reset demo data" knows the new tables ─────────────────────────────────
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'calendar_feeds',
    'cash_reports', 'description_versions', 'descriptions', 'esn_access_tokens', 'esn_uploads',
    'event_chat_members', 'event_ideas', 'event_photo_folders', 'event_reports', 'event_series',
    'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages', 'fake_chat_spaces',
    'fake_directory_members', 'fake_drive_files', 'fake_drive_folders', 'fake_telegram_messages',
    'finance_entries', 'internal_event_people', 'internal_events', 'jobs', 'participants',
    'payout_batches', 'payout_details', 'planning_cycles', 'preapprovals', 'profile_payout_details',
    'publication_post_events', 'publication_posts', 'receipts', 'reimbursements', 'reviews',
    'trip_budgets', 'volunteer_choices', 'volunteer_responses'
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
